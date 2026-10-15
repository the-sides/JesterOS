import { availableFonts, fontCSSFamily, loadAvailableFonts } from './font-book-fonts.js';

/** Rendering lease over the original shared graph, never a document font registry.
 * Literal authored family names stay in documents/codecs; only CSS is resolved. */
export function createDocumentFonts({ getShared, getFile, getRoot, getOwner }) {
  let loaded = $state.raw(null);
  let error = $state('');
  const original = getOwner(), originalGraph = getShared?.('fonts');
  const owned = () => getOwner().every((value, index) => value === original[index]) && getRoot()?.isConnected === true;
  const graph = $derived(getShared?.('fonts'));
  const rows = $derived(graph === originalGraph ? availableFonts(graph, getFile) : []);
  const families = $derived([...new Set(rows.map(font => font.family))]);
  $effect(() => {
    const source = graph, signature = JSON.stringify(source), root = getRoot();
    const owner = getOwner();
    for (const font of rows) if (font.fileId) JSON.stringify(getFile(font.fileId));
    if (!root || !owner.every((value, index) => value === original[index])) return;
    if (!source || source !== originalGraph) { loaded = null; error = source ? 'The original font source has retired.' : 'The canonical font source is unavailable; using a safe browser fallback.'; return; }
    let alive = true, lease;
    const guard = () => alive && owned() && graph === source && JSON.stringify(source) === signature;
    loaded = null; error = '';
    loadAvailableFonts(source, { getFile, guard }).then(result => {
      if (!guard()) { result.dispose(); return; }
      lease = result; loaded = result;
    }).catch(failure => { if (guard()) error = failure.message; });
    return () => { alive = false; lease?.dispose(); };
  });
  return {
    get families() { return families; },
    get error() { return error; },
    get revision() { return rows.map(font => `${font.id}:${font.signature}:${loaded?.fonts.includes(font)}`).join('|'); },
    has(name) { return families.includes(name); },
    choices(name) { return name && !families.includes(name) ? [name, ...families] : families; },
    css(name, bold = false, italic = false, fallback = 'sans-serif') {
      const candidates = owned() ? rows.filter(font => loaded?.fonts.includes(font) && font.family === name) : [];
      const score = font => Number(/bold|black|heavy/i.test(font.style) !== !!bold) + Number(/italic|oblique/i.test(font.style) !== !!italic);
      const face = candidates.reduce((best, font) => !best || score(font) < score(best) ? font : best, null);
      return face ? `${fontCSSFamily(face)}, ${fallback}` : fallback;
    },
  };
}
