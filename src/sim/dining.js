// Comedor: los colonos entran, se sientan dentro y comen y beben con lo que haya en el almacén de la colonia (está
// conectado a él: no hay que llevar nada). Cada comida da bienestar. Con un comedor en uso todo el consumo es ahí (comer y
// beber fuera queda sólo para emergencias) y el aguatero lleva el agua en jarras hasta el almacén. Datos y reglas puras (sin Three.js ni DOM): las usan la IA de los
// colonos, la interfaz y las pruebas. Estado en el edificio: b.diners (quienes tienen plaza reservada).

import { levelOf } from './buildingTypes.js';
import { addMoodEvent } from '../needs.js';

export const FOOD_MEAL = 65; // comida que repone un plato de las provisiones
export const BREAD_MEAL = 90; // y uno de pan (sacia más)
export const DRINK = 60; // sed que repone un trago de agua del almacén
export const URGENT = 25; // por debajo de esto (comida o agua) se acepta comer o beber fuera si hace falta

export const isHall = (b) => b.def.id === 'dining_hall';

// Plazas ocupadas: los que la reservaron y siguen vivos con esa comida en curso (nadie se queda con una plaza "fantasma").
export function diners(colony, b) {
  b.diners = (b.diners ?? []).filter((c) => colony.colonists.includes(c) && c.task?.source === 'hall' && c.task.building === b);
  return b.diners;
}

export const seatsOf = (b) => levelOf(b)?.seats ?? 0;

// Cuántos están comiendo dentro ahora (los que ya entraron).
export const eatingNow = (colony, b) => colony.colonists.filter((c) => c.inside && c.task?.source === 'hall' && c.task.building === b).length;

// ¿Hay un comedor terminado y con la entrada libre? Entonces el consumo es ahí y el aguatero lleva el agua al almacén.
export const hallOpen = (colony) => colony.buildings.some((b) => isHall(b) && b.done && !b.removed && !b.accessIssue);

// El comedor terminado y con plaza libre más cercano (null si no hay ninguno o tiene la entrada bloqueada).
export function hallFor(colony, c) {
  let best = null;
  let bestD = Infinity;
  for (const b of colony.buildings) {
    if (!isHall(b) || !b.done || b.removed || b.accessIssue) continue;
    const list = diners(colony, b);
    if (list.length >= seatsOf(b) && !list.includes(c)) continue;
    const d = Math.hypot(b.x - c.x, b.z - c.z);
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

export function reserveSeat(colony, b, c) {
  const list = diners(colony, b);
  if (list.includes(c)) return true;
  if (list.length >= seatsOf(b)) return false;
  list.push(c);
  return true;
}

export function releaseSeat(b, c) {
  if (b?.diners) b.diners = b.diners.filter((o) => o !== c);
}

// Qué se sirve: pan si hay (sacia más), si no las provisiones; null si no queda nada.
export const mealSource = (colony) => ((colony.stock.bread ?? 0) >= 1 ? 'bread' : (colony.stock.food ?? 0) >= 1 ? 'food' : null);

// Sale por la puerta (donde espera quien llega).
export function leaveHall(c, b) {
  if (!c.inside) return;
  c.inside = false;
  const door = b?.entrance?.approach ?? { x: b?.x ?? c.x, z: b?.z ?? c.z };
  c.x = door.x;
  c.z = door.z;
}

// Termina de comer: gasta el plato del almacén, repone comida y da bienestar. Si tiene sed, bebe con la comida (un trago
// del agua del almacén). Devuelve false si ya no quedaba nada.
export function finishMeal(colony, c, b, gameTime) {
  const src = mealSource(colony);
  if (!src) return false;
  colony.takeStock(src, 1);
  c.needs.food = Math.min(100, c.needs.food + (src === 'bread' ? BREAD_MEAL : FOOD_MEAL));
  if (c.needs.water < 85 && (colony.stock.water ?? 0) >= 1) {
    colony.takeStock('water', 1);
    c.needs.water = Math.min(100, c.needs.water + DRINK * 0.75);
  }
  addMoodEvent(c, 'meal', levelOf(b)?.mood ?? 8, gameTime);
  return true;
}

// Termina de beber en el comedor. Devuelve false si ya no quedaba agua.
export function finishDrink(colony, c) {
  if ((colony.stock.water ?? 0) < 1) return false;
  colony.takeStock('water', 1);
  c.needs.water = Math.min(100, c.needs.water + DRINK);
  return true;
}
