<script>
  // Canonical state is owned by the controller; this component observes it and
  // dispatches browser.* commands. Drafts render canonical mirrors, never a
  // competing store, and every control dispatches a real command.
  import { onMount, tick } from 'svelte';
  import { browserPages, browserPage, pageSource, browserCertificate, browserSiteURLs, browserSVGFileId, browserSVGSource } from './browser-pages.js';
  import { browserPreferenceTabs, browserMenuProvider, browserVersion } from './browser-menus.js';
  import { createBrowserNativeView } from './browser-native-view.js';
  import WindowControls from './WindowControls.svelte';
  import './browser.css';

  let { state: browserState, profile, windowId, execute, registerView, getFile = null, available = true, active = true,
    controls = null, embeddedMenus = false,
    onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu,
    fullScreen = false, revealedTop = true, modernGreenMenu = false, zoomed = false } = $props();

  const classicSafari = $derived(profile?.family !== 'windows' && (profile?.id.includes('high-sierra') || profile?.id.includes('mojave')));
  let panel = $state(null);
  let facade = $state(null);
  let interactionError = $state('');
  let addressFocused = $state(false);
  let inspectorNodes = $state([]);
  let inspectorSnapshot = $state(null);
  let downloadsPopOpen = $state(false);
  let observedFind = $state({ tabId: null, loadToken: null, count: 0, index: 0 });
  let requestId = 0;
  const fieldRequests = new Map();
  const isMac = $derived(profile?.family !== 'windows');
  const renderer = $derived(profile?.renderer ?? '');
  const win = $derived(browserState.windows.find(row => row.id === windowId));
  const tab = $derived(win?.tabs.find(row => row.id === win.activeTabId));
  const privateWindow = $derived(win?.private === true);
  const entryNow = $derived(tab ? tab.pending ?? tab.entries[tab.index] ?? null : null);
  const page = $derived(entryNow ? browserPage(entryNow) : null);
  const svgFile = $derived(entryNow?.pageId === 'svg' ? getFile?.(browserSVGFileId(entryNow.url)) ?? null : null);
  const svgSource = $derived(browserSVGSource(svgFile));
  const pageSourceNow = $derived(svgFile?.content ?? (page ? pageSource(entryNow) : ''));
  const displayedAddress = $derived.by(() => {
    const value = tab?.pending?.url ?? tab?.address ?? '';
    return !addressFocused && !browserState.settings.showFullAddress && /^https:\/\//iu.test(value)
      ? value.replace(/^https:\/\//iu, '') : value;
  });
  const frameCallbacks = $derived({
    onclose: controls?.onclose ?? onclose, onminimize: controls?.onminimize ?? onminimize,
    onzoom: controls?.onzoom ?? onzoom, onfullscreen: controls?.onfullscreen ?? onfullscreen,
    onsplitbegin: controls?.onsplitbegin ?? onsplitbegin, onsplitside: controls?.onsplitside ?? onsplitside,
    ongreenmenu: controls?.ongreenmenu ?? ongreenmenu,
  });
  const menuGroups = $derived(browserMenuProvider({ state: browserState, profile, windowId, view: facade }));
  const openMenuGroup = $derived(win?.menu ? menuGroups.find(group => group.id === win.menu) ?? null : null);
  const showEmbeddedMenus = $derived(isMac && embeddedMenus === true);
  const browserVersionLabel = $derived(browserVersion(profile));
  const cssRenderer = $derived(`renderer-${renderer}`);
  const panelValue = $derived(win?.panel ?? 'none');
  const chromePanels = ['overview', 'bookmarks', 'reading', 'history', 'downloads', 'preferences',
    'share', 'security', 'source', 'inspector', 'website', 'help'];
  const chromeExtended = $derived(chromePanels.includes(panelValue));
  const chromeHidesChrome = $derived(['preferences', 'inspector', 'overview'].includes(panelValue));
  const bookmarksBarVisible = $derived(win?.bookmarksBar === true && !chromeHidesChrome);
  const bookmarksBarRows = $derived(win?.bookmarksBar
    ? browserState.bookmarks.filter(row => row.kind === 'bookmark' && (row.parentId == null || row.parentId === 'browser-favorites')) : []);
  const historyRows = $derived.by(() => {
    const query = (win?.historyQuery ?? '').trim().toLocaleLowerCase();
    return browserState.history.filter(row => !query || row.title.toLocaleLowerCase().includes(query) || row.url.toLocaleLowerCase().includes(query));
  });
  const downloadRows = $derived(browserState.downloads.filter(row => browserState.windows.find(owner => owner.id === row.windowId)?.nativeAppId === win?.nativeAppId && (!row.private || row.windowId === windowId && row.status === 'downloading')));
  const downloadActive = $derived(downloadRows.some(row => row.status === 'downloading'));
  const addressSuggestions = $derived.by(() => {
    const query = (tab?.address ?? '').trim().toLocaleLowerCase();
    if (!browserState.settings?.searchSuggestions || !query) return [];
    return browserPages.filter(row => row.id !== 'error'
      && `${row.title} ${row.address}`.toLocaleLowerCase().includes(query)).slice(0, 6);
  });
  const bookmarksRoot = $derived(browserState.bookmarks.filter(row => row.parentId === null));
  const bookmarkFolders = $derived(browserState.bookmarks.filter(row => row.kind === 'folder'));
  const bookmarkDraft = $derived(win?.bookmarkDraft ?? null);
  const draftFields = $derived({ title: bookmarkDraft?.title ?? '', url: bookmarkDraft?.url ?? '',
    parentId: bookmarkDraft?.parentId ?? null, kind: bookmarkDraft?.kind ?? 'bookmark' });
  const bookmarkEditing = $derived(bookmarkDraft?.editing === true);
  const authoredSite = $derived(browserSiteURLs.includes(entryNow?.url));
  const permissionOrigin = $derived(entryNow?.url ?? '');
  const DEFAULT_PERMISSIONS = { camera: 'ask', microphone: 'ask', location: 'ask', notifications: 'ask', popups: 'deny', reader: false, zoom: 100 };
  const ZOOM_LEVELS = Array.from({ length: 26 }, (_, index) => 50 + index * 10);
  const permissionRow = $derived.by(() => {
    if (!permissionOrigin) return null;
    const stored = (win?.private ? win.privatePermissions : browserState.permissions)
      .find(row => row.origin === permissionOrigin) ?? null;
    if (!stored) return { origin: permissionOrigin, ...DEFAULT_PERMISSIONS };
    return { ...DEFAULT_PERMISSIONS, ...stored };
  });
  const sitePassword = $derived(page?.address ? browserState.passwords.find(row => row.origin === page.address) ?? null : null);
  const certificateNow = $derived(permissionOrigin ? browserCertificate(permissionOrigin) : null);
  const preferencesTabs = $derived(browserPreferenceTabs(profile, browserState.settings));
  const findStatus = $derived.by(() => {
    if (!tab?.find.open) return '';
    if (!(tab.find.query ?? '').trim()) return '';
    if (observedFind.tabId !== tab.id || observedFind.loadToken !== tab.loadToken) return '';
    return observedFind.count ? `${Math.min(tab.find.index + 1, observedFind.count)} of ${observedFind.count}` : 'No matches';
  });
  const sidebarKind = $derived(chromeExtended && ['bookmarks', 'reading', 'history', 'downloads'].includes(panelValue)
    ? panelValue : win?.sidebar === true && panelValue === 'none' ? 'bookmarks' : null);
  const zoomScale = $derived((tab?.zoom ?? 100) / 100);
  const PREFERENCE_KEYS = {
    General: ['homepage', 'openWith', 'newTabs'],
    Appearance: ['showFullAddress'],
    Tabs: ['switchToNewTab'],
    AutoFill: ['autofillContacts', 'autofillPasswords'],
    Passwords: [],
    Search: ['searchEngine', 'searchSuggestions'],
    Security: ['blockFraud'],
    Privacy: ['preventTracking', 'blockCookies'],
    Profiles: [],
    Websites: [],
    Extensions: ['extensions'],
    Downloads: [],
    Advanced: ['develop', 'showFullAddress', 'blockCookies'],
  };
  const PREFERENCE_LABELS = {
    homepage: 'Homepage', openWith: 'New windows open with', newTabs: 'New tabs open with',
    switchToNewTab: 'When a new tab opens, make it active', autofillContacts: 'Using information from my contacts',
    autofillPasswords: 'User names and passwords', searchEngine: 'Search engine', searchSuggestions: 'Include search engine suggestions',
    blockFraud: 'Warn when visiting a fraudulent website', preventTracking: 'Prevent cross-site tracking',
    blockCookies: 'Block all cookies', extensions: 'Studio Contrast (built-in local extension)', develop: 'Show Develop menu in menu bar',
    showFullAddress: 'Show full website address',
  };
  const PREFERENCE_CHOICES = { openWith: [['start', 'Start Page'], ['homepage', 'Homepage'], ['empty', 'Empty Page'], ['last', 'Same Page']], newTabs: [['start', 'Start Page'], ['homepage', 'Homepage'], ['empty', 'Empty Page'], ['last', 'Same Page']] };

  function paneKeys(prefTab) {
    if (isMac) {
      if (prefTab === 'Privacy' && !classicSafari) return ['preventTracking'];
      return PREFERENCE_KEYS[prefTab] ?? [];
    }
    const name = String(prefTab ?? '').toLocaleLowerCase();
    if (name.includes('profile')) return isMac ? [] : ['autofillContacts', 'autofillPasswords'];
    if (name.includes('privacy') || name.includes('search')) return ['searchEngine', 'searchSuggestions', 'blockFraud', 'preventTracking'];
    if (name.includes('start') || name.includes('home') || name.includes('new tab')) return ['homepage', 'openWith', 'newTabs', 'switchToNewTab'];
    if (name.includes('cookie') || name.includes('site permission')) return ['blockCookies'];
    return PREFERENCE_KEYS[prefTab] ?? [];
  }
  function paneLabel(key) { return key === 'develop' && isMac && !classicSafari ? 'Show features for web developers' : PREFERENCE_LABELS[key] ?? key; }
  function paneChoices(key) {
    const choices = PREFERENCE_CHOICES[key] ?? null;
    return classicSafari && choices ? choices.map(([value, label]) => [value, value === 'start' ? 'Favorites' : label]) : choices;
  }
  const preferenceBoundaries = $derived.by(() => {
    if (!isMac) return win?.preferencesTab === 'Profiles'
      ? [{ label: 'Sign in / Sync', reason: 'Microsoft account, cloud synchronization and actual credential storage are outside this closed local browser.' }]
      : win?.preferencesTab === 'Downloads'
        ? [{ label: 'Location', reason: 'Downloads are genuine virtual Files in the scene Downloads folder, never the host filesystem.' }]
        : [];
    const common = {
      General: [{ label: 'Default web browser', reason: 'Changing the host operating system’s default application is unavailable to a contained browser scene.' }],
      Tabs: [{ label: 'Open pages in tabs instead of windows', reason: 'Local authored links remain in their tab. Native external-window routing, host trackpad gestures and operating-system shortcuts are not intercepted.' }],
      AutoFill: [{ label: 'Credit cards / Other forms', reason: 'No payments, actual identities or real credentials are collected; only the explicitly fictional contact and sample login can be filled.' }],
      Passwords: [{ label: 'Touch ID / iCloud Keychain', reason: 'The displayed sample login is fictional, not host authentication or a secure credential vault.' }],
      Search: [{ label: 'Safari Suggestions / Quick Website Search / Preload Top Hit', reason: 'Suggestions and search results use only the authored local index. No external search, tracking or prefetch request is made.' }],
      Security: [{ label: 'Enable JavaScript', reason: 'Safari’s native execution preference cannot control this Chromium renderer. Authored pages run only the project’s fixed local controls, never arbitrary site scripts.' }],
      Privacy: [{ label: 'Manage Website Data', reason: 'The scene has no external cookies or website databases. Its fictional login consent follows Block all cookies.' }],
      Websites: [{ label: 'Content Blockers / Auto-Play', reason: 'Authored pages contain no advertisements or autoplaying remote media. Camera, microphone, location and notifications are local consent policies, never device access.' }],
      Profiles: [{ label: 'Safari profile synchronization', reason: 'This is a single fictional scene-local browser workspace, not native Safari profile storage or iCloud. Private windows remain separately disposable.' }],
      Extensions: [{ label: 'Safari Extensions', reason: 'No native extension code is installed or downloaded; Studio Contrast is an explicitly local rendering control.' }],
      Advanced: [{ label: 'Default encoding / Proxies / Apple Pay and Apple Card', reason: 'The authored catalog is UTF-8, has no network transport, and performs no actual payment or host proxy operation.' }],
      Developer: [{ label: 'Allow remote automation / Allow JavaScript from Apple Events / Disable cross-origin restrictions / Allow unsigned extensions', reason: 'These require Safari’s native engine, host automation or external executable extensions. The local inspector observes the actual rendered DOM without opening those host capabilities.' }],
      'Feature Flags': [{ label: 'Stable / Testable / Preview / Developer', reason: 'Safari engine feature flags cannot change the host Chromium process. This is a qualified native settings boundary, not fake runtime flags.' }],
    };
    return common[win?.preferencesTab] ?? [];
  });

  let inspectedToken = null;
  $effect(() => {
    const token = tab ? `${tab.id}:${tab.loadToken}:${entryNow?.pageId ?? ''}` : null;
    if (token !== inspectedToken) {
      inspectedToken = token;
      inspectorNodes = [];
      inspectorSnapshot = null;
    }
    if (panelValue === 'inspector' && token && tab) {
      const snapshot = token;
      void (async () => {
        await tick();
        if (panelValue === 'inspector' && tab && snapshot === `${tab.id}:${tab.loadToken}:${entryNow?.pageId ?? ''}`)
          await inspectNodes(null);
      })();
    }
  });

  function ownsDeep(node) {
    return available && panel?.isConnected && node?.isConnected && panel.contains(node)
      && !node.disabled && !node.closest?.('[inert], [hidden]');
  }

  function snapshotOwner() {
    const windows = browserState.windows, window = windows.find(row => row.id === windowId);
    const tabs = window?.tabs, tabRow = tabs?.find(row => row.id === window.activeTabId);
    return { state: browserState, root: panel, view: facade, windowId, windows, window, tabs, tab: tabRow,
      entries: tabRow?.entries, entry: tabRow?.entries[tabRow.index], index: tabRow?.index, token: tabRow?.loadToken };
  }
  function sameOwner(owner) {
    const current = snapshotOwner();
    return Object.keys(owner).every(key => current[key] === owner[key]);
  }
  function samePresentationOwner(owner) {
    const current = snapshotOwner();
    return ['state', 'root', 'view', 'windowId', 'windows', 'window', 'tabs', 'tab']
      .every(key => current[key] === owner[key]);
  }

  function canonicalFieldMirror(controlId) {
    const name = String(controlId ?? '');
    if (name === 'address') return tab?.address ?? '';
    if (name === 'history-search') return win?.historyQuery ?? '';
    if (name === 'prefs-homepage') return browserState.settings?.homepage ?? '';
    if (name === 'bookmark-title') return bookmarkDraft?.title ?? '';
    if (name === 'bookmark-url') return bookmarkDraft?.url ?? '';
    if (name.startsWith('form-')) {
      const field = name.slice(5);
      if (!['name', 'email', 'message', 'password'].includes(field)) return null;
      return tab?.form?.[field] ?? '';
    }
    return null;
  }

  async function ask(name, target = {}, payload = {}, node = null) {
    if (node && !ownsDeep(node)) return null;
    const owner = panel;
    const request = ++requestId;
    const ownerSnapshot = snapshotOwner();
    const fieldId = node?.dataset?.browserControl;
    if (fieldId && canonicalFieldMirror(fieldId) !== null) fieldRequests.set(fieldId, request);
    await tick();
    if (owner !== panel || !sameOwner(ownerSnapshot) || (node && !ownsDeep(node))) return null;
    const result = await execute(`browser.${name}`, { windowId, ...target }, payload);
    const presentationAvailable = result?.presentationAvailable !== false && owner === panel
      && available && owner?.isConnected && samePresentationOwner(ownerSnapshot) && (!node || ownsDeep(node));
    if (!presentationAvailable)
      return result?.status === 'applied' ? { ...result, presentationAvailable: false } : result;
    if (request === requestId) interactionError = result?.status === 'rejected'
      ? result.error?.message ?? result.message ?? 'Unavailable.' : '';
    if (result?.status === 'rejected' && fieldId && fieldRequests.get(fieldId) === request) {
      // Input-budget rejection: reset only the original node to its canonical
      // mirror while this exact window/tab/load lease still owns the scene.
      if (sameOwner(ownerSnapshot) && ownsDeep(node)) {
        const mirror = canonicalFieldMirror(node.dataset.browserControl);
        if (mirror !== null && node.value !== mirror) node.value = mirror;
      }
    }
    if (name === 'clipboard' && result?.status === 'applied' && typeof result.count === 'number' && sameOwner(ownerSnapshot)) {
      observedFind = { tabId: ownerSnapshot.tab.id, loadToken: ownerSnapshot.tab.loadToken, count: result.count, index: result.index };
    }
    if (result?.status === 'applied' && ['autofill.apply', 'form.submit'].includes(name)) {
      await tick();
      if (!available || !owner?.isConnected || !samePresentationOwner(ownerSnapshot) || (node && !ownsDeep(node)))
        return { ...result, presentationAvailable: false };
    }
    return result?.status === 'applied' ? { ...result, presentationAvailable: true } : result;
  }
  async function askFind(name, payload = {}, node = null) {
    const original = snapshotOwner();
    const result = await ask(name, { tabId: original.tab?.id }, payload, node);
    if (result?.status === 'applied' && result.presentationAvailable !== false && sameOwner(original)) {
      await tick();
      if (!available || !original.root?.isConnected || !sameOwner(original)) return result;
      const described = original.view?.describe?.();
      observedFind = { tabId: original.tab.id, loadToken: original.tab.loadToken, count: described?.findCount ?? 0, index: original.tab.find?.index ?? 0 };
    }
    return result;
  }
  function observeScroll(event, areaId) {
    const node = event.currentTarget;
    void ask('scroll', {}, { areaId, top: node.scrollTop, left: node.scrollLeft }, node);
  }
  function observeFocus(event) {
    const id = event.currentTarget.dataset.browserControl;
    if (id) void ask('focus', {}, { controlId: id }, event.currentTarget);
  }
  $effect(() => {
    const clear = win?.historyClear;
    if (clear?.open) void tick().then(() => {
      if (available && panel?.isConnected && win?.historyClear === clear && clear.open)
        panel.querySelector('[data-browser-control="history-clear-cancel"]')?.focus();
    });
  });
  function keyboard(event) {
    if (!active || !available || event.defaultPrevented || event.altKey && (event.metaKey || event.ctrlKey)) return;
    if (win?.historyClear.open) {
      if (event.key === 'Escape') { event.preventDefault(); void ask('history.clear.cancel'); }
      else if (event.key === 'Tab') {
        const controls = [...panel.querySelectorAll('.browser-modal button:not(:disabled), .browser-modal select:not(:disabled)')];
        const index = controls.indexOf(document.activeElement);
        event.preventDefault();
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      } else if (event.metaKey || event.ctrlKey) event.preventDefault();
      return;
    }
    const key = event.key.toLowerCase();
    const primary = event.metaKey || event.ctrlKey;
    const plainShift = event.shiftKey && !primary && !event.altKey;
    if (win?.menu && !primary && !event.altKey && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const leaves = [...(panel?.querySelectorAll('.browser-menu-popup [role="menuitem"]:not(:disabled)') ?? [])];
      if (leaves.length) {
        event.preventDefault();
        const current = leaves.indexOf(document.activeElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? leaves.length - 1 : event.key === 'ArrowDown' ? (current + 1) % leaves.length : (current + leaves.length - 1) % leaves.length;
        leaves[index].focus();
      }
      return;
    }
    if (primary && !event.altKey && key === 'n') {
      event.preventDefault(); void ask('window.new', {}, { private: event.shiftKey }); return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab' && win?.tabs.length) {
      event.preventDefault();
      const index = win.tabs.findIndex(row => row.id === win.activeTabId);
      void ask('tab.select', { tabId: win.tabs[(index + win.tabs.length + (event.shiftKey ? -1 : 1)) % win.tabs.length].id }); return;
    }
    if (primary && !event.altKey && !event.shiftKey && /^[1-9]$/.test(key) && win?.tabs.length) {
      event.preventDefault(); void ask('tab.select', { tabId: win.tabs[key === '9' ? win.tabs.length - 1 : Math.min(Number(key) - 1, win.tabs.length - 1)].id }); return;
    }
    if (isMac && primary && !event.altKey && event.shiftKey && event.code === 'Backslash') {
      event.preventDefault(); void ask('panel', {}, { panel: panelValue === 'overview' ? 'none' : 'overview' }); return;
    }
    if (primary && !event.altKey && key === 't' && event.shiftKey) {
      event.preventDefault();
      void ask('tab.reopen', {}, {});
    } else if (primary && !event.altKey && key === 't') {
      event.preventDefault();
      void ask('tab.new', {}, {});
    } else if (primary && !event.altKey && key === 'w') {
      event.preventDefault();
      if (event.shiftKey) void ask('window.close', {}, {}); else if (tab) void ask('tab.close', { tabId: tab.id }, {});
    } else if (primary && !event.altKey && key === 'l') {
      event.preventDefault();
      void ask('focus', {}, { controlId: 'address' });
    } else if (primary && !event.altKey && !event.shiftKey && key === 'f') {
      event.preventDefault();
      void askFind('find.open', {});
    } else if (primary && !event.altKey && key === 'p') {
      event.preventDefault();
      if (tab) void ask('print', { tabId: tab.id }, {});
    } else if (primary && !event.altKey && key === (isMac ? 'y' : 'h')) {
      event.preventDefault();
      void ask('panel', {}, { panel: 'history' });
    } else if (isMac ? primary && event.altKey && key === 'l' : primary && !event.altKey && key === 'j') {
      event.preventDefault();
      void ask('panel', {}, { panel: 'downloads' });
    } else if (primary && !event.altKey && (key === '+' || key === '=')) {
      event.preventDefault();
      if (tab) void ask('zoom', { tabId: tab.id }, { value: Math.min(300, (tab.zoom ?? 100) + 10) });
    } else if (primary && !event.altKey && key === '-') {
      event.preventDefault();
      if (tab) void ask('zoom', { tabId: tab.id }, { value: Math.max(50, (tab.zoom ?? 100) - 10) });
    } else if (primary && !event.altKey && key === '0') {
      event.preventDefault();
      if (tab) void ask('zoom', { tabId: tab.id }, { value: 100 });
    } else if (primary && !event.altKey && key === ',') {
      event.preventDefault();
      void ask('panel', {}, { panel: 'preferences' });
    } else if (isMac ? primary && !event.altKey && event.shiftKey && key === 'r' : event.key === 'F9' && !primary && !event.altKey) {
      event.preventDefault();
      if (tab) void ask('reader', { tabId: tab.id }, {});
    } else if (isMac ? primary && event.altKey && key === 'i' : event.key === 'F12' && !primary && !event.altKey) {
      event.preventDefault();
      void ask('panel', {}, { panel: 'inspector' });
    } else if (event.altKey && !primary && event.key === 'ArrowLeft') {
      event.preventDefault();
      if (tab) void ask('back', { tabId: tab.id }, {});
    } else if (event.altKey && !primary && event.key === 'ArrowRight') {
      event.preventDefault();
      if (tab) void ask('forward', { tabId: tab.id }, {});
    } else if (event.key === 'Escape' && !primary && !event.altKey && !plainShift) {
      if (downloadsPopOpen) { event.preventDefault(); closeDownloads(); }
      else if (win?.menu) { event.preventDefault(); void toggleMenu(win.menu); }
      else if (bookmarkEditing && sidebarKind === 'bookmarks') { event.preventDefault(); void ask('bookmark.cancel'); }
      else if (panelValue !== 'none') { event.preventDefault(); void ask('panel', {}, { panel: 'none' }); }
      else if (tab?.phase === 'loading') { event.preventDefault(); void ask('stop', { tabId: tab.id }, {}); }
      else if (tab?.find.open) { event.preventDefault(); observedFind = { tabId: null, loadToken: null, count: 0, index: 0 }; void ask('find.close', { tabId: tab.id }, {}); }
      else if (tab?.reader) { event.preventDefault(); void ask('reader', { tabId: tab.id }, {}); }
    }
  }

  function menuRequest(item, node) {
    if (!item || item.separator || !item.enabled || !item.request) return;
    void (async () => {
      await ask('menu', {}, { menu: null });
      await execute(item.request.command, { windowId, ...item.request.target }, item.request.payload);
    })();
  }
  async function allowPopups(node) {
    const original = snapshotOwner();
    const granted = await ask('permission', { tabId: original.tab?.id }, { key: 'popups', value: 'allow' }, node);
    if (granted?.status !== 'applied' || granted.presentationAvailable === false) return;
    await tick();
    if (!sameOwner(original) || !available || !original.root?.isConnected) return;
    void ask('popup', { tabId: original.tab?.id }, {}, node);
  }
  async function openSiteSettings(origin, node) {
    const original = snapshotOwner();
    const navigated = await ask('navigate', { tabId: original.tab?.id }, { address: origin }, node);
    if (navigated?.status !== 'applied' || navigated.presentationAvailable === false) return;
    await tick();
    if (!samePresentationOwner(original) || !available || !original.root?.isConnected) return;
    void ask('panel', {}, { panel: 'website' });
  }
  async function inspectNodes(node) {
    const result = await ask('inspector.nodes', {}, {}, node);
    if (result?.status === 'applied' && result.presentationAvailable !== false) inspectorNodes = Array.isArray(result.nodes) ? result.nodes : [];
  }
  async function inspectNode(nodeId, node) {
    const result = await ask('inspector.select', {}, { nodeId }, node);
    if (result?.status === 'applied' && result.presentationAvailable !== false) inspectorSnapshot = result.node ?? null;
  }
  async function toggleMenu(groupId) {
    const original = snapshotOwner(), closing = win?.menu === groupId;
    const result = await ask('menu', {}, { menu: closing ? null : groupId ?? null });
    if (result?.status !== 'applied' || result.presentationAvailable === false) return;
    await tick();
    if (!sameOwner(original) || !available || !panel?.isConnected) return;
    const target = closing ? panel.querySelector(isMac ? `[data-browser-control="menu-title:${groupId}"]` : '[data-browser-control="menu-open"]') : panel.querySelector('.browser-menu-popup [role="menuitem"]:not(:disabled)');
    target?.focus();
  }
  async function closeDownloads(restoreFocus = true) {
    downloadsPopOpen = false;
    if (!restoreFocus) return;
    const original = snapshotOwner();
    await tick();
    if (sameOwner(original) && available && panel?.isConnected) panel.querySelector('[data-browser-control="downloads-popover"]')?.focus();
  }
  async function toggleDownloads() {
    if (downloadsPopOpen) return closeDownloads();
    const original = snapshotOwner();
    downloadsPopOpen = true;
    await tick();
    if (sameOwner(original) && available && panel?.isConnected && downloadsPopOpen) panel.querySelector('[data-browser-control="downloads-popover-close"]')?.focus();
  }
  function outsideDownloads(event) {
    if (downloadsPopOpen && !event.target?.closest?.('.browser-downloads-popover,[data-browser-control="downloads-popover"]')) void closeDownloads(false);
  }

  function panelTitle(value) {
    if (!isMac) return { overview: 'Search Tabs', bookmarks: 'Favorites', reading: 'Local Reading Collection', preferences: 'Settings', inspector: 'Local DevTools', help: 'Help and feedback' }[value] ?? { history: 'History', downloads: 'Downloads', share: 'Share', security: 'Local Security Details', source: 'Page Source', website: 'Site Permissions' }[value] ?? value;
    return { overview: 'Tab Overview', bookmarks: 'Bookmarks', reading: 'Reading List', history: 'History',
      downloads: 'Downloads', preferences: 'Preferences', share: 'Share', security: 'Security',
      source: 'Page Source', inspector: 'Web Inspector', website: 'Website Settings', help: 'Safari Help' }[value] ?? value;
  }
  function tabTitle(row) {
    const entry = row?.pending ?? row?.entries[row.index];
    return classicSafari && entry?.pageId === 'home' ? 'Favorites' : entry?.title ?? 'New Tab';
  }
  function timeLabel(at) {
    try { return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch { return ''; }
  }

  onMount(() => {
    // Cleanup passes the original view instance so the parent can ignore a
    // late unregistration that would otherwise drop a replacement view
    // mounted under the same stable restoreWindowId.
    const originalView = createBrowserNativeView({ getRoot: () => panel, getState: () => browserState, windowId, available: () => available, tick });
    facade = originalView;
    registerView(windowId, originalView);
    return () => { registerView(windowId, null, originalView); if (facade === originalView) facade = null; };
  });
</script>

<svelte:window onkeydown={keyboard} onpointerdown={outsideDownloads} />

{#snippet tabstrip()}
  {#if isMac && controls}
    <div class="browser-window-controls" data-window-no-drag>
      <WindowControls onclose={frameCallbacks.onclose} onminimize={frameCallbacks.onminimize}
        onzoom={frameCallbacks.onzoom} onfullscreen={frameCallbacks.onfullscreen}
        onsplitbegin={frameCallbacks.onsplitbegin} onsplitside={frameCallbacks.onsplitside}
        ongreenmenu={frameCallbacks.ongreenmenu} {active} {zoomed} {fullScreen} {revealedTop} {modernGreenMenu} />
    </div>
  {/if}
  <div class="browser-tabstrip-tabs" data-window-no-drag>
    {#each win?.tabs ?? [] as row (row.id)}
      <div class="browser-tab-shell" class:is-active={row.id === win.activeTabId}>
        <button type="button" class="browser-tab" class:is-pinned={row.pinned}
          data-browser-control={`tab:${row.id}`}
          aria-current={row.id === win.activeTabId ? 'true' : undefined}
          onclick={event => ask('tab.select', { tabId: row.id }, {}, event.currentTarget)}>
          {#if row.phase === 'loading'}<i class="browser-tab-loading" aria-hidden="true"></i>{/if}
          <span class="browser-tab-title">{tabTitle(row)}</span>
        </button>
        <button type="button" class="browser-tab-close" aria-label={`Close ${tabTitle(row)}`}
          data-browser-control={`tab-close:${row.id}`} disabled={row.pinned}
          onclick={event => ask('tab.close', { tabId: row.id }, {}, event.currentTarget)}>×</button>
      </div>
    {/each}
    <button type="button" class="browser-tab-new" data-browser-control="tab-new" aria-label="New Tab"
      onclick={event => ask('tab.new', {}, {}, event.currentTarget)}>+</button>
  </div>
{/snippet}

{#snippet menuRows(items)}
  {#each items ?? [] as item (item.id)}
    {#if item.separator}
      <hr class="browser-menu-separator" />
    {:else if item.children}
      <div class="browser-menu-submenu">
        <span class="browser-menu-submenu-label" class:disabled={!item.enabled}>{item.label}</span>
        <div class="browser-menu-submenu-items">
          {@render menuRows(item.children)}
        </div>
      </div>
    {:else}
      <button type="button" role="menuitem" class="browser-menu-item" disabled={!item.enabled}
        data-browser-control={`menu-item:${item.id}`}
        title={item.shortcut ?? undefined}
        onmousedown={event => event.preventDefault()}
        onclick={event => menuRequest(item, event.currentTarget)}>
        {item.label}{#if item.shortcut}<span class="browser-menu-shortcut">{item.shortcut}</span>{/if}
      </button>
    {/if}
  {/each}
{/snippet}

{#snippet menuPopup()}
  {#if openMenuGroup}
    <div class="browser-menu-popup" role="menu" aria-label={openMenuGroup.label} data-browser-area="menu-popup">
      {@render menuRows(openMenuGroup.items)}
    </div>
  {/if}
{/snippet}

{#snippet toolbar()}
  <div class="browser-toolbar-left">
    <button type="button" class="browser-icon-button" data-browser-control="back" aria-label="Back"
      disabled={!tab || tab.index === 0}
      onclick={event => ask('back', { tabId: tab?.id }, {}, event.currentTarget)}>◀</button>
    <button type="button" class="browser-icon-button" data-browser-control="forward" aria-label="Forward"
      disabled={!tab || tab.index + 1 >= tab.entries.length}
      onclick={event => ask('forward', { tabId: tab?.id }, {}, event.currentTarget)}>▶</button>
    {#if tab?.phase === 'loading'}
      <button type="button" class="browser-icon-button" data-browser-control="stop" aria-label="Stop"
        onclick={event => ask('stop', { tabId: tab?.id }, {}, event.currentTarget)}>×</button>
    {:else}
      <button type="button" class="browser-icon-button" data-browser-control="reload" aria-label="Reload" disabled={!tab}
        onclick={event => ask('reload', { tabId: tab?.id }, {}, event.currentTarget)}>↻</button>
    {/if}
    {#if !isMac}
      <button type="button" class="browser-icon-button" data-browser-control="home-button" aria-label="Local start page"
        onclick={event => ask('navigate', { tabId: tab?.id }, { address: 'jester://start' }, event.currentTarget)}>⌂</button>
    {/if}
  </div>
  <div class="browser-omnibox-wrap">
    <form class="browser-omnibox"
      onsubmit={event => { event.preventDefault();
        void ask('navigate', { tabId: tab?.id }, { address: event.currentTarget.elements.address.value }, event.currentTarget); }}>
      <input name="address" data-browser-control="address"
        aria-label="Search or enter website name"
        placeholder={privateWindow ? (isMac ? 'Private Browsing' : 'InPrivate browsing') : 'Search or enter website name'}
        value={displayedAddress}
        maxlength="2048"
        oninput={event => ask('address', { tabId: tab?.id }, { value: event.currentTarget.value }, event.currentTarget)}
        onfocus={event => { addressFocused = true; observeFocus(event); }}
        onblur={() => { addressFocused = false; }} />
      {#if privateWindow}<span class="browser-private-badge">{isMac ? 'Private' : 'InPrivate'}</span>{/if}
    </form>
    {#if page?.reader && !tab?.pending}
      <button type="button" class="browser-icon-button browser-reader-inline" data-browser-control="reader-toggle"
        aria-label={tab?.reader ? (isMac ? 'Exit Reader' : 'Exit Immersive Reader') : (isMac ? 'Show Reader' : 'Enter Immersive Reader')}
        disabled={tab?.phase === 'loading'}
        onclick={event => ask('reader', { tabId: tab?.id }, {}, event.currentTarget)}>Aa</button>
    {/if}
    {#if browserState.settings?.searchSuggestions && addressSuggestions.length && !tab?.pending}
      <div class="browser-suggestions" data-browser-area="suggestions" aria-label="Search suggestions">
        {#each addressSuggestions as suggestion (suggestion.id)}
          <button type="button" data-browser-control={`suggestion:${suggestion.id}`}
            onclick={event => ask('navigate', { tabId: tab?.id }, { address: suggestion.address }, event.currentTarget)}>
            {suggestion.title}<span class="browser-row-meta">{suggestion.address}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="browser-toolbar-right">
    <button type="button" class="browser-icon-button" data-browser-control="downloads-popover" aria-label="Downloads"
      aria-haspopup="dialog" aria-expanded={downloadsPopOpen ? 'true' : 'false'}
      class:browser-attention={downloadActive}
      onclick={toggleDownloads}>⇩</button>
    <button type="button" class="browser-icon-button" data-browser-control="share-button" aria-label="Share"
      disabled={!tab}
      onclick={event => ask('panel', {}, { panel: 'share' }, event.currentTarget)}>⤴</button>
    <button type="button" class="browser-icon-button" data-browser-control="panel-overview" aria-label={isMac ? 'Tab Overview' : 'Search Tabs'}
      onclick={event => ask('panel', {}, { panel: win?.panel === 'overview' ? 'none' : 'overview' }, event.currentTarget)}>▦</button>
    {#if !isMac}
      <button type="button" class="browser-icon-button" data-browser-control="menu-open" aria-label="Settings and more"
        aria-haspopup="menu" aria-expanded={win?.menu ? 'true' : 'false'}
        onclick={event => toggleMenu(menuGroups[0]?.id)}>⋯</button>
      <div class="browser-menu-anchor">
        {@render menuPopup()}
      </div>
    {/if}
    {#if downloadsPopOpen}
      {@render downloadsPopover()}
    {/if}
  </div>
{/snippet}

{#snippet favoritesBar()}
  {#each bookmarksBarRows as row (row.id)}
    <button type="button" data-browser-control={`bookmark-bar:${row.id}`}
      onclick={event => row.kind === 'bookmark'
        ? ask('navigate', { tabId: tab?.id }, { address: row.url }, event.currentTarget)
        : ask('panel', {}, { panel: 'bookmarks' }, event.currentTarget)}>{row.title}</button>
  {/each}
{/snippet}

{#snippet bookmarkEditor()}
  <form class="browser-sheet"
    onsubmit={event => { event.preventDefault();
      void ask('bookmark.save', {}, { ...(bookmarkDraft?.id ? { id: bookmarkDraft.id } : {}),
        parentId: draftFields.parentId, title: draftFields.title, url: draftFields.url, kind: draftFields.kind }, event.currentTarget); }}>
    <h2>{bookmarkDraft?.id ? 'Edit Bookmark' : 'New Item'}</h2>
    <label class="browser-field"><span>Title</span>
      <input data-browser-control="bookmark-title" value={draftFields.title} maxlength="160"
        oninput={event => ask('bookmark.edit', {}, { field: 'title', value: event.currentTarget.value }, event.currentTarget)} />
    </label>
    <label class="browser-field"><span>Address</span>
      <input data-browser-control="bookmark-url" value={draftFields.url} maxlength="2048" disabled={draftFields.kind === 'folder'}
        oninput={event => ask('bookmark.edit', {}, { field: 'url', value: event.currentTarget.value }, event.currentTarget)} />
    </label>
    <label class="browser-field"><span>Location</span>
      <select data-browser-control="bookmark-parent" value={draftFields.parentId ?? ''}
        onchange={event => ask('bookmark.edit', {}, { field: 'parentId', value: event.currentTarget.value || null }, event.currentTarget)}>
        <option value="">Top Level</option>
        {#each bookmarkFolders as folder (folder.id)}
          <option value={folder.id}>{folder.title}</option>
        {/each}
      </select>
    </label>
    <label class="browser-field"><span>Kind</span>
      <select data-browser-control="bookmark-kind" value={draftFields.kind}
        onchange={event => ask('bookmark.edit', {}, { field: 'kind', value: event.currentTarget.value }, event.currentTarget)}>
        <option value="bookmark">Bookmark</option>
        <option value="folder">Folder</option>
      </select>
    </label>
    <div class="browser-sidebar-actions">
      <button type="button" data-browser-control="bookmark-cancel"
        onclick={event => ask('bookmark.cancel', {}, {}, event.currentTarget)}>Cancel</button>
      <button type="submit" data-browser-control="bookmark-save">Save</button>
    </div>
  </form>
{/snippet}

{#snippet bookmarkRow(row, depth)}
  <div class="browser-reading-row" class:browser-row-child={depth > 0}>
    <button type="button" class="browser-row" data-browser-control={`bookmark:${row.id}`}
      disabled={row.kind !== 'bookmark'}
      onclick={event => ask('navigate', { tabId: tab?.id }, { address: row.url }, event.currentTarget)}>
      {row.title}<span class="browser-row-meta">{row.url ?? 'Folder'}</span>
    </button>
    <button type="button" class="browser-row-muted" data-browser-control={`bookmark-edit:${row.id}`}
      onclick={event => ask('bookmark.begin', {}, { id: row.id }, event.currentTarget)}>Edit</button>
    <button type="button" class="browser-row-muted" data-browser-control={`bookmark-delete:${row.id}`}
      disabled={row.id === 'browser-favorites'} title={row.id === 'browser-favorites' ? 'Favorites is the retained root folder.' : undefined}
      onclick={event => ask('bookmark.delete', {}, { id: row.id }, event.currentTarget)}>Delete</button>
    {#if row.kind === 'folder' && depth <= browserState.bookmarks.length}
      {@render bookmarkRows(row.id, depth + 1)}
    {/if}
  </div>
{/snippet}

{#snippet bookmarkRows(parentId, depth)}
  {#each browserState.bookmarks.filter(row => row.parentId === parentId) as row (row.id)}
    {@render bookmarkRow(row, depth)}
  {/each}
{/snippet}

{#snippet sidebarLists(kind)}
  {#if kind === 'bookmarks'}
    {@render bookmarkRows(null, 0)}
    {#if !bookmarksRoot.length}
      <p class="browser-empty" role="status">No bookmarks yet.</p>
    {/if}
    <div class="browser-sidebar-actions">
      <button type="button" data-browser-control="bookmark-begin"
        onclick={event => ask('bookmark.begin', {}, {}, event.currentTarget)}>Add Bookmark</button>
      <button type="button" data-browser-control="bookmark-begin-folder"
        onclick={event => ask('bookmark.begin', {}, { kind: 'folder' }, event.currentTarget)}>Add Folder</button>
    </div>
    {#if bookmarkEditing}{@render bookmarkEditor()}{/if}
  {:else if kind === 'reading'}
    {#each browserState.readingList as row (row.id)}
      <div class="browser-reading-row">
        <button type="button" class="browser-row"
          data-browser-control={`reading:${row.id}`}
          onclick={event => ask('reading.open', {}, { id: row.id }, event.currentTarget)}>
          <span class="browser-reading-title" class:is-read={row.read}>{row.title}</span>
        </button>
        <button type="button" class="browser-row-muted" data-browser-control={`reading-toggle:${row.id}`}
          onclick={event => ask('reading.toggle', {}, { id: row.id }, event.currentTarget)}>{row.read ? 'Mark Unread' : 'Mark Read'}</button>
        <button type="button" class="browser-row-muted" data-browser-control={`reading-delete:${row.id}`}
          onclick={event => ask('reading.delete', {}, { id: row.id }, event.currentTarget)}>Delete</button>
      </div>
    {/each}
    {#if !browserState.readingList.length}
      <p class="browser-empty" role="status">Reading list is empty here.</p>
    {/if}
  {:else if kind === 'history'}
    <input data-browser-control="history-search" aria-label="Search history" placeholder="Search history"
      value={win?.historyQuery ?? ''} maxlength="200"
      oninput={event => ask('history.search', {}, { query: event.currentTarget.value }, event.currentTarget)}
      onfocus={observeFocus} />
    {#each historyRows as row (row.id)}
      <div class="browser-reading-row">
        <button type="button" class="browser-row" data-browser-control={`history:${row.id}`}
          onclick={event => ask('navigate', { tabId: tab?.id }, { address: row.url }, event.currentTarget)}>
          <span class="browser-reading-title">{row.title}</span>
          <span class="browser-row-meta">{timeLabel(row.at)}</span>
        </button>
      </div>
    {/each}
    {#if !historyRows.length}
      <p class="browser-empty" role="status">No history matches.</p>
    {/if}
    <div class="browser-sidebar-actions">
      <button type="button" data-browser-control="history-clear-hour"
        onclick={event => ask('history.clear.prepare', {}, { range: 'hour' }, event.currentTarget)}>Clear Last Hour…</button>
      <button type="button" data-browser-control="history-clear-day"
        onclick={event => ask('history.clear.prepare', {}, { range: 'day' }, event.currentTarget)}>Clear Today…</button>
      <button type="button" data-browser-control="history-clear-all"
        onclick={event => ask('history.clear.prepare', {}, { range: 'all' }, event.currentTarget)}>Clear All…</button>
    </div>
  {:else if kind === 'downloads'}
    {#each downloadRows as row (row.id)}
      {@render downloadRow(row)}
    {/each}
    {#if !downloadRows.length}
      <p class="browser-empty" role="status">No downloads yet.</p>
    {/if}
    <button type="button" class="browser-row-muted" data-browser-control="download-clear-finished-sidebar"
      onclick={event => ask('download.clear', {}, {}, event.currentTarget)}>Clear Finished</button>
  {/if}
{/snippet}

{#snippet downloadRow(row)}
  <div class="browser-download-row">
    <span class="browser-reading-title">{row.name}</span>
    {#if row.status === 'downloading'}
      <span class="browser-progress" role="progressbar" aria-valuenow={Math.round(row.progress)}
        aria-valuemin="0" aria-valuemax="100">
        <i style:width={`${Math.min(100, Math.max(0, row.progress))}%`}></i>
      </span>
      <button type="button" class="browser-row-muted" data-browser-control={`download-cancel:${row.id}`}
        onclick={event => ask('download.cancel', {}, { id: row.id }, event.currentTarget)}>Cancel</button>
    {:else if row.status === 'failed' || row.status === 'cancelled'}
      <span class="browser-row-meta">{row.error || row.status}</span>
      <button type="button" class="browser-row-muted" data-browser-control={`download-retry:${row.id}`}
        onclick={event => ask('download.retry', {}, { id: row.id }, event.currentTarget)}>Retry</button>
    {:else if row.status === 'complete'}
      <span class="browser-row-meta">Complete</span>
      <button type="button" class="browser-row-muted" data-browser-control={`download-reveal:${row.id}`}
        onclick={event => ask('download.reveal', {}, { id: row.id }, event.currentTarget)}>{isMac ? 'Reveal in Finder' : 'Show in File Explorer'}</button>
      <button type="button" class="browser-row-muted" data-browser-control={`download-open:${row.id}`}
        onclick={event => ask('download.open', {}, { id: row.id }, event.currentTarget)}>Open</button>
    {:else}
      <span class="browser-row-meta">{row.status}</span>
    {/if}
  </div>
{/snippet}

{#snippet downloadsPopover()}
  <div class="browser-downloads-popover" role="dialog" aria-label="Downloads" data-browser-area="downloads-popover">
    <header class="browser-inspector-head">
      <strong>Downloads</strong>
      <button type="button" class="browser-row-muted" data-browser-control="download-clear-finished"
        onclick={event => ask('download.clear', {}, {}, event.currentTarget)}>Clear Finished</button>
      <button type="button" class="browser-row-muted" data-browser-control="downloads-popover-close"
        onclick={() => closeDownloads()}>×</button>
    </header>
    {#each downloadRows as row (row.id)}
      {@render downloadRow(row)}
    {/each}
    {#if !downloadRows.length}
      <p class="browser-empty" role="status">No downloads yet.</p>
    {/if}
  </div>
{/snippet}

{#snippet pageArticle()}
  {#if page.id === 'home'}
    <p class="browser-empty" role="status">Certificate feature sample: <button type="button" class="browser-inline-link"
      data-browser-control="start-sample-cert"
      onclick={event => ask('navigate', { tabId: tab.id }, { address: 'https://studio.invalid' }, event.currentTarget)}>open https://studio.invalid</button> (closed authored alias, no external request).</p>
  {/if}
  <h1 data-browser-node="heading">{page.heading}</h1>
  <p class="browser-page-lede" data-browser-node="description">{page.description}</p>
  {#if page.id === 'home'}
    <h2>Favorites</h2>
    <ul class="browser-page-links">
      {#each browserState.bookmarks.filter(row => row.kind === 'bookmark' && row.parentId === 'browser-favorites') as favorite (favorite.id)}
        <li><button type="button" data-browser-control={`favorite:${favorite.id}`}
          onclick={event => ask('navigate', { tabId: tab.id }, { address: favorite.url }, event.currentTarget)}>{favorite.title}<span class="link-sub">{favorite.url}</span></button></li>
      {/each}
    </ul>
  {/if}
  {#each page.sections as chunk, index (chunk.title)}
    <section data-browser-node={`section-${index}`}>
      <h2 data-browser-node={`section-${index}-title`}>{chunk.title}</h2>
      <p data-browser-node={`section-${index}-body`}>{chunk.body}</p>
    </section>
  {/each}
  {#if page.kind === 'form'}
    <form class="browser-form-grid" data-browser-node="form-grid"
      onsubmit={event => { event.preventDefault(); void ask('form.submit', { tabId: tab.id }, {}, event.currentTarget); }}>
      <label class="browser-field"><span>Name</span>
        <input data-browser-control="form-name" value={tab?.form?.name ?? ''} maxlength="120"
          oninput={event => ask('form.edit', { tabId: tab.id }, { field: 'name', value: event.currentTarget.value }, event.currentTarget)} />
      </label>
      <label class="browser-field"><span>Email</span>
        <input data-browser-control="form-email" value={tab?.form?.email ?? ''} maxlength="120"
          oninput={event => ask('form.edit', { tabId: tab.id }, { field: 'email', value: event.currentTarget.value }, event.currentTarget)} />
      </label>
      <label class="browser-field"><span>Message</span>
        <textarea data-browser-control="form-message" maxlength="1200"
          oninput={event => ask('form.edit', { tabId: tab.id }, { field: 'message', value: event.currentTarget.value }, event.currentTarget)}>{tab?.form?.message ?? ''}</textarea>
      </label>
      <label class="browser-field"><span>Password (fictional sample only)</span>
        <input data-browser-control="form-password" value={tab?.form?.password ?? ''} readonly maxlength="64"
          aria-label="Password, fictional sample only" />
      </label>
      <div class="browser-reading-row browser-password-actions">
        <button type="button" data-browser-control="form-name-sample"
          onclick={event => ask('form.edit', { tabId: tab.id }, { field: 'name', value: 'Casey Sample' }, event.currentTarget)}>Use sample name</button>
        <button type="button" data-browser-control="form-password-sample"
          onclick={event => ask('form.edit', { tabId: tab.id }, { field: 'password', value: 'FICTIONAL-SAMPLE-ONLY' }, event.currentTarget)}>Use sample password</button>
        {#if tab?.form?.password}
          <button type="button" data-browser-control="form-password-clear"
            onclick={event => ask('form.edit', { tabId: tab.id }, { field: 'password', value: '' }, event.currentTarget)}>Clear password</button>
        {/if}
        {#if sitePassword}
          <button type="button" data-browser-control="autofill-open"
            onclick={event => ask('autofill.open', { tabId: tab.id }, {}, event.currentTarget)}>Fill saved fictional contact for {sitePassword.origin}</button>
        {/if}
      </div>
      {#if tab?.autofillOpen && sitePassword}
        <button type="button" data-browser-control="autofill-apply"
          onclick={event => ask('autofill.apply', { tabId: tab.id }, {}, event.currentTarget)}>Apply saved sample: {sitePassword.username} for {sitePassword.origin}</button>
      {/if}
      <button type="button" data-browser-control="popup-request"
        onclick={event => ask('popup', { tabId: tab.id }, {}, event.currentTarget)}>Open sample pop-up</button>
      {#if tab?.popupBlocked}
        {@render allowPopupsButton('Allow pop-ups')}
      {/if}
      {#if browserState.settings?.blockCookies}
        <p class="browser-empty" role="status" data-browser-control="form-cookie-note">Log In is refused while “Block all cookies” is enabled: this local login needs its consent cookie and the browser rejects setting it by preference.</p>
      {/if}
      <button type="submit" data-browser-control="form-submit">{tab?.form?.submitted ? 'Logged In' : 'Log In'}</button>
      <p class="browser-empty" role="status">Fictional sample login only: submit requires a nonempty name, an .invalid contact email and the constant sample password; no real credentials or contacts exist here.</p>
    </form>
  {/if}
  {#if page.downloads?.length}
    <ul class="browser-page-links">
      {#each page.downloads as dl (dl.name)}
        <li><button type="button" data-browser-control={`download-start:${dl.name}`}
          onclick={event => ask('download.start', { tabId: tab.id }, { name: dl.name }, event.currentTarget)}>{dl.name}</button></li>
      {/each}
    </ul>
  {/if}
  {#if page.kind === 'search' && !page.links?.length}
    <p class="browser-empty" role="status" data-browser-node="search-empty">No local results found. Try a different search.</p>
  {/if}
  {#if page.links?.length && page.id !== 'home'}
    <ul class="browser-page-links" data-browser-node="page-links">
      {#each page.links as link, index (link.url)}
        <li data-browser-node={`page-link-${index}`}><button type="button" data-browser-control={`page-link:${link.url}`}
          onclick={event => ask('navigate', { tabId: tab.id }, { address: link.url }, event.currentTarget)}>
          {link.title}<span class="link-sub">{link.url}</span></button></li>
      {/each}
    </ul>
  {/if}
  {#if entryNow.error === 'security'}
    <div class="browser-error" role="alert" data-browser-control="security-warning">
      <h2>Fraudulent Website Warning</h2>
      <p>{page?.heading ?? 'This page'} is a locally flagged fictional fixture. No network, TLS or threat data is involved; this warning is protected by the Security preference “Warn when visiting a fraudulent website”. Turning the warning off and reloading shows the harmless authored page.</p>
      <button type="button" data-browser-control="warning-open-security"
        onclick={event => ask('panel', {}, { panel: 'security' }, event.currentTarget)}>Open Security</button>
      <button type="button" data-browser-control="warning-open-settings"
        onclick={event => ask('panel', {}, { panel: 'preferences' }, event.currentTarget)}>Open Security Settings</button>
      <button type="button" data-browser-control="error-reload"
        onclick={event => ask('reload', { tabId: tab.id }, {}, event.currentTarget)}>Reload</button>
    </div>
  {:else if entryNow.error}
    <p class="browser-error" role="status">{entryNow.error}</p>
    <button type="button" data-browser-control="error-reload"
      onclick={event => ask('reload', { tabId: tab.id }, {}, event.currentTarget)}>Reload</button>
  {/if}
{/snippet}

{#snippet sourcePane()}
  <div class="browser-inspector-tree" data-browser-area="inspector-tree">
    <h2>{panelTitle(panelValue)}</h2>
    <textarea class="browser-source" readonly rows="14" value={pageSourceNow} aria-label="Page source"></textarea>
  </div>
{/snippet}

{#snippet permissionRows(row)}
  {#each ['camera', 'microphone', 'location', 'notifications'] as key (key)}
    <dt>{key}</dt>
    <dd><select data-browser-control={`permission-select:${key}`} value={row[key] ?? 'ask'}
      aria-label={`${key} permission`} disabled={!tab || !authoredSite}
      onchange={event => ask('permission', { tabId: tab?.id }, { key, value: event.currentTarget.value }, event.currentTarget)}>
      <option value="ask">ask</option><option value="allow">allow</option><option value="deny">deny</option>
    </select></dd>
  {/each}
  <dt>popups</dt>
  <dd><select data-browser-control="permission-select:popups" value={row.popups === 'allow' ? 'allow' : 'deny'}
    aria-label="Pop-up windows permission" disabled={!tab || !authoredSite}
    onchange={event => ask('permission', { tabId: tab?.id }, { key: 'popups', value: event.currentTarget.value }, event.currentTarget)}>
    <option value="allow">allow</option><option value="deny">deny</option>
  </select></dd>
  <dt>reader</dt>
  <dd><select data-browser-control="permission-select:reader" value={row.reader ? 'true' : 'false'}
    aria-label="Automatic Reader permission" disabled={!tab || !authoredSite || !page?.reader}
    onchange={event => ask('permission', { tabId: tab?.id }, { key: 'reader', value: event.currentTarget.value === 'true' }, event.currentTarget)}>
    <option value="true">true</option><option value="false">false</option>
  </select></dd>
  <dt>zoom</dt>
  <dd><select data-browser-control="permission-select:zoom" value={String(row.zoom ?? 100)}
    aria-label="Per-site page zoom" disabled={!tab || !authoredSite}
    onchange={event => ask('permission', { tabId: tab?.id }, { key: 'zoom', value: Number(event.currentTarget.value) }, event.currentTarget)}>
    {#each ZOOM_LEVELS as level (level)}<option value={String(level)}>{level}%</option>{/each}
  </select></dd>
{/snippet}

{#snippet allowPopupsButton(label)}
  <button type="button" data-browser-control="popup-allow"
    disabled={!tab} onclick={event => allowPopups(event.currentTarget)}>{label}</button>
{/snippet}

{#snippet securityPane()}
  <h2>Security · {permissionOrigin}</h2>
  <dl class="browser-security-grid">
    <dt>Connection</dt><dd>{entryNow?.error ? 'Not established' : 'Local, offline'}</dd>
    {#if certificateNow}
      <dt>Certificate status</dt><dd>{certificateNow.status}</dd>
      <dt>Subject</dt><dd>{certificateNow.subject}</dd>
      <dt>Issuer</dt><dd>{certificateNow.issuer} (fictional — authored scene data, not a real certificate)</dd>
      <dt>Serial</dt><dd>{certificateNow.serial}</dd>
      <dt>Valid</dt><dd>{certificateNow.validFrom} → {certificateNow.validTo}</dd>
      <dt>Note</dt><dd>{certificateNow.explanation}</dd>
    {:else}
      <dt>Certificate</dt><dd>No certificate — {permissionOrigin || 'this address'} is an opaque local scheme.</dd>
    {/if}
  </dl>
  {#if permissionRow}
    <h3>Website Permissions</h3>
    <dl class="browser-security-grid">
      {@render permissionRows(permissionRow)}
    </dl>
  {:else}
    <p class="browser-empty" role="status">No address open; permissions apply per site.</p>
  {/if}
  {#if tab?.popupBlocked}
    <p role="status">Pop-up blocked.</p>
    {@render allowPopupsButton(`Allow pop-ups for ${permissionOrigin}`)}
  {/if}
{/snippet}

{#snippet websitePane()}
  <h2>Website Settings · {permissionOrigin}</h2>
  {#if permissionRow}
    <dl class="browser-security-grid">
      {@render permissionRows(permissionRow)}
    </dl>
  {:else}
    <p class="browser-empty" role="status">No address open; permissions apply per site.</p>
  {/if}
  {#if sitePassword}
    <h3>Saved Password</h3>
    <p class="browser-row-meta">Fictional account for {page?.address ?? permissionOrigin}: {sitePassword.username}</p>
    <button type="button" data-browser-control="autofill-open"
      onclick={event => ask('autofill.open', { tabId: tab.id }, {}, event.currentTarget)}>Use Saved Password</button>
  {/if}
  {#if tab?.popupBlocked}
    <p role="status">Pop-up blocked.</p>
    {@render allowPopupsButton('Allow')}
  {/if}
{/snippet}

{#snippet sharePane()}
  <h2>Share</h2>
  {#if isMac}
    <button type="button" data-browser-control="share-mail"
      onclick={event => ask('share', { tabId: tab?.id }, { destination: 'mail' }, event.currentTarget)}>Mail</button>
    <button type="button" data-browser-control="share-messages"
      onclick={event => ask('share', { tabId: tab?.id }, { destination: 'messages' }, event.currentTarget)}>Messages</button>
  {/if}
  <button type="button" data-browser-control="share-copy"
    onclick={event => ask('share', { tabId: tab?.id }, { destination: 'copy' }, event.currentTarget)}>Copy Address</button>
{/snippet}

{#snippet helpPane()}
  <h2>{isMac ? 'Safari Help' : 'Help'}</h2>
  <p>Browsing works entirely offline. Local pages live under jester:// addresses; https://studio.invalid and https://journal.studio.invalid are closed authored aliases that demonstrate the fictional certificate details without any external request.</p>
  <button type="button" data-browser-control="help-go-start"
    onclick={event => ask('navigate', { tabId: tab?.id }, { address: 'jester://start' }, event.currentTarget)}>Open Start Page</button>
  <button type="button" data-browser-control="help-go-sample"
    onclick={event => ask('navigate', { tabId: tab?.id }, { address: 'https://studio.invalid' }, event.currentTarget)}>Open https://studio.invalid (sample certificate)</button>
  <button type="button" data-browser-control="help-go-unsafe"
    onclick={event => ask('navigate', { tabId: tab?.id }, { address: 'https://unsafe.studio.invalid' }, event.currentTarget)}>Open https://unsafe.studio.invalid (fraud warning sample)</button>
{/snippet}

{#snippet preferenceControls(prefTab)}
  {#each Object.entries(browserState.settings).filter(([key]) => paneKeys(prefTab).includes(key)) as [key, value] (key)}
    {#if key === 'homepage'}
      <label class="browser-field"><span>{paneLabel(key)}</span>
        <input data-browser-control="prefs-homepage" value={value} maxlength="2048"
          oninput={event => ask('preference.set', {}, { key, value: event.currentTarget.value }, event.currentTarget)} />
      </label>
    {:else if key === 'searchEngine'}
      <label class="browser-field"><span>{paneLabel(key)}</span>
        <select data-browser-control="prefs-search-engine" value={value}
          onchange={event => ask('preference.set', {}, { key, value: event.currentTarget.value }, event.currentTarget)}>
          <option value="Studio Search">Studio Search</option>
          <option value="DuckDuckGo">DuckDuckGo</option>
        </select>
      </label>
    {:else if paneChoices(key)}
      <div class="browser-permission">
        <span>{paneLabel(key)}</span>
        <span class="browser-choice-row">
          {#each paneChoices(key) as [choice, label] (choice)}
            <button type="button" aria-pressed={value === choice} data-browser-control={`prefs-choice-${key}-${choice}`}
              onclick={event => ask('preference.set', {}, { key, value: choice }, event.currentTarget)}>{label}</button>
          {/each}
        </span>
      </div>
    {:else}
      <label class="browser-permission">
        <span>{paneLabel(key)}</span>
        <button type="button" class="browser-switch" role="switch" aria-checked={Boolean(value)}
          aria-label={paneLabel(key)}
          data-browser-control={`prefs-set:${key}`}
          onclick={event => ask('preference.set', {}, { key, value: !value }, event.currentTarget)}></button>
      </label>
    {/if}
  {/each}
{/snippet}

{#snippet preferencesPane()}
  <nav class="browser-preference-tabs" aria-label="Preferences tabs">
    {#each preferencesTabs as prefTab (prefTab)}
      <button type="button" class:is-current={prefTab === win?.preferencesTab}
        data-browser-control={`prefs-tab:${prefTab}`}
        onclick={event => ask('preference.tab', {}, { tab: prefTab }, event.currentTarget)}>{prefTab}</button>
    {/each}
  </nav>
  <section class="browser-pane" data-browser-area="preferences-pane">
    {#if win?.preferencesTab === 'Passwords'}
      {#each browserState.passwords as row (row.id)}
        <div class="browser-preview-card">
          <strong>{row.origin}</strong>
          <span class="browser-row-meta">{row.username} · saved locally, fictional</span>
        </div>
      {/each}
      {#if !browserState.passwords.length}
        <p class="browser-empty" role="status">No saved passwords.</p>
      {/if}
    {:else if win?.preferencesTab === 'Websites'}
      <h3>Currently Open Website</h3>
      <button type="button" data-browser-control="prefs-current-site" disabled={!authoredSite}
        onclick={event => ask('panel', {}, { panel: 'website' }, event.currentTarget)}>{permissionOrigin || 'No local site'} · Website Settings</button>
      <h3>Configured Websites</h3>
      <dl class="browser-security-grid">
        {#each browserState.permissions as row (row.origin)}
          <dt>{row.origin}</dt>
          <dd><button type="button" class="browser-row-muted" data-browser-control={`prefs-site:${row.origin}`}
            onclick={event => openSiteSettings(row.origin, event.currentTarget)}>Website Settings</button></dd>
        {/each}
      </dl>
    {:else if isMac && win?.preferencesTab === 'Profiles'}
      <div class="browser-preview-card">
        <strong>{privateWindow ? 'Private Browsing' : 'Default Browsing Profile'}</strong>
        <p>The current scene keeps its local browser preferences, bookmarks and site policies in this canonical browsing profile.</p>
        <p>{browserState.bookmarks.filter(row => row.kind === 'bookmark').length} bookmarks · {browserState.history.length} history visits · {browserState.permissions.length} saved website policies</p>
        <p>{browserVersionLabel}</p>
      </div>
    {:else if String(win?.preferencesTab ?? '').toLocaleLowerCase().includes('about')}
      <div class="browser-preview-card">
        <strong>{browserVersionLabel}</strong>
        <p class="browser-empty" role="status">Research proxy boundary: guide-family controls are reconstructed, not measured factory pixel identity. Browsing is fully local and offline; certificate details and search results are authored fictional content. Downloads and PDF saves publish actual virtual File bytes.</p>
      </div>
    {:else}
      {@render preferenceControls(win?.preferencesTab)}
      {#if win?.preferencesTab === 'AutoFill'}
        <h3>Saved fictional passwords</h3>
        {#each browserState.passwords as row (row.id)}
          <div class="browser-preview-card">
            <strong>{row.origin}</strong>
            <span class="browser-row-meta">{row.username} · fictional sample only</span>
          </div>
        {/each}
      {:else if win?.preferencesTab === 'Extensions'}
        <p class="browser-empty" role="status">Studio Contrast is the only built-in local extension; enabling it applies a contrast class to rendered pages. Nothing is installed from outside.</p>
      {:else if String(win?.preferencesTab ?? '').toLocaleLowerCase().includes('cookie') || String(win?.preferencesTab ?? '').toLocaleLowerCase().includes('site permission')}
        <h3>Site permissions</h3>
        {#each browserState.permissions as row (row.origin)}
          <div class="browser-preview-card">
            <strong>{row.origin}</strong>
            <button type="button" class="browser-row-muted" data-browser-control={`prefs-site:${row.origin}`}
              onclick={event => openSiteSettings(row.origin, event.currentTarget)}>Website Settings</button>
          </div>
        {/each}
      {/if}
    {/if}
    {#if ['Developer', 'Feature Flags'].includes(win?.preferencesTab)}
      <button type="button" data-browser-control="prefs-local-inspector"
        onclick={event => ask('panel', {}, { panel: 'inspector' }, event.currentTarget)}>Open local Web Inspector · observed DOM</button>
    {/if}
    {#each preferenceBoundaries as boundary (boundary.label)}
      <div class="browser-preference-boundary">
        <strong>{boundary.label}</strong>
        <p>{boundary.reason}</p>
      </div>
    {/each}
  </section>
{/snippet}

{#snippet overviewPane()}
  <div class="browser-tabs-host">
    {#each win?.tabs ?? [] as row (row.id)}
      <div class="browser-preview-card" data-browser-control={`overview:${row.id}`}>
        <strong>{tabTitle(row)}</strong>
        <span class="browser-row-meta">{row.entries[row.index]?.url ?? ''}</span>
        <div class="browser-sidebar-actions">
          <button type="button" data-browser-control={`overview-select:${row.id}`}
            onclick={event => ask('tab.select', { tabId: row.id }, {}, event.currentTarget)}>Select</button>
          <button type="button" data-browser-control={`overview-pin:${row.id}`}
            onclick={event => ask('tab.pin', { tabId: row.id }, {}, event.currentTarget)}>{row.pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" data-browser-control={`overview-close:${row.id}`} disabled={row.pinned}
            onclick={event => ask('tab.close', { tabId: row.id }, {}, event.currentTarget)}>Close</button>
        </div>
      </div>
    {/each}
  </div>
  {#if browserState.closedTabs.some(row => row.windowId === windowId)}
    <button type="button" data-browser-control="tab-reopen-overview"
      onclick={event => ask('tab.reopen', {}, {}, event.currentTarget)}>Reopen Last Closed Tab</button>
  {/if}
  {#if browserState.windows.some(row => row.nativeAppId === win?.nativeAppId && !row.private && row.closed === true)}
    <button type="button" data-browser-control="window-reopen-overview"
      onclick={event => ask('window.reopen', {}, {}, event.currentTarget)}>Reopen Last Closed Window</button>
  {/if}
{/snippet}

{#snippet findBar()}
  <input data-browser-control="find" aria-label="Find in page" value={tab.find.query} maxlength="256"
    oninput={event => askFind('find.query', { query: event.currentTarget.value }, event.currentTarget)}
    onfocus={observeFocus} />
  <span role="status">{findStatus}</span>
  <button type="button" data-browser-control="find-prev" aria-label="Previous match"
    onclick={event => askFind('find.next', { backward: true }, event.currentTarget)}>↑</button>
  <button type="button" data-browser-control="find-next" aria-label="Next match"
    onclick={event => askFind('find.next', { backward: false }, event.currentTarget)}>↓</button>
  <button type="button" data-browser-control="find-close" aria-label="Close find bar"
    onclick={event => { observedFind = { tabId: null, loadToken: null, count: 0, index: 0 }; void ask('find.close', { tabId: tab.id }, {}, event.currentTarget); }}>×</button>
{/snippet}

{#snippet bottomBar()}
  {#each ['bookmarks', 'reading', 'history', 'downloads'] as name (name)}
    <button type="button" data-browser-control={`panel-${name}`}
      onclick={event => ask('panel', {}, { panel: name }, event.currentTarget)}>{panelTitle(name)}</button>
  {/each}
  {#if tab}
    <button type="button" data-browser-control="page-zoom-out" aria-label="Zoom out"
      onclick={event => ask('zoom', { tabId: tab.id }, { value: Math.max(50, (tab.zoom ?? 100) - 10) }, event.currentTarget)}>A−</button>
    <button type="button" data-browser-control="page-zoom-reset" aria-label="Actual size"
      onclick={event => ask('zoom', { tabId: tab.id }, { value: 100 }, event.currentTarget)}>{tab.zoom ?? 100}%</button>
    <button type="button" data-browser-control="page-zoom-in" aria-label="Zoom in"
      onclick={event => ask('zoom', { tabId: tab.id }, { value: Math.min(300, (tab.zoom ?? 100) + 10) }, event.currentTarget)}>A+</button>
    <button type="button" data-browser-control="print-page" aria-label="Print" disabled={tab.phase === 'loading'}
      onclick={event => ask('print', { tabId: tab.id }, {}, event.currentTarget)}>Print</button>
    <button type="button" data-browser-control="pdf-page" aria-label="Save as PDF" disabled={tab.phase === 'loading'}
      onclick={event => ask('pdf', { tabId: tab.id }, {}, event.currentTarget)}>PDF</button>
    {#if isMac}
      <button type="button" data-browser-control="reading-add" aria-label="Add to Reading List"
        onclick={event => ask('reading.add', { tabId: tab.id }, {}, event.currentTarget)}>＋ Reading List</button>
      <button type="button" data-browser-control="panel-preferences-launch" aria-label="Preferences"
        onclick={event => ask('panel', {}, { panel: 'preferences' }, event.currentTarget)}>⚙︎</button>
    {/if}
  {/if}
  <span class="browser-row-meta">{browserVersionLabel} research proxy · native-era approximation, not pixel identity</span>
  <span class="browser-status-address" role="status">{entryNow?.url ?? ''}</span>
  {#if interactionError}<p class="browser-interaction-error" role="status">{interactionError}</p>{/if}
{/snippet}

{#snippet browserChrome()}
  <header class="browser-tabstrip" data-window-drag>
    {@render tabstrip()}
    <div class="browser-tabstrip-buttons" data-window-no-drag>
      {#if !chromeHidesChrome}
        <button type="button" class="browser-chrome-toggle" data-browser-control="bookmarks-bar-toggle"
          aria-label={win?.bookmarksBar ? 'Hide Favorites Bar' : 'Show Favorites Bar'}
          onclick={event => ask('bookmarksBar', {}, {}, event.currentTarget)}>{win?.bookmarksBar ? 'Bookmarks ✓' : 'Bookmarks'}</button>
      {/if}
      {#if chromeExtended}
        <button type="button" class="browser-chrome-toggle" data-browser-control="chrome-sidebar"
          aria-label="Toggle Sidebar" onclick={event => ask('sidebar', {}, {}, event.currentTarget)}>◧</button>
      {/if}
      {#if panelValue !== 'none'}
        <button type="button" class="browser-chrome-toggle" data-browser-control="chrome-close"
          aria-label={`Close ${panelTitle(panelValue)}`}
          onclick={event => ask('panel', {}, { panel: 'none' }, event.currentTarget)}>×</button>
      {/if}
    </div>
  </header>
  {#if showEmbeddedMenus && menuGroups.length}
    <nav class="browser-menubar" aria-label="Safari menus" data-window-no-drag>
      {#each menuGroups as group (group.id)}
        <span class="browser-menu-anchor">
          <button type="button" class="browser-menu-title" class:is-open={win?.menu === group.id}
            aria-haspopup="menu" aria-expanded={win?.menu === group.id ? 'true' : 'false'}
            onmousedown={event => event.preventDefault()}
            data-browser-control={`menu-title:${group.id}`}
            onclick={event => toggleMenu(group.id)}>{group.label}</button>
          {#if win?.menu === group.id}
            {@render menuPopup()}
          {/if}
        </span>
      {/each}
    </nav>
  {/if}
  {#if !chromeHidesChrome}
    <div class="browser-toolbar" data-window-drag>
      <div class="browser-toolbar-row" data-window-no-drag>
        {@render toolbar()}
      </div>
    </div>
    {#if bookmarksBarVisible}
      <nav class="browser-bookmarks-bar" aria-label="Favorites Bar">
        {@render favoritesBar()}
      </nav>
    {/if}
  {/if}
  {#if tab?.phase === 'loading'}<div class="browser-loader on"></div>{/if}
{/snippet}

{#snippet panelMain()}
  {#if panelValue === 'overview'}
    <div class="browser-scroll" data-browser-area="overview">{@render overviewPane()}</div>
  {:else if panelValue === 'preferences'}
    <div class="browser-scroll browser-preferences" data-browser-area="preferences" onscroll={event => observeScroll(event, 'preferences')}>
      {@render preferencesPane()}
    </div>
  {:else if panelValue === 'website'}
    <div class="browser-scroll" data-browser-area="website">{@render websitePane()}</div>
  {:else if panelValue === 'security'}
    <div class="browser-scroll" data-browser-area="security">{@render securityPane()}</div>
  {:else if panelValue === 'share'}
    <div class="browser-scroll browser-sheet" data-browser-area="share">{@render sharePane()}</div>
  {:else if panelValue === 'help'}
    <div class="browser-scroll" data-browser-area="help">{@render helpPane()}</div>
  {:else if page && entryNow}
    <div class="browser-scroll" data-browser-area="page" onscroll={event => observeScroll(event, 'page')}>
      {#if tab.reader && panelValue !== 'source' && panelValue !== 'inspector'}
        <article class="browser-page-inner browser-reader" class:browser-contrast={browserState.settings?.extensions === true}
          data-browser-page-text style:--zoom-scale={zoomScale} style:transform={`scale(${zoomScale})`}>
          <h1>{page.heading}</h1>
          <p class="browser-page-lede">{page.description}</p>
          {#each page.sections as section (section.title)}
            <h2>{section.title}</h2>
            <p class="browser-reader-paragraph">{section.body}</p>
          {/each}
          {#if entryNow.error}
            <p class="browser-error" role="status">{entryNow.error}</p>
          {/if}
        </article>
      {:else if panelValue === 'source'}
        <article class="browser-page-inner" class:browser-contrast={browserState.settings?.extensions === true}
          data-browser-node="article" data-browser-page-text>
          {@render sourcePane()}
        </article>
      {:else if page.kind === 'image'}
        <article class="browser-page-inner browser-svg-view" data-browser-node="svg-document" data-browser-page-text style:transform={`scale(${zoomScale})`}>
          <h1>{svgFile?.name ?? 'Local SVG document'}</h1>
          {#if tab.phase === 'loading'}
            <p role="status">Opening original SVG File…</p>
          {:else if svgSource}
            <img src={svgSource} alt={svgFile.name} data-browser-svg-file={svgFile.id} data-browser-svg-revision={svgFile.revision}
              data-browser-node="svg-image"
              onload={event => ask('file.decode', { tabId: tab.id }, { fileId: svgFile.id, revision: svgFile.revision }, event.currentTarget)}
              onerror={event => ask('file.decode', { tabId: tab.id }, { fileId: svgFile.id, revision: svgFile.revision }, event.currentTarget)} />
            {#if entryNow.error === 'decode'}<p role="alert" class="browser-error">The original SVG bytes could not be decoded as an image.</p>{/if}
          {:else}
            <p role="alert" class="browser-error">The original SVG File is unavailable.</p>
          {/if}
          <p class="browser-row-meta">Original virtual File, revision {svgFile?.revision ?? 'unavailable'} · native SVG-as-image decoder; no Preview claim or format conversion.</p>
        </article>
      {:else if page.kind === 'empty'}
        <div data-browser-node="empty-page" aria-label="Empty Page"></div>
      {:else}
        <article class="browser-page-inner" class:browser-contrast={browserState.settings?.extensions === true}
          data-browser-node="article" data-browser-page-text style:--zoom-scale={zoomScale} style:transform={`scale(${zoomScale})`}>
          {@render pageArticle()}
        </article>
      {/if}
    </div>
    {#if panelValue === 'inspector'}
      <aside class="browser-inspector-dock" data-browser-area="inspector">
        <header class="browser-inspector-head">
          <strong>Web Inspector</strong>
          <button type="button" class="browser-row-muted" data-browser-control="inspector-refresh"
            onclick={event => inspectNodes(event.currentTarget)}>Refresh Tree</button>
        </header>
        <div class="browser-inspector-list" data-browser-area="inspector-list">
          {#each inspectorNodes as node (node.id)}
            <button type="button" class="browser-row" class:is-current={win?.inspectorNodeId === node.id}
              data-browser-control={`inspector-node:${node.id}`}
              onclick={event => inspectNode(node.id, event.currentTarget)}>
              {`<`}{node.tag}{`>`} {node.id}{#if node.parentId}<span class="browser-row-meta">in {node.parentId}</span>{/if}
              <span class="browser-inspector-preview">{node.textPreview}</span>
            </button>
          {/each}
          {#if !inspectorNodes.length}
            <p class="browser-empty" role="status">Observed nodes appear after Refresh Tree.</p>
          {/if}
        </div>
        {#if inspectorSnapshot}
          <dl class="browser-security-grid browser-inspector-detail" data-browser-area="inspector-detail">
            <dt>Node</dt><dd>{`<`}{inspectorSnapshot.tag}{`>`} {inspectorSnapshot.id}</dd>
            <dt>Text</dt><dd class="browser-inspector-text">{inspectorSnapshot.text || '(empty)'}</dd>
            <dt>Rect</dt>
            <dd>{Math.round(inspectorSnapshot.rect.x)}, {Math.round(inspectorSnapshot.rect.y)} · {Math.round(inspectorSnapshot.rect.width)}×{Math.round(inspectorSnapshot.rect.height)}</dd>
            {#each Object.entries(inspectorSnapshot.computed) as [key, value] (key)}
              <dt>{key}</dt><dd>{value}</dd>
            {/each}
          </dl>
        {:else}
          <p class="browser-empty" role="status">Select a node to observe its actual DOM.</p>
        {/if}
      </aside>
    {/if}
  {:else}
    <p class="browser-page-empty" role="status">Loading…</p>
  {/if}
{/snippet}

{#snippet clearHistorySheet()}
  {#if win?.historyClear.open}
    <div class="browser-modal-scrim">
      <section class="browser-modal browser-sheet" role="dialog" aria-modal="true" aria-label="Clear History">
        <h2>Clear History</h2>
        <p>Clear {win.historyClear.range === 'hour' ? 'the last hour' : win.historyClear.range === 'day' ? 'today’s history' : 'all local browsing history'}? Bookmarks, Reading List and virtual downloaded files are kept. This clears fictional visits only, not host-browser data.</p>
        <div class="browser-sidebar-actions">
          <button type="button" data-browser-control="history-clear-cancel"
            onclick={event => ask('history.clear.cancel', {}, {}, event.currentTarget)}>Cancel</button>
          <button type="button" data-browser-control="history-clear-confirm"
            onclick={event => ask('history.clear', {}, { range: win.historyClear.range }, event.currentTarget)}>Clear History</button>
        </div>
      </section>
    </div>
  {/if}
{/snippet}

{#if isMac}
  <section bind:this={panel} class="browser-window {cssRenderer}" class:inactive={!active}
    class:is-private={privateWindow}
    data-browser-window-root data-browser-window-id={windowId} aria-label="Safari">
    <div class="browser-chrome-host" inert={win?.historyClear.open}>{@render browserChrome()}</div>
    <div class="browser-body" inert={win?.historyClear.open}>
      {#if sidebarKind}
        <aside class="browser-sidebar" data-browser-area="sidebar" onscroll={event => observeScroll(event, 'sidebar')}>
          <h3 class="browser-sidebar-heading">{panelTitle(sidebarKind ?? "bookmarks")}</h3>
          <div class="browser-sidebar-list" data-browser-area="sidebar-list">
            {@render sidebarLists(sidebarKind)}
          </div>
        </aside>
      {/if}
      <div class="browser-main">
        {@render panelMain()}
        {#if tab?.find.open && !chromeHidesChrome}
          <div class="browser-findbar" data-browser-area="findbar">
            {@render findBar()}
          </div>
        {/if}
      </div>
    </div>
    <div class="browser-bottombar" inert={win?.historyClear.open}>
      {@render bottomBar()}
    </div>
    {@render clearHistorySheet()}
  </section>
{:else}
  <section bind:this={panel} class="browser-window {cssRenderer}" class:inactive={!active}
    class:is-private={privateWindow}
    data-browser-window-root data-browser-window-id={windowId} aria-label="Edge">
    <div class="browser-chrome-host" inert={win?.historyClear.open}>{@render browserChrome()}</div>
    <div class="browser-body" inert={win?.historyClear.open}>
      {#if sidebarKind}
        <aside class="browser-sidebar" data-browser-area="sidebar" onscroll={event => observeScroll(event, 'sidebar')}>
          <h3 class="browser-sidebar-heading">{panelTitle(sidebarKind ?? "bookmarks")}</h3>
          <div class="browser-sidebar-list" data-browser-area="sidebar-list">
            {@render sidebarLists(sidebarKind)}
          </div>
        </aside>
      {/if}
      <div class="browser-main">
        {@render panelMain()}
        {#if tab?.find.open && !chromeHidesChrome}
          <div class="browser-findbar" data-browser-area="findbar">
            {@render findBar()}
          </div>
        {/if}
      </div>
    </div>
    <div class="browser-bottombar" inert={win?.historyClear.open}>
      {@render bottomBar()}
    </div>
    {@render clearHistorySheet()}
  </section>
{/if}
