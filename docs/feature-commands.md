# Implemented feature commands

This is the live command inventory, not the list of planned commands. Requirements are in [pseudo-OS architecture](pseudo-os-architecture.md); progress is tracked in the [backlog](pseudo-os-backlog.md).

## Browser-local interface

The mounted desktop exposes `globalThis.jesteros` with:

- `execute(request)`: asynchronous command invocation. Resolves to an applied/rejected result. Applied results wait for the Svelte DOM flush and capture live scroll positions after focus/anchoring/layout effects; they do not claim completion of future media/progress animations. Await each result when sequencing dependent commands.
- `inspect()`: a detached snapshot of supported command names and current window/application state. Changing this snapshot does not change the scene.
- `describe(command?)`: detached, JSON-serializable version-1 catalog for every command, or one requested command. Includes supported profile IDs, capability, request/success-result JSON Schemas, runtime requirements, data/presentation effects, completion semantics, and current target identities. Unknown names reject with unsupported_command; non-string arguments reject with invalid_arguments. Querying never activates a window or changes the scene.

This browser-local feature interface is intended for a future transport adapter, not a WebSocket endpoint or controller UI. High Sierra 10.13, Mojave 10.14 and Sonoma 14.0 expose 32 reduced-slice commands each; Windows 11 23H2 build 22631.2428 exposes 151 native/shared commands. The public object is stable across native scene remounts; retained references dispatch into the active scene. During transition dispatch/discovery reject unavailable, and inspect reports profile:null/transitioning:true rather than disposed state.

Requests contain `command`, optional `requestId`, `target`, and `payload`. Command targets/payloads are plain JSON objects; omitted target/payload become empty objects. Explicit null, arrays, unrecognized request fields, unknown commands, and invalid command arguments are rejected. A supplied requestId must be a nonempty string and is echoed in results.

Results are `{ status: 'applied', target: ... }` or `{ status: 'rejected', error: { code, message } }`, plus requestId when supplied. Validation/unavailable-target failures do not apply a scene mutation. Programming errors are not silently translated into successful cues.

## Machine-readable catalog

`frontend/src/command-catalog.js` composes the canonical inventory from shared schemas and native shell/app catalogs. Registration requires exact descriptor/handler parity for the selected profile and seals the handler map. Globally known but unsupported names reject unsupported_profile, not unsupported_command; unregistered features are never advertised. Adding a slice must publish its contract in the same change. Keep the human behavior tables and working notes current.

`jesteros.describe()` returns `{ version:1, profile, profiles, commands, targets }`. Active profile metadata and snapshots identify the actual native scene. Profiles list supported IDs; targets.profiles lists installed profile IDs/names/family/version. Each commands entry has:

- `requestSchema`: [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/schema) for the complete command envelope, including closed target/payload objects and conditional argument rules. [Conditional schemas](https://json-schema.org/understanding-json-schema/reference/conditionals) capture paired context coordinates, mutually exclusive menu positioning, explicit pin payloads, and observational focus constraints.
- `resultSchema`: successful applied-response schema. Returned identities are inside **result.target**, never flattened beside status. app.open returns target.appId/windowId; desktop.open also returns target.fileId; notes.create returns target.noteId; scene.selectProfile returns target.profileId. Rejected responses use the shared error envelope above.
- `profiles`, `capability`, `requires`: current profile support and descriptive runtime prerequisites. Dispatch and composed handlers require both the active profile ID and capability; unsupported_profile rejects before mutation. Discovery omits unsupported commands. Schemas validate JSON shape, not current record/menu availability; handlers remain authoritative for scene-dependent rejection.
- `effects.data`, `effects.presentation`, `completion`: record mutation versus selection/focus/menu/window effects, with promise completion after handler state, Svelte DOM flush, and retained native scroll bookkeeping. No current command promises completion of future media/animation.

Targets contain installed profiles, registered apps/coverage, live desktop-file and window identities, and native state-specific targets. macOS exposes minimized/zoomed windows, Window menus and Notes folder/search/deleted identities. Windows exposes minimized/maximized windows plus `targets.native.shell` panels/files/controls/calendar/notifications and `targets.native.apps` shared virtual files, app records, menus/dialogs and mounted controls/scroll areas. `targets.applications` remains the common app array; Windows native per-app discovery does not overwrite it. Hidden/inert views are unavailable presentation targets. Discovery follows file trash/restore, windows and collection changes without activating them; returned snapshots cannot mutate the scene.

```js
const catalog = jesteros.describe('app.open');
const appId = catalog.targets.applications.find((app) => app.name === 'Notes').appId;
const result = await jesteros.execute({ command: 'app.open', target: { appId } });
if (result.status !== 'applied') throw new Error(result.error.message);
const windowId = result.target.windowId;
```

## Inventory

All 32 commands below support the three installed macOS scenes. Unexpected target/payload fields and invalid types are rejected. Window IDs currently equal app IDs; callers should use returned IDs rather than depend on that single-window convention.

### Native scene selection

| Command | Target | Payload | Behavior |
| --- | --- | --- | --- |
| `scene.selectProfile` | `{ profileId }` | `{}` | Selects an installed native profile. Same ID preserves state. A different ID disposes the old scene and mounts fresh native data/windows/menu/focus/scroll state; completion waits for the new DOM and command registration. Unknown IDs reject unsupported_profile before mutation. |

This is profile selection, not migration of incompatible open documents. The default remains Mojave. Subsequent edits/creation use the new profile's fictional Notes epoch, including when its collection is empty.

### Apps and windows

| Command | Target | Payload | Behavior |
| --- | --- | --- | --- |
| `app.open` | `{ appId }` | `{ title?: string }` | Opens or restores/activates a registered app and focuses its root after rendering. Optional title updates contextual titles. Returns appId/windowId. |
| `window.focus` | `{ windowId }` | `{ keyboard?: boolean }` | Restores/activates the window. Keyboard focus goes to its root unless keyboard:false; native child-focus observations use false to preserve caret/input focus. |
| `window.close` | `{ windowId }` | `{}` | Removes the window, preserving application data; chooses the last remaining visible window as active. |
| `window.setMinimized` | `{ windowId }` | `{ minimized: boolean }` | Minimizes or restores/activates/focuses the root. Minimized Notes rejects presentation commands but retains its data and scroll offsets. |
| `window.setZoomed` | `{ windowId }` | `{ zoomed: boolean }` | Sets workspace zoom/restore and focuses the root; minimized targets are unavailable. |
| `window.move` | `{ windowId }` | `{ x: number, y: number }` | Moves a visible normal window, clamped to the work area; physical workspace pixels, finite numbers only. Does not activate a background window. |

### Desktop and Window menu

| Command | Target | Payload | Behavior |
| --- | --- | --- | --- |
| `desktop.refreshLayout` | `{}` | `{}` | Remeasures actual workspace/Dock and refits windows, also used by ResizeObserver. Does not set a fake host resolution. |
| `desktop.select` | `{ fileId: string\|null }` | `{}` | Selects a real desktop item and activates the desktop; null deselects without changing the active app, matching Escape. |
| `desktop.open` | `{ fileId }` | `{}` | Opens the desktop item's app/contextual title through app.open; returns fileId/appId/windowId. |
| `desktop.focus` | `{}` | `{}` | Clears selection, deactivates app windows, dismisses menus, and blurs a window control. |
| `desktop.focusControl` | `{ control:'file', fileId }`, `{ control:'dock', appId }`, `{ control:'dock', itemId:'downloads'\|'trash' }`, `{ control:'window-menu' }`, or `{ control:null }` | `{}` | Focuses an existing semantic control; null records native focus outside desktop controls without moving it. |
| `desktop.scroll` | `{ region:'window-menu' }` | `{ top: number }` | Scrolls an open popup and records the actual clamped offset; finite nonnegative pixels. |
| `menu.open` | `{ menuId:'window' }` | `{ position?:'first'\|'last', itemId?:string }` | Opens at its menu-bar anchor and focuses first/last/specified enabled item. Position/itemId are mutually exclusive. Empty-disabled menus have a null item. |
| `menu.close` | `{ menuId:'window' }` | `{ restoreFocus?:boolean }` | Closes and returns focus to its button by default; false preserves outside/native focus. |
| `menu.select` | `{ menuId:'window', itemId }` | `{}` | Selects/focuses an enabled item in the open popup. Null is allowed only when no enabled items remain. |
| `menu.execute` | `{ menuId:'window', itemId }` | `{}` | Executes a currently available item through shared window handlers, even without opening the popup, then focuses the Window button. |

Window-menu item IDs are `close`, `minimize`, `zoom`, and `window:<windowId>`. Disabled operations reject with `disabled`; removed windows/items reject with `not_found`. File/Dock controls use the current application/desktop registry, not arbitrary DOM selectors.

### Notes data and presentation

| Command | Target | Payload | Behavior |
| --- | --- | --- | --- |
| `notes.create` | `{}` | `{ focus?:boolean }` | Creates/selects an empty active note, clears search, returns noteId. Focus:true requests title focus and requires the window already visible. |
| `notes.edit` | `{ noteId }` | `{ text:string }` | Edits the selected, search-visible active note, clearing search before editing to keep the editor mounted. Deleted notes are read-only. |
| `notes.setPinned` | `{ noteId }` | `{ pinned:boolean, focus?:boolean }` | Sets an explicit value for an active visible record, without changing timestamps. |
| `notes.trash` | `{ noteId }` | `{ focus?:boolean }` | Moves an active visible record to Recently Deleted and reconciles selection. |
| `notes.restore` | `{ noteId }` | `{ focus?:boolean }` | Restores a visible deleted record, remaining in Recently Deleted; empty-result focus goes to New note when requested. |
| `notes.select` | `{ noteId }` | `{ focus?:boolean }` | Selects a record in the current filtered collection; optional row focus. |
| `notes.selectFolder` | `{ folder:'notes'\|'deleted' }` | `{}` | Changes the collection, preserves search, reconciles selection, and dismisses context. |
| `notes.search` | `{}` | `{ query:string }` | Sets normalized case-insensitive title/body search and reconciles selection. |
| `notes.setSidebarVisible` | `{}` | `{ visible:boolean }` | Shows/hides folders and dismisses context; preserves existing native toolbar focus. |
| `notes.context.open` | `{ noteId }` | `{ x?:number, y?:number, focus?:boolean }` | Opens for a current record. Default row anchoring reveals an offscreen row. Optional finite x/y are paired logical-window coordinates for pointer placement; popup is clamped. |
| `notes.context.close` | `{}` | `{ focus?:boolean }` | Closes the live context menu; optional row/New note focus return. |
| `notes.context.select` | `{ item:'pin'\|'delete'\|'restore' }` | `{ focus?:boolean }` | Chooses a valid live context item; optional keyboard focus/highlight. |
| `notes.context.execute` | `{ noteId, item:'pin'\|'delete'\|'restore' }` | `{ focus?:boolean, pinned?:boolean }` | Requires matching live context. Pin requires pinned:boolean; other items reject that field. Uses the same data handlers and closes the menu. |
| `notes.focus` | `{ control, noteId?, folder?, item? }` | `{ observe?:boolean, select?:boolean }` | Focuses a semantic control and activates Notes, with optional text selection. Observe:true records native focus without activation or caret changes. |
| `notes.scroll` | `{ area:'list'\|'editor' }` | `{ top?:number, left?:number, observe?:boolean }` | Applies finite nonnegative offsets, or observes native scrolling; at least one coordinate required. Editor means the body textarea. Records clamped actual offsets. |

Notes controls are `title`, `body`, `search`, `new-note`, `sidebar`, `delete`, `restore`, `row` (+noteId), `folder` (+folder), and `context` (+item). `none` is accepted only for an observe:true focus report. Identity fields are accepted only for the corresponding control; select applies to text controls. Notes records must be in the current folder/search results; editing additionally requires the current selection. These data constraints apply even when the window is closed.

Data-only Notes commands work without opening/activating a window. Focus/context/scroll operations require an existing non-minimized Notes view; they never reopen it implicitly. Hidden-folder controls are unavailable as focus targets. Explicit presentation failures do not create records or change data first. After row removal/reordering, actor context actions focus the remaining row/New note; toolbar actions preserve their native focus.

App/Dock/desktop actions, traffic lights, title-bar dragging, Window-menu navigation, Notes editing/search/sidebar/folder/row/context actions, shortcuts, native focus, and scroll observations all use this interface. Rendering refs, pointer capture, popup geometry, and physical viewport measurement remain internal view mechanics.

```js
await jesteros.execute({
  requestId: 'open-notes-1',
  command: 'app.open',
  target: { appId: 'notes' },
});

jesteros.inspect();
```

No CSS selectors, pixel clicks, credentials, network requests or host settings are required for command invocation. macOS launch-only interiors remain empty; their registration is not future-workflow coverage.

### Windows 11 native inventory

The 151 active contracts comprise seven common scene/app/window/layout operations, Windows `window.setMaximized`, 22 native shell operations, and 121 application operations. Shell groups cover Start/Search, taskbar/file activation, Quick Settings, notifications/calendar, desktop context/Properties, semantic focus and retained scroll. Windows does not support macOS Window-menu/Notes/zoom commands.

Application families are `win11.explorer.*`, `win11.notepad.*`, `win11.terminal.*`, `win11.edge.*`, `win11.paint.*`, `win11.photos.*`, `win11.snipping.*`, `win11.calculator.*`, `win11.clock.*`, and `win11.settings.*`, plus shared `win11.files.open` and `win11.apps.*` presentation operations. Discover exact closed arguments/results with `describe(command)`; use live IDs rather than guessing record names. [Windows shell](windows11-profile.md#shell-command-ids) and [application workflows](windows11-apps.md) document supported behaviors and simulation limits.

`window.close` can return Notepad `{confirmationRequired:true,closed:false}` instead of removal; dirty close restores/raises its window before prompting. Resolve with the native Save/Discard/Cancel command. Global Properties blocks shared app/window and native presentation requests without mutation, while background data/clock operations retain their declared semantics.

## Working notes

1. **CORE-01 implementation.** Added a small handler registry with request validation, explicit rejections, DOM-settled applied results, and detached inspection. Routed existing Dock/file app-open actions through the same command handler as direct requests. Native UI behavior and artwork are unchanged; existing window-management and Notes research remains applicable ([fidelity](mojave-fidelity.md), [Notes](notes-mojave.md)).
2. **Initial smoke.** Direct app.open created Notes, echoed the request ID, and exposed its state. Unknown commands and the prototype-named app `__proto__` were rejected. Dock reopen and direct restore retained an edited title and produced only one Notes window. No page errors were observed.
3. **Explicit-null argument correction.** The initial smoke found null payload accepted as omitted payload. Omission and explicit null are now distinguished, so null is rejected rather than normalized into a valid request.
4. **Final CORE-01 verification.** The corrected production build rejected explicit-null payloads, array targets, wrong title types, conflicting target fields, unknown commands/apps, and unexpected envelope fields without changing scene state. Actor Dock/desktop actions and direct calls shared app.open; Notes close/direct-reopen retained its edited title, repeated opening did not duplicate windows, and Finder switched Personal → Downloads. Mutating an inspection snapshot did not mutate the scene. The rebuilt Rust-served default desktop was visually inspected at 1440×900/DPR 1; no page errors or build component warnings were observed.
5. **CORE-02 implementation.** Added shared desktop/window/Notes handlers and parent-owned semantic presentation state. Components now invoke commands instead of mutating their application/menu models. Registered view helpers perform actual DOM focus, anchoring, and scrolling; direct callers use stable control/record IDs. Background Notes data commands do not activate windows; explicit presentation requests reject hidden/minimized views before mutation.
6. **CORE-02 production proof.** Actor/direct checks covered filtered editing and zero results, keyboard new/search, sidebar visibility, pin idempotency/timestamps, context Home/End/pin/delete/restore, deleted/read-only rejection, empty Recently Deleted focus, retained editor/list scrolling, hidden data creation versus focused-create rejection, and remote keyboard focus transfer. Desktop file selection/Enter, Downloads/Dock activation, Window-menu navigation/minimize/restore/selection/Escape/outside dismissal, empty-disabled menus, and short-popup scrolling were exercised. Twelve invalid/stale/disabled payload/target paths were rejected without state mutation.
7. **Window and viewport proof.** Actor dragging changed Notes from (200,100) to (290,140); direct out-of-bounds movement clamped to workspace. Zoomed move was rejected. A zoomed/minimized window restored after resizing to 390×844 stayed above the Dock (bottom 800, Dock top 800.671875); normal restore geometry fit the new area. 800×350 popup scrolling reported the same actual/model offset and stayed in the viewport. All eleven registered app windows opened through the shared command path.
8. **Semantic anchoring and settled-snapshot corrections.** A default context request for an offscreen note initially left its row hidden and anchored at the toolbar. Default anchoring now reveals the row before measuring; pointer-positioned menus retain their requested placement. Browser scroll events arrive after DOM focus/scrolling, so completed-command settlement captures live offsets. Final proof showed the row visible and list DOM/model scroll both 28. Editor scroll 360 survived minimize/direct reopen, with equal DOM/model offsets. Final context delete/restore retained “Final CORE-02 note.” Default/Notes surfaces were visually inspected; production build had no component warnings and final page-error list was empty.
9. **Final clean-cutover smoke.** Removed duplicate gesture-side boundary decisions: pointer capture computes raw movement, and the shared window handler alone clamps it. An actor drag beyond the viewport reached exactly (672,312), matching the maximum workspace bounds. Final close/direct-reopen retained “Verified final cutover.” All 31 documented command rows matched runtime names and the Markdown tables had valid columns. The final page had zero errors, zero broken images, no external resources, and no document overflow.
10. **CORE-03 catalog proof.** Published all 31 typed contracts and live IDs through describe(). Strict AJV 2020 validation compiled 31 request and 31 success-result schemas; nine invalid coupled-field/number cases were rejected and eight valid cases accepted. Corrected conditional subschemas without suppressing strict checks, then corrected a flat-ID assumption to the actual nested result.target envelope. A real catalog-driven consumer discovered Notes, opened it, created note-5, edited “Catalog-driven cue,” moved the window to (150,90), and selected title text (0,18); request/result schemas accepted the actual responses. Queries were pure, detached and filterable; inherited command names/non-string queries rejected. Eligible IDs followed search → trash → deleted-folder → restore as [note-5] → [] → [note-5] → [], matching record flags. Production build and browser had no component/page errors; the default Mojave/Messages surface was visually inspected and unchanged.
11. **CORE-04 profile-boundary proof.** Scene state/root attributes/describe() identified macos-mojave-10.14 and its eight implemented capabilities; all 31 commands remained available. Stock inventory coverage was explicit. Snapshot edits to app names, wallpaper, Notes data and capability arrays did not alter the scene. All images loaded; runtime fetched no external resources. ImageMagick comparison of pre/post extraction screenshots at 1440×900 DPR1 reported **0 changed pixels**. Browser setup with Windows 11/inherited IDs showed only explicit unsupported-profile information, no desktop/interface; explicit Mojave selection succeeded. Actor-created Notes data survived minimize/zoom/390×844 resize, close/direct reopen, registry file opening and composed Window-menu activation. Real-domain capability regression plus existing image-comparison test: 2 pass, 0 fail (23 assertions). Final production build had no component warnings and browser errors were empty. Native profile and rejection surfaces visually inspected.
12. **CORE-05 native-profile proof.** Installed independently researched High Sierra 10.13 and Sonoma 14.0 alongside unchanged default Mojave. Each profile passed 43 actual applied calls covering all 32 supported commands, with strict request/success-result schema validation. The wider consumer exposed desktop.open's real target.fileId, now included in its closed result schema. Same-profile selection retained exact state; unknown/inherited/empty IDs rejected without mutation. A cached public reference followed fresh remounts; transition inspect reported no active profile, and a concurrent create rejected unavailable with its requestId. New scenes reset records/windows/menu/context state rather than relabeling incompatible data.
13. **CORE-05 native UI and clock proof.** Visually inspected both new Messages/Notes scenes and narrow Sonoma. Actor-created/edited notes stayed in 2017/2023; keyboard Find, Shift-F10/Enter pin and Window-menu activation worked. Sonoma actor drag moved (225.6,122) to clamped (285.6,135), and native minimize/Dock restore/zoom survived 390×844 resizing. All profiles restored minimized normal geometry within their own workspace while retaining records and editor scroll. Profile-local Notes clock regression covers edits and creation from an empty collection; Sonoma initial latest note matches its 17:42 fictional menu clock. All registered icon/wallpaper/font URLs returned local image/font content; final default had zero broken images/external resources/page errors. Final 1440×900 DPR1 default comparison measured **0 changed pixels**; production build had no component warnings; three behavioral regression tests passed with 27 assertions. High Sierra guide-only white icon surrounds were removed; asset fidelity/rights limits remain explicit in native research.
14. **CORE-06 native Windows proof.** Installed Windows 11 Pro 23H2 build 22631.2428 with independent shell/chrome, ten functional offline app simulations, authored local assets and source-bounded inventories. All 151 active names were exercised in actual browsers; strict AJV compiled their request/result schemas and validated applied evidence. Shared files connect Explorer/Notepad/Terminal and Paint/Photos/Snipping; Settings and Quick Settings share one authority. Fixed zero-height desktop layout, selected-profile registry parity, inherited/live identity boundaries, coupled Quick schemas, Calculator clipping/hover, Settings search/account/dark dialogs and distinct Glow. Reproduced and fixed post-teardown Notepad selection warnings, inert-Properties false window focus, and hidden minimized dirty-close confirmation. Final actor/direct proof covered native keyboard/drag/caption/taskbar, dialogs, retained scroll, invalid/no-mutation paths and 390×844/800×350 refit. Terminal compound operators reject before mutation while quoted operators remain literal. Fresh final lifecycle had no warnings/page errors/broken images/external requests; all local SVG/font URLs returned correct content. All three macOS profiles again passed 43 calls/32 names; default screenshot comparison had zero changed pixels. Production build had no component warnings; five regressions passed with 59 assertions. Rust transport, host services and wider app coverage remain deferred.
