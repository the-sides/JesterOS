import { rejected } from './feature-commands.js';
import { mailSpecs } from './mail-catalog.js';
import { MAIL_LIMITS, MAIL_PROFILES, mailWindow, createMailWindow, mailNewId, mailMailboxFor, mailParseRecipients, mailRecipientParts, mailDisplayAddress, mailEmail, mailPlainToHtml, mailFold, mailTextUnits, visibleMailMessages, validateMailState, mailSchemaValid } from './mail-state.js';
import { applyCanonicalData, copyCanonicalData } from './canonical-data.js';

const fail = (code, message) => rejected(code, message);
const applied = (target, extra = {}) => ({ status: 'applied', target, ...extra });
const own = (value, key) => Object.hasOwn(value, key);
function captureReferences(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  result.push(value);
  for (const child of Object.values(value)) captureReferences(child, result);
  return result;
}
function sameReferences(value, references) {
  let index = 0;
  function visit(node) {
    if (!node || typeof node !== 'object') return true;
    if (references[index++] !== node) return false;
    for (const child of Object.values(node)) if (!visit(child)) return false;
    return true;
  }
  return visit(value) && index === references.length;
}
function connection(state, account) { return state.offline || !account.enabled || !account.online ? 'offline' : account.failure === 'receive' ? 'failed' : 'connected'; }
function addActivity(state, accountId, operation, status, detail, time, messageId = null) {
  if (state.activity.length >= MAIL_LIMITS.activity) { const index = state.activity.findIndex(row => row.status !== 'running'); if (index < 0) return null; state.activity.splice(index, 1); }
  const id = mailNewId(state, 'mail-activity'); if (!id) return null;
  const activity = { id, accountId, messageId, operation, status, detail, time }; state.activity.push(activity); return activity;
}
function draftBody(state, draft) {
  const signature = state.signatures.find(row => row.id === draft.signatureId)?.text;
  return draft.body + (signature ? `\n\n${signature}` : '');
}
function bodyEdit(draft, value) {
  draft.body = value; draft.dirty = true;
  draft.history.splice(draft.historyIndex + 1); draft.history.push({ body: value });
  if (draft.history.length > 32) draft.history.shift(); draft.historyIndex = draft.history.length - 1;
}
function draftMessage(state, draft, now) {
  const account = state.accounts.find(row => row.id === draft.accountId), text = draftBody(state, draft);
  return { id: draft.messageId ?? mailNewId(state, 'mail-message'), accountId: account.id, mailboxId: mailMailboxFor(state, account.id, 'drafts').id, previousMailboxId: null,
    threadId: state.messages.find(row => row.id === draft.replyToId)?.threadId ?? draft.messageId ?? draft.id, from: { name: account.name, email: account.email }, to: mailParseRecipients(draft.to) ?? [], cc: mailParseRecipients(draft.cc) ?? [], bcc: mailParseRecipients(draft.bcc) ?? [],
    subject: draft.subject, text, html: mailPlainToHtml(text, draft.format === 'rich'), format: draft.format, date: now, read: true, flagged: false, priority: draft.priority, attachments: copyCanonicalData(draft.attachments), invitation: null,
    headers: [{ name: 'X-JesterOS-Transport', value: 'Fictional frontend-local; never delivered' }], delivery: 'draft' };
}
function saveDraft(state, draft, now) {
  const record = draftMessage(state, draft, now);
  if (!record.id) return false;
  const existing = state.messages.find(row => row.id === draft.messageId);
  if (existing) Object.assign(existing, record); else { if (state.messages.length >= MAIL_LIMITS.messages) return false; state.messages.push(record); }
  draft.messageId = record.id; draft.dirty = false; return existing ?? record;
}
function clearSelections(state) { for (const win of state.windows) { const visible = new Set(visibleMailMessages(state, win.windowId).map(row => row.id)); win.selectedIds = win.selectedIds.filter(id => visible.has(id)); } }
function applyRules(state, messages) {
  let count = 0;
  for (const message of messages) {
    if (message.delivery !== 'received') continue;
    for (const rule of state.rules) {
      const value = rule.field === 'sender' ? mailDisplayAddress(message.from) : rule.field === 'subject' ? message.subject : rule.field === 'body' ? message.text : message.attachments.map(row => row.name).join(' ');
      if (!rule.enabled || !mailFold(value).includes(mailFold(rule.match))) continue;
      if (rule.action === 'flag') message.flagged = true;
      else if (rule.action === 'read') message.read = true;
      else {
        const box = rule.action === 'junk' ? mailMailboxFor(state, message.accountId, 'junk') : state.mailboxes.find(row => row.id === rule.mailboxId && row.accountId === message.accountId && row.kind !== 'smart');
        if (!box || rule.action === 'junk' && !state.preferences.junkEnabled) continue;
        message.previousMailboxId = message.mailboxId; message.mailboxId = box.id;
      }
      count++;
    }
  }
  return count;
}

export function createMailCommands(ctx) {
  const rootState = ctx.getState(), state = rootState.mail ?? rootState;
  const profile = ctx.profile;
  const versions = new Map();
  const alive = () => ctx.getState() === rootState && (rootState.mail ?? rootState) === state && (!profile?.id || MAIL_PROFILES.includes(profile.id)) && (!ctx.alive || ctx.alive() === true);
  const now = () => { const value = ctx.getSceneTime?.(); const parsed = typeof value === 'string' ? Date.parse(value) : value instanceof Date ? value.getTime() : value; return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0; };
  const stale = () => fail('stale_target', 'The original Mail graph, window, native view or record changed during the operation.');
  function owner(windowId) {
    if (!alive() || !validateMailState(state, profile)) return null;
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId), session = mailWindow(state, windowId);
    if (!window || window.appId && window.appId !== 'mail' || !session || !view || !ctx.available(window) || view.available() !== true) return null;
    const version = (versions.get(windowId) ?? 0) + 1; versions.set(windowId, version);
    const collections = [state.accounts, state.mailboxes, state.messages, state.drafts, state.windows, state.signatures, state.rules, state.activity];
    let snapshot = JSON.stringify(state), references = captureReferences(state);
    const owned = () => alive() && versions.get(windowId) === version && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view && mailWindow(state, windowId) === session
      && ctx.available(window) && view.available() === true && collections.every((rows, i) => rows === [state.accounts, state.mailboxes, state.messages, state.drafts, state.windows, state.signatures, state.rules, state.activity][i]);
    const current = () => owned() && sameReferences(state, references) && JSON.stringify(state) === snapshot;
    return { window, view, session, owned, current, refresh: () => { snapshot = JSON.stringify(state); references = captureReferences(state); } };
  }
  function transaction(lease, change, guard = () => true) {
    if (lease && !lease.current() || !alive() || guard() !== true) return stale();
    const snapshot = JSON.stringify(state), references = captureReferences(state);
    const candidate = copyCanonicalData(state), result = change(candidate);
    if (result?.status === 'rejected') return result;
    if (!validateMailState(candidate, profile)) return fail('invalid_state', 'The requested transition would break the bounded canonical Mail graph.');
    if (ctx.canCommit && ctx.canCommit(mailTextUnits(candidate) - mailTextUnits(state)) !== true) return fail('limit_exceeded', 'The complete-scene text budget would be exceeded.');
    if (!alive() || guard() !== true || lease && !lease.current() || !sameReferences(state, references) || JSON.stringify(state) !== snapshot) return stale();
    applyCanonicalData(state, candidate); lease?.refresh(); ctx.onChanged?.(); return result ?? true;
  }
  const draftFor = lease => lease.session.kind === 'compose' ? state.drafts.find(row => row.id === lease.session.draftId && row.windowId === lease.window.id) : null;
  const represented = (lease, messageId) => lease.view.describe().messageIds.includes(messageId);
  const selected = (lease, target) => {
    const rendered = new Set(lease.view.describe().messageIds);
    return state.messages.filter(row => (target.messageId ? row.id === target.messageId : lease.session.selectedIds.includes(row.id)) && rendered.has(row.id));
  };
  const invalid = text => fail('invalid_arguments', text ?? 'Use the closed documented Mail command target and payload.');
  async function finish(lease, target, extra = {}) { await ctx.tick(); return lease.current() ? applied(target, extra) : stale(); }
  async function spawn(lease, kind, draftId = null, pane = 'General') {
    if (state.windows.length >= MAIL_LIMITS.windows || typeof ctx.createWindow !== 'function') return fail('unavailable', 'A real Mail window creation bridge is required.');
    if (!lease.current()) return stale();
    const sourceSession = JSON.stringify(lease.session), sourceReferences = captureReferences(lease.session), originalDraft = draftId ? state.drafts.find(row => row.id === draftId) : null;
    const draftSnapshot = originalDraft ? JSON.stringify({ ...originalDraft, windowId: null }) : null, draftReferences = originalDraft ? captureReferences(originalDraft) : null;
    let created;
    try { created = await ctx.createWindow('mail', { mailKind: kind, mailDraftId: draftId, mailPane: pane, title: kind === 'compose' ? 'New Message' : kind === 'preferences' ? 'Mail Settings' : kind === 'doctor' ? 'Connection Doctor' : kind === 'activity' ? 'Activity' : kind === 'help' ? 'Mail Help' : 'Mail' }); }
    catch {
      if (originalDraft && originalDraft.windowId === null && lease.current()) transaction(lease, candidate => { if (!saveDraft(candidate, candidate.drafts.find(row => row.id === draftId), now())) return fail('limit_exceeded', 'Draft preservation failed.'); });
      return fail('bridge_failed', 'The real Mail window could not be created. The original unowned draft is retained locally.');
    }
    // Parent lifecycle may add the canonical session during creation. Do not borrow a replacement source owner.
    const id = typeof created === 'string' ? created : created?.id ?? created?.windowId;
    if (!id && originalDraft && originalDraft.windowId === null && lease.current()) transaction(lease, candidate => { if (!saveDraft(candidate, candidate.drafts.find(row => row.id === draftId), now())) return fail('limit_exceeded', 'Draft preservation failed.'); });
    if (!id || !lease.owned() || !sameReferences(lease.session, sourceReferences) || JSON.stringify(lease.session) !== sourceSession || !ctx.getWindow(id)
      || draftId && (state.drafts.find(row => row.id === draftId) !== originalDraft || !sameReferences(originalDraft, draftReferences) || JSON.stringify({ ...originalDraft, windowId: null }) !== draftSnapshot)) return stale();
    const result = transaction(null, candidate => {
      let win = mailWindow(candidate, id); if (!win) { win = createMailWindow(candidate, id, kind, draftId); candidate.windows.push(win); }
      win.kind = kind; win.pane = pane; win.draftId = draftId;
      if (kind !== 'compose') win.mailboxId = lease.session.mailboxId;
      if (draftId) { const draft = candidate.drafts.find(row => row.id === draftId); if (!draft || draft.windowId && draft.windowId !== id) return invalid('The original draft already belongs to another composer.'); draft.windowId = id; }
    });
    if (result?.status === 'rejected') return result;
    const destination = ctx.getWindow(id), destinationSession = mailWindow(state, id), destinationView = ctx.getView(id);
    ctx.focusWindow(id); await ctx.tick();
    if (!alive() || !lease.owned() || ctx.getWindow(id) !== destination || mailWindow(state, id) !== destinationSession || ctx.getView(id) !== destinationView || !destinationView?.available()
      || draftId && (state.drafts.find(row => row.id === draftId) !== originalDraft || !sameReferences(originalDraft, draftReferences) || originalDraft.windowId !== id)) return stale();
    if (kind === 'compose' && !await destinationView.focus('to', () => alive() && lease.owned() && ctx.getWindow(id) === destination && mailWindow(state, id) === destinationSession && ctx.getView(id) === destinationView && destinationView.available())) return stale();
    return applied({ windowId: id }, { sourceWindowId: lease.window.id });
  }
  async function bridge(lease, name, args) {
    if (typeof ctx[name] !== 'function') return fail('unavailable', `The shared ${name} bridge is required; Mail never creates a shadow store.`);
    if (!lease.current()) return stale();
    let result;
    try { result = await ctx[name](...args, { guard: lease.current, windowId: lease.window.id }); } catch { return fail('bridge_failed', `The shared ${name} operation failed.`); }
    if (!lease.current()) return stale();
    if (!result || result.status !== 'applied') return result?.status === 'rejected' ? result : fail('bridge_failed', `The shared ${name} bridge did not acknowledge a real operation.`);
    return result;
  }
  function removeDraft(candidate, draft, discard) {
    if (discard && draft.messageId) { candidate.messages = candidate.messages.filter(row => row.id !== draft.messageId); candidate.activity = candidate.activity.filter(row => row.messageId !== draft.messageId); }
    candidate.drafts = candidate.drafts.filter(row => row.id !== draft.id); clearSelections(candidate);
  }
  async function close(lease, target, discard = false) {
    if (typeof ctx.closeWindow !== 'function') return fail('unavailable', 'The real window-close bridge is required.');
    const result = transaction(lease, candidate => {
      const draft = candidate.drafts.find(row => row.windowId === target.windowId);
      if (draft) { if (!discard && !saveDraft(candidate, draft, now())) return fail('limit_exceeded', 'Drafts mailbox is full.'); if (discard) removeDraft(candidate, draft, true); else draft.windowId = null; }
      candidate.windows = candidate.windows.filter(row => row.windowId !== target.windowId);
    });
    if (result?.status === 'rejected') return result;
    await ctx.closeWindow(target.windowId); await ctx.tick();
    return ctx.getWindow(target.windowId) ? fail('bridge_failed', 'The original Mail window was not closed.') : applied(target);
  }
  async function transport(lease, messageIds) {
    const result = transaction(lease, candidate => {
      for (const id of messageIds) {
        const message = candidate.messages.find(row => row.id === id), account = candidate.accounts.find(row => row.id === message?.accountId);
        if (!message || !['queued', 'failed'].includes(message.delivery) || !account) return stale();
        const activity = addActivity(candidate, account.id, 'send', 'running', 'Sending through fictional frontend-local transport…', now(), id);
        if (!activity) return fail('limit_exceeded', 'All bounded activity slots are running.');
        message.delivery = 'queued';
      }
    });
    if (result?.status === 'rejected') return result;
    await ctx.tick(); if (!lease.current()) return stale();
    return transaction(lease, candidate => {
      for (const id of messageIds) {
        const message = candidate.messages.find(row => row.id === id), account = candidate.accounts.find(row => row.id === message.accountId);
        const activity = [...candidate.activity].reverse().find(row => row.messageId === id && row.status === 'running');
        if (!activity || message.delivery !== 'queued') continue;
        if (candidate.offline || !account.online || !account.enabled) { activity.status = 'failed'; activity.detail = 'Offline: retained in local Outbox. No network used.'; }
        else if (account.failure === 'send') { message.delivery = 'failed'; activity.status = 'failed'; activity.detail = 'Fictional send failure. Clear account failure mode, then Retry.'; }
        else { message.delivery = 'sent'; message.mailboxId = mailMailboxFor(candidate, account.id, 'sent').id; activity.status = 'completed'; activity.detail = 'Placed in fictional local Sent. Never delivered to an external recipient.'; }
      }
    });
  }
  const operations = {
    'mail.compose.new': async (lease, target, p) => {
      if (typeof ctx.createWindow !== 'function') return fail('unavailable', 'A real Mail composer window bridge is required.');
      const mode = p.mode === 'reply' && state.preferences.replyAll ? 'replyAll' : p.mode ?? 'new', message = mode === 'new' ? null : selected(lease, p.messageId ? { messageId: p.messageId } : target)[0];
      if (mode !== 'new' && !message) return fail('disabled', 'Select a real message to reply or forward.');
      if (state.drafts.length >= MAIL_LIMITS.drafts || state.windows.length >= MAIL_LIMITS.windows) return fail('limit_exceeded', 'Mail composer limit reached.');
      let draftId;
      const result = transaction(lease, candidate => {
        const accountId = message?.accountId ?? candidate.preferences.defaultAccountId, account = candidate.accounts.find(row => row.id === accountId);
        const local = new Set(candidate.accounts.map(row => row.email.toLowerCase()));
        const uniqueAddresses = rows => rows.filter((row, index) => rows.findIndex(other => other.email.toLowerCase() === row.email.toLowerCase()) === index);
        const recipients = mode === 'reply' || mode === 'replyAll' ? uniqueAddresses([message.from, ...(mode === 'replyAll' ? message.to : [])].filter(row => !local.has(row.email.toLowerCase()))) : [];
        const cc = mode === 'replyAll' ? uniqueAddresses(message.cc.filter(row => !local.has(row.email.toLowerCase()) && !recipients.some(other => other.email.toLowerCase() === row.email.toLowerCase()))) : [];
        const prefix = mode === 'forward' ? 'Fwd' : 'Re';
        const subject = message ? new RegExp(`^${prefix}:`, 'iu').test(message.subject) ? message.subject : `${prefix}: ${message.subject}` : '';
        const quote = message && (mode === 'forward' || candidate.preferences.quoteOriginal) ? `\n\nOn ${new Date(message.date).toUTCString()}, ${mailDisplayAddress(message.from)} wrote:\n${message.text.split('\n').map(line => `> ${line}`).join('\n')}` : '';
        draftId = mailNewId(candidate, 'mail-draft');
        const attachments = mode === 'forward' ? message.attachments.map(row => ({ ...row, id: mailNewId(candidate, 'mail-attachment') })) : [];
        candidate.drafts.push({ id: draftId, windowId: null, messageId: null, accountId, to: recipients.map(mailDisplayAddress).join(', '), cc: cc.map(mailDisplayAddress).join(', '), bcc: '', subject, body: quote,
          format: candidate.preferences.composeFormat, signatureId: account.signatureId ?? candidate.preferences.defaultSignatureId, priority: 'normal', attachments, replyToId: message?.id ?? null, mode, dirty: false, history: [{ body: quote }], historyIndex: 0 });
      });
      if (result?.status === 'rejected') return result;
      return spawn(lease, 'compose', draftId);
    },
    'mail.draft.update': (lease, target, p) => {
      const draft = draftFor(lease); if (!draft) return fail('disabled', 'This window does not own a composer.');
      const max = ['to', 'cc', 'bcc'].includes(p.field) ? 4096 : p.field === 'subject' ? 1024 : p.field === 'body' ? MAIL_LIMITS.text : 128;
      if (p.value.length > max) return invalid('Draft field exceeds its bounded length.');
      if (p.field === 'priority' && !['normal', 'high', 'low'].includes(p.value) || p.field === 'format' && !['plain', 'rich'].includes(p.value)
        || p.field === 'accountId' && !state.accounts.some(row => row.id === p.value) || p.field === 'signatureId' && p.value && !state.signatures.some(row => row.id === p.value)) return invalid('Unknown draft field value.');
      return transaction(lease, candidate => { const row = candidate.drafts.find(row => row.id === draft.id); if (p.field === 'body') bodyEdit(row, p.value); else { row[p.field] = p.field === 'signatureId' ? p.value || null : p.value; row.dirty = true; }
        if (p.field === 'format' && p.value === 'plain') {
          const plain = row.body.replace(/\*\*([^*\n]+)\*\*/gu, '$1').replace(/_([^_\n]+)_/gu, '$1').replace(/\[u\]([^\n]+?)\[\/u\]/gu, '$1');
          if (plain !== row.body) bodyEdit(row, plain);
        }
        if (p.field === 'accountId' && row.messageId) { const saved = candidate.messages.find(m => m.id === row.messageId); saved.accountId = row.accountId; saved.mailboxId = mailMailboxFor(candidate, row.accountId, 'drafts').id; }
      });
    },
    'mail.draft.save': (lease) => {
      const draft = draftFor(lease); if (!draft) return fail('disabled', 'No owned draft.');
      return transaction(lease, candidate => { const row = candidate.drafts.find(d => d.id === draft.id); if (!saveDraft(candidate, row, now())) return fail('limit_exceeded', 'Drafts mailbox is full.'); mailWindow(candidate, lease.window.id).status = 'Saved to local Drafts.'; });
    },
    'mail.draft.send': async (lease, target) => {
      const draft = draftFor(lease); if (!draft) return fail('disabled', 'No owned draft.');
      const to = mailParseRecipients(draft.to), cc = mailParseRecipients(draft.cc), bcc = mailParseRecipients(draft.bcc);
      if (!to || !cc || !bcc || !to.length && !cc.length && !bcc.length) return invalid('Enter at least one valid local recipient; check To, Cc and Bcc.');
      if (!state.accounts.find(row => row.id === draft.accountId)?.enabled) return fail('disabled', 'Enable the fictional sending account first.');
      let messageId;
      const result = transaction(lease, candidate => {
        const row = candidate.drafts.find(d => d.id === draft.id), message = saveDraft(candidate, row, now()); if (!message) return fail('limit_exceeded', 'Message limit reached.');
        messageId = message.id; message.delivery = 'queued'; message.mailboxId = mailMailboxFor(candidate, row.accountId, 'outbox').id;
        row.messageId = null; row.body = ''; row.to = ''; row.cc = ''; row.bcc = ''; row.subject = ''; row.attachments = []; row.replyToId = null; row.history = [{ body: '' }]; row.historyIndex = 0; row.dirty = false;
        mailWindow(candidate, target.windowId).status = 'Queued in fictional Outbox.';
      });
      if (result?.status === 'rejected') return result;
      const sent = await transport(lease, [messageId]); if (sent?.status === 'rejected') return sent;
      return close(lease, target, true);
    },
    'mail.draft.cancel': (lease, target, p) => close(lease, target, p.discard),
    'mail.draft.attach': async (lease, target, p) => {
      const draft = draftFor(lease); if (!draft) return fail('disabled', 'No owned draft.');
      if (draft.attachments.length >= MAIL_LIMITS.attachments) return fail('limit_exceeded', 'Attachment limit reached.');
      let sourceFile = null, sourceSnapshot = null;
      if (p.fileId) {
        const result = await bridge(lease, 'readFile', [p.fileId]);
        if (result.status !== 'applied') return result;
        if (result.file?.id !== p.fileId || result.name !== p.name || result.mime !== p.mime || result.text !== p.text || result.file.content !== p.text || result.file.name !== p.name) return fail('stale_target', 'The original shared file must still have the exact name, MIME and bytes being attached. Mail never rewrites it.');
        sourceFile = result.file; sourceSnapshot = JSON.stringify(sourceFile);
      }
      return transaction(lease, candidate => { const row = candidate.drafts.find(d => d.id === draft.id); row.attachments.push({ id: mailNewId(candidate, 'mail-attachment'), name: p.name, mime: p.mime, text: p.text, fileId: p.fileId ?? null }); row.dirty = true; }, () => !sourceFile || typeof ctx.getFile === 'function' && ctx.getFile(p.fileId) === sourceFile && JSON.stringify(sourceFile) === sourceSnapshot);
    },
    'mail.draft.chooseAttachment': async (lease, target) => {
      const draft = draftFor(lease);
      if (!draft) return fail('disabled', 'No owned draft.');
      if (draft.attachments.length >= MAIL_LIMITS.attachments) return fail('limit_exceeded', 'Attachment limit reached.');
      const picked = await bridge(lease, 'chooseFile', [{ appId: 'mail', windowId: target.windowId, title: 'Attach', accept: mailSpecs['mail.draft.attach'][1].properties.mime.enum }]);
      if (picked.status !== 'applied' || picked.cancelled) return picked;
      if (typeof picked.fileId !== 'string' || typeof ctx.getFile !== 'function' || ctx.getFile(picked.fileId) !== picked.file) return stale();
      const read = await bridge(lease, 'readFile', [picked.fileId]);
      if (read.status !== 'applied') return read;
      if (read.file !== picked.file || read.text.length > MAIL_LIMITS.attachmentText || !mailSpecs['mail.draft.attach'][1].properties.mime.enum.includes(read.mime)) return fail('unavailable', 'Choose a supported original local document within the attachment byte bound.');
      return operations['mail.draft.attach'](lease, target, { fileId: picked.fileId, name: read.name, mime: read.mime, text: read.text });
    },
    'mail.draft.removeAttachment': (lease, target, p) => {
      const draft = draftFor(lease); if (!draft?.attachments.some(row => row.id === p.attachmentId)) return fail('stale_target', 'The attachment does not belong to this composer.');
      return transaction(lease, candidate => { const row = candidate.drafts.find(d => d.id === draft.id); row.attachments = row.attachments.filter(a => a.id !== p.attachmentId); row.dirty = true; });
    },
    'mail.draft.format': async (lease, target, p) => {
      const draft = draftFor(lease); if (!draft) return fail('disabled', 'No owned draft.');
      if (p.style === 'plain' || p.style === 'rich') return operations['mail.draft.update'](lease, target, { field: 'format', value: p.style });
      const selection = lease.view.selection?.() ?? lease.view.describe().selection;
      if (selection?.control !== 'body' || selection.value !== draft.body || !selection.writable) return fail('disabled', 'Focus and select the actual composer body.');
      const start = p.start ?? selection.start, end = p.end ?? selection.end;
      if (start !== selection.start || end !== selection.end || start >= end || end > draft.body.length) return invalid('Formatting must match the real nonempty native body selection.');
      const text = draft.body.slice(start, end), markers = { bold: ['**', '**'], italic: ['_', '_'], underline: ['[u]', '[/u]'] };
      const insertion = p.style === 'quote' ? text.split('\n').map(line => `> ${line}`).join('\n') : p.style === 'list' ? text.split('\n').map(line => `• ${line}`).join('\n') : text.split('\n').map(line => line ? `${markers[p.style][0]}${line}${markers[p.style][1]}` : '').join('\n');
      const result = transaction(lease, candidate => { const row = candidate.drafts.find(d => d.id === draft.id); row.format = 'rich'; bodyEdit(row, row.body.slice(0, start) + insertion + row.body.slice(end)); });
      if (result?.status === 'rejected') return result;
      await ctx.tick(); if (!lease.current() || !await lease.view.setSelection('body', start, start + insertion.length, lease.current)) return stale(); return true;
    },
    'mail.draft.undo': lease => history(lease, -1),
    'mail.draft.redo': lease => history(lease, 1),
    'mail.recipients.resolve': async (lease, target, p) => {
      const draft = draftFor(lease); if (!draft) return fail('disabled', 'No owned composer.');
      const result = await bridge(lease, 'resolveContacts', [p.query]); if (result.status !== 'applied') return result;
      if (!Array.isArray(result.contacts) || result.contacts.length > 64 || result.contacts.some(row => !row || typeof row.name !== 'string' || row.name.length > 256 || !mailEmail(row.email))) return fail('bridge_failed', 'Contacts bridge must return bounded actual {name,email} records.');
      const completed = new Set((mailParseRecipients(mailRecipientParts(draft[p.field]).slice(0, -1).join(', ')) ?? []).map(row => row.email.toLowerCase()));
      return applied(target, { contacts: result.contacts.filter(row => !completed.has(row.email.toLowerCase())).map(row => ({ name: row.name, email: row.email })) });
    },
    'mail.recipients.choose': async (lease, target, p) => {
      const draft = draftFor(lease); if (!draft || !mailEmail(p.email)) return invalid('Choose a valid address in the owned composer.');
      const resolved = await operations['mail.recipients.resolve'](lease, target, { field: p.field, query: p.email });
      if (resolved.status !== 'applied') return resolved;
      const contact = resolved.contacts.find(row => row.email.toLowerCase() === p.email.toLowerCase() && (!p.name || row.name === p.name));
      if (!contact) return fail('stale_target', 'The original shared contact address is no longer an available recipient.');
      const previous = mailRecipientParts(draft[p.field]); previous.pop(); previous.push(mailDisplayAddress(contact));
      return operations['mail.draft.update'](lease, target, { field: p.field, value: previous.filter(Boolean).join(', ') });
    },
    'mail.mailbox.select': (lease, target, p) => {
      if (lease.session.sheet === 'delete') return fail('disabled', 'Dismiss the original deletion confirmation before changing mailboxes.');
      if (!state.mailboxes.some(row => row.id === p.mailboxId)) return stale();
      return transaction(lease, candidate => { const win = mailWindow(candidate, target.windowId); win.mailboxId = p.mailboxId; win.selectedIds = []; win.query = ''; win.sheet = 'none'; });
    },
    'mail.mailbox.create': (lease, target, p) => {
      if (state.mailboxes.length >= MAIL_LIMITS.mailboxes) return fail('limit_exceeded', 'Mailbox limit reached.');
      const accountId = p.accountId ?? state.preferences.defaultAccountId;
      if (!state.accounts.some(row => row.id === accountId) || !p.name.trim()) return invalid();
      return transaction(lease, candidate => { candidate.mailboxes.push({ id: mailNewId(candidate, 'mail-box'), name: p.name.trim(), kind: p.smart ? 'smart' : 'custom', accountId: p.smart && !p.accountId ? null : accountId, favorite: true, criteria: { field: p.smart ? p.field ?? 'all' : 'all', value: p.smart ? p.value ?? '' : '' } }); mailWindow(candidate, target.windowId).sheet = 'none'; });
    },
    'mail.mailbox.rename': (lease, target, p) => {
      const box = state.mailboxes.find(row => row.id === p.mailboxId); if (!box || !['custom', 'smart'].includes(box.kind) || !p.name.trim()) return fail('disabled', 'Only custom/smart mailboxes can be renamed.');
      return transaction(lease, candidate => { candidate.mailboxes.find(row => row.id === box.id).name = p.name.trim(); });
    },
    'mail.mailbox.delete': (lease, target, p) => {
      const box = state.mailboxes.find(row => row.id === p.mailboxId);
      if (!box || !['custom', 'smart'].includes(box.kind)) return fail('disabled', 'Only custom/smart mailboxes can be removed.');
      if (state.messages.some(row => row.mailboxId === box.id || row.previousMailboxId === box.id) || state.rules.some(row => row.mailboxId === box.id)) return fail('disabled', 'Move existing messages and remove referring rules before deleting this mailbox.');
      return transaction(lease, candidate => { candidate.mailboxes = candidate.mailboxes.filter(row => row.id !== box.id); for (const win of candidate.windows) if (win.mailboxId === box.id) { win.mailboxId = mailMailboxFor(candidate, candidate.preferences.defaultAccountId, 'inbox').id; win.selectedIds = []; } });
    },
    'mail.mailbox.favorite': (lease, target, p) => { if (!state.mailboxes.some(row => row.id === p.mailboxId)) return stale(); return transaction(lease, candidate => { candidate.mailboxes.find(row => row.id === p.mailboxId).favorite = p.favorite; }); },
    'mail.message.select': async (lease, target, p) => {
      const rows = visibleMailMessages(state, target.windowId), message = rows.find(row => row.id === p.messageId); if (!message) return stale();
      if (lease.session.sheet === 'delete') return fail('disabled', 'Dismiss the original deletion confirmation before changing the selection.');
      const result = transaction(lease, candidate => {
        const win = mailWindow(candidate, target.windowId), row = candidate.messages.find(row => row.id === message.id);
        if (p.extend && win.selectedIds.length) { const anchor = rows.findIndex(r => r.id === win.selectedIds[0]), endpoint = rows.indexOf(message); win.selectedIds = rows.slice(Math.min(anchor < 0 ? endpoint : anchor, endpoint), Math.max(anchor, endpoint) + 1).map(r => r.id); }
        else if (p.toggle) win.selectedIds = win.selectedIds.includes(message.id) ? win.selectedIds.filter(id => id !== message.id) : [...win.selectedIds, message.id];
        else win.selectedIds = [message.id];
        if (candidate.preferences.markRead) row.read = true;
      });
      if (result?.status === 'rejected') return result;
      if (message.delivery === 'draft' && !p.toggle && !p.extend) {
        let draft = state.drafts.find(row => row.messageId === message.id);
        if (draft?.windowId) { ctx.focusWindow(draft.windowId); return applied({ windowId: draft.windowId }); }
        if (!draft) {
          let id;
          const saved = transaction(lease, candidate => { id = mailNewId(candidate, 'mail-draft'); candidate.drafts.push({ id, windowId: null, messageId: message.id, accountId: message.accountId, to: message.to.map(mailDisplayAddress).join(', '), cc: message.cc.map(mailDisplayAddress).join(', '), bcc: message.bcc.map(mailDisplayAddress).join(', '), subject: message.subject, body: message.text, format: message.format, signatureId: null, priority: message.priority, attachments: copyCanonicalData(message.attachments), replyToId: null, mode: 'new', dirty: false, history: [{ body: message.text }], historyIndex: 0 }); });
          if (saved?.status === 'rejected') return saved; draft = state.drafts.find(row => row.id === id);
        }
        return spawn(lease, 'compose', draft.id);
      }
      return true;
    },
    'mail.selection.all': (lease, target) => lease.session.sheet === 'delete' ? fail('disabled', 'Dismiss the original deletion confirmation before changing the selection.') : transaction(lease, candidate => { mailWindow(candidate, target.windowId).selectedIds = visibleMailMessages(candidate, target.windowId).map(row => row.id); }),
    'mail.message.action': (lease, target, p) => {
      // The actual Move sheet owns the original selection while its modal
      // blocks the background reader controls; only its rendered move action
      // may use that preserved selection.
      const controls = lease.view.describe().controlIds;
      const moveSheet = p.action === 'move' && controls.includes(`move-to:${p.mailboxId}`);
      const deleteSheet = p.action === 'delete' && p.confirm === true && lease.session.sheet === 'delete' && controls.includes('delete-confirm');
      if (p.confirm && !deleteSheet) return fail('disabled', 'Accept only the original mounted permanent-deletion confirmation.');
      const rows = moveSheet || deleteSheet ? state.messages.filter(row => lease.session.selectedIds.includes(row.id) && (!target.messageId || target.messageId === row.id)) : selected(lease, target);
      if (!rows.length) return fail('disabled', 'Select at least one real message.');
      if (rows.some(row => ['queued', 'failed'].includes(row.delivery)) && !['read', 'unread', 'flag', 'unflag'].includes(p.action)) return fail('disabled', 'Cancel an Outbox send before moving its message.');
      const moveBox = p.action === 'move' ? state.mailboxes.find(row => row.id === p.mailboxId && row.kind !== 'smart') : null;
      if (p.action === 'move' && (!moveBox || rows.some(row => row.accountId !== moveBox.accountId))) return invalid('Move requires a real mailbox belonging to every selected message account.');
      if (p.action === 'junk' && !state.preferences.junkEnabled) return fail('disabled', 'Junk filtering is disabled in preferences.');
      if (p.action === 'restore' && rows.some(row => state.mailboxes.find(b => b.id === row.mailboxId)?.kind !== 'trash')) return fail('disabled', 'Restore only applies to Trash messages.');
      if (p.action === 'delete' && !deleteSheet && rows.some(row => state.mailboxes.find(box => box.id === row.mailboxId)?.kind === 'trash')) {
        return transaction(lease, candidate => { mailWindow(candidate, target.windowId).sheet = 'delete'; });
      }
      return transaction(lease, candidate => {
        for (const id of rows.map(row => row.id)) {
          const row = candidate.messages.find(row => row.id === id), box = candidate.mailboxes.find(b => b.id === row.mailboxId);
          if (p.action === 'read' || p.action === 'unread') row.read = p.action === 'read';
          else if (p.action === 'flag' || p.action === 'unflag') row.flagged = p.action === 'flag';
          else if (p.action === 'delete' && box.kind === 'trash') {
            if (candidate.drafts.some(d => d.messageId === id && d.windowId)) return fail('disabled', 'Close the active composer before deleting its draft.');
            candidate.messages = candidate.messages.filter(m => m.id !== id); candidate.drafts = candidate.drafts.filter(d => d.messageId !== id); candidate.activity = candidate.activity.filter(a => a.messageId !== id);
            for (const d of candidate.drafts) if (d.replyToId === id) d.replyToId = null;
          } else {
            const destination = p.action === 'restore' ? candidate.mailboxes.find(b => b.id === row.previousMailboxId && b.kind !== 'trash') ?? mailMailboxFor(candidate, row.accountId, 'inbox') : p.action === 'move' ? candidate.mailboxes.find(b => b.id === p.mailboxId) : mailMailboxFor(candidate, row.accountId, p.action === 'delete' ? 'trash' : p.action);
            if (!destination) return invalid();
            if (row.delivery === 'draft' && destination.kind !== 'drafts') {
              if (candidate.drafts.some(d => d.messageId === id && d.windowId)) return fail('disabled', 'Close the active composer before moving its draft.');
              candidate.drafts = candidate.drafts.filter(d => d.messageId !== id); row.delivery = 'cancelled';
            }
            const previous = row.mailboxId; row.mailboxId = destination.id; row.previousMailboxId = p.action === 'restore' ? null : previous;
          }
        }
        clearSelections(candidate);
        if (deleteSheet) mailWindow(candidate, target.windowId).sheet = 'none';
      });
    },
    'mail.view.set': (lease, target, p) => {
      if (lease.session.sheet === 'delete' && Object.keys(p).some(key => key !== 'sheet') || lease.session.sheet === 'delete' && p.sheet !== 'none') return fail('disabled', 'Only dismiss the original deletion confirmation before changing this view.');
      return transaction(lease, candidate => { const win = mailWindow(candidate, target.windowId); Object.assign(win, p); if (own(p, 'query') || own(p, 'filter')) win.selectedIds = win.selectedIds.filter(id => visibleMailMessages(candidate, target.windowId).some(row => row.id === id)); });
    },
    'mail.attachment.preview': (lease, target) => {
      if (!represented(lease, target.messageId)) return fail('stale_target', 'The message is not represented in this original native Mail window.');
      const attachment = state.messages.find(row => row.id === target.messageId)?.attachments.find(row => row.id === target.attachmentId);
      return attachment ? applied(target, { attachment: copyCanonicalData(attachment) }) : stale();
    },
    'mail.attachment.save': (lease, target) => fileAttachment(lease, target, false),
    'mail.attachment.open': (lease, target) => fileAttachment(lease, target, true),
    'mail.attachments.saveAll': async (lease, target) => {
      const message = selected(lease, target)[0];
      if (!message?.attachments.length) return fail('disabled', 'Select a message with actual attachments.');
      const fileIds = [];
      for (const attachment of [...message.attachments]) {
        const result = await fileAttachment(lease, { ...target, messageId: message.id, attachmentId: attachment.id }, false);
        if (result.status !== 'applied') return result;
        fileIds.push(result.fileId);
      }
      return applied(target, { fileIds });
    },
    'mail.attachments.remove': (lease, target) => {
      const message = selected(lease, target)[0];
      if (!message?.attachments.length || ['queued', 'failed'].includes(message.delivery)) return fail('disabled', 'Select a non-sending message with actual attachments.');
      return transaction(lease, candidate => {
        candidate.messages.find(row => row.id === message.id).attachments = [];
        for (const draft of candidate.drafts) if (draft.messageId === message.id) { draft.attachments = []; draft.dirty = true; }
      });
    },
    'mail.contact.create': async (lease, target) => {
      const message = selected(lease, target)[0]; if (!message) return fail('disabled', 'Select a real sender.');
      const result = await bridge(lease, 'createContact', [{ name: message.from.name, email: message.from.email, source: { appId: 'mail', messageId: message.id } }]);
      if (result.status !== 'applied') return result;
      const contactId = result.contactId ?? result.target?.contactId;
      return typeof contactId === 'string' && contactId ? applied(target, { contactId }) : fail('bridge_failed', 'Contacts must return the actual canonical contact identity.');
    },
    'mail.invitation.respond': async (lease, target, p) => {
      const message = selected(lease, target)[0], invitation = message?.invitation; if (!invitation) return fail('disabled', 'This message has no canonical calendar invitation.');
      const result = await bridge(lease, 'acceptInvitation', [{ invitationId: invitation.id, title: invitation.title, start: invitation.start, end: invitation.end, location: invitation.location, response: p.response, eventId: invitation.eventId, source: { appId: 'mail', messageId: message.id } }]);
      if (result.status !== 'applied') return result;
      const eventId = result.eventId ?? result.target?.eventId;
      if (p.response !== 'declined' && (typeof eventId !== 'string' || !eventId)) return fail('bridge_failed', 'Calendar must return the actual canonical event identity.');
      return transaction(lease, candidate => { const row = candidate.messages.find(row => row.id === message.id).invitation; row.status = p.response; row.eventId = eventId ?? null; });
    },
    'mail.message.print': async (lease, target) => {
      const message = selected(lease, target)[0]; if (!message) return fail('disabled', 'Select a message to print.');
      const result = await bridge(lease, 'printDocument', [{ appId: 'mail', documentId: message.id, title: message.subject || 'Mail message', text: exportedMessage(message), html: message.html }]);
      if (result.status !== 'applied') return result;
      const printJobId = result.printJobId ?? result.target?.printJobId, printDialogId = result.printDialogId ?? result.target?.printDialogId;
      return printJobId || printDialogId ? applied(target, { ...(printJobId ? { printJobId } : { printDialogId }) }) : fail('bridge_failed', 'Print must return the actual canonical job or print-dialog identity.');
    },
    'mail.message.share': async (lease, target) => {
      const message = selected(lease, target)[0]; if (!message) return fail('disabled', 'Select a real message.');
      const result = await bridge(lease, 'share', [{ appId: 'mail', documentId: message.id, title: message.subject, text: exportedMessage(message) }]);
      if (result.status !== 'applied') return result;
      const shareId = result.shareId ?? result.target?.shareId;
      return typeof shareId === 'string' && shareId ? applied(target, { shareId }) : fail('bridge_failed', 'Share must return the actual canonical share surface identity.');
    },
    'mail.message.export': async (lease, target) => {
      const message = selected(lease, target)[0]; if (!message) return fail('disabled', 'Select a real message.');
      const result = await bridge(lease, 'createFile', [{ name: `${(message.subject || 'Message').replace(/[\\/\u0000-\u001f]/gu, '_').slice(0, 120)}.eml`, mime: 'message/rfc822', text: exportedMessage(message), source: { appId: 'mail', messageId: message.id } }]);
      const fileId = result.fileId ?? result.target?.fileId; if (result.status !== 'applied') return result;
      if (!fileId) return fail('bridge_failed', 'Files must return a canonical file identity.');
      return applied(target, { fileId });
    },
    'mail.preferences.open': (lease, target, p) => lease.session.kind === 'preferences'
      ? transaction(lease, candidate => { mailWindow(candidate, target.windowId).pane = p.pane ?? 'General'; })
      : spawn(lease, 'preferences', null, p.pane ?? 'General'),
    'mail.preferences.set': (lease, target, p) => transaction(lease, candidate => {
      Object.assign(candidate.preferences, p);
      for (const win of candidate.windows) { if (own(p, 'conversationView')) win.threaded = p.conversationView; }
    }),
    'mail.sound.preview': async (lease, target) => {
      if (!state.preferences.playSound) return fail('disabled', 'Enable the local new-mail sound preference first.');
      const result = await bridge(lease, 'playSound', [{ appId: 'mail', kind: 'new-mail-preview', fictional: true }]);
      return result.status === 'applied' ? applied(target) : result;
    },
    'mail.account.add': (lease, target, p) => {
      if (!mailEmail(p.email) || !p.name.trim() || state.accounts.some(row => row.email.toLowerCase() === p.email.toLowerCase())) return invalid('Use a unique valid fictional account address and name.');
      if (state.accounts.length >= MAIL_LIMITS.accounts || state.mailboxes.length + 7 > MAIL_LIMITS.mailboxes) return fail('limit_exceeded', 'Account/mailbox bound reached.');
      return transaction(lease, candidate => {
        const id = mailNewId(candidate, 'mail-account'); candidate.accounts.push({ id, name: p.name, email: p.email, enabled: true, online: true, connection: candidate.offline ? 'offline' : 'connected', failure: 'none', signatureId: null });
        for (const kind of ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'outbox']) candidate.mailboxes.push({ id: mailNewId(candidate, 'mail-box'), name: kind[0].toUpperCase() + kind.slice(1), kind, accountId: id, favorite: kind === 'inbox', criteria: { field: 'all', value: '' } });
        mailWindow(candidate, target.windowId).sheet = 'none'; addActivity(candidate, id, 'connect', 'completed', 'Fictional local account setup. No credentials, servers, or external authentication.', now());
      });
    },
    'mail.account.update': (lease, target, p) => {
      if (!state.accounts.some(row => row.id === p.accountId) || own(p, 'email') && (!mailEmail(p.email) || state.accounts.some(row => row.id !== p.accountId && row.email.toLowerCase() === p.email.toLowerCase()))) return invalid();
      return transaction(lease, candidate => { const account = candidate.accounts.find(row => row.id === p.accountId); const { accountId, ...values } = p; Object.assign(account, values); account.connection = connection(candidate, account); clearSelections(candidate); });
    },
    'mail.account.remove': (lease, target, p) => {
      if (!state.accounts.some(row => row.id === p.accountId)) return stale();
      if (state.accounts.length === 1 || state.messages.some(row => row.accountId === p.accountId) || state.drafts.some(row => row.accountId === p.accountId)) return fail('disabled', 'Keep at least one account. Move/remove its messages and drafts before removing an account.');
      return transaction(lease, candidate => {
        candidate.accounts = candidate.accounts.filter(row => row.id !== p.accountId); const removed = candidate.mailboxes.filter(row => row.accountId === p.accountId).map(row => row.id);
        if (candidate.rules.some(row => removed.includes(row.mailboxId))) return fail('disabled', 'Remove the account’s mailbox rules first.');
        candidate.mailboxes = candidate.mailboxes.filter(row => row.accountId !== p.accountId); candidate.activity = candidate.activity.filter(row => row.accountId !== p.accountId);
        if (candidate.preferences.defaultAccountId === p.accountId) candidate.preferences.defaultAccountId = candidate.accounts[0].id;
        for (const win of candidate.windows) if (removed.includes(win.mailboxId)) { win.mailboxId = mailMailboxFor(candidate, candidate.preferences.defaultAccountId, 'inbox').id; win.selectedIds = []; }
      });
    },
    'mail.signature.save': (lease, target, p) => {
      if (p.signatureId && !state.signatures.some(row => row.id === p.signatureId)) return stale();
      if (!p.signatureId && state.signatures.length >= MAIL_LIMITS.signatures) return fail('limit_exceeded', 'Signature bound reached.');
      return transaction(lease, candidate => { const signature = p.signatureId ? candidate.signatures.find(row => row.id === p.signatureId) : { id: mailNewId(candidate, 'mail-signature'), name: '', text: '' }; signature.name = p.name; signature.text = p.text; if (!p.signatureId) candidate.signatures.push(signature); });
    },
    'mail.signature.delete': (lease, target, p) => {
      if (!state.signatures.some(row => row.id === p.signatureId)) return stale();
      return transaction(lease, candidate => { candidate.signatures = candidate.signatures.filter(row => row.id !== p.signatureId); if (candidate.preferences.defaultSignatureId === p.signatureId) candidate.preferences.defaultSignatureId = null; for (const account of candidate.accounts) if (account.signatureId === p.signatureId) account.signatureId = null; for (const draft of candidate.drafts) if (draft.signatureId === p.signatureId) draft.signatureId = null; });
    },
    'mail.rule.save': (lease, target, p) => {
      if (p.ruleId && !state.rules.some(row => row.id === p.ruleId)) return stale();
      if (!p.ruleId && state.rules.length >= MAIL_LIMITS.rules) return fail('limit_exceeded', 'Rule bound reached.');
      if (p.action === 'move' && !state.mailboxes.some(row => row.id === p.mailboxId && row.kind !== 'smart')) return invalid('Select a real destination mailbox.');
      return transaction(lease, candidate => { const rule = { id: p.ruleId ?? mailNewId(candidate, 'mail-rule'), name: p.name, enabled: p.enabled, field: p.field, match: p.match, action: p.action, mailboxId: p.action === 'move' ? p.mailboxId : null }; if (p.ruleId) Object.assign(candidate.rules.find(row => row.id === p.ruleId), rule); else candidate.rules.push(rule); });
    },
    'mail.rule.delete': (lease, target, p) => { if (!state.rules.some(row => row.id === p.ruleId)) return stale(); return transaction(lease, candidate => { candidate.rules = candidate.rules.filter(row => row.id !== p.ruleId); }); },
    'mail.rule.apply': (lease, target) => { const rows = !target.messageId && lease.session.kind === 'preferences' ? visibleMailMessages(state, target.windowId) : selected(lease, target); if (!rows.length) return fail('disabled', 'Select real messages or use a nonempty current preferences mailbox.'); let count = 0; const result = transaction(lease, candidate => { count = applyRules(candidate, candidate.messages.filter(row => rows.some(original => original.id === row.id))); clearSelections(candidate); mailWindow(candidate, target.windowId).status = `Applied ${count} matching local rule actions.`; }); return result?.status === 'rejected' ? result : applied(target, { count }); },
    'mail.connection.check': async (lease) => {
      const result = transaction(lease, candidate => { for (const account of candidate.accounts) if (!addActivity(candidate, account.id, 'receive', 'running', 'Checking fictional frontend-local account…', now())) return fail('limit_exceeded', 'Activity bound reached.'); });
      if (result?.status === 'rejected') return result; await ctx.tick(); if (!lease.current()) return stale();
      return transaction(lease, candidate => {
        for (const account of candidate.accounts) {
          account.connection = connection(candidate, account);
          const activity = [...candidate.activity].reverse().find(row => row.accountId === account.id && row.operation === 'receive' && row.status === 'running');
          if (!activity) continue; activity.status = account.connection === 'connected' ? 'completed' : 'failed';
          activity.detail = account.connection === 'connected' ? 'Local account checked. No remote server or new message was contacted.' : account.connection === 'offline' ? 'Account offline; no transport attempted.' : 'Fictional receive failure; clear failure mode and check again.';
        }
        applyRules(candidate, candidate.messages.filter(row => candidate.mailboxes.find(box => box.id === row.mailboxId)?.kind === 'inbox'));
        const age = { day: 86400000, week: 604800000, month: 2592000000 }[candidate.preferences.deleteJunk];
        if (candidate.preferences.junkEnabled && age) for (const message of candidate.messages) if (candidate.mailboxes.find(box => box.id === message.mailboxId)?.kind === 'junk' && now() - message.date >= age) { message.previousMailboxId = message.mailboxId; message.mailboxId = mailMailboxFor(candidate, message.accountId, 'trash').id; }
        clearSelections(candidate);
      });
    },
    'mail.connection.offline': (lease, target, p) => transaction(lease, candidate => { candidate.offline = p.offline; for (const account of candidate.accounts) account.connection = connection(candidate, account); }),
    'mail.delivery.retry': async (lease, target) => { const rows = state.messages.filter(row => target.messageId ? row.id === target.messageId : ['queued', 'failed'].includes(row.delivery)); if (!rows.length || rows.some(row => !['queued', 'failed'].includes(row.delivery))) return fail('disabled', 'Choose an actual queued or failed Outbox message.'); return transport(lease, rows.map(row => row.id)); },
    'mail.delivery.cancel': (lease, target) => transaction(lease, candidate => {
      const rows = target.messageId ? candidate.messages.filter(row => row.id === target.messageId && ['queued', 'failed'].includes(row.delivery)) : candidate.messages.filter(row => ['queued', 'failed'].includes(row.delivery));
      const activities = candidate.activity.filter(row => row.status === 'running' && (!target.messageId || row.messageId === target.messageId));
      if (!rows.length && !activities.length) return fail('disabled', 'No queued local delivery or running activity to cancel.');
      for (const row of rows) { row.delivery = 'draft'; row.previousMailboxId = row.mailboxId; row.mailboxId = mailMailboxFor(candidate, row.accountId, 'drafts').id; }
      for (const activity of activities) { activity.status = 'cancelled'; activity.detail = 'Cancelled by user; no external transport used.'; }
    }),
    'mail.activity.open': lease => spawn(lease, 'activity'),
    'mail.doctor.open': lease => spawn(lease, 'doctor'),
    'mail.toolbar.open': (lease, target) => transaction(lease, candidate => { mailWindow(candidate, target.windowId).sheet = 'toolbar'; }),
    'mail.toolbar.set': (lease, target, p) => transaction(lease, candidate => { const win = mailWindow(candidate, target.windowId); win.toolbar = p.items; win.sheet = 'none'; }),
    'mail.help.open': lease => spawn(lease, 'help'),
    'mail.window.close': (lease, target) => close(lease, target),
    'mail.native.focus': async (lease, target, p) => { ctx.focusWindow(target.windowId); return await lease.view.focus(p.control, lease.current) && lease.current() ? true : fail('unavailable', 'The requested native Mail control is not visible/enabled.'); },
    'mail.native.scroll': async (lease, target, p) => { const offsets = await lease.view.scroll(p.area, p, lease.current); return offsets && lease.current() ? applied(target, { offsets }) : fail('unavailable', 'The requested native Mail scroll area is unavailable.'); },
    'mail.edit.copy': (lease, target) => clipboard(lease, target, 'copy'),
    'mail.edit.cut': (lease, target) => clipboard(lease, target, 'cut'),
    'mail.edit.paste': (lease, target) => clipboard(lease, target, 'paste'),
    'mail.edit.selectAll': (lease, target) => clipboard(lease, target, 'selectAll'),
  };
  function history(lease, direction) {
    const draft = draftFor(lease), index = (draft?.historyIndex ?? 0) + direction;
    if (!draft || index < 0 || index >= draft.history.length) return fail('disabled', 'No composer body transaction in that direction.');
    return transaction(lease, candidate => { const row = candidate.drafts.find(d => d.id === draft.id); row.historyIndex = index; row.body = row.history[index].body; row.dirty = true; });
  }
  async function fileAttachment(lease, target, open) {
    if (!represented(lease, target.messageId)) return fail('stale_target', 'The attachment message is not represented in this original native Mail window.');
    const message = state.messages.find(row => row.id === target.messageId), attachment = message?.attachments.find(row => row.id === target.attachmentId);
    if (!attachment) return stale();
    if (typeof ctx[open ? 'openFile' : 'revealFile'] !== 'function' || !attachment.fileId && typeof ctx.createFile !== 'function') return fail('unavailable', 'Real shared Files create/reveal/open bridges are required.');
    let fileId = attachment.fileId;
    if (!fileId) {
      const result = await bridge(lease, 'createFile', [{ name: attachment.name, mime: attachment.mime, text: attachment.text, source: { appId: 'mail', messageId: message.id, attachmentId: attachment.id } }]);
      if (result.status !== 'applied') return result; fileId = result.fileId ?? result.target?.fileId;
      if (typeof fileId !== 'string' || !fileId) return fail('bridge_failed', 'Files must return an actual canonical file identity.');
      const committed = transaction(lease, candidate => { candidate.messages.find(row => row.id === message.id).attachments.find(row => row.id === attachment.id).fileId = fileId; });
      if (committed?.status === 'rejected') return committed;
    }
    const result = await bridge(lease, open ? 'openFile' : 'revealFile', open ? [fileId, null] : [fileId]);
    return result.status === 'applied' ? applied(target, { fileId }) : result;
  }
  function exportedMessage(message) { return `From: ${mailDisplayAddress(message.from)}\nTo: ${message.to.map(mailDisplayAddress).join(', ')}\nCc: ${message.cc.map(mailDisplayAddress).join(', ')}\nSubject: ${message.subject}\nDate: ${new Date(message.date).toUTCString()}\nX-JesterOS-Transport: fictional frontend-local\n\n${message.text}`; }
  async function clipboard(lease, target, operation) {
    const selection = lease.view.selection?.() ?? lease.view.describe().selection;
    if (!selection && operation === 'selectAll') return operations['mail.selection.all'](lease, target);
    if (!selection) return fail('disabled', 'Select actual native text first.');
    if (operation === 'selectAll' && selection.control) return await lease.view.setSelection(selection.control, 0, selection.value.length, lease.current) ? true : stale();
    const sceneClipboard = ctx.clipboard ?? rootState.editing?.clipboard;
    if (!sceneClipboard) return fail('unavailable', 'A canonical shared scene clipboard is required.');
    const text = selection.control ? selection.value.slice(selection.start, selection.end) : selection.text;
    if (operation === 'copy') { if (!text) return fail('disabled', 'No native text selected.'); Object.assign(sceneClipboard, { kind: 'text', text, fileIds: [] }); return true; }
    const draft = draftFor(lease);
    if (!draft || !selection.writable || !['to', 'cc', 'bcc', 'subject', 'body'].includes(selection.control) || selection.value !== draft[selection.control]) return fail('disabled', 'Cut/Paste requires an actual writable composer field.');
    if (operation === 'cut' && !text || operation === 'paste' && (sceneClipboard.kind !== 'text' || !sceneClipboard.text)) return fail('disabled', 'A nonempty selection or shared text clipboard is required.');
    const insertion = operation === 'paste' ? sceneClipboard.text : '', value = selection.value.slice(0, selection.start) + insertion + selection.value.slice(selection.end);
    const result = operations['mail.draft.update'](lease, target, { field: selection.control, value }); if (result?.status === 'rejected') return result;
    if (operation === 'cut') Object.assign(sceneClipboard, { kind: 'text', text, fileIds: [] });
    await ctx.tick(); return await lease.view.setSelection(selection.control, selection.start + insertion.length, selection.start + insertion.length, lease.current) ? true : stale();
  }
  const handlers = Object.fromEntries(Object.entries(operations).map(([name, operation]) => [name, async (rawTarget, rawPayload = {}) => {
    const [targetSchema, payloadSchema] = mailSpecs[name];
    if (!mailSchemaValid(rawTarget, targetSchema) || !mailSchemaValid(rawPayload, payloadSchema)) return invalid();
    const target = copyCanonicalData(rawTarget), payload = copyCanonicalData(rawPayload), lease = owner(target.windowId);
    if (!lease) return fail(ctx.getWindow(target.windowId) ? 'unavailable' : 'stale_target', 'The original live mounted Mail window is required.');
    let result;
    try { result = await operation(lease, target, payload); } catch { return fail('operation_failed', 'The Mail operation could not complete; no external transport was used.'); }
    if (result?.status) return result;
    return finish(lease, target);
  }]));
  function windowOpened(window, options = {}) {
    if (!alive() || window.appId !== 'mail') return false;
    if (mailWindow(state, window.id)) return true;
    const kind = options.mailDraftFields ? 'compose' : options.mailKind ?? window.mailKind ?? 'mailbox';
    const draftId = options.mailDraftId ?? window.mailDraftId ?? null;
    const result = transaction(null, candidate => {
      if (candidate.windows.length >= MAIL_LIMITS.windows) return fail('limit_exceeded', 'Mail window bound reached.');
      const draft = options.mailDraftFields ? createMailServiceDraft(candidate, options.mailDraftFields, () => true)
        : draftId ? candidate.drafts.find(row => row.id === draftId) : null;
      if (kind === 'compose' && !draft || draft?.windowId) return invalid('Composer opening requires its original unowned canonical draft.');
      const win = createMailWindow(candidate, window.id, kind, draft?.id ?? draftId); win.pane = options.mailPane ?? 'General'; candidate.windows.push(win); if (draft) draft.windowId = window.id;
    }, options.isCurrent);
    return result?.status !== 'rejected';
  }
  function windowClosed(window) {
    const id = typeof window === 'string' ? window : window.id; versions.set(id, (versions.get(id) ?? 0) + 1);
    if (!alive()) return false;
    const result = transaction(null, candidate => {
      const draft = candidate.drafts.find(row => row.windowId === id); if (draft) { if (!saveDraft(candidate, draft, now())) return fail('limit_exceeded', 'Cannot preserve this composer; close must be prevented before retiring window.'); draft.windowId = null; }
      candidate.windows = candidate.windows.filter(row => row.windowId !== id);
    }); return result?.status !== 'rejected';
  }
  function appQuit() {
    if (!alive()) return false;
    const result = transaction(null, candidate => { for (const draft of candidate.drafts) if (draft.windowId) { if (!saveDraft(candidate, draft, now())) return fail('limit_exceeded', 'Cannot preserve drafts; application quit must be prevented.'); draft.windowId = null; } candidate.windows = []; for (const activity of candidate.activity) if (activity.status === 'running') { activity.status = 'cancelled'; activity.detail = 'Mail quit; local operation cancelled.'; } });
    for (const [id, version] of versions) versions.set(id, version + 1); return result?.status !== 'rejected';
  }
  function targets(windowId) {
    const win = mailWindow(state, windowId), view = ctx.getView(windowId);
    if (!win || !view?.available()) return { available: false, windows: [] };
    return { available: true, windowId, kind: win.kind, mailboxId: win.mailboxId, messageIds: visibleMailMessages(state, windowId).map(row => row.id), selectedIds: [...win.selectedIds], draftId: win.draftId, native: view.describe(), windows: state.windows.map(row => ({ windowId: row.windowId, kind: row.kind })) };
  }
  // Parent scene-time pump can call pulse: simulated interval checking is deterministic and network-free.
  let lastCheck = now();
  async function pulse() {
    const interval = { minute: 60000, five: 300000, fifteen: 900000 }[state.preferences.checkInterval];
    if (!alive() || !interval || state.offline || now() - lastCheck < interval) return false;
    const win = state.windows.find(row => row.kind === 'mailbox' && ctx.getView(row.windowId)?.available()); if (!win) return false;
    lastCheck = now(); return handlers['mail.connection.check']({ windowId: win.windowId }, {});
  }
  return { handlers, targets, windowOpened, windowClosed, appQuit, pulse };
}

// Parent Services migration must use this canonical draft helper, not communication-state mailDrafts.
export function createMailServiceDraft(state, { to = '', subject = '', body = '', accountId = state.preferences.defaultAccountId } = {}, canCommit = null) {
  if (!validateMailState(state) || state.drafts.length >= MAIL_LIMITS.drafts || !state.accounts.some(row => row.id === accountId) || typeof to !== 'string' || to.length > 4096 || typeof subject !== 'string' || subject.length > 1024 || typeof body !== 'string' || body.length > MAIL_LIMITS.text) return null;
  const candidate = copyCanonicalData(state), id = mailNewId(candidate, 'mail-draft'), account = candidate.accounts.find(row => row.id === accountId);
  const draft = { id, windowId: null, messageId: null, accountId, to, cc: '', bcc: '', subject, body, format: candidate.preferences.composeFormat, signatureId: account.signatureId ?? candidate.preferences.defaultSignatureId, priority: 'normal', attachments: [], replyToId: null, mode: 'new', dirty: false, history: [{ body }], historyIndex: 0 };
  candidate.drafts.push(draft);
  if (!validateMailState(candidate)) return null;
  if (typeof canCommit === 'function' && canCommit(mailTextUnits(candidate) - mailTextUnits(state)) !== true) return null;
  applyCanonicalData(state, candidate);
  return state.drafts.find(row => row.id === id);
}
