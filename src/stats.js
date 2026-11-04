// Geometry statistics for a non-indexed triangle soup (what STLLoader returns).
// Units are whatever the STL uses; for 3D printing that's almost always millimetres.

export function computeStats(geometry) {
  const pos = geometry.getAttribute('position');
  const a = pos.array;
  const triangles = pos.count / 3;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let volume = 0;
  let area = 0;

  for (let i = 0; i < a.length; i += 9) {
    const ax = a[i], ay = a[i + 1], az = a[i + 2];
    const bx = a[i + 3], by = a[i + 4], bz = a[i + 5];
    const cx = a[i + 6], cy = a[i + 7], cz = a[i + 8];

    if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
    if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
    if (by < minY) minY = by; if (by > maxY) maxY = by;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
    if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
    if (bz < minZ) minZ = bz; if (bz > maxZ) maxZ = bz;
    if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;

    // Signed volume of the tetrahedron (origin, a, b, c) = a · (b × c) / 6
    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;
    volume += (ax * crossX + ay * crossY + az * crossZ) / 6;

    // Triangle area = |(b - a) × (c - a)| / 2
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
  }

  if (triangles === 0) {
    minX = minY = minZ = maxX = maxY = maxZ = 0;
  }

  return {
    triangles,
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    // Inside-out or non-watertight meshes can produce a negative sum; report magnitude.
    volume: Math.abs(volume),
    area,
  };
}

export function formatNumber(n, digits = 2) {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}
