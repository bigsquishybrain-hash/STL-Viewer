// Parses STL files off the main thread so the UI stays responsive while
// thumbnailing a big library. Returns raw positions plus stats.
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { computeStats } from './stats.js';

const loader = new STLLoader();

self.onmessage = (e) => {
  const { id, buffer } = e.data;
  try {
    const geometry = loader.parse(buffer);
    const stats = computeStats(geometry); // file's own axes (Z-up)
    const positions = geometry.getAttribute('position').array;
    self.postMessage({ id, positions, stats }, [positions.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
