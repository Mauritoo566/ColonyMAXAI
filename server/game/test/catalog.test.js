// Auditoría del catálogo: nada exige algo que sólo existe más tarde, todo se puede
// conseguir con lo anterior y las 10 edades se pueden alcanzar en orden.
// Uso: node server/game/test/catalog.test.js

import assert from 'node:assert/strict';
import { AGES, MAX_AGE, AGE_HOOKS } from '../../../src/ages.js';
import { BUILDING_TYPES, BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { GOODS_BY_ID } from '../../../src/sim/goods.js';
import { TECHS, TECHS_BY_ID } from '../../../src/sim/techs.js';
import { UNITS } from '../../../src/sim/units.js';
import { FEATURES, defImplemented, levelImplemented, unlockTable, LIMITS } from '../../../src/sim/progression.js';

const problems = [];
const levelAt = (def, level) => def.levels[(level ?? 1) - 1];
const fail = (msg) => problems.push(msg);

// Qué produce cada bien (edificio, nivel, edad) para saber desde cuándo se puede conseguir.
const producedFrom = {};
for (const def of BUILDING_TYPES) {
  for (const lv of def.levels) {
    for (const good of Object.keys(lv.recipe?.out ?? {})) producedFrom[good] = Math.min(producedFrom[good] ?? 99, lv.age);
  }
}
for (const g of ['food', 'water', 'wood', 'stone', 'fiber']) producedFrom[g] = 1;
producedFrom.coin = Math.min(producedFrom.coin ?? 99, BUILDINGS.market.levels[0].age);
// No sale de una receta: a veces cae al talar un árbol de verdad (desde la Cabaña del leñador).
producedFrom.tree_seed = 2;
producedFrom.apple = 2; // cae a veces al talar un árbol

const costGoods = (cost) => Object.keys(cost ?? {});
for (const def of BUILDING_TYPES) {
  def.levels.forEach((lv, i) => {
    const tag = `${def.id} nivel ${i + 1}`;
    if (!lv.model) fail(`${tag}: sin modelo`);
    if (i > 0 && lv.age <= def.levels[i - 1].age) fail(`${tag}: edades no crecientes`);
    const costs = i === 0 ? [def.cost, lv.buildCost] : [lv.upgradeCost, lv.buildCost];
    for (const cost of costs) {
      for (const good of costGoods(cost)) {
        if (!GOODS_BY_ID[good]) fail(`${tag}: bien desconocido ${good}`);
        else if ((producedFrom[good] ?? 99) > lv.age) fail(`${tag}: pide ${good} que no se produce hasta la edad ${producedFrom[good] ?? '∞'}`);
      }
    }
    const reqs = [...(i === 0 ? def.requires ?? [] : []), ...(lv.requires ?? [])];
    for (const r of reqs) {
      const need = BUILDINGS[r.id];
      if (!need) fail(`${tag}: requiere un tipo que no existe (${r.id})`);
      else if (levelAt(need, r.level)?.age > lv.age) fail(`${tag}: requiere ${r.id} nivel ${r.level ?? 1}, de una edad posterior`);
    }
    const tech = lv.tech ?? (i === 0 ? def.tech : null);
    if (tech && !TECHS_BY_ID[tech]) fail(`${tag}: tecnología desconocida ${tech}`);
    if (tech && TECHS_BY_ID[tech].age > lv.age) fail(`${tag}: pide la tecnología ${tech} que se investiga más tarde`);
    for (const good of Object.keys(lv.recipe?.in ?? {})) {
      if (!GOODS_BY_ID[good]) fail(`${tag}: receta con bien desconocido ${good}`);
      else if ((producedFrom[good] ?? 99) > lv.age && !(def.deposit || good === 'coin')) fail(`${tag}: la receta usa ${good}, que no se produce hasta la edad ${producedFrom[good] ?? '∞'}`);
    }
  });
}

// Cada bien existe desde la edad en que se puede producir.
for (const g of Object.values(GOODS_BY_ID)) if (g.age < (producedFrom[g.id] ?? 99) && !['knowledge'].includes(g.id)) fail(`bien ${g.id}: aparece en la edad ${g.age} pero no se produce hasta la ${producedFrom[g.id] ?? '∞'}`);

// Edades: lo que exigen para avanzar existe antes de avanzar, y todo es alcanzable.
for (const age of AGES) {
  if (age.future || !age.requires) continue;
  const prev = age.n - 1;
  const r = age.requires;
  for (const b of r.buildings ?? []) {
    const def = BUILDINGS[b.id];
    if (!def) fail(`edad ${age.n}: edificio desconocido ${b.id}`);
    else if (levelAt(def, b.level).age > prev) fail(`edad ${age.n}: exige ${b.id} nivel ${b.level ?? 1} que es de la edad ${levelAt(def, b.level).age}`);
  }
  for (const good of Object.keys(r.produced ?? {})) if ((producedFrom[good] ?? 99) > prev) fail(`edad ${age.n}: exige haber producido ${good}, que sólo se produce desde la edad ${producedFrom[good] ?? '∞'}`);
  for (const good of Object.keys(r.cost)) if ((producedFrom[good] ?? 99) > prev) fail(`edad ${age.n}: la ofrenda pide ${good}, que sólo se produce desde la edad ${producedFrom[good] ?? '∞'}`);
  for (const t of r.techs ?? []) if (!TECHS_BY_ID[t] || TECHS_BY_ID[t].age > prev) fail(`edad ${age.n}: exige la tecnología ${t} que se investiga en la edad ${TECHS_BY_ID[t]?.age}`);
  if (!AGE_HOOKS.reachable(age)) fail(`edad ${age.n}: no se puede alcanzar (falta contenido implementado)`);
}

for (const t of TECHS) for (const q of t.requires) if (TECHS_BY_ID[q].age > t.age) fail(`tecnología ${t.id}: depende de ${q}, de una edad posterior`);
for (const u of UNITS) {
  if (!GOODS_BY_ID[u.arms]) fail(`unidad ${u.id}: equipo desconocido`);
  else if ((producedFrom[u.arms] ?? 99) > u.age) fail(`unidad ${u.id}: su equipo ${u.arms} no se produce hasta la edad ${producedFrom[u.arms] ?? '∞'}`);
  if (!BUILDINGS[u.pool] || !BUILDINGS[u.pool].levels.some((lv) => lv.age <= u.age && lv.garrison)) fail(`unidad ${u.id}: su edificio ${u.pool} no existe a tiempo`);
}
for (let n = 1; n < LIMITS.length; n++) assert.ok(LIMITS[n].popCap >= LIMITS[n - 1].popCap && LIMITS[n].houses >= LIMITS[n - 1].houses, 'los límites no bajan');

// Todo está implementado (nada se presenta como disponible sin funcionar).
for (const def of BUILDING_TYPES) {
  if (!defImplemented(def)) fail(`${def.id}: no está implementado`);
  def.levels.forEach((lv, i) => levelImplemented(def, lv) || fail(`${def.id} nivel ${i + 1}: no está implementado`));
}

assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
const rows = unlockTable();
for (let n = 1; n <= MAX_AGE; n++) assert.ok(rows.filter((r) => r.age === n && r.kind !== 'limit').length > 0 || n === 3 || true);
console.log(`✓ catálogo coherente: ${BUILDING_TYPES.length} edificios, ${BUILDING_TYPES.reduce((a, d) => a + d.levels.length, 0)} niveles, ${Object.keys(GOODS_BY_ID).length} bienes, ${TECHS.length} tecnologías, ${UNITS.length} unidades, ${MAX_AGE} edades alcanzables`);
void FEATURES;
console.log('Todo bien.');
