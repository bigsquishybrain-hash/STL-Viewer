// Tiny promise wrapper around IndexedDB. No dependencies.
//
// Stores:
//   folders  { id, name, handle }            remembered FileSystemDirectoryHandles
//   imports  { id, name, size, lastModified, added, blob }   files copied into the app
//   meta     { key, thumb (Blob), stats }    thumbnail + stats cache, keyed by file identity
//   tags     { id, favorite, tags[] }        user labels, keyed by library entry id

const DB_NAME = 'stl-viewer';
const DB_VERSION = 2;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('imports')) db.createObjectStore('imports', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function get(name, key) {
  return wrap((await store(name)).get(key));
}

export async function getAll(name) {
  return wrap((await store(name)).getAll());
}

export async function put(name, value) {
  return wrap((await store(name, 'readwrite')).put(value));
}

export async function del(name, key) {
  return wrap((await store(name, 'readwrite')).delete(key));
}
