import { expect, test } from 'bun:test';
import { goldenGateProfile as profile } from '../frontend/src/golden-gate-profile.js';
import { createDefaultSceneSeed, validateSceneSeed } from '../frontend/src/scene-seed.js';
import { postNotification } from '../frontend/src/notification-model.js';
import { communicationDefaults, draftPreview, createCommunicationDraft, submitCommunicationDraft,
  replyToCommunication, selectCommunicationEntry } from '../frontend/src/communication-state.js';
import { resolveNotificationDestination, retainNotificationDestination, notificationDestinationActions } from '../frontend/src/notification-destinations.js';
import { setWidgetReminderCompleted } from '../frontend/src/notification-widget-model.js';

const sources = seed => ({ notes: seed.notes, files: seed.files, communications: seed.communications, widgets: seed.system.widgets });
function sent(state, kind, fields, sceneTime = state.timeBase) {
  const draft = draftPreview(state, kind, fields, [], sceneTime);
  expect(createCommunicationDraft(state, draft, () => true, sceneTime).status).toBe('applied');
  const result = submitCommunicationDraft(state, draft.id, () => true, sceneTime);
  expect(result.status).toBe('applied');
  return result.target.recordId;
}
function linked(seed, appId, kind, recordId) {
  const result = postNotification(seed.system.notifications, profile, appId, {
    title: 'Original source', body: 'An authored local arrival.', destination: { kind, recordId },
  }, seed.files.sceneTime);
  expect(result.status).toBe('applied');
  return seed.system.notifications.entries.find(entry => entry.id === result.target.notificationId);
}

test('complete seeds reject wrong-domain and invented source identities without consuming or changing the original seed', () => {
  const seed = createDefaultSceneSeed(profile), messageId = sent(seed.communications, 'message', { to: 'Eli', body: 'First sent-local message' });
  seed.files.sceneTime = seed.communications.timeBase;
  linked(seed, 'messages', 'message', messageId);
  linked(seed, 'calendar', 'event', 'event-2');
  linked(seed, 'notes', 'note', 'note-2');
  const mailId = sent(seed.communications, 'mail', { to: 'Mika', subject: 'Another domain', body: 'Actual local mail' });
  const draft = draftPreview(seed.communications, 'message', { to: 'Eli', body: 'Not yet sent' });
  expect(createCommunicationDraft(seed.communications, draft).status).toBe('applied');
  seed.files.sceneTime = seed.communications.timeBase;
  expect(validateSceneSeed(seed, profile).ok).toBe(true);
  for (const destination of [{ kind: 'message', recordId: draft.id }, { kind: 'message', recordId: mailId }]) {
    const candidate = structuredClone(seed); candidate.system.notifications.entries[0].destination = destination;
    const before = structuredClone(candidate);
    expect(validateSceneSeed(candidate, profile).ok).toBe(false);
    expect(candidate).toEqual(before);
  }
});

test('document links reject folders, foreign associations and documents behind a trashed ancestor', () => {
  const seed = createDefaultSceneSeed(profile), file = seed.files.files.find(record => ['document', 'image'].includes(record.kind));
  const entry = linked(seed, file.appId, 'file', file.id), state = sources(seed);
  expect(resolveNotificationDestination(entry, state, profile)?.record).toBe(file);
  const wrongApp = { ...entry, appId: file.appId === 'preview' ? 'notes' : 'preview' };
  expect(resolveNotificationDestination(wrongApp, state, profile)).toBeNull();
  expect(resolveNotificationDestination({ ...entry, appId: 'finder', destination: { kind: 'file', recordId: 'desktop' } }, state, profile)).toBeNull();
  const parent = seed.files.files.find(record => record.id === file.parentId); parent.deleted = true;
  expect(resolveNotificationDestination(entry, state, profile)).toBeNull();
});

test('retained links survive unrelated arrivals but reject same-ID replacements, metadata edits and retired original Roots', () => {
  let seed = createDefaultSceneSeed(profile), alive = true;
  const entry = linked(seed, 'notes', 'note', 'note-2'), lease = retainNotificationDestination(entry, () => sources(seed), profile, () => alive);
  seed.notes.notes.push({ ...seed.notes.notes[0], id: 'note-99' });
  expect(lease.current()).toBe(true);
  const original = seed.notes.notes.find(record => record.id === 'note-2');
  const text = original.text;
  original.text += ' changed'; expect(lease.current()).toBe(false); original.text = text;
  expect(lease.current()).toBe(true);
  seed.notes.notes = seed.notes.notes.map(record => record.id === 'note-2' ? { ...record } : record);
  expect(lease.current()).toBe(false);
  seed = createDefaultSceneSeed(profile); expect(lease.current()).toBe(false);
  alive = false; expect(lease.current()).toBe(false);
});

test('getter destinations never execute and completed shared reminders stop offering completion or snooze', () => {
  const seed = createDefaultSceneSeed(profile), entry = linked(seed, 'reminders', 'reminder', 'reminder-1');
  const source = resolveNotificationDestination(entry, sources(seed), profile);
  expect(notificationDestinationActions(source)).toContain('complete');
  expect(setWidgetReminderCompleted(seed.system.widgets, 'reminder-1', true).status).toBe('applied');
  expect(notificationDestinationActions(resolveNotificationDestination(entry, sources(seed), profile))).toEqual(['open']);
  let reads = 0;
  const destination = { kind: 'reminder', get recordId() { reads++; return 'reminder-1'; } };
  expect(resolveNotificationDestination({ ...entry, destination }, sources(seed), profile)).toBeNull();
  expect(reads).toBe(0);
});

test('notification message replies commit one actual sent-local recipient/body and follow the shared clock without changing the original record', () => {
  const state = communicationDefaults(1000), recordId = sent(state, 'message', { to: 'Eli Nash', body: 'Original message' });
  const original = structuredClone(state.outbox[0]), nextId = state.nextId;
  const result = replyToCommunication(state, recordId, ' \r\nLiteral 🎬 reply\ufeff ', () => true, 2000);
  expect(result.status).toBe('applied');
  expect(state.outbox.find(record => record.id === result.target.recordId)).toMatchObject({
    kind: 'message', createdAt: 2001, updatedAt: 2001, fields: { to: 'Eli Nash', body: ' \r\nLiteral 🎬 reply\ufeff ' },
  });
  expect(state.outbox.find(record => record.id === recordId)).toEqual(original);
  expect(state.selected.messages).toBe(result.target.recordId);
  expect(state.timeBase).toBe(2001); expect(state.nextId).toBe(nextId + 1); expect(state.drafts).toEqual([]);
});

test('mail notification replies preserve recipient and single Re subject without forwarding original attachments', () => {
  const state = communicationDefaults(1000), recordId = sent(state, 'mail', { to: 'mika@example.invalid', subject: 'Trail plan', body: 'Original mail' });
  const original = state.outbox[0]; original.attachments.push({ fileId: 'itinerary', name: 'Plan.txt', revision: 1, content: 'Private original attachment' });
  const first = replyToCommunication(state, recordId, 'Mail reply');
  expect(first.status).toBe('applied');
  const record = state.outbox.find(entry => entry.id === first.target.recordId);
  expect(record.fields).toEqual({ to: 'mika@example.invalid', subject: 'Re: Trail plan', body: 'Mail reply' });
  expect(record.attachments).toEqual([]);
  const second = replyToCommunication(state, record.id, 'Second reply');
  expect(second.status).toBe('applied');
  expect(state.outbox.find(entry => entry.id === second.target.recordId).fields.subject).toBe('Re: Trail plan');
  expect(state.outbox.find(entry => entry.id === recordId).attachments[0].content).toBe('Private original attachment');
});

test('reply budget denial and unrelated quota-callback reentry cannot consume an allocation or overwrite a newer selection', () => {
  const state = communicationDefaults(1000), recordId = sent(state, 'message', { to: 'Eli', body: 'Original' });
  const before = structuredClone(state);
  expect(replyToCommunication(state, recordId, 'Rejected reply', () => false).status).toBe('rejected');
  expect(state).toEqual(before);
  const result = replyToCommunication(state, recordId, 'Stale reply', () => {
    expect(selectCommunicationEntry(state, 'messages', null).status).toBe('applied');
    return true;
  });
  expect(result.error.code).toBe('unavailable');
  expect(state).toEqual({ ...before, selected: { ...before.selected, messages: null } });
});

test('full unrelated draft capacity does not turn notification reply into a draft shim', () => {
  const state = communicationDefaults(1000), recordId = sent(state, 'message', { to: 'Eli', body: 'Original' });
  for (let index = 0; index < 128; index++) {
    const draft = draftPreview(state, 'message', { to: 'Someone else', body: `Unrelated draft ${index}` });
    expect(createCommunicationDraft(state, draft).status).toBe('applied');
  }
  const drafts = structuredClone(state.drafts), nextId = state.nextId;
  expect(replyToCommunication(state, recordId, 'A real local reply').status).toBe('applied');
  expect(state.drafts).toEqual(drafts); expect(state.nextId).toBe(nextId + 1);
  expect(state.outbox.at(-1).fields.body).toBe('A real local reply');
});
