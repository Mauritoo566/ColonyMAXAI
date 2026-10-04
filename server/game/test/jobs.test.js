// Puesto asignado a mano: es una orden. El colono no lo abandona por una obra o por recolectar lo marcado, aunque el oficio no
// sea de sus especialidades; el puesto que la colonia dio sola sí cede ante lo de sus especialidades.
// Uso: node server/game/test/jobs.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { chooseTask } from '../../../src/ai.js';

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

console.log('jobs.test.js: ok');
