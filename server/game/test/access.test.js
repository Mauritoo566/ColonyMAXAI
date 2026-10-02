// Accesos: delante de una puerta sólo caminos o nada, la reserva gira con el edificio, se valida en ambos sentidos,
// se libera al demoler, las construcciones antiguas se conservan (y se señalan) y los colonos usan la entrada.
// Uso: node server/game/test/access.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { roadCellProblem } from '../../../src/sim/economy.js';
import { entranceOf, footprintRect, halfOf, rectsOverlap, entranceKind } from '../../../src/sim/access.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  sim.clothesLeft = 0;
  sim.colonists.forEach((c) => (c.clothed = true));
  sim.stock = { food: 900, water: 900, wood: 900, stone: 600, fiber: 300, planks: 100, bricks: 100, cut_stone: 100 };
  sim.timeLabel = () => 'Día 1';
  sim.age = 2;
  return sim;
}
const run = (sim, seconds) => {
  for (let t = 0; t < seconds; t += 0.5) {
    for (const k of ['food', 'water']) sim.stock[k] = Math.max(sim.stock[k], 900);
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
  }
};
const HOUSE = BUILDINGS.house;
const STOCK = BUILDINGS.stockpile;

// 0) Geometría: huella en casillas enteras, entrada de una casilla de fondo, y gira con el edificio.
{
  assert.equal(entranceKind(HOUSE), 'door');
  assert.equal(entranceKind(BUILDINGS.quarry), 'open', 'las estructuras abiertas tienen punto de trabajo, no puerta');
  assert.equal(entranceKind(BUILDINGS.wall), null, 'un muro no tiene entrada');
  const e0 = entranceOf(HOUSE, 24, 12, 0);
  assert.deepEqual(e0.normal, { x: 0, z: 1 });
  const h = halfOf(HOUSE.footprint);
  assert.equal(e0.door.z, 12 + h);
  assert.equal(e0.zone.z0, 12 + h);
  assert.equal(e0.zone.z1, 12 + h + 4, 'una casilla de fondo');
  const e1 = entranceOf(HOUSE, 24, 12, Math.PI / 2);
  assert.deepEqual(e1.normal, { x: 1, z: 0 }, 'girada 90°, mira al este');
  assert.equal(e1.zone.x0, 24 + h);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const e = entranceOf(HOUSE, 0, 0, yaw);
    assert.equal(rectsOverlap(e.zone, footprintRect(HOUSE, 0, 0)), false, 'la franja nunca pisa su propia huella');
  }
}

// 1) Delante de la puerta sólo hay camino o nada.
{
  const sim = colony();
  const house = sim.build('house', 24, 12, 0).building;
  assert.ok(house, 'se construye la casa');
  assert.ok(house.entrance && house.entrance.kind === 'door', 'tiene entrada desde que se pone el plano');
  assert.equal(house.done, false);
  const frontIz = Math.round(16 / 4); // la casilla delante de la puerta
  assert.equal(roadCellProblem(sim, 6, frontIz), null, 'se puede poner un camino delante de la puerta');
  assert.equal(roadCellProblem(sim, 6, 3), 'Hay algo encima', 'pero no sobre la propia casa');
  // Ningún otro edificio puede tapar la entrada…
  const problem = sim.buildProblem(STOCK, 24, 16, 0);
  assert.match(problem ?? '', /Bloquea la entrada de/, 'no se puede tapar la puerta de otro');
  assert.equal(sim.build('stockpile', 24, 16, 0).building, undefined);
  // …ni al costado de la franja, donde sí hay espacio.
  assert.equal(sim.buildProblem(STOCK, 32, 12, 0), null, 'al costado sí');
  assert.equal(sim.buildProblem(STOCK, 24, 22, 0), null, 'más allá de la franja también');
  // Y se puede dejar libre sin nada.
  assert.equal(sim.accessBlocked(24, 16), true);
  assert.equal(sim.accessBlocked(24, 22), false);
}

// 2) En el otro sentido: no se puede poner un edificio cuya entrada quede tapada por lo que ya hay.
{
  const sim = colony();
  assert.ok(sim.build('stockpile', 24, 16, 0).building);
  const problem = sim.buildProblem(HOUSE, 24, 12, 0);
  assert.match(problem ?? '', /La entrada necesita espacio libre/);
  // Mirando para otro lado sí cabe (la reserva rota con el edificio).
  assert.equal(sim.buildProblem(HOUSE, 24, 12, Math.PI), null, 'de espaldas al almacén la puerta queda libre');
  assert.equal(sim.buildProblem(HOUSE, 24, 12, Math.PI / 2), null);
}

// 3) La reserva gira junto con el edificio.
{
  const sim = colony();
  const house = sim.build('house', 24, 12, Math.PI / 2).building; // mira al este
  assert.match(sim.buildProblem(STOCK, 30, 12, 0) ?? '', /Bloquea la entrada/, 'la franja está al este');
  assert.equal(sim.buildProblem(STOCK, 24, 20, 0), null, 'el lado que antes era el frente ahora está libre');
  assert.deepEqual(house.entrance.normal, { x: 1, z: 0 });
}

// 4) Mover, mejorar y demoler.
{
  const sim = colony();
  const house = sim.build('house', 24, 12, 0).building;
  house.progress = 1;
  house.finish?.(null);
  const before = JSON.stringify(house.entrance);
  assert.equal(sim.moveProblem(house, 24, 12, 0), null, 'moverlo sobre sí mismo no choca con su propia entrada');
  // Mejorar no cambia la huella ni la entrada, así que no puede invadir nada.
  sim.stock = { ...sim.stock, wood: 900, stone: 900, fiber: 900, bronze: 99, bricks: 99, planks: 99, cut_stone: 99 };
  sim.upgrade(house);
  assert.equal(JSON.stringify(house.entrance), before, 'la entrada no cambia al mejorar');
  // Al demoler se libera la reserva.
  assert.match(sim.buildProblem(STOCK, 24, 16, 0) ?? '', /Bloquea la entrada/);
  assert.equal(sim.demolish(house), true);
  assert.equal(sim.buildProblem(STOCK, 24, 16, 0), null, 'demolido, el lugar vuelve a estar libre');
  assert.equal(sim.accessBlocked(24, 16), false);
}

// 5) Construcciones antiguas con la entrada tapada: se conservan, se señalan y se pueden resolver con las acciones normales.
{
  const sim = colony();
  const house = sim.createBuilding(HOUSE, 24, 12, 0, 1, 0);
  const blocker = sim.createBuilding(STOCK, 24, 16, 0, 1, 0); // como en una partida vieja: ya está ahí
  assert.equal(sim.buildings.length, 2, 'no se borra ni se mueve nada');
  assert.match(house.accessIssue ?? '', /bloqueada por/, 'se señala el edificio con la entrada tapada');
  assert.equal(blocker.accessIssue, null, 'el que tapa no tiene problema propio');
  const saved = JSON.parse(JSON.stringify(sim.serialize()));
  const fresh = colony();
  fresh.restore(saved);
  assert.equal(fresh.buildings.length, 2, 'cargar la partida conserva las dos construcciones');
  assert.ok(fresh.buildings.some((b) => b.accessIssue), 'y vuelve a detectar el problema (repetible, sin duplicar)');
  const again = colony();
  again.restore(JSON.parse(JSON.stringify(fresh.serialize())));
  assert.equal(again.buildings.length, 2, 'guardar y volver a cargar no duplica nada');
  assert.equal(again.buildings.filter((b) => b.accessIssue).length, 1, 'y el aviso es el mismo');
  // Se resuelve moviendo cualquiera de los dos.
  const mover = fresh.buildings.find((b) => b.def.id === 'stockpile');
  assert.equal(fresh.moveBuilding(mover, 36, 12, 0), null);
  assert.ok(fresh.buildings.every((b) => !b.accessIssue), 'sin el estorbo, la señal desaparece');
}

// 6) Los árboles y brotes no nacen en la entrada.
{
  const sim = colony();
  sim.build('house', 30, 0, 0);
  const zone = sim.buildings[0].entrance.zone;
  const inside = { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 };
  assert.equal(sim.resourceSiteProblem(inside.x, inside.z) !== null, true, 'no se planta en el acceso');
}

// 7) Los colonos usan la entrada: el trabajador de una pedrera espera en su punto de trabajo y nunca dentro de la huella.
{
  const sim = colony();
  sim.colonists.forEach((c) => (c.spec = ['mining', 'gathering', 'building']));
  sim.stock.stone = 0; // con el almacén de piedra lleno el cantero esperaría
  const quarry = sim.createBuilding(BUILDINGS.quarry, 22, 10, 0, 1, 0);
  sim.assignWorker(quarry);
  const foot = footprintRect(quarry.def, quarry.x, quarry.z);
  let atPost = 0;
  const worker = () => quarry.workers[0];
  for (let t = 0; t < 240; t += 0.5) {
    run(sim, 0.5);
    const w = worker();
    if (!w) continue;
    assert.equal(w.x > foot.x0 + 0.05 && w.x < foot.x1 - 0.05 && w.z > foot.z0 + 0.05 && w.z < foot.z1 - 0.05, false, 'nunca atraviesa las paredes');
    if (w.working && Math.hypot(w.x - quarry.entrance.approach.x, w.z - quarry.entrance.approach.z) < 1.6) atPost++;
  }
  assert.ok(atPost > 10, `trabaja en su punto de trabajo (${atPost})`);
}

// 8) Entrada tapada en un edificio de trabajo: no insiste, lo explica y no lo confunde con falta de materiales.
{
  const sim = colony();
  sim.colonists.forEach((c) => (c.spec = ['mining', 'gathering', 'building']));
  sim.stock.stone = 0;
  const quarry = sim.createBuilding(BUILDINGS.quarry, 22, 10, 0, 1, 0);
  sim.createBuilding(STOCK, 22, 16, 0, 1, 0); // tapa la franja de la pedrera
  assert.ok(quarry.accessIssue, 'detecta la entrada tapada');
  sim.assignWorker(quarry);
  const stoneBefore = sim.stock.stone;
  run(sim, 90);
  assert.equal(quarry.status, quarry.accessIssue, 'la ficha dice el motivo real');
  assert.equal(sim.stock.stone, stoneBefore, 'no produce con la entrada tapada');
  assert.ok(sim.colonists.every((c) => c.health > 90), 'nadie se queda trabado: sigue viviendo');
}

console.log('access.test ✓');
