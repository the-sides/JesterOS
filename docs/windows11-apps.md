# Windows 11 23H2 represented applications

## Scene and version attribution

The scene selects **Windows 11 Pro, 23H2, build 22631.2428, en-US**, with a fictional local account and October 31, 2023 scene date. This is browser-contained screen-prop software, not Windows running in the browser. Its virtual folders, application documents, arithmetic, drawings, preference changes, local navigation and clock transitions are session state, never host operations.

Microsoft's [September 26, 2023 rollout announcement](https://blogs.windows.com/windowsexperience/2023/09/26/the-most-personal-windows-11-experience-begins-rolling-out-today/) describes the new Settings Home, Paint layers/background removal, Photos background blur, Snipping Tool text actions and controlled feature rollout. It explicitly warns that timing varies by device and market. **An OS build does not uniquely identify independently updated Store app versions.** These represented interiors use period native layout evidence; they do not claim that every installation of this build shipped an identical app revision. Online AI, account, cloud and device features are deliberately not simulated as successful operations.

Notepad needs particular care: Microsoft's [August 31, 2023 announcement, updated September 19](https://blogs.windows.com/windows-insider/2023/08/31/new-updates-for-snipping-tool-and-notepad-for-windows-insiders/) identifies version **11.2307.22.0**, automatic restoration of tabs/unsaved session content, and a setting to turn this behavior off. This scene chooses **session restoration disabled / start a new session** so window-close dirty-document confirmation is truthful for that configuration. Closing an individual dirty tab also asks what to do with its edits. Minimize retains the document tabs and their edits. Confirmed window close resolves every dirty document before resetting tabs to a fresh Untitled session; shared saved virtual files and preferences remain until a fresh profile is created. That screen-prop lifetime is not disk persistence.

## Shared session filesystem

`createWindows11AppState()` in `frontend/src/windows11-app-state.js` owns all ten application models and one `files` collection. Each record has `{id,parentId,name,kind,content,deleted,revision}`. Folder and file identities are stable; filenames are case-insensitively unique within a live parent. User-created IDs are `file-N` with a monotonically increasing session counter. Names reject forbidden Windows characters, control characters, reserved DOS names, trailing periods and leading/trailing whitespace. This is a small virtual filesystem, not an NTFS implementation.

Seed identities:

| ID | Parent | Type / purpose |
| --- | --- | --- |
| `root` | none | Fictional `C:` root |
| `desktop` | `root` | Desktop folder |
| `documents` | `root` | Documents folder |
| `pictures` | `root` | Pictures folder |
| `call-sheet` | `desktop` | Editable `Call sheet.txt` |
| `readme` | `documents` | Editable `Welcome.txt` |
| `studio-photo` | `pictures` | Authored `Studio.svg` fixture |
| `coast-photo` | `pictures` | Authored `Coast.svg` fixture |

`trash` is an Explorer collection, not a writable physical folder. A trashed folder hides its descendants from live file access. Explorer, Notepad, Paint, Photos, Snipping Tool and Terminal share these exact records. Saving never downloads a host file or silently writes browser storage. The two SVG image fixtures are original local illustrations authored for this repository; no screenshots or remotely licensed photography are embedded in the application interiors.

## Parent integration contract

Exports:

- `createWindows11AppState()` and `startWindows11AppClock(apps, invoke)` from `windows11-app-state.js`.
- `createWindows11AppCommands(apps, context)` and `readWindows11AppTargets(apps, getView?)` from `windows11-app-commands.js`.
- `windows11AppCatalog` from `windows11-app-catalog.js`, also re-exported by the command module.
- `Windows11Applications.svelte` props `{appId,profile,native,execute,registerView}`.

The command context supplies `native`, `getWindows`, `getApplicationView`, `focusWindow`, `invoke`, and the parent-owned private `closeWindow(windowId)` primitive for Notepad's confirmed close. Other shared context helpers remain as defined by the shell/adapter contract. `invoke` must dispatch real guarded handlers. `startWindows11AppClock` must run only after that registry exists and return its cleanup to the profile lifecycle. It supplies deterministic single-second `win11.clock.tick` inputs, never reads `Date`, `performance`, OS time, or device power state, and stops on profile teardown.

The shell opens Desktop files through these real reducers:

```js
{command:'win11.explorer.navigate',target:{folderId:'root'},payload:{}}
{command:'win11.explorer.navigate',target:{folderId:'trash'},payload:{}}
{command:'win11.files.open',target:{fileId:'call-sheet'},payload:{}}
{command:'win11.settings.navigate',target:{page:'personalization'},payload:{}}
```

Explorer navigation and application-specific file opening validate the live target before opening/focusing their window and applying data. `win11.files.open` dispatches folders to Explorer, text to Notepad, images to Photos, and rejects unknown/deleted virtual records. Notepad window close is routed to `win11.notepad.requestWindowClose`; a dirty document returns an applied confirmation state **without pretending the window closed**. Save/Discard resolution uses `context.closeWindow`, not recursive invocation of shared `window.close`.

Settings reads **the same** `native.shell.quick` Wi-Fi/Bluetooth/airplane/volume/brightness state and invokes `win11.quick.set {control} {value}`. Its own appearance fields are `native.apps.settings.theme` (`light`/`dark`), `accent` (`#0078d4`, `#8764b8`, `#107c10`, `#d83b01`) and `wallpaper` (`bloom`/`glow`/`flow`). All three wallpaper choices have actual authored desktop appearances; Glow/Flow are local interpretations, not Microsoft wallpaper reproductions. There is no second device model.

Settings search-result navigation clears the query so the destination controls render immediately. Its account label/initials derive from the selected profile (Alex Morgan / AM). Light/dark native dialogs and Bloom/Glow/Flow affect only this fictional scene; no host account, monitor, audio device or wallpaper changes occur.

## Command, target and view conventions

All application descriptors use the common `defineCommand` schema builder, the exact Windows profile ID, and capability `windows.apps`. The same closed target/payload schemas are enforced before reducers execute. Commands return the established `applied`/`rejected` envelope, and stale live records or unavailable presentation targets reject before mutation.

`readWindows11AppTargets(apps,context)` returns detached shared file identities and `applications[appId]:{appId,windows,retained}`. Each live window includes its exact windowId, app data, current/supported menus and dialogs, retained focus/scroll/textSelection, and actual mounted enabled/disabled controls and scroll areas. Minimized/unmounted views and views blocked by global Properties are unavailable presentation targets. View registration and presentation lookup use window ID, not app ID.

Explorer, Edge, Notepad, Calculator, Paint, Photos and Terminal allocate independent models per window. Virtual files and the monotonic file-ID counter are shared; Settings/Quick preferences and Clock remain single scene authorities. App-local commands and the presentation rows below accept optional target.windowId: omission is valid only for an unambiguous single window or retained data model. Multiple windows reject ambiguity before mutation; an explicit ID must belong to the requested app. Actors supply the window that owns the control. Closed IDs cannot target a reopened window.

Shared presentation commands:

| Command | Target | Payload |
| --- | --- | --- |
| `win11.apps.menu` | `{appId,windowId?}` | `{menu:string|null}`; menu must belong to that app |
| `win11.apps.focus` | `{appId,windowId?,control}` | `{}` |
| `win11.apps.focus.observe` | `{appId,windowId?,control:string|null}` | `{}`; observation must match real focus |
| `win11.apps.scroll` | `{appId,windowId?,area}` | `{top,left}`; actual clamped offsets returned |
| `win11.apps.scroll.observe` | `{appId,windowId?,area}` | `{top,left}`; offsets must match the real area |
| `win11.apps.selection` | `{appId,windowId?,control}` | `{start,end}`; integer offsets in current editable text |
| `win11.apps.selection.observe` | `{appId,windowId?,control}` | `{start,end}`; observation must match real selection |

The registered application view exposes `controls`, `focusedControl`, `focus`, `areas`, `readScroll`, `scroll`, `readSelection`, `select`, `hasCaptureSurface` and `captureSurface`. Helpers operate on semantic `data-control` / `data-area` IDs and actual DOM elements; they never mutate document data or manufacture focus success. Hidden/inert controls are not available targets. The wrapper owns identity-safe registration cleanup and observed focus/selection commands. DOM refs, pointer capture and coordinate conversion remain view-local; application state changes remain reducers.

Snipping's source is an **actual mounted Paint canvas**, exported by its exact window view as `{svg,width,height,label}`. `win11.snipping.source {windowId?,sourceWindowId:string|null} {}` and the native source picker select it; `win11.snipping.new {windowId?,sourceWindowId?} {}` can select explicitly. Multiple Paint windows require a source ID instead of silently capturing the first/active canvas. Discovery exposes captureSources and sourceWindowId; its domain selection is the crop rectangle, separate from generic textSelection. A minimized/closed/unavailable source rejects without mutation. Crop/annotation creates a real local virtual image; no host-screen permission or invented absent-surface success.

## Utilities coverage and primary evidence

### Calculator

Microsoft's [Calculator source README](https://github.com/microsoft/calculator/blob/main/README.md) describes Standard mode as basic operations evaluated immediately, with memory and history. Its [manual tests](https://github.com/microsoft/calculator/blob/main/docs/ManualTests.md) supply operation evidence. These continuously updated sources establish behavior, **not an exact pinned October 2023 Store app pixel layout**.

Implemented Standard operations: digits/decimal, chained arithmetic, repeated equals, clear/clear-entry, sign, base-relative add/subtract percent, backspace, reciprocal, square, square root and explicit arithmetic errors. Session memory supports store/recall/add/subtract/clear and individual records; retained history supports recall and clearing. `win11.calculator.key {} {key}`, `win11.calculator.memory {} {action}` and the exported typed specs describe exact live keys/actions. Scientific/programmer/converter modes are not functional launches. Arithmetic uses finite JavaScript numbers and a 15-significant-digit display rather than Microsoft's arbitrary-precision engine.

### Clock

Microsoft's [Clock alarms/timers support](https://support.microsoft.com/en-us/windows/apps/how-to-use-alarms-and-timers-in-the-clock-app-in-windows) documents adding alarms/timers and their continuing to run after closing the app. The current support page is continuously maintained, so it is workflow evidence rather than a frozen 2023 Store app version.

Implemented: one editable named countdown timer with start/pause/reset/completion notice; multiple editable named daily alarms with enable/delete; stopwatch start/pause/reset/laps with split/total; in-app dismissible notifications. Fixed initial fictional time is 09:41:00. `win11.clock.tick {} {seconds}` accepts integer 1–60 while a clock workflow is running; profile scheduling supplies one second per invocation. No host audio, notifications, wake/sleep or time lookup. Focus sessions and world clock are omitted rather than fake buttons.

### Settings

The [September 26, 2023 Windows configuration update](https://support.microsoft.com/en-us/servicing/os/configuration-updates/2023/08/september-26-2023-windows-configuration-update) is dated primary evidence for new Settings Home, Recommended settings and Personalization cards, and its Home/Pro non-company-managed device availability. The fictional local Pro account is compatible with that scope.

Functional sidebar destinations are Home, System, Network & internet and Personalization. Real represented subpages are Display, Sound, Background, Colors and About. `win11.settings.navigate {page} {}` opens/focuses the actual page; search results only target implemented destinations. Settings contains real fictional preference changes for scale/resolution/night light/output/mono audio/notification sounds/transparency/animation/network profile/metered state plus native rename and network-properties dialogs. `win11.settings.preference {control} {value}` has conditional descriptor constraints generated from each control's exact supported schema, enforced before the reducer. Device name and specifications are explicitly fictional; no real Windows Feature Experience Pack value is fabricated. Unsupported accounts/subscriptions, security, power and device-management surfaces are not successful controls.

## Offline browser and media coverage

### Microsoft Edge

The longstanding address bar/tab/History/back/forward behaviors are supported by [Microsoft's Edge keyboard shortcut reference](https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge). This living reference does not pin an October 2023 browser revision; browser-wide host keyboard shortcuts are not claimed.

Four authored local pages are available at `jester://start`, `jester://guide`, `jester://journal`, and `jester://about`. Each tab retains its own address draft and back/forward stack; session history can be opened/cleared. Tab creation/selection/closing are actual state transitions (at least one remains). Unknown addresses reject without navigation; no remote page, network search, account, extension or host download is represented. `win11.edge.navigate {tabId} {address}` is the explicit offline navigation contract.

### Paint

Microsoft's [September 7, 2023 Paint rollout](https://blogs.windows.com/windows-insider/2023/09/07/background-removal-in-paint-begins-rolling-out-to-windows-insiders/) identifies version 11.2306.30.0 and staged Canary/Dev/Beta/Release Preview availability. Its period toolbar/canvas evidence is used without claiming background removal or an exact per-build app version.

The actual 640 × 400 SVG drawing canvas has pen, rectangle and background-colored eraser, real undo/redo, color/size selection, confirmed clear, save-name dialog and real save/revise to shared Pictures. Pointer-owned `win11.paint.stroke.begin/extend/end` commands validate coordinates, stable stroke ID and pointer identity; a tap renders a real dot. `win11.paint.save` writes an SVG virtual image that opens in Photos. Paint's registered `captureSurface()` serializes the **connected mounted SVG element**, not a guessed screenshot. AI/layers/raster-format fidelity are outside the represented tools and have no enabled fake controls.

### Photos

Microsoft's [September 14, 2023 Photos announcement](https://blogs.windows.com/windows-insider/2023/09/14/windows-photos-gets-background-blur-search-motion-photo-support-and-other-enhancements/) documents the period gallery/editing/zoom context, with a September 22 Beta/Release Preview update at 2023.11090.20015.0+. It is rollout evidence, not an exact GA installation manifest.

Photos browses all live shared SVG images, including both fixtures, Paint drawings and saved snips. Gallery/filmstrip selection, previous/next, 25–400% zoom and clockwise rotation retain per-image viewer state. Rotation is a viewer transform, not destructive file editing. Confirmed deletion updates the same file's `deleted`/`revision` fields, so Explorer/Terminal see the real virtual Recycle Bin transition. `win11.photos.open {fileId} {}` validates standalone live SVG content then opens/focuses Photos. Background blur, OneDrive/iCloud, online search, motion photos, video and external editors are omitted.

### Snipping Tool

Microsoft's [August 31, 2023 Snipping Tool announcement](https://blogs.windows.com/windows-insider/2023/08/31/new-updates-for-snipping-tool-and-notepad-for-windows-insiders/) identifies version 11.2307.44.0 and period screenshot/recording toolbar with staged September rollout. The [living Microsoft capture guide](https://support.microsoft.com/en-us/windows/apps/use-snipping-tool-to-capture-screenshots) establishes rectangular drag, annotation, undo and Save as workflows; later OCR/Copilot+ features are not used as 2023 evidence.

`win11.snipping.new {} {}` snapshots the real available Paint SVG. The source can then be selected by bounded coordinates or pointer drag; capture produces a genuinely cropped SVG viewport, not a reported-success placeholder. Validated pen annotations and undo alter that crop. Save creates a shared image containing the crop and annotations, which Photos actually opens. Later Paint edits do not retroactively change a snapshot. Host desktop capture, permissions, camera/microphone, recording, clipboard, OCR and raster export are intentionally absent. Closing/minimizing Paint makes new capture unavailable.

## File workflows and Terminal coverage

### File Explorer

The dated [September 26, 2023 Windows configuration update](https://support.microsoft.com/en-us/topic/542780c2-594c-46cb-979d-11116fe164ba) describes modernized WinUI Explorer Home/address bar/details pane/Gallery; Microsoft's [23H2 feature summary](https://learn.microsoft.com/en-us/windows/whats-new/whats-new-windows-11-version-23h2) establishes Explorer tabs in the period. This local-account simulation does not invent organizational cloud-file recommendations.

Implemented: one folder tab with retained back/forward history; live selection and current-folder filename search; Details/Large-icons views; new folder/text file; rename; recursive copy; cycle-safe move; trash/restore; real properties; native input/confirmation dialogs and actual associated file opening. Root/Desktop/Documents/Pictures are protected fixture folders. Restore checks the original parent and name collisions; copy allocates new IDs for the complete live subtree. `win11.explorer.create {folderId} {name,kind}`, `rename {fileId} {name}`, `copy|move {fileId} {folderId,name}`, and `trash|restore|properties {fileId} {}` act on the shared records. Gallery import/cloud/shell extensions/archive extraction/tab tear-out are not represented.

OS-07 desktop folder drops mutate these same records through an atomic complete-batch plan; they are not filename display changes or a separate move log. Desktop inline rename updates real names/revisions under Windows policy. Actual Explorer destination contents showed the moved file and unchanged 232-character content, and global file mutations while Properties blocked presentation preserved explicitly placed desktop icons after completion.

### Notepad

Microsoft's [January 19, 2023 Notepad tabs announcement](https://blogs.windows.com/windows-insider/2023/01/19/tabs-in-notepad-begins-rolling-out-to-windows-insiders/) identifies version 11.2212.33.0, multi-file tabs and unsaved indicators. The later automatic-session-restore configuration is explicitly discussed above.

Implemented: editable multiple documents; open/activate; actual shared save and save-as; wrapping; native File/Edit/View menus; open/save-as/find dialogs; integer text selection and real next/previous case-sensitive/insensitive find using the mounted editor. Opening an already-open dirty file never overwrites edits. Shared-content baseline checking rejects external-file conflicts and requires explicit Save as, rather than silently losing Terminal changes. Save as creates a new shared text file without overwriting. `win11.notepad.edit {tabId} {content}`, `save {tabId} {}`, `saveAs {tabId} {folderId,name}` and `find {tabId} {query,matchCase,direction}` expose these operations.

Dirty tab/window close is real Save/Don't save/Cancel. A dirty target restores/raises the exact Notepad window before confirmation, including minimized windows; global Properties and unrelated Notepad dialogs reject conflicting close requests without mutation. A new untitled document enters Save as and resumes pending close only after successful save. Results distinguish `{confirmationRequired:true,closed:false}` from final `{confirmationRequired:false,closed:true}`. `app.quit` serializes these guarded closes across all app windows; Save/Discard continues to the next, and Cancel, including Save-as cancellation, clears quitting without deleting remaining edits. Independent windows can edit one shared file; baseline conflict checks prevent either silently overwriting the other's save. Session restore off is visible; no cloud/sync/host-file functionality is implied. Late selection events after teardown are ignored; remount restores caret without focusing another window, then restores its scroll.

### Windows Terminal

Microsoft's [May 24, 2023 Terminal release announcement](https://devblogs.microsoft.com/commandline/windows-terminal-preview-1-18-release/) distinguishes stable 1.17 and Preview 1.18 and documents tab/theme/settings/About concepts with independently distributed Store/GitHub versions. The represented dark/light PowerShell-style interior uses period-compatible structure, not an exact installed package assertion.

Terminal retains window-local virtual tabs, working directory, input/history/output and native Settings/About dialogs. `win11.terminal.input {windowId?,tabId} {input}` then `run {windowId?,tabId} {}` executes its deterministic parser. Commands: `pwd`, `cd`, `dir`/`ls`, `cat`/`type`, `echo`, `mkdir`, `touch`, `copy`, `move`, `rename`, `del`, `restore`, `help`, `cls`. Quoted names, absolute `C:\\` paths, backslashes, `.`/`..` and `echo text > path` work. Quoted `>` and compound-operator text remain literals. Unquoted `&&`, `;`, `|` or `&` reject before any filesystem dispatch, including after redirection; no partial first command executes. `dir trash` includes restore IDs. Mutations invoke shared win11.files.create/rename/copy/move/trash/restore reducers, also used by Explorer, rather than depending on an ambiguous Explorer window or a second filesystem/host process. Collisions, protected folders, bad parents and cycles produce explicit errors.

## Verification boundary

CORE-06 browser evidence exercised all represented app commands: Explorer recursive copy/move/trash/restore and live Desktop discovery; Notepad shared saves/conflicts and Save/Discard/Cancel continuations; Terminal real filesystem round trips and unsupported-syntax isolation; offline Edge navigation; Paint/Photos/Snipping shared SVG/crop/annotation snapshots; Calculator arithmetic/error/memory/history and real scrolling; Settings preferences/search/dialogs; Clock alarms/timers/stopwatch and teardown. Parent final proof confirmed visible minimized dirty-tab/window close, Properties no-mutation barriers, actual Sound search navigation, profile account, readable dark dialogs, distinct Glow, all 24 Calculator keys inside its window and white-on-accent equals hover. Final Paint → shared SVG → Photos and mounted Paint crop capture passed. Terminal quoted `>` saved/read back while four compound-command attempts left the filesystem unchanged. Production build had no component warnings; five domain regressions passed (59 assertions). Fresh lifecycle/browser diagnostics were empty. These are bounded local simulations, not complete Windows applications or real host services.

OS-05 adds conservative logical minimum layouts: Explorer 640×420, Edge 640×460, Notepad 520×400, Calculator 390×520, Settings 900×620, Paint 800×520, Photos 640×480, Clock 640×520, Snipping Tool 680×500 and Terminal 560×400. These are implementation policy, not factory OS measurements. Discovery publishes the per-app values; shared window.resize applies them at current native scale and preserves normal logical dimensions across viewport and caption-state changes. Calculator's full keypad/memory/history controls and Settings Home were visually checked at their minimums.

OS-06 browser evidence proved independent data/presentation in all seven multi-window apps; shared-files save conflicts; global filesystem/Terminal writes with two Explorer windows; actual scoped Calculator keyboard input; native New Window/Exit; last-window marker clearing and retained browser reopen; and dirty group quit with minimized prompts, Save/Discard/Cancel and Save-as cancellation. Actual editor caret and distinct 360/80 scroll offsets survived minimize/remount/maximize restoration without focus theft. Paint source-picker selection and exact mounted red-stroke capture passed; a closed source rejected without mutation, and crop discovery remained separate from text selection. Shared dark Settings propagated to every native window. Wrong owner, ambiguous target, singleton creation and global-modal lifecycle requests rejected without mutation. The clean build, eight domain regressions/68 assertions and fresh empty runtime diagnostics passed.

OS-07 actor/consumer proof adds real desktop multi-selection, native keyboard/marquee/inline rename and group folder drops sharing Explorer/Terminal authority. Real records retained IDs/content, protected/colliding/cyclic batches rejected without partial writes, and created desktop folders remained at their placed physical point after source removal and 390×844 refit. Desktop presentation rejected while Properties was open; shared filesystem mutations remained available and close returned already reconciled actual geometry. Eleven behavioral regressions passed with 88 assertions; strict Windows catalog contains 172 request/result contracts.

OS-08 native desktop menus reuse actual shared create/rename/Trash records; Recycle Bin visibly shows the retained deleted folder, not a success-only label. Complete protected Trash batches prevalidate before revisions/deletion. Properties reads live name/path/kind/content size and follows background file renames while blocking desktop presentation. Personalize opens the real Settings Personalization model. Native hidden-folder creation, grid-aligned group offsets and dense thirteen-icon inline creation passed; restore/empty behavior is not newly claimed for macOS by this Windows coverage.
