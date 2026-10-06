<script>
  import { onMount, tick } from 'svelte';

  let { profile, power, session, clockContext, execute, registerView } = $props();
  let root = $state();
  let activationPending = false;
  let lastPointer = null;
  const confirmation = $derived(power.pending !== null);
  const actionLabel = $derived(power.pending?.action === 'restart' ? 'Restart' : 'Shut Down');
  const guestData = $derived(session.users.some(user => user.kind === 'guest' && user.signedIn));
  const identity = $derived(`${profile.id}:${power.phase}:${power.pending?.action ?? ''}`);
  const sceneDate = $derived(new Date(clockContext.sceneTime));
  const dateLabel = $derived(new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: clockContext.timeZone }).format(sceneDate));
  const timeLabel = $derived(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: clockContext.use24Hour ? 'h23' : 'h12', timeZone: clockContext.timeZone }).format(sceneDate).replace(/\s?[AP]M$/, ''));
  const drift = $derived(`translate(${Math.sin(power.elapsedSeconds / 43) * 3.2}%, ${Math.sin(power.elapsedSeconds / 61) * 2.2}%)`);
  const progress = $derived(Math.round(power.startupProgress * 100));
  const surfaceLabel = $derived(confirmation ? `${actionLabel} confirmation` : power.phase === 'saver' ? 'Screen Saver' : power.phase === 'sleeping' ? 'Sleeping fictional Mac' : power.phase === 'off' ? 'Powered-off fictional Mac' : 'Starting fictional Mac');

  function request(command, target = {}, payload = {}) { return execute({ command, target, payload }); }
  function presented() { return profile.id === 'macos-golden-gate-27.0.1' && (power.phase !== 'awake' || confirmation); }
  function available(element) {
    if (!presented() || !root?.isConnected || !element?.isConnected || !root.contains(element)
      || element.disabled || element.getAttribute('aria-disabled') === 'true' || element.closest('[inert], [hidden]')
      || !element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function controls() {
    if (!root) return [];
    const candidates = [...root.querySelectorAll('[data-power-control]')];
    if (root.dataset.powerControl) candidates.unshift(root);
    return candidates.filter(available);
  }
  function focus(controlId) {
    const element = controls().find(control => control.dataset.powerControl === controlId);
    if (!available(element)) return false;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest' });
    return document.activeElement === element;
  }
  function preferredControl() { return confirmation ? 'cancel' : power.phase === 'off' ? 'start' : power.phase === 'booting' ? 'surface' : 'wake'; }
  function consume(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function observed(event) {
    const element = event.target;
    if (element?.dataset.powerControl && available(element)) request('power.focus', { controlId: element.dataset.powerControl });
  }
  function keyboard(event) {
    if (!available(root) || event.isComposing) return;
    if (confirmation && event.key === 'Escape') { consume(event); respond(false); return; }
    if (confirmation && event.key === 'Enter') {
      event.stopImmediatePropagation();
      if (!(event.target instanceof HTMLButtonElement) || event.repeat) event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    consume(event);
    const list = controls(), index = list.indexOf(document.activeElement);
    if (!list.length) return;
    const next = index < 0 ? event.shiftKey ? list.length - 1 : 0 : (index + (event.shiftKey ? -1 : 1) + list.length) % list.length;
    focus(list[next].dataset.powerControl);
  }
  async function activate(command) {
    if (activationPending) return;
    activationPending = true;
    try { await request(command); } finally { activationPending = false; }
  }
  function wakeOrStart(event) {
    consume(event);
    if (confirmation || !available(event.currentTarget)) return;
    if (power.phase === 'saver' || power.phase === 'sleeping') activate('power.wake');
    else if (power.phase === 'off') activate('power.start');
  }
  function mouseWake(event) {
    if (confirmation || power.phase !== 'saver' || event.pointerType !== 'mouse' || !available(root)) return;
    const moved = (event.movementX ?? 0) !== 0 || (event.movementY ?? 0) !== 0
      || lastPointer !== null && (lastPointer.x !== event.clientX || lastPointer.y !== event.clientY);
    lastPointer = { x: event.clientX, y: event.clientY };
    if (!moved) return;
    consume(event);
    activate('power.wake');
  }
  async function respond(accept) {
    if (!confirmation || activationPending || !available(controls().find(control => control.dataset.powerControl === (accept ? 'confirm' : 'cancel')))) return;
    activationPending = true;
    try { await request('power.respond', {}, { accept }); } finally { activationPending = false; }
  }
  async function configurePower(event) {
    const input = event.currentTarget;
    try { await request('power.configure', {}, { reopenWindows: input.checked }); }
    finally { await tick(); input.checked = power.pending?.reopenWindows ?? false; }
  }
  $effect(() => {
    const stamp = identity;
    lastPointer = null;
    let cancelled = false;
    tick().then(() => { if (!cancelled && stamp === identity && available(root)) focus(preferredControl()); });
    return () => { cancelled = true; };
  });
  onMount(() => {
    const unregister = registerView?.({ focus, controlIds: () => controls().map(control => control.dataset.powerControl), bounds: () => {
      if (!available(root)) return null;
      const rect = root.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } });
    function containFocus(event) {
      if (available(root) && !root.contains(event.target)) focus(preferredControl());
    }
    document.addEventListener('focusin', containFocus);
    return () => { unregister?.(); document.removeEventListener('focusin', containFocus); };
  });
</script>

<!-- Original/source-informed presentation, not native pixel measurements or firmware.
  Saver imagery: https://support.apple.com/guide/mac-help/use-a-screen-saver-mchl4b68853d/27/mac/27
  Boot layout: https://support.apple.com/en-us/102675 (hardware-neutral, not Golden Gate factory UI).
  The existing original wallpaper and the independently drawn symbol below are runtime artwork;
  no Apple reference screenshot is redistributed. All motion/progress uses canonical power state. -->
<div class="golden-gate-power" class:confirmation class:saver={power.phase === 'saver' && !confirmation} bind:this={root}
  data-power-surface data-os-profile={profile.id} data-power-phase={power.phase}
  data-power-control={power.phase === 'booting' && !confirmation ? 'surface' : undefined}
  role="dialog" aria-modal="true" aria-label={surfaceLabel}
  aria-labelledby={confirmation ? 'power-confirm-title' : undefined} aria-describedby={confirmation ? 'power-confirm-policy' : undefined}
  tabindex="-1" onkeydown={keyboard} onfocusin={observed} onpointermove={mouseWake}>
  {#if confirmation}
    <div class="confirmation-frame">
      <section class="power-dialog">
        <div class="dialog-body">
          <div class="dialog-symbol" aria-hidden="true">
            <svg viewBox="0 0 72 88"><path d="M38 22c-1-9 5-17 15-19 1 9-5 17-15 19Zm-2 9c-7 0-10-5-18-3C5 31 3 43 7 56c3 11 11 25 18 26 5 1 7-3 12-3s8 4 13 3c7-2 14-13 17-22-10-4-14-17-3-25-5-8-13-10-20-6-3 1-5 2-8 2Z" fill="currentColor"/></svg>
          </div>
          <h1 id="power-confirm-title">Are you sure you want to {power.pending.action === 'restart' ? 'restart' : 'shut down'} your computer now?</h1>
          <p id="power-confirm-policy">Local documents and autosaved Notes and Services changes are kept. This simulation applies the window choice to every retained local user’s desktop, not just the current user. It does not operate the device or model native multi-user power behavior.</p>
          <label class="reopen-choice"><input type="checkbox" id="reopen-windows" data-power-control="reopen-windows" checked={power.pending.reopenWindows} onchange={configurePower}/>Reopen windows when logging back in</label>
          <p class="exit-policy">The choice changes windows, not document records. Complete or cancel unfinished export and settings workflows first. Cancel leaves saved reopen preferences unchanged.</p>
          {#if guestData}<p class="guest-warning">All files and changes in this fictional Guest desktop will be deleted.</p>{/if}
        </div>
        <div class="actions">
          <button type="button" data-power-control="cancel" onclick={(event) => { consume(event); respond(false); }}>Cancel</button>
          <button type="button" class="default" data-power-control="confirm" onclick={(event) => { consume(event); respond(true); }}>{actionLabel}</button>
        </div>
      </section>
    </div>
  {:else if power.phase === 'saver'}
    <div class="saver-art" aria-hidden="true" style:background-image={`url("${profile.assets.wallpaper}")`} style:transform={drift}></div>
    <div class="clock" aria-label="Shared fictional scene time">
      <div class="date">{dateLabel}</div>
      <time datetime={sceneDate.toISOString()} class="time">{timeLabel}</time>
    </div>
    <button type="button" class="blank-control" data-power-control="wake" aria-label={`Stop screen saver and show the fictional ${session.phase === 'locked' ? 'Lock Screen' : 'Login Window'}`} onclick={wakeOrStart} onpointerdown={consume}></button>
  {:else if power.phase === 'sleeping' || power.phase === 'off'}
    <button type="button" class="blank-control" data-power-control={power.phase === 'off' ? 'start' : 'wake'}
      aria-label={power.phase === 'off' ? 'Start this fictional Mac — simulated power button' : `Wake this fictional Mac to the ${session.phase === 'locked' ? 'Lock Screen' : 'Login Window'}`} onclick={wakeOrStart} onpointerdown={consume}></button>
  {:else if power.phase === 'booting'}
    <svg class="startup-symbol" viewBox="0 0 72 88" aria-hidden="true"><path d="M38 22c-1-9 5-17 15-19 1 9-5 17-15 19Zm-2 9c-7 0-10-5-18-3C5 31 3 43 7 56c3 11 11 25 18 26 5 1 7-3 12-3s8 4 13 3c7-2 14-13 17-22-10-4-14-17-3-25-5-8-13-10-20-6-3 1-5 2-8 2Z" fill="currentColor"/></svg>
    <div class="startup-progress" role="progressbar" aria-label="Fictional startup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress} aria-valuetext={`${progress}% — five-second simulated startup`}><div class="startup-fill" style:width={`${power.startupProgress * 100}%`}></div></div>
    <p class="visually-hidden">Simulated startup. No installation, firmware or recovery is performed. Local users’ documents remain in this page; windows reopen after sign-in only if chosen.</p>
  {/if}
</div>

<style>
  .golden-gate-power { position: absolute; inset: 0; z-index: 21000; box-sizing: border-box; overflow: hidden; overscroll-behavior: contain; background: #000; color: #fff; font: 13px var(--golden-gate-font, sans-serif); isolation: isolate; outline: none; }
  .saver { cursor: none; }
  .saver-art { position: absolute; inset: -6%; background-position: center; background-size: cover; transition: transform 1s linear; pointer-events: none; }
  .saver-art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(#00000010, #00000028); }
  .clock { position: relative; width: 100%; box-sizing: border-box; padding: clamp(20px, 6vh, 60px) 12px 0; text-align: center; pointer-events: none; text-shadow: 0 2px 16px #30281835; }
  .date { font-size: clamp(17px, 2.2vw, 23px); font-weight: 650; }
  .time { display: block; font-size: clamp(60px, 10vw, 108px); font-weight: 720; letter-spacing: -4px; line-height: 1.2; color: #fffdf3e8; }
  .blank-control { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; color: transparent; outline: none; cursor: none; -webkit-tap-highlight-color: transparent; }
  .startup-symbol { position: absolute; top: 50%; left: 50%; width: clamp(48px, 8vw, 76px); height: auto; transform: translate(-50%, -50%); color: #fff; }
  .startup-progress { position: absolute; left: 50%; bottom: 9.5%; transform: translateX(-50%); width: min(235px, 62%); height: 6px; box-sizing: border-box; overflow: hidden; border: 1px solid #484848; border-radius: 5px; background: #242424; }
  .startup-fill { height: 100%; border-radius: inherit; background: #d5d5d5; }
  .confirmation { background: #0004; }
  .confirmation-frame { display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; padding: 16px; }
  .power-dialog { display: flex; flex-direction: column; flex-shrink: 0; box-sizing: border-box; width: min(390px, 100%); max-height: 100%; min-height: 0; border: 1px solid var(--appearance-menu-border, #ffffffa0); border-radius: 22px; background: var(--appearance-menu-bg, #f4f0e9ed); color: var(--appearance-ink, #222); backdrop-filter: blur(28px) saturate(1.35); box-shadow: inset 0 1px 1px #fffa, 0 16px 45px #0005; text-align: center; }
  .dialog-body { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 24px 24px 0; overflow-wrap: anywhere; }
  .dialog-symbol { display: grid; place-items: center; width: 52px; height: 52px; margin: 0 auto 14px; border-radius: 13px; color: #fff; background: linear-gradient(145deg, #565a65, #292c34); box-shadow: inset 0 1px 1px #fff5, 0 2px 5px #0002; }
  .dialog-symbol svg { width: 28px; height: 34px; }
  h1 { margin: 0 0 12px; font-size: 15px; line-height: 1.4; font-weight: 650; }
  .dialog-body p { margin: 0 0 14px; font-size: 12px; line-height: 1.5; }
  .guest-warning { font-weight: 600; }
  .reopen-choice { display: flex; align-items: start; gap: 7px; margin-bottom: 14px; text-align: left; font-size: 12px; line-height: 1.5; }
  .reopen-choice input { flex-shrink: 0; margin: 3px 0 0; accent-color: var(--appearance-accent, #0878ef); }
  .reopen-choice input:focus-visible { outline: 3px solid var(--appearance-focus, #a4d1ff); outline-offset: 2px; }
  .dialog-body .exit-policy { text-align: left; }
  .actions { display: flex; justify-content: end; flex-wrap: wrap; flex-shrink: 0; gap: 8px; padding: 10px 20px 20px; }
  .actions button { max-width: 100%; overflow-wrap: anywhere; min-width: min(84px, 100%); min-height: 32px; padding: 6px 14px; border: 1px solid var(--appearance-border, #bbb8); border-radius: 18px; background: var(--appearance-card, #ffffffa0); color: inherit; font: inherit; cursor: default; }
  .actions .default { border-color: transparent; background: var(--appearance-accent, #0878ef); color: var(--appearance-accent-ink, white); }
  .actions button:focus-visible { outline: 3px solid var(--appearance-focus, #a4d1ff); outline-offset: 2px; }
  .actions button:active { filter: brightness(.9); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (max-height: 400px), (max-width: 390px) { .confirmation-frame { padding: 8px; } .dialog-body { padding: 16px 16px 0; } .dialog-symbol { width: 40px; height: 40px; margin-bottom: 10px; } .dialog-symbol svg { width: 23px; height: 28px; } .actions { padding: 8px 12px 12px; } .clock { padding-top: 20px; } }
  @media (prefers-reduced-motion: reduce) { .saver-art { transition: none; } }
</style>
