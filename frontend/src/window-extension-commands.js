import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, NONE, identity, object, empty } from './command-schema.js';

const CAPABILITY = 'shell.window-extensions';
const profiles = ['macos-golden-gate-27.0.1'];
const flags = window => [window.appId, window.minimized, window.fullScreen, window.spaceId, window.utilityKind];
const equal = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

/** Native return tokens remain opaque and never enter discovery or saved state. */
export function createWindowExtensionCommands(ctx) {
  const eligible = appId => ctx.getWindows().filter(window => window.appId === appId && !window.minimized
    && !ctx.isHidden(appId) && !ctx.isQuitting(appId) && ctx.isPresented(window));
  return {
    handlers: {
      'app.bringAllToFront': async (target, payload) => {
        if (!isRecord(target) || Object.keys(target).some(key => key !== 'appId') || !Object.hasOwn(target, 'appId')
          || typeof target.appId !== 'string' || !target.appId || !isRecord(payload) || Object.keys(payload).length)
          return rejected('invalid_arguments', 'Use target.appId and an empty Bring All to Front payload.');
        const appId = target.appId;
        if (!ctx.available()) return rejected('unavailable', 'Dismiss the global modal before grouping app windows.');
        if (ctx.getActiveAppId() !== appId || !ctx.isRegistered(appId))
          return rejected('not_found', 'Bring All to Front belongs to the current installed application.');
        const group = eligible(appId);
        if (!group.length) return rejected('disabled', 'There are no visible, nonminimized app windows in the current Space.');
        const original = ctx.getWindows().map(window => ({ window, flags: flags(window) }));
        const active = ctx.getActiveWindowId(), space = ctx.getActiveSpaceId();
        const focused = group.find(window => window.id === active) ?? group.at(-1);
        const ordered = group.filter(window => window !== focused).concat(focused);
        const focus = ctx.captureFocus();
        const current = () => {
          const windows = ctx.getWindows();
          return ctx.available() && ctx.getActiveAppId() === appId && ctx.getActiveWindowId() === active
            && ctx.getActiveSpaceId() === space && windows.length === original.length
            && original.every((entry, index) => windows[index] === entry.window && equal(flags(entry.window), entry.flags))
            && equal(eligible(appId), group);
        };
        if (!await ctx.prepare() || !current())
          return rejected('unavailable', 'The original application, Space or window group changed before preparation completed.');
        const members = new Set(ordered);
        ctx.setWindows(original.map(entry => entry.window).filter(window => !members.has(window)).concat(ordered));
        ctx.activate(focused.id);
        await ctx.finish(focused.id, focus);
        return { status: 'applied', target: { appId, windowIds: ordered.map(window => window.id), activeWindowId: focused.id } };
      },
    },
    targets: () => ({ appId: ctx.getActiveAppId(), windowIds: eligible(ctx.getActiveAppId()).map(window => window.id) }),
  };
}

export const windowExtensionCatalog = Object.fromEntries([
  defineCommand(profiles, 'app.bringAllToFront', CAPABILITY, object({ appId: identity }), empty,
    ['Interactive foreground local desktop with no blocking File sheet or modal.',
      'appId is the actual installed active application, with a visible nonminimized window in the current Space.'],
    ['Raise all eligible current-Space app windows as one group over other app windows, including represented utilities.',
      'Preserve relative group order except keeping the original active eligible window foremost; otherwise activate the foremost group member.',
      'Do not unminimize, unhide, move Spaces, create windows or change bounds/document records.',
      'Revalidate the original app, Space, window references/order/eligibility after asynchronous preparation; native return tokens stay private.'],
    ['windows order', 'activeAppId', 'activeWindowId', 'switching activation order'], NONE,
    object({ appId: identity, windowIds: { type: 'array', items: identity, minItems: 1, uniqueItems: true }, activeWindowId: identity })),
]);
