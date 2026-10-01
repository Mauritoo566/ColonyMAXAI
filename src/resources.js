import * as THREE from 'three';
import { RADIUS, terrainZones, zoneDistance } from './elevation.js';
import { partsGeometry, mat, stick, v } from './modelKit.js';
import { RESOURCE_TYPES, TILE } from './resourceTypes.js';
import { TILE_ANGLE, generateTile } from './resourceGen.js';

// Recursos naturales: aparecen solos por todo el planeta, al azar pero siempre en el
// mismo lugar (cada baldosa de 320 m usa su propia semilla), según el bioma.
//
// Para poder dibujar muchísimos sin lag:
//  - Se generan en Web Workers (resourceWorker.js), no en el hilo del juego.
//  - Cada tipo se dibuja con dos InstancedMesh: modelo completo cerca y versión
//    simple lejos. Una llamada de dibujo por malla, haya cien o decenas de miles.
//  - Cada ejemplar trae su rotación y escala ya calculadas: al moverse la cámara sólo
//    se copian números al búfer de la tarjeta gráfica.
//  - A lo lejos se dibuja sólo una parte (la bruma lo disimula).

export { RESOURCE_TYPES };

const MAX_NEAR = 30_000; // ejemplares con el modelo completo, por tipo
const MAX_FAR = 60_000; // ejemplares con el modelo simple, por tipo
const LOD_DISTANCE = 380; // metros: más lejos, modelo simple
const FULL_DENSITY_DISTANCE = 900; // hasta aquí se ve todo; más lejos se aclara
const MAX_VISIBLE_CLEARANCE = 6_000; // más alto no se dibujan
const CAMP_CLEAR_RADIUS = 45; // alrededor del campamento no aparece nada
const MAX_PENDING = 24; // baldosas encargadas a la vez
const REBUILD_INTERVAL = 0.12; // segundos mínimos entre dos reconstrucciones

function oreRock(p, vein, glint) {
  p.add(new THREE.DodecahedronGeometry(1.3, 0), '#77726a', mat(0, 0.6, 0, 0.3, 0.4, 0, 1.3, 0.9, 1.1));
  p.add(new THREE.DodecahedronGeometry(0.8, 0), '#6b665e', mat(1.2, 0.4, 0.5, 0.5, 0.1, 0));
  for (const [x, y, z, r] of [[0.5, 1.1, 0.6, 0.35], [-0.6, 0.9, 0.5, 0.3], [0.2, 1.3, -0.4, 0.28], [1.3, 0.7, 0.9, 0.22]]) {
    p.add(new THREE.OctahedronGeometry(r, 0), vein, mat(x, y, z, x, y, 0));
  }
  p.add(new THREE.OctahedronGeometry(0.14, 0), glint, mat(-0.2, 1.4, 0.7));
}


// Modelos completos (cerca).
const MODELS = {
  broadleaf: (p) => {
      stick(p, v(0, -0.5, 0), v(0, 4, 0), 0.35, '#5e4128', 6);
      for (const [x, y, z, r, c] of [
        [0, 5.2, 0, 2.5, '#4f8a3a'],
        [1.1, 4.6, 0.6, 1.8, '#5c9a42'],
        [-1, 4.8, -0.5, 1.9, '#447d36'],
      ]) {
        p.add(new THREE.IcosahedronGeometry(r, 0), c, mat(x, y, z, 0.3, 0.5, 0));
      }
    },
  pine: (p) => {
      stick(p, v(0, -0.5, 0), v(0, 2.6, 0), 0.3, '#5a3b24', 5);
      for (const [r, h, y, c] of [
        [2.8, 4.2, 3.4, '#2f5a34'],
        [2.1, 3.6, 5.6, '#34633a'],
        [1.4, 3.0, 7.7, '#3a6b40'],
      ]) {
        p.add(new THREE.ConeGeometry(r, h, 7), c, mat(0, y, 0));
      }
    },
  jungleTree: (p) => {
      stick(p, v(0, -0.5, 0), v(0.3, 8, 0), 0.4, '#6a4c30', 6);
      p.add(new THREE.IcosahedronGeometry(3.2, 0), '#2e7a2c', mat(0.3, 9.3, 0, 0.2, 0.4, 0, 1, 0.6, 1));
      p.add(new THREE.IcosahedronGeometry(2.2, 0), '#3a8f34', mat(-1.2, 8.2, 1, 0.5, 0.1, 0, 1, 0.7, 1));
      p.add(new THREE.IcosahedronGeometry(0.35, 0), '#e0a030', mat(1.2, 7.8, 0.8));
    },
  acacia: (p) => {
      stick(p, v(0, -0.5, 0), v(0.4, 3.2, 0), 0.25, '#6e5236', 5);
      stick(p, v(0.4, 3.2, 0), v(1.6, 4.4, 0.4), 0.16, '#6e5236', 4);
      stick(p, v(0.4, 3.2, 0), v(-1, 4.3, -0.3), 0.16, '#6e5236', 4);
      p.add(new THREE.CylinderGeometry(3.3, 2.6, 0.9, 8), '#6f8a3a', mat(0.3, 4.7, 0));
    },
  palm: (p) => {
      stick(p, v(0, -0.5, 0), v(0.6, 3, 0), 0.22, '#8a6a44', 5);
      stick(p, v(0.6, 3, 0), v(1.1, 6.2, 0), 0.19, '#8a6a44', 5);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        p.add(new THREE.BoxGeometry(3, 0.08, 0.7), '#4f8f3a', mat(1.1 + Math.cos(a) * 1.3, 6, Math.sin(a) * 1.3, 0, -a, -0.4));
      }
      p.add(new THREE.IcosahedronGeometry(0.28, 0), '#6b4a2a', mat(1.1, 5.8, 0.2));
    },
  cactus: (p) => {
      p.add(new THREE.CylinderGeometry(0.35, 0.4, 3.4, 7), '#5e8a3a', mat(0, 1.6, 0));
      p.add(new THREE.CylinderGeometry(0.22, 0.25, 1.2, 6), '#5e8a3a', mat(0.6, 1.9, 0, 0, 0, Math.PI / 2));
      p.add(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 6), '#5e8a3a', mat(1.15, 2.4, 0));
      p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 6), '#5e8a3a', mat(-0.55, 1.4, 0, 0, 0, Math.PI / 2));
      p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.8, 6), '#5e8a3a', mat(-0.95, 1.8, 0));
    },
  berryBush: (p) => {
      p.add(new THREE.IcosahedronGeometry(1.1, 0), '#3f7a34', mat(0, 0.8, 0, 0, 0, 0, 1.2, 0.8, 1.1));
      p.add(new THREE.IcosahedronGeometry(0.8, 0), '#4a8a3c', mat(0.7, 0.7, 0.3, 0.4, 0, 0));
      for (const [x, y, z] of [[0.6, 1.3, 0.7], [-0.7, 1.1, 0.5], [0.2, 1.5, -0.6], [-0.3, 0.9, 0.9], [0.9, 0.9, -0.3]]) {
        p.add(new THREE.IcosahedronGeometry(0.17, 0), '#c0283a', mat(x, y, z));
      }
    },
  mushrooms: (p) => {
      for (const [x, z, s] of [[0, 0, 1], [0.5, 0.3, 0.7], [-0.4, 0.4, 0.6]]) {
        p.add(new THREE.CylinderGeometry(0.08 * s, 0.1 * s, 0.5 * s, 5), '#e8dcc0', mat(x, 0.25 * s, z));
        p.add(new THREE.ConeGeometry(0.35 * s, 0.3 * s, 7), '#b8402e', mat(x, 0.55 * s, z));
      }
    },
  reeds: (p) => {
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const r = 0.2 + (i % 3) * 0.25;
        p.add(new THREE.ConeGeometry(0.06, 2 + (i % 4) * 0.4, 3), '#7d8f45', mat(Math.cos(a) * r, 1, Math.sin(a) * r, 0.1 * Math.sin(i), 0, 0.1 * Math.cos(i)));
      }
      p.add(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 5), '#6a4a2a', mat(0.2, 2.3, 0.1));
    },
  stone: (p) => {
      p.add(new THREE.DodecahedronGeometry(1.1, 0), '#8b877f', mat(0, 0.45, 0, 0.3, 0.2, 0, 1.3, 0.8, 1));
      p.add(new THREE.DodecahedronGeometry(0.6, 0), '#7f7b73', mat(1.1, 0.3, 0.4, 0.8, 0.5, 0));
      p.add(new THREE.DodecahedronGeometry(0.4, 0), '#948f86', mat(-0.9, 0.2, 0.5, 0.1, 0.9, 0));
    },
  flint: (p) => {
      for (const [x, z, r] of [[0, 0, 0.35], [0.4, 0.2, 0.25], [-0.3, 0.3, 0.3]]) {
        p.add(new THREE.OctahedronGeometry(r, 0), '#3b3a3c', mat(x, r * 0.5, z, 0.4, x * 3, 0.2));
      }
    },
  sticks: (p) => {
      // Unos palos y ramas tirados en el suelo, cruzados, con alguna hoja seca.
      for (const [x, z, len, a] of [[0, 0, 1.7, 0.2], [0.25, 0.3, 1.4, 1.2], [-0.2, 0.15, 1.2, 2.4], [0.1, -0.3, 1.5, 0.8]]) {
        stick(p, v(x - Math.cos(a) * len / 2, 0.1 + (x > 0 ? 0.1 : 0), z - Math.sin(a) * len / 2), v(x + Math.cos(a) * len / 2, 0.12, z + Math.sin(a) * len / 2), 0.07, '#7a5a38', 4);
      }
      p.add(new THREE.OctahedronGeometry(0.16, 0), '#a8782e', mat(0.3, 0.2, 0.1, 0.3, 0.4, 0));
    },
  clay: (p) => {
      p.add(new THREE.CylinderGeometry(1.6, 1.8, 0.25, 9), '#b0643c', mat(0, 0.08, 0));
      p.add(new THREE.DodecahedronGeometry(0.5, 0), '#c0724a', mat(0.4, 0.25, 0.2, 0, 0, 0, 1, 0.5, 1));
      p.add(new THREE.DodecahedronGeometry(0.35, 0), '#a85c36', mat(-0.6, 0.2, -0.3, 0, 0, 0, 1, 0.5, 1));
    },
  copper: (p) => oreRock(p, '#c07038', '#3f8f7a'),
  iron: (p) => oreRock(p, '#8a4a36', '#5a3a30'),
  gold: (p) => oreRock(p, '#e8c040', '#fff0a0'),
  salt: (p) => {
      p.add(new THREE.CylinderGeometry(2, 2.2, 0.12, 10), '#ece7dc', mat(0, 0.04, 0));
      for (const [x, z] of [[0.5, 0.3], [-0.6, -0.2], [0.1, -0.7]]) {
        p.add(new THREE.OctahedronGeometry(0.3, 0), '#ffffff', mat(x, 0.2, z, 0, x, 0));
      }
    },
};

// Modelos simples (lejos): pocas caras y los mismos colores generales.
const LOD_MODELS = {
  broadleaf: (p) => {
    p.add(new THREE.CylinderGeometry(0.3, 0.35, 4, 4), '#5e4128', mat(0, 1.8, 0));
    p.add(new THREE.OctahedronGeometry(2.8, 0), '#4f8a3a', mat(0, 5, 0, 0, 0.4, 0, 1, 0.9, 1));
  },
  pine: (p) => p.add(new THREE.ConeGeometry(2.6, 8.5, 5), '#30603a', mat(0, 4.7, 0)),
  jungleTree: (p) => {
    p.add(new THREE.CylinderGeometry(0.35, 0.4, 8, 4), '#6a4c30', mat(0, 4, 0));
    p.add(new THREE.OctahedronGeometry(3.2, 0), '#2e7a2c', mat(0, 9, 0, 0, 0.4, 0, 1, 0.6, 1));
  },
  acacia: (p) => {
    p.add(new THREE.CylinderGeometry(0.2, 0.25, 4, 4), '#6e5236', mat(0, 2, 0));
    p.add(new THREE.CylinderGeometry(3.2, 2.6, 0.9, 6), '#6f8a3a', mat(0, 4.6, 0));
  },
  palm: (p) => {
    p.add(new THREE.CylinderGeometry(0.18, 0.22, 6, 4), '#8a6a44', mat(0.5, 3, 0, 0, 0, -0.15));
    p.add(new THREE.ConeGeometry(2.4, 0.9, 6), '#4f8f3a', mat(1, 6, 0));
  },
  cactus: (p) => p.add(new THREE.CylinderGeometry(0.4, 0.45, 3.4, 5), '#5e8a3a', mat(0, 1.6, 0)),
  stone: (p) => p.add(new THREE.OctahedronGeometry(1.1, 0), '#8b877f', mat(0, 0.4, 0, 0.3, 0.2, 0, 1.3, 0.7, 1)),
  reeds: (p) => p.add(new THREE.ConeGeometry(0.6, 2.2, 4), '#7d8f45', mat(0, 1.1, 0)),
  berryBush: (p) => p.add(new THREE.OctahedronGeometry(1.1, 0), '#3f7a34', mat(0, 0.8, 0, 0, 0, 0, 1.1, 0.8, 1.1)),
  clay: (p) => p.add(new THREE.CylinderGeometry(1.6, 1.8, 0.25, 6), '#b0643c', mat(0, 0.08, 0)),
  sticks: (p) => p.add(new THREE.BoxGeometry(1.7, 0.12, 0.2), '#7a5a38', mat(0, 0.12, 0, 0, 0.3, 0)),
  salt: (p) => p.add(new THREE.CylinderGeometry(2, 2.2, 0.12, 6), '#ece7dc', mat(0, 0.04, 0)),
  copper: (p) => p.add(new THREE.OctahedronGeometry(1.3, 0), '#8a6a50', mat(0, 0.6, 0, 0.3, 0.4, 0, 1.3, 0.8, 1.1)),
  iron: (p) => p.add(new THREE.OctahedronGeometry(1.3, 0), '#7a5a4c', mat(0, 0.6, 0, 0.3, 0.4, 0, 1.3, 0.8, 1.1)),
  gold: (p) => p.add(new THREE.OctahedronGeometry(1.3, 0), '#9a8a5a', mat(0, 0.6, 0, 0.3, 0.4, 0, 1.3, 0.8, 1.1)),
};

// Información de cada tipo para la interfaz (nombre y qué da).
export const RESOURCES = Object.fromEntries(RESOURCE_TYPES.map((t) => [t.id, t]));

function createInstanced(geometry, material, max, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.name = name;
  return mesh;
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

class ResourceWorkers {
  constructor(onTile) {
    this.onTile = onTile;
    this.workers = [];
    this.next = 0;
    const count = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 4) - 2));
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL('./resourceWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this.onTile(e.data.key, e.data);
        w.onerror = () => this.fail();
        this.workers.push(w);
      }
    } catch {
      this.fail();
    }
  }

  get available() {
    return this.workers.length > 0;
  }

  request(key, i, j, cols) {
    const w = this.workers[this.next++ % this.workers.length];
    w.postMessage({ key, i, j, cols });
  }

  fail() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}

// ---------------------------------------------------------------------------
// Sistema
// ---------------------------------------------------------------------------

export class ResourceSystem {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'resources';
    scene.add(this.group);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.near = [];
    this.far = [];
    for (const type of RESOURCE_TYPES) {
      const near = createInstanced(partsGeometry(MODELS[type.id]), this.material, MAX_NEAR, type.id);
      const lod = LOD_MODELS[type.id];
      const far = lod ? createInstanced(partsGeometry(lod), this.material, MAX_FAR, type.id + '-lejos') : null;
      this.group.add(near);
      if (far) this.group.add(far);
      this.near.push(near);
      this.far.push(far);
    }
    this.cache = new Map(); // clave -> datos de la baldosa, o 'pending'
    this.pending = 0;
    this.dirty = true;
    this.sinceRebuild = 0;
    this.lastCamera = new THREE.Vector3(Infinity, 0, 0);
    this.origin = new THREE.Vector3();
    this.zonesSignature = '';
    this.removed = new Map(); // baldosa -> índices de recursos que ya no están
    this.extra = new Map(); // baldosas especiales (arboleda del campamento)
    this.workers = new ResourceWorkers((key, data) => {
      if (this.cache.get(key) === 'pending') {
        data.key = key;
        this.cache.set(key, data);
        this.pending--;
        this.dirty = true;
      }
    });
  }

  // Radio alrededor del punto que se mira donde se dibujan recursos.
  radiusFor(clearance) {
    return THREE.MathUtils.clamp(clearance * 7, 900, 2_600);
  }

  update(camera, focusDir, clearance, delta = 0.016) {
    const visible = clearance < MAX_VISIBLE_CLEARANCE;
    this.group.visible = visible;
    if (!visible) return;
    this.sinceRebuild += delta;

    const signature = terrainZones()
      .map((z) => `${z.dir.x.toFixed(6)},${z.dir.y.toFixed(6)}`)
      .join('|');
    if (signature !== this.zonesSignature) {
      this.zonesSignature = signature;
      this.dirty = true;
    }

    const radius = this.radiusFor(clearance);
    const tiles = this.collectTiles(focusDir, radius);
    for (const extra of this.extra.values()) tiles.push(extra);

    // Reconstruir si la cámara se movió lo suficiente o llegaron baldosas nuevas.
    const moved = this.lastCamera.distanceTo(camera.position);
    if (moved > Math.max(15, clearance * 0.06)) this.dirty = true;
    if (this.dirty && this.sinceRebuild >= REBUILD_INTERVAL) {
      this.rebuild(tiles, camera.position, focusDir, radius);
      this.lastCamera.copy(camera.position);
      this.sinceRebuild = 0;
      this.dirty = false;
    }
  }

  // Baldosas dentro del radio (ya generadas); encarga las que faltan.
  collectTiles(center, radius) {
    const lat0 = Math.asin(THREE.MathUtils.clamp(center.y, -1, 1));
    const lon0 = Math.atan2(center.x, center.z);
    const lonNorm = lon0 < 0 ? lon0 + Math.PI * 2 : lon0;
    const span = radius / RADIUS;
    const i0 = Math.floor((lat0 - span) / TILE_ANGLE);
    const i1 = Math.floor((lat0 + span) / TILE_ANGLE);
    const ready = [];
    const missing = [];
    for (let i = i0; i <= i1; i++) {
      const lat = (i + 0.5) * TILE_ANGLE;
      if (Math.abs(lat) > Math.PI / 2) continue;
      const cols = Math.max(1, Math.floor((Math.PI * 2 * Math.cos(lat)) / TILE_ANGLE));
      const colAngle = (Math.PI * 2) / cols;
      const lonSpan = span / Math.max(0.01, Math.cos(lat));
      const j0 = Math.floor((lonNorm - lonSpan) / colAngle);
      const j1 = Math.floor((lonNorm + lonSpan) / colAngle);
      for (let j = j0; j <= j1 && j < j0 + cols; j++) {
        const jw = ((j % cols) + cols) % cols;
        const key = i * 1_000_000 + jw;
        const data = this.cache.get(key);
        if (data && data !== 'pending') ready.push(data);
        else if (!data) {
          // Más cerca del centro, antes.
          const dLat = lat - lat0;
          const dLon = (((j + 0.5) * colAngle - lonNorm) * Math.cos(lat));
          missing.push({ key, i, jw, cols, d: dLat * dLat + dLon * dLon });
        }
      }
    }
    missing.sort((a, b) => a.d - b.d);
    for (const m of missing) {
      if (this.workers.available) {
        if (this.pending >= MAX_PENDING) break;
        this.cache.set(m.key, 'pending');
        this.pending++;
        this.workers.request(m.key, m.i, m.jw, m.cols);
      } else {
        // Sin workers: una baldosa por fotograma en el hilo principal.
        const data = generateTile(m.i, m.jw, m.cols);
        data.key = m.key;
        this.cache.set(m.key, data);
        this.dirty = true;
        break;
      }
    }
    if (this.cache.size > 6_000) this.trimCache(ready);
    return ready;
  }

  trimCache(keep) {
    const keepSet = new Set(keep);
    for (const [key, data] of this.cache) {
      if (data !== 'pending' && !keepSet.has(data)) this.cache.delete(key);
    }
  }

  // Añade o quita una baldosa especial (por ejemplo, la arboleda del campamento).
  setExtraTile(key, data) {
    if (data) {
      data.key = key;
      this.extra.set(key, data);
    } else {
      this.extra.delete(key);
    }
    this.dirty = true;
  }

  // Estado para guardar: qué recursos ya no están.
  serializeRemoved() {
    return [...this.removed].map(([key, set]) => [key, [...set]]);
  }

  restoreRemoved(list) {
    this.removed = new Map((list || []).map(([key, idx]) => [key, new Set(idx)]));
    this.dirty = true;
  }

  // Quita un recurso del mundo (un árbol talado, una piedra picada).
  removeResource(tileKey, index) {
    let set = this.removed.get(tileKey);
    if (!set) this.removed.set(tileKey, (set = new Set()));
    set.add(index);
    this.dirty = true;
  }

  // Copia los ejemplares visibles a los InstancedMesh.
  rebuild(tiles, cameraPos, center, radius) {
    // Posiciones relativas a un origen cercano: así caben en float32 sin temblar.
    this.origin.copy(center).multiplyScalar(RADIUS);
    this.group.position.copy(this.origin);
    const ox = this.origin.x, oy = this.origin.y, oz = this.origin.z;
    const cx = cameraPos.x, cy = cameraPos.y, cz = cameraPos.z;
    const radius2 = radius * radius;
    const lod2 = LOD_DISTANCE * LOD_DISTANCE;
    // Cada zona despeja recursos a su alrededor (el campamento 90 m, un edificio poco).
    const zones = terrainZones().map((z) => {
      const r = RADIUS + (z.height || 0);
      const clear = z.resourceClear ?? CAMP_CLEAR_RADIUS;
      return [z.dir.x * r, z.dir.y * r, z.dir.z * r, clear * clear];
    });
    const removed = this.removed;
    const maxDist2 = RESOURCE_TYPES.map((t) => (t.maxDistance ?? Infinity) ** 2);

    const nearCount = new Int32Array(RESOURCE_TYPES.length);
    const farCount = new Int32Array(RESOURCE_TYPES.length);
    const nearM = this.near.map((m) => m.instanceMatrix.array);
    const nearC = this.near.map((m) => m.instanceColor.array);
    const farM = this.far.map((m) => (m ? m.instanceMatrix.array : null));
    const farC = this.far.map((m) => (m ? m.instanceColor.array : null));

    for (const t of tiles) {
      const { count, type, pos, basis, tint, rank } = t;
      const gone = removed.get(t.key);
      for (let k = 0; k < count; k++) {
        if (gone && gone.has(k)) continue; // talado o agotado
        const px = pos[k * 3], py = pos[k * 3 + 1], pz = pos[k * 3 + 2];
        // Distancia al punto que se mira, a la misma altura que el recurso.
        const plen = Math.sqrt(px * px + py * py + pz * pz);
        const fdx = px - center.x * plen, fdy = py - center.y * plen, fdz = pz - center.z * plen;
        if (fdx * fdx + fdy * fdy + fdz * fdz > radius2) continue;
        const dx = px - cx, dy = py - cy, dz = pz - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const ti = type[k];
        if (d2 > maxDist2[ti]) continue;
        // A lo lejos se aclara: sólo quedan los de "rank" bajo.
        if (d2 > FULL_DENSITY_DISTANCE * FULL_DENSITY_DISTANCE) {
          const keep = (FULL_DENSITY_DISTANCE * FULL_DENSITY_DISTANCE) / d2;
          if (rank[k] > keep) continue;
        }
        let blocked = false;
        for (const z of zones) {
          const zx = px - z[0], zy = py - z[1], zz = pz - z[2];
          if (zx * zx + zy * zy + zz * zz < z[3]) blocked = true;
        }
        if (blocked) continue;

        let arr, col, n;
        if (d2 > lod2 && farM[ti]) {
          n = farCount[ti];
          if (n >= MAX_FAR) continue;
          farCount[ti] = n + 1;
          arr = farM[ti];
          col = farC[ti];
        } else {
          n = nearCount[ti];
          if (n >= MAX_NEAR) continue;
          nearCount[ti] = n + 1;
          arr = nearM[ti];
          col = nearC[ti];
        }
        const o = n * 16, b = k * 9;
        arr[o] = basis[b]; arr[o + 1] = basis[b + 1]; arr[o + 2] = basis[b + 2]; arr[o + 3] = 0;
        arr[o + 4] = basis[b + 3]; arr[o + 5] = basis[b + 4]; arr[o + 6] = basis[b + 5]; arr[o + 7] = 0;
        arr[o + 8] = basis[b + 6]; arr[o + 9] = basis[b + 7]; arr[o + 10] = basis[b + 8]; arr[o + 11] = 0;
        arr[o + 12] = px - ox; arr[o + 13] = py - oy; arr[o + 14] = pz - oz; arr[o + 15] = 1;
        const c = tint[k];
        col[n * 3] = c; col[n * 3 + 1] = c; col[n * 3 + 2] = c;
      }
    }

    const apply = (mesh, count) => {
      if (!mesh) return;
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, count) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, Math.max(1, count) * 3);
      mesh.instanceColor.needsUpdate = true;
    };
    for (let ti = 0; ti < RESOURCE_TYPES.length; ti++) {
      apply(this.near[ti], nearCount[ti]);
      apply(this.far[ti], farCount[ti]);
    }
    this.lastCounts = { near: nearCount.reduce((a, b) => a + b, 0), far: farCount.reduce((a, b) => a + b, 0) };
  }
}
