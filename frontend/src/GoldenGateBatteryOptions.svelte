<script>
  import { tick } from 'svelte';
  let { pending, battery, execute, foreground = true } = $props();
  let panel = $state(null);
  let body = $state(null);
  let percentageInput = $state(null);
  let energySelect = $state(null);
  let focusedOptionsId = $state(null);
  let nativeWrites = 0;
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  function live() {
    return Boolean(foreground && pending && panel?.isConnected && !panel.closest('[inert]')
      && panel.getClientRects().length && panel.clientWidth > 0 && panel.clientHeight > 0
      && getComputedStyle(panel).visibility === 'visible');
  }
  function control(id) {
    return [...(panel?.querySelectorAll('[data-battery-control]') ?? [])].find(node => node.dataset.batteryControl === id) ?? null;
  }
  function fieldOf(node) { return node?.closest?.('[data-battery-control]')?.dataset.batteryControl ?? null; }
  function owned(node) {
    if (!live() || !node?.isConnected || (node !== panel && !panel.contains(node)) || node.disabled || node.closest('[inert]')
      || !node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') return false;
    const rect = node.getBoundingClientRect(), viewport = window.visualViewport;
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
  function target() { return { windowId: pending.windowId, optionsId: pending.optionsId }; }
  async function writing(apply) {
    nativeWrites++;
    try { return await apply(); }
    finally { await frame(); nativeWrites--; }
  }
  export function available(controlId) { return owned(controlId ? control(controlId) : panel); }
  export function controlIds() {
    return live() ? [...panel.querySelectorAll('[data-battery-control]')]
      .filter(node => node.isConnected && !node.disabled && node.getClientRects().length)
      .map(node => node.dataset.batteryControl) : [];
  }
  export function focusedControl() {
    const id = fieldOf(document.activeElement);
    return id && control(id) === document.activeElement && owned(document.activeElement) ? id : null;
  }
  export function focus(controlId) {
    nativeWrites++;
    try {
      if (!live()) return false;
      const root = panel, optionsId = pending.optionsId, node = control(controlId);
      if (!node?.isConnected || node.disabled || !node.getClientRects().length) return false;
      if (body?.contains(node)) {
        const rect = node.getBoundingClientRect(), clip = body.getBoundingClientRect();
        const top = clip.top + body.clientTop + 4, bottom = clip.top + body.clientTop + body.clientHeight - 4;
        body.scrollTop += rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
      }
      if (!owned(node)) return false;
      node.focus({ preventScroll: true });
      if (!live() || panel !== root || pending.optionsId !== optionsId || !owned(node)) return false;
      return document.activeElement === node && owned(node);
    } finally { nativeWrites--; }
  }
  export async function reconcile() {
    await tick();
    if (!panel?.isConnected || !pending) return false;
    if (percentageInput?.isConnected) percentageInput.checked = battery.showPercentage;
    if (energySelect?.isConnected) energySelect.value = battery.showEnergyMode;
    return true;
  }
  export function scrollTop() { return live() && body?.isConnected ? body.scrollTop : null; }
  export async function scrollTo(top) {
    if (!live() || !owned(panel) || !body?.isConnected || !Number.isFinite(top) || top < 0) return null;
    return writing(async () => {
      const root = panel, scroll = body, optionsId = pending.optionsId;
      scroll.scrollTo({ top, left: 0, behavior: 'instant' });
      await tick(); await frame();
      return live() && panel === root && body === scroll && pending.optionsId === optionsId ? scroll.scrollTop : null;
    });
  }
  async function configure(event, key) {
    const node = event.currentTarget;
    try {
      if (owned(node)) await execute({ command: 'battery.options.configure', target: target(), payload: { [key]: key === 'showPercentage' ? node.checked : node.value } });
    } finally { await reconcile(); }
  }
  function close() {
    if (!available()) return;
    return execute({ command: 'battery.options.close', target: target(), payload: {} });
  }
  function observeFocus(event) {
    const id = fieldOf(event.target);
    if (!nativeWrites && id && owned(event.target)) void execute({ command: 'battery.options.focus', target: { ...target(), control: id }, payload: { observe: true } });
  }
  function observeScroll() {
    const top = scrollTop();
    if (!nativeWrites && top !== null && available()) void execute({ command: 'battery.options.scroll', target: target(), payload: { top, observe: true } });
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
      if (sequence[next]) void execute({ command: 'battery.options.focus', target: { ...target(), control: sequence[next] }, payload: {} });
    }
  }
  $effect(() => {
    const optionsId = pending?.optionsId;
    if (!optionsId || !panel || !foreground || focusedOptionsId === optionsId) return;
    focusedOptionsId = optionsId;
    void focus('show-percentage');
  });
  $effect(() => { if (!pending) focusedOptionsId = null; });
</script>

{#if pending}
  <div class="options-sheet" bind:this={panel} role="dialog" aria-modal="true" aria-label="Options" data-battery-options data-options-id={pending.optionsId} data-window-id={pending.windowId} tabindex="-1" onkeydown={trap} onfocusin={observeFocus}>
    <div class="body" bind:this={body} data-battery-options-scroll onscroll={observeScroll}>
      <h1>Options</h1>
      <label class="percentage-row" for={`battery-percentage-${pending.optionsId}`}><span>Show Percentage</span><input id={`battery-percentage-${pending.optionsId}`} bind:this={percentageInput} type="checkbox" role="switch" aria-label="Show Percentage" data-battery-control="show-percentage" checked={battery.showPercentage} onchange={event => configure(event, 'showPercentage')} /></label>
      <label class="energy-row" for={`battery-energy-mode-${pending.optionsId}`}><span>Show Energy Mode</span><select id={`battery-energy-mode-${pending.optionsId}`} bind:this={energySelect} aria-label="Show Energy Mode" data-battery-control="show-energy-mode" value={battery.showEnergyMode} onchange={event => configure(event, 'showEnergyMode')}><option value="always">Always</option><option value="when-low-power">When Low Power Mode Is On</option><option value="never">Never</option></select></label>
    </div>
    <footer><button type="button" class="primary" data-battery-control="done" onclick={close}>Done</button></footer>
  </div>
{/if}

<style>
  .options-sheet { display:flex; flex-direction:column; box-sizing:border-box; width:min(440px,100%); max-height:min(100%,calc(100svh - 16px)); min-width:0; min-height:0; overflow:hidden; border:1px solid var(--appearance-border,#c9c6c1); border-radius:12px; box-shadow:0 18px 48px #0003; background:var(--appearance-panel,#f3f1ed); color:var(--appearance-ink,#292827); font:12px/1.4 var(--golden-gate-font,sans-serif); text-align:left; }
  .body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:14px 18px; }
  h1 { margin:0 0 14px; font-size:15px; font-weight:650; }
  label { display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; margin:12px 0; } label span { min-width:0; } .percentage-row { min-height:26px; }
  input[type='checkbox'] { flex-shrink:0; appearance:none; position:relative; width:34px; height:20px; margin:0; border:0; border-radius:12px; background:var(--appearance-menu-disabled,#979797); cursor:default; }
  input[type='checkbox']::after { content:''; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:white; box-shadow:0 1px 3px #0003; }
  input[type='checkbox']:checked { background:var(--appearance-accent,#0878ef); } input[type='checkbox']:checked::after { left:17px; }
  select { box-sizing:border-box; min-width:0; max-width:100%; min-height:28px; padding:4px 8px; border:1px solid var(--appearance-border,#c9c6c1); border-radius:6px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; }
  footer { flex-shrink:0; display:flex; justify-content:flex-end; padding:10px 12px; border-top:1px solid var(--appearance-soft-border,#dedbd6); }
  button { min-height:26px; padding:3px 18px; border:0; border-radius:6px; background:var(--appearance-accent,#2e7cf6); color:white; font:inherit; font-weight:600; cursor:default; }
  input:focus-visible,select:focus-visible,button:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:1px; } .options-sheet:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:380px) { .body { padding:12px 14px; } .energy-row { flex-wrap:wrap; gap:6px; } .energy-row select { width:100%; } }
</style>
