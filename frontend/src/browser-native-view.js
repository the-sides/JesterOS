import { selectNativeText } from './text-native-selection.js';

// Records and the mounted root are captured once; a replacement never borrows
// focus, a page range, an awaited clipboard transaction or a scrolling surface.
// Native typing undo/redo is local DOM observation only: entries are captured
// from real beforeinput/input events and every restore commits canonically
// through the bridge — there is no shadow authoritative draft here.
export function createBrowserNativeView({ getRoot, getState, windowId, available: isAvailable, tick }) {
  const state = getState();
  let root = null;
  let findCount = 0;
  let findOwner = null;
  let pendingType = null;
  let listenersAttached = false;
  let outlined = null;
  const histories = new Map();
  const owned = () => {
    root ??= getRoot();
    if (root?.isConnected === true && getRoot() === root && getState() === state
      && root.dataset.browserWindowId === windowId && isAvailable() === true) {
      attachHistoryListeners();
      return true;
    }
    return false;
  };
  function attachHistoryListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    root.addEventListener('beforeinput', () => {
      const node = root?.ownerDocument.activeElement;
      if (!owned() || !node?.isConnected || !editable(node) || !node.dataset.browserControl) { pendingType = null; return; }
      pendingType = { node, owner: capture(), controlId: node.dataset.browserControl, before: node.value,
        beforeRange: { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none' } };
    });
    root.addEventListener('input', event => {
      const node = event.target;
      if (!owned() || !pendingType || !node?.isConnected || !editable(node)
        || node !== pendingType.node || !same(pendingType.owner)
        || node.dataset.browserControl !== pendingType.controlId) { pendingType = null; return; }
      const history = histories.get(pendingType.controlId) ?? { undo: [], redo: [] };
      history.redo.length = 0;
      history.undo.push({ controlId: pendingType.controlId, before: pendingType.before,
        beforeRange: pendingType.beforeRange, after: node.value, owner: pendingType.owner,
        afterRange: { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none' } });
      if (history.undo.length > 32) history.undo.shift();
      histories.set(pendingType.controlId, history);
      pendingType = null;
    });
  }
  function mounted(node) {
    if (!owned() || !node?.isConnected || !root.contains(node) || node.disabled) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const controls = () => owned() ? [...root.querySelectorAll('[data-browser-control]')].filter(mounted) : [];
  const control = id => controls().find(node => node.dataset.browserControl === id);
  const areas = () => owned() ? [...root.querySelectorAll('[data-browser-area]')].filter(mounted) : [];
  const area = id => areas().find(node => node.dataset.browserArea === id);
  const guarded = guard => owned() && (typeof guard !== 'function' || guard() === true) && owned();
  function capture() {
    const windows = state.windows, window = windows.find(row => row.id === windowId);
    const tabs = window?.tabs, tab = tabs?.find(row => row.id === window.activeTabId);
    return { windows, window, tabs, tab, entries: tab?.entries, entry: tab ? tab.entries[tab.index] : null, index: tab?.index, token: tab?.loadToken };
  }
  function same(owner) {
    const current = capture();
    return Object.keys(owner).every(key => current[key] === owner[key]);
  }
  const position = node => ({ top: node.scrollTop, left: node.scrollLeft });
  const editable = node => node && !node.readOnly && typeof node.selectionStart === 'number' && typeof node.setSelectionRange === 'function';
  function selection() {
    const node = root?.ownerDocument.activeElement;
    if (mounted(node) && typeof node.selectionStart === 'number') return { controlId: node.dataset.browserControl ?? null, value: node.value, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection, text: node.value.slice(node.selectionStart, node.selectionEnd), editable: editable(node) };
    const selected = root?.ownerDocument.getSelection();
    if (!selected?.rangeCount || !root.contains(selected.anchorNode) || !root.contains(selected.focusNode)) return null;
    return { controlId: null, text: selected.toString(), editable: false };
  }
  function describe() {
    const nodes = controls(), scrolls = {};
    for (const node of areas()) scrolls[node.dataset.browserArea] = position(node);
    const active = root?.ownerDocument.activeElement;
    const nativeHistory = mounted(active) && editable(active) && active.dataset.browserControl
      ? histories.get(active.dataset.browserControl) : null;
    const image = root?.querySelector('[data-browser-svg-file]');
    const svg = image && mounted(image) ? { fileId: image.dataset.browserSvgFile, revision: Number(image.dataset.browserSvgRevision), complete: image.complete, width: image.naturalWidth, height: image.naturalHeight } : null;
    return { controlIds: nodes.map(node => node.dataset.browserControl), focusedControl: nodes.find(node => node.ownerDocument.activeElement === node)?.dataset.browserControl ?? null,
      selection: selection(), scrolls, findCount: findOwner && same(findOwner) ? findCount : 0,
      inspectorNodeIds: inspectableNodes().map(node => node.dataset.browserNode), svg,
      canUndo: Boolean(nativeHistory?.undo.at(-1) && same(nativeHistory.undo.at(-1).owner) && nativeHistory.undo.at(-1).after === active.value),
      canRedo: Boolean(nativeHistory?.redo.at(-1) && same(nativeHistory.redo.at(-1).owner) && nativeHistory.redo.at(-1).before === active.value) };
  }
  async function prepare(id, guard) {
    const node = control(id), owner = capture();
    if (!node || !guarded(guard)) return false;
    await tick();
    return guarded(guard) && same(owner) && node === control(id);
  }
  async function focus(id, guard) {
    const node = control(id), owner = capture();
    if (!node || !guarded(guard)) return false;
    await tick();
    if (!guarded(guard) || !same(owner) || node !== control(id)) return false;
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!guarded(guard) || !same(owner) || node !== control(id)) return false;
    node.focus({ preventScroll: true });
    if (id === 'address' && guarded(guard) && same(owner) && node === control(id)) node.select();
    return guarded(guard) && same(owner) && node === control(id) && node.ownerDocument.activeElement === node;
  }
  async function scroll(id, offsets, guard) {
    const node = area(id), owner = capture();
    if (!node || !guarded(guard) || !Number.isFinite(offsets.top) || !Number.isFinite(offsets.left)) return null;
    await tick();
    if (!guarded(guard) || !same(owner) || node !== area(id)) return null;
    node.scrollTop = offsets.top; node.scrollLeft = offsets.left;
    return guarded(guard) && same(owner) && node === area(id) ? position(node) : null;
  }
  async function find(query, index, guard) {
    const node = area('page'), owner = capture();
    if (!node || !guarded(guard)) return null;
    await tick();
    if (!guarded(guard) || !same(owner) || node !== area('page')) return null;
    const document = node.ownerDocument, content = node.querySelector('[data-browser-page-text]');
    const ranges = [], pieces = [];
    if (content && query) {
      const walker = document.createTreeWalker(content, 4);
      let text, combined = '';
      while ((text = walker.nextNode())) {
        if (!mounted(text.parentElement) || text.parentElement.closest('button,input,textarea,select,script,style,[aria-hidden="true"]')) continue;
        pieces.push({ node: text, start: combined.length }); combined += text.data;
      }
      const haystack = combined.toLocaleLowerCase(), needle = query.toLocaleLowerCase();
      for (let at = haystack.indexOf(needle); at >= 0 && ranges.length < 10000; at = haystack.indexOf(needle, at + needle.length)) {
        const first = pieces.findLast(piece => piece.start <= at), last = pieces.findLast(piece => piece.start < at + needle.length);
        if (!first || !last) continue;
        const range = document.createRange();
        range.setStart(first.node, at - first.start); range.setEnd(last.node, at + needle.length - last.start); ranges.push(range);
      }
    }
    if (!guarded(guard) || !same(owner)) return null;
    findCount = ranges.length; findOwner = owner;
    const selected = document.getSelection();
    if (!ranges.length) {
      if (selected?.rangeCount && content?.contains(selected.anchorNode)) selected.removeAllRanges();
      return { count: 0, index: 0 };
    }
    const current = ((index % ranges.length) + ranges.length) % ranges.length;
    selected.removeAllRanges(); selected.addRange(ranges[current]);
    const rect = ranges[current].getBoundingClientRect(), bounds = node.getBoundingClientRect();
    if (rect.top < bounds.top || rect.bottom > bounds.bottom) node.scrollTop += rect.top - bounds.top - node.clientHeight / 3;
    return guarded(guard) && same(owner) && node === area('page') ? { count: ranges.length, index: current } : null;
  }
  async function clipboard(operation, bridge, guard) {
    if (!guarded(guard)) return false;
    const owner = capture(), node = root?.ownerDocument.activeElement, source = selection();
    const id = source?.controlId ?? null, writable = editable(node) && node.dataset.browserControl ? editable(node) : false;
    const value = writable ? node.value : null;
    const start = source?.start ?? 0, end = source?.end ?? 0, direction = source?.direction ?? 'none';
    const exact = () => guarded(guard) && same(owner) && (writable
      ? node === control(id) && node.value === value && node.selectionStart === start && node.selectionEnd === end
      : selection()?.text === source?.text);
    if (operation === 'selectAll') {
      if (writable && id) return selectNativeText(node, { start: 0, end: value.length }, { reveal: false })
        && exactSelection(node, 0, value.length) && guarded(guard) && same(owner);
      const page = area('page')?.querySelector('[data-browser-page-text]');
      if (!page) return false;
      const range = page.ownerDocument.createRange(); range.selectNodeContents(page);
      const selected = page.ownerDocument.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      return guarded(guard) && same(owner) && selected.containsNode(page, true);
    }
    if (!source) return false;
    if (operation === 'copy' || operation === 'cut') {
      if (!source.text || operation === 'cut' && !writable || typeof bridge.write !== 'function') return false;
      if (await bridge.write(source.text) !== true) return false;
      if (operation === 'copy') return { status: 'applied', presentationAvailable: exact() };
      if (!exact()) return false;
    }
    if (!writable || typeof bridge.commit !== 'function') return false;
    const history = histories.get(id) ?? { undo: [], redo: [] };
    const entry = (operation === 'undo' ? history.undo : history.redo).at(-1);
    let insertion = '', next, range;
    if (operation === 'paste') {
      if (typeof bridge.read !== 'function') return false;
      insertion = await bridge.read();
      if (typeof insertion !== 'string' || !exact()) return false;
      if (node.tagName !== 'TEXTAREA') insertion = insertion.replace(/[\r\n]/g, '');
    }
    if (operation === 'undo' || operation === 'redo') {
      if (!entry || !same(entry.owner) || value !== (operation === 'undo' ? entry.after : entry.before)) return false;
      next = operation === 'undo' ? entry.before : entry.after;
      range = operation === 'undo' ? entry.beforeRange : entry.afterRange;
    } else if (operation === 'paste' || operation === 'cut') {
      next = value.slice(0, start) + insertion + value.slice(end);
      range = { start: start + insertion.length, end: start + insertion.length, direction: 'none' };
    } else return false;
    if (!exact() || node.maxLength >= 0 && next.length > node.maxLength) return false;
    const result = await bridge.commit(id, next);
    if (result?.status !== 'applied') return false;
    // The commit is acknowledged independently of its original precommit
    // guard, which the canonical edit itself may invalidate. Presentation
    // still belongs exclusively to the captured owner and original node.
    const presented = () => owned() && same(owner) && node === control(id);
    if (result.presentationAvailable === false || !presented())
      return { ...result, presentationAvailable: false };
    await tick();
    if (!presented() || node.value !== next) return { ...result, presentationAvailable: false };
    if (operation === 'undo' || operation === 'redo') { (operation === 'undo' ? history.undo : history.redo).pop(); (operation === 'undo' ? history.redo : history.undo).push(entry); }
    else { history.redo.length = 0; history.undo.push({ controlId: id, before: value, after: next, owner,
      beforeRange: { start, end, direction }, afterRange: range });
      if (history.undo.length > 32) history.undo.shift(); }
    histories.set(id, history);
    const restored = selectNativeText(node, range, { reveal: false });
    return { ...result, presentationAvailable: restored && presented() && node.value === next && exactSelection(node, range.start, range.end) };
  }
  const inspectableNodes = () => owned()
    ? [...root.querySelectorAll('[data-browser-node]')].filter(mounted).slice(0, 256) : [];
  function parentIdOf(node) {
    return node.parentElement?.closest('[data-browser-node]')?.dataset.browserNode ?? null;
  }
  function inspectTree(guard) {
    const owner = capture();
    if (!guarded(guard)) return null;
    const observed = inspectableNodes().map(node => ({ id: node.dataset.browserNode,
      tag: node.tagName.toLowerCase(), parentId: parentIdOf(node),
      textPreview: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) }));
    return guarded(guard) && same(owner) ? observed : null;
  }
  function inspect(nodeId, guard) {
    const owner = capture();
    if (!owned() || typeof nodeId !== 'string' || !nodeId || !guarded(guard)) return null;
    const node = [...root.querySelectorAll('[data-browser-node]')]
      .find(candidate => candidate.dataset.browserNode === nodeId && mounted(candidate));
    if (!node) return null;
    if (!guarded(guard) || !same(owner)) return null;
    if (outlined && outlined.isConnected) outlined.style.outline = '';
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!guarded(guard) || !same(owner)) return null;
    outlined = node;
    node.style.outline = '2px solid var(--browser-accent)';
    setTimeout(() => { if (outlined === node) { node.style.outline = ''; outlined = null; } }, 1400);
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    const observed = { id: nodeId, tag: node.tagName.toLowerCase(),
      attributes: Object.fromEntries(node.getAttributeNames().map(name => [name, node.getAttribute(name)])),
      text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
      rect: (({ x, y, width, height }) => ({ x, y, width, height }))(node.getBoundingClientRect()),
      computed: { color: style.color, fontSize: style.fontSize, display: style.display } };
    return guarded(guard) && same(owner) ? observed : null;
  }
  return { available: () => owned() && mounted(root), describe, prepare, focus, scroll, find, clipboard, inspectTree, inspect };
}

function exactSelection(node, start, end) { return node.selectionStart === start && node.selectionEnd === end; }
