#!/usr/bin/env node
// Servidor del juego ColonyMAXAI.
//
// - Entrega la página del juego (index.html, style.css y src/) por HTTP.
// - En /ws atiende a los jugadores por WebSocket: cuentas, sesiones y órdenes.
// - Simula todas las colonias todo el tiempo (world.js) y las guarda en SQLite.
//
// Escucha sólo en 127.0.0.1 (el túnel de Cloudflare o Caddy lo publican). Configuración
// por variables de entorno (ver game.env.example).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { Accounts, AccountError } from './accounts.js';
import { World } from './world.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || join(ROOT, 'server', 'game', 'data', 'game.db');
const STATIC_DIR = resolve(process.env.STATIC_DIR || ROOT);
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_MESSAGES_PER_SECOND = 40;
const HEARTBEAT_MS = 30_000;
const PROTOCOL = 1;

const log = (...args) => console.log(new Date().toISOString(), ...args);

// ---- Archivos del juego -----------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
// Sólo se entrega esto (nunca el servidor, la base de datos ni la configuración).
const ALLOWED = [/^\/$/, /^\/index\.html$/, /^\/style\.css$/, /^\/src\/[\w./-]+\.js$/];

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (!ALLOWED.some((re) => re.test(path)) || path.includes('..')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
    return;
  }
  if (path === '/') path = '/index.html';
  const file = resolve(STATIC_DIR, '.' + path);
  if (!file.startsWith(STATIC_DIR + sep)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('no es un archivo');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // Siempre preguntar si cambió: al actualizar el juego los jugadores ven lo nuevo.
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}

// ---- Jugadores ----------------------------------------------------------------------------

const store = new Store(DB_PATH);
const accounts = new Accounts(store);
const world = new World({ store, log });

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res).catch((err) => {
    log(`Error entregando ${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(500).end();
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  // Sólo desde la página del propio juego (no desde otros sitios).
  const origin = req.headers.origin;
  let sameSite = true;
  try {
    sameSite = !origin || new URL(origin).host === req.headers.host;
  } catch {
    sameSite = false;
  }
  if (url.pathname !== '/ws' || !sameSite) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  // Detrás del túnel de Cloudflare la dirección real viene en esta cabecera.
  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  const client = {
    player: null,
    token: null,
    view: null,
    alive: true,
    sendRaw(text) {
      // A un jugador con la conexión saturada se le salta este envío (llega el próximo).
      if (ws.readyState === ws.OPEN && ws.bufferedAmount < 1_000_000) ws.send(text);
    },
    send(msg) {
      this.sendRaw(JSON.stringify(msg));
    },
  };
  let budget = MAX_MESSAGES_PER_SECOND;
  const refill = setInterval(() => (budget = MAX_MESSAGES_PER_SECOND), 1000);
  ws.on('pong', () => (client.alive = true));
  client.send({ t: 'hello', protocol: PROTOCOL, elapsed: world.elapsed });

  const signedIn = (player, token) => {
    // Una sola sesión por jugador en esta conexión; si ya estaba en otra, siguen las dos.
    client.player = { id: player.id, name: player.name };
    client.token = token;
    client.send({ t: 'auth', ok: true, name: player.name, token, playerId: player.id });
    world.join(client);
    world.sendPlayers(true);
    log(`${player.name} entró (${ip})`);
  };

  ws.on('message', async (data) => {
    if (--budget < 0) {
      ws.close(1008, 'Demasiados mensajes');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      if (!client.player) {
        if (msg.t === 'resume') {
          const player = accounts.resume(msg.token);
          if (player) signedIn(player, msg.token);
          else client.send({ t: 'auth', ok: false, expired: true });
        } else if (msg.t === 'login' || msg.t === 'register') {
          const { player, token } = msg.t === 'login' ? await accounts.login(msg.name, msg.password, ip) : await accounts.register(msg.name, msg.password, ip);
          if (msg.t === 'register') log(`Jugador nuevo: ${player.name}`);
          signedIn(player, token);
        }
        return;
      }
      switch (msg.t) {
        case 'found': {
          const problem = world.found(client.player.id, msg.dir);
          if (problem) client.send({ t: 'error', message: problem, about: 'found' });
          else {
            world.join(client);
            world.sendPlayers(true);
          }
          break;
        }
        case 'cmd':
          world.command(client, msg.name, msg.args);
          break;
        case 'view':
          // Hacia dónde mira la cámara: se le mandan los colonos de las colonias cercanas.
          if (msg.dir && [msg.dir.x, msg.dir.y, msg.dir.z].every(Number.isFinite)) client.view = direction(msg.dir);
          break;
        case 'logout':
          accounts.logout(client.token);
          ws.close(1000, 'Sesión cerrada');
          break;
        case 'ping':
          client.send({ t: 'pong' });
          break;
      }
    } catch (err) {
      if (err instanceof AccountError) client.send({ t: 'auth', ok: false, error: err.message });
      else {
        log(`Error atendiendo «${msg.t}»: ${err.stack ?? err}`);
        client.send({ t: 'error', message: 'Error del servidor. Prueba de nuevo.' });
      }
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    if (client.player) {
      world.leave(client);
      log(`${client.player.name} salió`);
    }
  });
  ws.on('error', () => {});
  ws.client = client;
});

// Dirección unitaria en el planeta (para comparar distancias con las colonias).
function direction(d) {
  const v = new THREE.Vector3(d.x, d.y, d.z);
  return v.lengthSq() > 1e-6 ? v.normalize() : null;
}

// Conexiones que dejaron de responder (el wifi se cortó, se cerró la tapa...).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.client && !ws.client.alive) {
      ws.terminate();
      continue;
    }
    if (ws.client) ws.client.alive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

world.start();
server.listen(PORT, HOST, () => log(`ColonyMAXAI escuchando en http://${HOST}:${PORT} (base de datos: ${DB_PATH})`));

// Al apagar (systemctl stop, reinicio, Ctrl+C): guardar todo antes de salir.
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`Apagando (${signal}): guardando el mundo…`);
  clearInterval(heartbeat);
  try {
    world.stop();
    store.close();
  } catch (err) {
    log(`Error al guardar: ${err.stack ?? err}`);
  }
  for (const ws of wss.clients) ws.close(1012, 'El servidor se está reiniciando');
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
