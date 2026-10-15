import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, object, empty, identity, flag, choice } from './command-schema.js';
import {
  widgetKinds, widgetCatalog, widgetCategories, widgetConfigurationSchema, validateWidgetsState,
  addWidget, removeWidget, resizeWidget, reorderWidget, configureWidget,
  selectWidgetData,
} from './notification-widget-model.js';

const fields = (value, required, optional = []) => isRecord(value)
  && Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && (required.includes(key) || optional.includes(key))
      && descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  }) && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0;
const offset = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const offsets = value => fields(value, ['top', 'left']) && offset(value.top) && offset(value.left);
const paneTarget = (target, required = [], optional = []) => fields(target, ['centerId', ...required], optional)
  && ['centerId', ...required].every(key => id(target[key]));
const applied = target => ({ status: 'applied', target });
const fail = code => rejected(code, code === 'unsupported_profile' ? 'Only current Golden Gate supports Notification Center widgets.'
  : code === 'invalid_arguments' ? 'Use the closed documented widget target and literal payload.'
    : code === 'stale_target' ? 'The original widget, source record, editor, window or Root has retired.'
      : 'The original foreground widget control is unavailable.');
const sameDescriptor = (a, b) => a && b && a.enumerable === b.enumerable && a.configurable === b.configurable
  && a.writable === b.writable && a.value === b.value && a.get === b.get && a.set === b.set;

// Freeze the caller's literal intent before the first native await. Validation
// uses descriptors, never invoking an actor's getters or reading sparse slots.
function copyLiteral(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.length <= 256) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) throw new TypeError('Invalid literal widget input.');
  const list = Array.isArray(value);
  if (list ? Object.getPrototypeOf(value) !== Array.prototype : !isRecord(value)) throw new TypeError('Expected plain widget input.');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  const length = list ? descriptors.length?.value : null;
  if (list && (!Number.isSafeInteger(length) || length < 0 || length > 64 || keys.length !== length + 1)
    || !list && keys.length > 32) throw new TypeError('Widget input exceeds its closed bounds.');
  const result = list ? [] : {};
  seen.add(value);
  for (const key of keys) {
    if (list && key === 'length') continue;
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
      || list && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) throw new TypeError('Expected closed data properties.');
    Object.defineProperty(result, key, { value: copyLiteral(descriptor.value, seen, depth + 1), writable: true, enumerable: true, configurable: true });
  }
  seen.delete(value);
  return result;
}

// Only traversed after descriptor-only validation. Materialize Svelte's lazy
// references before snapshots; a quota read must not manufacture false staleness.
function retainData(state) {
  const materialize = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of Reflect.ownKeys(value)) if (key !== 'length') materialize(value[key]);
  };
  materialize(state);
  const snapshots = [];
  const capture = value => {
    if (!value || typeof value !== 'object') return;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    snapshots.push({ value, descriptors, prototype: Object.getPrototypeOf(value) });
    for (const key of Reflect.ownKeys(descriptors)) if (key !== 'length') capture(descriptors[key].value);
  };
  capture(state);
  return () => {
    try {
      return snapshots.every(({ value, descriptors, prototype }) => Object.getPrototypeOf(value) === prototype
        && Reflect.ownKeys(value).length === Reflect.ownKeys(descriptors).length
        && Reflect.ownKeys(descriptors).every(key => sameDescriptor(Object.getOwnPropertyDescriptor(value, key), descriptors[key])));
    } catch { return false; }
  };
}

/** Source records persist; native editor/context/configuration are Root-local. */
export function createNotificationWidgetCommands(ctx) {
  const state = ctx.getState(), ui = ctx.getUi(), namespace = ctx.namespace ?? crypto.randomUUID();
  let ownerCenter = null, epoch = 0, revision = 0, sequence = 0, disposed = false, wasAvailable = false;
  const supported = () => ctx.profile.id === 'macos-golden-gate-27.0.1'
    && ctx.profile.capabilities?.includes('shell.notification-widgets') === true;
  const projections = () => ({ ...ctx.getCalendarWidgetProjection(), ...ctx.getReminderWidgetProjection() });
  function alive() {
    try { return !disposed && supported() && ctx.alive() === true && ctx.getState() === state && ctx.getUi() === ui; }
    catch { return false; }
  }
  function available() {
    let current = false;
    try { current = alive() && ctx.available() === true; } catch { /* A missing foreground never authorizes work. */ }
    if (current !== wasAvailable) { wasAvailable = current; revision++; }
    return current;
  }
  function clearUi() { ui.editor = null; ui.contextWidgetId = null; ui.editingWidgetId = null; ui.scrolls = {}; }
  function reconcile() {
    if (!alive()) { if (!disposed) { disposed = true; epoch++; revision++; clearUi(); ownerCenter = null; } return; }
    const center = ctx.getCenter();
    if (center !== ownerCenter) { epoch++; revision++; clearUi(); ownerCenter = center; }
    available();
    if (ui.editor && ui.editor.centerId !== center?.centerId) ui.editor = null;
    if (!state.instances.some(widget => widget.id === ui.contextWidgetId)) ui.contextWidgetId = null;
    if (!state.instances.some(widget => widget.id === ui.editingWidgetId)) ui.editingWidgetId = null;
    for (const widgetId of Object.keys(ui.scrolls ?? {})) if (!state.instances.some(widget => widget.id === widgetId)) delete ui.scrolls[widgetId];
  }
  function center(target) {
    reconcile();
    return ownerCenter?.centerId === target.centerId ? ownerCenter : null;
  }
  function lease(pane) {
    const generation = epoch, version = ++revision;
    return () => alive() && epoch === generation && version === revision && ctx.getCenter() === pane
      && ownerCenter === pane && available() && epoch === generation && version === revision;
  }
  const failure = pane => fail(alive() && ctx.getCenter() === pane ? 'unavailable' : 'stale_target');
  async function native(call) { try { return await call(); } catch { return null; } }
  async function settle() { try { await ctx.settle(); return true; } catch { return false; } }
  const currentView = editor => editor ? ctx.getEditorView(editor.editorId) : ctx.getCenterView();
  const live = (view, guard, editor = null) => guard() && currentView(editor) === view
    && view?.available() === true && guard() && currentView(editor) === view;
  const describe = view => { try { return view.describe(); } catch { return null; } };
  const controls = view => describe(view)?.controlIds ?? [];
  async function prepare(view, controlId, guard, editor = null) {
    return live(view, guard, editor) && await native(() => view.prepare(controlId, guard)) === true
      && live(view, guard, editor) && controls(view).includes(controlId);
  }
  async function focus(view, controlId, guard, editor = null) {
    return await prepare(view, controlId, guard, editor) && await native(() => view.focus(controlId, guard)) === true
      && live(view, guard, editor) && describe(view)?.focusedControl === controlId;
  }
  function observe(view, editor = null) {
    const actual = describe(view); if (!actual) return;
    if (editor) {
      editor.focusedControl = actual.focusedControl ?? null;
      if (offsets(actual.scroll)) editor.scroll = { ...actual.scroll };
    } else if (ownerCenter) {
      ownerCenter.focusedControl = actual.focusedControl ?? null;
      if (offsets(actual.scroll)) ownerCenter.scroll = { ...actual.scroll };
      for (const entry of actual.widgetScrolls ?? []) if (id(entry.widgetId) && offsets({ top: entry.top, left: entry.left })) {
        const previous = ui.scrolls?.[entry.widgetId];
        if (previous?.top !== entry.top || previous?.left !== entry.left)
          ui.scrolls[entry.widgetId] = { top: entry.top, left: entry.left };
      }
    }
  }
  function dataOwner() {
    return validateWidgetsState(state, ctx.profile).ok ? retainData(state) : null;
  }
  function widgetOwner(widgetId) {
    const owner = dataOwner(), widget = owner && state.instances.find(entry => entry.id === widgetId);
    return widget ? { widget, current: () => owner() && state.instances.includes(widget) } : null;
  }
  const card = widgetId => `widget:${widgetId}:card`;
  function quota(guard) {
    return delta => guard() && ctx.canCommit(delta) === true && guard();
  }
  async function withWidget(target, controlId, action) {
    const pane = center(target); if (!pane) return fail('stale_target');
    if (!available()) return fail('unavailable');
    const owner = widgetOwner(target.widgetId); if (!owner) return fail('stale_target');
    const base = lease(pane), guard = () => base() && owner.current(), view = currentView(null);
    if (!await prepare(view, controlId ?? card(target.widgetId), guard)) return failure(pane);
    return action({ pane, widget: owner.widget, view, base, guard });
  }
  async function mutateWidget(target, mutate, controlId = null, removing = false) {
    return withWidget(target, controlId, async ({ pane, widget, view, guard, base }) => {
      const focused = describe(view)?.focusedControl;
      const recover = removing && focused?.startsWith(`widget:${widget.id}:`);
      // Retire a focused node only after focusing its original surviving center.
      if (recover && !await focus(view, 'center', guard)) return failure(pane);
      const result = mutate(quota(guard));
      if (result.status !== 'applied') return result;
      if (await settle() && live(view, base)) {
        if (!recover && focused && controls(view).includes(focused) && describe(view)?.focusedControl !== focused)
          await focus(view, focused, base);
        if (live(view, base)) observe(view);
      }
      reconcile();
      return applied({ centerId: pane.centerId, ...result.target });
    });
  }
  async function changeWidgetUi(target, field, opening) {
    return withWidget(target, null, async ({ pane, widget, view, base, guard }) => {
      if (field === 'editingWidgetId' && widget.kind === 'date') return fail('invalid_arguments');
      if (!opening && ui[field] !== widget.id) return fail('stale_target');
      if (!await focus(view, 'center', guard)) return failure(pane);
      ui[field] = opening ? widget.id : null;
      if (opening) ui[field === 'editingWidgetId' ? 'contextWidgetId' : 'editingWidgetId'] = null;
      if (!await settle() || !live(view, base)) return failure(pane);
      const requested = opening ? `widget:${widget.id}:${field === 'editingWidgetId' ? 'done' : 'menu-close'}` : card(widget.id);
      if (!await focus(view, requested, base)) return failure(pane);
      observe(view);
      return applied({ centerId: pane.centerId, widgetId: widget.id,
        [field === 'editingWidgetId' ? 'editing' : 'open']: opening });
    });
  }
  function editorOwner(target) {
    const pane = center(target), editor = ui.editor;
    return pane && editor?.editorId === target.editorId && editor.centerId === pane.centerId ? { pane, editor } : null;
  }
  async function changeEditor(target, controlId, mutate, commitsData = false) {
    const original = editorOwner(target); if (!original) return fail('stale_target');
    const { pane, editor } = original, base = lease(pane), guard = () => base() && ui.editor === editor;
    const view = currentView(editor);
    const requestedControl = controlId.startsWith('category:') && !controls(view).includes(controlId) ? 'categories' : controlId;
    if (!await prepare(view, requestedControl, guard, editor)) return failure(pane);
    const result = mutate({ pane, editor, guard }); if (result.status !== 'applied') return result;
    if (!await settle() || !await focus(view, requestedControl === 'search' || requestedControl === 'categories' ? requestedControl : 'editor', guard, editor))
      return commitsData ? applied({ centerId: pane.centerId, editorId: editor.editorId, ...result.target }) : failure(pane);
    observe(view, editor);
    return applied({ centerId: pane.centerId, editorId: editor.editorId, ...result.target });
  }
  const raw = {
    'widgets.editor.open': async (target, payload) => {
      if (!paneTarget(target) || !fields(payload, [])) return fail('invalid_arguments');
      const pane = center(target); if (!pane) return fail('stale_target');
      const base = lease(pane), originalView = currentView(null);
      if (!await prepare(originalView, 'edit-widgets', base)) return failure(pane);
      let editor = ui.editor; const reused = editor !== null;
      if (!editor) {
        ui.editor = { editorId: `${namespace}-widget-editor-${++sequence}`, centerId: pane.centerId,
          query: '', category: 'all', focusedControl: null, scroll: { top: 0, left: 0 } };
        editor = ui.editor;
      }
      const guard = () => base() && ui.editor === editor;
      const view = await settle() && guard() ? currentView(editor) : null;
      if (!view || !await focus(view, 'search', guard, editor)) {
        if (!reused && ui.editor === editor) ui.editor = null;
        return failure(pane);
      }
      observe(view, editor);
      return applied({ centerId: pane.centerId, editorId: editor.editorId, reused });
    },
    'widgets.editor.close': async (target, payload) => {
      if (!paneTarget(target, ['editorId']) || !fields(payload, [])) return fail('invalid_arguments');
      const original = editorOwner(target); if (!original) return fail('stale_target');
      const { pane, editor } = original, base = lease(pane), guard = () => base() && ui.editor === editor;
      const view = currentView(editor), centerView = currentView(null);
      if (!await prepare(view, 'done', guard, editor) || !await focus(centerView, 'edit-widgets', guard)) return failure(pane);
      ui.editor = null; ui.editingWidgetId = null; ui.contextWidgetId = null;
      if (!await settle() || !live(centerView, base)) return failure(pane);
      observe(centerView);
      return applied({ centerId: pane.centerId, editorId: editor.editorId, closed: true });
    },
    'widgets.editor.search': (target, payload) => {
      if (!paneTarget(target, ['editorId']) || !fields(payload, ['query']) || typeof payload.query !== 'string' || payload.query.length > 256)
        return fail('invalid_arguments');
      const query = payload.query;
      return changeEditor(target, 'search', ({ editor }) => { editor.query = query; editor.scroll = { top: 0, left: 0 }; return applied({ query }); });
    },
    'widgets.editor.category': (target, payload) => {
      if (!paneTarget(target, ['editorId']) || !fields(payload, ['category']) || !widgetCategories.includes(payload.category)) return fail('invalid_arguments');
      const category = payload.category;
      return changeEditor(target, `category:${category}`, ({ editor }) => { editor.category = category; editor.scroll = { top: 0, left: 0 }; return applied({ category }); });
    },
    'widgets.add': (target, payload) => {
      if (!paneTarget(target, ['editorId']) || !fields(payload, ['kind', 'size']) || !widgetKinds.includes(payload.kind)
        || !widgetCatalog.find(row => row.kind === payload.kind)?.sizes.includes(payload.size)) return fail('invalid_arguments');
      const { kind, size } = payload;
      return changeEditor(target, `add:${kind}:${size}`, ({ guard }) => addWidget(state, kind, size, quota(guard), projections()), true);
    },
    'widgets.remove': (target, payload) => {
      if (!paneTarget(target, ['widgetId']) || !fields(payload, [])) return fail('invalid_arguments');
      return mutateWidget(target, budget => removeWidget(state, target.widgetId, budget), null, true);
    },
    'widgets.resize': (target, payload) => {
      if (!paneTarget(target, ['widgetId']) || !fields(payload, ['size']) || !['small', 'medium', 'large'].includes(payload.size)) return fail('invalid_arguments');
      const size = payload.size;
      return mutateWidget(target, budget => resizeWidget(state, target.widgetId, size, budget));
    },
    'widgets.reorder': (target, payload) => {
      if (!paneTarget(target, ['widgetId']) || !fields(payload, ['index']) || !Number.isSafeInteger(payload.index) || payload.index < 0 || payload.index >= 64)
        return fail('invalid_arguments');
      const index = payload.index;
      return mutateWidget(target, budget => reorderWidget(state, target.widgetId, index, budget));
    },
    'widgets.configure': (target, payload) => {
      if (!paneTarget(target, ['widgetId']) || !fields(payload, ['configuration']) || !isRecord(payload.configuration)) return fail('invalid_arguments');
      const configuration = payload.configuration;
      return mutateWidget(target, budget => configureWidget(state, target.widgetId, configuration, budget, projections()));
    },
    ...Object.fromEntries([['edit', 'editingWidgetId'], ['context', 'contextWidgetId']].flatMap(([name, field]) => [true, false].map(opening => [
      `widgets.${name}.${opening ? 'open' : 'close'}`, (target, payload) => {
        if (!paneTarget(target, ['widgetId']) || !fields(payload, [])) return fail('invalid_arguments');
        return changeWidgetUi(target, field, opening);
      },
    ]))),
    'widgets.open': (target, payload) => {
      if (!paneTarget(target, ['widgetId'], ['recordId']) || Object.hasOwn(target, 'recordId') && !id(target.recordId) || !fields(payload, []))
        return fail('invalid_arguments');
      const recordId = target.recordId ?? null;
      const originalWidget = state.instances.find(widget => widget.id === target.widgetId);
      const getter = originalWidget?.kind === 'calendar' ? ctx.getCalendar
        : originalWidget?.kind === 'reminders' ? ctx.getReminders : null;
      if (['calendar', 'reminders'].includes(originalWidget?.kind) && typeof getter !== 'function') return fail('unavailable');
      const domain = getter?.(), rowsKey = originalWidget?.kind === 'calendar' ? 'events' : 'tasks';
      const source = getter && recordId !== null ? domain[rowsKey].find(row => row.id === recordId) : null;
      if (getter && recordId !== null && !source) return fail('stale_target');
      const unchanged = source ? retainData(source) : () => true;
      const sourceCurrent = () => !getter || getter() === domain && (!source || domain[rowsKey].includes(source) && unchanged());
      return withWidget(target, `widget:${target.widgetId}:open${recordId ? `:${recordId}` : ''}`, async ({ pane, widget, guard: widgetGuard, base }) => {
        const guard = () => widgetGuard() && sourceCurrent();
        if (!guard()) return fail('stale_target');
        // Resolve and budget the exact source before any application activation.
        const candidate = { ...state, selected: { ...state.selected, clockCityIds: [...state.selected.clockCityIds] } };
        const selection = selectWidgetData(candidate, widget.id, recordId, quota(guard), projections());
        if (selection.status !== 'applied') return selection;
        const result = await native(() => ctx.openData(selection.target, guard,
          () => selectWidgetData(state, widget.id, recordId, quota(guard), projections())));
        if (!result || result.status !== 'applied') return result?.status === 'rejected' ? result : failure(pane);
        if (base()) { ctx.closeCenter(pane); reconcile(); }
        return applied({ ...selection.target, windowId: result.target.windowId });
      });
    },
    'widgets.reminder.setCompleted': (target, payload) => {
      if (!paneTarget(target, ['widgetId', 'reminderId']) || !fields(payload, ['completed']) || typeof payload.completed !== 'boolean') return fail('invalid_arguments');
      const completed = payload.completed, domain = ctx.getReminders();
      const reminder = domain.tasks.find(row => row.id === target.reminderId), revision = reminder?.revision;
      if (!reminder) return fail('stale_target');
      const unchangedTask = retainData(reminder);
      return withWidget(target, `widget:${target.widgetId}:reminder:${target.reminderId}`, async ({ pane, widget, view, guard, base }) => {
        if (widget.kind !== 'reminders' || ctx.getReminders() !== domain || !domain.tasks.includes(reminder)
          || reminder.revision !== revision || !unchangedTask() || reminder.listId !== widget.configuration.listId) return fail('stale_target');
        const sourceGuard = () => guard() && ctx.getReminders() === domain && domain.tasks.includes(reminder)
          && reminder.revision === revision && unchangedTask() && reminder.listId === widget.configuration.listId;
        if (!await focus(view, 'center', sourceGuard)) return failure(pane);
        const result = await native(() => ctx.setReminderCompleted(reminder.id, completed, { guard: sourceGuard }));
        if (result?.status !== 'applied') return result?.status === 'rejected' ? result : fail('unavailable');
        if (await settle() && live(view, base)) observe(view);
        return applied({ centerId: pane.centerId, widgetId: widget.id, reminderId: reminder.id, completed: reminder.completed });
      });
    },
    'widgets.focus': async (target, payload) => {
      if (!paneTarget(target, ['controlId'], ['editorId']) || Object.hasOwn(target, 'editorId') && !id(target.editorId) || !fields(payload, [])) return fail('invalid_arguments');
      const pane = center(target), editor = target.editorId ? ui.editor : null;
      if (!pane || target.editorId && editor?.editorId !== target.editorId) return fail('stale_target');
      const base = lease(pane), owner = dataOwner(); if (!owner) return fail('invalid_arguments');
      const guard = () => base() && owner() && (!editor || ui.editor === editor), view = currentView(editor);
      if (!await focus(view, target.controlId, guard, editor)) return failure(pane);
      observe(view, editor); return applied({ centerId: pane.centerId, controlId: target.controlId, ...(editor ? { editorId: editor.editorId } : {}) });
    },
    'widgets.scroll': async (target, payload) => {
      if (!paneTarget(target, [], ['editorId', 'widgetId']) || Object.hasOwn(target, 'editorId') && !id(target.editorId)
        || Object.hasOwn(target, 'widgetId') && !id(target.widgetId) || target.editorId && target.widgetId || !offsets(payload)) return fail('invalid_arguments');
      const pane = center(target), editor = target.editorId ? ui.editor : null;
      if (!pane || target.editorId && editor?.editorId !== target.editorId) return fail('stale_target');
      const owner = target.widgetId ? widgetOwner(target.widgetId) : null;
      if (target.widgetId && !owner) return fail('stale_target');
      const base = lease(pane), guard = () => base() && (!editor || ui.editor === editor) && (!owner || owner.current()), view = currentView(editor);
      const requested = { top: payload.top, left: payload.left };
      if (!await prepare(view, editor ? 'editor' : owner ? card(target.widgetId) : 'center', guard, editor)) return failure(pane);
      const result = await native(() => owner ? view.scrollWidget(target.widgetId, requested, guard) : view.scroll(requested, guard));
      const description = live(view, guard, editor) ? describe(view) : null;
      const record = owner ? description?.widgetScrolls?.find(row => row.widgetId === target.widgetId) : null;
      const actual = owner ? record ? { top: record.top, left: record.left } : null : description?.scroll;
      if (!offsets(result) || !offsets(actual) || result.top !== actual.top || result.left !== actual.left) return failure(pane);
      observe(view, editor); return applied({ centerId: pane.centerId, ...(editor ? { editorId: editor.editorId } : {}),
        ...(owner ? { widgetId: target.widgetId } : {}), ...actual });
    },
    'widgets.data.focus': async (target, payload) => {
      if (!fields(target, ['windowId', 'controlId']) || !id(target.windowId) || !id(target.controlId) || !fields(payload, [])) return fail('invalid_arguments');
      return withData(target, target.controlId, async ({ owner, view, guard }) => {
        if (await native(() => view.focus(target.controlId, guard)) !== true || !dataLive(owner, view, guard)
          || describe(view)?.focusedControl !== target.controlId) return fail('unavailable');
        return applied({ windowId: owner.windowId, controlId: target.controlId });
      });
    },
    'widgets.data.scroll': async (target, payload) => {
      if (!fields(target, ['windowId']) || !id(target.windowId) || !offsets(payload)) return fail('invalid_arguments');
      const requested = { top: payload.top, left: payload.left };
      return withData(target, 'panel', async ({ owner, view, guard }) => {
        const result = await native(() => view.scroll(requested, guard)), actual = dataLive(owner, view, guard) ? describe(view)?.scroll : null;
        if (!offsets(result) || !offsets(actual) || result.top !== actual.top || result.left !== actual.left) return fail('unavailable');
        return applied({ windowId: owner.windowId, ...actual });
      });
    },
  };
  function dataLive(owner, view, guard) {
    return guard() && ctx.getDataOwner(owner.windowId)?.window === owner.window && ctx.getDataView(owner.windowId) === view
      && view?.available() === true && guard();
  }
  async function withData(target, controlId, action) {
    reconcile(); if (!available()) return fail('unavailable');
    const owner = ctx.getDataOwner(target.windowId), retained = dataOwner();
    if (!owner || !retained) return fail('stale_target');
    const generation = epoch, version = ++revision;
    const base = () => alive() && available() && epoch === generation && revision === version
      && ctx.getDataOwner(target.windowId)?.window === owner.window;
    const guard = () => base() && retained(), view = ctx.getDataView(target.windowId);
    if (!dataLive(owner, view, guard) || await native(() => view.prepare(controlId, guard)) !== true
      || !dataLive(owner, view, guard) || !controls(view).includes(controlId)) return fail('unavailable');
    return action({ owner, view, guard, base });
  }
  const handlers = Object.fromEntries(Object.entries(raw).map(([name, handler]) => [name, async (target, payload) => {
    if (!supported()) return fail('unsupported_profile');
    try { return await handler(copyLiteral(target), copyLiteral(payload)); } catch { return fail('invalid_arguments'); }
  }]));
  function summary() {
    reconcile(); const editor = ui.editor;
    const centerView = ownerCenter && available() ? currentView(null) : null;
    if (centerView?.available() === true) observe(centerView);
    const view = editor && available() ? currentView(editor) : null;
    if (view?.available() === true) observe(view, editor);
    return { centerId: ownerCenter?.centerId ?? null,
      editor: editor ? { ...editor, scroll: { ...editor.scroll }, focusedControl: view?.available() === true ? editor.focusedControl : null } : null,
      contextWidgetId: ui.contextWidgetId, editingWidgetId: ui.editingWidgetId,
      focusedControl: centerView?.available() === true ? describe(centerView)?.focusedControl ?? null : null,
      widgetScrolls: Object.entries(ui.scrolls ?? {}).map(([widgetId, scroll]) => ({ widgetId, ...scroll })) };
  }
  return { handlers, reconcile, summary,
    targets() {
      const presentation = summary(), view = ownerCenter && available() ? currentView(null) : null;
      const editorView = ui.editor && available() ? currentView(ui.editor) : null;
      return { ...presentation, kinds: widgetCatalog.map(row => ({ ...row, sizes: [...row.sizes] })),
        widgets: state.instances.map((widget, index) => ({ widgetId: widget.id, kind: widget.kind, size: widget.size,
          index, configuration: copyLiteral(widget.configuration) })),
        controlIds: view?.available() === true ? controls(view).filter(value => value === 'edit-widgets' || value.startsWith('widget:')) : [],
        editorControlIds: editorView?.available() === true ? controls(editorView) : [],
        dataWindows: ctx.getDataTargets?.() ?? [] };
    },
    clear() { if (!disposed) { epoch++; revision++; clearUi(); } },
    dispose() { if (!disposed) { epoch++; revision++; clearUi(); ownerCenter = null; disposed = true; } },
  };
}

const profiles = ['macos-golden-gate-27.0.1'], capability = 'shell.notification-widgets';
const centerTarget = object({ centerId: identity }), editorTarget = object({ centerId: identity, editorId: identity });
const widgetTarget = object({ centerId: identity, widgetId: identity }), windowTarget = object({ windowId: identity });
const nullableId = { anyOf: [identity, { type: 'null' }] };
const position = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const scrollPayload = object({ top: position, left: position });
const catalogue = (name, target, payload, result, data = []) => defineCommand(profiles, `widgets.${name}`, capability, target, payload,
  ['original foreground Golden Root and native center/editor/widget/source or ordinary app window'],
  ['scene-derived widgets and native gallery/configuration/context/detail with retained focus and achieved scroll'], data, [],
  result.oneOf ? result : object(result, name === 'focus' ? Object.keys(result).filter(key => key !== 'editorId') : Object.keys(result)));
export const notificationWidgetCatalog = Object.fromEntries([
  catalogue('editor.open', centerTarget, empty, { centerId: identity, editorId: identity, reused: flag }),
  catalogue('editor.close', editorTarget, empty, { centerId: identity, editorId: identity, closed: { const: true } }),
  catalogue('editor.search', editorTarget, object({ query: { type: 'string', maxLength: 256 } }), { centerId: identity, editorId: identity, query: { type: 'string', maxLength: 256 } }),
  catalogue('editor.category', editorTarget, object({ category: choice(...widgetCategories) }), { centerId: identity, editorId: identity, category: choice(...widgetCategories) }),
  catalogue('add', editorTarget, object({ kind: choice(...widgetKinds), size: choice('small', 'medium', 'large') }),
    { centerId: identity, editorId: identity, widgetId: identity, kind: choice(...widgetKinds), size: choice('small', 'medium', 'large'), index: { type: 'integer', minimum: 0, maximum: 63 } }, ['allocate one canonical widget without reusing IDs']),
  catalogue('remove', widgetTarget, empty, { centerId: identity, widgetId: identity, removed: { const: true } }, ['remove only the original instance; preserve sources and nextId']),
  catalogue('resize', widgetTarget, object({ size: choice('small', 'medium', 'large') }), { centerId: identity, widgetId: identity, size: choice('small', 'medium', 'large') }, ['change supported widget size']),
  catalogue('reorder', widgetTarget, object({ index: { type: 'integer', minimum: 0, maximum: 63 } }), { centerId: identity, widgetId: identity, index: { type: 'integer', minimum: 0, maximum: 63 } }, ['reorder original instances without changing identity/data']),
  catalogue('configure', widgetTarget, object({ configuration: widgetConfigurationSchema }), { centerId: identity, widgetId: identity, configuration: widgetConfigurationSchema }, ['configure linked canonical source choices']),
  ...['edit', 'context'].flatMap(name => [true, false].map(opening => catalogue(`${name}.${opening ? 'open' : 'close'}`, widgetTarget, empty,
    { centerId: identity, widgetId: identity, [name === 'edit' ? 'editing' : 'open']: flag }))),
  catalogue('open', object({ centerId: identity, widgetId: identity, recordId: identity }, ['centerId', 'widgetId']), empty,
    { widgetId: identity, appId: identity, windowId: identity, recordId: nullableId }, ['select the original canonical source in its ordinary app and retire the center only on successful native preparation']),
  catalogue('reminder.setCompleted', object({ centerId: identity, widgetId: identity, reminderId: identity }), object({ completed: flag }),
    { centerId: identity, widgetId: identity, reminderId: identity, completed: flag }, ['complete/uncomplete the shared canonical reminder, not a widget copy']),
  catalogue('focus', object({ centerId: identity, controlId: identity, editorId: identity }, ['centerId', 'controlId']), empty,
    { centerId: identity, controlId: identity, editorId: identity }),
  catalogue('scroll', { oneOf: [centerTarget, editorTarget, widgetTarget] }, scrollPayload,
    { oneOf: [object({ centerId: identity, top: position, left: position }),
      object({ centerId: identity, editorId: identity, top: position, left: position }),
      object({ centerId: identity, widgetId: identity, top: position, left: position })] }),
  catalogue('data.focus', object({ windowId: identity, controlId: identity }), empty, { windowId: identity, controlId: identity }),
  catalogue('data.scroll', windowTarget, scrollPayload, { windowId: identity, top: position, left: position }),
]);
