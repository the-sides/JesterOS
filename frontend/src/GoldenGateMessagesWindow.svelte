<script>
  import { onMount, tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import { clockRecordLabel } from './clock-model.js';
  import { selectedMessageConversation, messageSearchResults, messageSearchSegments, messagePreview } from './messages-state.js';
  import { createMessagesNativeView } from './messages-native-view.js';
  import { messageDraft, messageDraftCanSend } from './messages-composition.js';
  import MessagesDraftEditor from './MessagesDraftEditor.svelte';
  import MessagesRecipientPicker from './MessagesRecipientPicker.svelte';
  import MessagesRichControls from './MessagesRichControls.svelte';
  import MessagesAttachment from './MessagesAttachment.svelte';
  import './golden-gate-documents.css';

  let { state: messageState, profile, windowId, execute, registerView, resolveRecipients, resolveRecipient, available = true, assets, onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu,
    fullScreen = false, revealedTop = true, modernGreenMenu = true, active = true, zoomed = false,
    onservices = null, servicesEntryId = null, clockContext } = $props();
  let panel;
  let context = $state(null);
  const selected = $derived(selectedMessageConversation(messageState));
  const visibleItems = $derived((selected?.items ?? []).filter(item => !item.screened && !item.spam));
  const draft = $derived(messageDraft(messageState));
  let draftEditor;
  let richControls;
  const results = $derived(messageSearchResults(messageState));
  const searching = $derived(Boolean(messageState.query.trim()));
  const pinned = $derived(results.filter(result => result.conversation.pinned && !searching));
  const rows = $derived(results.filter(result => (!result.conversation.pinned || searching) && (!searching || result.conversationMatch || result.contactMatch)));
  const contextConversation = $derived(messageState.conversations.find(row => row.id === context?.id));
  onMount(() => {
    const view = createMessagesNativeView({ getRoot: () => panel, getState: () => messageState, windowId, available: () => available, tick,
      getContext: () => context, setContext: value => { context = value; },
      setPanel: (...args) => richControls?.setPanel(...args),
      setPreferencePane: (...args) => richControls?.setPreferencePane(...args),
      setDetailsSection: (...args) => richControls?.setDetailsSection(...args),
      setMessageActions: (...args) => richControls?.setMessageActions(...args), quickLookAttachment: (...args) => richControls?.quickLookAttachment(...args),
      setPreferenceFolders: (...args) => richControls?.setPreferenceFolders(...args),
      setPreferenceContacts: (...args) => richControls?.setPreferenceContacts(...args),
      setPreferenceSceneTime: (...args) => richControls?.setPreferenceSceneTime(...args),
      playReceivedSound: (...args) => richControls?.playReceivedSound(...args) });
    registerView?.(view);
    return () => registerView?.(null, view);
  });
  const command = (name, target = {}, payload = {}) => execute(name, { windowId, ...target }, payload);
  const recordLabel = (timestamp, includeDate = false) => clockRecordLabel(timestamp, clockContext.sceneTime, clockContext.timeZone, clockContext.use24Hour, includeDate);
  async function select(conversationId, messageId = null) {
    if (context) await command('messages.context.close', {}, { restoreFocus: false });
    await command('messages.conversation.select', { conversationId }, messageId ? { messageId } : {});
  }
  function rowKey(event, id) {
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      const conversation = messageState.conversations.find(row => row.id === id);
      if (conversation) openContext(event, conversation);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const ordered = [...pinned, ...rows];
    const index = ordered.findIndex(result => result.conversation.id === id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ordered.length - 1 : Math.max(0, Math.min(ordered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    if (ordered[next]) select(ordered[next].conversation.id, null, true);
  }
  function searchKey(event) {
    if (event.key === 'Enter' && !event.isComposing && results.length) {
      event.preventDefault();
      select(results[0].conversation.id, results[0].messageIds[0] ?? null, true);
    }
  }
  function keyboard(event) {
    if (!active || !available || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      if (context) { event.preventDefault(); command('messages.context.close'); }
      else if (messageState.query) { event.preventDefault(); command('messages.search', {}, { query: '' }); }
    } else if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault(); command('messages.focus', { controlId: 'search' });
    } else if (event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'u' && selected) {
      event.preventDefault(); command('messages.conversation.setUnread', { conversationId: selected.id }, { unread: !selected.unread });
    } else if (event.metaKey && event.ctrlKey && !event.shiftKey && !event.altKey && ['1', '4'].includes(event.key)) {
      event.preventDefault(); command('messages.filter.setUnreadOnly', {}, { enabled: event.key === '4' });
    }
  }
  function openContext(event, conversation) {
    event.preventDefault();
    command('messages.context.open', { conversationId: conversation.id },
      event.type === 'contextmenu' || event.type === 'click' ? { point: { x: event.clientX, y: event.clientY } } : {});
  }
  function dismissMenus(event) {
    if (context && !event.target.closest?.('[data-messages-context]')) command('messages.context.close', {}, { restoreFocus: false });
  }
  async function markContext() {
    if (!contextConversation) return;
    const conversation = contextConversation;
    await command('messages.conversation.setUnread', { conversationId: conversation.id }, { unread: !conversation.unread });
    await command('messages.context.close');
  }
  function setFilter(enabled) {
    command('messages.filter.setUnreadOnly', {}, { enabled });
  }
  $effect(() => { if (!active || !available) context = null; });
  const symbols = {
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-1 5 6 6',
    filter: 'M4 6h16M7 12h10M10 18h4',
    new: 'M13 4H4v16h16v-9M9 15l1-5 8-8 4 4-8 8zM16 4l4 4',
    video: 'M3 6h12v12H3zM15 10l6-4v12l-6-4',
    plus: 'M12 4v16M4 12h16',
    audio: 'M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4',
    emoji: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 9h.1M16 9h.1M7 14q5 7 10 0',
    chevron: 'm9 5 7 7-7 7',
  };
</script>

{#snippet symbol(name)}
  <svg class="golden-gate-document-symbol" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d={symbols[name]} /></svg>
{/snippet}
{#snippet avatar(initials, tint, extraClass = '')}
  <span class="golden-gate-messages-avatar {extraClass}" style:--avatar-tint={tint} aria-hidden="true">{initials}</span>
{/snippet}

<svelte:window onkeydown={keyboard} />
<svelte:document onpointerdown={dismissMenus} onfocusin={dismissMenus} />
<section class="golden-gate-messages" class:inactive={!active} bind:this={panel} data-messages-window-id={windowId} aria-label="Messages — fictional conversations">
  <aside class="golden-gate-messages-sidebar" aria-label="Conversations">
    <header class="golden-gate-messages-sidebar-toolbar" data-window-drag>
      <WindowControls {onclose} {onminimize} {onzoom} {active} {zoomed} {onfullscreen} {onsplitbegin} {onsplitside} {ongreenmenu} {fullScreen} {revealedTop} {modernGreenMenu} />
      <div class="golden-gate-messages-sidebar-actions" data-window-no-drag>
        <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" aria-label="Sidebar options — not implemented" disabled>{@render symbol('filter')}</button>
        <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" data-messages-control="new-message" aria-label="New message" disabled={!available} onclick={() => command('messages.compose.new')}>{@render symbol('new')}</button>
      </div>
    </header>
    <label class="golden-gate-document-search golden-gate-messages-search" data-window-no-drag>{@render symbol('search')}<input type="search" data-messages-control="search" aria-label="Search conversations, participants, and messages" placeholder="Search" maxlength="4096" value={messageState.query} oninput={(event) => command('messages.search', {}, { query: event.currentTarget.value })} onkeydown={searchKey} /></label>
    {#if messageState.unreadOnly}<div class="golden-gate-messages-filter-label"><button type="button" onclick={() => setFilter(false)} aria-label="Back to all messages">‹</button>Unread Messages</div>{/if}
    <div class="golden-gate-messages-conversation-scroll" data-messages-area="conversations">
      {#if pinned.length}<ul class="golden-gate-messages-pinned" aria-label="Pinned conversations">
        {#each pinned as { conversation } (conversation.id)}
          <li class:selected={conversation.id === messageState.selectedConversationId}>
            <button type="button" data-messages-control={`conversation:${conversation.id}`} aria-current={conversation.id === messageState.selectedConversationId ? 'true' : undefined} aria-label={`${conversation.name}, pinned${conversation.unread ? ', unread' : ''}`} onclick={(event) => event.ctrlKey ? openContext(event, conversation) : select(conversation.id)} onkeydown={(event) => rowKey(event, conversation.id)} oncontextmenu={(event) => openContext(event, conversation)}>{@render avatar(conversation.initials, conversation.tint)}<span>{conversation.name}</span>{#if conversation.unread}<span class="golden-gate-messages-unread" aria-hidden="true"></span>{/if}</button>
          </li>
        {/each}
      </ul>{/if}
      {#if searching && rows.length}<h2 class="golden-gate-messages-search-heading">Conversations</h2>{/if}
      <ul class="golden-gate-messages-conversations">
        {#each rows as { conversation } (conversation.id)}
          {@const preview = messagePreview(conversation)}
          <li class:selected={conversation.id === messageState.selectedConversationId}>
            <button type="button" data-messages-control={`conversation:${conversation.id}`} aria-current={conversation.id === messageState.selectedConversationId ? 'true' : undefined} aria-label={`${conversation.name}${conversation.unread ? ', unread' : ''}`} onclick={(event) => event.ctrlKey ? openContext(event, conversation) : select(conversation.id)} onkeydown={(event) => rowKey(event, conversation.id)} oncontextmenu={(event) => openContext(event, conversation)}>
              {#if conversation.unread}<span class="golden-gate-messages-unread" aria-hidden="true"></span>{/if}
              {@render avatar(conversation.initials, conversation.tint)}
              <span class="golden-gate-messages-conversation-copy"><span class="golden-gate-messages-conversation-heading"><strong>{conversation.name}</strong><time datetime={new Date(conversation.timestamp).toISOString()}>{recordLabel(conversation.timestamp)}</time></span><span class="golden-gate-messages-conversation-preview">{preview.lines.join(' ')}</span></span>
            </button>
          </li>
        {/each}
      </ul>
      {#if searching && results.some(result => result.messageIds.length)}
        <h2 class="golden-gate-messages-search-heading">Messages</h2>
        <ul class="golden-gate-messages-search-results">
          {#each results as result (result.conversation.id)}
            {#each result.messageIds as messageId (messageId)}
              {@const item = result.conversation.items.find(item => item.id === messageId)}
              <li><button type="button" data-messages-control={`hit:${result.conversation.id}:${messageId}`} onclick={() => select(result.conversation.id, messageId)}><strong>{result.conversation.name}</strong>{#if item.sender}<span>{item.sender}</span>{/if}<span class="golden-gate-messages-hit-text">{#each messageSearchSegments(item.text, messageState.query) as piece}{#if piece.match}<strong>{piece.text}</strong>{:else}{piece.text}{/if}{/each}</span></button></li>
            {/each}
          {/each}
        </ul>
      {/if}
      {#if !results.length}<p class="golden-gate-messages-empty" role="status">{searching ? 'No results' : messageState.unreadOnly ? 'No unread messages' : 'No conversations'}</p>{/if}
    </div>
  </aside>
  <div class="golden-gate-messages-thread">
    <header class="golden-gate-messages-recipient-toolbar" data-window-drag>
      {#if selected}<button type="button" class="golden-gate-messages-recipient golden-gate-document-capsule" data-messages-control="conversation-details" data-window-no-drag aria-label={`${selected.name} conversation details`} disabled={!available} onclick={() => richControls?.details()}>{@render avatar(selected.initials, selected.tint)}<span>{selected.name}</span>{@render symbol('chevron')}</button>{:else if draft}<label>To: <MessagesRecipientPicker state={messageState} {windowId} {execute} {available} {resolveRecipients} /></label>{:else}<span>Messages</span>{/if}
      <button type="button" class="golden-gate-document-tool golden-gate-document-capsule golden-gate-messages-call" data-window-no-drag aria-label="Video call — not implemented" disabled>{@render symbol('video')}</button>
    </header>
    {#key selected?.id}
      <ol class="golden-gate-messages-history" data-messages-area="thread" data-messages-conversation-id={selected?.id} aria-label={selected ? `Conversation with ${selected.name}` : 'Conversation history'}>
        {#if visibleItems.length}<li class="golden-gate-messages-timestamp"><time datetime={new Date(selected.timestamp).toISOString()}>{recordLabel(selected.timestamp, true)}</time></li>{/if}
        {#each visibleItems as item, itemIndex (item.id)}
          {@const timestampLabel = clockRecordLabel(item.timestamp, clockContext.sceneTime, clockContext.timeZone, clockContext.use24Hour, true, true)}
          {#if item.kind === 'trail'}
            <li class="golden-gate-messages-artwork" class:outgoing={item.direction === 'outgoing'} data-messages-control={`message:${item.id}`} title={timestampLabel} aria-description={timestampLabel} data-message-timestamp={timestampLabel} tabindex="0">
              {#if item.sender}<span class="golden-gate-messages-sender">{item.sender}</span>{/if}
              <svg viewBox="0 0 340 190" role="img" aria-label="Original illustration of a coastal trail, hills, and a small orange tent">
                <rect width="340" height="190" rx="18" fill="#d5e8eb" />
                <circle cx="260" cy="42" r="21" fill="#f4d794" />
                <path d="M0 106Q55 65 115 103T230 104Q284 91 340 120V190H0Z" fill="#76947b" />
                <path d="M0 145Q58 110 116 133T227 138L340 110V190H0Z" fill="#497e88" />
                <path d="M0 170q82-78 162-54 45 15 78-22 26-24 100-10v106H0Z" fill="#afbc8a" />
                <path d="M44 190q20-36 84-49t94-40q16-22 73-19" fill="none" stroke="#eddfb4" stroke-width="13" stroke-linecap="round" />
                <path d="m218 130 27-39 33 39z" fill="#d88851" /><path d="m245 91 8 39h-35z" fill="#f4b570" /><path d="m239 111-12 19h24z" fill="#6e5750" />
                <path d="m62 118 13-28 13 28zm6-16 7-17 8 17zM298 91l10-24 12 24z" fill="#386553" /><path d="M75 111v13m233-40v14" stroke="#675d49" stroke-width="4" />
                <path d="m22 154 20-7m-17 16 28-9m234 10 25-5m-16 13 21-5" stroke="#edf5ee" stroke-width="2" stroke-linecap="round" opacity=".65" />
              </svg>
            </li>
          {:else if item.kind === 'text'}
            <li class="golden-gate-messages-bubble {item.direction}" class:golden-gate-messages-last={Boolean(item.delivery)}>
              {#if item.sender}<span class="golden-gate-messages-sender">{item.sender}</span>{/if}
              <p data-service-message-index={itemIndex} data-messages-control={`message:${item.id}`} title={timestampLabel} aria-description={timestampLabel} data-message-timestamp={timestampLabel} tabindex="0">{item.text}</p>
              {#each item.attachments ?? [] as attachment (attachment.id)}<MessagesAttachment {attachment} state={messageState} {windowId} {execute} {profile} {available} conversationId={selected.id} messageId={item.id} />{/each}
              {#if item.reactions?.length}<span class="messages-reactions" aria-label="Message reactions">{#each item.reactions as reaction}<span title={reaction.participant}>{reaction.emoji}</span>{/each}</span>{/if}
              {#if item.delivery}<span class="golden-gate-messages-delivered">{item.delivery}</span>{/if}
            </li>
          {:else if item.kind === 'image'}
            <li class="golden-gate-messages-artwork" class:outgoing={item.direction === 'outgoing'} data-messages-control={`message:${item.id}`} title={timestampLabel} aria-description={timestampLabel} data-message-timestamp={timestampLabel} tabindex="0"><img src={`${assets.messages}/${item.asset}`} alt={item.label} /></li>
          {:else if item.kind === 'emoji'}
            <li class="golden-gate-messages-emoji" class:outgoing={item.direction === 'outgoing'} data-messages-control={`message:${item.id}`} title={timestampLabel} aria-description={timestampLabel} data-message-timestamp={timestampLabel} tabindex="0">{#each item.assets as image}<img src={`${assets.messages}/${image.asset}`} alt={image.label} />{/each}</li>
          {/if}
        {:else}<li class="golden-gate-messages-empty">{selected ? `No messages with ${selected.name}` : messageState.conversations.length ? 'Select a conversation' : 'No conversations'}</li>{/each}
      </ol>
    {/key}
    <div class="golden-gate-messages-composer" aria-label="Message composer">
      <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" data-messages-control="attach-file" aria-label="Attach file from virtual Files" disabled={!available || !draft} onclick={() => richControls?.attach()}>{@render symbol('plus')}</button>
      <div class="golden-gate-messages-input"><MessagesDraftEditor bind:this={draftEditor} state={messageState} {windowId} {execute} {available} />{#if draft?.fields.body.trim() || draft?.attachments.length}<button type="button" class="messages-send-button" data-messages-control="draft-send" aria-label="Send local message" disabled={!available || !messageDraftCanSend(messageState, draft, resolveRecipient)} onclick={() => draftEditor?.send()}>↑</button>{:else}<button type="button" class="golden-gate-document-tool" data-messages-control="audio-fixture" aria-label="Add authored local audio clip (not a microphone recording)" disabled={!available || !draft} onclick={() => richControls?.audio()}>{@render symbol('audio')}</button>{/if}</div>
      <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" data-messages-control="emoji-picker" aria-label="Emoji & Symbols" disabled={!available || !draft} onpointerdown={event => event.preventDefault()} onclick={() => richControls?.showEmoji()}>{@render symbol('emoji')}</button>
    </div>
    <p class="golden-gate-messages-sample-notice">Fictional conversations · Local sending; no remote delivery
      {#if onservices}<button type="button" disabled={!servicesEntryId} onclick={onservices}>Local Services</button>{/if}
    </p>
  </div>
  {#if context && contextConversation}<div class="golden-gate-messages-context" data-messages-context role="menu" aria-label="Conversation actions" style:left={`${context.x}px`} style:top={`${context.y}px`}><button type="button" role="menuitem" data-messages-control={`context-unread:${context.id}`} onclick={markContext}>{contextConversation.unread ? 'Mark as Read' : 'Mark as Unread'}</button></div>{/if}
  <MessagesRichControls bind:this={richControls} state={messageState} {windowId} {execute} {profile} {available} {resolveRecipients} />
</section>
