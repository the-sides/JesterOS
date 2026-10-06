<script>
  import { tick } from 'svelte';
  let { profile, session, execute, registerView } = $props();
  let root = $state();
  let draft = $state('');
  let acknowledged = $state(false);
  const selected = $derived(session.users.find(user => user.id === (session.phase === 'locked' ? session.activeUserId : session.selectedUserId)));
  const userList = $derived(session.phase === 'login' && session.loginView === 'users' && !session.guestConfirmation);
  const identity = $derived(`${session.phase}:${selected?.id ?? ''}:${session.guestConfirmation}:${userList}`);
  const sceneDate = $derived(new Date(profile.defaults.sceneTime));
  const dateLabel = $derived(new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(sceneDate));
  const timeLabel = $derived(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(sceneDate).replace(/\s?[AP]M$/, ''));
  function request(command, target = {}, payload = {}) { return execute({ command, target, payload }); }
  function available(element) {
    return Boolean((session.phase !== 'desktop' || session.guestConfirmation) && element?.isConnected
      && !element.disabled && !element.closest('[inert]') && element.getClientRects().length
      && getComputedStyle(element).visibility !== 'hidden');
  }
  function controls() { return [...(root?.querySelectorAll('[data-session-control]') ?? [])].filter(available); }
  function focus(controlId) {
    const element = controls().find(element => element.dataset.sessionControl === controlId);
    if (!available(element)) return false;
    element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'nearest' }); return document.activeElement === element;
  }
  $effect(() => {
    identity; draft = ''; acknowledged = false;
    tick().then(() => { if (!root?.contains(document.activeElement)) focus(session.guestConfirmation ? 'guest-end-cancel' : userList ? `user:${session.users[0].id}` : selected?.kind === 'guest' ? 'guest-acknowledge' : 'password'); });
  });
  $effect(() => {
    if (!root) return;
    return registerView?.({ kind: 'surface', focus, controlIds: () => controls().map(element => element.dataset.sessionControl), bounds: () => {
      if (!available(root)) return null;
      const rect = root.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } });
  });
  function observed(event) { const controlId = event.target.dataset.sessionControl; if (controlId && available(event.target)) request('session.focus', { controlId }); }
  function keyboard(event) {
    if (!available(root) || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (session.guestConfirmation) request('session.guest.respond', {}, { accept: false }); else if (!userList) request('session.login.back'); return; }
    const list = controls(), index = list.indexOf(document.activeElement);
    if (!list.length) return;
    let next;
    if (event.key === 'Tab') next = (index + (event.shiftKey ? -1 : 1) + list.length) % list.length;
    else if (userList && ['ArrowRight', 'ArrowDown'].includes(event.key)) next = (index + 1) % list.length;
    else if (userList && ['ArrowLeft', 'ArrowUp'].includes(event.key)) next = (index - 1 + list.length) % list.length;
    else if (userList && event.key === 'Home') next = 0;
    else if (userList && event.key === 'End') next = list.length - 1;
    else return;
    event.preventDefault(); event.stopPropagation(); focus(list[next]?.dataset.sessionControl);
  }
  async function submit(event) {
    event.preventDefault();
    if (!available(root) || selected?.kind === 'guest' && !acknowledged) return;
    await request('session.login.submit', {}, selected?.kind === 'guest' ? { acknowledgeGuest: acknowledged } : { passcode: draft });
    if (session.phase === 'desktop') { draft = ''; acknowledged = false; }
  }
</script>

<div class="golden-gate-session" class:confirmation={session.guestConfirmation} bind:this={root} data-session-surface data-os-profile={profile.id} role="dialog" aria-modal="true" aria-label={session.guestConfirmation ? 'Log out Guest User' : session.phase === 'locked' ? 'Lock Screen' : 'Login Window'} tabindex="-1" style:background-image={session.guestConfirmation ? undefined : `url("${profile.assets.wallpaper}")`} onkeydown={keyboard} onfocusin={observed}>
  <div class="content">
    {#if session.guestConfirmation}
      <div class="guest-dialog">
        <svg class="guest-symbol" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 45 42H3Z" fill="#f7c957" stroke="#b58b28" stroke-linejoin="round"/><path d="M24 17v12" stroke="#765414" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="35" r="2" fill="#765414"/></svg>
        <h1>Are you sure you want to log out?</h1>
        <p>All files and changes in this fictional Guest desktop will be deleted. Local users’ desktops will be kept.</p>
        <div class="actions"><button type="button" data-session-control="guest-end-cancel" onclick={() => request('session.guest.respond', {}, { accept: false })}>Cancel</button><button type="button" class="default" data-session-control="guest-end-confirm" onclick={() => request('session.guest.respond', {}, { accept: true })}>Delete Files and Log Out</button></div>
      </div>
    {:else}
      <div class="clock" aria-label="Fixed fictional scene time"><div class="date">{dateLabel}</div><time datetime={profile.defaults.sceneTime} class="time">{timeLabel}</time></div>
      <div class="login-area">
        {#if userList}
          <div class="user-list" aria-label="Choose a user">
            {#each session.users as user (user.id)}
              <button type="button" class="user" data-session-control={`user:${user.id}`} onclick={() => request('session.user.select', { userId: user.id })}><span class="avatar" class:casey={user.id === 'local-casey'} class:guest={user.kind === 'guest'} aria-hidden="true">{#if user.kind === 'guest'}<svg viewBox="0 0 48 48"><circle cx="24" cy="17" r="8" fill="currentColor"/><path d="M10 40v-5c0-16 28-16 28 0v5Z" fill="currentColor"/></svg>{:else}{user.id === 'local-alex' ? 'AM' : 'CR'}{/if}</span><span>{user.name}</span>{#if user.signedIn}<small>Logged in</small>{/if}</button>
            {/each}
          </div>
          <label class="fast-toggle"><input type="checkbox" data-session-control="fast-user-switching" checked={session.fastUserSwitching} onchange={(event) => request('session.fastUserSwitching.set', {}, { enabled: event.currentTarget.checked })}/>Show fast user switching menu</label>
          <p class="disclosure">Fictional local users — no host accounts or authentication.</p>
        {:else if selected}
          <form class="credential" onsubmit={submit} autocomplete="off">
            <span class="avatar" class:casey={selected.id === 'local-casey'} class:guest={selected.kind === 'guest'} aria-hidden="true">{#if selected.kind === 'guest'}<svg viewBox="0 0 48 48"><circle cx="24" cy="17" r="8" fill="currentColor"/><path d="M10 40v-5c0-16 28-16 28 0v5Z" fill="currentColor"/></svg>{:else}{selected.id === 'local-alex' ? 'AM' : 'CR'}{/if}</span>
            <h1>{#if session.phase === 'locked'}<button type="button" class="account-name" data-session-control="switch-users" onclick={() => request('session.login.back')}>{selected.name}<span aria-hidden="true">⌄</span></button>{:else}{selected.name}{/if}</h1>
            {#if selected.kind === 'guest'}
              <p class="guest-warning">Guest files are temporary and will be deleted when you log out. No password is required.</p>
              <label class="acknowledge"><input type="checkbox" data-session-control="guest-acknowledge" bind:checked={acknowledged}/>I understand that Guest data will be deleted.</label>
              <button class="guest-submit" type="submit" data-session-control={session.phase === 'locked' ? 'unlock' : 'sign-in'} disabled={!acknowledged}>{session.phase === 'locked' ? 'Unlock' : 'Log In'}</button>
            {:else}
              <div class="password-row"><input type="text" aria-label="Fictional password" aria-describedby="fictional-passcode-disclosure" name="fictional-scene-code" data-session-control="password" bind:value={draft} maxlength="5" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Enter Password"/><button type="submit" class="submit-arrow" data-session-control={session.phase === 'locked' ? 'unlock' : 'sign-in'} aria-label={session.phase === 'locked' ? 'Unlock' : 'Sign in'}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5"/></svg></button></div>
              <p id="fictional-passcode-disclosure" class="disclosure">Fictional password: scene — never enter a real password</p>
            {/if}
            {#if session.loginError}<p class="error" role="alert">{session.loginError}</p>{/if}
            {#if session.phase !== 'locked'}<button type="button" class="switch" data-session-control="back" onclick={() => request('session.login.back')}>Back</button>{/if}
          </form>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .golden-gate-session { position: absolute; inset: 0; z-index: 20000; overflow: auto; overscroll-behavior: contain; background-position: center; background-size: cover; color: white; font: 13px var(--golden-gate-font, sans-serif); text-shadow: 0 1px 3px #0006; }
  .golden-gate-session::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(#00000012, #00000024); }
  .content { position: relative; box-sizing: border-box; min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 50px 16px 55px; gap: 80px; }
  .clock { text-align: center; }
  .date { font-size: 23px; font-weight: 650; }
  .time { display: block; font-size: clamp(64px, 10vw, 108px); font-weight: 720; letter-spacing: -4px; line-height: 1.2; color: #fffdf3e8; text-shadow: 0 3px 20px #30281822; }
  .login-area { display: flex; flex-direction: column; align-items: center; width: 100%; }
  .user-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 24px; max-width: 600px; }
  .user { display: flex; flex-direction: column; align-items: center; gap: 9px; width: 130px; background: transparent; border: 0; color: white; font: inherit; padding: 8px; border-radius: 18px; }
  .avatar { width: 78px; height: 78px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: radial-gradient(ellipse at 30% 12%, #efd1a0, #ba8050 50%, #70594d); box-shadow: inset 0 1px 2px #fff8, 0 0 0 1px #fff4, 0 3px 10px #0003; color: #fff; font-size: 23px; text-shadow: none; }
  .avatar.casey { background: radial-gradient(ellipse at 30% 12%, #b9dbd6, #6194a4 50%, #334c68); }
  .avatar.guest { background: linear-gradient(#bdc2ca, #737e8e); }
  .avatar svg { width: 68%; height: 68%; }
  .user small { font-size: 11px; opacity: .8; }
  button, input { font: inherit; }
  button { cursor: default; }
  button:focus-visible, input:focus-visible { outline: 3px solid #a4d1ff; outline-offset: 3px; }
  .fast-toggle { margin-top: 25px; display: flex; align-items: center; gap: 7px; }
  .disclosure { font-size: 11px; text-align: center; max-width: 285px; line-height: 1.5; color: #fffc; }
  .credential { display: flex; flex-direction: column; align-items: center; width: min(340px, 100%); }
  .credential .avatar { width: 52px; height: 52px; font-size: 17px; }
  h1 { font-size: 15px; font-weight: 600; margin: 10px 0 14px; }
  .account-name { color: inherit; font: inherit; border: 0; background: transparent; padding: 2px 8px; border-radius: 8px; }
  .account-name span { margin-left: 8px; opacity: .45; }
  .account-name:hover span, .account-name:focus span { opacity: 1; }
  .password-row { display: flex; align-items: center; gap: 8px; }
  .password-row input { width: 190px; height: 34px; box-sizing: border-box; border: 1px solid #ffffff40; border-radius: 22px; background: #f2efea29; color: white; padding: 5px 13px; backdrop-filter: blur(20px); box-shadow: inset 0 1px 1px #ffffff38, 0 1px 3px #0002; -webkit-text-security: disc; text-shadow: none; }
  .password-row input::placeholder { color: #fff; -webkit-text-security: none; }
  .submit-arrow { display: grid; place-items: center; background: #ffffff26; color: white; border: 1px solid #ffffff85; width: 29px; height: 29px; border-radius: 50%; padding: 5px; box-shadow: inset 0 1px 1px #fff4; }
  .submit-arrow svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .switch { background: #ffffff1f; color: white; border: 1px solid #ffffff30; border-radius: 18px; margin-top: 18px; padding: 6px 20px; }
  .guest-warning { text-align: center; line-height: 1.5; }
  .acknowledge { display: flex; align-items: start; gap: 6px; font-size: 12px; line-height: 1.5; }
  .guest-submit { margin-top: 16px; border: 1px solid #ffffff65; border-radius: 20px; color: white; background: #ffffff30; padding: 7px 24px; }
  button:disabled { opacity: .4; }
  .error { text-align: center; color: #ffe6cd; max-width: 100%; }
  .confirmation { background: #0004; }
  .confirmation::before { background: transparent; }
  .confirmation .content { justify-content: center; gap: 0; }
  .guest-dialog { width: min(390px, 100%); box-sizing: border-box; border-radius: 22px; padding: 25px; border: 1px solid var(--appearance-menu-border, #ffffffa0); color: var(--appearance-ink, #222); background: var(--appearance-menu-bg, #f4f0e9ed); backdrop-filter: blur(28px) saturate(1.35); box-shadow: inset 0 1px 1px #fffa, 0 16px 45px #0005; text-shadow: none; text-align: center; }
  .guest-dialog h1 { margin-top: 14px; font-weight: 650; }
  .guest-dialog p { font-size: 12px; line-height: 1.5; }
  .guest-symbol { display: block; margin: auto; width: 48px; height: 48px; }
  .actions { display: flex; justify-content: end; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  .actions button { background: var(--appearance-card, #ffffffa0); color: inherit; border: 1px solid var(--appearance-border, #bbb8); border-radius: 18px; padding: 7px 14px; }
  .actions .default { background: var(--appearance-accent, #0878ef); color: var(--appearance-accent-ink, white); border-color: transparent; }
  @media (max-height: 400px), (max-width: 390px) { .content { justify-content: start; padding: 20px 12px; gap: 28px; } .time { font-size: 62px; } .date { font-size: 17px; } .avatar { width: 62px; height: 62px; } .user-list { gap: 8px; } .user { width: 120px; } }
</style>
