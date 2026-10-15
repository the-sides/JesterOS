import { expect, test } from 'bun:test';
import { MAIL_LIMITS, createMailState, createMailWindow, mailPlainToHtml, mailParseRecipients, mailRecipientParts, mailDisplayAddress, mailTextUnits, visibleMailMessages, validateMailState } from '../frontend/src/mail-state.js';
import { createMailCommands, createMailServiceDraft } from '../frontend/src/mail-commands.js';

const profile = { id: 'macos-sonoma-14.0', family: 'macos', renderer: 'sonoma', defaults: { sceneTime: '2023-09-26T09:41:00Z' } };
const model = () => createMailState(profile);

test('sender text cannot introduce executable HTML and persisted HTML must be the canonical closed alternative', () => {
  const state = model(), text = '<img src=x onerror="alert(1)">\n**Safe emphasis**\n> <script>evil()</script>';
  state.messages[0].text = text; state.messages[0].html = mailPlainToHtml(text);
  expect(state.messages[0].html).not.toContain('<img');
  expect(state.messages[0].html).not.toContain('<script');
  expect(state.messages[0].html).toContain('<strong>Safe emphasis</strong>');
  expect(validateMailState(state, profile)).toBe(true);
  state.messages[0].html = '<img src=x onerror=alert(1)>';
  expect(validateMailState(state, profile)).toBe(false);
});

test('closed saved graph rejects accessor fields without invoking them, sparse arrays and cycles', () => {
  let reads = 0;
  const state = model();
  Object.defineProperty(state.messages[0], 'subject', { enumerable: true, get() { reads++; return 'Unsafe accessor'; } });
  expect(validateMailState(state, profile)).toBe(false);
  expect(reads).toBe(0);
  const sparse = model(); delete sparse.messages[0];
  expect(validateMailState(sparse, profile)).toBe(false);
  const cyclic = model(); cyclic.activity.push(cyclic);
  expect(validateMailState(cyclic, profile)).toBe(false);
});

test('messages cannot borrow an unrelated account mailbox, and composers cannot borrow another window draft', () => {
  const state = model();
  state.messages[0].accountId = 'foreign-account';
  expect(validateMailState(state, profile)).toBe(false);
  const draftState = model(), draft = createMailServiceDraft(draftState, { body: 'Actual shared Services text' });
  draftState.windows.push(createMailWindow(draftState, 'compose-one', 'compose', draft.id)); draft.windowId = 'compose-one';
  expect(validateMailState(draftState, profile)).toBe(true);
  draftState.windows.push(createMailWindow(draftState, 'compose-two', 'compose', draft.id));
  expect(validateMailState(draftState, profile)).toBe(false);
});

test('recipient parsing deduplicates case-insensitive addresses but rejects malformed partial recipients', () => {
  expect(mailParseRecipients('Casey <casey@example.test>; CASEY@example.test, jordan@example.test'))
    .toEqual([{ name: 'Casey', email: 'casey@example.test' }, { name: '', email: 'jordan@example.test' }]);
  expect(mailParseRecipients('Casey <casey@example.test>, not an address')).toBe(null);
  expect(mailParseRecipients('')).toEqual([]);
});

test('contact display names with delimiters round-trip through recipients and autocomplete replacement', () => {
  const person = { name: 'Rivera, Casey; "Studio"\\crew', email: 'casey@example.test' };
  const display = mailDisplayAddress(person);
  expect(mailParseRecipients(`${display}, jordan@example.test`)).toEqual([person, { name: '', email: 'jordan@example.test' }]);
  expect(mailRecipientParts(`${display}; Sam`)).toEqual([display, 'Sam']);
  expect(mailParseRecipients('"Unclosed <casey@example.test>')).toBe(null);
});

test('message search includes actual carbon-copy and blind-copy recipients without changing another view', () => {
  const state = model();
  state.messages[0].cc = [{ name: 'Studio Team', email: 'studio@example.test' }];
  state.messages[0].bcc = [{ name: 'Private Archivist', email: 'archive@example.test' }];
  state.windows.push(createMailWindow(state, 'mail-copy-search'), createMailWindow(state, 'mail-unchanged'));
  state.windows[0].query = 'Private Archivist';
  expect(visibleMailMessages(state, 'mail-copy-search').map(row => row.id)).toEqual([state.messages[0].id]);
  state.windows[0].query = 'studio@example.test';
  expect(visibleMailMessages(state, 'mail-copy-search').map(row => row.id)).toEqual([state.messages[0].id]);
  expect(visibleMailMessages(state, 'mail-unchanged')).toHaveLength(state.messages.length);
});

test('search remains literal and per-window while smart mailbox predicates reuse canonical messages', () => {
  const state = model();
  state.messages[0].subject = 'Café .* route';
  state.windows.push(createMailWindow(state, 'mail-one'), createMailWindow(state, 'mail-two'));
  state.windows[0].query = 'CAFE .*';
  state.windows[0].threaded = false; state.windows[1].threaded = false;
  expect(visibleMailMessages(state, 'mail-one').map(row => row.id)).toEqual([state.messages[0].id]);
  expect(visibleMailMessages(state, 'mail-two').length).toBe(state.messages.length);
  state.windows[1].mailboxId = state.mailboxes.find(row => row.kind === 'smart').id;
  const result = visibleMailMessages(state, 'mail-two');
  expect(result[0]).toBe(state.messages[0]);
  state.messages[0].flagged = false;
  expect(visibleMailMessages(state, 'mail-two')).toEqual([]);
});

test('maximum newline-heavy message content remains representable without admitting arbitrary HTML', () => {
  const state = model(), message = state.messages[0];
  message.text = '\n'.repeat(MAIL_LIMITS.text);
  message.html = mailPlainToHtml(message.text);
  expect(validateMailState(state, profile)).toBe(true);
  message.format = 'plain'; message.text = '**literal** _underscore_ [u]literal[/u]';
  message.html = mailPlainToHtml(message.text, false);
  expect(message.html).not.toContain('<strong>');
  expect(message.html).not.toContain('<em>');
  expect(validateMailState(state, profile)).toBe(true);
});

test('aggregate saved content is bounded independently of individual message field limits', () => {
  const state = model(), template = state.messages[0], text = 'x'.repeat(MAIL_LIMITS.text);
  state.messages = Array.from({ length: 70 }, (_, index) => ({ ...template, id: `long-message-${index}`, text,
    html: mailPlainToHtml(text), attachments: [], invitation: null }));
  expect(mailTextUnits(state)).toBeGreaterThan(MAIL_LIMITS.textUnits);
  expect(validateMailState(state, profile)).toBe(false);
});

test('Services draft creation rejects oversized body-plus-signature without consuming canonical IDs or records', () => {
  const state = model(), before = structuredClone(state);
  expect(createMailServiceDraft(state, { body: 'x'.repeat(MAIL_LIMITS.text) })).toBe(null);
  expect(state).toEqual(before);
});

test('forward preserves original quote and attachments when quoting replies is disabled', async () => {
  const state = model(), root = { mail: state }, sourceId = 'mail-test-source', destinationId = 'mail-test-forward';
  state.preferences.quoteOriginal = false;
  const source = createMailWindow(state, sourceId);
  source.selectedIds = [state.messages[0].id];
  state.windows.push(source);
  const windows = new Map([[sourceId, { id: sourceId, appId: 'mail' }]]);
  const view = { available: () => true, describe: () => ({ messageIds: [state.messages[0].id], controlIds: [] }), focus: async () => true };
  const views = new Map([[sourceId, view]]);
  const commands = createMailCommands({
    profile, getState: () => root, getWindow: id => windows.get(id), getView: id => views.get(id),
    available: () => true, tick: async () => {}, focusWindow: () => {},
    createWindow: async () => {
      windows.set(destinationId, { id: destinationId, appId: 'mail' });
      views.set(destinationId, view);
      return destinationId;
    },
  });
  const original = structuredClone(state.messages[0]);
  const result = await commands.handlers['mail.compose.new']({ windowId: sourceId }, { mode: 'forward' });
  expect(result.status).toBe('applied');
  const draft = state.drafts[0];
  expect(draft.mode).toBe('forward');
  expect(draft.body).toContain(original.text.split('\n').map(line => `> ${line}`).join('\n'));
  expect(draft.attachments.map(({ id, ...attachment }) => attachment))
    .toEqual(original.attachments.map(({ id, ...attachment }) => attachment));
  expect(state.messages[0]).toEqual(original);
  expect(validateMailState(state, profile)).toBe(true);
});

test('disabling an account hides its inbox and smart results without deleting original messages', () => {
  const state = model(), original = structuredClone(state.messages);
  state.windows.push(createMailWindow(state, 'mail-disabled-inbox'), createMailWindow(state, 'mail-disabled-smart'));
  state.windows[1].mailboxId = 'mail-box-flagged';
  state.accounts[0].enabled = false;
  state.accounts[0].connection = 'offline';
  expect(visibleMailMessages(state, 'mail-disabled-inbox')).toEqual([]);
  expect(visibleMailMessages(state, 'mail-disabled-smart')).toEqual([]);
  expect(state.messages).toEqual(original);
  expect(validateMailState(state, profile)).toBe(true);
  state.accounts[0].enabled = true;
  state.accounts[0].connection = 'connected';
  expect(visibleMailMessages(state, 'mail-disabled-inbox')).toHaveLength(original.length);
  expect(visibleMailMessages(state, 'mail-disabled-smart').map(message => message.id)).toEqual(['mail-message-route']);
});

test('native multiline Unicode emphasis produces a rendered rich alternative on every selected line', async () => {
  const state = model(), root = { mail: state }, windowId = 'mail-test-unicode';
  const draft = createMailServiceDraft(state, { body: 'Café 🧭 é\n沿海' });
  state.windows.push(createMailWindow(state, windowId, 'compose', draft.id));
  draft.windowId = windowId;
  const window = { id: windowId, appId: 'mail' };
  const view = {
    available: () => true,
    selection: () => ({ control: 'body', value: draft.body, start: 0, end: draft.body.length, writable: true }),
    setSelection: async () => true,
  };
  const commands = createMailCommands({
    profile, getState: () => root, getWindow: () => window, getView: () => view,
    available: () => true, tick: async () => {},
  });
  const result = await commands.handlers['mail.draft.format']({ windowId }, { style: 'bold' });
  expect(result.status).toBe('applied');
  expect(draft.body).toBe('**Café 🧭 é**\n**沿海**');
  expect(mailPlainToHtml(draft.body)).toBe('<div><strong>Café 🧭 é</strong></div><div><strong>沿海</strong></div>');
  expect(validateMailState(state, profile)).toBe(true);
});

test('sending an already saved draft queues the actual canonical record and preserves its identity and bytes', async () => {
  const state = model(), root = { mail: state }, windowId = 'mail-test-saved-send';
  const draft = createMailServiceDraft(state, { to: 'casey@example.test', subject: 'Saved coastal café', body: 'Café 🧭 é\n沿海' });
  state.windows.push(createMailWindow(state, windowId, 'compose', draft.id));
  draft.windowId = windowId;
  const windows = new Map([[windowId, { id: windowId, appId: 'mail' }]]);
  const view = { available: () => true };
  const commands = createMailCommands({
    profile, getState: () => root, getWindow: id => windows.get(id), getView: () => view,
    available: () => true, tick: async () => {}, getSceneTime: () => 1695721260000,
    closeWindow: async id => { windows.delete(id); },
  });
  expect((await commands.handlers['mail.draft.save']({ windowId }, {})).status).toBe('applied');
  const originalMessage = state.messages.find(message => message.id === draft.messageId);
  const originalId = originalMessage.id, originalText = originalMessage.text;
  const result = await commands.handlers['mail.draft.send']({ windowId }, {});
  expect(result.status).toBe('applied');
  expect(state.messages.find(message => message.id === originalId)).toBe(originalMessage);
  expect(originalMessage.delivery).toBe('sent');
  expect(originalMessage.mailboxId).toBe('mail-box-sent');
  expect(originalMessage.text).toBe(originalText);
  expect(state.drafts).toEqual([]);
  expect(state.windows).toEqual([]);
  expect(validateMailState(state, profile)).toBe(true);
});
