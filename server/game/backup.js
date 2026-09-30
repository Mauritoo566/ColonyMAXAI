#!/usr/bin/env node
// Copia de seguridad de la base del juego, en caliente (el juego puede seguir encendido).
// Pensada para correr una vez por día (colonymaxai-backup.timer). Guarda:
//   - las últimas 7 copias diarias,
//   - 4 semanales (la del domingo),
//   - 3 mensuales (la del día 1).
// Carpeta: BACKUP_DIR (por defecto, "backups" junto a la base).

import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = process.env.DB_PATH || join(ROOT, 'server', 'game', 'data', 'game.db');
const DIR = process.env.BACKUP_DIR || join(dirname(DB_PATH), 'backups');
const KEEP = { daily: 7, weekly: 4, monthly: 3 };

mkdirSync(DIR, { recursive: true });
const now = new Date();
const day = now.toISOString().slice(0, 10); // AAAA-MM-DD
const daily = join(DIR, `daily-${day}.db`);

const source = new DatabaseSync(DB_PATH, { readOnly: true });
try {
  await backup(source, daily);
} finally {
  source.close();
}
if (now.getUTCDay() === 0) copyFileSync(daily, join(DIR, `weekly-${day}.db`));
if (now.getUTCDate() === 1) copyFileSync(daily, join(DIR, `monthly-${day.slice(0, 7)}.db`));

// Borrar las más viejas de cada tipo (los nombres se ordenan por fecha).
for (const [kind, keep] of Object.entries(KEEP)) {
  const files = readdirSync(DIR).filter((f) => f.startsWith(`${kind}-`) && f.endsWith('.db')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(DIR, old));
}
console.log(`Copia guardada: ${daily}`);
