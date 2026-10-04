import { BIOMES, biomeAt } from '../biomes.js';

// Distribución y terreno del campamento: datos puros (sin Three.js ni DOM). Los usan el
// modelo del campamento (camp.js), la simulación de los colonos y el servidor.

// Terreno que se modifica alrededor del campamento (metros).
export const FLAT_RADIUS = 30; // círculo nivelado
export const BLEND_RADIUS = 32; // transición suave hasta el terreno natural
export const CLEAR_RADIUS = 21; // claro de tierra pisada
export const DETAIL_RADIUS = 1_500; // malla más fina alrededor

// Zona de terreno del campamento (elevation.js): nivela el círculo y pinta el claro.
// "dir" es la dirección unitaria del campamento (cualquier objeto con x, y, z).
export function campZone(dir, height, ground = null, extra = {}) {
  if (!ground) {
    const biome = biomeAt(dir.x, dir.y, dir.z);
    ground = biome.details ? biome : BIOMES.grassland;
  }
  return {
    dir: { x: dir.x, y: dir.y, z: dir.z },
    height,
    flatRadius: FLAT_RADIUS,
    blendRadius: BLEND_RADIUS,
    clearRadius: CLEAR_RADIUS,
    detailRadius: DETAIL_RADIUS,
    dirtColor: ground.dirt,
    ...extra,
  };
}

// Distribución del campamento (coordenadas locales en metros, la fogata en el centro).
// La usan el modelo y los colonos (para no atravesar tiendas ni la fogata).
export const TIPIS = [
  { angle: 0.2, dist: 11.5, size: 1.05, cloth: '#dccaa2', bands: [[0.18, 0.26, '#a8452d'], [0.3, 0.33, '#2f5d7a'], [0.62, 0.66, '#a8452d']] },
  { angle: 1.75, dist: 12.5, size: 1.2, cloth: '#cdb088', bands: [[0.2, 0.3, '#2f5d7a'], [0.34, 0.37, '#e0c25a'], [0.6, 0.64, '#2f5d7a']] },
  { angle: 3.4, dist: 11, size: 0.95, cloth: '#e4d7b6', bands: [[0.16, 0.22, '#7a3b8a'], [0.58, 0.62, '#7a3b8a']] },
  { angle: 4.9, dist: 13, size: 1.1, cloth: '#d1b98e', bands: [[0.22, 0.3, '#a8452d'], [0.33, 0.36, '#1f1f1f'], [0.64, 0.68, '#a8452d']] },
];
export const RACK = { angle: 2.6, dist: 9 };
export const WOODPILE = { angle: 5.8, dist: 9.5 };
export const STORAGE = { angle: 1.0, dist: 8 };
export const BANNER = { angle: 4.1, dist: 6.5 };
export const BENCH_ANGLES = [0.4, 0.4 + Math.PI / 2, 0.4 + Math.PI, 0.4 + (3 * Math.PI) / 2];
export const BENCH_DIST = 4.4;
export const GROUND_SEATS = 10; // sitios en el suelo, repartidos en círculo junto a la fogata
export const GROUND_SEAT_DIST = 3;
export const BENCH_SEAT_OFFSET = 0.8; // cada tronco tiene dos asientos, a este lado y al otro del centro

// Asientos junto a la fogata: { x, z, kind: 'ground' | 'bench', approach } (approach: dónde se
// espera antes de sentarse; en los troncos, el lado de la fogata). El sitio ocupado
// ("taken") lo anota la simulación.
export function fireSeats() {
  const seats = [];
  for (let i = 0; i < GROUND_SEATS; i++) {
    const a = ((i + 0.5) / GROUND_SEATS) * Math.PI * 2;
    const x = Math.cos(a) * GROUND_SEAT_DIST;
    const z = Math.sin(a) * GROUND_SEAT_DIST;
    seats.push({ x, z, kind: 'ground', approach: { x, z }, taken: null });
  }
  for (const a of BENCH_ANGLES) {
    const rx = Math.sin(a);
    const rz = Math.cos(a);
    // El tronco corre en la dirección (cos a, -sin a), perpendicular al radio.
    for (const side of [-1, 1]) {
      const x = rx * BENCH_DIST + Math.cos(a) * side * BENCH_SEAT_OFFSET;
      const z = rz * BENCH_DIST - Math.sin(a) * side * BENCH_SEAT_OFFSET;
      seats.push({ x, z, kind: 'bench', approach: { x: x - rx * 1.4, z: z - rz * 1.4 }, taken: null });
    }
  }
  return seats;
}

export function polar({ angle, dist }) {
  return [Math.cos(angle) * dist, Math.sin(angle) * dist];
}

// Lugares útiles del campamento para los colonos (coordenadas locales).
export function campLayout() {
  const tents = TIPIS.map((t) => {
    const [x, z] = polar(t);
    const r = 3.5 * t.size;
    const d = Math.hypot(x, z);
    // La puerta mira a la fogata.
    return { x, z, r, door: { x: x - (x / d) * (r + 0.9), z: z - (z / d) * (r + 0.9) } };
  });
  const [sx, sz] = polar(STORAGE);
  const sd = Math.hypot(sx, sz);
  return {
    fire: { x: 0, z: 0 },
    seats: fireSeats(),
    tents,
    pots: { x: sx, z: sz }, // las vasijas y cestas del almacén
    storage: { x: sx + (sx / sd) * 3.4, z: sz + (sz / sd) * 3.4 }, // junto a las vasijas, del lado de fuera
  };
}

// Obstáculos del campamento como círculos { x, z, r } en coordenadas locales.
export function campObstacles() {
  const list = [{ x: 0, z: 0, r: 2.3, kind: 'fire' }];
  // Sin tipis: el campamento inicial es una fogata, un acopio y un refugio de ramas.
  for (const a of BENCH_ANGLES) {
    const x = Math.sin(a) * BENCH_DIST;
    const z = Math.cos(a) * BENCH_DIST;
    // Cada banco es un tronco de ~3,5 m: dos círculos a lo largo.
    const tx = Math.cos(a) * 1;
    const tz = -Math.sin(a) * 1;
    list.push({ x: x + tx, z: z + tz, r: 0.9, kind: 'bench' }, { x: x - tx, z: z - tz, r: 0.9, kind: 'bench' });
  }
  for (const [item, r] of [[RACK, 2.1], [WOODPILE, 2.6], [STORAGE, 2.4], [BANNER, 0.5]]) {
    const [x, z] = polar(item);
    list.push({ x, z, r, kind: 'prop' });
  }
  return list;
}


// Semilla del campamento según su lugar: decide sus colonos y sus adornos.
export function seedFromDir(dir) {
  return Math.floor(Math.abs(Math.sin(dir.x * 91.7 + dir.y * 47.3 + dir.z * 13.9)) * 4294967295) >>> 0;
}
