// Media fixtures: the authored local library, the media store catalog and the
// bundled harbor scene. Every audio asset is original JesterOS synthesis
// rendered to real 16-bit PCM WAV data URLs at import time; the bundled movie
// is a real ffmpeg-generated WebM (VP8 + Opus, 192x108, 3s) embedded verbatim.
// No host capture and no network media are involved anywhere.

const TAU = Math.PI * 2;

function waveBytes(sampleRate, duration, sample) {
  const frames = Math.round(sampleRate * duration);
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset, value) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index);
  };
  label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true);
  label(8, 'WAVE'); label(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / sampleRate;
    const fade = Math.min(1, time / 0.03, (duration - time) / 0.09);
    const value = Math.max(-1, Math.min(1, sample(time) * fade));
    view.setInt16(44 + frame * 2, Math.round(value * 32_767), true);
  }
  return bytes;
}

function toDataURL(mime, bytes) {
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    blocks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return 'data:' + mime + ';base64,' + btoa(blocks.join(''));
}

function waveContent(sampleRate, duration, sample) {
  return toDataURL('audio/wav', waveBytes(sampleRate, duration, sample));
}

function artwork(palette, label) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
    + '<rect width="96" height="96" fill="' + palette.back + '"/>'
    + '<path d="M4 62 Q 24 52 48 62 T 92 62" stroke="' + palette.wave + '" stroke-width="6" fill="none"/>'
    + '<circle cx="' + palette.sunX + '" cy="26" r="11" fill="' + palette.sun + '"/>'
    + '<text x="48" y="86" text-anchor="middle" font-family="sans-serif" font-size="19" font-weight="600" fill="' + palette.ink + '">' + label + '</text>'
    + '</svg>';
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

// --- Authored original compositions (deterministic, invented entities) -------

// Slow evening chord pad drifting with the tide.
const tideOrganSample = time => {
  const harmony = [110, 164.81, 220, 277.18, 329.63];
  let total = 0;
  for (let index = 0; index < harmony.length; index++) {
    const vibrato = Math.sin(TAU * (0.7 + index * 0.37) * time) * 0.004;
    total += Math.sin(TAU * harmony[index] * (1 + vibrato) * time) * (index === 0 ? 0.24 : 0.13 - index * 0.02);
  }
  return total * (0.55 + 0.45 * Math.sin(TAU * time / 8)) * 0.55;
};

// Retro broadcast melody with pulse harmonics and an off-beat blip.
const tvNotes = [329.63, 261.63, 392, 329.63, 493.88, 440, 392, 329.63, 587.33, 493.88, 440, 392];
const wavePatternsSample = time => {
  const step = Math.floor(time / 0.24);
  const frequency = tvNotes[step % tvNotes.length];
  const age = time % 0.24;
  const envelope = Math.min(1, age / 0.006) * Math.exp(-age * 9);
  const pulse = (Math.sin(TAU * frequency * age) + 0.34 * Math.sin(TAU * 3 * frequency * age)
    + 0.17 * Math.sin(TAU * 5 * frequency * age)) * envelope * (age < 0.19 ? 1 : 0);
  const blip = step % 4 === 3 ? Math.sin(TAU * frequency * 2.01 * age) * envelope * 0.4 : 0;
  return pulse * 0.42 + blip;
};

// Invented interview voice: alternating voiced formant phrases and room tone.
const lightkeeperSample = time => {
  const age = time % 1.9;
  if (age >= 1.25) return Math.sin(TAU * 2300 * time) * 0.004;
  const pitch = 118 * (1 + ((Math.floor(time / 1.9) % 3) - 1) * 0.06);
  const envelope = Math.min(1, age / 0.08) * Math.min(1, (1.25 - age) / 0.14);
  const formant = Math.sin(TAU * pitch * age) + 0.55 * Math.sin(TAU * 2.2 * pitch * age)
    + 0.33 * Math.sin(TAU * 3.4 * pitch * age) + 0.19 * Math.sin(TAU * 4.9 * pitch * age);
  return formant * envelope * 0.22 * (1 + 0.05 * Math.sin(TAU * 4.6 * age));
};

// Calm narration for the almanac chapter.
const tideAlmanacSample = time => {
  const age = time % 2.4;
  if (age >= 1.9) return 0.003 * Math.sin(TAU * 2100 * time);
  const pitch = (104 + (Math.floor(time / 2.4) % 2) * 6) * (1 + 0.02 * Math.sin(TAU * 3.3 * age));
  const envelope = Math.min(1, age / 0.12) * Math.min(1, (1.9 - age) / 0.2);
  return (Math.sin(TAU * pitch * age) + 0.4 * Math.sin(TAU * 2 * pitch * age)
    + 0.18 * Math.sin(TAU * 3.1 * pitch * age)) * envelope * 0.16;
};

// The Voice recording seed: foghorn bursts, speech warble and harbour surf.
const harborMemoSample = time => {
  const burst = time % 4.2;
  const foghorn = burst < 1.4
    ? (Math.sin(TAU * 82 * burst) + 0.5 * Math.sin(TAU * 164 * burst) + 0.25 * Math.sin(TAU * 41 * burst))
      * Math.min(1, burst / 0.25) * Math.min(1, (1.4 - burst) / 0.3) * 0.5
    : 0;
  const warble = Math.sin(TAU * (520 + 90 * Math.sin(TAU * 2.3 * time)) * time) * 0.09 * Math.exp(-((time * 0.7) % 1) * 3);
  const surf = Math.sin(TAU * 0.55 * time) * 0.05 * (0.8 + 0.2 * Math.sin(TAU * 0.13 * time));
  return foghorn + warble + surf + 0.01 * Math.sin(TAU * 2600 * time);
};

// Store exclusives: wind-bell pentatonics, ferry bells and a march.
const bells = [783.99, 880, 1046.5, 1174.66, 1318.51];
const windChimesSample = time => {
  const age = time % 1.7;
  const frequency = bells[(Math.floor(time / 1.7) * 3 + 1) % bells.length];
  return (Math.sin(TAU * frequency * age) + 0.3 * Math.sin(TAU * frequency * 2.76 * age)) * Math.exp(-age * 2.4) * 0.35;
};
const ferryBellSample = time => {
  const age = time % 3.1;
  const env = Math.exp(-age * 1.7);
  return (Math.sin(TAU * 392 * age) * 0.4 + Math.sin(TAU * 783.99 * age) * 0.3
    + Math.sin(TAU * 1174.66 * age) * 0.2 + Math.sin(TAU * 196 * age) * 0.1) * env * 0.4;
};
const signalFlagsSample = time => {
  const notes = [261.63, 329.63, 392, 523.25, 392, 329.63];
  const bar = Math.floor(time / 0.5);
  const age = time % 0.5;
  const frequency = notes[bar % notes.length];
  const envelope = Math.min(1, age / 0.01) * Math.exp(-age * 7);
  return (Math.sin(TAU * frequency * age) + 0.25 * Math.sin(TAU * frequency * 2 * age)) * envelope * 0.4
    + (bar % 4 === 0 && age < 0.08 ? Math.sin(TAU * 160 * age) * 0.3 * Math.exp(-age * 30) : 0);
};

function audioFixture(id, title, album, kind, duration, sampleRate, sample, palette, label) {
  return Object.freeze({
    id, title,
    artist: 'JesterOS Originals',
    album,
    kind,
    mime: 'audio/wav',
    content: waveContent(sampleRate, duration, sample),
    duration,
    artwork: artwork(palette, label),
  });
}

const ink = { back: '#0f2733', wave: '#3b82c4', sun: '#ffd166', ink: '#f1f5f9', sunX: 62 };
const amber = { back: '#33230f', wave: '#c2703d', sun: '#f79a3e', ink: '#fdf3e5', sunX: 30 };
const moss = { back: '#16321f', wave: '#4d8b57', sun: '#cde26b', ink: '#eefbef', sunX: 70 };
const slate = { back: '#1b2432', wave: '#64789c', sun: '#a7f3d0', ink: '#e5ecf7', sunX: 34 };

const AUDIO_LIBRARY_FIXTURES = Object.freeze([
  audioFixture('jesteros-tide-organ', 'Tide Organ Nocturne', 'Harbor Nights', 'music', 10, 32_000, tideOrganSample, ink, 'TO'),
  audioFixture('jesteros-harbor-memo', 'Harbor Voice Memo', 'Journal', 'recording', 9, 32_000, harborMemoSample, slate, 'VM'),
  audioFixture('jesteros-wave-patterns-theme', 'Wave Patterns — Theme', 'Wave Patterns', 'music', 8, 22_050, wavePatternsSample, amber, 'WP'),
  audioFixture('jesteros-lightkeeper-interview', 'The Lightkeeper Interview', 'Harbor Signal', 'podcast', 14, 22_050, lightkeeperSample, moss, 'LK'),
  audioFixture('jesteros-tide-almanac-ch1', 'Tide Almanac — Chapter One', 'Tide Almanac', 'audiobook', 11, 16_000, tideAlmanacSample, ink, 'TA'),
]);

// Store catalog: purchasable originals, distinct compositions from the library.
export const MEDIA_STORE_CATALOG = Object.freeze([
  audioFixture('jesteros-store-wind-chimes', 'Harbor Wind Chimes', 'Store Originals', 'music', 9, 22_050, windChimesSample, moss, 'WC'),
  audioFixture('jesteros-store-ferry-bell', 'Ferry Bell Etude', 'Store Originals', 'music', 8, 22_050, ferryBellSample, ink, 'FB'),
  audioFixture('jesteros-store-signal-flags', 'Signal Flags Overture', 'Store Originals', 'music', 7, 22_050, signalFlagsSample, amber, 'SF'),
]);

// The bundled fictional harbour scene: a real VP8/Opus WebM generated offline
// by ffmpeg (sky, sailboat, lighthouse strip, sun, sine-tide audio).
const HARBOR_VIDEO_CONTENT = 'data:video/webm;base64,' + "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" +
  "ooQAzf5gHFO7a5G7j7OBALeK94EB8YICffCBUg==";

export const MEDIA_VIDEO_FIXTURE = Object.freeze({
  id: 'jesteros-harbor-lantern',
  title: 'Harbor Lantern',
  artist: 'JesterOS Harbor Bureau',
  album: 'Motion Originals',
  kind: 'movie',
  mime: 'video/webm',
  content: HARBOR_VIDEO_CONTENT,
  duration: 3.008,
  width: 192,
  height: 108,
  artwork: artwork({ back: '#123a4d', wave: '#2f9dd0', sun: '#ffe08a', ink: '#f0fbff', sunX: 30 }, 'HL'),
});

const { width, height, ...harborAsset } = MEDIA_VIDEO_FIXTURE;
// Harbor Watch's opening intentionally uses the same original harbor footage.
export const MEDIA_FIXTURES = Object.freeze([
  ...AUDIO_LIBRARY_FIXTURES,
  Object.freeze(harborAsset),
  Object.freeze({ ...harborAsset, id: 'jesteros-harbor-watch-101', title: 'Harbor Watch S01E01 — Opening', album: 'Harbor Watch', kind: 'tv' }),
]);
