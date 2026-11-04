import { describe, it, expect } from 'vitest';
import { filterAndSort } from './sort.js';

const entries = [
  { name: 'part10.stl', folder: 'robots/arm', size: 300, lastModified: 3, stats: { triangles: 50, size: { x: 1, y: 2, z: 30 }, volume: 9 } },
  { name: 'part2.stl', folder: 'robots', size: 100, lastModified: 1, stats: { triangles: 500, size: { x: 5, y: 2, z: 10 }, volume: 3 } },
  { name: 'Benchy.stl', folder: 'boats', size: 200, lastModified: 2 }, // no stats yet
];
const names = (list) => list.map((e) => e.name);

describe('filterAndSort', () => {
  it('sorts names naturally and case-insensitively', () => {
    expect(names(filterAndSort(entries))).toEqual(['Benchy.stl', 'part2.stl', 'part10.stl']);
  });

  it('sorts descending', () => {
    expect(names(filterAndSort(entries, { key: 'size', dir: 'desc' }))).toEqual(['part10.stl', 'Benchy.stl', 'part2.stl']);
  });

  it('puts entries without stats last regardless of direction', () => {
    expect(names(filterAndSort(entries, { key: 'triangles' }))).toEqual(['part10.stl', 'part2.stl', 'Benchy.stl']);
    expect(names(filterAndSort(entries, { key: 'triangles', dir: 'desc' }))).toEqual(['part2.stl', 'part10.stl', 'Benchy.stl']);
  });

  it('filters by name and folder, requiring every word', () => {
    expect(names(filterAndSort(entries, { query: 'robots' }))).toEqual(['part2.stl', 'part10.stl']);
    expect(names(filterAndSort(entries, { query: 'arm part' }))).toEqual(['part10.stl']);
    expect(names(filterAndSort(entries, { query: 'BENCHY' }))).toEqual(['Benchy.stl']);
    expect(filterAndSort(entries, { query: 'nope' })).toEqual([]);
  });

  it('filters favorites and tags, and searches tags', () => {
    const tagged = entries.map((e, i) => ({ ...e, favorite: i === 1, tags: i === 0 ? ['robot', 'pla'] : [] }));
    expect(names(filterAndSort(tagged, { favorites: true }))).toEqual(['part2.stl']);
    expect(names(filterAndSort(tagged, { tag: 'robot' }))).toEqual(['part10.stl']);
    expect(names(filterAndSort(tagged, { query: 'pla' }))).toEqual(['part10.stl']);
    expect(filterAndSort(tagged, { favorites: true, tag: 'robot' })).toEqual([]);
  });

  it('does not mutate the input', () => {
    const copy = entries.slice();
    filterAndSort(entries, { key: 'size' });
    expect(entries).toEqual(copy);
  });
});
