import { createTextEditState, createTextEditDocument, textEditWindowState, textEditDirty, validateTextEditState, validateTextEditPreferences, validateTextEditTypingMarks, textEditFields as fields, textEditIdentity as id, textEditInteger as integer, textEditData, textEditTextUnits, TEXTEDIT_LIMITS } from './textedit-state.js';
import { createTextEditContent, textEditPlainText, textEditHtml, replaceTextEditRange, formatTextEditRange, validateTextEditContent, TEXTEDIT_CONTENT_LIMITS } from './textedit-content.js';
import { encodeTextEditFile, decodeTextEditFile } from './textedit-codec.js';
import { createTextEditPdf } from './textedit-pdf.js';
import { createTextAssistance, applyTextSubstitutions } from './text-assistance.js';
import { getTextEditProfile } from './textedit-catalog.js';
import { copyCanonicalData } from './canonical-data.js';
import { noteFindExpression } from './text-find.js';
import { textEditNativeDifference } from './textedit-native.js';

const rejected = (code, message) => ({ status: 'rejected', error: { code, message } });
const invalid = () => rejected('invalid_arguments', 'Use the closed TextEdit target and payload.');
const stale = () => rejected('stale_target', 'The original document, window, selection, or view changed.');
const unavailable = () => rejected('unavailable', 'This real scene bridge or original native editor is unavailable.');
const applied = (windowId, more = {}) => ({ status: 'applied', target: { windowId, ...more }, ...more });
const optional = (value, key, test) => !Object.hasOwn(value, key) || test(value[key]);
const string = (value, max = 1024 * 1024) => typeof value === 'string' && value.length <= max;
const name = value => string(value, 255) && value.trim().length > 0 && !/[\x00-\x1f/\\]/.test(value) && !['.', '..'].includes(value);
const kind = value => ['plain', 'rich'].includes(value);
const encoding = value => ['utf-8', 'utf-16le', 'windows-1252'].includes(value);
const errorResult = error => rejected(error?.code ?? 'unsupported_content', error?.message ?? 'The document operation is not supported.');
const sheet = (kind, message = '', spelling = null) => ({ kind, message, spelling });

export function createTextEditController(ctx) {
  const assistance = ctx.assistance ?? createTextAssistance();
  const ignored = new Map(), managed = new Map(), closeRequested = new WeakSet();
  const state = () => ctx.getState();
  function owner(target, needsView = true) {
    if (!fields(target, ['windowId']) || !id(target.windowId) || !ctx.alive()) return null;
    const root = state(), model = root.windows.find(win => win.windowId === target.windowId), window = ctx.getWindow(target.windowId);
    const doc = model && root.documents.find(doc => doc.id === model.documentId), view = ctx.getView(target.windowId);
    if (!model || !doc || !window || managed.get(window.id) !== window || !ctx.available(window) || needsView && (!view || view.available?.() !== true)) return null;
    const generation = doc.generation, dialog = model.dialog, appId = window.appId;
    const guard = () => ctx.alive() && state() === root && ctx.getWindow(window.id) === window && managed.get(window.id) === window && window.appId === appId && root.windows.includes(model) && root.documents.includes(doc) && model.documentId === doc.id && model.dialog === dialog && doc.generation === generation && ctx.available(window) && (!needsView || ctx.getView(window.id) === view && view.available?.() === true);
    return { root, model, window, doc, view, guard, ownership: { guard, windowId: window.id } };
  }
  function commit(source, change) {
    if (!source.guard()) return stale();
    const candidate = copyCanonicalData(source.root);
    const doc = candidate.documents.find(doc => doc.id === source.doc.id), win = candidate.windows.find(win => win.windowId === source.window.id);
    try { change(candidate, doc, win); } catch (error) { return errorResult(error); }
    const validated = validateTextEditState(candidate);
    if (!validated.ok) return rejected('invalid_arguments', validated.message);
    const delta = textEditTextUnits(candidate) - textEditTextUnits(source.root);
    if (!ctx.canCommit(delta)) return rejected('limit_exceeded', 'The complete candidate exceeds the shared scene content budget.');
    if (!source.guard()) return stale();
    // Preserve canonical record identity; content/history are never shadow authorities.
    candidate.documents = candidate.documents.map(next => { const previous = source.root.documents.find(doc => doc.id === next.id); if (!previous) return next; Object.assign(previous, next); return previous; });
    candidate.windows = candidate.windows.map(next => { const previous = source.root.windows.find(win => win.windowId === next.windowId); if (!previous) return next; Object.assign(previous, next); return previous; });
    Object.assign(source.root, candidate); ctx.onChanged?.(); return null;
  }
  function mutate(source, content, selection = source.model.selection) {
    if (!textEditData(content)) return invalid();
    return commit(source, (_, doc, win) => {
      if (JSON.stringify(doc.content) === JSON.stringify(content)) { win.selection = { ...selection }; return; }
      doc.undo.push({ content: doc.content, contentRevision: doc.contentRevision, fileMime: doc.fileMime, encoding: doc.encoding }); if (doc.undo.length > TEXTEDIT_LIMITS.history) doc.undo.shift();
      doc.redo = []; doc.content = copyCanonicalData(content); doc.contentRevision = doc.nextContentRevision++; doc.generation++;
      const length = textEditPlainText(content).length; win.selection = { start: Math.min(selection.start, length), end: Math.min(selection.end, length) }; win.dialog = null;
    });
  }
  async function settleSelection(source, generation, range, { replaceView = false, appId = source.window.appId } = {}) {
    const current = () => ctx.alive() && state() === source.root && ctx.getWindow(source.window.id) === source.window && managed.get(source.window.id) === source.window && source.window.appId === appId && source.root.windows.includes(source.model) && source.root.documents.includes(source.doc) && source.model.documentId === source.doc.id && source.doc.generation === generation && ctx.available(source.window) && (replaceView || ctx.getView(source.window.id) === source.view && source.view.available?.() === true);
    if (!current()) return false;
    await ctx.tick();
    if (!current()) return false;
    const view = replaceView ? ctx.getView(source.window.id) : source.view;
    return view?.available?.() === true && view.selectRange?.(range) === true && current() && ctx.getView(source.window.id) === view && view.available?.() === true;
  }
  function selected(source) {
    const native = source.view.captureSelection?.({ allowUnfocused: true });
    if (!native || !integer(native.start) || !integer(native.end) || native.start > native.end || native.end > textEditPlainText(source.doc.content).length) return null;
    return { start: native.start, end: native.end };
  }
  function fileLease(source, fileId) {
    if (!ctx.getFile) return null;
    const file = ctx.getFile(fileId); if (!file) return null;
    const revision = file.revision;
    const guard = () => source.guard() && ctx.getFile(fileId) === file && file.revision === revision;
    return { file, revision, guard, ownership: { windowId: source.window.id, guard } };
  }
  function decodeForPreferences(root, read) {
    const mime = read.mime?.split(';')[0].toLowerCase();
    if (mime === 'text/html') {
      if (!root.preferences.displayHtmlAsCode) throw Object.assign(new Error('Formatted HTML import is outside the supported local plain/RTF subset; enable HTML source-code editing.'), { code: 'unsupported_file_type' });
      return { content: createTextEditContent(read.text, 'plain'), encoding: 'utf-8' };
    }
    if (['application/rtf', 'text/rtf'].includes(mime) && root.preferences.displayRtfAsCode) return { content: createTextEditContent(read.text, 'plain'), encoding: 'utf-8' };
    return decodeTextEditFile({ text: read.text, mime: read.mime });
  }
  async function openFile(fileId, ownership = {}) {
    if (!id(fileId) || !ctx.alive() || typeof ctx.getFile !== 'function' || typeof ctx.readFile !== 'function' || typeof ctx.createWindow !== 'function') return unavailable();
    const root = state(), fingerprint = JSON.stringify(root), original = ctx.getFile(fileId);
    if (!original) return stale();
    const fileFingerprint = JSON.stringify(original), collections = [root.documents, root.windows];
    const records = collections.map(rows => rows.slice());
    const readers = root.windows.map(model => {
      const document = root.documents.find(row => row.id === model.documentId), window = ctx.getWindow(model.windowId), view = ctx.getView(model.windowId);
      return { model, document, window, view, content: document?.content, appId: window?.appId, utilityKind: window?.utilityKind };
    }).filter(({ document, window, view }) => document && window && managed.get(window.id) === window && view && typeof view.available === 'function');
    const guard = () => ctx.alive() && state() === root && JSON.stringify(root) === fingerprint
      && collections.every((rows, index) => rows === (index === 0 ? root.documents : root.windows)
        && rows.length === records[index].length && rows.every((row, offset) => row === records[index][offset]))
      && ctx.getFile(fileId) === original && JSON.stringify(original) === fileFingerprint
      && (!ownership.guard || ownership.guard() === true);
    if (!guard()) return stale();
    try {
      const read = await ctx.readFile(fileId, { ...ownership, guard });
      if (!guard()) return stale();
      if (read?.status !== 'applied') return read ?? unavailable();
      if (read.file !== original || read.file.id !== fileId || read.file.revision !== original.revision) return stale();
      const decoded = decodeForPreferences(root, read);
      const references = [];
      for (const block of decoded.content.blocks) {
        if (block.type !== 'attachment') continue;
        const file = ctx.getFile(block.fileId);
        if (!file) return rejected('stale_target', 'This document references an attachment no longer present in canonical Files.');
        references.push({ file, fingerprint: JSON.stringify(file) });
        const result = await ctx.readFile(file.id, { ...ownership, guard });
        if (!guard() || result?.status !== 'applied' || result.file !== file) return stale();
      }
      const current = () => guard() && references.every(({ file, fingerprint }) => ctx.getFile(file.id) === file && JSON.stringify(file) === fingerprint);
      if (!current()) return stale();
      const native = getTextEditProfile(ctx.profile ?? ctx.getProfile?.());
      const appId = decoded.content.kind === 'plain' ? native.plainAppId : native.richAppId;
      const contentFingerprint = JSON.stringify(decoded.content);
      for (const reader of readers) {
        const { model, document, window, view } = reader;
        if (reader.appId !== appId || reader.utilityKind != null && reader.utilityKind !== 'textedit-document'
          || document.fileId !== fileId || document.fileRevision !== original.revision || document.fileMime !== read.mime
          || document.encoding !== decoded.encoding || document.title !== read.name || textEditDirty(document)
          || JSON.stringify(document.content) !== contentFingerprint) continue;
        const readerCurrent = () => current() && ctx.getWindow(model.windowId) === window && managed.get(window.id) === window
          && window.appId === reader.appId && window.utilityKind === reader.utilityKind && ctx.getView(window.id) === view
          && root.windows.find(row => row.windowId === window.id) === model
          && root.documents.find(row => row.id === document.id) === document && model.documentId === document.id
          && document.content === reader.content;
        if (!readerCurrent()) return stale();
        if (typeof ctx.focusWindow !== 'function') return unavailable();
        const focused = await ctx.focusWindow(window.id, { isCurrent: readerCurrent });
        if (!readerCurrent()) return stale();
        if (focused?.status === 'rejected') return focused;
        await ctx.tick();
        if (!readerCurrent() || ctx.available(window) !== true || view.available() !== true) return stale();
        return applied(window.id, { windowId: window.id, documentId: document.id, fileId, appId, presentationAvailable: true });
      }
      const file = { id: original.id, revision: original.revision, name: read.name, mime: read.mime };
      const created = await ctx.createWindow(appId, creationOptions({ root, guard: current }, decoded.content.kind,
        { textEditOpen: { content: decoded.content, encoding: decoded.encoding, file }, isCurrent: current }));
      const windowId = typeof created === 'string' ? created : created?.windowId ?? created?.target?.windowId;
      if (!id(windowId)) return created?.status === 'rejected' ? created : unavailable();
      const window = ctx.getWindow(windowId), session = state().windows.find(row => row.windowId === windowId);
      const document = session && state().documents.find(row => row.id === session.documentId);
      if (!window || !document || document.fileId !== fileId || document.fileRevision !== original.revision) return unavailable();
      await ctx.tick();
      return applied(windowId, { windowId, documentId: document.id, fileId, appId,
        presentationAvailable: ctx.alive() && ctx.getWindow(windowId) === window && state().documents.includes(document) && ctx.available(window) });
    } catch (error) { return errorResult(error); }
  }
  function creationOptions(source, documentKind, more = {}) {
    const preferences = source.root.preferences;
    return { kind: 'textedit-document', documentKind, width: Math.max(460, Math.min(1400, preferences.windowColumns * preferences.plainSize * .8 + 80)), height: Math.max(320, Math.min(1200, preferences.windowLines * preferences.plainSize * 1.7 + 100)), isCurrent: source.guard, ...more };
  }
  async function save(source, payload, saveAs = false) {
    if (!fields(payload, ['name', 'encoding'], []) || !optional(payload, 'name', name) || !optional(payload, 'encoding', encoding)) return invalid();
    if (typeof ctx.createFile !== 'function' || source.doc.fileId && typeof ctx.readFile !== 'function') return unavailable();
    if (!saveAs && !source.doc.fileId && !payload.name) { const result = commit(source, (_, __, win) => { win.dialog = sheet('save'); }); return result ?? applied(source.window.id, { confirmationRequired: true }); }
    const fileId = saveAs ? null : source.doc.fileId;
    const existingLease = fileId ? fileLease(source, fileId) : null;
    if (fileId) {
      if (!existingLease) return unavailable();
      const read = await ctx.readFile(fileId, existingLease.ownership);
      if (!existingLease.guard()) return stale(); if (read?.status !== 'applied') return read ?? unavailable();
      if (read.file?.id !== fileId || read.file.revision !== source.doc.fileRevision) return rejected('conflict', 'The exact shared file changed; use Save As to preserve both revisions.');
    }
    let encoded; try {
      encoded = encodeTextEditFile(source.doc.content, payload.encoding ?? source.doc.encoding);
      if (source.doc.content.kind === 'plain' && ['application/rtf', 'text/rtf', 'text/html'].includes(source.doc.fileMime.split(';')[0]) && (!saveAs || !payload.name?.toLowerCase().endsWith('.txt'))) {
        if (encoded.encoding !== 'utf-8') throw Object.assign(new Error('RTF/HTML source code saves require UTF-8 shared text.'), { code: 'unsupported_encoding' });
        encoded.mime = source.doc.fileMime;
      }
    } catch (error) { return errorResult(error); }
    if (existingLease) {
      const family = mime => ['application/rtf', 'text/rtf'].includes(mime.split(';')[0].toLowerCase()) ? 'rtf' : mime.split(';')[0].toLowerCase();
      if (family(existingLease.file.mime ?? 'text/plain') !== family(encoded.mime)) return commit(source, (_, __, win) => { win.dialog = sheet('save', 'The document format changed. Save a new file to preserve the original.'); }) ?? applied(source.window.id, { confirmationRequired: true });
    }
    let title = payload.name ?? source.doc.title;
    if (source.doc.content.kind === 'plain' && source.root.preferences.addTxtExtension && (payload.name || !fileId) && encoded.mime.startsWith('text/plain') && !title.toLowerCase().endsWith('.txt')) title += '.txt';
    if (!name(title)) return invalid();
    const revision = source.doc.contentRevision;
    const candidate = copyCanonicalData(source.root), projected = candidate.documents.find(doc => doc.id === source.doc.id);
    projected.title = title; projected.encoding = encoded.encoding; projected.fileMime = encoded.mime; projected.savedGeneration = revision;
    if (!ctx.canCommit(textEditTextUnits(candidate) - textEditTextUnits(source.root) + 256)) return rejected('limit_exceeded', 'There is not enough shared scene budget for the file ownership acknowledgement.');
    let acknowledged = false, committedId;
    const result = await ctx.createFile({ name: title, mime: encoded.mime, text: encoded.text, encoding: encoded.encoding, existingFileId: fileId ?? undefined, expectedRevision: fileId ? source.doc.fileRevision : undefined, source: { appId: source.window.appId, windowId: source.window.id, documentId: source.doc.id }, onCommit(actualFileId, file) {
      if (!id(actualFileId) || !source.guard() || fileId && actualFileId !== fileId || !file || file.id !== actualFileId || !(integer(file.revision) || string(file.revision, 128))) return false;
      const outcome = commit(source, (_, doc, win) => { doc.fileId = actualFileId; doc.fileRevision = file.revision; doc.fileMime = encoded.mime; doc.savedGeneration = revision; doc.title = title; doc.encoding = encoded.encoding; win.dialog = null; });
      if (outcome) return false; acknowledged = true; committedId = actualFileId; return true;
    } }, existingLease?.ownership ?? source.ownership);
    if (acknowledged) {
      if (closeRequested.has(source.window)) {
        const current = owner({ windowId: source.window.id });
        if (current) { const closed = await close(current); return { ...applied(source.window.id, { fileId: committedId, documentId: source.doc.id }), closed: closed.closed === true }; }
      }
      return applied(source.window.id, { fileId: committedId, documentId: source.doc.id });
    }
    if (!source.guard()) return stale();
    if (result?.status === 'applied') return rejected('unavailable', 'The file bridge did not atomically acknowledge exact ownership.');
    return result ?? unavailable();
  }
  async function close(source) {
    if (textEditDirty(source.doc)) { closeRequested.add(source.window); const result = commit(source, (_, __, win) => { win.dialog = sheet('close'); }); ctx.focusWindow(source.window.id); return result ?? applied(source.window.id, { confirmationRequired: true, closed: false }); }
    if (typeof ctx.closeWindow !== 'function') return unavailable();
    const result = await ctx.closeWindow(source.window.id, { isCurrent: source.guard });
    if (result?.status === 'rejected') return result;
    return ctx.getWindow(source.window.id) !== source.window ? applied(source.window.id, { closed: true }) : unavailable();
  }
  const handlers = {
    'textedit.new': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable();
      if (!fields(payload, ['kind'], []) || !optional(payload, 'kind', kind)) return invalid(); if (!ctx.createWindow) return unavailable();
      const documentKind = payload.kind ?? source.root.preferences.defaultKind, native = getTextEditProfile(ctx.profile ?? ctx.getProfile?.());
      const created = await ctx.createWindow(documentKind === 'plain' ? native.plainAppId : native.richAppId, creationOptions(source, documentKind));
      const windowId = typeof created === 'string' ? created : created?.windowId ?? created?.target?.windowId;
      if (!id(windowId)) return created?.status === 'rejected' ? created : unavailable();
      const actualWindow = ctx.getWindow(windowId), actualDocument = state().documents.find(doc => doc.id === state().windows.find(win => win.windowId === windowId)?.documentId);
      await ctx.tick(); const next = owner({ windowId }); return next && next.window === actualWindow && next.doc === actualDocument ? applied(windowId, { documentId: next.doc.id }) : unavailable();
    },
    'textedit.open': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable();
      if (!fields(payload, ['fileId']) || !id(payload.fileId)) return invalid();
      return openFile(payload.fileId, source.ownership);
    },
    'textedit.input': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable();
      if (!textEditData(payload) || !fields(payload, ['content', 'start', 'end', 'documentId', 'generation']) || !integer(payload.start) || !integer(payload.end) || payload.start > payload.end) return invalid();
      if (payload.documentId !== source.doc.id || payload.generation !== source.doc.generation) return stale();
      if (!validateTextEditContent(payload.content) || payload.end > textEditPlainText(payload.content).length) return invalid();
      for (const block of payload.content.blocks) {
        if (block.type !== 'attachment') continue;
        const original = source.doc.content.blocks.find(item => item.type === 'attachment' && item.id === block.id);
        if (!original || original.fileId !== block.fileId || original.name !== block.name || original.mime !== block.mime) return rejected('invalid_arguments', 'Insert or change canonical Files attachments through the actual attachment command.');
      }
      let content = payload.content, range = { start: payload.start, end: payload.end };
      if (content.kind !== source.doc.content.kind) return invalid();
      if (content.kind === 'rich' && source.model.typingMarks) {
        const difference = textEditNativeDifference(textEditPlainText(source.doc.content), textEditPlainText(content));
        try { if (difference.text.length) content = formatTextEditRange(content, difference.start, difference.start + difference.text.length, source.model.typingMarks); } catch (error) { return errorResult(error); }
      }
      if (source.root.preferences.smartQuotes || source.root.preferences.smartDashes || source.root.preferences.textReplacement || source.root.preferences.correctSpellingAutomatically) {
        const preferences = copyCanonicalData(source.root.preferences), words = [...source.root.personalWords];
        if (content.kind === 'plain' && preferences.richOnlyTypography) { preferences.smartQuotes = false; preferences.smartDashes = false; }
        if (content.kind === 'plain' && preferences.richOnlySpelling) preferences.correctSpellingAutomatically = false;
        const originalPreferences = JSON.stringify(source.root.preferences);
        let corrected; try { corrected = await assistance.correctInput(textEditPlainText(content), range.end, preferences, words); } catch { return rejected('unavailable', 'The bundled spelling dictionary could not be loaded.'); }
        if (!source.guard() || originalPreferences !== JSON.stringify(source.root.preferences) || JSON.stringify(words) !== JSON.stringify(source.root.personalWords)) return stale();
        if (corrected.changed) {
          const difference = textEditNativeDifference(textEditPlainText(content), corrected.text);
          try { content = replaceTextEditRange(content, difference.start, difference.end, difference.text); } catch (error) { return errorResult(error); }
          range = { start: corrected.cursor, end: corrected.cursor };
        }
      }
      const failure = mutate(source, content, range); if (failure) return failure;
      const selectionRevealed = await settleSelection(source, source.doc.generation, range);
      const current = owner(target); let spellingAvailable = true;
      if (current?.root.preferences.spellcheck && !(current.doc.content.kind === 'plain' && current.root.preferences.richOnlySpelling) && current.view.setSpelling) {
        const words = [...current.root.personalWords], skipped = [...(ignored.get(current.doc.id) ?? [])];
        try {
          const checked = await assistance.check(textEditPlainText(current.doc.content), { learnedWords: words, ignoredWords: skipped, maxIssues: 500, suggestions: false });
          if (current.guard() && current.root.preferences.spellcheck && JSON.stringify(words) === JSON.stringify(current.root.personalWords)) current.view.setSpelling(checked.issues);
        } catch { spellingAvailable = false; }
      } else current?.view.setSpelling?.([]);
      return applied(source.window.id, { documentId: source.doc.id, generation: source.doc.generation, selectionRevealed, spellingAvailable });
    },
    'textedit.selection': (target, payload) => {
      const source = owner(target); if (!source) return unavailable();
      if (!fields(payload, ['start', 'end', 'documentId', 'generation'], ['start', 'end']) || !integer(payload.start) || !integer(payload.end) || payload.start > payload.end || payload.end > textEditPlainText(source.doc.content).length) return invalid();
      if (payload.documentId !== undefined && payload.documentId !== source.doc.id || payload.generation !== undefined && payload.generation !== source.doc.generation) return stale();
      return commit(source, (_, __, win) => { if (win.selection.start !== payload.start || win.selection.end !== payload.end) win.typingMarks = null; win.selection = { start: payload.start, end: payload.end }; }) ?? applied(source.window.id);
    },
    'textedit.undo': (target, payload) => history(target, payload, 'undo'),
    'textedit.redo': (target, payload) => history(target, payload, 'redo'),
    'textedit.find': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable();
      if (!fields(payload, ['query', 'replacement', 'matchCase', 'direction', 'select'], ['query', 'replacement', 'matchCase', 'direction']) || !string(payload.query, 4096) || !string(payload.replacement, 4096) || typeof payload.matchCase !== 'boolean' || !['next', 'previous'].includes(payload.direction) || !optional(payload, 'select', value => typeof value === 'boolean')) return invalid();
      const text = textEditPlainText(source.doc.content), expression = noteFindExpression(payload.query, { caseSensitive: payload.matchCase });
      const range = selected(source) ?? source.model.selection, matches = expression ? Array.from(text.matchAll(expression), match => ({ start: match.index, end: match.index + match[0].length })) : [];
      const match = payload.direction === 'next' ? matches.find(item => item.start >= range.end) ?? matches[0] : matches.toReversed().find(item => item.end <= range.start) ?? matches.at(-1);
      const result = commit(source, (_, __, win) => { win.find = { query: payload.query, replacement: payload.replacement, matchCase: payload.matchCase, message: match ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'Not found' }; if (match && payload.select !== false) { win.selection = match; win.typingMarks = null; } }); if (result) return result;
      const selectionRevealed = match && payload.select !== false ? await settleSelection(source, source.doc.generation, match) : false;
      return applied(source.window.id, { count: matches.length, range: match ?? null, selectionRevealed });
    },
    'textedit.replace': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['all']) || typeof payload.all !== 'boolean') return invalid();
      const find = source.model.find, text = textEditPlainText(source.doc.content); if (!find.query) return invalid();
      const expression = noteFindExpression(find.query, { caseSensitive: find.matchCase }), ranges = [];
      if (payload.all) { for (const match of text.matchAll(expression)) ranges.push({ start: match.index, end: match.index + match[0].length }); }
      else { const range = selected(source) ?? source.model.selection; const match = noteFindExpression(find.query, { caseSensitive: find.matchCase }).exec(text.slice(range.start, range.end)); if (match?.index === 0 && match[0].length === range.end - range.start) ranges.push(range); }
      let content = source.doc.content; try { for (const range of ranges.toReversed()) content = replaceTextEditRange(content, range.start, range.end, find.replacement); } catch (error) { return errorResult(error); }
      const end = ranges.length ? ranges[0].start + find.replacement.length : source.model.selection.end;
      return mutate(source, content, { start: end, end }) ?? applied(source.window.id, { count: ranges.length });
    },
    'textedit.format': (target, payload) => formatting(target, payload),
    'textedit.convert': (target, payload) => convert(target, payload),
    'textedit.table': (target, payload) => table(target, payload),
    'textedit.link': (target, payload) => { if (!fields(payload, ['url']) || !string(payload.url, 2048) || payload.url && !/^jester:\/\//.test(payload.url)) return invalid(); const source = owner(target); if (!source) return unavailable(); if (source.doc.content.kind !== 'rich') return rejected('disabled', 'Links require rich text.'); const range = selected(source) ?? source.model.selection; try { return mutate(source, formatTextEditRange(source.doc.content, range.start, range.end, { link: payload.url }), range) ?? applied(source.window.id); } catch (error) { return errorResult(error); } },
    'textedit.attachment': async (target, payload) => attachment(target, payload),
    'textedit.save': (target, payload) => { const source = owner(target); return source ? save(source, payload) : unavailable(); },
    'textedit.saveAs': (target, payload) => { const source = owner(target); if (!fields(payload, ['name', 'encoding']) || !name(payload.name) || !encoding(payload.encoding)) return invalid(); return source ? save(source, payload, true) : unavailable(); },
    'textedit.close': (target, payload) => { const source = owner(target); if (!fields(payload, [])) return invalid(); return source ? close(source) : unavailable(); },
    'textedit.close.resolve': (target, payload) => resolveClose(target, payload),
    'textedit.dialog': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable();
      if (!fields(payload, ['kind']) || !['open', 'save', 'find', 'preferences', 'font', 'color', 'table', 'link', 'attachment', 'about', 'help', 'spelling', 'rename', 'move', 'goto', 'none'].includes(payload.kind)) return invalid();
      if (['open', 'attachment', 'move'].includes(payload.kind) && ctx.listFiles) { const files = await ctx.listFiles(source.ownership); if (!source.guard()) return stale(); source.view.setFiles?.(Array.isArray(files) ? files : files?.files ?? []); }
      return commit(source, (_, __, win) => { win.menu = null; win.dialog = payload.kind === 'none' ? null : sheet(payload.kind); }) ?? applied(source.window.id);
    },
    'textedit.menu': (target, payload) => { const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['menu']) || !(payload.menu === null || string(payload.menu, 32))) return invalid(); return commit(source, (_, __, win) => { win.menu = payload.menu; }) ?? applied(source.window.id); },
    'textedit.view': (target, payload) => { const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['wrap', 'showRuler', 'zoom'], []) || !optional(payload, 'wrap', value => typeof value === 'boolean') || !optional(payload, 'showRuler', value => typeof value === 'boolean') || !optional(payload, 'zoom', value => Number.isFinite(value) && value >= 25 && value <= 500)) return invalid(); return commit(source, (_, __, win) => { Object.assign(win, payload); }) ?? applied(source.window.id); },
    'textedit.preferences': (target, payload) => {
      const source = owner(target); if (!source) return unavailable();
      if (!textEditData(payload) || !fields(payload, [...Object.keys(source.root.preferences), 'restoreDefaults'], []) || !optional(payload, 'restoreDefaults', value => typeof value === 'boolean')) return invalid();
      const { restoreDefaults, ...patch } = payload, preferences = restoreDefaults ? createTextEditState(ctx.profile ?? ctx.getProfile?.()).preferences : { ...source.root.preferences, ...patch };
      if (!validateTextEditPreferences(preferences)) return invalid();
      const failed = commit(source, root => { root.preferences = preferences; }); if (failed) return failed;
      if (!preferences.spellcheck) for (const window of managed.values()) ctx.getView(window.id)?.setSpelling?.([]);
      return applied(source.window.id);
    },
    'textedit.spelling': async (target, payload) => spelling(target, payload),
    'textedit.substitute': (target, payload) => { const source = owner(target); if (!source) return unavailable(); if (!fields(payload, [])) return invalid(); const range = selected(source); if (!range) return unavailable(); const text = textEditPlainText(source.doc.content), replacement = applyTextSubstitutions(text.slice(range.start, range.end), source.root.preferences, source.root.preferences.replacements, { before: text.slice(0, range.start), after: text.slice(range.end) }); try { return mutate(source, replaceTextEditRange(source.doc.content, range.start, range.end, replacement), { start: range.start, end: range.start + replacement.length }) ?? applied(source.window.id); } catch (error) { return errorResult(error); } },
    'textedit.clipboard': async (target, payload) => clipboard(target, payload),
    'textedit.pdf': async (target, payload) => pdf(target, payload),
    'textedit.print': (target, payload) => documentBridge(target, payload, 'printDocument'),
    'textedit.share': (target, payload) => documentBridge(target, payload, 'share'),
    'textedit.reveal': async (target, payload) => { const source = owner(target); if (!fields(payload, [])) return invalid(); if (!source?.doc.fileId || !ctx.revealFile) return unavailable(); const result = await ctx.revealFile(source.doc.fileId, source.ownership); return result?.status === 'applied' ? result : source.guard() ? result ?? unavailable() : stale(); },
    'textedit.openLink': async (target, payload) => { const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['url']) || !string(payload.url, 2048) || !/^jester:\/\//.test(payload.url)) return invalid(); if (!ctx.openLocalLink) return unavailable(); const result = await ctx.openLocalLink(payload.url, source.ownership); return result?.status === 'applied' ? result : source.guard() ? result ?? unavailable() : stale(); },
    'textedit.window.focus': async (target, payload) => { const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['windowId']) || !id(payload.windowId)) return invalid(); const destination = owner({ windowId: payload.windowId }); if (!destination) return stale(); await ctx.focusWindow(payload.windowId); return destination.guard() ? applied(payload.windowId) : stale(); },
    'textedit.window.front': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable(); if (!fields(payload, [])) return invalid();
      const originals = [...managed.values()].filter(window => window.appId === source.window.appId && ctx.available(window));
      const ordered = [...originals.filter(window => window !== source.window), source.window];
      for (const window of ordered) {
        if (!source.guard() || ordered.some(original => ctx.getWindow(original.id) !== original || managed.get(original.id) !== original)) return stale();
        await ctx.focusWindow(window.id);
        if (!source.guard() || ctx.getWindow(window.id) !== window || managed.get(window.id) !== window) return stale();
      }
      return applied(source.window.id, { windowIds: ordered.map(window => window.id) });
    },
    'textedit.app.quit': async (target, payload) => { const source = owner(target); if (!fields(payload, [])) return invalid(); if (!source) return unavailable(); if (!appQuit()) return applied(source.window.id, { confirmationRequired: true }); for (const window of [...managed.values()]) { const current = owner({ windowId: window.id }); if (current) { const result = await close(current); if (result.status !== 'applied') return result; } } return applied(source.window.id, { closed: true }); },
    'textedit.duplicate': (target, payload) => duplicate(target, payload),
    'textedit.rename': (target, payload) => fileMetadata(target, payload, 'rename'),
    'textedit.move': (target, payload) => fileMetadata(target, payload, 'move'),
    'textedit.revert': (target, payload) => revert(target, payload),
    'textedit.delete': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable(); if (!fields(payload, [])) return invalid();
      const range = selected(source) ?? source.model.selection, text = textEditPlainText(source.doc.content);
      const end = range.start === range.end ? Math.min(text.length, range.end + (text.codePointAt(range.end) > 0xffff ? 2 : 1)) : range.end;
      try { const selection = { start: range.start, end: range.start }, failed = mutate(source, replaceTextEditRange(source.doc.content, range.start, end, ''), selection); if (failed) return failed; return applied(source.window.id, { selectionRevealed: await settleSelection(source, source.doc.generation, selection) }); } catch (error) { return errorResult(error); }
    },
    'textedit.goto': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable();
      if (!fields(payload, ['line', 'column'], ['line']) || !integer(payload.line) || !payload.line || !optional(payload, 'column', value => integer(value) && value > 0)) return invalid();
      const lines = textEditPlainText(source.doc.content).split('\n'), line = payload.line - 1, column = (payload.column ?? 1) - 1;
      if (line >= lines.length || column > lines[line].length) return rejected('invalid_arguments', 'The specified line or column is outside this document.');
      const start = lines.slice(0, line).reduce((offset, line) => offset + line.length + 1, 0) + column, range = { start, end: start };
      const failed = commit(source, (_, __, win) => { win.selection = range; win.dialog = null; win.typingMarks = null; }); if (failed) return failed;
      return applied(source.window.id, { range, selectionRevealed: await settleSelection(source, source.doc.generation, range) });
    },
    'textedit.timeDate': async (target, payload) => {
      const source = owner(target); if (!source) return unavailable(); if (!fields(payload, [])) return invalid();
      const epoch = ctx.getSceneTime(); if (!Number.isFinite(epoch) || Math.abs(epoch) > 8640000000000000) return unavailable();
      const date = new Date(epoch), two = value => String(value).padStart(2, '0');
      const text = `${two(date.getUTCHours())}:${two(date.getUTCMinutes())} ${two(date.getUTCMonth() + 1)}/${two(date.getUTCDate())}/${date.getUTCFullYear()}`;
      const range = selected(source) ?? source.model.selection;
      try { const selection = { start: range.start + text.length, end: range.start + text.length }, failed = mutate(source, replaceTextEditRange(source.doc.content, range.start, range.end, text), selection); if (failed) return failed; return applied(source.window.id, { timeZone: 'UTC', text, selectionRevealed: await settleSelection(source, source.doc.generation, selection) }); } catch (error) { return errorResult(error); }
    },
  };
  async function duplicate(target, payload) {
    const source = owner(target); if (!source) return unavailable();
    if (!fields(payload, [])) return invalid(); if (!ctx.createWindow) return unavailable();
    const native = getTextEditProfile(ctx.profile ?? ctx.getProfile?.()), documentKind = source.doc.content.kind;
    const title = `${source.doc.title.replace(/\.(txt|rtf)$/i, '')} copy`.slice(0, 255);
    const created = await ctx.createWindow(documentKind === 'plain' ? native.plainAppId : native.richAppId, creationOptions(source, documentKind, { textEditDuplicate: { content: copyCanonicalData(source.doc.content), title } }));
    const windowId = typeof created === 'string' ? created : created?.windowId ?? created?.target?.windowId;
    if (!id(windowId)) return created?.status === 'rejected' ? created : unavailable();
    const window = ctx.getWindow(windowId), doc = state().documents.find(doc => doc.id === state().windows.find(win => win.windowId === windowId)?.documentId);
    await ctx.tick();
    const next = owner({ windowId }); return next && next.window === window && next.doc === doc ? applied(windowId, { documentId: doc.id }) : unavailable();
  }
  async function fileMetadata(target, payload, action) {
    const source = owner(target); if (!source) return unavailable();
    if (action === 'rename' ? !fields(payload, ['name']) || !name(payload.name) : !fields(payload, ['folderId']) || !id(payload.folderId)) return invalid();
    if (!source.doc.fileId && action === 'rename') return commit(source, (_, doc, win) => { doc.title = payload.name; win.dialog = null; }) ?? applied(source.window.id);
    const bridge = action === 'rename' ? ctx.renameFile : ctx.moveFile;
    if (!source.doc.fileId || typeof bridge !== 'function') return unavailable();
    const lease = fileLease(source, source.doc.fileId), destinationLease = action === 'move' ? fileLease(source, payload.folderId) : null;
    if (!lease || action === 'move' && !destinationLease) return unavailable();
    const ownership = { windowId: source.window.id, guard: () => lease.guard() && (!destinationLease || destinationLease.guard()) };
    let acknowledged = false, actualFile;
    const result = await bridge({ fileId: source.doc.fileId, expectedRevision: source.doc.fileRevision, ...payload, onCommit(file) {
      if (!source.guard() || file?.id !== source.doc.fileId || !name(file.name) || !(integer(file.revision) || string(file.revision, 128))) return false;
      const failed = commit(source, (_, doc, win) => { doc.title = file.name; doc.fileRevision = file.revision; win.dialog = null; });
      if (failed) return false; acknowledged = true; actualFile = file.id; return true;
    } }, ownership);
    return acknowledged ? applied(source.window.id, { fileId: actualFile }) : source.guard() ? result?.status === 'rejected' ? result : unavailable() : stale();
  }
  async function revert(target, payload) {
    const source = owner(target); if (!source) return unavailable();
    if (!fields(payload, ['confirmed']) || typeof payload.confirmed !== 'boolean') return invalid();
    if (!source.doc.fileId || !ctx.readFile) return unavailable();
    if (!payload.confirmed) return commit(source, (_, __, win) => { win.dialog = sheet('revert', 'Replace this buffer with the current shared file revision? This can be undone.'); }) ?? applied(source.window.id, { confirmationRequired: true });
    const lease = fileLease(source, source.doc.fileId); if (!lease) return unavailable();
    const read = await ctx.readFile(source.doc.fileId, lease.ownership); if (!lease.guard()) return stale();
    if (read?.status !== 'applied' || read.file?.id !== source.doc.fileId || read.file.revision !== lease.revision) return read?.status === 'rejected' ? read : unavailable();
    const leases = [lease];
    let decoded;
    try { decoded = source.doc.content.kind === 'plain' && ['application/rtf', 'text/rtf', 'text/html'].includes(source.doc.fileMime.split(';')[0]) ? { content: createTextEditContent(read.text, 'plain'), encoding: 'utf-8' } : decodeForPreferences(source.root, read); } catch (error) { return errorResult(error); }
    for (const block of decoded.content.blocks) {
      if (block.type !== 'attachment') continue;
      const attachedLease = fileLease(source, block.fileId); if (!attachedLease) return rejected('stale_target', 'A reverted attachment is not present in canonical Files.');
      const attachment = await ctx.readFile(block.fileId, attachedLease.ownership); if (!leases.every(lease => lease.guard()) || !attachedLease.guard()) return stale();
      if (attachment?.status !== 'applied' || attachment.file?.id !== block.fileId || attachment.file.revision !== attachedLease.revision) return rejected('stale_target', 'A reverted attachment is not present in canonical Files.');
      leases.push(attachedLease);
    }
    const perform = () => {
      if (!leases.every(lease => lease.guard())) return stale();
      const failed = mutate(source, decoded.content, { start: 0, end: 0 }); if (failed) return failed;
      const current = owner(target); if (!current) return applied(source.window.id);
      return commit(current, (_, doc, win) => { doc.fileRevision = read.file.revision; doc.fileMime = read.mime; doc.title = read.file.name; doc.encoding = decoded.encoding; doc.savedGeneration = doc.contentRevision; win.typingMarks = null; }) ?? applied(source.window.id, { fileId: read.file.id });
    };
    const native = getTextEditProfile(ctx.profile ?? ctx.getProfile?.());
    if (native.family !== 'windows' || decoded.content.kind === source.doc.content.kind) return perform();
    if (!ctx.setWindowAppId) return unavailable(); let acknowledged = false;
    const result = await ctx.setWindowAppId(decoded.content.kind === 'plain' ? native.plainAppId : native.richAppId, { windowId: source.window.id, guard: () => leases.every(lease => lease.guard()), onCommit() { if (!leases.every(lease => lease.guard())) return false; acknowledged = perform().status === 'applied'; return acknowledged; } });
    return acknowledged ? applied(source.window.id, { fileId: read.file.id }) : source.guard() ? result?.status === 'rejected' ? result : unavailable() : stale();
  }
  function formatting(target, payload) {
    const source = owner(target); if (!source) return unavailable();
    if (!textEditData(payload) || !fields(payload, ['bold', 'italic', 'underline', 'strike', 'font', 'size', 'color', 'align', 'spacing', 'indent', 'list', 'tabs'], [])) return invalid();
    if (source.doc.content.kind !== 'rich') return rejected('disabled', 'Convert to rich text before applying formatting.');
    const range = selected(source) ?? source.model.selection;
    try {
      const content = formatTextEditRange(source.doc.content, range.start, range.end, payload);
      if (range.start !== range.end) return mutate(source, content, range) ?? applied(source.window.id);
      const markKeys = ['bold', 'italic', 'underline', 'strike', 'font', 'size', 'color'];
      const patch = Object.fromEntries(Object.entries(payload).filter(([key]) => markKeys.includes(key)));
      let position = 0, currentMarks = createTextEditContent('', 'rich').blocks[0].runs[0].marks;
      for (const block of source.doc.content.blocks) {
        const groups = block.type === 'paragraph' ? [block.runs] : block.type === 'table' ? block.rows.flat().map(cell => cell.runs) : [];
        for (const runs of groups) { for (const run of runs) { if (range.start >= position && range.start <= position + run.text.length) currentMarks = run.marks; position += run.text.length; } position++; }
        if (block.type === 'attachment') position += 2;
      }
      const typingMarks = Object.keys(patch).length ? { ...(source.model.typingMarks ?? currentMarks), ...patch } : source.model.typingMarks;
      if (!validateTextEditTypingMarks(typingMarks)) return invalid();
      const result = mutate(source, content, range); if (result) return result;
      const current = owner(target); if (!current) return applied(source.window.id);
      return commit(current, (_, __, win) => { win.typingMarks = typingMarks; }) ?? applied(source.window.id);
    } catch (error) { return errorResult(error); }
  }
  async function convert(target, payload) {
    const source = owner(target); if (!source) return unavailable();
    if (!fields(payload, ['kind', 'confirmed']) || !kind(payload.kind) || typeof payload.confirmed !== 'boolean') return invalid();
    if (source.doc.content.kind === payload.kind) return applied(source.window.id);
    if (payload.kind === 'plain' && !payload.confirmed) return commit(source, (_, __, win) => { win.dialog = sheet('convert', 'Converting to plain text removes formatting, tables, and attachments.'); }) ?? applied(source.window.id, { confirmationRequired: true });
    const content = payload.kind === 'plain' ? createTextEditContent(textEditPlainText(source.doc.content), 'plain') : { ...copyCanonicalData(source.doc.content), kind: 'rich' };
    if (payload.kind === 'rich') for (const block of content.blocks) if (block.type === 'paragraph') for (const run of block.runs) Object.assign(run.marks, { font: source.root.preferences.plainFont, size: source.root.preferences.plainSize });
    const native = getTextEditProfile(ctx.profile ?? ctx.getProfile?.());
    const perform = () => {
      const result = mutate(source, content); if (result) return result;
      const current = owner(target); if (!current) return applied(source.window.id);
      return commit(current, (_, doc, win) => { doc.encoding = payload.kind === 'rich' ? 'utf-8' : doc.encoding; doc.fileMime = payload.kind === 'rich' ? 'application/rtf' : 'text/plain'; win.typingMarks = null; }) ?? applied(source.window.id);
    };
    if (native.family !== 'windows') { const result = perform(); if (result.status !== 'applied') return result; return applied(source.window.id, { selectionRevealed: await settleSelection(source, source.doc.generation, source.model.selection, { replaceView: true }) }); }
    if (!ctx.setWindowAppId) return unavailable();
    let acknowledged = false;
    const result = await ctx.setWindowAppId(payload.kind === 'plain' ? native.plainAppId : native.richAppId, { ...source.ownership, onCommit() { if (!source.guard()) return false; const changed = perform(); acknowledged = changed.status === 'applied'; return acknowledged; } });
    if (!acknowledged) return source.guard() ? result?.status === 'rejected' ? result : unavailable() : stale();
    const appId = payload.kind === 'plain' ? native.plainAppId : native.richAppId;
    return applied(source.window.id, { appId, selectionRevealed: await settleSelection(source, source.doc.generation, source.model.selection, { replaceView: true, appId }) });
  }
  async function resolveClose(target, payload) {
    const source = owner(target); if (!source) return unavailable();
    if (!fields(payload, ['action', 'name'], ['action']) || !['save', 'discard', 'cancel'].includes(payload.action) || !optional(payload, 'name', name)) return invalid();
    if (source.model.dialog?.kind !== 'close') return stale();
    if (payload.action === 'cancel') { closeRequested.delete(source.window); return commit(source, (_, __, win) => { win.dialog = null; }) ?? applied(source.window.id, { closed: false }); }
    if (payload.action === 'save') return save(source, payload.name ? { name: payload.name } : {});
    const baseline = source.doc.undo.find(entry => entry.contentRevision === source.doc.savedGeneration);
    let content = baseline?.content, fileMime = baseline?.fileMime ?? source.doc.fileMime, restoredEncoding = baseline?.encoding ?? source.doc.encoding;
    let fileRevision = source.doc.fileRevision;
    if (!content && source.doc.fileId) {
      if (!ctx.readFile) return unavailable();
      const lease = fileLease(source, source.doc.fileId); if (!lease) return unavailable();
      const read = await ctx.readFile(source.doc.fileId, lease.ownership); if (!lease.guard()) return stale();
      if (read?.status !== 'applied' || read.file?.id !== source.doc.fileId || read.file.revision !== lease.revision) return read?.status === 'rejected' ? read : unavailable();
      try { const decoded = source.doc.content.kind === 'plain' && ['application/rtf', 'text/rtf', 'text/html'].includes(source.doc.fileMime.split(';')[0]) ? { content: createTextEditContent(read.text, 'plain'), encoding: 'utf-8' } : decodeForPreferences(source.root, read); content = decoded.content; restoredEncoding = decoded.encoding; fileMime = read.mime; fileRevision = read.file.revision; } catch (error) { return errorResult(error); }
    }
    content ??= createTextEditContent('', source.doc.content.kind);
    const failed = mutate(source, content, { start: 0, end: 0 }); if (failed) return failed;
    const current = owner(target); if (!current) return applied(source.window.id);
    const reset = commit(current, (_, doc, win) => { doc.savedGeneration = doc.contentRevision; doc.fileRevision = fileRevision; doc.fileMime = fileMime; doc.encoding = restoredEncoding; win.dialog = null; win.typingMarks = null; }); if (reset) return reset;
    const final = owner(target); return final ? close(final) : applied(source.window.id);
  }
  async function history(target, payload, direction) {
    const source = owner(target); if (!source) return unavailable(); if (!fields(payload, [])) return invalid(); if (!source.doc[direction].length) return rejected('disabled', `Nothing to ${direction}.`);
    const restoredKind = source.doc[direction].at(-1).content.kind, kindChanged = restoredKind !== source.doc.content.kind, native = getTextEditProfile(ctx.profile ?? ctx.getProfile?.());
    const perform = () => commit(source, (_, doc, win) => {
      const restored = doc[direction].pop(), other = direction === 'undo' ? 'redo' : 'undo';
      doc[other].push({ content: doc.content, contentRevision: doc.contentRevision, fileMime: doc.fileMime, encoding: doc.encoding }); if (doc[other].length > TEXTEDIT_LIMITS.history) doc[other].shift();
      doc.content = restored.content; doc.contentRevision = restored.contentRevision; doc.fileMime = restored.fileMime; doc.encoding = restored.encoding; doc.generation++;
      const length = textEditPlainText(doc.content).length; win.selection = { start: Math.min(win.selection.start, length), end: Math.min(win.selection.end, length) }; win.dialog = null; win.typingMarks = null;
    });
    let appId = source.window.appId;
    if (kindChanged && native.family === 'windows') {
      if (!ctx.setWindowAppId) return unavailable(); appId = restoredKind === 'plain' ? native.plainAppId : native.richAppId; let acknowledged = false;
      const result = await ctx.setWindowAppId(appId, { ...source.ownership, onCommit() { if (!source.guard()) return false; acknowledged = !perform(); return acknowledged; } });
      if (!acknowledged) return source.guard() ? result?.status === 'rejected' ? result : unavailable() : stale();
    } else { const failed = perform(); if (failed) return failed; }
    return applied(source.window.id, { selectionRevealed: await settleSelection(source, source.doc.generation, source.model.selection, { replaceView: kindChanged, appId }) });
  }
  function table(target, payload) {
    const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['action', 'blockId', 'row', 'column', 'rows', 'columns'], ['action']) || !['insert', 'add-row', 'add-column', 'delete-row', 'delete-column', 'delete'].includes(payload.action) || !optional(payload, 'blockId', id) || !['row', 'column', 'rows', 'columns'].every(key => optional(payload, key, value => integer(value) && value <= (key === 'row' || key === 'rows' ? TEXTEDIT_CONTENT_LIMITS.tableRows : TEXTEDIT_CONTENT_LIMITS.tableColumns)))) return invalid(); if (source.doc.content.kind !== 'rich') return rejected('disabled', 'Tables require rich text.');
    const content = copyCanonicalData(source.doc.content), cell = () => ({ runs: createTextEditContent('', 'rich').blocks[0].runs });
    if (payload.action === 'insert') { const rows = payload.rows ?? 2, columns = payload.columns ?? 2; if (!rows || !columns) return invalid(); let n = 1; while (content.blocks.some(block => block.id === `table-${n}`)) n++; content.blocks.push({ id: `table-${n}`, type: 'table', rows: Array.from({ length: rows }, () => Array.from({ length: columns }, cell)) }); }
    else { const block = content.blocks.find(block => block.id === payload.blockId && block.type === 'table'); if (!block) return stale(); const row = payload.row ?? 0, column = payload.column ?? 0; if (row >= block.rows.length || column >= block.rows[0].length) return invalid(); if (payload.action === 'delete') content.blocks.splice(content.blocks.indexOf(block), 1); if (payload.action === 'add-row') { if (block.rows.length >= TEXTEDIT_CONTENT_LIMITS.tableRows) return rejected('limit_exceeded', 'Maximum table rows reached.'); block.rows.splice(row + 1, 0, Array.from({ length: block.rows[0].length }, cell)); } if (payload.action === 'add-column') { if (block.rows[0].length >= TEXTEDIT_CONTENT_LIMITS.tableColumns) return rejected('limit_exceeded', 'Maximum table columns reached.'); for (const cells of block.rows) cells.splice(column + 1, 0, cell()); } if (payload.action === 'delete-row') { if (block.rows.length === 1) content.blocks.splice(content.blocks.indexOf(block), 1); else block.rows.splice(row, 1); } if (payload.action === 'delete-column') { if (block.rows[0].length === 1) content.blocks.splice(content.blocks.indexOf(block), 1); else for (const cells of block.rows) cells.splice(column, 1); } }
    if (!content.blocks.length) content.blocks = createTextEditContent('', 'rich').blocks;
    return mutate(source, content) ?? applied(source.window.id);
  }
  async function attachment(target, payload) {
    const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['action', 'fileId', 'blockId'], []) || !optional(payload, 'action', value => ['insert', 'remove', 'open'].includes(value)) || !optional(payload, 'fileId', id) || !optional(payload, 'blockId', id)) return invalid();
    const action = payload.action ?? 'insert';
    if (action === 'remove') { const content = copyCanonicalData(source.doc.content), index = content.blocks.findIndex(block => block.type === 'attachment' && block.id === payload.blockId); if (index < 0) return stale(); content.blocks.splice(index, 1); if (!content.blocks.length) content.blocks = createTextEditContent('', content.kind).blocks; return mutate(source, content) ?? applied(source.window.id); }
    if (action === 'open') { const block = source.doc.content.blocks.find(block => block.type === 'attachment' && block.id === payload.blockId); if (!block || !ctx.openFile) return unavailable(); const lease = fileLease(source, block.fileId); if (!lease) return stale(); const result = await ctx.openFile(block.fileId, null, lease.ownership); return result?.status === 'applied' ? result : lease.guard() ? result ?? unavailable() : stale(); }
    if (!payload.fileId || !ctx.readFile || source.doc.content.kind !== 'rich') return unavailable();
    const lease = fileLease(source, payload.fileId); if (!lease) return stale();
    const result = await ctx.readFile(payload.fileId, lease.ownership); if (!lease.guard()) return stale(); if (result?.status !== 'applied') return result ?? unavailable(); if (result.file?.id !== payload.fileId || result.file.revision !== lease.revision) return stale();
    const content = copyCanonicalData(source.doc.content); let n = 1; while (content.blocks.some(block => block.id === `attachment-${n}`)) n++;
    content.blocks.push({ id: `attachment-${n}`, type: 'attachment', fileId: payload.fileId, name: result.file.name, mime: result.mime }); return mutate(source, content) ?? applied(source.window.id, { fileId: payload.fileId });
  }
  async function spelling(target, payload) {
    const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['action', 'word', 'replacement'], ['action']) || !['check', 'replace', 'ignore', 'learn'].includes(payload.action) || !optional(payload, 'word', value => string(value, 128)) || !optional(payload, 'replacement', value => string(value, 128))) return invalid();
    if (payload.action === 'check') {
      const words = [...source.root.personalWords], skipped = [...(ignored.get(source.doc.id) ?? [])], from = source.model.selection.end;
      let result; try { result = await assistance.check(textEditPlainText(source.doc.content), { learnedWords: words, ignoredWords: skipped, from, maxIssues: 1 }); } catch { return rejected('unavailable', 'The bundled nspell English dictionary could not be loaded.'); }
      if (!source.guard() || JSON.stringify(words) !== JSON.stringify(source.root.personalWords) || JSON.stringify(skipped) !== JSON.stringify(ignored.get(source.doc.id) ?? [])) return stale();
      const issue = result.issues[0] ?? null;
      const failure = commit(source, (_, __, win) => { win.dialog = sheet('spelling', issue ? '' : 'No further English spelling issues.', issue ? { word: issue.word, start: issue.start, end: issue.end, suggestions: issue.suggestions, generation: source.doc.generation } : null); if (issue) win.selection = { start: issue.start, end: issue.end }; });
      if (failure) return failure;
      const selectionRevealed = issue ? await settleSelection(source, source.doc.generation, { start: issue.start, end: issue.end }) : false;
      return applied(source.window.id, { issue, selectionRevealed });
    }
    const issue = source.model.dialog?.kind === 'spelling' && source.model.dialog.spelling; if (!issue || issue.generation !== source.doc.generation || textEditPlainText(source.doc.content).slice(issue.start, issue.end) !== issue.word || payload.word !== undefined && payload.word !== issue.word) return stale();
    if (payload.action === 'replace') { if (payload.replacement === undefined) return invalid(); try { return mutate(source, replaceTextEditRange(source.doc.content, issue.start, issue.end, payload.replacement), { start: issue.start + payload.replacement.length, end: issue.start + payload.replacement.length }) ?? applied(source.window.id); } catch (error) { return errorResult(error); } }
    if (payload.action === 'learn') return commit(source, root => { if (!root.personalWords.includes(issue.word)) root.personalWords.push(issue.word); }) ?? applied(source.window.id);
    const words = ignored.get(source.doc.id) ?? []; if (words.length >= TEXTEDIT_LIMITS.words) return rejected('limit_exceeded', 'Maximum ignored word count reached.'); ignored.set(source.doc.id, [...words, issue.word]); return applied(source.window.id);
  }
  async function clipboard(target, payload) {
    const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['action']) || !['copy', 'cut', 'paste', 'select-all'].includes(payload.action)) return invalid(); const range = selected(source) ?? source.model.selection;
    if (payload.action === 'select-all') { const next = { start: 0, end: textEditPlainText(source.doc.content).length }; if (!source.view.selectRange(next)) return unavailable(); return commit(source, (_, __, win) => { win.selection = next; }) ?? applied(source.window.id); }
    if (payload.action === 'paste') {
      if (!ctx.getClipboard) return unavailable();
      const clipboard = await ctx.getClipboard(source.ownership); if (!source.guard()) return stale();
      const current = selected(source) ?? source.model.selection; if (current.start !== range.start || current.end !== range.end) return stale();
      const record = clipboard?.clipboard ?? clipboard; if (!record || record.kind !== 'text' || !string(record.text)) return rejected('unsupported_content', 'Only actual scene text clipboard content can be pasted here.');
      try {
        let text = record.text;
        if (source.root.preferences.smartCopyPaste && text) {
          const documentText = textEditPlainText(source.doc.content), word = /[\p{L}\p{M}\p{N}]/u;
          if (word.test(documentText.slice(0, range.start).at(-1) ?? '') && word.test(text[0])) text = ` ${text}`;
          if (word.test(text.at(-1)) && word.test(documentText.slice(range.end)[0] ?? '')) text += ' ';
        }
        const end = range.start + text.length, selection = { start: end, end };
        let content = replaceTextEditRange(source.doc.content, range.start, range.end, text);
        if (content.kind === 'rich' && source.model.typingMarks && text.length) content = formatTextEditRange(content, range.start, end, source.model.typingMarks);
        const failed = mutate(source, content, selection); if (failed) return failed;
        return applied(source.window.id, { selectionRevealed: await settleSelection(source, source.doc.generation, selection) });
      } catch (error) { return errorResult(error); }
    }
    if (!ctx.setClipboard) return unavailable(); const text = textEditPlainText(source.doc.content).slice(range.start, range.end);
    if (payload.action === 'copy') { const result = await ctx.setClipboard({ kind: 'text', text, fileIds: [] }, source.ownership); return result?.status === 'applied' ? result : source.guard() ? result ?? unavailable() : stale(); }
    let content; try {
      const documentText = textEditPlainText(source.doc.content);
      const smartEnd = source.root.preferences.smartCopyPaste && /\s/u.test(documentText[range.start - 1] ?? '') && /\s/u.test(documentText[range.end] ?? '') ? range.end + 1 : range.end;
      content = replaceTextEditRange(source.doc.content, range.start, smartEnd, '');
    } catch (error) { return errorResult(error); }
    let acknowledged = false;
    const result = await ctx.setClipboard({ kind: 'text', text, fileIds: [], onCommit() { if (!source.guard()) return false; const current = selected(source) ?? source.model.selection; if (current.start !== range.start || current.end !== range.end) return false; const failure = mutate(source, content, { start: range.start, end: range.start }); acknowledged = !failure; return acknowledged; } }, source.ownership);
    return acknowledged ? applied(source.window.id, { selectionRevealed: await settleSelection(source, source.doc.generation, { start: range.start, end: range.start }) }) : source.guard() ? result?.status === 'rejected' ? result : unavailable() : stale();
  }
  async function pdf(target, payload) {
    const source = owner(target); if (!source) return unavailable(); if (!fields(payload, ['name'], []) || !optional(payload, 'name', name)) return invalid(); if (!ctx.createFile) return unavailable(); let result;
    try { result = await createTextEditPdf(copyCanonicalData(source.doc.content), ctx.getSceneTime()); } catch (error) { return errorResult(error); }
    if (!source.guard()) return stale(); const created = await ctx.createFile({ name: payload.name ?? `${source.doc.title.replace(/\.(txt|rtf)$/i, '')}.pdf`, mime: 'application/pdf', text: `data:application/pdf;base64,${result.base64}`, source: { appId: source.window.appId, windowId: source.window.id, documentId: source.doc.id } }, source.ownership);
    return created?.status === 'applied' && id(created.fileId ?? created.target?.fileId) ? { ...created, pageCount: result.pageCount } : source.guard() ? created?.status === 'rejected' ? created : unavailable() : stale();
  }
  async function documentBridge(target, payload, bridge) {
    const source = owner(target); if (!source) return unavailable(); if (!fields(payload, [])) return invalid(); if (!ctx[bridge]) return unavailable();
    const result = await ctx[bridge]({ appId: source.window.appId, documentId: source.doc.id, title: source.doc.title, text: textEditPlainText(source.doc.content), html: textEditHtml(source.doc.content), mime: source.doc.content.kind === 'rich' ? 'text/html' : 'text/plain' }, source.ownership);
    const identity = bridge === 'printDocument' ? result?.printDialogId ?? result?.jobId ?? result?.target?.printDialogId : result?.shareId ?? result?.target?.shareId;
    return result?.status === 'applied' && id(identity) ? result : source.guard() ? result?.status === 'rejected' ? result : unavailable() : stale();
  }
  function windowOpened(window, options = {}) {
    if (!window || !id(window.id) || !ctx.alive() || ctx.getWindow(window.id) !== window || options.isCurrent && options.isCurrent() !== true) return false;
    const root = state(); if (root.windows.some(item => item.windowId === window.id)) { managed.set(window.id, window); return true; }
    if (root.windows.length >= TEXTEDIT_LIMITS.windows || root.documents.length >= TEXTEDIT_LIMITS.documents) return false;
    const candidate = copyCanonicalData(root), requested = options.documentId && candidate.documents.find(doc => doc.id === options.documentId);
    const doc = requested ?? createTextEditDocument(`textedit-document-${candidate.nextDocumentId++}`, candidate.preferences, options.documentKind ?? (window.appId === 'notepad' ? 'plain' : window.appId === 'wordpad' ? 'rich' : candidate.preferences.defaultKind));
    if (options.textEditOpen) { const opened = options.textEditOpen; doc.content = copyCanonicalData(opened.content); doc.encoding = opened.encoding; doc.fileId = opened.file.id; doc.fileRevision = opened.file.revision; doc.fileMime = opened.file.mime; doc.title = opened.file.name; }
    if (options.textEditDuplicate) { doc.content = copyCanonicalData(options.textEditDuplicate.content); doc.title = options.textEditDuplicate.title; doc.contentRevision = 1; doc.nextContentRevision = 2; }
    if (!requested) candidate.documents.push(doc); candidate.windows.push(textEditWindowState(window.id, doc.id, candidate.preferences));
    if (!validateTextEditState(candidate).ok || !ctx.canCommit(textEditTextUnits(candidate) - textEditTextUnits(root))) return false;
    candidate.documents = candidate.documents.map(next => root.documents.find(doc => doc.id === next.id) ?? next);
    candidate.windows = candidate.windows.map(next => root.windows.find(win => win.windowId === next.windowId) ?? next);
    if (options.isCurrent && options.isCurrent() !== true) return false;
    Object.assign(root, candidate); managed.set(window.id, window); ctx.onChanged?.(); return true;
  }
  function windowClosed(window) {
    if (managed.get(window.id) !== window) return true;
    const root = state(), model = root.windows.find(item => item.windowId === window.id), doc = model && root.documents.find(doc => doc.id === model.documentId);
    if (doc && textEditDirty(doc)) { closeRequested.add(window); model.dialog = sheet('close'); ctx.focusWindow(window.id); ctx.onChanged?.(); return false; }
    root.windows = root.windows.filter(item => item.windowId !== window.id); managed.delete(window.id); ctx.onChanged?.(); return true;
  }
  function appQuit() {
    for (const window of managed.values()) { const root = state(), model = root.windows.find(item => item.windowId === window.id), doc = model && root.documents.find(doc => doc.id === model.documentId); if (doc && textEditDirty(doc)) { closeRequested.add(window); model.dialog = sheet('close'); ctx.focusWindow(window.id); ctx.onChanged?.(); return false; } }
    return true;
  }
  function targets() { return { documents: state().documents.map(doc => ({ id: doc.id, title: doc.title, kind: doc.content.kind, fileId: doc.fileId, fileRevision: doc.fileRevision, generation: doc.generation, dirty: textEditDirty(doc) })), windows: state().windows.map(win => ({ windowId: win.windowId, documentId: win.documentId, selection: { ...win.selection }, dialog: win.dialog?.kind ?? null })), preferences: copyCanonicalData(state().preferences) }; }
  return { handlers, targets, windowOpened, windowClosed, appQuit, openFile };
}
