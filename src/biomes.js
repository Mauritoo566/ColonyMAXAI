// Biomas del planeta: qué tipo de terreno hay en cada punto y con qué colores y
// detalles se dibuja. Lo usan el terreno (colores de cada cara) y los modelos (el
// campamento y lo que venga después), para que todo combine con el suelo.
// No usa Three.js: también se ejecuta dentro del Web Worker del terreno.

import { elevation, moisture } from './elevation.js';

// Colores en hexadecimal (sRGB). Los detalles del suelo indican qué adornos pequeños
// tienen sentido en cada bioma (matas de pasto, piedras, matorrales secos...).
export const BIOMES = {
  ocean: { id: 'ocean', name: 'Océano' },
  ice: { id: 'ice', name: 'Hielo polar', ground: '#e8f2f8' },
  snow: {
    id: 'snow',
    name: 'Nieve',
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
  desert: {
    id: 'desert',
    name: 'Desierto',
    ground: '#c9a15e',
    dirt: '#b48a4e',
    details: { tuft: '#9a9450', stone: '#b39a74', stoneChance: 0.55 },
  },
  grassland: {
    id: 'grassland',
    name: 'Pradera',
    ground: '#4f8f3a',
    dirt: '#8a6a45',
    details: { tuft: '#5d8f36', stone: '#8b877f', stoneChance: 0.25 },
  },
  forest: {
    id: 'forest',
    name: 'Bosque',
    ground: '#2f6b2c',
    dirt: '#6f5238',
    details: { tuft: '#3f7a30', stone: '#7f7b72', stoneChance: 0.3 },
  },
};

// Bioma a partir de datos ya calculados (lo usa el terreno, que ya tiene la elevación).
// "slope" es 1 - coseno del ángulo con la vertical (0 = llano).
export function classifyBiome(e, lat, slope, m) {
  if (e <= 0) return lat > 0.93 ? BIOMES.ice : BIOMES.ocean;
  if (lat > 0.9 || e > 0.62) return BIOMES.snow;
  if (slope > 0.3 || e > 0.45) return BIOMES.mountain;
  if (e < 0.02) return BIOMES.beach;
  if (m < -0.12 && lat < 0.55) return BIOMES.desert;
  return m > 0.08 ? BIOMES.forest : BIOMES.grassland;
}

// Bioma en una dirección unitaria del planeta.
export function biomeAt(x, y, z, slope = 0) {
  const e = elevation(x, y, z);
  const needsMoisture = e > 0.02 && e <= 0.45;
  return classifyBiome(e, Math.abs(y), slope, needsMoisture ? moisture(x, y, z) : 0);
}
