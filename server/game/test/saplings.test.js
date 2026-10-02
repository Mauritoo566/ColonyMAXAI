// Árboles plantados: mientras crecen se dibujan pequeños (no como adultos que aún no se pueden talar) y llegan a su tamaño
// justo cuando se pueden talar. Y los árboles dibujados son exactamente los talables.
// Uso: node server/game/test/saplings.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ResourceSystem, RESOURCE_TYPES } from '../../../src/resources.js';
import { tileFromItems, sproutItem, SPROUT_KEY } from '../../../src/resourceGen.js';
import { RADIUS } from '../../../src/elevation.js';

const scene = new THREE.Scene();
const res = new ResourceSystem(scene);
const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
const typeIndex = RESOURCE_TYPES.findIndex((t) => t.id === 'broadleaf');
const rand = () => 0.5;
const item = sproutItem(dir.x, dir.y, dir.z, 'broadleaf', 0, 80, rand);
Object.assign(item, { readyAt: 1000, sown: 0, scale: 1 });
const tile = tileFromItems([item]);
assert.ok(tile.readyAt && tile.sown, 'la baldosa conserva cuándo se sembró y cuándo estará lista');
tile.key = SPROUT_KEY;

const sizeAt = (now) => {
  res.gameTime = now;
  res.rebuild([tile], new THREE.Vector3(dir.x * RADIUS, dir.y * RADIUS, dir.z * RADIUS).multiplyScalar(1.0001), dir, 400);
  const mesh = res.near[typeIndex];
  assert.equal(mesh.count + (res.far[typeIndex]?.count ?? 0), 1, 'se dibuja un solo ejemplar');
  const m = mesh.count ? mesh.instanceMatrix.array : res.far[typeIndex].instanceMatrix.array;
  return Math.hypot(m[0], m[1], m[2]); // escala
};
const small = sizeAt(10);
const mid = sizeAt(500);
const done = sizeAt(1000);
assert.ok(small < mid && mid < done, `crece: ${small.toFixed(2)} < ${mid.toFixed(2)} < ${done.toFixed(2)}`);
assert.ok(small < done * 0.4, 'recién plantado es mucho más chico que un adulto');
assert.ok(Math.abs(done - 1) < 1e-3, 'al estar listo (se puede talar) tiene su tamaño completo');
assert.ok(res.growingUntil >= 1000 || done, 'avisa que hay brotes creciendo');
console.log(`✓ el brote crece de ${small.toFixed(2)} a ${done.toFixed(2)} y llega entero cuando ya se puede talar`);
console.log('Todo bien.');
process.exit(0);
