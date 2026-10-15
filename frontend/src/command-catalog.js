import { MOJAVE_PROFILE_ID, getOSProfile } from './os-profiles.js';
import { defineCommand, NONE, text, identity, flag, number, offset, choice, object, match, empty } from './command-schema.js';
import { windows11ShellCatalog } from './windows11-shell-catalog.js';
import { windows11AppCatalog } from './windows11-app-commands.js';
import { desktopItemContracts } from './desktop-item-catalog.js';
import { desktopContextContracts } from './desktop-context-catalog.js';
import { desktopStacksCatalog } from './desktop-stacks-catalog.js';
import { macDockCatalog } from './mac-dock-catalog.js';
import { macDockFoldersCatalog } from './mac-dock-folders-catalog.js';
import { applicationSwitchingCatalog } from './application-switching-catalog.js';
import { fullScreenCatalog } from './full-screen-catalog.js';
import { spacesCatalog } from './spaces-catalog.js';
import { launchpadCatalog } from './launchpad-catalog.js';
import { dashboardCatalog } from './dashboard-catalog.js';
import { appearanceCatalog } from './appearance-catalog.js';
import { fictionalSessionCatalog } from './fictional-session-catalog.js';
import { fictionalPowerCatalog } from './fictional-power-catalog.js';
import { sceneSeedCatalog } from './scene-seed-catalog.js';
import { savedSessionCatalog } from './saved-session-catalog.js';
import { menuBarCatalog } from './menu-bar-catalog.js';
import { applicationMenuCatalog } from './application-menu-catalog.js';
import { finderFileCatalog } from './finder-file-commands.js';
import { textEditingCatalog } from './text-editing-commands.js';
import { windowExtensionCatalog } from './window-extension-commands.js';
import { helpViewerCatalog } from './help-viewer-commands.js';
import { serviceCatalog } from './service-catalog.js';
import { appleCatalog } from './apple-catalog.js';
import { storageCatalog } from './storage-catalog.js';
import { finderEditingCatalog } from './finder-editing.js';
import { textToolsCatalog } from './text-tools-commands.js';
import { nativeClipboardCatalog } from './native-clipboard.js';
import { viewWorkflowCatalog } from './view-workflow-commands.js';
import { wifiCatalog } from './wifi-catalog.js';
import { batteryCatalog } from './battery-catalog.js';
import { clockCatalog } from './clock-catalog.js';
import { soundCatalog } from './sound-catalog.js';
import { bluetoothCatalog } from './bluetooth-catalog.js';
import { inputCatalog } from './input-catalog.js';
import { spotlightCatalog } from './spotlight-commands.js';
import { notificationCatalog } from './notification-commands.js';
import { notificationWidgetCatalog } from './notification-widget-commands.js';
import { messagesCatalog } from './messages-commands.js';
import { browserCatalog } from './browser-commands.js';
import { mailCatalog } from './mail-catalog.js';
import { contactsCatalog } from './contacts-commands.js';
import { calendarCatalog } from './calendar-catalog.js';
import { callsCatalog } from './calls-catalog.js';
import { remindersCatalog } from './reminders-catalog.js';
import { notesWorkspaceCatalog } from './notes-workspace-commands.js';
import { nativeDomainCatalog } from './native-domain-registry.js';
import { documentDestinationCatalog } from './document-destination-commands.js';

const MAC_PROFILES = [MOJAVE_PROFILE_ID, 'macos-high-sierra-10.13', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1'];
const WINDOWS_PROFILES = ['windows11-23h2-22631.2428'];
const ALL_PROFILES = [...MAC_PROFILES, ...WINDOWS_PROFILES];
const windowTarget = object({ windowId: identity });
const nullableWindowId = { oneOf: [identity, { type: 'null' }] };
const noteTarget = object({ noteId: identity });
const menuTarget = object({ menuId: { const: 'window' } });
const menuItemTarget = object({ menuId: { const: 'window' }, itemId: identity });
const optionalFocus = object({ focus: flag }, NONE);
const folder = choice('notes', 'deleted');
const contextItem = choice('pin', 'delete', 'restore');
const visibleView = 'An existing, non-minimized Notes view; never opened implicitly.';
const currentNote = 'noteId belongs to the current folder/search collection (describe().targets.notes.eligibleIds).';
const requestedFocus = 'focus:true additionally requires the visible Notes view before any data mutation.';
const windowAvailable = 'No profile-native global modal blocks window interaction.';
const define = defineCommand.bind(null, MAC_PROFILES);
const defineShared = defineCommand.bind(null, ALL_PROFILES);
const defineWindows = defineCommand.bind(null, WINDOWS_PROFILES);
const quitContract = defineShared('app.quit', 'app.lifecycle', object({ appId: identity }), empty,
  ['Registered application permits quit; no global modal blocks interaction.'],
  ['Close all application windows through native unsaved-document confirmation; stop its running marker only when complete. Cancel preserves remaining windows.'],
  ['Retain fictional application records according to native close policy.'], NONE, object({ appId: identity }));
Object.assign(quitContract[1].resultSchema.properties, { quit: flag, confirmationRequired: flag });
quitContract[1].resultSchema.required.push('quit', 'confirmationRequired');

export const commandCatalog = {
  ...nativeDomainCatalog,
  ...documentDestinationCatalog,
  ...callsCatalog,
  ...remindersCatalog,
  ...applicationSwitchingCatalog,
  ...fullScreenCatalog,
  ...spacesCatalog,
  ...launchpadCatalog,
  ...dashboardCatalog,
  ...appearanceCatalog,
  ...sceneSeedCatalog,
  ...savedSessionCatalog,
  ...menuBarCatalog,
  ...applicationMenuCatalog,
  ...finderFileCatalog,
  ...textEditingCatalog,
  ...finderEditingCatalog,
  ...textToolsCatalog,
  ...nativeClipboardCatalog,
  ...viewWorkflowCatalog(getOSProfile('macos-golden-gate-27.0.1')),
  ...windowExtensionCatalog,
  ...helpViewerCatalog,
  ...serviceCatalog,
  ...appleCatalog,
  ...storageCatalog,
  ...batteryCatalog,
  ...clockCatalog,
  ...soundCatalog,
  ...bluetoothCatalog,
  ...inputCatalog,
  ...spotlightCatalog,
  ...notificationCatalog,
  ...notificationWidgetCatalog,
  ...messagesCatalog,
  ...browserCatalog, ...mailCatalog, ...contactsCatalog, ...calendarCatalog,
  ...Object.fromEntries([
  defineShared('scene.selectProfile', 'scene.profile-selection', object({ profileId: identity }), empty,
    ['profileId is installed (targets.profiles). Selecting the current profile is idempotent.'],
    ['A different profile disposes the old native scene and mounts a fresh native shell; the stable public API follows it.'],
    ['A different profile resets fictional application records and all window/menu/focus/scroll state.'], NONE,
    object({ profileId: identity })),
  defineShared('app.open', 'shell.apps', object({ appId: identity }), object({ title: text }, NONE),
    ['appId is in targets.applications; workspace dimensions are available; shell presentations do not accept a window title.', windowAvailable],
    ['Reactivate the most-recent application window, including minimized windows, or reopen one retaining fictional app data. Optional contextual title; root focus. A registered shell presentation opens its native overlay without creating, running or activating a managed application window; windowId is null.'], NONE, NONE,
    object({ appId: identity, windowId: nullableWindowId })),
  defineShared('window.create', 'shell.window-create', object({ appId: identity }), object({ title: text }, NONE),
    ['Registered application supports multipleWindows; actual workspace is available; no pending application quit or blocking dialog.', windowAvailable],
    ['Create, activate and focus a fresh independent managed window with a new scene-local ID. Existing windows are unchanged.'], ['Initialize fresh window-local app state; shared fictional records are unchanged.'], NONE,
    object({ appId: identity, windowId: identity })),
  quitContract,
  defineShared('window.focus', 'shell.windows', windowTarget, object({ keyboard: flag }, NONE),
    ['windowId is in targets.windows, including minimized windows.', windowAvailable],
    ['Restore, activate, stack; root keyboard focus defaults true, false preserves native child focus.']),
  defineShared('window.close', 'shell.windows', windowTarget, empty,
    ['windowId is in targets.windows.', windowAvailable],
    ['Close this window only, or present its own native unsaved-document confirmation. macOS keeps the application running; Windows ends its foreground running marker after its last window.'],
    ['Release only this window session; shared records and retained application data follow native close policy.']),
  defineShared('window.setMinimized', 'shell.windows', windowTarget, object({ minimized: flag }),
    ['windowId is in targets.windows; minimizing requires exiting full screen first.', windowAvailable],
    ['Set minimized state; false restores/activates/focuses the root; retain app data and scroll.']),
  define('window.setZoomed', 'shell.macos-window-zoom', windowTarget, object({ zoomed: flag }),
    ['Existing visible, non-minimized, non-full-screen window.', windowAvailable],
    ['Set workspace zoom or restore normal bounds; activate and focus the root.']),
  defineWindows('window.setMaximized', 'shell.windows-maximize', windowTarget, object({ maximized: flag }),
    ['Existing visible, non-minimized, non-full-screen Windows window.', windowAvailable],
    ['Set native workspace maximization or restore normal bounds; activate and focus the root.']),
  defineShared('window.move', 'shell.windows', windowTarget, object({ x: number, y: number }),
    ['Existing, non-minimized, non-expanded, non-full-screen window; coordinates are finite physical workspace pixels.', windowAvailable],
    ['Clamp window position to workspace; no activation.']),
  defineShared('window.resize', 'shell.window-resize', windowTarget, { oneOf: [
    object({ edge: choice('e', 'w'), x: number }),
    object({ edge: choice('n', 's'), y: number }),
    object({ edge: choice('ne', 'nw', 'se', 'sw'), x: number, y: number }),
  ] },
    ['Existing visible normal, non-full-screen window; finite absolute physical workspace edge coordinates.', windowAvailable],
    ['Clamp resized edges to workspace and per-app logical minimums at the current scale; anchor opposite edges. No activation; retain normal logical size through viewport refitting and expansion/restore.'], NONE, NONE,
    object({ appId: identity, windowId: identity })),
  defineShared('desktop.refreshLayout', 'shell.desktop', empty, empty,
    ['Mounted desktop view; actual native workspace dimensions are positive.'],
    ['Measure real browser workspace above native Dock/taskbar; refit normal/expanded windows, including minimized restore geometry; clamp manually positioned desktop items to the actual workspace.']),
  ...desktopItemContracts(MAC_PROFILES, 'desktop', 'desktop', 'files', 'shell.desktop'),
  ...desktopContextContracts(MAC_PROFILES, 'desktop', 'desktop', 'files', 'shell.desktop'),
  define('desktop.info.section', 'shell.desktop', object({ windowId: identity, sectionId: choice('general', 'name') }), object({ open: flag }),
    ['Live managed Get Info utility and native section; no global modal.'],
    ['Set actual native disclosure presentation, retained through minimize/remount.'], ['windows.infoSections'], NONE,
    object({ windowId: identity, sectionId: choice('general', 'name') })),
  define('desktop.folder.navigate', 'shell.desktop', object({ windowId: identity, folderId: identity }), empty,
    ['Live Finder window and simulated folder; no native global modal.'],
    ['Show actual location contents in the exact Finder window; update contextual title and activate the root.'], NONE, NONE,
    object({ windowId: identity, folderId: identity })),
  define('desktop.open', 'shell.apps', object({ fileId: identity }), empty,
    ['fileId is a live entry in targets.desktop.files (including simulated Dock locations); app.open requirements also apply.'],
    ['Open the registered app through app.open; application bundles have no contextual title. Finder shows actual simulated locations; shell bundles present their overlay and return windowId:null.'], NONE, NONE,
    object({ appId: identity, windowId: nullableWindowId, fileId: identity })),
  define('desktop.focus', 'shell.desktop', empty, empty, NONE,
    ['Clear selection and active window, dismiss menus, blur managed-window controls.']),
  define('desktop.focusControl', 'shell.desktop', { oneOf: [
    object({ control: { const: 'file' }, fileId: identity }),
    object({ control: { const: 'window-menu' } }),
    object({ control: { const: null } }),
  ] }, empty,
    ['Mounted desktop control; file identity must be in the actual desktop registry. The Window control requires the native menu bar visible. Native Dock uses dock.focus.'],
    ['Focus semantic control; null only records focus outside desktop controls without moving it.']),
  define('desktop.scroll', 'shell.window-menu', object({ region: { const: 'window-menu' } }), object({ top: offset }),
    ['Window popup is open; mounted desktop view and visible native menu bar.'],
    ['Set actual Window root-popup scroll; Golden Gate retains its clamped level0 offset independently from child panels.']),
  define('menu.open', 'shell.window-menu', menuTarget, {
    ...object({ position: choice('first', 'last'), itemId: identity }, NONE),
    not: match({ position: true, itemId: true }),
  }, ['Mounted Window menu with visible native menu bar; an explicit item must currently be enabled.'],
    ['Open at menu-bar anchor; select/focus first (default), last, or specified enabled item; empty menu selects null.']),
  define('menu.close', 'shell.window-menu', menuTarget, object({ restoreFocus: flag }, NONE), NONE,
    ['Dismiss popup and reset its scroll; restore button focus defaults true.']),
  define('menu.select', 'shell.window-menu', object({ menuId: { const: 'window' }, itemId: { type: ['string', 'null'] } }), empty,
    ['Open popup and visible native menu bar; item is enabled and current; null only when there are no enabled items.'],
    ['Select and focus semantic menu item.']),
  define('menu.execute', 'shell.window-menu', menuItemTarget, empty,
    ['Visible native menu bar and currently enabled item; menu need not be open; shared window-operation requirements apply.'],
    ['Run shared close/minimize/zoom/focus or supported child operation and dismiss popup. Golden Gate restores original focus before open-menu dispatch and keeps canonical action focus; historical and closed-popup Window execution focus the Window button.']),
  ]),
  ...desktopStacksCatalog,
  ...macDockCatalog,
  ...macDockFoldersCatalog,
  ...windows11ShellCatalog,
  ...windows11AppCatalog,
  ...fictionalSessionCatalog,
  ...fictionalPowerCatalog,
  ...wifiCatalog,
  ...notesWorkspaceCatalog,
};
