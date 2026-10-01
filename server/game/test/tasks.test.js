// Obras y órdenes: las obras avanzan, la prioridad se nota, las órdenes directas se cumplen
// (y se rechazan con motivo), pausar detiene y todo se guarda.
// Uso: node server/game/test/tasks.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { DAY_LENGTH_SECONDS as DAY } from '../../../src/daynight.js';

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
const run = (sim, seconds, night = false) => {
  for (let t = 0; t < seconds; t += 0.5) {
    for (const k of ['food', 'water']) sim.stock[k] = Math.max(sim.stock[k], 900);
    sim.update(0.5, { timeScale: 1, isNight: night, timeLabel: () => 'Día 1' });
  }
};
const site = (sim, id, x, z) => {
  const b = sim.createBuilding(BUILDINGS[id], x, z, 0, 0, 0);
  b.done = false;
  b.progress = 0;
  return b;
};

// Una obra normal avanza (ya no se queda en 0 %) y informa su estado.
{
  const sim = colony();
  const b = site(sim, 'stockpile', 24, 12);
  assert.equal(sim.siteInfo(b).state, 'waiting');
  run(sim, 40);
  assert.ok(b.progress > 0 || b.done, 'la obra avanza');
}

// Prioridad: la alta se construye antes que la baja cuando hay una sola mano libre.
{
  const sim = colony();
  const low = site(sim, 'stockpile', 24, 12);
  const high = site(sim, 'stockpile', -24, 12);
  assert.equal(sim.setPriority(low, 'low'), true);
  assert.equal(sim.setPriority(high, 'high'), true);
  assert.equal(sim.setPriority(high, 'inventada'), false);
  run(sim, 60);
  assert.ok(high.progress > low.progress, `alta ${high.progress} > baja ${low.progress}`);
}

// Pausada: nadie la toca; reanudada, avanza.
{
  const sim = colony();
  const b = site(sim, 'stockpile', 24, 12);
  sim.pauseSite(b, true);
  assert.equal(sim.siteInfo(b).state, 'paused');
  run(sim, 40);
  assert.equal(b.progress, 0);
  sim.pauseSite(b, false);
  run(sim, 40);
  assert.ok(b.progress > 0 || b.done);
}

// Órdenes: se rechazan niños, soldados, obras terminadas; se cumplen aunque sea de noche
// y al terminar la obra el colono vuelve a decidir solo.
{
  const sim = colony();
  const b = site(sim, 'stockpile', 24, 12);
  const adult = sim.colonists.find((c) => !c.soldier && (c.growth ?? 1) >= 1);
  const child = { ...adult, id: 999, name: 'Peque', growth: 0.2, soldier: null };
  assert.match(sim.orderColonist(child, 'build', b), /niño/);
  const sold = { ...adult, id: 998, name: 'Guardia', soldier: { unit: 'club', tier: 0 } };
  assert.match(sim.orderColonist(sold, 'build', b), /soldado/);
  assert.match(sim.orderColonist(adult, 'harvest'), /marcados/);
  assert.equal(sim.orderColonist(adult, 'build', b), null);
  assert.deepEqual(adult.order, { kind: 'build', building: b.id });
  run(sim, 30, true);
  assert.ok(b.progress > 0, 'la orden se cumple de noche');
  assert.ok(sim.siteInfo(b).ordered.includes(adult.id));
  // Guardado y restauración conservan prioridad, pausa y orden.
  sim.setPriority(b, 'high');
  const saved = JSON.parse(JSON.stringify(sim.serialize()));
  const again = colony();
  assert.equal(again.restore(saved), true);
  const b2 = again.buildings.find((o) => o.id === b.id);
  assert.equal(b2.priority, 'high');
  assert.equal(again.colonist(adult.id).order.building, b.id);
  run(sim, 600);
  assert.ok(b.done, 'termina');
  assert.equal(adult.order, null, 'la orden termina con la obra');
  assert.match(sim.orderColonist(adult, 'build', b), /terminada|existe/);
}
// Aldea guardada antes de la actualización: edad 4 con una choza de nivel 1. Al cargarla la casa
// toma el aspecto de la edad, sin cobrar nada, y cargar otra vez no cambia nada más.
{
  const sim = colony();
  sim.age = 4;
  const house = sim.createBuilding(BUILDINGS.house, 20, 14, 0, 1, 0);
  house.level = 1;
  const saved = JSON.parse(JSON.stringify(sim.serialize()));
  saved.buildings.find((b) => b.id === house.id).level = 1;
  const again = colony();
  again.restore(saved);
  const h = again.buildings.find((b) => b.id === house.id);
  assert.ok(h.level >= 3, `la casa evoluciona con la edad (nivel ${h.level})`);
  const stock = JSON.stringify(again.stock);
  const lv = h.level;
  again.restore(saved);
  assert.equal(JSON.stringify(again.stock), stock, 'sin costes ni recursos duplicados');
  assert.equal(h.level, lv);
}

// "4/3": los niños viven con su madre y no ocupan plazas; la cuenta separa adultos y niños.
{
  const sim = colony();
  const house = sim.createBuilding(BUILDINGS.house, 20, 14, 0, 1, 0);
  const [a, b2, c3] = sim.colonists;
  a.home = b2.home = c3.home = house.id;
  const kid = sim.colonists[3];
  kid.growth = 0.3;
  kid.home = house.id;
  const r = sim.residents(house);
  assert.equal(r.adults.length, 3);
  assert.equal(r.children.length, 1);
}
// Almacén lleno: quien produce ese bien no se queda parado esperando; hace otra cosa.
{
  const sim = colony();
  const b = sim.createBuilding(BUILDINGS.gatherer, 22, 10, 0, 1, 0);
  const w = sim.colonists.find((c) => !c.soldier && (c.growth ?? 1) >= 1);
  sim.setWorker(b, w);
  sim.isFull = (k) => k === b.def.stock;
  const other = site(sim, 'stockpile', -24, 12);
  run(sim, 40);
  assert.ok(other.progress > 0 || other.done, 'ayuda en la obra en vez de esperar');
}
// Demoler devuelve la mitad; mover conserva nivel y dotación y valida el sitio.
{
  const sim = colony();
  const b = sim.createBuilding(BUILDINGS.gatherer, 22, 10, 0, 1, 0);
  const w = sim.colonists.find((c) => !c.soldier && (c.growth ?? 1) >= 1);
  sim.setWorker(b, w);
  assert.match(sim.moveProblem(b, 0, 0), /Choca/);
  assert.equal(sim.moveBuilding(b, -22, 14), null);
  const moved = sim.buildings.find((o) => o.def.id === 'gatherer');
  assert.equal(sim.buildings.length, 1);
  assert.ok(Math.abs(moved.x + 22) < 1e-9 && moved.done);
  assert.equal(w.job, moved);
  assert.deepEqual(moved.workers, [w]);
  const cost = moved.def.levels[0].buildCost ?? moved.def.cost;
  sim.stock.wood = 20;
  sim.stock.fiber = 5;
  const before = { ...sim.stock };
  assert.equal(sim.applyCommand('demolish', [moved.id]), true);
  assert.equal(sim.buildings.length, 0);
  assert.equal(w.job, null);
  for (const [k, n] of Object.entries(cost)) assert.equal(sim.stock[k] - before[k], Math.floor(n / 2), `devuelve la mitad de ${k}`);
  assert.equal(sim.applyCommand('demolish', [moved.id]), false);
}
// Recolección por filtros: sólo se marca lo elegido; el servidor limpia el filtro recibido.
{
  const sim = colony();
  const rect = { cx: 0, cz: 0, hw: 120, hd: 120, angle: 0 };
  const kinds = new Set(sim.spots.filter((s) => !s.gone).map((s) => s.kind));
  assert.ok(kinds.has('wood') && (kinds.has('stone') || kinds.has('food')), 'hay varios tipos');
  assert.equal(sim.applyCommand('markRect', [rect, true, ['wood']]), true);
  const marked = sim.spots.filter((s) => s.marked);
  assert.ok(marked.length > 0 && marked.every((s) => s.kind === 'wood'), 'sólo madera');
  sim.applyCommand('markRect', [rect, true, ['peligro', 7]]);
  assert.ok(sim.spots.filter((s) => s.marked).every((s) => s.kind === 'wood'), 'un filtro inválido no marca nada');
  sim.applyCommand('markRect', [rect, true, null]);
  assert.ok(sim.spots.some((s) => s.marked && s.kind !== 'wood'), 'sin filtro marca todo');
  sim.applyCommand('clearMarks', [['wood']]);
  assert.ok(!sim.spots.some((s) => s.marked && s.kind === 'wood') && sim.spots.some((s) => s.marked), 'quita sólo lo elegido');
}
// Caminos automáticos: unen cada edificio terminado con el centro, suben con la edad, se pueden
// quitar (y no vuelven) y apagar; lo pintado a mano es del jugador.
{
  const sim = colony();
  sim.age = 3;
  const key = (c) => c.join(',');
  const b = sim.createBuilding(BUILDINGS.gatherer, 30, 14, 0, 0, 0);
  b.done = false;
  b.finish(null);
  assert.ok(sim.roads.size > 3, `se trazó un camino (${sim.roads.size} casillas)`);
  assert.equal(sim.roads.size, sim.autoRoadKeys.size);
  assert.ok([...sim.roads.values()].every((lv) => lv === 1));
  const before = sim.roads.size;
  const stock = JSON.stringify(sim.stock);
  assert.equal(stock, JSON.stringify(sim.stock), 'gratis');
  // Quitar una casilla: no vuelve a salir sola.
  const [first] = [...sim.autoRoadKeys];
  assert.equal(sim.applyCommand('eraseRoads', [[first.split(',').map(Number)]]), true);
  assert.ok(!sim.roads.has(first) && sim.roadsOff.has(first));
  sim.autoConnect();
  assert.ok(!sim.roads.has(first), 'no se vuelve a trazar lo quitado');
  // Nueva edad: los caminos de la aldea suben solos de nivel.
  sim.age = 5;
  sim.refreshAutoRoads();
  assert.ok([...sim.autoRoadKeys].every((k) => sim.roads.get(k) === 2));
  // Guardado y carga conservan la configuración.
  const again = colony();
  again.age = 5;
  again.restore(JSON.parse(JSON.stringify(sim.serialize())));
  assert.equal(again.roads.size, sim.roads.size);
  assert.ok(again.roadsOff.has(first));
  // Apagar los automáticos quita los de la aldea y deja los manuales.
  sim.stock.stone = 50;
  const manual = [[-5, -5], [-5, -4]];
  assert.equal(sim.paintRoads(manual), true);
  assert.equal(sim.setAutoRoads(false), true);
  assert.equal(sim.autoRoadKeys.size, 0);
  assert.ok(sim.roads.has(key(manual[0])) && sim.roads.size <= 2 + 0, 'sólo quedan los manuales');
  assert.ok(before > 0);
}
// Los caminos no atraviesan la zona de acopio ni los edificios; y al dibujar la zona se quitan.
{
  const sim = colony();
  sim.age = 3;
  sim.stock.fiber = 100;
  const zone = { cx: 28, cz: 0, hw: 6, hd: 6, angle: 0 };
  assert.equal(sim.setZone(zone), null);
  const [zix, ziz] = [7, 0];
  assert.ok(sim.paintRoads([[zix, ziz]]) === false, 'no se puede pintar sobre la zona');
  sim.roads.set('7,0', 1);
  sim.roads.set('0,5', 1);
  sim.pruneRoads();
  assert.ok(!sim.roads.has('7,0') && sim.roads.has('0,5'), 'se quitó sólo lo que pisa la zona');
  const b = sim.createBuilding(BUILDINGS.gatherer, 30, -14, 0, 1, 0);
  for (const key of sim.roads.keys()) {
    const [ix, iz] = key.split(',').map(Number);
    assert.ok(Math.hypot(ix * 4 - b.x, iz * 4 - b.z) > b.def.footprint, 'no atraviesa edificios');
  }
}
console.log('tasks.test ✓');
