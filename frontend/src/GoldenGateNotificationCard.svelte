<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import AppIcon from './AppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  import Windows11Icon from './Windows11Icon.svelte';

  let { profile, entry, app, ownerTarget, actions = [], snoozeChoices = [], showPreview = true,
    itemUi = { expanded: false, optionsOpen: false, replyBody: null }, timestamp = '',
    foreground = true, execute, onerror } = $props();
  const renderer = $derived(profile.renderer);
  const windows = $derived(renderer === 'windows11');
  const classic = $derived(renderer === 'high-sierra' || renderer === 'mojave');
  const golden = $derived(renderer === 'golden-gate');
  const Icon = $derived(windows ? Windows11Icon : renderer === 'high-sierra' ? HighSierraAppIcon : classic ? AppIcon : golden ? GoldenGateIcon : SonomaIcon);
  let card = $state(null);
  let ownerRoot = null, ownerNode = null, disposed = false, sequence = 0;
  const has = action => actions.includes(action);
  const target = () => ({ ...ownerTarget, notificationId: entry.id });
  function current(owner) {
    return !disposed && card === owner.node && card === ownerNode && card?.isConnected
      && card.closest('[data-session-scene]') === ownerRoot && ownerRoot?.isConnected
      && entry === owner.entry && owner.id === entry.id
      && owner.centerId === ownerTarget.centerId && owner.bannerId === ownerTarget.bannerId;
  }
  const lease = () => ({ node: card, entry, id: entry.id, ...ownerTarget });
  function available(node = card) {
    if (!foreground || !current(lease()) || !node?.isConnected || !card.contains(node) || node.disabled) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (parent.hidden || parent.inert || parent.hasAttribute('inert') || parent.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return node.getClientRects().length > 0;
  }
  async function request(event, command, payload = {}, settings = false) {
    const node = event.currentTarget, owner = lease(), requestId = ++sequence;
    if (!available(node)) return;
    try {
      const result = await execute(`notifications.${command}`, settings ? {} : target(), settings ? { appId: entry.appId } : payload);
      if (current(owner) && available(node) && requestId === sequence) onerror?.(result.status === 'rejected' ? result.error.message : null);
    } catch (cause) {
      if (current(owner) && available(node) && requestId === sequence) onerror?.(cause?.message ?? 'The notification action could not be completed.');
    } finally {
      await tick();
      if (current(owner) && available(node) && requestId === sequence && node.dataset.notificationControl === `reply-body:${owner.id}`
        && typeof itemUi.replyBody === 'string' && node.value !== itemUi.replyBody) node.value = itemUi.replyBody;
    }
  }
  onMount(() => { ownerNode = card; ownerRoot = card.closest('[data-session-scene]'); });
  onDestroy(() => { disposed = true; });
</script>

<article class="notification-card" class:classic class:windows class:golden class:expanded={itemUi.expanded} bind:this={card} data-notification-profile={renderer} data-notification-id={entry.id} aria-label={`${app.name} notification`}>
  {#if has('open')}
    <button class="content" data-notification-control={`open:${entry.id}`} aria-label={entry.destination?.kind === 'call' ? 'Show Call' : undefined} onclick={event => request(event, 'item.open')}>
      <span class="meta"><span class="app-icon"><Icon name={app.icon} assets={profile.assets} /></span><strong>{app.name}</strong>{#if timestamp}<time>{timestamp}</time>{/if}</span>
      <strong class="title">{showPreview ? entry.title : 'Notification'}</strong>
      {#if showPreview}<span class="body" class:preview={!itemUi.expanded}>{entry.body}</span>{:else}<span class="hidden-preview">Preview hidden</span>{/if}
      {#if entry.destination?.kind === 'call'}<span class="show-call-label">Show Call</span>{/if}
    </button>
  {:else}
    <div class="content">
      <div class="meta"><span class="app-icon"><Icon name={app.icon} assets={profile.assets} /></span><strong>{app.name}</strong>{#if timestamp}<time>{timestamp}</time>{/if}</div>
      <h3 class="title">{showPreview ? entry.title : 'Notification'}</h3>
      {#if showPreview}<p class="body" class:preview={!itemUi.expanded}>{entry.body}</p>{:else}<p class="hidden-preview">Preview hidden</p>{/if}
    </div>
  {/if}
  <div class="card-controls">
    <button class="details" data-notification-control={`details:${entry.id}`} aria-label={itemUi.expanded ? 'Show fewer notification details' : 'Show notification details'}
      aria-expanded={itemUi.expanded} onclick={event => request(event, 'item.expand', { expanded: !itemUi.expanded })}>{itemUi.expanded ? '⌃' : '⌄'}</button>
    {#if has('reply') && itemUi.replyBody === null}<button data-notification-control={`reply:${entry.id}`} onclick={event => request(event, 'reply.open')}>Reply</button>{/if}
    {#if has('decline')}<button class="decline-call" data-notification-control={`decline:${entry.id}`} onclick={event => request(event, 'item.decline')}>Decline</button>{/if}
    {#if has('accept')}<button class="accept-call" data-notification-control={`accept:${entry.id}`} onclick={event => request(event, 'item.accept')}>Accept</button>{/if}
    <button data-notification-control={`options:${entry.id}`} aria-expanded={itemUi.optionsOpen} onclick={event => request(event, 'options.setOpen', { open: !itemUi.optionsOpen })}>{classic && ownerTarget.bannerId && has('snooze') ? 'Snooze…' : 'Options'}</button>
  </div>
  {#if itemUi.optionsOpen}
    <div class="options" aria-label="Notification options">
      {#if has('snooze')}
        <span class="option-label">Snooze</span>
        <div class="snooze-actions">{#each snoozeChoices as minutes}<button data-notification-control={`snooze:${entry.id}:${minutes}`}
          onclick={event => request(event, 'item.snooze', { minutes })}>{minutes === 60 ? '1 hour' : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`}</button>{/each}</div>
      {/if}
      {#if has('complete')}<button data-notification-control={`complete:${entry.id}`} onclick={event => request(event, 'item.complete')}>Complete</button>{/if}
      <button data-notification-control={`settings:${entry.id}`} onclick={event => request(event, 'settings.open', {}, true)}>Notification Settings…</button>
    </div>
  {/if}
  {#if has('reply') && typeof itemUi.replyBody === 'string'}
    <div class="reply">
      <label for={`notification-reply-${ownerTarget.centerId ?? ownerTarget.bannerId}-${entry.id}`}>Reply locally</label>
      <textarea id={`notification-reply-${ownerTarget.centerId ?? ownerTarget.bannerId}-${entry.id}`} rows="3" value={itemUi.replyBody}
        data-notification-control={`reply-body:${entry.id}`} oninput={event => request(event, 'reply.update', { body: event.currentTarget.value })}></textarea>
      <div class="reply-actions"><button data-notification-control={`reply-cancel:${entry.id}`} onclick={event => request(event, 'reply.cancel')}>Cancel</button>
        <button class="send" data-notification-control={`reply-send:${entry.id}`} disabled={!itemUi.replyBody.trim()} onclick={event => request(event, 'reply.send')}>Send Locally</button></div>
      <p class="local-note">Sends to the scene’s local outbox, not a real account.</p>
    </div>
  {/if}
</article>

<style>
  .notification-card { --notification-material:color-mix(in srgb,var(--appearance-surface,#fff) 90%,transparent); min-width:0; border:1px solid var(--appearance-light-edge,#ffffff8a); border-radius:24px; background:var(--notification-material); backdrop-filter:blur(25px); box-shadow:0 5px 20px #0002; color:var(--appearance-ink,#242427); font:13px var(--golden-gate-font,-apple-system,BlinkMacSystemFont,sans-serif); overflow-wrap:anywhere; }
  button { border:0; cursor:default; color:inherit; font:inherit; }
  .content { display:block; box-sizing:border-box; width:100%; padding:15px 18px 7px; border-radius:24px 24px 0 0; text-align:left; background:transparent; }
  .meta { display:flex; align-items:center; gap:7px; min-width:0; font-size:11px; }
  .meta strong { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  time { margin-left:auto; flex-shrink:0; font-size:10px; opacity:.66; }
  .app-icon { display:block; flex:0 0 22px; width:22px; height:22px; }
  .app-icon :global(svg) { width:100%; height:100%; }
  .title { display:block; margin:9px 0 4px; font-size:13px; line-height:1.35; font-weight:600; white-space:pre-wrap; }
  .body { display:block; margin:0; font-size:12px; line-height:1.5; white-space:pre-wrap; }
  .preview { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
  .hidden-preview { display:block; margin:0; font-size:12px; opacity:.65; }
  .card-controls { display:flex; justify-content:flex-end; gap:6px; padding:4px 12px 10px; flex-wrap:wrap; }
  .card-controls button,.options button,.reply-actions button { border-radius:9px; padding:5px 9px; background:var(--appearance-soft-border,#8882); font-size:11px; }
  .card-controls .details { margin-right:auto; min-width:27px; font-size:17px; line-height:15px; }
  .options,.reply { border-top:1px solid var(--appearance-soft-border,#8883); margin:0 12px; padding:10px 0 12px; }
  .options { display:flex; flex-direction:column; align-items:stretch; gap:7px; }
  .option-label,.reply label { font-size:11px; font-weight:600; }
  .snooze-actions { display:flex; flex-wrap:wrap; gap:5px; }
  .reply textarea { box-sizing:border-box; display:block; width:100%; min-width:0; margin:6px 0 8px; resize:vertical; min-height:55px; border:1px solid var(--appearance-soft-border,#8885); border-radius:8px; padding:8px; color:inherit; background:var(--appearance-surface,#fff); font:12px/1.4 var(--golden-gate-font,sans-serif); }
  .reply-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:6px; }
  .reply-actions .send { background:var(--appearance-accent,#0878ef); color:var(--appearance-accent-ink,#fff); }
  .local-note { margin:8px 0 0; font-size:10px; opacity:.65; }
  button:disabled { opacity:.45; }
  button:focus-visible,textarea:focus-visible { outline:2px solid var(--appearance-focus,#0878ef); outline-offset:2px; }
  .app-icon :global(img),.app-icon :global(.app-icon) { display:block; width:100%; height:100%; object-fit:contain; }
  .notification-card:not(.golden):not(.classic):not(.windows) { border-radius:16px; }
  .classic { border-radius:4px; background:var(--appearance-surface,#f5f5f5); box-shadow:0 1px 3px #0002; font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif; }
  .classic .content { padding:10px 12px 5px; border-radius:4px 4px 0 0; }
  .classic .app-icon { width:20px; height:20px; flex-basis:20px; }
  .classic .title { margin:5px 0 2px; font-size:12px; }
  .classic .body { font-size:12px; line-height:1.35; }
  .classic .card-controls { padding:3px 8px 7px; gap:1px; }
  .classic .card-controls button,.classic .options button,.classic .reply-actions button { border-radius:3px; border:1px solid var(--appearance-soft-border,#bbb); padding:3px 8px; background:var(--appearance-panel,#fafafa); }
  .windows { border-radius:8px; border-color:var(--appearance-soft-border,#d5d5d5); background:var(--appearance-surface,#fff); box-shadow:none; font:12px/1.45 'Segoe UI',sans-serif; }
  .windows .content { padding:14px 16px 5px; border-radius:8px 8px 0 0; }
  .windows .title { margin-top:10px; font-size:14px; }
  .windows .meta { padding-right:23px; font-size:12px; }
  .windows .app-icon { width:18px; height:18px; flex-basis:18px; }
  .windows .card-controls button,.windows .options button,.windows .reply-actions button { border-radius:4px; min-height:28px; }
  .windows .reply textarea { border-radius:4px; font-family:'Segoe UI',sans-serif; }
  .show-call-label { display:block; margin-top:7px; font-size:11px; color:var(--appearance-accent,#0878ef); }
  .card-controls .accept-call { background:#24833d; color:#fff; }
  .card-controls .decline-call { background:#be3934; color:#fff; }
</style>
