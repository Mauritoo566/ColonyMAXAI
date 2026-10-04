import * as THREE from 'three';
import { RADIUS, surfaceHeight, elevation, naturalSurfaceHeight, addTerrainZone, removeTerrainZone } from '../elevation.js';
import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { AGES, ageInfo, nextAgeStatus } from '../ages.js';
import { insideRect, rectDistance, upgradeRect } from '../rect.js';
import { temperature, biomeAt, BIOMES } from '../biomes.js';
import { nextBand, nextTrend, collectiveAlerts } from './wellbeing.js';
import { cleanVillageName } from './villageName.js';
import { createProfile, updateNeeds, addMoodEvent, hasTrait, wellbeing, addLog, SKILLS, TRAITS, completeSkill, completeSkills } from '../needs.js';
import { appearanceFromGenes, gene } from '../genes.js';
import { RESOURCE_TYPES } from '../resourceTypes.js';
import { SEASON_AMBIENT_AMP, effectiveTemperature, growthFactor, seasonAt, snowCover } from './calendar.js';
import { TILE_ANGLE, generateTile, generateCampGrove, GROVE_KEY, SPROUT_KEY, GROVE_TREES, sproutItem, tileFromItems } from '../resourceGen.js';
import { chooseTask, shouldSwitch, runTask, endTask, taskActivity, taskLog, taskKey, siteStatus, orderProblem, PRIORITY, NEED_OF_TASK, failReason } from '../ai.js';
import { campLayout, campObstacles, campZone } from './campLayout.js';
import { BUILDINGS, levelOf } from './buildingTypes.js';
const STOCK_NAMES = GOOD_NAMES;
import { WeatherState } from './weather.js';
import { pickName } from './names.js';
import { FLAG_IDS, DEFAULT_FLAG } from '../flags.js';
import { updateFamily, updateImmigration, immigrationBlocker, assignHomes, maxPopulation, growthBlocker } from './family.js';
import { buildBlocker, upgradeBlocker, evolveHouses, buildCostOf, buildLevelFor, limitsFor, radiusOf, expansionBlocker, expansionCost, EXPANSION_STEP } from './progression.js';
import { GOOD_NAMES } from './goods.js';
import { centerProps } from './centerLayout.js';
import { entranceOf, accessProblem, halfOf, pointInRect, rectsOverlap, circleHitsRect, footprintRect, resourceClearOf, cardinalYaw } from './access.js';
import { generateDeposits, depositAt, updateProduction, updatePower, applyHospitals, trainColonists, tradeProblem, doTrade, researchProblem, roadsProblem, roadCost, roadLevelFor, roadKey, roadCellProblem, roadCellOf, roadSpeed, ROAD_LEVELS, ROAD_CELL, ROAD_LIFT, autoRoadPath } from './economy.js';
import { pushSample } from '../interp.js';
import { TECHS_BY_ID } from './techs.js';
import { recruit, recruitProblem, dismiss, upgradeSoldier, soldierUpgradeProblem, payUpkeep, dailyRaid, armyReport, militaryPower } from './military.js';
import { UNITS_BY_ID } from './units.js';
import { specOf, defaultSpec, validSpec, migrateSpecs, primitiveSplit, coverage, waitReason, isWorker, WORK_TYPES, spotCategory, SPEC_IDS, SPEC_NAMES } from './specialties.js';
import { MOB_TYPES, spawnMobs, updateMobs, mobThreat } from './mobs.js';
import { remainingOf, waterHint, DEW_RATE, RAIN_RATE, PRIMITIVE_STOCK, PRIMITIVE_COLLECTOR_WATER, DISCOVERY, LEARNABLE, shelterInfo, populationInfo, waterReport, foodReport, alertsOf, discoveryProblem, resourceHelp, harvestBlocker } from './primitive.js';

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
export const CAMP_OTHER_CAPACITY = 30; // de cada uno de los demás bienes, hasta que se construya almacén
// Zona de acopio al aire libre (una sola, rectangular y del tamaño que se quiera): guarda
// lo que no cabe bajo techo. Cabe más cuanto más grande es (unidades por m²), pero la
// comida al aire libre se pudre.
export const ZONE_PER_M2 = 1.5;
export const MIN_ZONE_SIDE = 2; // metros: más chico no tiene sentido
export const FOOD_SPOIL_SECONDS = 1.5 * DAY_LENGTH_SECONDS; // día y medio de juego
// Filtro de recolección que llega de la red: lista de tipos conocidos, o null (todos).
const MARK_KINDS = ['food', 'wood', 'stone'];
function cleanKinds(k) {
  if (!Array.isArray(k)) return null;
  const out = k.filter((x) => MARK_KINDS.includes(x));
  return out.length === MARK_KINDS.length ? null : out;
}

export const SAVE_VERSION = 3; // 2: además guarda colonos, recursos agotados y el reloj; 3: bienes, tecnologías, territorio
export const BUILD_MAX_DISTANCE = 75; // metros desde la fogata donde se puede construir en la primera edad (ver progression.js)

// Lugares fijos del campamento (coordenadas locales).
// Al fundar el campamento hay ropa en el suelo para todos; cada colono va a buscar la
// suya cuando tiene frío. Sin ropa se enfrían mucho más.
export const CLOTHES_SPOT = { x: Math.cos(0.55) * 7.2, z: Math.sin(0.55) * 7.2 };
// Tótem de la tribu (llega con la Edad de Piedra), junto a la fogata.
export const TOTEM_SPOT = { x: Math.cos(4.6) * 7, z: Math.sin(4.6) * 7 };

const WALK_SPEED = 1.4; // m/s
export const COLONIST_RADIUS = 0.45;
const WANDER = [6, 70]; // pasean por el claro y sus alrededores (metros desde la fogata)
const HEIGHT_CELL = 2; // metros por celda de la caché de alturas
const MAX_STEP = 0.1; // segundos por paso de simulación
const FIRE_WARMTH_RADIUS = 7; // metros: la fogata calienta a quien esté más cerca
const CROWD_CELL = 6; // metros: tamaño de celda del índice de colonos cercanos
const QUEUE_REACH = 3; // metros: cerca del destino se hace cola si el sitio está ocupado
const QUEUE_SLOT = 1.7; // metros de más que se aceptan para tomar un puesto libre cerca del objetivo
const QUEUE_PATIENCE = 25; // segundos esperando turno antes de buscar otra cosa
const COMPANY_RADIUS = 5; // metros: a esta distancia se hacen compañía
const MAX_STEPS_PER_UPDATE = 80; // tope de pasos de simulación por llamada (a ×60)
const SPOT_RADIUS = 230; // metros: recursos que los colonos conocen alrededor del campamento
const CAMP_CLEAR = 45; // alrededor del campamento no hay recursos naturales (resources.js)
const REGROW_SECONDS = 1.5 * DAY_LENGTH_SECONDS; // las bayas y setas vuelven a crecer en día y medio
const SAPLING_GROW_SECONDS = 0.75 * DAY_LENGTH_SECONDS; // un árbol plantado tarda en crecer
const SEED_CHANCE = 0.45; // al talar un árbol, probabilidad de que caigan semillas y nazca uno nuevo
const MAX_SPROUTS = 50; // vegetación espontánea viva a la vez (lluvia, ramas y piedras del suelo)
const MAX_PLANTED = 100; // árboles plantados (por colonos o replantados por el leñador) vivos a la vez; no gastan el cupo de lo espontáneo
const SPROUT_ARRAY_MAX = 260; // al llegar aquí se limpian del arreglo los brotes ya consumidos
const SPROUT_EVERY = 25; // segundos de juego entre brotes con lluvia fuerte
const ASSIGN_EVERY = 1; // segundos entre repasos de trabajadores libres

// Edificio a edificio chocan por casillas de la cuadrícula (misma de colocar y de caminos), no
// por un radio circular: cada uno ocupa de verdad las casillas que le hacen falta según su
// tamaño (footprint), pegadas sin hueco a las del vecino. Fuera de ahí (terreno, caminos de
// colono, props) el footprint se sigue usando como radio normal: no hace falta que sea cuadrado.
function footprintHalf(footprint) {
  return halfOf(footprint);
}
// Qué recursos naturales sirven para qué.
// Árboles: se talan con herramientas (Edad de Piedra en adelante). En Primitiva la madera sale de los palos caídos.
export const TREES = ['broadleaf', 'pine', 'jungleTree', 'acacia', 'palm'];
const SPOT_KINDS = {
  food: ['berryBush', 'mushrooms'],
  wood: ['broadleaf', 'pine', 'jungleTree', 'acacia', 'palm', 'sticks'],
  stone: ['stone', 'flint', 'pebbles'],
};
// Rocas grandes: se pican con herramientas (Edad de Piedra en adelante). En Primitiva la
// piedra sale de piedrecitas sueltas (como los palos con la madera).
export const BIG_ROCKS = ['stone'];
const KIND_OF_TYPE = {};
for (const [kind, ids] of Object.entries(SPOT_KINDS)) for (const id of ids) KIND_OF_TYPE[id] = kind;

// Recursos naturales REALES alrededor de un lugar (antes de fundar): sale de la misma generación que usa
// la colonia al fundarse (baldosas del mundo + arboleda del campamento). Devuelve cuántos sitios de comida,
// madera y piedra hay dentro de cada radio (en metros sobre el terreno).
export function scanSite(dir, seed, radii = [75, SPOT_RADIUS]) {
  const lat0 = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  const lon0 = Math.atan2(dir.x, dir.z);
  const lonNorm = lon0 < 0 ? lon0 + Math.PI * 2 : lon0;
  const span = SPOT_RADIUS / RADIUS;
  const kinds = {};
  for (const [kind, ids] of Object.entries(SPOT_KINDS)) for (const id of ids) kinds[id] = kind;
  // Antes de la Edad de Piedra los árboles y las rocas grandes no se recogen: sólo cuentan
  // los palos y las piedrecitas sueltas del suelo.
  const typeIndex = RESOURCE_TYPES.map((t) => (TREES.includes(t.id) || BIG_ROCKS.includes(t.id) ? null : kinds[t.id] || null));
  const origin = new THREE.Vector3().copy(dir).normalize().multiplyScalar(RADIUS + naturalSurfaceHeight(dir));
  const up = new THREE.Vector3().copy(dir).normalize();
  const out = radii.map(() => ({ food: 0, wood: 0, stone: 0 }));
  const v = new THREE.Vector3();
  const add = (tile, minDistance) => {
    for (let k = 0; k < tile.count; k++) {
      const kind = typeIndex[tile.type[k]];
      if (!kind) continue;
      v.set(tile.pos[k * 3], tile.pos[k * 3 + 1], tile.pos[k * 3 + 2]).sub(origin);
      v.addScaledVector(up, -v.dot(up));
      const d = v.length();
      if (d < minDistance) continue;
      radii.forEach((r, i) => {
        if (d <= r) out[i][kind]++;
      });
    }
  };
  for (let i = Math.floor((lat0 - span) / TILE_ANGLE); i <= Math.floor((lat0 + span) / TILE_ANGLE); i++) {
    const lat = (i + 0.5) * TILE_ANGLE;
    const cols = Math.max(1, Math.floor((Math.PI * 2 * Math.cos(lat)) / TILE_ANGLE));
    const colAngle = (Math.PI * 2) / cols;
    const lonSpan = span / Math.max(0.01, Math.cos(lat));
    const j0 = Math.floor((lonNorm - lonSpan) / colAngle);
    const j1 = Math.floor((lonNorm + lonSpan) / colAngle);
    for (let j = j0; j <= j1 && j < j0 + cols; j++) add(generateTile(i, ((j % cols) + cols) % cols, cols), CAMP_CLEAR + 2);
  }
  add(generateCampGrove(dir.x, dir.y, dir.z, biomeAt(dir.x, dir.y, dir.z).id, seed), 0);
  return out;
}

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
    this.flow = { in: {}, out: {} }; // lo que entra y sale del almacén en el tramo actual
    this.flowBuckets = []; // los últimos tramos (para producción y consumo por día)
    this.flowTimer = 0;
    this.mobs = []; // animales del mundo cerca de la aldea (el servidor los simula)
    this.primitiveMigrated = false; // ya tiene lo básico del nuevo inicio de Primitiva
    this.milestones = new Set(); // hitos conseguidos (p. ej. la primera herramienta de piedra)
    this.learned = new Set(); // acciones que el jugador ya aprendió (la guía las reconoce)
    this.discovery = null; // { progress } mientras se fabrica la primera herramienta
    this.defeat = null; // { cause, day } cuando mueren todos
    this.deaths = []; // { name, cause, day }
    this.alertKeys = new Set();
    this.roads = new Map(); // caminos: casilla -> nivel
    this.autoRoads = true; // la aldea traza sola caminos entre sus edificios
    this.autoRoadKeys = new Set(); // casillas hechas por la aldea (gratis; mejoran solas con la edad)
    this.roadsOff = new Set(); // casillas que el jugador quitó: no se vuelven a trazar solas
    this.armyUnpaid = false; // las tropas no cobran el mantenimiento: rinden la mitad
    this.nextRaidDay = null;
    this.deposits = []; // yacimientos de mineral (de la semilla del campamento)
    this.tradeUsed = 0; // comercio del día (valor en monedas) y qué día es
    this.tradeDay = 0;
    this.skillsRevision = 0;
    this.grid = { supply: 0, demand: 0 };
    this.produced = {}; // bienes producidos en toda la partida (requisitos de las edades)
    this.techs = new Set(); // tecnologías investigadas
    this.expansions = 0; // ampliaciones de territorio compradas
    this.ageChangedAt = 0; // hora de juego del último cambio de edad (transición suave)
    this.flag = DEFAULT_FLAG; // bandera del mástil (flags.js)
    this.villageName = ''; // nombre de la aldea que ven todos los jugadores (vacío = se muestra el del jugador)
    this.nextColonistId = START_COLONISTS;
    this.staticsRevision = 0; // sube con cada nacimiento (el servidor manda entonces los datos fijos)
    this.birthRand = seededRandom(1);
    this.layout = campLayout();
    this.campTemperature = 0.5;
    this.season = null; // la estación en este campamento (la fija el mundo cada paso; ver sim/calendar.js)
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
    this.absent = absent;
    // Todo sigue la velocidad del tiempo (pausa = quietos), en pasos cortos.
    const gameDt = delta * timeScale;
    if (gameDt <= 0) return;
    const time = timeLabel();
    this.nightNow = isNight;
    const env = { isNight, time, gameTime: this.gameTime };
    const rain = this.weather?.effectiveRain ?? 0;
    // La estación sube o baja un poco el calor del lugar (menos que lo que se ve en el paisaje).
    const seasonal = this.season ? this.season.warmth * SEASON_AMBIENT_AMP : 0;
    const ambient = Math.min(1, Math.max(0, (this.campTemperature + seasonal - (isNight ? 0.3 : 0) - 0.12 - (this.weather?.rain ?? 0) * 0.12) * 1.6));
    const thirst = 1 + (this.season ? this.season.warmth * 0.2 : 0); // en verano se bebe más
    this.updateRain(gameDt, rain);
    this.updateSpoilage();
    this.updateBuildings(gameDt, rain);
    updateFamily(this, gameDt, time);
    updateImmigration(this, gameDt, time);
    this.updateAlerts(gameDt, absent);
    updateMobs(this, gameDt, isNight);
    this.rollFlows(gameDt);
    // Desde la Edad del Bronce vivir sin casa pesa en el ánimo; la molestia entra poco a poco
    // en los dos días siguientes a cada cambio de edad para que no sea una crisis de golpe.
    const homeless = this.age >= 3 ? Math.min(1, Math.max(0, (this.gameTime - this.ageChangedAt) / (2 * DAY_LENGTH_SECONDS))) : 0;
    let simTime = gameDt;
    let steps = 0;
    while (simTime > 1e-4 && steps++ < maxSteps) {
      const dt = Math.min(MAX_STEP, simTime);
      simTime -= dt;
      this.gameTime += dt;
      env.gameTime = this.gameTime;
      this.buildCrowd();
      const dying = [];
      for (const c of this.colonists) {
        c.companion = c.sleeping || c.inside ? null : this.nearestColonist(c, COMPANY_RADIUS);
        c.nearFire = Math.hypot(c.x, c.z) < FIRE_WARMTH_RADIUS;
        updateNeeds(c, {
          dt,
          ambient,
          thirst,
          nearFire: c.nearFire,
          sheltered: (c.sleeping && !c.outdoorSleep) || c.inside,
          clothed: c.clothed,
          companion: c.companion,
          walking: c.walking,
          time,
          gameTime: this.gameTime,
          absent,
          homeless: c.home == null && (c.growth ?? 1) >= 1 ? homeless : 0,
        });
        c.moodBand = nextBand(c.moodBand, c.needs.mood);
        c.moodTrend = nextTrend(c.moodTrend, c.needs.mood, c.moodTarget ?? c.needs.mood);
        this.step(c, dt, env);
        if (!absent && c.health <= 0.01) dying.push(c);
      }
      for (const c of dying) this.die(c, c.lastHurtBy && c.health <= 0.01 && Math.min(c.needs.food, c.needs.water) > 5 ? `atacado por un ${c.lastHurtBy === 'oso' ? 'oso' : 'lobo'}` : c.needs.water <= 0 ? 'de sed' : c.needs.food <= 0 ? 'de hambre' : c.needs.warmth < 8 ? 'de frío' : 'por agotamiento');
      // La primera herramienta de piedra: se talla mientras el dueño está (no cambia las ausencias).
      if (this.discovery && !absent) {
        this.discovery.progress = Math.min(1, this.discovery.progress + dt / DISCOVERY.seconds);
        if (this.discovery.progress >= 1) {
          this.discovery = null;
          this.milestones.add(DISCOVERY.id);
          this.emit('notice', `¡Descubierta: ${DISCOVERY.name}!`);
          this.emit('changed');
        }
      }
      // Talleres, servicios y energía avanzan en cada paso (así también cuentan al ponerse al día).
      for (const b of this.buildings) if (b.done && b.def.kind) updateProduction(this, b, dt);
      applyHospitals(this, dt);
      this.powerTimer = (this.powerTimer ?? 0) - dt;
      if (this.powerTimer <= 0) {
        this.powerTimer = 1;
        updatePower(this);
      }
    }
  }

  // ---- Edad Primitiva: consultas y acciones -------------------------------------------------

  shelterInfo() {
    return shelterInfo(this);
  }

  populationInfo() {
    return populationInfo(this);
  }

  waterReport() {
    return waterReport(this);
  }

  foodReport() {
    return foodReport(this);
  }

  waterHint() {
    return waterHint(this);
  }

  get alerts() {
    return this.alertsView ?? alertsOf(this);
  }

  resourceHelp(id) {
    return resourceHelp(this, id);
  }

  harvestBlocker(kind) {
    return harvestBlocker(this, kind);
  }

  remaining(kind) {
    return remainingOf(this, kind);
  }

  // Campamento inicial de una partida nueva: un refugio de ramas, el recolector de lluvia ya
  // funcionando y un pequeño acopio. Sólo lo hace el servidor al fundar (no al cargar una partida).
  // Busca un sitio libre (en la cuadrícula de 4 m) para un edificio inicial y lo deja terminado.
  placeStarter(def, angle0) {
    for (let ring = 0; ring < 8; ring++) {
      for (let k = 0; k < 16; k++) {
        const a = angle0 + (k / 16) * Math.PI * 2;
        const r = 16 + ring * 4;
        const x = Math.round((Math.cos(a) * r) / 4) * 4;
        const z = Math.round((Math.sin(a) * r) / 4) * 4;
        if (!this.siteProblem(def, x, z)) return this.createBuilding(def, x, z, Math.atan2(-x, -z), 1, 0, 1);
      }
    }
    return null;
  }

  seedPrimitive() {
    this.stock = { ...PRIMITIVE_STOCK };
    this.clothesLeft = 0;
    const house = this.placeStarter(BUILDINGS.house, 0.5);
    const collector = this.placeStarter(BUILDINGS.well, 3.6);
    if (collector) collector.store = PRIMITIVE_COLLECTOR_WATER;
    this.primitiveMigrated = true; // una partida nueva ya empieza completa
    primitiveSplit(this); // tres especialidades por colono que cubren el inicio
    assignHomes(this);
    this.emit('changed');
    return { house, collector };
  }

  // Aldeas guardadas antes del nuevo inicio de la Edad Primitiva: se les añade sólo lo que les falta
  // para poder completar la etapa (no el paquete inicial): una plaza de refugio si no tienen ninguna
  // (antes dormían en los tipis, que ya no existen) y un recolector de lluvia si no tienen ninguna
  // forma de captar agua. Se conservan colonos, recursos y edificios; no se repite (una marca en la
  // partida y comprobaciones por contenido) y no se quita a nadie por pasar del límite de diez.
  migratePrimitive() {
    if (this.remote || this.age !== 1 || this.primitiveMigrated) return [];
    const added = [];
    const has = (pred) => this.buildings.some(pred);
    if (!has((b) => b.def.levels[0].housing != null)) {
      if (this.placeStarter(BUILDINGS.house, 0.5)) added.push('un refugio de ramas');
    }
    if (!has((b) => b.def.id === 'well')) {
      const collector = this.placeStarter(BUILDINGS.well, 3.6);
      if (collector) {
        collector.store = PRIMITIVE_COLLECTOR_WATER / 2;
        added.push('un recolector de lluvia');
      }
    }
    this.primitiveMigrated = true;
    if (added.length) {
      assignHomes(this);
      this.emit('notice', `Actualización de la Edad Primitiva: se añadió ${added.join(' y ')} a tu aldea`);
      this.emit('changed');
    }
    return added;
  }

  // Aparecen los animales de esta zona (sólo el servidor, al cargar o fundar la colonia).
  spawnMobs() {
    const biome = biomeAt(this.camp.dir.x, this.camp.dir.y, this.camp.dir.z).id;
    spawnMobs(this, biome, seededRandom((this.camp.seed ?? 1) ^ 0x6d0b5));
  }

  mobThreat(c) {
    return mobThreat(this, c);
  }

  // Copia en el navegador de los animales que manda el servidor (se crean, mueven o quitan por id).
  applyMobs(rows) {
    const byId = new Map(this.mobs.map((m) => [m.id, m]));
    const seen = new Set();
    for (const [id, ti, x, z, facing, state] of rows) {
      const type = MOB_TYPES[ti];
      if (!type) continue;
      seen.add(id);
      let m = byId.get(id);
      if (!m || m.type !== type) {
        m = { id, type };
        this.mobs = this.mobs.filter((o) => o.id !== id);
        this.mobs.push(m);
      }
      m.x = x;
      m.z = z;
      m.facing = facing;
      pushSample(m, x, z, facing);
      m.state = state;
    }
    if (this.mobs.some((m) => !seen.has(m.id))) this.mobs = this.mobs.filter((m) => seen.has(m.id));
  }

  // Acción aprendida: queda reconocida para siempre (la guía no la vuelve a pedir).
  learn(id) {
    if (!LEARNABLE.includes(id)) return false;
    if (this.remote) {
      this.remote('learn', [id]);
      return true;
    }
    if (!this.learned.has(id)) {
      this.learned.add(id);
      this.emit('changed');
    }
    return true;
  }

  noteLearned(id) {
    if (this.remote || this.learned.has(id)) return;
    this.learned.add(id);
    this.emit('changed');
  }

  discoveryProblem() {
    return discoveryProblem(this);
  }

  // Empezar a fabricar la primera herramienta de piedra (se pagan los materiales y tarda un rato).
  discover() {
    if (discoveryProblem(this)) return false;
    if (this.remote) {
      this.remote('discover', []);
      return true;
    }
    for (const [k, n] of Object.entries(DISCOVERY.cost)) this.takeStock(k, n);
    this.discovery = { progress: 0 };
    this.emit('notice', 'Los colonos empiezan a tallar la primera herramienta de piedra');
    this.emit('changed');
    return true;
  }

  // Un colono muere (sólo con el dueño presente: durante las ausencias la salud tiene su suelo).
  die(c, cause) {
    const time = this.timeLabel();
    this.deaths.push({ name: c.name, cause, day: time });
    this.colonists = this.colonists.filter((o) => o !== c);
    if (c.task) endTask(this, c, c.task);
    for (const b of this.buildings) b.workers = b.workers.filter((w) => w !== c);
    for (const o of this.colonists) {
      if (o.mate === c.id) o.mate = null;
      if (o.task?.partner === c) o.task = null;
    }
    this.staticsRevision++;
    this.emit('colonists');
    this.emit('notice', `${c.name} murió ${cause}`);
    this.emit('changed');
    if (!this.colonists.length && !this.defeat) {
      const last = this.deaths[this.deaths.length - 1];
      this.defeat = { cause: this.defeatCause(), day: time, last: last?.name ?? '' };
      this.emit('defeat', this.defeat);
    }
  }

  // Avisos de escasez: se calculan cada pocos segundos y sólo se anuncian los nuevos (con el dueño presente).
  updateAlerts(gameDt, absent) {
    this.alertTimer = (this.alertTimer ?? 0) - gameDt;
    if (this.alertTimer > 0) return;
    this.alertTimer = 5;
    const list = [...alertsOf(this), ...collectiveAlerts(this)];
    this.alertsView = list;
    const keys = new Set(list.map((a) => `${a.id}:${a.level}`));
    if (!absent) for (const a of list) if (!this.alertKeys.has(`${a.id}:${a.level}`)) this.emit('notice', `${a.text}. ${a.hint}`);
    this.alertKeys = keys;
  }

  // Causa de la derrota con lo que se sabe: lo que más mató.
  defeatCause() {
    const count = {};
    for (const d of this.deaths) count[d.cause] = (count[d.cause] ?? 0) + 1;
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'por falta de recursos';
    return `Los colonos murieron ${top}.`;
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
    this.armyUnpaid = false;
    this.nextRaidDay = null;
    this.mobs = [];
    this.primitiveMigrated = false;
    this.milestones = new Set(); // hitos conseguidos (p. ej. la primera herramienta de piedra)
    this.learned = new Set(); // acciones que el jugador ya aprendió (la guía las reconoce)
    this.discovery = null; // { progress } mientras se fabrica la primera herramienta
    this.defeat = null; // { cause, day } cuando mueren todos
    this.deaths = []; // { name, cause, day }
    this.alertKeys = new Set();
    this.roads = new Map();
    this.autoRoadKeys = new Set();
    this.roadsOff = new Set();
    this.deposits = [];
    this.tradeUsed = 0;
    this.tradeDay = 0;
    this.grid = { supply: 0, demand: 0 };
    this.flow = { in: {}, out: {} };
    this.flowBuckets = [];
    this.flowTimer = 0;
    this.produced = {};
    this.techs = new Set();
    this.expansions = 0;
    this.ageChangedAt = 0;
    this.flag = DEFAULT_FLAG;
    this.villageName = '';
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
    this.deposits = generateDeposits(this, seededRandom);
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
        arrived: null,
        soldier: null,
        inside: false,
        loving: false,
        invite: null,
      };
      completeSkills(colonist);
      addLog(colonist, 'Día 1', 'Llegó al campamento');
      this.colonists.push(colonist);
    }
  }

  // Un colono a partir de sus datos fijos (nombre, genes, rasgos...) y su estado. Lo usan
  // los nacimientos, cargar una partida y el navegador al recibir al niño del servidor.
  makeColonist(st, dyn = {}) {
    const growth = dyn.growth ?? 1;
    const skills = { ...st.skills };
    const x = dyn.x ?? 0;
    const z = dyn.z ?? 0;
    const colonist = {
      id: st.id,
      name: st.name,
      sex: st.sex,
      genome: st.genome,
      traits: (st.traits ?? []).map((t) => (typeof t === 'string' ? TRAITS.find((o) => o.id === t) : t)).filter(Boolean),
      skills,
      bio: st.bio,
      look: st.look,
      born: st.born ?? null,
      arrived: st.arrived ?? null,
      age: dyn.age ?? (growth < 1 ? Math.round(growth * 17) : 18),
      job: null,
      spec: validSpec(dyn.spec) ? [...dyn.spec] : null, // tres especialidades por prioridad
      pendingSpec: validSpec(dyn.pendingSpec) ? [...dyn.pendingSpec] : null, // cambio a aplicar en un punto seguro
      xp: { ...(dyn.xp ?? {}) }, // práctica acumulada por categoría (segundos de trabajo)
      idle: null,
      needs: { ...dyn.needs },
      health: dyn.health ?? 100,
      log: dyn.log ?? [],
      flags: dyn.flags ?? {},
      moodEvents: dyn.moodEvents?.length ? dyn.moodEvents.map((e) => ({ ...e })).slice(0, 4) : undefined,
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
      soldier: dyn.soldier ?? null,
      desire: dyn.desire ?? 0,
      mate: dyn.mate ?? null,
      pregnant: dyn.pregnant ?? null,
      home: dyn.home ?? null,
      inside: false,
      loving: false,
      invite: null,
    };
    completeSkills(colonist);
    return colonist;
  }

  // Lo que no cambia de un colono que nació en la colonia (los fundadores salen de la semilla).
  staticOf(c) {
    return { id: c.id, name: c.name, sex: c.sex, genome: c.genome, traits: c.traits.map((t) => t.id), skills: c.skills, bio: c.bio, look: c.look, born: c.born, arrived: c.arrived ?? null };
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
    this.eachNear(c, Math.min(radius, CROWD_CELL), (o, d) => {
      if (d < bestD) {
        best = o;
        bestD = d;
      }
      return false;
    });
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

  // ---- Colonos entre colonos ------------------------------------------------------------
  // Índice espacial de quién está a la vista (se rehace en cada paso de simulación): evita comparar a todos con todos.
  buildCrowd() {
    const g = (this.crowd ??= { cell: CROWD_CELL, map: new Map() });
    g.map.clear();
    for (const o of this.colonists) {
      if (o.sleeping || o.inside) continue;
      const key = Math.floor(o.x / g.cell) * 100003 + Math.floor(o.z / g.cell);
      const list = g.map.get(key);
      if (list) list.push(o);
      else g.map.set(key, [o]);
    }
  }

  // Recorre los colonos a menos de "radius" (≤ el tamaño de celda) de c; fn(o, distancia) devuelve true para cortar.
  eachNear(c, radius, fn) {
    const g = this.crowd;
    if (!g) return;
    const ix = Math.floor(c.x / g.cell);
    const iz = Math.floor(c.z / g.cell);
    for (let i = ix - 1; i <= ix + 1; i++) {
      for (let j = iz - 1; j <= iz + 1; j++) {
        const list = g.map.get(i * 100003 + j);
        if (!list) continue;
        for (const o of list) {
          if (o === c) continue;
          const d = Math.hypot(o.x - c.x, o.z - c.z);
          if (d < radius && fn(o, d)) return;
        }
      }
    }
  }

  // Un lugar libre cerca de c, hacia donde va (para apartarse de un atasco): sin obstáculos, agua ni colonos encima.
  detourPoint(c, gx, gz) {
    const base = Math.atan2(gz - c.z, gx - c.x);
    for (let r = 1.6; r <= 4.2; r += 0.8) {
      for (const turn of [-1.2, 1.2, -0.7, 0.7, -1.9, 1.9, 0]) {
        const a = base + turn;
        const px = c.x + Math.cos(a) * r;
        const pz = c.z + Math.sin(a) * r;
        if (!this.walkable(px, pz, COLONIST_RADIUS + 0.2)) continue;
        let busy = false;
        this.eachNear({ x: px, z: pz }, COLONIST_RADIUS * 2.4, (o) => (busy = o !== c));
        if (!busy) return { x: px, z: pz };
      }
    }
    return null;
  }

  // Reserva un asiento junto a la fogata (suelo o tronco): prefiere el que deja más lejos a los ya
  // sentados, para que se repartan alrededor, algo mejor si es un tronco y poco el que queda lejos.
  // Devuelve null si no queda ninguno libre.
  pickSeat(c, skip = []) {
    const seats = this.layout.seats;
    const free = (s) => !s.taken || s.taken === c || !this.colonists.includes(s.taken);
    const sitting = seats.filter((s) => !free(s));
    let best = null;
    let bestScore = -Infinity;
    for (const s of seats) {
      if (!free(s) || skip.includes(s) || !this.walkable(s.approach.x, s.approach.z, COLONIST_RADIUS - 0.05)) continue; // (un edificio nuevo puede tapar el sitio)
      let spread = 4;
      for (const o of sitting) spread = Math.min(spread, Math.hypot(o.x - s.x, o.z - s.z));
      const score = spread + (s.kind === 'bench' ? 0.8 : 0) - 0.08 * Math.hypot(s.x - c.x, s.z - c.z) + c.rand() * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best) best.taken = c;
    return best;
  }

  // Camina hacia (tx, tz) esquivando obstáculos y a los demás colonos.
  // Devuelve 'arrived', 'moving' o 'stuck'. Un colono es un obstáculo móvil: se rodea, se le cede el paso por una regla
  // estable (quien tiene el número menor pasa; el otro se aparta a su derecha y afloja) y, si algo lo frena de verdad, se
  // prueba apartarse, buscar un hueco, recalcular la ruta y, sólo al final, se da por atascado (la tarea se suspende).
  walk(c, tx0, tz0, dt, stopDistance = 0.6, direct = false) {
    // Con muros en medio se va por los portones (ruta por waypoints).
    const wp = this.pathTarget(c, tx0, tz0);
    if (wp && !(wp.x === tx0 && wp.z === tz0)) {
      const r = this.walk(c, wp.x, wp.z, dt, 1.2);
      return r === 'arrived' ? 'moving' : r;
    }
    // Con un obstáculo (tronco, fogata, edificio) justo en medio se rodea por una ruta planeada.
    const op = direct ? null : this.obstacleTarget(c, tx0, tz0);
    if (op) {
      const r = this.walk(c, op.x, op.z, dt, 0.6, true);
      return r === 'arrived' ? 'moving' : r;
    }
    c.walking = true;
    const finalDist = Math.hypot(tx0 - c.x, tz0 - c.z);
    if (finalDist < stopDistance) return this.settle(c, dt);
    // Cola: ya cerca del destino y alguien parado ocupa el sitio: se toma el puesto libre más próximo en vez de empujar.
    if (finalDist < stopDistance + QUEUE_REACH && (c.blocked ?? 0) > 0.5) {
      let taken = false;
      this.eachNear(c, 1.3, (o) => (taken = !o.moving && Math.hypot(o.x - tx0, o.z - tz0) < finalDist - 0.15));
      if (taken) {
        c.waiting = true;
        if (finalDist < stopDistance + QUEUE_SLOT) return this.settle(c, dt);
        c.queued = (c.queued ?? 0) + dt;
        if (c.queued > QUEUE_PATIENCE) return this.giveUp(c, 'Había demasiada gente en el destino y no se liberó el sitio');
        return 'moving';
      }
    }
    c.queued = 0;
    // Desvío temporal para salir de un atasco: primero se va a ese hueco y luego se sigue al destino.
    let tx = tx0;
    let tz = tz0;
    if (c.detour) {
      c.detour.t -= dt;
      if (c.detour.t <= 0 || Math.hypot(c.detour.x - c.x, c.detour.z - c.z) < 0.5) c.detour = null;
      else {
        tx = c.detour.x;
        tz = c.detour.z;
      }
    }
    const moved = this.moveToward(c, tx, tz, dt, tx === tx0 ? stopDistance : 0.4);
    // Seguimiento del progreso real (no de la distancia en línea recta): sin avance, sube "blocked".
    const nominal = this.speedOf(c) * dt;
    if (moved < nominal * 0.25) c.blocked = (c.blocked ?? 0) + dt;
    else c.blocked = Math.max(0, (c.blocked ?? 0) - dt * 2);
    // Moverse sin acercarse (lo empujan de un lado a otro) también es estar atascado: se mide el avance hacia el destino.
    const prog = c.progress;
    if (!prog || prog.tx !== tx0 || prog.tz !== tz0) {
      c.progress = { tx: tx0, tz: tz0, best: finalDist, t: 0 };
    } else if (finalDist < prog.best - 0.3) {
      prog.best = finalDist;
      prog.t = 0;
    } else {
      prog.t += dt;
      if (prog.t > 4) c.blocked = Math.max(c.blocked, 1 + (prog.t - 4));
    }
    c.moveTick = c.moveTick || moved > nominal * 0.3;
    const b = c.blocked;
    if (b > 12) return this.giveUp(c, 'No logra pasar: algo le cierra el camino');
    if (b > 7 && !c.recalc) {
      c.recalc = true; // recalcular el tramo
      c.path = null;
      c.detour = null;
    } else if (b > 3.5 && !c.detour) {
      const spot = this.detourPoint(c, tx0, tz0);
      if (spot) c.detour = { x: spot.x, z: spot.z, t: 3 };
    } else if (b > 1 && !c.detour) {
      // Apartarse un paso a un costado para dejar pasar.
      const dx = tx0 - c.x;
      const dz = tz0 - c.z;
      const l = Math.hypot(dx, dz) || 1;
      for (const side of [1, -1]) {
        const px = c.x + (dz / l) * side * 1.3;
        const pz = c.z - (dx / l) * side * 1.3;
        if (this.walkable(px, pz, COLONIST_RADIUS + 0.1)) {
          c.detour = { x: px, z: pz, t: 1.6 };
          break;
        }
      }
    }
    if (b < 0.2) c.recalc = false;
    if (b > 1.2) c.waiting = true;
    return 'moving';
  }

  speedOf(c) {
    return WALK_SPEED * (0.85 + gene(c.genome, 'agility') * 0.3) * roadSpeed(this, c.x, c.z);
  }

  // Llegar sin quedar encimado a otro que ya está parado: primero se corre al hueco libre más cercano (unos segundos como mucho).
  settle(c, dt) {
    let over = false;
    this.eachNear(c, COLONIST_RADIUS * 1.7, () => (over = true));
    c.settleT = (c.settleT ?? 0) + dt;
    if (over && c.settleT < 4) {
      this.separate(c);
      c.walking = true;
      return 'moving';
    }
    c.settleT = 0;
    return this.arrive(c);
  }

  arrive(c) {
    c.walking = false;
    c.progress = null;
    c.blocked = 0;
    c.queued = 0;
    c.recalc = false;
    c.detour = null;
    return 'arrived';
  }

  // Suspende la tarea actual por un bloqueo real: la IA elegirá otra cosa y reintentará pasado un rato.
  giveUp(c, why) {
    c.progress = null;
    c.blocked = 0;
    c.queued = 0;
    c.recalc = false;
    c.detour = null;
    c.stuckWhy = why;
    return 'stuck';
  }

  // Un paso hacia (tx, tz) con evasión local. Devuelve cuánto avanzó de verdad.
  moveToward(c, tx, tz, dt, stopDistance) {
    const gx = tx - c.x;
    const gz = tz - c.z;
    const dist = Math.hypot(gx, gz);
    if (dist < 1e-4) return 0;
    const ox = c.x;
    const oz = c.z;
    let dx = gx / dist;
    let dz = gz / dist;
    const gdx = dx;
    const gdz = dz;
    const steer = (px0, pz0, r, strength) => {
      const px = c.x - px0;
      const pz = c.z - pz0;
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
    // Los demás colonos: quien tiene prioridad apenas se desvía; el otro rodea por su derecha (así dos que vienen de
    // frente no eligen el mismo lado) y afloja si lo tiene encima, para que el primero pase.
    let slow = 1;
    const reach = COLONIST_RADIUS * 2 + 1.6;
    let lx = 0;
    let lz = 0;
    this.eachNear(c, reach, (o, d) => {
      const px = c.x - o.x;
      const pz = c.z - o.z;
      const ahead = -(px * gdx + pz * gdz) / (d || 1e-3);
      if (ahead < -0.1) return false; // quedó atrás
      const w = (reach - d) / reach;
      const mine = o.moving && c.id < o.id; // los dos andan y yo tengo el número menor
      const k = mine ? 0.25 : 1.5;
      const f = w * k * Math.min(1, ahead + 0.4);
      lx += gdz * f; // derecha del rumbo
      lz -= gdx * f;
      if (!mine && o.moving && d < COLONIST_RADIUS * 2.4 && ahead > 0.6) slow = Math.min(slow, 0.3);
      return false;
    });
    dx += lx;
    dz += lz;
    let len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // Nunca de espaldas al destino mientras esquiva: el giro se limita a unos 75°.
    const dot = dx * gdx + dz * gdz;
    if (dot < 0.25) {
      const sx = dx - dot * gdx;
      const sz = dz - dot * gdz;
      const sl = Math.hypot(sx, sz) || 1;
      dx = gdx * 0.25 + (sx / sl) * 0.968;
      dz = gdz * 0.25 + (sz / sl) * 0.968;
      len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
    }

    const step = Math.min(this.speedOf(c) * slow * dt, Math.max(0, dist - stopDistance * 0.5));
    let nx = c.x + dx * step;
    let nz = c.z + dz * step;
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
    this.separate(c);
    this.face(c, Math.atan2(dx, dz), dt);
    return Math.hypot(c.x - ox, c.z - oz);
  }

  // Separación: si dos colonos quedaron encimados, el de menos prioridad se corre un poco (o el que se mueve, si el otro
  // está parado). Sólo a un sitio transitable, sin entrar en obstáculos ni en el agua.
  separate(c) {
    const min = COLONIST_RADIUS * 1.7;
    this.eachNear(c, min, (o, d) => {
      const yields = !o.moving ? true : c.id > o.id;
      if (!yields) return false;
      const px = c.x - o.x || (c.id > o.id ? 1e-3 : -1e-3);
      const pz = c.z - o.z;
      const l = Math.hypot(px, pz) || 1e-3;
      const push = Math.min((min - d) * 0.5, 0.06);
      const nx = c.x + (px / l) * push;
      const nz = c.z + (pz / l) * push;
      if (this.walkable(nx, nz, COLONIST_RADIUS * 0.9)) {
        c.x = nx;
        c.z = nz;
      }
      return false;
    });
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
    c.sitting = null; // 'ground' | 'bench' mientras se calienta sentado (lo fija la tarea cada paso)
    c.waiting = false;
    c.moveTick = false;
    c.thinkTimer -= dt;
    if (c.thinkTimer <= 0 || !c.task) {
      c.thinkTimer = 1.5 + c.rand() * 0.5;
      const best = chooseTask(this, c, env);
      if (best && (!c.task || shouldSwitch(c.task, best))) this.startTask(c, best, env);
    }
    if (c.task) {
      const result = runTask(this, c, c.task, dt, env);
      if (result === 'done' || result === 'failed') {
        const key = taskKey(c.task);
        const need = NEED_OF_TASK[c.task.type];
        if (result === 'failed') {
          // Reintentar la misma tarea tarda cada vez más (40, 80, 160 s) salvo que cambie un obstáculo (wallRev).
          const n = c.avoidN?.key === key ? c.avoidN.n + 1 : 1;
          c.avoidN = { key, n };
          c.avoid = { key, until: env.gameTime + Math.min(160, 40 * 2 ** (n - 1)), rev: this.wallRev };
          if (need) c.block = { need, why: failReason(this, c, c.task), at: env.gameTime };
        } else {
          if (c.avoidN?.key === key) c.avoidN = null;
          if (need && c.block?.need === need) c.block = null;
        }
        endTask(this, c, c.task);
        c.task = null;
        c.thinkTimer = result === 'failed' ? 0.5 : 0;
      }
    }
    if (c.block && (c.needs[c.block.need] >= 75 || env.gameTime - c.block.at > 240)) c.block = null;
    // Lo que se ve moverse es el desplazamiento real, no la intención de caminar: así un colono frenado no camina en el lugar.
    c.moveEma = (c.moveEma ?? 0) + ((c.moveTick ? 1 : 0) - (c.moveEma ?? 0)) * Math.min(1, dt * 5);
    c.moving = c.moving ? c.moveEma > 0.2 : c.moveEma > 0.5;
    // Punto seguro: sin tarea de trabajo en curso (o con una orden directa) se aplica el cambio de especialidades.
    if (c.pendingSpec && (!c.task || !WORK_TYPES.has(c.task.type) || c.task.ordered)) this.applySpec(c);
    if (isWorker(c) && !c.spec) specOf(this, c);
    // Práctica: trabajar sube poco a poco el nivel de esa categoría (también con una orden temporal).
    if (c.working && c.task && WORK_TYPES.has(c.task.type)) this.practice(c, c.task, dt);
    c.activity = c.task ? taskActivity(this, c, c.task) : 'Descansando un momento';
    if (c.task?.type === 'wander' && c.idle) c.activity = c.idle;
    if (c.waiting && c.task) c.activity += ' (esperando paso)';
    c.orderState = !c.order ? null : c.task?.ordered ? 'active' : 'interrupted';
    if (c.orderState === 'interrupted') c.activity += ' (orden en pausa: necesidad urgente)';
  }

  // ---- Obras y órdenes directas ----------------------------------------------------------

  // Estado visible de una obra: { state, label, why } (se calcula aquí o llega del servidor).
  siteInfo(b) {
    return b.site ?? siteStatus(this, b, this.nightNow);
  }

  setPriority(b, level) {
    if (this.remote) return this.remote('setPriority', [b.id, level]);
    if (!PRIORITY[level] || b.done) return false;
    b.priority = level;
    this.emit('buildings');
    return true;
  }

  // Pausar o reanudar una obra: pausada, nadie la construye (las órdenes sobre ella se cancelan).
  pauseSite(b, paused) {
    if (this.remote) return this.remote('pauseSite', [b.id, !!paused]);
    if (b.done) return false;
    b.paused = !!paused;
    if (b.paused) for (const c of this.colonists) if (c.order?.kind === 'build' && c.order.building === b.id) this.finishOrder(c, 'la obra se pausó');
    this.emit('buildings');
    return true;
  }

  // Dar una orden a un colono: { kind: 'build', building } o { kind: 'harvest' }.
  orderColonist(c, kind, building = null) {
    const why = orderProblem(this, c, kind, building);
    if (why) return why;
    if (this.remote) {
      this.remote('orderColonist', [c.id, kind, building?.id ?? null]);
      return null;
    }
    c.order = kind === 'build' ? { kind, building: building.id } : { kind };
    addLog(c, this.timeLabel(), kind === 'build' ? `Recibió la orden de construir: ${building.name}` : 'Recibió la orden de recolectar lo marcado');
    c.thinkTimer = 0;
    this.emit('buildings');
    return null;
  }

  cancelOrder(c) {
    if (this.remote) return this.remote('cancelOrder', [c.id]);
    if (!c.order) return false;
    this.finishOrder(c, 'el jugador canceló la orden');
    return true;
  }

  // Terminada o cancelada la orden, el colono vuelve a decidir solo.
  finishOrder(c, why) {
    if (!c.order) return;
    c.order = null;
    c.orderState = null;
    if (c.task?.ordered) c.task.ordered = false;
    addLog(c, this.timeLabel(), `Terminó su orden (${why})`);
  }

  // ---- Especialidades ----------------------------------------------------------------------

  // Categoría de lo que hace en una tarea de trabajo.
  categoryOf(task) {
    if (task.type === 'build') return 'building';
    if (task.type === 'work') return task.building.def.skill;
    if (task.type === 'harvest') return spotCategory(task.spot, this.age);
    return null;
  }

  practice(c, task, dt) {
    const cat = this.categoryOf(task);
    if (!cat || c.skills[cat] === undefined) return;
    c.xp ??= {};
    c.xp[cat] = (c.xp[cat] ?? 0) + dt;
    // Sube un nivel con ~12 minutos de práctica por nivel actual (máx. 10).
    if (c.xp[cat] >= 240 * (c.skills[cat] + 2) && c.skills[cat] < 10) {
      c.xp[cat] = 0;
      c.skills[cat]++;
      this.skillsRevision = (this.skillsRevision ?? 0) + 1;
    }
  }

  // Pedir un cambio de especialidades (tres distintas, en orden de prioridad). Se aplica al llegar a un punto
  // seguro: no se pierde experiencia ni se interrumpe la acción en curso.
  setSpec(c, list) {
    if (!c || !isWorker(c) || !validSpec(list)) return false;
    if (this.remote) {
      this.remote('setSpec', [c.id, list]);
      return true;
    }
    const cur = specOf(this, c);
    if (cur.join() === list.join()) {
      c.pendingSpec = null;
      return true;
    }
    c.pendingSpec = [...list];
    if (!c.task || !WORK_TYPES.has(c.task.type) || c.task.ordered) this.applySpec(c);
    this.emit('changed');
    return true;
  }

  applySpec(c) {
    if (!c.pendingSpec) return;
    c.spec = c.pendingSpec;
    c.pendingSpec = null;
    addLog(c, this.timeLabel(), `Nuevas especialidades: ${c.spec.map((id) => SPEC_NAMES[id]).join(', ')}`);
    // Si su puesto asignado solo se le dio automáticamente y ya no es de sus especialidades, lo deja libre.
    if (c.job && c.jobAuto && !c.spec.includes(c.job.def.skill)) {
      const b = c.job;
      b.workers = b.workers.filter((w) => w !== c);
      c.job = null;
      b.reason = `${c.name} cambió de especialidades.`;
      this.emit('buildings');
    }
    this.emit('changed');
  }

  coverage() {
    return coverage(this);
  }

  waitReason(c) {
    return waitReason(this, c);
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
        addTile(key, generateTile(i, jw, cols), CAMP_CLEAR);
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
        const type = RESOURCE_TYPES[tile.type[k]].id;
        spots.push({ key, index: k, kind, type, tree: TREES.includes(type), bigRock: BIG_ROCKS.includes(type), stick: type === 'sticks', x: p.x, z: p.z, readyAt: 0, taken: null });
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
    let cap = CAMP_CAPACITY[kind] ?? CAMP_OTHER_CAPACITY;
    for (const b of this.buildings) {
      if (!b.done && !b.upgrading) continue;
      const lv = b.def.levels[b.level - 1];
      // Los pozos también tienen "capacity" (un número: las jarras del recolector de lluvia); sólo
      // cuentan los almacenes, cuya capacidad es una tabla por recurso.
      if (!lv || typeof lv.capacity !== 'object') continue;
      cap += lv.capacity[kind] ?? lv.other ?? 0;
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
    for (const k of Object.keys(this.stock)) if ((this.stock[k] ?? 0) > 0 || CAMP_CAPACITY[k]) fill = Math.max(fill, Math.min(1, this.indoor(k) / this.capacity(k)));
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

  // Cada doceava parte del día se guarda lo que entró y salió del almacén; así se calcula la
  // producción y el consumo por día de forma estable.
  rollFlows(dt) {
    this.flowTimer += dt;
    const bucket = DAY_LENGTH_SECONDS / 12;
    while (this.flowTimer >= bucket) {
      this.flowTimer -= bucket;
      this.flowBuckets.push(this.flow);
      this.flow = { in: {}, out: {} };
      if (this.flowBuckets.length > 12) this.flowBuckets.shift();
    }
  }

  // Producción y consumo por día: { in: { bien: n }, out: { bien: n } }.
  flowRates() {
    const buckets = this.flowBuckets;
    const out = { in: {}, out: {} };
    if (!buckets.length) return out;
    const scale = 12 / buckets.length;
    for (const b of buckets) for (const side of ['in', 'out']) for (const [k, v] of Object.entries(b[side])) out[side][k] = (out[side][k] ?? 0) + v * scale;
    for (const side of ['in', 'out']) for (const k of Object.keys(out[side])) out[side][k] = Math.round(out[side][k] * 10) / 10;
    return out;
  }

  // Guarda lo producido por un edificio o una tarea y lo anota en los totales de la partida
  // (las edades piden haber producido ciertos bienes; lo comprado no cuenta).
  produce(kind, amount) {
    const added = this.addStock(kind, amount);
    this.produced[kind] = (this.produced[kind] ?? 0) + added;
    this.flow.in[kind] = (this.flow.in[kind] ?? 0) + added;
    return added;
  }

  // Saca del almacén: primero lo que está al aire libre (y la comida más vieja).
  takeStock(kind, amount) {
    const n = Math.min(amount, this.stock[kind] ?? 0);
    this.stock[kind] -= n;
    this.flow.out[kind] = (this.flow.out[kind] ?? 0) + n;
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
    this.pruneRoads();
    this.trimOutdoor();
    this.emit('zones');
    this.emit('changed');
    return null;
  }

  // Quita los caminos que pisan la zona de acopio (no se vuelven a trazar solos ahí).
  pruneRoads() {
    if (this.remote) return;
    let n = 0;
    for (const key of [...this.roads.keys()]) {
      const [ix, iz] = key.split(',').map(Number);
      if (this.zones.some((z) => rectDistance(z, ix * 4, iz * 4) < 2.4)) {
        this.roads.delete(key);
        this.autoRoadKeys.delete(key);
        n++;
      }
    }
    if (n) {
      this.staticsRevision++;
      this.emit('roads');
    }
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

  // Ponerle nombre a la aldea (en el navegador se manda al servidor, que lo valida y lo guarda).
  setVillageName(name) {
    if (!this.camp) return false;
    if (this.remote) {
      this.remote('setVillageName', [name]);
      return true;
    }
    return this.applyCommand('setVillageName', [name]);
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
    this.ageChangedAt = this.gameTime;
    // Las viviendas evolucionan solas (mismo sitio, sin pagar); el resto se mejora a mano.
    // La ropa evoluciona sola: nadie se queda sin vestir al cambiar de edad.
    if (this.clothesLeft > 0 || this.colonists.some((c) => !c.clothed)) {
      for (const c of this.colonists) c.clothed = true;
      this.clothesLeft = 0;
      this.emit('clothes');
    }
    this.refreshAutoRoads();
    const evolved = evolveHouses(this);
    if (evolved) {
      this.emit('buildings');
      this.emit('notice', `${evolved === 1 ? 'Una vivienda evolucionó' : `${evolved} viviendas evolucionaron`} con la ${status.next.name}`);
    }
    for (const c of this.colonists) {
      addLog(c, time, `Celebró la llegada de la ${status.next.name}`);
      addMoodEvent(c, 'age', 25, this.gameTime);
    }
    this.emit('changed');
    return true;
  }

  setAge(age) {
    this.age = age;
    this.refreshObstacles();
    this.emit('age', age);
  }

  // Radio del territorio de la aldea (metros desde la fogata).
  get territoryRadius() {
    return radiusOf(this);
  }

  // Por qué no se puede ampliar el territorio (o null) y su coste.
  get expansionBlocker() {
    return expansionBlocker(this);
  }

  get expansionCost() {
    return expansionCost(this);
  }

  // Comprar una ampliación de territorio: más radio donde construir. El servidor comprueba que
  // no pise el de otro jugador (claimProblem).
  expandTerritory() {
    if (expansionBlocker(this)) return false;
    if (this.remote) {
      this.remote('expandTerritory', []);
      return true;
    }
    for (const [k, n] of Object.entries(expansionCost(this))) this.takeStock(k, n);
    this.expansions++;
    this.emit('territory', radiusOf(this));
    this.emit('notice', `El territorio de la aldea llega ahora a ${radiusOf(this)} m`);
    this.emit('changed');
    return true;
  }

  // Coste de construir un tipo hoy (la vivienda de edades avanzadas cuesta más).
  costOf(def) {
    return buildCostOf(def, this.age);
  }

  // Por qué no se puede construir un tipo ahora (edad, edificios previos, límites), o null.
  buildBlocker(def) {
    return buildBlocker(this, def);
  }

  // Por qué no crece la población (sin plazas, reservas o servicios), o null.
  get growthBlocker() {
    return growthBlocker(this);
  }

  // Por qué no llega gente nueva a la aldea, o null.
  get immigrationBlocker() {
    return immigrationBlocker(this);
  }

  get ageInfo() {
    return ageInfo(this.age);
  }

  // ---- Estaciones -------------------------------------------------------------------------

  // La estación de este campamento en este momento (la fija el mundo; ver sim/calendar.js).
  setSeason(season) {
    this.season = season;
  }

  // Temperatura del campamento en esta época (escala de biomes.js).
  get currentTemperature() {
    return this.season ? effectiveTemperature(this.campTemperature, this.season) : this.campTemperature;
  }

  // Cuánto crece lo que se siembra y rebrota ahora: 0,15 con helada, 1 en una buena época.
  growth() {
    return this.season ? growthFactor(this.currentTemperature, this.season) : 1;
  }

  // ¿Nevaría aquí ahora si precipitara? (frío de verdad en esta época)
  get snowing() {
    return snowCover(this.currentTemperature) > 0.35;
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
    if (rain < 0.3 || this.wildSprouts() >= MAX_SPROUTS) return;
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
      // Sólo fuera del claro del campamento y de lo construido: ahí el mundo no dibuja recursos, y un
      // brote que existe para los colonos pero no se ve era el "recurso invisible".
      const item = sproutItem(dir.x, dir.y, dir.z, type, rand() * Math.PI * 2, CAMP_CLEAR + 4 + rand() * 70, rand);
      if (!item) continue;
      const r = RADIUS + item.h;
      this.toLocal(p.set(item.d[0] * r, item.d[1] * r, item.d[2] * r), p);
      if (this.resourceSiteProblem(p.x, p.z)) continue;
      this.addSprout(item);
      const name = type === 'berryBush' ? 'un arbusto de bayas' : 'unas setas';
      this.emit('notice', `Con la lluvia brotó ${name} cerca del campamento.`);
      return true;
    }
    return false;
  }

  // Rehace la baldosa de brotes y añade los puntos de recolección nuevos (los brotes sólo
  // se agregan al final, así que los ya conocidos conservan su índice). Sirve tanto para la
  // vegetación que brota con la lluvia como para los árboles que nacen de una semilla.
  refreshSprouts() {
    const tile = tileFromItems(this.sprouts);
    this.sproutTile = tile.count ? tile : null;
    const known = this.spots.filter((s) => s.key === SPROUT_KEY).length;
    const p = new THREE.Vector3();
    for (let k = known; k < tile.count; k++) {
      this.toLocal(p.set(tile.pos[k * 3], tile.pos[k * 3 + 1], tile.pos[k * 3 + 2]), p);
      const type = RESOURCE_TYPES[tile.type[k]].id;
      const kind = KIND_OF_TYPE[type] || 'food';
      this.spots.push({ key: SPROUT_KEY, index: k, kind, type, tree: TREES.includes(type), bigRock: BIG_ROCKS.includes(type), stick: type === 'sticks', x: p.x, z: p.z, readyAt: this.sprouts[k]?.readyAt ?? 0, taken: null });
    }
    this.emit('resources');
  }

  // Un lugar donde el colono de una Cabaña del leñador (o mejor) puede plantar una semilla: dentro del radio de
  // acción de su edificio, libre de edificios, zona de acopio, caminos y otros árboles. Null si no hay ninguno
  // (o ya hay demasiados brotes). Sólo en el servidor.
  plantSpotFor(c, building) {
    if (this.remote || !building || this.plantedSprouts() >= MAX_PLANTED) return null;
    const reach = building.def.range ?? 0;
    const first = (building.def.footprint ?? 3) + 2;
    if (reach <= first) return null;
    for (let k = 0; k < 10; k++) {
      const a = c.rand() * Math.PI * 2;
      const r = first + Math.sqrt(c.rand()) * (reach - first - 1);
      const x = building.x + Math.cos(a) * r;
      const z = building.z + Math.sin(a) * r;
      if (this.plantProblem(x, z, building)) continue;
      return { x, z };
    }
    return null;
  }

  // "building": el edificio del que planta (si se indica, el lugar debe estar dentro de su radio de acción).
  plantProblem(x, z, building = null) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 'Lugar no válido';
    if (Math.hypot(x, z) > SPOT_RADIUS) return 'Demasiado lejos de la aldea';
    if (building && Math.hypot(x - building.x, z - building.z) > (building.def.range ?? 0)) return 'Fuera del radio de acción del leñador';
    return this.resourceSiteProblem(x, z);
  }

  // Cuánto sube quien camina sobre un camino: la cinta se dibuja ROAD_LIFT por encima del terreno, así que hay que subir
  // los pies con ella (0 fuera de los caminos). La vista lo suaviza al entrar y salir.
  roadLiftAt(x, z) {
    if (!this.roads.size) return 0;
    const [cx, cz] = roadCellOf(x, z);
    if (!this.roads.has(roadKey(cx, cz))) return 0;
    return Math.abs(x - cx * ROAD_CELL) < 1.9 && Math.abs(z - cz * ROAD_CELL) < 1.9 ? ROAD_LIFT : 0;
  }

  // ¿Hay un camino pegado a (x, z)? La cinta mide 3,4 m y sigue las curvas entre casillas de 4 m: se mira la casilla y sus
  // vecinas con un margen para que ningún tronco o brote asome sobre el camino.
  nearRoad(x, z, margin = 0.8) {
    if (!this.roads.size) return false;
    const [cx, cz] = roadCellOf(x, z);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        if (!this.roads.has(roadKey(ix, iz))) continue;
        if (Math.abs(x - ix * ROAD_CELL) < ROAD_CELL / 2 + margin && Math.abs(z - iz * ROAD_CELL) < ROAD_CELL / 2 + margin) return true;
      }
    }
    return false;
  }

  // Dónde puede nacer un recurso nuevo (brote de lluvia, árbol plantado, ramas o piedras del suelo):
  // sólo donde el mundo lo va a dibujar y donde no estorba. Es la única regla: la usan todos, así
  // lo que existe para los colonos siempre se ve (null = se puede).
  resourceSiteProblem(x, z) {
    if (Math.hypot(x, z) < CAMP_CLEAR + 3) return 'Es el claro del campamento';
    if (!this.walkable(x, z, 1.2) || this.blockedByBuilding(x, z)) return 'Ahí no se puede';
    if (this.heightAt(x, z) <= 0.8) return 'Es agua';
    if (this.zones.some((zone) => rectDistance(zone, x, z) < 3)) return 'Es la zona de acopio';
    if (this.nearRoad(x, z)) return 'Es un camino';
    if (this.accessBlocked?.(x, z)) return 'Es el acceso de un edificio';
    for (const s of this.spots) if (!s.gone && Math.hypot(s.x - x, s.z - z) < 2.5) return 'Ya hay un recurso ahí';
    return null;
  }

  // Brotes vivos (los consumidos quedan como huecos en el arreglo hasta limpiarlo).
  liveSprouts() {
    return this.sprouts.length - (this.removed.get(SPROUT_KEY)?.size ?? 0);
  }

  // Los espontáneos (lluvia, ramas, piedrecitas) y los plantados (tienen "sown") se cuentan aparte: un bosque plantado
  // no debe dejar sin ramas ni brotes a la aldea.
  countSprouts(planted) {
    const gone = this.removed.get(SPROUT_KEY);
    let n = 0;
    for (let i = 0; i < this.sprouts.length; i++) if (!gone?.has(i) && Number.isFinite(this.sprouts[i].sown) === planted) n++;
    return n;
  }

  wildSprouts() {
    return this.countSprouts(false);
  }

  plantedSprouts() {
    return this.countSprouts(true);
  }

  // El leñador replanta: donde cayó un árbol nace un brote de la misma especie, que tarda en crecer y no se puede talar
  // hasta entonces (se dibuja pequeño). Sólo en el servidor. Devuelve true si plantó.
  replantAt(spot, gameTime) {
    if (this.remote || !spot?.tree || !this.camp) return false;
    if (this.plantedSprouts() >= MAX_PLANTED) return false;
    const typeIndex = RESOURCE_TYPES.findIndex((t) => t.id === spot.type);
    const info = RESOURCE_TYPES[typeIndex];
    if (!info) return false;
    for (let k = 0; k < 4; k++) {
      // Junto al tocón (a veces unos pasos a un lado, para no quedar exactamente igual).
      const x = spot.x + (k ? (Math.random() - 0.5) * 3 : 0);
      const z = spot.z + (k ? (Math.random() - 0.5) * 3 : 0);
      if (this.resourceSiteProblem(x, z)) continue;
      const p = new THREE.Vector3();
      this.toDirection(x, z, p);
      this.addSprout({
        typeIndex,
        d: [p.x, p.y, p.z],
        h: surfaceHeight(p),
        yaw: Math.random() * Math.PI * 2,
        scale: info.scale[0] + Math.random() * (info.scale[1] - info.scale[0]),
        tint: 0.85 + Math.random() * 0.3,
        rank: 0,
        readyAt: gameTime + SAPLING_GROW_SECONDS,
        sown: gameTime,
      });
      this.emit('changed');
      return true;
    }
    return false;
  }

  addSprout(item) {
    if (this.sprouts.length >= SPROUT_ARRAY_MAX && !this.remote) this.compactSprouts();
    this.staticsRevision++;
    this.sprouts.push(item);
    this.refreshSprouts();
    return this.spots.find((s) => s.key === SPROUT_KEY && s.index === this.sprouts.length - 1);
  }

  // Ramas caídas o piedrecitas sueltas junto a un edificio de recolección que se quedó sin recursos:
  // son recursos de verdad (se ven y se consumen), no un trabajo sobre el suelo vacío.
  spawnLitter(kind, near) {
    if (this.remote || this.wildSprouts() >= MAX_SPROUTS) return null;
    const type = kind === 'stone' ? 'pebbles' : 'sticks';
    const typeIndex = RESOURCE_TYPES.findIndex((t) => t.id === type);
    const info = RESOURCE_TYPES[typeIndex];
    const p = new THREE.Vector3();
    // Dentro de su alcance (lo que el edificio alcanza a recoger) y fuera del claro del campamento, donde no se dibuja nada:
    // una zona de leña cerca de la fogata antes no podía generar ramas nunca y decía que no había palos.
    const reach = Math.max(12, (near.def?.range ?? 40) - 6);
    const first = (near.def?.footprint ?? 3) + 3;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = first + Math.random() * Math.max(6, Math.min(reach, k < 10 ? 20 : 60) - first);
      const x = near.x + Math.cos(a) * r;
      const z = near.z + Math.sin(a) * r;
      if (this.resourceSiteProblem(x, z)) continue;
      this.toDirection(x, z, p);
      return this.addSprout({
        typeIndex,
        d: [p.x, p.y, p.z],
        h: surfaceHeight(p),
        yaw: Math.random() * Math.PI * 2,
        scale: info.scale[0] + Math.random() * (info.scale[1] - info.scale[0]),
        tint: 0.85 + Math.random() * 0.3,
        rank: 0,
        readyAt: 0,
      });
    }
    return null;
  }

  // Limpia del arreglo los brotes ya consumidos conservando marcas, reservas y tiempos de los vivos.
  // Sólo en el servidor: los clientes reciben el arreglo ya limpio (rebuildSprouts).
  compactSprouts(dropIf = null) {
    const gone = this.removed.get(SPROUT_KEY) ?? new Set();
    const keep = [];
    const newToOld = new Map();
    this.sprouts.forEach((it, i) => {
      if (gone.has(i) || (dropIf && dropIf(it, i))) return;
      newToOld.set(keep.length, i);
      keep.push(it);
    });
    if (keep.length === this.sprouts.length) return;
    this.staticsRevision++;
    const old = new Map(this.spots.filter((s) => s.key === SPROUT_KEY).map((s) => [s.index, s]));
    this.sprouts = keep;
    this.removed.delete(SPROUT_KEY);
    this.rebuildSprouts();
    for (const s of this.spots) {
      if (s.key !== SPROUT_KEY) continue;
      const o = old.get(newToOld.get(s.index));
      if (o) Object.assign(s, { marked: o.marked, taken: o.taken, readyAt: o.readyAt });
    }
    this.emit('marks');
  }

  // Rehace todos los puntos de recolección de los brotes desde el arreglo.
  rebuildSprouts() {
    this.spots = this.spots.filter((s) => s.key !== SPROUT_KEY);
    this.refreshSprouts();
  }

  // Aldeas guardadas antes de esta regla: los brotes que nacieron donde el mundo no los dibuja
  // (el claro del campamento) se descartan, y los consumidos se limpian. Repetible: sobre datos ya
  // limpios no cambia nada. Devuelve una copia de los datos con las referencias por índice rehechas.
  migrateSprouts(data) {
    const items = (Array.isArray(data.sprouts) ? data.sprouts : []).filter((it) => Number.isInteger(it.typeIndex) && RESOURCE_TYPES[it.typeIndex]);
    const gone = new Set((data.removed || []).find(([key]) => key === SPROUT_KEY)?.[1] ?? []);
    const p = new THREE.Vector3();
    const keep = [];
    const remap = new Map();
    items.forEach((it, i) => {
      if (gone.has(i)) return;
      const r = RADIUS + (it.h ?? 0);
      this.toLocal(p.set(it.d[0] * r, it.d[1] * r, it.d[2] * r), p);
      if (Math.hypot(p.x, p.z) < CAMP_CLEAR + 0.5) return; // nunca se dibujó
      remap.set(i, keep.length);
      keep.push(it);
    });
    const fix = (list) => (list || []).filter(([key, index]) => key !== SPROUT_KEY || remap.has(index)).map(([key, index, ...rest]) => (key === SPROUT_KEY ? [key, remap.get(index), ...rest] : [key, index, ...rest]));
    return {
      ...data,
      sprouts: keep.slice(0, SPROUT_ARRAY_MAX),
      removed: (data.removed || []).filter(([key]) => key !== SPROUT_KEY),
      marked: fix(data.marked),
      regrowing: fix(data.regrowing),
    };
  }

  // Un colono planta una semilla de árbol (gastada del almacén): nace el árbol propio del
  // bioma de ese lugar, y tarda en crecer antes de poder talarse. Null si se pudo, o el motivo.
  // Sólo la llaman los colonos (la IA corre en el servidor): no hay plantación manual.
  plantTreeSeed(x, z, gameTime, building = null) {
    if ((this.stock.tree_seed ?? 0) < 1) return 'No quedan semillas de árbol';
    const problem = this.plantProblem(x, z, building);
    if (problem) return problem;
    if (this.plantedSprouts() >= MAX_PLANTED) return 'Ya hay demasiados árboles plantados esperando a crecer';
    const p = new THREE.Vector3();
    this.toDirection(x, z, p);
    const biome = biomeAt(p.x, p.y, p.z).id;
    const options = GROVE_TREES[biome] || ['broadleaf', 'broadleaf', 'pine'];
    const species = options[Math.floor(Math.random() * options.length)];
    const typeIndex = RESOURCE_TYPES.findIndex((t) => t.id === species);
    const type = RESOURCE_TYPES[typeIndex];
    const h = surfaceHeight(p);
    this.takeStock('tree_seed', 1);
    const sprout = {
      typeIndex,
      d: [p.x, p.y, p.z],
      h,
      yaw: Math.random() * Math.PI * 2,
      scale: type.scale[0] + Math.random() * (type.scale[1] - type.scale[0]),
      tint: 0.85 + Math.random() * 0.3,
      rank: 0,
      readyAt: gameTime + SAPLING_GROW_SECONDS,
      sown: gameTime,
    };
    this.addSprout(sprout);
    this.emit('changed');
    return null;
  }

  // ¿Se puede recoger este sitio ahora? Los árboles y las rocas grandes sólo desde la Edad de
  // Piedra (antes: palos del suelo y piedrecitas sueltas).
  usable(s) {
    return (!s.tree && !s.bigRock) || this.age >= 2;
  }

  // El recurso libre de un tipo más cercano a un punto (o null).
  nearestSpot(kind, x, z, maxDistance = Infinity, gameTime = 0) {
    let best = null;
    let bestD = maxDistance;
    for (const s of this.spots) {
      if (s.kind !== kind || s.gone || s.taken || s.readyAt > gameTime || !this.usable(s)) continue;
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
      if (Math.hypot(x - b.x, z - b.z) < resourceClearOf(b.def)) return true;
    }
    return false;
  }

  // ---- Órdenes de recolección ---------------------------------------------------------------

  // Recursos marcados para recolectar (herramienta de recolección).
  nearestMarked(x, z, gameTime, allow = null) {
    if (!this.markedCount) return null;
    let best = null;
    let bestD = Infinity;
    for (const s of this.spots) {
      if (!s.marked || s.gone || s.taken || s.readyAt > gameTime || !this.usable(s)) continue;
      if (this.isFull(s.kind) || this.blockedByBuilding(s.x, s.z) || (allow && !allow(s))) continue;
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
  markRect(rect, marked, kinds = null) {
    this.remote?.('markRect', [rect, marked, kinds]);
    let changed = 0;
    for (const s of this.spots) {
      if (s.gone || !this.usable(s) || !insideRect(rect, s.x, s.z) || (kinds && !kinds.includes(s.kind))) continue;
      // Si está pegado a un edificio nunca se va a poder recolectar (nearestMarked lo salta):
      // no lo marques, para no dejar un "marcado" que nunca se cumple.
      if (marked && this.blockedByBuilding(s.x, s.z)) continue;
      if (!!s.marked !== marked) {
        s.marked = marked;
        changed++;
      }
    }
    if (changed && marked) this.noteMarked(kinds);
    if (changed) this.marksChanged();
    return changed;
  }

  // Marcar o desmarcar los recursos dentro de un círculo (coordenadas del campamento).
  markArea(x, z, radius, marked, kinds = null) {
    this.remote?.('markArea', [x, z, radius, marked, kinds]);
    let changed = 0;
    for (const s of this.spots) {
      if (s.gone || !this.usable(s) || Math.hypot(s.x - x, s.z - z) > radius || (kinds && !kinds.includes(s.kind))) continue;
      if (marked && this.blockedByBuilding(s.x, s.z)) continue;
      if (!!s.marked !== marked) {
        s.marked = marked;
        changed++;
      }
    }
    if (changed && marked) this.noteMarked(kinds);
    if (changed) this.marksChanged();
    return changed;
  }

  // Marcar una zona queda como acción aprendida (y comida, si se marcó comida).
  noteMarked(kinds) {
    this.noteLearned('zone_marked');
    if ((!kinds || kinds.includes('food')) && this.spots.some((sp) => sp.marked && !sp.gone && sp.kind === 'food')) this.noteLearned('food_marked');
  }

  clearMarks(kinds = null) {
    this.remote?.('clearMarks', [kinds]);
    for (const s of this.spots) if (!kinds || kinds.includes(s.kind)) s.marked = false;
    this.marksChanged();
  }

  marksChanged() {
    this.emit('marks');
    this.emit('changed');
  }

  // Un recurso usado: los árboles y las piedras desaparecen; las bayas vuelven a crecer.
  consumeSpot(spot, gameTime) {
    spot.taken = null;
    const wasMarked = spot.marked;
    if (spot.marked) {
      spot.marked = false;
      this.emit('marks');
    }
    if (wasMarked && !this.spots.some((o) => o.marked && !o.gone)) this.emit('notice', 'Se recogió todo lo marcado: señala otra zona si hace falta');
    if (spot.kind === 'food') {
      spot.readyAt = gameTime + REGROW_SECONDS / this.growth();
    } else {
      spot.gone = true;
      let set = this.removed.get(spot.key);
      if (!set) this.removed.set(spot.key, (set = new Set()));
      set.add(spot.index);
      this.emit('resources');
      // Para que un visitante también vea esto ya talado/picado (baldosas normales, arboleda y brotes).
      this.staticsRevision++;
      // Al talar un árbol de verdad, a veces caen semillas: van al almacén y los colonos las
      // plantan solos en su tiempo libre.
      if (spot.tree && Math.random() < SEED_CHANCE) {
        this.produce('tree_seed', 1);
        this.emit('notice', 'Al talar cayeron semillas: los colonos las plantarán solos');
      }
    }
  }

  // ---- Edificios ----------------------------------------------------------------------------

  // Por qué no se puede construir "def" en (x, z), o null si se puede.
  buildProblem(def, x, z, yaw = null) {
    const blocked = buildBlocker(this, def);
    if (blocked) return blocked;
    if (def.deposit && !depositAt(this, def.deposit, x, z)) return `Aquí no hay yacimiento de ${GOOD_NAMES[def.deposit]}: busca las manchas del color del mineral`;
    const cost = buildCostOf(def, this.age);
    if (!this.canAfford(cost)) return `Faltan ${this.missing(cost).join(' y ')}`;
    return this.siteProblem(def, x, z, null, yaw);
  }

  // Hacia dónde mira un edificio: siempre un cuarto de vuelta exacto (los muros no se giran a mano).
  facingFor(def, x, z, yaw = null) {
    if (def.line) return Number.isFinite(yaw) ? yaw : 0;
    return cardinalYaw(Number.isFinite(yaw) ? yaw : Math.atan2(-x, -z));
  }

  // Lo que depende sólo del lugar (yacimiento, territorio, choques, terreno). "self": un edificio
  // que se está moviendo, que no choca consigo mismo.
  siteProblem(def, x, z, self = null, yaw = null) {
    if (def.deposit && !depositAt(this, def.deposit, x, z)) return `Aquí no hay yacimiento de ${GOOD_NAMES[def.deposit]}: busca las manchas del color del mineral`;
    const radius = radiusOf(this);
    if (Math.hypot(x, z) > radius) return `Fuera del territorio de la aldea (${radius} m; se amplía con la edad y comprando territorio)`;
    const r = def.footprint;
    const half = def.line ? null : footprintHalf(r);
    for (const o of this.obstacles) {
      if (self && o.kind === 'building' && o.x === self.x && o.z === self.z) continue;
      // Edificio contra edificio (ninguno de los dos un muro): chocan por casillas, pegados
      // sin hueco de por medio, según cuántas casillas de verdad ocupa cada uno.
      if (half !== null && o.kind === 'building' && !o.line) {
        const oh = footprintHalf(o.r);
        if (Math.abs(x - o.x) < half + oh && Math.abs(z - o.z) < half + oh) return 'Choca con otra construcción';
        continue;
      }
      // Los tramos de un muro se pegan entre sí (sin el margen de 0,8 m de los demás edificios).
      const gap = def.line && o.kind === 'building' && o.line ? -0.1 : 0.8;
      if (Math.hypot(x - o.x, z - o.z) < o.r + r + gap) return 'Choca con otra construcción';
    }
    for (const zone of this.zones) {
      if (rectDistance(zone, x, z) < r + 0.5) return 'Choca con la zona de acopio';
    }
    // Entradas: nada tapa la de este edificio y este edificio no tapa la de ningún otro.
    const facing = this.facingFor(def, x, z, yaw);
    const others = this.buildings.filter((o) => o !== self && !o.removed && !(self && o.x === self.x && o.z === self.z));
    const props = this.obstacles.filter((o) => o.kind !== 'building');
    const blockedAccess = accessProblem(def, x, z, facing, others, props);
    if (blockedAccess) return blockedAccess;
    const entrance = entranceOf(def, x, z, facing);
    if (entrance && this.heightAt(entrance.approach.x, entrance.approach.z) <= 0.8) return 'La entrada da al agua';
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

  // Muros: tramos de 3,2 m a lo largo de una línea de A a B (máx. 60). Cada tramo mira a lo largo de la línea.
  // Extremo libre más cercano de un muro ya puesto (a menos de 3 m): el nuevo tramo se pega ahí.
  wallSnap(def, x, z, excludeId = null, reach = 3) {
    let best = null;
    let bd = reach;
    const h = def.footprint;
    const walls = this.buildings.filter((b) => b.def.id === def.id && b.id !== excludeId);
    for (const b of walls) {
      for (const sgn of [-1, 1]) {
        const ex = b.x + Math.cos(b.yaw) * h * sgn;
        const ez = b.z - Math.sin(b.yaw) * h * sgn;
        const d = Math.hypot(ex - x, ez - z);
        if (d >= bd) continue;
        // Un extremo ya ocupado por otro tramo no admite más.
        const ux = Math.cos(b.yaw) * sgn, uz = -Math.sin(b.yaw) * sgn;
        const taken = walls.some((o) => o !== b && Math.hypot(o.x - (ex + ux * h), o.z - (ez + uz * h)) < 1.2);
        if (!taken) { bd = d; best = { x: ex, z: ez, yaw: b.yaw, sgn }; }
      }
    }
    return best;
  }

  // Un tramo suelto (al colocarlo o moverlo) se pega al extremo libre más cercano y toma su orientación.
  wallSnapPiece(def, x, z, excludeId = null) {
    const snap = this.wallSnap(def, x, z, excludeId, 4.5);
    if (!snap) return null;
    return { x: snap.x + Math.cos(snap.yaw) * snap.sgn * def.footprint, z: snap.z - Math.sin(snap.yaw) * snap.sgn * def.footprint, yaw: snap.yaw };
  }

  wallPlan(def, ax, az, bx, bz) {
    const step = def.footprint * 2;
    let dx = bx - ax, dz = bz - az;
    let len = Math.hypot(dx, dz);
    if (len > 1e-6) { dx /= len; dz /= len; }
    const snap = this.wallSnap(def, ax, az);
    if (snap) {
      // Sale del extremo del muro existente: sigue recto si el arrastre va más o menos en su dirección
      // (o es un solo clic) y, si no, hace esquina; el primer tramo queda pegado, sin hueco.
      const ux = Math.cos(snap.yaw) * snap.sgn, uz = -Math.sin(snap.yaw) * snap.sgn;
      if (len < 0.5 || dx * ux + dz * uz > 0.9) { dx = ux; dz = uz; }
      else if (len < 1e-6) { dx = ux; dz = uz; }
      const ex = snap.x, ez = snap.z; // extremo libre del muro existente
      const along = (bx - ex) * dx + (bz - ez) * dz;
      ax = ex + dx * def.footprint;
      az = ez + dz * def.footprint;
      len = Math.max(0, along - def.footprint);
    } else if (len <= 1e-6) {
      dx = 1; dz = 0;
    }
    const yaw = Math.atan2(-dz, dx);
    const n = Math.min(60, Math.floor(len / step + 1e-6) + 1);
    return Array.from({ length: n }, (_, i) => ({ x: ax + dx * step * i, z: az + dz * step * i, yaw }));
  }

  // Cada tramo con su problema (null = se puede) y el coste acumulado, para la vista previa y para construir.
  wallCheck(def, ax, az, bx, bz) {
    const segs = this.wallPlan(def, ax, az, bx, bz);
    const cost = buildCostOf(def, this.age);
    let have = { ...this.stock };
    let blocked = buildBlocker(this, def);
    let count = 0;
    for (const s of segs) {
      s.problem = blocked || this.siteProblem(def, s.x, s.z);
      if (!s.problem) {
        const lack = Object.entries(cost).find(([k, n]) => (have[k] ?? 0) < n);
        if (lack) {
          s.problem = `Faltan ${GOOD_NAMES[lack[0]] ?? lack[0]}`;
          blocked = blocked || s.problem; // los siguientes tampoco se pagan
        } else {
          for (const [k, n] of Object.entries(cost)) have[k] -= n;
          count++;
        }
      }
    }
    const total = Object.fromEntries(Object.entries(cost).map(([k, n]) => [k, n * count]));
    return { segs, count, total };
  }

  // Encargar un muro de A a B: se construyen los tramos válidos y que se puedan pagar.
  buildLine(typeId, ax, az, bx, bz) {
    const def = BUILDINGS[typeId];
    if (!def?.line || !this.camp) return { made: 0 };
    const plan = this.wallCheck(def, ax, az, bx, bz);
    if (!plan.count) return { made: 0, problem: plan.segs.find((s) => s.problem)?.problem ?? 'No se puede construir ahí' };
    if (this.remote) {
      this.remote('buildLine', [typeId, ax, az, bx, bz]);
      return { made: plan.count, pending: true };
    }
    let made = 0;
    for (const s of plan.segs) {
      if (buildBlocker(this, def) || this.siteProblem(def, s.x, s.z)) continue;
      const cost = buildCostOf(def, this.age);
      if (!this.canAfford(cost)) break;
      for (const [k, n] of Object.entries(cost)) this.takeStock(k, n);
      this.createBuilding(def, s.x, s.z, s.yaw, 0, 0, buildLevelFor(def, this.age));
      made++;
    }
    this.emit('changed');
    return { made };
  }

  // ---- Portones y caminos alrededor de los muros ------------------------------------------------

  // Coste de convertir un tramo de muro en portón: el doble de lo que cuesta el tramo.
  gateCost(b) {
    return Object.fromEntries(Object.entries(buildCostOf(b.def, this.age)).map(([k, n]) => [k, n * 2]));
  }

  gateProblem(b, on) {
    if (!b?.def.line) return 'Sólo los tramos de muro pueden ser portón';
    if (!b.done) return 'Espera a que termine la obra del tramo';
    if (!on) return null;
    if (b.gate) return 'Ya es un portón';
    const cost = this.gateCost(b);
    if (!this.canAfford(cost)) return `Faltan ${this.missing(cost).join(' y ')}`;
    return null;
  }

  // Convertir un tramo en portón (se paga) o volver a muro (gratis). Los colonos atraviesan los portones.
  setGate(b, on) {
    on = !!on;
    if (this.gateProblem(b, on)) return false;
    if (b.gate === on) return true;
    if (this.remote) {
      this.remote('setGate', [b.id, on]);
      return true;
    }
    if (on) for (const [k, n] of Object.entries(this.gateCost(b))) this.takeStock(k, n);
    b.gate = on;
    this.refreshObstacles();
    this.emit('buildings');
    this.emit('changed');
    return true;
  }

  // Celdas de 2 m bloqueadas por muros (los portones no bloquean). Se reconstruye cuando cambian los edificios.
  wallCells() {
    if (this.wallCellsRev === this.wallRev) return this.wallCellSet;
    const set = new Set();
    for (const b of this.buildings) {
      if (!b.def.line || b.gate) continue;
      const r = b.def.footprint + 1.1;
      for (let ix = Math.floor((b.x - r) / 2); ix <= Math.floor((b.x + r) / 2); ix++) {
        for (let iz = Math.floor((b.z - r) / 2); iz <= Math.floor((b.z + r) / 2); iz++) {
          if (Math.hypot(ix * 2 + 1 - b.x, iz * 2 + 1 - b.z) < r + 1) set.add(`${ix},${iz}`);
        }
      }
    }
    this.wallCellSet = set;
    this.wallCellsRev = this.wallRev;
    return set;
  }

  // ¿Hay un muro entre dos puntos en línea recta?
  wallBetween(ax, az, bx, bz, cells = this.wallCells()) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(len / 1.2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (cells.has(`${Math.floor((ax + (bx - ax) * t) / 2)},${Math.floor((az + (bz - az) * t) / 2)}`)) return true;
    }
    return false;
  }

  // Ruta rodeando los muros (por los portones): A* en celdas de 2 m. Devuelve puntos [{x,z}] o null.
  findWallPath(ax, az, bx, bz) {
    const cells = this.wallCells();
    const key = (ix, iz) => `${ix},${iz}`;
    const free = (ix, iz) => !cells.has(key(ix, iz));
    const nearestFree = (x, z) => {
      const ix = Math.floor(x / 2);
      const iz = Math.floor(z / 2);
      if (free(ix, iz)) return [ix, iz];
      for (let r = 1; r < 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r && free(ix + dx, iz + dz)) return [ix + dx, iz + dz];
      return null;
    };
    const start = nearestFree(ax, az);
    const goal = nearestFree(bx, bz);
    if (!start || !goal) return null;
    const limit = radiusOf(this) / 2 + 24;
    const open = [[0, start[0], start[1]]];
    const g = new Map([[key(...start), 0]]);
    const from = new Map();
    const h = (ix, iz) => Math.hypot(goal[0] - ix, goal[1] - iz);
    let guard = 0;
    while (open.length && guard++ < 8000) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[best][0]) best = i;
      const [, ix, iz] = open.splice(best, 1)[0];
      if (ix === goal[0] && iz === goal[1]) {
        const pts = [];
        for (let k = key(ix, iz); k; k = from.get(k)) {
          const [cx, cz] = k.split(',').map(Number);
          pts.push({ x: cx * 2 + 1, z: cz * 2 + 1 });
        }
        pts.reverse();
        // Quitar puntos intermedios con visión directa (rutas más naturales).
        const out = [];
        let at = { x: ax, z: az };
        for (let i = 0; i < pts.length; i++) {
          const next = pts[i + 1];
          if (!next || this.wallBetween(at.x, at.z, next.x, next.z, cells)) {
            out.push(pts[i]);
            at = pts[i];
          }
        }
        out.push({ x: bx, z: bz });
        return out;
      }
      const gc = g.get(key(ix, iz));
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = ix + dx;
        const nz = iz + dz;
        if (Math.abs(nx) > limit || Math.abs(nz) > limit || !free(nx, nz)) continue;
        if (dx && dz && (!free(ix + dx, iz) || !free(ix, iz + dz))) continue; // sin cortar esquinas de muro
        const cost = gc + (dx && dz ? 1.414 : 1);
        const k = key(nx, nz);
        if (cost < (g.get(k) ?? Infinity)) {
          g.set(k, cost);
          from.set(k, key(ix, iz));
          open.push([cost + h(nx, nz), nx, nz]);
        }
      }
    }
    return null;
  }

  // Siguiente punto al que ir para llegar a (tx, tz) sin atravesar muros; null = ir en línea recta.
  pathTarget(c, tx, tz) {
    const cells = this.wallCells();
    if (!cells.size) {
      c.path = null;
      return null;
    }
    let p = c.path;
    if (p && (p.rev !== this.wallRev || Math.hypot(p.tx - tx, p.tz - tz) > 2.5)) p = c.path = null;
    if (!p) {
      if (!this.wallBetween(c.x, c.z, tx, tz, cells)) return null;
      const pts = this.findWallPath(c.x, c.z, tx, tz);
      if (!pts) return null;
      p = c.path = { rev: this.wallRev, tx, tz, pts, i: 0 };
    }
    while (p.i < p.pts.length - 1 && Math.hypot(p.pts[p.i].x - c.x, p.pts[p.i].z - c.z) < 1.4) p.i++;
    const pt = p.pts[p.i];
    if (p.i >= p.pts.length - 1 && !this.wallBetween(c.x, c.z, tx, tz, cells)) {
      c.path = null;
      return null;
    }
    return pt;
  }

  // ---- Rodear obstáculos (troncos, fogata, atrezo, edificios) ----------------------------------
  // Evitar sólo localmente (moveToward) deja a un colono pegado a un tronco o a un edificio cuando su destino queda justo
  // detrás. Si la línea recta está bloqueada se planea una ruta (A* en celdas de 1 m) que lo rodea.

  // ¿Un obstáculo corta el segmento a-b? (con el margen del cuerpo; "extra" deja holgura al planear)
  lineBlocked(ax, az, bx, bz, extra = 0) {
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    for (const o of this.obstacles) {
      const t = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.z - az) * dz) / l2));
      const px = ax + dx * t - o.x;
      const pz = az + dz * t - o.z;
      const min = o.r + COLONIST_RADIUS + extra - 0.03; // quien ya está en el borde no cuenta como dentro
      if (px * px + pz * pz < min * min) return true;
    }
    return false;
  }

  findObstaclePath(ax, az, bx, bz) {
    const S = 0.5; // celdas de 0,5 m: así pasa por pasillos estrechos entre un tronco y una pila de leña
    const R = COLONIST_RADIUS + 0.08;
    const free = (ix, iz) => {
      const x = ix * S;
      const z = iz * S;
      for (const o of this.obstacles) {
        const dx = x - o.x;
        const dz = z - o.z;
        if (dx * dx + dz * dz < (o.r + R) ** 2) return false;
      }
      return this.heightAt(x, z) > 0.6;
    };
    const near = (x, z) => {
      const ix = Math.round(x / S);
      const iz = Math.round(z / S);
      for (let r = 0; r < 10; r++) {
        let best = null;
        let bd = Infinity;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !free(ix + dx, iz + dz)) continue;
            const d = Math.hypot((ix + dx) * S - x, (iz + dz) * S - z);
            if (d < bd) {
              bd = d;
              best = [ix + dx, iz + dz];
            }
          }
        }
        if (best) return best;
      }
      return null;
    };
    const start = near(ax, az);
    const goal = near(bx, bz);
    if (!start || !goal) return null;
    const pad = 28; // celdas (14 m) de margen alrededor de la caja que une salida y destino
    const minX = Math.min(start[0], goal[0]) - pad;
    const maxX = Math.max(start[0], goal[0]) + pad;
    const minZ = Math.min(start[1], goal[1]) - pad;
    const maxZ = Math.max(start[1], goal[1]) + pad;
    const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
    const open = [[0, start[0], start[1]]];
    const g = new Map([[key(...start), 0]]);
    const from = new Map();
    const memo = new Map();
    const isFree = (ix, iz) => {
      const k = key(ix, iz);
      let v = memo.get(k);
      if (v === undefined) memo.set(k, (v = free(ix, iz)));
      return v;
    };
    let guard = 0;
    while (open.length && guard++ < 14000) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[best][0]) best = i;
      const [, ix, iz] = open.splice(best, 1)[0];
      if (ix === goal[0] && iz === goal[1]) {
        const nodes = [];
        for (let k = key(ix, iz); k !== undefined; k = from.get(k)) nodes.push({ x: (Math.floor(k / 8192) - 4096) * S, z: ((k % 8192) - 4096) * S });
        nodes.reverse();
        // Quitar puntos intermedios con visión directa (ruta natural, con algo de holgura).
        const out = [];
        let at = { x: ax, z: az };
        for (let i = 0; i < nodes.length; i++) {
          const next = nodes[i + 1] ?? { x: bx, z: bz };
          if (this.lineBlocked(at.x, at.z, next.x, next.z, 0.05)) {
            out.push(nodes[i]);
            at = nodes[i];
          }
        }
        out.push({ x: bx, z: bz });
        return out;
      }
      const gc = g.get(key(ix, iz));
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = ix + dx;
        const nz = iz + dz;
        if (nx < minX || nx > maxX || nz < minZ || nz > maxZ || !isFree(nx, nz)) continue;
        if (dx && dz && (!isFree(ix + dx, iz) || !isFree(ix, iz + dz))) continue; // sin cortar esquinas
        const cost = gc + (dx && dz ? 1.414 : 1);
        const k = key(nx, nz);
        if (cost < (g.get(k) ?? Infinity)) {
          g.set(k, cost);
          from.set(k, key(ix, iz));
          open.push([cost + Math.hypot(goal[0] - nx, goal[1] - nz), nx, nz]);
        }
      }
    }
    return null;
  }

  // Siguiente punto al que ir para llegar a (tx, tz) rodeando obstáculos; null = ir en línea recta.
  obstacleTarget(c, tx, tz) {
    let p = c.opath;
    if (p && (p.obs !== this.obstacles || Math.hypot(p.tx - tx, p.tz - tz) > 1.5)) p = c.opath = null;
    if (!p) {
      // Un destino dentro de un obstáculo (el borde de un edificio, por ejemplo) no se planea: se va derecho como antes.
      if (!this.lineBlocked(c.x, c.z, tx, tz) || !this.walkable(tx, tz, COLONIST_RADIUS - 0.05)) return null;
      const pts = this.findObstaclePath(c.x, c.z, tx, tz);
      if (!pts) return null;
      p = c.opath = { obs: this.obstacles, tx, tz, pts, i: 0 };
    }
    while (p.i < p.pts.length - 1 && Math.hypot(p.pts[p.i].x - c.x, p.pts[p.i].z - c.z) < 0.9) p.i++;
    if (p.i >= p.pts.length - 1) {
      // Último tramo: si ya se ve el destino se va derecho; si no (lo desvió algo), se replanea.
      c.opath = null;
      return null;
    }
    // Si el siguiente punto dejó de verse (lo empujaron), se replanea.
    const pt = p.pts[p.i];
    if (this.lineBlocked(c.x, c.z, pt.x, pt.z)) {
      c.opath = null;
      return null;
    }
    return pt;
  }

  // Encargar un edificio: se paga y queda en obra. Devuelve el edificio o el problema.
  // yaw (opcional): hacia dónde mira el edificio (si no, mira al centro de la aldea).
  build(typeId, x, z, yaw = null) {
    const def = BUILDINGS[typeId];
    if (!def || !this.camp) return { problem: 'No se puede construir eso' };
    const problem = this.buildProblem(def, x, z, yaw);
    if (problem) return { problem };
    if (this.remote) {
      this.remote('build', [typeId, x, z, Number.isFinite(yaw) ? yaw : null]);
      return { pending: true };
    }
    for (const [k, n] of Object.entries(buildCostOf(def, this.age))) this.takeStock(k, n);
    // Los muros no se giran a mano: un tramo suelto queda a lo largo del eje X (los trazados por línea traen su ángulo).
    const facing = this.facingFor(def, x, z, yaw);
    const b = this.createBuilding(def, x, z, facing, 0, 0, buildLevelFor(def, this.age));
    this.emit('changed');
    return { building: b };
  }

  // ---- Demoler y mover -------------------------------------------------------------------

  // Lo que devolvería demoler: la mitad (hacia abajo) de lo que costó construirlo y mejorarlo.
  demolishRefund(b) {
    const total = {};
    const add = (cost) => {
      for (const [k, n] of Object.entries(cost ?? {})) total[k] = (total[k] ?? 0) + n;
    };
    const def = b.def;
    add(def.autoLevel ? (def.levels[b.level - 1].buildCost ?? def.cost) : (def.levels[0].buildCost ?? def.cost));
    if (!def.autoLevel) {
      for (let i = 1; i < b.level; i++) add(def.levels[i].upgradeCost);
      if (b.upgrading) add(levelOf(b, 1)?.upgradeCost);
    }
    const refund = {};
    for (const [k, n] of Object.entries(total)) if (Math.floor(n / 2) > 0) refund[k] = Math.floor(n / 2);
    return refund;
  }

  // Quitar un edificio de la aldea (libera a sus trabajadores y vecinos).
  detachBuilding(b) {
    b.removed = true;
    removeTerrainZone(b.zone);
    this.buildings = this.buildings.filter((o) => o !== b);
    for (const c of this.colonists) {
      if (c.job === b) c.job = null;
      if (c.home === b.id) c.home = null;
      if (c.order?.kind === 'build' && c.order.building === b.id) c.order = null;
      if (c.task?.building === b) {
        endTask(this, c, c.task);
        c.task = null;
      }
    }
    this.heights.clear();
    this.refreshObstacles();
  }

  demolish(b) {
    if (!b || b.removed) return false;
    if (this.remote) {
      this.remote('demolish', [b.id]);
      return true;
    }
    const refund = this.demolishRefund(b);
    const name = b.name;
    this.detachBuilding(b);
    for (const [k, n] of Object.entries(refund)) this.addStock(k, n);
    const text = Object.entries(refund).map(([k, n]) => `${n} ${GOOD_NAMES[k] ?? k}`).join(', ');
    this.emit('notice', `Demolido: ${name}${text ? ` · devuelve ${text}` : ''}`);
    this.emit('buildings');
    this.emit('changed');
    return true;
  }

  // Por qué no se puede mover "b" a (x, z), o null.
  moveProblem(b, x, z, yaw = null) {
    if (!b || b.removed) return 'Ese edificio ya no existe';
    return this.siteProblem(b.def, x, z, b, Number.isFinite(yaw) ? yaw : b.yaw);
  }

  // Mover un edificio: queda igual (nivel, obra, dotación) en otro sitio y sin coste. Recibe un id
  // nuevo para que todas las copias lo redibujen en su sitio.
  moveBuilding(b, x, z, yaw = null) {
    const problem = this.moveProblem(b, x, z, yaw);
    if (problem) return problem;
    if (this.remote) {
      this.remote('moveBuilding', [b.id, x, z, Number.isFinite(yaw) ? yaw : null]);
      return null;
    }
    const old = { workers: [...b.workers], residents: this.colonists.filter((c) => c.home === b.id), orders: this.colonists.filter((c) => c.order?.kind === 'build' && c.order.building === b.id) };
    this.detachBuilding(b);
    const nb = this.createBuilding(b.def, x, z, this.facingFor(b.def, x, z, Number.isFinite(yaw) ? yaw : b.yaw), b.done ? 0 : b.progress, b.produced, b.level);
    nb.gate = b.gate;
    Object.assign(nb, { upgrading: b.upgrading, store: b.store, cycle: b.cycle, cycleActive: b.cycleActive, priority: b.priority, paused: b.paused, buildTime: b.buildTime });
    for (const w of old.workers) {
      w.job = nb;
      nb.workers.push(w);
    }
    if (b.done) this.finishBuilding(nb, null, true);
    this.autoConnect(nb);
    for (const c of old.residents) c.home = nb.id;
    for (const c of old.orders) c.order = { kind: 'build', building: nb.id };
    this.emit('buildings');
    this.emit('changed');
    return null;
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
      // Los muros siguen el terreno: sin nivelar ni pintar tierra (cada tramo a su altura dejaba escalones).
      flatRadius: def.line ? 0.01 : def.footprint + 1,
      blendRadius: def.line ? 0.05 : 5,
      clearRadius: def.line ? 0.4 : def.footprint + 0.8,
      detailRadius: 0,
      dirtColor: (ground.details ? ground : BIOMES.grassland).dirt,
      resourceClear: resourceClearOf(def),
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
        const n = this.def.levels[this.level - 1].name;
        return this.gate ? `Portón (${n.toLowerCase()})` : n;
      },
      entrance: entranceOf(def, x, z, yaw), // puerta o punto de trabajo y su franja de acceso (sim/access.js)
      accessIssue: null, // por qué la entrada está bloqueada (si lo está): lo calcula refreshObstacles
      gate: false, // un tramo de muro convertido en portón: se puede atravesar
      priority: 'normal', // prioridad de la obra (baja, normal, alta)
      paused: false, // obra pausada por el jugador
      workers: [], // la dotación (varios colonos en los edificios que lo piden)
      get worker() {
        return this.workers[0] ?? null;
      },
      reason: '',
      status: null,
      cycle: 0, // avance del ciclo de producción (0 a 1)
      cycleActive: false,
      crewAt: new Map(), // cuándo estuvo cada trabajador en su puesto
      pf: 1, // factor de energía (0 a 1)
      operating: false,
      burning: false,
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
      for (const w of b.workers) w.job = null;
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
      if (!silent) for (const w of b.workers) if (w !== builder) addLog(w, time, `Su lugar de trabajo ahora es ${b.name}`);
    } else if (builder && !silent) {
      addLog(builder, time, `Terminó de construir: ${b.name}`);
    }
    this.assignWorker(b);
    if (!silent) this.autoConnect(b);
    this.emit('buildings');
    this.emit('changed');
  }

  // Por qué no se puede mejorar (o null si se puede).
  upgradeProblem(b) {
    const next = levelOf(b, 1);
    const blocked = upgradeBlocker(this, b);
    if (blocked) return blocked;
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
    return completeSkill(c, def.skill) + (hasTrait(c, 'hardworking') ? 0.8 : 0) - (hasTrait(c, 'lazy') ? 1.2 : 0);
  }

  // Colonos ordenados de más a menos capacitados para un edificio.
  ranking(b) {
    return [...this.colonists].sort((a, c) => this.aptitude(c, b.def) - this.aptitude(a, b.def));
  }

  // Quién vive en una casa: los adultos ocupan plazas; los niños viven con su madre y no cuentan
  // (por eso antes se veía "4/3": 3 adultos + 1 niño).
  residents(b) {
    const all = this.colonists.filter((c) => c.home === b.id);
    return { adults: all.filter((c) => (c.growth ?? 1) >= 1), children: all.filter((c) => (c.growth ?? 1) < 1) };
  }

  // Cuántos trabajadores pide un edificio en su nivel actual.
  crewNeeded(b) {
    if (!b.def.skill) return 0;
    return levelOf(b).workers ?? b.def.workers;
  }

  // ¿Puede trabajar este colono? Adultos que no son soldados.
  available(c) {
    return (c.growth ?? 1) >= 1 && !c.soldier;
  }

  // La colonia completa la dotación con los colonos libres más capacitados.
  assignWorker(b) {
    // En la copia del navegador conectada al servidor, los trabajadores los elige el servidor.
    if (this.remote || !b.done) return;
    const needed = this.crewNeeded(b);
    if (!needed || b.workers.length >= needed) return;
    // Sólo se ofrece el puesto a quien tiene esa categoría entre sus especialidades (no hay un cuarto oficio automático).
    const free = this.ranking(b).filter((c) => !c.job && this.available(c) && specOf(this, c).includes(b.def.skill));
    if (!free.length) {
      b.reason = `Nadie libre tiene ${SPEC_NAMES[b.def.skill]} entre sus especialidades: cámbialas en la tabla de trabajo o elige a alguien a mano.`;
      return;
    }
    const skillName = SKILLS.find((s) => s.id === b.def.skill).name;
    while (b.workers.length < needed && free.length) {
      const best = free.shift();
      const others = free.length ? ' entre los colonos libres' : '';
      this.setWorker(b, best, `La colonia le eligió por tener la mejor ${skillName.toLowerCase()} (${this.skillOf(best, b.def.skill)}/10)${others}.`, true);
    }
  }

  // Asignar a mano (desde la ficha del edificio). Si la dotación está completa, sale el
  // que lleva más tiempo.
  setWorker(b, c, reason = 'Elegido por ti.', auto = false) {
    if (this.remote) {
      this.remote('setWorker', [b.id, c.id]);
      return;
    }
    const needed = this.crewNeeded(b);
    if (!needed || !this.available(c) || b.workers.includes(c)) return;
    if (c.job && c.job !== b) {
      const old = c.job;
      old.workers = old.workers.filter((w) => w !== c);
      old.reason = `${c.name} se fue a trabajar a ${b.name}.`;
    }
    while (b.workers.length >= needed) b.workers.shift().job = null;
    b.workers.push(c);
    b.reason = reason;
    c.job = b;
    c.jobAuto = auto; // a mano = orden del jugador (vale aunque no sea de sus especialidades)
    addLog(c, this.timeLabel(), `Ahora trabaja en: ${b.name}`);
    this.emit('buildings');
    this.emit('changed');
  }

  // Dejar a un colono sin trabajo (desde la ficha del edificio). Queda libre para otro puesto.
  releaseWorker(b, c) {
    if (this.remote) {
      this.remote('releaseWorker', [b.id, c.id]);
      return;
    }
    if (!b.workers.includes(c)) return;
    b.workers = b.workers.filter((w) => w !== c);
    c.job = null;
    c.task = null;
    b.reason = `${c.name} dejó el puesto.`;
    addLog(c, this.timeLabel(), `Dejó su trabajo en: ${b.name}`);
    this.emit('buildings');
    this.emit('changed');
  }

  // Habilidad de un colono (las nuevas se completan solas a partir de sus genes).
  skillOf(c, id) {
    return completeSkill(c, id);
  }

  // Lo que pasa en los edificios con el tiempo: el recolector de lluvia se llena solo
  // (mucho con lluvia y un poco con el rocío) y se buscan trabajadores para los libres.
  updateBuildings(gameDt, rain) {
    for (const b of this.buildings) {
      const lv = b.done && levelOf(b);
      if (lv?.rainOnly) b.store = Math.min(lv.capacity, b.store + (DEW_RATE + rain * RAIN_RATE) * gameDt);
    }
    this.assignTimer -= gameDt;
    if (this.assignTimer <= 0) {
      this.assignTimer = ASSIGN_EVERY;
      for (const b of this.buildings) this.assignWorker(b);
      assignHomes(this);
      const day = Math.floor(this.gameTime / DAY_LENGTH_SECONDS);
      if (day !== this.lastTrainDay) {
        this.lastTrainDay = day;
        trainColonists(this);
        payUpkeep(this);
        dailyRaid(this, day);
      }
    }
  }

  // ---- Comercio, investigación y caminos (órdenes del jugador) -----------------------------

  tradeProblem(good, qty, mode) {
    return tradeProblem(this, good, qty, mode);
  }

  trade(good, qty, mode) {
    if (tradeProblem(this, good, qty, mode)) return false;
    if (this.remote) {
      this.remote('trade', [good, qty, mode]);
      return true;
    }
    doTrade(this, good, qty, mode);
    this.emit('changed');
    return true;
  }

  researchProblem(id) {
    return researchProblem(this, id);
  }

  research(id) {
    if (researchProblem(this, id)) return false;
    if (this.remote) {
      this.remote('research', [id]);
      return true;
    }
    this.takeStock('knowledge', TECHS_BY_ID[id].cost);
    this.techs.add(id);
    this.emit('notice', `Tecnología investigada: ${TECHS_BY_ID[id].name}`);
    this.emit('changed');
    return true;
  }

  // Pintar caminos: lista de casillas [ix, iz]; se paga cada casilla nueva con el nivel de la edad.
  paintRoads(cells) {
    const clean = Array.isArray(cells) ? cells.filter((c) => Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1]) && Math.abs(c[0]) < 200 && Math.abs(c[1]) < 200 && !roadCellProblem(this, c[0], c[1])) : [];
    if (!clean.length) return false;
    const level = roadLevelFor(this.age);
    const problem = roadsProblem(this, clean);
    if (problem) return false;
    if (this.remote) {
      this.remote('paintRoads', [clean]);
      return true;
    }
    const fresh = clean.filter(([ix, iz]) => (this.roads.get(roadKey(ix, iz)) ?? 0) < level);
    for (const [k, n] of Object.entries(roadCost(level, fresh.length))) this.takeStock(k, n);
    for (const [ix, iz] of fresh) this.roads.set(roadKey(ix, iz), level);
    for (const [ix, iz] of clean) {
      this.autoRoadKeys.delete(roadKey(ix, iz)); // lo pintado a mano es del jugador
      this.roadsOff.delete(roadKey(ix, iz));
    }
    this.staticsRevision++;
    this.emit('roads');
    this.emit('changed');
    return true;
  }

  // Trazar sola la red: cada edificio terminado se une a los caminos o al centro (gratis, hasta el
  // límite de la edad y sin las casillas que el jugador quitó).
  autoConnect(only = null) {
    const level = roadLevelFor(this.age);
    if (!this.autoRoads || level <= 0 || this.remote) return 0;
    let added = 0;
    for (const b of only ? [only] : this.buildings) {
      if (!b.done || b.removed) continue;
      for (const [ix, iz] of autoRoadPath(this, b, this.roadsOff)) {
        const key = roadKey(ix, iz);
        this.roads.set(key, level);
        this.autoRoadKeys.add(key);
        added++;
      }
    }
    if (added) {
      this.staticsRevision++;
      this.emit('roads');
      this.emit('changed');
    }
    return added;
  }

  // Con una edad nueva, los caminos de la aldea suben solos al nivel nuevo (los del jugador se
  // mejoran pagando) y se trazan los que falten.
  refreshAutoRoads() {
    const level = roadLevelFor(this.age);
    if (!this.autoRoads || level <= 0) return;
    for (const key of this.autoRoadKeys) if (this.roads.has(key)) this.roads.set(key, level);
    this.autoConnect();
    this.staticsRevision++;
    this.emit('roads');
  }

  // Quitar caminos (hechos a mano o por la aldea). Los que trazó la aldea no vuelven a salir.
  eraseRoads(cells) {
    const keys = (Array.isArray(cells) ? cells : []).filter((c) => Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1])).map(([ix, iz]) => roadKey(ix, iz)).filter((k) => this.roads.has(k));
    if (!keys.length) return false;
    if (this.remote) {
      this.remote('eraseRoads', [cells]);
      return true;
    }
    for (const k of keys) {
      this.roads.delete(k);
      if (this.autoRoadKeys.delete(k)) this.roadsOff.add(k);
    }
    this.staticsRevision++;
    this.emit('roads');
    this.emit('changed');
    return true;
  }

  // Activar o desactivar los caminos automáticos. Al desactivarlos se quitan los que trazó la aldea.
  setAutoRoads(on) {
    on = !!on;
    if (this.remote) {
      this.autoRoads = on;
      this.remote('setAutoRoads', [on]);
      return true;
    }
    if (on === this.autoRoads) return true;
    this.autoRoads = on;
    if (on) {
      this.roadsOff.clear();
      this.autoConnect();
    } else {
      for (const k of this.autoRoadKeys) this.roads.delete(k);
      this.autoRoadKeys.clear();
      this.staticsRevision++;
      this.emit('roads');
    }
    this.emit('changed');
    return true;
  }

  roadProblem(cells) {
    return roadsProblem(this, cells);
  }

  // Mejorar todos los caminos al nivel que permite la edad (se paga cada casilla).
  upgradeRoads() {
    const level = roadLevelFor(this.age);
    const old = [...this.roads].filter(([, lv]) => lv < level);
    if (!old.length) return false;
    const cost = roadCost(level, old.length);
    if (!this.canAfford(cost)) return false;
    if (this.remote) {
      this.remote('upgradeRoads', []);
      return true;
    }
    for (const [k, n] of Object.entries(cost)) this.takeStock(k, n);
    for (const [key] of old) this.roads.set(key, level);
    this.staticsRevision++;
    this.emit('roads');
    this.emit('changed');
    return true;
  }

  // ---- Ejército (órdenes del jugador; la lógica está en sim/military.js) -----------------------

  recruitProblem(unitId) {
    return recruitProblem(this, unitId);
  }

  recruit(unitId) {
    if (recruitProblem(this, unitId)) return false;
    if (this.remote) {
      this.remote('recruit', [unitId]);
      return true;
    }
    return !!recruit(this, unitId);
  }

  dismiss(c) {
    if (!c?.soldier) return false;
    if (this.remote) {
      this.remote('dismiss', [c.id]);
      return true;
    }
    return dismiss(this, c);
  }

  soldierUpgradeProblem(c) {
    return soldierUpgradeProblem(this, c);
  }

  upgradeSoldier(c) {
    if (soldierUpgradeProblem(this, c)) return false;
    if (this.remote) {
      this.remote('upgradeSoldier', [c.id]);
      return true;
    }
    return upgradeSoldier(this, c);
  }

  get armyReport() {
    return armyReport(this);
  }

  get militaryPower() {
    return militaryPower(this);
  }

  get roadInfo() {
    return { level: roadLevelFor(this.age), count: this.roads.size, levels: ROAD_LEVELS, auto: this.autoRoads };
  }

  refreshObstacles() {
    this.wallRev = (this.wallRev ?? 0) + 1;
    this.obstacles = [
      ...campObstacles(),
      ...(this.age >= 2 ? [{ x: TOTEM_SPOT.x, z: TOTEM_SPOT.z, r: 0.9, kind: 'prop' }] : []),
      ...this.buildings.filter((b) => !b.gate).map((b) => ({ x: b.x, z: b.z, r: b.def.footprint, kind: 'building', line: !!b.def.line })),
      // Objetos del centro que aparecen con la edad (no se pisan ni se construye encima).
      // (los objetos del centro tampoco aparecen sobre la entrada de un edificio)
      ...centerProps(this.age, [...this.buildings.map((b) => ({ x: b.x, z: b.z, r: b.def.footprint })), ...this.buildings.filter((b) => b.entrance).map((b) => ({ x: (b.entrance.zone.x0 + b.entrance.zone.x1) / 2, z: (b.entrance.zone.z0 + b.entrance.zone.z1) / 2, r: 2.4 }))]).map((p) => ({ x: p.x, z: p.z, r: p.r, kind: 'prop' })),
    ];
    this.computeAccessIssues();
  }

  // ---- Accesos ----------------------------------------------------------------------------

  // ¿Cae este punto en la franja de acceso de algún edificio? (no se planta, no crecen árboles, no se deja nada)
  accessBlocked(x, z) {
    for (const b of this.buildings) if (b.entrance && pointInRect(b.entrance.zone, x, z)) return true;
    return false;
  }

  // Marca los edificios cuya entrada quedó bloqueada (construcciones antiguas o un objeto que apareció después).
  // No se toca nada solo: se señala y el jugador lo resuelve moviendo o demoliendo.
  computeAccessIssues() {
    const props = this.obstacles.filter((o) => o.kind !== 'building');
    let changed = false;
    for (const b of this.buildings) {
      let issue = null;
      const e = b.entrance;
      if (e) {
        for (const o of this.buildings) {
          if (o === b || o.removed) continue;
          const hit = o.def.line ? circleHitsRect(e.zone, o.x, o.z, o.def.footprint) : rectsOverlap(e.zone, footprintRect(o.def, o.x, o.z));
          if (hit) {
            issue = `La entrada está bloqueada por ${o.name}`;
            break;
          }
        }
        if (!issue && props.some((p) => circleHitsRect(e.zone, p.x, p.z, p.r))) issue = 'La entrada está bloqueada por un objeto de la aldea';
        if (!issue && this.heightAt(e.approach.x, e.approach.z) <= 0.8) issue = 'La entrada da al agua';
      }
      if (b.accessIssue !== issue) {
        b.accessIssue = issue;
        changed = true;
      }
    }
    return changed;
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
        villageName: this.villageName,
        produced: this.produced,
        techs: [...this.techs],
        expansions: this.expansions,
        ageChangedAt: this.ageChangedAt,
        tradeUsed: this.tradeUsed,
        tradeDay: this.tradeDay,
        nextRaidDay: this.nextRaidDay,
        armyUnpaid: this.armyUnpaid,
        roads: [...this.roads].map(([k, lv]) => [...k.split(',').map(Number), lv]),
        primitiveMigrated: !!this.primitiveMigrated,
        milestones: [...this.milestones],
        learned: [...this.learned],
        discovery: this.discovery,
        defeat: this.defeat,
        deaths: this.deaths.slice(-20),
        autoRoads: this.autoRoads,
        autoRoadKeys: [...this.autoRoadKeys],
        roadsOff: [...this.roadsOff],
        colonists: this.colonists.map((c) => ({
          id: c.id,
          needs: c.needs,
          health: c.health,
          log: c.log,
          flags: c.flags,
          moodEvents: c.moodEvents,
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
          order: c.order ?? null,
          spec: c.spec,
          pendingSpec: c.pendingSpec,
          xp: c.xp,
          age: c.age,
          soldier: c.soldier,
          static: c.id >= START_COLONISTS ? this.staticOf(c) : undefined, // los nacidos o llegados no salen de la semilla
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
        priority: b.priority,
        paused: b.paused,
        gate: !!b.gate,
        store: b.store,
        worker: b.worker ? b.worker.id : null,
        workers: b.workers.map((w) => w.id),
        cycle: b.cycle,
        cycleActive: b.cycleActive,
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
      if (PRIORITY[s.priority]) b.priority = s.priority;
      b.paused = !!s.paused && !b.done;
      b.gate = !!s.gate && !!def.line;
      b.cycle = Number.isFinite(s.cycle) ? s.cycle : 0;
      b.cycleActive = !!s.cycleActive;
      if (s.upgrading && levelOf(b, 1)) {
        b.upgrading = true;
        b.done = false;
        b.progress = s.progress;
        b.buildTime = def.buildTime * (1 + b.level * 0.4);
      }
      const ids = Array.isArray(s.workers) ? s.workers : s.worker != null ? [s.worker] : [];
      for (const id of ids) {
        const worker = this.colonists.find((c) => c.id === id);
        if (b.done && worker && !worker.job && b.workers.length < Math.max(1, this.crewNeeded(b))) {
          b.workers.push(worker);
          worker.job = b;
          b.reason = 'Trabajaba aquí antes.';
        }
      }
    }
    this.restoreColony(data.colony);
    // Partidas anteriores: las viviendas toman el nivel de la edad (no se quita nada).
    evolveHouses(this);
    this.pruneRoads();
    migrateSpecs(this); // aldeas anteriores: tres especialidades razonables, una sola vez
    this.migratePrimitive();
    this.autoConnect();
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
        const [type, x, z, yaw] = args;
        if (typeof type !== 'string' || num(x, 500) === null || num(z, 500) === null) return false;
        return !!this.build(type, x, z, num(yaw, 20)).building;
      }
      case 'upgrade': {
        const b = this.building(args[0]);
        return !!b && this.upgrade(b);
      }
      case 'setWorker': {
        const b = this.building(args[0]);
        const c = this.colonist(args[1]);
        if (!b || !c || !b.def.skill || !b.done || !this.available(c)) return false;
        this.setWorker(b, c);
        return true;
      }
      case 'releaseWorker': {
        const b = this.building(args[0]);
        const c = this.colonist(args[1]);
        if (!b || !c || !b.workers.includes(c)) return false;
        this.releaseWorker(b, c);
        return true;
      }
      case 'setPriority': {
        const b = this.building(args[0]);
        return !!b && typeof args[1] === 'string' && this.setPriority(b, args[1]);
      }
      case 'pauseSite': {
        const b = this.building(args[0]);
        return !!b && this.pauseSite(b, args[1]);
      }
      case 'orderColonist': {
        const c = this.colonist(args[0]);
        const b = args[2] != null ? this.building(args[2]) : null;
        return !!c && typeof args[1] === 'string' && this.orderColonist(c, args[1], b) === null;
      }
      case 'cancelOrder': {
        const c = this.colonist(args[0]);
        return !!c && this.cancelOrder(c);
      }
      case 'setSpec': {
        const c = this.colonist(args[0]);
        return !!c && this.setSpec(c, args[1]);
      }
      case 'learn':
        return typeof args[0] === 'string' && this.learn(args[0]);
      case 'discover':
        return this.discover();
      case 'setGate': {
        const b = this.building(args[0]);
        return !!b && this.setGate(b, !!args[1]);
      }
      case 'buildLine': {
        const [type, ax, az, bx, bz] = args;
        if (typeof type !== 'string' || [ax, az, bx, bz].some((v) => num(v, 500) === null)) return false;
        return this.buildLine(type, ax, az, bx, bz).made > 0;
      }
      case 'demolish':
        return this.demolish(this.building(args[0]));
      case 'moveBuilding': {
        const b = this.building(args[0]);
        if (!b || num(args[1], 500) === null || num(args[2], 500) === null) return false;
        return this.moveBuilding(b, args[1], args[2], num(args[3], 20)) === null;
      }
      case 'advanceAge':
        return this.advanceAge();
      case 'expandTerritory':
        return this.expandTerritory();
      case 'trade':
        return typeof args[0] === 'string' && this.trade(args[0], args[1], args[2]);
      case 'research':
        return typeof args[0] === 'string' && this.research(args[0]);
      case 'paintRoads':
        return this.paintRoads(args[0]);
      case 'eraseRoads':
        return Array.isArray(args[0]) && args[0].length <= 240 && this.eraseRoads(args[0]);
      case 'setAutoRoads':
        return this.setAutoRoads(args[0]);
      case 'upgradeRoads':
        return this.upgradeRoads();
      case 'recruit':
        return typeof args[0] === 'string' && this.recruit(args[0]);
      case 'dismiss':
        return this.dismiss(this.colonist(args[0]));
      case 'upgradeSoldier':
        return this.upgradeSoldier(this.colonist(args[0]));
      case 'setVillageName': {
        if (typeof args[0] !== 'string') return false;
        this.villageName = cleanVillageName(args[0]);
        this.emit('village', this.villageName);
        this.emit('changed');
        return true;
      }
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
        return !!r && this.markRect(r, !!args[1], cleanKinds(args[2])) >= 0;
      }
      case 'markArea': {
        const [x, z, radius, marked] = args;
        if (num(x, 1000) === null || num(z, 1000) === null || num(radius, 50) === null) return false;
        return this.markArea(x, z, radius, !!marked, cleanKinds(args[4])) >= 0;
      }
      case 'clearMarks':
        this.clearMarks(cleanKinds(args[0]));
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
    const flags = (c) => (c.walking ? 1 : 0) | (c.working ? 2 : 0) | (c.sleeping ? 4 : 0) | (c.clothed ? 8 : 0) | (c.loving ? 16 : 0) | (c.inside ? 32 : 0) | (c.sleeping && c.outdoorSleep ? 64 : 0) | (c.moving ? 128 : 0) | (c.sitting === 'ground' ? 256 : 0) | (c.sitting === 'bench' ? 512 : 0);
    const mobsRows = () => this.mobs.map((m) => [m.id, MOB_TYPES.indexOf(m.type), r2(m.x), r2(m.z), r2(m.facing), m.state]);
    if (part === 'fast') {
      // gameTime: la hora de juego de esta colonia, para que quien la mira vea crecer los brotes plantados igual que su dueño.
      const out = { colonists: this.colonists.map((c) => [c.id, r2(c.x), r2(c.z), r2(c.facing), flags(c)]), mobs: mobsRows(), gameTime: r2(this.gameTime) };
      // De vez en cuando (statics=true) se agregan también los nacidos (para quien sólo ve
      // "fast", como los visitantes de otra colonia) y los caminos.
      if (statics) {
        out.born = this.colonists.filter((c) => c.id >= START_COLONISTS).map((c) => ({ ...this.staticOf(c), x: r2(c.x), z: r2(c.z) }));
        out.roads = [...this.roads].map(([k, lv]) => [...k.split(',').map(Number), lv]);
        // Lo ya talado/picado de baldosas normales (no la arboleda ni los brotes, que son
        // de cada campamento): así un visitante no ve árboles que ya no están.
        out.removed = [...this.removed].filter(([k]) => k !== GROVE_KEY && k !== SPROUT_KEY).map(([k, set]) => [k, [...set]]);
        // La arboleda de la aldea sale de su semilla (el visitante la regenera); aquí va lo que ya no está.
        // Los brotes (lluvia, árboles plantados, ramas) no salen de ninguna semilla: van completos.
        out.groveRemoved = [...(this.removed.get(GROVE_KEY) ?? [])];
        out.sprouts = this.sprouts;
        out.sproutRemoved = [...(this.removed.get(SPROUT_KEY) ?? [])];
      }
      return out;
    }
    const camp = this.camp;
    return {
      camp: camp && { dir: { x: camp.dir.x, y: camp.dir.y, z: camp.dir.z }, height: camp.height, yaw: camp.yaw, seed: camp.seed },
      gameTime: this.gameTime,
      age: this.age,
      clothesLeft: this.clothesLeft,
      flag: this.flag,
      villageName: this.villageName,
      produced: this.produced,
      techs: [...this.techs],
      expansions: this.expansions,
      ageChangedAt: this.ageChangedAt,
      flows: this.flowRates(),
      tradeUsed: Math.round(this.tradeUsed),
      tradeDay: this.tradeDay,
      armyUnpaid: this.armyUnpaid,
      grid: this.grid,
      mobs: mobsRows(),
      milestones: [...this.milestones],
      learned: [...this.learned],
      discovery: this.discovery,
      defeat: this.defeat,
      deaths: this.deaths.slice(-10),
      alerts: this.alerts,
      autoRoads: this.autoRoads,
      roads: statics ? [...this.roads].map(([k, lv]) => [...k.split(',').map(Number), lv]) : undefined,
      growthBlocker: this.growthBlocker,
      immigrationBlocker: this.immigrationBlocker,
      maxPopulation: this.maxPopulation,
      born: statics ? this.colonists.filter((c) => c.id >= START_COLONISTS).map((c) => ({ ...this.staticOf(c), x: r2(c.x), z: r2(c.z) })) : undefined,
      stock: this.stock,
      outdoor: this.outdoor,
      zones: this.zones,
      foodBatches: this.foodBatches.slice(0, 1),
      spoiled: this.spoiled,
      weather: this.weather?.save?.() ?? null,
      colonists: this.colonists.map((c) => ({
        id: c.id,
        needs: Object.fromEntries(Object.entries(c.needs).map(([k, v]) => [k, Math.round(v * 10) / 10])),
        health: r2(c.health),
        log: c.log,
        clothed: c.clothed,
        activity: c.activity,
        job: c.job?.id ?? null,
        sk: SKILLS.map((s) => Math.min(35, this.skillOf(c, s.id)).toString(36)).join(''),
        growth: Math.round(c.growth * 1000) / 1000,
        desire: Math.round(c.desire),
        mate: c.mate,
        pregnant: c.pregnant?.due ?? null,
        home: c.home,
        order: c.order ? { ...c.order, state: c.orderState } : null,
        spec: c.spec,
        pspec: c.pendingSpec,
        idle: c.idle,
        age: c.age,
        // Por qué está como está (sim/wellbeing.js): hacia dónde tira el ánimo, su categoría y tendencia, los golpes recientes,
        // la tarea y lo que le impide resolver su necesidad. La réplica del navegador lo usa para explicarlo.
        mf: [r2(c.moodTarget ?? c.needs.mood), c.moodBand ?? 2, c.moodTrend ?? 0, c.moodFx?.companion ?? 0, Math.round((c.moodFx?.homeless ?? 0) * 100)],
        me: c.moodEvents?.length ? c.moodEvents.map((e) => [e.id, r2(e.delta), r2(e.at)]) : undefined,
        tt: c.task?.type ?? null,
        bl: c.block ? [c.block.need, c.block.why] : undefined,
        sd: c.soldier ? c.soldier.unit : null,
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
        workers: b.workers.map((w) => w.id),
        cycle: r2(b.cycle),
        pf: r2(b.pf),
        op: b.operating,
        prio: b.priority,
        gate: !!b.gate,
        paused: b.paused,
        site: b.done ? undefined : siteStatus(this, b, this.nightNow),
        reason: b.reason,
        status: b.status,
      })),
      // [baldosa, índice, estado]: 1 un colono va a por él, 2 vuelve a crecer, 4 quedó pegado a un edificio, 8 almacén lleno
      marked: this.spots.filter((sp) => sp.marked && !sp.gone).map((sp) => [sp.key, sp.index, (sp.taken ? 1 : 0) | (sp.readyAt > this.gameTime ? 2 : 0) | (this.blockedByBuilding(sp.x, sp.z) ? 4 : 0) | (this.isFull(sp.kind) ? 8 : 0)]),
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
    // Colonos que murieron: ya no vienen en la lista (en "fast" también viene completa).
    if (Array.isArray(s.colonists)) {
      const ids = new Set(s.colonists.map((r) => (Array.isArray(r) ? r[0] : r.id)));
      if (this.colonists.some((c) => !ids.has(c.id))) {
        this.colonists = this.colonists.filter((c) => ids.has(c.id));
        this.emit('colonists');
      }
    }
    if (s.maxPopulation) this.maxPop = s.maxPopulation;
    for (const row of s.colonists ?? []) {
      const fast = Array.isArray(row);
      const c = this.colonist(fast ? row[0] : row.id);
      if (!c) continue;
      const [x, z, facing, f] = fast ? row.slice(1) : [row.x, row.z, row.facing, row.flags];
      c.x = x;
      c.z = z;
      c.facing = facing;
      pushSample(c, x, z, facing);
      c.walking = !!(f & 1);
      c.moving = !!(f & 128);
      c.working = !!(f & 2);
      c.sleeping = !!(f & 4);
      c.loving = !!(f & 16);
      c.inside = !!(f & 32);
      c.outdoorSleep = !!(f & 64);
      c.sitting = f & 512 ? 'bench' : f & 256 ? 'ground' : null;
      if (c.clothed !== !!(f & 8)) {
        c.clothed = !!(f & 8);
        this.emit('clothes');
      }
      if (fast) continue;
      Object.assign(c.needs, row.needs);
      c.health = row.health;
      c.log = row.log;
      c.activity = row.activity;
      if (row.sk) SKILLS.forEach((sk, i) => (c.skills[sk.id] = parseInt(row.sk[i], 36) || c.skills[sk.id]));
      c.growth = row.growth ?? 1;
      c.desire = row.desire ?? 0;
      c.mate = row.mate ?? null;
      c.pregnant = row.pregnant != null ? { due: row.pregnant } : null;
      c.home = row.home ?? null;
      c.spec = row.spec ?? null;
      c.pendingSpec = row.pspec ?? null;
      c.idle = row.idle ?? null;
      if (row.mf) {
        c.moodTarget = row.mf[0];
        c.moodBand = row.mf[1];
        c.moodTrend = row.mf[2];
        c.moodFx = { companion: row.mf[3], homeless: row.mf[4] / 100 };
      }
      c.moodEvents = row.me ? row.me.map(([id, delta, at]) => ({ id, delta, at })) : undefined;
      c.taskType = row.tt ?? null;
      c.block = row.bl ? { need: row.bl[0], why: row.bl[1] } : null;
      c.order = row.order ?? null;
      c.orderState = row.order?.state ?? null;
      c.soldier = row.sd && UNITS_BY_ID[row.sd] ? { unit: row.sd, tier: UNITS_BY_ID[row.sd].age } : null;
      if (row.age != null) c.age = row.age;
    }
    if (s.mobs) this.applyMobs(s.mobs);
    // Caminos: pueden venir con un "fast" (visitantes de otra colonia, de vez en cuando) o
    // con el estado completo propio.
    if (s.roads) {
      this.roads = new Map(s.roads.map(([ix, iz, lv]) => [roadKey(ix, iz), lv]));
      this.emit('roads');
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
    if (s.produced) this.produced = { ...s.produced };
    if (s.flows) this.flowsView = s.flows;
    if (Number.isFinite(s.tradeUsed)) {
      this.tradeUsed = s.tradeUsed;
      this.tradeDay = s.tradeDay;
    }
    if (s.grid) this.grid = s.grid;
    this.armyUnpaid = !!s.armyUnpaid;
    if (typeof s.autoRoads === 'boolean') this.autoRoads = s.autoRoads;
    if (s.milestones) this.milestones = new Set(s.milestones);
    if (s.learned) this.learned = new Set(s.learned);
    if (s.deaths) this.deaths = s.deaths;
    this.discovery = s.discovery ?? null;
    this.alertsView = s.alerts ?? null;
    if (JSON.stringify(s.defeat ?? null) !== JSON.stringify(this.defeat)) {
      this.defeat = s.defeat ?? null;
      if (this.defeat) this.emit('defeat', this.defeat);
    }
    this.growthBlockerView = s.growthBlocker ?? null;
    this.immigrationBlockerView = s.immigrationBlocker ?? null;
    if (s.techs) this.techs = new Set(s.techs);
    if (Number.isInteger(s.expansions) && s.expansions !== this.expansions) {
      this.expansions = s.expansions;
      this.emit('territory', radiusOf(this));
    }
    if (Number.isFinite(s.ageChangedAt)) this.ageChangedAt = s.ageChangedAt;
    if (s.flag && s.flag !== this.flag) {
      this.flag = s.flag;
      this.emit('flag', this.flag);
    }
    if (typeof s.villageName === 'string' && s.villageName !== this.villageName) {
      this.villageName = cleanVillageName(s.villageName);
      this.emit('village', this.villageName);
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
      if (b.done !== row.done || b.level !== row.level || b.upgrading !== row.upgrading || !!b.gate !== !!row.gate) changed = true;
      Object.assign(b, {
        progress: row.progress,
        done: row.done,
        level: row.level,
        upgrading: row.upgrading,
        store: row.store,
        produced: row.produced,
        reason: row.reason,
        status: row.status,
        cycle: row.cycle ?? 0,
        priority: row.prio ?? 'normal',
        gate: !!row.gate,
        paused: !!row.paused,
        site: row.site ?? null,
        pf: row.pf ?? 1,
        operating: !!row.op,
      });
      if (row.buildTime) b.buildTime = row.buildTime;
      const crew = (row.workers ?? []).map((id) => this.colonist(id)).filter(Boolean);
      if (crew.length !== b.workers.length || crew.some((w, i) => w !== b.workers[i])) {
        b.workers = crew;
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
    for (const b of this.buildings) for (const w of b.workers) w.job = b;
    if (changed) this.emit('buildings');

    // Recursos: marcas, lo talado y lo que brotó.
    const marked = new Map((s.marked ?? []).map(([key, index, state]) => [`${key}:${index}`, state | 0]));
    let marksChanged = false;
    for (const sp of this.spots) {
      const m = marked.has(`${sp.key}:${sp.index}`);
      sp.state = m ? marked.get(`${sp.key}:${sp.index}`) : 0;
      if (!!sp.marked !== m) {
        sp.marked = m;
        marksChanged = true;
      }
    }
    if (marksChanged) this.emit('marks');
    // Firma de los brotes: largo y todos sus datos que cambian (no sólo el primero y el último: al limpiar el arreglo del servidor
    // pueden cambiar los del medio y la copia se quedaba con piedras o árboles que ya no existen).
    const sproutSig = (list) => `${list?.length ?? 0}:${(list ?? []).reduce((a, it, i) => a + (it.d?.[0] ?? 0) * (i + 1) * 1e3 + (it.d?.[2] ?? 0) * 7 + (it.readyAt ?? 0) + (it.typeIndex ?? 0) * 13, 0).toFixed(3)}`;
    if (sproutSig(s.sprouts) !== sproutSig(this.sprouts)) {
      this.sprouts = s.sprouts ?? [];
      this.rebuildSprouts();
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
    this.villageName = cleanVillageName(data.villageName);
    this.produced = data.produced && typeof data.produced === 'object' ? { ...data.produced } : {};
    this.techs = new Set(Array.isArray(data.techs) ? data.techs.filter((t) => typeof t === 'string') : []);
    this.expansions = Number.isInteger(data.expansions) ? Math.max(0, data.expansions) : 0;
    this.ageChangedAt = Number.isFinite(data.ageChangedAt) ? data.ageChangedAt : 0;
    this.tradeUsed = Number.isFinite(data.tradeUsed) ? data.tradeUsed : 0;
    this.tradeDay = Number.isFinite(data.tradeDay) ? data.tradeDay : 0;
    this.nextRaidDay = Number.isFinite(data.nextRaidDay) ? data.nextRaidDay : null;
    this.armyUnpaid = !!data.armyUnpaid;
    this.roads = new Map((Array.isArray(data.roads) ? data.roads : []).filter((r) => r.length === 3).map(([ix, iz, lv]) => [roadKey(ix, iz), lv]));
    this.primitiveMigrated = !!data.primitiveMigrated;
    this.milestones = new Set(Array.isArray(data.milestones) ? data.milestones.filter((m) => typeof m === 'string') : []);
    this.learned = new Set(Array.isArray(data.learned) ? data.learned.filter((m) => LEARNABLE.concat(['zone_marked', 'food_marked']).includes(m)) : []);
    this.discovery = data.discovery && Number.isFinite(data.discovery.progress) ? { progress: Math.min(1, Math.max(0, data.discovery.progress)) } : null;
    this.defeat = data.defeat && typeof data.defeat.cause === 'string' ? { cause: data.defeat.cause, day: String(data.defeat.day ?? ''), last: String(data.defeat.last ?? '') } : null;
    this.deaths = Array.isArray(data.deaths) ? data.deaths.filter((d) => d && typeof d.name === 'string').slice(-20) : [];
    this.autoRoads = data.autoRoads !== false;
    const keys = (list) => new Set((Array.isArray(list) ? list : []).filter((k) => typeof k === 'string' && /^-?\d+,-?\d+$/.test(k)));
    this.autoRoadKeys = new Set([...keys(data.autoRoadKeys)].filter((k) => this.roads.has(k)));
    this.roadsOff = keys(data.roadsOff);
    // Partidas anteriores a la ropa: queda una prenda por cada colono sin vestir.
    const naked = (data.colonists || []).filter((s) => !s.clothed).length;
    this.clothesLeft = Number.isFinite(data.clothesLeft) ? data.clothesLeft : naked;
    for (const saved of data.colonists || []) {
      if (!saved.static || this.colonist(saved.id)) continue;
      this.colonists.push(this.makeColonist(saved.static, { ...saved, needs: saved.needs }));
    }
    // Los fundadores que murieron no vuelven (la lista guardada manda).
    if (Array.isArray(data.colonists)) {
      const alive = new Set(data.colonists.map((o) => o.id));
      this.colonists = this.colonists.filter((o) => alive.has(o.id));
    }
    this.nextColonistId = Math.max(START_COLONISTS, ...this.colonists.map((o) => o.id + 1), ...this.deaths.map(() => 0));
    this.birthRand = seededRandom((this.camp.seed ?? 1) ^ 0x2c1b3c6d ^ Math.floor(this.gameTime));
    for (const saved of data.colonists || []) {
      const c = this.colonists.find((o) => o.id === saved.id);
      if (!c) continue;
      if (Number.isFinite(saved.growth)) c.growth = saved.growth;
      if (Number.isFinite(saved.desire)) c.desire = saved.desire;
      c.mate = saved.mate ?? null;
      c.pregnant = saved.pregnant && Number.isFinite(saved.pregnant.due) ? saved.pregnant : null;
      c.home = saved.home ?? null;
      if (validSpec(saved.spec)) c.spec = [...saved.spec];
      if (validSpec(saved.pendingSpec)) c.pendingSpec = [...saved.pendingSpec];
      c.xp = saved.xp && typeof saved.xp === 'object' ? { ...saved.xp } : {};
      c.order = saved.order?.kind === 'build' ? { kind: 'build', building: saved.order.building } : saved.order?.kind === 'harvest' ? { kind: 'harvest' } : null;
      c.soldier = saved.soldier && UNITS_BY_ID[saved.soldier.unit] ? { unit: saved.soldier.unit, tier: saved.soldier.tier ?? UNITS_BY_ID[saved.soldier.unit].age } : null;
      if (Number.isFinite(saved.age)) c.age = saved.age;
      Object.assign(c.needs, saved.needs);
      c.health = saved.health ?? c.health;
      c.log = Array.isArray(saved.log) ? saved.log : c.log;
      c.flags = saved.flags || {};
      c.chatCooldown = saved.chatCooldown || 0;
      // Golpes recientes al ánimo (se validan: la partida puede venir de otra versión).
      const evs = Array.isArray(saved.moodEvents) ? saved.moodEvents.filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.delta) && Number.isFinite(e.at) && this.gameTime - e.at < 0.5 * DAY_LENGTH_SECONDS) : [];
      c.moodEvents = evs.length ? evs.slice(0, 4).map((e) => ({ id: e.id, delta: Math.max(-40, Math.min(40, e.delta)), at: Math.min(e.at, this.gameTime) })) : undefined;
      c.clothed = !!saved.clothed;
      if (Number.isFinite(saved.x) && this.walkable(saved.x, saved.z, 0.2)) {
        c.x = saved.x;
        c.z = saved.z;
      }
      c.facing = saved.facing ?? c.facing;
      c.task = null;
      c.sleeping = false;
    }
    data = this.migrateSprouts(data);
    if (data.sprouts.length) {
      this.sprouts = data.sprouts;
      this.refreshSprouts();
    }
    const byKey = new Map(this.spots.map((s) => [`${s.key}:${s.index}`, s]));
    for (const [key, index, readyAt] of data.regrowing || []) {
      const s = byKey.get(`${key}:${index}`);
      if (s) s.readyAt = readyAt;
    }
    for (const [key, index] of data.marked || []) {
      const s = byKey.get(`${key}:${index}`);
      if (s && this.usable(s)) s.marked = true; // las marcas en árboles de una aldea antigua en Primitiva se descartan
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
