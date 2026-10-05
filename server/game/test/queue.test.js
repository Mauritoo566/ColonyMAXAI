// Filas: cuando varios colonos van a lo mismo a la vez (almacén, pila de ropa, pozo), el primero llega al punto y los demás esperan en fila detrás, sin
// amontonarse; cuando termina el primero, avanza el siguiente. Todos acaban atendidos.
// Uso: node server/game/test/queue.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(n = 8, age = 2) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(age);
  sim.stock = { food: 90, water: 90, wood: 99, stone: 20, fiber: 99 };
  sim.clothesLeft = 0;
  const base = sim.colonists[0];
  while (sim.colonists.length < n) {
    const id = 50 + sim.colonists.length;
    sim.colonists.push(sim.makeColonist({ ...sim.staticOf(base), id, name: `Extra${id}` }, { needs: { ...base.needs }, growth: 1, x: 6 + sim.colonists.length, z: 4 }));
  }
  for (const c of sim.colonists) {
    c.clothed = true;
    c.traits = [];
    c.task = null;
  }
  sim.mobs = [];
  return sim;
}

// 1) Muchos con hambre a la vez: nunca hay más de uno en el punto del almacén, los demás esperan en fila y todos acaban comiendo.
{
  const sim = colony(8);
  const point = sim.layout.storage;
  for (const c of sim.colonists) {
    c.needs.food = 15;
    c.needs.water = c.needs.rest = c.needs.warmth = 100;
    // todos cerca del almacén, a la vez
    const i = sim.colonists.indexOf(c);
    c.x = point.x + ((i % 4) - 1.5) * 1.5;
    c.z = point.z + (Math.floor(i / 4) - 0.5) * 3;
  }
  let maxAtPoint = 0;
  let crowded = 0;
  let waited = 0;
  let spacingOk = true;
  const before = sim.stock.food;
  for (let t = 0; t < 240; t += 0.5) {
    for (const c of sim.colonists) c.needs.water = c.needs.rest = c.needs.warmth = 100;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
    const eating = sim.colonists.filter((c) => c.task?.type === 'eat' && c.task.source !== 'bush');
    // (al principio todos están ya junto al almacén: se mira cuando se han colocado)
    if (t >= 20) {
      const atPoint = eating.filter((c) => Math.hypot(c.x - point.x, c.z - point.z) < 2.0).length;
      maxAtPoint = Math.max(maxAtPoint, atPoint);
      if (atPoint > 1) crowded++; // un instante al relevarse el primero con el siguiente
    }
    const waiters = eating.filter((c) => c.waitingTurn);
    waited = Math.max(waited, waiters.length);
    const still = waiters.filter((c) => !c.moving);
    for (let i = 0; i < still.length; i++) {
      for (let j = i + 1; j < still.length; j++) if (Math.hypot(still[i].x - still[j].x, still[i].z - still[j].z) < 0.55) spacingOk = false;
    }
  }
  assert.ok(maxAtPoint <= 2 && crowded <= 8, `casi nunca más de uno a la vez en el punto (máx. ${maxAtPoint}, ${crowded} instantes con más de uno)`);
  assert.ok(waited >= 2, `varios esperaron en fila (como mucho ${waited})`);
  assert.ok(spacingOk, 'los que esperan quietos no se pisan');
  assert.ok(sim.colonists.every((c) => c.needs.food > 40), `todos comieron: ${sim.colonists.map((c) => Math.round(c.needs.food))}`);
  assert.ok(before - sim.stock.food >= 8, 'cada uno cogió su comida');
}

// 2) La actividad dice que esperan su turno.
{
  const sim = colony(6);
  const point = sim.layout.storage;
  for (const c of sim.colonists) {
    c.needs.food = 15;
    c.x = point.x + 1;
    c.z = point.z + 1;
  }
  let said = false;
  for (let t = 0; t < 40 && !said; t += 0.5) {
    for (const c of sim.colonists) c.needs.water = c.needs.rest = c.needs.warmth = 100;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
    said = sim.colonists.some((c) => c.activity === 'Esperando su turno en la fila');
  }
  assert.ok(said, 'se ve "Esperando su turno en la fila"');
}

// 3) Si el primero abandona la fila (cambia de tarea), la fila avanza sola y no queda nadie reservado fantasma.
{
  const sim = colony(4);
  const point = sim.layout.storage;
  for (const c of sim.colonists) {
    c.needs.food = 15;
    c.x = point.x + 1;
    c.z = point.z + 1;
  }
  for (let t = 0; t < 10; t += 0.5) {
    for (const c of sim.colonists) c.needs.water = c.needs.rest = c.needs.warmth = 100;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
  }
  const q = sim.queues.get('storage');
  assert.ok(q && q.ids.length >= 2, 'hay fila en el almacén');
  const head = sim.colonists.find((c) => c.id === q.ids[0]);
  head.task = null; // lo manda otra cosa
  for (let t = 0; t < 1; t += 0.5) sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
  assert.notEqual(q.ids[0], head.id, 'ya no es el primero: la fila avanzó (si vuelve a tener hambre se pone al final)');
  assert.equal(new Set(q.ids).size, q.ids.length, 'nadie está dos veces en la fila');
}

// 4) En una obra no hacen fila: la rodean y construyen juntos, cada uno en su sitio.
{
  const sim = colony(8, 3);
  for (const c of sim.colonists) c.spec = ['building', 'gathering', 'hauling'];
  const b = sim.createBuilding(BUILDINGS.horse_stable, 24, 20, 0, 0, 0, 1);
  b.buildTime = 400; // que dure
  b.priority = 'high'; // hasta cinco constructores a la vez
  let most = 0;
  let spread = 0;
  for (let t = 0; t < 120; t += 0.5) {
    for (const c of sim.colonists) c.needs.food = c.needs.water = c.needs.rest = c.needs.warmth = 100;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
    const crew = sim.colonists.filter((c) => c.task?.type === 'build' && c.task.building === b && c.working);
    most = Math.max(most, crew.length);
    if (crew.length >= 4 && t > 60) {
      // ocupan sitios distintos de los alrededores y están repartidos por distintos lados
      const slots = new Set(crew.map((c) => c.task.berth?.k));
      assert.equal(slots.size, crew.length, 'cada constructor tiene su propio sitio');
      const angles = crew.map((c) => Math.atan2(c.z - b.z, c.x - b.x)).sort((a, z) => a - z);
      let widest = 0;
      for (let i = 0; i < angles.length; i++) widest = Math.max(widest, (angles[(i + 1) % angles.length] - angles[i] + Math.PI * 2) % (Math.PI * 2));
      spread = Math.max(spread, 2 * Math.PI - widest); // cuánto de la vuelta cubren
      for (let i = 0; i < crew.length; i++) for (let j = i + 1; j < crew.length; j++) assert.ok(Math.hypot(crew[i].x - crew[j].x, crew[i].z - crew[j].z) > 1.0, 'no se pisan');
    }
  }
  assert.ok(most >= 4, `varios construyen a la vez (hubo ${most})`);
  assert.ok(spread > Math.PI, `rodean la obra, no se juntan en un lado (cubren ${Math.round((spread * 180) / Math.PI)}°)`);
}

console.log('queue.test.js: ok');
