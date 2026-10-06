<script>
  import { tick } from 'svelte';
  let { window, clock, options, execute, foreground = true } = $props();
  let panel = $state(null), body = $state(null);
  let focusedOptionsId = $state(null);
  let leaseRoot = null, leaseId = null, nativeWrites = 0;
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  function live() {
    const root = panel?.closest('[data-session-scene]');
    if (!foreground || !options || window?.id !== options.windowId || window.minimized
      || !panel?.isConnected || !root?.isConnected || panel.closest('[inert]')
      || panel.dataset.windowId !== options.windowId || panel.dataset.optionsId !== options.optionsId
      || !panel.getClientRects().length || panel.clientWidth <= 0 || panel.clientHeight <= 0) return false;
    if (leaseId !== options.optionsId) { leaseId = options.optionsId; leaseRoot = root; }
    if (root !== leaseRoot) return false;
    const owner = [...root.querySelectorAll('.managed-window[data-window-id]')].find(node => node.dataset.windowId === options.windowId);
    return Boolean(owner?.isConnected && !owner.classList.contains('inactive')
      && getComputedStyle(panel).visibility === 'visible');
  }
  function control(id) {
    return [...(panel?.querySelectorAll('[data-clock-control]') ?? [])].find(node => node.dataset.clockControl === id) ?? null;
  }
  function fieldOf(node) { return node?.closest?.('[data-clock-control]')?.dataset.clockControl ?? null; }
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
  function target() { return { windowId: options.windowId, optionsId: options.optionsId }; }
  export function available(controlId) { return owned(controlId ? control(controlId) : panel); }
  export function controlIds() {
    return live() ? [...panel.querySelectorAll('[data-clock-control]')]
      .filter(node => node.isConnected && !node.disabled && node.getClientRects().length)
      .map(node => node.dataset.clockControl) : [];
  }
  export function focusedControl() {
    const id = fieldOf(document.activeElement);
    return id && control(id) === document.activeElement && owned(document.activeElement) ? id : null;
  }
  export function focus(controlId) {
    nativeWrites++;
    try {
      if (!live()) return false;
      const root = panel, optionsId = options.optionsId, node = control(controlId);
      if (!node?.isConnected || node.disabled || !node.getClientRects().length) return false;
      if (body?.contains(node)) {
        const rect = node.getBoundingClientRect(), clip = body.getBoundingClientRect();
        const top = clip.top + body.clientTop + 4, bottom = clip.top + body.clientTop + body.clientHeight - 4;
        const left = clip.left + body.clientLeft + 4, right = clip.left + body.clientLeft + body.clientWidth - 4;
        body.scrollTop += rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
        body.scrollLeft += rect.left < left ? rect.left - left : rect.right > right ? rect.right - right : 0;
      }
      if (!owned(node)) return false;
      node.focus({ preventScroll: true });
      return live() && panel === root && options.optionsId === optionsId && document.activeElement === node && owned(node);
    } finally { nativeWrites--; }
  }
  export async function reconcile() {
    await tick();
    if (!live()) return false;
    const date = control('show-date');
    if (date) date.value = clock.showDate;
    for (const [id, key] of [['show-day-of-week', 'showDayOfWeek'], ['show-ampm', 'showAMPM'], ['show-seconds', 'showSeconds']]) {
      const node = control(id);
      if (node) node.checked = clock[key];
    }
    for (const style of ['digital', 'analog']) {
      const node = control(`style-${style}`);
      if (node) node.checked = clock.style === style;
    }
    return true;
  }
  export function scrollTop() { return live() && body?.isConnected ? body.scrollTop : null; }
  export async function scroll(top) {
    if (!live() || !owned(panel) || !body?.isConnected || !Number.isFinite(top) || top < 0) return null;
    nativeWrites++;
    try {
      const root = panel, scrollBody = body, optionsId = options.optionsId;
      scrollBody.scrollTo({ top, left: 0, behavior: 'instant' });
      await tick(); await frame();
      return live() && panel === root && body === scrollBody && options.optionsId === optionsId ? scrollBody.scrollTop : null;
    } finally { nativeWrites--; }
  }
  async function configure(event, key) {
    const node = event.currentTarget;
    try {
      if (owned(node)) await execute({ command: 'clock.options.configure', target: target(),
        payload: { [key]: key === 'showDate' || key === 'style' ? node.value : node.checked } });
    } finally { await reconcile(); }
  }
  function close() {
    if (!available('done')) return;
    return execute({ command: 'clock.options.close', target: target(), payload: {} });
  }
  function observeFocus(event) {
    const id = fieldOf(event.target);
    if (!nativeWrites && id && owned(event.target)) void execute({ command: 'clock.options.focus', target: { ...target(), control: id }, payload: { observe: true } });
  }
  function observeScroll() {
    const top = scrollTop();
    if (!nativeWrites && top !== null && available()) void execute({ command: 'clock.options.scroll', target: target(), payload: { top, observe: true } });
  }
  function trap(event) {
    event.stopPropagation();
    if (!live()) return;
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Enter' && fieldOf(event.target) === 'done') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') {
      event.preventDefault();
      const sequence = controlIds(), index = sequence.indexOf(fieldOf(event.target));
      const next = index < 0 ? event.shiftKey ? sequence.length - 1 : 0 : (index + (event.shiftKey ? -1 : 1) + sequence.length) % sequence.length;
      if (sequence[next]) void execute({ command: 'clock.options.focus', target: { ...target(), control: sequence[next] }, payload: {} });
    }
  }
  $effect(() => {
    const optionsId = options?.optionsId;
    if (!optionsId || !panel || !foreground || focusedOptionsId === optionsId) return;
    if (focus('show-date')) focusedOptionsId = optionsId;
  });
  $effect(() => { if (!options) { focusedOptionsId = null; leaseRoot = null; leaseId = null; } });
</script>

{#if options && window?.id === options.windowId}
  <div class="clock-options-sheet" bind:this={panel} role="dialog" aria-modal="true" aria-label="Clock Options" data-clock-options data-window-id={options.windowId} data-options-id={options.optionsId} tabindex="-1" onkeydown={trap} onfocusin={observeFocus}>
    <div class="body" bind:this={body} data-clock-options-scroll onscroll={observeScroll}>
      <h1>Clock Options</h1>
      <h2>Date</h2>
      <label class="date-row" for={`clock-show-date-${options.optionsId}`}><span>Show Date</span><select id={`clock-show-date-${options.optionsId}`} data-clock-control="show-date" value={clock.showDate} onchange={event => configure(event, 'showDate')}><option value="when-space-allows">When Space Allows</option><option value="always">Always</option><option value="never">Never</option></select></label>
      <label class="check-row"><input type="checkbox" data-clock-control="show-day-of-week" checked={clock.showDayOfWeek} onchange={event => configure(event, 'showDayOfWeek')} /><span>Show day of the week</span></label>
      <h2>Time</h2>
      <fieldset><legend>Clock style</legend><label><input type="radio" name={`clock-style-${options.optionsId}`} value="digital" data-clock-control="style-digital" checked={clock.style === 'digital'} onchange={event => configure(event, 'style')} /><span>Digital</span></label><label><input type="radio" name={`clock-style-${options.optionsId}`} value="analog" data-clock-control="style-analog" checked={clock.style === 'analog'} onchange={event => configure(event, 'style')} /><span>Analog</span></label></fieldset>
      <label class="check-row" class:disabled={clock.style === 'analog'}><input type="checkbox" data-clock-control="show-ampm" disabled={clock.style === 'analog'} checked={clock.showAMPM} onchange={event => configure(event, 'showAMPM')} /><span>Show AM/PM</span></label>
      <label class="check-row" class:disabled={clock.style === 'analog'}><input type="checkbox" data-clock-control="show-seconds" disabled={clock.style === 'analog'} checked={clock.showSeconds} onchange={event => configure(event, 'showSeconds')} /><span>Display the time with seconds</span></label>
      <p class="boundary">Changes apply immediately. Set the time zone and 24-hour format in Date &amp; Time.</p>
    </div>
    <footer><button type="button" data-clock-control="done" onclick={close}>Done</button></footer>
  </div>
{/if}

<style>
  .clock-options-sheet { display:flex; flex-direction:column; box-sizing:border-box; width:min(440px,100%); max-height:min(100%,calc(100svh - 16px)); min-width:0; min-height:0; overflow:hidden; border:1px solid var(--appearance-border,#c9c6c1); border-radius:12px; box-shadow:0 18px 48px #0003; background:var(--appearance-panel,#f3f1ed); color:var(--appearance-ink,#292827); font:12px/1.4 var(--golden-gate-font,sans-serif); text-align:left; }
  .body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:14px 18px; }
  h1 { margin:0 0 14px; font-size:15px; font-weight:650; } h2 { margin:14px 0 8px; font-size:12px; font-weight:650; }
  label { display:flex; align-items:center; gap:8px; min-width:0; margin:10px 0; } label span { min-width:0; overflow-wrap:anywhere; } .date-row { justify-content:space-between; gap:12px; } .check-row { min-height:22px; } .disabled { opacity:.5; }
  input { flex-shrink:0; width:15px; height:15px; margin:0; accent-color:var(--appearance-accent,#0878ef); }
  fieldset { display:flex; flex-wrap:wrap; align-items:center; gap:10px 24px; margin:0; padding:0; border:0; } fieldset label { margin:4px 0; } legend { margin-bottom:4px; font-size:11px; opacity:.7; }
  select { box-sizing:border-box; min-width:0; max-width:100%; min-height:28px; padding:4px 8px; border:1px solid var(--appearance-border,#c9c6c1); border-radius:6px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; }
  .boundary { margin:14px 0 0; font-size:10px; opacity:.65; overflow-wrap:anywhere; }
  footer { flex-shrink:0; display:flex; justify-content:flex-end; padding:10px 12px; border-top:1px solid var(--appearance-soft-border,#dedbd6); }
  button { min-height:26px; padding:3px 18px; border:0; border-radius:6px; background:var(--appearance-accent,#2e7cf6); color:white; font:inherit; font-weight:600; cursor:default; }
  input:focus-visible,select:focus-visible,button:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:1px; } .clock-options-sheet:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:380px) { .body { padding:12px 14px; } .date-row { flex-wrap:wrap; gap:6px; } .date-row select { width:100%; } }
</style>
