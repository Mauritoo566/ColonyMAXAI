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

const DAY = DAY_LENGTH_SECONDS;

// Urgencia de una necesidad: 0 si está llena, 1 si está vacía (crece rápido al final).
function urgency(value) {
  const u = Math.max(0, Math.min(1, (100 - value) / 100));
  return u * u;
}

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
    if (c.avoid && c.avoid.until > env.gameTime && c.avoid.key === taskKey(task)) return;
    options.push({ ...task, score });
  };
  const stock = colony.stock;
  const storage = colony.layout.storage;

  // Comer: bayas o setas cercanas, o las provisiones del almacén.
  if (n.food < 75) {
    const base = urgency(n.food) * 1.3 + (n.food < 45 ? 0.15 : 0);
    const bush = colony.nearestSpot('food', c.x, c.z, 200, env.gameTime);
    if (bush) add(base * distanceFactor(dist(c, bush)), { type: 'eat', source: 'bush', spot: bush });
    if (stock.food >= 1) add(base * distanceFactor(dist(c, storage)) * 1.05, { type: 'eat', source: 'stock' });
    // El pan sacia más que cualquier otra cosa: se prefiere si hay.
    if ((stock.bread ?? 0) >= 1) add(base * distanceFactor(dist(c, storage)) * 1.25, { type: 'eat', source: 'bread' });
  }

  // Beber: agua cercana, un pozo o el almacén.
  if (n.water < 75) {
    const base = urgency(n.water) * 1.4 + (n.water < 45 ? 0.15 : 0);
    const water = colony.waterSpot();
    if (water) add(base * distanceFactor(dist(c, water)), { type: 'drink', source: 'water', spot: water });
    for (const b of colony.buildings) {
      // Del recolector de lluvia sólo se bebe si tiene agua juntada.
      if (b.def.id === 'well' && b.done && (!levelOf(b).rainOnly || b.store >= 1)) add(base * distanceFactor(dist(c, b)) * 1.1, { type: 'drink', source: 'well', building: b });
    }
    if (stock.water >= 1) add(base * distanceFactor(dist(c, storage)), { type: 'drink', source: 'stock' });
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
  if (!c.clothed && colony.clothesLeft > 0 && n.warmth < 70) {
    add(urgency(n.warmth) * 1.35 + 0.18, { type: 'dress' });
  }

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
    const jobTier = c.job && c.job.done ? (tierOf(c.job.def.skill) >= 0 ? tierOf(c.job.def.skill) : c.jobAuto ? -1 : 3) : -1;
    const work = [];
    const addWork = (tier, score, task) => {
      if (tier >= 0) work.push({ tier, score, task });
    };
    for (const b of colony.buildings) {
      if (b.done || b.paused) continue;
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
    const stalled = job?.status && /Faltan materiales|Sin energ/i.test(job.status) && job.def.kind;
    if (job && job.done && !full && !stalled) addWork(jobTier, 0.34 * diligence * fine, { type: 'work', building: job, phase: 'start' });
    // Recolectar lo que el jugador marcó (herramienta de recolección): sólo la categoría de cada sitio.
    const marked = colony.nearestMarked(c.x, c.z, env.gameTime, (sp) => tierOf(spotCategory(sp, colony.age)) >= 0);
    if (marked) {
      const near = 1 / (1 + dist(c, marked) / 600);
      addWork(tierOf(spotCategory(marked, colony.age)), (job ? 0.5 : 0.56) * diligence * fine * near, { type: 'harvest', spot: marked, phase: 'going' });
    }
    // Las semillas de árbol que cayeron al talar las plantan los propios colonos en su tiempo
    // libre (no hay plantación manual): un lugar libre cerca de la aldea, sin pisar nada.
    if ((stock.tree_seed ?? 0) >= 1) {
      const spot = colony.plantSpotFor(c);
      if (spot) add(0.33 * diligence * fine * distanceFactor(dist(c, spot)), { type: 'plant', spot });
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
  if (r === 'stuck') task.failed = true;
  return r === 'arrived';
}

// Espera "seconds" trabajando; devuelve true al terminar.
function busy(task, dt, seconds) {
  task.timer = (task.timer || 0) + dt;
  return task.timer >= seconds;
}

export function runTask(colony, c, task, dt, env) {
  const n = c.needs;
  const stock = colony.stock;
  if (task.failed) return 'failed';

  switch (task.type) {
    case 'eat': {
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
        if (!go(colony, c, task, colony.layout.storage, dt, 1.6)) return 'running';
        if (!busy(task, dt, 5)) return 'running';
        colony.takeStock('bread', 1);
        n.food = Math.min(100, n.food + 80);
        return 'done';
      }
      if (stock.food < 1) return 'failed';
      if (!go(colony, c, task, colony.layout.storage, dt, 1.6)) return 'running';
      if (!busy(task, dt, 5)) return 'running';
      colony.takeStock('food', 1);
      n.food = Math.min(100, n.food + 55);
      return 'done';
    }

    case 'drink': {
      const point = task.source === 'water' ? task.spot : task.source === 'well' ? edgeOf(task.building, c) : colony.layout.storage;
      if (!go(colony, c, task, point, dt, 1.6)) return 'running';
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
      if (c.clothed || colony.clothesLeft <= 0) return 'done';
      if (!go(colony, c, task, colony.clothesSpot, dt, 1.1)) return 'running';
      colony.faceTowards(c, colony.clothesSpot.x, colony.clothesSpot.z, dt);
      if (!busy(task, dt, 5)) return 'running';
      return colony.takeClothes(c) ? 'done' : 'failed';
    }

    case 'warm': {
      if (!task.spot) {
        const a = Math.atan2(c.z, c.x) + (c.rand() - 0.5) * 0.6;
        task.spot = { x: Math.cos(a) * 3.3, z: Math.sin(a) * 3.3 };
      }
      if (!go(colony, c, task, task.spot, dt, 0.8)) return 'running';
      colony.faceTowards(c, 0, 0, dt);
      return n.warmth >= 88 ? 'done' : 'running';
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
      if (!go(colony, c, task, edgeOf(b, c), dt, 0.9)) return 'running';
      c.working = true;
      colony.faceTowards(c, b.x, b.z, dt);
      // Trabajo necesario según el edificio; los hábiles construyen más rápido.
      b.progress = Math.min(1, b.progress + (dt / (b.buildTime ?? b.def.buildTime)) * (0.5 + c.skills.building / 10));
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
      return colony.plantTreeSeed(task.spot.x, task.spot.z, env.gameTime) === null ? 'done' : 'failed';
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

// Punto del borde de un edificio del lado del colono.
function edgeOf(b, c) {
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
  // Con el almacén lleno no tiene sentido traer más: espera (y avisa en la ficha).
  if (colony.isFull(def.stock) && task.phase !== 'returning') {
    task.noResource = true;
    task.storeFull = true;
    b.status = `El almacén está lleno de ${STOCK_NAMES[def.stock]}: construye o mejora almacenes`;
    return busy(task, dt, 20) ? 'done' : 'running';
  }
  if (def.kind) return runStation(colony, c, task, dt, env);
  if (def.id === 'well') {
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
    if (!busy(task, dt, 60 * (1.4 - skill * 0.7))) return 'running';
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
      b.status = def.noResourceText;
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
    if (!busy(task, dt, def.workTime * (1.4 - skill * 0.7) * (isLitter(task.spot) ? 1.5 : 1))) return 'running';
    task.litter = isLitter(task.spot);
    colony.consumeSpot(task.spot, env.gameTime);
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
    const skill = c.skills[spotCategory(spot, colony.age)] / 10;
    if (!busy(task, dt, (spot.stick ? 8 : info.time) * (1.4 - skill * 0.7))) return 'running';
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
  // Lo que llevaba no se pierde ni se duplica: se entrega ahora en el almacén.
  if (task.type === 'harvest' && task.load && !task.delivered) {
    for (const [k, n] of Object.entries(task.load)) colony.produce(k, n);
    task.delivered = true;
  } else if (task.type === 'work' && task.phase === 'returning' && !task.delivered && task.building?.def.stock) {
    colony.produce(task.building.def.stock, task.litter ? task.building.def.scavenge.yield : levelOf(task.building).yield);
    task.delivered = true;
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
      if (task.source === 'bread') return walking ? 'Va a comer pan' : 'Comiendo pan';
      if (task.source === 'stock') return walking ? 'Va a comer de las provisiones' : 'Comiendo';
      return walking ? `Va a buscar ${task.spot.type === 'mushrooms' ? 'setas' : 'bayas'}` : `Comiendo ${task.spot.type === 'mushrooms' ? 'setas' : 'bayas'}`;
    case 'drink':
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
    case 'warm':
      return walking ? 'Va a calentarse al fuego' : 'Calentándose junto al fuego';
    case 'dress':
      return walking ? 'Tiene frío: va a buscar ropa' : 'Poniéndose ropa de pieles';
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
      if (task.storeFull) return 'Espera: el almacén está lleno';
      if (task.noResource) return def.id === 'well' ? 'Espera a que llueva' : def.noResourceText;
      if (def.id === 'well') {
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
      return task.source === 'bread' ? 'Fue a comer pan' : task.source === 'stock' ? 'Fue a comer de las provisiones' : `Fue a buscar ${task.spot.type === 'mushrooms' ? 'setas' : 'bayas'}`;
    case 'drink':
      return task.source === 'water' ? 'Fue a beber agua' : task.source === 'well' ? 'Fue a beber al pozo' : 'Bebió de las vasijas';
    case 'sleep':
      return 'Se fue a dormir';
    case 'warm':
      return 'Fue a calentarse junto al fuego';
    case 'love':
      return task.role === 'ask' ? `Fue a buscar a ${task.partner.name}` : `Aceptó ir a casa con ${task.partner.name}`;
    case 'dress':
      return 'Se vistió con ropa de pieles';
    case 'build':
      return `Ayudó a ${task.building.upgrading ? 'mejorar' : 'construir'}: ${task.building.name}`;
    case 'work':
      return `Trabajó en: ${task.building.name}`;
    case 'harvest':
      return `Recolectó ${HARVEST[task.spot.kind].noun} en una zona marcada`;
    case 'plant':
      return 'Plantó una semilla de árbol';
  }
  return null;
}
