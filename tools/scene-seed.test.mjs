import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createDefaultSceneSeed, validateSceneSeed, createSceneSeedCommands } from '../frontend/src/scene-seed.js';
import { createNote } from '../frontend/src/notes-state.js';
import { nextMacFileTimestamp, liveMacFileRecords } from '../frontend/src/desktop-file-state.js';
import { createFile, writeFile } from '../frontend/src/windows11-app-helpers.js';
import { recordMacAppUse } from '../frontend/src/mac-dock-model.js';
import { communicationDefaults, draftPreview, createCommunicationDraft, submitCommunicationDraft } from '../frontend/src/communication-state.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const fixture = () => createDefaultSceneSeed(profile);
const validate = seed => validateSceneSeed(seed, profile);
function rejects(change) {
  const seed = fixture();
  change(seed);
  const before = structuredClone(seed);
  expect(validate(seed).ok).toBe(false);
  expect(seed).toEqual(before);
}

test('complete Golden seeds require empty real communications independently of the unchanged Messages sample', () => {
  const seed = fixture(), sample = structuredClone(seed.messages);
  expect(seed.communications).toEqual(communicationDefaults(Date.parse(profile.defaults.sceneTime)));
  expect(validate(seed)).toEqual({ ok: true });
  const contact = draftPreview(seed.communications, 'contact', { name: 'Local Casey', email: '', phone: '', notes: '  retained\r\n\u{1D11E}  ' });
  expect(createCommunicationDraft(seed.communications, contact).status).toBe('applied');
  expect(submitCommunicationDraft(seed.communications, contact.id).status).toBe('applied');
  expect(seed.messages).toEqual(sample);
  expect(validate(seed)).toEqual({ ok: true });
  for (const change of [
    model => { delete model.communications; },
    model => { model.communications.selected.mail = 'missing'; },
    model => { model.communications.selected.contacts = 'service-mail-1'; },
    model => { model.communications.nextId = 0; },
    model => { model.communications.selected.extra = null; },
    model => { model.communications.deliveryAccount = 'host'; },
  ]) rejects(change);
});

test('attachment snapshots survive virtual source changes and deletion; aggregate budgets include all communications bytes', () => {
  const seed = fixture(), source = seed.files.files.find(file => file.kind === 'document');
  const fields = { to: 'fictional recipient', subject: 'Snapshot', body: ' \r\n\u{1D11E} exact body  ' };
  const attachment = { fileId: source.id, name: source.name, revision: source.revision, content: source.content };
  const preview = draftPreview(seed.communications, 'mail', fields, [attachment]);
  expect(createCommunicationDraft(seed.communications, preview).status).toBe('applied');
  expect(submitCommunicationDraft(seed.communications, preview.id).status).toBe('applied');
  source.content = 'Changed virtual source'; source.revision++; source.deleted = true;
  // Saved attachments are archival snapshots, not live source references.
  expect(seed.communications.outbox[0].attachments[0]).toEqual(attachment);
  expect(seed.communications.outbox[0].fields.body).toBe(fields.body);
  expect(validate(seed)).toEqual({ ok: true });
  const missingSource = structuredClone(seed);
  missingSource.communications.outbox[0].attachments[0].fileId = 'file-removed';
  expect(validate(missingSource)).toEqual({ ok: true });
  const large = fixture(), units = 1024 * 1024;
  for (let index = 0; index < 3; index++) {
    const draft = draftPreview(large.communications, 'contact', { name: `Local ${index}`, email: '', phone: '', notes: 'n'.repeat(units) });
    expect(createCommunicationDraft(large.communications, draft).status).toBe('applied');
  }
  large.notes.notes[0].text = 's'.repeat(units);
  const before = structuredClone(large);
  expect(validate(large).ok).toBe(false);
  expect(large).toEqual(before);
});

test('seed replacement preserves complete local draft bytes and rejects invalid communication identities before replacing', async () => {
  const seed = fixture(), preview = draftPreview(seed.communications, 'message', { to: '', body: '\ufeff  unsent\r\n\u{1D11E} ' });
  expect(createCommunicationDraft(seed.communications, preview).status).toBe('applied');
  const replacements = [], handlers = createSceneSeedCommands({ profile, available: () => true,
    replaceScene: async (value, source) => { replacements.push({ value, source }); } });
  expect((await handlers['scene.replaceSeed']({}, { seed })).status).toBe('applied');
  expect(replacements[0].value.communications).toEqual(seed.communications);
  seed.communications.drafts[0].fields.body = 'Actor changed later';
  expect(replacements[0].value.communications.drafts[0].fields.body).toBe('\ufeff  unsent\r\n\u{1D11E} ');
  seed.communications.selected.messages = 'service-draft-missing';
  expect((await handlers['scene.replaceSeed']({}, { seed })).error.code).toBe('invalid_arguments');
  expect(replacements).toHaveLength(1);
  const transparentProxy = new Proxy(fixture(), {});
  expect(validate(transparentProxy).ok).toBe(false);
  expect((await handlers['scene.replaceSeed']({}, { seed: transparentProxy })).status).toBe('rejected');
  expect(replacements).toHaveLength(1);
});

test('complete custom seeds accept empty models and independent null note selection without merging', () => {
  const seed = fixture();
  seed.notes.notes = [];
  seed.notes.selectedId = null;
  seed.notes.folder = 'deleted';
  seed.notes.search = 'No matching notes';
  seed.files.files = seed.files.files.filter(file => ['disk', 'desktop', 'downloads', 'trash'].includes(file.id));
  seed.files.files.find(file => file.id === 'disk').name = 'Fictional Archive';
  seed.messages.pinned = [];
  seed.messages.conversations = [];
  seed.messages.thread.items = [];
  seed.messages.thread.name = '別の会話';
  seed.messages.thread.timestamp = '2024-02-29T23:59:59Z';
  seed.appearance = { mode: 'dark', accent: 'pink', highlight: '#A1b2C3' };
  seed.dock.pinnedAppIds = ['finder'];
  seed.dock.mainOrderAppIds = ['finder'];
  seed.dock.recentHistory = [];
  seed.dock.folderFileIds = [];
  seed.dock.folderPreferences = {};
  seed.dock.secondaryOrderItemIds = [];
  expect(validate(seed)).toEqual({ ok: true });
});

test('Golden seed preference validation rejects incomplete, extended and out-of-range settings', () => {
  for (const change of [
    seed => { delete seed.notes.preferences; },
    seed => { delete seed.notes.preferences.groupByDate; },
    seed => { seed.notes.preferences.cloud = true; },
    seed => { seed.notes.preferences.sortBy = 'name'; },
    seed => { seed.notes.preferences.groupByDate = 1; },
    seed => { seed.notes.preferences.textSize = 11; },
    seed => { seed.notes.preferences.textSize = 25; },
    seed => { seed.notes.preferences.textSize = 14.5; },
  ]) rejects(change);
  for (const textSize of [12, 24]) {
    const seed = fixture();
    seed.notes.preferences = { sortBy: 'title', groupByDate: false, textSize };
    expect(validate(seed)).toEqual({ ok: true });
  }
});


test('selected note must satisfy actual folder and whitespace-normalized search semantics', () => {
  const seed = fixture(), note = seed.notes.notes.find(note => note.id === seed.notes.selectedId);
  note.text = '東京\n  café\tmeeting';
  seed.notes.search = '東京   café';
  expect(validate(seed)).toEqual({ ok: true });
  seed.notes.search = 'absent';
  expect(validate(seed).ok).toBe(false);
  seed.notes.selectedId = null;
  expect(validate(seed)).toEqual({ ok: true });
  seed.notes.selectedId = note.id;
  seed.notes.search = '';
  seed.notes.folder = 'deleted';
  expect(validate(seed).ok).toBe(false);
  note.deleted = true;
  expect(validate(seed)).toEqual({ ok: true });
});

test('file graphs reject cycles, orphans, invalid anchors and generated installation identity overrides', () => {
  for (const change of [
    seed => { seed.files.files.find(file => file.id === 'personal').parentId = 'personal'; },
    seed => { seed.files.files.find(file => file.id === 'personal').parentId = 'missing'; },
    seed => { seed.files.files.find(file => file.id === 'personal').parentId = 'itinerary'; },
    seed => { seed.files.files.find(file => file.id === 'desktop').parentId = 'personal'; },
    seed => { seed.files.files.find(file => file.id === 'disk').deleted = true; },
    seed => { seed.files.files.find(file => file.id === 'personal').id = 'mac-application-folder:Applications'; },
    seed => { seed.files.files.find(file => file.id === 'personal').id = 'constructor'; },
    seed => { seed.files.files.find(file => file.id === 'personal').id = 'toString'; },
    seed => { const folder = seed.files.files.find(file => file.id === 'personal'); folder.parentId = 'loop'; seed.files.files.push({ ...folder, id: 'loop', parentId: 'personal', name: 'Loop' }); },
  ]) rejects(change);
});

test('case-insensitive sibling collisions reject live records but allow deleted history', () => {
  const seed = fixture(), file = seed.files.files.find(file => file.id === 'itinerary');
  seed.files.files.push({ ...file, id: 'duplicate', name: file.name.toUpperCase() });
  expect(validate(seed).ok).toBe(false);
  seed.files.files.at(-1).deleted = true;
  expect(validate(seed)).toEqual({ ok: true });
});

test('counter boundary accepts the next real increment and rejects collision or exhausted counters', () => {
  const seed = fixture(), limit = Number.MAX_SAFE_INTEGER - 1, dateLimit = 8_640_000_000_000_000 - 1;
  seed.notes.timeBase = dateLimit;
  seed.files.sceneTime = dateLimit;
  seed.files.nextFileId = limit;
  seed.files.files.find(file => file.id === 'itinerary').revision = limit;
  seed.dock.usageSequence = limit;
  expect(validate(seed)).toEqual({ ok: true });
  const noteId = createNote(seed.notes);
  expect(seed.notes.notes.find(note => note.id === noteId).createdAt).toBe(dateLimit + 1);
  expect(Number.isFinite(new Date(seed.notes.notes.find(note => note.id === noteId).updatedAt).getTime())).toBe(true);
  expect(nextMacFileTimestamp(seed.files)).toBe(dateLimit + 1);
  expect(createFile(seed.files, 'desktop', 'New.txt').id).toBe(`file-${limit}`);
  writeFile(seed.files, seed.files.files.find(file => file.id === 'itinerary'), 'New content');
  expect(seed.files.files.find(file => file.id === 'itinerary').revision).toBe(Number.MAX_SAFE_INTEGER);
  recordMacAppUse(seed.dock, 'notes');
  expect(seed.dock.usageSequence).toBe(Number.MAX_SAFE_INTEGER);
  expect(validate(seed).ok).toBe(false);
  rejects(seed => { seed.files.files.find(file => file.id === 'personal').id = 'file-12'; seed.files.nextFileId = 12; });
  rejects(seed => { seed.notes.notes[0].updatedAt = seed.notes.notes[0].createdAt - 1; });
  rejects(seed => { seed.notes.timeBase = Number.MAX_SAFE_INTEGER; });
});

test('out-of-Date-range timestamps reject before native Notes can call toISOString or Intl', () => {
  for (const change of [
    seed => { seed.notes.timeBase = Number.MAX_SAFE_INTEGER - 1; },
    seed => { seed.notes.notes[0].updatedAt = Number.MAX_SAFE_INTEGER - 1; },
    seed => { seed.files.sceneTime = Number.MAX_SAFE_INTEGER - 1; },
    seed => { seed.files.files[0].createdAt = Number.MAX_SAFE_INTEGER - 1; },
    seed => { seed.files.files[0].lastOpenedAt = Number.MAX_SAFE_INTEGER - 1; },
  ]) rejects(change);
});

test('Dock rejects hidden folder aliases, invalid permutations, window tiles and inconsistent history', () => {
  for (const change of [
    seed => { seed.dock.mainOrderAppIds.reverse(); },
    seed => { seed.dock.pinnedAppIds.push('unknown'); },
    seed => { seed.dock.mainOrderAppIds.pop(); },
    seed => { seed.dock.recentHistory = [{ appId: 'notes', sequence: 2 }]; seed.dock.usageSequence = 1; },
    seed => { seed.dock.recentHistory = [{ appId: 'notes', sequence: 1 }, { appId: 'mail', sequence: 1 }]; },
    seed => { seed.dock.secondaryOrderItemIds.push('window:notes-window'); },
    seed => { seed.dock.folderFileIds.push('trash'); },
    seed => { seed.dock.folderPreferences.personal = { view: 'fan', display: 'stack', sortBy: 'name' }; seed.files.files.find(file => file.id === 'personal').deleted = true; },
    seed => { seed.dock.preferences.size = 129; },
  ]) rejects(change);
});

test('closed schemas reject partial seeds, unknown fields, unsafe media and malformed dates', () => {
  for (const change of [
    seed => { delete seed.appearance; },
    seed => { seed.notes.extra = true; },
    seed => { seed.files.files[0].readOnly = true; },
    seed => { seed.dock.hover = null; },
    seed => { seed.messages.thread.items.push({ kind: 'trail', url: 'https://example.com/image.svg' }); },
    seed => { seed.messages.thread.tint = 'red; background:url(test)'; },
    seed => { seed.messages.pinned[0].selected = true; },
    seed => { seed.messages.thread.timestamp = '2026-02-30T09:41:00Z'; },
    seed => { seed.notes.notes.push({ ...seed.notes.notes[0] }); },
  ]) rejects(change);
  const accessor = fixture();
  Object.defineProperty(accessor.notes, 'search', { enumerable: true, get() { throw new Error('Must not execute seed accessors'); } });
  expect(validate(accessor).ok).toBe(false);
  const symbol = fixture(); symbol.notes[Symbol('extra')] = true;
  expect(validate(symbol).ok).toBe(false);
  const cyclic = fixture(); cyclic.notes.search = cyclic;
  expect(validate(cyclic).ok).toBe(false);
});

test('historical or capability-less profiles reject setup commands before malformed arguments', async () => {
  for (const unsupported of [getOSProfile('macos-mojave-10.14'), { ...profile, capabilities: profile.capabilities.filter(capability => capability !== 'scene.seed') }]) {
    expect(validateSceneSeed(fixture(), unsupported).ok).toBe(false);
    const handlers = createSceneSeedCommands({ profile: unsupported });
    for (const name of ['scene.reset', 'scene.replaceSeed']) {
      expect((await handlers[name](null, null)).error.code).toBe('unsupported_profile');
    }
  }
});

test('maximum nested seed remains discoverable and ancestor deletion/reparenting updates eligibility', () => {
  const seed = fixture(), store = seed.files;
  store.files = store.files.filter(file => ['disk', 'desktop', 'downloads', 'trash'].includes(file.id));
  for (let index = 0; index < 1020; index++) store.files.push({
    id: `fixture-${index}`, parentId: index ? `fixture-${index - 1}` : 'desktop',
    name: `Folder ${index}`, kind: 'folder', appId: 'finder', icon: 'folder', content: '', deleted: false, revision: 1,
  });
  expect(validate(seed)).toEqual({ ok: true });
  expect(liveMacFileRecords(store).some(file => file.id === 'fixture-1019')).toBe(true);
  store.files.find(file => file.id === 'fixture-10').deleted = true;
  expect(liveMacFileRecords(store).some(file => file.id === 'fixture-1019')).toBe(false);
  expect(liveMacFileRecords(store).some(file => file.id === 'fixture-9')).toBe(true);
  store.files.find(file => file.id === 'fixture-1019').parentId = 'desktop';
  expect(liveMacFileRecords(store).some(file => file.id === 'fixture-1019')).toBe(true);
  store.files.find(file => file.id === 'fixture-10').deleted = false;
  expect(liveMacFileRecords(store).some(file => file.id === 'fixture-11')).toBe(true);
});
