<script>
  import { onMount, tick } from 'svelte';
  import { selectedMessageConversation, messageSearchResults, messageSearchSegments, messagePreview, isReferenceMessageConversation } from './messages-state.js';
  import { createMessagesNativeView } from './messages-native-view.js';
  import { messageDraft, messageDraftCanSend } from './messages-composition.js';
  import MessagesDraftEditor from './MessagesDraftEditor.svelte';
  import MessagesRecipientPicker from './MessagesRecipientPicker.svelte';
  import MessagesRichControls from './MessagesRichControls.svelte';
  import MessagesAttachment from './MessagesAttachment.svelte';
  import WindowControls from './WindowControls.svelte';
  import SonomaSymbol from './SonomaSymbol.svelte';
  import { clockRecordLabel } from './clock-model.js';
  import './sonoma.css';
  let { assets, state: messageState, profile, windowId, execute, registerView, resolveRecipients, resolveRecipient, clockContext, available = true, onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu, fullScreen = false, revealedTop = true, modernGreenMenu = true, active = true, zoomed = false } = $props();
  let panel;
  let context = $state(null);
  const selected = $derived(selectedMessageConversation(messageState));
  const draft = $derived(messageDraft(messageState));
  let draftEditor;
  let richControls;
  const results = $derived(messageSearchResults(messageState));
  const searching = $derived(Boolean(messageState.query.trim()));
  const conversationResults = $derived(results.filter(result => !searching || result.conversationMatch || result.contactMatch));
  const reference = $derived(isReferenceMessageConversation(selected, profile));
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
    event.preventDefault();
    event.stopPropagation();
    const index = conversationResults.findIndex(result => result.conversation.id === id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? conversationResults.length - 1 : Math.max(0, Math.min(conversationResults.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const result = conversationResults[next];
    if (result) select(result.conversation.id, null, true);
  }
  function searchKey(event) {
    if (event.key === 'Enter' && !event.isComposing && results.length) {
      event.preventDefault();
      const result = results[0];
      select(result.conversation.id, result.messageIds[0] ?? null, true);
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
  function dismissContext(event) {
    if (context && !event.target.closest?.('[data-messages-context]')) command('messages.context.close', {}, { restoreFocus: false });
  }
  async function markContext() {
    if (!contextConversation) return;
    const conversation = contextConversation;
    await command('messages.conversation.setUnread', { conversationId: conversation.id }, { unread: !conversation.unread });
    await command('messages.context.close');
  }
  $effect(() => { if (!active || !available) context = null; });
</script>

<svelte:window onkeydown={keyboard} />
<svelte:document onpointerdown={dismissContext} onfocusin={dismissContext} />
<section class="sonoma-messages" class:inactive={!active} bind:this={panel} data-messages-window-id={windowId} aria-label="Messages">
  <aside class="sonoma-messages-sidebar" aria-label="Conversations">
    <header class="sonoma-messages-sidebar-toolbar" data-window-drag>
      <WindowControls {onclose} {onminimize} {onzoom} {active} {zoomed} {onfullscreen} {onsplitbegin} {onsplitside} {ongreenmenu} {fullScreen} {revealedTop} {modernGreenMenu} />
      <button type="button" class="sonoma-tool" data-messages-control="new-message" data-window-no-drag aria-label="New message" disabled={!available} onclick={() => command('messages.compose.new')}><SonomaSymbol name="new" /></button>
    </header>
    <label class="sonoma-messages-search" data-window-no-drag><SonomaSymbol name="search" /><input type="search" data-messages-control="search" aria-label="Search conversations, participants, and messages" placeholder="Search" maxlength="4096" value={messageState.query} oninput={(event) => command('messages.search', {}, { query: event.currentTarget.value })} onkeydown={searchKey} /></label>
    {#if messageState.unreadOnly}<div class="sonoma-messages-filter"><button type="button" aria-label="Back to all messages" onclick={() => command('messages.filter.setUnreadOnly', {}, { enabled: false })}>‹</button><span>Unread Messages</span></div>{/if}
    <div class="sonoma-conversation-scroll" data-messages-area="conversations">
      {#if searching && conversationResults.length}<h2 class="sonoma-messages-search-heading">Conversations</h2>{/if}
      <ul class="sonoma-conversations">
        {#each conversationResults as { conversation } (conversation.id)}
          {@const preview = messagePreview(conversation)}
          <li class:selected={conversation.id === messageState.selectedConversationId}>
            <button type="button" class="sonoma-conversation-row" data-messages-control={`conversation:${conversation.id}`} aria-current={conversation.id === messageState.selectedConversationId ? 'true' : undefined} aria-label={`${conversation.name}${conversation.unread ? ', unread' : ''}`} onclick={(event) => event.ctrlKey ? openContext(event, conversation) : select(conversation.id)} onkeydown={(event) => rowKey(event, conversation.id)} oncontextmenu={(event) => openContext(event, conversation)}>
              {#if conversation.unread}<span class="sonoma-messages-unread" aria-hidden="true"></span>{/if}
              {#if conversation.portrait}<img class="sonoma-conversation-portrait" src={`${assets.messages}/${conversation.portrait}`} alt="" width="44" height="44" />{:else}<span class="sonoma-conversation-portrait sonoma-conversation-initials" style:background={conversation.tint} aria-hidden="true">{conversation.initials}</span>{/if}
              <span class="sonoma-conversation-copy"><span class="sonoma-conversation-heading"><span>{conversation.name}</span><time datetime={new Date(conversation.timestamp).toISOString()}>{conversation.timeLabel}</time></span><span class="sonoma-conversation-preview">{#each preview.lines as line, index}<span>{#if preview.emoji?.line === index && preview.emoji.before}<img src={`${assets.messages}/${preview.emoji.image}`} alt={preview.emoji.label} />{/if}{line}{#if preview.emoji?.line === index && !preview.emoji.before}<img src={`${assets.messages}/${preview.emoji.image}`} alt={preview.emoji.label} />{/if}</span>{/each}</span></span>
            </button>
          </li>
        {/each}
      </ul>
      {#if searching && results.some(result => result.messageIds.length)}
        <h2 class="sonoma-messages-search-heading">Messages</h2>
        <ul class="sonoma-message-search-results">
          {#each results as result (result.conversation.id)}
            {#each result.messageIds as messageId (messageId)}
              {@const item = result.conversation.items.find(item => item.id === messageId)}
              <li><button type="button" data-messages-control={`hit:${result.conversation.id}:${messageId}`} onclick={() => select(result.conversation.id, messageId)}><strong>{result.conversation.name}</strong>{#if item.sender}<span>{item.sender}</span>{/if}<span class="sonoma-search-hit-text">{#each messageSearchSegments(item.text, messageState.query) as piece}{#if piece.match}<strong>{piece.text}</strong>{:else}{piece.text}{/if}{/each}</span></button></li>
            {/each}
          {/each}
        </ul>
      {/if}
      {#if !results.length}<p class="sonoma-messages-empty" role="status">{searching ? 'No results' : messageState.unreadOnly ? 'No unread messages' : 'No conversations'}</p>{/if}
    </div>
  </aside>
  <div class="sonoma-messages-thread">
    <header class="sonoma-messages-recipient-toolbar" data-window-drag>
      <span class="sonoma-recipient">{#if selected}<span>To:</span> {selected.name}{:else if draft}<label>To: <MessagesRecipientPicker state={messageState} {windowId} {execute} {available} {resolveRecipients} /></label>{:else}Messages{/if}</span>
      <button type="button" class="sonoma-tool" data-window-no-drag aria-label="FaceTime — not implemented" disabled><SonomaSymbol name="video" /></button>
      <button type="button" class="sonoma-tool" data-messages-control="conversation-details" data-window-no-drag aria-label="Conversation information" disabled={!available || !selected} onclick={() => richControls?.details()}><SonomaSymbol name="info" /></button>
    </header>
    {#key selected?.id}
      <ol class="sonoma-message-history" class:reference data-messages-area="thread" data-messages-conversation-id={selected?.id} aria-label={selected ? `Conversation with ${selected.name}` : 'Conversation history'}>
        {#each selected?.items ?? [] as item (item.id)}
          {@const timestampLabel = clockRecordLabel(item.timestamp, clockContext.sceneTime, clockContext.timeZone, clockContext.use24Hour, true, true)}
          {#if item.kind === 'image'}
            <li class="sonoma-message-photo" class:outgoing={item.direction === 'outgoing'} data-messages-control={`message:${item.id}`} title={timestampLabel} aria-description={timestampLabel} data-message-timestamp={timestampLabel} tabindex="0"><img src={`${assets.messages}/${item.asset}`} alt={item.label} /></li>
          {:else if item.kind === 'emoji'}
            <li class="sonoma-message-emoji" class:outgoing={!reference && item.direction === 'outgoing'} data-messages-control={`message:${item.id}`} title={timestampLabel} aria-description={timestampLabel} data-message-timestamp={timestampLabel} tabindex="0">{#each item.assets as image}<img src={`${assets.messages}/${image.asset}`} alt={image.label} />{/each}</li>
          {:else if item.kind === 'text'}
            <li class="sonoma-message-bubble {item.direction}" class:sonoma-last-message={Boolean(item.delivery)}>{#if item.sender}<span class="sonoma-message-sender">{item.sender}</span>{/if}<p data-messages-control={`message:${item.id}`} title={timestampLabel} aria-description={timestampLabel} data-message-timestamp={timestampLabel} tabindex="0">{item.text}</p>{#each item.attachments ?? [] as attachment (attachment.id)}<MessagesAttachment {attachment} state={messageState} {windowId} {execute} {profile} {available} conversationId={selected.id} messageId={item.id} />{/each}{#if item.reactions?.length}<span class="messages-reactions" aria-label="Message reactions">{#each item.reactions as reaction}<span title={reaction.participant}>{reaction.emoji}</span>{/each}</span>{/if}{#if item.delivery}<span class="sonoma-delivered">{item.delivery}</span>{/if}</li>
          {/if}
        {:else}<li class="sonoma-messages-empty">{selected ? `No messages with ${selected.name}` : messageState.conversations.length ? 'Select a conversation' : 'No conversations'}</li>{/each}
      </ol>
    {/key}
    <div class="sonoma-messages-composer" aria-label="Message composer">
      <button type="button" class="sonoma-imessage-apps" data-messages-control="attach-file" aria-label="Attach file from virtual Files" disabled={!available || !draft} onclick={() => richControls?.attach()}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v16M4 12h16"/></svg></button>
      <div class="sonoma-messages-input"><MessagesDraftEditor bind:this={draftEditor} state={messageState} {windowId} {execute} {available} />{#if draft?.fields.body.trim() || draft?.attachments.length}<button type="button" class="messages-send-button" data-messages-control="draft-send" aria-label="Send local message" disabled={!available || !messageDraftCanSend(messageState, draft, resolveRecipient)} onclick={() => draftEditor?.send()}>↑</button>{:else}<button type="button" class="sonoma-tool" data-messages-control="audio-fixture" aria-label="Add authored local audio clip (not a microphone recording)" disabled={!available || !draft} onclick={() => richControls?.audio()}><SonomaSymbol name="audio" /></button>{/if}</div>
      <button type="button" class="sonoma-tool" data-messages-control="emoji-picker" aria-label="Emoji & Symbols" disabled={!available || !draft} onpointerdown={event => event.preventDefault()} onclick={() => richControls?.showEmoji()}><SonomaSymbol name="emoji" /></button>
    </div>
  </div>
  {#if context && contextConversation}<div class="sonoma-messages-context" data-messages-context role="menu" aria-label="Conversation actions" style:left={`${context.x}px`} style:top={`${context.y}px`}><button type="button" role="menuitem" data-messages-control={`context-unread:${context.id}`} onclick={markContext}>{contextConversation.unread ? 'Mark as Read' : 'Mark as Unread'}</button></div>{/if}
  <MessagesRichControls bind:this={richControls} state={messageState} {windowId} {execute} {profile} {available} {resolveRecipients} />
</section>
