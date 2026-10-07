import { object } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';

const MAX_TEXT = 1024 * 1024, MAX_TOTAL_TEXT = 4 * MAX_TEXT;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1, MAX_TIME = 8_640_000_000_000_000 - 1;
const channels = { contacts: 'contact', mail: 'mail', messages: 'message' };
const fieldLimits = {
  contact: { name: 4096, email: 4096, phone: 4096, notes: MAX_TEXT },
  mail: { to: 4096, subject: 4096, body: MAX_TEXT },
  message: { to: 4096, body: MAX_TEXT },
};
const stateKeys = ['timeBase', 'nextId', 'contacts', 'drafts', 'outbox', 'selected'];
const entityKeys = ['id', 'kind', 'createdAt', 'updatedAt', 'revision', 'fields'];
const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const string = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength });
const integer = (minimum, maximum = MAX_COUNTER) => ({ type: 'integer', minimum, maximum });
const identity = { ...string(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...forbiddenIds] } };
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const attachmentSchema = object({ fileId: identity, name: string(255, 1), revision: integer(1), content: string(MAX_TEXT) });
const entitySchema = (kind, draft = false) => object({
  id: { ...identity, pattern: `^service-${draft ? 'draft' : kind}-[1-9][0-9]*$` }, kind: { const: kind },
  createdAt: integer(0, MAX_TIME), updatedAt: integer(0, MAX_TIME), revision: integer(1),
  fields: object(Object.fromEntries(Object.entries(fieldLimits[kind]).map(([key, limit]) => [key,
    ['body', 'notes'].includes(key) ? string(limit) : { ...string(limit), not: { type: 'string', pattern: '[\\r\\n]' } }]))),
  ...(kind === 'mail' ? { attachments: array(attachmentSchema, 128) } : {}),
});
export const communicationsSchema = object({
  timeBase: integer(0, MAX_TIME), nextId: integer(1), contacts: array(entitySchema('contact'), 1024),
  drafts: array({ anyOf: Object.keys(fieldLimits).map(kind => entitySchema(kind, true)) }, 128),
  outbox: array({ anyOf: ['mail', 'message'].map(kind => entitySchema(kind)) }, 1024),
  selected: object(Object.fromEntries(Object.keys(channels).map(appId => [appId, nullable(identity)]))),
});
export const communicationDefaults = sceneTime => ({
  timeBase: sceneTime, nextId: 1, contacts: [], drafts: [], outbox: [],
  selected: { contacts: null, mail: null, messages: null },
});
const invalid = message => ({ ok: false, message });
const bounded = (value, minimum, maximum = MAX_COUNTER) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const validId = value => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbiddenIds.has(value);
const closed = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const appForKind = kind => kind === 'contact' ? 'contacts' : kind === 'message' ? 'messages' : 'mail';

// Descriptor inspection precedes property reads: never invoke actor accessors.
// Renderer-owned state may be reactive; actor objects additionally cross the
// structured-clone boundary, which rejects even transparent JavaScript proxies.
function plainData(value, seen = new Set(), budget = { text: 0 }, depth = 0) {
  if (typeof value === 'string') return (budget.text += value.length) <= MAX_TOTAL_TEXT;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 12 || seen.has(value)) return false;
  const list = Array.isArray(value);
  if (list ? Object.getPrototypeOf(value) !== Array.prototype : !isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (list ? value.length > 1024 || keys.length !== value.length + 1 : keys.length > 1024) return false;
  seen.add(value);
  for (const key of keys) {
    if (list && key === 'length') continue;
    if (typeof key !== 'string' || (list && !/^(0|[1-9]\d*)$/.test(key))) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
      || !plainData(descriptor.value, seen, budget, depth + 1)) return false;
    if ((budget.text += key.length) > MAX_TOTAL_TEXT) return false;
  }
  seen.delete(value);
  return true;
}
function actorData(value) {
  try { return plainData(value) ? structuredClone(value) : null; } catch { return null; }
}
export function validCommunicationField(kind, field, value) {
  return typeof kind === 'string' && Object.hasOwn(fieldLimits, kind) && typeof field === 'string'
    && Object.hasOwn(fieldLimits[kind], field) && typeof value === 'string' && value.length <= fieldLimits[kind][field]
    && (['body', 'notes'].includes(field) || !/[\r\n]/.test(value));
}
function validFields(kind, fields) {
  const limits = fieldLimits[kind];
  return limits && closed(fields, Object.keys(limits)) && Object.entries(limits)
    .every(([key]) => validCommunicationField(kind, key, fields[key]));
}
function validAttachments(attachments) {
  return Array.isArray(attachments) && attachments.length <= 128 && attachments.every(attachment =>
    closed(attachment, ['fileId', 'name', 'revision', 'content']) && validId(attachment.fileId)
    && typeof attachment.name === 'string' && attachment.name.length > 0 && attachment.name.length <= 255
    && bounded(attachment.revision, 1) && typeof attachment.content === 'string' && attachment.content.length <= MAX_TEXT);
}
const identified = fields => [fields.name, fields.email, fields.phone].some(value => value.trim().length > 0);
const sendable = entity => entity.fields.to.trim().length > 0
  && (entity.fields.body.trim().length > 0 || (entity.kind === 'mail' && entity.attachments.length > 0));
function validEntity(entity, collection, timeBase) {
  const kind = entity?.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(fieldLimits, kind) || (collection === 'contacts' ? kind !== 'contact' : collection === 'outbox' && kind === 'contact')
    || !closed(entity, kind === 'mail' ? [...entityKeys, 'attachments'] : entityKeys)
    || !validFields(kind, entity.fields) || (kind === 'mail' && !validAttachments(entity.attachments))
    || !bounded(entity.createdAt, 0, timeBase) || !bounded(entity.updatedAt, entity.createdAt, timeBase)
    || !bounded(entity.revision, 1)) return false;
  const prefix = collection === 'drafts' ? 'draft' : kind;
  if (typeof entity.id !== 'string' || !new RegExp(`^service-${prefix}-[1-9][0-9]*$`).test(entity.id)
    || !validId(entity.id)) return false;
  return collection === 'drafts' || (kind === 'contact' ? identified(entity.fields) : sendable(entity));
}
export function validateCommunications(state) {
  try {
    if (!plainData(state) || !closed(state, stateKeys) || !bounded(state.timeBase, 0, MAX_TIME)
      || !bounded(state.nextId, 1) || !closed(state.selected, Object.keys(channels))) return invalid('Expected a complete, bounded plain communications state.');
    const ids = new Set(), allocations = new Set();
    for (const [collection, limit] of [['contacts', 1024], ['drafts', 128], ['outbox', 1024]]) {
      if (!Array.isArray(state[collection]) || state[collection].length > limit) return invalid('Communications collection capacity exceeded.');
      for (const entity of state[collection]) {
        if (!validEntity(entity, collection, state.timeBase)) return invalid('Invalid communications fields, channel, snapshot, revision or timestamps.');
        const number = Number(entity.id.slice(entity.id.lastIndexOf('-') + 1));
        if (!bounded(number, 1) || number >= state.nextId || ids.has(entity.id) || allocations.has(number)) return invalid('Communications identities must use unique allocations below nextId.');
        ids.add(entity.id); allocations.add(number);
      }
    }
    for (const appId of Object.keys(channels)) {
      const selected = state.selected[appId];
      if (selected !== null && (!validId(selected) || !entries(state, appId).some(entity => entity.id === selected))) return invalid('Selected communications entries must exist in their own channel.');
    }
    return { ok: true };
  } catch { return invalid('Communications must be plain serializable data without accessors or invalid proxies.'); }
}
function entries(state, appId) {
  if (typeof appId !== 'string' || !Object.hasOwn(channels, appId)) return [];
  return [...state.drafts, ...(appId === 'contacts' ? state.contacts : state.outbox)]
    .filter(entity => entity.kind === channels[appId]).sort((left, right) => right.updatedAt - left.updatedAt);
}
export function communicationEntries(state, appId) {
  return validateCommunications(state).ok ? entries(state, appId) : [];
}
export function communicationEntry(state, appId, entryId) {
  if (!validateCommunications(state).ok || typeof appId !== 'string' || !Object.hasOwn(channels, appId)) return null;
  if (entryId === undefined) entryId = state.selected[appId];
  return entries(state, appId).find(entity => entity.id === entryId) ?? null;
}
function detached(state) {
  return {
    timeBase: state.timeBase, nextId: state.nextId,
    contacts: state.contacts.map(cloneEntity), drafts: state.drafts.map(cloneEntity), outbox: state.outbox.map(cloneEntity),
    selected: { ...state.selected },
  };
}
function cloneEntity(entity) {
  return { ...entity, fields: { ...entity.fields },
    ...(entity.kind === 'mail' ? { attachments: entity.attachments.map(attachment => ({ ...attachment })) } : {}) };
}
function nextTimestamp(state, sceneTime) {
  if (sceneTime !== undefined && !bounded(sceneTime, 0, MAX_TIME)) return null;
  const time = Math.max(state.timeBase, sceneTime ?? state.timeBase);
  return time < MAX_TIME ? time + 1 : null;
}
export function draftPreview(state, kind, fields, attachments = [], sceneTime) {
  try {
    if (!validateCommunications(state).ok || typeof kind !== 'string' || !Object.hasOwn(fieldLimits, kind)
      || state.drafts.length >= 128 || state.nextId >= MAX_COUNTER) return null;
    const copiedFields = actorData(fields), copiedAttachments = actorData(attachments), time = nextTimestamp(state, sceneTime);
    if (time === null || !validFields(kind, copiedFields) || !validAttachments(copiedAttachments)
      || (kind !== 'mail' && copiedAttachments.length !== 0)) return null;
    const preview = { id: `service-draft-${state.nextId}`, kind, createdAt: time, updatedAt: time, revision: 1, fields: copiedFields,
      ...(kind === 'mail' ? { attachments: copiedAttachments } : {}) };
    const candidate = detached(state);
    candidate.timeBase = time; candidate.nextId++; candidate.drafts.push(preview); candidate.selected[appForKind(kind)] = preview.id;
    return validateCommunications(candidate).ok ? preview : null;
  } catch { return null; }
}
function stateError(state) {
  const validation = validateCommunications(state);
  return validation.ok ? null : rejected('invalid_arguments', validation.message);
}
function commit(state, candidate, canCommit = () => true, isCurrent = () => true) {
  const validation = validateCommunications(candidate);
  if (!validation.ok) return rejected('limit_exceeded', validation.message);
  if (typeof canCommit !== 'function') return rejected('invalid_arguments', 'Expected a synchronous candidate budget callback.');
  try {
    if (stateKeys.some(key => Object.getOwnPropertyDescriptor(state, key)?.writable !== true)) return rejected('invalid_arguments', 'Communications state must be writable.');
    // The callback owns this detached copy; it cannot alter either the current
    // model or the validated candidate that will actually be committed.
    const accepted = canCommit(detached(candidate));
    if (!isCurrent()) return rejected('unavailable', 'The original communications model changed during reply preparation.');
    if (accepted !== true) return rejected('limit_exceeded', 'The complete communications candidate exceeds the scene budget.');
  } catch { return rejected('limit_exceeded', 'The complete communications candidate could not be accepted.'); }
  for (const key of stateKeys) state[key] = candidate[key];
  return null;
}
export function createCommunicationDraft(state, preview, canCommit = () => true, sceneTime) {
  const error = stateError(state); if (error) return error;
  const copied = actorData(preview);
  if (!copied || !validEntity(copied, 'drafts', copied.createdAt)) return rejected('invalid_arguments', 'Expected a complete plain communications draft preview.');
  const expected = draftPreview(state, copied.kind, copied.fields, copied.kind === 'mail' ? copied.attachments : [], sceneTime);
  if (!expected) return rejected('limit_exceeded', 'Draft capacity, allocation, clock or text budget is exhausted.');
  if (copied.id !== expected.id || copied.createdAt !== expected.createdAt || copied.updatedAt !== expected.updatedAt || copied.revision !== 1) return rejected('stale_target', 'The preview no longer matches the next communications allocation and clock.');
  const next = detached(state);
  next.timeBase = copied.updatedAt; next.nextId++; next.drafts.push(copied); next.selected[appForKind(copied.kind)] = copied.id;
  const denied = commit(state, next, canCommit); if (denied) return denied;
  return { status: 'applied', target: { draftId: copied.id, kind: copied.kind } };
}
export function changeCommunicationDraft(state, draftId, field, value, canCommit = () => true, sceneTime) {
  const error = stateError(state); if (error) return error;
  if (!validId(draftId) || typeof field !== 'string' || typeof value !== 'string') return rejected('invalid_arguments', 'Expected a draft identity and exact text field/value.');
  const draft = state.drafts.find(entity => entity.id === draftId);
  if (!draft) return rejected('not_found', 'The communications draft does not exist.');
  if (!validCommunicationField(draft.kind, field, value))
    return rejected('invalid_arguments', 'Unknown communications field, text bound exceeded or newline in a single-line field.');
  if (draft.fields[field] === value) return { status: 'applied', target: { draftId, field } };
  const time = nextTimestamp(state, sceneTime);
  if (time === null || draft.revision >= MAX_COUNTER) return rejected('limit_exceeded', 'The communications clock or revision is exhausted.');
  const next = detached(state), changed = next.drafts.find(entity => entity.id === draftId);
  changed.fields[field] = value; changed.revision++; changed.updatedAt = time; next.timeBase = time;
  const denied = commit(state, next, canCommit); if (denied) return denied;
  return { status: 'applied', target: { draftId, field } };
}
export function submitCommunicationDraft(state, draftId, canCommit = () => true, sceneTime) {
  const error = stateError(state); if (error) return error;
  if (!validId(draftId)) return rejected('invalid_arguments', 'Expected a communications draft identity.');
  const draft = state.drafts.find(entity => entity.id === draftId);
  if (!draft) return rejected('not_found', 'The communications draft does not exist.');
  if (!(draft.kind === 'contact' ? identified(draft.fields) : sendable(draft))) return rejected('invalid_arguments', draft.kind === 'contact'
    ? 'A local contact requires a nonblank name, email or phone.' : 'Local sending requires a recipient and body, or a real Mail attachment.');
  const collection = draft.kind === 'contact' ? 'contacts' : 'outbox', time = nextTimestamp(state, sceneTime);
  if (state[collection].length >= 1024 || state.nextId >= MAX_COUNTER || time === null) return rejected('limit_exceeded', 'Record capacity, communications allocation or clock is exhausted.');
  const next = detached(state), recordId = `service-${draft.kind}-${state.nextId}`;
  const record = { ...cloneEntity(draft), id: recordId, createdAt: time, updatedAt: time, revision: 1 };
  next[collection].push(record); next.drafts = next.drafts.filter(entity => entity.id !== draftId);
  next.nextId++; next.timeBase = time; next.selected[appForKind(draft.kind)] = recordId;
  const denied = commit(state, next, canCommit); if (denied) return denied;
  return { status: 'applied', target: { draftId, recordId, kind: draft.kind } };
}
export function discardCommunicationDraft(state, draftId) {
  const error = stateError(state); if (error) return error;
  if (!validId(draftId)) return rejected('invalid_arguments', 'Expected a communications draft identity.');
  const draft = state.drafts.find(entity => entity.id === draftId);
  if (!draft) return rejected('not_found', 'The communications draft does not exist.');
  const appId = appForKind(draft.kind), next = detached(state);
  next.drafts = next.drafts.filter(entity => entity.id !== draftId);
  if (next.selected[appId] === draftId) next.selected[appId] = entries(next, appId)[0]?.id ?? null;
  const denied = commit(state, next); if (denied) return denied;
  return { status: 'applied', target: { draftId, appId, entryId: next.selected[appId] } };
}
export function selectCommunicationEntry(state, appId, entryId) {
  const error = stateError(state); if (error) return error;
  if (typeof appId !== 'string' || !Object.hasOwn(channels, appId) || (entryId !== null && !validId(entryId))) return rejected('invalid_arguments', 'Expected an exact communications application and entry identity or null.');
  if (entryId !== null && !entries(state, appId).some(entity => entity.id === entryId)) return rejected('not_found', 'The entry does not exist in this communications channel.');
  const next = { ...state, selected: { ...state.selected, [appId]: entryId } };
  const denied = commit(state, next); if (denied) return denied;
  return { status: 'applied', target: { appId, entryId } };
}

function retainCommunicationGraph(state) {
  const snapshots = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of Reflect.ownKeys(value)) if (key !== 'length') visit(value[key]);
    snapshots.push({ value, prototype: Object.getPrototypeOf(value), descriptors: Object.getOwnPropertyDescriptors(value) });
  };
  visit(state);
  return () => snapshots.every(({ value, prototype, descriptors }) => Object.getPrototypeOf(value) === prototype
    && Reflect.ownKeys(value).length === Reflect.ownKeys(descriptors).length
    && Reflect.ownKeys(descriptors).every(key => {
      const a = descriptors[key], b = Object.getOwnPropertyDescriptor(value, key);
      return b && a.enumerable === b.enumerable && a.configurable === b.configurable && a.writable === b.writable
        && a.value === b.value && a.get === b.get && a.set === b.set;
    }));
}

/** A notification reply commits one real local sent record, never a draft shim. */
export function replyToCommunication(state, recordId, body, canCommit = () => true, sceneTime) {
  const error = stateError(state); if (error) return error;
  if (!validId(recordId) || typeof body !== 'string' || !body.trim() || body.length > MAX_TEXT)
    return rejected('invalid_arguments', 'A local notification reply requires an original sent record and bounded nonblank text.');
  const original = state.outbox.find(entity => entity.id === recordId && ['message', 'mail'].includes(entity.kind));
  if (!original || !original.fields.to.trim()) return rejected('not_found', 'The original local reply recipient is unavailable.');
  const current = retainCommunicationGraph(state);
  const time = nextTimestamp(state, sceneTime);
  if (state.outbox.length >= 1024 || state.nextId >= MAX_COUNTER || time === null)
    return rejected('limit_exceeded', 'Local reply capacity, allocation or scene clock is exhausted.');
  const fields = { ...original.fields, body };
  if (original.kind === 'mail' && !fields.subject.startsWith('Re: ')) fields.subject = `Re: ${fields.subject}`;
  if (!validFields(original.kind, fields)) return rejected('limit_exceeded', 'The original recipient or reply subject exceeds its literal field bounds.');
  const next = detached(state), replyId = `service-${original.kind}-${state.nextId}`;
  const record = { id: replyId, kind: original.kind, createdAt: time, updatedAt: time, revision: 1, fields,
    ...(original.kind === 'mail' ? { attachments: [] } : {}) };
  next.outbox.push(record); next.nextId++; next.timeBase = time; next.selected[appForKind(original.kind)] = replyId;
  const denied = commit(state, next, canCommit, current); if (denied) return denied;
  return { status: 'applied', target: { appId: appForKind(original.kind), recordId: replyId } };
}
