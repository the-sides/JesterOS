import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, object, empty, identity, flag, choice, NONE } from './command-schema.js';
import { messageSearchResults, selectMessageConversation, markMessagesRead, validateMessagesState } from './messages-state.js';
import { messageDraft, createMessageDraft, changeMessageDraft, sendMessageDraft, setMessageDelivery, validMessageDraftField } from './messages-composition.js';
import { createMessagesRichCommands, messagesRichCatalog, MESSAGE_INCOMING_FIXTURES } from './messages-rich-commands.js';
import { copyCanonicalData, applyCanonicalData } from './canonical-data.js';

const profiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
const modernMacs = ['macos-sonoma-14.0', 'macos-golden-gate-27.0.1'];
const contextProfiles = [...modernMacs, 'windows11-23h2-22631.2428'];
const windowTarget = object({ windowId: identity });
const conversationTarget = object({ windowId: identity, conversationId: identity });
const requires = ['An existing original Messages or native Windows messaging window, not minimized or hidden; no blocking scene/modal.',
  'The original mounted native view and canonical record collection must survive every awaited preparation. No implicit app launch.'];
const define = (name, target, payload, presentation, data = NONE, supported = profiles, result = target) =>
  defineCommand(supported, name, 'messages.conversations', target, payload, requires, presentation, data, NONE, result);
export const messagesCatalog = { ...Object.fromEntries([
  define('messages.search', windowTarget, object({ query: { type: 'string', maxLength: 4096 } }),
    ['Focus the actual search field and show literal native-scope matches. macOS searches conversation/contact names and existing text. Teams mini/full names mode searches names only; full Find in chat searches the selected conversation within its documented six-month boundary. Empty or unmatched queries show the appropriate native list or empty result.'], ['messages.query']),
  define('messages.conversation.select', conversationTarget, object({ messageId: identity }, NONE),
    ['Select a currently matching conversation and mark it read. Optional messageId opens and focuses that exact existing history result. Never substitute another thread.'],
    ['messages.selectedConversationId', 'messages.selectedMessageId', 'messages.conversations.unread']),
  define('messages.conversation.setUnread', conversationTarget, object({ unread: flag }),
    ['Author the existing fictional conversation read state. Modern native Mark as Unread/Read uses this same command; historical versions do not acquire a nonexistent native menu action.'], ['messages.conversations.unread']),
  define('messages.filter.setUnreadOnly', windowTarget, object({ enabled: flag }),
    ['Switch the native modern unread-conversation view without rewriting history or fabricating unread arrivals. Historical versions reject before payload traversal.'], ['messages.unreadOnly'], modernMacs),
  define('messages.focus', object({ windowId: identity, controlId: identity }), empty,
    ['Prepare and focus an actual current enabled native search, conversation, history-hit or panel control.']),
  define('messages.scroll', object({ windowId: identity, areaId: choice('conversations', 'thread') }),
    object({ top: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, left: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }),
    ['Scroll the actual current native area, returning observed clamped offsets.'], NONE, profiles,
    object({ windowId: identity, areaId: choice('conversations', 'thread') })),
  define('messages.context.open', conversationTarget, object({ point: object({ x: { type: 'number' }, y: { type: 'number' } }) }, NONE),
    ['Open the current native conversation context menu at the optional finite viewport-CSS point, or the actual row anchor, and focus its enabled action.'], NONE, contextProfiles),
  define('messages.context.close', windowTarget, object({ restoreFocus: flag }, NONE),
    ['Withdraw the native context menu, optionally returning focus to its original conversation or the surviving search field.'], NONE, contextProfiles),
  define('messages.compose.new', windowTarget, object({ to: { type: 'string', maxLength: 4096 }, body: { type: 'string', maxLength: 1024 * 1024 } }, NONE),
    ['Open and focus the real new-message recipient field. An empty request resumes the retained unfinished new-message draft; supplied text creates a distinct canonical draft. No remote service is contacted.'],
    ['messages.drafts', 'messages.selectedDraftId', 'messages.selectedConversationId', 'messages.nextId', 'messages.timeBase'], profiles, object({ windowId: identity, draftId: identity })),
  define('messages.draft.set', object({ windowId: identity, draftId: identity, field: choice('to', 'body') }),
    object({ value: { type: 'string', maxLength: 1024 * 1024 } }), ['Edit only the original selected canonical draft through its actual native recipient/body field. Existing conversations retain their original recipients.'],
    ['messages.drafts', 'messages.timeBase'], profiles, object({ windowId: identity, draftId: identity, field: choice('to', 'body'), revision: { type: 'integer', minimum: 1 } })),
  define('messages.draft.send', object({ windowId: identity, draftId: identity }), empty,
    ['Send exact nonempty draft text into its original local conversation, or create a fictional conversation for its literal recipients. Clear only that draft body and expose the actual sent history. No network delivery or read receipt is claimed.'],
    ['messages.conversations', 'messages.drafts', 'messages.selectedConversationId', 'messages.selectedMessageId', 'messages.nextId', 'messages.timeBase'], profiles,
    object({ windowId: identity, draftId: identity, conversationId: identity, messageId: identity, delivery: { const: 'sent' }, fictional: { const: true } })),
  define('messages.delivery.set', object({ windowId: identity, conversationId: identity, messageId: identity }),
    object({ status: choice('sent', 'delivered', 'read', 'failed') }), ['Author only the exact fictional outgoing message delivery/read/failure state. This is a local event, not evidence of remote transport.'],
    ['messages.conversations.items.delivery', 'messages.conversations.items.deliveryStatus'], profiles,
    object({ windowId: identity, conversationId: identity, messageId: identity, delivery: choice('sent', 'delivered', 'read', 'failed'), fictional: { const: true } })),
]), ...messagesRichCatalog };

// Never invoke accessor values while validating targets/payloads, and freeze the
// literal request before any native await. The public command envelope is shared.
function literal(value, required, optional = []) {
  if (!isRecord(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== 'string'
    || !required.includes(key) && !optional.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const fail = (code, message) => rejected(code, message);
const applied = (target, extra = {}) => ({ status: 'applied', target, ...extra });

export function createMessagesCommands(ctx) {
  const state = ctx.getState();
  const rich = createMessagesRichCommands(ctx);
  let sequence = 0;
  const supported = () => profiles.includes(ctx.profile.id) && ctx.profile.capabilities.includes('messages.conversations');
  const alive = () => supported() && ctx.alive() === true && ctx.getState() === state;
  const searchOptions = () => ctx.getSearchOptions?.() ?? {};
  const results = () => messageSearchResults(state, searchOptions());
  const sameScope = expected => {
    const current = searchOptions();
    return (current.scope ?? 'all') === (expected.scope ?? 'all')
      && (current.conversationId ?? null) === (expected.conversationId ?? null)
      && (current.historySince ?? 0) === (expected.historySince ?? 0);
  };
  const invalid = () => fail('invalid_arguments', 'Use the closed documented Messages target and literal payload.');
  function target(value, keys) {
    const result = literal(value, keys);
    return result && keys.every(key => id(result[key])) ? result : null;
  }
  function owner(windowId) {
    if (!alive()) return null;
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId), conversations = state.conversations;
    if (!window || !view || !ctx.available(window) || view.available() !== true) return null;
    const version = ++sequence;
    const retained = () => {
      const records = [];
      const visit = value => { records.push(value); for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child); };
      visit(state); return records;
    };
    const capture = () => ({ snapshot: JSON.stringify(state), records: retained(), time: ctx.getSceneTime?.() ?? state.timeBase,
      scope: { ...searchOptions() } });
    let expected = capture();
    const canonicalData = () => {
      if (!alive() || sequence !== version || state.conversations !== conversations || JSON.stringify(state) !== expected.snapshot
        || (ctx.getSceneTime?.() ?? state.timeBase) !== expected.time) return false;
      const records = retained();
      return records.length === expected.records.length && records.every((record, index) => record === expected.records[index]);
    };
    const canonical = () => canonicalData() && sameScope(expected.scope);
    const current = () => canonical() && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view
      && ctx.available(window) && view.available() === true;
    const refresh = () => { expected = capture(); };
    return { window, view, conversations, current, canonical, canonicalData, refresh };
  }
  const missing = windowId => ctx.getWindow(windowId) ? fail('unavailable', 'The original Messages window or native control is not currently available.')
    : fail('stale_target', 'The original Messages window has retired.');
  async function focus(lease, controlId) {
    if (!lease.current()) return false;
    ctx.focusWindow(lease.window.id);
    if (lease.current() && lease.view.describe().focusedControl === controlId) return true;
    if (!lease.current() || await lease.view.prepare(controlId, lease.current) !== true || !lease.current()) return false;
    return await lease.view.focus(controlId, lease.current) === true && lease.current()
      && lease.view.describe().focusedControl === controlId;
  }
  async function presentCommitted(lease, controlId) {
    try {
      await ctx.settle();
      return { focused: lease.current() && await focus(lease, controlId) };
    } catch (error) {
      return { focused: false, error: error?.message ?? 'The committed message could not prepare its original native presentation.' };
    }
  }
  const stale = () => fail('stale_target', 'The original Messages window, record collection, selection or native control changed during preparation.');
  const handlers = {
    'messages.search': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, ['query']);
      if (!intent || !payload || typeof payload.query !== 'string' || payload.query.length > 4096) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (ctx.canCommitQuery && ctx.canCommitQuery(payload.query.length - state.query.length) !== true) {
        lease.view.reconcileSearch?.(payload.query, lease.current);
        return fail('limit_exceeded', 'The query exceeds the complete-scene text budget.');
      }
      if (!lease.current() || !await focus(lease, 'search')) return stale();
      if (ctx.canCommitQuery && ctx.canCommitQuery(payload.query.length - state.query.length) !== true) {
        lease.view.reconcileSearch?.(payload.query, lease.current);
        return fail('limit_exceeded', 'The query exceeds the complete-scene text budget.');
      }
      if (!lease.current()) return stale();
      const previousQuery = state.query;
      state.query = payload.query; state.selectedMessageId = null;
      rich.recordSearchTransition(previousQuery);
      return applied(intent);
    },
    'messages.conversation.select': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, [], ['messageId']);
      if (!intent || !payload || Object.hasOwn(payload, 'messageId') && !id(payload.messageId)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = lease.conversations.find(row => row.id === intent.conversationId);
      const result = results().find(result => result.conversation === row);
      if (!row || !result) return fail('stale_target', 'The requested conversation is not in the current native search/filter results.');
      const message = payload.messageId === undefined ? null : row.items.find(item => item.id === payload.messageId);
      if (payload.messageId !== undefined && (!message || state.query && !result.messageIds.includes(message.id)))
        return fail('stale_target', 'The requested message does not belong to this conversation’s current history results.');
      const items = row.items, unread = row.unread;
      const initialControl = message && lease.view.describe().controlIds.includes(`hit:${row.id}:${message.id}`)
        ? `hit:${row.id}:${message.id}` : `conversation:${row.id}`;
      if (!await focus(lease, initialControl) || !lease.current() || row.items !== items || row.unread !== unread) return stale();
      const previous = { conversationId: state.selectedConversationId, messageId: state.selectedMessageId, draftId: state.selectedDraftId };
      const candidate = copyCanonicalData(state);
      selectMessageConversation(candidate, row.id, message?.id ?? null);
      const receipts = markMessagesRead(candidate, candidate.conversations.find(conversation => conversation.id === row.id),
        ctx.getSceneTime?.() ?? state.timeBase);
      const validation = validateMessagesState(candidate, ctx.profile);
      if (!validation.ok) return fail('invalid_arguments', validation.message);
      if (ctx.canCommit?.(candidate) === false) return fail('limit_exceeded', 'The complete scene cannot hold the original local read receipts.');
      if (!lease.current()) return stale();
      selectMessageConversation(state, row.id, message?.id ?? null); lease.refresh();
      if (ctx.showThread) {
        const opened = await ctx.showThread(lease.window, lease.current);
        if (opened !== true || !lease.canonicalData() || ctx.getWindow(intent.windowId) !== lease.window
          || ctx.getView(intent.windowId) !== lease.view || !ctx.available(lease.window) || lease.view.available() !== true) {
          if (lease.canonicalData() && row.items === items && row.unread === false) {
            state.selectedConversationId = previous.conversationId; state.selectedMessageId = previous.messageId;
            state.selectedDraftId = previous.draftId; row.unread = unread;
          }
          return stale();
        }
        lease.refresh();
      }
      if (message) {
        let focused = false;
        try {
          await ctx.settle();
          focused = lease.current() && row.items === items && items.includes(message) && await focus(lease, `message:${message.id}`);
        } catch (error) {
          if (lease.canonical() && row.items === items && row.unread === false) {
            state.selectedConversationId = previous.conversationId; state.selectedMessageId = previous.messageId;
            state.selectedDraftId = previous.draftId; row.unread = unread;
          }
          throw error;
        }
        if (!focused) {
          if (lease.canonical() && row.items === items && row.unread === false) {
            state.selectedConversationId = previous.conversationId; state.selectedMessageId = previous.messageId;
            state.selectedDraftId = previous.draftId; row.unread = unread;
          }
          return stale();
        }
      }
      if (receipts) {
        if (!lease.current()) return stale();
        applyCanonicalData(state, candidate);
        ctx.onTimeChanged?.(state.timeBase);
        lease.refresh();
      }
      return applied(intent, { selectedMessageId: message?.id ?? null });
    },
    'messages.compose.new': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, [], ['to', 'body']);
      if (!intent || !payload || Object.keys(payload).some(field => !validMessageDraftField(field, payload[field]))) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (!await focus(lease, 'new-message')) return stale();
      if (ctx.showThread && (await ctx.showThread(lease.window, lease.current) !== true || !lease.current())) return stale();
      const retained = Object.keys(payload).length === 0 ? state.drafts.findLast(draft => draft.conversationId === null) : null;
      let result;
      if (retained) {
        if (ctx.canCommit && ctx.canCommit({ ...state, selectedConversationId: null, selectedMessageId: null,
          selectedDraftId: retained.id, query: '', unreadOnly: false }) !== true)
          return fail('limit_exceeded', 'The retained composer selection exceeds the complete-scene text budget.');
        state.selectedConversationId = null; state.selectedMessageId = null; state.selectedDraftId = retained.id; state.query = ''; state.unreadOnly = false;
        result = applied({ ...intent, draftId: retained.id });
      } else {
        result = createMessageDraft(state, { to: payload.to ?? '', body: payload.body ?? '' },
          { time: ctx.getSceneTime?.() ?? state.timeBase, canCommit: ctx.canCommit, guard: lease.current,
            ...(ctx.makeDraftRecord ? { makeRecord: ctx.makeDraftRecord } : {}) });
      }
      if (result.status !== 'applied') return result;
      const draftId = result.target.draftId;
      ctx.onTimeChanged?.(state.timeBase); lease.refresh();
      const presentation = await presentCommitted(lease, 'draft-to');
      return applied({ ...intent, draftId }, { presentation });
    },
    'messages.draft.set': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'draftId', 'field']), payload = literal(rawPayload, ['value']);
      if (!intent || !payload || !validMessageDraftField(intent.field, payload.value)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const draft = messageDraft(state, intent.draftId), revision = draft?.revision;
      if (!draft || state.selectedDraftId !== draft.id) return stale();
      if (!await focus(lease, `draft-${intent.field}`) || messageDraft(state, draft.id) !== draft || draft.revision !== revision) return stale();
      const before = draft.fields[intent.field];
      const result = changeMessageDraft(state, draft.id, intent.field, payload.value,
        { time: ctx.getSceneTime?.() ?? state.timeBase, canCommit: ctx.canCommit });
      if (result.status !== 'applied') {
        lease.view.reconcileDraft?.(draft.id, intent.field, payload.value, lease.current);
        return result;
      }
      rich.recordDraftTransition(draft, intent.field, before, revision);
      ctx.onTimeChanged?.(state.timeBase);
      return applied({ ...intent, revision: draft.revision });
    },
    'messages.draft.send': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'draftId']);
      if (!intent || !literal(rawPayload, [])) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const draft = messageDraft(state, intent.draftId), revision = draft?.revision;
      if (!draft || state.selectedDraftId !== draft.id) return stale();
      if (!await focus(lease, 'draft-body') || messageDraft(state, draft.id) !== draft || draft.revision !== revision) return stale();
      const values = lease.view.draftValues(draft.id);
      if (!values || values.body !== draft.fields.body || values.to !== null && values.to !== draft.fields.to) return stale();
      const result = sendMessageDraft(state, draft.id, { time: ctx.getSceneTime?.() ?? state.timeBase,
        canCommit: ctx.canCommit, resolveRecipient: ctx.resolveRecipient, captureOutgoingProfile: ctx.captureOutgoingProfile });
      if (result.status !== 'applied') return result;
      ctx.onTimeChanged?.(state.timeBase); lease.refresh();
      const presentation = await presentCommitted(lease, `message:${result.target.messageId}`);
      return applied({ ...intent, ...result.target }, { presentation });
    },
    'messages.delivery.set': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId', 'messageId']), payload = literal(rawPayload, ['status']);
      if (!intent || !payload || !['sent', 'delivered', 'read', 'failed'].includes(payload.status)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const result = setMessageDelivery(state, intent.conversationId, intent.messageId, payload.status, { canCommit: ctx.canCommit });
      return result.status === 'applied' ? applied({ ...intent, ...result.target }) : result;
    },
    'messages.conversation.setUnread': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, ['unread']);
      if (!intent || !payload || typeof payload.unread !== 'boolean') return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = lease.conversations.find(row => row.id === intent.conversationId);
      if (!row) return fail('stale_target', 'The original conversation has retired.');
      if (!lease.current()) return stale();
      row.unread = payload.unread;
      return applied(intent);
    },
    'messages.filter.setUnreadOnly': async (rawTarget, rawPayload) => {
      if (!modernMacs.includes(ctx.profile.id)) return fail('unsupported_profile', 'This OS version does not provide the modern macOS unread-conversation view.');
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, ['enabled']);
      if (!intent || !payload || typeof payload.enabled !== 'boolean') return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (!await focus(lease, 'search')) return stale();
      state.unreadOnly = payload.enabled;
      return applied(intent);
    },
    'messages.context.open': async (rawTarget, rawPayload) => {
      if (!contextProfiles.includes(ctx.profile.id)) return fail('unsupported_profile', 'This historical Messages version does not provide the modern unread context action.');
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, [], ['point']);
      const point = payload && Object.hasOwn(payload, 'point') ? literal(payload.point, ['x', 'y']) : null;
      if (!intent || !payload || Object.hasOwn(payload, 'point') && (!point || ![point.x, point.y].every(Number.isFinite))) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (!results().some(result => result.conversation.id === intent.conversationId))
        return fail('stale_target', 'The original conversation is not in the current native results.');
      if (!lease.current() || !await lease.view.openContext(intent.conversationId, point, lease.current) || !lease.current()) return stale();
      return await focus(lease, `context-unread:${intent.conversationId}`) ? applied(intent) : stale();
    },
    'messages.context.close': async (rawTarget, rawPayload) => {
      if (!contextProfiles.includes(ctx.profile.id)) return fail('unsupported_profile', 'This historical Messages version has no modern unread context menu.');
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, [], ['restoreFocus']);
      if (!intent || !payload || Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean') return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      return await lease.view.closeContext(payload.restoreFocus !== false, lease.current) && lease.current() ? applied(intent) : stale();
    },
    'messages.focus': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'controlId']);
      if (!intent || !literal(rawPayload, [])) return invalid();
      const window = ctx.getWindow(intent.windowId), view = ctx.getView(intent.windowId);
      if (window && ctx.available(window) && view?.available() === true && view.describe().focusedControl === intent.controlId)
        return applied(intent);
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (!lease.view.describe().controlIds.includes(intent.controlId)) return fail('stale_target', 'This native control is not currently rendered.');
      return await focus(lease, intent.controlId) ? applied(intent) : stale();
    },
    'messages.scroll': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'areaId']), payload = literal(rawPayload, ['top', 'left']);
      if (!intent || !['conversations', 'thread'].includes(intent.areaId) || !payload
        || ![payload.top, payload.left].every(value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER)) return invalid();
      const window = ctx.getWindow(intent.windowId), view = ctx.getView(intent.windowId);
      const observed = window && ctx.available(window) && view?.available() === true ? view.describe().scrolls?.[intent.areaId] : null;
      if (observed && observed.top === payload.top && observed.left === payload.left) return applied(intent, { offsets: observed });
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const offsets = await lease.view.scroll(intent.areaId, payload, lease.current);
      return offsets && lease.current() ? applied(intent, { offsets }) : stale();
    },
  };
  const guarded = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, async (...args) => {
    if (!supported()) return fail('unsupported_profile', 'The active OS profile does not support Messages conversations.');
    if (!alive()) return stale();
    try { return await handler(...args); } catch (error) {
      if (!alive()) return stale();
      // Native failure is not a successful action; preserve its concrete cause.
      return fail('unavailable', error?.message ?? 'The original native Messages operation failed.');
    }
  }]));
  function targets() {
    return { selectedConversationId: state.selectedConversationId, selectedMessageId: state.selectedMessageId,
      query: state.query, unreadOnly: state.unreadOnly,
      selectedDraftId: state.selectedDraftId, preferences: copyCanonicalData(state.preferences), account: copyCanonicalData(state.account),
      blockedAddresses: [...state.blockedAddresses], incomingFixtures: MESSAGE_INCOMING_FIXTURES.map(fixture => ({
        fixtureId: fixture.id, label: fixture.label, consumed: state.incomingFixtures.includes(fixture.id) })),
      drafts: state.drafts.map(draft => ({ draftId: draft.id, conversationId: draft.conversationId, revision: draft.revision,
        selected: draft.id === state.selectedDraftId, to: draft.fields.to, hasText: Boolean(draft.fields.body.trim()),
        attachments: draft.attachments.map(attachment => ({ attachmentId: attachment.id, name: attachment.name, mime: attachment.mime, kind: attachment.kind })) })),
      conversations: state.conversations.map(row => ({ conversationId: row.id, name: row.name, unread: row.unread, pinned: row.pinned,
        dnd: row.dnd, left: row.left, location: row.location ? { ...row.location } : null, participants: [...row.participants],
        messageIds: row.items.map(item => item.id), messages: row.items.map(item => ({ messageId: item.id,
          attachments: (item.attachments ?? []).map(attachment => ({ attachmentId: attachment.id, name: attachment.name, mime: attachment.mime, kind: attachment.kind })),
          reactions: (item.reactions ?? []).map(reaction => ({ ...reaction })) })) })),
      results: results().map(result => ({ conversationId: result.conversation.id, messageIds: result.messageIds,
        conversationMatch: result.conversationMatch, contactMatch: result.contactMatch })),
      windows: ctx.getWindows().filter(window => ctx.getWindow(window.id) === window).map(window => ({ windowId: window.id,
        available: ctx.available(window) && ctx.getView(window.id)?.available() === true,
        presentation: ctx.getView(window.id)?.describe() ?? null })) };
  }
  return { handlers: { ...guarded, ...rich.handlers }, targets, editingAvailability: rich.editingAvailability,
    prepareNotificationOpen: rich.prepareNotificationOpen };
}
