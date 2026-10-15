<script>
  import { onMount, tick } from 'svelte';
  import { selectedMessageConversation, messagesRetentionCutoff, messageSharedContent } from './messages-state.js';
  import { messagePreferencePanes } from './messages-preference-navigation.js';
  import { messageDraft } from './messages-composition.js';
  import { MESSAGE_TAPBACKS, MESSAGE_INCOMING_FIXTURES, TEAMS_REACTION_QUICK_SET, attachmentContent } from './messages-rich-commands.js';
  import { recipientIdentity } from './messages-recipients.js';
  import MessagesAttachment from './MessagesAttachment.svelte';
  import MessagesAudioPreview from './MessagesAudioPreview.svelte';
  import MessagesPdfQuickLook from './MessagesPdfQuickLook.svelte';
  import { AUDIO_FIXTURES } from './audio-fixtures.js';
  import { documentFileMime } from './document-destination-commands.js';
  import './messages.css';
  let { state: messageState, windowId, execute, profile, available = true, resolveRecipients = null } = $props();
  let root;
  let ownerRoot;
  let ownerState;
  let ownerWindowId;
  let ownerExecute;
  let ownerProfile;
  let mounted = false;
  let panel = $state(null);
  let preferenceTab = $state('general');
  let accountTab = $state('settings');
  let blockedInput = $state('');
  let preferenceFolders = $state([]);
  let soundNode;
  let soundSource = $state('');
  let accountName = $state('');
  let preferenceContacts = $state([]);
  let sharedApp = $state('photos');
  let effectOpen = $state(null);
  let lastEffectId = null;
  let preferenceSceneTime = $state(null);
  let panelReturn = null;
  let panelConversationId;
  let emojiOpen = $state(false);
  let quickLook = $state.raw(null);
  const quickLookMime = $derived(documentFileMime(quickLook));
  let quickLookSource = $state.raw(null);
  let quickLookGuard = $state.raw(() => false);
  let messageContext = $state(null);
  let confirmation = $state(null);
  let error = $state('');
  let rename = $state('');
  let addParticipant = $state('');
  let reaction = $state('');
  let label = $state('');
  let latitude = $state('');
  let longitude = $state('');
  let locationEditor = $state(false);
  let nameEditor = $state(false);
  let attachmentTab = $state('photos');
  let detailsSection = $state('summary');
  let detailsIntent = 0;
  let detailsConversation;
  let intent = 0;
  const conversation = $derived(selectedMessageConversation(messageState));
  const participantRoster = $derived.by(() => {
    const names = new Map();
    if (typeof resolveRecipients === 'function') {
      for (const choice of resolveRecipients('')) {
        const identity = recipientIdentity(choice.address);
        if (!names.has(identity)) names.set(identity, choice.name);
      }
    }
    return (conversation?.participants ?? []).map(address => ({ address, name: names.get(recipientIdentity(address)) || address }));
  });
  const draft = $derived(messageDraft(messageState));
  const selectedMessage = $derived(conversation?.items.find(item => item.id === messageContext));
  const sharedAttachments = $derived(conversation?.items.flatMap(item => (item.attachments ?? []).map(attachment => ({ attachment, messageId: item.id }))) ?? []);
  const classic = $derived(['mojave', 'high-sierra'].includes(profile.renderer));
  const windows = $derived(profile.renderer === 'windows11');
  const modernReactions = $derived(windows || profile.renderer === 'golden-gate');
  const emojis = ['😀', '😊', '😂', '❤️', '👍', '🎉', '🌲', '⛺', '☀️', '🌊', '🚲', '🍎', '☕', '📍', '✨', '👋'];
  const others = $derived(conversation?.participants.length ?? 0);
  const group = $derived(conversation ? conversation.participants.length > 1 : false);
  const canLeaveGroup = $derived(group && (windows || others >= 3));
  const photos = $derived(sharedAttachments.filter(entry => entry.attachment.kind === 'image'));
  const files = $derived(sharedAttachments.filter(entry => entry.attachment.kind !== 'image'));
  const screenedThreads = $derived(messageState.conversations.filter(row => row.items.some(item => item.screened || item.spam)));
  const sharedContent = $derived(messageSharedContent(messageState, preferenceContacts, sharedApp));
  const profileMessages = $derived(conversation?.items.filter(item => item.profile) ?? []);
  const latestEffect = $derived(conversation?.items.findLast(item => item.effect && !item.screened && !item.spam));
  const owns = () => mounted && available && root?.isConnected && messageState === ownerState
    && windowId === ownerWindowId && execute === ownerExecute && profile === ownerProfile
    && root.closest('[data-messages-window-id]') === ownerRoot && !root.closest('[hidden], [inert]');
  const guarded = guard => owns() && (typeof guard !== 'function' || guard() === true) && owns();
  onMount(() => {
    ownerRoot = root.closest('[data-messages-window-id]'); ownerState = messageState; mounted = true;
    ownerWindowId = windowId; ownerExecute = execute; ownerProfile = profile;
    return () => { mounted = false; soundNode?.pause(); ownerRoot?.style.removeProperty('--messages-conversation-background'); ownerRoot?.classList.remove('messages-local-background'); };
  });
  $effect(() => {
    if (!available || ownerState && (messageState !== ownerState || windowId !== ownerWindowId || execute !== ownerExecute || profile !== ownerProfile)) {
      panel = null; emojiOpen = false; quickLook = null; messageContext = null; confirmation = null;
      locationEditor = false; nameEditor = false; attachmentTab = 'photos'; detailsConversation = undefined;
    }
  });
  $effect(() => {
    const selected = conversation;
    rename = selected?.name ?? ''; label = selected?.location?.label ?? '';
    latitude = selected?.location ? String(selected.location.latitude) : '';
    longitude = selected?.location ? String(selected.location.longitude) : '';
    messageContext = null; confirmation = null; addParticipant = ''; quickLook = null;
  });
  $effect(() => {
    const id = conversation?.id ?? null;
    if (panelConversationId !== undefined && (panelConversationId !== id || detailsConversation !== conversation)) {
      if (['details', 'attachments'].includes(panel)) panel = null;
      locationEditor = false; nameEditor = false; attachmentTab = 'photos'; panelReturn = null;
    }
    panelConversationId = id;
    detailsConversation = conversation;
  });
  $effect(() => {
    const preferences = messageState.preferences;
    const host = root?.closest('[data-messages-window-id]');
    if (host) {
      host.classList.toggle('messages-hide-previews', preferences?.showPreviews === false);
      if (preferences?.textSize && preferences.textSize !== 13) host.style.setProperty('--messages-user-text-size', `${preferences.textSize}px`);
      else host.style.removeProperty('--messages-user-text-size');
      const background = profile.renderer === 'golden-gate' && preferences.allowBackgrounds ? conversation?.background : null;
      host.classList.toggle('messages-local-background', Boolean(background));
      if (background) host.style.setProperty('--messages-conversation-background', `url("${background.dataURI}")`);
      else host.style.removeProperty('--messages-conversation-background');
    }
  });
  $effect(() => {
    if (!available || !messageState.preferences.autoPlayEffects) effectOpen = null;
    else if (latestEffect && latestEffect.id !== lastEffectId && mounted) {
      lastEffectId = latestEffect.id; effectOpen = latestEffect.id;
    }
  });
  async function command(name, target = {}, payload = {}) {
    if (!owns()) return null;
    const original = ownerState, version = ++intent;
    const result = await execute(`messages.${name}`, { windowId, ...target }, payload);
    if (owns() && original === messageState && version === intent) error = result?.status === 'rejected' ? result.error.message : '';
    return result;
  }
  export function setPreferenceFolders(rows, guard) {
    if (!guarded(guard) || !Array.isArray(rows) || rows.some(row => typeof row.id !== 'string' || typeof row.name !== 'string')) return false;
    preferenceFolders = rows.map(row => ({ ...row }));
    return guarded(guard);
  }
  export function setPreferenceContacts(endpoints, guard) {
    if (!guarded(guard) || !Array.isArray(endpoints) || endpoints.some(value => typeof value !== 'string')) return false;
    preferenceContacts = [...endpoints];
    return guarded(guard);
  }
  export function setPreferenceSceneTime(time, guard) {
    if (!guarded(guard) || !Number.isSafeInteger(time) || time < 0) return false;
    preferenceSceneTime = time; return guarded(guard);
  }
  export async function playReceivedSound(soundId, guard) {
    if (!guarded(guard) || !['none', 'glass-study', 'golden-arpeggio'].includes(soundId)) return false;
    if (soundId === 'none') { soundNode?.pause(); return guarded(guard); }
    const source = soundId === 'glass-study' ? AUDIO_FIXTURES.quicktime.src : AUDIO_FIXTURES.music.src;
    soundNode?.pause(); soundSource = source;
    await tick();
    if (!guarded(guard) || !soundNode?.isConnected) return false;
    const node = soundNode; node.currentTime = 0;
    try { await node.play(); }
    catch (failure) { if (owns()) error = failure?.message ?? 'The browser refused local sound playback.'; return false; }
    if (!guarded(guard) || soundNode !== node) { node.pause(); return false; }
    return !node.paused;
  }
  function changeRetention(event) {
    const value = event.currentTarget.value;
    event.currentTarget.value = messageState.preferences.keepMessages;
    if (value === messageState.preferences.keepMessages) return;
    if (value === 'forever') return command('preferences.set', {}, { key: 'keepMessages', value });
    const cutoff = messagesRetentionCutoff(Math.max(messageState.timeBase, preferenceSceneTime ?? messageState.timeBase), value);
    const count = messageState.conversations.reduce((sum, row) => sum + row.items.filter(item => item.timestamp < cutoff).length, 0);
    requestConfirmation('preferences.set', {}, { key: 'keepMessages', value, expectedTime: Math.max(messageState.timeBase, preferenceSceneTime ?? messageState.timeBase) }, 'Delete Older Messages?',
      `Keep messages for ${value === '30days' ? '30 days' : 'one calendar year'}. ${count} older message${count === 1 ? '' : 's'} and their retained attachments will be permanently removed now; later expiry uses only the authored scene clock. Unsent drafts remain. This cannot be undone.`);
  }
  export async function setMessageActions(messageId, open, guard) {
    if (!guarded(guard) || panel || quickLook || confirmation || emojiOpen) return false;
    const original = conversation, item = original?.items.find(item => item.id === messageId);
    if (!item || !open && messageContext !== null && messageContext !== messageId) return false;
    const active = document.activeElement, actionPanel = root.querySelector('.messages-message-actions');
    const returnFocus = !open && actionPanel?.contains(active);
    messageContext = open ? messageId : null;
    await tick();
    if (!guarded(guard) || conversation !== original || !original.items.includes(item) || messageContext !== (open ? messageId : null)) return false;
    const node = open ? root.querySelector('[data-messages-control="message-actions-close"]')
      : [...ownerRoot.querySelectorAll('[data-messages-control]')].find(node => node.dataset.messagesControl === `message:${messageId}`);
    if (open || returnFocus && (document.activeElement === document.body || document.activeElement === active)
      && !ownerRoot.closest('.managed-window')?.classList.contains('inactive')) {
      node?.scrollIntoView({ block: 'nearest' }); node?.focus({ preventScroll: true });
    }
    return guarded(guard) && (!open || document.activeElement === node);
  }
  async function submitDetails(name, payload) {
    const original = conversation, section = detailsSection, version = ++detailsIntent;
    if (!original || !owns() || panel !== 'details') return;
    const result = await command(name, { conversationId: original.id }, payload);
    if (result?.status === 'applied' && owns() && conversation === original && panel === 'details'
      && detailsIntent === version && detailsSection === section) {
      nameEditor = false; locationEditor = false; detailsSection = 'summary';
    }
  }
  export async function setDetailsSection(section, discard, guard) {
    if (!guarded(guard) || panel !== 'details' || !conversation
      || !['summary', 'name', 'location', 'photos', 'files'].includes(section)
      || section === 'name' && (!group || conversation.left)) return false;
    const original = conversation, version = ++detailsIntent;
    if (discard) { rename = original.name; label = original.location?.label ?? ''; latitude = original.location ? String(original.location.latitude) : ''; longitude = original.location ? String(original.location.longitude) : ''; }
    detailsSection = section;
    nameEditor = section === 'name'; locationEditor = section === 'location';
    if (section === 'photos' || section === 'files') attachmentTab = section;
    await tick();
    if (!guarded(guard) || panel !== 'details' || conversation !== original || detailsSection !== section || detailsIntent !== version) return false;
    const key = section === 'name' ? 'conversation-name' : section === 'location' ? 'location-label'
      : section === 'summary' ? 'details-close' : classic ? `shared-${section}` : `details-media:${section}`;
    const node = root.querySelector(`[data-messages-control="${key}"]`);
    if (!node?.isConnected) return false;
    node.scrollIntoView({ block: 'nearest' }); node.focus({ preventScroll: true });
    return guarded(guard) && conversation === original && document.activeElement === node;
  }
  export async function setPreferencePane(pane, section, guard) {
    if (!guarded(guard) || !['preferences', 'account'].includes(panel)
      || !messagePreferencePanes(profile).some(tab => tab.id === pane)
      || section !== null && (pane !== 'account' || !['settings', 'blocked'].includes(section))) return false;
    const originalPanel = panel;
    preferenceTab = pane;
    if (pane === 'account') accountTab = section ?? 'settings';
    await tick();
    if (!guarded(guard) || panel !== originalPanel || preferenceTab !== pane || pane === 'account' && accountTab !== section) return false;
    const node = root.querySelector(`[data-messages-control="${pane === 'account' ? `account-tab:${section}` : `preference-tab:${pane}`}"]`);
    if (!node?.isConnected) return false;
    node.focus({ preventScroll: true });
    return guarded(guard) && document.activeElement === node;
  }
  function capturePanelReturn(node) {
    if (!node?.dataset || !ownerRoot.contains(node)) return null;
    const originalDraft = draft, originalConversation = conversation;
    const fields = originalDraft?.fields, revision = originalDraft?.revision, contents = JSON.stringify(originalDraft);
    const drafts = messageState.drafts, conversations = messageState.conversations;
    const controlId = node.dataset.messagesControl, nodeDraftId = node.dataset.messagesDraftId;
    return { node,
      value: typeof node.value === 'string' ? node.value : null,
      start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection,
      current: () => owns() && messageState.drafts === drafts && messageState.conversations === conversations
        && draft === originalDraft && conversation === originalConversation
        && (!originalDraft || originalDraft.fields === fields && originalDraft.revision === revision && JSON.stringify(originalDraft) === contents)
        && node.dataset.messagesControl === controlId && node.dataset.messagesDraftId === nodeDraftId };
  }
  export async function setPanel(value, open, guard) {
    if (!guarded(guard) || !['details', 'preferences', 'account', 'help', 'emoji', 'delete', 'leave', 'attachments'].includes(value)) return false;
    if (!open) { await closePanel(guard); return guarded(guard); }
    if (open && !panel && !confirmation && !emojiOpen) {
      panelReturn = capturePanelReturn(document.activeElement);
    }
    if (value === 'preferences') preferenceTab = 'general';
    if (value === 'preferences' || value === 'account') accountName = messageState.account.name;
    if (value === 'account') { preferenceTab = 'account'; accountTab = 'settings'; }
    if (value === 'emoji') emojiOpen = open;
    else if (value === 'delete' || value === 'leave') {
      if (!conversation) return false;
      if (open) requestConfirmation(`conversation.${value}`, { conversationId: conversation.id }, {},
        value === 'delete' ? 'Delete Conversation?' : 'Leave This Conversation?',
        value === 'delete' ? 'This local conversation and its messages will be removed.' : 'Local sending and arrival will stop for this group; existing history remains.');
      else confirmation = null;
    } else {
      if (value === 'details' && panel !== 'details') { detailsIntent++; detailsSection = 'summary'; nameEditor = false; locationEditor = false; }
      panel = open ? value : null;
    }
    await tick();
    if (!guarded(guard)) return false;
    if (open) root.querySelector(`[data-messages-control="${value === 'delete' || value === 'leave' ? 'confirmation-cancel' : value === 'emoji' ? 'emoji-close' : `${value}-close`}"]`)?.focus({ preventScroll: true });
    return guarded(guard);
  }
  async function closePanel(guard) {
    if (!guarded(guard)) return;
    const closingFocus = document.activeElement, ownedFocus = ownerRoot.contains(closingFocus);
    detailsIntent++;
    panel = null; emojiOpen = false; quickLook = null; messageContext = null; confirmation = null; locationEditor = false; nameEditor = false; attachmentTab = 'photos';
    rename = conversation?.name ?? ''; label = conversation?.location?.label ?? '';
    latitude = conversation?.location ? String(conversation.location.latitude) : '';
    longitude = conversation?.location ? String(conversation.location.longitude) : '';
    const token = panelReturn; panelReturn = null;
    await tick();
    if (!guarded(guard)) return;
    if (!ownedFocus || ownerRoot.closest('.managed-window')?.classList.contains('inactive')
      || document.activeElement !== document.body && document.activeElement !== closingFocus
        && document.activeElement !== token?.node) return;
    if (token?.node?.isConnected && ownerRoot.contains(token.node) && token.current()
      && !token.node.disabled && !token.node.closest('[hidden], [inert]')
      && (token.value === null || token.node.value === token.value)) {
      token.node.focus({ preventScroll: true });
      if (guarded(guard) && token.current() && document.activeElement === token.node && typeof token.start === 'number')
        token.node.setSelectionRange(token.start, token.end, token.direction);
    }
  }
  export async function quickLookAttachment(attachment, guard, target, open = true) {
    if (!guarded(guard)) return false;
    if (!open) {
      if (!quickLook || !quickLookGuard() || target?.conversationId !== quickLookSource?.conversationId
        || target?.messageId !== quickLookSource?.messageId || target?.attachmentId !== quickLookSource?.attachmentId) return false;
      quickLook = null;
      await tick();
      return guarded(guard);
    }
    const originalConversation = conversation, originalConversations = messageState.conversations, originalItems = conversation?.items;
    const originalMessage = target?.conversationId === conversation?.id
      ? conversation.items.find(item => item.id === target.messageId) : null;
    const original = originalMessage?.attachments.find(row => row.id === attachment.id);
    if (!original || original.id !== target?.attachmentId || JSON.stringify(original) !== JSON.stringify(attachment)) return false;
    const contents = JSON.stringify(original), messageContents = JSON.stringify(originalMessage), originalAttachments = originalMessage.attachments;
    quickLookSource = { conversationId: originalConversation.id, messageId: originalMessage.id, attachmentId: original.id };
    quickLookGuard = () => owns() && messageState.conversations === originalConversations && conversation === originalConversation
      && conversation.items === originalItems && originalItems.includes(originalMessage)
      && originalMessage.attachments === originalAttachments && originalAttachments.includes(original)
      && JSON.stringify(original) === contents && JSON.stringify(originalMessage) === messageContents;
    quickLook = attachment; await tick();
    if (!guarded(guard) || quickLook !== attachment || !quickLookGuard()) return false;
    const closeControl = root.querySelector('[data-messages-control="quick-look-close"]');
    closeControl?.focus();
    return guarded(guard) && quickLook === attachment && quickLookGuard() && document.activeElement === closeControl;
  }
  export function showEmoji() { return command('conversation.details', {}, { panel: 'emoji', open: !emojiOpen }); }
  async function insertEmoji(value) {
    if (!draft || !owns()) return null;
    const original = draft, node = panelReturn?.node;
    const result = await command('draft.emoji', { draftId: original.id }, { value });
    if (result?.status === 'applied' && owns() && draft === original && node?.isConnected
      && document.activeElement === node && node.value === original.fields.body) panelReturn = capturePanelReturn(node);
    return result;
  }
  export function attach() { return draft ? command('draft.attach', { draftId: draft.id }) : null; }
  export function audio() { return draft ? command('draft.audio', { draftId: draft.id }) : null; }
  function openPanel(value) {
    return command('conversation.details', value === 'details' && conversation ? { conversationId: conversation.id } : {}, { panel: value, open: true });
  }
  export function details() { return openPanel('details'); }
  function requestConfirmation(name, target, payload, title, description) {
    const node = document.activeElement;
    const invoker = ownerRoot?.contains(node) ? { node, key: node.dataset.messagesControl, draftId: node.dataset.messagesDraftId,
      value: typeof node.value === 'string' ? node.value : null,
      start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection } : null;
    confirmation = { name, target, payload, title, description, record: conversation,
      contents: JSON.stringify(conversation), authoredTime: messageState.timeBase, account: messageState.account,
      preferences: JSON.stringify(messageState.preferences), graph: JSON.stringify(messageState), invoker };
    messageContext = null;
  }
  async function dismissConfirmation(request, expectedGraph, committed = false) {
    if (!request || confirmation !== request || !owns()) return;
    const focused = document.activeElement;
    const ownedFocus = root.querySelector('.messages-rich-confirmation')?.contains(focused)
      || focused === request.invoker?.node;
    confirmation = null;
    await tick();
    const token = request.invoker, node = token?.node;
    if (!owns() || confirmation || !ownedFocus || document.activeElement !== document.body && document.activeElement !== node
      || ownerRoot.closest('.managed-window')?.classList.contains('inactive')
      || expectedGraph !== JSON.stringify(messageState) || !node?.isConnected || !ownerRoot.contains(node)
      || node.disabled || node.closest('[hidden], [inert]') || node.dataset.messagesControl !== token.key
      || node.dataset.messagesDraftId !== token.draftId
      || !committed && token.value !== null && node.value !== token.value) return;
    node.focus({ preventScroll: true });
    if (owns() && document.activeElement === node && typeof token.start === 'number'
      && (!committed || node.value === token.value))
      node.setSelectionRange(token.start, token.end, token.direction);
  }
  function cancelConfirmation() { return dismissConfirmation(confirmation, confirmation?.graph); }
  async function confirm() {
    const request = confirmation;
    if (!request || request.record !== conversation || request.contents !== JSON.stringify(conversation)
      || request.authoredTime !== messageState.timeBase || request.account !== messageState.account
      || request.preferences !== JSON.stringify(messageState.preferences) || request.graph !== JSON.stringify(messageState)) {
      confirmation = null; error = 'The original confirmation target changed. Open the action again.'; return;
    }
    const result = await command(request.name, request.target, { ...request.payload, confirmed: true });
    if (result?.status === 'applied' && confirmation === request)
      await dismissConfirmation(request, JSON.stringify(messageState), true);
  }
  function context(event) {
    const node = event.target.closest?.('[data-messages-control^="message:"]');
    if (!owns() || !node || !ownerRoot.contains(node) || !conversation) return;
    const id = node.dataset.messagesControl.slice(8);
    if (!conversation.items.some(item => item.id === id)) return;
    event.preventDefault(); event.stopPropagation(); void command('message.actions', { conversationId: conversation.id, messageId: id }, { open: true });
  }
  function keyboard(event) {
    if (event.defaultPrevented || !owns() || !ownerRoot.contains(event.target)) return;
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') context(event);
    else if (event.key === 'Escape' && (panel || emojiOpen || quickLook || messageContext || confirmation)) {
      event.preventDefault(); event.stopPropagation();
      if (confirmation) void cancelConfirmation();
      else if (quickLook) command('attachment.quickLook', quickLookSource, { open: false });
      else if (messageContext && conversation) void command('message.actions', { conversationId: conversation.id, messageId: messageContext }, { open: false });
      else void closePanel();
    }
  }
  function drag(event) {
    if (!owns() || !draft || !ownerRoot.contains(event.target)) return;
    if (Array.from(event.dataTransfer?.types ?? []).some(type => ['application/x-jesteros-file-ids', 'application/x-jesteros-file-id'].includes(type))) event.preventDefault();
  }
  async function drop(event) {
    if (!owns() || !ownerRoot.contains(event.target)) return;
    event.preventDefault(); event.stopPropagation();
    const originalDraft = draft, originalConversation = conversation;
    const many = event.dataTransfer?.getData('application/x-jesteros-file-ids');
    const single = event.dataTransfer?.getData('application/x-jesteros-file-id');
    if (!many && !single) { error = 'Drag virtual Files records here. Host files are not imported.'; return; }
    if (!originalDraft) { error = 'Select a conversation or create a message first.'; return; }
    let ids;
    try { ids = many ? JSON.parse(many) : [single]; }
    catch { error = 'The original Files drag payload is invalid.'; return; }
    if (!Array.isArray(ids) || !ids.length || ids.length > 16 || ids.some(id => typeof id !== 'string' || !id)
      || new Set(ids).size !== ids.length) { error = 'Drag distinct original Files identities only (up to 16).'; return; }
    for (const fileId of ids) {
      if (!owns() || draft !== originalDraft || conversation !== originalConversation) return;
      const result = await command('draft.attach', { draftId: originalDraft.id }, { fileId });
      if (result?.status !== 'applied') break;
    }
  }
  function receive(fixtureId) { if (conversation) return command('incoming.receive', { conversationId: conversation.id }, { fixtureId }); }
</script>

<svelte:document oncontextmenu={context} onkeydown={keyboard} ondragover={drag} ondrop={drop} />
<div bind:this={root} class="messages-rich-controls" class:classic class:windows data-window-no-drag>
  <audio bind:this={soundNode} src={soundSource || undefined} preload="none" aria-label="Original local message received sound" onerror={() => { if (soundSource && owns()) error = 'The original local sound could not be decoded.'; }}></audio>
  {#if effectOpen && !windows && !classic}<div class="messages-local-celebration" aria-label="Authored local celebration effect" onanimationend={() => effectOpen = null}><svg viewBox="0 0 500 360" aria-hidden="true">{#each Array.from({ length: 24 }, (_, index) => index) as index}<rect x={18 + index * 19} y={20 + index % 5 * 20} width="6" height="15" rx="2" fill={['#ed6959', '#5ca9cc', '#e9bd54', '#7ead82'][index % 4]} transform={`rotate(${index * 19} ${21 + index * 19} ${27 + index % 5 * 20})`} />{/each}<text x="250" y="190" text-anchor="middle" fill="#53966d" font-size="36">Congratulations!</text></svg></div>{/if}
  {#if draft?.attachments.length}<div class="messages-draft-attachments" aria-label="Draft attachments">{#each draft.attachments as attachment (attachment.id)}<MessagesAttachment {attachment} state={messageState} {windowId} {execute} {profile} {available} draftId={draft.id} />{/each}</div>{/if}
  {#if emojiOpen}<div class="messages-emoji-picker" role="dialog" aria-label="Emoji & Symbols"><header><strong>Emoji &amp; Symbols</strong><button data-messages-control="emoji-close" aria-label="Close emoji picker" onclick={() => closePanel()}>×</button></header><div>{#each emojis as value}<button type="button" data-messages-control={`emoji:${value}`} aria-label={`Insert ${value}`} disabled={!draft} onclick={() => draft && insertEmoji(value)}>{value}</button>{/each}</div><p>Unicode emoji · native artwork varies by system.</p></div>{/if}
  {#if panel}<section class="messages-rich-panel" class:messages-preferences={panel === 'preferences' || panel === 'account'} class:messages-conversation-details={panel === 'details'} data-messages-details-conversation-id={panel === 'details' ? conversation?.id : undefined} data-messages-details-section={panel === 'details' ? detailsSection : undefined} role="dialog" aria-label={panel === 'details' ? 'Conversation Details' : panel === 'attachments' ? 'Shared Attachments' : panel === 'help' ? 'Messages Help' : windows ? 'Teams Settings' : 'Messages Preferences'}>
    <header class:messages-preference-title={panel === 'preferences' || panel === 'account'}><h2>{panel === 'details' ? windows ? 'Chat details' : 'Details' : panel === 'attachments' ? 'Shared Attachments' : panel === 'help' ? windows ? 'Teams Help — local guide' : 'Messages Help' : classic ? 'Preferences' : 'Settings'}</h2><button type="button" data-messages-control={`${panel}-close`} aria-label="Close panel" onclick={closePanel}>{!windows && (panel === 'preferences' || panel === 'account') ? '' : '×'}</button></header>
    {#if panel === 'preferences' || panel === 'account'}
      <nav class="messages-preference-tabs" aria-label={windows ? 'Teams Settings categories' : 'Messages preference panes'}>
        {#each messagePreferencePanes(profile) as tab}
          <button type="button" data-messages-control={`preference-tab:${tab.id}`} aria-current={preferenceTab === tab.id ? 'page' : undefined} onclick={() => command('preferences.navigate', {}, { pane: tab.id })}>{#if !windows}<svg class="messages-preference-icon" viewBox="0 0 32 32" aria-hidden="true">{#if tab.id === 'general'}<path fill="#8d969f" stroke="#5e6670" d="m13 2 6 0 1 5 4 2 5-1 2 6-4 3-1 4 3 4-4 4-5-2-4 1-3 4-6-2 0-5-3-3-5-1 0-6 5-2 2-4z"/><circle cx="16" cy="16" r="6" fill="#e8ebed" stroke="#687480"/>{:else if tab.id === 'account'}<path fill="#48a4dc" stroke="#3186be" d="M3 4h26v19H15l-7 6v-6H3z"/><circle cx="10" cy="14" r="2" fill="white"/><circle cx="16" cy="14" r="2" fill="white"/><circle cx="22" cy="14" r="2" fill="white"/>{:else}<circle cx="11" cy="10" r="6" fill="#6b99b0"/><circle cx="23" cy="12" r="5" fill="#91b4c2"/><path d="M1 29v-4a10 10 0 0 1 20 0v4M20 21q10-4 11 8h-9" fill="#799faf"/>{/if}</svg>{/if}<span>{tab.label}</span></button>
        {/each}
      </nav>
      <div class="messages-preference-body">
      {#if preferenceTab === 'account'}
        <nav class="messages-account-tabs" aria-label="Account sections">{#each [{ id: 'settings', label: windows ? 'Account' : 'Settings' }, { id: 'blocked', label: 'Blocked' }] as tab}<button type="button" data-messages-control={`account-tab:${tab.id}`} aria-current={accountTab === tab.id ? 'page' : undefined} onclick={() => command('preferences.navigate', {}, { pane: 'account', section: tab.id })}>{tab.label}</button>{/each}</nav>
        {#if accountTab === 'settings'}
          <h3>{messageState.account.name}</h3><p>{messageState.account.address}</p><p>{messageState.account.signedIn ? 'Signed in to this fictional local account' : 'Signed out of this fictional local account'}</p>
          <button data-messages-control="account-signin" onclick={() => messageState.account.signedIn ? requestConfirmation('account.setSignedIn', {}, { signedIn: false }, 'Sign Out?', 'Sending is disabled until you sign in again. Conversations remain in this local scene.') : command('account.setSignedIn', {}, { signedIn: true })}>{messageState.account.signedIn ? 'Sign Out…' : 'Sign In Locally'}</button>
          <p class="messages-rich-notice">{windows ? 'Microsoft account authentication and online presence are not connected.' : 'This is the original fictional local account, not an Apple Account sign-in.'}</p>
          {#if !windows}
            {#if classic}<label class="messages-rich-check"><input type="checkbox" checked={messageState.account.enabled} onchange={event => command('account.set', {}, { key: 'enabled', value: event.currentTarget.checked })} data-messages-control="account-enabled" />Enable this account (fictional local counterpart)</label>{/if}
            <div class="messages-unavailable-inventory"><label><input type="checkbox" disabled />Enable Messages in iCloud</label><button disabled>Sync Now</button><p>{profile.renderer === 'high-sierra' ? 'Unavailable: iCloud Messages requires 10.13.5 or later, beyond this 10.13 launch profile.' : 'Unavailable: no iCloud account, other device or cloud message graph is connected.'}</p></div>
            <label class="messages-rich-field">You can be reached for messages at<input readonly value={messageState.account.address} aria-label="Fictional local reachable address" /></label>
            <p class="messages-rich-notice">One original local endpoint; adding or verifying remote phone numbers and email addresses is unavailable.</p>
            <label class="messages-rich-check"><input type="checkbox" data-messages-control="account-read-receipts" checked={messageState.account.readReceipts} onchange={event => command('account.set', {}, { key: 'readReceipts', value: event.currentTarget.checked })} />Send read receipts (authored local records only)</label>
            <details><summary>Original local read receipts</summary>{#each messageState.conversations as row (row.id)}{#each row.items.filter(item => item.readReceiptAt !== undefined) as item (item.id)}<p>{row.name}: {item.kind === 'text' ? item.text : item.id} — read at authored epoch {item.readReceiptAt}</p>{/each}{/each}</details>
            <label class="messages-rich-field">Start new conversations from<select disabled aria-label="Original local sender address"><option>{messageState.account.address}</option></select></label>
            {#if !classic}<button type="button" data-messages-control="account-privacy" onclick={() => openPanel('help')}>About iMessage and FaceTime &amp; Privacy — local guide</button>{/if}
          {:else}
            <label class="messages-rich-check"><input type="checkbox" data-messages-control="account-read-receipts" checked={messageState.account.readReceipts} onchange={event => command('account.set', {}, { key: 'readReceipts', value: event.currentTarget.checked })} />Read receipts (qualified personal Teams local counterpart)</label>
            <p class="messages-rich-notice">Remote discoverability by email/phone/profile, contact synchronization and Microsoft credentials are unavailable. Read receipts record authored local reads only, without online delivery.</p>
          {/if}
        {:else}
          <h3>Blocked {windows ? 'contacts' : 'addresses'}</h3>
          {#each messageState.blockedAddresses as address}<div class="messages-rich-blocked"><span>{address}</span><button data-messages-control={`unblock:${address}`} onclick={() => command('block.set', {}, { address, blocked: false })}>Unblock</button></div>{:else}<p>No blocked addresses.</p>{/each}
          <form onsubmit={async event => { event.preventDefault(); const result = await command('block.set', {}, { address: blockedInput.trim(), blocked: true }); if (result?.status === 'applied') blockedInput = ''; }}><label class="messages-rich-field">Block a local endpoint<input data-messages-control="blocked-address" maxlength="320" placeholder="Phone number or email" bind:value={blockedInput} /></label><button data-messages-control="blocked-add" disabled={!blockedInput.trim()}>Block</button></form>
          <p class="messages-rich-notice">Original shared Messages and Calls block list; existing history remains. No Apple or Microsoft block list is changed.</p>
        {/if}
      {:else if preferenceTab === 'sharing'}
        <h3>Shared with You</h3>
        <label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:sharedAutomatic" checked={messageState.preferences.sharedAutomatic} onchange={event => command('preferences.set', {}, { key: 'sharedAutomatic', value: event.currentTarget.checked })} />Automatic Sharing (fictional local app counterpart)</label>
        <p class="messages-rich-notice">Only genuine content received from original Contacts appears here. App switches govern this shared projection; opening content uses the original Browser, Photos or Files actor. No Apple cloud synchronization is operated.</p>
        {#each [{ id: 'photos', label: 'Photos' }, { id: 'safari', label: 'Safari' }, { id: 'finder', label: 'Finder' }] as app}<label class="messages-rich-check"><input type="checkbox" data-messages-control={`preference:sharedApp:${app.id}`} checked={messageState.preferences.sharedApps.includes(app.id)} onchange={event => command('preferences.set', {}, { key: 'sharedApps', value: event.currentTarget.checked ? [...messageState.preferences.sharedApps, app.id] : messageState.preferences.sharedApps.filter(value => value !== app.id) })} />{app.label}</label>{/each}
        <details class="messages-unavailable-inventory"><summary>Other native participating apps</summary><p>Apple TV, Books, Freeform, News, Notes, Podcasts, Reminders, iWork and third-party apps are documented by the selected guide. Their native shared-content/collaboration service graphs are not connected; no enabled app switch is fabricated.</p></details>
        <label class="messages-rich-field">Shared content<select data-messages-control="sharing-app" bind:value={sharedApp}><option value="photos">Photos</option><option value="safari">Safari</option><option value="finder">Finder</option></select></label>
        {#each sharedContent as entry (entry.id)}<div class="messages-shared-entry"><span>{entry.conversationName} — {entry.label}</span><button data-messages-control={`sharing-open:${entry.id}`} onclick={() => command('sharedContent.open', {}, { appId: sharedApp, contentId: entry.id })}>Open in {sharedApp === 'photos' ? 'Photos' : sharedApp === 'safari' ? 'Browser' : 'Files'}</button></div>{:else}<p>No enabled content from Contacts for this app. Changing sharing never deletes original messages or attachments.</p>{/each}
        <button data-messages-control="sharing-details" disabled={!conversation} onclick={() => openPanel('details')}>Open Conversation Details</button>
      {:else}
        <h3>{preferenceTab === 'appearance' ? 'Appearance' : preferenceTab === 'notifications' ? 'Notifications' : 'General'}</h3>
        {#if !windows && !classic}
          <section class="messages-name-sharing"><h3>Set Up Name and Photo Sharing</h3><div class="messages-local-avatar" aria-label="Original fictional account photo">{#if messageState.account.photo}<img src={messageState.account.photo.dataURI} alt={messageState.account.name} />{:else}{messageState.account.initials}{/if}</div><button data-messages-control="account-photo" onclick={() => command('account.photo.set')}>Choose Photo from Files…</button>{#if messageState.account.photo}<button data-messages-control="account-photo-remove" onclick={() => command('account.photo.set', {}, { fileId: null })}>Remove Photo</button>{/if}
            <form onsubmit={event => { event.preventDefault(); command('account.rename', {}, { name: accountName }); }}><label class="messages-rich-field">Name (local account)<input data-messages-control="account-name" maxlength="256" bind:value={accountName} /></label><button data-messages-control="account-name-save" disabled={!accountName.trim()}>Save Local Name</button></form>
            <label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:shareNamePhoto" checked={messageState.preferences.shareNamePhoto} onchange={event => command('preferences.set', {}, { key: 'shareNamePhoto', value: event.currentTarget.checked })} />Share Name and Photo (fictional local messages)</label>
            <label class="messages-rich-field">Share Automatically<select data-messages-control="preference:shareAutomatically" value={messageState.preferences.shareAutomatically} onchange={event => command('preferences.set', {}, { key: 'shareAutomatically', value: event.currentTarget.value })}><option value="contacts">Contacts Only</option><option value="ask">Always Ask</option></select></label>
            {#if conversation && messageState.preferences.shareNamePhoto && messageState.preferences.shareAutomatically === 'ask'}<label class="messages-rich-check"><input type="checkbox" data-messages-control="conversation-profile-approved" checked={conversation.shareApproved} onchange={event => command('conversation.profile.approve', { conversationId: conversation.id }, { approved: event.currentTarget.checked })} />Share with {conversation.name} — local approval</label>{/if}
            <p class="messages-rich-notice">Only future outgoing local messages carry approved name/photo snapshots. Existing message identities and earlier profile snapshots remain. Real account authentication, Memoji generation and remote sharing are not operated.</p>
            {#if profileMessages.length}<details><summary>Original outgoing shared profiles</summary>{#each profileMessages as item (item.id)}<div class="messages-shared-entry">{#if item.profile.photo}<img width="32" height="32" src={item.profile.photo.dataURI} alt="" />{/if}<span>{item.profile.name} — {item.kind === 'text' ? item.text : item.id}</span></div>{/each}</details>{/if}
          </section>
        {/if}
        {#if !windows}
          <label class="messages-rich-field messages-preference-row">Keep messages<select data-messages-control="preference:keepMessages" value={messageState.preferences.keepMessages} onchange={changeRetention}><option value="forever">Forever</option><option value="1year">One Year</option><option value="30days">30 Days</option></select></label>
          <p class="messages-rich-notice">Retention uses the authored scene epoch, not your computer’s clock. Finite periods permanently expire original messages and their attachments after confirmation; unsent drafts and conversation identities remain.</p>
          {#if classic}
            <label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:saveClosedHistory" checked={messageState.preferences.saveClosedHistory} onchange={event => command('preferences.set', {}, { key: 'saveClosedHistory', value: event.currentTarget.checked })} />Save history when conversations are closed</label>
            <button data-messages-control="conversation-close" disabled={!conversation} onclick={() => messageState.preferences.saveClosedHistory ? command('conversation.close', { conversationId: conversation.id }) : requestConfirmation('conversation.close', { conversationId: conversation.id }, {}, 'Close and Delete Conversation?', 'Save history when conversations are closed is off. This explicitly closes and removes the conversation, its messages and its owned draft. Window close and quitting never perform this action.')}>Close Selected Conversation{messageState.preferences.saveClosedHistory ? '' : '…'}</button>
          {/if}
          {#if profile.renderer !== 'golden-gate'}<label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:notifyUnknownContacts" checked={messageState.preferences.notifyUnknownContacts} onchange={event => command('preferences.set', {}, { key: 'notifyUnknownContacts', value: event.currentTarget.checked })} />Notify me about messages from unknown contacts</label>
          {:else}
            <label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:screenUnknownSenders" checked={messageState.preferences.screenUnknownSenders} onchange={event => command('preferences.set', {}, { key: 'screenUnknownSenders', value: event.currentTarget.checked })} />Screen unknown senders (local folder counterpart)</label>
            <label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:filterSpam" checked={messageState.preferences.filterSpam} onchange={event => command('preferences.set', {}, { key: 'filterSpam', value: event.currentTarget.checked })} />Filter spam (deterministic local counterpart)</label>
            <p class="messages-rich-notice">Local unknown-sender heuristic recognizes “claim your prize”, “send gift cards” and “wire money now”; no carrier, SMS/RCS or Apple spam classifier is claimed.</p>
            <section class="messages-screened-folder"><h3>Unknown Senders / Spam — local review folder</h3>{#each screenedThreads as row (row.id)}<strong>{row.name}</strong>{#each row.items.filter(item => item.screened || item.spam) as item (item.id)}<p>{item.spam ? 'Spam: ' : ''}{item.kind === 'text' ? item.text : 'Retained media message'}</p>{/each}<button data-messages-control={`sender-known:${row.id}`} onclick={() => command('sender.markKnown', { conversationId: row.id })}>Mark as Known</button>{:else}<p>No screened local messages.</p>{/each}</section>
            <label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:allowBackgrounds" checked={messageState.preferences.allowBackgrounds} onchange={event => command('preferences.set', {}, { key: 'allowBackgrounds', value: event.currentTarget.checked })} />Conversation backgrounds</label>
            <button data-messages-control="conversation-background" disabled={!conversation} onclick={() => conversation && command('conversation.background.set', { conversationId: conversation.id })}>Choose Background from Files…</button>{#if conversation?.background}<button data-messages-control="conversation-background-remove" onclick={() => command('conversation.background.set', { conversationId: conversation.id }, { fileId: null })}>Remove Background</button><img class="messages-background-preview" src={conversation.background.dataURI} alt={conversation.background.name} />{/if}
          {/if}
          <label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:notifyMentions" checked={messageState.preferences.notifyMentions} onchange={event => command('preferences.set', {}, { key: 'notifyMentions', value: event.currentTarget.checked })} />Notify me when my name is mentioned</label>
          {#if !classic}<label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:autoPlayEffects" checked={messageState.preferences.autoPlayEffects} onchange={event => command('preferences.set', {}, { key: 'autoPlayEffects', value: event.currentTarget.checked })} />Auto-play message effects</label><button data-messages-control="effect-replay" disabled={!latestEffect} onclick={() => { if (latestEffect && owns()) effectOpen = latestEffect.id; }}>Replay Local Received Effect</button><p class="messages-rich-notice">The authored celebration record plays real local SVG animation. This is not factory Apple full-screen artwork or remote effect delivery.</p>{/if}
        {/if}
        {#if !windows || preferenceTab === 'general' || preferenceTab === 'notifications'}<label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:playSounds" checked={messageState.preferences.playSounds} onchange={event => command('preferences.set', {}, { key: 'playSounds', value: event.currentTarget.checked })} />{windows ? 'Play sounds for notifications (local)' : 'Play sound effects'}</label>{/if}
        {#if !windows || preferenceTab === 'notifications'}
          <label class="messages-rich-field messages-preference-row">{windows ? 'Notification sound (licensed local equivalent)' : 'Message received sound'}<select data-messages-control="preference:receivedSound" value={messageState.preferences.receivedSound} onchange={event => command('preferences.set', {}, { key: 'receivedSound', value: event.currentTarget.value })}><option value="none">None</option><option value="glass-study">Glass Study — JesterOS Original</option><option value="golden-arpeggio">Golden Arpeggio — JesterOS Original</option></select></label>
          <button data-messages-control="preference:sound-preview" onclick={() => command('preferences.sound.preview')}>Play Selected Sound</button>
          <p class="messages-rich-notice">Real local WAV playback; these licensed authored sounds are not Apple or Microsoft factory alert recordings.</p>
        {/if}
        {#if classic}
          <label class="messages-rich-field messages-preference-row">Save received files to<select data-messages-control="preference:receivedFilesFolderId" value={messageState.preferences.receivedFilesFolderId} disabled={!preferenceFolders.length} onchange={event => command('preferences.set', {}, { key: 'receivedFilesFolderId', value: event.currentTarget.value })}>{#each preferenceFolders as folder (folder.id)}<option value={folder.id}>{folder.name}</option>{/each}</select></label>
          <p class="messages-rich-notice">Original virtual Files folders. Received local attachment fixtures save genuine bytes here; host folders are not accessed.</p>
          {#if profile.renderer === 'high-sierra'}
            <label class="messages-rich-field">Default IM application<select disabled aria-label="Default instant messaging application unavailable"><option>Unavailable — host app registration</option></select></label>
            <p class="messages-rich-notice">This all-account High Sierra preference changes the native host app registration. The scene cannot inspect or change your computer’s default messaging application.</p>
            <details class="messages-unavailable-inventory"><summary>Conditional Jabber preferences — no Jabber account configured</summary><p>Show all accounts in one list, Animate buddy pictures, Show status in menu bar, Offline on quit, Away auto-reply, Away after 15 minutes, When I return, and When switching users require an actual Jabber account/buddy/status graph. Hidden native conditional rows are not fake enabled switches. These are not backported to Mojave.</p></details>
          {/if}
        {/if}
        {#if !windows || preferenceTab === 'general'}
          <label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:showPreviews" checked={messageState.preferences.showPreviews} onchange={event => command('preferences.set', {}, { key: 'showPreviews', value: event.currentTarget.checked })} />Show message previews (local privacy extension)</label>
          <label class="messages-rich-check"><input type="checkbox" data-messages-control="preference:saveHistory" checked={messageState.preferences.saveHistory} onchange={event => command('preferences.set', {}, { key: 'saveHistory', value: event.currentTarget.checked })} />Retain history in saved local scenes</label>
          <p class="messages-rich-notice">Saved-scene privacy extension only. {classic ? 'Native “Save history when conversations are closed” concerned individual conversations; closing a window or quitting did not close them.' : 'Not the native Keep messages retention policy or cloud storage.'}</p>
        {/if}
        {#if !windows || preferenceTab === 'appearance'}<label class="messages-rich-field">{windows ? 'Font size (local text equivalent)' : 'Text size'}<input type="range" min="10" max="24" step="1" data-messages-control="preference:textSize" value={messageState.preferences.textSize} oninput={event => command('preferences.set', {}, { key: 'textSize', value: Number(event.currentTarget.value) })} /><output>{messageState.preferences.textSize} pt</output></label>{/if}
        <p class="messages-rich-notice">Changes affect the original shared account and all local messaging windows. No transport, microphone, device, or cloud service is connected.</p>
      {/if}
      </div>
    {:else if panel === 'help'}
      <h3>Using Messages Locally</h3><p>Use New Message to choose real Contacts endpoints or enter a local recipient. Return sends; Shift-Return inserts a new line. Search finds original conversations and messages.</p>
      <h3>Files and Audio</h3><p>Attach File opens the virtual Files chooser. Drag virtual Files records into the window; host files are not imported. Open uses retained bytes; Save to Downloads creates a real local Files record without overwriting the source. PDF preview renders actual pages; text preview decodes actual UTF-8 content.</p>
      <p>Copy Text preserves literal message text; Copy Source Files puts exact unchanged live File IDs in the shared scene clipboard. Retained-only media has no binary clipboard equivalent here. Filenames and historical illustration labels are never substituted for attachment bytes; Save to Downloads/Open retains the genuine media.</p>
      <p>Audio uses the genuine authored Glass Study WAV with real playback. Native historical Messages supported recording, but this local interface does not request your microphone.</p>
      <h3>Groups and Reactions</h3><p>Details shows participants, Add Member, rename, Hide Alerts, attachments and local coordinates. Remove, leave and delete require confirmation. Historical iMessage leave/removal depended on group size and transport; small local-group equivalents are explicitly qualified.</p>
      <p>{modernReactions ? 'This modern local surface supports one arbitrary emoji reaction per endpoint. Teams quick choices are distinct from Mac Tapbacks; package correspondence remains qualified.' : 'This release supports exactly six native Mac Tapbacks. Modern arbitrary-emoji reactions are not backported.'}</p>
      <h3>Account and Privacy</h3><p>Sign In/Out changes the shared fictional communications account; it never authenticates to Apple or Microsoft. Blocking uses literal normalized participant endpoints. Local incoming fixtures exercise shared notifications, Hide Alerts, sound preferences and opening the original thread.</p>
      <p>Coordinates are manually entered local equivalents, not GPS or remote Maps/Teams sharing. Preferences affect all Messages windows. Mac actions belong to the native global menu bar; Teams uses its own Settings and more menu.</p>
      {#if !windows}<h3>Buddies</h3><p>iMessage does not support buddy lists. Historical Jabber buddy lists require a Jabber account, which is not configured in this local scene. Contacts recipient lookup is the working local equivalent, not a connected buddy roster.</p>{/if}
      {#if profile.renderer === 'golden-gate'}<p>Golden Gate 27.0.1 is reconstructed using qualified book-26 and living Apple guides. No independently verified 27.0.1 binary or pixel-identical geometry is claimed.</p>{/if}
      {#if windows}<p>This is a local counterpart to Windows 11 23H2 Teams Free, not 24H2 unified Teams. Store package correspondence remains uncertain. Windows does not include macOS Quick Look; Preview is an explicitly local attachment-preview equivalent.</p>{/if}
      <h3>Local scene tools — not native service menus</h3>
      <button data-messages-control="draft-attach" disabled={!draft} onclick={attach}>Attach Virtual File…</button>
      <button data-messages-control="draft-audio" disabled={!draft} onclick={audio}>Add Authored Audio Clip</button>
      {#each MESSAGE_INCOMING_FIXTURES as fixture}{#if !fixture.renderers || fixture.renderers.includes(profile.renderer)}<button data-messages-control={`incoming:${fixture.id}`} disabled={!conversation || messageState.incomingFixtures.includes(fixture.id)} onclick={() => receive(fixture.id)}>Receive Local Fixture: {fixture.label}</button>{/if}{/each}
    {:else if panel === 'attachments' && conversation}
      <p>{conversation.name} · Retained shared attachments</p>
      {#each sharedAttachments as entry (entry.attachment.id)}<MessagesAttachment attachment={entry.attachment} state={messageState} {windowId} {execute} {profile} {available} conversationId={conversation.id} messageId={entry.messageId} />{:else}<p>No shared Files attachments. Historical sample artwork is not an imported Files record.</p>{/each}
      <p class="messages-rich-notice">Files remain local. Open, Save and {windows ? 'Preview (local equivalent)' : 'Quick Look'} operate on the actual retained bytes, not a simulated network transfer.</p>
    {:else if conversation}
      {#if !classic || !group}<div class="messages-details-identity">
        <span class="messages-details-avatar" style:background={conversation.tint} aria-hidden="true">{conversation.initials}</span>
        <h3>{conversation.name}</h3>
        <p>{group ? `${conversation.participants.length + 1} participants including you` : 'Direct conversation'}{conversation.left ? ' · You left this conversation' : ''}</p>
      </div>{/if}
      {#if group}
        {#if !classic}<button class="messages-details-name-link" type="button" data-messages-control="conversation-name-edit" aria-expanded={nameEditor} disabled={conversation.left} onclick={() => command('details.navigate', { conversationId: conversation.id }, { section: nameEditor ? 'summary' : 'name' })}>{windows ? 'Name group chat' : profile.renderer === 'golden-gate' ? 'Edit' : 'Change Group Name and Photo'}</button>{/if}
        {#if classic || nameEditor}<form class="messages-details-name" onsubmit={event => { event.preventDefault(); submitDetails('conversation.rename', { name: rename }); }}><label class="messages-rich-field">{classic ? 'NAME' : 'Group Name'}<input data-messages-control="conversation-name" placeholder={classic ? 'Add a group name' : 'Group name'} maxlength="256" bind:value={rename} /></label>{#if !classic}<button type="button" data-messages-control="conversation-name-cancel" onclick={() => command('details.navigate', { conversationId: conversation.id }, { section: 'summary', discard: true })}>Cancel</button>{/if}<button data-messages-control="conversation-rename" disabled={conversation.left || !rename.trim()}>{windows ? 'Save' : 'Done'}</button></form>{#if !classic}<p class="messages-rich-notice">Title editing only; the original group avatar is retained. No remote photo library or Memoji editor is simulated.</p>{/if}{/if}
        {#if classic}<h3 class="messages-details-members">{conversation.participants.length + 1} MEMBERS</h3>{/if}
      {/if}
      <ul class="messages-rich-participants messages-details-participants" aria-label="Conversation participants">
        {#each participantRoster as participant}
          <li data-messages-participant={participant.address}><span class="messages-details-person" aria-hidden="true">●</span><span class="messages-details-address" title={participant.address} aria-label={participant.name === participant.address ? participant.address : `${participant.name}, ${participant.address}`}>{participant.name}</span></li>
        {/each}
      </ul>
      <label class="messages-rich-check messages-details-alerts"><input type="checkbox" data-messages-control="conversation-dnd" checked={conversation.dnd} onchange={event => command('conversation.setDnd', { conversationId: conversation.id }, { enabled: event.currentTarget.checked })} />{windows ? 'Mute' : classic ? 'Do Not Disturb' : 'Hide Alerts'}</label>
      <p class="messages-rich-notice messages-details-alert-policy">Messages still arrive in this local conversation; {conversation.dnd ? 'its notification alerts are muted.' : 'its notification alerts are enabled.'}</p>
      <section class="messages-details-sharing" aria-label="Simulated location sharing">
        <h3>Simulated Location</h3>
        {#if conversation.location}<p data-messages-location><strong>{conversation.location.label}</strong><br />{conversation.location.latitude}, {conversation.location.longitude}</p><button data-messages-control="location-remove" disabled={conversation.left || !messageState.account.signedIn} onclick={() => command('location.set', { conversationId: conversation.id }, { location: null })}>Stop Sharing Simulated Location</button>{:else}<p>No simulated location shared.</p>{/if}
        <button type="button" data-messages-control="location-edit" aria-expanded={locationEditor} disabled={conversation.left || !messageState.account.signedIn} onclick={() => command('details.navigate', { conversationId: conversation.id }, { section: locationEditor ? 'summary' : 'location' })}>{conversation.location ? 'Change Simulated Location…' : 'Share Simulated Location…'}</button>
        {#if locationEditor}<form onsubmit={event => { event.preventDefault(); submitDetails('location.set', { location: { label, latitude: Number(latitude), longitude: Number(longitude) } }); }}><label class="messages-rich-field">Place label<input data-messages-control="location-label" maxlength="256" required bind:value={label} /></label><div class="messages-rich-coordinates"><label>Latitude<input data-messages-control="location-latitude" type="number" min="-90" max="90" step="any" required bind:value={latitude} /></label><label>Longitude<input data-messages-control="location-longitude" type="number" min="-180" max="180" step="any" required bind:value={longitude} /></label></div><div class="messages-details-location-actions"><button type="button" data-messages-control="location-cancel" onclick={() => command('details.navigate', { conversationId: conversation.id }, { section: 'summary', discard: true })}>Cancel</button><button data-messages-control="location-share" disabled={conversation.left || !messageState.account.signedIn}>Share Entered Location</button></div></form>{/if}
        <p class="messages-rich-notice">{windows ? 'Entered coordinates are a local extension, not a verified 2023 desktop Teams location feature.' : classic ? 'This release displays locations shared from an iOS device; entered coordinates are a local extension, not native Mac location sending.' : 'Native location sharing requires iCloud and Location Services. This local coordinate editor does not contact either service.'} No GPS, device location, map tiles, tracking or remote sharing.</p>
      </section>
      <section class="messages-details-shared" aria-label="Shared attachments">
        {#if classic}<div class="messages-details-media-tabs" role="tablist" aria-label="Shared media"><button type="button" role="tab" aria-selected={attachmentTab === 'photos'} data-messages-control="shared-photos" onclick={() => command('details.navigate', { conversationId: conversation.id }, { section: 'photos' })}>Photos</button><button type="button" role="tab" aria-selected={attachmentTab === 'files'} data-messages-control="shared-files" onclick={() => command('details.navigate', { conversationId: conversation.id }, { section: 'files' })}>Files</button></div>{/if}
        {#if !classic || attachmentTab === 'photos'}<h3 tabindex="-1" data-messages-control="details-media:photos" class:messages-details-tab-heading={classic}>Photos <span>{photos.length}</span></h3>
          <div class="messages-details-photos">{#each photos as entry (entry.attachment.id)}<div data-messages-shared-message-id={entry.messageId} data-messages-source-file-id={entry.attachment.originalFileId} data-messages-source-revision={entry.attachment.originalRevision}><MessagesAttachment attachment={entry.attachment} state={messageState} {windowId} {execute} {profile} {available} conversationId={conversation.id} messageId={entry.messageId} sharedDetails={true} /></div>{:else}<p>No shared photos.</p>{/each}</div>
        {/if}
        {#if !classic || attachmentTab === 'files'}<h3 tabindex="-1" data-messages-control="details-media:files" class:messages-details-tab-heading={classic}>{windows || classic ? 'Files' : 'Documents'} <span>{files.length}</span></h3>
          {#each files as entry (entry.attachment.id)}<div data-messages-shared-message-id={entry.messageId} data-messages-source-file-id={entry.attachment.originalFileId} data-messages-source-revision={entry.attachment.originalRevision}><MessagesAttachment attachment={entry.attachment} state={messageState} {windowId} {execute} {profile} {available} conversationId={conversation.id} messageId={entry.messageId} /></div>{:else}<p>No shared files.</p>{/each}
        {/if}
        <p class="messages-rich-notice">Only retained original attachment bytes appear here. Historical illustration artwork is not an imported Files record. Open routes to its original Files revision or preserves the retained bytes in a new local file.</p>
      </section>
      <details class="messages-details-management"><summary>Local participant actions</summary>
        <ul class="messages-rich-participants">{#each conversation.participants as address}<li><span>{address}</span><span class="messages-rich-participant-actions"><button data-messages-control={`block:${address}`} onclick={() => command('block.set', {}, { address, blocked: !messageState.blockedAddresses.includes(recipientIdentity(address)) })}>{messageState.blockedAddresses.includes(recipientIdentity(address)) ? 'Unblock' : 'Block'}</button>{#if group}<button class="messages-rich-destructive" data-messages-control={`remove-participant:${address}`} onclick={() => requestConfirmation('conversation.removeParticipant', { conversationId: conversation.id }, { address }, 'Remove Participant?', 'Only this local group and its draft recipients change; other threads remain untouched.')}>{!windows && others < 3 ? 'Remove (local)' : 'Remove'}</button>{/if}</span></li>{/each}</ul>
        {#if group}<form class="messages-add-participant" onsubmit={event => { event.preventDefault(); const value = addParticipant.trim(); if (value) { command('conversation.addParticipant', { conversationId: conversation.id }, { address: value }); addParticipant = ''; } }}><label class="messages-rich-field">Add participant<input data-messages-control="add-participant" maxlength="320" placeholder="Name, phone number, or email" bind:value={addParticipant} /></label><button data-messages-control="participant-add" disabled={conversation.left || !messageState.account.signedIn || !addParticipant.trim()}>Add to Group</button></form>{/if}
        <p class="messages-rich-notice">These are local participant/account actions. Native iMessage group naming and membership depend on iMessage transport; no server membership is inferred.</p>
      </details>
      <footer>{#if group}<button class="messages-rich-destructive" data-messages-control="conversation-leave" disabled={conversation.left} onclick={() => requestConfirmation('conversation.leave', { conversationId: conversation.id }, {}, 'Leave This Conversation?', 'You will no longer send or receive local messages in this group.')}>{canLeaveGroup ? 'Leave This Conversation…' : 'Leave (qualified local equivalent)'}</button>{/if}<button class="messages-rich-destructive" data-messages-control="conversation-delete" onclick={() => requestConfirmation('conversation.delete', { conversationId: conversation.id }, {}, 'Delete Conversation?', 'The conversation and its messages will be removed from this local scene.')}>Delete Conversation…</button></footer>
    {/if}
    <p class="messages-rich-notice">{windows ? 'Personal Teams (free), qualified against the 2023 Windows 11 23H2-era package rollout. OS build alone does not determine the installed package; not the 24H2 unified Teams client.' : classic ? 'Historical Messages supported audio, attachments, groups and Tapbacks. This interface uses authored audio rather than microphone recording; newer stickers, polls and Send Later are not backported.' : profile.renderer === 'golden-gate' ? 'Golden Gate 27 uses current Apple Messages references (guide book 26/macOS 27); exact 27.0.1 release geometry remains unverified.' : 'Sonoma appearance and six native Tapbacks retained; newer Messages features are not backported.'}</p>
  </section>{/if}
  {#if selectedMessage}<section class="messages-message-actions" data-messages-actions-message-id={messageContext} role="dialog" aria-label="Message actions"><header><strong>Message Actions</strong><button data-messages-control="message-actions-close" aria-label="Close message actions" onclick={() => command('message.actions', { conversationId: conversation.id, messageId: messageContext }, { open: false })}>×</button></header><div class="messages-tapbacks">{#each windows ? TEAMS_REACTION_QUICK_SET : MESSAGE_TAPBACKS as emoji}<button data-messages-control={`reaction:${emoji}`} aria-label={`React ${emoji}`} onclick={() => command('message.react', { conversationId: conversation.id, messageId: selectedMessage.id }, { emoji })}>{emoji}</button>{/each}</div>{#if modernReactions}<div class="messages-tapback-grid">{#each emojis as value}<button data-messages-control={`reaction-more:${value}`} aria-label={`React ${value}`} onclick={() => command('message.react', { conversationId: conversation.id, messageId: selectedMessage.id }, { emoji: value })}>{value}</button>{/each}</div><form class="messages-reaction-form" onsubmit={event => { event.preventDefault(); command('message.react', { conversationId: conversation.id, messageId: selectedMessage.id }, { emoji: reaction.trim() }); }}><label>Any single emoji<input data-messages-control="reaction-input" maxlength="64" placeholder="Paste one emoji…" bind:value={reaction} /></label><button data-messages-control="reaction-send" disabled={!reaction.trim()}>React</button></form><p class="messages-rich-notice">{windows ? 'Expanded emoji choices are a qualified current-Teams local equivalent; 2022 work/school rollout evidence does not prove this exact 23H2 personal package.' : 'Modern emoji reactions use qualified macOS 26 reference material.'}</p>{/if}<button data-messages-control="message-copy" disabled={!(selectedMessage.kind === 'text' && selectedMessage.text || selectedMessage.attachments?.length)} onclick={() => command('message.copy', { conversationId: conversation.id, messageId: selectedMessage.id })}>{selectedMessage.kind === 'text' && selectedMessage.text ? 'Copy Text' : selectedMessage.attachments?.length ? 'Copy Source Files' : 'Copy unavailable'}</button><button class="messages-rich-destructive" data-messages-control="message-delete" onclick={() => requestConfirmation('message.delete', { conversationId: conversation.id, messageId: selectedMessage.id }, {}, 'Delete Message?', 'This message will be removed from the local conversation.')}>Delete Message…</button></section>{/if}
  {#if quickLook && quickLookGuard()}<section class="messages-quick-look" role="dialog" aria-label={`Preview ${quickLook.name}`}><header><h2>{quickLook.name}</h2><button data-messages-control="quick-look-close" aria-label="Close preview" onclick={() => command('attachment.quickLook', quickLookSource, { open: false })}>×</button></header>{#if quickLook.kind === 'image'}<img src={quickLook.dataURI} alt={quickLook.name} />{:else if quickLook.kind === 'audio'}{#key quickLook}<MessagesAudioPreview attachment={quickLook} {windowId} {available} owns={quickLookGuard} ownerTarget={quickLookSource} />{/key}{:else if quickLookMime === 'application/pdf'}{#key quickLook}<MessagesPdfQuickLook attachment={quickLook} {windowId} {available} owns={quickLookGuard} ownerTarget={quickLookSource} onNavigate={page => command('attachment.preview', quickLookSource, { page })} />{/key}{:else if quickLookMime?.startsWith('text/')}<pre class="messages-text-preview">{attachmentContent(quickLook) ?? 'The actual attachment is not valid UTF-8 text.'}</pre>{:else}<p>Inline preview is unsupported for {quickLook.mime}. Open the actual retained bytes in their registered application.</p>{/if}<button data-messages-control="quick-look-open" onclick={() => command('attachment.open', quickLookSource)}>{quickLook.kind === 'image' ? windows ? 'Open in Photos' : 'Open in Preview' : quickLookMime === 'application/pdf' ? windows ? 'Open in Edge' : 'Open in Preview' : quickLookMime?.startsWith('text/') ? windows ? 'Open in Notepad' : 'Open in TextEdit' : 'Open Attachment'}</button>{#if windows}<p class="messages-rich-notice">Local attachment preview equivalent; Windows 11 does not include macOS Quick Look.</p>{/if}</section>{/if}
  {#if confirmation}<section class="messages-rich-confirmation" role="alertdialog" aria-modal="true" aria-label={confirmation.title}><h2>{confirmation.title}</h2><p>{confirmation.description}</p><div><button data-messages-control="confirmation-cancel" onclick={cancelConfirmation}>Cancel</button><button class="messages-rich-destructive" data-messages-control="confirmation-confirm" onclick={confirm}>Confirm</button></div></section>{/if}
  {#if error}<p class="messages-rich-status" role="status">{error}<button aria-label="Dismiss error" onclick={() => error = ''}>×</button></p>{/if}
</div>

<style>
  .messages-preference-title { position: relative; }
  .messages-rich-panel.messages-preferences { display: flex; flex-direction: column; overflow: hidden; padding-bottom: 0; }
  .messages-preferences > header, .messages-preferences > .messages-preference-tabs { flex: 0 0 auto; }
  .messages-preference-body { flex: 1 1 auto; min-height: 0; overflow: auto; margin: 0 -22px; padding: 0 22px 20px; }
  .messages-rich-controls:not(.windows) .messages-preference-title button { position: absolute; left: 13px; width: 12px; height: 12px; padding: 0; background: #ff6058; border: 1px solid #dd4841; }
  .messages-preference-tabs button { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 80px; }
  .messages-preference-icon { width: 30px; height: 30px; }
  .windows .messages-preference-tabs button { min-width: 0; }
  .messages-rich-controls:not(.windows) .messages-preference-tabs { background: #e8e8e8; margin: 0 -22px; padding: 7px 20px 8px; }
  .messages-preference-row { grid-template-columns: minmax(135px, 1fr) minmax(150px, 1fr); align-items: center; gap: 14px; }
  .messages-rich-controls select { border: 1px solid #8886; border-radius: 5px; padding: 3px 6px; color: inherit; background: var(--appearance-input, white); font: inherit; min-width: 0; max-width: 100%; }
  .messages-unavailable-inventory { margin: 12px 0; border: 1px solid #8883; border-radius: 6px; padding: 10px; font-size: 11px; color: var(--appearance-muted, #65656b); }
  .messages-unavailable-inventory label { display: block; margin: 7px 0; }
  .messages-unavailable-inventory input { margin-right: 8px; }
  .messages-local-avatar { display: inline-grid; place-items: center; vertical-align: middle; margin: 0 12px 8px 0; width: 58px; height: 58px; border-radius: 50%; background: #8293a4; color: white; font-size: 20px; overflow: hidden; }
  .messages-local-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .messages-screened-folder { border: 1px solid #8883; padding: 10px; border-radius: 6px; margin: 12px 0; overflow-wrap: anywhere; }
  .messages-shared-entry { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #8883; overflow-wrap: anywhere; }
  .messages-shared-entry span { flex: 1; min-width: 0; }
  .messages-background-preview { display: block; margin-top: 10px; max-width: 100%; max-height: 140px; border-radius: 6px; }
  :global(.messages-local-background .golden-gate-messages-history) { background-image: var(--messages-conversation-background); background-size: cover; background-position: center; }
  .messages-local-celebration { position: absolute; inset: 60px 0 60px 28%; z-index: 5; pointer-events: none; animation: local-celebration 2.5s ease-out both; }
  .messages-local-celebration svg { width: 100%; height: 100%; }
  @keyframes local-celebration { 0% { opacity: 0; transform: translateY(-25px); } 20%, 75% { opacity: 1; } 100% { opacity: 0; transform: translateY(25px); } }
  @media (prefers-reduced-motion: reduce) { .messages-local-celebration { animation-duration: 0.01s; } }
</style>
