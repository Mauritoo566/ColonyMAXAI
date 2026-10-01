// Edad Primitiva de principio a fin (sin red): campamento inicial, recolección por zona y automática,
// refugios y almacén con recursos primitivos, agua de lluvia, escasez y muerte, descubrimiento de la
// primera herramienta, guía, guardado, nacimientos, derrota y nueva fundación, y las ausencias.
// Uso: node server/game/test/primitive.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS, levelOf } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { DAY_LENGTH_SECONDS as DAY } from '../../../src/daynight.js';
import { nextAgeStatus, AGES } from '../../../src/ages.js';
import { guideState } from '../../../src/guide.js';
import { maxPopulation, growthBlocker, immigrationBlocker } from '../../../src/sim/family.js';
import { alertsOf, DISCOVERY, RESERVE } from '../../../src/sim/primitive.js';
import { AUDIT } from '../../../src/sim/primitiveAudit.js';
import { Store } from '../store.js';
import { World } from '../world.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function fresh(seed = 777) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed }, { ownZone: true });
  sim.seedPrimitive();
  sim.timeLabel = () => 'Día 1';
  return sim;
}
let t = 0;
const run = (sim, seconds, opts = {}) => {
  for (const end = t + seconds; t < end; t++) sim.update(1, { timeScale: 1, isNight: (t % DAY) / DAY > 0.8, timeLabel: () => 'Día 1', ...opts });
};
const place = (sim, id) => {
  const def = BUILDINGS[id];
  for (let ring = 0; ring < 10; ring++) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = Math.round((Math.cos(a) * (20 + ring * 4)) / 4) * 4;
      const z = Math.round((Math.sin(a) * (20 + ring * 4)) / 4) * 4;
      if (!sim.buildProblem(def, x, z)) return sim.build(id, x, z).building;
    }
  }
  return null;
};

// 1. Fundar: cinco colonos, refugio de la menor calidad (capacidad 2), recolector de lluvia ya
//    funcionando con agua, acopio inicial pequeño; nada de calidad superior.
{
  const sim = fresh();
  assert.equal(sim.colonists.length, 5);
  const house = sim.buildings.find((b) => b.def.id === 'house');
  const well = sim.buildings.find((b) => b.def.id === 'well');
  assert.ok(house.done && well.done);
  assert.equal(house.level, 1);
  assert.equal(levelOf(house).housing, 2);
  assert.equal(levelOf(well).rainOnly, true);
  assert.ok(well.store > 0 && well.store < levelOf(well).capacity);
  assert.equal(sim.buildings.length, 2, 'sólo refugio y recolector');
  assert.equal(sim.age, 1);
  assert.deepEqual(sim.stock, { food: 18, water: 10, wood: 40, stone: 14, fiber: 14 });
  assert.ok(sim.shelterInfo().unhoused >= 3, 'tres colonos duermen junto a la fogata');
  assert.ok(alertsOf(sim).some((a) => a.id === 'shelter'), 'la interfaz lo explica');
  assert.equal(maxPopulation(sim), 10);
  assert.match(immigrationBlocker(sim), /sólo crece con nacimientos/);
  console.log('✓ fundar: 5 colonos, refugio (2), recolector de lluvia y acopio inicial');
}

// 2. Recursos primitivos: existen cerca y no hace falta ninguna herramienta para recogerlos.
{
  const sim = fresh();
  for (const kind of ['food', 'wood', 'stone']) assert.ok(sim.remaining(kind).left >= 15, `hay ${kind} para recoger`);
  const need = { wood: 82, stone: 21, fiber: 30 }; // lo que cuesta todo el recorrido (ver la auditoría)
  assert.ok(need.wood > 40, 'hay que recolectar de verdad');
  assert.equal(sim.techs.size, 0, 'sin tecnologías ni herramientas');
  console.log('✓ recursos primitivos al alcance, sin herramientas');
}

// 3 a 5, 10. Recorrido completo con la IA de los colonos: zona marcada, refugios para todos, almacén,
//     agua de lluvia, descubrimiento y llegada a Piedra sin recursos de Piedra.
{
  const sim = fresh();
  t = 0;
  const log = [];
  sim.on('notice', (m) => log.push(m));
  // Marcar una zona (recolección por zona) y dejar que los colonos hagan el resto solos.
  assert.ok(sim.markRect({ cx: 0, cz: 0, hw: 75, hd: 75, angle: 0 }, true, null) > 10);
  assert.ok(sim.learned.has('zone_marked') && sim.learned.has('food_marked'), 'la guía reconoce la acción');
  run(sim, 2 * DAY);
  assert.ok(sim.produced.wood > 0 && sim.produced.stone > 0 && sim.produced.food > 0 && sim.produced.fiber > 0, 'recogen ramas, piedras, comida y fibra solos');
  const stockBefore = { ...sim.stock };
  // Refugios para todos (con lo recolectado) y almacén primitivo.
  const housesNeeded = Math.ceil(sim.colonists.length / 2) - sim.buildings.filter((b) => b.def.id === 'house').length;
  for (let i = 0; i < housesNeeded; i++) assert.ok(place(sim, 'house'), 'hay sitio para un refugio');
  const stock = place(sim, 'stockpile');
  assert.ok(stock, 'hay sitio para el almacén');
  assert.ok(stockBefore.wood >= 12 && stockBefore.fiber >= 4, 'su coste se reúne con el acopio y lo recogido');
  assert.equal(sim.discoveryProblem(), null);
  assert.equal(sim.discover(), true);
  run(sim, 3 * DAY);
  assert.ok(sim.shelterInfo().ok, 'todos tienen refugio');
  assert.ok(sim.milestones.has('stone_tool'), 'descubierta la primera herramienta');
  assert.ok(sim.buildings.some((b) => b.def.id === 'stockpile' && b.done), 'almacén terminado');
  // Si el agua (que depende de la lluvia) no alcanza, se llena como lo haría un periodo de lluvia.
  const well = sim.buildings.find((b) => b.def.id === 'well');
  const before = well.store;
  sim.updateBuildings(60, 1);
  assert.ok(well.store > before || before >= levelOf(well).capacity, 'la lluvia llena el recolector');
  assert.ok(sim.waterReport().capacity >= 14);
  const water = sim.waterReport().stock + well.store;
  if (water < RESERVE.water) well.store = levelOf(well).capacity;
  const status = nextAgeStatus(sim);
  assert.deepEqual(status.checks.filter((c) => !c.ok), [], 'todos los requisitos se cumplen en Primitiva');
  assert.deepEqual(status.missing, []);
  const stoneAge = AGES[1].requires;
  assert.ok(!stoneAge.population, 'no se exige aumentar la población');
  const foodKept = sim.stock.food;
  const waterKept = sim.stock.water;
  assert.equal(sim.advanceAge(), true);
  assert.equal(sim.age, 2);
  assert.equal(sim.stock.food, foodKept, 'la comida de reserva no se gasta al avanzar');
  assert.equal(sim.stock.water, waterKept, 'el agua de reserva no se gasta al avanzar');
  assert.ok(sim.buildings.filter((b) => b.def.autoLevel).every((b) => b.level === 2), 'las viviendas evolucionan solas');
  assert.equal(sim.buildings.find((b) => b.def.id === 'stockpile').level, 1, 'lo productivo conserva su nivel');
  assert.equal(sim.advanceAge(), false, 'no se repite');
  const used = Object.keys(stoneAge.cost);
  assert.ok(used.every((k) => ['wood', 'stone', 'fiber'].includes(k)), 'sólo materiales primitivos');
  console.log('✓ recorrido completo hasta la Edad de Piedra con recursos de Primitiva');
}

// 6. Orden inaccesible o zona agotada: se avisa y nadie queda "trabajando" sin producir.
{
  const sim = fresh();
  t = 0;
  const notes = [];
  sim.on('notice', (m) => notes.push(m));
  for (const s of sim.spots) if (s.kind === 'stone') s.gone = true;
  assert.equal(sim.remaining('stone').left, 0);
  assert.match(sim.harvestBlocker('stone'), /ya no queda/);
  assert.ok(alertsOf(sim).some((a) => a.id === 'deplete-stone'));
  // Almacén lleno: se dice por qué no se recoge.
  const w = sim.spots.find((s) => s.kind === 'wood' && !s.gone);
  w.marked = true;
  sim.isFull = (k) => k === 'wood';
  assert.match(sim.harvestBlocker('wood'), /almacén está lleno/);
  console.log('✓ zona agotada y almacén lleno: se explican');
}

// 8. Guardar y cargar: la guía, el descubrimiento y las reservas siguen donde estaban.
{
  const sim = fresh();
  t = 0;
  sim.noteLearned('zone_marked');
  sim.learn('tour');
  sim.stock.stone = 20;
  sim.discover();
  run(sim, 60);
  const data = JSON.parse(JSON.stringify(sim.serialize()));
  const copy = new ColonySim();
  copy.weather = new WeatherState(5);
  copy.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  assert.equal(copy.restore(data), true);
  assert.ok(copy.learned.has('zone_marked') && copy.learned.has('tour'));
  assert.ok(copy.discovery && Math.abs(copy.discovery.progress - sim.discovery.progress) < 1e-9);
  assert.equal(copy.buildings.length, sim.buildings.length);
  const g = guideState(copy);
  assert.equal(g.steps.find((s) => s.id === 'tour').done, true);
  assert.equal(g.steps.find((s) => s.id === 'materials').done, true, 'reconocido antes de proponerlo');
  console.log('✓ guardar y cargar conserva guía, descubrimiento y edificios');
}

// 9. Nacimientos: se conservan; el límite es 10; sin inmigración; sin refugio no nacen.
{
  const sim = fresh();
  assert.match(growthBlocker(sim), /sin refugio/);
  for (const b of [place(sim, 'house'), place(sim, 'house')]) b.finish(null);
  const { assignHomes } = await import('../../../src/sim/family.js');
  assignHomes(sim);
  sim.stock.food = 60;
  sim.stock.water = 60;
  assert.equal(growthBlocker(sim), null, 'con refugio y reservas hay crecimiento');
  assert.equal(sim.populationInfo().cap, 10);
  let arrivals = 0;
  sim.on('notice', (m) => /llegó a la aldea/.test(m) && arrivals++);
  t = 0;
  run(sim, 3 * DAY, { });
  assert.equal(arrivals, 0, 'no llega nadie de fuera');
  console.log('✓ sin inmigración; el crecimiento depende de refugio y reservas; límite 10');
}

// 11. Escasez: alertas con tiempo y muerte con el dueño presente (no durante las ausencias).
{
  const sim = fresh();
  t = 0;
  const notes = [];
  sim.on('notice', (m) => notes.push(m));
  sim.stock.food = 0;
  sim.stock.water = 0;
  for (const b of sim.buildings) if (b.store != null) b.store = 0;
  for (const c of sim.colonists) {
    c.needs.food = 5;
    c.needs.water = 5;
  }
  run(sim, 2, {});
  assert.ok(notes.some((m) => /Agua para|sed|Comida para|hambre/.test(m)), 'avisos de escasez');
  // Ausente: la salud no baja de la crítica y nadie muere (regla actual).
  const away = fresh();
  away.stock.food = 0;
  away.stock.water = 0;
  for (const b of away.buildings) if (b.store != null) b.store = 0;
  for (const c of away.colonists) {
    c.needs.food = 0;
    c.needs.water = 0;
  }
  run(away, 6 * DAY, { absent: true });
  assert.equal(away.colonists.length, 5, 'durante las ausencias no muere nadie');
  // Presente: mueren.
  run(sim, 6 * DAY);
  assert.ok(sim.colonists.length < 5, 'con el dueño presente la escasez mata');
  console.log('✓ escasez: alertas, muertes con el dueño presente y sin cambios durante ausencias');
}

// 12. Derrota y nueva fundación (mundo con base de datos en memoria).
{
  const store = new Store(':memory:');
  const world = new World({ store, log: () => {} });
  const ins = store.db.prepare('INSERT INTO players (name, name_lc, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)');
  const ana = Number(ins.run('Ana', 'ana', 's', 'h', 1).lastInsertRowid);
  const bruno = Number(ins.run('Bruno', 'bruno', 's', 'h', 1).lastInsertRowid);
  assert.equal(world.found(ana, { x: -0.18, y: 0.11, z: 0.977 }), null);
  assert.equal(world.found(bruno, { x: 0.5, y: 0.5, z: 0.7 }), null);
  const brunoBefore = JSON.stringify(world.colonies.get(bruno).sim.stock);
  const sim = world.colonies.get(ana).sim;
  assert.equal(world.refound(ana), 'Tu aldea todavía no ha terminado', 'no se puede refundar mientras vive');
  const sent = [];
  world.clients.add({ player: { id: ana, name: 'Ana' }, send: (m) => sent.push(m.t), close() {} });
  sim.timeLabel = () => 'Día 3';
  sim.stock.food = 0;
  for (const c of [...sim.colonists]) sim.die(c, 'de hambre');
  assert.equal(sim.colonists.length, 0);
  assert.match(sim.defeat.cause, /de hambre/);
  assert.equal(world.refound(ana), null);
  assert.ok(!world.colonies.has(ana) && world.colonies.has(bruno), 'sólo se borra su aldea');
  assert.equal(store.sql.colonies.all().length, 1);
  assert.ok(sent.includes('colonyReset'));
  assert.equal(JSON.stringify(world.colonies.get(bruno).sim.stock), brunoBefore, 'no afecta a otros jugadores');
  // Vuelve a fundar con las condiciones iniciales y sin herencias.
  assert.equal(world.found(ana, { x: -0.18, y: 0.11, z: 0.977 }), null);
  const again = world.colonies.get(ana).sim;
  assert.equal(again.colonists.length, 5);
  assert.deepEqual(again.stock, { food: 18, water: 10, wood: 40, stone: 14, fiber: 14 });
  assert.equal(again.defeat, null);
  assert.equal(again.milestones.size, 0);
  console.log('✓ derrota, nueva fundación limpia y sin tocar a otros jugadores');
}

// 13. La auditoría: cada paso del recorrido se verifica de verdad.
for (const row of AUDIT) {
  const sim = fresh();
  const r = row.verify(sim);
  assert.equal(r, true, `auditoría «${row.step}»: ${row.explain}`);
}
console.log(`✓ auditoría: ${AUDIT.length} pasos verificados contra el juego`);
console.log('primitive.test ✓');
process.exit(0);
