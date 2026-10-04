// Subir de edad se celebra: todos los colonos reciben bienestar, el servidor manda un aviso global a TODOS los jugadores conectados (con
// dónde está la aldea) y el navegador lanza fuegos artificiales sobre ella (cohetes que suben, estallan y se apagan; luego se limpian).
// Uso: node server/game/test/celebration.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../world.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { startFireworks, updateFireworks, showCount } from '../../../src/fireworks.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();

// 1) El servidor avisa a todos los conectados, no sólo al dueño.
{
  const store = {
    meta: () => null,
    setMeta() {},
    sql: { allPlayers: { all: () => [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bruno' }] }, colonies: { all: () => [] } },
  };
  const logs = [];
  const world = new World({ store, log: (m) => logs.push(m) });
  const camp = { dir: { x: dir.x, y: dir.y, z: dir.z }, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 };
  const colony = world.createColony(1, camp);
  const inbox = { ana: [], bruno: [], lejos: [] };
  world.clients.add({ player: { id: 1 }, sendRaw: (t) => inbox.ana.push(JSON.parse(t)) });
  world.clients.add({ player: { id: 2 }, sendRaw: (t) => inbox.bruno.push(JSON.parse(t)) });
  world.clients.add({ player: { id: 3 }, sendRaw: (t) => inbox.lejos.push(JSON.parse(t)) });
  colony.sim.setVillageName('Colina Alta');
  colony.sim.emit('celebration', { age: 2, name: 'Edad de Piedra' });
  for (const [who, list] of Object.entries(inbox)) {
    const m = list.find((x) => x.t === 'celebrate');
    assert.ok(m, `${who} recibe el aviso global`);
    assert.equal(m.id, 1);
    assert.equal(m.player, 'Ana');
    assert.equal(m.village, 'Colina Alta');
    assert.equal(m.age, 2);
    assert.equal(m.ageName, 'Edad de Piedra');
    assert.ok(Math.abs(m.dir.x - dir.x) < 1e-9 && Number.isFinite(m.height), 'dice dónde está la aldea');
  }
  assert.ok(logs.some((l) => /Ana.*Edad de Piedra/.test(l)), 'queda en el registro del servidor');
}

// 2) Los fuegos artificiales: salen cohetes, estallan, brillan y se limpian solos.
{
  const scene = new THREE.Scene();
  const show = startFireworks(scene, dir, 10, { launches: 6, span: 4, seed: 0.42 });
  assert.equal(showCount(), 1);
  assert.equal(scene.children.length, 1);
  // Centrado en la aldea: su grupo está sobre el suelo, con su vertical.
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(show.group.quaternion);
  assert.ok(up.distanceTo(dir) < 1e-6, 'la vertical del espectáculo es la de la aldea');
  let now = 0;
  let peak = 0;
  let highest = 0;
  let bright = 0;
  const step = () => {
    updateFireworks((now += 0.05));
    peak = Math.max(peak, show.sparks);
    for (let i = 0; i < show.life.length; i++) {
      if (show.life[i] > 0) {
        highest = Math.max(highest, show.pos[i * 3 + 1]);
        bright = Math.max(bright, show.col[i * 3] + show.col[i * 3 + 1] + show.col[i * 3 + 2]);
      }
    }
  };
  updateFireworks(now); // fija la hora de partida
  for (let t = 0; t < 3; t += 0.05) step();
  assert.ok(show.bursts >= 1, 'ya estalló algún cohete');
  assert.ok(show.sparks > 50, `hay chispas (${show.sparks})`);
  for (let t = 0; t < 4; t += 0.05) step();
  assert.equal(show.bursts, 6, 'estallaron los seis cohetes');
  assert.ok(highest > 40, `las chispas llegan alto (${highest.toFixed(0)} m)`);
  assert.ok(bright > 0.5, 'brillan');
  assert.ok(peak <= 2600, 'sin pasarse del tope de chispas');
  // Todas las chispas siguen cerca de la aldea (nada se va a otro planeta).
  for (let i = 0; i < show.life.length; i++) {
    if (show.life[i] > 0) assert.ok(Math.hypot(show.pos[i * 3], show.pos[i * 3 + 2]) < 140, 'cerca de la aldea');
  }
  // Se acaba y se limpia solo.
  for (let t = 0; t < 12 && showCount() > 0; t += 0.05) step();
  assert.equal(showCount(), 0, 'el espectáculo termina');
  assert.equal(scene.children.length, 0, 'y se quita de la escena');
}

console.log('celebration.test.js: ok');
