// Correr: sólo con una necesidad urgente o con miedo, y piensa antes (distancia, cansancio); cansa mucho más y da más sed; con miedo
// corre aunque esté cansado hasta quedar sin aliento; viaja por la red.
// Uso: node server/game/test/running.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { updateNeeds, RUN_REST_COST } from '../../../src/needs.js';
import { decideRun, RUN_FACTOR } from '../../../src/sim/running.js';
import { updateMobs } from '../../../src/sim/mobs.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.clothesLeft = 0;
  for (const c of sim.colonists) {
    c.clothed = true;
    c.traits = [];
    c.task = null;
    c.needs = { food: 100, water: 100, rest: 100, warmth: 100, mood: 50 };
  }
  return sim;
}
const env = { gameTime: 100 };
// Un colono yendo a algún sitio: lo que fija walk() (c.progress) y su tarea.
const going = (c, task, tx, tz) => {
  c.task = task;
  c.progress = { tx, tz, best: Math.hypot(tx - c.x, tz - c.z), t: 0 };
};

// 1) Tranquilo, o con una necesidad normal: camina.
{
  const sim = colony();
  const c = sim.colonists[0];
  c.x = 0;
  c.z = 0;
  going(c, { type: 'eat' }, 40, 0);
  assert.equal(decideRun(sim, c, env), null, 'sin urgencia camina');
  c.needs.food = 30; // hambre, pero no extrema
  assert.equal(decideRun(sim, c, env), null, 'con hambre normal sigue caminando');
}

// 2) Hambre extrema y un buen trecho: corre. Si falta poco, no (no compensa).
{
  const sim = colony();
  const c = sim.colonists[0];
  c.x = 0;
  c.z = 0;
  c.needs.food = 8;
  going(c, { type: 'eat' }, 40, 0);
  assert.match(decideRun(sim, c, env) ?? '', /hambre/, 'hambre extrema y lejos: corre');
  going(c, { type: 'eat' }, 5, 0);
  assert.equal(decideRun(sim, c, env), null, 'a pocos pasos no compensa correr');
}

// 3) Cansado no echa a correr por una necesidad; descansado sí, y si se agota durante la carrera para y queda sin aliento.
{
  const sim = colony();
  const c = sim.colonists[0];
  c.x = 0;
  c.z = 0;
  c.needs.water = 5;
  going(c, { type: 'drink' }, 60, 0);
  c.needs.rest = 20;
  assert.equal(decideRun(sim, c, env), null, 'agotado no empieza a correr');
  c.needs.rest = 80;
  assert.match(decideRun(sim, c, env) ?? '', /sed/);
  c.running = true;
  c.needs.rest = 10; // se le acaba el aliento corriendo
  assert.equal(decideRun(sim, c, env), null, 'se agota y deja de correr');
  assert.ok(c.windedUntil > env.gameTime, 'queda sin aliento un rato');
  c.running = false;
  c.needs.rest = 90;
  assert.equal(decideRun(sim, c, env), null, 'sin aliento no vuelve a correr enseguida');
  assert.match(decideRun(sim, c, { gameTime: env.gameTime + 60 }) ?? '', /sed/, 'pasado el rato, sí');
}

// 4) Miedo con razón: sólo si un animal lo está cazando de verdad. Corre aunque esté cansado (hasta casi caer rendido); un soldado no.
{
  const sim = colony();
  const c = sim.colonists[0];
  c.x = 0;
  c.z = 0;
  going(c, { type: 'warm' }, 30, 0);
  // Un lobo cerca pero que pasea (no lo caza): no hay razón para el miedo.
  sim.mobs = [{ id: 1, type: 'lobo', x: 8, z: 0, facing: 0, state: 1, hp: 10, cd: 0, target: null }];
  c.needs.rest = 60;
  assert.equal(decideRun(sim, c, env), null, 'un hostil que pasea y no lo caza no da miedo');
  // Lo está cazando: ahora sí.
  sim.mobs[0].state = 2;
  sim.mobs[0].target = c.id;
  const wolf = sim.mobs[0].type;
  c.needs.rest = 15; // cansado
  assert.equal(decideRun(sim, c, env), 'tiene miedo', `con miedo corre aunque esté cansado (${wolf})`);
  c.needs.rest = 3;
  assert.equal(decideRun(sim, c, env), null, 'rendido ya no puede');
  c.windedUntil = 0;
  c.needs.rest = 50;
  c.soldier = { unit: 'x' };
  assert.equal(decideRun(sim, c, env), null, 'un soldado no huye así');
  c.soldier = null;
  sim.mobs[0].x = 80; // lejos
  assert.equal(decideRun(sim, c, env), null, 'lejos del animal camina');
  sim.mobs[0].x = 8;
  sim.mobs[0].target = 999; // va a por otro colono
  assert.equal(decideRun(sim, c, env), null, 'si va a por otro, él no corre');
}

// 5) Cuesta: más cansancio y más sed, y más velocidad.
{
  const mk = () => ({ genome: undefined, needs: { food: 100, water: 100, rest: 100, warmth: 100, mood: 50 }, traits: [], health: 100, flags: {} });
  const sim = colony();
  const walker = sim.colonists[0];
  const runner = sim.colonists[1];
  for (const c of [walker, runner]) c.needs = { food: 100, water: 100, rest: 100, warmth: 100, mood: 50 };
  updateNeeds(walker, { dt: 10, ambient: 0.7, walking: true, running: false, gameTime: 100, time: 12 });
  updateNeeds(runner, { dt: 10, ambient: 0.7, walking: true, running: true, gameTime: 100, time: 12 });
  const w = 100 - walker.needs.rest;
  const r = 100 - runner.needs.rest;
  assert.ok(r > w * (RUN_REST_COST * 0.7), `correr cansa mucho más (${r.toFixed(2)} vs ${w.toFixed(2)})`);
  assert.ok(runner.needs.water < walker.needs.water, 'y da más sed');
  walker.running = false;
  const base = sim.speedOf(walker);
  walker.running = true;
  assert.ok(Math.abs(sim.speedOf(walker) / base - RUN_FACTOR) < 1e-9, 'y corre más rápido');
  assert.ok(mk());
}

// 6) Dentro de la simulación: con miedo (lobo cerca) corre hacia la fogata, cuesta descanso, y el estado viaja por la red.
{
  const sim = colony();
  const c = sim.colonists[0];
  c.x = 26; // fuera del círculo de la fogata (los hostiles no cazan dentro)
  c.z = 0;
  sim.mobs = [{ id: 1, type: 'oso', x: 40, z: 0, facing: 0, state: 0, wait: 5, tx: 40, tz: 0, cd: 0, target: null }];
  const rest0 = c.needs.rest;
  let ran = false;
  for (let t = 0; t < 20; t += 0.5) {
    for (const k of ['food', 'water']) c.needs[k] = 100;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'd' });
    if (c.running) ran = true;
  }
  assert.ok(ran, 'huyó corriendo del oso que lo cazaba');
  assert.ok(c.needs.rest < rest0 - 1, `y se cansó (${rest0} -> ${c.needs.rest.toFixed(1)})`);
  c.running = true;
  const row = sim.snapshot('fast').colonists.find((r) => r[0] === c.id);
  assert.ok(row[4] & 1024, 'el estado de correr viaja por la red');
}

console.log('running.test.js: ok');
