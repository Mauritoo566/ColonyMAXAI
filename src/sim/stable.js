// Establo y domesticación de caballos (datos y cuentas, sin Three.js; la simulación y las pruebas lo usan igual).
// El jugador elige un caballo salvaje y paga manzanas del almacén (se gastan al dar la orden); algún colono libre va, lo doma y el caballo
// queda esperando en el establo, en un hueco junto al edificio, hasta que se decida para qué sirve (montura de guerra o caballo de carga).
//   mob.order   { by }  la orden está dada: el caballo se queda quieto esperando a que llegue un colono (by = colono que va)
//   mob.tamed   true    ya es del jugador
//   mob.stableId        edificio en el que tiene su hueco · mob.stall { x, z } su hueco
import { levelOf } from './buildingTypes.js';

export const TAME_COST = 3; // manzanas por caballo
export const TAME_SECONDS = 6; // lo que tarda un colono en ganarse a un caballo
export const TAME_GOOD = 'apple';
const STALL_SPACING = 2.3; // metros entre un hueco y otro

export const isHorse = (m) => m?.type === 'caballo';
// En el servidor el animal lleva tamed/order; en el navegador sólo llega m.tame (0 salvaje, 1 domesticado, 2 esperando al colono).
export const isTamed = (m) => !!m.tamed || m.tame === 1 || m.tame === 3; // 3: domesticado y dentro del establo
export const isOrdered = (m) => !!m.order || m.tame === 2;
export const stables = (colony) => colony.buildings.filter((b) => b.def.kind === 'stable' && b.done && !b.removed);
export const stallCap = (b) => levelOf(b)?.stalls ?? 0;
const stored = (colony, b) => colony.mobs.filter((m) => m.stableId === b.id && (isTamed(m) || isOrdered(m))).length;

// Un establo con sitio libre (el que tenga más), o null.
export function stableWithRoom(colony) {
  let best = null;
  let room = 0;
  for (const b of stables(colony)) {
    const free = stallCap(b) - stored(colony, b);
    if (free > room) {
      best = b;
      room = free;
    }
  }
  return best;
}

export function stallsFree(colony) {
  const used = colony.mobs.filter((m) => isTamed(m) || isOrdered(m)).length;
  return Math.max(0, stables(colony).reduce((n, b) => n + stallCap(b), 0) - used);
}

// Por qué no se puede domesticar este caballo ahora (null = se puede).
export function tameProblem(colony, m) {
  if (!isHorse(m)) return 'Sólo se pueden domesticar los caballos';
  if (isTamed(m)) return 'Ya está domesticado';
  if (isOrdered(m)) return 'Ya hay un colono yendo a domesticarlo';
  if (!stables(colony).length) return 'Hace falta un establo';
  if (stallsFree(colony) <= 0) return 'El establo está lleno';
  if ((colony.stock[TAME_GOOD] ?? 0) < TAME_COST) return `Faltan manzanas (hacen falta ${TAME_COST})`;
  return null;
}

// Cuántos caballos de la manada del dado se pueden domesticar ahora con lo que hay (manzanas y huecos).
export function herdOf(colony, m) {
  return colony.mobs.filter((o) => isHorse(o) && !isTamed(o) && !isOrdered(o) && (m.g == null || o.g === m.g));
}

export function affordable(colony, count) {
  return Math.max(0, Math.min(count, Math.floor((colony.stock[TAME_GOOD] ?? 0) / TAME_COST), stallsFree(colony)));
}

// Un sitio en el patio del establo para el caballo n-ésimo: junto al edificio y libre de obstáculos (null si no cabe ninguno).
function stallSpot(colony, b, index) {
  const r = (b.def.footprint ?? 3) + 1.7; // el obstáculo del edificio mide su "footprint" de radio
  for (let k = 0; k < 24; k++) {
    const a = (index + k * 0.5) * (STALL_SPACING / r) + (b.yaw ?? 0) + 0.6;
    const x = b.x + Math.cos(a) * r;
    const z = b.z + Math.sin(a) * r;
    if (colony.walkable(x, z, 0.7) && !colony.accessBlocked?.(x, z) && !colony.nearRoad(x, z, 0.4)) return { x, z };
  }
  return null;
}

// El jugador da la orden: se gastan las manzanas y el caballo espera. Devuelve null si se pudo, o el motivo.
export function orderTame(colony, m) {
  const problem = tameProblem(colony, m);
  if (problem) return problem;
  const b = stableWithRoom(colony);
  const taken = new Set(colony.mobs.filter((o) => o.stableId === b.id && o.stall).map((o) => `${o.stall.x},${o.stall.z}`));
  let stall = null;
  for (let i = 0; i < stallCap(b) + 6 && !stall; i++) {
    const s = stallSpot(colony, b, i);
    if (s && !taken.has(`${s.x},${s.z}`)) stall = s;
  }
  if (!stall) return 'No hay sitio libre junto al establo';
  colony.takeStock(TAME_GOOD, TAME_COST);
  m.order = { by: null };
  m.stableId = b.id;
  m.stall = stall;
  m.state = 0;
  m.opath = null;
  colony.emit('changed');
  return null;
}

// Un colono libre cerca de un caballo que espera: el más próximo sin reservar (o el que ya lo tiene reservado).
export function pendingTame(colony, c) {
  let best = null;
  let bd = Infinity;
  for (const m of colony.mobs) {
    if (!m.order || m.tamed || (m.order.by != null && m.order.by !== c.id)) continue;
    const d = Math.hypot(m.x - c.x, m.z - c.z);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

// El colono termina: el caballo es del jugador y va a su hueco del establo.
export function finishTame(colony, m, c) {
  if (!m.order) return false;
  m.order = null;
  m.tamed = true;
  m.role = null; // todavía sin función: espera a que se elija en la armería
  m.tx = m.stall?.x ?? m.x;
  m.tz = m.stall?.z ?? m.z;
  m.state = 1;
  m.opath = null;
  colony.emit('notice', `${c.name} domesticó un caballo: espera en el establo`);
  colony.emit('changed');
  return true;
}

// Si el establo desaparece, lo pendiente se devuelve (manzanas) y lo domesticado vuelve a ser salvaje. Se llama por animal en cada paso.
export function checkStable(colony, m) {
  if (!m.order && !m.tamed) return;
  const b = colony.building(m.stableId);
  if (b && b.done && !b.removed) return;
  if (m.order) colony.produce(TAME_GOOD, TAME_COST);
  m.order = null;
  m.tamed = false;
  m.stableId = null;
  m.stall = null;
  m.role = null;
  m.state = 0;
  m.inside = false;
  m.rider = null;
}

export function serializeTamed(mobs) {
  return mobs
    .filter((m) => m.tamed || m.order)
    .map((m) => ({ id: m.id, tamed: !!m.tamed, stableId: m.stableId ?? null, stall: m.stall ?? null, role: m.role ?? null, x: Math.round(m.x * 100) / 100, z: Math.round(m.z * 100) / 100 }));
}

// Los caballos que llegaron después de crear el mundo no salen de la semilla: los domesticados (o con orden) se guardan enteros y se recrean.
export function restoreTamed(mobs, saved) {
  if (!Array.isArray(saved)) return;
  for (const s of saved) {
    if (!s || !Number.isInteger(s.id) || !Number.isFinite(s.stableId)) continue;
    let m = mobs.find((o) => o.id === s.id);
    if (m && !isHorse(m)) m = null;
    if (!m) {
      const id = mobs.some((o) => o.id === s.id) ? mobs.reduce((n, o) => Math.max(n, o.id + 1), 0) : s.id;
      m = { id, type: 'caballo', x: s.x ?? 0, z: s.z ?? 0, facing: 0, state: 0, wait: 2, tx: s.x ?? 0, tz: s.z ?? 0, cd: 0, target: null, g: null, leader: false, ox: 0, oz: 0 };
      mobs.push(m);
    }
    m.stableId = s.stableId;
    m.stall = s.stall && Number.isFinite(s.stall.x) && Number.isFinite(s.stall.z) ? { x: s.stall.x, z: s.stall.z } : null;
    if (s.tamed) {
      m.tamed = true;
      m.role = s.role ?? null;
    } else m.order = { by: null };
    if (Number.isFinite(s.x) && Number.isFinite(s.z)) {
      m.x = s.x;
      m.z = s.z;
    }
  }
}
