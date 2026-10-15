import { canonicalStringUnits } from './canonical-data.js';
import { uniqueName, validName } from './windows11-app-helpers.js';
import { validMacDesktopName } from './desktop-file-state.js';
import { createFilesystemTransactions, filesystemFileAssociation, validFilesystemMime } from './filesystem-transactions.js';
import { validateClipboardPNG } from './clipboard-content.js';
import { rejected } from './feature-commands.js';

const applied = extra => ({ status: 'applied', ...extra });
const current = owner => (typeof owner === 'function' ? owner : owner?.guard ?? owner?.isCurrent ?? (() => true))() === true;
export function applicationFileMime(file) {
  if (file?.mime !== undefined && file.mime !== null) return file.mime;
  // Explicit plain text is never an encoded resource merely because its
  // literal contents start with data:. Legacy byte records have no encoding.
  if (['utf8', 'utf-8', 'text'].includes(file?.encoding)) return 'text/plain';
  const encoded = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(file?.content ?? file?.text ?? '');
  if (encoded && (!file?.encoding || file.encoding === 'base64')) return encoded[1];
  if (file?.encoding === 'base64') return null;
  return file?.kind === 'text' || /\.txt$/i.test(file?.name ?? '') ? 'text/plain' : null;
}
export const validFileMime = validFilesystemMime;

// Every domain uses the same Files graph. Callback reservations are committed in
// the same synchronous transaction; a rejected callback cannot leave an orphan.
export function createApplicationFileBridges(ctx) {
  const filesystem = createFilesystemTransactions(ctx);
  const getFile = id => filesystem.getFile(id) ?? null;
  const plans = new WeakMap();
  function readFile(fileId, owner) {
    if (fileId && typeof fileId === 'object') { owner = fileId; fileId = owner.fileId; }
    if (!ctx.alive() || !current(owner)) return rejected('stale_target', 'The original file request is unavailable.');
    const file = getFile(fileId);
    if (!file || file.kind === 'folder') return rejected('stale_target', 'The original document no longer exists.');
    const mime = applicationFileMime(file);
    if (!mime || typeof file.content !== 'string') return rejected('unavailable', 'This file has no supported document bytes or MIME metadata.');
    return applied({ file, text: file.content, mime, name: file.name });
  }
  function prepareFile(spec, owner) {
    if (!ctx.alive() || !current(owner)) return { error: rejected('stale_target', 'The original file request is unavailable.') };
    const store = ctx.getStore(), mac = ctx.profile.family === 'macos';
    const records = store.files.slice(), counter = store.nextFileId;
    const fingerprint = JSON.stringify({ files: records, nextFileId: counter });
    const content = spec.content ?? spec.text, mime = spec.mime ?? spec.mimeType;
    if (!(mac ? validMacDesktopName : validName)(spec.name) || typeof content !== 'string'
      || content.length > 1024 * 1024 || !validFileMime(mime))
      return { error: rejected('invalid_arguments', 'Use a valid file name, supported MIME type, and at most 1 MiB of authored content.') };
    const existingId = spec.existingFileId ?? null, original = existingId ? getFile(existingId) : null;
    if (existingId && (!original || original.readOnly || original.kind === 'folder'
      || spec.expectedRevision !== undefined && spec.expectedRevision !== original.revision))
      return { error: rejected('stale_target', 'The original writable file revision is unavailable.') };
    const parentId = spec.parentId ?? spec.folderId ?? spec.folder ?? original?.parentId ?? 'documents';
    const destination = getFile(parentId);
    if (!destination || destination.kind !== 'folder' || destination.readOnly || destination.id === 'trash')
      return { error: rejected('stale_target', 'The destination folder is unavailable.') };
    if (!uniqueName(store, parentId, spec.name, original?.id))
      return { error: rejected('invalid_arguments', 'A live file with that name already exists in this folder.') };
    if (!original && (records.filter(file => !file.readOnly).length >= 1024
      || !Number.isSafeInteger(counter) || counter >= Number.MAX_SAFE_INTEGER - 1))
      return { error: rejected('limit_exceeded', 'The shared Files capacity is exhausted.') };
    let nextId = counter, id = original?.id;
    if (!id) { do { id = `file-${nextId++}`; } while (records.some(file => file.id === id)); }
    const time = ctx.getSceneTime();
    const record = { ...(original ?? {}), id, parentId, name: spec.name,
      ...filesystemFileAssociation(mime, ctx.profile),
      kind: mime.startsWith('image/') ? 'image' : mac ? 'document' : 'text', content, mime, deleted: false,
      revision: (original?.revision ?? 0) + 1,
      ...(mac ? { createdAt: original?.createdAt ?? time, modifiedAt: time,
        addedAt: original?.addedAt ?? time, lastOpenedAt: original?.lastOpenedAt ?? null,
        tags: [...(original?.tags ?? [])] } : {}),
      ...(spec.encoding !== undefined ? { encoding: spec.encoding } : {}) };
    const before = { files: records.filter(file => !file.readOnly), nextFileId: counter };
    const after = { files: before.files.map(file => file === original ? record : file), nextFileId: nextId };
    if (!original) after.files.push(record);
    const ownsFiles = () => ctx.alive() && ctx.getStore() === store && counter === store.nextFileId
      && records.length === store.files.length && records.every((file, index) => store.files[index] === file)
      && JSON.stringify({ files: store.files, nextFileId: store.nextFileId }) === fingerprint
      && (!original || getFile(id) === original);
    const isCurrent = () => current(owner) && ownsFiles() && ctx.getSceneTime() === time;
    return { store, original, id, record, nextId, isCurrent,
      delta: canonicalStringUnits(after) - canonicalStringUnits(before) };
  }
  function planFile(spec, owner = spec) {
    const prepared = prepareFile(spec, owner);
    if (prepared.error) return prepared.error;
    const metadata = Object.freeze({ ...prepared.record,
      ...(prepared.record.tags ? { tags: Object.freeze([...prepared.record.tags]) } : {}) });
    const result = applied({ fileId: prepared.id, metadata, current: prepared.isCurrent });
    plans.set(result, prepared);
    return result;
  }
  function createFile(spec, owner = spec) {
    const prepared = spec.plan ? plans.get(spec.plan) : prepareFile(spec, owner);
    if (!prepared) return rejected('stale_target', 'Use the original prospective file plan.');
    if (prepared.error) return prepared.error;
    const { store, original, id, record, nextId, delta, isCurrent } = prepared;
    if (!isCurrent() || !current(owner)) return rejected('stale_target', 'The original file request changed.');
    if (spec.plan && (spec.name !== record.name || (spec.content ?? spec.text) !== record.content
      || (spec.mime ?? spec.mimeType) !== record.mime || (spec.existingFileId ?? null) !== (original?.id ?? null)
      || spec.expectedRevision !== undefined && spec.expectedRevision !== original?.revision
      || (spec.parentId ?? spec.folderId ?? spec.folder ?? record.parentId) !== record.parentId
      || spec.encoding !== record.encoding))
      return rejected('invalid_arguments', 'The file bytes or metadata differ from the original plan.');
    const reserve = spec.reserveTextUnits ?? 0;
    if (!Number.isSafeInteger(reserve) || !ctx.canCommit(delta + reserve))
      return rejected('limit_exceeded', 'The complete scene text budget is exhausted.');
    if (!isCurrent() || !current(owner)) return rejected('stale_target', 'The original file request changed.');
    const published = original ?? (ctx.makeRecord ? ctx.makeRecord(record) : record);
    const planned = spec.plan?.metadata ?? Object.freeze({ ...record,
      ...(record.tags ? { tags: Object.freeze([...record.tags]) } : {}) });
    if (spec.onCommit && ctx.reserve(delta, () => spec.onCommit(id, published, planned)) !== true)
      return rejected('stale_target', 'The original document transaction refused the file commit.');
    if (original) Object.assign(original, record); else store.files.push(published);
    store.nextFileId = nextId;
    return applied({ fileId: id, file: getFile(id) });
  }
  function setClipboard(spec, owner) {
    if (!ctx.alive() || !current(owner)) return rejected('stale_target', 'The original clipboard request is unavailable.');
    let candidate, sources = [];
    if (spec.kind === 'text' && typeof spec.text === 'string' && spec.text.length <= 1024 * 1024
      && Array.isArray(spec.fileIds) && spec.fileIds.length === 0)
      candidate = { kind: 'text', text: spec.text, fileIds: [] };
    else if (spec.kind === 'files' && spec.text === '' && Array.isArray(spec.fileIds)
      && spec.fileIds.length > 0 && spec.fileIds.length <= 1024
      && spec.fileIds.every(id => typeof id === 'string' && id.length > 0)
      && new Set(spec.fileIds).size === spec.fileIds.length) {
      sources = spec.fileIds.map(id => ({ id, file: getFile(id) }));
      if (sources.some(source => !source.file)) return rejected('stale_target', 'The original copied Files are unavailable.');
      for (const source of sources) source.fingerprint = JSON.stringify(source.file);
      candidate = { kind: 'files', text: '', fileIds: [...spec.fileIds] };
    } else if (spec.kind === 'image' && spec.mime === 'image/png'
      && validateClipboardPNG(spec.content, spec.width, spec.height))
      candidate = { kind: 'image', text: '', fileIds: [], mime: spec.mime,
        content: spec.content, width: spec.width, height: spec.height };
    else return rejected('invalid_arguments', 'Use bounded text, actual live File IDs, or a genuine supported PNG clipboard image.');
    const clipboard = ctx.getClipboard(), reserve = spec.reserveTextUnits ?? 0;
    const fingerprint = JSON.stringify(clipboard);
    const delta = canonicalStringUnits(candidate) - canonicalStringUnits(clipboard);
    if (!Number.isSafeInteger(reserve) || !ctx.canCommit(delta + reserve))
      return rejected('limit_exceeded', 'The complete scene text budget is exhausted.');
    if (!current(owner) || ctx.getClipboard() !== clipboard || JSON.stringify(clipboard) !== fingerprint
      || sources.some(source => getFile(source.id) !== source.file || JSON.stringify(source.file) !== source.fingerprint)
      || spec.onCommit && ctx.reserve(delta, spec.onCommit) !== true)
      return rejected('stale_target', 'The original clipboard transaction changed.');
    for (const key of Object.keys(clipboard)) if (!Object.hasOwn(candidate, key)) delete clipboard[key];
    Object.assign(clipboard, candidate);
    return applied({ clipboard: candidate });
  }
  return { getFile, readFile, planFile, createFile, setClipboard,
    setImageClipboard: (spec, owner) => setClipboard({ ...spec, kind: 'image' }, owner),
    mutateFiles: filesystem.mutateFiles,
    renameFile: filesystem.renameFile, moveFile: filesystem.moveFile,
    listFiles: owner => current(owner)
      ? applied({ files: ctx.getStore().files.filter(file => !file.readOnly && getFile(file.id) === file)
        .map(file => ({ id: file.id, name: file.name, kind: file.kind, mime: applicationFileMime(file), parentId: file.parentId, revision: file.revision })) })
      : rejected('stale_target', 'The original file picker changed.') };
}
