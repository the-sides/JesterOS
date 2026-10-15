<script>
  import { tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import { createTextEditNativeView, textEditNativeSegments } from './textedit-native.js';
  import { textEditPlainText, TEXTEDIT_MARK_DEFAULTS } from './textedit-content.js';
  import { textEditNativeMenus, getTextEditProfile } from './textedit-catalog.js';
  import './textedit.css';
  import { createDocumentFonts } from './document-fonts.svelte.js';

  let { state: textEditState, profile, windowId, execute, registerView, available = true, active = true, controls = {}, getShared = name => controls.getShared?.(name), getFile = id => controls.getFile?.(id) } = $props();
  let root, editor;
  let native = $state.raw(null), message = $state(''), suppliedFiles = $state([]), suppliedFolders = $state([]), form = $state({}), sheetOwner = $state.raw(null);
  let panelData = $state.raw(null), panelPages = $state(1), panelPdf = null, panelPdfRendered = null, panelEl;
  let preferencePane = $state('new'), ribbonTab = $state('Home'), localMenus = $state(false);
  const shell = item => {
    return execute(item.command, item.target === undefined ? { windowId } : item.target, item.payload ?? {});
  };
  const metadata = $derived(getTextEditProfile(profile));
  const windows = $derived(metadata.family === 'windows');
  const era = $derived(metadata.era);
  const classic = $derived(era === 'high-sierra' || era === 'mojave');
  const win = $derived(textEditState.windows.find(item => item.windowId === windowId));
  const document = $derived(textEditState.documents.find(item => item.id === win?.documentId));
  const rich = $derived(document?.content.kind === 'rich');
  const plainText = $derived(document ? textEditPlainText(document.content) : '');
  const dirty = $derived(document && document.contentRevision !== document.savedGeneration);
  const dialog = $derived(win?.dialog);
  const modal = $derived(!!dialog && !['find', 'spelling'].includes(dialog.kind));
  const title = $derived(windows ? rich ? 'WordPad' : 'Notepad' : 'TextEdit');
  const preferences = $derived(textEditState.preferences);
  const files = $derived(Array.isArray(controls.files) ? controls.files : typeof controls.files === 'function' ? controls.files() : suppliedFiles);
  const services = $derived(typeof controls.services === 'function' ? controls.services() : []);
  const menuDefinitions = $derived(textEditNativeMenus(profile, rich ? 'rich' : 'plain', { window: win, preferences, marks: win?.typingMarks, windows: textEditState.windows.map(other => ({ windowId: other.windowId, title: textEditState.documents.find(item => item.id === other.documentId)?.title ?? 'Untitled' })), services, managedWindow: controls }));
  const selectedMenu = $derived(menuDefinitions.find(menu => menu.id === win?.menu || menu.label === win?.menu));
  const position = $derived(plainText.slice(0, win?.selection.start ?? 0).split('\n'));
  const style = $derived.by(() => {
    if (!document || !win) return { ...TEXTEDIT_MARK_DEFAULTS, align: 'left', spacing: 1, indent: 0, list: 'none', tabs: [] };
    const revision = document.generation; void revision;
    return native?.selectionStyle() ?? { ...TEXTEDIT_MARK_DEFAULTS, align: 'left', spacing: 1, indent: 0, list: 'none', tabs: [] };
  });
  const selectedTable = $derived.by(() => {
    if (!document || !win) return null;
    return textEditNativeSegments(document.content).find(entry => entry.type === 'table' && win.selection.start >= entry.start && win.selection.start <= entry.end) ?? null;
  });
  const fonts = $derived(documentFonts.families);
  const plainFonts = $derived(documentFonts.choices(preferences.plainFont));
  const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
  const alignments = [['left', '≡', 'Align Left'], ['center', '≡', 'Center'], ['right', '≡', 'Align Right'], ['justify', '▤', 'Justify']];
  const encodings = [['utf-8', 'Unicode (UTF-8)'], ['utf-16le', 'Unicode (UTF-16 LE)'], ['windows-1252', 'Western (Windows 1252)']];
  const documentFonts = createDocumentFonts({ getShared: name => getShared(name), getFile: id => getFile(id), getRoot: () => root, getOwner: () => [textEditState, profile, windowId, win] });

  const usable = () => native?.available() === true && (typeof available === 'function' ? available() : available) === true;
  async function command(name, payload = {}) {
    if (!usable()) return null;
    const view = native, owner = document;
    try {
      const result = await execute(name.startsWith('textedit.') ? name : `textedit.${name}`, { windowId }, payload);
      if (native === view && document === owner && usable()) message = result?.status === 'rejected' ? result.error?.message ?? 'This operation is unavailable.' : '';
      return result;
    } catch (error) { if (native === view && document === owner && usable()) message = error.message; return null; }
  }
  const format = patch => command('format', patch);
  const dismiss = () => command('dialog', { kind: 'none' });
  function menu(menu) { command('menu', { menu: win.menu === menu.id ? null : menu.id }); }
  function menuEnabled(item) {
    if (item.separator) return false;
    if (item.command === 'textedit.undo') return !!document.undo.length;
    if (item.command === 'textedit.redo') return !!document.redo.length;
    if (['textedit.format', 'textedit.table', 'textedit.link', 'textedit.attachment'].includes(item.command)) return rich;
    if (item.command === 'textedit.reveal') return !!document.fileId;
    return !!item.command;
  }
  async function runMenu(item) {
    if (!item || item.separator) return;
    if (item.target) { shell(item); if (win?.menu) command('menu', { menu: null }); return; }
    if (item.command === 'textedit.window.front') { command('window.front'); return; }
    if (!menuEnabled(item)) return;
    const payload = { ...(item.payload ?? {}) };
    if (item.command === 'textedit.view') {
      for (const key of ['wrap', 'showRuler']) if (key in payload) payload[key] = !win[key];
      if ('zoom' in payload && payload.zoom !== 100) payload.zoom = Math.max(25, Math.min(500, win.zoom + (payload.zoom > 100 ? 10 : -10)));
    }
    if (item.command === 'textedit.preferences') for (const key of ['smartQuotes', 'smartDashes', 'textReplacement', 'spellcheck', 'correctSpellingAutomatically']) if (key in payload) payload[key] = !preferences[key];
    if (item.command === 'textedit.format') for (const key of ['bold', 'italic', 'underline', 'strike']) if (key in payload) payload[key] = !style[key];
    if (item.command === 'textedit.convert') payload.kind = rich ? 'plain' : 'rich';
    await command('menu', { menu: null });
    await command(item.command, payload);
  }
  function mountEditor(node) {
    const model = document; let mountedView, canceled = false;
    editor = node;
    tick().then(() => {
      if (canceled || model !== document || !root?.contains(node)) return;
      mountedView = createTextEditNativeView({ getRoot: () => root, getEditor: () => editor, getState: () => textEditState, getDocument: () => document, getWindow: () => win,
        fontCSS: (name, bold, italic) => documentFonts.css(name, bold, italic), windowId, available: () => (typeof available === 'function' ? available() : available) === true, execute,
        onMessage: value => { if (native === mountedView) message = value; }, onFiles: value => { if (native === mountedView) suppliedFiles = value; }, onAttachmentPreview: block => previewAttachment(block) });
      native = mountedView; registerView?.(windowId, mountedView);
    });
    return { destroy() { canceled = true; mountedView?.destroy(); if (mountedView) registerView?.(windowId, null, mountedView); if (native === mountedView) native = null; if (editor === node) editor = null; } };
  }
  $effect(() => { if (document && win) { document.content; document.generation; void win.zoom; void win.wrap; native?.render(); } });
  $effect(() => { void documentFonts.revision; native?.render(true); });
  $effect(() => { if (panelData?.kind === 'pdf') tick().then(renderPdfPanel); });
  $effect(() => { if (document && !document.content.blocks.some(block => block.type === 'attachment')) panelData = null; });
  $effect(() => {
    if (!dialog || dialog === sheetOwner) return;
    sheetOwner = dialog;
    const folderChoices = (files ?? []).filter(file => file.mime === 'directory' || file.kind === 'folder');
    suppliedFolders = typeof controls.folders === 'function' ? controls.folders() : folderChoices;
    form = { name: document?.title ?? 'Untitled', encoding: document?.encoding ?? preferences.encoding, fileId: '', folderId: '', font: style.font, size: style.size, color: style.color,
      url: style.link, rows: 2, columns: 2, spacing: style.spacing, indent: style.indent, tabs: style.tabs.join(', '),
      line: position.length + 1, column: (position.at(-1)?.length ?? 0) + 1, query: win.find.query, replacement: win.find.replacement, matchCase: win.find.matchCase, spelling: dialog.spelling?.suggestions[0] ?? dialog.spelling?.word ?? '', from: '', to: '' };
  });
  /** Lease-guarded transient attachment preview over exact canonical Files bytes. */
  async function previewAttachment(block) {
    if (!block?.fileId || typeof controls.getFile !== 'function' || typeof controls.readFile !== 'function') {
      if (rich) command('attachment', { action: 'open', blockId: block?.id });
      else message = 'Attachment preview requires the shared Files preview bridge.';
      return;
    }
    const file = controls.getFile(block.fileId);
    if (!file) { message = 'This attachment is no longer present in Files.'; return; }
    const revision = file.revision;
    const guard = () => root?.isConnected === true && document?.content.blocks.some(item => item.id === block.id && item.fileId === block.fileId) === true
      && controls.getFile(block.fileId) === file && file.revision === revision;
    if (!guard()) return;
    panelData = { kind: 'loading', name: block.name, mime: block.mime };
    try {
      const read = await controls.readFile(block.fileId, { windowId, guard });
      if (!guard()) { panelData = null; return; }
      if (read?.status !== 'applied' || read.file?.id !== block.fileId || read.file.revision !== revision) { panelData = { kind: 'error', message: 'The exact shared file changed while opening the preview.' }; return; }
      const payload = String(read.file.text ?? ''), mime = String(block.mime ?? '').split(';')[0].toLowerCase();
      if (mime === 'application/pdf') {
        const source = payload.startsWith('data:application/pdf;base64,') ? payload.slice(payload.indexOf(',') + 1) : /^[A-Za-z0-9+/]+={0,2}$/.test(payload) ? payload : null;
        if (!source) throw new Error('Only canonical base64 PDF data can be previewed here.');
        const library = await pdfRenderer();
        if (!guard()) { panelData = null; return; }
        panelPdf = await library.getDocument({ data: Uint8Array.from(atob(source), character => character.charCodeAt(0)), disableAutoFetch: true, disableStream: true, disableRange: true, isEvalSupported: false }).promise;
        panelPdfRendered = null; panelPages = panelPdf.numPages;
        panelData = { kind: 'pdf', page: 1, name: block.name };
      } else if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) {
        panelData = { kind: 'image', src: payload.startsWith('data:') ? payload : `data:${mime};base64,${payload}`, name: block.name };
      } else if (mime === 'image/svg+xml') {
        const source = payload.startsWith('data:') ? base64ToText(payload.slice(payload.indexOf(',') + 1)) : payload;
        if (!safeStaticSvg(source)) throw new Error('Untrusted SVG cannot be previewed. Scripts, event handlers, DTDs and external references are rejected; only local # references are allowed.');
        panelData = { kind: 'image', src: `data:image/svg+xml;base64,${textToBase64(source)}`, name: block.name };
      } else {
        panelData = { kind: 'unsupported', name: block.name, mime: block.mime ?? read.file.mime ?? '' };
      }
    } catch (error) { if (guard()) panelData = { kind: 'error', message: error.message }; }
  }
  async function renderPdfPanel() {
    const data = panelData;
    if (data?.kind !== 'pdf' || !panelEl?.isConnected || !panelPdf || panelPdfRendered === data) return;
    panelPdfRendered = data;
    try {
      const page = await panelPdf.getPage(data.page);
      if (panelData !== data || !panelEl?.isConnected) return;
      const unit = page.getViewport({ scale: 1 }), scale = Math.min(560 / unit.width, 620 / unit.height, 1.8), viewport = page.getViewport({ scale });
      const ratio = globalThis.devicePixelRatio || 1;
      panelEl.width = Math.round(viewport.width * ratio); panelEl.height = Math.round(viewport.height * ratio);
      panelEl.style.width = `${Math.round(viewport.width)}px`; panelEl.style.height = `${Math.round(viewport.height)}px`;
      await page.render({ canvasContext: panelEl.getContext('2d'), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
    } catch (error) { if (panelData === data) panelData = { kind: 'error', message: error.message ?? 'The PDF page could not be rendered.' }; }
  }
  const pdfRenderer = () => Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    .then(([library, worker]) => { library.GlobalWorkerOptions.workerSrc = worker.default; return library; });
  const textToBase64 = text => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  const base64ToText = base64 => new TextDecoder().decode(Uint8Array.from(atob(base64), character => character.charCodeAt(0)));
  function safeStaticSvg(source) {
    if (typeof source !== 'string' || !source.length || source.length > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(source)) return false;
    try {
      const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
      if (parsed.getElementsByTagName('parsererror').length || parsed.documentElement.localName !== 'svg') return false;
      for (const node of parsed.getElementsByTagName('*')) {
        if (['script', 'foreignObject', 'iframe', 'object', 'embed', 'link', 'style', 'use'].includes(node.localName)) return false;
        for (const attribute of node.attributes) {
          if (/^on/i.test(attribute.name)) return false;
          if (/javascript:/i.test(attribute.value) || /^\s*data:/i.test(attribute.value)) return false;
          if ((attribute.name === 'href' || attribute.name === 'xlink:href') && !attribute.value.trim().startsWith('#')) return false;
          for (const match of attribute.value.matchAll(/url\((['"]?)(.*?)\1\)/gi)) if (!match[2].trim().startsWith('#')) return false;
        }
      }
      return true;
    } catch { return false; }
  }
  async function submitSheet(event) {
    event.preventDefault(); const sheet = dialog, owner = document;
    let result;
    if (sheet.kind === 'open') result = await command('open', { fileId: form.fileId });
    else if (sheet.kind === 'save') result = await command('saveAs', { name: form.name, encoding: form.encoding });
    else if (sheet.kind === 'font') result = await format({ font: form.font, size: Number(form.size) });
    else if (sheet.kind === 'color') result = await format({ color: form.color });
    else if (sheet.kind === 'link') result = await command('link', { url: form.url });
    else if (sheet.kind === 'attachment') result = await command('attachment', { action: 'insert', fileId: form.fileId });
    else if (sheet.kind === 'table') result = await command('table', { action: 'insert', rows: Number(form.rows), columns: Number(form.columns) });
    else if (sheet.kind === 'rename') result = await command('rename', { name: form.name });
    else if (sheet.kind === 'move') result = await command('move', { folderId: form.folderId });
    else if (sheet.kind === 'goto') result = await command('goto', { line: Number(form.line), column: Number(form.column) });
    if (result?.status === 'applied' && owner === document && sheet === dialog) dismiss();
  }
  async function find(direction = 'next') {
    return command('find', { query: form.query, replacement: form.replacement, matchCase: form.matchCase, direction });
  }
  async function replace(all = false) {
    await command('find', { query: form.query, replacement: form.replacement, matchCase: form.matchCase, direction: 'next', select: false });
    command('replace', { all });
  }
  function tableAction(action) { if (selectedTable) command('table', { action, blockId: selectedTable.blockId, row: selectedTable.row, column: selectedTable.column }); }
  function addTab(event) {
    if (!rich || !win.showRuler || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect(), at = Math.round((event.clientX - rect.left - 12) * 3 / 4 / 6) * 6;
    if (at > 0 && at <= 1440) format({ tabs: [...new Set([...style.tabs, at])].sort((a, b) => a - b) });
  }
  function setTabs() {
    const tabs = form.tabs.split(',').map(value => Number(value.trim())).filter(value => value > 0).sort((a, b) => a - b);
    format({ tabs: [...new Set(tabs)], spacing: Number(form.spacing), indent: Number(form.indent) });
  }
  function keydown(event) {
    if (event.key === 'Escape') {
      if (win?.menu) { event.preventDefault(); command('menu', { menu: null }); }
      else if (dialog && dialog.kind !== 'close') { event.preventDefault(); dismiss(); }
    }
  }
</script>

{#snippet fontControls()}
  <label class="textedit-font-family"><span class="sr-only">Font family</span><select data-textedit-control="font" value={style.font} onchange={event => format({ font: event.currentTarget.value })}>{#if !fonts.includes(style.font)}<option value={style.font} disabled>{style.font} (unavailable)</option>{/if}{#each fonts as font}<option>{font}</option>{/each}</select></label>
  <label class="textedit-font-face"><span class="sr-only">Typeface</span><select data-textedit-control="typeface" value={style.bold && style.italic ? 'bold-italic' : style.bold ? 'bold' : style.italic ? 'italic' : 'regular'} onchange={event => format({ bold: event.currentTarget.value.includes('bold'), italic: event.currentTarget.value.includes('italic') })}><option value="regular">Regular</option><option value="bold">Bold</option><option value="italic">Italic</option><option value="bold-italic">Bold Italic</option></select></label>
  <label class="textedit-font-size"><span class="sr-only">Font size</span><select data-textedit-control="size" value={style.size} onchange={event => format({ size: Number(event.currentTarget.value) })}>{#if !sizes.includes(style.size)}<option value={style.size}>{style.size}</option>{/if}{#each sizes as size}<option value={size}>{size}</option>{/each}</select></label>
{/snippet}
{#snippet markControls()}
  <div class="textedit-segment" aria-label="Text style">{#each [['bold', 'B'], ['italic', 'I'], ['underline', 'U'], ['strike', 'S']] as [field, label]}<button type="button" class="mark-{field}" aria-label={field === 'strike' ? 'Strikethrough' : field} aria-pressed={style[field]} data-textedit-control={field} onpointerdown={event => event.preventDefault()} onclick={() => format({ [field]: !style[field] })}>{label}</button>{/each}</div>
{/snippet}
{#snippet colorControls()}
  <button class="textedit-color-swatch" data-textedit-control="color-panel" aria-label="Show Colors" title="Text color" onpointerdown={event => event.preventDefault()} onclick={() => command('dialog', { kind: 'color' })}><span style:background={style.color}></span></button>
  <button class="textedit-clear-color" data-textedit-control="clear-color" title="Remove text color" aria-label="Remove text color" onpointerdown={event => event.preventDefault()} onclick={() => format({ color: '#000000' })}><span>A</span><i></i></button>
{/snippet}
{#snippet paragraphControls()}
  <div class="textedit-segment alignments" aria-label="Paragraph alignment">{#each alignments as [align, glyph, label]}<button class="align-{align}" type="button" title={label} aria-label={label} aria-pressed={style.align === align} data-textedit-control={`align-${align}`} onpointerdown={event => event.preventDefault()} onclick={() => format({ align })}>{glyph}</button>{/each}</div>
  <label class="textedit-spacing"><span class="sr-only">Line spacing</span><select data-textedit-control="spacing" value={style.spacing} onchange={event => format({ spacing: Number(event.currentTarget.value) })}>{#if ![1, 1.2, 1.5, 2, 3].includes(style.spacing)}<option value={style.spacing}>{style.spacing}</option>{/if}{#each [1, 1.2, 1.5, 2, 3] as spacing}<option value={spacing}>{spacing.toFixed(1)}</option>{/each}</select></label>
  <label class="textedit-list"><span class="sr-only">Lists</span><select data-textedit-control="list" value={style.list} onchange={event => format({ list: event.currentTarget.value })}><option value="none">☷</option><option value="bullet">• List</option><option value="number">1. List</option></select></label>
{/snippet}
{#snippet menus()}
  <nav class="textedit-menu-strip" aria-label={`${title} menus`} data-window-no-drag inert={modal}>
    {#each menuDefinitions as definition}<button class:open={selectedMenu?.id === definition.id} aria-haspopup="menu" aria-expanded={selectedMenu?.id === definition.id} data-textedit-control={`menu-${definition.id}`} onpointerdown={event => event.preventDefault()} onclick={() => menu(definition)}>{definition.label}</button>{/each}
  </nav>
{/snippet}

<div class="textedit-app {windows ? rich ? 'textedit-wordpad' : 'textedit-notepad' : 'textedit-mac'} era-{era}" class:inactive={!active} bind:this={root} data-textedit-window-id={windowId} onkeydown={keydown} role="region" aria-label={title}>
  {#if document && win}
    {#if !windows}
      <header class="textedit-caption" data-window-drag-region>
        <WindowControls {...controls} {active} modernGreenMenu={era === 'golden-gate'} onclose={() => command('close')}/>
        <span class="textedit-document-title"><span class="textedit-document-icon" aria-hidden="true">▤</span>{document.title}{#if dirty}<span class="textedit-edited"> — Edited</span>{/if}</span>
        <button class="textedit-menu-access" title="Local menu access (the native menu bar is above the desktop)" aria-label="Show document menus" aria-expanded={localMenus} data-window-no-drag onclick={() => localMenus = !localMenus}>⌄</button>
      </header>
      {#if localMenus}{@render menus()}{/if}
      {#if rich}<div class="textedit-formatbar" aria-label="Formatting" inert={modal} data-window-no-drag>
        {#if era === 'golden-gate'}{@render markControls()}{@render colorControls()}{@render fontControls()}{:else}<button class="textedit-paragraph-panel" title="Paragraph and tab settings" aria-label="Paragraph and tab settings" onpointerdown={event => event.preventDefault()} onclick={() => command('dialog', { kind: 'font' })}>¶⌄</button>{@render fontControls()}{@render colorControls()}{@render markControls()}{/if}
        {@render paragraphControls()}
      </div>{/if}
    {:else if rich}
      <div class="textedit-quick-access" inert={modal}><button aria-label="Save" title="Save" data-textedit-control="quick-save" onclick={() => command('save')}>▣</button><button aria-label="Undo" title="Undo" disabled={!document.undo.length} onclick={() => command('undo')}>↶</button><button aria-label="Redo" title="Redo" disabled={!document.redo.length} onclick={() => command('redo')}>↷</button><span>{document.title}{dirty ? ' *' : ''} — WordPad</span></div>
      <nav class="textedit-ribbon-tabs" aria-label="WordPad ribbon" inert={modal}><button class="wordpad-file" aria-haspopup="menu" data-textedit-control="ribbon-file" onclick={() => menu(menuDefinitions.find(item => item.label === 'File') ?? menuDefinitions[0])}>File</button>{#each ['Home', 'View', 'Local Extensions'] as tab}<button class:chosen={ribbonTab === tab} data-textedit-control={`ribbon-${tab.toLowerCase().replace(' ', '-')}`} onclick={() => ribbonTab = tab}>{tab}</button>{/each}<button class="textedit-local-tools" title="Local extensions beyond native WordPad" data-textedit-control="local-tools" onclick={() => localMenus = !localMenus}>Local tools</button></nav>
      {#if localMenus}{@render menus()}{/if}
      <div class="textedit-ribbon" inert={modal}>
        {#if ribbonTab === 'Home'}
          <section class="ribbon-group clipboard-group" aria-label="Clipboard"><div class="ribbon-group-body"><button class="ribbon-large" data-textedit-control="paste" onpointerdown={event => event.preventDefault()} onclick={() => command('clipboard', { action: 'paste' })}><span>▣</span>Paste</button><div class="ribbon-stack"><button onpointerdown={event => event.preventDefault()} onclick={() => command('clipboard', { action: 'cut' })}>✂ Cut</button><button onpointerdown={event => event.preventDefault()} onclick={() => command('clipboard', { action: 'copy' })}>▱ Copy</button></div></div><small>Clipboard</small></section>
          <section class="ribbon-group font-group" aria-label="Font"><div class="ribbon-group-body"><div class="ribbon-font-row">{@render fontControls()}</div><div class="ribbon-font-row">{@render markControls()}{@render colorControls()}<button title="Increase font size" aria-label="Increase font size" onpointerdown={event => event.preventDefault()} onclick={() => format({ size: Math.min(144, style.size + 1) })}>A↑</button><button title="Decrease font size" aria-label="Decrease font size" onpointerdown={event => event.preventDefault()} onclick={() => format({ size: Math.max(1, style.size - 1) })}>A↓</button></div></div><small>Font</small></section>
          <section class="ribbon-group paragraph-group" aria-label="Paragraph"><div class="ribbon-group-body">{@render paragraphControls()}<button title="Decrease indent" aria-label="Decrease indent" onpointerdown={event => event.preventDefault()} onclick={() => format({ indent: Math.max(0, style.indent - 36) })}>⇤</button><button title="Increase indent" aria-label="Increase indent" onpointerdown={event => event.preventDefault()} onclick={() => format({ indent: Math.min(720, style.indent + 36) })}>⇥</button><button title="Paragraph settings" data-textedit-control="paragraph-panel" onpointerdown={event => event.preventDefault()} onclick={() => command('dialog', { kind: 'font' })}>¶</button></div><small>Paragraph</small></section>
          <section class="ribbon-group insert-group" aria-label="Insert"><div class="ribbon-group-body"><button class="ribbon-large" title="Insert actual scene file; local equivalent, not OLE" data-textedit-control="object" onpointerdown={event => event.preventDefault()} onclick={() => command('dialog', { kind: 'attachment' })}><span>▤</span>Insert object</button></div><small>Insert</small></section>
          <section class="ribbon-group editing-group" aria-label="Editing"><div class="ribbon-group-body"><button data-textedit-control="find" onclick={() => command('dialog', { kind: 'find' })}>⌕ Find</button><button onclick={() => command('dialog', { kind: 'find' })}>Replace</button><button onpointerdown={event => event.preventDefault()} onclick={() => command('clipboard', { action: 'select-all' })}>Select all</button></div><small>Editing</small></section>
        {:else if ribbonTab === 'View'}
          <section class="ribbon-group" aria-label="Zoom"><div class="ribbon-group-body"><button class="ribbon-large" onclick={() => command('view', { zoom: Math.min(500, win.zoom + 10) })}><span>⊕</span>Zoom in</button><button class="ribbon-large" onclick={() => command('view', { zoom: Math.max(25, win.zoom - 10) })}><span>⊖</span>Zoom out</button><button class="ribbon-large" onclick={() => command('view', { zoom: 100 })}><span>100%</span>100%</button></div><small>Zoom</small></section>
          <section class="ribbon-group view-group"><div class="ribbon-group-body"><label><input type="checkbox" checked={win.showRuler} onchange={event => command('view', { showRuler: event.currentTarget.checked })}/>Ruler</label><label><input type="checkbox" checked={win.wrap} onchange={event => command('view', { wrap: event.currentTarget.checked })}/>Word wrap</label><label><input type="checkbox" checked={preferences.wrapToPage} onchange={event => preference('wrapToPage', event.currentTarget.checked)}/>Wrap to page</label></div><small>Show and paragraph layout</small></section>
        {:else}
          <section class="ribbon-group extensions-group" aria-label="Local extensions"><div class="ribbon-group-body">{#each menuDefinitions.find(item => item.id === 'Local Extensions')?.items ?? [] as entry}{#if entry.separator}<hr/>{:else}<button onpointerdown={event => event.preventDefault()} onclick={() => runMenu(entry)}>{entry.label}</button>{/if}{/each}</div><small>Local extensions</small></section>
        {/if}
      </div>
    {:else}
      <div class="textedit-notepad-tabs" inert={modal}><button class="selected-tab" data-textedit-control="current-document" onpointerdown={event => event.preventDefault()} onclick={() => native?.focus()}>{document.title}{dirty ? ' •' : ''}</button><button class="notepad-close" aria-label="Close document" onclick={() => command('close')}>×</button><button class="notepad-new" aria-label="New document in a new window" data-textedit-control="new" onclick={() => command('new', { kind: 'plain' })}>＋</button></div>
      <div class="textedit-notepad-menubar">{@render menus()}<button class="notepad-settings" title="Settings" aria-label="Settings" data-textedit-control="settings" onclick={() => command('dialog', { kind: 'preferences' })}>⚙</button><button class="notepad-extensions" title="Local extensions" aria-label="Local extensions" data-textedit-control="notepad-extensions" onclick={() => menu(menuDefinitions.find(item => item.id === 'Local Extensions'))}>Local extensions</button></div>
    {/if}

    {#if selectedMenu && !modal}<div class="textedit-menu-popup" role="menu" aria-label={selectedMenu.label}>
      {#each selectedMenu.items as item}{#if item.separator}<hr/>{:else}<button role="menuitem" disabled={!menuEnabled(item)} data-textedit-control={`menu-command-${item.command?.slice(9)}`} onclick={() => runMenu(item)}><span>{item.label}</span>{#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}</button>{/if}{/each}
      {#if selectedMenu.label === 'Window' && !selectedMenu.items.length}<hr/><p class="textedit-menu-note">No other documents are open.</p>{/if}
    </div>{/if}

    {#if rich && win.showRuler}<div class="textedit-ruler" role="group" aria-label="Ruler; click to add a tab stop" data-textedit-control="ruler" inert={modal} onclick={addTab} onkeydown={event => { if (event.key === 'Enter') command('dialog', { kind: 'font' }); }} tabindex="0">
      <span class="ruler-indent" style:left={`${12 + style.indent * 4 / 3}px`} title={`Left indent ${style.indent} pt`}>▼</span>{#each Array.from({ length: 13 }, (_, index) => index) as inch}<span class="ruler-inch" style:left={`${12 + inch * 96}px`}>{inch}</span>{/each}
      {#each style.tabs as tab}<button class="ruler-tab" style:left={`${12 + tab * 4 / 3}px`} title={`Remove tab stop ${tab} pt`} aria-label={`Remove tab stop ${tab} points`} onclick={event => { event.stopPropagation(); format({ tabs: style.tabs.filter(value => value !== tab) }); }}>▸</button>{/each}
    </div>{/if}

    <div class="textedit-editor-viewport" class:wordpad-paper={windows && rich} inert={modal}>
      {#key `${document.id}:${document.content.kind}`}
        {#if rich}<div class="textedit-rich-editor" class:nowrap={!win.wrap} use:mountEditor contenteditable="true" role="textbox" aria-label="Document rich text" aria-multiline="true" spellcheck="false" data-textedit-control="editor" style:zoom={win.zoom / 100}></div>
        {:else}<div class="textedit-editor-wrap"><textarea class="textedit-plain-editor" use:mountEditor aria-label="Document text" spellcheck="false" wrap={win.wrap ? 'soft' : 'off'} data-textedit-control="editor" style:font-family={documentFonts.css(preferences.plainFont, false, false, 'monospace')} style:font-size={`${preferences.plainSize * win.zoom / 100}pt`}></textarea></div>{/if}
      {/key}
    </div>
    {#if windows}<footer class="textedit-status"><span>Ln {position.length}, Col {(position.at(-1)?.length ?? 0) + 1}</span><span>{win.zoom}%</span><span>Unix (LF)</span><span>{document.encoding.toUpperCase()}</span>{#if rich}<input type="range" min="25" max="400" step="5" value={win.zoom} aria-label="Zoom" onchange={event => command('view', { zoom: Number(event.currentTarget.value) })}/>{/if}</footer>{/if}
    {#if documentFonts.error || message}<div class="textedit-message" role="status">{documentFonts.error || message}<button aria-label="Dismiss message" disabled={!!documentFonts.error} onclick={() => message = ''}>×</button></div>{/if}

    {#if panelData?.kind === 'loading'}
      <div class="textedit-preview" role="dialog" aria-label={`Opening preview`}><header><strong>{panelData.name}</strong><button aria-label="Close preview" onclick={() => panelData = null}>×</button></header><p role="status">Reading the actual scene file…</p></div>
    {:else if panelData?.kind === 'image'}
      <div class="textedit-preview" role="dialog" aria-label={`Attachment ${panelData.name}`}><header><strong>{panelData.name}</strong><button aria-label="Close preview" onclick={() => panelData = null}>×</button></header><img src={panelData.src} alt={`Scene attachment ${panelData.name}`}/></div>
    {:else if panelData?.kind === 'pdf'}
      <div class="textedit-preview textedit-preview-pdf" role="dialog" aria-label={`PDF attachment`}><header><strong>{panelData.name}</strong><button aria-label="Close PDF" onclick={() => panelData = null}>×</button></header><canvas bind:this={panelEl}></canvas><nav aria-label="PDF pages"><button data-textedit-control="pdf-previous" disabled={panelData.page <= 1} onclick={() => { panelData = { ...panelData, page: panelData.page - 1 }; }}>‹</button><span>Page {panelData.page} of {panelPages}</span><button data-textedit-control="pdf-next" disabled={panelData.page >= panelPages} onclick={() => { panelData = { ...panelData, page: panelData.page + 1 }; }}>›</button></nav></div>
    {:else if panelData?.kind === 'unsupported'}
      <div class="textedit-preview" role="dialog" aria-label="Attachment preview unavailable"><header><strong>{panelData.name}</strong><button aria-label="Close preview" onclick={() => panelData = null}>×</button></header><p>{panelData.mime} cannot be rasterized natively here; use WordPad/TextEdit external tools or open in Files. No host/network, no OLE object activation, no external URL</p></div>
    {:else if panelData?.kind === 'error'}
      <div class="textedit-preview" role="dialog" aria-label="Attachment preview unavailable"><header><strong>Preview unavailable</strong><button aria-label="Close preview" onclick={() => panelData = null}>×</button></header><p role="status">{panelData.message}</p></div>
    {/if}

    {#if dialog}
      <div class="textedit-sheet-backdrop" class:nonmodal={!modal}>
        <section class="textedit-sheet" class:preferences-sheet={dialog.kind === 'preferences'} class:find-sheet={dialog.kind === 'find'} role="dialog" aria-modal={modal} aria-label={dialog.kind === 'close' ? 'Save changes' : dialog.kind === 'preferences' ? classic ? 'TextEdit Preferences' : `${title} Settings` : dialog.kind}>
          {#if dialog.kind === 'close'}
            <div class="textedit-sheet-heading"><span class="textedit-sheet-icon">▤</span><div><h2>{windows ? `Do you want to save changes to ${document.title}?` : `Do you want to save the changes you made in the document “${document.title}”?`}</h2><p>Your changes will be lost if you don’t save them.</p></div></div>
            {#if !document.fileId}<label>Save As:<input data-textedit-control="close-name" bind:value={form.name}/></label>{/if}
            <div class="textedit-sheet-actions"><button data-textedit-control="close-discard" onclick={() => command('close.resolve', { action: 'discard' })}>{windows ? "Don't save" : 'Delete'}</button><span></span><button data-textedit-control="close-cancel" onclick={() => command('close.resolve', { action: 'cancel' })}>Cancel</button><button class="primary" data-textedit-control="close-save" onclick={() => command('close.resolve', { action: 'save', name: form.name })}>Save</button></div>
          {:else if dialog.kind === 'convert'}
            <h2>Convert this document to plain text?</h2><p>Text remains, but formatting, tables, and attachment objects are removed from the document. Original scene files remain in Files.</p><div class="textedit-sheet-actions"><button onclick={dismiss}>Cancel</button><button class="primary" data-textedit-control="convert-confirm" onclick={() => command('convert', { kind: 'plain', confirmed: true })}>Make Plain Text</button></div>
          {:else if dialog.kind === 'find'}
            <header class="textedit-panel-heading"><h2>Find and Replace</h2><button aria-label="Close Find" onclick={dismiss}>×</button></header>
            <label>Find:<input data-textedit-control="find-query" bind:value={form.query} onkeydown={event => { if (event.key === 'Enter') find(event.shiftKey ? 'previous' : 'next'); }}/></label><label>Replace:<input data-textedit-control="find-replacement" bind:value={form.replacement}/></label><label class="check"><input type="checkbox" bind:checked={form.matchCase}/>Match case</label>
            <div class="textedit-find-actions"><button data-textedit-control="replace-all" disabled={!form.query} onclick={() => replace(true)}>Replace All</button><button data-textedit-control="replace" disabled={!form.query} onclick={() => replace(false)}>Replace</button><button data-textedit-control="find-previous" disabled={!form.query} onclick={() => find('previous')}>Previous</button><button class="primary" data-textedit-control="find-next" disabled={!form.query} onclick={() => find()}>Next</button></div><p class="textedit-sheet-message" role="status">{win.find.message}</p>
          {:else if dialog.kind === 'spelling'}
            <header class="textedit-panel-heading"><h2>Spelling — English (US)</h2><button aria-label="Close Spelling" onclick={dismiss}>×</button></header>
            {#if dialog.spelling}<label>Not in Dictionary:<input value={dialog.spelling.word} readonly/></label><label>Change to:<input data-textedit-control="spelling-replacement" bind:value={form.spelling}/></label><div class="textedit-spelling-suggestions" aria-label="Suggestions">{#each dialog.spelling.suggestions as suggestion}<button class:selected={form.spelling === suggestion} onclick={() => form.spelling = suggestion}>{suggestion}</button>{/each}</div><div class="textedit-find-actions"><button data-textedit-control="spelling-ignore" onclick={() => command('spelling', { action: 'ignore', word: dialog.spelling.word })}>Ignore</button><button data-textedit-control="spelling-learn" onclick={() => command('spelling', { action: 'learn', word: dialog.spelling.word })}>Learn</button><button data-textedit-control="spelling-change" disabled={!form.spelling} onclick={() => command('spelling', { action: 'replace', replacement: form.spelling })}>Change</button><button class="primary" onclick={() => command('spelling', { action: 'check' })}>Find Next</button></div>{:else}<p role="status">{dialog.message || 'No spelling issues found.'}</p><button onclick={() => command('spelling', { action: 'check' })}>Check Document</button>{/if}<p class="textedit-local-note">Bundled English Hunspell dictionary. No host spellchecker or grammar service.</p>
          {:else if dialog.kind === 'preferences'}
            <header class="textedit-panel-heading"><h2>{windows ? `${title} Settings` : classic ? 'TextEdit Preferences' : 'TextEdit Settings'}</h2><button aria-label="Close Settings" onclick={dismiss}>×</button></header>
            <nav class="textedit-preference-tabs" aria-label="Settings panes"><button class:selected={preferencePane === 'new'} onclick={() => preferencePane = 'new'}>New Document</button><button class:selected={preferencePane === 'save'} onclick={() => preferencePane = 'save'}>Open and Save</button></nav>
            {#if preferencePane === 'new'}
              <fieldset><legend>Format</legend><label class="check"><input type="radio" name={`kind-${windowId}`} checked={preferences.defaultKind === 'rich'} onchange={() => preference('defaultKind', 'rich')}/>Rich text{windows ? ' (opens WordPad)' : ''}</label><label class="check"><input type="radio" name={`kind-${windowId}`} checked={preferences.defaultKind === 'plain'} onchange={() => preference('defaultKind', 'plain')}/>Plain text{windows ? ' (opens Notepad)' : ''}</label><label class="check"><input type="checkbox" checked={preferences.wrap} onchange={event => preference('wrap', event.currentTarget.checked)}/>Wrap text to window</label><label class="check"><input type="checkbox" checked={preferences.wrapToPage} onchange={event => preference('wrapToPage', event.currentTarget.checked)}/>Wrap to page</label><label>Window lines:<input type="number" min="10" max="200" value={preferences.windowLines} data-textedit-control="preference-lines" onchange={event => preference('windowLines', Number(event.currentTarget.value))}/></label><label>Window columns:<input type="number" min="10" max="200" value={preferences.windowColumns} data-textedit-control="preference-columns" onchange={event => preference('windowColumns', Number(event.currentTarget.value))}/></label></fieldset>
              <fieldset><legend>Font</legend><label>Family:<select value={preferences.font} data-textedit-control="preference-font" onchange={event => preference('font', event.currentTarget.value)}>{#if !fonts.includes(preferences.font)}<option value={preferences.font} disabled>{preferences.font} (unavailable)</option>{/if}{#each fonts as font}<option>{font}</option>{/each}</select></label><label>Size:<input type="number" min="6" max="144" value={preferences.size} data-textedit-control="preference-size" onchange={event => preference('size', Number(event.currentTarget.value))}/></label><label>Plain family:<select value={preferences.plainFont} data-textedit-control="preference-plainfont" onchange={event => preference('plainFont', event.currentTarget.value)}>{#each plainFonts as font}<option value={font} disabled={!documentFonts.has(font)}>{font}{!documentFonts.has(font) ? ' (unavailable)' : ''}</option>{/each}</select></label><label>Plain size:<input type="number" min="6" max="144" value={preferences.plainSize} data-textedit-control="preference-plainsize" onchange={event => preference('plainSize', Number(event.currentTarget.value))}/></label></fieldset>
              <fieldset><legend>{windows ? 'Local text assistance extensions' : 'Options'}</legend>{#each [['spellcheck', 'Check spelling'], ['correctSpellingAutomatically', 'Correct spelling automatically'], ['showRuler', 'Show ruler in rich text'], ['smartQuotes', 'Smart quotes'], ['smartDashes', 'Smart dashes'], ['textReplacement', 'Text replacement'], ['richOnlyTypography', windows ? 'Local: smart typography only in rich text' : 'Smart quotes and dashes in rich text only'], ['richOnlySpelling', windows ? 'Local: spelling check only in rich text' : 'Check and correct spelling in rich text only'], ['smartCopyPaste', windows ? 'Local: smart copy/paste spacing' : 'Smart copy/paste']] as [key, label]}<label class="check"><input type="checkbox" checked={preferences[key]} data-textedit-control={`preference-${key}`} onchange={event => preference(key, event.currentTarget.checked)}/>{label}</label>{/each}</fieldset>
              <fieldset><legend>Text replacement rules — local scene</legend>{#each preferences.replacements ?? [] as replacement, index}<div class="textedit-replacement-rule"><span>{replacement.from}</span><span>→ {replacement.to}</span><button aria-label={`Remove replacement ${replacement.from}`} onclick={() => preference('replacements', preferences.replacements.filter((_, at) => at !== index))}>−</button></div>{/each}<div class="textedit-replacement-rule"><input aria-label="Replace" bind:value={form.from}/><input aria-label="With" bind:value={form.to}/><button disabled={!form.from} data-textedit-control="replacement-add" onclick={() => { preference('replacements', [...(preferences.replacements ?? []), { from: form.from, to: form.to }]); form.from = ''; form.to = ''; }}>＋</button></div></fieldset>
            {:else}
              <fieldset><legend>Plain Text File Encoding</legend><label>Opening and Saving:<select value={preferences.encoding} data-textedit-control="preference-encoding" onchange={event => preference('encoding', event.currentTarget.value)}>{#each encodings as [value, label]}<option {value}>{label}</option>{/each}</select></label><label class="check"><input type="checkbox" checked={preferences.displayHtmlAsCode} onchange={event => preference('displayHtmlAsCode', event.currentTarget.checked)}/>Display HTML files as HTML code</label><label class="check"><input type="checkbox" checked={preferences.displayRtfAsCode} onchange={event => preference('displayRtfAsCode', event.currentTarget.checked)}/>Display RTF files as RTF code</label><label class="check"><input type="checkbox" checked={preferences.addTxtExtension} onchange={event => preference('addTxtExtension', event.currentTarget.checked)}/>Add .txt to plain text files</label></fieldset><p>Plain documents save as .txt. Rich documents save as the supported RTF subset; documents with attachments store local References in RTF metadata.</p><p class="textedit-local-note">Files are fictional scene files. Formatted HTML preview, document properties, OS data detectors, OLE, and host file dialogs are not represented as native features here.</p>
            {/if}
            <div class="textedit-sheet-actions"><button data-textedit-control="preference-defaults" onclick={() => command('preferences', { restoreDefaults: true })}>Restore All Defaults</button><button class="primary" onclick={dismiss}>Done</button></div>
          {:else if dialog.kind === 'rename'}
            <h2>Rename Document</h2><label>Document Name:<input data-textedit-control="rename-name" bind:value={form.name}/></label><p class="textedit-local-note">Renames the canonical scene document title; links and Files references keep their stable IDs.</p>
          {:else if dialog.kind === 'move'}
            <h2>Move To</h2><label>Folder:<select data-textedit-control="move-folder" bind:value={form.folderId}><option value="">Choose a folder</option>{#each suppliedFolders as folder}<option value={folder.id}>{folder.name}</option>{/each}</select></label><p class="textedit-local-note">Moves the document within scene Files using the actual shared move bridge. No host filesystem access.</p>
          {:else if dialog.kind === 'goto'}
            <h2>Go To Line and Column</h2><label>Line:<input type="number" min="1" bind:value={form.line}/></label><label>Column:<input type="number" min="1" bind:value={form.column}/></label>
          {:else if dialog.kind === 'revert'}
            <h2>Revert to Saved</h2><p>The current document changes will be replaced with the last saved version. This cannot be undone with the scene undo history.</p><div class="textedit-sheet-actions"><button onclick={dismiss}>Cancel</button><button class="primary" data-textedit-control="revert-confirm" onclick={() => command('revert', { confirmed: true })}>Revert Document</button></div>
          {:else if dialog.kind === 'about'}
            <div class="textedit-about"><span class="textedit-sheet-icon">▤</span><h2>{title}</h2><p>{metadata.id}</p><p>Native-era local recreation. Documents, clipboard, spelling, links, printing, and Files stay inside this fictional scene.</p><p>Bundled local English spell checking uses nspell (MIT) with the dictionary-en en_US (SCOWL 60, 2020.12.07) Hunspell dictionary; notices are preserved in frontend/public/textedit-licenses.txt.</p><p>No Apple or Microsoft application binaries or proprietary fonts are redistributed. Golden Gate appearance follows the living guide, not a verified 27.0.1 binary.</p></div><div class="textedit-sheet-actions"><button class="primary" onclick={dismiss}>OK</button></div>
          {:else if dialog.kind === 'help'}
            <h2>{title} Help</h2><p>Installed font families are the original shared Font Book/Font Library sources, not proprietary Apple or Microsoft fonts. Enablement and source changes update this mounted document. Unavailable authored family names remain literal and use a safe browser rendering fallback; existing export font-embedding scopes are unchanged.</p><p>Create a document with File → New. Open and save actual scene Files. Each new document opens an independent window.</p><p>Rich text supports fonts, color, emphasis, paragraph alignment, line spacing, lists, tab stops, tables, links, and canonical Files attachments. Use the ruler to add a tab stop; click its marker to remove it.</p><p>Press Tab or Shift-Tab to navigate table cells. Tab from the final cell adds a row. Select a table cell and use Format → Table to manage rows and columns. Table geometry is structural and cannot be deleted by a text replacement.</p><p>Command/Ctrl-click a jester:// scene link to open it through the local browser command. Imported external hyperlink metadata remains inert and is not opened. Paste uses only the scene clipboard. For spelling, use Edit → Spelling; substitutions and correction are controlled in settings.</p>{#if windows}<p>Notepad is the plain-text counterpart. Rich documents use the WordPad ribbon retained in Windows 11 23H2. Tables, links, spelling, PDF, and sharing are explicit local extensions, not claimed native WordPad features.</p>{/if}<div class="textedit-sheet-actions"><button class="primary" onclick={dismiss}>Done</button></div>
          {:else}
            <form onsubmit={submitSheet}>
              {#if dialog.kind === 'open' || dialog.kind === 'attachment'}
                <h2>{dialog.kind === 'open' ? 'Open' : 'Insert Attachment'}</h2><label>Scene File:<select data-textedit-control="file-choice" bind:value={form.fileId}><option value="">Choose a file</option>{#each files ?? [] as file}<option value={file.id}>{file.name} · {file.mime ?? 'file'}</option>{/each}</select></label>{#if !files?.length}<p role="status">No scene files are available. Add a file in Files, then reopen this sheet.</p>{/if}<p class="textedit-local-note">Uses actual Files IDs; no host filesystem access.</p>
              {:else if dialog.kind === 'save'}
                <h2>Save As</h2><label>Save As:<input data-textedit-control="save-name" bind:value={form.name}/></label><label>File Format:<span>{rich ? document.content.blocks.some(block => block.type === 'attachment') ? 'Rich Text Format (.rtf), supported subset + local Files attachment references' : 'Rich Text Format (.rtf), supported subset' : 'Plain Text (.txt)'}</span></label>{#if !rich}<label>Plain Text Encoding:<select data-textedit-control="save-encoding" bind:value={form.encoding}>{#each encodings as [value, label]}<option {value}>{label}</option>{/each}</select></label>{/if}<p class="textedit-local-note">Saved to Files in this scene. An existing linked file is updated only at its exact revision.</p>
              {:else if dialog.kind === 'font'}
                <h2>Fonts and Paragraph</h2><label>Family:<select data-textedit-control="font-panel-family" bind:value={form.font}>{#if !fonts.includes(form.font)}<option value={form.font} disabled>{form.font} (unavailable)</option>{/if}{#each fonts as font}<option>{font}</option>{/each}</select></label><label>Size:<input data-textedit-control="font-panel-size" type="number" min="1" max="144" bind:value={form.size}/></label><fieldset><legend>Paragraph</legend><label>Line spacing:<input type="number" min="0.1" max="10" step="0.1" bind:value={form.spacing}/></label><label>Left indent (pt):<input type="number" min="0" max="720" bind:value={form.indent}/></label><label>Tab stops (pt, comma-separated):<input data-textedit-control="tab-stops" bind:value={form.tabs}/></label><button type="button" data-textedit-control="paragraph-apply" onclick={setTabs}>Apply Paragraph</button></fieldset><p class="textedit-local-note">Font names are document metadata; available local substitutions may differ from the original OS.</p>
              {:else if dialog.kind === 'color'}
                <h2>Colors</h2><label>Text Color:<input type="color" data-textedit-control="color-picker" bind:value={form.color}/><input aria-label="Color hex value" pattern="#[0-9a-fA-F]{6}" bind:value={form.color}/></label><div class="textedit-color-palette">{#each ['#000000', '#ffffff', '#ff2600', '#ff9300', '#fffb00', '#00f900', '#00fdff', '#0433ff', '#9437ff', '#ff40ff', '#808080', '#006400'] as color}<button type="button" style:background={color} aria-label={`Color ${color}`} onclick={() => form.color = color}></button>{/each}</div>
              {:else if dialog.kind === 'table'}
                <h2>{windows ? 'Table — local extension' : 'Table'}</h2><label>Rows:<input type="number" min="1" max="1024" bind:value={form.rows}/></label><label>Columns:<input type="number" min="1" max="64" bind:value={form.columns}/></label>{#if selectedTable}<fieldset><legend>Selected Table</legend><p>Row {selectedTable.row + 1}, Column {selectedTable.column + 1}</p><div class="textedit-table-actions">{#each [['add-row', 'Add Row'], ['add-column', 'Add Column'], ['delete-row', 'Delete Row'], ['delete-column', 'Delete Column'], ['delete', 'Delete Table']] as [action, label]}<button type="button" data-textedit-control={`table-${action}`} onclick={() => tableAction(action)}>{label}</button>{/each}</div></fieldset>{/if}<p class="textedit-local-note">Rectangular editable cells. Nested/merged cells and native border-resizing are outside the supported document format.</p>
              {:else if dialog.kind === 'link'}
                <h2>Link</h2><label>Link URL:<input data-textedit-control="link-url" bind:value={form.url}/></label><p>Apply to the selected text. An empty URL removes its link. Only jester:// links become clickable scene references; other stored hyperlink values stay inert metadata.</p>
              {/if}
              {#if dialog.message}<p class="textedit-sheet-message" role="status">{dialog.message}</p>{/if}
              <div class="textedit-sheet-actions"><button type="button" data-textedit-control="sheet-cancel" onclick={dismiss}>Cancel</button><button type="submit" class="primary" data-textedit-control="sheet-apply" disabled={['open', 'attachment', 'move'].includes(dialog.kind) && !form.fileId && !form.folderId}>{dialog.kind === 'open' ? 'Open' : dialog.kind === 'save' ? 'Save' : dialog.kind === 'table' ? 'Insert Table' : dialog.kind === 'attachment' ? 'Insert' : dialog.kind === 'move' ? 'Move' : dialog.kind === 'revert' ? 'Revert' : 'Apply'}</button></div>
            </form>
          {/if}
        </section>
      </div>
    {/if}
  {/if}
</div>
