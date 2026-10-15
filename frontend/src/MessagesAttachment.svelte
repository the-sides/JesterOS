<script>
  import { onMount, tick } from 'svelte';
  import { registerMessagesAttachmentPresentation } from './messages-attachment-presentation.js';
  import MessagesAudioPreview from './MessagesAudioPreview.svelte';
  import MessagesPdfQuickLook from './MessagesPdfQuickLook.svelte';
  import { attachmentContent } from './messages-rich-commands.js';
  import { documentFileMime } from './document-destination-commands.js';
  let { attachment, state: messageState, windowId, execute, profile, available = true, conversationId = null, messageId = null, draftId = null, sharedDetails = false } = $props();
  const attachmentMime = $derived(documentFileMime(attachment));
  let root;
  let expanded = $state(false);
  let error = $state('');
  let menuOpen = $state(false);
  let menuRoot;
  let actionsAnchor;
  let menuAnchor;
  let menuLeft = $state(0);
  let menuTop = $state(0);
  let menuScale = $state(1);
  let mounted = $state(false);
  let originalAttachment;
  let originalContents;
  let originalState;
  let originalWindowId;
  let originalExecute;
  let originalProfile;
  let host;
  let originalConversationId;
  let originalMessageId;
  let originalDraftId;
  let originalConversations;
  let originalDrafts;
  let originalConversation;
  let originalItems;
  let originalMessage;
  let originalDraft;
  let originalAttachments;
  onMount(() => {
    originalState = messageState; originalWindowId = windowId; originalExecute = execute; originalProfile = profile;
    originalAttachment = attachment; originalContents = JSON.stringify(attachment);
    host = root.closest('[data-messages-window-id]');
    originalConversationId = conversationId; originalMessageId = messageId; originalDraftId = draftId;
    originalConversations = messageState.conversations; originalDrafts = messageState.drafts;
    originalConversation = originalConversations.find(row => row.id === conversationId);
    originalItems = originalConversation?.items;
    originalMessage = originalItems?.find(row => row.id === messageId);
    originalDraft = originalDrafts.find(row => row.id === draftId);
    originalAttachments = (draftId ? originalDraft : originalMessage)?.attachments;
    mounted = true;
    const unregister = registerMessagesAttachmentPresentation(root, { target: Object.freeze({ windowId, attachmentId: attachment.id,
      ...(draftId ? { draftId } : { conversationId, messageId }) }),
      describe: () => owns() ? { kind: attachment.kind, ...(attachment.kind === 'image' ? { expanded } : {}), menuOpen } : null,
      present: async (payload, guard) => {
      if (!owns() || !guard()) return false;
      if (typeof payload.menuOpen === 'boolean') return payload.menuOpen ? showMenu(payload.point, guard) : closeMenu(true);
      if (attachment.kind !== 'image' || typeof payload.expanded !== 'boolean') return false;
      expanded = payload.expanded; await tick();
      return owns() && guard() && expanded === payload.expanded;
    } });
    const escape = event => {
      if (event.key === 'Escape' && owns() && (expanded || menuOpen)) {
        event.preventDefault(); event.stopPropagation(); if (expanded) void preview({ expanded: false }); if (menuOpen) void preview({ menuOpen: false });
      }
    };
    const dismiss = event => {
      if (menuOpen && owns() && !menuRoot?.contains(event.target)
        && !event.target.closest?.('[data-messages-control^="attachment-actions:"]')) void preview({ menuOpen: false });
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('pointerdown', dismiss, true);
    return () => {
      mounted = false; unregister();
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('pointerdown', dismiss, true);
    };
  });
  const owns = () => mounted && available && root?.isConnected && messageState === originalState && windowId === originalWindowId
    && execute === originalExecute && profile === originalProfile && root.closest('[data-messages-window-id]') === host
    && attachment === originalAttachment && JSON.stringify(attachment) === originalContents
    && conversationId === originalConversationId && messageId === originalMessageId && draftId === originalDraftId
    && messageState.conversations === originalConversations && messageState.drafts === originalDrafts
    && (draftId ? messageState.selectedDraftId === draftId && originalDrafts.includes(originalDraft) && originalDraft.attachments === originalAttachments
      : messageState.selectedConversationId === conversationId && originalConversations.includes(originalConversation) && originalConversation.items === originalItems
        && originalItems.includes(originalMessage) && originalMessage.attachments === originalAttachments)
    && originalAttachments?.includes(originalAttachment) && !root.closest('[hidden], [inert]');
  function availableMenuAnchor(node) {
    if (!owns() || !node?.isConnected || !root.contains(node) || node.disabled || node.closest('[hidden], [inert]')) return false;
    const rect = node.getBoundingClientRect(), style = node.ownerDocument.defaultView.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none'
      && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0';
  }
  function closeMenu(restoreFocus = false) {
    if (!owns()) return false;
    const active = root.ownerDocument.activeElement;
    const returnFocus = restoreFocus && menuOpen && (host.contains(active) || active === host.closest('[data-window-id]'));
    menuRoot?.hidePopover(); menuOpen = false;
    if (returnFocus && availableMenuAnchor(menuAnchor))
      menuAnchor.focus({ preventScroll: true });
    menuAnchor = null;
    return owns();
  }
  function menuAction(name) {
    if (closeMenu(true)) void action(name);
  }
  function context(event) {
    if (!owns() || draftId) return;
    event.preventDefault(); event.stopPropagation();
    const invoker = event.target.closest?.('button, input, textarea, select, a[href], [tabindex]');
    menuAnchor = availableMenuAnchor(invoker) ? invoker : availableMenuAnchor(actionsAnchor) ? actionsAnchor : null;
    void preview({ menuOpen: !menuOpen, ...(!menuOpen ? { point: { x: event.clientX, y: event.clientY } } : {}) });
  }
  async function showMenu(point, guard) {
    if (!owns() || !guard() || draftId) return false;
    menuOpen = true;
    if (!availableMenuAnchor(menuAnchor)) menuAnchor = availableMenuAnchor(actionsAnchor) ? actionsAnchor : root.querySelector('.messages-attachment-image, .messages-attachment-file');
    const bounds = root.getBoundingClientRect();
    menuScale = root.offsetWidth ? bounds.width / root.offsetWidth : 1;
    menuLeft = point && (point.x || point.y) ? point.x : bounds.left;
    menuTop = point && (point.x || point.y) ? point.y : bounds.bottom;
    await tick();
    if (!menuOpen || !owns() || !guard() || !menuRoot?.isConnected) return false;
    menuRoot.showPopover();
    const menuBounds = menuRoot.getBoundingClientRect(), viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    menuLeft = Math.max(left + 4, Math.min(menuLeft, left + width - menuBounds.width - 4));
    menuTop = Math.max(top + 4, Math.min(menuTop, top + height - menuBounds.height - 4));
    return owns() && guard() && menuOpen;
  }
  function preview(payload) {
    if (!owns()) return null;
    return execute('messages.attachment.preview', { windowId, attachmentId: attachment.id,
      ...(draftId ? { draftId } : { conversationId, messageId }) }, payload);
  }
  function doubleClick() {
    if (!owns() || draftId) return;
    expanded = false;
    void action(sharedDetails && ['high-sierra', 'mojave'].includes(profile.renderer) ? 'open' : 'quickLook');
  }
  async function action(name) {
    if (!owns()) return;
    const owner = root, originalAttachment = attachment, contents = JSON.stringify(attachment);
    const originalConversationId = conversationId, originalMessageId = messageId, originalDraftId = draftId;
    const target = { windowId, ...(draftId ? { draftId } : { conversationId, messageId, attachmentId: attachment.id }) };
    const result = await execute(`messages.${draftId ? 'draft.detach' : `attachment.${name}`}`, target, draftId ? { attachmentId: attachment.id } : {});
    if (owns() && owner === root && attachment === originalAttachment && JSON.stringify(attachment) === contents
      && conversationId === originalConversationId && messageId === originalMessageId && draftId === originalDraftId)
      error = result?.status === 'rejected' ? result.error.message : '';
  }
</script>

<figure bind:this={root} class="messages-attachment" class:expanded class:shared-details={sharedDetails} class:audio={attachment.kind === 'audio'} data-messages-attachment-id={attachment.id} data-messages-source-file-id={attachment.originalFileId} data-messages-source-revision={attachment.originalRevision} oncontextmenu={context} ondblclick={event => { if (event.target.closest('canvas, .messages-inline-text')) doubleClick(); }}>
  {#if mounted && !owns()}<p role="status">The original attachment presentation is no longer available.</p>{:else}
  {#if attachment.kind === 'image'}
    <button type="button" class="messages-attachment-image" data-messages-control={`attachment-expand:${attachment.id}`} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${attachment.name}`} aria-expanded={expanded} disabled={!available} onclick={() => preview({ expanded: !expanded })} ondblclick={doubleClick}><img src={attachment.dataURI} alt={attachment.name} /></button>
  {:else if attachment.kind === 'audio'}
    <MessagesAudioPreview {attachment} {windowId} {available} owns={owns} ownerTarget={{ ...(draftId ? { draftId } : { conversationId, messageId }) }} />
  {:else if attachmentMime === 'application/pdf'}
    <MessagesPdfQuickLook {attachment} {windowId} available={mounted && available} owns={owns} inline={true} onNavigate={page => preview({ page })} ownerTarget={{ ...(draftId ? { draftId } : { conversationId, messageId }) }} />
  {:else if attachmentMime?.startsWith('text/')}
    {@const text = attachmentContent(attachment)}
    {#if text !== null}<pre class="messages-inline-text" aria-label={attachment.name}>{text}</pre>{:else}<p role="status">The retained text bytes are not valid UTF-8. No substitute text is displayed.</p>{/if}
  {:else}<button type="button" class="messages-attachment-file" aria-label={`Preview ${attachment.name}`} disabled={!available || !!draftId} ondblclick={doubleClick} onclick={() => { if (!draftId) void action('quickLook'); }}>▤</button>{/if}
  <figcaption><strong>{attachment.name}</strong><small>{attachment.mime} · {attachment.byteLength.toLocaleString()} bytes{#if attachment.durationMs !== null} · {(attachment.durationMs / 1000).toFixed(1)} s{/if}</small></figcaption>
  <div class="messages-attachment-actions">
    {#if draftId}<button type="button" data-messages-control={`draft-detach:${attachment.id}`} disabled={!available} onclick={() => action('detach')}>Remove</button>
    {:else}<button bind:this={actionsAnchor} type="button" data-messages-control={`attachment-actions:${attachment.id}`} aria-label={`Actions for ${attachment.name}`} aria-expanded={menuOpen} disabled={!available} onclick={context}>•••</button>
    {/if}
  </div>
  {#if menuOpen && !draftId}<div bind:this={menuRoot} class="messages-attachment-menu" popover="manual" style:left={`${menuLeft}px`} style:top={`${menuTop}px`} style:transform={`scale(${menuScale})`} role="menu" aria-label={`Attachment actions for ${attachment.name}`}><button role="menuitem" type="button" data-messages-control={`attachment-quickLook:${attachment.id}`} disabled={!available} onclick={() => menuAction('quickLook')}>{profile.renderer === 'windows11' ? 'Preview (local equivalent)' : 'Quick Look'}</button><button role="menuitem" type="button" data-messages-control={`attachment-open:${attachment.id}`} disabled={!available} onclick={() => menuAction('open')}>Open</button><button role="menuitem" type="button" data-messages-control={`attachment-save:${attachment.id}`} disabled={!available} onclick={() => menuAction('save')}>Save As…</button></div>{/if}
  {#if error}<p role="status" class="messages-rich-error">{error}</p>{/if}
  {/if}
</figure>

<style>
  .messages-attachment { position: relative; }
  .messages-attachment-menu { position: fixed; z-index: 12; inset: auto; margin: 0; transform-origin: top left; display: grid; min-width: 175px; padding: 5px; border: 1px solid #aaa8; border-radius: 7px; background: var(--appearance-panel, #f5f5f5); color: var(--appearance-ink, #222); box-shadow: 0 5px 18px #0003; }
  .messages-attachment-menu:not(:popover-open) { display: none; }
  .messages-attachment-menu button { text-align: left; border: 0; border-radius: 3px; padding: 5px 10px; background: transparent; color: inherit; }
  .messages-attachment-menu button:hover { background: var(--appearance-accent, #0879e8); color: white; }
  .messages-inline-text { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow: auto; max-width: 360px; margin: 0; padding: 12px; border-radius: 5px; background: var(--appearance-input, #fff); color: var(--appearance-ink, #222); font: 11px/1.4 ui-monospace, monospace; }
</style>
