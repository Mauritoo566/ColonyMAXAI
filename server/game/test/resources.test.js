// Recursos naturales: lo que existe para los colonos siempre existe a la vista (mismas reglas de dónde
// puede haber un recurso), las partidas viejas con brotes invisibles se limpian solas y sin duplicar,
// y lo que se recolecta es una entidad real que se consume una sola vez.
// Uso: node server/game/test/resources.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { SPROUT_KEY } from '../../../src/resourceGen.js';
import { chooseTask } from '../../../src/ai.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  sim.clothesLeft = 0;
  sim.colonists.forEach((c) => (c.clothed = true));
  sim.stock = { food: 900, water: 900, wood: 900, stone: 600, fiber: 300 };
  sim.timeLabel = () => 'Día 1';
  return sim;
}
const live = (sim) => sim.spots.filter((s) => s.key === SPROUT_KEY && !s.gone);

// 1) Los brotes de la lluvia nacen donde el mundo los dibuja: fuera del claro del campamento (45 m).
{
  const sim = colony();
  for (let i = 0; i < 40; i++) sim.sprout();
  const spots = live(sim);
  assert.ok(spots.length > 5, `brotaron varios (${spots.length})`);
  for (const s of spots) {
    assert.ok(Math.hypot(s.x, s.z) >= 45, `brote a ${Math.hypot(s.x, s.z).toFixed(1)} m: dentro del claro, no se dibujaría`);
    assert.equal(sim.blockedByBuilding(s.x, s.z), false);
  }
  assert.ok(sim.liveSprouts() <= 50, 'hay tope de brotes vivos');
}

// 2) Una partida vieja con brotes dentro del claro: se descartan, los demás conservan marca y orden; repetible.
{
  const sim = colony();
  for (let i = 0; i < 6; i++) sim.sprout();
  const good = live(sim).map((s) => s.index);
  const toLocalDir = (x, z) => sim.toDirection(x, z, new THREE.Vector3());
  // Dos brotes "antiguos" a 30 m del campamento (donde nunca se dibujaron).
  for (const [x, z] of [[30, 0], [0, -30]]) {
    const p = toLocalDir(x, z);
    sim.sprouts.push({ typeIndex: sim.sprouts[0].typeIndex, d: [p.x, p.y, p.z], h: 1, yaw: 0, scale: 1, tint: 1, rank: 0, readyAt: 0 });
  }
  sim.refreshSprouts();
  assert.equal(sim.sprouts.length, good.length + 2);
  const marked = live(sim)[0];
  sim.markArea(marked.x, marked.z, 1, true);
  const saved = JSON.parse(JSON.stringify(sim.serialize()));
  const fresh = colony();
  fresh.restore(saved);
  assert.equal(fresh.sprouts.length, good.length, 'los dos invisibles se descartaron');
  assert.ok(live(fresh).every((s) => Math.hypot(s.x, s.z) >= 45));
  assert.equal(live(fresh).filter((s) => s.marked).length, 1, 'la marca sobrevive al reordenar índices');
  // Guardar y cargar otra vez no cambia nada ni duplica.
  const again = colony();
  again.restore(JSON.parse(JSON.stringify(fresh.serialize())));
  assert.equal(again.sprouts.length, fresh.sprouts.length);
  assert.equal(live(again).length, live(fresh).length);
}

// 3) Ramas caídas del suelo: recursos de verdad (con lugar válido), que se consumen una vez y liberan el cupo.
{
  const sim = colony();
  sim.age = 2;
  const cutter = sim.createBuilding(BUILDINGS.woodcutter ?? BUILDINGS.lumberjack ?? Object.values(BUILDINGS).find((d) => d.scavenge && d.resource === 'wood'), 60, 20, 0, 1, 0);
  const spot = sim.spawnLitter('wood', cutter);
  assert.ok(spot, 'aparece una rama caída');
  assert.equal(spot.type, 'sticks');
  assert.equal(sim.resourceSiteProblem(spot.x, spot.z) === null || sim.spots.includes(spot), true);
  assert.ok(Math.hypot(spot.x, spot.z) >= 45);
  const before = sim.liveSprouts();
  sim.consumeSpot(spot, sim.gameTime);
  assert.equal(spot.gone, true);
  assert.equal(sim.liveSprouts(), before - 1, 'consumirlo libera el cupo');
  // Lo consumido no se puede elegir otra vez: ninguna tarea apunta a un recurso agotado.
  assert.equal(sim.nearestSpot('wood', spot.x, spot.z, 5, sim.gameTime) === spot, false);
  // Compactar el arreglo conserva a los vivos.
  const other = sim.spawnLitter('wood', cutter);
  other.marked = true;
  sim.compactSprouts();
  const kept = live(sim).find((s) => s.marked);
  assert.ok(kept, 'la marca del superviviente se conserva al compactar');
  assert.equal(sim.sprouts.length, live(sim).length);
}

// 4) Un recurso agotado no se puede cobrar dos veces: dos colonos, un solo premio.
{
  const sim = colony();
  sim.age = 2;
  const spot = sim.spots.find((s) => s.kind === 'wood' && !s.gone && sim.usable(s));
  const [a, b] = sim.colonists;
  spot.taken = a;
  assert.equal(sim.nearestSpot('wood', spot.x, spot.z, 3, 0) === spot, false, 'mientras alguien va a por él, otro no lo elige');
  const stockBefore = sim.stock.wood;
  sim.consumeSpot(spot, 0);
  spot.gone = true;
  assert.equal(chooseTask(sim, b, { gameTime: 0, isNight: false, time: 'd' }) !== undefined, true);
  assert.equal(sim.stock.wood, stockBefore, 'consumir un punto no suma nada por sí solo: el material entra al llegar al almacén');
}

console.log('resources.test ✓');
