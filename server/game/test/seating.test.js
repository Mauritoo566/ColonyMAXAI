// Calentarse junto a la fogata sentados: cada colono toma un sitio distinto (suelo o tronco), se reparten alrededor
// en vez de amontonarse, el estado "sentado" viaja por la red y el sitio se libera al terminar.
// Uso: node server/game/test/seating.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { runTask, endTask } from '../../../src/ai.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(n) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  const base = sim.colonists.slice();
  sim.colonists = [];
  for (let i = 0; i < n; i++) sim.colonists.push(i < base.length ? base[i] : { ...base[0], id: 100 + i, needs: { ...base[0].needs }, detour: null });
  for (const c of sim.colonists) {
    c.task = null;
    c.sleeping = false;
    c.needs.warmth = 10;
  }
  return sim;
}
const DT = 0.1;
const env = { isNight: false, gameTime: 0 };

// Todos salen juntos del mismo lado y se calientan a la vez.
{
  const N = 12;
  const sim = colony(N);
  sim.colonists.forEach((c, i) => {
    c.x = 9 + (i % 4) * 0.7;
    c.z = -2 + Math.floor(i / 4) * 0.7;
    c.task = { type: 'warm' };
  });
  for (let t = 0; t < 60; t += DT) {
    sim.buildCrowd();
    for (const c of sim.colonists) {
      c.walking = false;
      c.moveTick = false;
      c.sitting = null;
      c.waiting = false;
      runTask(sim, c, c.task, DT, env);
    }
  }
  const sitters = sim.colonists.filter((c) => c.sitting);
  assert.equal(sitters.length, N, `todos deberían estar sentados (${sitters.length}/${N})`);
  const seats = new Set(sim.colonists.map((c) => c.task.seat));
  assert.equal(seats.size, N, 'cada colono ocupa un sitio distinto');
  assert.ok(sim.colonists.some((c) => c.sitting === 'bench'), 'alguien se sienta en un tronco');
  assert.ok(sim.colonists.some((c) => c.sitting === 'ground'), 'alguien se sienta en el suelo');
  let nearest = Infinity;
  for (const a of sim.colonists) for (const b of sim.colonists) if (a !== b) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.z - b.z));
  assert.ok(nearest > 1.2, `no se solapan (distancia mínima ${nearest.toFixed(2)})`);
  // Repartidos alrededor: ocupan al menos 3 de los 4 cuadrantes de la fogata.
  const quadrants = new Set(sim.colonists.map((c) => (c.x >= 0 ? 1 : 0) + (c.z >= 0 ? 2 : 0)));
  assert.ok(quadrants.size >= 3, `repartidos alrededor (${quadrants.size} cuadrantes)`);
  // Siguen dentro del radio de calor de la fogata.
  for (const c of sim.colonists) assert.ok(Math.hypot(c.x, c.z) < 7, 'sentados dentro del calor de la fogata');

  // Por la red: el estado sentado se codifica y se lee igual.
  const snap = sim.snapshot('fast').colonists;
  const flagsOf = new Map(snap.map((row) => [row[0], row[4]]));
  for (const c of sim.colonists) {
    const f = flagsOf.get(c.id);
    assert.equal(!!(f & 512), c.sitting === 'bench');
    assert.equal(!!(f & 256), c.sitting === 'ground');
  }

  // Al terminar se libera el sitio.
  for (const c of sim.colonists) endTask(sim, c, c.task);
  assert.ok(sim.layout.seats.every((s) => !s.taken), 'los sitios quedan libres');
}

// Sin sitios libres, el resto se calienta de pie como antes (no se queda sin hacer nada).
{
  const sim = colony(2);
  const [c, other] = sim.colonists;
  for (const s of sim.layout.seats) s.taken = other;
  c.x = 8;
  c.z = 0;
  c.task = { type: 'warm' };
  for (let t = 0; t < 30; t += DT) {
    c.walking = false;
    runTask(sim, c, c.task, DT, env);
  }
  assert.equal(c.task.seat, null);
  assert.ok(Math.hypot(c.x, c.z) < 5, 'de pie junto al fuego');
  assert.equal(c.sitting ?? null, null);
}

console.log('seating.test.js: ok');
