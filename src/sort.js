// Pure helpers for filtering and sorting library entries. Kept DOM-free so they're unit-testable.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const SORT_KEYS = {
  name: (e) => e.name,
  folder: (e) => e.folder ?? '',
  size: (e) => e.size,
  modified: (e) => e.lastModified,
  triangles: (e) => e.stats?.triangles,
  width: (e) => e.stats?.size.x,
  depth: (e) => e.stats?.size.y,
  height: (e) => e.stats?.size.z,
  volume: (e) => e.stats?.volume,
};

/**
 * Filter by favorites / tag and a search string (matches name, folder path and tags; all words must match),
 * then sort by key/direction. Entries missing the sort value (stats not computed yet) go last.
 */
export function filterAndSort(entries, { query = '', key = 'name', dir = 'asc', favorites = false, tag = '' } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = entries.filter((e) => {
    if (favorites && !e.favorite) return false;
    if (tag && !(e.tags ?? []).includes(tag)) return false;
    if (!words.length) return true;
    const hay = `${e.name} ${e.folder ?? ''} ${(e.tags ?? []).join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });

  const get = SORT_KEYS[key] ?? SORT_KEYS.name;
  const sign = dir === 'desc' ? -1 : 1;
  return filtered.sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    const missA = va === undefined || va === null;
    const missB = vb === undefined || vb === null;
    if (missA || missB) {
      if (missA && missB) return collator.compare(a.name, b.name);
      return missA ? 1 : -1;
    }
    const c = typeof va === 'string' ? collator.compare(va, vb) : va - vb;
    return c !== 0 ? c * sign : collator.compare(a.name, b.name);
  });
}
