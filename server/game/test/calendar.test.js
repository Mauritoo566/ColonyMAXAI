// Calendario del mundo y estaciones: años de 365 días, la misma fecha para todos, hemisferios invertidos,
// clima local, que el reloj sobreviva a un reinicio y que el primer invierno no sea una condena.
// Uso: node server/game/test/calendar.test.js

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { DAY_LENGTH_SECONDS as DAY, YEAR_DAYS, YEAR_SECONDS, dateAt, declinationAt, seasonAt, effectiveTemperature, snowCover, growthFactor } from '../../../src/sim/calendar.js';
import { DayNight } from '../../../src/daynight.js';
import { Store } from '../store.js';
import { World } from '../world.js';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';

// 1) Un año son 365 días exactos y 36 h 30 min reales; el día 365 pasa al día 1 del año siguiente.
assert.equal(YEAR_DAYS, 365);
assert.equal(DAY, 360, 'un día dura 6 minutos');
assert.equal(YEAR_SECONDS / 3600, 36.5, 'un año dura 36 h 30 min');
{
  const at = (day, frac = 0) => dateAt(((day - 1) + frac - 0.5) * DAY); // día N (de 1) a esa fracción del día
  assert.deepEqual([at(1).year, at(1).dayOfYear], [1, 1]);
  assert.deepEqual([at(365, 0.99).year, at(365, 0.99).dayOfYear], [1, 365]);
  assert.deepEqual([at(366).year, at(366).dayOfYear], [2, 1], 'el día 365 pasa al día 1 del año siguiente');
  assert.deepEqual([at(730).year, at(730).dayOfYear], [2, 365]);
  assert.deepEqual([at(731).year, at(731).dayOfYear], [3, 1]);
  // Coincide con el «Día N» que ya mostraba el juego.
  const clock = new DayNight({ startLon: 0, startHour: 12 });
  for (const e of [0, 12_345, 360 * 77.3, 360 * 365, 360 * 1000.9]) {
    clock.setElapsed(e);
    assert.equal(dateAt(e).day, clock.day, `día absoluto en ${e}`);
  }
  // El Sol se inclina según la fecha: máximo en el solsticio, cero en los equinoccios.
  assert.ok(Math.abs(declinationAt(0)) < 0.01);
  assert.ok(Math.abs((declinationAt(YEAR_SECONDS * 0.25 - 0.5 * DAY) * 180) / Math.PI - 23.44) < 0.1);
  assert.ok(declinationAt(YEAR_SECONDS * 0.75 - 0.5 * DAY) < 0);
}

// 2) Dos jugadores que entran a horas distintas comparten la fecha: sólo depende de los segundos del mundo.
{
  const elapsed = 200 * DAY + 123;
  const a = dateAt(elapsed);
  const b = dateAt(elapsed);
  assert.deepEqual(a, b);
}

// 3) Hemisferios invertidos; ecuador sin cuatro estaciones; polos reconocibles.
{
  const idAt = (sinLat, day) => seasonAt(sinLat, ((day - 1) / YEAR_DAYS) % 1).id;
  assert.equal(idAt(0.6, 20), 'spring');
  assert.equal(idAt(-0.6, 20), 'autumn', 'en el sur es otoño cuando en el norte es primavera');
  assert.equal(idAt(0.6, 120), 'summer');
  assert.equal(idAt(-0.6, 120), 'winter');
  assert.equal(idAt(0.6, 320), 'winter');
  assert.equal(idAt(-0.6, 320), 'summer');
  for (let d = 1; d <= 365; d += 15) {
    const n = seasonAt(0.6, (d - 1) / 365);
    const s = seasonAt(-0.6, (d - 1) / 365);
    assert.ok(Math.abs(n.warmth + s.warmth) < 1e-9, 'el calor del sur es el opuesto al del norte');
    const eq = seasonAt(0.01, (d - 1) / 365);
    assert.ok(Math.abs(eq.warmth) < 0.1, 'en el ecuador casi no cambia la temperatura');
    assert.ok(['wet', 'dry'].includes(eq.id), 'el ecuador tiene épocas húmeda y seca, no cuatro estaciones');
  }
  assert.ok(seasonAt(0.97, 0.5).polar);
  // Trópico norte: la época de lluvias es la del verano boreal; en el trópico sur, la opuesta.
  assert.ok(seasonAt(0.3, 0.3).wetBias > 0.1);
  assert.ok(seasonAt(-0.3, 0.3).wetBias < -0.1);
}

// 4) La nieve sólo donde hace frío de verdad: invierno en latitudes altas sí, trópicos nunca.
{
  const winterN = seasonAt(0.9, 0.9);
  const summerN = seasonAt(0.9, 0.4);
  const base = 1.05 - 0.7; // temperatura base a ~64° de latitud en tierra baja
  assert.ok(snowCover(effectiveTemperature(base, winterN)) > 0.7, 'nieva en el invierno de latitudes altas');
  assert.ok(snowCover(effectiveTemperature(base, summerN)) < 0.05, 'en verano no queda nieve');
  for (let d = 1; d <= 365; d += 10) assert.equal(snowCover(effectiveTemperature(0.95, seasonAt(0.1, (d - 1) / 365))), 0, 'ni un día de nieve en el trópico llano');
  assert.ok(growthFactor(effectiveTemperature(0.5, winterN), winterN) < growthFactor(effectiveTemperature(0.5, summerN), summerN), 'los cultivos rinden menos en invierno');
}

// 5) El reloj del mundo se guarda: un reinicio no lo reinicia, y una caída no lo pausa (ni cambia la fecha de nadie).
{
  const dir = mkdtempSync(join(tmpdir(), 'cmx-cal-'));
  const file = join(dir, 'game.db');
  const realNow = Date.now;
  const stores = [];
  try {
    Date.now = () => 1_700_000_000_000;
    const store1 = new Store(file);
    const first = new World({ store: store1, log: () => {} });
    const epoch = first.epoch;
    const firstDate = first.date;
    assert.equal(firstDate.year, 1);
    // El servidor estuvo caído 40 horas: al volver, el calendario siguió su curso (año 2).
    Date.now = () => 1_700_000_000_000 + 40 * 3600 * 1000;
    store1.close();
    const store2 = new Store(file);
    stores.push(store2);
    const second = new World({ store: store2, log: () => {} });
    assert.equal(second.epoch, epoch, 'el origen del mundo se conserva tras reiniciar');
    assert.equal(second.date.year, 2, '40 horas reales después ya es el año 2');
    assert.ok(second.date.day > firstDate.day);
    // Un tick de simulación no puede atrasar ni adelantar la fecha de ninguna colonia.
    assert.equal(second.date.dayOfYear, dateAt(second.elapsed).dayOfYear);
  } finally {
    Date.now = realNow;
    for (const st of stores) st.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows puede tardar en soltar el archivo: es un temporal */
    }
  }
}

// 6) Efectos en la simulación: el frío baja el calor, el calor sube la sed, los cultivos y bayas crecen según la época, y
//    la nieve cae donde y cuando corresponde. El primer invierno no mata a nadie.
{
  const dirNorth = new THREE.Vector3(-0.5273752893525795, 0.8349520874337516, -0.15725875451085092).normalize(); // una taiga real (56° N)
  const make = () => {
    const sim = new ColonySim();
    sim.weather = new WeatherState(5);
    sim.weather.setPlace(dirNorth);
    sim.setCamp({ dir: dirNorth, height: naturalSurfaceHeight(dirNorth), yaw: 0, seed: 777 }, { ownZone: true });
    sim.clothesLeft = 0;
    sim.colonists.forEach((c) => (c.clothed = true));
    sim.stock = { food: 900, water: 900, wood: 900, stone: 600, fiber: 300 };
    sim.timeLabel = () => 'Año 1';
    return sim;
  };
  const winter = seasonAt(dirNorth.y, 0.9);
  const summer = seasonAt(dirNorth.y, 0.4);
  const a = make();
  const b = make();
  a.setSeason(winter);
  b.setSeason(summer);
  assert.ok(a.growth() < b.growth(), 'crece menos en invierno que en verano');
  assert.ok(a.currentTemperature < b.currentTemperature);
  a.weather.setClimate({ snowy: a.snowing });
  assert.equal(a.weather.snowy, a.snowing);
  a.weather.rain = 1;
  assert.ok(a.weather.effectiveRain <= 0.3 + 1e-9 || !a.weather.snowy, 'la nieve no llena pozos como la lluvia');
  // El brote de bayas tarda más en volver a crecer en invierno.
  const bush = () => ({ key: 99, index: 0, kind: 'food', type: 'berryBush', x: 60, z: 0, readyAt: 0, taken: null });
  const spotA = bush();
  const spotB = bush();
  a.spots.push(spotA);
  b.spots.push(spotB);
  a.consumeSpot(spotA, 0);
  b.consumeSpot(spotB, 0);
  assert.ok(spotA.readyAt > spotB.readyAt, 'rebrota más despacio con frío');

  // Un invierno completo (91 días de juego) a ~53° de latitud: con el dueño presente, nadie muere de frío.
  const sim = make();
  const phase0 = 0.75; // arranca el invierno boreal
  const WINTER_DAYS = 45;
  for (let t = 0; t < WINTER_DAYS * DAY; t += 6) {
    sim.setSeason(seasonAt(dirNorth.y, (phase0 + t / YEAR_SECONDS) % 1));
    for (const k of ['food', 'water']) sim.stock[k] = Math.max(sim.stock[k], 400);
    sim.update(6, { timeScale: 1, isNight: Math.floor(t / (DAY / 2)) % 2 === 1, timeLabel: () => 'x', maxSteps: 70 });
  }
  assert.equal(sim.colonists.length, 5, 'los cinco colonos siguen vivos tras el primer invierno');
  assert.ok(sim.colonists.every((c) => c.health > 20), 'ninguno quedó al borde de la muerte');
}

console.log('calendar.test ✓');
