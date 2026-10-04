// Establo y caballos: al talar a veces cae una manzana; con un establo se puede domesticar a un caballo salvaje pagando 3 manzanas (se gastan al dar
// la orden), un colono libre va, lo doma y el caballo espera en el establo (capacidad por nivel); se guarda, llega al navegador y, sin establo,
// no se puede. Todo en el servidor.
// Uso: node server/game/test/stable.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { GOODS } from '../../../src/sim/goods.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { defImplemented, minAgeOf } from '../../../src/sim/progression.js';
import { TAME_COST, stallsFree } from '../../../src/sim/stable.js';
import { MAX_WILD_HORSES, wildHorses } from '../../../src/sim/mobs.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(n = 8, age = 3) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(age);
  sim.stock = { food: 90, water: 90, wood: 99, stone: 20, fiber: 99, apple: 0 };
  sim.clothesLeft = 0;
  const base = sim.colonists[0];
  while (sim.colonists.length < n) {
    const id = 50 + sim.colonists.length;
    sim.colonists.push(sim.makeColonist({ ...sim.staticOf(base), id, name: `Extra${id}` }, { needs: { ...base.needs }, growth: 1, x: 6 + sim.colonists.length, z: 4 }));
  }
  for (const c of sim.colonists) {
    c.clothed = true;
    c.traits = [];
    c.task = null;
  }
  sim.mobs = [];
  return sim;
}
const tick = (sim, seconds) => {
  for (let t = 0; t < seconds; t += 0.5) {
    for (const c of sim.colonists) c.needs.food = c.needs.water = c.needs.rest = c.needs.warmth = 100;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
  }
};
const stable = (sim, x = 20, z = 20) => {
  const b = sim.createBuilding(BUILDINGS.horse_stable, x, z, 0, 1, 0, 1);
  b.done = true;
  b.progress = 1;
  return b;
};
let nextId = 900;
const horse = (sim, x = 30, z = 24, g = null) => {
  const m = { id: nextId++, type: 'caballo', x, z, facing: 0, state: 0, wait: 5, cd: 0, g, leader: false, tx: x, tz: z, ox: 0, oz: 0 };
  sim.mobs.push(m);
  return m;
};

// 0) Existe desde la Edad III, con huecos por nivel; la manzana es un bien de comida.
assert.ok(defImplemented(BUILDINGS.horse_stable));
assert.equal(minAgeOf(BUILDINGS.horse_stable), 3);
assert.deepEqual(BUILDINGS.horse_stable.levels.map((l) => l.stalls), [4, 8, 14]);
assert.equal(BUILDINGS.horse_stable.levels[0].name, 'Establo');
assert.ok(GOODS.some((g) => g.id === 'apple' && g.group === 'food'), 'la manzana es una fruta');
assert.equal(TAME_COST, 3);

// 1) Sin establo no se puede domesticar (y no se gastan manzanas).
{
  const sim = colony();
  sim.stock.apple = 9;
  const h = horse(sim);
  assert.match(sim.tameProblemOf(h), /establo/);
  assert.equal(sim.tameHorse(h.id), false);
  assert.equal(sim.stock.apple, 9);
}

// 2) Con establo pero sin manzanas suficientes tampoco.
{
  const sim = colony();
  stable(sim);
  sim.stock.apple = 2;
  const h = horse(sim);
  assert.match(sim.tameProblemOf(h), /manzanas/);
  assert.equal(sim.tameHorse(h.id), false);
  assert.equal(sim.stock.apple, 2);
}

// 3) Domesticar: las manzanas se gastan al dar la orden, un colono va, y el caballo queda en el establo.
{
  const sim = colony();
  const b = stable(sim);
  sim.stock.apple = 7;
  const h = horse(sim);
  assert.equal(sim.tameProblemOf(h), null);
  assert.equal(sim.applyCommand('tameHorse', [h.id]), true);
  assert.equal(sim.stock.apple, 4, 'se gastaron 3 manzanas del almacén');
  assert.ok(h.order && !h.tamed, 'espera al colono');
  assert.equal(stallsFree(sim), 3);
  const x0 = h.x;
  const z0 = h.z;
  tick(sim, 4);
  // El navegador sabe qué colono va a domesticarlo (para mostrarlo en la ficha).
  {
    const copy = new ColonySim();
    copy.applyMobs(sim.snapshot('fast').mobs);
    const seen = copy.mobs.find((m) => m.id === h.id);
    assert.equal(seen.tame, 2);
    assert.equal(seen.by, h.order.by);
  }
  assert.equal(h.x, x0);
  assert.equal(h.z, z0, 'quieto mientras espera al colono');
  let took = false;
  let rode = null;
  let rideFlag = false;
  let together = true;
  let startRide = null;
  for (let t = 0; t < 400 && !(h.tamed && rode && !rode.riding); t += 0.5) {
    tick(sim, 0.5);
    if (sim.colonists.some((c) => c.task?.type === 'tame')) took = true;
    const rider = sim.colonists.find((c) => c.riding);
    if (rider) {
      rode = rider;
      startRide ??= { x: h.x, z: h.z };
      if (Math.hypot(rider.x - h.x, rider.z - h.z) > 0.01) together = false;
      const row = sim.snapshot('fast').colonists.find((r) => r[0] === rider.id);
      if (row[4] & 8192) rideFlag = true;
    }
  }
  assert.ok(took, 'algún colono fue a domesticarlo');
  assert.ok(rode, 'el colono se subió al caballo');
  assert.ok(together, 'va encima del caballo, en su mismo sitio');
  assert.ok(rideFlag, 'el navegador recibe que va montado');
  assert.equal(rode.riding, false, 'al llegar se baja');
  assert.equal(h.rider, null);
  assert.ok(Math.hypot(rode.x - h.x, rode.z - h.z) < 3, 'y queda junto al caballo');
  assert.ok(h.tamed && !h.order, 'quedó domesticado');
  assert.equal(h.role, null, 'sin función todavía');
  tick(sim, 40);
  assert.ok(Math.hypot(h.x - b.x, h.z - b.z) < 9, `espera junto al establo (${Math.hypot(h.x - b.x, h.z - b.z).toFixed(1)} m)`);
  assert.ok(Math.hypot(h.x - h.stall.x, h.z - h.stall.z) < 3, 'en su hueco');
  assert.equal(sim.tameProblemOf(h) && /domesticado/.test(sim.tameProblemOf(h)), true);
  // Llega al navegador: domesticado (1) y con su manada.
  const copy = new ColonySim();
  copy.applyMobs(sim.snapshot('fast').mobs);
  const seen = copy.mobs.find((m) => m.id === h.id);
  assert.equal(seen.tame, 1);
  {
    const c0 = sim.colonists[0];
    c0.riding = true;
    const mirror = new ColonySim();
    mirror.colonists = sim.colonists.map((c) => ({ ...c }));
    mirror.applySnapshot?.({ colonists: sim.snapshot('fast').colonists });
    assert.equal(mirror.colonists[0].riding, true);
    c0.riding = false;
  }
  // Se guarda y se recupera.
  const data = JSON.parse(JSON.stringify(sim.serialize()));
  const sim2 = colony();
  sim2.mobs = [{ ...h, tamed: false, stall: null, stableId: null, x: 0, z: 0 }];
  sim2.createBuilding(BUILDINGS.horse_stable, 20, 20, 0, 1, 0, 1);
  sim2.restoreColony(data.colony);
  assert.equal(sim2.mobs[0].tamed, true, 'sigue domesticado al recargar');
  assert.deepEqual(sim2.mobs[0].stall, h.stall);
}

// 4) Capacidad: el establo no admite más caballos que sus huecos; domesticar a la manada respeta manzanas y huecos.
{
  const sim = colony(10);
  stable(sim);
  sim.stock.apple = 30;
  const herd = [horse(sim, 30, 24, 1), horse(sim, 32, 24, 1), horse(sim, 34, 24, 1), horse(sim, 36, 24, 1), horse(sim, 38, 24, 1)];
  assert.equal(sim.tameableHerd(herd[0]).length, 5);
  assert.equal(sim.tameCount(herd[0]), 4, 'caben 4');
  assert.equal(sim.applyCommand('tameHerd', [herd[0].id]), true);
  assert.equal(sim.stock.apple, 30 - 4 * TAME_COST);
  assert.equal(herd.filter((h) => h.order).length, 4);
  assert.match(sim.tameProblemOf(herd.find((h) => !h.order)), /lleno/);
}

// 5) Si el establo desaparece antes de terminar, se devuelven las manzanas; lo domesticado vuelve a ser salvaje.
{
  const sim = colony();
  const b = stable(sim);
  sim.stock.apple = 3;
  const h = horse(sim);
  sim.tameHorse(h.id);
  assert.equal(sim.stock.apple, 0);
  b.removed = true;
  sim.buildings = sim.buildings.filter((o) => o !== b);
  tick(sim, 2);
  assert.ok(!h.order && !h.tamed);
  assert.equal(sim.stock.apple, 3, 'las manzanas vuelven');
}

// 6) Al talar a veces cae una manzana (sólo de árboles).
{
  const sim = colony();
  const notices = [];
  sim.on('notice', (t) => notices.push(t));
  const real = Math.random;
  const fell = (tree, roll) => {
    Math.random = () => roll;
    try {
      sim.consumeSpot({ tree, kind: tree ? 'wood' : 'stone', key: 'k', index: 1, x: 0, z: 0, type: 'broadleaf' }, 0);
    } finally {
      Math.random = real;
    }
  };
  fell(true, 0.01); // cae todo lo que puede caer
  assert.equal(sim.stock.apple, 1, 'cayó una manzana');
  assert.ok(notices.some((t) => /manzana/.test(t)));
  fell(true, 0.9); // no cae nada
  assert.equal(sim.stock.apple, 1);
  fell(false, 0.01); // una piedra no da manzanas
  assert.equal(sim.stock.apple, 1);
}

// 7) Las manadas de caballos llegan solas cerca de la aldea (aunque el bioma no sea de caballos), sin pasarse de un máximo, y todos ven lo mismo.
{
  const sim = colony();
  sim.mobBiome = 'grassland';
  const notices = [];
  sim.on('notice', (t) => notices.push(t));
  assert.equal(wildHorses(sim), 0, 'en la pradera no había ninguno');
  sim.horseTimer = 0.1;
  tick(sim, 1);
  const n = wildHorses(sim);
  assert.ok(n >= 3 && n <= 6, `llegó una manada (${n})`);
  assert.ok(notices.some((t) => /caballos salvajes/.test(t)), 'avisa');
  const ids = sim.mobs.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  for (const m of sim.mobs) {
    const d = Math.hypot(m.x, m.z);
    assert.ok(d > 40 && d < 160, `cerca de la aldea, no encima (${d.toFixed(0)} m)`);
    assert.ok(!sim.buildings.some((b) => Math.hypot(b.x - m.x, b.z - m.z) < 20));
  }
  assert.equal(new Set(sim.mobs.map((m) => m.g)).size, 1, 'una sola manada');
  // Llegan y llegan, pero con un máximo de salvajes.
  for (let k = 0; k < 20; k++) {
    sim.horseTimer = 0.1;
    tick(sim, 1);
  }
  assert.ok(wildHorses(sim) <= MAX_WILD_HORSES, `tope de salvajes (${wildHorses(sim)})`);
  // Los ve cualquier jugador que mire esta aldea: van en el estado que se manda.
  const copy = new ColonySim();
  copy.applyMobs(sim.snapshot('fast').mobs);
  assert.equal(copy.mobs.length, sim.mobs.length);
  // Una de las nuevas se domestica, se guarda y, tras recargar (sin esas manadas), vuelve a estar.
  const b = stable(sim);
  sim.stock.apple = 3;
  const h = sim.mobs[sim.mobs.length - 1];
  const id = h.id;
  sim.tameHorse(id);
  for (let t = 0; t < 400 && !h.tamed; t += 1) {
    tick(sim, 1);
    if (!h.order && !h.tamed) break;
  }
  assert.ok(h.tamed, 'se domesticó');
  const data = JSON.parse(JSON.stringify(sim.serialize()));
  const sim2 = colony();
  sim2.mobBiome = 'grassland';
  sim2.createBuilding(BUILDINGS.horse_stable, b.x, b.z, 0, 1, 0, 1);
  sim2.restoreColony(data.colony);
  const back = sim2.mobs.find((m) => m.id === id);
  assert.ok(back?.tamed, 'el caballo domesticado vuelve tras recargar');
  const ids2 = sim2.mobs.map((m) => m.id);
  assert.equal(new Set(ids2).size, ids2.length);
}

// 8) En un desierto no llegan manadas.
{
  const sim = colony();
  sim.mobBiome = 'desert';
  sim.horseTimer = 0.1;
  tick(sim, 2);
  assert.equal(wildHorses(sim), 0);
}

console.log('stable.test.js: ok');
