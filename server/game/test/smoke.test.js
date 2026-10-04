// Humo de la cocina del comedor: sólo sale mientras alguien come dentro, sube y se desvanece, se apaga poco a poco y se limpia al quitar
// el edificio. Es un efecto del navegador, pero la lógica no necesita pantalla.
// Uso: node server/game/test/smoke.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { addChimneySmoke, updateSmokes, smokeCount, CHIMNEY } from '../../../src/chimneySmoke.js';
import { levelModel } from '../../../src/buildingModels.js';

const scene = new THREE.Scene();
const building = new THREE.Group();
scene.add(building);
let cooking = false;
const smoke = addChimneySmoke(building, () => cooking);
assert.equal(smokeCount(), 1);

let now = 0;
const run = (seconds) => {
  for (let t = 0; t < seconds; t += 0.1) updateSmokes((now += 0.1));
};

// 1) Cocina apagada: no hay humo.
updateSmokes(now);
run(3);
assert.equal(smoke.group.visible, false, 'sin nadie comiendo no sale humo');

// 2) Alguien come: la cocina se enciende y sale humo que sube y se desvanece.
cooking = true;
run(6);
assert.ok(smoke.level > 0.9, `la cocina se enciende (${smoke.level.toFixed(2)})`);
assert.equal(smoke.group.visible, true);
const ys = smoke.puffs.map((p) => p.position.y);
assert.ok(Math.max(...ys) > 4 && Math.min(...ys) < 1, 'hay bolitas a todas las alturas: sube de verdad');
for (const p of smoke.puffs) assert.ok(p.material.opacity >= 0 && p.material.opacity <= 0.56);
const top = smoke.puffs.reduce((a, b) => (a.position.y > b.position.y ? a : b));
assert.ok(top.material.opacity < 0.1, 'arriba casi se ha desvanecido');
assert.ok(top.scale.x > smoke.puffs.reduce((a, b) => (a.position.y < b.position.y ? a : b)).scale.x, 'y es más grande que al salir');
// Se mueven en el tiempo (no son esferas fijas).
const before = smoke.puffs.map((p) => p.position.y);
run(1);
assert.ok(smoke.puffs.some((p, i) => Math.abs(p.position.y - before[i]) > 0.3), 'se mueven');

// 3) Terminan de comer: el fuego tarda en apagarse, no corta de golpe.
cooking = false;
run(2);
assert.ok(smoke.level > 0.5 && smoke.group.visible, 'sigue saliendo humo un rato');
run(40);
assert.equal(smoke.group.visible, false, 'al final se apaga');

// 4) La boca de la chimenea coincide con la del modelo (la chimenea sobresale del tejado en CHIMNEY).
const model = levelModel('gen:hall:2:dining_hall');
const box = new THREE.Box3().setFromObject(model);
assert.ok(box.max.y >= CHIMNEY.y - 0.2, `la chimenea del modelo llega hasta la boca del humo (${box.max.y.toFixed(2)} vs ${CHIMNEY.y})`);
assert.ok(box.max.y < CHIMNEY.y + 1, 'sin esferas de humo falsas sobre la chimenea');

// 5) Al quitar el edificio de la escena el humo se limpia solo.
scene.remove(building);
run(0.2);
assert.equal(smokeCount(), 0, 'se limpia al quitar el edificio');

console.log('smoke.test.js: ok');
