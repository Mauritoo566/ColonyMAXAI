// Los colonos prefieren ir por los caminos: si hay un camino que lleve (más o menos) hacia donde van, lo toman; si no, van por donde quieran.
// Datos y cuentas puras (sin Three.js). La ruta sale de una búsqueda A* sobre las casillas de camino (centros de casilla de 4 m, vecinas en
// 8 direcciones), con un tramo corto de entrada desde donde está el colono y otro de salida hasta su destino.
import { ROAD_CELL, roadKey } from './economy.js';

export const ROAD_MIN_TRIP = 14; // metros: en trayectos más cortos no se busca camino
export const ROAD_REACH = 10; // metros: lo más que se desvía para subirse a un camino (o bajarse de él)
export const ROAD_DETOUR = 1.3; // la ruta por camino puede ser hasta este múltiplo del trayecto directo (más un pequeño margen)
export const ROAD_SLACK = 4;
const MAX_EXPANSIONS = 3000;

// Un mapa de casillas con contador de cambios: sirve para saber si lo planeado sigue valiendo.
export class RoadMap extends Map {
  get rev() {
    return this._rev ?? 0;
  }

  set(key, value) {
    if (!this.has(key) || this.get(key) !== value) this._rev = this.rev + 1;
    return super.set(key, value);
  }

  delete(key) {
    if (this.has(key)) this._rev = this.rev + 1;
    return super.delete(key);
  }

  clear() {
    if (this.size) this._rev = this.rev + 1;
    super.clear();
  }
}

// La casilla de camino más cercana a (x, z) a menos de ROAD_REACH, o null.
function nearestCell(roads, x, z) {
  const ix0 = Math.round(x / ROAD_CELL);
  const iz0 = Math.round(z / ROAD_CELL);
  const span = Math.ceil(ROAD_REACH / ROAD_CELL) + 1;
  let best = null;
  let bd = ROAD_REACH;
  for (let ix = ix0 - span; ix <= ix0 + span; ix++) {
    for (let iz = iz0 - span; iz <= iz0 + span; iz++) {
      if (!roads.has(roadKey(ix, iz))) continue;
      const d = Math.hypot(ix * ROAD_CELL - x, iz * ROAD_CELL - z);
      if (d < bd) {
        bd = d;
        best = { ix, iz, d };
      }
    }
  }
  return best;
}

// Ruta por camino de (ax, az) a (bx, bz): lista de puntos {x, z} (centros de casilla) o null si no compensa o no hay camino que sirva.
export function roadRoute(roads, ax, az, bx, bz) {
  if (!roads?.size) return null;
  const direct = Math.hypot(bx - ax, bz - az);
  if (direct < ROAD_MIN_TRIP) return null;
  const from = nearestCell(roads, ax, az);
  const to = nearestCell(roads, bx, bz);
  if (!from || !to) return null;
  const limit = direct * ROAD_DETOUR + ROAD_SLACK;
  if (from.d + to.d > limit) return null;
  const start = roadKey(from.ix, from.iz);
  const goal = roadKey(to.ix, to.iz);
  // A*: cola de prioridad sencilla (montículo mínimo).
  const g = new Map([[start, 0]]);
  const prev = new Map();
  const heap = [[Math.hypot((to.ix - from.ix) * ROAD_CELL, (to.iz - from.iz) * ROAD_CELL), start, from.ix, from.iz]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const done = new Set();
  let expansions = 0;
  let found = false;
  while (heap.length && expansions++ < MAX_EXPANSIONS) {
    const [, key, ix, iz] = pop();
    if (done.has(key)) continue;
    done.add(key);
    if (key === goal) {
      found = true;
      break;
    }
    const gk = g.get(key);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = ix + dx;
        const nz = iz + dz;
        const nk = roadKey(nx, nz);
        if (!roads.has(nk) || done.has(nk)) continue;
        // En diagonal sólo si las dos casillas de al lado también son camino (la cinta no corta esquinas del vacío).
        if (dx && dz && !(roads.has(roadKey(ix + dx, iz)) && roads.has(roadKey(ix, iz + dz)))) continue;
        const ng = gk + (dx && dz ? 1.4142 : 1) * ROAD_CELL;
        if (ng >= (g.get(nk) ?? Infinity)) continue;
        g.set(nk, ng);
        prev.set(nk, key);
        push([ng + Math.hypot((to.ix - nx) * ROAD_CELL, (to.iz - nz) * ROAD_CELL), nk, nx, nz]);
      }
    }
  }
  if (!found) return null;
  if (from.d + g.get(goal) + to.d > limit) return null;
  const pts = [];
  for (let k = goal; k !== undefined; k = prev.get(k)) {
    const [ix, iz] = k.split(',').map(Number);
    pts.push({ x: ix * ROAD_CELL, z: iz * ROAD_CELL });
  }
  pts.reverse();
  // Quita puntos intermedios en línea recta: menos paradas en cada casilla.
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    if ((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x) !== 0) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
