<script>
  import { onMount, onDestroy, tick } from 'svelte';

  let { appId, windowId, model, execute, registerView, active = true, windowControls = null, available = () => true } = $props();
  let panel = $state(null);
  let scroller = $state(null);
  let disposed = false;
  let writingFocus = null;
  let writtenScroll = null;
  let scrollGestureOwner = null;
  const title = $derived(appId === 'contacts' ? 'Contacts' : appId === 'mail' ? 'Mail' : 'Messages');
  const fields = $derived(model.entry?.kind === 'contact' ? ['name', 'email', 'phone', 'notes']
    : model.entry?.kind === 'mail' ? ['to', 'subject', 'body'] : model.entry?.kind === 'message' ? ['to', 'body'] : []);
  const labels = { name: 'Name', email: 'Email', phone: 'Phone', notes: 'Notes', to: 'To', subject: 'Subject', body: 'Message' };
  const canSubmit = $derived(!!model.editable && !!model.entry && !model.pending && (model.entry.kind === 'contact'
    ? ['name', 'email', 'phone'].some(field => model.entry.fields[field].trim())
    : !!model.entry.fields.to.trim() && (!!model.entry.fields.body.trim() || model.entry.kind === 'mail' && !!model.entry.attachments?.length)));

  function lease() { return { appId, windowId, entryId: model.entry?.id ?? null, kind: model.entry?.kind ?? null, panel }; }
  function current(owner) {
    return !disposed && owner.appId === appId && owner.windowId === windowId && owner.entryId === (model.entry?.id ?? null)
      && owner.kind === (model.entry?.kind ?? null) && owner.panel === panel && panel?.dataset.serviceWindowId === windowId
      && panel.dataset.serviceAppId === appId && panel.closest('[data-window-id]')?.dataset.windowId === windowId
      && available(windowId);
  }
  function visible(node) {
    if (!node?.isConnected || !panel?.contains(node) || node.disabled || node.matches(':disabled')) return false;
    const view = node.ownerDocument.defaultView, rect = node.getBoundingClientRect();
    if (!view || !node.getClientRects().length || rect.width <= 0 || rect.height <= 0) return false;
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(view.innerWidth, rect.right), bottom = Math.min(view.innerHeight, rect.bottom);
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.inert || ancestor.hasAttribute('inert')) return false;
      const style = view.getComputedStyle(ancestor);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
      if (ancestor !== node) {
        const clip = ancestor.getBoundingClientRect();
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
          left = Math.max(left, clip.left + ancestor.clientLeft); right = Math.min(right, clip.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
          top = Math.max(top, clip.top + ancestor.clientTop); bottom = Math.min(bottom, clip.top + ancestor.clientTop + ancestor.clientHeight);
        }
      }
    }
    return right > left && bottom > top;
  }
  function live() { return current(lease()) && visible(panel); }
  function rawControl(control) {
    if (!live()) return null;
    if (control === 'panel') return panel;
    const node = [...panel.querySelectorAll('[data-service-control]')].find(node => node.dataset.serviceControl === control);
    if (!node?.isConnected || node.disabled || node.matches(':disabled') || node.closest('[inert]')) return null;
    if (node.dataset.serviceField && (node.dataset.serviceEntryId !== model.entry?.id || !fields.includes(node.dataset.serviceField))) return null;
    return node;
  }
  function reveal(node) {
    for (let parent = node.parentElement; parent && panel.contains(parent); parent = parent.parentElement) {
      const rect = node.getBoundingClientRect(), clip = parent.getBoundingClientRect();
      if (parent.scrollHeight > parent.clientHeight) parent.scrollTop += rect.top < clip.top ? rect.top - clip.top : rect.bottom > clip.bottom ? rect.bottom - clip.bottom : 0;
      if (parent.scrollWidth > parent.clientWidth) parent.scrollLeft += rect.left < clip.left ? rect.left - clip.left : rect.right > clip.right ? rect.right - clip.right : 0;
      if (parent === scroller) writtenScroll = { ...lease(), top: parent.scrollTop, left: parent.scrollLeft };
    }
  }
  export async function prepare(control = 'panel') {
    const owner = lease();
    await tick();
    if (!current(owner)) return false;
    const node = rawControl(control);
    if (!node) return false;
    reveal(node);
    return current(owner) && rawControl(control) === node && visible(node);
  }
  export async function focus(control = 'panel', selection) {
    const owner = lease(), original = rawControl(control);
    if (!original || !await prepare(control) || !current(owner) || rawControl(control) !== original) return false;
    if (selection && (!original.setSelectionRange || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)
      || selection.start < 0 || selection.end < selection.start || selection.end > original.value.length
      || selection.direction !== undefined && !['forward', 'backward', 'none'].includes(selection.direction))) return false;
    writingFocus = original;
    try {
      original.focus({ preventScroll: true });
      if (selection) original.setSelectionRange(selection.start, selection.end, selection.direction ?? 'none');
    } catch { return false; }
    finally { writingFocus = null; }
    return current(owner) && visible(original) && original.ownerDocument.activeElement === original;
  }
  export function scroll({ top, left = 0, observe = false }) {
    if (!live() || !visible(scroller) || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return null;
    if (!observe) {
      scroller.scrollTop = Math.min(top, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
      scroller.scrollLeft = Math.min(left, Math.max(0, scroller.scrollWidth - scroller.clientWidth));
      writtenScroll = { ...lease(), top: scroller.scrollTop, left: scroller.scrollLeft };
    }
    return { top: scroller.scrollTop, left: scroller.scrollLeft };
  }
  export function describe() {
    const controls = live() ? [panel, ...panel.querySelectorAll('[data-service-control]')].filter(visible) : [];
    return { controlIds: controls.map(node => node === panel ? 'panel' : node.dataset.serviceControl),
      focusedControl: controls.find(node => node.ownerDocument.activeElement === node)?.dataset.serviceControl ?? (live() && panel.ownerDocument.activeElement === panel ? 'panel' : null),
      scroll: live() && visible(scroller) ? { top: scroller.scrollTop, left: scroller.scrollLeft } : null };
  }
  export function contains(node) { return live() && !!node && panel.contains(node); }
  export function fieldNode(field) {
    const node = fields.includes(field) ? rawControl(field) : null;
    return visible(node) ? node : null;
  }
  const facade = { prepare, focus, scroll, describe, contains, fieldNode };
  onMount(() => {
    const id = windowId, callback = registerView;
    const unregister = callback?.(id, facade);
    return () => { disposed = true; if (typeof unregister === 'function') unregister(); else callback?.(id, null, facade); };
  });
  onDestroy(() => { disposed = true; });

  function request(command, target, payload = {}, owner = lease()) {
    if (!current(owner) || !live()) return null;
    return execute({ command, target, payload });
  }
  function changeField(event) {
    const owner = lease(), node = event.currentTarget, field = node.dataset.serviceField, value = node.value;
    if (!model.editable || model.pending || node.dataset.serviceEntryId !== owner.entryId || rawControl(field) !== node) return;
    request('services.draft.set', { appId: owner.appId, windowId: owner.windowId, draftId: owner.entryId, field }, { value }, owner);
  }
  function draftAction(action) {
    const owner = lease();
    if (!model.editable || model.pending || !owner.entryId || action === 'submit' && !canSubmit) return;
    request(`services.draft.${action}`, { appId: owner.appId, windowId: owner.windowId, draftId: owner.entryId }, {}, owner);
  }
  function selectEntry(entryId) { const owner = lease(); request('services.provider.select', { appId: owner.appId, windowId: owner.windowId }, { entryId }, owner); }
  function contactAction(serviceId) {
    const owner = lease(), sourceId = model.contactSourceId;
    if (model.editable || model.pending || model.entry?.kind !== 'contact' || !sourceId) return;
    request('app.service.perform', { appId: 'contacts', serviceId, sourceId }, {}, owner);
  }
  function observeFocus(event) {
    const node = event.target, owner = lease();
    if (node === writingFocus || !visible(node) || node.ownerDocument.activeElement !== node) return;
    const control = node === panel ? 'panel' : node.dataset.serviceControl;
    if (control && rawControl(control) === node) request('services.panel.focus', { appId: owner.appId, windowId: owner.windowId, control }, {}, owner);
  }
  function beginScrollGesture() { scrollGestureOwner = live() ? lease() : null; }
  function observeScroll(event) {
    const node = event.currentTarget, written = writtenScroll, owner = written ?? scrollGestureOwner;
    writtenScroll = null;
    if (!owner || !current(owner) || node !== scroller || !visible(node)) return;
    const payload = { top: node.scrollTop, left: node.scrollLeft, observe: true };
    if (written && written.top === payload.top && written.left === payload.left) return;
    request('services.panel.scroll', { appId: owner.appId, windowId: owner.windowId }, payload, owner);
  }
  export function keydown(event) {
    if (!live() || !panel.contains(event.target) || event.isComposing) return;
    if (event.metaKey && event.key.toLowerCase() === 'w') {
      event.preventDefault(); event.stopImmediatePropagation();
      request('window.close', { windowId });
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      request('services.panel.focus', { appId, windowId, control: 'panel' });
    } else if (event.metaKey && event.key === 'Enter' && canSubmit) {
      event.preventDefault(); event.stopImmediatePropagation(); draftAction('submit');
    }
  }
</script>
<svelte:window
  onkeydown={event => { if (panel?.contains(event.target)) { if (scroller?.contains(event.target)) beginScrollGesture(event); keydown(event); } }}
  onpointerdown={event => { if (scroller?.contains(event.target)) beginScrollGesture(event); }} />

<div bind:this={panel} class="service-provider" class:inactive={!active} role="group" data-service-panel data-service-window-id={windowId}
  data-service-app-id={appId} data-service-control="panel" tabindex="-1" aria-label={`${title} local services workspace`} onfocusin={observeFocus}>
  <header class="workspace-header" data-window-drag={appId === 'messages' ? '' : undefined}>
    {#if windowControls}<div class="window-controls">{@render windowControls()}</div>{/if}
    <div class="heading"><strong>{title}</strong><span>Local Services</span></div>
    {#if appId === 'messages'}<button type="button" data-service-control="sample" onclick={() => selectEntry(null)}>Sample</button>{/if}
  </header>
  <div class="workspace-body">
    <nav class="entry-list" aria-label={`${title} drafts and ${appId === 'contacts' ? 'contacts' : 'local sent records'}`}>
      <h2>{appId === 'contacts' ? 'Cards & Drafts' : 'Drafts & Sent Locally'}</h2>
      {#each model.entries as item (item.id)}
        <button type="button" class:selected={model.entry?.id === item.id} aria-current={model.entry?.id === item.id ? 'true' : undefined}
          data-service-control={`list-entry:${item.id}`} disabled={model.pending} onclick={() => selectEntry(item.id)}>
          <span class="entry-label">{item.label}</span><span class="entry-status">{item.draft ? 'Draft' : item.kind === 'contact' ? 'Contact' : 'Sent locally'}</span>
        </button>
      {:else}<p class="list-empty">No local records</p>{/each}
    </nav>
    <div bind:this={scroller} class="detail-scroll" role="group" aria-label="Local record details" data-service-scroll data-service-entry-id={model.entry?.id}
      onscroll={observeScroll} onwheel={beginScrollGesture}>
      {#if model.entry}
        <div class="detail">
          <div class="detail-heading"><h1>{model.editable ? model.entry.kind === 'contact' ? 'New Contact' : 'New Message' : model.entry.kind === 'contact' ? 'Contact' : 'Sent Locally'}</h1><span>{model.editable ? 'Draft' : 'Local record'}</span></div>
          {#if model.entry.kind === 'contact' && !model.editable}
            <div class="contact-actions" role="group" aria-label="Address a new local composition">
              <button type="button" data-service-control="contact-mail" disabled={model.pending || !model.contactSourceId || !model.entry.fields.email.trim()} onclick={() => contactAction('email-contact')}>Mail</button>
              <button type="button" data-service-control="contact-message" disabled={model.pending || !model.contactSourceId || !(model.entry.fields.phone.trim() || model.entry.fields.email.trim())} onclick={() => contactAction('message-contact')}>Message</button>
            </div>
          {/if}
          <div class="fields">
            {#each fields as field (field)}
              <label class:long-field={field === 'body' || field === 'notes'}><span>{labels[field]}</span>
                {#if field === 'body' || field === 'notes'}
                  <textarea data-service-field={field} data-service-entry-id={model.entry.id} data-service-control={field} value={model.entry.fields[field]}
                    readonly={model.pending || !model.editable} maxlength="1048576" rows={field === 'body' ? 8 : 5} oninput={changeField}></textarea>
                {:else}
                  <input type="text" data-service-field={field} data-service-entry-id={model.entry.id} data-service-control={field} value={model.entry.fields[field]}
                    readonly={model.pending || !model.editable} maxlength="4096" autocomplete="off" spellcheck={field === 'name' || field === 'subject'} oninput={changeField} />
                {/if}
              </label>
            {/each}
          </div>
          {#if model.entry.kind === 'mail' && model.entry.attachments?.length}
            <section class="attachments" aria-label="Immutable local attachment snapshots">
              <h2>Attachments <span>{model.entry.attachments.length}</span></h2>
              {#each model.entry.attachments as attachment, index (`${attachment.fileId}:${index}`)}
                <details><summary><span>{attachment.name}</span><small>Revision {attachment.revision}</small></summary><pre>{attachment.content}</pre></details>
              {/each}
              <p>Saved copies of virtual files. Later file edits do not change these attachments.</p>
            </section>
          {/if}
          {#if model.editable}
            <div class="draft-actions"><button type="button" data-service-control="discard" disabled={model.pending} onclick={() => draftAction('discard')}>Discard Draft</button>
              <button type="button" class="primary" data-service-control="commit" disabled={!canSubmit} onclick={() => draftAction('submit')}>{model.entry.kind === 'contact' ? 'Done' : 'Send Locally'}</button></div>
          {/if}
          <p class="boundary">{model.entry.kind === 'contact' ? 'Contacts are saved only in this local scene.' : 'Messages stay in this local scene. Nothing is delivered over a network.'}</p>
        </div>
      {:else}
        <div class="empty"><h1>{appId === 'contacts' ? 'No Contact Selected' : 'No Composition Selected'}</h1><p>Select text in a supported local document and choose Local Services to create {appId === 'contacts' ? 'a contact draft' : 'an editable composition'}.</p><p>{appId === 'mail' ? 'Selected virtual files can also become attachment snapshots.' : 'Your saved local records appear in the list.'}</p></div>
      {/if}
      {#if model.error}<p class="error" role="alert">{model.error}</p>{/if}
      {#if model.pending}<p class="pending" role="status">Preparing local workspace…</p>{/if}
    </div>
  </div>
</div>

<style>
  .service-provider { display: flex; flex: 1; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; container-type: inline-size; color: var(--appearance-ink, #252529); background: var(--appearance-panel, #f2f2f3); font: 13px/1.4 var(--golden-gate-font, sans-serif); }
  .workspace-header { display: flex; align-items: center; flex: 0 0 auto; flex-wrap: wrap; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--appearance-soft-border, #dcd8d3); }
  .window-controls { flex: 0 0 auto; }
  .heading { display: flex; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; min-width: 0; }
  .heading strong { font-size: 15px; font-weight: 650; }.heading span, .detail-heading>span { font-size: 11px; opacity: .65; }
  .workspace-body { display: flex; flex: 1; min-height: 0; min-width: 0; }
  .entry-list { flex: 0 0 172px; min-width: 0; overflow: auto; overscroll-behavior: contain; border-right: 1px solid var(--appearance-soft-border, #dcd8d3); padding: 10px 6px; box-sizing: border-box; }
  h2 { margin: 0 6px 10px; font-size: 11px; font-weight: 650; opacity: .7; }
  .entry-list button { display: flex; flex-direction: column; align-items: flex-start; width: 100%; gap: 3px; margin-bottom: 3px; padding: 8px; border: 0; background: transparent; text-align: left; }
  .entry-list button.selected { color: var(--appearance-selection-ink, #fff); background: var(--appearance-selection, #246bd6); }
  .entry-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.entry-status { font-size: 10px; opacity: .72; }
  .list-empty { margin: 12px 6px; font-size: 11px; opacity: .65; }
  .detail-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .detail, .empty { max-width: 560px; padding: 20px; margin: 0 auto; box-sizing: border-box; }
  .detail-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 5px; margin-bottom: 18px; }
  h1 { margin: 0; font-size: 18px; font-weight: 650; }.empty h1 { margin-bottom: 10px; }.empty p { opacity: .7; }
  .fields { border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 10px; overflow: hidden; background: var(--appearance-surface, #fff); }
  label { display: flex; align-items: baseline; min-width: 0; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--appearance-soft-border, #dcd8d3); }label:last-child { border: 0; }label>span { flex: 0 0 50px; font-size: 12px; opacity: .7; }
  input, textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 0; border-radius: 3px; padding: 3px; background: transparent; color: inherit; font: inherit; }textarea { resize: vertical; min-height: 100px; line-height: 1.5; }
  .long-field { flex-direction: column; align-items: stretch; }.long-field>span { flex: 0 0 auto; }
  button { max-width: 100%; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 6px; padding: 5px 10px; color: inherit; background: var(--appearance-surface, #fff); font: inherit; cursor: default; }
  button:disabled { opacity: .5; }.primary { color: var(--appearance-selection-ink, #fff); background: var(--appearance-accent, #0878ef); border-color: transparent; }
  .contact-actions, .draft-actions { display: flex; flex-wrap: wrap; gap: 8px; }.contact-actions { margin-bottom: 14px; }.draft-actions { justify-content: space-between; margin-top: 16px; }
  .attachments { margin-top: 16px; }.attachments h2 { margin-left: 0; }.attachments h2 span { font-variant-numeric: tabular-nums; }details { margin: 5px 0; padding: 8px 10px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 7px; background: var(--appearance-surface, #fff); }summary { overflow-wrap: anywhere; cursor: default; }summary small { margin-left: 10px; opacity: .65; }pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; font: 11px/1.5 ui-monospace, monospace; }
  .attachments p, .boundary { margin: 12px 0 0; font-size: 11px; opacity: .65; }.error, .pending { margin: 12px 20px; overflow-wrap: anywhere; }.error { color: var(--appearance-ink, #252529); border-left: 3px solid var(--appearance-accent, #0878ef); padding-left: 8px; }
  input:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: 2px; }.service-provider:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -3px; }
  @container (max-width: 430px) { .workspace-body { flex-direction: column; }.entry-list { flex: 0 0 auto; max-height: 120px; border-right: 0; border-bottom: 1px solid var(--appearance-soft-border, #dcd8d3); }.entry-list button { padding: 5px 8px; }.detail, .empty { padding: 14px; }.workspace-header { padding: 9px 12px; } }
</style>
