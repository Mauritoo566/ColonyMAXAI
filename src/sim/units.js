// Unidades militares (datos puros). Cada unidad se recluta en un edificio de su grupo
// ("pool"), pide equipo de su edad (un bien de tipo "arms"), recursos y mantenimiento diario,
// y sale de la población civil. Los soldados existentes no se modernizan solos: se mejoran
// uno a uno pagando la unidad siguiente de su línea.

// role: infantería gana a caballería, a distancia gana a infantería, caballería gana a distancia
// (el asedio y los vehículos no entran en el triángulo).
export const UNITS = [
  { id: 'spearman', name: 'Lancero', pool: 'barracks', role: 'infantry', age: 3, arms: 'arms_bronze', cost: { food: 4 }, upkeep: { food: 1 }, power: 3, line: 'infantry', desc: 'Infantería con lanza y escudo de bronce.' },
  { id: 'swordsman', name: 'Espadachín', pool: 'barracks', role: 'infantry', age: 4, arms: 'arms_iron', cost: { food: 5 }, upkeep: { food: 1 }, power: 5, line: 'infantry', desc: 'Infantería con espada y casco de hierro.' },
  { id: 'legionary', name: 'Legionario', pool: 'barracks', role: 'infantry', age: 5, arms: 'arms_iron', cost: { food: 6 }, upkeep: { food: 1 }, power: 7, line: 'infantry', desc: 'Infantería pesada organizada en formación.' },
  { id: 'man_at_arms', name: 'Hombre de armas', pool: 'barracks', role: 'infantry', age: 6, arms: 'arms_forged', cost: { food: 8 }, upkeep: { food: 1, coin: 1 }, power: 10, line: 'infantry', desc: 'Infantería con armadura forjada.' },
  { id: 'rifleman', name: 'Fusilero', pool: 'barracks', role: 'infantry', age: 8, arms: 'arms_steel', cost: { food: 10, coin: 10 }, upkeep: { food: 1, coin: 1 }, power: 16, line: 'infantry', desc: 'Infantería industrial con fusil de acero.' },
  { id: 'soldier', name: 'Soldado moderno', pool: 'barracks', role: 'infantry', age: 9, arms: 'arms_modern', cost: { food: 12, coin: 20 }, upkeep: { food: 1, coin: 2 }, power: 24, line: 'infantry', desc: 'Infantería mecanizada con equipo moderno.' },
  { id: 'operative', name: 'Operador', pool: 'barracks', role: 'infantry', age: 10, arms: 'arms_adv', cost: { food: 14, coin: 30 }, upkeep: { food: 1, coin: 3 }, power: 36, line: 'infantry', desc: 'Especialista con equipo tecnológico.' },
  { id: 'archer', name: 'Arquero', pool: 'archery', role: 'ranged', age: 4, arms: 'arms_iron', cost: { food: 5 }, upkeep: { food: 1 }, power: 4, line: 'ranged', desc: 'Tirador con arco: fuerte contra infantería, débil contra jinetes.' },
  { id: 'crossbowman', name: 'Ballestero', pool: 'archery', role: 'ranged', age: 6, arms: 'arms_forged', cost: { food: 8, coin: 4 }, upkeep: { food: 1, coin: 1 }, power: 8, line: 'ranged', desc: 'Tirador con ballesta de acero.' },
  { id: 'marksman', name: 'Tirador', pool: 'archery', role: 'ranged', age: 8, arms: 'arms_steel', cost: { food: 10, coin: 12 }, upkeep: { food: 1, coin: 1 }, power: 14, line: 'ranged', desc: 'Tirador de precisión.' },
  { id: 'knight', name: 'Jinete', pool: 'stable', role: 'cavalry', age: 6, arms: 'arms_forged', cost: { food: 12, coin: 6 }, upkeep: { food: 2, coin: 1 }, power: 12, line: 'cavalry', desc: 'Caballería: fuerte contra tiradores, débil contra lanzas.' },
  { id: 'dragoon', name: 'Dragón', pool: 'stable', role: 'cavalry', age: 8, arms: 'arms_steel', cost: { food: 14, coin: 14 }, upkeep: { food: 2, coin: 2 }, power: 20, line: 'cavalry', desc: 'Caballería con armas de fuego.' },
  { id: 'catapult', name: 'Catapulta', pool: 'siege_shop', role: 'siege', age: 6, arms: 'arms_forged', cost: { planks: 6, food: 4 }, upkeep: { food: 1, coin: 1 }, power: 14, line: 'siege', desc: 'Máquina de asedio: poderosa contra fortificaciones.' },
  { id: 'cannon', name: 'Cañón', pool: 'siege_shop', role: 'siege', age: 7, arms: 'arms_forged', cost: { powder: 4, planks: 4, coin: 10 }, upkeep: { food: 1, coin: 2 }, power: 22, line: 'siege', tech: 'gunpowder', desc: 'Artillería de pólvora.' },
  { id: 'armored', name: 'Vehículo blindado', pool: 'motor_pool', role: 'mechanized', age: 9, arms: 'arms_modern', cost: { steel: 4, machinery: 1, coin: 30 }, upkeep: { food: 1, coin: 3, coal: 1 }, power: 40, line: 'mechanized', desc: 'Unidad mecanizada: cara de mantener.' },
  { id: 'advanced', name: 'Vehículo avanzado', pool: 'motor_pool', role: 'mechanized', age: 10, arms: 'arms_adv', cost: { steel: 6, electronics: 1, coin: 50 }, upkeep: { food: 1, coin: 4, coal: 1 }, power: 60, line: 'mechanized', desc: 'Sistema de combate avanzado.' },
];

export const UNITS_BY_ID = Object.fromEntries(UNITS.map((u) => [u.id, u]));

// La unidad siguiente de la misma línea (para modernizar soldados con una mejora pagada).
export function upgradeOf(unit) {
  return UNITS.filter((u) => u.line === unit.line && u.age > unit.age).sort((a, b) => a.age - b.age)[0] ?? null;
}

// Ventaja de un papel contra otro (triángulo: infantería > caballería > tiradores > infantería).
const BEATS = { infantry: 'cavalry', cavalry: 'ranged', ranged: 'infantry' };
export function matchup(role, enemy) {
  if (BEATS[role] === enemy) return 1.4;
  if (BEATS[enemy] === role) return 0.75;
  return 1;
}

// ---- Reglas de combate entre jugadores --------------------------------------------------------
// Los ataques destructivos entre jugadores NO están activos. Estas son las reglas que se
// aplicarían si algún día se activan (PVP_ENABLED); mientras tanto todo ataque se rechaza.
export const PVP = {
  enabled: false,
  protectionDays: 7, // protección inicial desde la fundación (días de juego)
  maxAgeGap: 1, // no se ataca a quien lleve más de una edad de diferencia
  offlineProtected: true, // una aldea cuyo dueño no está conectado no puede ser atacada
  destructive: false, // aunque se activara: sólo robo de recursos, nunca destruir edificios ni colonos
};

export function pvpProblem(attacker, defender, { gameDay = 0, defenderOnline = false } = {}) {
  if (!PVP.enabled) return 'Los ataques entre jugadores están desactivados';
  if (gameDay < PVP.protectionDays) return 'La aldea está en su periodo de protección inicial';
  if (PVP.offlineProtected && !defenderOnline) return 'El dueño no está conectado: su aldea está protegida';
  if (Math.abs(attacker.age - defender.age) > PVP.maxAgeGap) return 'Las edades están demasiado lejos';
  return null;
}
