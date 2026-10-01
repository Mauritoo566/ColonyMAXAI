import * as THREE from 'three';
import { RADIUS, surfaceHeight, naturalSurfaceHeight, removeTerrainZone } from './elevation.js';
import { buildCamp } from './camp.js';
import { buildingModel } from './buildings.js';
import { ageInfo } from './ages.js';
import { ColonySim } from './sim/colony.js';
import { ColonyView } from './colonists.js';
import { WeatherState } from './sim/weather.js';

// Los demás jugadores del mundo: sus campamentos, sus edificios y sus colonos, en vivo.
// El servidor manda la lista de jugadores (con campamento, edad, población y edificios) y,
// de las colonias que están cerca de lo que mira la cámara, dónde está cada colono varias
// veces por segundo. Los colonos de cada colonia ajena salen de una copia de su
// simulación (misma semilla: mismos nombres y aspecto) que sólo refleja lo que llega.

const LABEL_FULL_DISTANCE = 400_000; // metros: más lejos el punto sigue, pero sólo con el nombre
const MODEL_MAX_DISTANCE = 30_000; // metros: más lejos no se dibujan sus edificios ni colonos

export class OtherCamps {
  constructor({ scene, terrain, camera, canvas, labelsRoot }) {
    this.scene = scene;
    this.terrain = terrain;
    this.camera = camera;
    this.canvas = canvas;
    this.labelsRoot = labelsRoot;
    this.myId = null;
    this.camps = new Map(); // id del jugador -> { key, object, zone, dir, label, buildings, sim, view }
    this.players = []; // [{ id, name, online, camp, age, population, isMe }] para la lista del mundo
    this.tmp = new THREE.Vector3();
    this.onPlayers = null;
  }

  // Lista de { dir } para no fundar demasiado cerca de otro.
  campList() {
    return [...this.camps.values()].map((c) => ({ dir: c.dir }));
  }

  // list: jugadores tal como los manda el servidor.
  sync(list) {
    const seen = new Set();
    this.players = [];
    for (const p of list) {
      if (typeof p?.name !== 'string') continue;
      const camp = parseCamp(p.camp);
      const isMe = p.id === this.myId;
      this.players.push({ id: p.id, name: p.name.slice(0, 20), online: !!p.online, camp, age: p.age | 0 || 1, population: p.population | 0, weather: typeof p.w === 'string' ? p.w : null, isMe });
      if (isMe || !camp) continue;
      seen.add(p.id);
      this.upsert(p, camp);
    }
    for (const id of [...this.camps.keys()]) if (!seen.has(id)) this.remove(id);
    this.onPlayers?.(this.players);
  }

  upsert(p, camp) {
    const key = `${camp.dir.x},${camp.dir.y},${camp.dir.z},${camp.yaw}`;
    let entry = this.camps.get(p.id);
    if (entry && entry.key !== key) {
      this.remove(p.id);
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
      // Copia de su simulación (sólo para sus colonos) y su vista; nadie los puede elegir.
      const sim = new ColonySim();
      const view = new ColonyView({ scene: this.scene, camera: this.camera, canvas: this.canvas, labelsRoot: this.labelsRoot, sim, campObject: () => object, selectable: false });
      sim.setCamp(camp);
      entry = { key, object, zone, dir: camp.dir, height: camp.height, label, buildingsKey: '', buildings: new THREE.Group(), sim, view, weather: new WeatherState(1) };
      object.add(entry.buildings);
      this.camps.set(p.id, entry);
    }
    entry.label.querySelector('strong').textContent = p.name.slice(0, 20);
    entry.label.querySelector('small').textContent = ` · ${ageInfo(p.age | 0 || 1).name} · ${p.population | 0} colonos${p.online ? '' : ' · desconectado'}`;
    // Edificios (en coordenadas de su campamento).
    const list = Array.isArray(p.buildings) ? p.buildings.slice(0, 80) : [];
    const buildingsKey = JSON.stringify(list);
    if (buildingsKey !== entry.buildingsKey) {
      entry.buildingsKey = buildingsKey;
      this.buildBuildings(entry, list);
    }
  }

  // Dónde están ahora los colonos de otro jugador y cómo está el clima en su zona
  // (mensaje "other" del servidor, dos veces por segundo mientras está cerca).
  applyColonists(id, msg) {
    const entry = this.camps.get(id);
    if (!entry) return;
    entry.sim.applySnapshot(msg, 'fast');
    if (msg.w) entry.weather.loadBrief(msg.w);
  }

  // El clima del campamento ajeno más cercano a un punto del planeta: { weather, distance }
  // (distancia en metros sobre la superficie), o null si no hay ninguno.
  nearestWeather(dir) {
    let best = null;
    for (const entry of this.camps.values()) {
      const distance = entry.dir.angleTo(dir) * RADIUS;
      if (!best || distance < best.distance) best = { weather: entry.weather, distance };
    }
    return best;
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
    entry.view.dispose();
    this.scene.remove(entry.object);
    entry.object.traverse((o) => o.geometry?.dispose());
    removeTerrainZone(entry.zone);
    this.terrain.invalidateZone(entry.zone);
    entry.label.remove();
    this.camps.delete(id);
  }

  // Cada fotograma: nombres sobre los campamentos; edificios y colonos sólo si están cerca.
  update(delta) {
    const cam = this.camera.position;
    const camR = cam.length();
    const rect = this.canvas.getBoundingClientRect();
    for (const entry of this.camps.values()) {
      const markerR = RADIUS + entry.height + 14;
      const pos = this.tmp.copy(entry.dir).multiplyScalar(markerR);
      const dist = cam.distanceTo(pos);
      const near = dist < MODEL_MAX_DISTANCE;
      entry.buildings.visible = near;
      entry.view.group.visible = near;
      if (near) entry.view.update(delta, delta);
      else entry.view.hideLabels();
      const horizon = Math.acos(Math.min(1, RADIUS / camR)) + Math.acos(Math.min(1, RADIUS / markerR));
      const behind = cam.clone().divideScalar(camR).angleTo(entry.dir) > horizon;
      pos.project(this.camera);
      // El punto del campamento se ve siempre (a cualquier distancia) mientras no esté
      // detrás del planeta ni fuera de la pantalla; de lejos se acorta a sólo el nombre.
      const hidden = behind || pos.z > 1 || Math.abs(pos.x) > 1.1 || Math.abs(pos.y) > 1.1;
      entry.label.hidden = hidden;
      if (hidden) continue;
      entry.label.classList.toggle('is-far', dist > LABEL_FULL_DISTANCE);
      const x = rect.left + ((pos.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - pos.y) / 2) * rect.height;
      entry.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }
}

function parseCamp(c) {
  if (!c?.dir || ![c.dir.x, c.dir.y, c.dir.z].every(Number.isFinite)) return null;
  const dir = new THREE.Vector3(c.dir.x, c.dir.y, c.dir.z);
  if (dir.lengthSq() < 1e-6) return null;
  dir.normalize();
  // La altura se calcula aquí (el terreno es el mismo para todos) en lugar de confiar en
  // la recibida: así el campamento nunca queda enterrado ni flotando.
  return { dir, yaw: Number.isFinite(c.yaw) ? c.yaw : 0, height: naturalSurfaceHeight(dir), seed: c.seed ?? 1 };
}
