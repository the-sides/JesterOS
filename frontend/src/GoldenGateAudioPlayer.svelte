<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { AUDIO_FIXTURES } from './audio-fixtures.js';
  import { soundGain, soundSummary } from './sound-model.js';

  let { profile, window, sound, execute, registerView, foreground = true, preview = false, playback = null } = $props();
  let panel = $state(null), body = $state(null), audio = $state(null);
  let positionInput = $state(null), volumeInput = $state(null);
  let media = $state(null), playbackError = $state(null), commandError = $state(null);
  let lifetime = null, disposed = false, nativeWrites = 0, playbackEpoch = 0, scrubbing = false;
  const pendingSeeks = new Set();
  const ids = ['play-pause', 'position', 'volume', 'sound-settings'];
  const fixture = $derived(AUDIO_FIXTURES[window.appId]);
  const isMusic = $derived(window.appId === 'music');
  const playerVolume = $derived(sound.appVolumes[window.appId]);
  const viewState = $derived(preview ? playback : media);
  const duration = $derived(viewState?.duration ?? null);
  const position = $derived(viewState?.position ?? 0);
  const playing = $derived(viewState?.playing === true);
  const error = $derived(playbackError ?? commandError ?? viewState?.error ?? null);
  const inputId = control => `sound-media-${control}-${window.id}${preview ? '-preview' : ''}`;
  const time = value => {
    if (value === null || !Number.isFinite(value)) return '–:––';
    const seconds = Math.floor(Math.max(0, value));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  function retained(owner = lifetime) {
    if (!owner || disposed || window !== owner.window || window.id !== owner.windowId || window.appId !== owner.appId
      || window.utilityKind || profile.id !== 'macos-golden-gate-27.0.1' || panel !== owner.panel || body !== owner.body || audio !== owner.audio
      || !panel?.isConnected || !body?.isConnected || !audio?.isConnected || !panel.contains(audio)
      || audio.getAttribute('src') !== owner.fixture.src || panel.dataset.windowId !== owner.windowId
      || panel.dataset.soundPlayer !== owner.appId) return false;
    return owner.root.isConnected && owner.frame.isConnected && panel.closest('[data-session-scene]') === owner.root
      && panel.closest('.managed-window[data-window-id]') === owner.frame && owner.frame.dataset.windowId === owner.windowId;
  }
  function visible(node) {
    if (!retained() || !foreground || !node?.isConnected || !panel.contains(node) && node !== panel
      || node.disabled || node.matches(':disabled') || !node.getClientRects().length) return false;
    const realm = node.ownerDocument.defaultView, viewport = realm?.visualViewport;
    if (!realm) return false;
    const rect = node.getBoundingClientRect();
    let left = Math.max(rect.left, viewport?.offsetLeft ?? 0), top = Math.max(rect.top, viewport?.offsetTop ?? 0);
    let right = Math.min(rect.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? realm.innerWidth));
    let bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? realm.innerHeight));
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.inert || ancestor.hasAttribute('inert')) return false;
      const style = realm.getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
      if (ancestor === node) continue;
      const clip = ancestor.getBoundingClientRect();
      if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
        left = Math.max(left, clip.left + ancestor.clientLeft);
        right = Math.min(right, clip.left + ancestor.clientLeft + ancestor.clientWidth);
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
        top = Math.max(top, clip.top + ancestor.clientTop);
        bottom = Math.min(bottom, clip.top + ancestor.clientTop + ancestor.clientHeight);
      }
    }
    if (right <= left || bottom <= top) return false;
    const hit = node.ownerDocument.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  }
  function control(id) {
    return ids.includes(id) ? [...(panel?.querySelectorAll('[data-sound-media-control]') ?? [])]
      .find(node => node.dataset.soundMediaControl === id) ?? null : null;
  }
  function available(id) { return visible(id ? control(id) : panel); }
  function controlIds() {
    return available() ? ids.filter(id => available(id)) : [];
  }
  function focusedControl() {
    const node = panel?.ownerDocument.activeElement, id = node?.dataset.soundMediaControl;
    return id && control(id) === node && available(id) ? id : null;
  }
  function focus(id) {
    const owner = lifetime, node = control(id);
    if (!retained(owner) || !available() || !node?.isConnected || node.disabled) return false;
    nativeWrites++;
    try {
      if (body.contains(node)) {
        const rect = node.getBoundingClientRect(), clip = body.getBoundingClientRect();
        const top = clip.top + body.clientTop + 4, bottom = top + body.clientHeight - 8;
        const left = clip.left + body.clientLeft + 4, right = left + body.clientWidth - 8;
        body.scrollTop += rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
        body.scrollLeft += rect.left < left ? rect.left - left : rect.right > right ? rect.right - right : 0;
      }
      if (!available(id)) return false;
      node.focus({ preventScroll: true });
      return retained(owner) && available(id) && node.ownerDocument.activeElement === node;
    } finally { nativeWrites--; }
  }
  function mediaError() {
    const native = audio?.error;
    if (!native) return null;
    const reasons = { 1: 'Audio loading was aborted.', 2: 'The local audio could not be loaded.',
      3: 'The browser could not decode this PCM WAV cue.', 4: 'This browser does not support the supplied audio format.' };
    return native.message || reasons[native.code] || 'The browser reported an audio playback error.';
  }
  function snapshot() {
    if (!retained()) return null;
    const actualDuration = Number.isFinite(audio.duration) && audio.duration >= 0 ? audio.duration : null;
    return { windowId: lifetime.windowId, appId: lifetime.appId, trackId: lifetime.fixture.id,
      playing: !audio.paused && !audio.ended, paused: audio.paused, ended: audio.ended,
      position: audio.currentTime, duration: actualDuration, volume: audio.volume, muted: audio.muted,
      ready: audio.readyState >= 1 && actualDuration !== null, error: mediaError() ?? playbackError };
  }
  function refresh() {
    const actual = snapshot();
    if (actual) {
      media = actual;
      if (!scrubbing && positionInput?.isConnected) positionInput.value = String(actual.position);
    }
    return actual;
  }
  function observe(event) {
    if (event && event.currentTarget !== lifetime?.audio || !retained()) return;
    refresh();
    // Values never travel in the request: the controller reads this actual facade.
    void execute({ command: 'sound.media.observe', target: { windowId: lifetime.windowId }, payload: {} });
  }
  function applySound(value) {
    if (!retained()) return false;
    const summary = soundSummary({ outputDeviceId: value.outputDeviceId, inputDeviceId: value.inputDeviceId,
      outputs: value.outputs, inputs: value.inputs, showInMenuBar: value.showInMenuBar,
      showWhen: value.showWhen, appVolumes: value.appVolumes });
    const gain = soundGain(summary, lifetime.appId);
    if (audio.volume !== gain) audio.volume = gain;
    if (audio.muted !== summary.effectiveMuted) audio.muted = summary.effectiveMuted;
    refresh();
    return true;
  }
  function cancelSeeks() {
    for (const cancel of [...pendingSeeks]) cancel();
  }
  function pause() {
    if (!retained()) return false;
    playbackEpoch++;
    cancelSeeks();
    audio.pause();
    refresh();
    return audio.paused;
  }
  async function play() {
    const owner = lifetime;
    if (!retained(owner) || !available('play-pause')) throw new Error('The original audio player is not available.');
    const generation = ++playbackEpoch;
    cancelSeeks();
    playbackError = null; commandError = null;
    applySound(sound);
    try {
      await owner.audio.play();
      if (!retained(owner) || generation !== playbackEpoch || !available('play-pause')) {
        if (!retained(owner) || generation === playbackEpoch) owner.audio.pause();
        throw new Error('Playback was interrupted because the original audio player is no longer available.');
      }
      const actual = refresh();
      if (!actual?.playing || actual.paused) throw new Error('The browser did not begin audio playback.');
      return actual;
    } catch (failure) {
      if (!retained(owner) || generation === playbackEpoch) owner.audio.pause();
      if (retained(owner) && generation === playbackEpoch) {
        playbackError = typeof failure?.message === 'string' && failure.message ? failure.message : 'The browser rejected audio playback.';
        refresh();
      }
      throw failure;
    }
  }
  async function seek(seconds) {
    const owner = lifetime, actual = snapshot();
    if (!retained(owner) || !available('position') || !actual?.ready || actual.duration === null)
      throw new Error('Audio metadata is not available for seeking.');
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > actual.duration)
      throw new Error('The requested position is outside the actual audio duration.');
    commandError = null;
    cancelSeeks();
    if (owner.audio.currentTime === seconds && !owner.audio.seeking) return owner.audio.currentTime;
    const generation = playbackEpoch;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = failure => {
        if (settled) return;
        settled = true;
        owner.audio.removeEventListener('seeked', done);
        owner.audio.removeEventListener('error', failed);
        pendingSeeks.delete(cancel);
        if (failure) reject(failure); else resolve();
      };
      const done = () => finish();
      const failed = () => finish(new Error(mediaError() ?? 'The browser could not seek this audio cue.'));
      const cancel = () => finish(new Error('Seeking was interrupted because playback or its original owner changed.'));
      pendingSeeks.add(cancel);
      owner.audio.addEventListener('seeked', done);
      owner.audio.addEventListener('error', failed);
      try { owner.audio.currentTime = seconds; }
      catch (failure) { finish(failure); }
    });
    if (!retained(owner) || generation !== playbackEpoch || !available('position'))
      throw new Error('The original audio player changed while seeking.');
    refresh();
    return owner.audio.currentTime;
  }
  async function reconcile() {
    const owner = lifetime;
    await tick();
    if (!retained(owner)) return false;
    applySound(sound);
    const actual = refresh();
    if (!scrubbing && positionInput?.isConnected && actual?.duration !== null) positionInput.value = String(actual.position);
    if (volumeInput?.isConnected) volumeInput.value = String(sound.appVolumes[owner.appId]);
    return true;
  }
  function scrollTop() { return retained() ? body.scrollTop : null; }
  function scrollLeft() { return retained() ? body.scrollLeft : null; }
  async function scroll(top, left = 0) {
    const owner = lifetime;
    if (!retained(owner) || !available() || !Number.isFinite(top) || top < 0 || !Number.isFinite(left) || left < 0) return null;
    nativeWrites++;
    try {
      owner.body.scrollTo({ top, left, behavior: 'instant' });
      await tick();
      return retained(owner) && available() ? { top: owner.body.scrollTop, left: owner.body.scrollLeft } : null;
    } finally { nativeWrites--; }
  }
  const facade = { available, controlIds, focusedControl, focus, reconcile, scroll, scrollTop, scrollLeft,
    snapshot, play, pause, seek, applySound, audioElement: () => retained() ? audio : null };
  onMount(() => {
    const root = panel?.closest('[data-session-scene]'), frame = panel?.closest('.managed-window[data-window-id]');
    if (!root || !frame || !audio || !fixture) return;
    lifetime = { root, frame, panel, body, audio, window, windowId: window.id, appId: window.appId, fixture };
    const unregister = registerView?.(window.id, facade);
    applySound(sound);
    refresh();
    observe();
    return () => {
      playbackEpoch++; cancelSeeks(); lifetime.audio.pause(); disposed = true;
      if (typeof unregister === 'function') unregister();
    };
  });
  onDestroy(() => {
    playbackEpoch++; cancelSeeks();
    if (lifetime?.audio) lifetime.audio.pause();
    disposed = true;
  });
  $effect(() => {
    const value = sound, node = audio;
    if (node) applySound(value);
  });
  $effect(() => {
    if (!foreground && audio) {
      // This is independent of command/observer availability during Root loss.
      scrubbing = false;
      playbackEpoch++; cancelSeeks(); audio.pause(); refresh();
    }
  });
  async function request(command, payload = {}, id = null) {
    const owner = lifetime;
    if (!retained(owner) || !available(id ?? undefined)) return null;
    commandError = null;
    try {
      const result = await execute({ command, target: { windowId: owner.windowId }, payload });
      if (retained(owner) && result.status !== 'applied') commandError = result.error.message;
      return result;
    } catch (failure) {
      if (retained(owner)) commandError = failure?.message || 'The audio command could not be completed.';
      return null;
    } finally { if (retained(owner)) await reconcile(); }
  }
  function togglePlay() {
    if (!retained()) return;
    return request(audio.paused || audio.ended ? 'sound.media.play' : 'sound.media.pause', {}, 'play-pause');
  }
  async function setPosition(event) {
    if (control('position') !== event.currentTarget || !available('position')) return;
    const owner = lifetime, seconds = event.currentTarget.valueAsNumber;
    try { return await request('sound.media.seek', { seconds }, 'position'); }
    finally {
      scrubbing = false;
      if (retained(owner)) await reconcile();
    }
  }
  async function setVolume(event) {
    const owner = lifetime, node = event.currentTarget;
    if (!retained(owner) || control('volume') !== node || !available('volume')) return;
    commandError = null;
    try {
      const result = await execute({ command: 'sound.appVolume.set', target: { appId: owner.appId }, payload: { volume: node.valueAsNumber } });
      if (retained(owner) && result.status !== 'applied') commandError = result.error.message;
    } catch (failure) {
      if (retained(owner)) commandError = failure?.message || 'The player volume could not be changed.';
    } finally { if (retained(owner)) await reconcile(); }
  }
  function openSound() {
    if (available('sound-settings')) void execute({ command: 'system.settings.open', payload: { pane: 'sound' } });
  }
  function observeFocus(event) {
    const id = event.target?.dataset.soundMediaControl;
    if (!nativeWrites && ids.includes(id) && available(id) && focusedControl() === id)
      void execute({ command: 'sound.media.focus', target: { windowId: lifetime.windowId, control: id }, payload: { observe: true } });
  }
  function observeScroll() {
    if (!nativeWrites && available()) void execute({ command: 'sound.media.scroll', target: { windowId: lifetime.windowId },
      payload: { top: body.scrollTop, left: body.scrollLeft, observe: true } });
  }
</script>

<section class="audio-player" class:music={isMusic} class:quicktime={!isMusic} bind:this={panel}
  data-sound-player={preview ? undefined : window.appId} data-sound-player-preview={preview ? window.appId : undefined}
  data-window-id={window.id} aria-label={isMusic ? 'Music original audio audition' : 'QuickTime local audio player'}
  tabindex="-1" onfocusin={observeFocus}>
  {#if !preview}
    <audio bind:this={audio} src={fixture.src} preload="auto" onloadedmetadata={observe} ondurationchange={observe}
      oncanplay={observe} ontimeupdate={observe} onplaying={observe} onpause={observe} onended={observe}
      onerror={observe} onvolumechange={observe} onseeking={observe} onseeked={observe}></audio>
  {/if}
  <div class="body" bind:this={body} data-sound-media-scroll onscroll={observeScroll}>
    <div class="page">
      {#if isMusic}
        <header><p class="eyebrow">Music</p><h1>Local audition</h1><p class="intro">One original cue, ready to hear.</p></header>
        <article class="music-track">
          <div class="artwork" aria-hidden="true">
            <svg viewBox="0 0 240 240" fill="none"><rect width="240" height="240" fill="#ec7c52"/><circle cx="175" cy="67" r="40" fill="#ffdba0"/><path d="M0 166 65 134 121 154 178 116 240 142V240H0Z" fill="#9c354b"/><path d="M0 201 67 163 141 191 240 156V240H0Z" fill="#442c43"/><path d="M27 122V201M73 87V177M167 87V180M213 122V200M0 136H240M73 88C95 108 145 108 167 88M27 122C42 126 59 105 73 88M167 88C182 105 199 125 213 122" stroke="#ffe8bd" stroke-width="4"/><path d="M90 103V136M107 108V136M124 109V136M141 106V136M57 113V136M183 111V136" stroke="#ffe8bd" stroke-width="2"/><text x="18" y="225" fill="#ffe8bd" font-size="10" letter-spacing="3">GOLDEN ARPEGGIO</text></svg>
          </div>
          <div class="track-copy"><p class="eyebrow">JesterOS Originals · Single</p><h2>{fixture.title}</h2><p class="artist">{fixture.artist}</p><p class="track-note">A warm, twelve-second arpeggio composed for this desktop.</p><span class="format">Original PCM WAV · Mono · 22.05 kHz</span></div>
        </article>
      {:else}
        <header class="quicktime-heading"><div class="file-mark" aria-hidden="true"><svg viewBox="0 0 32 38" fill="none"><path d="M5 2h15l8 8v25H5Z" stroke="currentColor" stroke-width="1.5"/><path d="M20 2v9h8M12 26V15l10-2v11M12 26c0 3-6 4-6 1s6-4 6-1Zm10-2c0 3-6 4-6 1s6-4 6-1Z" stroke="currentColor" stroke-width="1.5"/></svg></div><div><p class="eyebrow">QuickTime Player · Local audio</p><h1>{fixture.title}</h1></div></header>
        <div class="audio-emblem" aria-hidden="true"><span></span><span></span><span></span><svg viewBox="0 0 64 64" fill="none"><path d="M12 27h11l13-11v32L23 37H12Z" fill="currentColor"/><path d="M43 23c7 5 7 13 0 18M49 15c13 10 13 24 0 34" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div>
        <p class="quicktime-description">An original eight-second glass-tone study.</p><p class="format">PCM WAV · Mono · 22.05 kHz</p>
      {/if}
      <div class="route"><span class="route-label">Sound output</span><strong>{sound.output.name}</strong><span>{sound.effectiveMuted ? 'Muted' : `${sound.volume}% master output`} · {playerVolume}% player volume</span></div>
      <p class="boundary">Original audio generated locally for JesterOS. Playback and seeking use this window’s real audio element. Device choices are fictional routes; no microphone, remote media, or host device controls are accessed.</p>
    </div>
  </div>
  <footer class="playback">
    <div class="transport">
      <button class="play" type="button" data-sound-media-control="play-pause" disabled={preview || !foreground}
        aria-label={playing ? 'Pause audio' : 'Play audio'} title={playing ? 'Pause (Space)' : 'Play (Space)'} onclick={togglePlay}>
        {#if playing}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zm8 0h4v16h-4z" fill="currentColor"/></svg>
        {:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 3 15 9L7 21Z" fill="currentColor"/></svg>{/if}
        <span>{playing ? 'Pause' : 'Play'}</span>
      </button>
      <div class="now-playing"><strong>{fixture.title}</strong><span>{viewState?.ended ? 'Finished' : playing ? 'Playing' : viewState?.ready ? 'Paused' : 'Loading audio…'}</span></div>
      <label class="volume" for={inputId('volume')}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 9h4l5-4v14l-5-4H3Z"/><path d="M16 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/></svg><span class="sr-only">{isMusic ? 'Music' : 'QuickTime'} volume</span><input id={inputId('volume')} bind:this={volumeInput} type="range" min="0" max="100" step="1" value={playerVolume} disabled={preview || !foreground} data-sound-media-control="volume" aria-valuetext={`${playerVolume}% player volume, limited by ${sound.volume}% output`} oninput={setVolume}/><output>{playerVolume}%</output></label>
    </div>
    <div class="timeline">
      <time>{time(duration === null ? null : position)}</time>
      <label class="sr-only" for={inputId('position')}>Playback position in seconds</label>
      {#if preview}
        <input id={inputId('position')} type="range" min="0" max={duration ?? 0} step="0.01" value={position} disabled
          aria-valuetext={`${time(position)} of ${time(duration)}`} />
      {:else}
        <input id={inputId('position')} bind:this={positionInput} type="range" min="0" max={duration ?? 0} step="0.01" value="0" disabled={!foreground || duration === null || !media?.ready} data-sound-media-control="position" aria-valuetext={`${time(position)} of ${time(duration)}`} oninput={() => { scrubbing = true; }} onchange={setPosition} onblur={() => { scrubbing = false; void reconcile(); }} />
      {/if}
      <time>{isMusic ? time(duration) : duration === null ? '–:––' : `−${time(duration - position)}`}</time>
    </div>
    <div class="playback-bottom"><span class="gain">{sound.effectiveMuted ? 'Output muted' : `${Math.round((viewState?.volume ?? soundGain(sound, window.appId)) * 100)}% effective gain`}</span><button class="settings-link" type="button" data-sound-media-control="sound-settings" disabled={preview || !foreground} onclick={openSound}>Sound Settings…</button></div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </footer>
</section>

<style>
  .audio-player { --player-accent:#c94353; display:flex; flex-direction:column; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; color:var(--appearance-ink,#28272a); background:var(--appearance-surface,#fff); font:13px/1.45 var(--golden-gate-font,sans-serif); text-align:left; }
  audio { display:none; } .body { flex:1 1 auto; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; } .page { box-sizing:border-box; max-width:760px; margin:0 auto; padding:28px 34px; }
  .eyebrow { margin:0 0 4px; font-size:10px; font-weight:650; letter-spacing:.07em; text-transform:uppercase; color:var(--player-accent); } h1 { margin:0; font-size:28px; line-height:1.16; letter-spacing:-.7px; font-weight:720; } .intro { margin:8px 0 0; color:var(--appearance-muted,#807b7b); font-size:12px; }
  .music-track { display:flex; align-items:center; flex-wrap:wrap; gap:25px; margin:25px 0; } .artwork { flex:0 1 220px; width:220px; aspect-ratio:1; max-width:100%; border-radius:9px; overflow:hidden; box-shadow:0 8px 18px #65324122; } .artwork svg { display:block; width:100%; height:100%; } .track-copy { flex:1 1 200px; min-width:0; } h2 { margin:8px 0 4px; font-size:24px; line-height:1.2; font-weight:680; letter-spacing:-.45px; } .artist { margin:0; font-size:14px; color:var(--player-accent); } .track-note { margin:18px 0 12px; max-width:29em; color:var(--appearance-muted,#807b7b); font-size:12px; } .format { margin:0; font-size:10px; opacity:.63; }
  .route { display:flex; flex-wrap:wrap; align-items:baseline; gap:3px 14px; padding:12px 0; border-top:1px solid var(--appearance-soft-border,#ded9da); border-bottom:1px solid var(--appearance-soft-border,#ded9da); font-size:11px; } .route-label { font-size:10px; opacity:.6; } .route strong { font-weight:600; } .route>span:last-child { opacity:.7; } .boundary { margin:14px 0 0; font-size:10px; line-height:1.55; opacity:.55; } p,h1,h2,strong,span { overflow-wrap:anywhere; }
  .playback { flex:0 0 auto; min-width:0; padding:13px 22px 10px; border-top:1px solid var(--appearance-soft-border,#ded9da); background:var(--appearance-toolbar,#f5f3f3); } .transport { display:flex; align-items:center; gap:14px; min-width:0; } button { color:inherit; font:inherit; cursor:default; } .play { display:flex; flex:0 0 auto; align-items:center; justify-content:center; gap:6px; min-height:34px; padding:5px 12px; border:0; border-radius:7px; color:white; background:var(--player-accent); } .play svg { width:18px; height:18px; } .play span { font-size:11px; font-weight:600; } .now-playing { flex:1 1 auto; min-width:0; } .now-playing strong { display:block; font-size:11px; font-weight:600; } .now-playing>span { display:block; margin-top:1px; font-size:10px; opacity:.6; }
  .volume { display:flex; align-items:center; gap:7px; flex:0 1 190px; min-width:115px; } .volume>svg { flex:0 0 18px; width:18px; height:18px; opacity:.7; } input[type='range'] { display:block; min-width:0; width:100%; height:20px; margin:0; accent-color:var(--player-accent); cursor:default; } .volume output { width:34px; flex:0 0 34px; font-size:10px; font-variant-numeric:tabular-nums; text-align:right; opacity:.65; } .timeline { display:flex; align-items:center; gap:9px; margin-top:8px; } .timeline input { flex:1 1 auto; } time { min-width:34px; font-size:10px; font-variant-numeric:tabular-nums; opacity:.6; } time:last-child { text-align:right; }
  .playback-bottom { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:4px 10px; margin-top:2px; } .gain { font-size:10px; opacity:.6; } .settings-link { padding:3px 0; border:0; background:none; color:var(--player-accent); font-size:11px; } .error { margin:8px 0 0; padding:5px 8px; border-left:3px solid #be4549; background:#be454910; color:#b03b42; font-size:11px; } .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  button:disabled,input:disabled { opacity:.4; } button:focus-visible,input:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; } .audio-player:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  .quicktime { --player-accent:#b8d9ee; color:#f0f2f6; background:#22272e; } .quicktime .page { max-width:620px; padding-top:26px; padding-bottom:22px; } .quicktime-heading { display:flex; align-items:center; gap:13px; } .quicktime-heading h1 { font-size:21px; font-weight:570; letter-spacing:-.3px; } .file-mark { flex:0 0 30px; width:30px; color:#c9d1dc; } .file-mark svg { display:block; width:30px; height:36px; } .quicktime .eyebrow { color:#a7b5c5; font-size:9px; } .audio-emblem { position:relative; display:grid; place-items:center; width:154px; height:154px; margin:30px auto 18px; color:#c8d4e2; } .audio-emblem span { position:absolute; inset:0; border:1px solid #a5b9d31c; border-radius:50%; } .audio-emblem span:nth-child(2) { inset:15px; border-color:#a5b9d329; } .audio-emblem span:nth-child(3) { inset:30px; border-color:#a5b9d340; background:#a5b9d308; } .audio-emblem svg { position:relative; width:60px; height:60px; }
  .quicktime-description { margin:0; color:#d0d6e0; font-size:12px; text-align:center; } .quicktime .format { margin:6px 0 24px; text-align:center; } .quicktime .route { border-color:#ffffff16; } .quicktime .boundary { opacity:.48; } .quicktime .playback { border-color:#ffffff16; background:#30363f; } .quicktime .transport { flex-wrap:wrap; } .quicktime .play { order:2; background:#ffffff16; border:1px solid #ffffff14; color:#eef4fc; } .quicktime .volume { order:1; flex:1 1 130px; max-width:190px; margin-right:auto; } .quicktime .now-playing { order:3; flex:1 1 100px; text-align:right; } .quicktime .settings-link { color:#bbd6ea; } .quicktime .error { color:#ffb7b4; background:#e45d6410; }
  @media(max-width:560px) { .page { padding:20px; } .music-track { gap:18px; } .artwork { flex-basis:170px; width:170px; } .track-copy { flex-basis:160px; } .playback { padding:10px 14px 8px; } .transport { flex-wrap:wrap; gap:10px; } .volume { flex:1 1 130px; } .now-playing { flex:1 1 140px; } .quicktime .page { padding:20px; } }
  @media(max-height:420px) { .page { padding-top:18px; } .artwork { flex-basis:130px; width:130px; } .music-track { margin:18px 0; } .audio-emblem { width:112px; height:112px; margin-top:18px; } }
</style>
