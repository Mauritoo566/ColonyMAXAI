// Correr: un colono camina a su paso, pero si de verdad lo necesita, corre. Correr cuesta: se cansa mucho más (y suda: tiene
// más sed), así que sólo lo hace cuando le compensa y puede, y piensa antes de empezar (distancia, cansancio, rasgos). Con miedo
// corre aunque ya esté cansado, hasta quedar sin aliento. Datos y reglas puras (sin Three.js ni DOM).

import { hasTrait } from '../needs.js';
import { huntedDistance } from './mobs.js';

export const RUN_FACTOR = 1.7; // velocidad al correr frente a caminar
export const FEAR_DISTANCE = 22; // metros a un animal que lo está cazando a partir de los cuales hay miedo de verdad
const FEAR_KEEP = 28; // y deja de tenerlo al alejarse de esto (histéresis: no empieza y para a cada paso)
const START_REST = 30; // para echar a correr por una necesidad hace falta estar descansado
const KEEP_REST = 14; // y se sigue corriendo hasta quedarse con esto
const FEAR_REST = 6; // con miedo se corre hasta casi caer rendido
const WINDED_SECONDS = 25; // sin aliento: tras quedar exhausto, un rato sin poder correr
const START_FAR = 10; // sólo vale la pena correr si falta más que esto
const KEEP_FAR = 4;

// Necesidad crítica que explica la tarea (null si no es crítica): texto del motivo.
function criticalNeed(c, task) {
  const n = c.needs;
  const lazy = hasTrait(c, 'lazy') ? 0.7 : 1; // el perezoso lo piensa más: sólo con la necesidad más extrema
  if (task.type === 'eat' && n.food < 15 * lazy) return 'tiene mucha hambre';
  if (task.type === 'drink' && n.water < 12 * lazy) return 'tiene mucha sed';
  if ((task.type === 'warm' || task.type === 'dress') && n.warmth < 15 * lazy) return 'está helado';
  return null;
}

// ¿Echa a correr (o sigue corriendo)? Devuelve el motivo, o null si camina. Mira el estado de ahora; se llama cada paso.
export function decideRun(colony, c, env) {
  const task = c.task;
  const going = c.progress; // lo fija walk(): adónde va
  if (!task || !going || c.sleeping || c.inside) return null;
  if (c.windedUntil > env.gameTime) return null; // sin aliento
  const rest = c.needs.rest;
  const running = !!c.running;
  const remaining = Math.hypot(going.tx - c.x, going.tz - c.z);
  if (remaining < (running ? KEEP_FAR : START_FAR) * (running ? 1 : 0.6)) return null; // para llegar a pocos pasos no compensa

  // Miedo con razón: un animal que de verdad lo está cazando ahora (no uno que pasea). Corre aunque esté cansado; los soldados
  // no se asustan así.
  if (!c.soldier) {
    const d = huntedDistance(colony, c);
    if (d < (running ? FEAR_KEEP : FEAR_DISTANCE)) {
      if (rest > FEAR_REST) return 'tiene miedo';
      c.windedUntil = env.gameTime + WINDED_SECONDS;
      return null;
    }
  }
  // Necesidad urgente: corre si le queda fuerza y el camino es largo; si no, sigue caminando.
  const why = criticalNeed(c, task);
  if (!why) return null;
  const hurt = c.health < 35 ? 8 : 0; // herido y necesitado: se juega más
  if (rest > (running ? KEEP_REST : START_REST) - hurt) return why;
  if (running) c.windedUntil = env.gameTime + WINDED_SECONDS;
  return null;
}
