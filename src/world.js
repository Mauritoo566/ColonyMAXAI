import * as THREE from 'three';
import { RADIUS, surfaceHeight, naturalSurfaceHeight, removeTerrainZone } from './elevation.js';
import { buildCamp } from './camp.js';
import { buildingModel } from './buildings.js';
import { ageInfo } from './ages.js';

// Mundo compartido. Cuando el juego se abre como página publicada en claude.ai, la
// página tiene una base de datos compartida (capacidad "db"): ese es el servidor del
// planeta. Cada jugador tiene un documento world/<su id> con su nombre, su campamento,
// su edad y sus edificios; todos se suscriben a la colección "world" y ven aparecer los
// campamentos de los demás en tiempo real. Sin esa base de datos (la página abierta
// desde GitHub o un servidor local) el juego funciona igual, pero solo.

const CONNECT_TIMEOUT_MS = 12_000;
const LABEL_MAX_DISTANCE = 400_000; // metros: más lejos no se muestra el nombre
const MODEL_MAX_DISTANCE = 30_000; // metros: más lejos no se dibujan sus edificios

// Conecta con el servidor del mundo, o null si esta página no tiene uno.
export async function connectWorld() {
  if (!window.claude?.use) return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve([null, null]), CONNECT_TIMEOUT_MS));
  const [db, user] = await Promise.race([Promise.all([window.claude.use('db'), window.claude.use('user')]), timeout]);
  if (!db || !user) return null;
  const uid = await user.id();
  if (!uid) return null;
  return new WorldClient(db, uid);
}

export class WorldClient {
  constructor(db, uid) {
    this.db = db;
    this.uid = uid;
    this.readOnly = false; // sin permiso de escritura: sólo se mira
    this.lastJson = null;
    this.writing = null;
  }

  get myRef() {
    return this.db.doc(`world/${this.uid}`);
  }

  async me() {
    const snap = await this.myRef.get();
    return snap.exists ? snap.data() : null;
  }

  // Registro: nombre de jugador único en el mundo.
  async register(name) {
    name = name.trim();
    if (!/^[\p{L}\p{N}_ .-]{3,20}$/u.test(name)) throw new Error('El nombre debe tener de 3 a 20 letras, números, espacios, puntos o guiones.');
    const nameLc = name.toLowerCase();
    const taken = await this.db.collection('world').where('nameLc', '==', nameLc).limit(1).get();
    if (!taken.empty && taken.docs[0].id !== this.uid) throw new Error('Ese nombre ya lo usa otro jugador.');
    const data = { name, nameLc, joinedAt: Date.now(), camp: null, age: 1, population: 0, buildings: [] };
    try {
      await this.myRef.set(data);
    } catch (e) {
      if (e?.code === 'invalid_argument') {
        throw new Error('No tienes permiso para unirte a este mundo. Pide al dueño que te dé acceso de Colaborador o Editor.');
      }
      throw new Error('No se pudo conectar con el mundo. Prueba de nuevo.');
    }
    this.lastJson = JSON.stringify(data);
    return name;
  }

  // Publica el estado de este jugador, sólo si cambió (una escritura a la vez).
  async publish(state) {
    if (this.readOnly) return;
    const json = JSON.stringify(state);
    if (json === this.lastJson || this.writing) return;
    this.writing = this.myRef.update({ ...state, updatedAt: Date.now() });
    try {
      await this.writing;
      this.lastJson = json;
    } catch (e) {
      if (e?.code === 'invalid_argument' || e?.code === 'revoked') this.readOnly = true;
    } finally {
      this.writing = null;
    }
  }

  // Todos los jugadores, en vivo. onChange recibe [{ id, data }] cada vez que algo cambia.
  subscribe(onChange) {
    return this.db.collection('world').onSnapshot(
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, data: d.data() }))),
      () => onChange(null),
    );
  }
}

// ---------------------------------------------------------------------------
// Campamentos de los demás jugadores
// ---------------------------------------------------------------------------

export class OtherCamps {
  constructor({ scene, terrain, camera, canvas, labelsRoot, myId }) {
    this.scene = scene;
    this.terrain = terrain;
    this.camera = camera;
    this.canvas = canvas;
    this.labelsRoot = labelsRoot;
    this.myId = myId;
    this.camps = new Map(); // id -> { key, object, zone, dir, label, buildingsKey, buildings }
    this.players = []; // [{ id, name, camp, age, population }] para la lista del mundo
    this.tmp = new THREE.Vector3();
    this.onPlayers = null;
  }

  // Lista de { dir } para no fundar demasiado cerca de otro.
  campList() {
    return [...this.camps.values()].map((c) => ({ dir: c.dir }));
  }

  sync(docs) {
    if (!docs) return;
    const seen = new Set();
    this.players = [];
    for (const { id, data } of docs) {
      if (!data || typeof data.name !== 'string') continue;
      const camp = parseCamp(data.camp);
      this.players.push({ id, name: data.name.slice(0, 20), camp, age: data.age | 0 || 1, population: data.population | 0, isMe: id === this.myId });
      if (id === this.myId || !camp) continue;
      seen.add(id);
      this.upsert(id, data, camp);
    }
    for (const id of [...this.camps.keys()]) if (!seen.has(id)) this.remove(id);
    this.onPlayers?.(this.players);
  }

  upsert(id, data, camp) {
    const key = `${camp.dir.x},${camp.dir.y},${camp.dir.z},${camp.yaw}`;
    let entry = this.camps.get(id);
    if (entry && entry.key !== key) {
      this.remove(id);
      entry = null;
    }
    if (!entry) {
      const { object, zone } = buildCamp(camp.dir, camp.height, camp.yaw, this.terrain, { resourceClear: 45 });
      this.scene.add(object);
      const label = document.createElement('div');
      label.className = 'camp-marker camp-marker--other';
      label.innerHTML = '<span class="camp-marker-label"><strong></strong><small></small></span><span class="camp-marker-pin"></span>';
      label.hidden = true;
      this.labelsRoot.appendChild(label);
      entry = { key, object, zone, dir: camp.dir, height: camp.height, label, buildingsKey: '', buildings: new THREE.Group() };
      object.add(entry.buildings);
      this.camps.set(id, entry);
    }
    entry.label.querySelector('strong').textContent = data.name.slice(0, 20);
    entry.label.querySelector('small').textContent = ` · ${ageInfo(data.age | 0 || 1).name} · ${data.population | 0} colonos`;
    // Edificios (en coordenadas de su campamento).
    const list = Array.isArray(data.buildings) ? data.buildings.slice(0, 80) : [];
    const buildingsKey = JSON.stringify(list);
    if (buildingsKey !== entry.buildingsKey) {
      entry.buildingsKey = buildingsKey;
      this.buildBuildings(entry, list);
    }
  }

  buildBuildings(entry, list) {
    const group = entry.buildings;
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose();
    }
    const object = entry.object;
    object.updateMatrixWorld(true);
    for (const b of list) {
      if (![b.x, b.z].every(Number.isFinite) || Math.hypot(b.x, b.z) > 200) continue;
      const mesh = buildingModel(b.t, b.l, b.d !== false);
      if (!mesh) continue;
      // Altura del terreno en ese punto, relativa al campamento.
      const world = this.tmp.set(b.x, 0, b.z).applyMatrix4(object.matrixWorld).normalize();
      mesh.position.set(b.x, surfaceHeight(world) - entry.height, b.z);
      mesh.rotation.y = Number.isFinite(b.yaw) ? b.yaw : 0;
      group.add(mesh);
    }
  }

  remove(id) {
    const entry = this.camps.get(id);
    if (!entry) return;
    this.scene.remove(entry.object);
    entry.object.traverse((o) => o.geometry?.dispose());
    removeTerrainZone(entry.zone);
    this.terrain.invalidateZone(entry.zone);
    entry.label.remove();
    this.camps.delete(id);
  }

  // Cada fotograma: nombres sobre los campamentos y edificios sólo si están cerca.
  update() {
    const cam = this.camera.position;
    const camR = cam.length();
    const rect = this.canvas.getBoundingClientRect();
    for (const entry of this.camps.values()) {
      const markerR = RADIUS + entry.height + 14;
      const pos = this.tmp.copy(entry.dir).multiplyScalar(markerR);
      const dist = cam.distanceTo(pos);
      entry.buildings.visible = dist < MODEL_MAX_DISTANCE;
      const horizon = Math.acos(Math.min(1, RADIUS / camR)) + Math.acos(Math.min(1, RADIUS / markerR));
      const behind = cam.clone().divideScalar(camR).angleTo(entry.dir) > horizon;
      pos.project(this.camera);
      const hidden = behind || dist > LABEL_MAX_DISTANCE || pos.z > 1 || Math.abs(pos.x) > 1.1 || Math.abs(pos.y) > 1.1;
      entry.label.hidden = hidden;
      if (hidden) continue;
      const x = rect.left + ((pos.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - pos.y) / 2) * rect.height;
      entry.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }
}

function parseCamp(c) {
  if (!c || ![c.x, c.y, c.z].every(Number.isFinite)) return null;
  const dir = new THREE.Vector3(c.x, c.y, c.z);
  if (dir.lengthSq() < 1e-6) return null;
  dir.normalize();
  // La altura se calcula aquí (el terreno es el mismo para todos) en lugar de confiar en
  // la guardada: así el campamento nunca queda enterrado ni flotando.
  return { dir, yaw: Number.isFinite(c.yaw) ? c.yaw : 0, height: naturalSurfaceHeight(dir) };
}
