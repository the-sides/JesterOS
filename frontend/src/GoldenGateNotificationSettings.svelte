<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';

  let { profile, window, preferences, selectedAppId = '', execute, registerView } = $props();
  let panel = $state(null);
  let ownerWindow = null, ownerRoot = null, ownerFrame = null, disposed = false, writtenScroll = null;
  let lastError = $state(null);
  const temporary = 'temporary', persistent = 'persistent';
  const previews = ['default', 'always', 'when-unlocked', 'never'];
  const resolve = $derived.by(() => {
    const row = String(selectedAppId || '').length <= 128 && pointerSafe(selectedAppId)
      ? preferences?.applications?.find?.(application => application?.appId === selectedAppId) ?? null : null;
    return { row, app: row?.appId ?? (pointerSafe(selectedAppId) ? selectedAppId : ''),
      allow: row?.allow ?? true, desktop: row?.desktop ?? true,
      center: row?.center ?? true, style: row?.style ?? temporary,
      previews: row?.previews ?? 'default', rowExists: Boolean(row) };
  });
  function pointerSafe(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
      && !Object.getOwnPropertyNames(Object.prototype).includes(value);
  }
  function current() {
    return Boolean(!disposed && panel?.isConnected && window === ownerWindow && window.appId === 'settings'
      && !window.utilityKind && window.settingsPane === 'notifications' && panel.dataset.windowId === window.id
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
        else if (['notifications-allow', 'notifications-desktop', 'notifications-center'].includes(id)) node.checked = resolve[id.slice(14)];
        else if (id === 'notifications-style') node.checked = node.value === resolve.style;
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
        if (result?.status === 'rejected') lastError = result.error?.message ?? 'Notification settings could not apply that change.';
        else lastError = null;
      }
    } catch (cause) { lastError = cause?.message ?? 'Notification settings could not apply that change.'; }
    finally { await reconcile(); }
  }
  function chooseApp(event) { return request(event, 'notifications.settings.select', { windowId: window.id, appId: pointerSafe(event.currentTarget.value) ? event.currentTarget.value : String(event.currentTarget.value) }); }
  function setApp(event, field) { return request(event, 'notifications.settings.configure', { windowId: window.id, appId: resolve.app }, { configuration: { [field]: event.currentTarget.type === 'checkbox' ? Boolean(event.currentTarget.checked) : event.currentTarget.value } }); }
  function setPreviews(event) { return request(event, 'notifications.settings.global.configure', { windowId: window.id }, { showPreviews: event.currentTarget.value }); }
  function setDnd(event) { return request(event, 'notifications.dnd.set', {}, { enabled: Boolean(event.currentTarget.checked) }); }
  function observeScroll() {
    const written = writtenScroll; writtenScroll = null;
    if (!owned(panel) || written?.panel === panel && written.top === panel.scrollTop && written.left === panel.scrollLeft) return;
    void execute({ command: 'system.panel.scroll', target: { windowId: window.id },
      payload: { top: panel.scrollTop, left: panel.scrollLeft, observe: true } });
  }
</script>

<section class="notification-settings" bind:this={panel} data-notification-settings data-window-id={window.id} data-application-settings="notifications"
  data-system-panel="settings-notifications" data-application-settings-control="panel" data-application-panel-scroll data-notification-settings-scroll
  aria-label="Notification settings" tabindex="-1" onscroll={observeScroll}>
  <div class="page">
    <header><p class="crumb">System Settings</p><h1>Notifications</h1></header>
    {#if lastError}<p class="error" role="alert">{lastError}</p>{/if}
    <h2>Application list</h2>
    <article class="card apps">
      {#if !profile.applications || Object.keys(profile.applications).length === 0}<p class="description">No registered applications expose notification preferences.</p>{:else}
        {#each Object.entries(profile.applications) as [appId, application], index (appId)}
          <label class="app-row{index === 0 ? ' first' : ''}">
            <span class="app-icon"><GoldenGateIcon name={application.icon} /></span>
            <span class="app-name">{application.name}</span>
            <input type="radio" name={`notification-app-${window.id}`} value={appId} data-application-settings-control={`notifications-app:${appId}`}
              checked={ selectedAppId === appId } onchange={chooseApp} />
          </label>
        {/each}
      {/if}
    </article>

    <h2>Selected app</h2>
    {#if resolve.app}
      <article class="card app-settings">
        <strong class="app-title">{profile.applications?.[resolve.app]?.name ?? resolve.app}</strong>
        <label class="setting-row" for={`notify-allow-${window.id}`}><span><strong>Allow notifications</strong><small>Permitted apps appear in Notification Center and may show temporary or persistent banners.</small></span>
          <input id={`notify-allow-${window.id}`} type="checkbox" role="switch" data-application-settings-control="notifications-allow" checked={resolve.allow}
            onchange={event => setApp(event, 'allow')} /></label>
        <label class="setting-row" for={`notify-desktop-${window.id}`}><span><strong>Show on desktop</strong><small>Permit banner or alert presentation on the desktop itself.</small></span>
          <input id={`notify-desktop-${window.id}`} type="checkbox" role="switch" data-application-settings-control="notifications-desktop" checked={resolve.desktop}
            disabled={!resolve.allow} onchange={event => setApp(event, 'desktop')} /></label>
        <label class="setting-row" for={`notify-center-${window.id}`}><span><strong>Show in Notification Center</strong><small>Keep delivered notifications in this local center list.</small></span>
          <input id={`notify-center-${window.id}`} type="checkbox" role="switch" data-application-settings-control="notifications-center" checked={resolve.center}
            disabled={!resolve.allow} onchange={event => setApp(event, 'center')} /></label>
        <div class="setting-row style-row" id={`notify-style-${window.id}`}>
          <span><strong>Notification style</strong><small>Temporary banners clear on their own; persistent alerts remain until dismissed.</small></span>
          <div class="segmented" role="radiogroup" aria-label="Notification style">
            <label><input type="radio" value={temporary} checked={resolve.style === temporary} disabled={!resolve.allow}
              data-application-settings-control="notifications-style" name={`notify-style-${window.id}`} onchange={event => setApp(event, 'style')} />Temporary</label>
            <label><input type="radio" value={persistent} checked={resolve.style === persistent} disabled={!resolve.allow}
              data-application-settings-control="notifications-style" name={`notify-style-${window.id}`} onchange={event => setApp(event, 'style')} />Persistent</label>
          </div>
        </div>
        <div class="setting-row previews-row" id={`notify-previews-${window.id}`}>
          <span><strong>Show previews</strong><small>Defaults to the global setting below.</small></span>
          <select disabled={!resolve.allow} data-application-settings-control="notifications-previews" value={resolve.previews}
            onchange={event => setApp(event, 'previews')}>
            {#each previews as option}<option value={option}>{option === 'default' ? 'Default' : option === 'when-unlocked' ? 'When Unlocked' : option === 'always' ? 'Always' : 'Never'}</option>{/each}
          </select>
        </div>
      </article>
    {:else}
      <p class="description">Choose an application above to adjust whether it may notify, where its notifications appear, and whether previews are shown.</p>
    {/if}

    <h2>Global</h2>
    <article class="card globals">
      <div class="setting-row" id={`notify-global-previews-${window.id}`}>
        <span><strong>Show previews</strong><small>When Unlocked hides notification content until this scene session is unlocked; Never hides titles and bodies everywhere.</small></span>
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
    <p class="description">Option-click the menu-bar date/time to toggle this scene’s Do Not Disturb. This native shortcut does not change host Focus settings.</p>
    <p class="boundary">These preferences belong to this local simulated desktop. No host notifications, sounds, badges, critical alerts, time-sensitive delivery, mirroring, or background services are modeled here, and notification events are logged for the operator, not delivered system-wide.</p>
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
  @media (max-width:500px) { .page { padding:16px; } .setting-row { flex-wrap:wrap; } .card { padding:6px 10px; } }
</style>
