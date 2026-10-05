import Desktop from './SonomaDesktop.svelte';
import Window from './SonomaWindow.svelte';
import MessagesWindow from './SonomaMessagesWindow.svelte';
import NotesWindow from './SonomaNotesWindow.svelte';
import { createNotesState } from './notes-state.js';
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

function createSceneData() {
  // Fixture offsets place the latest note at the menu's fictional 5:42 PM.
  return { notes: createNotesState(Date.UTC(2023, 8, 26, 17, 0)) };
}

export const sonomaAdapter = Object.freeze({
  Desktop, Window, MessagesWindow, NotesWindow,
  expandedProperty: 'zoomed',
  prepareDocument, createSceneData, initialBounds, fitNormalBounds,
});
