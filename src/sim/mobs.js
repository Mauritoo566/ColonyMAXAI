// Mobs: animales del mundo. Se simulan en el servidor (dentro de la colonia cercana) y se mandan con el
// resto del estado, así que todos los jugadores cercanos los ven en vivo. Sin Three.js (datos y cuentas).
// Los modelos están en src/mobs.js. El mundo no depende de tu edad: aparecen por bioma.
import { addMoodEvent } from '../needs.js';
import { checkStable } from './stable.js';
import { DAY_LENGTH_SECONDS } from '../daynight.js';

export const MOB_TYPES = ['conejo', 'ciervo', 'jabali', 'oveja', 'uro', 'caballo', 'lobo', 'oso'];

// speed: m/s al andar · dmg/hp/range: sólo hostiles (daño por golpe, golpe cada 1,4 s)
export const MOB_STATS = {
  conejo: { speed: 1.4, hostile: false },
  ciervo: { speed: 2.2, hostile: false },
  jabali: { speed: 1.7, hostile: false },
  oveja: { speed: 1.2, hostile: false },
  uro: { speed: 1.4, hostile: false },
  caballo: { speed: 3, hostile: false },
  lobo: { speed: 3.2, hostile: true, dmg: 7, sight: 30 },
  oso: { speed: 2.4, hostile: true, dmg: 14, sight: 24 },
};

// Qué vive en cada bioma (ids de biomes.js).
const BIOME_MOBS = {
  forest: { peaceful: ['conejo', 'ciervo', 'jabali'], hostile: ['lobo', 'oso'], n: 12, h: 3 },
  grassland: { peaceful: ['conejo', 'ciervo', 'uro', 'oveja'], hostile: ['lobo'], n: 14, h: 1 },
  steppe: { peaceful: ['caballo', 'oveja', 'conejo'], hostile: ['lobo'], n: 10, h: 2 },
  taiga: { peaceful: ['ciervo', 'conejo'], hostile: ['lobo', 'oso'], n: 8, h: 3 },
  tundra: { peaceful: ['ciervo', 'conejo'], hostile: ['lobo'], n: 6, h: 2 },
  mountain: { peaceful: ['oveja'], hostile: ['lobo', 'oso'], n: 5, h: 2 },
  savanna: { peaceful: ['caballo', 'ciervo'], hostile: [], n: 8, h: 0 },
  jungle: { peaceful: ['conejo', 'jabali'], hostile: [], n: 6, h: 0 },
  swamp: { peaceful: ['conejo'], hostile: [], n: 4, h: 0 },
  desert: { peaceful: ['conejo'], hostile: [], n: 2, h: 0 },
  beach: { peaceful: ['conejo'], hostile: [], n: 2, h: 0 },
};

const FIRE_SAFE = 14; // metros: los hostiles no se acercan a la fogata
const HIT_EVERY = 1.4;
const MOB_RADIUS = 0.6; // metros que guarda un animal de los obstáculos
const MAX_ROAM = 230;

// Manadas y rebaños: casi todos viven en grupo con un líder al que siguen (los osos van solos).
const GROUP = { conejo: [2, 4], ciervo: [3, 6], jabali: [2, 4], oveja: [4, 8], uro: [3, 6], caballo: [3, 6], lobo: [2, 4], oso: [1, 1] };

export function spawnMobs(sim, biomeId, rand) {
  const set = BIOME_MOBS[biomeId];
  sim.mobs = [];
  sim.mobBiome = biomeId;
  if (!set) return;
  let id = 0;
  let group = 0;
  const spot = (min, max) => {
    for (let k = 0; k < 25; k++) {
      const a = rand() * Math.PI * 2;
      const r = min + rand() * (max - min);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (sim.walkable(x, z, 1.5)) return { x, z };
    }
    return null;
  };
  // Crea un grupo del tipo dado (hasta "left" animales) y devuelve cuántos puso.
  const herd = (type, min, max, left) => {
    const c = spot(min, max);
    if (!c) return 0;
    const [lo, hi] = GROUP[type];
    const n = Math.min(left, lo + Math.floor(rand() * (hi - lo + 1)));
    const g = group++;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const ox = i ? (rand() - 0.5) * 7 : 0;
      const oz = i ? (rand() - 0.5) * 7 : 0;
      const x = c.x + ox;
      const z = c.z + oz;
      if (!sim.walkable(x, z, 1)) continue;
      sim.mobs.push({ id: id++, type, x, z, facing: rand() * Math.PI * 2, state: 0, wait: rand() * 4, tx: x, tz: z, cd: 0, target: null, g, leader: made === 0, ox, oz });
      made++;
    }
    return made;
  };
  // Pacíficos: unos grupos a la vista del campamento y el resto repartidos por el territorio.
  const total = Math.ceil(set.n * 1.6);
  let made = 0;
  for (let guard = 0; made < total && guard < 40; guard++) {
    const near = made < total * 0.35;
    made += herd(set.peaceful[Math.floor(rand() * set.peaceful.length)], near ? 22 : 50, near ? 60 : 150, total - made);
  }
  // Hostiles: lejos del campamento.
  made = 0;
  for (let guard = 0; made < set.h && guard < 20; guard++) made += herd(set.hostile[Math.floor(rand() * set.hostile.length)], 110, 220, set.h - made);
}

// ---- Manadas de caballos que llegan solas -----------------------------------------------------------------------------------
// Los caballos son un recurso indispensable (se domestican para las expediciones), así que cada cierto tiempo llega una manada nueva cerca de
// la aldea aunque el bioma no sea de caballos, hasta un máximo de salvajes a la vez. Los animales viven en el servidor: todos ven los mismos.
const HORSE_BIOMES = new Set(['grassland', 'steppe', 'savanna', 'forest', 'taiga', 'mountain']);
export const MAX_WILD_HORSES = 9;
const HORSE_EVERY = DAY_LENGTH_SECONDS * 0.3; // segundos de juego entre una manada y la siguiente (con variación)
const HORSE_NEAR = [55, 130]; // a qué distancia de la fogata aparece

export const nextMobId = (sim) => sim.mobs.reduce((n, m) => Math.max(n, m.id + 1), 0);

export function wildHorses(sim) {
  return sim.mobs.filter((m) => m.type === 'caballo' && !m.tamed && !m.order).length;
}

// Crea una manada de caballos salvajes a la distancia dada de la fogata. Devuelve cuántos puso.
export function spawnHorseHerd(sim, rand = Math.random) {
  if (!sim.camp) return 0;
  const free = (x, z, margin) => sim.walkable(x, z, margin) && !sim.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < 25) && !sim.nearRoad(x, z, 6);
  let c = null;
  for (let k = 0; k < 40 && !c; k++) {
    const a = rand() * Math.PI * 2;
    const r = HORSE_NEAR[0] + rand() * (HORSE_NEAR[1] - HORSE_NEAR[0]);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (free(x, z, 1.5)) c = { x, z };
  }
  if (!c) return 0;
  const [lo, hi] = GROUP.caballo;
  const n = Math.min(MAX_WILD_HORSES - wildHorses(sim), lo + Math.floor(rand() * (hi - lo + 1)));
  const g = sim.mobs.reduce((m, o) => Math.max(m, (o.g ?? -1) + 1), 0);
  let id = nextMobId(sim);
  let made = 0;
  for (let i = 0; i < n; i++) {
    const ox = i ? (rand() - 0.5) * 7 : 0;
    const oz = i ? (rand() - 0.5) * 7 : 0;
    const x = c.x + ox;
    const z = c.z + oz;
    if (!sim.walkable(x, z, 1)) continue;
    sim.mobs.push({ id: id++, type: 'caballo', x, z, facing: rand() * Math.PI * 2, state: 0, wait: rand() * 4, tx: x, tz: z, cd: 0, target: null, g, leader: made === 0, ox, oz });
    made++;
  }
  return made;
}

// Cada paso: cuenta atrás; al llegar a cero, si hay pocos caballos salvajes, llega una manada nueva.
function horseTrickle(sim, dt) {
  if (sim.remote || !sim.camp || !HORSE_BIOMES.has(sim.mobBiome ?? 'grassland')) return;
  sim.horseTimer = (sim.horseTimer ?? 20 + Math.random() * 40) - dt;
  if (sim.horseTimer > 0) return;
  sim.horseTimer = HORSE_EVERY * (0.7 + Math.random() * 0.6);
  if (wildHorses(sim) > MAX_WILD_HORSES - 3) return;
  if (spawnHorseHerd(sim) > 0) sim.emit?.('notice', 'Una manada de caballos salvajes llegó cerca de la aldea');
}

// ¿Cuida a este colono alguna defensa (atalaya o fuerte terminados cerca)?
function guarded(sim, c) {
  for (const b of sim.buildings) if (b.done && (b.def.id === 'watchtower' || b.def.id === 'fort') && Math.hypot(b.x - c.x, b.z - c.z) < 30) return true;
  return false;
}

// Hostil cerca de un colono (para que huya hacia la fogata).
export function mobThreat(sim, c) {
  if (sim.absent || !sim.mobs?.length) return false;
  for (const m of sim.mobs) if (MOB_STATS[m.type].hostile && Math.hypot(m.x - c.x, m.z - c.z) < 20) return true;
  return false;
}

// Distancia al animal que de verdad está cazando a este colono ahora (Infinity si ninguno): sólo así hay un peligro real que
// justifique el miedo. Un hostil que pasea lejos, o de día (los lobos sólo cazan de noche), no cuenta: no persigue a nadie.
export function huntedDistance(sim, c) {
  let best = Infinity;
  if (sim.absent || !sim.mobs?.length) return best;
  for (const m of sim.mobs) if (m.state === 2 && m.target === c.id && MOB_STATS[m.type].hostile) best = Math.min(best, Math.hypot(m.x - c.x, m.z - c.z));
  return best;
}

// Hacia dónde ir para llegar a (m.tx, m.tz) rodeando lo que haya en medio: el destino si el camino está libre, o el siguiente
// punto de una ruta planeada (como los colonos). Sin esto un animal que quería pasar al otro lado de un edificio se quedaba
// empujando contra él. Si no hay ruta, lo reintenta pasados unos segundos (no recalcula a cada paso).
function mobGoal(sim, m, dt) {
  m.pathWait = Math.max(0, (m.pathWait ?? 0) - dt);
  let p = m.opath;
  if (p && (p.obs !== sim.obstacles || Math.hypot(p.tx - m.tx, p.tz - m.tz) > 2)) p = m.opath = null;
  if (!p) {
    if (!sim.lineBlocked(m.x, m.z, m.tx, m.tz, 0.15)) return { x: m.tx, z: m.tz };
    if (m.pathWait > 0) return { x: m.tx, z: m.tz };
    const pts = sim.findObstaclePath(m.x, m.z, m.tx, m.tz, MOB_RADIUS + 0.1);
    if (!pts) {
      m.pathWait = 3;
      return { x: m.tx, z: m.tz };
    }
    p = m.opath = { obs: sim.obstacles, tx: m.tx, tz: m.tz, pts, i: 0 };
  }
  while (p.i < p.pts.length - 1 && Math.hypot(p.pts[p.i].x - m.x, p.pts[p.i].z - m.z) < 1.2) p.i++;
  if (p.i >= p.pts.length - 1) {
    m.opath = null;
    return { x: m.tx, z: m.tz };
  }
  return p.pts[p.i];
}

// Un caballo domesticado: va a su hueco junto al establo y allí se queda, dando algún paso corto de vez en cuando.
function tamedStep(sim, m, dt) {
  const st = MOB_STATS[m.type];
  const home = m.stall ?? { x: m.x, z: m.z };
  if (m.state === 0) {
    m.wait = (m.wait ?? 0) - dt;
    if (m.wait > 0) return;
    const a = Math.random() * Math.PI * 2;
    const r = 0.5 + Math.random() * 1.2;
    m.tx = home.x + Math.cos(a) * r;
    m.tz = home.z + Math.sin(a) * r;
    m.state = 1;
  }
  const d = Math.hypot(m.tx - m.x, m.tz - m.z);
  if (d < 0.5) {
    m.state = 0;
    m.wait = 3 + Math.random() * 6;
    return;
  }
  const goal = mobGoal(sim, m, dt);
  const gd = Math.hypot(goal.x - m.x, goal.z - m.z) || 1;
  const step = Math.min(st.speed * 0.7 * dt, d);
  let nx = m.x + ((goal.x - m.x) / gd) * step;
  let nz = m.z + ((goal.z - m.z) / gd) * step;
  for (const o of sim.obstacles) {
    const px = nx - o.x;
    const pz = nz - o.z;
    const dist = Math.hypot(px, pz);
    const min = o.r + MOB_RADIUS;
    if (dist < min && dist > 1e-4) {
      nx = o.x + (px / dist) * min;
      nz = o.z + (pz / dist) * min;
      m.opath = null;
    }
  }
  m.facing = Math.atan2(nx - m.x, nz - m.z);
  m.x = nx;
  m.z = nz;
}

export function updateMobs(sim, dt, isNight) {
  if (dt > 2) return;
  horseTrickle(sim, dt);
  if (!sim.mobs?.length) return;
  const rand = Math.random;
  for (const m of sim.mobs) {
    const st = MOB_STATS[m.type];
    m.cd = Math.max(0, m.cd - dt);
    if (m.order || m.tamed) checkStable(sim, m);
    // Esperando al colono que lo va a domesticar: se queda quieto. Ya domesticado: vive junto al establo.
    if (m.order) {
      m.state = 0;
      continue;
    }
    if (m.tamed) {
      tamedStep(sim, m, dt);
      continue;
    }
    // Hostiles: de noche (o los osos siempre que haya hambre cerca) buscan al colono más cercano al descubierto.
    let target = null;
    if (st.hostile && !sim.absent && (isNight || m.type === 'oso')) {
      let best = st.sight;
      for (const c of sim.colonists) {
        if (c.inside || (c.sleeping && !c.outdoorSleep)) continue;
        if (Math.hypot(c.x, c.z) < FIRE_SAFE || guarded(sim, c)) continue;
        const d = Math.hypot(c.x - m.x, c.z - m.z);
        if (d < best) {
          best = d;
          target = c;
        }
      }
    }
    // Los pacíficos huyen de un hostil cercano (corriendo).
    let fleeing = false;
    if (!st.hostile) {
      let near = null;
      let nd = 16;
      for (const h of sim.mobs) {
        if (!MOB_STATS[h.type].hostile) continue;
        const d = Math.hypot(h.x - m.x, h.z - m.z);
        if (d < nd) {
          nd = d;
          near = h;
        }
      }
      if (near) {
        const dx = m.x - near.x;
        const dz = m.z - near.z;
        const d = Math.hypot(dx, dz) || 1;
        m.tx = Math.max(-MAX_ROAM, Math.min(MAX_ROAM, m.x + (dx / d) * 25));
        m.tz = Math.max(-MAX_ROAM, Math.min(MAX_ROAM, m.z + (dz / d) * 25));
        m.state = 1;
        fleeing = true;
      }
    }
    // Los seguidores acompañan a su líder (los lobos también cazan en manada).
    if (!fleeing && !target && m.g != null && !m.leader) {
      const lead = sim.mobs.find((o) => o.g === m.g && o.leader && !o.tamed && !o.order);
      if (lead && Math.hypot(lead.x - m.x, lead.z - m.z) > 6) {
        m.tx = lead.x + m.ox;
        m.tz = lead.z + m.oz;
        m.state = 1;
        m.wait = 0;
      } else if (m.state === 1 && lead) {
        m.state = 0;
        m.wait = 1 + rand() * 3;
      }
      if (lead && m.state === 0) {
        m.wait = Math.max(m.wait, 0.5);
        m.state = 0;
        continue;
      }
    }
    if (target) {
      m.state = 2;
      m.tx = target.x;
      m.tz = target.z;
      m.target = target.id;
      if (Math.hypot(target.x - m.x, target.z - m.z) < 1.5) {
        if (m.cd <= 0) {
          m.cd = HIT_EVERY;
          target.health -= st.dmg;
          target.lastHurtBy = m.type;
          addMoodEvent(target, 'attack', -15, sim.gameTime);
        }
        continue; // pegado al colono: no se mueve
      }
    } else if (m.state === 2) {
      m.state = 0;
      m.wait = 2 + rand() * 4;
    }
    if (m.state === 0) {
      m.wait -= dt;
      if (m.wait <= 0) {
        const a = rand() * Math.PI * 2;
        const r = 6 + rand() * 24;
        m.tx = Math.max(-MAX_ROAM, Math.min(MAX_ROAM, m.x + Math.cos(a) * r));
        m.tz = Math.max(-MAX_ROAM, Math.min(MAX_ROAM, m.z + Math.sin(a) * r));
        m.state = 1;
      }
      continue;
    }
    const dx = m.tx - m.x;
    const dz = m.tz - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8) {
      if (m.state === 1) {
        m.state = 0;
        m.wait = 2 + rand() * 5;
      }
      continue;
    }
    const speed = st.speed * (m.state === 2 ? 1 : fleeing ? 1 : m.g != null && !m.leader ? 0.9 : 0.6) * dt;
    // Rodea lo que haya en medio (edificios, muros, troncos) en vez de empujar contra ello.
    const goal = mobGoal(sim, m, dt);
    const gd = Math.hypot(goal.x - m.x, goal.z - m.z) || 1;
    let nx = m.x + ((goal.x - m.x) / gd) * Math.min(speed, d);
    let nz = m.z + ((goal.z - m.z) / gd) * Math.min(speed, d);
    // Los hostiles no entran en el círculo de la fogata; todos rodean edificios y muros.
    if (st.hostile && Math.hypot(nx, nz) < FIRE_SAFE) {
      m.state = 0;
      m.wait = 2;
      continue;
    }
    let blocked = false;
    for (const o of sim.obstacles) {
      const px = nx - o.x;
      const pz = nz - o.z;
      const dist = Math.hypot(px, pz);
      const min = o.r + MOB_RADIUS;
      if (dist < min) {
        blocked = true;
        if (dist > 1e-4) {
          nx = o.x + (px / dist) * min;
          nz = o.z + (pz / dist) * min;
        }
      }
    }
    if (sim.heightAt(nx, nz) < 0.7) {
      m.state = 0;
      m.wait = 1;
      continue;
    }
    m.facing = Math.atan2(nx - m.x, nz - m.z);
    m.x = nx;
    m.z = nz;
    if (blocked) m.opath = null; // algo lo desvió: replanea
    if (blocked && m.state === 1 && !m.opath && m.pathWait > 0) m.wait = 0; // sin ruta: elige otro rumbo
  }
}

// Ficha de cada animal (para la interfaz).
export const MOB_INFO = {
  conejo: { name: 'Conejo', text: 'Pequeño y muy asustadizo. Vive en grupos pequeños y huye de todo.', gives: 'Presa fácil: comida (cuando se pueda cazar).' },
  ciervo: { name: 'Ciervo', text: 'Vive en rebaños y se aleja corriendo de los depredadores.', gives: 'Carne y pieles (cuando se pueda cazar).' },
  jabali: { name: 'Jabalí', text: 'Manso mientras nadie lo moleste. Va en pequeños grupos por el bosque.', gives: 'Carne (cuando se pueda cazar).' },
  oveja: { name: 'Oveja salvaje', text: 'Rebaño numeroso que pasta tranquilo.', gives: 'Carne y lana (cuando se pueda cazar o domesticar).' },
  uro: { name: 'Uro', text: 'Bovino salvaje de gran tamaño. Se mueve en rebaños.', gives: 'Carne y cuero (cuando se pueda cazar).' },
  caballo: { name: 'Caballo salvaje', text: 'Veloz; recorre la pradera en manadas.', gives: 'Se puede domesticar con manzanas (hace falta un establo).' },
  lobo: { name: 'Lobo', text: 'Caza en manada, sobre todo de noche. Ataca a quien esté al descubierto y teme al fuego.', gives: 'Peligro: 7 de daño por golpe.' },
  oso: { name: 'Oso', text: 'Solitario y fuerte. Ataca a los colonos que se acercan, de día o de noche. Teme al fuego.', gives: 'Peligro: 14 de daño por golpe.' },
};

export const MOB_STATE_TEXT = ['Descansando', 'Caminando', 'Atacando'];
