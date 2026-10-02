// Catálogo de recursos y bienes de la colonia (datos puros). Cada bien tiene la edad en la
// que aparece, de qué grupo es y para qué sirve: no hay recursos sin utilidad. Lo que se
// guarda en el almacén (colony.stock) usa estos mismos identificadores.

// group: 'raw' (de la naturaleza), 'processed' (de un taller), 'tool' (herramientas),
// 'food', 'currency', 'knowledge', 'arms' (equipo militar).
export const GOODS = [
  { id: 'food', name: 'comida', icon: 'food', color: 'var(--food)', age: 1, group: 'food', use: 'Alimenta a los colonos.' },
  { id: 'water', name: 'agua', icon: 'water', color: 'var(--water)', age: 1, group: 'raw', use: 'Beben todos; la piden cultivos y vapor.' },
  { id: 'wood', name: 'madera', icon: 'wood', color: '#c08a52', age: 1, group: 'raw', use: 'Construcción, combustible y la mayoría de las recetas.' },
  { id: 'stone', name: 'piedra', icon: 'stone', color: '#a8a39a', age: 1, group: 'raw', use: 'Construcción, sillares y hormigón.' },
  { id: 'fiber', name: 'fibras', icon: 'fiber', color: '#b5c46a', age: 1, group: 'raw', use: 'Cuerdas, techos y telas.' },
  { id: 'grain', name: 'grano', icon: 'grain', color: '#e0c25a', age: 2, group: 'raw', use: 'Se hornea en pan o se muele en harina.' },
  { id: 'vegetables', name: 'verduras', icon: 'food', color: '#7ab547', age: 2, group: 'food', use: 'Alimenta a los colonos.' },
  { id: 'tree_seed', name: 'semilla de árbol', icon: 'leaf', color: '#8a6a3a', age: 2, group: 'seed', use: 'Plantá una donde quieras: nace el árbol propio de ese bioma.' },
  { id: 'clay', name: 'arcilla', icon: 'clay', color: '#b86a44', age: 2, group: 'raw', use: 'Cerámica y ladrillos.' },
  { id: 'copper', name: 'cobre', icon: 'ore', color: '#c8743c', age: 3, group: 'raw', use: 'Con estaño se funde en bronce; después, electrónica.' },
  { id: 'tin', name: 'estaño', icon: 'ore', color: '#9fb0b8', age: 3, group: 'raw', use: 'Aleación del bronce.' },
  { id: 'bronze', name: 'bronce', icon: 'ingot', color: '#c9964a', age: 3, group: 'processed', use: 'Herramientas y armas de bronce.' },
  { id: 'bronze_tools', name: 'herramientas de bronce', icon: 'tool', color: '#d6a24e', age: 3, group: 'tool', use: 'Mejoras que piden herramientas de bronce.' },
  { id: 'pottery', name: 'cerámica', icon: 'pot', color: '#c4693f', age: 3, group: 'processed', use: 'Vasijas para almacenes y pozos; tejas.' },
  { id: 'bread', name: 'pan', icon: 'bread', color: '#e5b866', age: 3, group: 'food', use: 'Comida que sacia más que las bayas.' },
  { id: 'iron_ore', name: 'mineral de hierro', icon: 'ore', color: '#8a5a4a', age: 4, group: 'raw', use: 'Se funde en hierro.' },
  { id: 'charcoal', name: 'carbón vegetal', icon: 'charcoal', color: '#4a4540', age: 4, group: 'processed', use: 'Combustible de los hornos de hierro.' },
  { id: 'iron', name: 'hierro', icon: 'ingot', color: '#9aa3ab', age: 4, group: 'processed', use: 'Herramientas, armas y acero.' },
  { id: 'iron_tools', name: 'herramientas de hierro', icon: 'tool', color: '#b4bcc4', age: 4, group: 'tool', use: 'Mejoras de extracción y agricultura.' },
  { id: 'cut_stone', name: 'sillares', icon: 'block', color: '#c2bcae', age: 5, group: 'processed', use: 'Mampostería, acueductos y murallas.' },
  { id: 'coin', name: 'monedas', icon: 'coin', color: '#e8c35a', age: 5, group: 'currency', use: 'Se obtienen vendiendo excedentes en el mercado y sirven para comprar y mantener tropas.' },
  { id: 'planks', name: 'tablones', icon: 'plank', color: '#d1a56b', age: 6, group: 'processed', use: 'Construcciones elaboradas y talleres.' },
  { id: 'flour', name: 'harina', icon: 'flour', color: '#f1e6c8', age: 6, group: 'processed', use: 'Amasa pan mucho más rendidor.' },
  { id: 'cloth', name: 'tela', icon: 'cloth', color: '#d8cdb8', age: 6, group: 'processed', use: 'Ropa de oficio, estudios y velas.' },
  { id: 'powder', name: 'pólvora', icon: 'powder', color: '#6a6660', age: 7, group: 'processed', use: 'Artillería y fortificaciones.' },
  { id: 'instruments', name: 'instrumentos de precisión', icon: 'gear', color: '#9fb6c8', age: 7, group: 'tool', use: 'Talleres avanzados y mejoras de precisión.' },
  { id: 'knowledge', name: 'conocimiento', icon: 'book', color: '#8fb4e8', age: 7, group: 'knowledge', use: 'Se gasta en investigar tecnologías.' },
  { id: 'coal', name: 'carbón mineral', icon: 'ore', color: '#3a3a40', age: 8, group: 'raw', use: 'Combustible de la industria y la energía.' },
  { id: 'steel', name: 'acero', icon: 'beam', color: '#a9b8c8', age: 8, group: 'processed', use: 'Maquinaria, estructuras y equipo.' },
  { id: 'bricks', name: 'ladrillos', icon: 'brick', color: '#b85a3e', age: 8, group: 'processed', use: 'Casas de ladrillo y edificios residenciales.' },
  { id: 'machinery', name: 'maquinaria', icon: 'gear', color: '#7f93a6', age: 8, group: 'tool', use: 'Fábricas, minas y granjas mecanizadas.' },
  { id: 'concrete', name: 'hormigón', icon: 'block', color: '#9a9a96', age: 9, group: 'processed', use: 'Edificios altos y refugios.' },
  { id: 'electronics', name: 'electrónica', icon: 'chip', color: '#5ad0a0', age: 10, group: 'tool', use: 'Automatización y tecnología avanzada.' },
  { id: 'arms_bronze', name: 'armas de bronce', icon: 'sword', color: '#d6a24e', age: 3, group: 'arms', use: 'Equipo de las primeras tropas.' },
  { id: 'arms_iron', name: 'armas de hierro', icon: 'sword', color: '#b4bcc4', age: 4, group: 'arms', use: 'Equipo de infantería y arqueros.' },
  { id: 'arms_forged', name: 'armas forjadas', icon: 'sword', color: '#c6ced6', age: 6, group: 'arms', use: 'Armaduras y armas medievales.' },
  { id: 'arms_steel', name: 'armas de acero', icon: 'sword', color: '#d3dde8', age: 8, group: 'arms', use: 'Armamento industrial.' },
  { id: 'arms_modern', name: 'equipo moderno', icon: 'sword', color: '#9fc0a8', age: 9, group: 'arms', use: 'Vehículos y armamento mecanizado.' },
  { id: 'arms_adv', name: 'equipo avanzado', icon: 'sword', color: '#7fe0c0', age: 10, group: 'arms', use: 'Sistemas militares tecnológicos.' },
];

export const GOODS_BY_ID = Object.fromEntries(GOODS.map((g) => [g.id, g]));

// Nombres para los textos de costes y faltantes (los de siempre más los nuevos).
export const GOOD_NAMES = Object.fromEntries(GOODS.map((g) => [g.id, g.name]));

// Los cinco recursos con los que empieza la colonia (y su capacidad en el campamento).
export const BASE_GOODS = ['food', 'water', 'wood', 'stone', 'fiber'];

// Bienes que se pueden comprar y vender en el mercado (no se comercia ni con conocimiento
// ni con equipo militar), y su valor en monedas por unidad.
export const TRADE_VALUE = {
  food: 1, water: 0.5, wood: 1, stone: 1.2, fiber: 1, grain: 1.2, vegetables: 1.3, clay: 1, copper: 2.5, tin: 2.5, bronze: 6,
  bronze_tools: 10, pottery: 3, bread: 3, iron_ore: 2.5, charcoal: 2, iron: 7, iron_tools: 14, cut_stone: 4,
  planks: 3, flour: 3, cloth: 5, coal: 3, steel: 12, bricks: 5, concrete: 6,
};

// Lo que está disponible hoy: los bienes cuya edad ya llegó.
export const goodsForAge = (age) => GOODS.filter((g) => g.age <= age);
