import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decodePhoto, renderPhoto, exportPhoto, photoGeometry, PHOTO_DEFAULT_EDITS, validatePhotoEdits, drawBoothFrame, captureBoothMedia } from '../frontend/src/photos-codec.js';
import { PREVIEW_IMAGE_CONTENT } from '../frontend/src/preview-image-fixture.js';

// Genuine Skia decode/encode/pixels through the public engine seam, not fake
// image data URLs or assertions limited to headers. Actual MediaRecorder
// encoding and playback require native browser coverage.
const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const pdfRequire = createRequire(frontendRequire.resolve('pdfjs-dist/package.json'));
const { createCanvas, loadImage } = pdfRequire('@napi-rs/canvas');
const bytes = content => Buffer.from(content.slice(content.indexOf(',') + 1), 'base64');
const edits = patch => ({ ...structuredClone(PHOTO_DEFAULT_EDITS), ...patch });
function rasterEngine(overrides = {}) {
  const canvases = [];
  return {
    canvases,
    async decode(raw) { return loadImage(Buffer.from(raw)); },
    createCanvas(width, height) { const canvas = createCanvas(width, height); canvases.push(canvas); return canvas; },
    async encodeBlob(canvas, mime) {
      const raw = mime === 'image/png' ? canvas.toBuffer(mime) : canvas.toBuffer(mime, 92);
      return new Blob([raw], { type: mime });
    },
    ...overrides,
  };
}
function solid(width = 32, height = 24, color = '#5078a0') {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); return canvas;
}
async function pixels(content) {
  const image = await loadImage(bytes(content)), canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: canvas.getContext('2d').getImageData(0, 0, image.width, image.height).data };
}
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const encodedSource = canvas => canvas.toDataURL('image/png');
const options = engine => ({ engine, guard: () => true });
const mark = (kind, patch = {}) => ({ id: `mark-${kind}`, kind, points: [{ x: .1, y: .2 }, { x: .9, y: .2 }], x: .1, y: .1, width: .7, height: .6, color: '#ff0000', lineWidth: 4, lineStyle: 'solid', text: '', fontSize: 18, ...patch });

test('canonical full edits/defaults are immutable and descriptor-safe; malformed bounds and marks reject', () => {
  assert.equal(validatePhotoEdits(PHOTO_DEFAULT_EDITS), true);
  assert.equal(Object.isFrozen(PHOTO_DEFAULT_EDITS), true); assert.equal(Object.isFrozen(PHOTO_DEFAULT_EDITS.crop), true);
  for (const patch of [{ rotate: 4 }, { exposure: NaN }, { exposure: 1.1 }, { contrast: -1 }, { saturation: 3 }, { filter: 'invented' }, { crop: { x: .8, y: 0, width: .5, height: 1 } }, { resize: { width: 4096, height: 4096 } }, { extra: 1 }, { marks: [mark('pen', { points: [] })] }, { marks: [mark('rectangle', { width: 0 })] }, { marks: [mark('text')] }, { marks: [mark('signature', { points: [] })] }, { marks: [mark('line', { lineStyle: 'fake' })] }, { marks: [mark('line'), mark('line')] }]) assert.equal(validatePhotoEdits(edits(patch)), false);
  let reads = 0; const accessor = edits(); Object.defineProperty(accessor, 'crop', { enumerable: true, get() { reads++; return PHOTO_DEFAULT_EDITS.crop; } });
  assert.equal(validatePhotoEdits(accessor), false); assert.equal(reads, 0);
  const cycle = edits(); cycle.marks.push(cycle); assert.equal(validatePhotoEdits(cycle), false);
});

test('genuine initial fixture decodes exact pixels and shares sole header geometry authority', async () => {
  const engine = rasterEngine();
  assert.deepEqual(photoGeometry(PREVIEW_IMAGE_CONTENT, 'image/png'), { width: 960, height: 640, mime: 'image/png' });
  assert.deepEqual(await decodePhoto(PREVIEW_IMAGE_CONTENT, 'image/png', options(engine)), { width: 960, height: 640 });
  const result = await renderPhoto(PREVIEW_IMAGE_CONTENT, 'image/png', PHOTO_DEFAULT_EDITS, options(engine));
  assert.equal(result.mime, 'image/png'); assert.equal(result.width, 960); assert.equal(result.height, 640);
  const original = await pixels(PREVIEW_IMAGE_CONTENT), rendered = await pixels(result.content);
  assert.deepEqual(rendered.data, original.data);
});

test('normalized crop and all clockwise quarter rotations transform actual asymmetric pixels', async () => {
  const canvas = createCanvas(3, 2), ctx = canvas.getContext('2d');
  const colors = ['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'];
  colors.forEach((color, index) => { ctx.fillStyle = color; ctx.fillRect(index % 3, Math.floor(index / 3), 1, 1); });
  const source = encodedSource(canvas), expected = [
    [[255,0,0,255],[0,255,0,255],[255,255,0,255],[255,0,255,255]],
    [[255,255,0,255],[255,0,0,255],[255,0,255,255],[0,255,0,255]],
    [[255,0,255,255],[255,255,0,255],[0,255,0,255],[255,0,0,255]],
    [[0,255,0,255],[255,0,255,255],[255,0,0,255],[255,255,0,255]],
  ];
  for (let rotate = 0; rotate < 4; rotate++) {
    const result = await renderPhoto(source, 'image/png', edits({ crop: { x: 0, y: 0, width: 2 / 3, height: 1 }, rotate }), options(rasterEngine()));
    const image = await pixels(result.content);
    assert.equal(image.width, 2); assert.equal(image.height, 2);
    assert.deepEqual([pixel(image,0,0),pixel(image,1,0),pixel(image,0,1),pixel(image,1,1)], expected[rotate]);
  }
  const uncropped = [
    [[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255],[255,0,255,255],[0,255,255,255]],
    [[255,255,0,255],[255,0,0,255],[255,0,255,255],[0,255,0,255],[0,255,255,255],[0,0,255,255]],
    [[0,255,255,255],[255,0,255,255],[255,255,0,255],[0,0,255,255],[0,255,0,255],[255,0,0,255]],
    [[0,0,255,255],[0,255,255,255],[0,255,0,255],[255,0,255,255],[255,0,0,255],[255,255,0,255]],
  ];
  for (let rotate = 0; rotate < 4; rotate++) {
    const width = rotate % 2 ? 2 : 3, height = rotate % 2 ? 3 : 2;
    for (const resize of [null, { width, height }]) {
      const result = await renderPhoto(source, 'image/png', edits({ rotate, resize }), options(rasterEngine()));
      const image = await pixels(result.content);
      assert.equal(image.width, width); assert.equal(image.height, height);
      assert.deepEqual([...image.data], uncropped[rotate].flat(), 'Unscaled final axes preserve every original RGBA channel, even with an explicit same-size resize.');
    }
  }
  const resized = await renderPhoto(source, 'image/png', edits({ rotate: 1, resize: { width: 40, height: 20 } }), options(rasterEngine()));
  assert.equal(resized.width, 40); assert.equal(resized.height, 20); assert.deepEqual(photoGeometry(resized.content, resized.mime), { width: 40, height: 20, mime: 'image/png' });
  assert.equal(source, encodedSource(canvas), 'Original source bytes remain immutable through every edit.');
});

test('exposure, contrast, saturation and all filters change genuinely encoded pixels', async () => {
  const source = encodedSource(solid());
  for (const [patch, expected] of [[{ exposure: 1 },[160,240,255,255]], [{ contrast: 2 },[32,112,192,255]], [{ saturation: 0 },[114,114,114,255]]]) {
    const result = await renderPhoto(source, 'image/png', edits(patch), options(rasterEngine()));
    assert.deepEqual(pixel(await pixels(result.content), 0, 0), expected);
  }
  const mono = await pixels((await renderPhoto(source, 'image/png', edits({ filter: 'mono' }), options(rasterEngine()))).content);
  assert.deepEqual(pixel(mono,0,0), [114,114,114,255]);
  const sepia = pixel(await pixels((await renderPhoto(source, 'image/png', edits({ filter: 'sepia' }), options(rasterEngine()))).content),0,0);
  assert.ok(sepia[0] > sepia[1] && sepia[1] > sepia[2]);
  const vivid = pixel(await pixels((await renderPhoto(source, 'image/png', edits({ filter: 'vivid' }), options(rasterEngine()))).content),0,0);
  assert.notDeepEqual(vivid,[80,120,160,255]);
});

test('every supported markup kind renders pixels after rotation and FINAL resize, including styles', async () => {
  const source = encodedSource(solid(100,80,'#ffffff'));
  for (const kind of ['pen','highlighter','drawing','highlight','line','rectangle','ellipse','text','signature']) {
    const marks = [mark(kind, ['text','signature'].includes(kind) ? { text: 'Local' } : {})];
    const result = await renderPhoto(source, 'image/png', edits({ rotate: 1, resize: { width: 100, height: 80 }, marks }), options(rasterEngine()));
    const image = await pixels(result.content);
    assert.ok(image.data.some((value,index) => index % 4 !== 3 && value !== 255), `${kind} must create actual visible pixels`);
  }
  await assert.rejects(renderPhoto(source, 'image/png', edits({ marks: [mark('pen', { text: 'Not a pen field' })] }), options(rasterEngine())), { code: 'invalid_arguments' });
  const pen = mark('pen');
  const painted = await pixels((await renderPhoto(source, 'image/png', edits({ marks: [pen] }), options(rasterEngine()))).content);
  assert.deepEqual(pixel(painted,50,16),[255,0,0,255]);
  for (const kind of ['rectangle','ellipse','line']) {
    const images = [];
    for (const lineStyle of ['solid','dashed','dotted']) images.push((await pixels((await renderPhoto(source,'image/png',edits({marks:[mark(kind,{lineStyle})]}),options(rasterEngine()))).content)).data);
    assert.notDeepEqual(images[0],images[1],`${kind} dashed pixels differ`); assert.notDeepEqual(images[1],images[2],`${kind} dotted pixels differ`);
  }
});

test('PNG/JPEG/WebP exports contain actual independently decodable bytes and preserve markup', async () => {
  const source = encodedSource(solid(100,80,'#ffffff'));
  const edited = await renderPhoto(source,'image/png',edits({ marks:[mark('pen')] }),options(rasterEngine()));
  for (const mime of ['image/png','image/jpeg','image/webp']) {
    const result = await exportPhoto(edited.content,edited.mime,{...options(rasterEngine()),mime});
    assert.equal(result.mime,mime); assert.equal(result.width,100); assert.equal(result.height,80);
    const image = await pixels(result.content), red = pixel(image,50,16);
    assert.ok(red[0]>180&&red[1]<100&&red[2]<100,'Export keeps actual red markup pixels.');
  }
  const fallback = rasterEngine({ encodeBlob: async canvas => new Blob([canvas.toBuffer('image/png')],{type:'image/png'}) });
  await assert.rejects(exportPhoto(source,'image/png',{...options(fallback),mime:'image/webp'}),{code:'unsupported_codec'});
});

test('malformed sources, genuine-decoder failures, wrong axes and invalid guards fail explicitly', async () => {
  for (const source of ['https://example.invalid/a.png','data:image/png;base64,ZmFrZQ==',PREVIEW_IMAGE_CONTENT.replace('image/png','image/jpeg')]) await assert.rejects(decodePhoto(source,'image/png',options(rasterEngine())),{code:'unsupported_content'});
  await assert.rejects(decodePhoto(PREVIEW_IMAGE_CONTENT,'image/png',{guard:null}),{code:'invalid_arguments'});
  await assert.rejects(renderPhoto(PREVIEW_IMAGE_CONTENT,'image/png',{},options(rasterEngine())),{code:'invalid_arguments'});
  await assert.rejects(decodePhoto(PREVIEW_IMAGE_CONTENT,'image/png',options(rasterEngine({decode:async()=>{throw Error('Broken PNG body');}}))),{code:'unsupported_content'});
  const wrongAxes = encodedSource(solid(640, 960));
  await assert.rejects(decodePhoto(PREVIEW_IMAGE_CONTENT,'image/png',options(rasterEngine({decode:async()=>loadImage(bytes(wrongAxes))}))),{code:'unsupported_decoder'});
  if (typeof globalThis.createImageBitmap !== 'function') await assert.rejects(decodePhoto(PREVIEW_IMAGE_CONTENT,'image/png'),{code:'unsupported_decoder'});
});

test('ownership invalidation after genuine decode, encoder, and blob read rejects rather than publishing output', async () => {
  for (const phase of ['decode','encode','bytes']) {
    let alive = true; const engine = rasterEngine();
    if (phase === 'decode') { const decode=engine.decode.bind(engine);engine.decode=async(...args)=>{const image=await decode(...args);alive=false;return image;}; }
    if (phase === 'encode') { const encode=engine.encodeBlob.bind(engine);engine.encodeBlob=async(...args)=>{const blob=await encode(...args);alive=false;return blob;}; }
    if (phase === 'bytes') { const encode=engine.encodeBlob.bind(engine);engine.encodeBlob=async(...args)=>{const blob=await encode(...args);return {type:blob.type,arrayBuffer:async()=>{const raw=await blob.arrayBuffer();alive=false;return raw;}};}; }
    await assert.rejects(renderPhoto(PREVIEW_IMAGE_CONTENT,'image/png',edits(),{engine,guard:()=>alive}),{code:'stale_target'});
  }
  const engine=rasterEngine();await assert.rejects(renderPhoto(PREVIEW_IMAGE_CONTENT,'image/png',edits(),{engine,guard:()=>false}),{code:'stale_target'});assert.equal(engine.canvases.length,0);
});

test('fictional booth redraw produces genuine animated pixels; all effects transform the authored frame', () => {
  const normal=createCanvas(80,60);drawBoothFrame(normal,{frame:0,effect:'normal'});
  const first=normal.getContext('2d').getImageData(0,0,80,60).data;
  drawBoothFrame(normal,{frame:2,effect:'normal'});assert.notDeepEqual(normal.getContext('2d').getImageData(0,0,80,60).data,first);
  const mirror=createCanvas(80,60);drawBoothFrame(mirror,{frame:0,effect:'mirror'});
  const flipped=mirror.getContext('2d').getImageData(0,0,80,60).data;
  for(let y=0;y<60;y++)for(let x=0;x<80;x++)assert.deepEqual([...flipped.subarray((y*80+x)*4,(y*80+x)*4+4)],[...first.subarray((y*80+79-x)*4,(y*80+79-x)*4+4)]);
  drawBoothFrame(mirror,{frame:0,effect:'mirror'});assert.deepEqual(mirror.getContext('2d').getImageData(0,0,80,60).data,flipped,'Redrawing never cumulatively flips the previous effect.');
  for (const effect of ['mono', 'sepia', 'thermal']) {
    const canvas = createCanvas(80, 60); drawBoothFrame(canvas, { frame: 0, effect });
    const p = canvas.getContext('2d').getImageData(0, 0, 80, 60).data; assert.notDeepEqual(p, first);
    if (effect === 'mono') for (let i = 0; i < p.length; i += 4) { assert.equal(p[i], p[i + 1]); assert.equal(p[i + 1], p[i + 2]); }
  }
});

for (const mode of ['single', 'four']) {
  test(`${mode} booth snapshots preserve successive real feed pixels and mounted source dimensions`, { timeout: 10_000 }, async () => {
    const feed=solid(20,16,'#112233'),engine=rasterEngine();let shot=0;
    const colors=['#112233','#445566','#778899','#aabbcc'];
    const result=await captureBoothMedia(feed,{mode,effect:'normal',...options(engine),onFlash:enabled=>{if(enabled){const ctx=feed.getContext('2d');ctx.fillStyle=colors[shot++];ctx.fillRect(0,0,20,16);}}});
    const image=await pixels(result.content);assert.equal(image.width,mode==='four'?40:20);assert.equal(image.height,mode==='four'?32:16);
    assert.deepEqual(pixel(image,10,8),[17,34,51,255]);if(mode==='four'){assert.deepEqual(pixel(image,30,8),[68,85,102,255]);assert.deepEqual(pixel(image,10,24),[119,136,153,255]);assert.deepEqual(pixel(image,30,24),[170,187,204,255]);}
    assert.equal(feed.width,20);assert.equal(feed.height,16);
  });
}

test('real booth bounds and unavailable native video encoding reject before countdown', async () => {
  const feed = solid(20,16), counts = [];
  const settings = { ...options(rasterEngine()), onCountdown: count => counts.push(count) };
  for (const durationSeconds of [0, 11, Infinity, NaN]) {
    await assert.rejects(captureBoothMedia(feed, { ...settings, mode: 'video', durationSeconds }), { code: 'invalid_arguments' });
  }
  if (typeof feed.captureStream !== 'function' || typeof globalThis.MediaRecorder !== 'function') {
    await assert.rejects(captureBoothMedia(feed, { ...settings, mode: 'video' }), { code: 'unsupported_codec' });
  }
  await assert.rejects(captureBoothMedia(solid(1025,1025), { ...settings, mode: 'four' }), { code: 'limit_exceeded' });
  await assert.rejects(captureBoothMedia(solid(8193,1), settings), { code: 'limit_exceeded' });
  assert.deepEqual(counts, []);
  assert.equal(feed.width,20); assert.equal(feed.height,16);
});

test('guard expiry inside countdown callback aborts before waits, flash or allocation', async () => {
  const feed = solid(20, 16), engine = rasterEngine(), counts = [], flashes = []; let alive = true;
  await assert.rejects(captureBoothMedia(feed, { mode: 'single', engine, guard: () => alive,
    onCountdown(count) { counts.push(count); alive = false; }, onFlash(value) { flashes.push(value); } }), { code: 'stale_target' });
  assert.deepEqual(counts, [3]); assert.deepEqual(flashes, []); assert.equal(engine.canvases.length, 0);
});
