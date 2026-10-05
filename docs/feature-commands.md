# Implemented feature commands

This is the live command inventory, not the list of planned commands. Requirements are in [pseudo-OS architecture](pseudo-os-architecture.md); progress is tracked in the [backlog](pseudo-os-backlog.md).

## Browser-local interface

The mounted desktop exposes `globalThis.jesteros` with:

- `execute(request)`: asynchronous command invocation. Resolves to an applied/rejected result. Applied results wait for the Svelte DOM flush; they do not claim completion of future media/progress animations.
- `inspect()`: a detached snapshot of supported command names and current window/application state. Changing this snapshot does not change the scene.

This is the browser-local feature interface intended for a future transport adapter. It is not a WebSocket endpoint or controller UI. Current support is the Mojave profile only. The interface is removed when its owning App component is destroyed.

Requests contain `command`, optional `requestId`, `target`, and `payload`. Command targets/payloads are plain JSON objects; omitted target/payload become empty objects. Explicit null, arrays, unrecognized request fields, unknown commands, and invalid command arguments are rejected. A supplied requestId must be a nonempty string and is echoed in results.

Results are `{ status: 'applied', target: ... }` or `{ status: 'rejected', error: { code, message } }`, plus requestId when supplied. Validation/unavailable-target failures do not apply a scene mutation. Programming errors are not silently translated into successful cues.

## Inventory

| Command | Target | Payload | Behavior and result |
| --- | --- | --- | --- |
| `app.open` | `{ appId: string }` | `{ title?: string }` | Opens the registered app, or restores/focuses its existing window. Optional title updates the contextual window title. Returns appId/windowId. Unknown apps are `not_found`; unmeasured workspace is `unavailable`; unexpected fields/types are `invalid_arguments`. |

`app.open` is used by Dock app activation, Downloads/Trash activation, and desktop-file Enter/double-click. Existing close/minimize/zoom/drag/Window-menu/Notes commands are not yet in the inventory; their retrofit is `CORE-02`.

```js
await jesteros.execute({
  requestId: 'open-notes-1',
  command: 'app.open',
  target: { appId: 'notes' },
});

jesteros.inspect();
```

No CSS selectors, pixel clicks, credentials, network requests, or host settings are involved in command invocation. App interiors that were already empty shells remain empty; opening an app is not a claim that its future workflows are implemented.

## Working notes

1. **CORE-01 implementation.** Added a small handler registry with request validation, explicit rejections, DOM-settled applied results, and detached inspection. Routed existing Dock/file app-open actions through the same command handler as direct requests. Native UI behavior and artwork are unchanged; existing window-management and Notes research remains applicable ([fidelity](mojave-fidelity.md), [Notes](notes-mojave.md)).
2. **Initial smoke.** Direct app.open created Notes, echoed the request ID, and exposed its state. Unknown commands and the prototype-named app `__proto__` were rejected. Dock reopen and direct restore retained an edited title and produced only one Notes window. No page errors were observed.
3. **Explicit-null argument correction.** The initial smoke found null payload accepted as omitted payload. Omission and explicit null are now distinguished, so null is rejected rather than normalized into a valid request.
4. **Final CORE-01 verification.** The corrected production build rejected explicit-null payloads, array targets, wrong title types, conflicting target fields, unknown commands/apps, and unexpected envelope fields without changing scene state. Actor Dock/desktop actions and direct calls shared app.open; Notes close/direct-reopen retained its edited title, repeated opening did not duplicate windows, and Finder switched Personal → Downloads. Mutating an inspection snapshot did not mutate the scene. The rebuilt Rust-served default desktop was visually inspected at 1440×900/DPR 1; no page errors or build component warnings were observed.
