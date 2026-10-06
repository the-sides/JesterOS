<script>
  import { onMount, tick } from 'svelte';
  import { sessionMenuItems } from './fictional-session.js';
  let { profile, session, execute, registerView, menuId, foreground = true } = $props();
  let root, invoker;
  let panel = $state(null);
  const open = $derived(foreground && session?.menu?.menuId === menuId);
  const items = $derived(session ? sessionMenuItems(profile, session, menuId) : []);
  const activeName = $derived(session?.users.find(user => user.id === session.activeUserId)?.name ?? '');
  function request(command, target = {}) { return execute({ command, target, payload: {} }); }
  function available(element) {
    return Boolean(foreground && element?.isConnected && !element.disabled && !element.closest('[inert]')
      && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  }
  function buttons() { return open ? [...(panel?.querySelectorAll('[data-session-item]') ?? [])].filter(available) : []; }
  function focus(itemId) {
    const element = itemId === 'invoker' ? invoker : buttons().find(button => button.dataset.sessionItem === itemId);
    if (!available(element)) return false;
    element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'nearest' }); return document.activeElement === element;
  }
  async function toggle() {
    if (!available(invoker)) return;
    await request(open ? 'session.menu.close' : 'session.menu.open', open ? {} : { menuId });
    await tick();
    if (open && buttons().length) focus(buttons()[0].dataset.sessionItem);
  }
  async function invokerKey(event) {
    if (!available(invoker) || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault(); await request('session.menu.open', { menuId }); await tick();
    const list = buttons(); focus(list[event.key === 'ArrowUp' ? list.length - 1 : 0]?.dataset.sessionItem);
  }
  function keydown(event) {
    if (!open || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); request('session.menu.close'); return; }
    const list = buttons(), index = list.indexOf(document.activeElement);
    if (!list.length) return;
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else if (event.key === 'ArrowDown' || event.key === 'Tab' && !event.shiftKey) next = (index + 1) % list.length;
    else if (event.key === 'ArrowUp' || event.key === 'Tab' && event.shiftKey) next = (index - 1 + list.length) % list.length;
    else return;
    event.preventDefault(); event.stopPropagation(); focus(list[next]?.dataset.sessionItem);
  }
  onMount(() => {
    const unregister = registerView?.({ kind: 'menu', menuId, focus, itemIds: () => buttons().map(button => button.dataset.sessionItem), bounds: () => {
      const element = open ? panel : invoker;
      if (!available(element)) return null;
      const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } });
    function outside(event) { if (foreground && open && root?.isConnected && !root.contains(event.target)) request('session.menu.close'); }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { unregister?.(); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  });
</script>

<div class="golden-gate-session-control" class:users={menuId === 'users'} bind:this={root} data-session-control-root>
  <button class="invoker" class:apple={menuId === 'apple'} bind:this={invoker} type="button" aria-label={menuId === 'apple' ? 'Apple menu — session controls' : 'Fast user switching'} aria-haspopup="menu" aria-expanded={open} onclick={toggle} onkeydown={invokerKey}>
    {#if menuId === 'apple'}<svg viewBox="0 0 20 24" aria-hidden="true"><path fill="currentColor" d="M13.1 4.1c1-1.1 1.6-2.6 1.4-4.1-1.4.1-3 .9-4 2-1 1.1-1.7 2.6-1.5 4 1.6.1 3.1-.8 4.1-1.9ZM17 12.7c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.4-2.1-4.1-2.1-1.8-.2-3.5 1.1-4.4 1.1s-2.3-1.1-3.8-1.1C5 6.6 3 7.9 2 9.8c-2.1 3.8-.5 9.3 1.5 12.1 1 1.4 2.1 2.8 3.6 2.7 1.5-.1 2-1 3.8-1s2.3 1 3.9 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.6-3.1 1.6-3.2-.1 0-3-1.1-2.9-5.9Z"/></svg>{:else}{activeName}{/if}
  </button>
  {#if open}
    <div class="panel" bind:this={panel} role="menu" tabindex="-1" aria-label={menuId === 'apple' ? 'Apple session controls' : 'Fast user switching'} data-session-menu={menuId} onkeydown={keydown}>
      {#each items as item (item.id)}
        {#if item.separatorBefore}<div role="separator" class="separator"></div>{/if}
        <button type="button" role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={item.checked} disabled={!item.enabled} data-session-item={item.id} onfocus={() => request('session.menu.focus', { menuId, itemId: item.id })} onclick={() => request('session.menu.select', { menuId, itemId: item.id })}><span class="check">{item.checked ? '✓' : ''}</span>{item.label}{#if item.id === 'lock'}<span class="shortcut">⌃⌘Q</span>{/if}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .golden-gate-session-control { position: relative; display: flex; align-items: center; height: 100%; color: inherit; }
  .invoker { border: 0; background: transparent; color: inherit; font: inherit; padding: 0 5px; height: 100%; white-space: nowrap; border-radius: 6px; cursor: default; }
  .invoker.apple { width: 14px; margin-right: 1px; padding: 0; display: flex; align-items: center; justify-content: center; }
  .invoker svg { width: 14px; height: 18px; }
  .invoker[aria-expanded='true'] { background: #fff3; }
  .invoker:focus-visible { outline: 2px solid var(--appearance-focus, #90c6ff); outline-offset: 2px; }
  .panel { position: fixed; top: 31px; left: 8px; z-index: 12000; box-sizing: border-box; width: min(280px, calc(100vw - 16px)); max-height: calc(100svh - 39px); overflow: auto; padding: 6px; color: var(--appearance-menu-ink, #232326); background: var(--appearance-menu-bg, rgb(245 240 234 / 85%)); border: 1px solid var(--appearance-menu-border, #fff9); border-radius: 17px; box-shadow: inset 0 1px 1px #fffa, 0 0 0 1px #0002, 0 12px 30px #0004; backdrop-filter: blur(34px) saturate(1.45); font: 13px var(--golden-gate-font, sans-serif); text-shadow: none; }
  .users .panel { left: auto; right: 8px; }
  .panel button { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; min-height: 28px; border: 0; border-radius: 10px; padding: 4px 9px; color: inherit; background: transparent; font: inherit; cursor: default; }
  .panel button:focus, .panel button:hover:not(:disabled) { outline: none; background: var(--appearance-accent, #0878ef); color: var(--appearance-accent-ink, white); }
  .panel button:disabled { opacity: .4; }
  .check { width: 14px; }
  .shortcut { margin-left: auto; color: inherit; opacity: .65; }
  .separator { height: 1px; background: var(--appearance-menu-separator, #0002); margin: 5px 8px; }
</style>
