// Cazadores (datos y cuentas, sin Three.js; la simulación y las pruebas lo usan igual).
// La casa de cazadores (hunter_lodge) tiene un cupo de colonos según su nivel. Cada cazador se arma con una lanza (las hace la casa de lanzas, bien `spear`)
// que recoge del almacén y se gasta con los golpes. Armado, hace dos cosas:
//   - defender: va a por los animales hostiles (lobos, osos) que andan cerca de la aldea, de día o de noche;
//   - cazar: si el jugador manda salir a cazar (b.hunt), va a por presas (conejos, ciervos, jabalíes, ovejas, uros) y trae carne (va al almacén como comida)
//     y pieles (las usa la sastrería para hacer ropa).
// Los hostiles también dan pieles al caer. Un cazador herido se retira.
//   colonist.spear  { left }  golpes que le quedan a su lanza
import { MOB_STATS, MOB_DROPS, isHostile, isHuntable } from './mobs.js';

export const LODGE = 'hunter_lodge';
export const SPEAR_LIFE = 40; // golpes que aguanta una lanza
export const HIT_EVERY = 1.1; // segundos entre un golpe y otro
export const HIT_RANGE = 2.3; // metros: lo que alcanza la lanza
export const DEFEND_RADIUS = 60; // metros de la aldea a los que un hostil mueve a los cazadores
export const DEFEND_NIGHT_RADIUS = 45; // de noche sólo salen por los que están más cerca
export const GAME_RADIUS = 90; // metros de la casa a los que se busca caza
export const RETREAT_HEALTH = 35; // con menos salud se retira
export const ARM_SECONDS = 3;

// La casa donde trabaja (si es de cazadores y está terminada).
export function lodgeOf(c) {
  const b = c.job;
  return b && b.done && !b.removed && b.def?.id === LODGE ? b : null;
}

export const lodges = (colony) => colony.buildings.filter((b) => b.def.id === LODGE && b.done && !b.removed);

// Daño de un golpe: crece con el nivel de Combate (1–10) y con la edad (mejores puntas).
export function spearDamage(colony, c) {
  const skill = colony.skillOf ? colony.skillOf(c, 'combat') : c.skills?.combat ?? 3;
  return 9 + skill + (colony.age >= 4 ? 4 : 0);
}

// ¿Debe ir a por una lanza al almacén?
export function spearWanted(colony, c) {
  return !!lodgeOf(c) && !c.spear && (colony.stock.spear ?? 0) >= 1;
}

export function equipSpear(colony, c) {
  if ((colony.stock.spear ?? 0) < 1) return false;
  colony.takeStock('spear', 1);
  c.spear = { left: SPEAR_LIFE };
  colony.emit?.('changed');
  return true;
}

// Cada golpe gasta un poco la lanza; al llegar a cero se rompe (con aviso).
export function useSpear(colony, c) {
  if (!c.spear) return;
  c.spear.left -= 1;
  if (c.spear.left > 0) return;
  c.spear = null;
  colony.emit?.('notice', `A ${c.name} se le rompió la lanza`);
  colony.emit?.('changed');
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// A qué animal debe ir este cazador ahora (o null): { mob, mode: 'defend' | 'game' }.
//   - un hostil cerca de la aldea o de él: defender (siempre, también de noche si está bastante cerca)
//   - si la casa tiene orden de cazar y es de día: la presa libre más cercana a la casa
export function huntTarget(colony, c, isNight) {
  const lodge = lodgeOf(c);
  if (!lodge || !c.spear || colony.absent) return null;
  let best = null;
  let bd = Infinity;
  const reach = isNight ? DEFEND_NIGHT_RADIUS : DEFEND_RADIUS;
  for (const m of colony.mobs) {
    if (!isHostile(m) || m.tamed) continue;
    const d = Math.min(Math.hypot(m.x, m.z), dist(m, lodge), dist(m, c));
    if (d > reach) continue;
    const dc = dist(m, c);
    if (dc < bd) {
      bd = dc;
      best = m;
    }
  }
  if (best) return { mob: best, mode: 'defend' };
  if (!lodge.hunt || isNight) return null;
  for (const m of colony.mobs) {
    if (!isHuntable(m) || dist(m, lodge) > GAME_RADIUS) continue;
    // Si otro cazador ya va a por ella, no.
    const other = m.huntedBy != null && m.huntedBy !== c.id ? colony.colonist(m.huntedBy) : null;
    if (other && other.task?.type === 'hunt' && other.task.mobId === m.id) continue;
    const d = dist(m, c);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best ? { mob: best, mode: 'game' } : null;
}

// Botín de un animal que cae (carne y pieles).
export const dropsOf = (m) => ({ ...(MOB_DROPS[m.type] ?? {}) });

// Resumen para la ficha de la casa.
export function lodgeReport(colony, b) {
  const crew = b.workers ?? [];
  return {
    hunters: crew.length,
    armed: crew.filter((c) => c.spear).length,
    spears: colony.stock.spear ?? 0,
    hostiles: colony.mobs.filter((m) => isHostile(m) && !m.tamed && Math.hypot(m.x, m.z) < DEFEND_RADIUS * 1.5).length,
    prey: colony.mobs.filter((m) => isHuntable(m) && dist(m, b) <= GAME_RADIUS).length,
  };
}

export { MOB_STATS };
