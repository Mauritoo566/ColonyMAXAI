// Mobs: animales del mundo. Se simulan en el servidor (dentro de la colonia cercana) y se mandan con el
// resto del estado, así que todos los jugadores cercanos los ven en vivo. Sin Three.js (datos y cuentas).
// Los modelos están en src/mobs.js. El mundo no depende de tu edad: aparecen por bioma.

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
const MAX_ROAM = 230;

export function spawnMobs(sim, biomeId, rand) {
  const set = BIOME_MOBS[biomeId];
  sim.mobs = [];
  if (!set) return;
  let id = 0;
  const place = (type, min, max) => {
    for (let k = 0; k < 20; k++) {
      const a = rand() * Math.PI * 2;
      const r = min + rand() * (max - min);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (sim.walkable(x, z, 1.5)) {
        sim.mobs.push({ id: id++, type, x, z, facing: rand() * Math.PI * 2, state: 0, wait: rand() * 6, tx: x, tz: z, cd: 0, target: null });
        return;
      }
    }
  };
  // Más y más cerca: unos pocos a la vista del campamento y el resto repartido por el territorio.
  for (let i = 0; i < Math.ceil(set.n * 0.4); i++) place(set.peaceful[Math.floor(rand() * set.peaceful.length)], 22, 55);
  for (let i = 0; i < set.n * 1.2; i++) place(set.peaceful[Math.floor(rand() * set.peaceful.length)], 45, 150);
  for (let i = 0; i < set.h; i++) place(set.hostile[Math.floor(rand() * set.hostile.length)], 110, 220);
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

export function updateMobs(sim, dt, isNight) {
  if (!sim.mobs?.length || dt > 2) return;
  const rand = Math.random;
  for (const m of sim.mobs) {
    const st = MOB_STATS[m.type];
    m.cd = Math.max(0, m.cd - dt);
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
          target.needs.mood = Math.max(0, target.needs.mood - 15);
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
    const speed = st.speed * (m.state === 2 ? 1 : 0.6) * dt;
    let nx = m.x + (dx / d) * Math.min(speed, d);
    let nz = m.z + (dz / d) * Math.min(speed, d);
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
      const min = o.r + 0.6;
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
    if (blocked && m.state === 1) m.wait = 0; // elige otro rumbo
  }
}
