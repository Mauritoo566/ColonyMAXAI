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
    this.drag = null;
    this.message = null;
    this.onChange = null;
    this.group = new THREE.Group();
    this.group.name = 'roads';
    scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();
    this.geometry = new THREE.PlaneGeometry(ROAD_CELL * 0.98, ROAD_CELL * 0.98).rotateX(-Math.PI / 2);
    this.meshes = ROAD_LEVELS.map((l) => {
      const m = new THREE.InstancedMesh(this.geometry, new THREE.MeshStandardMaterial({ color: l.color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), MAX_CELLS);
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
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

  setActive(on) {
    this.active = on;
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
      if (!roadCellProblem(this.colony, cx, cz) && this.drag.cells.size < 240) this.drag.cells.set(`${cx},${cz}`, [cx, cz]);
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
    const counts = this.meshes.map(() => 0);
    for (const [key, lv] of this.colony.roads) {
      const mesh = this.meshes[lv - 1];
      const i = counts[lv - 1];
      if (!mesh || i >= MAX_CELLS) continue;
      const [ix, iz] = key.split(',').map(Number);
      this.place(mesh, i, ix, iz);
      counts[lv - 1]++;
    }
    this.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
    });
  }
}
