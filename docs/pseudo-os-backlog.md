# JesterOS pseudo-OS feature backlog

The durable work queue for building JesterOS's actor-facing pseudo-OS. **macOS Mojave 10.14 is the first OS profile**, not the permanent limit: future profiles will cover different macOS releases across years and Windows 11, with Linux possibly later. This initial app inventory focuses on Mojave's desktop, system menus, bundled applications, utilities, preferences, and secondary interfaces. **The Rust controller and WebSocket transport are deferred; command-addressable features are required now.** See [multi-OS and feature command requirements](pseudo-os-architecture.md). This is a proposed implementation inventory, not a claim that every listed interface has already been researched or built.

## Tracking contract

- `[x]` means implemented and exercised; `[ ]` means remaining work. Existing narrow functionality is checked separately from its extensions.
- IDs are stable: refer to `MSG-02` rather than a line number. Add new IDs without renumbering completed work.
- Work in complete, bounded slices. An app can take several iterations; a checked slice must work end to end, not merely draw its interface.
- Before each slice, inspect primary documentation/screenshots for the selected OS and release: **Mojave 10.14** for the initial profile, each other profile's own era/version later. Confirm exact menus, labels, tabs, and hardware/region-dependent availability. The candidate inventories below are research prompts, not permission to substitute modern or cross-OS UI.
- Reuse existing UI/state conventions. Keep application data separate from window lifetime. Add shared behavior only when a concrete app workflow needs it.
- Every feature must expose transport-neutral commands usable by both actor input and a future WebSocket adapter, including transient menu/dialog/focus state and externally initiated effects. Document stable targets, payloads, availability, and observable results; no DOM-click automation or duplicate controller-only logic.
- Each enabled control must perform a real action within the simulation. Native unavailable/selection-dependent commands may be disabled; unfinished features must not masquerade as working controls.
- All accounts, files, mail, messaging, networking, devices, security, installations, and power changes are fictional. Never execute host commands, change host settings, or contact real services. Local runtime assets only.
- Preserve the default Messages reference scene. Keep a deterministic fictional clock; elapsed-time displays must not silently replace the scene date with the host date.
- Verify through the actual Rust-served browser UI and the equivalent direct feature commands: useful action, empty/error state, keyboard/focus behavior, close/minimize retention, and resizing where relevant. Record observed results and visual limitations.
- Finish each slice by updating its research/working notes, this checklist, and relevant user docs; commit explicitly affected files. Do not mark an entire app complete while its sub-interfaces remain open.

### Current checkpoint

The default Mojave Messages scene is unchanged. High Sierra 10.13 (2017), Sonoma 14.0 (2023), and Windows 11 Pro 23H2 build 22631.2428 (2023) have separately researched native shell/app presentation, inventories and assets. macOS retains functional plain-text Notes, fixed Messages, bounded Finder locations/utilities and a working managed Dock preference pane; other interiors remain launch-only. Windows has native Start/taskbar/chrome, shell panels/dialogs and ten functional offline app simulations with shared virtual files, preferences and fictional Clock. Wider researched inventories are not implementation claims.

Browser-local typed discovery exposes 113 commands in Mojave/Sonoma, 105 in High Sierra, and 188 in Windows (`CORE-01` through `CORE-06`, plus `OS-05` through `OS-13`). Fresh profile selection resets incompatible data/view state behind a stable controller reference. All installed profiles support physical edge/corner resizing, stable logical restore geometry, explicit app/new-window/quit lifetime, native desktop selection/marquee/rename/group drops and context creation/Info/Trash/sort/cleanup/view options. They now have frozen native application/window switching and stable window cycling; macOS adds retained group Hide/Show/Hide Others/Show All and functional bounded application-menu leaves, while Windows restores exact minimized windows and closes through real prompts. Browser-reserved shortcuts remain untouched. Mojave/Sonoma add real document Stacks and up to three recent unpinned app aliases from successful app use. All three Mac profiles have native Dock app/folder/window/context actions, real bundle/folder alias addition, protected main/file-side ordering/removal, live minimized-window tiles, size/magnification/auto-hide/minimize-into-app preferences and live App Exposé. Real folder stacks offer fan/grid/list/nested file opening and native preferences; Trash artwork/count follows actual deleted records. Alias editing preserves sources/lifetime; projection retains window data/geometry, and auto-hide reserves zero workspace. Full filesystem/Trash/Finder workflows, rich interiors and remaining menus/preferences remain queued. Implemented contracts and verification notes are in [the command inventory](feature-commands.md).

Evidence: [README](../README.md), [Mojave fidelity](mojave-fidelity.md), [Notes working notes](notes-mojave.md), [Windows shell](windows11-profile.md), [Windows apps](windows11-apps.md), and [conditional Ubuntu research](ubuntu-24.04-profile.md). The future Ubuntu 24.04/GNOME 46 candidate is source-inventoried but not installed or advertised; Default/minimal and extended/optional apps remain distinct.

### Iteration order

Use this order unless a scene requirement changes priority. Section order is a grouping, not a requirement to finish every utility before returning to a core app.

1. **Command foundation + menu behavior + Messages:** implement `CORE-01` with a working existing action and `CORE-02` for existing behavior, then `MENU-01`, `MENU-02`, and `MSG-02` through `MSG-05`. Make the existing hero app interactive without changing its initial appearance.
2. **Files + Finder + Preview:** `FS-01` through `FS-03`, `FND-01` through `FND-05`, `PRE-01` through `PRE-03`, and the necessary common file dialogs.
3. **Safari:** offline browsing, navigation, tabs, bookmarks, history, downloads, and local page forms.
4. **System surfaces:** Apple menu, About This Mac, Spotlight, Notification Center, status menus, and the first System Preferences panes.
5. **Communication and planning:** Contacts, Mail, Calendar, Reminders; connect their data to existing apps.
6. **Documents and media:** TextEdit, remaining Notes, Photos, QuickTime Player, iTunes, Books, and the remaining Preview tools.
7. **Remaining bundled apps and utilities:** Launchpad, Mission Control, Dashboard, Maps, Calculator, creative/office add-ons, and diagnostic interfaces.
8. **Completion pass:** finish every researched app menu and secondary dialog; verify cross-app workflows and visual/state consistency.

**Next sequential item: `OS-14` — Browser-contained full-screen mode, menu/Dock reveal, and Mojave-style Split View pairing; never change host display settings.** Linux research is complete but implementation remains conditional. Rust/WebSocket transport remains deferred.

## Architecture foundations and future OS profiles

- [x] `CORE-01` — Implement a minimal transport-neutral browser-local feature command entry point with stable names, serializable payloads, explicit targets, and inspectable results; prove a real existing workflow without introducing WebSocket/controller infrastructure.
- [x] `CORE-02` — Route existing desktop, Dock, windows, Window menu, and Notes actions through feature handlers shared by UI and direct command callers; include selection/search/focus/menu presentation state and unavailable-action behavior.
- [x] `CORE-03` — Publish and maintain a command inventory for every implemented slice; commands, target identities, supported profiles, required state, data/presentation effects, and asynchronous completion where relevant.
- [x] `CORE-04` — Establish explicit OS-profile identity and capability boundaries around the current Mojave scene, app registry, shell, assets, and behavior; share simulation operations where semantics genuinely match rather than imposing Mojave conventions on every OS.
- [x] `CORE-05` — Research and add further macOS releases across years as separate profiles, each with a version-specific app/menu/sub-interface inventory and researched assets/behavior.
- [x] `CORE-06` — Research a specific Windows 11 release/build and add its shell, applications, menus, settings, dialogs, and profile command adapters using the same feature-contract principles.
- [x] `CORE-07` — Investigate a future Linux profile: choose distribution, desktop environment, and version before making its UI inventory. Conditional future scope, not a required next platform.

## 1. Desktop, Dock, windows, and session behavior

- [x] `OS-01` — Dock launch/focus/restore, application running indicators, and one managed window per registered app (initial policy extended by `OS-06`).
- [x] `OS-02` — Desktop icon selection and double-click/Enter opening; contextual Finder/Preview titles.
- [x] `OS-03` — Active/inactive chrome, focus/stacking, bounded dragging, close, minimize, and workspace zoom/restore.
- [x] `OS-04` — Viewport fitting, minimized-window restoration after resize, and Dock clearance including fractional pixels.
- [x] `OS-05` — Edge/corner window resizing with app-specific minimum sizes and stable restore geometry.
- [x] `OS-06` — Multiple document/browser/Finder windows; separate app lifecycle from window lifecycle; new window, reopen, and quit behavior.
- [x] `OS-07` — Desktop multi-selection, keyboard selection, marquee selection, inline rename, and drag/drop into simulated locations.
- [x] `OS-08` — Desktop context menu: New Folder, Get Info, rename, move to Trash, sort, clean up, and view options.
- [x] `OS-09` — Mojave desktop Stacks: grouping, expand/collapse, stack navigation, and sorting.
- [x] `OS-10` — Dock context menus: app windows, open/quit, Keep in Dock, Show in Finder, and supported options.
- [x] `OS-11` — Dock rearranging, add/remove app shortcuts, recent apps, minimized window tiles, size, magnification, and auto-hide.
- [x] `OS-12` — Downloads/folder Dock stacks: fan/grid/list presentations and file opening; Trash empty/nonempty state.
- [x] `OS-13` — Application switcher and window cycling; app hide/show and hide others without losing state. Account for browser-reserved shortcuts.
- [ ] `OS-14` — Browser-contained full-screen mode, menu/Dock reveal, and Mojave-style Split View pairing; never change host display settings.
- [ ] `OS-15` — Mission Control: window overview, select a window, Spaces strip, move windows between virtual desktops, and add/remove Spaces.
- [ ] `OS-16` — Launchpad: installed-app grid, search, page switching, folders, and editable app arrangement.
- [ ] `OS-17` — Dashboard: overlay/Space presentation and working clock, calculator, calendar, weather, and conversion widgets using local data.
- [ ] `OS-18` — Shared light/dark appearance and supported Mojave accent/highlight colors, applied to all implemented surfaces.
- [ ] `OS-19` — Login, lock screen, fast-user-switch presentation, guest/local fictional profiles, and return to retained desktop state.
- [ ] `OS-20` — Screen saver, simulated sleep/wake, restart, shutdown, and startup presentation; deterministic effects confined to the page.
- [ ] `OS-21` — Frontend-only scene reset and seed-data replacement for manual development/verification, without adding operator controls to the actor desktop.
- [ ] `OS-22` — Consistent session retention across all apps; optional browser-local saved sessions with an explicit reset, never Rust/controller persistence in this phase.

## 2. Menu bar, global commands, and system menus

- [x] `MENU-00` — Window menu: close/minimize/zoom, active-window indication, switching/restoring windows, keyboard navigation, and dismissal.
- [ ] `MENU-01` — Shared top-level/submenu behavior: click/hover switching, arrows/Home/End, Enter, Escape, focus return, separators, checks, shortcuts, and viewport-safe placement.
- [ ] `MENU-02` — Active-app menu routing; app-specific menu headings and command availability from actual selection/document/window state.
- [ ] `MENU-03` — App menu: About, Preferences, Services submenu, Hide, Hide Others, Show All, and Quit; keep Finder's special lifecycle correct.
- [ ] `MENU-04` — File menu conventions: new/open/recent/close/save/duplicate/export/print where the current app supports them; researched app-specific differences.
- [ ] `MENU-05` — Edit menu: undo/redo, cut/copy/paste, select all, find/replace, spelling options, and text substitutions where supported.
- [ ] `MENU-06` — View menu: toolbars, sidebars, zoom, sorting, and presentation modes connected to each app.
- [ ] `MENU-07` — Window extensions: Bring All to Front, next/previous document window, and app-specific auxiliary panels.
- [ ] `MENU-08` — Help menu: menu-command search with command-location highlighting, local app help, and searchable offline articles.
- [ ] `MENU-09` — Services and contextual actions: selected text lookup, create note, contact/message/mail actions, and supported file actions across apps.
- [ ] `APPLE-01` — Apple menu and researched ordering: About This Mac, System Preferences, App Store, Recent Items, Force Quit, Sleep, Restart, Shut Down, Lock Screen, and Log Out.
- [ ] `APPLE-02` — About This Mac: Overview, Displays, Storage, Support, and Service; fictional Mojave/version/hardware details and linked System Information.
- [ ] `APPLE-03` — Storage management sub-interface: recommendations and Applications/Documents/iCloud Drive/Mail/Trash categories operating on the virtual filesystem.
- [ ] `APPLE-04` — Recent Items: applications, documents, fictional servers, open actions, and clear history.
- [ ] `APPLE-05` — Force Quit Applications dialog: selected app termination, retained/safely handled documents, and Finder relaunch.
- [ ] `APPLE-06` — Logout/restart/shutdown confirmations, cancellation, save-changes handling, and reopen-windows behavior inside the simulation.
- [ ] `STATUS-01` — Wi-Fi menu: power toggle, fictional networks, join/password sheet, disconnected/joined states, and Open Network Preferences.
- [ ] `STATUS-02` — Battery menu: charge/charging presentation, percentage visibility, app energy list, Energy Saver link, and low-battery states.
- [ ] `STATUS-03` — Date/time menu: analog/digital and date display settings, shared scene clock, and Date & Time preferences link; no modern calendar flyout assumption.
- [ ] `STATUS-04` — Volume menu: mute/volume and fictional input/output device selection, linked to Sound preferences and media apps.
- [ ] `STATUS-05` — Bluetooth menu: on/off, paired devices, connect/disconnect, pairing sheets, and preferences link.
- [ ] `STATUS-06` — Input-source menu and keyboard viewer/character viewer launch; supported fictional input languages.
- [ ] `STATUS-07` — Optional Mojave menu extras: Time Machine, displays/AirPlay, accessibility, VPN, and fast user switching, only when enabled by relevant preferences.
- [ ] `STATUS-08` — Siri surface: invoke/dismiss, typed requests, simulated transcripts, app launch/search/clock/weather responses, and local help; no cloud voice service.

## 3. Spotlight, notifications, and common secondary interfaces

- [ ] `SPOT-01` — Spotlight overlay: query, grouped apps/documents/contacts/mail results, keyboard selection, and open/reveal actions.
- [ ] `SPOT-02` — Spotlight previews plus calculator, unit conversion, dictionary lookup, and local suggestions; indexing/privacy preferences respected.
- [ ] `NOTIF-01` — Mojave Notification Center Today/Notifications tabs, collapse/expand, dismiss/clear, and chronological grouping.
- [ ] `NOTIF-02` — Today widgets: date, weather, calendar, reminders, stocks, calculator, world clock, and widget editing using the scene data.
- [ ] `NOTIF-03` — Banner/alert presentation, action buttons, Do Not Disturb, app settings, and open-to-correct-message/event/document behavior.
- [ ] `DIALOG-01` — Shared alerts, confirmation sheets, modal focus, cancellation, default buttons, and correct owner-window behavior.
- [ ] `DIALOG-02` — Open/save dialogs: compact/expanded forms, sidebar, path navigation, file filters, new folder, filename, collision replacement, and cancel; virtual files only.
- [ ] `DIALOG-03` — Unsaved-document close/quit sheets: Save, Don't Save, Cancel, and recovery after interruption where supported.
- [ ] `DIALOG-04` — Print sheet: preview, pages/copies/layout, fictional printer selection, and PDF save to virtual files; simulated print queue, no host printing.
- [ ] `DIALOG-05` — Share menu: supported Mail/Messages/Notes destinations, recipients, compose sheets, and resulting local records; fictional AirDrop separately.
- [ ] `DIALOG-06` — Font panel, color panel, ruler, character/emoji viewer, and text-format controls shared by real document workflows.
- [ ] `DIALOG-07` — Find bar/find window, next/previous match, replace, case/whole-word options, and app-specific search scopes.
- [ ] `DIALOG-08` — Get Info and Inspector windows: file/app metadata, preview, name, tags, permissions presentation, and editable supported fields.
- [ ] `DIALOG-09` — Quick Look: image/PDF/text/media preview, navigation between selected files, full-window preview, Open With, and supported markup.
- [ ] `DIALOG-10` — Screenshot toolbar: display/window/region capture, preview thumbnail, markup, options, and saving within the virtual filesystem; no host screen capture.
- [ ] `DIALOG-11` — AirDrop discovery/send/receive surfaces with fictional nearby devices, acceptance choices, and actual virtual-file transfers.
- [ ] `DIALOG-12` — Local password/authentication and privacy-consent sheets: fictional accounts and app permissions; never ask for real Apple credentials.
- [ ] `DIALOG-13` — Simulated network/account failure, missing file, unsupported format, busy operation, and recovery dialogs with working cancel/retry paths.

## 4. Shared virtual files and cross-app state

- [ ] `FS-01` — In-memory filesystem: stable file/folder IDs, parent relationships, MIME/type information, contents, timestamps, and seeded Macintosh HD/Users/Personal/Documents/Desktop/Downloads/Applications/Trash locations.
- [ ] `FS-02` — Create, rename, move, copy, duplicate, delete, restore, and empty Trash; handle collisions and reject invalid folder cycles without corrupting data.
- [ ] `FS-03` — File associations and Open With: PDF/image → Preview, text → TextEdit, media → appropriate player, app bundle → app launch.
- [ ] `FS-04` — Tags, labels, favorites, recents, search index, smart folders, and shared file metadata.
- [ ] `FS-05` — Drag/drop and simulation clipboard: files between locations/apps, text between editors, and explicit ownership/undo behavior.
- [ ] `FS-06` — Shared contacts and fictional identities used by Messages, Mail, Calendar, FaceTime, and sharing sheets.
- [ ] `FS-07` — Shared event/reminder/notification data and scene clock; prevent contradictory dates and duplicate updates between surfaces.
- [ ] `FS-08` — Offline content fixtures: websites, mail, PDFs, images, audio/video, maps, news, books, and fictional account/device data with documented asset rights.
- [ ] `FS-09` — Cross-app actions: attachment save/open, mail/contact/message links, event invitations, Photos export, Notes attachment preview, and downloaded-file opening.

## 5. Finder

- [ ] `FND-01` — Working browser interior: sidebar, favorites/devices/tags, title/path, folder contents, back/forward, and location switching.
- [ ] `FND-02` — Icon, list, column, and **Mojave Gallery** views; selection, sorting, grouping, resizable columns, and view options.
- [ ] `FND-03` — File/folder creation, rename, duplicate, copy/paste, move to Trash, restore, and Empty Trash confirmation.
- [ ] `FND-04` — Toolbar: navigation, view controls, action menu, sharing, tags, search, and configurable visibility.
- [ ] `FND-05` — Finder File/Edit/View/Go/Window/Help menus and context menus; Go to Folder, recent folders, enclosing folder, Home, Desktop, Downloads, and Applications.
- [ ] `FND-06` — Search current folder/This Mac, attribute filters, saved searches, and Smart Folders with meaningful empty results.
- [ ] `FND-07` — Quick Look, Get Info, inspector, preview pane, Quick Actions, rotate/markup/Create PDF, and Open With.
- [ ] `FND-08` — Multiple Finder windows/tabs, tab movement, path/status bars, sidebar editing, and Finder Preferences tabs.
- [ ] `FND-09` — Recents, iCloud Drive presentation, fictional mounted drives, eject, Connect to Server sheet, network browsing, and AirDrop.
- [ ] `FND-10` — Copy/move progress, collision choices, permissions/errors, aliases, and compress/expand archives through Archive Utility.

## 6. Messages

- [x] `MSG-01` — Researched Mojave light chrome and fixed reference conversation/history with local artwork.
- [ ] `MSG-02` — Select conversations, unread indicators, search conversation/contact/history, and appropriate empty states.
- [ ] `MSG-03` — Compose/send plain-text messages, timestamps, local delivery states, drafts, and retained history across window lifetimes.
- [ ] `MSG-04` — New conversation: recipient picker/autocomplete, multiple recipients, contact resolution, and duplicate-thread handling.
- [ ] `MSG-05` — App/File/Edit/View/Buddies/Window/Help menus and researched Preferences panels; real local actions for supported commands.
- [ ] `MSG-06` — Details panel: participants, group title, Do Not Disturb, shared attachments, and simulated location sharing.
- [ ] `MSG-07` — Photo/file attachments, drag/drop, inline preview, Quick Look, save/open, and image expansion.
- [ ] `MSG-08` — Emoji picker, audio-message interface using local clips, supported message reactions, and contextual copy/delete actions after Mojave verification.
- [ ] `MSG-09` — Rename/group/leave/delete conversations and confirmations, blocked fictional contacts, and account signed-in/signed-out state.
- [ ] `MSG-10` — Incoming-message presentation and notification/open-thread behavior using frontend-local interactions/fixtures; no controller protocol yet.

## 7. Safari

- [ ] `SAF-01` — Offline browser: address/search field, local URL resolver, fictional search results, page loading/error states, back/forward/reload/stop, and actual rendered local pages.
- [ ] `SAF-02` — Tabs, new windows, close/reopen, tab overview, pinned tabs, private-window state, and session retention.
- [ ] `SAF-03` — Start/Favorites page, bookmarks bar, bookmark/folder editing, sidebar, Reading List, and history/search/clear history.
- [ ] `SAF-04` — Downloads popover, progress/cancel/retry, virtual downloaded files, and reveal/open in Finder.
- [ ] `SAF-05` — Reader view, page zoom, find on page, share sheet, print/save PDF, and local page source where supported.
- [ ] `SAF-06` — Fictional login/form submission, password/autofill sheet, per-site permissions, and deterministic navigation results; no actual credentials or external requests.
- [ ] `SAF-07` — App/File/Edit/View/History/Bookmarks/Window/Help menus; Preferences General/Tabs/AutoFill/Passwords/Search/Security/Privacy/Websites/Extensions/Advanced after exact-version research.
- [ ] `SAF-08` — Website-specific settings, blocked pop-up presentation, certificate/security details, offline page errors, and local Develop/Web Inspector if enabled.

## 8. Mail

- [ ] `MAIL-01` — Three-pane inbox: mailbox sidebar, message list, sender/date/unread/flag state, and message reading with local HTML/text content.
- [ ] `MAIL-02` — Mailboxes and account disclosure: Inbox/Sent/Drafts/Archive/Junk/Trash, custom folders, smart mailboxes, favorites, and unread counts.
- [ ] `MAIL-03` — Compose/new window, recipients/CC/BCC autocomplete, subject/body, drafts, send to fictional outbox/sent, and cancel/save draft.
- [ ] `MAIL-04` — Reply/reply all/forward, quoted content, attachments, formatting, signature selection, and priority where native.
- [ ] `MAIL-05` — Search/filter/sort, conversations, flags, mark read/unread, archive, junk, move, delete/restore, and bulk selection.
- [ ] `MAIL-06` — Attachment preview/save/open, message header details, contact creation, and calendar invitation actions.
- [ ] `MAIL-07` — App/File/Edit/View/Mailbox/Message/Format/Window/Help menus and toolbar customization.
- [ ] `MAIL-08` — Preferences: General, Accounts, Junk Mail, Fonts & Colors, Viewing, Composing, Signatures, and Rules; working fictional-account changes and rule application.
- [ ] `MAIL-09` — Account setup, connection activity, offline/send-failed state, retry/cancel, and Connection Doctor presentation; no real email transport.

## 9. Contacts

- [ ] `CON-01` — Groups/list/card layout, search, sorting, selection, photos, and empty states.
- [ ] `CON-02` — Create/edit/delete contacts; names, organizations, phones, addresses, email, URLs, birthdays, notes, and custom labels.
- [ ] `CON-03` — Groups, membership, Smart Groups, duplicate detection/merge, and My Card selection.
- [ ] `CON-04` — Message/mail/call actions, vCard import/export to virtual files, sharing, and print/contact lists.
- [ ] `CON-05` — Menus and preferences, card templates, account presentation, and linked-card/duplicate-resolution dialogs.

## 10. Calendar

- [ ] `CAL-01` — Day/week/month/year views, Today, date navigation, calendar sidebar, visibility/color, and scene-date selection.
- [ ] `CAL-02` — Create/edit/delete events, quick entry, all-day/timed events, duration, notes, URL, location, and attachments.
- [ ] `CAL-03` — Event popovers/inspectors, drag move/resize, recurring events and edit-series choices, time zones, and travel-time presentation.
- [ ] `CAL-04` — Calendar creation, sharing/account presentation, subscriptions, import/export, and search.
- [ ] `CAL-05` — Invitees, local invitation inbox, accept/decline/tentative, organizer updates, and Mail integration.
- [ ] `CAL-06` — Alerts and notification actions; menus and General/Accounts/Alerts/Advanced preferences after version verification.

## 11. Notes and Reminders

### Notes

- [x] `NOTE-01` — Plain-text create/edit, title fallback, multiline body, deterministic ordering, search, and initial seed notes.
- [x] `NOTE-02` — Pin/unpin, delete/Recently Deleted/restore, empty states, sidebar toggle, context menu, and keyboard focus/navigation.
- [x] `NOTE-03` — Parent-owned session state retained through close/minimize; reload resets the fictional scene.
- [ ] `NOTE-04` — App/File/Edit/Format/View/Window/Help menus and researched Notes Preferences; route existing working actions first.
- [ ] `NOTE-05` — Custom folders, move notes, folder deletion/recovery rules, multiple collections, and fictional account sections.
- [ ] `NOTE-06` — Rich text: title/headings/body, emphasis, lists, indentation, checklist toggles, and undo/redo with stable editor selection.
- [ ] `NOTE-07` — Tables: add/remove rows/columns, cell navigation, and table content retained through edits and reopening.
- [ ] `NOTE-08` — Attachments and attachment browser, image/PDF previews, drag/drop, sharing, and export/print.
- [ ] `NOTE-09` — Locked-note/password sheets using fictional secrets, unlock/relock, sharing/collaboration presentation, and account options.
- [ ] `NOTE-10` — Permanent deletion confirmations and an explicit deterministic retention policy for Recently Deleted; no host-time-driven disappearance.

### Reminders — Mojave design, not the Catalina redesign

- [ ] `REM-01` — List sidebar, named/color-coded lists, create/edit reminders, completion toggles, search, and completed-item visibility.
- [ ] `REM-02` — Reminder inspector: due date/time, priority, notes, recurrence, and fictional location triggers.
- [ ] `REM-03` — List creation/deletion, move/reorder reminders, local sharing/account presentation, and Calendar/notification integration.
- [ ] `REM-04` — Menus, preferences, scheduled views, and reminder alert/snooze/complete transitions after Mojave research.

## 12. Preview and TextEdit

### Preview

- [ ] `PRE-01` — Open seeded Itinerary.pdf; real local PDF/image rendering, scroll/pages, thumbnails, zoom, fit, and rotation.
- [ ] `PRE-02` — PDF text search/selection, contents/bookmarks where present, page navigation, inspector, and multiple documents.
- [ ] `PRE-03` — Menus/toolbars, sidebar modes, open/save/export, print sheet, and document state/close confirmation.
- [ ] `PRE-04` — Markup toolbar: shapes, text, highlight, drawing, colors, line styles, and undo/redo with saved document changes.
- [ ] `PRE-05` — Image crop/resize/adjust-color and PDF page reorder/insert/delete/merge; defined supported formats.
- [ ] `PRE-06` — Signature creation from typed/drawn fictional signature, form filling, PDF lock/password interfaces, and export options.

### TextEdit

- [ ] `TXT-01` — New/open/save plain-text documents, multiple windows, undo/redo, find/replace, and unsaved-changes sheets.
- [ ] `TXT-02` — Rich-text document mode: fonts/colors/styles, alignment, spacing, lists, ruler/tabs, tables, and links.
- [ ] `TXT-03` — Format conversion, supported local encodings/file types, attachments, print/PDF, and spelling/substitution behavior.
- [ ] `TXT-04` — App/File/Edit/Format/View/Window/Help menus and New Document/Open and Save preferences.

## 13. Photos, camera, and audiovisual apps

### Photos

- [ ] `PHOTO-01` — Library navigation/grid, moments/collections/years as verified for Mojave, photo viewer, zoom, metadata, and selection.
- [ ] `PHOTO-02` — Albums/folders, favorites, hidden items, Recently Deleted, search, and supported People/Places presentation.
- [ ] `PHOTO-03` — Import local virtual images, export/open/share, duplicate/delete/restore, and retained library state.
- [ ] `PHOTO-04` — Editor: crop/rotate, adjustments, filters, compare original, revert, and saved nondestructive changes.
- [ ] `PHOTO-05` — Slideshows, video playback, memories presentation, menus/preferences, and fictional iCloud/shared-album settings.

### QuickTime Player

- [ ] `QTP-01` — Movie/audio windows, play/pause, seeking, volume, time display, loop, full-window playback, and file opening.
- [ ] `QTP-02` — Trim, split/reorder clips, rotate/flip where supported, save/export, and modified-document handling.
- [ ] `QTP-03` — New Movie/Audio/Screen Recording interfaces using bundled fictional input or the simulated desktop; recorded output stays virtual, no host screen/device capture.
- [ ] `QTP-04` — Menus, movie inspector, export options, and source/device/quality submenus.

### iTunes — not Music/TV/Podcasts apps

- [ ] `ITUNES-01` — Media selector/library/sidebar: music, movies, TV shows, podcasts, audiobooks, and local playback appropriate to each type.
- [ ] `ITUNES-02` — Songs/albums/artists, search, playlists/Smart Playlists, playlist editing, queue, shuffle/repeat, and mini-player.
- [ ] `ITUNES-03` — Track information/artwork, import/export, rating/favorite, equalizer, visualizer, and playback history where native.
- [ ] `ITUNES-04` — Fictional Store/For You/Browse/radio and device-sync pages using local catalog/device data, without purchases or real account access.
- [ ] `ITUNES-05` — Menus/preferences, account/device dialogs, library switching, and media-download progress with real local results.

### Photo Booth

- [ ] `BOOTH-01` — Bundled fictional camera feed, single/four-shot/video modes, countdown, flash, capture results, and thumbnail strip.
- [ ] `BOOTH-02` — Effects picker, captured-media playback, delete/export/share, and menus; no webcam permission required.

### Voice Memos

- [ ] `VOICE-01` — Mojave memo list, search, play/seek, rename/delete, recording UI against local fictional audio, and retained clips.
- [ ] `VOICE-02` — Edit/trim/replace interfaces, recovery behavior as actually available in Mojave, sharing, menus, and preferences.

## 14. Other bundled applications

### FaceTime

- [ ] `FACE-01` — Recent calls, search/recipient picker, fictional account state, contact actions, and audio/video call initiation.
- [ ] `FACE-02` — Ringing/connecting/in-call/ended states, local participant imagery/video, mute/camera/full-window controls, and call failure.
- [ ] `FACE-03` — Group-call UI only for the researched Mojave point release; menus/preferences, blocked callers, and notifications.

### Maps

- [ ] `MAP-01` — Local map surface, pan/zoom, search, pins/place cards, map/satellite modes, and fictional current location.
- [ ] `MAP-02` — Directions, transport mode, route choices/steps, favorites/recents, supported traffic/transit views, and sharing/print.
- [ ] `MAP-03` — Menus and place/direction sub-interfaces using locally bundled map data, not live map APIs.

### Books

- [ ] `BOOK-01` — Library collections, covers/list/search/sort, import/remove, local EPUB/PDF reading, and open-in-Preview behavior.
- [ ] `BOOK-02` — Reader navigation, contents, bookmarks/highlights/notes, search, typography/appearance, and reading progress.
- [ ] `BOOK-03` — Fictional Book Store/account/download pages, menus, and preferences; no purchases or DRM integration.

### Calculator

- [ ] `CALC-01` — Basic/scientific/programmer modes, keyboard entry, memory, operator precedence, and error states.
- [ ] `CALC-02` — Unit/currency conversion using fixed scene rates, paper tape, copy/paste, and menus.

### Dictionary

- [ ] `DICT-01` — Local dictionary/thesaurus/Apple terminology corpus, lookup/search, history, result formatting, and source selection.
- [ ] `DICT-02` — Preferences, local encyclopedia-style entries, pronunciation from available local clips, and system Lookup integration.

### Stickies

- [ ] `STICK-01` — Multiple editable sticky-note windows, colors, collapse/expand, arrange, close confirmation, and retained notes.
- [ ] `STICK-02` — Fonts/text styles, floating/translucent options, find, import/export, and menus.

### Stocks

- [ ] `STOCK-01` — Watchlist editing/search, local prices/change, quote detail, time-range charts, and scene-consistent refresh.
- [ ] `STOCK-02` — Local business-news stories, article reader, sharing, menus, and notification/widget integration.

### News — region-dependent Mojave availability

- [ ] `NEWS-01` — Offline Today/feed/sidebar, channels/topics, story reader, follow/unfollow, saved/history, and search.
- [ ] `NEWS-02` — Menus, preferences, notification/share interfaces, and region-appropriate seeded content; no later News+ assumptions.

### Home

- [ ] `HOME-01` — Fictional home/room/accessory grid, favorite accessories, device detail sheets, and visible state changes.
- [ ] `HOME-02` — Lights/thermostat/locks/camera presentation, scenes and automation editing as available in Mojave, and no real IoT access.
- [ ] `HOME-03` — Home settings, users/invitations, menus, and unavailable-device states.

### Chess

- [ ] `CHESS-01` — Board/pieces, legal moves, turn state, captures, undo, new game, and a playable local opponent or two-player mode.
- [ ] `CHESS-02` — Game settings, move list, save/open games, promotion/endgame dialogs, and menus/preferences.

### DVD Player — Mojave system-app availability/location to verify

- [ ] `DVD-01` — Fictional disc/movie loading, playback/controller, title/chapter selection, local disc menu, subtitles/audio tracks, and eject.
- [ ] `DVD-02` — Menus/preferences, bookmarks and supported playback options, with no optical-drive dependency.

### App Store

- [ ] `STORE-01` — Mojave Discover/Create/Work/Play/Develop/Categories/Updates navigation, search, app details, screenshots, and local reviews.
- [ ] `STORE-02` — Fictional Get/install/update/download/cancel flows that register working local apps and change Launchpad/Finder state.
- [ ] `STORE-03` — Account/purchased/sign-in surfaces and menus; no real payments, installations, Apple IDs, or modern subscription assumptions.

## 15. System Preferences — every pane and its secondary sheets

Each item includes its researched sub-tabs, controls, confirmation sheets, and visible effects elsewhere in JesterOS. Do not check a pane off just because its icon opens a static page. The hardware/region-dependent candidates below must be confirmed before inclusion.

- [ ] `PREF-01` — Main icon grid, Show All, search/highlight, navigation history, toolbar, app menu, and pane/window retention.
- [ ] `PREF-02` — General: appearance/accent/highlight, sidebar icon size, scrollbars, default browser, recent items, and document/window preferences.
- [ ] `PREF-03` — Desktop & Screen Saver: wallpaper folders/images, Mojave dynamic appearance driven by scene time, screen saver selection/preview, timing, and Hot Corners.
- [ ] `PREF-04` — Dock: size/magnification, position, minimization effect, auto-hide, indicators, recent apps, and minimize-into-app behavior.
- [ ] `PREF-05` — Mission Control: Spaces behavior, shortcuts, Dashboard mode, and Hot Corners with visible simulated results.
- [ ] `PREF-06` — Language & Region: preferred languages, region/date/number/time formats, advanced sheets, and shared formatter behavior.
- [ ] `PREF-07` — Security & Privacy: General/FileVault/Firewall/Privacy, lock/auth sheets, app permission lists, and fictional security-state changes.
- [ ] `PREF-08` — Spotlight: search result categories, privacy exclusions, index behavior, and linked keyboard shortcuts.
- [ ] `PREF-09` — Notifications: per-app alert style, badges/sounds/previews, Do Not Disturb scheduling, and actual notification behavior.
- [ ] `PREF-10` — Displays: display/resolution/scaling/color/night-shift surfaces, arrangement for fictional monitors, and simulated mirroring; never modify host displays.
- [ ] `PREF-11` — Energy Saver: battery/power-adapter controls, sleep/display timers, scheduling sheet, and battery-menu option; simulated power only.
- [ ] `PREF-12` — Keyboard: Keyboard/Text/Shortcuts/Input Sources/Dictation, modifier-key sheet, text replacements, input sources, and supported local effects.
- [ ] `PREF-13` — Mouse: pointing/scrolling/button settings against a fictional supported device; relevant simulated pointer behavior only.
- [ ] `PREF-14` — Trackpad: Point & Click/Scroll & Zoom/More Gestures, local demonstration media, and gestures supported by the browser surface.
- [ ] `PREF-15` — Printers & Scanners: fictional device list, add printer/IP sheets, options/supplies, print queue, default paper/printer, and local scan result.
- [ ] `PREF-16` — Sound: Sound Effects/Output/Input, alert sound selection, volume/mute/balance, and fictional device selection shared with media/menu state.
- [ ] `PREF-17` — Startup Disk: fictional boot volumes, lock/authentication, selection, and simulated restart confirmation.
- [ ] `PREF-18` — iCloud: fictional account overview, per-app options, storage management, sign-in/sign-out sheets; **not** a modern Apple ID pane.
- [ ] `PREF-19` — Internet Accounts: provider picker, fictional account setup/edit/remove, per-app services, and failure/confirmation sheets.
- [ ] `PREF-20` — Software Update: check/update status, available Mojave-era updates, details, advanced options, download progress, and simulated restart.
- [ ] `PREF-21` — Network: service list, Wi-Fi/Ethernet/VPN, status, locations, assist/advanced sheets, TCP/IP/DNS/proxy settings, and local connection results.
- [ ] `PREF-22` — Bluetooth: discovery, pair/connect/remove sheets, device details, advanced options, and shared status-menu state.
- [ ] `PREF-23` — Extensions: supported action/share/Finder/Today extension categories, enable/disable, and real effects on those surfaces.
- [ ] `PREF-24` — Sharing: computer name, fictional services, users/access lists, options, and simulated discovery metadata.
- [ ] `PREF-25` — Users & Groups: local users, add/remove user sheets, password/My Card, login items/options, lock/auth, and fast user switching.
- [ ] `PREF-26` — Parental Controls: fictional managed user, apps/web/stores/time/privacy/other controls as researched, and enforcement in the pseudo-OS.
- [ ] `PREF-27` — Siri: enable/disable, language/voice/input/feedback controls, menu visibility, and supported typed-request behavior.
- [ ] `PREF-28` — Date & Time: Date & Time/Time Zone/Clock, fictional synchronization, local scene date/time edits, and shared app/status formatting.
- [ ] `PREF-29` — Time Machine: fictional backup disk selection/exclusions, status/history, menu visibility, and virtual-file backup/restore.
- [ ] `PREF-30` — Accessibility: General, display/zoom, speech, audio, captions, keyboard/mouse, VoiceOver, Switch Control and other Mojave categories after research; supported controls affect the simulated UI.
- [ ] `PREF-31` — Touch ID: conditional fictional hardware, enroll/remove fingerprint flow and usage switches; no real biometric collection.
- [ ] `PREF-32` — Profiles: configuration-dependent pane, profile list/detail/install/remove/auth sheets, and supported fictional settings application.
- [ ] `PREF-33` — Ink: include only if researched tablet-dependent Mojave hardware configuration warrants it; local handwriting/control presentation, no driver installation.

## 16. Utilities and system application sub-interfaces

### Terminal

- [ ] `TERM-01` — Mojave terminal window/tabs, prompt, editable input, history, selection, copy/paste, scrollback, profiles/colors/fonts, and menus.
- [ ] `TERM-02` — Bounded fictional shell over virtual files: `pwd`, `ls`, `cd`, `cat`, `echo`, `mkdir`, `cp`, `mv`, `rm`, and supported redirection; real simulated state transitions, no host process execution.
- [ ] `TERM-03` — Local process/network command presentation, clear/interrupt, command-not-found/errors, and editable fictional SSH sessions with deterministic outcomes.

### Activity Monitor

- [ ] `ACT-01` — CPU/Memory/Energy/Disk/Network tabs, process table/search/sort, scene-derived graphs, and a consistent local process inventory.
- [ ] `ACT-02` — Process inspector, quit/force-quit confirmation, sample/statistics windows, menus/preferences, and effects on corresponding simulated apps.

### Console

- [ ] `LOG-01` — Fictional devices/log sources, streaming/pause, search/filter, severity, detail inspector, and clear/export.
- [ ] `LOG-02` — Reports/crash reports, saved searches, menus, and logs tied to actual simulated app/system actions rather than random chatter.

### Disk Utility

- [ ] `DISK-01` — Devices/volumes sidebar, capacity/usage, Info, view options, image opening, and seeded fictional disk structure.
- [ ] `DISK-02` — First Aid, erase, partition, mount/unmount, restore, disk-image create/convert sheets and progress; destructive changes confined to virtual disks with confirmation.

### System Information

- [ ] `INFO-01` — Hardware/Network/Software tree, researched detail tables, summary/search, and consistency with About This Mac and preferences.
- [ ] `INFO-02` — Save/open report, print, menus, and detailed fictional device/software inventory.

### Keychain Access

- [ ] `KEY-01` — Fictional keychains/categories/items, search, item inspector, access/password/certificate tabs, and lock/unlock states.
- [ ] `KEY-02` — Add/edit/delete/import/export items, certificate info/trust sheets, password generator, and menus using invented secrets only.

### Font Book

- [ ] `FONT-01` — Collections/font list, preview modes/sample text, search, enable/disable, and metadata for distributable local fonts.
- [ ] `FONT-02` — Collection editing, validate/resolve duplicates, virtual install/remove, menus/preferences, and selection in document font panels.

### Image Capture

- [ ] `CAP-01` — Fictional camera/scanner sidebar, image table/preview, selection, import destination, import/delete, and resulting virtual files.
- [ ] `CAP-02` — Scan preview/options/progress/result, device configuration, and menus without camera/scanner hardware access.

### Audio MIDI Setup

- [ ] `MIDI-01` — Audio Devices window, fictional input/output properties, channel/format/volume, aggregate/multi-output devices, and speaker configuration.
- [ ] `MIDI-02` — MIDI Studio device/connection view, setup/property sheets, test presentation, and menus; no real audio/MIDI reconfiguration.

### ColorSync Utility

- [ ] `COLOR-01` — Profile First Aid, profiles/devices/filters views, profile information, and compare/repair workflows over virtual profiles.
- [ ] `COLOR-02` — Calculator/image processing interfaces, supported conversions/filters, menus, and virtual-file results.

### Digital Color Meter

- [ ] `METER-01` — Color sampling from the simulated desktop, magnification/aperture, display formats/color spaces, freeze, copy, and menus.

### Grapher

- [ ] `GRAPH-01` — New graph templates, equation list/editor, supported 2D/3D plotting, axes/range/zoom, and local document save/open.
- [ ] `GRAPH-02` — Graph/equation inspectors, animation for supported expressions, export/print, and menus; define supported math rather than accepting inert equations.

### Script Editor and Automator

- [ ] `SCRIPT-01` — Script document editor, history/results/log panels, compile/run/stop for a bounded documented language that controls simulated apps only, and save/open.
- [ ] `SCRIPT-02` — Dictionary browser, menus/preferences, script properties, errors, and permitted simulated scripting commands.
- [ ] `AUTO-01` — Workflow document types, action library/search, workflow editor, parameters, variables, and save/open.
- [ ] `AUTO-02` — Run/stop/results/log against virtual files/apps; useful rename/copy/image/document workflows and menus, not arbitrary host automation.

### Archive Utility

- [ ] `ARCH-01` — Compress/expand supported local virtual archives, progress/cancel, collision/error handling, and actual resulting virtual files.
- [ ] `ARCH-02` — Mojave preferences/menus and Finder integration; verify its system-app location rather than adding an invented Dock presence.

### Network Utility and AirPort Utility

- [ ] `NET-01` — Network Utility Info/Netstat/Ping/Lookup/Traceroute/Whois/Finger/Port Scan interfaces as present in Mojave, with consistent fictional network responses and working start/stop.
- [ ] `AIR-01` — AirPort Utility topology, fictional base-station discovery/status, edit/device sheets, network/wireless/disks settings, and simulated update/restart results.

### Bluetooth File Exchange

- [ ] `BTFILE-01` — Virtual file picker, fictional device selection/pairing, send progress, acceptance/failure, and local destination result.

### Migration Assistant and Boot Camp Assistant

- [ ] `MIG-01` — Source/destination wizard, fictional computer/backup discovery, data selection, progress, completion, and cancellation; virtual-user/files migration only.
- [ ] `BOOT-01` — Researched Mojave Boot Camp wizard, ISO/partition choices, preparation/install progress, and virtual boot-volume result; never partition a host disk or install software.

### Time Machine restore interface

- [ ] `TIME-01` — Historical Finder stack/timeline, date selection, preview/search, restore/cancel, and collision handling against local virtual-file snapshots.

### VoiceOver Utility and accessibility auxiliaries

- [ ] `VO-01` — VoiceOver Utility categories, verbosity/speech/navigation/visual/audio/command settings and local training/preview surfaces as verified for Mojave.
- [ ] `VO-02` — Accessibility Keyboard, keyboard viewer, caption/zoom overlays, and supported simulated speech/reading behavior; never change host accessibility settings.

## 17. Commonly installed production apps — separate from the bundled OS

These are additional applications, not claims about the default Mojave installation. Research **Mojave-compatible contemporary versions** before implementing; do not use current cloud/editor UI. Keep them after the bundled core unless a shot needs them first.

- [ ] `PAGES-01` — Pages template chooser, document browser, editable pages, text/layout tools, inspector, media/tables/charts, menus, export/print, and virtual save/open.
- [ ] `NUM-01` — Numbers template chooser, sheets/tables, editable cells, supported formulas, formatting, sorting/filtering, charts, menus, export/print, and virtual save/open.
- [ ] `KEYNOTE-01` — Keynote theme chooser, slide navigator/editor, text/shapes/media, inspector, transitions, presentation mode, menus, export, and virtual save/open.
- [ ] `XCODE-01` — Period-correct Xcode project chooser, file navigator, code editor, search, inspectors, local fictional build/run results, issues/debug console, simulator presentation, and menus; no host compilation or real simulator.
- [ ] `CHROME-01` — Period-correct Chrome tabs/address/navigation, local web pages, history/bookmarks/downloads, settings, private windows, and menus over the same offline browsing model.
- [ ] `OFFICE-01` — Period-correct Word/Excel/PowerPoint document/template/editor/ribbon/dialog workflows if a production needs Microsoft Office rather than Apple's office apps; separate research and app-specific slices required.

## 18. Completion and integration passes

These remain separate tasks; implementing an app's primary window does not automatically complete them.

- [ ] `DONE-01` — Every registered application has a useful working interior; launch/focus/minimize/close/quit/reopen remain consistent after new apps are registered.
- [ ] `DONE-02` — Every researched top-level menu, submenu, context menu, toolbar popover, preference tab, and secondary window has working simulated behavior. Document unavoidable real-host/service boundaries; do not silently drop queued interfaces or mark unfinished controls complete.
- [ ] `DONE-03` — Cross-app file/contact/event/account/device data stay consistent; no stale selections or references after rename/move/delete/sign-out.
- [ ] `DONE-04` — Undo/redo, clipboard, draft/save/recovery, cancel, modal ownership, and focus return work across multi-window workflows.
- [ ] `DONE-05` — Keyboard and pointer paths, long labels/content, empty/filtered lists, errors, disabled conditions, and window/viewport boundaries exercised on each completed slice.
- [ ] `DONE-06` — Light/dark appearance, native-era fonts/chrome/icons, local asset provenance, and per-app Mojave visual evidence documented; keep Messages comparison regression visible.
- [ ] `DONE-07` — Offline audit: no external requests, missing assets, real credentials, host commands/settings effects, or permissions needed for default fixture workflows.
- [ ] `DONE-08` — Chronological implementation notes, README capability list, checklist status, and commits reflect exercised behavior rather than intended behavior.
- [ ] `DONE-09` — Every implemented feature, including temporary presentation state and externally initiated events, is reachable through documented commands; direct invocations and actor input produce equivalent specified behavior without DOM automation or a WebSocket server.
- [ ] `DONE-10` — OS-profile capability boundaries are explicit; future profiles do not inherit unsupported Mojave interfaces or silently accept unsupported commands.

## Deferred boundary — not part of this queue

Rust controller UI, paired screens, WebSocket transport/wire protocol, shared server scene state, SQLite persistence, operator timelines, take management, remote delivery of cues, multi-screen synchronization, and deployment/authentication for operators. Feature commands, browser-local invocation, and frontend-local incoming-event effects are part of the pseudo-OS work now. The later transport must call those interfaces rather than introduce a second behavior implementation.

## Session record

| Date | Checkpoint | Next slice |
| --- | --- | --- |
| 2026-10-04 | Created this inventory from the README, application registry, existing Desktop menu/status surfaces, and completed Notes work. Candidate app/pane details still require their own Mojave research. No runtime behavior changed. | `MENU-01` |
| 2026-10-04 | Added future macOS/Windows 11/possible Linux profiles and mandatory command interfaces for every feature. Added architecture/retrofit tasks without claiming existing UI already supports a universal interface. Controller and WebSocket transport remain deferred. | `CORE-01` |
| 2026-10-04 | Completed `CORE-01`: browser-local execute/inspect, shared Dock/file app opening, explicit rejections and detached snapshots. Production-browser smoke confirmed invalid requests do not mutate state, close/reopen retains Notes edits, repeated launch deduplicates, and contextual Finder titles work. Default desktop visually inspected; no page errors. | `CORE-02` |
| 2026-10-05 | Completed `CORE-02`: 31 shared commands cover existing shell/window/Notes behavior and semantic view state. Browser UI/direct-command proof covered invalid/no-mutation boundaries, keyboard/context actions, background versus visible-view requirements, retained scrolling, popup bounds, actor drag, and zoom/minimize resize restoration. Fixed offscreen row anchoring and late-scroll snapshot bookkeeping. No component warnings or final page errors. | `CORE-03` |
| 2026-10-05 | Completed `CORE-03`: describe() publishes 31 JSON Schema contracts, capabilities, runtime requirements, effects/completion semantics, and live app/file/window/menu/note identities. Strict schema checks and a real browser consumer proved nested returned IDs, creation/editing/movement/focus, detached pure queries, and current search/trash/folder/restore eligibility. Default surface visually unchanged; no final page errors. | `CORE-04` |
| 2026-10-05 | Completed `CORE-04`: immutable Mojave identity/stock coverage/assets/defaults, named native adapter and policy, guarded direct/composed handlers, detached metadata, and explicit no-fallback setup rejection. Default extraction measured zero changed pixels. Browser actor/resize/retention/file/menu workflows passed; real-domain regression and comparison suite 2 pass; no final component/page errors. | `CORE-05` |
| 2026-10-05 | Completed `CORE-05`: separate High Sierra 10.13 and Sonoma 14.0 native profiles, version-specific stock/menu/sub-interface research and local assets. Stable scene.selectProfile remounts fresh state, preserves same-ID state and rejects unknown/concurrent transition writes. Browser exercised all 32 commands in each profile (43 applied calls each), strict actual request/result schemas, actor edits/keyboard/context/menu/drag/chrome, period clocks, retained scroll/data and 390×844 refit. Corrected desktop.open result schema to include its real fileId. Final default comparison zero changed pixels; build clean, 3 regression tests pass/27 assertions, final browser errors empty. Native/rights approximations remain disclosed. | `CORE-06` |
| 2026-10-05 | Completed `CORE-06`: Windows 11 Pro 23H2 build 22631.2428 native shell/chrome and ten functional local apps; 151 typed commands with live native discovery and strict actual request/result validation. Browser proof covered shared filesystem/media, offline Edge, Calculator, Settings/Quick authority, Clock transitions/teardown, dialogs, keyboard, drag/chrome, retained scroll and narrow/short layouts. Fixed disposed-editor selection events, global-modal false focus and invisible minimized dirty-close prompts. Terminal rejects compound syntax before filesystem mutation and preserves quoted operators. Final build clean; five regressions pass/59 assertions; fresh diagnostics empty; all local assets load. All macOS command paths re-exercised and default comparison zero changed pixels. Authored artwork/font/Store-version limits remain explicit. | `CORE-07` |
| 2026-10-05 | Completed `CORE-07` research: chose Ubuntu Desktop 24.04 LTS original GA (April 25, 2024), amd64 Ubuntu GNOME 46, Default/minimal selection and light Yaru before native inventory. Primary archived manifest/source packages and frozen seeds establish package/snap versions, Ubuntu overrides and minimal/extended/live membership. Source-linked shell/app/menu/dialog/Settings inventory records hardware, exact-visual, font/artwork and trademark limits. No Linux runtime/profile/assets/contracts or host changes; actual candidate selection rejected unsupported_profile without mutation and installed discovery remained the four macOS/Windows IDs. Linux implementation stays conditional. | `OS-05` |
| 2026-10-05 | Completed `OS-05`: shared physical edge/corner grips and typed window.resize across all four installed profiles, logical app minimums and retained normal dimensions through minimize/expand/viewport refit. Browser proof covered all eight edges in each profile, reduced-scale pointer deltas, opposite anchors, workspace/minimum clamps, rejected invalid/stale/hidden/expanded/modal paths, capture cancellation and outgoing-scene disposal, and native captions/drag. Fixed reactive bounds in detached discovery. All current schemas compile strictly; minimum Notes/Calculator/Settings surfaces visually inspected; eight regressions pass/74 assertions; fresh diagnostics empty; default comparison zero changed pixels. | `OS-06` |
| 2026-10-05 | Completed `OS-06`: separate running/active/quitting app lifetime and fresh independent managed windows; guarded group quit and native reopen/close policy in all four profiles. Strict catalogs compile 35 macOS/161 Windows contracts. Actual actor/direct proof covered Finder/Safari/Preview and all seven Windows multi-window apps, exact owner/ambiguity/stale/singleton/modal rejection, shared files/preferences, native New Window/Exit, retained reopen and multi-dirty Notepad Save/Discard/Cancel including minimized and Save-as continuations. Fixed scoped Calculator keyboard, focus-safe editor caret/scroll restoration and crop/text-selection discovery. New-window pointer ownership and scale-derived geometry survived 390×844 round trips. Build clean; eight regressions/68 assertions; fresh diagnostics empty; viewport-initialized default comparison zero changed pixels. | `OS-07` |
| 2026-10-05 | Completed `OS-07` across all four installed profiles: native multi-selection/keyboard/marquee, inline draft rename and real bounded group drag/folder drops. Strict catalogs compile 47 macOS/172 Windows request/result contracts. Actual native pointer/keyboard actors proved real destination contents, retained IDs/content, protected atomic batches, Escape restoration, Dock/taskbar clearance, 390×844 fit, independent Finder locations/Downloads and real contextual titles. Fixed rename ownership after deselecting the focused icon and a Windows destination shifting when its preceding source left the layout; measured native origins and the existing completion barrier preserve physical placement even after background file mutation under Properties. Copy modifiers never silently moved data. Final build clean; 11 regressions/88 assertions; fresh diagnostics empty; unchanged default Mojave RMSE **0 (0)**. Full Trash/filesystem/Finder and desktop context menus remain queued. | `OS-08` |
| 2026-10-05 | Completed `OS-08` in all four installed profiles: native contextual folder creation, live managed Info/Properties, rename, real soft Trash and native sort/cleanup/view options; Mac grouping/multiple Info utilities/all inspector controls and Windows alignment/group offsets/hidden creation/personalization/modal barriers. Strict catalogs compile 59 Mac/181 Windows contracts. Native branch keyboard/direct reopen and 390×844 popup bounds passed; reproduced/fixed private collapse, stale published refit coordinates and dense creation editor anchoring/reveal at 320×200 with thirteen icons. Source IDs/content/parents survive Trash; protected batches reject before writes. Final build clean; 14 tests/99 assertions, fresh diagnostics empty/local assets loaded and default Mojave comparison **0 (0)**. | `OS-09` |
| 2026-10-05 | Completed `OS-09` in Mojave/Sonoma: six metadata groupings/eight member sorts, independent expansion, retained cover browsing/current-file opening, real member selection/rename/Info/folder grouping/Trash and preserved offsets. Strict catalogs compile 67/67/59/181 contracts; native short/narrow actors at 320×200/390×844 and custom 128px/right-label covers passed. Fixed sorted range/header marquee, missing member selection/Command-Down, intrinsic grid stretch, context/inspector focus, no-op Date Added and retained-popup binding races. Final Rust-served toggles/member opens and unsupported atomic boundaries passed; default Stacks-off surface visually inspected without a new pixel-identity claim. Build succeeds without component warnings; 17 tests/109 assertions pass; 525.86 kB chunk warning disclosed. Primary-tag precedence/time buckets are simulation policy, not native exactness. | `OS-10` |
| 2026-10-05 | Completed `OS-10` across all three Mac profiles: native Dock tree/window entries/Open/Quit/Keep/reveal, actual readonly application-bundle hierarchy and real selected independent Finder locations, plus live-surface App Exposé including minimized windows and honest empty state. Native Control/right-click/Shift-F10/Command-click/Control-Down and direct typed paths passed; Finder protection, disabled/stale/invalid and Windows unsupported boundaries reject atomically. Fixed dense title collisions, stale closed-window focus and all-58-app pin overflow. Production 320×240 geometry, End/reveal and clamped pane scrolling passed; original Notes DOM/data, minimized state and normal bounds survive overview. Strict catalogs compile 79/79/71/181 contracts; 22 tests/810 assertions pass. Final build has no component warnings; 561.43kB JS retains the >500kB advisory. Classic/modern native menus visually inspected, fresh diagnostics empty; no pixel-identity claim. | `OS-11` |
| 2026-10-05 | Completed `OS-11` across all three Mac profiles: canonical alias/secondary ordering and native pointer/bundle add/remove, actual-use recents only in Mojave/Sonoma, real inert minimized-window interiors with exact restore/minimize-into-app, working native Dock preference panes, physical magnification and zero-reservation auto-hide. Native separator/slider/edge/Control-F3 and context actors passed; bundle IDs/history/window lifetime survive alias editing. Fixed edge departure, cancelled Control-click suppression, option focus return, preference completion and omitted partial-payload schema acceptance. Final strict catalogs compile 88/88/80/181 contracts; 109 Mac API requests/108 applied responses validate. All three full rosters fit 320×240 with End reaching Trash; dense Sonoma magnification/menu bounds and all 60 local Dock images passed. Actual edited Notes interiors retain one live projection through minimize/App Exposé, and auto-hide zoom remains 1280×778 during reveal. Final build succeeds without component warnings (existing chunk-size advisory); 24 tests/830 assertions and fresh empty page errors. | `OS-12` |
| 2026-10-05 | Completed `OS-12` in all three Mac profiles: real folder aliases and native Finder folder HTML drag/add/removal, sorted Folder/Stack covers, fan/grid/list/automatic popups with bounded More continuation, real nested file/app opening and independent Open in Finder, plus deleted-record-derived empty/full Trash artwork/count/contents. Native Mojave double-click, High Sierra/Sonoma keyboard/context actors, 320×240 positive clamped grid/list scrolling and 390×844 Sonoma 37-entry grid/wheel passed. Deleted roots prune aliases/popups; thirteen invalid/stale/disabled paths and Windows unsupported-profile rejection preserve state. Strict catalogs compile 98/98/90/181 contracts; 143 applied request/results validate. Build has no component warnings; 33 tests/874 assertions pass, decoded local icons and final empty page diagnostics observed. Browser cutoff/geometry and authored paper overlay are not native pixel-identity claims; restore/empty and rich app interiors remain queued. | `OS-13` |
| 2026-10-05 | Completed `OS-13` in all four installed profiles: frozen application/window switchers, stable creation-order cycling, retained Mac group Hide/Show/Hide Others/Show All, native application-menu leaves, exact Windows minimized activation and original inert live previews/card close. Native modifier/reverse/release/H/Q/Period/F3/F8/menu actors, edited Notes/Notepad DOM/caret retention, zero-window/all-minimized activation, last-visible handoff and real dirty close/Cancel passed. Global Properties, eleven invalid/wrong-kind/unsupported cases and disabled/sole-app boundaries preserve state. Fixed failed-focus rollback losing the prior Dock tree and restored original heading weight; default Mojave image comparison 0 (0). Strict 113/113/105/188 catalogs validate 97 live requests/results; 11/58-app Mac and 25-window Windows dense layouts fit 320×240 with actual clamped scroll and clipped inert projections, plus 390×844 Sonoma/local icon decoding. Final build only has the existing >500kB advisory; 51 tests/963 assertions pass. Exact native edge/visual limits remain disclosed; no host changes. | `OS-14` |
