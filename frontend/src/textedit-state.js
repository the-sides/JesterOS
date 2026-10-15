import { createTextEditContent, textEditPlainText, validateTextEditContent } from './textedit-content.js';
import { canonicalStringUnits } from './canonical-data.js';

export const TEXTEDIT_LIMITS = Object.freeze({ documents: 128, windows: 128, history: 64, text: 1024 * 1024, words: 1024 });
export const TEXTEDIT_PROFILE_IDS = Object.freeze(['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428']);
export const textEditIdentity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export const textEditInteger = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
export function textEditFields(value, allowed, required = allowed) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && allowed.includes(key) && Object.hasOwn(descriptors[key], 'value')) && required.every(key => Object.hasOwn(descriptors, key));
  } catch { return false; }
}
// Reject executable descriptors/cycles before any content validator/projection reads values.
export function textEditData(value, seen = new Set()) {
  try {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return true;
    if (!value || typeof value !== 'object' || seen.size > 64 || seen.has(value) || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value) && (Reflect.ownKeys(descriptors).length !== value.length + 1 || !Array.from({ length: value.length }, (_, index) => descriptors[index] && Object.hasOwn(descriptors[index], 'value')).every(Boolean))) return false;
    return Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && Object.hasOwn(descriptors[key], 'value') && textEditData(descriptors[key].value, seen));
  } catch { return false; }
  finally { seen.delete(value); }
}
export function textEditTextUnits(value) {
  return canonicalStringUnits(value);
}
export function createTextEditState(profile) {
  const windows = profile?.family === 'windows' || profile?.id?.startsWith('windows');
  return { version: 1, documents: [], windows: [], nextDocumentId: 1, preferences: { defaultKind: windows ? 'plain' : 'rich', font: windows ? 'Calibri' : 'Helvetica', size: windows ? 11 : 12, plainFont: windows ? 'Consolas' : 'Menlo', plainSize: 11, encoding: 'utf-8', windowColumns: 80, windowLines: 30, wrapToPage: false, displayRtfAsCode: false, displayHtmlAsCode: true, addTxtExtension: true, richOnlyTypography: !windows, richOnlySpelling: !windows, smartCopyPaste: false, smartQuotes: !windows, smartDashes: !windows, textReplacement: false, spellcheck: !windows, correctSpellingAutomatically: false, replacements: [], wrap: true, showRuler: !windows }, personalWords: [] };
}
export function createTextEditDocument(id, preferences, kind = preferences.defaultKind, text = '') {
  const content = createTextEditContent(text, kind);
  if (kind === 'rich') for (const block of content.blocks) if (block.type === 'paragraph') for (const run of block.runs) Object.assign(run.marks, { font: preferences.font, size: preferences.size });
  return { id, title: 'Untitled', content, generation: 0, contentRevision: 0, nextContentRevision: 1, savedGeneration: 0, fileId: null, fileRevision: null, fileMime: kind === 'rich' ? 'application/rtf' : 'text/plain', encoding: kind === 'rich' ? 'utf-8' : preferences.encoding, undo: [], redo: [] };
}
export const textEditDirty = document => document.contentRevision !== document.savedGeneration;
export function textEditWindowState(windowId, documentId, preferences) {
  return { windowId, documentId, selection: { start: 0, end: 0 }, typingMarks: null, dialog: null, find: { query: '', replacement: '', matchCase: false, message: '' }, showRuler: preferences.showRuler, wrap: preferences.wrap, zoom: 100, menu: null };
}
const boundedText = (value, max = TEXTEDIT_LIMITS.text) => typeof value === 'string' && value.length <= max;
export function validateTextEditPreferences(value) {
  return textEditData(value) && textEditFields(value, ['defaultKind', 'font', 'size', 'plainFont', 'plainSize', 'encoding', 'windowColumns', 'windowLines', 'wrapToPage', 'displayRtfAsCode', 'displayHtmlAsCode', 'addTxtExtension', 'richOnlyTypography', 'richOnlySpelling', 'smartCopyPaste', 'smartQuotes', 'smartDashes', 'textReplacement', 'spellcheck', 'correctSpellingAutomatically', 'replacements', 'wrap', 'showRuler'])
    && ['plain', 'rich'].includes(value.defaultKind)
    && ['font', 'plainFont'].every(key => boundedText(value[key], 1024) && value[key].length > 0 && !/[\x00-\x1f;]/.test(value[key]))
    && ['size', 'plainSize'].every(key => Number.isFinite(value[key]) && value[key] >= 6 && value[key] <= 144)
    && ['windowColumns', 'windowLines'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 10 && value[key] <= 200)
    && ['utf-8', 'utf-16le', 'windows-1252'].includes(value.encoding)
    && ['wrapToPage', 'displayRtfAsCode', 'displayHtmlAsCode', 'addTxtExtension', 'richOnlyTypography', 'richOnlySpelling', 'smartCopyPaste', 'smartQuotes', 'smartDashes', 'textReplacement', 'spellcheck', 'correctSpellingAutomatically', 'wrap', 'showRuler'].every(key => typeof value[key] === 'boolean')
    && Array.isArray(value.replacements) && value.replacements.length <= 256 && value.replacements.every(rule => textEditFields(rule, ['from', 'to']) && boundedText(rule.from, 128) && rule.from.length > 0 && boundedText(rule.to, 1024));
}
export function validateTextEditTypingMarks(marks) {
  if (marks === null) return true;
  const sample = createTextEditContent('', 'rich');
  sample.blocks[0].runs[0].marks = marks;
  return validateTextEditContent(sample);
}
export function validateTextEditState(state) {
  const bad = message => ({ ok: false, message });
  if (!textEditData(state) || !textEditFields(state, ['version', 'documents', 'windows', 'nextDocumentId', 'preferences', 'personalWords']) || state.version !== 1 || !textEditInteger(state.nextDocumentId) || state.nextDocumentId < 1 || !validateTextEditPreferences(state.preferences)) return bad('Invalid closed TextEdit workspace or preferences.');
  if (!Array.isArray(state.documents) || state.documents.length > TEXTEDIT_LIMITS.documents || !Array.isArray(state.windows) || state.windows.length > TEXTEDIT_LIMITS.windows || !Array.isArray(state.personalWords) || state.personalWords.length > TEXTEDIT_LIMITS.words || !state.personalWords.every(word => boundedText(word, 128) && /^\p{L}[\p{L}\p{M}'’]*$/u.test(word))) return bad('Invalid TextEdit collection.');
  const documentIds = new Set(), windowIds = new Set();
  const validContent = content => validateTextEditContent(content) === true;
  const history = entries => Array.isArray(entries) && entries.length <= TEXTEDIT_LIMITS.history && entries.every(entry => textEditFields(entry, ['content', 'contentRevision', 'fileMime', 'encoding']) && textEditInteger(entry.contentRevision) && boundedText(entry.fileMime, 256) && ['utf-8', 'utf-16le', 'windows-1252'].includes(entry.encoding) && validContent(entry.content));
  for (const doc of state.documents) {
    if (!textEditFields(doc, ['id', 'title', 'content', 'generation', 'contentRevision', 'nextContentRevision', 'savedGeneration', 'fileId', 'fileRevision', 'fileMime', 'encoding', 'undo', 'redo']) || !textEditIdentity(doc.id) || documentIds.has(doc.id) || !boundedText(doc.title, 255) || !boundedText(doc.fileMime, 256) || !validContent(doc.content) || textEditPlainText(doc.content).length > TEXTEDIT_LIMITS.text || !['generation', 'contentRevision', 'nextContentRevision', 'savedGeneration'].every(key => textEditInteger(doc[key])) || doc.nextContentRevision <= doc.contentRevision || doc.nextContentRevision <= doc.savedGeneration || !(doc.fileId === null || textEditIdentity(doc.fileId)) || !(doc.fileRevision === null || textEditInteger(doc.fileRevision) || boundedText(doc.fileRevision, 128)) || !['utf-8', 'utf-16le', 'windows-1252'].includes(doc.encoding) || !history(doc.undo) || !history(doc.redo) || ![...doc.undo, ...doc.redo].every(entry => entry.contentRevision < doc.nextContentRevision)) return bad('Invalid TextEdit document or history.');
    documentIds.add(doc.id);
  }
  for (const win of state.windows) {
    if (!textEditFields(win, ['windowId', 'documentId', 'selection', 'typingMarks', 'dialog', 'find', 'showRuler', 'wrap', 'zoom', 'menu']) || !textEditIdentity(win.windowId) || windowIds.has(win.windowId) || !documentIds.has(win.documentId) || !textEditFields(win.selection, ['start', 'end']) || !textEditInteger(win.selection.start) || !textEditInteger(win.selection.end) || win.selection.start > win.selection.end || win.selection.end > textEditPlainText(state.documents.find(doc => doc.id === win.documentId).content).length || !validateTextEditTypingMarks(win.typingMarks) || !textEditFields(win.find, ['query', 'replacement', 'matchCase', 'message']) || !boundedText(win.find.query, 4096) || !boundedText(win.find.replacement, 4096) || !boundedText(win.find.message, 4096) || typeof win.find.matchCase !== 'boolean' || typeof win.showRuler !== 'boolean' || typeof win.wrap !== 'boolean' || !Number.isFinite(win.zoom) || win.zoom < 25 || win.zoom > 500 || !(win.menu === null || boundedText(win.menu, 32))) return bad('Invalid TextEdit window.');
    if (win.dialog !== null && (!textEditFields(win.dialog, ['kind', 'message', 'spelling']) || !['open', 'save', 'find', 'preferences', 'font', 'color', 'table', 'link', 'attachment', 'about', 'help', 'close', 'convert', 'spelling', 'rename', 'move', 'revert', 'goto'].includes(win.dialog.kind) || !boundedText(win.dialog.message, 4096) || win.dialog.spelling !== null && (!textEditFields(win.dialog.spelling, ['word', 'start', 'end', 'suggestions', 'generation']) || !boundedText(win.dialog.spelling.word, 128) || !textEditInteger(win.dialog.spelling.start) || !textEditInteger(win.dialog.spelling.end) || !textEditInteger(win.dialog.spelling.generation) || !Array.isArray(win.dialog.spelling.suggestions) || win.dialog.spelling.suggestions.length > 8 || !win.dialog.spelling.suggestions.every(word => boundedText(word, 128))))) return bad('Invalid TextEdit sheet.');
    windowIds.add(win.windowId);
  }
  return { ok: true };
}
/** Import the retiring Notepad buffers once; callers must remove apps.notepad afterwards. */
export function migrateWindowsNotepadToTextEdit(old, profile) {
  const state = createTextEditState(profile);
  for (const tab of old?.tabs ?? []) {
    if (typeof tab.content !== 'string' || tab.content.length > TEXTEDIT_LIMITS.text) throw new TypeError('Invalid legacy Notepad buffer.');
    const doc = createTextEditDocument(`textedit-document-${state.nextDocumentId++}`, state.preferences, 'plain', tab.content);
    doc.title = typeof tab.title === 'string' ? tab.title : 'Untitled'; doc.fileId = tab.fileId ?? null; doc.fileRevision = tab.revision ?? null;
    if (tab.content !== tab.savedContent) { doc.contentRevision = 1; doc.nextContentRevision = 2; }
    state.documents.push(doc);
  }
  if (!validateTextEditState(state).ok) throw new TypeError('Legacy Notepad cannot be imported safely.');
  return state;
}
