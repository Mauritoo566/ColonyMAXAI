// Lo que se ve de los difuntos (deadView.js): el cuerpo tirado o dejado lejos, el que se lleva a cuestas, las tumbas ocupadas, los jarrones de la
// estantería, el que lleva un familiar y los que descansan en casa. Se dibuja sólo lo que dice la lista de difuntos.
// Uso: node server/game/test/deadview.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { DeadView } from '../../../src/deadView.js';
import { plotLocal, nicheLocal } from '../../../src/sim/cemetery.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
const sim = new ColonySim();
sim.weather = new WeatherState(5);
sim.weather.setPlace(dir);
sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });

const scene = new THREE.Scene();
const cemeteryObject = new THREE.Group();
const houseObject = new THREE.Group();
scene.add(cemeteryObject, houseObject);
const carrierObject = new THREE.Group();
carrierObject.position.set(1000, 5000, 200);
scene.add(carrierObject);
const buildings = { entries: new Map([[7, { object: cemeteryObject }], [9, { object: houseObject }]]) };
const colonyView = { entries: new Map([[3, { object: carrierObject }]]) };
const view = new DeadView({ scene, sim, buildings, colonyView });

const look = { skin: '#d8a984', hair: '#3a2a1e', shirt: '#a04a3a', pants: '#4a4a5a', longHair: false, height: 1 };
const rec = (id, state, extra = {}) => ({ id, name: `Difunto${id}`, sex: 'm', look, x: 10 + id, z: 5, state, bid: null, plot: null, niche: null, home: null, carrier: null, relatives: [], ...extra });

sim.dead = [
  rec(1, 'ground'),
  rec(2, 'abandoned', { x: 130, z: 40 }),
  rec(3, 'carried', { carrier: 3 }),
  rec(4, 'grave', { bid: 7, plot: 2 }),
  rec(5, 'shelf', { bid: 7, niche: 4 }),
  rec(6, 'fetched', { carrier: 3 }),
  rec(8, 'home', { home: 9 }),
  rec(10, 'home', { home: 9 }),
];
view.sync();
assert.equal(view.items.size, 8, 'se dibuja a todos');

// Tirado y dejado lejos: en el mundo, cada uno en su sitio.
assert.equal(view.items.get(1).object.parent, view.group);
assert.equal(view.items.get(2).object.parent, view.group);
assert.ok(view.items.get(1).object.position.distanceTo(view.items.get(2).object.position) > 100, 'el dejado lejos está lejos');
// La tumba y el jarrón de la estantería, dentro del cementerio, en sus sitios del modelo.
const grave = view.items.get(4).object;
assert.equal(grave.parent, cemeteryObject);
assert.ok(Math.abs(grave.position.x - plotLocal(2).x) < 1e-9 && Math.abs(grave.position.z - plotLocal(2).z) < 1e-9, 'la tumba 2 en su sitio');
const urn = view.items.get(5).object;
assert.equal(urn.parent, cemeteryObject);
assert.ok(Math.abs(urn.position.x - nicheLocal(4).x) < 1e-9, 'el jarrón en su hueco');
assert.ok(urn.position.y > 0.2, 'a la altura de su estante');
// Los jarrones de casa, junto a la puerta y sin pisarse.
const h1 = view.items.get(8).object;
const h2 = view.items.get(10).object;
assert.equal(h1.parent, houseObject);
assert.equal(h2.parent, houseObject);
assert.ok(Math.abs(h1.position.x - h2.position.x) > 0.4, 'cada jarrón, su sitio');

// Lo que se lleva va con quien lo lleva.
view.update();
const body = view.items.get(3).object;
const jar = view.items.get(6).object;
for (const o of [body, jar]) {
  assert.equal(o.visible, true);
  assert.ok(o.position.distanceTo(carrierObject.position) < 2, 'va con el colono');
}
assert.ok(body.position.distanceTo(carrierObject.position) > jar.position.distanceTo(carrierObject.position) * 0.9, 'el cuerpo a cuestas, más alto que el jarrón en las manos');
carrierObject.position.set(1010, 5000, 200);
view.update();
assert.ok(body.position.distanceTo(carrierObject.position) < 2, 'sigue al colono cuando se mueve');
colonyView.entries.delete(3);
view.update();
assert.equal(body.visible, false, 'sin quien lo lleve no se ve flotando');
colonyView.entries.set(3, { object: carrierObject });

// Si cambia el estado, se rehace sólo lo que cambió: el enterrado pasa de llevado a tumba, el jarrón de la estantería a la casa.
const before = view.items.get(1).object;
sim.dead[2] = rec(3, 'grave', { bid: 7, plot: 3 });
sim.dead[4] = rec(5, 'home', { home: 9 });
view.sync();
assert.equal(view.items.get(1).object, before, 'lo que no cambió no se rehace');
assert.equal(view.items.get(3).object.parent, cemeteryObject, 'ya está en su tumba');
assert.equal(view.items.get(5).object.parent, houseObject, 'el jarrón ya está en casa');
// Sin el edificio (aún no dibujado) no se dibuja dentro de él; al aparecer, sí.
buildings.entries.delete(7);
view.sync();
assert.equal(view.items.has(4), false, 'sin el cementerio dibujado, la tumba espera');
buildings.entries.set(7, { object: cemeteryObject });
view.sync();
assert.equal(view.items.get(4).object.parent, cemeteryObject);
// Quien ya no está en la lista, se quita.
sim.dead = sim.dead.filter((r) => r.id !== 1);
view.sync();
assert.equal(view.items.has(1), false);
assert.equal(view.group.children.includes(before), false);

console.log('deadview.test.js: ok');
