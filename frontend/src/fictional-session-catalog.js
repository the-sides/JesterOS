import { defineCommand, NONE, identity, flag, choice, object, empty } from './command-schema.js';

const profiles = ['macos-golden-gate-27.0.1'];
const menuId = choice('apple', 'users');
const userId = choice('local-alex', 'local-casey', 'guest');
const define = (name, target, payload, requires, presentation, result) => {
  const entry = defineCommand(profiles, `session.${name}`, 'session.fictional', target, payload, requires,
    presentation, ['Only fictional page-local session/user state; original isolated desktops remain mounted except confirmed Guest ending.'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
const retained = 'Retained original desktops, document/editor DOM/data/caret/scroll/window bounds; no host identity, provider, credentials or saved-session storage.';
export const fictionalSessionCatalog = Object.fromEntries([
  define('lock', empty, empty, ['An interactive signed-in desktop.'], [retained, 'Lock retained active user and show native macOS credential form.'], object({ phase: { const: 'locked' }, userId })),
  define('login.open', empty, empty, ['No Guest-end confirmation.'], [retained, 'Present native login user choices; retain and lock current session.'], object({ phase: { const: 'login' } })),
  define('user.select', object({ userId }), empty, ['Login/lock presentation, not desktop or Guest confirmation.'], ['Choose fictional profile; show real credential or Guest acknowledgement form.'], object({ userId })),
  define('login.submit', empty, object({ passcode: { type: 'string', maxLength: 5 }, acknowledgeGuest: flag }, NONE),
    ['Selected local user requires fixed fictional passcode scene; Guest requires acknowledgeGuest:true and no passcode.'],
    ['Incorrect fictional input visibly errors without activation; accepted input prepares/resumes exact isolated original desktop. No password draft retained/published.'], object({ userId, accepted: flag })),
  define('login.back', empty, empty, ['Login/lock, no Guest confirmation.'], ['Return to login choices only; never bypass authentication.'], object({ phase: { const: 'login' } })),
  define('menu.open', object({ menuId }), empty, ['Interactive desktop; actual native invoker visible/connected. Users menu additionally enabled; native menu family matches profile.'],
    ['Show actual native session leaves and focus first enabled item.'], object({ menuId })),
  define('menu.close', empty, empty, ['Interactive desktop.'], ['Dismiss and restore connected real invoker.'], object({ menuId: { oneOf: [menuId, { type: 'null' }] } })),
  define('menu.focus', object({ menuId, itemId: identity }), empty, ['Matching open native menu and real enabled item.'], ['Focus actual menu target; update selection.'], object({ menuId, itemId: identity })),
  define('menu.select', object({ menuId, itemId: identity }), empty, ['Matching open menu and enabled native leaf.'], ['Invoke same lock/login/selected-user/Guest-end action as actor; user choice still requires sign-in.'], object({ menuId, itemId: identity })),
  define('focus', object({ controlId: identity }), empty, ['Actually rendered visible login/lock/Guest-confirmation control.'], ['Focus actual owned control, never inert retained desktop.'], object({ controlId: identity })),
  define('fastUserSwitching.set', empty, object({ enabled: flag }), ['Mac optional menu; bounded page-local toggle, not native Menu Bar settings or administrator privileges.'],
    ['Show/hide native upper-right full-name menu. No Users & Groups/auth privilege implementation.'], object({ enabled: flag })),
  define('guest.end', empty, empty, ['Interactive active signed-in Guest.'], ['Present real delete-at-logout confirmation; retain original inert Guest desktop until decision.'], object({ confirmationRequired: { const: true } })),
  define('guest.respond', empty, object({ accept: flag }), ['Open Guest-end confirmation.'], ['Cancel restores original Guest focus/scroll; accept destroys only Guest desktop/data and returns login choices. Local sessions remain retained.'], object({ accepted: flag, phase: choice('desktop', 'login') })),
]);
