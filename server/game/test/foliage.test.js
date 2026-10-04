// Follaje: se genera siempre igual, no sale en el agua ni en el claro de las aldeas ni donde se bloquea, la densidad lo aclara, el
// tiempo por fotograma está acotado y los InstancedMesh respetan sus topes.
// Uso: node server/game/test/foliage.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FoliageSystem, generateChunk, KINDS, CHUNK_M, RADIUS_FAR } from '../../../src/foliage.js';
import { RADIUS, surfaceHeight } from '../../../src/elevation.js';

const focus = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
const lat = Math.asin(focus.y);
const lon = Math.atan2(focus.x, focus.z);
const A = CHUNK_M / RADIUS;
const i = Math.floor(lat / A);
const cols = Math.max(1, Math.floor((Math.PI * 2 * Math.cos((i + 0.5) * A)) / A));
const j = Math.floor(((lon < 0 ? lon + Math.PI * 2 : lon) / (Math.PI * 2)) * cols);

// 1) Determinista y con contenido.
const a = generateChunk(i, j);
const b = generateChunk(i, j);
assert.equal(a.total, b.total, 'siempre el mismo follaje en el mismo sitio');
assert.deepEqual(Array.from(a.grass.pos.slice(0, 9)), Array.from(b.grass.pos.slice(0, 9)));
let chunksWith = 0;
for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) if (generateChunk(i + di, (j + dj + cols) % cols).total > 0) chunksWith++;
assert.ok(chunksWith > 0, 'en algún lado de la zona crece algo');

// 2) Nada bajo el agua; todo pegado al suelo.
const d = new THREE.Vector3();
for (const k of KINDS) {
  for (let q = 0; q < a[k].count; q++) {
    d.set(a[k].pos[q * 3], a[k].pos[q * 3 + 1], a[k].pos[q * 3 + 2]);
    const h = d.length() - RADIUS;
    assert.ok(h > 0.5, `${k} no está en el agua (${h.toFixed(2)})`);
    assert.ok(Math.abs(h - surfaceHeight(d.clone().normalize())) < 3, `${k} sobre el suelo`);
  }
}

// 3) Bloqueo: si algo lo prohíbe, no sale.
const none = generateChunk(i, j, { blocked: () => true });
assert.equal(none.total, 0, 'el bloqueo quita todo');

// 4) Sistema: tope de tiempo, de instancias y de densidad.
const scene = new THREE.Scene();
let density = 1;
const sys = new FoliageSystem(scene, { density: () => density });
const camera = new THREE.PerspectiveCamera();
for (let f = 0; f < 80; f++) {
  const t0 = performance.now();
  sys.update(camera, focus, 5, 0.2);
  assert.ok(performance.now() - t0 < 250, 'un fotograma no se bloquea');
}
const full = sys.stats.instances;
assert.ok(full > 0, `hay instancias (${full})`);
for (const k of KINDS) assert.ok(sys.meshes[k].count <= sys.meshes[k].instanceMatrix.count, 'respeta el tope');
assert.equal(Object.keys(sys.meshes).length, 8, 'ocho llamadas de dibujo');
density = 0.3;
for (let f = 0; f < 5; f++) sys.update(camera, focus, 5, 0.2);
assert.ok(sys.stats.instances < full * 0.6, `menos densidad, menos matas (${sys.stats.instances} < ${full})`);
// Muy alto: no se dibuja.
sys.update(camera, focus, 5000, 0.2);
assert.equal(sys.group.visible, false, 'desde lo alto no hay follaje');
// Nada más allá del radio.
sys.update(camera, focus, 5, 0.2);
for (const k of KINDS) {
  const m = sys.meshes[k];
  for (let q = 0; q < m.count; q++) assert.ok(Math.hypot(m.instanceMatrix.array[q * 16 + 12], m.instanceMatrix.array[q * 16 + 13], m.instanceMatrix.array[q * 16 + 14]) <= RADIUS_FAR + 3);
}
console.log('foliage.test.js: ok');
