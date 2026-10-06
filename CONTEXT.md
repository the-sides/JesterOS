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
Immediate activation in stable scene creation order, skipping hidden/minimized frames. macOS cycles only the active application's windows; Windows cycles all eligible managed windows. This order is independent of activation MRU and Dock recent history.

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



