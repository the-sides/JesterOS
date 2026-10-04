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
