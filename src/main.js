import './style.css';
import { Viewer } from './viewer.js';
import { formatNumber, formatBytes } from './stats.js';
import { Library, canPickFolders } from './library.js';
import { LibraryView } from './libraryView.js';

const PLA_DENSITY = 1.24; // g/cm³
const SWATCHES = ['#4f9dde', '#e8e8e8', '#2b2b2b', '#e05a47', '#f2b134', '#4caf6e', '#9b6bd6', '#d98f5c'];
const PREFS_KEY = 'stl-viewer:prefs';

const $ = (id) => document.getElementById(id);

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
  } catch {
    return {};
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode etc. */
  }
}

let toastTimer;
function toast(msg, kind = 'error') {
  const t = $('toast');
  t.textContent = msg;
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

// =====================================================================
// Viewer screen
// =====================================================================

const viewer = new Viewer($('viewport'));

async function openFile(file) {
  if (!file) return;
  if (!/\.stl$/i.test(file.name)) {
    toast(`"${file.name}" isn't an STL file.`);
    return;
  }
  showScreen('viewer');
  $('loading').hidden = false;
  try {
    const buf = await file.arrayBuffer();
    // Let the "Loading…" paint before the parse blocks the thread.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const stats = viewer.load(buf);
    $('file-name').textContent = file.name;
    document.title = `${file.name} · STL Viewer`;
    showInfo(file, stats);
  } catch (err) {
    console.error(err);
    toast(`Couldn't read "${file.name}". It may be corrupt.`);
  } finally {
    $('loading').hidden = true;
  }
}

function showInfo(file, s) {
  const mm = (v) => `${formatNumber(v)} mm`;
  const volCm3 = s.volume / 1000;
  const rows = [
    ['File', file.name],
    ['File size', formatBytes(file.size)],
    ['Triangles', formatNumber(s.triangles, 0)],
    ['Width (X)', mm(s.size.x)],
    ['Depth (Y)', mm(s.size.y)],
    ['Height (Z)', mm(s.size.z)],
    ['Volume', `${formatNumber(volCm3)} cm³`],
    ['Surface area', `${formatNumber(s.area / 100)} cm²`],
    ['Weight if solid PLA', `${formatNumber(volCm3 * PLA_DENSITY, 1)} g`],
  ];
  $('info').replaceChildren(
    ...rows.map(([k, v]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      div.append(dt, dd);
      return div;
    })
  );
}

$('file-input').addEventListener('change', (e) => {
  openFile(e.target.files[0]);
  e.target.value = '';
});

$('mode').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  for (const b of $('mode').children) b.classList.toggle('active', b === btn);
  viewer.setMode(btn.dataset.mode);
});

$('color').addEventListener('input', (e) => viewer.setColor(e.target.value));
for (const c of SWATCHES) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = c;
  b.title = c;
  b.addEventListener('click', () => {
    $('color').value = c;
    viewer.setColor(c);
  });
  $('swatches').append(b);
}

$('lighting').addEventListener('change', (e) => viewer.setLighting(e.target.value));
$('background').addEventListener('input', (e) => viewer.setBackground(e.target.value));
$('smooth').addEventListener('change', (e) => viewer.setSmooth(e.target.checked));
$('grid').addEventListener('change', (e) => viewer.setGridVisible(e.target.checked));
$('box').addEventListener('change', (e) => viewer.setBoxVisible(e.target.checked));
$('axes').addEventListener('change', (e) => viewer.setAxesVisible(e.target.checked));
$('autorotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));

$('view-buttons').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (btn) viewer.setView(btn.dataset.view);
});

$('panel-toggle').addEventListener('click', () => document.body.classList.toggle('panel-hidden'));

// =====================================================================
// Screens + history (so Android's back button returns to the library)
// =====================================================================

function showScreen(name) {
  if (document.body.dataset.screen === name) return;
  document.body.dataset.screen = name;
  if (name === 'viewer') {
    if (location.hash !== '#view') history.pushState({ viewer: true }, '', '#view');
  } else {
    document.title = 'STL Library';
    if (location.hash === '#view') history.replaceState(null, '', location.pathname + location.search);
  }
}

$('back-btn').addEventListener('click', () => {
  if (history.state?.viewer) history.back();
  else showScreen('library');
});
window.addEventListener('popstate', () => {
  document.body.dataset.screen = location.hash === '#view' && viewer.mesh ? 'viewer' : 'library';
  if (document.body.dataset.screen === 'library') document.title = 'STL Library';
});
// A reload on #view has no model loaded, so start at the library.
if (location.hash === '#view') history.replaceState(null, '', location.pathname + location.search);
document.title = 'STL Library';

// =====================================================================
// Library screen
// =====================================================================

const prefs = loadPrefs();
const library = new Library();
const view = new LibraryView($('lib-content'), library, {
  onOpen: async (entry) => {
    if (!entry) return;
    try {
      await openFile(await entry.getFile());
    } catch (err) {
      console.error(err);
      toast(`Couldn't open "${entry.name}". Was it moved or deleted?`);
    }
  },
  onRemove: async (entry) => {
    if (!entry) return;
    if (!confirm(`Remove "${entry.name}" from the library? This deletes the app's copy.`)) return;
    await library.removeImport(entry.id);
  },
});
view.state = { ...view.state, ...pick(prefs, ['view', 'key', 'dir']) };

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function persistViewPrefs() {
  savePrefs({ ...loadPrefs(), view: view.state.view, key: view.state.key, dir: view.state.dir });
}

function syncToolbar() {
  for (const b of $('view-mode').children) b.classList.toggle('active', b.dataset.view === view.state.view);
  $('sort-key').value = view.state.key;
  // The details table can sort by "width"; the dropdown has no such option, so leave it be.
  if ($('sort-key').value !== view.state.key) $('sort-key').selectedIndex = -1;
  $('sort-dir').textContent = view.state.dir === 'asc' ? '↑' : '↓';
}
view.dispatchSortChange = () => {
  syncToolbar();
  persistViewPrefs();
};

function renderLibrary() {
  view.render();
  const total = library.entries.length;
  $('lib-empty').hidden = total > 0;
  $('lib-nomatch').hidden = total === 0 || view.visible.length > 0;
  renderSources();
}

function renderSources() {
  const box = $('sources');
  const chips = [];
  for (const f of library.folders) {
    const chip = document.createElement('div');
    chip.className = `chip ${f.status}`;
    const label = document.createElement('span');
    label.textContent = f.status === 'ok' ? `📁 ${f.name} · ${f.count}` : `📁 ${f.name}`;
    chip.append(label);
    if (f.status !== 'ok') {
      const b = document.createElement('button');
      b.className = 'chip-action';
      b.textContent = f.status === 'error' ? 'Retry' : 'Reconnect';
      b.title = 'The browser needs your OK again to read this folder';
      b.addEventListener('click', () => library.reconnect(f.id).catch((err) => toast(err.message)));
      chip.append(b);
    }
    const x = document.createElement('button');
    x.className = 'chip-x';
    x.textContent = '✕';
    x.title = 'Forget this folder (files are not touched)';
    x.setAttribute('aria-label', `Forget ${f.name}`);
    x.addEventListener('click', () => {
      if (confirm(`Forget the folder "${f.name}"? Your files stay where they are.`)) library.removeFolder(f.id);
    });
    chip.append(x);
    chips.push(chip);
  }
  if (library.importCount) {
    const chip = document.createElement('div');
    chip.className = 'chip ok';
    chip.textContent = `📥 Imported · ${library.importCount}`;
    chips.push(chip);
  }
  if (library.folders.some((f) => f.status === 'ok')) {
    const b = document.createElement('button');
    b.className = 'chip chip-btn';
    b.textContent = '↻ Rescan';
    b.addEventListener('click', () => library.rescan());
    chips.push(b);
  }
  box.replaceChildren(...chips);
  box.hidden = chips.length === 0;
}

library.addEventListener('change', renderLibrary);
library.addEventListener('entry', (e) => view.update(e.detail));
library.addEventListener('progress', (e) => {
  const { done, total } = e.detail;
  $('progress').hidden = total === 0;
  $('progress-text').textContent = `Making thumbnails ${done} / ${total}`;
  $('progress-fill').style.width = total ? `${(done / total) * 100}%` : '0';
});

// Toolbar
let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    view.setState({ query: e.target.value });
    $('lib-nomatch').hidden = library.entries.length === 0 || view.visible.length > 0;
  }, 120);
});
$('sort-key').addEventListener('change', (e) => {
  view.setState({ key: e.target.value });
  persistViewPrefs();
});
$('sort-dir').addEventListener('click', () => {
  view.setState({ dir: view.state.dir === 'asc' ? 'desc' : 'asc' });
  syncToolbar();
  persistViewPrefs();
});
$('view-mode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  view.setState({ view: b.dataset.view });
  syncToolbar();
  persistViewPrefs();
});

// Add menu
const addPopup = $('add-popup');
function setMenu(open) {
  addPopup.hidden = !open;
  $('add-btn').setAttribute('aria-expanded', String(open));
}
$('add-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu(addPopup.hidden);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.add-menu')) setMenu(false);
});
if (!canPickFolders) {
  // iPad / Safari / Firefox: no persistent folder access, so only imports are offered.
  $('add-folder').hidden = true;
}
if (!('webkitdirectory' in document.createElement('input'))) $('import-folder-label').hidden = true;

$('add-folder').addEventListener('click', async () => {
  setMenu(false);
  try {
    await library.addFolder();
  } catch (err) {
    if (err?.name !== 'AbortError') toast(`Couldn't add that folder: ${err.message}`);
  }
});

async function importList(files) {
  const n = await library.importFiles(files);
  toast(n ? `Imported ${n} file${n === 1 ? '' : 's'}.` : 'No STL files in there.', n ? 'info' : 'error');
}
for (const id of ['import-files', 'import-folder']) {
  $(id).addEventListener('change', async (e) => {
    setMenu(false);
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await importList(files);
  });
}

// =====================================================================
// Drag and drop: imports on the library screen, one-off open in the viewer
// =====================================================================

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  $('drop-overlay').hidden = false;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('drop-overlay').hidden = true;
  }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop-overlay').hidden = true;
  const files = [...e.dataTransfer.files];
  if (!files.length) return;
  if (document.body.dataset.screen === 'viewer') openFile(files[0]);
  else importList(files);
});

// =====================================================================

syncToolbar();
library.init().catch((err) => {
  console.error(err);
  toast("Couldn't open the library storage. Is this a private window?");
  renderLibrary();
});

// Exposed for automated tests and console poking.
window.stlViewer = viewer;
window.stlLibrary = library;
