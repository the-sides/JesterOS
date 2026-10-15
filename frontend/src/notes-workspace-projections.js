import { workspaceNote, notesWorkspaceWindow, noteWorkspaceLocked, noteWorkspaceText, noteWorkspaceTitle, noteWorkspaceProjection, visibleWorkspaceNotes, validateNotesWorkspace } from './notes-workspace-state.js';
import { firstDocumentSelection, documentText, runsText, validDocumentSelection } from './notes-workspace-document.js';
import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';
/** A prepared canonical transition for Services/imports; caller commits candidate
 * atomically under its original ownership and whole-scene budget, never mirrors text. */
export function prepareNotesWorkspaceCreation(state, profile, text, sceneTime, { windowId, folderId } = {}) {
  const fail = message => ({ status: 'rejected', error: { code: 'invalid_arguments', message } });
  if (!validateNotesWorkspace(state, profile).ok || typeof text !== 'string' || text.length > 1048576 || !Number.isSafeInteger(sceneTime) || sceneTime < 0) return fail('A valid canonical workspace, bounded text and authored instant are required.');
  const candidate = copyCanonicalData(state), window = windowId ? notesWorkspaceWindow(candidate, windowId) : null;
  if (windowId && !window) return fail('The original Notes session is missing.');
  const folder = candidate.folders.find(folder => folder.id === (folderId ?? window?.folderId) && folder.deletedAt === null && candidate.accounts.some(account => account.id === folder.accountId && account.enabled)) ?? candidate.folders.find(folder => folder.accountId === candidate.preferences.defaultAccountId && folder.deletedAt === null);
  if (!folder) return fail('An enabled available account folder is required.');
  const timestamp = Math.max(sceneTime, ...candidate.notes.map(note => note.updatedAt)) + 1; if (!Number.isSafeInteger(timestamp) || timestamp >= 8640000000000000) return fail('The authored Notes clock is exhausted.');
  while (candidate.notes.some(note => note.id === `note-${candidate.nextId}`)) candidate.nextId++;
  const note = workspaceNote(`note-${candidate.nextId++}`, text, folder.id, timestamp); note.document.blocks[0].style = candidate.preferences.defaultStyle; candidate.notes.push(note);
  if (window) { window.folderId = folder.id; window.selectedId = note.id; window.query = ''; window.selection = firstDocumentSelection(note.document); }
  const result = validateNotesWorkspace(candidate, profile); if (!result.ok) return fail(result.message);
  return { status: 'prepared', candidate, noteId: note.id, deltaTextUnits: canonicalStringUnits(candidate) - canonicalStringUnits(state), timestamp };
}
export function notesWorkspaceSearchSources(state) {
  return state.notes.filter(note => note.deletedAt === null && !noteWorkspaceLocked(note) && state.accounts.some(account => account.enabled && state.folders.some(folder => folder.id === note.folderId && folder.accountId === account.id)))
    .map(note => ({ kind: 'note', id: note.id, label: noteWorkspaceTitle(note), secondary: 'Notes', icon: 'notes', terms: [noteWorkspaceText(note)], canReveal: true, token: { record: note, revision: note.revision } }));
}
export function notesWorkspaceNotificationDestination(state, noteId) {
  const note = state.notes.find(note => note.id === noteId && note.deletedAt === null); return note ? { id: note.id, appId: 'notes', locked: noteWorkspaceLocked(note), title: noteWorkspaceTitle(note), projection: noteWorkspaceProjection(note) } : null;
}
export function notesDocumentTextRanges(document) {
  let offset = 0; const ranges = [];
  document.blocks.forEach((block, index) => {
    if (index) offset++;
    if (block.type === 'paragraph') { const length = runsText(block.runs).length; ranges.push({ blockId: block.id, row: -1, column: -1, start: offset, end: offset + length }); offset += length; }
    else block.rows.forEach((row, rowIndex) => { if (rowIndex) offset++; row.forEach((cell, columnIndex) => { if (columnIndex) offset++; const length = runsText(cell).length; ranges.push({ blockId: block.id, row: rowIndex, column: columnIndex, start: offset, end: offset + length }); offset += length; }); });
  }); return ranges;
}
export function notesPlaintextNativeSelection(document, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > documentText(document).length) return null;
  const range = notesDocumentTextRanges(document).find(range => range.start <= start && end <= range.end); return range ? { blockId: range.blockId, row: range.row, column: range.column, start: start - range.start, end: end - range.start, direction: 'forward' } : null;
}
export function notesNativePlaintextSelection(document, selection) {
  if (!validDocumentSelection(document, selection)) return null; const range = notesDocumentTextRanges(document).find(range => range.blockId === selection.blockId && range.row === selection.row && range.column === selection.column); return range ? { start: range.start + selection.start, end: range.start + selection.end, direction: selection.direction } : null;
}
export function notesWorkspaceTextSource(state, windowId, nativeView) {
  const session = notesWorkspaceWindow(state, windowId), note = state.notes.find(note => note.id === session?.selectedId); if (!note || noteWorkspaceLocked(note) || !nativeView?.available() || !nativeView.ownsNote(note)) return null;
  const native = nativeView.captureSelection(), selection = native ? notesNativePlaintextSelection(note.document, native) : null; if (!selection) return null;
  return { note, revision: note.revision, value: noteWorkspaceText(note), selection, readOnly: note.deletedAt !== null || note.collaboration.enabled && note.collaboration.permission === 'view' };
}
export const notesWorkspaceVisibleProjections = (state, windowId) => visibleWorkspaceNotes(state, notesWorkspaceWindow(state, windowId)).map(noteWorkspaceProjection);
