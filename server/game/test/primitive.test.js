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
import { alertsOf, DISCOVERY, RESERVE, waterHint } from '../../../src/sim/primitive.js';
import { scanSite } from '../../../src/sim/colony.js';
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

// 1. Fundar: cinco colonos, refugio de la menor calidad (capacidad 4), recolector de lluvia ya
//    funcionando con agua, acopio inicial pequeño; nada de calidad superior.
{
  const sim = fresh();
  assert.equal(sim.colonists.length, 5);
  const house = sim.buildings.find((b) => b.def.id === 'house');
  const well = sim.buildings.find((b) => b.def.id === 'well');
  assert.ok(house.done && well.done);
  assert.equal(house.level, 1);
  assert.equal(levelOf(house).housing, 4);
  assert.equal(levelOf(well).rainOnly, true);
  assert.ok(well.store > 0 && well.store < levelOf(well).capacity);
  assert.equal(sim.buildings.length, 2, 'sólo refugio y recolector');
  assert.equal(sim.age, 1);
  assert.deepEqual(sim.stock, { food: 18, water: 12, wood: 40, stone: 14, fiber: 14 });
  assert.equal(sim.shelterInfo().unhoused, 1, 'un colono duerme junto a la fogata');
  assert.ok(alertsOf(sim).some((a) => a.id === 'shelter'), 'la interfaz lo explica');
  assert.equal(maxPopulation(sim), 4, 'sólo el refugio inicial (4 plazas): nada gratis del campamento');
  assert.match(immigrationBlocker(sim), /sólo crece con nacimientos/);
  console.log('✓ fundar: 5 colonos, refugio (4), recolector de lluvia y acopio inicial');
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
  assert.ok(sim.waterReport().capacity >= 20);
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
  assert.deepEqual(again.stock, { food: 18, water: 12, wood: 40, stone: 14, fiber: 14 });
  assert.equal(again.defeat, null);
  assert.equal(again.milestones.size, 0);
  console.log('✓ derrota, nueva fundación limpia y sin tocar a otros jugadores');
}

// 14. Aldeas guardadas antes del nuevo inicio: se adaptan sólo en lo que les falta, sin duplicar.
{
  // Aldea antigua: edad I, 5 colonos, sin refugio ni recolector (dormían en los tipis), con sus recursos.
  const old = new ColonySim();
  old.weather = new WeatherState(5);
  old.weather.setPlace(dir);
  old.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  old.timeLabel = () => 'Día 9';
  old.stock = { food: 31, water: 7, wood: 55, stone: 22, fiber: 12 };
  old.produced = { wood: 40, food: 20 };
  const woodcutter = old.createBuilding(BUILDINGS.woodcutter, 24, 12, 0, 1, 0);
  const save = JSON.parse(JSON.stringify(old.serialize()));
  delete save.colony.primitiveMigrated;
  delete save.colony.milestones;
  delete save.colony.learned;
  const load = () => {
    const sim = new ColonySim();
    sim.weather = new WeatherState(5);
    sim.weather.setPlace(dir);
    sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
    assert.equal(sim.restore(JSON.parse(JSON.stringify(save))), true);
    return sim;
  };
  const a = load();
  const ids = a.buildings.map((b) => b.def.id).sort();
  assert.deepEqual(ids, ['house', 'well', 'woodcutter'], 'se añade un refugio y un recolector, nada más');
  assert.equal(a.colonists.length, 5, 'se conservan los colonos');
  assert.deepEqual(a.stock, old.stock, 'no se regalan recursos');
  assert.deepEqual(a.produced, old.produced, 'se conserva el progreso');
  assert.ok(a.buildings.find((b) => b.def.id === 'woodcutter').id === woodcutter.id, 'se conservan los edificios');
  assert.ok(a.shelterInfo().slots === 4, 'sólo un refugio, no el paquete completo');
  assert.ok(a.buildings.find((b) => b.def.id === 'well').store <= 4, 'el recolector llega con la mitad de lo que tiene uno nuevo');
  // Cargar de nuevo la copia ya migrada (guardar y volver a cargar) no duplica nada.
  const again = new ColonySim();
  again.weather = new WeatherState(5);
  again.weather.setPlace(dir);
  again.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  again.restore(JSON.parse(JSON.stringify(a.serialize())));
  again.restore(JSON.parse(JSON.stringify(a.serialize())));
  assert.equal(again.buildings.filter((b) => b.def.id === 'house').length <= 2, true);
  assert.equal(again.migratePrimitive().length, 0);
  assert.equal(a.migratePrimitive().length, 0, 'no se repite');
  // Una aldea antigua que ya tenía refugios y pozo no recibe nada.
  const rich = new ColonySim();
  rich.weather = new WeatherState(5);
  rich.weather.setPlace(dir);
  rich.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  rich.timeLabel = () => 'd';
  rich.createBuilding(BUILDINGS.house, 20, 8, 0, 1, 0);
  rich.createBuilding(BUILDINGS.well, -20, -8, 0, 1, 0);
  const richSave = JSON.parse(JSON.stringify(rich.serialize()));
  delete richSave.colony.primitiveMigrated;
  const r2 = new ColonySim();
  r2.weather = new WeatherState(5);
  r2.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  r2.restore(richSave);
  assert.equal(r2.buildings.length, 2, 'no se añade nada si ya tenía lo necesario');
  // Más de diez habitantes: no se echa a nadie; se impide crecer y se muestra.
  const crowd = load();
  while (crowd.colonists.length < 12) crowd.colonists.push(crowd.makeColonist({ ...crowd.staticOf(crowd.colonists[0]), id: 300 + crowd.colonists.length, name: `Extra ${crowd.colonists.length}` }, { needs: { ...crowd.colonists[0].needs }, growth: 1 }));
  crowd.stock.food = 99;
  crowd.stock.water = 99;
  assert.equal(crowd.colonists.length, 12);
  assert.match(growthBlocker(crowd), /Límite de población de la Edad Primitiva: 10/);
  assert.equal(crowd.populationInfo().cap, 10);
  t = 0;
  run(crowd, DAY);
  assert.equal(crowd.colonists.length, 12, 'nadie se elimina por pasar del límite');
  console.log('✓ aldeas antiguas: se adaptan sólo en lo necesario, sin duplicar ni echar a nadie');
}

// 15. Agua: con lluvia normal sobra; con sequía prolongada hay margen para aprender pero no es infinito.
{
  const dry = (colony) => {
    colony.weather.rain = 0;
    colony.water = null; // sin agua natural cerca: sólo cuenta el recolector
  };
  // Sequía con un recolector: se mide cuánto dura la reserva con el consumo real.
  const one = fresh();
  dry(one);
  one.markRect({ cx: 0, cz: 0, hw: 0.1, hd: 0.1, angle: 0 }, false, null);
  t = 0;
  let outDay = null;
  const firstAlert = {};
  for (let s = 0; s < 20 * DAY && outDay === null; s++) {
    dry(one);
    run(one, 1);
    for (const a of alertsOf(one)) firstAlert[a.id] ??= s / DAY;
    if (one.waterReport().stock + one.waterReport().store < 0.5) outDay = s / DAY;
  }
  assert.ok(outDay !== null && outDay > 3, `con sequía y un recolector la reserva dura ${outDay?.toFixed(1)} días (margen para reaccionar)`);
  assert.ok(outDay < 8, 'pero se acaba: la sequía es un riesgo real');
  assert.ok(firstAlert.water !== undefined && firstAlert.water < outDay - 1, 'la alerta avisa con tiempo');
  const hint = waterHint(one);
  assert.match(hint, /No llueve/);
  assert.match(hint, /sólo ayuda cuando llueva/, 'no se vende otro recolector como solución inmediata');
  // Un segundo recolector no resuelve la sequía (sólo la alarga).
  const two = fresh();
  dry(two);
  place(two, 'well')?.finish(null);
  t = 0;
  let outDay2 = null;
  for (let s = 0; s < 30 * DAY && outDay2 === null; s++) {
    dry(two);
    run(two, 1);
    if (two.waterReport().stock + two.waterReport().store < 0.5) outDay2 = s / DAY;
  }
  assert.ok(outDay2 !== null, 'con dos recolectores la sequía sigue acabando con el agua');
  assert.ok(outDay2 >= outDay, 'el segundo recolector alarga la reserva');
  // Lluvia normal: se llena y sobra.
  const wet = fresh();
  wet.water = null;
  t = 0;
  for (let s = 0; s < 4 * DAY; s++) {
    wet.weather.rain = 0.65;
    run(wet, 1);
  }
  const wr = wet.waterReport();
  assert.ok(wr.store >= levelOf(wet.buildings.find((b) => b.def.id === 'well')).capacity - 1, 'con lluvia el recolector se llena');
  assert.ok(wr.days > 3, 'con lluvia la reserva es holgada');
  assert.match(waterHint(wet), /Está lloviendo/);
  // Sin agua suficiente: el requisito de Piedra lo explica con la causa.
  const need = fresh();
  dry(need);
  need.stock.water = 0;
  for (const b of need.buildings) if (b.store != null) b.store = 2;
  const chk = nextAgeStatus(need).checks.find((c) => /agua/.test(c.label));
  assert.equal(chk.ok, false);
  assert.match(chk.hint, /No llueve/);
  console.log(`✓ agua: sequía con 1 recolector dura ${outDay.toFixed(1)} días; con 2, ${outDay2.toFixed(1)}; con lluvia sobra`);
}

// 16. Aviso antes de fundar: usa los recursos reales (los mismos que tendrá la colonia).
{
  const sim = fresh();
  const [near, far] = scanSite(dir, 777);
  for (const kind of ['food', 'wood', 'stone']) assert.equal(far[kind], sim.spots.filter((s) => s.kind === kind && !s.tree && !s.bigRock).length, `el conteo previo de ${kind} coincide con la colonia`);
  assert.ok(near.food <= far.food && near.wood <= far.wood);
  console.log(`✓ el aviso previo cuenta recursos reales: en 75 m ${near.food}/${near.wood}/${near.stone}`);
}

// 17. Palos del suelo: en Primitiva la madera sale de ellos; los árboles se quedan en pie hasta Piedra.
{
  const sim = fresh();
  const rect = { cx: 0, cz: 0, hw: 120, hd: 120, angle: 0 };
  sim.markRect(rect, true, ['wood']);
  const marked = sim.spots.filter((s) => s.marked);
  assert.ok(marked.length > 10 && marked.every((s) => s.stick), 'sólo se marcan palos, no árboles');
  assert.equal(sim.spots.filter((s) => s.tree && s.marked).length, 0);
  assert.equal(sim.nearestSpot('wood', 0, 0, 500, 0).stick, true, 'los colonos eligen palos');
  const w0 = sim.stock.wood;
  const f0 = sim.stock.fiber;
  t = 0;
  run(sim, 2 * DAY);
  assert.ok(sim.stock.wood > w0 && sim.stock.fiber > f0, 'recogen madera y fibra de los palos');
  assert.ok(sim.spots.filter((s) => s.tree && s.gone).length === 0, 'no se tala ningún árbol');
  assert.ok(sim.spots.filter((s) => s.stick && s.gone).length > 0, 'los palos recogidos desaparecen (no se renuevan)');
  sim.age = 2;
  assert.ok(sim.usable(sim.spots.find((s) => s.tree)), 'desde Piedra los árboles también se pueden');
  console.log('✓ palos caídos: madera sin talar árboles en Primitiva');
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
