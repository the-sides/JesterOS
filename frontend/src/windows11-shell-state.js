export const shellPanels = ['start', 'search', 'quick', 'notifications'];
export const quickControls = ['wifi', 'bluetooth', 'airplane', 'volume', 'brightness'];
export const desktopActions = ['open', 'properties', 'refresh', 'sort-name', 'toggle-icons', 'personalize'];
export const shellScrollAreas = ['start', 'search', 'notifications', 'panel', 'desktop', 'properties', 'taskbar'];
export function createWindows11ShellState() {
  return {
    panel: null, startPage: 'pinned', query: '', selectedFileIds: [],
    selectionAnchorId: null, rename: null, marquee: null, positions: {},
    context: null, dialog: null, showDesktopIcons: true, sortByName: false,
    focusedControl: null, scroll: Object.fromEntries(shellScrollAreas.map((area) => [area, 0])),
    scrollLeft: Object.fromEntries(shellScrollAreas.map((area) => [area, 0])),
    quick: { wifi: true, bluetooth: false, airplane: false, volume: 70, brightness: 80 },
    calendar: { year: 2023, month: 9, selectedDate: '2023-10-31' },
    doNotDisturb: false,
    notifications: [
      { id: 'scene-ready', appId: 'explorer', title: 'Your scene is ready', body: 'Local documents and pictures are available in File Explorer.', time: '9:35 AM' },
      { id: 'call-time', appId: 'clock', title: 'Production reminder', body: 'Crew call at 10:00 AM. All times in this scene are fictional.', time: '9:40 AM' },
    ],
  };
}
export function windows11DesktopFiles(profile, apps) {
  const virtualFiles = apps?.files ?? [];
  const records = new Map(virtualFiles.map((entry) => [entry.id, entry]));
  function visible(entry) {
    const visited = new Set();
    while (entry) {
      if (entry.deleted || visited.has(entry.id)) return false;
      visited.add(entry.id); entry = records.get(entry.parentId);
    }
    return true;
  }
  const entries = profile.desktopFiles.filter((entry) => !entry.fileId).map((entry) => ({ ...entry, renameable: false, movable: false }));
  for (const file of virtualFiles) {
    if (file.parentId !== 'desktop' || !visible(file)) continue;
    const kind = file.kind;
    entries.push({
      id: file.id, name: file.name, icon: kind === 'folder' ? 'folder' : kind === 'image' ? 'image-file' : 'text-file',
      appId: kind === 'folder' ? 'explorer' : kind === 'image' ? 'photos' : 'notepad',
      renameable: true, movable: true,
      ...(kind === 'folder' ? { folderId: file.id } : { fileId: file.id }),
    });
  }
  return entries;
}
export function readWindows11ShellTargets(shell, context) {
  return {
    controls: (context?.getDesktopView()?.controlIds() ?? []).map((controlId) => ({ controlId, available: true })),
    applications: Object.values(context?.getProfile()?.applications ?? {}).map(({ id, name }) => ({ appId: id, name, available: true })),
    taskbar: (context?.getWindows() ?? []).map(({ id, appId, minimized }) => ({ windowId: id, appId, minimized })),
    scroll: { ...shell.scroll },
    scrollLeft: { ...shell.scrollLeft },
    scrollAreas: (context?.getDesktopView()?.scrollAreas() ?? []).map((area) => ({ area, available: true })),
    panels: shellPanels.map((panelId) => ({ panelId, open: shell.panel === panelId })),
    startPages: ['pinned', 'all-apps'],
    quick: quickControls.map((control) => ({ control, value: shell.quick[control], fictional: true })),
    desktop: {
      selectedFileIds: [...shell.selectedFileIds], selectionAnchorId: shell.selectionAnchorId,
      rename: shell.rename ? { ...shell.rename } : null, marquee: shell.marquee ? { ...shell.marquee } : null,
      positions: Object.fromEntries(Object.entries(shell.positions).map(([id, position]) => [id, { ...position }])),
      showIcons: shell.showDesktopIcons, sortByName: shell.sortByName,
      files: (context?.getDesktopItems() ?? []).map((entry) => ({ ...entry })),
      itemBounds: context?.getDesktopView()?.itemRects() ?? [],
    },
    menus: shell.context ? [{ menuId: 'desktop-context', fileId: shell.context.fileId, itemIds: shell.context.fileId ? ['open', 'properties'] : ['refresh', 'sort-name', 'toggle-icons', 'personalize'] }] : [],
    dialogs: shell.dialog ? [{ dialogId: 'properties', fileId: shell.dialog.fileId, actions: ['close'] }] : [],
    notifications: shell.notifications.map(({ id, appId }) => ({ notificationId: id, appId })),
    calendar: { ...shell.calendar }, focusedControl: shell.focusedControl ? { ...shell.focusedControl } : null,
  };
}
