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

## Reproducing the comparison

Comparison tooling requires Bun and ImageMagick; these are not extra runtime requirements for the served puppet screen.

1. Obtain the linked original Apple reference PNG, then crop its transparent padding:

   ```sh
   mkdir -p artifacts/mojave
   curl -L --fail 'https://help.apple.com/assets/5CA2B98509462224109A65C3/5CA2B98909462224109A65CB/en_US/f1d950e0f2f08a902a1927bc5be67446.png' -o artifacts/mojave/messages-light.png
   magick artifacts/mojave/messages-light.png -crop 928x710+0+0 +repage artifacts/mojave/reference.png
   ```

2. Build/start the app using the README commands. In Chromium, set the device viewport to 1440×900 and DPR to **1**. In DevTools Console, pose the window without changing its skin:

   ```js
   const slot = document.querySelector('.window-position');
   slot.style.setProperty('--window-scale', '1');
   slot.style.left = '20px';
   slot.style.top = '20px';
   await document.fonts.ready;
   ```

   Use Elements → `.messages-window` → Capture node screenshot. Save the resulting **928×710** PNG as `artifacts/mojave/reconstruction-final.png`. Reload afterward to restore ordinary desktop placement. Mac/native-font captures may produce different measurements from the verified Linux/open-font run.

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
