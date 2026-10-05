# JesterOS

A simulated desktop and applications for actors to use as screen props during film and television scenes. The default screen is inspired by macOS Mojave (2018); it is not a real operating system or an iMessage client.

Installed profiles span **macOS High Sierra 10.13 (2017), Mojave 10.14 (2018), Sonoma 14.0 (2023), and Windows 11 Pro 23H2 build 22631.2428 (2023)**. Linux remains conditional. Each profile has separately researched native shell/app presentation, assets, and inventories, not a cosmetic theme.

## Current implementation

- Rust/Axum backend serves the built frontend and `GET /api/health`.
- Svelte 5 + Vite renders native macOS menu-bar/Dock desktops or the Windows centered-taskbar/Start desktop, with managed application windows.
- macOS Notes supports plain-text creation/editing, search, pinning, trash, and recovery; other macOS applications except the fixed Messages sample remain launch-only. Windows has ten functional offline simulations: File Explorer, Edge, Notepad, Calculator, Settings, Paint, Photos, Clock, Snipping Tool, and Terminal. Wider researched inventories do not imply implemented workflows.
- macOS Messages retains its sample conversation; its conversation selection, search, message editing/history, menu-bar clock and battery are fixed scene content.
- All visual assets are local. No env files, API keys, database, authentication provider, or internet connection is required to run an installed build.
- Browser-local `jesteros.execute()` supports 32 commands in each macOS profile and 151 in Windows; `jesteros.inspect()` exposes detached state and `jesteros.describe()` publishes typed contracts, capabilities, effects/completion semantics, and live target IDs. See the [implemented command inventory](docs/feature-commands.md). Rust control and further app/menu features remain queued.

## OS profile setup

Open the normal desktop URL for **Mojave**. Select an installed native scene with `?profile=macos-high-sierra-10.13`, `?profile=macos-mojave-10.14`, `?profile=macos-sonoma-14.0`, or `?profile=windows11-23h2-22631.2428`. Unsupported/empty/inherited IDs show a setup error rather than a substitute desktop. Profile metadata, capabilities, local assets/defaults, stock-app coverage, and installed profile targets are inspectable through the browser-local interface.

```js
await jesteros.execute({
  command: 'scene.selectProfile',
  target: { profileId: 'macos-sonoma-14.0' },
});
```

A different profile starts a **fresh native scene**, resetting fictional records, windows, menus, focus and scroll; selecting the current ID retains state. The stable `jesteros` object follows the new scene, including cached controller references. Await selection before issuing dependent commands. Notes timestamps and Windows Clock use fictional profile-local time, never host time. See [profile boundaries](docs/pseudo-os-architecture.md#implemented-profile-boundaries), [High Sierra research](docs/high-sierra-profile.md), [Sonoma research](docs/sonoma-profile.md), [Windows shell research](docs/windows11-profile.md), and [Windows application workflows](docs/windows11-apps.md). Further app coverage and Linux remain queued.

Conditional [Linux research](docs/ubuntu-24.04-profile.md) selects **Ubuntu Desktop 24.04 LTS (original April 25, 2024 release), Ubuntu GNOME 46 session**, not generic Linux or vanilla GNOME. No Linux desktop, app registry, runtime assets or commands are installed; its candidate ID `ubuntu-24.04-gnome-46` is deliberately absent from discovery and rejects as unsupported. The inventory separates Default/minimal, extended and optional apps; exact GA package/snap evidence and visual/rights limits are recorded.

## macOS desktop interactions

- Click a Dock icon, or focus it and press Enter/Space, to open, raise, or restore its application's single window. Repeated activation does not create duplicates.
- Click a desktop icon to select it; double-click or press Enter to open it. Macintosh HD, Personal, Downloads, and Trash open the same Finder window with the corresponding title. Itinerary.pdf opens Preview. These are simulated locations, not host files.
- Click a window to raise and activate it. Drag its title bar to move it within the space below the menu bar and above the Dock. Windows refit when the viewport changes.
- Red closes the window. Yellow minimizes it while retaining its title, position, and zoom state; the Dock or Window menu restores it. Green toggles workspace-sized zoom and the prior normal bounds, without entering browser fullscreen.
- The Window menu closes, minimizes, zooms, or switches to any open/minimized window, including Preview. Arrow keys, Home/End, Enter, and Escape work in the menu. Escape also clears desktop selection; clicking the background focuses the desktop.
- Dock running dots include minimized applications. Finder's dot remains because the desktop is always running. Window state is client-side and resets on reload to the initial Messages scene; it is not persisted or synchronized through Rust.
- Other menus and status items remain static scene dressing.

## Notes

Open Notes from the Dock. The three-pane light UI follows Apple's **macOS Mojave 10.14** Notes guide, not the modern app.

- Use New Note, or **Command-N / Ctrl-N**, then edit the title and multiline body. Changes immediately update the note list; an empty title appears as “New Note.”
- Search filters title/body text in the selected folder, ignoring case and extra whitespace. **Command-F / Ctrl-F** focuses search. Editing a result clears the filter so the same note keeps focus.
- Right-click a note, or focus it and press **Shift-F10**, to pin/unpin or delete it. Arrow keys and Home/End navigate the list and context menu; Escape dismisses the menu.
- Delete moves notes into **Recently Deleted**, where they are read-only. Restore returns them to Notes with their text and pin state retained. Empty collections disable actions that require a selection.
- The toolbar toggles the folder sidebar. Text, selection, search, pin state, and sidebar preference survive minimizing or closing/reopening Notes. **Reload resets the fictional scene**, including edits and deleted notes.
- This is session-local plain text, not iCloud or the host's Notes database. Rich-text formatting, tables, checklists, attachments, sharing, locking, custom folders, and permanent deletion are not implemented; their controls are omitted rather than presented as working.

Primary-source screenshots, UI observations, implementation decisions, defects/fixes, and verification notes are in [Mojave Notes research and working notes](docs/notes-mojave.md).

## Feature backlog

[Pseudo-OS feature backlog](docs/pseudo-os-backlog.md) is the durable queue for long-session work: stable IDs, completed versus pending slices, suggested iteration order, and coverage of the desktop, menus, bundled apps, utilities, System Preferences panes, and secondary dialogs. Additional period-compatible production apps are listed separately. The Rust controller remains deferred.

[Multi-OS and feature command requirements](docs/pseudo-os-architecture.md) define the architecture: every feature must expose transport-neutral commands so actor input and a future WebSocket adapter can invoke the same behavior, including menus, dialogs, transient UI state, and incoming events. Installed native profiles and scene switching use that interface. Remaining app/menu capabilities and WebSocket control are not implemented today.

## Requirements

- Bun 1.4.2 or newer.
- Current stable Rust/Cargo with Rust 2024 edition support; verified with Rust 1.98.1.
- A modern desktop browser. The primary target is a laptop-sized puppet screen.

The first dependency install/build requires internet access. `bun.lock` and `backend/Cargo.lock` capture the dependency versions.

## Run the desktop at localhost:3000

From the repository root:

```sh
bun install
bun run build
bun run start
```

Open **http://localhost:3000**. Rust serves both the desktop and API from one origin. Stop with Ctrl-C.

The backend refuses to serve the desktop if `frontend/dist/index.html` is missing, and prints the build command. Missing static assets return 404; there is no single-page routing fallback.

For a trusted local network:

```sh
bun run start -- --bind 0.0.0.0:3000
```

Open `http://<host-machine-LAN-IP>:3000` from the other device. This build has no authentication; do not expose it to an untrusted network or the public internet.

## Development

```sh
bun install
bun run dev
```

- Frontend with hot reload: **http://localhost:5173**.
- Rust API: **http://localhost:3000/api/health**.
- Vite forwards `/api` requests to Rust on port 3000.

The development backend uses `--api-only`, so no existing frontend build is required. It does not serve the desktop on port 3000 in this mode. Stop both processes with Ctrl-C. Rust source changes require restarting the backend; Vite handles frontend changes automatically.

The two processes can also run separately with `bun run dev:backend` and `bun run dev:frontend`.

## Backend interface

```sh
cargo run --manifest-path backend/Cargo.toml -- --help
```

Options:

- `--bind ADDRESS:PORT`: listening address; default `127.0.0.1:3000`.
- `--frontend-dir PATH`: alternate built asset directory; default `frontend/dist` beside the backend source directory. Explicit relative paths are relative to the invocation directory. Use this option when distributing the binary independently of the checkout.
- `--api-only`: run without static assets, for Vite development.

```sh
curl http://localhost:3000/api/health
# {"status":"ok","service":"jesteros","version":"0.1.0"}
```

Unknown `/api` routes return JSON 404 responses. Unsupported methods on the health endpoint return JSON 405 responses rather than desktop HTML.

## Source layout

```text
backend/
  Cargo.toml         Rust dependencies
  src/main.rs        HTTP server, CLI, health endpoint, static files
frontend/
  src/App.svelte            Profile-bound scene, window lifecycle, command routing
  src/os-profiles.js        Immutable profile identity, capabilities, inventory/assets
  src/profile-adapters.js  Explicit native renderer selection
  src/mojave-adapter.js     Mojave views, font preference, fixture/placement policy
  src/high-sierra-*         2017 profile, native adapter, sample data and scoped styling
  src/HighSierra*.svelte    High Sierra native desktop/icons/Messages views
  src/sonoma-*             2023 profile, native adapter, view mechanics and scoped styling
  src/Sonoma*.svelte        Sonoma native shell/window/Notes/Messages views
  src/windows11-*          23H2 profile, virtual files/apps, native shell and command adapters
  src/Windows11*.svelte    Native Windows shell/chrome and ten application interiors
  src/Desktop.svelte       Mojave menu bar, desktop selection, Dock, Window menu
  src/mojave-applications.js Mojave stock app and desktop-file registry
  src/feature-commands.js   Profile/capability-gated execution and detached queries
  src/command-catalog.js    Typed request/result contracts and effect/completion metadata
  src/command-schema.js     Shared strict JSON Schema builders
  src/desktop-commands.js   macOS desktop/Dock/Window-menu handlers
  src/window-commands.js    Shared window operation handlers
  src/notes-commands.js     Shared Notes data/presentation handlers
  src/Window.svelte         Mojave frame, focus, pointer dragging, content hosting
  src/WindowControls.svelte Mojave close/minimize/zoom buttons
  src/window-state.js       Shared physical clamp/fit/expanded-bounds primitives; explicit scale
  src/windows.css          Mojave window chrome and active/inactive appearance
  src/MessagesWindow.svelte Measured Mojave Messages chrome and conversation
  src/NotesWindow.svelte    Notes toolbar, folders, list, editor, context menu
  src/notes-state.js        Session note data, filtering, ordering, trash/recovery
  src/notes.css             Researched Mojave Notes light appearance
  src/messages-scene.js     Fixed Apple reference scene for visual comparison
  src/AppIcon.svelte        Offline application and desktop icon loader
  src/styles.css           Global styles and responsive desktop placement
  src/messages.css         Source-space Messages geometry and appearance
  src/fonts.css            Local OFL UI/message fonts; native Apple UI font preferred
  public/                  Local wallpaper, icons, message imagery, font, favicon
tools/
  compare-mojave.mjs        Equal-size PNG overlays, difference maps, regional errors
```

## Future controller-to-puppet boundary

The intended flow is **controller device → Rust backend → puppet screen(s) → feature command handlers**. The puppet is the actor-facing desktop; the controller is a separate operator interface. Neither the controller nor its WebSocket transport/protocol is implemented in this iteration. Transport-neutral feature command interfaces are required during pseudo-OS development, before controller integration.

Future operator cues include incoming fictional messages, low-battery notifications, and a simulated zero-battery/power-off appearance. Every feature—not just these cues—must be command-addressable through the shared behavior interface, including app editing/navigation and menu/dialog presentation. Those effects must change the simulated screen only, never the host machine's files, battery, or power state. Actor interactions use the same feature handlers as equivalent remote requests.

Rust should own shared scene/take state and saved messages, with SQLite persistence. WebSockets should deliver state changes to paired screens, acknowledge applied cues, and restore current state after reconnecting. Scenario templates and individual takes should be separate so a reset can begin a fresh take without erasing prior messages. These are design boundaries, not existing endpoints or functionality.

## Artwork

The desktop uses Apple's Mojave Day photograph and detailed pre-Big-Sur application artwork. Messages is reconstructed with DOM text, CSS chrome, SVG controls, and discrete portrait/photo/emoji content assets from Apple's Mojave guide. No complete UI screenshot is rendered as the application, and no Apple font is bundled. Apple retains its artwork rights; public availability and an icon mirror's repository license are not commercial production clearance. Cross-platform typography uses Inter UI and Liberation Sans conversation text under OFL-1.1. See [Mojave fidelity research](docs/mojave-fidelity.md) for primary references, exact provenance, measured comparisons, and remaining differences.

## Verification

The interactive production build was exercised through Rust at localhost:3000 in Chromium at 1440×900, 390×844, and 800×350. Every Dock application launched, deduplicated, and closed. Live checks covered desktop selection/double-click/Enter, Dock Enter/Space, window stacking and drag boundaries, minimize/restore, zoom/restore, minimized-window resizing, Window menu commands/navigation/dismissal, and reload reset. Managed windows stayed above the Dock, including in the short viewport. No broken images, external-origin resources, document overflow, or browser page errors were observed. The Vite build completed without component warnings.

Notes was exercised in the live Rust-served build at the same three viewport sizes: create/edit, case/whitespace search, zero matches, blank-title fallback, Command/Ctrl shortcuts, list/context-menu keyboard navigation, mouse pin/unpin, trash/recovery of entire collections, sidebar toggling, close/minimize retention, drag, zoom, resized restoration, and reload reset. Verification caught and fixed a Svelte rune/prop collision, keyboard focus loss after unpinning, and fractional Dock-height overlap. The final production build has no component warnings or page errors. Evidence screenshots are under ignored `artifacts/notes-mojave/`.

Earlier backend smoke checks covered the health response, unknown API routes, unsupported health methods, root HTML, missing assets, and the missing-frontend startup diagnostic. The combined development command and Vite API proxy were also exercised. The latest health check returned `status: ok`. There is no application UI test suite; `bun test tools/compare-mojave.test.mjs` passes a real-ImageMagick regression for RGB errors, transparent padding, and visible difference maps.

## Visual comparison

The current desktop is at **http://localhost:3000**. The separately served evidence viewer is at **http://localhost:3001**, with a reference-opacity slider and a 4× difference map. It does not add operator/developer UI to the actor-facing screen.

Against Apple's Mojave Messages guide, the exact-size 928×710/DPR-1 browser capture measures **6.854% normalized RGB RMSE**, remeasured after adding window management and Notes and matching the prior static checkpoint's score. That is nonzero, not pixel identity. SF/open-font glyphs, native/browser rasterization, and some original desktop-icon illustrations remain different. Full evidence, asset/rights caveats, comparison commands, and capture instructions are in [Mojave fidelity research](docs/mojave-fidelity.md).

Generated evidence lives under ignored `artifacts/mojave/`; reproduce it after a fresh checkout rather than treating reference screenshots as application UI.
