// Nombre de la aldea: se limpia en el servidor, se guarda, se manda a todos y no deja pasar HTML.
// Uso: node server/game/test/village.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { cleanVillageName, VILLAGE_NAME_MAX } from '../../../src/sim/villageName.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony() {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  return sim;
}

assert.equal(cleanVillageName('  Nueva   Esperanza  '), 'Nueva Esperanza');
assert.equal(cleanVillageName('<b>Hola</b>&"x'), 'bHola/bx', 'sin < > & ni comillas: no puede formar HTML');
assert.equal(cleanVillageName('a\u0000b‏c\n d'), 'abc d', 'sin caracteres de control ni invisibles');
assert.equal(cleanVillageName('x'.repeat(100)).length, VILLAGE_NAME_MAX);
assert.equal(cleanVillageName(42), '');
console.log('✓ el nombre se limpia');

const server = colony();
assert.equal(server.villageName, '');
assert.equal(server.applyCommand('setVillageName', ['  Puerto   Sol ']), true);
assert.equal(server.villageName, 'Puerto Sol');
assert.equal(server.applyCommand('setVillageName', [123]), false, 'un valor que no es texto se rechaza');
assert.equal(server.villageName, 'Puerto Sol');
console.log('✓ el servidor valida el comando');

const saved = JSON.parse(JSON.stringify(server.serialize()));
const loaded = colony();
loaded.restore(saved);
assert.equal(loaded.villageName, 'Puerto Sol');
saved.colony.villageName = '<script>alert(1)</script>';
const evil = colony();
evil.restore(JSON.parse(JSON.stringify(saved)));
assert.ok(!/[<>]/.test(evil.villageName), 'una partida alterada tampoco mete HTML');
console.log('✓ se guarda y se recupera, y una partida alterada se limpia');

const replica = colony();
replica.applySnapshot(JSON.parse(JSON.stringify(server.snapshot('full'))), 'full');
assert.equal(replica.villageName, 'Puerto Sol');
server.applyCommand('setVillageName', ['']);
assert.equal(server.villageName, '', 'vacío vuelve al nombre del jugador');
replica.applySnapshot(JSON.parse(JSON.stringify(server.snapshot('full'))), 'full');
assert.equal(replica.villageName, '', 'y la réplica lo sigue');
console.log('✓ los jugadores reciben el nombre (y su borrado)');
console.log('Todo bien.');
process.exit(0);
