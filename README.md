# JesterOS

A simulated desktop and applications for actors to use as screen props during film and television scenes. The current screen is inspired by macOS Mojave (2018); it is not a real operating system or an iMessage client.

## Current implementation

- Rust/Axum backend serves the built frontend and `GET /api/health`.
- Svelte 5 + Vite frontend renders an interactive desktop with a menu bar, desktop files, Dock, and managed application windows.
- Messages retains its sample conversation. Other applications open empty window interiors; their application UIs are not implemented. Clock, battery level, conversation selection, and message history remain fixed scene content. Search and message editing are disabled.
- All visual assets are local. No env files, API keys, database, authentication provider, or internet connection is required to run an installed build.

## Desktop interactions

- Click a Dock icon, or focus it and press Enter/Space, to open, raise, or restore its application's single window. Repeated activation does not create duplicates.
- Click a desktop icon to select it; double-click or press Enter to open it. Macintosh HD, Personal, Downloads, and Trash open the same Finder window with the corresponding title. Itinerary.pdf opens Preview. These are simulated locations, not host files.
- Click a window to raise and activate it. Drag its title bar to move it within the space below the menu bar and above the Dock. Windows refit when the viewport changes.
- Red closes the window. Yellow minimizes it while retaining its title, position, and zoom state; the Dock or Window menu restores it. Green toggles workspace-sized zoom and the prior normal bounds, without entering browser fullscreen.
- The Window menu closes, minimizes, zooms, or switches to any open/minimized window, including Preview. Arrow keys, Home/End, Enter, and Escape work in the menu. Escape also clears desktop selection; clicking the background focuses the desktop.
- Dock running dots include minimized applications. Finder's dot remains because the desktop is always running. Window state is client-side and resets on reload to the initial Messages scene; it is not persisted or synchronized through Rust.
- Other menus and status items remain static scene dressing.

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
  src/App.svelte            Window lifecycle, active application, stacking, layout
  src/Desktop.svelte        Menu bar, desktop selection, Dock, Window menu
  src/applications.js       Application and desktop-file registry
  src/Window.svelte         Window frame, focus, pointer dragging, content hosting
  src/WindowControls.svelte Shared close/minimize/zoom buttons
  src/window-state.js       Work-area bounds, responsive fitting, zoom geometry
  src/windows.css          Shared window chrome and active/inactive appearance
  src/MessagesWindow.svelte Measured Mojave Messages chrome and conversation
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

The intended flow is **controller device → Rust backend → puppet screen(s)**. The puppet is the actor-facing desktop; the controller is a separate operator interface. Neither the controller nor its WebSocket protocol is implemented in this iteration.

Future operator cues include incoming fictional messages, low-battery notifications, and a simulated zero-battery/power-off appearance. Those effects should change the simulated screen only, never the host machine's files, battery, or power state. Actor interactions will remain part of the same simulated applications.

Rust should own shared scene/take state and saved messages, with SQLite persistence. WebSockets should deliver state changes to paired screens, acknowledge applied cues, and restore current state after reconnecting. Scenario templates and individual takes should be separate so a reset can begin a fresh take without erasing prior messages. These are design boundaries, not existing endpoints or functionality.

## Artwork

The desktop uses Apple's Mojave Day photograph and detailed pre-Big-Sur application artwork. Messages is reconstructed with DOM text, CSS chrome, SVG controls, and discrete portrait/photo/emoji content assets from Apple's Mojave guide. No complete UI screenshot is rendered as the application, and no Apple font is bundled. Apple retains its artwork rights; public availability and an icon mirror's repository license are not commercial production clearance. Cross-platform typography uses Inter UI and Liberation Sans conversation text under OFL-1.1. See [Mojave fidelity research](docs/mojave-fidelity.md) for primary references, exact provenance, measured comparisons, and remaining differences.

## Verification

The interactive production build was exercised through Rust at localhost:3000 in Chromium at 1440×900, 390×844, and 800×350. Every Dock application launched, deduplicated, and closed. Live checks covered desktop selection/double-click/Enter, Dock Enter/Space, window stacking and drag boundaries, minimize/restore, zoom/restore, minimized-window resizing, Window menu commands/navigation/dismissal, and reload reset. Managed windows stayed above the Dock, including in the short viewport. No broken images, external-origin resources, document overflow, or browser page errors were observed. The Vite build completed without component warnings.

Earlier backend smoke checks covered the health response, unknown API routes, unsupported health methods, root HTML, missing assets, and the missing-frontend startup diagnostic. The combined development command and Vite API proxy were also exercised. The latest health check returned `status: ok`. There is no application UI test suite; `bun test tools/compare-mojave.test.mjs` passes a real-ImageMagick regression for RGB errors, transparent padding, and visible difference maps.

## Visual comparison

The current desktop is at **http://localhost:3000**. The separately served evidence viewer is at **http://localhost:3001**, with a reference-opacity slider and a 4× difference map. It does not add operator/developer UI to the actor-facing screen.

Against Apple's Mojave Messages guide, the exact-size 928×710/DPR-1 browser capture measures **6.854% normalized RGB RMSE**, remeasured after adding window management and matching the prior static checkpoint's score. That is nonzero, not pixel identity. SF/open-font glyphs, native/browser rasterization, and some original desktop-icon illustrations remain different. Full evidence, asset/rights caveats, comparison commands, and capture instructions are in [Mojave fidelity research](docs/mojave-fidelity.md).

Generated evidence lives under ignored `artifacts/mojave/`; reproduce it after a fresh checkout rather than treating reference screenshots as application UI.
