import { selectNativeText } from './text-native-selection.js';
import { createTextEditContent, textEditPlainText, replaceTextEditRange, TEXTEDIT_MARK_DEFAULTS } from './textedit-content.js';

/** UTF-16 positions in the canonical plain projection, including virtual separators. */
export function textEditNativeSegments(content) {
  const entries = []; let offset = 0;
  content.blocks.forEach((block, index) => {
    if (index) offset++;
    const add = (runs, row = null, column = null) => {
      const text = runs.map(run => run.text).join('');
      entries.push({ blockId: block.id, type: block.type, row, column, start: offset, end: offset + text.length, text, runs });
      offset += text.length;
    };
    if (block.type === 'paragraph') add(block.runs);
    else if (block.type === 'table') block.rows.forEach((row, r) => {
      if (r) offset++;
      row.forEach((cell, c) => { if (c) offset++; add(cell.runs, r, c); });
    });
    else { entries.push({ blockId: block.id, type: 'attachment', start: offset, end: offset + 1, text: '\uFFFC' }); offset++; }
  });
  return entries;
}

export function textEditNativeTypingRange(content, selection, inputType) {
  const text = textEditPlainText(content), { start, end } = selection;
  if (start !== end) return { start, end };
  const previous = at => at > 1 && /[\uDC00-\uDFFF]/.test(text[at - 1]) && /[\uD800-\uDBFF]/.test(text[at - 2]) ? at - 2 : Math.max(0, at - 1);
  const next = at => at < text.length && /[\uD800-\uDBFF]/.test(text[at]) && /[\uDC00-\uDFFF]/.test(text[at + 1] ?? '') ? at + 2 : Math.min(text.length, at + 1);
  if (inputType === 'deleteContentBackward') return { start: previous(start), end };
  if (inputType === 'deleteContentForward') return { start, end: next(end) };
  if (inputType === 'deleteWordBackward') { const at = text.slice(0, start).search(/\S+\s*$/u); return { start: at < 0 ? 0 : at, end }; }
  if (inputType === 'deleteWordForward') return { start, end: end + (text.slice(end).match(/^\s*\S+\s*/u)?.[0].length ?? 0) };
  if (inputType === 'deleteSoftLineBackward' || inputType === 'deleteHardLineBackward') return { start: text.lastIndexOf('\n', start - 1) + 1, end };
  if (inputType === 'deleteSoftLineForward' || inputType === 'deleteHardLineForward') { const at = text.indexOf('\n', end); return { start, end: at < 0 ? text.length : at }; }
  return { start, end };
}

/** Smallest Unicode-safe text replacement; useful for native IME/autofill commits. */
export function textEditNativeDifference(before, after) {
  let start = 0, suffix = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  if (start && /[\uDC00-\uDFFF]/.test(before[start] ?? after[start] ?? '')) start--;
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(before[before.length - suffix] ?? after[after.length - suffix] ?? '')) suffix--;
  return { start, end: before.length - suffix, text: after.slice(start, after.length - suffix) };
}

/** DOM-only facade. All document writes go through the real guarded command registry. */
export function createTextEditNativeView({ getRoot, getEditor, getState, getDocument, getWindow, windowId, available: isAvailable = () => true, execute, onMessage = () => {}, onFiles = () => {}, onAttachmentPreview, fontCSS = () => 'sans-serif' }) {
  const state = getState(), originalDocument = getDocument(), originalWindow = getWindow(), root = getRoot(), editor = getEditor();
  let renderedContent = null, renderedOwner = null, renderedRevision = null, composing = null, nativeOwner = null, disposed = false;
  let entries = [], fileChoices = [], suppressSelection = false, spellingIssues = [], overlay = null;
  const ownerDocument = editor?.ownerDocument;
  const owned = () => !disposed && root?.isConnected === true && editor?.isConnected === true && getRoot() === root && getEditor() === editor
    && root.ownerDocument === ownerDocument && editor.ownerDocument === ownerDocument
    && root.contains(editor) && getState() === state && getDocument() === originalDocument && getWindow() === originalWindow && originalWindow?.documentId === originalDocument?.id
    && root.dataset.texteditWindowId === windowId && isAvailable() === true;
  function mounted(node, interactive = false) {
    if (!owned() || node?.ownerDocument !== ownerDocument || !node?.isConnected || !root.contains(node) || node.disabled) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = ownerDocument.defaultView.getComputedStyle(parent);
      if (parent.hidden || interactive && (parent.inert || parent.hasAttribute('inert')) || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const editable = () => mounted(editor, true) && (!getWindow()?.dialog || ['find', 'spelling'].includes(getWindow().dialog.kind));
  const lease = () => owned() ? { documentId: originalDocument.id, generation: originalDocument.generation } : null;
  const current = owner => owned() && owner?.documentId === originalDocument.id && owner.generation === originalDocument.generation;
  const projectionCurrent = () => current(renderedOwner) && renderedRevision === originalDocument.contentRevision;
  const send = (command, payload = {}) => owned() ? execute(command, { windowId }, payload) : false;
  const plain = () => editor.tagName === 'TEXTAREA';

  // A Range compares tree roots, not merely ownerDocuments. Native rich edits can
  // detach rendered segments while leaving this original editor connected.
  const segmentsMounted = () => entries.length > 0 && entries.every(entry => entry.node.ownerDocument === ownerDocument
    && entry.node.isConnected === true && editor.contains(entry.node));

  function domOffset(node, offset) {
    if (node?.ownerDocument !== ownerDocument || !editor.contains(node)) return null;
    const entry = entries.find(entry => entry.node === node || entry.node.contains(node));
    if (entry) {
      if (entry.type === 'attachment') return offset ? entry.end : entry.start;
      const range = ownerDocument.createRange(); range.selectNodeContents(entry.node);
      try { range.setEnd(node, offset); } catch { return null; }
      return Math.min(entry.end, entry.start + range.toString().length);
    }
    // Root/table boundary endpoints map to the nearest canonical segment, not HTML text.
    const boundary = ownerDocument.createRange();
    try { boundary.setStart(node, offset); boundary.collapse(true); } catch { return null; }
    for (const item of entries) {
      const itemRange = ownerDocument.createRange(); itemRange.selectNodeContents(item.node);
      if (boundary.compareBoundaryPoints(0, itemRange) <= 0) return item.start;
    }
    return entries.at(-1)?.end ?? 0;
  }
  /** Read only live plaintext and native caret positions, never DOM formatting/IDs.
   * Block/cell separators match the canonical projection; only original live
   * attachment nodes retain their object-replacement character. */
  function readNativeText() {
    if (!owned()) return null;
    const selection = ownerDocument.getSelection();
    let text = '', anchor = null, focus = null;
    const mark = (node, offset) => {
      if (selection?.anchorNode === node && selection.anchorOffset === offset) anchor = text.length;
      if (selection?.focusNode === node && selection.focusOffset === offset) focus = text.length;
    };
    const block = node => node.nodeType === 1 && /^(DIV|P|TABLE|UL|OL|LI|BLOCKQUOTE|PRE|H[1-6])$/.test(node.tagName);
    const walk = node => {
      if (node.ownerDocument !== ownerDocument || !node.isConnected || !editor.contains(node)) return false;
      if (node.nodeType === 3) {
        const normalize = value => value.replace(/\r\n?/g, '\n');
        if (selection?.anchorNode === node) anchor = text.length + normalize(node.data.slice(0, selection.anchorOffset)).length;
        if (selection?.focusNode === node) focus = text.length + normalize(node.data.slice(0, selection.focusOffset)).length;
        text += normalize(node.data); return true;
      }
      if (node.nodeType !== 1) return true;
      const attachment = entries.find(entry => entry.type === 'attachment' && entry.node === node);
      if (attachment) {
        mark(node, 0); text += '\uFFFC'; mark(node, node.childNodes.length); return true;
      }
      if (node.tagName === 'BR') {
        mark(node, 0);
        if (node.parentNode.childNodes.length !== 1 || !/^(DIV|P|TD|TH)$/.test(node.parentNode.tagName)) text += '\n';
        return true;
      }
      let previous = null, index = 0;
      for (const child of node.childNodes) {
        const contributes = child.nodeType === 1 || child.nodeType === 3 && child.data.length > 0;
        if (previous && contributes) {
          if (node.tagName === 'TR' && /^(TD|TH)$/.test(previous.tagName) && /^(TD|TH)$/.test(child.tagName)) text += '\t';
          else if (/^(TABLE|TBODY|THEAD|TFOOT)$/.test(node.tagName) && previous.tagName === 'TR' && child.tagName === 'TR') text += '\n';
          else if (block(previous) || block(child)) text += '\n';
        }
        mark(node, index++);
        if (!walk(child)) return false;
        if (contributes) previous = child;
      }
      mark(node, index); return true;
    };
    if (!walk(editor) || !owned()) return null;
    return { text, selection: anchor === null || focus === null ? null : { start: Math.min(anchor, focus), end: Math.max(anchor, focus) } };
  }
  function captureSelection(options = {}) {
    if (!editable()) return null;
    if (plain()) {
      if (options.allowUnfocused || ownerDocument.activeElement === editor) return { start: editor.selectionStart, end: editor.selectionEnd };
      return null;
    }
    if (!projectionCurrent() || !segmentsMounted()) return null;
    const selection = ownerDocument.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return null;
    const anchor = domOffset(selection.anchorNode, selection.anchorOffset), focus = domOffset(selection.focusNode, selection.focusOffset);
    return anchor === null || focus === null ? null : { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
  }
  function point(offset, ending = false) {
    let entry = entries.find(item => offset >= item.start && offset <= item.end);
    if (!entry) entry = ending ? [...entries].reverse().find(item => item.end <= offset) : entries.find(item => item.start >= offset);
    if (!entry) entry = entries.at(-1);
    if (!entry) return null;
    if (entry.type === 'attachment') return { node: entry.node.parentNode, offset: [...entry.node.parentNode.childNodes].indexOf(entry.node) + (offset > entry.start ? 1 : 0) };
    const walker = ownerDocument.createTreeWalker(entry.node, 4); let remaining = Math.max(0, Math.min(entry.end - entry.start, offset - entry.start));
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (remaining <= node.data.length) return { node, offset: remaining };
      remaining -= node.data.length;
    }
    return { node: entry.node, offset: entry.node.childNodes.length };
  }
  function focus() {
    if (!editable()) return false;
    editor.focus({ preventScroll: true });
    return owned() && ownerDocument.activeElement === editor;
  }
  function selectRange(range) {
    if (!editable() || !Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) || range.start < 0 || range.end < range.start || range.end > textEditPlainText(originalDocument.content).length) return false;
    if (!plain() && (!projectionCurrent() || !segmentsMounted())) return false;
    suppressSelection = true;
    try {
      if (plain()) return selectNativeText(editor, range);
      const from = point(range.start), to = point(range.end, true);
      if (!from || !to || !focus()) return false;
      const nativeRange = ownerDocument.createRange(); nativeRange.setStart(from.node, from.offset); nativeRange.setEnd(to.node, to.offset);
      const selection = ownerDocument.getSelection(); selection.removeAllRanges(); selection.addRange(nativeRange);
      const node = to.node.nodeType === 1 ? to.node : to.node.parentElement; node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      const actual = captureSelection(); return actual?.start === range.start && actual?.end === range.end;
    } finally { suppressSelection = false; }
  }
  function observeSelection() {
    if (suppressSelection || composing) return;
    const selection = captureSelection(), owner = lease();
    if (!selection || !owner || getWindow()?.selection.start === selection.start && getWindow()?.selection.end === selection.end) return;
    send('textedit.selection', { ...selection, ...owner });
  }
  function appendRuns(node, runs, tabs = [], issues = []) {
    let width = 0, offset = 0;
    const canvas = ownerDocument.createElement('canvas'), measure = canvas.getContext('2d');
    const decorate = (span, marks) => {
      span.style.fontFamily = fontCSS(marks.font, marks.bold, marks.italic); span.style.fontSize = `${marks.size}pt`; span.style.color = marks.color;
      span.style.fontWeight = marks.bold ? '700' : '400'; span.style.fontStyle = marks.italic ? 'italic' : 'normal';
      span.style.textDecoration = [marks.underline && 'underline', marks.strike && 'line-through'].filter(Boolean).join(' ') || 'none';
      if (marks.link) { span.dataset.texteditLink = marks.link; span.title = 'Command/Ctrl-click to open this scene link'; }
    };
    const emit = (text, marks, misspelled) => {
      if (!text) return;
      const span = ownerDocument.createElement('span');
      decorate(span, marks);
      if (misspelled) { span.classList.add('textedit-misspelling'); span.setAttribute('aria-label', 'Possibly misspelled word'); }
      if (measure) measure.font = `${marks.italic ? 'italic ' : ''}${marks.bold ? 'bold ' : ''}${marks.size * 4 / 3}px ${fontCSS(marks.font, marks.bold, marks.italic)}`;
      const parts = text.split('\t');
      parts.forEach((part, index) => {
        if (index) {
          const stop = tabs.map(value => value * 4 / 3).find(value => value > width + 0.5) ?? (Math.floor(width / 48) + 1) * 48;
          const tab = ownerDocument.createElement('span'); tab.className = 'textedit-tab'; tab.textContent = '\t'; tab.style.width = `${Math.max(1, stop - width)}px`; span.append(tab); width = stop;
        }
        if (part) { span.append(ownerDocument.createTextNode(part)); width += measure?.measureText(part).width ?? part.length * marks.size * 0.65; }
      });
      node.append(span);
    };
    for (const run of runs) {
      const from = offset, to = offset + run.text.length; offset = to;
      const overlapping = issues.filter(issue => issue.start < to && issue.end > from).sort((a, b) => a.start - b.start);
      if (!overlapping.length) { emit(run.text, run.marks, false); continue; }
      let at = from;
      for (const issue of overlapping) {
        const issueStart = Math.max(from, issue.start), issueEnd = Math.min(to, issue.end);
        if (issueStart > at) emit(run.text.slice(at - from, issueStart - from), run.marks, false);
        emit(run.text.slice(issueStart - from, issueEnd - from), run.marks, true);
        at = issueEnd;
      }
      if (at < to) emit(run.text.slice(at - from), run.marks, false);
    }
    if (!runs.some(run => run.text)) node.append(ownerDocument.createElement('br'));
  }
  function render(force = false) {
    if (!owned() || composing) return false;
    if (!force && renderedContent === originalDocument.content && !plain() && projectionCurrent() && segmentsMounted()) return false;
    const restore = captureSelection() || ownerDocument.activeElement === editor, content = originalDocument.content;
    const localIssues = entry => spellingIssues.filter(issue => issue.start < entry.end && issue.end > entry.start)
      .map(issue => ({ ...issue, start: Math.max(0, issue.start - entry.start), end: Math.min(entry.end - entry.start, issue.end - entry.start) }));
    if (plain()) {
      renderedContent = content; renderedOwner = lease(); renderedRevision = originalDocument.contentRevision;
      if (editor.value !== textEditPlainText(content)) editor.value = textEditPlainText(content);
      paintPlainSpelling();
      if (restore) selectRange(getWindow().selection);
      return true;
    }
    const fragment = ownerDocument.createDocumentFragment(), projected = textEditNativeSegments(content), nextEntries = [];
    let number = 0, segmentIndex = 0;
    for (const block of content.blocks) {
      if (block.type === 'paragraph') {
        const node = ownerDocument.createElement('div'); node.className = 'textedit-paragraph'; node.dataset.texteditBlockId = block.id;
        node.style.textAlign = block.align; node.style.lineHeight = String(block.spacing); node.style.marginLeft = `${block.indent}pt`;
        if (block.list !== 'none') { node.dataset.list = block.list; node.style.setProperty('--textedit-list-marker', JSON.stringify(block.list === 'bullet' ? '•' : `${++number}.`)); } else number = 0;
        const projectedEntry = projected[segmentIndex++];
        appendRuns(node, block.runs, block.tabs, localIssues(projectedEntry)); fragment.append(node);
        nextEntries.push({ ...projectedEntry, node });
      } else if (block.type === 'table') {
        number = 0;
        const table = ownerDocument.createElement('table'), body = ownerDocument.createElement('tbody'); table.dataset.texteditBlockId = block.id;
        block.rows.forEach((row, r) => { const tr = ownerDocument.createElement('tr'); row.forEach((cell, c) => {
          const td = ownerDocument.createElement('td'); td.dataset.texteditBlockId = block.id; td.dataset.texteditRow = String(r); td.dataset.texteditColumn = String(c);
          const projectedEntry = projected[segmentIndex++];
          appendRuns(td, cell.runs, [], localIssues(projectedEntry)); tr.append(td); nextEntries.push({ ...projectedEntry, node: td });
        }); body.append(tr); }); table.append(body); fragment.append(table);
      } else {
        number = 0;
        const node = ownerDocument.createElement('div'); node.className = 'textedit-attachment'; node.contentEditable = 'false'; node.dataset.texteditBlockId = block.id; node.dataset.texteditFileId = block.fileId;
        const button = ownerDocument.createElement('button'); button.type = 'button'; button.textContent = block.name; button.title = `${block.mime} · actual scene file`; button.dataset.texteditAttachmentOpen = block.id;
        const remove = ownerDocument.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${block.name}`); remove.dataset.texteditAttachmentRemove = block.id;
        const projectedAttachment = projected[segmentIndex++];
        node.append(button, remove); fragment.append(node); nextEntries.push({ ...projectedAttachment, node });
      }
    }
    editor.replaceChildren(fragment);
    // Publish only nodes mounted in the original editor, never the staging fragment.
    entries = nextEntries; renderedContent = content; renderedOwner = lease(); renderedRevision = originalDocument.contentRevision;
    if (restore) selectRange(getWindow().selection);
    return true;
  }
  /** Plain overlay rects for misspelled words; rich words are split spans. */
  function paintPlainSpelling() {
    if (!overlay) return;
    overlay.replaceChildren();
    const value = editor.value;
    const issues = spellingIssues.filter(issue => Number.isSafeInteger(issue?.start) && Number.isSafeInteger(issue?.end)
      && issue.start >= 0 && issue.start < issue.end && issue.end <= value.length);
    if (!issues.length || !value.length) return;
    const style = ownerDocument.defaultView.getComputedStyle(editor), mirror = ownerDocument.createElement('div'), marker = ownerDocument.createElement('span');
    marker.textContent = '\u200b';
    mirror.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;';
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'tabSize']) mirror.style[property] = style[property];
    mirror.style.width = `${editor.clientWidth}px`;
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.55;
    ownerDocument.body?.append(mirror);
    try {
      for (const issue of issues) {
        mirror.textContent = value.slice(0, issue.start); mirror.append(marker);
        const top = marker.offsetTop - editor.scrollTop, left = marker.offsetLeft - editor.scrollLeft;
        mirror.textContent = value.slice(0, issue.end); mirror.append(marker);
        const width = Math.abs(marker.offsetLeft - editor.scrollLeft - left);
        const rect = ownerDocument.createElement('span');
        rect.className = 'textedit-spelling-rect';
        rect.style.cssText = `left:${left}px;top:${top}px;width:${Math.max(2, width)}px;height:${Math.round(lineHeight)}px;`;
        overlay.append(rect);
      }
    } finally { mirror.remove(); }
  }
  /** Controller-pushed transient spelling projection. Returns the count applied, or false when unowned. */
  function setSpelling(issues) {
    if (!owned() || !Array.isArray(issues) || issues.length > 1000) return false;
    const valid = issues.filter(issue => issue && typeof issue === 'object' && typeof issue.word === 'string' && issue.word.length <= 128
      && Number.isSafeInteger(issue.start) && Number.isSafeInteger(issue.end) && issue.start >= 0 && issue.start < issue.end);
    spellingIssues = valid.sort((a, b) => a.start - b.start || a.end - b.end);
    if (plain()) paintPlainSpelling();
    else { renderedContent = null; render(true); }
    return valid.length;
  }
  async function commit(content, range, owner) {
    if (!editable() || !current(owner)) return false;
    const result = await send('textedit.input', { content, ...range, ...owner });
    if (!owned()) return false;
    render(true);
    if (result?.status === 'rejected') { onMessage(result.error?.message ?? 'Editing was not applied.'); return false; }
    if (result === false) return false;
    selectRange(getWindow().selection); onMessage(''); return true;
  }
  function replaceSelection(text) {
    const selection = captureSelection(), owner = lease();
    if (!selection || !owner || typeof text !== 'string') return false;
    try { return commit(replaceTextEditRange(originalDocument.content, selection.start, selection.end, text), { start: selection.start + text.replace(/\r\n?/g, '\n').length, end: selection.start + text.replace(/\r\n?/g, '\n').length }, owner); }
    catch (error) { onMessage(error.message); return false; }
  }
  function beforeInput(event) {
    if (!editable()) { event.preventDefault(); return; }
    if (!nativeOwner) nativeOwner = lease();
    if (event.isComposing || event.inputType === 'insertCompositionText') return;
    if (plain()) return;
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault(); send(event.inputType === 'historyUndo' ? 'textedit.undo' : 'textedit.redo'); nativeOwner = null; return;
    }
    const selection = captureSelection(), owner = nativeOwner;
    if (!selection && current(owner) && projectionCurrent() && !segmentsMounted()) {
      // Native replacement may remove rendered descendants before beforeinput.
      // Let its real browser edit finish; input reads fresh plaintext/caret DOM
      // under this original canonical lease, never the detached segment cache.
      const actual = ownerDocument.getSelection();
      const textOperation = event.inputType.startsWith('delete')
        || ['insertText', 'insertReplacementText', 'insertFromYank', 'insertParagraph', 'insertLineBreak', 'insertFromPaste', 'insertFromDrop'].includes(event.inputType);
      if (textOperation && actual?.rangeCount && actual.anchorNode?.ownerDocument === ownerDocument && actual.focusNode?.ownerDocument === ownerDocument
        && editor.contains(actual.anchorNode) && editor.contains(actual.focusNode)) return;
    }
    event.preventDefault(); nativeOwner = null;
    if (!selection || !current(owner)) return;
    let text = event.data;
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') text = '\n';
    else if (event.inputType.startsWith('delete')) text = '';
    else if (!['insertText', 'insertReplacementText', 'insertFromYank'].includes(event.inputType)) { onMessage('Use the scene clipboard or formatting controls for this operation.'); return; }
    if (typeof text !== 'string') return;
    text = text.replace(/\r\n?/g, '\n');
    const range = textEditNativeTypingRange(originalDocument.content, selection, event.inputType);
    try { const content = replaceTextEditRange(originalDocument.content, range.start, range.end, text); const at = range.start + text.length; commit(content, { start: at, end: at }, owner); }
    catch (error) { onMessage(error.message); }
  }
  function input(event) {
    if (composing || event.isComposing) return;
    const owner = nativeOwner ?? renderedOwner; nativeOwner = null;
    // Autofill/paste can emit input without beforeinput. Its source is still the
    // exact canonical revision last projected by this original mounted editor.
    if (!editable() || !current(owner) || !projectionCurrent()) { render(true); return; }
    try {
      if (plain()) commit(createTextEditContent(editor.value, 'plain'), { start: editor.selectionStart, end: editor.selectionEnd }, owner);
      else {
        const actual = readNativeText();
        if (!actual) { render(true); return; }
        const change = textEditNativeDifference(textEditPlainText(renderedContent), actual.text);
        const content = change.start === change.end && !change.text ? renderedContent : replaceTextEditRange(renderedContent, change.start, change.end, change.text);
        const at = change.start + change.text.length;
        commit(content, actual.selection ?? { start: at, end: at }, owner);
      }
    } catch (error) { render(true); onMessage(error.message); }
  }
  function compositionStart() {
    const selection = captureSelection(), owner = lease();
    if (!selection || !owner) return;
    const entry = entries.find(entry => selection.start >= entry.start && selection.end <= entry.end && entry.runs);
    composing = { owner, revision: originalDocument.contentRevision, selection, entry, before: plain() ? editor.value : entry?.text };
    nativeOwner = null;
  }
  function compositionEnd() {
    const snapshot = composing; composing = null; nativeOwner = null;
    if (!snapshot || !current(snapshot.owner) || snapshot.revision !== originalDocument.contentRevision || snapshot.before === undefined
      || !plain() && (!segmentsMounted() || !entries.includes(snapshot.entry))) { render(true); return; }
    const after = (plain() ? editor.value : snapshot.entry.node.textContent).replace(/\r\n?/g, '\n');
    const change = textEditNativeDifference(snapshot.before, after), base = plain() ? 0 : snapshot.entry.start;
    try {
      const content = replaceTextEditRange(originalDocument.content, base + change.start, base + change.end, change.text), at = base + change.start + change.text.length;
      commit(content, { start: at, end: at }, snapshot.owner);
    } catch (error) { render(true); onMessage(error.message); }
  }
  function tableContext() {
    const selection = captureSelection() ?? getWindow()?.selection;
    return selection ? textEditNativeSegments(originalDocument.content).find(entry => entry.type === 'table' && selection.start >= entry.start && selection.start <= entry.end) ?? null : null;
  }
  async function navigateTable(backward = false) {
    const context = tableContext(); if (!context || !editable()) return false;
    const cells = textEditNativeSegments(originalDocument.content).filter(entry => entry.blockId === context.blockId), index = cells.findIndex(entry => entry.row === context.row && entry.column === context.column);
    let next = cells[index + (backward ? -1 : 1)];
    if (!next && !backward) {
      const result = await send('textedit.table', { action: 'add-row', blockId: context.blockId, row: context.row });
      if (!owned() || result?.status !== 'applied') return false;
      render(true); next = textEditNativeSegments(originalDocument.content).find(entry => entry.blockId === context.blockId && entry.row === context.row + 1 && entry.column === 0);
    }
    if (!next) return false;
    const selected = selectRange({ start: next.start, end: next.end }); if (selected) observeSelection(); return selected;
  }
  function keydown(event) {
    if (!editable() || composing || event.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
    if (modifier) {
      const command = key === 'z' ? (event.shiftKey ? 'textedit.redo' : 'textedit.undo') : key === 'y' ? 'textedit.redo' : key === 's' ? (event.shiftKey ? 'textedit.saveAs' : 'textedit.save') : key === 'n' ? 'textedit.new' : key === 'o' ? 'textedit.dialog' : key === 'f' || key === 'h' ? 'textedit.dialog' : key === 'a' ? 'textedit.clipboard' : key === 'b' || key === 'i' || key === 'u' ? 'textedit.format' : key === 'g' && plain() ? 'textedit.dialog' : null;
      if (command) {
        event.preventDefault(); observeSelection();
        if (key === 's' && event.shiftKey) send('textedit.dialog', { kind: 'save' });
        else if (key === 'o') send(command, { kind: 'open' });
        else if (key === 'f' || key === 'h') send(command, { kind: 'find' });
        else if (key === 'g' && plain()) send(command, { kind: 'goto' });
        else if (key === 'a') send(command, { action: 'select-all' });
        else if (['b', 'i', 'u'].includes(key) && originalDocument.content.kind === 'rich') { const field = { b: 'bold', i: 'italic', u: 'underline' }[key]; send(command, { [field]: !selectionStyle()[field] }); }
        else if (!['b', 'i', 'u'].includes(key)) send(command, key === 'n' ? { kind: originalDocument.content.kind } : {});
      }
    } else if (plain() && (event.key === 'F5' || event.key === 'Escape')) {
      if (event.key === 'F5') { event.preventDefault(); observeSelection(); send('textedit.timeDate'); }
    } else if (event.key === 'Tab' && !plain()) {
      event.preventDefault(); if (tableContext()) navigateTable(event.shiftKey); else replaceSelection('\t');
    }
  }
  function selectionStyle() {
    const selection = captureSelection() ?? getWindow()?.selection ?? { start: 0, end: 0 };
    const entry = textEditNativeSegments(originalDocument.content).find(entry => entry.runs && selection.start >= entry.start && selection.start <= entry.end);
    let offset = entry?.start ?? 0, marks = entry?.runs?.[0]?.marks ?? TEXTEDIT_MARK_DEFAULTS;
    for (const run of entry?.runs ?? []) { if (selection.start <= offset + run.text.length) { marks = run.marks; break; } offset += run.text.length; }
    const block = originalDocument.content.blocks.find(block => block.id === entry?.blockId);
    if (selection.start === selection.end && getWindow()?.typingMarks) marks = getWindow().typingMarks;
    return { ...marks, align: block?.align ?? 'left', spacing: block?.spacing ?? 1, indent: block?.indent ?? 0, list: block?.list ?? 'none', tabs: block?.tabs ?? [] };
  }
  function clipboard(event) { if (!editable()) return; event.preventDefault(); observeSelection(); send('textedit.clipboard', { action: event.type }); }
  function click(event) {
    const remove = event.target.closest('[data-textedit-attachment-remove]'), open = event.target.closest('[data-textedit-attachment-open]');
    if (remove || open) {
      event.preventDefault();
      const blockId = (remove ?? open).dataset[remove ? 'texteditAttachmentRemove' : 'texteditAttachmentOpen'];
      const block = originalDocument.content.blocks.find(item => item.id === blockId && item.type === 'attachment');
      if (open && block && typeof onAttachmentPreview === 'function' && /^(image\/(?:png|jpeg|gif|webp)|application\/pdf)$/i.test(block.mime)) onAttachmentPreview(block);
      else send('textedit.attachment', { action: remove ? 'remove' : 'open', blockId });
    }
    const link = event.target.closest('[data-textedit-link]'); if (link && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send('textedit.openLink', { url: link.dataset.texteditLink }); }
    observeSelection();
  }
  function drop(event) {
    event.preventDefault(); if (!editable()) return;
    const fileId = event.dataTransfer?.getData('application/x-jester-file-id');
    if (fileId) send('textedit.attachment', { action: 'insert', fileId }); else onMessage('Drag a file from this scene’s Files. Host files are not imported.');
  }
  const listeners = { beforeinput: beforeInput, input, compositionstart: compositionStart, compositionend: compositionEnd, keydown, click, keyup: observeSelection, select: observeSelection, focusin: observeSelection, copy: clipboard, cut: clipboard, paste: clipboard, dragover: event => event.preventDefault(), drop };
  for (const [event, listener] of Object.entries(listeners)) editor.addEventListener(event, listener);
  editor.addEventListener('scroll', paintPlainSpelling);
  ownerDocument.addEventListener('selectionchange', observeSelection);
  overlay = ownerDocument.createElement('div');
  overlay.className = 'textedit-spelling-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  editor.parentElement?.append(overlay);
  render(true);
  return {
    available: () => owned() && mounted(root), focus, captureSelection, selectRange, replaceSelection, render, selectionStyle, tableContext,
    documentId: () => owned() ? originalDocument.id : null,
    generation: () => owned() ? originalDocument.generation : null,
    setSpelling, setFiles(files) { if (!owned() || !Array.isArray(files)) return false; fileChoices = files.filter(file => file && typeof file.id === 'string' && typeof file.name === 'string'); onFiles(fileChoices); return true; },
    files: () => owned() ? fileChoices : [],
    describe: () => owned() ? { documentId: originalDocument.id, generation: originalDocument.generation, selection: captureSelection(), composing: !!composing, scroll: { top: editor.scrollTop, left: editor.scrollLeft }, controlIds: [...root.querySelectorAll('[data-textedit-control]')].filter(node => mounted(node)).map(node => node.dataset.texteditControl) } : null,
    destroy() {
      disposed = true;
      for (const [event, listener] of Object.entries(listeners)) editor.removeEventListener(event, listener);
      editor.removeEventListener('scroll', paintPlainSpelling);
      ownerDocument.removeEventListener('selectionchange', observeSelection);
      overlay?.remove(); overlay = null;
    }
  };
}
