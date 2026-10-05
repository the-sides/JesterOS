# Multi-OS profiles and remotely triggerable features

## Status and scope

Today JesterOS implements parts of the Mojave desktop and 31 shared browser-local app/window/desktop/Window-menu/Notes commands with detached state inspection. The [implemented command inventory](feature-commands.md) distinguishes current commands from future app/menu capabilities. OS-profile switching, universal future-feature coverage, and WebSocket control transport are not implemented. The [feature backlog](pseudo-os-backlog.md) tracks the work. Project terminology is in [CONTEXT.md](../CONTEXT.md).

Build the actor-facing pseudo-OS first. **Implement feature command interfaces as part of that work; defer the Rust controller, WebSocket transport, server state, and persistence.** Deferring transport must not mean burying feature behavior in click handlers that later require a second implementation.

## OS profiles

JesterOS will support multiple operating-system families and versions:

- **macOS across different years/releases**, with Mojave 10.14 as the first profile. Additional releases must reproduce their own era, not apply new colors to Mojave.
- **Windows 11**, with a researched release/build and its own desktop shell, applications, menus, dialogs, terminology, keyboard conventions, and assets.
- **Linux possibly later**. Choose a specific distribution, desktop environment, and version when that work starts; “Linux” alone does not define one UI.

An OS profile defines the shell and app inventory, supported capabilities, version-specific presentation and behavior, shortcuts, local assets, and relevant hardware/region configuration. Its identity is part of the scene. Version/build distinctions matter when they change visible interfaces or available features.

Share genuinely common simulation data and operations—virtual files, contacts, scene time, notifications, app/window identities—where semantics match. Keep OS-specific shell behavior, app interfaces, and adapters separate. For example, Finder and File Explorer can use the same virtual files without sharing their menus or window layout. Do not assume every Windows/Linux profile has a Dock, Finder, iCloud, or Mojave-style preferences.

Select a profile when setting up a scene. Initially switching profiles may start a fresh profile-specific scene; live conversion of open windows/documents is not required. Do not silently carry incompatible app/view state across profiles. Additional macOS releases and Windows 11 are planned; Linux remains a candidate rather than a committed next milestone. Exact release targets require later research.

## Every feature exposes commands

Every implemented action and externally observable state transition must be reachable through a **transport-neutral feature command interface**. This includes app data, shell behavior, and temporary presentation state—not just operator effects such as incoming messages.

The execution path is:

1. Actor input or a future controller requests a named command with explicit arguments.
2. The shared feature handler checks whether the command is supported and valid for the targeted scene/profile/state.
3. The handler applies the simulation change and any specified presentation effects.
4. The caller receives an explicit result; the UI renders the resulting state.

The future WebSocket adapter will decode requests and call this same interface. It must not synthesize DOM clicks, call private component functions, duplicate app logic, or require an operator to know CSS selectors/pixel coordinates. Pointer gestures and text input may have UI-local mechanics, but their meaningful outcomes must have command equivalents.

### Required coverage

| Surface | Examples of command-addressable behavior |
| --- | --- |
| Shell and windows | Launch/focus/quit apps; create/close/minimize/restore/move/resize windows; select desktop items; switch Spaces; lock/wake/power presentation. |
| Menus and panels | Open/close a named menu or submenu, select an item, execute its command, show/dismiss Spotlight, Notification Center, popovers, inspectors, and auxiliary windows. |
| Dialogs | Present a specific sheet, edit its fields, choose a button, confirm/cancel, and expose the resulting state. A modal must not make a feature inaccessible to remote commands. |
| App data | Create/edit/select/search/delete/restore records, type/set a draft, send/receive messages, change recipients, open/save/export files, navigate pages/tabs, and edit documents. |
| Preferences and devices | Change supported settings, simulated network/device/account states, battery level, clock, appearance, permissions, and connected/disconnected states. |
| Media and timed effects | Play/pause/seek, start/stop supported recordings or operations, present incoming calls/alerts, and advance or complete scene-timed transitions. |

Temporary UI state must be addressable where it matters to a shot: visible menus, selected tabs, focused controls, search queries, selections, scroll positions, playback position, modal state, and progress/completion states. Target a semantic control or content position, not a CSS selector. Animation frames, caret blinking, and other rendering internals do not need individual commands; their meaningful start/stop/configuration does.

### Feature contract

For each backlog slice, document and implement:

- Stable command names and JSON-serializable payloads. Use semantic operations such as `messages.send`, `notes.edit`, `window.move`, or `menu.open`, not an unrestricted `setState` escape hatch.
- Explicit stable targets where necessary: scene/profile, app, window, document, record, menu, dialog, or control identity. Never rely on DOM order, component references, or whichever window happens to be active unless that is the command's documented meaning.
- Supported profiles/capabilities, required state, and behavior when a target is missing, locked, read-only, busy, or blocked by a modal.
- The resulting data changes and presentation effects. Data-only changes must not steal focus or open windows implicitly. Commands representing actor-visible actions must specify any focus/window effects.
- An inspectable result: applied or rejected, relevant target/new-record identities, and a reason for rejection. An asynchronous operation must distinguish accepted/started from completed; submission alone is not proof that a cue is visible.
- Observable resulting state or semantic outcome events, so a future controller can inspect what happened without reading the DOM. Commands request changes; outcome events report changes. Do not let incoming events bypass the feature handlers.

Prefer explicit desired values where appropriate, such as `notes.setPinned(true)` rather than a toggle whose result depends on unseen state. Actor controls must call the same handlers as equivalent remote requests. A menu command and its keyboard shortcut must not maintain separate implementations.

A received message can update an inactive conversation and raise a notification without focusing Messages. Opening that conversation is a separate presentation action. Similarly, remote note edits do not gain permission to alter a deleted/read-only record merely because they were not typed by the actor. Use a separately defined scene-setup operation when a different capability is genuinely required.

### Illustrative request — not a finalized wire protocol

```json
{
  "requestId": "cue-104",
  "command": "messages.receive",
  "target": {
    "sceneId": "scene-1",
    "appId": "messages",
    "conversationId": "conversation-1"
  },
  "payload": {
    "messageId": "message-104",
    "senderId": "contact-2",
    "text": "I'm outside."
  }
}
```

These names and IDs illustrate the contract only; this request is not accepted by the current build. The eventual transport can wrap feature requests with protocol-version, routing, and acknowledgement metadata without changing feature behavior. Socket connection lifecycle, delivery/reconnect semantics, authorization, and multi-screen synchronization belong to the deferred controller phase.

## Delivery requirements for this phase

- Introduce the command entry point with a working existing feature, not an empty framework. Retrofit the current desktop/window/Window-menu and Notes actions; their existing UI checkmarks do not imply command coverage.
- Every new or modified feature slice includes its commands and relevant presentation controls before it is marked complete. The universal interface is a requirement now, even though a socket client is not built now.
- Exercise the actual UI and invoke the equivalent commands directly through the browser-local interface. Inspect state and the visible result; include unavailable/invalid-target paths and non-active-window behavior where relevant.
- Publish a command inventory per implemented slice with payloads, targets, availability, result/state semantics, and supported profiles. Research future profiles independently; unsupported commands must be explicitly rejected, not silently ignored or translated into unrelated actions.
- Keep all effects in JesterOS: no host files/processes/settings, real networking/accounts/payments, or actual power/device control. Remotely requested features have the same simulation boundary as actor input.

No WebSocket endpoint, Rust command router, operator UI, or multi-OS runtime is implemented by this document.
