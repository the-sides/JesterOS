import { expect, test } from 'bun:test';
import { createServiceCommands } from '../frontend/src/service-commands.js';
import { communicationEntry } from '../frontend/src/communication-state.js';
import { createDefaultSceneSeed } from '../frontend/src/scene-seed.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { updateNote } from '../frontend/src/notes-state.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const sourceWindowId = 'notes-window-2';

// A document/provider consumer of the real controllers and record reducers.
// The native bridge can lose focus/ownership or let another actor edit a source.
function consumer() {
  const seed = createDefaultSceneSeed(profile), notes = seed.notes, state = seed.communications;
  let activeAppId = 'notes', activeWindowId = sourceWindowId, focus = 'title', selected = null;
  let hook, focusFailure = false, capacity = true, sequence = 0;
  const ui = { lookup: null, context: null };
  const fieldValue = (note, control) => {
    const split = note.text.indexOf('\n');
    return control === 'title' ? split < 0 ? note.text : note.text.slice(0, split) : split < 0 ? '' : note.text.slice(split + 1);
  };
  const current = source => {
    if (source.kind === 'contact') return state.selected.contacts === source.contact.id && state.contacts.some(record => record.id === source.contact.id);
    const note = notes.notes.find(note => note.id === source.noteId);
    return Boolean(note && notes.selectedId === source.noteId && note.updatedAt === source.revision && fieldValue(note, source.control) === source.value);
  };
  const owns = source => activeAppId === source.appId && activeWindowId === source.windowId;
  const node = field => ({ dataset: { serviceEntryId: state.selected[activeAppId] }, value: communicationEntry(state, activeAppId)?.fields[field] });
  const view = { prepare: async () => true, focus: async control => { focus = control; await hook?.(); return !focusFailure; },
    fieldNode: node, describe: () => ({ controlIds: ['panel', 'name', 'email', 'phone', 'notes', 'to', 'subject', 'body'], focusedControl: focus }),
    scroll: () => ({ top: 0, left: 0 }) };
  const lookupView = { prepare: async () => true, focus: async control => { focus = control; return true; }, describe: () => ({ focusedControl: focus }) };
  const contextView = { prepare: async () => true, focus: async control => { focus = control; return true; }, describe: () => ({ focusedControl: focus }) };
  function getSource(sourceId) {
    if (activeAppId === 'contacts' && state.contacts.some(record => record.id === state.selected.contacts)) {
      const contact = communicationEntry(state, 'contacts');
      const source = { sourceId: `contact:${contact.id}`, kind: 'contact', appId: 'contacts', windowId: activeWindowId, contact };
      if (sourceId === undefined || sourceId === source.sourceId) return source;
    }
    return selected && owns(selected) && current(selected) && (sourceId === undefined || sourceId === selected.sourceId) ? selected : null;
  }
  const services = createServiceCommands(state, {
    profile, notes, clipboard: { kind: 'empty', text: '', fileIds: [] }, ui, namespace: () => 'consumer-', available: () => true,
    getSceneTime: () => seed.files.sceneTime,
    onTimeChanged: time => { seed.files.sceneTime = Math.max(seed.files.sceneTime, time); },
    getSource, sourceCurrent: current, ownsSourcePresentation: owns,
    captureReturn: () => ({ focus }), restoreReturn: async snapshot => { focus = snapshot.focus; }, settle: async () => {},
    getLookupView: () => lookupView, getContextView: () => contextView,
    getProvider: windowId => activeWindowId === windowId && ['mail', 'contacts', 'messages'].includes(activeAppId)
      ? { appId: activeAppId, windowId, entry: communicationEntry(state, activeAppId), view } : null,
    providerValuesCurrent: () => true, canCommitCommunications: () => capacity, canCommitDraft: () => capacity, canCreateNote: () => capacity,
    prepareDestination: async (appId, entry, source) => {
      const before = { activeAppId, activeWindowId, focus };
      activeAppId = appId; activeWindowId = appId === 'notes' ? sourceWindowId : `${appId}-window`;
      focus = appId === 'notes' ? 'body' : entry.kind === 'contact' ? 'name' : 'to';
      await hook?.();
      return { appId, windowId: appId === 'notes' ? sourceWindowId : `${appId}-window`, focused: !focusFailure, before,
        stale: activeAppId !== appId };
    },
    destinationCurrent: preparation => preparation.focused && activeAppId === preparation.appId && activeWindowId === preparation.windowId,
    rollbackDestination: async (preparation, source) => {
      if (activeAppId !== preparation.appId || activeWindowId !== preparation.windowId) return;
      ({ activeAppId, activeWindowId } = preparation.before);
      focus = current(source) ? preparation.before.focus : 'frame';
    }, finishDestination: () => {}, changed: () => {}, noteCreated: () => {},
  });
  function select(noteId, control, start, end) {
    const note = notes.notes.find(note => note.id === noteId), value = fieldValue(note, control);
    selected = { sourceId: `selection-${++sequence}`, kind: 'text', appId: 'notes', windowId: sourceWindowId, noteId, control,
      revision: note.updatedAt, value, start, end, text: value.slice(start, end) };
    return selected;
  }
  function editNote(noteId, text) {
    updateNote(notes, noteId, text, seed.files.sceneTime);
    seed.files.sceneTime = Math.max(seed.files.sceneTime, notes.notes.find(note => note.id === noteId).updatedAt);
  }
  return { notes, state, files: seed.files, ui, services, select, editNote, focus: () => focus,
    failFocus: () => { focusFailure = true; }, onFocus: value => { hook = value; }, denyCapacity: () => { capacity = false; },
    activateSafari: () => { activeAppId = 'safari'; activeWindowId = 'safari-window'; focus = 'safari'; },
    perform: serviceId => services.handlers['app.service.perform']({ appId: getSource()?.appId ?? 'notes', serviceId,
      sourceId: getSource()?.sourceId ?? 'missing-selection' }, {}),
    provider: (command, payload = {}, extra = {}) => services.handlers[command]({ appId: activeAppId, windowId: activeWindowId,
      ...(command.startsWith('services.draft.') ? { draftId: state.selected[activeAppId] } : {}), ...extra }, payload),
  };
}

test('a service copies exact selected UTF-16 bytes into one editable note without changing its source', async () => {
  const c = consumer(); c.editNote(c.notes.selectedId, 'Heading\nOne 🌊 two\nLast');
  c.select(c.notes.selectedId, 'body', 4, 11);
  const original = structuredClone(c.notes.notes);
  const result = await c.perform('create-note');
  expect(result.status).toBe('applied');
  const note = c.notes.notes.find(note => note.id === result.target.noteId);
  expect(note.text).toBe('🌊 two\n'); expect(note.pinned).toBe(false); expect(note.deleted).toBe(false);
  expect(c.notes.notes.filter(entry => entry.id !== note.id)).toEqual(original);
  expect(note.createdAt).toBeGreaterThan(Math.max(...original.map(entry => entry.updatedAt)));
  expect(c.notes.selectedId).toBe(note.id); expect(c.notes.folder).toBe('notes'); expect(c.notes.search).toBe('');
  expect(c.focus()).toBe('body');
});

test('readonly deleted text creates an editable note without restoring the deleted record', async () => {
  const c = consumer(); c.notes.folder = 'deleted'; c.notes.selectedId = 'note-4';
  c.select('note-4', 'title', 0, 16); const original = structuredClone(c.notes.notes);
  const result = await c.perform('create-note');
  expect(result.status).toBe('applied'); expect(c.notes.notes.find(note => note.id === result.target.noteId).text).toBe('Old packing list');
  expect(c.notes.notes.filter(note => note.id !== result.target.noteId)).toEqual(original);
  expect(c.notes.folder).toBe('notes');
});

test('failed native preparation and stale source edits allocate nothing and cannot borrow another app focus', async () => {
  for (const scenario of ['focus', 'edit', 'owner']) {
    const c = consumer(); c.select(c.notes.selectedId, 'body', 0, 10);
    const before = structuredClone(c.notes), communications = structuredClone(c.state);
    if (scenario === 'focus') c.failFocus();
    if (scenario === 'edit') c.onFocus(() => c.editNote(before.selectedId, 'Changed source\nNew body.'));
    if (scenario === 'owner') c.onFocus(c.activateSafari);
    const result = await c.perform('create-note');
    expect(result.status).toBe('rejected'); expect(c.state).toEqual(communications);
    expect(c.notes.notes.map(note => note.id)).toEqual(before.notes.map(note => note.id));
    if (scenario === 'edit') { expect(c.notes.notes.find(note => note.id === before.selectedId).text).toBe('Changed source\nNew body.'); expect(c.focus()).toBe('frame'); }
    else { expect(c.notes).toEqual(before); expect(c.focus()).toBe(scenario === 'owner' ? 'safari' : 'title'); }
  }
});

test('mail service delivers editable exact text, not a send, and explicit local submission creates the real addressed record', async () => {
  const c = consumer(); c.editNote(c.notes.selectedId, 'Heading\nOne 🌊 two\nLast');
  c.select(c.notes.selectedId, 'body', 4, 11); const notes = structuredClone(c.notes);
  const delivered = await c.perform('new-mail'); expect(delivered.status).toBe('applied');
  expect(c.state.drafts.find(draft => draft.id === delivered.target.draftId).fields).toEqual({ to: '', subject: '', body: '🌊 two\n' });
  expect(c.state.outbox).toEqual([]); expect(c.notes).toEqual(notes);
  expect((await c.provider('services.draft.submit')).status).toBe('rejected'); expect(c.state.outbox).toEqual([]);
  expect((await c.provider('services.draft.set', { value: 'casey@example.test' }, { field: 'to' })).status).toBe('applied');
  const sent = await c.provider('services.draft.submit'); expect(sent.status).toBe('applied');
  expect(c.state.outbox.find(record => record.id === sent.target.recordId).fields).toEqual({ to: 'casey@example.test', subject: '', body: '🌊 two\n' });
  expect(c.state.drafts).toEqual([]); expect(c.notes).toEqual(notes);
});

test('selected contact text creates a card draft and a saved contact addresses a new composition without sending', async () => {
  const c = consumer(); c.editNote(c.notes.selectedId, 'Heading\nemma@example.test'); c.select(c.notes.selectedId, 'body', 0, 17);
  const delivered = await c.perform('new-contact'); expect(delivered.status).toBe('applied');
  expect(c.state.contacts).toEqual([]); expect(c.state.drafts[0].fields).toEqual({ name: '', email: 'emma@example.test', phone: '', notes: 'emma@example.test' });
  const saved = await c.provider('services.draft.submit'); expect(saved.status).toBe('applied');
  const contact = structuredClone(c.state.contacts[0]);
  const composition = await c.perform('email-contact'); expect(composition.status).toBe('applied');
  expect(c.state.drafts.find(draft => draft.id === composition.target.draftId).fields).toEqual({ to: 'emma@example.test', subject: '', body: '' });
  expect(c.state.contacts[0]).toEqual(contact); expect(c.state.outbox).toEqual([]);
});

test('capacity is checked before native destination delivery and preserves every record and focus', async () => {
  const c = consumer(); c.select(c.notes.selectedId, 'body', 0, 10); c.denyCapacity();
  const before = structuredClone({ notes: c.notes, communications: c.state });
  expect((await c.perform('new-message')).error.code).toBe('limit_exceeded');
  expect((await c.perform('create-note')).error.code).toBe('limit_exceeded');
  expect({ notes: c.notes, communications: c.state }).toEqual(before); expect(c.focus()).toBe('title');
});

test('offline lookup cannot manufacture an unknown definition and close restores the original owned focus', async () => {
  const c = consumer(); c.editNote(c.notes.selectedId, 'Heading\nunlisted-word'); c.select(c.notes.selectedId, 'body', 0, 13);
  const before = structuredClone({ notes: c.notes, communications: c.state });
  const result = await c.perform('lookup'); expect(result.status).toBe('applied'); expect(result.target.found).toBe(false);
  expect(c.ui.lookup.entry).toBe(null); expect(c.focus()).toBe('reader');
  expect((await c.services.handlers['services.lookup.search']({ lookupId: result.target.lookupId }, { query: 'folder' })).target.found).toBe(true);
  expect((await c.services.handlers['services.lookup.close']({ lookupId: result.target.lookupId }, {})).status).toBe('applied');
  expect(c.ui.lookup).toBe(null); expect(c.focus()).toBe('title'); expect({ notes: c.notes, communications: c.state }).toEqual(before);
});

test('contextual service refuses a changed original document rather than applying its old selection', async () => {
  const c = consumer(), source = c.select(c.notes.selectedId, 'body', 0, 10);
  const opened = await c.services.handlers['services.context.open']({ appId: 'notes', sourceId: source.sourceId }, { x: 90, y: 120 });
  expect(opened.status).toBe('applied');
  const itemId = c.services.contextItems().find(item => item.request.target.serviceId === 'create-note').id;
  c.editNote(source.noteId, 'Replacement\nDifferent source');
  const current = structuredClone(c.notes);
  expect((await c.services.handlers['services.context.execute']({ contextId: opened.target.contextId, itemId }, {})).error.code).toBe('stale_target');
  expect(c.notes).toEqual(current); expect(c.state.drafts).toEqual([]); c.services.reconcile(); expect(c.ui.context).toBe(null);
});

test('obsolete targets, accessors and transparent actor proxies reject without native work or allocation', async () => {
  const c = consumer(), source = c.select(c.notes.selectedId, 'body', 0, 10), before = structuredClone(c.notes);
  const valid = { appId: 'notes', serviceId: 'create-note', sourceId: source.sourceId };
  for (const target of [{ appId: 'notes', serviceId: 'create-note', windowId: sourceWindowId, noteId: source.noteId, control: 'body' },
    new Proxy(valid, {}), { ...valid, get unexpected() { throw new Error('actor accessor must not run'); } }]) {
    expect((await c.services.handlers['app.service.perform'](target, {})).error.code).toBe('invalid_arguments');
    expect(c.notes).toEqual(before); expect(c.focus()).toBe('title');
  }
});

test('single-line composition fields reject newlines atomically rather than creating unrenderable native values', async () => {
  const c = consumer(); c.select(c.notes.selectedId, 'body', 0, 10);
  const result = await c.perform('new-mail'); expect(result.status).toBe('applied');
  const before = structuredClone(c.state), originalFocus = c.focus();
  expect((await c.provider('services.draft.set', { value: 'Two\r\nlines' }, { field: 'subject' })).error.code).toBe('invalid_arguments');
  expect(c.state).toEqual(before); expect(c.focus()).toBe(originalFocus);
});

test('lookup separates selected lines in its editable query rather than displaying a different stripped word', async () => {
  const c = consumer(); c.editNote(c.notes.selectedId, 'Heading\nfo\nlder'); c.select(c.notes.selectedId, 'body', 0, 7);
  const result = await c.perform('lookup'); expect(result.status).toBe('applied'); expect(result.target.found).toBe(false);
  expect(c.ui.lookup.query).toBe('fo lder');
  const searched = await c.services.handlers['services.lookup.search']({ lookupId: result.target.lookupId }, { query: 'fo\r\nlder' });
  expect(searched.target).toEqual({ lookupId: result.target.lookupId, query: 'fo lder', found: false });
  expect(c.notes.notes.find(note => note.id === c.notes.selectedId).text).toBe('Heading\nfo\nlder');
});

test('cross-app Notes and communications commits share an advanced root clock, while failed budgets and stale previews cannot advance it', async () => {
  const c = consumer();
  c.files.sceneTime += 3 * 86_400_000;
  c.select(c.notes.selectedId, 'body', 0, 4);
  const initial = c.files.sceneTime;
  const created = await c.perform('create-note');
  expect(created.status).toBe('applied');
  expect(c.notes.notes.find(note => note.id === created.target.noteId).createdAt).toBe(initial + 1);
  expect(c.files.sceneTime).toBe(initial + 1);
  c.select(c.notes.selectedId, 'title', 0, 4);
  const delivered = await c.perform('new-mail');
  expect(delivered.status).toBe('applied');
  expect(c.state.timeBase).toBe(initial + 2); expect(c.files.sceneTime).toBe(c.state.timeBase);
  c.files.sceneTime += 86_400_000;
  const next = c.files.sceneTime;
  expect((await c.provider('services.draft.set', { value: 'local@example.test' }, { field: 'to' })).status).toBe('applied');
  expect(c.state.timeBase).toBe(next + 1); expect(c.files.sceneTime).toBe(next + 1);
  expect((await c.provider('services.draft.set', { value: 'Complete body' }, { field: 'body' })).status).toBe('applied');
  expect((await c.provider('services.draft.submit')).status).toBe('applied');
  expect(c.state.outbox[0].createdAt).toBe(next + 3); expect(c.files.sceneTime).toBe(next + 3);

  const denied = consumer(); denied.files.sceneTime += 86_400_000;
  denied.select(denied.notes.selectedId, 'body', 0, 4); denied.denyCapacity();
  const before = structuredClone({ notes: denied.notes, communications: denied.state, time: denied.files.sceneTime });
  expect((await denied.perform('create-note')).error.code).toBe('limit_exceeded');
  expect({ notes: denied.notes, communications: denied.state, time: denied.files.sceneTime }).toEqual(before);

  const stale = consumer();
  stale.select(stale.notes.selectedId, 'body', 0, 4);
  stale.onFocus(() => { stale.files.sceneTime += 86_400_000; });
  const original = stale.files.sceneTime;
  expect((await stale.perform('new-mail')).error.code).toBe('stale_target');
  expect(stale.state.drafts).toEqual([]); expect(stale.files.sceneTime).toBe(original + 86_400_000);
});
