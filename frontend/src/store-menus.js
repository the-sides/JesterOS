import { storeSession, storeInstalled, storeCapabilities } from './store-state.js';
import { storePackage } from './store-fixtures.js';
export function storeMenus(profile, state, windowId) {
  const session = storeSession(state, windowId), cap = storeCapabilities(profile), pkg = storePackage(session?.packageId), installed = pkg && storeInstalled(state, pkg.id), owner = { windowId };
  const item = (id, label, command, payload = {}, enabled = !!session, extra = {}) => ({ id, label, enabled: !!enabled, ...extra, ...(enabled ? { request: { command, target: owner, payload } } : {}) });
  const title = section => ({ topcharts: 'Top Charts', purchased: 'Purchased', home: 'Home', apps: 'Apps', gaming: 'Gaming', movies: 'Movies & TV', library: 'Library' }[section] ?? section.charAt(0).toUpperCase() + section.slice(1));
  const updates = state.installedApps.some(row => storePackage(row.packageId)?.latestVersion !== row.version);
  const groups = [
    { id: 'file', label: 'File', items: [item('new-window', 'New Window', 'store.window.new', {}, !!session, { shortcut: '⌘N' }), item('close-window', 'Close Window', 'store.window.close', {}, !!session, { shortcut: '⌘W' })] },
    { id: 'edit', label: 'Edit', items: [item('search', 'Search', 'store.focus', { controlId: 'search' }, !!session, { shortcut: '⌘F' }), item('select-all', 'Select All', 'store.selectAll', {}, !!session, { shortcut: '⌘A' }), item('copy-link', 'Copy Local Package Link', 'store.copyLink', { packageId: pkg?.id ?? 'unavailable' }, !!pkg)] },
    { id: 'store', label: cap.windows ? 'Account' : 'Store', items: [item('account', 'View My Account…', 'store.sheet', { sheet: 'account' }), item('sign-in', 'Sign In…', 'store.sheet', { sheet: 'signin' }, !!session && !state.account.signedIn), item('sign-out', 'Sign Out', 'store.signOut', {}, !!session && state.account.signedIn), item('update-all', cap.windows ? 'Get Updates' : cap.highSierra ? 'Update All Local Apps' : 'Update All', 'store.updateAll', {}, !!session && state.account.signedIn && updates), item('open-installed', 'Open Installed App', 'store.openInstalled', { packageId: pkg?.id ?? 'unavailable' }, !!installed), item('remove-installed', 'Remove Local Installation…', 'store.sheet', { sheet: 'uninstall' }, !!installed)] },
    { id: 'view', label: 'View', items: [item('back', 'Back', 'store.back', {}, !!session?.back.length, { shortcut: '⌘[' }), item('forward', 'Forward', 'store.forward', {}, !!session?.forward.length, { shortcut: '⌘]' }), ...cap.sections.map(section => item(`view-${section}`, title(section), 'store.navigate', { section }, !!session, { checked: session?.screen === 'browse' && session.section === section }))] },
    { id: 'window', label: 'Window', items: [item('new', 'New Window', 'store.window.new'), item('close', 'Close Window', 'store.window.close')] },
    { id: 'help', label: 'Help', items: [item('help', `${cap.label} Local Help`, 'store.sheet', { sheet: 'help' })] },
  ];
  const settings = { id: 'appstore', label: cap.label, items: [item('about', `About ${cap.label} · Local Recreation`, 'store.sheet', { sheet: 'help' }), item('settings', cap.highSierra || cap.era === 'mojave' ? 'Preferences…' : 'Settings…', 'store.sheet', { sheet: 'settings' })] };
  return [settings, ...groups];
}
