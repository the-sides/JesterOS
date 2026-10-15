import { composeNativeProfile } from './native-profile-composition.js';

// Release attribution, complete native inventory and bounded coverage: docs/windows11-profile.md.
// Logical simulation layout limits, not measured factory Windows app minima.
const singleWindowApps = new Set(['settings', 'clock', 'snipping', 'teams']);
const application = (id, name, width, height, minimumSize, taskbar = 'running') => ({ id, name, icon: id, width, height, minimumSize, multipleWindows: !singleWindowApps.has(id), quitAllowed: true, taskbar, coverage: 'local-simulation' });
export const windows11Profile = composeNativeProfile({
  id: 'windows11-23h2-22631.2428', name: 'Windows 11 Pro', family: 'windows',
  version: '23H2', build: '22631.2428', releaseYear: 2023, renderer: 'windows11',
  capabilities: ['shell.apps', 'shell.windows', 'shell.windows-maximize', 'shell.window-resize', 'shell.window-create', 'app.lifecycle', 'shell.switcher', 'shell.full-screen', 'shell.desktop', 'scene.profile-selection', 'windows.shell', 'windows.apps', 'messages.conversations', 'browser.local', 'mail.local', 'contacts.cards', 'calendar.events', 'calls.local', 'apps.reminders', 'notes.workspace'],
  applications: {
    explorer: application('explorer', 'File Explorer', 1000, 650, { width: 640, height: 420 }, 'pinned'),
    edge: application('edge', 'Microsoft Edge', 1060, 720, { width: 640, height: 460 }, 'pinned'),
    mail: application('mail', 'Mail', 1040, 700, { width: 720, height: 480 }),
    contacts: application('contacts', 'People', 880, 640, { width: 640, height: 460 }),
    calendar: application('calendar', 'Calendar', 1060, 720, { width: 720, height: 500 }),
    reminders: application('reminders', 'Microsoft To Do', 1000, 650, { width: 700, height: 480 }),
    notes: application('notes', 'Sticky Notes', 880, 600, { width: 320, height: 260 }),
    notepad: application('notepad', 'Notepad', 820, 600, { width: 520, height: 400 }, 'pinned'),
    calculator: application('calculator', 'Calculator', 390, 580, { width: 390, height: 520 }),
    settings: application('settings', 'Settings', 1050, 720, { width: 900, height: 620 }, 'pinned'),
    paint: application('paint', 'Paint', 1000, 680, { width: 800, height: 520 }),
    photos: application('photos', 'Photos', 1000, 680, { width: 640, height: 480 }),
    clock: application('clock', 'Clock', 900, 640, { width: 640, height: 520 }),
    snipping: application('snipping', 'Snipping Tool', 850, 610, { width: 680, height: 500 }),
    terminal: application('terminal', 'Windows Terminal', 920, 590, { width: 560, height: 400 }),
    teams: { ...application('teams', 'Microsoft Teams (free)', 360, 620, { width: 360, height: 420 }, 'pinned'), messaging: true, coverage: 'local-messaging-browse-search' },
  },
  desktopFiles: [
    { id: 'pc', name: 'This PC', icon: 'pc', appId: 'explorer', folderId: 'root' },
    { id: 'recycle', name: 'Recycle Bin', icon: 'recycle', appId: 'explorer', folderId: 'trash' },
    { id: 'call-sheet', name: 'Call sheet.txt', icon: 'text-file', appId: 'notepad', fileId: 'call-sheet' },
  ],
  assets: { wallpaper: '/windows11/wallpaper.svg', icons: '/windows11/icons', fonts: ['/fonts/InterVariable.woff2'] },
  defaults: { startupAppId: 'explorer', desktopAppId: 'explorer', clockLabel: '9:41 AM', dateLabel: '10/31/2023', sceneTime: '2023-10-31T09:41:00.000Z', accountName: 'Alex Morgan' },
});
