#!/usr/bin/env node
// Herramientas para el administrador del servidor.
//
//   node server/game/admin.js jugadores
//       Lista los jugadores: nombre, si tienen campamento y cuándo entraron por última vez.
//   node server/game/admin.js contraseña <jugador> <contraseña nueva>
//       Cambia la contraseña de un jugador (por ejemplo si la olvidó) y cierra sus sesiones.
//
// Usa la misma base de datos que el juego (DB_PATH). Se puede correr con el juego
// encendido.

import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Accounts, AccountError } from './accounts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = process.env.DB_PATH || join(ROOT, 'server', 'game', 'data', 'game.db');
const [command, ...args] = process.argv.slice(2);
const store = new Store(DB_PATH);

try {
  if (command === 'jugadores') {
    const camps = new Set(store.sql.colonies.all().map((c) => c.player_id));
    const players = store.sql.allPlayers.all();
    if (!players.length) console.log('Todavía no hay jugadores.');
    for (const p of players) {
      const seen = p.last_seen ? new Date(p.last_seen).toLocaleString('es') : 'nunca';
      console.log(`${p.name.padEnd(22)} ${camps.has(p.id) ? 'con campamento' : 'sin campamento'}   última vez: ${seen}`);
    }
  } else if (command === 'contraseña' || command === 'contrasena') {
    const [name, password] = args;
    if (!name || !password) throw new AccountError('Uso: node server/game/admin.js contraseña <jugador> <contraseña nueva>');
    const who = await new Accounts(store).resetPassword(name, password);
    console.log(`Listo: ${who} ya puede entrar con la contraseña nueva (sus sesiones abiertas se cerraron).`);
  } else {
    console.log('Uso:\n  node server/game/admin.js jugadores\n  node server/game/admin.js contraseña <jugador> <contraseña nueva>');
    process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  console.error(err instanceof AccountError ? err.message : err);
  process.exitCode = 1;
} finally {
  store.close();
}
