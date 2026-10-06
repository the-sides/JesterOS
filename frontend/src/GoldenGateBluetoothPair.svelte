<script>
  import { onMount, onDestroy, tick } from 'svelte';
  let { pending, execute, foreground = true } = $props();
  let panel = $state(null), body = $state(null), pinInput = $state(null);
  let ownerRoot = null, disposed = false, nativeWrites = 0, writtenScroll = null, composing = false;

  function live() {
    return Boolean(!disposed && foreground && pending && panel?.isConnected && ownerRoot?.isConnected
      && panel.closest('[data-session-scene]') === ownerRoot && panel.dataset.pairId === pending.pairId
      && !panel.closest('[inert], [aria-hidden="true"]') && panel.getClientRects().length
      && panel.clientWidth > 0 && panel.clientHeight > 0 && getComputedStyle(panel).visibility === 'visible');
  }
  function control(id) {
    return [...(panel?.querySelectorAll('[data-bluetooth-control]') ?? [])]
      .find(node => node.dataset.bluetoothControl === id) ?? null;
  }
  function fieldOf(node) { return node?.closest?.('[data-bluetooth-control]')?.dataset.bluetoothControl ?? null; }
  function owned(node) {
    if (!live() || !node?.isConnected || (node !== panel && !panel.contains(node)) || node.disabled
      || node.closest('[inert], [aria-hidden="true"]') || !node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect(), viewport = globalThis.window.visualViewport;
    let left = Math.max(rect.left, viewport?.offsetLeft ?? 0), top = Math.max(rect.top, viewport?.offsetTop ?? 0);
    let right = Math.min(rect.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth));
    let bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight));
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (parent.hidden || parent.inert || style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
      if (parent === node) continue;
      const scaleX = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
      const scaleY = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
      if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + parent.clientLeft * scaleX);
        right = Math.min(right, bounds.left + (parent.clientLeft + parent.clientWidth) * scaleX);
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + parent.clientTop * scaleY);
        bottom = Math.min(bottom, bounds.top + (parent.clientTop + parent.clientHeight) * scaleY);
      }
    }
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  function target() { return { pairId: pending.pairId }; }
  function same(original, sheet) { return live() && panel === original && pending === sheet; }
  function reveal(node) {
    if (!body?.contains(node)) return true;
    const rect = node.getBoundingClientRect(), clip = body.getBoundingClientRect();
    const scaleX = body.offsetWidth ? clip.width / body.offsetWidth : 1;
    const scaleY = body.offsetHeight ? clip.height / body.offsetHeight : 1;
    if (scaleX <= 0 || scaleY <= 0) return false;
    const top = clip.top + (body.clientTop + 4) * scaleY, bottom = clip.top + (body.clientTop + body.clientHeight - 4) * scaleY;
    const left = clip.left + (body.clientLeft + 4) * scaleX, right = clip.left + (body.clientLeft + body.clientWidth - 4) * scaleX;
    body.scrollTop += (rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0) / scaleY;
    body.scrollLeft += (rect.left < left ? rect.left - left : rect.right > right ? rect.right - right : 0) / scaleX;
    writtenScroll = { body, top: body.scrollTop, left: body.scrollLeft };
    return true;
  }

  export function element() { return panel; }
  export function available(controlId) { return owned(controlId ? control(controlId) : panel); }
  export function controlIds() {
    return live() ? [...panel.querySelectorAll('[data-bluetooth-control]')]
      .filter(node => node.isConnected && !node.disabled && node.getClientRects().length)
      .map(node => node.dataset.bluetoothControl) : [];
  }
  export function focusedControl() {
    const node = panel?.ownerDocument.activeElement, id = fieldOf(node);
    return id && control(id) === node && owned(node) ? id : null;
  }
  export async function focus(controlId) {
    if (!live()) return false;
    const original = panel, sheet = pending;
    await tick();
    if (!same(original, sheet)) return false;
    const node = control(controlId);
    if (!node?.isConnected || node.disabled || !node.getClientRects().length) return false;
    nativeWrites++;
    try {
      if (!reveal(node.closest('.pin-field') ?? node) || !owned(node)) return false;
      if (document.activeElement !== node) node.focus({ preventScroll: true });
      await tick();
      return same(original, sheet) && control(controlId) === node && document.activeElement === node && owned(node);
    } finally { nativeWrites--; }
  }
  export function draft() {
    return live() && pending.mode === 'pin' && pinInput?.isConnected && panel.contains(pinInput) ? { pin: pinInput.value } : null;
  }
  export async function setDraft(value) {
    if (!live() || pending.mode !== 'pin' || typeof value?.pin !== 'string' || value.pin.length > 6) return false;
    const original = panel, sheet = pending, input = pinInput;
    await tick();
    if (!same(original, sheet) || input !== pinInput || !input?.isConnected || !panel.contains(input)
      || !available('cancel') || !available('pair')) return false;
    // Native typing already owns the value and selection; never echo an unchanged draft back into it.
    if (input.value !== value.pin) input.value = value.pin;
    return same(original, sheet) && input === pinInput && input.value === value.pin;
  }
  export function scrollTop() { return live() && body?.isConnected ? body.scrollTop : null; }
  export async function scrollTo(top) {
    if (!available() || !body?.isConnected || !Number.isFinite(top) || top < 0) return null;
    const original = panel, sheet = pending, scrollBody = body;
    nativeWrites++;
    try {
      scrollBody.scrollTo({ top, left: 0, behavior: 'instant' });
      writtenScroll = { body: scrollBody, top: scrollBody.scrollTop, left: scrollBody.scrollLeft };
      await tick();
      return same(original, sheet) && body === scrollBody ? scrollBody.scrollTop : null;
    } finally { nativeWrites--; }
  }
  function cancel() {
    if (available('cancel')) return execute({ command: 'bluetooth.pair.cancel', target: target(), payload: {} });
  }
  function submit(event) {
    if (!available('pair') || composing || event?.isComposing || event?.metaKey || event?.ctrlKey || event?.altKey || event?.shiftKey) return;
    const values = pending.mode === 'pin' ? draft() : {};
    if (values) return execute({ command: 'bluetooth.pair.submit', target: target(), payload: values });
  }
  function observeFocus(event) {
    const id = fieldOf(event.target);
    if (!nativeWrites && id && control(id) === event.target && owned(event.target))
      void execute({ command: 'bluetooth.pair.focus', target: { ...target(), control: id }, payload: { observe: true } });
  }
  function observeScroll() {
    const written = writtenScroll;
    writtenScroll = null;
    const top = scrollTop();
    if (nativeWrites || top === null || !available()
      || written?.body === body && written.top === top && written.left === body.scrollLeft) return;
    void execute({ command: 'bluetooth.pair.scroll', target: target(), payload: { top, observe: true } });
  }
  function trap(event) {
    event.stopPropagation();
    if (!live()) return;
    if (composing || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) {
      if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); void cancel(); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey || event.repeat) return;
      const id = fieldOf(event.target);
      if (id === 'cancel') void cancel();
      else if (id === 'pin' || id === 'pair') void submit();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const sequence = controlIds(), index = sequence.indexOf(fieldOf(event.target));
      const next = index < 0 ? event.shiftKey ? sequence.length - 1 : 0 : (index + (event.shiftKey ? -1 : 1) + sequence.length) % sequence.length;
      if (sequence[next]) void execute({ command: 'bluetooth.pair.focus', target: { ...target(), control: sequence[next] }, payload: {} });
    }
  }
  onMount(() => { ownerRoot = panel?.closest('[data-session-scene]') ?? null; });
  onDestroy(() => { disposed = true; });
</script>

{#if pending}
  {#key pending.pairId}
    <div class="pair-sheet" bind:this={panel} role="dialog" aria-modal="true" aria-label={`Pair with “${pending.name}”`}
      data-bluetooth-pair data-pair-id={pending.pairId} tabindex="-1" onkeydown={trap} onfocusin={observeFocus}
      oncompositionstart={() => { composing = true; }} oncompositionend={() => { composing = false; }}>
      <div class="body" bind:this={body} data-bluetooth-pair-scroll onscroll={observeScroll}>
        <h1>Pair with “{pending.name}”</h1>
        {#if pending.mode === 'pin'}
          <p class="instructions">Enter this fictional pairing code, then press Enter.</p>
          <p class="code" aria-label={`Fictional pairing code ${pending.code}`}>{pending.code}</p>
          <div class="pin-field">
            <label for={`bluetooth-pin-${pending.pairId}`}>PIN</label>
            <input id={`bluetooth-pin-${pending.pairId}`} bind:this={pinInput} data-bluetooth-control="pin" type="text" inputmode="numeric"
              maxlength="6" autocomplete="off" spellcheck="false" autocapitalize="off" aria-invalid={Boolean(pending.error)}
              aria-describedby={`bluetooth-boundary-${pending.pairId}${pending.error ? ` bluetooth-error-${pending.pairId}` : ''}`} />
            {#if pending.error}<p id={`bluetooth-error-${pending.pairId}`} class="error" role="alert">{pending.error}</p>{/if}
          </div>
        {:else if pending.mode === 'confirm'}
          <p class="instructions">Confirm this fictional pairing code, then click Accept.</p>
          <p class="code" aria-label={`Fictional pairing code ${pending.code}`}>{pending.code}</p>
        {:else}
          <p class="instructions">Connect this fictional Bluetooth device to this desktop.</p>
        {/if}
        {#if pending.error && pending.mode !== 'pin'}<p id={`bluetooth-error-${pending.pairId}`} class="error" role="alert">{pending.error}</p>{/if}
        <p id={`bluetooth-boundary-${pending.pairId}`} class="boundary">Authored simulator pairing only. No nearby hardware is accessed. Never enter a real credential.</p>
      </div>
      <footer>
        <button type="button" data-bluetooth-control="cancel" onclick={cancel}>Cancel</button>
        <button type="button" class="primary" data-bluetooth-control="pair" onclick={submit}>{pending.mode === 'confirm' ? 'Accept' : 'Connect'}</button>
      </footer>
    </div>
  {/key}
{/if}

<style>
  .pair-sheet { display:flex; flex-direction:column; box-sizing:border-box; width:min(400px,100%); max-height:min(100%,calc(100svh - 16px)); min-width:0; min-height:0; overflow:hidden; border:1px solid var(--appearance-border,#c9c6c1); border-radius:12px; box-shadow:0 18px 48px #0003; background:var(--appearance-panel,#f3f1ed); color:var(--appearance-ink,#292827); font:12px/1.4 var(--golden-gate-font,sans-serif); text-align:left; }
  .body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:14px 18px; }
  h1 { margin:0 0 10px; font-size:15px; font-weight:650; overflow-wrap:anywhere; }
  .instructions { margin:0 0 10px; overflow-wrap:anywhere; }
  .code { margin:10px 0; text-align:center; font-size:24px; font-weight:600; font-variant-numeric:tabular-nums; letter-spacing:.18em; }
  label { display:block; margin:10px 0 4px; font-weight:600; }
  input { display:block; box-sizing:border-box; width:100%; min-width:0; min-height:28px; padding:4px 8px; border:1px solid var(--appearance-border,#c9c6c1); border-radius:6px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; font-variant-numeric:tabular-nums; }
  .error { margin:10px 0 0; padding:2px 0 2px 10px; color:var(--appearance-ink,#292827); font-size:11px; font-weight:600; border-left:3px solid #c04a40; overflow-wrap:anywhere; }
  .boundary { margin:12px 0 0; font-size:10px; opacity:.7; overflow-wrap:anywhere; }
  footer { flex-shrink:0; display:flex; justify-content:flex-end; gap:8px; padding:10px 12px; border-top:1px solid var(--appearance-soft-border,#dedbd6); }
  button { min-height:26px; padding:3px 14px; border:1px solid var(--appearance-border,#cbc7c0); border-radius:6px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; cursor:default; }
  .primary { border:0; background:var(--appearance-accent,#2e7cf6); color:white; font-weight:600; }
  input:focus-visible,button:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:1px; }
  .pair-sheet:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:380px) { .body { padding:12px 14px; } }
</style>
