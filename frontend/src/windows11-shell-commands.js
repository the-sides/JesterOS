import { isRecord, rejected } from './feature-commands.js';
import { shellPanels, quickControls, shellScrollAreas } from './windows11-shell-state.js';
import { createDesktopItemCommands } from './desktop-item-commands.js';
import { createDesktopContextCommands } from './desktop-context-commands.js';
export { windows11ShellCatalog } from './windows11-shell-catalog.js';
export { readWindows11ShellTargets } from './windows11-shell-state.js';
const fields = (value, names, required = names) => isRecord(value) && Object.keys(value).every((key) => names.includes(key)) && required.every((key) => Object.hasOwn(value, key));
const applied = (target = {}) => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed Windows shell target and payload.');
export function createWindows11ShellCommands(shell, context) {
  const view = () => context.getDesktopView();
  const files = () => context.getDesktopItems();
  const file = (id) => files().find((entry) => entry.id === id);
  const app = (id) => Object.hasOwn(context.getProfile().applications, id);
  const dismiss = () => { shell.panel = null; shell.context = null; shell.dialog = null; };
  const closeAfter = async (command, target, payload = {}) => {
    const result = await context.invoke(command, target, payload);
    if (result.status === 'applied') dismiss();
    return result;
  };
  const openFile = async entry => {
    if (!entry.folderId) return closeAfter('win11.files.open', { fileId: entry.fileId });
    const opened = await context.invoke('app.open', { appId: entry.appId }, {});
    if (opened.status !== 'applied') return opened;
    return closeAfter('win11.explorer.navigate', { folderId: entry.folderId, windowId: opened.target.windowId });
  };
  const handler = (targetNames, payloadNames, run, optional = [], allowModal = false) => async (target, payload) => {
    if (!fields(target, targetNames) || !fields(payload, payloadNames, payloadNames.filter((name) => !optional.includes(name)))) return invalid();
    if (!view()) return rejected('unavailable', 'The Windows desktop is not mounted.');
    if (!allowModal && (!context.windowInteractionsAvailable() || shell.dialog)) return rejected('unavailable', 'Dismiss the native global modal before interacting with the desktop.');
    const result = await run(target, payload);
    if (result.status === 'applied' && view()) {
      const positions = await view().scrollSnapshot();
      for (const { area, top, left } of positions) { shell.scroll[area] = top; shell.scrollLeft[area] = left; }
    }
    return result;
  };
  const emptyHandler = (run) => handler([], [], run);
  const desktopAvailable = () => context.windowInteractionsAvailable() && !shell.dialog && view()?.itemsAvailable();
  const desktopHandler = (targetNames, payloadNames, run) => handler(targetNames, payloadNames, (target, payload) => {
    if (!desktopAvailable()) return rejected('unavailable', 'Dismiss the native global modal and show desktop icons before interacting with desktop entries.');
    return run(target, payload);
  });
  const desktopCommands = createDesktopItemCommands(shell, {
    getItems: files,
    getView: view,
    available: desktopAvailable,
    focusDesktop: () => { shell.panel = null; shell.context = null; context.focusDesktop(); },
    rename: (fileId, name) => context.renameDesktopItem(fileId, name),
    move: (fileIds, folderId) => context.moveDesktopItems(fileIds, folderId),
  }, 'win11.desktop');
  const contextCommands = createDesktopContextCommands(shell, {
    getItems: files, getView: view,
    available: () => Boolean(view() && context.windowInteractionsAvailable() && !shell.dialog),
    focusDesktop: () => { shell.panel = null; context.focusDesktop(); },
    invoke: (command, target, payload) => context.invoke(command, target, payload),
    createFolder: (name, fileIds) => context.createDesktopFolder(name, fileIds),
    trash: (fileIds) => context.trashDesktopItems(fileIds),
    openInfo: async (fileId) => {
      if (!context.getDesktopFileInfo(fileId)) return rejected('not_found', 'The file no longer exists.');
      shell.panel = null; shell.context = null; shell.dialog = { fileId };
      shell.focusedControl = { controlId: 'properties-close' };
      await view().focusControl('properties-close');
      return applied({ fileId });
    },
    family: 'windows',
  }, 'win11.desktop', 'windows');
  return {
    'win11.panel.open': handler(['panelId'], [], async ({ panelId }) => {
      if (!shellPanels.includes(panelId)) return invalid();
      dismiss(); shell.panel = panelId;
      const controlId = panelId === 'start' || panelId === 'search' ? 'search-input' : `${panelId}-panel`;
      shell.focusedControl = { controlId };
      await view().focusControl(controlId);
      for (const area of view().scrollAreas()) shell.scroll[area] = await view().scrollPanel(area, shell.scroll[area], shell.scrollLeft[area]);
      return applied({ panelId });
    }),
    'win11.panel.close': handler([], ['restoreFocus'], async (_, { restoreFocus = true }) => {
      if (typeof restoreFocus !== 'boolean') return invalid();
      const panel = shell.panel;
      shell.panel = null;
      if (restoreFocus && panel) {
        const controlId = `${panel}-trigger`;
        shell.focusedControl = { controlId };
        await view().focusControl(controlId);
      }
      return applied();
    }, ['restoreFocus']),
    'win11.start.page': handler([], ['page'], async (_, { page }) => {
      if (!['pinned', 'all-apps'].includes(page)) return invalid();
      if (shell.panel !== 'start') return rejected('unavailable', 'Start is not open.');
      shell.startPage = page; shell.query = ''; shell.scroll.start = 0;
      await view().scrollPanel('start', 0);
      return applied({ page });
    }),
    'win11.search.set': handler([], ['query'], (_, { query }) => {
      if (typeof query !== 'string') return invalid();
      if (!['start', 'search'].includes(shell.panel)) return rejected('unavailable', 'Open Start or Search first.');
      shell.query = query; return applied();
    }),
    'win11.app.activate': handler(['appId'], [], ({ appId }) => {
      if (typeof appId !== 'string') return invalid();
      if (!app(appId)) return rejected('not_found', 'This app is not represented.');
      return closeAfter('app.open', { appId });
    }),
    'win11.taskbar.activate': handler(['appId'], [], ({ appId }) => {
      if (typeof appId !== 'string') return invalid();
      if (!app(appId)) return rejected('not_found', 'This app is not represented.');
      const window = context.getWindows().findLast(entry => entry.appId === appId);
      if (!window) return closeAfter('app.open', { appId });
      return window.id === context.getActiveWindowId() && !window.minimized
        ? closeAfter('window.setMinimized', { windowId: window.id }, { minimized: true })
        : closeAfter('window.focus', { windowId: window.id });
    }),
    'win11.quick.set': handler(['control'], ['value'], ({ control }, { value }) => {
      if (!quickControls.includes(control)) return invalid();
      const toggle = ['wifi', 'bluetooth', 'airplane'].includes(control);
      if (toggle ? typeof value !== 'boolean' : !Number.isFinite(value) || value < 0 || value > 100) return invalid();
      shell.quick[control] = value;
      if (control === 'airplane' && value) { shell.quick.wifi = false; shell.quick.bluetooth = false; }
      return applied({ control });
    }),
    ...desktopCommands,
    ...contextCommands,
    'win11.desktop.open': desktopHandler(['fileId'], [], ({ fileId }) => {
      if (typeof fileId !== 'string') return invalid();
      const entry = file(fileId);
      return entry ? openFile(entry) : rejected('not_found', 'Desktop entry does not exist.');
    }),
    'win11.desktop.personalize': emptyHandler(() => closeAfter('win11.settings.navigate', { page: 'personalization' })),
    'win11.desktop.show': emptyHandler(async () => {
      for (const window of context.getWindows().filter((entry) => !entry.minimized)) {
        const result = await context.invoke('window.setMinimized', { windowId: window.id }, { minimized: true });
        if (result.status !== 'applied') return result;
      }
      dismiss(); context.focusDesktop(); await view().focusControl('desktop'); return applied();
    }),
    'win11.dialog.close': handler(['dialogId'], [], async ({ dialogId }) => {
      if (dialogId !== 'properties') return invalid();
      if (!shell.dialog) return rejected('unavailable', 'The properties dialog is closed.');
      const fileId = shell.dialog.fileId; shell.dialog = null;
      const controlId = file(fileId) && shell.viewOptions.showIcons ? `file:${fileId}` : 'desktop'; shell.focusedControl = { controlId };
      await view().focusControl(controlId); return applied({ dialogId });
    }, [], true),
    'win11.notification.dismiss': handler(['notificationId'], [], ({ notificationId }) => {
      const index = shell.notifications.findIndex((entry) => entry.id === notificationId);
      if (index < 0) return rejected('not_found', 'Notification no longer exists.');
      shell.notifications.splice(index, 1); return applied({ notificationId });
    }),
    'win11.notification.clear': emptyHandler(() => { shell.notifications = []; return applied(); }),
    'win11.notification.open': handler(['notificationId'], [], ({ notificationId }) => {
      const entry = shell.notifications.find((item) => item.id === notificationId);
      return entry ? closeAfter('app.open', { appId: entry.appId }) : rejected('not_found', 'Notification no longer exists.');
    }),
    'win11.notification.doNotDisturb': handler([], ['enabled'], (_, { enabled }) => {
      if (typeof enabled !== 'boolean') return invalid();
      shell.doNotDisturb = enabled; return applied();
    }),
    'win11.calendar.move': handler([], ['direction'], (_, { direction }) => {
      if (direction !== -1 && direction !== 1) return invalid();
      const date = new Date(Date.UTC(shell.calendar.year, shell.calendar.month + direction, 1));
      if (date.getUTCFullYear() < 2020 || date.getUTCFullYear() > 2030) return rejected('disabled', 'The local calendar is limited to 2020–2030.');
      shell.calendar.year = date.getUTCFullYear(); shell.calendar.month = date.getUTCMonth(); return applied();
    }),
    'win11.calendar.select': handler([], ['date'], (_, { date }) => {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid();
      const parsed = new Date(`${date}T00:00:00Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || parsed.getUTCFullYear() !== shell.calendar.year || parsed.getUTCMonth() !== shell.calendar.month) return rejected('not_found', 'Date is not in the displayed month.');
      shell.calendar.selectedDate = date; return applied({ date });
    }),
    'win11.shell.focus': handler(['controlId'], [], async ({ controlId }) => {
      if (controlId === null) { shell.focusedControl = null; return applied({ controlId }); }
      if (typeof controlId !== 'string' || !view().controlIds().includes(controlId)) return rejected('not_found', 'Shell control is not currently mounted.');
      shell.focusedControl = { controlId }; await view().focusControl(controlId); return applied({ controlId });
    }, [], true),
    'win11.shell.scroll': handler(['area'], ['top', 'left'], async ({ area }, { top, left }) => {
      if (!shellScrollAreas.includes(area) || !Number.isFinite(top) || top < 0 || (left !== undefined && (!Number.isFinite(left) || left < 0))) return invalid();
      if (!view().scrollAreas().includes(area)) return rejected('unavailable', 'The requested scroll surface is not mounted.');
      shell.scroll[area] = await view().scrollPanel(area, top, left); return applied({ area });
    }, ['left'], true),
    'win11.shell.dismiss': handler([], ['restoreFocus'], async (_, { restoreFocus = false }) => {
      if (typeof restoreFocus !== 'boolean') return invalid();
      dismiss();
      if (restoreFocus) { shell.focusedControl = { controlId: 'desktop' }; await view().focusControl('desktop'); }
      return applied();
    }, ['restoreFocus']),
  };
}
