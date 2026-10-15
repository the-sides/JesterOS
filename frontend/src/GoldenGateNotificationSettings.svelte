<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import AppIcon from './AppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  import Windows11Icon from './Windows11Icon.svelte';

  let { profile, window, preferences, selectedAppId = '', execute, registerView,
    embedded = false, hostSession = null, ownership = null } = $props();
  const renderer = $derived(profile.renderer);
  const windows = $derived(renderer === 'windows11');
  const classic = $derived(renderer === 'high-sierra' || renderer === 'mojave');
  const noneStyle = $derived(classic || renderer === 'sonoma');
  const golden = $derived(renderer === 'golden-gate');
  const Icon = $derived(windows ? Windows11Icon : renderer === 'high-sierra' ? HighSierraAppIcon : classic ? AppIcon : golden ? GoldenGateIcon : SonomaIcon);
  let panel = $state(null);
  let ownerWindow = null, ownerRoot = null, ownerFrame = null, disposed = false, writtenScroll = null;
  let ownerSession = null, ownerOwnership = null, ownerEmbedded = false;
  let lastError = $state(null);
  const temporary = 'temporary', persistent = 'persistent';
  const previews = ['default', 'always', 'when-unlocked', 'never'];
  const resolve = $derived.by(() => {
    const row = String(selectedAppId || '').length <= 128 && pointerSafe(selectedAppId)
      ? preferences?.applications?.find?.(application => application?.appId === selectedAppId) ?? null : null;
    return { row, app: row?.appId ?? (pointerSafe(selectedAppId) ? selectedAppId : ''),
      allow: row?.allow ?? true, desktop: row?.desktop ?? true,
      center: row?.center ?? true, badges: row?.badges ?? true, sound: row?.sound ?? true, style: row?.style ?? temporary,
      previews: row?.previews ?? 'default', rowExists: Boolean(row) };
  });
  function pointerSafe(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
      && !Object.getOwnPropertyNames(Object.prototype).includes(value);
  }
  function current() {
    if (disposed || window !== ownerWindow || embedded !== ownerEmbedded) return false;
    let hostCurrent = false;
    try {
      hostCurrent = embedded
        ? hostSession !== null && hostSession === ownerSession && ownership === ownerOwnership
          && typeof ownership === 'function' && ownership() === true
        : window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'notifications';
    } catch { return false; }
    return Boolean(hostCurrent && panel?.isConnected && panel.dataset.windowId === window.id
      && panel.closest('[data-session-scene]') === ownerRoot && ownerRoot?.isConnected
      && panel.closest('.managed-window[data-window-id]') === ownerFrame && ownerFrame?.isConnected
      && ownerFrame.dataset.windowId === window.id);
  }
  function live() {
    return Boolean(current() && !window.minimized && !ownerFrame.classList.contains('inactive')
      && !panel.closest('[inert], [aria-hidden="true"]') && panel.getClientRects().length
      && panel.clientWidth > 0 && panel.clientHeight > 0 && getComputedStyle(panel).visibility === 'visible');
  }
  function control(id) {
    return id === 'panel' ? panel : [...(panel?.querySelectorAll('[data-application-settings-control]') ?? [])]
      .find(node => node.dataset.applicationSettingsControl === id) ?? null;
  }
  function owned(node) {
    if (!live() || !node?.isConnected || (node !== panel && !panel.contains(node)) || node.disabled
      || node.closest('[inert], [aria-hidden="true"]') || !node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect(), viewport = globalThis.window.visualViewport;
    let left = Math.max(rect.left, viewport?.offsetLeft ?? 0), top = Math.max(rect.top, viewport?.offsetTop ?? 0);
    let right = Math.min(rect.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth));
    let bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight));
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (parent.hidden || parent.inert || style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
      if (parent === node) continue;
      const scaleX = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
      const scaleY = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
      if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + parent.clientLeft * scaleX);
        right = Math.min(right, bounds.left + (parent.clientLeft + parent.clientWidth) * scaleX);
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + parent.clientTop * scaleY);
        bottom = Math.min(bottom, bounds.top + (parent.clientTop + parent.clientHeight) * scaleY);
      }
    }
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  function available(id = 'panel') { return owned(control(id)); }
  function controlIds() {
    return live() ? ['panel', ...[...panel.querySelectorAll('[data-application-settings-control]')]
      .filter(node => node !== panel && node.isConnected && !node.disabled && node.getClientRects().length)
      .map(node => node.dataset.applicationSettingsControl)] : [];
  }
  function focusedControl() {
    const node = panel?.ownerDocument.activeElement;
    const id = node === panel ? 'panel' : node?.dataset.applicationSettingsControl;
    return id && control(id) === node && owned(node) ? id : null;
  }
  function focus(id = 'panel') {
    if (!live()) return false;
    const original = panel, originalWindow = window, node = control(id);
    if (!node?.isConnected || node.disabled || !node.getClientRects().length) return false;
    if (node !== panel) {
      const rect = node.getBoundingClientRect(), clip = panel.getBoundingClientRect();
      const scaleX = panel.offsetWidth ? clip.width / panel.offsetWidth : 1;
      const scaleY = panel.offsetHeight ? clip.height / panel.offsetHeight : 1;
      if (scaleX <= 0 || scaleY <= 0) return false;
      const top = clip.top + (panel.clientTop + 4) * scaleY, bottom = clip.top + (panel.clientTop + panel.clientHeight - 4) * scaleY;
      const left = clip.left + (panel.clientLeft + 4) * scaleX, right = clip.left + (panel.clientLeft + panel.clientWidth - 4) * scaleX;
      panel.scrollTop += (rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0) / scaleY;
      panel.scrollLeft += (rect.left < left ? rect.left - left : rect.right > right ? rect.right - right : 0) / scaleX;
      writtenScroll = { panel, top: panel.scrollTop, left: panel.scrollLeft };
    }
    if (!owned(node)) return false;
    node.focus({ preventScroll: true });
    return panel === original && window === originalWindow && control(id) === node && document.activeElement === node && owned(node);
  }
  function scrollPosition() { return current() ? { top: panel.scrollTop, left: panel.scrollLeft } : null; }
  function scrollTop() { return scrollPosition()?.top ?? null; }
  function scroll({ top, left = 0, observe = false }) {
    if (!owned(panel) || !Number.isFinite(top) || top < 0 || !Number.isFinite(left) || left < 0) return null;
    if (!observe) {
      panel.scrollTo({ top, left, behavior: 'instant' });
      writtenScroll = { panel, top: panel.scrollTop, left: panel.scrollLeft };
    }
    return { top: panel.scrollTop, left: panel.scrollLeft };
  }
  async function scrollTo(top) {
    const original = panel, originalWindow = window;
    if (!scroll({ top })) return null;
    await tick();
    return panel === original && window === originalWindow && owned(panel) ? panel.scrollTop : null;
  }
  const facade = { element: () => current() ? panel : null, available, controlIds, focusedControl, focus, reconcile, scrollPosition, scroll, scrollTop, scrollTo };
  let retire = null;
  onMount(() => {
    ownerWindow = window; ownerRoot = panel.closest('[data-session-scene]'); ownerFrame = panel.closest('.managed-window[data-window-id]');
    ownerSession = hostSession; ownerOwnership = ownership; ownerEmbedded = embedded;
    const returned = registerView?.(window.id, facade);
    if (typeof returned === 'function') retire = returned;
  });
  onDestroy(() => { disposed = true; if (typeof retire === 'function') retire(); else registerView?.(window.id, null, facade); retire = null; });
  async function reconcile() {
    await tick();
    if (current()) {
      panel.dataset.lastNotificationError = lastError ?? '';
      for (const node of panel.querySelectorAll('[data-application-settings-control]')) {
        const id = node.dataset.applicationSettingsControl;
        if (id.startsWith('notifications-app:')) node.checked = node.value === selectedAppId;
        else if (id === 'notifications-desktop' && node.type === 'radio') node.checked = !resolve.allow || !resolve.desktop;
        else if (['notifications-allow', 'notifications-desktop', 'notifications-center', 'notifications-badges', 'notifications-sound'].includes(id)) node.checked = resolve[id.slice(14)];
        else if (id === 'notifications-style') node.checked = node.value === resolve.style && (!noneStyle || resolve.allow && resolve.desktop);
        else if (id === 'notifications-previews') node.value = resolve.previews;
        else if (id === 'notifications-global-previews') node.value = preferences.showPreviews;
        else if (id === 'notifications-dnd') node.checked = preferences.doNotDisturb;
      }
    }
    return Boolean(panel?.isConnected);
  }
  async function request(event, command, target, payload = {}) {
    const node = event.currentTarget;
    try {
      if (owned(node)) {
        const result = await execute({ command, target, payload });
        if (!current()) return;
        if (result?.status === 'rejected') lastError = result.error?.message ?? 'Notification settings could not apply that change.';
        else lastError = null;
      }
    } catch (cause) { if (current()) lastError = cause?.message ?? 'Notification settings could not apply that change.'; }
    finally { await reconcile(); }
  }
  function chooseApp(event) { return request(event, 'notifications.settings.select', { windowId: window.id, appId: pointerSafe(event.currentTarget.value) ? event.currentTarget.value : String(event.currentTarget.value) }); }
  function setApp(event, field) { return request(event, 'notifications.settings.configure', { windowId: window.id, appId: resolve.app }, { configuration: { [field]: event.currentTarget.type === 'checkbox' ? Boolean(event.currentTarget.checked) : event.currentTarget.value } }); }
  function setStyle(event) {
    if (!noneStyle) return setApp(event, 'style');
    const configuration = event.currentTarget.value === 'none' ? { desktop: false }
      : { allow: true, desktop: true, style: event.currentTarget.value };
    return request(event, 'notifications.settings.configure', { windowId: window.id, appId: resolve.app }, { configuration });
  }
  function setPreviews(event) { return request(event, 'notifications.settings.global.configure', { windowId: window.id }, { showPreviews: event.currentTarget.value }); }
  function setDnd(event) { return request(event, 'notifications.dnd.set', {}, { enabled: Boolean(event.currentTarget.checked) }); }
  function observeScroll() {
    const written = writtenScroll; writtenScroll = null;
    if (!owned(panel) || written?.panel === panel && written.top === panel.scrollTop && written.left === panel.scrollLeft) return;
    void execute({ command: 'system.panel.scroll', target: { windowId: window.id },
      payload: { top: panel.scrollTop, left: panel.scrollLeft, observe: true } });
  }
</script>

<section class="notification-settings" class:classic class:windows class:golden data-notification-profile={renderer} bind:this={panel} data-notification-settings data-window-id={window.id} data-application-settings="notifications"
  data-system-panel="settings-notifications" data-application-settings-control="panel" data-application-panel-scroll data-notification-settings-scroll
  aria-label="Notification settings" tabindex="-1" onscroll={observeScroll}>
  <div class="page">
    <header><p class="crumb">{windows ? 'System' : classic ? 'System Preferences' : 'System Settings'}</p><h1>Notifications</h1></header>
    {#if lastError}<p class="error" role="alert">{lastError}</p>{/if}
    <div class="settings-layout">
    <aside class="application-sidebar" aria-label="Applications">
    <h2>Application list</h2>
    <article class="card apps">
      {#if !profile.applications || Object.keys(profile.applications).length === 0}<p class="description">No registered applications expose notification preferences.</p>{:else}
        {#each Object.entries(profile.applications) as [appId, application], index (appId)}
          <label class="app-row{index === 0 ? ' first' : ''}">
            <span class="app-icon"><Icon name={application.icon} assets={profile.assets} /></span>
            <span class="app-name">{application.name}</span>
            <input type="radio" name={`notification-app-${window.id}`} value={appId} data-application-settings-control={`notifications-app:${appId}`}
              checked={ selectedAppId === appId } onchange={chooseApp} />
          </label>
        {/each}
      {/if}
    </article>
    </aside>
    <div class="settings-detail">

    <h2>Selected app</h2>
    {#if resolve.app}
      <article class="card app-settings">
        <strong class="app-title">{profile.applications?.[resolve.app]?.name ?? resolve.app}</strong>
        {#if !classic}
        <label class="setting-row" for={`notify-allow-${window.id}`}><span><strong>Allow notifications</strong><small>Permitted apps appear in Notification Center and may show temporary or persistent banners.</small></span>
          <input id={`notify-allow-${window.id}`} type="checkbox" role="switch" data-application-settings-control="notifications-allow" checked={resolve.allow}
            onchange={event => setApp(event, 'allow')} /></label>
        {#if !noneStyle}
        <label class="setting-row" for={`notify-desktop-${window.id}`}><span><strong>{windows ? 'Show notification banners' : 'Show on desktop'}</strong><small>Permit banner or alert presentation on the desktop itself.</small></span>
          <input id={`notify-desktop-${window.id}`} type="checkbox" role="switch" data-application-settings-control="notifications-desktop" checked={resolve.desktop}
            disabled={!resolve.allow} onchange={event => setApp(event, 'desktop')} /></label>
        {/if}
        {/if}
        <label class="setting-row" for={`notify-center-${window.id}`}><span><strong>Show in Notification Center</strong><small>Keep delivered notifications in this local center list.</small></span>
          <input id={`notify-center-${window.id}`} type="checkbox" role="switch" data-application-settings-control="notifications-center" checked={resolve.center}
            disabled={!resolve.allow} onchange={event => setApp(event, 'center')} /></label>
        <label class="setting-row" for={`notify-badges-${window.id}`}><span><strong>{windows ? 'Local per-app taskbar badge policy' : classic ? 'Badge app icon' : 'Badge application icon'}</strong><small>{windows ? 'This scene policy gates the app’s actual unread taskbar badge. Windows’ native taskbar badge setting is global, not this per-app control.' : 'Show the app’s actual unread count on its Dock icon.'}</small></span>
          <input id={`notify-badges-${window.id}`} type="checkbox" role={classic ? undefined : 'switch'} data-application-settings-control="notifications-badges" checked={resolve.badges}
            disabled={!resolve.allow} onchange={event => setApp(event, 'badges')} /></label>
        <label class="setting-row" for={`notify-sound-${window.id}`}><span><strong>{windows ? 'Play a sound when a notification arrives' : classic ? 'Play sound for notifications' : 'Play sound for notification'}</strong><small>Scene audio also requires the app’s sound intent and the master audio controls. Browser playback may be unavailable.</small></span>
          <input id={`notify-sound-${window.id}`} type="checkbox" role={classic ? undefined : 'switch'} data-application-settings-control="notifications-sound" checked={resolve.sound}
            disabled={!resolve.allow} onchange={event => setApp(event, 'sound')} /></label>
        <div class="setting-row style-row" id={`notify-style-${window.id}`}>
          <span><strong>Notification style</strong><small>Temporary banners clear on their own; persistent alerts remain until dismissed.</small></span>
          <div class="segmented" role="radiogroup" aria-label="Notification style">
            {#if noneStyle}<label><input type="radio" value="none" checked={!resolve.allow || !resolve.desktop} disabled={!classic && !resolve.allow}
              data-application-settings-control="notifications-desktop" name={`notify-style-${window.id}`} onchange={setStyle} /><span class="style-thumbnail none" aria-hidden="true"></span>None</label>{/if}
            <label><input type="radio" value={temporary} checked={resolve.style === temporary && (!noneStyle || resolve.allow && resolve.desktop)} disabled={!classic && !resolve.allow}
              data-application-settings-control="notifications-style" name={`notify-style-${window.id}`} onchange={setStyle} /><span class="style-thumbnail temporary" aria-hidden="true"><i></i><i></i><i></i></span>{windows || golden ? 'Temporary' : 'Banners'}</label>
            <label><input type="radio" value={persistent} checked={resolve.style === persistent && (!noneStyle || resolve.allow && resolve.desktop)} disabled={!classic && !resolve.allow}
              data-application-settings-control="notifications-style" name={`notify-style-${window.id}`} onchange={setStyle} /><span class="style-thumbnail persistent" aria-hidden="true"><i></i><i></i><i></i></span>{windows || golden ? 'Persistent' : 'Alerts'}</label>
          </div>
        </div>
        <div class="setting-row previews-row" id={`notify-previews-${window.id}`}>
          <span><strong>{windows ? 'Local simulation preview policy' : 'Show previews'}</strong><small>{windows ? 'These shared preview choices are not Windows’ native lock-screen-content checkbox. Default uses the local global policy below.' : 'Defaults to the global setting below.'}</small></span>
          <select disabled={!resolve.allow} data-application-settings-control="notifications-previews" value={resolve.previews}
            onchange={event => setApp(event, 'previews')}>
            {#each previews as option}<option value={option}>{option === 'default' ? 'Default' : option === 'when-unlocked' ? 'When Unlocked' : option === 'always' ? 'Always' : 'Never'}</option>{/each}
          </select>
        </div>
      </article>
    {:else}
      <p class="description">Choose an application above to adjust whether it may notify, where its notifications appear, and whether previews are shown.</p>
    {/if}

    <h2>{classic || windows ? 'Do Not Disturb & local privacy policy' : 'Global'}</h2>
    <article class="card globals">
      <div class="setting-row" id={`notify-global-previews-${window.id}`}>
        <span><strong>{classic || windows ? 'Local simulation privacy: show previews' : 'Show previews'}</strong><small>{classic ? 'This shared simulation policy is not a native global preview control in classic System Preferences. ' : windows ? 'This shared simulation policy is not a native Windows global preview selector. ' : ''}When Unlocked hides notification content until this scene session is unlocked; Never hides titles and bodies everywhere.</small></span>
        <select data-application-settings-control="notifications-global-previews" value={preferences.showPreviews}
          onchange={event => setPreviews(event)}>
          {#each previews.slice(1) as option}<option value={option}>{option === 'always' ? 'Always' : option === 'when-unlocked' ? 'When Unlocked' : 'Never'}</option>{/each}
        </select>
      </div>
      <div class="setting-row dnd-row" id={`notify-dnd-${window.id}`}>
        <span><strong>Do Not Disturb</strong><small>Local quick control for this scene session; desktop banners stay silent while enabled and records remain in Notification Center.</small></span>
        <div class="dnd-status"><span class="indicator{preferences.doNotDisturb ? ' on' : ''}" aria-hidden="true">◐</span><span class="status-text">{preferences.doNotDisturb ? 'On' : 'Off'}</span>
          <input type="checkbox" role="switch" data-application-settings-control="notifications-dnd" checked={preferences.doNotDisturb}
            onchange={event => setDnd(event)} /></div>
      </div>
    </article>
    <p class="description">{windows ? 'Do Not Disturb silences desktop toasts in this scene. Use the moon control in Notification Center or the switch above.' : 'Option-click the menu-bar date/time to toggle this scene’s Do Not Disturb. This native shortcut does not change host Focus settings.'}</p>
    {#if windows}<p class="description">Temporary/persistent timing and preview controls are local simulation preferences; Windows does not expose the same per-app Banners/Alerts selector as macOS.</p>{/if}
    <p class="boundary">These preferences belong to this local simulated desktop. Badges use real local unread records, and permitted sounds use scene audio, not host-system notification delivery. No host badges, critical alerts, time-sensitive delivery, mirroring, or background services are modeled here.</p>
    </div>
    </div>
  </div>
</section>

<style>
  .notification-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  h2 { font-size:13px; margin:20px 4px 7px; font-weight:650; }
  .card { margin-bottom:12px; padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  strong { font-weight:650; } small { display:block; margin-top:2px; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  .apps { padding:6px 8px; } .app-row { display:flex; padding:8px 4px; align-items:center; gap:10px; cursor:default; } .first { border-top:0; } .app-row + .app-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); }
  .app-icon { display:block; flex:0 0 22px; width:22px; } .app-icon :global(svg) { width:100%; height:100%; }
  .app-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  input[type='radio'] { flex-shrink:0; margin:0; cursor:default; }
  .setting-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; min-width:0; } .setting-row + .setting-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); } .setting-row span { min-width:0; }
  input[type='checkbox'],input[type='radio'] { cursor:default; }
  input[type='checkbox'] { flex-shrink:0; appearance:none; position:relative; width:34px; height:20px; margin:0; border:0; border-radius:12px; background:var(--appearance-menu-disabled,#979797); }
  input[type='checkbox']::after { content:''; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:white; box-shadow:0 1px 3px #0003; }
  input[type='checkbox']:checked { background:var(--appearance-accent,#0878ef); } input[type='checkbox']:checked::after { left:17px; }
  input[type='checkbox']:disabled { opacity:.45; } input[type='checkbox']:not(:disabled) { cursor:default; }
  .segmented { display:flex; flex-shrink:0; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:9px; overflow:hidden; }
  .segmented label { display:block; padding:5px 12px; font-size:12px; cursor:default; color:inherit; }
  .segmented label + label { border-left:1px solid var(--appearance-soft-border,#dcd8d3); }
  .segmented input { margin:0 6px 1px 0; }
  .app-settings .setting-row { flex-wrap:wrap; }
  select { box-sizing:border-box; max-width:100%; min-width:0; padding:4px 8px; min-height:28px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:6px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; }
  select:disabled, input[type='radio']:disabled, input[type='checkbox']:disabled { opacity:.45; }
  .dnd-status { display:flex; flex-shrink:0; align-items:center; gap:8px; }
  .indicator { font-size:17px; } .indicator.on { color:var(--appearance-accent,#0878ef); }
  .status-text { font-size:12px; min-width:22px; }
  .error { flex-shrink:0; margin:0 0 12px; padding:8px; border-radius:12px; color:#b3261e; background:#fff5f1; }
  .description { margin:12px 4px; font-size:12px; opacity:.8; } .boundary { margin:16px 4px; font-size:11px; opacity:.65; } p { overflow-wrap:anywhere; }
  input:focus-visible,select:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; }
  .notification-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  .app-icon :global(img),.app-icon :global(.app-icon) { display:block; width:100%; height:100%; object-fit:contain; }
  .style-thumbnail { display:none; }
  .classic { background:var(--appearance-panel,#e8e8e8); font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif; }
  .classic .page { max-width:800px; padding:18px; }
  .classic h1 { font-size:20px; font-weight:400; text-align:center; margin-bottom:18px; }
  .classic .crumb { text-align:center; }
  .classic .settings-layout { display:grid; grid-template-columns:170px minmax(0,1fr); gap:18px; align-items:start; }
  .classic .application-sidebar { border:1px solid var(--appearance-soft-border,#b7b7b7); background:var(--appearance-surface,#fff); }
  .classic .application-sidebar > h2 { margin:0; padding:8px; border-bottom:1px solid var(--appearance-soft-border,#ccc); font-size:11px; }
  .classic .apps { margin:0; padding:0; border:0; border-radius:0; }
  .classic .app-row { position:relative; padding:7px 8px; gap:7px; }
  .classic .app-row:has(input:checked) { color:var(--appearance-selection-ink,#fff); background:var(--appearance-selection,#3779d0); }
  .classic .app-row + .app-row { border:0; }
  .classic .app-row input { position:absolute; inset:0; width:100%; height:100%; appearance:none; border:0; background:transparent; border-radius:0; }
  .classic .app-row:has(input:focus-visible) { outline:2px solid var(--appearance-focus,#0878ef); outline-offset:-2px; }
  .classic .settings-detail > h2 { margin-top:0; }
  .classic .card { border:0; border-radius:0; padding:0; background:transparent; }
  .classic .app-title { font-size:15px; }
  .classic input[type='checkbox'] { appearance:auto; width:14px; height:14px; border-radius:3px; accent-color:var(--appearance-accent,#0878ef); }
  .classic input[type='checkbox']::after { content:none; }
  .classic .setting-row { padding:8px 0; }
  .classic .segmented { border:0; gap:8px; overflow:visible; }
  .classic .segmented label { display:flex; flex-direction:column; align-items:center; gap:5px; padding:5px 8px; border:1px solid transparent; border-radius:4px; }
  .classic .segmented label:has(input:checked) { border-color:var(--appearance-accent,#0878ef); background:var(--appearance-hover,#ddd); }
  .classic .style-thumbnail { display:flex; flex-direction:column; gap:3px; width:62px; height:40px; padding:4px; box-sizing:border-box; border:1px solid #999; background:linear-gradient(140deg,#628fa5,#ccdbe0); }
  .style-thumbnail i { display:block; width:26px; height:5px; background:#fff; margin-left:auto; box-shadow:0 1px 2px #0004; }
  .style-thumbnail.persistent i { height:8px; }
  .windows { background:var(--appearance-panel,#f3f3f3); font:14px/1.45 'Segoe UI',sans-serif; }
  .windows .page { max-width:850px; padding:28px 32px; }
  .windows .crumb { font-size:14px; }
  .windows h1 { font-size:28px; font-weight:600; letter-spacing:0; }
  .windows h2 { font-size:14px; }
  .windows .card { border-radius:4px; padding:8px 16px; margin-bottom:5px; }
  .windows .app-row { min-height:38px; }
  .windows .app-icon { width:26px; flex-basis:26px; }
  .windows .segmented,.windows select { border-radius:4px; }
  .windows input[type='checkbox'] { width:40px; height:20px; border:1px solid var(--appearance-soft-border,#888); background:transparent; }
  .windows input[type='checkbox']::after { background:var(--appearance-ink,#333); top:3px; width:12px; height:12px; box-shadow:none; }
  .windows input[type='checkbox']:checked { background:var(--appearance-accent,#0067c0); border-color:transparent; }
  .windows input[type='checkbox']:checked::after { left:23px; background:#fff; }
  @media (max-width:540px) { .classic .settings-layout { grid-template-columns:minmax(0,1fr); }.windows .page { padding:18px; } }
  @media (max-width:500px) { .page { padding:16px; } .setting-row { flex-wrap:wrap; } .card { padding:6px 10px; } }
</style>
