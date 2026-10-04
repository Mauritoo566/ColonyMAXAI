// Entradas, accesos y espacio reservado de los edificios. Es geometría pura (sin Three.js) que usan igual el
// servidor, que valida, y el navegador, que previsualiza: así ambos dicen lo mismo.
//
// Cada edificio ocupa casillas enteras de 4 m (su huella real) y mira hacia un lado: el +z local de su modelo,
// girado por su orientación (siempre un cuarto de vuelta). Si tiene puerta, delante de ella queda una franja
// de acceso de una casilla de fondo que sólo puede ocupar un camino o quedar libre. Las estructuras abiertas
// (campos, minas, canteras, pozos) no tienen puerta sino un punto de trabajo en ese mismo lado.
//
//          ┌──────────────┐
//          │   huella     │   huella: casillas que ocupa el edificio
//          │      ▲ puerta│   puerta: centro de la fachada
//          └──────┬───────┘
//          ┌──────┴───────┐
//          │   acceso     │   acceso: franja de una casilla de fondo y al menos 2,4 m de ancho
//          └──────────────┘   (un camino o nada; ningún otro objeto)

export const CELL = 4; // metros por casilla (la misma cuadrícula que los caminos)
export const ACCESS_DEPTH = CELL; // fondo de la franja de acceso
export const MIN_ACCESS_WIDTH = 2.4; // ancho mínimo para pasar cómodo (puerta ~1 m)
export const APPROACH = 0.7; // metros más allá de la fachada donde espera quien llega

// Mitad del lado que ocupa un tipo: sus casillas enteras, salvo los adornos pequeños (small), que miden lo que miden.
export const halfFor = (def) => (def.small ? def.footprint : halfOf(def.footprint));

// Casillas que ocupa un edificio de ese radio: mitad del lado, en metros.
export function halfOf(footprint) {
  const cells = Math.max(1, Math.round((footprint * 2) / CELL));
  return (cells * CELL) / 2;
}

// Tipo de entrada de cada edificio: 'door' (puerta con franja reservada), 'open' (estructura abierta: punto de
// trabajo con franja reservada) o ninguna (muros y postes no tienen acceso).
const OPEN = new Set(['farm', 'quarry', 'clay_pit', 'copper_mine', 'tin_mine', 'iron_mine', 'coal_mine', 'well', 'water_works', 'boiler', 'power_plant', 'station']);
const NONE = new Set(['wall', 'pole', 'gate', 'torch']);

export function entranceKind(def) {
  if (!def || def.line || NONE.has(def.id)) return null;
  return OPEN.has(def.id) ? 'open' : 'door';
}

// La fachada: el +z local de un edificio con esa orientación, como una dirección cardinal (x, z) en el campamento.
export function facingOf(yaw) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return Math.abs(fx) > Math.abs(fz) ? { x: Math.sign(fx), z: 0 } : { x: 0, z: Math.sign(fz) || 1 };
}

export const rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });

// La huella de un edificio (null para los muros, que van por tramos redondos).
export function footprintRect(def, x, z) {
  if (def.line) return null;
  const h = halfFor(def);
  return rect(x - h, x + h, z - h, z + h);
}

// Entrada de un edificio puesto en (x, z) con esa orientación:
//   kind      'door' | 'open'
//   normal    hacia dónde mira (cardinal)
//   door      centro de la fachada, sobre el borde de la huella
//   approach  dónde espera quien llega (un poco afuera de la puerta)
//   zone      franja de acceso reservada (rectángulo alineado con los ejes)
// o null si no tiene.
export function entranceOf(def, x, z, yaw) {
  const kind = entranceKind(def);
  if (!kind) return null;
  const h = halfOf(def.footprint);
  const n = facingOf(yaw);
  const width = Math.min(h * 2, Math.max(MIN_ACCESS_WIDTH, kind === 'door' ? 2.8 : 3.2));
  const w2 = width / 2;
  const door = { x: x + n.x * h, z: z + n.z * h };
  const approach = { x: x + n.x * (h + APPROACH), z: z + n.z * (h + APPROACH) };
  let zone;
  if (n.z !== 0) zone = n.z > 0 ? rect(x - w2, x + w2, z + h, z + h + ACCESS_DEPTH) : rect(x - w2, x + w2, z - h - ACCESS_DEPTH, z - h);
  else zone = n.x > 0 ? rect(x + h, x + h + ACCESS_DEPTH, z - w2, z + w2) : rect(x - h - ACCESS_DEPTH, x - h, z - w2, z + w2);
  return { kind, normal: n, door, approach, zone, width };
}

export const rectsOverlap = (a, b) => a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.z0 < b.z1 - 1e-6 && a.z1 > b.z0 + 1e-6;
export const pointInRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
export function circleHitsRect(r, cx, cz, rad) {
  const nx = Math.max(r.x0, Math.min(cx, r.x1));
  const nz = Math.max(r.z0, Math.min(cz, r.z1));
  return (cx - nx) ** 2 + (cz - nz) ** 2 < rad * rad;
}

// ¿Qué impide poner "def" en (x, z, yaw)? Devuelve el texto del problema o null.
//   others   los demás edificios: [{ def, x, z, name, entrance }]
//   props    objetos fijos redondos del campamento: [{ x, z, r }]
// Se mira en los dos sentidos: que nada tape su entrada y que él no tape la de otro.
export function accessProblem(def, x, z, yaw, others, props = []) {
  const mine = footprintRect(def, x, z);
  const entrance = entranceOf(def, x, z, yaw);
  for (const o of others) {
    const theirs = o.def.line ? null : footprintRect(o.def, o.x, o.z);
    if (entrance) {
      if (theirs && rectsOverlap(entrance.zone, theirs)) return 'La entrada necesita espacio libre';
      if (!theirs && circleHitsRect(entrance.zone, o.x, o.z, o.def.footprint)) return 'La entrada necesita espacio libre';
    }
    const oe = o.entrance ?? entranceOf(o.def, o.x, o.z, o.yaw ?? 0);
    if (oe) {
      if (mine && rectsOverlap(oe.zone, mine)) return `Bloquea la entrada de ${o.name}`;
      if (!mine && circleHitsRect(oe.zone, x, z, def.footprint)) return `Bloquea la entrada de ${o.name}`;
    }
  }
  if (entrance) for (const p of props) if (circleHitsRect(entrance.zone, p.x, p.z, p.r)) return 'La entrada necesita espacio libre';
  return null;
}

// Radio (en metros, desde el centro) dentro del cual el mundo no dibuja recursos naturales alrededor de un
// edificio. Cubre la huella y su franja de acceso, así nada crece en la entrada. Lo usan el terreno (que despeja)
// y la simulación (que decide qué recurso es recolectable): tienen que coincidir o reaparece el "recurso invisible".
export function resourceClearOf(def) {
  if (def.line) return def.footprint + 0.5;
  if (def.small) return def.footprint + 1; // un adorno no despeja el monte a su alrededor
  const e = entranceOf(def, 0, 0, 0);
  const far = e ? Math.hypot(halfOf(def.footprint) + ACCESS_DEPTH, e.width / 2) : halfOf(def.footprint) * 1.42;
  return Math.max(def.footprint + 3, far + 0.5);
}

// Redondea una orientación al cuarto de vuelta más cercano.
export const cardinalYaw = (yaw) => Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
