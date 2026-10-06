<script>
  import { onMount, onDestroy, tick } from 'svelte';

  let { pane, execute, registerView, area, available = () => true } = $props();
  let panel = $state(null);
  let disposed = false;
  let writingFocus = null;
  function lease() { return { lookupId: pane?.lookupId, appId: pane?.appId, panel }; }
  function current(owner) {
    return !disposed && pane && owner.lookupId === pane.lookupId && owner.appId === pane.appId && owner.panel === panel
      && panel?.dataset.servicesLookupId === owner.lookupId && panel.dataset.servicesLookupAppId === owner.appId && available(owner.lookupId);
  }
  function visible(node) {
    if (!node?.isConnected || !panel?.contains(node) || node.disabled || node.matches(':disabled')) return false;
    const view = node.ownerDocument.defaultView, rect = node.getBoundingClientRect();
    if (!view || !node.getClientRects().length || rect.width <= 0 || rect.height <= 0) return false;
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(view.innerWidth, rect.right), bottom = Math.min(view.innerHeight, rect.bottom);
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.inert || ancestor.hasAttribute('inert')) return false;
      const style = view.getComputedStyle(ancestor);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
      if (ancestor !== node) {
        const clip = ancestor.getBoundingClientRect();
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
          left = Math.max(left, clip.left + ancestor.clientLeft); right = Math.min(right, clip.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
          top = Math.max(top, clip.top + ancestor.clientTop); bottom = Math.min(bottom, clip.top + ancestor.clientTop + ancestor.clientHeight);
        }
      }
    }
    return right > left && bottom > top;
  }
  function live() { return current(lease()) && visible(panel); }
  function control(id) {
    if (!live() || !['query', 'reader', 'close'].includes(id)) return null;
    const node = [...panel.querySelectorAll('[data-services-lookup-control]')].find(node => node.dataset.servicesLookupControl === id);
    return visible(node) ? node : null;
  }
  export async function prepare(id = 'query') {
    const owner = lease();
    await tick();
    return current(owner) && !!control(id);
  }
  export async function focus(id = 'query') {
    const owner = lease(), node = control(id);
    if (!node || !await prepare(id) || !current(owner) || control(id) !== node) return false;
    writingFocus = node;
    try { node.focus({ preventScroll: true }); }
    catch { return false; }
    finally { writingFocus = null; }
    return current(owner) && visible(node) && node.ownerDocument.activeElement === node;
  }
  export function describe() {
    const nodes = live() ? [...panel.querySelectorAll('[data-services-lookup-control]')].filter(visible) : [];
    return { controlIds: nodes.map(node => node.dataset.servicesLookupControl),
      focusedControl: nodes.find(node => node.ownerDocument.activeElement === node)?.dataset.servicesLookupControl ?? null };
  }
  export function contains(node) { return live() && !!node && panel.contains(node); }
  const facade = { prepare, focus, describe, contains };
  onMount(() => {
    const callback = registerView, unregister = callback?.(facade);
    return () => { disposed = true; if (typeof unregister === 'function') unregister(); else callback?.(null, facade); };
  });
  onDestroy(() => { disposed = true; });
  function request(action, target = {}, payload = {}, owner = lease()) {
    if (!current(owner) || !live()) return null;
    return execute({ command: `services.lookup.${action}`, target: { lookupId: owner.lookupId, ...target }, payload });
  }
  function search(event) {
    const owner = lease(), node = event.currentTarget, query = node.value;
    if (control('query') === node) request('search', {}, { query }, owner);
  }
  function observeFocus(event) {
    const node = event.target, owner = lease(), id = node.dataset.servicesLookupControl;
    if (node === writingFocus || !id || control(id) !== node || node.ownerDocument.activeElement !== node) return;
    request('focus', { control: id }, {}, owner);
  }
  export function keydown(event) {
    if (!live() || !panel.contains(event.target) || event.isComposing) return;
    if (event.key === 'Escape' || event.metaKey && event.key.toLowerCase() === 'w') {
      event.preventDefault(); event.stopImmediatePropagation(); request('close');
    } else if (event.metaKey && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopImmediatePropagation(); request('focus', { control: 'query' });
    }
  }
</script>

<div bind:this={panel} class="lookup" role="dialog" aria-modal="false" tabindex="-1" aria-label="Offline dictionary lookup"
  data-services-lookup-id={pane.lookupId} data-services-lookup-app-id={pane.appId}
  style:--lookup-width={`${Math.max(0, area.width)}px`} style:--lookup-height={`${Math.max(0, area.height)}px`}
  onkeydown={keydown} onfocusin={observeFocus}>
  <header><div><strong>Look Up</strong><span>Offline dictionary</span></div>
    <button type="button" data-services-lookup-control="close" aria-label="Close lookup" title="Close lookup (⌘W)" onclick={() => request('close')}>Close</button>
  </header>
  <label class="query"><span>Word or phrase</span><input type="search" data-services-lookup-control="query" value={pane.query} maxlength="256"
    autocomplete="off" spellcheck="false" oninput={search} /></label>
  <div class="reader" tabindex="-1" data-services-lookup-control="reader" aria-label="Local dictionary definition" aria-live="polite">
    {#if pane.entry}
      <article><p class="source">Original local dictionary</p><h1>{pane.entry.term}</h1><p class="part-of-speech">{pane.entry.partOfSpeech}</p><p class="definition">{pane.entry.definition}</p></article>
    {:else}
      <div class="empty"><h1>No local entry</h1><p>{pane.query.trim() ? 'This word or phrase is not in the original offline dictionary.' : 'Enter a word or phrase to search the original offline dictionary.'}</p></div>
    {/if}
    {#if pane.error}<p class="error" role="alert">{pane.error}</p>{/if}
  </div>
  <footer>Local definitions only. No downloads or online lookup.</footer>
</div>

<style>
  .lookup { display: flex; flex-direction: column; box-sizing: border-box; width: min(390px, var(--lookup-width), 100%); max-height: min(380px, var(--lookup-height)); min-width: 0; min-height: 0; overflow: auto; border: 1px solid var(--appearance-context-border, #ffffff80); border-radius: 14px; background: var(--appearance-panel, #f3f1ed); color: var(--appearance-ink, #292827); box-shadow: 0 0 0 1px #0002, 0 14px 38px #0004; font: 13px/1.5 var(--golden-gate-font, sans-serif); }
  header { display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 15px; border-bottom: 1px solid var(--appearance-soft-border, #dcd8d3); background: var(--appearance-toolbar, #efede9); }
  header>div { display: flex; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 5px 12px; min-width: 0; }header strong { font-weight: 650; }header span { font-size: 10px; color: var(--appearance-muted, #75716b); }
  button { box-sizing: border-box; max-width: 100%; padding: 4px 9px; border: 1px solid var(--appearance-border, #c6c3bd); border-radius: 6px; background: var(--appearance-surface, #fff); color: inherit; font: inherit; font-size: 11px; cursor: default; }
  .query { display: flex; flex: 0 0 auto; flex-direction: column; gap: 5px; padding: 12px 15px; }.query>span { font-size: 11px; color: var(--appearance-muted, #75716b); }input { box-sizing: border-box; width: 100%; min-width: 0; padding: 6px 9px; border: 1px solid var(--appearance-border, #c6c3bd); border-radius: 8px; color: inherit; background: var(--appearance-input, var(--appearance-surface, #fff)); font: inherit; }
  .reader { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; background: var(--appearance-surface, #fff); padding: 18px 20px; overflow-wrap: anywhere; }.source { margin: 0 0 10px; font-size: 10px; color: var(--appearance-muted, #75716b); letter-spacing: .035em; }h1 { margin: 0; font-size: 24px; line-height: 1.2; font-weight: 650; letter-spacing: -.025em; }.part-of-speech { margin: 7px 0 12px; font-size: 12px; font-style: italic; color: var(--appearance-muted, #75716b); }.definition { margin: 0; line-height: 1.65; white-space: pre-wrap; }.empty h1 { font-size: 18px; }.empty p { margin-bottom: 0; color: var(--appearance-muted, #75716b); font-size: 12px; }.error { border-left: 3px solid var(--appearance-accent, #0878ef); padding-left: 8px; }
  footer { flex: 0 0 auto; padding: 8px 15px; border-top: 1px solid var(--appearance-soft-border, #dcd8d3); color: var(--appearance-muted, #75716b); font-size: 10px; overflow-wrap: anywhere; }
  button:focus-visible, input:focus-visible, .reader:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -2px; }
</style>
