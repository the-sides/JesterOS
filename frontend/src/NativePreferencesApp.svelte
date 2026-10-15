<script>
  import { tick, untrack } from 'svelte';
  import { preferencesPanes, preferencesControls, preferencesControlValue, preferencesActions } from './preferences-panes.js';
  import GoldenGateNotificationSettings from './GoldenGateNotificationSettings.svelte';
  import { parsePreferencesProfile } from './preferences-profile-codec.js';
  import { preferencesUpdateManifests } from './preferences-effects.js';
  import './preferences-native.css';
  const nativeIconCentersX = [65, 180, 294, 408, 523, 637, 751, 865];
  const nativeIconCentersY = [202, 357, 513, 669];
  function nativeSprite(name, large) {
    const match = typeof name === 'string' && /^native-grid:(high-sierra|mojave):([0-7]):([0-3])$/u.exec(name);
    if (!match) return null;
    const size = large ? 48 : 22, scale = size / 64;
    return `--np-native-size:${size}px;--np-native-image:url('/preferences-${match[1]}-icons.png');--np-native-width:${934 * scale}px;--np-native-x:${-(nativeIconCentersX[Number(match[2])] - 32) * scale}px;--np-native-y:${-(nativeIconCentersY[Number(match[3])] - 32) * scale}px`;
  }

  let { profile, window, state: nativePreferencesState, shared, inventory, execute, registerView,
    available = false, ownership, notificationComponent = GoldenGateNotificationSettings, notificationExecute, registerNotificationView } = $props();
  let root = $state(null), content = $state(null), sheetElement = $state(null), demoCanvas = $state(null);
  let error = $state(''), passcode = $state(''), submitting = $state(false);
  let privateValues = $state({});
  let searchPopoverOpen = $state(false);
  let profileLease = $state.raw(null);
  let gesture = $state('Try a gesture in the preview'), demoProgress = $state(0), inkHasMarks = $state(false);
  let pointer = null, drawingContext = null;
  const retainedScroll = new Map();
  const categoryLabels = { system: 'System', 'bluetooth-devices': 'Bluetooth & devices', 'network-internet': 'Network & internet', personalization: 'Personalization', apps: 'Apps', accounts: 'Accounts', 'time-language': 'Time & language', accessibility: 'Accessibility', 'privacy-security': 'Privacy & security', 'windows-update': 'Windows Update' };
  const categoryOrder = Object.keys(categoryLabels);
  const instanceId = $props.id();
  const classic = $derived(/high-sierra|mojave/u.test(profile.id));
  const windows = $derived(profile.family === 'windows');
  const qualified = $derived(/golden-gate/u.test(profile.id));
  const dark = $derived(profile.renderer !== 'high-sierra' && shared.appearance?.mode === 'dark');
  const session = $derived(nativePreferencesState.sessions.find(row => row.windowId === window.id));
  const panes = $derived(preferencesPanes(profile, inventory, nativePreferencesState).sort((a, b) => a.index - b.index));
  const pane = $derived(panes.find(row => row.id === session?.pane));
  const controls = $derived(pane ? preferencesControls(pane.id, session.tab, profile) : []);
  const categories = $derived(categoryOrder.filter(category => panes.some(row => row.category === category)));
  const siblingPanes = $derived(windows && pane ? panes.filter(row => row.category === pane.category) : []);
  const query = $derived((session?.query ?? '').trim().toLocaleLowerCase());
  const allControls = $derived.by(() => {
    const result = [];
    for (const row of panes) for (const tab of row.tabs?.length ? row.tabs : [{ id: '', label: '' }]) {
      for (const control of preferencesControls(row.id, tab.id, profile)) {
        if (!result.some(entry => entry.pane.id === row.id && entry.control.id === control.id)) result.push({ pane: row, tab, control });
      }
    }
    return result;
  });
  const results = $derived(query ? allControls.filter(row => row.pane.available && (matches(row.pane.label) || matches(row.control.label) || matches(row.control.detail))) : []);
  const groups = $derived([...new Set(controls.map(control => control.group ?? ''))]);
  const gridGroups = $derived([...new Set(panes.map(row => row.group ?? ''))]);
  const sheet = $derived(session?.sheet && session.sheet.kind !== 'none' ? session.sheet : null);
  const authentication = $derived(sheet?.kind === 'authenticate');
  const help = $derived(sheet?.kind === 'help');
  const sheetAction = $derived(preferencesActions[sheet?.kind] ?? allControls.flatMap(row => [row.control, ...(row.control.rowActions ?? [])])
    .find(control => control.actionId === sheet?.kind || control.sheet === sheet?.kind));
  const protectedPane = $derived(controls.some(control => control.protected));
  const updates = $derived(nativePreferencesState.configuration.updates);
  const updateManifests = $derived(preferencesUpdateManifests(profile));
  const updateStatusLabels = { idle: 'Idle', checking: 'Checking authored update catalog…', available: 'Local scene package available', downloading: 'Preparing local package bytes…', ready: 'Local package ready to apply', current: 'Authored scene package applied' };
  const notificationOwnership = () => available === true && ownership?.() === true && session === nativePreferencesState.sessions.find(row => row.windowId === window.id);
  const profilePreview = $derived.by(() => {
    void nativePreferencesState.revision;
    if (sheet?.kind !== 'profile.confirm') return null;
    const missing = message => ({ profile: null, error: message });
    const lease = profileLease, files = profileFiles();
    if (!lease || lease.sheet !== sheet || inventory.files !== lease.container || files !== lease.files)
      return missing('The original profile source is unavailable. Cancel and inspect the file again.');
    const file = files.find(row => row.id === sheet.values.fileId);
    if (file !== lease.file || file.revision !== lease.revision || file.revision !== sheet.values.expectedRevision || file.content !== lease.content)
      return missing('The original profile changed after inspection. Cancel and inspect its current revision again.');
    const parents = profileAncestors(file, files);
    if (!parents || parents.length !== lease.ancestors.length || !parents.every((row, index) => row === lease.ancestors[index]))
      return missing('The original profile or one of its parent folders is unavailable.');
    try { return { profile: parsePreferencesProfile(file.content), error: '' }; }
    catch (cause) { return missing(cause.message); }
  });
  function profileFiles() { return Array.isArray(inventory.files) ? inventory.files : inventory.files?.files; }
  function profileAncestors(file, files) {
    const rows = [], seen = new Set();
    for (let current = file; current;) {
      if (current.deleted || current.trashed || current.id === 'trash' || seen.has(current.id)) return null;
      rows.push(current); seen.add(current.id);
      if (current.parentId === null || current.parentId === undefined) return rows;
      current = files.find(row => row.id === current.parentId);
      if (!current) return null;
    }
    return null;
  }

  function matches(value) { return typeof value === 'string' && value.toLocaleLowerCase().includes(query); }
  function highlights(value) {
    const text = String(value ?? '');
    if (!query) return [{ text, match: false }];
    const lower = text.toLocaleLowerCase(), parts = [];
    let start = 0, index;
    while ((index = lower.indexOf(query, start)) !== -1) {
      if (index > start) parts.push({ text: text.slice(start, index), match: false });
      parts.push({ text: text.slice(index, index + query.length), match: true }); start = index + query.length;
    }
    if (start < text.length) parts.push({ text: text.slice(start), match: false });
    return parts;
  }
  const optionValue = option => option && typeof option === 'object' ? option.value : option;
  const optionLabel = option => option && typeof option === 'object' ? option.label : String(option);
  const controlDomId = id => `${instanceId}-${id}`;
  const valueOf = control => preferencesControlValue(nativePreferencesState, shared, control);
  function unavailableReason(control) {
    if (nativePreferencesState.configuration.profiles.rows.some(profile => profile.settings.some(setting => setting.controlId === control.id)))
      return 'Managed by an installed configuration profile.';
    if (control.source === 'sound' && control.path?.startsWith('$output.')) {
      const route = shared.sound?.outputs.find(row => row.id === shared.sound.outputDeviceId);
      if (!route || route.available !== true) return 'The selected original output device is unavailable.';
      if (route.adjustable !== true && ['volume', 'muted'].includes(control.path.slice(8))) return 'The selected output device has no adjustable volume or mute controls.';
    }
    if (control.source === 'sound' && control.path === '$input.gain') {
      const route = shared.sound?.inputs.find(row => row.id === shared.sound.inputDeviceId);
      if (!route || route.available !== true) return 'The selected original input device is unavailable.';
      if (route.adjustable !== true) return 'The selected input device has no adjustable gain control.';
    }
    return '';
  }
  const enabled = control => control.available !== false && !unavailableReason(control) && (!control.protected || session.unlocked) && (control.type === 'action' || valueOf(control) !== undefined);
  const rowLabel = row => typeof row === 'object' ? row.label ?? row.name ?? row.id : String(row);
  const rowId = row => typeof row === 'object' ? row.id : row;
  const displayValue = value => typeof value === 'boolean' ? value ? 'On' : 'Off' : value === null || value === undefined ? '' : typeof value === 'object' ? '' : String(value);
  const ancestors = node => { const result = []; for (let current = node; current; current = current.parentElement) result.push(current); return result; };
  function collectionContainers(graph) {
    const containers = [], seen = new WeakSet();
    function visit(value, path) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) { containers.push({ original: value, read: () => path.reduce((node, key) => node?.[key], graph) }); return; }
      for (const key of Object.keys(value)) if (value[key] && typeof value[key] === 'object') visit(value[key], [...path, key]);
    }
    visit(graph, []);
    return containers;
  }
  function visible(node) {
    if (!node?.isConnected || !root?.isConnected || node !== root && !root.contains(node)) return false;
    const view = node.ownerDocument.defaultView;
    if (!view || ![...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) return false;
    const bounds = node.getBoundingClientRect();
    let left = Math.max(0, bounds.left), top = Math.max(0, bounds.top);
    let right = Math.min(view.innerWidth, bounds.right), bottom = Math.min(view.innerHeight, bounds.bottom);
    for (const ancestor of ancestors(node)) {
      const style = view.getComputedStyle(ancestor);
      if (ancestor.hidden || ancestor.inert || ancestor.hasAttribute('inert') || ancestor.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
      if (ancestor !== node) {
        const box = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
        if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
      }
    }
    if (right <= left || bottom <= top) return false;
    const hit = node.ownerDocument.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return !!hit && (hit === node || node.contains(hit));
  }
  function live() { return available === true && ownership?.() === true && !!session && visible(root); }
  async function send(suffix, payload = {}) {
    if (!live() || typeof execute !== 'function') return null;
    const originalWindow = window, originalState = nativePreferencesState, originalSession = session;
    try {
      const result = await execute({ command: `preferences.${suffix}`, target: { windowId: originalWindow.id }, payload });
      if (window === originalWindow && nativePreferencesState === originalState && session === originalSession && live())
        error = result?.status === 'rejected' ? result.error?.message ?? result.message ?? 'This change could not be applied.' : '';
      return result;
    } catch (cause) {
      if (window === originalWindow && nativePreferencesState === originalState && session === originalSession && live()) error = cause?.message ?? 'This change could not be applied.';
      return null;
    }
  }
  function change(control, event) {
    if (control.readonly || !enabled(control) || !event.currentTarget.reportValidity()) return;
    const node = event.currentTarget;
    const value = control.type === 'checkbox' ? node.checked : ['range', 'number'].includes(control.type) ? node.valueAsNumber
      : control.type === 'select' ? optionValue(control.options.find(option => String(optionValue(option)) === node.value)) : node.value;
    if (value !== undefined) send('set', { controlId: control.id, value });
  }
  function openAction(action, row) {
    if (action.available === false || unavailableReason(action) || action.protected && !session.unlocked) return;
    const values = row ? { selectedId: rowId(row) } : {};
    if (action.sheet || action.fields?.length || action.confirmation) send('sheet', { kind: action.sheet ?? action.actionId, values });
    else send('action', { actionId: action.actionId, values: { ...(action.values ?? {}), ...values } });
  }
  function draft(field, event) {
    if (field.readonly) return;
    const node = event.currentTarget;
    if (field.type === 'password') { privateValues[field.id] = node.value; return; }
    const value = field.type === 'checkbox' ? node.checked : ['range', 'number'].includes(field.type) ? node.valueAsNumber
      : field.type === 'select' ? optionValue(field.options.find(option => String(optionValue(option)) === node.value)) : node.value;
    if (value !== undefined && (typeof value !== 'number' || Number.isFinite(value))) send('draft', { field: field.id, value });
  }
  async function confirm(event) {
    event.preventDefault();
    if (submitting || !event.currentTarget.reportValidity()) return;
    if (sheet?.kind === 'profile.confirm' && !profilePreview?.profile) { error = profilePreview?.error ?? 'The original profile is unavailable.'; return; }
    const originalSheet = sheet, originalSession = session;
    submitting = true;
    try {
      if (authentication) { const secret = passcode; passcode = ''; await send('authenticate', { passcode: secret }); }
      else if (sheetAction && sheet === originalSheet && session === originalSession) {
        const values = { ...originalSheet.values, ...privateValues };
        privateValues = {};
        await send('action', { actionId: sheetAction.actionId, values });
      }
    } finally { submitting = false; }
  }
  async function selectResult(result) {
    const originalSession = session;
    searchPopoverOpen = false;
    const applied = await send('navigate', { pane: result.pane.id });
    if (applied?.status !== 'applied' || session !== originalSession || !live()) return;
    if (result.tab.id && session.tab !== result.tab.id) await send('tab', { tab: result.tab.id });
    await tick();
    if (session === originalSession && live()) {
      const node = [...root.querySelectorAll('[data-preferences-control]')].find(node => node.dataset.preferencesControl === result.control.id);
      if (node && root.contains(node)) node.scrollIntoView({ block: 'center' });
      if (node && visible(node) && !node.disabled) node.focus({ preventScroll: true });
    }
  }
  function observeFocus(event) {
    const id = event.target?.dataset.preferencesControl;
    if (id && id !== 'authenticate-passcode') send('focus', { controlId: id });
  }
  function observeScroll(event) {
    const top = event.currentTarget.scrollTop;
    retainedScroll.set(`${session.pane}:${session.tab}`, top);
    send('scroll', { top });
  }
  function keydown(event) {
    if (sheet && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); passcode = ''; privateValues = {}; send('sheet', { kind: 'none' }); }
    else if (sheet && event.key === 'Tab') {
      const nodes = [...sheetElement.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(node => !node.disabled && visible(node));
      const index = nodes.indexOf(root.ownerDocument.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === nodes.length - 1)) { event.preventDefault(); nodes[0]?.focus(); }
    } else if (!sheet && (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
      event.preventDefault(); root.querySelector('[data-preferences-control="search"]')?.focus();
    }
  }
  function tabKeydown(event, index) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = pane.tabs, next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    send('tab', { tab: tabs[next].id });
    root.querySelector(`[data-preferences-tab-index="${next}"]`)?.focus();
  }
  function listKeydown(event, control, rows, row) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = rows.indexOf(row), next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
    send('select', { controlId: control.id, selectedId: rowId(rows[next]) });
    [...root.querySelectorAll('[data-preferences-control]')].find(node => node.dataset.preferencesControl === `${control.id}:${rowId(rows[next])}`)?.focus();
  }
  function startDemo(event) {
    if (!live() || !pane?.available || !demoCanvas || pane.id === 'ink' && !nativePreferencesState.configuration.ink.enabled) return;
    const rect = demoCanvas.getBoundingClientRect(), x = (event.clientX - rect.left) * demoCanvas.width / rect.width, y = (event.clientY - rect.top) * demoCanvas.height / rect.height;
    pointer = { id: event.pointerId, x, y, startX: x, startY: y };
    demoCanvas.setPointerCapture(event.pointerId);
    if (pane.id === 'ink') {
      drawingContext = demoCanvas.getContext('2d');
      if (!drawingContext) return;
      drawingContext.strokeStyle = '#253747'; drawingContext.lineWidth = 2.5; drawingContext.lineCap = 'round';
      drawingContext.beginPath(); drawingContext.moveTo(x, y); drawingContext.lineTo(x + .2, y + .2); drawingContext.stroke(); inkHasMarks = true;
    } else { gesture = 'Move across the trackpad'; demoProgress = 0; }
  }
  function moveDemo(event) {
    if (!pointer || event.pointerId !== pointer.id || !live()) return;
    const rect = demoCanvas.getBoundingClientRect(), x = (event.clientX - rect.left) * demoCanvas.width / rect.width, y = (event.clientY - rect.top) * demoCanvas.height / rect.height;
    if (pane.id === 'ink' && drawingContext) {
      if (!nativePreferencesState.configuration.ink.enabled || Math.hypot(x - pointer.x, y - pointer.y) < nativePreferencesState.configuration.ink.spacing / 25) return;
      drawingContext.beginPath(); drawingContext.moveTo(pointer.x, pointer.y); drawingContext.lineTo(x, y); drawingContext.stroke();
    } else {
      const settings = nativePreferencesState.configuration.trackpad;
      const horizontal = Math.abs(x - pointer.startX) > Math.abs(y - pointer.startY);
      demoProgress = horizontal && settings.swipePages !== 'off' ? Math.max(-1, Math.min(1, (x - pointer.startX) / 140)) : 0;
      gesture = horizontal ? settings.swipePages === 'off' ? 'Swipe between pages is off' : x > pointer.startX ? 'Swipe right' : 'Swipe left'
        : (y > pointer.startY) === settings.naturalScroll ? 'Scroll up' : 'Scroll down';
    }
    pointer.x = x; pointer.y = y;
  }
  function endDemo(event) {
    if (pointer?.id !== event.pointerId) return;
    if (pane.id !== 'ink' && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) < 8) gesture = nativePreferencesState.configuration.trackpad.tapToClick ? 'Tap to click' : 'Tap to click is off';
    if (demoCanvas?.hasPointerCapture(event.pointerId)) demoCanvas.releasePointerCapture(event.pointerId);
    pointer = null;
  }
  function clearInk() { if (live() && demoCanvas) { demoCanvas.getContext('2d')?.clearRect(0, 0, demoCanvas.width, demoCanvas.height); inkHasMarks = false; } }

  $effect(() => {
    const originalRoot = root, originalWindow = window, originalState = nativePreferencesState, originalSession = session;
    const originalConfiguration = nativePreferencesState.configuration, originalSessions = nativePreferencesState.sessions;
    const originalSources = Object.entries(shared), chain = originalRoot ? ancestors(originalRoot) : [];
    const collections = [originalConfiguration, ...originalSources.map(([, source]) => source)].flatMap(collectionContainers);
    const currentPane = session?.pane, currentTab = session?.tab, currentSheet = sheet;
    if (!originalRoot || !originalSession || typeof registerView !== 'function') return;
    let retired = false;
    const owned = () => !retired && root === originalRoot && window === originalWindow && nativePreferencesState === originalState
      && nativePreferencesState.configuration === originalConfiguration && nativePreferencesState.sessions === originalSessions && session === originalSession
      && nativePreferencesState.sessions.find(row => row.windowId === originalWindow.id) === originalSession
      && session.pane === currentPane && session.tab === currentTab && sheet === currentSheet
      && originalSources.every(([name, source]) => shared[name] === source)
      && collections.every(container => container.read() === container.original)
      && chain.length === ancestors(originalRoot).length && chain.every((node, index) => ancestors(originalRoot)[index] === node)
      && live();
    const nodes = () => owned() ? [...originalRoot.querySelectorAll('[data-preferences-control]')].filter(visible) : [];
    const facade = {
      available: controlId => owned() && (!controlId || nodes().some(node => node.dataset.preferencesControl === controlId && !node.disabled)),
      controlIds: () => nodes().map(node => node.dataset.preferencesControl),
      describe: () => owned() ? { windowId: originalWindow.id, pane: currentPane, tab: currentTab, selectedId: originalSession.selectedId,
        controlIds: nodes().map(node => node.dataset.preferencesControl), controls: nodes().map(node => ({ id: node.dataset.preferencesControl, disabled: !!node.disabled, focused: node.ownerDocument.activeElement === node })) } : null,
      focus(controlId, guard) {
        if (typeof guard !== 'function' || guard() !== true || !owned()) return false;
        const node = nodes().find(node => node.dataset.preferencesControl === controlId);
        if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
        node.focus({ preventScroll: true });
        return guard() === true && owned() && visible(node) && node.ownerDocument.activeElement === node;
      },
      scroll({ top, left = 0, area = 'content' }, guard) {
        if (typeof guard !== 'function' || guard() !== true || !owned() || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return false;
        const node = area === 'content' ? content : [...originalRoot.querySelectorAll('[data-preferences-area]')].find(node => node.dataset.preferencesArea === area);
        if (!node || !visible(node)) return false;
        node.scrollTop = top; node.scrollLeft = left;
        return guard() === true && owned() && visible(node) ? { top: node.scrollTop, left: node.scrollLeft } : false;
      },
    };
    const cleanup = registerView(originalWindow.id, facade);
    return () => { retired = true; if (typeof cleanup === 'function') cleanup(); else registerView(originalWindow.id, null, facade); };
  });
  $effect(() => {
    const owner = session, openSheet = sheet;
    passcode = ''; privateValues = {}; error = '';
    if (!openSheet) return;
    tick().then(() => {
      if (session !== owner || sheet !== openSheet || !live()) return;
      sheetElement?.querySelector('input:not([type="checkbox"]),select,textarea,button')?.focus();
    });
    return () => { passcode = ''; privateValues = {}; };
  });
  $effect(() => {
    const owner = sheet, fileId = owner?.values.fileId, expectedRevision = owner?.values.expectedRevision;
    profileLease = null;
    if (owner?.kind !== 'profile.confirm') return;
    untrack(() => {
      const files = profileFiles(), file = files?.find(row => row.id === fileId);
      const parents = file && profileAncestors(file, files);
      if (!file || !parents || file.revision !== expectedRevision) return;
      profileLease = { sheet: owner, container: inventory.files, files, file, revision: file.revision, content: file.content, ancestors: parents };
    });
    return () => { profileLease = null; };
  });
  $effect(() => {
    const currentPane = session?.pane, currentTab = session?.tab, node = content;
    if (!node) return;
    const top = untrack(() => retainedScroll.get(`${currentPane}:${currentTab}`));
    node.scrollTop = top ?? 0;
    pointer = null; demoProgress = 0; inkHasMarks = false; gesture = 'Try a gesture in the preview';
  });
</script>

{#snippet highlighted(text)}{#each highlights(text) as part}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}{/snippet}
{#snippet icon(name, large = false)}
  {@const sprite = nativeSprite(name, large)}
  <span class="np-icon" class:large class:np-native-grid={!!sprite} aria-hidden="true" data-icon={name}>
    {#if sprite}<span class="np-native-sprite" style={sprite}></span>
    {:else if typeof name === 'string' && name.startsWith('native-grid:')}<span title="Native icon unavailable">?</span>
    {:else if typeof name === 'string' && (name.startsWith('/') || name.startsWith('data:'))}<img src={name} alt="" />
    {:else}<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      {#if /display|desktop|screen|monitor/u.test(name ?? '')}<rect x="4" y="5" width="24" height="17" rx="2"/><path d="M16 22v5m-6 0h12"/><path d="m6 19 8-8 5 5 4-7 3 10" opacity=".5"/>
      {:else if /sound|audio|speaker/u.test(name ?? '')}<path d="M4 12h6l7-6v20l-7-6H4zM21 11c4 3 4 7 0 10m4-14c7 6 7 12 0 18"/>
      {:else if /network|wifi|internet/u.test(name ?? '')}<path d="M3 11a20 20 0 0 1 26 0M7 16a14 14 0 0 1 18 0m-14 5a8 8 0 0 1 10 0"/><circle cx="16" cy="26" r="1.5" fill="currentColor"/>
      {:else if /bluetooth/u.test(name ?? '')}<path d="m10 9 13 14-7 6V3l7 6-13 14"/>
      {:else if /user|account|family/u.test(name ?? '')}<circle cx="16" cy="10" r="6"/><path d="M5 28v-3a11 11 0 0 1 22 0v3z"/>
      {:else if /keyboard/u.test(name ?? '')}<rect x="2" y="8" width="28" height="17" rx="2"/><path d="M7 13h1m4 0h1m4 0h1m4 0h1M7 17h1m4 0h1m4 0h1m4 0h1M9 21h14"/>
      {:else if /trackpad|mouse|pointing/u.test(name ?? '')}<rect x="5" y="3" width="22" height="26" rx="4"/><path d="M5 22h22M16 7v5"/>
      {:else if /printer|print/u.test(name ?? '')}<path d="M9 11V3h14v8M9 23H4V11h24v12h-5M9 19h14v10H9z"/><circle cx="24" cy="15" r="1" fill="currentColor"/>
      {:else if /date|clock|time/u.test(name ?? '')}<circle cx="16" cy="16" r="13"/><path d="M16 7v10l6 4"/>
      {:else if /battery|energy|power/u.test(name ?? '')}<rect x="2" y="8" width="25" height="16" rx="2"/><path d="M30 13v6M16 10l-5 7h7l-4 5"/>
      {:else if /security|privacy|lock/u.test(name ?? '')}<rect x="6" y="13" width="20" height="16" rx="3"/><path d="M10 13V9a6 6 0 0 1 12 0v4M16 19v4"/>
      {:else if /notification/u.test(name ?? '')}<path d="M5 24h22l-3-5v-7a8 8 0 0 0-16 0v7zM12 28h8"/><circle cx="26" cy="6" r="4" fill="#f35b51" stroke="none"/>
      {:else if /access/u.test(name ?? '')}<circle cx="16" cy="16" r="14"/><circle cx="16" cy="7" r="2" fill="currentColor"/><path d="M7 12h18M16 10v9m0 0-6 9m6-9 6 9"/>
      {:else if /language|international|globe/u.test(name ?? '')}<circle cx="16" cy="16" r="13"/><ellipse cx="16" cy="16" rx="6" ry="13"/><path d="M3 16h26M6 8h20M6 24h20"/>
      {:else if /sharing/u.test(name ?? '')}<rect x="3" y="11" width="26" height="17" rx="2"/><path d="M16 20V3m-5 5 5-5 5 5"/>
      {:else if /ink|pen/u.test(name ?? '')}<path d="m6 26 2-8L23 3l6 6-15 15zM8 18l6 6M21 5l6 6M4 29h24"/>
      {:else if /spotlight|search/u.test(name ?? '')}<circle cx="13" cy="13" r="9"/><path d="m20 20 9 9"/>
      {:else if /store|app/u.test(name ?? '')}<path d="m8 27 12-22M24 27 12 5M4 21h24"/>
      {:else if /update|backup/u.test(name ?? '')}<path d="M27 12a12 12 0 1 0 1 9M27 4v8h-8M16 8v9l-5 3"/>
      {:else if /dock|mission/u.test(name ?? '')}<rect x="2" y="5" width="28" height="23" rx="3"/><path d="M2 20h28M8 24h2m5 0h2m5 0h2"/>
      {:else if /wallpaper|appearance|general/u.test(name ?? '')}<rect x="3" y="3" width="26" height="26" rx="5"/><path d="M3 11h26M11 11v18"/><circle cx="7" cy="7" r="1" fill="currentColor"/>
      {:else}<circle cx="16" cy="16" r="12"/><circle cx="16" cy="16" r="5"/><path d="M16 2v4m0 20v4M2 16h4m20 0h4M6 6l3 3m14 14 3 3M6 26l3-3M23 9l3-3"/>{/if}
    </svg>{/if}
  </span>
{/snippet}
{#snippet fieldInput(field, value, inSheet = false)}
  {@const disabled = (inSheet ? submitting || field.available === false : !enabled(field)) || field.readonly && ['select', 'checkbox', 'range', 'color'].includes(field.type)}
  {@const id = controlDomId((inSheet ? 'draft-' : '') + field.id)}
  {#if field.type === 'checkbox'}
    <input {id} data-preferences-control={(inSheet ? 'draft-' : '') + field.id} type="checkbox" checked={value === true} {disabled} onchange={event => inSheet ? draft(field, event) : change(field, event)} />
  {:else if field.type === 'select'}
    <select {id} data-preferences-control={(inSheet ? 'draft-' : '') + field.id} value={value} {disabled} required={field.required} onchange={event => inSheet ? draft(field, event) : change(field, event)}>
      {#each field.options ?? [] as option}<option value={optionValue(option)} disabled={option?.disabled}>{optionLabel(option)}</option>{/each}
    </select>
  {:else if field.multiline}
    <textarea {id} data-preferences-control={(inSheet ? 'draft-' : '') + field.id} value={value ?? ''} {disabled} readonly={field.readonly} required={field.required} maxlength={field.maxLength} rows={field.rows ?? 3} oninput={event => inSheet ? draft(field, event) : undefined} onchange={event => inSheet ? undefined : change(field, event)}></textarea>
  {:else}
    <input {id} data-preferences-control={(inSheet ? 'draft-' : '') + field.id} type={['range', 'number', 'color', 'password', 'email', 'url', 'date', 'time'].includes(field.type) ? field.type : 'text'} value={value ?? ''} {disabled} readonly={field.readonly} min={field.min} max={field.max} step={field.step} required={field.required} maxlength={field.maxLength} placeholder={field.placeholder} autocomplete={field.type === 'password' ? 'off' : undefined}
      oninput={event => inSheet ? draft(field, event) : undefined} onchange={event => inSheet ? undefined : change(field, event)} />
    {#if field.type === 'range'}<output for={id}>{displayValue(value)}{field.unit ?? ''}</output>{/if}
  {/if}
{/snippet}
{#snippet controlRow(control)}
  {@const value = valueOf(control)}
  <div class="np-row" class:np-list-row={control.type === 'list'} class:np-match={query && matches(control.label)} class:np-unavailable={control.available === false}>
    {#if control.type === 'list'}
      <div class="np-list-heading"><h3>{@render highlighted(control.label)}</h3>{#if control.detail}<p>{control.detail}</p>{/if}</div>
      {#if Array.isArray(value)}
        <div class="np-device-list" data-preferences-area={'list-' + control.id} role="listbox" aria-label={control.label} aria-disabled={!enabled(control)}>
          {#if control.columns?.length}<div class="np-list-columns" style={`--np-columns:${control.columns.length}`} aria-hidden="true">{#each control.columns as column}<span>{column.label}</span>{/each}</div>{/if}
          {#each value as row}
            <button type="button" class="np-device" class:selected={session.selectedId === rowId(row)} data-preferences-control={`${control.id}:${rowId(row)}`} role="option" aria-selected={session.selectedId === rowId(row)} disabled={!enabled(control) || row.available === false} onclick={() => send('select', { controlId: control.id, selectedId: rowId(row) })} onkeydown={event => listKeydown(event, control, value, row)}>
              {#if control.columns?.length}<span class="np-device-columns" style={`--np-columns:${control.columns.length}`}>{#each control.columns as column}<span>{displayValue(row[column.key])}</span>{/each}</span>
              {:else}{#if row.icon}{@render icon(row.icon)}{/if}<span><strong>{rowLabel(row)}</strong>{#if row.detail ?? row.status}<small>{row.detail ?? row.status}</small>{/if}</span>{#if row.connected}<span class="np-status-dot" aria-label="Connected"></span>{/if}{/if}
            </button>
          {:else}<p class="np-empty">{control.emptyLabel ?? 'No items configured.'}</p>{/each}
        </div>
        {#if control.rowActions?.length}<div class="np-list-actions">{#each control.rowActions as action}{@const selected = value.find(row => rowId(row) === session.selectedId)}<button data-preferences-control={action.id ?? action.actionId} disabled={action.available === false || action.protected && !session.unlocked || action.requiresSelection && !selected} class:destructive={action.destructive} onclick={() => openAction(action, action.requiresSelection ? selected : undefined)}>{action.label}</button>{/each}</div>{/if}
      {:else}<p class="np-source-unavailable">The original source for this list is unavailable.</p>{/if}
    {:else if control.type === 'action'}
      <div class="np-row-label"><strong>{@render highlighted(control.label)}</strong>{#if control.detail}<small>{control.detail}</small>{/if}</div>
      <button data-preferences-control={control.id} disabled={!enabled(control)} class:destructive={control.destructive} onclick={() => openAction(control)}>{control.buttonLabel ?? control.label}{control.sheet && !control.buttonLabel ? '…' : ''}</button>
    {:else}
      <label class="np-row-label" for={controlDomId(control.id)}><span>{@render highlighted(control.label)}</span>{#if control.detail}<small>{control.detail}</small>{/if}</label>
      <div class="np-row-value">{@render fieldInput(control, value)}{#if value === undefined}<small class="np-source-unavailable">Source unavailable</small>{/if}</div>
    {/if}
    {#if control.disclosure}<p class="np-control-disclosure">{control.disclosure}</p>{/if}
    {#if unavailableReason(control)}<p class="np-control-disclosure">{unavailableReason(control)}</p>{/if}
  </div>
{/snippet}

{#if session}
<section bind:this={root} class="native-preferences" class:np-dark={dark} class:np-qualified={qualified} class:np-classic={classic} class:np-modern={!classic && !windows} class:np-windows={windows} data-preferences-window-id={window.id} aria-label={classic ? 'System Preferences' : windows ? 'Settings' : 'System Settings'} onfocusin={observeFocus} onkeydown={keydown} onpointerdown={event => { if (!event.target.closest('.np-search,.np-classic-search-popover')) searchPopoverOpen = false; }} role="region" data-window-no-drag>
  <div class="np-shell" inert={!!sheet}>
    {#if classic}
      <header class="np-toolbar">
        <div class="np-history"><button data-preferences-control="back" aria-label="Back" disabled={session.historyIndex <= 0} onclick={() => send('history', { direction: 'back' })}>‹</button><button data-preferences-control="forward" aria-label="Forward" disabled={session.historyIndex >= session.history.length - 1} onclick={() => send('history', { direction: 'forward' })}>›</button></div>
        <button class="np-show-all" data-preferences-control="show-all" aria-label="Show All" title="Show All" onclick={() => send('navigate', { pane: 'all' })}><svg viewBox="0 0 18 14" aria-hidden="true">{#each [0, 1, 2] as x}{#each [0, 1] as y}<rect x={x * 6} y={y * 7} width="4" height="4" rx=".5"/>{/each}{/each}</svg></button>
        <span class="np-toolbar-title">{pane?.label ?? 'System Preferences'}</span>
        <label class="np-search"><span aria-hidden="true">⌕</span><input data-preferences-control="search" aria-label="Search preferences" placeholder="Search" type="search" value={session.query} onfocus={() => searchPopoverOpen = true} oninput={event => { searchPopoverOpen = true; send('search', { query: event.currentTarget.value }); }}/></label>
        {#if query && searchPopoverOpen}<div class="np-classic-search-popover" role="region" aria-label="Matching preferences">{#each results as result}<button data-preferences-control={`classic-result-${result.pane.id}-${result.control.id}`} onclick={() => selectResult(result)}><strong>{@render highlighted(result.control.label)}</strong><small>{result.pane.label}</small></button>{:else}<p>No settings match “{session.query}”.</p>{/each}</div>{/if}
      </header>
    {:else}
      <aside class="np-sidebar" aria-label="Settings categories">
        <h1>{windows ? 'Settings' : 'System Settings'}</h1>
        <label class="np-search"><span aria-hidden="true">⌕</span><input data-preferences-control="search" aria-label="Find a setting" placeholder={windows ? 'Find a setting' : 'Search'} type="search" value={session.query} oninput={event => send('search', { query: event.currentTarget.value })}/></label>
        {#if !windows && panes.some(row => row.id === 'icloud' && row.available)}
          <button class="np-account-summary" class:selected={pane?.id === 'icloud'} data-preferences-control="pane-icloud" onclick={() => send('navigate', { pane: 'icloud' })}>{@render icon('account')}<span><strong>{nativePreferencesState.configuration.cloud.signedIn ? nativePreferencesState.configuration.cloud.accountName : qualified ? 'Sign in to your Apple Account' : 'Sign in with your Apple ID'}</strong><small>{qualified ? 'Apple Account' : 'Apple ID'} · Local scene</small></span></button>
        {/if}
        <nav>
          {#if windows}
            {#each categories as category}{@const first = panes.find(row => row.category === category && row.available)}
              <button class:selected={pane?.category === category} data-preferences-control={'category-' + category} aria-current={pane?.category === category ? 'page' : undefined} disabled={!first} onclick={() => first && send('navigate', { pane: first.id })}>{@render icon(category)}<span>{@render highlighted(categoryLabels[category])}</span></button>
            {/each}
          {:else}
            {#each panes.filter(row => row.available && row.id !== 'icloud') as row}<button class:selected={session.pane === row.id} class:np-search-hit={query && (matches(row.label) || results.some(result => result.pane.id === row.id))} data-preferences-control={'pane-' + row.id} aria-current={session.pane === row.id ? 'page' : undefined} onclick={() => send('navigate', { pane: row.id })}>{@render icon(row.icon)}<span>{@render highlighted(row.label)}</span></button>{/each}
          {/if}
        </nav>
      </aside>
    {/if}
    <main bind:this={content} class="np-content" data-preferences-area="content" onscroll={observeScroll}>
      {#if !classic && query}
        <section class="np-search-results" aria-label="Search results"><h2>Search results</h2>{#each results as result}<button data-preferences-control={`result-${result.pane.id}-${result.tab.id}-${result.control.id}`} onclick={() => selectResult(result)}>{@render icon(result.pane.icon)}<span><strong>{@render highlighted(result.control.label)}</strong><small>{@render highlighted(result.pane.label)}{result.tab.label ? ' › ' + result.tab.label : ''}</small></span><span aria-hidden="true">›</span></button>{:else}<p>No settings match “{session.query}”.</p>{/each}</section>
      {/if}
      {#if classic && !pane}
        <div class="np-icon-grid" aria-label="All preferences">
          {#each gridGroups as group}<section class="np-grid-group" aria-label={group || 'Preferences'}>{#if group}<h2>{group}</h2>{/if}<div>{#each panes.filter(row => row.available && (row.group ?? '') === group) as row}{@const hit = !query || matches(row.label) || results.some(result => result.pane.id === row.id)}<button class:np-dimmed={!hit} class:np-grid-hit={!!query && hit} data-preferences-control={'pane-' + row.id} onclick={() => send('navigate', { pane: row.id })}>{@render icon(row.icon, true)}<span>{@render highlighted(row.label)}</span>{#if query && hit}<i aria-hidden="true"></i>{/if}</button>{/each}</div></section>{/each}
        </div>
      {:else if pane}
        <header class="np-pane-heading">{#if !classic}<button class="np-pane-back" data-preferences-control="back" aria-label="Back" disabled={session.historyIndex <= 0} onclick={() => send('history', { direction: 'back' })}>‹</button>{/if}{#if classic}{@render icon(pane.icon, true)}{/if}<h2>{#if windows}<span class="np-category-breadcrumb">{categoryLabels[pane.category]} <span aria-hidden="true">›</span></span>{/if}{pane.label}</h2></header>
        {#if windows && siblingPanes.length > 1}<nav class="np-related-panes" aria-label={categoryLabels[pane.category]}>{#each siblingPanes as sibling}<button data-preferences-control={'pane-' + sibling.id} class:selected={session.pane === sibling.id} disabled={sibling.available === false} aria-current={session.pane === sibling.id ? 'page' : undefined} onclick={() => send('navigate', { pane: sibling.id })}>{sibling.label}</button>{/each}</nav>{/if}
        {#if pane.disclosure}<p class="np-pane-disclosure">{pane.disclosure}</p>{/if}
        {#if pane.tabs?.length > 1}<div class="np-tabs" role="tablist" aria-label={pane.label}>{#each pane.tabs as tab, index}<button id={controlDomId('tab-' + tab.id)} data-preferences-control={'tab-' + tab.id} data-preferences-tab-index={index} role="tab" aria-selected={session.tab === tab.id} aria-controls={controlDomId('pane-content')} tabindex={session.tab === tab.id ? 0 : -1} class:selected={session.tab === tab.id} onclick={() => send('tab', { tab: tab.id })} onkeydown={event => tabKeydown(event, index)}>{tab.label}</button>{/each}</div>{/if}
        <div id={controlDomId('pane-content')} role={pane.tabs?.length > 1 ? 'tabpanel' : undefined} aria-labelledby={pane.tabs?.length > 1 ? controlDomId('tab-' + session.tab) : undefined} class="np-pane-body">
          {#if pane.id === 'software-update' && session.tab !== 'advanced'}
            <section class="np-update-status" aria-label="Local software update status"><header>{@render icon('software-update', true)}<div><h3>{updateStatusLabels[updates.status] ?? updates.status}</h3><p>This catalog and every package are authored locally. No network download, host installation, or OS version change occurs.</p></div></header>
              {#if updates.status === 'downloading'}<label class="np-update-progress"><span>Actual local byte preparation · {updates.progress}%</span><progress max="100" value={updates.progress} aria-label="Local package bytes prepared"></progress></label>{/if}
              {#if updates.lastCheck > 0}<p class="np-update-time">Last checked at authored scene timestamp {updates.lastCheck}.</p>{/if}
              {#if updates.packageFileId}{@const packageFile = profileFiles()?.find(file => file.id === updates.packageFileId && file.revision === updates.packageRevision && profileAncestors(file, profileFiles()))}{#if packageFile}<p class="np-update-package">Prepared original File: <strong>{packageFile.name}</strong> · revision {packageFile.revision}</p>{:else}<p class="np-error">The prepared package’s original File or expected revision is unavailable.</p>{/if}{/if}
              {#each updateManifests as manifest}<article class="np-update-details"><h4>{manifest.title}</h4><dl><dt>Version reference</dt><dd>{manifest.release.version}</dd>{#if manifest.release.date}<dt>Release reference date</dt><dd>{manifest.release.date}</dd>{/if}<dt>Package format</dt><dd>{manifest.extension} · {manifest.scope}</dd><dt>Scene status</dt><dd>{updates.installedIds.includes(manifest.id) ? 'Applied to this scene' : updates.selectedUpdateId === manifest.id ? 'Selected' : 'Available in the authored catalog'}</dd></dl><p>{manifest.release.qualification}</p><p>{manifest.detail}</p><h5>Disclosed local changes</h5><ul>{#each manifest.patch as patch}<li><span>{allControls.find(row => row.control.id === patch.path)?.control.label ?? patch.path}</span><strong>{displayValue(patch.value)}</strong></li>{/each}</ul><p class="np-release-reference">Source reference: {manifest.release.source}</p></article>{:else}<p class="np-source-unavailable">No authored update manifest is available for this profile.</p>{/each}
            </section>
          {/if}
          {#if pane.id === 'notifications' && notificationComponent && shared.notifications?.preferences}
            {@const Notifications = notificationComponent}<Notifications {profile} {window} preferences={shared.notifications.preferences} selectedAppId={session.selectedId} embedded={true} hostSession={session} ownership={notificationOwnership} execute={notificationExecute ?? execute} registerView={registerNotificationView}/>
          {:else}
            {#each groups as group}<section class="np-control-group" aria-label={group || pane.label}>{#if group}<h3>{group}</h3>{/if}<div>{#each controls.filter(control => (control.group ?? '') === group) as control (control.id)}{@render controlRow(control)}{/each}</div></section>{/each}
          {/if}
          {#if pane.available && ['trackpad', 'ink'].includes(pane.id)}
            <section class="np-demo" aria-label={pane.id === 'ink' ? 'Local handwriting canvas' : 'Trackpad gesture preview'}>
              {#if pane.id === 'trackpad'}<div class="np-demo-screen"><div style={`transform:translateX(${demoProgress * 45}px)`}><span></span><span></span><span></span></div></div>{/if}
              <canvas bind:this={demoCanvas} class:paper-lines={pane.id === 'ink' && nativePreferencesState.configuration.ink.paperLines} lang={pane.id === 'ink' ? nativePreferencesState.configuration.ink.language : undefined} width="440" height="170" tabindex="0" data-preferences-control={pane.id + '-demo'} aria-disabled={pane.id === 'ink' && !nativePreferencesState.configuration.ink.enabled} aria-label={pane.id === 'ink' ? 'Draw handwriting with a pointer' : 'Drag to preview swipe and scroll gestures'} onpointerdown={startDemo} onpointermove={moveDemo} onpointerup={endDemo} onpointercancel={endDemo} ondblclick={() => { if (pane.id === 'ink' && nativePreferencesState.configuration.ink.enabled && nativePreferencesState.configuration.ink.gestures) clearInk(); }}></canvas>
              {#if pane.id === 'ink'}<div class="np-demo-caption"><span>{nativePreferencesState.configuration.ink.enabled ? 'Local handwriting practice. Strokes are not recognized or sent to the host.' + (nativePreferencesState.configuration.ink.gestures ? ' Double-click or double-tap to clear the canvas.' : '') : 'Enable Ink above to practice handwriting locally.'}</span><button data-preferences-control="ink-clear" disabled={!inkHasMarks} onclick={clearInk}>Clear</button></div>{:else}<p class="np-demo-caption" role="status">{gesture} · Preview only; no host pointing-device changes.</p>{/if}
            </section>
          {/if}
          {#if pane.available === false}<p class="np-source-unavailable">This pane is not available for this profile or its original source.</p>{/if}
        </div>
      {:else if !classic && !query}<p class="np-empty">Select a settings category.</p>{/if}
      {#if session.message}<p class="np-message" role="status">{session.message}</p>{/if}
      {#if error}<p class="np-error" role="alert">{error}</p>{/if}
      {#if pane && !classic}<div class="np-pane-help"><button class="np-help-button" data-preferences-control="help" aria-label={pane.label + ' Help'} onclick={() => send('sheet', { kind: 'help' })}>?</button></div>{/if}
    </main>
    {#if classic && pane}<footer class="np-classic-footer">{#if protectedPane}<button class="np-unlock" data-preferences-control="unlock" onclick={() => session.unlocked ? send('action', { actionId: 'lock', values: {} }) : send('sheet', { kind: 'authenticate' })}>{@render icon('lock')}<span>{session.unlocked ? 'Click the lock to prevent changes.' : 'Click the lock to make changes.'}</span></button>{/if}<span class="np-local-label">Changes apply to this local desktop.</span><button class="np-help-button" data-preferences-control="help" aria-label={pane.label + ' Help'} onclick={() => send('sheet', { kind: 'help' })}>?</button></footer>{/if}
    {#if !classic && protectedPane && !session.unlocked}<footer class="np-modern-lock"><button data-preferences-control="unlock" onclick={() => send('sheet', { kind: 'authenticate' })}>Unlock to make changes…</button></footer>{/if}
  </div>
  {#if qualified}<aside class="np-version-disclosure">Golden Gate 27 is fictional. This surface uses the nearest documented macOS 26 Settings organization, not verified macOS 27 pixels.</aside>{/if}
  {#if sheet}
    <div class="np-sheet-shade"><form bind:this={sheetElement} class="np-sheet" role="dialog" aria-modal="true" aria-labelledby={controlDomId('sheet-title')} onsubmit={confirm}>
      <header>{@render icon(authentication ? 'lock' : pane?.icon)}<div><h2 id={controlDomId('sheet-title')}>{authentication ? (classic ? 'System Preferences' : 'Settings') + ' is trying to unlock settings.' : help ? (pane?.label ?? 'Preferences') + ' Help' : sheetAction?.title ?? sheetAction?.label ?? sheet.kind}</h2>{#if authentication}<p>Enter the authored local scene passcode. It is never stored in the saved scene and does not authenticate with the host.</p>{:else if sheetAction?.confirmation ?? sheetAction?.detail}<p>{sheetAction.confirmation ?? sheetAction.detail}</p>{/if}</div></header>
      {#if authentication}
        <label class="np-draft-row" for={controlDomId('authenticate-passcode')}><span>Password:</span><input id={controlDomId('authenticate-passcode')} data-preferences-control="authenticate-passcode" type="password" bind:value={passcode} autocomplete="off" required disabled={submitting}/></label>
      {:else if help}
        <div class="np-help-content"><p>Choose a category, then edit its controls. Changes apply only to the authored local desktop, its original devices, documents, and configuration. No host settings, online accounts, network connections, purchases, or biometric services are changed.</p><p>Use search to highlight matching preferences. Back and Forward return to panes you have visited. Device and account lists operate on the selected original row; actions with options open a sheet, and Apply commits its retained draft.</p><p>The initial authored local unlock passcode is <strong>scene</strong>. Password fields are transient and are not saved with the scene.</p>{#if pane?.disclosure}<p>{pane.disclosure}</p>{/if}{#if qualified}<p>Golden Gate 27 is fictional; visual organization is qualified against documented macOS 26, not certified macOS 27 pixels.</p>{/if}</div>
      {:else if sheet.kind === 'profile.confirm'}
        {#if profilePreview?.profile}{@const inspected = profilePreview.profile}
          <section class="np-profile-inspection" aria-label="Configuration profile contents">
            <h3>{inspected.name}</h3>
            <dl><dt>Identifier</dt><dd>{inspected.id}</dd>{#if inspected.organization}<dt>Organization</dt><dd>{inspected.organization}</dd>{/if}<dt>Source File</dt><dd>{profileLease.file.name} · {sheet.values.fileId}</dd><dt>Source revision</dt><dd>{sheet.values.expectedRevision}</dd></dl>
            {#if inspected.description}<p>{inspected.description}</p>{/if}
            <h4>Settings to apply</h4><ul>{#each inspected.settings as setting}<li><span>{allControls.find(row => row.control.id === setting.controlId)?.control.label ?? setting.controlId}</span><strong>{displayValue(setting.value)}</strong></li>{/each}</ul>
            <p>These typed values come from the original XML profile. Installation changes only this local scene.</p>
            {#if windows}<p class="np-pane-disclosure">Local XML configuration-profile equivalent. This is not native Windows MDM enrollment or a macOS management service.</p>{/if}
          </section>
        {:else}<p class="np-error" role="alert">{profilePreview?.error ?? 'The original profile is unavailable.'}</p>{/if}
      {:else if sheetAction}
        {#each sheetAction.fields ?? [] as field}<div class="np-draft-row"><label for={controlDomId('draft-' + field.id)}>{field.label}</label><div>{@render fieldInput(field, field.type === 'password' ? privateValues[field.id] ?? '' : sheet.values[field.id], true)}{#if field.detail}<small>{field.detail}</small>{/if}</div></div>{/each}
      {:else}<p class="np-source-unavailable">The action metadata for this sheet is unavailable. No changes can be submitted.</p>{/if}
      {#if sheet.error || error}<p class="np-error" role="alert">{sheet.error || error}</p>{/if}
      <footer><button type="button" data-preferences-control="sheet-cancel" disabled={submitting} onclick={() => { passcode = ''; privateValues = {}; send('sheet', { kind: 'none' }); }}>{help ? 'Done' : 'Cancel'}</button>{#if !help}<button class="np-primary" class:destructive={sheetAction?.destructive} data-preferences-control="sheet-confirm" type="submit" disabled={submitting || !authentication && !sheetAction || sheet.kind === 'profile.confirm' && !profilePreview?.profile}>{submitting ? 'Applying…' : authentication ? 'Unlock' : sheetAction?.confirmLabel ?? 'Apply'}</button>{/if}</footer>
    </form></div>
  {/if}
</section>
{:else}<section class="native-preferences np-unmounted" aria-label="Preferences unavailable"><p>The original preferences window session is unavailable.</p></section>{/if}
