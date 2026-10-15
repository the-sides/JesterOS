<script>
  import { onMount, tick, untrack } from 'svelte';
  import { menuBarRequest } from './menu-bar.js';
  import GoldenGateMenuPopup from './GoldenGateMenuPopup.svelte';
  import GoldenGateHelpLocation from './GoldenGateHelpLocation.svelte';
  import { helpMenuLocation } from './help-menu-model.js';

  let { profile, menus, state: menuState, execute, registerView, foreground = true, zone = 'primary',
    notificationCenterId = null, notificationCenterAvailable = false, onnotifications } = $props();
  let root = $state(null);
  let invokers = $state({});
  let popups = $state([]);
  let geometry = $state([]);
  let nativeWrites = 0;
  let locationView = $state(null), locationGeometry = $state(null);
  let clockWithDateMeter = $state(null);
  let clockDateAllowed = $state(false);
  const location = $derived(helpMenuLocation(menus, menuState));
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const rendered = $derived(menus.filter(menu => zone === 'users' ? menu.kind === 'users' : zone === 'wifi' ? menu.kind === 'wifi' : zone === 'battery' ? menu.kind === 'battery' && menu.showInMenuBar : zone === 'sound' ? menu.kind === 'sound' && menu.showInMenuBar : zone === 'bluetooth' ? menu.kind === 'bluetooth' && menu.showInMenuBar : zone === 'input' ? menu.kind === 'input' && menu.showInMenuBar : zone === 'clock' ? menu.kind === 'clock' : !['users', 'wifi', 'battery', 'clock', 'sound', 'bluetooth', 'input'].includes(menu.kind)));
  const openMenu = $derived(foreground ? rendered.find(menu => menu.menuId === menuState.menuId) : undefined);
  const clockMenu = $derived(rendered.find(menu => menu.kind === 'clock'));
  const clockDateShown = $derived(clockMenu?.showDate === 'always' || clockMenu?.showDate === 'when-space-allows' && clockDateAllowed);
  const panes = $derived.by(() => {
    if (!openMenu) return [];
    const result = [];
    let items = openMenu.items;
    for (let level = 0; level < menuState.levels.length; level++) {
      if (level > 0) {
        const parent = items.find(item => item.id === menuState.levels[level].parentId && item.enabled && item.children);
        if (!parent) break;
        items = parent.children;
      }
      result.push({ level, parentId: menuState.levels[level].parentId, items });
    }
    return result;
  });

  function request(action, menuId, args = {}) {
    return execute(menuBarRequest(action, menuId, menus, args));
  }
  function rectOf(node) {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, left: rect.left, top: rect.top, right: rect.right,
      bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  function visible(node) {
    if (!foreground || !node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(node).visibility !== 'visible') return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).opacity === '0') return false;
    }
    return true;
  }
  function clipOf(node, margin = 0) {
    const viewport = window.visualViewport;
    let left = viewport?.offsetLeft ?? 0;
    let top = viewport?.offsetTop ?? 0;
    let right = left + (viewport?.width ?? document.documentElement.clientWidth);
    let bottom = top + (viewport?.height ?? document.documentElement.clientHeight);
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const rect = parent.getBoundingClientRect();
      if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
        left = Math.max(left, rect.left + parent.clientLeft);
        right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
        top = Math.max(top, rect.top + parent.clientTop);
        bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
      }
    }
    const insetX = Math.min(margin, Math.max(0, (right - left - 1) / 2));
    const insetY = Math.min(margin, Math.max(0, (bottom - top - 1) / 2));
    return { left: left + insetX, top: top + insetY, right: right - insetX, bottom: bottom - insetY };
  }
  function ownsClip(node) {
    if (!visible(node)) return false;
    const rect = node.getBoundingClientRect();
    const clip = clipOf(node);
    const left = Math.max(rect.left, clip.left), right = Math.min(rect.right, clip.right);
    const top = Math.max(rect.top, clip.top), bottom = Math.min(rect.bottom, clip.bottom);
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  export function available(menuId) {
    const menu = rendered.find(menu => menu.menuId === menuId);
    const node = invokers[menuId];
    if (!menu?.enabled || !visible(node)) return false;
    if (['battery', 'clock', 'sound', 'input'].includes(menu.kind) && !ownsClip(node)) return false;
    const rect = node.getBoundingClientRect(), clip = clipOf(node);
    return rect.right > clip.left && rect.left < clip.right && rect.bottom > clip.top && rect.top < clip.bottom;
  }
  function popupFor(menuId, level) {
    if (menuState.menuId !== menuId || !available(menuId) || !Number.isInteger(level) || !panes[level]) return null;
    const popup = popups[level];
    const node = popup?.element();
    return node?.dataset.menuProvider === menuId && Number(node.dataset.menuPopup) === level ? popup : null;
  }
  async function writing(apply) {
    nativeWrites++;
    try { return await apply(); }
    finally { await frame(); nativeWrites--; }
  }
  export async function focusInvoker(menuId) {
    return writing(async () => {
      await tick(); await frame();
      if (!available(menuId)) return false;
      const node = invokers[menuId];
      node.focus({ preventScroll: true });
      await tick();
      return available(menuId) && invokers[menuId] === node && document.activeElement === node && ownsClip(node);
    });
  }
  export async function focus(menuId, level, itemId) {
    return writing(async () => {
      await tick(); measure(); await tick();
      const popup = popupFor(menuId, level);
      return popup ? popup.focus(itemId) : false;
    });
  }
  export function itemIds(menuId, level) { return popupFor(menuId, level)?.itemIds() ?? []; }
  export function focusedItem(menuId, level) { return popupFor(menuId, level)?.focusedItem() ?? null; }
  export function bounds(menuId) {
    if (!available(menuId)) return null;
    return { invoker: rectOf(invokers[menuId]), popups: menuState.menuId === menuId
      ? panes.map(pane => popupFor(menuId, pane.level)?.bounds()).filter(Boolean) : [] };
  }
  export async function scroll(menuId, level, top) {
    return writing(async () => {
      await tick(); measure(); await tick();
      const popup = popupFor(menuId, level);
      return popup ? popup.scroll(top) : null;
    });
  }
  export function scrollTop(menuId, level) { return popupFor(menuId, level)?.scrollTop() ?? null; }
  export function searchFocused() { return popupFor('help', 0)?.searchFocused() ?? false; }
  export async function focusSearch() {
    return writing(async () => { await tick(); measure(); await tick(); return await popupFor('help', 0)?.focusSearch() === true; });
  }
  export function locationBounds() { return locationView?.bounds() ?? null; }
  export async function prepareLocation(resultId) {
    return writing(async () => { await tick(); measure(); await tick(); return await locationView?.prepare(resultId) === true; });
  }

  function measure() {
    if (!root?.isConnected || !openMenu || !available(openMenu.menuId)) {
      if (geometry.length) geometry = [];
      return;
    }
    const anchor = invokers[openMenu.menuId];
    const next = [];
    const rectangles = [];
    let rootAbove = false;
    for (const pane of panes) {
      const node = popups[pane.level]?.element();
      if (!node?.isConnected) break;
      const clip = clipOf(node, 4);
      if (pane.level > 0) {
        const source = anchor.getBoundingClientRect();
        // Keep dense children off the headings so cross-provider hover remains reachable.
        if (rootAbove) clip.bottom = Math.min(clip.bottom, source.top - 2);
        else clip.top = Math.max(clip.top, source.bottom + 2);
      }
      const split = location && pane.level === 0 && clip.right - clip.left < 540;
      const width = Math.max(1, Math.min(264, split ? (clip.right - clip.left - 6) / 2 : clip.right - clip.left));
      let height = Math.max(1, clip.bottom - clip.top);
      const invokerRect = pane.level === 0 ? anchor.getBoundingClientRect() : null;
      let above = false;
      if (invokerRect) {
        const belowHeight = Math.max(1, clip.bottom - invokerRect.bottom - 2);
        const aboveHeight = Math.max(1, invokerRect.top - clip.top - 2);
        above = belowHeight < 28 && aboveHeight > belowHeight;
        rootAbove = above;
        height = Math.min(height, above ? aboveHeight : belowHeight);
      }
      node.style.maxWidth = `${width}px`;
      node.style.minWidth = `${Math.min(264, width)}px`;
      node.style.maxHeight = `${height}px`;
      const size = node.getBoundingClientRect();
      let x, y;
      if (pane.level === 0) {
        x = openMenu.kind === 'users' ? invokerRect.right - size.width : invokerRect.left;
        if (location && clip.right - clip.left < 540) x = clip.left;
        y = above ? invokerRect.top - size.height - 2 : invokerRect.bottom + 2;
      } else {
        const parent = rectangles[pane.level - 1];
        const parentNode = popups[pane.level - 1]?.element();
        const row = [...(parentNode?.querySelectorAll('[data-menu-item-id]') ?? [])]
          .find(node => node.dataset.menuItemId === pane.parentId);
        if (!parent || !row) break;
        const source = row.getBoundingClientRect();
        const rightX = parent.right + 2;
        const leftX = parent.left - size.width - 2;
        x = rightX + size.width <= clip.right ? rightX : leftX >= clip.left ? leftX : parent.left + 24;
        y = source.top - 7;
      }
      x = Math.max(clip.left, Math.min(x, clip.right - size.width));
      y = Math.max(clip.top, Math.min(y, clip.bottom - size.height));
      // Write the actual native position before measuring the next child's row.
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      rectangles.push({ left: x, top: y, right: x + size.width, bottom: y + size.height });
      next.push({ x, y, width, height, covered: false });
    }
    for (let parent = 0; parent < rectangles.length; parent++) {
      for (let child = parent + 1; child < rectangles.length; child++) {
        const a = rectangles[parent], b = rectangles[child];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) next[parent].covered = true;
      }
    }
    if (next.length !== geometry.length || next.some((rect, index) =>
      Object.keys(rect).some(key => rect[key] !== geometry[index]?.[key]))) geometry = next;
    if (location && rectangles[0]) {
      const main = rectangles[0], clip = clipOf(popups[0].element(), 4);
      const width = Math.max(1, Math.min(264, clip.right - clip.left - (main.right - main.left) - 6));
      const x = main.left - width - 6 >= clip.left ? main.left - width - 6 : main.right + 6;
      const nextLocation = { x, y: main.top, width, height: Math.max(1, clip.bottom - main.top) };
      if (!locationGeometry || Object.keys(nextLocation).some(key => nextLocation[key] !== locationGeometry[key])) locationGeometry = nextLocation;
    } else if (locationGeometry) locationGeometry = null;
  }

  $effect(() => {
    const menuIds = rendered.map(menu => menu.menuId);
    if (!root || !registerView) return;
    const unregister = registerView({ kind: 'menu-bar', menuIds, available, focusInvoker, focus,
      itemIds, focusedItem, bounds, scroll, scrollTop, focusSearch, searchFocused, prepareLocation, locationBounds });
    return () => unregister?.();
  });
  $effect(() => {
    const nodes = panes.map(pane => popups[pane.level]?.element()).filter(Boolean);
    const anchor = openMenu ? invokers[openMenu.menuId] : null;
    panes.map(pane => pane.items.map(item => `${item.id}:${item.label}:${item.shortcut ?? ''}`).join('|')).join(';');
    location?.resultId;
    if (!nodes.length || !anchor) { untrack(measure); return; }
    let cancelled = false, scheduled = 0;
    function update() {
      if (!cancelled && !scheduled) scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        if (!cancelled) measure();
      });
    }
    const ancestors = new Set();
    for (const node of [...nodes, anchor]) {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.add(parent);
    }
    const observer = new ResizeObserver(update);
    for (const node of [...nodes, anchor, ...ancestors]) observer.observe(node);
    tick().then(() => { if (!cancelled) measure(); });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      cancelled = true;
      if (scheduled) cancelAnimationFrame(scheduled);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  });

  function invokerPointer(event) {
    // Opening must capture the editor, not the heading's default pointer focus.
    event.preventDefault();
    event.stopPropagation();
  }
  async function openInvoker(menu, args = {}, altKey = false) {
    if (menu.menuId === 'sound') {
      const result = await execute({ command: 'sound.menu.inputs.set', target: {}, payload: { expanded: altKey } });
      if (result.status !== 'applied' || !available(menu.menuId)) return result;
    }
    return request('open', menu.menuId, args);
  }
  function toggle(event, menu) {
    event.preventDefault(); event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey || event.metaKey
      || event.altKey && !['apple', 'sound'].includes(menu.menuId) && !(menu.kind === 'clock' && onnotifications)
      || !available(menu.menuId)) return;
    if (menu.kind === 'clock' && onnotifications) {
      if (notificationCenterAvailable) onnotifications(event);
      return;
    }
    if (menuState.menuId === menu.menuId) request('close', menu.menuId);
    else void openInvoker(menu, {}, event.altKey);
  }
  function hover(event, menu) {
    if (menu.kind === 'clock' && onnotifications) return;
    if (menuState.menuId && menuState.menuId !== menu.menuId && available(menu.menuId)) void openInvoker(menu, {}, event.altKey);
  }
  function invokerKey(event, menu) {
    if (event.isComposing || event.ctrlKey || event.metaKey || (event.altKey && !['apple', 'sound'].includes(menu.menuId))) {
      if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!available(menu.menuId)) return;
    if (menu.kind === 'clock' && onnotifications && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && notificationCenterAvailable) onnotifications(event);
      return;
    }
    const key = event.key === ' ' ? 'Space' : event.key;
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'Escape', 'Tab'].includes(key)) return;
    if ((key === 'Escape' || key === 'Tab') && !menuState.menuId) return;
    event.preventDefault(); event.stopPropagation();
    if (key === 'ArrowLeft' || key === 'ArrowRight') request('navigate', menu.menuId, { key });
    else if (key === 'Escape' || key === 'Tab') request('navigate', menuState.menuId, { key });
    else void openInvoker(menu, { position: key === 'ArrowUp' ? 'last' : 'first' }, event.altKey);
  }
  function suppressContext(event) { event.preventDefault(); event.stopPropagation(); }
  function measureClockSpace() {
    if (zone !== 'clock' || !root?.isConnected || !clockMenu || !clockWithDateMeter?.isConnected) return;
    const header = root.closest('.golden-gate-menu-bar'), status = root.closest('.golden-gate-status-items');
    const primary = header?.querySelector('[data-menu-bar="primary"]'), headings = primary?.parentElement;
    const invoker = invokers.clock;
    if (!header || !status || !primary || !headings || !invoker) return;
    const numeric = value => Number.parseFloat(value) || 0;
    const primaryStyle = getComputedStyle(primary), headerStyle = getComputedStyle(header), headingStyle = getComputedStyle(headings);
    const buttons = [...primary.querySelectorAll('[data-menu-invoker]')];
    const primaryWidth = buttons.reduce((width, node) => {
      const style = getComputedStyle(node), label = node.querySelector('.invoker-label');
      const padding = numeric(style.paddingLeft) + numeric(style.paddingRight);
      const content = label ? Math.min(label.scrollWidth, numeric(style.maxWidth) - padding || label.scrollWidth) : node.getBoundingClientRect().width - padding;
      return width + content + padding + numeric(style.marginLeft) + numeric(style.marginRight);
    }, Math.max(0, buttons.length - 1) * numeric(primaryStyle.columnGap));
    const padding = numeric(headerStyle.paddingLeft) + numeric(headerStyle.paddingRight);
    const otherStatusWidth = status.getBoundingClientRect().width - invoker.getBoundingClientRect().width;
    const fullClockWidth = clockWithDateMeter.getBoundingClientRect().width;
    clockDateAllowed = primaryWidth + numeric(headingStyle.marginRight) + numeric(headerStyle.columnGap)
      + otherStatusWidth + fullClockWidth + padding <= header.getBoundingClientRect().width;
  }
  $effect(() => {
    clockMenu; foreground;
    if (zone === 'clock') void tick().then(measureClockSpace);
  });
  onMount(() => {
    if (zone !== 'clock') return;
    const header = root?.closest('.golden-gate-menu-bar');
    if (!header) return;
    let scheduled = null;
    const observer = new ResizeObserver(() => {
      if (scheduled === null) scheduled = requestAnimationFrame(() => { scheduled = null; measureClockSpace(); });
    });
    observer.observe(header);
    for (const node of [header.querySelector('[data-menu-bar="primary"]'), root.parentElement]) if (node) observer.observe(node);
    measureClockSpace();
    return () => { observer.disconnect(); if (scheduled !== null) cancelAnimationFrame(scheduled); };
  });
  onMount(() => {
    function outside(event) {
      if (!openMenu || nativeWrites || !root?.isConnected) return;
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest('[data-menu-bar], [data-menu-popup]')) return;
      request('close', openMenu.menuId, { restoreFocus: false });
    }
    function pendingEscape(event) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing
        || event.metaKey || event.ctrlKey || event.altKey || !openMenu || !available(openMenu.menuId)) return;
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest('[data-menu-bar], [data-menu-popup]')) return;
      // Popup focus settles asynchronously. A visible menu still owns Escape
      // while its original editor holds DOM focus; queue behind its open.
      event.preventDefault(); event.stopImmediatePropagation();
      request('navigate', openMenu.menuId, { key: 'Escape' });
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('keydown', pendingEscape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('keydown', pendingEscape, true);
    };
  });
</script>

{#snippet clockContents(menu, withDate)}
  <span class="clock-label">{withDate ? menu.menuWithDate : menu.menuWithoutDate}</span>
  {#if menu.style === 'analog'}
    <svg class="analog-clock" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.6" fill="#fffffff0" stroke="#555" stroke-width=".8" />
      <path d="M10 2v1m7 7h1m-8 7v1M2 10h1" stroke="#555" stroke-width=".7" />
      <path d="M10 10V5.6" transform={`rotate(${menu.hourAngle} 10 10)`} stroke="#333" stroke-width="1.5" stroke-linecap="round" data-clock-hand="hour" />
      <path d="M10 10V3.3" transform={`rotate(${menu.minuteAngle} 10 10)`} stroke="#333" stroke-width="1" stroke-linecap="round" data-clock-hand="minute" />
      <circle cx="10" cy="10" r="1" fill="#333" />
    </svg>
  {/if}
{/snippet}

<div class="golden-shared-menu-bar" class:users={zone === 'users'} class:clock={zone === 'clock'} bind:this={root} data-menu-bar={zone}
  role="menubar" aria-label={zone === 'users' ? 'User menu' : zone === 'wifi' ? 'Wi-Fi status menu' : zone === 'battery' ? 'Battery status menu' : zone === 'sound' ? 'Sound status menu' : zone === 'bluetooth' ? 'Bluetooth status menu' : zone === 'input' ? 'Fictional Input source menu' : zone === 'clock' ? 'Clock and Notification Center' : 'Application menu bar'}>
  {#each rendered as menu (menu.menuId)}
    <button class="invoker" class:apple={menu.kind === 'apple'} class:application={menu.kind === 'application'} class:wifi={menu.kind === 'wifi'} class:battery={menu.kind === 'battery'} class:sound={menu.kind === 'sound'} class:bluetooth={menu.kind === 'bluetooth'} class:input={menu.kind === 'input'} class:clock={menu.kind === 'clock'}
      bind:this={invokers[menu.menuId]} type="button" role="menuitem" data-menu-invoker={menu.menuId} data-date-shown={menu.kind === 'clock' ? clockDateShown : undefined}
      data-notification-invoker={menu.kind === 'clock' && onnotifications ? true : undefined}
      disabled={!menu.enabled || !foreground} aria-disabled={!menu.enabled || !foreground}
      class:located={location?.menuId === menu.menuId}
      aria-label={menu.kind === 'apple' ? 'Apple menu' : menu.kind === 'users' ? `Fast user switching — ${menu.label}` : menu.kind === 'wifi' ? menu.status === 'off' ? 'Wi-Fi off' : menu.status === 'connected' ? `Wi-Fi connected — ${menu.connectedName}` : 'Wi-Fi not connected' : menu.kind === 'battery' ? `Battery: ${menu.percent} percent, ${menu.statusLabel}${menu.criticalBattery ? ', Critically Low Battery' : menu.lowBattery ? ', Low Battery' : ''}` : menu.kind === 'sound' ? `Sound: ${menu.effectiveMuted ? 'muted' : `${menu.volume} percent`}, ${menu.outputName}` : menu.kind === 'bluetooth' ? `Bluetooth ${menu.powered ? 'on' : 'off'}${menu.connectedCount ? `, ${menu.connectedCount} connected` : ''}` : menu.kind === 'input' ? `Input source: ${menu.label} — fictional onscreen layouts` : menu.kind === 'clock' ? `${onnotifications ? 'Notification Center' : 'Clock'}: ${menu.fullDate}, ${menu.fullTime}, ${menu.timeZone} — fictional scene clock` : menu.label}
      aria-haspopup={menu.kind === 'clock' && onnotifications && !openMenu ? 'dialog' : 'menu'}
      aria-expanded={Boolean(openMenu?.menuId === menu.menuId || menu.kind === 'clock' && notificationCenterId)}
      aria-controls={menu.kind === 'clock' && notificationCenterId && !openMenu ? `notification-center-${notificationCenterId}` : `golden-menu-${menu.menuId}-0`}
      onpointerdown={invokerPointer} onpointerenter={event => hover(event, menu)} onclick={event => toggle(event, menu)}
      onkeydown={event => invokerKey(event, menu)} oncontextmenu={event => { suppressContext(event); if (menu.kind === 'clock' && available(menu.menuId)) request('open', menu.menuId); }}>
      {#if menu.kind === 'apple'}
        <svg viewBox="0 0 20 24" aria-hidden="true"><path fill="currentColor" d="M13.1 4.1c1-1.1 1.6-2.6 1.4-4.1-1.4.1-3 .9-4 2-1 1.1-1.7 2.6-1.5 4 1.6.1 3.1-.8 4.1-1.9ZM17 12.7c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.4-2.1-4.1-2.1-1.8-.2-3.5 1.1-4.4 1.1s-2.3-1.1-3.8-1.1C5 6.6 3 7.9 2 9.8c-2.1 3.8-.5 9.3 1.5 12.1 1 1.4 2.1 2.8 3.6 2.7 1.5-.1 2-1 3.8-1s2.3 1 3.9 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.6-3.1 1.6-3.2-.1 0-3-1.1-2.9-5.9Z"/></svg>
      {:else if menu.kind === 'wifi'}
        <svg class="wifi-signal" viewBox="0 0 24 20" aria-hidden="true">
          <path opacity={menu.status === 'connected' && menu.strength >= 3 ? 1 : .3} fill="currentColor" d="M0 4.5a20 20 0 0 1 24 0l-2.2 2.7a16.5 16.5 0 0 0-19.6 0Z"/>
          <path opacity={menu.status === 'connected' && menu.strength >= 2 ? 1 : .3} fill="currentColor" d="M4.2 9.6a13 13 0 0 1 15.6 0l-2.3 2.7a9.4 9.4 0 0 0-11 0Z"/>
          <path opacity={menu.status === 'connected' ? 1 : .3} fill="currentColor" d="M8.7 14.8a5.7 5.7 0 0 1 6.6 0L12 18Z"/>
          {#if menu.status === 'off'}<path d="m3 1 18 18" stroke="currentColor" stroke-width="2" />{/if}
        </svg>
      {:else if menu.kind === 'sound'}
        <svg viewBox="0 0 24 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7h4l5-4v14l-5-4H3Z" fill="currentColor" stroke-width=".8" />
          {#if menu.effectiveMuted}
            <path d="m16 7 5 6m0-6-5 6" />
          {:else}
            {#if menu.volume > 0}<path d="M15 6a6 6 0 0 1 0 8" />{/if}
            {#if menu.volume > 50}<path d="M18 3a10 10 0 0 1 0 14" />{/if}
          {/if}
        </svg>
      {:else if menu.kind === 'bluetooth'}
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path opacity={menu.powered ? 1 : .5} d="m6 7 12 10-6 5V2l6 5L6 17" />
          {#if !menu.powered}<path d="m4 3 16 18" />{/if}
        </svg>
      {:else if menu.kind === 'input'}
        <svg viewBox="0 0 24 20" aria-hidden="true">
          <rect x="2" y="2" width="20" height="16" rx="3" fill="currentColor" opacity=".18" />
          <text x="12" y="14" text-anchor="middle" fill="currentColor" font-size="10" font-weight="650">{menu.symbol}</text>
        </svg>
      {:else if menu.kind === 'clock'}
        {@render clockContents(menu, clockDateShown)}
        <span class="clock-meter" aria-hidden="true" bind:this={clockWithDateMeter}>{@render clockContents(menu, true)}</span>
      {:else if menu.kind === 'battery'}
        {#if menu.showPercentage}<span class="battery-percentage">{menu.percent}%</span>{/if}
        <svg class="battery-symbol" class:low={menu.lowBattery} viewBox="0 0 32 16" aria-hidden="true">
          <rect x="1" y="3" width="26" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3" />
          <rect x="3" y="5" width={22 * menu.percent / 100} height="6" rx="1" fill="currentColor" />
          <path d="M29 6v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          {#if menu.charging}
            <path class="power-mark" d="m16 1-5 8h4l-1 6 7-9h-5l2-5Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
          {:else if menu.powerSource === 'adapter'}
            <path class="power-mark" d="M12 3v4m6-4v4m-7 0h8v2a4 4 0 0 1-8 0Zm4 6v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          {/if}
        </svg>
      {:else}
        <span class="invoker-label">{menu.label}</span>
      {/if}
    </button>
  {/each}
  {#each panes as pane (`${openMenu.menuId}:${pane.level}:${pane.parentId ?? 'root'}`)}
    <GoldenGateMenuPopup bind:this={popups[pane.level]} menu={openMenu} {menus} state={menuState} level={pane.level}
      items={pane.items} geometry={geometry[pane.level] ?? null} {execute} {available} onLayout={measure} />
  {/each}
  {#if location && zone === 'primary'}
    <GoldenGateHelpLocation bind:this={locationView} {location} geometry={locationGeometry} />
  {/if}
</div>

<style>
  .golden-shared-menu-bar { display: inline-flex; align-items: center; height: 100%; min-width: 0; max-width: 100%; gap: 20px; color: inherit; }
  .invoker { display: flex; align-items: center; min-width: 0; max-width: 180px; height: 100%; margin: 0 -5px; padding: 0 5px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; white-space: nowrap; cursor: default; }
  .invoker.application { font-weight: 650; }
  .invoker.apple { flex: 0 0 14px; width: 14px; margin: 0 1px 0 0; padding: 0; justify-content: center; }
  .invoker svg { width: 14px; height: 18px; }
  .invoker.wifi { justify-content:center; width:24px; flex:0 0 24px; max-width:24px; margin:0; padding:0; }
  .invoker .wifi-signal { width:22px; height:18px; }
  .invoker.input { justify-content:center; flex:0 0 24px; width:24px; max-width:24px; margin:0; padding:0; }
  .invoker.input svg { width:24px; height:20px; }
  .invoker-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .invoker[aria-expanded='true'] { background: #fff3; box-shadow: inset 0 0 0 1px #fff2; }
  .invoker:focus-visible { outline: 2px solid var(--appearance-focus, #90c6ff); outline-offset: -2px; }
  .invoker.located { box-shadow:inset 0 -2px var(--appearance-accent,#0878ef); }
  .invoker:disabled { opacity: .4; }
  .users .invoker { max-width: min(150px, 24vw); }
  @media (max-width: 900px) { .golden-shared-menu-bar { gap: 13px; } }
  @media (max-width: 520px) { .invoker.application { max-width: 105px; } }
  @media (max-width: 520px) { .golden-shared-menu-bar { gap: 6px; } .invoker { margin: 0; padding: 0 1px; } }
  .invoker.wifi { flex-shrink: 0; }
  .invoker.battery { flex:0 0 auto; max-width:none; margin:0; padding:0; gap:4px; }
  .invoker .battery-symbol { width:30px; height:16px; color:white; }
  .battery-symbol.low { color:#ff5b59; }
  .power-mark { fill:#637153; paint-order:stroke; }
  .battery-percentage { font-size:11px; font-variant-numeric:tabular-nums; }
  .invoker.clock { position:relative; flex:0 0 auto; max-width:none; margin:0; padding:0; gap:5px; font-variant-numeric:tabular-nums; }
  .clock-label:empty { display:none; }
  .invoker .analog-clock { width:18px; height:18px; flex:0 0 18px; }
  .clock-meter { position:absolute; visibility:hidden; pointer-events:none; display:inline-flex; align-items:center; gap:5px; width:max-content; white-space:nowrap; }
  @media (max-width:380px) {
    .golden-shared-menu-bar { gap:2px; }
    .users .invoker { max-width:40px; }
  }
</style>
