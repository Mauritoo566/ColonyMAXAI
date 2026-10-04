// Economía de la aldea: talleres con recetas (entradas, salidas, trabajadores, energía),
// la red de energía, yacimientos, comercio, investigación, servicios y caminos. Funciones
// que reciben la colonia (ColonySim) y no tocan Three.js ni la página: corren igual en el
// servidor (que decide) y en el navegador. Todo lo que detiene una instalación deja su
// motivo en `b.status` para que la interfaz lo explique.

import { DAY_LENGTH_SECONDS } from '../daynight.js';
import { levelOf } from './buildingTypes.js';
import { GOOD_NAMES, GOODS_BY_ID, TRADE_VALUE } from './goods.js';
import { TECHS_BY_ID } from './techs.js';
import { radiusOf } from './progression.js';
import { rectDistance } from '../rect.js';

const DAY = DAY_LENGTH_SECONDS;
const name = (k) => GOOD_NAMES[k] ?? k;

// ---------------------------------------------------------------------------------------------
// Yacimientos: sitios fijos (salen de la semilla del campamento) donde se pueden abrir minas.
// ---------------------------------------------------------------------------------------------

export const DEPOSIT_KINDS = ['copper', 'tin', 'iron_ore', 'coal'];
export const DEPOSIT_RADIUS = 12;
export const DEPOSIT_COLORS = { copper: '#c8743c', tin: '#9fb0b8', iron_ore: '#8a5a4a', coal: '#3a3a40' };

export function generateDeposits(colony, seedRandom) {
  const deposits = [];
  for (let k = 0; k < DEPOSIT_KINDS.length; k++) {
    const kind = DEPOSIT_KINDS[k];
    const rand = seedRandom(((colony.camp.seed ?? 1) ^ (0x9e3779b1 * (k + 1))) >>> 0);
    let placed = 0;
    for (let attempt = 0; attempt < 120 && placed < 3; attempt++) {
      const a = rand() * Math.PI * 2;
      const r = 30 + rand() * 40;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (colony.heightAt(x, z) < 1.6) continue;
      if (colony.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + DEPOSIT_RADIUS * 0.6)) continue;
      if (deposits.some((d) => Math.hypot(d.x - x, d.z - z) < DEPOSIT_RADIUS * 2.1)) continue;
      deposits.push({ kind, x, z, r: DEPOSIT_RADIUS });
      placed++;
    }
  }
  return deposits;
}

export function depositAt(colony, kind, x, z) {
  return colony.deposits.find((d) => d.kind === kind && Math.hypot(d.x - x, d.z - z) <= d.r) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Producción
// ---------------------------------------------------------------------------------------------

const CYCLE_KINDS = new Set(['process', 'power', 'research']);

// Colonos de la dotación que están ahora en su puesto (se anotan desde su tarea).
export function crewPresent(colony, b) {
  let n = 0;
  for (const w of b.workers) if ((b.crewAt.get(w.id) ?? -99) > colony.gameTime - 1.2) n++;
  return n;
}

// ¿Hay sitio en el almacén (o en la zona de acopio) para esta cantidad?
export function hasRoom(colony, good, qty) {
  const inside = Math.max(0, colony.capacity(good) - colony.indoor(good));
  const outside = Math.max(0, colony.outdoorCapacity() - colony.outdoorUsed());
  return inside + outside >= qty;
}

// Bonificación de las estaciones y centros logísticos cercanos (la mercancía entra y sale en vagones).
export function logisticsBonus(colony, b) {
  let best = 1;
  for (const s of colony.buildings) {
    if (!s.done || s.def.kind !== 'drop') continue;
    const lv = levelOf(s);
    if (Math.hypot(s.x - b.x, s.z - b.z) <= 45) best = Math.max(best, 1 + ((lv.speed ?? 1) - 1) * 0.25);
  }
  return best;
}

// ¿Por qué no puede empezar un ciclo ahora mismo? Faltan materiales o no hay sitio para lo que sale (null = puede). Sale del estado
// del almacén, no del texto del edificio: así el trabajador sabe que se puede ir a otra cosa y que al volver ya hay sitio, sin
// vaivenes (el texto depende de si está presente).
export function stallReason(colony, b) {
  const lv = levelOf(b);
  const recipe = lv?.recipe;
  if (!recipe || !CYCLE_KINDS.has(b.def.kind) || b.cycleActive) return null;
  const lacking = Object.entries(recipe.in ?? {}).filter(([k, n]) => (colony.stock[k] ?? 0) < n);
  if (lacking.length) return `Faltan materiales: ${lacking.map(([k, n]) => `${Math.ceil(n - (colony.stock[k] ?? 0))} de ${name(k)}`).join(' y ')}`;
  const full = Object.entries(recipe.out ?? {}).find(([k, n]) => !hasRoom(colony, k, n));
  return full ? `El almacén está lleno de ${name(full[0])}: construye o mejora almacenes` : null;
}

// Un paso de un edificio con receta, servicio o puesto de trabajo.
export function updateProduction(colony, b, dt) {
  if (!b.done) return;
  const lv = levelOf(b);
  const needed = colony.crewNeeded(b);
  const present = needed ? crewPresent(colony, b) : 1;
  b.operating = false;
  b.wantsPower = !!lv.energy && present > 0;

  if (needed && b.workers.length === 0) {
    b.status = 'Sin trabajadores: asigna a alguien desde la ficha';
    b.burning = false;
    return;
  }
  if (needed && present === 0) {
    b.status = 'Esperando a que los trabajadores lleguen a su puesto';
    b.burning = false;
    return;
  }
  const pf = lv.energy ? b.pf ?? 0 : 1;
  if (lv.energy && pf <= 0) {
    b.status = b.powerNote ?? 'Sin energía: conéctalo a una caldera o a la red';
    b.burning = false;
    return;
  }

  const recipe = lv.recipe;
  if (!recipe || !CYCLE_KINDS.has(b.def.kind)) {
    b.operating = true;
    b.status = lv.energy && pf < 1 ? `Poca energía (${Math.round(pf * 100)} %)` : null;
    return;
  }

  // Arrancar un ciclo: se gastan las entradas de golpe y hace falta sitio para lo que sale.
  if (!b.cycleActive) {
    const lacking = Object.entries(recipe.in ?? {}).filter(([k, n]) => (colony.stock[k] ?? 0) < n);
    if (lacking.length) {
      b.status = `Faltan materiales: ${lacking.map(([k, n]) => `${Math.ceil(n - (colony.stock[k] ?? 0))} de ${name(k)}`).join(' y ')}`;
      b.burning = false;
      return;
    }
    const full = Object.entries(recipe.out ?? {}).find(([k, n]) => !hasRoom(colony, k, n));
    if (full) {
      b.status = `El almacén está lleno de ${name(full[0])}: construye o mejora almacenes`;
      b.burning = false;
      return;
    }
    for (const [k, n] of Object.entries(recipe.in ?? {})) colony.takeStock(k, n);
    b.cycleActive = true;
    b.cycle = 0;
  }

  // Avanzar el ciclo: más rápido con la dotación completa, hábil, con energía y con transporte.
  let skill = 0;
  for (const w of b.workers) skill += colony.skillOf(w, b.def.skill);
  skill /= Math.max(1, b.workers.length);
  const speed = Math.min(1, present / Math.max(1, needed)) * (1 / (1.4 - skill * 0.07)) * pf * logisticsBonus(colony, b);
  b.operating = true;
  b.burning = true;
  b.status = present < needed ? `Falta personal (${present}/${needed}): trabaja más despacio` : pf < 1 ? `Poca energía (${Math.round(pf * 100)} %)` : null;
  b.cycle += (dt / recipe.time) * speed;
  if (b.cycle >= 1) {
    // Los cultivos al aire libre rinden más con lluvia y según la época (la helada los frena mucho).
    const rain = lv.rain ? (1 + (colony.weather?.effectiveRain ?? 0) * 0.5) * colony.growth() : 1;
    let first = true;
    for (const [k, n] of Object.entries(recipe.out ?? {})) {
      const added = colony.produce(k, n * rain);
      if (first) b.produced += added;
      first = false;
    }
    if (!Object.keys(recipe.out ?? {}).length) b.produced += 1; // energía: cuenta los ciclos
    b.cycle = 0;
    b.cycleActive = false;
    colony.emit('changed');
  }
}

// ---------------------------------------------------------------------------------------------
// Red de energía: fuentes (calderas y centrales que están quemando) y nodos (postes) forman
// componentes si sus alcances se tocan; cada consumidor toma de la red que lo cubre. Si la
// energía no alcanza, todos van más lentos en proporción (no se paran de golpe).
// ---------------------------------------------------------------------------------------------

export function updatePower(colony) {
  const verts = [];
  for (const b of colony.buildings) {
    if (!b.done) continue;
    const lv = levelOf(b);
    if (b.def.kind === 'power') verts.push({ b, x: b.x, z: b.z, r: lv.reach ?? 20, supply: b.burning ? lv.power ?? 0 : 0 });
    else if (b.def.kind === 'node') verts.push({ b, x: b.x, z: b.z, r: lv.reach ?? 30, supply: 0 });
  }
  const parent = verts.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (Math.hypot(verts[i].x - verts[j].x, verts[i].z - verts[j].z) <= verts[i].r + verts[j].r) parent[find(i)] = find(j);
    }
  }
  const supply = new Map();
  const demand = new Map();
  verts.forEach((v, i) => supply.set(find(i), (supply.get(find(i)) ?? 0) + v.supply));
  const consumers = [];
  for (const b of colony.buildings) {
    if (!b.done) continue;
    const lv = levelOf(b);
    if (!lv.energy) continue;
    let comp = null;
    let best = -1;
    verts.forEach((v, i) => {
      if (Math.hypot(v.x - b.x, v.z - b.z) <= v.r && (supply.get(find(i)) ?? 0) > best) {
        best = supply.get(find(i)) ?? 0;
        comp = find(i);
      }
    });
    consumers.push({ b, lv, comp });
    if (comp !== null && b.wantsPower) demand.set(comp, (demand.get(comp) ?? 0) + lv.energy);
  }
  let totalSupply = 0;
  let totalDemand = 0;
  for (const v of supply.values()) totalSupply += v;
  for (const v of demand.values()) totalDemand += v;
  for (const { b, lv, comp } of consumers) {
    if (comp === null) {
      b.pf = 0;
      b.powerNote = 'Sin energía: no hay caldera, central ni poste que llegue hasta aquí';
    } else {
      const s = supply.get(comp) ?? 0;
      const d = Math.max(demand.get(comp) ?? 0, lv.energy);
      b.pf = s <= 0 ? 0 : Math.min(1, s / d);
      b.powerNote = s <= 0 ? 'Sin energía: la central o caldera de su red no está funcionando (falta combustible o trabajador)' : null;
    }
  }
  colony.grid = { supply: totalSupply, demand: totalDemand };
}

// ---------------------------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------------------------

// Un servicio funciona si tiene su dotación en el puesto y energía.
export function serviceActive(colony, b) {
  return b.done && (b.operating || (!colony.crewNeeded(b) && (levelOf(b).energy ? (b.pf ?? 0) > 0 : true)));
}

// Hospitales: los colonos heridos o enfermos se recuperan antes.
export function applyHospitals(colony, dt) {
  let regen = 0;
  for (const b of colony.buildings) {
    if (b.def.id === 'hospital' && b.operating) regen += (levelOf(b).regen ?? 0) * (b.pf ?? 1);
  }
  if (regen <= 0) return;
  for (const c of colony.colonists) {
    if (c.health >= 100 || c.needs.food <= 0 || c.needs.water <= 0 || c.needs.warmth < 8) continue;
    c.health = Math.min(100, c.health + ((100 / (3 * DAY)) * regen * dt));
  }
}

// Escuelas: una vez al día instruyen a algunos adultos (suben la habilidad de su oficio).
export function trainColonists(colony) {
  for (const b of colony.buildings) {
    if (b.def.id !== 'school' || !b.operating) continue;
    const lv = levelOf(b);
    const adults = colony.colonists.filter((c) => (c.growth ?? 1) >= 1 && !c.soldier);
    const n = Math.min(adults.length, (lv.teach ?? 1) * 3);
    const day = Math.floor(colony.gameTime / DAY);
    for (let i = 0; i < n; i++) {
      const c = adults[(day * n + i) % adults.length];
      const id = c.job?.def?.skill ?? 'gathering';
      const cur = colony.skillOf(c, id);
      if (cur < (lv.skillCap ?? 7)) {
        c.skills[id] = cur + 1;
        colony.skillsRevision = (colony.skillsRevision ?? 0) + 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Comercio (mercado)
// ---------------------------------------------------------------------------------------------

export const SELL_RATE = 0.8; // se vende al 80 % del valor
export const BUY_RATE = 1.25; // se compra al 125 %

// Cupo diario que ofrecen los mercados que funcionan (en monedas de valor).
export function tradeQuota(colony) {
  let q = 0;
  for (const b of colony.buildings) if (b.def.id === 'market' && b.operating) q += (levelOf(b).trade ?? 0) * (b.pf ?? 1);
  return q;
}

export function tradeProblem(colony, good, qty, mode) {
  if (!Number.isInteger(qty) || qty < 1 || qty > 200) return 'Cantidad no válida';
  if (mode !== 'buy' && mode !== 'sell') return 'Operación no válida';
  const g = GOODS_BY_ID[good];
  if (!g || TRADE_VALUE[good] == null) return 'Ese bien no se comercia';
  if (g.age > colony.age) return `Todavía no existe en la ${colony.ageInfo.name}`;
  const quota = tradeQuota(colony);
  if (quota <= 0) return 'Hace falta un mercado con comerciante en su puesto';
  const day = Math.floor(colony.gameTime / DAY);
  const used = colony.tradeDay === day ? colony.tradeUsed : 0;
  const value = TRADE_VALUE[good] * qty * (mode === 'buy' ? BUY_RATE : SELL_RATE);
  if (used + value > quota + 1e-6) return `Cupo diario agotado (${Math.floor(used)}/${Math.floor(quota)})`;
  if (mode === 'sell') {
    if ((colony.stock[good] ?? 0) < qty) return `No hay ${qty} de ${name(good)} en el almacén`;
    if (!hasRoom(colony, 'coin', Math.floor(value))) return 'No cabe más dinero en el almacén';
  } else {
    if ((colony.stock.coin ?? 0) < value) return `Faltan monedas (${Math.ceil(value)})`;
    if (!hasRoom(colony, good, qty)) return `No cabe más ${name(good)} en el almacén`;
  }
  return null;
}

// Lo que cuesta o se gana en monedas (redondeado hacia abajo al vender, hacia arriba al comprar).
export function tradeValue(good, qty, mode) {
  const v = TRADE_VALUE[good] * qty * (mode === 'buy' ? BUY_RATE : SELL_RATE);
  return mode === 'buy' ? Math.ceil(v) : Math.floor(v);
}

export function doTrade(colony, good, qty, mode) {
  const day = Math.floor(colony.gameTime / DAY);
  if (colony.tradeDay !== day) {
    colony.tradeDay = day;
    colony.tradeUsed = 0;
  }
  colony.tradeUsed += TRADE_VALUE[good] * qty * (mode === 'buy' ? BUY_RATE : SELL_RATE);
  const coins = tradeValue(good, qty, mode);
  if (mode === 'sell') {
    colony.takeStock(good, qty);
    colony.produce('coin', coins); // las monedas ganadas vendiendo cuentan como producción
  } else {
    colony.takeStock('coin', coins);
    colony.addStock(good, qty); // lo comprado no cuenta como producido
  }
}

// ---------------------------------------------------------------------------------------------
// Investigación
// ---------------------------------------------------------------------------------------------

export function researchProblem(colony, id) {
  const t = TECHS_BY_ID[id];
  if (!t) return 'Tecnología desconocida';
  if (colony.techs.has(id)) return 'Ya está investigada';
  if (t.age > colony.age) return `Disponible a partir de la edad ${t.age}`;
  const missing = t.requires.filter((r) => !colony.techs.has(r));
  if (missing.length) return `Antes hay que investigar ${missing.map((m) => TECHS_BY_ID[m].name).join(' y ')}`;
  if (!colony.buildings.some((b) => b.def.id === 'academy' && b.operating)) return 'Hace falta una academia funcionando';
  if ((colony.stock.knowledge ?? 0) < t.cost) return `Faltan ${Math.ceil(t.cost - (colony.stock.knowledge ?? 0))} de conocimiento`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Caminos: casillas de 4 m con un nivel; en ellas se camina un poco más rápido (un 3 % en el de tierra) y los colonos los prefieren (roadpath.js).
// ---------------------------------------------------------------------------------------------

export const ROAD_CELL = 4;
export const ROAD_LIFT = 0.26; // metros que la cinta del camino se dibuja por encima del terreno (quien camina por él sube igual)
export const ROAD_LEVELS = [
  { age: 2, name: 'Camino de tierra', cost: { fiber: 1 }, speed: 1.03, color: '#a8845a' },
  { age: 5, name: 'Camino empedrado', cost: { stone: 2 }, speed: 1.05, color: '#8f8a82' },
  { age: 7, name: 'Calle adoquinada', cost: { cut_stone: 1 }, speed: 1.07, color: '#7a746a' },
  { age: 9, name: 'Carretera asfaltada', cost: { concrete: 1 }, speed: 1.1, color: '#3e3e44' },
];

export const roadKey = (ix, iz) => `${ix},${iz}`;
export const roadCellOf = (x, z) => [Math.round(x / ROAD_CELL), Math.round(z / ROAD_CELL)];

// Nivel máximo de camino que permite la edad (0 = todavía no hay caminos).
export function roadLevelFor(age) {
  let n = 0;
  ROAD_LEVELS.forEach((l, i) => {
    if (l.age <= age) n = i + 1;
  });
  return n;
}

export function roadSpeed(colony, x, z) {
  if (!colony.roads.size) return 1;
  const lv = colony.roads.get(roadKey(...roadCellOf(x, z)));
  return lv ? ROAD_LEVELS[lv - 1].speed : 1;
}

// Casillas válidas para pintar con el nivel dado (las que choquen con algo se descartan).
export function roadCellProblem(colony, ix, iz) {
  const x = ix * ROAD_CELL;
  const z = iz * ROAD_CELL;
  if (Math.hypot(x, z) > radiusOf(colony)) return 'Fuera del territorio';
  if (colony.heightAt(x, z) <= 0.8) return 'En el agua';
  // El camino mide ~2,7 m de ancho: se deja margen a los lados de lo que hay (los tipis, sólo su base).
  for (const o of colony.obstacles) {
    if (o.kind === 'building' && !o.line) {
      // Un edificio ocupa casillas enteras: el camino sólo choca si pisa alguna, pegado al lado no.
      const half = o.small ? o.r : (Math.max(1, Math.round((o.r * 2) / ROAD_CELL)) * ROAD_CELL) / 2;
      if (Math.abs(x - o.x) < half + ROAD_CELL / 2 - 1e-6 && Math.abs(z - o.z) < half + ROAD_CELL / 2 - 1e-6) return 'Hay algo encima';
    } else if (Math.hypot(x - o.x, z - o.z) < o.r + (o.kind === 'tent' ? 0 : 2.2)) return 'Hay algo encima';
  }
  for (const zone of colony.zones) if (rectDistance(zone, x, z) < 2.4) return 'En la zona de acopio';
  return null;
}

export function roadsProblem(colony, cells) {
  const lvl = roadLevelFor(colony.age);
  if (lvl <= 0) return 'Todavía no se pueden hacer caminos';
  if (!Array.isArray(cells) || !cells.length || cells.length > 80) return 'Camino no válido';
  const cost = roadCost(lvl, cells.length);
  const lacking = Object.entries(cost).filter(([k, n]) => (colony.stock[k] ?? 0) < n);
  if (lacking.length) return `Faltan ${lacking.map(([k, n]) => `${Math.ceil(n - (colony.stock[k] ?? 0))} de ${name(k)}`).join(' y ')}`;
  return null;
}

export function roadCost(level, cells) {
  const out = {};
  for (const [k, n] of Object.entries(ROAD_LEVELS[level - 1].cost)) out[k] = n * cells;
  return out;
}

// Camino automático: de la puerta de un edificio hasta la red (caminos existentes o el centro del
// campamento) por la ruta más corta de casillas libres. Devuelve las casillas nuevas [ix, iz].
export function autoRoadPath(colony, b, off = new Set()) {
  const R = Math.ceil(radiusOf(colony) / ROAD_CELL);
  const free = (ix, iz) => Math.abs(ix) <= R && Math.abs(iz) <= R && !off.has(roadKey(ix, iz)) && !roadCellProblem(colony, ix, iz);
  const isTarget = (ix, iz) => colony.roads.has(roadKey(ix, iz)) || Math.hypot(ix * ROAD_CELL, iz * ROAD_CELL) <= 12;
  // El camino sale de la puerta: sólo las casillas de la franja de acceso del edificio son punto de partida (muros,
  // postes y demás sin entrada no reciben camino). Así no rodea el edificio ni cruza por detrás.
  if (!b.entrance) return [];
  const prev = new Map();
  const queue = [];
  const zone = b.entrance.zone;
  for (let ix = Math.floor(zone.x0 / ROAD_CELL - 0.5); ix <= Math.ceil(zone.x1 / ROAD_CELL + 0.5); ix++) {
    for (let iz = Math.floor(zone.z0 / ROAD_CELL - 0.5); iz <= Math.ceil(zone.z1 / ROAD_CELL + 0.5); iz++) {
      const x = ix * ROAD_CELL;
      const z = iz * ROAD_CELL;
      const overlaps = x + ROAD_CELL / 2 > zone.x0 + 1e-6 && x - ROAD_CELL / 2 < zone.x1 - 1e-6 && z + ROAD_CELL / 2 > zone.z0 + 1e-6 && z - ROAD_CELL / 2 < zone.z1 - 1e-6;
      if (!overlaps || !free(ix, iz)) continue;
      prev.set(roadKey(ix, iz), null);
      queue.push([ix, iz]);
    }
  }
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let goal = null;
  for (let head = 0; head < queue.length && !goal; head++) {
    const [ix, iz] = queue[head];
    if (isTarget(ix, iz)) {
      goal = [ix, iz];
      break;
    }
    for (const [dx, dz] of steps) {
      const nx = ix + dx;
      const nz = iz + dz;
      const key = roadKey(nx, nz);
      if (prev.has(key) || !(free(nx, nz) || isTarget(nx, nz) && !roadCellProblem(colony, nx, nz))) continue;
      prev.set(key, [ix, iz]);
      queue.push([nx, nz]);
    }
  }
  if (!goal) return [];
  const path = [];
  for (let at = goal; at; at = prev.get(roadKey(...at))) path.push(at);
  return path.filter(([ix, iz]) => !colony.roads.has(roadKey(ix, iz)));
}
