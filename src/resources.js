import * as THREE from 'three';
import { RADIUS, SEED, surfaceHeight, terrainZones, zoneDistance } from './elevation.js';
import { biomeAt } from './biomes.js';
import { createNoise3D } from './noise.js';
import { partsGeometry, mat, stick, v, seededRandom } from './modelKit.js';

// Recursos naturales: aparecen solos por todo el planeta, al azar pero siempre en el
// mismo lugar (cada zona del mundo usa su propia semilla). Qué recurso aparece y con
// qué frecuencia depende del bioma. Sólo se dibujan cerca de la cámara.
//
// El mundo se divide en baldosas de ~TILE metros. Cada baldosa calcula sus recursos
// una sola vez (se guardan) y cada tipo de recurso se dibuja con un InstancedMesh: una
// llamada de dibujo por tipo, tenga cien o miles de ejemplares.

const TILE = 320; // metros por baldosa
const TILE_ANGLE = TILE / RADIUS;
const MAX_INSTANCES = 12000; // por tipo de recurso
const BUILD_BUDGET_MS = 3; // tiempo máximo por fotograma generando baldosas
const MAX_VISIBLE_CLEARANCE = 6_000; // más alto no se dibujan (serían puntitos)
const CAMP_CLEAR_RADIUS = 90; // alrededor del campamento no aparece nada

const forestNoise = createNoise3D(SEED + 21);
const oreNoise = createNoise3D(SEED + 22);

// ---------------------------------------------------------------------------
// Tipos de recurso: nombre, qué da, modelo y en qué biomas aparece
// ---------------------------------------------------------------------------
// "biomes" da la cantidad media por baldosa en cada bioma. "clustered" hace que se
// agrupen en bosques (ruido), "ore" que sólo aparezcan en vetas (ruido raro).

export const RESOURCES = {
  broadleaf: {
    name: 'Árbol frondoso',
    gives: 'Madera dura',
    scale: [0.8, 1.35],
    clustered: true,
    biomes: { forest: 75, grassland: 10, swamp: 14, steppe: 2 },
    model: (p) => {
      stick(p, v(0, -0.5, 0), v(0, 4, 0), 0.35, '#5e4128', 6);
      for (const [x, y, z, r, c] of [
        [0, 5.2, 0, 2.5, '#4f8a3a'],
        [1.1, 4.6, 0.6, 1.8, '#5c9a42'],
        [-1, 4.8, -0.5, 1.9, '#447d36'],
      ]) {
        p.add(new THREE.IcosahedronGeometry(r, 0), c, mat(x, y, z, 0.3, 0.5, 0));
      }
    },
  },
  pine: {
    name: 'Pino',
    gives: 'Madera blanda y resina',
    scale: [0.8, 1.4],
    clustered: true,
    biomes: { taiga: 85, forest: 22, mountain: 6, tundra: 2 },
    model: (p) => {
      stick(p, v(0, -0.5, 0), v(0, 2.6, 0), 0.3, '#5a3b24', 5);
      for (const [r, h, y, c] of [
        [2.8, 4.2, 3.4, '#2f5a34'],
        [2.1, 3.6, 5.6, '#34633a'],
        [1.4, 3.0, 7.7, '#3a6b40'],
      ]) {
        p.add(new THREE.ConeGeometry(r, h, 7), c, mat(0, y, 0));
      }
    },
  },
  jungleTree: {
    name: 'Árbol tropical',
    gives: 'Madera dura y frutas',
    scale: [0.9, 1.4],
    clustered: true,
    biomes: { jungle: 90, swamp: 8 },
    model: (p) => {
      stick(p, v(0, -0.5, 0), v(0.3, 8, 0), 0.4, '#6a4c30', 6);
      p.add(new THREE.IcosahedronGeometry(3.2, 0), '#2e7a2c', mat(0.3, 9.3, 0, 0.2, 0.4, 0, 1, 0.6, 1));
      p.add(new THREE.IcosahedronGeometry(2.2, 0), '#3a8f34', mat(-1.2, 8.2, 1, 0.5, 0.1, 0, 1, 0.7, 1));
      p.add(new THREE.IcosahedronGeometry(0.35, 0), '#e0a030', mat(1.2, 7.8, 0.8));
    },
  },
  acacia: {
    name: 'Acacia',
    gives: 'Madera y sombra',
    scale: [0.8, 1.2],
    biomes: { savanna: 7, steppe: 1.5 },
    model: (p) => {
      stick(p, v(0, -0.5, 0), v(0.4, 3.2, 0), 0.25, '#6e5236', 5);
      stick(p, v(0.4, 3.2, 0), v(1.6, 4.4, 0.4), 0.16, '#6e5236', 4);
      stick(p, v(0.4, 3.2, 0), v(-1, 4.3, -0.3), 0.16, '#6e5236', 4);
      p.add(new THREE.CylinderGeometry(3.3, 2.6, 0.9, 8), '#6f8a3a', mat(0.3, 4.7, 0));
    },
  },
  palm: {
    name: 'Palmera',
    gives: 'Cocos y fibras',
    scale: [0.8, 1.2],
    biomes: { beach: 2, jungle: 1.5 },
    model: (p) => {
      stick(p, v(0, -0.5, 0), v(0.6, 3, 0), 0.22, '#8a6a44', 5);
      stick(p, v(0.6, 3, 0), v(1.1, 6.2, 0), 0.19, '#8a6a44', 5);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        p.add(new THREE.BoxGeometry(3, 0.08, 0.7), '#4f8f3a', mat(1.1 + Math.cos(a) * 1.3, 6, Math.sin(a) * 1.3, 0, -a, -0.4));
      }
      p.add(new THREE.IcosahedronGeometry(0.28, 0), '#6b4a2a', mat(1.1, 5.8, 0.2));
    },
  },
  cactus: {
    name: 'Cactus',
    gives: 'Agua y fibras',
    scale: [0.7, 1.3],
    biomes: { desert: 2.5 },
    model: (p) => {
      p.add(new THREE.CylinderGeometry(0.35, 0.4, 3.4, 7), '#5e8a3a', mat(0, 1.6, 0));
      p.add(new THREE.CylinderGeometry(0.22, 0.25, 1.2, 6), '#5e8a3a', mat(0.6, 1.9, 0, 0, 0, Math.PI / 2));
      p.add(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 6), '#5e8a3a', mat(1.15, 2.4, 0));
      p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 6), '#5e8a3a', mat(-0.55, 1.4, 0, 0, 0, Math.PI / 2));
      p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.8, 6), '#5e8a3a', mat(-0.95, 1.8, 0));
    },
  },
  berryBush: {
    name: 'Arbusto de bayas',
    gives: 'Comida',
    scale: [0.8, 1.3],
    biomes: { grassland: 4, forest: 3, taiga: 2, savanna: 1, jungle: 2 },
    model: (p) => {
      p.add(new THREE.IcosahedronGeometry(1.1, 0), '#3f7a34', mat(0, 0.8, 0, 0, 0, 0, 1.2, 0.8, 1.1));
      p.add(new THREE.IcosahedronGeometry(0.8, 0), '#4a8a3c', mat(0.7, 0.7, 0.3, 0.4, 0, 0));
      for (const [x, y, z] of [[0.6, 1.3, 0.7], [-0.7, 1.1, 0.5], [0.2, 1.5, -0.6], [-0.3, 0.9, 0.9], [0.9, 0.9, -0.3]]) {
        p.add(new THREE.IcosahedronGeometry(0.17, 0), '#c0283a', mat(x, y, z));
      }
    },
  },
  mushrooms: {
    name: 'Setas',
    gives: 'Comida',
    scale: [0.8, 1.3],
    biomes: { forest: 1.5, taiga: 1.5, jungle: 1, swamp: 1.5 },
    model: (p) => {
      for (const [x, z, s] of [[0, 0, 1], [0.5, 0.3, 0.7], [-0.4, 0.4, 0.6]]) {
        p.add(new THREE.CylinderGeometry(0.08 * s, 0.1 * s, 0.5 * s, 5), '#e8dcc0', mat(x, 0.25 * s, z));
        p.add(new THREE.ConeGeometry(0.35 * s, 0.3 * s, 7), '#b8402e', mat(x, 0.55 * s, z));
      }
    },
  },
  reeds: {
    name: 'Juncos',
    gives: 'Fibras y techos',
    scale: [0.8, 1.2],
    biomes: { swamp: 10, beach: 0.5 },
    model: (p) => {
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const r = 0.2 + (i % 3) * 0.25;
        p.add(new THREE.ConeGeometry(0.06, 2 + (i % 4) * 0.4, 3), '#7d8f45', mat(Math.cos(a) * r, 1, Math.sin(a) * r, 0.1 * Math.sin(i), 0, 0.1 * Math.cos(i)));
      }
      p.add(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 5), '#6a4a2a', mat(0.2, 2.3, 0.1));
    },
  },
  stone: {
    name: 'Piedras',
    gives: 'Piedra',
    scale: [0.7, 1.6],
    biomes: { mountain: 6, tundra: 3, desert: 2, steppe: 1.5, grassland: 1, forest: 0.8, taiga: 1, savanna: 1, snow: 1, beach: 0.5 },
    model: (p) => {
      p.add(new THREE.DodecahedronGeometry(1.1, 0), '#8b877f', mat(0, 0.45, 0, 0.3, 0.2, 0, 1.3, 0.8, 1));
      p.add(new THREE.DodecahedronGeometry(0.6, 0), '#7f7b73', mat(1.1, 0.3, 0.4, 0.8, 0.5, 0));
      p.add(new THREE.DodecahedronGeometry(0.4, 0), '#948f86', mat(-0.9, 0.2, 0.5, 0.1, 0.9, 0));
    },
  },
  flint: {
    name: 'Pedernal',
    gives: 'Herramientas de piedra',
    scale: [0.7, 1.1],
    biomes: { grassland: 0.4, steppe: 0.6, forest: 0.3, desert: 0.4 },
    model: (p) => {
      for (const [x, z, r] of [[0, 0, 0.35], [0.4, 0.2, 0.25], [-0.3, 0.3, 0.3]]) {
        p.add(new THREE.OctahedronGeometry(r, 0), '#3b3a3c', mat(x, r * 0.5, z, 0.4, x * 3, 0.2));
      }
    },
  },
  clay: {
    name: 'Arcilla',
    gives: 'Cerámica y ladrillos',
    scale: [0.8, 1.3],
    biomes: { swamp: 2, beach: 0.6, grassland: 0.2 },
    model: (p) => {
      p.add(new THREE.CylinderGeometry(1.6, 1.8, 0.25, 9), '#b0643c', mat(0, 0.08, 0));
      p.add(new THREE.DodecahedronGeometry(0.5, 0), '#c0724a', mat(0.4, 0.25, 0.2, 0, 0, 0, 1, 0.5, 1));
      p.add(new THREE.DodecahedronGeometry(0.35, 0), '#a85c36', mat(-0.6, 0.2, -0.3, 0, 0, 0, 1, 0.5, 1));
    },
  },
  copper: {
    name: 'Veta de cobre',
    gives: 'Cobre',
    scale: [0.9, 1.3],
    ore: 0.45,
    biomes: { mountain: 1.2, desert: 0.5, steppe: 0.3, tundra: 0.3 },
    model: (p) => oreRock(p, '#c07038', '#3f8f7a'),
  },
  iron: {
    name: 'Veta de hierro',
    gives: 'Hierro',
    scale: [0.9, 1.3],
    ore: 0.5,
    biomes: { mountain: 1, tundra: 0.5, taiga: 0.3, snow: 0.4 },
    model: (p) => oreRock(p, '#8a4a36', '#5a3a30'),
  },
  gold: {
    name: 'Veta de oro',
    gives: 'Oro',
    scale: [0.9, 1.2],
    ore: 0.62,
    biomes: { mountain: 0.5, desert: 0.2, jungle: 0.1 },
    model: (p) => oreRock(p, '#e8c040', '#fff0a0'),
  },
  salt: {
    name: 'Salinas',
    gives: 'Sal',
    scale: [0.8, 1.3],
    ore: 0.35,
    biomes: { desert: 0.8, beach: 0.3, steppe: 0.3 },
    model: (p) => {
      p.add(new THREE.CylinderGeometry(2, 2.2, 0.12, 10), '#ece7dc', mat(0, 0.04, 0));
      for (const [x, z] of [[0.5, 0.3], [-0.6, -0.2], [0.1, -0.7]]) {
        p.add(new THREE.OctahedronGeometry(0.3, 0), '#ffffff', mat(x, 0.2, z, 0, x, 0));
      }
    },
  },
};

function oreRock(p, vein, glint) {
  p.add(new THREE.DodecahedronGeometry(1.3, 0), '#77726a', mat(0, 0.6, 0, 0.3, 0.4, 0, 1.3, 0.9, 1.1));
  p.add(new THREE.DodecahedronGeometry(0.8, 0), '#6b665e', mat(1.2, 0.4, 0.5, 0.5, 0.1, 0));
  for (const [x, y, z, r] of [[0.5, 1.1, 0.6, 0.35], [-0.6, 0.9, 0.5, 0.3], [0.2, 1.3, -0.4, 0.28], [1.3, 0.7, 0.9, 0.22]]) {
    p.add(new THREE.OctahedronGeometry(r, 0), vein, mat(x, y, z, x, y, 0));
  }
  p.add(new THREE.OctahedronGeometry(0.14, 0), glint, mat(-0.2, 1.4, 0.7));
}

const TYPES = Object.entries(RESOURCES).map(([id, r]) => ({ id, ...r }));

// ---------------------------------------------------------------------------
// Generación por baldosas
// ---------------------------------------------------------------------------

// Número entero de ejemplares a partir de una cantidad media, al azar.
function poisson(mean, rand) {
  let n = Math.floor(mean);
  if (rand() < mean - n) n++;
  return n;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmp = {
  dir: new THREE.Vector3(),
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  spin: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};

// Recursos de una baldosa (fila i, columna j). Devuelve [{ type, matrix }].
function generateTile(i, j, cols) {
  const rand = seededRandom((i * 73856093) ^ (j * 19349663) ^ SEED);
  const lat = (i + 0.5) * TILE_ANGLE;
  const lon = ((j + 0.5) / cols) * Math.PI * 2;
  const center = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - lat, lon);
  const biome = biomeAt(center.x, center.y, center.z).id;
  const items = [];
  if (biome === 'ocean' || biome === 'ice') return items;

  const cx = center.x * 3000;
  const cy = center.y * 3000;
  const cz = center.z * 3000;
  const forest = 0.35 + 0.65 * Math.max(0, forestNoise(cx, cy, cz) + 0.35); // grupos de ~1 km
  const orePresence = oreNoise(center.x * 900, center.y * 900, center.z * 900); // vetas raras

  for (const type of TYPES) {
    let mean = type.biomes[biome];
    if (!mean) continue;
    if (type.clustered) mean *= forest;
    if (type.ore !== undefined) {
      if (orePresence < type.ore) continue;
      mean *= 1.5;
    }
    const count = poisson(mean, rand);
    for (let n = 0; n < count; n++) {
      const pLat = (i + rand()) * TILE_ANGLE;
      const pLon = ((j + rand()) / cols) * Math.PI * 2;
      const dir = tmp.dir.setFromSphericalCoords(1, Math.PI / 2 - pLat, pLon);
      // El bioma exacto del punto: en los bordes entre biomas no se mezclan cosas raras.
      if (biomeAt(dir.x, dir.y, dir.z).id !== biome) continue;
      const height = surfaceHeight(dir);
      if (height <= 0.5) continue; // agua
      tmp.pos.copy(dir).multiplyScalar(RADIUS + height - 0.25);
      tmp.quat.setFromUnitVectors(Y_AXIS, dir);
      tmp.spin.setFromAxisAngle(Y_AXIS, rand() * Math.PI * 2);
      tmp.quat.multiply(tmp.spin);
      const [s0, s1] = type.scale;
      tmp.scale.setScalar(s0 + rand() * (s1 - s0));
      items.push({
        type: type.id,
        dir: dir.clone(),
        position: tmp.pos.clone(),
        quaternion: tmp.quat.clone(),
        scale: tmp.scale.x,
        tint: 0.85 + rand() * 0.3,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Sistema: decide qué baldosas se ven y rellena los InstancedMesh
// ---------------------------------------------------------------------------

export class ResourceSystem {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'resources';
    scene.add(this.group);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.meshes = {};
    for (const type of TYPES) {
      const mesh = new THREE.InstancedMesh(partsGeometry(type.model), this.material, MAX_INSTANCES);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1)); // crea el atributo de color por ejemplar
      mesh.name = type.id;
      this.meshes[type.id] = mesh;
      this.group.add(mesh);
    }
    this.cache = new Map(); // baldosa -> recursos
    this.lastCenter = new THREE.Vector3(Infinity, 0, 0);
    this.lastRadius = 0;
    this.needsRefresh = false;
    this.zonesSignature = '';
    this.origin = new THREE.Vector3();
    this.matrix = new THREE.Matrix4();
    this.color = new THREE.Color();
    this.local = new THREE.Vector3();
  }

  // Radio (en metros) alrededor del punto que se mira donde se dibujan recursos.
  radiusFor(clearance) {
    return THREE.MathUtils.clamp(clearance * 7, 700, 2_800);
  }

  update(camera, focusDir, clearance) {
    const visible = clearance < MAX_VISIBLE_CLEARANCE;
    this.group.visible = visible;
    if (!visible) return;

    // Si cambia el campamento, las baldosas de alrededor se recalculan.
    const signature = terrainZones()
      .map((z) => `${z.dir.x.toFixed(6)},${z.dir.y.toFixed(6)}`)
      .join('|');
    if (signature !== this.zonesSignature) {
      this.zonesSignature = signature;
      this.cache.clear();
      this.needsRefresh = true;
    }

    const radius = this.radiusFor(clearance);
    const moved = this.lastCenter.angleTo(focusDir) * RADIUS;
    if (moved > radius * 0.15 || Math.abs(radius - this.lastRadius) > this.lastRadius * 0.25) {
      this.lastCenter.copy(focusDir);
      this.lastRadius = radius;
      this.needsRefresh = true;
    }
    if (this.needsRefresh) this.refresh(focusDir, radius);
  }

  // Rellena los InstancedMesh con las baldosas dentro del radio. Genera baldosas nuevas
  // con un tope de tiempo por fotograma; si faltan, lo sigue en el siguiente.
  refresh(center, radius) {
    const start = performance.now();
    const lat0 = Math.asin(THREE.MathUtils.clamp(center.y, -1, 1));
    const lon0 = Math.atan2(center.x, center.z);
    const span = radius / RADIUS;
    const i0 = Math.floor((lat0 - span) / TILE_ANGLE);
    const i1 = Math.floor((lat0 + span) / TILE_ANGLE);
    const tiles = [];
    let complete = true;

    for (let i = i0; i <= i1; i++) {
      const lat = (i + 0.5) * TILE_ANGLE;
      if (Math.abs(lat) > Math.PI / 2) continue;
      const cols = Math.max(1, Math.floor((Math.PI * 2 * Math.cos(lat)) / TILE_ANGLE));
      const colAngle = (Math.PI * 2) / cols;
      const lonSpan = span / Math.max(0.01, Math.cos(lat));
      const lonNorm = lon0 < 0 ? lon0 + Math.PI * 2 : lon0;
      const j0 = Math.floor((lonNorm - lonSpan) / colAngle);
      const j1 = Math.floor((lonNorm + lonSpan) / colAngle);
      for (let j = j0; j <= j1 && j < j0 + cols; j++) {
        const jw = ((j % cols) + cols) % cols;
        const key = `${i}:${jw}`;
        let items = this.cache.get(key);
        if (!items) {
          if (performance.now() - start > BUILD_BUDGET_MS) {
            complete = false;
            continue;
          }
          items = generateTile(i, jw, cols);
          this.cache.set(key, items);
        }
        tiles.push(items);
      }
    }
    if (this.cache.size > 20_000) this.cache.clear();

    // Posiciones relativas a un origen cercano: así caben en float32 sin temblar.
    this.origin.copy(center).multiplyScalar(RADIUS);
    this.group.position.copy(this.origin);
    const counts = {};
    for (const id in this.meshes) counts[id] = 0;
    const zones = terrainZones();
    for (const items of tiles) {
      for (const item of items) {
        if (item.dir.angleTo(center) * RADIUS > radius) continue;
        let blocked = false;
        for (const zone of zones) {
          if (zoneDistance(zone, item.dir.x, item.dir.y, item.dir.z) < CAMP_CLEAR_RADIUS) blocked = true;
        }
        if (blocked) continue;
        const mesh = this.meshes[item.type];
        const n = counts[item.type];
        if (n >= MAX_INSTANCES) continue;
        this.local.copy(item.position).sub(this.origin);
        this.matrix.compose(this.local, item.quaternion, tmp.scale.setScalar(item.scale));
        mesh.setMatrixAt(n, this.matrix);
        mesh.setColorAt(n, this.color.setScalar(item.tint));
        counts[item.type] = n + 1;
      }
    }
    for (const id in this.meshes) {
      const mesh = this.meshes[id];
      mesh.count = counts[id];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.needsRefresh = !complete;
  }
}
