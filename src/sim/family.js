// Familia y población: viviendas, el deseo de tener pareja, el embarazo, el nacimiento y
// el crecimiento de los niños. Datos puros (sin Three.js ni DOM), igual que el resto de la
// simulación. Nada de esto está programado como un horario: cada colono siente ganas
// (según su bienestar y su carácter), elige a quién invitar, el otro decide si acepta, y
// si ambos quieren van juntos a su casa. Lo único fijo son las reglas del cuerpo (cuánto
// dura un embarazo, cuánto tarda un niño en crecer) y el tope de población.

import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { levelOf } from './buildingTypes.js';
import { createChildProfile, wellbeing, hasTrait, addLog } from '../needs.js';
import { appearanceFromGenes } from '../genes.js';
import { pickName } from './names.js';

const DAY = DAY_LENGTH_SECONDS;

export const BASE_MAX_POPULATION = 10; // lo que admite el campamento solo
export const CHILD_SECONDS = 3 * DAY; // un niño tarda tres días en ser adulto
export const PREGNANCY_SECONDS = 1.2 * DAY;
export const LOVE_SECONDS = 30; // lo que pasan juntos dentro de la casa
const DESIRE_FULL_SECONDS = 3 * DAY; // con buen bienestar, ganas al máximo en ~tres días
const INVITE_SECONDS = 30;
const SHIRTS = ['#8a5a34', '#a0764a', '#b8905a', '#7a5230', '#9a6a3e', '#c2a06a'];
const PANTS = ['#5a3a22', '#6b4a2e', '#4a3220', '#7a5a3a'];

export const isChild = (c) => (c.growth ?? 1) < 1;
export const isAdult = (c) => !isChild(c);

// ---- Viviendas y población máxima -------------------------------------------------------

// Una vivienda sirve mientras está terminada o en mejora (conserva su nivel anterior).
const usable = (b) => b.def.id === 'house' && (b.done || b.upgrading);

// Máximo de colonos: el campamento admite 10 y cada vivienda terminada suma lo suyo.
export function maxPopulation(colony) {
  let max = BASE_MAX_POPULATION;
  for (const b of colony.buildings) if (usable(b)) max += levelOf(b).housing;
  return max;
}

export function pregnantCount(colony) {
  return colony.colonists.filter((c) => c.pregnant).length;
}

// Cuántos más caben (contando los que vienen en camino).
export function populationRoom(colony) {
  return maxPopulation(colony) - colony.colonists.length - pregnantCount(colony);
}

// Cada adulto duerme en la casa donde tiene lugar (las parejas, juntas) o, si no hay,
// en una tienda del campamento. Los niños viven donde su madre.
export function assignHomes(colony) {
  const houses = colony.buildings.filter(usable);
  const room = new Map(houses.map((h) => [h.id, levelOf(h).housing]));
  const adults = colony.colonists.filter(isAdult);
  for (const c of adults) {
    if (c.home != null && (room.get(c.home) ?? 0) > 0) room.set(c.home, room.get(c.home) - 1);
    else c.home = null;
  }
  const freeIn = (id) => room.get(id) ?? 0;
  for (const c of adults) {
    if (c.home != null) continue;
    const mate = c.mate != null ? colony.colonist(c.mate) : null;
    let pick = mate?.home != null && freeIn(mate.home) > 0 ? mate.home : null;
    if (pick == null) {
      // La casa con más lugar; si su pareja tampoco tiene casa, mejor una con dos huecos.
      const wantTwo = mate && isAdult(mate) && mate.home == null;
      let best = null;
      for (const h of houses) {
        const free = freeIn(h.id);
        if (free <= 0) continue;
        const score = free + (wantTwo && free >= 2 ? 10 : 0);
        if (!best || score > best.score) best = { id: h.id, score };
      }
      pick = best?.id ?? null;
    }
    if (pick != null) {
      c.home = pick;
      room.set(pick, freeIn(pick) - 1);
      if (mate && isAdult(mate) && mate.home == null && freeIn(pick) > 0) {
        mate.home = pick;
        room.set(pick, freeIn(pick) - 1);
      }
    }
  }
  for (const c of colony.colonists) {
    if (!isChild(c)) continue;
    const mother = c.born ? colony.colonist(c.born.mother) : null;
    c.home = mother?.home ?? null;
  }
}

// Donde duerme y vive un colono: { x, z, door, top } (top: altura del techo, para los corazones).
export function homeOf(colony, c) {
  const house = c.home != null ? colony.building(c.home) : null;
  if (house && usable(house)) {
    const d = Math.hypot(house.x, house.z) || 1;
    const r = house.def.footprint + 0.9;
    return { x: house.x, z: house.z, top: 4.6, door: { x: house.x - (house.x / d) * r, z: house.z - (house.z / d) * r } };
  }
  const tents = colony.layout.tents;
  const tent = tents[c.id % tents.length];
  return { x: tent.x, z: tent.z, top: 3.6, door: tent.door };
}

// ---- Ganas, parejas y afinidad -------------------------------------------------------------

// Cuánto le gusta uno a otro (0–1): fija para cada pareja (química), más cercanía y gustos
// parecidos; quien ya tiene pareja prefiere a esa persona.
function chemistry(a, b) {
  const lo = Math.min(a.id, b.id);
  const hi = Math.max(a.id, b.id);
  const h = Math.sin(lo * 12.9898 + hi * 78.233 + 0.5) * 43758.5453;
  return h - Math.floor(h);
}

export function affinity(a, b) {
  let v = chemistry(a, b) * 0.55;
  if (a.mate === b.id) v += 0.4;
  else if (a.mate != null) v *= 0.5;
  for (const t of a.traits) if (b.traits.some((o) => o.id === t.id)) v += 0.06;
  return v;
}

// Padres, hijos y hermanos no se emparejan (no se desea a la familia).
export function related(a, b) {
  const ka = a.born;
  const kb = b.born;
  if (ka && (ka.mother === b.id || ka.father === b.id)) return true;
  if (kb && (kb.mother === a.id || kb.father === a.id)) return true;
  return !!(ka && kb && (ka.mother === kb.mother || ka.father === kb.father));
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ¿Está en condiciones de querer? Bien alimentado, descansado, animado y sin hijo en camino.
function inTheMood(c, strict) {
  if (!isAdult(c) || c.sleeping || c.pregnant) return false;
  const n = c.needs;
  const w = wellbeing(c);
  return strict ? w >= 62 && n.mood >= 55 && n.rest >= 35 && n.food >= 40 && n.water >= 40 : w >= 50 && n.rest >= 25 && n.mood >= 40;
}

// Un colono con ganas puede invitar a alguien; uno invitado decide si acepta. Agrega las
// opciones a las que el colono ya considera en chooseTask (ai.js).
export function loveOptions(colony, c, env, add) {
  if (!isAdult(c) || c.sleeping) return;
  const now = env.gameTime;

  // ¿Alguien me invitó?
  const invite = c.invite;
  if (invite) {
    c.invite = null;
    const from = invite.from;
    const asking = from.task?.type === 'love' && from.task.partner === c && from.task.role === 'ask';
    if (invite.until > now && asking && from.sex !== c.sex && !related(c, from)) {
      const willing = inTheMood(c, false) && c.desire >= 20 && affinity(c, from) >= 0.22;
      if (willing) {
        add(0.95, { type: 'love', role: 'accept', partner: from, phase: 'going' });
        return;
      }
      // Dice que no: el que invitó lo recuerda un rato y busca a otra persona (o lo deja).
      from.rejectedBy = { ...(from.rejectedBy ?? {}), [c.id]: now + 0.4 * DAY };
      addLog(c, env.time, `No quiso estar con ${from.name} en ese momento`);
    }
  }

  if (c.desire < 38 || !inTheMood(c, true) || populationRoom(colony) <= 0) return;
  let best = null;
  for (const o of colony.colonists) {
    if (o === c || o.sex === c.sex || related(c, o) || !inTheMood(o, false) || o.task?.type === 'love') continue;
    if (c.rejectedBy?.[o.id] > now) continue;
    const woman = c.sex === 'f' ? c : o;
    if (woman.pregnant) continue;
    const d = dist(c, o);
    if (d > 220) continue;
    const a = affinity(c, o) * 0.7 + 0.3 / (1 + d / 80);
    if (!best || a > best.a) best = { o, a };
  }
  if (!best || best.a < 0.2) return;
  const social = hasTrait(c, 'sociable') ? 1.2 : hasTrait(c, 'loner') ? 0.7 : 1;
  const score = ((c.desire - 30) / 70) * 0.85 * social * (0.7 + best.a * 0.5);
  add(score, { type: 'love', role: 'ask', partner: best.o, phase: 'asking' });
}

// ---- La tarea de estar juntos ----------------------------------------------------------------

function enter(c, home) {
  c.inside = true;
  c.loving = true;
  c.x = home.x;
  c.z = home.z;
}

export function leaveHome(c, home) {
  if (!c.inside && !c.loving) return;
  c.inside = false;
  c.loving = false;
  if (home) {
    c.x = home.door.x;
    c.z = home.door.z;
  }
}

// go: la función de caminar de ai.js. Devuelve 'running' | 'done' | 'failed'.
export function runLove(colony, c, task, dt, env, go) {
  const p = task.partner;
  task.age = (task.age ?? 0) + dt;
  const mateTask = () => (p.task?.type === 'love' && p.task.partner === c ? p.task : null);
  if (task.age > 150 || p.sleeping || colony.colonists.indexOf(p) < 0) return 'failed';

  if (task.phase === 'asking') {
    if (!go(colony, c, task, p, dt, 1.8)) return 'running';
    colony.faceTowards(c, p.x, p.z, dt);
    p.invite = { from: c, until: env.gameTime + INVITE_SECONDS };
    task.pact = { done: false };
    task.home = c.home != null ? homeOf(colony, c) : p.home != null ? homeOf(colony, p) : homeOf(colony, c);
    task.phase = 'waiting';
    task.timer = 0;
  }
  if (task.phase === 'waiting') {
    c.working = false;
    colony.faceTowards(c, p.x, p.z, dt);
    const other = mateTask();
    if (other) {
      task.phase = 'going';
    } else {
      if (c.rejectedBy?.[p.id] > env.gameTime) return 'failed';
      task.timer += dt;
      return task.timer > INVITE_SECONDS ? 'failed' : 'running';
    }
  }
  if (task.phase === 'going') {
    const other = mateTask();
    if (!other || (task.role === 'accept' && !other.home)) return task.role === 'accept' && other ? 'running' : 'failed';
    task.home ??= other.home;
    task.pact ??= other.pact;
    if (!task.arrived) {
      task.arrived = go(colony, c, task, task.home.door, dt, 0.9);
      if (!task.arrived) return 'running';
    }
    // Esperan a que lleguen los dos y entran juntos.
    if (!other.arrived) {
      colony.faceTowards(c, task.home.x, task.home.z, dt);
      return 'running';
    }
    task.phase = 'inside';
    task.timer = 0;
    enter(c, task.home);
    addLog(c, env.time, `Entró en casa con ${p.name}`);
  }
  if (task.phase === 'inside') {
    c.inside = true;
    c.loving = true;
    c.needs.mood = Math.min(100, c.needs.mood + (8 / LOVE_SECONDS) * dt);
    task.timer += dt;
    if (task.timer < LOVE_SECONDS) return 'running';
    finishLove(colony, c, p, task.pact, env);
    return 'done';
  }
  return 'running';
}

// Lo que queda de estar juntos: se vinculan, bajan las ganas y quizá hay un embarazo.
function finishLove(colony, a, b, pact, env) {
  if (!pact || pact.done) return;
  pact.done = true;
  a.desire = 0;
  b.desire = 0;
  a.mate = b.id;
  b.mate = a.id;
  const woman = a.sex === 'f' ? a : b;
  const man = woman === a ? b : a;
  addLog(a, env.time, `Pasó un rato a solas con ${b.name}`);
  addLog(b, env.time, `Pasó un rato a solas con ${a.name}`);
  const fertility = 0.6 * (0.5 + wellbeing(woman) / 200);
  if (!woman.pregnant && populationRoom(colony) > 0 && colony.birthRand() < fertility) {
    woman.pregnant = { father: man.id, due: colony.gameTime + PREGNANCY_SECONDS };
    addLog(woman, env.time, `Espera un hijo de ${man.name}`);
    addLog(man, env.time, `${woman.name} espera un hijo suyo`);
    colony.emit('notice', `${woman.name} espera un hijo`);
  }
  colony.emit('changed');
}

export function endLove(colony, c) {
  leaveHome(c, c.task?.home ?? homeOf(colony, c));
  c.invite = null;
}

// ---- Cada paso: ganas, crecimiento y nacimientos ------------------------------------------

export function updateFamily(colony, dt, time) {
  for (const c of colony.colonists) {
    c.growth ??= 1;
    if (c.growth < 1) {
      c.growth = Math.min(1, c.growth + dt / CHILD_SECONDS);
      c.age = Math.round(c.growth * 17);
      if (c.growth >= 1) {
        c.age = 18;
        addLog(c, time, 'Ya es adulto: puede trabajar y valerse por sí mismo');
        colony.emit('notice', `${c.name} ya es adulto`);
        colony.emit('changed');
      }
      continue;
    }
    // Las ganas crecen cuando se está bien y se enfrían si no.
    const w = wellbeing(c);
    const rate = (100 / DESIRE_FULL_SECONDS) * (w >= 60 ? 0.5 + w / 100 : w >= 40 ? 0.1 : -0.2);
    c.desire = Math.max(0, Math.min(100, (c.desire ?? 0) + rate * dt));
    if (c.pregnant && colony.gameTime >= c.pregnant.due) giveBirth(colony, c, time);
  }
}

export function giveBirth(colony, mother, time) {
  const father = colony.colonist(mother.pregnant.father) ?? mother;
  mother.pregnant = null;
  mother.desire = 0;
  const rand = colony.birthRand;
  const sex = rand() < 0.5 ? 'f' : 'm';
  const taken = new Set(colony.colonists.map((o) => o.name));
  const name = pickName(colony.age, sex, taken, rand);
  const profile = createChildProfile(rand, mother, father, time);
  const body = appearanceFromGenes(profile.genome, 18);
  const look = {
    skin: body.skin,
    hair: body.hair,
    shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
    pants: PANTS[Math.floor(rand() * PANTS.length)],
    longHair: rand() < (sex === 'f' ? 0.75 : 0.25),
    height: body.height,
  };
  const home = homeOf(colony, mother);
  const spot = colony.freeSpot(home.door.x, home.door.z);
  const child = colony.makeColonist(
    { id: colony.nextColonistId++, name, sex, genome: profile.genome, traits: profile.traits, skills: profile.skills, bio: profile.bio, look, born: { time: colony.gameTime, mother: mother.id, father: father.id, day: time } },
    { needs: profile.needs, health: 100, log: [], flags: {}, growth: 0.02, x: spot.x, z: spot.z, clothed: true, desire: 0, mate: null, home: mother.home ?? null },
  );
  addLog(child, time, `Nació: ${sex === 'f' ? 'hija' : 'hijo'} de ${mother.name} y ${father.name}`);
  addLog(mother, time, `Dio a luz a ${name}`);
  if (father !== mother) addLog(father, time, `${name} es su hijo`);
  colony.colonists.push(child);
  colony.staticsRevision++;
  colony.emit('colonists');
  colony.emit('notice', `Nació ${name}, ${sex === 'f' ? 'hija' : 'hijo'} de ${mother.name}`);
  colony.emit('changed');
  return child;
}
