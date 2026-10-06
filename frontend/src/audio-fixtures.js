// Original JesterOS scores: each offline PCM WAV is synthesized on first use only.
// No recordings, network media, AudioContext, or host-device APIs are used.
const SAMPLE_RATE = 22_050;
const TAU = Math.PI * 2;

function pcmWave(duration, sample) {
  const frames = duration * SAMPLE_RATE;
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset, value) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index);
  };
  label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true);
  label(8, 'WAVE'); label(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / SAMPLE_RATE;
    const fade = Math.min(1, time / 0.025, (duration - time) / 0.08);
    const value = Math.max(-1, Math.min(1, sample(time) * fade));
    view.setInt16(44 + frame * 2, Math.round(value * 32_767), true);
  }
  // Bound the argument count instead of spreading a complete WAV into btoa.
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    blocks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return `data:audio/wav;base64,${btoa(blocks.join(''))}`;
}

function fixture(id, title, duration, sample) {
  let source = null;
  return Object.freeze({ id, title, artist: 'JesterOS Originals', duration,
    get src() {
      if (source === null) source = pcmWave(duration, sample);
      return source;
    } });
}

const musicNotes = [261.6256, 329.6276, 391.9954, 523.2511, 440, 391.9954, 329.6276, 293.6648];
const musicSample = time => {
  const beat = Math.floor(time / 0.5), age = time % 0.5;
  const frequency = musicNotes[beat % musicNotes.length];
  const envelope = Math.min(1, age / 0.012) * Math.exp(-age * 6);
  const melody = (Math.sin(TAU * frequency * age) + 0.18 * Math.sin(TAU * frequency * 2 * age)) * envelope;
  const bass = Math.sin(TAU * (beat < 8 || beat >= 16 ? 130.8128 : 146.8324) * time) * 0.11;
  return melody * 0.3 + bass;
};

const quickTimeNotes = [440, 554.3653, 659.2551, 880];
const quickTimeSample = time => {
  const beat = Math.floor(time), age = time % 1;
  const frequency = quickTimeNotes[beat % quickTimeNotes.length];
  const envelope = Math.min(1, age / 0.008) * Math.exp(-age * 4.8);
  return (Math.sin(TAU * frequency * age) + 0.23 * Math.sin(TAU * frequency * 2.01 * age)
    + 0.08 * Math.sin(TAU * frequency * 3.97 * age)) * envelope * 0.36;
};

export const AUDIO_FIXTURES = Object.freeze({
  music: fixture('jesteros-golden-arpeggio', 'Golden Arpeggio', 12, musicSample),
  quicktime: fixture('jesteros-glass-study', 'Glass Study.wav', 8, quickTimeSample),
});
