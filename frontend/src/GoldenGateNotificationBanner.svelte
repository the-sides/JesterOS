<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import GoldenGateNotificationCard from './GoldenGateNotificationCard.svelte';

  let { banner, entry, app, actions = [], showPreview = true,
    itemUi = { expanded: false, optionsOpen: false, replyBody: null }, timestamp = '',
    foreground = true, execute, registerView, onerror } = $props();
  let bannerNode = $state(null);
  let ownerRoot = null, ownerNode = null, disposed = false, sequence = 0;
  const temporary = $derived(banner.style === 'temporary' && Number.isFinite(banner.remainingMs));
  function current(owner) {
    return !disposed && bannerNode === owner.node && bannerNode === ownerNode && bannerNode?.isConnected
      && bannerNode.closest('[data-session-scene]') === ownerRoot && ownerRoot?.isConnected
      && owner.banner === banner && owner.entry === entry && owner.bannerId === banner.bannerId && owner.notificationId === entry.id
      && bannerNode.dataset.notificationBannerId === owner.bannerId;
  }
  const lease = () => ({ node: bannerNode, banner, entry, bannerId: banner.bannerId, notificationId: entry.id });
  function mounted(node) {
    if (!current(lease()) || !node?.isConnected || !bannerNode.contains(node) || node.disabled) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.inert || parent.hasAttribute('inert')) return false;
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return true;
  }
  const bannerAvailable = () => mounted(bannerNode) && bannerNode.getClientRects().length > 0;
  function visible(node) {
    if (!mounted(node)) return false;
    const rect = node.getBoundingClientRect(), clip = bannerNode.getBoundingClientRect();
    const left = Math.max(rect.left, clip.left, 0), right = Math.min(rect.right, clip.right, globalThis.innerWidth);
    const top = Math.max(rect.top, clip.top, 0), bottom = Math.min(rect.bottom, clip.bottom, globalThis.innerHeight);
    if (right <= left || bottom <= top) return false;
    const hit = node.ownerDocument.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  const nodes = () => bannerAvailable() ? [bannerNode, ...bannerNode.querySelectorAll('[data-notification-control]')]
    .filter(node => mounted(node) && !node.disabled) : [];
  const control = id => nodes().find(node => node.dataset.notificationControl === id) ?? null;
  const valid = () => !disposed && bannerAvailable() && bannerNode === ownerNode;
  const position = () => ({ top: bannerNode?.scrollTop ?? 0, left: bannerNode?.scrollLeft ?? 0 });
  function describe() {
    const controls = nodes();
    return { controlIds: controls.map(node => node.dataset.notificationControl),
      focusedControl: controls.find(node => node.ownerDocument.activeElement === node)?.dataset.notificationControl ?? null,
      scroll: position() };
  }
  async function prepare(id, guard) {
    const owner = lease(), original = control(id);
    if (!valid() || !original || (typeof guard === 'function' && guard() !== true)) return false;
    original.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await tick();
    return current(owner) && valid() && control(id) === original && visible(original) && (!guard || guard() === true);
  }
  async function focus(id, guard) {
    const owner = lease(), original = control(id);
    if (!valid() || !original || (typeof guard === 'function' && guard() !== true)) return false;
    await tick();
    if (!current(owner) || !valid() || control(id) !== original || guard && guard() !== true) return false;
    original.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!current(owner) || !valid() || control(id) !== original || !visible(original) || guard && guard() !== true) return false;
    original.focus({ preventScroll: true });
    return current(owner) && valid() && (!guard || guard() === true) && original.ownerDocument.activeElement === original;
  }
  async function scroll(offsets, guard) {
    const owner = lease();
    if (!valid() || guard && guard() !== true || !Number.isFinite(offsets?.top) || !Number.isFinite(offsets?.left)
      || offsets.top < 0 || offsets.left < 0 || offsets.top > Number.MAX_SAFE_INTEGER || offsets.left > Number.MAX_SAFE_INTEGER) return null;
    await tick();
    if (!current(owner) || !valid() || guard && guard() !== true) return null;
    bannerNode.scrollTop = offsets.top; bannerNode.scrollLeft = offsets.left;
    return current(owner) && valid() && (!guard || guard() === true) ? position() : null;
  }
  const facade = { available: bannerAvailable, describe, prepare, focus, scroll };
  let retire = null;
  onMount(() => { ownerNode = bannerNode; ownerRoot = bannerNode.closest('[data-session-scene]'); retire = registerView?.(facade) ?? null; });
  onDestroy(() => {
    disposed = true;
    if (typeof retire === 'function') retire();
    else registerView?.(null, facade);
  });
  async function dismiss(event) {
    const node = event.currentTarget, owner = lease(), requestId = ++sequence;
    if (!mounted(node)) return;
    try {
      const result = await execute('notifications.banner.dismiss', { bannerId: banner.bannerId }, {});
      if (valid() && requestId === sequence) onerror?.(result.status === 'rejected' ? result.error.message : null);
    } catch (cause) {
      if (valid() && requestId === sequence) onerror?.(cause?.message ?? 'The banner could not be dismissed.');
    }
  }
  async function paused(value) {
    if (!temporary) return;
    try {
      const result = await execute('notifications.banner.setPaused', { bannerId: banner.bannerId }, { paused: value });
      onerror?.(result.status === 'rejected' ? result.error.message : null);
    } catch (cause) {
      onerror?.(cause?.message ?? 'The banner clock could not pause.');
    }
  }
</script>

<div class="notification-banner" bind:this={bannerNode} data-notification-banner-id={banner.bannerId}
  data-notification-control="banner" role="region"
  aria-label={`${app.name} ${banner.style === 'persistent' ? 'persistent' : 'banner'} notification`}
  data-notification-style={banner.style} data-notification-remaining={temporary ? Math.max(0, banner.remainingMs) : null}
  onpointerenter={event => { if (mounted(event.currentTarget)) void paused(true); }}
  onpointerleave={event => { if (!disposed && bannerNode?.isConnected) void paused(false); }}
  onfocusin={event => { if (bannerNode?.contains(event.target)) void paused(true); }}
  onfocusout={event => { if (!bannerNode?.contains(event.relatedTarget)) void paused(false); }}
  onerror={event => event.stopPropagation()}>
  <button class="close" data-notification-control="dismiss" aria-label={showPreview ? `Dismiss ${entry.title} banner` : `Dismiss ${app.name} notification`}
    onpointerdown={event => event.stopPropagation()} onpointerup={event => event.stopPropagation()} onclick={dismiss}>×</button>
  <GoldenGateNotificationCard {entry} {app} ownerTarget={{ bannerId: banner.bannerId }} {actions} {showPreview}
    {itemUi} {timestamp} {foreground} {execute} {onerror} />
</div>

<style>
  .notification-banner { position:relative; min-width:0; min-height:0; width:100%; max-height:inherit; overflow:auto; border-radius:22px; }
  .notification-banner :global(.notification-card) { overflow-wrap:anywhere; }
  .close { position:absolute; left:4px; top:4px; z-index:2; width:23px; height:23px; border:0; border-radius:50%; padding:0; background:var(--appearance-panel,#eee); color:inherit; box-shadow:0 0 0 1px var(--appearance-soft-border,#8883); line-height:20px; font-size:18px; cursor:default; }
  .close:focus-visible { outline:2px solid var(--appearance-focus,#0878ef); outline-offset:2px; }
</style>
