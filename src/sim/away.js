import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { CRITICAL_HEALTH } from '../needs.js';
import { STOCK_NAMES } from './buildingTypes.js';

// Resumen de lo que pasó en una colonia mientras su dueño no estaba («Mientras no
// estabas»). Se toma una foto al irse (awaySnapshot) y, al volver, se compara con cómo
// está ahora (awaySummary).

export const AWAY_MAX_SECONDS = 2 * DAY_LENGTH_SECONDS; // al volver se resume como mucho esto
export const AWAY_MIN_SECONDS = 20; // menos que esto no vale un resumen

export function awaySnapshot(sim) {
  return {
    stock: { ...sim.stock },
    spoiled: sim.spoiled,
    buildings: sim.buildings.map((b) => [b.id, b.done, b.level]),
  };
}

// seconds: segundos de juego que pasaron; capped: si se resumió menos de lo que pasó.
export function awaySummary(sim, before, seconds, capped = false) {
  const hours = Math.round((seconds / DAY_LENGTH_SECONDS) * 24);
  const title = hours >= 1 ? `Pasaron ${hours} ${hours === 1 ? 'hora' : 'horas'} en la colonia` : 'Pasó un rato en la colonia';
  const lines = [];
  if (capped) lines.push('Estuviste fuera mucho tiempo: se resumen los últimos dos días.');
  const changes = Object.keys(STOCK_NAMES)
    .map((k) => [k, Math.round((sim.stock[k] ?? 0) - (before.stock?.[k] ?? 0))])
    .filter(([, d]) => d !== 0)
    .map(([k, d]) => `${d > 0 ? '+' : '−'}${Math.abs(d)} ${STOCK_NAMES[k]}`);
  lines.push(changes.length ? `Almacén: ${changes.join(', ')}.` : 'El almacén quedó igual.');
  const was = new Map((before.buildings ?? []).map(([id, done, level]) => [id, { done, level }]));
  const built = sim.buildings.filter((b) => b.done && was.has(b.id) && !was.get(b.id).done && was.get(b.id).level === b.level).length;
  const upgraded = sim.buildings.filter((b) => was.has(b.id) && b.level > was.get(b.id).level).length;
  if (built) lines.push(`Terminaron ${built === 1 ? 'una obra' : `${built} obras`}.`);
  if (upgraded) lines.push(`Terminaron ${upgraded === 1 ? 'una mejora' : `${upgraded} mejoras`}.`);
  const spoiled = Math.round(sim.spoiled - (before.spoiled ?? 0));
  if (spoiled > 0) lines.push(`Se pudrieron ${spoiled} de comida al aire libre.`);
  const critical = sim.colonists.filter((c) => c.health <= CRITICAL_HEALTH + 0.5);
  if (critical.length) {
    const names = critical.map((c) => c.name);
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
    // Qué les falta (lo que baja la salud, needs.js).
    const lacks = [
      critical.some((c) => c.needs.food <= 1) && 'comida',
      critical.some((c) => c.needs.water <= 1) && 'agua',
      critical.some((c) => c.needs.warmth < 10) && 'calor',
    ].filter(Boolean);
    const what = lacks.length ? lacks.join(lacks.length === 2 ? ' y ' : ', ') : 'comida, agua o calor';
    lines.push(`${who} ${names.length === 1 ? 'quedó' : 'quedaron'} con salud crítica: ${names.length === 1 ? 'le' : 'les'} falta ${what}.`);
  } else {
    lines.push('Todos los colonos siguen bien.');
  }
  return { title, lines, bad: critical.length > 0 };
}
