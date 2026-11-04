import { filterAndSort } from './sort.js';
import { formatBytes, formatNumber } from './stats.js';

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const DETAIL_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'folder', label: 'Folder' },
  { key: 'size', label: 'Size', num: true },
  { key: 'width', label: 'W × D × H (mm)', num: true },
  { key: 'triangles', label: 'Triangles', num: true },
  { key: 'volume', label: 'Volume', num: true },
  { key: 'modified', label: 'Modified', num: true },
];

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

const dims = (s) => (s ? `${formatNumber(s.size.x, 1)} × ${formatNumber(s.size.y, 1)} × ${formatNumber(s.size.z, 1)}` : '—');
const tris = (s) => (s ? formatNumber(s.triangles, 0) : '—');
const vol = (s) => (s ? `${formatNumber(s.volume / 1000, 1)} cm³` : '—');

/** Renders the library as a thumbnail grid, a compact list, or a sortable details table. */
export class LibraryView {
  constructor(container, library, { onOpen, onRemove, onFavorite, onSelectionChange }) {
    this.container = container;
    this.library = library;
    this.onOpen = onOpen;
    this.onRemove = onRemove;
    this.onFavorite = onFavorite;
    this.onSelectionChange = onSelectionChange;
    this.state = { view: 'grid', query: '', key: 'name', dir: 'asc', favorites: false, tag: '' };
    this.selecting = false;
    this.selected = new Set();
    this.visible = [];

    container.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        e.stopPropagation();
        this.onRemove(this._find(rm.dataset.remove));
        return;
      }
      const fav = e.target.closest('[data-fav]');
      if (fav) {
        e.stopPropagation();
        const entry = this._find(fav.dataset.fav);
        if (entry) this.onFavorite(entry, !entry.favorite);
        return;
      }
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const key = th.dataset.sort;
        this.setState(this.state.key === key ? { dir: this.state.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
        this.dispatchSortChange?.();
        return;
      }
      const item = e.target.closest('[data-id]');
      if (item) this._activate(item.dataset.id);
    });
    container.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('[data-id]');
      if (item && e.target === item) {
        e.preventDefault();
        this._activate(item.dataset.id);
      }
    });
  }

  _activate(id) {
    if (!this.selecting) {
      this.onOpen(this._find(id));
      return;
    }
    if (this.selected.has(id)) {
      this.selected.delete(id);
      this.render(); // selection numbers shift
    } else {
      this.selected.add(id);
      const entry = this._find(id);
      if (entry) this.update(entry);
    }
    this.onSelectionChange?.(this.selectedEntries());
  }

  setSelecting(on) {
    this.selecting = on;
    this.selected.clear();
    this.container.classList.toggle('selecting', on);
    this.render();
    this.onSelectionChange?.([]);
  }

  selectedEntries() {
    return [...this.selected].map((id) => this._find(id)).filter(Boolean);
  }

  _find(id) {
    return this.library.entries.find((e) => e.id === id);
  }

  setState(patch) {
    Object.assign(this.state, patch);
    this.render();
  }

  render() {
    const { view, query, key, dir, favorites, tag } = this.state;
    this.visible = filterAndSort(this.library.entries, { query, key, dir, favorites, tag });
    let body;
    if (view === 'details') body = this._details();
    else if (view === 'list') body = el('ul', { class: 'lib-list' }, ...this.visible.map((e) => this._listItem(e)));
    else body = el('ul', { class: 'lib-grid' }, ...this.visible.map((e) => this._card(e)));
    this.container.replaceChildren(body);
  }

  /** Update one entry in place when its thumbnail or stats arrive (no full re-render). */
  update(entry) {
    for (const node of this.container.querySelectorAll(`[data-id="${CSS.escape(entry.id)}"]`)) {
      const fresh = this.state.view === 'details' ? this._row(entry) : this.state.view === 'list' ? this._listItem(entry) : this._card(entry);
      node.replaceWith(fresh);
    }
  }

  _thumb(entry, cls) {
    const url = this.library.thumbUrl(entry);
    const meta = this.library.meta.get(entry.cacheKey);
    if (url) return el('img', { class: cls, src: url, alt: '', loading: 'lazy', decoding: 'async' });
    let label = '…';
    if (meta?.tooBig) label = 'Too big to preview';
    else if (meta?.error) label = 'Unreadable';
    return el('div', { class: `${cls} thumb-placeholder` }, el('span', {}, label));
  }

  _favBtn(entry) {
    return el(
      'button',
      {
        class: `fav-btn${entry.favorite ? ' on' : ''}`,
        title: entry.favorite ? 'Unfavorite' : 'Favorite',
        'aria-label': entry.favorite ? `Unfavorite ${entry.name}` : `Favorite ${entry.name}`,
        'aria-pressed': String(entry.favorite),
        dataset: { fav: entry.id },
      },
      entry.favorite ? '★' : '☆'
    );
  }

  _tagList(entry) {
    if (!entry.tags.length) return null;
    return el('div', { class: 'tag-list' }, ...entry.tags.map((t) => el('span', { class: 'tag' }, t)));
  }

  _check(entry) {
    if (!this.selecting) return null;
    const i = [...this.selected].indexOf(entry.id);
    return el('span', { class: `select-check${i >= 0 ? ' on' : ''}`, 'aria-hidden': 'true' }, i >= 0 ? String(i + 1) : '');
  }

  _removeBtn(entry) {
    if (entry.source !== 'import' || this.selecting) return null;
    return el('button', { class: 'remove-btn', title: 'Remove from library', 'aria-label': `Remove ${entry.name}`, dataset: { remove: entry.id } }, '✕');
  }

  _card(e) {
    return el(
      'li',
      { class: `card${this.selected.has(e.id) ? ' selected' : ''}`, tabindex: 0, dataset: { id: e.id }, title: `${e.folder}/${e.name}` },
      this._thumb(e, 'card-thumb'),
      el('div', { class: 'card-name' }, e.name.replace(/\.stl$/i, '')),
      el('div', { class: 'card-sub' }, e.stats ? `${dims(e.stats)} mm` : formatBytes(e.size)),
      this._tagList(e),
      this._favBtn(e),
      this._check(e),
      this._removeBtn(e)
    );
  }

  _listItem(e) {
    return el(
      'li',
      { class: `list-item${this.selected.has(e.id) ? ' selected' : ''}`, tabindex: 0, dataset: { id: e.id } },
      this._check(e),
      this._thumb(e, 'list-thumb'),
      el('div', { class: 'list-main' }, el('div', { class: 'list-name' }, e.name), el('div', { class: 'list-sub' }, e.folder), this._tagList(e)),
      this._favBtn(e),
      el('div', { class: 'list-meta' }, el('div', {}, formatBytes(e.size)), el('div', { class: 'list-sub' }, e.stats ? `${dims(e.stats)} mm` : '')),
      this._removeBtn(e)
    );
  }

  _details() {
    const { key, dir } = this.state;
    const head = el(
      'tr',
      {},
      el('th', { class: 'col-thumb' }),
      el('th', { class: 'col-fav' }),
      ...DETAIL_COLUMNS.map((c) =>
        el(
          'th',
          { dataset: { sort: c.key }, class: [c.num ? 'num' : '', key === c.key ? `sorted ${dir}` : ''].join(' ').trim(), 'aria-sort': key === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : null },
          c.label
        )
      ),
      el('th', { class: 'col-actions' })
    );
    return el(
      'div',
      { class: 'table-wrap' },
      el('table', { class: 'lib-table' }, el('thead', {}, head), el('tbody', {}, ...this.visible.map((e) => this._row(e))))
    );
  }

  _row(e) {
    const s = e.stats;
    return el(
      'tr',
      { tabindex: 0, dataset: { id: e.id }, class: this.selected.has(e.id) ? 'selected' : null },
      el('td', { class: 'col-thumb' }, this._check(e) ?? this._thumb(e, 'row-thumb')),
      el('td', { class: 'col-fav' }, this._favBtn(e)),
      el('td', { class: 'name' }, e.name, this._tagList(e)),
      el('td', { class: 'muted' }, e.folder),
      el('td', { class: 'num' }, formatBytes(e.size)),
      el('td', { class: 'num' }, dims(s)),
      el('td', { class: 'num' }, tris(s)),
      el('td', { class: 'num' }, vol(s)),
      el('td', { class: 'num' }, e.lastModified ? dateFmt.format(e.lastModified) : '—'),
      el('td', { class: 'col-actions' }, this._removeBtn(e))
    );
  }
}
