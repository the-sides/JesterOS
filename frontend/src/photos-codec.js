import { defaultPhotoEdits, photoEditsSchema, photosSchemaValid, photoContentValid } from './photos-state.js';
import { copyCanonicalData } from './canonical-data.js';
import { photoGeometry } from './photos-geometry.js';
export { photoGeometry } from './photos-geometry.js';

// Genuine local image pixels and authored canvas capture. No host media devices.
const ALWAYS = () => true;
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const EFFECTS = ['normal', 'mono', 'sepia', 'thermal', 'mirror'];
const PIXELS = 4 * 1024 * 1024, EDGE = 8192, CONTENT = 12 * 1024 * 1024;
const defaults = defaultPhotoEdits();
Object.freeze(defaults.crop); Object.freeze(defaults.marks);
export const PHOTO_DEFAULT_EDITS = Object.freeze(defaults);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function current(guard) {
  if (typeof guard !== 'function') fail('invalid_arguments', 'Expected a Photos ownership guard.');
  if (guard() !== true) fail('stale_target', 'The original Photos source or view is no longer current.');
}
async function owned(operation, guard) {
  current(guard);
  try { const value = await operation(); current(guard); return value; }
  catch (error) { current(guard); throw error; }
}
function bounds(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    fail('unsupported_content', 'The image has invalid actual pixel dimensions.');
  if (width > EDGE || height > EDGE || width * height > PIXELS)
    fail('limit_exceeded', 'Photos supports up to 8192 pixels per edge and 4Mi raster pixels.');
  return { width, height };
}
/** Closed canonical full edits. Mark coordinates address FINAL output axes. */
export function validatePhotoEdits(edits) {
  if (!photosSchemaValid(edits, photoEditsSchema)) return false;
  if (edits.crop.x + edits.crop.width > 1.0000001 || edits.crop.y + edits.crop.height > 1.0000001
    || edits.resize && edits.resize.width * edits.resize.height > PIXELS) return false;
  if (new Set(edits.marks.map(mark => mark.id)).size !== edits.marks.length) return false;
  return edits.marks.every(mark => mark.x + mark.width <= 1.0000001 && mark.y + mark.height <= 1.0000001
    && (!mark.text || ['text', 'signature'].includes(mark.kind))
    && (!['pen', 'highlighter', 'drawing', 'highlight', 'line'].includes(mark.kind) || mark.points.length >= 2)
    && (!['rectangle', 'ellipse'].includes(mark.kind) || mark.width > 0 && mark.height > 0)
    && (mark.kind !== 'text' || !!mark.text) && (mark.kind !== 'signature' || !!mark.text || mark.points.length >= 2));
}
function data(bytes, mime) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
function sourceBytes(content, mime) {
  if (!IMAGE_MIMES.includes(mime)) fail('unsupported_content', 'Photos requires local PNG, JPEG or WebP bytes.');
  if (typeof content !== 'string' || content.length > CONTENT || !photoContentValid(content, mime))
    fail('unsupported_content', 'The source is not a bounded, matching raster data URL.');
  const encoded = content.slice(content.indexOf(',') + 1), binary = atob(encoded);
  if (btoa(binary) !== encoded) fail('unsupported_content', 'The raster base64 is not canonical.');
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
/** Optional engine seam uses genuine decode/createCanvas/encodeBlob operations.
 * Tests supply Skia; production exclusively uses browser raster APIs. */
function engineFor(engine) {
  if (engine !== undefined) {
    if (!engine || typeof engine.decode !== 'function' || typeof engine.createCanvas !== 'function' || typeof engine.encodeBlob !== 'function')
      fail('invalid_arguments', 'Expected decode, createCanvas and encodeBlob pixel-engine functions.');
    return engine;
  }
  return {
    decode(bytes, mime) {
      if (typeof globalThis.createImageBitmap !== 'function') fail('unsupported_decoder', 'This browser has no real createImageBitmap raster decoder.');
      return globalThis.createImageBitmap(new Blob([bytes], { type: mime }), { imageOrientation: 'none' });
    },
    createCanvas(width, height) {
      const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : globalThis.document?.createElement('canvas');
      if (!canvas) fail('unavailable', 'This browser has no real 2D canvas raster engine.');
      canvas.width = width; canvas.height = height; return canvas;
    },
    encodeBlob(canvas, mime) {
      if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: mime, quality: 0.92 });
      if (typeof canvas.toBlob !== 'function') fail('unsupported_codec', 'This browser has no real canvas blob encoder.');
      return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Object.assign(new Error('Canvas encoding produced no bytes.'), { code: 'unsupported_codec' })), mime, 0.92));
    },
  };
}
function context(canvas) {
  const ctx = canvas?.getContext?.('2d', { willReadFrequently: true });
  if (!ctx) fail('unavailable', 'A genuine 2D canvas context is required.');
  return ctx;
}
const free = canvas => { if (canvas) { canvas.width = 0; canvas.height = 0; } };
async function openBitmap(content, mime, engine, guard, assign) {
  const geometry = photoGeometry(content, mime), bytes = sourceBytes(content, mime);
  // Assign inside the operation so a guard failure after decoding still closes it.
  let bitmap;
  try {
    bitmap = await owned(() => Promise.resolve(engine.decode(bytes, mime)).then(value => { assign(value); return value; }), guard);
  } catch (error) {
    if (error?.code) throw error;
    fail('unsupported_content', error?.message || 'The raster decoder could not decode genuine source pixels.');
  }
  if (!bitmap) fail('unsupported_decoder', 'The raster decoder returned no actual image bitmap.');
  bounds(bitmap.width, bitmap.height);
  if (bitmap.width !== geometry.width || bitmap.height !== geometry.height)
    fail('unsupported_decoder', 'The decoder cannot preserve the encoded raster pixel axes.');
  return bitmap;
}
async function encoded(canvas, mime, engine, guard) {
  const blob = await owned(() => engine.encodeBlob(canvas, mime), guard);
  if (!blob || blob.type !== mime || typeof blob.arrayBuffer !== 'function')
    fail('unsupported_codec', `The canvas cannot genuinely encode the requested ${mime} format.`);
  const bytes = new Uint8Array(await owned(() => blob.arrayBuffer(), guard));
  const content = data(bytes, mime), geometry = photoGeometry(content, mime);
  if (geometry.width !== canvas.width || geometry.height !== canvas.height)
    fail('unsupported_codec', 'Encoded image dimensions do not match the rendered pixels.');
  return { content, mime, ...geometry };
}
export async function decodePhoto(content, mime, { guard = ALWAYS, engine: injected } = {}) {
  current(guard); const engine = engineFor(injected); let bitmap;
  try { const image = await owned(() => openBitmap(content, mime, engine, guard, value => { bitmap = value; }), guard); return bounds(image.width, image.height); }
  finally { bitmap?.close?.(); }
}
const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const luma = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
function adjust(ctx, width, height, edits) {
  if (edits.exposure === 0 && edits.contrast === 1 && edits.saturation === 1 && edits.filter === 'none') return;
  const image = ctx.getImageData(0, 0, width, height), p = image.data;
  const exposure = 2 ** edits.exposure, contrast = edits.contrast * (edits.filter === 'vivid' ? 1.15 : 1), saturation = edits.saturation * (edits.filter === 'vivid' ? 1.2 : 1);
  for (let i = 0; i < p.length; i += 4) {
    let r = (p[i] * exposure - 128) * contrast + 128, g = (p[i + 1] * exposure - 128) * contrast + 128, b = (p[i + 2] * exposure - 128) * contrast + 128;
    const gray = luma(r, g, b);
    r = gray + (r - gray) * saturation; g = gray + (g - gray) * saturation; b = gray + (b - gray) * saturation;
    if (edits.filter === 'mono') r = g = b = luma(r, g, b);
    if (edits.filter === 'sepia') { const red = r, green = g; r = .393 * red + .769 * green + .189 * b; g = .349 * red + .686 * green + .168 * b; b = .272 * red + .534 * green + .131 * b; }
    p[i] = clamp(r); p[i + 1] = clamp(g); p[i + 2] = clamp(b);
  }
  ctx.putImageData(image, 0, 0);
}
function drawMark(ctx, width, height, mark) {
  ctx.save();
  try {
    ctx.strokeStyle = ctx.fillStyle = mark.color; ctx.lineWidth = mark.lineWidth;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.setLineDash(mark.lineStyle === 'dashed' ? [mark.lineWidth * 4, mark.lineWidth * 3] : mark.lineStyle === 'dotted' ? [mark.lineWidth, mark.lineWidth * 2] : []);
    const x = mark.x * width, y = mark.y * height, w = mark.width * width, h = mark.height * height;
    if (mark.kind === 'text' || mark.kind === 'signature' && mark.text) {
      ctx.font = `${mark.kind === 'signature' ? 'italic ' : ''}${mark.fontSize}px sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(mark.text, x, y);
    } else if (mark.kind === 'rectangle') ctx.strokeRect(x, y, w, h);
    else if (mark.kind === 'ellipse') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (mark.kind === 'highlight' && mark.width > 0 && mark.height > 0) { ctx.globalAlpha = .4; ctx.fillRect(x, y, w, h); }
    else {
      if (['highlighter', 'highlight'].includes(mark.kind)) ctx.globalAlpha = .4;
      ctx.beginPath(); const points = mark.kind === 'line' ? mark.points.slice(0, 2) : mark.points;
      points.forEach((point, index) => index ? ctx.lineTo(point.x * width, point.y * height) : ctx.moveTo(point.x * width, point.y * height)); ctx.stroke();
    }
  } finally { ctx.restore(); }
}
/** Crop -> quarter rotation -> resize -> adjustments -> final normalized markup.
 * Resize specifies FINAL width/height; marks' stroke/font sizes are output pixels. */
export async function renderPhoto(content, mime, edits = PHOTO_DEFAULT_EDITS, { guard = ALWAYS, engine: injected } = {}) {
  current(guard);
  if (!validatePhotoEdits(edits)) fail('invalid_arguments', 'Use the full closed Photos edit graph and normalized bounds.');
  const spec = copyCanonicalData(edits), engine = engineFor(injected); let bitmap, canvas;
  try {
    await owned(() => openBitmap(content, mime, engine, guard, image => { bitmap = image; }), guard);
    const x = Math.min(bitmap.width - 1, Math.floor(spec.crop.x * bitmap.width)), y = Math.min(bitmap.height - 1, Math.floor(spec.crop.y * bitmap.height));
    const w = Math.max(1, Math.min(bitmap.width - x, Math.round(spec.crop.width * bitmap.width))), h = Math.max(1, Math.min(bitmap.height - y, Math.round(spec.crop.height * bitmap.height)));
    const turnedW = spec.rotate % 2 ? h : w, turnedH = spec.rotate % 2 ? w : h;
    const width = spec.resize?.width ?? turnedW, height = spec.resize?.height ?? turnedH; bounds(width, height);
    canvas = engine.createCanvas(width, height); const ctx = context(canvas);
    // High-quality interpolation changes even 1:1 pixels in some raster engines.
    ctx.imageSmoothingEnabled = width !== turnedW || height !== turnedH;
    if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = 'high';
    // Scale rotated crop into FINAL axes without allocating intermediate canvases.
    ctx.save(); ctx.scale(width / turnedW, height / turnedH);
    if (spec.rotate === 1) ctx.translate(h, 0); else if (spec.rotate === 2) ctx.translate(w, h); else if (spec.rotate === 3) ctx.translate(0, w);
    ctx.rotate(spec.rotate * Math.PI / 2); ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h); ctx.restore();
    adjust(ctx, width, height, spec); for (const mark of spec.marks) drawMark(ctx, width, height, mark);
    return await owned(() => encoded(canvas, 'image/png', engine, guard), guard);
  } finally { try { bitmap?.close?.(); } finally { free(canvas); } }
}
/** Convert already rendered pixels (including markup) without applying edits twice. */
export async function exportPhoto(content, mime, { mime: output = 'image/png', guard = ALWAYS, engine: injected } = {}) {
  current(guard); if (!IMAGE_MIMES.includes(output)) fail('invalid_arguments', 'Export supports PNG, JPEG and WebP.');
  const engine = engineFor(injected); let bitmap, canvas;
  try {
    await owned(() => openBitmap(content, mime, engine, guard, image => { bitmap = image; }), guard);
    canvas = engine.createCanvas(bitmap.width, bitmap.height); const ctx = context(canvas);
    if (output === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(bitmap, 0, 0); return await owned(() => encoded(canvas, output, engine, guard), guard);
  } finally { try { bitmap?.close?.(); } finally { free(canvas); } }
}
/** Every tick redraws an independent, locally authored animated portrait scene.
 * Effects change actual pixels, not CSS; mirror never toggles between ticks. */
export function drawBoothFrame(canvas, { frame = 0, effect = 'normal' } = {}) {
  if (!Number.isFinite(frame) || !EFFECTS.includes(effect)) fail('invalid_arguments', 'Use an authored numeric frame and supported booth effect.');
  bounds(canvas?.width, canvas?.height); const ctx = context(canvas), w = canvas.width, h = canvas.height;
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    const background = ctx.createLinearGradient(0, 0, w, h); background.addColorStop(0, '#1b354f'); background.addColorStop(1, '#86c7cd');
    ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#eec463'; ctx.fillRect(w * .08, h * .12, w * .18, h * .3);
    ctx.fillStyle = '#c85774'; ctx.fillRect(w * .76, h * .58, w * .17, h * .28);
    const sway = Math.sin(frame * 1.4) * w * .035;
    ctx.fillStyle = '#315a98'; ctx.beginPath(); ctx.ellipse(w * .51 + sway, h * .92, w * .23, h * .34, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e7b89d'; ctx.beginPath(); ctx.ellipse(w * .51 + sway, h * .45, w * .135, h * .22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#352e40'; ctx.beginPath(); ctx.ellipse(w * .51 + sway, h * .3, w * .14, h * .085, -.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#243344'; for (const eye of [-1, 1]) { ctx.beginPath(); ctx.ellipse(w * .51 + sway + eye * w * .05, h * .45, w * .011, h * .014, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#914a51'; ctx.lineWidth = Math.max(1, w * .007); ctx.beginPath(); ctx.arc(w * .51 + sway, h * .54, w * .04, 0, Math.PI); ctx.stroke();
    if (effect === 'normal') return canvas;
    const image = ctx.getImageData(0, 0, w, h), p = image.data;
    if (effect === 'mirror') {
      for (let y = 0; y < h; y++) for (let x = 0; x < Math.floor(w / 2); x++) for (let c = 0; c < 4; c++) {
        const a = (y * w + x) * 4 + c, b = (y * w + w - 1 - x) * 4 + c, value = p[a]; p[a] = p[b]; p[b] = value;
      }
    } else {
      const heat = [[36,10,133],[0,188,255],[0,255,111],[255,231,60],[255,18,0]];
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i], g = p[i + 1], b = p[i + 2], gray = luma(r, g, b);
        if (effect === 'mono') p[i] = p[i + 1] = p[i + 2] = clamp(gray);
        else if (effect === 'sepia') { p[i] = clamp(.393*r+.769*g+.189*b); p[i+1] = clamp(.349*r+.686*g+.168*b); p[i+2] = clamp(.272*r+.534*g+.131*b); }
        else { const value = gray / 255 * 4, low = Math.floor(value), high = Math.min(4, low + 1); for (let c = 0; c < 3; c++) p[i+c] = clamp(heat[low][c] + (heat[high][c] - heat[low][c]) * (value-low)); }
      }
    }
    ctx.putImageData(image, 0, 0); return canvas;
  } finally { ctx.restore(); }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const recordingMimes = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
async function recordVideo(canvas, duration, Recorder, guard) {
  let stream, recorder, rejectStop; const chunks = []; const width = canvas.width, height = canvas.height;
  try {
    current(guard); stream = canvas.captureStream(30);
    if (!stream || typeof stream.getTracks !== 'function') fail('unsupported_codec', 'Canvas captureStream produced no actual stream.');
    const mime = recordingMimes.find(type => Recorder.isTypeSupported(type));
    if (!mime) fail('unsupported_codec', 'This browser has no supported canvas video recorder MIME.');
    recorder = new Recorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
    const stopped = new Promise((resolve, reject) => { rejectStop = reject; recorder.onstop = resolve; recorder.onerror = event => reject(Object.assign(new Error(event?.error?.message ?? 'Canvas recording failed.'), { code: 'unsupported_codec' })); });
    // Attach immediately: an error may arrive before the duration wait finishes.
    stopped.catch(() => {});
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.start(100); const end = Date.now() + duration * 1000;
    while (Date.now() < end) {
      await owned(() => delay(Math.min(100, Math.max(1, end - Date.now()))), guard);
      if (recorder.state === 'inactive') fail('unsupported_codec', 'Canvas recording ended before the bounded take completed.');
    }
    await owned(() => { recorder.stop(); return stopped; }, guard);
    if (!chunks.length) fail('unsupported_codec', 'Canvas recording produced no playable bytes.');
    const actualMime = (recorder.mimeType || mime).split(';')[0].toLowerCase();
    if (!['video/webm', 'video/mp4'].includes(actualMime)) fail('unsupported_codec', 'The recorder returned an unsupported actual video container.');
    const blob = new Blob(chunks, { type: actualMime });
    const bytes = new Uint8Array(await owned(() => blob.arrayBuffer(), guard)), content = data(bytes, actualMime);
    if (content.length > CONTENT || !photoContentValid(content, actualMime)) fail('unsupported_codec', 'Canvas recording returned malformed or oversized actual video bytes.');
    return { content, mime: actualMime, width, height, duration };
  } finally {
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Retire tracks even if recorder stop fails. */ } }
    rejectStop?.(Object.assign(new Error('Recorder retired.'), { code: 'stale_target' }));
    for (const track of stream?.getTracks?.() ?? []) { try { track.stop(); } catch { /* Every independent track must be retired. */ } }
  }
}
/** Countdown precedes genuine still snapshots / bounded live canvas recording.
 * The caller animates drawBoothFrame; captures preserve that actual feed, not a substitute. */
export async function captureBoothMedia(canvas, { mode = 'single', effect = 'normal', guard = ALWAYS, onCountdown, onFlash, durationSeconds = 3, engine: injected, recorder: Recorder = globalThis.MediaRecorder } = {}) {
  current(guard); bounds(canvas?.width, canvas?.height); context(canvas);
  if (!['single', 'four', 'video'].includes(mode) || !EFFECTS.includes(effect)) fail('invalid_arguments', 'Choose a supported booth mode and effect.');
  if ([onCountdown, onFlash].some(callback => callback !== undefined && typeof callback !== 'function')) fail('invalid_arguments', 'Expected countdown and flash callbacks.');
  if (mode === 'video') {
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 10) fail('invalid_arguments', 'Canvas video duration must be between one and ten seconds.');
    if (typeof canvas.captureStream !== 'function' || typeof Recorder !== 'function' || typeof Recorder.isTypeSupported !== 'function' || !recordingMimes.some(type => Recorder.isTypeSupported(type)))
      fail('unsupported_codec', 'This browser lacks a supported real canvas captureStream / MediaRecorder video encoder.');
  }
  const engine = engineFor(injected), width = canvas.width, height = canvas.height; let output;
  if (mode === 'four') bounds(width * 2, height * 2);
  const countdown = count => { current(guard); onCountdown?.(count); current(guard); };
  const flash = enabled => { current(guard); onFlash?.(enabled); current(guard); };
  try {
    for (const count of [3, 2, 1]) { countdown(count); await owned(() => delay(1000), guard); }
    countdown(0);
    if (mode === 'video') return await owned(() => recordVideo(canvas, durationSeconds, Recorder, guard), guard);
    output = engine.createCanvas(mode === 'four' ? width * 2 : width, mode === 'four' ? height * 2 : height); const ctx = context(output);
    for (let shot = 0; shot < (mode === 'four' ? 4 : 1); shot++) {
      if (shot) await owned(() => delay(800), guard);
      flash(true); ctx.drawImage(canvas, (shot % 2) * width, Math.floor(shot / 2) * height, width, height);
      await owned(() => delay(120), guard); flash(false);
    }
    return await owned(() => encoded(output, 'image/png', engine, guard), guard);
  } finally { free(output); /* Never retire the caller's mounted feed canvas. */ }
}
