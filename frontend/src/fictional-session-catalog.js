import { defineCommand, NONE, identity, flag, choice, object, match, empty } from './command-schema.js';

const profiles = ['macos-golden-gate-27.0.1'];
const menuId = choice('apple', 'users');
const userId = choice('local-alex', 'local-casey', 'guest');
const define = (name, target, payload, requires, presentation, result) => {
  const entry = defineCommand(profiles, `session.${name}`, 'session.fictional', target, payload, requires,
    presentation, ['Only fictional page-local session/user state; preserve local document records. Accepted reopen choice controls local windows; departing Guest logout discards only its ephemeral root.'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
const retained = 'Retained original desktops and autosaved Notes/Services records; no host identity, provider, credentials or saved-session storage.';
export const fictionalSessionCatalog = Object.fromEntries([
  define('lock', empty, empty, ['An interactive signed-in desktop.'], [retained, 'Lock retained active user and show native macOS credential form.'], object({ phase: { const: 'locked' }, userId })),
  define('login.open', empty, empty, ['No logout confirmation.'], [retained, 'Present native login user choices; retain and lock current session.'], object({ phase: { const: 'login' } })),
  define('user.select', object({ userId }), empty, ['Login/lock presentation, not desktop or logout confirmation.'], ['Choose fictional profile; show real credential or Guest acknowledgement form.'], object({ userId })),
  define('login.submit', empty, object({ passcode: { type: 'string', maxLength: 5 }, acknowledgeGuest: flag }, NONE),
    ['Selected local user requires fixed fictional passcode scene; Guest requires acknowledgeGuest:true and no passcode.'],
    ['Incorrect fictional input visibly errors without activation; accepted input prepares/resumes exact isolated original desktop. No password draft retained/published.'], object({ userId, accepted: flag })),
  define('login.back', empty, empty, ['Login/lock, no logout confirmation.'], ['Return to login choices only; never bypass authentication.'], object({ phase: { const: 'login' } })),
  define('menu.open', object({ menuId }), {
    ...object({ position: choice('first', 'last'), itemId: identity }, NONE), not: match({ position: true, itemId: true }),
  }, ['Interactive desktop; actual shared native invoker visible/connected. Users menu additionally enabled.'],
    ['Switch the single shared menu provider; focus first, last or explicit enabled item. Failed native setup restores prior menu/focus.'], object({ menuId })),
  define('menu.close', empty, object({ restoreFocus: flag }, NONE), ['Interactive desktop.'],
    ['Dismiss shared session popup; restore connected invoker unless restoreFocus:false.'], object({ menuId: { oneOf: [menuId, { type: 'null' }] } })),
  define('menu.focus', object({ menuId, itemId: identity }), object({ observe: flag }, NONE), ['Matching shared open provider and real enabled item.'],
    ['Focus actual owned menu target; observe:true records existing native focus without moving it.'], object({ menuId, itemId: identity })),
  define('menu.select', object({ menuId, itemId: identity }), empty, ['Matching shared open provider and enabled native leaf.'],
    ['Dismiss and restore original desktop focus before canonical Apple/user action; user choice still requires sign-in.'], object({ menuId, itemId: identity })),
  define('focus', object({ controlId: identity }), empty, ['Actually rendered visible login/lock/logout-confirmation control.'], ['Focus actual owned control, never inert retained desktop.'], object({ controlId: identity })),
  define('fastUserSwitching.set', empty, object({ enabled: flag }), ['Mac optional menu; bounded page-local toggle, not native Menu Bar settings or administrator privileges.'],
    ['Show/hide native upper-right full-name menu. No Users & Groups/auth privilege implementation.'], object({ enabled: flag })),
  define('logout', empty, object({ confirm: flag, reopenWindows: flag }, NONE), ['Interactive signed-in local or Guest desktop; finish or cancel pending export/settings work and commit native input first. Guest cannot request reopenWindows:true.'],
    ['Confirm by default in a real Cancel/Log Out surface, with a local-user Reopen windows checkbox. Default to the local preference; Guest always discards its ephemeral root. confirm:false is explicit Option/chord intent and bypasses only the action confirmation.',
      'Reopen changes windows, never autosaved local document records. Persist the local choice only after accepted exit; Cancel preserves preferences, data and original desktop focus. No fabricated Save/Don’t Save editors or host logout.'],
    object({ confirmationRequired: flag, userId, phase: choice('desktop', 'login'), reopenWindows: flag })),
  define('logout.configure', empty, object({ reopenWindows: flag }), ['Owned visible local-user logout confirmation and real logout-reopen-windows checkbox; unavailable for Guest.'],
    ['Change only the transient pending checkbox choice. Cancel never persists it or closes windows.'], object({ reopenWindows: flag })),
  define('logout.respond', empty, object({ accept: flag }), ['Open logout confirmation owned by the current signed-in user and visible matching action control; accepted exit must still be safe.'],
    ['Cancel restores that original account’s desktop focus/scroll and preferences. Acceptance signs out only that account, preserves local records, and retains or closes its windows according to the choice. Guest accept destroys only its ephemeral root. A blocked commit leaves the confirmation intact.'],
    object({ accepted: flag, userId, phase: choice('desktop', 'login'), reopenWindows: flag })),
]);
