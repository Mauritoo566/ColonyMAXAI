// Resumen de la aldea para el panel general: población y vivienda, trabajadores, bienestar,
// territorio, almacenamiento y producción por día. Sólo lee el estado de la colonia.

import { levelOf } from './buildingTypes.js';
import { GOODS, BASE_GOODS } from './goods.js';
import { limitsFor, radiusOf, expansionBlocker, expansionCost, expansionCap } from './progression.js';
import { BASE_MAX_POPULATION, maxPopulation } from './family.js';

export function villageReport(colony) {
  const colonists = colony.colonists;
  const adults = colonists.filter((c) => (c.growth ?? 1) >= 1);
  const soldiers = adults.filter((c) => c.soldier);
  const civilians = adults.filter((c) => !c.soldier);
  const employed = civilians.filter((c) => c.job);
  let needed = 0;
  let filled = 0;
  const trades = new Map();
  for (const b of colony.buildings) {
    if (!b.done) continue;
    const n = colony.crewNeeded(b);
    if (!n) continue;
    needed += n;
    filled += b.workers.length;
    const key = b.def.job ?? b.def.name;
    const t = trades.get(key) ?? { job: key, needed: 0, filled: 0 };
    t.needed += n;
    t.filled += b.workers.length;
    trades.set(key, t);
  }
  let housing = 0;
  for (const b of colony.buildings) if ((b.done || b.upgrading) && levelOf(b).housing != null) housing += levelOf(b).housing;
  const lim = limitsFor(colony.age);
  const summary = colony.summary();
  const storage = GOODS.filter((g) => BASE_GOODS.includes(g.id) || (g.age <= colony.age && ((colony.stock[g.id] ?? 0) > 0 || (colony.produced?.[g.id] ?? 0) > 0))).map((g) => ({
    id: g.id,
    name: g.name,
    have: Math.floor(colony.indoor(g.id)),
    cap: colony.capacity(g.id),
  }));
  const flows = colony.flowsView ?? colony.flowRates();
  return {
    population: {
      total: colonists.length,
      max: maxPopulation(colony),
      cap: lim.popCap,
      campBase: BASE_MAX_POPULATION,
      housing,
      adults: adults.length,
      children: colonists.length - adults.length,
      pregnant: colonists.filter((c) => c.pregnant).length,
      homeless: adults.filter((c) => c.home == null).length,
      growthBlocker: colony.growthBlockerView !== undefined && colony.remote ? colony.growthBlockerView : colony.growthBlocker,
      immigrationBlocker: colony.immigrationBlockerView !== undefined && colony.remote ? colony.immigrationBlockerView : colony.immigrationBlocker,
    },
    workers: { civilians: civilians.length, employed: employed.length, free: civilians.length - employed.length, soldiers: soldiers.length, needed, filled, trades: [...trades.values()].sort((a, b) => b.needed - a.needed) },
    wellbeing: summary,
    territory: { radius: radiusOf(colony), expansions: colony.expansions ?? 0, cap: expansionCap(colony), ageCap: lim.expansions, cost: expansionCost(colony), blocker: expansionBlocker(colony) },
    storage,
    flows,
  };
}
