import * as THREE from 'three';
import { pickSurface } from './camp.js';
import { Parts, mat, stick, v } from './modelKit.js';
import { fromRect, rectFromCorners } from './rect.js';

// Herramienta de áreas. Se arrastra sobre el terreno para dibujar un rectángulo pegado
// al suelo:
//  - modo "mark"/"unmark": marca (o desmarca) lo recolectable dentro; sobre cada recurso
//    marcado aparece un pin (hacha, pico o cesta) y los colonos disponibles van a por él;
//  - modo "zone": dibuja la zona de acopio al aire libre (sólo hay una; dibujar otra la
//    reemplaza), donde se amontona lo que no cabe en el almacén.

const MAX_MARKERS = 1500;
const CLICK_RADIUS = 4; // un clic sin arrastrar marca lo que haya a 4 m
const TOOL_COLORS = { mark: '#f2b24c', unmark: '#ef6457', zone: '#8fd0ff', bad: '#ef6457' };
const MARKER_HEIGHT = { wood: 7.2, food: 1.5, stone: 1.4 };
const MARKER_KINDS = ['wood', 'stone', 'food'];

export class HarvestTool {
  // colony: la simulación (sim/colony.js); campObject(): el modelo del campamento.
  constructor({ scene, camera, canvas, colony, controls, campObject }) {
    this.camera = camera;
    this.canvas = canvas;
    this.colony = colony;
    this.campObject = campObject;
    this.active = false;
    this.mode = 'mark'; // 'mark' | 'unmark' | 'zone'
    this.message = null; // aviso si la zona no se puede poner
    this.drag = null; // esquinas { ax, az, bx, bz } y giro, en coordenadas del campamento
    this.onChange = null;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();

    // Íconos tipo "pin" sobre los recursos marcados: hacha roja en los árboles, pico en
    // las piedras y cesta en la comida. Una malla instanciada por tipo, siempre de cara
    // a la cámara y visibles aunque los tape una copa.
    const geometry = new THREE.PlaneGeometry(1.2, 1.5);
    geometry.translate(0, 0.75, 0); // la punta del pin abajo, sobre el recurso
    this.markers = new THREE.Group();
    this.icons = {};
    for (const kind of MARKER_KINDS) {
      const material = new THREE.MeshBasicMaterial({ map: iconTexture(kind), transparent: true, depthWrite: false, depthTest: false });
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_MARKERS);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 7;
      this.icons[kind] = mesh;
      this.markers.add(mesh);
    }
    this.markersDirty = true;
    this.billboard = new THREE.Quaternion();

    // Rectángulo que se está dibujando (relleno translúcido y borde, pegados al suelo).
    this.area = new THREE.Group();
    this.areaFill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.areaEdge = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.areaFill.renderOrder = 6;
    this.areaEdge.renderOrder = 6;
    this.area.add(this.areaFill, this.areaEdge);
    this.area.visible = false;

    // Zona de acopio: suelo de tierra apisonada, borde de cuerda con estacas, un cartel y
    // montones que crecen con lo guardado.
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
    colony.on('zones', () => {
      this.zonesDirty = true;
      this.onChange?.();
    });
    colony.on('marks', () => {
      this.markersDirty = true;
      this.onChange?.();
    });
    controls.blockLeftDrag = () => this.active;

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0 || e.shiftKey) return;
      const p = this.groundAt(e.clientX, e.clientY);
      if (!p) return;
      // Los lados del rectángulo siguen la vista: "a lo largo" es hacia donde mira la cámara.
      const f = this.tmp.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      f.applyQuaternion(this.colony.camp.quaternion.clone().invert());
      const angle = Math.atan2(-f.x, f.z);
      this.drag = { ax: p.x, az: p.z, bx: p.x, bz: p.z, angle, sx: e.clientX, sy: e.clientY };
      this.updateArea();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const p = this.groundAt(e.clientX, e.clientY);
      if (!p) return;
      this.drag.bx = p.x;
      this.drag.bz = p.z;
      this.updateArea();
    });
    const finish = (e) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.area.visible = false;
      const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6;
      const rect = rectFromCorners(d.ax, d.az, d.bx, d.bz, d.angle);
      if (this.mode === 'zone') {
        if (!moved) return;
        const problem = colony.setZone(rect);
        this.message = problem;
        if (!problem) this.setActive(false);
        else this.onChange?.();
        return;
      }
      if (moved) colony.markRect(rect, this.mode === 'mark');
      else colony.markArea(d.ax, d.az, CLICK_RADIUS, this.mode === 'mark');
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
    const campObject = this.campObject();
    if (!d || !campObject) return;
    if (this.area.parent !== campObject) campObject.add(this.area);
    const rect = rectFromCorners(d.ax, d.az, d.bx, d.bz, d.angle);
    if (rect.hw < 0.25 && rect.hd < 0.25) {
      this.area.visible = false;
      return;
    }
    let color = TOOL_COLORS[this.mode];
    if (this.mode === 'zone' && this.colony.zoneProblem(rect)) color = TOOL_COLORS.bad;
    this.areaFill.geometry.dispose();
    this.areaFill.geometry = groundRect(this.colony, rect, 0.25);
    this.areaEdge.geometry.dispose();
    this.areaEdge.geometry = groundFrame(this.colony, rect, 0.3, 0.35);
    this.areaFill.material.color.set(color);
    this.areaEdge.material.color.set(color);
    this.area.visible = true;
  }

  // La zona de acopio y sus montones (se rehace cuando cambia la zona o lo guardado).
  updateZones(delta) {
    const colony = this.colony;
    const camp = colony.camp;
    const campObject = this.campObject();
    if (this.zoneGroup.parent !== campObject) {
      campObject.add(this.zoneGroup);
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
    const zone = colony.zones[0];
    if (!zone) return;
    const ground = (x, z) => colony.heightAt(x, z) - camp.height;
    const own = (mesh) => {
      mesh.userData.own = true;
      this.zoneGroup.add(mesh);
      return mesh;
    };
    // Suelo de tierra apisonada y borde de cuerda clara.
    this.zoneFloorMaterial ??= new THREE.MeshBasicMaterial({ color: '#7a5a34', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.zoneEdgeMaterial ??= new THREE.MeshBasicMaterial({ color: '#e8d6a8', side: THREE.DoubleSide });
    own(new THREE.Mesh(groundRect(colony, zone, 0.06), this.zoneFloorMaterial)).renderOrder = 1;
    own(new THREE.Mesh(groundFrame(colony, zone, 0.12, 0.22), this.zoneEdgeMaterial));
    // Estacas cada ~4 m por el borde (y siempre en las esquinas).
    this.postGeometry ??= postGeometry();
    const { hw, hd } = zone;
    const posts = [];
    for (const [au, av, bu, bv, len] of [
      [-hw, -hd, hw, -hd, 2 * hw],
      [hw, -hd, hw, hd, 2 * hd],
      [hw, hd, -hw, hd, 2 * hw],
      [-hw, hd, -hw, -hd, 2 * hd],
    ]) {
      const n = Math.max(1, Math.round(len / 4));
      for (let k = 0; k < n; k++) posts.push(fromRect(zone, au + ((bu - au) * k) / n, av + ((bv - av) * k) / n));
    }
    for (const { x, z } of posts.slice(0, 400)) {
      const post = new THREE.Mesh(this.postGeometry, this.pileMaterial);
      post.position.set(x, ground(x, z), z);
      this.zoneGroup.add(post);
    }
    // Cartel "ACOPIO" en una esquina, para no confundirla con otra cosa.
    this.signGeometry ??= signGeometry();
    this.signMaterial ??= new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.9 });
    const sign = new THREE.Mesh(this.signGeometry, [this.pileMaterial, this.signMaterial]);
    const corner = fromRect(zone, -hw + 0.6, -hd + 0.6);
    sign.position.set(corner.x, ground(corner.x, corner.z), corner.z);
    sign.rotation.y = -zone.angle + Math.PI; // mirando hacia la cámara que la dibujó
    this.zoneGroup.add(sign);

    // Montones: la zona se divide en celdas de 3 m; cada montón guarda hasta 25 unidades.
    const CELL = 3;
    const cols = Math.max(1, Math.floor((2 * hw) / CELL));
    const rows = Math.max(1, Math.floor((2 * hd) / CELL));
    const cells = cols * rows;
    const piles = [];
    for (const kind of ['wood', 'stone', 'food', 'fiber', 'water']) {
      let amount = colony.outdoor[kind] ?? 0;
      while (amount >= 0.5) {
        const n = Math.min(25, amount);
        piles.push([kind, n]);
        amount -= n;
      }
    }
    const perCell = Math.max(1, Math.ceil(piles.length / cells));
    const cellSize = Math.min((2 * hw) / cols, (2 * hd) / rows);
    piles.forEach(([kind, n], i) => {
      const cell = Math.floor(i / perCell);
      const u = -hw + ((2 * hw) / cols) * ((cell % cols) + 0.5);
      const v = -hd + ((2 * hd) / rows) * ((Math.floor(cell / cols) % rows) + 0.5);
      const { x, z } = fromRect(zone, u, v);
      const pile = new THREE.Mesh(this.pileGeometry[kind], this.pileMaterial);
      pile.scale.setScalar((0.55 + Math.sqrt(n / 25) * 0.6) * Math.min(1, (cellSize / CELL) * 1.1) * Math.sqrt(perCell));
      pile.rotation.y = -zone.angle + ((i % 2) * Math.PI) / 2;
      pile.position.set(x, ground(x, z), z);
      this.zoneGroup.add(pile);
    });
  }

  // Llamar cada fotograma: rehace los rombos si cambió algo y los hace flotar.
  update(time, delta = 0) {
    const camp = this.colony.camp;
    const campObject = this.campObject();
    if (!camp || !campObject) {
      this.markers.removeFromParent();
      this.zoneGroup.removeFromParent();
      return;
    }
    this.updateZones(delta);
    if (this.markers.parent !== campObject) {
      campObject.add(this.markers);
      this.markersDirty = true;
    }
    if (this.markersDirty) {
      this.markersDirty = false;
      this.lists = {};
      for (const kind of MARKER_KINDS) {
        this.lists[kind] = this.colony.spots
          .filter((s) => s.marked && !s.gone && s.kind === kind)
          .slice(0, MAX_MARKERS)
          .map((s) => ({ s, y: this.colony.heightAt(s.x, s.z) - camp.height + MARKER_HEIGHT[kind] }));
        this.icons[kind].count = this.lists[kind].length;
      }
    }
    // De cara a la cámara (en el sistema del campamento).
    this.billboard.copy(camp.quaternion).invert().multiply(this.camera.quaternion);
    // Más grandes de lejos, para que se sigan viendo.
    const far = THREE.MathUtils.clamp(this.camera.position.distanceTo(camp.position) / 40, 1, 9);
    const size = new THREE.Vector3(far, far, far);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (const kind of MARKER_KINDS) {
      const mesh = this.icons[kind];
      this.lists[kind].forEach(({ s, y }, i) => {
        pos.set(s.x, y + Math.sin(time * 2.4 + i * 1.7) * 0.12 * far, s.z);
        mesh.setMatrixAt(i, m.compose(pos, this.billboard, size));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
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

// ---- Íconos de recolección --------------------------------------------------

// Pin redondo con un dibujo blanco: hacha (árboles), pico (piedras), cesta (comida).
function iconTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 160;
  const g = canvas.getContext('2d');
  const color = { wood: '#d8352a', stone: '#4f6f8a', food: '#3f8f45' }[kind];
  // Sombra, punta y círculo.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(64, 154, 14, 4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(64, 150);
  g.lineTo(36, 100);
  g.arc(64, 62, 52, Math.PI * 0.72, Math.PI * 0.28);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (kind === 'wood') {
    // Hacha: mango inclinado y hoja curva.
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(44, 100);
    g.lineTo(80, 30);
    g.stroke();
    g.beginPath();
    g.moveTo(70, 30);
    g.quadraticCurveTo(84, 18, 102, 30);
    g.quadraticCurveTo(108, 50, 96, 70);
    g.quadraticCurveTo(86, 56, 68, 52);
    g.closePath();
    g.fill();
  } else if (kind === 'stone') {
    // Pico: mango y cabeza arqueada.
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(42, 100);
    g.lineTo(78, 36);
    g.stroke();
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(40, 40);
    g.quadraticCurveTo(78, 12, 108, 58);
    g.stroke();
  } else {
    // Cesta con bayas.
    g.beginPath();
    g.arc(64, 60, 30, 0, Math.PI);
    g.closePath();
    g.fill();
    g.lineWidth = 6;
    g.beginPath();
    g.arc(64, 60, 24, Math.PI, 0);
    g.stroke();
    g.fillStyle = '#ffd1d6';
    for (const [x, y] of [[52, 54], [66, 50], [78, 55], [59, 44]]) {
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = color;
    g.lineWidth = 3;
    for (const x of [48, 64, 80]) {
      g.beginPath();
      g.moveTo(x, 66);
      g.lineTo(x, 84);
      g.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// ---- Rectángulos pegados al terreno ---------------------------------------------

// Malla del rectángulo siguiendo el relieve (a "lift" metros sobre el suelo). "box"
// elige una parte del rectángulo en sus coordenadas (u, v); por defecto, todo.
function groundRect(colony, rect, lift, box = { u0: -rect.hw, u1: rect.hw, v0: -rect.hd, v1: rect.hd }) {
  const w = box.u1 - box.u0;
  const d = box.v1 - box.v0;
  const nx = Math.min(60, Math.max(1, Math.ceil(w / 1.5)));
  const nz = Math.min(60, Math.max(1, Math.ceil(d / 1.5)));
  const base = colony.camp.height;
  const pos = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const { x, z } = fromRect(rect, box.u0 + (w * i) / nx, box.v0 + (d * j) / nz);
      pos.push(x, colony.heightAt(x, z) - base + lift, z);
    }
  }
  const index = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      index.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

// Marco del rectángulo: cuatro tiras de "width" metros que siguen el relieve.
function groundFrame(colony, rect, lift, width) {
  const { hw, hd } = rect;
  const wu = Math.min(width, hw);
  const wv = Math.min(width, hd);
  const strips = [
    { u0: -hw, u1: hw, v0: -hd, v1: -hd + wv },
    { u0: -hw, u1: hw, v0: hd - wv, v1: hd },
    { u0: -hw, u1: -hw + wu, v0: -hd, v1: hd },
    { u0: hw - wu, u1: hw, v0: -hd, v1: hd },
  ];
  const pos = [];
  const index = [];
  for (const box of strips) {
    const g = groundRect(colony, rect, lift, box);
    const offset = pos.length / 3;
    pos.push(...g.attributes.position.array);
    for (const k of g.index.array) index.push(k + offset);
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

// Cartel de la zona: poste y tabla (la tabla lleva la textura con el texto).
function signGeometry() {
  const post = new THREE.CylinderGeometry(0.06, 0.07, 1.6, 5);
  post.translate(0, 0.8, 0);
  const board = new THREE.BoxGeometry(1.3, 0.5, 0.06);
  board.translate(0, 1.45, 0.07);
  const g = new THREE.BufferGeometry();
  const geoms = [post.toNonIndexed(), board.toNonIndexed()];
  const pos = [];
  const normal = [];
  const uv = [];
  const color = [];
  geoms.forEach((geo, gi) => {
    pos.push(...geo.attributes.position.array);
    normal.push(...geo.attributes.normal.array);
    uv.push(...geo.attributes.uv.array);
    for (let k = 0; k < geo.attributes.position.count; k++) color.push(...(gi ? [1, 1, 1] : [0.48, 0.32, 0.19]));
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.addGroup(0, geoms[0].attributes.position.count, 0);
  g.addGroup(geoms[0].attributes.position.count, geoms[1].attributes.position.count, 1);
  return g;
}

function signTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 100;
  const g = canvas.getContext('2d');
  g.fillStyle = '#9a7446';
  g.fillRect(0, 0, 256, 100);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 12; y < 100; y += 22) g.fillRect(0, y, 256, 3);
  g.fillStyle = '#2a1a0c';
  g.font = 'bold 44px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ACOPIO', 128, 52);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
