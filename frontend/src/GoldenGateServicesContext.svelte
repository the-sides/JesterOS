<script>
  import { onMount, onDestroy, tick } from 'svelte';

  let { context, items, execute, registerView, area, available = () => true } = $props();
  let panel = $state(null);
  let position = $state(null);
  let disposed = false;
  let writingFocus = null;
  const width = $derived(Math.min(252, Math.max(0, area.width)));
  const initialLeft = $derived(Math.max(area.left, Math.min(context.x, area.left + area.width - width)));
  const popupLeft = $derived(Math.max(area.left, Math.min(position?.contextId === context.contextId ? position.left : initialLeft, area.left + area.width - width)));
  const popupTop = $derived(Math.max(area.top, Math.min(position?.contextId === context.contextId ? position.top : area.top,
    area.top + area.height - Math.min(area.height, position?.contextId === context.contextId ? position.height : area.height))));
  function lease() { return { contextId: context?.contextId, appId: context?.appId, sourceId: context?.sourceId, panel }; }
  function current(owner) {
    return !disposed && context && owner.contextId === context.contextId && owner.appId === context.appId && owner.sourceId === context.sourceId
      && owner.panel === panel && panel?.dataset.servicesContextId === owner.contextId
      && panel.dataset.servicesContextSourceId === owner.sourceId && available(owner.contextId);
  }
  function visible(node) {
    if (!node?.isConnected || !panel?.contains(node) || node.disabled || node.matches(':disabled')) return false;
    const view = node.ownerDocument.defaultView, rect = node.getBoundingClientRect();
    if (!view || !node.getClientRects().length || rect.width <= 0 || rect.height <= 0) return false;
    let left = Math.max(0, area.left, rect.left), top = Math.max(0, area.top, rect.top);
    let right = Math.min(view.innerWidth, area.left + area.width, rect.right), bottom = Math.min(view.innerHeight, area.top + area.height, rect.bottom);
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
    if (!live()) return null;
    if (id === 'panel' || id === null) return panel;
    const item = items.find(item => item.id === id);
    if (!item?.enabled || !item.request) return null;
    const node = [...panel.querySelectorAll('[data-services-context-item]')].find(node => node.dataset.servicesContextItem === id);
    return node?.isConnected && !node.disabled && !node.closest('[inert]') ? node : null;
  }
  function defaultControl() { return context?.itemId ?? items.find(item => item.enabled && item.request)?.id ?? 'panel'; }
  export async function prepare(id = defaultControl()) {
    const owner = lease();
    await tick();
    if (!current(owner)) return false;
    const node = control(id);
    if (!node) return false;
    if (node !== panel) {
      const rect = node.getBoundingClientRect(), clip = panel.getBoundingClientRect();
      const top = clip.top + panel.clientTop, bottom = top + panel.clientHeight;
      panel.scrollTop += rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
    }
    return current(owner) && control(id) === node && visible(node);
  }
  export async function focus(id = defaultControl()) {
    const owner = lease(), node = control(id);
    if (!node || !await prepare(id) || !current(owner) || control(id) !== node) return false;
    writingFocus = node;
    try { node.focus({ preventScroll: true }); }
    catch { return false; }
    finally { writingFocus = null; }
    return current(owner) && visible(node) && node.ownerDocument.activeElement === node;
  }
  export function describe() {
    const nodes = live() ? [...panel.querySelectorAll('[data-services-context-item]')].filter(node => visible(node) && !!control(node.dataset.servicesContextItem)) : [];
    return { controlIds: live() ? ['panel', ...nodes.map(node => node.dataset.servicesContextItem)] : [],
      focusedControl: nodes.find(node => node.ownerDocument.activeElement === node)?.dataset.servicesContextItem ?? (live() && panel.ownerDocument.activeElement === panel ? 'panel' : null),
      scroll: live() ? { top: panel.scrollTop, left: panel.scrollLeft } : null };
  }
  export function contains(node) { return live() && !!node && panel.contains(node); }
  export function scroll({ top, left = 0, observe = false }) {
    if (!live() || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return null;
    if (!observe) {
      panel.scrollTop = Math.min(top, Math.max(0, panel.scrollHeight - panel.clientHeight));
      panel.scrollLeft = Math.min(left, Math.max(0, panel.scrollWidth - panel.clientWidth));
    }
    return { top: panel.scrollTop, left: panel.scrollLeft };
  }
  const facade = { prepare, focus, describe, contains, scroll };
  onMount(() => {
    const callback = registerView, unregister = callback?.(facade);
    return () => { disposed = true; if (typeof unregister === 'function') unregister(); else callback?.(null, facade); };
  });
  onDestroy(() => { disposed = true; });
  $effect(() => {
    const owner = lease(), x = context.x, y = context.y;
    const left = area.left, top = area.top, width = area.width, height = area.height;
    items.length;
    let cancelled = false;
    tick().then(() => {
      if (cancelled || !current(owner) || !panel?.isConnected) return;
      const rect = panel.getBoundingClientRect();
      const contentHeight = Math.min(height, panel.scrollHeight + panel.offsetHeight - panel.clientHeight);
      position = { contextId: owner.contextId, height: contentHeight, left: Math.max(left, Math.min(x, left + width - rect.width)),
        top: Math.max(top, Math.min(y, top + height - contentHeight)) };
    });
    return () => { cancelled = true; };
  });
  function request(action, itemId, owner = lease()) {
    if (!current(owner) || !live()) return null;
    if (itemId !== undefined && !items.some(item => item.id === itemId && item.enabled && item.request)) return null;
    return execute({ command: `services.context.${action}`, target: { contextId: owner.contextId, ...(itemId === undefined ? {} : { itemId }) }, payload: {} });
  }
  function select(item) { if (live() && context.itemId !== item.id) request('select', item.id); }
  function observeFocus(event) {
    const node = event.target, id = node.dataset.servicesContextItem;
    if (node !== writingFocus && id && control(id) === node && visible(node) && node.ownerDocument.activeElement === node && context.itemId !== id) request('select', id);
  }
  export function keydown(event) {
    if (!live() || !panel.contains(event.target)) return;
    event.stopPropagation();
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const enabled = items.filter(item => item.enabled && item.request), index = enabled.findIndex(item => item.id === context.itemId);
    let next;
    if (event.key === 'ArrowDown') next = enabled[index < 0 ? 0 : (index + 1) % enabled.length];
    else if (event.key === 'ArrowUp') next = enabled[index < 0 ? enabled.length - 1 : (index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled.at(-1);
    else if (event.key === 'Enter' || event.key === ' ') { if (index >= 0) request('execute', enabled[index].id); }
    else if (event.key === 'Escape' || event.key === 'Tab') request('close');
    else return;
    event.preventDefault();
    if (next) request('select', next.id);
  }
</script>

{#if area.width > 0 && area.height > 0}
  <div bind:this={panel} class="services-context" role="menu" aria-label="Local Services" tabindex="-1"
    data-services-context-id={context.contextId} data-services-context-source-id={context.sourceId}
    style:left={`${popupLeft}px`} style:top={`${popupTop}px`}
    style:width={`${width}px`} style:max-height={`${Math.max(0, area.top + area.height - popupTop)}px`}
    onkeydown={keydown} onfocusin={observeFocus} onpointerdown={event => event.stopPropagation()} oncontextmenu={event => event.preventDefault()}>
    <div class="heading" role="presentation">Local Services</div>
    {#each items as item (item.id)}
      <button type="button" role="menuitem" data-services-context-item={item.id} disabled={!item.enabled || !item.request}
        tabindex={context.itemId === item.id ? 0 : -1} class:selected={context.itemId === item.id}
        onpointerenter={() => select(item)} onclick={() => request('execute', item.id)}>{item.label}</button>
    {:else}<div class="empty" role="presentation">No local services apply</div>{/each}
  </div>
{/if}

<style>
  .services-context { position: fixed; z-index: 5000; box-sizing: border-box; min-width: 0; overflow: auto; overscroll-behavior: contain; padding: 5px; border: 1px solid var(--appearance-context-border, #ffffff80); border-radius: 9px; color: var(--appearance-context-ink, #222); background: var(--appearance-context-bg, rgb(242 242 242 / 96%)); backdrop-filter: blur(25px); box-shadow: 0 0 0 1px #0002, 0 8px 25px #0004; font: 13px/19px var(--golden-gate-font, sans-serif); }
  .heading { padding: 4px 8px 6px; margin-bottom: 3px; border-bottom: 1px solid var(--appearance-soft-border, #d4d4d4); color: var(--appearance-muted, #75716b); font-size: 10px; font-weight: 650; letter-spacing: .02em; overflow-wrap: anywhere; }
  button { display: block; box-sizing: border-box; width: 100%; border: 0; border-radius: 4px; padding: 5px 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: default; overflow-wrap: anywhere; }
  button.selected:not(:disabled) { color: var(--appearance-selection-ink, #fff); background: var(--appearance-selection, #246bd6); }button:disabled { color: var(--appearance-disabled, #999); }button:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -2px; }.services-context:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -2px; }.empty { padding: 7px 8px; color: var(--appearance-muted, #75716b); font-size: 12px; overflow-wrap: anywhere; }
</style>
