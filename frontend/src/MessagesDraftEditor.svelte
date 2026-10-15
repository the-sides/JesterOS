<script>
  import { messageDraft } from './messages-composition.js';
  let { state: messageState, windowId, execute, available = true, placeholder = 'iMessage', mac = true } = $props();
  let field;
  let error = $state.raw(null);
  let intent = 0;
  const draft = $derived(messageDraft(messageState));
  const owns = (node, original) => available && node?.isConnected && node === field && !node.closest('[inert], [hidden]')
    && messageDraft(messageState) === original && node.dataset.messagesDraftId === original?.id;
  async function update(value, original = draft) {
    const node = field, version = ++intent;
    if (!original || !owns(node, original)) return null;
    const result = await execute('messages.draft.set', { windowId, draftId: original.id, field: 'body' }, { value });
    if (version === intent && owns(node, original)) error = result.status === 'rejected'
      ? { draft: original, revision: original.revision, message: result.error.message } : null;
    return result;
  }
  export async function send() {
    const original = draft, node = field;
    if (!original || !owns(node, original)) return null;
    const value = node.value;
    const updated = await update(value, original);
    if (updated?.status !== 'applied' || !owns(node, original) || node.value !== value || original.fields.body !== value) return null;
    const version = ++intent;
    const result = await execute('messages.draft.send', { windowId, draftId: original.id }, {});
    if (version === intent && owns(node, original)) error = result.status === 'rejected'
      ? { draft: original, revision: original.revision, message: result.error.message } : null;
    return result;
  }
  function keyboard(event) {
    if (mac && event.key === 'Enter' && event.altKey && !event.isComposing && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const node = event.currentTarget, original = draft;
      if (!original || !owns(node, original)) return;
      node.setRangeText('\n', node.selectionStart, node.selectionEnd, 'end');
      void update(node.value, original);
      return;
    }
    if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    void send();
  }
</script>

<textarea bind:this={field} data-messages-control="draft-body" data-messages-draft-id={draft?.id} aria-label="Message" aria-description="Fictional local message. Return sends; modifier-Return inserts a line break." {placeholder} rows="1" maxlength="1048576" value={draft?.fields.body ?? ''} disabled={!available || !draft} oninput={event => update(event.currentTarget.value)} onkeydown={keyboard}></textarea>
{#if error && error.draft === draft && error.revision === draft.revision}<span class="messages-draft-error" role="status">{error.message}</span>{/if}

<style>
  textarea { resize: none; box-sizing: border-box; min-width: 0; font-family: inherit; white-space: pre-wrap; }
  :global(.messages-draft-recipient) { min-width: 0; width: min(260px, 100%); border: 0; background: transparent; color: inherit; font: inherit; outline-color: var(--appearance-focus, #0987f7); }
  :global(.messages-send-button) { flex: none; border: 0; padding: 0; width: 25px; height: 25px; border-radius: 50%; background: var(--appearance-accent, #0987f7); color: white; font: 600 20px/25px sans-serif; }
  :global(.messages-window .messages-send-button) { position: absolute; right: 13px; top: 15px; }
  .messages-draft-error { position: absolute; right: 8px; bottom: 3px; z-index: 2; max-width: calc(100% - 16px); padding: 2px; background: var(--appearance-input, #fff); font-size: 11px; color: #b72a27; pointer-events: none; }
</style>
