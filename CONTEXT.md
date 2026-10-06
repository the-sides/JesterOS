# JesterOS

JesterOS simulates operating-system desktops and applications for actors to use as film and television screen props.

**Active implementation target:** latest stable macOS, currently **27 Golden Gate27.0.1**, independently verified against Apple's release table/current guide. It is the default profile. Completed High Sierra/Mojave/Sonoma/Windows profiles remain selectable but are not extended by new slices; conditional Linux research is historical, not active implementation scope.

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
Page-local awake/saver/sleeping/off/booting state. Saver/sleep immediately lock an interactive desktop; waking consumes its initiating input without authentication. A signed-out login presentation remains signed out. Neither the host nor the fixed scene clock changes.

**Retained local power cycle**:
An accepted restart/shutdown signs out every fictional user but retains original local model/DOM/window/appearance instances; only Guest is discarded. Five deterministic startup seconds return login choices, never an authenticated desktop. Reopening locals is a disclosed fixed page policy, not full native unsaved-document/reopen-checkbox handling.

**Power return token**:
An opaque scene-owned original desktop or credential-surface focus/selection/scroll capture. Cancel restores the connected original, including private credential drafts kept mounted inert behind confirmation. No credentials are published in inspection or serialized state.

**Scene seed baseline**:
A complete, validated version-1 Notes/files/printing/editing/viewing/communications/system/Messages/appearance/persistent-Dock fixture owned by the Golden Gate host. Each fictional user clones it independently. Required closed data has explicit defaults; older incomplete V1 fixtures reject before disposal, never silently merge. Detached inspection/discovery exposes this initial baseline, not current edits or a saved session; generated read-only app bundles and immutable profile identity remain separate.

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

Required closed Golden V1 `system:{recentItems:{applications,documents}}` owns independent newest-first ten-entry histories per local root. `system-state.js` validates safe dense unique IDs/registered apps. Live document rows resolve names/filter trash; clearing preserves Dock/files/open metadata and old timestamps cannot revive entries. Explicit cold restore skips startup app registration. Servers are honestly empty pending APPLE-04.

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
