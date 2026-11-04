import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeStats } from './stats.js';

const CREASE_ANGLE = THREE.MathUtils.degToRad(30);

export const RENDER_MODES = ['solid', 'wireframe', 'xray', 'normals'];
export const LIGHTING_PRESETS = ['studio', 'bright', 'dramatic'];

export class Viewer {
  constructor(container) {
    this.container = container;
    this.mode = 'solid';
    this.color = '#4f9dde';
    this.smooth = true;
    this.lighting = 'studio';

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b1d22);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    this.camera.position.set(150, 120, 150);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 1.5;

    this.lights = new THREE.Group();
    this.scene.add(this.lights);
    this.setLighting(this.lighting);

    // Build plate grid, rebuilt per model to fit its footprint.
    this.grid = null;
    this.showGrid = true;
    this.axes = new THREE.AxesHelper(20);
    this.axes.visible = false;
    this.scene.add(this.axes);
    this.boxHelper = null;
    this.showBox = false;

    this.mesh = null;
    this.edges = null;
    this.baseGeometry = null; // flat-shaded, as parsed
    this.smoothGeometry = null; // lazily built creased normals
    this.stats = null;
    this.radius = 100;

    this._buildGrid(200);

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(container);
    this._resize();

    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Parse an STL ArrayBuffer and show it. Returns geometry stats. */
  load(arrayBuffer) {
    const geometry = new STLLoader().parse(arrayBuffer);
    // STL files are Z-up; three.js is Y-up.
    geometry.rotateX(-Math.PI / 2);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    // Center on X/Z and sit the part on the build plate.
    geometry.translate(-center.x, -bb.min.y, -center.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();

    this._clearModel();
    this.baseGeometry = geometry;
    this.smoothGeometry = null;
    this.stats = computeStats(geometry);
    // Report dimensions in the file's own axes (Z-up), not three.js's Y-up.
    const s = this.stats.size;
    this.stats.size = { x: s.x, y: s.z, z: s.y };

    this.mesh = new THREE.Mesh(this._currentGeometry(), this._makeMaterial());
    this.scene.add(this.mesh);
    this._applyMode();

    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    this.radius = Math.max(geometry.boundingSphere.radius, 1);
    this._buildGrid(Math.max(size.x, size.z) * 1.6);
    this.axes.scale.setScalar(Math.max(size.x, size.y, size.z) / 20 * 0.6);
    this._updateBox();

    this.camera.near = this.radius / 100;
    this.camera.far = this.radius * 100;
    this.camera.updateProjectionMatrix();
    this.setView('iso');
    return this.stats;
  }

  _clearModel() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this.edges) {
      this.scene.remove(this.edges);
      this.edges.geometry.dispose();
      this.edges.material.dispose();
      this.edges = null;
    }
    this.baseGeometry?.dispose();
    this.smoothGeometry?.dispose();
    this.baseGeometry = this.smoothGeometry = null;
  }

  _currentGeometry() {
    if (!this.smooth) return this.baseGeometry;
    if (!this.smoothGeometry) {
      this.smoothGeometry = toCreasedNormals(this.baseGeometry, CREASE_ANGLE);
      this.smoothGeometry.computeBoundingBox();
      this.smoothGeometry.computeBoundingSphere();
    }
    return this.smoothGeometry;
  }

  _makeMaterial() {
    const color = new THREE.Color(this.color);
    switch (this.mode) {
      case 'normals':
        return new THREE.MeshNormalMaterial();
      case 'xray':
        return new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
      case 'wireframe':
      case 'solid':
      default:
        return new THREE.MeshStandardMaterial({
          color,
          metalness: 0.1,
          roughness: 0.55,
          side: THREE.DoubleSide, // broken meshes still look sane
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
    }
  }

  _applyMode() {
    if (!this.mesh) return;
    this.mesh.material.dispose();
    this.mesh.material = this._makeMaterial();
    if (this.edges) {
      this.scene.remove(this.edges);
      this.edges.geometry.dispose();
      this.edges.material.dispose();
      this.edges = null;
    }
    if (this.mode === 'wireframe') {
      const wire = new THREE.WireframeGeometry(this.baseGeometry);
      this.edges = new THREE.LineSegments(
        wire,
        new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55 })
      );
      this.scene.add(this.edges);
    }
  }

  setMode(mode) {
    this.mode = mode;
    this._applyMode();
  }

  setColor(hex) {
    this.color = hex;
    if (this.mesh && this.mesh.material.color) this.mesh.material.color.set(hex);
  }

  setSmooth(on) {
    this.smooth = on;
    if (this.mesh) this.mesh.geometry = this._currentGeometry();
  }

  setLighting(preset) {
    this.lighting = preset;
    this.lights.clear();
    const add = (light, x, y, z) => {
      light.position.set(x, y, z);
      this.lights.add(light);
    };
    if (preset === 'bright') {
      this.scene.environmentIntensity = 1.0;
      this.renderer.toneMappingExposure = 1.15;
      this.lights.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.2));
      add(new THREE.DirectionalLight(0xffffff, 1.5), 1, 2, 1.5);
    } else if (preset === 'dramatic') {
      this.scene.environmentIntensity = 0.15;
      this.renderer.toneMappingExposure = 1.0;
      add(new THREE.DirectionalLight(0xffe2c0, 3.2), -2, 1.2, 0.6);
      add(new THREE.DirectionalLight(0x6fa8ff, 1.2), 1.5, 0.4, -2);
    } else {
      // studio
      this.scene.environmentIntensity = 0.6;
      this.renderer.toneMappingExposure = 1.0;
      this.lights.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.6));
      add(new THREE.DirectionalLight(0xffffff, 1.6), 1, 1.6, 1.2);
      add(new THREE.DirectionalLight(0xffffff, 0.5), -1.2, 0.6, -1);
    }
  }

  _buildGrid(size) {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    // Pick a "nice" cell size (1, 2, 5, 10 ... mm) giving ~10-20 cells.
    const target = size / 15;
    const pow = 10 ** Math.floor(Math.log10(target));
    const cell = [1, 2, 5, 10].map((m) => m * pow).find((c) => c >= target) ?? 10 * pow;
    const divisions = Math.max(2, Math.ceil(size / cell));
    this.grid = new THREE.GridHelper(divisions * cell, divisions, 0x5a6070, 0x33363e);
    this.grid.visible = this.showGrid;
    this.scene.add(this.grid);
    this.gridCell = cell;
  }

  setGridVisible(on) {
    this.showGrid = on;
    if (this.grid) this.grid.visible = on;
  }

  setAxesVisible(on) {
    this.axes.visible = on;
  }

  setBoxVisible(on) {
    this.showBox = on;
    this._updateBox();
  }

  _updateBox() {
    if (this.boxHelper) {
      this.scene.remove(this.boxHelper);
      this.boxHelper.geometry.dispose();
      this.boxHelper.material.dispose();
      this.boxHelper = null;
    }
    if (this.showBox && this.baseGeometry) {
      this.boxHelper = new THREE.Box3Helper(this.baseGeometry.boundingBox, 0xffc94d);
      this.scene.add(this.boxHelper);
    }
  }

  setAutoRotate(on) {
    this.controls.autoRotate = on;
  }

  setBackground(hex) {
    this.scene.background.set(hex);
  }

  /** Move the camera to a standard view: iso, top, front, right. */
  setView(name) {
    const target = new THREE.Vector3(0, 0, 0);
    if (this.baseGeometry) this.baseGeometry.boundingBox.getCenter(target);
    const dist = (this.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.05;
    const dirs = {
      iso: new THREE.Vector3(1, 0.8, 1),
      top: new THREE.Vector3(0, 1, 0.0001),
      front: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0),
    };
    const dir = (dirs[name] ?? dirs.iso).clone().normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.update();
  }

  /** PNG data URL of the current view. */
  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
