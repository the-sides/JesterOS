// Run this exported function in a real Chromium page after a user activation.
// Pass the actual /src/media-codec.js and /src/media-fixtures.js module objects.
// No device access, mocked recorder, fake stream, fabricated pixels or clocks.
export async function runMediaCodecBrowserRegression(codec, fixtures) {
  const completed = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const check = async (name, action) => { await action(); completed.push(name); };
  const timeout = operation => Promise.race([operation, new Promise((_, reject) => setTimeout(() => reject(new Error('Browser regression timed out.')), 15000))]);
  const event = (element, name) => timeout(new Promise((resolve, reject) => {
    element.addEventListener(name, resolve, { once: true }); element.addEventListener('error', reject, { once: true });
  }));
  const pixels = async (output, position = .12) => {
    const video = document.createElement('video'); video.muted = true; video.playsInline = true;
    try {
      const loaded = event(video, 'loadeddata'); video.src = output.content; video.load(); await loaded;
      const sought = event(video, 'seeked'); video.currentTime = Math.min(position, video.duration / 2); await sought;
      const surface = document.createElement('canvas'); surface.width = video.videoWidth; surface.height = video.videoHeight;
      const context = surface.getContext('2d'); context.drawImage(video, 0, 0);
      return { width: surface.width, height: surface.height, duration: video.duration,
        rgb: (x, y) => [...context.getImageData(Math.floor(x * surface.width), Math.floor(y * surface.height), 1, 1).data].slice(0, 3) };
    } finally { video.pause(); video.removeAttribute('src'); video.load(); }
  };
  const original = fixtures.MEDIA_VIDEO_FIXTURE, lookup = () => original;
  assert(codec.mediaCodecSupport().video.available, 'Browser has no genuine WebM recording capability.');
  await check('real decoded source frames and soundtrack', async () => {
    const frame = await pixels(original);
    assert(frame.width === 192 && frame.height === 108, 'Source dimensions are not actual harbor pixels.');
    assert(frame.rgb(.4, .1).join() !== frame.rgb(.4, .9).join(), 'Source frame is not a harbor scene.');
    assert((await codec.inspectMediaContent(original.content, original.mime)).hasAudio, 'Fixture soundtrack is missing.');
  });
  await check('trim/split/reorder preserve actual video and audio output', async () => {
    const output = await codec.renderVideoSegments([{ assetId: original.id, start: 1.2, end: 1.7 }, { assetId: original.id, start: .2, end: .7 }], lookup, { guard: () => true, quality: 'high' });
    const meta = await codec.inspectMediaContent(output.content, output.mime), frame = await pixels(output);
    assert(meta.hasAudio, 'Editing discarded the actual source soundtrack.');
    assert(Math.abs(meta.duration - output.duration) < .00001, 'Export metadata does not match actual encoded duration.');
    assert(output.duration > .8 && output.duration < 1.5, 'Edited output has not trimmed the actual timeline.');
    assert(frame.width === 192 && frame.height === 108 && frame.rgb(.4, .1).join() !== frame.rgb(.4, .9).join(), 'Output does not decode to genuine edited harbor frames.');
  });
  await check('horizontal flip and quarter-turn operate on decoded original pixels', async () => {
    const flipped = await codec.renderVideoSegments([{ assetId: original.id, start: .1, end: .6, flipH: true }], lookup);
    const rotated = await codec.renderVideoSegments([{ assetId: original.id, start: .1, end: .6, rotation: 90 }], lookup);
    const source = await pixels(original), flip = await pixels(flipped), turn = await pixels(rotated);
    assert(turn.width === 108 && turn.height === 192, 'Quarter-turn export did not rotate dimensions.');
    const expected = source.rgb(.13, .4), observed = flip.rgb(.87, .4);
    assert(expected.every((channel, i) => Math.abs(channel - observed[i]) < 35), 'Flip did not move the decoded lighthouse pixels.');
  });
  await check('fictional movie source/quality changes actual frames and dimensions', async () => {
    const a = await codec.recordFictionalInput({ kind: 'movie', source: 'A', quality: 'low', duration: .6 });
    const b = await codec.recordFictionalInput({ kind: 'movie', source: 'B', quality: 'maximum', duration: .6 });
    const frameA = await pixels(a), frameB = await pixels(b);
    assert(frameA.width === 320 && frameB.width === 960, 'Quality did not change actual encoded resolution.');
    assert(frameA.rgb(.5, .1).join() !== frameB.rgb(.5, .1).join(), 'Source selection did not change actual scene pixels.');
    assert((await codec.inspectMediaContent(a.content)).hasAudio && (await codec.inspectMediaContent(b.content)).hasAudio, 'Fictional movie soundtrack was not really encoded.');
  });
  await check('screen recording consumes original asynchronous callback with exact capture spec', async () => {
    const surface = document.createElement('canvas'); surface.width = 192; surface.height = 108;
    const context = surface.getContext('2d'); let frames = 0;
    const output = await codec.recordFictionalInput({ kind: 'screen', quality: 'low', duration: .6, guard: () => true, captureFrame: async spec => {
      assert(typeof spec.time === 'number' && spec.width === 320 && spec.height === 180 && typeof spec.guard === 'function', 'Original capture spec is missing.');
      frames++; context.fillStyle = '#e2293c'; context.fillRect(0, 0, 192, 108); return surface;
    } });
    const frame = await pixels(output);
    assert(frames > 3, 'Screen output did not collect frames over its active lifecycle.');
    const [r, g, b] = frame.rgb(.5, .5); assert(r > 180 && g < 90 && b < 110, 'Screen recording fabricated a harbor scene instead of consuming original callback pixels.');
    assert(Math.abs((await codec.inspectMediaContent(output.content)).duration - output.duration) < .00001, 'Screen recording cannot reopen its finalized duration.');
  });
  await check('guard retirement during original screen capture rejects instead of returning output', async () => {
    const surface = document.createElement('canvas'); surface.width = 192; surface.height = 108;
    let current = true, rejected;
    try {
      await codec.recordFictionalInput({ kind: 'screen', quality: 'low', duration: 1, guard: () => current, captureFrame: async () => { current = false; return surface; } });
    } catch (reason) { rejected = reason; }
    assert(rejected?.code === 'retired', 'Retired original callback still emitted media output.');
  });
  return { passed: completed.length, checks: completed };
}
