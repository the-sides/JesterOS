import { MEDIA_VIDEO_FIXTURE, MEDIA_FIXTURES } from './media-fixtures.js';

// Authored local disc navigation over real VP8/Opus bytes, not an optical image.
// Titles are full movie and a genuinely bounded excerpt of the same source.
export const DVD_DISC = Object.freeze({
  id: 'dvd-harbor-lantern', name: 'Harbor Lantern — Local Disc',
  description: 'An authored JesterOS disc menu over bundled local video. No optical drive, commercial DVD decoding, or network service.',
  titles: Object.freeze([
    Object.freeze({ id: 'dvd-title-movie', name: 'Harbor Lantern', start: 0, end: MEDIA_VIDEO_FIXTURE.duration, chapters: Object.freeze([
      Object.freeze({ id: 'dvd-chapter-dawn', name: 'Harbor Dawn', position: 0 }),
      Object.freeze({ id: 'dvd-chapter-sail', name: 'Passing Sail', position: 1 }),
      Object.freeze({ id: 'dvd-chapter-light', name: 'Lantern Shore', position: 2 }),
    ]) }),
    Object.freeze({ id: 'dvd-title-shore', name: 'Lantern Shore — Scene Selection', start: 1, end: MEDIA_VIDEO_FIXTURE.duration, chapters: Object.freeze([
      Object.freeze({ id: 'dvd-chapter-shore-sail', name: 'Passing Sail', position: 0 }),
      Object.freeze({ id: 'dvd-chapter-shore-light', name: 'Lantern Shore', position: 1 }),
    ]) }),
  ]),
  subtitles: Object.freeze([
    Object.freeze({ id: 'off', name: 'Off', language: '', cues: Object.freeze([]) }),
    Object.freeze({ id: 'en', name: 'English — Authored Captions', language: 'en', cues: Object.freeze([
      Object.freeze({ start: 0, end: 1, text: '[A quiet harbor at dawn]' }),
      Object.freeze({ start: 1, end: 2, text: '[A sailboat passes the lighthouse]' }),
      Object.freeze({ start: 2, end: 3, text: '[The lantern watches over the shore]' }),
    ]) }),
    Object.freeze({ id: 'fr', name: 'Français — Légendes locales', language: 'fr', cues: Object.freeze([
      Object.freeze({ start: 0, end: 1, text: '[Un port paisible à l’aube]' }),
      Object.freeze({ start: 1, end: 2, text: '[Un voilier passe devant le phare]' }),
      Object.freeze({ start: 2, end: 3, text: '[La lanterne veille sur le rivage]' }),
    ]) }),
  ]),
  audioTracks: Object.freeze([
    Object.freeze({ id: 'original', name: 'Original Harbor Sound — Opus', content: null }),
    Object.freeze({ id: 'score', name: 'Tide Organ — Local Alternate Score', content: MEDIA_FIXTURES.find(asset => asset.kind === 'music').content }),
  ]),
});
export const dvdTitle = id => DVD_DISC.titles.find(title => title.id === id) ?? null;
export const dvdTitleDuration = id => { const title = dvdTitle(id); return title ? title.end - title.start : 0; };
export const dvdChapter = (titleId, position) => dvdTitle(titleId)?.chapters.findLast(chapter => chapter.position <= position) ?? null;
export { MEDIA_VIDEO_FIXTURE as DVD_VIDEO };
