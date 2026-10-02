// Generación de los recursos de una baldosa (sin Three.js: corre en un Web Worker).
// Devuelve arrays planos listos para copiar a los InstancedMesh:
//   type  (Uint8)   índice en RESOURCE_TYPES
//   pos   (Float64) posición en el mundo (x, y, z)
//   basis (Float32) rotación y escala como matriz 3×3 (columnas X, Y, Z)
//   tint  (Float32) variación de brillo
//   rank  (Float32) número al azar fijo; decide cuáles se ven a lo lejos

import { RADIUS, SEED, surfaceHeight } from './elevation.js';
import { biomeAt } from './biomes.js';
import { createNoise3D } from './noise.js';
import { RESOURCE_TYPES, TILE } from './resourceTypes.js';

export const TILE_ANGLE = TILE / RADIUS;

const forestNoise = createNoise3D(SEED + 21);
const oreNoise = createNoise3D(SEED + 22);

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function poisson(mean, rand) {
  let n = Math.floor(mean);
  if (rand() < mean - n) n++;
  return n;
}

function dirFromLatLon(lat, lon, out) {
  const c = Math.cos(lat);
  out[0] = c * Math.sin(lon);
  out[1] = Math.sin(lat);
  out[2] = c * Math.cos(lon);
  return out;
}

export function generateTile(i, j, cols) {
  const rand = seededRandom((i * 73856093) ^ (j * 19349663) ^ SEED);
  const center = dirFromLatLon((i + 0.5) * TILE_ANGLE, ((j + 0.5) / cols) * Math.PI * 2, [0, 0, 0]);
  const biome = biomeAt(center[0], center[1], center[2]).id;
  const out = { count: 0, type: null, pos: null, basis: null, tint: null, rank: null };
  if (biome === 'ocean' || biome === 'ice') return finish(out, []);

  const forest = 0.3 + 0.7 * Math.min(1.2, Math.max(0, forestNoise(center[0] * 3000, center[1] * 3000, center[2] * 3000) + 0.4));
  const orePresence = oreNoise(center[0] * 900, center[1] * 900, center[2] * 900);

  // El bioma exacto se comprueba sólo en baldosas de borde (si alguna esquina difiere).
  const corners = [
    [i, j],
    [i + 1, j],
    [i, j + 1],
    [i + 1, j + 1],
  ].map(([a, b]) => biomeAt(...dirFromLatLon(a * TILE_ANGLE, (b / cols) * Math.PI * 2, [0, 0, 0])).id);
  const mixed = corners.some((b) => b !== biome);

  const items = [];
  const d = [0, 0, 0];
  RESOURCE_TYPES.forEach((type, typeIndex) => {
    let mean = type.biomes[biome];
    if (!mean) return;
    if (type.clustered) mean *= forest;
    if (type.ore !== undefined) {
      if (orePresence < type.ore) return;
      mean *= 1.5;
    }
    const count = poisson(mean, rand);
    for (let n = 0; n < count; n++) {
      const lat = (i + rand()) * TILE_ANGLE;
      const lon = ((j + rand()) / cols) * Math.PI * 2;
      const yaw = rand() * Math.PI * 2;
      const scale = type.scale[0] + rand() * (type.scale[1] - type.scale[0]);
      const tint = 0.85 + rand() * 0.3;
      const rank = rand();
      dirFromLatLon(lat, lon, d);
      if (mixed && biomeAt(d[0], d[1], d[2]).id !== biome) continue;
      const h = surfaceHeight({ x: d[0], y: d[1], z: d[2] });
      if (h <= 0.5) continue; // agua
      items.push({ typeIndex, d: [d[0], d[1], d[2]], h, yaw, scale, tint, rank });
    }
  });
  return finish(out, items);
}

// Arboleda del campamento: recursos extra en un anillo de 50 a 100 m alrededor de la
// fogata, según el bioma, para que la colonia siempre tenga árboles, bayas y piedras
// cerca. Se dibuja y se usa como una baldosa más (clave GROVE_KEY).
export const GROVE_KEY = -1;
export const GROVE_TREES = {
  taiga: ['pine'], tundra: ['pine'], mountain: ['pine'], snow: ['pine'],
  jungle: ['jungleTree', 'palm'], savanna: ['acacia'], desert: ['palm', 'acacia'], beach: ['palm'],
  swamp: ['broadleaf', 'jungleTree'],
};

export function generateCampGrove(dirX, dirY, dirZ, biome, seed) {
  const rand = seededRandom((seed ^ 0x2f6b1a3) >>> 0);
  const index = Object.fromEntries(RESOURCE_TYPES.map((t, k) => [t.id, k]));
  const trees = GROVE_TREES[biome] || ['broadleaf', 'broadleaf', 'pine'];
  const plan = [
    ...Array(70).fill(null).map(() => trees[Math.floor(rand() * trees.length)]),
    ...Array(22).fill('berryBush'),
    ...Array(10).fill('mushrooms'),
    ...Array(16).fill('stone'),
    ...Array(5).fill('flint'),
    ...Array(16).fill('pebbles'),
    ...Array(95).fill('sticks'),
  ];
  // Base tangente en el campamento (metros -> dirección).
  let ex = dirZ, ez = -dirX;
  const el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  const nx = dirY * ez, ny = dirZ * ex - dirX * ez, nz = -dirY * ex;
  const items = [];
  for (const id of plan) {
    const type = RESOURCE_TYPES[index[id]];
    const a = rand() * Math.PI * 2;
    const r = 50 + Math.sqrt(rand()) * 50;
    const e = (Math.cos(a) * r) / RADIUS;
    const n = (Math.sin(a) * r) / RADIUS;
    let x = dirX + ex * e + nx * n, y = dirY + ny * n, z = dirZ + ez * e + nz * n;
    const l = Math.hypot(x, y, z);
    x /= l; y /= l; z /= l;
    const h = surfaceHeight({ x, y, z });
    const yaw = rand() * Math.PI * 2;
    const scale = type.scale[0] + rand() * (type.scale[1] - type.scale[0]);
    const tint = 0.85 + rand() * 0.3;
    if (h <= 0.5) continue; // agua
    items.push({ typeIndex: index[id], d: [x, y, z], h, yaw, scale, tint, rank: 0 });
  }
  return finish({ count: 0 }, items);
}

// Vegetación que brota con la lluvia cerca del campamento (clave SPROUT_KEY). Cada
// brote es { typeIndex, d: [x, y, z], h, yaw, scale, tint } y se guarda tal cual.
export const SPROUT_KEY = -2;

export function sproutItem(dirX, dirY, dirZ, typeId, angle, distance, rand) {
  const typeIndex = RESOURCE_TYPES.findIndex((t) => t.id === typeId);
  const type = RESOURCE_TYPES[typeIndex];
  let ex = dirZ, ez = -dirX;
  const el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  const nx = dirY * ez, ny = dirZ * ex - dirX * ez, nz = -dirY * ex;
  const e = (Math.cos(angle) * distance) / RADIUS;
  const n = (Math.sin(angle) * distance) / RADIUS;
  let x = dirX + ex * e + nx * n, y = dirY + ny * n, z = dirZ + ez * e + nz * n;
  const l = Math.hypot(x, y, z);
  x /= l; y /= l; z /= l;
  const h = surfaceHeight({ x, y, z });
  if (h <= 0.5) return null;
  const scale = type.scale[0] + rand() * (type.scale[1] - type.scale[0]);
  return { typeIndex, d: [x, y, z], h, yaw: rand() * Math.PI * 2, scale, tint: 0.85 + rand() * 0.3, rank: 0 };
}

export function tileFromItems(items) {
  return finish({ count: 0 }, items);
}

function finish(out, items) {
  const n = items.length;
  out.count = n;
  out.type = new Uint8Array(n);
  out.pos = new Float64Array(n * 3);
  out.basis = new Float32Array(n * 9);
  out.tint = new Float32Array(n);
  out.rank = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const it = items[k];
    const [ux, uy, uz] = it.d;
    const r = RADIUS + it.h - 0.25;
    out.type[k] = it.typeIndex;
    out.pos[k * 3] = ux * r;
    out.pos[k * 3 + 1] = uy * r;
    out.pos[k * 3 + 2] = uz * r;
    // Base local: Y = "arriba" del planeta; X y Z en el plano del suelo, giradas "yaw".
    let ex = uz, ey = 0, ez = -ux; // este = (0,1,0) × arriba
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el; ez /= el;
    const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex; // norte = arriba × este
    const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
    const xx = ex * c + nx * s, xy = ey * c + ny * s, xz = ez * c + nz * s;
    // Z = X × Y
    const zx = xy * uz - xz * uy, zy = xz * ux - xx * uz, zz = xx * uy - xy * ux;
    const sc = it.scale;
    const b = out.basis;
    b[k * 9] = xx * sc; b[k * 9 + 1] = xy * sc; b[k * 9 + 2] = xz * sc;
    b[k * 9 + 3] = ux * sc; b[k * 9 + 4] = uy * sc; b[k * 9 + 5] = uz * sc;
    b[k * 9 + 6] = zx * sc; b[k * 9 + 7] = zy * sc; b[k * 9 + 8] = zz * sc;
    out.tint[k] = it.tint;
    out.rank[k] = it.rank;
  }
  return out;
}
