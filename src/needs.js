// Necesidades, salud, rasgos de personalidad e historia de los colonos. El cuerpo
// (metabolismo, frío, energía...) lo deciden los genes (genes.js).
//
// Todas las necesidades van de 0 (muy mal) a 100 (perfecto) y cambian con el tiempo de
// juego (un día dura DAY_LENGTH_SECONDS a velocidad ×1). Por ahora bajan despacio: aún
// no hay IA que las satisfaga, salvo el calor (la fogata calienta a quien esté cerca)
// y el ánimo (la compañía anima). La salud sólo baja si falta comida, agua o calor.

import { DAY_LENGTH_SECONDS } from './daynight.js';
import { createGenome, gene } from './genes.js';

const DAY = DAY_LENGTH_SECONDS;

export const NEEDS = [
  { id: 'food', name: 'Comida', low: 'Tiene hambre', color: 'var(--food)' },
  { id: 'water', name: 'Agua', low: 'Tiene sed', color: 'var(--water)' },
  { id: 'rest', name: 'Descanso', low: 'Está agotado', color: 'var(--rest)' },
  { id: 'warmth', name: 'Calor', low: 'Tiene frío', color: 'var(--warmth)' },
  { id: 'mood', name: 'Ánimo', low: 'Está desanimado', color: 'var(--mood)' },
];

// Rasgos de personalidad (lo físico lo deciden los genes).
export const TRAITS = [
  { id: 'sociable', name: 'Sociable', desc: 'Estar con otros le levanta mucho el ánimo.', excludes: 'loner' },
  { id: 'loner', name: 'Amante de la soledad', desc: 'La compañía no le anima; prefiere estar solo.', excludes: 'sociable' },
  { id: 'optimist', name: 'Optimista', desc: 'Su ánimo tiende a mantenerse alto.', excludes: 'pessimist' },
  { id: 'pessimist', name: 'Pesimista', desc: 'Su ánimo tiende a ser más bajo.', excludes: 'optimist' },
  { id: 'curious', name: 'Curioso', desc: 'Le gusta explorar lejos del campamento.', excludes: 'homebody' },
  { id: 'homebody', name: 'Hogareño', desc: 'Prefiere quedarse cerca del campamento.', excludes: 'curious' },
  { id: 'hardworking', name: 'Trabajador', desc: 'Pondrá más empeño en las tareas de la colonia.', excludes: 'lazy' },
  { id: 'lazy', name: 'Perezoso', desc: 'Evitará trabajar si puede.', excludes: 'hardworking' },
];

const ORIGINS = [
  'Creció en un pueblo de pescadores',
  'Viene de una familia de pastores',
  'Pasó su infancia en las montañas',
  'Nació en una caravana de comerciantes',
  'Se crió en una granja junto al río',
  'Creció entre los bosques del norte',
  'Nació en una isla pequeña',
];
// Oficio anterior: da experiencia en alguna habilidad.
const PASTS = [
  { text: 'se dedicaba a la caza', skills: { gathering: 1, hauling: 1 } },
  { text: 'trabajaba la madera', skills: { woodcutting: 3, building: 2 } },
  { text: 'cuidaba cabras', skills: { gathering: 2, hauling: 1 } },
  { text: 'recolectaba plantas medicinales', skills: { gathering: 3 } },
  { text: 'hacía vasijas de barro', skills: { building: 1, hauling: 1 } },
  { text: 'pescaba en el río', skills: { hauling: 3 } },
  { text: 'era aprendiz en una herrería', skills: { mining: 3, building: 1 } },
  { text: 'levantaba muros de piedra', skills: { building: 3, mining: 1 } },
  { text: 'contaba historias junto al fuego', skills: {} },
];

// Habilidades (0–10): deciden quién es el más capacitado para cada trabajo.
export const SKILLS = [
  { id: 'gathering', name: 'Recolección' },
  { id: 'woodcutting', name: 'Tala' },
  { id: 'mining', name: 'Cantería' },
  { id: 'hauling', name: 'Acarreo de agua' },
  { id: 'building', name: 'Construcción' },
];

function createSkills(genome, past, rand) {
  const g = (id) => gene(genome, id);
  const base = {
    gathering: g('agility') * 4 + g('stamina') * 1,
    woodcutting: g('vigor') * 3 + g('stamina') * 2,
    mining: g('vigor') * 4 + g('stamina') * 1,
    hauling: g('stamina') * 4 + g('agility') * 1,
    building: g('vigor') * 2 + g('agility') * 2 + g('stamina') * 1,
  };
  const skills = {};
  for (const s of SKILLS) {
    const value = base[s.id] + (past.skills[s.id] || 0) + rand() * 3;
    skills[s.id] = Math.max(1, Math.min(10, Math.round(value)));
  }
  return skills;
}
const DREAMS = [
  'Sueña con ver crecer la colonia.',
  'Quiere construir una casa de piedra.',
  'Espera encontrar oro algún día.',
  'Desea que nadie en la colonia pase hambre.',
  'Le gustaría aprender a navegar.',
  'Busca un lugar tranquilo donde envejecer.',
];

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

export function createProfile(rand) {
  const traits = [];
  while (traits.length < 2) {
    const t = pick(TRAITS, rand);
    if (traits.includes(t) || traits.some((o) => o.id === t.excludes)) continue;
    traits.push(t);
  }
  const needs = {};
  for (const n of NEEDS) needs[n.id] = 70 + rand() * 25;
  const genome = createGenome(rand);
  const past = pick(PASTS, rand);
  return {
    genome,
    age: 18 + Math.floor(rand() * 38),
    traits,
    skills: createSkills(genome, past, rand),
    job: null, // edificio donde trabaja (lo asigna la colonia)
    bio: `${pick(ORIGINS, rand)}. Antes de unirse a la colonia ${past.text}. ${pick(DREAMS, rand)}`,
    needs,
    health: 100,
    log: [],
    flags: {},
    chatCooldown: 0,
  };
}

export function hasTrait(c, id) {
  return c.traits.some((t) => t.id === id);
}

// Bienestar de un colono (0–100): media de necesidades y salud, pesando lo peor.
export function wellbeing(c) {
  const values = [...NEEDS.map((n) => c.needs[n.id]), c.health];
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return 0.6 * avg + 0.4 * Math.min(...values);
}

export function needStatus(value) {
  if (value >= 70) return { text: 'Bien', tone: 'good' };
  if (value >= 40) return { text: 'Aceptable', tone: 'ok' };
  if (value >= 20) return { text: 'Lo necesita', tone: 'warn' };
  return { text: 'Urgente', tone: 'bad' };
}

export function addLog(c, time, text) {
  c.log.unshift({ time, text });
  if (c.log.length > 12) c.log.length = 12;
}

const clamp = (v) => Math.min(100, Math.max(0, v));

// Actualiza necesidades y salud. env: { dt (segundos de juego), ambient (0–1, calor del
// lugar según clima y hora), nearFire, companion (colono cercano o null), walking, time }
export function updateNeeds(c, env) {
  const { dt } = env;
  const n = c.needs;

  const g = c.genome;
  const metabolism = 0.75 + gene(g, 'metabolism') * 0.5; // 0,75× a 1,25×
  n.food = clamp(n.food - (100 / (4 * DAY)) * metabolism * dt);
  n.water = clamp(n.water - (100 / (3 * DAY)) * metabolism * dt);
  const tiredness = 1.25 - gene(g, 'stamina') * 0.5; // 1,25× a 0,75×
  const restRate = (100 / (3 * DAY)) * tiredness * (env.walking ? 1 : 0.5);
  n.rest = clamp(n.rest - restRate * dt);

  // Calor: tiende al calor del ambiente (más o menos según la resistencia al frío);
  // junto a la fogata sube rápido.
  let target = env.ambient * 100 + (gene(g, 'cold') - 0.5) * 36;
  if (env.sheltered) target = Math.max(target, 80); // dentro de la tienda
  if (env.nearFire) target = 100;
  target = clamp(target);
  const warmRate = target > n.warmth ? (env.nearFire ? 100 / 60 : 100 / (0.3 * DAY)) : 100 / (0.4 * DAY);
  n.warmth += Math.sign(target - n.warmth) * Math.min(Math.abs(target - n.warmth), warmRate * dt);

  // Ánimo: depende de cómo esté en general y de la compañía.
  const others = (n.food + n.water + n.rest + n.warmth) / 4;
  let moodTarget = 25 + others * 0.6 + (hasTrait(c, 'optimist') ? 12 : 0) - (hasTrait(c, 'pessimist') ? 12 : 0);
  if (env.companion) moodTarget += hasTrait(c, 'loner') ? -5 : hasTrait(c, 'sociable') ? 25 : 12;
  moodTarget = clamp(moodTarget);
  const moodRate = 100 / (0.8 * DAY);
  n.mood += Math.sign(moodTarget - n.mood) * Math.min(Math.abs(moodTarget - n.mood), moodRate * dt);

  // Salud: baja si falta lo básico; si no, se recupera despacio. Aún no mueren.
  const critical = n.food <= 0 || n.water <= 0 || n.warmth < 8;
  const vigor = gene(g, 'vigor');
  if (critical) c.health -= (100 / (1.5 * DAY)) * (1.3 - vigor * 0.6) * dt;
  else if (Math.min(n.food, n.water, n.warmth) > 25) c.health += (100 / (3 * DAY)) * (0.7 + vigor * 0.6) * dt;
  c.health = Math.min(100, Math.max(1, c.health));

  // Registro: avisos cuando una necesidad cruza un umbral (con margen para no repetir).
  for (const need of NEEDS) {
    const key = `low-${need.id}`;
    if (n[need.id] < 30 && !c.flags[key]) {
      c.flags[key] = true;
      addLog(c, env.time, need.low);
    } else if (n[need.id] > 40) {
      c.flags[key] = false;
    }
  }
  if (env.nearFire && n.warmth > 80 && !c.flags.warmedUp && c.flags.wasCold) {
    c.flags.warmedUp = true;
    addLog(c, env.time, 'Entró en calor junto a la fogata');
  }
  if (n.warmth < 40) {
    c.flags.wasCold = true;
    c.flags.warmedUp = false;
  }
  if (critical && !c.flags.sick) {
    c.flags.sick = true;
    addLog(c, env.time, 'Su salud empieza a empeorar');
  } else if (!critical) {
    c.flags.sick = false;
  }
  c.chatCooldown = Math.max(0, c.chatCooldown - dt);
  if (env.companion && !env.walking && c.chatCooldown <= 0) {
    c.chatCooldown = 0.5 * DAY;
    addLog(c, env.time, `Charló un rato con ${env.companion.name}`);
  }
}
