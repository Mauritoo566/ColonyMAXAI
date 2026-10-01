import * as THREE from 'three';
import { RADIUS } from './elevation.js';
import { pickSurface } from './camp.js';
import { levelModel, frameMesh, material } from './buildingModels.js';
import { BUILDINGS, levelOf } from './sim/buildingTypes.js';
import { buildLevelFor } from './sim/progression.js';
import { DEPOSIT_COLORS } from './sim/economy.js';

// Vista y controles de los edificios. Los edificios en sí (obras, trabajadores, mejoras)
// son de la simulación (sim/colony.js); aquí se dibujan con su modelo y su etiqueta, se
// eligen con un clic y se coloca uno nuevo con una vista previa sobre el terreno.
//
// Los datos de los tipos viven en sim/buildingTypes.js y los modelos en buildingModels.js;
// se reexportan para que la interfaz los siga encontrando aquí.
export { BUILDING_TYPES, BUILD_CATEGORIES, BUILDINGS, STOCK_NAMES, levelOf } from './sim/buildingTypes.js';
export { buildingModel } from './buildingModels.js';

const CLICK_TOLERANCE = 6;
const LABEL_DISTANCE = 260; // metros: lo que pide atención se ve así de lejos
const LABEL_NEAR = 70; // y lo demás sólo así de cerca
const LABEL_MAX = 12;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class BuildingSystem {
  // pickColonist(x, y): el colono bajo el puntero (tiene prioridad sobre los edificios).
  constructor({ scene, camera, canvas, sim, terrain, labelsRoot, pickColonist }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.sim = sim;
    this.terrain = terrain;
    this.labelsRoot = labelsRoot;
    this.entries = new Map(); // id del edificio -> { b, object, model, frame, label, level }
    this.placing = null; // tipo que se está colocando
    this.turn = 0; // giro manual al colocar (pasos de 90°); 0 = mira al centro de la aldea
    this.pointer = null;
    this.candidate = null;
    this.selected = null;
    this.store = null; // el almacén del campamento (se puede elegir como un edificio)
    this.onSelect = null;
    this.onChange = null; // la interfaz se actualiza
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
    // Manchas de los yacimientos (sólo se ven al colocar una mina).
    this.deposits = new THREE.Group();
    this.deposits.visible = false;
    scene.add(this.deposits);

    // Aro bajo el edificio elegido.
    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.15, 40),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.position.y = 0.25;

    sim.on('camp', () => {
      this.stopPlacing();
      this.sync();
      this.createCampStore();
    });
    sim.on('buildings', () => this.sync());

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
      if (pickColonist?.(e.clientX, e.clientY)) {
        this.select(null);
        return;
      }
      this.select(this.pickAt(e.clientX, e.clientY));
    });
    // R gira el edificio 90° al colocarlo o moverlo (Mayús + R, al revés).
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'r' || e.key === 'R') && this.placing && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName ?? '')) {
        this.turn = (this.turn + (e.shiftKey ? 3 : 1)) % 4;
        e.preventDefault();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.placing) this.stopPlacing();
      else if (this.selected) this.select(null);
    });
  }

  // ---- Datos (de la simulación) ------------------------------------------------

  get list() {
    return this.sim.buildings;
  }

  canAfford(def) {
    return this.sim.canAfford(this.sim.costOf(def));
  }

  missing(def) {
    return this.sim.missing(this.sim.costOf(def));
  }

  // Por qué no se puede construir (edad, edificios previos, límites) o null.
  blocker(def) {
    return this.sim.buildBlocker(def);
  }

  ranking(b) {
    return this.sim.ranking(b);
  }

  upgradeProblem(b) {
    return this.sim.upgradeProblem(b);
  }

  upgrade(b) {
    return this.sim.upgrade(b);
  }

  setWorker(b, c) {
    this.sim.setWorker(b, c);
  }

  storeFill() {
    return this.sim.storeFill();
  }

  // ---- Colocar -------------------------------------------------------------

  startPlacing(id) {
    if (!this.sim.camp) return;
    this.select(null);
    this.onPlacingStart?.();
    this.placing = BUILDINGS[id];
    this.turn = 0;
    this.ghost.clear();
    const model = levelModel(this.placing.levels[buildLevelFor(this.placing, this.sim.age) - 1].model);
    model.material = material.clone();
    model.material.transparent = true;
    model.material.opacity = 0.55;
    model.material.depthWrite = false;
    this.ghost.add(model);
    const r = this.placing.footprint + 0.4;
    this.ghostRing.scale.setScalar(r);
    this.ghost.add(this.ghostRing);
    this.canvas.classList.add('is-placing');
    this.showDeposits(this.placing.deposit);
    this.onChange?.();
  }

  // Dibuja los yacimientos de un mineral sobre el suelo (null los oculta).
  showDeposits(kind) {
    for (const child of [...this.deposits.children]) {
      this.deposits.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
    this.deposits.visible = !!kind && !!this.sim.camp;
    if (!this.deposits.visible) return;
    this.deposits.position.copy(this.sim.camp.position);
    this.deposits.quaternion.copy(this.sim.camp.quaternion);
    for (const d of this.sim.deposits) {
      if (d.kind !== kind) continue;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(d.r, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: DEPOSIT_COLORS[kind], transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      disc.position.set(d.x, this.sim.heightAt(d.x, d.z) - this.sim.camp.height + 0.2, d.z);
      this.deposits.add(disc);
    }
  }

  stopPlacing() {
    if (!this.placing && !this.ghost.visible) return;
    this.placing = null;
    this.moving = null;
    this.candidate = null;
    this.ghost.visible = false;
    this.canvas.classList.remove('is-placing');
    this.showDeposits(null);
    this.onChange?.();
  }

  // Punto del suelo bajo el puntero, en coordenadas del campamento, y si se puede construir.
  updateCandidate() {
    this.candidate = null;
    if (!this.pointer || !this.placing || !this.sim.camp) return;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((this.pointer.x - rect.left) / rect.width) * 2 - 1, -((this.pointer.y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = pickSurface(this.raycaster.ray, this.sim.camp.height);
    if (!hit) return;
    const local = this.sim.toLocal(hit.point, this.tmp);
    // Con la cuadrícula activa el edificio se pega al centro de su casilla.
    const gx = this.grid ? this.grid.snap(local.x) : local.x;
    const gz = this.grid ? this.grid.snap(local.z) : local.z;
    const yaw = Math.atan2(-gx, -gz) + this.turn * (Math.PI / 2);
    this.candidate = { x: gx, z: gz, yaw, problem: this.moving ? this.sim.moveProblem(this.moving, gx, gz) : this.sim.buildProblem(this.placing, gx, gz) };
  }

  // Mover un edificio: se elige el nuevo sitio como al construir (sin coste).
  startMoving(b) {
    this.startPlacing(b.def.id);
    this.moving = b;
    // Al mover parte de su orientación actual (R la gira).
    this.turn = Math.round((b.yaw - Math.atan2(-b.x, -b.z)) / (Math.PI / 2));
    this.turn = ((this.turn % 4) + 4) % 4;
    this.ghost.remove(...this.ghost.children.filter((o) => o !== this.ghostRing));
    const model = levelModel(levelOf(b).model);
    model.material = material.clone();
    model.material.transparent = true;
    model.material.opacity = 0.55;
    model.material.depthWrite = false;
    this.ghost.add(model);
  }

  place({ x, z }) {
    if (this.moving) {
      const b = this.moving;
      const why = this.sim.moveBuilding(b, x, z, this.candidate?.yaw ?? null);
      this.stopPlacing();
      if (why) this.sim.emit('notice', why);
      return;
    }
    const { building } = this.sim.build(this.placing.id, x, z, this.candidate?.yaw ?? null);
    this.stopPlacing();
    if (building) this.select(building);
  }

  // ---- Modelos: se ponen al día con la simulación ----------------------------------

  sync() {
    const alive = new Set();
    for (const b of this.sim.buildings) {
      alive.add(b.id);
      let e = this.entries.get(b.id);
      if (e && e.b !== b) {
        this.removeEntry(e);
        e = null;
      }
      if (!e) e = this.addEntry(b);
      if (e.level !== b.level) {
        // La mejora cambia el nivel, el nombre y el modelo.
        e.level = b.level;
        e.object.remove(e.model);
        e.model.geometry.dispose();
        e.model = levelModel(levelOf(b).model);
        e.object.add(e.model);
        e.label.querySelector('.building-label-name').textContent = b.name;
      }
      this.updateVisual(e);
    }
    for (const e of [...this.entries.values()]) if (!alive.has(e.b.id)) this.removeEntry(e);
    if (this.selected && !this.selected.isStore && !alive.has(this.selected.id)) this.select(null);
    this.onChange?.();
  }

  addEntry(b) {
    // El terreno bajo el edificio ya lo aplanó la simulación: hay que redibujarlo.
    this.terrain.invalidateZone(b.zone);
    const object = new THREE.Group();
    object.position.copy(b.dir).multiplyScalar(RADIUS + b.height);
    object.quaternion.copy(this.sim.camp.quaternion).multiply(this.tmpQuat.setFromAxisAngle(Y_AXIS, b.yaw));
    const model = levelModel(levelOf(b).model);
    const frame = frameMesh(b.def.footprint);
    object.add(model, frame);
    this.scene.add(object);

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'building-label';
    label.innerHTML = `<span class="building-label-name"></span><span class="building-label-sub"></span><span class="building-label-bar"><i></i></span>`;
    label.querySelector('.building-label-name').textContent = b.name;
    label.hidden = true;
    label.addEventListener('click', () => this.select(b));
    this.labelsRoot.appendChild(label);
    const e = { b, object, model, frame, label, level: b.level };
    this.entries.set(b.id, e);
    return e;
  }

  removeEntry(e) {
    this.scene.remove(e.object);
    e.object.traverse((o) => o.geometry?.dispose());
    e.label.remove();
    this.terrain.invalidateZone(e.b.zone);
    this.entries.delete(e.b.id);
  }

  // La obra "crece" desde el suelo mientras se construye; una mejora mantiene el
  // edificio con andamios.
  updateVisual(e) {
    const b = e.b;
    const s = b.done || b.upgrading ? 1 : 0.06 + 0.94 * b.progress;
    e.model.scale.set(1, s, 1);
    e.frame.visible = !b.done;
  }

  // El almacén del campamento (vasijas y cestas junto a la fogata): no es un edificio
  // construido, pero se puede elegir para ver lo guardado y cuánto cabe.
  createCampStore() {
    if (this.store) {
      if (this.selected === this.store) this.select(null);
      this.scene.remove(this.store.object);
      this.store.label.remove();
      this.store = null;
    }
    const sim = this.sim;
    if (!sim.camp) return;
    const { x, z } = sim.layout.pots;
    const height = sim.heightAt(x, z);
    const dir = sim.toDirection(x, z, new THREE.Vector3());
    const object = new THREE.Group();
    object.position.copy(dir).multiplyScalar(RADIUS + height);
    object.quaternion.copy(sim.camp.quaternion);
    this.scene.add(object);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'building-label building-label--store';
    label.innerHTML = `<span class="building-label-name">Almacén</span><span class="building-label-sub"></span><span class="building-label-bar" hidden><i></i></span>`;
    label.hidden = true;
    this.labelsRoot.appendChild(label);
    const store = {
      isStore: true,
      name: 'Almacén del campamento',
      def: { id: 'campstore', icon: 'wood', footprint: 2.2 },
      x,
      z,
      dir,
      object,
      label,
      done: true,
    };
    label.addEventListener('click', () => this.select(store));
    this.store = store;
  }

  // ---- Selección -----------------------------------------------------------

  // Modelo y etiqueta de un edificio (o del almacén del campamento).
  viewOf(b) {
    return b?.isStore ? b : b ? this.entries.get(b.id) : null;
  }

  select(b) {
    if (this.selected === b) return;
    this.viewOf(this.selected)?.label.classList.remove('is-selected');
    this.selected = b;
    this.selectRing.removeFromParent();
    const view = this.viewOf(b);
    if (view) {
      view.label.classList.add('is-selected');
      this.selectRing.scale.setScalar(b.def.footprint + 0.8);
      view.object.add(this.selectRing);
    }
    this.onSelect?.(b);
  }

  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    let best = null;
    let bestD = Infinity;
    const views = [...this.entries.values()];
    if (this.store) views.push(this.store);
    for (const view of views) {
      const b = view.b ?? view;
      const p = this.tmp.copy(view.object.position).addScaledVector(b.dir, 1.5);
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

  update() {
    if (this.placing) {
      this.updateCandidate();
      const c = this.candidate;
      this.ghost.visible = !!c;
      if (c) {
        const sim = this.sim;
        const dir = sim.toDirection(c.x, c.z, this.tmp);
        this.ghost.position.copy(dir).multiplyScalar(RADIUS + sim.heightAt(c.x, c.z));
        this.ghost.quaternion.copy(sim.camp.quaternion).multiply(this.tmpQuat.setFromAxisAngle(Y_AXIS, c.yaw ?? Math.atan2(-c.x, -c.z)));
        this.ghostRing.material.color.set(c.problem ? '#ff5a4f' : '#5fe08a');
      }
    }
    for (const e of this.entries.values()) this.updateVisual(e);
    this.updateLabels();
  }

  // Texto bajo el nombre de un edificio terminado.
  labelOf(b) {
    const lv = levelOf(b);
    const needed = this.sim.crewNeeded(b);
    if (typeof lv.capacity === 'object') return 'Almacén';
    if (lv.housing != null) {
      const r = this.sim.residents(b);
      return `Vivienda · ${r.adults.length}/${lv.housing}${r.children.length ? ` (+${r.children.length} ${r.children.length > 1 ? 'niños' : 'niño'})` : ''}`;
    }
    if (needed) return b.workers.length === 0 ? 'Sin trabajador' : needed === 1 ? b.workers[0].name : `${b.workers.length}/${needed} trabajadores`;
    if (lv.defense) return `Defensa ${lv.defense}`;
    return 'En servicio';
  }

  // Etiquetas con jerarquía: el edificio elegido siempre; luego los que piden atención (obras,
  // detenidos, sin personal); los demás sólo cuando la cámara está cerca. Con muchas a la vista
  // se muestran las más importantes (LABEL_MAX).
  updateLabels() {
    const rect = this.canvas.getBoundingClientRect();
    const views = [...this.entries.values()];
    if (this.store) views.push(this.store);
    const shown = [];
    for (const view of views) {
      const b = view.b ?? view;
      view.label.hidden = true;
      const p = this.tmp.copy(view.object.position).addScaledVector(b.dir, b.isStore ? 2.4 : b.done ? 4.6 : 3.4);
      const dist = this.camera.position.distanceTo(p);
      const selected = this.selected === b;
      const needed = b.isStore ? 0 : this.sim.crewNeeded(b);
      const attention = !b.isStore && (!b.done || !!b.status || (needed > 0 && b.workers.length < needed));
      const rank = selected ? 3 : attention && dist < LABEL_DISTANCE ? 2 : dist < LABEL_NEAR ? 1 : 0;
      if (!rank) continue;
      p.project(this.camera);
      if (p.z >= 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) continue;
      shown.push({ view, b, rank, dist, x: p.x, y: p.y, selected, attention });
    }
    shown.sort((a, c) => c.rank - a.rank || a.dist - c.dist);
    for (const [i, s] of shown.entries()) {
      if (i >= LABEL_MAX && !s.selected) break;
      const { view, b } = s;
      const label = view.label;
      label.hidden = false;
      label.classList.toggle('is-minor', !s.selected && !s.attention);
      label.style.zIndex = String(s.rank);
      const sub = label.querySelector('.building-label-sub');
      const bar = label.querySelector('.building-label-bar');
      const site = !b.isStore && !b.done ? this.sim.siteInfo(b) : null;
      const text = b.isStore ? `${Math.round(this.sim.storeFill() * 100)}% lleno` : b.done ? this.labelOf(b) : `${b.upgrading ? 'Mejora' : 'Obra'} · ${site?.label ?? ''} · ${Math.round(b.progress * 100)}%`;
      if (sub.textContent !== text) sub.textContent = text;
      bar.hidden = b.done;
      if (!b.done) bar.firstChild.style.width = `${Math.round(b.progress * 100)}%`;
      const x = rect.left + ((s.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - s.y) / 2) * rect.height;
      label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }
}
