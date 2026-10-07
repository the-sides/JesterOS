<script>
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';

  let { pane, foreground = true, registerView, execute } = $props();
  let panel = $state(null);
  let field = $state(null);
  let resultsBody = $state(null);
  let nativeError = $state(null);
  let disposed = false;
  let composing = false;
  let requestSequence = 0;
  let submittedQuery = null;
  let observedSpotlightId = null;
  const groupNames = { apps: 'Applications', documents: 'Documents', contacts: 'Contacts', mail: 'Mail' };
  const groupOrder = ['apps', 'documents', 'contacts', 'mail'];
  const glyphs = { app: 'A', file: '▤', note: '≡', contact: '◎', mail: '✉' };
  const revealNames = { app: 'Show in Finder', file: 'Show in Finder', note: 'Show in Notes', contact: 'Show in Contacts', mail: 'Show in Mail' };
  const selected = $derived(pane?.results.find(result => result.resultId === pane.selectedResultId) ?? null);
  $effect(() => {
    const spotlightId = pane?.spotlightId;
    untrack(() => {
      if (observedSpotlightId === spotlightId) return;
      observedSpotlightId = spotlightId;
      composing = false;
      submittedQuery = null;
      if (nativeError?.spotlightId !== spotlightId) nativeError = null;
    });
  });
  const errorText = $derived(pane?.error || (nativeError?.spotlightId === pane?.spotlightId ? nativeError.text : ''));
  const listId = $derived(`spotlight-results-${pane?.spotlightId}`);
  const optionId = resultId => `${listId}-${encodeURIComponent(resultId)}`;

  function lease() {
    return { spotlightId: pane?.spotlightId, panel, field, resultsBody };
  }
  function current(owner) {
    return Boolean(!disposed && owner.spotlightId && owner.spotlightId === pane?.spotlightId
      && owner.panel === panel && owner.field === field && owner.resultsBody === resultsBody
      && panel?.dataset.spotlightId === owner.spotlightId);
  }
  // Scroll-clipped result rows remain real mounted controls; revealing them is a
  // separate operation. Hidden or inert owners never confer native authority.
  function mounted(node) {
    if (!foreground || !panel?.isConnected || !node?.isConnected || !panel.contains(node)) return false;
    if (!panel.getClientRects().length || panel.clientWidth <= 0 || panel.clientHeight <= 0) return false;
    const view = panel.ownerDocument.defaultView;
    if (!view) return false;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.inert || ancestor.hasAttribute('inert')) return false;
      const style = view.getComputedStyle(ancestor);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return true;
  }
  function available() {
    return current(lease()) && mounted(panel);
  }
  function controls() {
    return available() ? [...panel.querySelectorAll('[data-spotlight-control]')]
      .filter(node => mounted(node) && !node.disabled) : [];
  }
  function control(controlId) {
    return controls().find(node => node.dataset.spotlightControl === controlId) ?? null;
  }
  function valid(owner, guard) {
    return current(owner) && available() && (typeof guard !== 'function' || guard() === true);
  }
  const position = () => ({ top: resultsBody?.scrollTop ?? 0, left: resultsBody?.scrollLeft ?? 0 });
  function describe() {
    const nodes = controls();
    return {
      controlIds: nodes.map(node => node.dataset.spotlightControl),
      focusedControl: nodes.find(node => node.ownerDocument.activeElement === node)?.dataset.spotlightControl ?? null,
      scroll: position(),
      composing: composing || field?.isComposing === true,
    };
  }
  async function prepare(controlId, guard) {
    const owner = lease();
    const original = control(controlId);
    if (!original || !valid(owner, guard) || controlId === 'search' && describe().composing) return false;
    await tick();
    return valid(owner, guard) && control(controlId) === original
      && !(controlId === 'search' && describe().composing);
  }
  async function focus(controlId, selection, guard) {
    const owner = lease();
    const original = control(controlId);
    if (!original || !valid(owner, guard) || describe().composing) return false;
    if (selection && (original !== field || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)
      || selection.start < 0 || selection.end < selection.start || selection.end > field.value.length
      || !['forward', 'backward', 'none'].includes(selection.direction ?? 'none'))) return false;
    await tick();
    if (!valid(owner, guard) || control(controlId) !== original || describe().composing) return false;
    original.focus({ preventScroll: true });
    if (!valid(owner, guard) || original.ownerDocument.activeElement !== original) return false;
    if (selection) original.setSelectionRange(selection.start, selection.end, selection.direction ?? 'none');
    return valid(owner, guard) && original.ownerDocument.activeElement === original
      && (!selection || original.selectionStart === selection.start && original.selectionEnd === selection.end
        // Chromium reports a nondirectional range as forward; only explicit
        // directional requests constrain the anchor orientation.
        && (!selection.direction || selection.direction === 'none' || original.selectionDirection === selection.direction));
  }
  function writeQuery(query) {
    if (!field || describe().composing) return false;
    if (field.value === query) return true;
    const start = field.selectionStart, end = field.selectionEnd, direction = field.selectionDirection;
    const focused = field.ownerDocument.activeElement === field;
    field.value = query;
    submittedQuery = null;
    if (focused && Number.isInteger(start) && Number.isInteger(end)) {
      field.setSelectionRange(Math.min(start, query.length), Math.min(end, query.length), direction ?? 'none');
    }
    return field.value === query;
  }
  async function setQuery(query, guard) {
    const owner = lease();
    const original = control('search');
    if (!original || typeof query !== 'string' || query.length > 256 || !valid(owner, guard) || describe().composing) return false;
    await tick();
    if (!valid(owner, guard) || control('search') !== original || describe().composing) return false;
    // Programmatic assignment emits no input event; the command owns the commit.
    return writeQuery(query) && valid(owner, guard) && original.value === query;
  }
  async function reveal(resultId, guard) {
    const owner = lease();
    const original = control(`result:${resultId}`);
    if (!original || !valid(owner, guard)) return false;
    await tick();
    if (!valid(owner, guard) || control(`result:${resultId}`) !== original) return false;
    const top = original.offsetTop, bottom = top + original.offsetHeight;
    if (top < resultsBody.scrollTop) resultsBody.scrollTop = top;
    else if (bottom > resultsBody.scrollTop + resultsBody.clientHeight) resultsBody.scrollTop = bottom - resultsBody.clientHeight;
    return valid(owner, guard) && control(`result:${resultId}`) === original
      && resultsBody.clientHeight > 0 && bottom > resultsBody.scrollTop
      && top < resultsBody.scrollTop + resultsBody.clientHeight;
  }
  async function scroll(offsets, guard) {
    const owner = lease();
    if (!valid(owner, guard) || !mounted(resultsBody)
      || !Number.isFinite(offsets?.top) || !Number.isFinite(offsets?.left)
      || offsets.top < 0 || offsets.left < 0 || offsets.top > Number.MAX_SAFE_INTEGER || offsets.left > Number.MAX_SAFE_INTEGER) return null;
    await tick();
    if (!valid(owner, guard) || !mounted(owner.resultsBody)) return null;
    resultsBody.scrollTop = offsets.top;
    resultsBody.scrollLeft = offsets.left;
    return valid(owner, guard) ? position() : null;
  }
  const facade = { available, prepare, focus, setQuery, reveal, scroll, describe };
  onMount(() => { registerView(facade); });
  onDestroy(() => { disposed = true; registerView(null); });

  $effect(() => {
    const query = pane?.query, spotlightId = pane?.spotlightId, node = field;
    untrack(() => {
      if (node && panel?.dataset.spotlightId === spotlightId && typeof query === 'string' && !describe().composing) writeQuery(query);
    });
  });

  async function request(command, target = {}, payload = {}) {
    const owner = lease();
    if (!available()) return null;
    const sequence = ++requestSequence;
    try {
      const result = await execute(`spotlight.${command}`, { spotlightId: owner.spotlightId, ...target }, payload);
      if (current(owner) && sequence === requestSequence) {
        nativeError = result?.status === 'rejected'
          ? { spotlightId: owner.spotlightId, text: result.error?.message ?? result.message ?? 'The Spotlight request could not be completed.' } : null;
      }
      return result;
    } catch (cause) {
      if (current(owner) && sequence === requestSequence) nativeError = {
        spotlightId: owner.spotlightId, text: cause?.message ?? 'The Spotlight request could not be completed.',
      };
      return null;
    }
  }
  function submitQuery(event) {
    if (composing || event.isComposing || !available()) return;
    const query = event.currentTarget.value;
    if (submittedQuery?.spotlightId === pane.spotlightId && submittedQuery.query === query) return;
    submittedQuery = { spotlightId: pane.spotlightId, query };
    void request('query', {}, { query });
  }
  function compositionEnd(event) {
    composing = false;
    submitQuery(event);
  }
  function keydown(event) {
    if (!available() || composing || event.isComposing || event.keyCode === 229) return;
    let command = null, payload = {}, target = {};
    if (event.key === 'Escape') command = 'close';
    else if (event.metaKey && !event.altKey && !event.ctrlKey && event.key.toLowerCase() === 'r' && selected?.canReveal) {
      command = 'reveal'; target = { resultId: selected.resultId };
    } else if (event.target === field && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        command = 'navigate'; payload = { direction: event.key === 'ArrowDown' ? 'next' : 'previous' };
      } else if (event.key === 'Enter' && selected) { command = 'openResult'; target = { resultId: selected.resultId }; }
    }
    if (!command) return;
    event.preventDefault(); event.stopPropagation();
    void request(command, target, payload);
  }
  function observeScroll() {
    if (!available() || !pane?.scroll) return;
    const actual = position();
    if (actual.top !== pane.scroll.top || actual.left !== pane.scroll.left) void request('scroll', {}, actual);
  }
</script>

{#if pane}
  {#key pane.spotlightId}
    <div bind:this={panel} class="spotlight" role="dialog" aria-label="Spotlight" aria-modal="false" tabindex="-1"
      data-spotlight-id={pane.spotlightId} inert={!foreground} aria-busy={pane.busy} onkeydown={keydown}>
      <header class="searchbar">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
        <input bind:this={field} type="text" role="combobox" data-spotlight-control="search" data-spotlight-owner={pane.spotlightId} aria-label="Spotlight Search"
          aria-autocomplete="list" aria-expanded={pane.results.length > 0} aria-controls={listId}
          aria-activedescendant={selected ? optionId(selected.resultId) : undefined} autocomplete="off" spellcheck="false"
          maxlength="256" placeholder="Spotlight Search" disabled={pane.busy}
          oninput={submitQuery} oncompositionstart={() => { composing = true; }} oncompositionend={compositionEnd} />
        <button type="button" class="close" data-spotlight-control="close" data-spotlight-owner={pane.spotlightId} aria-label="Close Spotlight" title="Close Spotlight (Escape)"
          onclick={() => request('close')}><span aria-hidden="true">×</span></button>
      </header>
      <div bind:this={resultsBody} class="results" onscroll={observeScroll}>
        {#if errorText}<p class="error" role="alert">{errorText}</p>{/if}
        {#if !pane.query.trim()}
          <p class="empty" role="status"><strong>Find something on this desktop.</strong><span>Search applications, documents, contacts and mail.</span></p>
        {:else if !pane.results.length}
          <p class="empty" role="status"><strong>No matches for “{pane.query}”.</strong><span>Try a different name or a few words from the content.</span></p>
        {/if}
        <div id={listId} role="listbox" aria-label="Spotlight results">
          {#each groupOrder as group}
            {@const items = pane.results.filter(result => result.group === group)}
            {#if items.length}
              <div role="group" aria-labelledby={`${listId}-${group}`}>
                <h2 id={`${listId}-${group}`}>{groupNames[group]}</h2>
                {#each items as result (result.resultId)}
                  <button type="button" role="option" class="result" class:selected={pane.selectedResultId === result.resultId}
                    id={optionId(result.resultId)} data-spotlight-control={`result:${result.resultId}`} data-spotlight-owner={pane.spotlightId}
                    aria-selected={pane.selectedResultId === result.resultId} tabindex="-1" disabled={pane.busy}
                    onmousedown={event => event.preventDefault()}
                    onclick={() => request('select', { resultId: result.resultId })}
                    ondblclick={() => request('openResult', { resultId: result.resultId })}>
                    <span class="icon" aria-hidden="true">
                      {#if result.icon}
                        <GoldenGateIcon name={result.icon} />
                      {:else}
                        <span>{glyphs[result.kind] ?? '▤'}</span>
                      {/if}
                    </span>
                    <span class="result-copy"><strong>{result.label}</strong><span>{result.secondary}</span></span>
                  </button>
                {/each}
              </div>
            {/if}
          {/each}
        </div>
      </div>
      <footer>
        <span class="count" role="status">{pane.busy ? 'Opening…' : `${pane.results.length} ${pane.results.length === 1 ? 'result' : 'results'}`}</span>
        <button type="button" class="reveal" data-spotlight-control="reveal" data-spotlight-owner={pane.spotlightId} disabled={!selected?.canReveal || pane.busy}
          title={selected?.canReveal ? `${revealNames[selected.kind]} (⌘R)` : 'Select a result with a local location'}
          onclick={() => selected && request('reveal', { resultId: selected.resultId })}>{selected ? revealNames[selected.kind] : 'Show location'}</button>
        <button type="button" class="open" data-spotlight-control="open" data-spotlight-owner={pane.spotlightId} disabled={!selected || pane.busy}
          title="Open selected result (Return)" onclick={() => selected && request('openResult', { resultId: selected.resultId })}>Open</button>
      </footer>
    </div>
  {/key}
{/if}

<style>
  .spotlight { box-sizing:border-box; container-type:size; width:100%; height:100%; min-width:0; min-height:0; display:flex; flex-direction:column; overflow:hidden;
    color:var(--appearance-ink,#292827); background:color-mix(in srgb,var(--appearance-panel,#f3f1ed) 88%,transparent);
    border:1px solid var(--appearance-border,#c6c3bd); border-radius:18px; box-shadow:0 20px 64px #0004,0 2px 8px #0002,inset 0 1px 0 #ffffff38;
    backdrop-filter:blur(28px) saturate(1.35); font:12px/1.35 var(--golden-gate-font,sans-serif); }
  .searchbar { display:flex; align-items:center; flex:none; gap:10px; padding:12px 14px; border-bottom:1px solid var(--appearance-soft-border,#dcd8d3); }
  .search-icon { flex:none; width:22px; height:22px; stroke:var(--appearance-muted,#75716b); stroke-width:1.8; stroke-linecap:round; }
  input { box-sizing:border-box; flex:1; min-width:0; width:0; border:0; background:transparent; color:inherit; font:500 20px/1.25 var(--golden-gate-font,sans-serif); padding:3px 0; border-radius:4px; }
  input::placeholder { color:var(--appearance-muted,#75716b); opacity:.85; }
  button { font:inherit; color:inherit; cursor:default; }
  button:disabled { opacity:.45; }
  button:focus-visible,input:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; }
  .close { flex:none; width:24px; height:24px; padding:0; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:50%; background:var(--appearance-hover,#00000009); font-size:18px; line-height:1; }
  .results { position:relative; flex:1 1 auto; min-height:0; overflow:auto; overscroll-behavior:contain; overflow-anchor:none; padding:4px 6px 8px; }
  h2 { margin:9px 10px 4px; font-size:10px; font-weight:650; letter-spacing:.065em; text-transform:uppercase; color:var(--appearance-muted,#75716b); }
  .result { box-sizing:border-box; display:flex; align-items:center; gap:10px; width:100%; min-height:45px; padding:6px 10px; border:0; border-radius:9px; background:transparent; text-align:left; }
  .result:hover { background:var(--appearance-hover,#00000009); }
  .result.selected { background:var(--appearance-selection,#0878df); color:var(--appearance-selection-ink,#fff); }
  .icon { position:relative; display:grid; place-items:center; flex:none; width:28px; height:28px; border-radius:7px; background:var(--appearance-surface,#fff); color:var(--appearance-muted,#75716b); border:1px solid var(--appearance-soft-border,#dcd8d3); font-size:18px; }
  .result-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
  .result-copy strong,.result-copy span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .result-copy strong { font-weight:600; }
  .result-copy span { font-size:10px; color:var(--appearance-muted,#75716b); }
  .selected .result-copy span { color:inherit; opacity:.83; }
  .empty { margin:0; padding:18px 14px; color:var(--appearance-muted,#75716b); overflow-wrap:anywhere; }
  .empty strong,.empty span { display:block; } .empty strong { color:var(--appearance-ink,#292827); font-weight:550; margin-bottom:5px; }
  .error { margin:5px 6px; padding:8px; border-left:2px solid var(--appearance-focus,#4f98e8); background:var(--appearance-hover,#00000009); overflow-wrap:anywhere; }
  footer { flex:none; display:flex; align-items:center; gap:6px; padding:8px 10px; border-top:1px solid var(--appearance-soft-border,#dcd8d3); background:color-mix(in srgb,var(--appearance-panel,#efede9) 75%,transparent); }
  footer button { flex:none; min-height:26px; border:1px solid var(--appearance-border,#c6c3bd); border-radius:7px; padding:3px 9px; background:var(--appearance-surface,#fff); font-size:11px; }
  footer .open { background:var(--appearance-selection,#0878df); color:var(--appearance-selection-ink,#fff); border-color:transparent; }
  .count { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:10px; color:var(--appearance-muted,#75716b); }
  @container (max-height:220px) { .searchbar { padding:7px 10px; } input { font-size:17px; } footer { padding:5px 8px; } .empty { padding:10px; } }
</style>
