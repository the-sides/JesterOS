import { defineCommand, NONE, identity, flag, offset, object, empty, choice } from './command-schema.js';
import { computerNameSchema } from './system-state.js';

const profiles = ['macos-golden-gate-27.0.1'];
const define = (name, target, payload, requires, presentation, result) => {
  const entry = defineCommand(profiles, name, 'shell.apple-menu', target, payload, requires, presentation,
    ['Page-local fictional system/window/application state only. No host hardware, processes, power, accounts, network, purchases or files are accessed.'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
const interactive = 'Interactive retained local desktop; no blocking local file sheet or global session/power presentation.';
const panel = 'Exact existing connected, visible, interactive native system utility, represented About/Displays/Storage/Wi-Fi/Battery/Menu Bar/Date & Time/Sound/Bluetooth Settings page, or System Information summary panel.';
const opened = object({ appId: identity, windowId: identity });
export const appleCatalog = Object.fromEntries([
  define('system.about.open', empty, empty, [interactive],
    ['Open/reuse the bounded About This Mac utility with installed profile/version and explicit fictional machine identity; focus its real panel. No historical tabbed About interface or host hardware inference.'], opened),
  define('system.settings.open', empty, object({ pane: choice('about', 'displays', 'storage', 'wifi', 'battery', 'menu-bar', 'date-time', 'sound', 'bluetooth') }), [interactive],
    ['Open/reuse real System Settings About, read-only fictional Displays, actual virtual-payload Storage, shared fictional Wi-Fi/Battery/Sound/Bluetooth, immediate Menu Bar controls, or shared-clock Date & Time; focus its native panel. Sound levels/routes and Bluetooth devices/pairing are fictional; master/mute/app gain drives real local Music/QuickTime audio. Other Settings interiors are not synthesized.'],
    object({ appId: { const: 'settings' }, windowId: identity, pane: choice('about', 'displays', 'storage', 'wifi', 'battery', 'menu-bar', 'date-time', 'sound', 'bluetooth') })),
  define('system.machine.rename', object({ windowId: identity }), object({ name: computerNameSchema }), [interactive, panel, 'Exact About Settings computer-name control. Shared complete-seed 4 Mi UTF-16 text budget; name is at most256 UTF-16 units.'],
    ['Commit the literal single-line fictional computer name and synchronize that actual field. Preserve identity/hardware/files/other accounts; invalid input never changes the canonical name. Uncommitted native drafts are not saved.'],
    object({ windowId: identity, computerName: computerNameSchema })),
  define('system.machine.select', object({ windowId: identity }), object({
    start: { type: 'integer', minimum: 0, maximum: 256 }, end: { type: 'integer', minimum: 0, maximum: 256 },
    direction: choice('forward', 'backward', 'none') }, ['start', 'end']), [interactive, panel, 'Exact About Settings computer-name control matching its committed value; range lies within that value.'],
    ['Focus the owned real computer-name field and set/read its actual UTF-16 caret/selection. Invalid, dirty-draft, foreign or obscured targets reject without borrowing another field.'],
    object({ windowId: identity, start: { type: 'integer', minimum: 0, maximum: 256 }, end: { type: 'integer', minimum: 0, maximum: 256 }, direction: choice('forward', 'backward', 'none') })),
  define('system.about.version.set', object({ windowId: identity }), object({ expanded: flag }), [interactive, panel, 'Exact rendered About version control.'],
    ['Reveal/hide installed exact version and explicitly fictional build, with owned window state retained through login/save.'], object({ windowId: identity, expanded: flag })),
  define('system.coverage.open', object({ windowId: identity }), empty, [interactive, panel, 'Exact About Settings Details control.'],
    ['Open/reuse fictional AppleCare coverage details using scene time, with real local support/service article actions. No warranty lookup, purchase, support call or repair booking.'], opened),
  define('system.storage.volumes.set', object({ windowId: identity }), object({ expanded: flag }), [interactive, panel, 'Exact Storage Settings All Volumes control.'],
    ['Show/hide the actual single fictional APFS volume/capacity/available-byte detail; never scan/mount/modify host disks.'], object({ windowId: identity, expanded: flag })),
  define('system.information.open', empty, empty, [interactive],
    ['Open/activate the real System Information read-only scene summary; current fictional hardware, installed software profile and running scene applications. No host report or full diagnostic tree.'], opened),
  define('system.forceQuit.open', empty, empty, [interactive],
    ['Open/reuse a real running-application chooser; select the source application by default. Hidden/minimized applications remain eligible. Finder stays protected and uses Relaunch.'], opened),
  define('system.forceQuit.select', object({ windowId: identity, appId: identity }), empty, [interactive, panel, 'Exact Force Quit utility and currently running registered application.'],
    ['Focus that actual application row before selecting it; stale, foreign, inert and unavailable targets leave selection unchanged. Rows are inert while a confirmation is pending.'], object({ windowId: identity, appId: identity })),
  define('app.forceQuit', object({ appId: identity }), empty, [interactive, 'Registered currently running non-Finder application.'],
    ['Request a window-local confirmation in the actual Finder-owned Force Quit chooser and focus Cancel; do not quit yet. Bind the confirmation privately to this application lifetime and original window handles, not subsequent row selection. Explain real Mac unsaved-loss risk and this scene’s disclosed local recovery policy.'],
    object({ appId: identity, windowId: identity, confirmationId: identity, quit: { const: false }, confirmationRequired: { const: true } })),
  define('app.relaunch', object({ appId: { const: 'finder' } }), empty, [interactive, 'Finder is registered and running.'],
    ['Request a window-local Finder Relaunch confirmation in the actual Force Quit chooser and focus Cancel; do not relaunch yet. Bind the original Finder lifetime and ordinary window handles, excluding system utilities. No shell/browser replacement or data deletion.'],
    object({ appId: { const: 'finder' }, windowId: identity, confirmationId: identity, relaunched: { const: false }, confirmationRequired: { const: true } })),
  define('system.forceQuit.respond', object({ windowId: identity, confirmationId: identity }), object({ accept: flag }),
    [interactive, panel, 'Exact Finder-owned Force Quit utility and its current private confirmation identity.'],
    ['Cancel performs nothing. Accept performs only if the original application remains running with the same lifetime and exact target window handles; stale confirmations never borrow replacement windows or a restarted application. Quit closes its local windows and clears running/hidden/quit markers without an unsaved-close sheet. Retain Notes/document/Services records and ordinary re-open memory as explicit simulation recovery. Finder relaunch closes only ordinary Finder windows, retains virtual files/system utilities, and recreates its last ordinary window with a new lifetime. No host process termination.'],
    object({ windowId: identity, confirmationId: identity, appId: identity, action: choice('quit', 'relaunch'),
      accepted: flag, performed: flag, openedWindowId: { anyOf: [identity, { type: 'null' }] } })),
  define('system.recents.open', object({ category: choice('applications', 'documents', 'servers'), itemId: identity }), empty,
    [interactive, 'Exact item in this account’s corresponding Recent Items history; documents/images and server folders must remain live and servers must be available.'],
    ['Open the actual registered application, virtual document/image, or fictional server’s backing virtual folder. Move only successfully reopened history to the front. Missing, trashed and offline targets do not open a window or fabricate a connection.'],
    object({ category: choice('applications', 'documents', 'servers'), itemId: identity, appId: identity, windowId: { anyOf: [identity, { type: 'null' }] } })),
  define('system.server.open', object({ serverId: identity }), empty,
    [interactive, 'Exact registered available fictional server with a live backing virtual folder. Shared complete-scene history/text and file-open clock budgets apply.'],
    ['Open/reuse the actual Finder window on this local virtual folder and record successful server use. No host/network connection, authentication, mount, download or fabricated remote contents. Server definitions are authored in the complete scene seed.'],
    object({ serverId: identity, folderId: identity, appId: { const: 'finder' }, windowId: identity })),
  define('system.recents.clear', empty, empty, [interactive],
    ['Clear only this account’s Apple-menu application/document/server history. Preserve server definitions, files/contents/open timestamps, Dock usage/history, running apps and other accounts. Later openings begin a new history.'], empty),
  define('system.panel.focus', object({ windowId: identity, control: identity }), empty, [interactive, panel, 'control belongs to this actual panel, as published in targets.system.panels.'],
    ['Focus the owned real panel/button; never an unrelated application or a hidden retained user.'], object({ windowId: identity, control: identity })),
  define('system.panel.scroll', object({ windowId: identity }), object({ top: offset, left: offset, observe: flag }, ['top']), [interactive, panel],
    ['Scroll that actual panel and return DOM-clamped offsets. observe:true records its actual native scroll without trusting or applying the requested offset.'], object({ windowId: identity, top: offset, left: offset })),
  define('menu.appleOption.set', empty, object({ enabled: flag }), ['Live Golden Gate host. Holding Option requires an interactive represented menu bar; release is allowed in any live phase.'],
    ['Hold/release the transient Apple-menu Option variant: System Information instead of About and explicit confirmation bypass for Restart/Shut Down/Log Out. Release/blur never revives a menu or changes focus. Not saved with account data.'], object({ enabled: flag })),
]);
