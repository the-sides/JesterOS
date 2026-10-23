# JesterOS

JesterOS simulates operating-system desktops and applications for actors to use as film and television screen props.

**Active implementation target (October 22, 2026):** pause sequential OS/application expansion and build the separate paired controller. The first milestone is an operator-authored incoming Messages cue, acknowledged by a puppet screen on another device, with live conversation updates back to the console. The initial Rust WebSocket relay, explicit pairing and `/?controller` UI are implemented. Existing OS acceptance counts below remain historical checkpoints; controller work does not complete OS backlog items.

## Current accepted checkpoint — October15, 2026

Messages `MSG-01`–`MSG-10` complete; `MSG-02`–`MSG-10` accepted on all five installed profiles.69/286 backlog items are checked,217 unchecked. Next sequential item is `SAF-01`. Earlier stop instructions/counts below are historical and superseded by the active scope above; deferred section3 dialogs and STATUS-07/08 remain outside it.

The completed slice adds typed preference/Details navigation, complete attachment-target preview/menu/PDF/audio presentation and original message actions. Real Files chooser/drag/drop, bytes/associated opens, emoji/caret, reactions/copy/delete, account/group confirmations and local incoming/source-linked notifications pass native browser checks. All share the original Messages/Contacts/Files/clipboard/notification owners. Send availability shares actual Contacts and duplicate-thread resolution; repeated attachment IDs cannot route to another message. Windows initial banner bounds are measured after the original scene root binds. Location, audio recording substitutes, server membership and personal Teams release geometry remain disclosed simulation boundaries.

Focused Messages:183 tests/1,626 assertions pass. Broader regression split across tools and frontend:3,055 pass,59 fail and1 error, matching the preexisting failure/error count; those unrelated failures remain open. Production frontend build passes with existing Svelte and bundle warnings. Live catalogs include broader unaccepted application work (Golden2172/HS1974/Mojave1980/Sonoma1967/Windows1995); they are not an acceptance checklist. See docs/messages-native-research.md and the dependency-injected native browser runners in tools/messages-{menus,details,workflows}.browser.mjs.

## Language

**OS profile**:
A specific operating-system family, release/era, and optional hardware or regional configuration reproduced by JesterOS. Mojave 10.14 and Windows 11 are different profiles, not alternate color themes.
_Avoid_: Skin, theme when referring to an entire OS

**Profile capability**:
A simulated behavior or surface currently available in an OS profile. Native features not yet reproduced by JesterOS are outside that profile's capabilities.

**Puppet screen**:
The actor-facing simulated desktop and its applications. It depicts the selected OS profile rather than operating the host computer.

**Controller**:
The separate operator-facing interface used to direct puppet screens. It is not an application inside the simulated desktop.

**Scene**:
The fictional environment shown on a puppet screen, including its OS profile, accounts, files, conversations, devices, and time.

**Take**:
An individual run of a scene during which actor actions and operator cues change the simulated state.

**Operator cue**:
An instruction to make a particular change or presentation occur on a puppet screen, such as receiving a message, opening a dialog, or showing a low battery.

**Simulated application**:
A program depicted inside a scene, with its own fictional records and running state. It can remain running without an open window when the selected OS profile uses that lifecycle.
_Avoid_: Host process

**Managed window**:
An individually movable, resizable and closable scene surface belonging to a simulated application. Closing one window is not the same action as quitting its application.
_Avoid_: App when referring to one of its windows

**Application quit**:
The scene action that closes an application's windows and ends its running state, subject to any unsaved-document confirmation. It never terminates a host program.

**Active application**:
The simulated application supplying the foreground menus and application shortcuts. In a macOS scene it can remain active and running after its last window closes.

**Shared menu owner**:
The Golden Gate host's single transient provider/path/selection/actual-scroll state, separate from retained app/authentication data. Apple/users are host providers; application/command/Window providers belong strictly to the actual active app. Native panels render live enabled/checked rows and report actual focus/clip ownership. Historical profiles keep their private menu implementations.

**Menu return token**:
An opaque original editor/selection/scroll capture kept across heading switches, never public or saved. Escape/Tab/explicit dismissal returns to the invoker; leaf execution restores the original before canonical dispatch and keeps the action's resulting focus. Failure restores prior popup/path/scroll/focus; interruption may capture the original through its owning scene, never a popup row or guessed selector.

**App command provider**:
A represented File/Edit/Format/View/Go/Conversation/History/Bookmarks/Help tree identified by both menuId and active appId. Availability comes from real current selection/document/window/native-input state, not a second selection model. Canonical actions are reused; queued workflows stay disabled. A disabled final highlight recovers to the first enabled row or empty panel; an invalid ancestor closes the path. Window entries are app-owned, not a global window roster.


**Simulated desktop item**:
A scene-visible entry backed by a fictional file/folder record or a declared native system shortcut. Its selection, rename, layout and folder drop never operate on the host desktop or filesystem.

**Desktop selection**:
An ordered collection of live desktop item IDs with an independent range anchor. It is not keyboard focus, the active application, or the active managed window.

**Desktop context tree**:
The native menu for a clicked desktop item or background, with canonical enabled/checked actions, focused item and expanded submenu IDs. Its file target is distinct from the preserved multi-item selection; it never performs host desktop actions.

**Finder utility window**:
A managed Get Info or Desktop view-option window associated with Finder, not a folder-browser location. Its live metadata/disclosures/options and lifecycle are scene state; opening a real folder must not reuse it as a browser.

**Desktop Stack**:
A derived presentation group of real desktop document IDs, not a folder or synthetic filesystem record. Its expanded members, browsed cover and context selection continue to refer to the original files; folders remain individual.

**Fictional file time**:
A monotonic scene timestamp in the selected OS era, advanced by actual simulated file events rather than host time. Null metadata is unknown, not Unix epoch zero.

**Dock alias**:
A session-local launcher reference to an installed simulated application or a real simulated folder. Keeping/removing an alias changes neither source records nor application/window lifetime; a running unpinned app alias survives until quit. Folder aliases occupy the file side and reference existing directory IDs, not copied contents.

**Dock recent history**:
A newest-first, unique application-use sequence advanced by successful scene app opens/new windows, never host time. Mojave/Sonoma/Golden Gate show up to three unpinned recent aliases; High Sierra does not. Initial entries are fictional scene seeds, not observed host usage.

**Minimized Dock tile**:
A presentation of an actual minimized managed window, with its live inert interior and an independent exact-window restore control. It is not another application instance, a screenshot, or an app-running marker. Minimize-into-app and App Exposé can own presentation instead without changing retained window data/geometry.

**Dock preferences**:
Scene-local size, magnification, auto-hide, minimize-into-app and supported recent-app values shared by native controls and commands. An auto-hidden Dock reserves zero workspace even while temporarily revealed; magnification never changes base workspace reservation or host settings.

**App Exposé**:
A browser-contained overview of one application's actual managed windows, including minimized windows. It projects original live surfaces without rewriting normal/restore geometry; overview selection is distinct from actual window activation.

**Dock folder stack**:
A fan/grid/list popup showing one real folder's current immediate children, with a root alias, actual parent path, focused control and retained physical scroll. It is distinct from a Desktop Stack: nested navigation uses real folders, and file opening invokes the existing file command. More changes only the current fan presentation, not its configured view.

**Trash occupancy**:
The empty/full presentation and count derived from the existing simulated Trash's deleted records. It is not host Trash state, a second file store, or an implemented restore/empty lifecycle.

**Application switcher**:
The macOS scene's frozen, selectable MRU strip of running application identities, including hidden, all-minimized and zero-window apps. Browsing is not activation; activation unhides an app without reopening or restoring minimized windows.

**Window switcher**:
The Windows scene's frozen roster of actual managed-window identities. Cards project the original inert application surfaces, not screenshots or duplicate instances; activating a card restores that exact minimized window.

**Hidden application**:
A running macOS application whose entire window group is temporarily invisible and inert. Its documents, views, minimized state and normal/restore geometry remain retained. Hiding is distinct from closing, minimizing or quitting.

**Window cycling**:
Immediate activation in stable scene creation order, skipping hidden/minimized/quitting frames. macOS cycles only the active application's windows; Golden Gate additionally skips auxiliary utilities, while historical macOS preserves its existing utility eligibility. Windows cycles all eligible managed windows. This order is independent of activation MRU and Dock recent history.

**Full-screen stage**:
A page-contained projection of an original managed window, independent of normal/restore bounds and zoom/maximize state. Its retained membership is `window.fullScreen`; temporary menu/caption and launcher reveal never changes host fullscreen, display settings or Dock preferences.

**Split View pair**:
A macOS presentation group of two original full-screen managed windows with left/right identities and a retained divider ratio. Background groups survive activation changes. The candidate picker selects existing windows, not duplicate application instances; cancellation restores prior membership.

**Ordinary desktop HOME**:
A stable scene-local desktop ID owned by every macOS managed window independently of its normal/restore geometry, visibility, minimized state and full-screen membership. Moving HOME neither activates the destination nor copies a document.

**Presentation Space**:
An ordinary desktop or a derived solo-full-screen/Split View entry in the Mac Spaces strip. Full-screen groups derive exclusively from retained window flags and `presentation.splitViews`; they do not own a second membership model.

**Mission Control**:
A page-contained current-desktop overview of original inert managed windows and a Spaces strip. Its preview desktop, frozen survivor order, selected control and independent physical scroll are distinct from foreground ownership and active Space. Cancellation restores connected original focus/caret; desktop deletion migrates HOME owners rather than closing them.

**Launchpad**:
A macOS shell presentation for registered installed simulated apps. It does not allocate a managed window, become the active application, add a running indicator or advance application MRU/recent use. Generic activation returns a null window identity.

**Launchpad arrangement**:
Persistent main pages and nonnested folder membership with each eligible app present exactly once. Moving a tile changes arrangement, not application-bundle records, document lifetime or filesystem parents. Empty folders dissolve; single-member folders remain.

**Launchpad folder draft**:
Transient inline name input distinct from the retained folder name. Invalid commits preserve the draft and expose validation; cancellation preserves the name. Editing/jiggle does not authorize uninstalling readonly built-in bundles.

**Captured presentation invoker**:
The actual focus owner at shell entry. Native Dock activation captures its focused button; direct entry with an original editor focused captures that editor/caret. Restoration never substitutes a cloned editor or a guessed pre-click focus owner.

**Dashboard**:
A classic macOS collection of small task-specific widgets, presented over the desktop or in a separate workspace. Turning it off removes access, not the retained widget collection. It is distinct from Notification Center's Today widgets and Sonoma desktop widgets.

**Dashboard widget instance**:
One independently configured and positioned clock, calculator, calendar, weather or conversion tool. Adding another instance does not share its calculator memory, selected date or configuration; removing it does not uninstall a host application.

**Fictional widget reference time**:
The explicit civil-time reference used by Dashboard clocks, calendar Today and offline forecast dates. Visible clock ticks advance that reference; host date/time is never authoritative. Weather observations and currency rates remain fictional samples even when unit/date calculations are real.

**Appearance preference**:
The active profile's manual light/dark policy, control accent and independent text highlight. High Sierra dark applies only to menu bar/Dock; Windows retains native Settings as its sole authority. An appearance change is not an OS-profile change or document reset.

**Control accent versus text highlight**:
Accent tints controls, active selections and focus; highlight colors selected text. An actual accent change resets highlight to its corresponding preset; repeating the same accent preserves independent highlight. This idempotent edge is declared browser policy.

**Bounded custom highlight**:
A six-digit sRGB color edited by in-page RGB sliders/Hex, not the complete native Colors panel. Invalid drafts do not alter canonical color; clean focused drafts follow external custom-color changes without losing caret, while a preset removal returns focus to the surviving Highlight control.

**Fictional session**:
A page-local local/Guest identity and lock/login presentation, not host authentication. Only Golden Gate advertises this capability. Fixed local users retain separate original desktop/model/editor/appearance instances; inactive roots are inert and do not own global app shortcuts or the document palette.

**Retained session return**:
Restoring connected original focus/selection and all retained scroll offsets after the same desktop becomes interactive. It never reopens or copies the editor; menu invocations may correctly return to their original invoker. Capture/restore is owned by its scene root, not a document-global selector.

**Ephemeral Guest**:
A new isolated fictional desktop entered after explicit deletion acknowledgement. Cancelled logout/power confirmation retains the original; confirmed logout or accepted restart/shutdown destroys only Guest's scene. Re-entry starts fresh and does not discard retained locals. Actual FileVault, credentials, user administration and saved sessions remain outside this simulation.

**Fictional power phase**:
Page-local awake/saver/sleeping/off/booting state. Saver/sleep immediately lock an interactive desktop; waking consumes its initiating input without authentication. A signed-out login presentation remains signed out. Power progression changes neither the host clock nor the shared authored scene instant.

**Retained local power cycle**:
An accepted restart/shutdown signs out every fictional user and retains local model records/appearance; only Guest is discarded. Accepted checked reopening retains original native windows/editor/caret/scroll. Unchecked reopening closes real native views and non-Finder running/hidden markers, returning zero windows on sign-in. Five deterministic startup seconds return unsigned login choices. Power applies the choice to all retained local roots as an explicit simulator policy; unfinished exports, pairing/quit and uncommitted native input block exit, including explicit bypass.

**Power return token**:
An opaque scene-owned original desktop or credential-surface focus/selection/scroll capture. Cancel restores the connected original, including private credential drafts kept mounted inert behind confirmation. No credentials are published in inspection or serialized state.

**Scene seed baseline**:
A complete, validated version-1 scene fixture across all five installed profiles, including original application/native-domain graphs, Notes/files/printing/editing/viewing/communications/system/Messages/appearance and the closed persistent-Dock record. Each fictional user clones it independently. Required closed data has explicit defaults; older incomplete V1 fixtures reject before disposal, never silently merge. Genuine Files keep their native kind and application/icon associations; Windows volume-root drive names retain their actual drive-letter ownership and its empty Mac-Dock pins are not a copied taskbar authority. Detached inspection/discovery exposes this initial baseline, not current edits or a saved session; generated read-only app bundles and immutable profile identity remain separate.

Incoming notifications and original call/stock/news/clock/message delivery ledgers travel together through full scene projection and rehydration. Embedded Notifications Settings selects the original Preferences session through its controller, not a copied window field; the retained window/session/view/scene clock must authorize the real commit. Acknowledged source changes remain applied after presentation retirement, while uncommitted or same-ID replacement sources cannot authorize shared notification-policy writes.

**Complete scene replacement**:
Browser-local setup through `scene.reset` or `scene.replaceSeed`, without actor controls. Validate before disposal; replace all local/Guest roots, queues, menus, drafts and timers, then acknowledge only after a fresh awake desktop and Messages registration/DOM are ready. Outgoing queued work rejects unavailable. Reset clears only the Golden Gate saved-session slot before restoring the default fixture; a storage failure preserves the live scene. Replacement does not merge, save, clear the existing slot or invoke host services.

**Retained ordinary app view**:
The last ordinary closed window's title, normal/zoom restore geometry, bounded Finder location/selection or Settings pane and owned native scroll/selection/focus token. App data remains root-owned. Reopen allocates a new ID on the current ordinary desktop; utility closure does not replace this memory, and fresh window creation does not reuse it. Semantic selection applies only to the matching note and clamps to current content; focus applies only to an available owned control.

**Explicit saved local session**:
A closed, validated version-1 browser-origin-local snapshot of the initial seed baseline and all retained local users' current models, open/remembered windows, Dock order, generated-file timestamps, Spaces/Split View and static semantic view tokens. Guest, credentials, signed-in state, power and transient presentation are excluded. Save/load are never automatic; explicit restore disposes originals and returns an awake signed-out login after every saved root is ready. Clear changes storage only; scene reset clears the slot and restores defaults. This is not Rust/controller persistence or authentication.

**Application utility**:
An app-owned Golden Gate About or represented Settings managed window, distinct from an ordinary document. One owner/kind identity; ordinary allocation/remembered geometry and native view are never consumed by its creation or closure. Hide/Show/Quit includes it. Original source return focus is opaque and scoped to its retained local root; explicit snapshots store utility scroll, never editor-carets or raw tokens.

**Notes preferences**:
Required closed Golden Gate seed data `{sortBy,groupByDate,textSize}` driving actual pinned-first ordering, deterministic UTC date sections and editor typography. Title sorting hides the date-group control while retaining its value. Pixel bounds/date cutoffs are disclosed simulation policy, not factory defaults; each fictional local profile remains independent.

**Task-relevant local service**:
The application-menu Services child and contextual actions share a relevance-filtered registry over actual selected Notes/sample/service text, virtual files and saved contact endpoints. Opaque per-root source IDs bind original native ownership/data/revision/range. Finish fallible real destination preparation before allocating a note/draft; readonly sources remain unchanged. Explicit Done/Send Locally creates identified contact/immutable fictional outbox records. Empty applicability renders No Services Apply. Original offline definitions and attachment snapshots are local simulation behavior, not an asserted factory inventory, live inbox or host registry.







**MENU-06 delivery / next slice**:
Current Golden Gate discovery has248 typed commands, including10 View additions. Source recorded76 validated Applied requests and rebuilt Rust26; all10 new names apply, and248 request/Applied-result schema pairs compile strictly. Native Notes Gallery/New/Return/zoom preserve actual document/caret/history; Finder four modes, Column browsing, folder preference/window chrome independence and owned nonmodal Options work. Complete authored seeds, two-local saved View state, unavailable retained-folder chrome recovery, Guest logout and atomic incomplete-input rejection pass. Forty historical requests preserve whole inspect/DOM/native focus and178/170/163/190 catalogs;1402 historical schemas compile.342 tests/4078 assertions and557-module build pass, with zero page errors/failed local requests and inspected light/dark320×240 surfaces. The backlog has40 completed original items/246 remaining; continue MENU-07 next. Earlier proof counts remain historical.

**Bounded File document workflow**:
Golden-only `shell.file-workflows` connects actual Notes New/Close/Duplicate/Markdown/PDF/Print and Finder current-child selection/New Folder/subtree Duplicate/Open/Get Info to canonical commands. Notes autosaves, with no fake Save/Open Recent; imports are intentionally disabled because flat plain-text records cannot represent native Imported Notes folders/formats. New focuses actual title and ordinary retained geometry; duplicate preserves entire source text into an unpinned selected copy without consuming About utility memory. Launch-only app interiors remain launch-only.

**Owned transient File pane**:
Exact dialog/ordinary Notes window/source identity with native contained focus/Tab, cancel/Escape/Command-W, physical inner files/preview scroll and inert underlay. Draft name/folder/tags/range/copies never serialize. Save as PDF from Print returns to exact Print options on cancel. Busy cancellation and lock/unlock invalidate captured pending output leases; stale source/menu/dialog IDs never retarget files. Focused Notes/window/app mutations and saving all retained local roots reject while a pane exists, including inactive-root panes. Automation scopes exact data-file-dialog-id and owner/user roots, not generic dialog roles or hidden substring matches.

**Virtual PDF and print archive**:
Real Markdown escaped title/full body and embedded Liberation Sans PDF use existing virtual files only, with TextEdit/Preview association and explicit collision replacement preserving identity/creation metadata. Lazy pdf-lib/fontkit shares A4 preview/output pagination; unsupported glyphs reject honestly. Imported archive canonical base64/PDF header/footer checks are bounded envelope validation, not full PDF parsing. Printing V1 `{nextJobId,jobs}` retains immutable selected-page PDF/copies/progress and terminal archives independently per root, included in complete seeds and explicit local saved sessions. Limits1024 jobs/pages,99 copies,1Mi base64/title per job and4Mi aggregate string/key units across the complete persistent seed; safe counter/Date limits also apply. Explicit all-local saved sessions separately retain their2Mi envelope limit. Actual foreground-awake one-second FIFO worker and pause/resume/cancel/advance share the queue, never a mirror; Studio Printer is fictional, with no host IO/download/physical printer.

Primary27 Notes inputs: [create/edit](https://support.apple.com/guide/notes/create-and-edit-notes-not9474646a9/4.13/mac/27), [import/export/print](https://support.apple.com/guide/notes/import-export-and-print-notes-not201900c07/4.13/mac/27). Exact19-command schemas, printing fields, results and live discovery are recorded in [feature commands](docs/feature-commands.md#menu-04--bounded-golden-gate-file-workflows).

**Scene clipboard and logical histories**:
Golden-only `shell.edit-workflows` binds the original mounted control/window/note/revision/UTF-16 range. One private root clipboard is empty/text/files; native menu/keyboard/clipboard events never use host clipboard or synthetic input. Title/body share per-note transactions; Search and owned Find/spelling drafts retain separate histories. Text budget64 transactions/4Mi before+after values; Finder global deltas64/8Mi with exact leases, safe ancestry/collision/quota checks and monotonic IDs/time/revisions. Creation/rename/move/trash undo preserves unrelated records and reconciles actual open Finder locations. Static readonly application graph IDs are trusted runtime identities, not mutable-seed identities.

**Owned plain-text language tools**:
Inline Find is literal full raw note text with Unicode case/word options, one-transaction replacement and true native field selection/scroll. Count/navigation/All include every match; decoration alone caps500. English en-US Hunspell loads lazily; long words above128 UTF-16 units skip dictionary suggestions. Live underlines, conservative completed-word autocorrection, per-note Ignore, root-local Learn/Unlearn and literal noncascading replacements are real. Grammar/smart links/AI/rich-text-only features are honestly disabled. Original note/revision/preferences/focus leases revalidate after readiness; committed data cannot become a rejected result because post-render focus disappeared.

**Persistent editing versus transient draft ownership**:
Required closed V1 `editing` contains five booleans, learnedWords and replacements; independent local saves retain these, not clipboard/history/ignored/find/panes/drafts. At most1024 learned words (128 units each) and1024 distinct literal pairs (from1..128/to0..4096), plus existing seed4Mi/saved-envelope2Mi limits. Missing editing rejects before disposal; no old-V1 shim. Save-name/tags and Desktop-rename bridge canonical existing draft setters using exact surface/owner/value/selection. Raw CSV remains stable through Edit focus; cancelling/replacing a sheet cannot borrow an old token. Only application Edit is enabled during an editable Save sheet.

**MENU-05 runtime evidence and limits**:
Source601 literal matches navigate to index600/native body2400..2403/scroll9705 despite500 decorations; All replaces601 literals. Native body smart/autocorrect caret18 and multiline title normalization caret11 pass. Alex/Casey restore distinct learned words/replacements; Guest is fresh and ignored/clipboard/history reset. Real dictionary request aborts show failed/readonly autocorrection without data writes; disabling restores typing, failed re-enable leaves false, clean reload corrects colour to color at caret6.320×240 panels close back to original Find query; new controls follow fictional appearance, not host media queries. Final production light/dark smoke has zero page errors. Dictionary notices `/licenses/dictionary-en.txt` are MIT/BSD; nspell2.1.5 MIT notice is retained in the assistance module. Exact32 schemas are in [feature commands](docs/feature-commands.md#menu-05--golden-gate-edit-workflows).

**Owned View model**:
Golden-only `shell.view-workflows` persists required closed `viewing`: Notes last-used mode/count/folder-sort override/per-note zoom and Finder complete per-folder preferences. Notes ordinary windows retain List/Gallery/detail presentation; only the represented primary document window is supported. Finder ordinary windows own `finderPresentation` flags and `finderBrowseMode`; unconfigured locations preserve current browsing mode, configured folder choices override it. Missing locations still retain real chrome and can recover via Sidebar. Hiding Toolbar forces Sidebar off and moves visible Status to top. Exact original source/value leases repeat after preparation; native focus tokens stay private and cannot retarget replacement panes/roots.

View Options is one transient, owned nonmodal DIV dialog with monotonic IDs, native focus and bounded native scroll, omitted from seeds/saves. Actual icon-size input ArrowRight96→97 and Command-J/Escape pass; represented pane scroll clamps0/0 because there is no overflow at exercised sizes. Gallery cards contain real note text; hidden editors are not Edit sources. Zoom steps50/75/100/125/150/175/200% change rendering only. Root zoom/folder maps cap1024; complete-seed4Mi and explicit saved-envelope2Mi remain separate. Unsupported attachments/customization/inherited Always Open policies stay unavailable. Primary27 links and exact10 contracts are in [View command inventory](docs/feature-commands.md#menu-06--owned-golden-gate-view-workflows).

**Golden Gate Window group**:
`shell.window-extensions` adds only `app.bringAllToFront`, bringing discovery to249. Exact current installed/running app ownership and current-Space visible/nonminimized members define the group, including represented auxiliaries. Original eligible active stays foremost; native desktop ownership falls back to the existing foremost member. Other order/data/bounds/flags/Spaces remain unchanged. Original app/window/Space/order/reference/eligibility leases repeat after preparation; private focus tokens never become public or persistent.

Window Next/Previous reuses ordinary-only `window.cycle`; actual utility rows remain app-owned and ordinary utility actions are unavailable. Notes main-window Command-0/Window entry reuses `app.open`, preserving ordinary retention without inventing a second document. Existing V1 window order already persists group stacking; no new persistent field or compatibility alias is introduced.

49 Source Applied and112 rebuilt Rust records (104 Applied/8 separately asserted rejections) pass. Native grouping caret223–225 backward, main-window retention, Space isolation, desktop fallback and save/restore order are observed. Public concurrent requests serialize successfully rather than exercising stale preparation; controlled regression contexts cover those guards.249 Golden schema pairs/1402 historical schemas compile; four unsupported historical calls are atomic and historical utility/global cycling remains. Actual light/dark320×240 CSS-viewports/DPR1.25 and inner wheel4→183 were inspected; clean replay errors/local failures are zero, with one initial instrumentation error separately retained.347 tests/4116 assertions and558-module build pass.

**MENU-08 / preceding delivery**:
Golden discovery is259: three canonical host `menu.help.*` commands and seven Root-local `help.viewer.*` commands under `shell.help-workflows`. `help-menu-model.js` derives literal AND results from live current-app providers, not a parallel command registry. Disabled leaves remain locatable but nonexecutable. Existing `app.commandMenu.execute` restores original focus, rechecks exact current request/owner and retains the leased Help query projection while teardown clears visible search state. The readonly exact-parent preview has explicit narrow fitting, not claimed native factory placement.

`help-content.js` is original offline simulation documentation for every installed app, including truthful launch-only/fixed-sample limits. The nonmodal `GoldenGateHelpViewer` is private transient Root UI, not an installed app or managed window. Its controller leases pane/app/view across native preparation, bounds history128, retains actual scroll and dismisses on owner/root cutover. Earliest Root capture routes viewer CmdF/CmdW/Escape ahead of ordinary app shortcuts; late search-key continuations require the same popup/menu/app/query. Private focus handoff preserves the invoking editor through lock, and no Help field enters closed V1 state.

259 strict schema pairs;89 Source records (81 Applied/8 rejections),223 Rust records (208 Applied/15 rejections), five final Rust replay requests, and40 atomic historical Unsupported calls are recorded. Real nested actions changed Notes sorting/gallery; Topic opens notes-files; CmdW preserves ordinary windows and body220–225 backward in Source/155 in Rust. Actual Source save/restore omits the open pane, requires login and retains the body range; the temporary slot was cleared. Narrow x4/y32/w312/h159 and real article180/Back retention, bounded history and inspected Light/Dark pass. Original failures remain in proof; clean Source four rapid click/Enter replays and final Rust replay have zero page errors.366 tests/4363 assertions and565-module warning-free Svelte build pass; chunk advisory remains. Next: `MENU-09`.

**MENU-09 / preceding delivery**:
Golden discovery is273. `service-registry.js` supplies both menu/context leaves; `service-sources.js` owns opaque actual native source leases; `service-commands.js` owns15 canonical names under `shell.services-workflows`. The old Notes-specific `app.service.perform` shape is removed, not aliased: `{appId,serviceId,sourceId}`, empty payload. Discovery exposes live sources/items/providers/sample text IDs/lookup/context; canonical records are detached at `inspect().state.communications`, not duplicated in transient discovery.

`communication-state.js` owns required complete Golden V1 `{timeBase,nextId,contacts,drafts,outbox,selected}` with atomic detached candidate validation, one allocation counter, monotone clocks/revisions and immutable virtual attachments. Records are independent of ordinary window lifetime. Mail/Contacts are limited local-services workspaces; Messages keeps its fixed sample mounted while separate real service entries are shown. Inputs follow native single-line constraints; body/Notes remain exact multiline text. Root preparation is private, never durable data; background Lock rollback restores committed window/Dock/Spaces state in place without replacing controller-owned state objects or restoring over another actor's foreground. Session capture uses the committed source presentation rather than a pending candidate.

Actual source/shipped15-name and ten-action workflows,273 strict schema pairs, readonly source copying, native app-menu/context/file dispatch, contact addressing, real local sent records, deleted-source attachment independence and actual native-lock interruption pass. Source and shipped saved caret2–9 backward/scroll20 restore after login; two-local records remain independent and Guest disposal resets only Guest. Inspected Light/Dark and360×400/320×240 popovers fit; CmdF/Escape/CmdW preserve original ownership. Sixty historical Unsupported requests preserve full inspect/DOM/focus/storage and original catalogs.393 tests/4867 assertions and577-module build pass without Svelte warnings; clean final shipped page errors/failed or external requests are zero. Sources and bounded simulation policies are linked in README. Next sequential item is APPLE-01.

**APPLE-01 / previous checkpoint**:
Golden discovery is283. `apple-menu.js` projects all ten ordered entries; `apple-commands.js` supplies nine actual root actions, `apple-catalog.js` ten schemas including host-owned transient `menu.appleOption.set`. Modern System Settings naming/entry behavior is27-sourced; exact ordering/separator continuity uses26 imagery and is marked inference. Option alone is permitted by the Apple native provider. The shared menu leases selected Apple request identity before restoring focus, preserving bypass/System Information intent through modifier release.

Required closed Golden V1 system now contains computerName/storage plus `{recentItems:{applications,documents,servers},servers}`, with independent newest-first ten-entry histories per local root. `system-state.js` validates safe dense unique IDs/registered apps and registered server history. Live document/image rows resolve names/filter trash; fictional server rows resolve actual backing folders (APPLE-04 below). Clear preserves definitions/Dock/files/open metadata and old timestamps cannot revive entries. Explicit cold restore skips startup app registration.

About/Force Quit are Finder-owned system utility kinds; real System Information is a read-only fictional summary, not the full INFO-01 tree. Controls are exact published native IDs; default native focus reveals offscreen chooser rows, then rechecks actual ownership after flush. Shared private window preparation restores original committed WM/Dock/Spaces/history in place when interrupted and captures no candidates into session return. Saved utility scroll/chooser selection are canonical; Option/menu/native tokens are not persisted.

`session.logout/respond` fully replaces `session.guest.end/respond` and `logoutPending` replaces Guest-only pending state. Locals sign out individually while original data/editor/windows remain; only departing Guest is discarded. Option/`confirm:false` power cycles use real accepted transition. Force Quit tears down all non-Finder windows/markers, retaining local document/Services records under disclosed recovery policy; Finder Relaunch allocates a new ordinary lifetime while files/system utilities survive. Source/native MetaAltEsc, ShiftMetaQ/AltShiftMetaQ, Option release, clear/rename/trash/no revival, hidden/minimized multiwindow teardown, two-local/cold saved and private utility/Services lock interruption pass.

Final405 tests/4969 assertions,587-module build,283 strict schema pairs and1,402 historical schemas pass.56 historical actions preserve full inspect/DOM/focus/storage. Light/Dark320×240/DPR1.25 screenshots inspected; clean replay errors are observed separately from retained16 invalid Window-target synthetic-event instrumentation errors. Existing chunk advisory remains; no host processes/hardware/accounts/power/IO.44/286 complete; next APPLE-02 adapts original Mojave tabs to current compact About and General → About.

**APPLE-02 / previous delivery**:
Golden discovery289;45/286 complete,241 remaining; next APPLE-03. Current27 compact About's More Info opens actual General About rather than old tabs. Six shared commands: system.settings.open, system.machine.rename/select, system.about.version.set, system.coverage.open, system.storage.volumes.set. New About/Displays/Storage Settings and coverage components share immutable M2/8GB/display/256 GB/fictional serial/build/coverage inventory; System Report reads the committed name/display too. Support/Service/Getting Started use actual original offline Help articles.

Complete V1 system now requires computerName plus recents; old incomplete data rejects without aliases. Name is non-whitespace single-line≤256 UTF-16 units within shared4 Mi seed budget, independent per retained root. Native change/Enter commit, Escape reverts. Exact committed native field caret/focus and owned pane/scroll/build/volume flags save/restore; dirty drafts/stale controls are excluded and Guest never saves. Coverage uses files.sceneTime/inclusive UTC expiry, not host date. Storage reuses actual writable UTF-8/PDF payload sizes (including ancestor-Trash), fixed fictional18 GB System Data/6 GB Apps; readonly/folder records add no fake bytes. All Volumes exposes exact free bytes.

Reproduced native More Info failure returning an accepted concurrent rename then rolling back its name. Apple admission now rejects during private preparation; openWindowPanel rejects overlapping preparation without replacing its owner. Internal preflight control availability is deliberately unchanged. Before/after race and raw98 requests retained in local://apple02-shipped-proof.json;69 actual applied pairs validate. All six new names applied,289 strict schema pairs/1,402 historical schemas compile;24 historical calls preserve full inspect/DOM/focus/storage. Native typing/caret2–8 backward, actual three articles/report, active/expired coverage,11-byte Markdown export/Trash, independent Alex/Casey, cold native restoration, Guest disposal and dirty draft exclusion pass. Production index-DTpDiVza.js has zero errors/failed/external requests; inspected Light/Dark and320×240/DPR1.25 (existing ordinary-window scaling).408 tests/5,000 assertions across37 files,593-module build, no Svelte warnings; existing chunk advisory unchanged. Owned saved slots/tabs cleared; verifier mistakes retained separately. User's Windows documentation remains untouched.

**APPLE-03 / current delivery**:
Golden discovery304;46/286 complete,240 remaining; next APPLE-04. New storage-model/catalog/commands and GoldenGateStorageManagement provide15 shared commands, real five-category inventory, Documents scopes/sorts/browser/selection, native list/confirmation scroll, actual download/open/reveal, reversible Trash/restore and permanent complete subtree purge. Protected installation bundles remain readonly with fixed6 GB allocation, no invented bundle sizes/uninstall.

Required closed V1 system.storage has three boolean policies; seven canonical filesystem anchors include Documents/iCloud Drive/Mail. Optional payload inCloud/localResident/deletedAt preserve backing content and count only resident bytes. Cloud/Desktop/Documents and Mail cache old-age policies are explicit simulation choices; automatic Trash expiry is strictly over30 scene days and unknown deletion age survives. Metadata uses scene ticks, never host timers; clock reports actual final time and maintenance runs once. Shared opening restores residency with clock/revision preflight.

Root commits detached budget-checked candidates. Private full-subtree identity/revision leases reject genuine child additions atomically. Permanent removal closes payload windows, strips retained references, falls Finder back and invalidates affected Undo while preserving unrelated history. Ordinary Settings alone owns closed view/category/scope/sort/direction/folder/selection; native list offsets save with exact ownership. Local roots are independent; Guest and confirmation leases never save. Old incomplete V1 rejects before mutation.

Native smoke repaired observed proxy clone failure in describe, rejected checked-state divergence, route focus loss, nonexistent budget predicate, duplicate maintenance/stale clock result and readonly bundle identity rejection. Final424 tests/5157 assertions/598 modules pass without Svelte warnings;304 strict schema pairs and118 applied pairs cover all15 additions,60 historical calls preserve inspect/DOM/focus/storage and1402 schemas compile. Native expiry exact30 days/+1ms, stale descendant creation, real purge references, keyboard PageDown/Escape and cold list240 restoration pass. Two distinct local policies save; Guest excluded/discarded; confirmations omitted and old V1 rejected atomically. Production index-CsojdmBn.js Light/Dark and320×240/DPR1.25 screenshots inspected; errors/failed/external requests zero. Existing narrow scaled/clipped ordinary windows and large-chunk advisory remain. Raw proof: local://apple03-shipped-proof.json.

## APPLE-04 — actual recent server locations

Complete V1 requires system.servers closed `{id,name,folderId,available}` definitions (≤128 unique safe IDs/literal single-line names) and recentItems.servers (≤10 unique registered IDs). Defaults empty; authors supply actual virtual folders/contents. Existing backing records must be folders; missing/trashed/offline locations remain valid unavailable definitions. inspect retains configured flags; detached targets publish effective eligibility. No host/network connection, credentials, mount or invented remote tree.

Two additions: system.server.open opens/reuses actual Finder at the registered backing folder and records successful server use; system.recents.open checks exact applications/documents/servers membership before actual dispatch. All native recent rows share it. Images now join document-open tracking/restored cursor. Shared opening preflights text/history/metadata growth alongside existing clock/revision limits. Clear affects all three histories only; renamed folders resolve current Finder titles. Local roots stay independent; Guest never saves and returns to the authored baseline after logout. Missing required old V1 fields reject before mutation.

Final427 tests/5183 assertions/598 modules pass without Svelte warnings;306 strict schema pairs and66 applied pairs/87 records cover both additions. Native apps/images/server folders and real child, name/trash/offline/missing, capacity/eviction, exact4 Mi atomic rejection, local/Guest isolation and source/production populated/cleared cold restore pass. Eight historical requests preserve state/DOM/focus. Production index-BOJjYrTh.js Light/Dark and320×240/DPR1.25 inspected; child scroll193/End/disabled-row skipping/Enter Clear work; zero errors/failed/external requests. Foreground unchanged-bundle control resolved browser wait failures; temporary popup guard was fully removed (original A00A hash). Owned slots cleared, tabs closed. Proof: local://apple04-shipped-proof.json. Primary current27: https://support.apple.com/en-jo/guide/mac-help/mchlp2724/mac.

## APPLE-05 — Force Quit confirmation and protected native lifetime

Golden discovery307. app.forceQuit/app.relaunch now REQUEST confirmation: result includes chooser windowId/opaque confirmationId, confirmationRequired:true, quit:false or relaunched:false. New system.forceQuit.respond target{windowId,confirmationId} payload{accept:boolean} returns {windowId,confirmationId,appId,action,accepted,performed,openedWindowId}; only accepted Finder relaunch supplies a new ordinary ID. No immediate aliases. Native row Return requests; Cancel initially focused, Return/Escape cancel, Tab/ShiftTab cycle. Pending chooser controls inert; select rejects before focus.

Private Set of actual target window objects + application lifetime protects against added/removed/replaced windows, stopped/restarted process and zero-window borrowing. Existing first-created window ID tokens renew on new runs/Finder relaunch; quit retires, restored running apps initially undefined. Root UUID-scoped bounded confirmation sequence prevents replay against restored identical IDs. DTO is flat copied scalars; leases/confirmation never saved. Lock and foreign local root preserve state/DOM/focus and cannot respond. Owner close cancels.

Confirmed quit retains native Notes/document/Services records and ordinary reopening state, clears app windows/running/hidden/quit markers. Finder remains running; shared target predicate closes only ordinary windows and retains all utilities/files. Reproduced Finder About loss outside lease target set fixed; real About/Get Info/system/chooser survival verified. No host process/hung-state fiction. Existing blocking file-sheet/global presentation guards unchanged. Extra confirmation/defaultCancel/recovery are explicit simulation safety policies; native27 chooser/shortcut/Finder/unsaved-risk sourced, exact confirmation pixels/defaults not asserted.

Final437 tests/5204 assertions/39 files,599 modules no Svelte warnings;307 strict pairs,119 applied pairs/145 records, no schema failures. Source native edited Notes and unsent Mail reopening; production edited Mail/forced stop/cold retained body; minimized/hidden multiwindow, stale new window, zero-window restarted lifetime, Finder utility/file protection and cold pending-exclusion/replay pass. Twelve historical requests preserve state/DOM/focus. Production index-C9I-fiSc.js Light/Dark320×240/DPR1.25 inspected;16-app chooser scroll438/End/Return/Escape work, zero errors/failed/external requests. Source/production owned slots cleared and tabs closed. Existing scaling/chunk advisory remains. Proof: local://apple05-shipped-proof.json.

## APPLE-06 — confirmed exits and real reopen choices

Golden discovery309; new session.logout.configure/power.configure have closed target{} payload{reopenWindows:boolean}, result{reopenWindows}. Logout/restart/shutdown request payload optionally supplies confirm/reopenWindows; responses remain exact{accept:boolean} and request/response results include actual chosen boolean. Owned visible matching controls required; Guest logout defaults false, has no checkbox and rejects true intent/configuration. Cancel never writes preferences, clears no windows and restores the original editor/caret. Initial Cancel Return is non-destructive; checkbox Return never accepts.

Required complete V1 system.reopenWindows defaults true and explicitly false persists through real per-root save/cold restore. Local logout commits only its root; machine power commits every retained local root under disclosed simulator-wide policy. Checked choices preserve original native nodes; unchecked choices close actual views through closeWindow, clear non-Finder running/hidden/switching markers and return zero windows without startup replay. Model records/appearance/ordinary reopening memory survive. Return tokens for closed views retire; accepted exit clears private Force Quit/storage confirmations. Guest only discards after acceptance.

Current Notes/Services changes already commit to canonical models. canLeaveScene rejects private preparation/pending exports/pairing/quit and mismatched native input before request or acceptance. Real Save creates Markdown; native Name Enter resolves its draft before retry. Rejected exits leave state/DOM/focus unchanged. No fabricated unsaved TextEdit/Preview model or Save/Don't Save sheet, automatic persistence, host IO/auth/power. Existing native textarea/input line normalization avoids falsely treating valid CR/LF-rendered Services data as dirty.

Final450 tests/5559 assertions/39 files;599 modules no Svelte warnings;309 strict pairs,163 applied pairs/197 records, zero schema failures. Native all three checked/unchecked exits, original Notes caret4–17 backward, real exported files/edited Mail, six pending-export barriers, valid Settings draft barriers, independent local preferences, source/production cold checked/zero-window roots, active/inactive Guest warning/cancel/discard, full-screen/Split View teardown and pairing block pass. Sixteen historical calls preserve state/DOM/focus and178/163/170/190 catalogs. Fixed observed narrow-resize Cancel y377 outside240 by bounded body scrolling/pinned actions; final y187–219 at320×240/DPR1.25 with trapped Tab/ShiftTab/Space. Production index-CpIAqkp2.js Light/Dark/narrow inspected, zero errors/failed/external requests; owned slots cleared and tabs closed. Existing chunk/scaled-window limits remain. Proof: local://apple06-shipped-proof.json.

## STATUS-01 — fictional Wi-Fi and owned native join

Golden discovery323;50/286 complete,236 remaining; next STATUS-02. Four Host-owned status.menu.open/close/select/execute commands address menuId:wifi through the existing single menu owner. Ten Root-owned wifi.* commands share the same native power/connect/disconnect/disclosure/join paths. Current27 Wi-Fi Settings replaces historical Network Preferences and is an actual ordinary Settings pane with shared canonical controls.

Required closed system.wifi has powered:boolean, connectedNetworkId:id|null and up to128 unique-ID/unique-name fictional networks. Fields: id,name,security:open|password,password,known,available,hidden,strength0..3. Literal names are bounded256 UTF-16 units; fictional passwords63. Connected requires powered/known/available; unavailable strength0. Descriptor-first validation rejects accessors/coercions/extended arrays and old incomplete V1 before mutation. Whole-root4 Mi budget precedes commit. Power-off disconnects without forgetting; power-on stays disconnected. This is retained-desktop state, not host-global networking.

wifi-commands privately owns a Root-unique join lease/disclosure; GoldenGateWifiJoin exposes actual focus/select/scroll/draft controls, not published password state. Wrong password, unavailable hidden name and commit-limit failures are applied failed attempts with a live alert and no canonical connection/known mutation. Stale/foreign lease or inert/clipped ownership rejects atomically. Cancel/success returns the exact original editor/caret; native Tab order is fields/Cancel/Join, and focused Join Return really submits. Background desktop is inert. Settings pane/scroll and Wi-Fi save per local root; Guest and private drafts/leases never save. Accepted exit retires the private sheet.

Final464 tests/5973 assertions/41 files;606 warning-free modules;323 strict pairs and101 applied pairs/177 records. Source/production native off/on, inline expansion, open/protected/hidden/security=None, wrong password, connected-icon disconnect, Settings synchronization, original Notes caret4–17 backward, independent locals/Guest, private save exclusion, cold restore, stale-root leases and complete4 Mi boundary pass. Full128-network literal menu scroll clamps4007; long Join and all hidden controls are visible/revealed at320×240/DPR1.25. Final production index-BMtCIDgD.js Light/Dark/narrow inspected, Cancel/Join y195–221, zero errors/failed/external requests. Sixty historical requests preserve state and178/163/170/190 catalogs. Partial-HMR development registry errors are preserved separately, not hidden as clean production evidence. Owned slots cleared/tabs closed.

## STATUS-02 — Battery menu, real Settings and immediate Options

Golden discovery333;51/286 complete,235 remaining; next STATUS-03. Ten Root battery.* commands extend the existing Host status.menu.open/close/select/execute and generic menu.navigate/scroll with menuId:battery. Actual charge/source/full/not-charging/nullable estimate/Low Power/low/critical presentation replaces only Golden's fixed indicator. Current27 Battery Settings replaces historical Energy Saver; percentage and mode visibility live in real Menu Bar → Battery Options.

Required closed system.battery fields: percent0..100,powerSource:battery|adapter,charging,minutesToFull:null|1..2880,chargeLimit80..100,chargeToFull,showInMenuBar,showPercentage,showEnergyMode:always|when-low-power|never,lowPowerMode:never|always|battery|adapter,energyApps:[{registered appId,impact0..100}] max128 unique. Charging/source/estimate/effective-limit invariants and complete-root4 Mi text budget precede every mutation. Significant energy is authored impact>=20 for actual running apps, including hidden/minimized; readonly rows do not pretend to launch Activity Monitor. Low<=20/critical<=10 on battery are simulator policies. Conditional Charge to Full sets an authored override; later authored full/unplug clears it. No host battery/process data, automatic drain or fake progress.

Options leases bind original Root/window identity and actual foreground/clipped/hit-tested controls. The native dialog is outside an inert desktop; preferences commit immediately, Done/Escape dismiss, and synchronous facade focus makes fast select→Tab→Enter retain the new mode. Reproduced/fixed closing Low Power popup, legacy shared CSS hiding narrow summaries, asynchronous focus/preference races and lost focus when the conditional mode row disappears. Keep-open recovery focuses the surviving Settings leaf; hide restores exact original Notes node/caret4–17 backward.

Both locals independently round-trip complete canonical status/source/prefs/energy through actual cold save/restore. Guest resets/discards; private leases/focus/scroll exclude. Another local rejects the borrowed lease; the original retained local can resume its own sheet. Accepted restart retires it. Battery/Menu Bar ordinary pane/native scroll restore; old incomplete V1 rejects atomically. Full current66-app energy roster and native scrolled Settings footer are bounded at320×240; typed focus reveals a genuinely clipped select at320×180 while Done remains pinned.

Final480 tests/7211 assertions/42 files;615 modules without Svelte warnings;333 strict request/result pairs,236 applied pairs/268 records with zero schema failures. Native source/production charge/low/source/estimate/override, same-popup/conditional-row surviving focus, actual Notes caret4–17 backward on hide, immediate Options keyboard/fast select→Tab→Enter, two-local exact cold models, real pane/Guest/private exclusion, foreign leases/old V1 and complete-root pressure pass. Full66 live app rows scroll at320×240; clipped select reveals at320×180 with pinned Done.64 historical requests preserve170/178/163/190 commands/state. Final index-5b3vm4Ax.js Light/Dark/narrow inspected; fresh production has zero errors/failed/external requests. Source instrumentation error and mixed-tab localhost request history remain separately classified; owned slots cleared/all tabs closed. Chunk/scaled-window advisories remain.

## STATUS-03 — one authored instant and actual Clock controls

Golden discovery348;52/286 complete,234 remaining; next STATUS-04. Fifteen Root clock.* commands extend the original Host status.menu owner with an explicitly fictional Clock settings shortcut. Current27 Clock Options lives in Menu Bar; zone/24-hour/manual Set live in Date & Time. Native primary Clock opens Notification Center, so this shortcut is disclosed rather than synthesizing that queued feature or a calendar flyout.

Required closed system.clock contains style:digital|analog,showDate:when-space-allows|always|never,showDayOfWeek,showAMPM,showSeconds,use24Hour,timeZone. Five zones are UTC,America/Los_Angeles,America/New_York,Europe/London,Asia/Tokyo; formatting is explicitly en-US. Existing files.sceneTime is the only current instant per retained desktop, shared by menu/hands, Notes civil-day grouping/labels, numeric Messages record timestamps, local writers, lock and saver. Successful writes advance it; rejected operations and power elapsed time do not. Display changes leave immutable record timestamps and the original Notes editor/caret untouched.

clock-model reuses complete-root text accounting and descriptor-first atomic preferences. clock-commands owns Root/window-bound private Options/Set leases, real control focus/reveal/scroll, and owner/foreground/clipping guards. Immediate Options commits survive Done/Escape; Analog disables but retains AM/PM/seconds. Date visibility measures actual natural menu/status width. Forward-only Set uses existing storage transactions, rejects DST gaps/folds with retained live errors, preserves held-second milliseconds, and limits only the native editor to local years1970–9999. No host/NTP/location/timer or second clock authority.

GoldenGateMenuBarSettings cleanly replaces the Battery-only component while preserving its native controls. Actual Date & Time and two private sheets are outside the inert desktop. Native datetime initialization/reconciliation avoids reactive same-value assignment and redundant focus that reset the browser's in-progress numeric segment. Source failing-before day2→9 produced09; plain native input and fixed Source/final bundle preserve29 and Set the exact shared day. The existing PDF queue's removed noteClock call is cut over to the shared allocator; four existing failing consumer tests and real Print now pass.

Both locals cold-restore exact independent time/zone/display data and real panes. Guest resets/discards; Clock private IDs/focus/scroll exclude. Missing required Clock rejects without changing full inspect; last authored instant rejects a new Note and visibly disables unsupported native-year Set. Retired/foreign sheets and locked mutation reject. Old literal conversation time/thread timestampLabel fields are removed rather than shimmed.

Final494 tests/7439 assertions/43 files;624 modules without Svelte warnings;348 strict pairs,91 applied pairs/104 records, every15 new name applied, zero schema failures. Native Source/final production controls, civil-date advance, Analog/space omission, hour/zone, Notes node/caret49, actual PDF, lock/saver, DST errors, held milliseconds, two-local cold save/Guest/private exclusion pass. Light/Dark320×180 private sheets are304×164 with actions y135–161 and no overflow. Eighty historical calls preserve170/178/163/190 inventories and complete inspect/DOM/focus. Final index-Das8WSQg.js and cold Source have zero page errors; production has no external/failed resource entries or broken images. Owned fixtures/slots/tabs cleared; intermediate partial-HMR errors remain separate evidence. Next STATUS-04; Rust transport deferred.

## STATUS-04 — canonical Sound and retained real audio

Current Golden discovery364;53/286 complete,233 remaining; next STATUS-05. Sixteen Golden-only sound.* handlers extend the original Host Sound provider and existing system.panel controls. Real Sound Output/Input and immediate Menu Bar visibility controls share one required closed system.sound; no component-local second sound authority.

sound-model validates descriptor-first dense bounded literal device lists, selected available routes, integer0–100 per-device volume/mute/gain/level and per-app Music/QuickTime volume. Nonadjustable output must be100/unmuted; nonadjustable input gain100. Detached summaries supply authored round(level×gain/100) meter and mute-aware master×app gain. Commands reuse complete-root4 Mi accounting and original Root/window/native-view admission; missing/incomplete old Sound seeds/snapshots reject rather than merge.

The native keep-open slider/radios/Mute share generic menu keyboard/focus/scroll. Option-open inputs persist after modifier release; this is explicitly continuity inference, not established27 primary behavior. Only When Active reads actual retained player.paused, not the authored input meter. Last natural completion hides/retire-restores the original Notes node and caret. Actual Sound tab radios/gain/meter and Menu Bar checkbox/select invoke the same canonical operations; unavailable/fixed controls disable honestly.

audio-fixtures lazily caches original trusted PCM sources; no default/historical eager synthesis. GoldenGateAudioPlayer binds actual HTMLAudioElement play/pause/currentTime/metadata/ended/error to Root/window/node leases. Music12-second Golden Arpeggio and QuickTime8-second Glass Study.wav are bounded original offline auditions, not library/video/recording completion. Playback stays on the original hidden/minimized foreground node; Dock previews are disabled projections of its actual snapshot with no audio or registry ownership. Departing/locked/disposed Root pauses playback without auto-resume.

Observed minimize failure destroyed the original player and mounted a fresh Dock player, resetting accepted playback/seek to zero. Corrected retained main renderer plus read-only preview survives6.021→8 natural end with exactly one original audio and zero thumbnail audio. Source and final production replay pass. Typed observe reads hidden originals; focus/seek/scroll still require an eligible actual owner/control.

Sound preferences and real Output/Input tab/scroll restore independently in local roots. Explicit cold restore requires scene.session.restore plus actual native sign-in; automatic restore remains false. Restored QuickTime is paused at0, private expanded-input state is false and no playback/DOM leases serialize. Guest Sound starts fresh after accepted departure; foreign local media targets reject.

Final508 tests/8142 assertions/44 files;634 modules/no Svelte warnings;364 strict pairs,107 Applied/114 records, all16 additions applied and zero schema failures. Native Source/final production controls, simultaneous gain/mute, seek/end/caret return, retained-node minimize, lock/no auto-resume, complete saved Sound/Input tab/scroll162, local/Guest isolation,256-unit name/unavailable output/fixed input meter78 pass. Light/Dark320×180 Sound popup x52/y30/w264/h146, actual scroll250/no overflow and complete Music/QuickTime surfaces inspected.64 historical calls preserve170/178/163/190 catalogs/state/DOM/focus and1,402 schemas compile. Final index-lOKGbFY9.js/fixed Source/cold Source have zero page errors/failed/external resources; partial-HMR history is retained separately. No host device/microphone/routing/network or physical audibility claim.

Research links and exact public contracts are recorded in README and docs/feature-commands.md. Input meter/routing, bounded originals and lifecycle policies are disclosed simulator behavior; Sound Effects/balance and complete media workflows remain their own unchecked slices.

## STATUS-05 — closed Bluetooth and owned native pairing

Current Golden discovery376;54/286 complete,232 remaining; next STATUS-06. Twelve Golden-only bluetooth.* handlers extend the original Host status.menu owner; native Bluetooth/My Devices/Nearby Devices and immediate Menu Bar visibility use the same required closed system.bluetooth. Current27 Bluetooth settings/connect/power sources are linked in README; optional menu-extra placement and all three authored sheet variants are explicitly bounded simulator policy.

bluetooth-model validates descriptor-first dense0..128 closed device records, unique safe IDs/literal single-line names<=256, kind/availability/pairing/connected/battery/code cues and exact unique linked Sound route ownership. Connected requires powered/available/paired; linked availability equals connected. Power-on does not reconnect. Detached planning exposes audio routes without selecting; detach falls selected output/input back to the first available unlinked route or rejects both domains before writing. Levels/mute/gain/app volume remain unchanged.

bluetooth-commands snapshots actual Root/device/route/array descriptors, rechecks Root/Sound identity and writable/budget/foreground admission, then atomically commits. Text delta counts actual changed canonical route IDs, never an already-existing device name. Native same-playing-node gain0.4→0.28→0.4 is observed on Sound selection/disconnect/power-off; an authored headset proves both-direction fallback and preserved gain64.

Private pair IDs include a Root UUID and bounded sequence. Actual device/mode/code/descriptor/view identity and foreground are checked after awaits. Native six-character draft/selection, Cancel/Connect/Accept, focus and body scroll remain private; wrong PIN/budget keeps the owned sheet with connected:false and no canonical write. Generic Root modal admission blocks competing domain actions. Capturing any shared popup uses its original editor token, not its row. Lock preserves the original sheet but blocks its operations; same-user unlock/cancel restores the original Notes DOM node/value/range155–157 without credential focus theft.

GoldenGateBluetoothPair reveals the entire PIN/error group, not just the field: reproduced320×180 validation clipping is repaired and replayed in Light/Dark with both action centers hit-testable. The ordinary pane uses existing system.panel and retained native registration, scaled/clipped reveal and canonical checkbox reconciliation. Minimize/close/reopen retain connectivity and Bluetooth pane; exact cold native scroll640 is separately proven. No component-local data authority, host scan or fake connecting progress is added.

Complete saved V1 requires Bluetooth and owned optional Bluetooth Settings pane/scroll; private IDs/drafts/leases and Guest never serialize. Two local roots retain distinct power/icon/Sound choices through real explicit cold restore/native sign-in. Alex connected cue/hidden icon/output37/app29 and paused0 survive; Casey remains off/visible/builtin. Saved connected values are fictional retained cues, not host reconnect. Guest resets on accepted departure.

Final530 tests/8301 assertions/46 files;641 modules/no Svelte warnings;376 strict schema pairs,117 Applied/133 records, every12 addition applied with no unintended schema failures. Native source/final production and exact4 Mi canonical/independent2 Mi saved-slot boundaries, zero/128 devices,256-unit names, foreign/locked leases, actual cold pane/scroll and Guest exclusion pass.48 historical unsupported calls preserve whole inspect/DOM/focus and170/178/163/190 discovery;1,402 schemas compile. Final index-e1zECA9B.js, clean production/cold/historical errors/assets, owned slots reset and tabs closed. Proof: local://status05-shipped-proof.json. PREF-22 details/Forget/advanced discovery and BTFILE-01 remain unchecked.

## STATUS-06 — retained input preferences and exact original editor leases

Current Golden discovery390;55/286 complete,231 remaining:229 queued plus STATUS-07/STATUS-08 deferred for now at the user's request. Next SPOT-01. Fourteen Golden-only input.* names share the existing status.menu/menu.navigate/scroll owner; historical profiles advertise no Input capability and reject before mutation.

input-model owns descriptor-first closed input state, dense unique1..3 us/fr/de sources, active membership, nullable distinct configured previous source, detached summaries, original bounded Latin key layers and48 fixed characters. Source configuration preserves configured order; removing active selects the first survivor and clears invalid previous membership. Visibility remains independent. Positive full-root text delta counts new array index keys as well as source/active/previous IDs; the live exact4 Mi and one-/two-/three-free-unit boundaries are exercised.

Input viewers are modeless Root-private UUID/sequence owners, not managed app windows. Same-kind open reuses the original lease; opening the other kind from a viewer inherits that exact original editor token. Capture binds actual Notes target or original service entry/view/field/node, canonical revision/value and UTF-16 range. Only successful writes advance matching original leases. Notes uses text.replace/real undo; drafts use services.draft.set, whose immutable entity replacement requires returned-revision/logical-ID plus original-view/node checks before actual native caret completion. External edit/undo disables insertion rather than rebinding to another editor.

GoldenGateInputViewer separates structural mounted availability from final clipped/revealed hit/focus proof. Native button click supplies activation; Tab never acts like Shift. Compare-before-write query reconciliation skips composition; the replay uses synthetic lifecycle events, not a real host IME. Root native-state revision invalidation keeps keys enabled after successful private lease advancement. Small palettes are Root-relative; both share a constrained foreground layer above the bar, below an open shared menu/modal, retaining active-viewer ordering. Native close and popup row centres are actually hit-tested.

Ordinary Keyboard Text Input registers the existing system.panel and retained settings-keyboard scroll. Saved V1 requires input and admits only this ordinary pane/scroll; no private utility/query/modifier/editor identity or Guest is serialized. Actual cold Alex retains ordered de/fr/us, DE, visible and body187; Casey retains French-only/hidden. Old missing-input saved restore rejects with whole inspection/native focus unchanged. Lock/unlock preserves both original IDs/query/usable editor without credential focus theft.

Final548 tests/8433 assertions/48 files;648 modules/no Svelte warnings;390 strict pairs,147 Applied/218 recorded requests, all14 names applied. Every response validates; explicit missing-input and omitted-menuId invalid probes reject, unknown app.launch rejects unsupported_command, corrected schema-discovered app.open/menu close pass. Native source/final Notes family glyph/UTF-16 caret/real undo, original-node repeats and actual draft `A😀B` split-caret Backspace→`AB`/1 then native Enter→`AzB`/2 pass. Light/Dark320×180/DPR1.25 x8/y8/w304/h164 close/selection/footer surfaces are inspected.56 historical unsupported calls preserve full inspect/DOM/focus and170/178/163/190 inventories;1,402 schemas compile. Final index-DXzIKBtf.js; clean final production/cold/historical errors and exercised production/cold assets. Proof: local://status06-shipped-proof.json.

Boundaries: real host keyboard/IME unchanged; only authored Latin/spacing-accent layers and bounded catalogue, no dead-key conversion, candidates, Genmoji, full Unicode/favourites/history or host settings. Badges/independent visibility are explicit simulator policies; full Keyboard Preferences and shared formatting panels remain separately queued.

## SPOT-01 — private live-source Spotlight

SPOT-01 checkpoint: Golden discovery399;56/286 complete,230 remaining:228 queued plus STATUS-07/STATUS-08 deferred. Nine Golden-only spotlight.* commands; historical inventories170/178/163/190 unchanged. Current checkpoint is SPOT-02 below.

spotlight-model owns256-unit literal accent-insensitive AND-token matching and deterministic applications/documents/contacts/mail groups, without a hidden cap or full-text concatenation allocation. Root collects current bundles, eligible file documents/live Notes and actual canonical Contacts/Mail; no fake communications. Public results use kind-qualified IDs/logical icons; source tokens stay private.

spotlight-commands owns UUID/sequence identity, original-source leases, pending activation exclusion and native preparation. Reconciliation tombstones replaced originals until a fresh query; logical communication IDs/revisions tolerate unrelated immutable selection updates without borrowing changed records. Real desktop/app/Finder, Notes view/card/editor and services provider writers open/reveal exact destinations. File residency/access updates from its own opening do not spuriously invalidate the source.

GoldenGateSpotlight is private/modeless, not a managed app window. Native controls carry exact owner IDs; focus/scroll summaries read actual DOM. Composing drafts are not overwritten. Nondirectional caret checks exact offsets without requiring Chromium to retain “none” orientation. Escape restores only the valid original app/window/node/value/revision/range, never a fallback selector; outside-click does not return focus.

Lock and foreign foreground block operations while retaining private state. Actual Casey search returns only app:notes and rejects Alex's owner; Alex native reauthentication resumes the same ID/query/five results. Saved canonical records persist but private IDs/query/control markers exclude; explicit fresh-context restore/native sign-in starts without a search.

Final554 tests/8464 assertions/49 files;652 modules/no Svelte warnings;399 strict pairs,118 Applied/128 exercise requests, all nine additions applied. All responses validate; intentional oversized query is structurally invalid. Native keyboard/all ten routes/Notes caret/synthetic composition/actual scroll/local isolation/private-save/cold exclusion and final320×180/DPR1.25 bounds/Close ownership pass.36 final historical calls preserve inspect/DOM/native focus;1,402 historical schemas compile. Final index-CRb4Y7hZ.js has no errors/broken images/external resources. Proof: local://spot01-shipped-proof.json.

Boundaries: authored bounded materials/layout, local scene data only, no host filesystem/index, network search, fake communications, cloud/clipboard/Siri/full Quick Actions. Standalone Preview remains launch-only; SPOT-02 below adds inline previews/calculation/conversion/dictionary/suggestions/indexing/privacy.

## SPOT-02 — real private readers and canonical search policy

SPOT-02 checkpoint: Golden discovery406;57/286 complete,229 remaining:227 queued plus STATUS-07/STATUS-08 deferred. Its next slice was NOTIF-01. Seven additions; historical inventories170/178/163/190 unchanged.

spotlight-answers is a256-unit/128-token/32-depth finite arithmetic parser, not eval. Explicit unit conversions include temperature offsets and case-sensitive bit/byte plus SI/IEC prefixes; ambiguous regional units reject. Currency shortcuts normalize into the same converter and disclose fixed fictional rates. Dictionary answers reuse the existing22-entry offline dictionary. spotlight-model adds eight eligible real label completions, without truncating search matches.

spotlight-preview prepares exact original canonical text/fields/application metadata/image bytes/PDF bytes. Lazy bundled PDF.js6.4.299 renders real pages and accessible Unicode text; its loading task owns destruction, not PDFDocumentProxy. Opaque resources never enter public state or saves. Private reader/page/scroll commands recheck original Root/source/preview/native ownership. GoldenGateSpotlightPreview contains accessible text inside its reader so actual reader scroll cannot displace pinned Back/page controls. Command-Y/eye and focused-row Space preview; Escape closes the reader first.

Required system.spotlight has closed unique enabledCategories/apps/documents/contacts/mail/calculator/conversions/dictionary/suggestions, excludedFolderIds and indexingEnabled. Descriptor-first partial configuration preserves original leaf/array authority, validates actual retained/readonly folders and coupled4 Mi string growth before writes. Root filters scene sources before public result/suggestion creation, with exact file/bundle ancestor privacy and full-path folder labels. Disk/index-off hides all indexed domains; other folders do not manufacture Notes/Contacts/Mail storage paths. Answer categories are independent. Purging excluded folders clears obsolete identities; trash retains exclusions.

GoldenGateSpotlightSettings is an ordinary settingsPane:spotlight owner with real native controls, panel focus/scroll and retained settings-spotlight view kind. Source snapshots and complete saved V1 require the leaf; old missing-leaf payloads reject unchanged, without shims. Actual cold native sign-in restores independent Alex all-categories versus Casey conversions-only/disk-excluded policy; private readers/search and Guest policy exclude. Lock/local switching retain the original private search/PDF; same-user authentication resumes it.

Final578 tests/9190 assertions/51 files;662 modules/no Svelte warnings;406 strict pairs,112 Applied/114 retained requests, all seven additions applied/all requests and responses valid. Real guarded110-row Notes write/three-page export, Unicode PDF pages/scroll, actual text/contact/mail/image readers, native shortcuts/settings/privacy and live indexing reversibility pass. Repaired installed PDF6 teardown API, hidden accessible-text ancestor overflow, +budget math intent and currency shorthand. Final index-m7TY7RAi.js Light/Dark320×180/DPR1.25 native page-next/Back/Close hit ownership passes; very small reader space is disclosed.28 historical probes preserve inspect/DOM/focus;1,402 historical schemas compile. Final browser errors/broken images/external resources empty; owned browser fixtures cleared/tabs closed. Proof: local://spot02-shipped-proof.json.

No host filesystem/background index, cloud/telemetry/market rates, full dictionary/native Quick Actions/clipboard/Siri, or completed standalone Preview reader is claimed.

## NOTIF-01 — canonical arrivals and private current Notification Center

Current Golden discovery453;60/286 complete,226 remaining:211 queued plus15 deferred (STATUS-07/STATUS-08 and DIALOG-01–DIALOG-13). User requested settling the existing Spotlight/notifications checkpoint and skipping the rest of section3; no next slice is active. NOTIF-03 adds19 delivery/action/settings commands; historical inventories170/178/163/190 unchanged.

Primary27 Get notifications guidance and its screenshot establish a combined center opened by date/time, app stacks, click expansion/Show Less, single X and held-X app clearing. Retired Mojave Today/Notifications tabs are not recreated. Native date Return/Space opens the center; context menu/ArrowDown retain actual Clock settings. Root owns GoldenGateNotificationCenter and native facade/placement; no Widget/banner/action/DND placeholders.

Required system.notifications is closed {nextId,entries,preferences}, with at most256 {id,appId,title,body,createdAt,destination,snoozedUntil} records. Destination is null or a real matching source link; snoozedUntil is null or bounded scene time. Preferences retain global DND/preview and registered-app delivery/style/preview overrides. Literal one-line256-unit titles, one-Mi bodies, bounded scene timestamps and monotonically nonreusable ordinals validate descriptor-first. Newest timestamp/numeric-ordinal ordering groups real original records. Explicit posts use scene time by default and exact complete-scene string/key growth. Mutation leases materialize already-validated reactive references before snapshotting, preserving the NOTIF-01 quota fix and reentrant/descriptor guards.

Eight notifications.* contracts own actual open/close/post/group expansion/dismiss/clear/focus/scroll. Original Root/pane/view/node and group/entry guards survive awaits; removed focused controls recover to the same center. Lock/local switching suspend IDs/expansion/scroll; accepted disposal/replacement retires them. Reciprocal Spotlight beforeOpen hooks close the incompatible overlay before capturing original focus; pending cutovers reject resumed/replaced owners. Shared exact transient return preserves actual Notes node/range0–4. Outside click does not steal destination focus.

Actual canonical two-local saves/cold sign-in retain Alex notification7/next8 and Casey notification1/next2, then allocate8 and2 independently. Private center/expansion/focus/scroll and Guest events exclude; old missing-leaf save/seed rejects whole inspect/focus unchanged. Reset/fresh and uninspected cold graphs post successfully; old Root center cannot dismiss a replacement notification1.

Final606 tests/9570 assertions/52 files;666 modules/no Svelte warnings;414 strict pairs.98 retained requests/58 Applied cover all eight names; one deliberate schema-invalid seed and the corrected pre-fix quota rejection remain explicit evidence. Native current-date/keyboard, stacks/Show Less/dismiss/held-X/Clear All, exact editor return, Spotlight cutovers, lock/local resume and Guest exclusion pass. Light/Dark320×180/DPR1.25 x8/y36/w304/h136 preserves actual Clear All/Close hits; full80-row body native/report scroll350→429 agrees. Final index-cyggGDDA.js has zero errors/broken images/external resources.32 historical probes preserve inspect/DOM/focus;1402 historical schemas compile. Both owned saved slots cleared and all proof tabs closed.

## NOTIF-02 — canonical scene widgets and native gallery/data windows

User approved current-native widgets only, explicitly excluding an unverified Calculator widget; Spotlight arithmetic remains. Primary27 widget/gallery and combined-center screenshots establish native add/search/category/size previews/Done, drag ordering, Control-click sizing/edit/remove and Option-hover removal. Clock, Reminders and Stocks app guidance establishes represented source configuration and interaction. Authored Weather unit/source controls and bounded materials are disclosed, not full native editor fidelity.

Required closed system.widgets owns {nextId,instances,sources,selected}. Eight kinds cover Date/Calendar/Weather/Reminders/Stock Symbol/Stock Watchlist/Clock/World Clock. Seven linked source tables share one fictional scene clock and the existing supported zone catalogue. At most64 nonreused widget ordinals and four configured World Clock cities; descriptor-only complete seed/save validation and exact four-Mi aggregate quota guards reject malformed/foreign graphs atomically. Configuration input is descriptor-cloned before validation/quota/native awaits; responses/discovery detach arrays from Svelte proxies.

Twenty widgets.* contracts share canonical operations with actual gallery/context/configuration and five ordinary selected-data app interiors. Original Root/center/editor/widget/source/window/native view leases bind asynchronous work; committed model changes remain Applied even if post-commit presentation retires. Date opens Calendar overview, event/symbol/city rows select exact records, and configured weather opens its actual location. Duplicate reminder widgets and ordinary Reminders update one canonical row; post-sort completion recovers the original checkbox focus.

Private gallery/query/category/IDs/contexts/gestures/card scroll exclude from saves. Canonical sources/configuration/order/selection persist independently per local. Ordinary widget-data scroll uses shared semantic app/selected-source scope, also validating closed-window and saved tokens; source changes cannot apply another list/city order's offsets. Actual positive250 scroll survives closed reopen and cold native sign-in. Casey's independent removal leaves Alex's eight widgets untouched; saved locals contain Alex8/Casey7 and no Guest. Guest removal resets on re-entry.

Reproduced and fixed rune shadowing by the public state prop, proxy configuration discovery cloning, whole-card body activation, shared checkbox focus loss, and native Control-click delivery. Permanent regressions also catch quota-callback configuration aliasing/accessor arrays and false Rejected results after committed mutation.640 tests/10816 assertions/54 files;674 modules/no Svelte warnings;434 strict schema pairs and all20 names Applied in actual Rust production. Empty source displays, escaped authored text, source-correct opens, capacity/Calculator/fifth-city/foreign/getter/locked-owner rejection pass. Concurrent original resize completes before replacement; new Root equals its replacement leaf exactly. Owned320×180 bounds fit center304×136/gallery302×134 with actual compact category selection.80 historical invocations reject unsupported_profile before actor getters, inventories unchanged. Final index-BokZutKj.js has zero errors/broken images/external resources. Proof local://notif02-shipped-proof.json; owned saved slot reset and tabs released.

## NOTIF-03 — canonical delivery policy and original-source actions

Golden capability shell.notification-delivery adds19 names, bringing discovery to453. Required notification preferences retain {doNotDisturb,showPreviews,applications}; each registered-app override is {appId,allow,desktop,center,style,previews}. Temporary/Persistent queues are private Root presentation: six-second temporary lifetime pauses for hover/focus/reply, while authored scene time alone controls5/15/60-minute snoozes. Explicit operator arrival always retains a canonical event even when app delivery is disabled. Option-date toggles scene-only DND; no host Focus or deferred Control Center pane is claimed.

notification-destinations.js binds original matching Notes, event, reminder, local sent message/mail or file identities. Real ordinary app opening selects exact records. Shared completion and atomic actual-outbox reply reuse existing canonical models/scene clock; fixed hero text and fake inbox records cannot authorize replies. Mail reply retains original recipient and adds Re: only once without forwarding attachments. Source deletion prunes linked alerts; complete seeds/saves reject dangling/foreign links. Preview opening proves file/window identity, not PDF rendering.

GoldenGateNotificationCard/Banner/Settings share typed handlers and original native views. Singleton center entries expose the same details/options/reply controls as expanded stacks. Preview hiding covers title/body/accessible dismissal labels. Opening Notification Settings first withdraws private center/banners, preventing reproduced compact-stage hit-test occlusion; canonical events remain. The real managed pane retains selected application and semantic settings-notifications scroll; configure/select/global commands bind its original foreground view.

Actual cold saves preserve events/destinations/snoozes/preferences, source outbox and settings selection/scroll2257. Unsaved private editor body UNSENT-PRIVATE-NOT-SAVED is absent from storage and cold UI. Alex DND/on+Mail/allow versus Casey DND/on+Mail/disabled remain independent; Guest policies/events exclude and reset. Existing incomplete V1 inputs reject without merging. Native lock rejects mutation unchanged. Original private editing can commit before accepted Root replacement, which retains exactly its own entry without an editor.

Evidence:662 tests/11627 assertions/55 files;681 modules/no Svelte warnings;453 strict schema pairs,87 retained request/results valid and all27 notification names Applied. Native expiry/persistent pause/Option-date, preview precedence, six source routes, literal reply, shared completion, same-ID snooze, singleton reply, deleted-source retirement, cold/local/Guest exclusion and compact304×136 reply scroll pass. Tiny scaled Settings text is not claimed readable.76 historical calls reject before getters without state/DOM/focus changes or inventory drift. Primary27 notification guidance remains the source; no host notification service, full Focus/rules, incoming Mail/Messages inventory or full Preview reader.

Final Rust-served index-D3r9Xzk9.js applies real linked post/private reply/managed Settings navigation, retains the original event and focuses its native checkbox. Zero browser errors, console entries, broken images or external resources. Proof: local://notif03-shipped-proof.json. Owned saved slot cleared and all proof tabs released.

## Earlier user-requested settled checkpoint (superseded)

Completed Spotlight/notification features remain at NOTIF-03 commit e8a91ca. DIALOG-01–DIALOG-13 are deferred unchecked, not claimed complete or shipped WIP. Both dialog workers stopped; only their nine uncommitted component edits were restored to e8a91ca and the new unintegrated modal-view.js was removed. The user's unrelated docs/windows11-profile.md edit was not touched. Remaining backlog stays recorded; automatic sequential implementation is stopped.

Settlement verification: rebuilt681 modules to the same index-D3r9Xzk9.js with no Svelte warnings (existing chunk advisory only);662 tests/11627 assertions/55 files pass. Fresh Rust browser verifies existing Restart/Escape cancellation, Spotlight notes query/real app result/native Escape, notification post/combined-center card/widgets and453 command inventory. Visual inspected; browser errors/console empty; owned proof tabs closed.


