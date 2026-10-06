// Actions/labels: Apple's macOS 27 guides. Grouping carries forward the observed
// Tahoe 26 menu image; it is not claimed to be a photographed Golden Gate menu.
export const SYSTEM_UTILITY_SIZES = {
  'system-about': { width: 360, height: 450, minimumSize: { width: 280, height: 240 } },
  'system-force-quit': { width: 420, height: 390, minimumSize: { width: 280, height: 240 } },
};

export function appleMenuItems({ profile, session, option = false, recentItems = [], desktopAvailable = false }) {
  if (!profile.capabilities.includes('shell.apple-menu')) return [];
  const user = session.users.find(entry => entry.id === session.activeUserId);
  const app = appId => ({ command: 'app.open', target: { appId } });
  const decision = command => ({ command, ...(option ? { payload: { confirm: false } } : {}) });
  return [
    { id: 'about', label: option ? 'System Information' : 'About This Mac', enabled: desktopAvailable,
      request: { command: option ? 'system.information.open' : 'system.about.open' } },
    { id: 'settings', label: 'System Settings…', enabled: desktopAvailable, separatorBefore: true, request: app('settings') },
    { id: 'appstore', label: 'App Store…', enabled: desktopAvailable, request: app('appstore') },
    { id: 'recent-items', label: 'Recent Items', enabled: desktopAvailable, separatorBefore: true, children: recentItems },
    { id: 'force-quit', label: 'Force Quit', enabled: desktopAvailable, separatorBefore: true, shortcut: '⌥⌘Esc',
      request: { command: 'system.forceQuit.open' } },
    ...(profile.capabilities.includes('session.power') ? [
      { id: 'sleep', label: 'Sleep', enabled: true, separatorBefore: true, request: { command: 'power.sleep' } },
      { id: 'restart', label: `Restart${option ? '' : '…'}`, enabled: true, request: decision('power.restart') },
      { id: 'shutdown', label: `Shut Down${option ? '' : '…'}`, enabled: true, request: decision('power.shutdown') },
    ] : []),
    { id: 'lock', label: 'Lock Screen', enabled: true, separatorBefore: true, shortcut: '⌃⌘Q',
      request: { command: 'session.lock' } },
    { id: 'logout', label: `Log Out ${user.name}${option ? '' : '…'}`, enabled: true, shortcut: '⇧⌘Q',
      request: decision('session.logout') },
  ];
}
