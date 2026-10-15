<script>
  import { onMount, tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import { callsWindow, callById, visibleRecentCalls, callDuration, callsCapabilities } from './calls-state.js';
  import { callsMenus } from './calls-menus.js';
  import { createCallsNativeView } from './calls-native-view.js';
  import { recipientIdentity } from './messages-recipients.js';
  import './calls.css';

  let { state: nativeState, profile, windowId, execute, registerView, available = true, active = true, controls = {} } = $props();
  let root, ownedRoot, ownedState, mounted = false;
  let error = $state(''), openMenu = $state(''), selectedIds = $state(new Set());
  const identity = $derived(typeof profile === 'string' ? profile : profile?.id ?? profile?.renderer ?? '');
  const windows = $derived(identity.includes('windows'));
  const classic = $derived(identity.includes('high-sierra') || identity.includes('mojave'));
  const golden = $derived(identity.includes('golden-gate'));
  const era = $derived(windows ? 'windows11' : golden ? 'golden-gate' : identity.includes('high-sierra') ? 'high-sierra' : identity.includes('mojave') ? 'mojave' : 'sonoma');
  const capabilities = $derived(callsCapabilities(profile));
  const view = $derived(callsWindow(nativeState, windowId));
  const call = $derived(callById(nativeState, view?.callId));
  const recentCalls = $derived(visibleRecentCalls(nativeState, windowId));
  const sceneTime = $derived(Number.isFinite(controls.sceneTime) ? controls.sceneTime : nativeState.runtime.lastTime);
  const account = $derived.by(() => { nativeState.runtime.lastTime; controls.sceneTime; return controls.getAccount?.() ?? null; });
  const preferences = $derived(nativeState.preferences);
  const blockedCallers = $derived.by(() => { controls.sceneTime; nativeState.runtime.lastTime; return controls.getBlockedCallers?.() ?? null; });
  const menus = $derived(callsMenus(profile, nativeState, windowId, account, blockedCallers));
  const recipient = $derived(view?.recipients.find(row => row.id === view.selectedContactId));
  const participant = $derived(call?.participants[0]);
  const live = $derived(Boolean(call && ['ringing', 'connecting', 'in-call'].includes(call.status)));
  const incoming = $derived(call?.status === 'ringing' && call.direction === 'incoming');
  const connected = $derived(call?.status === 'in-call');
  const canStart = $derived(Boolean(account?.signedIn && !live && (recipient || view?.query.trim())));
  const elapsed = $derived(call ? duration(callDuration(call, sceneTime)) : '00:00');
  const canStartPicker = $derived(Boolean(account?.signedIn && !live && (selectedIds.size || canStart) && selectedIds.size <= capabilities.maxRemoteParticipants));
  const phase = $derived((sceneTime % 6000) / 6000);
  const speaking = $derived(connected && Math.floor(sceneTime / 800) % 4 !== 0);
  const status = $derived(incoming ? `Incoming ${call.kind === 'audio' ? 'audio' : 'video'} call` : call?.status === 'ringing' ? 'Calling…' : call?.status === 'connecting' ? 'Connecting…' : connected ? elapsed : call?.status === 'failed' ? 'Call Failed' : call?.status === 'ended' ? 'Call Ended' : '');
  const iconPaths = {
    video: 'M3 6h12v12H3z M15 10l6-4v12l-6-4z', phone: 'M6 3l4 4-3 3c2 3 4 5 7 7l3-3 4 4-2 3C10 23 1 14 3 5z',
    end: 'M3 14c5-6 13-6 18 0l-2 4-5-2v-3h-4v3l-5 2z', mic: 'M9 3h6v11H9z M6 11v3a6 6 0 0 0 12 0v-3 M12 20v3 M8 23h8',
    mute: 'M9 3h6v10 M6 11v3a6 6 0 0 0 10 4 M18 11v3 M12 20v3 M8 23h8 M3 3l18 18',
    search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6', add: 'M12 4v16 M4 12h16',
    person: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M4 22v-3a8 8 0 0 1 16 0v3',
    info: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20 M12 10v7 M12 6v1', expand: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
    chevron: 'M9 5l7 7-7 7', close: 'M5 5l14 14 M19 5 5 19', check: 'M4 12l5 5L20 6', back: 'M15 5l-7 7 7 7', more: 'M4 12h1 M11 12h1 M18 12h1'
  };
  function duration(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  }
  const initials = name => (name ?? '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  function recentDate(time) {
    return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function owns() { return mounted && available && root === ownedRoot && nativeState === ownedState && Boolean(callsWindow(nativeState, windowId)) && root?.isConnected && !root.closest('[hidden], [inert]'); }
  async function command(name, payload = {}) {
    if (!owns()) return null;
    const original = root, graph = nativeState;
    try {
      const result = await execute(`calls.${name}`, { windowId }, payload);
      if (owns() && original === root && graph === nativeState) error = ['rejected', 'unavailable'].includes(result?.status) ? result.error?.message ?? result.message ?? 'This action is unavailable.' : '';
      return result;
    } catch (cause) { if (owns() && original === root && graph === nativeState) error = cause?.message ?? 'This action is unavailable.'; return null; }
  }
  function callSpec(kind) {
    return { kind, ...(recipient ? { contactId: recipient.id } : { name: view?.query.trim() ?? '', address: view?.query.trim() ?? '' }) };
  }
  function selectContact(contactId) {
    if (!owns() || !view?.recipients.some(row => row.id === contactId)) return;
    const next = new Set(selectedIds);
    if (next.has(contactId)) next.delete(contactId);
    else if (next.size < capabilities.maxRemoteParticipants) next.add(contactId);
    else { error = `Choose at most ${capabilities.maxRemoteParticipants} remote participants.`; return; }
    selectedIds = next;
  }
  function startPicker(kind = preferences.defaultKind) {
    if (!canStartPicker) return;
    const ids = [...selectedIds];
    return ids.length > 1 ? command('group.start', { kind, contactIds: ids }) : command('start', ids.length ? { kind, contactId: ids[0] } : callSpec(kind));
  }
  async function setPreference(key, event) {
    const node = event.currentTarget, original = root, graph = nativeState;
    const value = node.type === 'checkbox' ? node.checked : node.value;
    await command('preferences.set', { values: { ...preferences, [key]: value } });
    if (!owns() || original !== root || graph !== nativeState || !node.isConnected || !root.contains(node)) return;
    if (node.type === 'checkbox') node.checked = preferences[key];
    else node.value = preferences[key];
  }
  function redial(kind) {
    if (call.participants.length > 1) return command('group.start', { kind, contactIds: call.participants.map(row => row.contactId) });
    return command('start', { kind, ...(participant.contactId ? { contactId: participant.contactId } : { name: participant.name, address: participant.address }) });
  }
  function blockParticipant(row) {
    return command('block', { address: row.address, ...(row.contactId ? { contactId: row.contactId } : {}) });
  }
  function isBlocked(row) {
    return Boolean(blockedCallers?.some(block => recipientIdentity(block.address) === recipientIdentity(row.address)));
  }
  async function search(event) {
    const node = event.currentTarget, query = node.value, picker = view?.pickerOpen;
    const result = await command('search', { query });
    if (owns() && node.isConnected && root.contains(node) && node.value === query && result?.status === 'applied' && (picker || classic) && view.query === query) await command('contacts.resolve', { query });
  }
  async function runMenu(item) {
    if (!item.enabled || !item.request || !owns()) return;
    await command('menu.close', { restoreFocus: false });
    const { command: name, target, payload } = item.request;
    if (name.startsWith('calls.')) await command(name.slice(6), payload);
    else {
      const original = root, graph = nativeState;
      try {
        const result = await execute(name, target, payload);
        if (owns() && root === original && nativeState === graph) error = result?.status === 'rejected' ? result.error?.message ?? 'This action is unavailable.' : '';
      } catch (cause) { if (owns() && root === original && nativeState === graph) error = cause?.message ?? 'This action is unavailable.'; }
    }
  }
  function keydown(event) {
    if (openMenu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const popup = root?.querySelector('[role="menu"]');
      const items = popup ? [...popup.querySelectorAll('button:not(:disabled)')] : [];
      if (items.length) {
        event.preventDefault();
        const current = items.indexOf(root.ownerDocument.activeElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        command('native.focus', { controlId: items[index].dataset.callsControl });
      }
      return;
    }
    if (event.key === 'Tab') {
      const dialog = root?.querySelector('[role="dialog"][aria-modal="true"]');
      const nodes = dialog ? [...dialog.querySelectorAll('[data-calls-control]:not(:disabled)')].filter(node => node.getClientRects().length) : [];
      if (nodes.length) {
        const index = nodes.indexOf(root.ownerDocument.activeElement);
        if ((event.shiftKey && index <= 0) || (!event.shiftKey && (index < 0 || index === nodes.length - 1))) {
          event.preventDefault();
          command('native.focus', { controlId: nodes[event.shiftKey ? nodes.length - 1 : 0].dataset.callsControl });
        }
      }
    }
    if (event.key === 'Escape') {
      if (openMenu) { event.preventDefault(); command('menu.close', { restoreFocus: true }); }
      else if (view?.sheet !== 'none') { event.preventDefault(); command('sheet.close'); }
      else if (view?.pickerOpen) { event.preventDefault(); command('picker.close'); }
      return;
    }
    if (!event.metaKey && !event.ctrlKey) return;
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); command('native.focus', { controlId: 'search' }); }
    else if (event.key.toLowerCase() === 'n' && !live) { event.preventDefault(); command('contacts.resolve', { query: '' }); }
    else if (event.key.toLowerCase() === 'm' && event.shiftKey && live) { event.preventDefault(); command('media.set', { muted: !call.muted }); }
  }
  $effect(() => { if (!view?.pickerOpen && selectedIds.size) selectedIds = new Set(); });
  $effect(() => {
    const sheet = view?.sheet, picker = view?.pickerOpen, modern = !classic;
    if (sheet === 'none' && (!picker || !modern)) return;
    const original = root;
    tick().then(() => {
      if (!owns() || root !== original || view?.sheet !== sheet || view?.pickerOpen !== picker) return;
      const dialog = root.querySelector('[role="dialog"][aria-modal="true"]');
      const node = dialog?.querySelector('input:not(:disabled), select:not(:disabled), button:not(:disabled)');
      if (node && !dialog.contains(root.ownerDocument.activeElement)) node.focus({ preventScroll: true });
    });
  });
  onMount(() => {
    ownedRoot = root; ownedState = nativeState; mounted = true;
    const facade = createCallsNativeView({ getRoot: () => root, getState: () => nativeState, windowId, available: () => owns(), tick,
      getMenu: () => openMenu, setMenu: value => { openMenu = value; }, getMenus: () => menus, getAccount: () => controls.getAccount?.() ?? null,
      expand: typeof controls.onscreen === 'function' || typeof controls.onzoom === 'function' ? () => (controls.onscreen ?? controls.onzoom)() : null });
    registerView?.(windowId, facade);
    return () => { mounted = false; facade.destroy(); registerView?.(windowId, null, facade); };
  });
</script>

{#snippet icon(name, size = 20)}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={iconPaths[name] ?? iconPaths.person}/></svg>
{/snippet}

{#snippet portrait(self = false, moving = false, person = participant, index = 0)}
  <div class="calls-authored-portrait" class:self style:background-image="url('/calls/studio.svg')" style:--calls-person-hue={`${index * 47 % 360}deg`}>
    <svg viewBox="0 0 480 560" role="img" aria-label={self ? 'Locally authored fictional self portrait' : `Locally authored fictional portrait for ${person?.name ?? 'participant'}`}>
      <g transform={`translate(${moving ? Math.sin(phase * Math.PI * 2) * 2 : 0},${moving ? Math.cos(phase * Math.PI * 2) * 2 : 0})`}>
        <path fill={self ? '#344962' : '#bd684e'} d="M67 560v-101c0-76 74-119 173-119s173 43 173 119v101z"/>
        <path fill={self ? '#d8a47c' : '#b77e59'} d="M202 290h76v83c-16 25-60 25-76 0z"/>
        <path fill={self ? '#efbb91' : '#ce946e'} d="M138 164c0-92 204-92 204 0v86c0 76-48 111-102 111s-102-35-102-111z"/>
        <ellipse fill={self ? '#efbb91' : '#ce946e'} cx="136" cy="234" rx="14" ry="25"/><ellipse fill={self ? '#efbb91' : '#ce946e'} cx="344" cy="234" rx="14" ry="25"/>
        <path fill={self ? '#5c3d2e' : '#272825'} d={self ? 'M135 223v-62c-5-86 80-118 131-84 60-9 95 49 77 144l-20-68c-42 4-58-24-79-32-25 37-53 27-84 47l-7 55z' : 'M135 236c-33-93-4-164 78-177 92-25 148 34 134 167l-21-63c-39 9-106-17-137-45l-34 103z'}/>
        <path stroke={self ? '#785340' : '#594130'} stroke-width="5" fill="none" stroke-linecap="round" d="M173 214q18-10 34-1 M273 213q18-10 33 1"/>
        {#if moving && phase > 0.91 && phase < 0.97}<path stroke="#382d27" stroke-width="3" fill="none" d="M179 235h21m79 0h21"/>
        {:else}<ellipse fill="#302f2b" cx="190" cy="235" rx="5" ry="6"/><ellipse fill="#302f2b" cx="290" cy="235" rx="5" ry="6"/>{/if}
        <path stroke={self ? '#c88e6b' : '#a5684b'} stroke-width="3" fill="none" stroke-linecap="round" d="m239 235-8 37h15"/>
        {#if moving && speaking && (!self || !call?.muted)}<ellipse fill="#633d35" cx="240" cy="299" rx="18" ry={4 + Math.abs(Math.sin(phase * Math.PI * 18)) * 8}/><path stroke="#f4d4b6" stroke-width="3" d="M227 295h26"/>
        {:else}<path stroke="#7a463b" stroke-width="4" fill="none" stroke-linecap="round" d="M217 297q23 15 46 0"/>{/if}
        <path stroke={self ? '#49647d' : '#d3856b'} stroke-width="3" fill="none" d="M148 424v136m184-136v136"/>
      </g>
    </svg>
  </div>
{/snippet}

<div bind:this={root} class={`calls-app calls-${era}`} class:inactive={!active} class:live class:video-call={call?.kind === 'video' && live} data-calls-window-id={windowId} data-native-app={windows ? 'teams' : 'facetime'} onkeydown={keydown} role="region" aria-label={windows ? 'Microsoft Teams local calls' : 'FaceTime local calls'}>
  {#if !windows}
    <header class="calls-titlebar" data-window-drag-handle>
      <WindowControls {active} onclose={controls.onclose} onminimize={controls.onminimize} onzoom={controls.onzoom} onfullscreen={controls.onscreen} fullScreen={controls.fullScreen ?? false} zoomed={controls.zoomed ?? false} modernGreenMenu={golden} ongreenmenu={controls.green} onsplitbegin={controls.splitBegin} onsplitside={controls.splitSide}/>
      <span class="calls-window-title">FaceTime</span>
      {#if !classic}<button class="calls-title-account" aria-label="Account settings" data-window-no-drag data-calls-control="account" onclick={() => command('sheet.open', { sheet: 'account' })}>{account?.initials ?? initials(account?.name)}</button>{/if}
    </header>
  {/if}
  <nav class="calls-menu-strip" aria-label="Application menus" data-window-no-drag>
    {#each menus as menu (menu.id)}
      <div class="calls-menu-owner"><button class:chosen={openMenu === menu.id} data-calls-control={`menu:${menu.id}`} aria-haspopup="menu" aria-expanded={openMenu === menu.id} onclick={() => command(openMenu === menu.id ? 'menu.close' : 'menu.open', openMenu === menu.id ? { restoreFocus: false } : { menuId: menu.id })}>{menu.label}</button>
        {#if openMenu === menu.id}<div class="calls-menu-popover" role="menu" aria-label={menu.id}>
          {#each menu.items as item (item.id)}
            {#if item.separator}<div class="calls-menu-separator" role="separator"></div>
            {:else}<button role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={item.checked !== undefined ? item.checked : undefined} disabled={!item.enabled} data-calls-control={`menu-item:${item.id}`} onclick={() => runMenu(item)}><span class="calls-menu-check">{item.checked ? '✓' : ''}</span><span>{item.label}</span><kbd>{item.shortcut ?? ''}</kbd></button>{/if}
          {/each}
        </div>{/if}
      </div>
    {/each}
  </nav>
  {#if view}
    <div class="calls-workspace" inert={view.sheet !== 'none' || (view.pickerOpen && !classic && !live)}>
      <aside class="calls-sidebar" class:hidden-during-call={live && !classic}>
        {#if windows}<div class="calls-teams-brand"><span class="calls-teams-mark">T</span><strong>Microsoft Teams</strong><button class="calls-account-avatar" data-calls-control="account" aria-label="Manage account" onclick={() => command('sheet.open', { sheet: 'account' })}>{account?.initials ?? initials(account?.name)}</button></div>{/if}
        <div class="calls-sidebar-heading"><h1>{windows ? 'Calls' : 'FaceTime'}</h1>{#if !classic}<button class="calls-new-button" data-calls-control="new-call" disabled={live} onclick={() => command('contacts.resolve', { query: '' })}>{@render icon('add', 16)}<span>{preferences.defaultKind === 'audio' ? 'New audio call' : windows ? 'New video call' : 'New FaceTime'}</span></button>{/if}</div>
        {#if classic}<div class="calls-classic-tabs" aria-label="Recent call filter"><button class:selected={view.recentFilter === 'all'} aria-pressed={view.recentFilter === 'all'} data-calls-control="recents-all" onclick={() => command('recents.filter', { filter: 'all' })}>All</button><button class:selected={view.recentFilter === 'missed'} aria-pressed={view.recentFilter === 'missed'} data-calls-control="recents-missed" onclick={() => command('recents.filter', { filter: 'missed' })}>Missed</button></div>{/if}
        <form class="calls-search" onsubmit={event => { event.preventDefault(); if (canStart) command('start', callSpec(preferences.defaultKind)); }}>
          {@render icon('search', 15)}<input aria-label="Search calls or enter a name, email, or number" data-calls-control="search" value={view.query} maxlength="4096" placeholder={classic ? 'Enter a name, email, or number' : windows ? 'Search people or calls' : 'Search or enter a name'} oninput={search}/>
          <button type="button" aria-label="Choose from Contacts" data-calls-control="contacts" disabled={live} onclick={() => command('contacts.resolve', { query: view.query })}>{@render icon('add', 15)}</button>
        </form>
        {#if view.pickerOpen && classic}
          <section class="calls-picker" aria-label="Contacts recipient picker">
            <div class="calls-section-label">Contacts <small>Shared address book</small></div>
            <div class="calls-contact-list" data-calls-area="contacts">
              {#each view.recipients as contact (contact.id)}<button class:selected={contact.id === view.selectedContactId} data-calls-control={`recipient:${contact.id}`} onclick={() => command('recipient.select', { contactId: contact.id })}><span class="calls-contact-avatar">{initials(contact.name)}</span><span><strong>{contact.name}</strong><small>{contact.email || contact.phone || 'No call address'}</small></span>{#if contact.id === view.selectedContactId}{@render icon('check', 15)}{/if}</button>{/each}
              {#if !view.recipients.length}<p class="calls-empty-contacts">No matching Contacts. Enter an email address or phone number to place a fictional local call.</p>{/if}
            </div>
            <div class="calls-start-actions"><button class:calls-primary={preferences.defaultKind === 'audio'} disabled={!canStart} data-calls-control="start-audio" onclick={() => command('start', callSpec('audio'))}>{@render icon('phone', 15)} Audio</button><button class:calls-primary={preferences.defaultKind === 'video'} disabled={!canStart} data-calls-control="start-video" onclick={() => command('start', callSpec('video'))}>{@render icon('video', 17)} FaceTime</button></div>
          </section>
        {:else if view.query.trim() && !live}
          <div class="calls-query-actions"><span>{recipient?.name ?? view.query}</span><div class="calls-start-actions"><button class:calls-primary={preferences.defaultKind === 'audio'} disabled={!canStart} data-calls-control="start-audio" onclick={() => command('start', callSpec('audio'))}>{@render icon('phone', 15)} Audio</button><button class:calls-primary={preferences.defaultKind === 'video'} disabled={!canStart} data-calls-control="start-video" onclick={() => command('start', callSpec('video'))}>{@render icon('video', 17)} Video</button></div></div>
        {/if}
        {#if capabilities.groupSupported}<button class="calls-group-picker-button" data-calls-control="new-group" disabled={live || !account?.signedIn} onclick={() => command('contacts.resolve', { query: '' })}>{@render icon('person', 16)} New group call…</button>
        {:else}<p class="calls-group-unavailable">{capabilities.groupUnavailableReason}</p>{/if}
        <div class="calls-section-label">{windows ? 'Recent calls' : classic ? '' : 'Recents'}</div>
        <div class="calls-recents" data-calls-area="recents">
          {#each recentCalls as recent (recent.id)}
            <div class="calls-recent" class:selected={recent.id === view.callId} class:missed={recent.direction === 'incoming' && recent.connectedAt === null && ['ended', 'failed'].includes(recent.status)} data-calls-call-id={recent.id}>
              <button class="calls-recent-main" disabled={live && recent.id !== call?.id} data-calls-control={`recent:${recent.id}`} onclick={() => command('recent.select', { callId: recent.id })}>
                {#if !classic}<span class="calls-contact-avatar">{initials(recent.participants[0]?.name)}</span>{/if}
                <span class="calls-recent-text"><strong>{recent.participants.length > 1 ? `${recent.participants.slice(0, 2).map(row => row.name).join(', ')}${recent.participants.length > 2 ? ` +${recent.participants.length - 2}` : ''}` : recent.participants[0]?.name ?? 'Unknown caller'}</strong><small>{@render icon(recent.kind === 'video' ? 'video' : 'phone', 12)} {recent.direction === 'incoming' && recent.connectedAt === null && ['ended', 'failed'].includes(recent.status) ? 'Missed' : recent.direction === 'incoming' ? 'Incoming' : 'Outgoing'}{recent.participants.length > 1 ? ` · ${recent.participants.length} people` : classic ? '' : recent.kind === 'audio' ? ' audio' : ' video'}</small></span>
                <time datetime={new Date(recent.createdAt).toISOString()}>{recentDate(recent.createdAt)}</time>
              </button>
              {#if classic}{#each ['video', 'audio'] as kind}<button class="calls-recent-media" aria-label={`Call ${recent.participants[0]?.name ?? 'recipient'} with ${kind}`} data-calls-control={`recent-${kind}:${recent.id}`} disabled={live || !account?.signedIn} onclick={() => command('start', { kind, ...(recent.participants[0]?.contactId ? { contactId: recent.participants[0].contactId } : { name: recent.participants[0]?.name ?? '', address: recent.participants[0]?.address ?? '' }) })}>{@render icon(kind === 'video' ? 'video' : 'phone', 17)}</button>{/each}{/if}
              <button class="calls-recent-info" aria-label={`Details for ${recent.participants[0]?.name ?? 'call'}`} disabled={live && recent.id !== call?.id} data-calls-control={`detail:${recent.id}`} onclick={() => command('recent.select', { callId: recent.id })}>{@render icon('info', 17)}</button>
            </div>
          {/each}
          {#if !recentCalls.length}<div class="calls-no-recents"><strong>{view.query ? 'No matching calls' : 'No Recent Calls'}</strong><span>{view.query ? 'Try a different name or address.' : 'Your local call history will appear here.'}</span></div>{/if}
        </div>
        <button class="calls-sidebar-account" data-calls-control="account-sidebar" onclick={() => command('sheet.open', { sheet: 'account' })}><span class="calls-account-dot" class:signed-out={!account?.signedIn}></span><span>{account?.name ?? 'Account unavailable'}<small>{account?.signedIn ? account.address : 'Signed out'}</small></span>{@render icon('chevron', 14)}</button>
      </aside>
      <main class="calls-stage" class:connected class:audio={call?.kind === 'audio'} class:group-call={call?.participants.length > 1} data-calls-area="stage">
        {#if live}
          {#if call.participants.length > 1}
            <div class="calls-participant-gallery" data-calls-area="participants" aria-label="Actual call participants">
              {#each call.participants as person, index (person.id)}
                <section class="calls-participant-tile" data-calls-participant-id={person.id} aria-label={`${person.name}, ${person.address}`}>
                  {#if call.kind === 'video'}{@render portrait(false, connected, person, index)}{:else}<span class="calls-tile-initials">{initials(person.name)}</span>{/if}
                  <div class="calls-tile-caption"><span><strong>{person.name}</strong><small>{person.address}</small></span><button data-calls-control={`block:${person.id}`} disabled={isBlocked(person)} aria-label={`Block ${person.name}`} onclick={() => blockParticipant(person)}>{isBlocked(person) ? 'Blocked' : 'Block'}</button></div>
                </section>
              {/each}
              {#if call.kind === 'video' && !preferences.hideSelfView}<section class="calls-participant-tile calls-self-tile" aria-label="Your local self preview">
                {#if call.cameraEnabled}{@render portrait(true, connected)}{:else}<span class="calls-tile-initials">{account?.initials ?? initials(account?.name)}</span>{/if}
                <div class="calls-tile-caption"><span><strong>You {call.muted ? '· Muted' : ''}</strong><small>{call.cameraEnabled ? 'Local self preview' : 'Camera is off'}</small></span></div>
              </section>{/if}
            </div>
          {:else if call.kind === 'video'}
            <div class="calls-remote-media" class:unconnected={!connected} data-calls-participant-id={participant.id}>{@render portrait(false, connected)}</div>
          {:else}<div class="calls-audio-backdrop"></div><div class="calls-audio-avatar" data-calls-participant-id={participant.id}>{initials(participant?.name)}</div>{/if}
          <div class="calls-stage-top"><div><h2>{call.participants.length > 1 ? `Group call · ${call.participants.length + 1} people` : participant?.name ?? 'Unknown caller'}</h2><p aria-live="polite">{status}</p>
            {#if call.status === 'ringing'}<div class="calls-ring-cue" class:reflection={preferences.ringtone === 'Reflection'} aria-label={`${preferences.ringtone}: local visual ringing equivalent, no hardware audio`}>
              <span class="calls-ring-lights" aria-hidden="true">{#each [0, 1, 2] as pulse}<i style:opacity={preferences.ringtone === 'Reflection' ? 0.25 + Math.abs(Math.sin(sceneTime / 600 + pulse)) * 0.75 : Math.floor(sceneTime / 350) % 4 === pulse ? 1 : 0.25}></i>{/each}</span><small>{preferences.ringtone} · visual ring only</small>
            </div>{/if}
          </div><div class="calls-stage-tools">{#if call.participants.length === 1}<button data-calls-control="block-caller" disabled={isBlocked(participant)} onclick={() => blockParticipant(participant)}>{isBlocked(participant) ? 'Blocked' : 'Block caller'}</button>{/if}<button aria-label="Expand call window" data-calls-control="expand" onclick={() => command('window.expand')}>{@render icon('expand')}</button></div></div>
          {#if call.kind === 'video' && call.participants.length === 1 && !preferences.hideSelfView}<div class="calls-self-media" class:camera-off={!call.cameraEnabled}>
            {#if call.cameraEnabled}{@render portrait(true, connected)}{:else}<span class="calls-self-initials">{account?.initials ?? initials(account?.name)}</span><small>Camera is off</small>{/if}
            <span class="calls-self-label">You {call.muted ? '· Muted' : ''}</span>
          </div>{/if}
          <div class="calls-media-disclosure">Locally authored fictional {call.kind === 'video' ? 'portraits' : 'audio-call scene'} · no camera, microphone, network, or generated hardware audio</div>
          {#if connected}<div class="calls-speech-presentation" aria-label={call.muted ? 'Outgoing fictional speech muted' : 'Outgoing fictional speech visualization'}>
            <span>{call.muted ? 'You are muted' : 'Your fictional speech'}</span>
            {#if !call.muted}<div class="calls-speech-meter">{#each [0, 1, 2, 3, 4, 5, 6] as bar}<i style:height={`${speaking ? 4 + Math.abs(Math.sin(phase * 32 + bar * 1.1)) * 18 : 3}px`}></i>{/each}</div>{/if}
          </div>{/if}
          <div class="calls-call-controls">
            {#if incoming}<button class="calls-call-action decline" data-calls-control="decline" onclick={() => command('end')}>{@render icon('end', 23)}<span>Decline</span></button><button class="calls-call-action accept" data-calls-control="accept" onclick={() => command('accept')}>{@render icon(call.kind === 'video' ? 'video' : 'phone', 23)}<span>Accept</span></button>
            {:else}<button class="calls-call-action" class:toggled={call.muted} aria-pressed={call.muted} aria-label={call.muted ? 'Unmute fictional speech' : 'Mute fictional speech'} data-calls-control="mute" onclick={() => command('media.set', { muted: !call.muted })}>{@render icon(call.muted ? 'mute' : 'mic', 23)}<span>{call.muted ? 'Unmute' : 'Mute'}</span></button>
              {#if call.kind === 'video'}<button class="calls-call-action" class:toggled={!call.cameraEnabled} aria-pressed={!call.cameraEnabled} data-calls-control="camera" onclick={() => command('media.set', { cameraEnabled: !call.cameraEnabled })}>{@render icon('video', 23)}{#if !call.cameraEnabled}<span class="calls-camera-slash"></span>{/if}<span>{call.cameraEnabled ? 'Camera Off' : 'Camera On'}</span></button>{/if}
              <button class="calls-call-action decline" data-calls-control="end" onclick={() => command('end')}>{@render icon('end', 23)}<span>End</span></button>
            {/if}
          </div>
          <button class="calls-fail-action" data-calls-control="fail" onclick={() => command('fail', { reason: 'The fictional connection was interrupted.' })}>Simulate connection failure</button>
        {:else if call}
          <div class="calls-detail">
            <span class="calls-detail-avatar">{call.participants.length > 1 ? call.participants.length : initials(participant?.name)}</span><h2>{call.participants.length > 1 ? 'Group call' : participant?.name ?? 'Unknown caller'}</h2><p class="calls-detail-address">{call.participants.length > 1 ? `${call.participants.length} remote participants` : participant?.address}</p>
            <div class="calls-detail-buttons"><button data-calls-control="redial-audio" disabled={!account?.signedIn || (call.participants.length > 1 && call.participants.some(row => !row.contactId))} onclick={() => redial('audio')}>{@render icon('phone', 22)}<span>{call.participants.length > 1 ? 'Group audio' : 'Audio'}</span></button><button data-calls-control="redial-video" disabled={!account?.signedIn || (call.participants.length > 1 && call.participants.some(row => !row.contactId))} onclick={() => redial('video')}>{@render icon('video', 24)}<span>{call.participants.length > 1 ? 'Group video' : windows ? 'Video' : 'FaceTime'}</span></button></div>
            {#if call.participants.length > 1 && call.participants.some(row => !row.contactId)}<p class="calls-detail-address">Choose current Contacts in New Group Call to call this group again.</p>{/if}
            <div class="calls-detail-history"><strong>{status || 'Recent Call'}</strong><dl><dt>Type</dt><dd>{call.direction === 'incoming' ? 'Incoming' : 'Outgoing'} {call.kind} call</dd><dt>Date</dt><dd>{new Date(call.createdAt).toLocaleString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} UTC</dd><dt>Duration</dt><dd>{elapsed}</dd></dl>{#if call.failure}<p role="status" class="calls-failure-message">{call.failure}</p>{/if}</div>
            <ul class="calls-detail-participants" aria-label="Call participants">{#each call.participants as person (person.id)}<li><span><strong>{person.name}</strong><small>{person.address}</small></span><button data-calls-control={`block:${person.id}`} disabled={isBlocked(person)} onclick={() => blockParticipant(person)}>{isBlocked(person) ? 'Blocked' : 'Block caller'}</button></li>{/each}</ul>
            <small>Fictional local call record. No remote connection was made.</small>
          </div>
        {:else}
          {#if !preferences.hideSelfView}<div class="calls-idle-preview">{@render portrait(true, false)}<span>Fictional local self preview · no camera</span></div>{/if}
          <div class="calls-welcome"><span class="calls-app-symbol">{@render icon('video', 42)}</span><h2>{windows ? 'Make a call' : 'FaceTime'}</h2><p>{account?.signedIn ? 'Choose a contact or enter an address to start an audio or video call.' : 'Sign in to your fictional shared account to make local calls.'}</p>
            <button class="calls-primary" data-calls-control="welcome-action" onclick={() => command(account?.signedIn ? 'contacts.resolve' : 'sheet.open', account?.signedIn ? { query: '' } : { sheet: 'account' })}>{account?.signedIn ? preferences.defaultKind === 'audio' ? 'New audio call' : windows ? 'New video call' : 'New FaceTime' : 'Sign In'}</button><small>Authored local scenes only. No camera, microphone, or network.</small></div>
        {/if}
        {#if error}<div class="calls-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onclick={() => { error = ''; }}>{@render icon('close', 14)}</button></div>{/if}
      </main>
    </div>
    {#if view.pickerOpen && !classic && !live && view.sheet === 'none'}
      <div class="calls-sheet-backdrop"><section class="calls-sheet calls-recipient-sheet" role="dialog" aria-modal="true" aria-labelledby={`calls-new-title-${windowId}`} data-calls-area="dialog">
        <header><h2 id={`calls-new-title-${windowId}`}>{windows ? 'New call' : 'New FaceTime'}</h2><button aria-label="Close recipient picker" data-calls-control="picker-close" onclick={() => command('picker.close')}>{@render icon('close', 16)}</button></header>
        <form class="calls-recipient-form" onsubmit={event => { event.preventDefault(); startPicker(); }}><label for={`calls-to-${windowId}`}>To:</label><input id={`calls-to-${windowId}`} data-calls-control="search" value={view.query} maxlength="4096" placeholder="Name, email, or number" aria-label="Recipient name, email, or number" oninput={search}/></form>
        <div class="calls-group-selection"><span>{selectedIds.size ? `${selectedIds.size} selected` : 'Choose one or more people'}</span><small>Up to {capabilities.maxRemoteParticipants + 1} including you</small>{#if selectedIds.size}<button data-calls-control="selection-clear" onclick={() => { selectedIds = new Set(); }}>Clear selection</button>{/if}</div>
        {#if selectedIds.size}<div class="calls-selected-recipients" aria-label="Selected canonical contact identities">{#each [...selectedIds] as contactId (contactId)}<button data-calls-control={`remove-selected:${contactId}`} aria-label={`Remove ${view.recipients.find(row => row.id === contactId)?.name ?? contactId}`} onclick={() => { const next = new Set(selectedIds); next.delete(contactId); selectedIds = next; }}>{view.recipients.find(row => row.id === contactId)?.name ?? contactId} ×</button>{/each}</div>{/if}
        {#if view.recipients.length && !view.query.trim()}<div class="calls-suggested-heading">Suggested · from Contacts</div><div class="calls-suggested">{#each view.recipients.slice(0, 4) as contact (contact.id)}<button class:selected={selectedIds.has(contact.id)} aria-pressed={selectedIds.has(contact.id)} data-calls-control={`suggested:${contact.id}`} onclick={() => selectContact(contact.id)}><span>{initials(contact.name)}</span><strong>{contact.name}</strong></button>{/each}</div>{/if}
        <div class="calls-modal-contacts calls-contact-list" data-calls-area="contacts">{#each view.recipients as contact (contact.id)}<button class:selected={selectedIds.has(contact.id)} aria-pressed={selectedIds.has(contact.id)} data-calls-control={`recipient:${contact.id}`} onclick={() => selectContact(contact.id)}><span class="calls-contact-avatar">{initials(contact.name)}</span><span><strong>{contact.name}</strong><small>{contact.email || contact.phone || 'No call address'}</small></span>{#if selectedIds.has(contact.id)}{@render icon('check', 15)}{/if}</button>{/each}{#if !view.recipients.length}<p class="calls-empty-contacts">{view.query ? 'No matching Contacts. A single fictional address may still be called.' : 'No shared Contacts are available. Enter an email address or phone number for a single call.'}</p>{/if}</div>
        <p class="calls-picker-note">Group recipients are re-resolved from shared Contacts. Fictional local media only.</p>
        {#if error}<p class="calls-sheet-error" role="alert">{error}</p>{/if}
        <footer><button data-calls-control="picker-cancel" onclick={() => command('picker.close')}>Cancel</button><button class:calls-primary={preferences.defaultKind === 'audio'} disabled={!canStartPicker} data-calls-control="start-audio" onclick={() => startPicker('audio')}>{@render icon('phone', 15)} {selectedIds.size > 1 ? 'Group audio' : 'Audio'}</button><button class:calls-primary={preferences.defaultKind === 'video'} disabled={!canStartPicker} data-calls-control="start-video" onclick={() => startPicker('video')}>{@render icon('video', 17)} {selectedIds.size > 1 ? 'Group video' : windows ? 'Video call' : 'FaceTime'}</button></footer>
      </section></div>
    {/if}
    {#if view.sheet !== 'none'}
      <div class="calls-sheet-backdrop"><section class="calls-sheet" role="dialog" aria-modal="true" aria-labelledby={`calls-sheet-title-${windowId}`} data-calls-area="dialog">
        <header><h2 id={`calls-sheet-title-${windowId}`}>{view.sheet === 'account' ? 'Your account' : view.sheet === 'preferences' || view.sheet === 'blocked' ? windows ? view.sheet === 'blocked' ? 'Blocked Callers' : 'Call settings' : classic ? 'FaceTime Preferences' : 'FaceTime Settings' : windows ? 'About local Teams calls' : 'FaceTime Help'}</h2><button aria-label="Close panel" data-calls-control="sheet-close" onclick={() => command('sheet.close')}>{@render icon('close', 16)}</button></header>
        {#if view.sheet !== 'help'}<nav class="calls-settings-tabs" aria-label="Settings sections">{#each (windows ? [{ id: 'account', label: 'Account' }, { id: 'preferences', label: 'Calls' }, { id: 'blocked', label: 'Blocked' }] : [{ id: 'preferences', label: classic ? 'Settings' : 'General' }, { id: 'blocked', label: 'Blocked' }]) as tab (tab.id)}<button class:selected={view.sheet === tab.id || (!windows && view.sheet === 'account' && tab.id === 'preferences')} aria-pressed={view.sheet === tab.id || (!windows && view.sheet === 'account' && tab.id === 'preferences')} data-calls-control={`settings-tab:${tab.id}`} onclick={() => command('sheet.open', { sheet: tab.id })}>{tab.label}</button>{/each}</nav>{/if}
        {#if view.sheet === 'account' || (!windows && view.sheet === 'preferences')}
          <div class="calls-account-heading"><span>{account?.initials ?? initials(account?.name)}</span><div><strong>{account?.name ?? 'Shared account unavailable'}</strong><p>{account?.address ?? 'No shared account bridge is available.'}</p></div></div>
          <div class="calls-account-settings"><label><input type="checkbox" data-calls-control="account-signed-in" checked={account?.signedIn ?? false} disabled={!account} onchange={event => command('account.set', { signedIn: event.currentTarget.checked, status: account.status })}/> {windows ? 'Signed in to Teams' : 'Enable this account'}</label>
            <label class="calls-status-setting">Fictional availability<select data-calls-control="account-status" value={account?.status ?? 'Available'} disabled={!account} onchange={event => command('account.set', { signedIn: account.signedIn, status: event.currentTarget.value })}>{#each ['Available', 'Busy', 'Do not disturb', 'Be right back', 'Away', 'Offline'] as option}<option value={option}>{option}</option>{/each}</select></label>
            <p>You can be reached for local calls at:</p><label class="calls-reachable-address"><input type="checkbox" checked={account?.signedIn ?? false} disabled/>{account?.address ?? 'Unavailable'}</label>
          </div><p class="calls-account-note">This identity is shared with Messages and Contacts. Signing in or changing availability updates the shared fictional account, not an Apple or Microsoft service.</p>
        {/if}
        {#if view.sheet === 'preferences'}
          <div class="calls-preferences">
            <label><input type="checkbox" data-calls-control="notifications-enabled" checked={preferences.notificationsEnabled} onchange={event => setPreference('notificationsEnabled', event)}/> Show incoming call notifications</label>
            <p>Controls actual shared notification delivery for local incoming calls.</p>
            <label class="calls-preference-choice">Default call type<select data-calls-control="default-kind" value={preferences.defaultKind} onchange={event => setPreference('defaultKind', event)}><option value="video">Video</option><option value="audio">Audio</option></select></label>
            <label class="calls-preference-choice">Ringtone<select data-calls-control="ringtone" value={preferences.ringtone} onchange={event => setPreference('ringtone', event)}><option value="Opening">Opening</option><option value="Reflection">Reflection</option></select></label>
            <p>Ringtone names select the authored visual ringing pattern. This local equivalent produces no hardware audio.</p>
            <label><input type="checkbox" data-calls-control="hide-self-view" checked={preferences.hideSelfView} onchange={event => setPreference('hideSelfView', event)}/> Hide self view</label>
            <p>Removes your preview, not the camera setting. Camera Off still controls your authored local image.</p>
            <button data-calls-control="manage-blocked" onclick={() => command('sheet.open', { sheet: 'blocked' })}>Manage blocked callers…</button>
          </div>
        {:else if view.sheet === 'blocked'}
          <div class="calls-blocked-manager"><p>Blocked endpoints are shared with Messages and cannot receive local calls.{#if !windows} You can still call a blocked FaceTime caller without unblocking them.{/if} Select Block caller on an actual participant to add an endpoint.</p>{#if windows}<p>Teams uses this scene’s fictional shared communications block list, which also disables outgoing and group calls to blocked endpoints. No Microsoft account or remote block setting is changed.</p>{/if}
            <button data-calls-control="blocked-add" disabled={!account?.signedIn || blockedCallers === null} onclick={() => command('contacts.resolve', { query: '' })}>Add…</button>
            {#if view.pickerOpen}<div class="calls-blocked-picker"><header><strong>Choose a contact to block</strong><button data-calls-control="blocked-picker-close" onclick={() => command('picker.close')}>Done</button></header><input data-calls-control="blocked-contact-search" aria-label="Search Contacts to block" placeholder="Search Contacts" oninput={event => command('contacts.resolve', { query: event.currentTarget.value })}/><ul data-calls-area="contacts">{#each view.recipients as row (row.id)}<li><span><strong>{row.name}</strong><small>{row.email || row.phone || 'No call address'}</small></span><button data-calls-control={`block-contact:${row.id}`} disabled={!(row.email || row.phone) || isBlocked({ address: row.email || row.phone })} onclick={() => command('block', { address: row.email || row.phone, contactId: row.id })}>{isBlocked({ address: row.email || row.phone }) ? 'Blocked' : 'Block'}</button></li>{/each}</ul>{#if !view.recipients.length}<div class="calls-blocked-empty">No matching Contacts</div>{/if}</div>{/if}
            <ul data-calls-area="blocked">{#each blockedCallers ?? [] as blocked (blocked.address)}<li><span><strong>{blocked.name ?? blocked.address}</strong><small>{blocked.address}</small></span><button data-calls-control={`unblock:${blocked.address}`} aria-label={`Unblock ${blocked.name ?? blocked.address}`} onclick={() => command('unblock', { address: blocked.address })}>{windows ? 'Unblock' : 'Remove'}</button></li>{/each}</ul>
            {#if blockedCallers === null}<div class="calls-blocked-empty">Shared blocked endpoint authority unavailable</div>{:else if !blockedCallers.length}<div class="calls-blocked-empty">No blocked callers</div>{/if}
          </div>
        {:else if view.sheet === 'help'}<div class="calls-help-content"><span class="calls-app-symbol">{@render icon('video', 36)}</span><h3>{windows ? 'Microsoft Teams call surface' : 'FaceTime call surface'}</h3><p>Choose a recipient from the shared Contacts picker, or enter a name, email address, or number. Audio and video calls, incoming acceptance, recents, and failures are local authored scenes.</p><p>The shared scene clock drives connection transitions, duration, portrait movement, and outgoing speech visualization. Mute removes your fictional speech meter and mouth movement; camera off removes the authored self image. No camera, microphone, telephone, remote service, or generated hardware audio is used.</p><p>Use the Call{windows ? '' : '/Video'} menu to introduce a local incoming call or a connection failure. Expand uses the actual desktop window callback.</p><p>{capabilities.groupSupported ? `Select several actual Contacts to start a local group call, with up to ${capabilities.maxRemoteParticipants} remote participants (${capabilities.maxRemoteParticipants + 1} including you). Every participant shown comes from the actual call record. Search changes the available Contacts, not the selected canonical identities; the command re-resolves all selected IDs before committing.` : capabilities.groupUnavailableReason}</p>{#if !windows && capabilities.groupSupported}<p>The 32-person total is this scene’s conservative local capacity. Apple’s living Sonoma guide also says “32 other people”; exact native capacity is not certified here.</p>{/if}<p>Settings control actual incoming shared notifications, default audio/video call actions, and self-preview visibility. Opening and Reflection are local visual ringing equivalents, not hardware audio. Block caller uses an actual displayed participant; the Blocked panel derives the single shared endpoint list. FaceTime suppresses incoming calls from blocked callers while still allowing outgoing and group calls. The Windows fictional shared equivalent additionally suppresses outgoing and group calls to blocked endpoints.</p>{#if golden}<p>The current-era glass styling is a local interpretation of Apple's living FaceTime guide, not a verified macOS 27.0.1 binary.</p>{/if}</div>{/if}
        {#if error}<p role="alert" class="calls-sheet-error">{error}</p>{/if}<footer><button class="calls-primary" data-calls-control="sheet-done" onclick={() => command('sheet.close')}>Done</button></footer>
      </section></div>
    {/if}
  {:else}<div class="calls-unavailable">This call window is no longer available.</div>{/if}
</div>
