// Ropa de los colonos (datos y cuentas, sin Three.js; la simulación y las pruebas lo usan igual).
// Cada colono lleva una prenda de la edad en que se hizo: pieles (I), cuero cosido (II), lino (III), lana (IV), túnica y manto (V), jubón (VI),
// ropa de corte (VII), mono de obrero (VIII), moderna (IX) y técnica (X). Cuanto más moderna, más abriga y mejor se ve. Se gasta con el tiempo
// y, al romperse, el colono va a por otra (la pila del campamento al principio, el almacén después). La ropa se fabrica en la sastrería.
//   colonist.wear  { tier, left }  tier = edad de la prenda (1–10) · left = segundos de uso que le quedan
//   colonist.clothed               true mientras lleve algo puesto (lo leen la vista y las necesidades)
import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { addLog } from '../needs.js';

export const CLOTHES_GOOD = 'clothes';
export const MAX_TIER = 10;
export const DRESS_SECONDS = 5;
export const RENEW_BELOW = 0.2; // con menos de esta fracción de vida se cambia por otra si hay en el almacén
export const TIER_NAMES = ['', 'pieles', 'cuero cosido', 'lino', 'lana', 'túnica y manto', 'jubón', 'ropa de corte', 'mono de obrero', 'ropa moderna', 'ropa técnica'];

const clampTier = (t) => Math.max(1, Math.min(MAX_TIER, Math.round(t)));
export const tierName = (tier) => TIER_NAMES[clampTier(tier)];
// Cuánto dura una prenda sin descanso: de dos días y medio (pieles) a siete (ropa técnica).
export const lifeOf = (tier) => DAY_LENGTH_SECONDS * (2 + clampTier(tier) * 0.5);
// Calor que añade al objetivo de abrigo (las pieles de siempre daban 25).
export const warmthOf = (tier) => 22 + 3 * clampTier(tier);

// Pone una prenda de ese nivel (vida entera) al colono.
export function dress(colony, c, tier) {
  const t = clampTier(tier);
  c.wear = { tier: t, left: lifeOf(t) };
  c.clothed = true;
  colony.emit?.('clothes');
}

// Quita la prenda (se rompió o se cambió).
export function undress(colony, c) {
  c.wear = null;
  c.clothed = false;
  colony.emit?.('clothes');
}

// La ropa se gasta (un poco más si trabaja). Al llegar a cero se rompe, con aviso.
export function wearClothes(colony, c, dt) {
  if (!c.clothed) return;
  c.wear ??= { tier: clampTier(colony.age), left: lifeOf(colony.age) }; // partidas de antes de que se gastara: prenda de su edad, nueva
  c.wear.left -= dt * (c.working ? 1.4 : 1);
  if (c.wear.left > 0) return;
  const name = tierName(c.wear.tier);
  undress(colony, c);
  colony.emit?.('notice', `A ${c.name} se le rompió la ropa (${name})`);
  addLog(c, colony.timeLabel?.() ?? '', `Su ropa de ${name} se rompió`);
}

// ¿Debe ir a por ropa? { source: 'pile' | 'stock' } o null.
//   - sin ropa: la pila del campamento (si queda) o el almacén
//   - con ropa: la cambia en el almacén si está a punto de romperse o si hay ropa de una edad más moderna
export function clothesWanted(colony, c) {
  if ((colony.stock[CLOTHES_GOOD] ?? 0) >= 1 && c.clothed) {
    const worn = c.wear ? c.wear.left < lifeOf(c.wear.tier) * RENEW_BELOW : false;
    const dated = c.wear ? c.wear.tier < clampTier(colony.age) : false;
    return worn || dated ? { source: 'stock' } : null;
  }
  if (c.clothed) return null;
  if (colony.clothesLeft > 0) return { source: 'pile' };
  if ((colony.stock[CLOTHES_GOOD] ?? 0) >= 1) return { source: 'stock' };
  return null;
}

// Coge una prenda del almacén (de la edad actual). La vieja se desecha. Devuelve true si se vistió.
export function dressFromStock(colony, c) {
  if ((colony.stock[CLOTHES_GOOD] ?? 0) < 1) return false;
  colony.takeStock(CLOTHES_GOOD, 1);
  dress(colony, c, colony.age);
  colony.emit?.('changed');
  return true;
}

// Cuánto sube o baja el ánimo por la ropa (puntos del objetivo): ropa de su tiempo anima; ir desnudo o con harapos, no.
export function clothesMood(colony, c) {
  if (!c.clothed) return colony.age >= 2 ? -6 : 0;
  if (!c.wear) return 0;
  const frac = c.wear.left / lifeOf(c.wear.tier);
  if (frac < RENEW_BELOW) return -3; // raída
  const behind = clampTier(colony.age) - c.wear.tier;
  if (behind <= 0) return 4; // ropa de la edad: estrena
  if (behind === 1) return 1.5;
  return behind >= 3 ? -3 : 0; // muy anticuada
}

// Para la ficha: qué lleva, cuánta vida le queda y por qué no tiene otra.
export function clothesNote(colony, c) {
  const wanted = clothesWanted(colony, c);
  if (!c.clothed) {
    if (colony.clothesLeft > 0) return 'Irá a buscar ropa de pieles a la pila del campamento.';
    if ((colony.stock[CLOTHES_GOOD] ?? 0) >= 1) return 'Irá a recoger ropa del almacén.';
    return colony.age >= 2 ? 'Sin ropa: no queda en el almacén, hay que fabricarla en la sastrería.' : 'Sin ropa (sólo un taparrabos) y no queda ropa en el campamento.';
  }
  if (wanted) return 'Irá a cambiarla por otra del almacén.';
  return null;
}
