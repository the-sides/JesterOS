<script>
  import { onDestroy, tick, untrack } from 'svelte';
  import { helpArticles, searchHelpArticles } from './help-content.js';

  let { profile, pane, execute, foreground = true } = $props();
  let panel = $state(null);
  let error = $state(null);
  let disposed = false;
  let writingFocus = null;
  const writtenScroll = new WeakMap();
  const app = $derived(profile?.applications?.[pane?.appId] ?? null);
  const articles = $derived(pane && app ? helpArticles(profile, pane.appId) : []);
  const results = $derived(pane && app ? searchHelpArticles(profile, pane.appId, pane.query) : []);
  const article = $derived(articles.find(item => item.articleId === pane?.articleId) ?? null);
  const searching = $derived(!!pane?.query.trim());
  const supported = $derived(profile?.id === 'macos-golden-gate-27.0.1' && !!pane && !!app && !!article);

  onDestroy(() => { disposed = true; });

  function lease() {
    return { helpId: pane?.helpId, appId: pane?.appId, panel };
  }
  function current(owner, allowMount = false) {
    return !disposed && supported && foreground && owner.helpId === pane?.helpId
      && owner.appId === pane?.appId && (owner.panel === panel || allowMount && !owner.panel)
      && panel?.dataset.helpViewerId === owner.helpId;
  }
  function visible(node) {
    if (!node?.isConnected || !panel?.contains(node) || node.disabled || node.matches(':disabled')) return false;
    const rect = node.getBoundingClientRect();
    if (!node.getClientRects().length || rect.width <= 0 || rect.height <= 0) return false;
    const view = node.ownerDocument.defaultView;
    if (!view) return false;
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(view.innerWidth, rect.right), bottom = Math.min(view.innerHeight, rect.bottom);
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.inert || ancestor.hasAttribute('inert')) return false;
      const style = view.getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
      if (ancestor !== node) {
        const clip = ancestor.getBoundingClientRect();
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
          left = Math.max(left, clip.left + ancestor.clientLeft);
          right = Math.min(right, clip.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
          top = Math.max(top, clip.top + ancestor.clientTop);
          bottom = Math.min(bottom, clip.top + ancestor.clientTop + ancestor.clientHeight);
        }
      }
    }
    return right > left && bottom > top;
  }
  function controls() {
    return available() ? [...panel.querySelectorAll('[data-help-control]')].filter(visible) : [];
  }
  function control(controlId) {
    return controls().find(node => node.dataset.helpControl === controlId) ?? null;
  }
  function regionNode(region) {
    if (!available() || !['results', 'article'].includes(region)) return null;
    const node = [...panel.querySelectorAll('[data-help-region]')].find(item => item.dataset.helpRegion === region);
    return visible(node) ? node : null;
  }
  const rect = node => {
    const value = node.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  };
  const position = node => ({ top: node.scrollTop, left: node.scrollLeft });

  export function available() {
    return current(lease()) && visible(panel);
  }
  export async function prepare() {
    const owner = lease();
    await tick();
    return current(owner, true) && available() && controls().some(node => node.tabIndex >= 0);
  }
  export function controlIds() {
    return controls().map(node => node.dataset.helpControl);
  }
  export async function focus(controlId) {
    const owner = lease();
    const original = control(controlId);
    if (!original) return false;
    await tick();
    if (!current(owner) || control(controlId) !== original) return false;
    writingFocus = original;
    try { original.focus({ preventScroll: true }); }
    catch { return false; }
    finally { writingFocus = null; }
    return current(owner) && visible(original) && original.ownerDocument.activeElement === original;
  }
  export function focusedControl() {
    return controls().find(node => node.ownerDocument.activeElement === node)?.dataset.helpControl ?? null;
  }
  function writeScroll(node, top, left, owner) {
    if (node.scrollTop === top && node.scrollLeft === left) return position(node);
    node.scrollTop = top;
    node.scrollLeft = left;
    const actual = position(node);
    writtenScroll.set(node, { ...owner, ...actual });
    return actual;
  }
  export async function scroll(region, top, left = 0) {
    if (!Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return null;
    const owner = lease();
    const articleId = pane?.articleId;
    const original = regionNode(region);
    if (!original) return null;
    await tick();
    if (!current(owner) || pane.articleId !== articleId || regionNode(region) !== original) return null;
    return writeScroll(original, top, left, owner);
  }
  export function scrollPosition(region) {
    const node = regionNode(region);
    return node ? position(node) : null;
  }
  export function bounds() {
    if (!available()) return null;
    return {
      helpId: pane.helpId, appId: pane.appId, bounds: rect(panel),
      controls: controls().map(node => ({ controlId: node.dataset.helpControl, bounds: rect(node), focused: node.ownerDocument.activeElement === node })),
      regions: ['results', 'article'].flatMap(region => {
        const node = regionNode(region);
        return node ? [{ region, bounds: rect(node), ...position(node), scrollWidth: node.scrollWidth,
          scrollHeight: node.scrollHeight, clientWidth: node.clientWidth, clientHeight: node.clientHeight }] : [];
      }),
    };
  }

  $effect(() => {
    const helpId = pane?.helpId, appId = pane?.appId, articleId = pane?.articleId, query = pane?.query;
    const resultsTop = pane?.scroll.results.top, resultsLeft = pane?.scroll.results.left;
    const articleTop = pane?.scroll.article.top, articleLeft = pane?.scroll.article.left;
    const root = panel;
    const active = foreground, ready = supported;
    // Article/query changes alter scroll extents. Only the domain's offsets restore them.
    untrack(() => {
      if (!active || !ready || !root || !current({ helpId, appId, panel: root })) return;
      for (const [region, top, left] of [['results', resultsTop, resultsLeft], ['article', articleTop, articleLeft]]) {
        const node = regionNode(region);
        if (node && Number.isFinite(top) && Number.isFinite(left)) writeScroll(node, top, left, { helpId, appId, panel: root });
      }
    });
  });

  async function request(command, target = {}, payload = {}, owner = lease()) {
    if (!current(owner) || !available()) return null;
    try {
      const result = await execute({ command: `help.viewer.${command}`, target: { helpId: owner.helpId, ...target }, payload });
      if (current(owner)) error = result?.status === 'rejected'
        ? { helpId: owner.helpId, text: result.error?.message ?? result.message ?? 'The Help request could not be completed.' } : null;
      return result;
    } catch (cause) {
      if (current(owner)) error = { helpId: owner.helpId, text: cause?.message ?? 'The Help request could not be completed.' };
      return null;
    }
  }
  function observeFocus(event) {
    const owner = lease();
    const node = event.target;
    if (node === writingFocus || !current(owner) || !visible(node) || node.ownerDocument.activeElement !== node || !node.dataset.helpControl) return;
    request('focus', { controlId: node.dataset.helpControl }, { observe: true }, owner);
  }
  function observeScroll(event, region) {
    const owner = lease();
    const node = event.currentTarget;
    if (!current(owner) || regionNode(region) !== node) return;
    const actual = position(node);
    const written = writtenScroll.get(node);
    writtenScroll.delete(node);
    if (written && current(written) && written.top === actual.top && written.left === actual.left) return;
    const canonical = pane.scroll[region];
    if (canonical.top === actual.top && canonical.left === actual.left) return;
    request('scroll', { region }, { ...actual, observe: true }, owner);
  }
  async function showContents() {
    const owner = lease();
    const result = await request('search', {}, { query: '' }, owner);
    if (result?.status === 'applied' && current(owner)) await request('focus', { controlId: 'contents' }, {}, owner);
  }
  export function keydown(event) {
    if (!available() || !panel.contains(event.target)) return;
    if (event.key === 'Escape' || event.metaKey && event.key.toLowerCase() === 'w') {
      event.preventDefault(); event.stopImmediatePropagation();
      request('close');
    } else if (event.metaKey && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopImmediatePropagation();
      request('focus', { controlId: 'search' });
    }
    // This is a nonmodal reader: native Tab can leave it for the main application.
  }
</script>

{#if supported}
  {#key pane.helpId}
    <div bind:this={panel} class="help-viewer" class:inactive={!foreground} role="dialog" aria-modal="false"
      aria-label={`${app.name} Help`} data-help-viewer-id={pane.helpId} data-help-app-id={pane.appId}
      tabindex="-1" inert={!foreground} onkeydown={keydown} onfocusin={observeFocus}>
      <header class="titlebar">
        <button class="close" type="button" data-help-control="close" aria-label="Close Help" title="Close Help (⌘W)" onclick={() => request('close')}><span aria-hidden="true">×</span></button>
        <h1>{app.name} Help</h1>
        <span class="offline">Offline</span>
      </header>
      <div class="toolbar" role="group" aria-label="Help navigation">
        <div class="history">
          <button type="button" data-help-control="back" aria-label="Back" title="Back" disabled={!pane.backStack.length} onclick={() => request('navigate', {}, { direction: 'back' })}>‹</button>
          <button type="button" data-help-control="forward" aria-label="Forward" title="Forward" disabled={!pane.forwardStack.length} onclick={() => request('navigate', {}, { direction: 'forward' })}>›</button>
        </div>
        <button class="contents" type="button" data-help-control="contents" aria-label="Show all Help contents" aria-pressed={!searching} onclick={showContents}>Contents</button>
        <input type="search" data-help-control="search" aria-label={`Search ${app.name} Help`} placeholder="Search Help" maxlength="256" value={pane.query}
          oninput={event => request('search', {}, { query: event.currentTarget.value })} />
      </div>
      <div class="reader">
        <nav class="topics" aria-label={searching ? 'Help search results' : 'Help contents'}>
          <h2>{searching ? 'Search Results' : 'Contents'} <span>{results.length}</span></h2>
          <div class="results-scroll" data-help-region="results" onscroll={event => observeScroll(event, 'results')}>
            {#if searching && !results.length}
              <p class="empty" role="status">No Help topics match “{pane.query}”. Try other words, or choose Contents to browse all topics.</p>
            {:else}
              <ul>
                {#each results as item (item.articleId)}
                  <li><button type="button" data-help-control={`article:${item.articleId}`} aria-current={pane.articleId === item.articleId ? 'page' : undefined}
                    onclick={() => request('read', { articleId: item.articleId })}>{item.title}</button></li>
                {/each}
              </ul>
            {/if}
          </div>
        </nav>
        {#key pane.articleId}
          <article class="article-scroll" data-help-region="article" data-help-control="reader" aria-label={article.title} tabindex="-1" onscroll={event => observeScroll(event, 'article')}>
            <div class="article-copy">
              <p class="eyebrow">{app.name} · Simulation Help</p>
              <h2>{article.title}</h2>
              <p class="summary">{article.summary}</p>
              {#each article.sections as section}
                <section class="article-section">
                  <h3>{section.heading}</h3>
                  {#each section.paragraphs as paragraph}<p>{paragraph}</p>{/each}
                </section>
              {/each}
            </div>
          </article>
        {/key}
      </div>
      <footer aria-live="polite">
        {#if error?.helpId === pane.helpId}<span class="error" role="status">{error.text}</span>
        {:else}<span>Original documentation for this simulation · No online connection</span>{/if}
      </footer>
    </div>
  {/key}
{/if}

<style>
  .help-viewer { box-sizing:border-box; display:flex; flex-direction:column; width:min(700px,100%); height:min(500px,100%); max-width:100%; max-height:100%; min-width:0; min-height:0; overflow:hidden; border:1px solid var(--appearance-border,#c6c3bd); border-radius:14px; background:var(--appearance-panel,#f3f1ed); color:var(--appearance-ink,#292827); box-shadow:0 16px 46px #0004,0 2px 8px #0002; font:12px/1.45 var(--golden-gate-font,sans-serif); }
  .inactive { box-shadow:0 12px 28px #0002; }
  .titlebar { display:flex; align-items:center; gap:10px; flex:0 0 auto; min-height:35px; padding:0 12px; background:var(--appearance-toolbar,#efede9); border-bottom:1px solid var(--appearance-soft-border,#dcd8d3); }
  h1 { flex:1; min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; font-size:13px; font-weight:650; }
  .offline { color:var(--appearance-muted,#75716b); font-size:10px; }
  button,input { box-sizing:border-box; font:inherit; color:inherit; }
  button { cursor:default; border:1px solid var(--appearance-border,#c6c3bd); border-radius:6px; background:var(--appearance-surface,#fff); min-height:27px; padding:3px 9px; }
  button:disabled { opacity:.4; }
  .close { flex:none; display:grid; place-items:center; width:14px; height:14px; min-height:0; padding:0; border:1px solid #0002; border-radius:50%; background:var(--appearance-traffic-light-bg,#ff6058); color:var(--appearance-traffic-light-ink,#810e08); font:14px/1 var(--golden-gate-font,sans-serif); }
  .close span { opacity:0; } .close:hover span,.close:focus-visible span { opacity:1; }
  .toolbar { display:flex; align-items:center; gap:8px; flex:0 0 auto; padding:9px 12px; border-bottom:1px solid var(--appearance-soft-border,#dcd8d3); }
  .history { display:flex; flex:none; gap:3px; } .history button { width:28px; padding:0; font-size:23px; line-height:23px; }
  .contents { flex:none; font-size:11px; }
  input { width:100%; min-width:0; flex:1; min-height:28px; padding:4px 8px; border:1px solid var(--appearance-border,#c6c3bd); border-radius:7px; background:var(--appearance-input,var(--appearance-surface,#fff)); }
  button:focus-visible,input:focus-visible,.article-scroll:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-2px; }
  .reader { flex:1; min-height:0; display:grid; grid-template-columns:minmax(100px,30%) minmax(0,1fr); overflow:hidden; }
  .topics { display:flex; flex-direction:column; min-width:0; min-height:0; border-right:1px solid var(--appearance-soft-border,#dcd8d3); background:var(--appearance-panel,#ece9e3); }
  .topics h2 { display:flex; justify-content:space-between; gap:5px; flex:none; margin:0; padding:10px 12px 6px; color:var(--appearance-muted,#75716b); font-size:10px; font-weight:650; }
  .topics h2 span { font-variant-numeric:tabular-nums; font-weight:400; }
  .results-scroll { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; overflow-anchor:none; }
  ul { list-style:none; margin:0; padding:3px 6px 10px; }
  li { margin:2px 0; }
  li button { display:block; width:100%; border:0; background:transparent; text-align:left; padding:6px; overflow-wrap:anywhere; font-size:11px; line-height:1.35; }
  li button:hover { background:var(--appearance-hover,#00000009); }
  li button[aria-current=page] { color:var(--appearance-selection-ink,#fff); background:var(--appearance-selection,#0878df); }
  .empty { padding:0 12px; color:var(--appearance-muted,#75716b); overflow-wrap:anywhere; font-size:11px; }
  .article-scroll { min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; overflow-anchor:none; background:var(--appearance-surface,#fff); }
  .article-copy { padding:20px 24px 28px; overflow-wrap:anywhere; }
  .eyebrow { margin:0 0 8px; color:var(--appearance-muted,#75716b); font-size:10px; letter-spacing:.035em; }
  .article-copy h2 { margin:0 0 10px; font-size:23px; line-height:1.2; font-weight:650; letter-spacing:-.025em; }
  .summary { margin:0 0 22px; color:var(--appearance-muted,#75716b); font-size:12px; }
  .article-section { margin:18px 0 0; } h3 { margin:0 0 7px; font-size:13px; font-weight:650; } .article-section p { margin:7px 0; line-height:1.6; }
  footer { flex:0 0 auto; padding:5px 12px; border-top:1px solid var(--appearance-soft-border,#dcd8d3); font-size:10px; color:var(--appearance-muted,#75716b); }
  footer span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } footer .error { color:var(--appearance-ink,#292827); }
  @media(max-width:420px) { .titlebar { min-height:29px; padding:0 9px; } .toolbar { gap:5px; padding:6px 8px; } .history { gap:2px; } .history button { width:25px; } .contents { padding:3px 6px; } .reader { grid-template-columns:minmax(96px,32%) minmax(0,1fr); } .topics h2 { padding:7px 8px 4px; font-size:9px; } ul { padding:2px 4px 6px; } li button { padding:5px; font-size:10px; } .article-copy { padding:12px 13px 20px; } .article-copy h2 { font-size:18px; } .summary { margin-bottom:14px; font-size:11px; } .article-section { margin-top:13px; } h3 { font-size:12px; } .article-section p { font-size:11px; } footer { padding:4px 8px; font-size:9px; } }
</style>
