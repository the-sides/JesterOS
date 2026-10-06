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
const panel = 'Exact existing connected, visible, interactive native system utility, represented About/Displays/Storage Settings page, or System Information summary panel.';
const opened = object({ appId: identity, windowId: identity });
export const appleCatalog = Object.fromEntries([
  define('system.about.open', empty, empty, [interactive],
    ['Open/reuse the bounded About This Mac utility with installed profile/version and explicit fictional machine identity; focus its real panel. No historical tabbed About interface or host hardware inference.'], opened),
  define('system.settings.open', empty, object({ pane: choice('about', 'displays', 'storage') }), [interactive],
    ['Open/reuse the real System Settings About, read-only fictional Displays, or actual virtual-payload Storage summary; focus its native panel. Other Settings interiors are not synthesized.'],
    object({ appId: { const: 'settings' }, windowId: identity, pane: choice('about', 'displays', 'storage') })),
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
    ['Focus that actual application row before selecting it; stale, foreign and unavailable targets leave selection unchanged.'], object({ windowId: identity, appId: identity })),
  define('app.forceQuit', object({ appId: identity }), empty, [interactive, 'Registered currently running non-Finder application.'],
    ['Close all its local windows without an unsaved-close sheet and clear its running/hidden/quit marker. Retain local Notes/document/Services records and ordinary re-open memory as an explicit simulation recovery policy. No host process termination.'],
    object({ appId: identity, quit: { const: true }, confirmationRequired: { const: false } })),
  define('app.relaunch', object({ appId: { const: 'finder' } }), empty, [interactive, 'Finder is registered and running.'],
    ['Relaunch only the simulated Finder: close its ordinary windows, retain virtual files/system utilities, keep its running marker and recreate its last ordinary Finder window with a new native lifetime. Restore the chooser if open. No shell/browser replacement or data deletion.'],
    object({ appId: { const: 'finder' }, relaunched: { const: true }, windowId: identity })),
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
