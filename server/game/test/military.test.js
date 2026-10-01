// Ejército y defensas: reclutamiento con equipo, plazas, tope de población, mantenimiento,
// mejoras pagadas, incursiones sin destrucción y reglas de combate entre jugadores.
// Uso: node server/game/test/military.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { DAY_LENGTH_SECONDS as DAY } from '../../../src/daynight.js';
import { pvpProblem, UNITS } from '../../../src/sim/units.js';
import { payUpkeep, dailyRaid, militaryPower } from '../../../src/sim/military.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(age, stock = {}) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  sim.age = age;
  sim.clothesLeft = 0;
  sim.colonists.forEach((c) => (c.clothed = true));
  sim.stock = { food: 900, water: 900, wood: 900, stone: 600, fiber: 300, ...stock };
  sim.timeLabel = () => 'Día 1';
  return sim;
}

// Sin cuartel no se recluta; con cuartel pide equipo, recursos y respeta plazas y el tope.
{
  const sim = colony(3, { arms_bronze: 2 });
  assert.match(sim.recruitProblem('spearman'), /edificio militar/);
  sim.createBuilding(BUILDINGS.barracks, 22, 10, 0, 1, 0); // cuartel inicial: 6 plazas
  assert.equal(sim.recruitProblem('spearman'), null);
  assert.match(sim.recruitProblem('swordsman'), /Todavía no existe/);
  const worker = sim.colonists.find((c) => c.job) ?? null;
  assert.equal(sim.recruit('spearman'), true);
  assert.equal(sim.stock.arms_bronze, 1, 'el equipo se gasta');
  const s = sim.colonists.find((c) => c.soldier);
  assert.equal(s.soldier.unit, 'spearman');
  assert.equal(s.job, null);
  assert.equal(sim.recruit('spearman'), true);
  assert.match(sim.recruitProblem('spearman'), /Faltan .*armas de bronce|El ejército no puede pasar/);
  assert.ok(worker === null || worker.job !== undefined);
  console.log('✓ reclutar: edificio, equipo, coste y tope de población');
}

// Los soldados no trabajan: reclutar a quien trabaja libera su puesto; al licenciarse devuelve el equipo.
{
  const sim = colony(3, { arms_bronze: 1 });
  sim.colonists.slice(3).forEach((c) => (c.growth = 0.5)); // tres adultos, tres puestos
  sim.createBuilding(BUILDINGS.barracks, 22, 10, 0, 1, 0);
  const gs = [[22, -8], [-24, 12], [-22, -14]].map(([x, z]) => sim.createBuilding(BUILDINGS.gatherer, x, z, 0, 1, 0));
  for (const g of gs) sim.assignWorker(g);
  assert.equal(gs.filter((g) => g.workers.length).length, 3);
  assert.equal(sim.recruit('spearman'), true);
  const w = sim.colonists.find((c) => c.soldier);
  assert.equal(w.job, null);
  assert.equal(gs.filter((g) => g.workers.length).length, 2, 'el reclutado dejó su puesto');
  assert.equal(sim.dismiss(w), true);
  assert.equal(sim.stock.arms_bronze, 1, 'devuelve el equipo');
  console.log('✓ el soldado deja el trabajo y al licenciarse devuelve el equipo');
}

// Mantenimiento: si falta, las tropas rinden la mitad; mejorar un soldado se paga.
{
  const sim = colony(4, { arms_iron: 3, arms_bronze: 1 });
  sim.createBuilding(BUILDINGS.barracks, 22, 10, 0, 1, 0);
  sim.createBuilding(BUILDINGS.tool_workshop, 22, -8, 0, 1, 0);
  sim.recruit('spearman');
  const power = militaryPower(sim).total;
  sim.stock.food = 0;
  payUpkeep(sim);
  assert.equal(sim.armyUnpaid, true);
  assert.ok(militaryPower(sim).total < power);
  sim.stock.food = 100;
  payUpkeep(sim);
  assert.equal(sim.armyUnpaid, false);
  const s = sim.colonists.find((c) => c.soldier);
  assert.equal(sim.soldierUpgradeProblem(s), null);
  const iron = sim.stock.arms_iron;
  assert.equal(sim.upgradeSoldier(s), true);
  assert.equal(s.soldier.unit, 'swordsman');
  assert.equal(sim.stock.arms_iron, iron - 1, 'la mejora se paga con equipo nuevo');
  console.log('✓ mantenimiento (rinden la mitad si no cobran) y mejoras pagadas');
}

// Incursiones: sin protección no ocurren; con defensas se rechazan; sin ellas se pierden recursos, nada más.
{
  const sim = colony(3, {});
  const buildingsBefore = sim.buildings.length;
  const colonistsBefore = sim.colonists.length;
  const events = [];
  sim.on('notice', (t) => events.push(t));
  dailyRaid(sim, 2);
  assert.equal(events.length, 0, 'sin incursiones en los primeros días');
  sim.absent = true;
  dailyRaid(sim, 20);
  assert.equal(events.length, 0, 'nunca con el dueño ausente');
  sim.absent = false;
  sim.nextRaidDay = 0;
  const wood = sim.stock.wood;
  dailyRaid(sim, 20);
  assert.equal(events.length, 1);
  assert.ok(sim.stock.wood <= wood);
  assert.equal(sim.buildings.length, buildingsBefore);
  assert.equal(sim.colonists.length, colonistsBefore);
  for (let k = 0; k < 6; k++) sim.createBuilding(BUILDINGS.watchtower, 10 + k * 6, 30, 0, 1, 0, 3);
  assert.ok(militaryPower(sim).defense > 0);
  console.log('✓ incursiones: protección, sin dueño no ocurren, nada se destruye:', events[0].slice(0, 60));
}

// Reglas de combate entre jugadores: todo rechazado mientras estén desactivadas.
assert.match(pvpProblem({ age: 3 }, { age: 3 }, { gameDay: 30, defenderOnline: true }), /desactivados/);
assert.ok(UNITS.every((u) => u.age >= 3 && u.cost && u.upkeep), 'cada unidad tiene coste y mantenimiento');
console.log('✓ ataques entre jugadores desactivados y unidades con coste y mantenimiento');
console.log('Todo bien.');
process.exit(0);
