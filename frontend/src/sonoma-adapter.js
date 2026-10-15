import Desktop from './SonomaDesktop.svelte';
import Window from './SonomaWindow.svelte';
import MessagesWindow from './SonomaMessagesWindow.svelte';
import NotesWindow from './NotesApp.svelte';
import { createDefaultApplicationFiles } from './default-application-files.js';
import { createDefaultSceneSeed } from './scene-seed.js';
import { sonomaProfile } from './sonoma-profile.js';
import { fitNormalBounds as fitBounds } from './window-state.js';

function windowScale(app, area) {
  const gutter = area.width <= 520 ? 24 : area.width <= 760 ? 110 : area.width <= 1000 ? 140 : 60;
  const width = Math.max(1, area.width - gutter);
  const height = Math.max(1, area.height - 28);
  return Math.min(0.9, width / app.width, height / app.height);
}

function fitNormalBounds(bounds, app, area) {
  return fitBounds(bounds, app, area, bounds.scale ? 0.9 : windowScale(app, area));
}

function initialBounds(app, area, windowCount = 0, viewportHeight = area.height + 28) {
  const offset = (windowCount % 6) * 24;
  const x = area.width > 1100 ? area.width * 0.14 : area.width > 760 ? 24 : 12;
  const y = area.width <= 520 ? 280 : area.width <= 760 ? 100 : viewportHeight <= 720 ? 36 : viewportHeight * 0.14 - 28;
  return fitNormalBounds({ x: x + offset, y: y + offset }, app, area);
}

function prepareDocument() {
  document.documentElement.classList.toggle('native-apple-font', /Mac|iPhone|iPad|iPod/.test(navigator.platform));
}

function createSceneData(seed, profile = sonomaProfile) {
  return seed ? structuredClone(seed) : createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
}

export const sonomaAdapter = Object.freeze({
  Desktop, Window, MessagesWindow, NotesWindow,
  expandedProperty: 'zoomed',
  closeKeepsRunning: true,
  prepareDocument, createSceneData, initialBounds, fitNormalBounds,
});
