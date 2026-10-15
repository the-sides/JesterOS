import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { decodeMediaContent, encodeMediaContent, parseWave, encodeWave, validateMediaContent,
  inspectMediaContent, renderAudioSegments, renderVideoSegments, recordFictionalInput, mediaCodecSupport } from '../frontend/src/media-codec.js';
import { MEDIA_FIXTURES, MEDIA_STORE_CATALOG, MEDIA_VIDEO_FIXTURE } from '../frontend/src/media-fixtures.js';

const asset = (id, samples, sampleRate = 8000, channels = 1) => ({ id, mime: 'audio/wav', content: encodeMediaContent(encodeWave({ sampleRate, channels, samples: Float32Array.from(samples) }), 'audio/wav') });
const wave = output => parseWave(decodeMediaContent(output.content));
const code = (fn, expected) => {
  let thrown;
  try { fn(); } catch (reason) { thrown = reason; }
  expect(thrown?.code).toBe(expected);
};
const sameSamples = (actual, expected) => {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) expect(Math.abs(actual[i] - expected[i])).toBeLessThan(2 / 32768);
};

describe('actual authored local fixtures', () => {
  test('library has every kind, exact canonical asset keys, and real container durations', async () => {
    expect(new Set(MEDIA_FIXTURES.map(asset => asset.kind))).toEqual(new Set(['music', 'movie', 'tv', 'podcast', 'audiobook', 'recording']));
    expect(new Set([...MEDIA_FIXTURES, ...MEDIA_STORE_CATALOG].map(asset => asset.id)).size).toBe(MEDIA_FIXTURES.length + MEDIA_STORE_CATALOG.length);
    for (const source of [...MEDIA_FIXTURES, ...MEDIA_STORE_CATALOG]) {
      expect(Object.keys(source).sort()).toEqual(['id', 'title', 'artist', 'album', 'kind', 'mime', 'content', 'duration', 'artwork'].sort());
      expect(source.artwork.startsWith('data:image/svg+xml;base64,')).toBe(true);
      const bytes = decodeMediaContent(source.content);
      expect(encodeMediaContent(bytes, source.mime)).toBe(source.content);
      const meta = await inspectMediaContent(source.content, source.mime);
      expect(Math.abs(meta.duration - source.duration)).toBeLessThan(.00001);
      expect(validateMediaContent(source.content, source.mime).duration).toBe(meta.duration);
      if (source.mime === 'audio/wav') expect(wave(source).samples.some(sample => Math.abs(sample) > .1)).toBe(true);
    }
  });
  test('independent ffprobe and ffmpeg decode the bundled VP8+Opus harbor media', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'jesteros-media-codec-'));
    try {
      const file = join(folder, 'harbor.webm'); await writeFile(file, decodeMediaContent(MEDIA_VIDEO_FIXTURE.content));
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
      expect(probe.streams.map(stream => stream.codec_name)).toEqual(['vp8', 'opus']);
      expect(probe.streams[0].width).toBe(192); expect(probe.streams[0].height).toBe(108);
      expect(Number(probe.format.duration)).toBeCloseTo(MEDIA_VIDEO_FIXTURE.duration, 3);
      const audio = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-vn', '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1']);
      expect(audio.length).toBeGreaterThan(47000);
      expect(audio.some(byte => byte !== 0)).toBe(true);
      const pixels = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      expect(pixels.length).toBe(192 * 108 * 3);
      const sky = pixels.subarray(3 * (10 * 192 + 80), 3 * (10 * 192 + 80) + 3);
      const sea = pixels.subarray(3 * (100 * 192 + 80), 3 * (100 * 192 + 80) + 3);
      expect([...sky]).not.toEqual([...sea]);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});

describe('PCM edits preserve actual timeline samples', () => {
  test('trim is sample-accurate and does not change original content', async () => {
    const original = asset('a', [.1, .2, .3, .4, .5, .6, .7, .8]);
    const before = original.content;
    const output = await renderAudioSegments([{ assetId: 'a', start: 2 / 8000, end: 6 / 8000 }], () => original);
    expect(output.mime).toBe('audio/wav'); expect(output.duration).toBe(4 / 8000);
    sameSamples(wave(output).samples, [.3, .4, .5, .6]); expect(original.content).toBe(before);
  });
  test('concat/reorder/split and replacement keep exact frame counts without hidden crossfades', async () => {
    const a = asset('a', [.1, .2, .3, .4]), b = asset('b', [-.1, -.2, -.3, -.4]);
    const lookup = id => id === 'a' ? a : b;
    const sections = [{ assetId: 'a', start: 0, end: 2 / 8000 }, { assetId: 'b', start: 0, end: 4 / 8000 }, { assetId: 'a', start: 2 / 8000, end: 4 / 8000 }];
    const replacement = await renderAudioSegments(sections, lookup);
    sameSamples(wave(replacement).samples, [.1, .2, -.1, -.2, -.3, -.4, .3, .4]);
    expect(replacement.duration).toBe(8 / 8000);
    const saved = { ...a, ...replacement };
    const reopened = await renderAudioSegments([{ assetId: 'a', start: 2 / 8000, end: 6 / 8000 }], () => saved);
    sameSamples(wave(reopened).samples, [-.1, -.2, -.3, -.4]);
    expect(a.content).not.toBe(replacement.content);
  });
  test('stereo remains interleaved; mixed rates resample actual PCM', async () => {
    const stereo = asset('stereo', [.1, -.1, .2, -.2, .3, -.3], 8000, 2);
    const output = await renderAudioSegments([{ assetId: 'stereo', start: 1 / 8000, end: 3 / 8000 }], () => stereo);
    expect(wave(output).channels).toBe(2); sameSamples(wave(output).samples, [.2, -.2, .3, -.3]);
    const a = asset('a', [0, .5, 1, .5]), b = asset('b', [.25, .25, .25, .25], 16000);
    const mixed = await renderAudioSegments([{ assetId: 'a', start: 0, end: 4 / 8000 }, { assetId: 'b', start: 0, end: 4 / 16000 }], id => id === 'a' ? a : b);
    expect(wave(mixed).sampleRate).toBe(16000); expect(wave(mixed).samples.length).toBe(12);
    sameSamples(wave(mixed).samples.subarray(0, 4), [0, .25, .5, .75]);
  });
});

describe('honest MIME/container and unsupported-format errors', () => {
  const example = asset('a', [.1, .2, .3]).content;
  test('rejects wrong MIME, host/network URLs, invalid base64 and header-only fake containers', () => {
    code(() => validateMediaContent(example, 'video/webm'), 'unsupported_mime');
    code(() => decodeMediaContent('https://example.invalid/media.wav'), 'invalid_content');
    code(() => decodeMediaContent(example + '\n'), 'invalid_content');
    code(() => decodeMediaContent('data:audio/wav;base64,AAAA'), 'invalid_content');
    code(() => validateMediaContent('data:video/webm;base64,GkXfow=='), 'invalid_content');
    const bytes = decodeMediaContent(example).slice(); new DataView(bytes.buffer).setUint32(40, 500, true);
    code(() => validateMediaContent(encodeMediaContent(bytes, 'audio/wav')), 'invalid_content');
  });
  test('MP3/AAC/OGG/FLAC/AIFF/MOV/MP4 never pretend to be supported', () => {
    for (const mime of ['audio/mpeg', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/aiff', 'video/quicktime', 'video/mp4']) {
      code(() => validateMediaContent(example.replace('audio/wav', mime)), 'unsupported_mime');
      code(() => encodeMediaContent(decodeMediaContent(example), mime), 'unsupported_mime');
    }
    const bytes = decodeMediaContent(example).slice(); new DataView(bytes.buffer).setUint16(20, 85, true);
    code(() => parseWave(bytes), 'unsupported_codec');
  });
  test('PCM corruption and nonfinite samples have structured failures', () => {
    code(() => encodeWave({ sampleRate: 8000, channels: 1, samples: Float32Array.of(NaN) }), 'invalid_arguments');
    code(() => parseWave(decodeMediaContent(example).subarray(0, 43)), 'invalid_content');
  });
});

describe('fictional recording bytes and retirement', () => {
  test('source, quality, enhancement, and silence skipping genuinely affect PCM', async () => {
    const plain = await recordFictionalInput({ kind: 'audio', source: 'harbor', quality: 'high', duration: 3.4 });
    const other = await recordFictionalInput({ kind: 'audio', source: 'studio', quality: 'high', duration: 3.4 });
    const low = await recordFictionalInput({ kind: 'audio', source: 'harbor', quality: 'low', duration: 3.4 });
    const max = await recordFictionalInput({ kind: 'audio', source: 'harbor', quality: 'maximum', duration: 3.4 });
    const enhanced = await recordFictionalInput({ kind: 'audio', source: 'harbor', quality: 'high', duration: 3.4, effects: { enhanceRecording: true } });
    const skipped = await recordFictionalInput({ kind: 'audio', source: 'harbor', quality: 'high', duration: 3.4, effects: { skipSilence: true } });
    expect(plain.content).not.toBe(other.content); expect(plain.content).not.toBe(enhanced.content);
    expect(wave(low).sampleRate).toBe(8000); expect(wave(max).sampleRate).toBe(44100);
    expect(wave(skipped).duration).toBeLessThan(wave(plain).duration); expect(skipped.duration).toBe(wave(skipped).duration);
    expect(enhanced.duration).toBe(plain.duration);
    expect((await recordFictionalInput({ kind: 'audio', source: 'harbor', quality: 'high', duration: 3.4 })).content).toBe(plain.content);
  });
  test('guards reject before work and retire at the asynchronous output boundary', async () => {
    await expect(recordFictionalInput({ kind: 'audio', guard: () => false })).rejects.toMatchObject({ code: 'retired' });
    const original = asset('a', [.1, .2, .3, .4]); let current = true;
    const task = renderAudioSegments([{ assetId: 'a', start: 0, end: 4 / 8000 }], () => original, { guard: () => current });
    current = false; await expect(task).rejects.toMatchObject({ code: 'retired' });
    await expect(inspectMediaContent(original.content, original.mime, { guard: () => false })).rejects.toMatchObject({ code: 'retired' });
  });
  test('screen requires an original callback, and native encoder absence stays explicit', async () => {
    await expect(recordFictionalInput({ kind: 'screen' })).rejects.toMatchObject({ code: 'capture_unavailable' });
    await expect(recordFictionalInput({ kind: 'audio', quality: 'medium' })).rejects.toMatchObject({ code: 'invalid_arguments' });
    const support = mediaCodecSupport(); expect(support.hostCapture).toBe(false); expect(support.screen.requiresCaptureFrame).toBe(true);
    expect(support.audio.export).toEqual(['audio/wav']); expect(support.qualities).toEqual(['low', 'high', 'maximum']);
    if (!support.video.available) {
      await expect(recordFictionalInput({ kind: 'screen', captureFrame: () => null })).rejects.toMatchObject({ code: 'unsupported_environment' });
      await expect(renderVideoSegments([{ assetId: MEDIA_VIDEO_FIXTURE.id, start: 0, end: 1 }], () => MEDIA_VIDEO_FIXTURE)).rejects.toMatchObject({ code: 'unsupported_environment' });
    }
  });
});
