// Reglas de progresión por edades: lo que se puede construir, mejorar, alojar y ocupar en
// cada edad. Datos y funciones puras (sin Three.js ni DOM): las usan la simulación (y por
// tanto el servidor, que es quien decide), la interfaz y las pruebas, así que construir,
// mejorar y crecer comparten los mismos requisitos. La edad es necesaria pero no
// suficiente: además hacen falta los costes, los edificios previos y las condiciones de
// cada cosa. Nada de aquí se salta recibiendo recursos de fuera: se comprueba el estado
// de la colonia (edificios terminados, nivel, edad), no lo que hay en el almacén.

import { AGES, ageInfo } from '../ages.js';
import { BUILDING_TYPES, BUILDINGS, levelOf } from './buildingTypes.js';

// Límites por edad (la fila de la edad N está en LIMITS[N - 1]).
//   radius   metros desde la fogata donde se puede construir (el territorio de la aldea)
//   houses   viviendas que se pueden tener a la vez
//   perType  edificios de cada tipo de producción o almacén (los pozos, la mitad)
export const LIMITS = [
  { radius: 75, houses: 3, perType: 2 },
  { radius: 95, houses: 6, perType: 4 },
  { radius: 120, houses: 10, perType: 6 },
  { radius: 150, houses: 15, perType: 8 },
  { radius: 190, houses: 20, perType: 10 },
];

export const limitsFor = (age) => LIMITS[Math.min(LIMITS.length, Math.max(1, age)) - 1];

// Nivel más alto que permite una edad para un tipo de edificio (el nivel N es de la edad N
// y sólo existen los niveles definidos).
export const maxLevelFor = (def, age) => Math.min(def.levels.length, Math.max(1, age));

// Edad mínima de un tipo para construirse.
export const minAgeOf = (def) => def.minAge ?? 1;

// Las viviendas se construyen ya con el aspecto de la edad actual (y evolucionan solas).
export const buildLevelFor = (def, age) => (def.autoLevel ? maxLevelFor(def, age) : 1);

// Coste de construir un tipo en la edad dada (la vivienda de una edad avanzada cuesta más).
export function buildCostOf(def, age) {
  return def.levels[buildLevelFor(def, age) - 1].buildCost ?? def.cost;
}

export function countOf(colony, id) {
  return colony.buildings.filter((b) => b.def.id === id).length;
}

// Cuántos puede haber de un tipo en una edad.
export function capOf(def, age) {
  const l = limitsFor(age);
  if (def.id === 'house') return l.houses;
  return def.id === 'well' ? Math.max(1, Math.floor(l.perType / 2)) : l.perType;
}

// Primera edad posterior a "age" en la que sube el tope (para decir cuándo se amplía).
function nextRaise(current, valueAt) {
  for (let n = current + 1; n <= AGES.length; n++) if (valueAt(n) > valueAt(current)) return ageInfo(n);
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

// Por qué no se puede construir un tipo (sin contar el lugar ni los recursos): texto o null.
export function buildBlocker(colony, def) {
  const age = colony.age;
  if (minAgeOf(def) > age) return `Disponible en la ${ageInfo(minAgeOf(def)).name}`;
  const missing = missingBuildings(colony, def.requires);
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
  if (!next) return `Más mejoras en edades posteriores (aún no disponibles)`;
  const level = b.level + 1;
  if (level > colony.age) return `Hace falta llegar a la ${ageInfo(level).name}`;
  const missing = missingBuildings(colony, next.requires);
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

// ---- Tabla de desbloqueos (para la interfaz y la documentación) ----------------------------

const costText = (cost) => Object.entries(cost ?? {}).map(([k, n]) => `${n} ${{ food: 'comida', water: 'agua', wood: 'madera', stone: 'piedra', fiber: 'fibras' }[k] ?? k}`).join(', ');

// Para cada edad, todo lo implementado que se desbloquea y con qué requisitos:
// [{ age, kind: 'build' | 'level' | 'limit', name, text }]
export function unlockTable() {
  const rows = [];
  for (const def of BUILDING_TYPES) {
    const age = minAgeOf(def);
    const reqs = missingBuildings({ buildings: [] }, def.requires);
    rows.push({
      age,
      kind: 'build',
      name: def.levels[buildLevelFor(def, age) - 1].name,
      text: [`Coste: ${costText(buildCostOf(def, age))}`, ...reqs.map((r) => `Requiere ${r}`)].join(' · '),
    });
    def.levels.forEach((lv, i) => {
      if (i === 0) return;
      const level = i + 1;
      const parts = [];
      if (def.autoLevel) parts.push('Evoluciona sola al llegar a esta edad (sin coste)');
      else {
        parts.push(`Mejora de ${def.levels[i - 1].name}: ${costText(lv.upgradeCost)}`);
        for (const r of missingBuildings({ buildings: [] }, lv.requires)) parts.push(`Requiere ${r}`);
      }
      if (lv.housing) parts.push(`Aloja a ${lv.housing}`);
      rows.push({ age: level, kind: 'level', name: lv.name, text: parts.join(' · ') });
    });
  }
  for (let n = 1; n <= AGES.length; n++) {
    const l = limitsFor(n);
    rows.push({ age: n, kind: 'limit', name: 'Límites de la aldea', text: `Territorio ${l.radius} m · hasta ${l.houses} viviendas · hasta ${l.perType} edificios de cada tipo de producción o almacén (pozos: ${Math.max(1, Math.floor(l.perType / 2))})` });
  }
  return rows.sort((a, b) => a.age - b.age);
}
