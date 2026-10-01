// Eliminar cuenta: pide la contraseña y borra jugador, sesiones y colonia.
// Uso: node server/game/test/account.test.js

import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { Accounts, AccountError } from '../accounts.js';
import { World } from '../world.js';

const store = new Store(':memory:');
const accounts = new Accounts(store);
const world = new World({ store, log: () => {} });
const { player, token } = await accounts.register('Ana', 'secreto1', '1.1.1.1');
assert.equal(world.found(player.id, { x: -0.18, y: 0.11, z: 0.977 }), null);
assert.ok(world.colonies.has(player.id));
const sent = [];
let closed = false;
world.clients.add({ player: { id: player.id, name: 'Ana' }, send: (m) => sent.push(m.t), close: () => (closed = true) });

await assert.rejects(() => accounts.deleteAccount(player.id, 'mala', '1.1.1.1'), AccountError);
assert.ok(store.sql.playerById.get(player.id), 'con contraseña mala no se borra nada');
await accounts.deleteAccount(player.id, 'secreto1', '1.1.1.1');
world.removePlayer(player.id);
assert.equal(store.sql.playerById.get(player.id), undefined);
assert.equal(store.sql.session.get ? accounts.resume(token) : null, null, 'la sesión cae con la cuenta');
assert.equal(store.sql.colonies.all().length, 0);
assert.equal(world.colonies.size, 0);
assert.deepEqual(sent, ['accountDeleted']);
assert.ok(closed);
// El nombre queda libre.
await accounts.register('Ana', 'otra-clave', '1.1.1.1');
console.log('account.test ✓');
process.exit(0);
