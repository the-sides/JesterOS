<script>
  import { tick } from 'svelte';
  let { window, clock, summary, editor, execute, foreground = true } = $props();
  let panel = $state(null), body = $state(null), timeInput = $state(null);
  let focusedEditId = $state(null);
  let leaseRoot = null, leaseId = null, nativeWrites = 0;
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  function live() {
    const root = panel?.closest('[data-session-scene]');
    if (!foreground || !editor || window?.id !== editor.windowId || window.minimized
      || !panel?.isConnected || !root?.isConnected || panel.closest('[inert]')
      || panel.dataset.windowId !== editor.windowId || panel.dataset.editId !== editor.editId
      || !panel.getClientRects().length || panel.clientWidth <= 0 || panel.clientHeight <= 0) return false;
    if (leaseId !== editor.editId) { leaseId = editor.editId; leaseRoot = root; }
    if (root !== leaseRoot) return false;
    const owner = [...root.querySelectorAll('.managed-window[data-window-id]')].find(node => node.dataset.windowId === editor.windowId);
    return Boolean(owner?.isConnected && !owner.classList.contains('inactive')
      && getComputedStyle(panel).visibility === 'visible');
  }
  function control(id) {
    return [...(panel?.querySelectorAll('[data-clock-time-control]') ?? [])].find(node => node.dataset.clockTimeControl === id) ?? null;
  }
  function fieldOf(node) { return node?.closest?.('[data-clock-time-control]')?.dataset.clockTimeControl ?? null; }
  function owned(node) {
    if (!live() || !node?.isConnected || (node !== panel && !panel.contains(node)) || node.disabled
      || node.closest('[inert]') || !node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') return false;
    const rect = node.getBoundingClientRect(), viewport = globalThis.window.visualViewport;
    let left = Math.max(rect.left, viewport?.offsetLeft ?? 0), top = Math.max(rect.top, viewport?.offsetTop ?? 0);
    let right = Math.min(rect.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth));
    let bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight));
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (style.visibility !== 'visible' || style.opacity === '0') return false;
      if (parent === node) continue;
      if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + parent.clientLeft);
        right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + parent.clientTop);
        bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
      }
    }
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  function target() { return { windowId: editor.windowId, editId: editor.editId }; }
  const nativeDateTime = value => value.replace(/(T\d{2}:\d{2}):00$/, '$1');
  export function available(controlId) { return owned(controlId ? control(controlId) : panel); }
  export function controlIds() {
    return live() ? [...panel.querySelectorAll('[data-clock-time-control]')]
      .filter(node => node.isConnected && !node.disabled && node.getClientRects().length)
      .map(node => node.dataset.clockTimeControl) : [];
  }
  export function focusedControl() {
    const id = fieldOf(document.activeElement);
    return id && control(id) === document.activeElement && owned(document.activeElement) ? id : null;
  }
  export function focus(controlId) {
    nativeWrites++;
    try {
      if (!live()) return false;
      const root = panel, editId = editor.editId, node = control(controlId);
      if (!node?.isConnected || node.disabled || !node.getClientRects().length) return false;
      if (body?.contains(node)) {
        const rect = node.getBoundingClientRect(), clip = body.getBoundingClientRect();
        const top = clip.top + body.clientTop + 4, bottom = clip.top + body.clientTop + body.clientHeight - 4;
        const left = clip.left + body.clientLeft + 4, right = clip.left + body.clientLeft + body.clientWidth - 4;
        body.scrollTop += rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
        body.scrollLeft += rect.left < left ? rect.left - left : rect.right > right ? rect.right - right : 0;
      }
      if (!owned(node)) return false;
      if (document.activeElement !== node) node.focus({ preventScroll: true });
      return live() && panel === root && editor.editId === editId && document.activeElement === node && owned(node);
    } finally { nativeWrites--; }
  }
  export async function reconcile() {
    await tick();
    if (!live() || !timeInput?.isConnected) return false;
    const value = nativeDateTime(editor.localDateTime);
    if (timeInput.value !== value) timeInput.value = value;
    return true;
  }
  export function scrollTop() { return live() && body?.isConnected ? body.scrollTop : null; }
  export async function scroll(top) {
    if (!live() || !owned(panel) || !body?.isConnected || !Number.isFinite(top) || top < 0) return null;
    nativeWrites++;
    try {
      const root = panel, scrollBody = body, editId = editor.editId;
      scrollBody.scrollTo({ top, left: 0, behavior: 'instant' });
      await tick(); await frame();
      return live() && panel === root && body === scrollBody && editor.editId === editId ? scrollBody.scrollTop : null;
    } finally { nativeWrites--; }
  }
  async function configure(event) {
    const node = event.currentTarget;
    try {
      if (owned(node)) await execute({ command: 'clock.time.configure', target: target(), payload: { localDateTime: node.value } });
    } finally { await reconcile(); }
  }
  async function submit() {
    if (!available('set') || !timeInput?.isConnected) return;
    const lease = target(), localDateTime = timeInput.value;
    try {
      // A focused native date input may not emit change until blur. Flush only its private draft before Set.
      if (localDateTime !== nativeDateTime(editor.localDateTime)) {
        const result = await execute({ command: 'clock.time.configure', target: lease, payload: { localDateTime } });
        if (result.status !== 'applied') return;
      }
      if (live() && editor.editId === lease.editId && editor.windowId === lease.windowId)
        return await execute({ command: 'clock.time.submit', target: lease, payload: {} });
    } finally { await reconcile(); }
  }
  function cancel() {
    if (!available('cancel')) return;
    return execute({ command: 'clock.time.cancel', target: target(), payload: {} });
  }
  function observeFocus(event) {
    const id = fieldOf(event.target);
    if (!nativeWrites && id && owned(event.target)) void execute({ command: 'clock.time.focus', target: { ...target(), control: id }, payload: { observe: true } });
  }
  function observeScroll() {
    const top = scrollTop();
    if (!nativeWrites && top !== null && available()) void execute({ command: 'clock.time.scroll', target: target(), payload: { top, observe: true } });
  }
  function trap(event) {
    event.stopPropagation();
    if (!live()) return;
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    if (event.key === 'Enter') {
      const id = fieldOf(event.target);
      if (id === 'local-datetime' || id === 'set') { event.preventDefault(); void submit(); return; }
      if (id === 'cancel') { event.preventDefault(); cancel(); return; }
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const sequence = controlIds(), index = sequence.indexOf(fieldOf(event.target));
      const next = index < 0 ? event.shiftKey ? sequence.length - 1 : 0 : (index + (event.shiftKey ? -1 : 1) + sequence.length) % sequence.length;
      if (sequence[next]) void execute({ command: 'clock.time.focus', target: { ...target(), control: sequence[next] }, payload: {} });
    }
  }
  $effect(() => {
    const editId = editor?.editId;
    if (!editId || !panel || !timeInput || !foreground || focusedEditId === editId) return;
    // Do not echo native input changes through a reactive value assignment:
    // assigning the same datetime value resets its in-progress numeric segment.
    timeInput.value = nativeDateTime(editor.localDateTime);
    if (focus('local-datetime')) focusedEditId = editId;
  });
  $effect(() => { if (!editor) { focusedEditId = null; leaseRoot = null; leaseId = null; } });
</script>

{#if editor && window?.id === editor.windowId}
  <div class="clock-time-sheet" bind:this={panel} role="dialog" aria-modal="true" aria-label="Set Date and Time" data-clock-time-editor data-window-id={editor.windowId} data-edit-id={editor.editId} tabindex="-1" onkeydown={trap} onfocusin={observeFocus}>
    <div class="body" bind:this={body} data-clock-time-scroll onscroll={observeScroll}>
      <h1>Set Date and Time</h1>
      <p class="current">Current: <time datetime={summary.iso}>{summary.fullDate}, {summary.fullTime}</time></p>
      <label for={`clock-local-datetime-${editor.editId}`}>Date and time in {clock.timeZone}</label>
      <input id={`clock-local-datetime-${editor.editId}`} bind:this={timeInput} type="datetime-local" step="1" data-clock-time-control="local-datetime" aria-invalid={Boolean(editor.error)} aria-describedby={`clock-time-boundary-${editor.editId}${editor.error ? ` clock-time-error-${editor.editId}` : ''}`} onchange={configure} />
      {#if editor.error}<p id={`clock-time-error-${editor.editId}`} class="error" role="alert">{editor.error}</p>{/if}
      <p id={`clock-time-boundary-${editor.editId}`} class="boundary">Set advances or holds this fictional desktop’s authored clock; it cannot move backward. Ambiguous or nonexistent local times are not accepted. No host clock is changed.</p>
    </div>
    <footer><button type="button" data-clock-time-control="cancel" onclick={cancel}>Cancel</button><button type="button" class="primary" data-clock-time-control="set" onclick={submit}>Set</button></footer>
  </div>
{/if}

<style>
  .clock-time-sheet { display:flex; flex-direction:column; box-sizing:border-box; width:min(440px,100%); max-height:min(100%,calc(100svh - 16px)); min-width:0; min-height:0; overflow:hidden; border:1px solid var(--appearance-border,#c9c6c1); border-radius:12px; box-shadow:0 18px 48px #0003; background:var(--appearance-panel,#f3f1ed); color:var(--appearance-ink,#292827); font:12px/1.4 var(--golden-gate-font,sans-serif); text-align:left; }
  .body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:14px 18px; }
  h1 { margin:0 0 12px; font-size:15px; font-weight:650; overflow-wrap:anywhere; } .current { margin:0 0 12px; font-size:11px; opacity:.7; overflow-wrap:anywhere; }
  label { display:block; margin:10px 0 4px; font-weight:600; overflow-wrap:anywhere; }
  input { display:block; box-sizing:border-box; width:100%; min-width:0; min-height:30px; padding:4px 8px; border:1px solid var(--appearance-border,#c9c6c1); border-radius:6px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; }
  .error { margin:10px 0 0; padding:2px 0 2px 10px; color:#c04a40; font-size:11px; font-weight:600; border-left:3px solid #c04a40; overflow-wrap:anywhere; }
  .boundary { margin:12px 0 0; font-size:10px; opacity:.65; overflow-wrap:anywhere; }
  footer { flex-shrink:0; display:flex; justify-content:flex-end; gap:8px; padding:10px 12px; border-top:1px solid var(--appearance-soft-border,#dedbd6); }
  button { min-height:26px; padding:3px 16px; border:1px solid var(--appearance-border,#cbc7c0); border-radius:6px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; cursor:default; }
  .primary { border:0; background:var(--appearance-accent,#2e7cf6); color:white; font-weight:600; }
  input:focus-visible,button:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:1px; } .clock-time-sheet:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:380px) { .body { padding:12px 14px; } }
</style>
