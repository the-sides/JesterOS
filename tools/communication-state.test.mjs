import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import {
  communicationDefaults, validateCommunications, communicationEntries, communicationEntry, draftPreview,
  createCommunicationDraft, changeCommunicationDraft, submitCommunicationDraft, discardCommunicationDraft, selectCommunicationEntry,
} from '../frontend/src/communication-state.js';

const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { proxy } = await import(frontendRequire.resolve('svelte/internal/client'));
const TIME = Date.UTC(2026, 8, 28, 9, 41), MAX_TEXT = 1024 * 1024;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1, MAX_TIME = 8_640_000_000_000_000 - 1;
const fieldsFor = kind => kind === 'contact' ? { name: 'Casey', email: '', phone: '', notes: '' }
  : kind === 'mail' ? { to: 'casey@example.test', subject: 'Local draft', body: 'Unsent bytes' }
    : { to: '+1 fictional', body: 'Unsent bytes' };
const snapshot = state => JSON.parse(JSON.stringify(state));
function create(state, kind = 'mail', fields = fieldsFor(kind), attachments = []) {
  const preview = draftPreview(state, kind, fields, attachments);
  expect(preview).not.toBeNull();
  const result = createCommunicationDraft(state, preview);
  expect(result.status).toBe('applied');
  return result.target.draftId;
}
function unchanged(state, operation, code) {
  const before = snapshot(state), result = operation();
  expect(result.status).toBe('rejected');
  if (code) expect(result.error.code).toBe(code);
  expect(snapshot(state)).toEqual(before);
  return result;
}
function populate(state, collection, kind, count) {
  const fields = fieldsFor(kind);
  for (let index = 0; index < count; index++) {
    const id = state.nextId++, time = ++state.timeBase;
    state[collection].push({ id: `service-${collection === 'drafts' ? 'draft' : kind}-${id}`, kind,
      createdAt: time, updatedAt: time, revision: 1, fields: { ...fields }, ...(kind === 'mail' ? { attachments: [] } : {}) });
  }
  expect(validateCommunications(state)).toEqual({ ok: true });
}

test('real records start empty; previews preserve exact bytes without allocating or selecting', () => {
  const state = communicationDefaults(TIME), before = snapshot(state);
  expect(validateCommunications(state)).toEqual({ ok: true });
  expect(state).toEqual({ timeBase: TIME, nextId: 1, contacts: [], drafts: [], outbox: [],
    selected: { contacts: null, mail: null, messages: null } });
  const fields = { to: '', subject: '', body: '\ufeff  café\r\n\u{1D11E}\t\u0000 tail  ' };
  const attachment = { fileId: 'file-9', name: '原稿.txt', revision: 7, content: '\ufeffsource\r\n\u{1D11E}\u0000' };
  const preview = draftPreview(state, 'mail', fields, [attachment]);
  expect(preview).toEqual({ id: 'service-draft-1', kind: 'mail', createdAt: TIME + 1, updatedAt: TIME + 1,
    revision: 1, fields, attachments: [attachment] });
  expect(state).toEqual(before);
  fields.body = 'actor edited'; attachment.content = 'source changed';
  expect(preview.fields.body).toBe('\ufeff  café\r\n\u{1D11E}\t\u0000 tail  ');
  expect(preview.attachments[0].content).toBe('\ufeffsource\r\n\u{1D11E}\u0000');
  expect(createCommunicationDraft(state, preview).status).toBe('applied');
  preview.fields.body = 'preview edited'; preview.attachments[0].content = 'preview changed';
  expect(state.drafts[0].fields.body).toBe('\ufeff  café\r\n\u{1D11E}\t\u0000 tail  ');
  expect(state.drafts[0].attachments[0].content).toBe('\ufeffsource\r\n\u{1D11E}\u0000');
  expect(state.outbox).toEqual([]);
  expect(state.selected.mail).toBe('service-draft-1');
});

test('Done and Send explicitly create channel records, consume one shared allocation and preserve immutable snapshots', () => {
  const state = communicationDefaults(TIME), source = { fileId: 'file-4', name: 'Draft.md', revision: 3, content: '\r\n Original \u{1D11E} \n' };
  const contactId = create(state, 'contact', { name: '  Casey  ', email: 'casey@example.test', phone: '555 local', notes: '  notes\r\n ' });
  expect(state.contacts).toEqual([]);
  const contactResult = submitCommunicationDraft(state, contactId);
  expect(contactResult.target).toEqual({ draftId: 'service-draft-1', recordId: 'service-contact-2', kind: 'contact' });
  const mailId = create(state, 'mail', { to: '  Casey  ', subject: '', body: ' \r\n ' }, [source]);
  const storedDraft = communicationEntry(state, 'mail');
  source.content = 'source edited'; source.name = 'renamed'; source.revision++;
  const mailResult = submitCommunicationDraft(state, mailId);
  expect(mailResult.target).toEqual({ draftId: 'service-draft-3', recordId: 'service-mail-4', kind: 'mail' });
  const sent = communicationEntry(state, 'mail');
  expect(sent.attachments).toEqual([{ fileId: 'file-4', name: 'Draft.md', revision: 3, content: '\r\n Original \u{1D11E} \n' }]);
  expect(sent.fields).toEqual({ to: '  Casey  ', subject: '', body: ' \r\n ' });
  expect(sent.attachments[0]).not.toBe(storedDraft.attachments[0]);
  storedDraft.attachments[0].content = 'obsolete draft mutation';
  expect(sent.attachments[0].content).toBe('\r\n Original \u{1D11E} \n');
  expect(sent.createdAt).toBe(TIME + 4); expect(sent.updatedAt).toBe(TIME + 4); expect(sent.revision).toBe(1);
  const messageId = create(state, 'message');
  expect(submitCommunicationDraft(state, messageId).target.recordId).toBe('service-message-6');
  expect(state.selected).toEqual({ contacts: 'service-contact-2', mail: 'service-mail-4', messages: 'service-message-6' });
  expect(state.nextId).toBe(7); expect(state.timeBase).toBe(TIME + 6); expect(state.drafts).toEqual([]);
  expect(validateCommunications(state)).toEqual({ ok: true });
});

test('budget callbacks see the detached complete prospective state before mutation, with atomic rejection and no alias escape', () => {
  const state = communicationDefaults(TIME), preview = draftPreview(state, 'mail', fieldsFor('mail'));
  let candidate;
  unchanged(state, () => createCommunicationDraft(state, preview, next => {
    candidate = next;
    expect(state.drafts).toEqual([]); expect(state.nextId).toBe(1);
    expect(next.nextId).toBe(2); expect(next.selected.mail).toBe(preview.id);
    expect(validateCommunications(next)).toEqual({ ok: true });
    next.selected.contacts = 'callback mutation';
    return false;
  }), 'limit_exceeded');
  expect(candidate.contacts).not.toBe(state.contacts);
  const draftId = create(state), beforeChange = snapshot(state);
  unchanged(state, () => changeCommunicationDraft(state, draftId, 'body', 'changed', next => {
    expect(snapshot(state)).toEqual(beforeChange);
    expect(next.drafts[0].fields.body).toBe('changed'); expect(next.drafts[0].revision).toBe(2);
    next.drafts[0].fields.body = 'budget mutation'; return false;
  }), 'limit_exceeded');
  unchanged(state, () => submitCommunicationDraft(state, draftId, next => {
    expect(next.drafts).toEqual([]); expect(next.outbox[0].fields.body).toBe('Unsent bytes');
    expect(next.selected.mail).toBe(next.outbox[0].id); next.outbox[0].fields.body = 'callback mutation'; return false;
  }), 'limit_exceeded');
  unchanged(state, () => changeCommunicationDraft(state, draftId, 'body', 'changed', () => { throw Error('budget unavailable'); }), 'limit_exceeded');
  expect(changeCommunicationDraft(state, draftId, 'body', 'actual', next => {
    candidate = next; next.drafts[0].fields.body = 'tampered'; return true;
  }).status).toBe('applied');
  expect(state.drafts[0].fields.body).toBe('actual');
  candidate.drafts[0].fields.body = 'later mutation'; expect(state.drafts[0].fields.body).toBe('actual');
});

test('real edits advance revision and the scene clock; unchanged values and selections do not', () => {
  const state = communicationDefaults(TIME), first = create(state, 'message'), second = create(state, 'message');
  expect(communicationEntries(state, 'messages').map(entry => entry.id)).toEqual([second, first]);
  expect(communicationEntry(state, 'messages', first)).toBe(state.drafts[0]);
  expect(changeCommunicationDraft(state, first, 'body', ' newer\r\n\u{1D11E} ').status).toBe('applied');
  const current = communicationEntry(state, 'messages', first), before = snapshot(state);
  expect(current.revision).toBe(2); expect(current.updatedAt).toBe(TIME + 3);
  expect(current.createdAt).toBe(TIME + 1);
  expect(communicationEntries(state, 'messages')[0]).toBe(current);
  let called = false;
  expect(changeCommunicationDraft(state, first, 'body', current.fields.body, () => { called = true; return false; }).status).toBe('applied');
  expect(called).toBe(false); expect(snapshot(state)).toEqual(before);
  expect(selectCommunicationEntry(state, 'messages', first).status).toBe('applied');
  expect(state.timeBase).toBe(TIME + 3); expect(state.nextId).toBe(3);
  expect(selectCommunicationEntry(state, 'messages', null).status).toBe('applied');
  expect(communicationEntry(state, 'messages')).toBeNull();
  expect(communicationEntries(state, 'messages')).toHaveLength(2);
});

test('discard only removes the exact draft and chooses the newest same-channel survivor, without allocating or editing records', () => {
  const state = communicationDefaults(TIME), mail = create(state), old = create(state, 'message');
  const recordId = submitCommunicationDraft(state, old).target.recordId, first = create(state, 'message'), last = create(state, 'message');
  const clock = state.timeBase, counter = state.nextId;
  expect(discardCommunicationDraft(state, first).status).toBe('applied'); expect(state.selected.messages).toBe(last);
  expect(discardCommunicationDraft(state, last).target.entryId).toBe(recordId);
  expect(state.selected.mail).toBe(mail); expect(state.outbox[0].id).toBe(recordId);
  expect(state.timeBase).toBe(clock); expect(state.nextId).toBe(counter);
  expect(discardCommunicationDraft(state, mail).target.entryId).toBeNull();
  unchanged(state, () => discardCommunicationDraft(state, recordId), 'not_found');
});

test('recipient and identifying rules allow honest editable drafts but never an empty contact or fake empty send', () => {
  const state = communicationDefaults(TIME);
  for (const kind of ['contact', 'mail', 'message']) {
    const fields = Object.fromEntries(Object.keys(fieldsFor(kind)).map(key => [key, ['body', 'notes'].includes(key) ? ' \r\n\t ' : ' \t ']));
    const id = create(state, kind, fields);
    unchanged(state, () => submitCommunicationDraft(state, id), 'invalid_arguments');
    const identifying = kind === 'contact' ? 'phone' : 'to';
    expect(changeCommunicationDraft(state, id, identifying, 'fictional recipient').status).toBe('applied');
    if (kind !== 'contact') {
      unchanged(state, () => submitCommunicationDraft(state, id), 'invalid_arguments');
      expect(changeCommunicationDraft(state, id, 'body', ' real local bytes ').status).toBe('applied');
    }
    expect(submitCommunicationDraft(state, id).status).toBe('applied');
  }
  expect(validateCommunications(state)).toEqual({ ok: true });
});

test('closed fields and channel references reject invalid operations while preserving every byte and counter', () => {
  const state = communicationDefaults(TIME), contact = create(state, 'contact'), mail = create(state), message = create(state, 'message');
  for (const [id, field] of [[contact, 'to'], [mail, 'email'], [message, 'subject'], [mail, 'attachments'], [contact, 'constructor']]) {
    unchanged(state, () => changeCommunicationDraft(state, id, field, 'bad'), 'invalid_arguments');
  }
  for (const [appId, id] of [['mail', contact], ['contacts', message], ['messages', mail], ['mail', 'missing']]) {
    unchanged(state, () => selectCommunicationEntry(state, appId, id), 'not_found');
  }
  unchanged(state, () => selectCommunicationEntry(state, 'notes', null), 'invalid_arguments');
  unchanged(state, () => selectCommunicationEntry(state, 'mail', undefined), 'invalid_arguments');
  unchanged(state, () => changeCommunicationDraft(state, mail, 'to', 'x'.repeat(4097)), 'invalid_arguments');
  unchanged(state, () => changeCommunicationDraft(state, mail, 'body', 'x'.repeat(MAX_TEXT + 1)), 'invalid_arguments');
  unchanged(state, () => changeCommunicationDraft(state, 'missing', 'body', 'bytes'), 'not_found');
  expect(communicationEntry(state, 'mail', contact)).toBeNull();
  expect(communicationEntries(state, 'notes')).toEqual([]);
});

test('actor proxies, accessors, symbols, exotic objects and sparse snapshots reject without invoking getters or coercion', () => {
  const state = communicationDefaults(TIME), before = snapshot(state), fields = fieldsFor('mail');
  let getters = 0;
  const accessor = { ...fields }; Object.defineProperty(accessor, 'body', { enumerable: true, get() { getters++; throw Error('actor getter'); } });
  const symbol = { ...fields, [Symbol('actor')]: true }, exotic = Object.assign(Object.create({ inherited: true }), fields);
  for (const input of [accessor, symbol, exotic, new Proxy(fields, {}), new Proxy(fields, { ownKeys() { throw Error('trap'); } })]) {
    expect(draftPreview(state, 'mail', input)).toBeNull(); expect(snapshot(state)).toEqual(before);
  }
  expect(draftPreview(state, { toString() { throw Error('coercion'); } }, fields)).toBeNull();
  const attachment = { fileId: 'file-1', name: 'Snapshot.txt', revision: 1, content: 'actual' };
  for (const attachments of [new Proxy([attachment], {}), [new Proxy(attachment, {})], new Array(1), [{ ...attachment, url: 'https://example.test' }]]) {
    expect(draftPreview(state, 'mail', fields, attachments)).toBeNull();
  }
  const preview = draftPreview(state, 'mail', fields);
  for (const input of [new Proxy(preview, {}), { ...preview, extra: true }, { ...preview, kind: {} }, { ...preview, fields: accessor }]) {
    unchanged(state, () => createCommunicationDraft(state, input), 'invalid_arguments');
  }
  expect(getters).toBe(0);
  const hostile = new Proxy({}, { ownKeys() { throw Error('invalid model'); } });
  expect(validateCommunications(hostile).ok).toBe(false);
  expect(createCommunicationDraft(hostile, preview).status).toBe('rejected');
});

test('stale allocation and clock previews never leak IDs, drafts or selections', () => {
  const state = communicationDefaults(TIME), preview = draftPreview(state, 'mail', fieldsFor('mail'));
  const id = create(state, 'message');
  unchanged(state, () => createCommunicationDraft(state, preview), 'stale_target');
  const next = draftPreview(state, 'mail', fieldsFor('mail'));
  expect(changeCommunicationDraft(state, id, 'body', 'clock changed').status).toBe('applied');
  unchanged(state, () => createCommunicationDraft(state, next), 'stale_target');
});

test('draft, contact, outbox and attachment capacities reject atomically at their actual collection boundaries', () => {
  const drafts = communicationDefaults(TIME); populate(drafts, 'drafts', 'message', 127); create(drafts, 'message');
  const draftBefore = snapshot(drafts); expect(draftPreview(drafts, 'message', fieldsFor('message'))).toBeNull(); expect(snapshot(drafts)).toEqual(draftBefore);
  for (const [collection, kind] of [['contacts', 'contact'], ['outbox', 'message']]) {
    const state = communicationDefaults(TIME); populate(state, collection, kind, 1023);
    expect(submitCommunicationDraft(state, create(state, kind)).status).toBe('applied');
    const id = create(state, kind); unchanged(state, () => submitCommunicationDraft(state, id), 'limit_exceeded');
  }
  const state = communicationDefaults(TIME), attachments = Array.from({ length: 128 }, (_, index) => ({ fileId: `file-${index + 1}`, name: 'Real.txt', revision: 1, content: '' }));
  expect(draftPreview(state, 'mail', fieldsFor('mail'), attachments)?.attachments).toHaveLength(128);
  expect(draftPreview(state, 'mail', fieldsFor('mail'), [...attachments, attachments[0]])).toBeNull();
  expect(draftPreview(state, 'message', fieldsFor('message'), [attachments[0]])).toBeNull();
});

test('counter, Date clock and revision boundaries remain valid after the last allowed operation and then reject atomically', () => {
  const state = communicationDefaults(TIME); state.nextId = MAX_COUNTER - 1;
  const id = create(state); expect(state.nextId).toBe(MAX_COUNTER); expect(validateCommunications(state).ok).toBe(true);
  expect(draftPreview(state, 'mail', fieldsFor('mail'))).toBeNull();
  unchanged(state, () => submitCommunicationDraft(state, id), 'limit_exceeded');
  const clock = communicationDefaults(MAX_TIME - 1), clockId = create(clock);
  expect(clock.timeBase).toBe(MAX_TIME); expect(validateCommunications(clock).ok).toBe(true);
  unchanged(clock, () => changeCommunicationDraft(clock, clockId, 'body', 'edit'), 'limit_exceeded');
  expect(draftPreview(clock, 'mail', fieldsFor('mail'))).toBeNull();
  const revision = communicationDefaults(TIME), revisionId = create(revision); revision.drafts[0].revision = MAX_COUNTER - 1;
  expect(changeCommunicationDraft(revision, revisionId, 'body', 'last edit').status).toBe('applied');
  expect(revision.drafts[0].revision).toBe(MAX_COUNTER); expect(validateCommunications(revision).ok).toBe(true);
  unchanged(revision, () => changeCommunicationDraft(revision, revisionId, 'body', 'one too many'), 'limit_exceeded');
});

test('per-field and aggregate bounds preserve body and attachment bytes instead of trimming or truncating', () => {
  const state = communicationDefaults(TIME), name = 'N'.repeat(4096);
  const contact = create(state, 'contact', { name, email: '', phone: '', notes: 'x'.repeat(MAX_TEXT) });
  expect(state.drafts[0].fields.name).toBe(name);
  expect(submitCommunicationDraft(state, contact).status).toBe('applied');
  create(state, 'contact', { ...fieldsFor('contact'), notes: 'y'.repeat(MAX_TEXT) });
  create(state, 'contact', { ...fieldsFor('contact'), notes: 'z'.repeat(MAX_TEXT) });
  const last = create(state, 'contact');
  unchanged(state, () => changeCommunicationDraft(state, last, 'notes', 'w'.repeat(MAX_TEXT)), 'limit_exceeded');
  const attachment = { fileId: 'file-1', name: 'f'.repeat(255), revision: 1, content: 'a'.repeat(MAX_TEXT) };
  const empty = communicationDefaults(TIME);
  expect(draftPreview(empty, 'mail', fieldsFor('mail'), [attachment])).not.toBeNull();
  expect(draftPreview(empty, 'mail', fieldsFor('mail'), [{ ...attachment, name: 'f'.repeat(256) }])).toBeNull();
  expect(draftPreview(empty, 'mail', fieldsFor('mail'), [{ ...attachment, content: 'a'.repeat(MAX_TEXT + 1) }])).toBeNull();
  expect(draftPreview(empty, 'mail', fieldsFor('mail'), Array(4).fill(attachment))).toBeNull();
});

test('complete state validation closes record kinds, allocation numbers, timestamps, selections and immutable attachment fields', () => {
  const state = communicationDefaults(TIME), mail = create(state); submitCommunicationDraft(state, mail);
  const contact = create(state, 'contact'); submitCommunicationDraft(state, contact);
  for (const change of [
    model => { delete model.selected.messages; }, model => { model.extra = true; }, model => { model.selected.mail = model.contacts[0].id; },
    model => { model.nextId = 4; }, model => { model.timeBase = model.outbox[0].updatedAt - 1; },
    model => { model.outbox[0].id = 'service-message-2'; }, model => { model.contacts[0].id = 'service-contact-2'; },
    model => { model.outbox[0].revision = 0; }, model => { model.outbox[0].createdAt = model.outbox[0].updatedAt + 1; },
    model => { model.outbox[0].fields.to = ' \n '; }, model => { model.contacts[0].fields.name = ''; },
    model => { model.contacts[0].attachments = []; }, model => { model.outbox[0].delivered = true; },
    model => { model.outbox[0].attachments = [{ fileId: 'constructor', name: 'file', revision: 1, content: 'bytes' }]; },
    model => { model.outbox[0].attachments = [{ fileId: 'file-1', name: 'file', revision: 0, content: 'bytes' }]; },
    model => { model.outbox[0].attachments = [{ fileId: 'file-1', name: 'file', revision: 1, content: 'bytes', path: '/host/file' }]; },
  ]) {
    const changed = structuredClone(state); change(changed); const before = snapshot(changed);
    expect(validateCommunications(changed).ok).toBe(false); expect(snapshot(changed)).toEqual(before);
  }
});

test('renderer Svelte deep state remains writable while candidate callbacks stay plain and actor proxy inputs remain rejected', () => {
  const state = proxy(communicationDefaults(TIME));
  const preview = draftPreview(state, 'contact', fieldsFor('contact'));
  expect(preview).not.toBeNull();
  expect(createCommunicationDraft(state, preview, candidate => {
    expect(structuredClone(candidate)).toEqual(candidate); return true;
  }).status).toBe('applied');
  const draftId = state.selected.contacts;
  expect(changeCommunicationDraft(state, draftId, 'notes', 'actual reactive edit').status).toBe('applied');
  expect(submitCommunicationDraft(state, draftId).status).toBe('applied');
  expect(communicationEntry(state, 'contacts').fields.notes).toBe('actual reactive edit');
  expect(validateCommunications(state)).toEqual({ ok: true });
  const frozen = Object.freeze(communicationDefaults(TIME)), frozenPreview = draftPreview(frozen, 'mail', fieldsFor('mail'));
  unchanged(frozen, () => createCommunicationDraft(frozen, frozenPreview), 'invalid_arguments');
});
