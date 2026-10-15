import { pagesWindow, pagesDocument, pagesText } from './pages-model.js';

function paragraphOf(node, root) { const element = node?.nodeType === 1 ? node : node?.parentElement; const paragraph = element?.closest?.('[data-pages-paragraph]'); return paragraph && root.contains(paragraph) ? paragraph : null; }
function pointOffset(paragraph, node, offset) { try { const range = paragraph.ownerDocument.createRange(); range.selectNodeContents(paragraph); range.setEnd(node, offset); return range.toString().length; } catch { return null; } }
function textPoint(paragraph, offset) {
  const walker = paragraph.ownerDocument.createTreeWalker(paragraph, 4); let node = walker.nextNode(), last = null, remaining = offset;
  while (node) { last = node; if (remaining <= node.textContent.length) return [node, remaining]; remaining -= node.textContent.length; node = walker.nextNode(); }
  return last ? [last, last.textContent.length] : [paragraph, 0];
}
export function pagesDOMSelection(root) {
  const selection = root?.ownerDocument?.getSelection?.(); if (!selection?.rangeCount) return null;
  const anchor = paragraphOf(selection.anchorNode, root), focus = paragraphOf(selection.focusNode, root);
  if (!anchor || !focus) return null;
  const a = pointOffset(anchor, selection.anchorNode, selection.anchorOffset), b = pointOffset(focus, selection.focusNode, selection.focusOffset);
  if (a === null || b === null) return null;
  if (anchor === focus) return { blockId: anchor.dataset.pagesParagraph, start: Math.min(a, b), end: Math.max(a, b) };
  const forward = !!(anchor.compareDocumentPosition(focus) & 4);
  return forward ? { blockId: anchor.dataset.pagesParagraph, start: a, endBlockId: focus.dataset.pagesParagraph, end: b } : { blockId: focus.dataset.pagesParagraph, start: b, endBlockId: anchor.dataset.pagesParagraph, end: a };
}
export function pagesDOMSelect(root, selection, focus = true) {
  const paragraphs = [...root.querySelectorAll('[data-pages-paragraph]')], paragraph = paragraphs.find(node => node.dataset.pagesParagraph === selection.blockId), last = paragraphs.find(node => node.dataset.pagesParagraph === (selection.endBlockId ?? selection.blockId));
  if (!paragraph || !last || paragraph.getAttribute('contenteditable') !== 'true' || last.getAttribute('contenteditable') !== 'true') return false;
  const [startNode, startOffset] = textPoint(paragraph, selection.start), [endNode, endOffset] = textPoint(last, selection.end);
  const range = paragraph.ownerDocument.createRange(); try { range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset); } catch { return false; }
  if (focus) paragraph.focus(); const native = paragraph.ownerDocument.getSelection(); native.removeAllRanges(); native.addRange(range); return true;
}
export function pagesNativeDifference(before, after) { let start = 0, end = before.length, nextEnd = after.length; while (start < end && start < nextEnd && before[start] === after[start]) start++; while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; } return { start, end, text: after.slice(start, nextEnd) }; }

/** Svelte action: DOM is a live editor surface, never a shadow document authority.
 * It renders canonical runs with real text nodes (no HTML parsing), intercepts
 * edits, and restores the canonical insertion point after publication. */
export function pagesParagraph(node, options) {
  let config = options, signature = '', composing = false;
  function render(force = false) {
    const next = JSON.stringify([config.block.runs, config.fontRevision]); if (!force && next === signature) return; signature = next;
    const focused = node.ownerDocument.activeElement === node, selection = config.getSelection?.();
    node.replaceChildren();
    for (const run of config.block.runs) { const span = node.ownerDocument.createElement('span'); span.textContent = run.text; span.style.fontFamily = config.fontCSS?.(run.font, run.bold, run.italic) ?? 'sans-serif'; span.style.fontSize = `${run.size}px`; span.style.color = run.color; span.style.fontWeight = run.bold ? '700' : '400'; span.style.fontStyle = run.italic ? 'italic' : 'normal'; span.style.textDecoration = run.underline ? 'underline' : 'none'; node.append(span); }
    if (!node.textContent) node.append(node.ownerDocument.createElement('br'));
    if (focused && selection?.blockId === config.block.id) pagesDOMSelect(config.getRoot(), selection, false);
  }
  async function edit(suffix, payload) { if (config.available() !== true) { render(true); return; } try { await config.execute(suffix, payload); } finally { if (node.isConnected && !composing) render(true); } }
  function range() { const selection = pagesDOMSelection(config.getRoot()); return selection && (selection.blockId === config.block.id || selection.endBlockId === config.block.id) ? selection : null; }
  function beforeInput(event) {
    if (composing || event.isComposing) return;
    const selection = range(); if (!selection || config.available() !== true) { event.preventDefault(); return; }
    const inputType = event.inputType;
    if (inputType === 'insertText' || inputType === 'insertReplacementText') { event.preventDefault(); edit('text.replace', { ...selection, text: event.data ?? '' }); }
    else if (inputType === 'insertParagraph') { event.preventDefault(); edit('text.split', selection); }
    else if (inputType === 'insertLineBreak') { event.preventDefault(); edit('text.replace', { ...selection, text: '\n' }); }
    else if (inputType.startsWith('delete')) {
      event.preventDefault(); const text = pagesText(config.block), collapsed = (!selection.endBlockId || selection.endBlockId === selection.blockId) && selection.start === selection.end;
      if (collapsed && selection.start === 0 && /Backward/u.test(inputType)) edit('text.merge', { blockId: config.block.id });
      else {
        if (collapsed) {
          const boundaries = [...new Intl.Segmenter('en', { granularity: inputType.includes('Word') ? 'word' : 'grapheme' }).segment(text)].map(part => part.index); boundaries.push(text.length);
          if (/Backward/u.test(inputType)) selection.start = boundaries.filter(offset => offset < selection.start).at(-1) ?? 0;
          else selection.end = boundaries.find(offset => offset > selection.end) ?? text.length;
        }
        edit('text.replace', { ...selection, text: '' });
      }
    } else if (inputType === 'historyUndo' || inputType === 'historyRedo') { event.preventDefault(); edit(inputType === 'historyUndo' ? 'undo' : 'redo', {}); }
    else if (['insertFromPaste', 'insertFromDrop', 'formatBold', 'formatItalic', 'formatUnderline'].includes(inputType)) event.preventDefault();
  }
  function input() { if (composing) return; const diff = pagesNativeDifference(pagesText(config.block), node.textContent ?? ''); if (diff.start !== diff.end || diff.text) edit('text.replace', { blockId: config.block.id, ...diff }); }
  function compositionStart() { composing = true; }
  function compositionEnd() { composing = false; input(); }
  const select = () => { if (config.available() !== true || composing) return; const selection = range(); if (selection) config.selection?.(selection); };
  node.addEventListener('beforeinput', beforeInput); node.addEventListener('input', input); node.addEventListener('compositionstart', compositionStart); node.addEventListener('compositionend', compositionEnd); node.addEventListener('keyup', select); node.addEventListener('pointerup', select); node.addEventListener('focus', select); render();
  return { update(next) { config = next; if (!composing) render(); }, destroy() { node.removeEventListener('beforeinput', beforeInput); node.removeEventListener('input', input); node.removeEventListener('compositionstart', compositionStart); node.removeEventListener('compositionend', compositionEnd); node.removeEventListener('keyup', select); node.removeEventListener('pointerup', select); node.removeEventListener('focus', select); } };
}
export function createPagesNativeView(options) {
  const root = options.getRoot(), state = options.getState(), profile = options.getProfile(), window = options.getWindow(), session = pagesWindow(state, options.windowId); let retired = false;
  const available = () => !retired && root?.isConnected === true && options.getRoot() === root && options.getState() === state && options.getProfile() === profile && options.getWindow() === window && pagesWindow(state, options.windowId) === session && options.available() === true;
  const control = id => [...root.querySelectorAll('[data-pages-control]')].find(node => node.dataset.pagesControl === id && !node.disabled && !node.closest('[inert]'));
  function captureSelection({ allowUnfocused = false } = {}) {
    if (!available() || session.mode !== 'editor') return null;
    const native = pagesDOMSelection(root); if (native) return native;
    return allowUnfocused ? { ...session.selection } : null;
  }
  return {
    available, captureSelection,
    selectRange(selection) { return available() && pagesDOMSelect(root, selection); },
    selectAll() { if (!available()) return false; const rows = pagesDocument(state, session.documentId)?.content.blocks.filter(row => row.type === 'paragraph') ?? []; if (!rows.length) return false; return pagesDOMSelect(root, { blockId: rows[0].id, start: 0, endBlockId: rows.at(-1).id, end: pagesText(rows.at(-1)).length }); },
    focus(id) { if (!available()) return false; const node = control(id); if (!node || typeof node.focus !== 'function') return false; node.focus(); return available() && node.ownerDocument.activeElement === node; },
    scroll({ top, left = 0 }) { if (!available()) return null; const node = control('canvas'); if (!node) return null; node.scrollTop = top; node.scrollLeft = left; return available() ? { top: node.scrollTop, left: node.scrollLeft } : null; },
    async imageDimensions(content, guard) { if (!available() || guard() !== true || !/^data:image\/(png|jpeg);base64,/u.test(content)) return null; const image = new root.ownerDocument.defaultView.Image(); image.src = content; try { await image.decode(); } catch { return null; } return available() && guard() === true && image.naturalWidth > 0 && image.naturalHeight > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null; },
    describe() { return { available: available(), originalWindowId: options.windowId, documentId: session?.documentId ?? null, documentRevision: pagesDocument(state, session?.documentId)?.revision ?? null, editor: 'original-rich-paragraph-facade', selection: available() ? captureSelection({ allowUnfocused: true }) : null, controls: available() ? [...root.querySelectorAll('[data-pages-control]')].map(node => ({ id: node.dataset.pagesControl, enabled: !node.disabled && !node.closest('[inert]') })) : [] }; },
    destroy() { retired = true; },
  };
}
