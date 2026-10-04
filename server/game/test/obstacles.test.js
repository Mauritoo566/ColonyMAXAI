// Rodear obstáculos: un destino justo detrás de un tronco, de la fogata o de un edificio no deja al colono pegado contra
// el objeto ("Está en ello: va a comer" pero parado). Se camina con el paso real de la colonia (walk), sin red.
// Uso: node server/game/test/obstacles.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.colonists = [sim.colonists[0]];
  return sim;
}
const DT = 0.1;

// Camina de A a B; devuelve cómo acabó, cuánto tardó y lo más "bloqueado" que llegó a estar.
function walk(sim, A, B, maxSeconds = 60) {
  const c = sim.colonists[0];
  Object.assign(c, { x: A.x, z: A.z, blocked: 0, progress: null, detour: null, path: null, opath: null, recalc: false });
  let t = 0;
  let r = 'moving';
  let worst = 0;
  while (t < maxSeconds && r !== 'arrived' && r !== 'stuck') {
    sim.buildCrowd();
    r = sim.walk(c, B.x, B.z, DT, 0.5);
    worst = Math.max(worst, c.blocked ?? 0);
    t += DT;
  }
  return { r, t, worst };
}

const sim = colony();

// 1) Detrás de un tronco, al otro lado de la fogata y en la franja de atrás: llega sin atascarse.
for (const [A, B, why] of [
  [{ x: 6, z: 0 }, { x: 3.1, z: 1.2 }, 'a un asiento del hueco entre troncos, rodeando un tronco'],
  [{ x: 6, z: 0 }, { x: -6, z: 0 }, 'al otro lado de la fogata'],
  [{ x: 6, z: 0 }, { x: 4.24, z: -4.24 }, 'en un rincón entre tronco y leña'],
  [{ x: 0, z: 9 }, { x: 1.2, z: -3.1 }, 'a un asiento junto a la fogata, al otro lado'],
  [{ x: -9, z: 3 }, sim.layout.seats.filter((q) => q.kind === 'bench')[3].approach, 'al lado de fuera de un tronco, cruzando el campamento'],
]) {
  const res = walk(sim, A, B);
  assert.equal(res.r, 'arrived', `${why}: debe llegar (acabó en ${res.r})`);
  assert.ok(res.worst < 2.5, `${why}: no se queda pegado al objeto (bloqueado ${res.worst.toFixed(1)} s)`);
}

// 2) Barrido: de muchos puntos a muchos puntos del campamento, nadie se rinde ni se queda pegado.
{
  const pts = [];
  for (const r of [6, 9, 14]) for (let k = 0; k < 12; k++) pts.push({ x: Math.cos((k / 12) * Math.PI * 2) * r, z: Math.sin((k / 12) * Math.PI * 2) * r });
  for (const s of sim.layout.seats) pts.push(s.approach);
  pts.push(sim.layout.storage);
  let n = 0;
  const bad = [];
  for (const A of pts) {
    for (const B of pts) {
      if (A === B || Math.hypot(A.x - B.x, A.z - B.z) < 3) continue;
      if (!sim.walkable(A.x, A.z, 0.4) || !sim.walkable(B.x, B.z, 0.4)) continue;
      const res = walk(sim, A, B, 80);
      n++;
      if (res.r !== 'arrived' || res.worst > 2.5) bad.push(`${A.x.toFixed(1)},${A.z.toFixed(1)} -> ${B.x.toFixed(1)},${B.z.toFixed(1)} (${res.r}, bloqueado ${res.worst.toFixed(1)})`);
    }
  }
  assert.equal(bad.length, 0, `${bad.length}/${n} rutas se atascan: ${bad.slice(0, 5).join(' | ')}`);
}

// 3) Un destino dentro de un obstáculo (el borde de un edificio) no cuelga la simulación: se va derecho como antes.
{
  const res = walk(sim, { x: 12, z: 0 }, { x: 0, z: 0 }, 30);
  assert.ok(['arrived', 'stuck'].includes(res.r), 'termina (llega o se rinde), no se queda caminando para siempre');
}

console.log('obstacles.test.js: ok');
