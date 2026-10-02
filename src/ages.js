// Edades de la colonia. Se sube de edad cuando la aldea tiene lo que esa etapa exige
// (población, edificios levantados, producción, tecnologías y una ofrenda): nunca algo que
// sólo se consigue después de avanzar. Cada edad desbloquea edificios, mejoras, viviendas
// y límites mayores (sim/progression.js); las mejoras hay que pagarlas edificio por edificio
// (las viviendas nuevas salen ya con el aspecto de la edad). Son etapas de juego, no una cronología histórica.

export const AGES = [
  {
    n: 1,
    numeral: 'I',
    name: 'Edad Primitiva',
    theme: 'Supervivencia',
    desc: 'Ramas, pieles y piedras apiladas. La colonia vive de lo que recoge.',
    auto: 'Refugios de ramas, hojas y pieles; fogata y pequeño espacio común; ropa sencilla de pieles.',
  },
  {
    n: 2,
    numeral: 'II',
    name: 'Edad de Piedra',
    theme: 'Asentamiento estable',
    desc: 'Chozas de barro y paja, senderos, tótem y herramientas de piedra pulida.',
    auto: 'Senderos de piedra alrededor del fuego y tótem de la tribu; ropa de pieles mejor cosida. Las viviendas nuevas se hacen de barro y paja; las chozas de ramas se mejoran pagando.',
    // Todo se consigue en Primitiva: refugio para todos, reservas de comida y agua (se conservan),
    // el almacén primitivo, la primera herramienta de piedra y materiales (esto sí se gasta).
    requires: {
      shelter: true,
      reserves: { food: 12, water: 10 },
      buildings: [{ id: 'stockpile', name: 'el almacén primitivo' }],
      milestones: [{ id: 'stone_tool', name: 'la primera herramienta de piedra' }],
      cost: { wood: 30, stone: 15, fiber: 10 },
    },
  },
  {
    n: 3,
    numeral: 'III',
    name: 'Edad del Bronce',
    theme: 'Primeros talleres',
    desc: 'Adobe con vigas y techos de caña, minas, fundición y herramientas de bronce.',
    auto: 'Plaza empedrada y caminos marcados; tejidos teñidos y cintas de cuero. Las viviendas nuevas son de adobe con vigas y techo de caña; las anteriores se mejoran pagando.',
    requires: {
      population: 9,
      buildings: [
        { id: 'farm', name: 'un campo de cultivo' },
        { id: 'clay_pit', name: 'un pozo de arcilla' },
        { id: 'well', level: 2, name: 'un pozo simple' },
        { id: 'stockpile', level: 2, name: 'un granero' },
      ],
      produced: { grain: 20, clay: 15 },
      cost: { wood: 60, stone: 40, fiber: 20 },
    },
  },
  {
    n: 4,
    numeral: 'IV',
    name: 'Edad del Hierro',
    theme: 'Especialización',
    desc: 'Casas de madera y piedra, hierro, carbón vegetal y oficios especializados.',
    auto: 'El centro gana un pozo de piedra y puestos de oficio; ropa de lana y delantales de herrero. Las viviendas nuevas son de madera sobre zócalo de piedra; las anteriores se mejoran pagando.',
    requires: {
      population: 12,
      buildings: [
        { id: 'smelter', name: 'una fundición de bronce' },
        { id: 'tool_workshop', name: 'un taller de herramientas' },
        { id: 'pottery', name: 'una alfarería' },
        { id: 'bakery', name: 'un horno de pan' },
        { id: 'copper_mine', name: 'una mina de cobre' },
        { id: 'tin_mine', name: 'una mina de estaño' },
      ],
      produced: { bronze_tools: 6, bread: 12 },
      cost: { wood: 90, stone: 60, bronze: 12 },
    },
  },
  {
    n: 5,
    numeral: 'V',
    name: 'Edad Clásica',
    theme: 'Organización urbana',
    desc: 'Mampostería, plaza y edificios cívicos, agua canalizada y comercio de excedentes.',
    auto: 'Plaza con fuente y calles empedradas; túnicas y mantos de tela. Las viviendas nuevas son de mampostería con tejas y patio; las anteriores se mejoran pagando.',
    requires: {
      population: 16,
      buildings: [
        { id: 'iron_mine', name: 'una mina de hierro' },
        { id: 'bloomery', name: 'un horno de hierro' },
        { id: 'blacksmith', name: 'una herrería' },
        { id: 'charcoal_kiln', name: 'una carbonera' },
        { id: 'barracks', name: 'un cuartel' },
      ],
      produced: { iron_tools: 8 },
      cost: { wood: 120, stone: 100, iron: 12 },
    },
  },
  {
    n: 6,
    numeral: 'VI',
    name: 'Edad Medieval',
    theme: 'Ciudad y oficios',
    desc: 'Entramado de madera y piedra, tablones, harina, pan, tejidos, murallas y caballería.',
    auto: 'Plaza urbana con calles diferenciadas; jubones, capas y gremios con colores propios. Las viviendas nuevas son de entramado con tejados elaborados; las anteriores se mejoran pagando.',
    requires: {
      population: 22,
      buildings: [
        { id: 'market', name: 'un mercado' },
        { id: 'stonecutter', name: 'un taller de cantería' },
        { id: 'water_works', name: 'un acueducto' },
        { id: 'admin', name: 'una casa del consejo' },
      ],
      produced: { cut_stone: 30, coin: 40 },
      cost: { cut_stone: 40, wood: 150, coin: 40 },
    },
  },
  {
    n: 7,
    numeral: 'VII',
    name: 'Renacimiento',
    theme: 'Comercio y conocimiento',
    desc: 'Barrios densos, academia, manufacturas de precisión, rutas comerciales y artillería.',
    auto: 'Plaza comercial con farolas y banderolas; ropa de corte con cuellos y sombreros. Las viviendas nuevas son casas urbanas de dos plantas; las anteriores se mejoran pagando.',
    requires: {
      population: 30,
      buildings: [
        { id: 'sawmill', name: 'un aserradero' },
        { id: 'mill', name: 'un molino' },
        { id: 'textile', name: 'un taller textil' },
        { id: 'bakery', level: 2, name: 'una panadería con harina' },
        { id: 'blacksmith', level: 2, name: 'una herrería avanzada' },
      ],
      produced: { planks: 40, cloth: 20, bread: 40 },
      cost: { planks: 60, cloth: 20, coin: 80 },
    },
  },
  {
    n: 8,
    numeral: 'VIII',
    name: 'Edad Industrial',
    theme: 'Mecanización',
    desc: 'Ladrillo, acero, vapor, fábricas, estaciones y bloques de viviendas.',
    auto: 'Zonas residenciales e industriales reconocibles; monos de obrero y chalecos. Las viviendas nuevas son de ladrillo con chimeneas y se pueden levantar bloques residenciales; las anteriores se mejoran pagando.',
    requires: {
      population: 40,
      buildings: [
        { id: 'academy', name: 'una academia' },
        { id: 'precision_shop', name: 'un taller de precisión' },
        { id: 'market', level: 3, name: 'una casa de comercio' },
      ],
      produced: { instruments: 8, knowledge: 60 },
      techs: ['industry', 'steam'],
      cost: { coin: 150, planks: 100, instruments: 10 },
    },
  },
  {
    n: 9,
    numeral: 'IX',
    name: 'Edad Moderna',
    theme: 'Electrificación',
    desc: 'Hormigón, electricidad, agua distribuida, carreteras, hospitales y centros educativos.',
    auto: 'Calles asfaltadas y farolas eléctricas; ropa moderna y batas. Las viviendas nuevas son de hormigón y ladrillo, más altas; las anteriores se mejoran pagando.',
    requires: {
      population: 52,
      buildings: [
        { id: 'steel_mill', name: 'una acería' },
        { id: 'coal_mine', name: 'una mina de carbón' },
        { id: 'boiler', name: 'una caldera de vapor' },
        { id: 'factory', name: 'una fábrica' },
        { id: 'station', name: 'una estación' },
        { id: 'brick_kiln', name: 'un horno de ladrillos' },
      ],
      produced: { steel: 40, machinery: 8, bricks: 30 },
      techs: ['electricity', 'logistics'],
      cost: { steel: 80, bricks: 60, coin: 200 },
    },
  },
  {
    n: 10,
    numeral: 'X',
    name: 'Edad Contemporánea',
    theme: 'Ciudad avanzada',
    desc: 'Barrios de alta capacidad, redes eficientes, electrónica y automatización.',
    auto: 'Plaza peatonal con iluminación; ropa técnica y uniformes de especialista. Las viviendas nuevas son de vidrio y hormigón y se pueden levantar torres residenciales; las anteriores se mejoran pagando.',
    requires: {
      population: 66,
      buildings: [
        { id: 'power_plant', name: 'una central eléctrica' },
        { id: 'concrete_plant', name: 'una planta de hormigón' },
        { id: 'hospital', name: 'un hospital' },
        { id: 'school', name: 'una escuela' },
        { id: 'apartment', name: 'un bloque residencial' },
      ],
      produced: { concrete: 40 },
      techs: ['medicine', 'education', 'concrete'],
      cost: { concrete: 100, steel: 120, machinery: 20, coin: 300 },
    },
  },
  {
    n: 11,
    numeral: 'XI',
    name: 'Edad Futurista',
    theme: 'Extensión opcional',
    desc: 'Viviendas de muy alta capacidad, energía avanzada, automatización total y transporte futurista.',
    auto: 'Sin definir: la arquitectura admite una edad más (viviendas, ropa, centro y límites), pero no se puede alcanzar.',
    future: true,
  },
];

// La última edad que se puede alcanzar (la XI queda preparada pero separada del alcance).
export const MAX_AGE = AGES.filter((a) => !a.future).length;

// Lo rellena progression.js: ¿existe en el juego todo lo que exige esta edad?
export const AGE_HOOKS = { reachable: () => true };

export function ageInfo(n) {
  return AGES[Math.min(AGES.length, Math.max(1, n)) - 1];
}

// Qué falta para pasar a la edad siguiente:
// { next, checks: [{ label, have, need, ok }], missing[], ready, soon }.
export function nextAgeStatus(colony) {
  const next = AGES[colony.age] ?? null; // AGES[age] es la siguiente (índice base 0)
  if (!next) return { next: null, ready: false };
  if (next.future || !AGE_HOOKS.reachable(next)) return { next, soon: true, ready: false };
  const req = next.requires;
  const checks = [];
  if (req.population) {
    const have = colony.colonists.length;
    checks.push({ label: 'Colonos en la aldea', have, need: req.population, ok: have >= req.population });
  }
  if (req.shelter) {
    const s = colony.shelterInfo();
    checks.push({ label: 'Refugio para todos los adultos', have: s.housed, need: Math.max(1, s.adults), ok: s.ok });
  }
  for (const [good, n] of Object.entries(req.reserves ?? {})) {
    const have = Math.floor(good === 'water' ? colony.waterReport().stock + colony.waterReport().store : (colony.stock[good] ?? 0));
    checks.push({ label: `Reserva de ${goodName(good).toLowerCase()} (se conserva)`, have, need: n, ok: have >= n, hint: have >= n ? undefined : good === 'water' ? colony.waterHint() : 'Marca bayas y setas con «Recolectar» (filtro Comida).' });
  }
  for (const m of req.milestones ?? []) {
    const ok = !!colony.milestones?.has?.(m.id);
    checks.push({ label: `Descubrir ${m.name}`, have: ok ? 1 : 0, need: 1, ok });
  }
  for (const r of req.buildings ?? []) {
    const ok = colony.buildings.some((b) => b.def.id === r.id && b.done && b.level >= (r.level ?? 1));
    checks.push({ label: `Tener ${r.name}`, have: ok ? 1 : 0, need: 1, ok });
  }
  for (const [good, n] of Object.entries(req.produced ?? {})) {
    const have = Math.floor(colony.produced?.[good] ?? 0);
    checks.push({ label: `Haber producido ${goodName(good)}`, have, need: n, ok: have >= n });
  }
  for (const tech of req.techs ?? []) {
    const ok = !!colony.techs?.has?.(tech);
    checks.push({ label: `Investigar ${techName(tech)}`, tech, have: ok ? 1 : 0, need: 1, ok });
  }
  const missing = Object.entries(req.cost)
    .filter(([k, n]) => (colony.stock[k] ?? 0) < n)
    .map(([k, n]) => [k, Math.ceil(n - (colony.stock[k] ?? 0))]);
  return { next, checks, missing, ready: checks.every((c) => c.ok) && missing.length === 0 };
}

import { GOOD_NAMES } from './sim/goods.js';
import { TECHS_BY_ID } from './sim/techs.js';
const goodName = (id) => GOOD_NAMES[id] ?? id;
export const techName = (id) => TECHS_BY_ID[id]?.name ?? id;
