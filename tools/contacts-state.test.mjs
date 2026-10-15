import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactsState, createContactsWindow, createContact, validateContactsState, emptyContactSpec, createContactEditor, completedContactSpec, contactsGroupMembers, contactsDuplicates, resolveContacts, linkedContact, visibleContacts } from '../frontend/src/contacts-state.js';
import { parseContactsVCard, exportContactsVCard } from '../frontend/src/contacts-vcard.js';
import { createContactsCommands } from '../frontend/src/contacts-commands.js';

const add = (state, spec, options) => { const result = createContact(state, spec, options); assert.equal(result.status, 'applied', result.message); return result.contact; };

test('Services migration keeps authored IDs, times, revisions and source fields without another graph', () => {
  const state = createContactsState();
  const card = add(state, { name: 'Renée Rivera', email: 'renee@example.test', phone: '+1 415 555 0100', notes: 'Authored Services note' }, { id: 'services-contact-7', time: 2000, createdAt: 1000, revision: 4 });
  assert.equal(card.id, 'services-contact-7'); assert.equal(card.revision, 4); assert.equal(card.createdAt, 1000); assert.equal(card.updatedAt, 2000);
  assert.deepEqual(resolveContacts(state, 'renee'), [{ id: card.id, name: 'Renée Rivera', email: 'renee@example.test', phone: '+1 415 555 0100' }]);
  assert.equal(state.contacts[0].notes, 'Authored Services note');
});

test('invalid dates and accessor-bearing input are rejected without mutation or getter execution', () => {
  const state = createContactsState(), before = structuredClone(state), spec = emptyContactSpec(state); spec.birthday = '2023-02-29';
  assert.equal(createContact(state, spec).status, 'rejected'); assert.deepEqual(state, before);
  let invoked = false; const unsafe = { get name() { invoked = true; return 'Unsafe'; } };
  assert.equal(createContact(state, unsafe).status, 'rejected'); assert.equal(invoked, false); assert.deepEqual(state, before);
});

test('vCard Unicode folding, custom labels, structured addresses, notes and embedded photo round-trip', () => {
  const state = createContactsState(), spec = emptyContactSpec(state);
  Object.assign(spec.name, { given: 'Renée', family: 'Rivera', middle: '水'.repeat(40), phoneticGiven: 'Renee' });
  spec.emails = [{ label: 'volunteer; team', value: 'renee@example.test' }]; spec.phones = [{ label: 'trail, office', value: '+1 415 555 0100' }];
  spec.addresses = [{ label: 'camp', street: '12 Coast Road\nUnit 2', city: 'San Francisco', region: 'CA', postalCode: '94110', country: 'United States' }];
  spec.birthday = '2000-02-29'; spec.notes = 'Line one; commas, and \\ escapes\nLine two'; spec.photo = { kind: 'image', value: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1kAAAAASUVORK5CYII=' };
  const card = add(state, spec), text = exportContactsVCard(state, [card.id]);
  assert.ok(text.includes('\r\n ')); for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75);
  const imported = parseContactsVCard(createContactsState(), text); assert.equal(imported.status, 'applied', imported.message); assert.deepEqual(imported.specs[0], spec);
  const four = parseContactsVCard(createContactsState(), exportContactsVCard(state, [card.id], { version: '4.0' })); assert.deepEqual(four.specs[0], spec);
});

test('vCard rejects truncated cards and invalid fields atomically; does not fetch external photos', () => {
  const state = createContactsState(), before = structuredClone(state);
  assert.equal(parseContactsVCard(state, 'BEGIN:VCARD\nVERSION:3.0\nFN:Unfinished').status, 'rejected');
  assert.equal(parseContactsVCard(state, 'BEGIN:VCARD\nVERSION:3.0\nFN:Bad date\nBDAY:2023-02-29\nEND:VCARD').status, 'rejected');
  const result = parseContactsVCard(state, 'BEGIN:VCARD\nVERSION:4.0\nFN:Local\nPHOTO:https://example.test/photo.png\nEND:VCARD');
  assert.equal(result.status, 'applied'); assert.equal(result.specs[0].photo.kind, 'none'); assert.equal(result.warnings.length, 1); assert.deepEqual(state, before);
});

test('smart groups evaluate all/any presence and literal accent-insensitive conditions', () => {
  const state = createContactsState(), a = add(state, { name: 'Renée', email: 'renee@example.test' }), b = add(state, { name: 'Other', phone: '5550101' });
  const group = { id: 'group-smart', name: 'Email people', kind: 'smart', accountId: null, memberIds: [], match: 'all', rules: [{ field: 'email', operator: 'present', value: '' }, { field: 'name', operator: 'contains', value: 'renee' }] };
  state.groups.push(group); assert.equal(validateContactsState(state), true); assert.deepEqual(contactsGroupMembers(state, group).map(row => row.id), [a.id]);
  group.match = 'any'; group.rules[0] = { field: 'phone', operator: 'present', value: '' }; assert.deepEqual(contactsGroupMembers(state, group).map(row => row.id), [a.id, b.id]);
});

test('duplicate connected components preserve transitive matches and linked source provenance', () => {
  const state = createContactsState(), a = add(state, { name: 'Alpha', email: 'same@example.test' }), b = add(state, { name: 'Beta', email: 'same@example.test', phone: '+1 555 0100' }), c = add(state, { name: 'Gamma', phone: '+1 (555) 0100' });
  assert.deepEqual(contactsDuplicates(state).map(group => group.map(row => row.id)), [[a.id, b.id, c.id]]);
  a.links = [b.id, c.id]; b.links = [a.id, c.id]; c.links = [a.id, b.id]; assert.equal(validateContactsState(state), true);
  const card = linkedContact(state, a.id); assert.equal(card.name.given, 'Alpha'); assert.equal(card.phones.length, 2); assert.equal(b.name.given, 'Beta');
  c.links = []; assert.equal(validateContactsState(state), false);
});

test('session references cannot point to deleted cards or invalid source groups', () => {
  const state = createContactsState(), card = add(state, { name: 'Local' }), win = createContactsWindow(state, 'contacts-window'); state.windows.push(win); win.selectedIds = [card.id];
  assert.equal(validateContactsState(state), true); state.contacts = []; assert.equal(validateContactsState(state), false);
});

test('native editor drafts allow empty added rows and partial typing without authoring invalid source cards', () => {
  const state = createContactsState(), win = createContactsWindow(state, 'contacts-editor');
  state.windows.push(win); win.editor = emptyContactSpec(state);
  win.editor.emails.push({ label: '', value: 'renee@' });
  win.editor.phones.push({ label: 'mobile', value: '' });
  win.editor.addresses.push({ label: 'home', street: '', city: '', region: '', postalCode: '', country: '' });
  win.editor.urls.push({ label: 'web', value: 'https:' }); win.editor.birthday = '2000-02';
  assert.equal(validateContactsState(state), true);
  assert.equal(createContact(state, win.editor).status, 'rejected');
  assert.equal(state.contacts.length, 0);
});

test('new-card template seeds real labelled draft rows and save removes only wholly blank values', () => {
  const state = createContactsState(); state.template.fields = ['given', 'family', 'emails'];
  state.template.labels = [{ field: 'emails', label: 'volunteer team' }];
  const editor = createContactEditor(state); assert.deepEqual(editor.emails, [{ label: 'volunteer team', value: '' }]); assert.equal(editor.phones.length, 0);
  editor.name.given = 'Renée'; editor.emails.push({ label: 'custom', value: 'not-yet-valid' });
  const spec = completedContactSpec(editor); assert.deepEqual(spec.emails, [{ label: 'custom', value: 'not-yet-valid' }]);
  assert.equal(createContact(state, spec).status, 'rejected'); assert.equal(state.contacts.length, 0);
  editor.emails[1].value = 'renee@example.test'; assert.equal(createContact(state, completedContactSpec(editor)).status, 'applied');
});

test('search finds otherwise undisplayed name fields, birthdays and custom endpoint labels', () => {
  const state = createContactsState(), spec = emptyContactSpec(state);
  Object.assign(spec.name, { given: 'Renée', phoneticGiven: 'Reh-nay' }); spec.birthday = '2000-02-29';
  spec.emails = [{ label: 'volunteer team', value: 'renee@example.test' }];
  const card = add(state, spec), win = createContactsWindow(state, 'contacts-search'); state.windows.push(win);
  for (const query of ['reh-nay', '2000-02-29', 'volunteer team']) { win.query = query; assert.deepEqual(visibleContacts(state, win.windowId).map(row => row.id), [card.id]); }
});

function commandOwner(state, extras = {}) {
  const profile = { id: 'macos-sonoma-14.0', renderer: 'sonoma' }, window = { id: 'contacts-native' };
  const view = { available: () => true }, session = createContactsWindow(state, window.id); state.windows.push(session);
  const controller = createContactsCommands({ profile, getState: () => state, getWindow: id => id === window.id ? window : null, getView: () => view, available: () => true, ...extras });
  return { controller, session, target: { windowId: window.id } };
}

test('saving from an empty filtered group reveals the newly created original card', async () => {
  const state = createContactsState();
  state.groups.push({ id: 'empty-group', name: 'Empty', kind: 'group', accountId: null, memberIds: [], match: 'all', rules: [] });
  const { controller, session, target } = commandOwner(state); session.groupId = 'empty-group'; session.query = 'not this name';
  session.editor = emptyContactSpec(state); session.editor.name.given = 'Original';
  const result = await controller.handlers['contacts.editor.save'](target, {});
  assert.equal(result.status, 'applied'); assert.equal(session.groupId, null); assert.equal(session.query, '');
  assert.deepEqual(visibleContacts(state, target.windowId).map(card => card.id), session.selectedIds);
  assert.equal(state.contacts[0].name.given, 'Original'); assert.equal(state.contacts[0].id, result.contactId);
});

test('async destinations cannot substitute a byte-identical replacement endpoint', async () => {
  const state = createContactsState(), card = add(state, { name: 'Original', email: 'original@example.test' });
  let resolve, capturedGuard;
  const { controller, target } = commandOwner(state, { composeMail: async (spec, owner) => { capturedGuard = owner.guard; assert.equal(spec.to[0].email, 'original@example.test'); return new Promise(done => { resolve = done; }); } });
  const pending = controller.handlers['contacts.action'](target, { contactId: card.id, kind: 'mail', index: 0 });
  assert.equal(capturedGuard(), true); card.emails[0] = { ...card.emails[0] }; assert.equal(capturedGuard(), false);
  resolve({ status: 'applied', draftId: 'must-not-be-accepted' }); assert.equal((await pending).code, 'stale_target');
});

test('async destinations reject source-account changes without relying on card revision', async () => {
  const state = createContactsState(), card = add(state, { name: 'Original', email: 'original@example.test' });
  let resolve, capturedGuard;
  const { controller, target } = commandOwner(state, { composeMail: async (_spec, owner) => { capturedGuard = owner.guard; return new Promise(done => { resolve = done; }); } });
  const pending = controller.handlers['contacts.action'](target, { contactId: card.id, kind: 'mail', index: 0 });
  state.accounts[0].enabled = false; assert.equal(capturedGuard(), false);
  resolve({ status: 'applied' }); assert.equal((await pending).code, 'stale_target');
});

test('opening a separate canonical card window retains source and endpoint identities', async () => {
  const state = createContactsState(), card = add(state, { name: 'Original', email: 'original@example.test' });
  const endpoint = card.emails[0], records = state.contacts, before = JSON.stringify(card);
  const windows = new Map([['contacts-native', { id: 'contacts-native' }]]);
  const view = { available: () => true }; let controller;
  const owner = commandOwner(state, {
    canCommit: () => true, getWindow: id => windows.get(id), getView: () => view,
    createWindow: async (_appId, options) => {
      assert.equal(options.isCurrent(), true);
      const destination = { id: 'contacts-separate' }; windows.set(destination.id, destination);
      assert.equal(controller.windowOpened(destination, options), true);
      assert.equal(options.isCurrent(), true);
      return destination.id;
    },
  });
  controller = owner.controller;
  const result = await controller.handlers['contacts.card.open'](owner.target, { contactId: card.id });
  assert.equal(result.status, 'applied'); assert.equal(result.target.windowId, 'contacts-separate');
  assert.equal(state.contacts, records); assert.equal(state.contacts[0], card); assert.equal(card.emails[0], endpoint);
  assert.equal(JSON.stringify(card), before); assert.equal(state.contacts.length, 1);
  assert.deepEqual(state.windows[1].selectedIds, [card.id]); assert.equal(state.windows[1].sidebarVisible, false);
});
