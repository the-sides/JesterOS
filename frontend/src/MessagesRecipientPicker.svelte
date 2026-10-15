<script>
  import { tick } from 'svelte';
  import { messageDraft } from './messages-composition.js';
  import { messageRecipient, messageRecipientLabel, messageRecipientTokens, recipientIdentity } from './messages-recipients.js';
  let { state: messagesData, windowId, execute, available = true, resolveRecipients, windows = false } = $props();
  const draft = $derived(messageDraft(messagesData));
  let input;
  let suggestions = $state([]), selected = $state(0), error = $state('');
  let request = 0;
  function owns(original, node) {
    return available && draft === original && original.conversationId === null && input === node && node?.isConnected;
  }
  async function update(value, show = true) {
    const original = draft, node = input, intent = ++request;
    if (!owns(original, node)) return;
    const result = await execute('messages.draft.set', { windowId, draftId: original.id, field: 'to' }, { value });
    if (request !== intent || !owns(original, node)) return;
    if (result.status !== 'applied') { suggestions = []; error = result.error?.message ?? 'Recipients could not be changed.'; return; }
    error = '';
    const tokens = messageRecipientTokens(value), query = tokens.at(-1).trim();
    const existing = new Set(tokens.slice(0, -1).map(recipientIdentity));
    suggestions = show && query && typeof resolveRecipients === 'function'
      ? resolveRecipients(query).filter(row => !existing.has(recipientIdentity(row.address))).slice(0, 64) : [];
    selected = 0;
  }
  async function choose(row) {
    const original = draft, node = input;
    if (!owns(original, node) || !resolveRecipients?.(row.address).some(choice => choice.contactId === row.contactId && choice.address === row.address)) {
      suggestions = []; error = 'The original contact address is no longer available.'; return;
    }
    const tokens = messageRecipientTokens(original.fields.to).slice(0, -1).map(text => text.trim()).filter(Boolean);
    const identity = recipientIdentity(row.address);
    const label = messageRecipientLabel(row);
    if (!tokens.some(token => recipientIdentity(token) === identity)) tokens.push(label);
    const value = tokens.join(', ') + ', ';
    if (!messageRecipient(label) || value.length > 4096) { error = 'The bounded recipient list is full.'; return; }
    node.value = value;
    await update(value, false);
    if (owns(original, node)) node.focus({ preventScroll: true });
  }
  async function keydown(event) {
    if (event.key === 'Escape') { suggestions = []; event.stopPropagation(); return; }
    if (!suggestions.length) return;
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      const original = draft, node = input, version = request;
      await tick();
      if (version === request && owns(original, node)) {
        node.parentElement.querySelector('[role="option"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault(); void choose(suggestions[selected]);
    }
  }
  $effect(() => { if (!available || !draft || draft.conversationId !== null) suggestions = []; });
</script>

<span class="messages-recipient-picker" data-window-no-drag>
  <input bind:this={input} class="messages-draft-recipient" data-control={windows ? 'teams-recipient' : undefined}
    data-messages-control="draft-to" data-messages-draft-id={draft?.id} aria-label="Recipients"
    role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls={`recipients-${windowId}`}
    aria-activedescendant={suggestions.length ? `recipient-${windowId}-${selected}` : undefined}
    placeholder={windows ? 'Name, phone number, or email' : 'Name, phone number, or email'} maxlength="4096"
    disabled={!available} value={draft?.fields.to ?? ''} oninput={event => update(event.currentTarget.value)} onkeydown={keydown}
    onblur={() => { request++; suggestions = []; }} />
  {#if suggestions.length}
    <span class="messages-recipient-results" id={`recipients-${windowId}`} role="listbox" aria-label="Matching contact addresses">
      {#each suggestions as row, index (`${row.contactId}:${row.address}`)}
        <button type="button" role="option" id={`recipient-${windowId}-${index}`} aria-selected={selected === index}
          data-messages-recipient-id={row.contactId} data-messages-recipient-address={row.address}
          onpointerdown={event => event.preventDefault()} onclick={() => choose(row)}>
          <strong>{row.name}</strong><span>{row.label} · {row.address}</span>
        </button>
      {/each}
    </span>
  {/if}
  {#if error}<span class="messages-recipient-error" role="status">{error}</span>{/if}
</span>

<style>
  .messages-recipient-picker { position: relative; display: inline-flex; flex: 1; min-width: 170px; }
  .messages-recipient-picker input { flex: 1; min-width: 0; font: inherit; }
  .messages-recipient-results { position: absolute; top: calc(100% + 5px); left: 0; z-index: 20; min-width: 270px; max-height: 240px; overflow-y: auto; padding: 4px; border: 1px solid #aaa8; border-radius: 5px; background: #fff; box-shadow: 0 5px 18px #0003; color: #222; }
  .messages-recipient-results button { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 7px 10px; border: 0; border-radius: 3px; background: transparent; text-align: left; font: inherit; color: inherit; }
  .messages-recipient-results button[aria-selected="true"] { background: #2676dc; color: white; }
  .messages-recipient-results button span { font-size: 11px; opacity: .8; }
  .messages-recipient-error { position: absolute; top: 100%; font-size: 11px; color: #ad2020; background: #fff; padding: 3px; z-index: 20; }
</style>
