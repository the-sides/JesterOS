export const spotlightGroups = ['apps', 'documents', 'contacts', 'mail'];
export const spotlightQueryLimit = 256;
const groups = { app: 'apps', file: 'documents', note: 'documents', contact: 'contacts', mail: 'mail' };
const fold = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const spotlightResultId = source => `${source.kind}:${source.id}`;
export function publicSpotlightResult(source) {
  return { resultId: spotlightResultId(source), group: groups[source.kind], kind: source.kind,
    label: source.label, secondary: source.secondary, icon: source.icon, canReveal: source.canReveal };
}
/** Literal bounded AND search. Private descriptors stay private; callers project results explicitly. */
export function rankSpotlightSources(sources, query) {
  if (typeof query !== 'string' || query.length > spotlightQueryLimit) return [];
  const needle = fold(query.trim()).replace(/\s+/gu, ' '), tokens = needle.split(' ');
  if (!needle) return [];
  const ranked = [];
  for (const source of sources) {
    if (!Object.hasOwn(groups, source.kind)) continue;
    const label = fold(source.label);
    let remaining = tokens.filter(token => !label.includes(token));
    for (const term of source.terms) {
      if (!remaining.length) break;
      const content = fold(term);
      remaining = remaining.filter(token => !content.includes(token));
    }
    if (remaining.length) continue;
    const rank = label === needle ? 0 : label.startsWith(needle) ? 1 : tokens.every(token => label.includes(token)) ? 2 : 3;
    ranked.push({ source, label, rank, group: spotlightGroups.indexOf(groups[source.kind]) });
  }
  ranked.sort((a, b) => a.group - b.group || a.rank - b.rank || compare(a.label, b.label)
    || compare(a.source.label, b.source.label) || compare(a.source.kind, b.source.kind) || compare(a.source.id, b.source.id));
  return ranked.map(entry => entry.source);
}
export const searchSpotlightSources = (sources, query) => rankSpotlightSources(sources, query).map(publicSpotlightResult);
