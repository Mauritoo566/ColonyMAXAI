import * as THREE from 'three';
import { RADIUS, MAX_LAND_HEIGHT, elevation, heightFromElevation, moisture } from './elevation.js';
import { createTerrainMaterial, setChunkWaveOffset, WAVE_TILE } from './water.js';

// Terreno con nivel de detalle (LOD): la esfera se forma con las 6 caras de un cubo
// y cada cara es un quadtree. Los trozos cercanos a la cámara se dividen en 4 hijos
// más detallados; los lejanos se quedan con pocos polígonos.

const RESOLUTION = 24; // celdas por lado en cada trozo
const MAX_LEVEL = 15; // en el nivel 15 cada celda mide ~25 m
const SPLIT_THRESHOLD = 0.3; // tamaño del trozo / distancia a la cámara
const MERGE_THRESHOLD = SPLIT_THRESHOLD * 0.8; // histéresis para evitar parpadeos
const BUILD_BUDGET_MS = 8;

const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

const COLORS = {
  sand: new THREE.Color('#d8c68f'),
  grass: new THREE.Color('#4f8f3a'),
  forest: new THREE.Color('#2f6b2c'),
  desert: new THREE.Color('#c9a15e'),
  rock: new THREE.Color('#7a6a58'),
  snow: new THREE.Color('#f2f5f7'),
  oceanDeep: new THREE.Color('#123f75'),
  oceanShallow: new THREE.Color('#2f7fbf'),
  ice: new THREE.Color('#e8f2f8'),
};

// Punto del cubo [-1,1]^3 -> dirección unitaria. Esta fórmula reparte las celdas
// de forma más uniforme que normalizar directamente.
function cubeToSphere(x, y, z, out) {
  const x2 = x * x;
  const y2 = y * y;
  const z2 = z * z;
  out[0] = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
  out[1] = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
  out[2] = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
  return out;
}

function faceDirection(face, a, b, out) {
  const { n, u, v } = face;
  return cubeToSphere(
    n[0] + u[0] * a + v[0] * b,
    n[1] + u[1] * a + v[1] * b,
    n[2] + u[2] * a + v[2] * b,
    out,
  );
}

// Número pseudoaleatorio estable a partir de una posición: la misma cara
// siempre tiene el mismo tono aunque se regenere.
function hash3(x, y, z) {
  const s = Math.sin(x * 12989.8 + y * 78233.1 + z * 37719.7) * 43758.5453;
  return s - Math.floor(s);
}

function faceColor(e, dir, slope, out) {
  const lat = Math.abs(dir[1]);
  if (e <= 0) {
    if (lat > 0.93) return out.copy(COLORS.ice);
    const depth = THREE.MathUtils.clamp(-e * 3, 0, 1);
    return out.copy(COLORS.oceanShallow).lerp(COLORS.oceanDeep, depth);
  }
  if (lat > 0.9 || e > 0.62) return out.copy(COLORS.snow);
  if (slope > 0.3 || e > 0.45) return out.copy(COLORS.rock);
  if (e < 0.02) return out.copy(COLORS.sand);
  const m = moisture(dir[0], dir[1], dir[2]);
  if (m < -0.12 && lat < 0.55) return out.copy(COLORS.desert);
  return out.copy(m > 0.08 ? COLORS.forest : COLORS.grass);
}

const tmpDir = [0, 0, 0];
// Origen de las olas del agua: la cámara redondeada a múltiplos de WAVE_TILE.
const waveOrigin = new THREE.Vector3();
const tmpColor = new THREE.Color();

class Node {
  constructor(face, level, a, b, size) {
    this.face = face;
    this.level = level;
    this.a = a;
    this.b = b;
    this.size = size;
    this.children = null;
    this.mesh = null;
    this.queued = false;
    this.disposed = false;

    faceDirection(face, a + size / 2, b + size / 2, tmpDir);
    const h = heightFromElevation(elevation(tmpDir[0], tmpDir[1], tmpDir[2], 8));
    this.center = new THREE.Vector3(tmpDir[0], tmpDir[1], tmpDir[2]).multiplyScalar(RADIUS + h);
    // Longitud aproximada del lado del trozo en metros (una cara del cubo mide ~R·π/2).
    this.worldSize = (size * RADIUS * Math.PI) / 4;
  }

  split() {
    const half = this.size / 2;
    const l = this.level + 1;
    this.children = [
      new Node(this.face, l, this.a, this.b, half),
      new Node(this.face, l, this.a + half, this.b, half),
      new Node(this.face, l, this.a, this.b + half, half),
      new Node(this.face, l, this.a + half, this.b + half, half),
    ];
  }

  hideAll() {
    if (this.mesh) this.mesh.visible = false;
    if (this.children) for (const c of this.children) c.hideAll();
  }

  dispose() {
    this.disposed = true;
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.children) for (const c of this.children) c.dispose();
    this.children = null;
  }

  build(material) {
    const res = RESOLUTION;
    const n = res + 1;
    const octaves = Math.min(22, this.level + 8);
    const pos = new Float64Array(n * n * 3);
    const dirs = new Float64Array(n * n * 3);
    const elev = new Float64Array(n * n);

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        faceDirection(this.face, this.a + (this.size * i) / res, this.b + (this.size * j) / res, tmpDir);
        const e = elevation(tmpDir[0], tmpDir[1], tmpDir[2], octaves);
        const r = RADIUS + heightFromElevation(e);
        dirs[k * 3] = tmpDir[0];
        dirs[k * 3 + 1] = tmpDir[1];
        dirs[k * 3 + 2] = tmpDir[2];
        pos[k * 3] = tmpDir[0] * r;
        pos[k * 3 + 1] = tmpDir[1] * r;
        pos[k * 3 + 2] = tmpDir[2] * r;
        elev[k] = e;
      }
    }

    const triCount = res * res * 2 + res * 4 * 4;
    const positions = new Float32Array(triCount * 9);
    const colors = new Float32Array(triCount * 9);
    const water = new Float32Array(triCount * 3);
    const cx = this.center.x;
    const cy = this.center.y;
    const cz = this.center.z;
    let t = 0;

    const writeVertex = (x, y, z, w = -1) => {
      // Posiciones relativas al centro del trozo: así caben en float32 sin perder precisión.
      positions[t * 3] = x - cx;
      positions[t * 3 + 1] = y - cy;
      positions[t * 3 + 2] = z - cz;
      tmpColor.toArray(colors, t * 3);
      water[t] = w;
      t++;
    };

    const emitTriangle = (i0, i1, i2) => {
      let j1 = i1;
      let j2 = i2;
      const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
      let bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
      let qx = pos[i2 * 3], qy = pos[i2 * 3 + 1], qz = pos[i2 * 3 + 2];

      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = qx - ax, vy = qy - ay, vz = qz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      tmpDir[0] = (dirs[i0 * 3] + dirs[i1 * 3] + dirs[i2 * 3]) / 3;
      tmpDir[1] = (dirs[i0 * 3 + 1] + dirs[i1 * 3 + 1] + dirs[i2 * 3 + 1]) / 3;
      tmpDir[2] = (dirs[i0 * 3 + 2] + dirs[i1 * 3 + 2] + dirs[i2 * 3 + 2]) / 3;
      let up = nx * tmpDir[0] + ny * tmpDir[1] + nz * tmpDir[2];
      if (up < 0) {
        // Asegura que la cara mire hacia fuera del planeta.
        [bx, qx] = [qx, bx];
        [by, qy] = [qy, by];
        [bz, qz] = [qz, bz];
        [j1, j2] = [j2, j1];
        up = -up;
      }

      const e = (elev[i0] + elev[i1] + elev[i2]) / 3;
      let colorE = e;
      if (e <= 0) {
        // El tono del agua depende de la profundidad. Se calcula siempre con el mismo
        // detalle (6 octavas) para que trozos vecinos de distinto nivel coincidan.
        const l = Math.hypot(tmpDir[0], tmpDir[1], tmpDir[2]);
        colorE = Math.min(-1e-9, elevation(tmpDir[0] / l, tmpDir[1] / l, tmpDir[2] / l, 6));
      }
      faceColor(colorE, tmpDir, 1 - up, tmpColor);
      const k = 1 + (hash3(tmpDir[0], tmpDir[1], tmpDir[2]) - 0.5) * 0.12;
      tmpColor.r *= k;
      tmpColor.g *= k;
      tmpColor.b *= k;

      // Agua: 0 en los vértices que tocan tierra (espuma), 1 en agua abierta.
      const isWater = e <= 0 && Math.abs(tmpDir[1]) <= 0.93;
      const w = (k) => (isWater ? (elev[k] > 0 ? 0 : 1) : -1);
      writeVertex(ax, ay, az, w(i0));
      writeVertex(bx, by, bz, w(j1));
      writeVertex(qx, qy, qz, w(j2));
    };

    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k00 = j * n + i;
        const k10 = k00 + 1;
        const k01 = k00 + n;
        const k11 = k01 + 1;
        // Alternar la diagonal da un patrón de triángulos más orgánico.
        if ((i + j) % 2 === 0) {
          emitTriangle(k00, k10, k11);
          emitTriangle(k00, k11, k01);
        } else {
          emitTriangle(k00, k10, k01);
          emitTriangle(k10, k11, k01);
        }
      }
    }

    // "Faldones": una tira de caras que baja desde el borde del trozo y tapa las
    // grietas que aparecen entre trozos vecinos con distinto nivel de detalle.
    const skirtDepth = Math.max(40, this.worldSize * 0.03);
    const skirtVertexDirs = [];
    const edges = [
      (s) => s, // abajo
      (s) => res * n + s, // arriba
      (s) => s * n, // izquierda
      (s) => s * n + res, // derecha
    ];
    for (const edge of edges) {
      for (let s = 0; s < res; s++) {
        const i0 = edge(s);
        const i1 = edge(s + 1);
        const e = (elev[i0] + elev[i1]) / 2;
        tmpDir[0] = dirs[i0 * 3];
        tmpDir[1] = dirs[i0 * 3 + 1];
        tmpDir[2] = dirs[i0 * 3 + 2];
        faceColor(e, tmpDir, 0, tmpColor);
        // Si el borde es de agua, el faldón también: así brilla igual y no se nota.
        const sw = e <= 0 && Math.abs(tmpDir[1]) <= 0.93 ? 1 : -1;

        const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
        const bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
        const dax = ax - dirs[i0 * 3] * skirtDepth;
        const day = ay - dirs[i0 * 3 + 1] * skirtDepth;
        const daz = az - dirs[i0 * 3 + 2] * skirtDepth;
        const dbx = bx - dirs[i1 * 3] * skirtDepth;
        const dby = by - dirs[i1 * 3 + 1] * skirtDepth;
        const dbz = bz - dirs[i1 * 3 + 2] * skirtDepth;

        writeVertex(ax, ay, az, sw);
        writeVertex(bx, by, bz, sw);
        writeVertex(dax, day, daz, sw);
        writeVertex(bx, by, bz, sw);
        writeVertex(dbx, dby, dbz, sw);
        writeVertex(dax, day, daz, sw);
        // Los mismos dos triángulos con la orientación contraria, para que el faldón
        // se vea desde ambos lados sin usar DoubleSide (que invierte la normal).
        writeVertex(ax, ay, az, sw);
        writeVertex(dax, day, daz, sw);
        writeVertex(bx, by, bz, sw);
        writeVertex(bx, by, bz, sw);
        writeVertex(dax, day, daz, sw);
        writeVertex(dbx, dby, dbz, sw);
        skirtVertexDirs.push(i0, i1, i0, i1, i1, i0, i0, i0, i1, i1, i0, i1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aWater', new THREE.BufferAttribute(water, 1));
    // Normales por cara (geometría no indexada = aspecto facetado). Los faldones usan la
    // normal "hacia arriba" para no verse como líneas oscuras entre trozos.
    geometry.computeVertexNormals();
    const normals = geometry.attributes.normal.array;
    for (let v = res * res * 6; v < triCount * 3; v++) {
      const k = skirtVertexDirs[v - res * res * 6];
      normals[v * 3] = dirs[k * 3];
      normals[v * 3 + 1] = dirs[k * 3 + 1];
      normals[v * 3 + 2] = dirs[k * 3 + 2];
    }
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(this.center);
    mesh.receiveShadow = true; // recibe la sombra de las nubes
    mesh.userData.level = this.level;
    mesh.onBeforeRender = (renderer, scene, camera, geometry, mat) => {
      setChunkWaveOffset(mat, this.center, waveOrigin);
    };
    mesh.visible = false;
    this.mesh = mesh;
    return mesh;
  }
}

export class Terrain {
  constructor() {
    this.object = new THREE.Group();
    this.object.name = 'terrain';
    this.material = createTerrainMaterial();
    this.roots = FACES.map((face) => new Node(face, 0, -1, -1, 2));
    for (const root of this.roots) this.object.add(root.build(this.material));
    this.queue = [];
    this.camera = new THREE.Vector3();
    this.horizon = Infinity;
  }

  update(cameraPosition) {
    this.camera.copy(cameraPosition);
    waveOrigin.set(
      Math.round(cameraPosition.x / WAVE_TILE) * WAVE_TILE,
      Math.round(cameraPosition.y / WAVE_TILE) * WAVE_TILE,
      Math.round(cameraPosition.z / WAVE_TILE) * WAVE_TILE,
    );
    const altitude = Math.max(0, cameraPosition.length() - RADIUS);
    // Distancia al horizonte, más la distancia a la que se ve una montaña muy alta.
    this.horizon =
      Math.sqrt(altitude * (2 * RADIUS + altitude)) +
      Math.sqrt(MAX_LAND_HEIGHT * (2 * RADIUS + MAX_LAND_HEIGHT));

    this.frame = (this.frame || 0) + 1;
    for (const root of this.roots) this.updateNode(root);
    this.processQueue();
  }

  wantsSplit(node) {
    if (node.level >= MAX_LEVEL) return false;
    const centerDistance = this.camera.distanceTo(node.center);
    if (centerDistance - node.worldSize > this.horizon) return false;
    const distance = Math.max(1, centerDistance - node.worldSize * 0.7);
    const threshold = node.children ? MERGE_THRESHOLD : SPLIT_THRESHOLD;
    return node.worldSize / distance > threshold;
  }

  // Devuelve true si el nodo (o sus hijos) ya se pueden dibujar sin dejar huecos.
  updateNode(node) {
    if (this.wantsSplit(node)) {
      if (!node.children) node.split();
      let ready = true;
      for (const child of node.children) {
        if (!this.updateNode(child)) ready = false;
      }
      if (ready) {
        if (node.mesh) node.mesh.visible = false;
        return true;
      }
      // Mientras los hijos se generan, seguimos mostrando este nodo.
      for (const child of node.children) child.hideAll();
      return this.show(node);
    }

    if (node.children) {
      for (const child of node.children) child.dispose();
      node.children = null;
    }
    return this.show(node);
  }

  show(node) {
    node.wantedFrame = this.frame;
    if (node.mesh) {
      node.mesh.visible = true;
      return true;
    }
    if (!node.queued) {
      node.queued = true;
      this.queue.push(node);
    }
    return false;
  }

  processQueue() {
    if (this.queue.length === 0) return;
    // Fuera los trozos que ya no hacen falta (p. ej. zonas por las que la cámara sólo
    // pasó de camino). Si vuelven a hacer falta se vuelven a pedir.
    this.queue = this.queue.filter((n) => {
      const keep = !n.disposed && n.wantedFrame === this.frame;
      if (!keep) n.queued = false;
      return keep;
    });
    // Primero lo que más se ve: trozos grandes y cercanos (tamaño / distancia al borde).
    const cam = this.camera;
    for (const n of this.queue) {
      n.priority = n.worldSize / Math.max(1, cam.distanceTo(n.center) - n.worldSize * 0.7);
    }
    this.queue.sort((p, q) => q.priority - p.priority);

    const start = performance.now();
    while (this.queue.length > 0 && performance.now() - start < BUILD_BUDGET_MS) {
      const node = this.queue.shift();
      node.queued = false;
      if (node.disposed || node.mesh) continue;
      this.object.add(node.build(this.material));
    }
  }

  get pending() {
    return this.queue.length;
  }
}
