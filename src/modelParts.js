// Piezas y colores comunes para modelar edificios (los usan buildingModelsGen.js y buildingModelsSig.js).
// Todo es geometría simple: cajas, cilindros y conos que se juntan en una sola malla por edificio.
import * as THREE from 'three';
import { mat, stick, v, triangle, seededRandom } from './modelKit.js';

export { THREE, mat, stick, v, triangle };

// ---- Variantes -------------------------------------------------------------------------------
// Varias casas del mismo tipo y nivel no son clones exactos: cambian algo el color de los muros y del techo y
// llevan o no pequeños detalles (postigos, maceteros, chimenea al otro lado...). La variante sale SIEMPRE de la
// posición, el tipo y el nivel (modelVariant): es la misma para quien construye y para quien mira, antes y después
// de reconectar, sin aleatoriedad nueva en cada dibujo. La huella, la puerta y la capacidad no cambian.

export const VARIANTS = 4;

export function modelVariant(x, z, type, level) {
  let h = 2166136261;
  const mix = (n) => {
    h ^= n & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (n >> 8) & 0xff;
    h = Math.imul(h, 16777619);
  };
  mix(Math.round(x * 10));
  mix(Math.round(z * 10));
  mix(level | 0);
  for (let i = 0; i < type.length; i++) mix(type.charCodeAt(i));
  return (h >>> 0) % VARIANTS;
}

// Estado del modelo que se está dibujando (lo fija generate()).
export const ctx = { variant: 0, rand: seededRandom(1) };

export function setVariant(n) {
  ctx.variant = n | 0;
  ctx.rand = seededRandom(0x9e3779b1 ^ (n * 7919 + 13));
}

// Un detalle opcional: depende sólo de la variante y de un número de detalle (estable).
export const flag = (k) => ctx.variant === 0 ? k % 2 === 0 : ((ctx.variant * 31 + k * 17) % 5) < 3;
export const pick = (list, k = 0) => list[(ctx.variant + k) % list.length];

// ---- Colores por edad -------------------------------------------------------------------------
const PAL = [
  null,
  { wall: '#8a6a3c', roof: '#5f7a3a', trim: '#6b4a2e', base: '#7a7468' },
  { wall: '#b78a5e', roof: '#c9a45a', trim: '#8a643c', base: '#8f8a82' },
  { wall: '#c9a878', roof: '#d4b96a', trim: '#7a5230', base: '#8f8a82' },
  { wall: '#a07a4a', roof: '#8a643c', trim: '#5a3a22', base: '#8a8478' },
  { wall: '#cfc6b4', roof: '#b4553a', trim: '#8f8a82', base: '#9a958c' },
  { wall: '#e8dcc0', roof: '#a8452d', trim: '#5a3a22', base: '#8f8a82' },
  { wall: '#d9c9a8', roof: '#9a4a35', trim: '#6a4a30', base: '#8f8a82' },
  { wall: '#b85a3e', roof: '#4a4a52', trim: '#3a3a40', base: '#6a6660' },
  { wall: '#a8a8a2', roof: '#6a6a70', trim: '#3a3a44', base: '#7a7a76' },
  { wall: '#d8e4ea', roof: '#9fb0b8', trim: '#4a5a64', base: '#8a9298' },
];
// Otros colores de techo posibles de cada edad (los que ya existían en ese tiempo).
const ROOF_ALT = [
  null,
  ['#5f7a3a', '#7a8a44', '#6a6a3a'],
  ['#c9a45a', '#b8944a', '#d4b46a'],
  ['#d4b96a', '#c4a45a', '#b8934e'],
  ['#8a643c', '#7a5230', '#9a7446'],
  ['#b4553a', '#a4472e', '#c26a48'],
  ['#a8452d', '#8f3a28', '#b85a3e'],
  ['#9a4a35', '#8a3f2e', '#a85a40'],
  ['#4a4a52', '#5a5058', '#3e4048'],
  ['#6a6a70', '#5a6068', '#7a7a80'],
  ['#9fb0b8', '#8aa0aa', '#b0c0c8'],
];

function shifted(color, k) {
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl);
  // Pequeños cambios de tono y luminosidad, iguales para toda la variante.
  const r = (n) => ((ctx.variant * 2654435761 + k * 40503 + n * 9973) >>> 0) / 4294967296;
  c.setHSL(hsl.h + (r(1) - 0.5) * 0.025, Math.min(1, hsl.s * (1 + (r(2) - 0.5) * 0.25)), Math.min(0.92, hsl.l * (1 + (r(3) - 0.5) * 0.16)));
  return `#${c.getHexString()}`;
}

export function pal(tier) {
  const base = PAL[Math.min(10, Math.max(1, tier))];
  if (ctx.variant === 0) return base;
  const t = Math.min(10, Math.max(1, tier));
  return {
    wall: shifted(base.wall, 1),
    roof: ROOF_ALT[t][ctx.variant % ROOF_ALT[t].length],
    trim: shifted(base.trim, 3),
    base: shifted(base.base, 4),
  };
}

export const DARK = '#2a1c10';
export const GLASS = '#5a7f9a';

// ---- Primitivas -----------------------------------------------------------------------------------

export const box = (p, w, h, d, color, x, y, z, ry = 0, rx = 0, rz = 0) => p.add(new THREE.BoxGeometry(w, h, d), color, mat(x, y, z, rx, ry, rz));
export const cyl = (p, rt, rb, h, color, x, y, z, seg = 10) => p.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, mat(x, y, z));
export const cone = (p, r, h, color, x, y, z, seg = 10) => p.add(new THREE.ConeGeometry(r, h, seg), color, mat(x, y, z));
export const dome = (p, r, color, x, y, z, sy = 1) => p.add(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), color, mat(x, y, z, 0, 0, 0, 1, sy, 1));
export const rock = (p, r, color, x, y, z, sy = 0.8) => p.add(new THREE.DodecahedronGeometry(r, 0), color, mat(x, y, z, x, z, 0, 1, sy, 1));

// Tejado a dos aguas con la cumbrera a lo largo de z: w = ancho, d = largo, h = altura de la cumbrera.
export function gable(p, w, d, h, color, y, wallColor, ox = 0, oz = 0) {
  const s = Math.hypot(w / 2, h) + 0.2;
  const a = Math.atan2(h, w / 2);
  box(p, s, 0.16, d + 0.35, color, ox + w / 4, y + h / 2, oz, 0, 0, -a);
  box(p, s, 0.16, d + 0.35, color, ox - w / 4, y + h / 2, oz, 0, 0, a);
  if (wallColor) {
    for (const z of [d / 2, -d / 2]) p.add(triangle(v(ox - w / 2, y, oz + z), v(ox + w / 2, y, oz + z), v(ox, y + h, oz + z)), wallColor);
  }
}

export const door = (p, x, y, z, w = 0.8, h = 1.5) => box(p, w, h, 0.12, DARK, x, y + h / 2, z);
export const window_ = (p, x, y, z, c = DARK, w = 0.5, h = 0.5) => box(p, w, h, 0.1, c, x, y, z);

// Chimenea con su boca oscura.
export function chimney(p, x, y, z, h, color = '#8a8478', w = 0.45) {
  box(p, w, h, w, color, x, y + h / 2, z);
  box(p, w * 1.2, 0.08, w * 1.2, '#3a3a3a', x, y + h, z);
}

// Hileras de vigas vistas sobre un muro (entramado).
export function frameBeams(p, w, h, d, y, color) {
  for (const z of [d / 2 + 0.03, -d / 2 - 0.03]) {
    for (let i = -2; i <= 2; i++) box(p, 0.1, h, 0.08, color, (i * w) / 4.6, y + h / 2, z);
    box(p, w, 0.1, 0.08, color, 0, y + 0.05, z);
    box(p, w, 0.1, 0.08, color, 0, y + h - 0.05, z);
  }
}

// Una vasija, una cesta, un saco, un barril: objetos pequeños que dicen para qué sirve un edificio.
export const pot = (p, x, y, z, color = '#b0603a', s = 1) => {
  p.add(new THREE.CylinderGeometry(0.2 * s, 0.14 * s, 0.34 * s, 8), color, mat(x, y + 0.17 * s, z));
  p.add(new THREE.CylinderGeometry(0.1 * s, 0.2 * s, 0.1 * s, 8), color, mat(x, y + 0.39 * s, z));
};
export const sack = (p, x, y, z, color = '#d8c9a0', s = 1) => p.add(new THREE.SphereGeometry(0.28 * s, 7, 5), color, mat(x, y + 0.2 * s, z, 0, 0, 0, 1, 0.8, 0.9));
export const barrel = (p, x, y, z, color = '#7a5230', s = 1) => {
  cyl(p, 0.26 * s, 0.26 * s, 0.55 * s, color, x, y + 0.28 * s, z, 8);
  cyl(p, 0.27 * s, 0.27 * s, 0.05 * s, '#4a4a52', x, y + 0.14 * s, z, 8);
  cyl(p, 0.27 * s, 0.27 * s, 0.05 * s, '#4a4a52', x, y + 0.42 * s, z, 8);
};
export const crate = (p, x, y, z, s = 0.6, color = '#c49a5a') => box(p, s, s, s, color, x, y + s / 2, z, x * 3);
export const logs = (p, x, y, z, len = 1.6, rows = 3, color = '#7a5230') => {
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < rows - row; i++) {
      const zz = z + (i - (rows - 1 - row) / 2) * 0.44;
      stick(p, v(x - len / 2, y + 0.2 + row * 0.38, zz), v(x + len / 2, y + 0.2 + row * 0.38, zz), 0.19, (i + row) % 2 ? color : '#6b4a2e', 6);
    }
  }
};
// Un cartel colgado de un poste (el emblema distingue el oficio) y una bandera de tela.
export const sign = (p, x, y, z, color, emblem = '#f4ecd0', w = 0.8) => {
  stick(p, v(x, y, z), v(x, y + 1.7, z), 0.05, '#5a3a22', 4);
  box(p, w, 0.55, 0.06, color, x, y + 1.45, z + 0.04);
  box(p, w * 0.45, 0.22, 0.04, emblem, x, y + 1.45, z + 0.09);
};
export const flagPole = (p, x, y, z, h, color = '#c8423a') => {
  stick(p, v(x, y, z), v(x, y + h, z), 0.05, '#8f8a82', 5);
  box(p, 0.9, 0.55, 0.05, color, x + 0.45, y + h - 0.35, z);
};
