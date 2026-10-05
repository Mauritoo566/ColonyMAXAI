// Cazadores: la casa de cazadores tiene un cupo de colonos por nivel; se arman con lanzas (hechas en la casa de lanzas) que recogen del almacén; armados
// defienden la aldea de los hostiles y, si el jugador lo manda, salen a cazar carne y pieles (la sastrería usa las pieles). Las lanzas se gastan, un herido
// se retira, la caza se repone y todo se guarda y llega al navegador.
// Uso: node server/game/test/hunting.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { GOODS_BY_ID } from '../../../src/sim/goods.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { MOB_STATS, MOB_DROPS, hitMob, gameTrickle } from '../../../src/sim/mobs.js';
import { SPEAR_LIFE, useSpear, lodgeReport } from '../../../src/sim/hunting.js';
import { outfitFor } from '../../../src/outfits.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(n = 6, age = 2) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(age);
  sim.stock = { food: 90, water: 90, wood: 99, stone: 20, fiber: 99, spear: 0, hide: 0 };
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
const tick = (sim, seconds, isNight = false) => {
  for (let t = 0; t < seconds; t += 0.5) {
    for (const c of sim.colonists) c.needs.food = c.needs.water = c.needs.rest = c.needs.warmth = 100;
    sim.update(0.5, { timeScale: 1, isNight, timeLabel: () => 'Día 1' });
  }
};
const lodge = (sim, x = 14, z = 12, level = 1) => {
  const b = sim.createBuilding(BUILDINGS.hunter_lodge, x, z, 0, 1, 0, level);
  b.done = true;
  b.progress = 1;
  return b;
};
let nextId = 700;
const mob = (sim, type, x, z) => {
  const m = { id: nextId++, type, x, z, facing: 0, state: 0, wait: 99, cd: 0, g: null, leader: false, tx: x, tz: z, ox: 0, oz: 0, target: null };
  sim.mobs.push(m);
  return m;
};
const post = (sim, b, n) => {
  const hunters = sim.colonists.filter((c) => !c.job).slice(0, n);
  for (const c of hunters) sim.setWorker(b, c);
  return hunters;
};

// 1) Datos: los bienes, las dos casas (cupo por nivel y recetas) y las pieles para la ropa.
{
  assert.ok(GOODS_BY_ID.hide && GOODS_BY_ID.spear, 'existen pieles y lanzas');
  assert.deepEqual(BUILDINGS.hunter_lodge.levels.map((l) => l.workers), [3, 5, 8], 'cupo de cazadores por nivel');
  assert.equal(BUILDINGS.hunter_lodge.levels[0].age, 2);
  assert.ok(BUILDINGS.spear_maker.levels[0].recipe.out.spear > 0, 'la casa de lanzas hace lanzas');
  assert.ok(BUILDINGS.tailor.levels[0].recipe.bonus.in.hide >= 1, 'la sastrería usa las pieles para hacer más ropa');
  assert.ok(!('hide' in BUILDINGS.tailor.levels[0].recipe.in), 'pero no depende de ellas (sin cazadores también hay ropa de fibra)');
  for (const t of Object.keys(MOB_STATS)) assert.ok(MOB_STATS[t].hp > 0, `${t} tiene vida`);
  for (const t of ['ciervo', 'lobo', 'oso']) assert.ok(MOB_DROPS[t].hide >= 2, `${t} da pieles`);
}

// 2) El cupo manda: no se asigna a más cazadores de los que admite la casa; los asignados recogen una lanza cada uno del almacén.
{
  const sim = colony(8);
  const b = lodge(sim);
  sim.stock.spear = 5;
  const hunters = post(sim, b, 5);
  assert.equal(b.workers.length, 3, 'sólo caben 3 cazadores en el nivel 1');
  assert.equal(sim.crewNeeded(b), 3);
  tick(sim, 90);
  assert.ok(b.workers.every((c) => c.spear?.left === SPEAR_LIFE), 'cada cazador se armó con una lanza');
  assert.equal(sim.stock.spear, 2, 'las lanzas salieron del almacén');
  assert.ok(hunters.length >= 3);
}

// 3) Defender: un lobo cerca de la aldea cae a manos de los cazadores (de día, sin orden de cazar); su carne y pieles llegan al almacén.
{
  const sim = colony(8);
  const b = lodge(sim);
  sim.stock.spear = 3;
  post(sim, b, 3);
  tick(sim, 60);
  const notices = [];
  sim.on('notice', (t) => notices.push(t));
  const wolf = mob(sim, 'lobo', 24, 8);
  const hide0 = sim.stock.hide;
  tick(sim, 120);
  assert.ok(!sim.mobs.includes(wolf), 'el lobo cayó');
  assert.ok(sim.stock.hide >= hide0 + MOB_DROPS.lobo.hide, `las pieles del lobo llegaron al almacén (${sim.stock.hide})`);
  assert.ok(notices.some((t) => t.includes('mató a un lobo')), notices.join('|'));
  assert.ok(b.workers.every((c) => c.health > 0), 'nadie murió');
}

// 4) Cazar: sólo si la casa lo manda; entonces traen la carne (comida) y las pieles de la presa.
{
  const sim = colony(8);
  const b = lodge(sim);
  sim.stock.spear = 3;
  post(sim, b, 3);
  tick(sim, 40);
  const deer = mob(sim, 'ciervo', 40, 30);
  tick(sim, 100);
  assert.ok(sim.mobs.includes(deer), 'sin orden de cazar no la tocan');
  b.hunt = true;
  sim.stock.food = 20; // (con el almacén lleno no cabe más)
  const food0 = sim.stock.food;
  const hide0 = sim.stock.hide;
  tick(sim, 140);
  assert.ok(!sim.mobs.includes(deer), 'con orden de cazar, la presa cae');
  assert.ok(sim.stock.food >= food0 + MOB_DROPS.ciervo.food - 6, `llegó la carne (${food0} -> ${sim.stock.food})`);
  assert.ok(sim.stock.hide >= hide0 + MOB_DROPS.ciervo.hide, 'llegaron las pieles');
  // De noche no salen a cazar presas.
  const hare = mob(sim, 'conejo', 36, 24);
  tick(sim, 60, true);
  assert.ok(sim.mobs.includes(hare), 'de noche no salen a cazar presas');
}

// 5) Sin lanza no salen; la lanza se gasta con los golpes y se rompe con aviso.
{
  const sim = colony(8);
  const b = lodge(sim);
  b.hunt = true;
  post(sim, b, 2);
  const deer = mob(sim, 'ciervo', 30, 20);
  tick(sim, 60);
  assert.ok(sim.mobs.includes(deer), 'sin lanzas no cazan');
  const c = b.workers[0];
  const notices = [];
  sim.on('notice', (t) => notices.push(t));
  c.spear = { left: 2 };
  useSpear(sim, c);
  assert.equal(c.spear.left, 1);
  useSpear(sim, c);
  assert.equal(c.spear, null, 'se rompió');
  assert.ok(notices.some((t) => t.includes('se le rompió la lanza')));
  assert.ok(hitMob(sim, deer, 999, c), 'un golpe fuerte mata a la presa');
  assert.ok(!sim.mobs.includes(deer));
}

// 6) Un cazador herido se retira (no sigue peleando).
{
  const sim = colony(8);
  const b = lodge(sim);
  sim.stock.spear = 3;
  post(sim, b, 1);
  tick(sim, 40); // (la colonia completa el cupo sola con quien tiene Combate entre sus especialidades)
  for (const c of b.workers) c.health = 20;
  const wolf = mob(sim, 'lobo', 20, 6);
  tick(sim, 30);
  assert.ok(sim.mobs.includes(wolf), 'herido, no va a por el lobo');
}

// 7) La caza se repone con el tiempo (presas lejos de la aldea) y vuelven las fieras si faltan.
{
  const sim = colony(2);
  sim.mobBiome = 'forest';
  sim.mobs = [];
  sim.gameTimer = 0;
  gameTrickle(sim, 1);
  assert.ok(sim.mobs.some((m) => ['conejo', 'ciervo', 'jabali'].includes(m.type)), 'llegó un rebaño de presas');
  assert.ok(sim.mobs.every((m) => Math.hypot(m.x, m.z) > 60), 'lejos de la aldea');
}

// 8) Se guarda y llega al navegador: la lanza, la misión de la casa y los animales que mueren desaparecen allí también.
{
  const sim = colony(8);
  const b = lodge(sim);
  b.hunt = true;
  sim.stock.spear = 3;
  const [c] = post(sim, b, 1);
  tick(sim, 40);
  assert.ok(c.spear);
  c.spear.left = 17;
  const deer = mob(sim, 'ciervo', 60, 40);
  const data = JSON.parse(JSON.stringify(sim.serialize()));
  const sim2 = colony(8);
  assert.equal(sim2.restore(data), true);
  const b2 = sim2.buildings.find((o) => o.def.id === 'hunter_lodge');
  assert.equal(b2.hunt, true, 'la misión se guarda');
  assert.deepEqual(sim2.colonists.find((o) => o.id === c.id).spear, { left: 17 });
  const mirror = colony(8);
  mirror.buildings = sim.buildings.map((o) => ({ ...o }));
  mirror.applySnapshot(JSON.parse(JSON.stringify(sim.snapshot('full'))));
  assert.deepEqual(mirror.colonists.find((o) => o.id === c.id).spear, { left: 17 }, 'el navegador ve la lanza');
  assert.equal(mirror.buildings.find((o) => o.def?.id === 'hunter_lodge')?.hunt, true, 'y la misión');
  assert.ok(mirror.mobs.some((m) => m.id === deer.id));
  hitMob(sim, deer, 999, c);
  mirror.applyMobs(sim.snapshot('fast').mobs);
  assert.ok(!mirror.mobs.some((m) => m.id === deer.id), 'el animal muerto desaparece también allí');
  const r = lodgeReport(sim, b);
  assert.ok(r.hunters >= 1 && r.armed >= 1, 'el resumen de la casa cuenta cazadores y armados');
}

// 9) Aspecto: el cazador lleva ropa de monte y la lanza en la mano; no se confunde con un soldado.
{
  const hunter = { soldier: null, job: { def: { id: 'hunter_lodge', skill: 'combat' } }, spear: { left: 5 } };
  const o = outfitFor(2, hunter);
  assert.equal(o.weapon, 'spear');
  assert.ok(o.cape && o.hat, 'capa de piel y gorro');
  const bare = outfitFor(2, { ...hunter, spear: null });
  assert.equal(bare.weapon, null);
  assert.notEqual(o.key, bare.key, 'la lanza cambia el aspecto');
  const soldier = outfitFor(2, { soldier: { unit: 'spearman', tier: 2 }, job: null });
  assert.notEqual(soldier.cape, o.cape, 'el soldado no lleva la capa de piel del cazador');
  assert.notEqual(soldier.key, o.key);
}

console.log('hunting.test.js: ok');
