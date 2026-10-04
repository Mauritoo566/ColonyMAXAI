// Antorchas (categoría Decoración): un adorno pequeño que no ocupa una casilla de 4 m, se pone una a una pegado a caminos y casas, no
// tapa entradas, no crea zonas de terreno ni caminos, y su llama titila y de noche tiene luz (pocas luces, las más cercanas).
// Uso: node server/game/test/torch.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS, BUILD_CATEGORIES } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { terrainZones } from '../../../src/elevation.js';
import { defImplemented, minAgeOf, capOf } from '../../../src/sim/progression.js';
import { footprintRect, halfFor, entranceOf } from '../../../src/sim/access.js';
import { addTorchFlame, updateTorches, initTorchLights, torchCount, torchLights } from '../../../src/torchFlames.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.stock = { food: 90, water: 90, wood: 99, stone: 20, fiber: 99 };
  return sim;
}

// 0) Está en una categoría propia y se puede construir desde la primera edad.
const torch = BUILDINGS.torch;
assert.ok(BUILD_CATEGORIES.some((c) => c.id === 'decoration' && c.name === 'Decoración'));
assert.equal(torch.category, 'decoration');
assert.ok(defImplemented(torch));
assert.equal(minAgeOf(torch), 1);
assert.ok(capOf(torch, 1) >= 10, 'se pueden poner muchas');
assert.equal(entranceOf(torch, 0, 0, 0), null, 'no tiene puerta');

// 1) No ocupa una casilla de 4 m: ocupa lo suyo.
{
  const r = footprintRect(torch, 10, 10);
  assert.ok(r.x1 - r.x0 < 1.5, `mide ${(r.x1 - r.x0).toFixed(1)} m, no 4`);
  assert.ok(halfFor(torch) < 1);
  assert.equal(halfFor(BUILDINGS.house), 2, 'una casa sigue ocupando su casilla');
}

// 2) Se pueden poner pegadas a una casa y a un camino, a un par de pasos una de otra; no sobre otra ni tapando una puerta.
{
  const sim = colony();
  sim.setAge(2);
  const house = sim.createBuilding(BUILDINGS.house, 24, 12, 0, 1, 0, 1);
  house.done = true;
  house.progress = 1;
  const zonesBefore = terrainZones().length;
  // Pegada al costado de la casa (la casa ocupa 4 m de lado: de x 22 a 26): a 0,5 m del borde.
  assert.equal(sim.buildProblem(torch, 26.9, 12.0, 0), null, 'se puede poner pegada al costado de una casa');
  // Encima de la casa no.
  assert.match(sim.buildProblem(torch, 24, 12, 0) ?? '', /Choca/);
  // Delante de la puerta (su franja de acceso) no: bloquearía la entrada.
  const door = house.entrance.approach;
  assert.ok(sim.buildProblem(torch, door.x, door.z, 0), 'no tapa la entrada de una casa');
  // Una al lado de otra: a 2 m sí, a 1 m no.
  const a = sim.build('torch', 30, 20, 0).building;
  assert.ok(a, 'se construye');
  assert.equal(terrainZones().length, zonesBefore, 'no crea zonas de terreno (no despeja el monte ni pinta tierra)');
  assert.equal(sim.buildProblem(torch, 32, 20, 0), null, 'a 2 m de otra, sí');
  assert.match(sim.buildProblem(torch, 30.8, 20, 0) ?? '', /Choca/, 'a menos de ~2 m de otra, no');
  // Una antorcha no manda a construir caminos hasta ella.
  const roads = sim.roads.size;
  a.progress = 1;
  sim.finishBuilding(a, null);
  assert.equal(sim.roads.size, roads, 'no se traza un camino hasta una antorcha');
  assert.equal(a.workers.length, 0, 'sin trabajadores');
}

// 3) Las llamas titilan, se apagan si no está terminada y se limpian al quitar el edificio; de noche hay luz real, sólo en las más cercanas.
{
  const scene = new THREE.Scene();
  initTorchLights(scene);
  const lights = torchLights();
  assert.equal(lights.length, 4, 'pocas luces a la vez');
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 0);
  const groups = [];
  const flames = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    g.position.set(i * 10 + 5, 0, 0);
    scene.add(g);
    groups.push(g);
    flames.push(addTorchFlame(g, 1.55, () => i !== 8)); // la 9.ª sin terminar
  }
  assert.equal(torchCount(), 9);
  for (const f of flames) assert.ok(f.outer.renderOrder > 2 && f.inner.renderOrder > 2 && f.halo.renderOrder > 2, 'las llamas van después del camino');
  let now = 0;
  const run = (seconds, night) => {
    for (let t = 0; t < seconds; t += 0.05) updateTorches((now += 0.05), camera, night);
  };
  run(1, 0);
  assert.equal(flames[0].group.visible, true);
  assert.equal(flames[8].group.visible, false, 'sin terminar no arde');
  const scales = new Set();
  for (let t = 0; t < 2; t += 0.05) {
    updateTorches((now += 0.05), camera, 0);
    scales.add(flames[0].outer.scale.y.toFixed(2));
  }
  assert.ok(scales.size > 5, 'la llama titila');
  assert.ok(lights.every((l) => !l.visible), 'de día no hay luces');
  assert.ok(flames[0].halo.material.opacity < 0.4, 'de día el halo es débil');
  run(1, 1);
  assert.equal(lights.filter((l) => l.visible).length, 4, 'de noche, las 4 luces');
  const xs = lights.map((l) => l.position.x).sort((a, b) => a - b);
  assert.deepEqual(xs.map((x) => Math.round(x)), [5, 15, 25, 35], 'son las 4 antorchas más cercanas a la cámara');
  assert.ok(lights.every((l) => l.intensity > 5), 'alumbran');
  // El halo titila con una fase al azar: se mira lo más fuerte que llega a brillar en un par de segundos, no un solo fotograma.
  let brightest = 0;
  for (let t = 0; t < 2; t += 0.05) {
    updateTorches((now += 0.05), camera, 1);
    brightest = Math.max(brightest, flames[0].halo.material.opacity);
  }
  assert.ok(brightest > 0.7, 'de noche el halo se nota');
  // Se mueve la cámara: las luces pasan a las más cercanas.
  camera.position.set(80, 0, 0);
  run(0.2, 1);
  const xs2 = lights.filter((l) => l.visible).map((l) => Math.round(l.position.x)).sort((a, b) => a - b);
  assert.deepEqual(xs2, [45, 55, 65, 75], 'las luces siguen a la cámara (la 9.ª, sin terminar, no cuenta)');
  // Quitar el edificio limpia la llama.
  scene.remove(groups[0]);
  run(0.2, 1);
  assert.equal(torchCount(), 8, 'se limpia al quitar el edificio');
}

console.log('torch.test.js: ok');
