<script>
  import { tick } from 'svelte';
  let { pending, execute, foreground = true } = $props();
  let panel = $state(null);
  let nameInput = $state(null);
  let securitySelect = $state(null);
  let passwordInput = $state(null);
  let focusedJoinId = $state(null);
  let security = $state('password');
  const hidden = $derived(pending?.kind === 'hidden');
  const live = $derived(foreground && panel?.isConnected && Boolean(pending) && !panel?.closest('[inert]') && panel?.getClientRects().length && panel?.clientWidth > 0 && panel?.clientHeight > 0);
  function control(id) {
    return panel?.querySelector(`[data-wifi-control="${id}"]`) ?? null;
  }
  function fieldOf(node) {
    return node?.closest?.('[data-wifi-control]')?.dataset.wifiControl ?? null;
  }
  function owned(node) {
    if (!live || !node?.isConnected || node.disabled || node.closest('[inert]')
      || !node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') return false;
    const rect = node.getBoundingClientRect(), viewport = window.visualViewport;
    let left = Math.max(rect.left, viewport?.offsetLeft ?? 0), top = Math.max(rect.top, viewport?.offsetTop ?? 0);
    let right = Math.min(rect.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth));
    let bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight));
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (style.visibility !== 'visible' || style.opacity === '0') return false;
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
    return hit === node || node.contains(hit);
  }
  function changeSecurity(event) {
    security = event.currentTarget.value;
    if (security === 'open' && passwordInput) passwordInput.value = '';
  }
  function cancel() {
    if (!live || !pending) return;
    return execute({ command: 'wifi.join.cancel', target: { joinId: pending.joinId }, payload: {} });
  }
  function submit() {
    if (!live || !pending) return;
    const password = hidden && securitySelect?.value === 'open' ? '' : passwordInput?.value ?? '';
    const payload = hidden
      ? { networkName: nameInput?.value ?? '', security: securitySelect?.value === 'open' ? 'open' : 'password', password }
      : { password };
    return execute({ command: 'wifi.join.submit', target: { joinId: pending.joinId }, payload });
  }
  function order() {
    return ['network-name', 'security', 'password', 'cancel', 'join'].filter(id => {
      const node = control(id);
      return node?.isConnected && !node.disabled && node.getClientRects().length;
    });
  }
  function trap(event) {
    if (!live) return;
    const target = fieldOf(event.target);
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) { if (event.key === 'Enter') event.preventDefault(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); return; }
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (target === 'cancel') cancel();
      else submit();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault(); event.stopImmediatePropagation();
      const sequence = order();
      if (target === null) return control(sequence[event.shiftKey ? sequence.length - 1 : 0])?.focus();
      const index = sequence.indexOf(target);
      if (event.shiftKey && index <= 0) control(sequence[sequence.length - 1])?.focus();
      else if (!event.shiftKey && index === sequence.length - 1) control(sequence[0])?.focus();
      else control(sequence[event.shiftKey ? index - 1 : index + 1])?.focus();
    }
  }
  $effect(() => {
    const joinId = pending?.joinId;
    if (!joinId) return;
    if (!panel) { void tick(); return; }
    if (focusedJoinId === joinId) return;
    focusedJoinId = joinId;
    void tick().then(() => { (hidden ? nameInput : passwordInput)?.focus(); });
  });
  $effect(() => { if (!pending && focusedJoinId) focusedJoinId = null; });

  export function element() { return panel; }
  export function available(controlId) {
    return controlId ? owned(control(controlId)) : owned(panel);
  }
  export function controlIds() {
    return live ? order() : [];
  }
  export function focusedControl() {
    if (!live) return null;
    const target = fieldOf(document.activeElement);
    return target && control(target) === document.activeElement ? target : null;
  }
  export async function focus(controlId) {
    if (!controlId) return false;
    await tick();
    if (!live) return false;
    const node = control(controlId);
    if (!node?.isConnected || node.disabled || !node.getClientRects().length) return false;
    node.focus({ preventScroll: true }); node.scrollIntoView({ block: 'nearest' });
    await tick();
    return document.activeElement === node && owned(node);
  }
  export function draft() {
    if (!panel?.isConnected || !passwordInput) return null;
    const values = { password: passwordInput.value };
    if (hidden) { values.networkName = nameInput?.value ?? ''; values.security = securitySelect?.value === 'open' ? 'open' : 'password'; }
    else { values.security = null; values.networkName = null; }
    return values;
  }
  export function scrollTop() { return live ? panel.querySelector('[data-wifi-join-scroll]')?.scrollTop ?? null : null; }
  export async function scrollTo(top) {
    if (!live || !Number.isFinite(top) || top < 0) return null;
    const node = panel.querySelector('[data-wifi-join-scroll]');
    node?.scrollTo({ top, left: 0, behavior: 'instant' });
    await tick();
    return live && node?.isConnected ? node.scrollTop : null;
  }
  export async function setDraft(draft) {
    await tick();
    if (!live || !owned(control('cancel')) || !owned(control('join')) || !passwordInput) return false;
    if (hidden) {
      if (typeof draft.networkName === 'string' && nameInput?.value !== draft.networkName) nameInput.value = draft.networkName;
      if (draft.security === 'open' || draft.security === 'password') {
        security = draft.security;
        if (securitySelect?.value !== draft.security) securitySelect.value = draft.security;
        if (draft.security === 'open') { if (passwordInput.value !== '') passwordInput.value = ''; }
        else if (typeof draft.password === 'string' && passwordInput.value !== draft.password) passwordInput.value = draft.password;
      }
    } else if (typeof draft.password === 'string' && passwordInput.value !== draft.password) passwordInput.value = draft.password;
    return true;
  }
</script>

{#if pending}
  <div class="join-sheet" bind:this={panel} role="dialog" aria-modal="true" aria-label={hidden ? 'Join other network' : `Join “${pending.name}”`}
    data-wifi-join data-join-id={pending.joinId} tabindex="-1" onkeydown={trap}>
    <div class="body" data-wifi-join-scroll>
      <header><h1>{hidden ? 'Join Other Network' : `Join “${pending.name}”`}</h1></header>
      {#if hidden}
        <label for={`wifi-join-name-${pending.joinId}`}>Network Name</label>
        <input id={`wifi-join-name-${pending.joinId}`} bind:this={nameInput} data-wifi-control="network-name" maxlength="256" autocomplete="off" spellcheck="false" />
        <label for={`wifi-join-sec-${pending.joinId}`}>Security</label>
        <select id={`wifi-join-sec-${pending.joinId}`} bind:this={securitySelect} data-wifi-control="security" onchange={changeSecurity}>
          <option value="password">WPA/WPA2 Personal</option>
          <option value="open">None (open)</option>
        </select>
        <label hidden={security === 'open'} for={`wifi-join-pass-${pending.joinId}`}>Password</label>
        <input hidden={security === 'open'} disabled={security === 'open'} id={`wifi-join-pass-${pending.joinId}`} bind:this={passwordInput} data-wifi-control="password" type="password" autocomplete="off" maxlength="63" />
      {:else}
        <label for={`wifi-join-pass-${pending.joinId}`}>Password</label>
        <input id={`wifi-join-pass-${pending.joinId}`} bind:this={passwordInput} data-wifi-control="password" type="password" autocomplete="off" maxlength="63" />
      {/if}
      {#if pending.error}<p class="error" role="alert">{pending.error}</p>{/if}
      <p class="boundary">Fictional Wi-Fi only. Default secured fixtures use “scene”; use the fictional password supplied by the scene author. Never enter a real credential.</p>
    </div>
    <footer>
      <button type="button" data-wifi-control="cancel" onclick={cancel}>Cancel</button>
      <button type="button" class="primary" data-wifi-control="join" onclick={submit}>Join</button>
    </footer>
  </div>
{/if}

<style>
  .join-sheet { display:flex; flex-direction:column; box-sizing:border-box; width:min(400px,100%); max-height:100%; min-height:0; overflow:hidden; border:1px solid var(--appearance-border,#c9c6c1); border-radius:12px; box-shadow:0 18px 48px #0003; background:var(--appearance-panel,#f3f1ed); color:var(--appearance-ink,#292827); font:12px/1.4 var(--golden-gate-font,sans-serif); text-align:left; }
  .body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:14px 18px; }
  h1 { margin:0 0 12px; font-size:15px; font-weight:650; overflow-wrap:anywhere; }
  label { display:block; margin:10px 0 4px; font-weight:600; } label:first-of-type { margin-top:0; }
  input,select { box-sizing:border-box; width:100%; min-height:28px; padding:4px 8px; border:1px solid var(--appearance-border,#c9c6c1); border-radius:6px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; }
  .error { margin:10px 0 0; padding:2px 0 2px 10px; color:#c04a40; font-size:11px; font-weight:600; border-left:3px solid #c04a40; overflow-wrap:anywhere; }
  .boundary { margin:12px 0 0; font-size:10px; opacity:.7; }
  footer { flex-shrink:0; display:flex; justify-content:flex-end; gap:8px; padding:10px 12px; border-top:1px solid var(--appearance-soft-border,#dedbd6); }
  button { min-height:26px; padding:3px 14px; border:1px solid var(--appearance-border,#cbc7c0); border-radius:6px; background:var(--appearance-surface,#fff); color:inherit; font:inherit; cursor:default; }
  button:disabled { opacity:.5; }
  .primary { border:0; background:var(--appearance-accent,#2e7cf6); color:white; font-weight:600; }
  input:focus-visible,select:focus-visible,button:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:1px; }
  .join-sheet:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
</style>
