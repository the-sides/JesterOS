import { defineCommand, NONE, identity, flag, offset, object, empty } from './command-schema.js';

const profiles = ['macos-golden-gate-27.0.1'];
const define = (name, target, payload, requires, presentation, result) => {
  const entry = defineCommand(profiles, name, 'shell.apple-menu', target, payload, requires, presentation,
    ['Page-local fictional system/window/application state only. No host hardware, processes, power, accounts, network, purchases or files are accessed.'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
const interactive = 'Interactive retained local desktop; no blocking local file sheet or global session/power presentation.';
const panel = 'Exact existing connected, visible, interactive native system utility or System Information summary panel.';
const opened = object({ appId: identity, windowId: identity });
export const appleCatalog = Object.fromEntries([
  define('system.about.open', empty, empty, [interactive],
    ['Open/reuse the bounded About This Mac utility with installed profile/version and explicit fictional machine identity; focus its real panel. No historical tabbed About interface or host hardware inference.'], opened),
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
  define('system.recents.clear', empty, empty, [interactive],
    ['Clear only this account’s Apple-menu application/document history. Preserve files/contents/open timestamps, Dock usage/history, running apps and other accounts. Later openings begin a new history.'], empty),
  define('system.panel.focus', object({ windowId: identity, control: identity }), empty, [interactive, panel, 'control belongs to this actual panel, as published in targets.system.panels.'],
    ['Focus the owned real panel/button; never an unrelated application or a hidden retained user.'], object({ windowId: identity, control: identity })),
  define('system.panel.scroll', object({ windowId: identity }), object({ top: offset, left: offset, observe: flag }, ['top']), [interactive, panel],
    ['Scroll that actual panel and return DOM-clamped offsets. observe:true records its actual native scroll without trusting or applying the requested offset.'], object({ windowId: identity, top: offset, left: offset })),
  define('menu.appleOption.set', empty, object({ enabled: flag }), ['Live Golden Gate host. Holding Option requires an interactive represented menu bar; release is allowed in any live phase.'],
    ['Hold/release the transient Apple-menu Option variant: System Information instead of About and explicit confirmation bypass for Restart/Shut Down/Log Out. Release/blur never revives a menu or changes focus. Not saved with account data.'], object({ enabled: flag })),
]);
