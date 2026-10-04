// Plantar árboles: sólo planta el colono de una Cabaña del leñador (o mejor), dentro del radio de acción de su edificio, y nunca
// sobre edificios ni caminos. Lo talado de la arboleda y de los brotes propios tiene que llegar al dibujo (el servidor es la verdad).
// Uso: node server/game/test/planting.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { SPROUT_KEY } from '../../../src/resourceGen.js';
import { roadKey } from '../../../src/sim/economy.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  sim.setAge(2);
  sim.stock = { food: 900, water: 900, wood: 20, stone: 40, fiber: 40, tree_seed: 6 };
  sim.clothesLeft = 0;
  sim.colonists.forEach((c) => (c.clothed = true));
  return sim;
}
const tick = (sim, seconds) => {
  for (let t = 0; t < seconds; t += 0.5) {
    for (const k of ['food', 'water']) sim.stock[k] = 900;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
  }
};
const plantedSpots = (sim) => sim.spots.filter((s) => s.key === SPROUT_KEY && !s.gone && Number.isFinite(sim.sprouts[s.index]?.sown));
// Anota cada semilla plantada de verdad y con qué edificio.
const spy = (sim) => {
  const seeds = [];
  const orig = sim.plantTreeSeed.bind(sim);
  sim.plantTreeSeed = (...a) => {
    const r = orig(...a);
    if (r === null) seeds.push(a[3]);
    return r;
  };
  return seeds;
};
const hut = (sim, level) => {
  const b = sim.createBuilding(BUILDINGS.woodcutter, 62, 8, 0, 1, 0, level);
  b.progress = 1;
  b.done = true;
  return b;
};

// 1) Sin leñador, o con la zona de leña (nivel 1), nadie planta.
for (const level of [null, 1]) {
  const sim = colony();
  const seeds = spy(sim);
  if (level) {
    const b = hut(sim, level);
    sim.setWorker(b, sim.colonists.find((c) => !c.soldier && (c.growth ?? 1) >= 1));
  }
  tick(sim, 240);
  assert.equal(plantedSpots(sim).length, 0, `${level ? 'zona de leña' : 'sin leñador'}: no se planta ningún árbol`);
  assert.equal(seeds.length, 0, 'ninguna semilla plantada');
}

// 2) Con la Cabaña (nivel 2): el leñador planta, sólo dentro del radio de su edificio y fuera de edificios y caminos.
{
  const sim = colony();
  const seeds = spy(sim);
  const b = hut(sim, 2);
  const worker = sim.colonists.find((c) => !c.soldier && (c.growth ?? 1) >= 1);
  sim.setWorker(b, worker);
  assert.ok(b.workers.includes(worker));
  // Un camino cerca de la cabaña (tramo recto de casillas).
  for (let ix = 10; ix <= 20; ix++) sim.roads.set(roadKey(ix, 2), 1);
  tick(sim, 600);
  const planted = plantedSpots(sim);
  assert.ok(planted.length >= 1, 'nació algún árbol plantado');
  assert.ok(seeds.length >= 1, 'el leñador plantó semillas del almacén');
  assert.ok(seeds.every((x) => x === b), 'todas las semillas las plantó el colono de la cabaña, con su edificio');
  for (const s of planted) {
    assert.ok(Math.hypot(s.x - b.x, s.z - b.z) <= b.def.range + 8, `dentro del radio del leñador (${Math.hypot(s.x - b.x, s.z - b.z).toFixed(1)} m)`);
    assert.equal(sim.nearRoad(s.x, s.z), false, 'no sobre un camino');
    assert.equal(sim.blockedByBuilding(s.x, s.z), false, 'no dentro de una construcción');
  }
  // Los demás colonos no plantan: ninguno tiene la tarea plant.
  for (const c of sim.colonists) if (c !== worker) assert.notEqual(c.task?.type, 'plant');
}

// 3) Las reglas del sitio: fuera del radio no; sobre un camino o pegado a uno no; dentro de una construcción no.
{
  const sim = colony();
  const b = hut(sim, 2);
  for (let ix = 14; ix <= 18; ix++) sim.roads.set(roadKey(ix, 2), 1); // z = 8 (casilla 2), x = 56..72
  assert.match(sim.plantProblem(b.x + b.def.range + 5, b.z, b) ?? '', /radio de acción/, 'fuera del radio del leñador');
  assert.ok(sim.nearRoad(64, 8), 'encima del camino');
  assert.ok(sim.nearRoad(64, 8 + 2.5), 'pegado al camino (la cinta mide 3,4 m)');
  assert.equal(sim.nearRoad(64, 8 + 6), false, 'lejos del camino sí');
  assert.ok(sim.resourceSiteProblem(64, 8), 'no se puede en un camino');
  assert.ok(sim.resourceSiteProblem(b.x, b.z), 'no se puede dentro de un edificio');
  const c = sim.colonists[0];
  for (let k = 0; k < 40; k++) {
    const spot = sim.plantSpotFor(c, b);
    if (!spot) continue;
    assert.ok(Math.hypot(spot.x - b.x, spot.z - b.z) <= b.def.range, 'el lugar elegido está dentro del radio');
    assert.equal(sim.nearRoad(spot.x, spot.z), false);
  }
  assert.equal(sim.plantSpotFor(c, null), null, 'sin edificio no hay lugar donde plantar');
}

console.log('planting.test.js: ok');
