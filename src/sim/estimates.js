// Estimaciones de producción: cuánto da un edificio y cada cuánto, con lo que hay ahora (trabajadores,
// distancia a los recursos, energía y lluvia). Son orientativas: los colonos también comen, duermen y
// descansan, así que se descuenta una parte del día. Sirven tanto para un edificio levantado como para
// uno que aún se va a construir (con una distancia típica y un trabajador de habilidad media).

import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { levelOf, STOCK_NAMES } from './buildingTypes.js';
import { GOOD_NAMES } from './goods.js';
import { DEW_RATE, RAIN_RATE } from './primitive.js';

const DAY = DAY_LENGTH_SECONDS;
const WALK = 1.4; // m/s (igual que la simulación)
// Parte del día en que un trabajador está realmente en su puesto (de día, y sin las pausas por hambre, sed o sueño).
// Calibrado con simulaciones sueltas; es una orientación, no una garantía.
export const ACTIVE_FRACTION = 0.4;
// En talleres y campos el ciclo sólo avanza con el trabajador en su puesto (medido: ~55 % del tiempo).
const PRESENCE = 0.55;
const TYPICAL_DISTANCE = 30; // metros hasta el recurso cuando aún no hay edificio
const name = (k) => STOCK_NAMES?.[k] ?? GOOD_NAMES?.[k] ?? k;
const fmt = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
const list = (o) => Object.entries(o).filter(([, n]) => n > 0).map(([k, n]) => `${fmt(n)} ${name(k)}`).join(' + ');

// Edificio virtual para estimar antes de construir.
export const virtualBuilding = (def, level = 1) => ({ def, level, workers: [], x: 0, z: 0, virtual: true, store: 0, pf: 1 });

// Devuelve { perDay: { bien: cantidad }, perTrip|perCycle: texto, seconds, lines: [texto], blocked: texto|null }
// o null si el edificio no produce recursos.
export function productionEstimate(colony, b) {
  const def = b.def;
  const lv = levelOf(b);
  const needed = colony.crewNeeded(b) || 1;
  const workers = b.virtual ? 1 : Math.min(needed, b.workers.length);
  const skillOf = (w) => colony.skillOf(w, def.skill);
  const skill = b.workers?.length ? b.workers.reduce((a, w) => a + skillOf(w), 0) / b.workers.length : 5;
  const out = { perDay: {}, lines: [], blocked: null, seconds: null };

  // 1) Talleres, campos y minas: un ciclo con receta.
  if (def.kind && lv.recipe && Object.keys(lv.recipe.out ?? {}).length) {
    const crew = Math.min(1, workers / needed);
    const pf = lv.energy ? (b.virtual ? 1 : b.pf ?? 0) : 1;
    const speed = crew * (1 / (1.4 - skill * 0.07)) * pf;
    const rain = lv.rain ? 1 + (colony.weather?.rain ?? 0) * 0.5 : 1;
    const seconds = lv.recipe.time / Math.max(0.01, speed);
    const cycles = (DAY * PRESENCE) / seconds;
    for (const [k, n] of Object.entries(lv.recipe.out)) out.perDay[k] = n * rain * cycles;
    const inPerDay = Object.fromEntries(Object.entries(lv.recipe.in ?? {}).map(([k, n]) => [k, n * cycles]));
    out.seconds = seconds;
    out.lines.push(`Cada ${fmt(seconds)} s: +${list(lv.recipe.out)}${Object.keys(lv.recipe.in ?? {}).length ? ` (gasta ${list(lv.recipe.in)})` : ''}`);
    out.lines.push(`Unos ${list(out.perDay)} por día${Object.keys(inPerDay).length ? ` y gasta ${list(inPerDay)}` : ''}, mientras haya materiales, sitio en el almacén${lv.energy ? ' y energía' : ''}.`);
    if (!b.virtual && workers < needed) out.lines.push(`Con la dotación completa (${needed}) sería más rápido: ahora ${workers}/${needed}.`);
    if (lv.energy && !b.virtual && (b.pf ?? 0) < 1) out.lines.push(`Energía al ${Math.round((b.pf ?? 0) * 100)} %: produce a ese ritmo.`);
    if (lv.rain) out.lines.push('Con lluvia rinde hasta un 50 % más.');
    return out;
  }

  // 2) Recolector de lluvia / pozo.
  if (def.id === 'well') {
    const walk = 6;
    if (lv.rainOnly) {
      const dew = DEW_RATE * DAY;
      const heavy = (DEW_RATE + RAIN_RATE) * DAY;
      out.perDay.water = dew;
      out.lines.push(`Capta ~${fmt(dew)} jarras por día con tiempo seco (rocío) y ~${fmt(heavy)} con lluvia fuerte; guarda hasta ${lv.capacity}.`);
      const haul = (lv.workTime ?? 10) + walk;
      out.lines.push(`El aguatero lleva ~${lv.yield} jarras al almacén cada ${fmt(haul)} s si hay agua en las vasijas.`);
      if (colony.weather) out.lines.push(`Ahora: ${(colony.weather.rain ?? 0) >= 0.05 ? 'llueve' : 'sin lluvia'}, capta ~${fmt((DEW_RATE + (colony.weather.rain ?? 0) * RAIN_RATE) * DAY)} por día.`);
      return out;
    }
    const seconds = (lv.workTime ?? 10) + walk;
    const rainMult = 1 + (colony.weather?.rain ?? 0);
    out.seconds = seconds;
    out.perDay.water = ((DAY * ACTIVE_FRACTION) / seconds) * lv.yield * rainMult * Math.min(1, workers / 1);
    out.lines.push(`Un viaje cada ~${fmt(seconds)} s: +${fmt(lv.yield * rainMult)} jarras${rainMult > 1 ? ' (con lluvia rinde más)' : ''}.`);
    out.lines.push(`Unas ${fmt(out.perDay.water)} jarras por día con ${workers || 1} aguatero${workers > 1 ? 's' : ''}; la aldea bebe ~${fmt(colony.colonists.length * 1.1)} por día.`);
    return out;
  }

  // 3) Recolectores de recursos del terreno (enramada, leñador, pedrera): viajes de ida y vuelta.
  if (def.resource && def.stock && lv.yield) {
    let distance = TYPICAL_DISTANCE;
    let found = true;
    if (!b.virtual) {
      const spot = colony.nearestSpot?.(def.resource, b.x, b.z, def.range, colony.gameTime ?? 0);
      if (spot) distance = Math.hypot(spot.x - b.x, spot.z - b.z);
      else found = false;
    }
    if (!found) {
      out.blocked = def.noResourceText ?? 'No hay recursos cerca';
      out.lines.push(`Ahora no produce nada: ${out.blocked.toLowerCase()}.`);
      return out;
    }
    const gather = def.workTime * (1.4 - (skill / 10) * 0.7);
    const seconds = gather + (2 * distance) / WALK + 3;
    const trips = (DAY * ACTIVE_FRACTION) / seconds;
    const per = { [def.stock]: lv.yield, ...(def.extra ?? {}) };
    for (const [k, n] of Object.entries(per)) out.perDay[k] = n * trips * Math.max(1, workers);
    out.seconds = seconds;
    out.lines.push(`Un viaje cada ~${fmt(seconds)} s (recurso a ~${Math.round(distance)} m): +${list(per)}.`);
    out.lines.push(`Unos ${list(out.perDay)} por día${workers > 1 ? ` con ${workers} trabajadores` : ''}${b.virtual ? ' (con un colono de habilidad media y el recurso a ~30 m)' : ''}.`);
    if (!b.virtual && !b.workers.length) out.lines.push('Sin trabajador no produce: asigna a alguien.');
    if (def.id === 'woodcutter' || def.resource === 'wood') out.lines.push('Cada montón o árbol del terreno se agota y no se renueva.');
    return out;
  }
  return null;
}

// Una línea corta para listas y descripciones (por ejemplo, antes de construir).
export function estimateLine(colony, def, level = 1) {
  const est = productionEstimate(colony, virtualBuilding(def, level));
  if (!est || !Object.keys(est.perDay).length) return '';
  return `≈ ${list(est.perDay)} por día`;
}
