import { previewExportModel, previewLocked, previewPageCount, previewSearch } from './preview-state.js';
import { decodePreviewData, exportPreviewPdf, openPreviewPdf, previewImageGeometry } from './preview-codec.js';

const MAX_PIXELS = 16 * 1024 * 1024;
const ALWAYS = () => true;
let renderer;
async function pdfRenderer() {
  renderer ??= (typeof process !== 'undefined' && process.versions?.node
    ? import('pdfjs-dist/legacy/build/pdf.mjs')
    : Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([library, worker]) => { library.GlobalWorkerOptions.workerSrc = worker.default; return library; }))
    .catch(error => { renderer = undefined; throw error; });
  return renderer;
}

// PDF.js lays text out in the unrotated crop box and rotates the complete layer.
// Keep its positioning/font variables, without importing the viewer's global UI CSS.
const TEXT_STYLE = `
[data-preview-native-text] { position:absolute; inset:0; overflow:clip; line-height:1; text-align:initial; letter-spacing:normal; word-spacing:normal; text-size-adjust:none; forced-color-adjust:none; transform-origin:0 0; user-select:text; --min-font-size:1; --text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size)); --min-font-size-inv:calc(1 / var(--min-font-size)); }
[data-preview-native-text] :is(span,br) { color:transparent; position:absolute; white-space:pre; cursor:text; transform-origin:0 0; user-select:text; }
[data-preview-native-text] > :not(.markedContent), [data-preview-native-text] .markedContent span:not(.markedContent) { z-index:1; --font-height:0; font-size:calc(var(--text-scale-factor) * var(--font-height)); --scale-x:1; --rotate:0deg; transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
[data-preview-native-text] .markedContent { display:contents; }
[data-preview-native-text] mark { color:transparent; background:rgb(255 211 0 / .42); padding:0; font:inherit; }
[data-preview-native-text] mark[data-preview-current-match] { background:rgb(255 145 0 / .65); }
[data-preview-native-text] ::selection { color:transparent; background:rgb(0 90 255 / .3); }
[data-preview-native-text][data-main-rotation="90"] { transform:rotate(90deg) translateY(-100%); }
[data-preview-native-text][data-main-rotation="180"] { transform:rotate(180deg) translate(-100%,-100%); }
[data-preview-native-text][data-main-rotation="270"] { transform:rotate(270deg) translateX(-100%); }
`;

function visible(root, node = root) {
  if (!root?.isConnected || !node?.isConnected || !root.contains(node)
    || !node.getClientRects?.().length) return false;
  const view = root.ownerDocument?.defaultView;
  if (!view) return false;
  for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.inert || ancestor.hasAttribute?.('inert')) return false;
    const style = view.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
      || style.opacity === '0') return false;
  }
  return true;
}
function connected(root, node) { return !!node?.isConnected && root.contains(node); }
function retire(resource) { if (resource) Promise.resolve(resource.destroy()).catch(() => {}); }

/** Convert client coordinates through the ORIGINAL PDF.js viewport, including
 * CropBox origin, /Rotate, CSS scaling and /UserUnit. Canonical units are points
 * from the unrotated effective crop box's top-left, not canvas/device pixels. */
export function previewPdfSourcePoint(viewport, bounds, clientX, clientY) {
  if (!viewport || !bounds || !Number.isFinite(clientX) || !Number.isFinite(clientY)
    || !(bounds.width > 0) || !(bounds.height > 0) || !(viewport.width > 0) || !(viewport.height > 0)
    || clientX < bounds.left || clientX > bounds.left + bounds.width
    || clientY < bounds.top || clientY > bounds.top + bounds.height) return null;
  const [pdfX, pdfY] = viewport.convertToPdfPoint(
    (clientX - bounds.left) * viewport.width / bounds.width,
    (clientY - bounds.top) * viewport.height / bounds.height);
  const [x0, y0, x1, y1] = viewport.viewBox, unit = viewport.userUnit || 1;
  const width = (x1 - x0) * unit, height = (y1 - y0) * unit;
  const x = (pdfX - x0) * unit, y = (y1 - pdfY) * unit;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -1e-6 || y < -1e-6
    || x > width + 1e-6 || y > height + 1e-6) return null;
  return { x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)) };
}
export function previewPdfSourceRect(viewport, bounds, rect) {
  if (!rect || !bounds || !(rect.width > 0) || !(rect.height > 0)) return null;
  const left = Math.max(bounds.left, rect.left), top = Math.max(bounds.top, rect.top);
  const right = Math.min(bounds.left + bounds.width, rect.left + rect.width);
  const bottom = Math.min(bounds.top + bounds.height, rect.top + rect.height);
  if (!(right > left) || !(bottom > top)) return null;
  const points = [[left, top], [right, top], [left, bottom], [right, bottom]]
    .map(([x, y]) => previewPdfSourcePoint(viewport, bounds, x, y));
  if (points.some(point => !point)) return null;
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x,
    height: Math.max(...points.map(point => point.y)) - y };
}

/** Source rectangle to canvas-local CSS pixels, for selection feedback only. */
export function previewPdfProjectedRect(viewport, bounds, rect) {
  if (!viewport || !bounds || !rect || !(bounds.width > 0) || !(bounds.height > 0)
    || !(viewport.width > 0) || !(viewport.height > 0)
    || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || rect.x < 0 || rect.y < 0 || rect.width < 0 || rect.height < 0) return null;
  const [x0, y0, x1, y1] = viewport.viewBox, unit = viewport.userUnit || 1;
  if (rect.x + rect.width > (x1 - x0) * unit || rect.y + rect.height > (y1 - y0) * unit) return null;
  const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
    .map(([x, y]) => viewport.convertToViewportPoint(x0 + x / unit, y1 - y / unit))
    .map(([x, y]) => [x * bounds.width / viewport.width, y * bounds.height / viewport.height]);
  const left = Math.min(...points.map(point => point[0])), top = Math.min(...points.map(point => point[1]));
  return { left, top, width: Math.max(...points.map(point => point[0])) - left,
    height: Math.max(...points.map(point => point[1])) - top };
}

/** The only selection source is actual ranges wholly inside this original PDF
 * text layer. The supplied guard pins the rendered revision and original refs. */
export function capturePreviewPdfSelection({ root, canvas, textLayer, viewport }, guard = ALWAYS) {
  const live = () => guard() && connected(root, canvas) && connected(root, textLayer) && root.isConnected;
  if (!live()) return null;
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !textLayer.contains(selection.anchorNode)
    || !textLayer.contains(selection.focusNode)) return null;
  const bounds = canvas.getBoundingClientRect(), rects = [], texts = [], seen = new Set();
  for (let index = 0; index < selection.rangeCount; index++) {
    if (!live()) return null;
    const range = selection.getRangeAt(index);
    if (!textLayer.contains(range.startContainer) || !textLayer.contains(range.endContainer)) return null;
    texts.push(range.toString());
    for (const rect of range.getClientRects()) {
      if (!live()) return null;
      const converted = previewPdfSourceRect(viewport, bounds, rect);
      if (!converted || !converted.width || !converted.height) continue;
      const key = [converted.x, converted.y, converted.width, converted.height].join(',');
      if (!seen.has(key)) { seen.add(key); rects.push(converted); }
    }
  }
  const text = texts.join('\n');
  return text && rects.length && live() ? { text, rects } : null;
}
function canvasSize(viewport, devicePixelRatio) {
  const ratio = Math.min(2, Math.max(1, devicePixelRatio || 1),
    16384 / viewport.width, 16384 / viewport.height,
    Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
  const height = Math.max(1, Math.min(MAX_PIXELS, Math.floor(viewport.height * ratio)));
  const width = Math.max(1, Math.min(Math.floor(MAX_PIXELS / height), Math.floor(viewport.width * ratio)));
  return { width, height, sx: width / viewport.width, sy: height / viewport.height };
}
function displayScale(reader, width, height, settings) {
  if (settings.fit === 'actual') return 1;
  if (settings.fit === 'custom') return settings.zoom;
  const availableWidth = Math.max(1, reader.clientWidth - 32);
  const availableHeight = Math.max(1, reader.clientHeight - 32);
  return settings.fit === 'page' ? Math.min(availableWidth / width, availableHeight / height)
    : availableWidth / width;
}
function decorateSearch(layer, textContent, query, document, session) {
  if (!query) return;
  const segments = [], items = textContent.items.filter(item => typeof item.str === 'string');
  let source = '';
  items.forEach((item, index) => {
    segments.push({ start: source.length, end: source.length + item.str.length, node: layer.textDivs[index], text: item.str });
    source += item.str + (item.hasEOL ? '\n' : ' ');
  });
  const needle = query.toLocaleLowerCase('en-US'), lower = source.toLocaleLowerCase('en-US');
  const canonical = previewSearch(document, query), selected = canonical[session.match];
  const selectedIndex = selected?.page === session.page
    ? canonical.slice(0, session.match).filter(match => match.page === session.page).length : -1;
  const matches = [];
  for (let start = 0, at; (at = lower.indexOf(needle, start)) !== -1; start = at + Math.max(1, needle.length))
    matches.push({ start: at, end: at + query.length, selected: matches.length === selectedIndex });
  let first = 0;
  for (const segment of segments) {
    if (!segment.node || !segment.text) continue;
    while (matches[first]?.end <= segment.start) first++;
    const fragment = segment.node.ownerDocument.createDocumentFragment();
    let cursor = 0, changed = false;
    for (let index = first; matches[index]?.start < segment.end; index++) {
      const match = matches[index], start = Math.max(segment.start, match.start) - segment.start;
      const end = Math.min(segment.end, match.end) - segment.start;
      if (end <= start) continue;
      fragment.append(segment.node.ownerDocument.createTextNode(segment.text.slice(cursor, start)));
      const mark = segment.node.ownerDocument.createElement('mark');
      mark.textContent = segment.text.slice(start, end);
      if (match.selected) mark.setAttribute('data-preview-current-match', '');
      fragment.append(mark); cursor = end; changed = true;
    }
    if (changed) {
      fragment.append(segment.node.ownerDocument.createTextNode(segment.text.slice(cursor)));
      segment.node.replaceChildren(fragment);
    }
  }
}

/** Create only after the native root is mounted. A replacement root needs a NEW
 * facade. Getters are live canonical identities; no document/session is copied
 * into a second authority. PDF resources and render tickets are per-view only. */
export function createPreviewNativeView({ getRoot, getReader, getCanvas, getTextLayer,
  getImage, getThumbnails = () => [], getDocument, getSession, isAvailable, windowId }) {
  const originalRoot = getRoot();
  let destroyed = false, ticket = 0, job = null, cached = null, rendered = null, styleNode = null, lastError = '', readingBinding = null;
  const available = () => !destroyed && getRoot() === originalRoot
    && originalRoot?.getAttribute('data-preview-window') === windowId
    && isAvailable() === true && visible(originalRoot);
  function clearReadingProgress(fileId = null) {
    if (!readingBinding || fileId !== null && readingBinding.fileId !== fileId) return false;
    readingBinding = null; return true;
  }
  function bindReadingProgress({ documentId, fileId, fileRevision, guard, onReadingProgress }) {
    const document = getDocument(), session = getSession();
    if (destroyed || !available() || typeof guard !== 'function' || !guard()
      || typeof onReadingProgress !== 'function' || document?.mime !== 'application/pdf'
      || document.id !== documentId || document.fileId !== fileId || document.fileRevision !== fileRevision
      || session?.windowId !== windowId || session.selectedId !== documentId) return false;
    readingBinding = { document, session, documentId, fileId, fileRevision, guard, onReadingProgress };
    return true;
  }
  function snapshot(guard) {
    if (typeof guard !== 'function' || !guard() || !available()) return null;
    const document = getDocument(), session = getSession();
    if (!session || session.windowId !== windowId || document && session.selectedId !== document.id) return null;
    return { root: originalRoot, reader: getReader(), canvas: getCanvas(), text: getTextLayer(), image: getImage(),
      readerWidth: getReader()?.clientWidth, readerHeight: getReader()?.clientHeight,
      document, session, documentId: document?.id ?? null, revision: document?.revision,
      fileId: document?.fileId, fileRevision: document?.fileRevision, content: document?.content,
      edits: document?.edits, imageContent: document?.edits.imageContent, unlocked: document?.unlocked,
      thumbnails: session.sidebar === 'thumbnails'
        ? getThumbnails().map(item => ({ canvas: item.canvas, page: item.page })) : [],
      settings: { page: session.page, zoom: session.zoom, fit: session.fit, query: session.query,
        match: session.match, sidebar: session.sidebar, top: session.scroll.top, left: session.scroll.left }, guard };
  }
  function current(owner) {
    if (!owner || !owner.guard() || !available() || getDocument() !== owner.document
      || getSession() !== owner.session || getReader() !== owner.reader || getCanvas() !== owner.canvas
      || getTextLayer() !== owner.text || getImage() !== owner.image
      || owner.session.windowId !== windowId || owner.session.selectedId !== owner.documentId) return false;
    const document = owner.document, session = owner.session, settings = owner.settings;
    return (!document || document.id === owner.documentId && document.revision === owner.revision
      && document.fileId === owner.fileId && document.fileRevision === owner.fileRevision
      && document.content === owner.content && document.edits === owner.edits
      && document.edits.imageContent === owner.imageContent && document.unlocked === owner.unlocked)
      && session.page === settings.page && session.zoom === settings.zoom && session.fit === settings.fit
      && session.query === settings.query && session.match === settings.match && session.sidebar === settings.sidebar
      && session.scroll.top === settings.top && session.scroll.left === settings.left
      && owner.reader?.clientWidth === owner.readerWidth && owner.reader?.clientHeight === owner.readerHeight
      && (!owner.reader || connected(owner.root, owner.reader));
  }
  function cancel() {
    if (job) { for (const task of job.tasks) task.cancel(); job.tasks.clear(); }
    job = null;
  }
  function clearRendered() { rendered = null; }
  function currentRendered() {
    if (!rendered) return null;
    const owner = rendered.owner, session = getSession(), reader = getReader();
    // Native scrolling does not replace a PDF or its text nodes. Rebase only
    // after the SAME reader's measured offsets match canonical acknowledgement.
    if (owner.session === session && owner.reader === reader && session
      && reader?.scrollTop === session.scroll.top && reader?.scrollLeft === session.scroll.left) {
      owner.settings.top = session.scroll.top; owner.settings.left = session.scroll.left;
    }
    if (!current(owner) || previewLocked(owner.document)) return null;
    if (rendered.kind === 'pdf' && (!connected(owner.root, owner.canvas) || !connected(owner.root, owner.text)
      || !visible(owner.root, owner.canvas) || !visible(owner.root, owner.text)
      || owner.canvas.width !== rendered.canvasWidth || owner.canvas.height !== rendered.canvasHeight
      || owner.text.childNodes.length !== rendered.textChildren.length
      || rendered.textChildren.some((node, index) => owner.text.childNodes[index] !== node)
      || rendered.textNodes.some(({ node, text }) => !owner.text.contains(node) || node.textContent !== text))) return null;
    if (rendered.kind === 'image' && (!visible(owner.root, owner.image)
      || owner.image.getAttribute('src') !== rendered.source)) return null;
    return rendered;
  }
  function installTextStyle(owner) {
    if (!styleNode) {
      styleNode = owner.root.ownerDocument.createElement('style');
      styleNode.textContent = TEXT_STYLE; owner.root.append(styleNode);
    }
    owner.text.classList.add('textLayer');
    owner.text.setAttribute('data-preview-native-text', windowId);
  }
  function restoreScroll(owner, guard) {
    if (!guard()) return false;
    owner.reader.scrollTop = owner.settings.top;
    if (!guard()) return false;
    owner.reader.scrollLeft = owner.settings.left;
    return guard();
  }
  async function resourceFor(owner, guard) {
    if (!guard()) return null;
    const editKey = JSON.stringify(owner.document.edits);
    if (cached && cached.documentId === owner.documentId && cached.fileId === owner.fileId
      && cached.revision === owner.revision && cached.fileRevision === owner.fileRevision
      && cached.content === owner.content && cached.editKey === editKey)
      return cached.resource;
    retire(cached?.resource); cached = null;
    if (!guard()) return null;
    // Mark appearances, signatures, forms, page order and /Rotate are genuine
    // serialized PDF edits; there is deliberately no separate painted overlay.
    const output = await exportPreviewPdf(previewExportModel(owner.document), { guard });
    if (!guard()) return null;
    const resource = await openPreviewPdf(output.text, { guard });
    if (!guard()) { retire(resource); return null; }
    cached = { documentId: owner.documentId, fileId: owner.fileId, revision: owner.revision,
      fileRevision: owner.fileRevision, content: owner.content, editKey, resource };
    return resource;
  }
  async function paint(page, canvas, viewport, guard, activeJob) {
    if (!guard()) return false;
    const size = canvasSize(viewport, originalRoot.ownerDocument.defaultView.devicePixelRatio);
    canvas.width = size.width; canvas.height = size.height;
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context || !guard()) return false;
    const task = page.render({ canvasContext: context, viewport, transform: [size.sx, 0, 0, size.sy, 0, 0],
      background: 'rgb(255,255,255)' });
    activeJob.tasks.add(task);
    task.onContinue = continuation => { if (guard()) continuation(); else task.cancel(); };
    try { await task.promise; return guard(); }
    finally { activeJob.tasks.delete(task); }
  }
  function thumbnailCurrent(owner, thumbnail, guard) {
    return guard() && connected(owner.root, thumbnail.canvas)
      && Number(thumbnail.canvas.getAttribute('data-preview-thumbnail')) === thumbnail.page
      && getThumbnails().some(item => item.canvas === thumbnail.canvas && item.page === thumbnail.page);
  }
  async function render(guard = ALWAYS) {
    const owner = snapshot(guard), ownTicket = ++ticket;
    if (readingBinding && (!readingBinding.guard() || getDocument() !== readingBinding.document
      || getSession() !== readingBinding.session)) readingBinding = null;
    cancel(); clearRendered(); lastError = '';
    if (!owner || !owner.document || !current(owner) || !connected(owner.root, owner.reader) || previewLocked(owner.document)) {
      retire(cached?.resource); cached = null; return false;
    }
    const activeJob = { tasks: new Set() }; job = activeJob;
    const live = () => ownTicket === ticket && job === activeJob && current(owner);
    let imageBitmap = null;
    try {
      if (owner.document.mime !== 'application/pdf') {
        if (!connected(owner.root, owner.image)) return false;
        const source = owner.imageContent || owner.content;
        const decoded = decodePreviewData(source);
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(decoded.mime) || !live()) return false;
        const { width, height } = previewImageGeometry(source);
        retire(cached?.resource); cached = null;
        owner.image.style.imageOrientation = 'none';
        owner.image.src = source;
        if (!live() || owner.image.getAttribute('src') !== source) return false;
        await owner.image.decode();
        if (!live() || owner.image.getAttribute('src') !== source) return false;
        if (!(owner.image.naturalWidth > 0) || !(owner.image.naturalHeight > 0))
          throw new Error('The actual image decoder produced no pixels.');
        if (owner.thumbnails.length) {
          if (!owner.thumbnails.every(thumbnail => thumbnail.page === 1 && thumbnailCurrent(owner, thumbnail, live))) return false;
          const view = owner.root.ownerDocument.defaultView;
          if (typeof view.createImageBitmap !== 'function')
            throw new Error('A real raw-pixel image decoder is required for thumbnails.');
          // A canvas draw of HTMLImageElement can honor EXIF despite its CSS.
          // Decode the original canonical bytes explicitly in encoded axes.
          imageBitmap = await view.createImageBitmap(new Blob([decoded.bytes], { type: decoded.mime }), { imageOrientation: 'none' });
          if (!live() || owner.image.getAttribute('src') !== source) return false;
          if (imageBitmap.width !== width || imageBitmap.height !== height)
            throw new Error('The raw image decoder dimensions differ from the encoded pixel coordinates.');
        }
        const scale = displayScale(owner.reader, width, height, owner.settings);
        owner.image.style.width = `${width * scale}px`; owner.image.style.height = `${height * scale}px`;
        if (!restoreScroll(owner, live)) return false;
        if (owner.settings.sidebar === 'thumbnails') {
          for (const thumbnail of owner.thumbnails) {
            const thumbLive = () => thumbnailCurrent(owner, thumbnail, live)
              && owner.image.getAttribute('src') === source;
            if (thumbnail.page !== 1 || !thumbLive()) return false;
            const thumbScale = Math.min(120 / width, 160 / height);
            const viewport = { width: width * thumbScale, height: height * thumbScale };
            const size = canvasSize(viewport, owner.root.ownerDocument.defaultView.devicePixelRatio);
            thumbnail.canvas.width = size.width; thumbnail.canvas.height = size.height;
            thumbnail.canvas.style.width = `${viewport.width}px`; thumbnail.canvas.style.height = `${viewport.height}px`;
            const context = thumbnail.canvas.getContext('2d', { alpha: false });
            if (!context || !thumbLive()) return false;
            context.drawImage(imageBitmap, 0, 0, size.width, size.height);
            if (!thumbLive()) return false;
          }
        }
        if (!live()) return false;
        rendered = { kind: 'image', owner, source, width, height, rotation: 0 }; return true;
      }
      if (!connected(owner.root, owner.canvas) || !connected(owner.root, owner.text)) return false;
      const resource = await resourceFor(owner, live);
      if (!live() || !resource) return false;
      const library = await pdfRenderer();
      if (!live()) return false;
      const page = await resource.document.getPage(owner.settings.page);
      if (!live()) return false;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: displayScale(owner.reader, base.width, base.height, owner.settings) });
      owner.text.replaceChildren(); installTextStyle(owner);
      owner.text.style.setProperty('--total-scale-factor', String(viewport.scale * (page.userUnit || 1)));
      owner.text.style.setProperty('--scale-round-x', '0.0001px');
      owner.text.style.setProperty('--scale-round-y', '0.0001px');
      if (!await paint(page, owner.canvas, viewport, live, activeJob) || !live()) return false;
      const textContent = await page.getTextContent();
      if (!live()) return false;
      // PDF.js pumps its own asynchronous stream. Build its genuine positioned
      // nodes privately, then mount once under the original-container guard;
      // a revoked owner must never receive a late stream append.
      const staging = owner.root.ownerDocument.createElement('div');
      const layer = new library.TextLayer({ textContentSource: textContent, container: staging, viewport });
      activeJob.tasks.add(layer);
      try { await layer.render(); } finally { activeJob.tasks.delete(layer); }
      if (!live()) return false;
      owner.text.style.width = staging.style.width; owner.text.style.height = staging.style.height;
      owner.text.style.setProperty('--min-font-size', staging.style.getPropertyValue('--min-font-size'));
      owner.text.setAttribute('data-main-rotation', String(viewport.rotation));
      const fragment = owner.root.ownerDocument.createDocumentFragment();
      while (staging.firstChild) fragment.append(staging.firstChild);
      owner.text.replaceChildren(fragment);
      decorateSearch(layer, textContent, owner.settings.query, owner.document, owner.session);
      if (!live() || !restoreScroll(owner, live)) return false;
      const [x0, y0, x1, y1] = page.view, unit = page.userUnit || 1;
      const description = { kind: 'pdf', owner, viewport, width: (x1 - x0) * unit,
        height: (y1 - y0) * unit, rotation: viewport.rotation,
        canvasWidth: owner.canvas.width, canvasHeight: owner.canvas.height,
        textChildren: [...owner.text.childNodes], textNodes: layer.textDivs
          .map((node, index) => ({ node, text: layer.textContentItemsStr[index] }))
          .filter(({ node }) => owner.text.contains(node)) };
      if (owner.settings.sidebar === 'thumbnails') {
        for (const thumbnail of owner.thumbnails) {
          const thumbLive = () => thumbnailCurrent(owner, thumbnail, live);
          if (!Number.isInteger(thumbnail.page) || thumbnail.page < 1 || thumbnail.page > resource.document.numPages
            || !thumbLive()) return false;
          const thumbPage = await resource.document.getPage(thumbnail.page);
          if (!thumbLive()) return false;
          const thumbBase = thumbPage.getViewport({ scale: 1 });
          const thumbViewport = thumbPage.getViewport({ scale: Math.min(104 / thumbBase.width, 136 / thumbBase.height) });
          if (!await paint(thumbPage, thumbnail.canvas, thumbViewport, thumbLive, activeJob) || !thumbLive()) return false;
        }
      }
      if (!live()) return false;
      rendered = description;
      const binding = readingBinding;
      if (binding && (!binding.guard() || binding.document !== owner.document
        || binding.session !== owner.session || binding.fileId !== owner.fileId
        || binding.fileRevision !== owner.fileRevision)) readingBinding = null;
      if (binding && readingBinding === binding) {
        const progressGuard = () => live() && readingBinding === binding && binding.guard()
          && rendered === description && currentRendered() === description;
        if (progressGuard()) {
          // Refusing the optional synchronous observation never invalidates a PDF read.
          try {
            binding.onReadingProgress({ fileId: owner.fileId, fileRevision: owner.fileRevision,
              page: owner.settings.page, pageCount: resource.document.numPages,
              fraction: owner.settings.page / resource.document.numPages },
              { guard: progressGuard, windowId });
          } catch {}
        }
      }
      return true;
    } catch (error) {
      if (live()) lastError = error.message || 'The actual local document could not be rendered.';
      return false;
    } finally {
      imageBitmap?.close();
      // Never clear or cancel a newer render's resource/DOM after an old await.
      if (job === activeJob) { for (const task of activeJob.tasks) task.cancel(); activeJob.tasks.clear(); job = null; }
    }
  }
  function describePage() {
    const actual = currentRendered();
    return actual ? { documentId: actual.owner.documentId, revision: actual.owner.revision,
      page: actual.owner.settings.page, width: actual.width, height: actual.height, rotation: actual.rotation } : null;
  }
  function describe() {
    const ready = available(), document = ready ? getDocument() : null, session = ready ? getSession() : null;
    const reader = ready ? getReader() : null;
    return { windowId, documentId: document?.id ?? null, revision: document?.revision ?? null,
      fileId: document?.fileId ?? null, fileRevision: document?.fileRevision ?? null,
      page: session?.page ?? null, pageCount: document ? previewPageCount(document) : 0,
      mime: document?.mime ?? null, rendered: !!currentRendered(), error: lastError,
      scroll: reader && getReader() === reader && available() && connected(originalRoot, reader)
        ? { top: reader.scrollTop, left: reader.scrollLeft } : null };
  }
  function point(clientX, clientY) {
    const actual = currentRendered();
    if (!actual || actual.kind !== 'pdf') return null;
    const result = previewPdfSourcePoint(actual.viewport, actual.owner.canvas.getBoundingClientRect(), clientX, clientY);
    return currentRendered() === actual ? result : null;
  }
  function projectRect(rect) {
    const actual = currentRendered();
    if (!actual || actual.kind !== 'pdf') return null;
    const result = previewPdfProjectedRect(actual.viewport, actual.owner.canvas.getBoundingClientRect(), rect);
    return currentRendered() === actual ? result : null;
  }
  function captureSelection() {
    const actual = currentRendered();
    if (!actual || actual.kind !== 'pdf') return null;
    const owner = actual.owner;
    const selection = capturePreviewPdfSelection({ root: owner.root, canvas: owner.canvas,
      textLayer: owner.text, viewport: actual.viewport }, () => currentRendered() === actual);
    return selection ? { documentId: owner.documentId, revision: owner.revision,
      page: owner.settings.page, ...selection } : null;
  }
  function focus(controlId, guard = ALWAYS) {
    const owner = snapshot(guard);
    if (!owner || !current(owner) || typeof controlId !== 'string') return false;
    const control = controlId === 'reader' ? owner.reader
      : [...owner.root.querySelectorAll('[data-preview-control]')]
        .find(node => node.getAttribute('data-preview-control') === controlId);
    if (!control || control.disabled || !visible(owner.root, control) || typeof control.focus !== 'function') return false;
    control.focus({ preventScroll: true });
    return current(owner) && connected(owner.root, control) && owner.root.ownerDocument.activeElement === control;
  }
  function scroll(position, guard = ALWAYS) {
    const owner = snapshot(guard);
    if (!owner || !current(owner) || !connected(owner.root, owner.reader)
      || !Number.isFinite(position?.top) || !Number.isFinite(position?.left)
      || position.top < 0 || position.left < 0) return false;
    owner.reader.scrollTop = position.top;
    if (!current(owner)) return false;
    owner.reader.scrollLeft = position.left;
    return current(owner);
  }
  function selectAll(guard = ALWAYS) {
    const actual = currentRendered();
    if (!actual || actual.kind !== 'pdf' || typeof guard !== 'function' || !guard()
      || !actual.owner.text.textContent) return false;
    const document = actual.owner.root.ownerDocument, selection = document.getSelection();
    if (!selection) return false;
    const range = document.createRange(); range.selectNodeContents(actual.owner.text);
    if (!guard() || currentRendered() !== actual) return false;
    selection.removeAllRanges();
    if (!guard() || currentRendered() !== actual) return false;
    selection.addRange(range);
    return guard() && currentRendered() === actual && selection.rangeCount === 1
      && actual.owner.text.contains(selection.anchorNode) && actual.owner.text.contains(selection.focusNode);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; readingBinding = null; ticket++; cancel(); clearRendered(); retire(cached?.resource); cached = null;
    styleNode?.remove(); styleNode = null;
  }
  return { available, describe, describePage, render, focus, scroll, captureSelection, selectAll, point, projectRect, bindReadingProgress, clearReadingProgress, destroy };
}
