// Local WAV/WebM codec. No host-device APIs, network media, or surrogate output.
const WAV = 'audio/wav', WEBM = 'video/webm', MAX_BYTES = 18 * 1024 * 1024;
const MIME = { 'audio/wav': WAV, 'audio/x-wav': WAV, 'audio/wave': WAV, 'audio/vnd.wave': WAV, 'video/webm': WEBM };
const QUALITY = {
  low: { sampleRate: 8000, width: 320, height: 180, fps: 15, bitrate: 250_000 },
  high: { sampleRate: 22050, width: 640, height: 360, fps: 24, bitrate: 1_500_000 },
  maximum: { sampleRate: 44100, width: 960, height: 540, fps: 30, bitrate: 5_000_000 },
};
const error = (code, message) => Object.assign(new Error(message), { code });
const fail = (code, message) => { throw error(code, message); };
function alive(guard) {
  if (guard !== undefined && typeof guard !== 'function') fail('invalid_arguments', 'guard must be a function.');
  if (guard && !guard()) fail('retired', 'The original media target has retired.');
}
// Check ownership before/after every asynchronous boundary and while it waits.
async function owned(guard, operation, timeout = 30000) {
  alive(guard);
  let timer;
  try {
    const value = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      const deadline = performance.now() + timeout;
      timer = setInterval(() => {
        try { alive(guard); if (performance.now() > deadline) reject(error('render_failed', 'Media operation timed out.')); }
        catch (reason) { reject(reason); }
      }, 25);
    })]);
    alive(guard);
    return value;
  } catch (reason) { alive(guard); throw reason; }
  finally { clearInterval(timer); }
}
const label = (bytes, offset, count) => String.fromCharCode(...bytes.subarray(offset, offset + count));
function base64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(''));
}
function envelope(content, declared) {
  if (typeof content !== 'string') fail('invalid_arguments', 'Media content must be a local data URL.');
  if (content.length > Math.ceil(MAX_BYTES / 3) * 4 + 100) fail('limit_exceeded', 'Media exceeds the 18 MiB decoded limit.');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(content);
  if (!match || match[2].length % 4) fail('invalid_content', 'Expected a canonical base64 media data URL.');
  const mime = MIME[match[1].toLowerCase()];
  if (!mime) fail('unsupported_mime', 'Only PCM WAV audio and VP8/VP9 WebM video are supported.');
  if (declared !== undefined && MIME[String(declared).toLowerCase()] !== mime) fail('unsupported_mime', 'Declared MIME does not match the media envelope.');
  let binary;
  try { binary = atob(match[2]); } catch { fail('invalid_content', 'Invalid base64 media.'); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (base64(bytes) !== match[2]) fail('invalid_content', 'Noncanonical base64 padding.');
  if (mime === WAV ? label(bytes, 0, 4) !== 'RIFF' || label(bytes, 8, 4) !== 'WAVE'
    : label(bytes, 0, 4) !== '\x1a\x45\xdf\xa3') fail('invalid_content', 'MIME and container signature disagree.');
  return { bytes, mime };
}
export function decodeMediaContent(content) { return envelope(content).bytes; }
export function encodeMediaContent(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) fail('invalid_arguments', 'Expected nonempty media bytes.');
  if (bytes.length > MAX_BYTES) fail('limit_exceeded', 'Media exceeds the 18 MiB decoded limit.');
  mime = MIME[String(mime).toLowerCase()];
  if (!mime) fail('unsupported_mime', 'Exports support WAV and WebM only.');
  const content = `data:${mime};base64,${base64(bytes)}`;
  envelope(content, mime);
  return content;
}

// samples are interleaved channel frames. Export is canonical PCM signed 16-bit.
export function parseWave(bytes, { metadataOnly = false } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 44 || label(bytes, 0, 4) !== 'RIFF' || label(bytes, 8, 4) !== 'WAVE') fail('invalid_content', 'Expected a complete RIFF/WAVE container.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.getUint32(4, true) + 8;
  if (end !== bytes.length) fail('invalid_content', 'RIFF size does not match actual bytes.');
  let fmt, data;
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) fail('invalid_content', 'Truncated WAV chunk header.');
    const size = view.getUint32(offset + 4, true), body = offset + 8;
    if (body + size > end) fail('invalid_content', 'Truncated WAV chunk payload.');
    if (label(bytes, offset, 4) === 'fmt ') {
      if (size < 16) fail('invalid_content', 'Truncated WAV format.');
      let format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true), sampleRate = view.getUint32(body + 4, true);
      const align = view.getUint16(body + 12, true), bits = view.getUint16(body + 14, true);
      if (format === 0xfffe) {
        if (size < 40 || view.getUint16(body + 16, true) < 22) fail('invalid_content', 'Truncated extensible WAV format.');
        if (label(bytes, body + 26, 14) !== '\x00\x00\x00\x00\x10\x00\x80\x00\x00\xaa\x00\x38\x9b\x71') fail('unsupported_codec', 'Unknown extensible WAV GUID.');
        format = view.getUint16(body + 24, true);
      }
      if (![1, 3].includes(format) || ![8, 16, 24, 32].includes(bits) || format === 3 && bits !== 32) fail('unsupported_codec', 'Only integer PCM and float32 WAV can be edited.');
      if (!channels || channels > 32 || sampleRate < 4000 || sampleRate > 384000 || align !== channels * bits / 8 || view.getUint32(body + 8, true) !== sampleRate * align) fail('invalid_content', 'Invalid WAV channel/rate/block alignment.');
      fmt = { format, channels, sampleRate, bits, align };
    }
    if (label(bytes, offset, 4) === 'data') data = { body, size };
    offset = body + size + (size & 1);
  }
  if (!fmt || !data || !data.size || data.size % fmt.align) fail('invalid_content', 'WAV must have complete format and sample frames.');
  if (metadataOnly) return { sampleRate: fmt.sampleRate, channels: fmt.channels, duration: data.size / fmt.align / fmt.sampleRate, bitsPerSample: fmt.bits };
  const samples = new Float32Array(data.size / (fmt.bits / 8));
  for (let i = 0, offset = data.body; i < samples.length; i++, offset += fmt.bits / 8) {
    const sample = fmt.format === 3 ? view.getFloat32(offset, true)
      : fmt.bits === 8 ? (view.getUint8(offset) - 128) / 128
        : fmt.bits === 16 ? view.getInt16(offset, true) / 32768
          : fmt.bits === 24 ? (view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getInt8(offset + 2) << 16) / 8388608
            : view.getInt32(offset, true) / 2147483648;
    if (!Number.isFinite(sample)) fail('invalid_content', 'Nonfinite WAV sample.');
    samples[i] = sample;
  }
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples, duration: samples.length / fmt.channels / fmt.sampleRate, bitsPerSample: fmt.bits };
}
export function encodeWave({ sampleRate, channels, samples }) {
  if (!Number.isInteger(sampleRate) || sampleRate < 4000 || sampleRate > 384000 || !Number.isInteger(channels) || channels < 1 || channels > 32 || !(samples instanceof Float32Array) || !samples.length || samples.length % channels) fail('invalid_arguments', 'Expected integer sample rate, channels, and nonempty interleaved Float32Array PCM.');
  if (samples.length * 2 + 44 > MAX_BYTES) fail('limit_exceeded', 'WAV exceeds the local byte limit.');
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) fail('invalid_arguments', 'PCM contains nonfinite samples.');
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
function audioOutput(samples, sampleRate, channels = 1) {
  return { content: encodeMediaContent(encodeWave({ samples, sampleRate, channels }), WAV), mime: WAV, duration: samples.length / channels / sampleRate };
}
export async function renderAudioSegments(segments, lookup, { guard, effects } = {}) {
  alive(guard);
  if (!Array.isArray(segments) || !segments.length || typeof lookup !== 'function') fail('invalid_arguments', 'Expected nonempty audio segments and asset lookup.');
  const decoded = new Map(), parts = [];
  for (const segment of segments) {
    alive(guard);
    if (!decoded.has(segment.assetId)) {
      const asset = lookup(segment.assetId);
      if (!asset) fail('invalid_arguments', 'Audio asset is missing.');
      const { bytes, mime } = envelope(asset.content, asset.mime);
      if (mime !== WAV) fail('unsupported_codec', 'Audio edits accept PCM WAV only.');
      decoded.set(segment.assetId, parseWave(bytes));
    }
    const wave = decoded.get(segment.assetId), start = segment.start ?? 0, end = segment.end ?? wave.duration;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > wave.duration + 1e-9) fail('invalid_arguments', 'Audio segment is outside actual sample bounds.');
    parts.push({ wave, start: Math.round(start * wave.sampleRate), end: Math.round(end * wave.sampleRate) });
  }
  const sampleRate = Math.max(...parts.map(part => part.wave.sampleRate));
  const channels = Math.max(...parts.map(part => part.wave.channels));
  if (parts.some(part => part.wave.channels !== channels && part.wave.channels !== 1)) fail('unsupported_codec', 'Concatenation supports matching channels or mono expansion only.');
  const frames = parts.map(part => Math.round((part.end - part.start) * sampleRate / part.wave.sampleRate));
  const samples = new Float32Array(frames.reduce((a, b) => a + b, 0) * channels);
  let offset = 0;
  parts.forEach((part, index) => {
    for (let frame = 0; frame < frames[index]; frame++) {
      const source = part.start + frame * part.wave.sampleRate / sampleRate;
      const left = Math.min(Math.floor(source), part.end - 1), right = Math.min(left + 1, part.end - 1), fraction = source - left;
      for (let ch = 0; ch < channels; ch++) {
        const sourceChannel = part.wave.channels === 1 ? 0 : ch;
        const a = part.wave.samples[left * part.wave.channels + sourceChannel], b = part.wave.samples[right * part.wave.channels + sourceChannel];
        samples[offset++] = a + (b - a) * fraction;
      }
    }
  });
  const processed = recordingEffects(samples, sampleRate, channels, effects);
  // A boundary permits retirement before emitting any output, even for PCM.
  await owned(guard, () => Promise.resolve());
  return audioOutput(processed, sampleRate, channels);
}

// EBML uses big-endian floats/integers and length-marked IDs and sizes.
function elements(bytes, start = 0, end = bytes.length) {
  const result = [];
  const vint = (offset, id) => {
    if (offset >= end) fail('invalid_content', 'Truncated EBML header.');
    let length = 1, marker = 128;
    while (length <= 8 && !(bytes[offset] & marker)) { length++; marker >>= 1; }
    if (length > (id ? 4 : 8) || offset + length > end) fail('invalid_content', 'Invalid EBML header.');
    let value = id ? bytes[offset] : bytes[offset] & (marker - 1), unknown = !id && value === marker - 1;
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[offset + i]; unknown &&= bytes[offset + i] === 255; }
    return { value, length, unknown };
  };
  while (start < end) {
    const id = vint(start, true), size = vint(start + id.length, false), body = start + id.length + size.length;
    const stop = size.unknown ? end : body + size.value;
    if (!Number.isSafeInteger(stop) || stop > end || stop < body) fail('invalid_content', 'Truncated EBML payload.');
    result.push({ id: id.value, start, body, end: stop, unknown: size.unknown });
    start = stop;
  }
  return result;
}
const uint = (bytes, element) => {
  if (!element || element.end - element.body > 8) fail('invalid_content', 'Invalid EBML integer.');
  let value = 0; for (let i = element.body; i < element.end; i++) value = value * 256 + bytes[i]; return value;
};
const ebmlText = (bytes, element) => new TextDecoder().decode(bytes.subarray(element.body, element.end));
function webm(bytes) {
  const root = elements(bytes), header = root.find(el => el.id === 0x1a45dfa3), segment = root.find(el => el.id === 0x18538067);
  if (!header || !segment) fail('invalid_content', 'WebM requires EBML header and Segment.');
  const docType = elements(bytes, header.body, header.end).find(el => el.id === 0x4282);
  if (!docType || ebmlText(bytes, docType) !== 'webm') fail('unsupported_codec', 'EBML container is not WebM.');
  const children = elements(bytes, segment.body, segment.end), info = children.find(el => el.id === 0x1549a966), tracks = children.find(el => el.id === 0x1654ae6b);
  if (!info || !tracks) fail('invalid_content', 'WebM requires Info and Tracks.');
  const infoChildren = elements(bytes, info.body, info.end), scaleElement = infoChildren.find(el => el.id === 0x2ad7b1);
  const scale = scaleElement ? uint(bytes, scaleElement) : 1000000;
  let duration = null, width = null, height = null, hasAudio = false, hasVideo = false, blocks = 0, lastTimestamp = 0;
  const trackTypes = new Map(), videoTimes = [], audioEnds = [];
  const durationElement = infoChildren.find(el => el.id === 0x4489);
  if (durationElement) {
    const size = durationElement.end - durationElement.body, view = new DataView(bytes.buffer, bytes.byteOffset + durationElement.body, size);
    if (![4, 8].includes(size)) fail('invalid_content', 'Invalid WebM Duration.');
    duration = (size === 4 ? view.getFloat32(0) : view.getFloat64(0)) * scale / 1e9;
    if (!Number.isFinite(duration) || duration <= 0) fail('invalid_content', 'Invalid WebM duration.');
  }
  for (const track of elements(bytes, tracks.body, tracks.end).filter(el => el.id === 0xae)) {
    const fields = elements(bytes, track.body, track.end), codec = fields.find(el => el.id === 0x86), type = fields.find(el => el.id === 0x83);
    if (!codec || !type) fail('invalid_content', 'Incomplete WebM track.');
    const value = ebmlText(bytes, codec), kind = uint(bytes, type);
    const number = fields.find(el => el.id === 0xd7), delay = fields.find(el => el.id === 0x56aa);
    if (!number) fail('invalid_content', 'WebM track has no number.');
    trackTypes.set(uint(bytes, number), { kind, codec: value, delay: delay ? uint(bytes, delay) / 1e9 : 0 });
    if (kind === 1) {
      if (!['V_VP8', 'V_VP9'].includes(value)) fail('unsupported_codec', `Unsupported WebM video codec ${value}.`);
      const video = fields.find(el => el.id === 0xe0);
      if (!video) fail('invalid_content', 'Missing video dimensions.');
      const fields_ = elements(bytes, video.body, video.end);
      width = uint(bytes, fields_.find(el => el.id === 0xb0)); height = uint(bytes, fields_.find(el => el.id === 0xba)); hasVideo = true;
    } else if (kind === 2) {
      if (!['A_OPUS', 'A_VORBIS'].includes(value)) fail('unsupported_codec', `Unsupported WebM audio codec ${value}.`);
      hasAudio = true;
    } else fail('unsupported_codec', 'Only audio/video WebM tracks are supported.');
  }
  for (const cluster of children.filter(el => el.id === 0x1f43b675)) {
    const fields = elements(bytes, cluster.body, cluster.end), timestamp = fields.find(el => el.id === 0xe7);
    const base = timestamp ? uint(bytes, timestamp) : 0;
    for (const el of fields) {
      const block = el.id === 0xa3 ? el : el.id === 0xa0 ? elements(bytes, el.body, el.end).find(child => child.id === 0xa1) : null;
      if (!block) continue;
      let trackLength = 1, marker = 128;
      while (trackLength <= 8 && !(bytes[block.body] & marker)) { marker >>= 1; trackLength++; }
      if (trackLength > 8 || block.end - block.body < trackLength + 4) fail('invalid_content', 'Truncated WebM media block.');
      const relative = new DataView(bytes.buffer, bytes.byteOffset + block.body + trackLength, 2).getInt16(0);
      const time = (base + relative) * scale / 1e9;
      let trackNumber = bytes[block.body] & (marker - 1);
      for (let i = 1; i < trackLength; i++) trackNumber = trackNumber * 256 + bytes[block.body + i];
      const type = trackTypes.get(trackNumber);
      if (!type) fail('invalid_content', 'WebM block references a missing track.');
      if (type.kind === 1) videoTimes.push(time);
      // Unlaced Opus packet duration is encoded in its TOC, not inferred from
      // wall time. Imported laced/Vorbis tracks retain their original metadata.
      const flags = bytes[block.body + trackLength + 2], payload = block.body + trackLength + 3;
      if (type.codec === 'A_OPUS' && !(flags & 6)) {
        const toc = bytes[payload], config = toc >> 3, code = toc & 3;
        const frameDuration = config >= 16 ? .0025 * 2 ** (config % 4) : config >= 12 ? .01 * 2 ** (config % 2) : config % 4 === 3 ? .06 : .01 * 2 ** (config % 4);
        const count = code === 0 ? 1 : code === 3 ? bytes[payload + 1] & 63 : 2;
        if (!count || count * frameDuration > .120001) fail('invalid_content', 'Invalid Opus packet duration.');
        audioEnds.push(time + count * frameDuration - type.delay);
      }
      lastTimestamp = Math.max(lastTimestamp, time); blocks++;
    }
  }
  if (!hasVideo || !width || !height || !blocks) fail('invalid_content', 'WebM has no actual video track/frames.');
  return { duration, width, height, hasAudio, lastTimestamp, videoTimes, audioEnds, segment, children, info, infoChildren, scale };
}
export function validateMediaContent(content, mime) {
  const decoded = envelope(content, mime);
  const meta = decoded.mime === WAV ? parseWave(decoded.bytes, { metadataOnly: true }) : webm(decoded.bytes);
  return { mime: decoded.mime, size: decoded.bytes.length, duration: meta.duration, width: meta.width ?? null, height: meta.height ?? null };
}
export async function inspectMediaContent(content, mime, { guard } = {}) {
  alive(guard);
  const decoded = envelope(content, mime);
  if (decoded.mime === WAV) {
    const wave = parseWave(decoded.bytes, { metadataOnly: true });
    return { mime: WAV, duration: wave.duration, sampleRate: wave.sampleRate, channels: wave.channels, width: null, height: null };
  }
  const meta = webm(decoded.bytes);
  if (meta.duration !== null) return { mime: WEBM, duration: meta.duration, width: meta.width, height: meta.height, hasAudio: meta.hasAudio };
  const video = await loadVideo(content, guard);
  try {
    if (!Number.isFinite(video.duration)) {
      const seeking = event(video, 'seeked', guard); video.currentTime = 1e10; await seeking;
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) fail('unsupported_content', 'The WebM decoder cannot determine actual duration.');
    return { mime: WEBM, duration: video.duration, width: video.videoWidth, height: video.videoHeight, hasAudio: meta.hasAudio };
  } finally { releaseVideo(video); }
}

// Browser recording output carries real Duration metadata (streaming recorder
// output often omits it). Only this newly authored recorder output is rewritten;
// imported files and their seek/cue offsets are never modified.
function join(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out;
}
function sizeBytes(value) {
  let length = 1; while (value >= 2 ** (7 * length) - 1) length++;
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) { bytes[i] = value % 256; value = Math.floor(value / 256); }
  bytes[0] |= 1 << (8 - length); return bytes;
}
function durationWebm(bytes, fallbackFrameDuration) {
  const meta = webm(bytes), duration = new Uint8Array(11), times = meta.videoTimes.sort((a, b) => a - b);
  const last = times.at(-1), previous = times.findLast(time => time < last);
  const tail = previous === undefined ? fallbackFrameDuration : last - previous;
  const seconds = Math.max(last + tail, ...meta.audioEnds);
  if (!Number.isFinite(seconds) || seconds <= 0) fail('invalid_content', 'Recorder stream lacks actual frame timing.');
  duration.set([0x44, 0x89, 0x88]); new DataView(duration.buffer).setFloat64(3, seconds * 1e9 / meta.scale);
  const infoPayload = join([...meta.infoChildren.filter(el => el.id !== 0x4489).map(el => bytes.subarray(el.start, el.end)), duration]);
  const info = join([bytes.subarray(meta.info.start, meta.info.start + 4), sizeBytes(infoPayload.length), infoPayload]);
  const payload = join(meta.children.map(el => el.id === 0x1549a966 ? info : bytes.subarray(el.start, el.end)));
  // A recorder stream must not contain indexed offsets invalidated by insertion.
  if (meta.children.some(el => [0x114d9b74, 0x1c53bb6b].includes(el.id))) fail('unsupported_codec', 'Indexed recorder output cannot be duration-patched safely.');
  return { bytes: join([bytes.subarray(0, meta.segment.start + 4), sizeBytes(payload.length), payload]), duration: seconds };
}
function recorderMime() {
  if (typeof MediaRecorder !== 'function') return null;
  return ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find(mime => MediaRecorder.isTypeSupported(mime)) ?? null;
}
export function mediaCodecSupport() {
  const mime = recorderMime(), canvas = typeof HTMLCanvasElement === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  const available = Boolean(mime && canvas && typeof document !== 'undefined');
  const audioAvailable = Boolean(globalThis.AudioContext ?? globalThis.webkitAudioContext);
  return {
    audio: { import: [WAV], export: [WAV], pcm: [8, 16, 24, 32], float: [32] },
    video: { import: [WEBM], export: available ? [WEBM] : [], codecs: ['vp8', 'vp9'], audioCodecs: ['opus', 'vorbis'], available, withAudioAvailable: available && audioAvailable, recorderMime: available ? mime : null },
    movie: { available: available && audioAvailable },
    screen: { available, requiresCaptureFrame: true },
    hostCapture: false, qualities: Object.keys(QUALITY), recordingKinds: ['audio', 'movie', 'screen'],
  };
}
function canvas(width, height) {
  if (!mediaCodecSupport().video.available) fail('unsupported_environment', 'Real MediaRecorder + canvas.captureStream WebM encoding is unavailable.');
  const value = document.createElement('canvas'); value.width = width; value.height = height;
  if (!value.getContext('2d')) fail('unsupported_environment', 'Canvas drawing is unavailable.'); return value;
}
function recording(stream, bitrate) {
  const recorder = new MediaRecorder(stream, { mimeType: recorderMime(), videoBitsPerSecond: bitrate }), chunks = [];
  let failure;
  recorder.addEventListener('dataavailable', event_ => { if (event_.data.size) chunks.push(event_.data); });
  recorder.addEventListener('error', event_ => { failure = event_.error ?? error('render_failed', 'Recorder failed.'); });
  const stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
  recorder.start(100);
  return { recorder, async finish() {
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    if (failure) throw failure;
    const bytes = new Uint8Array(await new Blob(chunks, { type: WEBM }).arrayBuffer());
    if (!bytes.length) fail('render_failed', 'Recorder emitted no media bytes.'); return bytes;
  }, async dispose() {
    if (recorder.state !== 'inactive') { recorder.stop(); await stopped; }
    for (const track of stream.getTracks()) track.stop();
  } };
}
function event(element, name, guard) {
  let clean;
  const pending = new Promise((resolve, reject) => {
    const done = () => { clean(); resolve(); }, failed = () => { clean(); reject(error('invalid_content', 'Browser media decoding failed.')); };
    clean = () => { element.removeEventListener(name, done); element.removeEventListener('error', failed); };
    element.addEventListener(name, done, { once: true }); element.addEventListener('error', failed, { once: true });
  });
  return owned(guard, () => pending).finally(() => clean());
}
async function loadVideo(content, guard) {
  if (typeof document === 'undefined') fail('unsupported_environment', 'Video decoding requires browser media elements.');
  const video = document.createElement('video'); video.preload = 'auto'; video.playsInline = true;
  try { const loaded = event(video, 'loadeddata', guard); video.src = content; video.load(); await loaded; return video; }
  catch (reason) { releaseVideo(video); throw reason; }
}
function releaseVideo(video) { video.pause(); video.removeAttribute('src'); video.load(); }
const tick = guard => owned(guard, () => new Promise(resolve => setTimeout(resolve, 1000 / 60)));
async function seekVideo(video, time, guard) {
  if (Math.abs(video.currentTime - time) < 0.0001 && video.readyState >= 2) return;
  const seeked = event(video, 'seeked', guard); video.currentTime = time; await seeked;
}
function audioContext() {
  const Constructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Constructor) fail('unsupported_environment', 'AudioContext is required to preserve the source soundtrack.');
  return new Constructor();
}
function transformed(context, surface, video, segment) {
  const rotation = ((segment.rotation ?? 0) % 360 + 360) % 360, radians = rotation * Math.PI / 180;
  const w = video.videoWidth, h = video.videoHeight;
  const boundsW = Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians)), boundsH = Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians));
  const scale = Math.min(surface.width / boundsW, surface.height / boundsH);
  context.setTransform(1, 0, 0, 1, 0, 0); context.fillStyle = '#000'; context.fillRect(0, 0, surface.width, surface.height);
  context.save(); context.translate(surface.width / 2, surface.height / 2); context.rotate(radians);
  context.scale(scale * (segment.flipH ? -1 : 1), scale * (segment.flipV ? -1 : 1)); context.drawImage(video, -w / 2, -h / 2); context.restore();
}
export async function renderVideoSegments(segments, lookup, { guard, quality = 'high' } = {}) {
  alive(guard);
  if (!Array.isArray(segments) || !segments.length || typeof lookup !== 'function' || !QUALITY[quality]) fail('invalid_arguments', 'Expected video segments, lookup and low/high/maximum quality.');
  const videos = new Map(), surface = canvas(320, 180);
  let audio, session, stream;
  try {
    let hasAudio = false;
    for (const segment of segments) {
      if (!Number.isFinite(segment.rotation ?? 0)) fail('invalid_arguments', 'Invalid video rotation.');
      if (videos.has(segment.assetId)) continue;
      const asset = lookup(segment.assetId);
      if (!asset) fail('invalid_arguments', 'Video asset is missing.');
      const decoded = envelope(asset.content, asset.mime);
      if (decoded.mime !== WEBM) fail('unsupported_codec', 'Video edits require WebM media.');
      hasAudio ||= webm(decoded.bytes).hasAudio;
      videos.set(segment.assetId, await loadVideo(asset.content, guard));
    }
    const first = videos.get(segments[0].assetId), rotation = ((segments[0].rotation ?? 0) % 180 + 180) % 180;
    surface.width = rotation === 90 ? first.videoHeight : first.videoWidth; surface.height = rotation === 90 ? first.videoWidth : first.videoHeight;
    const context = surface.getContext('2d'); stream = surface.captureStream(QUALITY[quality].fps);
    if (hasAudio) {
      audio = audioContext(); const destination = audio.createMediaStreamDestination();
      for (const video of videos.values()) audio.createMediaElementSource(video).connect(destination);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      await owned(guard, () => audio.resume());
    } else for (const video of videos.values()) video.muted = true;
    session = recording(stream, QUALITY[quality].bitrate);
    session.recorder.pause();
    for (const segment of segments) {
      const video = videos.get(segment.assetId), start = segment.start ?? 0, end = segment.end ?? video.duration;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > video.duration + 0.001) fail('invalid_arguments', 'Video segment is outside decoded duration.');
      await seekVideo(video, start, guard); transformed(context, surface, video, segment);
      await owned(guard, () => video.play()); session.recorder.resume();
      const began = performance.now();
      while (!video.ended && video.currentTime < end) {
        alive(guard); transformed(context, surface, video, segment); await tick(guard);
        if (performance.now() - began > (end - start) * 1000 + 5000) fail('render_failed', 'Video playback stalled during rendering.');
      }
      session.recorder.pause(); video.pause();
    }
    const bytes = await owned(guard, () => session.finish());
    const output = durationWebm(bytes, 1 / QUALITY[quality].fps); alive(guard);
    return { content: encodeMediaContent(output.bytes, WEBM), mime: WEBM, duration: output.duration };
  } finally {
    if (session) await session.dispose(); else if (stream) for (const track of stream.getTracks()) track.stop();
    for (const video of videos.values()) releaseVideo(video);
    if (audio) await audio.close();
  }
}

function seed(text) { let hash = 2166136261; for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return hash >>> 0; }
function recordingEffects(samples, sampleRate, channels, effects = {}) {
  let result = samples;
  if (effects.enhanceRecording) {
    result = Float32Array.from(samples, sample => Math.tanh(sample * 1.65));
  }
  if (effects.skipSilence) {
    const window = Math.max(1, Math.round(sampleRate * 0.05)) * channels, chunks = [];
    for (let start = 0; start < result.length; start += window) {
      const stop = Math.min(start + window, result.length); let energy = 0;
      for (let i = start; i < stop; i++) energy += result[i] ** 2;
      if (energy / (stop - start) > 0.00015) chunks.push(result.subarray(start, stop));
    }
    if (chunks.length) {
      const output = new Float32Array(chunks.reduce((sum, part) => sum + part.length, 0));
      let offset = 0; for (const part of chunks) { output.set(part, offset); offset += part.length; } result = output;
    }
  }
  return result;
}
function scene(context, width, height, time, input) {
  const hash = seed(input);
  context.fillStyle = hash % 2 ? '#90cde3' : '#9dc2dd'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#ffe18a'; context.beginPath(); context.arc(width * .8, height * .2, height * .09, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#206688'; context.fillRect(0, height * .6, width, height * .4);
  context.fillStyle = '#f7e4bf'; context.fillRect(width * .1, height * .34, width * .035, height * .27);
  context.fillStyle = '#aa4448'; context.fillRect(width * .09, height * .31, width * .055, height * .045);
  const x = width * (.3 + ((time * .08 + hash % 100 / 1000) % .5));
  context.fillStyle = '#f4bc65'; context.fillRect(x, height * .57, width * .13, height * .045);
  context.fillStyle = '#fef5db'; context.beginPath(); context.moveTo(x + width * .06, height * .55); context.lineTo(x + width * .06, height * .32); context.lineTo(x + width * .13, height * .55); context.fill();
  context.fillStyle = '#fff'; context.font = `${Math.max(10, height * .055)}px sans-serif`; context.fillText(`Fictional ${String(input)} · ${time.toFixed(1)}s`, width * .03, height * .95);
}
async function captureDrawable(value, guard) {
  const source = value?.canvas ?? value?.content ?? value?.dataURL ?? value;
  if (typeof source === 'string') {
    if (!source.startsWith('data:image/')) fail('invalid_capture', 'Capture frame images must be local data URLs.');
    const image = new Image(); image.src = source; await owned(guard, () => image.decode()); return image;
  }
  const valid = ['HTMLCanvasElement', 'OffscreenCanvas', 'ImageBitmap', 'HTMLImageElement', 'HTMLVideoElement'].some(name => typeof globalThis[name] === 'function' && source instanceof globalThis[name]);
  if (!valid) fail('invalid_capture', 'Capture callback must return a drawable original frame.');
  return source;
}
export async function recordFictionalInput({ kind, source = 'harbor', quality = 'high', duration = 5, captureFrame, guard, effects } = {}) {
  alive(guard);
  if (!['audio', 'movie', 'screen'].includes(kind) || !QUALITY[quality] || !Number.isFinite(duration) || duration <= 0 || duration > 120) fail('invalid_arguments', 'Recording requires audio/movie/screen, low/high/maximum quality and duration (0,120] seconds.');
  if (kind === 'screen' && typeof captureFrame !== 'function') fail('capture_unavailable', 'Screen recording requires the original captureFrame callback.');
  const settings = QUALITY[quality], hash = seed(source), pitch = 120 + hash % 220;
  if (kind === 'audio') {
    const samples = new Float32Array(Math.round(duration * settings.sampleRate));
    for (let i = 0; i < samples.length; i++) {
      const time = i / settings.sampleRate, age = time % 1.7;
      const envelope_ = age < 1.2 ? Math.min(1, age / .08, (1.2 - age) / .14) : 0;
      samples[i] = (Math.sin(2 * Math.PI * pitch * time) + .25 * Math.sin(2 * Math.PI * pitch * 2.01 * time)) * .35 * envelope_;
    }
    await owned(guard, () => Promise.resolve());
    return audioOutput(recordingEffects(samples, settings.sampleRate, 1, effects), settings.sampleRate);
  }
  const surface = canvas(settings.width, settings.height), context = surface.getContext('2d'), stream = surface.captureStream(settings.fps);
  let audio, oscillator, session;
  try {
    if (kind === 'movie') {
      audio = audioContext(); const destination = audio.createMediaStreamDestination(), gain = audio.createGain();
      oscillator = audio.createOscillator(); oscillator.frequency.value = pitch; gain.gain.value = .06;
      oscillator.connect(gain); gain.connect(destination);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      await owned(guard, () => audio.resume()); oscillator.start();
    }
    if (kind === 'screen') {
      const initial = await owned(guard, () => captureFrame({ time: 0, width: surface.width, height: surface.height, guard }));
      const drawable = await captureDrawable(initial, guard); alive(guard); context.drawImage(drawable, 0, 0, surface.width, surface.height);
    } else scene(context, surface.width, surface.height, 0, source);
    session = recording(stream, settings.bitrate); const started = performance.now();
    while ((performance.now() - started) / 1000 < duration) {
      alive(guard); const time = (performance.now() - started) / 1000;
      if (kind === 'screen') {
        const frame = await owned(guard, () => captureFrame({ time, width: surface.width, height: surface.height, guard }));
        const drawable = await captureDrawable(frame, guard); alive(guard); context.drawImage(drawable, 0, 0, surface.width, surface.height);
      } else scene(context, surface.width, surface.height, time, source);
      await tick(guard);
    }
    const bytes = await owned(guard, () => session.finish());
    const output = durationWebm(bytes, 1 / settings.fps); alive(guard);
    return { content: encodeMediaContent(output.bytes, WEBM), mime: WEBM, duration: output.duration };
  } finally {
    if (session) await session.dispose(); else for (const track of stream.getTracks()) track.stop();
    if (oscillator) oscillator.stop(); if (audio) await audio.close();
  }
}
