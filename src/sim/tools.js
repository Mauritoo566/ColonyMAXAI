// Herramientas de los colonos (datos y cuentas, sin Three.js; la simulación y las pruebas lo usan igual).
// Desde la Edad del Bronce, trabajar con las manos desnudas es más lento. Cada colono lleva UNA herramienta (hacha, pico, azada, martillo…,
// según su oficio) hecha de bronce o de hierro: trabaja más rápido con ella, pero se desgasta con el uso y acaba rompiéndose. Las herramientas
// salen de los talleres como bienes (`bronze_tools`, `iron_tools`) y los colonos las recogen solos del almacén.
//   colonist.tool  { id, left }  id = bien del que está hecha · left = segundos de trabajo que le quedan
import { specOf, isWorker } from './specialties.js';

// Cada nivel es de su edad: no se usa antes de que llegue (aunque sobren en el almacén).
export const TOOL_GOODS = {
  bronze_tools: { tier: 1, age: 3, life: 1500, time: 0.85, label: 'de bronce' }, // 15 % menos de tiempo por tarea
  iron_tools: { tier: 2, age: 4, life: 4000, time: 0.7, label: 'de hierro' }, // 30 % menos
  instruments: { tier: 3, age: 7, life: 7000, time: 0.58, label: 'de precisión' },
  electronics: { tier: 4, age: 10, life: 12000, time: 0.45, label: 'eléctrica' },
};
export const TOOL_IDS = Object.keys(TOOL_GOODS);
export const TOOL_FROM_AGE = 3; // desde esta edad hay talleres de herramientas: sin ellas se trabaja peor
export const BARE_TIME = 1.25; // sin herramienta: 25 % más de tiempo por tarea
export const EQUIP_SECONDS = 4;
export const SWAP_STOCK = 2; // para cambiar una herramienta buena por otra mejor, deben quedar al menos dos en el almacén

// Habilidades que usan herramienta y cómo se llama la de cada una.
export const TOOL_SKILLS = {
  woodcutting: 'Hacha',
  mining: 'Pico',
  gathering: 'Cuchillo',
  building: 'Martillo',
  farming: 'Azada',
};
export const isToolSkill = (skill) => skill in TOOL_SKILLS;
export const toolLevel = (c) => (c.tool && TOOL_GOODS[c.tool.id] ? TOOL_GOODS[c.tool.id].tier : 0);
export const availableTools = (colony) => TOOL_IDS.filter((id) => colony.age >= TOOL_GOODS[id].age);

// Nombre de lo que lleva (o llevaría) para un oficio: "Hacha de hierro".
export function toolName(skill, id) {
  const g = TOOL_GOODS[id];
  return `${TOOL_SKILLS[skill] ?? 'Herramienta'} ${g?.label ?? ''}`.trim();
}

// ¿Se usa herramienta en esta edad? (antes no hay de dónde sacarlas)
export const toolsMatter = (colony) => colony.age >= TOOL_FROM_AGE;

// Multiplicador del tiempo de una tarea de esa habilidad: <1 más rápido, >1 más lento.
export function toolTime(colony, c, skill) {
  if (!isToolSkill(skill)) return 1;
  const g = c.tool && TOOL_GOODS[c.tool.id];
  if (g) return g.time;
  return toolsMatter(colony) ? BARE_TIME : 1;
}

// El trabajo desgasta la herramienta (se llama cada paso con lo que se está haciendo). Al llegar a cero se rompe.
export function wearTool(colony, c, skill, dt) {
  if (!c.tool || !isToolSkill(skill)) return;
  c.tool.left -= dt;
  if (c.tool.left > 0) return;
  const name = toolName(skill, c.tool.id).toLowerCase();
  c.tool = null;
  colony.toolsBroken = (colony.toolsBroken ?? 0) + 1;
  colony.emit?.('notice', `A ${c.name} se le rompió ${name.startsWith('azada') ? 'la' : 'el'} ${name}`);
  colony.emit?.('changed');
}

// El oficio que decide qué herramienta necesita: la de su puesto o, si no tiene, la primera de sus especialidades. null si no usa ninguna.
export function toolTrade(colony, c) {
  if (!isWorker(c)) return null;
  const job = c.job?.done ? c.job.def?.skill : null;
  if (job && isToolSkill(job)) return job;
  const first = specOf(colony, c)[0];
  return isToolSkill(first) ? first : null;
}

// La mejor herramienta de las que ya existen en esta edad y hay en el almacén (id del bien) o null.
export function bestInStock(colony) {
  return availableTools(colony).sort((a, b) => TOOL_GOODS[b].tier - TOOL_GOODS[a].tier).find((id) => (colony.stock[id] ?? 0) >= 1) ?? null;
}

// ¿Debe ir a por una herramienta? Devuelve el bien que cogería o null.
export function toolWanted(colony, c) {
  if (!toolsMatter(colony) || !toolTrade(colony, c)) return null;
  const best = bestInStock(colony);
  if (!best) return null;
  const have = toolLevel(c);
  if (!have) return best;
  if (TOOL_GOODS[best].tier > have && (colony.stock[best] ?? 0) >= SWAP_STOCK) return best;
  return null;
}

// Coge una herramienta del almacén. La que llevaba (si cambia por otra mejor) se desecha. Devuelve true si se equipó.
export function equipTool(colony, c, id) {
  if (!TOOL_GOODS[id] || (colony.stock[id] ?? 0) < 1) return false;
  colony.takeStock(id, 1);
  c.tool = { id, left: TOOL_GOODS[id].life };
  colony.emit?.('changed');
  return true;
}

// Por qué no lleva herramienta (para la ficha): null si no hace falta explicarlo.
export function toolNote(colony, c) {
  if (!toolsMatter(colony)) return 'Todavía no se fabrican herramientas: llegan con la Edad del Bronce.';
  const trade = toolTrade(colony, c);
  if (!trade) return 'Su oficio no usa herramienta.';
  if (c.tool) return null;
  return bestInStock(colony) ? 'Va a recoger una del almacén en cuanto pueda.' : 'No hay herramientas en el almacén: hay que fabricarlas en el taller.';
}
