// Edades de la colonia. Se sube de edad mejorando edificios: cada edificio se puede
// mejorar un nivel por encima de la edad actual y, cuando hay bastantes mejorados, la
// colonia puede celebrar el paso a la edad siguiente (que desbloquea más mejoras).

export const AGES = [
  {
    n: 1,
    numeral: 'I',
    name: 'Edad Primitiva',
    desc: 'Ramas, pieles y piedras apiladas. La colonia vive de lo que recoge.',
    unlocks: ['Comida', 'Agua de lluvia', 'Madera', 'Piedra', 'Fibras'],
  },
  {
    n: 2,
    numeral: 'II',
    name: 'Edad Tribal',
    desc: 'Chozas de barro y paja, tótems y el primer pozo de verdad.',
    unlocks: ['Pozo simple', 'Mejores rendimientos', 'Tótem de la tribu'],
    // Para llegar a esta edad:
    requires: { upgraded: 3, cost: { wood: 30, stone: 15, fiber: 10 } },
  },
  {
    n: 3,
    numeral: 'III',
    name: 'Edad del Bronce',
    desc: 'Adobe, techos de caña y las primeras herramientas de metal.',
    unlocks: ['Cobre y estaño', 'Bronce', 'Pan'],
    soon: true,
  },
  {
    n: 4,
    numeral: 'IV',
    name: 'Edad del Hierro',
    desc: 'Piedra tallada, tejas, forjas y herramientas de hierro.',
    unlocks: ['Hierro', 'Carbón', 'Herramientas de hierro'],
    soon: true,
  },
  {
    n: 5,
    numeral: 'V',
    name: 'Edad Medieval',
    desc: 'Entramados de madera, molinos, mercados y murallas.',
    unlocks: ['Tablones', 'Ladrillos', 'Tela', 'Acero'],
    soon: true,
  },
];

export function ageInfo(n) {
  return AGES[Math.min(AGES.length, Math.max(1, n)) - 1];
}

// Qué falta para pasar a la edad siguiente: { next, upgraded, needed, missing[], ready }.
export function nextAgeStatus(colony) {
  const next = AGES[colony.age] ?? null; // AGES[age] es la siguiente (índice base 0)
  if (!next) return { next: null, ready: false };
  if (next.soon) return { next, soon: true, ready: false };
  const needed = next.requires.upgraded;
  const upgraded = colony.buildings.filter((b) => b.level >= next.n && b.done).length;
  const missing = Object.entries(next.requires.cost)
    .filter(([k, n]) => (colony.stock[k] ?? 0) < n)
    .map(([k, n]) => [k, Math.ceil(n - (colony.stock[k] ?? 0))]);
  return { next, upgraded, needed, missing, ready: upgraded >= needed && missing.length === 0 };
}
