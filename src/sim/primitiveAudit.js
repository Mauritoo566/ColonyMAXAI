// Auditoría de la Edad Primitiva: cada paso del recorrido hasta la Edad de Piedra con lo que pide,
// de dónde sale, qué capacidad o edificio necesita, el resultado y qué pasa si falta algo. Cada fila
// se comprueba contra el juego real (primitive.test.js) y de ellas sale docs/PRIMITIVA.md.

import { BUILDINGS, levelOf } from './buildingTypes.js';
import { AGES } from '../ages.js';
import { minAgeOf } from './progression.js';
import { DISCOVERY, RESERVE } from './primitive.js';

const PRIMITIVE_GOODS = ['wood', 'stone', 'fiber', 'food', 'water'];
const costOf = (id) => BUILDINGS[id].levels[0].buildCost ?? BUILDINGS[id].cost;
const affordable = (sim, cost) => Object.entries(cost).every(([k, n]) => (sim.stock[k] ?? 0) >= n);
const noPrereq = (id) => !BUILDINGS[id].requires?.length && !BUILDINGS[id].levels[0].requires?.length;
const text = (cost) => Object.entries(cost).map(([k, n]) => `${n} ${{ wood: 'madera/ramas', stone: 'piedras', fiber: 'fibras', food: 'comida', water: 'agua' }[k] ?? k}`).join(', ');

export const AUDIT = [
  {
    step: '1. Fundar',
    action: 'Pulsar «Fundar campamento»',
    needs: '—',
    origin: 'Se crean con la partida',
    requires: 'Una ubicación válida',
    result: 'Fogata, 5 colonos, refugio de ramas (2 plazas), recolector de lluvia con agua y acopio inicial',
    explain: 'Si el lugar es difícil, el aviso del puntero lo dice antes de fundar',
    verify: (s) => s.colonists.length === 5 && s.buildings.length === 2 && s.buildings.every((b) => b.done) && s.age === 1,
  },
  {
    step: '2. Ramas y madera',
    action: 'Recolectar (zona marcada o solos) — sin hacha',
    needs: '—',
    origin: 'Ramas y troncos caídos del terreno (sitios que se agotan)',
    requires: 'Un colono adulto',
    result: '+madera y +fibra en el acopio',
    explain: 'Si se agotan, la interfaz avisa y hay que marcar otra zona',
    verify: (s) => s.remaining('wood').left >= 15 && s.techs.size === 0,
  },
  {
    step: '3. Piedras sueltas',
    action: 'Recolectar (filtro Piedra) — sin pico',
    needs: '—',
    origin: 'Piedras del terreno (no es cantera)',
    requires: 'Un colono adulto',
    result: '+piedra',
    explain: 'Cada piedra recogida desaparece: no se renueva',
    verify: (s) => s.remaining('stone').left >= 15 && !BUILDINGS.quarry.requires,
  },
  {
    step: '4. Comida silvestre',
    action: 'Recolectar (filtro Comida)',
    needs: '—',
    origin: 'Bayas y setas (rebrotan despacio)',
    requires: 'Un colono adulto',
    result: '+comida y +fibra',
    explain: 'Los colonos también comen solos de los arbustos cercanos',
    verify: (s) => s.remaining('food').left >= 15,
  },
  {
    step: '5. Agua',
    action: 'Beber del recolector de lluvia (ya construido)',
    needs: 'Lluvia (con tiempo seco, sólo rocío)',
    origin: 'Recolector de lluvia inicial',
    requires: 'No hace falta un río ni el pozo',
    result: 'Agua visible (cantidad, capacidad, consumo y días de reserva)',
    explain: 'Sin lluvia la reserva baja: construir otro recolector (límite 2) da margen',
    verify: (s) => {
      const w = s.waterReport();
      return w.collectors === 1 && w.capacity >= RESERVE.water && w.store > 0 && levelOf(s.buildings.find((b) => b.def.id === 'well')).rainOnly === true && BUILDINGS.well.levels[0].age === 1 && s.buildProblem(BUILDINGS.well, 12, 12) !== undefined;
    },
  },
  {
    step: '6. Refugios para todos',
    action: 'Construir chozas de ramas',
    needs: text(costOf('house')) + ' cada una',
    origin: 'Acopio inicial + lo recolectado',
    requires: 'Colonos adultos que construyan; hasta 3 refugios; sin edificio previo',
    result: '+2 plazas por refugio; los niños viven con su madre',
    explain: 'Quien no tiene plaza duerme junto a la fogata y descansa peor',
    verify: (s) => noPrereq('house') && BUILDINGS.house.levels[0].housing === 2 && affordable(s, costOf('house')) && minAgeOf(BUILDINGS.house) === 1,
  },
  {
    step: '7. Almacén primitivo',
    action: 'Construir la pila de troncos y cestas',
    needs: text(costOf('stockpile')),
    origin: 'Acopio inicial',
    requires: 'Colonos adultos; sin edificio previo',
    result: 'Más capacidad de almacenamiento',
    explain: 'Su coste cabe en el acopio inicial (no hay que ampliar antes de construirlo)',
    verify: (s) => noPrereq('stockpile') && affordable(s, costOf('stockpile')) && minAgeOf(BUILDINGS.stockpile) === 1,
  },
  {
    step: '8. Primera herramienta de piedra',
    action: 'Fabricarla desde la guía (tarda un rato)',
    needs: text(DISCOVERY.cost),
    origin: 'Acopio inicial + lo recolectado',
    requires: 'Un adulto; ningún taller; sólo materiales primitivos',
    result: 'Hito registrado «primera herramienta de piedra» (no desbloquea mejoras)',
    explain: 'Si faltan materiales, el botón dice cuáles',
    verify: (s) => s.discoveryProblem() === null && Object.keys(DISCOVERY.cost).every((k) => PRIMITIVE_GOODS.includes(k)),
  },
  {
    step: '9. Estabilizar',
    action: 'Mantener reservas',
    needs: `${RESERVE.food} comida y ${RESERVE.water} agua (se conservan)`,
    origin: 'Recolección y lluvia',
    requires: 'Recolector de lluvia; comida silvestre',
    result: 'Requisito de reservas cumplido',
    explain: 'La reserva no se gasta al avanzar',
    verify: (s) => s.buildings.some((b) => levelOf(b).rainOnly && levelOf(b).capacity >= RESERVE.water),
  },
  {
    step: '10. Avanzar a Piedra',
    action: 'Pulsar «Avanzar» cuando todo esté listo',
    needs: text(AGES[1].requires.cost) + ' (se gastan)',
    origin: 'Recolección',
    requires: 'Refugio para todos, almacén, herramienta y reservas; sin población mínima',
    result: 'Viviendas evolucionan solas; se desbloquea lo de Piedra',
    explain: 'La ventana de edades lista cada requisito con su progreso',
    verify: () => {
      const req = AGES[1].requires;
      return !req.population && Object.keys(req.cost).every((k) => PRIMITIVE_GOODS.includes(k)) && req.buildings.every((r) => minAgeOf(BUILDINGS[r.id]) === 1) && !req.techs;
    },
  },
  {
    step: '11. Sin bloqueos de diseño',
    action: 'Revisar requisitos y herramientas',
    needs: '—',
    origin: '—',
    requires: 'Ni tala, ni cantera, ni cultivo, ni pozo, ni metales',
    result: 'Ningún requisito exige algo de Piedra',
    explain: 'Sin cadenas circulares',
    verify: () => ['house', 'stockpile', 'well'].every((id) => noPrereq(id) && minAgeOf(BUILDINGS[id]) === 1),
  },
];
