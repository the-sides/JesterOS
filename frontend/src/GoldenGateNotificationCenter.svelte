<script>
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  import GoldenGateWidgets from './GoldenGateWidgets.svelte';
  import GoldenGateNotificationCard from './GoldenGateNotificationCard.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import AppIcon from './AppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  import Windows11Icon from './Windows11Icon.svelte';

  let { profile, preferences = null, pane, groups, clock, widgetState, widgetUi, reminderWidgetProjection, calendarWidgetProjection, foreground = true, actionsFor, snoozeChoicesFor, previewFor, itemUiFor, timestampFor, execute, registerView, onerror } = $props();
  const renderer = $derived(profile.renderer);
  const windows = $derived(renderer === 'windows11');
  const classic = $derived(renderer === 'high-sierra' || renderer === 'mojave');
  const golden = $derived(renderer === 'golden-gate');
  const Icon = $derived(windows ? Windows11Icon : renderer === 'high-sierra' ? HighSierraAppIcon : classic ? AppIcon : golden ? GoldenGateIcon : SonomaIcon);
  const tab = $derived(pane.tab ?? 'notifications');
  const showNotifications = $derived(!classic || tab === 'notifications');
  const showWidgets = $derived(!windows && (!classic || tab === 'today'));
  const dayFormat = $derived(new Intl.DateTimeFormat('en-US', { timeZone: clock.timeZone, weekday: 'long', month: 'long', day: 'numeric' }));
  function setTab(value) {
    cancelHold(); suppressClick = null;
    return request('tab.select', {}, { tab: value });
  }
  async function toggleDnd() {
    const owner = lease();
    if (!available() || !preferences) return;
    try {
      const result = await execute('notifications.dnd.set', {}, { enabled: !preferences.doNotDisturb });
      if (current(owner)) nativeError = result.status === 'rejected' ? result.error.message : null;
    } catch (cause) { if (current(owner)) nativeError = cause?.message ?? 'Do Not Disturb could not change.'; }
  }
  async function openSettings() {
    const owner = lease();
    if (!available()) return;
    try {
      const result = await execute('notifications.settings.open', {}, {});
      if (current(owner)) nativeError = result.status === 'rejected' ? result.error.message : null;
    } catch (cause) { if (current(owner)) nativeError = cause?.message ?? 'Notification settings could not open.'; }
  }
  let panel = $state(null), scroller = $state(null), nativeError = $state(null);
  let disposed = false, requestSequence = 0, held = null, suppressClick = null;
  const dateFormat = $derived(new Intl.DateTimeFormat('en-US', { timeZone: clock.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: !clock.use24Hour }));
  function timestamp(at) {
    const elapsed = clock.sceneTime - at;
    if (elapsed >= 0 && elapsed < 60_000) return 'Just now';
    if (elapsed >= 60_000 && elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
    return dateFormat.format(new Date(at));
  }
  function plainItemUi(entry) {
    const ui = typeof itemUiFor === 'function' ? itemUiFor(entry) : null;
    return { expanded: ui?.expanded === true, optionsOpen: ui?.optionsOpen === true,
      replyBody: typeof ui?.replyBody === 'string' ? ui.replyBody : null };
  }
  function preview(entry) {
    return typeof previewFor === 'function' ? previewFor(entry) === true : true;
  }
  function actions(entry) {
    const supplied = typeof actionsFor === 'function' ? actionsFor(entry) : [];
    return Array.isArray(supplied) ? supplied.filter(action => ['open', 'reply', 'snooze', 'complete', 'accept', 'decline'].includes(action)) : [];
  }
  function tsText(entry) {
    return typeof timestampFor === 'function' ? String(timestampFor(entry)) : timestamp(entry.createdAt);
  }
  const lease = () => ({ centerId: pane.centerId, panel, scroller });
  function current(owner) {
    return !disposed && owner.centerId === pane.centerId && owner.panel === panel && owner.scroller === scroller
      && panel?.dataset.notificationCenterId === owner.centerId;
  }
  function mounted(node) {
    if (!foreground || !panel?.isConnected || !node?.isConnected || !panel.contains(node)
      || panel.clientWidth <= 0 || panel.clientHeight <= 0) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.inert || parent.hasAttribute('inert')) return false;
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return true;
  }
  const available = () => current(lease()) && mounted(panel);
  const nodes = () => available() ? [panel, ...panel.querySelectorAll('[data-notification-control]')]
    .filter(node => mounted(node) && !node.disabled) : [];
  const control = id => nodes().find(node => node.dataset.notificationControl === id) ?? null;
  const valid = (owner, guard) => current(owner) && available() && (typeof guard !== 'function' || guard() === true);
  const position = () => ({ top: scroller?.scrollTop ?? 0, left: scroller?.scrollLeft ?? 0 });
  function describe() {
    const controls = nodes();
    return { controlIds: controls.map(node => node.dataset.notificationControl),
      focusedControl: controls.find(node => node.ownerDocument.activeElement === node)?.dataset.notificationControl ?? null,
      scroll: position(),
      widgetScrolls: available() ? [...panel.querySelectorAll('[data-widget-id]')].filter(mounted)
        .map(node => ({ widgetId: node.dataset.widgetId, top: node.scrollTop, left: node.scrollLeft })) : [] };
  }
  async function prepare(id, guard) {
    const owner = lease(), original = control(id);
    if (!original || !valid(owner, guard)) return false;
    await tick();
    return valid(owner, guard) && control(id) === original;
  }
  async function focus(id, guard) {
    const owner = lease(), original = control(id);
    if (!original || !valid(owner, guard)) return false;
    await tick();
    if (!valid(owner, guard) || control(id) !== original) return false;
    if (original !== panel) original.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!valid(owner, guard) || control(id) !== original) return false;
    original.focus({ preventScroll: true });
    return valid(owner, guard) && original.ownerDocument.activeElement === original;
  }
  async function scroll(offsets, guard) {
    const owner = lease();
    if (!valid(owner, guard) || !mounted(scroller) || !Number.isFinite(offsets?.top) || !Number.isFinite(offsets?.left)
      || offsets.top < 0 || offsets.left < 0 || offsets.top > Number.MAX_SAFE_INTEGER || offsets.left > Number.MAX_SAFE_INTEGER) return null;
    await tick();
    if (!valid(owner, guard) || !mounted(owner.scroller)) return null;
    owner.scroller.scrollTop = offsets.top; owner.scroller.scrollLeft = offsets.left;
    return valid(owner, guard) ? position() : null;
  }
  async function scrollWidget(widgetId, offsets, guard) {
    const owner = lease(), original = control(`widget:${widgetId}:card`);
    if (!original || !valid(owner, guard) || !Number.isFinite(offsets?.top) || !Number.isFinite(offsets?.left)
      || offsets.top < 0 || offsets.left < 0 || offsets.top > Number.MAX_SAFE_INTEGER || offsets.left > Number.MAX_SAFE_INTEGER) return null;
    await tick();
    if (!valid(owner, guard) || control(`widget:${widgetId}:card`) !== original) return null;
    original.scrollTop = offsets.top; original.scrollLeft = offsets.left;
    return valid(owner, guard) ? { top: original.scrollTop, left: original.scrollLeft } : null;
  }
  const facade = { available, describe, prepare, focus, scroll, scrollWidget };
  let retire = null;
  onMount(() => { retire = registerView?.(facade) ?? null; });
  function cancelHold() { if (held) clearTimeout(held.timer); held = null; }
  onDestroy(() => {
    disposed = true; cancelHold();
    if (typeof retire === 'function') retire();
    else registerView?.(null, facade);
  });
  $effect(() => { if (!foreground) { cancelHold(); suppressClick = null; } });
  $effect(() => {
    const owner = pane.centerId, top = pane.scroll.top, left = pane.scroll.left, node = scroller;
    untrack(() => { if (available() && panel.dataset.notificationCenterId === owner && node) { node.scrollTop = top; node.scrollLeft = left; } });
  });
  async function request(command, target = {}, payload = {}) {
    const owner = lease();
    if (!available()) return null;
    const sequence = ++requestSequence;
    try {
      const result = await execute(`notifications.${command}`, { centerId: owner.centerId, ...target }, payload);
      if (current(owner) && sequence === requestSequence) nativeError = result.status === 'rejected' ? result.error.message : null;
      return result;
    } catch (cause) {
      if (current(owner) && sequence === requestSequence) nativeError = cause?.message ?? 'The notification request could not be completed.';
      return null;
    }
  }
  async function editWidgets() {
    const owner = lease();
    if (!available()) return;
    try {
      const result = await execute('widgets.editor.open', { centerId: owner.centerId }, {});
      if (current(owner)) nativeError = result.status === 'rejected' ? result.error.message : null;
    } catch (cause) {
      if (current(owner)) nativeError = cause?.message ?? 'The widget editor could not be opened.';
    }
  }
  function holdRemove(event, groupId, notificationId) {
    if (event.button !== 0 || !available()) return;
    cancelHold(); suppressClick = null;
    const owner = lease(), node = event.currentTarget, pointerId = event.pointerId;
    const id = `dismiss:${notificationId}`;
    held = { node, pointerId, timer: setTimeout(() => {
      if (!held || held.node !== node || !valid(owner) || control(id) !== node) return;
      suppressClick = node; held = null;
      void request('clear', { groupId });
    }, 500) };
  }
  function remove(event, notificationId) {
    cancelHold();
    if (suppressClick === event.currentTarget) { suppressClick = null; return; }
    suppressClick = null;
    void request('dismiss', { notificationId });
  }
  function focusChanged() { if (available()) pane.focusedControl = describe().focusedControl; }
  function scrollChanged() {
    if (!available()) return;
    const actual = position();
    if (actual.top !== pane.scroll.top || actual.left !== pane.scroll.left) void request('scroll', {}, actual);
  }
  function keydown(event) {
    if (!available() || event.isComposing || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void request('close'); }
    else if (classic && event.target?.dataset.notificationControl?.startsWith('tab:')
      && !event.metaKey && !event.ctrlKey && !event.altKey && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      void setTab(event.key === 'Home' ? 'today' : event.key === 'End' ? 'notifications' : tab === 'today' ? 'notifications' : 'today');
    }
    else if (event.target === panel && !event.metaKey && !event.ctrlKey && !event.altKey
      && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const amount = event.key.startsWith('Page') ? scroller.clientHeight : 60;
      const top = event.key === 'Home' ? 0 : event.key === 'End' ? scroller.scrollHeight
        : Math.max(0, scroller.scrollTop + (['ArrowUp', 'PageUp'].includes(event.key) ? -amount : amount));
      void request('scroll', {}, { top, left: 0 });
    }
  }
</script>

<div class="notification-center" class:classic class:windows class:golden data-notification-profile={renderer} id={`notification-center-${pane.centerId}`} role="dialog" aria-modal="false" aria-label="Notification Center" tabindex="-1"
  data-notification-center-id={pane.centerId} data-notification-control="center" bind:this={panel}
  onkeydown={keydown} onfocusin={focusChanged}>
  <header class="center-actions">
    {#if classic}
      <div class="center-tabs" role="tablist" aria-label="Notification Center views">
        <button role="tab" tabindex={tab === 'today' ? 0 : -1} id={`notification-tab-today-${pane.centerId}`} aria-selected={tab === 'today'} aria-controls={`notification-today-${pane.centerId}`} data-notification-control="tab:today" onclick={() => setTab('today')}>Today</button>
        <button role="tab" tabindex={tab === 'notifications' ? 0 : -1} id={`notification-tab-notifications-${pane.centerId}`} aria-selected={tab === 'notifications'} aria-controls={`notification-list-${pane.centerId}`} data-notification-control="tab:notifications" onclick={() => setTab('notifications')}>Notifications</button>
      </div>
    {:else}<h2>{windows ? 'Notifications' : 'Notification Center'}</h2>{/if}
    {#if preferences && !classic}<button class="dnd" data-notification-control="dnd" aria-label="Do Not Disturb" aria-pressed={preferences.doNotDisturb} onclick={toggleDnd}>{preferences.doNotDisturb ? '◐ On' : '◐'}</button>{/if}
    {#if groups.length && showNotifications}<button data-notification-control="clear-all" onclick={() => request('clear')}>{windows ? 'Clear all' : 'Clear All'}</button>{/if}
    <button data-notification-control="settings" aria-label="Notification settings" onclick={openSettings}>⚙</button>
    <button class="close" data-notification-control="close" aria-label="Close Notification Center" onclick={() => request('close')}>×</button>
  </header>
  {#if nativeError}<p class="error" role="alert">{nativeError}</p>{/if}
  <div class="notification-scroll" bind:this={scroller} onscroll={scrollChanged}>
    {#if classic && preferences}<label class="classic-dnd">Do Not Disturb<input type="checkbox" role="switch" checked={preferences.doNotDisturb} data-notification-control="dnd" onchange={toggleDnd} /></label>{/if}
    <div id={`notification-list-${pane.centerId}`} hidden={!showNotifications} role={classic ? 'tabpanel' : undefined} aria-labelledby={classic ? `notification-tab-notifications-${pane.centerId}` : undefined}>
    {#if groups.length === 0}<div class="empty"><span aria-hidden="true">◷</span><p>No notifications</p></div>{/if}
    {#each groups as group (group.groupId)}
      {@const expanded = classic || pane.expandedGroupIds.includes(group.groupId)}
      <article class="notification-group" class:stacked={!windows && !expanded && group.entries.length > 1} data-notification-group={group.groupId} aria-label={`${group.name} notifications`}>
        {#if expanded}
          {#if !classic}
          <div class="group-heading"><strong>{group.name}</strong>
            <button data-notification-control={`collapse:${group.groupId}`} aria-label={windows ? `Collapse ${group.name} notifications` : undefined} onclick={() => request('group.setExpanded', { groupId: group.groupId }, { expanded: false })}>{windows ? '⌃' : 'Show Less'}</button>
            <button class="remove" data-notification-control={`clear:${group.groupId}`} aria-label={`Clear all notifications from ${group.name}`} onclick={() => request('clear', { groupId: group.groupId })}>×</button>
          </div>
          {/if}
          {#each group.entries as entry (entry.id)}
            <div class="expandable-card">
              <GoldenGateNotificationCard {profile} {entry} app={{ name: group.name, icon: group.icon }}
                ownerTarget={{ centerId: pane.centerId }} actions={actions(entry)} snoozeChoices={snoozeChoicesFor?.(entry) ?? []} showPreview={preview(entry)}
                itemUi={plainItemUi(entry)} timestamp={tsText(entry)} {foreground} {execute}
                onerror={message => { if (message) nativeError = message; else nativeError = null; }} />
              <button class="remove item-remove" data-notification-control={`dismiss:${entry.id}`} aria-label={preview(entry) ? `Dismiss ${entry.title}` : `Dismiss ${group.name} notification`}
                onpointerdown={event => holdRemove(event, group.groupId, entry.id)} onpointerup={cancelHold} onpointercancel={cancelHold} onpointerleave={cancelHold}
                onclick={event => remove(event, entry.id)}>×</button>
            </div>
          {/each}
        {:else if group.entries.length === 1}
          {@const entry = group.entries[0]}
          <div class="expandable-card">
            <GoldenGateNotificationCard {profile} {entry} app={{ name: group.name, icon: group.icon }}
              ownerTarget={{ centerId: pane.centerId }} actions={actions(entry)} snoozeChoices={snoozeChoicesFor?.(entry) ?? []} showPreview={preview(entry)}
              itemUi={plainItemUi(entry)} timestamp={tsText(entry)} {foreground} {execute}
              onerror={message => { nativeError = message; }} />
            <button class="remove item-remove" data-notification-control={`dismiss:${entry.id}`}
              aria-label={preview(entry) ? `Dismiss ${entry.title}` : `Dismiss ${group.name} notification`}
              onpointerdown={event => holdRemove(event, group.groupId, entry.id)} onpointerup={cancelHold}
              onpointercancel={cancelHold} onpointerleave={cancelHold} onclick={event => remove(event, entry.id)}>×</button>
          </div>
        {:else}
          {@const entry = group.entries[0]}
          {#key entry.id}
          <div class="notification-card collapsed" data-notification-id={entry.id}>
            <button class="stack-content" data-notification-control={`group:${group.groupId}`} aria-label={`Expand ${group.name} notifications (${group.entries.length})`} aria-expanded="false"
              onclick={() => request('group.setExpanded', { groupId: group.groupId }, { expanded: true })}>
              <span class="notification-meta"><span class="app-icon"><Icon name={group.icon} assets={profile.assets} /></span><strong>{group.name}</strong><time datetime={new Date(entry.createdAt).toISOString()}>{tsText(entry)}</time></span>
              <strong class="title">{preview(entry) ? entry.title : 'Notification'}</strong><span class="body preview">{preview(entry) ? entry.body : 'Preview hidden'}</span>
              {#if group.entries.length > 1}<span class="count">{windows ? `+${group.entries.length - 1} notifications` : `${group.entries.length} notifications`}{#if windows}<span class="group-chevron" aria-hidden="true">⌄</span>{/if}</span>{/if}
            </button>
            <button class="remove item-remove" data-notification-control={`dismiss:${entry.id}`} aria-label={preview(entry) ? `Dismiss ${entry.title}` : `Dismiss ${group.name} notification`}
              onpointerdown={event => holdRemove(event, group.groupId, entry.id)} onpointerup={cancelHold} onpointercancel={cancelHold} onpointerleave={cancelHold}
              onclick={event => remove(event, entry.id)}>×</button>
          </div>
          {/key}
        {/if}
      </article>
    {/each}
    </div>
    <div id={`notification-today-${pane.centerId}`} hidden={!showWidgets} role={classic ? 'tabpanel' : undefined} aria-labelledby={classic ? `notification-tab-today-${pane.centerId}` : undefined}>
    {#if classic}<h3 class="today-date">{dayFormat.format(new Date(clock.sceneTime))}</h3>{/if}
    {#if widgetState && widgetUi}
      <GoldenGateWidgets state={widgetState} {clock} {reminderWidgetProjection} {calendarWidgetProjection} centerId={pane.centerId} ui={widgetUi} {foreground} {execute} onerror={message => nativeError = message} />
      <div class="widget-actions"><button data-notification-control="edit-widgets" onclick={editWidgets}>Edit Widgets</button></div>
    {/if}
    </div>
    {#if windows}<footer class="windows-date"><span>{dayFormat.format(new Date(clock.sceneTime))}</span></footer>{/if}
  </div>
</div>

<style>
  .notification-center { --notification-material:color-mix(in srgb,var(--appearance-surface,#fff) 90%,transparent); height:100%; min-width:0; min-height:0; display:flex; flex-direction:column; color:var(--appearance-ink,#242427); font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; border-radius:24px; outline:none; }
  .notification-center:focus-visible { outline:2px solid var(--appearance-focus,#0878ef); outline-offset:2px; }
  .center-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; margin:0 3px 12px; padding:9px 12px; border:1px solid var(--appearance-light-edge,#ffffff65); border-radius:20px; background:var(--notification-material); backdrop-filter:blur(25px); box-shadow:0 3px 14px #0002; }
  h2 { margin:0 auto 0 0; min-width:0; font-size:12px; font-weight:600; }
  button { border:0; cursor:default; color:inherit; font:inherit; }
  .center-actions button,.group-heading button { border-radius:12px; padding:4px 8px; background:#8882; white-space:nowrap; }
  .center-actions .close { width:25px; height:25px; padding:0; flex-shrink:0; font-size:21px; line-height:22px; }
  button:focus-visible { outline:2px solid var(--appearance-focus,#0878ef); outline-offset:2px; }
  .notification-scroll { flex:1; min-height:0; padding:3px 5px 20px; overflow:auto; scrollbar-width:thin; }
  .notification-group { margin-bottom:14px; min-width:0; }
  .expandable-card { position:relative; margin-bottom:8px; }
  .expandable-card :global(.notification-card) { display:block; }
  .expandable-card .item-remove { position:absolute; left:-3px; top:-3px; z-index:1; }
  .collapsed { padding:0; }
  .stacked { position:relative; padding-bottom:7px; }
  .stacked::before,.stacked::after { content:''; position:absolute; left:7px; right:7px; bottom:6px; height:30px; border-radius:20px; background:var(--notification-material); border:1px solid var(--appearance-light-edge,#ffffff80); box-shadow:0 3px 9px #0002; }
  .stacked::before { left:14px; right:14px; bottom:1px; }
  .stacked .notification-card { z-index:1; }
  .stack-content { display:block; width:100%; padding:15px 18px; border-radius:24px; text-align:left; background:transparent; }
  .notification-meta { display:flex; align-items:center; gap:7px; min-width:0; padding-right:10px; font-size:11px; }
  .notification-meta strong { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .notification-meta time { margin-left:auto; flex-shrink:0; font-size:10px; opacity:.66; }
  .app-icon { display:block; flex:0 0 22px; width:22px; height:22px; }
  .app-icon :global(svg) { width:100%; height:100%; }
  .title { display:block; margin:9px 0 4px; font-size:13px; line-height:1.35; font-weight:600; white-space:pre-wrap; }
  .body { display:block; margin:0; font-size:12px; line-height:1.5; white-space:pre-wrap; }
  .preview { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
  .count { display:block; margin-top:10px; font-size:11px; opacity:.6; }
  .remove { width:23px; height:23px; border-radius:50%; background:var(--appearance-panel,#eee); box-shadow:0 0 0 1px var(--appearance-soft-border,#8883); padding:0; line-height:20px; font-size:18px; }
  .item-remove { position:absolute; left:-3px; top:-3px; }
  .group-heading { display:flex; align-items:center; gap:7px; margin:0 5px 9px; padding:5px 7px; border-radius:16px; background:var(--notification-material); backdrop-filter:blur(25px); font-size:11px; }
  .group-heading strong { margin-right:auto; min-width:0; overflow-wrap:anywhere; }
  .group-heading .remove { padding:0; flex-shrink:0; }
  .empty { padding:30px 18px; text-align:center; border-radius:24px; background:var(--notification-material); backdrop-filter:blur(25px); color:inherit; }
  .empty span { font-size:28px; opacity:.5; }.empty p { margin:12px 0 0; }
  .error { flex-shrink:0; margin:0 5px 9px; padding:8px; border-radius:12px; color:#b3261e; background:#fff5f1; }
  .widget-actions { display:flex; justify-content:center; margin:18px 0 0; }
  .widget-actions button { padding:7px 16px; border-radius:14px; background:var(--notification-material); border:1px solid var(--appearance-light-edge,#fff8); backdrop-filter:blur(25px); font-size:12px; box-shadow:0 2px 8px #0002; }
  [hidden] { display:none !important; }
  .app-icon :global(img),.app-icon :global(.app-icon) { display:block; width:100%; height:100%; object-fit:contain; }
  .notification-center:not(.golden):not(.classic):not(.windows) { border-radius:16px; }
  .notification-center:not(.golden):not(.classic):not(.windows) .center-actions { border-radius:14px; }
  .classic { border-radius:0; padding:0; background:color-mix(in srgb,var(--appearance-panel,#e7e7e7) 88%,transparent); backdrop-filter:blur(25px); box-shadow:-3px 0 20px #0003; }
  .classic .center-actions { margin:0; padding:13px 12px; border:0; border-bottom:1px solid #8883; border-radius:0; box-shadow:none; background:transparent; gap:5px; }
  .center-tabs { flex:1; display:flex; justify-content:center; }
  .center-tabs button { flex:1; max-width:145px; margin:0; padding:5px 10px; border:1px solid #8885; border-radius:0; background:var(--appearance-surface,#eee); font-size:12px; }
  .center-tabs button:first-child { border-radius:4px 0 0 4px; }.center-tabs button:last-child { border-radius:0 4px 4px 0; border-left:0; }
  .center-tabs button[aria-selected='true'] { background:var(--appearance-accent,#666); color:var(--appearance-accent-ink,#fff); }
  .classic .notification-scroll { padding:0 12px 20px; }
  .classic .notification-group { margin-bottom:0; }
  .classic .expandable-card { margin:0 0 1px; }
  .classic .item-remove { left:auto; right:4px; top:4px; width:18px; height:18px; border-radius:3px; box-shadow:none; font-size:15px; }
  .classic :global(.notification-card .meta) { padding-right:20px; }
  .classic .empty { background:transparent; border-radius:0; margin-top:70px; font-size:14px; opacity:.65; }
  .classic .empty span { display:none; }
  .classic-dnd { display:flex; align-items:center; justify-content:space-between; margin:0 -12px 12px; padding:12px 20px; border-bottom:1px solid #8883; font-size:12px; }
  .classic-dnd input { accent-color:var(--appearance-accent,#0878ef); }
  .today-date { margin:16px 5px 22px; font-size:23px; line-height:1.25; font-weight:300; }
  .classic .widget-actions button { border-radius:4px; padding:4px 13px; background:var(--appearance-surface,#eee); border-color:#8885; }
  .windows { box-sizing:border-box; border:1px solid var(--appearance-soft-border,#bbb); border-radius:8px; background:color-mix(in srgb,var(--appearance-panel,#f3f3f3) 96%,transparent); backdrop-filter:blur(30px); box-shadow:0 8px 30px #0003; font-family:'Segoe UI',sans-serif; }
  .windows .center-actions { margin:0; padding:17px 16px; border:0; border-radius:0; background:transparent; box-shadow:none; }
  .windows h2 { font-size:16px; font-weight:600; }
  .windows .center-actions button { border-radius:4px; font-size:12px; }
  .windows .notification-scroll { padding:0 12px 12px; }
  .windows .group-heading { background:transparent; margin:0; padding:8px 4px; font-size:12px; border-radius:0; }
  .windows .item-remove { left:auto; right:9px; top:9px; border-radius:4px; background:transparent; box-shadow:none; }
  .windows .empty { background:transparent; border-radius:0; padding:55px 10px; }
  .windows-date { padding:18px 4px 8px; border-top:1px solid var(--appearance-soft-border,#ccc); font-size:18px; font-weight:600; }
  .dnd[aria-pressed='true'] { color:var(--appearance-accent,#0878ef); }
  .windows .collapsed { border:1px solid var(--appearance-soft-border,#d5d5d5); border-radius:8px; background:var(--appearance-surface,#fff); }
  .windows .stack-content { border-radius:8px; padding:14px 16px; }
  .windows .notification-meta { font-size:12px; padding-right:23px; }
  .windows .count { display:flex; align-items:center; justify-content:space-between; border-top:1px solid var(--appearance-soft-border,#ddd); margin:14px -16px -14px; padding:10px 16px; font-size:12px; opacity:1; }
  .group-chevron { font-size:17px; }
  @media (prefers-reduced-motion:reduce) { .notification-center { scroll-behavior:auto; } }
</style>
