// Prueba del servidor de punta a punta, con dos jugadores de mentira por WebSocket.
// Uso: node server/game/test/protocol.test.js  (arranca su propio servidor en otro puerto
// con una base de datos temporal y la borra al final).

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = 3190 + Math.floor(Math.random() * 9);
const dir = mkdtempSync(join(tmpdir(), 'colonymaxai-'));
const env = { ...process.env, PORT: String(PORT), DB_PATH: join(dir, 'game.db') };

function startServer() {
  const proc = spawn(process.execPath, [join(ROOT, 'server/game/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => process.stderr.write(`[servidor] ${d}`));
  return new Promise((ok) => proc.stdout.on('data', (d) => d.toString().includes('escuchando') && ok(proc)));
}

function stopServer(proc) {
  return new Promise((ok) => {
    proc.on('exit', ok);
    proc.kill('SIGINT');
  });
}

// Un jugador: guarda los últimos mensajes de cada tipo y deja esperar uno.
function player() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: `http://127.0.0.1:${PORT}` } });
  const last = {};
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    last[msg.t] = msg;
    for (const w of [...waiters]) {
      if (w.test(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.ok(msg);
      }
    }
  });
  const p = {
    ws,
    last,
    open: new Promise((ok) => ws.on('open', ok)),
    send: (msg) => ws.send(JSON.stringify(msg)),
    // Espera un mensaje nuevo; con "seen" también vale el último ya recibido de ese tipo.
    wait: (test, ms = 8000, seen = false) =>
      new Promise((ok, fail) => {
        const w = { test: typeof test === 'string' ? (m) => m.t === test : test, ok };
        const already = seen && Object.values(last).find(w.test);
        if (already) return ok(already);
        waiters.push(w);
        setTimeout(() => fail(new Error(`No llegó el mensaje esperado en ${ms} ms`)), ms);
      }),
    close: () => new Promise((ok) => (ws.readyState === ws.CLOSED ? ok() : (ws.on('close', ok), ws.close()))),
  };
  return p;
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let server = await startServer();
try {
  // Página y archivos: se entregan los del juego y nada más.
  const page = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.equal(page.status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/src/main.js`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/server/game/index.js`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/src/../package.json`)).status, 404);
  console.log('✓ archivos del juego (y nada más)');

  // Registro, nombre repetido y contraseña incorrecta.
  const ana = player();
  await ana.open;
  ana.send({ t: 'register', name: 'Ana', password: 'secreto1' });
  const auth = await ana.wait('auth');
  assert.ok(auth.ok && auth.token);
  const intruso = player();
  await intruso.open;
  intruso.send({ t: 'register', name: 'ana', password: 'otra123' });
  assert.equal((await intruso.wait('auth')).error, 'Ese nombre ya lo usa otro jugador.');
  intruso.send({ t: 'login', name: 'Ana', password: 'mala123' });
  assert.equal((await intruso.wait('auth')).error, 'Nombre o contraseña incorrectos.');
  await intruso.close();
  console.log('✓ registro, nombre único y contraseña incorrecta');

  // Fundar: en el agua no; en tierra sí.
  ana.send({ t: 'found', dir: { x: 0, y: 0, z: 1 } });
  const bad = await ana.wait((m) => m.t === 'error' && m.about === 'found');
  console.log(`  (lugar no válido: «${bad.message}»)`);
  const campDir = { x: -0.8984470605519815, y: 0.4271785546817849, z: 0.10154487582091702 };
  ana.send({ t: 'found', dir: campDir });
  const colony = await ana.wait((m) => m.t === 'colony' && m.camp);
  assert.equal(colony.colonists.length, 5);
  assert.deepEqual(colony.colonists.map((c) => c.id), [0, 1, 2, 3, 4]);
  console.log('✓ fundar campamento:', colony.stock);

  // Construir: la orden llega y el edificio aparece en la colonia.
  ana.send({ t: 'cmd', name: 'build', args: ['woodcutter', 22, 12] });
  const built = await ana.wait((m) => m.t === 'colony' && m.buildings.length === 1);
  assert.equal(built.buildings[0].type, 'woodcutter');
  assert.equal(built.stock.wood, colony.stock.wood - 8);
  ana.send({ t: 'cmd', name: 'build', args: ['woodcutter', 9999, 12] });
  assert.equal((await ana.wait('error')).message, 'No se pudo hacer eso ahora.');
  console.log('✓ construir (y rechazar una orden inválida)');

  // Posiciones varias veces por segundo.
  const f1 = await ana.wait('fast');
  const f2 = await ana.wait('fast');
  assert.equal(f1.colonists.length, 5);
  console.log('✓ posiciones en vivo:', JSON.stringify(f2.colonists[0]));

  // Otro jugador cerca ve a Ana en la lista y sus colonos en vivo.
  const bruno = player();
  await bruno.open;
  bruno.send({ t: 'register', name: 'Bruno', password: 'secreto2' });
  await bruno.wait('auth');
  bruno.send({ t: 'found', dir: campDir });
  assert.equal((await bruno.wait((m) => m.t === 'error' && m.about === 'found')).message, 'Demasiado cerca de otro campamento');
  bruno.send({ t: 'view', dir: campDir });
  const players = await bruno.wait((m) => m.t === 'players' && m.list.some((p) => p.name === 'Ana' && p.camp), 8000, true);
  const other = await bruno.wait((m) => m.t === 'other');
  assert.equal(other.colonists.length, 5);
  console.log('✓ el otro jugador ve a Ana:', players.list.map((p) => `${p.name}${p.online ? ' (conectado)' : ''}`).join(', '));

  // El clima de la zona de Ana llega en vivo a quien está cerca (para verlo llover allí).
  assert.ok(['clear', 'cloudy', 'rain', 'storm'].includes(other.w?.s), 'other trae el clima de la colonia');
  assert.ok(other.w.r >= 0 && other.w.r <= 1 && other.w.c >= 0 && other.w.c <= 1);
  assert.ok(players.list.find((p) => p.name === 'Ana').w, 'la lista de jugadores trae el clima de cada zona');
  console.log('✓ el clima de la zona de Ana llega en vivo:', JSON.stringify(other.w));

  // Ana se va, el servidor sigue y al volver con su token recibe el resumen.
  const token = auth.token;
  await ana.close();
  await sleep(1500);
  await stopServer(server);
  server = await startServer(); // reiniciar: la colonia se carga de la base
  await sleep(500);
  const ana2 = player();
  await ana2.open;
  ana2.send({ t: 'resume', token });
  assert.ok((await ana2.wait('auth')).ok);
  const back = await ana2.wait((m) => m.t === 'colony');
  assert.equal(back.buildings.length, 1);
  assert.equal(back.buildings[0].id, built.buildings[0].id);
  console.log('✓ volver con el token después de reiniciar el servidor; el edificio sigue ahí');
  ana2.send({ t: 'resume', token: 'x'.repeat(40) });
  await ana2.close();
  await bruno.close();
} finally {
  await stopServer(server);
  rmSync(dir, { recursive: true, force: true });
}
console.log('Todo bien.');
