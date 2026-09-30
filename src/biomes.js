// Biomas del planeta: qué tipo de terreno hay en cada punto y con qué colores y
// detalles se dibuja. Lo usan el terreno (colores de cada cara) y los modelos (el
// campamento y lo que venga después), para que todo combine con el suelo.
// No usa Three.js: también se ejecuta dentro del Web Worker del terreno.
//
// El clima de cada punto se resume en dos valores:
//   - temperatura: baja con la latitud y con la altura (con algo de ruido regional).
//   - humedad: el ruido de humedad del planeta.
// Con esos dos valores se elige el bioma, como en los diagramas climáticos reales.

import { SEED, elevation, moisture } from './elevation.js';
import { createNoise3D, fbm } from './noise.js';

// Colores en hexadecimal (sRGB). "details" indica qué adornos pequeños tienen sentido
// en cada bioma (matas de pasto, piedras...) y "vegetated" si el suelo tiene manchas
// de vegetación.
export const BIOMES = {
  ocean: { id: 'ocean', name: 'Océano' },
  ice: { id: 'ice', name: 'Hielo polar', ground: '#e8f2f8' },
  snow: {
    id: 'snow',
    name: 'Picos nevados',
    ground: '#f2f5f7',
    dirt: '#b9bcc0',
    details: { tuft: null, stone: '#7d7b78', stoneChance: 1 },
  },
  mountain: {
    id: 'mountain',
    name: 'Montaña rocosa',
    ground: '#7a6a58',
    dirt: '#6b5f52',
    details: { tuft: '#7d8a4a', stone: '#8a847b', stoneChance: 0.75 },
  },
  beach: {
    id: 'beach',
    name: 'Playa',
    ground: '#d8c68f',
    dirt: '#c2ad78',
    details: { tuft: '#9aa55a', stone: '#cfc3a8', stoneChance: 0.6 },
  },
  swamp: {
    id: 'swamp',
    name: 'Pantano',
    ground: '#4a5a32',
    dirt: '#4e4632',
    vegetated: true,
    details: { tuft: '#5f7d3a', stone: '#5d5a4e', stoneChance: 0.15 },
  },
  tundra: {
    id: 'tundra',
    name: 'Tundra',
    ground: '#8b8f6e',
    dirt: '#77705f',
    vegetated: true,
    details: { tuft: '#9a9a6a', stone: '#8a8780', stoneChance: 0.6 },
  },
  taiga: {
    id: 'taiga',
    name: 'Taiga',
    ground: '#2f5540',
    dirt: '#5e4a38',
    vegetated: true,
    details: { tuft: '#3f6a45', stone: '#7a7872', stoneChance: 0.35 },
  },
  steppe: {
    id: 'steppe',
    name: 'Estepa',
    ground: '#9a9a58',
    dirt: '#9a8058',
    vegetated: true,
    details: { tuft: '#aaa45e', stone: '#9a9282', stoneChance: 0.35 },
  },
  grassland: {
    id: 'grassland',
    name: 'Pradera',
    ground: '#4f8f3a',
    dirt: '#8a6a45',
    vegetated: true,
    details: { tuft: '#5d8f36', stone: '#8b877f', stoneChance: 0.25 },
  },
  forest: {
    id: 'forest',
    name: 'Bosque templado',
    ground: '#2f6b2c',
    dirt: '#6f5238',
    vegetated: true,
    details: { tuft: '#3f7a30', stone: '#7f7b72', stoneChance: 0.3 },
  },
  desert: {
    id: 'desert',
    name: 'Desierto',
    ground: '#c9a15e',
    dirt: '#b48a4e',
    details: { tuft: '#9a9450', stone: '#b39a74', stoneChance: 0.55 },
  },
  savanna: {
    id: 'savanna',
    name: 'Sabana',
    ground: '#a39a48',
    dirt: '#a0784a',
    vegetated: true,
    details: { tuft: '#b8a850', stone: '#a08a6e', stoneChance: 0.3 },
  },
  jungle: {
    id: 'jungle',
    name: 'Selva tropical',
    ground: '#1f6a2a',
    dirt: '#6a4a2e',
    vegetated: true,
    details: { tuft: '#2f8a2e', stone: '#6f6a5e', stoneChance: 0.15 },
  },
};

const temperatureNoise = createNoise3D(SEED + 7);

// Temperatura aproximada entre 0 (glacial) y 1 (tropical).
export function temperature(x, y, z, e) {
  const latitude = Math.asin(Math.min(1, Math.abs(y))) / (Math.PI / 2); // 0 ecuador, 1 polo
  const regional = fbm(temperatureNoise, x * 3, y * 3, z * 3, 2) * 0.12;
  return 1.05 - latitude * 1.0 - Math.max(0, e - 0.05) * 1.1 + regional;
}

// Bioma a partir de datos ya calculados.
//   e: elevación normalizada, lat: |y| de la dirección, slope: 1 - coseno de la
//   pendiente (0 = llano), m: humedad, t: temperatura (0..1).
export function classifyBiome(e, lat, slope, m, t) {
  if (e <= 0) return lat > 0.93 ? BIOMES.ice : BIOMES.ocean;
  if (lat > 0.9 || e > 0.8 || t < -0.1) return BIOMES.snow;
  if (slope > 0.3 || e > 0.62) return BIOMES.mountain;
  if (e < 0.02) return BIOMES.beach;
  if (e < 0.1 && m > 0.22 && t > 0.4) return BIOMES.swamp;
  if (t < 0.15) return BIOMES.tundra;
  if (t < 0.36) return m > -0.1 ? BIOMES.taiga : BIOMES.tundra;
  if (t < 0.72) {
    if (m < -0.25) return BIOMES.desert;
    if (m < -0.08) return BIOMES.steppe;
    if (m < 0.14) return BIOMES.grassland;
    return BIOMES.forest;
  }
  if (m < -0.2) return BIOMES.desert;
  if (m < 0.06) return BIOMES.savanna;
  return BIOMES.jungle;
}

// ¿Hace falta la humedad? (nieve, montaña y playa no la usan)
export function needsMoisture(e, lat, slope) {
  return e > 0.02 && e <= 0.62 && lat <= 0.9 && slope <= 0.3;
}

// Bioma en una dirección unitaria del planeta.
export function biomeAt(x, y, z, slope = 0) {
  const e = elevation(x, y, z);
  const lat = Math.abs(y);
  if (e <= 0) return classifyBiome(e, lat, slope, 0, 1);
  const m = needsMoisture(e, lat, slope) ? moisture(x, y, z) : 0;
  return classifyBiome(e, lat, slope, m, temperature(x, y, z, e));
}
