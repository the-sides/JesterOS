import Desktop from './Desktop.svelte';
import Window from './Window.svelte';
import MessagesWindow from './MessagesWindow.svelte';
import NotesWindow from './NotesApp.svelte';
import { createDefaultApplicationFiles } from './default-application-files.js';
import { createDefaultSceneSeed } from './scene-seed.js';
import { mojaveProfile } from './mojave-applications.js';
import { fitNormalBounds as fitBounds } from './window-state.js';

// Bounds are physical workspace pixels; scale keeps Mojave's logical UI size.
function windowScale(app, area) {
  const sideSpace = area.width <= 520 ? 24 : area.width <= 760 ? 108 : area.width <= 900 ? 150 : 44;
  const width = Math.min(area.width, Math.max(1, area.width - sideSpace));
  const height = Math.min(area.height, Math.max(1, area.height - 24));
  return Math.min(0.75, width / app.width, height / app.height);
}

function fitNormalBounds(bounds, app, area) {
  return fitBounds(bounds, app, area, bounds.scale ? 0.75 : windowScale(app, area));
}

function initialBounds(app, area, windowCount = 0, viewportHeight = area.height + 22) {
  const offset = (windowCount % 6) * 22;
  const x = area.width > 1100 ? area.width * 0.15 : area.width > 900 ? area.width * 0.1 : area.width > 760 ? 22 : 12;
  const y = area.width <= 520 ? 290 : area.width <= 760 ? 95 : viewportHeight <= 720 ? 42 : viewportHeight * 0.16 - 22;
  return fitNormalBounds({ x: x + offset, y: y + offset }, app, area);
}

function prepareDocument() {
  // Chromium's Linux "-apple-system" alias resolves before the web-font fallback.
  // Prefer native SF only on Apple platforms; use the bundled UI font elsewhere.
  document.documentElement.classList.toggle('native-apple-font', /Mac|iPhone|iPad|iPod/.test(navigator.platform));
}

function createSceneData(seed, profile = mojaveProfile) {
  return seed ? structuredClone(seed) : createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
}

export const mojaveAdapter = Object.freeze({
  Desktop,
  Window,
  MessagesWindow,
  NotesWindow,
  expandedProperty: 'zoomed',
  closeKeepsRunning: true,
  prepareDocument,
  createSceneData,
  initialBounds,
  fitNormalBounds,
});
