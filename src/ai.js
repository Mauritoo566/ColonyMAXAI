// IA de los colonos ("IA de utilidad"): cada colono puntúa las acciones posibles según
// sus necesidades, sus rasgos, la hora y la distancia, y hace la que más le conviene.
// No hay una rutina fija: que coman, duerman de noche o se junten junto al fuego
// sale de sus necesidades.
//
// Una tarea es un objeto { type, ... } que runTask() ejecuta paso a paso. Tipos:
//   eat, drink, sleep, warm, chat, build, work, wander

import { hasTrait } from './needs.js';
import { levelOf, STOCK_NAMES } from './buildings.js';

const DAY = 360;

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
    const tent = pickTent(colony, c);
    add(score, { type: 'sleep', tent });
  }

  // Calentarse junto al fuego si tiene frío.
  if (n.warmth < 55) {
    add(urgency(n.warmth) * 1.25 + 0.05, { type: 'warm' });
  }

  // Charlar si está desanimado (según su carácter).
  if (n.mood < 60 && !env.isNight) {
    const partner = nearestAwake(colony, c);
    if (partner) {
      const social = hasTrait(c, 'sociable') ? 1.4 : hasTrait(c, 'loner') ? 0.25 : 1;
      add(urgency(n.mood) * 0.9 * social * distanceFactor(dist(c, partner)), { type: 'chat', partner });
    }
  }

  // Trabajo: construir obras y trabajar en su edificio, de día y con lo básico cubierto.
  if (!env.isNight) {
    const diligence = hasTrait(c, 'hardworking') ? 1.3 : hasTrait(c, 'lazy') ? 0.6 : 1;
    const fine = Math.min(n.food, n.water, n.rest, n.warmth) > 30 ? 1 : 0.4;
    for (const b of colony.buildings) {
      if (b.done) continue;
      const skill = c.skills.building / 10;
      add((0.3 + skill * 0.15) * diligence * fine * distanceFactor(dist(c, b)), { type: 'build', building: b });
    }
    const job = c.job;
    if (job && job.done) add(0.34 * diligence * fine, { type: 'work', building: job, phase: 'start' });
    // Recolectar lo que el jugador marcó: sobre todo quien no tiene trabajo fijo.
    const marked = colony.nearestMarked(c.x, c.z, env.gameTime);
    if (marked) add((job ? 0.3 : 0.38) * diligence * fine * distanceFactor(dist(c, marked)), { type: 'harvest', spot: marked, phase: 'going' });
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

function pickTent(colony, c) {
  // Cada colono tiene su tienda preferida (reparte a todos entre las tiendas).
  const tents = colony.layout.tents;
  return tents[c.id % tents.length];
}

export function taskKey(task) {
  const target = task.spot ? `${task.spot.x.toFixed(0)},${task.spot.z.toFixed(0)}` : task.building ? task.building.id : task.partner ? task.partner.id : '';
  return `${task.type}:${task.source ?? ''}:${target}`;
}

// ¿Conviene cambiar de tarea? Sólo si la nueva es bastante mejor (evita que dude).
export function shouldSwitch(current, next) {
  if (current.type === next.type && current.type !== 'build' && current.type !== 'eat') return false;
  if (current.type === 'sleep' && current.phase === 'sleeping') return next.score > current.score * 1.6 + 0.2;
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
        task.phase = 'sleeping';
      }
      // Recupera el descanso en un tercio de día.
      n.rest = Math.min(100, n.rest + (100 / (0.33 * DAY)) * dt);
      // Se levanta al estar descansado: de día con casi todo, de noche al llenarse del
      // todo (no se queda en la tienda con el descanso al 100 %).
      if (n.rest >= 99.5 || (n.rest >= 97 && !env.isNight)) {
        c.sleeping = false;
        return 'done';
      }
      return 'running';
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
      return b.done ? 'done' : 'running';
    }

    case 'work':
      return runWork(colony, c, task, dt, env);

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
    if (!busy(task, dt, 10)) return 'running';
    task.timer = 0;
    let water;
    if (level.rainOnly) {
      water = Math.min(Math.floor(b.store), level.yield);
      b.store -= water;
    } else {
      // Con lluvia el pozo se llena solo: rinde hasta el doble.
      water = level.yield * (1 + (colony.weather?.rain ?? 0));
    }
    water = colony.addStock('water', water);
    b.produced += water;
    b.status = null;
    return 'done';
  }

  if (task.phase === 'start') {
    task.spot = colony.nearestSpot(def.resource, b.x, b.z, def.range, env.gameTime);
    if (!task.spot && def.scavenge) {
      // Sin árboles o piedras grandes cerca: junta lo que hay suelto por el suelo (rinde
      // menos, pero no se queda sin hacer nada).
      for (let k = 0; k < 6 && !task.spot; k++) {
        const a = c.rand() * Math.PI * 2;
        const r = 8 + c.rand() * 20;
        const x = b.x + Math.cos(a) * r;
        const z = b.z + Math.sin(a) * r;
        if (colony.walkable(x, z, 0.8)) task.spot = { x, z, scavenge: true };
      }
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
    const scavenging = task.spot.scavenge;
    if (!busy(task, dt, def.workTime * (1.4 - skill * 0.7) * (scavenging ? 1.5 : 1))) return 'running';
    if (!scavenging) colony.consumeSpot(task.spot, env.gameTime);
    task.phase = 'returning';
  }
  if (task.phase === 'returning') {
    // Si en el almacén ya no cabe, lo lleva a la zona de acopio al aire libre.
    task.drop ??= colony.goesOutdoor(def.stock) && colony.zones.length ? colony.dropPoint(def.stock) : edgeOf(b, c);
    if (!go(colony, c, task, task.drop, dt, task.drop.r ? task.drop.r * 0.6 : 0.9)) return 'running';
    const amount = task.spot.scavenge ? def.scavenge.yield : level.yield;
    const added = colony.addStock(def.stock, amount);
    for (const [k, n] of Object.entries(def.extra || {})) colony.addStock(k, n);
    b.produced += added;
    if (!task.spot.scavenge) b.status = null;
    return 'done';
  }
  return 'running';
}

// Lo que da cada recurso natural recolectado a mano y cuánto se tarda.
const HARVEST = {
  food: { skill: 'gathering', time: 9, verb: 'Recogiendo', noun: 'comida' },
  wood: { skill: 'woodcutting', time: 16, verb: 'Talando', noun: 'madera' },
  stone: { skill: 'mining', time: 16, verb: 'Picando piedra', noun: 'piedra' },
};
const HARVEST_YIELD = { berryBush: { food: 3, fiber: 1 }, mushrooms: { food: 2 }, stone: { stone: 3 }, flint: { stone: 2 } };

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
    const skill = c.skills[info.skill] / 10;
    if (!busy(task, dt, info.time * (1.4 - skill * 0.7))) return 'running';
    task.load = harvestYield(spot);
    colony.consumeSpot(spot, env.gameTime);
    task.phase = 'returning';
  }
  if (task.phase === 'returning') {
    // Si bajo techo ya no cabe, lo deja en la zona de acopio al aire libre.
    task.drop ??= colony.dropPoint(spot.kind);
    if (!go(colony, c, task, task.drop, dt, task.drop.r ? task.drop.r * 0.6 : 1.6)) return 'running';
    for (const [k, n] of Object.entries(task.load)) colony.addStock(k, n);
    return 'done';
  }
  return 'running';
}

// Al abandonar una tarea (por otra más urgente), liberar lo que tenía reservado.
export function endTask(colony, c, task) {
  if (task.spot && task.spot.taken === c) task.spot.taken = null;
  if (task.type === 'sleep') c.sleeping = false;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

export function taskActivity(colony, c, task) {
  const walking = c.walking;
  switch (task.type) {
    case 'eat':
      if (task.source === 'stock') return walking ? 'Va a comer de las provisiones' : 'Comiendo';
      return walking ? `Va a buscar ${task.spot.type === 'mushrooms' ? 'setas' : 'bayas'}` : `Comiendo ${task.spot.type === 'mushrooms' ? 'setas' : 'bayas'}`;
    case 'drink':
      if (task.source === 'well') return walking ? 'Va a beber al pozo' : 'Bebiendo';
      if (task.source === 'stock') return walking ? 'Va a beber de las vasijas' : 'Bebiendo';
      return walking ? 'Va a beber agua' : 'Bebiendo agua';
    case 'sleep':
      return c.sleeping ? 'Durmiendo en la tienda' : 'Va a dormir';
    case 'warm':
      return walking ? 'Va a calentarse al fuego' : 'Calentándose junto al fuego';
    case 'chat':
      return walking ? `Va a charlar con ${task.partner.name}` : `Charlando con ${task.partner.name}`;
    case 'build':
      if (task.building.upgrading) return walking ? `Va a mejorar: ${task.building.name}` : `Mejorando: ${task.building.name}`;
      return walking ? `Va a construir: ${task.building.name}` : `Construyendo: ${task.building.name}`;
    case 'harvest': {
      const info = HARVEST[task.spot.kind];
      if (task.phase === 'going') return `Va a recolectar ${info.noun} marcada`;
      if (task.phase === 'gathering') return info.verb;
      return task.drop?.r ? `Lleva ${info.noun} a la zona al aire libre` : `Lleva ${info.noun} al almacén`;
    }
    case 'work': {
      const def = task.building.def;
      if (task.storeFull) return 'Espera: el almacén está lleno';
      if (task.noResource) return def.id === 'well' ? 'Espera a que llueva' : def.noResourceText;
      if (def.id === 'well') {
        if (levelOf(task.building).rainOnly) return walking ? 'Va al recolector de lluvia' : 'Vaciando las vasijas de lluvia';
        return walking ? 'Va al pozo' : 'Sacando agua del pozo';
      }
      if (task.spot?.scavenge && task.phase !== 'returning') return def.scavenge.text;
      if (task.phase === 'going') return def.goingText;
      if (task.phase === 'gathering') return def.workingText;
      if (task.drop?.r) return `Lleva ${STOCK_NAMES[def.stock]} a la zona al aire libre`;
      return def.returningText;
    }
    case 'wander':
      return walking ? 'Paseando' : 'Descansando un momento';
  }
  return '';
}

// Qué anotar en el registro al empezar una tarea (null = nada).
export function taskLog(c, task) {
  switch (task.type) {
    case 'eat':
      return task.source === 'stock' ? 'Fue a comer de las provisiones' : `Fue a buscar ${task.spot.type === 'mushrooms' ? 'setas' : 'bayas'}`;
    case 'drink':
      return task.source === 'water' ? 'Fue a beber agua' : task.source === 'well' ? 'Fue a beber al pozo' : 'Bebió de las vasijas';
    case 'sleep':
      return 'Se fue a dormir';
    case 'warm':
      return 'Fue a calentarse junto al fuego';
    case 'build':
      return `Ayudó a ${task.building.upgrading ? 'mejorar' : 'construir'}: ${task.building.name}`;
    case 'work':
      return `Trabajó en: ${task.building.name}`;
    case 'harvest':
      return `Recolectó ${HARVEST[task.spot.kind].noun} en una zona marcada`;
  }
  return null;
}
