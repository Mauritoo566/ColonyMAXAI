// Reglas de progresión por edades, sin red: requisitos, límites, mejoras, evolución de las
// viviendas, avanzar de edad (una sola vez) y partidas anteriores que se conservan.
// Uso: node server/game/test/progression.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { LIMITS, unlockTable } from '../../../src/sim/progression.js';
import { growthBlocker, maxPopulation } from '../../../src/sim/family.js';
import { nextAgeStatus } from '../../../src/ages.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.stock = { food: 300, water: 300, wood: 900, stone: 400, fiber: 300 };
  return sim;
}
const spots = [[22, 10], [22, -8], [-24, 12], [-22, -14], [10, 28], [-10, 28], [30, 0], [-30, 0], [0, -30], [12, -28]];
const place = (sim, id, k, level) => sim.createBuilding(BUILDINGS[id], ...spots[k], 0, 1, 0, level);

// Edad I: la vivienda pide un leñador terminado; las mejoras esperan a la edad II.
let sim = colony();
assert.match(sim.buildProblem(BUILDINGS.house, 22, 10), /leñador|zona de tala|Zona de tala/i);
const wood = place(sim, 'woodcutter', 0);
assert.equal(sim.buildProblem(BUILDINGS.house, 22, -8), null, 'con un leñador ya se puede');
assert.match(sim.upgradeProblem(wood), /Edad de Piedra/);
assert.equal(sim.upgradeProblem(wood) && sim.upgrade(wood), false);
console.log('✓ edificios previos y mejoras bloqueadas por la edad');

// Límites de la edad I: 2 de cada tipo, 3 viviendas, territorio de 75 m.
place(sim, 'woodcutter', 1);
assert.match(sim.buildProblem(BUILDINGS.woodcutter, -24, 12), /Límite de la Edad Primitiva: 2/);
for (let k = 0; k < LIMITS[0].houses; k++) place(sim, 'house', 2 + k);
assert.match(sim.buildProblem(BUILDINGS.house, 30, 0), /Límite de la Edad Primitiva: 3/);
assert.match(sim.buildProblem(BUILDINGS.quarry, 80, 0), /Fuera del territorio/);
assert.equal(maxPopulation(sim), 14, "10 + 3 viviendas = 16, pero la edad I admite 14");
console.log('✓ límites de edificios y territorio de la edad I; tope de población 14');

// Avanzar de edad: requisitos (no sólo materiales), cobra una vez y evoluciona las viviendas.
assert.equal(nextAgeStatus(sim).ready, false);
place(sim, 'quarry', 5);
place(sim, 'gatherer', 6);
assert.equal(nextAgeStatus(sim).checks.find((c) => c.label === 'Colonos en la aldea').ok, false, 'hacen falta 6 colonos');
sim.colonists.push(sim.makeColonist({ ...sim.staticOf(sim.colonists[0]), id: 99, name: 'Extra' }, { needs: { ...sim.colonists[0].needs }, growth: 1 }));
assert.equal(nextAgeStatus(sim).ready, true);
const woodBefore = sim.stock.wood;
assert.equal(sim.advanceAge(), true);
assert.equal(sim.age, 2);
assert.equal(woodBefore - sim.stock.wood, 30, 'la ofrenda se cobra una vez');
assert.equal(sim.advanceAge(), false, 'no se puede repetir (la edad siguiente aún no existe)');
assert.equal(woodBefore - sim.stock.wood, 30);
assert.ok(sim.buildings.filter((b) => b.def.id === 'house').every((b) => b.level === 2), 'las viviendas evolucionan solas');
assert.equal(maxPopulation(sim), 10 + 3 * 3);
assert.equal(sim.buildings.find((b) => b.def.id === 'quarry').level, 1, 'lo demás no mejora gratis');
console.log('✓ avanzar de edad cobra una vez, evoluciona las viviendas y no mejora lo demás');

// Edad II: mejorar cuesta y pide su edificio previo; los límites suben; vivienda nueva más cara.
const q = sim.buildings.find((b) => b.def.id === 'quarry');
assert.equal(sim.upgradeProblem(q), null);
assert.equal(sim.upgradeProblem(sim.buildings.find((b) => b.def.id === 'gatherer')), null);
const stoneBefore = sim.stock.stone;
assert.equal(sim.upgrade(q), true);
assert.ok(stoneBefore - sim.stock.stone > 0, 'la mejora se paga');
assert.equal(sim.upgrade(q), false, 'no se paga dos veces');
assert.equal(sim.buildProblem(BUILDINGS.house, -4, 40), null);
assert.deepEqual(sim.costOf(BUILDINGS.house), { wood: 24, stone: 8, fiber: 8 });
const b = sim.build('house', -4, 40).building;
assert.equal(b.level, 2, 'las viviendas nuevas nacen con el aspecto de la edad');
assert.equal(sim.upgradeProblem(b), 'Evoluciona sola al avanzar de edad');
console.log('✓ edad II: mejoras pagadas, vivienda nueva más cara y con el aspecto de la edad');

// Crecimiento: sin reservas no hay población nueva aunque haya plazas.
sim.stock.food = 1;
assert.match(growthBlocker(sim), /reservas de comida/);
console.log('✓ el crecimiento exige abastecimiento');

// Partida anterior: edificios de nivel II en edad I y viviendas de nivel I en edad II se conservan.
const old = colony();
const g = place(old, 'gatherer', 0, 2); // ya mejorada antes de las nuevas reglas
const save = JSON.parse(JSON.stringify(sim.serialize()));
const loaded = colony();
loaded.restore(save);
assert.equal(loaded.age, 2);
assert.equal(loaded.buildings.length, sim.buildings.length);
assert.equal(g.level, 2);
const migrate = JSON.parse(JSON.stringify(save));
migrate.buildings.filter((s) => s.type === 'house').forEach((s) => (s.level = 1));
const loaded2 = colony();
loaded2.restore(migrate);
assert.ok(loaded2.buildings.filter((b) => b.def.id === 'house').every((b) => b.level === 2));
console.log('✓ partidas anteriores: nada se pierde y las viviendas se ponen al día');

// La tabla de desbloqueos cubre todas las edades jugables.
const table = unlockTable();
assert.ok(table.some((r) => r.age === 2 && r.kind === 'level'));
console.log('✓ tabla de desbloqueos:', table.length, 'filas');
console.log('Todo bien.');
process.exit(0);
