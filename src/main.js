import './style.css';
import { Viewer } from './viewer.js';
import { formatNumber, formatBytes } from './stats.js';

const PLA_DENSITY = 1.24; // g/cm³
const SWATCHES = ['#4f9dde', '#e8e8e8', '#2b2b2b', '#e05a47', '#f2b134', '#4caf6e', '#9b6bd6', '#d98f5c'];

const $ = (id) => document.getElementById(id);
const viewer = new Viewer($('viewport'));

// ---------- loading ----------

async function openFile(file) {
  if (!file) return;
  if (!/\.stl$/i.test(file.name)) {
    toast(`"${file.name}" isn't an STL file.`);
    return;
  }
  $('loading').hidden = false;
  try {
    const buf = await file.arrayBuffer();
    // Let the "Loading…" paint before the parse blocks the thread.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const stats = viewer.load(buf);
    $('empty').hidden = true;
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
  const dl = $('info');
  dl.replaceChildren(
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

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

$('file-input').addEventListener('change', (e) => {
  openFile(e.target.files[0]);
  e.target.value = '';
});

// Drag and drop anywhere on the page.
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
  openFile(e.dataTransfer.files[0]);
});

// ---------- controls ----------

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

// Exposed for automated tests and console poking.
window.stlViewer = viewer;
