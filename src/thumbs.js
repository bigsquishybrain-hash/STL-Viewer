import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SIZE = 320;

let worker;
let nextId = 1;
const pending = new Map();

function parseInWorker(buffer) {
  if (!worker) {
    worker = new Worker(new URL('./parse.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'worker failed'));
      pending.clear();
      worker = null;
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, buffer }, [buffer]);
  });
}

/** Renders small preview images of STL files with a single shared WebGL context. */
export class ThumbnailRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(SIZE, SIZE, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x24272e);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.6, 1.2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1.2, 0.6, -1);
    this.scene.add(fill);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x4f9dde,
      metalness: 0.1,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
  }

  /**
   * @param {ArrayBuffer} buffer STL file contents (transferred, unusable afterwards)
   * @returns {Promise<{ blob: Blob, stats: object }>}
   */
  async render(buffer) {
    const { positions, stats } = await parseInWorker(buffer);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2); // Z-up → Y-up
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;

    const mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(mesh);

    const r = Math.max(sphere.radius, 0.001);
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.3;
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 10;
    this.camera.lookAt(sphere.center);
    this.camera.updateProjectionMatrix();

    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise((res) => this.canvas.toBlob(res, 'image/jpeg', 0.85));

    this.scene.remove(mesh);
    geometry.dispose();
    return { blob, stats };
  }
}
