import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeStats, formatBytes } from './stats.js';

// Axis-aligned box, non-indexed, outward-facing triangles.
function boxGeometry(w, h, d) {
  return new THREE.BoxGeometry(w, h, d).toNonIndexed();
}

describe('computeStats', () => {
  it('measures a box correctly', () => {
    const s = computeStats(boxGeometry(10, 20, 30));
    expect(s.triangles).toBe(12);
    expect(s.size.x).toBeCloseTo(10);
    expect(s.size.y).toBeCloseTo(20);
    expect(s.size.z).toBeCloseTo(30);
    expect(s.volume).toBeCloseTo(6000);
    expect(s.area).toBeCloseTo(2 * (10 * 20 + 20 * 30 + 10 * 30));
  });

  it('volume does not depend on position', () => {
    const g = boxGeometry(2, 2, 2);
    g.translate(100, -50, 7);
    expect(computeStats(g).volume).toBeCloseTo(8);
  });

  it('handles empty geometry', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    const s = computeStats(g);
    expect(s.triangles).toBe(0);
    expect(s.size.x).toBe(0);
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});
