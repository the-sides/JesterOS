import { defineCommand, identity, flag, offset, choice, object, empty } from './command-schema.js';

const windowId = { ...identity, maxLength: 256 };
const owner = object({ windowId });
const focusTarget = object({ windowId, control: choice('play-pause', 'position', 'volume', 'sound-settings') });
const live = 'Alive foreground retained Golden desktop, ordinary scene available, exact original Music or QuickTime window object and Root-local registered real HTMLAudioElement.';
const interaction = 'Connected, noninert, visible native player in the original Root; requested controls must be enabled and actually unclipped after reveal. Hidden/minimized players retain playback but cannot receive interaction commands.';
const boundary = 'Original offline mono PCM WAV cues only: Golden Arpeggio (Music,12 seconds) and Glass Study.wav (QuickTime,8 seconds). No streaming, library, playlists, movie editing, recording, microphone permission, host device enumeration, or output hardware routing.';
const transient = 'All playback, position, readiness, errors, focus and scroll are transient real DOM observations; no cold autoplay or saved playback. Root foreground loss/destroy pauses the original audio node. Master output gain and app volume multiply; effective mute is applied to the same retained node.';
function define(name, target, payload, requires, presentation, data, result) {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], name, 'status.sound', target, payload,
    [live, ...requires], presentation, [boundary, transient, ...data], [], result);
  entry[1].resultSchema.additionalProperties = false;
  if (name === 'sound.media.play' || name === 'sound.media.seek') {
    entry[1].completion = { mode: 'promise', success: 'applied', settles: name === 'sound.media.play'
      ? 'Original HTMLAudioElement.play() acceptance, actual unpaused playback, Root/window/view lease revalidation and transient notification. Browser autoplay/media failures reject with a live visible error.'
      : 'Actual HTMLAudioElement currentTime seek completion, Root/window/view lease revalidation and transient notification; returned seconds are read from the actual element, never an authored timer.' };
  }
  return entry;
}

export const soundMediaCatalog = Object.fromEntries([
  define('sound.media.play', owner, empty, [interaction],
    ['Play the supplied original cue through the actual retained HTMLAudioElement; only report playing true after accepted native playback.'],
    ['Read the actual media snapshot and notify only the original Root. Browser failure stays paused and is rejected unavailable with the live error.'],
    object({ windowId, playing: { const: true } })),
  define('sound.media.pause', owner, empty, [interaction],
    ['Pause the actual original HTMLAudioElement without replacing it or resetting its position.'],
    ['Observe actual paused state; notify the original Root so Only When Active Sound visibility follows playback.'],
    object({ windowId, playing: { const: false } })),
  define('sound.media.seek', owner, object({ seconds: offset }), [interaction, 'Actual metadata with finite duration; seconds must not exceed that duration.'],
    ['Seek the real audio currentTime; wait for native completion and return its observed position in seconds.'],
    ['Reject missing metadata or a position past the actual duration; never silently clamp, advance a fake playhead, or save position.'],
    object({ windowId, position: offset })),
  define('sound.media.focus', focusTarget, object({ observe: flag }, []), [interaction],
    ['Reveal and focus the actual typed control, or observe already-established real native focus.'],
    ['No persistent mutation; caller focus claims are checked against the actual original control.'], focusTarget),
  define('sound.media.scroll', owner, object({ top: offset, left: offset, observe: flag }, ['top']), [interaction],
    ['Apply actual body scrolling (left defaults0) and return clamped offsets, or validate real native scroll observation.'],
    ['No persistent mutation; observed offsets must match the actual original body.'], object({ windowId, top: offset, left: offset })),
  define('sound.media.observe', owner, empty, ['Actual original media node remains connected; hidden/minimized retained players may be observed.'],
    ['Read the actual registered DOM snapshot for metadata/timeupdate/playing/pause/ended/error/volumechange events.'],
    ['Update only parent transient reactive observation and Sound active-menu visibility; no playback/error/time values are accepted from the caller.'], owner),
]);
