# JesterOS

JesterOS simulates operating-system desktops and applications for actors to use as film and television screen props.

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
A newest-first, unique application-use sequence advanced by successful scene app opens/new windows, never host time. Mojave/Sonoma display up to three unpinned recent aliases; High Sierra does not expose that presentation. Initial entries are fictional scene seeds, not a claim of observed host usage.

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
