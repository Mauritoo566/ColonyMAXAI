#!/usr/bin/env node
// Túnel rápido de Cloudflare + aviso por Telegram.
//
// Abre un túnel "rápido" (sin cuenta ni dominio) hacia el juego, que escucha en
// 127.0.0.1:TUNNEL_PORT. La dirección del túnel (https://…trycloudflare.com) cambia cada
// vez que cloudflared arranca, así que este programa la lee y la publica en los chats de
// Telegram configurados (y la fija arriba si el bot es administrador). Además responde a
// /link con la dirección actual. Si cloudflared se cae, lo vuelve a abrir y avisa la nueva.
//
// Sin dependencias: sólo Node 22 (fetch incluido). Configuración por variables de entorno
// (ver tunnel.env.example).

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TOKEN = process.env.TELEGRAM_TOKEN?.trim();
const CHATS = (process.env.TELEGRAM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = Number(process.env.TUNNEL_PORT || 3100);
const CLOUDFLARED = process.env.CLOUDFLARED || 'cloudflared';
const API_BASE = process.env.TELEGRAM_API || 'https://api.telegram.org';
// systemd (StateDirectory=) deja aquí una carpeta propia; ahí se guarda la dirección actual.
const STATE_DIR = process.env.STATE_DIRECTORY || process.env.STATE_DIR || null;
const REACH_TIMEOUT_MS = Number(process.env.REACH_TIMEOUT_MS || 90_000);
const GAME_NAME = process.env.GAME_NAME || 'ColonyMAXAI';

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const RESTART_MIN_MS = 5_000;
const RESTART_MAX_MS = 5 * 60_000;
const ANNOUNCE_RETRY_MS = 30_000;

if (!TOKEN) {
  console.error('Falta TELEGRAM_TOKEN (el token que da @BotFather).');
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error(`TUNNEL_PORT no es un puerto válido: ${process.env.TUNNEL_PORT}`);
  process.exit(1);
}

let currentUrl = null; // dirección ya comprobada y anunciada (o en camino)
let child = null;
let stopping = false;
let restartDelay = RESTART_MIN_MS;
let restartTimer = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log(new Date().toISOString(), ...args);

// ---- Telegram ----------------------------------------------------------------------

async function telegram(method, body, timeoutMs = 15_000) {
  const res = await fetch(`${API_BASE}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => null);
  // Nunca se registra la URL de la API: lleva el token.
  if (!data?.ok) throw new Error(`Telegram ${method}: ${data?.description || `HTTP ${res.status}`}`);
  return data.result;
}

function announcementText(url) {
  return `${GAME_NAME} está en:\n${url}\n\nSi el servidor se reinicia la dirección cambia y la aviso aquí. Escribe /link para pedirla.`;
}

// Publica la dirección en todos los chats; reintenta mientras siga siendo la actual
// (por ejemplo si internet volvió pero Telegram todavía no responde).
async function announce(url) {
  const pending = new Set(CHATS);
  while (pending.size && url === currentUrl && !stopping) {
    for (const chat of [...pending]) {
      try {
        const msg = await telegram('sendMessage', { chat_id: chat, text: announcementText(url) });
        pending.delete(chat);
        // Fijarlo arriba sólo funciona si el bot es administrador del grupo.
        await telegram('pinChatMessage', { chat_id: chat, message_id: msg.message_id, disable_notification: true }).catch(() => {});
        log(`Dirección enviada al chat ${chat}`);
      } catch (err) {
        log(`No se pudo avisar al chat ${chat}: ${err.message}`);
      }
    }
    if (pending.size) await sleep(ANNOUNCE_RETRY_MS);
  }
}

// Responde a /link (y /start) con la dirección actual. Si todavía no hay chats
// configurados, a cualquier mensaje le contesta el id del chat, para la instalación.
async function pollCommands() {
  let offset = 0;
  while (!stopping) {
    try {
      const updates = await telegram('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, 65_000);
      for (const update of updates) {
        offset = update.update_id + 1;
        const message = update.message;
        if (!message?.text) continue;
        const chat = String(message.chat.id);
        if (!CHATS.length) {
          await telegram('sendMessage', { chat_id: chat, text: `El id de este chat es ${chat}. Ponlo en TELEGRAM_CHAT_ID y reinicia el servicio.` });
          log(`Mensaje del chat ${chat} (todavía sin TELEGRAM_CHAT_ID)`);
          continue;
        }
        if (!CHATS.includes(chat)) continue; // chats ajenos: se ignoran
        const command = message.text.trim().split(/[\s@]/)[0].toLowerCase();
        if (command !== '/link' && command !== '/start') continue;
        const text = currentUrl ? announcementText(currentUrl) : `${GAME_NAME} se está iniciando. En cuanto tenga dirección la publico aquí.`;
        await telegram('sendMessage', { chat_id: chat, text, reply_to_message_id: message.message_id });
      }
    } catch (err) {
      if (stopping) return;
      log(`Error leyendo mensajes de Telegram: ${err.message}`);
      await sleep(10_000);
    }
  }
}

// ---- Túnel ---------------------------------------------------------------------------

// Un túnel recién creado tarda unos segundos en responder. Se espera a que Cloudflare
// lo tenga listo (cualquier respuesta que no sea 530) antes de avisar; si tarda mucho se
// avisa igual.
async function waitReachable(url) {
  const deadline = Date.now() + REACH_TIMEOUT_MS;
  while (Date.now() < deadline && url === currentUrl && !stopping) {
    try {
      const wait = Math.max(1_000, Math.min(10_000, deadline - Date.now()));
      const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(wait) });
      if (res.status !== 530) return true;
    } catch {
      // Todavía no existe el nombre en el DNS: seguir esperando.
    }
    await sleep(3_000);
  }
  return false;
}

async function onNewUrl(url) {
  currentUrl = url;
  restartDelay = RESTART_MIN_MS; // arrancó bien: la próxima caída se reintenta rápido
  log(`Túnel abierto: ${url}`);
  if (STATE_DIR) await writeFile(join(STATE_DIR, 'url.txt'), `${url}\n`).catch((err) => log(`No se pudo guardar la dirección: ${err.message}`));
  const ready = await waitReachable(url);
  if (url !== currentUrl || stopping) return;
  if (!ready) log('El túnel todavía no responde; se avisa igual.');
  if (!CHATS.length) {
    log('Sin TELEGRAM_CHAT_ID: escribe al bot desde el chat donde debe avisar para saber su id.');
    return;
  }
  await announce(url);
}

function scheduleRestart(reason) {
  if (stopping || restartTimer) return;
  currentUrl = null;
  log(`${reason}. Se vuelve a abrir en ${Math.round(restartDelay / 1000)} s.`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startTunnel();
  }, restartDelay);
  restartDelay = Math.min(RESTART_MAX_MS, restartDelay * 2);
}

function startTunnel() {
  const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`];
  // Para pruebas: CLOUDFLARED puede ser un script de Node que imite a cloudflared.
  const [cmd, cmdArgs] = /\.m?js$/.test(CLOUDFLARED) ? [process.execPath, [CLOUDFLARED, ...args]] : [CLOUDFLARED, args];
  log(`Abriendo túnel hacia 127.0.0.1:${PORT}`);
  const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  child = proc;
  let ended = false;
  const end = (reason) => {
    if (ended) return;
    ended = true;
    if (child === proc) child = null;
    scheduleRestart(reason);
  };
  // cloudflared escribe todo (también la dirección) por stderr. Se deja en el registro
  // sólo lo importante: la dirección, avisos y errores.
  for (const stream of [proc.stdout, proc.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      const match = line.match(URL_RE);
      if (match && match[0] !== currentUrl) onNewUrl(match[0]).catch((err) => log(`Error anunciando: ${err.message}`));
      else if (/\b(ERR|WRN|error|failed)\b/i.test(line)) log(`cloudflared: ${line.trim()}`);
    });
  }
  proc.on('error', (err) => end(`No se pudo ejecutar cloudflared (${err.message})`));
  proc.on('exit', (code, signal) => end(`cloudflared terminó (código ${code ?? signal})`));
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  log('Cerrando túnel.');
  clearTimeout(restartTimer);
  child?.kill('SIGTERM');
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (!CHATS.length) log('Aviso: TELEGRAM_CHAT_ID está vacío. El bot responderá con el id de cada chat que le escriba.');
// Los grupos tienen id negativo; uno positivo es un chat privado con una persona.
for (const chat of CHATS) {
  if (!chat.startsWith('-')) log(`Aviso: el chat ${chat} es un chat privado con una persona, no un grupo. Para avisar en el grupo, agrega su id (empieza con -).`);
}
startTunnel();
pollCommands();
