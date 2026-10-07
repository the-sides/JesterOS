<script>
  import { onDestroy, tick } from 'svelte';
  import { keyboardRows, characterResults, characterById } from './input-model.js';

  let { profile, pane, input, execute, foreground = true, canInsert = false, active = false } = $props();
  let panel = $state(null);
  let body = $state(null);
  let disposed = false, composing = false;
  let writingFocus = null;
  let nativeError = $state('');
  const writtenScroll = new WeakMap();

  const categories = ['all', 'emoji', 'symbols', 'latin'];
  const categoryNames = { all: 'All', emoji: 'Emoji', symbols: 'Symbols', latin: 'Latin' };

  const viewerId = $derived(pane?.viewerId ?? null);
  const kind = $derived(pane?.kind ?? null);
  const isKeyboard = $derived(kind === 'keyboard');
  const isCharacter = $derived(kind === 'characters');
  const supported = $derived(profile?.id === 'macos-golden-gate-27.0.1' && !!pane && !!viewerId
    && (isKeyboard || isCharacter) && !!input && typeof execute === 'function');
  const shift = $derived(pane?.shift === true);
  const option = $derived(pane?.option === true);
  const searchQuery = $derived(typeof pane?.query === 'string' ? pane.query : '');
  const category = $derived(categories.includes(pane?.category) ? pane.category : 'all');
  const selectedCharacter = $derived(
    typeof pane?.selectedCharacterId === 'string' ? characterById(pane.selectedCharacterId) : null);
  const errorText = $derived(nativeError || (typeof pane?.error === 'object' && pane.error !== null && typeof pane.error.text === 'string'
    ? pane.error.text : typeof pane?.error === 'string' ? pane.error : ''));
  const activeSource = $derived(input?.activeSource ?? input?.sources?.find(source => source.id === input?.activeSourceId) ?? null);
  const rows = $derived(isKeyboard && activeSource ? keyboardRows(activeSource.id, { shift, option }) : []);
  const results = $derived(isCharacter ? characterResults(searchQuery, category) : []);
  const modifierLabel = { Shift: 'shift', Option: 'option' };

  onDestroy(() => { disposed = true; });

  function lease() {
    return { viewerId: pane?.viewerId, kind: pane?.kind, panel };
  }
  function current(owner, allowMount = false) {
    return Boolean(!disposed && owner.viewerId && owner.kind
      && owner.viewerId === pane?.viewerId && owner.kind === pane?.kind
      && (owner.panel === panel || (allowMount === true && !owner.panel && panel?.dataset.inputViewerId === owner.viewerId))
      && panel?.dataset.inputViewerId === owner.viewerId && panel?.dataset.inputKind === owner.kind);
  }
  // The owned frame is the connected foreground viewer itself: exact viewerId/kind
  // identity, real rect, no ownership or occlusion verdict from a center hit test.
  function frame(node = panel) {
    return Boolean(!disposed && foreground && node?.isConnected && node.getClientRects().length
      && node.clientWidth > 0 && node.clientHeight > 0
      && node.dataset.inputViewerId === pane?.viewerId && node.dataset.inputKind === pane?.kind);
  }
  // Structure and paint state only: body scroll clipping and sibling overlap do not
  // disqualify mounted controls, because focus reveals them first.
  function mounted(node) {
    if (!frame(panel) || !node?.isConnected || (node !== panel && !panel.contains(node))) return false;
    const view = node.ownerDocument.defaultView;
    if (!view) return false;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.inert || ancestor.hasAttribute('inert')) return false;
      const style = view.getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    return true;
  }
  // Final verification: clipped geometry, scaled overflow bounds, and a center hit test.
  function owned(node) {
    if (!mounted(node) || !node.getClientRects().length) return false;
    const view = node.ownerDocument.defaultView;
    if (!view) return false;
    const rect = node.getBoundingClientRect();
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(view.innerWidth, rect.right), bottom = Math.min(view.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return false;
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = view.getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      const scaleX = ancestor.offsetWidth ? bounds.width / ancestor.offsetWidth : 1;
      const scaleY = ancestor.offsetHeight ? bounds.height / ancestor.offsetHeight : 1;
      if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)) {
        left = Math.max(left, bounds.left + ancestor.clientLeft * scaleX);
        right = Math.min(right, bounds.left + (ancestor.clientLeft + ancestor.clientWidth) * scaleX);
      }
      if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)) {
        top = Math.max(top, bounds.top + ancestor.clientTop * scaleY);
        bottom = Math.min(bottom, bounds.top + (ancestor.clientTop + ancestor.clientHeight) * scaleY);
      }
      if (right <= left || bottom <= top) return false;
    }
    const hit = view.document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  function control(id) {
    if (!panel || typeof id !== 'string') return null;
    return id === 'panel' ? panel : [...panel.querySelectorAll('[data-input-control]')].find(node => node.dataset.inputControl === id) ?? null;
  }
  function searchField() {
    const node = control('search');
    return node instanceof HTMLInputElement ? node : null;
  }
  function keyText(key) {
    if (key.action !== 'insert' || !key.text) return key.label;
    if (key.text === ' ') return '␣';
    return key.text;
  }
  const codepoints = text => [...text].map(glyph => `U+${glyph.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ');

  export function element() {
    return frame(panel) ? panel : null;
  }
  export function available(controlId = 'panel') {
    const node = control(controlId);
    return Boolean(node && mounted(node) && (node === panel || !node.disabled) && node.getClientRects().length);
  }
  export function controlIds() {
    if (!frame(panel)) return [];
    return ['panel', ...[...panel.querySelectorAll('[data-input-control]')]
      .filter(node => mounted(node) && !node.disabled)
      .map(node => node.dataset.inputControl)];
  }
  export function focusedControl() {
    if (!frame(panel)) return null;
    const node = panel.ownerDocument.activeElement;
    const id = node === panel ? 'panel' : node?.dataset.inputControl;
    return id && control(id) === node && mounted(node) ? id : null;
  }
  export async function focus(controlId) {
    const original = panel, owner = { viewerId: pane?.viewerId, kind: pane?.kind };
    await tick();
    if (panel !== original || owner.viewerId !== pane?.viewerId || owner.kind !== pane?.kind || disposed) return false;
    const node = control(controlId);
    if (!node || !node.getClientRects().length) return false;
    reveal(node);
    if (!owned(node)) return false;
    writingFocus = node;
    try { node.focus({ preventScroll: true }); }
    catch { return false; }
    finally { writingFocus = null; }
    return node.isConnected && panel === original && owner.viewerId === pane?.viewerId && owner.kind === pane?.kind
      && node.ownerDocument.activeElement === node && owned(node);
  }
  export function scrollTop() {
    return current(lease()) && body ? body.scrollTop : null;
  }
  export async function scrollTo(top) {
    const original = panel, owner = { viewerId: pane?.viewerId, kind: pane?.kind };
    if (!body || !Number.isFinite(top) || top < 0) return null;
    if (body.scrollTop !== top) {
      body.scrollTop = top;
      writtenScroll.set(body, { ...owner, top: body.scrollTop });
    }
    await tick();
    return panel === original && owner.viewerId === pane?.viewerId && owner.kind === pane?.kind
      && body?.isConnected ? body.scrollTop : null;
  }
  export async function setQuery(value) {
    const original = panel, originalId = pane?.viewerId, originalKind = pane?.kind;
    const field = searchField();
    if (!field || typeof value !== 'string') return false;
    const written = writeSearch(field, value);
    if (!written) return false;
    await tick();
    return panel === original && pane?.viewerId === originalId && pane?.kind === originalKind
      && field.isConnected && field.value === value;
  }
  export function query() {
    const field = searchField();
    return current(lease()) && field ? field.value : null;
  }
  export function modifiers() {
    if (!current(lease())) return null;
    const readButton = id => {
      const node = control(id);
      return node instanceof HTMLElement ? node.getAttribute('aria-pressed') === 'true' : null;
    };
    const shift = readButton('shift'), option = readButton('option');
    return shift === null || option === null ? null : { shift, option };
  }
  export async function reconcile() {
    const original = panel, originalId = pane?.viewerId, originalKind = pane?.kind;
    await tick();
    if (panel !== original || pane?.viewerId !== originalId || pane?.kind !== originalKind || !current(lease())) return false;
    const field = searchField();
    if (!composing && !field?.isComposing && field && typeof pane?.query === 'string' && field.value !== pane.query) {
      const start = field.selectionStart, end = field.selectionEnd, direction = field.selectionDirection;
      field.value = pane.query;
      if (field.ownerDocument.activeElement === field && Number.isFinite(start) && Number.isFinite(end)) {
        try { field.setSelectionRange(Math.min(start, field.value.length), Math.min(end, field.value.length), direction ?? 'none'); } catch { /* caret restore cannot break reconciliation */ }
      }
    }
    return true;
  }

  // Writing a concrete search value elsewhere preserves the caret when the native
  // field is focused and never reshuffles a live IME composition.
  function writeSearch(field, value) {
    if (!field.isConnected || field.isComposing || composing) return false;
    if (field.value === value) return true;
    const start = field.selectionStart, end = field.selectionEnd, direction = field.selectionDirection;
    const focused = field.ownerDocument.activeElement === field;
    field.value = value;
    if (focused && Number.isFinite(start) && Number.isFinite(end)) {
      try { field.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length), direction ?? 'none'); } catch { /* caret restoration is best effort */ }
    }
    return true;
  }
  function reveal(node) {
    if (!body || node === panel || !body.contains(node)) return false;
    const area = body.getBoundingClientRect(), rect = node.getBoundingClientRect();
    const before = body.scrollTop;
    if (rect.top < area.top) body.scrollTop += rect.top - area.top - 6;
    else if (rect.bottom > area.bottom) body.scrollTop += rect.bottom - area.bottom + 6;
    if (body.scrollTop === before) return false;
    writtenScroll.set(body, { ...lease(), top: body.scrollTop });
    return true;
  }

  async function request(event, command, target = {}, payload = {}) {
    const node = event?.currentTarget;
    if (!current(lease()) || !mounted(node)) return null;
    const owner = lease();
    try {
      const result = await execute({ command, target: { viewerId: pane.viewerId, ...target }, payload });
      if (current(owner)) nativeError = result.status === 'rejected' ? result.error.message : '';
      return result;
    }
    finally { await reconcile(); }
  }

  function ke(event, key) {
    if (key.action === 'modifier') {
      void request(event, 'input.keyboard.modifiers', {}, key.keyId === 'Shift' ? { shift: !shift } : { option: !option });
      return;
    }
    void request(event, 'input.keyboard.press', { keyId: key.keyId }, {});
  }
  function pickCategory(event, next) {
    if (next === category) return;
    void request(event, 'input.characters.category', {}, { category: next });
  }
  function pickCharacter(event, id) {
    void request(event, 'input.characters.select', { characterId: id }, {});
  }
  function insertCharacter(event, id) {
    void request(event, 'input.characters.insert', { characterId: id }, {});
  }
  function gridKey(event, id) {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault(); event.stopImmediatePropagation();
      insertCharacter(event, id);
    }
  }
  function searchInput(event) {
    const field = event.currentTarget;
    if (composing || field.isComposing || typeof field?.value !== 'string') return;
    if (field.value === pane?.query) return;
    void request(event, 'input.characters.search', {}, { query: field.value });
  }
  function compositionChange(event, start) {
    composing = start;
    const field = event.currentTarget;
    if (composing || field.value === pane?.query) return;
    void request(event, 'input.characters.search', {}, { query: field.value });
  }
  function observeFocus(event) {
    const node = event.target;
    const id = node?.dataset?.inputControl;
    if (typeof id !== 'string' || node === writingFocus) return;
    void request(event, 'input.viewer.focus', { control: id }, { observe: true });
  }
  function observeScroll(event) {
    const node = event.currentTarget;
    if (node !== body || !current(lease())) return;
    const written = writtenScroll.get(node);
    writtenScroll.delete(node);
    const top = node.scrollTop;
    if (written?.panel === panel && written.top === top) return;
    void request(event, 'input.viewer.scroll', {}, { top, observe: true });
  }
  function keydown(event) {
    if (!available() || !panel.contains(event.target) || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      void request(event, 'input.viewer.close');
    }
  }
</script>

{#if supported}
  {#key viewerId}
    <div bind:this={panel} class="input-viewer" class:inactive={!active} class:keyboard={isKeyboard} class:characters={isCharacter}
      data-input-viewer-id={viewerId} data-input-kind={kind} data-input-control="panel" role="dialog" aria-modal="false" tabindex="-1"
      aria-label={isCharacter ? 'Emoji & Symbols' : `${activeSource?.short ?? ''} Keyboard Viewer`}
      style:z-index={active ? 12200 : 12100} inert={!foreground}
      onkeydown={keydown} onfocusin={observeFocus}>
      <header class="titlebar">
        <button class="close" type="button" data-input-control="close" aria-label="Close viewer" title="Close"
          onclick={event => request(event, 'input.viewer.close')}><span aria-hidden="true">×</span></button>
        {#if isCharacter}
          <h1>Emoji & Symbols</h1>
        {:else}
          <h1>Keyboard Viewer</h1>
          {#if activeSource}<span class="source">{activeSource.short}</span>{/if}
        {/if}
      </header>
      {#if isKeyboard}
        <div bind:this={body} class="body" data-input-region="body" tabindex="-1" onscroll={observeScroll}>
          <div class="rows">
            {#each rows as row}
              <div class="krow">
                {#each row as keyItem (keyItem.keyId)}
                  <button type="button" class="key" class:modifier={keyItem.action === 'modifier'}
                    class:wide={keyItem.action !== 'modifier' && keyItem.keyId !== 'Space' && keyItem.keyId !== 'IntlBackslash'}
                    class:space={keyItem.keyId === 'Space'} class:backslash={keyItem.keyId === 'IntlBackslash'}
                    disabled={keyItem.action !== 'modifier' && !canInsert}
                    data-input-control={keyItem.action === 'modifier' ? modifierLabel[keyItem.keyId] : `key:${keyItem.keyId}`}
                    aria-label={keyItem.keyId === 'Space' ? 'Space' : keyItem.label} aria-pressed={keyItem.action === 'modifier' ? (keyItem.keyId === 'Shift' ? shift : option) : undefined}
                    title={keyItem.label} onclick={event => ke(event, keyItem)}>{keyText(keyItem)}</button>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div class="metrics">
          <input type="search" class="search" data-input-control="search" value={pane.query} maxlength="256"
            placeholder="Search" aria-label="Search characters" spellcheck="false" autocomplete="off"
            oninput={searchInput} oncompositionstart={event => compositionChange(event, true)}
            oncompositionend={event => compositionChange(event, false)} />
          <div class="tabs" role="group" aria-label="Character categories">
            {#each categories as item (item)}
              <button type="button" class="tab" class:selected={category === item} data-input-control={`category:${item}`}
                aria-pressed={category === item} onclick={event => pickCategory(event, item)}>{categoryNames[item]}</button>
            {/each}
          </div>
        </div>
        <div bind:this={body} class="body" data-input-region="body" tabindex="-1" onscroll={observeScroll}>
          {#if results.length}
            <div class="grid">
              {#each results as item (item.id)}
                <button type="button" class="cell" class:selected={item.id === pane.selectedCharacterId}
                  data-input-control={`character:${item.id}`} title={item.id} aria-label={item.name} aria-pressed={item.id === pane.selectedCharacterId}
                  onclick={event => pickCharacter(event, item.id)} ondblclick={event => insertCharacter(event, item.id)}
                  onkeydown={event => gridKey(event, item.id)}>{item.text}</button>
              {/each}
            </div>
          {:else}
            <p class="empty" role="status">No characters match the search and category.</p>
          {/if}
        </div>
      {/if}
      {#if isCharacter}
        <div class="details">
          {#if selectedCharacter}
            <span class="glyph" lang="und">{selectedCharacter.text}</span>
            <div class="copy">
              <strong>{selectedCharacter.name}</strong>
              <span>{codepoints(selectedCharacter.text)}</span>
              <span>{selectedCharacter.category} · {selectedCharacter.keywords.join(' ')}</span>
            </div>
            <button type="button" class="insert" data-input-control="insert" disabled={!canInsert || !selectedCharacter}
              onclick={event => insertCharacter(event, selectedCharacter.id)}>Insert</button>
          {:else}
            <span class="hint">Select a character to see its details.</span>
          {/if}
        </div>
      {/if}
      <footer class="status">
        <span class="error" role="alert">{errorText}</span>
        <span class="cue" role="status">{canInsert ? 'Inserts into the original captured editor.' : 'Original editor unavailable — browsing only.'}</span>
        <span class="simulation">Simulated input · host keyboard and IME unchanged.</span>
      </footer>
    </div>
  {/key}
{/if}

<style>
  .input-viewer { box-sizing:border-box; position:relative; display:flex; flex-direction:column; min-width:304px; min-height:164px;
    overflow:hidden; border:1px solid var(--appearance-border,#c6c3bd); border-radius:12px; background:var(--appearance-panel,#f3f1ed);
    color:var(--appearance-ink,#292827); box-shadow:0 14px 42px #0004, 0 2px 8px #0002; font:12px/1.45 var(--golden-gate-font,sans-serif); }
  .keyboard { width:min(680px,100%); height:min(300px,100%); }
  .characters { width:min(440px,100%); height:min(420px,100%); }
  .input-viewer:not(.keyboard):not(.characters) { width:min(320px,100%); height:min(180px,100%); }
  .inactive { box-shadow:0 10px 26px #0002; filter:saturate(.82); }
  .titlebar { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:0 10px; min-height:32px;
    background:var(--appearance-toolbar,#efede9); border-bottom:1px solid var(--appearance-soft-border,#dcd8d3); }
  h1 { flex:1; min-width:0; margin:0; font-size:12px; font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .source { flex:none; color:var(--appearance-muted,#75716b); font-variant-numeric:tabular-nums; font-size:10px; }
  button, input { box-sizing:border-box; font:inherit; color:inherit; }
  button { cursor:default; border:1px solid var(--appearance-border,#c6c3bd); border-radius:6px; background:var(--appearance-surface,#fff); min-height:26px; }
  button:disabled { opacity:.4; cursor:not-allowed; }
  button:focus-visible, input:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-2px; }
  .close { flex:none; display:grid; place-items:center; width:15px; height:15px; padding:0; border:1px solid #0002; border-radius:50%;
    background:var(--appearance-traffic-light-bg,#ff6058); color:var(--appearance-traffic-light-ink,#810e08); font:12px/1 var(--golden-gate-font,sans-serif); }
  .close span { opacity:0; } .close:hover span, .close:focus-visible span { opacity:1; }
  .body { flex:1 1 auto; overflow:auto; overscroll-behavior:contain; overflow-anchor:none; background:var(--appearance-surface,#fff); }
  .metrics { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid var(--appearance-soft-border,#dcd8d3); }
  .search { flex:1; min-width:0; min-height:28px; border:1px solid var(--appearance-border,#c6c3bd); border-radius:7px;
    background:var(--appearance-input,var(--appearance-surface,#fff)); padding:3px 8px; }
  .tabs { flex:none; display:flex; gap:3px; }
  .tab { min-height:24px; padding:2px 9px; background:transparent; border:0; color:var(--appearance-muted,#75716b); }
  .tab.selected { color:var(--appearance-selection-ink,#fff); background:var(--appearance-selection,#0878df); }
  .rows { display:flex; flex-direction:column; gap:5px; padding:8px; }
  .krow { display:flex; gap:5px; }
  .key { flex:1 1 0; min-width:0; min-height:33px; padding:3px 4px; font-size:12px; white-space:nowrap; overflow:hidden; }
  .key:hover { background:var(--appearance-hover,#00000009); }
  .wide { flex:1.7 1 0; }
  .backslash { flex:1.2 1 0; }
  .space { flex:6 1 0; text-align:center; }
  .key.modifier[aria-pressed='true'] { color:var(--appearance-selected-ink,var(--appearance-ink,#292827)); background:var(--appearance-soft-selection,#0001); border-color:var(--appearance-soft-border,#dcd8d3); font-weight:700; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(52px, 1fr)); gap:4px; padding:10px; }
  .cell { min-height:46px; font:20px/1 var(--golden-gate-font,sans-serif); overflow:hidden; }
  .cell.selected { background:var(--appearance-selection,#0878df); color:var(--appearance-selection-ink,#fff); border-color:var(--appearance-soft-border,#dcd8d3); }
  .empty { padding:14px 20px; color:var(--appearance-muted,#75716b); }
  .details { flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:7px 10px; border-top:1px solid var(--appearance-soft-border,#dcd8d3); background:var(--appearance-panel,#f3f1ed); }
  .glyph { flex:none; display:grid; place-items:center; width:44px; height:44px; border-radius:8px; border:1px solid var(--appearance-soft-border,#dcd8d3); font:24px/1 var(--golden-gate-font,sans-serif); background:var(--appearance-surface,#fff); }
  .copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; font-size:11px; overflow:hidden; }
  .copy strong { font-size:11px; } .copy span { color:var(--appearance-muted,#75716b); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .insert { flex:none; min-height:28px; padding:3px 12px; }
  .hint { flex:1; color:var(--appearance-muted,#75716b); font-size:11px; }
  .status { flex:0 0 auto; display:flex; flex-direction:column; gap:3px; padding:5px 12px; border-top:1px solid var(--appearance-soft-border,#dcd8d3); font-size:10px; color:var(--appearance-muted,#75716b); }
  .status span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .status .error { color:var(--appearance-ink,#292827); }
  .error:empty { display:none; }
  @media(max-width:420px) { .titlebar { min-height:28px; padding:0 5px; } .metrics { gap:5px; padding:6px 4px; } .tabs { gap:2px; } .tab { padding:2px 6px; font-size:10px; } .rows { padding:6px; gap:4px; } .krow { gap:3px; } .key { min-height:31px; } .grid { grid-template-columns:repeat(auto-fill, minmax(46px, 1fr)); gap:3px; padding:7px; } .details { padding:6px; gap:7px; } .input-viewer { border-radius:10px; } }
  @media(max-height:260px) {
    .titlebar { min-height:24px; }
    .close { min-height:15px; }
    .metrics { padding:3px 4px; }
    .search, .tab { min-height:24px; }
    .details { padding:3px 6px; gap:6px; }
    .glyph { width:22px; height:22px; font-size:18px; }
    .copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .copy span { display:none; }
    .insert { min-height:24px; padding:2px 8px; }
    .status { padding:3px 6px; gap:1px; font-size:9px; line-height:11px; }
    .grid { grid-template-columns:repeat(auto-fill,minmax(38px,1fr)); }
    .cell { min-height:32px; font-size:19px; }
  }
</style>
