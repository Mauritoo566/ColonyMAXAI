// Nubes: bolitas abolladas de base plana con normales suaves y degradado de color (sin gastar más triángulos), cúmulos con torre central, borde
// luminoso y "respiración" hechos en el sombreador (sin coste en el procesador). El tope de instancias se respeta.
// Uso: node server/game/test/clouds.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createClouds, puffGeometry, blobGeometry, cloudMaterial, cloudFade } from '../../../src/clouds.js';
import { RADIUS } from '../../../src/elevation.js';

// 1) La forma: los mismos triángulos de antes (80 y 20), vértices soldados (superficie continua) y sin valores raros.
for (const [g, tris] of [[puffGeometry, 80], [blobGeometry, 20]]) {
  assert.equal(g.index.count / 3, tris, `${tris} triángulos`);
  assert.ok(g.attributes.position.count < tris * 3 * 0.6, 'vértices soldados: normales suaves');
  for (const name of ['position', 'normal', 'color']) assert.ok([...g.attributes[name].array].every(Number.isFinite), `${name} válido`);
  const pos = g.attributes.position;
  let minY = Infinity;
  let sphere = 0;
  for (let i = 0; i < pos.count; i++) {
    minY = Math.min(minY, pos.getY(i));
    sphere = Math.max(sphere, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  assert.ok(minY >= -0.25 - 1e-6, 'base plana');
  assert.ok(sphere > 1.05, 'abollada: no es una pelota perfecta');
  // Degradado: arriba más claro que abajo.
  const col = g.attributes.color;
  let lo = [0, 0];
  let hi = [0, 0];
  for (let i = 0; i < pos.count; i++) {
    const l = col.getX(i) + col.getY(i) + col.getZ(i);
    if (pos.getY(i) < -0.2) {
      lo[0] += l;
      lo[1]++;
    }
    if (pos.getY(i) > 0.5) {
      hi[0] += l;
      hi[1]++;
    }
  }
  assert.ok(hi[1] && lo[1] && hi[0] / hi[1] > lo[0] / lo[1], 'blanco arriba, gris azulado abajo');
}

// 2) El material: suave, con borde luminoso y respiración en el sombreador; el tiempo es un uniforme.
assert.equal(cloudMaterial.flatShading, false);
{
  const shader = { uniforms: {}, vertexShader: 'uniform vec3 x;\nvoid main() {\n#include <begin_vertex>\n}', fragmentShader: 'void main() {\n#include <opaque_fragment>\n}' };
  cloudMaterial.onBeforeCompile(shader);
  assert.ok(shader.uniforms.uTime === cloudFade.time, 'el tiempo llega al sombreador');
  assert.match(shader.vertexShader, /breathe/);
  assert.match(shader.fragmentShader, /rim/);
}

// 3) El sistema: con la cámara cerca del suelo hay cúmulos, sin pasar del tope; el tiempo avanza; desde muy lejos no se dibuja ninguno.
{
  const clouds = createClouds();
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 1e8);
  const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
  camera.position.copy(dir).multiplyScalar(RADIUS + 3000);
  camera.lookAt(dir.clone().multiplyScalar(RADIUS + 3000).add(new THREE.Vector3(1, 0, 0)));
  camera.updateMatrixWorld(true);
  const t0 = cloudFade.time.value;
  clouds.update(1, camera, 900);
  assert.ok(cloudFade.time.value > t0, 'el tiempo avanza');
  const meshes = clouds.object.children.filter((c) => c.isInstancedMesh);
  const total = meshes.reduce((n, m) => n + m.count, 0);
  assert.ok(total > 0, `hay nubes cerca (${total})`);
  for (const m of meshes) assert.ok(m.count <= m.instanceMatrix.count, 'tope de instancias');
  const far = createClouds();
  camera.position.copy(dir).multiplyScalar(RADIUS * 8);
  camera.updateMatrixWorld(true);
  far.update(1, camera, 900);
  assert.equal(far.object.children.filter((c) => c.isInstancedMesh && c.userData.direction === undefined).reduce((n, m) => n + m.count, 0), 0, 'desde muy lejos no hay cúmulos locales');
}

console.log('clouds.test.js: ok');
