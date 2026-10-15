const sameFiles = (left, right) => left.length === right.length && left.every((file, index) => {
  const other = right[index];
  return file.fileId === other.fileId && file.revision === other.revision && file.name === other.name
    && file.path === other.path && file.kind === other.kind;
});

// Opaque Services IDs retain actual canonical records/native range leases.
// Destination focus changes never replace or retire an original mounted source.
export function createServiceSources(ctx) {
  let sequence = 0;
  const scopeId = globalThis.crypto.randomUUID(), cached = new Map();
  const owns = source => Boolean(source && ctx.available() && ctx.ownsPresentation(source) === true);
  const current = source => Boolean(owns(source) && source.isCurrent() === true);
  function identify(value) {
    if (!value || typeof value.isCurrent !== 'function' || !owns(value) || !value.isCurrent()) return null;
    const key = `${value.appId}:${value.windowId}:${value.kind}:${value.control ?? ''}:${value.recordId ?? value.noteId ?? ''}`;
    const previous = cached.get(key);
    if (previous && current(previous) && previous.node === value.node && previous.revision === value.revision
      && previous.value === value.value && previous.start === value.start && previous.end === value.end
      && (value.kind !== 'files' || sameFiles(previous.files, value.files))) return previous;
    if (cached.size >= 64) cached.clear();
    const source = { ...value, sourceId: `${ctx.namespace()}services-source-${scopeId}-${++sequence}` };
    cached.set(key, source);
    return source;
  }
  const physicalSource = () => identify(ctx.getPhysicalSource());
  const contactSource = () => identify(ctx.getContactSource());
  function getSource(sourceId) {
    if (sourceId !== undefined) {
      for (const source of cached.values()) if (source.sourceId === sourceId && current(source)) return source;
      return null;
    }
    const retained = ctx.retainedSource();
    return retained && current(retained) ? retained : physicalSource();
  }
  function describe(source) {
    return { sourceId: source.sourceId, kind: source.kind, appId: source.appId, windowId: source.windowId,
      ...(source.kind === 'text' ? { control: source.control, start: source.start, end: source.end, textLength: source.text.length,
        ...(source.noteId ? { noteId: source.noteId } : {}), ...(source.recordId ? { recordId: source.recordId } : {}) } : {}),
      ...(source.kind === 'files' ? { fileIds: source.files.map(file => file.fileId) } : {}),
      ...(source.kind === 'contact' ? { recordId: source.recordId } : {}) };
  }
  return { getSource, current, owns, describe, contactSource, physicalSource, dispose: () => cached.clear() };
}
