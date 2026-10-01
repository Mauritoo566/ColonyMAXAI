import * as THREE from 'three';
import { pickSurface } from './camp.js';
import { ROAD_CELL, ROAD_LEVELS, roadCellOf, roadCellProblem } from './sim/economy.js';

// Caminos: casillas de 4 m sobre el terreno del campamento (sim/economy.js). Aquí se dibujan
// (una malla por nivel) y está la herramienta para pintarlos arrastrando el puntero.

const MAX_CELLS = 600;

export class RoadSystem {
  constructor({ scene, camera, canvas, colony, controls }) {
    this.camera = camera;
    this.canvas = canvas;
    this.colony = colony;
    this.active = false;
    this.mode = 'paint'; // 'paint' | 'erase'
    this.drag = null;
    this.message = null;
    this.onChange = null;
    this.group = new THREE.Group();
    this.group.name = 'roads';
    scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();
    // Cada nivel es una malla de cintas que siguen el terreno (no cuadrados sueltos).
    this.geometry = new THREE.PlaneGeometry(ROAD_CELL * 0.98, ROAD_CELL * 0.98).rotateX(-Math.PI / 2);
    this.materials = ROAD_LEVELS.map((l) => new THREE.MeshStandardMaterial({ color: l.color, roughness: 1, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.meshes = this.materials.map((m) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    this.preview = new THREE.InstancedMesh(this.geometry, new THREE.MeshBasicMaterial({ color: '#5fe08a', transparent: true, opacity: 0.55, depthWrite: false }), 120);
    this.preview.count = 0;
    this.preview.frustumCulled = false;
    this.group.add(this.preview);
    this.dirty = true;
    colony.on('roads', () => (this.dirty = true));
    colony.on('camp', () => (this.dirty = true));

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0 || e.shiftKey) return;
      this.drag = { cells: new Map(), sx: e.clientX, sy: e.clientY };
      this.addCell(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag) this.addCell(e.clientX, e.clientY);
    });
    const finish = () => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.preview.count = 0;
      const cells = [...d.cells.values()];
      if (this.mode === 'erase') {
        for (let i = 0; i < cells.length; i += 240) colony.eraseRoads(cells.slice(i, i + 240));
        this.onChange?.();
        return;
      }
      for (let i = 0; i < cells.length; i += 80) {
        const chunk = cells.slice(i, i + 80);
        const problem = colony.roadProblem(chunk);
        this.message = problem;
        if (!problem) colony.paintRoads(chunk);
        else break;
      }
      this.onChange?.();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active) this.setActive(false);
    });
    this.controls = controls;
  }

  setActive(on, mode = 'paint') {
    this.active = on;
    this.mode = mode;
    this.preview.material.color.set(mode === 'erase' ? '#e5645a' : '#5fe08a');
    this.drag = null;
    this.preview.count = 0;
    this.message = null;
    this.canvas.classList.toggle('is-placing', on);
    this.onChange?.();
  }

  // Añade al trazo la casilla bajo el puntero (y las intermedias, para que no queden huecos).
  addCell(clientX, clientY) {
    const camp = this.colony.camp;
    if (!camp || !this.drag) return;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = pickSurface(this.raycaster.ray, camp.height);
    if (!hit) return;
    const local = this.colony.toLocal(hit.point, this.tmp);
    const [ix, iz] = roadCellOf(local.x, local.z);
    const last = this.drag.last;
    const steps = last ? Math.max(Math.abs(ix - last[0]), Math.abs(iz - last[1])) : 1;
    for (let k = 1; k <= steps; k++) {
      const cx = last ? Math.round(last[0] + ((ix - last[0]) * k) / steps) : ix;
      const cz = last ? Math.round(last[1] + ((iz - last[1]) * k) / steps) : iz;
      const ok = this.mode === 'erase' ? this.colony.roads.has(`${cx},${cz}`) : !roadCellProblem(this.colony, cx, cz);
      if (ok && this.drag.cells.size < 240) this.drag.cells.set(`${cx},${cz}`, [cx, cz]);
    }
    this.drag.last = [ix, iz];
    this.updatePreview();
  }

  place(mesh, i, ix, iz) {
    const x = ix * ROAD_CELL;
    const z = iz * ROAD_CELL;
    const h = this.colony.heightAt(x, z) - this.colony.camp.height;
    const m = new THREE.Matrix4().makeTranslation(x, h + 0.08, z);
    mesh.setMatrixAt(i, m);
  }

  updatePreview() {
    let i = 0;
    for (const [ix, iz] of this.drag.cells.values()) {
      if (i >= 120) break;
      this.place(this.preview, i++, ix, iz);
    }
    this.preview.count = i;
    this.preview.instanceMatrix.needsUpdate = true;
  }

  // Cada fotograma: si cambiaron los caminos, se redibujan (y siguen al campamento).
  update() {
    const camp = this.colony.camp;
    this.group.visible = !!camp;
    if (!camp) return;
    this.group.position.copy(camp.position);
    this.group.quaternion.copy(camp.quaternion);
    if (!this.dirty) return;
    this.dirty = false;
    const roads = this.colony.roads;
    const lists = this.meshes.map(() => ({ pos: [], col: [], idx: [] }));
    const base = camp.height;
    const lift = 0.14;
    const y = (x, z) => this.colony.heightAt(x, z) - base + lift;
    const shade = (x, z) => 0.9 + 0.1 * Math.sin(x * 1.7 + z * 2.3); // leve variación de tono
    const push = (L, x, z, tone) => {
      L.pos.push(x, y(x, z), z);
      L.col.push(tone, tone, tone);
      return L.pos.length / 3 - 1;
    };
    const HALF = ROAD_CELL * 0.34; // el camino mide ~2,7 m de ancho
    for (const [key, lv] of roads) {
      const L = lists[lv - 1];
      if (!L) continue;
      const [ix, iz] = key.split(',').map(Number);
      const cx = ix * ROAD_CELL;
      const cz = iz * ROAD_CELL;
      // Disco en la casilla (une los tramos y redondea los extremos).
      const c = push(L, cx, cz, shade(cx, cz));
      const ring = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ring.push(push(L, cx + Math.cos(a) * HALF, cz + Math.sin(a) * HALF, shade(cx + k, cz)));
      }
      for (let k = 0; k < 12; k++) L.idx.push(c, ring[(k + 1) % 12], ring[k]);
      // Cintas hacia las casillas vecinas (cada pareja una sola vez).
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        if (!roads.has(`${ix + dx},${iz + dz}`)) continue;
        const ex = (ix + dx) * ROAD_CELL;
        const ez = (iz + dz) * ROAD_CELL;
        const len = Math.hypot(ex - cx, ez - cz);
        const nx = (-(ez - cz) / len) * HALF;
        const nz = ((ex - cx) / len) * HALF;
        const parts = Math.max(2, Math.ceil(len / 1.5));
        let prev = null;
        for (let t = 0; t <= parts; t++) {
          const px = cx + ((ex - cx) * t) / parts;
          const pz = cz + ((ez - cz) * t) / parts;
          const left = push(L, px + nx, pz + nz, shade(px, pz));
          const right = push(L, px - nx, pz - nz, shade(px, pz));
          if (prev) L.idx.push(prev[0], left, prev[1], prev[1], left, right);
          prev = [left, right];
        }
      }
    }
    this.meshes.forEach((mesh, k) => {
      const L = lists[k];
      const g = mesh.geometry;
      g.setAttribute('position', new THREE.Float32BufferAttribute(L.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(L.col, 3));
      g.setIndex(L.idx);
      // Normales hacia arriba: el camino se ilumina como el suelo, sea cual sea el sentido de los triángulos.
      g.setAttribute('normal', new THREE.Float32BufferAttribute(L.pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      mesh.material.side = THREE.DoubleSide;
    });
  }
}
