// Edades de la colonia. Se sube de edad cuando la aldea tiene lo que esa etapa exige
// (edificios levantados, población, ofrenda): nunca algo que sólo se consigue después de
// avanzar. Cada edad desbloquea mejoras, viviendas y límites mayores (sim/progression.js);
// las mejoras hay que pagarlas edificio por edificio.

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
    // Para llegar a esta edad: una aldea que ya se sostiene y empieza a crecer.
    requires: {
      population: 6,
      buildings: [
        { id: 'house', name: 'una vivienda' },
        { id: 'woodcutter', name: 'una zona de tala' },
        { id: 'quarry', name: 'una pedrera' },
        { id: 'gatherer', name: 'una enramada de recolección' },
      ],
      cost: { wood: 30, stone: 15, fiber: 10 },
    },
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

// Qué falta para pasar a la edad siguiente:
// { next, checks: [{ label, have, need, ok }], missing[], ready, soon }.
export function nextAgeStatus(colony) {
  const next = AGES[colony.age] ?? null; // AGES[age] es la siguiente (índice base 0)
  if (!next) return { next: null, ready: false };
  if (next.soon) return { next, soon: true, ready: false };
  const req = next.requires;
  const checks = [];
  if (req.population) {
    const have = colony.colonists.length;
    checks.push({ label: 'Colonos en la aldea', have, need: req.population, ok: have >= req.population });
  }
  for (const r of req.buildings ?? []) {
    const ok = colony.buildings.some((b) => b.def.id === r.id && b.done);
    checks.push({ label: `Tener ${r.name}`, have: ok ? 1 : 0, need: 1, ok });
  }
  const missing = Object.entries(req.cost)
    .filter(([k, n]) => (colony.stock[k] ?? 0) < n)
    .map(([k, n]) => [k, Math.ceil(n - (colony.stock[k] ?? 0))]);
  return { next, checks, missing, ready: checks.every((c) => c.ok) && missing.length === 0 };
}
