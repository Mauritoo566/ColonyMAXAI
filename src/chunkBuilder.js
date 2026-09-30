// Cálculo de la geometría de un trozo de terreno: posiciones, colores, normales y la
// marca de agua de cada vértice. No usa Three.js para poder ejecutarse en un Web
// Worker (en segundo plano) y no frenar el juego mientras se genera el terreno.

import {
  RADIUS,
  SEED,
  elevation,
  heightFromElevation,
  moisture,
  applyTerrainZones,
  terrainZones,
  zoneGround,
} from './elevation.js';
import { createNoise3D } from './noise.js';
import { BIOMES, classifyBiome } from './biomes.js';

export const RESOLUTION = 32; // celdas por lado en cada trozo

export const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

// Colores en espacio lineal (igual que THREE.Color con gestión de color activada).
const linearCache = new Map();
function linear(hex) {
  let c = linearCache.get(hex);
  if (!c) linearCache.set(hex, (c = toLinear(hex)));
  return c;
}

function toLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
}

const COLORS = {
  oceanDeep: linear('#123f75'),
  oceanShallow: linear('#2f7fbf'),
  grassDry: linear('#8fa64a'),
  grassDark: linear('#2e5f2a'),
};

// Ruido para las manchas de color del pasto (de cerca el verde uniforme se ve plano).
const patchNoise = createNoise3D(SEED + 6);

function copy(out, c) {
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
  return out;
}

function lerp(out, c, t) {
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
  return out;
}

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

export function faceDirection(face, a, b, out) {
  const { n, u, v } = face;
  return cubeToSphere(n[0] + u[0] * a + v[0] * b, n[1] + u[1] * a + v[1] * b, n[2] + u[2] * a + v[2] * b, out);
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
    if (lat > 0.93) return copy(out, linear(BIOMES.ice.ground));
    const depth = Math.min(1, Math.max(0, -e * 3));
    return lerp(copy(out, COLORS.oceanShallow), COLORS.oceanDeep, depth);
  }
  // La humedad sólo hace falta para distinguir pradera, bosque y desierto.
  const needsMoisture = lat <= 0.9 && e <= 0.45 && slope <= 0.3 && e >= 0.02;
  const biome = classifyBiome(e, lat, slope, needsMoisture ? moisture(dir[0], dir[1], dir[2]) : 0);
  copy(out, linear(biome.ground));
  if (biome === BIOMES.grassland || biome === BIOMES.forest) {
    // Manchas de pasto más seco o más oscuro, de ~300 m y de ~40 m.
    const [x, y, z] = dir;
    const p =
      patchNoise(x * 21_000, y * 21_000, z * 21_000) * 0.65 + patchNoise(x * 160_000, y * 160_000, z * 160_000) * 0.35;
    lerp(out, p > 0 ? COLORS.grassDry : COLORS.grassDark, Math.min(1, Math.abs(p) * 0.9) * 0.45);
  }
  // Claro de un campamento: suelo pisado del color de su bioma en el centro, y
  // alrededor el suelo que haya, un poco más oscuro y apagado.
  if (terrainZones().length) {
    const g = zoneGround(dir[0], dir[1], dir[2]);
    if (g.trampled > 0 && g.dirtColor) {
      const k = 1 - 0.15 * g.trampled;
      out[0] *= k;
      out[1] *= k;
      out[2] *= k;
      lerp(out, linear(g.dirtColor), 0.25 * g.trampled);
    }
    if (g.dirt > 0 && g.dirtColor) lerp(out, linear(g.dirtColor), g.dirt);
  }
  return out;
}

// params: { face (índice en FACES), level, a, b, size, center: [x, y, z], worldSize }
// Devuelve arrays listos para un BufferGeometry no indexado (aspecto facetado).
export function buildChunkData({ face: faceIndex, level, a, b, size, center, worldSize }) {
  const face = FACES[faceIndex];
  const res = RESOLUTION;
  const n = res + 1;
  const octaves = Math.min(22, level + 8);
  const pos = new Float64Array(n * n * 3);
  const dirs = new Float64Array(n * n * 3);
  const elev = new Float64Array(n * n);
  const tmpDir = [0, 0, 0];
  const color = [0, 0, 0];

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      faceDirection(face, a + (size * i) / res, b + (size * j) / res, tmpDir);
      const e = elevation(tmpDir[0], tmpDir[1], tmpDir[2], octaves);
      const r = RADIUS + applyTerrainZones(tmpDir[0], tmpDir[1], tmpDir[2], heightFromElevation(e));
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
  const normals = new Float32Array(triCount * 9);
  const water = new Float32Array(triCount * 3);
  const [cx, cy, cz] = center;
  let t = 0;
  const normal = [0, 0, 0];

  const writeVertex = (x, y, z, w) => {
    // Posiciones relativas al centro del trozo: así caben en float32 sin perder precisión.
    positions[t * 3] = x - cx;
    positions[t * 3 + 1] = y - cy;
    positions[t * 3 + 2] = z - cz;
    colors[t * 3] = color[0];
    colors[t * 3 + 1] = color[1];
    colors[t * 3 + 2] = color[2];
    normals[t * 3] = normal[0];
    normals[t * 3 + 1] = normal[1];
    normals[t * 3 + 2] = normal[2];
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
      nx = -nx; ny = -ny; nz = -nz;
      up = -up;
    }
    normal[0] = nx;
    normal[1] = ny;
    normal[2] = nz;

    const e = (elev[i0] + elev[i1] + elev[i2]) / 3;
    let colorE = e;
    if (e <= 0) {
      // El tono del agua depende de la profundidad. Se calcula siempre con el mismo
      // detalle (6 octavas) para que trozos vecinos de distinto nivel coincidan.
      const l = Math.hypot(tmpDir[0], tmpDir[1], tmpDir[2]);
      colorE = Math.min(-1e-9, elevation(tmpDir[0] / l, tmpDir[1] / l, tmpDir[2] / l, 6));
    }
    faceColor(colorE, tmpDir, 1 - up, color);
    const k = 1 + (hash3(tmpDir[0], tmpDir[1], tmpDir[2]) - 0.5) * 0.12;
    color[0] *= k;
    color[1] *= k;
    color[2] *= k;

    // Agua: 0 en los vértices que tocan tierra (espuma), 1 en agua abierta, -1 tierra.
    const isWater = e <= 0 && Math.abs(tmpDir[1]) <= 0.93;
    const w = (idx) => (isWater ? (elev[idx] > 0 ? 0 : 1) : -1);
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
  // grietas que aparecen entre trozos vecinos con distinto nivel de detalle. Su
  // normal apunta hacia arriba para que no se vean como líneas oscuras.
  const skirtDepth = Math.max(40, worldSize * 0.03);
  const edges = [
    (s) => s, // abajo
    (s) => res * n + s, // arriba
    (s) => s * n, // izquierda
    (s) => s * n + res, // derecha
  ];
  const upOf = (idx) => {
    normal[0] = dirs[idx * 3];
    normal[1] = dirs[idx * 3 + 1];
    normal[2] = dirs[idx * 3 + 2];
  };
  for (const edge of edges) {
    for (let s = 0; s < res; s++) {
      const i0 = edge(s);
      const i1 = edge(s + 1);
      const e = (elev[i0] + elev[i1]) / 2;
      tmpDir[0] = dirs[i0 * 3];
      tmpDir[1] = dirs[i0 * 3 + 1];
      tmpDir[2] = dirs[i0 * 3 + 2];
      faceColor(e, tmpDir, 0, color);
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

      // Dos triángulos y los mismos con la orientación contraria, para que el faldón
      // se vea desde ambos lados sin usar DoubleSide (que invierte la normal).
      upOf(i0); writeVertex(ax, ay, az, sw);
      upOf(i1); writeVertex(bx, by, bz, sw);
      upOf(i0); writeVertex(dax, day, daz, sw);
      upOf(i1); writeVertex(bx, by, bz, sw);
      upOf(i1); writeVertex(dbx, dby, dbz, sw);
      upOf(i0); writeVertex(dax, day, daz, sw);
      upOf(i0); writeVertex(ax, ay, az, sw);
      upOf(i0); writeVertex(dax, day, daz, sw);
      upOf(i1); writeVertex(bx, by, bz, sw);
      upOf(i1); writeVertex(bx, by, bz, sw);
      upOf(i0); writeVertex(dax, day, daz, sw);
      upOf(i1); writeVertex(dbx, dby, dbz, sw);
    }
  }

  return { positions, colors, normals, water };
}
