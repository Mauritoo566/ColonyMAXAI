// Por qué un colono está como está: explica el ánimo con los factores que la simulación calcula de verdad
// (needs.js: updateNeeds) y qué se puede hacer. Lo usa la ficha, la lista y los avisos; corre igual en el
// servidor y en la réplica del navegador, porque sólo mira datos que ambos tienen.
//
// El ánimo no se suma factor a factor: tiende hacia un objetivo
//   objetivo = 25 + 0,6 × media(comida, agua, descanso, calor) ± rasgo ± compañía − sin casa
// y se acerca a él a un ritmo fijo; además hay golpes puntuales (eventos) que lo mueven al instante y luego se
// recupera. Las cifras de aquí son esos términos reales: "puntos de objetivo" para las condiciones y
// "puntos inmediatos" para los eventos.

import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { NEEDS, hasTrait, URN_BONUS, STENCH_PENALTY } from '../needs.js';
import { BUILDINGS, levelOf } from './buildingTypes.js';
import { isAdult, usable } from './family.js';

const DAY = DAY_LENGTH_SECONDS;
export const MOOD_RATE = 100 / (0.8 * DAY); // puntos por segundo de juego que el ánimo se acerca a su objetivo
export const NEED_WEIGHT = 0.6 / 4; // cada necesidad (comida, agua, descanso, calor) pesa esto sobre el objetivo
export const EVENT_SECONDS = 0.5 * DAY; // un golpe puntual se recuerda este tiempo
export const HOMELESS_PENALTY = 14;

export const EVENT_TEXT = {
  age: 'Celebró la llegada de una nueva edad',
  attack: 'Un animal lo atacó',
  meal: 'Comió a gusto en el comedor',
  grief: 'Lloró la muerte de un ser querido',
  urn: 'Llevó a casa el jarrón de un ser querido',
  sawbody: 'Vio un cuerpo sin enterrar',
  love: 'Pasó un rato con su pareja',
};

// Categorías del ánimo con histéresis (se entra y se sale por umbrales distintos): no parpadea entre "bien" y "desanimado".
export const BANDS = [
  { id: 'bad', text: 'Muy desanimado', tone: 'bad', below: 20 },
  { id: 'low', text: 'Desanimado', tone: 'warn', below: 40 },
  { id: 'ok', text: 'Normal', tone: 'ok', below: 65 },
  { id: 'good', text: 'Animado', tone: 'good', below: 101 },
];
const MARGIN = 4;

export function nextBand(prev, value) {
  let i = Math.min(BANDS.length - 1, Math.max(0, prev ?? -1));
  if (prev == null || prev < 0) {
    i = BANDS.findIndex((b) => value < b.below);
    return i < 0 ? BANDS.length - 1 : i;
  }
  // Sube sólo si supera el límite superior de su banda con margen; baja si cae bajo el límite de la anterior con margen.
  while (i < BANDS.length - 1 && value >= BANDS[i].below + MARGIN) i++;
  while (i > 0 && value < BANDS[i - 1].below - MARGIN) i--;
  return i;
}

// Tendencia con histéresis a partir del cambio previsto por la simulación (hacia dónde tira el objetivo).
export function nextTrend(prev, mood, target) {
  const diff = target - mood;
  if (Math.abs(diff) >= 2.5) return diff > 0 ? 1 : -1;
  if (Math.abs(diff) < 1) return 0;
  return prev === Math.sign(diff) ? prev : 0;
}

const needValue = (c, id) => c.needs[id];
const pts = (n) => Math.round(n);

// Plazas de vivienda libres: lo que hay frente a lo que se usa.
export function housing(colony) {
  let slots = 0;
  for (const b of colony.buildings) if (usable(b)) slots += levelOf(b).housing ?? 0;
  const housed = colony.colonists.filter((c) => isAdult(c) && c.home != null).length;
  const adults = colony.colonists.filter(isAdult).length;
  return { slots, housed, adults, free: Math.max(0, slots - housed) };
}

// ¿Se puede construir ya este edificio por la edad? (no se recomienda lo bloqueado)
function unlocked(colony, id) {
  const def = BUILDINGS[id];
  return !!def && def.minAge <= colony.age;
}

function foodSources(colony) {
  const out = [];
  for (const id of ['gatherer', 'farm', 'bakery']) if (unlocked(colony, id)) out.push(BUILDINGS[id].name.toLowerCase());
  return out;
}

const SHORT = { food: 'hambre', water: 'sed', rest: 'agotado', warmth: 'frío' };

// Causas que bajan el ánimo y factores que lo ayudan. Cada una: { id, source, text, impact, sev, short }
// impact > 0 ayuda, < 0 perjudica (en puntos del objetivo, o inmediatos si source === 'event').
export function moodFactors(colony, c) {
  const causes = [];
  const positives = [];
  const fx = c.moodFx ?? { companion: 0, homeless: 0, urns: 0 };
  for (const id of ['food', 'water', 'rest', 'warmth']) {
    const v = needValue(c, id);
    if (v < 40) {
      const need = NEEDS.find((n) => n.id === id);
      causes.push({ id: `need-${id}`, source: 'need', need: id, text: need.low, impact: -pts(NEED_WEIGHT * (100 - v)), sev: v < 20 ? 3 : v < 30 ? 2 : 1, short: SHORT[id] });
    } else if (v >= 80) {
      positives.push({ id: `ok-${id}`, source: 'need', text: `${NEEDS.find((n) => n.id === id).name} cubierta`, impact: pts(NEED_WEIGHT * (v - 50)) });
    }
  }
  if ((fx.stench ?? 0) > 0.05) causes.push({ id: 'stench', source: 'condition', text: 'Huele muy mal: hay cuerpos sin enterrar cerca', impact: -pts(STENCH_PENALTY * fx.stench), sev: fx.stench > 0.6 ? 2 : 1, short: 'mal olor' });
  if ((fx.homeless ?? 0) > 0.05) causes.push({ id: 'homeless', source: 'condition', text: 'No tiene una cama propia', impact: -pts(HOMELESS_PENALTY * fx.homeless), sev: fx.homeless > 0.6 ? 2 : 1, short: 'sin cama' });
  if ((fx.urns ?? 0) > 0) positives.push({ id: 'urns', source: 'condition', text: fx.urns > 1 ? 'Tiene en casa los jarrones de sus seres queridos' : 'Tiene en casa el jarrón de un ser querido', impact: pts(URN_BONUS * fx.urns) });
  if ((fx.clothes ?? 0) <= -2) causes.push({ id: 'clothes', source: 'condition', text: c.clothed ? 'Su ropa está raída o es muy anticuada' : 'Va sin ropa', impact: pts(fx.clothes), sev: c.clothed ? 1 : 2, short: c.clothed ? 'ropa vieja' : 'sin ropa' });
  if ((fx.clothes ?? 0) >= 1) positives.push({ id: 'clothes', source: 'condition', text: fx.clothes >= 3 ? 'Lleva ropa nueva de su tiempo' : 'Lleva ropa casi de su tiempo', impact: pts(fx.clothes) });
  if (hasTrait(c, 'pessimist')) causes.push({ id: 'trait-pessimist', source: 'trait', text: 'Es pesimista: su ánimo tiende a ser más bajo', impact: -12, sev: 0, short: 'pesimista' });
  if (hasTrait(c, 'optimist')) positives.push({ id: 'trait-optimist', source: 'trait', text: 'Es optimista', impact: 12 });
  if (fx.companion) {
    if (hasTrait(c, 'loner')) causes.push({ id: 'company-loner', source: 'trait', text: 'Prefiere estar solo y hay alguien cerca', impact: -5, sev: 0, short: 'sin soledad' });
    else positives.push({ id: 'company', source: 'condition', text: 'Está acompañado', impact: hasTrait(c, 'sociable') ? 25 : 12 });
  } else if (hasTrait(c, 'sociable') && !c.sleeping && !c.inside) {
    causes.push({ id: 'alone-sociable', source: 'condition', text: 'Es sociable y está solo (no recibe el ánimo extra por compañía)', impact: -25, sev: 0, short: 'solo' });
  }
  for (const e of c.moodEvents ?? []) {
    const left = Math.max(0, EVENT_SECONDS - (colony.gameTime - e.at));
    if (left <= 0) continue;
    const row = { id: `event-${e.id}`, source: 'event', text: EVENT_TEXT[e.id] ?? e.id, impact: pts(e.delta), left, sev: e.delta < -10 ? 2 : e.delta < 0 ? 1 : 0, short: EVENT_TEXT[e.id] ? EVENT_TEXT[e.id].toLowerCase() : e.id };
    (e.delta < 0 ? causes : positives).push(row);
  }
  causes.sort((a, b) => b.sev - a.sev || a.impact - b.impact);
  return { causes, positives };
}

// Qué tarea resuelve cada necesidad.
const FIXES = { food: ['eat'], water: ['drink'], rest: ['sleep'], warmth: ['warm', 'dress'] };

// Qué impide resolver una causa (si lo hay): lo que registró la simulación o lo que se ve en las existencias.
function blockerOf(colony, c, cause) {
  if (cause.source !== 'need') return null;
  if (c.block && c.block.need === cause.need) return c.block.why;
  const s = colony.stock;
  if (cause.need === 'food' && (s.food ?? 0) < 1 && (s.bread ?? 0) < 1) return 'No hay comida en el almacén';
  if (cause.need === 'water' && (s.water ?? 0) < 1 && !colony.waterSpot?.()) return 'No hay agua cerca ni en el almacén';
  return null;
}

function adviceFor(colony, c, cause) {
  const out = [];
  const s = colony.stock;
  switch (cause.id) {
    case 'need-food': {
      if ((s.food ?? 0) >= 1 || (s.bread ?? 0) >= 1) {
        if (c.block?.need === 'food') out.push({ text: 'Hay comida, pero no llega a ella: despejá el camino o el acceso al almacén.', action: { kind: 'storage' } });
        else out.push({ text: 'Hay comida en el almacén: irá a comer.' });
      } else {
        const src = foodSources(colony);
        out.push({ text: `Falta comida. Marcá bayas y setas con «Recolectar»${src.length ? ` o construí: ${src.join(', ')}` : ''}.`, action: { kind: 'build', type: src.length ? 'gatherer' : null } });
      }
      break;
    }
    case 'need-water':
      if ((s.water ?? 0) >= 1) out.push({ text: 'Hay agua en el almacén: irá a beber.' });
      else if (unlocked(colony, 'well')) out.push({ text: 'Falta agua. Un pozo o un recolector de lluvia la aseguran.', action: { kind: 'build', type: 'well' } });
      else out.push({ text: 'Falta agua: debe llegar hasta una fuente natural.' });
      break;
    case 'need-rest':
      out.push({ text: c.home == null ? 'Necesita dormir. Con una cama propia descansa mejor.' : 'Necesita dormir: lo hará de noche en su casa.', action: c.home == null ? { kind: 'build', type: 'house' } : { kind: 'building', id: c.home } });
      break;
    case 'need-warmth':
      if (!c.clothed && colony.clothesLeft > 0) out.push({ text: `Irá a buscar ropa de pieles al campamento (quedan ${colony.clothesLeft}).` });
      else if (!c.clothed && (colony.stock?.clothes ?? 0) >= 1) out.push({ text: 'Hay ropa en el almacén: irá a recogerla.' });
      else if (!c.clothed) out.push({ text: colony.age >= 2 ? 'No queda ropa: una sastrería la fabrica; mientras, sólo la fogata lo calienta.' : 'No queda ropa en el campamento: sólo la fogata lo calienta.' });
      out.push({ text: 'La fogata lo calienta rápido; dentro de una vivienda también se abriga.' });
      break;
    case 'homeless': {
      const h = housing(colony);
      if (h.free > 0) out.push({ text: `Hay ${h.free} plaza${h.free > 1 ? 's' : ''} libre${h.free > 1 ? 's' : ''}: se le asignará una vivienda.`, action: { kind: 'housing' } });
      else if (unlocked(colony, 'house')) out.push({ text: `Sin plazas libres (${h.housed}/${h.slots} ocupadas, ${h.adults} adultos). Construí o mejorá una vivienda.`, action: { kind: 'build', type: 'house' } });
      else out.push({ text: 'Sin plazas libres y todavía no hay viviendas disponibles en esta edad.' });
      break;
    }
    case 'stench': {
      const built = colony.buildings.some((b) => b.def.id === 'cemetery' && b.done);
      if (built) out.push({ text: 'Hay cuerpos sin enterrar: el cementerio no da abasto (sin tumbas libres o sin enterrador). Mejóralo o ponle un enterrador.', action: { kind: 'build', type: 'cemetery' } });
      else if (unlocked(colony, 'cemetery')) out.push({ text: 'Construí un cementerio (Servicios) y ponle un enterrador: se llevará a los muertos y dejará de oler.', action: { kind: 'build', type: 'cemetery' } });
      else out.push({ text: 'Todavía no hay cementerios en esta edad: un colono se llevará el cuerpo lejos de la aldea.' });
      break;
    }
    case 'alone-sociable':
      out.push({ text: 'Mejora cuando alguien está cerca; charla con otros si está desanimado.' });
      break;
    default:
      if (cause.source === 'event') out.push({ text: `Es un efecto pasajero: se disipa en ~${Math.max(1, Math.round(cause.left / 60))} min a velocidad ×1.` });
      else if (cause.source === 'trait') out.push({ text: 'Es parte de su carácter: no se corrige, sólo se compensa cubriendo sus necesidades.' });
  }
  return out;
}

// Diagnóstico completo para la ficha.
export function diagnose(colony, c) {
  const mood = c.needs.mood;
  const target = c.moodTarget ?? mood;
  const band = BANDS[c.moodBand ?? nextBand(null, mood)];
  const trend = c.moodTrend ?? 0;
  const { causes, positives } = moodFactors(colony, c);
  const task = c.task?.type ?? c.taskType ?? null;
  for (const cause of causes) {
    cause.advice = adviceFor(colony, c, cause);
    cause.blocker = blockerOf(colony, c, cause);
    const fixes = FIXES[cause.need] ?? [];
    cause.working = fixes.includes(task);
  }
  const lead = causes.find((x) => x.source === 'need') ?? causes[0] ?? null;
  const trying = lead?.working ? c.activity : null;
  const needLow = causes.some((x) => x.source === 'need');
  let recovery = null;
  if (!needLow && target - mood > 3) recovery = { seconds: (target - mood) / MOOD_RATE, to: pts(target) };
  return {
    mood: pts(mood),
    target: pts(target),
    band,
    trend,
    trendText: trend > 0 ? 'mejorando' : trend < 0 ? 'empeorando' : 'estable',
    causes,
    positives,
    trying,
    busyWith: lead && !lead.working ? c.activity : null,
    blocker: lead?.blocker ?? null,
    recovery,
    main: causes.find((x) => x.sev >= 1)?.short ?? null,
  };
}

// Sólo el problema principal (para la lista y los avisos; sin consejos).
export function mainProblem(colony, c) {
  if ((c.growth ?? 1) < 1) return null;
  const { causes } = moodFactors(colony, c);
  return causes.find((x) => x.sev >= 1) ?? null;
}

// Avisos colectivos: "4 colonos no tienen cama". Cada uno lleva a quiénes afecta (para abrir la lista).
export function collectiveAlerts(colony) {
  const groups = new Map();
  for (const c of colony.colonists) {
    if ((c.growth ?? 1) < 1) continue;
    const p = mainProblem(colony, c);
    if (!p || p.source === 'trait') continue;
    // Un hambre o sed fuerte ya la avisa alertsOf (hunger/thirst): aquí van sólo las causas que no tienen aviso propio.
    if (p.need === 'food' || p.need === 'water') continue;
    const key = p.id;
    if (!groups.has(key)) groups.set(key, { cause: p, ids: [] });
    groups.get(key).ids.push(c.id);
  }
  const out = [];
  for (const [id, g] of groups) {
    const n = g.ids.length;
    const worst = g.cause.sev >= 2;
    const plural = n > 1;
    const text =
      id === 'homeless' ? `${n} colono${plural ? 's no tienen' : ' no tiene'} cama`
      : id === 'need-rest' ? `${n} colono${plural ? 's están agotados' : ' está agotado'}`
      : id === 'need-warmth' ? `${n} colono${plural ? 's tienen' : ' tiene'} frío`
      : `${n} colono${plural ? 's están desanimados' : ' está desanimado'}: ${g.cause.short}`;
    const hint = id === 'homeless' ? 'Construí o mejorá viviendas: cada una aloja a su gente.' : id === 'need-warmth' ? 'Acercalos a la fogata o dales ropa de pieles.' : id === 'need-rest' ? 'Necesitan dormir, mejor en una cama propia.' : 'Abrí su ficha para ver qué les pasa.';
    out.push({ id: `wb-${id}`, level: worst ? 'bad' : 'warn', text, hint, ids: g.ids });
  }
  return out;
}
