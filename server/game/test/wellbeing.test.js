// Ánimo explicable: las causas salen de lo que la simulación calcula de verdad, no de un valor bajo; los golpes puntuales
// se aplican una sola vez; la categoría y la tendencia no parpadean; los avisos se agrupan; todo sobrevive a guardar y cargar.
// Uso: node server/game/test/wellbeing.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { updateNeeds, addMoodEvent, hasTrait } from '../../../src/needs.js';
import { diagnose, collectiveAlerts, nextBand, nextTrend, NEED_WEIGHT, HOMELESS_PENALTY, BANDS, EVENT_SECONDS } from '../../../src/sim/wellbeing.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.stock = { food: 0, water: 300, wood: 300, stone: 100, fiber: 100 };
  return sim;
}
const quiet = (c) => {
  c.traits = [];
  c.moodEvents = undefined;
  c.block = null;
};

// 1) La fórmula explicada es la que se aplica: el objetivo sale de la base, las necesidades, el rasgo, la compañía y la falta de casa.
{
  const sim = colony();
  const c = sim.colonists[0];
  quiet(c);
  Object.assign(c.needs, { food: 90, water: 80, rest: 70, warmth: 60, mood: 50 });
  updateNeeds(c, { dt: 0.1, ambient: 0.6, nearFire: false, companion: null, walking: false, time: 'Día 1', gameTime: 10, homeless: 0.5, clothed: true });
  const needs = (c.needs.food + c.needs.water + c.needs.rest + c.needs.warmth) / 4;
  assert.ok(Math.abs(needs * 0.6 - NEED_WEIGHT * (c.needs.food + c.needs.water + c.needs.rest + c.needs.warmth)) < 1e-9, 'el peso por necesidad es el real');
  const expected = 25 + needs * 0.6 - HOMELESS_PENALTY * 0.5;
  assert.ok(Math.abs(c.moodTarget - expected) < 0.2, `objetivo ${c.moodTarget.toFixed(2)} ≈ ${expected.toFixed(2)}`);
  console.log('✓ el objetivo del ánimo coincide con los términos que se explican');
}

// 2) Hambre sin comida: causa real + impedimento real; al resolverla, desaparece.
{
  const sim = colony();
  const c = sim.colonists[0];
  quiet(c);
  Object.assign(c.needs, { food: 15, water: 90, rest: 90, warmth: 90, mood: 40 });
  const d = diagnose(sim, c);
  const food = d.causes.find((x) => x.id === 'need-food');
  assert.ok(food, 'el hambre es una causa');
  assert.equal(food.impact, -Math.round(NEED_WEIGHT * 85), 'la cifra es la de la fórmula');
  assert.match(food.blocker, /No hay comida/, 'sin comida en el almacén se dice');
  assert.match(food.advice[0].text, /Falta comida/);
  assert.equal(d.main, 'hambre');
  assert.ok(!d.causes.some((x) => x.id === 'need-water'), 'no inventa sed');
  sim.stock.food = 20;
  const d2 = diagnose(sim, c);
  assert.equal(d2.causes.find((x) => x.id === 'need-food').blocker, null, 'con comida ya no hay impedimento de existencias');
  c.needs.food = 95;
  assert.ok(!diagnose(sim, c).causes.some((x) => x.id === 'need-food'), 'resuelta, la causa se retira');
  console.log('✓ hambre: causa, cifra e impedimento reales; se retira al resolverse');
}

// 3) Causa por tarea fallida: se distingue la necesidad, la tarea elegida y el obstáculo.
{
  const sim = colony();
  const c = sim.colonists[0];
  quiet(c);
  sim.stock.food = 5;
  Object.assign(c.needs, { food: 20, water: 90, rest: 90, warmth: 90 });
  c.block = { need: 'food', why: 'No logra llegar a su destino', at: sim.gameTime };
  const d = diagnose(sim, c);
  const f = d.causes.find((x) => x.id === 'need-food');
  assert.equal(f.blocker, 'No logra llegar a su destino');
  assert.match(f.advice[0].text, /no llega a ella/, 'hay comida pero es inaccesible: lo dice');
  c.task = { type: 'eat' };
  assert.equal(diagnose(sim, c).causes.find((x) => x.id === 'need-food').working, true, 'la tarea elegida es comer');
  c.task = null;
  console.log('✓ se distinguen necesidad, tarea e impedimento');
}

// 4) Sin cama: se muestra el tamaño real del problema y no se recomienda lo que la edad no permite.
{
  const sim = colony();
  sim.age = 3;
  const c = sim.colonists[0];
  quiet(c);
  Object.assign(c.needs, { food: 90, water: 90, rest: 90, warmth: 90 });
  c.home = null;
  c.moodFx = { companion: 0, homeless: 1 };
  const d = diagnose(sim, c);
  const h = d.causes.find((x) => x.id === 'homeless');
  assert.ok(h);
  assert.equal(h.impact, -HOMELESS_PENALTY);
  assert.match(h.advice[0].text, /plaza|vivienda/i);
  console.log('✓ sin cama:', h.advice[0].text);
}

// 5) Golpes puntuales: se aplican una sola vez y se recuerdan un rato.
{
  const sim = colony();
  const c = sim.colonists[0];
  quiet(c);
  c.needs.mood = 70;
  addMoodEvent(c, 'attack', -15, 100);
  assert.equal(c.needs.mood, 55, 'baja exactamente lo que dice');
  const before = c.needs.mood;
  for (let i = 0; i < 5; i++) diagnose(sim, c); // consultar no cambia nada
  assert.equal(c.needs.mood, before, 'consultar el diagnóstico no aplica nada');
  sim.gameTime = 100 + 10;
  const d = diagnose(sim, c);
  const ev = d.causes.find((x) => x.id === 'event-attack');
  assert.ok(ev && ev.impact === -15 && ev.left > 0);
  // Expira.
  Object.assign(c.needs, { food: 90, water: 90, rest: 90, warmth: 90 });
  updateNeeds(c, { dt: 0.1, ambient: 0.6, time: 'x', gameTime: 100 + EVENT_SECONDS + 1, clothed: true });
  assert.equal(c.moodEvents, undefined, 'el recuerdo caduca');
  // Más de cuatro no crecen sin límite.
  for (let i = 0; i < 9; i++) addMoodEvent(c, `e${i}`, -1, 5);
  assert.ok(c.moodEvents.length <= 4);
  console.log('✓ los golpes puntuales se aplican una vez, caducan y están acotados');
}

// 6) Histéresis: la categoría y la tendencia no parpadean con cambios mínimos.
{
  let band = nextBand(null, 41);
  assert.equal(BANDS[band].id, 'ok');
  const seen = new Set();
  for (const v of [39.5, 40.5, 39, 41, 38.5, 40.2, 39.8]) seen.add((band = nextBand(band, v)));
  assert.equal(seen.size, 1, 'oscilar alrededor del umbral no cambia de categoría');
  band = nextBand(band, 30);
  assert.equal(BANDS[band].id, 'low', 'una caída clara sí');
  let tr = 0;
  const trends = new Set();
  for (const diff of [2.6, 2.0, 1.4, 1.1, 1.7, 1.2]) trends.add((tr = nextTrend(tr, 50, 50 + diff)));
  assert.equal(trends.size, 1, 'la tendencia aguanta cambios pequeños');
  assert.equal(nextTrend(1, 50, 50.4), 0, 'y se vuelve estable cuando ya no tira');
  console.log('✓ categoría y tendencia con histéresis');
}

// 7) Avisos colectivos: uno por causa, con los afectados.
{
  const sim = colony();
  sim.age = 3;
  for (const c of sim.colonists) {
    quiet(c);
    Object.assign(c.needs, { food: 90, water: 90, rest: 90, warmth: 90 });
    c.home = null;
    c.moodFx = { companion: 0, homeless: 1 };
  }
  const list = collectiveAlerts(sim);
  const a = list.find((x) => x.id === 'wb-homeless');
  assert.ok(a, 'hay un aviso colectivo');
  assert.equal(list.filter((x) => x.id === 'wb-homeless').length, 1, 'uno solo, no uno por colono');
  assert.equal(a.ids.length, sim.colonists.length);
  assert.match(a.text, /no tienen cama/);
  // Resuelto de verdad: sin la causa, desaparece (no por cerrarlo).
  for (const c of sim.colonists) c.moodFx = { companion: 0, homeless: 0 };
  assert.ok(!collectiveAlerts(sim).some((x) => x.id === 'wb-homeless'));
  console.log('✓ avisos agrupados con la lista de afectados; se van al resolverse');
}

// 8) El bloqueo se registra al fallar una tarea y se retira al comer.
{
  const sim = colony();
  const c = sim.colonists[0];
  quiet(c);
  sim.colonists = [c];
  Object.assign(c.needs, { food: 20, water: 90, rest: 90, warmth: 90 });
  sim.stock.food = 0;
  c.task = { type: 'eat', source: 'stock', score: 1 };
  c.thinkTimer = 99;
  sim.buildCrowd();
  sim.step(c, 0.1, { gameTime: 5, isNight: false });
  assert.equal(c.block?.need, 'food');
  assert.match(c.block.why, /provisiones/);
  assert.ok(c.avoid && c.avoid.until >= 5 + 40, 'no reintenta enseguida');
  console.log('✓ al fallar comer se guarda el motivo y se espera antes de reintentar:', c.block.why);
}

// 9) Guardar y cargar conserva los efectos temporales; los caducados no vuelven.
{
  const sim = colony();
  const c = sim.colonists[0];
  quiet(c);
  sim.gameTime = 1000;
  addMoodEvent(c, 'raid', -8, 990);
  addMoodEvent(sim.colonists[1], 'attack', -15, 1000 - EVENT_SECONDS - 5);
  const save = JSON.parse(JSON.stringify(sim.serialize()));
  const loaded = colony();
  loaded.restore(save);
  const lc = loaded.colonists.find((x) => x.id === c.id);
  assert.equal(lc.moodEvents?.length, 1);
  assert.equal(lc.moodEvents[0].id, 'raid');
  assert.equal(loaded.colonists.find((x) => x.id === sim.colonists[1].id).moodEvents, undefined, 'el caducado no vuelve');
  console.log('✓ guardar/cargar conserva el efecto vigente y descarta el caducado');
}

// 10) La réplica del navegador ve lo mismo (snapshot).
{
  const sim = colony();
  const c = sim.colonists[0];
  quiet(c);
  addMoodEvent(c, 'raid', -8, sim.gameTime);
  c.moodTarget = 33;
  c.moodBand = 1;
  c.moodTrend = -1;
  c.moodFx = { companion: 1, homeless: 0.5 };
  c.block = { need: 'water', why: 'No logra llegar a su destino', at: 0 };
  const snap = JSON.parse(JSON.stringify(sim.snapshot('full')));
  const replica = colony();
  replica.applySnapshot(snap, 'full');
  const rc = replica.colonists.find((x) => x.id === c.id);
  rc.traits = []; // la prueba vació los rasgos sólo del servidor
  assert.equal(rc.moodTarget, 33);
  assert.equal(rc.moodBand, 1);
  assert.equal(rc.moodTrend, -1);
  assert.equal(rc.moodFx.homeless, 0.5);
  assert.equal(rc.moodEvents[0].id, 'raid');
  assert.equal(rc.block.why, 'No logra llegar a su destino');
  assert.deepEqual(diagnose(replica, rc).causes.map((x) => x.id).sort(), diagnose(sim, c).causes.map((x) => x.id).sort(), 'ambos explican lo mismo');
  console.log('✓ la réplica explica lo mismo que el servidor');
}

assert.ok(hasTrait);
console.log('Todo bien.');
process.exit(0);
