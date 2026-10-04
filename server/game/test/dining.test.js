// Comedor: los colonos entran, comen y beben dentro con lo del almacén de la colonia, les da bienestar, no pasan de las plazas, y con el
// comedor en uso se consume sólo ahí (fuera queda para emergencias) y el aguatero lleva el agua en jarras al almacén.
// Uso: node server/game/test/dining.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { chooseTask, runTask, endTask } from '../../../src/ai.js';
import { hallOpen, seatsOf, diners } from '../../../src/sim/dining.js';
import { defImplemented, maxLevelFor } from '../../../src/sim/progression.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(2);
  sim.stock = { food: 50, water: 50, wood: 99, stone: 0, fiber: 99 };
  sim.clothesLeft = 0;
  for (const c of sim.colonists) {
    c.clothed = true;
    c.task = null;
    c.needs = { food: 100, water: 100, rest: 100, warmth: 100, mood: 50 };
  }
  return sim;
}
const hall = (sim, x = 22, z = 14) => {
  const b = sim.createBuilding(BUILDINGS.dining_hall, x, z, 0, 1, 0, 1);
  b.done = true;
  b.progress = 1;
  return b;
};
const env = { isNight: false, gameTime: 100 };
const DT = 0.1;
const step = (sim, c) => {
  sim.buildCrowd();
  c.walking = false;
  c.moveTick = false;
  return runTask(sim, c, c.task, DT, env);
};

// 0) Está disponible desde la edad II y sube de nivel con las edades.
assert.ok(defImplemented(BUILDINGS.dining_hall), 'el comedor se puede construir');
assert.equal(BUILDINGS.dining_hall.minAge, 2);
assert.equal(maxLevelFor(BUILDINGS.dining_hall, 2), 1);
assert.ok(maxLevelFor(BUILDINGS.dining_hall, 10) >= 5, 'sube de nivel con las edades');

// 1) Un colono con hambre elige el comedor, entra (no se ve), come, y sale con comida y bienestar.
{
  const sim = colony();
  const b = hall(sim);
  assert.ok(hallOpen(sim));
  const c = sim.colonists[0];
  c.needs.food = 40;
  const task = chooseTask(sim, c, env);
  assert.equal(task?.type, 'eat');
  assert.equal(task.source, 'hall', 'prefiere el comedor al almacén de la fogata');
  c.task = task;
  const foodStock = sim.stock.food;
  let inside = false;
  let result = 'running';
  for (let t = 0; t < 120 && result === 'running'; t += DT) {
    result = step(sim, c);
    if (c.inside) inside = true;
  }
  assert.equal(result, 'done');
  assert.ok(inside, 'estuvo dentro del comedor');
  assert.equal(c.inside, false, 'al terminar sale');
  assert.ok(c.needs.food > 90, `comió (${c.needs.food})`);
  assert.equal(sim.stock.food, foodStock - 1, 'el plato sale del almacén de la colonia');
  assert.ok(c.moodEvents?.some((e) => e.id === 'meal' && e.delta > 0), 'comer a gusto da bienestar');
  endTask(sim, c, c.task); // como hace la simulación al terminar una tarea
  c.task = null;
  assert.equal(diners(sim, b).length, 0, 'la plaza queda libre');
}

// 2) También bebe en el comedor (con el agua del almacén).
{
  const sim = colony();
  hall(sim);
  const c = sim.colonists[0];
  c.needs.water = 30;
  const task = chooseTask(sim, c, env);
  assert.equal(task?.type, 'drink');
  assert.equal(task.source, 'hall');
  c.task = task;
  const water = sim.stock.water;
  let result = 'running';
  for (let t = 0; t < 120 && result === 'running'; t += DT) result = step(sim, c);
  assert.equal(result, 'done');
  assert.ok(c.needs.water > 85);
  assert.equal(sim.stock.water, water - 1);
}

// 3) Con el comedor en uso, comer y beber fuera sólo en emergencias; sin comedor todo sigue igual.
{
  const sim = colony();
  hall(sim);
  const c = sim.colonists[0];
  c.needs.food = 50;
  assert.equal(chooseTask(sim, c, env).source, 'hall');
  c.needs.food = 10; // urgente
  assert.equal(chooseTask(sim, c, env).type, 'eat');

  // Comedor lleno y sin urgencia: no consume fuera (espera su turno).
  const full = colony();
  const b2 = hall(full);
  const fillers = [];
  for (let i = 0; i < seatsOf(b2); i++) fillers.push({ id: 900 + i, task: { source: 'hall', building: b2 } });
  full.colonists.push(...fillers);
  b2.diners = [...fillers];
  const d = full.colonists[0];
  d.needs.food = 50;
  d.needs.water = 50;
  const t2 = chooseTask(full, d, env);
  assert.ok(!t2 || (t2.type !== 'eat' && t2.type !== 'drink'), `sin plaza y sin urgencia no consume fuera (eligió ${t2?.type}:${t2?.source})`);

  // Sin comedor: come del almacén como siempre.
  const none = colony();
  const e = none.colonists[0];
  e.needs.food = 40;
  const t3 = chooseTask(none, e, env);
  assert.equal(t3.type, 'eat');
  assert.notEqual(t3.source, 'hall');
}

// 4) Nunca más comensales que plazas.
{
  const sim = colony();
  const b = hall(sim);
  const seats = seatsOf(b);
  const crowd = sim.colonists;
  for (const c of crowd) {
    c.needs.food = 30;
    c.x = 25;
    c.z = 20;
    c.task = chooseTask(sim, c, env);
  }
  let most = 0;
  for (let t = 0; t < 60; t += DT) {
    sim.buildCrowd();
    for (const c of crowd) {
      if (!c.task) continue;
      c.walking = false;
      c.moveTick = false;
      const r = runTask(sim, c, c.task, DT, env);
      if (r === 'done' || r === 'failed') c.task = null;
    }
    most = Math.max(most, crowd.filter((c) => c.inside).length);
  }
  assert.ok(most <= seats, `no hay más dentro (${most}) que plazas (${seats})`);
}

// 5) El aguatero: sin comedor el agua aparece en el almacén al instante; con comedor la lleva en jarras (llega después de caminar).
{
  const run = (withHall) => {
    const sim = colony();
    if (withHall) hall(sim);
    const well = sim.createBuilding(BUILDINGS.well, 40, -30, 0, 1, 0, 2);
    well.done = true;
    well.progress = 1;
    const c = sim.colonists[0];
    c.x = 36;
    c.z = -30;
    sim.setWorker(well, c);
    sim.stock.water = 0;
    c.task = { type: 'work', building: well, phase: 'start' };
    let r = 'running';
    let firstWater = null;
    let walkedWith = false;
    for (let t = 0; t < 300 && r === 'running'; t += DT) {
      sim.buildCrowd();
      c.walking = false;
      c.moveTick = false;
      r = runTask(sim, c, c.task, DT, env);
      if (sim.stock.water > 0 && firstWater === null) firstWater = { x: c.x, z: c.z };
      if (c.task?.phase === 'hauling' && c.walking) walkedWith = true;
    }
    return { r, firstWater, walkedWith, stock: sim.stock.water, storage: sim.layout.storage };
  };
  const without = run(false);
  assert.equal(without.r, 'done');
  assert.ok(without.stock > 0);
  assert.equal(without.walkedWith, false, 'sin comedor no lleva jarras');
  const withHall = run(true);
  assert.equal(withHall.r, 'done');
  assert.ok(withHall.walkedWith, 'con comedor camina llevando las jarras');
  assert.ok(withHall.stock > 0, 'las jarras llegan al almacén');
  const near = Math.hypot(withHall.firstWater.x - withHall.storage.x, withHall.firstWater.z - withHall.storage.z);
  assert.ok(near < 3, `el agua se entrega en el almacén (a ${near.toFixed(1)} m)`);
}

console.log('dining.test.js: ok');
