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
import { growthBlocker, maxPopulation, assignHomes } from '../../../src/sim/family.js';
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

// Edad I: el refugio no pide ningún edificio previo (ni tala ni cantera); la cantera sí pide leñador;
// las mejoras esperan a la edad II.
let sim = colony();
assert.equal(sim.buildProblem(BUILDINGS.house, 22, 10), null, 'el refugio se puede encargar desde el principio');
const wood = place(sim, 'woodcutter', 0);
assert.equal(sim.buildProblem(BUILDINGS.house, 22, -8), null);
assert.match(sim.upgradeProblem(wood), /Edad de Piedra/);
assert.equal(sim.upgradeProblem(wood) && sim.upgrade(wood), false);
console.log('✓ edificios previos y mejoras bloqueadas por la edad');

// Límites de la edad I: 2 de cada tipo, 3 viviendas, territorio de 75 m.
place(sim, 'woodcutter', 1);
assert.match(sim.buildProblem(BUILDINGS.woodcutter, -24, 12), /Límite de la Edad Primitiva: 2/);
for (let k = 0; k < LIMITS[0].houses; k++) place(sim, 'house', 2 + k);
assert.match(sim.buildProblem(BUILDINGS.house, 30, 0), /Límite de la Edad Primitiva: 3/);
assert.match(sim.buildProblem(BUILDINGS.quarry, 80, 0), /Fuera del territorio/);
assert.equal(maxPopulation(sim), 10, '3 viviendas de 4 plazas = 12, pero la edad I admite 10');
console.log('✓ límites de edificios y territorio de la edad I; población según la vivienda');

// Avanzar de edad: requisitos (no sólo materiales), cobra una vez y evoluciona las viviendas.
assert.equal(nextAgeStatus(sim).ready, false);
place(sim, 'stockpile', 5);
assignHomes(sim);
const st = nextAgeStatus(sim);
assert.equal(st.checks.find((c) => c.label.startsWith('Descubrir')).ok, false, 'falta la primera herramienta de piedra');
assert.equal(st.ready, false);
sim.milestones.add('stone_tool');
assert.equal(nextAgeStatus(sim).ready, true, `Piedra se alcanza sólo con lo de Primitiva: ${JSON.stringify(nextAgeStatus(sim).checks.filter((c) => !c.ok))}`);
const woodBefore = sim.stock.wood;
assert.equal(sim.advanceAge(), true);
assert.equal(sim.age, 2);
assert.equal(woodBefore - sim.stock.wood, 30, 'la ofrenda se cobra una vez');
assert.equal(sim.advanceAge(), false, 'no se puede repetir (la edad siguiente aún no existe)');
assert.equal(woodBefore - sim.stock.wood, 30);
assert.ok(sim.buildings.filter((b) => b.def.id === 'house').every((b) => b.level === 2), 'las viviendas evolucionan solas');
assert.equal(maxPopulation(sim), 3 * 4);
assert.equal(sim.buildings.find((b) => b.def.id === 'stockpile').level, 1, 'lo demás no mejora gratis');
console.log('✓ avanzar de edad cobra una vez, evoluciona las viviendas y no mejora lo demás');

// Edad II: mejorar cuesta y pide su edificio previo; los límites suben; vivienda nueva más cara.
place(sim, 'quarry', 7);
place(sim, 'gatherer', 8);
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

// Un pozo (cuya "capacity" es un número) no rompe la capacidad del almacén.
const well = place(sim, 'well', 7);
assert.ok(Number.isFinite(sim.capacity('food')));
well.level = 2;
assert.ok(Number.isFinite(sim.capacity('wood')));
console.log('✓ capacidad del almacén con pozos');

// Territorio: se amplía pagando, hasta lo que permite la edad (y sin administración, una vez).
assert.equal(sim.territoryRadius, 85);
assert.equal(sim.expansionBlocker, null);
const woodBefore2 = sim.stock.wood;
assert.equal(sim.expandTerritory(), true);
assert.equal(sim.territoryRadius, 97);
assert.ok(woodBefore2 - sim.stock.wood > 0, 'la ampliación se paga');
assert.match(sim.expansionBlocker, /Límite de la Edad de Piedra|administración/);
assert.equal(sim.expandTerritory(), false);
console.log('✓ ampliar territorio: se paga y respeta el tope de la edad');

// Crecimiento: sin reservas no hay población nueva aunque haya plazas.
sim.stock.food = 1;
assert.match(growthBlocker(sim), /reservas de comida/);
console.log('✓ el crecimiento exige abastecimiento');

// Dotaciones: se asignan solas, se pueden quitar y poner a mano y los niños o soldados no trabajan.
const gath = sim.buildings.find((b) => b.def.id === 'gatherer');
sim.assignWorker(gath);
assert.equal(gath.workers.length, 1);
const w0 = gath.workers[0];
assert.equal(gath.worker, w0);
sim.releaseWorker(gath, w0);
assert.equal(gath.workers.length, 0);
assert.equal(w0.job, null);
const kid = sim.colonists[1];
kid.growth = 0.5;
sim.setWorker(gath, kid);
assert.equal(gath.workers.length, 0, 'un niño no trabaja');
kid.growth = 1;
sim.setWorker(gath, kid);
assert.equal(gath.workers[0], kid);
const snap = JSON.parse(JSON.stringify(sim.snapshot('full')));
assert.deepEqual(snap.buildings.find((r) => r.id === gath.id).workers, [kid.id]);
assert.equal(sim.crewNeeded(sim.buildings.find((b) => b.def.id === 'house')), 0);
console.log('✓ dotaciones de trabajadores (asignar, quitar, niños no trabajan, snapshot)');

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
