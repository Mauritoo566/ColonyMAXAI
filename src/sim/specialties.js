// Especialidades de los colonos: cada trabajador adulto tiene TRES categorías de trabajo con prioridad
// (primera, segunda, tercera). Sólo acepta solo los trabajos de esas categorías; las demás habilidades
// conservan su nivel. La orden directa del jugador es una excepción temporal. Es parte del planificador
// existente (ai.js): aquí están los datos y las cuentas puras que usa.

import { SKILLS, completeSkill } from '../needs.js';

export const SPEC_IDS = SKILLS.map((s) => s.id);
export const SPEC_NAMES = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));
export const WORK_TYPES = new Set(['build', 'work', 'harvest']);

export const validSpec = (list) => Array.isArray(list) && list.length === 3 && new Set(list).size === 3 && list.every((id) => SPEC_IDS.includes(id));
export const isWorker = (c) => (c.growth ?? 1) >= 1 && !c.soldier;

// Categoría de trabajo de un sitio natural: la comida y los palos caídos son Recolección; talar un árbol,
// Tala; las piedras sueltas son Recolección hasta la Edad de Piedra y Cantería después.
export function spotCategory(spot, age = 1) {
  if (spot.kind === 'food' || spot.stick) return 'gathering';
  if (spot.kind === 'wood') return 'woodcutting';
  return age >= 2 ? 'mining' : 'gathering';
}

// Categorías con trabajo posible ahora (para repartir las especialidades por defecto).
function usefulNow(colony) {
  const set = new Set(['gathering', 'building', 'hauling']);
  for (const b of colony.buildings) if (b.def.skill) set.add(b.def.skill);
  if (colony.age >= 2) {
    set.add('woodcutting');
    set.add('mining');
  }
  return set;
}

// Tres especialidades razonables: la de su puesto actual, y luego las más útiles según su habilidad.
export function defaultSpec(colony, c) {
  const useful = usefulNow(colony);
  const score = (id) => completeSkill(c, id) + (useful.has(id) ? 20 : 0) + (c.job?.def?.skill === id ? 100 : 0) + (id === 'building' ? 0.5 : 0);
  return [...SPEC_IDS].sort((a, b) => score(b) - score(a) || SPEC_IDS.indexOf(a) - SPEC_IDS.indexOf(b)).slice(0, 3);
}

// Las especialidades de un colono (si aún no tiene, se le asignan las razonables una sola vez).
export function specOf(colony, c) {
  if (!validSpec(c.spec)) c.spec = defaultSpec(colony, c);
  return c.spec;
}

// Reparto inicial de los cinco de Primitiva: sólo categorías con trabajo real (recolección, construcción,
// acarreo de agua). Dos constructores, dos recolectores y un aguatero, cada uno con sus tres.
export function primitiveSplit(colony) {
  const adults = colony.colonists.filter(isWorker);
  const by = (id) => (a, b) => completeSkill(b, id) - completeSkill(a, id);
  const pool = [...adults];
  const take = (id) => pool.sort(by(id)).shift();
  const plan = [];
  const b1 = take('building');
  const b2 = take('building');
  const h = take('hauling');
  const g1 = take('gathering');
  const g2 = take('gathering');
  if (b1) plan.push([b1, ['building', 'gathering', 'hauling']]);
  if (b2) plan.push([b2, ['building', 'gathering', 'hauling']]);
  if (h) plan.push([h, ['hauling', 'gathering', 'building']]);
  if (g1) plan.push([g1, ['gathering', 'building', 'hauling']]);
  if (g2) plan.push([g2, ['gathering', 'hauling', 'building']]);
  for (const [c, spec] of plan) c.spec = spec;
  return plan.map(([c, spec]) => ({ name: c.name, spec }));
}

// Partidas antiguas: una sola vez a cada colono adulto sin especialidades.
export function migrateSpecs(colony) {
  let n = 0;
  for (const c of colony.colonists) {
    if (!isWorker(c) || validSpec(c.spec)) continue;
    c.spec = defaultSpec(colony, c);
    n++;
  }
  return n;
}

// Texto de por qué no encuentra trabajo en una categoría (o null si hay).
function blocker(colony, c, cat) {
  const name = SPEC_NAMES[cat];
  if (cat === 'building') {
    const sites = colony.buildings.filter((b) => !b.done && !b.paused);
    if (!sites.length) return `${name}: no hay obras`;
    return `${name}: las obras ya tienen sus constructores`;
  }
  const posts = colony.buildings.filter((b) => b.done && b.def.skill === cat);
  const marked = colony.spots.some((s) => s.marked && !s.gone && spotCategory(s, colony.age) === cat && colony.usable(s));
  if (!posts.length && !marked) return `${name}: no hay puestos ni recursos marcados`;
  const open = posts.filter((b) => b.workers.length < Math.max(1, colony.crewNeeded(b)));
  if (!open.length && !marked) return `${name}: los puestos están completos`;
  const sick = posts.find((b) => b.status && /Faltan materiales|almac[eé]n est[aá] lleno|Sin energ/i.test(b.status));
  if (sick) return `${name}: ${sick.status.charAt(0).toLowerCase()}${sick.status.slice(1)}`;
  return null;
}

// Por qué espera: la causa de su primera especialidad que no tiene trabajo.
export function waitReason(colony, c) {
  if (!isWorker(c)) return null;
  const reasons = specOf(colony, c).map((cat) => blocker(colony, c, cat)).filter(Boolean);
  return reasons.length ? reasons[0] : 'Sin tareas de sus especialidades';
}

// Cobertura: cuántos tienen cada categoría y si hay trabajo esencial que nadie puede atender.
export function coverage(colony) {
  const workers = colony.colonists.filter(isWorker);
  const rows = SPEC_IDS.map((id) => ({ id, name: SPEC_NAMES[id], first: 0, any: 0 }));
  for (const c of workers) specOf(colony, c).forEach((id, i) => {
    const r = rows.find((x) => x.id === id);
    r.any++;
    if (i === 0) r.first++;
  });
  const gaps = [];
  const has = (id) => rows.find((r) => r.id === id).any > 0;
  if (colony.buildings.some((b) => !b.done && !b.paused) && !has('building')) gaps.push('Hay obras y nadie tiene Construcción');
  for (const b of colony.buildings) if (b.done && b.def.skill && colony.crewNeeded(b) > 0 && !has(b.def.skill)) gaps.push(`${b.name}: nadie tiene ${SPEC_NAMES[b.def.skill]}`);
  const markedCats = new Set(colony.spots.filter((s) => s.marked && !s.gone && colony.usable(s)).map((s) => spotCategory(s, colony.age)));
  for (const cat of markedCats) if (!has(cat)) gaps.push(`Hay recursos marcados de ${SPEC_NAMES[cat]} y nadie tiene esa especialidad`);
  return { rows: rows.filter((r) => r.any > 0), gaps: [...new Set(gaps)], workers: workers.length };
}
