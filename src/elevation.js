import { createNoise3D, fbm } from './noise.js';

// Este módulo no usa Three.js: también se ejecuta dentro del Web Worker del terreno.

function smoothstep(x, min, max) {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const t = (x - min) / (max - min);
  return t * t * (3 - 2 * t);
}

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

  const detail = fbm(elevationNoise, x * 4 + 10, y * 4 + 10, z * 4 + 10, Math.max(1, octaves - 4), 2, 0.55, 18);
  e += detail * 0.25;

  if (e > 0) {
    // Cordilleras: ruido "ridged" que sólo actúa tierra adentro.
    const r = 1 - Math.abs(fbm(ridgeNoise, x * 3, y * 3, z * 3, Math.min(6, octaves)));
    e += r * r * r * 0.35 * smoothstep(e, 0, 0.15);

    // Colinas de pocos kilómetros: sólo se notan de cerca, así que sólo se calculan
    // en los trozos de terreno más detallados.
    if (octaves > 14) {
      const hills = fbm(hillNoise, x * 1500, y * 1500, z * 1500, Math.min(8, octaves - 14), 2, 0.45, 8);
      e += hills * (250 / MAX_LAND_HEIGHT) * smoothstep(e, 0, 0.05);
    }
  }
  return e;
}

// Altura en metros sobre el nivel del mar (el mar es plano, a altura 0).
export function heightFromElevation(e) {
  return e > 0 ? e * MAX_LAND_HEIGHT : 0;
}

// Altura del terreno tal como es, sin nivelaciones.
export function naturalSurfaceHeight(dir, octaves) {
  return heightFromElevation(elevation(dir.x, dir.y, dir.z, octaves));
}

// Altura del terreno teniendo en cuenta las zonas niveladas (p. ej. el campamento).
export function surfaceHeight(dir, octaves) {
  return applyTerrainZones(dir.x, dir.y, dir.z, naturalSurfaceHeight(dir, octaves));
}

export function moisture(x, y, z) {
  return fbm(moistureNoise, x * 1.8, y * 1.8, z * 1.8, 3);
}

// ---------------------------------------------------------------------------
// Zonas de terreno modificado
// ---------------------------------------------------------------------------
// Una zona nivela el terreno en un círculo (flatRadius) y lo une con el terreno natural
// con una pendiente suave (blendRadius). También pinta un claro de tierra (clearRadius)
// y pide más detalle de malla alrededor (detailRadius). Todo en metros.
//   { dir: Vector3 unitario, height, flatRadius, blendRadius, clearRadius, detailRadius,
//     dirtColor: color del suelo pisado (según el bioma) }

const zones = [];
const edgeNoise = createNoise3D(SEED + 5);

export function addTerrainZone(zone) {
  zones.push(zone);
  return zone;
}

export function removeTerrainZone(zone) {
  const i = zones.indexOf(zone);
  if (i >= 0) zones.splice(i, 1);
}

export function terrainZones() {
  return zones;
}

// Reemplaza todas las zonas (lo usa el Web Worker para copiar las del juego).
export function setTerrainZones(list) {
  zones.length = 0;
  for (const z of list) zones.push({ ...z, dir: { x: z.dir.x, y: z.dir.y, z: z.dir.z } });
}

// Distancia en metros sobre la superficie (la cuerda: a estas distancias es igual al arco).
export function zoneDistance(zone, x, y, z) {
  const dx = x - zone.dir.x;
  const dy = y - zone.dir.y;
  const dz = z - zone.dir.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * RADIUS;
}

export function applyTerrainZones(x, y, z, height) {
  for (const zone of zones) {
    const d = zoneDistance(zone, x, y, z);
    const outer = zone.flatRadius + zone.blendRadius;
    if (d >= outer) continue;
    const t = 1 - smoothstep(d, zone.flatRadius, outer);
    height += (zone.height - height) * t;
  }
  return height;
}

// Cuánto de "tierra pisada" (dirt) y de "pasto pisado" (trampled) hay en un punto, de 0 a 1.
export function zoneGround(x, y, z) {
  let dirt = 0;
  let trampled = 0;
  let dirtColor = null;
  for (const zone of zones) {
    const d = zoneDistance(zone, x, y, z);
    if (d > zone.flatRadius + zone.blendRadius) continue;
    // Borde irregular: el radio varía unos metros con un ruido de ~15 m.
    const wobble = edgeNoise(x * 420_000, y * 420_000, z * 420_000) * 5;
    const zd = 1 - smoothstep(d + wobble, zone.clearRadius * 0.7, zone.clearRadius);
    const zt = 1 - smoothstep(d + wobble, zone.clearRadius, zone.flatRadius + 6);
    if (!dirtColor || zd >= dirt) dirtColor = zone.dirtColor || '#8a6a45';
    dirt = Math.max(dirt, zd);
    trampled = Math.max(trampled, zt);
  }
  return { dirt, trampled, dirtColor };
}
