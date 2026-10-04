// Cementerio: quien muere queda tirado donde cayó; el enterrador va a buscarlo, lo carga y lo entierra en una tumba. Pasado un tiempo lo
// pasa a cenizas en un jarrón que deja en la estantería, y la tumba queda libre para el próximo. La familia puede llevarse el jarrón a casa
// si lo extraña (y lo piensa bien), y eso le da bienestar. Datos y reglas puras (sin Three.js ni DOM): las usan la IA, la simulación, la
// interfaz y las pruebas.
//
// Cada difunto es un registro en colony.dead (se guarda y viaja por la red):
//   { id, name, sex, look, x, z, diedAt, cause, relatives: [{ id, kind }],
//     state: ground | carried | grave | shelf | fetched | home,
//     bid (cementerio), plot (tumba), niche (hueco de la estantería), buriedAt, shelvedAt, home (casa), carrier, claim }

import { levelOf } from './buildingTypes.js';
import { addMoodEvent, URN_BONUS, MAX_URNS_BONUS } from '../needs.js';
import { DAY_LENGTH_SECONDS } from '../daynight.js';

export const DEAD_STATES = ['ground', 'carried', 'grave', 'shelf', 'fetched', 'home', 'abandoned'];
export const AGE_CEMETERY = 3; // desde esta edad hay cementerio; antes, quien muere se deja lejos de la aldea
export const FAR_MIN = 110; // metros desde la fogata a los que se deja un cuerpo antes de la edad del cementerio
export const FAR_MAX = 170;
export const STENCH_RADIUS = 18; // metros a los que huele un cuerpo sin enterrar
export const SEE_RADIUS = 9; // y a los que se ve (y entristece)
export const SAW_BODY = -8; // golpe de ánimo al ver un cuerpo sin enterrar
export const SAW_COOLDOWN = 0.2 * DAY_LENGTH_SECONDS; // para no repetirlo a cada paso
export const STINK_AFTER = DAY_LENGTH_SECONDS; // con cementerio, un cuerpo que lleva más de esto tirado también huele
export const KEEP_ABANDONED = 40; // cuerpos dejados lejos que se recuerdan (los más viejos se olvidan)
export const BURY_SECONDS = 10; // cavar y enterrar
export const EXHUME_SECONDS = 6; // sacar los restos de la tumba
export const URN_SECONDS = 8; // pasar a cenizas, llenar el jarrón y ponerlo en su hueco
export const TAKE_SECONDS = 4; // coger el jarrón de la estantería
export const PLACE_SECONDS = 4; // dejarlo en casa
export const THINK_SECONDS = 45; // lo que lo piensa un familiar antes de ir a por el jarrón
export const REST_DEFAULT = DAY_LENGTH_SECONDS; // lo que reposa un cuerpo en tierra antes de pasar a cenizas
export const GRIEF = { mate: -25, parent: -22, child: -22, sibling: -12 }; // golpe de ánimo al morir un ser querido
export { URN_BONUS, MAX_URNS_BONUS };
export const URN_EVENT = 12; // alegría al traerlo a casa
export const MAX_URNS_PER_HOME = 3;

export const isCemetery = (b) => b.def.id === 'cemetery';

// ---- Sitios dentro del cementerio (coordenadas del modelo: +z es la puerta; el modelo y la simulación comparten estas) --------------

export const PLOT_COLS = 5;
export const PLOT_ROWS = 4;
export const NICHE_COLS = 8;
export const NICHE_ROWS = 3;

// Tumba nº slot: filas de cinco, del fondo hacia la puerta.
export function plotLocal(slot) {
  const col = slot % PLOT_COLS;
  const row = Math.floor(slot / PLOT_COLS) % PLOT_ROWS;
  return { x: (col - (PLOT_COLS - 1) / 2) * 1.35, z: -2.55 + row * 1.15 };
}

// Hueco nº slot de la estantería del fondo (y = altura del estante).
export function nicheLocal(slot) {
  const col = slot % NICHE_COLS;
  const row = Math.floor(slot / NICHE_COLS) % NICHE_ROWS;
  return { x: (col - (NICHE_COLS - 1) / 2) * 0.8, y: 0.5 + row * 0.62, z: -3.45 };
}

// De coordenadas del modelo a las del campamento (el modelo gira con el edificio).
export function toWorld(b, lx, lz) {
  const s = Math.sin(b.yaw);
  const c = Math.cos(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

export const plotSpot = (b, slot) => toWorld(b, plotLocal(slot).x, plotLocal(slot).z);
export const nicheSpot = (b, slot) => toWorld(b, nicheLocal(slot).x, nicheLocal(slot).z + 0.9); // delante del estante, donde se para quien lo atiende

// ---- Capacidad ---------------------------------------------------------------------------------------------------------------------

export const plotsOf = (b) => Math.min(PLOT_COLS * PLOT_ROWS, levelOf(b)?.plots ?? 0);
export const nichesOf = (b) => Math.min(NICHE_COLS * NICHE_ROWS, levelOf(b)?.niches ?? 0);
export const restOf = (b) => levelOf(b)?.rest ?? REST_DEFAULT;

export function cemeteries(colony) {
  return colony.buildings.filter((b) => isCemetery(b) && b.done && !b.removed && !b.accessIssue);
}

// Tumbas ocupadas o reservadas en un cementerio (el cuerpo que llevan ya tiene la suya).
export function usedPlots(colony, b) {
  return (colony.dead ?? []).filter((r) => r.bid === b.id && r.plot != null && (r.state === 'grave' || r.state === 'carried'));
}

export function usedNiches(colony, b) {
  return (colony.dead ?? []).filter((r) => r.bid === b.id && r.niche != null && (r.state === 'shelf' || (r.state === 'grave' && r.claim != null)));
}

export function freePlot(colony, b) {
  const used = new Set(usedPlots(colony, b).map((r) => r.plot));
  for (let i = 0; i < plotsOf(b); i++) if (!used.has(i)) return i;
  return null;
}

export function freeNiche(colony, b) {
  const used = new Set(usedNiches(colony, b).map((r) => r.niche));
  for (let i = 0; i < nichesOf(b); i++) if (!used.has(i)) return i;
  return null;
}

// ---- Muertes ------------------------------------------------------------------------------------------------------------------------

// Quiénes lloran a un colono: pareja, padres, hijos y hermanos (los que siguen vivos).
export function relativesOf(colony, c) {
  const out = [];
  const add = (o, kind) => {
    if (o && o !== c && !out.some((r) => r.id === o.id)) out.push({ id: o.id, kind });
  };
  if (c.mate != null) add(colony.colonist(c.mate), 'mate');
  if (c.born) {
    add(colony.colonist(c.born.mother), 'parent');
    add(colony.colonist(c.born.father), 'parent');
  }
  for (const o of colony.colonists) {
    if (o === c) continue;
    if (o.born && (o.born.mother === c.id || o.born.father === c.id)) add(o, 'child');
    else if (c.born && o.born && (o.born.mother === c.born.mother || o.born.father === c.born.father)) add(o, 'sibling');
    else if (o.mate === c.id) add(o, 'mate');
  }
  return out;
}

// Dónde queda el cuerpo: donde cayó; si murió dentro de un edificio, en su puerta.
function bodySpot(colony, c) {
  if (!c.inside && !(c.sleeping && !c.outdoorSleep)) return { x: c.x, z: c.z };
  let best = null;
  let bd = Infinity;
  for (const b of colony.buildings) {
    const d = Math.hypot(b.x - c.x, b.z - c.z);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best?.entrance?.approach ?? { x: c.x, z: c.z };
}

// Un colono ha muerto: queda tirado, y quienes lo querían lo lloran. Se llama antes de quitarlo de la lista.
export function recordDeath(colony, c, cause) {
  const relatives = relativesOf(colony, c);
  const spot = bodySpot(colony, c);
  const look = c.look ? { skin: c.look.skin, hair: c.look.hair, shirt: c.look.shirt, pants: c.look.pants, longHair: !!c.look.longHair, height: c.look.height } : null;
  const rec = { id: c.id, name: c.name, sex: c.sex, look, x: spot.x, z: spot.z, diedAt: colony.gameTime, cause, relatives, state: 'ground', bid: null, plot: null, niche: null, buriedAt: null, shelvedAt: null, home: null, carrier: null, claim: null };
  colony.dead = (colony.dead ?? []).filter((r) => r.id !== c.id);
  colony.dead.push(rec);
  const left = colony.dead.filter((r) => r.state === 'abandoned');
  if (left.length > KEEP_ABANDONED) colony.dead = colony.dead.filter((r) => !left.slice(0, left.length - KEEP_ABANDONED).includes(r));
  for (const r of relatives) {
    const o = colony.colonist(r.id);
    if (o) addMoodEvent(o, 'grief', GRIEF[r.kind] ?? -12, colony.gameTime);
  }
  return rec;
}

// ---- El trabajo del enterrador ----------------------------------------------------------------------------------------------------

// Quita las reservas de quien ya no está haciendo ese trabajo (murió, cambió de tarea...).
function cleanClaims(colony) {
  for (const r of colony.dead ?? []) {
    if (r.claim == null) continue;
    const who = colony.colonist(r.claim);
    if (!who || who.task?.rec !== r) {
      // Si lo llevaba y se quedó sin él, el cuerpo queda donde esté el colono; los restos de una tumba siguen allí.
      if (r.state === 'carried') {
        r.state = 'ground';
        r.carrier = null;
        r.plot = null;
        r.bid = null;
        if (who) {
          r.x = who.x;
          r.z = who.z;
        }
      }
      r.claim = null;
    }
  }
}

// Lo siguiente que hay que hacer en este cementerio, o null: { kind: 'bury' | 'cremate', rec }.
export function nextJob(colony, b, c, now) {
  cleanClaims(colony);
  const dead = colony.dead ?? [];
  // 1) Enterrar a quien yace por ahí, empezando por el más cercano, si hay tumba libre.
  if (freePlot(colony, b) != null) {
    let best = null;
    let bd = Infinity;
    for (const r of dead) {
      if (r.state !== 'ground' || r.claim != null) continue;
      const d = Math.hypot(r.x - c.x, r.z - c.z);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    if (best) return { kind: 'bury', rec: best };
  }
  // 2) Pasar a cenizas a quien ya reposó lo suficiente, si hay hueco en la estantería (libera la tumba).
  if (freeNiche(colony, b) != null) {
    const ripe = dead.filter((r) => r.state === 'grave' && r.bid === b.id && r.claim == null && now - (r.buriedAt ?? now) >= restOf(b)).sort((x, y) => (x.buriedAt ?? 0) - (y.buriedAt ?? 0));
    if (ripe.length) return { kind: 'cremate', rec: ripe[0] };
  }
  return null;
}

export const cemeteryHasWork = (colony, b, c, now) => !!nextJob(colony, b, c, now);

// Por qué el enterrador no tiene nada que hacer (para la ficha), o null si hay trabajo.
export function cemeteryStatus(colony, b, now = colony.gameTime) {
  const dead = colony.dead ?? [];
  const waiting = dead.filter((r) => r.state === 'ground').length;
  const fullPlots = freePlot(colony, b) == null;
  const fullNiches = freeNiche(colony, b) == null;
  if (waiting && fullPlots) return `Hay ${waiting} sin enterrar y no quedan tumbas libres: la estantería ${fullNiches ? 'también está llena (amplía o mejora el cementerio)' : 'recibirá a quien lleve tiempo en tierra'}`;
  const resting = dead.filter((r) => r.state === 'grave' && r.bid === b.id);
  if (resting.length && fullNiches && resting.some((r) => now - (r.buriedAt ?? now) >= restOf(b))) return 'La estantería está llena: no se pueden pasar más restos a cenizas';
  return null;
}

// ---- Antes del cementerio: un colono cualquiera deja al muerto lejos de la aldea ---------------------------------------------------

// ¿Hay un cementerio construido (terminado y con la entrada libre)?
export const hasCemetery = (colony) => cemeteries(colony).length > 0;

// Un cuerpo tirado que un colono puede ir a llevarse lejos (sólo antes de la edad del cementerio), el más cercano a c.
export function abandonTarget(colony, c) {
  if (colony.age >= AGE_CEMETERY) return null;
  let best = null;
  let bd = Infinity;
  for (const r of colony.dead ?? []) {
    if (r.state !== 'ground' || r.claim != null) continue;
    const d = Math.hypot(r.x - c.x, r.z - c.z);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

// Dónde lo deja: bien fuera de la aldea (entre FAR_MIN y FAR_MAX metros de la fogata), en la dirección del cuerpo más o menos, en tierra firme.
export function farSpot(colony, rec, rand) {
  const base = Math.hypot(rec.x, rec.z) > 3 ? Math.atan2(rec.z, rec.x) : rand() * Math.PI * 2;
  for (let k = 0; k < 14; k++) {
    const a = base + (rand() - 0.5) * (0.7 + k * 0.12);
    const r = FAR_MIN + rand() * (FAR_MAX - FAR_MIN);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (colony.walkable(x, z, 1.5) && colony.heightAt(x, z) > 0.9) return { x, z };
  }
  return { x: Math.cos(base) * FAR_MIN, z: Math.sin(base) * FAR_MIN };
}

// ---- Olor y tristeza: cuerpos sin enterrar desde la edad del cementerio --------------------------------------------------------

// ¿Este cuerpo huele y entristece? Tirado, desde la edad del cementerio, si no hay cementerio construido (o si lleva ya mucho tirado).
export function smells(colony, rec) {
  if (rec.state !== 'ground' || colony.age < AGE_CEMETERY) return false;
  return !hasCemetery(colony) || colony.gameTime - rec.diedAt > STINK_AFTER;
}

// Cuánto apesta en un punto (0 a 1): crece con el tiempo que lleva el cuerpo tirado y baja con la distancia.
export function stenchAt(colony, x, z) {
  let s = 0;
  for (const r of colony.dead ?? []) {
    if (!smells(colony, r)) continue;
    const d = Math.hypot(r.x - x, r.z - z);
    if (d >= STENCH_RADIUS) continue;
    const fresh = Math.min(1, Math.max(0.35, (colony.gameTime - r.diedAt) / (0.25 * DAY_LENGTH_SECONDS)));
    s += fresh * (1 - d / STENCH_RADIUS);
  }
  return Math.min(1, s);
}

// ¿Ve un cuerpo sin enterrar cerca?
export function seesBody(colony, c) {
  for (const r of colony.dead ?? []) if (smells(colony, r) && Math.hypot(r.x - c.x, r.z - c.z) < SEE_RADIUS) return true;
  return false;
}

// ---- La familia y el jarrón -------------------------------------------------------------------------------------------------------

const RELATION_WEIGHT = { mate: 1, child: 0.9, parent: 0.9, sibling: 0.55 };

// Jarrones de seres queridos de c que están en su casa (dan bienestar), con tope.
export function urnsAtHome(colony, c) {
  if (c.home == null) return 0;
  let n = 0;
  for (const r of colony.dead ?? []) if (r.state === 'home' && r.home === c.home && r.relatives.some((x) => x.id === c.id)) n++;
  return Math.min(MAX_URNS_BONUS, n);
}

// ¿Hay un jarrón en la estantería que c podría querer llevarse? Devuelve { rec, longing } o null. Sólo familiares, con casa propia, sin
// otro familiar que ya vaya a por él, y con la casa con sitio.
export function urnWanted(colony, c, now) {
  if (c.home == null) return null;
  const home = colony.building(c.home);
  if (!home || !home.done || home.removed) return null;
  const inHome = (colony.dead ?? []).filter((r) => r.state === 'home' && r.home === home.id).length;
  if (inHome >= MAX_URNS_PER_HOME) return null;
  let best = null;
  for (const r of colony.dead ?? []) {
    if (r.state !== 'shelf' || r.claim != null) continue;
    const rel = r.relatives.find((x) => x.id === c.id);
    if (!rel) continue;
    if (now - (r.shelvedAt ?? now) < 0.15 * DAY_LENGTH_SECONDS) continue; // que pasen unas horas: no es lo primero que piensa
    const longing = (0.25 + 0.6 * Math.max(0, (75 - c.needs.mood) / 75)) * (RELATION_WEIGHT[rel.kind] ?? 0.5);
    if (!best || longing > best.longing) best = { rec: r, longing };
  }
  return best;
}

// Llevar el jarrón a casa: el familiar lo deja en su casa, siente alivio y la casa lo recuerda.
export function placeUrnHome(colony, rec, c, now) {
  rec.state = 'home';
  rec.home = c.home;
  rec.carrier = null;
  rec.claim = null;
  rec.niche = null;
  rec.bid = null;
  const o = colony.colonist(c.id);
  if (o) addMoodEvent(o, 'urn', URN_EVENT, now);
}

// ---- Guardar y cargar -------------------------------------------------------------------------------------------------------------

export function serializeDead(dead) {
  return (dead ?? []).map((r) => ({ ...r, relatives: r.relatives.map((x) => ({ ...x })), look: r.look ? { ...r.look } : null }));
}

// Lo guardado puede venir de otra versión: se valida todo. Lo que estaba a medias (llevado, reservado) vuelve a su sitio.
export function restoreDead(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || !Number.isInteger(r.id) || typeof r.name !== 'string' || !DEAD_STATES.includes(r.state)) continue;
    if (![r.x, r.z].every(Number.isFinite)) continue;
    const rec = {
      id: r.id,
      name: r.name.slice(0, 40),
      sex: r.sex === 'f' ? 'f' : 'm',
      look: r.look && typeof r.look === 'object' ? { skin: r.look.skin, hair: r.look.hair, shirt: r.look.shirt, pants: r.look.pants, longHair: !!r.look.longHair, height: Number.isFinite(r.look.height) ? r.look.height : 1 } : null,
      x: r.x,
      z: r.z,
      diedAt: Number.isFinite(r.diedAt) ? r.diedAt : 0,
      cause: typeof r.cause === 'string' ? r.cause.slice(0, 80) : '',
      relatives: (Array.isArray(r.relatives) ? r.relatives : []).filter((x) => x && Number.isInteger(x.id)).map((x) => ({ id: x.id, kind: GRIEF[x.kind] != null ? x.kind : 'sibling' })),
      state: r.state,
      bid: Number.isInteger(r.bid) ? r.bid : null,
      plot: Number.isInteger(r.plot) ? r.plot : null,
      niche: Number.isInteger(r.niche) ? r.niche : null,
      buriedAt: Number.isFinite(r.buriedAt) ? r.buriedAt : null,
      shelvedAt: Number.isFinite(r.shelvedAt) ? r.shelvedAt : null,
      home: Number.isInteger(r.home) ? r.home : null,
      carrier: null,
      claim: null,
    };
    // A medias: un cuerpo llevado queda en el suelo; un jarrón llevado vuelve a la estantería.
    if (rec.state === 'carried') {
      rec.state = 'ground';
      rec.bid = null;
      rec.plot = null;
    }
    if (rec.state === 'fetched') {
      rec.state = 'shelf';
      rec.shelvedAt = rec.shelvedAt ?? 0;
    }
    out.push(rec);
  }
  return out;
}

// Lo que ve la copia del navegador (lo justo para dibujarlo y mostrarlo).
export function viewDead(dead) {
  return (dead ?? []).map((r) => ({ id: r.id, name: r.name, sex: r.sex, look: r.look, x: Math.round(r.x * 100) / 100, z: Math.round(r.z * 100) / 100, state: r.state, bid: r.bid, plot: r.plot, niche: r.niche, home: r.home, carrier: r.carrier, buriedAt: r.buriedAt, relatives: r.relatives.map((x) => x.id) }));
}
