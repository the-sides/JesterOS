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

[Apple's San Francisco license](https://developer.apple.com/fonts/) explicitly prohibits embedding the font in software and using it for non-Apple-platform mock-ups. No SF font is bundled. On macOS, the browser's native `-apple-system` font remains preferred. Other platforms use a local, unmodified [Inter variable font](https://github.com/rsms/inter), distributed under the SIL Open Font License 1.1; its full license is included at `frontend/public/fonts/LICENSE.txt`.

This fallback is visually similar, not metrically identical to Mojave's SF UI font. Cross-platform font rasterization remains a measurable limitation, not a reason to hide text from the comparison.

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
| Silhouette photograph | (400, 80, 387, 155) |
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

Folder, drive, PDF, and Trash SVGs are original illustrations. Calendar's extracted artwork displays July 17 rather than the menu bar's September 24 scene date. These remain fidelity differences, not authentic Mojave CoreTypes assets.

## Verified reconstruction checkpoint

The rebuilt production desktop was served by Rust at `http://localhost:3000` and viewed in Chromium at 1440×900, DPR 1. The Messages frame is 696×532.5 at the default 0.75 scale; every image loaded locally, with no page errors or horizontal document overflow.

For the first exact-size comparison, the browser window was positioned at (20, 42) and its scale set to 1, avoiding the Dock without hiding it or changing the window skin. The resulting element screenshot is exactly 928×710. Initial normalized RMSE: **7.900%** overall, 6.421% toolbar, 8.231% sidebar, 8.218% conversation, 4.312% composer. About 10.171% of opaque reference pixels have an RGB-channel error above 8. The overlay shows real font, image-resampling, and subpixel-row-placement differences. This is not pixel identity.
