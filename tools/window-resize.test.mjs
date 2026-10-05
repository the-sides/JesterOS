import { test, expect } from 'bun:test';
import { resizeBounds, fitNormalBounds } from '../frontend/src/window-state.js';

const bounds = { x: 100, y: 80, width: 400, height: 300, scale: 0.5 };
const minimumSize = { width: 360, height: 240 };
const area = { width: 1000, height: 800 };

test('edge and corner resizing anchors the opposite edges at physical coordinates', () => {
  const cases = [
    ['n', { y: 120 }, { x: 100, y: 120, width: 400, height: 260, scale: 0.5 }],
    ['s', { y: 500 }, { x: 100, y: 80, width: 400, height: 420, scale: 0.5 }],
    ['e', { x: 700 }, { x: 100, y: 80, width: 600, height: 300, scale: 0.5 }],
    ['w', { x: 40 }, { x: 40, y: 80, width: 460, height: 300, scale: 0.5 }],
    ['ne', { x: 700, y: 120 }, { x: 100, y: 120, width: 600, height: 260, scale: 0.5 }],
    ['nw', { x: 40, y: 120 }, { x: 40, y: 120, width: 460, height: 260, scale: 0.5 }],
    ['se', { x: 700, y: 500 }, { x: 100, y: 80, width: 600, height: 420, scale: 0.5 }],
    ['sw', { x: 40, y: 500 }, { x: 40, y: 80, width: 460, height: 420, scale: 0.5 }],
  ];
  for (const [edge, coordinates, expected] of cases) {
    expect(resizeBounds(bounds, edge, coordinates, minimumSize, area)).toEqual(expected);
  }
});

test('resizing clamps to scaled app minima and workspace without moving anchored edges', () => {
  expect(resizeBounds(bounds, 'nw', { x: 900, y: 900 }, minimumSize, area))
    .toEqual({ x: 320, y: 260, width: 180, height: 120, scale: 0.5 });
  expect(resizeBounds(bounds, 'se', { x: 0, y: 0 }, minimumSize, area))
    .toEqual({ x: 100, y: 80, width: 180, height: 120, scale: 0.5 });
  expect(resizeBounds(bounds, 'nw', { x: -100, y: -100 }, minimumSize, area))
    .toEqual({ x: 0, y: 0, width: 500, height: 380, scale: 0.5 });
  expect(resizeBounds(bounds, 'se', { x: 9999, y: 9999 }, minimumSize, area))
    .toEqual({ x: 100, y: 80, width: 900, height: 720, scale: 0.5 });
  expect(bounds).toEqual({ x: 100, y: 80, width: 400, height: 300, scale: 0.5 });
});

test('viewport refitting retains resized logical dimensions instead of app defaults', () => {
  const resized = resizeBounds(bounds, 'se', { x: 700, y: 500 }, minimumSize, area);
  const app = { width: 800, height: 600 };
  const narrow = fitNormalBounds(resized, app, { width: 390, height: 700 }, 0.75);
  expect(narrow).toEqual({ x: 0, y: 80, width: 390, height: 273, scale: 0.325 });
  const restored = fitNormalBounds(narrow, app, { width: 1440, height: 850 }, 0.75);
  expect(restored).toEqual({ x: 0, y: 80, width: 900, height: 630, scale: 0.75 });
});
