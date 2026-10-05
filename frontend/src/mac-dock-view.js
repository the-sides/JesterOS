import { tick } from 'svelte';
import { revealDesktopItem } from './desktop-item-interactions.js';

export function createMacDockView({ getWorkspace, getDock, getState, getActiveApp, execute }) {
  let suppressClickAppId = null;
  let fitFingerprint = null;
  function fitDock() {
    const dock = getDock();
    if (!dock?.isConnected) return;
    const buttons = [...dock.querySelectorAll('button')], available = Math.max(1, innerWidth - 24);
    const fingerprint = `${innerWidth}:${buttons.length}:${dock.children.length}`;
    if (fingerprint === fitFingerprint) return;
    fitFingerprint = fingerprint;
    const modern = dock.classList.contains('sonoma-dock'), prefix = modern ? '--sonoma-dock-' : '--dock-';
    dock.style.removeProperty(`${prefix}icon`); dock.style.removeProperty(`${prefix}gap`);
    const width = dock.getBoundingClientRect().width;
    if (width <= available || !buttons.length) return;
    const icon = buttons[0].getBoundingClientRect().width, gap = parseFloat(getComputedStyle(dock).columnGap);
    const gaps = dock.children.length - 1 + [...dock.querySelectorAll('ul')].reduce((sum, list) => sum + Math.max(0, list.children.length - 1), 0);
    const scalable = buttons.length * icon + gaps * gap, fixed = width - scalable;
    const ratio = Math.max(0.01, Math.min(1, (available - fixed) / scalable));
    dock.style.setProperty(`${prefix}icon`, `${icon * ratio}px`);
    dock.style.setProperty(`${prefix}gap`, `${gap * ratio}px`);
  }
  const request = (command, target = {}, payload = {}) => execute({ command, target, payload });
  const menu = region => getWorkspace()?.querySelector(`[data-dock-context-menu="${region}"]`);
  const dockAvailable = () => Boolean(getWorkspace()?.isConnected && getDock()?.isConnected
    && !getWorkspace().closest('[inert]') && !getWorkspace().parentElement.querySelector('[aria-modal="true"]'));
  const dockButton = appId => [...(getDock()?.querySelectorAll('[data-app-id]') ?? [])].find(element => element.dataset.appId === appId);
  function dockAnchor(appId) {
    const button = dockButton(appId);
    if (!button?.getClientRects().length) return null;
    const bounds = button.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top };
  }
  async function focusDockMenuItem(itemId) {
    await tick(); await tick();
    const item = [...(getWorkspace()?.querySelectorAll('[data-dock-context-item]') ?? [])]
      .find(element => element.dataset.dockContextItem === itemId && !element.disabled);
    revealDesktopItem(item, item?.closest('[data-dock-context-menu]'));
    (item || menu('main'))?.focus({ preventScroll: true });
  }
  function dockMenuScrollTop(region) { return menu(region)?.scrollTop ?? null; }
  async function scrollDockMenu(region, top) {
    await tick();
    const pane = menu(region);
    if (!pane) return null;
    pane.scrollTop = top;
    return pane.scrollTop;
  }
  function dockMenuBounds() {
    return [...(getWorkspace()?.querySelectorAll('[data-dock-context-menu]') ?? [])].map(element => {
      const bounds = element.getBoundingClientRect();
      return { region: element.dataset.dockContextMenu, x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
    });
  }
  async function focusDockAppWindows(windowId) {
    await tick(); await tick();
    const overlay = getWorkspace()?.querySelector('[data-dock-app-windows]');
    const button = windowId && [...(overlay?.querySelectorAll('[data-dock-window-id]') ?? [])].find(element => element.dataset.dockWindowId === windowId);
    (button || overlay)?.focus({ preventScroll: true });
  }
  function pointerdown(event, appId) {
    if (event.ctrlKey && event.button === 0) {
      event.preventDefault(); event.stopPropagation(); suppressClickAppId = appId;
      request('dock.context.open', { appId });
    } else suppressClickAppId = null;
  }
  function click(event, appId) {
    if (event.ctrlKey || suppressClickAppId === appId) {
      event.preventDefault(); suppressClickAppId = null; return;
    }
    event.preventDefault();
    request(event.metaKey ? 'dock.reveal' : 'dock.activate', { appId });
  }
  function contextmenu(event, appId) {
    event.preventDefault(); event.stopPropagation();
    if (suppressClickAppId !== appId || getState().context?.appId !== appId) request('dock.context.open', { appId });
  }
  function keydown(event, appId) {
    if (event.isComposing) return;
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault(); event.stopPropagation(); request('dock.context.open', { appId }); return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...getDock().querySelectorAll('[data-app-id], [data-dock-item-id]')], index = buttons.indexOf(event.currentTarget);
    const next = event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons.at(-1)
      : buttons[(index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length];
    event.preventDefault(); event.stopPropagation(); next?.focus({ preventScroll: true });
  }
  function shortcut(event) {
    if (event.defaultPrevented || event.isComposing || !dockAvailable()) return;
    const state = getState();
    if (event.key === 'Escape' && (state.context || state.appWindows)
      && !event.target?.closest?.('[data-dock-context-menu], [data-dock-app-windows]')) {
      event.preventDefault(); event.stopPropagation();
      request(state.context ? 'dock.context.close' : 'dock.windows.close'); return;
    }
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === 'ArrowDown' && !state.context) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) request(state.appWindows ? 'dock.windows.close' : 'dock.windows.open', state.appWindows ? {} : { appId: getActiveApp().id });
    } else if (event.key === 'F3') {
      const button = getDock().querySelector('[data-app-id]');
      if (button) { event.preventDefault(); event.stopPropagation(); button.focus({ preventScroll: true }); }
    }
  }
  function dismissOutside(event) {
    if (getState().context && !event.target?.closest?.('[data-dock-context-menu]')) request('dock.context.close', {}, { restoreFocus: false });
  }
  return { fitDock, dockAvailable, dockAnchor, focusDockMenuItem, dockMenuScrollTop, scrollDockMenu, dockMenuBounds,
    focusDockAppWindows, pointerdown, click, contextmenu, keydown, shortcut, dismissOutside };
}
