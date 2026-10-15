<script>
  import { onMount, tick } from 'svelte';
  import { selectedMessageConversation, messagePreview, messageSearchResults, messagesHistoryCutoff } from './messages-state.js';
  import { createMessagesNativeView } from './messages-native-view.js';
  import { messageDraft, messageDraftCanSend } from './messages-composition.js';
  import MessagesDraftEditor from './MessagesDraftEditor.svelte';
  import MessagesRecipientPicker from './MessagesRecipientPicker.svelte';
  import MessagesRichControls from './MessagesRichControls.svelte';
  import MessagesAttachment from './MessagesAttachment.svelte';
  import { createWindows11AppView } from './windows11-app-view.js';
  import Windows11Icon from './Windows11Icon.svelte';
  import './windows11-teams.css';

  let { state: messageState, native, profile, windowId, execute, registerView, registerApplicationView, resolveRecipients, resolveRecipient, available = true, active = true } = $props();
  let panel;
  let mounted = false;
  let originalRoot = null;
  let originalState;
  let originalNative;
  let context = $state(null);
  let interactionError = $state('');
  let requestId = 0;
  const mini = $derived(native.ui.surface === 'mini');
  const people = $derived(native.ui.page === 'people');
  const history = $derived(!mini && native.ui.searchMode === 'history');
  const selected = $derived(selectedMessageConversation(messageState));
  const draft = $derived(messageDraft(messageState));
  let draftEditor;
  let richControls;
  const searching = $derived(Boolean(messageState.query.trim()));
  const cutoff = $derived(messagesHistoryCutoff(profile.defaults.sceneTime));
  // The wrapper changes presentation query only; records retain their canonical identity.
  const names = $derived(messageSearchResults(history ? { ...messageState, query: '' } : messageState, { scope: 'names' }));
  const hits = $derived(history && searching ? messageSearchResults(messageState, { scope: 'history', conversationId: selected?.id ?? null, historySince: cutoff }) : []);
  const contextConversation = $derived(messageState.conversations.find(row => row.id === context?.id));
  const ownedRoot = () => mounted && available && panel === originalRoot && messageState === originalState && native === originalNative ? panel : null;
  let messagesView;
  let applicationView;

  function owns(node = panel) {
    return Boolean(ownedRoot()?.isConnected && node?.isConnected && panel.contains(node) && !panel.closest('[hidden], [inert]'));
  }
  async function command(name, target = {}, payload = {}, node = panel) {
    if (!owns(node)) return null;
    const owner = panel;
    const request = ++requestId;
    const result = await execute(name, { windowId, ...target }, payload);
    if (owner === panel && owns() && request === requestId) interactionError = result?.status === 'rejected' ? result.error.message : '';
    return result;
  }
  const appCommand = (name, target = {}, payload = {}, node = panel) => command(name, { appId: 'teams', ...target }, payload, node);
  async function select(conversationId, messageId = null) {
    if (context) await command('messages.context.close', {}, { restoreFocus: false });
    if (history && !messageId) {
      const result = await command('win11.teams.searchMode.set', {}, { mode: 'names' });
      if (result?.status !== 'applied') return;
    }
    // Common selection owns read state and mini-to-full expansion.
    return command('messages.conversation.select', { conversationId }, messageId ? { messageId } : {});
  }
  async function findInChat() {
    if (!active || !owns() || !selected) return;
    if (mini) {
      const result = await command('win11.teams.surface.set', {}, { surface: 'full' });
      if (result?.status !== 'applied' || !owns()) return;
    }
    const result = await command('win11.teams.searchMode.set', {}, { mode: 'history' });
    if (result?.status === 'applied') {
      await tick();
      await command('messages.focus', { controlId: 'search' });
    }
  }
  async function closeFind() {
    const result = await command('win11.teams.searchMode.set', {}, { mode: 'names' });
    if (result?.status === 'applied') await command('messages.focus', { controlId: 'search' });
  }
  async function openSettings(kind = 'preferences') {
    if (!active || !owns()) return;
    const result = await appCommand('win11.apps.menu', {}, { menu: null });
    if (result?.status !== 'applied' || !owns()) return;
    await tick();
    panel.querySelector('[data-control="teams-more"]')?.focus({ preventScroll: true });
    await command('messages.conversation.details', {}, { panel: kind, open: true });
  }
  async function toggleMore() {
    const opening = native.ui.menu !== 'more';
    const result = await appCommand('win11.apps.menu', {}, { menu: opening ? 'more' : null });
    if (result?.status === 'applied' && owns()) {
      await tick();
      panel.querySelector(opening ? '[data-control="teams-menu-settings"]' : '[data-control="teams-more"]')?.focus({ preventScroll: true });
    }
  }
  function moreKey(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { void toggleMore(); return; }
    const rows = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    const index = rows.indexOf(document.activeElement);
    rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + rows.length) % rows.length]?.focus();
  }
  async function clearSearch() {
    const result = await command('messages.search', {}, { query: '' });
    if (result?.status === 'applied') await command('messages.focus', { controlId: 'search' });
  }
  function navigate(event, fromSearch = false) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !owns(event.currentTarget)) return;
    if (event.key === 'Enter' && fromSearch) {
      const first = history ? hits[0] : names[0];
      if (first && (!history || first.messageIds.length)) {
        event.preventDefault();
        void select(first.conversation.id, history ? first.messageIds[0] : null);
      }
      return;
    }
    if (history && fromSearch || !names.length) return;
    const id = event.currentTarget.dataset.messagesControl?.replace('conversation:', '');
    const index = names.findIndex(result => result.conversation.id === id);
    let next;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : Math.min(index + 1, names.length - 1);
    else if (event.key === 'ArrowUp') next = index < 0 ? names.length - 1 : Math.max(index - 1, 0);
    else if (!fromSearch && event.key === 'Home') next = 0;
    else if (!fromSearch && event.key === 'End') next = names.length - 1;
    else return;
    event.preventDefault();
    void command('messages.focus', { controlId: `conversation:${names[next].conversation.id}` });
  }
  function rowKey(event, row) {
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') openContext(event, row);
    else navigate(event);
  }
  function openContext(event, row) {
    event.preventDefault();
    void command('messages.context.open', { conversationId: row.id }, event.type === 'contextmenu' ? { point: { x: event.clientX, y: event.clientY } } : {}, event.currentTarget);
  }
  function dismissContext(event) {
    if (context && !event.target.closest?.('[data-messages-context]')) void command('messages.context.close', {}, { restoreFocus: false });
    if (native.ui.menu && !event.target.closest?.('[data-teams-more]')) void appCommand('win11.apps.menu', {}, { menu: null });
  }
  async function markContext() {
    if (!contextConversation) return;
    const row = contextConversation;
    const result = await command('messages.conversation.setUnread', { conversationId: row.id }, { unread: !row.unread });
    if (result?.status === 'applied') await command('messages.context.close');
  }
  function keyboard(event) {
    if (!active || !owns() || event.defaultPrevented || event.isComposing) return;
    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (selected) void findInChat();
      else void command('messages.focus', { controlId: 'search' });
    } else if (event.key === 'Escape') {
      if (context) { event.preventDefault(); void command('messages.context.close'); }
      else if (native.ui.menu) { event.preventDefault(); void appCommand('win11.apps.menu', {}, { menu: null }); }
      else if (history) { event.preventDefault(); void closeFind(); }
      else if (searching) { event.preventDefault(); void clearSearch(); }
    }
  }
  function observeFocus(event) {
    const node = event.target.closest?.('[data-control]');
    if (!owns(node)) return;
    void appCommand('win11.apps.focus.observe', { control: node.dataset.control }, {}, node);
  }
  function observeBlur(event) {
    if (!panel?.contains(event.relatedTarget)) queueMicrotask(() => {
      if (owns() && applicationView.focusedControl() === null) void appCommand('win11.apps.focus.observe', { control: null });
    });
  }
  function observeSelection(event) {
    const node = event.target;
    if (owns(node) && node.dataset.control && typeof node.selectionStart === 'number') {
      void appCommand('win11.apps.selection.observe', { control: node.dataset.control }, { start: node.selectionStart, end: node.selectionEnd }, node);
    }
  }
  function observeScroll(event, areaId) {
    const node = event.currentTarget;
    void appCommand('win11.apps.scroll.observe', { area: areaId }, { top: node.scrollTop, left: node.scrollLeft }, node);
  }
  const dateLabel = timestamp => new Date(timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const timeLabel = timestamp => new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

  onMount(() => {
    originalState = messageState;
    originalNative = native;
    messagesView = createMessagesNativeView({ getRoot: () => panel, getState: () => messageState, windowId,
      available: () => Boolean(ownedRoot()), tick, getContext: () => context, setContext: value => { context = value; },
      setPanel: (...args) => richControls?.setPanel(...args),
      setPreferencePane: (...args) => richControls?.setPreferencePane(...args),
      setDetailsSection: (...args) => richControls?.setDetailsSection(...args),
      setMessageActions: (...args) => richControls?.setMessageActions(...args), quickLookAttachment: (...args) => richControls?.quickLookAttachment(...args),
      setPreferenceFolders: (...args) => richControls?.setPreferenceFolders(...args),
      setPreferenceContacts: (...args) => richControls?.setPreferenceContacts(...args),
      setPreferenceSceneTime: (...args) => richControls?.setPreferenceSceneTime(...args),
      playReceivedSound: (...args) => richControls?.playReceivedSound(...args) });
    applicationView = createWindows11AppView(ownedRoot);
    mounted = true;
    originalRoot = panel;
    registerView(messagesView);
    const unregisterApplication = registerApplicationView(windowId, applicationView);
    return () => {
      mounted = false;
      registerView(null, messagesView);
      unregisterApplication?.();
    };
  });
</script>

{#snippet glyph(name)}
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    {#if name === 'search'}<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>
    {:else if name === 'chat'}<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/>
    {:else if name === 'people'}<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>
    {:else if name === 'video'}<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-4v12l-6-4"/>
    {:else if name === 'call'}<path d="m6 3 4 4-3 3a18 18 0 0 0 7 7l3-3 4 4-2 3C10 21 3 14 3 5Z"/>
    {:else if name === 'close'}<path d="m6 6 12 12M18 6 6 18"/>
    {:else if name === 'more'}<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>
    {:else if name === 'back'}<path d="m14 5-7 7 7 7"/>{/if}
  </svg>
{/snippet}

{#snippet searchField(mode)}
  <label class="teams-search">
    {@render glyph('search')}
    <input data-control={mode === 'history' ? 'teams-history-search' : 'teams-name-search'} data-messages-control="search" aria-label={mode === 'history' ? 'Find in chat — last six months' : 'Search by name'} placeholder={mode === 'history' ? 'Find in chat' : 'Search by name'} value={messageState.query} maxlength="4096" oninput={event => command('messages.search', {}, { query: event.currentTarget.value }, event.currentTarget)} onkeydown={event => navigate(event, true)} onselect={observeSelection} onkeyup={observeSelection} onclick={observeSelection}/>
    {#if searching}<button data-control="teams-clear-search" aria-label="Clear search" onclick={clearSearch}>{@render glyph('close')}</button>{/if}
  </label>
{/snippet}

{#snippet conversationList()}
  <div class="teams-list-heading"><h2>{people ? 'Contacts' : searching && !history ? 'Search results' : 'Recent'}</h2><button class="teams-icon-button" data-control="teams-new-chat" data-messages-control="new-message" aria-label="New chat" disabled={!available} onclick={() => command('messages.compose.new')}>✎</button></div>
  <div class="teams-conversations" data-area="conversations" data-messages-area="conversations" aria-label={people ? 'People and their chats' : 'Recent chats'} onscroll={event => observeScroll(event, 'conversations')}>
    <ul>
      {#each names as { conversation: row } (row.id)}
        {@const preview = messagePreview(row)}
        <li class:selected={!mini && row.id === messageState.selectedConversationId} class:unread={row.unread}>
          <button class="teams-conversation" data-control={`teams-conversation:${row.id}`} data-messages-control={`conversation:${row.id}`} aria-current={row.id === messageState.selectedConversationId ? 'true' : undefined} aria-label={`${row.name}${row.unread ? ', unread' : ''}`} onclick={() => select(row.id)} onkeydown={event => rowKey(event, row)} oncontextmenu={event => openContext(event, row)}>
            <span class="teams-avatar" style:background={row.tint} aria-hidden="true">{row.initials}</span>
            <span class="teams-conversation-copy"><span class="teams-row-heading"><strong>{people && row.participants.length === 1 ? row.participants[0] : row.name}</strong>{#if !people}<time>{row.timeLabel || timeLabel(row.timestamp)}</time>{/if}</span><span class="teams-preview">{people ? row.participants.length > 1 ? row.participants.join(', ') : 'Personal chat' : preview.lines.join(' ') || 'No messages yet'}</span></span>
            {#if row.unread}<span class="teams-unread-dot" aria-hidden="true"></span>{/if}
          </button>
        </li>
      {:else}
        <li class="teams-empty" role="status"><strong>{searching && !history ? 'No names found' : people ? 'No people to show' : 'No recent chats'}</strong><p>{searching && !history ? 'Try another contact or chat name.' : people ? 'People from your local chats will appear here.' : 'Your local conversations will appear here.'}</p></li>
      {/each}
    </ul>
  </div>
{/snippet}

<svelte:window onkeydown={keyboard}/>
<svelte:document onpointerdown={dismissContext} onfocusin={dismissContext}/>
<section bind:this={panel} class="windows11-teams" class:mini class:people class:full={!mini} class:inactive={!active} data-app-id="teams" data-window-id={windowId} data-messages-window-id={windowId} aria-label="Microsoft Teams (free)" onfocusin={observeFocus} onfocusout={observeBlur}>
  <header class="teams-app-header" data-window-drag>
    <button class="teams-account" data-control="teams-account" data-messages-control="account-button" data-window-no-drag disabled={!available} title="Fictional shared local account" aria-label={`${messageState.account.name}, ${messageState.account.signedIn ? messageState.account.status : 'Signed out'}`} onclick={() => command('messages.conversation.details', {}, { panel: 'account', open: true })}><span class="teams-avatar account-avatar">{messageState.account.initials}<i></i></span></button>
    {#if !mini}<Windows11Icon name="teams" size={24}/><span class="teams-brand">Microsoft Teams</span>{/if}
    <div class="teams-header-actions" data-window-no-drag>{#if mini}<button class="teams-icon-button" data-control="teams-chat-details" data-messages-control="conversation-details" aria-label="Chat details" disabled={!available || !selected} onclick={() => richControls?.details()}>{@render glyph('more')}</button>{/if}<div data-teams-more><button class="teams-icon-button" data-control="teams-more" aria-label={mini ? 'What’s new and more' : 'Settings and more'} aria-expanded={native.ui.menu === 'more'} onclick={toggleMore}>{@render glyph('more')}</button></div>{#if !mini}<button class="teams-icon-button" data-control="teams-surface" title="Open mini Teams" aria-label="Open mini Teams" onclick={() => command('win11.teams.surface.set', {}, { surface: 'mini' })}>{@render glyph('back')}</button>{/if}</div>
  </header>
  <div class="teams-workspace">
    <aside class="teams-sidebar" aria-label="Teams navigation and chats">
      {#if mini && people}<div class="teams-people-heading"><button class="teams-icon-button" data-control="teams-people-back" aria-label="Back to Recent chats" onclick={() => command('win11.teams.page.set', {}, { page: 'chat' })}>{@render glyph('back')}</button><h1>People</h1></div>{/if}
      {#if !history}{@render searchField('names')}{:else}<div class="teams-history-scope">Searching this chat only<button data-control="teams-return-name-search" onclick={closeFind}>Search by name</button></div>{/if}
      <nav class="teams-tabs" aria-label="Teams pages"><button disabled title="Meetings unavailable in this local scene">{@render glyph('video')}<span>Meet</span></button><button data-control="teams-page-chat" aria-current={!people ? 'page' : undefined} onclick={() => command('win11.teams.page.set', {}, { page: 'chat' })}>{@render glyph('chat')}<span>Chat</span></button><button data-control="teams-page-people" aria-current={people ? 'page' : undefined} onclick={() => command('win11.teams.page.set', {}, { page: 'people' })}>{@render glyph('people')}<span>People</span></button></nav>
      {@render conversationList()}
    </aside>
    {#if !mini}
      <main class="teams-thread">
        <header class="teams-thread-header">{#if selected}<span class="teams-avatar" style:background={selected.tint} aria-hidden="true">{selected.initials}</span><div><h1>{selected.name}</h1><span>{selected.participants.join(', ')}</span></div>{:else if draft}<label>To: <MessagesRecipientPicker state={messageState} {windowId} {execute} {available} {resolveRecipients} windows={true} /></label>{:else}<h1>Chat</h1>{/if}<div class="teams-thread-actions"><button class="teams-icon-button" disabled aria-label="Video call unavailable">{@render glyph('video')}</button><button class="teams-icon-button" disabled aria-label="Audio call unavailable">{@render glyph('call')}</button><button class="teams-icon-button" data-control="teams-find-in-chat" disabled={!selected} aria-label="Find in chat" title="Find in chat (Ctrl+F)" onclick={findInChat}>{@render glyph('search')}</button><button class="teams-icon-button" data-messages-control="conversation-details" disabled={!available || !selected} aria-label="Chat details" onclick={() => richControls?.details()}>ⓘ</button></div></header>
        <ol class="teams-history" data-area="thread" data-messages-area="thread" data-messages-conversation-id={selected?.id} aria-label={selected ? `Chat with ${selected.name}` : 'Chat history'} onscroll={event => observeScroll(event, 'thread')}>
          {#each selected?.items ?? [] as item, index (item.id)}
            {#if index === 0 || dateLabel(item.timestamp) !== dateLabel(selected.items[index - 1].timestamp)}<li class="teams-date"><span>{dateLabel(item.timestamp)}</span></li>{/if}
            <li class="teams-message" class:outgoing={item.direction === 'outgoing'} class:message-hit={messageState.selectedMessageId === item.id} data-control={`teams-message:${item.id}`} data-messages-control={`message:${item.id}`} tabindex="-1"><span class="teams-message-meta">{item.direction === 'outgoing' ? messageState.account.name : item.sender || selected.name}<time>{timeLabel(item.timestamp)}</time></span><div class="teams-bubble">{#if item.kind === 'text'}<p>{item.text}</p>{:else if item.kind === 'image'}<p>{item.label}</p>{:else if item.kind === 'emoji'}<p>{item.assets.map(asset => asset.label).join(' ')}</p>{/if}{#each item.attachments ?? [] as attachment (attachment.id)}<MessagesAttachment {attachment} state={messageState} {windowId} {execute} {profile} {available} conversationId={selected.id} messageId={item.id} />{/each}{#if item.reactions?.length}<span class="messages-reactions" aria-label="Message reactions">{#each item.reactions as reaction}<span title={reaction.participant}>{reaction.emoji}</span>{/each}</span>{/if}</div>{#if item.delivery}<span class="teams-delivery">{item.delivery}</span>{/if}</li>
          {:else}<li class="teams-empty" role="status"><strong>{selected ? 'No messages yet' : 'Select a chat'}</strong><p>{selected ? 'This local conversation has no messages.' : 'Choose a conversation to view its history.'}</p></li>{/each}
        </ol>
        <div class="teams-composer" aria-label="Message composer"><MessagesDraftEditor bind:this={draftEditor} state={messageState} {windowId} {execute} {available} mac={false} placeholder="Type a message" /><div class="messages-teams-compose-tools"><button data-messages-control="attach-file" disabled={!available || !draft} onclick={() => richControls?.attach()}>Attach</button><button data-messages-control="emoji-picker" disabled={!available || !draft} onpointerdown={event => event.preventDefault()} onclick={() => richControls?.showEmoji()}>Emoji</button><button data-messages-control="audio-fixture" disabled={!available || !draft} title="Authored local PCM WAV, not a microphone recording" onclick={() => richControls?.audio()}>Audio Clip</button><span>Local only</span><button data-control="teams-send-message" data-messages-control="draft-send" disabled={!available || !messageDraftCanSend(messageState, draft, resolveRecipient)} aria-label="Send local message" onclick={() => draftEditor?.send()}>➤</button></div></div>
      </main>
      {#if history}<aside class="teams-find" aria-label="Find in chat"><header><h2>Find in chat</h2><button class="teams-icon-button" data-control="teams-close-find" aria-label="Close Find in chat" onclick={closeFind}>{@render glyph('close')}</button></header>{@render searchField('history')}<p class="teams-find-scope">{selected?.name} · Last six months</p><div class="teams-find-results" data-area="teams-find-results" onscroll={event => observeScroll(event, 'teams-find-results')}><ul>{#each hits as result (result.conversation.id)}{#each result.messageIds as messageId (messageId)}{@const item = result.conversation.items.find(item => item.id === messageId)}<li><button class:active-hit={messageState.selectedMessageId === messageId} data-control={`teams-hit:${result.conversation.id}:${messageId}`} data-messages-control={`hit:${result.conversation.id}:${messageId}`} onclick={() => select(result.conversation.id, messageId)}><span>{item.sender || (item.direction === 'outgoing' ? native.account.displayName : result.conversation.name)}</span><time>{dateLabel(item.timestamp)}</time><p>{item.text}</p></button></li>{/each}{/each}</ul>{#if !searching}<p class="teams-empty" role="status">Enter a keyword to find messages in this chat.</p>{:else if !hits.some(result => result.messageIds.length)}<p class="teams-empty" role="status">No matching messages in this chat from the last six months.</p>{/if}</div></aside>{/if}
    {/if}
  </div>
  {#if native.ui.menu === 'more'}<div class="teams-more-menu" data-teams-more role="menu" aria-label={mini ? 'What’s new and more' : 'Settings and more'} onkeydown={moreKey}><button role="menuitem" data-control="teams-menu-settings" onclick={() => openSettings()}>Settings — local counterpart</button><button role="menuitem" data-control="teams-menu-help" onclick={() => openSettings('help')}>Help — local guide</button><p>2023 personal Teams package reconstruction. Settings categories use qualified Microsoft guidance, not an exact independently verified package. Online release notes, feedback and Link your phone require unavailable services.</p></div>{/if}
  {#if context && contextConversation}<div class="teams-context" data-messages-context role="menu" aria-label="Chat actions" style:left={`${context.x}px`} style:top={`${context.y}px`}><button role="menuitem" data-control={`teams-context-unread:${context.id}`} data-messages-control={`context-unread:${context.id}`} onclick={markContext}>{contextConversation.unread ? 'Mark as read' : 'Mark as unread'}</button></div>{/if}
  {#if interactionError}<p class="teams-interaction-error" role="status">{interactionError}</p>{/if}
  <MessagesRichControls bind:this={richControls} state={messageState} {windowId} {execute} {profile} {available} {resolveRecipients} />
</section>
