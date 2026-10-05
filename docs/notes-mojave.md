# Mojave Notes research and working notes

## Target and evidence boundary

Target: **macOS Mojave 10.14, light appearance**, not current macOS Notes. This is a working browser recreation with a fictional camping-trip and photography scene, not the native Notes application or an iCloud client. The references below were read with Apple's version selector explicitly showing **macOS Mojave 10.14**. Unversioned canonical links can resolve to newer documentation; use the version-specific links recorded here.

The screenshot references were visually inspected during research. They inform independently constructed DOM/CSS controls; no Apple screenshot is to be rendered as the application. Public availability of a screenshot is not a redistribution license. No pixel-identity or native AppKit/font-rasterization claim is made.

## Primary references

1. [Notes User Guide for macOS Mojave](https://support.apple.com/guide/notes/welcome/mac/10.14): version-specific landing page, standalone note imagery, and supported native capabilities.
2. [Write and format notes](https://support.apple.com/guide/notes/write-and-format-notes-not9474646a9/mac/10.14): selecting a folder, creating a note from the toolbar, editing text, and deriving the title from the first line.
3. [Sort and pin notes](https://support.apple.com/guide/notes/sort-and-pin-notes-apdb54e469b6/4.6/mac/10.14): the **main-window screenshot with folders, notes list, and editor**, default modification ordering, and pin behavior.
4. [Search your notes](https://support.apple.com/guide/notes/search-your-notes-not18ab658ed/4.6/mac/10.14): account search, natural-language search, attachment search, and Recently Deleted participation in All Accounts search.
5. [About folders](https://support.apple.com/guide/notes/about-folders-notc3b2d538b/4.6/mac/10.14): All [account], Notes, Recently Deleted, default ordering, and account limitations.
6. [Add and remove folders](https://support.apple.com/guide/notes/add-and-remove-folders-apd558a85438/4.6/mac/10.14): Sidebar button, custom folders, drag moves/copies, and empty Recently Deleted visibility.
7. [Delete a note](https://support.apple.com/guide/notes/delete-a-note-not5585d71a8/4.6/mac/10.14): toolbar deletion, Recently Deleted, restore, permanent deletion, and account-dependent behavior.

## Visually inspected UI references

### Main window: folder sidebar, note list, and editor

Source: reference 3, [original Apple image URL](https://help.apple.com/assets/5C58BCEC680CE2E63CFB674B/5C58BCEF680CE2E63CFB6753/en_US/189a66daaa36ec5ed5b89531221c780a.png).

This is the principal three-pane reference, not a standalone note. The image depicts an iCloud sidebar containing All iCloud, Notes, On My iPhone, and Recently Deleted; a middle notes list with a Pinned heading and a revealed orange Pin action; and the selected note's text on the right.

Approximate geometry observed in the displayed source image:

- Canvas appears 934 × 613 image pixels. The application window spans approximately x=0–932 and y=160–557. The substantial space above/below and thin vertical annotation leader lines are part of Apple's instructional illustration, **not application padding or native window decorations**.
- Silver toolbar spans the complete window, approximately y=160–196 (36 image pixels). Traffic lights and compact, lightly raised rectangular toolbar buttons share one horizontal strip; the search field sits at the far right. Do not infer these dimensions as macOS logical points or device-scale metadata.
- Folder/sidebar divider is near x=180; notes-list/editor divider is near x=551. Thus this particular illustrated window allocates roughly 180 image pixels to folders, 371 to the list, and 381 to the editor. These proportions describe this capture, not fixed native minimum widths.
- Sidebar and list are near-white/light gray, with fine vertical and horizontal dividers. All iCloud is selected with a rectangular gray full-width row. There are no floating rounded sidebar selection pills.
- The selected note row is rectangular and pale yellow. The swipe-revealed Pin action occupies an orange block at its left, with a white pin and label; this orange region is an exposed action, not the normal note-selection color.
- A small gray Pinned heading precedes the list. Rows show a stronger title, muted date/time and preview, plus a folder-name line in this All iCloud view. Some rows have attachment thumbnails at the right.
- The editor is very pale paper/near-white, not a saturated yellow legal pad. A centered muted date sits above left-aligned text, with comfortable inset spacing.
- Native toolbar buttons in this reference include sidebar, attachments, trash, compose, lock, table, checklist, Aa formatting, media, participants, and share. Their presence is evidence about native Notes, **not a requirement to expose nonfunctional replicas**.

These are visual estimates, not an automated pixel sampling or registered screenshot comparison. Exact colors, texture parameters, SF font metrics, and device scaling have not been measured here.

### Standalone note: paper, controls, and checklist accents

Source: reference 1, [original Apple image URL](https://help.apple.com/assets/5C58BCEC680CE2E63CFB674B/5C58BCEF680CE2E63CFB6753/en_US/3ab49434a2d420c2e18680a88de025c6.png).

Visually inspected: the “Kitchen remodel ideas” note has a silver titlebar/toolbar, a pale subtly textured paper surface, dark title/body text, a muted centered date, and compact table/checklist/Aa buttons. Completed checklist circles are yellow with white checks; incomplete circles have gray outlines. The large embedded kitchen photo and other rich attachments demonstrate native features outside the plain-text implementation scope. This standalone window cannot establish the main-window sidebar/list geometry; use the preceding reference for that.

### Recently Deleted: annotated crop, not a complete window

Source: reference 7, [original Apple image URL](https://help.apple.com/assets/5C58BCEC680CE2E63CFB674B/5C58BCEF680CE2E63CFB6753/en_US/16bfeac11d7810f7cf09c033e3887417.png).

The image's alt description refers to the Notes window, but visual inspection shows only a crop: a gray selected Recently Deleted sidebar row and a yellow selected “Romano Contractor Notes” list row with title, time, and preview. An annotation leader extends beneath it. It corroborates selection colors; it does **not** supply a clean complete three-pane capture.

## Native Mojave behavior versus this recreation

| Area | Apple Mojave evidence | Planned browser behavior / explicit difference |
| --- | --- | --- |
| Title and editing | The first line becomes the title; click a note in the list and edit its text. [2] | Plain text through native browser inputs. Title comes from the first text line; a blank first line displays “New Note.” Body preview comes from subsequent lines. This is not rich-text Notes. |
| New note | Select a destination folder, then use the New Note toolbar button. [2] | Create in Notes, clear the search, and select the new note, including when invoked while viewing Recently Deleted. This destination rule is a deliberate simplification. |
| Search | Native search supports Current Account / All Accounts, text, attachment filenames, PDFs, drawings, and natural-language date/type queries; the guide says enter text and press Return. All Accounts includes Recently Deleted. [4] | Live case-insensitive title/body text filtering within the selected collection only. No account scope picker, natural-language parser, attachment indexing, Spotlight, or cloud search. Starting editing may clear search to prevent selection/focus bouncing when edited text stops matching. |
| Ordering | Recently changed notes first by default; preferences allow different ordering. Pinned notes stay at the top. [3, 5] | Fixed pinned-first ordering in Notes, then descending update order; Recently Deleted uses descending update order. Distinct ordering timestamps avoid ambiguous simultaneous mutations. No sort preferences panel. |
| Pin | File > Pin Note, or swipe right in the list and click Pin. Requires upgraded iCloud notes or notes stored on the Mac; Recently Deleted notes cannot be pinned. Pin state synchronizes across devices for the relevant account. [3] | A working explicit pin/unpin control for active notes, with no pin action in Recently Deleted. No swipe gesture, File-menu equivalent, or synchronization promised. The explicit control is a usability adaptation rather than a claim of the exact native toolbar. |
| Folders | Native automatic folders include All [account], Notes, and Recently Deleted; users can create and nest folders and drag notes between them. The Sidebar button shows a hidden sidebar. [5, 6] | Two selectable collections, Notes and Recently Deleted, with a working sidebar visibility toggle. No account tree, user-created folders, nesting, or drag-and-drop folder management. |
| Trash | Native delete is a toolbar button, Delete key, or swipe-left action. On My Mac notes and upgraded iCloud notes go to Recently Deleted; other/unupgraded account notes can be permanently removed. [7] | Trash marks a fictional note deleted and moves it to the local Recently Deleted collection; it has no effect on host files or Apple accounts. |
| Restore | Native restoration is dragging a deleted note to another sidebar folder. [7] | A working Restore control returns the note to Notes. Drag restoration and permanent deletion are not promised. |
| Retention | Apple's folder guide says Recently Deleted holds the last 30 days; the deletion guide describes restoration for up to 30 days and final deletion potentially taking up to 40 days. An empty Recently Deleted folder disappears. [5–7] | Recently Deleted remains a visible local collection, even empty, without a timed expiry. Reload resets the whole fictional scene. This is **not native iCloud retention** and not an actual On My Mac database. |
| Persistence | Native account notes are stored locally and/or synchronized according to account type. [1, 7] | State is held only for the current client session, surviving minimize and close/reopen. Reload discards edits and reconstructs the scene. No backend, local disk persistence, cloud, or host Notes access. |

Reference numbers in the table refer to the linked primary references above. The wording in Apple's folder introduction emphasizes upgraded iCloud pinning, while the dedicated sort/pin page explicitly includes notes stored on the Mac; the dedicated instructions are used for that distinction.

Recently Deleted is **not exclusively an iCloud feature**: the version-specific delete guide also documents it for notes stored On My Mac. In this recreation, however, it is a simulated session-local collection, not either native storage system.

## Planned implementation scope and status boundary

The agreed implementation scope is selecting either collection, selecting notes, creating notes, editing first-line title and body, live title/body search, pin/unpin, trash, restore, and working Notes window launch/close/minimize/reopen. The initial scene contains fictional camping-trip and photography notes. Selection must remain a visible note or null after commands; empty collections and zero-match searches need truthful empty states.

The layout plan is a silver Mojave-style toolbar, subtle dividers, folder sidebar, note list with yellow selected rows, and pale paper editor. All visible application controls must perform their advertised action. Lock, share, participants, table, checklist, media, and formatting buttons are intentionally omitted rather than drawn as dead controls. Plain text can contain checklist-like prose, but no native checklist feature is implied. Default Messages appearance must remain unchanged.

At this research checkpoint these are **planned acceptance requirements**, not claims that implementation or browser checks have already passed. Application implementation, verification evidence, and commits are recorded by the integration owner. Browser rendering, fallback fonts, changed fictional content, and platform differences preclude a pixel-identical/native claim.

## Chronological working notes

1. **Research scope established.** Selected Mojave 10.14 light appearance and separated the functional browser Notes scene from native account/cloud operations. Existing `docs/mojave-fidelity.md` established the repository's primary-source and fidelity-limit disclosure style.
2. **Landing and editing guides read.** Confirmed Apple's version selector and first-line title semantics. Visually inspected the standalone kitchen note; retained it for toolbar/paper/checklist observations, not sidebar geometry.
3. **Behavior sources traced.** Followed first-party links to search, folders, folder management, sort/pin, and deletion instructions. Recorded native account-scoped search and account-dependent deletion rather than attributing those capabilities to a plain-text local scene.
4. **Main-window reference located and inspected.** The sort/pin guide supplied the full three-pane image linked above. Recorded approximate pane boundaries, one-strip silver toolbar, gray folder selection, yellow note selection, and the orange exposed Pin action. Shared this reference with the integration owner before UI implementation.
5. **Deleted-note illustration checked visually.** Corrected the initial expectation of another full-window reference: its actual image is an annotated crop. Also confirmed that native Recently Deleted exists for On My Mac as well as upgraded iCloud notes.
6. **Implementation contract documented.** Recorded the session-only persistence, fixed two-collection model, search simplification, working-control restriction, and explicit restore button as intentional deviations. No application files were changed in this research task; no build, tests, lint, formatting, or live-app verification was run here.
7. **UI and state implementation added; runtime verification pending.** The parent owns note data in `App.svelte`, independent of window mounting. `NotesWindow.svelte` uses native title/body inputs rather than raw HTML or a custom rich-text engine; this keeps editing, selection, clipboard text, and multiline body input browser-native. The silver toolbar and three-pane proportions follow the main-window reference; the simulated account is labeled On My Mac. Unsupported rich-text/cloud controls are omitted, not disabled replicas. Pin/unpin is in the note-row context menu, also reachable with Shift-F10. Deterministic mutation timestamps advance by one millisecond from the scene's September 24, 2018 5:42 PM note time, retaining ordering without moving the scene clock on each typed character.
