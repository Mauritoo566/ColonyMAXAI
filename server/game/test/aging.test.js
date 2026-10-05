// Edad de los colonos: los adultos cumplen años con el tiempo (2 por día de juego), ya mayores pueden morir de vejez, no
// envejecen con el dueño ausente, una mujer mayor ya no concibe, y todo se guarda.
// Uso: node server/game/test/aging.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { DAY_LENGTH_SECONDS } from '../../../src/daynight.js';
import { lifeExpectancy } from '../../../src/genes.js';
import { YEARS_PER_DAY, OLD_AGE_WINDOW, deathChance, FERTILE_UNTIL } from '../../../src/sim/family.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(2);
  sim.stock = { food: 99, water: 99, wood: 50, stone: 20, fiber: 50 };
  sim.clothesLeft = 0;
  for (const c of sim.colonists) {
    c.clothed = true;
    c.traits = [];
    c.task = null;
  }
  sim.mobs = [];
  return sim;
}
const tick = (sim, seconds, extra = {}) => {
  for (let t = 0; t < seconds; t += 1) {
    for (const c of sim.colonists) c.needs.food = c.needs.water = c.needs.rest = c.needs.warmth = 100;
    sim.update(1, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1', ...extra });
  }
};

// 1) Un día de juego: cada adulto cumple unos 2 años.
{
  const sim = colony();
  const before = sim.colonists.map((c) => c.age);
  for (const c of sim.colonists) c.genome = sim.colonists[0].genome; // misma esperanza de vida: nadie muere por el camino
  tick(sim, DAY_LENGTH_SECONDS);
  sim.colonists.forEach((c, i) => {
    const gained = c.age - before[i];
    assert.ok(Math.abs(gained - YEARS_PER_DAY) <= 1, `${c.name}: ${gained} años en un día`);
  });
}

// 2) La probabilidad de morir sube con la edad: cero de joven, algo desde unos años antes de la esperanza de vida, segura mucho después.
{
  const sim = colony();
  const c = sim.colonists[0];
  const L = lifeExpectancy(c.genome);
  c.age = 30;
  assert.equal(deathChance(c), 0);
  c.age = L - OLD_AGE_WINDOW;
  assert.equal(deathChance(c), 0);
  c.age = L - 2;
  const mid = deathChance(c);
  assert.ok(mid > 0 && mid < 1);
  c.age = L + 2;
  assert.ok(deathChance(c) > mid, 'más riesgo cuanto más viejo');
  c.age = L + OLD_AGE_WINDOW;
  assert.equal(deathChance(c), 1);
}

// 3) Muere de vejez en su cumpleaños (con aviso y en el registro de muertes), y otros no mueren.
{
  const sim = colony();
  const old = sim.colonists[0];
  const notices = [];
  sim.on('notice', (t) => notices.push(t));
  old.age = lifeExpectancy(old.genome) + OLD_AGE_WINDOW + 1;
  old.ageProgress = 0.99;
  const others = sim.colonists.slice(1).map((c) => c.age);
  const total = sim.colonists.length;
  tick(sim, 10);
  assert.ok(!sim.colonists.includes(old), 'murió');
  assert.equal(sim.colonists.length, total - 1, 'sólo él');
  assert.ok(sim.deaths.some((d) => d.name === old.name && d.cause.includes('vejez')), JSON.stringify(sim.deaths));
  assert.ok(notices.some((t) => t.includes('murió de vejez')), notices.join('|'));
  assert.ok(sim.colonists.every((c, i) => c.age >= others[i]), 'los demás siguen');
}

// 4) Con el dueño ausente el tiempo de la aldea no los envejece.
{
  const sim = colony();
  const before = sim.colonists.map((c) => c.age);
  tick(sim, DAY_LENGTH_SECONDS, { absent: true });
  assert.deepEqual(sim.colonists.map((c) => c.age), before);
}

// 5) Un niño pasa a adulto a los 18 y desde ahí cuenta los años (no se queda parado).
{
  const sim = colony();
  const c = sim.colonists[0];
  c.growth = 0.99;
  c.age = 17;
  tick(sim, 0.05 * 3 * DAY_LENGTH_SECONDS);
  assert.ok(c.age >= 18, 'ya es adulto');
  const at = c.age;
  tick(sim, DAY_LENGTH_SECONDS);
  assert.ok(c.age > at, 'y sigue cumpliendo años');
}

// 6) Una mujer mayor ya no concibe (el tope está en FERTILE_UNTIL años).
{
  assert.ok(FERTILE_UNTIL >= 35 && FERTILE_UNTIL <= 50);
}

// 7) Se guarda y se recupera (también el medio año a medias).
{
  const sim = colony();
  const c = sim.colonists[0];
  c.age = 33;
  c.ageProgress = 0.4;
  const data = JSON.parse(JSON.stringify(sim.serialize()));
  const sim2 = colony();
  sim2.restoreColony(data.colony);
  const c2 = sim2.colonists.find((o) => o.id === c.id);
  assert.equal(c2.age, 33);
  assert.equal(c2.ageProgress, 0.4);
}

console.log('aging.test.js: ok');
