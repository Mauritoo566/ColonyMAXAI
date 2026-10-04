// Los colonos prefieren ir por los caminos: si hay uno que lleve hacia el destino van por él (un 3 % más rápido en el de tierra); si no hay
// camino, o rodearía demasiado, van por donde quieran.
// Uso: node server/game/test/roadpath.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { ROAD_LEVELS, roadKey, roadSpeed} from '../../../src/sim/economy.js';
import { RoadMap, roadRoute } from '../../../src/sim/roadpath.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
const colony = () => {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(2);
  return sim;
};
const line = (map, ix0, ix1, iz) => {
  for (let ix = ix0; ix <= ix1; ix++) map.set(roadKey(ix, iz), 1);
};

// 0) El camino de tierra da un 3 % de velocidad.
assert.equal(ROAD_LEVELS[0].speed, 1.03);
assert.ok(ROAD_LEVELS.every((l, i, a) => !i || l.speed >= a[i - 1].speed));

// 1) La ruta: por el camino si lleva hacia allá y no rodea demasiado; null si no hay camino, está lejos o rodearía mucho.
{
  const roads = new RoadMap();
  assert.equal(roadRoute(roads, -20, -12, 20, -12), null, 'sin caminos no hay ruta');
  line(roads, -6, 6, -2); // z = -8
  const route = roadRoute(roads, -20, -12, 20, -12);
  assert.ok(route, 'hay ruta por el camino');
  assert.ok(route.every((p) => p.z === -8), 'va por las casillas del camino');
  assert.equal(route[0].x, -20, 'entra por la casilla más cercana');
  assert.equal(route[route.length - 1].x, 20, 'y sale por la más cercana al destino');
  assert.equal(roadRoute(roads, -20, -12, -14, -12), null, 'trayecto corto: no busca camino');
  assert.equal(roadRoute(roads, -20, 60, 20, 60), null, 'camino lejos: no se desvía a él');
  const rev = roads.rev;
  roads.set(roadKey(9, 9), 1);
  assert.ok(roads.rev > rev, 'RoadMap cuenta los cambios');
  // Rodearía demasiado: el camino se va en otra dirección.
  const far = new RoadMap();
  line(far, -2, 2, -2);
  for (let iz = -2; iz < 12; iz++) far.set(roadKey(2, iz), 1);
  assert.equal(roadRoute(far, -4, -8, 5, -60), null, 'un camino que se aleja del destino no se usa');
  // Un camino en L: la ruta sigue la esquina.
  const ell = new RoadMap();
  line(ell, 0, 4, 0);
  for (let iz = 1; iz <= 3; iz++) ell.set(roadKey(4, iz), 1);
  const r2 = roadRoute(ell, 0, 0, 16, 12);
  assert.ok(r2 && r2.length === 3, 'ruta con una esquina');
  assert.deepEqual(r2[1], { x: 16, z: 0 }, 'la esquina del camino');
}

// 2) En la simulación: con un camino cerca y paralelo al trayecto, el colono va por él y más rápido; sin camino, va derecho.
const trip = (withRoad) => {
  const sim = colony();
  if (withRoad) line(sim.roads, -6, 6, -2); // z = -8, de x = -24 a 24
  const c = sim.colonists[0];
  c.x = -20;
  c.z = -12;
  c.needs.food = c.needs.water = c.needs.rest = c.needs.warmth = 100;
  const seen = [];
  let t = 0;
  for (; t < 120; t += 0.1) {
    const r = sim.walk(c, 20, -12, 0.1, 0.6);
    seen.push([c.x, c.z]);
    if (r === 'arrived') break;
  }
  return { t, seen, sim, c };
};
{
  const free = trip(false);
  assert.ok(free.t < 120, 'llega sin camino');
  assert.ok(free.seen.every(([, z]) => Math.abs(z + 12) < 2), 'sin camino va derecho (por donde quiere)');
  const road = trip(true);
  assert.ok(road.t < 120, 'llega por el camino');
  const onRoad = road.seen.filter(([, z]) => Math.abs(z + 8) < 1.7).length;
  assert.ok(onRoad > road.seen.length * 0.5, `la mayor parte del trayecto va sobre el camino (${onRoad}/${road.seen.length})`);
  assert.ok(Math.hypot(road.c.x - 20, road.c.z + 12) < 1.5, 'y llega a su destino');
  // Cambiar los caminos rehace la ruta (no sigue por un camino que ya no está).
  const sim = road.sim;
  const c = sim.colonists[1];
  c.x = -20;
  c.z = -12;
  for (let k = 0; k < 40; k++) sim.walk(c, 20, -12, 0.1, 0.6);
  assert.ok(c.rpath && !c.rpath.none, 'tiene una ruta por camino');
  sim.roads.clear();
  for (let k = 0; k < 5; k++) sim.walk(c, 20, -12, 0.1, 0.6);
  assert.ok(!c.rpath || c.rpath.none, 'sin caminos vuelve a ir por donde quiere');
  assert.equal(roadSpeed(sim, 0, 0), 1);
}

console.log('roadpath.test.js: ok');
