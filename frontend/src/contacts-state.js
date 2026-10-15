import { object, choice, flag } from './command-schema.js';
import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';

export const CONTACTS_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
export const CONTACTS_LIMITS = Object.freeze({ contacts: 512, groups: 128, accounts: 16, windows: 32, values: 32, rules: 16, textUnits: 4 * 1024 * 1024, vcard: 1024 * 1024 });
const str = (maxLength = 256, minLength = 0) => ({ type: 'string', minLength, maxLength });
export const contactsIdSchema = { ...str(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const id = contactsIdSchema;
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const array = (items, maxItems, uniqueItems = false) => ({ type: 'array', items, maxItems, ...(uniqueItems ? { uniqueItems: true } : {}) });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const time = integer(0, 8639999999999999);
export const CONTACTS_FIELDS = ['prefix', 'given', 'middle', 'family', 'suffix', 'nickname', 'phoneticGiven', 'phoneticFamily', 'organization', 'department', 'jobTitle', 'emails', 'phones', 'addresses', 'urls', 'birthday', 'notes'];
export const contactsNameSchema = object(Object.fromEntries(['prefix', 'given', 'middle', 'family', 'suffix', 'nickname', 'phoneticGiven', 'phoneticFamily'].map(key => [key, str()])));
const labelled = max => array(object({ label: str(64, 1), value: str(max, 1) }), CONTACTS_LIMITS.values);
export const contactsSpecSchema = object({ accountId: id, name: contactsNameSchema, organization: str(), department: str(), jobTitle: str(), company: flag,
  emails: labelled(254), phones: labelled(128), addresses: array(object({ label: str(64, 1), street: str(1024), city: str(), region: str(), postalCode: str(64), country: str() }), CONTACTS_LIMITS.values),
  urls: labelled(2048), birthday: str(10), notes: str(16384), photo: object({ kind: choice('none', 'initials', 'color', 'image'), value: str(131072) }) });
// Editor drafts must permit intermediate typing and newly added blank rows.
// Authored source cards still use the strict specification and save validation.
export const contactsEditorSchema = object({ ...contactsSpecSchema.properties,
  emails: array(object({ label: str(64), value: str(254) }), CONTACTS_LIMITS.values),
  phones: array(object({ label: str(64), value: str(128) }), CONTACTS_LIMITS.values),
  urls: array(object({ label: str(64), value: str(2048) }), CONTACTS_LIMITS.values),
  addresses: array(object({ label: str(64), street: str(1024), city: str(), region: str(), postalCode: str(64), country: str() }), CONTACTS_LIMITS.values),
});
export const contactsGroupSpecSchema = object({ name: str(256, 1), kind: choice('group', 'smart'), accountId: nullable(id), memberIds: array(id, CONTACTS_LIMITS.contacts, true), match: choice('all', 'any'),
  rules: array(object({ field: choice('name', 'organization', 'email', 'phone', 'notes', 'birthday'), operator: choice('contains', 'equals', 'present', 'absent'), value: str(1024) }), CONTACTS_LIMITS.rules) });
export const contactsAccountSpecSchema = object({ name: str(256, 1), kind: choice('local', 'icloud', 'exchange', 'google', 'carddav'), enabled: flag, readOnly: flag });
export const contactsPreferencesSchema = object({ sort: choice('given', 'family'), display: choice('given', 'family'), defaultAccountId: id, showPhotos: flag, exportNotes: flag, exportPhotos: flag });
export const contactsTemplateSchema = object({ fields: array(choice(...CONTACTS_FIELDS), CONTACTS_FIELDS.length, true), labels: array(object({ field: choice('emails', 'phones', 'addresses', 'urls'), label: str(64, 1) }), 64) });
export const CONTACTS_SHEETS = ['none', 'group', 'smart', 'duplicates', 'link', 'preferences', 'accounts', 'template', 'import', 'delete', 'help'];
export const contactsStateSchema = object({ version: { const: 1 }, nextId: integer(1, Number.MAX_SAFE_INTEGER),
  contacts: array(object({ id, ...contactsSpecSchema.properties, revision: integer(1, Number.MAX_SAFE_INTEGER), createdAt: time, updatedAt: time, links: array(id, CONTACTS_LIMITS.contacts, true) }), CONTACTS_LIMITS.contacts),
  groups: array(object({ id, ...contactsGroupSpecSchema.properties }), CONTACTS_LIMITS.groups), accounts: array(object({ id, ...contactsAccountSpecSchema.properties }), CONTACTS_LIMITS.accounts),
  windows: array(object({ windowId: id, groupId: nullable(id), query: str(4096), selectedIds: array(id, CONTACTS_LIMITS.contacts, true), sidebarVisible: flag, editingId: nullable(id), editor: nullable(contactsEditorSchema),
    sheet: choice(...CONTACTS_SHEETS), status: str(4096), pane: choice('General', 'Accounts', 'Template', 'vCard') }), CONTACTS_LIMITS.windows), preferences: contactsPreferencesSchema, template: contactsTemplateSchema, myCardId: nullable(id) });

// Validate descriptors before traversal: imported/session objects never execute getters.
export function contactsSchemaValid(value, schema, ancestors = new Set()) {
  if (schema.anyOf) return schema.anyOf.some(option => contactsSchemaValid(value, option, ancestors));
  if (Object.hasOwn(schema, 'const') && value !== schema.const || schema.enum && !schema.enum.includes(value) || schema.not?.enum?.includes(value)) return false;
  if (!schema.type) return true;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern, 'u').test(value));
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  if (value === null || typeof value !== 'object' || ancestors.has(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors), next = new Set(ancestors); next.add(value);
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > schema.maxItems || keys.some(key => typeof key !== 'string' || key !== 'length' && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length))) return false;
    for (let index = 0; index < value.length; index++) if (!descriptors[index]?.enumerable || !Object.hasOwn(descriptors[index], 'value') || !contactsSchemaValid(descriptors[index].value, schema.items, next)) return false;
    return !schema.uniqueItems || new Set(value.map(item => JSON.stringify(item))).size === value.length;
  }
  if (Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || schema.required.some(key => !Object.hasOwn(descriptors, key))) return false;
  return keys.every(key => typeof key === 'string' && Object.hasOwn(schema.properties, key) && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value') && contactsSchemaValid(descriptors[key].value, schema.properties[key], next));
}
export const contactsFold = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').trim();
export const contactById = (state, contactId) => state.contacts.find(row => row.id === contactId) ?? null;
export const contactsWindow = (state, windowId) => state.windows.find(row => row.windowId === windowId) ?? null;
export function contactName(contact, preferences = { display: 'given' }) {
  if (!contact) return '';
  if (contact.company && contact.organization) return contact.organization;
  const n = contact.name, parts = preferences.display === 'family' ? [n.prefix, n.family, n.given, n.middle, n.suffix] : [n.prefix, n.given, n.middle, n.family, n.suffix];
  return parts.filter(Boolean).join(' ') || n.nickname || contact.organization || contact.emails[0]?.value || contact.phones[0]?.value || 'No Name';
}
const birthdayValid = value => !value || /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const photoValid = photo => photo.kind === 'color' ? /^#[\da-f]{6}$/iu.test(photo.value) : photo.kind === 'none' ? photo.value === '' : photo.kind === 'image' ? /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(photo.value) && photo.value.split(',')[1].length % 4 === 0 : photo.value.length <= 4;
export const contactsEditorValid = (state, spec) => contactsSchemaValid(spec, contactsEditorSchema) && state.accounts.some(row => row.id === spec.accountId) && photoValid(spec.photo);
export function contactsSpecValid(state, spec, writable = false) {
  if (!contactsSchemaValid(spec, contactsSpecSchema)) return false;
  const account = state.accounts.find(row => row.id === spec.accountId);
  return !!account && (!writable || account.enabled && !account.readOnly) && birthdayValid(spec.birthday)
    && spec.emails.every(row => /^[^\s<>@,;]+@[^\s<>@,;]+$/u.test(row.value))
    && spec.urls.every(row => /^(https?:\/\/|mailto:|tel:)/iu.test(row.value))
    && photoValid(spec.photo)
    && spec.addresses.every(row => [row.street, row.city, row.region, row.postalCode, row.country].some(Boolean));
}
const textUnits = canonicalStringUnits;
export const contactsTextUnits = textUnits;
export function validateContactsState(state, profile) {
  if (profile && !CONTACTS_PROFILES.includes(typeof profile === 'string' ? profile : profile.id) || !contactsSchemaValid(state, contactsStateSchema)) return false;
  if (!state.accounts.length || textUnits(state) > CONTACTS_LIMITS.textUnits) return false;
  const allIds = [...state.contacts, ...state.groups, ...state.accounts].map(row => row.id);
  if (new Set(allIds).size !== allIds.length || new Set(state.windows.map(row => row.windowId)).size !== state.windows.length) return false;
  const accounts = new Map(state.accounts.map(row => [row.id, row])), contacts = new Map(state.contacts.map(row => [row.id, row])), groups = new Map(state.groups.map(row => [row.id, row]));
  const defaultAccount = accounts.get(state.preferences.defaultAccountId);
  if (!defaultAccount || !defaultAccount.enabled || defaultAccount.readOnly || state.myCardId && !contacts.has(state.myCardId)) return false;
  for (const contact of state.contacts) {
    const spec = contactSpec(contact);
    if (!contactsSpecValid(state, spec) || contact.updatedAt < contact.createdAt || contact.links.includes(contact.id)) return false;
    for (const link of contact.links) { const other = contacts.get(link); if (!other || !other.links.includes(contact.id) || other.links.length !== contact.links.length || [...contact.links, contact.id].some(member => member !== other.id && !other.links.includes(member))) return false; }
  }
  for (const group of state.groups) {
    if (group.accountId && !accounts.has(group.accountId) || group.memberIds.some(member => !contacts.has(member) || group.accountId && contacts.get(member).accountId !== group.accountId)) return false;
    if (group.kind === 'smart' ? group.memberIds.length || !group.rules.length : group.rules.length) return false;
  }
  for (const window of state.windows) if (window.groupId && !groups.has(window.groupId) || window.selectedIds.some(member => !contacts.has(member)) || window.editingId && !contacts.has(window.editingId)
    || window.editingId && !window.editor || window.editor && !contactsEditorValid(state, window.editor)) return false;
  return true;
}
export function contactsCapabilities(profile) {
  const windows = profile?.id?.startsWith('windows11') || profile?.family === 'windows';
  const modern = ['sonoma', 'golden-gate'].includes(profile?.renderer) || /sonoma|golden-gate/u.test(profile?.id ?? '');
  return { windows, modern, app: windows ? 'People' : 'Contacts', listsLabel: modern ? 'Lists' : 'Groups', settingsLabel: windows || modern ? 'Settings' : 'Preferences',
    nativeSmartGroups: !windows, nativeTemplates: !windows, nativeMyCard: !windows, availability: windows ? 'People · Microsoft.People UWP; local recreation of the Windows 11 23H2 contact app. Smart groups, templates, My Card, vCard and print are disclosed local equivalents.' : /golden/u.test(profile?.id ?? '') ? 'Contacts · living Apple guide now 27 with 14.0 content paths / simulated OS 27.0.1; no verified 27.0.1 binary.' : 'Contacts · local native-era recreation' };
}
export function createContactsState(profile) {
  return { version: 1, nextId: 1, contacts: [], groups: [], accounts: [{ id: 'contacts-account-local', name: contactsCapabilities(profile).windows ? 'Local contacts' : 'On My Mac', kind: 'local', enabled: true, readOnly: false }], windows: [],
    preferences: { sort: 'family', display: 'given', defaultAccountId: 'contacts-account-local', showPhotos: true, exportNotes: true, exportPhotos: true },
    template: { fields: ['given', 'family', 'organization', 'emails', 'phones', 'addresses', 'urls', 'birthday', 'notes'], labels: [{ field: 'emails', label: 'home' }, { field: 'phones', label: 'mobile' }, { field: 'addresses', label: 'home' }, { field: 'urls', label: 'homepage' }] }, myCardId: null };
}
export function createContactsWindow(state, windowId) {
  return { windowId, groupId: null, query: '', selectedIds: [], sidebarVisible: true, editingId: null, editor: null, sheet: 'none', status: '', pane: 'General' };
}
export function emptyContactSpec(state) {
  return { accountId: state.preferences.defaultAccountId, name: Object.fromEntries(Object.keys(contactsNameSchema.properties).map(key => [key, ''])), organization: '', department: '', jobTitle: '', company: false, emails: [], phones: [], addresses: [], urls: [], birthday: '', notes: '', photo: { kind: 'none', value: '' } };
}
export function createContactEditor(state) {
  const draft = emptyContactSpec(state);
  for (const field of ['emails', 'phones', 'urls', 'addresses']) if (state.template.fields.includes(field)) {
    const label = state.template.labels.find(row => row.field === field)?.label ?? (field === 'phones' ? 'mobile' : field === 'urls' ? 'homepage' : 'home');
    draft[field].push(field === 'addresses' ? { label, street: '', city: '', region: '', postalCode: '', country: '' } : { label, value: '' });
  }
  return draft;
}
export function completedContactSpec(draft) {
  const spec = copyCanonicalData(draft);
  for (const field of ['emails', 'phones', 'urls']) spec[field] = spec[field].filter(row => row.value !== '');
  spec.addresses = spec.addresses.filter(row => [row.street, row.city, row.region, row.postalCode, row.country].some(Boolean));
  return spec;
}
export const contactSpec = contact => Object.fromEntries(Object.keys(contactsSpecSchema.properties).map(key => [key, copyCanonicalData(contact[key])]));
export function contactsNewId(state, prefix = 'contact') {
  let next = state.nextId;
  const occupied = new Set([...state.contacts, ...state.groups, ...state.accounts].map(row => row.id));
  while (next < Number.MAX_SAFE_INTEGER && occupied.has(`${prefix}-${next}`)) next++;
  if (next >= Number.MAX_SAFE_INTEGER) return null;
  state.nextId = next + 1; return `${prefix}-${next}`;
}
const reject = (code, message) => ({ status: 'rejected', code, message });
export function createContact(state, input, options = {}) {
  if (!validateContactsState(state)) return reject('invalid_state', 'Contacts canonical state is invalid.');
  const compactSchema = object({ name: str(256), email: str(254), phone: str(128), notes: str(16384) }, ['name']);
  let spec;
  if (contactsSchemaValid(input, contactsSpecSchema)) spec = copyCanonicalData(input);
  else if (contactsSchemaValid(input, compactSchema)) { spec = emptyContactSpec(state); spec.name.given = input.name; if (input.email) spec.emails.push({ label: 'home', value: input.email }); if (input.phone) spec.phones.push({ label: 'mobile', value: input.phone }); spec.notes = input.notes ?? ''; }
  else return reject('invalid_arguments', 'Use the closed complete or compact contact specification.');
  const optionSchema = object({ time, id: nullable(id), revision: integer(1, Number.MAX_SAFE_INTEGER), createdAt: time }, []);
  if (!contactsSchemaValid(options, optionSchema) || !contactsSpecValid(state, spec, true)) return reject('invalid_arguments', 'Contact fields or source account are invalid.');
  const now = options.time ?? 0, createdAt = options.createdAt ?? now;
  if (createdAt > now) return reject('invalid_arguments', 'Creation time must not exceed update time.');
  if (state.contacts.length >= CONTACTS_LIMITS.contacts) return reject('limit_exceeded', 'The contact limit has been reached.');
  const candidate = copyCanonicalData(state), contactId = options.id ?? contactsNewId(candidate);
  if (!contactId || [...candidate.contacts, ...candidate.groups, ...candidate.accounts].some(row => row.id === contactId)) return reject('conflict', 'The stable contact identity already exists.');
  const contact = { id: contactId, ...spec, revision: options.revision ?? 1, createdAt, updatedAt: now, links: [] }; candidate.contacts.push(contact);
  if (!validateContactsState(candidate)) return reject('limit_exceeded', 'The complete Contacts state exceeds a bound.');
  state.nextId = candidate.nextId; state.contacts.push(contact);
  return { status: 'applied', contactId, contact };
}
export function linkedContact(state, contactId) {
  const primary = contactById(state, contactId); if (!primary) return null;
  const result = copyCanonicalData(primary);
  for (const id of primary.links) { const source = contactById(state, id); if (!source || !state.accounts.find(row => row.id === source.accountId)?.enabled) continue;
    for (const key of ['emails', 'phones', 'addresses', 'urls']) for (const item of source[key]) if (!result[key].some(row => JSON.stringify(row) === JSON.stringify(item))) result[key].push(copyCanonicalData(item));
    for (const key of ['organization', 'department', 'jobTitle', 'birthday', 'notes']) if (!result[key]) result[key] = source[key];
    for (const key of Object.keys(result.name)) if (!result.name[key]) result.name[key] = source.name[key];
    if (result.photo.kind === 'none' && source.photo.kind !== 'none') result.photo = copyCanonicalData(source.photo);
  }
  return result;
}
export function contactsGroupMembers(state, group) {
  if (!group) return state.contacts;
  const source = state.contacts.filter(contact => !group.accountId || contact.accountId === group.accountId);
  if (group.kind === 'group') return source.filter(contact => group.memberIds.includes(contact.id));
  const ruleMatch = (contact, rule) => { const fields = rule.field === 'name' ? [contactName(contact)] : rule.field === 'email' ? contact.emails.map(row => row.value) : rule.field === 'phone' ? contact.phones.map(row => row.value) : [contact[rule.field]];
    if (rule.operator === 'present') return fields.some(Boolean); if (rule.operator === 'absent') return !fields.some(Boolean);
    const match = contactsFold(rule.value); return fields.some(value => rule.operator === 'equals' ? contactsFold(value) === match : contactsFold(value).includes(match)); };
  return source.filter(contact => group.match === 'all' ? group.rules.every(rule => ruleMatch(contact, rule)) : group.rules.some(rule => ruleMatch(contact, rule)));
}
export function contactsUnifiedCards(state, source = state.contacts) {
  const seen = new Set(), rows = [];
  for (const contact of source) {
    if (!state.accounts.find(row => row.id === contact.accountId)?.enabled || seen.has(contact.id)) continue;
    const cluster = [contact.id, ...contact.links];
    for (const id of cluster) seen.add(id);
    rows.push(linkedContact(state, contact.id));
  }
  return rows;
}
export function visibleContacts(state, windowId) {
  const window = contactsWindow(state, windowId); if (!window) return [];
  const query = contactsFold(window.query), group = state.groups.find(row => row.id === window.groupId);
  const source = contactsGroupMembers(state, group), cards = group?.accountId ? source.filter(contact => state.accounts.find(row => row.id === contact.accountId)?.enabled) : contactsUnifiedCards(state, source);
  const rows = cards.filter(contact => !query || contactsFold([contactName(contact), ...Object.values(contact.name), contact.organization, contact.department, contact.jobTitle, contact.birthday, contact.notes, ...['emails', 'phones', 'addresses', 'urls'].flatMap(field => contact[field].flatMap(row => Object.values(row)))].join(' ')).includes(query));
  const sortName = contact => contact.company ? contact.organization : [contact.name[state.preferences.sort], contact.name[state.preferences.sort === 'given' ? 'family' : 'given'], contactName(contact)].join(' ');
  return rows.sort((a, b) => contactsFold(sortName(a)).localeCompare(contactsFold(sortName(b))) || a.id.localeCompare(b.id));
}
export function resolveContacts(state, query = '') {
  if (!validateContactsState(state) || typeof query !== 'string' || query.length > 4096) return [];
  const search = contactsFold(query);
  return contactsUnifiedCards(state).map(card => ({ id: card.id, name: contactName(card, state.preferences), email: card.emails[0]?.value ?? '', phone: card.phones[0]?.value ?? '' })).filter(row => !search || contactsFold(`${row.name} ${row.email} ${row.phone}`).includes(search));
}
export function contactsDuplicates(state) {
  const rows = state.contacts, parent = rows.map((_, i) => i), root = i => { while (parent[i] !== i) i = parent[i]; return i; };
  const keys = new Map();
  rows.forEach((row, index) => { const values = [...row.emails.map(item => `e:${contactsFold(item.value)}`), ...row.phones.map(item => `p:${item.value.replace(/[^\d+]/gu, '')}`).filter(value => value.length > 2)];
    const name = contactsFold(contactName(row)); if (name && name !== 'no name' && (row.name.given || row.name.family || row.organization)) values.push(`n:${name}|${contactsFold(row.organization)}`);
    for (const key of values) { if (keys.has(key)) parent[root(index)] = root(keys.get(key)); else keys.set(key, index); } });
  const groups = new Map(); rows.forEach((row, index) => { const key = root(index), group = groups.get(key) ?? []; group.push(row); groups.set(key, group); });
  return [...groups.values()].filter(group => group.length > 1);
}
export function contactPrintText(state, contactIds, style = 'card') {
  const rows = contactIds.map(id => linkedContact(state, id)).filter(Boolean);
  return rows.map(row => style === 'list' ? [contactName(row, state.preferences), row.emails.map(item => item.value).join(', '), row.phones.map(item => item.value).join(', ')].join('\t') : style === 'labels' ? row.addresses.map(address => [contactName(row, state.preferences), address.street, `${address.city} ${address.region} ${address.postalCode}`.trim(), address.country].filter(Boolean).join('\n')).join('\n\n') : [contactName(row, state.preferences), [row.jobTitle, row.organization, row.department].filter(Boolean).join(' · '), ...row.emails.map(item => `${item.label}: ${item.value}`), ...row.phones.map(item => `${item.label}: ${item.value}`), ...row.addresses.map(item => `${item.label}: ${[item.street, item.city, item.region, item.postalCode, item.country].filter(Boolean).join(', ')}`), ...row.urls.map(item => `${item.label}: ${item.value}`), row.birthday ? `Birthday: ${row.birthday}` : '', row.notes].filter(Boolean).join('\n')).join('\n\n');
}
