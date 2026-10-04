// Animales: rodean edificios y muros en vez de quedarse empujando contra ellos (también cuando persiguen a un colono).
// Uso: node server/game/test/mobs.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { updateMobs } from '../../../src/sim/mobs.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.colonists = [];
  sim.absent = false;
  return sim;
}
const mob = (type, x, z, tx, tz, extra = {}) => ({ id: 1, type, x, z, facing: 0, state: 1, wait: 0, tx, tz, cd: 0, target: null, g: null, leader: true, ox: 0, oz: 0, ...extra });

// 1) Un animal que camina hacia un punto con un edificio grande justo en medio llega, sin atravesarlo.
for (const type of ['ciervo', 'lobo']) {
  const sim = colony();
  sim.obstacles = [{ x: 70, z: 0, r: 7, kind: 'building' }];
  const m = mob(type, 55, 0, 90, 0);
  sim.mobs = [m];
  let reached = false;
  let inside = false;
  for (let t = 0; t < 90 && !reached; t += 0.1) {
    updateMobs(sim, 0.1, false);
    if (Math.hypot(m.x - 70, m.z) < 7) inside = true;
    if (Math.hypot(m.x - 90, m.z) < 1.5) reached = true;
    if (m.state === 0 && !reached) {
      // Si llegó a esperar sin haber llegado (cambió de rumbo por aburrimiento), se le vuelve a dar el destino.
      m.tx = 90;
      m.tz = 0;
      m.state = 1;
      m.wait = 0;
    }
  }
  assert.ok(reached, `${type}: llega al otro lado del edificio (acabó en ${m.x.toFixed(1)}, ${m.z.toFixed(1)})`);
  assert.equal(inside, false, `${type}: no atraviesa el edificio`);
}

// 2) Un lobo que persigue de noche a un colono escondido tras un edificio da la vuelta y lo alcanza.
{
  const sim = colony();
  sim.obstacles = [{ x: 70, z: 0, r: 7, kind: 'building' }];
  const victim = { id: 5, x: 84, z: 0, inside: false, sleeping: false, health: 100, needs: { mood: 60 }, moodEvents: undefined };
  sim.colonists = [victim];
  const wolf = mob('lobo', 58, 0, 58, 0, { state: 0, wait: 5 });
  sim.mobs = [wolf];
  let inside = false;
  let bitten = false;
  for (let t = 0; t < 60 && !bitten; t += 0.1) {
    updateMobs(sim, 0.1, true); // de noche
    if (Math.hypot(wolf.x - 70, wolf.z) < 7) inside = true;
    if (victim.health < 100) bitten = true;
  }
  assert.ok(bitten, `el lobo rodea el edificio y alcanza a su presa (está en ${wolf.x.toFixed(1)}, ${wolf.z.toFixed(1)})`);
  assert.equal(inside, false, 'sin atravesar el edificio');
  assert.equal(wolf.state, 2, 'estaba cazando');
}

console.log('mobs.test.js: ok');
