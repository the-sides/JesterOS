import { defineCommand, object, empty, flag, choice, offset } from './command-schema.js';
import { inputSchema } from './input-model.js';

const sourceId = inputSchema.properties.activeSourceId;
const previousSourceId = inputSchema.properties.previousSourceId;
const sourceIds = inputSchema.properties.sourceIds;
const viewerId = { type: 'string', minLength: 1, maxLength: 128 };
const keyId = { type: 'string', minLength: 1, maxLength: 128 };
const characterId = { type: 'string', minLength: 1, maxLength: 128 };
const kind = choice('keyboard', 'characters');
const category = choice('all', 'emoji', 'symbols', 'latin');
const control = { type: 'string', minLength: 1, maxLength: 128 };
const query = { type: 'string', maxLength: 256 };
const viewerTarget = object({ viewerId });
const observed = object({ observe: flag }, []);
const sourceResult = object({ sourceId, previousSourceId });
const original = 'Exact current Root-owned original viewer ID and native enabled control; its captured app/window must still be the original owner. Lock/inactive roots and competing transient presentation cannot operate or steal focus.';
const available = 'Alive foreground Golden Gate retained root, complete canonical Input state, no competing modal or native preparation.';
const boundary = 'Original bounded U.S. English/QWERTY, French AZERTY and German QWERTZ Latin layouts and a local character catalogue only. Viewer keys emit fictional alternate-language input; browser physical keyboard and host keyboard/IME remain unchanged. No host configuration, dead-key composition, candidate conversion, favorites, history or Genmoji.';
const define = (name, target, payload, requires, effects, result) => {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], name, 'status.input', target, payload,
    [available, ...requires], effects, [boundary], [], result);
  entry[1].resultSchema.additionalProperties = false;
  entry[1].completion = { mode: 'promise', success: 'applied',
    settles: 'Canonical guarded full-root-budget transition, mounted original viewer, requested actual enabled control focus, native query/modifier readback and actual DOM-clamped body scroll. Text insertion uses the existing original canonical writer and native UTF-16 caret; Notes records undo and service drafts commit revisions. Browser keyboard/host IME and animation/font completion are excluded.' };
  return entry;
};

export const inputCatalog = Object.fromEntries([
  define('input.source.select', object({ sourceId }), empty, ['Requested source is configured.'],
    ['Select the configured authored source and update the onscreen layout/glyphs. A genuine change makes the old active source previous; selecting the current source retains previous. Source menu rows close normally and return the original editor.'], sourceResult),
  define('input.source.cycle', empty, object({ direction: choice('last', 'next') }), [],
    ['Last selects the valid previous source, or wraps to next when previous is null. Next follows configured order; a single configured source retains active with previous null.'], sourceResult),
  define('input.sources.configure', empty, object({ sourceIds }), [],
    ['Atomically replace the ordered one-to-three unique authored sources. Keep active when retained, otherwise use first; clear a removed or now-active previous source. Readonly, stale identity/descriptors and exact complete-root text quota including array numeric keys reject before any mutation.'],
    object({ sourceIds, sourceId, previousSourceId })),
  define('input.menu.configure', empty, object({ showInMenuBar: flag }), [],
    ['Set only the canonical Input menu-bar checkbox. Hiding retires only its matching original shared popup and returns its original editor; native viewers and Settings remain open.'], object({ showInMenuBar: flag })),
  define('input.viewer.open', empty, object({ kind }), [],
    ['Mount and focus the actual keyboard panel or character search before Applied. Two independent modeless Root-owned viewers may coexist; repeated same kind reuses the original viewer and editor lease. Retire the matching shared Input popup before focus. Desktop/no-editor opening supports honest browsing with insertion disabled. Failed mount/focus rolls back only its own candidate.'], object({ viewerId, kind })),
  define('input.viewer.close', viewerTarget, object({ restoreFocus: flag }, []), [original],
    ['Close only the exact live original utility. Unless explicitly disabled, restore its original foreground owner without substituting another editor. Private IDs/drafts/leases disappear on clear/disposal and are never saved; modeless browsing does not block scene save or accepted exit.'], object({ viewerId })),
  define('input.viewer.focus', object({ viewerId, control }), observed, [original, 'Requested current enabled control is present; observe requires actual native focus.'],
    ['Reveal, focus and read back only this real control ID, or observe its existing focus. No arbitrary selector or canonical text mutation.'], object({ viewerId, control })),
  define('input.viewer.scroll', viewerTarget, object({ top: offset, observe: flag }, ['top']), [original],
    ['Scroll or observe the actual viewer body and return its DOM-clamped finite nonnegative offset. Header/footer remain pinned; no canonical preference changes.'], object({ viewerId, top: offset })),
  define('input.keyboard.modifiers', viewerTarget,
    { anyOf: [object({ shift: flag }), object({ option: flag }), object({ shift: flag, option: flag })] }, [original, 'Keyboard kind only.'],
    ['Set at least one private Shift/Option toggle, compare its original native pressed state and read back after native settlement. Recheck original ownership around every await.'], object({ viewerId, shift: flag, option: flag })),
  define('input.keyboard.press', object({ viewerId, keyId }), empty, [original, 'Exact current authored visible key; insert/delete/newline require the original writable editor.'],
    ['Toggle Shift/Option or pass the current source glyph, Space, Backspace or Return to the existing original canonical writer. Preserve Notes undo, service-draft revisions and native UTF-16 selection; Backspace removes whole graphemes and single-line fields normalize newlines. Successful writes alone advance the private editor lease. Never write Notes directly or change clipboard.'], object({ viewerId, keyId })),
  define('input.characters.search', viewerTarget, object({ query }), [original, 'Characters kind only; query is bounded to 256 UTF-16 units.'],
    ['Synchronize the real search field compare-before-write, preserving caret when equal. Search literal glyphs, Unicode codes, names and keywords in the bounded catalogue; honest empty results. Clear private selection when filtered away and guard original ownership after awaits.'], object({ viewerId, query })),
  define('input.characters.category', viewerTarget, object({ category }), [original, 'Characters kind only.'],
    ['Set the actual current bounded category and clear a private selected character that is filtered away. This expanded local picker stays open.'], object({ viewerId, category })),
  define('input.characters.select', object({ viewerId, characterId }), empty, [original, 'Requested glyph is present in the actual current query/category results.'],
    ['Reveal and focus the real filtered glyph control and retain only its private stable character identity.'], object({ viewerId, characterId })),
  define('input.characters.insert', object({ viewerId, characterId }), empty, [original, 'Requested glyph is currently filtered in and the original editable lease is exact and writable.'],
    ['Insert the exact authored glyph through the existing canonical writer with native UTF-16 caret, Notes undo or service-draft revision, never clipboard mutation or a guessed editor. Astral/multicodepoint content remains literal. Double-click/Insert use this same action and leave the expanded picker open.'], object({ viewerId, characterId })),
]);
