<script>
  import { onMount, tick } from 'svelte';
  import { selectedMessageConversation, messagePreview, messageSearchResults, isReferenceMessageConversation } from './messages-state.js';
  import { createMessagesNativeView } from './messages-native-view.js';
  import { messageDraft, messageDraftCanSend } from './messages-composition.js';
  import MessagesDraftEditor from './MessagesDraftEditor.svelte';
  import MessagesRecipientPicker from './MessagesRecipientPicker.svelte';
  import MessagesRichControls from './MessagesRichControls.svelte';
  import MessagesAttachment from './MessagesAttachment.svelte';
  import WindowControls from './WindowControls.svelte';
  import { clockRecordLabel } from './clock-model.js';
  import './messages.css';

  let { assets, state: messageState, profile, windowId, execute, registerView, resolveRecipients, resolveRecipient, clockContext, available = true, onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu, fullScreen = false, revealedTop = true, modernGreenMenu = false, active = true, zoomed = false } = $props();
  let panel;
  let interactionError = $state('');
  let requestId = 0;
  const conversation = $derived(selectedMessageConversation(messageState));
  const draft = $derived(messageDraft(messageState));
  let draftEditor;
  let richControls;
  const results = $derived(messageSearchResults(messageState));
  const reference = $derived(isReferenceMessageConversation(conversation, profile));
  const referenceClasses = ['hs-miami-photo', 'hs-miami-message', 'hs-euna-photo', 'hs-want-to-go'];

  function owns(node) {
    return available && panel?.isConnected && node?.isConnected && panel.contains(node)
      && !panel.closest('[inert], [hidden]');
  }

  async function command(name, target, payload, node) {
    if (!owns(node)) return null;
    const owner = panel;
    const request = ++requestId;
    const result = await execute(`messages.${name}`, { windowId, ...target }, payload);
    if (owner !== panel || !owns(node)) return null;
    if (request === requestId) interactionError = result?.status === 'rejected' ? result.error.message : '';
    return result;
  }

  async function selectResult(result, node, messageId = result.messageIds[0]) {
    return command('conversation.select', { conversationId: result.conversation.id }, messageId ? { messageId } : {}, node);
  }

  async function clearSearch(node) {
    if (!owns(node)) return;
    const owner = panel;
    const result = await command('search', {}, { query: '' }, owner);
    if (result?.status === 'applied' && messageState.query === '') await command('focus', { controlId: 'search' }, {}, owner);
  }

  function navigate(event, fromSearch = false) {
    if (event.altKey || event.ctrlKey || event.metaKey || !owns(event.currentTarget)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void clearSearch(event.currentTarget);
      return;
    }
    if (!results.length) return;
    const index = results.findIndex(row => row.conversation.id === messageState.selectedConversationId);
    let next;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : Math.min(index + 1, results.length - 1);
    else if (event.key === 'ArrowUp') next = index < 0 ? results.length - 1 : Math.max(index - 1, 0);
    else if (!fromSearch && event.key === 'Home') next = 0;
    else if (!fromSearch && event.key === 'End') next = results.length - 1;
    else if (fromSearch && event.key === 'Enter') next = Math.max(index, 0);
    else return;
    event.preventDefault();
    void selectResult(results[next], event.currentTarget);
  }

  function observeScroll(event, areaId) {
    const node = event.currentTarget;
    void command('scroll', { areaId }, { top: node.scrollTop, left: node.scrollLeft }, node);
  }

  function observeFocus(event) {
    const node = event.currentTarget;
    void command('focus', { controlId: node.dataset.messagesControl }, {}, node);
  }

  function keyboard(event) {
    if (active && available && !event.defaultPrevented && event.metaKey && !event.ctrlKey
      && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      command('focus', { controlId: 'search' }, {}, panel);
    }
  }
  onMount(() => {
    const view = createMessagesNativeView({ getRoot: () => panel, getState: () => messageState, windowId, available: () => available, tick,
      setPanel: (...args) => richControls?.setPanel(...args),
      setPreferencePane: (...args) => richControls?.setPreferencePane(...args),
      setDetailsSection: (...args) => richControls?.setDetailsSection(...args),
      setMessageActions: (...args) => richControls?.setMessageActions(...args), quickLookAttachment: (...args) => richControls?.quickLookAttachment(...args),
      setPreferenceFolders: (...args) => richControls?.setPreferenceFolders(...args),
      setPreferenceContacts: (...args) => richControls?.setPreferenceContacts(...args),
      setPreferenceSceneTime: (...args) => richControls?.setPreferenceSceneTime(...args),
      playReceivedSound: (...args) => richControls?.playReceivedSound(...args) });
    registerView(view);
    return () => registerView(null, view);
  });
</script>

{#snippet bubbleTail(direction, color)}
  <svg
    class="bubble-tail {direction}"
    viewBox="0 0 22 22"
    aria-hidden="true"
    style:color
  >
    <path d="M16 0H22V17C16 20 9 22 0 22C9 18 12 11 12 0Z" fill="currentColor" />
  </svg>
{/snippet}

<svelte:window onkeydown={keyboard} />
<section bind:this={panel} class="messages-window" class:inactive={!active} data-messages-window-id={windowId} aria-label="Messages">
  <header class="messages-toolbar" data-window-drag>
    <div class="messages-toolbar-sidebar">
      <WindowControls class="messages-traffic-lights" {onclose} {onminimize} {onzoom} {active} {zoomed} {onfullscreen} {onsplitbegin} {onsplitside} {ongreenmenu} {fullScreen} {revealedTop} {modernGreenMenu} />

      <div class="messages-search" data-window-no-drag>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.3" cy="8.3" r="6.7" />
          <path d="m13.1 13.1 5.2 5.2" />
        </svg>
        <input data-messages-control="search" aria-label="Search conversations" placeholder="Search" value={messageState.query} maxlength="4096" oninput={event => command('search', {}, { query: event.currentTarget.value }, event.currentTarget)} onkeydown={event => navigate(event, true)} onfocus={observeFocus} />
      </div>

      <button class="messages-compose-button" data-messages-control="new-message" data-window-no-drag aria-label="New message" disabled={!available} onclick={event => command('compose.new', {}, {}, event.currentTarget)}>
        <svg viewBox="0 0 28 26" aria-hidden="true">
          <path class="compose-outline" d="M20.2 13.4v9.1H3V5.3h10.5" />
          <path class="compose-pencil" d="m10.2 17.6 1-5.1L22.7 1l4 4-11.4 11.5Z" />
          <path class="compose-pencil-end" d="m20.3 3.4 4 4" />
        </svg>
      </button>
    </div>

    <div class="messages-recipient-toolbar">
      <div class="messages-recipient"><span>To:</span> {#if draft && !conversation}<MessagesRecipientPicker state={messageState} {windowId} {execute} {available} {resolveRecipients} />{:else}{conversation?.name ?? ''}{/if}</div>
      <button class="messages-details" data-messages-control="conversation-details" disabled={!available || !conversation} onclick={() => richControls?.details()}>Details</button>
    </div>
  </header>

  <aside class="messages-sidebar" aria-label="Conversations" data-messages-area="conversations" onscroll={event => observeScroll(event, 'conversations')}>
    <ul class="messages-conversations">
      {#each results as result (result.conversation.id)}
        {@const row = result.conversation}
        {@const preview = messagePreview(row)}
        <li class:selected={row.id === messageState.selectedConversationId} class:search-result={Boolean(messageState.query.trim())}>
          <button class="conversation-select" data-messages-control={`conversation:${row.id}`} aria-current={row.id === messageState.selectedConversationId ? 'true' : undefined} aria-label={`${row.name}${row.unread ? ', unread' : ''}`} tabindex={row.id === messageState.selectedConversationId || !results.some(result => result.conversation.id === messageState.selectedConversationId) && row.id === results[0]?.conversation.id ? 0 : -1} onclick={event => selectResult(result, event.currentTarget)} onkeydown={navigate} onfocus={observeFocus}>
            {#if row.unread}<span class="conversation-unread-dot" aria-hidden="true"></span>{/if}
            {#if row.portrait}
              <img class="conversation-portrait" src={`${assets.messages}/${row.portrait}`} alt="" width="67" height="67" />
            {:else}
              <span class="conversation-portrait conversation-initials" style:background={row.tint} aria-hidden="true">{row.initials}</span>
            {/if}
            <div class="conversation-copy">
              <div class="conversation-heading">
                <span class="conversation-name">{row.name}</span>
                <span class="conversation-time">{row.timeLabel}</span>
              </div>
              <p class="conversation-preview">
                {#each preview.lines as line, index}
                  <span class="preview-line">
                    {#if preview.emoji?.line === index && preview.emoji.before}
                      <img class="preview-emoji before" src={`${assets.messages}/${preview.emoji.image}`} alt={preview.emoji.label} />
                    {/if}
                    {line}
                    {#if preview.emoji?.line === index && !preview.emoji.before}
                      <img class="preview-emoji after" src={`${assets.messages}/${preview.emoji.image}`} alt={preview.emoji.label} />
                    {/if}
                  </span>
                {/each}
              </p>
            </div>
          </button>
          {#if messageState.query.trim()}
            {#each result.messageIds as messageId}
              {@const hit = row.items.find(item => item.id === messageId)}
              <button class="conversation-search-hit" data-messages-control={`hit:${row.id}:${messageId}`} aria-label={`Message from ${row.name}: ${hit.text}`} onclick={event => selectResult(result, event.currentTarget, messageId)} onkeydown={navigate} onfocus={observeFocus}>{hit.text}</button>
            {/each}
          {/if}
        </li>
      {/each}
    </ul>
    {#if !results.length}
      <p class="messages-empty" role="status">{messageState.query.trim() ? 'No conversations or messages found.' : 'No conversations.'}</p>
    {/if}
  </aside>

  <div class="messages-conversation">
    <ol class="message-history" class:reference-thread={reference} class:flow-thread={!reference} data-messages-area="thread" data-messages-conversation-id={conversation?.id} aria-label={conversation ? `Conversation with ${conversation.name}` : 'Messages'} onscroll={event => observeScroll(event, 'thread')}>
      {#each conversation?.items ?? [] as item, index (item.id)}
        {@const timestampLabel = clockRecordLabel(item.timestamp, clockContext.sceneTime, clockContext.timeZone, clockContext.use24Hour, true, true)}
        <li class="{item.kind === 'text' ? 'message-bubble' : item.kind === 'image' ? 'message-image' : 'message-emoji'} {item.direction} {reference ? referenceClasses[index] : ''}" class:message-hit={messageState.selectedMessageId === item.id} data-messages-control={`message:${item.id}`} title={timestampLabel} aria-description={timestampLabel} data-message-timestamp={timestampLabel} tabindex="0" onfocus={observeFocus}>
          {#if item.kind === 'image'}
            <img src={`${assets.messages}/${item.asset}`} alt={item.label} width={reference ? 388 : undefined} height={reference ? index === 0 ? 192 : 216 : undefined} />
            {#if reference && index === 2}
              <span class="hs-tapback" aria-label="Thumbs-up reaction">
                <svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M7 13H3v14h4zm3 13h12c2 0 3-1 3-3l3-11c.4-2-1-3-3-3h-8l1-5c.4-2-2-3-3-1l-5 9Z" /></svg>
              </span>
              {@render bubbleTail('incoming', '#e2c672')}
            {/if}
          {:else if item.kind === 'text'}
            <p>{#each item.text.split('\n') as line, lineIndex}{#if lineIndex}<br />{/if}{#if item.emoji?.line === lineIndex && item.emoji.before}<img class="preview-emoji before" src={`${assets.messages}/${item.emoji.image}`} alt={item.emoji.label} />{/if}{line}{#if item.emoji?.line === lineIndex && !item.emoji.before}<img class="preview-emoji after" src={`${assets.messages}/${item.emoji.image}`} alt={item.emoji.label} />{/if}{/each}</p>
            {@render bubbleTail(item.direction, item.direction === 'incoming' ? 'var(--appearance-incoming-bubble, #e5e5e9)' : '#2697ef')}
            {#if item.delivery}<span class="message-delivered">{item.delivery}</span>{/if}
          {:else if item.kind === 'emoji'}
            {#each item.assets as emoji}<img src={`${assets.messages}/${emoji.asset}`} alt={emoji.label} />{/each}
          {/if}
          {#each item.attachments ?? [] as attachment (attachment.id)}<MessagesAttachment {attachment} state={messageState} {windowId} {execute} {profile} {available} conversationId={conversation.id} messageId={item.id} />{/each}
          {#if item.reactions?.length}<span class="messages-reactions" aria-label="Message reactions">{#each item.reactions as reaction}<span title={reaction.participant}>{reaction.emoji}</span>{/each}</span>{/if}
        </li>
      {/each}
      {#if !conversation || !conversation.items.length}
        <li class="messages-empty" role="status">{conversation ? 'No messages in this conversation.' : 'Select a conversation.'}</li>
      {/if}
    </ol>
    {#if interactionError}<p class="messages-interaction-error" role="status">{interactionError}</p>{/if}

    <div class="messages-composer" aria-label="Message composer">
      <div class="messages-input-capsule">
        <MessagesDraftEditor bind:this={draftEditor} state={messageState} {windowId} {execute} {available} />
        <button class="messages-emoji-button" data-messages-control="emoji-picker" aria-label="Emoji" disabled={!available || !draft} onpointerdown={event => event.preventDefault()} onclick={() => richControls?.showEmoji()}>
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <circle class="smiley-outline" cx="14" cy="14" r="11.3" />
            <circle class="smiley-eye" cx="10" cy="10" r="1.3" />
            <circle class="smiley-eye" cx="18" cy="10" r="1.3" />
            <path class="smiley-mouth" d="M6.7 15.2c1.1 8.6 13.5 8.6 14.6 0-4.1 1.8-10.5 1.8-14.6 0Z" />
          </svg>
        </button>
      </div>
      {#if draft?.fields.body.trim() || draft?.attachments.length}<button class="messages-send-button" data-messages-control="draft-send" aria-label="Send local message" disabled={!available || !messageDraftCanSend(messageState, draft, resolveRecipient)} onclick={() => draftEditor?.send()}>↑</button>{:else}
      <button class="messages-microphone-button" data-messages-control="audio-fixture" aria-label="Add authored local audio clip (not a microphone recording)" disabled={!available || !draft} onclick={() => richControls?.audio()}>
        <svg viewBox="0 0 20 30" aria-hidden="true">
          <rect x="6" y="2" width="8" height="18" rx="4" />
          <path d="M3.5 13v3.5a6.5 6.5 0 0 0 13 0V13M10 23v5m-4 0h8" />
        </svg>
      </button>
      {/if}
    </div>
  </div>
  <MessagesRichControls bind:this={richControls} state={messageState} {windowId} {execute} {profile} {available} {resolveRecipients} />
</section>
