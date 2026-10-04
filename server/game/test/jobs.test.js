// Puesto asignado a mano: es una orden. El colono no lo abandona por una obra o por recolectar lo marcado, aunque el oficio no
// sea de sus especialidades; el puesto que la colonia dio sola sí cede ante lo de sus especialidades.
// Uso: node server/game/test/jobs.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { chooseTask, runTask } from '../../../src/ai.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  sim.setAge(2);
  sim.stock = { food: 900, water: 900, wood: 99, stone: 0, fiber: 99 };
  sim.clothesLeft = 0;
  for (const c of sim.colonists) {
    c.clothed = true;
    c.needs = { food: 100, water: 100, rest: 100, warmth: 100, mood: 80 };
    c.task = null;
  }
  return sim;
}
const env = { isNight: false, gameTime: 100 };

function setup(manual) {
  const sim = colony();
  const quarry = sim.createBuilding(BUILDINGS.quarry, 24, 12, 0, 1, 0, 1);
  quarry.done = true;
  quarry.progress = 1;
  const worker = sim.colonists.find((c) => !c.soldier && (c.growth ?? 1) >= 1);
  // Sus especialidades NO incluyen la cantería: antes un puesto a mano valía como última opción.
  worker.spec = ['building', 'gathering', 'woodcutting'];
  sim.setWorker(quarry, worker, manual ? 'Elegido por ti.' : 'La colonia lo eligió.', !manual);
  // Una obra que su especialidad "building" preferiría.
  const site = sim.createBuilding(BUILDINGS.stockpile, 24, -12, 0, 0, 0);
  site.done = false;
  site.progress = 0;
  return { sim, quarry, worker, site };
}

// 1) A mano: se queda en su puesto aunque haya una obra de su especialidad.
{
  const { sim, quarry, worker } = setup(true);
  assert.equal(worker.jobAuto, false);
  const task = chooseTask(sim, worker, env);
  assert.equal(task?.type, 'work', `sigue en su puesto (eligió ${task?.type})`);
  assert.equal(task.building, quarry);
}

// 2) Sólo lo eligió la colonia y no es de sus especialidades: la obra de su especialidad pasa delante.
{
  const { sim, worker, site } = setup(false);
  const task = chooseTask(sim, worker, env);
  assert.equal(task?.type, 'build', `lo automático cede ante lo de sus especialidades (eligió ${task?.type})`);
  assert.equal(task.building, site);
}


// 3) Almacén lleno: no se queda esperando; sigue con el siguiente trabajo y vuelve en cuanto hay sitio.
{
  const sim = colony();
  const gatherer = sim.createBuilding(BUILDINGS.gatherer, 24, 12, 0, 1, 0, 1);
  gatherer.done = true;
  gatherer.progress = 1;
  const worker = sim.colonists.find((c) => !c.soldier && (c.growth ?? 1) >= 1);
  worker.spec = ['gathering', 'building', 'woodcutting'];
  sim.setWorker(gatherer, worker, 'La colonia lo eligió.', true);
  const site = sim.createBuilding(BUILDINGS.stockpile, 24, -12, 0, 0, 0);
  site.done = false;
  site.progress = 0;
  // Con sitio: su puesto (su primera especialidad).
  sim.stock.food = 5;
  assert.equal(chooseTask(sim, worker, env)?.type, 'work');
  // Lleno: no le ofrece ese puesto y pasa a lo siguiente (la obra).
  sim.stock.food = sim.capacity('food');
  assert.ok(sim.isFull('food'));
  const next = chooseTask(sim, worker, env);
  assert.equal(next?.type, 'build', `con el almacén lleno sigue con otro trabajo (eligió ${next?.type})`);
  // Y se avisa en pantalla de que el almacén lleno detiene la producción (una sola vez, no a cada intento).
  const avisos = [];
  sim.on('notice', (t) => avisos.push(t));
  // Si ya estaba en la tarea cuando se llenó, la termina enseguida (no espera 20 s parado).
  worker.task = { type: 'work', building: gatherer, phase: 'start' };
  let r = 'running';
  let t = 0;
  for (; t < 5 && r === 'running'; t += 0.1) {
    sim.buildCrowd();
    r = runTask(sim, worker, worker.task, 0.1, env);
  }
  assert.equal(r, 'done');
  assert.ok(t < 1, `termina al instante (${t.toFixed(1)} s)`);
  assert.equal(avisos.filter((a) => /almacén está lleno de comida/i.test(a)).length, 1, 'avisa una vez de que el almacén lleno detiene la producción');
  worker.task = { type: 'work', building: gatherer, phase: 'start' };
  sim.buildCrowd();
  runTask(sim, worker, worker.task, 0.1, env);
  assert.equal(avisos.filter((a) => /almacén está lleno de comida/i.test(a)).length, 1, 'no se repite enseguida');
  // En cuanto hay sitio, vuelve.
  sim.stock.food = 0;
  assert.equal(chooseTask(sim, worker, env)?.type, 'work', 'vuelve a su puesto cuando hay sitio');
}

// 4) Un puesto de producción sin materiales o sin sitio para lo que sale: el trabajador no se queda parado, y vuelve cuando se puede.
{
  const sim = colony();
  sim.setAge(3);
  const def = BUILDINGS.bakery;
  const b = sim.createBuilding(def, 24, 12, 0, 1, 0, 1);
  b.done = true;
  b.progress = 1;
  const worker = sim.colonists.find((c) => !c.soldier && (c.growth ?? 1) >= 1);
  worker.spec = [def.skill, ...['building', 'gathering', 'woodcutting', 'mining'].filter((x) => x !== def.skill).slice(0, 2)];
  sim.setWorker(b, worker, 'La colonia lo eligió.', true);
  const recipe = def.levels[0].recipe;
  // Sin entradas: se va a otra cosa.
  for (const k of Object.keys(recipe.in)) sim.stock[k] = 0;
  assert.notEqual(chooseTask(sim, worker, env)?.type, 'work', 'sin materiales no se queda en el puesto');
  worker.task = { type: 'work', building: b, phase: 'start' };
  sim.buildCrowd();
  assert.equal(runTask(sim, worker, worker.task, 0.1, env), 'done', 'si estaba allí, se va');
  // Con entradas y sitio: vuelve.
  for (const [k, n] of Object.entries(recipe.in)) sim.stock[k] = n * 4;
  assert.equal(chooseTask(sim, worker, env)?.type, 'work', 'vuelve cuando hay materiales');
}

console.log('jobs.test.js: ok');
