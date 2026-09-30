import * as THREE from 'three';
import { RADIUS, surfaceHeight, elevation } from './elevation.js';
import { campObstacles } from './camp.js';
import { seededRandom, Parts, mat, stick, v } from './modelKit.js';
import { AGES, ageInfo, nextAgeStatus } from './ages.js';
import { insideRect, rectDistance, upgradeRect } from './rect.js';
import { temperature } from './biomes.js';
import { createProfile, updateNeeds, hasTrait, wellbeing, addLog } from './needs.js';
import { appearanceFromGenes, gene } from './genes.js';
import { campLayout } from './camp.js';
import { RESOURCE_TYPES } from './resourceTypes.js';
import { TILE_ANGLE, generateTile, generateCampGrove, GROVE_KEY, SPROUT_KEY, sproutItem, tileFromItems } from './resourceGen.js';
import { biomeAt as groveBiome } from './biomes.js';
import { chooseTask, shouldSwitch, runTask, endTask, taskActivity, taskLog, taskKey } from './ai.js';

// Colonos: tienen necesidades, salud, genes, rasgos, habilidades e historia
// (needs.js, genes.js) y una IA propia (ai.js) que decide qué hacer: comer, beber,
// dormir, calentarse, charlar, construir o trabajar en su edificio.
//
// Cada colono se mueve en el plano local del campamento (x, z en metros, la fogata en
// el origen). La altura sale del terreno real, con una caché en rejilla para no
// recalcular el relieve en cada fotograma. Esquivan tiendas, fogata y bancos, no
// entran al agua ni a pendientes fuertes, y no se atraviesan entre ellos.

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
export const FOOD_SPOIL_SECONDS = 1.5 * 360; // día y medio de juego

const WALK_SPEED = 1.4; // m/s
const COLONIST_RADIUS = 0.45;
const WANDER = [6, 70]; // pasean por el claro y sus alrededores (metros desde la fogata)
const HEIGHT_CELL = 2; // metros por celda de la caché de alturas
const MAX_STEP = 0.1; // segundos por paso de simulación
const LABEL_DISTANCE = 170; // metros: más lejos no se muestra el nombre
const FIRE_WARMTH_RADIUS = 7; // metros: la fogata calienta a quien esté más cerca
const COMPANY_RADIUS = 5; // metros: a esta distancia se hacen compañía
const PICK_RADIUS_PX = 26; // tolerancia al hacer clic sobre un colono
const MAX_STEPS_PER_FRAME = 80; // tope de pasos de simulación por fotograma (a ×60)
const SPOT_RADIUS = 230; // metros: recursos que los colonos conocen alrededor del campamento
const CAMP_CLEAR = 45; // alrededor del campamento no hay recursos naturales (resources.js)
const REGROW_SECONDS = 1.5 * 360; // las bayas y setas vuelven a crecer en día y medio
const MAX_SPROUTS = 50; // vegetación nueva que puede brotar con la lluvia
const SPROUT_EVERY = 25; // segundos de juego entre brotes con lluvia fuerte
// Qué recursos naturales sirven para qué.
const SPOT_KINDS = {
  food: ['berryBush', 'mushrooms'],
  wood: ['broadleaf', 'pine', 'jungleTree', 'acacia', 'palm'],
  stone: ['stone', 'flint'],
};

const NAMES = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Facundo', 'Gala', 'Hugo', 'Inés', 'Joaquín',
  'Lara', 'Mateo', 'Nora', 'Óscar', 'Paula', 'Quique', 'Rosa', 'Santiago', 'Tania', 'Ulises',
  'Valeria', 'Walter', 'Ximena', 'Yago', 'Zoe', 'Lucía', 'Tomás', 'Mara', 'Iván', 'Olga',
];
// Ropa de pieles (Edad Primitiva): tonos de cuero y piel curtida.
const SHIRTS = ['#8a5a34', '#a0764a', '#b8905a', '#7a5230', '#9a6a3e', '#c2a06a'];
const PANTS = ['#5a3a22', '#6b4a2e', '#4a3220', '#7a5a3a'];
const LOINCLOTH = '#6b4a2e'; // lo único que llevan al llegar
// Al fundar el campamento hay ropa en el suelo para todos; cada colono va a buscar la
// suya cuando tiene frío. Sin ropa se enfrían mucho más.
const CLOTHES_SPOT = { x: Math.cos(0.55) * 7.2, z: Math.sin(0.55) * 7.2 };

// ---------------------------------------------------------------------------
// Modelo low poly de una persona, con brazos y piernas que se mueven al caminar
// ---------------------------------------------------------------------------

const materials = new Map();
function material(color) {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });
    materials.set(color, m);
  }
  return m;
}

function box(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  mesh.position.set(x, y, z);
  return mesh;
}

// Brazo o pierna que gira desde el hombro o la cadera. "end" es la mano o el pie.
function limb(w, h, d, color, endColor, x, y, endForward = 0) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(box(w, h, d, color, 0, -h / 2, 0));
  pivot.add(box(w * 1.05, h * 0.2, d * 1.1, endColor, 0, -h + h * 0.08, endForward));
  return pivot;
}

function createPersonModel(look) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // se balancea al caminar
  root.add(body);

  const torso = box(0.5, 0.62, 0.28, look.shirt, 0, 1.2, 0);
  const hip = box(0.46, 0.14, 0.26, look.pants, 0, 0.86, 0);
  body.add(torso, hip);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), material(look.skin));
  head.position.set(0, 1.7, 0);
  body.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 7, 4, 0, Math.PI * 2, 0, look.longHair ? Math.PI * 0.62 : Math.PI * 0.45),
    material(look.hair),
  );
  hair.position.set(0, 1.72, -0.01);
  body.add(hair);

  const armL = limb(0.13, 0.58, 0.14, look.shirt, look.skin, -0.32, 1.48);
  const armR = limb(0.13, 0.58, 0.14, look.shirt, look.skin, 0.32, 1.48);
  const legL = limb(0.18, 0.84, 0.2, look.pants, '#2a2018', -0.12, 0.84, 0.04);
  const legR = limb(0.18, 0.84, 0.2, look.pants, '#2a2018', 0.12, 0.84, 0.04);
  body.add(armL, armR);
  root.add(legL, legR);

  root.scale.setScalar(look.height);
  root.userData = { body, armL, armR, legL, legR, torso, hip };
  return root;
}

// Viste o desviste el modelo: sin ropa, torso, brazos y piernas del color de la piel y
// un taparrabos en la cadera.
function dressModel(object, look, clothed) {
  const { torso, hip, armL, armR, legL, legR } = object.userData;
  torso.material = material(clothed ? look.shirt : look.skin);
  hip.material = material(clothed ? look.pants : LOINCLOTH);
  for (const arm of [armL, armR]) arm.children[0].material = material(clothed ? look.shirt : look.skin);
  for (const leg of [legL, legR]) leg.children[0].material = material(clothed ? look.pants : look.skin);
}

// Pila de ropa de pieles doblada: una prenda por colono que aún no la recogió.
function clothesPileMesh(count) {
  const group = new THREE.Group();
  const colors = ['#a0764a', '#8a5a34', '#b8905a', '#7a5230', '#c2a06a'];
  for (let k = 0; k < count; k++) {
    const piece = box(0.8, 0.12, 0.6, colors[k % colors.length], ((k % 2) - 0.5) * 0.08, 0.08 + k * 0.13, ((k % 3) - 1) * 0.05);
    piece.rotation.y = (k * 0.7) % 0.6;
    group.add(piece);
  }
  // Una piel extendida debajo, como alfombra.
  const hide = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.03, 7), material('#6b4a2e'));
  hide.scale.set(1.3, 1, 1);
  hide.position.y = 0.015;
  group.add(hide);
  return group;
}

// ---------------------------------------------------------------------------
// Sistema
// ---------------------------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class ColonySystem {
  constructor({ scene, camera, canvas, labelsRoot }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.labelsRoot = labelsRoot;
    this.group = new THREE.Group();
    this.group.name = 'colonists';
    scene.add(this.group);
    this.colonists = [];
    this.selected = null;
    this.camp = null;
    this.buildings = []; // edificios de la colonia (los gestiona BuildingSystem)
    this.spots = []; // recursos naturales cercanos
    this.resources = null; // ResourceSystem, para quitar lo que se tala
    this.stock = { food: 0, water: 0, wood: 0, stone: 0 }; // almacén de la colonia
    this.gameTime = 0;
    this.age = 1; // edad de la colonia (ages.js)
    this.totem = null;
    this.weather = null; // WeatherSystem: la lluvia acelera lo que crece y enfría
    this.sprouts = []; // brotes de la lluvia (se guardan)
    this.zones = []; // zonas de acopio al aire libre { x, z, r }
    this.outdoor = {}; // lo guardado al aire libre (parte de stock)
    this.foodBatches = []; // comida al aire libre: [{ amount, expires }]
    this.spoiled = 0; // comida perdida por pudrirse
    this.sproutTimer = 0;
    this.layout = campLayout();
    this.campTemperature = 0.5;
    this.obstacles = campObstacles();
    this.onSelect = null; // lo asigna la interfaz
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 24),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.06;
    this.selectionRing.visible = false;
    this.heights = new Map();
    this.tmp = {
      local: new THREE.Vector3(),
      world: new THREE.Vector3(),
      yaw: new THREE.Quaternion(),
      proj: new THREE.Vector3(),
    };
  }

  get count() {
    return this.colonists.length;
  }

  // Llamar en cada fotograma con el campamento actual (o null si no hay).
  // Por ahora sólo pasean. Adónde van lo decidirán sus necesidades (paso 2 y 3): por
  // ejemplo, con frío buscarán una fuente de calor como la fogata.
  // env: { timeScale, isNight, timeLabel() } — timeLabel da la hora para el registro.
  update(delta, camp, { timeScale = 1, isNight = false, timeLabel = () => '' } = {}) {
    if (camp !== this.camp) this.setCamp(camp);
    if (!this.camp) return;

    // Todo sigue la velocidad del tiempo (pausa = quietos), en pasos cortos.
    const gameDt = delta * timeScale;
    const time = timeLabel();
    const env = { isNight, time, gameTime: this.gameTime };
    if (gameDt > 0) {
      const rain = this.weather?.rain ?? 0;
      const ambient = Math.min(1, Math.max(0, (this.campTemperature - (isNight ? 0.3 : 0) - 0.12 - rain * 0.12) * 1.6));
      this.updateRain(gameDt, rain);
      this.updateSpoilage();
      let simTime = gameDt;
      let steps = 0;
      while (simTime > 1e-4 && steps++ < MAX_STEPS_PER_FRAME) {
        const dt = Math.min(MAX_STEP, simTime);
        simTime -= dt;
        this.gameTime += dt;
        env.gameTime = this.gameTime;
        for (const c of this.colonists) {
          c.companion = c.sleeping ? null : this.nearestColonist(c, COMPANY_RADIUS);
          c.nearFire = Math.hypot(c.x, c.z) < FIRE_WARMTH_RADIUS;
          updateNeeds(c, {
            dt,
            ambient,
            nearFire: c.nearFire,
            sheltered: c.sleeping,
            clothed: c.clothed,
            companion: c.companion,
            walking: c.walking,
            time,
          });
          this.step(c, dt, env);
        }
      }
    }
    for (const c of this.colonists) this.place(c, delta * Math.min(timeScale, 8));
    this.updateLabels();
  }

  // ---- Campamento -------------------------------------------------------

  setCamp(camp) {
    for (const c of this.colonists) {
      this.group.remove(c.object);
      c.label.remove();
    }
    this.colonists = [];
    this.select(null);
    this.heights.clear();
    this.water = undefined;
    this.camp = camp;
    this.stock = { ...START_STOCK };
    this.zones = [];
    this.outdoor = {};
    this.foodBatches = [];
    this.spoiled = 0;
    this.setClothesLeft(0);
    this.onZonesChange?.();
    this.setAge(1);
    this.sprouts = [];
    this.resources?.setExtraTile(SPROUT_KEY, null);
    if (!camp) {
      this.resources?.setExtraTile(GROVE_KEY, null);
      this.onCampChange?.(null);
      return;
    }
    this.loadResourceSpots();
    this.campTemperature = temperature(camp.dir.x, camp.dir.y, camp.dir.z, elevation(camp.dir.x, camp.dir.y, camp.dir.z));

    // Colonos siempre iguales para un mismo campamento (misma semilla).
    const rand = seededRandom((camp.seed ?? 1) ^ 0x5bd1e995);
    const names = [...NAMES];
    for (let i = 0; i < START_COLONISTS; i++) {
      const name = names.splice(Math.floor(rand() * names.length), 1)[0];
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
      const object = createPersonModel(look);
      dressModel(object, look, false); // llegan sin ropa
      this.group.add(object);
      // Aparecen alrededor de la fogata.
      const a = (i / START_COLONISTS) * Math.PI * 2 + rand() * 0.5;
      const spot = this.freeSpot(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
      // Etiqueta sobre la cabeza: nombre y barra de salud. Se puede hacer clic en ella.
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'colonist-label';
      label.innerHTML = `<span class="colonist-label-name"></span><span class="colonist-label-hp"><i></i></span>`;
      label.querySelector('.colonist-label-name').textContent = name;
      label.hidden = true;
      this.labelsRoot.appendChild(label);
      const colonist = {
        id: i,
        name,
        ...profile,
        look,
        object,
        label,
        x: spot.x,
        z: spot.z,
        facing: Math.atan2(-spot.x, -spot.z),
        task: null,
        thinkTimer: rand() * 2,
        walking: false,
        working: false,
        sleeping: false,
        phase: rand() * 10,
        moving: 0, // 0 quieto, 1 caminando (suavizado para la animación)
        stuckTimer: 0,
        lastProgress: 0,
        rand: seededRandom(Math.floor(rand() * 4294967296)),
        activity: 'Descansando un momento',
        clothed: false,
      };
      label.addEventListener('click', () => this.select(colonist));
      addLog(colonist, 'Día 1', 'Llegó al campamento');
      this.colonists.push(colonist);
    }
    this.setClothesLeft(START_COLONISTS); // ropa en el suelo para todos
    this.onCampChange?.(camp); // los edificios se cargan cuando ya hay colonos
  }

  // ---- Ropa --------------------------------------------------------------

  get clothesSpot() {
    return CLOTHES_SPOT;
  }

  setClothesLeft(n) {
    this.clothesLeft = n;
    if (this.clothesPile) {
      this.clothesPile.removeFromParent();
      this.clothesPile.traverse((o) => o.geometry?.dispose());
      this.clothesPile = null;
    }
    if (!this.camp || n <= 0) return;
    this.clothesPile = clothesPileMesh(n);
    const { x, z } = CLOTHES_SPOT;
    this.clothesPile.position.set(x, this.heightAt(x, z) - this.camp.height, z);
    this.camp.object.add(this.clothesPile);
  }

  // El colono toma una prenda de la pila y se viste.
  takeClothes(c) {
    if (this.clothesLeft <= 0 || c.clothed) return false;
    this.setClothesLeft(this.clothesLeft - 1);
    this.setClothed(c, true);
    return true;
  }

  setClothed(c, clothed) {
    c.clothed = clothed;
    dressModel(c.object, c.look, clothed);
  }

  // ---- Selección ---------------------------------------------------------

  select(c) {
    if (this.selected === c) return;
    if (this.selected) this.selected.label.classList.remove('is-selected');
    this.selected = c;
    if (c) {
      c.label.classList.add('is-selected');
      c.object.add(this.selectionRing);
      this.selectionRing.visible = true;
    } else {
      this.selectionRing.removeFromParent();
      this.selectionRing.visible = false;
    }
    this.onSelect?.(c);
  }

  // Colono bajo un punto de la pantalla (en píxeles del lienzo), o null.
  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.tmp.proj;
    let best = null;
    let bestDist = Infinity;
    for (const c of this.colonists) {
      // Centro del cuerpo, a ~1 m del suelo.
      p.copy(c.object.position);
      p.add(this.tmp.local.copy(p).normalize().multiplyScalar(1.0 * c.look.height));
      const dist3 = this.camera.position.distanceTo(p);
      p.project(this.camera);
      if (p.z > 1) continue;
      const x = rect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - p.y) / 2) * rect.height;
      // Tamaño en pantalla de ~1 m a esa distancia.
      const pxPerMeter = rect.height / (2 * dist3 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
      const radius = Math.max(PICK_RADIUS_PX, pxPerMeter * 1.2);
      const d = Math.hypot(clientX - x, clientY - y);
      if (d < radius && d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  // Dirección en el planeta donde está un colono (para centrar la cámara).
  directionOf(c, out = new THREE.Vector3()) {
    return this.toDirection(c.x, c.z, out);
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

  // ---- Terreno ----------------------------------------------------------

  // Local (x, z) del campamento -> dirección unitaria en el planeta.
  toDirection(x, z, out) {
    const { object } = this.camp;
    out.set(x, 0, z).applyQuaternion(object.quaternion).add(object.position);
    return out.normalize();
  }

  // Punto del mundo -> coordenadas locales del campamento (x, z en metros).
  toLocal(point, out = new THREE.Vector3()) {
    const { object } = this.camp;
    this.tmp.inv ??= new THREE.Quaternion();
    this.tmp.inv.copy(object.quaternion).invert();
    return out.copy(point).sub(object.position).applyQuaternion(this.tmp.inv);
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

  // ---- Movimiento ---------------------------------------------------------

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

  // ---- Comportamiento ---------------------------------------------------

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

  // ---- Conocimiento del entorno (para la IA) ------------------------------

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
    const inv = this.camp.object.quaternion.clone().invert();
    const origin = this.camp.object.position;
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
    const biome = groveBiome(dir.x, dir.y, dir.z).id;
    const grove = generateCampGrove(dir.x, dir.y, dir.z, biome, this.camp.seed ?? 1);
    addTile(GROVE_KEY, grove, 0);
    this.resources?.setExtraTile(GROVE_KEY, grove);

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

  // ---- Almacén -----------------------------------------------------------

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
      if (lost >= 1) this.onSpoil?.(lost);
    }
  }

  // ---- Zonas de acopio al aire libre ------------------------------------------

  zoneProblem(rect) {
    if (rect.hw * 2 < MIN_ZONE_SIDE || rect.hd * 2 < MIN_ZONE_SIDE) return 'La zona es demasiado chica';
    for (const o of this.obstacles) {
      if (rectDistance(rect, o.x, o.z) < o.r) return 'Choca con el campamento o un edificio';
    }
    return null;
  }

  // Sólo hay una zona de acopio: dibujar otra la reemplaza (lo guardado se mantiene si
  // cabe en la nueva).
  setZone(rect) {
    const problem = this.zoneProblem(rect);
    if (problem) return problem;
    this.zones = [{ cx: rect.cx, cz: rect.cz, hw: rect.hw, hd: rect.hd, angle: rect.angle }];
    this.trimOutdoor();
    this.onZonesChange?.();
    return null;
  }

  // Al quitar la zona, lo guardado al aire libre se pierde.
  removeZone() {
    this.zones = [];
    this.trimOutdoor();
    this.onZonesChange?.();
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

  // ---- Edades ------------------------------------------------------------

  // Pasar a la edad siguiente si se cumplen los requisitos (edificios mejorados y la
  // ofrenda de materiales). Todos lo celebran y aparece el tótem de la tribu.
  advanceAge(timeLabel = '') {
    const status = nextAgeStatus(this);
    if (!status.ready) return false;
    for (const [k, n] of Object.entries(status.next.requires.cost)) this.takeStock(k, n);
    this.setAge(status.next.n);
    for (const c of this.colonists) {
      addLog(c, timeLabel, `Celebró la llegada de la ${status.next.name}`);
      c.needs.mood = Math.min(100, c.needs.mood + 25);
    }
    this.onAgeChange?.(this.age);
    return true;
  }

  setAge(age) {
    this.age = age;
    const wantTotem = age >= 2 && this.camp;
    if (this.totem && !wantTotem) {
      this.totem.removeFromParent();
      this.totem.geometry.dispose();
      this.totem = null;
    }
    if (wantTotem && !this.totem) {
      this.totem = totemMesh();
      this.totem.position.set(TOTEM_SPOT.x, this.heightAt(TOTEM_SPOT.x, TOTEM_SPOT.z) - (this.camp.height ?? this.heightAt(0, 0)) - 0.1, TOTEM_SPOT.z);
      this.camp.object.add(this.totem);
    }
    this.refreshObstacles();
  }

  get ageInfo() {
    return ageInfo(this.age);
  }

  // ---- Lluvia -------------------------------------------------------------

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
      this.onSprout?.(`Con la lluvia brotó ${name} cerca del campamento.`);
      return true;
    }
    return false;
  }

  // Rehace la baldosa de brotes y añade los puntos de recolección nuevos (los brotes sólo
  // se agregan al final, así que los ya conocidos conservan su índice).
  refreshSprouts() {
    const tile = tileFromItems(this.sprouts);
    this.resources?.setExtraTile(SPROUT_KEY, tile.count ? tile : null);
    const known = this.spots.filter((s) => s.key === SPROUT_KEY).length;
    const p = new THREE.Vector3();
    for (let k = known; k < tile.count; k++) {
      this.toLocal(p.set(tile.pos[k * 3], tile.pos[k * 3 + 1], tile.pos[k * 3 + 2]), p);
      this.spots.push({ key: SPROUT_KEY, index: k, kind: 'food', type: RESOURCE_TYPES[tile.type[k]].id, x: p.x, z: p.z, readyAt: 0, taken: null });
    }
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
    let changed = 0;
    for (const s of this.spots) {
      if (s.gone || !insideRect(rect, s.x, s.z)) continue;
      if (!!s.marked !== marked) {
        s.marked = marked;
        changed++;
      }
    }
    if (changed) this.onMarksChange?.();
    return changed;
  }

  // Marcar o desmarcar los recursos dentro de un círculo (coordenadas del campamento).
  markArea(x, z, radius, marked) {
    let changed = 0;
    for (const s of this.spots) {
      if (s.gone || Math.hypot(s.x - x, s.z - z) > radius) continue;
      if (!!s.marked !== marked) {
        s.marked = marked;
        changed++;
      }
    }
    if (changed) this.onMarksChange?.();
    return changed;
  }

  clearMarks() {
    for (const s of this.spots) s.marked = false;
    this.onMarksChange?.();
  }

  // Un recurso usado: los árboles y las piedras desaparecen; las bayas vuelven a crecer.
  consumeSpot(spot, gameTime) {
    spot.taken = null;
    if (spot.marked) {
      spot.marked = false;
      this.onMarksChange?.();
    }
    if (spot.kind === 'food') {
      spot.readyAt = gameTime + REGROW_SECONDS;
    } else {
      spot.gone = true;
      this.resources?.removeResource(spot.key, spot.index);
    }
  }

  // ---- Guardado --------------------------------------------------------

  // Estado de la colonia que cambia con el juego (lo fijo —nombres, genes, rasgos— sale
  // de la semilla del campamento y no hace falta guardarlo).
  serialize() {
    return {
      gameTime: this.gameTime,
      age: this.age,
      clothesLeft: this.clothesLeft,
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
      })),
      regrowing: this.spots.filter((s) => s.readyAt > this.gameTime).map((s) => [s.key, s.index, s.readyAt]),
      removed: this.resources ? this.resources.serializeRemoved() : [],
      sprouts: this.sprouts,
      marked: this.spots.filter((s) => s.marked && !s.gone).map((s) => [s.key, s.index]),
      zones: this.zones,
      outdoor: this.outdoor,
      foodBatches: this.foodBatches,
      spoiled: this.spoiled,
    };
  }

  restore(data) {
    if (!data) return;
    this.gameTime = data.gameTime || 0;
    // Zonas antiguas (redondas) se convierten en un cuadrado; sólo se queda la primera.
    this.zones = (Array.isArray(data.zones) ? data.zones : []).map(upgradeRect).filter(Boolean).slice(0, 1);
    this.outdoor = data.outdoor && typeof data.outdoor === 'object' ? { ...data.outdoor } : {};
    this.foodBatches = Array.isArray(data.foodBatches) ? data.foodBatches.filter((b) => b.amount > 0) : [];
    this.spoiled = data.spoiled || 0;
    this.onZonesChange?.();
    this.setAge(Math.min(AGES.length, Math.max(1, data.age || 1)));
    // Partidas anteriores a la ropa: queda una prenda por cada colono sin vestir.
    const naked = (data.colonists || []).filter((s) => !s.clothed).length;
    this.setClothesLeft(Number.isFinite(data.clothesLeft) ? data.clothesLeft : naked);
    for (const saved of data.colonists || []) {
      const c = this.colonists.find((o) => o.id === saved.id);
      if (!c) continue;
      Object.assign(c.needs, saved.needs);
      c.health = saved.health ?? c.health;
      c.log = Array.isArray(saved.log) ? saved.log : c.log;
      c.flags = saved.flags || {};
      c.chatCooldown = saved.chatCooldown || 0;
      this.setClothed(c, !!saved.clothed);
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
    this.onMarksChange?.();
    if (this.resources) this.resources.restoreRemoved(data.removed);
    for (const [key, indices] of data.removed || []) {
      for (const index of indices) {
        const s = byKey.get(`${key}:${index}`);
        if (s) s.gone = true;
      }
    }
  }

  refreshObstacles() {
    this.obstacles = [
      ...campObstacles(),
      ...(this.totem ? [{ x: TOTEM_SPOT.x, z: TOTEM_SPOT.z, r: 0.9, kind: 'prop' }] : []),
      ...this.buildings.map((b) => ({ x: b.x, z: b.z, r: b.def.footprint, kind: 'building' })),
    ];
  }

  place(c, animDelta) {
    // Durmiendo está dentro de la tienda: no se ve.
    c.object.visible = !c.sleeping;
    const { world, yaw } = this.tmp;
    const walking = c.walking ? 1 : 0;
    c.moving += (walking - c.moving) * Math.min(1, animDelta * 6);
    c.phase += animDelta * WALK_SPEED * 5.2 * c.moving;

    const h = this.heightAt(c.x, c.z);
    this.toDirection(c.x, c.z, world);
    c.object.position.copy(world).multiplyScalar(RADIUS + h);
    // Orientación: la del campamento (su "arriba" es el del planeta allí) y el rumbo.
    c.object.quaternion.copy(this.camp.object.quaternion).multiply(yaw.setFromAxisAngle(Y_AXIS, c.facing));

    const { body, armL, armR, legL, legR } = c.object.userData;
    const swing = Math.sin(c.phase) * 0.65 * c.moving;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    if (c.working) {
      // Trabajando: los dos brazos golpean hacia delante (talar, picar, recoger).
      c.workPhase = (c.workPhase || 0) + animDelta * 7;
      const hit = -1.2 - Math.sin(c.workPhase) * 0.9;
      armL.rotation.x = hit;
      armR.rotation.x = hit;
    } else {
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
    }
    const breathe = Math.sin(performance.now() * 0.0018 + c.phase) * 0.01 * (1 - c.moving);
    body.position.y = Math.abs(Math.cos(c.phase)) * 0.05 * c.moving + breathe;
  }

  // Nombres sobre la cabeza cuando la cámara está cerca.
  updateLabels() {
    const cam = this.camera;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.tmp.proj;
    for (const c of this.colonists) {
      // Un poco por encima de la cabeza.
      p.copy(c.object.position);
      p.add(this.tmp.local.copy(p).normalize().multiplyScalar(2.3 * c.look.height));
      const dist = cam.position.distanceTo(p);
      p.project(cam);
      const visible = !c.sleeping && dist < LABEL_DISTANCE && p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      c.label.hidden = !visible;
      if (visible) {
        const hp = c.label.lastChild.firstChild;
        const width = `${Math.round(c.health)}%`;
        if (hp.style.width !== width) hp.style.width = width;
        c.label.classList.toggle('is-hurt', c.health < 50);
        const x = rect.left + ((p.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - p.y) / 2) * rect.height;
        c.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        c.label.style.opacity = String(Math.min(1, (LABEL_DISTANCE - dist) / 40));
      }
    }
  }
}

// Tótem de la tribu (llega con la Edad Tribal), junto a la fogata.
const TOTEM_SPOT = { x: Math.cos(4.6) * 7, z: Math.sin(4.6) * 7 };
let totemMaterial = null;

function totemMesh() {
  const p = new Parts();
  const faces = ['#9a5a34', '#b8763e', '#8a4a2a'];
  for (let k = 0; k < 3; k++) {
    const y = 0.6 + k * 1.05;
    p.add(new THREE.CylinderGeometry(0.42, 0.46, 1.0, 8), faces[k], mat(0, y, 0));
    // Ojos, boca y pico pintados.
    p.add(new THREE.BoxGeometry(0.16, 0.12, 0.08), '#f0e2c0', mat(-0.16, y + 0.18, 0.42));
    p.add(new THREE.BoxGeometry(0.16, 0.12, 0.08), '#f0e2c0', mat(0.16, y + 0.18, 0.42));
    p.add(new THREE.BoxGeometry(0.34, 0.08, 0.08), k === 1 ? '#2f5d7a' : '#a8452d', mat(0, y - 0.2, 0.43));
    p.add(new THREE.ConeGeometry(0.1, 0.3, 4), '#e0c25a', mat(0, y, 0.52, Math.PI / 2, 0, 0));
  }
  // Alas y cabeza de pájaro arriba.
  p.add(new THREE.BoxGeometry(2.2, 0.14, 0.4), '#a8452d', mat(0, 3.1, 0, 0, 0, 0));
  p.add(new THREE.BoxGeometry(0.7, 0.14, 0.38), '#2f5d7a', mat(-1.05, 3.2, 0, 0, 0, 0.35));
  p.add(new THREE.BoxGeometry(0.7, 0.14, 0.38), '#2f5d7a', mat(1.05, 3.2, 0, 0, 0, -0.35));
  p.add(new THREE.DodecahedronGeometry(0.36, 0), '#e0c25a', mat(0, 3.5, 0.05));
  p.add(new THREE.ConeGeometry(0.12, 0.4, 4), '#d08a2a', mat(0, 3.45, 0.45, Math.PI / 2, 0, 0));
  // Piedras en la base y plumas colgando.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    p.add(new THREE.DodecahedronGeometry(0.22, 0), '#8f8a82', mat(Math.cos(a) * 0.62, 0.12, Math.sin(a) * 0.62, a, a, 0));
  }
  stick(p, v(-0.9, 3.05, 0.1), v(-0.95, 2.5, 0.12), 0.03, '#f0e2c0', 3);
  stick(p, v(0.9, 3.05, 0.1), v(0.95, 2.5, 0.12), 0.03, '#f0e2c0', 3);
  totemMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const mesh = p.mesh(totemMaterial);
  mesh.rotation.y = -4.6 + Math.PI / 2; // la cara mira a la fogata
  return mesh;
}

export function zoneCapacity(zone) {
  return Math.round(4 * zone.hw * zone.hd * ZONE_PER_M2);
}
