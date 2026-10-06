# Mojave visual fidelity research

## Target and primary references

Target: macOS Mojave 10.14 (2018), light appearance, with a Messages window. This predates Big Sur's rounded-square application icons and floating rounded Dock.

Primary sources:

1. [Apple's Mojave introduction, June 4, 2018](https://www.apple.com/newsroom/2018/06/apple-introduces-macos-mojave/): desktop appearance, Dock, Finder, light/dark appearance, and dynamic desktop.
2. [Apple's Mojave release announcement, September 24, 2018](https://www.apple.com/newsroom/2018/09/macos-mojave-is-available-today/): release-era desktop and Messages imagery.
3. [Apple's Messages User Guide, explicitly selected for macOS Mojave 10.14](https://support.apple.com/guide/messages/welcome/mac/10.14): light Messages reference, toolbar/search layout, recipient label, conversation rows, bubbles, and composer. [Original reference PNG](https://help.apple.com/assets/5CA2B98509462224109A65C3/5CA2B98909462224109A65CB/en_US/f1d950e0f2f08a902a1927bc5be67446.png).
4. [June 2018 wallpaper release coverage](https://osxdaily.com/2018/06/06/grab-default-macos-mojave-wallpapers/): links to the 5120×2880 [Mojave Day photograph](https://9to5mac.com/wp-content/uploads/sites/6/2018/06/mojave-day.jpg) and [Mojave Night photograph](https://9to5mac.com/wp-content/uploads/sites/6/2018/06/mojave-night.jpg). Secondary distribution source, not a grant of rights.
5. [AppleInsider's June 6, 2018 hands-on capture](https://appleinsider.com/articles/18/06/06/hands-on-with-dark-mode-in-macos-mojave): additional period references for the Dock and app chrome.

The Apple press ZIPs contain product photographs with display hardware around the UI, not unscaled full-screen captures. They are unsuitable for a literal whole-desktop pixel comparison. The Messages guide PNG is a direct, alpha-backed window image and is the component comparison reference.

## Measurements from the light Messages reference

The source PNG is 934×713. Its visible window occupies approximately x=0–927 and y=0–709; the remaining pixels are transparent padding. These are **image pixels**, not claims about native macOS logical points.

Measured source regions:

- Unified toolbar ends near y=79. Traffic lights occupy the upper-left titlebar area; search and compose sit beneath them. The recipient and blue Details label are inside that same toolbar, not a separate recipient strip below it.
- Sidebar/conversation divider is near x=376.
- First selected conversation spans approximately y=80–167; subsequent rows are roughly 88 image pixels high.
- Large solid conversation background: RGB (245, 246, 246).
- Large solid sidebar background: RGB (214, 214, 214).
- Incoming bubble interior includes RGB (223, 221, 227).
- Selected row includes RGB (69, 149, 246), with small source-image variations. It is full-width, not a rounded floating pill.
- Composer is capsule-shaped; the smiley sits inside its right edge and a separate microphone sits to its right.
- Outgoing bubbles have subtle vertical color variation. This is not the uniform blue used in the first implementation.

The roughly 16-image-pixel traffic lights suggest about 4/3 scaling relative to a conventional 12-point control. That scale is an **inference**, not metadata supplied by Apple. Comparisons should retain or explicitly normalize source scale; never silently compare unrelated image sizes.

## Asset provenance and production limitations

`frontend/public/wallpapers/mojave-day.webp` is a locally encoded WebP of Apple's Mojave Day photograph distributed by 9to5Mac at the link above. Apple retains its rights. The earlier original vector approximation was removed because it was visually unlike Mojave.

Downloading a publicly hosted wallpaper or icon is not evidence of a redistribution license. The Apple Newsroom ZIP legal notice explicitly limits those media to personal/editorial, non-commercial use. This repository's local visual experiment is not a claim of commercial film/TV clearance. Obtain appropriate clearance before shipping Apple artwork in a production prop product or using it commercially. Reference images must not be substituted for the actual DOM application.

Native San Francisco font rendering and Core Animation/AppKit rendering are separate from browser rendering. A cross-platform browser recreation cannot claim zero pixel differences from a macOS capture merely because its layout looks close. Any final comparison must disclose font fallback, image scaling, changed content, and nonzero residuals.

## Typography

[Apple's San Francisco license](https://developer.apple.com/fonts/) explicitly prohibits embedding the font in software and using it for non-Apple-platform mock-ups. No SF font is bundled. On Apple platforms, the browser's native `-apple-system` font remains preferred for UI text. Other platforms explicitly use the local, unmodified [Inter variable font](https://github.com/rsms/inter). Conversation text uses a separately calibrated, bundled [Liberation Sans](https://github.com/liberationfonts/liberation-fonts) regular font. Both are SIL Open Font License 1.1 fonts; their full licenses are included at `frontend/public/fonts/LICENSE.txt` and `Liberation-LICENSE.txt`.

This fallback is visually similar, not metrically identical to Mojave's SF UI font. Cross-platform font rasterization remains a measurable limitation, not a reason to hide text from the comparison.

CDP `CSS.getPlatformFontsForNode` exposed an important renderer detail: Chromium on this Linux machine resolves the `-apple-system` stack to installed Liberation Sans **before** reaching Inter. The initial checkpoint therefore used Liberation Sans, not the intended Inter fallback. The startup code now prefers the native alias only on Apple platforms. The calibrated checkpoint verified actual custom Inter UI glyphs and actual custom Liberation Sans conversation glyphs; both font faces were loaded, not merely declared in CSS.

Bundled font SHA-256:

- InterVariable.woff2: `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`
- LiberationSans-Regular.ttf: `baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee`

Liberation Sans was copied unmodified from the installed 2.1-series `/usr/share/fonts/liberation/LiberationSans-Regular.ttf`; its upstream copyright and OFL notice are retained. Its use is a measured visual approximation, not a claim that Mojave Messages uses Liberation Sans.

## Comparison method

`tools/compare-mojave.mjs` accepts equally sized reference/render PNGs and an output directory. It writes a 50/50 overlay, a 4×-amplified RGB difference image, and regional JSON metrics. It does not register, resize, recolor, or mask UI content. Metrics include every reference pixel with alpha ≥ 250; Apple's transparent padding and partially transparent outer edges are excluded. RGB errors use 8-bit sRGB values. Normalized RMSE is the channel root-mean-square error divided by 255, expressed as a percentage; it is **not a similarity score**.

The reference is cropped from 934×713 to its 928×710 window canvas. Initial UI evidence is preserved locally as `artifacts/mojave/before-normalized.png`: the original 880×570 window was cropped at (180, 151), then explicitly stretched to 928×710 for a rough visual baseline. That baseline has different content and aspect ratio; its 31.582% normalized RMSE is not an apples-to-apples geometry or content comparison. Subsequent exact-size captures use the same sample conversation and require no resizing.

Generated screenshots and comparison artifacts remain local under ignored `artifacts/`; they are not shipped as application UI assets.

## Reconstructed scene and icon provenance

`MessagesWindow.svelte` reconstructs the guide's Shelley Willems conversation with selectable-looking but inactive controls. Names, times, previews, and message text are actual DOM text. Toolbar, sidebar, bubbles, composer, traffic lights, and control glyphs are CSS/SVG, not screenshot slices.

The discrete content assets in `frontend/public/messages/` are crops of the primary guide PNG. Coordinates below are (x, y, width, height) in the original 934×713 image:

| Asset | Crop |
| --- | --- |
| Shelley portrait | (28, 89, 67, 67) |
| Chris portrait | (28, 178, 67, 67) |
| Amber portrait | (28, 266, 67, 67) |
| Charles portrait | (28, 355, 67, 67) |
| Greg portrait | (28, 444, 67, 67) |
| Euna portrait | (28, 532, 67, 67) |
| Ryan portrait | (28, 621, 67, 67) |
| Silhouette photograph | (400, 80, 387, 156) |
| Grinning face | (695, 492, 65, 68) |
| Camping | (765, 496, 70, 65) |
| National park | (838, 491, 67, 70) |
| Thumbs up | (105, 377, 20, 22) |
| Sleeping | (242, 221, 20, 22) |

Apple retains rights in these images. The public guide is a comparison source, not a redistribution or commercial-production license.

The ten application PNGs in `frontend/public/icons/` were extracted from ICNS files in [YaxinCheng/macOS10icons](https://github.com/YaxinCheng/macOS10icons). That repository explicitly identifies **Catalina 10.15.5**, not Mojave 10.14. These are detailed pre-Big-Sur Apple icons with appropriate period silhouettes; exact Mojave icon-byte equivalence has **not** been established. The mirror's MIT license does not establish a license to Apple's artwork. Highest available embedded PNG representations were resized to 128×128 locally.

Source ICNS paths under the mirror's `docs/`:

- Finder: `com.apple.finder/Finder.icns`
- Launchpad: `com.apple.launchpad.launcher/Launchpad.icns`
- Safari: `com.apple.Safari/compass.icns`
- Mail: `com.apple.mail/ApplicationIcon.icns`
- Contacts: `com.apple.AddressBook/Contacts.icns`
- Calendar: `com.apple.iCal/App.icns`
- Notes: `com.apple.Notes/AppIcon.icns`
- Messages: `com.apple.iChat/MessagesAppIcon.icns`
- Photos: `com.apple.Photos/AppIcon.icns`
- System Preferences: `com.apple.systempreferences/PrefApp.icns`

Drive, PDF, and Trash SVGs remain original illustrations, not authentic Mojave CoreTypes assets. The earlier generic folder SVG was replaced with the preserved `GenericFolderIcon.Yosemite.iconset/icon_128x128.png` from [folderify v2.4.2](https://github.com/lgarron/folderify/tree/v2.4.2/folderify/GenericFolderIcon.Yosemite.iconset). Its [version-selection implementation](https://github.com/lgarron/folderify/blob/v2.4.2/folderify/__main__.py) explicitly selects this family for macOS 10.10 through **10.15**, including Mojave 10.14. The Downloads variant adds an original embossed SVG arrow over that base. The mirror's software-license notice is retained; it is not independent commercial clearance for Apple artwork.

Calendar retains the extracted paper artwork but reconstructs its date face with SVG text as **SEP 24**, matching the static September 24 menu-bar scene rather than incorrectly showing the source asset's July 17. The [period TechRepublic desktop gallery](https://www.techrepublic.com/pictures/apple-macos-mojave-a-look-at-the-new-features/) provides additional evidence of the date-aware, tilted-paper Dock icon. Source repository license notices are included under `frontend/public/icons/`.

## Verified reconstruction checkpoint

The rebuilt production desktop was served by Rust at `http://localhost:3000` and viewed in Chromium at 1440×900, DPR 1. The Messages frame is 696×532.5 at the default 0.75 scale; every image loaded locally, with no page errors or horizontal document overflow.

For the first exact-size comparison, the browser window was positioned at (20, 42) and its scale set to 1, avoiding the Dock without hiding it or changing the window skin. The resulting element screenshot is exactly 928×710. Initial normalized RMSE: **7.900%** overall, 6.421% toolbar, 8.231% sidebar, 8.218% conversation, 4.312% composer. About 10.171% of opaque reference pixels have an RGB-channel error above 8. The overlay shows real font, image-resampling, and subpixel-row-placement differences. This is not pixel identity.

## Calibrated reconstruction checkpoint

Overlay-guided changes aligned portrait rows to measured integer y positions, removed photograph resampling, calibrated conversation text to 19px Liberation Sans with its measured inset, selected Inter explicitly for non-Apple UI text, and matched the Dock calendar date to the scene.

The production render at the same 928×710/DPR-1 comparison pose measures **7.007% normalized RMSE** overall; regional values are 6.451% toolbar, 7.208% sidebar, 7.185% conversation, and 4.335% composer. About 8.734% of opaque reference pixels exceed an RGB-channel error of 8. The first-to-calibrated exact-size RMSE reduction is approximately 11.3%; neither result is zero.

These figures include text and artwork edges. Remaining errors include SF-versus-open-font glyph shapes and spacing, native rasterization versus browser rasterization, rounded-edge/bubble-tail details, control glyphs, and minor source-image edge differences. Desktop icons from Catalina and original CoreTypes-style illustrations are separately disclosed; a whole-desktop pixel-identity result has not been established.

## Final measured render and live comparison

The last refinement preserved the photograph's full 156-pixel crop at intrinsic size and aligned incoming/last-outgoing bubble extents to measured source pixels. It also replaced the generic folder illustration with the preserved Yosemite/Mojave-family bitmap and added the Downloads emboss.

Final comparison: 928×710, Chromium on Linux, DPR 1; no registration or image resizing:

| Region | Normalized RGB RMSE |
| --- | ---: |
| Entire Messages window | **6.854%** |
| Toolbar | 6.451% |
| Sidebar | 7.208% |
| Conversation | 6.871% |
| Composer | 4.335% |

Mean absolute channel error is 4.139/255. About 8.683% of opaque reference pixels have at least one RGB-channel error above 8. Text, photos, avatars, emoji, and control/bubble edges all remain in the score. This is a measured approximation, **not zero difference**. Native SF/AppKit rendering and cross-platform open-font/browser rendering are not interchangeable; native Mojave verification and a permitted exact font/assets distribution path are unavailable in this Linux project environment.

Current local previews:

- Actor-facing desktop: `http://localhost:3000/`
- Separate comparison viewer: `http://localhost:3001/`

The comparison viewer is a second Rust server serving ignored evidence files, not a developer panel in the actor-facing app. Its slider was exercised with keyboard input at 0% and 100%, then viewed at 50%; the difference-map disclosure was opened. All three evidence images loaded locally and there were no page errors.

Evidence files:

- `artifacts/mojave/reference.png`
- `artifacts/mojave/reconstruction-final.png`
- `artifacts/mojave/final-comparison/index.html`
- `artifacts/mojave/final-comparison/overlay.png`
- `artifacts/mojave/final-comparison/difference-4x.png`
- `artifacts/mojave/final-comparison/metrics.json`
- `artifacts/mojave/viewport-proof.json`
- `artifacts/mojave/desktop-{width}x{height}.png`

The final production surface was exercised at 1440×900, **1920×1080**, 1280×800, 1024×768, and 390×844. Window, Dock, and desktop files stayed inside each viewport, with no window/Dock overlap, document overflow, broken images, external-origin resource requests, or page errors. The health endpoint returned `status: ok`. The final Vite build completed without component warnings.

## Interactive window-management checkpoint

At this checkpoint the desktop gained one window per application, with focus/stacking, title-bar dragging, close, minimize/restore, workspace zoom, and a keyboard-accessible Window menu. Desktop files select and open Finder/Preview windows. Only Messages had application content at this stage; the later Notes implementation is documented below. See the README interaction contract.

The rebuilt Rust-served surface was exercised in Chromium at 1440×900, 390×844, and 800×350, including restoring a zoomed/minimized Messages window after resizing. All ten Dock applications launched, deduplicated, and closed. Desktop file launch, Dock keyboard activation, drag boundaries, preserved restore geometry, Window menu commands, disabled commands without an active window, menu dismissal, and reload reset were exercised. No page errors, broken images, external-origin resources, or document overflow were observed.

A fresh active-Messages capture using the recipe below is 928×710 at DPR 1. Its normalized RGB RMSE is **6.853846%**, matching the earlier checkpoint's opaque-reference regional measurements; this is not a claim of pixel identity. The existing localhost:3001 viewer still serves the earlier static checkpoint. New comparison output is under ignored `artifacts/mojave/interactive-comparison/`; live interaction proof is `artifacts/interaction-windows.png`, and the new capture is `artifacts/interaction-capture-recipe.png`.

The subsequent [Notes research and implementation](notes-mojave.md) adds a working plain-text Notes app using Apple's Mojave three-pane reference. Its verification also corrected fractional Dock-height reservation. A new default Messages capture after these changes retains **6.853846% normalized RGB RMSE**; evidence is under `artifacts/notes-mojave/messages-comparison/`. Notes has a researched DOM/CSS recreation, not an exact-pixel comparison against the differently populated Apple reference.


## Reproducing the comparison

Comparison tooling requires Bun and ImageMagick; these are not extra runtime requirements for the served puppet screen.

1. Obtain the linked original Apple reference PNG, then crop its transparent padding:

   ```sh
   mkdir -p artifacts/mojave
   curl -L --fail 'https://help.apple.com/assets/5CA2B98509462224109A65C3/5CA2B98909462224109A65CB/en_US/f1d950e0f2f08a902a1927bc5be67446.png' -o artifacts/mojave/messages-light.png
   magick artifacts/mojave/messages-light.png -crop 928x710+0+0 +repage artifacts/mojave/reference.png
   ```

2. Build/start the app using the README commands. Reload to restore the initial active Messages window. In Chromium, set the device viewport to 1440×900 and DPR to **1**. In DevTools Console, pose the managed window without changing its skin:

   ```js
   const slot = document.querySelector('[data-window-id="messages"]');
   Object.assign(slot.style, {
     left: '20px', top: '20px', width: '928px', height: '710px',
   });
   Object.assign(slot.querySelector('.window-surface').style, {
     width: '928px', height: '710px', transform: 'scale(1)',
   });
   await document.fonts.ready;
   ```

   Move the pointer off the window controls so hover glyphs do not enter the capture. Use Elements → `.messages-window` → Capture node screenshot. Save the resulting **928×710** PNG as `artifacts/mojave/reconstruction-final.png`. Do not drag or resize after applying this temporary pose; reload afterward to restore managed placement. Mac/native-font captures may produce different measurements from the verified Linux/open-font run.

3. Generate and serve the evidence:

   ```sh
   bun tools/compare-mojave.mjs artifacts/mojave/reference.png artifacts/mojave/reconstruction-final.png artifacts/mojave/final-comparison
   backend/target/release/jesteros-backend --bind 127.0.0.1:3001 --frontend-dir artifacts/mojave/final-comparison
   ```

   Open `http://localhost:3001/` or the generated `index.html` directly. The tool rejects unequal image dimensions instead of silently resampling.

4. Exercise the comparison regression:

   ```sh
   bun test tools/compare-mojave.test.mjs
   ```

   This uses real ImageMagick and catches transparent-reference padding corrupting the score, transparent difference maps hiding real errors, and grayscale source images losing RGB differences. It failed before explicit true-color conversion and passed after the fix. The application surface was verified in the browser rather than through mocked UI tests.

## OS-17 — Dashboard research inputs (macOS Mojave 10.14)

This section records **research and implementation inputs, not an implementation checkpoint or runtime proof**. Mojave-specific guide text takes precedence over older support instructions. Older Apple illustrations establish the widget family and visible controls, **not exact 10.14 artwork, dimensions, or animation timing**. No new assets or reference screenshots were saved.

### Primary sources and version boundaries

- **[D14]** [Get quick info with Dashboard on Mac — Mojave 10.14](https://support.apple.com/guide/mac-help/get-quick-info-with-dashboard-mchlp2837/10.14/mac/10.14). The selector explicitly identifies Mojave; describes presentation, activation, dismissal, add/remove, dragging, and optional Info controls. Dashboard is distinct from Notification Center's Today widgets.
- **[P14]** [Change Mission Control preferences — Mojave 10.14](https://support.apple.com/guide/mac-help/change-mission-control-preferences-mchlp2345/10.14/mac/10.14). Documents Dashboard **off by default**, As Space, As Overlay, Show Dashboard keyboard/mouse shortcuts, modifier combinations, and Hot Corners.
- **[S14]** [Work in multiple spaces — Mojave 10.14](https://support.apple.com/guide/mac-help/work-in-multiple-spaces-mh14112/10.14/mac/10.14), plus [Mission Control — Mojave 10.14](https://support.apple.com/guide/mac-help/open-windows-spaces-mission-control-mh35798/10.14/mac/10.14). Documents Control-Left/Right, trackpad space switching, and selecting a Spaces-bar thumbnail.
- **[B12]** Apple's [Mac Basics: Dashboard, HT2492, last modified November 16, 2012](https://web.archive.org/web/20130914094439/http://support.apple.com/kb/ht2492). Archived **Mountain Lion-era primary Apple content**, with individual descriptions of all five requested widgets. The original `https://support.apple.com/kb/HT2492` redirects to HT201738, which currently returns 404; the archived content was read directly, not inferred from a third-party transcription.
- **[B18]** Apple's [Mac Basics: Dashboard gives you quick access to frequently used info, HT201738](https://web.archive.org/web/20190101001950/https://support.apple.com/en-us/HT201738). Archived Apple article displaying a December 5, 2018 publication date, but explicitly marked no longer updated and containing **Mavericks-era** illustrations (`mavs_dashboard.png`, January 2014 calendar). Confirms duplicate widget instances, browser search, Dock/Applications launch, Info settings, removal, and Escape dismissal. Its gesture wording differs from D14; do not silently treat it as the Mojave gesture specification.
- **[DEV]** Apple [Widget Basics](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/Dashboard_ProgTopics/Articles/WidgetBasics.html), [Designing Widgets](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/Dashboard_ProgTopics/Articles/Design.html), [Widget Backs and Preferences](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/Dashboard_ProgTopics/Articles/Preferences.html), and [Declaring Control Regions](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/Dashboard_ProgTopics/Articles/ControlRegions.html), *Dashboard Programming Topics*, document version 2.9.0 / stated update February 1, 2010. These are older primary developer guidance, not Mojave measurements; some embedded illustrations show May 2012.

### Presentation, transitions, and management

| Interaction | Apple evidence | OS-17 implementation input / limit |
| --- | --- | --- |
| Mode selection | Apple menu → System Preferences → Mission Control → **Dashboard** pop-up. As Space has a separate space; As Overlay appears over the desktop; P14 says off is the default. | Preserve the native labels **Off**, **As Space**, **As Overlay**. Overlay is not a normal app window or a Notification Center panel. Space is a workspace surface rather than widgets pasted over app windows. An initially enabled demonstration scene would be local staging policy, not Apple's default. |
| Open | D14: Launchpad → Dashboard, Siri “Open Dashboard,” configured Show Dashboard keyboard/mouse shortcut, configured Dashboard Hot Corner. As Space also supports moving between spaces. B18 additionally shows Dock/Applications launch. | Use the existing simulated desktop entry points; activation should reveal the same widget instances. Do not launch an actual host app or claim an implemented Siri/trackpad integration from guide text. |
| Keys and gestures | D14 intentionally specifies the **configured shortcut**, not one universal key. DEV's older default is F12. D14 says three-finger swipe right opens the Dashboard Space and left closes it; S14 documents Control-Left/Right between spaces and Control-Up for Mission Control. | F12 is a reasonable local Show Dashboard binding but is **not a source-backed universal Mojave default**; Fn/function-key behavior depends on host settings. Browser-reserved F12 and OS-reserved combinations can be unavailable. Control-Up is Mission Control, not the direct Dashboard toggle. Do not alter host keyboard preferences to make a web simulation work. |
| Close | D14: Escape, screen click, or the mouse/trackpad shortcut again. B18 also documents switching to another app via Mission Control/Application Switcher. | Interpret the screen click as an **unoccupied background** click: widget controls must continue to work, not dismiss Dashboard. This hit-testing clarification is local policy consistent with interaction and older Dashboard behavior. Return to the prior desktop/space without closing its app windows. |
| Add | D14: lower-left **+**, then click a widget. B18: browser search by name and multiple copies of the same widget. | Picker should show actual widget choices and add a new independently configurable instance. The native browser is a grid with search, not the pre-Lion bottom shelf. Limiting the catalog to the five requested widgets is deliberate local scope, not a claim about Apple's complete catalog. |
| Remove | D14: lower-left **−**, then that widget's **X**. Option + pointer-over reveals a close button when absent. DEV places X over the upper-left artwork and distinguishes removing an instance from deleting its installed widget. | Removing one instance must leave other copies and the catalog entry intact. Do not use the normal app traffic-light close control. Removal mode and Option-hover must not activate underlying widgets accidentally. |
| Reposition | D14: drag widgets around the screen. DEV: widgets drag by their body except designated controls; Calculator keys specifically must not start a drag. | Drag non-control artwork, not inputs, menus, buttons, or calendar arrows. Viewport clamping and keyboard-accessible positioning are local web accessibility/layout policy, not measured native drag constraints. |
| Configuration | D14: pointer-over → **i**, if available. DEV: bottom-right Info where possible, flip to a subdued/darker back, small standard controls, **Done** flips back. | Only offer genuine options appropriate to a widget. Do not add an arbitrary resize handle or Info back to every widget. Native preferences can persist across logins (DEV); simulation persistence/reset semantics are a separate local contract. |

**Mode-change policy, not proven native transition behavior:** maintain one shared collection of widget instances/configuration/positions across modes; Off dismisses Dashboard and removes its Dashboard Space entry without destroying widget data. As Space offers a selectable Dashboard entry in Mission Control; overlay does not add a workspace. Preserve/return to the previously selected ordinary space. General desktop-space deletion in S14 is **not evidence** that the special Dashboard Space should have a normal deletable thumbnail, accept dragged app windows, or support Split View. Exact space ordering, mode-switch restoration, multi-display behavior, and fade/slide/ripple durations were not established by the available 10.14 sources.

### The five native widgets

The controls below combine D14's general behavior with B12's widget descriptions and the directly inspected Apple illustrations listed next. Appearance continuity into Mojave is an **inference**, not byte-identical 10.14 proof.

| Widget | Source-backed controls and configuration | Directly observed visual input / remaining boundary |
| --- | --- | --- |
| **World Clock** | B12: local time for selected world city; multiple instances for multiple time zones; Info → continent/region menu, City menu, Done. | Black/gray rounded rectangular body, circular white analog face, black hour/minute hands, red second hand, AM/PM above, uppercase city below. The actual B12 back illustration says **Region:** and **City:**, although its prose calls the first menu “Continent.” Back shows Africa, Asia, Atlantic, Australia, Europe, North America, Pacific, South America. Prefer the visible **Region** label; exact Mojave city list and daylight/night face-switch rules are unverified. Zone-aware advancing hands are functional local behavior; city names/time-zone identifiers must come from the fictional fixture contract, not geolocation. |
| **Calculator** | B12: add/subtract/multiply/divide; pointer buttons or numeric keyboard input. DEV Calculator illustration explicitly shows memory buttons **m+**, **m−**, **mc**, **mr**, digit keys, decimal point, **c**, ÷, ×, −, +, and tall **=**. | Orange rounded border, gray keypad, cyan/blue top numeric display, white circular keys, vertical pill-shaped equals key spanning the lower two rows. Memory row sits above `7 8 9`; bottom numeric row is `0 . c`. This is not the standalone Calculator app's scientific/programmer UI; do not substitute modern `%`/`±` keys for the photographed memory row. Standard memory semantics are an implementation interpretation of those labels; repeated-equals, rounding, overflow, clear-entry distinctions, error copy, and full native keyboard mapping are not specified by these sources. No configuration back is evidenced. |
| **Calendar** | B12: current day/date, past/future month navigation with left/right arrows; can show events from the native Calendar app. | Two joined black panels with silver/gray border: large weekday/date on left, compact seven-column month grid on right; bright yellow-green weekday/month/current-date accents, dim out-of-month dates, month arrows at top corners. Native calendar data is app-linked, not fabricated. OS-17 uses its local calendar/date fixtures; event selection/presentation, a Today-reset affordance, compact/expanded toggling, and an exact Mojave event-list/back UI are not established here. Do not present a new event editor as researched native Dashboard functionality. |
| **Weather** | B12: current conditions, city, high/low/current temperature, graphical condition; clicking the body reveals a **six-day** forecast. Info → enter city/state/ZIP → Done. | Blue rounded panel; city/H/L at upper-left, oversized condition artwork near center, very large current degrees at right, six day columns below. The later retained `mavs_dashboard.png` shows both forecast highs and dim smaller lows; the developer's older isolated Weather art shows a single forecast temperature row. Prefer the later high/low visual evidence but disclose the version. Units selection, location autocomplete/validation details, back-side layout, exact Mojave attribution/provider, and collapsed/expanded dimensions are unverified; any local Celsius/Fahrenheit control must be identified as local policy rather than sourced exact UI. |
| **Unit Converter** | B12: **Convert** category pop-up; lower-left source-unit pop-up and lower-right target-unit pop-up; enter a number in the left field and read conversion on the right. Listed examples include weights, measurements, temperatures, speeds, currency, and volume; not an exhaustive menu specification. | Retained Apple overview directly shows a compact silver/gray rounded rectangle with blue perforated/ruler-like top strip, Convert → Area, unit menus (`Square Mile`, `Hectare`), and two white value/output fields below. These controls are on the **front**, not an invented Info back; no native swap button is evidenced. Supported category/unit subsets and numeric formatting must be explicitly local policy; mathematical unit conversion is functional, while currency requires dated fixture rates, not a claim of current exchange data. |

**Bounded local controls contract:** OS-17's Unit Converter supports exactly **Length, Mass, Temperature, and Currency**; Area in the Apple illustration is evidence of the native widget, not a request to expand this local catalog. The complete native category/unit set remains unverified. World Clock's **Region** menu must genuinely filter the available fictional **City** options, and **Done** must apply the selected city's time zone and return to the front; decorative, nonfunctional menus would not satisfy the interaction input. This finite fixture catalog is not Apple's full location database.

### Directly inspected primary illustrations (URLs, not shipped assets)

| Reference | URL and version limit |
| --- | --- |
| Retained Apple Dashboard overview, all five widget faces visible | [mavs_dashboard.png](https://support.apple.com/library/content/dam/edam/applecare/images/en_US/osx/mavs_dashboard.png) — linked by B18; calendar reads January 6, 2014, so **not a Mojave capture**. Shows converter front, calculator memory row, calendar arrows, clock, and weather highs/lows. |
| Retained Apple widget browser | [add_dashboard_widgets.png](https://support.apple.com/library/content/dam/edam/applecare/images/en_US/osx/add_dashboard_widgets.png) — B18's dark full-screen grid, top search, lower-left +/−/More Widgets; catalog includes more than the requested five. |
| Retained Apple removal view | [remove_widgets.png](https://support.apple.com/library/content/dam/edam/applecare/images/en_US/osx/remove_widgets.png) — B18; visible +/− and widget bodies. This image itself does **not** clearly show widget X buttons; the X interaction is established by D14/B12 text and DEV art instead. |
| World Clock front and configuration | [HT2492_108-MtLion-Widgets-003-en.png, actual archived image capture October 25, 2013](https://web.archive.org/web/20131025224505im_/http://km.support.apple.com/library/APPLE/APPLECARE_ALLGEOS/HT2492/HT2492_108-MtLion-Widgets-003-en.png) — Mountain Lion-era Paris clock, Region/City/Done, expanded region menu. |
| Calculator control layout | [calculator_focus_gray_2x.png](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/Dashboard_ProgTopics/Art/calculator_focus_gray_2x.png) — DEV control-region illustration, intentionally gray-highlighted; use for control layout, not exact colors. |
| Calendar / Clock / Weather faces | [cal_clock_weather_2x.png](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/Dashboard_ProgTopics/Art/cal_clock_weather_2x.png) — DEV design illustration; May 2012 calendar. |
| Isolated Weather and visible Info | [a_widget_2x.png](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/Dashboard_ProgTopics/Art/a_widget_2x.png) — DEV; six forecast columns and lower-right i. |
| Older complete Dashboard with close boxes | [dashboard_2x.png](https://developer.apple.com/library/archive/documentation/AppleApplications/Conceptual/Dashboard_ProgTopics/Art/dashboard_2x.png) — DEV; May 2012 and obsolete bottom widget shelf. Useful for widget artwork/X position, **not** the Mojave picker layout or overlay background. |
| Actual Mojave guide control artwork | [Add](https://help.apple.com/assets/5BFDD3F8094622802EEE504F/5BFDD3F9094622802EEE5056/en_US/65878f61d80831387cd7dbe53d795449.png), [Remove](https://help.apple.com/assets/5BFDD3F8094622802EEE504F/5BFDD3F9094622802EEE5056/en_US/dafc197b948e8d02efe3601c67fe521c.png), [Close](https://help.apple.com/assets/5BFDD3F8094622802EEE504F/5BFDD3F9094622802EEE5056/en_US/aaefb45d0cd5e62bcfafacf471396d2c.png), [Info](https://help.apple.com/assets/5BFDD3F8094622802EEE504F/5BFDD3F9094622802EEE5056/en_US/8dc31f036c5635d24b58f2297c26894f.png) — D14 inline control illustrations. Add was inspected directly; the others are cited linked controls, not newly measured screenshots. |

### Fictional/offline policy and visual limits

- **Native versus local data:** Apple's Weather is presented as current conditions/forecast; native Calendar accesses real Calendar events; Unit Converter includes monetary conversion. Those descriptions do not license calling fictional fixture weather or currency “live.” OS-17 must use only packaged fictional places, dates/events, forecasts, and explicitly fixed fictional exchange rates, with no external fetch, geolocation, API credentials, or real-person data. Unit math and clock progression can be real computations over local state; fixture provenance remains fictional. Exact native weather/currency service URLs, rate update frequency, caching, and present-day availability were **not verified**. Native live service behavior has not been reproduced.
- **Catalog/host boundary:** B18 documents More Widgets downloads and Safari Web Clips; DEV documents native `.wdgt` installation, network access, plug-ins, and command execution. These are historical capabilities, **not** OS-17 requirements or safe browser equivalents. Do not implement third-party downloads, real `.wdgt` execution, Safari clipping, host filesystem/command access, hidden developer-mode `defaults` changes, or global keyboard/hot-corner changes. The simulated catalog contains only the five supported widgets; omitted external actions should not masquerade as working downloads.
- **Visual claims:** No available full Dashboard illustration inspected here is an authenticated 10.14 screenshot. The exact Mojave Space background texture, overlay dim amount/blur, initial widget placement, point-to-image scale, shadow kernels, fonts, back-side skins, and transitions remain unmeasured. Older primary design guidance recommends custom front controls, subdued backs, approximately 50%/4px-offset/10px-blur widget shadows, and 75×75 widget-bar icons; these are **historical guidelines**, not measured Mojave browser pixel values. Original DOM/CSS/SVG approximations may use them as inputs but must not claim pixel identity. Existing Apple artwork/font licensing limits above still apply.

## OS-17 implemented Dashboard and retained-scene proof

Mojave now exposes174 contracts and ten eligible Launchpad apps. Dashboard defaults Off and is unpinned, leaving the default Messages desktop unchanged. Native Mission Control preferences select Off/As Space/As Overlay; the same independent Clock/Calculator/Calendar/Weather/Converter instances survive close and mode cutover. A fixed nondeletable non-HOME Dashboard Space outside the ordinary desktop cap,16-instance widget cap, bounded four-category conversion catalog, fixture reference time and authored skins are explicit browser policies.

Actual source/native Mojave actors exercised original Notes edits/caret240/240, Overlay/Space over the original simulated full-screen window and return to its retained full Space, with no host fullscreen. Title drag committed310/174 with the same physical widget rect; Escape and out-of-board release canceled without a placement write. Native removal of all five instances left an honest working empty/Add board; re-added calculator IDs6/7 had fresh independent data. Labeled typed density reached16, rejected17 and disabled actual chooser buttons.

At560×420 and320×240, wheel/Tab/End produce real canonical board scroll while root/document stay viewport-bounded and management controls remain visible. Initially an overlapping calendar obstructed a focused calculator key; selected-widget raising corrected the actual center hit to the exact focused control. A separate retained-scroll native library click initially moved between pointerdown/up and lost Add; native observations now read current offsets at execution instead of replaying a stale position, and the same first click commits a new instance with actual/model scroll56. Invalid long converter text remains visible with null result/alert.

Source and Rust-served typed requests cover all22 names; strict catalogs compile174/159/166/190 schemas. Final production retains the exact original edited Notes node/value/caret61/61 and byte-identical window/data/running/MRU records after widget interactions. Native Dashboard pin/activation works after a disabled Launchpad rollback, returning to the actual Dock button without a fake window/running app. Native calculator header7*8Enter yields56; division by zero returns focus from the disabled Equals button to its widget title, so Escape works. Space/MC resumption via delivered Control-Shift-F12 and generic app.open restores the original Notes editor/caret49/49, not the window dialog. Seven semantic guards plus nonordinary Space Exit/Delete/window-transfer guards preserve canonical state; Sonoma/Windows reject all22 without mutation.

The final default1600×1000 capture at1280×800/DPR1.25 compares **0 (0)** against the prior OS-16 default screenshot. This is a regression score between browser checkpoints, **not Apple Dashboard pixel identity**. Existing Apple Messages fidelity score/asset caveats above remain unchanged.123 tests/1607 assertions and production build pass with no component warnings beyond the existing >500kB advisory. Only packaged fictional weather/rates and explicit widget-reference time are used; the menu-bar clock remains fixed, and host/network/widget-package/Option-hover/download behavior is not reproduced.
