import { normalizeRuns, validDocumentSelection, firstDocumentSelection } from './notes-workspace-document.js';
import { copyCanonicalData } from './canonical-data.js';
export function createNotesWorkspaceNativeView({ root: getRoot, editor: getEditor, list: getList, state: getState, window: getWindow, note: getNote }) {
  const available = () => { const root = getRoot(); return !!root?.isConnected && !root.closest('[inert]') && root.getClientRects().length > 0; };
  const hosts = () => [...(getEditor()?.querySelectorAll('[data-notes-editable]') ?? [])];
  function hostFor(selection) { return hosts().find(node => node.dataset.blockId === selection.blockId && Number(node.dataset.row) === selection.row && Number(node.dataset.column) === selection.column); }
  function rangeOffset(host, node, offset) { if (!host.contains(node)) return null; const range = document.createRange(); range.selectNodeContents(host); try { range.setEnd(node, offset); return range.toString().length; } catch { return null; } }
  function captureSelection() {
    if (!available()) return null; const selection = document.getSelection(); if (!selection?.rangeCount) return null;
    const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement, focus = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement;
    const host = anchor?.closest('[data-notes-editable]'); if (!host || focus?.closest('[data-notes-editable]') !== host || !getEditor()?.contains(host)) return null;
    const a = rangeOffset(host, selection.anchorNode, selection.anchorOffset), b = rangeOffset(host, selection.focusNode, selection.focusOffset); if (a === null || b === null) return null;
    const result = { blockId: host.dataset.blockId, row: Number(host.dataset.row), column: Number(host.dataset.column), start: Math.min(a, b), end: Math.max(a, b), direction: a > b ? 'backward' : a < b ? 'forward' : 'none' };
    return validDocumentSelection(getNote()?.document ?? { blocks: [] }, result) ? result : null;
  }
  function boundary(host, offset) { const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let node = walker.nextNode(), last = null; while (node) { if (offset <= node.data.length) return [node, offset]; offset -= node.data.length; last = node; node = walker.nextNode(); } return last ? [last, last.data.length] : [host, 0]; }
  function restoreSelection(selection) {
    if (!available() || !selection || !validDocumentSelection(getNote()?.document ?? { blocks: [] }, selection)) return false;
    const host = hostFor(selection); if (!host || host.contentEditable !== 'true') return false;
    const start = boundary(host, selection.start), end = boundary(host, selection.end), native = document.getSelection(); host.focus({ preventScroll: true });
    if (document.activeElement !== host || !native) return false;
    native.setBaseAndExtent(...(selection.direction === 'backward' ? end : start), ...(selection.direction === 'backward' ? start : end)); host.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true;
  }
  function readRuns(host) {
    const runs = [];
    function visit(node, marks, font) {
      if (node.nodeType === Node.TEXT_NODE) { runs.push({ text: node.data, marks, ...(font ? { font } : {}) }); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const next = new Set(marks), tag = node.tagName.toLowerCase(), family = node.dataset.font || font;
      for (const [mark, tags] of Object.entries({ bold: ['strong', 'b'], italic: ['em', 'i'], underline: ['u'], strike: ['s', 'strike', 'del'] })) if (tags.includes(tag) || node.dataset[mark] === 'true') next.add(mark);
      if (tag === 'br') { if (node !== host.firstChild || node.nextSibling) runs.push({ text: '\n', marks: [...next], ...(family ? { font: family } : {}) }); return; }
      for (const child of node.childNodes) visit(child, [...next], family);
    }
    for (const child of host.childNodes) visit(child, []); return normalizeRuns(runs);
  }
  function captureDocument() {
    if (!available()) return null; const note = getNote(); if (!note) return null;
    const source = copyCanonicalData(note.document); for (const host of hosts()) {
      const block = source.blocks.find(block => block.id === host.dataset.blockId); if (!block) return null;
      const runs = readRuns(host); if (block.type === 'paragraph') block.runs = runs; else { const row = Number(host.dataset.row), column = Number(host.dataset.column); if (!block.rows[row]?.[column]) return null; block.rows[row][column] = runs; }
    }
    // Native typing changes offsets before canonical content commits.
    const native = document.getSelection(), anchor = native?.anchorNode?.nodeType === Node.ELEMENT_NODE ? native.anchorNode : native?.anchorNode?.parentElement, host = anchor?.closest('[data-notes-editable]');
    if (!host || !getEditor().contains(host) || !host.contains(native.focusNode)) return null;
    const a = rangeOffset(host, native.anchorNode, native.anchorOffset), b = rangeOffset(host, native.focusNode, native.focusOffset); if (a === null || b === null) return null;
    const selection = { blockId: host.dataset.blockId, row: Number(host.dataset.row), column: Number(host.dataset.column), start: Math.min(a, b), end: Math.max(a, b), direction: a > b ? 'backward' : a < b ? 'forward' : 'none' };
    return validDocumentSelection(source, selection) ? { document: source, selection } : null;
  }
  function focus(controlId) {
    if (!available()) return false; let node;
    if (controlId === 'editor') { const selection = getWindow()?.selection ?? (getNote() ? firstDocumentSelection(getNote().document) : null); return selection ? restoreSelection(selection) : false; }
    node = [...getRoot().querySelectorAll('[data-notes-control]')].find(node => node.dataset.notesControl === controlId);
    if (!node || node.disabled || node.closest('[inert]') || !node.getClientRects().length) return false; node.focus({ preventScroll: true }); return document.activeElement === node;
  }
  function scroll(area, position) { if (!available()) return null; const node = area === 'list' ? getList() : getEditor(); if (!node) return null; node.scrollTop = position.top; node.scrollLeft = position.left; return { top: node.scrollTop, left: node.scrollLeft }; }
  function captureSearch() {
    if (!available()) return null;
    const node = [...getRoot().querySelectorAll('[data-notes-control]')].find(node => node.dataset.notesControl === 'search');
    if (!node || document.activeElement !== node || typeof node.selectionStart !== 'number') return null;
    return { node, value: node.value, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection };
  }
  return { available, captureSelection, restoreSelection, captureDocument, captureSearch, focus, scroll, selectAll() { const current = captureSelection(), host = current ? hostFor(current) : null; if (!host) return false; return restoreSelection({ ...current, start: 0, end: host.textContent.length, direction: 'forward' }); }, originalRoot: getRoot, ownsNote: note => getNote() === note };
}
