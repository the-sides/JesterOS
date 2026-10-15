import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createMediaState, createMediaSession, mediaLibraryAssets, mediaNativeCapability, mediaAssetContent, mediaByteLength, MEDIA_PROFILES } from '../frontend/src/media-state.js';
import { MEDIA_STORE_CATALOG } from '../frontend/src/media-fixtures.js';

const requireFrontend = createRequire(new URL('../frontend/package.json', import.meta.url));
const { compile } = requireFrontend('svelte/compiler');
const component = readFileSync(new URL('../frontend/src/NativeMediaApp.svelte', import.meta.url), 'utf8');
const sourceOutput = asset => ({ content: mediaAssetContent(asset), mime: asset.mime, duration: asset.duration });

// Unit harness for the component's actual script. Only browser/Svelte mechanisms
// are substituted: the tested facade/functions are the implementation, not copies.
function fixture(profileId = MEDIA_PROFILES[2]) {
  const state = createMediaState(profileId);
  const selected = state.assets.find(a => a.mime === 'audio/wav');
  const session = createMediaSession('media-test-window', 'library', selected.id, state.assets);
  state.sessions.push(session);
  const graphNodes = [], mounts = [], registrations = [], commands = [];
  let teardown;
  const scene = { isConnected: true }, frame = { isConnected: true };
  const realm = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  const document = { defaultView: realm, activeElement: null };
  const root = { isConnected: true, ownerDocument: document, parentElement: null,
    closest: selector => selector.includes('session-scene') ? scene : frame,
    contains: () => true, querySelectorAll: () => [], querySelector: () => null,
    getClientRects: () => [{ width: 640, height: 420 }], getBoundingClientRect: () => ({ x: 0, y: 0, width: 640, height: 420 }) };
  function mediaElement() {
    const events = new Map();
    let position = 0;
    const el = { isConnected: true, ownerDocument: document, readyState: 1, duration: selected.duration,
      volume: .8, playbackRate: 1, paused: true, ended: false, seeking: false, src: '', pauseCalls: 0,
      addEventListener: (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
      removeEventListener: (name, fn) => events.get(name)?.delete(fn),
      emit: name => { for (const fn of [...events.get(name) ?? []]) fn({ currentTarget: el, type: name }); },
      load: () => queueMicrotask(() => el.emit('loadedmetadata')),
      play: async () => { el.paused = false; }, pause: () => { el.pauseCalls++; el.paused = true; },
      removeAttribute: name => { if (name === 'src') el.src = ''; },
    };
    Object.defineProperty(el, 'currentTime', { get: () => position, set: value => { position = value; queueMicrotask(() => el.emit('seeked')); } });
    return el;
  }
  function graphNode(type) {
    const node = { type, connections: [], disconnected: false,
      connect(target) { this.connections.push(target); }, disconnect() { this.disconnected = true; },
      gain: { value: 1, setTargetAtTime(value) { this.value = value; }, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, cancelScheduledValues() {} },
      frequency: { value: 0 }, Q: { value: 0 }, playbackRate: { value: 1 },
      start() { this.started = true; }, stop() { this.stopped = true; },
    };
    graphNodes.push(node); return node;
  }
  class AudioContext {
    currentTime = 0; destination = graphNode('destination'); closed = false;
    createGain = () => graphNode('gain'); createBiquadFilter = () => graphNode('filter');
    createMediaElementSource = el => Object.assign(graphNode('source'), { element: el });
    createBufferSource = () => graphNode('buffer');
    createAnalyser = () => Object.assign(graphNode('analyser'), { frequencyBinCount: 128, getByteFrequencyData: bytes => bytes.fill(80) });
    resume = async () => {}; close = async () => { this.closed = true; };
    decodeAudioData = async () => ({ duration: selected.duration, numberOfChannels: 1, getChannelData: () => Float32Array.of(-.5, .5) });
  }
  realm.AudioContext = AudioContext;
  const audio = mediaElement(), video = mediaElement();
  const props = { state, profile: { id: profileId }, windowId: session.windowId, available: true, active: true,
    sound: { outputDeviceId: 'speakers', outputs: [{ id: 'speakers', available: true, muted: false, volume: 40 }] },
    execute: async (command, target, payload) => { commands.push({ command, target, payload }); return { status: 'applied' }; },
    registerView: (...args) => registrations.push(args) };
  const script = component.split('<script>')[1].split('</script>')[0].replace(/^\s*import .*?;\s*$/gm, '');
  const vm = { console, setTimeout, clearTimeout, queueMicrotask, Uint8Array, Float32Array, atob,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    $props: () => props, $state: value => value, $derived: value => value, $effect: () => {},
    onMount: fn => mounts.push(fn), tick: async () => {},
    mediaLibraryAssets, mediaNativeCapability, mediaAssetContent, mediaByteLength, MEDIA_STORE_CATALOG,
    dom: { root, audio, video },
  };
  runInNewContext(`${script}\nroot=dom.root;audio=dom.audio;video=dom.video;globalThis.testAccess={play,loadOutput,observe,dispose,setSound,readPlayback,refresh,describe,groupAssets,playStation,getGraph:()=>({context,chains,masterGain,analyser}),setAvailable:value=>{available=value;}};`, vm);
  teardown = mounts[0]();
  return { api: vm.testAccess, facade: registrations[0][1], root, audio, video, state, session, selected, props, commands, registrations, graphNodes, teardown };
}

test('Svelte 5 client and server compile the complete native media surface', () => {
  expect(() => compile(component, { filename: 'NativeMediaApp.svelte', generate: 'client' })).not.toThrow();
  expect(() => compile(component, { filename: 'NativeMediaApp.svelte', generate: 'server' })).not.toThrow();
});

for (const profileId of MEDIA_PROFILES) test(`native facade owns observed playback and registry cleanup: ${profileId}`, async () => {
  const f = fixture(profileId);
  expect(f.facade.available()).toBe(true);
  expect(f.facade.describe().source).toEqual({ bundledId: f.selected.bundledId, mime: f.selected.mime,
    duration: f.selected.duration, byteLength: mediaByteLength(mediaAssetContent(f.selected)) });
  expect(await f.facade.loadOutput(sourceOutput(f.selected), () => true)).toBe(true);
  await f.facade.play(() => true);
  expect(f.facade.readPlayback().playing).toBe(true);
  await f.facade.seek(1, () => true);
  f.facade.volume(.3, () => true); f.facade.rate(1.5, () => true);
  expect(f.facade.readPlayback()).toMatchObject({ position: 1, volume: .3, rate: 1.5 });
  f.teardown();
  expect(f.audio.paused).toBe(true); expect(f.video.paused).toBe(true);
  expect(f.registrations.at(-1)).toEqual([f.session.windowId, null, f.facade]);
  expect(f.graphNodes.filter(n => n.type !== 'destination').every(n => n.disconnected)).toBe(true);
  expect(f.facade.available()).toBe(false);
});

test('play awaits the real element promise and rejects owner loss without faking a clock', async () => {
  const f = fixture(); await f.facade.loadOutput(sourceOutput(f.selected), () => true);
  let resolvePlay;
  f.audio.play = () => new Promise(resolve => { resolvePlay = () => { f.audio.paused = false; resolve(); }; });
  const operation = f.facade.play(() => true);
  for (let i = 0; i < 20 && !resolvePlay; i++) await Promise.resolve();
  expect(typeof resolvePlay).toBe('function');
  expect(f.facade.readPlayback().playing).toBe(false);
  f.api.setAvailable(false); resolvePlay();
  await expect(operation).rejects.toThrow('Playback owner changed');
  expect(f.audio.paused).toBe(true); f.teardown();
});

test('an older awaited play cannot pause newer playback on the same HTMLMedia element', async () => {
  const f = fixture(); await f.facade.loadOutput(sourceOutput(f.selected), () => true);
  const resolvers = [];
  f.audio.play = () => new Promise(resolve => resolvers.push(() => { f.audio.paused = false; resolve(); }));
  const first = f.facade.play(() => true);
  for (let i = 0; i < 20 && resolvers.length < 1; i++) await Promise.resolve();
  expect(resolvers).toHaveLength(1);
  const second = f.facade.play(() => true);
  for (let i = 0; i < 20 && resolvers.length < 2; i++) await Promise.resolve();
  expect(resolvers).toHaveLength(2);
  resolvers[1](); await second;
  const pauseCalls = f.audio.pauseCalls;
  resolvers[0](); await expect(first).rejects.toThrow('Playback owner changed');
  expect(f.audio.paused).toBe(false);
  expect(f.audio.pauseCalls).toBe(pauseCalls);
  f.teardown();
});

test('disposed view pauses its own late-resolving play without reviving the scene', async () => {
  const f = fixture(); await f.facade.loadOutput(sourceOutput(f.selected), () => true);
  let resolvePlay;
  f.audio.play = () => new Promise(resolve => { resolvePlay = () => { f.audio.paused = false; resolve(); }; });
  const operation = f.facade.play(() => true);
  for (let i = 0; i < 20 && !resolvePlay; i++) await Promise.resolve();
  expect(typeof resolvePlay).toBe('function');
  f.teardown(); resolvePlay();
  await expect(operation).rejects.toThrow('Playback owner changed');
  expect(f.audio.paused).toBe(true);
});

test('AudioContext equalizer is ten serial filters; master gain is canonical selected output', async () => {
  const f = fixture(); await f.facade.loadOutput(sourceOutput(f.selected), () => true);
  await f.facade.setEqualizer({ enabled: true, gains: [1,2,3,4,5,6,7,8,9,10] }, () => true);
  const { chains, masterGain } = f.api.getGraph(), chain = chains.get(f.audio);
  expect(chain.filters).toHaveLength(10);
  expect(chain.filters.map(n => n.gain.value)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  for (let i = 0; i < 9; i++) expect(chain.filters[i].connections[0]).toBe(chain.filters[i + 1]);
  expect(masterGain.gain.value).toBe(.4);
  f.facade.setSound({ outputDeviceId: 'speakers', outputs: [{ id: 'speakers', available: true, muted: true, volume: 75 }] });
  expect(masterGain.gain.value).toBe(0);
  expect(f.facade.readPlayback().volume).toBe(.8); f.teardown();
});

test('normalization uses decoded PCM peak and crossfade overlaps an actual buffer source', async () => {
  const f = fixture();
  f.state.preferences.volumeNormalize = true;
  f.state.preferences.crossfade = 2;
  await f.facade.loadOutput(sourceOutput(f.selected), () => true);
  expect(f.api.getGraph().chains.get(f.audio).normalize.gain.value).toBeCloseTo(1.7);
  const next = f.state.assets.find(a => a.id !== f.selected.id && a.mime === 'audio/wav');
  expect(next).toBeDefined();
  f.session.assetId = next.id;
  await f.facade.loadOutput(sourceOutput(next), () => true);
  await f.facade.play(() => true);
  const overlap = f.graphNodes.find(node => node.type === 'buffer');
  expect(overlap.started).toBe(true);
  f.facade.pause(() => true);
  expect(overlap.stopped).toBe(true);
  expect(overlap.disconnected).toBe(true);
  f.teardown();
});

test('stale source guard refuses a load without changing HTMLMedia bytes', async () => {
  const f = fixture();
  expect(await f.facade.loadOutput(sourceOutput(f.selected), () => false)).toBe(false);
  expect(f.audio.src).toBe('');
  f.teardown();
});

test('passive observation carries exact HTMLMedia properties and no fabricated elapsed clock', async () => {
  const f = fixture(); await f.facade.loadOutput(sourceOutput(f.selected), () => true);
  f.audio.currentTime = 2; f.audio.volume = .25; f.audio.playbackRate = 2;
  f.api.observe({ currentTarget: f.audio, type: 'timeupdate' });
  expect(f.commands.at(-1)).toMatchObject({ command: 'media.observe', target: { windowId: f.session.windowId }, payload: { position: 2, volume: .25, rate: 2, playing: false, ended: false } });
  f.teardown();
});

test('album and artist groups retain every real source identity', () => {
  const f = fixture(); const inputs = [{ id: 'a', album: 'One', artist: 'Harbor' }, { id: 'b', album: 'One', artist: 'Studio' }];
  expect(f.api.groupAssets(inputs, 'album')[0].items.map(a => a.id)).toEqual(['a', 'b']);
  expect(f.api.groupAssets(inputs, 'artist').map(g => g.name)).toEqual(['Harbor', 'Studio']); f.teardown();
});

