// Movimiento fluido: lo que llega del servidor se interpola entre muestras (sin saltos ni cambios de velocidad), un salto grande
// no se anima, y quien camina por un camino sube con la cinta (que se dibuja por encima del terreno).
// Uso: node server/game/test/smooth.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pushSample, sampleTrack, INTERP_DELAY } from '../../../src/interp.js';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { ROAD_LIFT, ROAD_CELL, roadKey } from '../../../src/sim/economy.js';

// 1) Mensajes cada 100 ms con un colono que anda a 1,4 m/s: dibujado cada fotograma (60 por segundo) avanza parejo.
{
  const c = {};
  const xs = [];
  for (let step = 0; step <= 40; step++) {
    const tMsg = step * 0.1;
    pushSample(c, tMsg * 1.4, 0, 0, tMsg);
    // Entre mensaje y mensaje se dibujan ~6 fotogramas.
    for (let f = 0; f < 6; f++) {
      const now = tMsg + (f / 6) * 0.1;
      if (now - INTERP_DELAY < 0.3) continue; // al empezar aún no hay historia
      xs.push(sampleTrack(c, now).x);
    }
  }
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  assert.ok(Math.abs(mean - 1.4 / 60) < 0.002, `avanza a la velocidad real (${(mean * 60).toFixed(2)} m/s)`);
  assert.ok(Math.max(...steps) - Math.min(...steps) < 0.004, `pasos parejos entre fotogramas (${Math.min(...steps).toFixed(4)}..${Math.max(...steps).toFixed(4)})`);
}

// 2) Un mensaje que se retrasa: sigue un momento con la última velocidad y luego se queda (no vuelve atrás ni se dispara).
{
  const c = {};
  for (let i = 0; i <= 5; i++) pushSample(c, i * 0.14, 0, 0, i * 0.1);
  const a = sampleTrack(c, 0.5 + INTERP_DELAY + 0.1).x;
  const b = sampleTrack(c, 0.5 + INTERP_DELAY + 2).x;
  assert.ok(a > 0.7 - 1e-6, 'sigue avanzando');
  assert.ok(b - 0.7 < 1.4 * 0.25 + 1e-6, 'no se pasa más de lo razonable');
}

// 3) Un salto grande (reconectar) no se anima: se pone ahí.
{
  const c = {};
  pushSample(c, 0, 0, 0, 0);
  pushSample(c, 0.1, 0.1, 0, 0.1);
  pushSample(c, 100, 0, 0, 0.2);
  assert.equal(c.track.length, 1);
  assert.equal(sampleTrack(c, 5).x, 100);
}

// 4) El giro toma el camino corto (de 350° a 10° pasa por 0°, no por 180°).
{
  const c = {};
  pushSample(c, 0, 0, (350 * Math.PI) / 180, 0);
  pushSample(c, 0, 0, (10 * Math.PI) / 180, 0.1);
  const f = sampleTrack(c, 0.05 + INTERP_DELAY).facing;
  assert.ok(Math.abs(Math.atan2(Math.sin(f), Math.cos(f))) < 0.05, 'gira por el lado corto');
}

// 5) Sobre un camino los pies suben ROAD_LIFT; fuera, nada.
{
  const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  assert.equal(sim.roadLiftAt(2 * ROAD_CELL, 3 * ROAD_CELL), 0, 'sin caminos no sube');
  sim.roads.set(roadKey(2, 3), 1);
  assert.equal(sim.roadLiftAt(2 * ROAD_CELL, 3 * ROAD_CELL), ROAD_LIFT, 'en el centro del camino sube');
  assert.equal(sim.roadLiftAt(2 * ROAD_CELL + 1, 3 * ROAD_CELL - 1), ROAD_LIFT, 'dentro de la cinta también');
  assert.equal(sim.roadLiftAt(2 * ROAD_CELL + 6, 3 * ROAD_CELL), 0, 'fuera del camino no sube');
}

console.log('smooth.test.js: ok');
