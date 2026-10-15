import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { validName } from './windows11-app-helpers.js';

const MAX_CONTENT = 1024 * 1024, MAX_FILES = 1024, MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;
const anchors = new Set(['disk', 'root', 'desktop', 'documents', 'downloads', 'pictures', 'trash', 'icloud-drive', 'mail-cache']);
const idOK = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !['__proto__', 'prototype', 'constructor'].includes(value);
export const validFilesystemMime = mime => typeof mime === 'string' && mime.length <= 256
  && !/[\x00-\x1f\x7f]/.test(mime)
  && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?: *; *[!#$%&'*+.^_`|~0-9A-Za-z-]+ *= *(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"))* *$/.test(mime);
const mimeOK = validFilesystemMime;
const counterOK = value => Number.isSafeInteger(value) && value >= 1 && value <= MAX_COUNTER;
const timestampOK = value => Number.isSafeInteger(value) && value >= 0 && value < 8_640_000_000_000_000;
const reject = (code, message) => ({ status: 'rejected', error: { code, message } });
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const keys = new Set(['id', 'parentId', 'name', 'kind', 'content', 'deleted', 'revision', 'mime', 'encoding', 'appId', 'icon', 'createdAt', 'modifiedAt', 'addedAt', 'lastOpenedAt', 'tags', 'inCloud', 'localResident', 'deletedAt', 'readOnly', 'renameable', 'movable', 'bundleAppId', 'volumeId', 'mounted', 'driveLetter']);
const operations = {
  mkdir: ['type', 'parentId', 'name', 'ref', 'volumeId', 'mounted', 'driveLetter'],
  write: ['type', 'parentId', 'name', 'content', 'mime', 'encoding', 'fileId', 'expectedRevision', 'ref'],
  rename: ['type', 'fileId', 'name', 'expectedRevision'],
  move: ['type', 'fileId', 'parentId', 'name', 'expectedRevision'],
  copy: ['type', 'fileId', 'parentId', 'name', 'recursive', 'expectedRevision', 'ref'],
  trash: ['type', 'fileId', 'expectedRevision'],
  remove: ['type', 'fileId', 'recursive', 'expectedRevision'],
  volume: ['type', 'fileId', 'mounted', 'name', 'driveLetter', 'expectedRevision'],
};

// Reject accessors, symbols, sparse/index-extended arrays and non-JSON objects
// before touching any input values. Retained aliases are pinned too.
function jsonGraph(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || ancestors.has(value)) return false;
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors), path = new Set(ancestors); path.add(value);
  if (array && (value.length > 8192 || names.length !== value.length + 1)) return false;
  return names.every(key => typeof key === 'string' && (array && key === 'length' || descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value') && (!array || /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) && jsonGraph(descriptors[key].value, path)));
}
function pinGraph(value) {
  if (!value || typeof value !== 'object') return () => true;
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  const children = names.map(key => [key, descriptors[key], pinGraph(descriptors[key].value)]);
  return () => {
    const current = Object.getOwnPropertyDescriptors(value), now = Reflect.ownKeys(current);
    return names.length === now.length && names.every((key, index) => key === now[index]) && children.every(([key, previous, guard]) => {
      const next = current[key];
      return next && next.enumerable === previous.enumerable && next.configurable === previous.configurable && next.writable === previous.writable && next.value === previous.value && guard();
    });
  };
}
const validMacName = name => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && !/[:/\u0000-\u001f]/.test(name);
const budgetGraph = store => ({ files: store.files.filter(file => !file.readOnly), nextFileId: store.nextFileId, ...(Object.hasOwn(store, 'sceneTime') ? { sceneTime: store.sceneTime } : {}) });

export function filesystemFileAssociation(mime, profile) {
  mime = typeof mime === 'string' ? mime.split(';', 1)[0].trim().toLowerCase() : mime;
  const profileId = typeof profile === 'string' ? profile : profile?.id;
  const windows = profileId?.startsWith('windows11');
  let appId = null, icon = 'document';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') appId = 'word';
  else if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') appId = 'excel';
  else if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') appId = 'powerpoint';
  else if (mime === 'application/epub+zip') appId = windows ? 'fictional-books' : 'books';
  else if (['application/x-chess-pgn', 'application/x-chess-fen'].includes(mime)) appId = windows ? 'chess-local' : 'chess';
  else if (['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'video/webm'].includes(mime)) appId = windows ? 'media-player' : 'quicktime';
  else if (['application/x-pem-file', 'application/pkix-cert'].includes(mime)) { appId = 'keychain'; icon = 'keychain'; }
  else if (['application/vnd.iccprofile', 'application/iccprofile'].includes(mime)) { appId = 'colorsync'; icon = 'colorsync'; }
  else if (['font/ttf', 'font/otf', 'font/woff2', 'application/x-font-ttf', 'application/x-font-opentype', 'application/vnd.ms-opentype', 'application/font-sfnt'].includes(mime)) { appId = 'fontbook'; icon = 'fontbook'; }
  else if (['application/zip', 'application/x-tar', 'application/gzip'].includes(mime)) appId = windows ? 'archive-utility-local' : 'archive-utility';
  else if (['application/x-iso9660-image', 'application/x-vhd'].includes(mime)) { appId = windows ? 'diskutility-local' : 'diskutility'; icon = 'diskutility'; }
  else if (mime === 'application/x-jesteros-workflow+json') appId = windows ? 'automator-local' : 'automator';
  else if (['text/x-applescript', 'application/x-applescript'].includes(mime)) appId = windows ? 'scripteditor-local' : 'scripteditor';
  else if (mime?.startsWith('image/')) { appId = windows ? 'photos' : 'preview'; icon = 'image'; }
  else if (mime === 'application/pdf') { appId = windows ? 'edge' : 'preview'; icon = 'pdf'; }
  else appId = windows ? 'notepad' : 'textedit';
  return { appId, icon };
}

export function validateFilesystemStore(store, profile) {
  const bad = message => ({ ok: false, message });
  const descriptors = store && typeof store === 'object' && !Array.isArray(store)
    && [Object.prototype, null].includes(Object.getPrototypeOf(store)) ? Object.getOwnPropertyDescriptors(store) : null;
  if (!descriptors || !['files', 'nextFileId'].every(key => descriptors[key]?.enumerable
    && Object.hasOwn(descriptors[key], 'value'))) return bad('Files must expose original data records and a safe counter without accessors.');
  if (!jsonGraph({ files: descriptors.files.value, nextFileId: descriptors.nextFileId.value })
    || !Array.isArray(descriptors.files.value) || !counterOK(descriptors.nextFileId.value)) return bad('Files must be a bounded closed JSON graph with a safe counter.');
  const nameOK = profile?.family === 'windows' || profile?.id?.startsWith('windows11') ? validName : validMacName;
  const byId = new Map(), volumeIds = new Set(), drives = new Set(); let maxId = 0, count = 0;
  for (const file of store.files) {
    const rootDriveName = profile?.id?.startsWith('windows11') && file?.parentId === null && /^[A-Z]:$/.test(file?.name);
    if (!file || Array.isArray(file) || Object.keys(file).some(key => !keys.has(key)) || !idOK(file.id) || byId.has(file.id) || !(nameOK(file.name) || rootDriveName) || !['folder', 'document', 'image', 'text', 'application'].includes(file.kind) || typeof file.content !== 'string' || file.content.length > MAX_CONTENT || typeof file.deleted !== 'boolean' || !counterOK(file.revision) || !(file.parentId === null || idOK(file.parentId))) return bad('Invalid file keys, primitive types, identity, revision, name, kind or content quota.');
    for (const key of ['readOnly', 'renameable', 'movable', 'inCloud', 'localResident', 'mounted']) if (Object.hasOwn(file, key) && typeof file[key] !== 'boolean') return bad('Invalid file flags.');
    for (const key of ['appId', 'icon', 'encoding', 'bundleAppId']) if (Object.hasOwn(file, key) && (!idOK(file[key]) || file[key].length > 256)) return bad('Invalid file association metadata.');
    for (const key of ['createdAt', 'modifiedAt', 'addedAt', 'deletedAt']) if (Object.hasOwn(file, key) && !timestampOK(file[key])) return bad('Invalid authored file timestamp.');
    if (Object.hasOwn(file, 'lastOpenedAt') && file.lastOpenedAt !== null && !timestampOK(file.lastOpenedAt)) return bad('Invalid last-opened timestamp.');
    if (Object.hasOwn(file, 'mime') && !mimeOK(file.mime) || Object.hasOwn(file, 'tags') && (!Array.isArray(file.tags) || file.tags.length > 64 || file.tags.some(tag => typeof tag !== 'string' || tag.length > 256))) return bad('Invalid MIME or tags metadata.');
    if (file.kind === 'folder' && file.content !== '') return bad('Folders cannot own payload bytes.');
    if (file.parentId === null && file.kind !== 'folder') return bad('Every root must be a folder.');
    if (Object.hasOwn(file, 'volumeId')) {
      if (file.parentId !== null || file.kind !== 'folder' || !idOK(file.volumeId) || volumeIds.has(file.volumeId)) return bad('Volumes need unique authoritative root identities.');
      volumeIds.add(file.volumeId);
    }
    if (Object.hasOwn(file, 'mounted') && !Object.hasOwn(file, 'volumeId') || Object.hasOwn(file, 'driveLetter') && (!file.volumeId || !(file.driveLetter === null || typeof file.driveLetter === 'string' && /^[A-Z]$/.test(file.driveLetter)))) return bad('Mount and drive-letter metadata belongs only to volume roots.');
    if (file.driveLetter !== null && file.driveLetter !== undefined) { if (drives.has(file.driveLetter)) return bad('Drive letters must be unique.'); drives.add(file.driveLetter); }
    const generated = /^file-(\d+)$/.exec(file.id); if (generated) maxId = Math.max(maxId, Number(generated[1]));
    if (!file.readOnly) count++;
    byId.set(file.id, file);
  }
  if (count > MAX_FILES || store.nextFileId <= maxId) return bad('Files capacity or generated identity counter is exhausted or regressed.');
  const siblings = new Set();
  for (const file of store.files) {
    const path = new Set([file.id]); let parentId = file.parentId, deleted = file.deleted;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent || parent.kind !== 'folder' || path.has(parentId)) return bad('Missing folder ancestor or cyclic file hierarchy.');
      path.add(parentId); deleted ||= parent.deleted; parentId = parent.parentId;
    }
    if (!deleted) { const key = JSON.stringify([file.parentId, file.name.toLocaleLowerCase('en-US')]); if (siblings.has(key)) return bad('Live siblings cannot have colliding names.'); siblings.add(key); }
  }
  return { ok: true };
}

export function createFilesystemTransactions(ctx) {
  let active = false;
  const getFilesStore = () => (ctx.getStore ?? ctx.getFilesStore)();
  function live(store, id, includeDeleted = false) {
    const byId = new Map(store.files.map(file => [file.id, file])); let file = byId.get(id), cursor = file; const seen = new Set();
    while (cursor) { if (seen.has(cursor.id) || !includeDeleted && cursor.deleted || cursor.mounted === false) return null; seen.add(cursor.id); if (cursor.parentId === null) return file; cursor = byId.get(cursor.parentId); }
    return null;
  }
  const getFile = id => live(getFilesStore(), id);
  function mutateFiles(spec, ownership) {
    if (active) return reject('reentrant_transaction', 'A Files transaction is already staging or committing.');
    active = true;
    try {
      const current = () => ctx.alive() === true && (ownership === undefined || typeof ownership?.guard === 'function' && ownership.guard() === true);
      if (!current()) return reject('stale_target', 'The original Files owner is unavailable.');
      if (!spec || ![Object.prototype, null].includes(Object.getPrototypeOf(spec))) return reject('invalid_arguments', 'Use the closed Files batch packet.');
      const descriptors = Object.getOwnPropertyDescriptors(spec);
      if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !['operations', 'reserveTextUnits', 'onCommit'].includes(key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) return reject('invalid_arguments', 'Unknown or accessor Files batch field.');
      if (!jsonGraph(spec.operations) || !Array.isArray(spec.operations) || !spec.operations.length || spec.operations.length > 1024 || spec.onCommit !== undefined && typeof spec.onCommit !== 'function') return reject('invalid_arguments', 'Use one to 1024 plain Files operations and a synchronous callback.');
      const reservation = spec.reserveTextUnits ?? 0;
      if (!Number.isSafeInteger(reservation)) return reject('invalid_arguments', 'Files reservations must be signed safe integers.');
      const store = getFilesStore(), initial = validateFilesystemStore(store, ctx.profile);
      if (!initial.ok) return reject('invalid_state', initial.message);
      const originals = store.files, originalCounter = store.nextFileId, sceneTime = ctx.getSceneTime(), fileRefs = originals.slice();
      if (!timestampOK(sceneTime)) return reject('invalid_state', 'An authored numeric scene time is required.');
      const graph = { files: originals, nextFileId: originalCounter, ...(Object.hasOwn(store, 'sceneTime') ? { sceneTime: store.sceneTime } : {}) }, fingerprint = JSON.stringify({ files: originals, nextFileId: originalCounter }), pinned = pinGraph(originals);
      const filesGuard = (checkTime = true) => ctx.alive() === true && getFilesStore() === store && store.files === originals && store.nextFileId === originalCounter && (!checkTime || ctx.getSceneTime() === sceneTime && (!Object.hasOwn(graph, 'sceneTime') || store.sceneTime === graph.sceneTime)) && pinned() && JSON.stringify({ files: store.files, nextFileId: store.nextFileId }) === fingerprint;
      const guard = () => current() && filesGuard();
      const candidate = copyCanonicalData(graph), aliases = new Map(), changed = new Map(), plans = [];
      const nameOK = ctx.profile?.id?.startsWith('windows11') ? validName : validMacName;
      const resolve = id => typeof id === 'string' && id.startsWith('$') ? aliases.get(id.slice(1)) ?? fail('invalid_arguments', 'Unknown intra-batch file reference.') : id;
      const record = id => candidate.files.find(file => file.id === resolve(id));
      const available = id => live(candidate, resolve(id));
      const mark = file => { changed.set(file.id, copyCanonicalData(file)); };
      const touch = file => { if (file.revision >= MAX_COUNTER) fail('limit_exceeded', 'File revision is exhausted.'); file.revision++; file.modifiedAt = sceneTime; mark(file); };
      const descendants = file => { const result = [file], ids = new Set([file.id]); for (let i = 0; i < result.length; i++) for (const child of candidate.files) if (child.parentId === result[i].id) { if (ids.has(child.id)) fail('invalid_state', 'Cyclic Files hierarchy.'); ids.add(child.id); result.push(child); } return result; };
      const writable = file => { if (!file || file.readOnly) fail('permission_denied', 'The original writable File is unavailable.'); return file; };
      const parent = id => { const file = writable(available(id)); if (file.kind !== 'folder') fail('not_directory', 'The destination is not a live writable folder.'); return file; };
      const protect = file => { if (anchors.has(file.id) || file.parentId === null) fail('permission_denied', 'Canonical folders and volume roots cannot be moved or removed.'); };
      const collision = (parentId, name, exceptId) => { if (!nameOK(name)) fail('invalid_name', 'The file name is invalid for this OS.'); if (candidate.files.some(file => file.parentId === parentId && file.id !== exceptId && !file.deleted && available(file.id) && file.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) fail('name_collision', 'A live File already owns that name.'); };
      const allocate = () => { if (!counterOK(candidate.nextFileId) || candidate.nextFileId >= MAX_COUNTER) fail('limit_exceeded', 'The Files identity counter is exhausted.'); let id; do { id = `file-${candidate.nextFileId++}`; } while (candidate.files.some(file => file.id === id)); return id; };
      const associate = mime => filesystemFileAssociation(mime, ctx.profile);
      const fresh = (parentId, name, kind, content = '', mime) => ({ id: allocate(), parentId, name, kind, content, ...(mime ? { mime } : {}), deleted: false, revision: 1, createdAt: sceneTime, modifiedAt: sceneTime, addedAt: sceneTime, lastOpenedAt: null, tags: [], ...(kind === 'folder' ? ctx.profile?.id?.startsWith('windows11') ? {} : { appId: 'finder', icon: 'folder' } : associate(mime)) });
      for (const op of spec.operations) {
        const allowed = operations[op?.type];
        if (!allowed || Object.keys(op).some(key => !allowed.includes(key)) || op.expectedRevision !== undefined && !counterOK(op.expectedRevision) || op.recursive !== undefined && typeof op.recursive !== 'boolean' || op.ref !== undefined && (!idOK(op.ref) || op.ref.startsWith('$') || aliases.has(op.ref))) fail('invalid_arguments', 'Use the closed Files operation vocabulary and safe revision/reference.');
        let file = null, affected = [];
        if (op.fileId !== undefined) { if (!idOK(op.fileId)) fail('invalid_arguments', 'Invalid source File identity.'); file = op.type === 'volume' ? record(op.fileId) : op.type === 'remove' ? live(candidate, resolve(op.fileId), true) : available(op.fileId); if (!file) fail('not_found', 'The original source File is not reachable or mounted.'); if (op.expectedRevision !== undefined && file.revision !== op.expectedRevision) fail('revision_conflict', 'The original source File revision changed.'); }
        if (!['mkdir', 'write'].includes(op.type) && !file) fail('invalid_arguments', 'A source File identity is required.');
        if (op.type === 'mkdir') {
          const parentId = op.parentId === null ? null : parent(op.parentId).id;
          if (parentId === null && (!idOK(op.volumeId) || typeof op.mounted !== 'boolean')) fail('invalid_arguments', 'A new root needs authoritative volumeId and mounted metadata.');
          if (parentId !== null && (op.volumeId !== undefined || op.mounted !== undefined || op.driveLetter !== undefined)) fail('invalid_arguments', 'Volume metadata belongs only to root folders.');
          collision(parentId, op.name); file = fresh(parentId, op.name, 'folder');
          if (parentId === null) { file.volumeId = op.volumeId; file.mounted = op.mounted; if (op.driveLetter !== undefined) file.driveLetter = op.driveLetter; }
          candidate.files.push(file); mark(file); affected = [file.id];
        } else if (op.type === 'write') {
          if (typeof op.content !== 'string' || op.content.length > MAX_CONTENT || !mimeOK(op.mime) || op.encoding !== undefined && !idOK(op.encoding)) fail('invalid_arguments', 'Write requires genuine bounded content and MIME metadata.');
          if (file) { writable(file); if (file.kind === 'folder' || file.kind === 'application') fail('is_directory', 'Only payload Files can be written.'); parent(op.parentId ?? file.parentId); const destinationId = op.parentId === undefined ? file.parentId : resolve(op.parentId); collision(destinationId, op.name ?? file.name, file.id); file.parentId = destinationId; file.name = op.name ?? file.name; file.content = op.content; file.mime = op.mime; file.kind = op.mime.startsWith('image/') ? 'image' : ctx.profile?.id?.startsWith('windows11') ? 'text' : 'document'; applyCanonicalData(file, { ...file, ...associate(op.mime), ...(op.encoding !== undefined ? { encoding: op.encoding } : {}) }); touch(file); }
          else { const destination = parent(op.parentId); collision(destination.id, op.name); file = fresh(destination.id, op.name, op.mime.startsWith('image/') ? 'image' : ctx.profile?.id?.startsWith('windows11') ? 'text' : 'document', op.content, op.mime); if (op.encoding !== undefined) file.encoding = op.encoding; candidate.files.push(file); mark(file); }
          affected = [file.id];
        } else if (op.type === 'rename' || op.type === 'move') {
          writable(file); protect(file); const destinationId = op.type === 'move' ? parent(op.parentId).id : file.parentId;
          if (descendants(file).some(child => child.id === destinationId)) fail('cyclic_move', 'A folder cannot be moved into itself or its descendants.');
          collision(destinationId, op.name ?? file.name, file.id); file.parentId = destinationId; file.name = op.name ?? file.name; touch(file); affected = [file.id];
        } else if (op.type === 'copy') {
          if (file.kind === 'application') fail('unsupported_format', 'Readonly installation bundles cannot become mutable payload copies.');
          const destination = parent(op.parentId), source = descendants(file).filter(child => available(child.id));
          if (source.length > 1 && op.recursive !== true) fail('is_directory', 'Copying a nonempty folder requires recursive:true.');
          if (source.some(child => child.id === destination.id)) fail('cyclic_copy', 'A folder cannot be copied into itself or its descendants.');
          collision(destination.id, op.name ?? file.name); const copiedIds = new Map();
          for (const child of source) {
            const copy = copyCanonicalData(child); copy.id = allocate(); copy.parentId = child === file ? destination.id : copiedIds.get(child.parentId); copy.name = child === file ? op.name ?? child.name : child.name; copy.deleted = false; copy.revision = 1; copy.createdAt = copy.modifiedAt = copy.addedAt = sceneTime; copy.lastOpenedAt = null;
            for (const key of ['readOnly', 'renameable', 'movable', 'bundleAppId', 'volumeId', 'mounted', 'driveLetter', 'deletedAt', 'inCloud', 'localResident']) delete copy[key];
            if (copy.kind === 'application') fail('unsupported_format', 'Folder copy contains an installation bundle.');
            copiedIds.set(child.id, copy.id); candidate.files.push(copy); mark(copy); affected.push(copy.id);
          }
          file = record(copiedIds.get(file.id));
        } else if (op.type === 'trash' || op.type === 'remove') {
          writable(file); protect(file); const subtree = descendants(file);
          if (subtree.some(child => child.readOnly || anchors.has(child.id))) fail('permission_denied', 'Subtree contains protected canonical records.');
          if (op.type === 'remove' && subtree.length > 1 && op.recursive !== true) fail('directory_not_empty', 'Removing a nonempty folder requires recursive:true.');
          affected = subtree.map(child => child.id);
          for (const child of subtree) { child.deleted = true; child.deletedAt = sceneTime; touch(child); }
          if (op.type === 'remove') candidate.files = candidate.files.filter(child => !affected.includes(child.id));
        } else if (op.type === 'volume') {
          writable(file); if (file.parentId !== null || file.kind !== 'folder' || !idOK(file.volumeId)) fail('invalid_arguments', 'Volume operations require an actual authoritative volume root.');
          if (op.mounted === undefined && op.name === undefined && op.driveLetter === undefined || op.mounted !== undefined && typeof op.mounted !== 'boolean') fail('invalid_arguments', 'Specify a real volume metadata change.');
          if (op.name !== undefined) { collision(null, op.name, file.id); file.name = op.name; } if (op.mounted !== undefined) file.mounted = op.mounted; if (op.driveLetter !== undefined) file.driveLetter = op.driveLetter; touch(file); affected = [file.id];
        }
        if (op.ref !== undefined) aliases.set(op.ref, file.id);
        plans.push({ type: op.type, fileId: file.id, fileIds: affected });
        if (candidate.files.filter(row => !row.readOnly).length > MAX_FILES) fail('limit_exceeded', 'Shared Files capacity exceeded.');
      }
      const validation = validateFilesystemStore(candidate, ctx.profile);
      if (!validation.ok) return reject('invalid_state', validation.message);
      const delta = canonicalStringUnits(budgetGraph(candidate)) - canonicalStringUnits(budgetGraph(graph));
      if (ctx.canCommit(delta + reservation) !== true) return guard() ? reject('limit_exceeded', 'The complete scene text budget is exhausted.') : reject('stale_target', 'The original Files graph changed during quota preflight.');
      if (!guard()) return reject('stale_target', 'The original Files graph, owner or scene time changed.');
      const actuals = new Map(fileRefs.map(file => [file.id, file]));
      for (const planned of changed.values()) if (!actuals.has(planned.id)) {
        if (typeof ctx.makeRecord !== 'function') return reject('unavailable', 'Root makeRecord is required for actual new Files.');
        const actual = ctx.makeRecord(copyCanonicalData(planned));
        if (!actual || !jsonGraph(actual) || JSON.stringify(actual) !== JSON.stringify(planned)) return reject('invalid_state', 'Root returned an invalid actual File record.');
        actuals.set(planned.id, actual);
      }
      if (!guard()) return reject('stale_target', 'Original Files changed while allocating native records.');
      const freezeData = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeData(child); Object.freeze(value); } return value; };
      const metadata = freezeData([...changed.values()].map(copyCanonicalData));
      const results = Object.freeze(plans.map(plan => Object.freeze({ ...plan, file: actuals.get(plan.fileId), fileIds: Object.freeze([...plan.fileIds]) })));
      if (spec.onCommit) {
        if (typeof ctx.reserve !== 'function') return reject('unavailable', 'Root Files delta reservation is required for paired commits.');
        let accepted = false;
        const result = ctx.reserve(delta, () => { if (!guard()) return false; const response = spec.onCommit(results, metadata); accepted = response === true; return accepted; });
        if (result !== true || !accepted) return reject('stale_target', 'The paired actor transaction refused the Files commit.');
      }
      if (!(spec.onCommit ? filesGuard(false) : guard())) return reject('stale_target', 'Original Files changed during the paired commit.');
      for (const next of changed.values()) applyCanonicalData(actuals.get(next.id), next);
      originals.splice(0, originals.length, ...candidate.files.map(file => actuals.get(file.id)));
      store.nextFileId = candidate.nextFileId;
      return { status: 'applied', results, files: [...changed.keys()].map(id => actuals.get(id)) };
    } catch (error) {
      return reject(error.code ?? 'invalid_arguments', error.message ?? 'The Files batch could not be committed.');
    } finally { active = false; }
  }
  return { mutateFiles, getFile, getFilesStore };
}
