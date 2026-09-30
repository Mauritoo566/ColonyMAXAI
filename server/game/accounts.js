import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Cuentas de jugador: nombre único y contraseña (guardada sólo como huella scrypt con
// sal, nunca en claro). Al entrar se da un token de sesión; el navegador lo guarda para
// no pedir la contraseña cada vez. En la base se guarda sólo la huella del token.

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SESSION_DAYS = 60;
const NAME_RE = /^[\p{L}\p{N}_ .-]{3,20}$/u;
// Límite de intentos: 5 por nombre y 20 por dirección cada 5 minutos.
const WINDOW_MS = 5 * 60_000;
const MAX_PER_NAME = 5;
const MAX_PER_IP = 20;

export class AccountError extends Error {}

async function hashPassword(password, salt) {
  return (await scryptAsync(password, salt, KEY_LENGTH)).toString('hex');
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

export class Accounts {
  constructor(store) {
    this.store = store;
    this.attempts = new Map(); // clave -> [momentos de intentos fallidos]
  }

  // Cuenta un intento fallido y avisa si ya hay demasiados.
  limited(keys, record = false) {
    const now = Date.now();
    let blocked = false;
    for (const [key, max] of keys) {
      const list = (this.attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
      if (record) list.push(now);
      this.attempts.set(key, list);
      if (list.length >= max) blocked = true;
    }
    if (this.attempts.size > 10_000) this.attempts.clear();
    return blocked;
  }

  async register(name, password, ip) {
    name = String(name ?? '').trim();
    password = String(password ?? '');
    if (!NAME_RE.test(name)) throw new AccountError('El nombre debe tener de 3 a 20 letras, números, espacios, puntos o guiones.');
    if (password.length < 6) throw new AccountError('La contraseña debe tener al menos 6 caracteres.');
    if (password.length > 200) throw new AccountError('La contraseña es demasiado larga.');
    if (this.limited([[`ip:${ip}`, MAX_PER_IP]], true)) throw new AccountError('Demasiados intentos. Espera unos minutos.');
    const nameLc = name.toLowerCase();
    if (this.store.sql.playerByName.get(nameLc)) throw new AccountError('Ese nombre ya lo usa otro jugador.');
    const salt = randomBytes(16).toString('hex');
    const hash = await hashPassword(password, salt);
    // Otro pudo registrarlo mientras se calculaba la huella.
    if (this.store.sql.playerByName.get(nameLc)) throw new AccountError('Ese nombre ya lo usa otro jugador.');
    const { lastInsertRowid } = this.store.sql.addPlayer.run(name, nameLc, salt, hash, Date.now());
    return this.startSession(Number(lastInsertRowid));
  }

  async login(name, password, ip) {
    const nameLc = String(name ?? '').trim().toLowerCase();
    const keys = [[`name:${nameLc}`, MAX_PER_NAME], [`ip:${ip}`, MAX_PER_IP]];
    if (this.limited(keys)) throw new AccountError('Demasiados intentos. Espera unos minutos.');
    const player = this.store.sql.playerByName.get(nameLc);
    // El mismo mensaje en los dos casos, para no revelar qué nombres existen.
    const wrong = new AccountError('Nombre o contraseña incorrectos.');
    const hash = await hashPassword(String(password ?? '').slice(0, 200), player?.salt ?? 'sin-cuenta');
    if (!player || !timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(player.hash, 'hex'))) {
      this.limited(keys, true);
      throw wrong;
    }
    return this.startSession(player.id);
  }

  // Entrar con el token guardado en el navegador.
  resume(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const row = this.store.sql.session.get(tokenHash(token));
    if (!row || Date.now() - row.last_used > SESSION_DAYS * 86_400_000) return null;
    this.store.sql.touchSession.run(Date.now(), row.token_hash);
    return this.store.sql.playerById.get(row.player_id) ?? null;
  }

  startSession(playerId) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.store.sql.addSession.run(tokenHash(token), playerId, now, now);
    this.store.sql.dropOldSessions.run(now - SESSION_DAYS * 86_400_000);
    return { player: this.store.sql.playerById.get(playerId), token };
  }

  logout(token) {
    if (typeof token === 'string') this.store.sql.dropSession.run(tokenHash(token));
  }

  // Para el administrador (admin.js): nueva contraseña y cierra todas sus sesiones.
  async resetPassword(name, password) {
    const player = this.store.sql.playerByName.get(String(name).trim().toLowerCase());
    if (!player) throw new AccountError(`No existe el jugador «${name}».`);
    if (String(password).length < 6) throw new AccountError('La contraseña debe tener al menos 6 caracteres.');
    const salt = randomBytes(16).toString('hex');
    this.store.sql.setPassword.run(salt, await hashPassword(String(password), salt), player.id);
    this.store.sql.dropPlayerSessions.run(player.id);
    return player.name;
  }
}
