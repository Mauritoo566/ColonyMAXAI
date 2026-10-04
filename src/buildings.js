import * as THREE from 'three';
import { RADIUS } from './elevation.js';
import { pickSurface } from './camp.js';
import { levelModel, frameMesh, material, modelVariant, releaseModel } from './buildingModels.js';
import { BUILDINGS, levelOf } from './sim/buildingTypes.js';
import { buildLevelFor } from './sim/progression.js';
import { eatingNow } from './sim/dining.js';
import { addChimneySmoke } from './chimneySmoke.js';
import { addTorchFlame } from './torchFlames.js';
import { DEPOSIT_COLORS } from './sim/economy.js';
import { entranceOf, halfFor, ACCESS_DEPTH, footprintRect, rectsOverlap } from './sim/access.js';

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

// Marcas sobre el suelo de un edificio: su huella (las casillas que ocupa), la franja de acceso que hay que dejar
// libre delante de la puerta y una flecha que dice hacia dónde mira. Se dibuja en el espacio del edificio, así que
// gira con él. Verde/celeste si está bien; rojo/naranja si algo lo impide (sim/access.js).
const OVERLAY_COLORS = { foot: '#5fe08a', footBad: '#ff5a4f', zone: '#4cc9f0', zoneBad: '#ffa23a', arrow: '#ffffff' };
function createAccessOverlay() {
  const group = new THREE.Group();
  group.name = 'acceso';
  group.visible = false;
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const material = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const foot = new THREE.Mesh(plane, material(OVERLAY_COLORS.foot, 0.22));
  const zone = new THREE.Mesh(plane, material(OVERLAY_COLORS.zone, 0.3));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 3).rotateX(Math.PI / 2), material(OVERLAY_COLORS.arrow, 0.9));
  for (const m of [foot, zone, arrow]) m.renderOrder = 5;
  group.add(foot, zone, arrow);
  return {
    group,
    // def: tipo; problem: texto del problema de colocación (o null); issue: entrada bloqueada de uno ya puesto (o null).
    set(def, problem = null, issue = null) {
      const e = entranceOf(def, 0, 0, 0);
      const h = halfFor(def);
      group.visible = !def.line;
      if (def.line) return;
      const accessBad = !!issue || /entrada/i.test(problem ?? '');
      foot.scale.set(h * 2, 1, h * 2);
      foot.position.set(0, 0.5, 0);
      foot.material.color.set(problem && !accessBad ? OVERLAY_COLORS.footBad : OVERLAY_COLORS.foot);
      zone.visible = arrow.visible = !!e;
      if (!e) return;
      zone.scale.set(e.width, 1, ACCESS_DEPTH);
      zone.position.set(0, 0.55, h + ACCESS_DEPTH / 2);
      zone.material.color.set(accessBad ? OVERLAY_COLORS.zoneBad : OVERLAY_COLORS.zone);
      arrow.position.set(0, 0.9, h + 1.4);
      arrow.material.color.set(accessBad ? OVERLAY_COLORS.zoneBad : OVERLAY_COLORS.arrow);
    },
  };
}

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
    // Entradas ajenas que el edificio en vista previa taparía: se marcan en naranja sobre el terreno.
    this.conflictGroup = new THREE.Group();
    this.conflictGroup.visible = false;
    scene.add(this.conflictGroup);
    this.conflictPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.conflictMaterial = new THREE.MeshBasicMaterial({ color: OVERLAY_COLORS.zoneBad, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.ghostAccess = createAccessOverlay();
    this.selectedAccess = createAccessOverlay();
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

    // Aro grande: el radio donde el trabajador busca recursos (tala, recolección, cantería).
    this.rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 64),
      new THREE.MeshBasicMaterial({ color: '#5fc8e0', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.position.y = 0.2;

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
      // Muros: se arrastra una línea (como en un juego de estrategia); el inicio queda fijo.
      if (e.button === 0 && this.placing?.line && !this.moving) {
        this.pointer = { x: e.clientX, y: e.clientY };
        this.updateCandidate();
        if (this.groundPoint) this.lineStart = { ...this.groundPoint };
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      const p = pressed;
      pressed = null;
      if (this.lineStart) {
        const start = this.lineStart;
        this.lineStart = null;
        const end = this.lineEnd(start);
        this.hideLine();
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_TOLERANCE && this.placing?.line && e.button === 0) {
          const r = this.sim.buildLine(this.placing.id, start.x, start.z, end.x, end.z);
          if (!r.made) this.sim.emit('notice', r.problem ?? 'No se pudo trazar el muro');
          return; // la herramienta sigue activa: se pueden trazar más tramos
        }
      }
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
    window.addEventListener('keydown', (e) => (e.key === 'Shift' ? (this.shiftDown = true) : null));
    window.addEventListener('keyup', (e) => (e.key === 'Shift' ? (this.shiftDown = false) : null));
    // R gira el edificio 90° al colocarlo o moverlo (Mayús + R, al revés).
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'r' || e.key === 'R') && this.placing && !this.placing.line && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName ?? '')) {
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
    this.ghost.add(this.ghostAccess.group);
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
      const disc = new THREE.Mesh(new THREE.CircleGeometry(d.r, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: DEPOSIT_COLORS[kind], transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 }));
      disc.position.set(d.x, this.sim.heightAt(d.x, d.z) - this.sim.camp.height + 0.2, d.z);
      this.deposits.add(disc);
    }
  }

  stopPlacing() {
    if (!this.placing && !this.ghost.visible) return;
    this.placing = null;
    this.moving = null;
    this.lineStart = null;
    this.hideLine();
    this.candidate = null;
    this.ghost.visible = false;
    this.conflictGroup.visible = false;
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
    // Con la cuadrícula activa el edificio se pega al centro de su casilla (un adorno pequeño, a una malla de 1 m: se pone donde se quiere).
    const placingDef = (this.moving ?? this.placing).def ?? this.placing;
    const step = placingDef.small ? 1 : undefined;
    const gx = this.grid ? this.grid.snap(local.x, step) : local.x;
    const gz = this.grid ? this.grid.snap(local.z, step) : local.z;
    this.groundPoint = { x: gx, z: gz };
    // Los muros no se giran: conservan su orientación (o van a lo largo del eje X).
    // Los demás siempre miran al norte de entrada; "turn" sólo suma giros de 90° exactos
    // (nunca en diagonal, sin importar dónde esté el edificio respecto a la fogata).
    const yaw = ((this.moving ?? this.placing).def ?? this.placing).line ? (this.moving ? this.moving.yaw : 0) : this.turn * (Math.PI / 2);
    let cx = gx, cz = gz, cyaw = yaw;
    const def = (this.moving ?? this.placing).def ?? this.placing;
    if (def.line) {
      // Un muro suelto se pega al extremo libre de otro y toma su orientación (sin huecos).
      const s = this.sim.wallSnapPiece(def, gx, gz, this.moving?.id ?? null);
      if (s) { cx = s.x; cz = s.z; cyaw = s.yaw; }
    }
    this.candidate = { x: cx, z: cz, yaw: cyaw, problem: this.moving ? this.sim.moveProblem(this.moving, cx, cz, cyaw) : this.sim.buildProblem(this.placing, cx, cz, cyaw) };
  }

  // Marca las franjas de acceso de otros edificios que el de la vista previa taparía.
  showConflicts(c) {
    const group = this.conflictGroup;
    const sim = this.sim;
    const def = this.moving ? this.moving.def : this.placing;
    const mine = c && c.problem && def && !def.line ? footprintRect(def, c.x, c.z) : null;
    const hits = mine ? sim.buildings.filter((b) => b !== this.moving && b.entrance && rectsOverlap(b.entrance.zone, mine)) : [];
    group.visible = hits.length > 0;
    while (group.children.length < hits.length) group.add(new THREE.Mesh(this.conflictPlane, this.conflictMaterial));
    group.children.forEach((m, i) => {
      const b = hits[i];
      m.visible = !!b;
      if (!b) return;
      const z = b.entrance.zone;
      m.scale.set(z.x1 - z.x0, 1, z.z1 - z.z0);
      m.position.set((z.x0 + z.x1) / 2, sim.heightAt((z.x0 + z.x1) / 2, (z.z0 + z.z1) / 2) - sim.camp.height + 0.6, (z.z0 + z.z1) / 2);
      m.renderOrder = 5;
    });
    if (group.visible) {
      group.position.copy(sim.camp.position);
      group.quaternion.copy(sim.camp.quaternion);
    }
  }

  // Final de la línea: con Mayús se ajusta a 8 direcciones.
  lineEnd(start) {
    const e = this.groundPoint ?? start;
    if (!this.shiftDown) return e;
    const a = Math.round(Math.atan2(e.z - start.z, e.x - start.x) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(e.x - start.x, e.z - start.z);
    const x = start.x + Math.cos(a) * len;
    const z = start.z + Math.sin(a) * len;
    return this.grid ? { x: this.grid.snap(x), z: this.grid.snap(z) } : { x, z };
  }

  hideLine() {
    for (const m of this.linePool ?? []) m.visible = false;
    this.lineInfo = null;
  }

  // Vista previa del muro: un tramo fantasma por cada uno (verde si se puede, rojo si no).
  updateLine() {
    const def = this.placing;
    const start = this.lineStart;
    if (!def?.line || !start || !this.groundPoint || !this.sim.camp) return this.hideLine();
    const end = this.lineEnd(start);
    const plan = this.sim.wallCheck(def, start.x, start.z, end.x, end.z);
    this.linePool ??= [];
    this.lineMats ??= ['#5fe08a', '#ff5a4f'].map((c) => {
      const m = material.clone();
      m.transparent = true;
      m.opacity = 0.6;
      m.depthWrite = false;
      m.color.set(c);
      return m;
    });
    const level = def.levels[buildLevelFor(def, this.sim.age) - 1];
    while (this.linePool.length < plan.segs.length) {
      const m = levelModel(level.model);
      m.renderOrder = 4;
      this.scene.add(m);
      this.linePool.push(m);
    }
    const camp = this.sim.camp;
    this.linePool.forEach((m, i) => {
      const seg = plan.segs[i];
      m.visible = !!seg;
      if (!seg) return;
      m.material = this.lineMats[seg.problem ? 1 : 0];
      const dir = this.sim.toDirection(seg.x, seg.z, this.tmp);
      m.position.copy(dir).multiplyScalar(RADIUS + this.sim.heightAt(seg.x, seg.z));
      m.quaternion.copy(camp.quaternion).multiply(this.tmpQuat.setFromAxisAngle(Y_AXIS, seg.yaw));
    });
    this.lineInfo = { count: plan.count, total: plan.segs.length, cost: plan.total, problem: plan.segs.find((s) => s.problem)?.problem ?? null };
  }

  // Mover un edificio: se elige el nuevo sitio como al construir (sin coste).
  startMoving(b) {
    this.startPlacing(b.def.id);
    this.moving = b;
    // Al mover parte de su orientación actual (R la gira), redondeada al cuarto de vuelta más cercano.
    this.turn = Math.round(b.yaw / (Math.PI / 2));
    this.turn = ((this.turn % 4) + 4) % 4;
    this.ghost.remove(...this.ghost.children.filter((o) => o !== this.ghostRing));
    const model = levelModel(levelOf(b).model);
    model.material = material.clone();
    model.material.transparent = true;
    model.material.opacity = 0.55;
    model.material.depthWrite = false;
    this.ghost.add(model);
    this.ghost.add(this.ghostAccess.group);
    this.ghostAccess.key = null;
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
    // Los adornos pequeños se ponen uno tras otro: la herramienta sigue activa (Esc para terminar).
    if (this.placing.small) return;
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
      if (e.level !== b.level || !!e.gate !== !!b.gate) {
        e.gate = !!b.gate;
        // La mejora cambia el nivel, el nombre y el modelo.
        e.level = b.level;
        e.object.remove(e.model);
        releaseModel(e.model);
        e.model = levelModel(b.gate ? `gen:gate:${levelOf(b).age}` : levelOf(b).model, modelVariant(b.x, b.z, b.def.id, b.level));
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
    if (b.zone) this.terrain.invalidateZone(b.zone);
    const object = new THREE.Group();
    object.position.copy(b.dir).multiplyScalar(RADIUS + b.height);
    object.quaternion.copy(this.sim.camp.quaternion).multiply(this.tmpQuat.setFromAxisAngle(Y_AXIS, b.yaw));
    const model = levelModel(levelOf(b).model, modelVariant(b.x, b.z, b.def.id, b.level));
    const frame = frameMesh(b.def.footprint);
    object.add(model, frame);
    // La cocina del comedor echa humo de verdad mientras alguien come o bebe dentro.
    if (b.def.id === 'dining_hall') addChimneySmoke(object, () => b.done && !b.removed && eatingNow(this.sim, b) > 0);
    // La antorcha arde en cuanto está terminada (llama titilante, halo y luz de noche).
    if (b.def.id === 'torch') addTorchFlame(object, levelOf(b).flame ?? 1.55, () => b.done && !b.removed);
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
    releaseModel(e.object);
    e.label.remove();
    if (e.b.zone) this.terrain.invalidateZone(e.b.zone);
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
    this.rangeRing.removeFromParent();
    this.selectedAccess.group.removeFromParent();
    const view = this.viewOf(b);
    if (view) {
      view.label.classList.add('is-selected');
      this.selectRing.scale.setScalar(b.def.footprint + 0.8);
      view.object.add(this.selectRing);
      if (!b.isStore && b.entrance) {
        this.selectedAccess.key = null;
        view.object.add(this.selectedAccess.group);
      }
      if (b.def.range) {
        this.rangeRing.scale.setScalar(b.def.range);
        view.object.add(this.rangeRing);
      }
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
      if (this.placing.line) this.updateLine();
      const c = this.candidate;
      this.ghost.visible = !!c;
      if (c) {
        const sim = this.sim;
        const dir = sim.toDirection(c.x, c.z, this.tmp);
        this.ghost.position.copy(dir).multiplyScalar(RADIUS + sim.heightAt(c.x, c.z));
        this.ghost.quaternion.copy(sim.camp.quaternion).multiply(this.tmpQuat.setFromAxisAngle(Y_AXIS, c.yaw ?? Math.atan2(-c.x, -c.z)));
        this.ghostRing.material.color.set(c.problem ? '#ff5a4f' : '#5fe08a');
        this.showConflicts(c);
        // Huella, franja de acceso y flecha de la puerta (se ven al girar con R y explican el conflicto).
        const key = `${(this.moving ?? this.placing).def?.id ?? this.placing.id}|${c.problem ?? ''}`;
        if (this.ghostAccess.key !== key) {
          this.ghostAccess.key = key;
          this.ghostAccess.set((this.moving ?? this.placing).def ?? this.placing, c.problem);
        }
      }
    }
    for (const e of this.entries.values()) this.updateVisual(e);
    // La entrada del edificio elegido: celeste si está libre, naranja si algo la bloquea.
    const sel = this.selected;
    if (sel && !sel.isStore && sel.entrance) {
      const key = `${sel.id}|${sel.accessIssue ?? ''}`;
      if (this.selectedAccess.key !== key) {
        this.selectedAccess.key = key;
        this.selectedAccess.set(sel.def, null, sel.accessIssue);
      }
    }
    this.updateLabels();
  }

  // Texto bajo el nombre de un edificio terminado.
  labelOf(b) {
    const lv = levelOf(b);
    const needed = this.sim.crewNeeded(b);
    if (b.accessIssue) return '⚠ Entrada bloqueada';
    if (typeof lv.capacity === 'object') return 'Almacén';
    if (lv.seats) return `Comedor · ${eatingNow(this.sim, b)}/${lv.seats} comiendo`;
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
      const attention = !b.isStore && (!b.done || !!b.status || !!b.accessIssue || (needed > 0 && b.workers.length < needed));
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
      label.classList.toggle('is-issue', !!b.accessIssue);
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
