import * as THREE from 'three';
import { RADIUS, addTerrainZone, removeTerrainZone } from './elevation.js';
import { biomeAt, BIOMES } from './biomes.js';
import { pickSurface } from './camp.js';
import { Parts, mat, stick, v } from './modelKit.js';
import { hasTrait, addLog, SKILLS } from './needs.js';

// Edificios de la colonia. El jugador elige qué construir en la barra de construcción y
// dónde; los colonos lo construyen (los más hábiles, más rápido) y, al terminarlo, la
// colonia asigna como trabajador al colono libre más capacitado para ese oficio.

const STORAGE_KEY = 'colonymaxai.colony';
const SAVE_VERSION = 2; // 2: además guarda colonos, recursos agotados y el reloj
const MAX_DISTANCE = 75; // metros desde la fogata donde se puede construir
const CLICK_TOLERANCE = 6;
const LABEL_DISTANCE = 260;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Tipos de edificio
// ---------------------------------------------------------------------------

export const BUILDING_TYPES = [
  {
    id: 'gatherer',
    category: 'production',
    name: 'Choza de recolección',
    job: 'Recolección',
    skill: 'gathering',
    icon: 'food',
    desc: 'Un colono recoge bayas y setas de los alrededores y las guarda como comida.',
    cost: { wood: 15 },
    buildTime: 60,
    footprint: 2.8,
    resource: 'food',
    stock: 'food',
    yield: 2,
    workTime: 10,
    range: 170,
    goingText: 'Va a recolectar',
    workingText: 'Recolectando',
    returningText: 'Lleva comida al almacén',
    noResourceText: 'No hay bayas ni setas cerca',
    model: gathererModel,
  },
  {
    id: 'woodcutter',
    category: 'production',
    name: 'Cabaña del leñador',
    job: 'Tala',
    skill: 'woodcutting',
    icon: 'axe',
    desc: 'Un colono tala árboles cercanos y trae la madera al almacén.',
    cost: { wood: 20 },
    buildTime: 80,
    footprint: 3,
    resource: 'wood',
    stock: 'wood',
    yield: 6,
    workTime: 14,
    range: 200,
    goingText: 'Va a talar un árbol',
    workingText: 'Talando',
    returningText: 'Lleva madera al almacén',
    noResourceText: 'No hay árboles cerca',
    model: woodcutterModel,
  },
  {
    id: 'quarry',
    category: 'production',
    name: 'Cantera',
    job: 'Cantería',
    skill: 'mining',
    icon: 'pick',
    desc: 'Un colono pica las piedras de los alrededores y trae piedra al almacén.',
    cost: { wood: 25, stone: 5 },
    buildTime: 90,
    footprint: 3.2,
    resource: 'stone',
    stock: 'stone',
    yield: 3,
    workTime: 16,
    range: 200,
    goingText: 'Va a picar piedra',
    workingText: 'Picando piedra',
    returningText: 'Lleva piedra al almacén',
    noResourceText: 'No hay piedras cerca',
    model: quarryModel,
  },
  {
    id: 'well',
    category: 'production',
    name: 'Pozo',
    job: 'Acarreo de agua',
    skill: 'hauling',
    icon: 'water',
    desc: 'Todos pueden beber de él. Un aguatero además llena las vasijas del almacén.',
    cost: { wood: 10, stone: 15 },
    buildTime: 70,
    footprint: 1.8,
    stock: 'water',
    yield: 2,
    model: wellModel,
  },
];

// Categorías de la barra de construcción (las vacías se muestran como "próximamente").
export const BUILD_CATEGORIES = [
  { id: 'production', name: 'Producción', icon: 'hammer', soon: 'Edificios que consiguen comida, agua y materiales.' },
  { id: 'housing', name: 'Vivienda', icon: 'people', soon: 'Chozas y casas para que los colonos duerman mejor.' },
  { id: 'storage', name: 'Almacenes', icon: 'wood', soon: 'Graneros y depósitos para guardar más recursos.' },
  { id: 'decoration', name: 'Decoración', icon: 'leaf', soon: 'Jardines, estatuas y caminos que alegran a la colonia.' },
  { id: 'defense', name: 'Defensa', icon: 'shield', soon: 'Empalizadas y torres de vigilancia.' },
];

export const BUILDINGS = Object.fromEntries(BUILDING_TYPES.map((t) => [t.id, t]));

export const STOCK_NAMES = { food: 'comida', water: 'agua', wood: 'madera', stone: 'piedra' };

// ---------------------------------------------------------------------------
// Modelos (metros, suelo en y = 0)
// ---------------------------------------------------------------------------

function prism(radius, length) {
  // Prisma triangular con una arista arriba (para tejados a dos aguas).
  const g = new THREE.CylinderGeometry(radius, radius, length, 3);
  g.rotateZ(Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

function gathererModel(p) {
  p.add(new THREE.CylinderGeometry(2.2, 2.4, 1.8, 9), '#9a7148', mat(0, 0.9, 0));
  p.add(new THREE.CylinderGeometry(2.55, 2.75, 0.25, 9), '#a8843e', mat(0, 1.95, 0));
  p.add(new THREE.ConeGeometry(2.9, 2.3, 9), '#c9a45a', mat(0, 3.1, 0));
  p.add(new THREE.BoxGeometry(0.9, 1.4, 0.12), '#3a2618', mat(0, 0.7, 2.3));
  for (const [x, z] of [[1.9, 1.9], [-2.1, 1.5], [2.4, -0.6]]) {
    p.add(new THREE.CylinderGeometry(0.45, 0.38, 0.5, 8), '#c49a5a', mat(x, 0.25, z));
    for (let k = 0; k < 4; k++) {
      p.add(new THREE.IcosahedronGeometry(0.13, 0), k % 2 ? '#b8283a' : '#7a2a6a', mat(x + (k - 1.5) * 0.14, 0.55, z + ((k * 7) % 3 - 1) * 0.12));
    }
  }
}

function woodcutterModel(p) {
  p.add(new THREE.BoxGeometry(3.6, 0.35, 3), '#6b4a2e', mat(0, 0.17, 0));
  p.add(new THREE.BoxGeometry(3.4, 1.8, 2.8), '#8a5a34', mat(0, 1.2, 0));
  p.add(prism(1.7, 3.5), '#8a5a34', mat(0, 2.95, 0));
  p.add(new THREE.BoxGeometry(3.9, 0.16, 2.1), '#5a3a22', mat(0, 3.05, 0.78, 0.62, 0, 0));
  p.add(new THREE.BoxGeometry(3.9, 0.16, 2.1), '#5a3a22', mat(0, 3.05, -0.78, -0.62, 0, 0));
  p.add(new THREE.BoxGeometry(0.9, 1.5, 0.12), '#3a2618', mat(0.6, 1.05, 1.42));
  // Troncos apilados a un lado.
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - row; i++) {
      const y = 0.3 + row * 0.5;
      const z = (i - (2 - row) / 2) * 0.55;
      stick(p, v(2.3, y, z - 0.4), v(4.1, y, z - 0.4), 0.26, row % 2 ? '#7a5230' : '#6b4a2e', 6);
    }
  }
  p.add(new THREE.CylinderGeometry(0.5, 0.58, 0.7, 7), '#6b4a2e', mat(-2.6, 0.35, 1.4));
  stick(p, v(-2.6, 0.7, 1.4), v(-2.9, 1.5, 1.3), 0.045, '#9a7446', 4);
  p.add(new THREE.BoxGeometry(0.4, 0.22, 0.05), '#6d6d70', mat(-2.55, 0.78, 1.42, 0, 0, -0.3));
}

function quarryModel(p) {
  // Bloques de piedra cortados.
  const blocks = [
    [-1.6, 0.35, 1.2, 1.3, 0.7, 0.9, '#8f8a82'],
    [-0.3, 0.35, 1.5, 1.1, 0.7, 0.8, '#7d786f'],
    [-1.0, 1.0, 1.3, 1.0, 0.6, 0.8, '#9a958c'],
    [1.5, 0.3, -1.4, 1.4, 0.6, 1.1, '#857f76'],
    [0.6, 0.25, -1.9, 0.9, 0.5, 0.7, '#938e85'],
  ];
  for (const [x, y, z, w, h, d, c] of blocks) p.add(new THREE.BoxGeometry(w, h, d), c, mat(x, y, z, 0, x * 0.3, 0));
  // Grúa de madera en forma de A con una polea.
  stick(p, v(-1.2, 0, -0.4), v(0.2, 3.6, -0.4), 0.1, '#6b4a2e', 5);
  stick(p, v(1.6, 0, -0.4), v(0.2, 3.6, -0.4), 0.1, '#6b4a2e', 5);
  stick(p, v(0.2, 3.5, -0.4), v(2.6, 3.9, -0.4), 0.08, '#7a5230', 5);
  stick(p, v(2.5, 3.85, -0.4), v(2.5, 1.6, -0.4), 0.02, '#c8b48a', 3);
  p.add(new THREE.BoxGeometry(0.7, 0.5, 0.6), '#8f8a82', mat(2.5, 1.35, -0.4));
  // Cobertizo con herramientas.
  stick(p, v(1.9, 0, 1.2), v(1.9, 2, 1.2), 0.08, '#6b4a2e', 4);
  stick(p, v(3.1, 0, 1.2), v(3.1, 1.6, 1.2), 0.08, '#6b4a2e', 4);
  stick(p, v(1.9, 0, 2.4), v(1.9, 2, 2.4), 0.08, '#6b4a2e', 4);
  stick(p, v(3.1, 0, 2.4), v(3.1, 1.6, 2.4), 0.08, '#6b4a2e', 4);
  p.add(new THREE.BoxGeometry(1.6, 0.1, 1.6), '#5a3a22', mat(2.5, 1.85, 1.8, 0, 0, -0.3));
  stick(p, v(2.2, 0, 1.6), v(2.4, 1.2, 1.9), 0.035, '#9a7446', 4);
  p.add(new THREE.BoxGeometry(0.5, 0.12, 0.08), '#6d6d70', mat(2.42, 1.22, 1.93, 0, 0, 0.4));
}

function wellModel(p) {
  p.add(new THREE.CylinderGeometry(1.2, 1.3, 0.9, 12), '#8b877f', mat(0, 0.45, 0));
  p.add(new THREE.CylinderGeometry(1.25, 1.25, 0.15, 12), '#9a958c', mat(0, 0.95, 0));
  p.add(new THREE.CircleGeometry(0.95, 12), '#1f3a55', mat(0, 1.03, 0, -Math.PI / 2));
  stick(p, v(-1.1, 0.9, 0), v(-1.1, 2.6, 0), 0.08, '#6b4a2e', 5);
  stick(p, v(1.1, 0.9, 0), v(1.1, 2.6, 0), 0.08, '#6b4a2e', 5);
  stick(p, v(-1.3, 2.3, 0), v(1.3, 2.3, 0), 0.06, '#7a5230', 5);
  p.add(prism(0.9, 2.7), '#5a3a22', mat(0, 2.85, 0, 0, Math.PI / 2, 0));
  stick(p, v(0.2, 2.25, 0), v(0.2, 1.5, 0), 0.015, '#c8b48a', 3);
  p.add(new THREE.CylinderGeometry(0.22, 0.18, 0.3, 8), '#7a5230', mat(0.2, 1.35, 0));
}

// Andamio de obra: base de tablones y cuatro postes.
function frameModel(p, footprint) {
  const s = footprint * 1.6;
  p.add(new THREE.BoxGeometry(s, 0.15, s), '#8a643c', mat(0, 0.07, 0));
  const c = footprint * 0.75;
  for (const [x, z] of [[c, c], [-c, c], [c, -c], [-c, -c]]) stick(p, v(x, 0, z), v(x, 2.8, z), 0.09, '#a07a4a', 5);
  stick(p, v(-c, 2.6, c), v(c, 2.6, c), 0.06, '#a07a4a', 4);
  stick(p, v(-c, 2.6, -c), v(c, 2.6, -c), 0.06, '#a07a4a', 4);
}

const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide });

function buildMesh(fn, ...args) {
  const parts = new Parts();
  fn(parts, ...args);
  const mesh = parts.mesh(material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Sistema
// ---------------------------------------------------------------------------

export class BuildingSystem {
  constructor({ scene, camera, canvas, colony, terrain, labelsRoot }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.colony = colony;
    this.terrain = terrain;
    this.labelsRoot = labelsRoot;
    this.list = colony.buildings; // la misma lista que usa la IA
    this.placing = null; // tipo que se está colocando
    this.pointer = null;
    this.candidate = null;
    this.selected = null;
    this.onSelect = null;
    this.onChange = null; // la interfaz se actualiza
    this.nextId = 1;
    this.saveTimer = 0;
    this.assignTimer = 0;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();

    // Vista previa al colocar.
    this.ghost = new THREE.Group();
    this.ghostRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.25, 40),
      new THREE.MeshBasicMaterial({ color: '#5fe08a', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.position.y = 0.3;
    this.ghost.visible = false;
    scene.add(this.ghost);

    // Aro bajo el edificio elegido.
    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.15, 40),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.position.y = 0.25;

    colony.onCampChange = (camp) => this.load(camp);

    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
    });
    let pressed = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) pressed = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      const p = pressed;
      pressed = null;
      if (!p || e.button !== 0 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_TOLERANCE) return;
      if (this.placing) {
        this.pointer = { x: e.clientX, y: e.clientY };
        this.updateCandidate();
        if (this.candidate && !this.candidate.problem) this.place(this.candidate);
        return;
      }
      if (this.blockSelection?.()) return;
      // Un colono delante tiene prioridad sobre el edificio.
      if (colony.pickAt(e.clientX, e.clientY)) {
        this.select(null);
        return;
      }
      this.select(this.pickAt(e.clientX, e.clientY));
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.placing) this.stopPlacing();
      else if (this.selected) this.select(null);
    });
  }

  // ---- Materiales ----------------------------------------------------------

  canAfford(def) {
    const stock = this.colony.stock;
    return Object.entries(def.cost).every(([k, n]) => stock[k] >= n);
  }

  missing(def) {
    const stock = this.colony.stock;
    return Object.entries(def.cost)
      .filter(([k, n]) => stock[k] < n)
      .map(([k, n]) => `${Math.ceil(n - stock[k])} de ${STOCK_NAMES[k]}`);
  }

  // ---- Colocar -------------------------------------------------------------

  startPlacing(id) {
    if (!this.colony.camp) return;
    this.select(null);
    this.placing = BUILDINGS[id];
    this.ghost.clear();
    const model = buildMesh(this.placing.model);
    model.material = material.clone();
    model.material.transparent = true;
    model.material.opacity = 0.55;
    model.material.depthWrite = false;
    this.ghost.add(model);
    const r = this.placing.footprint + 0.4;
    this.ghostRing.scale.setScalar(r);
    this.ghost.add(this.ghostRing);
    this.canvas.classList.add('is-placing');
    this.onChange?.();
  }

  stopPlacing() {
    this.placing = null;
    this.candidate = null;
    this.ghost.visible = false;
    this.canvas.classList.remove('is-placing');
    this.onChange?.();
  }

  // Punto del suelo bajo el puntero, en coordenadas del campamento, y si se puede construir.
  updateCandidate() {
    this.candidate = null;
    if (!this.pointer || !this.placing) return;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((this.pointer.x - rect.left) / rect.width) * 2 - 1, -((this.pointer.y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = pickSurface(this.raycaster.ray, this.colony.camp.height);
    if (!hit) return;
    const local = this.colony.toLocal(hit.point, this.tmp);
    const x = local.x;
    const z = local.z;
    this.candidate = { x, z, problem: this.problemAt(this.placing, x, z) };
  }

  problemAt(def, x, z) {
    const colony = this.colony;
    if (!this.canAfford(def)) return `Faltan ${this.missing(def).join(' y ')}`;
    if (Math.hypot(x, z) > MAX_DISTANCE) return 'Demasiado lejos del campamento';
    const r = def.footprint;
    for (const o of colony.obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.r + r + 0.8) return 'Choca con otra construcción';
    }
    const h = colony.heightAt(x, z);
    if (h <= 0.8) return 'No se puede construir en el agua';
    let lo = h;
    let hi = h;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const hk = colony.heightAt(x + Math.cos(a) * (r + 1), z + Math.sin(a) * (r + 1));
      if (hk <= 0.8) return 'Demasiado cerca del agua';
      lo = Math.min(lo, hk);
      hi = Math.max(hi, hk);
    }
    if (hi - lo > r * 1.1) return 'El terreno es demasiado empinado';
    return null;
  }

  place({ x, z }) {
    const def = this.placing;
    for (const [k, n] of Object.entries(def.cost)) this.colony.stock[k] -= n;
    const b = this.create(def, x, z, Math.atan2(-x, -z), 0, 0);
    this.stopPlacing();
    this.select(b);
    this.save();
  }

  // ---- Crear y quitar ------------------------------------------------------

  create(def, x, z, yaw, progress, produced) {
    const colony = this.colony;
    const height = colony.heightAt(x, z);
    const dir = colony.toDirection(x, z, new THREE.Vector3());
    const ground = biomeAt(dir.x, dir.y, dir.z);
    // Aplanar el terreno bajo el edificio y pintar un poco de tierra.
    const zone = addTerrainZone({
      dir: dir.clone(),
      height,
      flatRadius: def.footprint + 1,
      blendRadius: 5,
      clearRadius: def.footprint + 0.8,
      detailRadius: 0,
      dirtColor: (ground.details ? ground : BIOMES.grassland).dirt,
      resourceClear: def.footprint + 3,
    });
    this.terrain.invalidateZone(zone);
    colony.heights.clear();

    const object = new THREE.Group();
    object.position.copy(dir).multiplyScalar(RADIUS + height);
    object.quaternion.copy(colony.camp.object.quaternion).multiply(this.tmpQuat.setFromAxisAngle(Y_AXIS, yaw));
    const model = buildMesh(def.model);
    const frame = buildMesh(frameModel, def.footprint);
    object.add(model, frame);
    this.scene.add(object);

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'building-label';
    label.innerHTML = `<span class="building-label-name"></span><span class="building-label-sub"></span><span class="building-label-bar"><i></i></span>`;
    label.querySelector('.building-label-name').textContent = def.name;
    label.hidden = true;
    this.labelsRoot.appendChild(label);

    const b = {
      id: this.nextId++,
      def,
      x,
      z,
      yaw,
      height,
      dir,
      progress,
      done: false,
      produced,
      worker: null,
      reason: '',
      status: null,
      object,
      model,
      frame,
      label,
      zone,
      finish: (builder) => this.finish(b, builder),
    };
    label.addEventListener('click', () => this.select(b));
    this.list.push(b);
    colony.refreshObstacles();
    if (progress >= 1) this.finish(b, null, true);
    this.updateVisual(b);
    this.onChange?.();
    return b;
  }

  removeAll() {
    for (const b of this.list) {
      this.scene.remove(b.object);
      b.label.remove();
      b.removed = true;
      removeTerrainZone(b.zone);
      this.terrain.invalidateZone(b.zone);
      b.object.traverse((o) => o.geometry?.dispose());
    }
    this.list.length = 0;
    this.select(null);
  }

  finish(b, builder, silent = false) {
    if (b.done) return;
    b.progress = 1;
    b.done = true;
    b.frame.visible = false;
    if (builder && !silent) {
      const time = this.timeLabel?.() ?? '';
      addLog(builder, time, `Terminó de construir: ${b.def.name}`);
    }
    this.assignWorker(b);
    this.updateVisual(b);
    this.save();
    this.onChange?.();
  }

  // ---- Trabajadores --------------------------------------------------------

  // Puntuación de un colono para un oficio: su habilidad y su actitud.
  aptitude(c, def) {
    return c.skills[def.skill] + (hasTrait(c, 'hardworking') ? 0.8 : 0) - (hasTrait(c, 'lazy') ? 1.2 : 0);
  }

  // Colonos ordenados de más a menos capacitados para un edificio.
  ranking(b) {
    return [...this.colony.colonists].sort((a, c) => this.aptitude(c, b.def) - this.aptitude(a, b.def));
  }

  // La colonia elige al colono libre más capacitado.
  assignWorker(b) {
    if (!b.done || b.worker) return;
    const free = this.ranking(b).filter((c) => !c.job);
    if (!free.length) {
      b.reason = 'No hay colonos libres. Puedes elegir a uno de la lista.';
      return;
    }
    const best = free[0];
    const skillName = SKILLS.find((s) => s.id === b.def.skill).name;
    const others = free.length > 1 ? ' entre los colonos libres' : '';
    this.setWorker(b, best, `La colonia le eligió por tener la mejor ${skillName.toLowerCase()} (${best.skills[b.def.skill]}/10)${others}.`);
  }

  // Asignar a mano (desde la ficha del edificio).
  setWorker(b, c, reason = 'Elegido por ti.') {
    if (c.job && c.job !== b) {
      const old = c.job;
      old.worker = null;
      old.reason = `${c.name} se fue a trabajar a ${b.def.name}.`;
    }
    if (b.worker && b.worker !== c) b.worker.job = null;
    b.worker = c;
    b.reason = reason;
    c.job = b;
    addLog(c, this.timeLabel?.() ?? '', `Ahora trabaja en: ${b.def.name}`);
    this.save();
    this.onChange?.();
  }

  // ---- Selección -----------------------------------------------------------

  select(b) {
    if (this.selected === b) return;
    if (this.selected) this.selected.label.classList.remove('is-selected');
    this.selected = b;
    this.selectRing.removeFromParent();
    if (b) {
      b.label.classList.add('is-selected');
      this.selectRing.scale.setScalar(b.def.footprint + 0.8);
      b.object.add(this.selectRing);
    }
    this.onSelect?.(b);
  }

  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    let best = null;
    let bestD = Infinity;
    for (const b of this.list) {
      const p = this.tmp.copy(b.object.position).addScaledVector(b.dir, 1.5);
      const dist3 = this.camera.position.distanceTo(p);
      p.project(this.camera);
      if (p.z > 1) continue;
      const x = rect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - p.y) / 2) * rect.height;
      const pxPerMeter = rect.height / (2 * dist3 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
      const radius = Math.max(24, pxPerMeter * b.def.footprint * 1.1);
      const d = Math.hypot(clientX - x, clientY - y);
      if (d < radius && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  // ---- Cada fotograma --------------------------------------------------------

  update(delta, { timeLabel } = {}) {
    this.timeLabel = timeLabel;
    if (this.placing) {
      this.updateCandidate();
      const c = this.candidate;
      this.ghost.visible = !!c;
      if (c) {
        const colony = this.colony;
        const dir = colony.toDirection(c.x, c.z, this.tmp);
        this.ghost.position.copy(dir).multiplyScalar(RADIUS + colony.heightAt(c.x, c.z));
        this.ghost.quaternion.copy(colony.camp.object.quaternion).multiply(this.tmpQuat.setFromAxisAngle(Y_AXIS, Math.atan2(-c.x, -c.z)));
        this.ghostRing.material.color.set(c.problem ? '#ff5a4f' : '#5fe08a');
      }
    }
    for (const b of this.list) this.updateVisual(b);
    this.updateLabels();

    this.assignTimer -= delta;
    if (this.assignTimer <= 0) {
      this.assignTimer = 1;
      for (const b of this.list) this.assignWorker(b);
    }
    this.saveTimer -= delta;
    if (this.saveTimer <= 0) {
      this.saveTimer = 5;
      this.save();
    }
  }

  // La obra "crece" desde el suelo mientras se construye.
  updateVisual(b) {
    const s = b.done ? 1 : 0.06 + 0.94 * b.progress;
    b.model.scale.set(1, s, 1);
    b.frame.visible = !b.done;
  }

  updateLabels() {
    const rect = this.canvas.getBoundingClientRect();
    for (const b of this.list) {
      const p = this.tmp.copy(b.object.position).addScaledVector(b.dir, b.done ? 4.6 : 3.4);
      const dist = this.camera.position.distanceTo(p);
      p.project(this.camera);
      const visible = dist < LABEL_DISTANCE && p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      b.label.hidden = !visible;
      if (!visible) continue;
      const sub = b.label.querySelector('.building-label-sub');
      const bar = b.label.querySelector('.building-label-bar');
      const text = b.done ? (b.worker ? b.worker.name : 'Sin trabajador') : `En obra · ${Math.round(b.progress * 100)}%`;
      if (sub.textContent !== text) sub.textContent = text;
      bar.hidden = b.done;
      if (!b.done) bar.firstChild.style.width = `${Math.round(b.progress * 100)}%`;
      const x = rect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - p.y) / 2) * rect.height;
      b.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  // ---- Guardado --------------------------------------------------------------

  save() {
    const camp = this.colony.camp;
    if (!camp || this.loading) return;
    const data = {
      version: SAVE_VERSION,
      campSeed: camp.seed,
      savedAt: Date.now(),
      stock: this.colony.stock,
      colony: this.colony.serialize(),
      world: this.world?.save() ?? null,
      buildings: this.list.map((b) => ({
        type: b.def.id,
        x: b.x,
        z: b.z,
        yaw: b.yaw,
        progress: b.progress,
        produced: b.produced,
        worker: b.worker ? b.worker.id : null,
      })),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Sin almacenamiento: la colonia dura sólo esta sesión.
    }
  }

  load(camp) {
    this.removeAll();
    this.stopPlacing();
    if (!camp) return;
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      data = null;
    }
    // Sólo si es la colonia de este mismo campamento (versión 1 = sin colonos).
    if (!data || !(data.version >= 1 && data.version <= SAVE_VERSION) || data.campSeed !== camp.seed) {
      this.save();
      return;
    }
    this.loading = true; // que crear edificios no guarde a medias
    Object.assign(this.colony.stock, data.stock);
    for (const s of data.buildings || []) {
      const def = BUILDINGS[s.type];
      if (!def) continue;
      const b = this.create(def, s.x, s.z, s.yaw, s.progress, s.produced || 0);
      const worker = this.colony.colonists.find((c) => c.id === s.worker);
      if (b.done && worker) {
        if (b.worker) b.worker.job = null;
        b.worker = worker;
        worker.job = b;
        b.reason = 'Trabajaba aquí antes.';
      }
    }
    // Necesidades, salud, posición y registro de cada colono; recursos agotados; reloj.
    this.colony.restore(data.colony);
    if (data.world) this.world?.load(data.world);
    this.loading = false;
    this.onChange?.();
  }
}
