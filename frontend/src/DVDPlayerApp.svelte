<script>
  import { onMount, tick } from 'svelte';
  import { DVD_DISC, DVD_VIDEO, dvdTitle, dvdTitleDuration, dvdChapter } from './dvd-fixtures.js';
  import { dvdSession, dvdAvailability } from './dvd-state.js';
  import { dvdMenuItems } from './dvd-catalog.js';
  import './dvd.css';

  let { state: dVDPlayerState, profile, windowId, available = true, active = true, sound = null, execute, registerView } = $props();
  let root = $state(null), video = $state(null), score = $state(null);
  let error = $state(''), openMenu = $state(''), bookmarkName = $state(''), renameId = $state(null), renameName = $state('');
  let mounted = false, retired = false, busy = false, epoch = 0, loaded = null, textTracks = new Map(), loopChapter = null, facade = null, observing = false;
  let ownerState = null, ownerSession = null, ownerRoot = null, ownerParent = null, ownerVideo = null, ownerScore = null, ownerMediaParent = null, ownerProfileId = null;
  let discChoice = 0;
  const session = $derived(dVDPlayerState ? dvdSession(dVDPlayerState, windowId) : null);
  const title = $derived(dvdTitle(session?.titleId));
  const chapter = $derived(dvdChapter(session?.titleId, session?.position ?? 0));
  const duration = $derived(dvdTitleDuration(session?.titleId));
  const capability = $derived(dvdAvailability(profile));
  const profileId = $derived(typeof profile === 'string' ? profile : profile?.id ?? '');
  const highSierra = $derived(profileId.includes('high-sierra'));
  const windows = $derived(profileId.startsWith('windows11'));
  const golden = $derived(profileId.includes('golden-gate'));
  const menus = $derived(dVDPlayerState ? dvdMenuItems(dVDPlayerState, windowId) : []);
  const fresh = () => mounted && !retired && available === true && dVDPlayerState === ownerState && session === ownerSession && profileId === ownerProfileId && root === ownerRoot && root?.parentNode === ownerParent && root?.isConnected === true && video === ownerVideo && score === ownerScore && video?.parentNode === ownerMediaParent && score?.parentNode === ownerMediaParent && video?.isConnected === true && score?.isConnected === true && !!session;
  const valid = guard => fresh() && (!guard || guard() === true);
  const format = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}.${Math.floor(value % 1 * 10)}`;
  async function ask(name, payload = {}) {
    if (!fresh() || typeof execute !== 'function') return null;
    error = '';
    try {
      const result = await execute(name.startsWith('dvd.') ? name : `dvd.${name}`, { windowId }, payload);
      if (fresh() && result?.status === 'rejected') error = result.error?.message ?? 'The local disc operation could not be completed.';
      return result;
    } catch (cause) { if (fresh()) error = cause?.message ?? 'Playback is unavailable.'; return null; }
  }
  function setSound(value, guard) {
    if (!valid(guard)) return false;
    const outputMuted = value?.outputs?.find(output => output.id === value.outputDeviceId)?.muted;
    const muted = value?.muted === true || value?.effectiveMuted === true || outputMuted === true;
    const volume = Math.max(0, Math.min(1, (value?.volume ?? 100) / 100));
    video.volume = volume; score.volume = volume;
    video.muted = muted || loaded?.audioTrack === 'score'; score.muted = muted;
    return true;
  }
  function cancelPlayback() { epoch++; video?.pause(); score?.pause(); }
  function readPlayback() {
    if (!fresh() || !loaded?.discId || video.getAttribute('src') !== DVD_VIDEO.content) return null;
    const actualTitle = dvdTitle(loaded.titleId), track = textTracks.get(loaded.subtitle);
    const scoreActive = loaded.audioTrack === 'score';
    return { discId: loaded.discId, titleId: loaded.titleId, position: Math.max(0, Math.min(actualTitle.end - actualTitle.start, video.currentTime - actualTitle.start)), rate: video.playbackRate, playing: !video.paused && !video.ended && (!scoreActive || !score.paused), ready: video.readyState >= 1 && (!scoreActive || score.readyState >= 1), subtitle: loaded.subtitle === 'off' ? [...textTracks.values()].every(row => row.mode !== 'showing') ? 'off' : null : track?.mode === 'showing' ? loaded.subtitle : null, audioTrack: scoreActive ? score.src === DVD_DISC.audioTracks[1].content && Math.abs(score.currentTime - video.currentTime) <= .15 ? 'score' : null : 'original' };
  }
  function waitFor(node, eventName, guard, token) {
    return new Promise(resolve => {
      let timer;
      const finish = value => { clearTimeout(timer); node.removeEventListener(eventName, ready); node.removeEventListener('error', failed); resolve(value); };
      const ready = () => finish(valid(guard) && epoch === token);
      const failed = () => finish(false);
      node.addEventListener(eventName, ready, { once: true }); node.addEventListener('error', failed, { once: true });
      // Only an I/O deadline; no authored playback or persisted time uses this clock.
      timer = setTimeout(() => finish(false), 4000);
    });
  }
  function installTracks() {
    if (textTracks.size) return true;
    const Cue = video.ownerDocument.defaultView?.VTTCue;
    if (!Cue || !video.addTextTrack) return false;
    for (const subtitles of DVD_DISC.subtitles.filter(row => row.id !== 'off')) {
      const track = video.addTextTrack('subtitles', subtitles.name, subtitles.language);
      for (const cue of subtitles.cues) track.addCue(new Cue(cue.start, cue.end, cue.text));
      track.mode = 'disabled'; textTracks.set(subtitles.id, track);
    }
    return true;
  }
  async function applyPlayback(next, guard) {
    if (!valid(guard)) return false;
    const token = ++epoch; busy = true;
    try {
      video.pause(); score.pause();
      if (!next.discId) {
        video.removeAttribute('src'); score.removeAttribute('src'); video.load(); score.load(); loaded = null;
        for (const track of textTracks.values()) track.mode = 'disabled';
        return valid(guard) && token === epoch;
      }
      const actualTitle = dvdTitle(next.titleId);
      if (!actualTitle) return false;
      if (!loaded || video.getAttribute('src') !== DVD_VIDEO.content) {
        const ready = waitFor(video, 'loadedmetadata', guard, token); video.src = DVD_VIDEO.content; video.load();
        if (!await ready) return false;
      }
      if (!valid(guard) || token !== epoch || !Number.isFinite(video.duration) || video.duration + .05 < actualTitle.end) return false;
      if (!installTracks() && next.subtitle !== 'off') return false;
      for (const [id, track] of textTracks) track.mode = id === next.subtitle ? 'showing' : 'disabled';
      video.playbackRate = next.rate;
      const at = actualTitle.start + Math.min(actualTitle.end - actualTitle.start, next.position);
      if (Math.abs(video.currentTime - at) > .005) {
        const sought = waitFor(video, 'seeked', guard, token); video.currentTime = at;
        if (!await sought) return false;
      }
      if (!valid(guard) || token !== epoch) return false;
      if (next.audioTrack === 'score') {
        if (score.getAttribute('src') !== DVD_DISC.audioTracks[1].content) {
          const ready = waitFor(score, 'loadedmetadata', guard, token); score.src = DVD_DISC.audioTracks[1].content; score.load();
          if (!await ready) return false;
        }
        if (Math.abs(score.currentTime - at) > .005) {
          const sought = waitFor(score, 'seeked', guard, token); score.currentTime = at;
          if (!await sought) return false;
        }
        score.playbackRate = next.rate;
      }
      loaded = { ...next }; loopChapter = dvdChapter(next.titleId, next.position);
      setSound(sound, guard);
      if (next.playing) {
        try {
          if (next.audioTrack === 'score') await Promise.all([video.play(), score.play()]);
          else await video.play();
          if (next.audioTrack === 'score' && Math.abs(score.currentTime - video.currentTime) > .02) {
            const sought = waitFor(score, 'seeked', guard, token); score.currentTime = video.currentTime;
            if (!await sought) { video.pause(); score.pause(); return false; }
          }
        }
        catch (cause) { video.pause(); score.pause(); throw cause; }
        if (!valid(guard) || token !== epoch) { video.pause(); score.pause(); return false; }
      }
      return valid(guard) && token === epoch;
    } finally { busy = false; }
  }
  async function observe() {
    if (!fresh() || busy || observing || !loaded || loaded.titleId !== session.titleId) return;
    const actualTitle = dvdTitle(loaded.titleId), absolute = video.currentTime;
    const chapterIndex = actualTitle.chapters.indexOf(loopChapter), chapterEnd = actualTitle.start + (actualTitle.chapters[chapterIndex + 1]?.position ?? dvdTitleDuration(loaded.titleId));
    const boundary = loaded.repeat === 'chapter' ? chapterEnd : actualTitle.end;
    if ((absolute >= boundary - .015 || video.ended) && loaded.repeat !== 'off' && !session.discMenu) {
      observing = true;
      const start = loaded.repeat === 'chapter' ? loopChapter.position : 0;
      try { const sought = await ask('seek', { position: start }); if (sought?.status === 'applied') await ask('play'); } finally { observing = false; }
      return;
    }
    if (absolute >= actualTitle.end || video.ended) { video.pause(); score.pause(); }
    if (loaded.audioTrack === 'score' && Math.abs(score.currentTime - video.currentTime) > .12) score.currentTime = video.currentTime;
    observing = true;
    try { await ask('observe'); } finally { observing = false; }
  }
  async function selectMenu(item) { openMenu = ''; if (item.enabled) await ask(item.command, item.payload); }
  async function navigateDiscMenu(direction) {
    if (!fresh() || !session.discId) return false;
    if (!session.discMenu) {
      const result = await ask('discMenu', { visible: true });
      if (result?.status !== 'applied') return false;
      await tick();
    }
    if (!fresh()) return false;
    const choices = [...root.querySelectorAll('.dvd-disc-menu button')].filter(node => !node.disabled);
    if (!choices.length) return false;
    if (direction === 'enter') { choices[Math.min(discChoice, choices.length - 1)].click(); return true; }
    discChoice = (discChoice + (direction === 'next' ? 1 : -1) + choices.length) % choices.length;
    choices[discChoice].focus();
    return choices[discChoice].ownerDocument.activeElement === choices[discChoice];
  }
  async function addBookmark() {
    const name = bookmarkName.trim() || `${title?.name ?? 'Harbor'} — ${format(session?.position ?? 0)}`;
    const result = await ask('bookmarkAdd', { name }); if (result?.status === 'applied') bookmarkName = '';
  }
  function preferences(key, value) { return ask('preferences', { values: { ...dVDPlayerState.preferences, [key]: value } }); }
  function focus(controlId, guard) { if (!valid(guard)) return false; const element = [...root.querySelectorAll('[data-control-id]')].find(node => node.dataset.controlId === controlId); if (!element || element.disabled) return false; element.focus(); return element.ownerDocument.activeElement === element; }
  function dispose() { if (retired) return; cancelPlayback(); retired = true; }
  onMount(() => {
    ownerState = dVDPlayerState; ownerSession = session; ownerRoot = root; ownerParent = root.parentNode; ownerVideo = video; ownerScore = score; ownerMediaParent = video.parentNode; ownerProfileId = profileId;
    mounted = true;
    const originalState = dVDPlayerState, originalSession = session;
    facade = { available: fresh, readPlayback, applyPlayback, cancelPlayback, setSound, focus, dispose };
    registerView?.(windowId, facade);
    if (session?.discId) {
      const snapshot = { ...session };
      applyPlayback(snapshot, () => fresh() && dVDPlayerState === originalState && session === originalSession).then(() => observe()).catch(cause => { if (fresh()) error = cause.message; });
    }
    return () => { dispose(); registerView?.(windowId, null, facade); mounted = false; };
  });
  $effect(() => { const value = sound; const volume = value?.volume; const muted = value?.muted; const effective = value?.effectiveMuted; const device = value?.outputDeviceId; const output = value?.outputs?.find(row => row.id === device)?.muted; if (mounted) setSound(value); });
  $effect(() => { if (!available) { video?.pause(); score?.pause(); } });
</script>

<section bind:this={root} class:dvd-high-sierra={highSierra} class:dvd-windows={windows} class:dvd-golden={golden} class:dvd-fill-window={session?.fullWindow} class="dvd-app" data-dvd-window-id={windowId} aria-label={capability.label}>
  <nav class="dvd-menu-strip" aria-label="DVD Player menus">
    {#each menus as menu}
      <div class="dvd-menu-owner">
        <button class:chosen={openMenu === menu.label} onclick={() => openMenu = openMenu === menu.label ? '' : menu.label} aria-expanded={openMenu === menu.label}>{menu.label}</button>
        {#if openMenu === menu.label}
          <div class="dvd-menu-popup" role="menu">
            {#each menu.items as item}<button role="menuitem" disabled={!item.enabled} onclick={() => selectMenu(item)}><span class="dvd-menu-check">{item.checked ? '✓' : ''}</span>{item.label}</button>{/each}
          </div>
        {/if}
      </div>
    {/each}
  </nav>
  <div class="dvd-disclosure">{capability.disclosure}</div>
  <div class="dvd-cinema" class:fill={dVDPlayerState?.preferences?.fit === 'fill'} class:actual={dVDPlayerState?.preferences?.fit === 'actual'}>
    <!-- Genuine authored video and synchronous local alternate audio; captions are actual TextTracks. -->
    <video bind:this={video} playsinline preload="metadata" aria-label="Harbor Lantern authored local video" ontimeupdate={observe} onpause={observe} onplay={observe} onended={observe}></video>
    <audio bind:this={score} preload="metadata" aria-label="Tide Organ local alternate score"></audio>
    {#if !session?.discId}
      <div class="dvd-no-disc"><div class="dvd-disc-symbol">DVD</div><h2>No Disc Loaded</h2><p>Open Harbor Lantern, an authored local video disc.<br />No optical drive is required.</p><button data-control-id="load-disc" onclick={() => ask('load')}>Open Authored Local Disc</button></div>
    {:else if session.discMenu}
      <div class="dvd-disc-menu"><p class="dvd-disc-kicker">JESTEROS MOTION ORIGINALS</p><h1>Harbor Lantern</h1><p>A local film in three chapters</p><button data-control-id="play-movie" onclick={() => ask('play')}>Play Movie</button><h3>Scene Selection</h3><div class="dvd-scene-buttons">{#each title?.chapters ?? [] as row}<button onclick={() => ask('chapter', { chapterId: row.id })}>{row.name}<small>{format(row.position)}</small></button>{/each}</div><label>Title <select value={session.titleId} onchange={event => ask('title', { titleId: event.currentTarget.value })}>{#each DVD_DISC.titles as row}<option value={row.id}>{row.name}</option>{/each}</select></label><small>Authored local disc menu · Real WebM video, not an optical DVD</small></div>
    {/if}
  </div>
  {#if session?.fullWindow}<button class="dvd-exit-expanded" aria-label="Leave expanded player" onclick={() => ask('fullWindow', { enabled: false })}>↙ Restore Viewer</button>{/if}
  {#if session && dVDPlayerState.preferences.showController}
    <div class="dvd-controller" class:dvd-overlay-controller={!highSierra && !windows} class:dvd-autohide-controller={session.playing && !profileId.includes('mojave') && !highSierra && !windows} aria-label="DVD playback controller">
      {#if highSierra}
        <div class="dvd-compass" aria-label="DVD disc menu navigation">
          <button class="dvd-compass-up" aria-label="Previous disc menu item" disabled={!session.discId} onclick={() => navigateDiscMenu('previous')}>▲</button>
          <button class="dvd-compass-left" aria-label="Previous disc menu choice" disabled={!session.discId} onclick={() => navigateDiscMenu('previous')}>◀</button>
          <button class="dvd-compass-enter" disabled={!session.discId} onclick={() => navigateDiscMenu('enter')}>enter</button>
          <button class="dvd-compass-right" aria-label="Next disc menu choice" disabled={!session.discId} onclick={() => navigateDiscMenu('next')}>▶</button>
          <button class="dvd-compass-down" aria-label="Next disc menu item" disabled={!session.discId} onclick={() => navigateDiscMenu('next')}>▼</button>
        </div>
      {/if}
      <div class="dvd-display"><span>{session.discId ? title?.name : 'NO DISC'}</span><span>{chapter?.name ?? '—'}</span><output>{format(session.position)} / {format(duration)}</output></div>
      <div class="dvd-transport">
        <button disabled={!session.discId} onclick={() => ask('discMenu', { visible: !session.discMenu })}>Menu</button>
        <div class="dvd-shared-sound" title="Volume follows the shared system Sound controls" aria-label={`Shared system volume ${sound?.volume ?? 100} percent`}><span>◖</span><meter min="0" max="100" value={sound?.muted || sound?.effectiveMuted ? 0 : sound?.volume ?? 100}></meter><span>◖))</span></div>
        <button disabled={!session.discId} aria-label="Previous chapter" onclick={() => ask('step', { direction: 'previous' })}>|◀</button>
        <button disabled={!session.discId} aria-label="Seek backward a quarter second" onclick={() => ask('seek', { position: Math.max(0, session.position - .25) })}>◀◀</button>
        <button class="dvd-play" disabled={!session.discId} aria-label={session.playing ? 'Pause' : 'Play'} onclick={() => ask(session.playing ? 'pause' : 'play')}>{session.playing ? 'Ⅱ' : '▶'}</button>
        <button disabled={!session.discId} aria-label="Stop" onclick={() => ask('stop')}>■</button>
        <button disabled={!session.discId} aria-label="Seek forward a quarter second" onclick={() => ask('seek', { position: Math.min(duration, session.position + .25) })}>▶▶</button>
        <button disabled={!session.discId} aria-label="Next chapter" onclick={() => ask('step', { direction: 'next' })}>▶|</button>
        <button disabled={!session.discId} aria-label={session.fullWindow ? 'Leave expanded player' : 'Expand player'} onclick={() => ask('fullWindow', { enabled: !session.fullWindow })}>{session.fullWindow ? '↙' : '↗'}</button>
        <button disabled={!session.discId} aria-label="Eject local disc" onclick={() => ask('eject')}>⏏</button>
      </div>
      <div class="dvd-timeline"><span>{format(session.position)}</span><input aria-label="Title playback position" type="range" min="0" max={duration || 3} step="0.01" value={session.position} disabled={!session.discId} onchange={event => ask('seek', { position: Number(event.currentTarget.value) })} /><span>−{format(Math.max(0, duration - session.position))}</span></div>
      <details class="dvd-controller-drawer" open={highSierra || windows}><summary>Title · Chapter · Subtitles · Audio · Playback Options</summary>
      <div class="dvd-options"><label>Title<select disabled={!session.discId} value={session.titleId ?? ''} onchange={event => ask('title', { titleId: event.currentTarget.value })}>{#if !session.discId}<option value="">No Disc</option>{/if}{#each DVD_DISC.titles as row}<option value={row.id}>{row.name}</option>{/each}</select></label><label>Chapter<select disabled={!session.discId} value={chapter?.id ?? ''} onchange={event => ask('chapter', { chapterId: event.currentTarget.value })}>{#each title?.chapters ?? [] as row}<option value={row.id}>{row.name}</option>{/each}</select></label><label>Subtitles<select disabled={!session.discId} value={session.subtitle} onchange={event => ask('subtitle', { trackId: event.currentTarget.value })}>{#each DVD_DISC.subtitles as row}<option value={row.id}>{row.name}</option>{/each}</select></label><label>Audio<select disabled={!session.discId} value={session.audioTrack} onchange={event => ask('audioTrack', { trackId: event.currentTarget.value })}>{#each DVD_DISC.audioTracks as row}<option value={row.id}>{row.name}</option>{/each}</select></label><label>Speed<select disabled={!session.discId} value={session.rate} onchange={event => ask('rate', { rate: Number(event.currentTarget.value) })}>{#each [0.5, 1, 1.5, 2] as rate}<option value={rate}>{rate}×</option>{/each}</select></label><label>Repeat<select disabled={!session.discId} value={session.repeat} onchange={event => ask('repeat', { mode: event.currentTarget.value })}><option value="off">Off</option><option value="title">Title</option><option value="chapter">Chapter</option></select></label></div>
      </details>
    </div>
  {/if}
  {#if error}<div class="dvd-error" role="alert">{error}</div>{/if}
  {#if session?.panel !== 'none' && session}
    <div class="dvd-sheet" role="dialog" aria-modal="false" aria-label={session.panel === 'preferences' ? 'DVD Player Preferences' : session.panel === 'bookmarks' ? 'DVD Bookmarks' : 'DVD Player Help'}>
      <header><strong>{session.panel === 'preferences' ? 'DVD Player Preferences' : session.panel === 'bookmarks' ? 'Bookmarks' : 'DVD Player Help'}</strong><button aria-label="Close panel" onclick={() => ask('panel', { panel: 'none' })}>×</button></header>
      {#if session.panel === 'preferences'}
        <div class="dvd-preferences"><h3>When opening an authored local disc</h3><label><input type="checkbox" checked={dVDPlayerState.preferences.autoPlay} onchange={event => preferences('autoPlay', event.currentTarget.checked)} /> Start playing automatically</label><label><input type="checkbox" checked={dVDPlayerState.preferences.rememberPosition} onchange={event => preferences('rememberPosition', event.currentTarget.checked)} /> Remember the last played position</label><label><input type="checkbox" checked={dVDPlayerState.preferences.showController} onchange={event => preferences('showController', event.currentTarget.checked)} /> Show playback controller</label><label>Default subtitles<select value={dVDPlayerState.preferences.defaultSubtitle} onchange={event => preferences('defaultSubtitle', event.currentTarget.value)}>{#each DVD_DISC.subtitles as track}<option value={track.id}>{track.name}</option>{/each}</select></label><label>Default audio<select value={dVDPlayerState.preferences.defaultAudio} onchange={event => preferences('defaultAudio', event.currentTarget.value)}>{#each DVD_DISC.audioTracks as track}<option value={track.id}>{track.name}</option>{/each}</select></label><label>Video size<select value={dVDPlayerState.preferences.fit} onchange={event => preferences('fit', event.currentTarget.value)}><option value="fit">Fit to Window</option><option value="fill">Fill Window (Crop)</option><option value="actual">Actual Size — 192 × 108</option></select></label><p>Volume and output mute follow the shared system Sound controls. No optical device is accessed.</p></div>
      {:else if session.panel === 'bookmarks'}
        <div class="dvd-bookmark-add"><input aria-label="New bookmark name" maxlength="128" bind:value={bookmarkName} placeholder="Bookmark name" /><button disabled={!session.discId} onclick={addBookmark}>Add at Current Position</button></div>
        <ul class="dvd-bookmarks">{#each dVDPlayerState.bookmarks as bookmark (bookmark.id)}<li>{#if renameId === bookmark.id}<input aria-label="Rename bookmark" maxlength="128" bind:value={renameName} /><button onclick={async () => { const result = await ask('bookmarkRename', { bookmarkId: bookmark.id, name: renameName }); if (result?.status === 'applied') renameId = null; }}>Save</button><button onclick={() => renameId = null}>Cancel</button>{:else}<button class="dvd-bookmark-go" disabled={!session.discId} onclick={() => ask('bookmarkGo', { bookmarkId: bookmark.id })}><strong>{bookmark.name}</strong><small>{dvdTitle(bookmark.titleId)?.name} · {format(bookmark.position)}</small></button><button onclick={() => { renameId = bookmark.id; renameName = bookmark.name; }}>Rename</button><button onclick={() => ask('bookmarkDelete', { bookmarkId: bookmark.id })}>Delete</button>{/if}</li>{/each}</ul>{#if !dVDPlayerState.bookmarks.length}<p class="dvd-empty">No bookmarks yet. Add a bookmark to return to a real title position.</p>{/if}
      {:else}
        <div class="dvd-help"><h3>Play an authored local disc</h3><p>Open Harbor Lantern, then choose Play Movie or a chapter. Titles are actual bounded ranges of the bundled three-second VP8/Opus film. This local disc is not an optical DVD or commercial MPEG-2 decoder.</p><h3>Subtitles and audio</h3><p>English and French captions are authored timed TextTracks. Original Harbor Sound plays the movie’s real Opus soundtrack. Tide Organ is a synchronized, genuinely different local PCM score.</p><h3>Bookmarks and playback options</h3><p>Bookmarks retain actual observed title times. Speed changes affect the real player; repeat loops the selected title or chapter. Eject unloads both players, while bookmarks remain available for the next loading.</p><p>{capability.disclosure}</p></div>
      {/if}
    </div>
  {/if}
</section>
