# SAF-02 tabs and windows — October 23, 2026

The Safari/Edge tab and window lifecycle is accepted across the five installed profiles. Canonical commands remain in `browser-commands.js`; the actual managed windows and native views own their presentation.

## Fixes and validation

Foreground New Tab now dismisses Overview/menus, focuses the genuine new tab's address field and selects its text. Background-tab creation preserves focus. The focus lease captures the new tab and rejects delayed focus after a competing selection. Reopen Closed Tab now dismisses Overview so the restored page is usable.

`bun test tools/browser-state.test.mjs tools/chrome-native.test.mjs tools/menu-bar.test.mjs`: **110 passing, zero failures, 1,316 assertions**. Tests include foreground/background creation and a tab switch during the awaited focus flush. Frontend production build passes with existing warnings.

`runBrowserTabsAcceptance({ browser, baseURL, artifactDirectory })` in `tools/browser-tabs.browser.mjs` ran against the Rust-served production build at port3018 in system Chromium with `--mute-audio`. **28 checks per profile, 140 total**, no page errors or external requests. Actual New Tab/address focus, tab selection, Overview pin/unpin/selection, rejected pinned close, close/reopen identity and history, delivered Control-Tab, new window, retained source tabs, explicit full-window restoration, private navigation/history exclusion, private closed-tab exclusion and disposal, retired-private rejection and narrow tab-control presence passed. Local results/screenshots: `/tmp/jester-saf02/`.

Normal app launch creates a new window at the last page. **Reopen Last Closed Window** explicitly restores the original window ID, tab collection and per-tab navigation history from another live browser window. No automatic reload/session restoration is claimed. Saved-session private exclusion and interrupted loads remain covered by the browser-state tests. Full profile-specific session storage remains owned by the existing saved-session feature.

## Primary reference checks and limits

- [High Sierra Safari11 tabs](https://support.apple.com/en-euro/guide/safari/sfri11576/11.0/mac/10.13): new tabs, pinning, Overview, switching, moving/merging windows, private/nonprivate separation and reopening.
- [Mojave Safari12 tabs](https://support.apple.com/en-euro/guide/safari/sfri11576/12.0/mac/10.14): same core operations and Preferences terminology. The living historical page contains later material (for example tab hover previews); it is not treated as pixel-level release evidence.
- [Sonoma-path guide](https://support.apple.com/en-euro/guide/safari/sfri11576/26.0/mac/14.0): the selector currently points to guidebook26.0 at OSpath14.0; a guessed17.0 path was inaccessible. Existing Sonoma research remains the release baseline.
- [Golden Gate tabs](https://support.apple.com/guide/safari/use-tabs-for-webpages-sfri11576/27.0/mac/27): new tabs, moving private tabs only among private windows, and closed-tab/window recovery.
- [Edge InPrivate](https://support.microsoft.com/en-us/edge/browse-inprivate-in-microsoft-edge) and [shortcuts](https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge): private browsing deletion and window/tab shortcuts. These are living docs, not an exact2023 package geometry source.

The existing Overview is a bounded title/URL card interface, not live native webpage thumbnails. Pin/unpin uses its explicit controls rather than native tab dragging; pinned close follows the simulator's declared unpin-first policy. Tabs are per-window and do not reproduce native cross-window pinned-site synchronization. Narrow verification establishes control presence, not complete mobile ergonomics. Host-reserved keyboard chords require delivery to the page; no host shortcut interception is claimed. No new native chrome or pixel-equivalence claim accompanies this acceptance.
