// Tipos de edificio: datos puros (sin Three.js ni DOM). Los usa la simulación
// (sim/colony.js), la interfaz y, más adelante, el servidor. El modelo 3D de cada nivel
// se nombra con un texto; lo dibuja buildingModels.js.

// ---------------------------------------------------------------------------
// Tipos de edificio
// ---------------------------------------------------------------------------

// Cada tipo tiene niveles: el nivel N corresponde a la edad N y cambia el nombre, el
// modelo y el rendimiento. El nivel 1 es el que se construye desde la barra.
export const BUILDING_TYPES = [
  {
    id: 'gatherer',
    category: 'production',
    job: 'Recolección',
    skill: 'gathering',
    icon: 'food',
    cost: { wood: 10 },
    buildTime: 45,
    footprint: 2.6,
    resource: 'food',
    stock: 'food',
    extra: { fiber: 1 }, // además de comida trae fibras (hierbas y cortezas)
    workTime: 10,
    range: 170,
    goingText: 'Va a recolectar',
    workingText: 'Recolectando',
    returningText: 'Lleva comida y fibras al almacén',
    noResourceText: 'No hay bayas ni setas cerca',
    levels: [
      { name: 'Enramada de recolección', desc: 'Un techo de ramas con cestas. Un colono recoge bayas y setas, y de paso hierbas para fibras.', yield: 2, model: 'gathererModel1' },
      { name: 'Choza de recolección', desc: 'Choza de barro y paja con un secadero: cada viaje trae más comida.', yield: 3, model: 'gathererModel2', upgradeCost: { wood: 20, fiber: 8 } },
    ],
  },
  {
    id: 'woodcutter',
    category: 'production',
    job: 'Tala',
    skill: 'woodcutting',
    icon: 'axe',
    cost: { wood: 8, stone: 2 },
    buildTime: 50,
    footprint: 2.6,
    resource: 'wood',
    stock: 'wood',
    workTime: 14,
    range: 200,
    goingText: 'Va a talar un árbol',
    workingText: 'Talando',
    returningText: 'Lleva madera al almacén',
    noResourceText: 'No hay árboles cerca',
    scavenge: { yield: 1, text: 'Juntando ramas caídas', status: 'No quedan árboles cerca: junta ramas caídas (rinde menos)' },
    levels: [
      { name: 'Zona de tala', desc: 'Un tocón y un hacha de piedra. Un colono tala árboles cercanos.', yield: 4, model: 'woodcutterModel1' },
      { name: 'Cabaña del leñador', desc: 'Cabaña de troncos con mejores hachas: cada árbol da más madera.', yield: 6, model: 'woodcutterModel2', upgradeCost: { wood: 25, stone: 5, fiber: 6 } },
    ],
  },
  {
    id: 'quarry',
    category: 'production',
    job: 'Cantería',
    skill: 'mining',
    icon: 'pick',
    cost: { wood: 10 },
    buildTime: 55,
    footprint: 2.8,
    resource: 'stone',
    stock: 'stone',
    workTime: 16,
    range: 200,
    goingText: 'Va a picar piedra',
    workingText: 'Picando piedra',
    returningText: 'Lleva piedra al almacén',
    noResourceText: 'No hay piedras cerca',
    scavenge: { yield: 1, text: 'Juntando piedras sueltas', status: 'No quedan piedras grandes cerca: junta piedras sueltas (rinde menos)' },
    levels: [
      { name: 'Pedrera', desc: 'Un montón de piedras y un percutor. Un colono junta piedra de los alrededores.', yield: 2, model: 'quarryModel1' },
      { name: 'Cantera', desc: 'Con palancas y una grúa de troncos se sacan bloques más grandes.', yield: 3, model: 'quarryModel2', upgradeCost: { wood: 25, stone: 10, fiber: 6 } },
    ],
  },
  {
    id: 'well',
    category: 'production',
    job: 'Acarreo de agua',
    skill: 'hauling',
    icon: 'water',
    cost: { wood: 8, fiber: 4 },
    buildTime: 40,
    footprint: 1.9,
    stock: 'water',
    levels: [
      {
        name: 'Recolector de lluvia',
        desc: 'Pieles tensadas que llenan vasijas cuando llueve (y un poco con el rocío). Se puede beber de él y un aguatero lleva el agua al almacén.',
        yield: 3,
        rainOnly: true,
        capacity: 14,
        model: 'wellModel1',
      },
      { name: 'Pozo simple', desc: 'Un anillo de piedras y un cubo de cuero: da agua siempre, llueva o no. Todos beben de él gratis; el aguatero saca entre 6 y 10 jarras por día para el almacén (la colonia gasta unas 3).', yield: 2, workTime: 60, model: 'wellModel2', upgradeCost: { wood: 15, stone: 20, fiber: 5 } },
    ],
  },
];


// Nivel actual (o el siguiente) de un edificio.
export function levelOf(b, offset = 0) {
  return b.def.levels[b.level - 1 + offset] ?? null;
}

// Almacenes: no tienen trabajador; cada uno amplía lo que cabe en el almacén.
BUILDING_TYPES.push({
  id: 'stockpile',
  category: 'storage',
  icon: 'wood',
  cost: { wood: 12, fiber: 4 },
  buildTime: 40,
  footprint: 2.6,
  levels: [
    {
      name: 'Pila de troncos y cestas',
      desc: 'Troncos apilados, cestas de fibra y pieles para tapar. Amplía lo que cabe en el almacén de la colonia.',
      capacity: { food: 25, water: 15, wood: 40, stone: 30, fiber: 20 },
      model: 'stockpileModel1',
    },
    {
      name: 'Granero',
      desc: 'Una choza sobre pilotes con techo de paja: mantiene la comida seca y guarda mucho más.',
      capacity: { food: 70, water: 35, wood: 90, stone: 70, fiber: 50 },
      model: 'stockpileModel2',
      upgradeCost: { wood: 30, stone: 10, fiber: 12 },
    },
  ],
});
for (const def of BUILDING_TYPES) {
  def.name ??= def.levels[0].name;
  def.desc ??= def.levels[0].desc;
}

// Categorías de la barra de construcción (las vacías se muestran como "próximamente").
export const BUILD_CATEGORIES = [
  { id: 'production', name: 'Producción', icon: 'hammer', soon: 'Edificios que consiguen comida, agua y materiales.' },
  { id: 'housing', name: 'Vivienda', icon: 'people', soon: 'Chozas y casas para que los colonos duerman mejor.' },
  { id: 'storage', name: 'Almacenes', icon: 'wood', soon: 'Graneros y depósitos para guardar más recursos.' },
  { id: 'decoration', name: 'Decoración', icon: 'leaf', soon: 'Jardines, estatuas y caminos que alegran a la colonia.' },
  { id: 'defense', name: 'Defensa', icon: 'shield', soon: 'Empalizadas y torres de vigilancia.' },
];

export const BUILDINGS = Object.fromEntries(BUILDING_TYPES.map((t) => [t.id, t]));

export const STOCK_NAMES = { food: 'comida', water: 'agua', wood: 'madera', stone: 'piedra', fiber: 'fibras' };
