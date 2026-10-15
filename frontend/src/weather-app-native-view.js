import { weatherAppWindow, weatherDisplayedRow, weatherTemperatureUnit, weatherMetrics } from './weather-app-state.js';
export function createWeatherAppNativeView({ getRoot, getState, getWidgets, getPreferences, windowId, available, tick, getMenus }) {
  const root = getRoot(), state = getState(), session = weatherAppWindow(state, windowId);
  let retired = false;
  const owned = () => !retired && root?.isConnected === true && getRoot() === root && getState() === state && weatherAppWindow(state, windowId) === session && root.dataset.weatherWindowId === windowId && available() === true;
  function visible(node) {
    if (!owned() || !node?.isConnected || !root.contains(node) || node.disabled) return false;
    const modal = root.querySelector('[aria-modal="true"]');
    if (modal && !modal.contains(node)) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  const control = id => [...root.querySelectorAll('[data-weather-control]')].find(node => node.dataset.weatherControl === id && visible(node));
  const area = id => [...root.querySelectorAll('[data-weather-area]')].find(node => node.dataset.weatherArea === id && visible(node));
  const current = guard => owned() && (!guard || guard() === true) && owned();
  async function focus(id, guard) {
    const node = control(id);
    if (!node || !current(guard)) return false;
    await tick();
    if (!current(guard) || control(id) !== node) return false;
    node.focus({ preventScroll: true });
    return current(guard) && control(id) === node && node.ownerDocument.activeElement === node;
  }
  async function scroll(id, offsets, guard) {
    const node = area(id);
    if (!node || !current(guard)) return null;
    await tick();
    if (!current(guard) || area(id) !== node) return null;
    node.scrollTop = offsets.top; node.scrollLeft = offsets.left;
    return current(guard) && area(id) === node ? { top: node.scrollTop, left: node.scrollLeft } : null;
  }
  function describe() {
    if (!owned()) return { controlIds: [], areaIds: [], locationIds: [], menus: [] };
    const widgets = getWidgets(), preferences = getPreferences(), row = weatherDisplayedRow(widgets, session);
    return { controlIds: [...root.querySelectorAll('[data-weather-control]')].filter(visible).map(node => node.dataset.weatherControl),
      areaIds: [...root.querySelectorAll('[data-weather-area]')].filter(visible).map(node => node.dataset.weatherArea),
      locationIds: [...root.querySelectorAll('[data-weather-location]')].filter(visible).map(node => node.dataset.weatherLocation),
      selectedLocationId: widgets.selected.weatherLocationId, previewId: session.previewId, unit: weatherTemperatureUnit(widgets, preferences), section: session.section,
      forecast: row, metrics: weatherMetrics(row), menus: getMenus(), source: 'Actual shared widgets graph; authored offline forecasts and disclosed illustrative derived metrics.' };
  }
  return { available: owned, focus, scroll, describe, getMenus: () => owned() ? getMenus() : [], destroy: () => { retired = true; } };
}
