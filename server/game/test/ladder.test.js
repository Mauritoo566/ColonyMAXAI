// Recorre las 10 edades como un jugador: en cada una levanta lo que se exige, y comprueba que
// se avanza sólo cuando se cumple todo, que la ofrenda se cobra una vez y que nada se pierde.
// Uso: node server/game/test/ladder.test.js

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { AGES, MAX_AGE, nextAgeStatus } from '../../../src/ages.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { maxLevelFor } from '../../../src/sim/progression.js';
import { assignHomes } from '../../../src/sim/family.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
const sim = new ColonySim();
sim.weather = new WeatherState(5);
sim.weather.setPlace(dir);
sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 4242 }, { ownZone: true });
sim.timeLabel = () => 'Día 1';
sim.stock = { food: 900, water: 900, wood: 900, stone: 900, fiber: 900 };

let extra = 100;
let slot = 0;
const place = (id, level = 1) => {
  const ring = 18 + Math.floor(slot / 12) * 7;
  const a = (slot++ % 12) * ((Math.PI * 2) / 12);
  const def = BUILDINGS[id];
  const dep = def.deposit ? sim.deposits.find((d) => d.kind === def.deposit) : null;
  return sim.createBuilding(def, dep ? dep.x : Math.cos(a) * ring, dep ? dep.z : Math.sin(a) * ring, 0, 1, 0, level);
};
const grow = (n) => {
  while (sim.colonists.length < n) {
    const base = sim.colonists[0];
    sim.colonists.push(sim.makeColonist({ ...sim.staticOf(base), id: extra++, name: `Extra ${extra}` }, { needs: { ...base.needs }, growth: 1 }));
  }
};

for (let n = 2; n <= MAX_AGE; n++) {
  const req = AGES[n - 1].requires;
  const before = nextAgeStatus(sim);
  assert.equal(before.ready, false, `no se puede avanzar a la edad ${n} sin cumplir lo que pide`);
  assert.equal(before.next.n, n);
  // El jugador cumple los requisitos: población, edificios (con su nivel), producción, tecnologías y ofrenda.
  grow(req.population);
  for (const r of req.buildings ?? []) {
    if (!sim.buildings.some((b) => b.def.id === r.id && b.level >= (r.level ?? 1))) place(r.id, r.level ?? 1);
  }
  for (const m of req.milestones ?? []) sim.milestones.add(m.id);
  if (req.shelter) {
    while (sim.shelterInfo().slots < sim.colonists.length) place('house');
    assignHomes(sim);
  }
  for (const [good, qty] of Object.entries(req.produced ?? {})) sim.produced[good] = Math.max(sim.produced[good] ?? 0, qty);
  for (const t of req.techs ?? []) sim.techs.add(t);
  for (const k of Object.keys(req.cost)) sim.stock[k] = 0;
  assert.equal(nextAgeStatus(sim).ready, false, 'falta la ofrenda');
  for (const [k, v] of Object.entries(req.cost)) sim.stock[k] = v + 5;
  const status = nextAgeStatus(sim);
  assert.equal(status.ready, true, `la edad ${n} debería estar lista: ${JSON.stringify(status.checks.filter((c) => !c.ok))}`);
  const stockBefore = { ...sim.stock };
  const buildingsBefore = sim.buildings.length;
  const colonistsBefore = sim.colonists.length;
  assert.equal(sim.advanceAge(), true);
  assert.equal(sim.age, n);
  for (const [k, v] of Object.entries(req.cost)) assert.equal(stockBefore[k] - sim.stock[k], v, `la ofrenda de ${k} se cobra una vez`);
  assert.equal(sim.buildings.length, buildingsBefore, 'no se pierde ningún edificio');
  assert.equal(sim.colonists.length, colonistsBefore, 'no se pierde ningún colono');
  for (const b of sim.buildings) if (b.def.autoLevel) assert.equal(b.level, maxLevelFor(b.def, n), 'las viviendas evolucionan solas');
  console.log(`✓ edad ${n}: ${AGES[n - 1].name}`);
}
assert.equal(nextAgeStatus(sim).ready, false);
assert.equal(sim.advanceAge(), false, 'la edad XI no se puede alcanzar');
assert.equal(sim.age, MAX_AGE);
// Guardar y cargar la aldea completa.
const copy = new ColonySim();
copy.weather = new WeatherState(5);
copy.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 4242 }, { ownZone: true });
assert.equal(copy.restore(JSON.parse(JSON.stringify(sim.serialize()))), true);
assert.equal(copy.age, MAX_AGE);
assert.equal(copy.buildings.length, sim.buildings.length);
assert.equal(copy.techs.size, sim.techs.size);
console.log(`✓ aldea completa guardada y cargada: ${copy.buildings.length} edificios, ${copy.colonists.length} colonos`);
console.log('Todo bien.');
process.exit(0);
