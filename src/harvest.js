import * as THREE from 'three';
import { pickSurface } from './camp.js';
import { Parts, mat, stick, v } from './modelKit.js';
import { ZONE_RADIUS, zoneCapacity } from './colonists.js';

// También dibuja las zonas de acopio al aire libre (modo "zone"): lo que no cabe en el
// almacén se amontona ahí.
//
// Herramienta de recolección: el jugador arrastra sobre el terreno para marcar (o
// desmarcar) un área; todo lo recolectable dentro queda marcado con un rombo y los
// colonos disponibles van a recogerlo (ai.js, tarea "harvest").

const MAX_MARKERS = 1500;
const CLICK_RADIUS = 4; // un clic sin arrastrar marca lo que haya a 4 m
const MAX_RADIUS = 60;
const MARKER_HEIGHT = { wood: 7.5, food: 1.9, stone: 1.7 };
const COLORS = { food: new THREE.Color('#f0a04b'), wood: new THREE.Color('#e3b25a'), stone: new THREE.Color('#c9c4ba') };

export class HarvestTool {
  constructor({ scene, camera, canvas, colony, controls }) {
    this.camera = camera;
    this.canvas = canvas;
    this.colony = colony;
    this.active = false;
    this.mode = 'mark'; // 'mark' | 'unmark' | 'zone'
    this.message = null; // aviso si la zona no se puede poner
    this.drag = null; // { x, z, r } en coordenadas del campamento
    this.onChange = null;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();

    // Rombos sobre los recursos marcados (una sola malla instanciada).
    const geometry = new THREE.OctahedronGeometry(0.45, 0);
    geometry.scale(1, 1.5, 1);
    const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false });
    this.markers = new THREE.InstancedMesh(geometry, material, MAX_MARKERS);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 5;
    this.markersDirty = true;

    // Área que se está dibujando: disco translúcido con borde.
    this.area = new THREE.Group();
    this.areaFill = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.18, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
    );
    this.areaRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 64),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
    );
    for (const m of [this.areaFill, this.areaRing]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 6;
      this.area.add(m);
    }
    this.area.visible = false;

    // Zonas de acopio: círculo en el suelo y montones que crecen con lo guardado.
    this.zoneGroup = new THREE.Group();
    this.zonesDirty = true;
    this.pileTimer = 0;
    this.pileMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.pileGeometry = {
      wood: pileGeometry(woodPile),
      stone: pileGeometry(stonePile),
      food: pileGeometry(foodPile),
      fiber: pileGeometry(fiberPile),
      water: pileGeometry(waterPile),
    };
    colony.onZonesChange = () => {
      this.zonesDirty = true;
      this.onChange?.();
    };

    colony.onMarksChange = () => {
      this.markersDirty = true;
      this.onChange?.();
    };
    controls.blockLeftDrag = () => this.active;

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0 || e.shiftKey) return;
      const p = this.groundAt(e.clientX, e.clientY);
      if (!p) return;
      this.drag = { x: p.x, z: p.z, r: 0, sx: e.clientX, sy: e.clientY };
      this.updateArea();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const p = this.groundAt(e.clientX, e.clientY);
      if (p) this.drag.r = Math.min(MAX_RADIUS, Math.hypot(p.x - this.drag.x, p.z - this.drag.z));
      this.updateArea();
    });
    const finish = (e) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.area.visible = false;
      const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6;
      if (this.mode === 'zone') {
        const problem = colony.addZone(d.x, d.z, moved ? d.r : ZONE_RADIUS[0] + 2);
        this.message = problem;
        if (!problem) this.setActive(false);
        else this.onChange?.();
        return;
      }
      colony.markArea(d.x, d.z, moved ? Math.max(d.r, CLICK_RADIUS) : CLICK_RADIUS, this.mode === 'mark');
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active) this.setActive(false);
    });
  }

  setActive(active, mode = this.mode) {
    this.active = active && !!this.colony.camp;
    this.mode = mode;
    this.message = null;
    this.drag = null;
    this.area.visible = false;
    this.canvas.classList.toggle('is-harvesting', this.active);
    this.onChange?.();
  }

  // Punto del terreno bajo el puntero, en coordenadas del campamento.
  groundAt(clientX, clientY) {
    const camp = this.colony.camp;
    if (!camp) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = pickSurface(this.raycaster.ray, camp.height);
    if (!hit) return null;
    const local = this.colony.toLocal(hit.point, this.tmp);
    return { x: local.x, z: local.z };
  }

  updateArea() {
    const d = this.drag;
    const camp = this.colony.camp;
    if (!d || !camp) return;
    if (this.area.parent !== camp.object) camp.object.add(this.area);
    let r = Math.max(d.r, CLICK_RADIUS);
    let color = this.mode === 'mark' ? '#f2b24c' : '#ef6457';
    if (this.mode === 'zone') {
      r = Math.min(ZONE_RADIUS[1], Math.max(ZONE_RADIUS[0], d.r));
      color = this.colony.zoneProblem(d.x, d.z, r) ? '#ef6457' : '#8fd0ff';
    }
    this.area.position.set(d.x, this.colony.heightAt(d.x, d.z) - camp.height + 0.4, d.z);
    this.area.scale.setScalar(r);
    this.areaFill.material.color.set(color);
    this.areaRing.material.color.set(color);
    this.area.visible = true;
  }

  // Círculos de las zonas y montones según lo guardado al aire libre.
  updateZones(delta) {
    const colony = this.colony;
    const camp = colony.camp;
    if (this.zoneGroup.parent !== camp.object) {
      camp.object.add(this.zoneGroup);
      this.zonesDirty = true;
    }
    this.pileTimer -= delta;
    if (!this.zonesDirty && this.pileTimer > 0) return;
    this.pileTimer = 1;
    const key = JSON.stringify([colony.zones, Object.entries(colony.outdoor).map(([k, n]) => [k, Math.round(n)])]);
    if (!this.zonesDirty && key === this.zoneKey) return;
    this.zonesDirty = false;
    this.zoneKey = key;
    for (const child of [...this.zoneGroup.children]) {
      this.zoneGroup.remove(child);
      if (child.userData.own) child.geometry.dispose();
    }
    const kinds = ['wood', 'stone', 'food', 'fiber', 'water'];
    const total = colony.outdoorCapacity() || 1;
    colony.zones.forEach((zone, zi) => {
      const y = colony.heightAt(zone.x, zone.z) - camp.height + 0.08;
      // Borde de estacas y cuerda.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(zone.r - 0.18, zone.r, 48),
        new THREE.MeshBasicMaterial({ color: '#d9c08a', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(zone.x, y + 0.05, zone.z);
      ring.userData.own = true;
      this.zoneGroup.add(ring);
      const posts = Math.max(8, Math.round(zone.r * 1.6));
      for (let k = 0; k < posts; k++) {
        const a = (k / posts) * Math.PI * 2;
        const px = zone.x + Math.cos(a) * zone.r;
        const pz = zone.z + Math.sin(a) * zone.r;
        const post = new THREE.Mesh(this.postGeometry ??= postGeometry(), this.pileMaterial);
        post.position.set(px, colony.heightAt(px, pz) - camp.height, pz);
        this.zoneGroup.add(post);
      }
      // Cada recurso ocupa su sector de la zona; el montón crece con la cantidad.
      const share = zoneCapacity(zone) / total;
      kinds.forEach((kind, ki) => {
        const amount = (colony.outdoor[kind] ?? 0) * share;
        if (amount < 0.5) return;
        const a = (ki / kinds.length) * Math.PI * 2 + zi;
        const d = zone.r * 0.5;
        const px = zone.x + Math.cos(a) * d;
        const pz = zone.z + Math.sin(a) * d;
        const pile = new THREE.Mesh(this.pileGeometry[kind], this.pileMaterial);
        const scale = Math.min(zone.r * 0.32, 0.5 + Math.sqrt(amount) * 0.22);
        pile.scale.setScalar(scale);
        pile.rotation.y = a;
        pile.position.set(px, colony.heightAt(px, pz) - camp.height, pz);
        this.zoneGroup.add(pile);
      });
    });
  }

  // Llamar cada fotograma: rehace los rombos si cambió algo y los hace flotar.
  update(time, delta = 0) {
    const camp = this.colony.camp;
    if (!camp) {
      this.markers.removeFromParent();
      this.zoneGroup.removeFromParent();
      return;
    }
    this.updateZones(delta);
    if (this.markers.parent !== camp.object) {
      camp.object.add(this.markers);
      this.markersDirty = true;
    }
    if (this.markersDirty) {
      this.markersDirty = false;
      this.list = this.colony.spots.filter((s) => s.marked && !s.gone).slice(0, MAX_MARKERS);
      this.baseY = this.list.map((s) => this.colony.heightAt(s.x, s.z) - camp.height + (MARKER_HEIGHT[s.kind] ?? 2));
      this.list.forEach((s, i) => this.markers.setColorAt(i, COLORS[s.kind] ?? COLORS.food));
      this.markers.count = this.list.length;
      if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), time * 1.5);
    // Más grandes de lejos, para que se sigan viendo.
    const far = THREE.MathUtils.clamp(this.camera.position.distanceTo(camp.object.position) / 45, 1, 8);
    const one = new THREE.Vector3(far, far, far);
    const pos = new THREE.Vector3();
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      pos.set(s.x, this.baseY[i] + (far - 1) * 0.7 + Math.sin(time * 2.2 + i) * 0.15, s.z);
      this.markers.setMatrixAt(i, m.compose(pos, q, one));
    }
    this.markers.instanceMatrix.needsUpdate = true;
  }
}

// ---- Montones de la zona al aire libre (1 m de base aprox.) ------------------

function pileGeometry(build) {
  const p = new Parts();
  build(p);
  return p.mesh(new THREE.MeshBasicMaterial()).geometry;
}

function postGeometry() {
  const p = new Parts();
  stick(p, v(0, 0, 0), v(0, 0.7, 0), 0.05, '#7a5230', 4);
  return p.mesh(new THREE.MeshBasicMaterial()).geometry;
}

function woodPile(p) {
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - row; i++) {
      const z = (i - (2 - row) / 2) * 0.42;
      stick(p, v(-0.8, 0.2 + row * 0.36, z), v(0.8, 0.2 + row * 0.36, z), 0.19, (i + row) % 2 ? '#7a5230' : '#6b4a2e', 6);
    }
  }
}

function stonePile(p) {
  const rocks = [[0, 0.25, 0, 0.4], [0.5, 0.2, 0.2, 0.3], [-0.45, 0.2, 0.25, 0.32], [0.1, 0.2, -0.5, 0.3], [0.05, 0.6, 0.05, 0.28]];
  rocks.forEach(([x, y, z, r], k) => p.add(new THREE.DodecahedronGeometry(r, 0), k % 2 ? '#8f8a82' : '#7d786f', mat(x, y, z, k, k * 2, 0)));
}

function foodPile(p) {
  for (const [x, z] of [[0, 0], [0.55, 0.25], [-0.5, 0.3], [0.1, -0.5]]) {
    p.add(new THREE.CylinderGeometry(0.3, 0.24, 0.4, 7), '#b89a5e', mat(x, 0.2, z));
    for (let k = 0; k < 3; k++) p.add(new THREE.IcosahedronGeometry(0.1, 0), k % 2 ? '#b8283a' : '#7a2a6a', mat(x + (k - 1) * 0.1, 0.42, z));
  }
}

function fiberPile(p) {
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    stick(p, v(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35), v(Math.cos(a) * 0.05, 0.8, Math.sin(a) * 0.05), 0.06, k % 2 ? '#c9b36a' : '#b5c46a', 3);
  }
  p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 6), '#8f7442', mat(0, 0.45, 0));
}

function waterPile(p) {
  for (const [x, z] of [[0, 0], [0.5, 0.2], [-0.4, 0.3]]) {
    p.add(new THREE.CylinderGeometry(0.26, 0.2, 0.5, 8), '#a8583a', mat(x, 0.25, z));
    p.add(new THREE.CircleGeometry(0.2, 8), '#2a4a66', mat(x, 0.51, z, -Math.PI / 2));
  }
}
