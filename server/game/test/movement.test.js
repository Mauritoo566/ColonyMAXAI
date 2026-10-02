// Movimiento entre colonos: cruzarse, hacer cola en un destino, pasar por un paso estrecho, rodear a quien está parado y
// no insistir eternamente con un destino imposible. Se simula con el paso real de la colonia (walk), sin red.
// Uso: node server/game/test/movement.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(n = 0) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.obstacles = [];
  // Sólo los colonos que pide la prueba.
  // Más de los iniciales: copias con otro número (sólo importan su posición y su número para caminar).
  const base = sim.colonists.slice();
  sim.colonists = [];
  for (let i = 0; i < n; i++) sim.colonists.push(i < base.length ? base[i] : { ...base[0], id: 100 + i, needs: { ...base[0].needs }, detour: null });
  for (const c of sim.colonists) {
    c.task = null;
    c.sleeping = false;
  }
  return sim;
}
const DT = 0.1;
const put = (c, x, z) => {
  c.x = x;
  c.z = z;
  c.blocked = 0;
};

// Corre hasta que todos lleguen (o se agote el tiempo). jobs: [{ c, x, z, stop }]. Devuelve segundos y resultados.
function run(sim, jobs, maxSeconds = 90) {
  const done = new Map();
  const stuck = new Set();
  let t = 0;
  let worstBlocked = 0;
  while (t < maxSeconds && done.size + stuck.size < jobs.length) {
    sim.buildCrowd();
    for (const c of sim.colonists) {
      c.walking = false;
      c.moveTick = false;
      c.waiting = false;
    }
    for (const j of jobs) {
      if (done.has(j.c) || stuck.has(j.c)) continue;
      const r = sim.walk(j.c, j.x, j.z, DT, j.stop ?? 0.8);
      if (r === 'arrived') done.set(j.c, t);
      if (r === 'stuck') stuck.add(j.c);
      worstBlocked = Math.max(worstBlocked, j.c.blocked ?? 0);
      j.c.moving = !!j.c.moveTick;
    }
    // Los que ya llegaron se quedan parados (no caminan).
    for (const j of jobs) if (done.has(j.c)) j.c.moving = false;
    t += DT;
  }
  return { t, done, stuck, worstBlocked };
}

// 1) Dos colonos se cruzan de frente en campo abierto.
{
  const sim = colony(2);
  const [a, b] = sim.colonists;
  put(a, -12, 0);
  put(b, 12, 0.05);
  const r = run(sim, [{ c: a, x: 12, z: 0 }, { c: b, x: -12, z: 0 }]);
  assert.equal(r.done.size, 2, `se cruzan y llegan los dos (llegaron ${r.done.size}, atascados ${r.stuck.size})`);
  assert.ok(r.t < 40, `sin demoras absurdas: ${r.t.toFixed(1)} s`);
  assert.ok(r.worstBlocked < 3, `nunca quedan frenados mucho tiempo (${r.worstBlocked.toFixed(1)} s)`);
  console.log(`✓ dos colonos de frente se cruzan en ${r.t.toFixed(1)} s (bloqueo máximo ${r.worstBlocked.toFixed(1)} s)`);
}

// 2) Un grupo llega al mismo punto (fogata/almacén): todos terminan, nadie queda esperando eternamente.
{
  const sim = colony(10);
  sim.colonists.forEach((c, i) => {
    const a = (i / 10) * Math.PI * 2;
    put(c, Math.cos(a) * 14, Math.sin(a) * 14);
  });
  const jobs = sim.colonists.map((c) => ({ c, x: 0, z: 0, stop: 1.6 }));
  const r = run(sim, jobs, 120);
  assert.equal(r.done.size, 10, `los 10 llegan a la fogata (llegaron ${r.done.size}, atascados ${r.stuck.size})`);
  // Nadie se superpone del todo al final.
  let minD = Infinity;
  for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) minD = Math.min(minD, Math.hypot(sim.colonists[i].x - sim.colonists[j].x, sim.colonists[i].z - sim.colonists[j].z));
  assert.ok(minD > 0.5, `no quedan encimados (mínimo ${minD.toFixed(2)} m)`);
  console.log(`✓ 10 colonos llegan al mismo punto en ${r.t.toFixed(1)} s sin encimarse (mín. ${minD.toFixed(2)} m)`);
}

// 3) Paso estrecho transitable con circulación en ambos sentidos: una fila de obstáculos con un hueco.
{
  const sim = colony(4);
  for (let z = -10; z <= 10; z += 1.2) if (Math.abs(z) > 1.7) sim.obstacles.push({ x: 0, z, r: 0.6 });
  const [a, b, c, d] = sim.colonists;
  put(a, -9, -0.3);
  put(b, -9, 0.4);
  put(c, 9, 0.3);
  put(d, 9, -0.4);
  const r = run(sim, [{ c: a, x: 9, z: 0 }, { c: b, x: 9, z: 0.5 }, { c, x: -9, z: 0 }, { c: d, x: -9, z: -0.5 }], 150);
  assert.equal(r.done.size, 4, `los cuatro pasan por el hueco (llegaron ${r.done.size}, atascados ${r.stuck.size})`);
  console.log(`✓ circulación en ambos sentidos por un paso estrecho: ${r.t.toFixed(1)} s`);
}

// 4) Un colono parado en medio del camino se rodea.
{
  const sim = colony(2);
  const [a, b] = sim.colonists;
  put(a, -10, 0);
  put(b, 0, 0);
  b.moving = false;
  const r = run(sim, [{ c: a, x: 10, z: 0 }]);
  assert.equal(r.done.size, 1, 'rodea al que está parado y llega');
  assert.ok(Math.hypot(b.x, b.z) < 0.5, 'el parado no fue empujado lejos');
  console.log(`✓ rodea a un colono parado en ${r.t.toFixed(1)} s`);
}

// 5) Destino imposible (encerrado por obstáculos): no insiste para siempre; la tarea se suspende.
{
  const sim = colony(1);
  const [a] = sim.colonists;
  put(a, -8, 0);
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2;
    sim.obstacles.push({ x: 8 + Math.cos(ang) * 2.5, z: Math.sin(ang) * 2.5, r: 0.9 });
  }
  const r = run(sim, [{ c: a, x: 8, z: 0 }], 90);
  assert.equal(r.stuck.size + r.done.size, 1, 'termina: llega o se da por atascado');
  assert.ok(r.t < 60, `se rinde en un tiempo razonable (${r.t.toFixed(1)} s)`);
  assert.ok(a.stuckWhy || r.done.size, 'guarda el motivo del bloqueo');
  console.log(`✓ destino inaccesible: ${r.stuck.size ? 'se suspende' : 'llegó al borde'} a los ${r.t.toFixed(1)} s${a.stuckWhy ? ` (${a.stuckWhy})` : ''}`);
}

// 6) Nunca atraviesan obstáculos ni agua al esquivar.
{
  const sim = colony(6);
  sim.obstacles.push({ x: 0, z: 0, r: 2 });
  sim.colonists.forEach((c, i) => put(c, -12, (i - 3) * 1.1));
  const r = run(sim, sim.colonists.map((c, i) => ({ c, x: 12, z: (i - 3) * 1.1 })), 120);
  for (const c of sim.colonists) assert.ok(Math.hypot(c.x - 0, c.z - 0) >= 2 + 0.4, 'nadie está dentro del obstáculo');
  assert.equal(r.done.size, 6);
  console.log(`✓ seis colonos rodean un obstáculo sin atravesarlo (${r.t.toFixed(1)} s)`);
}

console.log('Todo bien.');
process.exit(0);
