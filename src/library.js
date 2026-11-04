import * as db from './db.js';
import { ThumbnailRenderer } from './thumbs.js';

// Files bigger than this get no thumbnail (they'd eat memory on phones); they still open fine.
const MAX_THUMB_BYTES = 150 * 1024 * 1024;
const isStl = (name) => /\.stl$/i.test(name);

export const canPickFolders = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/**
 * The file library. Two kinds of sources:
 *  - folders: FileSystemDirectoryHandles remembered in IndexedDB (Chrome/Edge on PC and Android).
 *    Files stay where they are; we only read them.
 *  - imports: files copied into IndexedDB (works everywhere, and is the only option on iPad).
 *
 * Events: 'change' (entry list changed), 'entry' (detail: entry whose thumb/stats arrived),
 *         'progress' (detail: { done, total }).
 */
export class Library extends EventTarget {
  constructor() {
    super();
    this.folders = []; // { id, name, handle, status: 'ok' | 'needs-permission' | 'error', count }
    this.entries = []; // see _makeEntry
    this.meta = new Map(); // cacheKey -> { thumb, stats }
    this.thumbUrls = new Map(); // cacheKey -> object URL
    this._queue = [];
    this._working = false;
    this._done = 0;
    this._renderer = null;
  }

  async init() {
    // Ask the browser not to evict our storage (imports would vanish otherwise on iOS).
    navigator.storage?.persist?.().catch(() => {});

    for (const m of await db.getAll('meta')) this.meta.set(m.key, m);

    const folders = await db.getAll('folders');
    this.folders = folders.map((f) => ({ ...f, status: 'needs-permission', count: 0 }));
    await Promise.all(
      this.folders.map(async (f) => {
        try {
          const perm = await f.handle.queryPermission({ mode: 'read' });
          if (perm === 'granted') await this._scanFolder(f);
        } catch {
          f.status = 'error';
        }
      })
    );
    await this._rebuild();
  }

  // ---------- sources ----------

  async addFolder() {
    const handle = await window.showDirectoryPicker({ id: 'stl-library', mode: 'read' });
    for (const f of this.folders) {
      if (await f.handle.isSameEntry(handle)) {
        await this.reconnect(f.id);
        return f;
      }
    }
    const folder = { id: crypto.randomUUID(), name: handle.name, handle, status: 'ok', count: 0 };
    await db.put('folders', { id: folder.id, name: folder.name, handle });
    this.folders.push(folder);
    await this._scanFolder(folder);
    await this._rebuild();
    return folder;
  }

  /** Must be called from a user gesture (click). */
  async reconnect(folderId) {
    const f = this.folders.find((x) => x.id === folderId);
    if (!f) return;
    const perm = await f.handle.requestPermission({ mode: 'read' });
    if (perm === 'granted') {
      await this._scanFolder(f);
      await this._rebuild();
    }
  }

  async removeFolder(folderId) {
    this.folders = this.folders.filter((f) => f.id !== folderId);
    await db.del('folders', folderId);
    await this._rebuild();
  }

  async rescan() {
    for (const f of this.folders) if (f.status === 'ok') await this._scanFolder(f);
    await this._rebuild();
  }

  /** Copy files into app storage. Accepts a FileList / array of File. Returns number imported. */
  async importFiles(files) {
    let n = 0;
    for (const file of files) {
      if (!isStl(file.name)) continue;
      const rel = file.webkitRelativePath || '';
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      await db.put('imports', {
        id: crypto.randomUUID(),
        name: file.name,
        folder,
        size: file.size,
        lastModified: file.lastModified,
        added: Date.now(),
        blob: file,
      });
      n++;
    }
    if (n) await this._rebuild();
    return n;
  }

  async removeImport(entryId) {
    const id = entryId.replace(/^imp:/, '');
    await db.del('imports', id);
    await this._rebuild();
  }

  // ---------- scanning ----------

  async _scanFolder(folder) {
    const found = [];
    const walk = async (dir, path) => {
      for await (const handle of dir.values()) {
        if (handle.name.startsWith('.')) continue;
        if (handle.kind === 'directory') {
          await walk(handle, path ? `${path}/${handle.name}` : handle.name);
        } else if (isStl(handle.name)) {
          const file = await handle.getFile();
          found.push({ handle, path, file });
        }
      }
    };
    try {
      await walk(folder.handle, '');
      folder.status = 'ok';
    } catch (err) {
      console.warn('scan failed', folder.name, err);
      folder.status = 'error';
    }
    folder.files = found;
    folder.count = found.length;
  }

  _makeEntry({ id, sourceId, source, name, folder, size, lastModified, getFile }) {
    const cacheKey = `${id}|${size}|${lastModified}`;
    return { id, sourceId, source, name, folder, size, lastModified, getFile, cacheKey, stats: this.meta.get(cacheKey)?.stats };
  }

  async _rebuild() {
    const entries = [];
    for (const f of this.folders) {
      if (f.status !== 'ok' || !f.files) continue;
      for (const { handle, path, file } of f.files) {
        const rel = path ? `${path}/${file.name}` : file.name;
        entries.push(
          this._makeEntry({
            id: `dir:${f.id}/${rel}`,
            sourceId: f.id,
            source: 'folder',
            name: file.name,
            folder: path ? `${f.name}/${path}` : f.name,
            size: file.size,
            lastModified: file.lastModified,
            getFile: () => handle.getFile(),
          })
        );
      }
    }
    for (const imp of await db.getAll('imports')) {
      entries.push(
        this._makeEntry({
          id: `imp:${imp.id}`,
          sourceId: 'imports',
          source: 'import',
          name: imp.name,
          folder: imp.folder ? `Imported/${imp.folder}` : 'Imported',
          size: imp.size,
          lastModified: imp.lastModified,
          getFile: async () => new File([imp.blob], imp.name, { lastModified: imp.lastModified }),
        })
      );
    }
    this.importCount = entries.filter((e) => e.source === 'import').length;
    this.entries = entries;
    this.dispatchEvent(new Event('change'));
    this._enqueueMissing();
  }

  // ---------- thumbnails ----------

  thumbUrl(entry) {
    let url = this.thumbUrls.get(entry.cacheKey);
    if (!url) {
      const thumb = this.meta.get(entry.cacheKey)?.thumb;
      if (!thumb) return null;
      url = URL.createObjectURL(thumb);
      this.thumbUrls.set(entry.cacheKey, url);
    }
    return url;
  }

  _enqueueMissing() {
    const queued = new Set(this._queue.map((e) => e.cacheKey));
    const live = new Set(this.entries.map((e) => e.cacheKey));
    this._queue = this._queue.filter((e) => live.has(e.cacheKey));
    for (const e of this.entries) {
      if (!this.meta.has(e.cacheKey) && !queued.has(e.cacheKey)) this._queue.push(e);
    }
    if (!this._working) this._done = 0;
    this._emitProgress();
    this._pump();
  }

  _emitProgress() {
    this.dispatchEvent(new CustomEvent('progress', { detail: { done: this._done, total: this._done + this._queue.length } }));
  }

  async _pump() {
    if (this._working) return;
    this._working = true;
    try {
      while (this._queue.length) {
        const entry = this._queue.shift();
        let record = { key: entry.cacheKey, thumb: null, stats: null };
        try {
          if (entry.size <= MAX_THUMB_BYTES) {
            const file = await entry.getFile();
            this._renderer ??= new ThumbnailRenderer();
            const { blob, stats } = await this._renderer.render(await file.arrayBuffer());
            record = { key: entry.cacheKey, thumb: blob, stats };
          } else {
            record.tooBig = true;
          }
        } catch (err) {
          console.warn('thumbnail failed', entry.name, err);
          record.error = String(err?.message ?? err);
        }
        this.meta.set(entry.cacheKey, record);
        db.put('meta', record).catch(() => {});
        for (const e of this.entries) if (e.cacheKey === entry.cacheKey) e.stats = record.stats;
        this._done++;
        this.dispatchEvent(new CustomEvent('entry', { detail: entry }));
        this._emitProgress();
        // Yield so the UI can breathe between files.
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this._working = false;
      this._done = 0;
      this._emitProgress();
    }
  }
}
