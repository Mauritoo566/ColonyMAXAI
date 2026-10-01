import * as THREE from 'three';
import { RADIUS, surfaceHeight, elevation, addTerrainZone, removeTerrainZone } from '../elevation.js';
import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { AGES, ageInfo, nextAgeStatus } from '../ages.js';
import { insideRect, rectDistance, upgradeRect } from '../rect.js';
import { temperature, biomeAt, BIOMES } from '../biomes.js';
import { createProfile, updateNeeds, hasTrait, wellbeing, addLog, SKILLS, TRAITS } from '../needs.js';
import { appearanceFromGenes, gene } from '../genes.js';
import { RESOURCE_TYPES } from '../resourceTypes.js';
import { TILE_ANGLE, generateTile, generateCampGrove, GROVE_KEY, SPROUT_KEY, sproutItem, tileFromItems } from '../resourceGen.js';
import { chooseTask, shouldSwitch, runTask, endTask, taskActivity, taskLog, taskKey } from '../ai.js';
import { campLayout, campObstacles, campZone } from './campLayout.js';
import { BUILDINGS, levelOf, STOCK_NAMES } from './buildingTypes.js';
import { WeatherState } from './weather.js';
import { pickName } from './names.js';
import { FLAG_IDS, DEFAULT_FLAG } from '../flags.js';
import { updateFamily, assignHomes, maxPopulation } from './family.js';

// Simulación de una colonia: colonos (necesidades, genes, IA), edificios, almacén, zona
// de acopio, recursos del entorno, edades y guardado. No dibuja nada ni toca la página:
// usa sólo matemática de Three.js, así que corre igual en el navegador y en el servidor
// (Node). Lo que se ve lo pone la vista (colonists.js y buildings.js), que escucha los
// eventos de aquí (on/emit) y lee el estado.
//
// Cada colono se mueve en el plano local del campamento (x, z en metros, la fogata en el
// origen). La altura sale del terreno real, con una caché en rejilla.

export const START_COLONISTS = 5;
// Provisiones con las que llega la colonia (comidas, jarras de agua, madera, piedra).
export const START_STOCK = { food: 12, water: 12, wood: 45, stone: 20, fiber: 10 };
// Lo que cabe en el almacén del campamento (las vasijas y cestas junto a la fogata).
// Cada almacén construido suma su capacidad.
export const CAMP_CAPACITY = { food: 40, water: 30, wood: 60, stone: 40, fiber: 30 };
// Zona de acopio al aire libre (una sola, rectangular y del tamaño que se quiera): guarda
// lo que no cabe bajo techo. Cabe más cuanto más grande es (unidades por m²), pero la
// comida al aire libre se pudre.
export const ZONE_PER_M2 = 1.5;
export const MIN_ZONE_SIDE = 2; // metros: más chico no tiene sentido
export const FOOD_SPOIL_SECONDS = 1.5 * DAY_LENGTH_SECONDS; // día y medio de juego
export const SAVE_VERSION = 2; // 2: además guarda colonos, recursos agotados y el reloj
export const BUILD_MAX_DISTANCE = 75; // metros desde la fogata donde se puede construir

// Lugares fijos del campamento (coordenadas locales).
// Al fundar el campamento hay ropa en el suelo para todos; cada colono va a buscar la
// suya cuando tiene frío. Sin ropa se enfrían mucho más.
export const CLOTHES_SPOT = { x: Math.cos(0.55) * 7.2, z: Math.sin(0.55) * 7.2 };
// Tótem de la tribu (llega con la Edad Tribal), junto a la fogata.
export const TOTEM_SPOT = { x: Math.cos(4.6) * 7, z: Math.sin(4.6) * 7 };

const WALK_SPEED = 1.4; // m/s
export const COLONIST_RADIUS = 0.45;
const WANDER = [6, 70]; // pasean por el claro y sus alrededores (metros desde la fogata)
const HEIGHT_CELL = 2; // metros por celda de la caché de alturas
const MAX_STEP = 0.1; // segundos por paso de simulación
const FIRE_WARMTH_RADIUS = 7; // metros: la fogata calienta a quien esté más cerca
const COMPANY_RADIUS = 5; // metros: a esta distancia se hacen compañía
const MAX_STEPS_PER_UPDATE = 80; // tope de pasos de simulación por llamada (a ×60)
const SPOT_RADIUS = 230; // metros: recursos que los colonos conocen alrededor del campamento
const CAMP_CLEAR = 45; // alrededor del campamento no hay recursos naturales (resources.js)
const REGROW_SECONDS = 1.5 * DAY_LENGTH_SECONDS; // las bayas y setas vuelven a crecer en día y medio
const MAX_SPROUTS = 50; // vegetación nueva que puede brotar con la lluvia
const SPROUT_EVERY = 25; // segundos de juego entre brotes con lluvia fuerte
const ASSIGN_EVERY = 1; // segundos entre repasos de trabajadores libres
// Qué recursos naturales sirven para qué.
const SPOT_KINDS = {
  food: ['berryBush', 'mushrooms'],
  wood: ['broadleaf', 'pine', 'jungleTree', 'acacia', 'palm'],
  stone: ['stone', 'flint'],
};

// Ropa de pieles (Edad Primitiva): tonos de cuero y piel curtida.
const SHIRTS = ['#8a5a34', '#a0764a', '#b8905a', '#7a5230', '#9a6a3e', '#c2a06a'];
const PANTS = ['#5a3a22', '#6b4a2e', '#4a3220', '#7a5a3a'];

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Números al azar repetibles (el mismo generador que modelKit.js: los colonos de un
// campamento salen siempre iguales).
export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function zoneCapacity(zone) {
  return Math.round(4 * zone.hw * zone.hd * ZONE_PER_M2);
}

export class ColonySim {
  constructor() {
    this.listeners = {};
    this.colonists = [];
    this.camp = null; // { dir, height, yaw, seed, position, quaternion }
    this.buildings = [];
    this.nextBuildingId = 1;
    this.spots = []; // recursos naturales cercanos
    this.removed = new Map(); // baldosa -> índices de recursos que ya no están (talados, picados)
    this.groveTile = null; // arboleda del campamento (resourceGen.js)
    this.sproutTile = null; // lo que brotó con la lluvia
    this.stock = { food: 0, water: 0, wood: 0, stone: 0 }; // almacén de la colonia
    this.gameTime = 0;
    this.age = 1; // edad de la colonia (ages.js)
    this.weather = null; // WeatherSystem: la lluvia acelera lo que crece y enfría
    this.sprouts = []; // brotes de la lluvia (se guardan)
    this.zones = []; // zona de acopio al aire libre (rectángulo girado, rect.js)
    this.outdoor = {}; // lo guardado al aire libre (parte de stock)
    this.foodBatches = []; // comida al aire libre: [{ amount, expires }]
    this.spoiled = 0; // comida perdida por pudrirse
    this.sproutTimer = 0;
    this.assignTimer = 0;
    this.clothesLeft = 0;
    this.flag = DEFAULT_FLAG; // bandera del mástil (flags.js)
    this.nextColonistId = START_COLONISTS;
    this.staticsRevision = 0; // sube con cada nacimiento (el servidor manda entonces los datos fijos)
    this.birthRand = seededRandom(1);
    this.layout = campLayout();
    this.campTemperature = 0.5;
    this.obstacles = campObstacles();
    this.heights = new Map();
    this.timeLabel = () => '';
    // En el navegador conectado al servidor, las órdenes del jugador (construir, mejorar,
    // marcar...) no se aplican aquí sino que se mandan: remote(nombre, [argumentos]).
    this.remote = null;
    this.tmp = {
      world: new THREE.Vector3(),
      inv: new THREE.Quaternion(),
    };
  }

  // ---- Eventos (la vista y la interfaz se enteran de los cambios) ---------------------
  //   camp       el campamento cambió (o se quitó)
  //   buildings  se agregó, terminó, mejoró o quitó un edificio, o cambió un trabajador
  //   clothes    cambió la ropa que queda en la pila o la de un colono
  //   age        la colonia cambió de edad
  //   zones      cambió la zona de acopio
  //   marks      cambiaron los recursos marcados para recolectar
  //   resources  se agotó un recurso o brotó uno nuevo (para redibujarlos)
  //   notice     un aviso para el jugador (texto)
  //   changed    algo que conviene guardar

  on(type, fn) {
    (this.listeners[type] ??= []).push(fn);
    return () => {
      this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
    };
  }

  emit(type, ...args) {
    for (const fn of this.listeners[type] ?? []) fn(...args);
  }

  get count() {
    return this.colonists.length;
  }

  // ---- Cada paso -------------------------------------------------------------------

  // Avanza la colonia "delta" segundos reales a la velocidad "timeScale".
  // env: { timeScale, isNight, timeLabel(), absent, maxSteps } — timeLabel da la hora para
  // el registro; absent: el dueño no está (la salud no baja de la crítica, needs.js);
  // maxSteps: tope de pasos de simulación en esta llamada.
  update(delta, { timeScale = 1, isNight = false, timeLabel = () => '', absent = false, maxSteps = MAX_STEPS_PER_UPDATE } = {}) {
    if (!this.camp) return;
    this.timeLabel = timeLabel;
    // Todo sigue la velocidad del tiempo (pausa = quietos), en pasos cortos.
    const gameDt = delta * timeScale;
    if (gameDt <= 0) return;
    const time = timeLabel();
    const env = { isNight, time, gameTime: this.gameTime };
    const rain = this.weather?.rain ?? 0;
    const ambient = Math.min(1, Math.max(0, (this.campTemperature - (isNight ? 0.3 : 0) - 0.12 - rain * 0.12) * 1.6));
    this.updateRain(gameDt, rain);
    this.updateSpoilage();
    this.updateBuildings(gameDt, rain);
    updateFamily(this, gameDt, time);
    let simTime = gameDt;
    let steps = 0;
    while (simTime > 1e-4 && steps++ < maxSteps) {
      const dt = Math.min(MAX_STEP, simTime);
      simTime -= dt;
      this.gameTime += dt;
      env.gameTime = this.gameTime;
      for (const c of this.colonists) {
        c.companion = c.sleeping || c.inside ? null : this.nearestColonist(c, COMPANY_RADIUS);
        c.nearFire = Math.hypot(c.x, c.z) < FIRE_WARMTH_RADIUS;
        updateNeeds(c, {
          dt,
          ambient,
          nearFire: c.nearFire,
          sheltered: c.sleeping || c.inside,
          clothed: c.clothed,
          companion: c.companion,
          walking: c.walking,
          time,
          absent,
        });
        this.step(c, dt, env);
      }
    }
  }

  // ---- Campamento -------------------------------------------------------------------

  // camp: { dir (unitario), height, yaw, seed } o null. "ownZone": la simulación nivela
  // el terreno ella misma (en el servidor; en el navegador lo hace camp.js al dibujarlo).
  setCamp(camp, { ownZone = false } = {}) {
    this.removeAllBuildings();
    if (this.campZone) {
      removeTerrainZone(this.campZone);
      this.campZone = null;
    }
    this.colonists = [];
    this.heights.clear();
    this.water = undefined;
    this.stock = { ...START_STOCK };
    this.zones = [];
    this.outdoor = {};
    this.foodBatches = [];
    this.spoiled = 0;
    this.gameTime = 0;
    this.removed = new Map();
    this.sprouts = [];
    this.sproutTile = null;
    this.groveTile = null;
    this.spots = [];
    this.clothesLeft = 0;
    this.age = 1;
    this.flag = DEFAULT_FLAG;
    this.nextColonistId = START_COLONISTS;
    this.staticsRevision = 0;
    this.refreshObstacles();
    if (!camp) {
      this.camp = null;
      this.emit('camp', null);
      return;
    }
    const dir = new THREE.Vector3(camp.dir.x, camp.dir.y, camp.dir.z).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
    if (camp.yaw) quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, camp.yaw));
    this.camp = {
      dir,
      height: camp.height,
      yaw: camp.yaw || 0,
      seed: camp.seed ?? 1,
      position: dir.clone().multiplyScalar(RADIUS + camp.height),
      quaternion,
    };
    if (ownZone) this.campZone = addTerrainZone(campZone(dir, camp.height));
    this.loadResourceSpots();
    this.campTemperature = temperature(dir.x, dir.y, dir.z, elevation(dir.x, dir.y, dir.z));
    this.createColonists();
    this.clothesLeft = START_COLONISTS; // ropa en el suelo para todos
    this.emit('camp', this.camp);
    this.emit('resources');
    this.emit('zones');
    this.emit('marks');
    this.emit('clothes');
    this.emit('age', this.age);
    this.emit('buildings');
  }

  // Colonos siempre iguales para un mismo campamento (misma semilla).
  createColonists() {
    const rand = seededRandom((this.camp.seed ?? 1) ^ 0x5bd1e995);
    // El sexo y el nombre salen de otro generador, para no mover los números al azar de
    // los genes y rasgos (los colonos de colonias ya fundadas siguen siendo los mismos).
    const idRand = seededRandom((this.camp.seed ?? 1) ^ 0x7f4a7c15);
    const sexes = ['f', 'm', 'f', 'm', idRand() < 0.5 ? 'f' : 'm'].slice(0, START_COLONISTS);
    for (let k = sexes.length - 1; k > 0; k--) {
      const j = Math.floor(idRand() * (k + 1));
      [sexes[k], sexes[j]] = [sexes[j], sexes[k]];
    }
    this.birthRand = seededRandom((this.camp.seed ?? 1) ^ 0x2c1b3c6d);
    const taken = new Set();
    for (let i = 0; i < START_COLONISTS; i++) {
      rand(); // antes elegía el nombre de una lista: se sigue gastando ese número
      const sex = sexes[i];
      const name = pickName(1, sex, taken, idRand); // los que llegan al fundar son de la Edad Primitiva
      taken.add(name);
      const profile = createProfile(rand);
      // Piel, pelo y estatura vienen de los genes; la ropa es elección personal.
      const body = appearanceFromGenes(profile.genome, profile.age);
      const look = {
        skin: body.skin,
        hair: body.hair,
        shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
        pants: PANTS[Math.floor(rand() * PANTS.length)],
        longHair: rand() < 0.5,
        height: body.height, // un poco más grandes que la realidad, para verlos mejor
      };
      // Aparecen alrededor de la fogata.
      const a = (i / START_COLONISTS) * Math.PI * 2 + rand() * 0.5;
      const spot = this.freeSpot(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
      const colonist = {
        id: i,
        name,
        sex,
        ...profile,
        look,
        x: spot.x,
        z: spot.z,
        facing: Math.atan2(-spot.x, -spot.z),
        task: null,
        thinkTimer: rand() * 2,
        walking: false,
        working: false,
        sleeping: false,
        phase: rand() * 10, // fase inicial de la animación de caminar (la usa la vista)
        stuckTimer: 0,
        lastProgress: 0,
        rand: seededRandom(Math.floor(rand() * 4294967296)),
        activity: 'Descansando un momento',
        clothed: false,
        growth: 1,
        desire: 5 + idRand() * 15,
        mate: null,
        pregnant: null,
        home: null,
        born: null,
        inside: false,
        loving: false,
        invite: null,
      };
      addLog(colonist, 'Día 1', 'Llegó al campamento');
      this.colonists.push(colonist);
    }
  }

  // Un colono a partir de sus datos fijos (nombre, genes, rasgos...) y su estado. Lo usan
  // los nacimientos, cargar una partida y el navegador al recibir al niño del servidor.
  makeColonist(st, dyn = {}) {
    const growth = dyn.growth ?? 1;
    const x = dyn.x ?? 0;
    const z = dyn.z ?? 0;
    return {
      id: st.id,
      name: st.name,
      sex: st.sex,
      genome: st.genome,
      traits: (st.traits ?? []).map((t) => (typeof t === 'string' ? TRAITS.find((o) => o.id === t) : t)).filter(Boolean),
      skills: st.skills,
      bio: st.bio,
      look: st.look,
      born: st.born ?? null,
      age: dyn.age ?? (growth < 1 ? Math.round(growth * 17) : 18),
      job: null,
      needs: { ...dyn.needs },
      health: dyn.health ?? 100,
      log: dyn.log ?? [],
      flags: dyn.flags ?? {},
      chatCooldown: 0,
      x,
      z,
      facing: dyn.facing ?? Math.atan2(-x, -z),
      task: null,
      thinkTimer: 0.5,
      walking: false,
      working: false,
      sleeping: false,
      phase: st.id * 1.7,
      stuckTimer: 0,
      lastProgress: 0,
      rand: seededRandom(((this.camp?.seed ?? 1) ^ Math.imul(st.id + 1, 2654435761)) >>> 0),
      activity: 'Descansando un momento',
      clothed: !!dyn.clothed,
      growth,
      desire: dyn.desire ?? 0,
      mate: dyn.mate ?? null,
      pregnant: dyn.pregnant ?? null,
      home: dyn.home ?? null,
      inside: false,
      loving: false,
      invite: null,
    };
  }

  // Lo que no cambia de un colono que nació en la colonia (los fundadores salen de la semilla).
  staticOf(c) {
    return { id: c.id, name: c.name, sex: c.sex, genome: c.genome, traits: c.traits.map((t) => t.id), skills: c.skills, bio: c.bio, look: c.look, born: c.born };
  }

  // Máximo de colonos que admite la colonia ahora (10 del campamento + viviendas).
  get maxPopulation() {
    // En el navegador el servidor manda el máximo; en el servidor se calcula.
    return this.remote ? (this.maxPop ?? maxPopulation(this)) : maxPopulation(this);
  }

  // ---- Ropa ---------------------------------------------------------------------------

  get clothesSpot() {
    return CLOTHES_SPOT;
  }

  // El colono toma una prenda de la pila y se viste.
  takeClothes(c) {
    if (this.clothesLeft <= 0 || c.clothed) return false;
    this.clothesLeft--;
    c.clothed = true;
    this.emit('clothes');
    return true;
  }

  // ---- Consultas ----------------------------------------------------------------------

  colonist(id) {
    return this.colonists.find((c) => c.id === id) ?? null;
  }

  building(id) {
    return this.buildings.find((b) => b.id === id) ?? null;
  }

  nearestColonist(c, radius) {
    let best = null;
    let bestD = radius;
    for (const o of this.colonists) {
      if (o === c) continue;
      const d = Math.hypot(o.x - c.x, o.z - c.z);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  // Bienestar medio de la colonia y media de cada necesidad.
  summary() {
    const n = this.colonists.length;
    if (!n) return null;
    const avg = { food: 0, water: 0, rest: 0, warmth: 0, mood: 0, health: 0, wellbeing: 0 };
    for (const c of this.colonists) {
      for (const k of ['food', 'water', 'rest', 'warmth', 'mood']) avg[k] += c.needs[k] / n;
      avg.health += c.health / n;
      avg.wellbeing += wellbeing(c) / n;
    }
    return avg;
  }

  // ---- Terreno ------------------------------------------------------------------------

  // Local (x, z) del campamento -> dirección unitaria en el planeta.
  toDirection(x, z, out = new THREE.Vector3()) {
    out.set(x, 0, z).applyQuaternion(this.camp.quaternion).add(this.camp.position);
    return out.normalize();
  }

  // Punto del mundo -> coordenadas locales del campamento (x, z en metros).
  toLocal(point, out = new THREE.Vector3()) {
    this.tmp.inv.copy(this.camp.quaternion).invert();
    return out.copy(point).sub(this.camp.position).applyQuaternion(this.tmp.inv);
  }

  // Dirección en el planeta donde está un colono (para centrar la cámara).
  directionOf(c, out = new THREE.Vector3()) {
    return this.toDirection(c.x, c.z, out);
  }

  // Altura del terreno con caché en rejilla e interpolación bilineal.
  heightAt(x, z) {
    const gx = x / HEIGHT_CELL;
    const gz = z / HEIGHT_CELL;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = this.gridHeight(ix, iz);
    const h10 = this.gridHeight(ix + 1, iz);
    const h01 = this.gridHeight(ix, iz + 1);
    const h11 = this.gridHeight(ix + 1, iz + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  gridHeight(ix, iz) {
    const key = ix * 100_003 + iz;
    let h = this.heights.get(key);
    if (h === undefined) {
      h = surfaceHeight(this.toDirection(ix * HEIGHT_CELL, iz * HEIGHT_CELL, this.tmp.world));
      if (this.heights.size > 40_000) this.heights.clear();
      this.heights.set(key, h);
    }
    return h;
  }

  // ¿Se puede estar ahí? (tierra firme, sin mucha pendiente, fuera de obstáculos)
  walkable(x, z, margin = COLONIST_RADIUS) {
    for (const o of this.obstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < (o.r + margin) ** 2) return false;
    }
    const h = this.heightAt(x, z);
    if (h <= 0.6) return false; // agua
    const slope = Math.max(Math.abs(this.heightAt(x + 2, z) - h), Math.abs(this.heightAt(x, z + 2) - h)) / 2;
    return slope < 0.55;
  }

  freeSpot(x, z) {
    for (let r = 0; r < 12; r += 0.75) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (this.walkable(px, pz, COLONIST_RADIUS + 0.3)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  // ---- Movimiento -----------------------------------------------------------------------

  // Un destino al azar para pasear: tierra firme y con camino recto sin agua.
  pickWanderTarget(c) {
    const [minR, baseMax] = WANDER;
    const maxR = baseMax * (hasTrait(c, 'curious') ? 1.6 : hasTrait(c, 'homebody') ? 0.45 : 1);
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = c.rand() * Math.PI * 2;
      const r = minR + Math.sqrt(c.rand()) * (maxR - minR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.walkable(x, z, COLONIST_RADIUS + 0.6)) continue;
      if (this.pathIsDry(c.x, c.z, x, z)) return { x, z };
    }
    return null;
  }

  pathIsDry(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 4; s < len; s += 4) {
      const t = s / len;
      if (this.heightAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) <= 0.6) return false;
    }
    return true;
  }

  // Camina hacia (tx, tz) esquivando obstáculos y a los demás colonos.
  // Devuelve 'arrived', 'moving' o 'stuck'.
  walk(c, tx0, tz0, dt, stopDistance = 0.6) {
    const tx = tx0 - c.x;
    const tz = tz0 - c.z;
    const dist = Math.hypot(tx, tz);
    c.walking = true;
    if (dist < stopDistance) {
      c.walking = false;
      c.stuckTimer = 0;
      c.lastProgress = Infinity;
      return 'arrived';
    }
    let dx = tx / dist;
    let dz = tz / dist;
    const steer = (ox, oz, r, strength) => {
      const px = c.x - ox;
      const pz = c.z - oz;
      const d = Math.hypot(px, pz) || 1e-3;
      const reach = r + COLONIST_RADIUS + 1.8;
      if (d > reach) return;
      // Sólo si el obstáculo está por delante: empujar hacia un costado para rodearlo.
      if (px * dx + pz * dz > 0.3 * d) return;
      const w = ((reach - d) / reach) * strength;
      const side = px * dz - pz * dx >= 0 ? 1 : -1;
      const odx = dx;
      const odz = dz;
      dx += (px / d) * w * 0.6 + odz * side * w;
      dz += (pz / d) * w * 0.6 - odx * side * w;
    };
    for (const o of this.obstacles) steer(o.x, o.z, o.r, 1.6);
    for (const other of this.colonists) {
      if (other !== c && !other.sleeping) steer(other.x, other.z, COLONIST_RADIUS, 1.2);
    }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;

    const speed = WALK_SPEED * (0.85 + gene(c.genome, 'agility') * 0.3);
    let nx = c.x + dx * Math.min(speed * dt, dist);
    let nz = c.z + dz * Math.min(speed * dt, dist);
    // Nunca dentro de un obstáculo: se empuja hasta su borde.
    for (const o of this.obstacles) {
      const px = nx - o.x;
      const pz = nz - o.z;
      const d = Math.hypot(px, pz);
      const min = o.r + COLONIST_RADIUS;
      if (d < min && d > 1e-4) {
        nx = o.x + (px / d) * min;
        nz = o.z + (pz / d) * min;
      }
    }
    if (this.heightAt(nx, nz) > 0.6) {
      c.x = nx;
      c.z = nz;
    }
    this.face(c, Math.atan2(dx, dz), dt);

    // Si no avanza, está atascado.
    c.stuckTimer += dt;
    if (c.stuckTimer > 3) {
      const stuck = c.lastProgress - dist < 1;
      c.lastProgress = dist;
      c.stuckTimer = 0;
      if (stuck) return 'stuck';
    }
    return 'moving';
  }

  face(c, angle, dt) {
    let diff = angle - c.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.facing += diff * Math.min(1, dt * 8);
  }

  faceTowards(c, x, z, dt) {
    this.face(c, Math.atan2(x - c.x, z - c.z), dt);
  }

  // ---- Comportamiento -------------------------------------------------------------------

  // Cada colono piensa cada ~1,5 s: puntúa las acciones posibles (ai.js) y cambia de
  // tarea si encuentra una bastante mejor que la actual.
  step(c, dt, env) {
    c.walking = false;
    c.working = false;
    c.thinkTimer -= dt;
    if (c.thinkTimer <= 0 || !c.task) {
      c.thinkTimer = 1.5 + c.rand() * 0.5;
      const best = chooseTask(this, c, env);
      if (best && (!c.task || shouldSwitch(c.task, best))) this.startTask(c, best, env);
    }
    if (c.task) {
      const result = runTask(this, c, c.task, dt, env);
      if (result === 'done' || result === 'failed') {
        if (result === 'failed') c.avoid = { key: taskKey(c.task), until: env.gameTime + 40 };
        endTask(this, c, c.task);
        c.task = null;
        c.thinkTimer = result === 'failed' ? 0.5 : 0;
      }
    }
    c.activity = c.task ? taskActivity(this, c, c.task) : 'Descansando un momento';
  }

  startTask(c, task, env) {
    if (c.task) endTask(this, c, c.task);
    c.task = task;
    c.stuckTimer = 0;
    c.lastProgress = Infinity;
    const note = taskLog(c, task);
    if (note && note !== c.lastLogNote) {
      c.lastLogNote = note;
      addLog(c, env.time, note);
    }
  }

  // ---- Conocimiento del entorno (para la IA) ----------------------------------------------

  // Punto de tierra firme junto al agua más cercana al campamento (o null).
  waterSpot() {
    if (this.water !== undefined) return this.water;
    this.water = null;
    for (let r = 12; r <= 420 && !this.water; r += 8) {
      let best = null;
      const steps = Math.max(24, Math.round(r / 4));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (this.heightAt(x, z) > 0.6) continue;
        // Retroceder hacia el campamento hasta pisar tierra firme.
        for (let back = 2; back < 20; back += 2) {
          const bx = Math.cos(a) * (r - back);
          const bz = Math.sin(a) * (r - back);
          if (this.heightAt(bx, bz) > 0.8) {
            best = { x: bx, z: bz };
            break;
          }
        }
        if (best) break;
      }
      this.water = best;
    }
    return this.water;
  }

  // Recursos naturales alrededor del campamento en coordenadas locales. Salen de la
  // misma generación que el mundo, así que coinciden con lo que se ve.
  loadResourceSpots() {
    const spots = (this.spots = []);
    const dir = this.camp.dir;
    const lat0 = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    const lon0 = Math.atan2(dir.x, dir.z);
    const lonNorm = lon0 < 0 ? lon0 + Math.PI * 2 : lon0;
    const span = SPOT_RADIUS / RADIUS;
    const kinds = {};
    for (const [kind, ids] of Object.entries(SPOT_KINDS)) for (const id of ids) kinds[id] = kind;
    const typeIndex = RESOURCE_TYPES.map((t) => kinds[t.id] || null);
    const inv = this.camp.quaternion.clone().invert();
    const origin = this.camp.position;
    const p = new THREE.Vector3();
    for (let i = Math.floor((lat0 - span) / TILE_ANGLE); i <= Math.floor((lat0 + span) / TILE_ANGLE); i++) {
      const lat = (i + 0.5) * TILE_ANGLE;
      const cols = Math.max(1, Math.floor((Math.PI * 2 * Math.cos(lat)) / TILE_ANGLE));
      const colAngle = (Math.PI * 2) / cols;
      const lonSpan = span / Math.max(0.01, Math.cos(lat));
      const j0 = Math.floor((lonNorm - lonSpan) / colAngle);
      const j1 = Math.floor((lonNorm + lonSpan) / colAngle);
      for (let j = j0; j <= j1 && j < j0 + cols; j++) {
        const jw = ((j % cols) + cols) % cols;
        const key = i * 1_000_000 + jw;
        addTile(key, generateTile(i, jw, cols), CAMP_CLEAR + 2);
      }
    }
    // Arboleda del campamento: recursos garantizados entre 50 y 100 m de la fogata.
    const biome = biomeAt(dir.x, dir.y, dir.z).id;
    const grove = generateCampGrove(dir.x, dir.y, dir.z, biome, this.camp.seed ?? 1);
    addTile(GROVE_KEY, grove, 0);
    this.groveTile = grove;

    function addTile(key, tile, minDistance) {
      for (let k = 0; k < tile.count; k++) {
        const kind = typeIndex[tile.type[k]];
        if (!kind) continue;
        p.set(tile.pos[k * 3], tile.pos[k * 3 + 1], tile.pos[k * 3 + 2]).sub(origin).applyQuaternion(inv);
        const d = Math.hypot(p.x, p.z);
        if (d > SPOT_RADIUS || d < minDistance) continue;
        spots.push({ key, index: k, kind, type: RESOURCE_TYPES[tile.type[k]].id, x: p.x, z: p.z, readyAt: 0, taken: null });
      }
    }
  }

  // Qué recursos ya no están, para guardarlos o mandarlos a la vista: [[baldosa, [índices]]].
  serializeRemoved() {
    return [...this.removed].map(([key, set]) => [key, [...set]]);
  }

  // ---- Almacén --------------------------------------------------------------------------

  // Cuánto cabe de un recurso: el almacén del campamento más los almacenes construidos
  // (mientras se mejora, un almacén sigue guardando lo de su nivel actual).
  capacity(kind) {
    let cap = CAMP_CAPACITY[kind] ?? Infinity;
    for (const b of this.buildings) {
      if (b.def.id !== 'stockpile' || (!b.done && !b.upgrading)) continue;
      cap += b.def.levels[b.level - 1].capacity[kind] ?? 0;
    }
    return cap;
  }

  // Lo que hay bajo techo (el resto del stock está al aire libre).
  indoor(kind) {
    return (this.stock[kind] ?? 0) - (this.outdoor[kind] ?? 0);
  }

  outdoorCapacity() {
    return this.zones.reduce((sum, z) => sum + zoneCapacity(z), 0);
  }

  outdoorUsed() {
    return Object.values(this.outdoor).reduce((a, b) => a + b, 0);
  }

  isFull(kind) {
    return this.indoor(kind) >= this.capacity(kind) && this.outdoorUsed() >= this.outdoorCapacity();
  }

  // ¿Lo siguiente de este recurso irá al aire libre? (para llevarlo a la zona)
  goesOutdoor(kind) {
    return this.indoor(kind) >= this.capacity(kind) && this.outdoorUsed() < this.outdoorCapacity();
  }

  // Lo más lleno del almacén bajo techo (0–1), para la etiqueta.
  storeFill() {
    let fill = 0;
    for (const k of Object.keys(STOCK_NAMES)) fill = Math.max(fill, Math.min(1, this.indoor(k) / this.capacity(k)));
    return fill;
  }

  // Guarda lo que quepa (primero bajo techo, lo que sobra en las zonas al aire libre)
  // y devuelve cuánto entró.
  addStock(kind, amount) {
    const inside = Math.min(amount, Math.max(0, this.capacity(kind) - this.indoor(kind)));
    const outside = Math.min(amount - inside, Math.max(0, this.outdoorCapacity() - this.outdoorUsed()));
    this.stock[kind] = (this.stock[kind] ?? 0) + inside + outside;
    if (outside > 0) {
      this.outdoor[kind] = (this.outdoor[kind] ?? 0) + outside;
      if (kind === 'food') this.foodBatches.push({ amount: outside, expires: this.gameTime + FOOD_SPOIL_SECONDS });
    }
    return inside + outside;
  }

  // Saca del almacén: primero lo que está al aire libre (y la comida más vieja).
  takeStock(kind, amount) {
    const n = Math.min(amount, this.stock[kind] ?? 0);
    this.stock[kind] -= n;
    this.removeOutdoor(kind, Math.min(n, this.outdoor[kind] ?? 0));
    return n;
  }

  removeOutdoor(kind, n) {
    if (n <= 0) return;
    this.outdoor[kind] = Math.max(0, (this.outdoor[kind] ?? 0) - n);
    if (kind !== 'food') return;
    let left = n;
    while (left > 1e-6 && this.foodBatches.length) {
      const b = this.foodBatches[0];
      const t = Math.min(b.amount, left);
      b.amount -= t;
      left -= t;
      if (b.amount <= 1e-6) this.foodBatches.shift();
    }
  }

  // La comida al aire libre que venció desaparece.
  updateSpoilage() {
    while (this.foodBatches.length && this.foodBatches[0].expires <= this.gameTime) {
      const b = this.foodBatches.shift();
      const lost = Math.min(b.amount, this.outdoor.food ?? 0);
      this.outdoor.food = (this.outdoor.food ?? 0) - lost;
      this.stock.food = Math.max(0, this.stock.food - lost);
      this.spoiled += lost;
      if (lost >= 1) this.emit('notice', `Se pudrieron ${Math.floor(lost)} de comida al aire libre.`);
    }
  }

  canAfford(cost) {
    return Object.entries(cost).every(([k, n]) => (this.stock[k] ?? 0) >= n);
  }

  // Lo que falta para pagar un coste, en texto ("3 de madera").
  missing(cost) {
    return Object.entries(cost)
      .filter(([k, n]) => (this.stock[k] ?? 0) < n)
      .map(([k, n]) => `${Math.ceil(n - (this.stock[k] ?? 0))} de ${STOCK_NAMES[k]}`);
  }

  // ---- Zona de acopio al aire libre -----------------------------------------------------

  zoneProblem(rect) {
    if (rect.hw * 2 < MIN_ZONE_SIDE || rect.hd * 2 < MIN_ZONE_SIDE) return 'La zona es demasiado chica';
    for (const o of this.obstacles) {
      if (rectDistance(rect, o.x, o.z) < o.r) return 'Choca con el campamento o un edificio';
    }
    return null;
  }

  // Sólo hay una zona de acopio: dibujar otra la reemplaza (lo guardado se mantiene si
  // cabe en la nueva). Devuelve el problema (texto) o null.
  setZone(rect) {
    const problem = this.zoneProblem(rect);
    if (problem) return problem;
    this.remote?.('setZone', [rect]);
    this.zones = [{ cx: rect.cx, cz: rect.cz, hw: rect.hw, hd: rect.hd, angle: rect.angle }];
    this.trimOutdoor();
    this.emit('zones');
    this.emit('changed');
    return null;
  }

  // Al quitar la zona, lo guardado al aire libre se pierde.
  removeZone() {
    this.remote?.('removeZone', []);
    this.zones = [];
    this.trimOutdoor();
    this.emit('zones');
    this.emit('changed');
  }

  trimOutdoor() {
    let excess = this.outdoorUsed() - this.outdoorCapacity();
    const kinds = Object.keys(this.outdoor).sort((a, b) => this.outdoor[b] - this.outdoor[a]);
    for (const k of kinds) {
      if (excess <= 0) break;
      const n = Math.min(excess, this.outdoor[k]);
      this.stock[k] -= n;
      this.removeOutdoor(k, n);
      excess -= n;
    }
  }

  // Punto donde dejar un recurso: la zona al aire libre si ya no cabe bajo techo.
  dropPoint(kind) {
    const zone = this.zones[0];
    if (zone && this.goesOutdoor(kind)) return { x: zone.cx, z: zone.cz, r: Math.max(1, Math.min(zone.hw, zone.hd)) };
    return this.layout.storage;
  }

  // Cambiar la bandera del mástil (en el navegador se manda al servidor).
  setFlag(id) {
    if (typeof id !== 'string' || !FLAG_IDS.has(id) || !this.camp) return false;
    if (this.remote) {
      this.remote('setFlag', [id]);
      return true;
    }
    return this.applyCommand('setFlag', [id]);
  }

  // ---- Edades ---------------------------------------------------------------------------

  // Pasar a la edad siguiente si se cumplen los requisitos (edificios mejorados y la
  // ofrenda de materiales). Todos lo celebran y aparece el tótem de la tribu.
  advanceAge() {
    const status = nextAgeStatus(this);
    if (!status.ready) return false;
    if (this.remote) {
      this.remote('advanceAge', []);
      return true;
    }
    const time = this.timeLabel();
    for (const [k, n] of Object.entries(status.next.requires.cost)) this.takeStock(k, n);
    this.setAge(status.next.n);
    for (const c of this.colonists) {
      addLog(c, time, `Celebró la llegada de la ${status.next.name}`);
      c.needs.mood = Math.min(100, c.needs.mood + 25);
    }
    this.emit('changed');
    return true;
  }

  setAge(age) {
    this.age = age;
    this.refreshObstacles();
    this.emit('age', age);
  }

  get ageInfo() {
    return ageInfo(this.age);
  }

  // ---- Lluvia -----------------------------------------------------------------------------

  // Con lluvia las bayas y setas recogidas vuelven a crecer mucho antes y, de vez en
  // cuando, brota un arbusto de bayas o un grupo de setas nuevo cerca del campamento.
  updateRain(gameDt, rain) {
    if (rain < 0.05) return;
    const boost = gameDt * rain * 2; // con lluvia fuerte crecen tres veces más rápido
    for (const s of this.spots) {
      if (s.kind === 'food' && s.readyAt > this.gameTime) s.readyAt -= boost;
    }
    if (rain < 0.3 || this.sprouts.length >= MAX_SPROUTS) return;
    this.sproutTimer += gameDt * rain;
    if (this.sproutTimer < SPROUT_EVERY) return;
    this.sproutTimer = 0;
    this.sprout();
  }

  sprout() {
    const dir = this.camp.dir;
    const rand = Math.random;
    const p = new THREE.Vector3();
    for (let attempt = 0; attempt < 8; attempt++) {
      const type = rand() < 0.65 ? 'berryBush' : 'mushrooms';
      const item = sproutItem(dir.x, dir.y, dir.z, type, rand() * Math.PI * 2, 22 + rand() * 90, rand);
      if (!item) continue;
      const r = RADIUS + item.h;
      this.toLocal(p.set(item.d[0] * r, item.d[1] * r, item.d[2] * r), p);
      if (!this.walkable(p.x, p.z, 1.5) || this.blockedByBuilding(p.x, p.z)) continue;
      if (Math.hypot(p.x, p.z) < 14) continue; // no en medio del campamento
      this.sprouts.push(item);
      this.refreshSprouts();
      const name = type === 'berryBush' ? 'un arbusto de bayas' : 'unas setas';
      this.emit('notice', `Con la lluvia brotó ${name} cerca del campamento.`);
      return true;
    }
    return false;
  }

  // Rehace la baldosa de brotes y añade los puntos de recolección nuevos (los brotes sólo
  // se agregan al final, así que los ya conocidos conservan su índice).
  refreshSprouts() {
    const tile = tileFromItems(this.sprouts);
    this.sproutTile = tile.count ? tile : null;
    const known = this.spots.filter((s) => s.key === SPROUT_KEY).length;
    const p = new THREE.Vector3();
    for (let k = known; k < tile.count; k++) {
      this.toLocal(p.set(tile.pos[k * 3], tile.pos[k * 3 + 1], tile.pos[k * 3 + 2]), p);
      this.spots.push({ key: SPROUT_KEY, index: k, kind: 'food', type: RESOURCE_TYPES[tile.type[k]].id, x: p.x, z: p.z, readyAt: 0, taken: null });
    }
    this.emit('resources');
  }

  // El recurso libre de un tipo más cercano a un punto (o null).
  nearestSpot(kind, x, z, maxDistance = Infinity, gameTime = 0) {
    let best = null;
    let bestD = maxDistance;
    for (const s of this.spots) {
      if (s.kind !== kind || s.gone || s.taken || s.readyAt > gameTime) continue;
      if (this.blockedByBuilding(s.x, s.z)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  blockedByBuilding(x, z) {
    for (const b of this.buildings) {
      if (Math.hypot(x - b.x, z - b.z) < b.def.footprint + 3) return true;
    }
    return false;
  }

  // ---- Órdenes de recolección ---------------------------------------------------------------

  // Recursos marcados para recolectar (herramienta de recolección).
  nearestMarked(x, z, gameTime) {
    if (!this.markedCount) return null;
    let best = null;
    let bestD = Infinity;
    for (const s of this.spots) {
      if (!s.marked || s.gone || s.taken || s.readyAt > gameTime) continue;
      if (this.isFull(s.kind) || this.blockedByBuilding(s.x, s.z)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  get markedCount() {
    let n = 0;
    for (const s of this.spots) if (s.marked && !s.gone) n++;
    return n;
  }

  // Marcar o desmarcar los recursos dentro de un rectángulo (coordenadas del campamento).
  markRect(rect, marked) {
    this.remote?.('markRect', [rect, marked]);
    let changed = 0;
    for (const s of this.spots) {
      if (s.gone || !insideRect(rect, s.x, s.z)) continue;
      if (!!s.marked !== marked) {
        s.marked = marked;
        changed++;
      }
    }
    if (changed) this.marksChanged();
    return changed;
  }

  // Marcar o desmarcar los recursos dentro de un círculo (coordenadas del campamento).
  markArea(x, z, radius, marked) {
    this.remote?.('markArea', [x, z, radius, marked]);
    let changed = 0;
    for (const s of this.spots) {
      if (s.gone || Math.hypot(s.x - x, s.z - z) > radius) continue;
      if (!!s.marked !== marked) {
        s.marked = marked;
        changed++;
      }
    }
    if (changed) this.marksChanged();
    return changed;
  }

  clearMarks() {
    this.remote?.('clearMarks', []);
    for (const s of this.spots) s.marked = false;
    this.marksChanged();
  }

  marksChanged() {
    this.emit('marks');
    this.emit('changed');
  }

  // Un recurso usado: los árboles y las piedras desaparecen; las bayas vuelven a crecer.
  consumeSpot(spot, gameTime) {
    spot.taken = null;
    if (spot.marked) {
      spot.marked = false;
      this.emit('marks');
    }
    if (spot.kind === 'food') {
      spot.readyAt = gameTime + REGROW_SECONDS;
    } else {
      spot.gone = true;
      let set = this.removed.get(spot.key);
      if (!set) this.removed.set(spot.key, (set = new Set()));
      set.add(spot.index);
      this.emit('resources');
    }
  }

  // ---- Edificios ----------------------------------------------------------------------------

  // Por qué no se puede construir "def" en (x, z), o null si se puede.
  buildProblem(def, x, z) {
    if (!this.canAfford(def.cost)) return `Faltan ${this.missing(def.cost).join(' y ')}`;
    if (Math.hypot(x, z) > BUILD_MAX_DISTANCE) return 'Demasiado lejos del campamento';
    const r = def.footprint;
    for (const o of this.obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.r + r + 0.8) return 'Choca con otra construcción';
    }
    for (const zone of this.zones) {
      if (rectDistance(zone, x, z) < r + 0.5) return 'Choca con la zona de acopio';
    }
    const h = this.heightAt(x, z);
    if (h <= 0.8) return 'No se puede construir en el agua';
    let lo = h;
    let hi = h;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const hk = this.heightAt(x + Math.cos(a) * (r + 1), z + Math.sin(a) * (r + 1));
      if (hk <= 0.8) return 'Demasiado cerca del agua';
      lo = Math.min(lo, hk);
      hi = Math.max(hi, hk);
    }
    if (hi - lo > r * 1.1) return 'El terreno es demasiado empinado';
    return null;
  }

  // Encargar un edificio: se paga y queda en obra. Devuelve el edificio o el problema.
  build(typeId, x, z) {
    const def = BUILDINGS[typeId];
    if (!def || !this.camp) return { problem: 'No se puede construir eso' };
    const problem = this.buildProblem(def, x, z);
    if (problem) return { problem };
    if (this.remote) {
      this.remote('build', [typeId, x, z]);
      return { pending: true };
    }
    for (const [k, n] of Object.entries(def.cost)) this.takeStock(k, n);
    const b = this.createBuilding(def, x, z, Math.atan2(-x, -z), 0, 0);
    this.emit('changed');
    return { building: b };
  }

  createBuilding(def, x, z, yaw, progress, produced, level = 1, id = null) {
    const height = this.heightAt(x, z);
    const dir = this.toDirection(x, z, new THREE.Vector3());
    const ground = biomeAt(dir.x, dir.y, dir.z);
    // Aplanar el terreno bajo el edificio y pintar un poco de tierra (la vista regenera
    // los trozos de terreno afectados).
    const zone = addTerrainZone({
      dir: { x: dir.x, y: dir.y, z: dir.z },
      height,
      flatRadius: def.footprint + 1,
      blendRadius: 5,
      clearRadius: def.footprint + 0.8,
      detailRadius: 0,
      dirtColor: (ground.details ? ground : BIOMES.grassland).dirt,
      resourceClear: def.footprint + 3,
    });
    this.heights.clear();

    if (!Number.isInteger(id) || this.building(id)) id = this.nextBuildingId;
    this.nextBuildingId = Math.max(this.nextBuildingId, id + 1);
    const b = {
      id,
      def,
      x,
      z,
      yaw,
      height,
      dir,
      progress,
      done: false,
      produced,
      level,
      upgrading: false,
      store: 0, // agua juntada por el recolector de lluvia
      get name() {
        return this.def.levels[this.level - 1].name;
      },
      worker: null,
      reason: '',
      status: null,
      zone,
      finish: (builder) => this.finishBuilding(b, builder),
    };
    this.buildings.push(b);
    this.refreshObstacles();
    if (progress >= 1) this.finishBuilding(b, null, true);
    this.emit('buildings');
    return b;
  }

  removeAllBuildings() {
    for (const b of this.buildings) {
      b.removed = true;
      removeTerrainZone(b.zone);
      if (b.worker) b.worker.job = null;
    }
    const had = this.buildings.length > 0;
    this.buildings = [];
    this.heights.clear();
    if (had) this.emit('buildings');
  }

  finishBuilding(b, builder, silent = false) {
    if (b.done) return;
    b.progress = 1;
    b.done = true;
    const time = this.timeLabel();
    if (b.upgrading) {
      // La mejora cambia el nivel, el nombre y el modelo.
      const old = b.name;
      b.upgrading = false;
      b.level++;
      if (builder && !silent) addLog(builder, time, `Terminó de mejorar ${old}: ahora es ${b.name}`);
      if (b.worker && b.worker !== builder && !silent) addLog(b.worker, time, `Su lugar de trabajo ahora es ${b.name}`);
    } else if (builder && !silent) {
      addLog(builder, time, `Terminó de construir: ${b.name}`);
    }
    this.assignWorker(b);
    this.emit('buildings');
    this.emit('changed');
  }

  // Por qué no se puede mejorar (o null si se puede).
  upgradeProblem(b) {
    const next = levelOf(b, 1);
    if (!b.done) return b.upgrading ? 'Ya se está mejorando' : 'Primero hay que terminar la obra';
    if (!next) return `Más mejoras en la ${ageInfo(b.level + 1).name} (próximamente)`;
    if (b.level + 1 > this.age + 1) return `Hace falta llegar a la ${ageInfo(b.level).name}`;
    if (!this.canAfford(next.upgradeCost)) return `Faltan ${this.missing(next.upgradeCost).join(' y ')}`;
    return null;
  }

  // Pagar la mejora y dejarla en obra: los constructores vienen a hacerla. El trabajador
  // se queda asignado y vuelve a trabajar cuando termina.
  upgrade(b) {
    if (this.upgradeProblem(b)) return false;
    if (this.remote) {
      this.remote('upgrade', [b.id]);
      return true;
    }
    const next = levelOf(b, 1);
    for (const [k, n] of Object.entries(next.upgradeCost)) this.takeStock(k, n);
    b.upgrading = true;
    b.done = false;
    b.progress = 0;
    b.buildTime = b.def.buildTime * (1 + b.level * 0.4);
    this.emit('buildings');
    this.emit('changed');
    return true;
  }

  // Puntuación de un colono para un oficio: su habilidad y su actitud.
  aptitude(c, def) {
    return c.skills[def.skill] + (hasTrait(c, 'hardworking') ? 0.8 : 0) - (hasTrait(c, 'lazy') ? 1.2 : 0);
  }

  // Colonos ordenados de más a menos capacitados para un edificio.
  ranking(b) {
    return [...this.colonists].sort((a, c) => this.aptitude(c, b.def) - this.aptitude(a, b.def));
  }

  // La colonia elige al colono libre más capacitado.
  assignWorker(b) {
    // En la copia del navegador conectada al servidor, los trabajadores los elige el servidor.
    if (this.remote || !b.done || b.worker || !b.def.skill) return;
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
    if (this.remote) {
      this.remote('setWorker', [b.id, c.id]);
      return;
    }
    if (c.job && c.job !== b) {
      const old = c.job;
      old.worker = null;
      old.reason = `${c.name} se fue a trabajar a ${b.name}.`;
    }
    if (b.worker && b.worker !== c) b.worker.job = null;
    b.worker = c;
    b.reason = reason;
    c.job = b;
    addLog(c, this.timeLabel(), `Ahora trabaja en: ${b.name}`);
    this.emit('buildings');
    this.emit('changed');
  }

  // Lo que pasa en los edificios con el tiempo: el recolector de lluvia se llena solo
  // (mucho con lluvia y un poco con el rocío) y se buscan trabajadores para los libres.
  updateBuildings(gameDt, rain) {
    for (const b of this.buildings) {
      const lv = b.done && levelOf(b);
      if (lv?.rainOnly) b.store = Math.min(lv.capacity, b.store + (0.004 + rain * 0.08) * gameDt);
    }
    this.assignTimer -= gameDt;
    if (this.assignTimer <= 0) {
      this.assignTimer = ASSIGN_EVERY;
      for (const b of this.buildings) this.assignWorker(b);
      assignHomes(this);
    }
  }

  refreshObstacles() {
    this.obstacles = [
      ...campObstacles(),
      ...(this.age >= 2 ? [{ x: TOTEM_SPOT.x, z: TOTEM_SPOT.z, r: 0.9, kind: 'prop' }] : []),
      ...this.buildings.map((b) => ({ x: b.x, z: b.z, r: b.def.footprint, kind: 'building' })),
    ];
  }

  // ---- Guardado ---------------------------------------------------------------------------

  // Todo lo que cambia con el juego (lo fijo —nombres, genes, rasgos— sale de la semilla
  // del campamento y no hace falta guardarlo). Mismo formato que las partidas anteriores.
  serialize() {
    return {
      version: SAVE_VERSION,
      campSeed: this.camp?.seed ?? null,
      savedAt: Date.now(),
      stock: this.stock,
      colony: {
        gameTime: this.gameTime,
        age: this.age,
        clothesLeft: this.clothesLeft,
        flag: this.flag,
        colonists: this.colonists.map((c) => ({
          id: c.id,
          needs: c.needs,
          health: c.health,
          log: c.log,
          flags: c.flags,
          chatCooldown: c.chatCooldown,
          clothed: c.clothed,
          x: c.x,
          z: c.z,
          facing: c.facing,
          growth: c.growth,
          desire: c.desire,
          mate: c.mate,
          pregnant: c.pregnant,
          home: c.home,
          age: c.age,
          static: c.born ? this.staticOf(c) : undefined, // los nacidos aquí no salen de la semilla
        })),
        regrowing: this.spots.filter((s) => s.readyAt > this.gameTime).map((s) => [s.key, s.index, s.readyAt]),
        removed: this.serializeRemoved(),
        sprouts: this.sprouts,
        marked: this.spots.filter((s) => s.marked && !s.gone).map((s) => [s.key, s.index]),
        zones: this.zones,
        outdoor: this.outdoor,
        foodBatches: this.foodBatches,
        spoiled: this.spoiled,
      },
      weather: this.weather?.save?.() ?? null,
      buildings: this.buildings.map((b) => ({
        id: b.id,
        type: b.def.id,
        x: b.x,
        z: b.z,
        yaw: b.yaw,
        progress: b.progress,
        produced: b.produced,
        level: b.level,
        upgrading: b.upgrading,
        store: b.store,
        worker: b.worker ? b.worker.id : null,
      })),
    };
  }

  // Carga una partida guardada de este mismo campamento (devuelve false si no es suya).
  restore(data) {
    if (!this.camp || !data || !(data.version >= 1 && data.version <= SAVE_VERSION) || data.campSeed !== this.camp.seed) return false;
    Object.assign(this.stock, data.stock);
    for (const s of data.buildings || []) {
      const def = BUILDINGS[s.type];
      if (!def) continue;
      const level = Math.min(def.levels.length, Math.max(1, s.level || 1));
      const b = this.createBuilding(def, s.x, s.z, s.yaw, s.upgrading ? 1 : s.progress, s.produced || 0, level, s.id);
      b.store = s.store || 0;
      if (s.upgrading && levelOf(b, 1)) {
        b.upgrading = true;
        b.done = false;
        b.progress = s.progress;
        b.buildTime = def.buildTime * (1 + b.level * 0.4);
      }
      const worker = this.colonists.find((c) => c.id === s.worker);
      if (b.done && worker) {
        if (b.worker) b.worker.job = null;
        b.worker = worker;
        worker.job = b;
        b.reason = 'Trabajaba aquí antes.';
      }
    }
    this.restoreColony(data.colony);
    if (data.weather && this.weather?.load) this.weather.load(data.weather);
    this.emit('buildings');
    return true;
  }

  // ---- Red: órdenes y estado ---------------------------------------------------------------

  // Aplica una orden que llegó de un jugador (en el servidor). Todo lo que viene de afuera
  // se valida: nombres, números y rectángulos.
  applyCommand(name, args = []) {
    const num = (v, lim = 1e4) => (Number.isFinite(v) && Math.abs(v) <= lim ? v : null);
    const rect = (r) => {
      if (!r || typeof r !== 'object') return null;
      const out = { cx: num(r.cx, 500), cz: num(r.cz, 500), hw: num(r.hw, 500), hd: num(r.hd, 500), angle: num(r.angle, 10) };
      return Object.values(out).every((v) => v !== null) && out.hw > 0 && out.hd > 0 ? out : null;
    };
    switch (name) {
      case 'build': {
        const [type, x, z] = args;
        if (typeof type !== 'string' || num(x, 500) === null || num(z, 500) === null) return false;
        return !!this.build(type, x, z).building;
      }
      case 'upgrade': {
        const b = this.building(args[0]);
        return !!b && this.upgrade(b);
      }
      case 'setWorker': {
        const b = this.building(args[0]);
        const c = this.colonist(args[1]);
        if (!b || !c || !b.def.skill || !b.done) return false;
        this.setWorker(b, c);
        return true;
      }
      case 'advanceAge':
        return this.advanceAge();
      case 'setFlag': {
        if (typeof args[0] !== 'string' || !FLAG_IDS.has(args[0])) return false;
        this.flag = args[0];
        this.emit('flag', this.flag);
        this.emit('changed');
        return true;
      }
      case 'setZone': {
        const r = rect(args[0]);
        return !!r && this.setZone(r) === null;
      }
      case 'removeZone':
        this.removeZone();
        return true;
      case 'markRect': {
        const r = rect(args[0]);
        return !!r && this.markRect(r, !!args[1]) >= 0;
      }
      case 'markArea': {
        const [x, z, radius, marked] = args;
        if (num(x, 1000) === null || num(z, 1000) === null || num(radius, 50) === null) return false;
        return this.markArea(x, z, radius, !!marked) >= 0;
      }
      case 'clearMarks':
        this.clearMarks();
        return true;
    }
    return false;
  }

  // Estado para mandar por la red. "fast": sólo dónde está cada colono y qué hace con el
  // cuerpo (varias veces por segundo); "full": todo lo que muestra la interfaz.
  // statics: incluir los datos fijos de los nacidos en la colonia (se mandan al conectarse y
  // cuando nace alguien; después no hace falta repetirlos).
  snapshot(part = 'full', { statics = true } = {}) {
    const r2 = (v) => Math.round(v * 100) / 100;
    const flags = (c) => (c.walking ? 1 : 0) | (c.working ? 2 : 0) | (c.sleeping ? 4 : 0) | (c.clothed ? 8 : 0) | (c.loving ? 16 : 0) | (c.inside ? 32 : 0);
    if (part === 'fast') return { colonists: this.colonists.map((c) => [c.id, r2(c.x), r2(c.z), r2(c.facing), flags(c)]) };
    const camp = this.camp;
    return {
      camp: camp && { dir: { x: camp.dir.x, y: camp.dir.y, z: camp.dir.z }, height: camp.height, yaw: camp.yaw, seed: camp.seed },
      gameTime: this.gameTime,
      age: this.age,
      clothesLeft: this.clothesLeft,
      flag: this.flag,
      maxPopulation: this.maxPopulation,
      born: statics ? this.colonists.filter((c) => c.born).map((c) => ({ ...this.staticOf(c), x: r2(c.x), z: r2(c.z) })) : undefined,
      stock: this.stock,
      outdoor: this.outdoor,
      zones: this.zones,
      foodBatches: this.foodBatches.slice(0, 1),
      spoiled: this.spoiled,
      weather: this.weather?.save?.() ?? null,
      colonists: this.colonists.map((c) => ({
        id: c.id,
        needs: c.needs,
        health: r2(c.health),
        log: c.log,
        clothed: c.clothed,
        activity: c.activity,
        job: c.job?.id ?? null,
        growth: Math.round(c.growth * 1000) / 1000,
        desire: Math.round(c.desire),
        mate: c.mate,
        pregnant: c.pregnant?.due ?? null,
        home: c.home,
        age: c.age,
        x: r2(c.x),
        z: r2(c.z),
        facing: r2(c.facing),
        flags: flags(c),
      })),
      buildings: this.buildings.map((b) => ({
        id: b.id,
        type: b.def.id,
        x: b.x,
        z: b.z,
        yaw: b.yaw,
        progress: r2(b.progress),
        done: b.done,
        level: b.level,
        upgrading: b.upgrading,
        buildTime: b.buildTime ?? null,
        store: r2(b.store),
        produced: Math.floor(b.produced),
        worker: b.worker?.id ?? null,
        reason: b.reason,
        status: b.status,
      })),
      marked: this.spots.filter((sp) => sp.marked && !sp.gone).map((sp) => [sp.key, sp.index]),
      removed: this.serializeRemoved(),
      sprouts: this.sprouts,
    };
  }

  // Aplica en el navegador el estado que manda el servidor (esta copia no se simula: sólo
  // refleja la del servidor). Avisa con eventos sólo lo que cambió.
  applySnapshot(s, part = 'full') {
    // Los que nacieron en la colonia: se crean con sus datos fijos (la copia del navegador
    // sólo conoce de la semilla a los fundadores).
    let arrived = false;
    for (const st of s.born ?? []) {
      if (this.colonist(st.id)) continue;
      const row = (s.colonists ?? []).find((r) => !Array.isArray(r) && r.id === st.id);
      this.colonists.push(this.makeColonist(st, { ...(row ?? {}), needs: row?.needs, x: st.x, z: st.z, clothed: true }));
      arrived = true;
    }
    if (arrived) this.emit('colonists');
    if (s.maxPopulation) this.maxPop = s.maxPopulation;
    for (const row of s.colonists ?? []) {
      const fast = Array.isArray(row);
      const c = this.colonist(fast ? row[0] : row.id);
      if (!c) continue;
      const [x, z, facing, f] = fast ? row.slice(1) : [row.x, row.z, row.facing, row.flags];
      c.x = x;
      c.z = z;
      c.facing = facing;
      c.walking = !!(f & 1);
      c.working = !!(f & 2);
      c.sleeping = !!(f & 4);
      c.loving = !!(f & 16);
      c.inside = !!(f & 32);
      if (c.clothed !== !!(f & 8)) {
        c.clothed = !!(f & 8);
        this.emit('clothes');
      }
      if (fast) continue;
      Object.assign(c.needs, row.needs);
      c.health = row.health;
      c.log = row.log;
      c.activity = row.activity;
      c.growth = row.growth ?? 1;
      c.desire = row.desire ?? 0;
      c.mate = row.mate ?? null;
      c.pregnant = row.pregnant != null ? { due: row.pregnant } : null;
      c.home = row.home ?? null;
      if (row.age != null) c.age = row.age;
    }
    if (part === 'fast') return;

    this.gameTime = s.gameTime;
    this.stock = { ...s.stock };
    this.outdoor = { ...s.outdoor };
    this.foodBatches = s.foodBatches ?? [];
    this.spoiled = s.spoiled ?? 0;
    if (s.weather) (this.weather ??= new WeatherState()).load(s.weather);
    if (JSON.stringify(s.zones) !== JSON.stringify(this.zones)) {
      this.zones = s.zones ?? [];
      this.emit('zones');
    }
    if (s.age !== this.age) this.setAge(s.age);
    if (s.flag && s.flag !== this.flag) {
      this.flag = s.flag;
      this.emit('flag', this.flag);
    }
    if (s.clothesLeft !== this.clothesLeft) {
      this.clothesLeft = s.clothesLeft;
      this.emit('clothes');
    }

    // Edificios: se crean, actualizan o quitan según los del servidor (por id).
    let changed = false;
    const seen = new Set();
    for (const row of s.buildings ?? []) {
      const def = BUILDINGS[row.type];
      if (!def) continue;
      seen.add(row.id);
      let b = this.building(row.id);
      if (!b) {
        b = this.createBuilding(def, row.x, row.z, row.yaw, row.done ? 1 : 0, row.produced, row.level, row.id);
        changed = true;
      }
      if (b.done !== row.done || b.level !== row.level || b.upgrading !== row.upgrading) changed = true;
      Object.assign(b, {
        progress: row.progress,
        done: row.done,
        level: row.level,
        upgrading: row.upgrading,
        store: row.store,
        produced: row.produced,
        reason: row.reason,
        status: row.status,
      });
      if (row.buildTime) b.buildTime = row.buildTime;
      const worker = row.worker === null ? null : this.colonist(row.worker);
      if (b.worker !== worker) {
        b.worker = worker;
        changed = true;
      }
    }
    const gone = this.buildings.filter((b) => !seen.has(b.id));
    if (gone.length) {
      for (const b of gone) {
        b.removed = true;
        removeTerrainZone(b.zone);
      }
      this.buildings = this.buildings.filter((b) => seen.has(b.id));
      this.heights.clear();
      this.refreshObstacles();
      changed = true;
    }
    for (const c of this.colonists) c.job = null;
    for (const b of this.buildings) if (b.worker) b.worker.job = b;
    if (changed) this.emit('buildings');

    // Recursos: marcas, lo talado y lo que brotó.
    const marked = new Set((s.marked ?? []).map(([key, index]) => `${key}:${index}`));
    let marksChanged = false;
    for (const sp of this.spots) {
      const m = marked.has(`${sp.key}:${sp.index}`);
      if (!!sp.marked !== m) {
        sp.marked = m;
        marksChanged = true;
      }
    }
    if (marksChanged) this.emit('marks');
    if ((s.sprouts?.length ?? 0) !== this.sprouts.length) {
      this.sprouts = s.sprouts ?? [];
      this.refreshSprouts();
    }
    const removedKey = JSON.stringify(s.removed ?? []);
    if (removedKey !== JSON.stringify(this.serializeRemoved())) {
      this.removed = new Map((s.removed ?? []).map(([key, idx]) => [key, new Set(idx)]));
      for (const sp of this.spots) sp.gone = sp.kind !== 'food' && !!this.removed.get(sp.key)?.has(sp.index);
      this.emit('resources');
    }
  }

  restoreColony(data) {
    if (!data) return;
    this.gameTime = data.gameTime || 0;
    // Zonas antiguas (redondas) se convierten en un cuadrado; sólo se queda la primera.
    this.zones = (Array.isArray(data.zones) ? data.zones : []).map(upgradeRect).filter(Boolean).slice(0, 1);
    this.outdoor = data.outdoor && typeof data.outdoor === 'object' ? { ...data.outdoor } : {};
    this.foodBatches = Array.isArray(data.foodBatches) ? data.foodBatches.filter((b) => b.amount > 0) : [];
    this.spoiled = data.spoiled || 0;
    this.setAge(Math.min(AGES.length, Math.max(1, data.age || 1)));
    this.flag = FLAG_IDS.has(data.flag) ? data.flag : DEFAULT_FLAG;
    // Partidas anteriores a la ropa: queda una prenda por cada colono sin vestir.
    const naked = (data.colonists || []).filter((s) => !s.clothed).length;
    this.clothesLeft = Number.isFinite(data.clothesLeft) ? data.clothesLeft : naked;
    for (const saved of data.colonists || []) {
      if (!saved.static || this.colonist(saved.id)) continue;
      this.colonists.push(this.makeColonist(saved.static, { ...saved, needs: saved.needs }));
    }
    this.nextColonistId = Math.max(START_COLONISTS, ...this.colonists.map((o) => o.id + 1));
    this.birthRand = seededRandom((this.camp.seed ?? 1) ^ 0x2c1b3c6d ^ Math.floor(this.gameTime));
    for (const saved of data.colonists || []) {
      const c = this.colonists.find((o) => o.id === saved.id);
      if (!c) continue;
      if (Number.isFinite(saved.growth)) c.growth = saved.growth;
      if (Number.isFinite(saved.desire)) c.desire = saved.desire;
      c.mate = saved.mate ?? null;
      c.pregnant = saved.pregnant && Number.isFinite(saved.pregnant.due) ? saved.pregnant : null;
      c.home = saved.home ?? null;
      if (Number.isFinite(saved.age)) c.age = saved.age;
      Object.assign(c.needs, saved.needs);
      c.health = saved.health ?? c.health;
      c.log = Array.isArray(saved.log) ? saved.log : c.log;
      c.flags = saved.flags || {};
      c.chatCooldown = saved.chatCooldown || 0;
      c.clothed = !!saved.clothed;
      if (Number.isFinite(saved.x) && this.walkable(saved.x, saved.z, 0.2)) {
        c.x = saved.x;
        c.z = saved.z;
      }
      c.facing = saved.facing ?? c.facing;
      c.task = null;
      c.sleeping = false;
    }
    if (Array.isArray(data.sprouts) && data.sprouts.length) {
      this.sprouts = data.sprouts.filter((it) => Number.isInteger(it.typeIndex) && RESOURCE_TYPES[it.typeIndex]).slice(0, MAX_SPROUTS);
      this.refreshSprouts();
    }
    const byKey = new Map(this.spots.map((s) => [`${s.key}:${s.index}`, s]));
    for (const [key, index, readyAt] of data.regrowing || []) {
      const s = byKey.get(`${key}:${index}`);
      if (s) s.readyAt = readyAt;
    }
    for (const [key, index] of data.marked || []) {
      const s = byKey.get(`${key}:${index}`);
      if (s) s.marked = true;
    }
    this.removed = new Map((data.removed || []).map(([key, idx]) => [key, new Set(idx)]));
    for (const [key, indices] of data.removed || []) {
      for (const index of indices) {
        const s = byKey.get(`${key}:${index}`);
        if (s) s.gone = true;
      }
    }
    this.emit('zones');
    this.emit('marks');
    this.emit('clothes');
    this.emit('resources');
    this.emit('colonists');
  }
}
