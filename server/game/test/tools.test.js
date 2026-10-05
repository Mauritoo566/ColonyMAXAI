// Herramientas de los colonos: desde la Edad del Bronce, sin herramienta se trabaja más lento; con una de bronce o de hierro (cada una de su edad) se
// trabaja más rápido; los colonos la recogen solos del almacén según su oficio, se desgasta con el trabajo y se rompe; se guarda y llega al navegador.
// Uso: node server/game/test/tools.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { TOOL_GOODS, BARE_TIME, toolTime, wearTool, toolWanted, toolTrade, bestInStock, equipTool, toolsMatter } from '../../../src/sim/tools.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(n = 6, age = 3) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(age);
  sim.stock = { food: 90, water: 90, wood: 99, stone: 20, fiber: 99 };
  sim.clothesLeft = 0;
  const base = sim.colonists[0];
  while (sim.colonists.length < n) {
    const id = 50 + sim.colonists.length;
    sim.colonists.push(sim.makeColonist({ ...sim.staticOf(base), id, name: `Extra${id}` }, { needs: { ...base.needs }, growth: 1, x: 6 + sim.colonists.length, z: 4 }));
  }
  for (const c of sim.colonists) {
    c.clothed = true;
    c.traits = [];
    c.task = null;
    c.spec = ['woodcutting', 'mining', 'gathering'];
  }
  sim.mobs = [];
  return sim;
}
const tick = (sim, seconds) => {
  for (let t = 0; t < seconds; t += 0.5) {
    for (const c of sim.colonists) c.needs.food = c.needs.water = c.needs.rest = c.needs.warmth = 100;
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
  }
};

// 1) Los tiempos dependen de la edad y de la herramienta.
{
  const early = colony(3, 2);
  const c = early.colonists[0];
  assert.equal(toolsMatter(early), false);
  assert.equal(toolTime(early, c, 'woodcutting'), 1, 'antes del Bronce no hay penalización');
  early.stock.bronze_tools = 5;
  assert.equal(bestInStock(early), null, 'las herramientas de bronce no se usan antes de su edad');
  assert.equal(toolWanted(early, c), null);

  const sim = colony(3, 3);
  const w = sim.colonists[0];
  assert.equal(toolTime(sim, w, 'woodcutting'), BARE_TIME, 'en el Bronce, a mano es más lento');
  assert.equal(toolTime(sim, w, 'crafting'), 1, 'un oficio sin herramienta no cambia');
  w.tool = { id: 'bronze_tools', left: 100 };
  assert.equal(toolTime(sim, w, 'mining'), TOOL_GOODS.bronze_tools.time);
  w.tool = { id: 'iron_tools', left: 100 };
  assert.ok(toolTime(sim, w, 'mining') < TOOL_GOODS.bronze_tools.time, 'el hierro va mejor que el bronce');
  assert.ok(toolTime(sim, w, 'mining') < 1);
  sim.stock.iron_tools = 3;
  assert.equal(bestInStock(sim), null, 'el hierro es de la Edad IV: en la III no cuenta');
  sim.setAge(4);
  assert.equal(bestInStock(sim), 'iron_tools');
}

// 2) Los colonos recogen solos una herramienta del almacén (según su oficio) y se descuenta del stock.
{
  const sim = colony(6, 3);
  sim.stock.bronze_tools = 3;
  sim.colonists[5].spec = ['crafting', 'smelting', 'research']; // su oficio no usa herramienta
  assert.equal(toolTrade(sim, sim.colonists[5]), null);
  tick(sim, 240);
  const equipped = sim.colonists.filter((c) => c.tool);
  assert.equal(equipped.length, 3, 'se equiparon con las tres que había');
  assert.equal(sim.stock.bronze_tools ?? 0, 0, 'salieron del almacén');
  assert.ok(!sim.colonists[5].tool, 'quien no usa herramienta no la recoge');
  assert.equal(equipped[0].tool.id, 'bronze_tools');
  assert.ok(equipped[0].tool.left <= TOOL_GOODS.bronze_tools.life);
}

// 3) Mejor herramienta: se cambia la de bronce por la de hierro sólo si sobran (quedan al menos dos); sin existencias no se hace nada.
{
  const sim = colony(2, 4);
  const c = sim.colonists[0];
  equipTool(sim, c, 'bronze_tools') || (c.tool = { id: 'bronze_tools', left: 900 });
  sim.stock.iron_tools = 1;
  assert.equal(toolWanted(sim, c), null, 'con una sola de hierro no cambia (se queda para mejoras)');
  sim.stock.iron_tools = 2;
  assert.equal(toolWanted(sim, c), 'iron_tools');
  assert.equal(equipTool(sim, c, 'iron_tools'), true);
  assert.equal(c.tool.id, 'iron_tools');
  assert.equal(sim.stock.iron_tools, 1);
  assert.equal(equipTool(sim, c, 'instruments'), false, 'sin existencias no se equipa');
}

// 4) El trabajo desgasta la herramienta y al llegar a cero se rompe (con aviso); los oficios sin herramienta no la gastan.
{
  const sim = colony(2, 3);
  const c = sim.colonists[0];
  const notices = [];
  sim.on('notice', (t) => notices.push(t));
  c.tool = { id: 'bronze_tools', left: 10 };
  wearTool(sim, c, 'crafting', 5);
  assert.equal(c.tool.left, 10, 'un oficio sin herramienta no gasta la suya');
  wearTool(sim, c, 'woodcutting', 4);
  assert.equal(c.tool.left, 6);
  wearTool(sim, c, 'woodcutting', 7);
  assert.equal(c.tool, null, 'se rompió');
  assert.ok(notices.some((t) => t.includes('se le rompió')), `hay aviso: ${notices}`);
  assert.equal(sim.toolsBroken, 1);
}

// 5) El desgaste ocurre trabajando de verdad (practice).
{
  const tooled = colony(2, 3);
  tooled.colonists[0].tool = { id: 'iron_tools', left: 3000 };
  const before = tooled.colonists[0].tool.left;
  tooled.practice(tooled.colonists[0], { type: 'build', building: {} }, 3);
  assert.equal(tooled.colonists[0].tool.left, before - 3, 'practice gasta la herramienta');
}

// 6) Se guarda y se recupera; también llega al navegador.
{
  const sim = colony(3, 4);
  sim.colonists[0].tool = { id: 'iron_tools', left: 1234 };
  const data = JSON.parse(JSON.stringify(sim.serialize()));
  const sim2 = colony(3, 4);
  sim2.restoreColony(data.colony);
  assert.deepEqual(sim2.colonists[0].tool, { id: 'iron_tools', left: 1234 });
  assert.equal(sim2.colonists[1].tool ?? null, null);
  // Un dato inválido se descarta.
  data.colony.colonists[0].tool = { id: 'varita', left: 5 };
  const sim3 = colony(3, 4);
  sim3.restoreColony(data.colony);
  assert.equal(sim3.colonists[0].tool, null);

  const full = JSON.parse(JSON.stringify(sim.snapshot('full')));
  const mirror = colony(3, 4);
  mirror.applySnapshot(full);
  assert.deepEqual(mirror.colonists[0].tool, { id: 'iron_tools', left: 1234 }, 'el navegador ve la herramienta');
  assert.equal(mirror.colonists[1].tool, null);
}

// 7) Inventario: lo que lleva encima (recolectado, camino al almacén) se ve en el servidor y llega al navegador.
{
  const sim = colony(2, 3);
  const c = sim.colonists[0];
  assert.equal(sim.carryOf(c), null, 'sin tarea no lleva nada');
  c.task = { type: 'harvest', phase: 'returning', load: { wood: 4, fiber: 1 } };
  assert.deepEqual(sim.carryOf(c), { wood: 4, fiber: 1 });
  c.task = { type: 'harvest', phase: 'going', load: { wood: 4 } };
  assert.equal(sim.carryOf(c), null, 'antes de recogerlo todavía no lo lleva');
  c.task = { type: 'harvest', phase: 'returning', load: { wood: 4, fiber: 1 } };
  const full = JSON.parse(JSON.stringify(sim.snapshot('full')));
  const mirror = colony(2, 3);
  mirror.applySnapshot(full);
  assert.deepEqual(mirror.colonists[0].carry, { wood: 4, fiber: 1 }, 'el navegador ve lo que lleva');
  assert.equal(mirror.colonists[1].carry, null);
}

console.log('tools.test.js: ok');
