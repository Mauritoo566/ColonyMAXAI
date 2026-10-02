// Ejército y defensas: reclutamiento desde la población civil, equipo, mantenimiento diario,
// mejoras de soldados, capacidad militar (soldados + defensas) e incursiones abstractas.
// Reglas: recluta quien trabaja o está libre (deja su puesto), cada edificio militar tiene su
// guarnición, el ejército no pasa del 40 % de los adultos y todo cuesta equipo, recursos y
// mantenimiento. Las incursiones sólo ocurren con el dueño conectado, tras unos días de
// protección, y nunca destruyen edificios ni dañan colonos: como mucho se pierden recursos.

import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { levelOf } from './buildingTypes.js';
import { GOOD_NAMES } from './goods.js';
import { UNITS, UNITS_BY_ID, upgradeOf, matchup } from './units.js';
import { addLog, addMoodEvent } from '../needs.js';

const DAY = DAY_LENGTH_SECONDS;
const name = (k) => GOOD_NAMES[k] ?? k;
export const ARMY_SHARE = 0.4; // máximo de adultos que pueden estar en el ejército
export const RAID_PROTECTION_DAYS = 6; // sin incursiones los primeros días ni en la edad I

export const soldiers = (colony) => colony.colonists.filter((c) => c.soldier);

// Plazas de un grupo de edificios militares (cuarteles, campos de tiro...) y las ocupadas.
export function poolCapacity(colony, pool) {
  let n = 0;
  for (const b of colony.buildings) {
    if (!b.done) continue;
    const lv = levelOf(b);
    if (b.def.id === pool && lv.garrison) n += lv.garrison;
    else if (pool === 'barracks' && b.def.id === 'fort') n += lv.garrison ?? 0; // los fuertes alojan infantería
  }
  return n;
}

export const poolUsed = (colony, pool) => soldiers(colony).filter((c) => UNITS_BY_ID[c.soldier.unit]?.pool === pool).length;

// Máximo de soldados que admite la población (no se vacía la aldea de trabajadores).
export function armyCap(colony) {
  const adults = colony.colonists.filter((c) => (c.growth ?? 1) >= 1).length;
  return Math.floor(adults * ARMY_SHARE);
}

const lacking = (colony, cost) => Object.entries(cost).filter(([k, n]) => (colony.stock[k] ?? 0) < n);
const lackText = (colony, cost) => lacking(colony, cost).map(([k, n]) => `${Math.ceil(n - (colony.stock[k] ?? 0))} de ${name(k)}`).join(' y ');

// Por qué no se puede reclutar una unidad (texto o null).
export function recruitProblem(colony, unitId) {
  const u = UNITS_BY_ID[unitId];
  if (!u) return 'Unidad desconocida';
  if (u.age > colony.age) return 'Todavía no existe en esta edad';
  if (u.tech && !colony.techs.has(u.tech)) return 'Falta la tecnología necesaria';
  if (poolCapacity(colony, u.pool) <= 0) return 'Hace falta construir su edificio militar';
  if (poolUsed(colony, u.pool) >= poolCapacity(colony, u.pool)) return 'No quedan plazas en su cuartel: construye o mejora edificios militares';
  const count = soldiers(colony).length;
  if (count >= armyCap(colony)) return `El ejército no puede pasar del ${Math.round(ARMY_SHARE * 100)} % de los adultos (${armyCap(colony)})`;
  const cost = { ...u.cost, [u.arms]: 1 };
  if (lacking(colony, cost).length) return `Faltan ${lackText(colony, cost)}`;
  if (!candidate(colony)) return 'No hay colonos adultos disponibles';
  return null;
}

// A quién se recluta: un adulto libre y, si no hay, el menos hábil de los que trabajan.
function candidate(colony) {
  const adults = colony.colonists.filter((c) => (c.growth ?? 1) >= 1 && !c.soldier && !c.pregnant);
  const free = adults.filter((c) => !c.job);
  if (free.length) return free.sort((a, b) => b.id - a.id)[0];
  return adults.sort((a, b) => colony.skillOf(a, a.job.def.skill) - colony.skillOf(b, b.job.def.skill))[0] ?? null;
}

export function recruit(colony, unitId) {
  if (recruitProblem(colony, unitId)) return null;
  const u = UNITS_BY_ID[unitId];
  const c = candidate(colony);
  for (const [k, n] of Object.entries({ ...u.cost, [u.arms]: 1 })) colony.takeStock(k, n);
  if (c.job) colony.releaseWorker(c.job, c);
  c.soldier = { unit: u.id, tier: u.age };
  c.task = null;
  addLog(c, colony.timeLabel(), `Se alistó como ${u.name.toLowerCase()}`);
  colony.emit('notice', `${c.name} se alistó como ${u.name.toLowerCase()}`);
  colony.emit('changed');
  colony.emit('army');
  return c;
}

// Licenciar: vuelve a ser civil y devuelve su equipo al almacén.
export function dismiss(colony, c) {
  if (!c?.soldier) return false;
  const u = UNITS_BY_ID[c.soldier.unit];
  if (u) colony.addStock(u.arms, 1);
  c.soldier = null;
  c.task = null;
  addLog(c, colony.timeLabel(), 'Dejó el ejército');
  colony.emit('changed');
  colony.emit('army');
  return true;
}

export function soldierUpgradeProblem(colony, c) {
  if (!c?.soldier) return 'No es soldado';
  const next = upgradeOf(UNITS_BY_ID[c.soldier.unit]);
  if (!next) return 'Ya es la unidad más avanzada de su línea';
  if (next.age > colony.age) return `Disponible en la edad ${next.age}`;
  if (next.tech && !colony.techs.has(next.tech)) return 'Falta la tecnología necesaria';
  if (poolCapacity(colony, next.pool) <= 0) return 'Hace falta el edificio militar de esa unidad';
  const cost = { ...next.cost, [next.arms]: 1 };
  if (lacking(colony, cost).length) return `Faltan ${lackText(colony, cost)}`;
  return null;
}

// Modernizar a un soldado cuesta lo mismo que reclutar la unidad siguiente.
export function upgradeSoldier(colony, c) {
  if (soldierUpgradeProblem(colony, c)) return false;
  const next = upgradeOf(UNITS_BY_ID[c.soldier.unit]);
  for (const [k, n] of Object.entries({ ...next.cost, [next.arms]: 1 })) colony.takeStock(k, n);
  c.soldier = { unit: next.id, tier: next.age };
  addLog(c, colony.timeLabel(), `Fue instruido como ${next.name.toLowerCase()}`);
  colony.emit('changed');
  colony.emit('army');
  return true;
}

// Mantenimiento por día de todo el ejército.
export function upkeepPerDay(colony) {
  const total = {};
  for (const c of soldiers(colony)) {
    for (const [k, n] of Object.entries(UNITS_BY_ID[c.soldier.unit]?.upkeep ?? {})) total[k] = (total[k] ?? 0) + n;
  }
  return total;
}

// Una vez al día: se paga el mantenimiento; si falta algo, las tropas rinden la mitad.
export function payUpkeep(colony) {
  const cost = upkeepPerDay(colony);
  if (!Object.keys(cost).length) {
    colony.armyUnpaid = false;
    return;
  }
  if (lacking(colony, cost).length) {
    if (!colony.armyUnpaid) colony.emit('notice', `Las tropas no cobran su mantenimiento (faltan ${lackText(colony, cost)}): rinden la mitad`);
    colony.armyUnpaid = true;
    return;
  }
  for (const [k, n] of Object.entries(cost)) colony.takeStock(k, n);
  colony.armyUnpaid = false;
}

export function defensePoints(colony) {
  let n = 0;
  for (const b of colony.buildings) {
    if (!b.done || b.def.category !== 'defense') continue;
    const lv = levelOf(b);
    if (lv.energy && !(b.pf > 0)) continue; // las defensas con energía sólo valen conectadas
    n += lv.defense ?? 0;
  }
  return n;
}

// Capacidad militar: lo que aportan las tropas (según su equipo y si cobran) más las defensas.
export function militaryPower(colony, enemyRole = null) {
  const factor = colony.armyUnpaid ? 0.5 : 1;
  let troops = 0;
  for (const c of soldiers(colony)) {
    const u = UNITS_BY_ID[c.soldier.unit];
    if (u) troops += u.power * (enemyRole ? matchup(u.role, enemyRole) : 1);
  }
  return { troops: Math.round(troops * factor), defense: defensePoints(colony), total: Math.round(troops * factor + defensePoints(colony)) };
}

// ---- Incursiones (abstractas, sin destrucción) ----------------------------------------------

export function raidKinds(age) {
  const kinds = ['infantry'];
  if (age >= 4) kinds.push('ranged');
  if (age >= 6) kinds.push('cavalry');
  return kinds;
}

// Una vez al día: si toca, llega una incursión y se resuelve al instante.
export function dailyRaid(colony, day) {
  if (colony.absent || colony.age < 3 || day < RAID_PROTECTION_DAYS) return;
  if (colony.nextRaidDay == null) colony.nextRaidDay = day + 3 + Math.floor(colony.birthRand() * 3);
  if (day < colony.nextRaidDay) return;
  colony.nextRaidDay = day + 3 + Math.floor(colony.birthRand() * 3);
  const kinds = raidKinds(colony.age);
  const kind = kinds[Math.floor(colony.birthRand() * kinds.length)];
  const strength = Math.round((6 + colony.colonists.length * 0.9 + colony.age * 6) * (0.7 + colony.birthRand() * 0.6));
  const mine = militaryPower(colony, kind).total;
  const label = { infantry: 'infantería', ranged: 'tiradores', cavalry: 'jinetes' }[kind];
  if (mine >= strength * 1.5) {
    colony.emit('notice', `Una banda de ${label} (fuerza ${strength}) vio las defensas y se retiró`);
  } else if (mine >= strength) {
    colony.emit('notice', `Rechazaron una incursión de ${label} (fuerza ${strength} contra ${mine})`);
  } else {
    const share = Math.min(0.1, ((strength - mine) / strength) * 0.15);
    const lost = [];
    for (const k of ['food', 'wood', 'stone', 'coin']) {
      const n = Math.floor((colony.stock[k] ?? 0) * share);
      if (n > 0) {
        colony.takeStock(k, n);
        lost.push(`${n} de ${name(k)}`);
      }
    }
    for (const c of colony.colonists) addMoodEvent(c, 'raid', -8, colony.gameTime);
    colony.emit('notice', `Una banda de ${label} (fuerza ${strength}) saqueó la aldea: ${lost.join(', ') || 'se llevaron poco'}. Refuerza el ejército y las defensas`);
  }
  colony.emit('changed');
}

export function armyReport(colony) {
  const by = new Map();
  for (const c of soldiers(colony)) by.set(c.soldier.unit, (by.get(c.soldier.unit) ?? 0) + 1);
  const pools = ['barracks', 'archery', 'stable', 'siege_shop', 'motor_pool'].map((pool) => ({ pool, cap: poolCapacity(colony, pool), used: poolUsed(colony, pool) })).filter((p) => p.cap > 0);
  return { units: [...by].map(([id, n]) => ({ id, n })), pools, cap: armyCap(colony), count: soldiers(colony).length, upkeep: upkeepPerDay(colony), unpaid: !!colony.armyUnpaid, power: militaryPower(colony), recruitable: UNITS.filter((u) => u.age <= colony.age) };
}
