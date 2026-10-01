import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Base de datos del juego: un archivo SQLite (node:sqlite, incluido en Node 22; no hay
// nada que compilar). Guarda jugadores, sesiones, colonias y el reloj del mundo.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_lc TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS colonies (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  camp TEXT NOT NULL,
  save TEXT,
  away TEXT,
  updated_at INTEGER NOT NULL
);
`;

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    const q = (sql) => this.db.prepare(sql);
    this.sql = {
      getMeta: q('SELECT value FROM meta WHERE key = ?'),
      setMeta: q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      playerByName: q('SELECT * FROM players WHERE name_lc = ?'),
      playerById: q('SELECT * FROM players WHERE id = ?'),
      addPlayer: q('INSERT INTO players (name, name_lc, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)'),
      setPassword: q('UPDATE players SET salt = ?, hash = ? WHERE id = ?'),
      touchPlayer: q('UPDATE players SET last_seen = ? WHERE id = ?'),
      allPlayers: q('SELECT id, name, last_seen FROM players'),
      addSession: q('INSERT INTO sessions (token_hash, player_id, created_at, last_used) VALUES (?, ?, ?, ?)'),
      session: q('SELECT * FROM sessions WHERE token_hash = ?'),
      touchSession: q('UPDATE sessions SET last_used = ? WHERE token_hash = ?'),
      dropSession: q('DELETE FROM sessions WHERE token_hash = ?'),
      deletePlayer: q('DELETE FROM players WHERE id = ?'),
      dropPlayerSessions: q('DELETE FROM sessions WHERE player_id = ?'),
      dropOldSessions: q('DELETE FROM sessions WHERE last_used < ?'),
      colonies: q('SELECT * FROM colonies'),
      deleteColony: q('DELETE FROM colonies WHERE player_id = ?'),
      addColony: q('INSERT INTO colonies (player_id, camp, save, away, updated_at) VALUES (?, ?, NULL, NULL, ?)'),
      saveColony: q('UPDATE colonies SET save = ?, away = ?, updated_at = ? WHERE player_id = ?'),
    };
  }

  meta(key) {
    return this.sql.getMeta.get(key)?.value ?? null;
  }

  setMeta(key, value) {
    this.sql.setMeta.run(key, String(value));
  }

  // Varias escrituras juntas (más rápido y todo o nada).
  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.db.close();
  }
}
