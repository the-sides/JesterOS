const release61 = 'https://chromereleases.googleblog.com/2017/09/stable-channel-update-for-desktop.html';
const release69 = 'https://chromereleases.googleblog.com/2018/09/stable-channel-update-for-desktop.html';
const refresh69 = 'https://design.google/library/refreshing-chrome';
const release118 = 'https://chromereleases.googleblog.com/feeds/posts/default/1494174078479390980?alt=json';
const refresh2023 = 'https://blog.google/products-and-platforms/products/chrome/google-chrome-new-features-redesign-2023/';
const profiles = Object.freeze({
  'macos-high-sierra-10.13': Object.freeze({ version: '61.0.3163.79', era: 'classic', label: 'Google Chrome 61 · September 2017 counterpart', qualifier: 'Additional installed application. September 5, 2017 desktop Stable release; pre-69 visual family. An exact Chrome61 High Sierra full-window primary screenshot was not recovered. Native controls are locally serviced; CSS geometry is authored, not certified pixel identity.', sources: Object.freeze([release61, refresh69]) }),
  'macos-mojave-10.14': Object.freeze({ version: '69.0.3497.81', era: 'material', label: 'Google Chrome 69 · September 2018 counterpart', qualifier: 'Additional installed application. Initial September 4, 2018 Chrome69 Stable build, not a claim that macOS10.14.0 pins an independently updated Chrome patch. Rounded tabs and omnibox follow Google’s September redesign comparison; that graphic is not a calibrated Mojave capture. Offline local engine, no remote Google services.', sources: Object.freeze([release69, refresh69, 'https://blog.google/products-and-platforms/products/chrome/chromes-turning-10-heres-whats-new/']) }),
  'macos-sonoma-14.0': Object.freeze({ version: '118.0.5993.88', era: 'refresh', label: 'Google Chrome 118 · October 2023 Mac counterpart', qualifier: 'Additional installed application. Mac Stable .88 dated October 17, 2023, after Sonoma14.0 launch. This scene selects the Chrome Refresh2023 appearance; rollout was gradual, so milestone118 and OS14.0 do not prove every installation had it enabled. First-party promotional reference, not exact Sonoma pixel parity. All browsing is locally serviced.', sources: Object.freeze([release118, refresh2023, 'https://blog.chromium.org/2023/05/an-update-on-lock-icon.html']) }),
  'windows11-23h2-22631.2428': Object.freeze({ version: '118.0.5993.89', era: 'refresh', label: 'Google Chrome 118 · October 2023 Windows counterpart', qualifier: 'Additional installed application, not bundled Edge. Windows .88/.89 Stable dated October 17, 2023; this scene selects .89. OS23H2 build22631.2428 does not uniquely pin Chrome. Refresh2023 is explicitly selected despite gradual rollout, not guaranteed by milestone118. Promotional source is not a calibrated Windows23H2 screenshot. All browsing is locally serviced.', sources: Object.freeze([release118, refresh2023]) }),
  'macos-golden-gate-27.0.1': Object.freeze({ version: '141.0.7390.54', era: 'refresh', label: 'Google Chrome · nearest macOS26-era reference (141, September2025)', qualifier: 'Exact Golden Gate27.0.1 Chrome version and pixel sources are unavailable. Chrome141 Mac Stable September30,2025 is a dated nearest macOS26-launch-era reference, NOT an exact27 or current-latest build claim. Google’s separate macOS26.0.1 benchmark does not identify a browser-window screenshot/build. Locally serviced Refresh-family equivalent; no certified27 pixel parity.', sources: Object.freeze(['https://chromereleases.googleblog.com/2025/09/stable-channel-update-for-desktop_30.html', 'https://blog.google/chromium/a-double-victory-for-web-speed-chrome-breaks-records-again-on-speedometer-31-and-jetstream-3/', refresh2023]) }),
});
export function chromeProfileMetadata(profile) {
  const metadata = profiles[typeof profile === 'string' ? profile : profile?.id];
  if (!metadata) throw new TypeError('Chrome requires one of the five installed scene profiles.');
  return metadata;
}
export const chromeInstalledApp = Object.freeze({ appId: 'chrome', name: 'Google Chrome', bundled: false, stateKey: 'browser', component: 'NativeChromeApp', minimumWidth: 640, minimumHeight: 440 });

export function chromeWindowMetadata(profile) {
  const counterpart = chromeProfileMetadata(profile);
  return { appId: 'chrome', title: 'Google Chrome', width: 1000, height: 700, minWidth: 640, minHeight: 440, disclosure: counterpart.qualifier, counterpart };
}
