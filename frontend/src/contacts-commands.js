import { defineCommand, object, empty, choice, flag } from './command-schema.js';
import { CONTACTS_PROFILES, CONTACTS_LIMITS, CONTACTS_SHEETS, contactsIdSchema as id, contactsEditorSchema, contactsGroupSpecSchema, contactsAccountSpecSchema, contactsPreferencesSchema, contactsTemplateSchema, contactsSchemaValid, contactsSpecValid, validateContactsState, contactsTextUnits, contactsWindow, createContactsWindow, contactById, contactSpec, contactName, createContactEditor, completedContactSpec, visibleContacts, contactsNewId, createContact, linkedContact, contactPrintText, contactsCapabilities } from './contacts-state.js';
import { parseContactsVCard, exportContactsVCard } from './contacts-vcard.js';
import { applyCanonicalData, copyCanonicalData } from './canonical-data.js';

const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const ids = { type: 'array', items: id, minItems: 1, maxItems: CONTACTS_LIMITS.contacts, uniqueItems: true };
const windowTarget = object({ windowId: id });
const text = (maxLength = 4096) => ({ type: 'string', maxLength });
const commands = {
  search: [object({ query: text() }), 'Search all current card fields with native list/empty results.'],
  select: [object({ contactIds: { ...ids, minItems: 0 } }), 'Select existing currently visible cards; preserve multiple selection for lists, merge and linking.'],
  'group.select': [object({ groupId: nullable(id) }), 'Select all contacts or a real group/smart list.'],
  'view.set': [object({ sidebarVisible: flag }), 'Show or hide the actual native groups/list sidebar.'],
  'preferences.set': [object({ preferences: contactsPreferencesSchema }), 'Apply validated sorting, display, default source and vCard/photo preferences.'],
  'sheet.open': [object({ sheet: choice(...CONTACTS_SHEETS.filter(value => value !== 'none')), pane: choice('General', 'Accounts', 'Template', 'vCard') }, ['sheet']), 'Open the actual native dialog/settings/account/template/import/help panel.'],
  'sheet.close': [empty, 'Close the current sheet without changing canonical cards.'],
  'menu.open': [object({ menuId: choice('contacts', 'file', 'edit', 'view', 'card', 'window', 'help') }), 'Open the actual current native menu anchored to its enabled rendered heading.'],
  'menu.close': [object({ restoreFocus: flag }), 'Close the observed native menu and optionally restore its actual original heading focus.'],
  'editor.open': [object({ contactId: nullable(id) }), 'Open the full editable source card or a new canonical draft.'],
  'card.open': [object({ contactId: id }), 'Open the original canonical card in a real separate Contacts window, never duplicate its source record.'],
  'editor.set': [object({ spec: contactsEditorSchema }), 'Set bounded native editor draft fields including intermediate typing and newly added blank rows; strict contact semantics apply on Save.'],
  'editor.save': [empty, 'Create or update the source record and every field from the native editor.'],
  'editor.cancel': [empty, 'Discard the current uncommitted edit without touching any source card.'],
  delete: [object({ contactIds: ids }), 'Delete source records and repair membership, links, selections and My Card.'],
  'group.save': [object({ groupId: nullable(id), spec: contactsGroupSpecSchema }), 'Create/rename ordinary groups or evaluated smart lists with all/any criteria.'],
  'group.delete': [object({ groupId: id }), 'Delete the group only, leaving its contact cards intact.'],
  'group.members': [object({ groupId: id, contactIds: ids, operation: choice('add', 'remove') }), 'Change explicit group membership; smart groups are evaluated rather than manually populated.'],
  merge: [object({ contactIds: { ...ids, minItems: 2 }, primaryId: id }), 'Merge duplicate cards into chosen primary source, union repeated values and preserve conflicting names/notes and source provenance.'],
  link: [object({ contactIds: { ...ids, minItems: 2 }, operation: choice('link', 'unlink') }), 'Unify source cards by symmetric links without overwriting original source/account data; unlink restores separate cards.'],
  'myCard.set': [object({ contactId: id }), 'Choose the existing canonical My Card record.'],
  'myCard.show': [empty, 'Reveal the actual My Card in All Contacts, clearing list/search filtering without inventing a record.'],
  'account.save': [object({ accountId: nullable(id), spec: contactsAccountSpecSchema }), 'Present and manage fictional local account sources without credentials or network.'],
  'account.delete': [object({ accountId: id }), 'Remove an unused source account; never silently delete its cards.'],
  'template.set': [object({ template: contactsTemplateSchema }), 'Set native new-card fields and default custom labels.'],
  import: [object({ text: text(CONTACTS_LIMITS.vcard) }), 'Atomically import supported UTF-8 vCard 3/4 cards into the default source; disclose unsupported properties.'],
  'import.file': [object({ fileId: id }), 'Read an actual shared virtual-file vCard through an ownership-guarded parent bridge.'],
  'photo.file': [object({ fileId: id }), 'Read an embedded PNG/JPEG/WebP data URL from an actual shared virtual file into the open photo editor.'],
  export: [object({ contactIds: ids, name: { ...text(256), minLength: 1 } }), 'Export selected linked/unified cards as real shared virtual UTF-8 vCard files.'],
  action: [object({ contactId: id, kind: choice('mail', 'message', 'call', 'video', 'share'), index: { type: 'integer', minimum: 0, maximum: CONTACTS_LIMITS.values - 1 } }), 'Open real local mail/message/audio/video/share destinations through parent bridges, never transport.'],
  print: [object({ contactIds: ids, style: choice('card', 'list', 'labels') }), 'Create an actual shared local print job for cards, phone/email lists or address labels.'],
  clipboard: [object({ operation: choice('copy', 'cut', 'paste', 'selectAll') }), 'Operate on the actual focused native editable field and scene clipboard, not host clipboard.'],
};
export const contactsCatalog = Object.fromEntries(Object.entries(commands).map(([name, [schema, description]]) => defineCommand(CONTACTS_PROFILES, `contacts.${name}`, 'contacts.cards', windowTarget, schema,
  ['An available original Contacts/People window with its own mounted native view and canonical session.', 'No network, host contacts, phone/email transport, credentials or host clipboard; parent bridges must retain original ownership through await.'], [description], ['contacts'], [], windowTarget)));
for (const [name, target, payload, description] of [
  ['focus', object({ windowId: id, controlId: { ...text(256), minLength: 1 } }), empty, 'Focus an actual current enabled rendered native control.'],
  ['scroll', object({ windowId: id, areaId: choice('groups', 'list', 'card', 'dialog') }), object({ top: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, left: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }), 'Scroll the mounted native area and return its observed clamped offsets.'],
]) contactsCatalog[`contacts.${name}`] = Object.fromEntries([defineCommand(CONTACTS_PROFILES, `contacts.${name}`, 'contacts.cards', target, payload, ['Original available mounted native view.'], [description], [], [], target)])[`contacts.${name}`];

const reject = (code, message) => ({ status: 'rejected', code, message });
const applied = (target, extra = {}) => ({ status: 'applied', target, ...extra });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createContactsCommands(ctx) {
  const state = ctx.getState(); let sequence = 0;
  const alive = () => ctx.getState() === state && CONTACTS_PROFILES.includes(ctx.profile.id) && (typeof ctx.alive !== 'function' || ctx.alive() === true);
  function owner(windowId) {
    if (!alive() || !validateContactsState(state, ctx.profile)) return null;
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId), session = contactsWindow(state, windowId);
    if (!window || !session || !view || ctx.available(window) !== true || view.available() !== true) return null;
    const version = ++sequence, contacts = state.contacts, groups = state.groups, accounts = state.accounts, windows = state.windows, nextId = state.nextId;
    const records = contacts.map(row => ({ row, revision: row.revision, fields: ['name', 'photo', 'links', 'emails', 'phones', 'addresses', 'urls'].map(key => [key, row[key], Array.isArray(row[key]) ? [...row[key]] : null]) })), stateSignature = JSON.stringify(state);
    const sourceSignature = JSON.stringify({ ...state, windows: [] }), sessionSignature = JSON.stringify(session), preferences = state.preferences, template = state.template;
    const accountRecords = [...accounts], groupRecords = [...groups];
    const sourceGuard = () => alive() && state.contacts === contacts && state.groups === groups && state.accounts === accounts && state.preferences === preferences && state.template === template
      && contacts.length === records.length && records.every(({ row, revision, fields }, index) => contacts[index] === row && row.revision === revision && fields.every(([key, value, entries]) => row[key] === value && (!entries || entries.length === value.length && entries.every((entry, i) => value[i] === entry))))
      && accountRecords.length === accounts.length && accountRecords.every((row, index) => accounts[index] === row) && groupRecords.length === groups.length && groupRecords.every((row, index) => groups[index] === row)
      && JSON.stringify({ ...state, windows: [] }) === sourceSignature && contactsWindow(state, windowId) === session && JSON.stringify(session) === sessionSignature
      && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view && ctx.available(window) === true && view.available() === true;
    const guard = () => sourceGuard() && sequence === version && state.windows === windows && state.nextId === nextId && JSON.stringify(state) === stateSignature;
    return { window, view, session, guard, sourceGuard };
  }
  const stale = () => reject('stale_target', 'The original Contacts window, native view, session or source card changed.');
  const invalid = () => reject('invalid_arguments', 'Use the bounded closed documented Contacts target and payload.');
  const writable = contact => !!contact && state.accounts.some(account => account.id === contact.accountId && account.enabled && !account.readOnly);
  const now = () => { const time = ctx.getSceneTime?.() ?? 0; const value = typeof time === 'number' ? time : Date.parse(time); return Number.isFinite(value) && value >= 0 && value < 8640000000000000 ? Math.floor(value) : 0; };
  const selectionValid = (contactIds, visible = false, windowId = '') => contactIds.length > 0 && contactIds.every(id => (visible ? visibleContacts(state, windowId) : state.contacts).some(row => row.id === id));
  async function commit(lease, mutation, target, extra = {}) {
    if (!lease.guard()) return stale();
    const candidate = copyCanonicalData(state), result = mutation(candidate, contactsWindow(candidate, lease.window.id));
    if (result?.status === 'rejected') return result;
    if (!validateContactsState(candidate, ctx.profile)) return reject('invalid_arguments', 'The operation violates bounded Contacts schema or source/link/membership semantics.');
    const delta = contactsTextUnits(candidate) - contactsTextUnits(state);
    if (ctx.canCommit && ctx.canCommit(delta) !== true) return reject('limit_exceeded', 'The complete scene text budget would be exceeded.');
    if (!lease.guard()) return stale();
    applyCanonicalData(state, candidate); const committedSequence = ++sequence;
    const contacts = state.contacts, windows = state.windows;
    if (typeof ctx.tick === 'function') await ctx.tick();
    const presentationAvailable = alive() && sequence === committedSequence && state.contacts === contacts && state.windows === windows
      && ctx.getWindow(lease.window.id) === lease.window && ctx.getView(lease.window.id) === lease.view
      && ctx.available(lease.window) === true && lease.view.available() === true;
    return applied(target, { ...extra, ...(result ?? {}), presentationAvailable });
  }
  const bridgeResult = (result, target) => result?.status === 'applied' ? applied(target, Object.fromEntries(Object.entries(result).filter(([key]) => !['status', 'target'].includes(key)))) : result?.status === 'rejected' ? result : reject('unavailable', 'The shared local destination did not apply the requested action.');
  async function bridge(lease, name, spec, target) {
    if (typeof ctx[name] !== 'function') return reject('unavailable', `The real local ${name} bridge is unavailable.`);
    if (!lease.guard()) return stale();
    const ownership = { guard: lease.guard, windowId: lease.window.id };
    const result = await ctx[name](name === 'composeMessage' ? { ...spec, guard: lease.guard } : spec, ownership);
    if (!lease.guard()) return stale();
    return bridgeResult(result, target);
  }
  const handlers = {};
  for (const [suffix, [schema]] of Object.entries(commands)) handlers[`contacts.${suffix}`] = async (rawTarget, rawPayload = {}) => {
    if (!contactsSchemaValid(rawTarget, windowTarget) || !contactsSchemaValid(rawPayload, schema)) return invalid();
    const target = copyCanonicalData(rawTarget), payload = copyCanonicalData(rawPayload), lease = owner(target.windowId);
    if (!lease) return reject(ctx.getWindow(target.windowId) ? 'unavailable' : 'stale_target', 'The original Contacts/People window and native view are unavailable.');
    const session = lease.session;
    if (suffix === 'search') {
      if (!await lease.view.prepare('search', lease.guard) || !lease.guard() || !await lease.view.focus('search', lease.guard) || !lease.guard()) return stale();
      return commit(lease, (candidate, win) => { win.query = payload.query; const visible = visibleContacts(candidate, win.windowId).map(row => row.id); win.selectedIds = win.selectedIds.filter(id => visible.includes(id)); }, target);
    }
    if (suffix === 'select') {
      if (payload.contactIds.some(id => !visibleContacts(state, target.windowId).some(row => row.id === id))) return reject('stale_target', 'Select only cards in the current list.');
      return commit(lease, (_, win) => { win.selectedIds = payload.contactIds; }, target);
    }
    if (suffix === 'group.select') return commit(lease, (candidate, win) => { win.groupId = payload.groupId; win.selectedIds = []; win.query = ''; }, target);
    if (suffix === 'view.set') return commit(lease, (_, win) => { win.sidebarVisible = payload.sidebarVisible; }, target);
    if (suffix === 'preferences.set') return commit(lease, candidate => { candidate.preferences = payload.preferences; }, target);
    if (suffix === 'sheet.open') return commit(lease, (_, win) => { win.sheet = payload.sheet; if (payload.pane) win.pane = payload.pane; }, target);
    if (suffix === 'sheet.close') return commit(lease, (_, win) => { win.sheet = 'none'; }, target);
    if (suffix === 'menu.open' || suffix === 'menu.close') {
      const method = suffix === 'menu.open' ? 'openMenu' : 'closeMenu';
      if (typeof lease.view[method] !== 'function') return reject('unavailable', 'The original native menu facade is unavailable.');
      const changed = await lease.view[method](suffix === 'menu.open' ? payload.menuId : payload.restoreFocus, lease.guard);
      return changed === true && lease.guard() ? applied(target) : stale();
    }
    if (suffix === 'editor.open') {
      const contact = payload.contactId ? contactById(state, payload.contactId) : null;
      if (payload.contactId && !writable(contact)) return reject('read_only', 'The original source card is missing, disabled or read-only.');
      return commit(lease, (candidate, win) => { win.editingId = payload.contactId; win.editor = contact ? contactSpec(contact) : createContactEditor(candidate); win.sheet = 'none'; }, target);
    }
    if (suffix === 'card.open') {
      const card = visibleContacts(state, target.windowId).find(row => row.id === payload.contactId);
      if (!card || session.editor || typeof ctx.createWindow !== 'function') return reject('unavailable', 'Select a visible original card before opening its separate window.');
      const result = await ctx.createWindow('contacts', { contactsContactId: card.id, title: contactName(card, state.preferences), isCurrent: lease.sourceGuard });
      if (!lease.sourceGuard()) return stale();
      const windowId = typeof result === 'string' ? result : result?.windowId;
      const destination = windowId && ctx.getWindow(windowId), destinationSession = windowId && contactsWindow(state, windowId);
      if (!destination || windowId === target.windowId || !destinationSession || destinationSession.selectedIds[0] !== card.id) return reject('unavailable', 'The actual separate Contacts window was not materialized.');
      if (typeof ctx.tick === 'function') await ctx.tick();
      if (!lease.sourceGuard() || ctx.getWindow(windowId) !== destination || contactsWindow(state, windowId) !== destinationSession) return stale();
      return applied({ windowId }, { contactId: card.id, presentationAvailable: ctx.getView(windowId)?.available() === true });
    }
    if (suffix === 'editor.set') {
      if (!session.editor) return reject('unavailable', 'Open the native editor before setting fields.');
      return commit(lease, (_, win) => { win.editor = payload.spec; }, target);
    }
    if (suffix === 'editor.cancel') return commit(lease, (_, win) => { win.editor = null; win.editingId = null; }, target);
    if (suffix === 'editor.save') {
      if (!session.editor) return reject('unavailable', 'No editor draft is open.');
      if (session.editingId && !writable(contactById(state, session.editingId))) return reject('read_only', 'The original source cannot be edited.');
      const destination = state.accounts.find(row => row.id === session.editor.accountId); if (!destination?.enabled || destination.readOnly) return reject('read_only', 'The destination source is disabled or read-only.');
      const spec = completedContactSpec(session.editor);
      if (!contactsSpecValid(state, spec, true)) return reject('invalid_arguments', 'Complete nonblank contact values, custom labels, email addresses, HTTP/HTTPS/mailto/tel URLs and valid full birthdays before saving.');
      return commit(lease, (candidate, win) => { let contactId = win.editingId;
        if (contactId) { const contact = contactById(candidate, contactId); if (contact.revision >= Number.MAX_SAFE_INTEGER) return reject('limit_exceeded', 'Card revision limit reached.'); const oldAccountId = contact.accountId; Object.assign(contact, spec); contact.revision++; contact.updatedAt = Math.max(contact.updatedAt, now());
          if (oldAccountId !== contact.accountId) for (const group of candidate.groups) if (group.accountId && group.accountId !== contact.accountId) group.memberIds = group.memberIds.filter(id => id !== contactId);
        } else { const result = createContact(candidate, spec, { time: now() }); if (result.status !== 'applied') return result; contactId = result.contactId; }
        win.editor = null; win.editingId = null;
        const visible = visibleContacts(candidate, win.windowId);
        if (!visible.some(card => card.id === contactId || card.links.includes(contactId))) { win.groupId = null; win.query = ''; }
        const shown = visibleContacts(candidate, win.windowId).find(card => card.id === contactId || card.links.includes(contactId));
        win.selectedIds = shown ? [shown.id] : []; return { contactId }; }, target);
    }
    if (suffix === 'delete') {
      if (!selectionValid(payload.contactIds) || payload.contactIds.some(id => !writable(contactById(state, id)))) return reject('read_only', 'Every selected source card must exist and be writable.');
      return commit(lease, (candidate, win) => { const removed = new Set(payload.contactIds); candidate.contacts = candidate.contacts.filter(row => !removed.has(row.id)); for (const row of candidate.contacts) row.links = row.links.filter(id => !removed.has(id));
        for (const group of candidate.groups) group.memberIds = group.memberIds.filter(id => !removed.has(id)); for (const window of candidate.windows) { window.selectedIds = window.selectedIds.filter(id => !removed.has(id)); if (removed.has(window.editingId)) { window.editingId = null; window.editor = null; } } if (removed.has(candidate.myCardId)) candidate.myCardId = null; win.sheet = 'none'; }, target);
    }
    if (suffix === 'group.save') return commit(lease, (candidate, win) => { const account = payload.spec.accountId && candidate.accounts.find(row => row.id === payload.spec.accountId); if (account && (!account.enabled || account.readOnly)) return reject('read_only', 'The source does not permit group changes.');
      const existing = candidate.groups.find(row => row.id === payload.groupId); if (payload.groupId && !existing) return stale();
      const oldAccount = existing?.accountId && candidate.accounts.find(row => row.id === existing.accountId); if (oldAccount && (!oldAccount.enabled || oldAccount.readOnly)) return reject('read_only', 'The original group source is read-only.');
      const groupId = existing?.id ?? contactsNewId(candidate, 'contacts-group'); if (!groupId) return reject('limit_exceeded', 'Identity limit reached.'); if (existing) Object.assign(existing, payload.spec); else candidate.groups.push({ id: groupId, ...payload.spec }); win.groupId = groupId; win.selectedIds = []; win.sheet = 'none'; return { groupId }; }, target);
    if (suffix === 'group.delete') return commit(lease, candidate => { const group = candidate.groups.find(row => row.id === payload.groupId); if (!group) return stale(); const source = candidate.accounts.find(row => row.id === group.accountId); if (source && (!source.enabled || source.readOnly)) return reject('read_only', 'Group source is read-only.'); candidate.groups = candidate.groups.filter(row => row !== group); for (const win of candidate.windows) if (win.groupId === group.id) { win.groupId = null; win.selectedIds = []; } }, target);
    if (suffix === 'group.members') return commit(lease, candidate => { const group = candidate.groups.find(row => row.id === payload.groupId); if (!group || group.kind !== 'group' || !selectionValid(payload.contactIds)) return reject('invalid_arguments', 'Use an existing ordinary group and existing cards.');
      const source = candidate.accounts.find(row => row.id === group.accountId); if (source && (!source.enabled || source.readOnly)) return reject('read_only', 'Group source is read-only.');
      group.memberIds = payload.operation === 'add' ? [...new Set([...group.memberIds, ...payload.contactIds])] : group.memberIds.filter(id => !payload.contactIds.includes(id)); }, target);
    if (suffix === 'myCard.set') return commit(lease, candidate => { candidate.myCardId = payload.contactId; }, target);
    if (suffix === 'myCard.show') return commit(lease, (candidate, win) => {
      if (!candidate.myCardId) return reject('unavailable', 'No My Card has been chosen.');
      win.groupId = null; win.query = '';
      const card = visibleContacts(candidate, target.windowId).find(row => row.id === candidate.myCardId || row.links.includes(candidate.myCardId));
      if (!card) return reject('unavailable', 'The My Card source account is disabled.');
      win.selectedIds = [card.id];
    }, target);
    if (suffix === 'link') {
      if (!selectionValid(payload.contactIds) || payload.contactIds.some(id => !writable(contactById(state, id)))) return reject('read_only', 'Every linked source must exist and be writable.');
      return commit(lease, (candidate, win) => { const chosen = new Set(payload.contactIds), cluster = new Set(payload.contactIds); for (const id of payload.contactIds) for (const link of contactById(candidate, id).links) cluster.add(link);
        for (const id of cluster) { const contact = contactById(candidate, id); contact.links = payload.operation === 'link' ? [...cluster].filter(member => member !== id) : chosen.has(id) ? [] : contact.links.filter(member => !chosen.has(member)); contact.revision++; contact.updatedAt = Math.max(contact.updatedAt, now()); } win.sheet = 'none'; }, target);
    }
    if (suffix === 'merge') {
      if (!payload.contactIds.includes(payload.primaryId) || !selectionValid(payload.contactIds) || payload.contactIds.some(id => !writable(contactById(state, id)))) return reject('invalid_arguments', 'Choose writable existing cards and a primary card from that set.');
      return commit(lease, (candidate, win) => {
        const primary = contactById(candidate, payload.primaryId), removed = new Set(payload.contactIds.filter(id => id !== primary.id)), provenance = [];
        for (const id of removed) { const source = contactById(candidate, id); provenance.push(`Merged source: ${candidate.accounts.find(row => row.id === source.accountId)?.name ?? source.accountId} / ${source.id}`);
          for (const key of ['emails', 'phones', 'addresses', 'urls']) for (const item of source[key]) if (!primary[key].some(row => same(row, item))) primary[key].push(item);
          for (const key of Object.keys(primary.name)) if (!primary.name[key]) primary.name[key] = source.name[key]; else if (source.name[key] && primary.name[key] !== source.name[key]) provenance.push(`${key}: ${source.name[key]}`);
          for (const key of ['organization', 'department', 'jobTitle', 'birthday']) if (!primary[key]) primary[key] = source[key]; else if (source[key] && primary[key] !== source[key]) provenance.push(`${key}: ${source[key]}`);
          if (source.notes && source.notes !== primary.notes) provenance.push(source.notes); if (primary.photo.kind === 'none') primary.photo = source.photo;
        }
        primary.notes = [primary.notes, ...provenance].filter(Boolean).join('\n\n'); primary.revision++; primary.updatedAt = Math.max(primary.updatedAt, now());
        const cluster = new Set([primary.id, ...primary.links]); for (const id of removed) for (const link of contactById(candidate, id).links) cluster.add(link); for (const id of removed) cluster.delete(id);
        candidate.contacts = candidate.contacts.filter(row => !removed.has(row.id)); for (const row of candidate.contacts) { row.links = row.links.filter(id => !removed.has(id)); if (cluster.has(row.id)) row.links = [...cluster].filter(id => id !== row.id); }
        for (const group of candidate.groups) { if (group.memberIds.some(id => removed.has(id)) && (!group.accountId || group.accountId === primary.accountId)) group.memberIds.push(primary.id); group.memberIds = [...new Set(group.memberIds.filter(id => !removed.has(id)))]; }
        for (const window of candidate.windows) { window.selectedIds = [...new Set(window.selectedIds.map(id => removed.has(id) ? primary.id : id))]; if (removed.has(window.editingId) || window.editingId === primary.id) { window.editingId = null; window.editor = null; } }
        if (removed.has(candidate.myCardId)) candidate.myCardId = primary.id; win.selectedIds = [primary.id]; win.sheet = 'none'; return { contactId: primary.id }; }, target);
    }
    if (suffix === 'account.save') return commit(lease, (candidate, win) => { const account = candidate.accounts.find(row => row.id === payload.accountId); if (payload.accountId && !account) return stale(); const accountId = account?.id ?? contactsNewId(candidate, 'contacts-account'); if (!accountId) return reject('limit_exceeded', 'Account identity limit reached.'); if (account) Object.assign(account, payload.spec); else candidate.accounts.push({ id: accountId, ...payload.spec });
      if (!candidate.accounts.some(row => row.id === candidate.preferences.defaultAccountId && row.enabled && !row.readOnly)) { const replacement = candidate.accounts.find(row => row.enabled && !row.readOnly); if (!replacement) return reject('invalid_arguments', 'Keep one enabled writable default account.'); candidate.preferences.defaultAccountId = replacement.id; } win.sheet = 'none'; return { accountId }; }, target);
    if (suffix === 'account.delete') return commit(lease, candidate => { if (!candidate.accounts.some(row => row.id === payload.accountId)) return stale(); if (candidate.contacts.some(row => row.accountId === payload.accountId) || candidate.groups.some(row => row.accountId === payload.accountId) || candidate.windows.some(row => row.editor?.accountId === payload.accountId)) return reject('conflict', 'Move or remove source cards, groups and open drafts before deleting their account.'); candidate.accounts = candidate.accounts.filter(row => row.id !== payload.accountId); if (candidate.preferences.defaultAccountId === payload.accountId) { const replacement = candidate.accounts.find(row => row.enabled && !row.readOnly); if (!replacement) return reject('invalid_arguments', 'Keep one writable default account.'); candidate.preferences.defaultAccountId = replacement.id; } }, target);
    if (suffix === 'template.set') return commit(lease, candidate => { candidate.template = payload.template; }, target);
    const importText = text => { const parsed = parseContactsVCard(state, text); if (parsed.status !== 'applied') return parsed;
      return commit(lease, (candidate, win) => { const contactIds = []; for (const spec of parsed.specs) { const result = createContact(candidate, spec, { time: now() }); if (result.status !== 'applied') return result; contactIds.push(result.contactId); } win.groupId = null; win.query = ''; win.selectedIds = contactIds; win.sheet = 'none'; win.status = parsed.warnings.join(' ').slice(0, 4096) || `Imported ${contactIds.length} contact${contactIds.length === 1 ? '' : 's'}.`; return { contactIds, warnings: parsed.warnings }; }, target); };
    if (suffix === 'import') return importText(payload.text);
    if (suffix === 'import.file' || suffix === 'photo.file') {
      if (suffix === 'photo.file' && !session.editor) return reject('unavailable', 'Open a card editor before choosing a photo.');
      if (typeof ctx.readFile !== 'function') return reject('unavailable', 'The real virtual-file read bridge is unavailable.');
      const result = await ctx.readFile(payload.fileId, { guard: lease.guard, windowId: target.windowId });
      if (!lease.guard()) return stale();
      if (result?.status !== 'applied') return bridgeResult(result, target);
      if (typeof result.text !== 'string') return reject('invalid_arguments', 'The virtual file has no supported textual vCard or embedded photo data.');
      return suffix === 'import.file' ? importText(result.text) : commit(lease, (_, win) => { win.editor.photo = { kind: 'image', value: result.text.trim() }; }, target);
    }
    if (suffix === 'export') {
      if (!selectionValid(payload.contactIds) || !/^[^/\\\u0000]+\.vcf$/iu.test(payload.name)) return reject('invalid_arguments', 'Choose existing cards and a simple .vcf virtual filename.');
      const text = exportContactsVCard(state, payload.contactIds); if (text === null) return reject('limit_exceeded', 'The vCard export exceeds its supported bound.');
      const result = await bridge(lease, 'createFile', { name: payload.name, mime: 'text/vcard', text }, target);
      if (result.status !== 'applied') return result;
      if (typeof result.fileId !== 'string') return reject('unavailable', 'The real virtual-file bridge did not return a file identity.');
      if (typeof ctx.revealFile === 'function' && lease.guard()) { const revealed = await ctx.revealFile(result.fileId, { guard: lease.guard, windowId: target.windowId }); if (!lease.guard()) return stale(); if (revealed?.status === 'rejected') return { ...result, reveal: revealed }; }
      return result;
    }
    if (suffix === 'action') {
      const original = contactById(state, payload.contactId), card = linkedContact(state, payload.contactId); if (!card || !state.accounts.some(row => row.id === original.accountId && row.enabled)) return stale(); const name = contactName(card, state.preferences);
      if (payload.kind === 'mail') { const email = card.emails[payload.index]?.value; if (!email) return reject('unavailable', 'This card has no selected email address.'); return bridge(lease, 'composeMail', { to: [{ name, email }], subject: '', body: '', attachments: [] }, target); }
      if (['message', 'call', 'video'].includes(payload.kind)) {
        const number = card.phones[payload.index]?.value;
        const address = number ?? (payload.kind !== 'call' && card.phones.length === 0 ? card.emails[payload.index]?.value : null);
        if (!address) return reject('unavailable', payload.kind === 'call' ? 'This card has no selected phone number.' : 'This card has no selected message or video address.');
        return payload.kind === 'message' ? bridge(lease, 'composeMessage', { recipient: { name, address }, text: '' }, target) : bridge(lease, 'startCall', { contactId: original.id, name, address, kind: payload.kind === 'video' ? 'video' : 'audio' }, target);
      }
      const text = exportContactsVCard(state, [original.id]); if (text === null) return reject('limit_exceeded', 'The shared card exceeds the vCard limit.'); return bridge(lease, 'share', { kind: 'contact', contactId: original.id, title: name, text, mime: 'text/vcard' }, target);
    }
    if (suffix === 'print') { if (!selectionValid(payload.contactIds)) return stale(); return bridge(lease, 'printDocument', { title: `Contacts · ${payload.style}`, text: contactPrintText(state, payload.contactIds, payload.style), mime: 'text/plain' }, target); }
    if (suffix === 'clipboard') {
      const source = lease.view.selection?.(), clipboard = ctx.getClipboard?.();
      if (!source || !clipboard) return reject('unavailable', 'No actual focused native text control or shared scene clipboard is available.');
      const clipboardSignature = JSON.stringify(clipboard);
      const clipboardOwned = () => ctx.getClipboard?.() === clipboard && JSON.stringify(clipboard) === clipboardSignature;
      const { value, start, end, controlId } = source, operation = payload.operation;
      if (typeof value !== 'string' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > value.length) return stale();
      if (operation === 'selectAll') {
        const selected = await lease.view.setSelection(controlId, { start: 0, end: value.length }, lease.guard);
        return selected === true && lease.guard() ? applied(target) : stale();
      }
      if ((operation === 'copy' || operation === 'cut') && start === end) return reject('disabled', 'Select actual field text first.');
      if ((operation === 'cut' || operation === 'paste') && source.readOnly) return reject('read_only', 'The actual focused native field is read-only.');
      if (operation === 'paste' && (clipboard.kind !== 'text' || typeof clipboard.text !== 'string')) return reject('disabled', 'The shared scene clipboard contains no text.');
      const selected = value.slice(start, end), insertion = operation === 'paste' ? clipboard.text : '';
      const next = operation === 'copy' ? value : value.slice(0, start) + insertion + value.slice(end);
      if (next.length > (source.maxLength ?? 16384) || selected.length > CONTACTS_LIMITS.vcard || ctx.canCommit && ctx.canCommit(next.length - value.length) !== true) return reject('limit_exceeded', 'The field or complete scene text bound would be exceeded.');
      if (!lease.guard() || !clipboardOwned()) return stale();
      let finalGuard = lease.guard;
      if (operation !== 'copy') {
        const parts = controlId?.split(':') ?? [];
        let canonical = null;
        if (controlId === 'search' && session.query === value) canonical = (candidate, win) => { win.query = next; const visible = visibleContacts(candidate, target.windowId).map(row => row.id); win.selectedIds = win.selectedIds.filter(id => visible.includes(id)); };
        else if (parts[0] === 'editor' && session.editor) {
          if (parts[1] === 'name' && Object.hasOwn(session.editor.name, parts[2]) && session.editor.name[parts[2]] === value) canonical = (_, win) => { win.editor.name[parts[2]] = next; };
          else if (['organization', 'department', 'jobTitle', 'notes', 'birthday'].includes(parts[1]) && session.editor[parts[1]] === value) canonical = (_, win) => { win.editor[parts[1]] = next; };
          else if (['phones', 'emails', 'urls', 'addresses'].includes(parts[1]) && /^\d+$/u.test(parts[2]) && Object.hasOwn(session.editor[parts[1]][Number(parts[2])] ?? {}, parts[3]) && session.editor[parts[1]][Number(parts[2])][parts[3]] === value) canonical = (_, win) => { win.editor[parts[1]][Number(parts[2])][parts[3]] = next; };
        } else if (parts[0] === 'template' && parts[1] === 'label' && /^\d+$/u.test(parts[2]) && state.template.labels[Number(parts[2])]?.label === value) canonical = candidate => { candidate.template.labels[Number(parts[2])].label = next; };
        const range = { start: start + insertion.length, end: start + insertion.length };
        if (canonical) {
          const result = await commit(lease, canonical, target);
          if (result.status !== 'applied') return result;
          if (ctx.getWindow(target.windowId) !== lease.window || ctx.getView(target.windowId) !== lease.view || !clipboardOwned()) return stale();
          const continued = owner(target.windowId);
          if (!continued || continued.window !== lease.window || continued.view !== lease.view) return stale();
          finalGuard = continued.guard;
          if (await lease.view.setSelection(controlId, range, finalGuard) !== true || !finalGuard()) return stale();
        } else {
          const changed = await lease.view.replaceSelection(next, range, lease.guard);
          if (changed !== true || !lease.guard()) return stale();
        }
      }
      if (!finalGuard() || !clipboardOwned()) return stale();
      if (operation === 'copy' || operation === 'cut') Object.assign(clipboard, { kind: 'text', text: selected, fileIds: [] });
      return applied(target);
    }
    return reject('unavailable', 'No Contacts operation was dispatched.');
  };
  handlers['contacts.focus'] = async (target, payload = {}) => { if (!contactsSchemaValid(target, contactsCatalog['contacts.focus'].requestSchema.properties.target) || !contactsSchemaValid(payload, empty)) return invalid(); const lease = owner(target.windowId); if (!lease) return stale(); ctx.focusWindow(target.windowId); if (!await lease.view.prepare(target.controlId, lease.guard) || !lease.guard() || !await lease.view.focus(target.controlId, lease.guard) || !lease.guard()) return stale(); return applied(target); };
  handlers['contacts.scroll'] = async (target, payload) => { const definition = contactsCatalog['contacts.scroll'].requestSchema.properties; if (!contactsSchemaValid(target, definition.target) || !contactsSchemaValid(payload, definition.payload)) return invalid(); const lease = owner(target.windowId); if (!lease) return stale(); const offsets = await lease.view.scroll(target.areaId, payload, lease.guard); return offsets && lease.guard() ? applied(target, { offsets }) : stale(); };
  const targets = (name = '') => state.windows.filter(session => { const window = ctx.getWindow(session.windowId), view = ctx.getView(session.windowId); return alive() && window && view && ctx.available(window) === true && view.available() === true; }).flatMap(session => name === 'contacts.focus' ? ctx.getView(session.windowId).describe().controlIds.map(controlId => ({ windowId: session.windowId, controlId })) : name === 'contacts.scroll' ? Object.keys(ctx.getView(session.windowId).describe().scrolls).map(areaId => ({ windowId: session.windowId, areaId })) : [{ windowId: session.windowId }]);
  function windowOpened(window, options = {}) {
    const windowId = typeof window === 'string' ? window : window.id;
    if (!alive() || !contactsSchemaValid(windowId, id)) return false;
    if (contactsWindow(state, windowId)) return true;
    if (state.windows.length >= CONTACTS_LIMITS.windows) return false;
    const candidate = copyCanonicalData(state);
    const session = createContactsWindow(candidate, windowId);
    if (options.contactsContactId !== undefined) {
      const card = candidate.contacts.find(row => row.id === options.contactsContactId && candidate.accounts.some(account => account.id === row.accountId && account.enabled));
      if (!card) return false;
      session.selectedIds = [card.id]; session.sidebarVisible = false;
    }
    candidate.windows.push(session);
    if (!validateContactsState(candidate, ctx.profile) || ctx.canCommit?.(contactsTextUnits(candidate) - contactsTextUnits(state)) !== true) return false;
    applyCanonicalData(state, candidate); sequence++; return true;
  }
  function windowClosed(window) {
    const windowId = typeof window === 'string' ? window : window.id;
    const index = state.windows.findIndex(row => row.windowId === windowId);
    if (!alive() || index < 0) return false;
    state.windows.splice(index, 1); sequence++; return true;
  }
  function appQuit() { if (!alive()) return false; state.windows.splice(0); sequence++; return true; }
  return { handlers, targets, windowOpened, windowClosed, appQuit };
}

export function contactsMenuProvider({ state, profile, windowId, menuId }) {
  const win = contactsWindow(state, windowId), capabilities = contactsCapabilities(profile), selected = win?.selectedIds ?? [], first = selected[0] && linkedContact(state, selected[0]);
  const request = (suffix, payload = {}, target = { windowId }) => ({ command: `contacts.${suffix}`, target, payload });
  const row = (id, label, suffix, payload = {}, enabled = !!win, extra = {}) => ({ id, label, enabled: !!enabled, ...(enabled ? { request: request(suffix, payload) } : {}), ...extra });
  const separator = id => ({ id, label: '', enabled: false, separator: true });
  const custom = capabilities.windows ? ' · local equivalent' : '';
  if (menuId === 'contacts') return [row('about', `About ${capabilities.app}`, 'sheet.open', { sheet: 'help' }), row('preferences', `${capabilities.settingsLabel}…`, 'sheet.open', { sheet: 'preferences' }, !!win, { shortcut: capabilities.windows ? '' : '⌘,' }), row('accounts', 'Accounts…', 'sheet.open', { sheet: 'accounts' }), row('template', `Card Template…${custom}`, 'sheet.open', { sheet: 'template' })];
  if (menuId === 'file') return [row('new-card', capabilities.windows ? 'New contact' : 'New Card', 'editor.open', { contactId: null }, !!win, { shortcut: '⌘N' }), row('new-group', `New ${capabilities.listsLabel === 'Lists' ? 'List' : 'Group'}${custom}`, 'sheet.open', { sheet: 'group' }), row('new-smart', `New Smart ${capabilities.listsLabel === 'Lists' ? 'List' : 'Group'}…${custom}`, 'sheet.open', { sheet: 'smart' }), separator('import-separator'), row('import', 'Import…', 'sheet.open', { sheet: 'import' }), row('export', 'Export vCard…', 'export', { contactIds: selected, name: 'Contacts.vcf' }, !!win && selected.length > 0), separator('print-separator'), row('print', `Print…${custom}`, 'print', { contactIds: selected.length ? selected : win ? visibleContacts(state, windowId).map(row => row.id) : [], style: 'card' }, !!win && (selected.length > 0 || visibleContacts(state, windowId).length > 0), { shortcut: '⌘P' })];
  if (menuId === 'edit') return [row('edit-card', 'Edit Card', 'editor.open', { contactId: first?.id ?? null }, !!first), row('delete', 'Delete Cards', 'sheet.open', { sheet: 'delete' }, selected.length > 0), separator('clipboard-separator'), ...['cut', 'copy', 'paste', 'selectAll'].map(operation => row(operation, operation === 'selectAll' ? 'Select All' : operation[0].toUpperCase() + operation.slice(1), 'clipboard', { operation }))];
  if (menuId === 'view') return [row('sidebar', win?.sidebarVisible ? `Hide ${capabilities.listsLabel}` : `Show ${capabilities.listsLabel}`, 'view.set', { sidebarVisible: !win?.sidebarVisible }, !!win), row('search', 'Search Contacts', 'focus', {}, !!win, { request: request('focus', {}, { windowId, controlId: 'search' }), shortcut: '⌘F' }), ...['given', 'family'].map(sort => row(`sort-${sort}`, `Sort by ${sort === 'given' ? 'First' : 'Last'} Name`, 'preferences.set', { preferences: { ...state.preferences, sort } }, !!win, { checked: state.preferences.sort === sort }))];
  if (menuId === 'card') return [...(!capabilities.windows ? [row('open-card', 'Open in Separate Window', 'card.open', { contactId: first?.id ?? '' }, !!first), separator('open-separator')] : []), row('my-card', `Make This My Card${custom}`, 'myCard.set', { contactId: first?.id ?? '' }, !!first, { checked: first?.id === state.myCardId }), row('go-my-card', `Go to My Card${custom}`, 'myCard.show', {}, !!state.myCardId && !!win), row('duplicates', `Look for Duplicates…${custom}`, 'sheet.open', { sheet: 'duplicates' }), row('merge', `Merge Selected Cards${custom}`, 'merge', { contactIds: selected, primaryId: first?.id ?? '' }, selected.length > 1), row('link', 'Link Selected Cards…', 'sheet.open', { sheet: 'link' }, selected.length > 1), row('unlink', 'Unlink Selected Cards', 'link', { contactIds: selected, operation: 'unlink' }, selected.length > 1), separator('action-separator'), ...[['mail', 'Send Email', !!first?.emails.length], ['message', 'Send Message', !!first?.phones.length || !!first?.emails.length], ['call', 'Call', !!first?.phones.length], ['video', capabilities.windows ? 'Video call · local equivalent' : 'FaceTime Video', !!first?.phones.length || !!first?.emails.length], ['share', 'Share Card', !!first]].map(([kind, label, enabled]) => row(kind, label, 'action', { contactId: first?.id ?? '', kind, index: 0 }, enabled))];
  if (menuId === 'window') return [row('select-all-cards', 'Select All Contacts', 'select', { contactIds: win ? visibleContacts(state, windowId).map(row => row.id) : [] })];
  if (menuId === 'help') return [row('help', `${capabilities.app} Help`, 'sheet.open', { sheet: 'help' })];
  return [];
}
