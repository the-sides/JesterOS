import { tick } from 'svelte';
import { revealDesktopItem } from './desktop-item-interactions.js';

export function createMacDockView({ getWorkspace, getDock, getDockControls, getState, getActiveApp, execute }) {
  async function prepareDock() { await tick(); await tick(); }
  const dockItemAnchor = itemId => getDockControls()?.anchor(itemId) ?? null;
  const focusDockItem = itemId => getDockControls()?.focusItem(itemId);
  const dockDropPlan = (itemId, source, x, y) => getDockControls()?.dropPlan(itemId, source, x, y) ?? null;
  const dockItemBounds = () => getDockControls()?.bounds() ?? [];
  const dockPointerInside = () => getDockControls()?.pointerInside() ?? false;
  const request = (command, target = {}, payload = {}) => execute({ command, target, payload });
  const menu = region => getWorkspace()?.querySelector(`[data-dock-context-menu="${region}"]`);
  const dockAvailable = () => Boolean(getWorkspace()?.isConnected && getDock()?.isConnected
    && !getWorkspace().closest('[inert]') && !getWorkspace().parentElement.querySelector('[aria-modal="true"]'));
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
    }
  }
  function dismissOutside(event) {
    if (getState().context && !event.target?.closest?.('[data-dock-context-menu]')) request('dock.context.close', {}, { restoreFocus: false });
  }
  return { prepareDock, dockAvailable, dockItemAnchor, focusDockItem, dockDropPlan, dockItemBounds, dockPointerInside,
    focusDockMenuItem, dockMenuScrollTop, scrollDockMenu, dockMenuBounds, focusDockAppWindows, shortcut, dismissOutside };
}
