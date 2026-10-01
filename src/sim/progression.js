// Reglas de progresión por edades: lo que se puede construir, mejorar, alojar y ocupar en
// cada edad. Datos y funciones puras (sin Three.js ni DOM): las usan la simulación (y por
// tanto el servidor, que es quien decide), la interfaz y las pruebas, así que construir,
// mejorar y crecer comparten los mismos requisitos. La edad es necesaria pero no
// suficiente: además hacen falta los costes, los edificios previos, las tecnologías y las
// condiciones de cada cosa. Nada de aquí se salta recibiendo recursos de fuera: se comprueba
// el estado de la colonia (edificios terminados, nivel, tecnologías, edad), no lo que hay
// en el almacén.

import { AGES, ageInfo, MAX_AGE, AGE_HOOKS } from '../ages.js';
import { BUILDING_TYPES, BUILDINGS, levelOf } from './buildingTypes.js';
import { GOOD_NAMES } from './goods.js';
import { TECHS_BY_ID } from './techs.js';
import { DAY_LENGTH_SECONDS } from '../daynight.js';

// ---- Qué está implementado -------------------------------------------------------------------
// Lo que todavía no funciona no se ofrece ni se puede construir. Cada fase añade sus funciones.
export const FEATURES = new Set(['gather', 'storage', 'house', 'well', 'crew', 'process', 'power', 'energy', 'deposit', 'drop', 'market', 'admin', 'research', 'tech', 'service', 'military', 'defense']);

const KIND_FEATURE = { undefined: 'gather', process: 'process', power: 'power', node: 'power', drop: 'drop', market: 'market', admin: 'admin', research: 'research', service: 'service', military: 'military', defense: 'defense' };

function kindImplemented(def) {
  const feature = def.id === 'stockpile' ? 'storage' : def.id === 'house' || def.id === 'apartment' ? 'house' : def.id === 'well' ? 'well' : KIND_FEATURE[def.kind];
  if (!FEATURES.has(feature)) return false;
  if (def.deposit && !FEATURES.has('deposit')) return false;
  if (def.tech && !FEATURES.has('tech')) return false;
  return true;
}

// Un coste se puede pagar en el juego si todos sus bienes se pueden conseguir.
const payable = (cost) => Object.keys(cost ?? {}).every((g) => goodProducible(g));

// Un tipo está disponible si su función existe y puede pagarse y construirse de verdad.
export function defImplemented(def) {
  if (!kindImplemented(def)) return false;
  if (!payable(def.levels[0].buildCost ?? def.cost)) return false;
  return (def.requires ?? []).every((r) => BUILDINGS[r.id] && kindImplemented(BUILDINGS[r.id]));
}

// Un nivel necesita, además, energía o tecnologías si los usa, y sus propios requisitos.
export function levelImplemented(def, lv) {
  if (lv.energy && !FEATURES.has('energy')) return false;
  if (lv.tech && !FEATURES.has('tech')) return false;
  if ((lv.workers ?? def.workers) > 1 && !FEATURES.has('crew')) return false;
  if (!payable(lv.upgradeCost) || !payable(lv.buildCost)) return false;
  return (lv.requires ?? []).every((r) => BUILDINGS[r.id] && kindImplemented(BUILDINGS[r.id]));
}

// ---- Límites por edad (la fila de la edad N está en la posición N - 1) --------------------------
//   radius      metros de territorio desde la fogata (base; se amplía pagando, ver `expansions`)
//   expansions  ampliaciones de territorio que permite la edad (cada una suma EXPANSION_STEP m)
//   houses      viviendas a la vez · apartments: bloques residenciales
//   perType     edificios de cada tipo de producción o taller
//   popCap      techo de población de la edad (rendimiento y equilibrio)
export const LIMITS = [
  { radius: 75, expansions: 0, houses: 3, apartments: 0, perType: 2, popCap: 14 },
  { radius: 85, expansions: 1, houses: 6, apartments: 0, perType: 3, popCap: 22 },
  { radius: 95, expansions: 2, houses: 9, apartments: 0, perType: 4, popCap: 32 },
  { radius: 110, expansions: 2, houses: 13, apartments: 0, perType: 5, popCap: 42 },
  { radius: 125, expansions: 3, houses: 17, apartments: 0, perType: 6, popCap: 54 },
  { radius: 140, expansions: 4, houses: 22, apartments: 0, perType: 8, popCap: 68 },
  { radius: 155, expansions: 5, houses: 27, apartments: 0, perType: 10, popCap: 82 },
  { radius: 170, expansions: 6, houses: 33, apartments: 4, perType: 12, popCap: 96 },
  { radius: 185, expansions: 6, houses: 39, apartments: 8, perType: 14, popCap: 108 },
  { radius: 200, expansions: 6, houses: 46, apartments: 12, perType: 16, popCap: 120 },
];

export const EXPANSION_STEP = 12; // metros de radio por ampliación
export const BASE_POPULATION = 10; // lo que admite el campamento solo

export const limitsFor = (age) => LIMITS[Math.min(LIMITS.length, Math.max(1, age)) - 1];

// Factor del tope por tipo de edificio (las defensas largas, los postes y los pozos son distintos).
const CAP_SCALE = { well: 0.5, farm: 1.5, stockpile: 1.5, wall: 12, pole: 8, watchtower: 3, gate: 2, fort: 0.5, barracks: 1, hospital: 0.5, school: 0.5, market: 0.5, admin: 0.5, academy: 0.5, power_plant: 0.5, boiler: 1, station: 0.5 };

export function capOf(def, age) {
  const l = limitsFor(age);
  if (def.id === 'house') return l.houses;
  if (def.id === 'apartment') return l.apartments;
  return Math.max(1, Math.floor(l.perType * (CAP_SCALE[def.id] ?? 1)));
}

// ---- Niveles ---------------------------------------------------------------------------------

// Nivel más alto de un tipo que permite una edad (los niveles están ordenados por edad).
export function maxLevelFor(def, age) {
  let n = 0;
  for (let i = 0; i < def.levels.length; i++) if (def.levels[i].age <= age && levelImplemented(def, def.levels[i])) n = i + 1;
  return Math.max(n, def.levels[0].age <= age ? 1 : 0);
}

// Edad mínima de un tipo para construirse.
export const minAgeOf = (def) => def.levels[0].age;

// Las viviendas se construyen ya con el aspecto de la edad actual (y evolucionan solas).
export const buildLevelFor = (def, age) => (def.autoLevel ? Math.max(1, maxLevelFor(def, age)) : 1);

// Coste de construir un tipo en la edad dada (la vivienda de una edad avanzada cuesta más).
export function buildCostOf(def, age) {
  return def.levels[buildLevelFor(def, age) - 1].buildCost ?? def.cost;
}

export function countOf(colony, id) {
  let n = 0;
  for (const b of colony.buildings) if (b.def.id === id) n++;
  return n;
}

// Primera edad posterior a "current" en la que sube el tope (para decir cuándo se amplía).
function nextRaise(current, valueAt) {
  for (let n = current + 1; n <= MAX_AGE; n++) if (valueAt(n) > valueAt(current)) return ageInfo(n);
  return null;
}

const typeName = (id) => BUILDINGS[id]?.name ?? id;

// Requisitos de edificios previos: [{ id, level? }] -> textos de lo que falta.
function missingBuildings(colony, requires = []) {
  const out = [];
  for (const r of requires) {
    const ok = colony.buildings.some((b) => b.def.id === r.id && b.done && b.level >= (r.level ?? 1));
    if (!ok) out.push(r.level > 1 ? `un edificio ${typeName(r.id)} de nivel ${r.level} terminado` : `un edificio ${typeName(r.id)} terminado`);
  }
  return out;
}

const needs = (list) => `Necesitas ${list.join(' y ')}`;
const techNeeded = (colony, tech) => (tech && !colony.techs?.has?.(tech) ? `la tecnología ${TECHS_BY_ID[tech]?.name ?? tech}` : null);

// Por qué no se puede construir un tipo (sin contar el lugar ni los recursos): texto o null.
export function buildBlocker(colony, def) {
  const age = colony.age;
  if (!defImplemented(def)) return 'Todavía no está disponible en el juego';
  if (minAgeOf(def) > age) return `Disponible en la ${ageInfo(minAgeOf(def)).name}`;
  const missing = missingBuildings(colony, def.requires);
  const tech = techNeeded(colony, def.tech ?? def.levels[0].tech);
  if (tech) missing.push(tech);
  if (missing.length) return needs(missing);
  const cap = capOf(def, age);
  if (countOf(colony, def.id) >= cap) {
    const raise = nextRaise(age, (n) => capOf(def, n));
    return `Límite de la ${ageInfo(age).name}: ${cap}${raise ? ` (sube en la ${raise.name})` : ''}`;
  }
  return null;
}

// Por qué no se puede mejorar un edificio al nivel siguiente (sin contar el coste): texto o null.
export function upgradeBlocker(colony, b) {
  const next = levelOf(b, 1);
  if (b.def.autoLevel) return 'Evoluciona sola al avanzar de edad';
  if (!b.done) return b.upgrading ? 'Ya se está mejorando' : 'Primero hay que terminar la obra';
  if (!next) return 'Ya tiene el nivel más alto';
  if (!levelImplemented(b.def, next)) return 'Todavía no está disponible en el juego';
  if (next.age > colony.age) return `Hace falta llegar a la ${ageInfo(next.age).name}`;
  const missing = missingBuildings(colony, next.requires);
  const tech = techNeeded(colony, next.tech);
  if (tech) missing.push(tech);
  if (missing.length) return needs(missing);
  return null;
}

// Evolución automática: las viviendas toman el nivel de la edad (sin pagar) y conservan su
// sitio. Devuelve cuántas cambiaron.
export function evolveHouses(colony) {
  let n = 0;
  for (const b of colony.buildings) {
    if (!b.def.autoLevel) continue;
    const target = maxLevelFor(b.def, colony.age);
    if (b.level < target) {
      b.level = target;
      n++;
    }
  }
  return n;
}

// ---- Territorio -------------------------------------------------------------------------------

// Ampliaciones de territorio que se pueden comprar: las de la edad y las que permita la administración.
export function expansionCap(colony) {
  const ageCap = limitsFor(colony.age).expansions;
  let admin = 0;
  for (const b of colony.buildings) if (b.def.id === 'admin' && b.done) admin = Math.max(admin, levelOf(b).expansions ?? 0);
  // Sin administración sólo se puede ampliar una vez (la aldea se organiza sola hasta cierto punto).
  return Math.min(ageCap, Math.max(1, admin));
}

export const radiusOf = (colony) => limitsFor(colony.age).radius + (colony.expansions ?? 0) * EXPANSION_STEP;

// Coste de la siguiente ampliación (crece con cada una).
export function expansionCost(colony) {
  const n = (colony.expansions ?? 0) + 1;
  const base = { wood: 30 * n, stone: 20 * n };
  if (colony.age >= 3) base.fiber = 10 * n;
  if (colony.age >= 5) base.cut_stone = 12 * n;
  if (colony.age >= 6) base.coin = 20 * n;
  return base;
}

// Por qué no se puede ampliar el territorio (texto o null). "claim": problema de solape con otro
// jugador (lo decide el servidor, que conoce los demás campamentos).
export function expansionBlocker(colony) {
  const n = colony.expansions ?? 0;
  if (n >= expansionCap(colony)) {
    const admin = Math.max(1, ...colony.buildings.filter((b) => b.def.id === 'admin' && b.done).map((b) => levelOf(b).expansions ?? 0));
    return n >= limitsFor(colony.age).expansions ? `Límite de la ${ageInfo(colony.age).name}: ${n} (se amplía con la edad)` : `Hace falta una administración mejor (permite ${admin})`;
  }
  const cost = expansionCost(colony);
  const lacking = Object.entries(cost).filter(([k, v]) => (colony.stock[k] ?? 0) < v);
  if (lacking.length) return `Faltan ${lacking.map(([k, v]) => `${Math.ceil(v - (colony.stock[k] ?? 0))} de ${GOOD_NAMES[k] ?? k}`).join(' y ')}`;
  return colony.claimProblem?.(radiusOf(colony) + EXPANSION_STEP) ?? null;
}

// ---- Tabla de desbloqueos (para la interfaz y la documentación) ---------------------------------

const costText = (cost) => Object.entries(cost ?? {}).map(([k, n]) => `${n} ${GOOD_NAMES[k] ?? k}`).join(', ');

function reqText(def, lv, first) {
  const parts = [];
  const reqs = [...(first ? def.requires ?? [] : []), ...(lv.requires ?? [])];
  for (const m of missingBuildings({ buildings: [] }, reqs)) parts.push(`Requiere ${m}`);
  const tech = lv.tech ?? (first ? def.tech : null);
  if (tech) parts.push(`Tecnología: ${TECHS_BY_ID[tech]?.name ?? tech}`);
  if (def.deposit && first) parts.push(`Sobre un yacimiento de ${GOOD_NAMES[def.deposit] ?? def.deposit}`);
  return parts;
}

// Para cada edad, todo lo implementado que se desbloquea y con qué requisitos:
// [{ age, kind: 'build' | 'level' | 'limit', id, name, text, level }]
export function unlockTable({ all = false } = {}) {
  const rows = [];
  for (const def of BUILDING_TYPES) {
    if (!all && !defImplemented(def)) continue;
    def.levels.forEach((lv, i) => {
      if (!all && !levelImplemented(def, lv)) return;
      const parts = [];
      if (i === 0) {
        parts.push(`Coste: ${costText(buildCostOf(def, lv.age))}`);
      } else if (def.autoLevel) {
        parts.push('Evoluciona sola al llegar a esta edad (sin coste)');
        if (lv.buildCost) parts.push(`Una nueva cuesta ${costText(lv.buildCost)}`);
      } else {
        parts.push(`Mejora de «${def.levels[i - 1].name}»: ${costText(lv.upgradeCost)}`);
      }
      parts.push(...reqText(def, lv, i === 0));
      if (lv.housing) parts.push(`Aloja a ${lv.housing}`);
      if (lv.recipe) {
        const r = lv.recipe;
        const inn = costText(r.in);
        parts.push(`${inn ? `${inn} → ` : ''}${costText(r.out)} cada ${r.time} s`);
      }
      if (lv.power) parts.push(`Produce energía (${lv.power})`);
      if (lv.energy) parts.push(`Consume energía (${lv.energy})`);
      if (lv.defense) parts.push(`Defensa ${lv.defense}`);
      if (lv.garrison) parts.push(`Guarnición ${lv.garrison}`);
      const w = lv.workers ?? def.workers;
      if (w) parts.push(`${w} trabajador${w > 1 ? 'es' : ''}`);
      rows.push({ age: lv.age, kind: i === 0 ? 'build' : 'level', id: def.id, level: i + 1, name: lv.name, text: parts.join(' · ') });
    });
  }
  for (let n = 1; n <= MAX_AGE; n++) {
    const l = limitsFor(n);
    rows.push({
      age: n,
      kind: 'limit',
      name: 'Límites de la aldea',
      text: `Territorio ${l.radius} m (+${EXPANSION_STEP} m por ampliación, hasta ${l.expansions}) · hasta ${l.houses} viviendas${l.apartments ? ` y ${l.apartments} bloques` : ''} · ${l.perType} edificios de cada tipo · población máxima ${l.popCap}`,
    });
  }
  return rows.sort((a, b) => a.age - b.age);
}

// Una edad se puede alcanzar si todo lo que exige existe en el juego.
AGE_HOOKS.reachable = (age) => {
  const req = age.requires;
  if (!req) return false;
  for (const r of req.buildings ?? []) {
    const def = BUILDINGS[r.id];
    if (!def || !defImplemented(def) || !levelImplemented(def, def.levels[(r.level ?? 1) - 1])) return false;
  }
  if ((req.techs?.length ?? 0) > 0 && !FEATURES.has('tech')) return false;
  for (const good of Object.keys(req.produced ?? {})) if (!goodProducible(good)) return false;
  return true;
};

// ¿Algún edificio implementado produce (o se puede conseguir) este bien?
function goodProducible(good) {
  if (['food', 'water', 'wood', 'stone', 'fiber'].includes(good)) return true;
  for (const def of BUILDING_TYPES) {
    if (!kindImplemented(def)) continue;
    for (const lv of def.levels) if (lv.recipe?.out?.[good]) return true;
  }
  return good === 'coin' && FEATURES.has('market');
}

export { MAX_AGE };

// ---- Qué gana una mejora (para mostrarlo en la ficha) ----------------------------------------------

const rate = (r) => {
  const out = Object.entries(r.out ?? {})[0];
  return out ? { good: out[0], perDay: Math.round((out[1] * DAY_LENGTH_SECONDS) / r.time) } : null;
};

// Lista de beneficios concretos de pasar del nivel "from" al "to" de un tipo de edificio.
export function levelBenefits(def, from, to) {
  const out = [];
  const num = (key, label) => {
    if (to[key] != null && to[key] !== (from[key] ?? 0)) out.push(`${label}: ${from[key] ?? 0} → ${to[key]}`);
  };
  num('yield', 'Trae por viaje');
  num('housing', 'Plazas de vivienda');
  num('defense', 'Puntos de defensa');
  num('garrison', 'Guarnición');
  num('trade', 'Cupo diario de comercio');
  num('power', 'Energía que produce');
  num('reach', 'Alcance (m)');
  num('regen', 'Recuperación de salud');
  num('teach', 'Enseñanza');
  num('expansions', 'Ampliaciones de territorio');
  if (to.workTime && from.workTime && to.workTime !== from.workTime) out.push(`Tiempo por jarra: ${from.workTime} s → ${to.workTime} s`);
  if (to.capacity && from.capacity) {
    const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);
    out.push(`Capacidad de recursos básicos: ${sum(from.capacity)} → ${sum(to.capacity)}`);
    if (to.other !== from.other) out.push(`Capacidad de cada otro bien: ${from.other ?? 0} → ${to.other}`);
  }
  if (to.recipe) {
    const a = from.recipe ? rate(from.recipe) : null;
    const b = rate(to.recipe);
    if (b && (!a || a.good !== b.good || a.perDay !== b.perDay)) out.push(`Produce ${GOOD_NAMES[b.good] ?? b.good} por día: ${a ? a.perDay : 0} → ${b.perDay} (con dotación completa)`);
  }
  const wf = from.workers ?? def.workers;
  const wt = to.workers ?? def.workers;
  if (wt !== wf) out.push(`Trabajadores: ${wf} → ${wt}`);
  if ((to.energy ?? 0) !== (from.energy ?? 0)) out.push(`Energía que consume: ${from.energy ?? 0} → ${to.energy ?? 0}`);
  if (!out.length) out.push('Nuevo aspecto y más prestigio para la aldea');
  return out;
}
