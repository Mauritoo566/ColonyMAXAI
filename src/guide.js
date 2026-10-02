import { nextAgeStatus } from './ages.js';
import { DISCOVERY, RESERVE } from './sim/primitive.js';

// Guía por edades: una secuencia que orienta sin bloquear nada. Cada paso es una "acción aprendida"
// (una vez hecha queda reconocida, aunque se haga antes de que la guía la proponga) o una "condición
// actual" (se vuelve a comprobar). El formato es el mismo para todas las edades; por ahora sólo
// está escrita la de la Edad Primitiva.

const has = (colony, id, level = 1) => colony.buildings.some((b) => b.def.id === id && b.done && b.level >= level);
const made = (colony, good) => Math.floor(colony.produced?.[good] ?? 0);

export const GUIDES = {
  1: {
    title: 'Edad Primitiva',
    intro: 'Asegura la supervivencia de tus cinco colonos y prepara el paso a la Edad de Piedra.',
    steps: [
      {
        id: 'tour',
        kind: 'learned',
        title: 'Conocer el campamento',
        text: 'Mira a tus colonos y sus necesidades, el refugio de ramas (aloja a 4), el acopio y el recolector de lluvia. Quien no tiene plaza duerme junto a la fogata y descansa peor.',
        check: (c) => ({ done: c.learned.has('tour') }),
        action: 'Ver mi campamento',
      },
      {
        id: 'materials',
        kind: 'learned',
        title: 'Recoger materiales',
        text: 'Con «Recolectar» y el filtro «Madera» señala una zona con palos y ramas caídos en el suelo (los árboles en pie no se talan hasta la Edad de Piedra). Lo mismo con el filtro «Piedra»: se juntan piedrecitas sueltas, no las rocas grandes. No hay plantas de fibra aparte: la fibra llega sola junto con los palos y con las bayas. No hace falta ninguna herramienta.',
        check: (c) => ({ done: c.learned.has('zone_marked') || (made(c, 'wood') >= 12 && made(c, 'fiber') >= 4), note: `${Math.min(made(c, 'wood'), 12)}/12 de madera recogida` }),
        action: 'Abrir Recolectar',
      },
      {
        id: 'food',
        kind: 'learned',
        title: 'Asegurar la comida',
        text: 'Las bayas y setas silvestres alimentan a la aldea. Señálalas con el filtro «Comida» (los arbustos de bayas dan además 1 fibra; las setas no). Rebrotan despacio: no son infinitos.',
        check: (c) => ({ done: c.learned.has('food_marked') || made(c, 'food') >= 10, note: `${Math.min(made(c, 'food'), 10)}/10 de comida recogida` }),
        action: 'Marcar comida',
      },
      {
        id: 'water',
        kind: 'learned',
        title: 'Entender el agua',
        text: 'El recolector de lluvia capta agua cuando llueve; con tiempo seco sólo junta un poco de rocío. Mira cuánta hay, cuánto cabe, cuánto bebe la aldea y cuántos días dura la reserva.',
        check: (c) => ({ done: c.learned.has('water_seen') }),
        action: 'Ver el recolector',
      },
      {
        id: 'shelter',
        kind: 'condition',
        title: 'Dar refugio a todos',
        text: 'Cada refugio de ramas aloja a 4 adultos (los niños viven con su madre). Construye los que falten con ramas y fibras.',
        check: (c) => {
          const s = c.shelterInfo();
          return { done: s.ok, note: `${s.housed}/${s.adults} adultos con refugio` };
        },
        action: 'Construir un refugio',
      },
      {
        id: 'stockpile',
        kind: 'condition',
        title: 'Construir el almacén primitivo',
        text: 'Amplía lo que cabe en la aldea. Se paga con ramas y fibras: te alcanza con lo del acopio inicial.',
        check: (c) => ({ done: has(c, 'stockpile') }),
        action: 'Construir el almacén',
      },
      {
        id: 'stable',
        kind: 'condition',
        title: 'Estabilizar el campamento',
        text: `Mantén reservas de comida y agua (${RESERVE.food} y ${RESERVE.water}, no se gastan al avanzar) y reúne los materiales del paso a Piedra.`,
        check: (c) => {
          const st = nextAgeStatus(c);
          const reserves = st.checks?.filter((k) => k.label.startsWith('Reserva')) ?? [];
          const ok = reserves.every((k) => k.ok) && !(st.missing?.length);
          const missing = st.missing?.map(([k, n]) => `${n} de ${k}`).join(', ');
          const waterBad = reserves.some((k) => !k.ok && /agua/.test(k.label));
          return { done: ok, note: ok ? 'Reservas y materiales listos' : `${reserves.filter((k) => !k.ok).map((k) => `${k.label}: ${k.have}/${k.need}`).join(' · ')}${missing ? ` · faltan ${missing}` : ''}${waterBad ? ` — ${c.waterHint()}` : ''}` };
        },
      },
      {
        id: 'discovery',
        kind: 'learned',
        title: 'Descubrir la primera herramienta de piedra',
        text: `Con ${Object.entries(DISCOVERY.cost).map(([k, n]) => `${n} ${k === 'stone' ? 'piedras' : k === 'wood' ? 'de madera' : 'de fibra'}`).join(', ')} los colonos tallan su primera herramienta. Tarda un rato y se hace aunque no tengas nada de la Edad de Piedra.`,
        check: (c) => ({ done: c.milestones.has(DISCOVERY.id), note: c.discovery ? `Tallando… ${Math.round(c.discovery.progress * 100)}%` : '' }),
        action: 'Fabricar la herramienta',
      },
      {
        id: 'advance',
        kind: 'condition',
        title: 'Avanzar a la Edad de Piedra',
        text: 'Comprueba los requisitos y avanza cuando estén todos. Las viviendas nuevas saldrán de barro y paja; las chozas de ramas se mejoran pagando.',
        check: (c) => ({ done: c.age >= 2, note: nextAgeStatus(c).ready ? '¡Todo listo!' : 'Aún faltan requisitos' }),
        action: 'Ver requisitos',
      },
    ],
  },
};

// Estado de la guía de la edad actual: pasos con su avance y el objetivo actual (el primero sin cumplir).
export function guideState(colony) {
  const guide = GUIDES[colony.age];
  if (!guide) return null;
  const steps = guide.steps.map((s) => ({ ...s, ...s.check(colony) }));
  const current = steps.find((s) => !s.done) ?? null;
  return { guide, steps, current, done: steps.filter((s) => s.done).length };
}
