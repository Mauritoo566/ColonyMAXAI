// Tipos de recurso natural: datos puros (sin Three.js), los usa también el Web Worker.
//   biomes: cantidad media por baldosa de 320 × 320 m en cada bioma.
//   clustered: se agrupan en bosques (ruido de ~1 km).
//   ore: sólo aparecen donde el ruido de vetas supera este valor (minerales).
//   maxDistance: más lejos no se dibujan (los objetos pequeños no se verían).
//   lodDistance: más lejos se dibuja la versión simple del modelo.

export const TILE = 320; // metros por baldosa

export const RESOURCE_TYPES = [
  {
    id: 'broadleaf',
    name: 'Árbol frondoso',
    gives: 'Madera dura',
    scale: [0.8, 1.35],
    clustered: true,
    biomes: { forest: 300, grassland: 35, swamp: 50, steppe: 6 },
  },
  {
    id: 'pine',
    name: 'Pino',
    gives: 'Madera blanda y resina',
    scale: [0.8, 1.4],
    clustered: true,
    biomes: { taiga: 340, forest: 80, mountain: 25, tundra: 6 },
  },
  {
    id: 'jungleTree',
    name: 'Árbol tropical',
    gives: 'Madera dura y frutas',
    scale: [0.9, 1.4],
    clustered: true,
    biomes: { jungle: 360, swamp: 30 },
  },
  {
    id: 'acacia',
    name: 'Acacia',
    gives: 'Madera y sombra',
    scale: [0.8, 1.2],
    clustered: true,
    biomes: { savanna: 28, steppe: 6 },
  },
  {
    id: 'palm',
    name: 'Palmera',
    gives: 'Cocos y fibras',
    scale: [0.8, 1.2],
    biomes: { beach: 10, jungle: 6 },
  },
  { id: 'cactus', name: 'Cactus', gives: 'Agua y fibras', scale: [0.7, 1.3], biomes: { desert: 10 }, maxDistance: 1200 },
  {
    id: 'berryBush',
    name: 'Arbusto de bayas',
    gives: 'Comida',
    scale: [0.8, 1.3],
    biomes: { grassland: 18, forest: 12, taiga: 8, savanna: 5, jungle: 8, steppe: 3 },
    maxDistance: 700,
  },
  {
    id: 'mushrooms',
    name: 'Setas',
    gives: 'Comida',
    scale: [0.8, 1.3],
    biomes: { forest: 6, taiga: 6, jungle: 4, swamp: 6 },
    maxDistance: 250,
  },
  { id: 'reeds', name: 'Juncos', gives: 'Fibras y techos', scale: [0.8, 1.2], biomes: { swamp: 40, beach: 3 }, maxDistance: 600 },
  {
    id: 'stone',
    name: 'Piedras',
    gives: 'Piedra',
    scale: [0.7, 1.6],
    biomes: { mountain: 24, tundra: 12, desert: 8, steppe: 6, grassland: 4, forest: 3, taiga: 4, savanna: 4, snow: 4, beach: 2 },
    maxDistance: 1200,
  },
  {
    id: 'flint',
    name: 'Pedernal',
    gives: 'Herramientas de piedra',
    scale: [0.7, 1.1],
    biomes: { grassland: 1.5, steppe: 2, forest: 1, desert: 1.5 },
    maxDistance: 350,
  },
  { id: 'clay', name: 'Arcilla', gives: 'Cerámica y ladrillos', scale: [0.8, 1.3], biomes: { swamp: 6, beach: 2, grassland: 0.6 }, maxDistance: 700 },
  { id: 'copper', name: 'Veta de cobre', gives: 'Cobre', scale: [0.9, 1.3], ore: 0.45, biomes: { mountain: 4, desert: 2, steppe: 1, tundra: 1 } },
  { id: 'iron', name: 'Veta de hierro', gives: 'Hierro', scale: [0.9, 1.3], ore: 0.5, biomes: { mountain: 4, tundra: 2, taiga: 1, snow: 1.5 } },
  { id: 'gold', name: 'Veta de oro', gives: 'Oro', scale: [0.9, 1.2], ore: 0.62, biomes: { mountain: 2, desert: 0.8, jungle: 0.4 } },
  { id: 'salt', name: 'Salinas', gives: 'Sal', scale: [0.8, 1.3], ore: 0.35, biomes: { desert: 3, beach: 1, steppe: 1 }, maxDistance: 900 },
  // Palos y ramas caídos: se recogen del suelo sin herramientas (es la madera de la Edad Primitiva).
  // Va al final de la lista para no cambiar dónde está todo lo demás en el mundo.
  { id: 'sticks', name: 'Palos y ramas caídos', gives: 'Madera y fibra', scale: [0.8, 1.3], clustered: true, biomes: { forest: 90, taiga: 70, jungle: 60, swamp: 30, grassland: 28, savanna: 14, steppe: 8, tundra: 8, mountain: 6, desert: 3 }, maxDistance: 260 },
  // Piedrecitas sueltas del suelo: la piedra de la Edad Primitiva (antes de picar piedras grandes).
  // Misma densidad que "stone" (que en Primitiva no se puede tocar). Al final de la lista por lo mismo que "sticks".
  { id: 'pebbles', name: 'Piedrecitas sueltas', gives: 'Piedra', scale: [0.5, 0.9], clustered: true, biomes: { mountain: 24, tundra: 12, desert: 8, steppe: 6, grassland: 4, forest: 3, taiga: 4, savanna: 4, snow: 4, beach: 2 }, maxDistance: 1200 },
];
