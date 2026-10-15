// Run once per installed profile in a real Chromium page, after a user activation.
// Supply the ACTUAL mounted DVD root, registered facade, controller, canonical state
// and Root window ID. This never substitutes media methods, clocks, or native views.
export async function runDVDNativeBrowserRegression({ root, facade, controller, state, windowId }) {
  const completed = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const run = async (name, payload = {}) => {
    const result = await controller.handlers[`dvd.${name}`]({ windowId }, payload);
    assert(result?.status === 'applied', `${name}: ${result?.error?.message ?? 'no applied result'}`);
    return result;
  };
  const video = root.querySelector('video'), score = root.querySelector('audio');
  const session = () => state.sessions.find(row => row.windowId === windowId);
  assert(root.isConnected && facade.available() && video instanceof HTMLVideoElement && score instanceof HTMLAudioElement, 'Original native DVD media view is not mounted.');
  await run('load');
  assert(video.videoWidth === 192 && video.videoHeight === 108 && Math.abs(video.duration - 3) < .05, 'Disc has not decoded genuine authored harbor video.');
  await run('chapter', { chapterId: 'dvd-chapter-light' });
  assert(Math.abs(video.currentTime - 2) < .05 && Math.abs(session().position - 2) < .05, 'Chapter did not seek the actual video element.');
  completed.push('decoded bundled video and actual chapter seek');
  await run('title', { titleId: 'dvd-title-shore' });
  await run('chapter', { chapterId: 'dvd-chapter-shore-light' });
  assert(Math.abs(video.currentTime - 2) < .05 && Math.abs(facade.readPlayback().position - 1) < .05, 'Excerpt title failed to translate relative time into actual source time.');
  await run('seek', { position: .55 });
  const added = await run('bookmarkAdd', { name: 'Actual browser sail frame' });
  const retained = state.bookmarks.find(row => row.id === added.bookmarkId);
  assert(Math.abs(retained.position - .55) < .05, 'Bookmark fabricated a position instead of using the video observation.');
  await run('title', { titleId: 'dvd-title-movie' });
  await run('bookmarkGo', { bookmarkId: added.bookmarkId });
  assert(session().titleId === 'dvd-title-shore' && Math.abs(video.currentTime - 1.55) < .05, 'Bookmark failed to restore actual title geometry.');
  completed.push('actual excerpt and bookmark restoration');
  await run('subtitle', { trackId: 'fr' });
  const french = [...video.textTracks].find(track => track.language === 'fr');
  assert(french?.mode === 'showing' && french.cues.length === 3 && french.cues[1].text.includes('voilier'), 'French caption selection did not enable authored real TextTrack cues.');
  await run('subtitle', { trackId: 'off' });
  assert([...video.textTracks].every(track => track.mode !== 'showing'), 'Subtitles Off left a real caption track showing.');
  await run('audioTrack', { trackId: 'score' });
  assert(score.readyState >= 1 && score.src.startsWith('data:audio/wav;base64,') && video.muted && Math.abs(score.currentTime - video.currentTime) < .15, 'Alternate audio is not an actual synchronized PCM soundtrack.');
  await run('rate', { rate: 1.5 });
  assert(video.playbackRate === 1.5 && score.playbackRate === 1.5, 'Playback speed did not affect both actual media consumers.');
  await run('play');
  assert(!video.paused && !score.paused && facade.readPlayback().playing === true, 'Play did not start the genuine original video and score.');
  await run('pause');
  assert(video.paused && score.paused && session().playing === false, 'Pause did not stop both actual media consumers.');
  completed.push('real captions, alternate soundtrack and observed playback speed');
  await run('eject');
  assert(!video.getAttribute('src') && !score.getAttribute('src') && session().discId === null && state.bookmarks.includes(retained), 'Eject failed to release actual media bytes or destroyed a bookmark.');
  await run('load'); await run('bookmarkGo', { bookmarkId: retained.id });
  assert(Math.abs(video.currentTime - 1.55) < .05, 'Reload did not preserve usable actual bookmark navigation.');
  await run('bookmarkDelete', { bookmarkId: retained.id });
  completed.push('eject releases actual sources and preserves usable bookmarks');
  return { passed: completed.length, profileId: state.profileId, checks: completed };
}
