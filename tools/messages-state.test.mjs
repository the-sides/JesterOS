import { expect, test } from 'bun:test';
import { messageSearchResults, messageSearchSegments, messagesHistoryCutoff, selectMessageConversation } from '../frontend/src/messages-state.js';

const message = (id, text, timestamp = 100) => ({ id, kind: 'text', direction: 'incoming', text, timestamp });
const conversation = (id, name, participants, items) => ({ id, name, participants, items, initials: 'AB',
  tint: '#8899aa', portrait: null, timestamp: Math.max(200, ...items.map(item => item.timestamp)), timeLabel: '', pinned: false, unread: true });
const state = conversations => ({ conversations, selectedConversationId: conversations[0]?.id ?? null,
  selectedMessageId: null, query: '', unreadOnly: false, drafts: [], selectedDraftId: null });

test('literal Unicode-normalized search distinguishes titles, participants and existing message bodies', () => {
  const model = state([
    conversation('first', 'Café plans', ['José Rivera'], [message('body', 'The literal .* appears here.\nMeet at the café.')]),
    conversation('second', 'Other chat', ['Morgan Park'], [message('other-body', 'We can meet at the park.')]),
  ]);
  model.query = ' JOSE  RIVERA ';
  const contact = messageSearchResults(model);
  expect(contact.map(result => [result.conversation.id, result.conversationMatch, result.contactMatch, result.messageIds]))
    .toEqual([['first', false, true, []]]);
  model.query = '.*';
  expect(messageSearchResults(model).map(result => result.messageIds)).toEqual([['body']]);
  expect(messageSearchResults(model, { scope: 'names' })).toEqual([]);
  model.query = 'at THE cafe';
  expect(messageSearchResults(model).map(result => result.messageIds)).toEqual([['body']]);
});

test('Teams Find in chat includes the cutoff instant but excludes older and foreign-chat messages', () => {
  const cutoff = Date.parse('2023-04-30T09:41:00.000Z');
  const current = Date.parse('2023-10-31T09:41:00.000Z');
  expect(messagesHistoryCutoff(current)).toBe(cutoff);
  const model = state([
    conversation('original', 'Trail Crew', ['Casey Rivera'], [
      message('expired', 'trailhead', cutoff - 1), message('boundary', 'trailhead', cutoff), message('current', 'trailhead', current),
    ]),
    conversation('foreign', 'Another chat', ['Jordan Lee'], [message('foreign-current', 'trailhead', current)]),
  ]);
  model.query = 'trailhead';
  const results = messageSearchResults(model, { scope: 'history', conversationId: 'original', historySince: cutoff });
  expect(results.map(result => [result.conversation.id, result.conversationMatch, result.contactMatch, result.messageIds]))
    .toEqual([['original', false, false, ['boundary', 'current']]]);
  model.query = 'Casey';
  expect(messageSearchResults(model, { scope: 'history', conversationId: 'original', historySince: cutoff })).toEqual([]);
  expect(messagesHistoryCutoff(Date.parse('2024-08-31T23:59:59.000Z'))).toBe(Date.parse('2024-02-29T23:59:59.000Z'));
  expect(messagesHistoryCutoff(Date.parse('2023-08-31T23:59:59.000Z'))).toBe(Date.parse('2023-02-28T23:59:59.000Z'));
});

test('selecting a history message changes only its original conversation read state', () => {
  const model = state([
    conversation('first', 'First chat', ['Casey'], [message('first-message', 'Hello')]),
    conversation('second', 'Second chat', ['Jordan'], [message('second-message', 'Hello')]),
  ]);
  const before = structuredClone(model);
  expect(selectMessageConversation(model, 'first', 'second-message')).toBe(false);
  expect(model).toEqual(before);
  expect(selectMessageConversation(model, 'second', 'second-message')).toBe(true);
  expect(model.selectedConversationId).toBe('second');
  expect(model.selectedMessageId).toBe('second-message');
  expect(model.conversations.map(row => row.unread)).toEqual([true, false]);
  expect(model.conversations.map(row => row.items)).toEqual(before.conversations.map(row => row.items));
});

test('native bold matches preserve graphemes, literal markup, collapsed whitespace and contextual casing', () => {
  expect(messageSearchSegments('  Café  <b>.*</b> café!', 'cafe <b>')).toEqual([
    { text: '  ', match: false }, { text: 'Café  <b>', match: true }, { text: '.*</b> café!', match: false },
  ]);
  expect(messageSearchSegments('café, café!', 'CAFE')).toEqual([
    { text: 'café', match: true }, { text: ', ', match: false }, { text: 'café', match: true }, { text: '!', match: false },
  ]);
  expect(messageSearchSegments('ΟΣ is Greek', 'ος')).toEqual([{ text: 'ΟΣ', match: true }, { text: ' is Greek', match: false }]);
  expect(messageSearchSegments('ﬃ on the coast', 'f')).toEqual([{ text: 'ﬃ', match: true }, { text: ' on the coast', match: false }]);
  expect(messageSearchSegments('👨‍👩‍👧 family', '👩')).toEqual([{ text: '👨‍👩‍👧', match: true }, { text: ' family', match: false }]);
});
