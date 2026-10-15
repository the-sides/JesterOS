import { object, choice, flag, empty, defineCommand } from './command-schema.js';
import { DVD_PROFILES, dvdIdSchema, dvdPreferencesSchema, dvdSession } from './dvd-state.js';
import { DVD_DISC, dvdTitle, dvdChapter } from './dvd-fixtures.js';
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
export const dvdWindowTarget = object({ windowId: dvdIdSchema });
export const dvdCommandPayloads = {
  'dvd.load': object({ discId: choice(DVD_DISC.id) }, []), 'dvd.eject': empty,
  'dvd.play': empty, 'dvd.pause': empty, 'dvd.stop': empty,
  'dvd.seek': object({ position: number(0, 3) }),
  'dvd.title': object({ titleId: choice(...DVD_DISC.titles.map(title => title.id)) }),
  'dvd.chapter': object({ chapterId: choice(...DVD_DISC.titles.flatMap(title => title.chapters.map(chapter => chapter.id))) }),
  'dvd.step': object({ direction: choice('next', 'previous') }),
  'dvd.discMenu': object({ visible: flag }),
  'dvd.subtitle': object({ trackId: choice('off', 'en', 'fr') }),
  'dvd.audioTrack': object({ trackId: choice('original', 'score') }),
  'dvd.rate': object({ rate: choice(0.5, 1, 1.5, 2) }),
  'dvd.repeat': object({ mode: choice('off', 'title', 'chapter') }),
  'dvd.observe': empty,
  'dvd.bookmarkAdd': object({ name: { type: 'string', minLength: 1, maxLength: 128 } }),
  'dvd.bookmarkGo': object({ bookmarkId: dvdIdSchema }),
  'dvd.bookmarkRename': object({ bookmarkId: dvdIdSchema, name: { type: 'string', minLength: 1, maxLength: 128 } }),
  'dvd.bookmarkDelete': object({ bookmarkId: dvdIdSchema }),
  'dvd.preferences': object({ values: dvdPreferencesSchema }),
  'dvd.panel': object({ panel: choice('none', 'bookmarks', 'preferences', 'help') }),
  'dvd.fullWindow': object({ enabled: flag }),
};
export const dvdCatalog = Object.fromEntries(Object.entries(dvdCommandPayloads).map(([name, payload]) => defineCommand(DVD_PROFILES, name, 'dvd.local', dvdWindowTarget, payload, ['Original DVD state, per-window session, actual mounted HTMLVideo facade and authored scene time.', 'Real bundled local video and PCM alternate score; no optical drive, network, OS volume authority or commercial DVD decoding.'], ['Observed playback and authored disc navigation; profile-qualified DVD Player presentation.'], ['dvd'], [], dvdWindowTarget)));
export function dvdMenuItems(state, windowId) {
  const session = dvdSession(state, windowId), loaded = !!session?.discId, title = dvdTitle(session?.titleId), chapter = dvdChapter(session?.titleId, session?.position ?? 0);
  const item = (label, command, payload = {}, enabled = true, checked = false) => ({ label, command, target: { windowId }, payload, enabled: !!session && enabled, checked });
  return [
    { label: 'DVD Player', items: [item('Preferences…', 'dvd.panel', { panel: 'preferences' }), item('DVD Player Help', 'dvd.panel', { panel: 'help' })] },
    { label: 'File', items: [item('Open Authored Local Disc', 'dvd.load'), item('Eject', 'dvd.eject', {}, loaded)] },
    { label: 'Controls', items: [item(session?.playing ? 'Pause' : 'Play', session?.playing ? 'dvd.pause' : 'dvd.play', {}, loaded), item('Stop', 'dvd.stop', {}, loaded), item('Previous Chapter', 'dvd.step', { direction: 'previous' }, loaded), item('Next Chapter', 'dvd.step', { direction: 'next' }, loaded), item('DVD Menu', 'dvd.discMenu', { visible: !session?.discMenu }, loaded, session?.discMenu), ...[0.5, 1, 1.5, 2].map(rate => item(`${rate}× Playback`, 'dvd.rate', { rate }, loaded, session?.rate === rate)), ...['off', 'title', 'chapter'].map(mode => item(`Repeat ${mode}`, 'dvd.repeat', { mode }, loaded, session?.repeat === mode))] },
    { label: 'Go', items: [...DVD_DISC.titles.map(row => item(row.name, 'dvd.title', { titleId: row.id }, loaded, title === row)), ...(title?.chapters ?? []).map(row => item(row.name, 'dvd.chapter', { chapterId: row.id }, loaded, chapter === row))] },
    { label: 'Video', items: [item('Fill Player Window', 'dvd.fullWindow', { enabled: !session?.fullWindow }, loaded, session?.fullWindow), ...DVD_DISC.subtitles.map(track => item(`Subtitles: ${track.name}`, 'dvd.subtitle', { trackId: track.id }, loaded, session?.subtitle === track.id))] },
    { label: 'Audio', items: DVD_DISC.audioTracks.map(track => item(track.name, 'dvd.audioTrack', { trackId: track.id }, loaded, session?.audioTrack === track.id)) },
    { label: 'Bookmarks', items: [item('Bookmarks…', 'dvd.panel', { panel: 'bookmarks' }), item('Add Bookmark', 'dvd.bookmarkAdd', { name: `${title?.name ?? 'Harbor'} — ${(session?.position ?? 0).toFixed(2)}s` }, loaded), ...state.bookmarks.map(bookmark => item(bookmark.name, 'dvd.bookmarkGo', { bookmarkId: bookmark.id }, loaded))] },
  ];
}
