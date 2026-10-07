import { test, expect } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { widgetsDefaults } from '../frontend/src/notification-widget-model.js';
import { createNotificationWidgetCommands } from '../frontend/src/notification-widget-commands.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const profile = getOSProfile('macos-golden-gate-27.0.1');
  let state = widgetsDefaults(profile), pane = { centerId: 'original-center', focusedControl: null, scroll: { top: 0, left: 0 } };
  const ui = { editor: null, editingWidgetId: null, contextWidgetId: null };
  let available = true, alive = true, prepareBarrier = null, prepareEntered = null, settleBarrier = null, settleEntered = null, focused = 'center';
  const window = { id: 'original-reminders-window', appId: 'reminders' };
  let dataWindow = window;
  const controlIds = () => ['center', 'edit-widgets', ...state.instances.flatMap(widget => [
    `widget:${widget.id}:card`, `widget:${widget.id}:open`, `widget:${widget.id}:done`, `widget:${widget.id}:menu-close`,
    ...state.sources.reminders.filter(row => row.listId === widget.configuration.listId).map(row => `widget:${widget.id}:reminder:${row.id}`),
  ])];
  const view = {
    available: () => available && alive,
    describe: () => ({ controlIds: controlIds(), focusedControl: focused, scroll: { top: 0, left: 0 } }),
    async prepare(controlId, guard) {
      if (prepareBarrier) { const waiting = prepareBarrier; prepareBarrier = null; prepareEntered.resolve(); await waiting.promise; }
      return guard() && controlIds().includes(controlId);
    },
    async focus(controlId, guard) { if (!guard() || !controlIds().includes(controlId)) return false; focused = controlId; return true; },
  };
  const dataView = {
    ...view,
    describe: () => ({ controlIds: ['panel', ...state.sources.reminders.map(row => `reminder:${row.id}`)], focusedControl: 'panel', scroll: { top: 0, left: 0 } }),
    async prepare(controlId, guard) { if (prepareBarrier) { const waiting = prepareBarrier; prepareBarrier = null; prepareEntered.resolve(); await waiting.promise; } return guard(); },
  };
  const controller = createNotificationWidgetCommands({
    profile, namespace: 'owned-root', alive: () => alive, available: () => available,
    getState: () => state, getUi: () => ui, getCenter: () => pane,
    getCenterView: () => view, getEditorView: () => null,
    settle: async () => { if (settleBarrier) { const waiting = settleBarrier; settleBarrier = null; settleEntered.resolve(); await waiting.promise; } },
    canCommit: () => true,
    getDataOwner: windowId => dataWindow?.id === windowId ? { window: dataWindow, windowId, appId: dataWindow.appId } : null,
    getDataView: () => dataView, getDataTargets: () => [], openData: async () => { throw new Error('Not exercised'); }, closeCenter: () => { pane = null; },
  });
  return { profile, controller, get state() { return state; }, get pane() { return pane; }, window,
    pause() { prepareBarrier = deferred(); prepareEntered = deferred(); return { entered: prepareEntered.promise, release: prepareBarrier.resolve }; },
    pauseSettlement() { settleBarrier = deferred(); settleEntered = deferred(); return { entered: settleEntered.promise, release: settleBarrier.resolve }; },
    setAvailable(value) { available = value; controller.reconcile(); },
    replacePane() { pane = { centerId: pane.centerId, focusedControl: null, scroll: { top: 0, left: 0 } }; controller.reconcile(); },
    replaceState() { state = structuredClone(state); controller.reconcile(); },
    replaceDataWindow() { dataWindow = { ...window }; },
    dispose() { alive = false; controller.dispose(); },
  };
}
const execute = (fixture, name, target, payload = {}) => fixture.controller.handlers[`widgets.${name}`](target, payload);

test('mutating a submitted target while native preparation waits cannot redirect removal to another widget', async () => {
  const f = fixture(), [original, other] = f.state.instances;
  const sources = f.state.sources, sourceRows = [...sources.events, ...sources.reminders];
  const target = { centerId: f.pane.centerId, widgetId: original.id }, waiting = f.pause();
  const pending = execute(f, 'remove', target);
  await waiting.entered; target.widgetId = other.id; waiting.release();
  expect((await pending).status).toBe('applied');
  expect(f.state.instances.includes(original)).toBe(false);
  expect(f.state.instances.includes(other)).toBe(true);
  expect(f.state.sources).toBe(sources);
  expect([...f.state.sources.events, ...f.state.sources.reminders]).toEqual(sourceRows);
});

test('submitted configuration arrays retain their original literal intent across native awaits', async () => {
  const f = fixture(), widget = f.state.instances.find(row => row.kind === 'calendar');
  const payload = { configuration: { calendarIds: [f.state.sources.calendars[0].id] } }, expected = [...payload.configuration.calendarIds];
  const waiting = f.pause(), pending = execute(f, 'configure', { centerId: f.pane.centerId, widgetId: widget.id }, payload);
  await waiting.entered; payload.configuration.calendarIds.length = 0; waiting.release();
  expect((await pending).status).toBe('applied');
  expect(widget.configuration.calendarIds).toEqual(expected);
});

for (const interruption of ['foreground cycle', 'replacement center with reused label', 'replacement canonical Root', 'disposal']) {
  test(`pending widget mutation never borrows ownership after ${interruption}`, async () => {
    const f = fixture(), original = f.state, before = structuredClone(original), waiting = f.pause();
    const pending = execute(f, 'remove', { centerId: f.pane.centerId, widgetId: original.instances[0].id });
    await waiting.entered;
    if (interruption === 'foreground cycle') { f.setAvailable(false); f.setAvailable(true); }
    else if (interruption === 'replacement center with reused label') f.replacePane();
    else if (interruption === 'replacement canonical Root') f.replaceState();
    else f.dispose();
    waiting.release();
    expect((await pending).status).toBe('rejected');
    expect(original).toEqual(before);
    expect(f.state).toEqual(before);
  });
}

test('source changes during native preparation cannot complete an unrelated or edited reminder', async () => {
  const f = fixture(), widget = f.state.instances.find(row => row.kind === 'reminders');
  const reminder = f.state.sources.reminders.find(row => row.listId === widget.configuration.listId && !row.completed);
  const waiting = f.pause(), pending = execute(f, 'reminder.setCompleted', { centerId: f.pane.centerId, widgetId: widget.id, reminderId: reminder.id }, { completed: true });
  await waiting.entered; reminder.title = 'User edited this reminder'; waiting.release();
  expect((await pending).status).toBe('rejected');
  expect(reminder.completed).toBe(false);
  expect(reminder.title).toBe('User edited this reminder');
});

test('a replaced ordinary Reminders window cannot inherit an in-flight checklist action', async () => {
  const f = fixture(), listId = f.state.selected.reminderListId;
  const reminder = f.state.sources.reminders.find(row => row.listId === listId && !row.completed), before = structuredClone(f.state);
  const waiting = f.pause(), pending = execute(f, 'data.reminder.setCompleted', { windowId: f.window.id, reminderId: reminder.id }, { completed: true });
  await waiting.entered; f.replaceDataWindow(); waiting.release();
  expect((await pending).status).toBe('rejected');
  expect(f.state).toEqual(before);
});

test('actor getters and sparse configuration input reject without evaluation or canonical mutation', async () => {
  const f = fixture(), before = structuredClone(f.state); let reads = 0;
  const target = { centerId: f.pane.centerId };
  Object.defineProperty(target, 'widgetId', { enumerable: true, get() { reads++; throw new Error('Actor getter ran'); } });
  expect((await execute(f, 'remove', target)).error.code).toBe('invalid_arguments');
  const widget = f.state.instances.find(row => row.kind === 'calendar'), sparse = []; sparse.length = 1;
  expect((await execute(f, 'configure', { centerId: f.pane.centerId, widgetId: widget.id }, { configuration: { calendarIds: sparse } })).error.code).toBe('invalid_arguments');
  expect(reads).toBe(0);
  expect(f.state).toEqual(before);
});

for (const profileId of ['macos-mojave-10.14', 'macos-high-sierra-10.13', 'macos-sonoma-14.0', 'windows11-23h2-22631.2428']) {
  test(`historical ${profileId} rejects widget mutations before inspecting actor input`, async () => {
    const f = fixture(); f.profile = getOSProfile(profileId);
    let reads = 0;
    const controller = createNotificationWidgetCommands({ profile: f.profile, getState: () => f.state, getUi: () => ({}), alive: () => true });
    const target = {};
    Object.defineProperty(target, 'centerId', { enumerable: true, get() { reads++; throw new Error('Foreign getter'); } });
    const before = structuredClone(f.state);
    expect((await controller.handlers['widgets.remove'](target, {})).error.code).toBe('unsupported_profile');
    expect(reads).toBe(0);
    expect(f.state).toEqual(before);
  });
}

test('retiring presentation after a widget data commit cannot falsely reject the completed change', async () => {
  const f = fixture(), widget = f.state.instances.find(row => row.kind === 'weather'), waiting = f.pauseSettlement();
  const pending = execute(f, 'resize', { centerId: f.pane.centerId, widgetId: widget.id }, { size: 'large' });
  await waiting.entered;
  expect(widget.size).toBe('large');
  f.dispose(); waiting.release();
  const result = await pending;
  expect(result.status).toBe('applied');
  expect(result.target.widgetId).toBe(widget.id);
  expect(f.state.instances.find(row => row.id === widget.id)).toBe(widget);
  expect(widget.size).toBe('large');
});
