<script>
  import { tick } from 'svelte';
  import { menuBarRequest } from './menu-bar.js';
  import GoldenGateIcon from './GoldenGateIcon.svelte';

  let { menu, menus, state: menuState, level, items, geometry = null, execute, available, onLayout } = $props();
  let panel = $state(null);
  let observing = 0;
  const selection = $derived(menuState.levels[level]);
  const canonicalScroll = $derived(menuState.levels[level]?.scrollTop ?? 0);
  const parentRow = $derived(menuState.levels[level]?.parentId);
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  let searchInput = $state(null);

  function request(action, args = {}) {
    if (!mounted()) return null;
    return execute(menuBarRequest(action, menu.menuId, menus, args));
  }
  function rectOf(node) {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, left: rect.left, top: rect.top, right: rect.right,
      bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  function mounted() {
    return Boolean(menu && available?.(menu.menuId) && menuState.menuId === menu.menuId && selection && geometry
      && !geometry.covered && panel?.isConnected && !panel.closest('[inert]')
      && panel.getClientRects().length && getComputedStyle(panel).visibility === 'visible'
      && panel.clientWidth > 0 && panel.clientHeight > 0);
  }
  function controls() {
    return mounted() ? [...panel.querySelectorAll('[data-menu-item-id]')].filter(node => !node.disabled) : [];
  }
  function control(itemId) {
    return controls().find(node => node.dataset.menuItemId === itemId);
  }
  function ownsClip(node) {
    if (!mounted() || !node?.isConnected) return false;
    const rect = node.getBoundingClientRect();
    const clip = panel.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = Math.max(rect.left, clip.left + panel.clientLeft, viewport?.offsetLeft ?? 0);
    const top = Math.max(rect.top, clip.top + panel.clientTop, viewport?.offsetTop ?? 0);
    const right = Math.min(rect.right, clip.left + panel.clientLeft + panel.clientWidth,
      (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth));
    const bottom = Math.min(rect.bottom, clip.top + panel.clientTop + panel.clientHeight,
      (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight));
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  async function stable() {
    const root = panel;
    let previous = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await tick();
      await onLayout?.();
      await tick();
      if (!root?.isConnected || panel !== root || !geometry) return false;
      const rect = root.getBoundingClientRect();
      const current = [rect.left, rect.top, rect.width, rect.height, root.clientWidth, root.clientHeight];
      if (previous && current.every((value, index) => value === previous[index])) return true;
      previous = current;
      await frame();
    }
    return false;
  }
  async function suppress(write) {
    observing++;
    try { return await write(); }
    finally {
      // Native scroll events are delivered after the assignment, not during it.
      await frame();
      observing--;
    }
  }

  export function element() { return panel; }
  export function itemIds() { return controls().map(node => node.dataset.menuItemId); }
  export function focusedItem() {
    if (!mounted()) return null;
    const node = document.activeElement;
    return controls().includes(node) && ownsClip(node) ? node.dataset.menuItemId : null;
  }
  export function bounds() {
    return mounted() ? { level, popup: rectOf(panel),
      controls: controls().map(node => ({ itemId: node.dataset.menuItemId, ...rectOf(node) })) } : null;
  }
  export function scrollTop() { return mounted() ? panel.scrollTop : null; }
  export async function focus(itemId) {
    if (!await stable() || !mounted()) return false;
    const root = panel;
    const node = itemId === null ? root : control(itemId);
    if (!node || (itemId === null && controls().length)) return false;
    return suppress(async () => {
      if (node !== root) {
        const rect = node.getBoundingClientRect();
        const clip = root.getBoundingClientRect();
        const top = clip.top + root.clientTop + 6;
        const bottom = clip.top + root.clientTop + root.clientHeight - 6;
        root.scrollTop += rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
      }
      if (!await stable() || !mounted() || panel !== root || !node.isConnected
        || (itemId !== null && control(itemId) !== node)) return false;
      node.focus({ preventScroll: true });
      await tick();
      return panel === root && document.activeElement === node && ownsClip(node);
    });
  }
  export async function scroll(top) {
    if (!await stable() || !mounted() || !Number.isFinite(top) || top < 0) return null;
    const root = panel;
    return suppress(async () => {
      root.scrollTo({ top, left: 0, behavior: 'instant' });
      await tick();
      await onLayout?.();
      await tick();
      return mounted() && panel === root ? root.scrollTop : null;
    });
  }

  export function searchFocused() { return mounted() && document.activeElement === searchInput && ownsClip(searchInput); }
  export async function focusSearch() {
    if (!await stable() || !mounted() || !searchInput) return false;
    return suppress(async () => {
      panel.scrollTop = 0;
      searchInput.focus({ preventScroll: true });
      await tick();
      return searchFocused();
    });
  }
  function searchFocus() {
    if (!observing && mounted()) void execute({ command: 'menu.help.focus', target: { appId: menu.appId }, payload: { observe: true } });
  }
  function searchInputChanged(event) {
    if (mounted()) void execute({ command: 'menu.help.search', target: { appId: menu.appId }, payload: { query: event.currentTarget.value } });
  }
  async function searchKey(event) {
    event.stopPropagation();
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) return;
    event.preventDefault();
    if (!mounted()) return;
    const root = panel, menuId = menu.menuId, appId = menu.appId, query = menuState.helpSearch?.query;
    if (event.key === 'Escape' || event.key === 'Tab') { await request('navigate', { key: event.key }); return; }
    const moved = await request('navigate', { key: event.key === 'ArrowUp' ? 'End' : 'Home' });
    if (event.key === 'Enter' && moved?.status === 'applied' && mounted() && panel === root
      && menu.menuId === menuId && menu.appId === appId && menuState.helpSearch?.query === query)
      await request('navigate', { key: 'Enter' });
  }

  $effect(() => {
    const root = panel;
    const top = canonicalScroll;
    const parentId = parentRow;
    if (!root || parentId === undefined) return;
    let cancelled = false;
    suppress(async () => {
      await tick();
      if (!cancelled && root.isConnected && panel === root) root.scrollTo({ top, left: 0, behavior: 'instant' });
    });
    return () => { cancelled = true; };
  });

  function observeScroll() {
    onLayout?.();
    const top = scrollTop();
    if (!observing && top !== null && top !== selection?.scrollTop) request('scroll', { top, level, observe: true });
  }
  function select(item, observe = false) {
    if (!item.enabled || item.separator || !mounted() || (observe && observing)) return;
    if (item.helpResult) {
      if (observe && selection?.itemId === item.id) return;
      void execute({ command: 'menu.help.locate', target: { appId: menu.appId, resultId: item.id }, payload: { observe } });
      return;
    }
    if (observe) {
      if (selection?.itemId !== item.id) request('select', { itemId: item.id, observe: true });
    } else if (item.children) {
      if (menuState.levels[level + 1]?.parentId !== item.id) request('submenu', { itemId: item.id });
    } else if (selection?.itemId !== item.id || menuState.levels.length > level + 1) {
      request('select', { itemId: item.id });
    }
  }
  function pointerdown(event) {
    if (!event.target.closest('[data-help-search], [data-sound-range]')) event.preventDefault();
    event.stopPropagation();
  }
  function activate(event, item) {
    event.stopPropagation();
    event.preventDefault();
    if (event.button !== 0 || event.ctrlKey || event.metaKey || (event.altKey && !['apple', 'sound'].includes(menu.menuId)) || !item.enabled || !mounted()) return;
    request(item.children ? 'submenu' : 'execute', { itemId: item.id });
  }
  function keydown(event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || (event.altKey && !['apple', 'sound'].includes(menu.menuId))) {
      if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      event.stopPropagation();
      return;
    }
    const key = event.key === ' ' ? 'Space' : event.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Space', 'Escape', 'Tab'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (mounted()) request('navigate', { key });
  }
  function soundVolumeChanged(event, item) {
    event.stopPropagation();
    if (!mounted() || !item.enabled || item.type !== 'sound-volume') return;
    execute({ command: 'sound.volume.set', target: {}, payload: { volume: Number(event.currentTarget.value) } });
  }
  function suppressContext(event) { event.preventDefault(); event.stopPropagation(); }
</script>

{#snippet signal(strength, connected = false)}
  <svg class="network-signal" class:connected viewBox="0 0 24 20" aria-hidden="true">
    <path opacity={strength >= 3 ? 1 : .25} fill="currentColor" d="M0 4.5a20 20 0 0 1 24 0l-2.2 2.7a16.5 16.5 0 0 0-19.6 0Z"/>
    <path opacity={strength >= 2 ? 1 : .25} fill="currentColor" d="M4.2 9.6a13 13 0 0 1 15.6 0l-2.3 2.7a9.4 9.4 0 0 0-11 0Z"/>
    <path opacity={strength >= 1 ? 1 : .25} fill="currentColor" d="M8.7 14.8a5.7 5.7 0 0 1 6.6 0L12 18Z"/>
  </svg>
{/snippet}
{#snippet lock()}
  <svg class="lock-icon" viewBox="0 0 12 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3 6V4a3 3 0 0 1 6 0v2"/><rect x="1.5" y="6" width="9" height="6.5" rx="1.5"/><path d="M6 8.5v2"/></svg>
{/snippet}
<div class="menu-popup" class:wifi-popup={menu.kind === 'wifi'} class:battery-popup={menu.kind === 'battery'} class:sound-popup={menu.kind === 'sound'} class:bluetooth-popup={menu.kind === 'bluetooth'} bind:this={panel} id={`golden-menu-${menu.menuId}-${level}`}
  data-menu-popup={level} data-menu-provider={menu.menuId}
  role="menu" aria-label={level === 0 ? `${menu.label} menu` : `${menu.label} submenu`}
  aria-hidden={geometry?.covered ? 'true' : undefined} inert={geometry?.covered ?? false} tabindex="-1"
  style:left={`${geometry?.x ?? 4}px`} style:top={`${geometry?.y ?? 4}px`}
  style:max-width={`${geometry?.width ?? Math.max(1, typeof window === 'undefined' ? 312 : window.innerWidth - 8)}px`}
  style:min-width={`${Math.min(264, geometry?.width ?? 264)}px`}
  style:max-height={`${geometry?.height ?? Math.max(1, typeof window === 'undefined' ? 232 : window.innerHeight - 8)}px`}
  style:z-index={12000 + level} style:visibility={geometry ? 'visible' : 'hidden'}
  onkeydown={keydown} onpointerdown={pointerdown} oncontextmenu={suppressContext} onscroll={observeScroll}>
  {#if menu.search && level === 0}
    <div class="help-search" data-help-search>
      <input bind:this={searchInput} type="search" aria-label="Search menu commands and help" maxlength="256"
        placeholder="Search" value={menu.search.query} oninput={searchInputChanged} onfocus={searchFocus} onkeydown={searchKey} />
    </div>
  {/if}
  {#each items as item (item.id)}
    {#if item.separatorBefore}<div class="separator" role="separator"></div>{/if}
    {#if item.type === 'battery-status'}
      <div class="battery-summary" data-battery-status>
        <div class="battery-title"><strong>{item.label}</strong><strong class="battery-level">{item.percent}%</strong></div>
        <p>{item.statusLabel}{#if item.charging && item.minutesToFull !== null && (menu.chargeToFull || menu.chargeLimit === 100)}<span> · {item.minutesToFull} min until full</span>{/if}</p>
        <p class="power-source">Power Source: {item.powerSourceLabel}</p>
        {#if item.criticalBattery || item.lowBattery}<p class="low-status">{item.criticalBattery ? 'Critically Low Battery' : 'Low Battery'}</p>{/if}
      </div>
    {:else if item.type === 'battery-energy'}
      <div class="battery-energy" data-battery-energy={item.appId ?? item.id.slice(7)}>
        <span class="energy-icon"><GoldenGateIcon name={item.icon} /></span>
        <span class="energy-name">{item.name ?? item.label}</span>
      </div>
    {:else if item.type === 'sound-volume'}
      <label class="sound-volume" class:selected={selection?.itemId === item.id}>
        <span class="sound-volume-label"><span>{item.label}</span><output>{item.value}%</output></span>
        <input type="range" min={item.min} max={item.max} step="1" value={item.value} aria-label={item.label}
          data-menu-item-id={item.id} data-sound-range disabled={!item.enabled}
          tabindex={item.enabled && selection?.itemId === item.id ? 0 : -1}
          onpointerenter={() => select(item)} onfocus={() => select(item, true)}
          oninput={event => soundVolumeChanged(event, item)} />
      </label>
    {:else if item.heading}
      <div class="help-heading">{item.label}</div>
    {:else if item.separator}
      <div class="separator" role="separator"></div>
    {:else if item.type === 'wifi-network' && item.connected}
      <div class="connected-network">
        <button class="disconnect-icon" type="button" role="menuitem" aria-label={`Disconnect from ${item.name ?? item.label}`}
          data-menu-item-id={item.id} disabled={!item.enabled} tabindex={item.enabled && selection?.itemId === item.id ? 0 : -1}
          class:selected={selection?.itemId === item.id} title={`Disconnect from ${item.name ?? item.label}`}
          onpointerenter={() => select(item)} onfocus={() => select(item, true)} onclick={event => activate(event, item)}>
          {@render signal(item.strength, true)}
        </button>
        <span class="label" title={item.name ?? item.label}>{item.name ?? item.label}</span>
        {#if item.security === 'password'}<span class="network-lock" aria-label="Password protected">{@render lock()}</span>{/if}
      </div>
    {:else}
      <button type="button" role={item.type === 'wifi-disclosure' ? 'menuitem' : item.radio ? 'menuitemradio' : item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={item.type !== 'wifi-disclosure' && (item.radio || item.checked !== undefined) ? Boolean(item.checked) : undefined}
        aria-label={item.type === 'bluetooth-device' ? `${item.connected ? 'Disconnect' : 'Connect'} ${item.name ?? item.label}` : undefined}
        aria-disabled={!item.enabled || item.helpResult?.enabled === false} aria-haspopup={item.children ? 'menu' : undefined}
        aria-expanded={item.type === 'wifi-disclosure' ? Boolean(item.checked) : item.children ? menuState.levels[level + 1]?.parentId === item.id : undefined}
        data-menu-item-id={item.id} disabled={!item.enabled} tabindex={item.enabled && selection?.itemId === item.id ? 0 : -1}
        class:selected={selection?.itemId === item.id} class:command-unavailable={item.helpResult?.enabled === false}
        class:wifi-power={item.type === 'wifi-power'} class:wifi-network={item.type === 'wifi-network'}
        class:battery-mode={item.type === 'battery-mode'} class:bluetooth-power={item.type === 'bluetooth-power'} class:wifi-disclosure={item.type === 'wifi-disclosure'} title={item.label}
        onpointerenter={() => select(item)} onfocus={() => select(item, true)} onclick={event => activate(event, item)}>
        {#if item.type === 'wifi-power' || item.type === 'battery-mode' || item.type === 'bluetooth-power'}
          <span class="power-label">{item.label}</span><span class="wifi-switch" class:on={item.checked} aria-hidden="true"><i></i></span>
        {:else if item.type === 'wifi-network'}
          {@render signal(item.strength)}<span class="label">{item.name ?? item.label}</span>
          <span class="network-lock" aria-hidden="true">{#if item.security === 'password'}{@render lock()}{/if}</span>
        {:else if item.type === 'wifi-disclosure'}
          <span class="power-label">{item.label}</span><span class="disclosure-arrow" aria-hidden="true">{item.checked ? '⌄' : '›'}</span>
        {:else}
          <span class="check" aria-hidden="true">{item.checked ? item.radio ? '●' : '✓' : ''}</span>
          <span class="label">{item.label}</span>
          <span class="shortcut">{item.type === 'bluetooth-device' ? !item.enabled ? 'Unavailable' : item.batteryPercent === null ? '' : `${item.batteryPercent}%` : item.shortcut ?? ''}</span>
          <span class="arrow" aria-hidden="true">{item.children ? '›' : ''}</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu-popup { position: fixed; box-sizing: border-box; width: max-content; min-height: 28px; max-width: calc(100vw - 8px); max-height: calc(100svh - 8px); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 6px; border: 1px solid var(--appearance-menu-border, #fff9); border-radius: 17px; color: var(--appearance-menu-ink, #232326); background: var(--appearance-menu-bg, rgb(245 240 234 / 85%)); box-shadow: inset 0 1px 1px #fffa, 0 0 0 1px #0002, 0 12px 30px #0004; backdrop-filter: blur(34px) saturate(1.45); font: 13px/20px var(--golden-gate-font, sans-serif); text-shadow: none; user-select: none; outline: none; }
  button { display: grid; grid-template-columns: 14px minmax(0, 1fr) minmax(0, auto) 10px; align-items: center; box-sizing: border-box; width: 100%; min-width: 0; min-height: 28px; gap: 6px; padding: 4px 9px; border: 0; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; white-space: nowrap; cursor: default; outline: none; }
  button.selected:not(:disabled) { background: var(--appearance-accent, #0878ef); color: var(--appearance-accent-ink, white); }
  button:disabled { color: var(--appearance-menu-disabled, #8f8b87); }
  .check { width: 14px; text-align: center; font-size: 12px; }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .shortcut { min-width: 0; max-width: 110px; overflow: hidden; text-overflow: ellipsis; text-align: right; font-size: 11px; opacity: .65; }
  .arrow { width: 10px; font-size: 21px; line-height: 20px; text-align: right; }
  .separator { height: 1px; margin: 5px 8px; background: var(--appearance-menu-separator, #0002); }
  .menu-popup[inert] { pointer-events: none; }
  .help-search { position:sticky; top:-6px; z-index:1; padding:5px 2px 7px; background:var(--appearance-menu-bg,#f4f0ea); }
  .help-search input { box-sizing:border-box; width:100%; min-width:0; padding:6px 9px; border:1px solid var(--appearance-menu-border,#9995); border-radius:9px; color:inherit; background:var(--appearance-window-surface,#fff9); font:inherit; }
  .help-heading { padding:4px 8px; font-size:11px; line-height:16px; opacity:.7; white-space:normal; }
  button.command-unavailable { color:var(--appearance-menu-disabled,#8f8b87); }
  .wifi-popup { width:300px; padding:8px; }
  .wifi-popup .help-heading { font-weight:600; padding-top:8px; }
  button.wifi-power, button.wifi-disclosure { grid-template-columns:minmax(0,1fr) auto; min-height:34px; }
  .wifi-power { font-weight:650; font-size:14px; }
  .power-label { min-width:0; overflow:hidden; text-overflow:ellipsis; }
  .wifi-switch { width:30px; height:18px; border-radius:12px; padding:2px; box-sizing:border-box; background:var(--appearance-menu-disabled,#979797); }
  .wifi-switch i { display:block; width:14px; height:14px; border-radius:50%; background:white; box-shadow:0 1px 3px #0003; }
  .wifi-switch.on { background:var(--appearance-accent,#0878ef); }
  .wifi-switch.on i { transform:translateX(12px); }
  .selected .wifi-switch.on { box-shadow:0 0 0 1px #fff8; }
  .network-signal { width:20px; height:18px; flex-shrink:0; }
  button.wifi-network { grid-template-columns:24px minmax(0,1fr) 14px; min-height:32px; }
  .network-lock { font-size:12px; opacity:.65; text-align:center; }
  .lock-icon { display:block; width:11px; height:13px; }
  .connected-network { display:flex; align-items:center; gap:6px; padding:2px 9px; min-height:30px; }
  .connected-network .label { flex:1; }
  button.disconnect-icon { display:flex; justify-content:center; width:28px; height:28px; min-height:28px; padding:4px; flex-shrink:0; }
  .connected { color:var(--appearance-accent,#0878ef); }
  .selected .connected { color:inherit; }
  .disclosure-arrow { font-size:20px; line-height:18px; }
  .battery-popup { width:300px; padding:8px; }
  .battery-summary { padding:6px 9px 9px; }
  .battery-title { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:14px; }
  .battery-level { font-variant-numeric:tabular-nums; }
  .battery-summary p { margin:3px 0 0; font-size:11px; line-height:16px; overflow-wrap:anywhere; }
  .power-source { opacity:.7; }
  .low-status { color:#c83e3b; font-weight:600; }
  button.battery-mode { grid-template-columns:minmax(0,1fr) auto; min-height:34px; }
  .battery-popup .help-heading { padding-top:8px; font-weight:600; }
  .battery-energy { display:flex; align-items:center; gap:8px; padding:4px 9px; min-width:0; }
  .energy-icon { width:22px; height:22px; flex-shrink:0; }
  .energy-icon :global(svg) { width:100%; height:100%; display:block; }
  .energy-name { min-width:0; overflow-wrap:anywhere; white-space:normal; font-size:12px; line-height:17px; }
  .sound-popup { width:300px; padding:8px; }
  .sound-popup .help-heading { padding-top:8px; font-weight:650; }
  .bluetooth-popup { width:300px; padding:8px; }
  .bluetooth-popup .help-heading { padding-top:8px; font-weight:650; }
  button.bluetooth-power { grid-template-columns:minmax(0,1fr) auto; min-height:34px; font-size:14px; font-weight:650; }
  .sound-volume { display:block; padding:5px 9px 8px; border-radius:10px; }
  .sound-volume-label { display:flex; justify-content:space-between; gap:8px; font-size:12px; }
  .sound-volume-label output { font-variant-numeric:tabular-nums; opacity:.7; }
  .sound-volume input { display:block; width:100%; margin:8px 0 2px; accent-color:var(--appearance-accent,#0878ef); }
  .sound-volume.selected { outline:1px solid var(--appearance-accent,#0878ef); outline-offset:-1px; }
</style>
