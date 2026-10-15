// Validated canonical graphs may be Svelte deep-state proxies. structuredClone
// cannot read those proxies; copy only the closed JSON vocabulary at transitions.
export function copyCanonicalData(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copyCanonicalData);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyCanonicalData(child)]));
}

// Apply a validated candidate without replacing unchanged record/collection
// identities retained by native views and in-flight ownership leases.
export function applyCanonicalData(actual, next, adoptedRecords = null) {
  if (Array.isArray(actual) && Array.isArray(next)) {
    const key = row => row && typeof row === 'object' ? row.id ?? row.tab?.id ?? row.windowId : undefined;
    const records = new Map();
    for (const row of actual) {
      const id = key(row);
      if (id) records.set(id, records.has(id) ? null : row);
    }
    const result = next.map((row, index) => {
      const previous = key(row) ? records.get(key(row)) : actual[index];
      if (row && previous && typeof row === 'object' && typeof previous === 'object' && Array.isArray(row) === Array.isArray(previous)) {
        applyCanonicalData(previous, row, adoptedRecords);
        return previous;
      }
      return adoptedRecords?.has(row) ? row : copyCanonicalData(row);
    });
    actual.splice(0, actual.length, ...result);
    return;
  }
  for (const key of Object.keys(actual)) if (!Object.hasOwn(next, key)) delete actual[key];
  for (const [key, value] of Object.entries(next)) {
    if (value && actual[key] && typeof value === 'object' && typeof actual[key] === 'object' && Array.isArray(value) === Array.isArray(actual[key]))
      applyCanonicalData(actual[key], value, adoptedRecords);
    else actual[key] = adoptedRecords?.has(value) ? value : copyCanonicalData(value);
  }
}

// Complete-scene retention accounts for property names and array indices too.
export function canonicalStringUnits(value) {
  if (typeof value === 'string') return value.length;
  if (value === null || typeof value !== 'object') return 0;
  let total = 0;
  for (const key of Object.keys(value)) total += key.length + canonicalStringUnits(value[key]);
  return total;
}
