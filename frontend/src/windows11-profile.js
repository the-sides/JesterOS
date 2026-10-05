// Release attribution, complete native inventory and bounded coverage: docs/windows11-profile.md.
const application = (id, name, width, height, taskbar = 'running') => ({ id, name, icon: id, width, height, taskbar, coverage: 'local-simulation' });
export const windows11Profile = {
  id: 'windows11-23h2-22631.2428', name: 'Windows 11 Pro', family: 'windows',
  version: '23H2', build: '22631.2428', releaseYear: 2023, renderer: 'windows11',
  capabilities: ['shell.apps', 'shell.windows', 'shell.windows-maximize', 'shell.desktop', 'scene.profile-selection', 'windows.shell', 'windows.apps'],
  applications: {
    explorer: application('explorer', 'File Explorer', 1000, 650, 'pinned'),
    edge: application('edge', 'Microsoft Edge', 1060, 720, 'pinned'),
    notepad: application('notepad', 'Notepad', 820, 600, 'pinned'),
    calculator: application('calculator', 'Calculator', 390, 580),
    settings: application('settings', 'Settings', 1050, 720, 'pinned'),
    paint: application('paint', 'Paint', 1000, 680),
    photos: application('photos', 'Photos', 1000, 680),
    clock: application('clock', 'Clock', 900, 640),
    snipping: application('snipping', 'Snipping Tool', 850, 610),
    terminal: application('terminal', 'Windows Terminal', 920, 590),
  },
  desktopFiles: [
    { id: 'pc', name: 'This PC', icon: 'pc', appId: 'explorer', folderId: 'root' },
    { id: 'recycle', name: 'Recycle Bin', icon: 'recycle', appId: 'explorer', folderId: 'trash' },
    { id: 'call-sheet', name: 'Call sheet.txt', icon: 'text-file', appId: 'notepad', fileId: 'call-sheet' },
  ],
  assets: { wallpaper: '/windows11/wallpaper.svg', icons: '/windows11/icons', fonts: ['/fonts/InterVariable.woff2'] },
  defaults: { startupAppId: 'explorer', desktopAppId: 'explorer', clockLabel: '9:41 AM', dateLabel: '10/31/2023', sceneTime: '2023-10-31T09:41:00.000Z', accountName: 'Alex Morgan' },
};
