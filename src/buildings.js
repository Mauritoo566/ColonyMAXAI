import * as THREE from 'three';
import { RADIUS, addTerrainZone, removeTerrainZone } from './elevation.js';
import { biomeAt, BIOMES } from './biomes.js';
import { pickSurface } from './camp.js';
import { Parts, mat, stick, v } from './modelKit.js';
import { hasTrait, addLog, SKILLS } from './needs.js';
import { ageInfo } from './ages.js';

// Edificios de la colonia. El jugador elige qué construir en la barra de construcción y
// dónde; los colonos lo construyen (los más hábiles, más rápido) y, al terminarlo, la
// colonia asigna como trabajador al colono libre más capacitado para ese oficio.

const STORAGE_KEY = 'colonymaxai.colony';
const SAVE_VERSION = 2; // 2: además guarda colonos, recursos agotados y el reloj
const MAX_DISTANCE = 75; // metros desde la fogata donde se puede construir
const CLICK_TOLERANCE = 6;
const LABEL_DISTANCE = 260;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

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
      { name: 'Enramada de recolección', desc: 'Un techo de ramas con cestas. Un colono recoge bayas y setas, y de paso hierbas para fibras.', yield: 2, model: gathererModel1 },
      { name: 'Choza de recolección', desc: 'Choza de barro y paja con un secadero: cada viaje trae más comida.', yield: 3, model: gathererModel2, upgradeCost: { wood: 20, fiber: 8 } },
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
      { name: 'Zona de tala', desc: 'Un tocón y un hacha de piedra. Un colono tala árboles cercanos.', yield: 4, model: woodcutterModel1 },
      { name: 'Cabaña del leñador', desc: 'Cabaña de troncos con mejores hachas: cada árbol da más madera.', yield: 6, model: woodcutterModel2, upgradeCost: { wood: 25, stone: 5, fiber: 6 } },
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
      { name: 'Pedrera', desc: 'Un montón de piedras y un percutor. Un colono junta piedra de los alrededores.', yield: 2, model: quarryModel1 },
      { name: 'Cantera', desc: 'Con palancas y una grúa de troncos se sacan bloques más grandes.', yield: 3, model: quarryModel2, upgradeCost: { wood: 25, stone: 10, fiber: 6 } },
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
        model: wellModel1,
      },
      { name: 'Pozo simple', desc: 'Un anillo de piedras y un cubo de cuero: da agua siempre, llueva o no.', yield: 2, model: wellModel2, upgradeCost: { wood: 15, stone: 20, fiber: 5 } },
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
      model: stockpileModel1,
    },
    {
      name: 'Granero',
      desc: 'Una choza sobre pilotes con techo de paja: mantiene la comida seca y guarda mucho más.',
      capacity: { food: 70, water: 35, wood: 90, stone: 70, fiber: 50 },
      model: stockpileModel2,
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

// ---------------------------------------------------------------------------
// Modelos (metros, suelo en y = 0)
// ---------------------------------------------------------------------------

function prism(radius, length) {
  // Prisma triangular con una arista arriba (para tejados a dos aguas).
  const g = new THREE.CylinderGeometry(radius, radius, length, 3);
  g.rotateZ(Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

function gathererModel2(p) {
  p.add(new THREE.CylinderGeometry(2.2, 2.4, 1.8, 9), '#9a7148', mat(0, 0.9, 0));
  p.add(new THREE.CylinderGeometry(2.55, 2.75, 0.25, 9), '#a8843e', mat(0, 1.95, 0));
  p.add(new THREE.ConeGeometry(2.9, 2.3, 9), '#c9a45a', mat(0, 3.1, 0));
  p.add(new THREE.BoxGeometry(0.9, 1.4, 0.12), '#3a2618', mat(0, 0.7, 2.3));
  for (const [x, z] of [[1.9, 1.9], [-2.1, 1.5], [2.4, -0.6]]) {
    p.add(new THREE.CylinderGeometry(0.45, 0.38, 0.5, 8), '#c49a5a', mat(x, 0.25, z));
    for (let k = 0; k < 4; k++) {
      p.add(new THREE.IcosahedronGeometry(0.13, 0), k % 2 ? '#b8283a' : '#7a2a6a', mat(x + (k - 1.5) * 0.14, 0.55, z + ((k * 7) % 3 - 1) * 0.12));
    }
  }
}

function woodcutterModel2(p) {
  p.add(new THREE.BoxGeometry(3.6, 0.35, 3), '#6b4a2e', mat(0, 0.17, 0));
  p.add(new THREE.BoxGeometry(3.4, 1.8, 2.8), '#8a5a34', mat(0, 1.2, 0));
  p.add(prism(1.7, 3.5), '#8a5a34', mat(0, 2.95, 0));
  p.add(new THREE.BoxGeometry(3.9, 0.16, 2.1), '#5a3a22', mat(0, 3.05, 0.78, 0.62, 0, 0));
  p.add(new THREE.BoxGeometry(3.9, 0.16, 2.1), '#5a3a22', mat(0, 3.05, -0.78, -0.62, 0, 0));
  p.add(new THREE.BoxGeometry(0.9, 1.5, 0.12), '#3a2618', mat(0.6, 1.05, 1.42));
  // Troncos apilados a un lado.
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - row; i++) {
      const y = 0.3 + row * 0.5;
      const z = (i - (2 - row) / 2) * 0.55;
      stick(p, v(2.3, y, z - 0.4), v(4.1, y, z - 0.4), 0.26, row % 2 ? '#7a5230' : '#6b4a2e', 6);
    }
  }
  p.add(new THREE.CylinderGeometry(0.5, 0.58, 0.7, 7), '#6b4a2e', mat(-2.6, 0.35, 1.4));
  stick(p, v(-2.6, 0.7, 1.4), v(-2.9, 1.5, 1.3), 0.045, '#9a7446', 4);
  p.add(new THREE.BoxGeometry(0.4, 0.22, 0.05), '#6d6d70', mat(-2.55, 0.78, 1.42, 0, 0, -0.3));
}

function quarryModel2(p) {
  // Bloques de piedra cortados.
  const blocks = [
    [-1.6, 0.35, 1.2, 1.3, 0.7, 0.9, '#8f8a82'],
    [-0.3, 0.35, 1.5, 1.1, 0.7, 0.8, '#7d786f'],
    [-1.0, 1.0, 1.3, 1.0, 0.6, 0.8, '#9a958c'],
    [1.5, 0.3, -1.4, 1.4, 0.6, 1.1, '#857f76'],
    [0.6, 0.25, -1.9, 0.9, 0.5, 0.7, '#938e85'],
  ];
  for (const [x, y, z, w, h, d, c] of blocks) p.add(new THREE.BoxGeometry(w, h, d), c, mat(x, y, z, 0, x * 0.3, 0));
  // Grúa de madera en forma de A con una polea.
  stick(p, v(-1.2, 0, -0.4), v(0.2, 3.6, -0.4), 0.1, '#6b4a2e', 5);
  stick(p, v(1.6, 0, -0.4), v(0.2, 3.6, -0.4), 0.1, '#6b4a2e', 5);
  stick(p, v(0.2, 3.5, -0.4), v(2.6, 3.9, -0.4), 0.08, '#7a5230', 5);
  stick(p, v(2.5, 3.85, -0.4), v(2.5, 1.6, -0.4), 0.02, '#c8b48a', 3);
  p.add(new THREE.BoxGeometry(0.7, 0.5, 0.6), '#8f8a82', mat(2.5, 1.35, -0.4));
  // Cobertizo con herramientas.
  stick(p, v(1.9, 0, 1.2), v(1.9, 2, 1.2), 0.08, '#6b4a2e', 4);
  stick(p, v(3.1, 0, 1.2), v(3.1, 1.6, 1.2), 0.08, '#6b4a2e', 4);
  stick(p, v(1.9, 0, 2.4), v(1.9, 2, 2.4), 0.08, '#6b4a2e', 4);
  stick(p, v(3.1, 0, 2.4), v(3.1, 1.6, 2.4), 0.08, '#6b4a2e', 4);
  p.add(new THREE.BoxGeometry(1.6, 0.1, 1.6), '#5a3a22', mat(2.5, 1.85, 1.8, 0, 0, -0.3));
  stick(p, v(2.2, 0, 1.6), v(2.4, 1.2, 1.9), 0.035, '#9a7446', 4);
  p.add(new THREE.BoxGeometry(0.5, 0.12, 0.08), '#6d6d70', mat(2.42, 1.22, 1.93, 0, 0, 0.4));
}

// Pozo simple (Edad Tribal): anillo de piedras sueltas, travesaño y cubo de cuero.
function wellModel2(p) {
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2;
    p.add(new THREE.DodecahedronGeometry(0.34, 0), k % 2 ? '#8b877f' : '#9a958c', mat(Math.cos(a) * 1.05, 0.3, Math.sin(a) * 1.05, a, a * 2, 0, 1, 0.8, 1));
    p.add(new THREE.DodecahedronGeometry(0.28, 0), k % 3 ? '#7d786f' : '#938e85', mat(Math.cos(a + 0.3) * 1.0, 0.72, Math.sin(a + 0.3) * 1.0, a, a, 0));
  }
  p.add(new THREE.CircleGeometry(0.8, 10), '#1f3a55', mat(0, 0.55, 0, -Math.PI / 2));
  // Horquetas y travesaño.
  stick(p, v(-1.35, 0, 0), v(-1.3, 2.1, 0), 0.08, '#6b4a2e', 5);
  stick(p, v(1.35, 0, 0), v(1.3, 2.1, 0), 0.08, '#6b4a2e', 5);
  stick(p, v(-1.3, 2.1, 0), v(-1.45, 2.4, 0.1), 0.05, '#6b4a2e', 4);
  stick(p, v(1.3, 2.1, 0), v(1.45, 2.4, 0.1), 0.05, '#6b4a2e', 4);
  stick(p, v(-1.55, 2.12, 0), v(1.55, 2.12, 0), 0.06, '#7a5230', 5);
  stick(p, v(0.1, 2.08, 0), v(0.1, 1.2, 0), 0.015, '#c8b48a', 3);
  p.add(new THREE.CylinderGeometry(0.22, 0.16, 0.32, 7), '#8a5a3a', mat(0.1, 1.05, 0));
}

// ---- Nivel 1: Edad Primitiva ------------------------------------------------

// Enramada: cuatro palos, un techo inclinado de ramas con hojas y cestas de fibra.
function gathererModel1(p) {
  const posts = [[-1.6, -1.3, 2.3], [1.6, -1.3, 2.3], [-1.6, 1.3, 1.5], [1.6, 1.3, 1.5]];
  for (const [x, z, h] of posts) stick(p, v(x, 0, z), v(x * 1.02, h, z), 0.07, '#6b4a2e', 5);
  stick(p, v(-1.8, 2.3, -1.3), v(1.8, 2.3, -1.3), 0.06, '#7a5230', 4);
  stick(p, v(-1.8, 1.5, 1.3), v(1.8, 1.5, 1.3), 0.06, '#7a5230', 4);
  // Ramas del techo y hojas encima.
  for (let k = 0; k < 7; k++) {
    const x = -1.6 + k * 0.53;
    stick(p, v(x, 2.36, -1.6), v(x + 0.1, 1.52, 1.6), 0.035, '#5a3a22', 3);
  }
  for (let k = 0; k < 9; k++) {
    const x = -1.6 + (k % 3) * 1.6;
    const z = -1.1 + Math.floor(k / 3) * 1.1;
    const y = 2.3 - ((z + 1.3) / 2.6) * 0.8 + 0.12;
    p.add(new THREE.IcosahedronGeometry(0.62, 0), k % 2 ? '#5f7f35' : '#6f8f3c', mat(x, y, z, k, k * 2, 0, 1.2, 0.35, 1));
  }
  // Cestas con bayas y un montón de hierbas secas.
  for (const [x, z] of [[-0.8, -0.3], [0.5, 0.2], [2.3, 1.6]]) {
    p.add(new THREE.CylinderGeometry(0.36, 0.28, 0.42, 7), '#b89a5e', mat(x, 0.21, z));
    for (let k = 0; k < 4; k++) {
      p.add(new THREE.IcosahedronGeometry(0.11, 0), k % 2 ? '#b8283a' : '#7a2a6a', mat(x + (k - 1.5) * 0.12, 0.46, z + ((k * 7) % 3 - 1) * 0.1));
    }
  }
  for (let k = 0; k < 6; k++) stick(p, v(-2.4 + k * 0.08, 0, 1.2), v(-2.1 + k * 0.1, 0.9, 1.5 - k * 0.05), 0.03, '#c9b36a', 3);
}

// Zona de tala: un tocón con un hacha de piedra clavada, troncos y astillas.
function woodcutterModel1(p) {
  p.add(new THREE.CylinderGeometry(0.55, 0.7, 0.75, 8), '#6b4a2e', mat(0, 0.37, 0));
  p.add(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 8), '#c9a26a', mat(0, 0.76, 0));
  stick(p, v(0.05, 0.75, 0), v(0.55, 1.45, 0.1), 0.045, '#9a7446', 4);
  p.add(new THREE.DodecahedronGeometry(0.16, 0), '#6d6a64', mat(0.12, 0.84, 0.02, 0, 0, 0, 1.4, 0.7, 0.6));
  for (const [x, z, a] of [[1.6, -0.6, 0.2], [1.7, 0.1, 0.1], [1.65, -0.25, 0.15]]) {
    stick(p, v(x - 1.2, 0.25, z + a), v(x + 1.2, 0.25, z - a), 0.24, '#7a5230', 6);
  }
  stick(p, v(0.5, 0.72, -0.25), v(2.8, 0.72, -0.4), 0.22, '#6b4a2e', 6);
  for (let k = 0; k < 10; k++) {
    const a = k * 2.4;
    p.add(new THREE.BoxGeometry(0.18, 0.04, 0.08), '#c9a26a', mat(Math.cos(a) * (0.9 + (k % 3) * 0.3), 0.02, Math.sin(a) * (0.9 + (k % 3) * 0.3), 0, a, 0));
  }
  // Un pequeño cobertizo de ramas para las herramientas.
  stick(p, v(-1.6, 0, -1.2), v(-1.2, 1.5, -0.6), 0.05, '#5a3a22', 4);
  stick(p, v(-2.2, 0, -0.2), v(-1.2, 1.5, -0.6), 0.05, '#5a3a22', 4);
  stick(p, v(-1.8, 0, 0.6), v(-1.2, 1.5, -0.6), 0.05, '#5a3a22', 4);
}

// Pedrera: piedras sin labrar amontonadas, un percutor y una piel para sentarse.
function quarryModel1(p) {
  const rocks = [
    [-1.0, 0.35, 0.6, 0.6, '#8f8a82'], [-0.2, 0.3, 1.1, 0.5, '#7d786f'], [-0.6, 0.75, 0.9, 0.45, '#9a958c'],
    [0.9, 0.3, -0.9, 0.55, '#857f76'], [1.5, 0.25, -0.2, 0.4, '#938e85'], [0.4, 0.22, -1.5, 0.35, '#8b877f'],
    [-1.6, 0.2, -0.6, 0.35, '#7d786f'], [1.2, 0.62, -0.6, 0.35, '#9a958c'],
  ];
  for (const [x, y, z, r, c] of rocks) p.add(new THREE.DodecahedronGeometry(r, 0), c, mat(x, y, z, x, z, 0, 1, 0.75, 1));
  p.add(new THREE.CylinderGeometry(0.9, 0.9, 0.03, 7), '#a0764a', mat(0.4, 0.02, 0.6, 0, 0.5, 0));
  p.add(new THREE.DodecahedronGeometry(0.14, 0), '#5f5b55', mat(0.6, 0.12, 0.3));
  // Lascas de piedra.
  for (let k = 0; k < 8; k++) {
    const a = k * 2.1;
    p.add(new THREE.TetrahedronGeometry(0.1, 0), '#a8a39a', mat(0.4 + Math.cos(a) * 0.6, 0.05, 0.6 + Math.sin(a) * 0.6, a, a, 0));
  }
}

// Recolector de lluvia: cuatro palos con una piel tensada que desagua en vasijas.
function wellModel1(p) {
  const posts = [[-1.2, -1.0, 1.8], [1.2, -1.0, 1.8], [-1.2, 1.0, 1.4], [1.2, 1.0, 1.4]];
  for (const [x, z, h] of posts) stick(p, v(x, 0, z), v(x, h, z), 0.06, '#6b4a2e', 5);
  // La piel: un cono muy plano invertido (se hunde en el centro).
  p.add(new THREE.ConeGeometry(1.55, 0.45, 8, 1, true), '#a0764a', mat(0, 1.45, 0, Math.PI, Math.PI / 8, 0, 1, 1, 0.8));
  for (const [x, z, h] of posts) stick(p, v(x, h, z), v(x * 0.2, 1.3, z * 0.2), 0.012, '#c8b48a', 3);
  // Vasijas de barro debajo.
  p.add(new THREE.CylinderGeometry(0.3, 0.22, 0.55, 8), '#a8583a', mat(0, 0.27, 0));
  p.add(new THREE.CylinderGeometry(0.18, 0.3, 0.12, 8), '#a8583a', mat(0, 0.6, 0));
  p.add(new THREE.CircleGeometry(0.17, 8), '#2a4a66', mat(0, 0.665, 0, -Math.PI / 2));
  p.add(new THREE.CylinderGeometry(0.24, 0.18, 0.42, 8), '#b8683a', mat(0.7, 0.21, 0.5));
  p.add(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 8), '#98482a', mat(-0.65, 0.17, 0.55));
}

// Pila de troncos y cestas (almacén primitivo).
function stockpileModel1(p) {
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const y = 0.26 + row * 0.44;
      const z = -1.2 + (i - (3 - row) / 2) * 0.48;
      stick(p, v(-1.9, y, z), v(0.2, y, z), 0.23, (i + row) % 2 ? '#7a5230' : '#6b4a2e', 6);
    }
  }
  for (const [x, z, s] of [[1.1, -0.9, 1], [1.7, -0.2, 0.85], [1.0, 0.5, 0.9], [-0.6, 0.9, 1.05]]) {
    p.add(new THREE.CylinderGeometry(0.42 * s, 0.34 * s, 0.6 * s, 8), '#b89a5e', mat(x, 0.3 * s, z));
    p.add(new THREE.CylinderGeometry(0.43 * s, 0.43 * s, 0.05, 8), '#8f7442', mat(x, 0.6 * s, z));
  }
  p.add(new THREE.IcosahedronGeometry(0.3, 0), '#b8283a', mat(1.1, 0.68, -0.9, 0, 0, 0, 1, 0.5, 1));
  p.add(new THREE.DodecahedronGeometry(0.3, 0), '#8f8a82', mat(1.7, 0.6, -0.2, 0, 0, 0, 1, 0.5, 1));
  // Piedras amontonadas y una piel encima de la leña.
  for (let k = 0; k < 6; k++) p.add(new THREE.DodecahedronGeometry(0.26, 0), k % 2 ? '#8f8a82' : '#7d786f', mat(-1.6 + (k % 3) * 0.45, 0.2 + Math.floor(k / 3) * 0.3, 1.2, k, k, 0));
  p.add(new THREE.BoxGeometry(1.6, 0.05, 1.3), '#a0764a', mat(-0.8, 1.42, -1.2, 0.1, 0, 0.06));
  stick(p, v(-1.4, 0, 0.2), v(-1.3, 1.2, 0.1), 0.05, '#5a3a22', 4);
}

// Granero: choza sobre pilotes con techo de paja y escalera.
function stockpileModel2(p) {
  for (const [x, z] of [[-1.3, -1.1], [1.3, -1.1], [-1.3, 1.1], [1.3, 1.1]]) {
    stick(p, v(x, 0, z), v(x, 0.9, z), 0.1, '#5a3a22', 5);
    p.add(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 8), '#8f8a82', mat(x, 0.92, z));
  }
  p.add(new THREE.BoxGeometry(3.1, 0.15, 2.7), '#6b4a2e', mat(0, 1.0, 0));
  p.add(new THREE.CylinderGeometry(1.35, 1.35, 1.5, 10), '#a07a4a', mat(0, 1.8, 0));
  p.add(new THREE.ConeGeometry(1.9, 1.7, 10), '#c9a45a', mat(0, 3.35, 0));
  p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 6), '#a8843e', mat(0, 4.25, 0));
  p.add(new THREE.BoxGeometry(0.7, 1.0, 0.1), '#3a2618', mat(0, 1.6, 1.33));
  stick(p, v(-0.3, 0, 2.3), v(-0.3, 1.05, 1.4), 0.04, '#7a5230', 4);
  stick(p, v(0.3, 0, 2.3), v(0.3, 1.05, 1.4), 0.04, '#7a5230', 4);
  for (let k = 1; k < 4; k++) stick(p, v(-0.3, k * 0.26, 2.3 - k * 0.22), v(0.3, k * 0.26, 2.3 - k * 0.22), 0.03, '#7a5230', 3);
  for (const [x, z] of [[2.0, 0.6], [2.2, -0.4]]) p.add(new THREE.CylinderGeometry(0.34, 0.28, 0.5, 8), '#b89a5e', mat(x, 0.25, z));
}

// Andamio de obra: base de tablones y cuatro postes.
function frameModel(p, footprint) {
  const s = footprint * 1.6;
  p.add(new THREE.BoxGeometry(s, 0.15, s), '#8a643c', mat(0, 0.07, 0));
  const c = footprint * 0.75;
  for (const [x, z] of [[c, c], [-c, c], [c, -c], [-c, -c]]) stick(p, v(x, 0, z), v(x, 2.8, z), 0.09, '#a07a4a', 5);
  stick(p, v(-c, 2.6, c), v(c, 2.6, c), 0.06, '#a07a4a', 4);
  stick(p, v(-c, 2.6, -c), v(c, 2.6, -c), 0.06, '#a07a4a', 4);
}

const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide });

function buildMesh(fn, ...args) {
  const parts = new Parts();
  fn(parts, ...args);
  const mesh = parts.mesh(material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Sistema
// ---------------------------------------------------------------------------

export class BuildingSystem {
  constructor({ scene, camera, canvas, colony, terrain, labelsRoot }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.colony = colony;
    this.terrain = terrain;
    this.labelsRoot = labelsRoot;
    this.list = colony.buildings; // la misma lista que usa la IA
    this.placing = null; // tipo que se está colocando
    this.pointer = null;
    this.candidate = null;
    this.selected = null;
    this.onSelect = null;
    this.onChange = null; // la interfaz se actualiza
    this.nextId = 1;
    this.saveTimer = 0;
    this.assignTimer = 0;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();

    // Vista previa al colocar.
    this.ghost = new THREE.Group();
    this.ghostRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.25, 40),
      new THREE.MeshBasicMaterial({ color: '#5fe08a', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.position.y = 0.3;
    this.ghost.visible = false;
    scene.add(this.ghost);

    // Aro bajo el edificio elegido.
    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.15, 40),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.position.y = 0.25;

    colony.onCampChange = (camp) => this.load(camp);

    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
    });
    let pressed = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) pressed = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      const p = pressed;
      pressed = null;
      if (!p || e.button !== 0 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_TOLERANCE) return;
      if (this.placing) {
        this.pointer = { x: e.clientX, y: e.clientY };
        this.updateCandidate();
        if (this.candidate && !this.candidate.problem) this.place(this.candidate);
        return;
      }
      if (this.blockSelection?.()) return;
      // Un colono delante tiene prioridad sobre el edificio.
      if (colony.pickAt(e.clientX, e.clientY)) {
        this.select(null);
        return;
      }
      this.select(this.pickAt(e.clientX, e.clientY));
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.placing) this.stopPlacing();
      else if (this.selected) this.select(null);
    });
  }

  // ---- Materiales ----------------------------------------------------------

  canAfford(def) {
    const stock = this.colony.stock;
    return Object.entries(def.cost).every(([k, n]) => stock[k] >= n);
  }

  missing(def) {
    const stock = this.colony.stock;
    return Object.entries(def.cost)
      .filter(([k, n]) => stock[k] < n)
      .map(([k, n]) => `${Math.ceil(n - stock[k])} de ${STOCK_NAMES[k]}`);
  }

  // ---- Colocar -------------------------------------------------------------

  startPlacing(id) {
    if (!this.colony.camp) return;
    this.select(null);
    this.onPlacingStart?.();
    this.placing = BUILDINGS[id];
    this.ghost.clear();
    const model = buildMesh(this.placing.levels[0].model);
    model.material = material.clone();
    model.material.transparent = true;
    model.material.opacity = 0.55;
    model.material.depthWrite = false;
    this.ghost.add(model);
    const r = this.placing.footprint + 0.4;
    this.ghostRing.scale.setScalar(r);
    this.ghost.add(this.ghostRing);
    this.canvas.classList.add('is-placing');
    this.onChange?.();
  }

  stopPlacing() {
    this.placing = null;
    this.candidate = null;
    this.ghost.visible = false;
    this.canvas.classList.remove('is-placing');
    this.onChange?.();
  }

  // Punto del suelo bajo el puntero, en coordenadas del campamento, y si se puede construir.
  updateCandidate() {
    this.candidate = null;
    if (!this.pointer || !this.placing) return;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((this.pointer.x - rect.left) / rect.width) * 2 - 1, -((this.pointer.y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = pickSurface(this.raycaster.ray, this.colony.camp.height);
    if (!hit) return;
    const local = this.colony.toLocal(hit.point, this.tmp);
    const x = local.x;
    const z = local.z;
    this.candidate = { x, z, problem: this.problemAt(this.placing, x, z) };
  }

  problemAt(def, x, z) {
    const colony = this.colony;
    if (!this.canAfford(def)) return `Faltan ${this.missing(def).join(' y ')}`;
    if (Math.hypot(x, z) > MAX_DISTANCE) return 'Demasiado lejos del campamento';
    const r = def.footprint;
    for (const o of colony.obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.r + r + 0.8) return 'Choca con otra construcción';
    }
    for (const zone of colony.zones) {
      if (Math.hypot(x - zone.x, z - zone.z) < zone.r + r + 0.5) return 'Choca con una zona de acopio';
    }
    const h = colony.heightAt(x, z);
    if (h <= 0.8) return 'No se puede construir en el agua';
    let lo = h;
    let hi = h;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const hk = colony.heightAt(x + Math.cos(a) * (r + 1), z + Math.sin(a) * (r + 1));
      if (hk <= 0.8) return 'Demasiado cerca del agua';
      lo = Math.min(lo, hk);
      hi = Math.max(hi, hk);
    }
    if (hi - lo > r * 1.1) return 'El terreno es demasiado empinado';
    return null;
  }

  place({ x, z }) {
    const def = this.placing;
    for (const [k, n] of Object.entries(def.cost)) this.colony.takeStock(k, n);
    const b = this.create(def, x, z, Math.atan2(-x, -z), 0, 0);
    this.stopPlacing();
    this.select(b);
    this.save();
  }

  // ---- Crear y quitar ------------------------------------------------------

  create(def, x, z, yaw, progress, produced, level = 1) {
    const colony = this.colony;
    const height = colony.heightAt(x, z);
    const dir = colony.toDirection(x, z, new THREE.Vector3());
    const ground = biomeAt(dir.x, dir.y, dir.z);
    // Aplanar el terreno bajo el edificio y pintar un poco de tierra.
    const zone = addTerrainZone({
      dir: dir.clone(),
      height,
      flatRadius: def.footprint + 1,
      blendRadius: 5,
      clearRadius: def.footprint + 0.8,
      detailRadius: 0,
      dirtColor: (ground.details ? ground : BIOMES.grassland).dirt,
      resourceClear: def.footprint + 3,
    });
    this.terrain.invalidateZone(zone);
    colony.heights.clear();

    const object = new THREE.Group();
    object.position.copy(dir).multiplyScalar(RADIUS + height);
    object.quaternion.copy(colony.camp.object.quaternion).multiply(this.tmpQuat.setFromAxisAngle(Y_AXIS, yaw));
    const model = buildMesh(def.levels[level - 1].model);
    const frame = buildMesh(frameModel, def.footprint);
    object.add(model, frame);
    this.scene.add(object);

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'building-label';
    label.innerHTML = `<span class="building-label-name"></span><span class="building-label-sub"></span><span class="building-label-bar"><i></i></span>`;
    label.hidden = true;
    this.labelsRoot.appendChild(label);

    const b = {
      id: this.nextId++,
      def,
      x,
      z,
      yaw,
      height,
      dir,
      progress,
      done: false,
      produced,
      level,
      upgrading: false,
      store: 0, // agua juntada por el recolector de lluvia
      get name() {
        return this.def.levels[this.level - 1].name;
      },
      worker: null,
      reason: '',
      status: null,
      object,
      model,
      frame,
      label,
      zone,
      finish: (builder) => this.finish(b, builder),
    };
    label.querySelector('.building-label-name').textContent = b.name;
    label.addEventListener('click', () => this.select(b));
    this.list.push(b);
    colony.refreshObstacles();
    if (progress >= 1) this.finish(b, null, true);
    this.updateVisual(b);
    this.onChange?.();
    return b;
  }

  // El almacén del campamento (vasijas y cestas junto a la fogata): no es un edificio
  // construido, pero se puede elegir para ver lo guardado y cuánto cabe.
  createCampStore() {
    if (this.store) {
      this.scene.remove(this.store.object);
      this.store.label.remove();
      this.store = null;
    }
    const colony = this.colony;
    if (!colony.camp) return;
    const { x, z } = colony.layout.pots;
    const height = colony.heightAt(x, z);
    const dir = colony.toDirection(x, z, new THREE.Vector3());
    const object = new THREE.Group();
    object.position.copy(dir).multiplyScalar(RADIUS + height);
    object.quaternion.copy(colony.camp.object.quaternion);
    this.scene.add(object);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'building-label building-label--store';
    label.innerHTML = `<span class="building-label-name">Almacén</span><span class="building-label-sub"></span><span class="building-label-bar" hidden><i></i></span>`;
    label.hidden = true;
    this.labelsRoot.appendChild(label);
    const store = {
      isStore: true,
      name: 'Almacén del campamento',
      def: { id: 'campstore', icon: 'wood', footprint: 2.2 },
      x,
      z,
      dir,
      object,
      label,
      done: true,
    };
    label.addEventListener('click', () => this.select(store));
    this.store = store;
  }

  // Lo más lleno del almacén (0–1), para la etiqueta.
  storeFill() {
    let fill = 0;
    for (const k of Object.keys(STOCK_NAMES)) fill = Math.max(fill, Math.min(1, this.colony.indoor(k) / this.colony.capacity(k)));
    return fill;
  }

  removeAll() {
    for (const b of this.list) {
      this.scene.remove(b.object);
      b.label.remove();
      b.removed = true;
      removeTerrainZone(b.zone);
      this.terrain.invalidateZone(b.zone);
      b.object.traverse((o) => o.geometry?.dispose());
    }
    this.list.length = 0;
    this.select(null);
  }

  finish(b, builder, silent = false) {
    if (b.done) return;
    b.progress = 1;
    b.done = true;
    b.frame.visible = false;
    const time = this.timeLabel?.() ?? '';
    if (b.upgrading) {
      // La mejora cambia el nivel, el nombre y el modelo.
      const old = b.name;
      b.upgrading = false;
      b.level++;
      this.setModel(b);
      if (builder && !silent) addLog(builder, time, `Terminó de mejorar ${old}: ahora es ${b.name}`);
      if (b.worker && b.worker !== builder && !silent) addLog(b.worker, time, `Su lugar de trabajo ahora es ${b.name}`);
    } else if (builder && !silent) {
      addLog(builder, time, `Terminó de construir: ${b.name}`);
    }
    this.assignWorker(b);
    this.updateVisual(b);
    this.save();
    this.onChange?.();
  }

  setModel(b) {
    b.object.remove(b.model);
    b.model.geometry.dispose();
    b.model = buildMesh(levelOf(b).model);
    b.object.add(b.model);
    b.label.querySelector('.building-label-name').textContent = b.name;
  }

  // ---- Mejoras ---------------------------------------------------------------

  // Por qué no se puede mejorar (o null si se puede).
  upgradeProblem(b) {
    const next = levelOf(b, 1);
    if (!b.done) return b.upgrading ? 'Ya se está mejorando' : 'Primero hay que terminar la obra';
    if (!next) return `Más mejoras en la ${ageInfo(b.level + 1).name} (próximamente)`;
    if (b.level + 1 > this.colony.age + 1) return `Hace falta llegar a la ${ageInfo(b.level).name}`;
    if (!this.canAfford({ cost: next.upgradeCost })) return `Faltan ${this.missing({ cost: next.upgradeCost }).join(' y ')}`;
    return null;
  }

  // Pagar la mejora y dejarla en obra: los constructores vienen a hacerla. El trabajador
  // se queda asignado y vuelve a trabajar cuando termina.
  upgrade(b) {
    if (this.upgradeProblem(b)) return false;
    const next = levelOf(b, 1);
    for (const [k, n] of Object.entries(next.upgradeCost)) this.colony.takeStock(k, n);
    b.upgrading = true;
    b.done = false;
    b.progress = 0;
    b.buildTime = b.def.buildTime * (1 + b.level * 0.4);
    b.frame.visible = true;
    this.updateVisual(b);
    this.save();
    this.onChange?.();
    return true;
  }

  // ---- Trabajadores --------------------------------------------------------

  // Puntuación de un colono para un oficio: su habilidad y su actitud.
  aptitude(c, def) {
    return c.skills[def.skill] + (hasTrait(c, 'hardworking') ? 0.8 : 0) - (hasTrait(c, 'lazy') ? 1.2 : 0);
  }

  // Colonos ordenados de más a menos capacitados para un edificio.
  ranking(b) {
    return [...this.colony.colonists].sort((a, c) => this.aptitude(c, b.def) - this.aptitude(a, b.def));
  }

  // La colonia elige al colono libre más capacitado.
  assignWorker(b) {
    if (!b.done || b.worker || !b.def.skill) return;
    const free = this.ranking(b).filter((c) => !c.job);
    if (!free.length) {
      b.reason = 'No hay colonos libres. Puedes elegir a uno de la lista.';
      return;
    }
    const best = free[0];
    const skillName = SKILLS.find((s) => s.id === b.def.skill).name;
    const others = free.length > 1 ? ' entre los colonos libres' : '';
    this.setWorker(b, best, `La colonia le eligió por tener la mejor ${skillName.toLowerCase()} (${best.skills[b.def.skill]}/10)${others}.`);
  }

  // Asignar a mano (desde la ficha del edificio).
  setWorker(b, c, reason = 'Elegido por ti.') {
    if (c.job && c.job !== b) {
      const old = c.job;
      old.worker = null;
      old.reason = `${c.name} se fue a trabajar a ${b.name}.`;
    }
    if (b.worker && b.worker !== c) b.worker.job = null;
    b.worker = c;
    b.reason = reason;
    c.job = b;
    addLog(c, this.timeLabel?.() ?? '', `Ahora trabaja en: ${b.name}`);
    this.save();
    this.onChange?.();
  }

  // ---- Selección -----------------------------------------------------------

  select(b) {
    if (this.selected === b) return;
    if (this.selected) this.selected.label.classList.remove('is-selected');
    this.selected = b;
    this.selectRing.removeFromParent();
    if (b) {
      b.label.classList.add('is-selected');
      this.selectRing.scale.setScalar(b.def.footprint + 0.8);
      b.object.add(this.selectRing);
    }
    this.onSelect?.(b);
  }

  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    let best = null;
    let bestD = Infinity;
    for (const b of this.store ? [...this.list, this.store] : this.list) {
      const p = this.tmp.copy(b.object.position).addScaledVector(b.dir, 1.5);
      const dist3 = this.camera.position.distanceTo(p);
      p.project(this.camera);
      if (p.z > 1) continue;
      const x = rect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - p.y) / 2) * rect.height;
      const pxPerMeter = rect.height / (2 * dist3 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
      const radius = Math.max(24, pxPerMeter * b.def.footprint * 1.1);
      const d = Math.hypot(clientX - x, clientY - y);
      if (d < radius && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  // ---- Cada fotograma --------------------------------------------------------

  update(delta, { timeLabel, timeScale = 1 } = {}) {
    this.timeLabel = timeLabel;
    // El recolector de lluvia se llena solo: mucho con lluvia y un poco con el rocío.
    const rain = this.colony.weather?.rain ?? 0;
    const gameDt = delta * timeScale;
    for (const b of this.list) {
      const lv = b.done && levelOf(b);
      if (lv?.rainOnly) b.store = Math.min(lv.capacity, b.store + (0.004 + rain * 0.08) * gameDt);
    }
    if (this.placing) {
      this.updateCandidate();
      const c = this.candidate;
      this.ghost.visible = !!c;
      if (c) {
        const colony = this.colony;
        const dir = colony.toDirection(c.x, c.z, this.tmp);
        this.ghost.position.copy(dir).multiplyScalar(RADIUS + colony.heightAt(c.x, c.z));
        this.ghost.quaternion.copy(colony.camp.object.quaternion).multiply(this.tmpQuat.setFromAxisAngle(Y_AXIS, Math.atan2(-c.x, -c.z)));
        this.ghostRing.material.color.set(c.problem ? '#ff5a4f' : '#5fe08a');
      }
    }
    for (const b of this.list) this.updateVisual(b);
    this.updateLabels();

    this.assignTimer -= delta;
    if (this.assignTimer <= 0) {
      this.assignTimer = 1;
      for (const b of this.list) this.assignWorker(b);
    }
    this.saveTimer -= delta;
    if (this.saveTimer <= 0) {
      this.saveTimer = 5;
      this.save();
    }
  }

  // La obra "crece" desde el suelo mientras se construye.
  updateVisual(b) {
    // Una obra nueva crece desde el suelo; una mejora mantiene el edificio con andamios.
    const s = b.done || b.upgrading ? 1 : 0.06 + 0.94 * b.progress;
    b.model.scale.set(1, s, 1);
    b.frame.visible = !b.done;
  }

  updateLabels() {
    const rect = this.canvas.getBoundingClientRect();
    for (const b of this.store ? [...this.list, this.store] : this.list) {
      const p = this.tmp.copy(b.object.position).addScaledVector(b.dir, b.isStore ? 2.4 : b.done ? 4.6 : 3.4);
      const dist = this.camera.position.distanceTo(p);
      p.project(this.camera);
      const visible = dist < LABEL_DISTANCE && p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      b.label.hidden = !visible;
      if (!visible) continue;
      const sub = b.label.querySelector('.building-label-sub');
      const bar = b.label.querySelector('.building-label-bar');
      const text = b.isStore
        ? `${Math.round(this.storeFill() * 100)}% lleno`
        : b.done && b.def.id === 'stockpile'
          ? 'Almacén'
          : b.done ? (b.worker ? b.worker.name : 'Sin trabajador') : `${b.upgrading ? 'Mejorando' : 'En obra'} · ${Math.round(b.progress * 100)}%`;
      if (sub.textContent !== text) sub.textContent = text;
      bar.hidden = b.done;
      if (!b.done) bar.firstChild.style.width = `${Math.round(b.progress * 100)}%`;
      const x = rect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - p.y) / 2) * rect.height;
      b.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  // ---- Guardado --------------------------------------------------------------

  save() {
    const camp = this.colony.camp;
    if (!camp || this.loading) return;
    const data = {
      version: SAVE_VERSION,
      campSeed: camp.seed,
      savedAt: Date.now(),
      stock: this.colony.stock,
      colony: this.colony.serialize(),
      world: this.world?.save() ?? null,
      buildings: this.list.map((b) => ({
        type: b.def.id,
        x: b.x,
        z: b.z,
        yaw: b.yaw,
        progress: b.progress,
        produced: b.produced,
        level: b.level,
        upgrading: b.upgrading,
        store: b.store,
        worker: b.worker ? b.worker.id : null,
      })),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Sin almacenamiento: la colonia dura sólo esta sesión.
    }
  }

  load(camp) {
    this.removeAll();
    this.stopPlacing();
    this.createCampStore();
    if (!camp) return;
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      data = null;
    }
    // Sólo si es la colonia de este mismo campamento (versión 1 = sin colonos).
    if (!data || !(data.version >= 1 && data.version <= SAVE_VERSION) || data.campSeed !== camp.seed) {
      this.save();
      return;
    }
    this.loading = true; // que crear edificios no guarde a medias
    Object.assign(this.colony.stock, data.stock);
    for (const s of data.buildings || []) {
      const def = BUILDINGS[s.type];
      if (!def) continue;
      const level = Math.min(def.levels.length, Math.max(1, s.level || 1));
      const b = this.create(def, s.x, s.z, s.yaw, s.upgrading ? 1 : s.progress, s.produced || 0, level);
      b.store = s.store || 0;
      if (s.upgrading && levelOf(b, 1)) {
        b.upgrading = true;
        b.done = false;
        b.progress = s.progress;
        b.buildTime = def.buildTime * (1 + b.level * 0.4);
        b.frame.visible = true;
        this.updateVisual(b);
      }
      const worker = this.colony.colonists.find((c) => c.id === s.worker);
      if (b.done && worker) {
        if (b.worker) b.worker.job = null;
        b.worker = worker;
        worker.job = b;
        b.reason = 'Trabajaba aquí antes.';
      }
    }
    // Necesidades, salud, posición y registro de cada colono; recursos agotados; reloj.
    this.colony.restore(data.colony);
    if (data.world) this.world?.load(data.world);
    this.loading = false;
    this.onChange?.();
  }
}
