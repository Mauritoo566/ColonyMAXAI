import * as THREE from 'three';
import { RADIUS, surfaceHeight, naturalSurfaceHeight, removeTerrainZone } from './elevation.js';
import { buildCamp, applyFlag } from './camp.js';
import { buildingModel } from './buildings.js';
import { releaseModel } from './buildingModels.js';
import { ageInfo } from './ages.js';
import { ColonySim } from './sim/colony.js';
import { ColonyView } from './colonists.js';
import { WeatherState } from './sim/weather.js';
import { roadMaterials, buildRoadGeometry, roadTerminals, footprintBlockers } from './roadMesh.js';
import { BUILDINGS } from './sim/buildingTypes.js';
import { ROAD_LEVELS } from './sim/economy.js';
import { generateCampGrove, tileFromItems } from './resourceGen.js';
import { biomeAt } from './biomes.js';
import { eatingNow } from './sim/dining.js';
import { addChimneySmoke } from './chimneySmoke.js';
import { addTorchFlame } from './torchFlames.js';

// Los demás jugadores del mundo: sus campamentos, sus edificios y sus colonos, en vivo.
// El servidor manda la lista de jugadores (con campamento, edad, población y edificios) y,
// de las colonias que están cerca de lo que mira la cámara, dónde está cada colono varias
// veces por segundo. Los colonos de cada colonia ajena salen de una copia de su
// simulación (misma semilla: mismos nombres y aspecto) que sólo refleja lo que llega.

const LABEL_FULL_DISTANCE = 400_000; // metros: más lejos el punto sigue, pero sólo con el nombre
const MODEL_MAX_DISTANCE = 30_000; // metros: más lejos no se dibujan sus edificios ni colonos

export class OtherCamps {
  constructor({ scene, terrain, camera, canvas, labelsRoot, resources }) {
    this.scene = scene;
    this.terrain = terrain;
    this.camera = camera;
    this.canvas = canvas;
    this.labelsRoot = labelsRoot;
    this.resources = resources;
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
      this.players.push({ id: p.id, name: p.name.slice(0, 20), village: typeof p.village === 'string' ? p.village.slice(0, 28) : null, online: !!p.online, camp, age: p.age | 0 || 1, population: p.population | 0, weather: typeof p.w === 'string' ? p.w : null, flag: typeof p.flag === 'string' ? p.flag : null, isMe });
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
      const roadMeshes = roadMaterials(ROAD_LEVELS.length).map((m) => new THREE.Mesh(new THREE.BufferGeometry(), m));
      const roadsGroup = new THREE.Group();
      for (const m of roadMeshes) roadsGroup.add(m);
      entry = { seed: camp.seed, name: p.name.slice(0, 20), key, object, zone, dir: camp.dir, height: camp.height, label, buildingsKey: '', buildings: new THREE.Group(), sim, view, weather: new WeatherState(1), roadMeshes, roadsDirty: true };
      object.add(entry.buildings);
      object.add(roadsGroup);
      sim.on('roads', () => (entry.roadsDirty = true));
      this.camps.set(p.id, entry);
    }
    if (entry.flag !== p.flag) {
      entry.flag = p.flag;
      applyFlag(entry.object, p.flag);
    }
    entry.name = p.name.slice(0, 20);
    entry.village = typeof p.village === 'string' && p.village ? p.village.slice(0, 28) : null;
    // Lo que se ve sobre la aldea es su nombre; el del jugador va aparte (si no tiene nombre de aldea, el del jugador).
    entry.label.querySelector('strong').textContent = entry.village ?? entry.name;
    entry.label.querySelector('small').textContent = ` · ${entry.village ? `de ${entry.name} · ` : ''}${ageInfo(p.age | 0 || 1).name} · ${p.population | 0} colonos${p.online ? '' : ' · desconectado'}`;
    // Edificios (en coordenadas de su campamento).
    const list = Array.isArray(p.buildings) ? p.buildings.slice(0, 80) : [];
    const buildingsKey = JSON.stringify(list);
    if (buildingsKey !== entry.buildingsKey) {
      entry.buildingsKey = buildingsKey;
      this.buildBuildings(entry, list);
      entry.terminals = roadTerminals(list.filter((b) => BUILDINGS[b.t]).map((b) => ({ def: BUILDINGS[b.t], x: b.x, z: b.z, yaw: b.yaw })));
      entry.blockers = footprintBlockers(list.filter((b) => BUILDINGS[b.t]).map((b) => ({ def: BUILDINGS[b.t], x: b.x, z: b.z })));
      entry.roadsDirty = true;
    }
  }

  // Dónde están ahora los colonos de otro jugador y cómo está el clima en su zona
  // (mensaje "other" del servidor, dos veces por segundo mientras está cerca).
  applyColonists(id, msg) {
    const entry = this.camps.get(id);
    if (!entry) return;
    entry.sim.applySnapshot(msg, 'fast');
    if (msg.w) entry.weather.loadBrief(msg.w);
    // Lo que esta colonia ya taló o picó: que tampoco se vea desde afuera.
    if (msg.removed) this.resources?.mergeRemoved(msg.removed);
    this.applyExtras(id, entry, msg);
  }

  // La arboleda de una aldea ajena (sale de su semilla, igual que en el servidor) y sus brotes: lo que
  // sus colonos recolectan tiene que verse también desde aquí. Cada aldea usa claves propias.
  applyExtras(id, entry, msg) {
    const res = this.resources;
    if (!res) return;
    const groveKey = -1000 - id * 2;
    const sproutKey = -1001 - id * 2;
    entry.extraKeys = [groveKey, sproutKey];
    if (!entry.grove) {
      const d = entry.dir;
      entry.grove = generateCampGrove(d.x, d.y, d.z, biomeAt(d.x, d.y, d.z).id, entry.seed ?? 1);
      res.setExtraTile(groveKey, entry.grove);
    }
    if (Array.isArray(msg.groveRemoved)) {
      const set = new Set(msg.groveRemoved);
      if (!sameSet(res.removed.get(groveKey), set)) {
        res.removed.set(groveKey, set);
        res.dirty = true;
      }
    }
    // La hora de esa colonia: los brotes que plantó crecen con ella, no con la de quien mira.
    if (Number.isFinite(msg.gameTime)) res.setClock(sproutKey, msg.gameTime);
    if (Array.isArray(msg.sprouts)) {
      res.setExtraTile(sproutKey, msg.sprouts.length ? tileFromItems(msg.sprouts) : null);
      const set = new Set(msg.sproutRemoved ?? []);
      if (!sameSet(res.removed.get(sproutKey), set)) res.removed.set(sproutKey, set);
    }
  }

  // El clima del campamento ajeno más cercano a un punto del planeta: { weather, distance }
  // (distancia en metros sobre la superficie), o null si no hay ninguno.
  nearestWeather(dir) {
    let best = null;
    for (const entry of this.camps.values()) {
      const distance = entry.dir.angleTo(dir) * RADIUS;
      if (!best || distance < best.distance) best = { weather: entry.weather, distance, name: entry.name, village: entry.village };
    }
    return best;
  }

  buildBuildings(entry, list) {
    const group = entry.buildings;
    for (const child of [...group.children]) {
      group.remove(child);
      releaseModel(child);
    }
    const object = entry.object;
    object.updateMatrixWorld(true);
    for (const b of list) {
      // 300 m: cubre el territorio máximo (200 m + 6 ampliaciones de 12 m = 272 m) con margen.
      if (![b.x, b.z].every(Number.isFinite) || Math.hypot(b.x, b.z) > 300) continue;
      const mesh = buildingModel(b.t, b.l, b.d !== false, b.x, b.z);
      if (!mesh) continue;
      // Altura del terreno en ese punto, relativa al campamento.
      const world = this.tmp.set(b.x, 0, b.z).applyMatrix4(object.matrixWorld).normalize();
      mesh.position.set(b.x, surfaceHeight(world) - entry.height, b.z);
      mesh.rotation.y = Number.isFinite(b.yaw) ? b.yaw : 0;
      group.add(mesh);
      // El humo de su cocina, igual que lo ve su dueño: sale mientras hay alguien dentro.
      // Y las antorchas de su aldea arden igual que para su dueño.
      if (b.t === 'torch' && b.d !== false) addTorchFlame(mesh, BUILDINGS.torch.levels[0].flame, () => true);
      if (b.t === 'dining_hall' && b.d !== false) addChimneySmoke(mesh, () => eatingNow(entry.sim, { x: b.x, z: b.z }) > 0);
    }
  }

  remove(id) {
    const entry = this.camps.get(id);
    if (!entry) return;
    entry.view.dispose();
    for (const k of entry.extraKeys ?? []) {
      this.resources?.setExtraTile(k, null);
      this.resources?.removed.delete(k);
      this.resources?.clocks.delete(k);
    }
    this.scene.remove(entry.object);
    releaseModel(entry.object);
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
      if (near) {
        entry.view.update(delta, delta);
        if (entry.roadsDirty) {
          entry.roadsDirty = false;
          entry.roadMeshes.forEach((mesh, k) => {
            mesh.geometry.dispose();
            mesh.geometry = buildRoadGeometry(entry.sim.roads, k + 1, (x, z) => entry.sim.heightAt(x, z) - entry.height, entry.terminals, entry.blockers);
          });
        }
      } else entry.view.hideLabels();
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

const sameSet = (a, b) => !!a && a.size === b.size && [...b].every((v) => a.has(v));

function parseCamp(c) {
  if (!c?.dir || ![c.dir.x, c.dir.y, c.dir.z].every(Number.isFinite)) return null;
  const dir = new THREE.Vector3(c.dir.x, c.dir.y, c.dir.z);
  if (dir.lengthSq() < 1e-6) return null;
  dir.normalize();
  // La altura se calcula aquí (el terreno es el mismo para todos) en lugar de confiar en
  // la recibida: así el campamento nunca queda enterrado ni flotando.
  return { dir, yaw: Number.isFinite(c.yaw) ? c.yaw : 0, height: naturalSurfaceHeight(dir), seed: c.seed ?? 1 };
}
