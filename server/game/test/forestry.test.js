// Leñador: desde la Cabaña (nivel 2) tala árboles y replanta; el brote tarda en crecer y no se puede talar hasta entonces; un bosque
// plantado no deja sin ramas a la aldea; y la zona de leña (nivel 1) explica qué hacer cuando no quedan palos.
// Uso: node server/game/test/forestry.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { DAY_LENGTH_SECONDS } from '../../../src/daynight.js';

const dirs = [
  new THREE.Vector3(-0.5273752893525795, 0.8349520874337516, -0.15725875451085092).normalize(), // taiga con bosque
  new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize(),
];
function colony(dir) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  sim.stock = { food: 900, water: 900, wood: 20, stone: 40, fiber: 40 };
  return sim;
}
const tick = (sim, seconds) => {
  for (let t = 0; t < seconds; t += 0.5) {
    for (const k of ['food', 'water']) sim.stock[k] = 900;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
  }
};

let sim;
let treeSpot;
for (const d of dirs) {
  sim = colony(d);
  treeSpot = sim.spots.filter((s) => s.tree && !s.gone && Math.hypot(s.x, s.z) > 55 && Math.hypot(s.x, s.z) < 90).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  if (treeSpot && sim.spots.filter((s) => s.tree && Math.hypot(s.x - treeSpot.x, s.z - treeSpot.z) < 50).length > 6) break;
}
assert.ok(treeSpot, 'hay un bosque cerca para la prueba');

// 1) Nivel 1: sin palos, el mensaje dice qué hacer.
{
  const t1 = BUILDINGS.woodcutter.levels[0];
  assert.match(t1.noResourceText, /Edad de Piedra.*replanta/);
  const t2 = BUILDINGS.woodcutter.levels[1];
  assert.ok(!t2.noResourceText, 'el nivel 2 no repite el consejo de mejorar');
  assert.equal(BUILDINGS.woodcutter.replantFrom, 2);
  console.log('✓ mensajes del leñador según el nivel');
}

// 2) Cabaña (nivel 2): talar y replantar.
sim.setAge(2);
const wc = sim.createBuilding(BUILDINGS.woodcutter, treeSpot.x + 6, treeSpot.z + 6, 0, 1, 0, 2);
wc.progress = 1;
wc.done = true;
sim.clothesLeft = 0;
sim.colonists.forEach((c) => (c.clothed = true));
const worker = sim.colonists.find((c) => !c.soldier && (c.growth ?? 1) >= 1);
sim.setWorker(wc, worker);
assert.ok(wc.workers.length >= 1, 'el leñador tiene a alguien');
const treesBefore = sim.spots.filter((s) => s.tree && !s.gone).length;
assert.equal(sim.plantedSprouts(), 0);
tick(sim, DAY_LENGTH_SECONDS * 0.6);
console.log('estado:', wc.status, '|', worker.activity, '| trabajadores', wc.workers.length);
const planted = sim.plantedSprouts();
assert.ok(wc.produced > 0, `produjo madera (${wc.produced})`);
assert.ok(planted > 0, `replantó (${planted} brotes) al talar`);
assert.ok((wc.replanted ?? 0) > 0 && planted >= wc.replanted, 'cada árbol talado por el leñador se replantó (los colonos pueden sumar los suyos con las semillas)');
const treesAfter = sim.spots.filter((s) => s.tree && !s.gone).length;
console.log(`✓ el leñador replantó ${wc.replanted} árboles (produjo ${wc.produced})`);

// 3) El brote no se puede talar hasta que crece.
{
  const young = sim.spots.find((s) => s.key === 'sprout' || (s.tree && s.readyAt > sim.gameTime));
  assert.ok(young, 'hay un brote creciendo');
  assert.ok(sim.nearestSpot('wood', young.x, young.z, 1, sim.gameTime) !== young, 'un brote joven no se elige para talar');
  assert.ok(young.readyAt > sim.gameTime);
  const wait = young.readyAt - sim.gameTime;
  assert.ok(wait > 0 && wait <= DAY_LENGTH_SECONDS, `tarda un rato en crecer (${Math.round(wait)} s de juego)`);
  console.log('✓ el brote tarda en crecer y no se talá antes de tiempo');
}

// 4) Un bosque plantado no agota las ramas ni los brotes espontáneos.
{
  const s2 = colony(dirs[1]);
  s2.setAge(1);
  for (let i = 0; i < 100; i++) {
    const spot = { tree: true, type: 'broadleaf', x: 60 + (i % 10) * 4, z: -60 + Math.floor(i / 10) * 4 };
    s2.replantAt(spot, 0);
  }
  assert.ok(s2.plantedSprouts() >= 50, `muchos plantados (${s2.plantedSprouts()})`);
  assert.ok(s2.wildSprouts() < 50, 'los plantados no cuentan como espontáneos');
  const hut = s2.createBuilding(BUILDINGS.woodcutter, 18, 18, 0, 1, 0, 1); // cerca de la fogata: dentro del claro
  const lit = s2.spawnLitter('wood', hut);
  assert.ok(lit, 'aún aparecen ramas junto a la zona de leña (no se bloquea por los árboles plantados)');
  console.log('✓ el bosque plantado no deja sin ramas a la zona de leña');
}

console.log('Todo bien.');
process.exit(0);
