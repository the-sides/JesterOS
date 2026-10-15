import { test, expect } from 'bun:test';
import { createMacApplicationFiles, applicationBundleId } from '../frontend/src/mac-application-files.js';
import { createMacDesktopFileStore } from '../frontend/src/desktop-file-state.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

const highSierra = getOSProfile('macos-high-sierra-10.13');
const mojave = getOSProfile('macos-mojave-10.14');
const sonoma = getOSProfile('macos-sonoma-14.0');
const profiles = [highSierra, mojave, sonoma];

function catalog(profile, sceneTime = 0) {
  const store = createMacDesktopFileStore(profile, sceneTime);
  store.files.push(...createMacApplicationFiles(profile, sceneTime));
  return store.files;
}

function bundlePath(files, appId) {
  let file = files.find(entry => entry.id === applicationBundleId(appId));
  expect(file?.kind).toBe('application');
  const names = [file.name];
  const seen = new Set([file.id]);
  while (file.parentId !== null) {
    file = files.find(entry => entry.id === file.parentId);
    expect(file?.kind).toBe('folder');
    expect(seen.has(file.id)).toBe(false);
    seen.add(file.id);
    if (file.id !== 'disk') names.unshift(file.name);
  }
  expect(file.id).toBe('disk');
  return `/${names.join('/')}`;
}

test('Finder reveals its real CoreServices parent while legacy ordinary apps live in Applications', () => {
  for (const profile of profiles) {
    expect(bundlePath(catalog(profile), 'finder')).toBe('/System/Library/CoreServices/Finder.app');
  }
  for (const profile of [highSierra, mojave]) {
    const files = catalog(profile);
    expect(bundlePath(files, 'mail')).toBe('/Applications/Mail.app');
    expect(bundlePath(files, 'settings')).toBe('/Applications/System Preferences.app');
    expect(bundlePath(files, 'preview')).toBe('/Applications/Preview.app');
  }
});

test('Sonoma distinguishes system apps, utilities, Safari and the DVD helper catalog location', () => {
  const files = catalog(sonoma);
  expect(bundlePath(files, 'notes')).toBe('/System/Applications/Notes.app');
  expect(bundlePath(files, 'settings')).toBe('/System/Applications/System Settings.app');
  expect(bundlePath(files, 'terminal')).toBe('/System/Applications/Utilities/Terminal.app');
  expect(bundlePath(files, 'screenshot')).toBe('/System/Applications/Utilities/Screenshot.app');
  expect(bundlePath(files, 'printcenter')).toBe('/System/Applications/Utilities/Print Center.app');
  expect(bundlePath(files, 'screensharing')).toBe('/System/Applications/Utilities/Screen Sharing.app');
  expect(bundlePath(files, 'safari')).toBe('/Applications/Safari.app');
  expect(bundlePath(files, 'imagecapture')).toBe('/System/Applications/Image Capture.app');
  expect(bundlePath(files, 'quicktime')).toBe('/System/Applications/QuickTime Player.app');
  expect(bundlePath(files, 'dvd-player')).toBe('/System/Library/CoreServices/Applications/DVD Player.app');
});


test('bundle references remain stable across eras and Dock membership without fixture or folder collisions', () => {
  for (const profile of profiles) {
    const files = catalog(profile);
    const ids = new Set();
    for (const file of files) {
      expect(ids.has(file.id)).toBe(false);
      ids.add(file.id);
    }
    const unpinned = {
      ...profile,
      applications: Object.fromEntries(Object.entries(profile.applications).map(([id, app]) => {
        const { dock, ...definition } = app;
        return [id, definition];
      })),
    };
    expect(createMacApplicationFiles(unpinned, 42)).toEqual(createMacApplicationFiles(profile, 42));
  }
  expect(applicationBundleId('voice-memos')).not.toBe(applicationBundleId('voice_memos'));
  expect(applicationBundleId('System/Applications')).not.toBe(applicationBundleId('System-Applications'));
});
