// Un camino es un camino: nunca queda debajo de un edificio (ni se dibuja dentro de su huella). Al construir sobre casillas de camino, se quitan; un
// adorno pequeño (antorcha) no se lleva por delante las casillas vecinas; y la cinta no entra en ninguna huella.
// Uso: node server/game/test/roadunder.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { roadKey, roadCellProblem } from '../../../src/sim/economy.js';
import { buildRoadGeometry, footprintBlockers } from '../../../src/roadMesh.js';
import { footprintRect } from '../../../src/sim/access.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(3);
  return sim;
}

// 1) Construir un cementerio sobre un camino quita las casillas que pisa; el resto del camino se queda.
{
  const sim = colony();
  for (let ix = 3; ix <= 11; ix++) sim.roads.set(roadKey(ix, 6), 1);
  const b = sim.createBuilding(BUILDINGS.cemetery, 28, 24, 0, 1, 0, 1);
  const rect = footprintRect(b.def, b.x, b.z);
  for (let ix = 3; ix <= 11; ix++) {
    const x = ix * 4;
    const under = x + 2 > rect.x0 + 1e-6 && x - 2 < rect.x1 - 1e-6;
    assert.equal(sim.roads.has(roadKey(ix, 6)), !under, `casilla ${ix},6 ${under ? 'bajo el cementerio: se quita' : 'fuera: se queda'}`);
  }
  // Y en las casillas que pisa no se puede pintar otro.
  assert.equal(roadCellProblem(sim, 7, 6), 'Hay algo encima');
}

// 2) Una antorcha pegada a un camino no se lleva por delante las casillas vecinas (ni borra las suyas al ponerse en el borde).
{
  const sim = colony();
  for (let ix = 3; ix <= 11; ix++) sim.roads.set(roadKey(ix, 6), 1);
  sim.createBuilding(BUILDINGS.torch, 21.5, 25.8, 0, 1, 0);
  assert.equal(sim.roads.size, 9, 'el camino sigue entero');
  assert.notEqual(roadCellProblem(sim, 9, 6), 'Hay algo encima', 'una antorcha no bloquea las casillas de camino de al lado');
}

// 3) La cinta no se dibuja dentro de la huella de un edificio, aunque el camino pase por ahí.
{
  const roads = new Map();
  for (let ix = 3; ix <= 11; ix++) roads.set(roadKey(ix, 6), 1);
  const rect = footprintRect(BUILDINGS.cemetery, 28, 24);
  const sinBloqueo = buildRoadGeometry(roads, 1, () => 0, new Map(), []);
  const conBloqueo = buildRoadGeometry(roads, 1, () => 0, new Map(), [rect]);
  const dentro = (g) => {
    const p = g.attributes.position;
    let n = 0;
    for (let i = 0; i < p.count; i++) if (p.getX(i) > rect.x0 + 0.05 && p.getX(i) < rect.x1 - 0.05 && p.getZ(i) > rect.z0 + 0.05 && p.getZ(i) < rect.z1 - 0.05) n++;
    return n;
  };
  assert.ok(dentro(sinBloqueo) > 20, 'sin bloqueo la cinta atraviesa la huella');
  assert.equal(dentro(conBloqueo), 0, 'con el bloqueo no entra ni un vértice');
  assert.ok(conBloqueo.attributes.position.count > 20, 'y el resto del camino se sigue dibujando');
  // footprintBlockers: sólo edificios con huella (ni muros ni adornos).
  const blockers = footprintBlockers([{ def: BUILDINGS.cemetery, x: 28, z: 24 }, { def: BUILDINGS.torch, x: 5, z: 5 }, { def: BUILDINGS.wall, x: 9, z: 9 }]);
  assert.equal(blockers.length, 1);
}

console.log('roadunder.test.js: ok');
