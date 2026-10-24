# SAF-01 offline browser acceptance — October 23, 2026

The existing Safari/Edge browser implementation is now exercised across High Sierra 10.13, Mojave 10.14, Sonoma 14.0, Golden Gate 27.0.1 and Windows 11 Pro 23H2. This accepts offline navigation only; subsequent Safari backlog items remain unchecked.

## Changes

- Unmatched searches now render “No local results found. Try a different search.” in the actual shared page interior, including an accessible status region.
- Truncating an address to 2,048 UTF-16 units repairs a split surrogate before it becomes canonical state.
- Search URL capacity includes the full `jester://search?q=` prefix. Mixed emoji/ASCII previously exceeded the bound by up to two units, preventing valid canonical navigation.
- Added Unicode/encoded-bound regression coverage and a dependency-injected browser acceptance runner.

## Verification

`bun test tools/browser-state.test.mjs tools/chrome-native.test.mjs tools/menu-bar.test.mjs`: **108 pass, zero fail, 1,305 assertions**. `bun run --cwd frontend build` passes with existing Svelte/bundle warnings. Broader unrelated suite failures from the historical checkpoint were not reclassified or resolved by this slice.

The production build was served by the existing Rust backend at `http://127.0.0.1:3018`. System Chromium ran headlessly with `--mute-audio`, using the preinstalled Playwright package and `runBrowserNavigationAcceptance` exported by `tools/browser-navigation.browser.mjs`. No dependency or browser installation was needed. The runner receives `{ browser, baseURL, artifactDirectory }` and writes results plus desktop/narrow screenshots.

**26 checks per profile, 130 total**, with zero page errors and zero external requests. Actual address typing/Return, page links, Back/Forward, fictional search/results, Reload, offline errors/recovery, unmatched searches and Stop all passed. Stop restores the committed address and adds no history/entry. Equivalent direct navigation commands pass, closed-window history remains retained and a newly opened window starts at the last page, and address entry remains present at 390×844. Screenshots/results: `/tmp/jester-saf01/` (local, not committed). T3 preview snapshot timed out twice; the browser runner provided the fallback verification.

## Evidence boundaries

This slice reuses existing profile chrome and app mappings. The historical profile research remains in [High Sierra](high-sierra-profile.md), [Sonoma](sonoma-profile.md), [Windows apps](windows11-apps.md#microsoft-edge), and [Messages research](messages-native-research.md). No new release-specific toolbar layout or native visual equivalence is claimed. Existing extra controls remain subject to their own queued acceptance items.

Pages, URL aliases, search corpus and errors are authored fixtures. The simulated browser makes no remote navigation/search request. Narrow checks establish address presence, not complete mobile usability. App reopening currently creates a new window at the last page; it does not restore the original live back/forward stack. The closed window retains its original history record. Complete tabs/private/session restoration belongs to `SAF-02`. Next work should start there.
