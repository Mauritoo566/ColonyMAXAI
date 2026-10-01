// Edad Primitiva: campamento inicial, reservas, refugio, descubrimiento de la primera herramienta
// de piedra, alertas de escasez y datos de cada recurso. Datos y cuentas puras (sin DOM) que usan
// tanto el servidor como la interfaz (la guía, los avisos y las ayudas).

import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { levelOf } from './buildingTypes.js';
import { usable, isAdult, isChild, pregnantCount } from './family.js';
import { limitsFor } from './progression.js';

const DAY = DAY_LENGTH_SECONDS;

// ---- Cantidades (salen de los consumos reales: 5 colonos beben ~2,8 jarras y comen ~2,3 raciones por día) ----
export const PRIMITIVE_STOCK = { food: 18, water: 10, wood: 40, stone: 14, fiber: 14 };
export const PRIMITIVE_COLLECTOR_WATER = 6; // lo que ya tiene el recolector de lluvia al fundar
// Reservas que se conservan (no se gastan al avanzar de edad): unos 4 días de agua y comida para cinco.
export const RESERVE = { food: 12, water: 10 };
// Consumo por colono y día (jarras / raciones), según cuánto restaura cada una.
export const WATER_PER_DAY = 100 / 3 / 60;
export const FOOD_PER_DAY = 100 / 4 / 55;
export const LOW_DAYS = 2; // avisar cuando la reserva dura menos de esto

// La primera herramienta de piedra: se descubre con lo que hay en Primitiva y tarda un rato.
export const DISCOVERY = { id: 'stone_tool', name: 'Primera herramienta de piedra', cost: { stone: 6, wood: 4, fiber: 4 }, seconds: DAY / 3 };
export const LEARNABLE = ['tour', 'water_seen'];

export const adultsOf = (colony) => colony.colonists.filter(isAdult);

// Refugio: plazas, adultos con plaza y adultos que duermen junto a la fogata.
export function shelterInfo(colony) {
  let slots = 0;
  for (const b of colony.buildings) if (usable(b)) slots += levelOf(b).housing ?? 0;
  const adults = adultsOf(colony);
  const housed = adults.filter((c) => c.home != null).length;
  return { slots, adults: adults.length, housed, unhoused: adults.length - housed, children: colony.colonists.filter(isChild).length, ok: adults.length > 0 && housed === adults.length };
}

export function populationInfo(colony) {
  const cap = limitsFor(colony.age).popCap;
  return { count: colony.colonists.length, pregnant: pregnantCount(colony), cap, shelter: shelterInfo(colony) };
}

// ---- Agua y comida: reservas y cuánto duran ----------------------------------------------------

export function waterReport(colony) {
  const collectors = colony.buildings.filter((b) => b.done && levelOf(b).rainOnly);
  const store = collectors.reduce((a, b) => a + b.store, 0);
  const capacity = collectors.reduce((a, b) => a + (levelOf(b).capacity ?? 0), 0);
  const stock = colony.stock.water ?? 0;
  const n = Math.max(1, colony.colonists.length);
  const perDay = n * WATER_PER_DAY;
  return { stock, store, capacity, perDay, days: (stock + store) / perDay, collectors: collectors.length };
}

export function foodReport(colony) {
  const stock = colony.stock.food ?? 0;
  const perDay = Math.max(1, colony.colonists.length) * FOOD_PER_DAY;
  return { stock, perDay, days: stock / perDay };
}

// ---- Recursos naturales ------------------------------------------------------------------------

export const NATURAL = {
  food: { name: 'Comida silvestre', where: 'Arbustos de bayas y setas, alrededor del campamento.', order: 'Herramienta «Recolectar» (filtro Comida): arrastra sobre la zona.', use: 'Alimenta a los colonos.' },
  wood: { name: 'Ramas y madera', where: 'Ramas y troncos caídos por el bosque.', order: 'Herramienta «Recolectar» (filtro Madera).', use: 'Refugios, almacén, acopio y construcciones básicas. No hace falta hacha.' },
  stone: { name: 'Piedras sueltas', where: 'Piedras del terreno (sin picar cantera).', order: 'Herramienta «Recolectar» (filtro Piedra).', use: 'Construcciones básicas y descubrir la primera herramienta. No hace falta pico.' },
  fiber: { name: 'Fibras', where: 'Salen como extra al recoger bayas y madera; las enramadas de recolección también las traen.', order: 'Recolecta comida o madera: la fibra viene de regalo.', use: 'Ataduras, refugios, recipientes y casi toda construcción.' },
  water: { name: 'Agua', where: 'Se capta en el recolector de lluvia (no hace falta un río).', order: 'Los colonos beben solos del recolector; un aguatero lleva el agua al almacén.', use: 'Beber y mantener reservas. Sin lluvia, el recolector sólo junta rocío.' },
};

// Lo que queda de un recurso natural en el terreno (sitios sin agotar) y lo que está marcado.
export function remainingOf(colony, kind) {
  let left = 0;
  let marked = 0;
  let waiting = 0;
  for (const s of colony.spots) {
    if (s.kind !== kind || s.gone) continue;
    left++;
    if (s.marked) marked++;
    if (s.readyAt > colony.gameTime) waiting++;
  }
  return { left, marked, waiting };
}

// Texto de ayuda de un recurso: dónde, cómo, para qué, cuánto queda y por qué no se recoge.
export function resourceHelp(colony, id) {
  const info = NATURAL[id];
  if (!info) return '';
  const parts = [`${info.name}`, `Dónde: ${info.where}`, `Cómo: ${info.order}`, `Para qué: ${info.use}`];
  if (['food', 'wood', 'stone'].includes(id)) {
    const r = remainingOf(colony, id);
    parts.push(`En el terreno: ${r.left} sitios${r.waiting ? ` (${r.waiting} rebrotando)` : ''}${r.marked ? `, ${r.marked} marcados` : ''}.`);
    const why = harvestBlocker(colony, id);
    if (why) parts.push(`No se recoge: ${why}`);
  }
  if (id === 'water') {
    const w = waterReport(colony);
    parts.push(`Reserva: ${Math.floor(w.stock + w.store)} jarras (${Math.floor(w.store)}/${w.capacity} en el recolector); la aldea gasta ~${w.perDay.toFixed(1)} por día${w.collectors ? ` → dura unos ${w.days.toFixed(1)} días` : ''}.`);
  }
  return parts.join('\n');
}

// Por qué no se está recogiendo un recurso (null si se recoge o no hay nada que decir).
export function harvestBlocker(colony, kind) {
  const r = remainingOf(colony, kind);
  if (!r.marked) return r.left ? null : 'ya no queda ninguno cerca: explora y marca otra zona';
  if (colony.nightNow) return 'es de noche; los colonos recolectan de día';
  if (!adultsOf(colony).some((c) => !c.soldier)) return 'no hay adultos que puedan recolectar';
  if (colony.isFull?.(kind === 'food' ? 'food' : kind)) return 'el almacén está lleno: construye uno o una zona de acopio';
  return null;
}

// ---- Alertas de escasez -------------------------------------------------------------------------

export function alertsOf(colony) {
  const out = [];
  if (!colony.camp || !colony.colonists.length) return out;
  const w = waterReport(colony);
  const f = foodReport(colony);
  if (w.days < LOW_DAYS) out.push({ id: 'water', level: w.days < 1 ? 'bad' : 'warn', text: `Agua para ~${Math.max(0, w.days).toFixed(1)} días`, hint: w.collectors ? 'Espera lluvia o construye otro recolector de lluvia.' : 'Construye un recolector de lluvia.' });
  if (f.days < LOW_DAYS) out.push({ id: 'food', level: f.days < 1 ? 'bad' : 'warn', text: `Comida para ~${Math.max(0, f.days).toFixed(1)} días`, hint: 'Marca una zona con bayas y setas con «Recolectar».' });
  const hungry = colony.colonists.filter((c) => c.needs.food < 20).length;
  const thirsty = colony.colonists.filter((c) => c.needs.water < 20).length;
  if (hungry) out.push({ id: 'hunger', level: 'bad', text: `${hungry} colono${hungry > 1 ? 's' : ''} con mucha hambre`, hint: 'Hace falta comida en el acopio o bayas cerca.' });
  if (thirsty) out.push({ id: 'thirst', level: 'bad', text: `${thirsty} colono${thirsty > 1 ? 's' : ''} con mucha sed`, hint: 'Hace falta agua en el recolector de lluvia o el acopio.' });
  const s = shelterInfo(colony);
  if (s.unhoused > 0) out.push({ id: 'shelter', level: 'warn', text: `${s.unhoused} colono${s.unhoused > 1 ? 's duermen' : ' duerme'} junto a la fogata`, hint: 'Descansan peor. Construye refugios (cada uno aloja a 2).' });
  for (const kind of ['food', 'wood', 'stone']) {
    const r = remainingOf(colony, kind);
    if (r.left <= 4 && colony.age === 1) out.push({ id: `deplete-${kind}`, level: r.left === 0 ? 'bad' : 'warn', text: `Quedan pocos sitios de ${NATURAL[kind].name.toLowerCase()} cerca`, hint: 'Explora y marca otra zona; el terreno no se renueva sin límite.' });
  }
  return out;
}

// ---- Descubrimiento de la primera herramienta ----------------------------------------------------

export function discoveryProblem(colony) {
  if (colony.milestones.has(DISCOVERY.id)) return 'Ya descubierta';
  if (colony.discovery) return 'Ya se está fabricando';
  for (const [k, n] of Object.entries(DISCOVERY.cost)) if ((colony.stock[k] ?? 0) < n) return `Faltan ${Math.ceil(n - (colony.stock[k] ?? 0))} de ${NATURAL[k]?.name.toLowerCase() ?? k}`;
  if (!colony.colonists.some((c) => isAdult(c))) return 'No hay adultos que puedan hacerlo';
  return null;
}
