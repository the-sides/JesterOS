# macOS High Sierra native profile (10.13, 2017)

## Target, evidence, and implementation boundary

The target is **macOS High Sierra 10.13, introduced in 2017**, with the stock light application appearance. Apple released it on **September 25, 2017**. This profile is independently researched against Apple’s release-era announcements and the Apple help books explicitly selected for High Sierra. It is not a Sonoma reskin and not a claim to run Apple’s operating system.

Two inventories must remain separate:

1. **Native inventory:** the applications, utilities, commands, preferences, and secondary windows that Apple documents for the real operating system. Listing a native capability does not mean JesterOS implements it.
2. **Browser coverage:** Notes is a limited **plain-text recreation**; Messages is a **fixed sample presentation**, not messaging. All other native app interiors are **launch-only or not registered**, unless the integration coverage appended to this document explicitly says otherwise. Shell controls are not proof of functional native app interiors. No account, cloud, network, camera, host filesystem, process-management, or destructive disk operation is implied.

Research references are documentation inputs, not runtime dependencies. The profile must work offline; Apple help pages and press downloads must not be fetched by the running browser recreation. This document records research, not exercised implementation verification. No tests, builds, linters, formatters, or commits were run for this research assignment.

### Evidence grades and date precision

- **Release-era:** Apple’s June 5 and September 25, 2017 Newsroom releases establish the launch identity, wallpaper presentation, and announced changes.
- **Version-selected:** Apple’s help books explicitly showing **macOS High Sierra**, with versioned paths such as `/4.5/mac/10.13` for Notes or `/11.0/mac/10.13` for Messages, establish documented High Sierra behavior. These books can reflect later 10.13 point releases; they are not automatically a September 2017 capture.
- **Visual observation:** only the specific Apple images identified below were visually inspected. Geometry and colors are qualitative observations, not measured AppKit metrics or pixel-identity guarantees.
- **[INFERENCE]:** a plausible app surface or menu organization not established by a read period-specific command description. These entries are an investigation map, **not verified complete native menu transcriptions**. Exact order, separators, shortcuts, enabled states, localization, and hardware/account-dependent items remain uncertain.

Apple’s current site navigation and copyright footer are not evidence of High Sierra UI. Unversioned canonical links can resolve to a newer help book. For example, the Mojave-style separate Notes “Sort and pin notes” URL with a guessed High Sierra suffix redirected to current Notes; the valid High Sierra material is **Organize notes**, cited below. Safari’s version-selected landing page also contains later-maintained wording and imagery, so its appearance must not outrank the fixed 2017 release images.

## Primary reference anchors

- [High Sierra release, September 25, 2017](https://www.apple.com/newsroom/2017/09/macos-high-sierra-now-available-as-a-free-update/).
- [High Sierra preview, June 5, 2017](https://www.apple.com/newsroom/2017/06/macos-high-sierra-delivers-advanced-technologies-for-storage-video-and-graphics/).
- [High Sierra technical specifications — “What’s Included”](https://support.apple.com/en-us/111934): the version-specific product specification, not a current generic apps list.
- [Mac Help, High Sierra 10.13](https://support.apple.com/guide/mac-help/welcome/10.13/mac) and [10.13 contents](https://support.apple.com/guide/mac-help/toc/10.13).
- [Apps included on your Mac, High Sierra 10.13](https://support.apple.com/guide/mac-help/apps-included-on-your-mac-mchl110b00b7/10.13/mac/10.13): descriptions, icons, and app-launch bundle identifiers, including conditional new-Mac/downloaded apps.

## Complete published stock application and utility inventory

The following reproduces **all application and utility names in Apple’s High Sierra technical specification**, not every executable or private helper inside an installed system image. The stock OS list must not be inflated with later apps or with every app advertised for a new Mac.

### Applications listed in the High Sierra specification

| Grouping for this document | Native application names |
| --- | --- |
| Shell and system-facing applications | Dashboard; Launchpad; Mission Control; Siri; System Preferences; Time Machine |
| Communication and personal organization | Calendar; Contacts; FaceTime; Mail; Messages; Notes; Reminders |
| Browsing, navigation, and stores | App Store; iBooks; iTunes; Maps; Safari |
| Media, document, and desktop tools | Automator; Calculator; Chess; Dictionary; DVD Player; Font Book; Image Capture; Photo Booth; Photos; Preview; QuickTime Player; Stickies; TextEdit |

These are **31 names**, grouped here by purpose rather than transcribing Apple’s alphabetical layout. Finder is additionally the native desktop/file-management shell documented in [See your files in the Finder, 10.13](https://support.apple.com/guide/mac-help/see-your-files-in-the-finder-mchlp2605/10.13/mac/10.13); its omission from that marketing “Applications” list is not evidence that Finder was absent.

### Utilities listed in the High Sierra specification

**Activity Monitor; AirPort Utility; Audio MIDI Setup; Bluetooth File Exchange; Boot Camp Assistant; ColorSync Utility; Console; Digital Color Meter; Disk Utility; Grab; Grapher; Keychain Access; Migration Assistant; Script Editor; System Information; Terminal; VoiceOver Utility.**

These are the **17 utility names** in Apple’s published specification. Apple’s Mac Help groups some applications alongside utilities in Launchpad’s “Other” presentation; that guide’s grouping is not a guarantee of literal filesystem placement. Font Book, Automator, Chess, DVD Player, Image Capture, QuickTime Player, Stickies, and TextEdit remain applications even when presented among “Other apps.”

### Conditional, separate, and non-launcher surfaces

- **iMovie and GarageBand:** the 10.13 included-apps guide says they come on every new Mac and marks their launch links **“if installed.”** They are not in the specification’s base macOS application list. Do not require them for every upgraded High Sierra installation.
- **Pages, Numbers, and Keynote:** the same guide describes them and says **“if installed.”** Treat them as optional Apple productivity applications, not unconditional components of the OS image.
- **iPhoto:** the guide says a previously installed copy can remain after upgrading and recommends Photos instead. It is legacy carry-over, not a newly bundled High Sierra app.
- **Ink:** the guide documents handwriting support and an Ink preference pane appearing when a graphics tablet is connected. It is a conditional input/preference surface, not proof of an always-visible standalone launcher icon.
- **Spotlight, Notification Center, AirDrop, Quick Look, sharing sheets, Open/Save/Print panels, login/logout, and Force Quit:** native system surfaces, not additional stock applications inferred from their UI.
- **Network Utility, Wireless Diagnostics, Archive Utility, Screen Sharing, and other system helpers:** do not fabricate their absence, but this research did not establish a complete 10.13 system-helper bundle inventory from an installation image. They are outside the complete **published application/utility list** above. A launcher entry or exact menu for them needs additional version-specific primary evidence.
- Final Cut Pro X and the third-party editors named in the releases are **not stock applications** merely because Photos supports their integration or Apple discusses their workflows.

## Desktop, menus, windows, and System Preferences

[The menu bar, 10.13](https://support.apple.com/guide/mac-help/the-menu-bar-mchlp1446/10.13/mac/10.13) describes Apple menu at the left, the **active application’s** menus next to it, and status menus, Spotlight, Siri, and Notification Center at the right. It explicitly gives File, Edit, Format, Window, and Help as common menu names; it does **not** assert that every app has all those menus. Menus belong to the foreground application, not to a modern global “Settings” abstraction.

The same source documents Wi-Fi and battery status menus, optional Volume and emoji-viewer status items, and Command-drag rearrangement. Exact stock status-item ordering is hardware and preference dependent. Modern Control Center chrome is not evidenced by this source.

[System Preferences, 10.13](https://support.apple.com/guide/mac-help/set-system-preferences-mh15217/10.13/mac/10.13) establishes:

- **Apple menu > System Preferences**, a grid of preference icons, Show All navigation, and a top search field.
- **View > Organize Alphabetically** as an actual documented command.
- Protected panes with a lock and an administrator-password unlock prompt.
- App-specific preferences through **App Name > Preferences**, not an app-wide “Settings” label.

The [versioned System Preferences grid image](https://help.apple.com/assets/5AA195BD094622847B7F3DA3/5AA195BE094622847B7F3DAA/en_US/b00feb65af0f46b925d016e33bea6a94.png), visually inspected, contains:

| Row in Apple’s illustrated grid | Visible native panes |
| --- | --- |
| Appearance and basic behavior | General; Desktop & Screen Saver; Dock; Mission Control; Language & Region; Security & Privacy; Spotlight; Notifications |
| Hardware | Displays; Energy Saver; Keyboard; Mouse; Trackpad; Printers & Scanners; Sound; Startup Disk |
| Accounts and connectivity | iCloud; Internet Accounts; Wallet & Apple Pay; App Store; Network; Bluetooth; Extensions; Sharing |
| Users and services | Touch ID; Users & Groups; Parental Controls; Siri; Date & Time; Time Machine; Accessibility |

This is a photographed/documented **example grid**, not a promise that every pane appears on all Macs. Touch ID, Wallet & Apple Pay, trackpad/mouse options, Ink, and third-party panes depend on hardware or installation. Notice **iCloud**, **Parental Controls**, and **Energy Saver**, rather than importing Sonoma’s Apple ID account layout, Screen Time, or Battery organization.

[Dock preferences, 10.13](https://support.apple.com/guide/mac-help/dock-preferences-mchlp1119/10.13/mac/10.13) verifies Size, Magnification, left/bottom/right position, minimize effect, preferred document tabs, double-click titlebar minimize/zoom, minimize into app icon, animate opening applications, auto-hide, and open-app indicator dots. **There is no “Show recent applications in Dock” setting in this versioned list.** Pinned apps, running apps, minimized windows, documents/folders, and Trash must not be conflated with a separate recent-app section.

[Personalize your desktop, 10.13](https://support.apple.com/guide/mac-help/personalize-your-desktop-mchlp3013/10.13/mac/10.13) verifies Desktop & Screen Saver tabs, Apple Desktop Pictures/Solid Colors, Photos/folder sources, scheduled picture changes, screen-saver previews/options, and Hot Corners. It also documents **“Use dark menu bar and Dock.”** Thus “no Dark Mode” means **no Mojave-style full application Dark Mode**, not that High Sierra could never use a dark menu bar or Dock.

System window/dialog inventory supported by the 10.13 Mac Help topics includes ordinary document windows and tabs, full screen and window management, printing, file creation and saving, account configuration, user/password prompts, and screenshot commands. An exact keyboard-shortcut map, every Apple-menu row, and every Open/Save/Print panel option were not exhaustively transcribed here. The [versioned Apple-menu page](https://support.apple.com/guide/mac-help/whats-in-the-apple-menu-mchlp1130/10.13/mac/10.13) retrieved only a short introduction rather than a complete command table; it must not be presented as proof of a complete menu transcription.

## Major application menu and sub-interface inventory

The table is an **inventory of native surfaces**, not JesterOS coverage. Command paths in backticks are directly supported by the cited help page; other named working areas are documented capabilities. “Candidate” means **[INFERENCE]** about exact organization that still requires a period capture before claiming native fidelity. No row constitutes a complete menu-item transcription.

| Application | Documented native working areas, commands, dialogs, and preferences | Evidence and uncertainty |
| --- | --- | --- |
| Finder | Sidebar, folders, tags, search, AirDrop, sharing, and Cover Flow. `Finder > Preferences` has **General, Tags, Sidebar, Advanced**: desktop items, default folder, folder tabs, sidebar tags, extensions, Trash warnings/30-day removal, folders-on-top, and search scope. Open/Save panels inherit selected sidebar items. | [Finder overview, 10.13](https://support.apple.com/guide/mac-help/see-your-files-in-the-finder-mchlp2605/10.13/mac/10.13), [Finder preferences, 10.13](https://support.apple.com/guide/mac-help/finder-preferences-mchlp2803/10.13/mac/10.13). File/Edit/View/Go/Window organization is a candidate menu-family map, not a transcribed menu. Cover Flow is explicitly period-correct; Mojave Gallery is not. |
| Safari | Smart Search, tabbed browsing, favorites/bookmarks, Reading List, iCloud tabs, pinned sites, Reader, Picture in Picture, private browsing/privacy, website permissions and Apple Pay. `Bookmarks > Show Favorites` and the Smart Search audio-menu Picture in Picture action are documented. The launch release verifies automatic Reader, autoplay blocking, and Intelligent Tracking Prevention. | [Safari Help 11.0, 10.13](https://support.apple.com/guide/safari/welcome/11.0/mac/10.13), [2017 release](https://www.apple.com/newsroom/2017/09/macos-high-sierra-now-available-as-a-free-update/). Website preferences are linked by the versioned landing page. Exact full preference-tab list/menu order is not established here; do not add modern profiles, Tab Groups, or Add to Dock web apps. |
| Mail | Mailbox sidebar, message list and preview, compose/reply/forward, attachments, formatting, signatures, VIP/flags, junk filtering, Smart Mailboxes, import/export, stationery, Top Hits search, full-screen Split View. `Mail > Add Account`; `Mail > Preferences`: **General, Accounts, Junk Mail, Fonts & Colors, Viewing, Composing, Signatures, Rules**. Accounts exposes Mailbox Behaviors and Server Settings. | [Mail Help 11.0, 10.13](https://support.apple.com/guide/mail/welcome/mac/10.13), [contents](https://support.apple.com/guide/mail/toc/11.0), [preferences](https://support.apple.com/guide/mail/set-mail-preferences-mlhl075989ef/11.0/mac/10.13). Mailbox/Message/Format command-family organization is a candidate, not an exact transcription. No scheduled-send/undo-send inference. |
| Contacts | Group sidebar, contact list/card, contact/group creation, address-map action, account chooser, Smart Group rule dialog. `Contacts > Add Account`; `File > New Smart Group`. | [Contacts Help 11.0, 10.13](https://support.apple.com/guide/contacts/welcome/mac/10.13). Card-editing, import/export, and preference details beyond the landing evidence require additional captures before exact-menu claims. |
| Calendar | Multiple calendar accounts, color-coded calendars, day/week presentation, event info popovers, invitees and Maybe/Decline/Accept responses, location/map/weather/travel information. `Calendar > Accounts`; `File > New Calendar`. | [Calendar Help 10.0, 10.13](https://support.apple.com/guide/calendar/welcome/mac/10.13). Other date/view controls and complete preferences are not fully transcribed. |
| Reminders | Traditional list sidebar and tasks, account chooser, shared-list info, reminder info with date/location notification. `Reminders > Add Account`. | [Reminders Help 5.0, 10.13](https://support.apple.com/guide/reminders/welcome/mac/10.13). Not the later Catalina redesigned smart-list dashboard. Exact File/Edit/View menus and preference options remain untranscribed. |
| Notes | Three panes, folders/accounts, note list/editor, search, pinned notes, Recently Deleted, formatting/checklists/tables, attachments/browser, locked notes, collaboration, import/export, and preferences. Actual menu paths and detailed coverage distinction follow below. | [Notes Help 4.5, 10.13](https://support.apple.com/guide/notes/welcome/mac/10.13), [contents](https://support.apple.com/guide/notes/toc/4.5). Native rich-note capabilities are not implemented by the plain-text recreation. |
| Messages | Conversation sidebar/search/compose, active conversation with blue/gray/green bubbles, audio clips, attachments, Tapbacks, Details popover, read receipts, location, calls/screen sharing, account setup, Jabber buddy lists/status, save/delete conversation actions. `Messages > Preferences > Accounts`; `Messages > Add Jabber Account`. | [Messages Help 11.0, 10.13](https://support.apple.com/guide/messages/welcome/11.0/mac/10.13), [contents](https://support.apple.com/guide/messages/toc/11.0), [account setup](https://support.apple.com/guide/messages/set-up-to-send-text-messages-ichte16154fb/11.0/mac/10.13). Accounts/iMessage preferences are period documented; do not substitute the modern app-store drawer or editing/unsending flow. Fixed sample is not a client. |
| FaceTime | Contact search/results, video/audio calls, live camera preview, picture-in-picture, mute/end-call, Live Photo, and iPhone phone-call notifications. | [FaceTime Help 4.0, 10.13](https://support.apple.com/guide/facetime/welcome/mac/10.13). Sign-in/preferences are candidate secondary surfaces; no complete tab/menu transcription. Group FaceTime is a later Mojave-era addition. |
| Maps | Destination search, location info window, start/end route input, travel time/distance, driving/walking/transit choices, traffic, sharing directions with iOS. | [Maps Help 2.0, 10.13](https://support.apple.com/guide/maps/welcome/mac/10.13), [included-apps guide](https://support.apple.com/guide/mac-help/apps-included-on-your-mac-mchl110b00b7/10.13/mac/10.13). Map layers, detailed menus/preferences, and permission dialog wording are not exactly transcribed. |
| Photos | Always-on sidebar, library/albums/organization, filtering and selection, Memories, edit view, Curves, Selective Color, Live Photo Loop/Bounce/Long Exposure/key photo, external editors, and project extensions. `File > Create > Book`; iCloud Photo Library pane of Photos preferences; Share menu. | [Photos Help 3.0, 10.13](https://support.apple.com/guide/photos/welcome/mac/10.13), [2017 release](https://www.apple.com/newsroom/2017/09/macos-high-sierra-now-available-as-a-free-update/). Native project ordering/pricing dialogs and full menu trees are not established. Use period **iCloud Photo Library**, not a later Shared Library design. |
| iTunes | Music/video organization and playback, iTunes Store music/movies/TV/podcasts, Apple Music streaming, and attached iOS-device setup/sync. Siri/Apple Music playlist/trivia integration is announced. | [Included-apps guide, 10.13](https://support.apple.com/guide/mac-help/apps-included-on-your-mac-mchl110b00b7/10.13/mac/10.13), [2017 release](https://www.apple.com/newsroom/2017/09/macos-high-sierra-now-available-as-a-free-update/). Library/store/device info panels and preferences are candidate detailed surfaces. The exact iTunes 12.x revision and complete menu labels at 10.13.0 were not independently established. |
| iBooks | Library/collections, iBooks Store browsing/search, Apple-ID sign-in dialog, synchronized reading position, book appearance controls for text size/background/font. | [iBooks Help 1.11, 10.13](https://support.apple.com/guide/ibooks/welcome/mac/10.13). Use the iBooks name, not modern Books chrome. Full menus and preferences remain untranscribed. |
| App Store | Featured, Top Charts, Categories, search, app details/purchase/reinstall/update; `App Store > Preferences` with automatic downloads of purchases on other Macs. Includes system update role. | [App Store Help 2.3, 10.13](https://support.apple.com/guide/app-store/welcome/mac/10.13). Purchased/Updates are candidate exact tab details beyond the read landing evidence. No Mojave Discover/Create/Work/Play/Develop redesign. |
| Preview | PDF and image document windows, thumbnails sidebar, form filling, Markup, signature creation, PDF combining, export-format dialog and password/encryption. `File > Export`, Encrypt and Format pop-ups. | [Preview Help 10.0, 10.13](https://support.apple.com/guide/preview/welcome/mac/10.13). Exact Tools/View menu trees and complete preferences require further period evidence. |
| TextEdit | Plain text, rich text, HTML, format-aware save dialog and embedded-image Markup. `File > Save` and File Format selector; `TextEdit > Preferences > Open and Save`, including HTML code display option. | [TextEdit Help 1.13, 10.13](https://support.apple.com/guide/textedit/welcome/mac/10.13). Fonts/ruler/format command organization is a candidate, not a full transcription. |
| QuickTime Player | Playback controls, clip editor, trim/rearrange/rotate/split, movie/audio/screen recording and source selection. `View > Show Clips`; `File > New Screen Recording`; `File > New Movie Recording`. | [QuickTime Player Help 10.4, 10.13](https://support.apple.com/guide/quicktime-player/welcome/mac/10.13). Screen recording is the older QuickTime workflow, not Mojave’s unified screenshot bar. Complete export menus and source dialogs are not transcribed. |
| Photo Booth | Camera preview, photograph/video capture. Effects picker, capture mode choices, thumbnails and sharing are candidate detailed surfaces. | Capture capability verified by [included-apps guide, 10.13](https://support.apple.com/guide/mac-help/apps-included-on-your-mac-mchl110b00b7/10.13/mac/10.13); exact controls/menus beyond that description are **[INFERENCE]** here. |
| Calculator; Dictionary; Stickies; Chess; DVD Player; Font Book; Image Capture | Calculator basic/advanced/programmer calculations; Dictionary dictionaries/thesauruses/other lookup sources; Stickies desktop notes/lists/pictures; Chess game; DVD/movie playback; Font Book install/manage/preview; Image Capture transfer/scan/capture. Candidate subordinate surfaces: Calculator conversion/history, Dictionary source preferences, Stickies color/font, Chess new-game options, DVD navigation controls, font validation, scanner settings. | Native identities and listed roles verified by [included-apps guide, 10.13](https://support.apple.com/guide/mac-help/apps-included-on-your-mac-mchl110b00b7/10.13/mac/10.13). The candidate detailed menus/dialogs in this row are **not individually verified**. |
| Automator | Action library and workflow canvas; `File > New`, Workflow selection and Choose dialog; script actions for AppleScript, JavaScript and shell commands. | [Automator Help 2.8, 10.13](https://support.apple.com/guide/automator/welcome/mac/10.13). Workflow/application/service-type list and preferences not exhaustively transcribed. Do not rename period Services to later Quick Actions without evidence. |

### Utility menus and secondary surfaces

All utility identities and broad roles below are grounded in the [10.13 included-apps guide](https://support.apple.com/guide/mac-help/apps-included-on-your-mac-mchl110b00b7/10.13/mac/10.13) and [High Sierra specification](https://support.apple.com/en-us/111934). Detailed surfaces marked “candidate” are **[INFERENCE]**, not a claim that their exact controls were captured.

| Utility | Native role and sub-interface inventory | Precision boundary |
| --- | --- | --- |
| Activity Monitor | Process table/resource information; CPU and Energy panes; force-quit control; `View > Dock Icon` resource graph. Candidate Memory/Disk/Network pane detail and process inspector/quit confirmation. | [Activity Monitor Help 10.13](https://support.apple.com/guide/activity-monitor/welcome/mac/10.13) directly establishes CPU, Energy, force quit, and Dock graphs. Other detailed pane/dialog labels not transcribed. |
| Disk Utility | Device/volume sidebar, APFS containers and volumes, format display, Erase/Format and APFS (Encrypted), First Aid dialog, RAID management. | [Disk Utility Help 16.0, 10.13](https://support.apple.com/guide/disk-utility/welcome/mac/10.13). Partition/restore/image-sheet details are candidate surfaces. No browser action may imply real formatting or repair. Launch-era APFS automatic conversion support was all-flash internal storage, not a universal Fusion/HDD rollout. |
| Terminal | UNIX command windows/tabs; `Terminal > Preferences > Profiles`; custom backgrounds/titles; `Edit > Marks > Mark` and `Mark as Bookmark`; Command-I Inspector with Signal Process Group action. | [Terminal Help 2.8, 10.13](https://support.apple.com/guide/terminal/welcome/mac/10.13). No exact default-shell/version or complete Shell menu asserted. Browser terminal-like presentation does not execute native processes. |
| AirPort Utility | Set up/manage AirPort base stations and Wi-Fi network. Candidate network diagram, base-station edit window, Internet/Wireless/Network options and update prompts. | Detailed layout/tab names require period capture. |
| Audio MIDI Setup | Connected audio/MIDI devices, channel inputs/outputs, output-speaker configuration. Candidate Audio Devices/MIDI Studio windows, aggregate devices and speaker test dialog. | Full menu/dialog list unverified. |
| Bluetooth File Exchange | Short-range Bluetooth file/device connection. Candidate file chooser, device chooser and transfer-progress/error dialogs. | Exact pairing/transfer wording unverified. |
| Boot Camp Assistant | Install/use Windows on supported Intel Macs. Candidate introduction, Windows installer/partition workflow and authentication/progress dialogs. | Hardware/version-dependent steps; not universal and never functional in this browser profile. |
| ColorSync Utility | Inspect/adjust color profiles. Candidate profile/device/filter views and repair/verification tools. | Exact tabs and menu rows unverified. |
| Console | View log messages and investigate problems. Candidate device/log sidebar, streaming/search, diagnostic/crash reports. | No exact modern Console design may be substituted from current macOS. |
| Digital Color Meter | Read on-screen color values. Candidate aperture, colorspace/value-display options and lock/copy actions. | Exact menu options and shortcuts unverified. |
| Grab | Screenshot capture of all/part of screen. Candidate selection/window/screen/timed-screen Capture commands and cursor preferences. | Stock presence is verified; complete menu labels and shortcuts are not. Do not substitute Mojave Screenshot.app. |
| Grapher | Visualize/analyze implicit and explicit equations. Candidate 2D/3D document/template selection, equation entry and graph appearance/export dialogs. | Exact templates/menus unverified. |
| Keychain Access | Password/account information storage and management. Candidate keychain/category sidebar, item inspector, password/certificate dialogs and trust settings. | Full menu and security-prompt wording unverified; no host secrets are accessible. |
| Migration Assistant | Transfer data from Mac, PC or disk. Candidate source selection, account/data-selection and progress/authentication workflow. | Exact steps vary with source and hardware. |
| Script Editor | Create scripts/tools/apps. Candidate AppleScript/JavaScript selection, source/results/event-log panes, dictionary chooser and export/save dialogs. | Exact controls/menu strings not independently captured. |
| System Information | Hardware, network and software specifications. Candidate category sidebar, system report/save/print and storage-management secondary surface. | Detailed category taxonomy and menu rows unverified. |
| VoiceOver Utility | Configure the macOS VoiceOver screen reader. Candidate settings categories, speech/navigation/keyboard/Braille options and training tools. | Exact category/option names unverified. |

Dashboard, Launchpad, Mission Control, Siri and Time Machine are in Apple’s application list but are not ordinary document apps with a universal File/Edit menu. Dashboard widget management, Launchpad app/folder presentation, Mission Control spaces/overview, Siri query/results, and Time Machine timeline/restore are native surface families. Their exact complete submenus were not read here and must be treated as **[INFERENCE]** if exposed beyond the cited 10.13 Mac Help overview.

## Notes: compatibility of classic plain-text surfaces

**Conclusion: the classic sidebar/list/editor, pinning, Recently Deleted, and search are positively evidenced for High Sierra, not merely guessed from Mojave.** Plain text is a valid content subset of native Notes, but native Notes is not a plain-text-only application.

### Direct High Sierra evidence

- [Notes Help 4.5 landing, 10.13](https://support.apple.com/guide/notes/welcome/mac/10.13) identifies three panes: folders/sidebar on the left, note list in the middle, content at the right. It also documents accounts, attachments and collaboration.
- [Organize notes, 4.5/10.13](https://support.apple.com/guide/notes/organize-notes-notc3b2d538b/4.5/mac/10.13) explicitly names macOS High Sierra 10.13 pinning, **All [account]**, **Notes**, and **Recently Deleted** folders, the Sidebar button, `File > New Folder`, folder nesting/dragging, and `File > Pin Note` or swipe-right Pin. Pinned notes remain at the top. Recently Deleted notes cannot be pinned. Default ordering is recently created or changed notes first.
- [Write and format notes, 4.5/10.13](https://support.apple.com/guide/notes/write-and-format-notes-not9474646a9/4.5/mac/10.13) verifies new note in a selected folder, toolbar compose, **first line becomes title**, selecting/editing text, `Edit > Find > Find`, rich text/list/checklist capabilities, Format > Font/Text and font panel. Its simple body-text workflow is compatible with a deliberately reduced plain-text editor.
- [Search your notes, 4.5/10.13](https://support.apple.com/guide/notes/search-your-notes-not18ab658ed/4.5/mac/10.13) verifies toolbar search, live matching as typed and Return/result count, Current Account/All Accounts scope, natural-language queries, body and attachment text/filenames, single-note Find, and **All Accounts searches Recently Deleted**.
- [Delete a note, 4.5/10.13](https://support.apple.com/guide/notes/delete-a-note-not5585d71a8/4.5/mac/10.13) verifies toolbar/Delete-key/swipe deletion; On My Mac and upgraded iCloud notes move to Recently Deleted; restoration by dragging to another folder; permanent delete from Recently Deleted; up to 30-day recovery. Other/unupgraded accounts can delete permanently.
- [Notes preferences, 4.5/10.13](https://support.apple.com/guide/notes/notes-preferences-apd97da26aed/4.5/mac/10.13) verifies **Sort notes by; New notes start with; Default account; Enable the On My Mac account; Default text size; Locked notes; Use Touch ID**, with hardware limits.

### Inspected period visual reference

[Apple’s High Sierra pinning illustration](https://help.apple.com/assets/59D1B0A2680CE2D9200B6FC9/59D1B0A2680CE2D9200B6FD0/en_US/a10c1e872823cbf42a402af5397667b6.png), linked from the versioned Organize notes page, visibly contains a **September 12, 2017** editor timestamp. It shows:

- A silver compact toolbar, traffic lights, rectangular toolbar buttons and far-right search field.
- Three light panes separated by fine dividers, account/folder sidebar and rectangular gray selected folder row.
- A **Pinned** heading, a pale-yellow rectangular selected note row, and an orange swipe-revealed Pin action. Orange is an exposed action, not the ordinary selected-note color.
- Light paper/editor body with a muted centered date, a bold-ish list title, preview text and optional attachment thumbnails.
- Native icons for sidebar, attachments, delete, compose, lock, table, checklist, formatting, people and sharing. Rich-feature buttons are evidence of native scope, not permission to render nonworking controls as implemented functionality.

The transparent/black surroundings and annotation leader lines are part of Apple’s instructional image, not native window padding. No exact CSS color, texture, logical-point size, device scale, font metrics, or menu ordering is inferred from it. The visual continuity with Mojave light Notes makes reuse of a traditional three-pane plain-text surface plausible, but it does not certify every Mojave behavior or icon as High Sierra-native.

### Browser limitations that must stay explicit

The recreation’s editable text, first-line title, list, search, sidebar, pin and delete/recovery concepts can fit this era. It must not claim native rich text/tables/checklists, scanned-document management, attachment indexing/browser, Notes passwords/Touch ID, sharing/participants, iCloud, Internet Accounts, folder trees, Siri, Spotlight integration, or native export/preferences merely because these features are listed above.

A local text filter limited to the selected collection is not native All Accounts/natural-language/attachment search. A Restore button is a usable adaptation, not the documented native drag-to-folder gesture. An always-visible empty Recently Deleted collection differs from Apple’s documented disappearing empty folder. Untimed session data is not native 30-day retention or cloud persistence. A note-row context-menu pin action is not itself evidence of the native `File > Pin Note`/swipe interaction. The High Sierra pinning introduction expressly ties it to upgraded iCloud notes; do not silently generalize all account types from later guides.

## Messages: compatibility of a 2016-era fixed sample

**Conclusion: classic 2016-era Messages visual structure is plausibly compatible with High Sierra; the sample date alone proves nothing about the UI version.** Use High Sierra’s own version-selected illustration as the profile reference, rather than claiming a Mojave sample or arbitrary 2016 date is an exact 2017 native capture.

The [Messages Help 11.0 landing, High Sierra](https://support.apple.com/guide/messages/welcome/11.0/mac/10.13) and its [inspected main-window illustration](https://help.apple.com/assets/5A540238680CE27D670ECE25/5A540239680CE27D670ECE2C/en_US/f2c77ee0cd2951b6636c60051623f5ad.png) establish:

- A traditional silver/light window with traffic lights; sidebar search and compose button; circular conversation portraits; strong blue rectangular selection; muted previews and time labels.
- “To: Euna Kwon” at the top of the conversation and **Details** at the upper right.
- Gray incoming and blue outgoing iMessage bubbles, attachment photographs, a blue thumbs-up Tapback, a Delivered status, and a bottom text composer with emoji and microphone controls.
- The selected sample is **Euna Kwon**, with “I want to go!” and the Miami/photo conversation. This is a stronger period-specific visual basis than the repository’s pre-existing Mojave Shelley Willems scene; reusing a classic layout is not the same as reusing later sample content as evidence.

Apple’s landing page also shows green outgoing SMS bubbles and a Details view with screen-share/video/audio buttons. [Account setup, 11.0/10.13](https://support.apple.com/guide/messages/set-up-to-send-text-messages-ichte16154fb/11.0/mac/10.13) establishes iMessage, iPhone SMS forwarding and Jabber, **Messages > Preferences > Accounts**, Apple-ID sign-in, reachable addresses/read receipts/start-conversation identity, and a separate Add Jabber Account dialog. These are native inventory only.

A fixed sample can accurately present this conversation-era chrome without implementing sending, account sign-in, SMS, read receipts, live search, contact selection, attachments, audio, emoji picker, Tapbacks, Details actions, FaceTime or screen sharing. It must not imply those controls actually communicate or grant native permissions. Sample content, timestamps, portraits and photos are reference/sample material, not user data.

**Point-release trap:** [Use Messages in iCloud, 11.0/10.13](https://support.apple.com/guide/messages/use-messages-in-icloud-icht5b5d1e63/11.0/mac/10.13) explicitly requires **macOS 10.13.5 or later and iOS 11.4 or later**. The version-selected 10.13 book includes that setting, but it is not a September 2017 launch feature. Do not add it to a 2017 10.13.0 preferences reproduction.

## Exact-period wallpaper and downloadable source

The [September 2017 release hero](https://www.apple.com/newsroom/images/product/os/macos/standard/macbook_highsierra_hero_desktop_big.jpg.large.jpg), visually inspected, shows the period High Sierra desktop picture: pale-blue sky, snow-gray mountain slopes, orange/red hillside vegetation, bright golden-yellow trees, and a reflected lake at the bottom. This identifies the launch wallpaper’s **visual composition**, not the geographic name or photographer, neither of which was established from these Apple sources.

Primary downloadable Apple media linked from the release:

- [Hero desktop ZIP](https://www.apple.com/newsroom/images/product/os/macos/standard/macbook_highsierra_hero_desktop.zip).
- [All High Sierra release media ZIP](https://www.apple.com/newsroom/images/product/os/macos/standard/Images_of_macOS_High_Sierra.zip).
- The [June 2017 preview desktop ZIP](https://www.apple.com/newsroom/images/product/os/macos/standard/mac_sierra_homescreen.zip) is additional announcement-era evidence, not preferable to the September launch reference.

The **hero ZIP was fetched and inspected in memory** during research. It contains `macbook_highsierra_hero_desktop.jpg` (469,856 bytes) and `LEGAL_NOTICE.rtf`; it does **not** contain a clean standalone wallpaper image. The English legal notice states that media use is personal or editorial and non-commercial, and images/video cannot be altered in a way that disparages Apple. This is not an unrestricted software-asset redistribution license.

No clean standalone wallpaper download from Apple was located in the consulted primary sources. A distribution mirror or extracted `High Sierra.jpg` may provide the actual desktop-picture bytes, but its retrieval provenance must be recorded separately from Apple’s visual evidence. A GitHub mirror is **not primary UI evidence**, not an Apple source, and not a rights grant. Do not crop the photographed MacBook and call the result a verified native wallpaper asset. The integration owner records actual local wallpaper choice, provenance and licensing limitations separately.

## Explicit differences from Mojave and Sonoma

Later Apple announcements in this section are used only to date **later additions**, not as evidence of High Sierra appearance.

| Boundary | High Sierra 10.13 (2017) | Later primary evidence |
| --- | --- | --- |
| Application roster | No stock **News, Stocks, Home, or Voice Memos**. | [Mojave introduction, June 4, 2018](https://www.apple.com/newsroom/2018/06/apple-introduces-macos-mojave/) says these come to Mac **for the first time**. Do not import their Mojave/Sonoma icons or launch entries. |
| Appearance | Light native app interiors; optional **dark menu bar and Dock**, not full-system/app Dark Mode. | The same Mojave release introduces full Dark Mode with redesigned Mail/Messages/Maps/Calendar/Photos and Dynamic Desktop. High Sierra’s own [desktop customization guide](https://support.apple.com/guide/mac-help/personalize-your-desktop-mchlp3013/10.13/mac/10.13) establishes the older limited dark option. |
| Dock | No separate automatically populated recent-app section. This does not prohibit an app being shown because it is currently running. | Compare [10.13 Dock preferences](https://support.apple.com/guide/mac-help/dock-preferences-mchlp1119/10.13/mac/10.13) with [10.14 Dock preferences](https://support.apple.com/guide/mac-help/dock-preferences-mchlp1119/10.14/mac/10.14), which adds **Show recent applications in Dock**. |
| Finder and screenshots | Cover Flow; Grab and QuickTime screen recording. No Mojave Finder Gallery/Quick Actions, desktop Stacks feature, or modern unified screenshot toolbar inferred. | [Mojave introduction](https://www.apple.com/newsroom/2018/06/apple-introduces-macos-mojave/) announces Gallery View, desktop Stacks, Finder Quick Actions, Quick Look editing and screenshot controls. Dock folder stacks are a different concept from Mojave desktop Stacks. |
| Media apps | **iTunes**, not standalone Music/TV/Podcasts; **iBooks**, not modern Books identity. | High Sierra’s stock list verifies these names. [Catalina introduction, June 3, 2019](https://www.apple.com/newsroom/2019/06/apple-previews-macos-catalina/) explicitly replaces iTunes with Music, Podcasts and TV. |
| System configuration | **System Preferences**, grid of panes; per-app **Preferences**. | [Ventura introduction, June 6, 2022](https://www.apple.com/newsroom/2022/06/macos-ventura-brings-powerful-productivity-tools-new-continuity-features-to-mac/) explicitly renames System Preferences to **System Settings** and redesigns it. Sonoma inherits the later identity; it is not the High Sierra configuration UI. |
| App Store | Pre-Mojave Featured/Top Charts/Categories design, not editorial sidebar redesign. | [Mojave introduction](https://www.apple.com/newsroom/2018/06/apple-introduces-macos-mojave/) explicitly announces Discover/Create/Work/Play/Develop and an all-new Mac App Store. |
| Notes and Reminders | Classic note list; traditional Reminders list interface. | [Catalina introduction](https://www.apple.com/newsroom/2019/06/apple-previews-macos-catalina/) announces Notes Gallery View and redesigned Reminders. [Sonoma introduction, June 5, 2023](https://www.apple.com/newsroom/2023/06/macos-sonoma-brings-new-capabilities-for-elevating-productivity-and-creativity/) announces linked notes and full-width inline PDFs; none should be backported as 2017 evidence. |
| Messaging and calls | Traditional conversation layout and one-to-one FaceTime; no modern message edit/undo-send flow. | [Mojave introduction](https://www.apple.com/newsroom/2018/06/apple-introduces-macos-mojave/) announces Group FaceTime. [Ventura introduction](https://www.apple.com/newsroom/2022/06/macos-ventura-brings-powerful-productivity-tools-new-continuity-features-to-mac/) announces edit/undo-send/unread/recovery in Messages. |
| Desktop and Safari modernization | No Sonoma interactive desktop/iPhone widgets, Safari profiles or Add-to-Dock web apps, moving-video wallpaper transition, Presenter Overlay, Reactions or Game Mode. | [Sonoma introduction](https://www.apple.com/newsroom/2023/06/macos-sonoma-brings-new-capabilities-for-elevating-productivity-and-creativity/) explicitly introduces those surfaces. High Sierra does have its own Dashboard/Notification Center widgets; “no widgets anywhere” would be incorrect. |
| New standalone utilities | Clock/Weather are not in the High Sierra stock app specification; Screen Time and Find My are not High Sierra apps/panes. | [Ventura introduction](https://www.apple.com/newsroom/2022/06/macos-ventura-brings-powerful-productivity-tools-new-continuity-features-to-mac/) introduces Mac Clock/Weather; [Catalina introduction](https://www.apple.com/newsroom/2019/06/apple-previews-macos-catalina/) introduces Screen Time and Find My. The older Find My Mac iCloud service is a separate concept. |

## Research limits and integration hand-off

This is a complete inventory of the **published High Sierra stock app/utility names**, with a deeper documented surface inventory for major apps and explicitly graded candidates for others. It is not a complete native installation bundle manifest, not a claim of full application implementation, and not an exhaustive native menu transcription. Hardware, country/language, Internet account type, optional installations, iTunes/Safari updates, and 10.13 point releases can change availability.

Primary screenshot references do not establish a blanket redistribution license for icons, portraits, photography, or Apple UI artwork. Asset extraction/mirroring must retain attribution and scope limitations. The profile’s integration/asset/coverage details are maintained separately by the implementation owner below this research section; that record, not the native inventory, is authoritative about what JesterOS actually registers and renders.

## Implemented profile and adapter

`frontend/src/high-sierra-profile.js` exports `highSierraProfile` (`macos-high-sierra-10.13`, renderer `high-sierra`). `high-sierra-adapter.js` exports `highSierraAdapter`; it does not alias the Mojave adapter. Registration/deep-freezing and scene selection remain in the shared parent-owned registries.

| Registered app IDs | Actual implemented coverage |
| --- | --- |
| `notes` | Working reduced plain-text editor, note collection/search, pin/unpin, delete/restore, sidebar and presentation/focus/context/scroll operations. Shared classic Notes mechanics; High Sierra-scoped appearance and independent 2017 fixture. |
| `messages` | Independent **Euna Kwon fixed sample** reconstructed from the High Sierra Messages Help image. Search/compose/Details/composer/emoji/audio controls are disabled; portrait rows and the displayed Tapback are static. Only shell/window operations act on this app. |
| `finder` | Bounded **Desktop/location contents** backed by actual simulated name/parent records, plus live managed Get Info and Desktop view-option utilities. Independent folder locations/counts, context creation/Trash, native selection/rename/drop/sort/cleanup and actual view controls work. Full Finder views/sidebar/tags/search, rich inspectors and filesystem/Trash lifecycle remain queued. |
| `launchpad`, `safari`, `mail`, `contacts`, `calendar`, `photos`, `settings`, `preview` | **Launch-only window shells.** `settings` is the stable command ID for **System Preferences**, not the later System Settings application. Launchpad is not a functional native full-screen launcher. No interior preferences, dialogs, browsing, mail, photo editing, account setup, or PDF functionality is supplied. |
| All other native apps/utilities inventoried above | Not registered in this browser slice. The native inventory is not a hidden set of implemented launchers. |

### What is independent and what is shared

- `HighSierraDesktop.svelte` retains the proven shared command/view-helper contract, but is a separate native view. It removes the Mojave recent-app section and its extra divider entirely. Photos is an ordinary pinned app, not a fake “recent” app. It has the period Finder **Go** and Notes **Format** headings, static Siri/status artwork, High Sierra wallpaper, correct accessible desktop identity, and a September 25, 2017 clock/calendar scene. Only **Window** is currently an operable menu; other headings/status items are decorative and do not imply complete native menus.
- `HighSierraMessagesWindow.svelte` and `high-sierra-messages-scene.js` use the High Sierra Euna/Blair/Bob/Brian/Jeanne/Tammy/The Guys sample, not the later Shelley scene. Toolbar, sidebar, text, bubbles, composer, traffic lights and Tapback are DOM/CSS/SVG. Only portraits and photograph content are discrete image assets. The High Sierra reference's white conversation area and vibrant/translucent classic sidebar are reconstructed with renderer-scoped CSS.
- `NotesWindow.svelte` is reused because High Sierra Notes 4.5 positively evidences the basic sidebar/list/editor, first-line title, search, pin and deleted-note concepts. `high-sierra.css` gives this profile the reference's white, untextured editor, regular-size first line, wider traditional sidebar and pale-yellow selection, rather than inheriting the later fixture/title treatment unchanged. The toolbar intentionally exposes only the implemented plain-text subset; omitted rich-feature toolbar controls are not fake buttons.
- `Window.svelte` and `WindowControls.svelte` are reused for the common pre-Big-Sur traffic-light/titlebar/window mechanism. Pointer capture and raw movement remain native-view mechanics; shared handlers own state changes/clamping. [Manage windows, explicitly High Sierra 10.13](https://support.apple.com/guide/mac-help/manage-windows-mchlp2469/10.13/mac/10.13) supports titlebar dragging, yellow minimize, red close, activation and Option-green zoom/restore. **Green is JesterOS workspace zoom, not native full-screen/Spaces.** Subsequent OS-05/OS-06 add physical edge resize and explicit app/new-window/quit lifetime. Tab merging, split view, app switching/hide and native full-screen remain queued.
- Browser artwork uses a maximum `.75` scale, a 22-pixel menu-bar workspace offset, responsive fit and six-position cascade. These are deliberate browser/actor scene policies shared with the classic renderer, **not measured native AppKit point values**. Notes' logical canvas is 1120×660; Messages' is 928×710. The actual Dock reserves its measured height, so zoom/refit uses the live workspace rather than guessed pixels.

The fixture uses `createNotesState(Date.UTC(2017, 8, 25, 9, 41))` and a fresh collection for each scene. Its simplified Camilla/Kitchen/Romano text is inspired by the versioned reference, not a claim to reproduce rich attachments or cloud records. `note-3` is selected; `note-1` is pinned and `note-4` is deleted. The scene time baseline must be honored by the shared Notes model for subsequent edits/creation; there is no wall-clock, persistence, or real account integration.

The account heading remains **On My Mac** as the existing local-data abstraction. [The 4.5/10.13 local-account help](https://support.apple.com/guide/notes/aside/apd9f13cff83/4.5/mac/10.13) documents this name and its local-only meaning. Pin behavior itself is positively documented in the upgraded-iCloud introduction above, but that does **not** establish identical availability for every native account type. The browser supports pinning its single simulated collection; it does not model native account upgrades or claim verified account-specific parity.

### Exact command integration

The adapter's `Desktop`, `Window`, `MessagesWindow`, and `NotesWindow` accept the existing canonical props and semantic view-helper interfaces. It exports `prepareDocument`, `createSceneData`, `initialBounds(app, area, windowCount, viewportHeight)`, and `fitNormalBounds(bounds, app, area)`. No per-profile command aliases or direct private component mutations are introduced.

The table below records the original **31-name CORE-05 handoff**, not today's complete inventory. The current profile exposes **59 contracts**, including later profile selection, window.resize/window.create/app.quit, desktop selection/rename/drop/location and context/create/Trash/sort/cleanup/view/Info operations; [feature-commands.md](feature-commands.md) is the current canonical inventory.

| Group | Compatible names |
| --- | --- |
| App/window | `app.open`, `window.focus`, `window.close`, `window.setMinimized`, `window.setZoomed`, `window.move` |
| Desktop | `desktop.refreshLayout`, `desktop.select`, `desktop.open`, `desktop.focus`, `desktop.focusControl`, `desktop.scroll` |
| Operable Window menu | `menu.open`, `menu.close`, `menu.select`, `menu.execute` |
| Notes data | `notes.create`, `notes.edit`, `notes.setPinned`, `notes.trash`, `notes.restore`, `notes.select`, `notes.selectFolder`, `notes.search`, `notes.setSidebarVisible` |
| Notes presentation | `notes.context.open`, `notes.context.close`, `notes.context.select`, `notes.context.execute`, `notes.focus`, `notes.scroll` |

The original table establishes source/contract compatibility. Subsequent production integration is exercised: OS-07 native Command selection, Shift/keyboard/all selection, marquee, Return inline rename/cancellation and group drag/drop passed, with actual visible destination records, stable physical positions and 390×844 bounds. Independent Finder locations/Downloads and real contextual titles passed. Fresh diagnostics were empty; broader native Find/search/account, swipe, Trash lifecycle and rich-app scopes remain outside this slice. Messages gains no send/receive/edit/search commands. Fresh profile selection never carries documents/windows into a different era.

OS-08 production proof covered native context New Folder, grouping selected real records, independent/live Get Info utilities, retained disclosures, inline rename and actual Trash contents. Name/Kind/Size sorting, selected collision-free/one-shot cleanup and every native view inspector control—including generic document art when preview is off—passed. Shift-F10/Control-click/branch navigation/direct reopen and bounded 390×844 popups passed; dense 320×200 thirteen-icon creation revealed and correctly anchored the actual editor. High Sierra still has no Stacks feature. Strict 59-contract discovery, clean build/14 tests/99 assertions and empty fresh browser diagnostics were exercised.


Parent integration is exactly:

1. Import `highSierraProfile` into `os-profiles.js` and include it in the existing deep-frozen registry under `macos-high-sierra-10.13`.
2. Import `highSierraAdapter` into `profile-adapters.js` and map `high-sierra` without a fallback.
3. Set root `data-os-profile`, `data-os-family`, and **`data-os-renderer="high-sierra"`** before `prepareDocument`, as the current bootstrap already does.
4. The adapter imports `high-sierra.css`. No edits to shared `fonts.css`, `styles.css`, or Mojave selectors are required. This file declares **High Sierra UI** / **High Sierra Message** font faces using the existing local Inter/Liberation assets. `prepareDocument` toggles the existing `native-apple-font` root class; native SF aliases are preferred only on Apple platforms. No San Francisco font is embedded.
5. Extend the shared descriptors' supported-profile IDs only for the reduced compatible operations above, and preserve the shared Notes `timeBase` in its timestamp generation.

## Packaged local asset provenance

Runtime assets live under `frontend/public/high-sierra/`; `ASSET-NOTICE.txt` records rights/provenance limits. Default Mojave assets are neither replaced nor rewritten.

### Wallpaper

`wallpaper.webp` is encoded from the actual **High Sierra.jpg** photograph distributed by the [foxt/macOS-Wallpapers mirror](https://github.com/foxt/macOS-Wallpapers), [download URL](https://raw.githubusercontent.com/foxt/macOS-Wallpapers/master/High%20Sierra.jpg). This is only the acquisition/distribution source. Apple's September 2017 desktop photograph above is the **primary visual evidence** for its era and composition. The source was resized to fit 3840×2160, preserving aspect ratio, and encoded as WebP at quality 88. No photographed computer frame, Dock, menu, app, screenshot, or screenshot crop is used as the runtime wallpaper.

- Acquired original SHA-256: `fe9c33388bf8833a7e6fa87aef5c09495a06444192356d93ecc56e73295af1d3`.
- Packaged WebP SHA-256: `304a9b626956136f05f3ce868036665a4ccbb69ddded863cf962a6c0d4a5a7db`.

The mirror explicitly attributes the images to Apple; it supplies **no independent Apple artwork redistribution/commercial license**. A rights review is required before commercial distribution/use. Public Apple press-media terms are not silently applied as a license to this mirror or to all support-guide images.

### Exact-version guide icons

The following local PNGs were obtained from the app/10.13-selected Apple guide image assets, not the repository's later Catalina icon collection. Binary decoding to PNG retains the artwork; guides may contain support revisions and are not a claim of extracted installer ICNS byte identity.

| Local icon | Primary Apple asset and source book |
| --- | --- |
| `safari.png` | [Safari Help 11.0/10.13 icon](https://help.apple.com/assets/5E1915E8094622053019F72E/5E1915EB094622053019F735/en_US/cef7bad00761d27a6cbf0115106517ba.png); [selected guide](https://support.apple.com/guide/safari/welcome/mac/10.13). The maintained Safari book's 2020 asset-set timestamp is disclosed; exact launch-day icon bytes are not established. |
| `mail.png` | [Mail Help 11.0/10.13 icon](https://help.apple.com/assets/59CDA4890946221F6E35ACDA/59CDA65E094622F35A35CAE2/en_US/9e42f35f882ba7b7bf40b7cc48ed8bc0.png). |
| `contacts.png` | [Contacts Help 11.0/10.13 icon](https://help.apple.com/assets/59D1AABE680CE2A0420B6CBB/59D1AABF680CE2A0420B6CC2/en_US/2af52fed2a9f185c22ff2236ce72a73a.png). |
| `calendar.png` | [Calendar Help 10.0/10.13 icon](https://help.apple.com/assets/5A7CCCB9680CE23F25939FF8/5A7CCCBE680CE23F2593A000/en_US/15c65a3f2b0fb2f03e1767224f4d8a47.png). Date-face DOM/SVG overlay shows **SEP 25**, consistent with the fictional release-day scene, not the fixed date in the guide asset. |
| `notes.png` | [Notes Help 4.5/10.13 icon](https://help.apple.com/assets/59D1B0A2680CE2D9200B6FC9/59D1B0A2680CE2D9200B6FD0/en_US/858965bd086d3f268d514dad92417afe.png). |
| `messages.png` | [Messages Help 11.0/10.13 icon](https://help.apple.com/assets/5A540238680CE27D670ECE25/5A540239680CE27D670ECE2C/en_US/fdc129e1c91d77eec6e31355e2edb203.png). |
| `photos.png` | [Photos Help 3.0/10.13 icon](https://help.apple.com/assets/5A5402AC680CE2A45E0ECC04/5A5402AD680CE2A45E0ECC0B/en_US/36df22eeb779214eee1add798ecc9248.png). |
| `launchpad.png` | [Mac Help 10.13 inline Launchpad icon](https://help.apple.com/assets/5AA195BD094622847B7F3DA3/5AA195BE094622847B7F3DAA/en_US/95d7b4a21ba05db0eb23957c7e930569.png), [source](https://support.apple.com/guide/mac-help/welcome/mac/10.13). Native inline source is 68×60, so this is not a high-resolution installer asset. |
| `settings.png` | [Mac Help 10.13 System Preferences icon](https://help.apple.com/assets/5AA195BD094622847B7F3DA3/5AA195BE094622847B7F3DAA/en_US/d76edd35367341480f3747218b92861c.png), same source. Native inline source is 67×60. |

The inline Launchpad and System Preferences images arrive with opaque white guide surrounds. Packaging removes only the edge-connected near-white surround (2% flood-fill tolerance) to restore transparency for the Dock, retaining enclosed icon artwork. This is a disclosed local adaptation, not an installer-byte claim.

`finder.png` is a copy of the existing detailed pre-Big-Sur artwork from [YaxinCheng/macOS10icons](https://github.com/YaxinCheng/macOS10icons), which identifies **Catalina 10.15.5**. Apple's [10.13 Finder reference](https://support.apple.com/guide/mac-help/aside/mchlaab6cfc4/10.13/mac/10.13) corroborates the blue smiling-face silhouette, **not exact 10.13 bytes**. This is a disclosed icon approximation, not evidence that Catalina was substituted as the High Sierra desktop. `MACOS10ICONS-LICENSE.txt` is retained; the mirror's software MIT license is not independent clearance for Apple's artwork.

`folder.png` copies the established [folderify v2.4.2 Yosemite icon family](https://github.com/lgarron/folderify/tree/v2.4.2/folderify/GenericFolderIcon.Yosemite.iconset); its [version selector](https://github.com/lgarron/folderify/blob/v2.4.2/folderify/__main__.py) covers macOS **10.10–10.15**, including High Sierra. `FOLDERIFY-LICENSE.txt` is retained. `drive.svg`, `pdf.svg`, and `trash.svg` are existing project illustrations, not native Apple CoreTypes files. Downloads adds the existing embossed-arrow SVG over the period folder.

### Discrete Messages content assets

All `high-sierra/messages/*.png` files are content-only crops from the [High Sierra Messages Help 11.0 illustration](https://help.apple.com/assets/5A540238680CE27D670ECE25/5A540239680CE27D670ECE2C/en_US/f2c77ee0cd2951b6636c60051623f5ad.png). The original reference was fetched for research/cropping only and is not packaged as a runtime desktop or window.

Reference SHA-256: `370a0b0213e7267a9316015ad936c3409a6840f6afee4fc2d0d9e95cb5ce4247`.

| Local asset | Source crop `(x, y, width, height)` |
| --- | --- |
| `euna-kwon.png` | `(86, 110, 56, 56)` |
| `blair-lockhart.png` | `(86, 186, 56, 56)` |
| `bob-willson.png` | `(86, 261, 56, 56)` |
| `brian-carey.png` | `(86, 337, 56, 56)` |
| `jeanne-fox.png` | `(86, 411, 56, 56)` |
| `tammy-tien.png` | `(86, 486, 56, 56)` |
| `the-guys.png` | `(86, 560, 56, 56)` |
| `miami-beach.png` | `(494, 110, 324, 160)` |
| `euna-photo.png` | `(399, 330, 324, 180)` |

Apple/respective rights holders retain rights in these portraits and photographs. No public guide download is treated as a grant of redistribution or commercial prop-production permission. The recreated text/control surfaces remain actual DOM, not screenshot slices. Browser font metrics, vibrancy, rounding, cropped photo borders, source asset revisions and cross-platform rasterization are known fidelity limits; there is **no pixel-identity claim** against native High Sierra.

## Verification hand-off

Implementation workers have run no builds, tests, lint, formatters, commits or runtime smoke checks. The parent should verify registry/capability discovery, offline images/fonts, the independent High Sierra desktop and Euna sample, actor/direct Notes operations and 2017 timestamp continuation, Window-menu/drag/minimize/zoom/close/reopen/refit workflows, profile switching to fresh data, narrow viewports, and unchanged default Mojave pixels before its single feature commit.

## Integrated browser verification

CORE-05 integration exercised all 32 supported commands (43 applied invocations with strict typed request/result validation), 2017 actor creation/editing, keyboard Find/context pin, native Messages/Notes presentation, menu operations, close/reopen record and editor-scroll retention, and 390×844 minimize/refit/restore within the High Sierra workspace. Profile selection mounted fresh 2017 records behind the stable public API; unavailable/unknown/readonly paths preserved data. All registered local image/font URLs were valid. The guide-only icon surrounds were visually checked after transparency correction. This is browser recreation proof, not native High Sierra pixel-identity or rights clearance.

OS-10 adds **shell.dock-context**, bringing current High Sierra discovery to **71 contracts**. Its classic Dock tree exposes actual managed windows, Open/Quit, Keep in Dock and real selected application-bundle reveal in independent Finder directories; Finder is protected. Original live surfaces back App Exposé, including minimized windows and honest empty state, without changing normal/restore geometry. Native Control/right-click/Shift-F10/Command-click/Control-Down, disabled options and strict typed responses passed; classic menus were visually inspected. Virtual application paths are declared policy, not a factory filesystem manifest. High Sierra still does not advertise desktop Stacks; Dock history/preferences/tiles and app hiding/login remain separate slices.
