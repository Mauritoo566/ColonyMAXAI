// Ropa por edad: cada una de las diez edades tiene su propia silueta (no sólo otro color), la ropa se puede quitar y volver a poner sin dejar piezas
// sueltas, y la prenda que se ve es la de la edad en que se hizo. Sólo geometría (sin pantalla).
// Uso: node server/game/test/outfits.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPersonModel, dressModel } from '../../../src/colonists.js';
import { outfitFor } from '../../../src/outfits.js';

const look = { shirt: '#9a8a6a', pants: '#5a4a3a', skin: '#d9a77a', hair: '#3a2a1a', longHair: false, height: 1 };
const person = () => createPersonModel(look);
const parts = (object) => {
  const out = [];
  object.updateMatrixWorld(true);
  object.traverse((o) => {
    if (!o.isMesh || o === object.userData.proxy?.children[0]) return;
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    out.push(`${o.geometry.type}|${o.material.color.getHexString()}|${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
  });
  return out.sort();
};
const outfit = (tier) => outfitFor(tier, { soldier: null, job: null });

// 1) Cada edad se ve distinta: muchas piezas diferentes entre una y la siguiente (silueta, no sólo color).
const sigs = [];
for (let tier = 1; tier <= 10; tier++) {
  const m = person();
  dressModel(m, look, true, outfit(tier));
  const sig = parts(m);
  for (const s of sig) assert.ok(!s.includes('NaN'), `tier ${tier}: posición inválida`);
  sigs.push(new Set(sig));
}
for (let i = 1; i < 10; i++) {
  const before = sigs[i - 1];
  const after = sigs[i];
  const different = [...after].filter((s) => !before.has(s)).length + [...before].filter((s) => !after.has(s)).length;
  assert.ok(different >= 8, `de la edad ${i} a la ${i + 1} cambian pocas piezas (${different})`);
}

// 2) Las siluetas básicas: pieles con brazos y piernas al aire y manto; lino con mangas cortas y túnica; túnica larga hasta el suelo desde la V.
{
  const bounds = (tier) => {
    const m = person();
    dressModel(m, look, true, outfit(tier));
    const hem = outfit(tier).style.hem;
    return { hem, sleeves: outfit(tier).style.sleeves, legs: outfit(tier).style.legs };
  };
  assert.equal(bounds(1).sleeves, 'bare');
  assert.equal(bounds(1).legs, 'bare');
  assert.ok(outfit(1).style.pelt, 'las pieles llevan manto');
  assert.equal(bounds(3).sleeves, 'short');
  assert.ok(bounds(5).hem.len > 0.7, 'la túnica de la edad V es larga');
  assert.ok(outfit(6).style.puff, 'el jubón lleva hombreras');
  assert.ok(outfit(10).style.glow, 'la ropa técnica lleva franjas luminosas');
  assert.ok(outfit(8).style.bib, 'el mono lleva peto');
}

// 3) Vestir y desvestir repetidas veces no deja piezas sueltas ni acumula nada.
{
  const m = person();
  dressModel(m, look, true, outfit(3));
  const base = parts(m).length;
  for (let i = 0; i < 5; i++) {
    dressModel(m, look, true, outfit(6));
    dressModel(m, look, true, outfit(3));
  }
  assert.equal(parts(m).length, base, 'la misma ropa tiene siempre las mismas piezas');
  dressModel(m, look, false, null);
  const naked = parts(m);
  assert.ok(naked.length < base, 'sin ropa hay menos piezas');
  assert.equal(m.userData.extras.length, 0, 'sin ropa no quedan añadidos en brazos ni piernas');
  dressModel(m, look, true, outfit(1));
  assert.notDeepEqual(parts(m), naked);
}

// 3b) La lanza va en la mano (se mueve con el brazo en la estocada) y no suelta piezas al cambiar de ropa.
{
  const m = person();
  const spearman = { soldier: null, job: { def: { id: 'hunter_lodge', skill: 'combat' } }, spear: { left: 3 } };
  dressModel(m, look, true, outfitFor(2, spearman));
  const armR = m.userData.armR;
  assert.ok(m.userData.extras.some((x) => x.parent === armR), 'la lanza cuelga del brazo derecho');
  assert.ok(m.userData.extras.filter((x) => x.parent === armR).length >= 2, 'asta y punta');
  dressModel(m, look, true, outfitFor(2, { ...spearman, spear: null }));
  assert.ok(!m.userData.extras.some((x) => x.parent === armR && x.mesh.geometry.parameters?.height === 1.9), 'sin lanza no queda el asta');
}

// 4) La edad de la prenda decide el aspecto, no la de la aldea: el oficio sólo añade un sombrero o delantal.
{
  const lumberjack = { soldier: null, job: { def: { skill: 'woodcutting', id: 'woodcutter' } } };
  const a = outfitFor(2, lumberjack);
  assert.equal(a.style.sleeves, 'bare', 'el leñador con ropa de cuero lleva los brazos al aire');
  assert.ok(a.key.startsWith('2|'));
  assert.notEqual(outfitFor(4, lumberjack).key, a.key);
}

console.log('outfits.test.js: ok');
