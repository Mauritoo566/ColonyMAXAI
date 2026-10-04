// Recargar la página o reiniciar el servidor no cambia nada: los colonos siguen con los mismos nombres y en los mismos puestos (también los
// nacidos en la aldea), y quien se conecta de nuevo recibe sus nacidos y caminos aunque otra pestaña ya los hubiera recibido.
// Uso: node server/game/test/reload.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../world.js';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
const camp = { dir: { x: dir.x, y: dir.y, z: dir.z }, height: naturalSurfaceHeight(dir), yaw: 0.7, seed: 987654321 };
const store = { meta: () => null, setMeta() {}, sql: { allPlayers: { all: () => [{ id: 1, name: 'Ana' }] }, colonies: { all: () => [] } } };

function freshSim() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(camp.seed);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: camp.height, yaw: camp.yaw, seed: camp.seed }, { ownZone: true });
  return sim;
}

// Una aldea con un colono nacido en ella (Pepe) que trabaja a mano, y una fundadora con un puesto que eligió la colonia.
function village() {
  const world = new World({ store, log: () => {} });
  const colony = world.createColony(1, camp);
  const sim = colony.sim;
  sim.setAge(2);
  sim.stock = { food: 90, water: 90, wood: 99, stone: 20, fiber: 99 };
  const base = sim.colonists[0];
  const pepe = sim.makeColonist({ ...sim.staticOf(base), id: 7, name: 'Pepe', born: { day: 3 } }, { needs: { ...base.needs }, growth: 1, x: 5, z: 5 });
  sim.colonists.push(pepe);
  sim.staticsRevision++;
  const cutter = sim.createBuilding(BUILDINGS.woodcutter, 24, 12, 0, 1, 0, 1);
  cutter.done = true;
  cutter.progress = 1;
  const gatherer = sim.createBuilding(BUILDINGS.gatherer, -24, 12, 0, 1, 0, 1);
  gatherer.done = true;
  gatherer.progress = 1;
  sim.setWorker(cutter, pepe); // elegido por el jugador
  const ana = sim.colonists.find((c) => c.id === 2);
  sim.setWorker(gatherer, ana, 'La colonia lo eligió.', true);
  for (let t = 0; t < 20; t += 0.5) sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'd' });
  return { world, colony, sim, pepe, ana, cutter, gatherer };
}
const names = (sim) => sim.colonists.map((c) => `${c.id}:${c.name}`).sort();
const jobs = (sim) => sim.colonists.map((c) => `${c.id}:${c.job?.def.id ?? '-'}:${c.job ? (c.jobAuto ? 'auto' : 'manual') : ''}`).sort();

// 1) Guardar y cargar (reiniciar el servidor): mismos nombres y mismos puestos, también el del nacido y quién los eligió.
{
  const { sim, pepe } = village();
  assert.equal(pepe.job.def.id, 'woodcutter');
  const save = JSON.parse(JSON.stringify(sim.serialize()));
  const back = freshSim();
  back.setAge(1);
  assert.equal(back.restore(save), true);
  assert.deepEqual(names(back), names(sim), 'los nombres son los mismos');
  assert.deepEqual(jobs(back), jobs(sim), 'cada puesto sigue con el mismo colono (nacidos incluidos) y con quien lo eligió');
  assert.equal(back.colonist(7).job.def.id, 'woodcutter', 'el nacido sigue de leñador');
  assert.equal(back.colonist(7).jobAuto, false, 'y sigue siendo un puesto elegido por el jugador');
  assert.equal(back.colonist(2).jobAuto, true);
  // Y lo vuelve a guardar igual (nada se mueve de un guardado a otro).
  const again = freshSim();
  again.restore(JSON.parse(JSON.stringify(back.serialize())));
  assert.deepEqual(jobs(again), jobs(sim));
}

// 2) Recargar la página: cada conexión nueva recibe los nacidos aunque otra ya los hubiera recibido.
{
  const { world, colony, sim } = village();
  const inbox = () => ({ list: [], on: null });
  const connect = (id = 1) => {
    const box = inbox();
    const client = { player: { id }, otherStatics: new Map(), view: null, send() {}, sendRaw: (t) => box.list.push(JSON.parse(t)) };
    world.clients.add(client);
    return { client, box };
  };
  const first = connect();
  world.ticks = 0;
  world.broadcast();
  const fullOf = (box) => box.list.filter((m) => m.t === 'colony').at(-1);
  assert.ok(fullOf(first.box).born?.some((b) => b.name === 'Pepe'), 'la primera pestaña recibe a Pepe');
  // Pasa un segundo sin novedades: no se repite lo fijo (ahorra red).
  first.box.list.length = 0;
  world.ticks = 10;
  world.broadcast();
  assert.equal(fullOf(first.box).born, undefined, 'sin cambios no se manda otra vez');
  // El jugador recarga la página: conexión nueva, y la colonia no ha cambiado.
  const reloaded = connect();
  world.ticks = 20;
  world.broadcast();
  const full = fullOf(reloaded.box);
  assert.ok(full.born?.some((b) => b.name === 'Pepe'), 'tras recargar recibe a Pepe otra vez');
  assert.ok(full.roads !== undefined, 'y los caminos');
  // El navegador nuevo ve lo mismo que el servidor: mismos nombres y mismos puestos.
  const mirror = freshSim();
  mirror.remote = () => {};
  mirror.applySnapshot(JSON.parse(JSON.stringify(full)), 'full');
  assert.deepEqual(names(mirror), names(sim), 'el navegador recargado muestra los mismos nombres');
  assert.deepEqual(jobs(mirror).map((j) => j.split(':').slice(0, 2).join(':')), jobs(sim).map((j) => j.split(':').slice(0, 2).join(':')), 'y los mismos puestos');
  assert.equal(mirror.colonist(7)?.job?.def.id, 'woodcutter', 'el puesto del nacido no se pierde al recargar');
  assert.ok(colony.sim === sim);
}

console.log('reload.test.js: ok');
