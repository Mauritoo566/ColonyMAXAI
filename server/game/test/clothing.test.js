// Ropa: se fabrica en la sastrería, cada prenda es de la edad en que se hizo (abriga más cuanto más moderna), se gasta y se rompe, los colonos van a por ropa
// al almacén (sin ropa corriendo, con ropa vieja sin prisa), anima o desanima, se guarda y llega al navegador.
// Uso: node server/game/test/clothing.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { GOODS_BY_ID } from '../../../src/sim/goods.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { lifeOf, warmthOf, clothesMood, clothesWanted, wearClothes, dress, tierName, MAX_TIER } from '../../../src/sim/clothing.js';
import { updateNeeds } from '../../../src/needs.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(n = 4, age = 3) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(age);
  sim.stock = { food: 90, water: 90, wood: 99, stone: 20, fiber: 99 };
  sim.clothesLeft = 0;
  const base = sim.colonists[0];
  while (sim.colonists.length < n) {
    const id = 50 + sim.colonists.length;
    sim.colonists.push(sim.makeColonist({ ...sim.staticOf(base), id, name: `Extra${id}` }, { needs: { ...base.needs }, growth: 1, x: 6 + sim.colonists.length, z: 4 }));
  }
  for (const c of sim.colonists) {
    c.clothed = false;
    c.wear = null;
    c.traits = [];
    c.task = null;
  }
  sim.mobs = [];
  return sim;
}
const tick = (sim, seconds) => {
  for (let t = 0; t < seconds; t += 0.5) {
    for (const c of sim.colonists) c.needs.food = c.needs.water = c.needs.rest = 100;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
  }
};

// 1) Datos: el bien y la sastrería existen, con un nivel por época; la ropa es más cálida y dura más cuanto más moderna.
{
  assert.ok(GOODS_BY_ID.clothes, 'existe el bien ropa');
  const tailor = BUILDINGS.tailor;
  assert.ok(tailor, 'existe la sastrería');
  assert.deepEqual(tailor.levels.map((l) => l.age), [2, 4, 6, 8]);
  for (const l of tailor.levels) assert.ok(l.recipe.out.clothes > 0, 'todos los niveles hacen ropa');
  assert.equal(warmthOf(1), 25, 'las pieles abrigan lo de siempre');
  for (let t = 2; t <= MAX_TIER; t++) {
    assert.ok(warmthOf(t) > warmthOf(t - 1), `la ropa ${t} abriga más`);
    assert.ok(lifeOf(t) > lifeOf(t - 1), `la ropa ${t} dura más`);
    assert.ok(tierName(t) && tierName(t) !== tierName(t - 1));
  }
}

// 2) Las pieles del campamento son ropa de la primera edad; cada prenda se gasta y al romperse hay aviso.
{
  const sim = colony(2, 1);
  sim.clothesLeft = 2;
  const c = sim.colonists[0];
  assert.equal(sim.takeClothes(c), true);
  assert.equal(c.wear.tier, 1);
  assert.equal(c.wear.left, lifeOf(1));
  const notices = [];
  sim.on('notice', (t) => notices.push(t));
  wearClothes(sim, c, 100);
  assert.ok(c.wear.left < lifeOf(1) && c.clothed, 'se gasta');
  c.working = true;
  const before = c.wear.left;
  wearClothes(sim, c, 100);
  assert.ok(before - c.wear.left > 100, 'trabajando se gasta más rápido');
  c.wear.left = 1;
  wearClothes(sim, c, 5);
  assert.equal(c.clothed, false);
  assert.equal(c.wear, null);
  assert.ok(notices.some((t) => t.includes('se le rompió la ropa')), notices.join('|'));
}

// 3) Abrigo: a igual frío, la ropa moderna mantiene más caliente (los datos de la necesidad de calor).
{
  const warmth = (tier) => {
    const sim = colony(1, 4);
    const c = sim.colonists[0];
    c.needs.warmth = 0;
    for (let i = 0; i < 400; i++) updateNeeds(c, { dt: 5, ambient: 0, thirst: 1, nearFire: false, sheltered: false, clothed: tier > 0, warmthBonus: tier ? warmthOf(tier) : undefined, companion: null, urns: 0, stench: 0, time: 0, gameTime: i, absent: true, homeless: 0 });
    return c.needs.warmth;
  };
  assert.ok(warmth(1) > warmth(0), 'las pieles abrigan más que nada');
  assert.ok(warmth(10) > warmth(1) + 15, 'la ropa técnica abriga mucho más que las pieles');
}

// 4) Ánimo: la ropa de la edad anima, la raída o sin ropa desanima.
{
  const sim = colony(1, 5);
  const c = sim.colonists[0];
  assert.equal(clothesMood(sim, c), -6, 'sin ropa baja el ánimo');
  dress(sim, c, 5);
  assert.equal(clothesMood(sim, c), 4);
  c.wear.tier = 4;
  assert.ok(clothesMood(sim, c) > 0 && clothesMood(sim, c) < 4);
  c.wear.tier = 1;
  assert.equal(clothesMood(sim, c), -3, 'muy anticuada');
  c.wear.tier = 5;
  c.wear.left = lifeOf(5) * 0.1;
  assert.equal(clothesMood(sim, c), -3, 'raída');
  const early = colony(1, 1);
  assert.equal(clothesMood(early, early.colonists[0]), 0, 'en la primera edad no se echa en falta');
}

// 5) Quién va a por ropa: sin ropa y sin pila, al almacén; con ropa buena, nadie; con ropa vieja o rota, la cambia.
{
  const sim = colony(3, 4);
  const [a, b] = sim.colonists;
  assert.equal(clothesWanted(sim, a), null, 'sin ropa en el almacén no hay nada que hacer');
  sim.stock.clothes = 2;
  assert.deepEqual(clothesWanted(sim, a), { source: 'stock' });
  dress(sim, b, 4);
  assert.equal(clothesWanted(sim, b), null, 'con ropa de su edad no cambia');
  b.wear.tier = 2;
  assert.deepEqual(clothesWanted(sim, b), { source: 'stock' }, 'con ropa de una edad anterior la renueva');
  b.wear.tier = 4;
  b.wear.left = 10;
  assert.deepEqual(clothesWanted(sim, b), { source: 'stock' }, 'a punto de romperse la renueva');
  sim.stock.clothes = 0;
  assert.equal(clothesWanted(sim, b), null);
  sim.clothesLeft = 1;
  assert.deepEqual(clothesWanted(sim, a), { source: 'pile' }, 'la pila del campamento va primero');
}

// 6) De verdad: con ropa en el almacén, los colonos sin ropa la recogen solos y se ven de la edad actual; se descuenta del almacén.
{
  const sim = colony(4, 4);
  sim.stock.clothes = 3;
  for (const c of sim.colonists) c.needs.warmth = 40; // con frío van más rápido
  tick(sim, 300);
  const dressed = sim.colonists.filter((c) => c.clothed);
  assert.equal(dressed.length, 3, 'se vistieron con las tres que había');
  assert.equal(sim.stock.clothes ?? 0, 0);
  assert.ok(dressed.every((c) => c.wear.tier === 4), 'prendas de la edad 4 (lana)');
}

// 7) Al llegar una edad nueva y haber ropa, quien lleva una prenda antigua se pone la moderna.
{
  const sim = colony(2, 3);
  for (const c of sim.colonists) dress(sim, c, 1);
  sim.setAge(4);
  sim.stock.clothes = sim.colonists.length + 2;
  tick(sim, 300);
  assert.ok(sim.colonists.every((c) => c.wear.tier === 4), `todos con ropa de la edad 4: ${sim.colonists.map((c) => c.wear.tier)}`);
  assert.equal(sim.stock.clothes, 2, 'cada cambio gasta una prenda del almacén y sobran las dos de más');
}

// 8) Se guarda y llega al navegador (también partidas de antes: ropa puesta sin dato de desgaste).
{
  const sim = colony(3, 5);
  dress(sim, sim.colonists[0], 3);
  sim.colonists[0].wear.left = 1234;
  const data = JSON.parse(JSON.stringify(sim.serialize()));
  const sim2 = colony(3, 5);
  sim2.restoreColony(data.colony);
  assert.deepEqual(sim2.colonists[0].wear, { tier: 3, left: 1234 });
  assert.equal(sim2.colonists[1].wear, null);
  data.colony.colonists[1].clothed = true; // una partida de antes: vestido pero sin desgaste guardado
  delete data.colony.colonists[1].wear;
  const sim3 = colony(3, 5);
  sim3.restoreColony(data.colony);
  assert.equal(sim3.colonists[1].clothed, true);
  assert.deepEqual(sim3.colonists[1].wear, { tier: 5, left: lifeOf(5) }, 'se le da una prenda nueva de su edad');
  const full = JSON.parse(JSON.stringify(sim.snapshot('full')));
  const mirror = colony(3, 5);
  mirror.applySnapshot(full);
  assert.deepEqual(mirror.colonists[0].wear, { tier: 3, left: 1234 });
  assert.equal(mirror.colonists[1].wear, null);
}

console.log('clothing.test.js: ok');
