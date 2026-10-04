# JesterOS

A simulated desktop and applications for actors to use as screen props during film and television scenes. The current screen is inspired by macOS Mojave (2018); it is not a real operating system or an iMessage client.

## Current implementation

- Rust/Axum backend serves the built frontend and `GET /api/health`.
- Svelte 5 + Vite frontend renders a static desktop with a menu bar, desktop files, dock, and sample Messages conversation.
- Clock, battery level, conversation selection, and message history are fixed scene content. Search is disabled and the composer is read-only. Window and dock controls are decorative.
- All visual assets are local. No env files, API keys, database, authentication provider, or internet connection is required to run an installed build.

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
  src/App.svelte            Composes the desktop and Messages scene
  src/Desktop.svelte        Menu bar, desktop files, Dock, window placement
  src/MessagesWindow.svelte Measured Mojave Messages chrome and conversation
  src/messages-scene.js     Fixed Apple reference scene for visual comparison
  src/AppIcon.svelte        Offline application and desktop icon loader
  src/styles.css           Global styles and responsive desktop placement
  src/messages.css         Source-space Messages geometry and appearance
  src/fonts.css            Local OFL Inter fallback; native Apple font preferred
  public/                  Local wallpaper, icons, message imagery, font, favicon
tools/
  compare-mojave.mjs        Equal-size PNG overlays, difference maps, regional errors
```

## Future controller-to-puppet boundary

The intended flow is **controller device → Rust backend → puppet screen(s)**. The puppet is the actor-facing desktop; the controller is a separate operator interface. Neither the controller nor its WebSocket protocol is implemented in this iteration.

Future operator cues include incoming fictional messages, low-battery notifications, and a simulated zero-battery/power-off appearance. Those effects should change the simulated screen only, never the host machine's files, battery, or power state. Actor interactions will remain part of the same simulated applications.

Rust should own shared scene/take state and saved messages, with SQLite persistence. WebSockets should deliver state changes to paired screens, acknowledge applied cues, and restore current state after reconnecting. Scenario templates and individual takes should be separate so a reset can begin a fresh take without erasing prior messages. These are design boundaries, not existing endpoints or functionality.

## Artwork

The desktop uses Apple's Mojave Day photograph and detailed pre-Big-Sur application artwork. Messages is reconstructed with DOM text, CSS chrome, SVG controls, and discrete portrait/photo/emoji content assets from Apple's Mojave guide. No complete UI screenshot is rendered as the application, and no Apple font is bundled. Apple retains its artwork rights; public availability and an icon mirror's repository license are not commercial production clearance. The cross-platform font fallback is Inter under OFL-1.1. See [Mojave fidelity research](docs/mojave-fidelity.md) for primary references, exact provenance, measured comparisons, and remaining differences.

## Verification

The production build and Rust-served desktop were exercised in Chromium at 1440×900, 1280×800, 1024×768, and 390×844. The desktop, Messages window, and dock stayed within the viewport; production assets loaded only from the local origin with no browser errors.

HTTP smoke checks covered the health response, unknown API routes, unsupported health methods, root HTML, missing assets, and the missing-frontend startup diagnostic. The combined development command and Vite API proxy were also exercised. There is no permanent automated test suite yet.
