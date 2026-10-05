// IA de los colonos ("IA de utilidad"): cada colono puntúa las acciones posibles según
// sus necesidades, sus rasgos, la hora y la distancia, y hace la que más le conviene.
// No hay una rutina fija: que coman, duerman de noche o se junten junto al fuego
// sale de sus necesidades.
//
// Una tarea es un objeto { type, ... } que runTask() ejecuta paso a paso. Tipos:
//   eat, drink, sleep, warm, chat, build, work, harvest, plant, wander

import { hasTrait } from './needs.js';
import { isChild, loveOptions, runLove, endLove, homeOf } from './sim/family.js';
import { levelOf, STOCK_NAMES } from './sim/buildingTypes.js';
import { DAY_LENGTH_SECONDS } from './daynight.js';
import { specOf, spotCategory, WORK_TYPES, waitReason } from './sim/specialties.js';
import { SPROUT_KEY } from './resourceGen.js';
import { stallReason } from './sim/economy.js';
import { abandonTarget, farSpot, nextJob, cemeteryStatus, plotSpot, nicheSpot, freePlot, freeNiche, urnWanted, placeUrnHome, isCemetery, BURY_SECONDS, EXHUME_SECONDS, URN_SECONDS, TAKE_SECONDS, PLACE_SECONDS, THINK_SECONDS } from './sim/cemetery.js';
import { TAME_SECONDS } from './sim/stable.js';
import { clothesWanted, dressFromStock, DRESS_SECONDS, tierName } from './sim/clothing.js';
import { toolTime, toolWanted, toolTrade, equipTool, toolName, EQUIP_SECONDS } from './sim/tools.js';
import { hallFor, hallOpen, mealSource, reserveSeat, releaseSeat, leaveHall, finishMeal, finishDrink, URGENT } from './sim/dining.js';

const DAY = DAY_LENGTH_SECONDS;

// Urgencia de una necesidad: 0 si está llena, 1 si está vacía (crece rápido al final).
function urgency(value) {
  const u = Math.max(0, Math.min(1, (100 - value) / 100));
  return u * u;
}

const RELAX_SECONDS = 25; // mínimo que se queda sentado junto al fuego antes de levantarse

// Penaliza lo lejano: a 150 m una acción vale la mitad.
function distanceFactor(d) {
  return 1 / (1 + d / 150);
}

function dist(c, p) {
  return Math.hypot(p.x - c.x, p.z - c.z);
}

// ---------------------------------------------------------------------------
// Obras: prioridad, constructores y estado
// ---------------------------------------------------------------------------

export const PRIORITY = { low: 0.55, normal: 1, high: 1.8 };
export const PRIORITY_NAMES = { low: 'Baja', normal: 'Normal', high: 'Alta' };
const ORDER_SITE_MAX = 6;

// Cuántos colonos tienen esa obra como tarea (en camino o trabajando).
export function builders(colony, b) {
  let n = 0;
  for (const c of colony.colonists) if (c.task?.type === 'build' && c.task.building === b) n++;
  return n;
}

function siteCap(b) {
  return b.priority === 'high' ? 5 : 3;
}

// ¿Puede este colono construir? (null = sí; si no, el motivo)
export function builderProblem(colony, c) {
  if ((c.growth ?? 1) < 1) return 'Es un niño';
  if (c.soldier) return 'Es soldado';
  return null;
}

// Estado de una obra para mostrarlo: { state, label, why }.
export function siteStatus(colony, b, isNight = false) {
  if (b.done) return null;
  const info = siteState(colony, b, isNight);
  info.ids = colony.colonists.filter((c) => c.task?.type === 'build' && c.task.building === b).map((c) => c.id);
  info.ordered = colony.colonists.filter((c) => c.order?.kind === 'build' && c.order.building === b.id).map((c) => c.id);
  return info;
}

function siteState(colony, b, isNight) {
  const verb = b.upgrading ? 'mejora' : 'obra';
  if (b.paused) return { state: 'paused', label: 'Pausada', why: `La ${verb} está pausada: nadie trabaja en ella hasta que la reanudes.` };
  let going = 0;
  let working = 0;
  for (const c of colony.colonists) {
    if (c.task?.type !== 'build' || c.task.building !== b) continue;
    if (c.working) working++;
    else going++;
  }
  if (working) return { state: 'building', label: `Construyendo (${working})`, why: `${working} colono${working > 1 ? 's' : ''} trabajando en ella.` };
  if (going) return { state: 'going', label: 'Constructores en camino', why: `${going} colono${going > 1 ? 's' : ''} va${going > 1 ? 'n' : ''} hacia la ${verb}.` };
  const adults = colony.colonists.filter((c) => !builderProblem(colony, c));
  if (!adults.length) return { state: 'blocked', label: 'Bloqueada', why: 'No hay colonos adultos que puedan construir (niños y soldados no construyen).' };
  if (isNight) return { state: 'waiting', label: 'Esperando constructor', why: 'Es de noche: los colonos descansan y construirán de día.' };
  if (b.priority === 'low') return { state: 'waiting', label: 'Esperando constructor', why: 'Prioridad baja: sólo la hacen los colonos que no tienen nada mejor. Sube la prioridad o asigna un constructor.' };
  if (adults.every((c) => c.task && c.task.type !== 'wander')) return { state: 'waiting', label: 'Esperando constructor', why: 'Todos los colonos están ocupados (necesidades, trabajo u otras obras). Sube la prioridad o asigna un constructor.' };
  return { state: 'waiting', label: 'Esperando constructor', why: 'Ningún colono libre la ha tomado todavía.' };
}

// ---------------------------------------------------------------------------
// Órdenes directas del jugador
// ---------------------------------------------------------------------------
// c.order = { kind: 'build', building: id } | { kind: 'harvest' }. Se guardan con la partida,
// se cumplen aunque sea de noche, y sólo las frena una necesidad crítica (la ficha lo dice).

// Motivo por el que no se puede dar esa orden (null = se puede).
export function orderProblem(colony, c, kind, building) {
  const why = builderProblem(colony, c);
  if (why) return `${c.name}: ${why.toLowerCase()}; no puede recibir esa orden.`;
  if (kind === 'build') {
    if (!building || building.removed || building.done) return 'Esa obra ya no existe o ya está terminada.';
    if (building.paused) return 'La obra está pausada: reanúdala primero.';
    const already = colony.colonists.filter((o) => o !== c && o.order?.kind === 'build' && o.order.building === building.id).length;
    if (already >= ORDER_SITE_MAX) return `Ya hay ${ORDER_SITE_MAX} constructores asignados a esa obra.`;
    return null;
  }
  if (kind === 'harvest') return colony.spots.some((s) => s.marked && !s.gone) ? null : 'No hay recursos marcados para recolectar.';
  return 'Orden desconocida.';
}

function orderTask(colony, c, env) {
  const o = c.order;
  if (!o) return null;
  if (o.kind === 'build') {
    const b = colony.building(o.building);
    if (!b || b.done || b.removed || b.paused) {
      colony.finishOrder(c, b && !b.removed && b.done ? 'terminó la obra' : 'la obra ya no está disponible');
      return null;
    }
    return { type: 'build', building: b, ordered: true };
  }
  if (o.kind === 'harvest') {
    const marked = colony.nearestMarked(c.x, c.z, env.gameTime);
    if (!marked) {
      colony.finishOrder(c, 'no queda nada marcado');
      return null;
    }
    return { type: 'harvest', spot: marked, phase: 'going', ordered: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Elegir
// ---------------------------------------------------------------------------

export function chooseTask(colony, c, env) {
  const n = c.needs;
  const options = [];
  const add = (score, task) => {
    if (score <= 0) return;
    // Lo que acaba de fallar (camino bloqueado, etc.) se evita un rato.
    // (si cambió algo en los muros desde entonces —un obstáculo nuevo o uno que se quitó—, se reintenta antes)
    if (c.avoid && c.avoid.until > env.gameTime && c.avoid.rev === colony.wallRev && c.avoid.key === taskKey(task)) return;
    options.push({ ...task, score });
  };
  const stock = colony.stock;
  const storage = colony.layout.storage;

  // Comer: bayas o setas cercanas, o las provisiones del almacén.
  if (n.food < 75) {
    const base = urgency(n.food) * 1.3 + (n.food < 45 ? 0.15 : 0);
    // Con un comedor en uso se come ahí: fuera (el almacén de la fogata, las bayas del monte) sólo si es urgente o si el comedor
    // no tiene nada que servir.
    const open = hallOpen(colony);
    const outside = !open || n.food < URGENT;
    const bush = !outside && mealSource(colony) ? null : colony.nearestSpot('food', c.x, c.z, 200, env.gameTime);
    if (bush) add(base * distanceFactor(dist(c, bush)), { type: 'eat', source: 'bush', spot: bush });
    if (stock.food >= 1 && outside) add(base * distanceFactor(dist(c, storage)) * 1.05, { type: 'eat', source: 'stock' });
    // El pan sacia más que cualquier otra cosa: se prefiere si hay.
    if ((stock.bread ?? 0) >= 1 && outside) add(base * distanceFactor(dist(c, storage)) * 1.25, { type: 'eat', source: 'bread' });
    // El comedor (si hay uno con plaza y algo que servir): se come dentro, sentado y a gusto; se prefiere a comer al aire libre.
    const hall = mealSource(colony) ? hallFor(colony, c) : null;
    if (hall) add(base * distanceFactor(dist(c, hall)) * 1.5, { type: 'eat', source: 'hall', building: hall });
  }

  // Beber: agua cercana, un pozo o el almacén.
  if (n.water < 75) {
    const base = urgency(n.water) * 1.4 + (n.water < 45 ? 0.15 : 0);
    // Con un comedor en uso se bebe ahí; el río, el pozo y el almacén de la fogata, sólo si es urgente o si no hay agua en el almacén.
    const open = hallOpen(colony);
    const outside = !open || n.water < URGENT;
    const outsideWater = outside || (stock.water ?? 0) < 1;
    const water = outsideWater ? colony.waterSpot() : null;
    if (water) add(base * distanceFactor(dist(c, water)), { type: 'drink', source: 'water', spot: water });
    for (const b of colony.buildings) {
      if (!outsideWater) break;
      // Del recolector de lluvia sólo se bebe si tiene agua juntada.
      if (b.def.id === 'well' && b.done && !b.accessIssue && (!levelOf(b).rainOnly || b.store >= 1)) add(base * distanceFactor(dist(c, b)) * 1.1, { type: 'drink', source: 'well', building: b });
    }
    if (stock.water >= 1 && outside) add(base * distanceFactor(dist(c, storage)), { type: 'drink', source: 'stock' });
    const dhall = stock.water >= 1 ? hallFor(colony, c) : null;
    if (dhall) add(base * distanceFactor(dist(c, dhall)) * 1.5, { type: 'drink', source: 'hall', building: dhall });
  }

  // Dormir: de noche con ganas, o de día sólo si está agotado.
  if (n.rest < 88) {
    let score = urgency(n.rest) * 1.2;
    if (env.isNight) score += n.rest < 80 ? 0.45 : 0.2;
    else if (n.rest > 30) score *= 0.3;
    if (hasTrait(c, 'lazy')) score *= 1.15;
    add(score, { type: 'sleep', tent: homeOf(colony, c) });
  }

  // Un animal hostil cerca: huye hacia la fogata (allí no se acercan).
  if (!c.soldier && colony.mobThreat?.(c)) add(1.6, { type: 'warm' });

  // Calentarse junto al fuego si tiene frío.
  if (n.warmth < 55) {
    add(urgency(n.warmth) * 1.25 + 0.05, { type: 'warm' });
  }
  // Sin ropa y con frío: ir a buscar ropa a la pila del campamento (abriga para siempre,
  // así que lo prefiere a la fogata). Si no tiene frío, no se molesta en ir.
  const garb = clothesWanted(colony, c);
  if (!c.clothed && garb?.source === 'pile' && n.warmth < 70) {
    add(urgency(n.warmth) * 1.35 + 0.18, { type: 'dress', source: 'pile' });
  } else if (garb?.source === 'stock') {
    // Con ropa del almacén: sin ropa y con frío corre; con ropa vieja o rota la renueva sin prisa (de día y con lo básico cubierto).
    if (!c.clothed && n.warmth < 70) add(urgency(n.warmth) * 1.35 + 0.2, { type: 'dress', source: 'stock' });
    else if (!env.isNight && Math.min(n.food, n.water, n.rest, n.warmth) > 35) add(c.clothed ? 0.4 : 0.55, { type: 'dress', source: 'stock' });
  }

  // Edades I y II (sin cementerio): un colono cualquiera carga a quien murió y lo deja lejos de la aldea. "Cualquiera": quien piensa justo ahora
  // y le da por ahí (la mayoría no), con lo básico cubierto y de día. El primero que va lo reserva.
  if (colony.age < 3 && !c.soldier && !isChild(c) && !env.isNight && Math.min(n.food, n.water, n.rest, n.warmth) > 35 && c.rand() < 0.4) {
    const body = abandonTarget(colony, c);
    if (body) add(0.5 / (1 + dist(c, body) / 120), { type: 'abandon', rec: body, phase: 'fetch' });
  }

  // Un caballo salvaje con orden de domesticar (el jugador ya pagó las manzanas): algún colono libre va a por él, de día y con lo básico cubierto.
  // El más cercano lo reserva y los demás no van.
  if (!c.soldier && !isChild(c) && !env.isNight && Math.min(n.food, n.water, n.rest, n.warmth) > 35) {
    const horse = colony.pendingTame(c);
    if (horse) add(0.6 / (1 + dist(c, horse) / 200), { type: 'tame', mobId: horse.id });
  }

  // Sin herramienta (o con una peor que la que hay en el almacén): pasa a recoger una, de día y con lo básico cubierto.
  if (!c.soldier && !isChild(c) && !env.isNight && Math.min(n.food, n.water, n.rest, n.warmth) > 35) {
    const good = toolWanted(colony, c);
    if (good) add(0.55 / (1 + dist(c, storage) / 300), { type: 'equip', good });
  }

  // Un jarrón de un ser querido en la estantería del cementerio: la familia puede querer llevárselo a casa. Lo piensa bien: sólo si tiene lo
  // básico cubierto, de día, tiene casa, y le dura la idea un buen rato (si se le pasa, no va).
  if (!c.soldier && !isChild(c) && !env.isNight && c.home != null && Math.min(n.food, n.water, n.rest, n.warmth) > 40) {
    const want = urnWanted(colony, c, env.gameTime);
    if (want) {
      if (c.urnThink?.id !== want.rec.id) c.urnThink = { id: want.rec.id, since: env.gameTime };
      if (env.gameTime - c.urnThink.since >= THINK_SECONDS) add(0.25 + want.longing * 0.5, { type: 'urn', rec: want.rec, phase: 'toDoor' });
    } else c.urnThink = null;
  } else c.urnThink = null;

  // Charlar si está desanimado (según su carácter).
  if (n.mood < 60 && !env.isNight) {
    const partner = nearestAwake(colony, c);
    if (partner) {
      const social = hasTrait(c, 'sociable') ? 1.4 : hasTrait(c, 'loner') ? 0.25 : 1;
      add(urgency(n.mood) * 0.9 * social * distanceFactor(dist(c, partner)), { type: 'chat', partner });
    }
  }

  // Estar con alguien (ganas, invitaciones): sólo los adultos, y a su manera.
  loveOptions(colony, c, env, add);

  // Los soldados montan guardia en torno a sus puestos (cuarteles, torres, fuertes) o al campamento.
  if (c.soldier && !env.isNight) add(0.3, { type: 'guard', phase: 'going' });

  // Orden directa del jugador: va antes que todo lo normal; sólo una necesidad crítica la frena.
  const order = orderTask(colony, c, env);
  if (order) add(0.95, order);

  // Trabajo: construir obras y trabajar en su edificio, de día y con lo básico cubierto
  // (los niños no trabajan: juegan, comen y duermen; los soldados montan guardia).
  if (!env.isNight && !isChild(c) && !c.soldier) {
    const diligence = hasTrait(c, 'hardworking') ? 1.3 : hasTrait(c, 'lazy') ? 0.6 : 1;
    const fine = Math.min(n.food, n.water, n.rest, n.warmth) > 30 ? 1 : 0.4;
    // Sólo se aceptan solos los trabajos de sus tres especialidades. Se busca en la primera; si no hay nada
    // realizable, en la segunda y luego en la tercera (los puestos que alguien eligió a mano valen como última).
    const spec = specOf(colony, c);
    const tierOf = (cat) => spec.indexOf(cat);
    // Un puesto que asignó el jugador a mano es una orden: manda sobre obras, recolección marcada y especialidades.
    const manualJob = !!(c.job && c.job.done && !c.jobAuto);
    const jobTier = manualJob ? 0 : c.job && c.job.done ? (tierOf(c.job.def.skill) >= 0 ? tierOf(c.job.def.skill) : c.jobAuto ? -1 : 3) : -1;
    const work = [];
    const addWork = (tier, score, task) => {
      if (tier >= 0) work.push({ tier, score, task });
    };
    for (const b of colony.buildings) {
      if (b.done || b.paused) continue;
      // Con un puesto asignado a mano sólo lo deja por una obra que el jugador marcó de prioridad alta.
      if (manualJob && b.priority !== 'high' && !(c.task?.type === 'build' && c.task.building === b)) continue;
      const skill = c.skills.building / 10;
      const mine = c.task?.type === 'build' && c.task.building === b;
      // Cuántos otros ya están en esa obra: se reparten entre las obras en vez de amontonarse.
      const others = builders(colony, b) - (mine ? 1 : 0);
      if (others >= siteCap(b) && !mine) continue;
      const crowd = 1 / (1 + 0.7 * others);
      // La prioridad de la obra manda entre obras; la baja sólo la hacen los que no tienen nada mejor.
      let score = (0.42 + skill * 0.12) * diligence * fine * (1 / (1 + dist(c, b) / 400)) * (PRIORITY[b.priority] ?? 1) * crowd;
      if (mine) score *= 1.15; // no cambia de obra por un empate
      addWork(tierOf('building'), score - b.id * 1e-5, { type: 'build', building: b });
    }
    const job = c.job;
    // Con el almacén lleno o sin materiales no se queda esperando: hace otra cosa y vuelve cuando se pueda.
    const full = job?.def.stock && colony.isFull(job.def.stock);
    // Sin materiales, sin sitio donde dejar lo que sale o sin energía: sigue con su siguiente trabajo y vuelve en cuanto se pueda.
    const stalled = !!(job?.def.kind && job.def.kind !== 'cemetery' && (stallReason(colony, job) || (job.status && /Sin energ/i.test(job.status))));
    // El enterrador sólo sale a trabajar si hay a quién enterrar o pasar a cenizas (si no, sigue con su siguiente trabajo).
    const idleGrave = !!(job && isCemetery(job) && !nextJob(colony, job, c, env.gameTime));
    if (job && job.done && !full && !stalled && !idleGrave) addWork(jobTier, (manualJob ? 0.62 : 0.34) * diligence * fine, { type: 'work', building: job, phase: 'start' });
    // Recolectar lo que el jugador marcó (herramienta de recolección): sólo la categoría de cada sitio.
    const marked = colony.nearestMarked(c.x, c.z, env.gameTime, (sp) => tierOf(spotCategory(sp, colony.age)) >= 0);
    if (marked) {
      const near = 1 / (1 + dist(c, marked) / 600);
      addWork(tierOf(spotCategory(marked, colony.age)), (job ? 0.5 : 0.56) * diligence * fine * near, { type: 'harvest', spot: marked, phase: 'going' });
    }
    // Las semillas de árbol que cayeron al talar las planta sólo el colono que trabaja en una Cabaña del leñador (o
    // mejor), dentro del radio de acción de su edificio y sin pisar edificios ni caminos. Nadie más planta.
    if ((stock.tree_seed ?? 0) >= 1 && job && job.done && !job.removed && job.def.replantFrom && job.level >= job.def.replantFrom) {
      const spot = colony.plantSpotFor(c, job);
      if (spot) addWork(jobTier, 0.37 * diligence * fine * distanceFactor(dist(c, spot)), { type: 'plant', spot, building: job });
    }
    if (work.length) {
      const best = Math.min(...work.map((w) => w.tier));
      for (const w of work) if (w.tier === best) add(w.score, w.task);
      c.idle = null;
    } else {
      c.idle = waitReason(colony, c);
    }
  }

  // Pasear: lo que hace cuando no necesita nada.
  add(0.07, { type: 'wander' });

  options.sort((a, b) => b.score - a.score);
  return options[0] || null;
}

function nearestAwake(colony, c) {
  let best = null;
  let bestD = 120;
  for (const o of colony.colonists) {
    if (o === c || o.sleeping) continue;
    const d = dist(c, o);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

export function taskKey(task) {
  const target = task.spot ? `${task.spot.x.toFixed(0)},${task.spot.z.toFixed(0)}` : task.building ? task.building.id : task.partner ? task.partner.id : '';
  return `${task.type}:${task.source ?? ''}:${target}`;
}

// ¿Conviene cambiar de tarea? Sólo si la nueva es bastante mejor (evita que dude).
export function shouldSwitch(current, next) {
  // Una orden directa sólo la interrumpe una necesidad crítica; y la orden vuelve a ganar después.
  if (current.ordered && !next.ordered) return next.score > 1.05;
  if (current.ordered && next.ordered) return current.type !== next.type || (current.building && current.building !== next.building);
  if (next.ordered) {
    const same = current.type === next.type && (current.building ?? current.spot) === (next.building ?? next.spot);
    if (same) current.ordered = true;
    return !same;
  }
  // Una acción de trabajo se mantiene hasta su punto seguro (cada unidad recogida, ciclo o tanda de obra); sólo la
  // interrumpen necesidades urgentes o peligro, no otra tarea de trabajo que aparezca.
  if (WORK_TYPES.has(current.type)) return next.score > 0.95;
  if (current.type === next.type && current.type !== 'build' && current.type !== 'eat') return false;
  if (current.type === 'sleep' && current.phase === 'sleeping') return next.score > current.score * 1.6 + 0.2;
  if (current.type === 'love' && current.phase === 'inside') return next.score > 1.1;
  return next.score > (current.score || 0) * 1.3 + 0.05;
}

// ---------------------------------------------------------------------------
// Ejecutar
// ---------------------------------------------------------------------------

// Camina hacia un punto; si queda atascado la tarea fracasa.
function go(colony, c, task, point, dt, stop = 0.8) {
  const r = colony.walk(c, point.x, point.z, dt, stop);
  if (r === 'stuck') {
    task.failed = true;
    task.failWhy = c.stuckWhy ?? 'No logra llegar a su destino';
  }
  return r === 'arrived';
}

// Fila en un punto compartido (almacén, pila de ropa, pozo): el primero llega hasta el punto y los demás esperan en fila detrás, a un paso de distancia
// unos de otros, en lugar de amontonarse. "from" es el centro de lo que se atiende: la fila se alarga hacia fuera de él. Devuelve true cuando el colono
// ya está en el punto y le toca. El orden es el de llegada; sólo cuenta quien sigue con esa tarea (lo demás se limpia solo).
const QUEUE_GAP = 0.95;
const ORIGIN = { x: 0, z: 0 }; // el centro del campamento
function lineUp(colony, c, task, key, anchor, from, dt, stop = 1.6) {
  colony.queues ??= new Map();
  let q = colony.queues.get(key);
  if (!q) colony.queues.set(key, (q = { ids: [], anchor: { x: anchor.x, z: anchor.z } }));
  q.ids = q.ids.filter((id) => colony.colonist(id)?.task?.queueKey === key);
  if (!q.ids.length) q.anchor = { x: anchor.x, z: anchor.z };
  task.queueKey = key;
  if (!q.ids.includes(c.id)) q.ids.push(c.id);
  const idx = q.ids.indexOf(c.id);
  if (idx === 0) return go(colony, c, task, q.anchor, dt, stop);
  // Hueco en la fila: hacia fuera del centro, cada vez más lejos del punto. Si ahí no se puede estar, espera donde esté (mirando al punto).
  const dx = q.anchor.x - from.x;
  const dz = q.anchor.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const d = stop + idx * QUEUE_GAP;
  const slot = { x: q.anchor.x + (dx / len) * d, z: q.anchor.z + (dz / len) * d };
  c.waitingTurn = true;
  if (colony.walkable(slot.x, slot.z, 0.3)) colony.walk(c, slot.x, slot.z, dt, 0.3);
  colony.faceTowards(c, q.anchor.x, q.anchor.z, dt);
  return false;
}

// Qué necesidad atiende cada tarea (para registrar qué le impide resolverla si la tarea falla).
export const NEED_OF_TASK = { eat: 'food', drink: 'water', sleep: 'rest', warm: 'warmth', dress: 'warmth' };

// Por qué falló una tarea, en palabras del jugador.
export function failReason(colony, c, task) {
  if (task.failWhy) return task.failWhy;
  switch (task.type) {
    case 'eat':
      return task.source === 'bush' ? 'Las bayas o setas ya no están o las ocupa otro' : 'Ya no quedan provisiones en el almacén';
    case 'drink':
      return task.source === 'well' ? 'El pozo está seco' : 'Ya no queda agua en el almacén';
    case 'dress':
      return task.source === 'stock' ? 'Ya no queda ropa en el almacén' : 'Ya no queda ropa en el campamento';
    default:
      return 'No pudo completarla';
  }
}

// Espera "seconds" trabajando; devuelve true al terminar.
function busy(task, dt, seconds) {
  task.timer = (task.timer || 0) + dt;
  return task.timer >= seconds;
}

// Comer o beber en el comedor: reserva plaza, va a la puerta, entra (dentro no se ve), come o bebe el tiempo que dura y sale.
function runHall(colony, c, task, dt, env, kind) {
  const b = task.building;
  if (!b || b.removed || !b.done) return 'failed';
  if (!task.seated) {
    if (!task.reserved) {
      if (!reserveSeat(colony, b, c)) {
        task.failWhy = 'El comedor está lleno';
        return 'failed';
      }
      task.reserved = true;
    }
    if (kind === 'eat' ? !mealSource(colony) : (colony.stock.water ?? 0) < 1) {
      task.failWhy = kind === 'eat' ? 'No queda comida en el almacén' : 'No queda agua en el almacén';
      return 'failed';
    }
    if (!go(colony, c, task, edgeOf(b, c), dt, 0.9)) return 'running';
    c.x = b.x;
    c.z = b.z;
    c.inside = true;
    task.seated = true;
    task.timer = 0;
  }
  c.inside = true;
  task.timer += dt;
  const meal = levelOf(b)?.mealTime ?? 12;
  if (task.timer < (kind === 'eat' ? meal : Math.min(6, meal * 0.5))) return 'running';
  const ok = kind === 'eat' ? finishMeal(colony, c, b, env.gameTime) : finishDrink(colony, c);
  leaveHall(c, b);
  if (!ok) task.failWhy = kind === 'eat' ? 'Se acabó la comida mientras comía' : 'Se acabó el agua mientras bebía';
  return ok ? 'done' : 'failed';
}

// Moverse en línea recta hasta un punto (dentro del recinto, donde las colisiones no valen); true al llegar.
function glide(colony, c, spot, dt, speed = 1.7) {
  const d = Math.hypot(spot.x - c.x, spot.z - c.z);
  colony.faceTowards(c, spot.x, spot.z, dt);
  if (d < 0.1) return true;
  const step = Math.min(d, speed * dt);
  c.x += ((spot.x - c.x) / d) * step;
  c.z += ((spot.z - c.z) / d) * step;
  c.walking = true;
  c.moveTick = true;
  return step >= d - 1e-6;
}

// El trabajo del enterrador: busca al muerto, lo carga y lo entierra; o pasa a cenizas a quien ya reposó y deja el jarrón en la estantería.
function runCemetery(colony, c, task, dt, env) {
  const b = task.building;
  const now = env.gameTime;
  if (!task.rec) {
    const job = nextJob(colony, b, c, now);
    if (!job) {
      b.status = cemeteryStatus(colony, b, now) ?? 'Nadie a quien enterrar por ahora';
      return 'done';
    }
    task.rec = job.rec;
    task.kind = job.kind;
    task.rec.claim = c.id;
    task.phase = job.kind === 'bury' ? 'fetch' : 'toDoor';
    task.timer = 0;
  }
  const rec = task.rec;
  const door = b.entrance?.approach ?? { x: b.x, z: b.z };
  if (task.kind === 'bury') {
    b.status = `Entierra a ${rec.name}`;
    if (task.phase === 'fetch') {
      if (rec.state !== 'ground') return 'done';
      if (!go(colony, c, task, rec, dt, 1.1)) return 'running';
      c.working = true;
      colony.faceTowards(c, rec.x, rec.z, dt);
      if (!busy(task, dt, 2.5)) return 'running';
      const plot = freePlot(colony, b);
      if (plot == null) return 'done'; // ya no hay tumba libre
      rec.state = 'carried';
      rec.carrier = c.id;
      rec.bid = b.id;
      rec.plot = plot;
      task.phase = 'toDoor';
      task.timer = 0;
    }
    if (task.phase === 'toDoor') {
      c.carrying = 'body';
      rec.x = c.x;
      rec.z = c.z;
      if (!go(colony, c, task, door, dt, 0.9)) return 'running';
      task.phase = 'inYard';
    }
    if (task.phase === 'inYard') {
      c.carrying = 'body';
      const spot = plotSpot(b, rec.plot);
      rec.x = c.x;
      rec.z = c.z;
      if (!glide(colony, c, spot, dt)) return 'running';
      task.phase = 'dig';
      task.timer = 0;
    }
    if (task.phase === 'dig') {
      c.working = true;
      if (!busy(task, dt, BURY_SECONDS)) return 'running';
      rec.state = 'grave';
      rec.buriedAt = now;
      rec.carrier = null;
      rec.claim = null;
      const p = plotSpot(b, rec.plot);
      rec.x = p.x;
      rec.z = p.z;
      c.carrying = null;
      colony.emit('notice', `${rec.name} fue enterrado en el cementerio`);
      colony.emit('changed');
      task.phase = 'out';
      return 'running';
    }
    if (task.phase === 'out') {
      if (!glide(colony, c, door, dt)) return 'running';
      return 'done';
    }
    return 'done';
  }
  // Pasar a cenizas.
  b.status = `Pasa a cenizas a ${rec.name}`;
  if (rec.state !== 'grave' || rec.bid !== b.id) return 'done';
  if (task.phase === 'toDoor') {
    if (!go(colony, c, task, door, dt, 0.9)) return 'running';
    task.phase = 'inYard';
  }
  if (task.phase === 'inYard') {
    if (!glide(colony, c, plotSpot(b, rec.plot), dt)) return 'running';
    task.phase = 'exhume';
    task.timer = 0;
  }
  if (task.phase === 'exhume') {
    c.working = true;
    if (!busy(task, dt, EXHUME_SECONDS)) return 'running';
    const niche = freeNiche(colony, b);
    if (niche == null) return 'done'; // sin hueco en la estantería: los restos siguen en su tumba
    rec.niche = niche; // reservado desde ahora
    task.phase = 'toShelf';
    task.timer = 0;
  }
  if (task.phase === 'toShelf') {
    c.carrying = 'urn';
    if (!glide(colony, c, nicheSpot(b, rec.niche), dt)) return 'running';
    task.phase = 'fill';
    task.timer = 0;
  }
  if (task.phase === 'fill') {
    c.carrying = 'urn';
    c.working = true;
    if (!busy(task, dt, URN_SECONDS)) return 'running';
    rec.state = 'shelf';
    rec.shelvedAt = now;
    rec.plot = null; // la tumba queda libre
    rec.claim = null;
    const n = nicheSpot(b, rec.niche);
    rec.x = n.x;
    rec.z = n.z;
    c.carrying = null;
    colony.emit('notice', `El jarrón de ${rec.name} está en la estantería del cementerio; su tumba queda libre`);
    colony.emit('changed');
    task.phase = 'out';
    return 'running';
  }
  if (task.phase === 'out') {
    if (!glide(colony, c, door, dt)) return 'running';
    return 'done';
  }
  return 'done';
}

// Antes del cementerio: un colono carga al muerto y lo deja bien lejos de la aldea.
function runAbandon(colony, c, task, dt, env) {
  const rec = task.rec;
  if (!rec) return 'done';
  if (!task.started) {
    if (rec.state !== 'ground' || (rec.claim != null && rec.claim !== c.id)) return 'done';
    rec.claim = c.id;
    task.started = true;
  }
  if (task.phase === 'fetch') {
    if (rec.state !== 'ground') return 'done';
    if (!go(colony, c, task, rec, dt, 1.1)) return 'running';
    c.working = true;
    colony.faceTowards(c, rec.x, rec.z, dt);
    if (!busy(task, dt, 2.5)) return 'running';
    rec.state = 'carried';
    rec.carrier = c.id;
    task.far = farSpot(colony, rec, c.rand);
    task.phase = 'carry';
    task.timer = 0;
  }
  if (task.phase === 'carry') {
    c.carrying = 'body';
    rec.x = c.x;
    rec.z = c.z;
    if (!go(colony, c, task, task.far, dt, 1.2)) return 'running';
    task.phase = 'drop';
    task.timer = 0;
  }
  if (task.phase === 'drop') {
    c.carrying = 'body';
    c.working = true;
    if (!busy(task, dt, 3)) return 'running';
    rec.state = 'abandoned';
    rec.carrier = null;
    rec.claim = null;
    rec.x = c.x;
    rec.z = c.z;
    c.carrying = null;
    task.delivered = true;
    colony.emit('notice', `${c.name} dejó el cuerpo de ${rec.name} lejos de la aldea`);
    colony.emit('changed');
    return 'done';
  }
  return 'done';
}

// Domesticar un caballo: va hasta él, lo gana con manzanas, se sube y lo lleva montado hasta su hueco junto al establo.
const RIDE_TIMEOUT = 150; // segundos: si no llega, se baja donde esté y el caballo sigue solo

function dismount(colony, c, horse) {
  if (!c.riding) return;
  c.riding = false;
  c.moving = false;
  c.walking = false;
  if (horse && horse.rider === c.id) horse.rider = null;
  const spot = colony.freeSpot(c.x + 1.2, c.z + 0.4);
  c.x = spot.x;
  c.z = spot.z;
}

function runTame(colony, c, task, dt, env) {
  const horse = colony.mobs.find((o) => o.id === task.mobId);
  if (task.phase === 'ride') {
    task.ride = (task.ride ?? 0) + dt;
    if (!horse || !horse.tamed || horse.rider !== c.id || task.ride > RIDE_TIMEOUT) return 'done';
    // El colono va encima: se mueve con el caballo.
    c.x = horse.x;
    c.z = horse.z;
    c.facing = horse.facing;
    c.moving = c.walking = c.moveTick = horse.state === 1;
    if (horse.state === 0 && Math.hypot(horse.x - (horse.stall?.x ?? horse.x), horse.z - (horse.stall?.z ?? horse.z)) < 1.2) return 'done';
    return 'running';
  }
  if (!horse || !horse.order || horse.tamed || (horse.order.by != null && horse.order.by !== c.id)) return 'done';
  horse.order.by = c.id;
  if (!go(colony, c, task, horse, dt, 1.6)) return 'running';
  colony.faceTowards(c, horse.x, horse.z, dt);
  c.working = true;
  if (!busy(task, dt, TAME_SECONDS)) return 'running';
  task.delivered = true;
  if (!colony.finishTame(horse, c)) return 'failed';
  // Se sube al caballo y lo lleva al establo.
  horse.rider = c.id;
  c.riding = true;
  c.working = false;
  task.phase = 'ride';
  return 'running';
}

// La familia se lleva a casa el jarrón de un ser querido: va al cementerio, lo coge de la estantería, lo lleva y lo deja en su casa.
function runUrn(colony, c, task, dt, env) {
  const rec = task.rec;
  const now = env.gameTime;
  const b = colony.building(rec?.bid);
  if (!rec || !b || b.removed) return 'done';
  const door = b.entrance?.approach ?? { x: b.x, z: b.z };
  if (!task.started) {
    if (rec.state !== 'shelf' || (rec.claim != null && rec.claim !== c.id)) return 'done';
    rec.claim = c.id;
    task.started = true;
  }
  if (task.phase === 'toDoor') {
    if (!go(colony, c, task, door, dt, 0.9)) return 'running';
    task.phase = 'inYard';
  }
  if (task.phase === 'inYard') {
    if (!glide(colony, c, nicheSpot(b, rec.niche ?? 0), dt)) return 'running';
    task.phase = 'take';
    task.timer = 0;
  }
  if (task.phase === 'take') {
    c.working = true;
    if (!busy(task, dt, TAKE_SECONDS)) return 'running';
    if (rec.state !== 'shelf') return 'done';
    rec.state = 'fetched';
    rec.carrier = c.id;
    task.phase = 'out';
  }
  if (task.phase === 'out') {
    c.carrying = 'urn';
    if (!glide(colony, c, door, dt)) return 'running';
    task.phase = 'home';
  }
  if (task.phase === 'home') {
    c.carrying = 'urn';
    const home = colony.building(c.home);
    if (!home || home.removed || !home.done) return 'failed'; // sin casa: el jarrón vuelve a la estantería (endTask)
    const at = home.entrance?.approach ?? { x: home.x, z: home.z };
    rec.x = c.x;
    rec.z = c.z;
    if (!go(colony, c, task, at, dt, 0.9)) return 'running';
    task.phase = 'place';
    task.timer = 0;
  }
  if (task.phase === 'place') {
    c.carrying = 'urn';
    c.working = true;
    if (!busy(task, dt, PLACE_SECONDS)) return 'running';
    placeUrnHome(colony, rec, c, now);
    c.carrying = null;
    task.delivered = true;
    colony.emit('notice', `${c.name} llevó a casa el jarrón de ${rec.name}`);
    colony.emit('changed');
    return 'done';
  }
  return 'done';
}

export function runTask(colony, c, task, dt, env) {
  const n = c.needs;
  const stock = colony.stock;
  if (task.failed) return 'failed';

  switch (task.type) {
    case 'eat': {
      if (task.source === 'hall') return runHall(colony, c, task, dt, env, 'eat');
      if (task.source === 'bush') {
        const spot = task.spot;
        if (spot.taken && spot.taken !== c) return 'failed';
        spot.taken = c;
        if (!go(colony, c, task, spot, dt, 1.4)) return task.failed ? release(spot) : 'running';
        c.working = true;
        colony.faceTowards(c, spot.x, spot.z, dt);
        if (!busy(task, dt, 8)) return 'running';
        n.food = Math.min(100, n.food + (spot.type === 'mushrooms' ? 35 : 45));
        colony.consumeSpot(spot, env.gameTime);
        return 'done';
      }
      if (task.source === 'bread') {
        if ((stock.bread ?? 0) < 1) return 'failed';
        if (!lineUp(colony, c, task, 'storage', colony.layout.storage, ORIGIN, dt)) return 'running';
        if (!busy(task, dt, 5)) return 'running';
        colony.takeStock('bread', 1);
        n.food = Math.min(100, n.food + 80);
        return 'done';
      }
      if (stock.food < 1) return 'failed';
      if (!lineUp(colony, c, task, 'storage', colony.layout.storage, ORIGIN, dt)) return 'running';
      if (!busy(task, dt, 5)) return 'running';
      colony.takeStock('food', 1);
      n.food = Math.min(100, n.food + 55);
      return 'done';
    }

    case 'drink': {
      if (task.source === 'hall') return runHall(colony, c, task, dt, env, 'drink');
      const queued = task.source === 'well' ? lineUp(colony, c, task, `well:${task.building.id}`, edgeOf(task.building, c), task.building, dt) : task.source === 'water' ? go(colony, c, task, task.spot, dt, 1.6) : lineUp(colony, c, task, 'storage', colony.layout.storage, ORIGIN, dt);
      if (!queued) return 'running';
      if (!busy(task, dt, 4)) return 'running';
      if (task.source === 'stock') {
        if (stock.water < 1) return 'failed';
        colony.takeStock('water', 1);
        n.water = Math.min(100, n.water + 60);
      } else if (task.source === 'well' && levelOf(task.building).rainOnly) {
        if (task.building.store < 1) return 'failed';
        task.building.store -= 1;
        n.water = Math.min(100, n.water + 60);
      } else {
        n.water = 100;
      }
      return 'done';
    }

    case 'sleep': {
      if (!c.sleeping) {
        if (!go(colony, c, task, task.tent.door, dt, 0.9)) return 'running';
        c.sleeping = true;
        c.outdoorSleep = !!task.tent.outdoor;
        task.phase = 'sleeping';
      }
      // Recupera el descanso en un tercio de día (a la intemperie, junto a la fogata, bastante peor).
      n.rest = Math.min(100, n.rest + (100 / (0.33 * DAY)) * (c.outdoorSleep ? 0.55 : 1) * dt);
      // Se levanta al estar descansado: de día con casi todo, de noche al llenarse del
      // todo (no se queda en la tienda con el descanso al 100 %).
      if (n.rest >= 99.5 || (n.rest >= 97 && !env.isNight)) {
        c.sleeping = false;
        return 'done';
      }
      return 'running';
    }

    case 'dress': {
      if (task.source === 'stock') {
        if (clothesWanted(colony, c)?.source !== 'stock') return 'done'; // ya no hace falta o no queda ropa
        const spot = colony.layout.storage;
        if (!lineUp(colony, c, task, 'storage', spot, ORIGIN, dt, 1.4)) return task.failed ? 'failed' : 'running';
        colony.faceTowards(c, spot.x, spot.z, dt);
        if (!busy(task, dt, DRESS_SECONDS)) return 'running';
        return dressFromStock(colony, c) ? 'done' : 'failed';
      }
      if (c.clothed || colony.clothesLeft <= 0) return 'done';
      if (!lineUp(colony, c, task, 'clothes-pile', colony.clothesSpot, ORIGIN, dt, 1.1)) return 'running';
      colony.faceTowards(c, colony.clothesSpot.x, colony.clothesSpot.z, dt);
      if (!busy(task, dt, 5)) return 'running';
      return colony.takeClothes(c) ? 'done' : 'failed';
    }

    case 'urn':
      return runUrn(colony, c, task, dt, env);

    case 'tame':
      return runTame(colony, c, task, dt, env);

    case 'equip': {
      if (toolWanted(colony, c) !== task.good) return 'done'; // ya no hace falta o se acabaron en el almacén
      if (!lineUp(colony, c, task, 'storage', colony.layout.storage, ORIGIN, dt, 1.4)) return task.failed ? 'failed' : 'running';
      colony.faceTowards(c, colony.layout.storage.x, colony.layout.storage.z, dt);
      if (!busy(task, dt, EQUIP_SECONDS)) return 'running';
      return equipTool(colony, c, task.good) ? 'done' : 'failed';
    }

    case 'abandon':
      return runAbandon(colony, c, task, dt, env);

    case 'warm': {
      if (task.seat === undefined) {
        // Se reparte alrededor de la fogata: un sitio libre en el suelo o en un tronco (endTask lo libera).
        task.seat = colony.pickSeat(c, task.badSeats);
        if (task.seat) task.spot = task.seat;
      }
      const seat = task.seat;
      if (!seat) {
        // Sin sitio libre: de pie junto al fuego, como antes.
        if (!task.spot) {
          const a = Math.atan2(c.z, c.x) + (c.rand() - 0.5) * 0.6;
          task.spot = { x: Math.cos(a) * 3.3, z: Math.sin(a) * 3.3 };
        }
        if (!go(colony, c, task, task.spot, dt, 0.8)) return 'running';
        colony.faceTowards(c, 0, 0, dt);
        return n.warmth >= 88 ? 'done' : 'running';
      }
      if (!task.seated) {
        if (!task.atApproach) {
          if (!go(colony, c, task, seat.approach, dt, 0.5)) {
            // No llega a ese sitio (tráfico u obstáculos): prueba con otro antes de rendirse.
            if (task.failed && (task.badSeats?.length ?? 0) < 3) {
              (task.badSeats ??= []).push(seat);
              seat.taken = null;
              task.failed = false;
              task.failWhy = undefined;
              task.seat = undefined;
              task.spot = undefined;
              c.progress = null;
              c.blocked = 0;
            }
            return 'running';
          }
          task.atApproach = true;
        }
        // Último tramo: se acomoda en el sitio (sobre el tronco no hay paso: se sube sin chocar).
        const d = Math.hypot(seat.x - c.x, seat.z - c.z);
        const step = 1.4 * dt;
        colony.faceTowards(c, 0, 0, dt);
        if (d > step) {
          c.x += ((seat.x - c.x) / d) * step;
          c.z += ((seat.z - c.z) / d) * step;
          c.walking = true;
          c.moveTick = true;
          return 'running';
        }
        c.x = seat.x;
        c.z = seat.z;
        task.seated = true;
      }
      c.sitting = seat.kind;
      colony.faceTowards(c, 0, 0, dt);
      // Sentado se queda a gusto: hasta estar caliente del todo y un rato más (no se levanta en cuanto sube del umbral para
      // volver a enfriarse enseguida). Una necesidad seria sí lo levanta: la tarea pasa a valer poco para shouldSwitch.
      task.relax = (task.relax ?? 0) + dt;
      task.score = Math.min(task.score ?? 0.5, 0.5);
      return n.warmth >= 99 && task.relax >= RELAX_SECONDS && !colony.mobThreat?.(c) ? 'done' : 'running';
    }

    case 'chat': {
      const p = task.partner;
      if (p.sleeping) return 'done';
      if (!go(colony, c, task, p, dt, 1.8)) return 'running';
      colony.faceTowards(c, p.x, p.z, dt);
      return busy(task, dt, 25) ? 'done' : 'running';
    }

    case 'build': {
      const b = task.building;
      if (b.done || b.removed) return 'done';
      if (!go(colony, c, task, buildSpot(colony, c, task, b), dt, 0.9)) return 'running';
      c.working = true;
      colony.faceTowards(c, b.x, b.z, dt);
      // Trabajo necesario según el edificio; los hábiles construyen más rápido.
      b.progress = Math.min(1, b.progress + ((dt / (b.buildTime ?? b.def.buildTime)) * (0.5 + c.skills.building / 10)) / toolTime(colony, c, 'building'));
      if (b.progress >= 1) b.finish?.(c);
      // Punto seguro cada 15 s de obra: ahí puede cambiar de tarea o de especialidad (sin dejar la obra a medias de golpe).
      task.worked = (task.worked ?? 0) + dt;
      return b.done || (task.worked >= 15 && !task.ordered) ? 'done' : 'running';
    }

    case 'love':
      return runLove(colony, c, task, dt, env, go);

    case 'guard': {
      if (!task.spot) {
        const posts = colony.buildings.filter((b) => b.done && (b.def.category === 'military' || b.def.category === 'defense'));
        const post = posts.length ? posts[Math.floor(c.rand() * posts.length)] : null;
        const a = c.rand() * Math.PI * 2;
        const base = post ?? { x: 0, z: 0, def: { footprint: 14 } };
        const r = (post ? post.def.footprint : 14) + 1.5 + c.rand() * 3;
        task.spot = { x: base.x + Math.cos(a) * r, z: base.z + Math.sin(a) * r };
        if (!colony.walkable(task.spot.x, task.spot.z, 0.8)) return 'failed';
      }
      if (!go(colony, c, task, task.spot, dt, 0.8)) return 'running';
      colony.faceTowards(c, task.spot.x * 2, task.spot.z * 2, dt);
      return busy(task, dt, 18 + c.rand() * 10) ? 'done' : 'running';
    }

    case 'work':
      return runWork(colony, c, task, dt, env);

    case 'plant': {
      if ((stock.tree_seed ?? 0) < 1) return 'done';
      if (!go(colony, c, task, task.spot, dt, 1)) return 'running';
      c.working = true;
      colony.faceTowards(c, task.spot.x, task.spot.z, dt);
      if (!busy(task, dt, 7)) return 'running';
      task.delivered = true;
      return colony.plantTreeSeed(task.spot.x, task.spot.z, env.gameTime, task.building) === null ? 'done' : 'failed';
    }

    case 'harvest':
      return runHarvest(colony, c, task, dt, env);

    case 'wander': {
      if (!task.target) {
        task.target = colony.pickWanderTarget(c);
        if (!task.target) return 'failed';
      }
      if (!task.arrived) {
        task.arrived = go(colony, c, task, task.target, dt, 0.6);
        return 'running';
      }
      task.wait ??= 3 + c.rand() * 6;
      return busy(task, dt, task.wait) ? 'done' : 'running';
    }
  }
  return 'failed';
}

// Ramas caídas y piedrecitas sueltas que aparecen junto a un edificio que se quedó sin recursos
// (ver spawnLitter): son recursos de verdad, pero rinden menos.
const isLitter = (spot) => spot?.key === SPROUT_KEY && (spot.type === 'sticks' || spot.type === 'pebbles');

function release(spot) {
  spot.taken = null;
  return 'failed';
}

// Dónde se acerca un colono a un edificio. Uno terminado se usa por su entrada (puerta o punto de trabajo,
// ver sim/access.js): nadie atraviesa las paredes ni entra por donde no hay puerta. Una obra, en cambio, se
// trabaja desde el lado por el que se llega.
// Puestos alrededor de una obra: los constructores la rodean y trabajan juntos, cada uno en su sitio, en vez de apiñarse en el mismo punto. Cada uno
// toma el hueco libre más alejado de los ya ocupados (el primero, el más cercano a por donde llega) y lo conserva mientras dure la obra.
const BUILD_SLOTS = 12;
function buildSpot(colony, c, task, b) {
  if (task.berth?.b === b) return task.berth.p;
  const r = (b.def.footprint ?? 3) + 0.9;
  const taken = new Set();
  for (const o of colony.colonists) if (o !== c && o.task?.type === 'build' && o.task.building === b && o.task.berth?.b === b) taken.add(o.task.berth.k);
  const want = Math.atan2(c.z - b.z, c.x - b.x);
  let best = null;
  let bd = Infinity;
  for (let k = 0; k < BUILD_SLOTS; k++) {
    const a = (k / BUILD_SLOTS) * Math.PI * 2;
    const p = { x: b.x + Math.cos(a) * r, z: b.z + Math.sin(a) * r };
    if (!colony.walkable(p.x, p.z, 0.35)) continue;
    const diff = Math.abs((((a - want + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
    // Cuanto más lejos del hueco ocupado más cercano, mejor (cuenta mucho); a igualdad, el más cercano a por donde llega.
    let gap = BUILD_SLOTS;
    for (const t of taken) gap = Math.min(gap, Math.abs(((k - t + BUILD_SLOTS * 1.5) % BUILD_SLOTS) - BUILD_SLOTS / 2));
    const free = taken.has(k) ? -20 : taken.size ? gap : 0;
    const score = diff - free * 2;
    if (score < bd) {
      bd = score;
      best = { b, k, p };
    }
  }
  if (!best) return edgeOf(b, c); // ningún hueco libre alrededor: como antes
  task.berth = best;
  return best.p;
}

function edgeOf(b, c) {
  if (b.done && b.entrance) return b.entrance.approach;
  const a = Math.atan2(c.z - b.z, c.x - b.x);
  const r = b.def.footprint + 0.9;
  return { x: b.x + Math.cos(a) * r, z: b.z + Math.sin(a) * r };
}

// Trabajo en un edificio: ir a por el recurso, recogerlo y llevarlo al edificio.
function runWork(colony, c, task, dt, env) {
  const b = task.building;
  if (!b.done || c.job !== b || b.removed) return 'done';
  const def = b.def;

  const level = levelOf(b);
  // Entrada bloqueada (partidas antiguas o algo que apareció después): no insiste, lo dice y espera.
  if (b.accessIssue && b.entrance) {
    task.noAccess = true;
    b.status = b.accessIssue;
    return busy(task, dt, 20) ? 'done' : 'running';
  }
  // Con el almacén lleno no tiene sentido traer más: espera (y avisa en la ficha).
  if (isCemetery(b)) return runCemetery(colony, c, task, dt, env);
  if (colony.isFull(def.stock) && task.phase !== 'returning' && task.phase !== 'hauling') {
    // No se queda parado esperando: termina la tarea y sigue con su siguiente trabajo (chooseTask no le ofrece éste mientras
    // el almacén esté lleno y se lo vuelve a ofrecer en cuanto haya sitio).
    task.noResource = true;
    task.storeFull = true;
    b.status = `El almacén está lleno de ${STOCK_NAMES[def.stock]}: construye o mejora almacenes`;
    colony.noteStoreFull(def.stock);
    return 'done';
  }
  if (def.kind) return runStation(colony, c, task, dt, env);
  if (def.id === 'well') {
    // Con un comedor en uso el agua no aparece sola en el almacén: el aguatero la lleva en jarras (todo el consumo es en el comedor).
    if (task.phase === 'hauling') {
      if (!go(colony, c, task, colony.layout.storage, dt, 1.6)) return 'running';
      const water = colony.produce('water', task.water);
      b.produced += water;
      task.delivered = true;
      b.status = null;
      return 'done';
    }
    // Recolector de lluvia: el aguatero vacía las vasijas en el almacén (si hay agua).
    if (level.rainOnly && b.store < 1) {
      task.noResource = true;
      b.status = 'Esperando lluvia: las vasijas están vacías';
      return busy(task, dt, 20) ? 'done' : 'running';
    }
    // El aguatero saca agua del pozo.
    if (!go(colony, c, task, edgeOf(b, c), dt, 0.9)) return 'running';
    c.working = true;
    colony.faceTowards(c, b.x, b.z, dt);
    // Sacar agua lleva su tiempo: cada nivel del pozo tiene el suyo (workTime).
    if (!busy(task, dt, level.workTime ?? 10)) return 'running';
    task.timer = 0;
    let water;
    if (level.rainOnly) {
      water = Math.min(Math.floor(b.store), level.yield);
      b.store -= water;
    } else {
      // Con lluvia el pozo se llena solo: rinde hasta el doble.
      water = level.yield * (1 + (colony.weather?.effectiveRain ?? 0));
    }
    if (hallOpen(colony)) {
      task.water = water;
      task.phase = 'hauling';
      b.status = null;
      return 'running';
    }
    water = colony.produce('water', water);
    b.produced += water;
    b.status = null;
    return 'done';
  }

  // Edificios de puesto fijo (pedrera, cantera): el colono trabaja junto a la estructura y produce solo,
  // "yield" unidades por minuto (más rápido si es hábil), sin salir a buscar recursos ni transportar.
  if (def.station) {
    if (!go(colony, c, task, edgeOf(b, c), dt, 0.9)) return 'running';
    c.working = true;
    colony.faceTowards(c, b.x, b.z, dt);
    b.status = null;
    const skill = c.skills[def.skill] / 10;
    if (!busy(task, dt, 60 * (1.4 - skill * 0.7) * toolTime(colony, c, def.skill))) return 'running';
    const added = colony.produce(def.stock, level.yield);
    b.produced += added;
    task.delivered = true;
    return 'done';
  }

  if (task.phase === 'start') {
    task.spot = colony.nearestSpot(def.resource, b.x, b.z, def.range, env.gameTime);
    if (!task.spot && def.scavenge) {
      // Sin árboles o piedras grandes cerca: aparecen ramas caídas o piedrecitas junto al edificio (se
      // ven y se consumen como cualquier recurso; rinden menos, pero no se queda sin hacer nada).
      task.spot = colony.spawnLitter(def.resource, b);
      if (task.spot) b.status = def.scavenge.status;
    }
    if (!task.spot) {
      task.noResource = true;
      b.status = level.noResourceText ?? def.noResourceText;
      return busy(task, dt, 20) ? 'done' : 'running';
    }
    task.spot.taken = c;
    task.phase = 'going';
  }
  if (task.phase === 'going') {
    if (!go(colony, c, task, task.spot, dt, 1.5)) return task.failed ? release(task.spot) : 'running';
    task.phase = 'gathering';
    task.timer = 0;
  }
  if (task.phase === 'gathering') {
    c.working = true;
    colony.faceTowards(c, task.spot.x, task.spot.z, dt);
    const skill = c.skills[def.skill] / 10;
    if (task.spot.gone) return release(task.spot); // alguien se llevó lo último: no se cobra dos veces
    if (!busy(task, dt, def.workTime * (1.4 - skill * 0.7) * (isLitter(task.spot) ? 1.5 : 1) * toolTime(colony, c, def.skill))) return 'running';
    task.litter = isLitter(task.spot);
    const felled = task.spot;
    colony.consumeSpot(felled, env.gameTime);
    // Un leñador de verdad replanta lo que tala (desde la Cabaña, nivel 2): nace un brote que tarda en crecer.
    if (def.replantFrom && b.level >= def.replantFrom && felled.tree && colony.replantAt(felled, env.gameTime)) b.replanted = (b.replanted ?? 0) + 1;
    task.phase = 'returning';
  }
  if (task.phase === 'returning') {
    // Si en el almacén ya no cabe, lo lleva a la zona de acopio al aire libre.
    task.drop ??= colony.goesOutdoor(def.stock) && colony.zones.length ? colony.dropPoint(def.stock) : edgeOf(b, c);
    if (!go(colony, c, task, task.drop, dt, task.drop.r ? task.drop.r * 0.6 : 0.9)) return 'running';
    const amount = task.litter ? def.scavenge.yield : level.yield;
    const added = colony.produce(def.stock, amount);
    for (const [k, n] of Object.entries(def.extra || {})) colony.produce(k, n);
    task.delivered = true;
    b.produced += added;
    if (!task.litter) b.status = null;
    return 'done';
  }
  return 'running';
}

// Talleres, minas, servicios y demás puestos: el trabajador va a su puesto y se queda allí; el
// avance (ciclos, energía, materiales) lo lleva el edificio (sim/economy.js).
function runStation(colony, c, task, dt, env) {
  const b = task.building;
  if (!b.done || c.job !== b || b.removed) return 'done';
  // Sin materiales o sin sitio donde dejar lo que sale: no se queda parado en el puesto, sigue con otro trabajo.
  if (stallReason(colony, b)) return 'done';
  if (!go(colony, c, task, edgeOf(b, c), dt, 0.9)) return 'running';
  c.working = !!b.operating || !!b.cycleActive;
  colony.faceTowards(c, b.x, b.z, dt);
  b.crewAt.set(c.id, env.gameTime);
  return 'running';
}

// Lo que da cada recurso natural recolectado a mano y cuánto se tarda.
const HARVEST = {
  food: { skill: 'gathering', time: 9, verb: 'Recogiendo', noun: 'comida' },
  wood: { skill: 'woodcutting', time: 16, verb: 'Recogiendo ramas y leña', noun: 'madera' },
  stone: { skill: 'mining', time: 16, verb: 'Recogiendo piedras sueltas', noun: 'piedra' },
};
const HARVEST_YIELD = { berryBush: { food: 3, fiber: 1 }, mushrooms: { food: 2 }, sticks: { wood: 2, fiber: 1 }, stone: { stone: 3 }, flint: { stone: 2 }, pebbles: { stone: 3 } };

function harvestYield(spot) {
  return HARVEST_YIELD[spot.type] ?? (spot.kind === 'wood' ? { wood: 4, fiber: 1 } : { [spot.kind]: 1 });
}

// Recolectar un recurso marcado: ir, recogerlo y llevarlo al almacén.
function runHarvest(colony, c, task, dt, env) {
  const spot = task.spot;
  const info = HARVEST[spot.kind];
  if (task.phase === 'going') {
    if (spot.gone || !spot.marked || (spot.taken && spot.taken !== c) || spot.readyAt > env.gameTime) return 'done';
    spot.taken = c;
    if (!go(colony, c, task, spot, dt, 1.5)) return task.failed ? release(spot) : 'running';
    task.phase = 'gathering';
    task.timer = 0;
  }
  if (task.phase === 'gathering') {
    c.working = true;
    colony.faceTowards(c, spot.x, spot.z, dt);
    const cat = spotCategory(spot, colony.age);
    const skill = c.skills[cat] / 10;
    if (!busy(task, dt, (spot.stick ? 8 : info.time) * (1.4 - skill * 0.7) * toolTime(colony, c, cat))) return 'running';
    task.load = harvestYield(spot);
    colony.consumeSpot(spot, env.gameTime);
    task.phase = 'returning';
  }
  if (task.phase === 'returning') {
    // Si bajo techo ya no cabe, lo deja en la zona de acopio al aire libre.
    task.drop ??= colony.dropPoint(spot.kind);
    if (!go(colony, c, task, task.drop, dt, task.drop.r ? task.drop.r * 0.6 : 1.6)) return 'running';
    for (const [k, n] of Object.entries(task.load)) colony.produce(k, n);
    task.delivered = true;
    return 'done';
  }
  return 'running';
}

// Al abandonar una tarea (por otra más urgente), liberar lo que tenía reservado.
export function endTask(colony, c, task) {
  if (task.spot && task.spot.taken === c) task.spot.taken = null;
  // Cementerio: lo que llevaba no se pierde ni se duplica. Un cuerpo a medio llevar queda donde esté; los restos siguen en su tumba;
  // un jarrón a medio llevar vuelve a su hueco (o, si ya no hay, se queda en la casa del familiar).
  if (task.rec && (task.type === 'work' || task.type === 'urn' || task.type === 'abandon') && task.rec.claim === c.id) {
    const rec = task.rec;
    if (rec.state === 'carried') {
      rec.state = 'ground';
      rec.carrier = null;
      rec.plot = null;
      rec.bid = null;
      rec.x = c.x;
      rec.z = c.z;
    } else if (rec.state === 'fetched') {
      const b = colony.building(rec.bid);
      const niche = b ? freeNiche(colony, b) : null;
      if (niche != null) {
        rec.state = 'shelf';
        rec.niche = niche;
        rec.carrier = null;
      } else if (c.home != null) placeUrnHome(colony, rec, c, colony.gameTime);
    } else if (rec.state === 'grave' && task.kind === 'cremate') rec.niche = null;
    rec.claim = null;
  }
  // Domesticando: si lo deja a medias, el caballo vuelve a esperar a otro colono (las manzanas ya están pagadas).
  if (task.type === 'tame') {
    const horse = colony.mobs.find((o) => o.id === task.mobId);
    if (!task.delivered && horse?.order?.by === c.id) horse.order.by = null;
    dismount(colony, c, horse); // si lo interrumpen, se baja del caballo donde esté
  }
  c.carrying = null;
  // Lo que llevaba no se pierde ni se duplica: se entrega ahora en el almacén.
  if (task.type === 'harvest' && task.load && !task.delivered) {
    for (const [k, n] of Object.entries(task.load)) colony.produce(k, n);
    task.delivered = true;
  } else if (task.type === 'work' && task.phase === 'hauling' && !task.delivered && task.water > 0) {
    // Las jarras que llevaba no se pierden: se dejan ahora en el almacén.
    task.building.produced += colony.produce('water', task.water);
    task.delivered = true;
  } else if (task.type === 'work' && task.phase === 'returning' && !task.delivered && task.building?.def.stock) {
    colony.produce(task.building.def.stock, task.litter ? task.building.def.scavenge.yield : levelOf(task.building).yield);
    task.delivered = true;
  }
  if ((task.type === 'eat' || task.type === 'drink') && task.source === 'hall') {
    releaseSeat(task.building, c);
    leaveHall(c, task.building);
  }
  if (task.type === 'sleep') c.sleeping = false;
  if (task.type === 'love') endLove(colony, c);
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

export function taskActivity(colony, c, task) {
  const walking = c.walking;
  switch (task.type) {
    case 'eat':
      if (task.source === 'hall') return c.inside ? 'Comiendo sentado en el comedor' : walking ? 'Va al comedor' : 'Entrando al comedor';
      if (task.source === 'bread') return walking ? 'Va a comer pan' : 'Comiendo pan';
      if (task.source === 'stock') return walking ? 'Va a comer de las provisiones' : 'Comiendo';
      return walking ? `Va a buscar ${task.spot.type === 'mushrooms' ? 'setas' : 'bayas'}` : `Comiendo ${task.spot.type === 'mushrooms' ? 'setas' : 'bayas'}`;
    case 'drink':
      if (task.source === 'hall') return c.inside ? 'Bebiendo sentado en el comedor' : walking ? 'Va al comedor a beber' : 'Entrando al comedor';
      if (task.source === 'well') return walking ? 'Va a beber al pozo' : 'Bebiendo';
      if (task.source === 'stock') return walking ? 'Va a beber de las vasijas' : 'Bebiendo';
      return walking ? 'Va a beber agua' : 'Bebiendo agua';
    case 'sleep':
      if (task.tent?.outdoor) return c.sleeping ? 'Durmiendo junto a la fogata (sin refugio)' : 'Va a dormir junto a la fogata';
      return c.sleeping ? 'Durmiendo en su refugio' : 'Va a dormir';
    case 'love':
      if (task.phase === 'inside') return `En casa con ${task.partner.name}`;
      if (task.phase === 'asking') return walking ? `Va a buscar a ${task.partner.name}` : `Le propone a ${task.partner.name} estar juntos`;
      if (task.phase === 'waiting') return `Espera la respuesta de ${task.partner.name}`;
      return walking ? `Va a casa con ${task.partner.name}` : `Espera a ${task.partner.name} en la puerta`;
    case 'guard':
      return walking ? 'Va a su puesto de guardia' : 'Montando guardia';
    case 'tame':
      return task.phase === 'ride' ? 'Lleva el caballo al establo montado' : walking ? 'Va a domesticar un caballo' : 'Domesticando un caballo con manzanas';
    case 'abandon':
      return task.phase === 'fetch' ? `Va a por el cuerpo de ${task.rec.name}` : task.phase === 'drop' ? `Deja el cuerpo de ${task.rec.name} lejos de la aldea` : `Lleva el cuerpo de ${task.rec.name} lejos de la aldea`;
    case 'urn':
      if (task.phase === 'home' || task.phase === 'place') return task.phase === 'place' ? `Deja en casa el jarrón de ${task.rec.name}` : `Lleva a casa el jarrón de ${task.rec.name}`;
      return task.phase === 'take' ? `Coge el jarrón de ${task.rec.name}` : `Va a por el jarrón de ${task.rec.name}`;
    case 'warm':
      if (walking) return 'Va a calentarse al fuego';
      return c.sitting === 'bench' ? 'Sentado en un tronco, calentándose' : c.sitting === 'ground' ? 'Sentado junto al fuego, calentándose' : 'Calentándose junto al fuego';
    case 'dress':
      if (task.source === 'stock') return walking ? (c.clothed ? 'Va al almacén a cambiar su ropa' : 'Va al almacén a por ropa') : `Poniéndose ropa de ${tierName(colony.age)}`;
      return walking ? 'Tiene frío: va a buscar ropa' : 'Poniéndose ropa de pieles';
    case 'equip': {
      const name = toolName(toolTrade(colony, c) ?? 'building', task.good).toLowerCase();
      return walking ? `Va al almacén a por ${name}` : `Cogiendo ${name} del almacén`;
    }
    case 'chat':
      return walking ? `Va a charlar con ${task.partner.name}` : `Charlando con ${task.partner.name}`;
    case 'build':
      if (task.building.upgrading) return walking ? `Va a mejorar: ${task.building.name}` : `Mejorando: ${task.building.name}`;
      return walking ? `Va a construir: ${task.building.name}` : `Construyendo: ${task.building.name}`;
    case 'harvest': {
      const info = HARVEST[task.spot.kind];
      if (task.phase === 'going') return task.spot.stick ? 'Va a recoger palos y ramas marcados' : `Va a recolectar ${info.noun} marcada`;
      if (task.phase === 'gathering') return task.spot.tree ? 'Talando un árbol' : task.spot.stick ? 'Recogiendo palos y ramas del suelo' : info.verb;
      return task.drop?.r ? `Lleva ${info.noun} a la zona al aire libre` : `Lleva ${info.noun} al almacén`;
    }
    case 'work': {
      const def = task.building.def;
      if (def.kind) return task.building.status ?? (walking ? `Va a su puesto: ${task.building.name}` : `Trabajando en: ${task.building.name}`);
      if (task.noAccess) return 'Espera: la entrada de su puesto está bloqueada';
      if (task.storeFull) return 'Espera: el almacén está lleno';
      if (task.noResource) return def.id === 'well' ? 'Espera a que llueva' : (levelOf(task.building).noResourceText ?? def.noResourceText);
      if (def.id === 'well') {
        if (task.phase === 'hauling') return walking ? 'Lleva jarras de agua al almacén' : 'Deja las jarras en el almacén';
        if (levelOf(task.building).rainOnly) return walking ? 'Va al recolector de lluvia' : 'Vaciando las vasijas de lluvia';
        return walking ? 'Va al pozo' : 'Sacando agua del pozo';
      }
      if (isLitter(task.spot) && task.phase !== 'returning') return def.scavenge.text;
      if (task.phase === 'going') return def.goingText;
      if (task.phase === 'gathering') return def.workingText;
      if (task.drop?.r) return `Lleva ${STOCK_NAMES[def.stock]} a la zona al aire libre`;
      return def.returningText;
    }
    case 'plant':
      return walking ? 'Va a plantar una semilla de árbol' : 'Plantando una semilla de árbol';
    case 'wander':
      return walking ? 'Paseando' : 'Descansando un momento';
  }
  return '';
}

// Qué anotar en el registro al empezar una tarea (null = nada).
export function taskLog(c, task) {
  switch (task.type) {
    case 'eat':
      if (task.source === 'hall') return 'Comió a gusto en el comedor';
      return task.source === 'bread' ? 'Fue a comer pan' : task.source === 'stock' ? 'Fue a comer de las provisiones' : `Fue a buscar ${task.spot.type === 'mushrooms' ? 'setas' : 'bayas'}`;
    case 'drink':
      if (task.source === 'hall') return 'Bebió en el comedor';
      return task.source === 'water' ? 'Fue a beber agua' : task.source === 'well' ? 'Fue a beber al pozo' : 'Bebió de las vasijas';
    case 'sleep':
      return 'Se fue a dormir';
    case 'warm':
      return 'Fue a calentarse junto al fuego';
    case 'love':
      return task.role === 'ask' ? `Fue a buscar a ${task.partner.name}` : `Aceptó ir a casa con ${task.partner.name}`;
    case 'dress':
      return task.source === 'stock' ? 'Se puso ropa nueva del almacén' : 'Se vistió con ropa de pieles';
    case 'equip':
      return 'Recogió una herramienta del almacén';
    case 'build':
      return `Ayudó a ${task.building.upgrading ? 'mejorar' : 'construir'}: ${task.building.name}`;
    case 'work':
      return `Trabajó en: ${task.building.name}`;
    case 'harvest':
      return `Recolectó ${HARVEST[task.spot.kind].noun} en una zona marcada`;
    case 'plant':
      return 'Plantó una semilla de árbol';
    case 'tame':
      return 'Fue a domesticar un caballo';
  }
  return null;
}
