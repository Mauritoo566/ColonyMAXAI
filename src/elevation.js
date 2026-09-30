import * as THREE from 'three';
import { createNoise3D, fbm } from './noise.js';

// Todo el mundo está en metros, a escala real.
export const RADIUS = 6_371_000;

// El relieve real de la Tierra casi no se ve desde el espacio, así que lo exageramos.
export const EXAGGERATION = 2.5;
export const MAX_LAND_HEIGHT = 8_800 * EXAGGERATION;

export const SEED = 1337;

const elevationNoise = createNoise3D(SEED);
const moistureNoise = createNoise3D(SEED + 1);
const ridgeNoise = createNoise3D(SEED + 3);
const hillNoise = createNoise3D(SEED + 4);

// Elevación normalizada (aprox. [-1, 1], < 0 es mar) para una dirección unitaria.
// "octaves" controla el detalle fino: los trozos lejanos usan menos octavas.
export function elevation(x, y, z, octaves = 22) {
  const continents = fbm(elevationNoise, x * 1.1, y * 1.1, z * 1.1, 4);
  let e = continents * 1.5 - 0.12;

  const detail = fbm(elevationNoise, x * 4 + 10, y * 4 + 10, z * 4 + 10, Math.max(1, octaves - 4), 2, 0.55);
  e += detail * 0.25;

  if (e > 0) {
    // Cordilleras: ruido "ridged" que sólo actúa tierra adentro.
    const r = 1 - Math.abs(fbm(ridgeNoise, x * 3, y * 3, z * 3, Math.min(6, octaves)));
    e += r * r * r * 0.35 * THREE.MathUtils.smoothstep(e, 0, 0.15);

    // Colinas de pocos kilómetros: sólo se notan de cerca, así que sólo se calculan
    // en los trozos de terreno más detallados.
    if (octaves > 14) {
      const hills = fbm(hillNoise, x * 1500, y * 1500, z * 1500, Math.min(8, octaves - 14), 2, 0.45);
      e += hills * (250 / MAX_LAND_HEIGHT) * THREE.MathUtils.smoothstep(e, 0, 0.05);
    }
  }
  return e;
}

// Altura en metros sobre el nivel del mar (el mar es plano, a altura 0).
export function heightFromElevation(e) {
  return e > 0 ? e * MAX_LAND_HEIGHT : 0;
}

export function surfaceHeight(dir, octaves) {
  return heightFromElevation(elevation(dir.x, dir.y, dir.z, octaves));
}

export function moisture(x, y, z) {
  return fbm(moistureNoise, x * 1.8, y * 1.8, z * 1.8, 3);
}
