export const forceQuitWindowTarget = (window, appId, action) => window.appId === appId
  && (action !== 'relaunch' || !window.utilityKind);

// Private, page-local confirmation state: retain handles, never a serialized DTO.
export function captureForceQuitLease(appId, action, windows, lifetime) {
  const targets = new Set();
  for (const window of windows) if (forceQuitWindowTarget(window, appId, action)) targets.add(window);
  return { appId, action, lifetime, windows: targets };
}

export function forceQuitLeaseCurrent(lease, windows, lifetime, runningAppIds) {
  if (!lease || lease.lifetime !== lifetime || !runningAppIds.includes(lease.appId)) return false;
  let count = 0;
  for (const window of windows) {
    if (!forceQuitWindowTarget(window, lease.appId, lease.action)) continue;
    if (!lease.windows.has(window)) return false;
    count++;
  }
  return count === lease.windows.size;
}
