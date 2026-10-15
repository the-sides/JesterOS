import { expect, test } from 'bun:test';
import { createServiceCommands } from '../frontend/src/service-commands.js';
import { applicableServices } from '../frontend/src/service-registry.js';
import { createNotesWorkspace, createNotesWorkspaceWindow, noteWorkspaceText, notesWorkspaceWindow } from '../frontend/src/notes-workspace-state.js';
import { notesWorkspaceTextSource } from '../frontend/src/notes-workspace-projections.js';
import { documentFromText, firstDocumentSelection } from '../frontend/src/notes-workspace-document.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { createMailState } from '../frontend/src/mail-state.js';
import { createMailServiceDraft } from '../frontend/src/mail-commands.js';
import { createContactsState, createContact } from '../frontend/src/contacts-state.js';
import { createMessagesState } from '../frontend/src/messages-state.js';
import { createMessageDraft } from '../frontend/src/messages-composition.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const sourceWindowId = 'notes-source', destinationWindowId = 'notes-destination';
const reject = code => ({ status: 'rejected', error: { code, message: code } });

// Native presentation/await harness around the actual canonical domain reducers.
// No Services-owned communications graph, copied note authority or title/body field.
function consumer() {
  const root = { notes: createNotesWorkspace(profile), mail: createMailState(profile), contacts: createContactsState(profile),
    messages: createMessagesState(profile), sceneTime: Date.parse(profile.defaults.sceneTime),
    clipboard: { kind: 'empty', text: '', fileIds: [] }, otherText: '' };
  root.notes.windows.push(createNotesWorkspaceWindow(root.notes, sourceWindowId, { noteId: 'note-1', standalone: false }),
    createNotesWorkspaceWindow(root.notes, destinationWindowId, { standalone: false }));
  let selected = null, selection = null, serial = 0, sourceAlive = true, destinationAlive = true;
  let limit = 4194304, focus = 'editor', prepareHook, commitHook, selectionHook, deferredCommit, failFocus = false;
  let prepareCount = 0, provider = null;
  const ui = { lookup: null, context: null };
  const sourceSession = () => notesWorkspaceWindow(root.notes, sourceWindowId);
  const note = () => root.notes.notes.find(row => row.id === sourceSession().selectedId);
  const nativeNotes = { available: () => sourceAlive, ownsNote: row => row === note(), captureSelection: () => selection };
  const current = source => {
    if (source.kind !== 'text' || source.appId !== 'notes') return sourceAlive && selected === source;
    const actual = notesWorkspaceTextSource(root.notes, sourceWindowId, nativeNotes);
    return actual?.note === source.record && actual.revision === source.revision && actual.value === source.value
      && actual.selection.start === source.start && actual.selection.end === source.end;
  };
  const canCommit = delta => canonicalStringUnits(root) + delta <= limit;
  const pane = { prepare: async () => true, focus: async control => { focus = control; return true; }, describe: () => ({ focusedControl: focus }) };
  const ctx = {
    profile, ui, namespace: () => 'consumer-', available: () => true,
    getSceneTime: () => root.sceneTime, getNotesState: () => root.notes,
    getSource: sourceId => selected && current(selected) && (sourceId === undefined || sourceId === selected.sourceId) ? selected : null,
    sourceCurrent: current, ownsSourcePresentation: () => sourceAlive,
    captureReturn: () => ({ focus }), restoreReturn: async snapshot => { focus = snapshot.focus; }, settle: async () => {},
    getLookupView: () => pane, getContextView: () => pane,
    prepareServiceDestination: async (appId, spec, ownership) => {
      prepareCount++;
      if (!ownership.guard()) return null;
      const preparation = { appId, windowId: appId === 'notes' ? destinationWindowId : `${appId}-window`, before: focus };
      if (appId !== 'notes') {
        const original = root[appId], baseline = JSON.stringify(original), candidate = structuredClone(original);
        let recordId, timestamp = root.sceneTime + 1;
        if (appId === 'mail') {
          const draft = createMailServiceDraft(candidate, { to: spec.to.map(row => row.email).join(', '), subject: spec.subject, body: spec.body });
          if (!draft) return null;
          recordId = draft.id;
        } else if (appId === 'contacts') {
          const result = createContact(candidate, spec.fields, { time: timestamp });
          if (result.status !== 'applied') return null;
          recordId = result.contactId;
        } else {
          const result = createMessageDraft(candidate, { to: spec.recipient?.address ?? '', body: spec.text }, { time: root.sceneTime });
          if (result.status !== 'applied') return null;
          recordId = result.target.draftId; timestamp = candidate.timeBase;
        }
        preparation.transition = { status: 'prepared', original, baseline, candidate, recordId, timestamp,
          sceneTime: root.sceneTime, deltaTextUnits: canonicalStringUnits(candidate) - canonicalStringUnits(original) };
      }
      focus = appId === 'notes' ? 'editor' : 'recipient';
      await prepareHook?.(preparation, spec);
      return ownership.guard() && !failFocus ? preparation : null;
    },
    serviceDestinationCurrent: preparation => destinationAlive && !failFocus && preparation.windowId === (preparation.appId === 'notes' ? destinationWindowId : `${preparation.appId}-window`),
    rollbackServiceDestination: async preparation => { if (sourceAlive && destinationAlive) focus = preparation.before; },
    commitServiceTransition: (spec, ownership) => {
      commitHook?.(spec);
      if (!ownership.guard()) return reject('stale_target');
      if (spec.provider === 'notes') {
        if (deferredCommit) { deferredCommit(spec.onCommit); return { status: 'applied' }; }
        if (!canCommit(spec.deltaTextUnits)) return reject('limit_exceeded');
        if (!ownership.guard() || spec.onCommit() !== true) return reject('stale_target');
        root.sceneTime = spec.timestamp;
        return { status: 'applied' };
      }
      const transition = spec.transition;
      if (root[spec.provider] !== transition.original || JSON.stringify(transition.original) !== transition.baseline
        || root.sceneTime !== transition.sceneTime) return reject('stale_target');
      if (!canCommit(transition.deltaTextUnits)) return reject('limit_exceeded');
      if (!ownership.guard()) return reject('stale_target');
      Object.assign(transition.original, transition.candidate); root.sceneTime = transition.timestamp;
      return { status: 'applied', target: { recordId: transition.recordId } };
    },
    getProvider: windowId => provider?.windowId === windowId ? provider : null,
    describeProviders: () => provider ? [{ appId: provider.appId, windowId: provider.windowId }] : [],
    describeSource: source => ({ sourceId: source.sourceId, appId: source.appId }),
    setProviderSelection: async (owner, control, range, ownership) => {
      await selectionHook?.();
      if (!ownership.guard()) return false;
      return owner.view.setSelection(control, range, ownership.guard);
    },
    prepareSource: async (_source, ownership) => ownership.guard(),
    setClipboard: async (value, ownership) => {
      if (!ownership.guard()) return reject('stale_target');
      const delta = canonicalStringUnits(value) - canonicalStringUnits(root.clipboard);
      if (!canCommit(delta)) return reject('limit_exceeded');
      if (!ownership.guard()) return reject('stale_target');
      Object.assign(root.clipboard, value); return { status: 'applied' };
    },
  };
  const services = createServiceCommands(ctx);
  const edit = text => {
    const original = note(); original.document = documentFromText(text); original.revision++;
    for (const session of root.notes.windows) if (session.selectedId === original.id) session.selection = firstDocumentSelection(original.document);
  };
  const select = (start = 0, end = 10, blockIndex = 0) => {
    const original = note(), block = original.document.blocks[blockIndex];
    selection = { blockId: block.id, row: -1, column: -1, start, end, direction: 'forward' };
    const actual = notesWorkspaceTextSource(root.notes, sourceWindowId, nativeNotes);
    if (actual) sourceSession().selection = { ...selection };
    selected = actual ? { sourceId: `selection-${++serial}`, kind: 'text', appId: 'notes', windowId: sourceWindowId,
      record: actual.note, revision: actual.revision, value: actual.value, start: actual.selection.start, end: actual.selection.end,
      text: actual.value.slice(actual.selection.start, actual.selection.end) } : null;
    return selected;
  };
  return { root, ui, ctx, services, edit, select, note, focus: () => focus, prepareCount: () => prepareCount,
    setSource: value => { selected = value; }, setLimit: value => { limit = value; },
    onPrepare: value => { prepareHook = value; }, onCommit: value => { commitHook = value; }, onSelection: value => { selectionHook = value; },
    deferCommit: value => { deferredCommit = value; }, failFocus: () => { failFocus = true; },
    retireSource: () => { sourceAlive = false; focus = 'other-app'; }, retireDestination: () => { destinationAlive = false; },
    setProvider: value => { provider = value; },
    perform: serviceId => services.handlers['app.service.perform']({ appId: selected?.appId ?? 'notes', serviceId,
      sourceId: selected?.sourceId ?? 'missing' }, {}),
  };
}

test('Services copies exact original rich UTF-16 selection into one canonical note and selects only its actual destination session', async () => {
  const c = consumer(); c.edit('Heading\nOne 🌊 two\nLast'); c.note().document.blocks[1].runs[0].marks = ['bold'];
  c.select(4, 10, 1);
  const original = c.note(), document = original.document, before = structuredClone(c.root.notes.notes), sourceSession = structuredClone(notesWorkspaceWindow(c.root.notes, sourceWindowId));
  const epoch = c.root.sceneTime, result = await c.perform('create-note');
  expect(result.status).toBe('applied');
  const created = c.root.notes.notes.find(row => row.id === result.target.noteId);
  expect(noteWorkspaceText(created)).toBe('🌊 two'); expect(created.document.blocks[0].runs[0].marks).toEqual([]);
  expect(created.deletedAt).toBe(null); expect(created.createdAt).toBe(epoch + 1); expect(c.root.sceneTime).toBe(epoch + 1);
  expect(c.root.notes.notes.filter(row => row !== created)).toEqual(before);
  expect(c.note()).toBe(original); expect(original.document).toBe(document);
  expect(notesWorkspaceWindow(c.root.notes, sourceWindowId)).toEqual(sourceSession);
  expect(notesWorkspaceWindow(c.root.notes, destinationWindowId).selectedId).toBe(created.id);
});

test('read-only trash selection creates a live note without restoring or flattening its source', async () => {
  const c = consumer(), session = notesWorkspaceWindow(c.root.notes, sourceWindowId);
  session.folderId = 'deleted'; session.selectedId = 'note-4'; c.select(0, 16);
  const original = structuredClone(c.note()), result = await c.perform('create-note');
  expect(result.status).toBe('applied'); expect(c.note()).toEqual(original);
  expect(noteWorkspaceText(c.root.notes.notes.find(row => row.id === result.target.noteId))).toBe('Old packing list');
  expect(notesWorkspaceWindow(c.root.notes, destinationWindowId).folderId).toBe('notes');
});

test('locked canonical Notes and unsupported cross-block native capture offer no plaintext Services', async () => {
  const c = consumer(); c.select(); c.note().lock = { secret: 'fictional', hint: '', unlocked: false };
  expect(c.ctx.getSource()).toBe(null); expect((await c.perform('create-note')).error.code).toBe('stale_target');
  c.note().lock.unlocked = true; c.edit('first\nsecond');
  expect(c.select(0, 12)).toBe(null); expect(c.prepareCount()).toBe(0);
});

test('source edit, source retirement, focus failure and destination retirement during preparation allocate no records', async () => {
  for (const scenario of ['edit', 'source', 'focus', 'destination']) {
    const c = consumer(); c.select(); const ids = c.root.notes.notes.map(row => row.id), epoch = c.root.sceneTime;
    c.onPrepare(() => { if (scenario === 'edit') c.edit('replacement'); if (scenario === 'source') c.retireSource();
      if (scenario === 'focus') c.failFocus(); if (scenario === 'destination') c.retireDestination(); });
    expect((await c.perform('create-note')).status).toBe('rejected');
    expect(c.root.notes.notes.map(row => row.id)).toEqual(ids); expect(c.root.sceneTime).toBe(epoch);
    if (scenario === 'source') expect(c.focus()).toBe('other-app');
  }
});

test('whole-root budget includes unrelated graphs and growth after destination preparation', async () => {
  const c = consumer(); c.select(); const before = structuredClone(c.root.notes), epoch = c.root.sceneTime;
  c.setLimit(canonicalStringUnits(c.root) + 100);
  c.onPrepare(() => { c.root.otherText = 'x'.repeat(1000); });
  expect((await c.perform('create-note')).error.code).toBe('limit_exceeded');
  expect(c.root.notes).toEqual(before); expect(c.root.sceneTime).toBe(epoch);
  expect(c.root.otherText.length).toBe(1000);
});

test('the final no-await commit rejects original source, destination, workspace and shared-clock changes', async () => {
  for (const scenario of ['source', 'destination', 'workspace', 'clock']) {
    const c = consumer(); c.select(); const ids = c.root.notes.notes.map(row => row.id);
    c.onCommit(() => { if (scenario === 'source') c.edit('changed'); if (scenario === 'destination') c.retireDestination();
      if (scenario === 'workspace') c.root.notes.preferences.textSize++; if (scenario === 'clock') c.root.sceneTime++; });
    expect((await c.perform('create-note')).error.code).toBe('stale_target');
    expect(c.root.notes.notes.map(row => row.id)).toEqual(ids);
  }
});

test('missing canonical bridge hooks and fake acknowledgement reject without allocation; deferred callbacks expire', async () => {
  for (const hook of ['getNotesState', 'getSceneTime', 'prepareServiceDestination', 'serviceDestinationCurrent', 'rollbackServiceDestination', 'commitServiceTransition']) {
    const c = consumer(); c.select(); const before = structuredClone(c.root); delete c.ctx[hook];
    expect((await c.perform('create-note')).error.code).toBe('unavailable'); expect(c.root).toEqual(before);
  }
  const c = consumer(); c.select(); const before = structuredClone(c.root); let late;
  c.deferCommit(callback => { late = callback; });
  expect((await c.perform('create-note')).error.code).toBe('unavailable'); expect(late()).toBe(false); expect(c.root).toEqual(before);
});

test('an acknowledged canonical commit remains applied when the original presentation retires immediately afterwards', async () => {
  const c = consumer(); c.select(); const original = c.ctx.commitServiceTransition;
  c.ctx.commitServiceTransition = (spec, ownership) => { const result = original(spec, ownership); c.retireSource(); c.retireDestination(); return result; };
  const result = await c.perform('create-note'); expect(result.status).toBe('applied');
  expect(c.root.notes.notes.some(row => row.id === result.target.noteId)).toBe(true);
});

test('Mail, Contacts and Messages Services bridge to actual canonical reducers, not a Services draft graph or sent transport', async () => {
  for (const serviceId of ['new-mail', 'new-contact', 'new-message']) {
    const c = consumer(); c.edit('emma@example.test'); c.select(0, 17); const original = structuredClone(c.root.notes);
    const result = await c.perform(serviceId); expect(result.status).toBe('applied'); expect(c.root.notes).toEqual(original);
    if (serviceId === 'new-mail') {
      const draft = c.root.mail.drafts.find(row => row.id === result.target.recordId);
      expect(draft.body).toBe('emma@example.test'); expect(draft.to).toBe('');
      expect(c.root.mail.messages.some(row => row.id === draft.id)).toBe(false);
    } else if (serviceId === 'new-contact') {
      const contact = c.root.contacts.contacts.find(row => row.id === result.target.recordId);
      expect(contact.emails).toEqual([{ label: 'home', value: 'emma@example.test' }]); expect(contact.notes).toBe('emma@example.test');
    } else {
      expect(c.root.messages.drafts.find(row => row.id === result.target.recordId).fields).toEqual({ to: '', body: 'emma@example.test' });
    }
  }
});

test('canonical contact projection addresses real Mail and Messages compositions without sending', async () => {
  for (const serviceId of ['email-contact', 'message-contact']) {
    const c = consumer(), contact = createContact(c.root.contacts, { name: 'Emma', email: 'emma@example.test', phone: '+1 555 0100' }, { time: c.root.sceneTime }).contact;
    c.setSource({ kind: 'contact', sourceId: `contact:${contact.id}`, appId: 'contacts', windowId: 'contacts-source', record: contact,
      revision: contact.revision, contact: { id: contact.id, name: 'Emma', email: contact.emails[0].value, phone: contact.phones[0].value } });
    const before = structuredClone(c.root.contacts), result = await c.perform(serviceId); expect(result.status).toBe('applied');
    expect(c.root.contacts).toEqual(before);
    if (serviceId === 'email-contact') expect(c.root.mail.drafts.find(row => row.id === result.target.recordId).to).toBe('emma@example.test');
    else expect(c.root.messages.drafts.find(row => row.id === result.target.recordId).fields.to).toBe('+1 555 0100');
  }
});

test('provider bridges reject missing prepared canonical transitions and failed complete-root budgets', async () => {
  for (const serviceId of ['new-mail', 'new-contact', 'new-message']) {
    const c = consumer(); c.select(); const before = structuredClone(c.root); c.setLimit(canonicalStringUnits(c.root));
    expect((await c.perform(serviceId)).error.code).toBe('limit_exceeded'); expect(c.root).toEqual(before);
    c.ctx.prepareServiceDestination = async appId => ({ appId, windowId: `${appId}-window` });
    expect((await c.perform(serviceId)).error.code).toBe('unavailable'); expect(c.root).toEqual(before);
  }
});

test('canonical provider leases reject stale domain revisions and a changed shared clock', async () => {
  for (const scenario of ['domain', 'clock', 'owner']) {
    const c = consumer(); c.select(); const count = c.root.mail.drafts.length;
    c.onCommit(() => { if (scenario === 'domain') c.root.mail.preferences.fontSize++;
      if (scenario === 'clock') c.root.sceneTime++; if (scenario === 'owner') c.retireSource(); });
    expect((await c.perform('new-mail')).error.code).toBe('stale_target'); expect(c.root.mail.drafts.length).toBe(count);
  }
  const c = consumer(); c.select(); let lateGuard;
  c.ctx.commitServiceTransition = (_spec, ownership) => { lateGuard = ownership.guard; return Promise.resolve({ status: 'applied' }); };
  expect((await c.perform('new-mail')).error.code).toBe('unavailable'); expect(lateGuard()).toBe(false);
});

test('attachment Services pass only original canonical Files identities/revisions to the provider bridge', async () => {
  const c = consumer(), source = { kind: 'files', appId: 'finder', windowId: 'finder-source', sourceId: 'files-selection',
    files: [{ kind: 'document', fileId: 'file-1', name: 'Original.txt', revision: 4, content: 'not a provider authority', path: '/Original.txt' }] };
  c.setSource(source); let observed;
  c.ctx.prepareServiceDestination = async (_appId, spec) => { observed = spec; return null; };
  const before = structuredClone(c.root);
  expect((await c.perform('new-mail-with-attachments')).error.code).toBe('unavailable');
  expect(c.root).toEqual(before);
  expect(observed.attachments).toEqual([{ fileId: 'file-1', revision: 4 }]);
  expect(applicableServices({ ...source, files: [{ ...source.files[0], revision: undefined }] }, profile).some(row => row.id === 'new-mail-with-attachments')).toBe(false);
});

test('native canonical provider focus/selection/scroll retain original view and revision leases', async () => {
  const c = consumer(), draft = createMailServiceDraft(c.root.mail, { body: 'original' });
  let range = null, mounted = true;
  const view = { available: () => mounted, describe: () => ({ controlIds: ['body'], scrolls: { reader: { top: 0, left: 0 } } }),
    focus: async (_control, guard) => guard(), setSelection: async (_control, value, guard) => { if (!guard()) return false; range = value; return true; },
    scroll: async (_area, value, guard) => guard() ? value : null };
  const provider = { appId: 'mail', windowId: 'mail-window', record: draft, view,
    isCurrent: () => c.root.mail.drafts.includes(draft) && draft.body === 'original' }; c.setProvider(provider);
  const target = { appId: 'mail', windowId: 'mail-window', control: 'body' };
  expect((await c.services.handlers['services.panel.focus'](target, { start: 1, end: 3 })).status).toBe('applied'); expect(range).toEqual({ start: 1, end: 3 });
  expect((await c.services.handlers['services.panel.scroll']({ appId: 'mail', windowId: 'mail-window', area: 'reader' }, { top: 40, left: 2 })).target.top).toBe(40);
  c.onSelection(() => { c.setProvider({ ...provider, view: { ...view } }); }); range = null;
  expect((await c.services.handlers['services.panel.focus'](target, { start: 1, end: 3 })).error.code).toBe('stale_target'); expect(range).toBe(null);
  c.setProvider(provider); c.onSelection(() => { draft.body = 'edited while awaiting selection'; });
  expect((await c.services.handlers['services.panel.focus'](target, { start: 1, end: 3 })).error.code).toBe('stale_target'); expect(range).toBe(null);
  draft.body = 'original';
  c.setProvider(provider); mounted = false;
  expect((await c.services.handlers['services.panel.focus'](target, {})).error.code).toBe('stale_target');
});

test('offline lookup preserves original selection and restores its actual owned return focus', async () => {
  const c = consumer(); c.edit('unlisted-word'); c.select(0, 13); const before = structuredClone(c.root);
  const result = await c.perform('lookup'); expect(result.status).toBe('applied'); expect(result.target.found).toBe(false); expect(c.ui.lookup.entry).toBe(null);
  expect((await c.services.handlers['services.lookup.search']({ lookupId: result.target.lookupId }, { query: 'folder' })).target.found).toBe(true);
  expect((await c.services.handlers['services.lookup.close']({ lookupId: result.target.lookupId }, {})).status).toBe('applied');
  expect(c.focus()).toBe('editor'); expect(c.root).toEqual(before);
});

test('contextual service refuses a changed original rich record and clears stale presentation', async () => {
  const c = consumer(), source = c.select();
  const opened = await c.services.handlers['services.context.open']({ appId: 'notes', sourceId: source.sourceId }, { x: 90, y: 120 });
  expect(opened.status).toBe('applied'); const itemId = c.services.contextItems().find(item => item.request.target.serviceId === 'create-note').id;
  c.edit('replacement'); const before = structuredClone(c.root);
  expect((await c.services.handlers['services.context.execute']({ contextId: opened.target.contextId, itemId }, {})).error.code).toBe('stale_target');
  expect(c.root).toEqual(before); c.services.reconcile(); expect(c.ui.context).toBe(null);
});

test('obsolete targets, accessors and transparent actor proxies reject before native work or allocation', async () => {
  const c = consumer(), source = c.select(), before = structuredClone(c.root), valid = { appId: 'notes', serviceId: 'create-note', sourceId: source.sourceId };
  for (const target of [{ ...valid, noteId: source.record.id }, new Proxy(valid, {}), { ...valid, get unexpected() { throw new Error('must not run'); } }]) {
    expect((await c.services.handlers['app.service.perform'](target, {})).error.code).toBe('invalid_arguments');
    expect(c.root).toEqual(before); expect(c.prepareCount()).toBe(0);
  }
});

test('Files path Services use the one canonical budgeted clipboard bridge and reject its absence', async () => {
  const c = consumer();
  c.setSource({ kind: 'files', appId: 'finder', windowId: 'finder-source', sourceId: 'files-selection',
    files: [{ kind: 'document', fileId: 'file-1', revision: 4, name: 'Original.txt', path: '/Original.txt' }] });
  const before = structuredClone(c.root.clipboard); c.setLimit(canonicalStringUnits(c.root));
  expect((await c.perform('copy-paths')).error.code).toBe('limit_exceeded'); expect(c.root.clipboard).toEqual(before);
  c.setLimit(4194304);
  expect((await c.perform('copy-paths')).status).toBe('applied'); expect(c.root.clipboard).toEqual({ kind: 'text', text: '/Original.txt', fileIds: [] });
  delete c.ctx.setClipboard;
  expect((await c.perform('copy-paths')).error.code).toBe('unavailable');
});

test('lookup newline projection derives the exact actual paragraph text and never changes its rich record', async () => {
  const c = consumer(); c.edit('fo\nlder'); c.select(0, 2); const before = structuredClone(c.note());
  const result = await c.perform('lookup'); expect(result.status).toBe('applied');
  const searched = await c.services.handlers['services.lookup.search']({ lookupId: result.target.lookupId }, { query: 'fo\r\nlder' });
  expect(searched.target).toEqual({ lookupId: result.target.lookupId, query: 'fo lder', found: false }); expect(c.note()).toEqual(before);
});
