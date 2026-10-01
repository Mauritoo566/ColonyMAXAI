// Economía: cadenas de producción, energía, comercio, investigación y caminos (sin red).
// Uso: node server/game/test/economy.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { DAY_LENGTH_SECONDS as DAY } from '../../../src/daynight.js';
import { updateProduction, roadSpeed } from '../../../src/sim/economy.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(age, stock = {}) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 777 }, { ownZone: true });
  sim.age = age;
  sim.clothesLeft = 0;
  sim.colonists.forEach((c) => (c.clothed = true));
  const SPECS = [['smelting', 'engineering', 'crafting'], ['trading', 'service', 'research'], ['smelting', 'engineering', 'crafting'], ['trading', 'service', 'research'], ['mining', 'farming', 'service']];
  sim.colonists.forEach((c, i) => (c.spec = SPECS[i % 5])); // los oficios de cada prueba
  sim.stock = { food: 900, water: 900, wood: 900, stone: 600, fiber: 300, ...stock };
  return sim;
}
const run = (sim, days, keep = {}) => {
  let t = 0;
  while (t < days * DAY) {
    for (const k of ['food', 'water']) sim.stock[k] = Math.max(sim.stock[k], 900);
    for (const [k, v] of Object.entries(keep)) sim.stock[k] = Math.max(sim.stock[k] ?? 0, v);
    sim.update(0.5, { timeScale: 1, isNight: (t % DAY) / DAY > 0.8, timeLabel: () => `Día ${Math.floor(t / DAY) + 1}` });
    t += 0.5;
  }
};
const spots = [[22, 10], [22, -8], [-24, 12], [-22, -14], [10, 28], [-10, 28]];

// Cadena del bronce: minas (sobre yacimientos) -> fundición -> taller de herramientas.
{
  const sim = colony(4, { clay: 100 });
  const cu = sim.deposits.find((d) => d.kind === 'copper');
  const tin = sim.deposits.find((d) => d.kind === 'tin');
  assert.match(sim.buildProblem(BUILDINGS.copper_mine, 5, 40), /yacimiento de cobre/);
  // Con tres especialidades por colono, el jugador elige quién cubre cada oficio de la cadena.
  sim.colonists.forEach((c) => (c.spec = ['mining', 'smelting', 'crafting']));
  sim.createBuilding(BUILDINGS.copper_mine, cu.x, cu.z, 0, 1, 0);
  sim.createBuilding(BUILDINGS.tin_mine, tin.x, tin.z, 0, 1, 0);
  sim.createBuilding(BUILDINGS.smelter, ...spots[0], 0, 1, 0);
  const shop = sim.createBuilding(BUILDINGS.tool_workshop, ...spots[1], 0, 1, 0);
  sim.stock.stone = 600;
  run(sim, 5);
  assert.ok((sim.produced.bronze ?? 0) > 0 && (sim.produced.bronze_tools ?? 0) > 0, 'mina -> bronce -> herramientas');
  assert.ok(shop.workers.length === 1);
  console.log('✓ cadena del bronce:', JSON.stringify({ cobre: sim.produced.copper, bronce: sim.produced.bronze, herramientas: sim.produced.bronze_tools }));
}

// Un taller sin materiales o sin trabajador explica por qué no produce.
{
  const sim = colony(3, { clay: 50 });
  const sm = sim.createBuilding(BUILDINGS.smelter, ...spots[0], 0, 1, 0);
  for (const w of [...sm.workers]) sim.releaseWorker(sm, w);
  sm.done = true;
  updateProduction(sim, sm, 0.1);
  assert.match(sm.status, /Sin trabajadores/);
  sim.setWorker(sm, sim.colonists[0]);
  run(sim, 0.3);
  assert.match(sm.status ?? '', /Faltan materiales|Esperando|Sin energía|^$/);
  console.log('✓ el taller explica por qué se detiene:', sm.status);
}

// Energía: la acería sólo funciona conectada a una caldera que quema carbón.
{
  const sim = colony(8, { iron: 200, coal: 200 });
  const boiler = sim.createBuilding(BUILDINGS.boiler, ...spots[0], 0, 1, 0);
  const mill = sim.createBuilding(BUILDINGS.steel_mill, 22, -6, 0, 1, 0);
  const far = sim.createBuilding(BUILDINGS.steel_mill, -30, 30, 0, 1, 0);
  run(sim, 3, { iron: 200, coal: 200 });
  assert.ok((sim.produced.steel ?? 0) > 0, 'acero con energía de vapor');
  assert.ok(far.pf === 0 && /Sin energía/.test(far.powerNote ?? ''), 'lejos de la caldera no hay energía');
  assert.ok(boiler.burning !== undefined);
  console.log('✓ energía: la acería conectada produce y la desconectada lo explica');
}

// Comercio: vender excedentes, límite diario y nada de comprar lo de edades posteriores.
{
  const sim = colony(5, { wood: 400, coin: 0, stone: 600 });
  const market = sim.createBuilding(BUILDINGS.market, ...spots[0], 0, 1, 0);
  run(sim, 0.6);
  assert.equal(market.workers.length, 1);
  assert.ok(market.operating, 'el mercado funciona con comerciante');
  assert.match(sim.tradeProblem('steel', 2, 'buy') ?? '', /Todavía no existe/);
  const before = sim.stock.coin;
  assert.equal(sim.trade('wood', 10, 'sell'), true);
  assert.ok(sim.stock.coin > before);
  assert.ok((sim.produced.coin ?? 0) > 0, 'vender cuenta como producir monedas');
  while (sim.trade('wood', 10, 'sell'));
  assert.match(sim.tradeProblem('wood', 10, 'sell'), /Cupo diario|No cabe más dinero/);
  sim.stock.stone = 5;
  const coinsBefore = sim.stock.coin;
  assert.equal(sim.trade('stone', 5, 'buy'), true);
  assert.ok(sim.stock.coin < coinsBefore, 'comprar cuesta monedas');
  sim.tradeUsed = 1e6;
  assert.match(sim.tradeProblem('stone', 5, 'buy'), /Cupo diario/);
  console.log('✓ comercio: se vende, hay cupo diario y no se compra lo del futuro');
}

// Investigación: la academia produce conocimiento y se gasta una vez.
{
  const sim = colony(7, { planks: 200, cloth: 200 });
  sim.createBuilding(BUILDINGS.admin, 22, -14, 0, 1, 0);
  const ac = sim.createBuilding(BUILDINGS.academy, ...spots[0], 0, 1, 0);
  run(sim, 3, { planks: 200, cloth: 200 });
  assert.ok((sim.stock.knowledge ?? 0) > 0, 'conocimiento');
  const k = sim.stock.knowledge;
  sim.stock.knowledge = 100;
  ac.operating = true;
  assert.match(sim.researchProblem('steam'), /Antes hay que investigar/);
  assert.equal(sim.research('industry'), true);
  assert.equal(sim.stock.knowledge, 50);
  assert.equal(sim.research('industry'), false, 'no se cobra dos veces');
  assert.ok(sim.techs.has('industry') && ac.operating !== undefined && k > 0);
  console.log('✓ investigación: conocimiento -> tecnología, se paga una vez');
}

// Caminos: se pintan con el nivel de la edad, cuestan por casilla y aceleran.
{
  const sim = colony(3, { fiber: 100 });
  assert.equal(sim.paintRoads([[8, 8], [9, 8], [10, 8]]), true);
  assert.equal(sim.roads.size, 3);
  assert.equal(sim.stock.fiber, 97);
  const c = sim.colonists[0];
  c.x = 8 * 4; c.z = 8 * 4;
  assert.ok(roadSpeed(sim, c.x, c.z) > 1);
  assert.equal(roadSpeed(sim, 0, 0), 1);
  const stone = colony(2, { fiber: 100 });
  assert.equal(stone.paintRoads([[8, 8]]), true, 'el camino de tierra llega con la Edad de Piedra');
  const young = colony(1, { fiber: 100 });
  assert.equal(young.paintRoads([[8, 8]]), false, 'no hay caminos en la primera edad');
  console.log('✓ caminos: por edad, con coste y con velocidad');
}
console.log('Todo bien.');
process.exit(0);
