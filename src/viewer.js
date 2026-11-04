import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { computeStats, formatNumber } from './stats.js';

const CREASE_ANGLE = THREE.MathUtils.degToRad(30);
const CAP_COLOR = 0xff7a45;
export const COMPARE_COLORS = ['#4f9dde', '#f2b134', '#4caf6e', '#e05a47', '#9b6bd6', '#d98f5c'];

export const RENDER_MODES = ['solid', 'wireframe', 'xray', 'normals'];
export const LIGHTING_PRESETS = ['studio', 'bright', 'dramatic'];

// World is three.js Y-up; STL files are Z-up. File (x, y, z) == world (x, -z, y) after rotateX(-90°).
const worldToFile = (v) => ({ x: v.x, y: -v.z, z: v.y });

/**
 * 3D viewer. Holds one or more models (several = compare mode, laid out side by side
 * on one build plate at true relative scale). Also does point-to-point measuring and
 * axis-aligned section cuts.
 *
 * Events: 'measure' (detail: list of measurements) whenever measurements change.
 */
export class Viewer extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.mode = 'solid';
    this.color = '#4f9dde';
    this.smooth = true;
    this.lighting = 'studio';
    this.models = [];

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b1d22);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    this.camera.position.set(150, 120, 150);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 1.5;

    this.lights = new THREE.Group();
    this.scene.add(this.lights);
    this.setLighting(this.lighting);

    this.grid = null;
    this.showGrid = true;
    this.axes = new THREE.AxesHelper(20);
    this.axes.visible = false;
    this.scene.add(this.axes);
    this.boxHelpers = [];
    this.showBox = false;

    this.bounds = new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 50, 50));
    this.radius = 100;

    // Section cut
    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.section = null; // { axis: 'x'|'y'|'z', t: 0..1, flip: bool }

    // Measuring
    this.measuring = false;
    this.measurements = []; // { a, b, distance, delta, objects[] }
    this._pending = null; // { point, marker }
    this.measureGroup = new THREE.Group();
    this.scene.add(this.measureGroup);
    this._raycaster = new THREE.Raycaster();
    this._down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this._down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => this._onPointerUp(e));

    this._buildGrid(200);

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(container);
    this._resize();

    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    });
  }

  get mesh() {
    return this.models[0]?.mesh ?? null;
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // =================================================================
  // Loading
  // =================================================================

  /** Parse one STL ArrayBuffer and show it. Returns its stats. */
  load(arrayBuffer, name = '') {
    return this.loadMany([{ buffer: arrayBuffer, name }])[0].stats;
  }

  /**
   * Show several STL files side by side. items: [{ buffer, name }].
   * Returns the models ({ name, stats, color }).
   */
  loadMany(items) {
    const parsed = items.map(({ buffer, name }) => {
      const geometry = new STLLoader().parse(buffer);
      const stats = computeStats(geometry); // file axes
      geometry.rotateX(-Math.PI / 2);
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      const c = new THREE.Vector3();
      bb.getCenter(c);
      geometry.translate(-c.x, -bb.min.y, -c.z); // center on X/Z, sit on the plate
      geometry.computeBoundingBox();
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      return { name, geometry, stats };
    });

    this._clearModels();
    this.clearMeasurements();

    // Lay out along X with a gap, then center the whole row.
    const sizes = parsed.map((p) => p.geometry.boundingBox.getSize(new THREE.Vector3()));
    const gap = parsed.length > 1 ? Math.max(...sizes.map((s) => Math.max(s.x, s.z))) * 0.15 : 0;
    const totalW = sizes.reduce((sum, s) => sum + s.x, 0) + gap * (parsed.length - 1);
    let x = -totalW / 2;
    parsed.forEach((p, i) => {
      p.geometry.translate(x + sizes[i].x / 2, 0, 0);
      x += sizes[i].x + gap;
      p.geometry.computeBoundingBox();
      p.geometry.computeBoundingSphere();
    });

    const multi = parsed.length > 1;
    this.models = parsed.map((p, i) => {
      const model = {
        name: p.name,
        stats: p.stats,
        baseGeometry: p.geometry,
        smoothGeometry: null,
        color: multi ? COMPARE_COLORS[i % COMPARE_COLORS.length] : this.color,
        mesh: null,
        cap: null,
        edges: null,
        label: null,
      };
      model.mesh = new THREE.Mesh(this._geometryFor(model), this._makeMaterial(model.color));
      this.scene.add(model.mesh);
      if (multi) {
        const div = document.createElement('div');
        div.className = 'model-label';
        div.textContent = p.name.replace(/\.stl$/i, '');
        div.style.borderColor = model.color;
        model.label = new CSS2DObject(div);
        const bb = p.geometry.boundingBox;
        model.label.position.set((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2);
        model.label.center.set(0.5, 1.4);
        this.scene.add(model.label);
      }
      return model;
    });
    this._applyMode();

    this.bounds = new THREE.Box3();
    for (const m of this.models) this.bounds.union(m.baseGeometry.boundingBox);
    const size = this.bounds.getSize(new THREE.Vector3());
    const sphere = this.bounds.getBoundingSphere(new THREE.Sphere());
    this.radius = Math.max(sphere.radius, 1);
    this._buildGrid(Math.max(size.x, size.z) * 1.6);
    this.axes.scale.setScalar((Math.max(size.x, size.y, size.z) / 20) * 0.6);
    this._updateBoxes();
    this._updateClipPlane();

    this.camera.near = this.radius / 100;
    this.camera.far = this.radius * 100;
    this.camera.updateProjectionMatrix();
    this.setView('iso');
    return this.models.map(({ name, stats, color }) => ({ name, stats, color }));
  }

  _clearModels() {
    for (const m of this.models) {
      this._disposeObject(m.mesh, false);
      this._disposeObject(m.cap, false);
      this._disposeObject(m.edges, true);
      if (m.label) {
        this.scene.remove(m.label);
        m.label.element.remove();
      }
      m.baseGeometry.dispose();
      m.smoothGeometry?.dispose();
    }
    this.models = [];
  }

  _disposeObject(obj, disposeGeometry) {
    if (!obj) return;
    this.scene.remove(obj);
    obj.material.dispose();
    if (disposeGeometry) obj.geometry.dispose();
  }

  _geometryFor(model) {
    if (!this.smooth) return model.baseGeometry;
    if (!model.smoothGeometry) {
      model.smoothGeometry = toCreasedNormals(model.baseGeometry, CREASE_ANGLE);
      model.smoothGeometry.computeBoundingBox();
      model.smoothGeometry.computeBoundingSphere();
    }
    return model.smoothGeometry;
  }

  // =================================================================
  // Appearance
  // =================================================================

  _clipping() {
    return this.section ? [this.clipPlane] : [];
  }

  _makeMaterial(color) {
    const clippingPlanes = this._clipping();
    switch (this.mode) {
      case 'normals':
        return new THREE.MeshNormalMaterial({ clippingPlanes, side: THREE.DoubleSide });
      case 'xray':
        return new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          clippingPlanes,
        });
      default:
        return new THREE.MeshStandardMaterial({
          color: new THREE.Color(color),
          metalness: 0.1,
          roughness: 0.55,
          // With a section cut, back faces are drawn by the orange "cap" mesh instead.
          side: this.section ? THREE.FrontSide : THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
          clippingPlanes,
        });
    }
  }

  _applyMode() {
    for (const m of this.models) {
      m.mesh.material.dispose();
      m.mesh.material = this._makeMaterial(m.color);

      this._disposeObject(m.edges, true);
      m.edges = null;
      if (this.mode === 'wireframe') {
        m.edges = new THREE.LineSegments(
          new THREE.WireframeGeometry(m.baseGeometry),
          new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, clippingPlanes: this._clipping() })
        );
        this.scene.add(m.edges);
      }

      // Interior faces seen through the cut get a flat cap color, so the cut reads as solid.
      this._disposeObject(m.cap, false);
      m.cap = null;
      if (this.section && (this.mode === 'solid' || this.mode === 'wireframe')) {
        m.cap = new THREE.Mesh(
          m.mesh.geometry,
          new THREE.MeshBasicMaterial({ color: CAP_COLOR, side: THREE.BackSide, clippingPlanes: this._clipping() })
        );
        this.scene.add(m.cap);
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
    this._applyMode();
  }

  /** Sets every model's color (in compare mode this overrides the per-model colors). */
  setColor(hex) {
    this.color = hex;
    for (const m of this.models) {
      m.color = hex;
      if (m.mesh.material.color) m.mesh.material.color.set(hex);
    }
  }

  setSmooth(on) {
    this.smooth = on;
    for (const m of this.models) {
      m.mesh.geometry = this._geometryFor(m);
      if (m.cap) m.cap.geometry = m.mesh.geometry;
    }
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
    this._updateBoxes();
  }

  _updateBoxes() {
    for (const b of this.boxHelpers) {
      this.scene.remove(b);
      b.geometry.dispose();
      b.material.dispose();
    }
    this.boxHelpers = [];
    if (!this.showBox) return;
    for (const m of this.models) {
      const b = new THREE.Box3Helper(m.baseGeometry.boundingBox, 0xffc94d);
      this.scene.add(b);
      this.boxHelpers.push(b);
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
    const target = this.bounds.getCenter(new THREE.Vector3());
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

  // =================================================================
  // Section cut
  // =================================================================

  /** section: null to turn off, or { axis: 'x'|'y'|'z' (file axes), t: 0..1, flip: bool } */
  setSection(section) {
    const wasOn = !!this.section;
    this.section = section ? { ...section } : null;
    this._updateClipPlane();
    if (wasOn !== !!this.section) this._applyMode(); // materials need (de)compiling with clipping
  }

  _updateClipPlane() {
    if (!this.section) return;
    const { axis, t, flip } = this.section;
    const { min, max } = this.bounds;
    // w = world direction of the file axis; s = cut position measured along w (== file coordinate).
    let w, s;
    if (axis === 'x') {
      w = new THREE.Vector3(1, 0, 0);
      s = THREE.MathUtils.lerp(min.x, max.x, t);
    } else if (axis === 'z') {
      w = new THREE.Vector3(0, 1, 0);
      s = THREE.MathUtils.lerp(min.y, max.y, t);
    } else {
      w = new THREE.Vector3(0, 0, -1); // file +Y is world -Z
      s = THREE.MathUtils.lerp(-max.z, -min.z, t);
    }
    this._sectionValue = s;
    // three.js discards the side where n·p + c < 0. Default keeps w·p <= s; flip keeps the other half.
    // The default camera looks from file -Y, so for Y keep the far half so the cut faces you.
    const keepHigh = axis === 'y' ? !flip : flip;
    if (keepHigh) this.clipPlane.set(w, -s);
    else this.clipPlane.set(w.negate(), s);
  }

  /** Where the cut sits, in mm along the file axis (for the UI readout). */
  sectionPosition() {
    return this.section ? this._sectionValue : null;
  }

  // =================================================================
  // Measuring
  // =================================================================

  setMeasuring(on) {
    this.measuring = on;
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
    if (!on) this._clearPending();
  }

  _onPointerUp(e) {
    if (!this.measuring || !this._down || !this.models.length) return;
    // Ignore drags (orbiting); only count taps.
    if (Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > 6) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pickAt(ndc);
  }

  /** Raycast at normalized device coords and add a measure point. Returns the hit point or null. */
  pickAt(ndc) {
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(
      this.models.map((m) => m.mesh),
      false
    );
    // Respect the section cut: skip hits on the clipped-away side.
    const hit = hits.find((h) => !this.section || this.clipPlane.distanceToPoint(h.point) >= -1e-6);
    if (!hit) return null;
    this.addMeasurePoint(hit.point.clone());
    return hit.point;
  }

  _marker(point, color) {
    const r = this.radius * 0.012;
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true })
    );
    m.renderOrder = 10;
    m.position.copy(point);
    return m;
  }

  addMeasurePoint(point) {
    if (!this._pending) {
      const marker = this._marker(point, 0xffd23f);
      this.measureGroup.add(marker);
      this._pending = { point, marker };
      return;
    }
    const a = this._pending.point;
    const b = point;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true })
    );
    line.renderOrder = 10;
    const endMarker = this._marker(b, 0xffd23f);
    const distance = a.distanceTo(b);
    const dw = new THREE.Vector3().subVectors(b, a);
    const delta = worldToFile(dw);
    delta.x = Math.abs(delta.x);
    delta.y = Math.abs(delta.y);
    delta.z = Math.abs(delta.z);

    const div = document.createElement('div');
    div.className = 'measure-label';
    div.textContent = `${formatNumber(distance)} mm`;
    const label = new CSS2DObject(div);
    label.position.copy(a).lerp(b, 0.5);

    this.measureGroup.add(line, endMarker, label);
    this.measurements.push({ distance, delta, objects: [this._pending.marker, line, endMarker, label] });
    this._pending = null;
    this.dispatchEvent(new CustomEvent('measure', { detail: this.measurements }));
  }

  _clearPending() {
    if (!this._pending) return;
    this._removeMeasureObject(this._pending.marker);
    this._pending = null;
  }

  _removeMeasureObject(o) {
    this.measureGroup.remove(o);
    if (o.isCSS2DObject) o.element.remove();
    else {
      o.geometry.dispose();
      o.material.dispose();
    }
  }

  clearMeasurements() {
    this._clearPending();
    for (const m of this.measurements) for (const o of m.objects) this._removeMeasureObject(o);
    this.measurements = [];
    this.dispatchEvent(new CustomEvent('measure', { detail: this.measurements }));
  }

  // =================================================================
  // Screenshot
  // =================================================================

  /** PNG blob of the current view (3D only; HTML labels aren't included). */
  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return new Promise((res) => this.renderer.domElement.toBlob(res, 'image/png'));
  }
}
