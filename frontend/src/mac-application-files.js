// Readonly virtual installation catalog, independent of Dock aliases/app lifetime.
// Apple's 2018 filesystem guide establishes /Applications and its Utilities folder:
// https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html
// Catalina's system/data split is documented at:
// https://developer.apple.com/videos/play/wwdc2019/710/
// Sonoma's Apps/Utilities help categories are NOT literal filesystem locations:
// https://support.apple.com/guide/mac-help/apps-included-on-your-mac-mchl110b00b7/14.0/mac/14.0
// The era paths below are an explicit simulated catalog policy, not a complete
// factory-install manifest. Image Capture/QuickTime stay with ordinary apps;
// Screenshot is in Utilities and DVD Player is in CoreServices/Applications.
// Sonoma keeps the declared Intel-only Boot Camp catalog entry on every scene.
const utilityAppIds = new Set([
  'activitymonitor', 'airport', 'audiomidi', 'bluetooth-exchange', 'bootcamp',
  'colorsync', 'console', 'digitalcolor', 'diskutility', 'grab', 'grapher',
  'keychain', 'migration', 'printcenter', 'screensharing', 'screenshot',
  'scripteditor', 'systeminformation', 'terminal', 'voiceover',
]);

const sonomaSystemAppIds = new Set([
  'launchpad', 'messages', 'mail', 'maps', 'photos', 'facetime', 'calendar',
  'contacts', 'reminders', 'notes', 'settings', 'music', 'appstore', 'automator',
  'books', 'calculator', 'chess', 'clock', 'dictionary', 'findmy', 'fontbook',
  'freeform', 'home', 'news', 'photobooth', 'podcasts', 'preview', 'shortcuts',
  'stickies', 'stocks', 'textedit', 'tv', 'voice-memos', 'weather',
  'imagecapture', 'quicktime',
]);

// Separate namespaces preserve identity without slugs, display names, ordering,
// pinning, or running state; neither overlaps fixtures or generated file-N IDs.
export function applicationBundleId(appId) {
  return `mac-application:${appId}`;
}

function containingPath(profile, appId) {
  if (appId === 'finder') return 'System/Library/CoreServices';
  if (profile.renderer === 'golden-gate') {
    // Explicit simulated installation policy; the help roster is not a disk manifest.
    if (appId === 'dvd-player') return 'System/Library/CoreServices/Applications';
    if (utilityAppIds.has(appId) || appId === 'directoryutility') return 'System/Applications/Utilities';
    return appId === 'safari' ? 'Applications' : 'System/Applications';
  }
  if (profile.renderer === 'sonoma') {
    if (appId === 'dvd-player') return 'System/Library/CoreServices/Applications';
    if (utilityAppIds.has(appId)) return 'System/Applications/Utilities';
    if (sonomaSystemAppIds.has(appId)) return 'System/Applications';
  } else if (utilityAppIds.has(appId)) {
    return 'Applications/Utilities';
  }
  // Safari and optional/non-system installed apps remain in /Applications.
  return 'Applications';
}

export function createMacApplicationFiles(profile, sceneTime = 0) {
  const files = [];
  const folders = new Map();
  const record = fields => ({
    ...fields, content: '', deleted: false, revision: 1,
    readOnly: true, renameable: false, movable: false,
    createdAt: sceneTime, modifiedAt: sceneTime, addedAt: sceneTime,
    lastOpenedAt: null, tags: [],
  });

  function ensureFolder(path) {
    if (folders.has(path)) return folders.get(path);
    const slash = path.lastIndexOf('/');
    const parentId = slash < 0 ? 'disk' : ensureFolder(path.slice(0, slash));
    const id = `mac-application-folder:${path}`;
    files.push(record({
      id, parentId, name: path.slice(slash + 1),
      kind: 'folder', appId: 'finder', icon: 'folder',
    }));
    folders.set(path, id);
    return id;
  }

  for (const app of Object.values(profile.applications)) {
    const parentId = ensureFolder(containingPath(profile, app.id));
    files.push(record({
      id: applicationBundleId(app.id), parentId, name: `${app.name}.app`,
      kind: 'application', appId: app.id, bundleAppId: app.id, icon: app.icon,
    }));
  }
  return files;
}
