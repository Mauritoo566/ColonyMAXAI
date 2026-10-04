import * as THREE from 'three';
import { ROAD_CELL, ROAD_LIFT } from './sim/economy.js';
import { entranceOf, footprintRect, rectsOverlap, rect } from './sim/access.js';

// Dibujo de los caminos: el trazado de casillas se convierte en curvas suaves (se unen las casillas
// vecinas en cadenas y se redondean las esquinas), y cada tramo es una cinta que sigue el terreno
// con una textura propia de su nivel (tierra con huellas, empedrado, adoquín, asfalto) y bordes
// que se funden con el suelo.

const WIDTH = 3.4; // metros de ancho de la cinta (igual en todos los niveles)
const STEP = 0.9; // separación de los puntos a lo largo
const CAP = WIDTH / 2; // los extremos libres terminan en media luna de este radio
const LIFT = ROAD_LIFT;

const key = (ix, iz) => `${ix},${iz}`;

// ---- Texturas (se pintan una vez en un canvas) ---------------------------------------------

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function paint(level) {
  const W = 128;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const r = rng(level * 7919);
  const speck = (n, colors, size, x0 = 10, x1 = W - 10) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.globalAlpha = 0.35 + r() * 0.45;
      g.fillRect(x0 + r() * (x1 - x0), r() * H, 1 + r() * size, 1 + r() * size);
    }
    g.globalAlpha = 1;
  };
  // Cuánto se difumina el borde (fracción del ancho) y cuánta irregularidad tiene.
  let fade = 0.22;
  let wobble = 0.06;
  if (level === 1) {
    // Tierra apisonada: suelo compactado de color cálido, desgaste suave en el centro y bordes que se funden.
    g.fillStyle = '#b8935f';
    g.fillRect(0, 0, W, H);
    speck(520, ['#a07c4c', '#c9a672', '#8f6d40'], 3);
    const wear = g.createLinearGradient(W * 0.3, 0, W * 0.7, 0);
    wear.addColorStop(0, 'rgba(110, 80, 46, 0)');
    wear.addColorStop(0.5, 'rgba(110, 80, 46, 0.22)');
    wear.addColorStop(1, 'rgba(110, 80, 46, 0)');
    g.fillStyle = wear;
    g.fillRect(W * 0.3, 0, W * 0.4, H);
    speck(40, ['#8c8a84', '#6e6a62'], 4);
    // Hierba rala en los bordes.
    speck(60, ['#6f7f3a', '#5d6e32'], 2, 4, 22);
    speck(60, ['#6f7f3a', '#5d6e32'], 2, W - 22, W - 4);
  } else if (level === 2) {
    // Empedrado: piedras redondeadas y desiguales con juntas oscuras; el borde es una hilera de piedras mayores
    // y más oscuras, con un contorno irregular.
    fade = 0.1;
    wobble = 0.1;
    g.fillStyle = '#4a463f';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 80; i++) {
      const x = 14 + r() * (W - 28);
      const y = r() * H;
      const rx = 6 + r() * 5;
      const ry = 5 + r() * 4;
      const tone = 128 + Math.floor(r() * 46);
      g.fillStyle = `rgb(${tone}, ${tone - 4}, ${tone - 11})`;
      for (const dy of [0, y < 12 ? H : y > H - 12 ? -H : 0]) {
        g.beginPath();
        g.ellipse(x, y + dy, rx, ry, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (const side of [0, 1]) {
      for (let y = -4; y < H; y += 17) {
        const x = side ? W - 11 : 11;
        const tone = 96 + Math.floor(r() * 26);
        g.fillStyle = `rgb(${tone}, ${tone - 4}, ${tone - 10})`;
        g.beginPath();
        g.ellipse(x, y + 8 + r() * 3, 9 + r() * 2.5, 8 + r() * 2.5, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (level === 3) {
    // Adoquinado: adoquines rectangulares en hiladas alternadas, con bordillos claros de piedra a cada lado
    // y un borde limpio y recto.
    fade = 0.03;
    wobble = 0.01;
    g.fillStyle = '#3d3a36';
    g.fillRect(0, 0, W, H);
    const bw = 20;
    const bh = 12;
    for (let row = 0; row * bh < H; row++) {
      for (let col = -1; col * bw < W + bw; col++) {
        const tone = 114 + Math.floor(r() * 34);
        g.fillStyle = `rgb(${tone}, ${tone - 6}, ${tone - 12})`;
        g.fillRect(col * bw + (row % 2) * (bw / 2) + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      }
    }
    for (const x0 of [W * 0.035, W * 0.895]) {
      g.fillStyle = '#7c7870';
      g.fillRect(x0, 0, W * 0.07, H);
      g.fillStyle = '#cfcabe';
      g.fillRect(x0 + W * 0.012, 0, W * 0.046, H);
      g.fillStyle = '#5c5850';
      for (let y = 0; y < H; y += 21) g.fillRect(x0, y, W * 0.07, 1.5);
    }
  } else {
    // Asfalto: gris oscuro con grano, líneas continuas blancas en los bordes y una línea central discontinua.
    fade = 0.03;
    wobble = 0.01;
    g.fillStyle = '#383840';
    g.fillRect(0, 0, W, H);
    speck(900, ['#2e2e34', '#46464c', '#505058'], 2);
    g.fillStyle = '#e8e4d4';
    g.fillRect(W * 0.085, 0, 3, H);
    g.fillRect(W * 0.915 - 3, 0, 3, H);
    g.fillRect(W / 2 - 2, 8, 4, H * 0.42);
    g.fillStyle = '#2a2a30';
    g.fillRect(0, 0, W * 0.05, H);
    g.fillRect(W * 0.95, 0, W * 0.05, H);
  }
  // El borde se funde con el suelo (o queda nítido) según el nivel.
  const out = g.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const edge = Math.min(u, 1 - u) / fade;
      const wob = (Math.sin(y * 0.37 + x * 0.11) + Math.sin(y * 0.91 - x * 0.07)) * wobble;
      const a = Math.max(0, Math.min(1, edge + wob));
      out.data[(y * W + x) * 4 + 3] = Math.round(255 * a * a * (3 - 2 * a));
    }
  }
  g.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Un material por nivel. Se comparten entre mallas: no se crean por tramo.
export function roadMaterials(levelCount) {
  return Array.from({ length: levelCount }, (_, i) => new THREE.MeshStandardMaterial({
    map: paint(i + 1),
    roughness: 1,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    // Sin "factor": el desplazamiento de profundidad proporcional a la inclinación adelanta la cinta en vistas rasantes y la pinta
    // por encima de edificios, colonos y árboles que tiene delante. Un camino es un camino: sólo un empujón fijo mínimo contra
    // el parpadeo con el terreno (que ya queda ROAD_LIFT por debajo).
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -1,
  }));
}

// ---- Del mapa de casillas a cadenas suaves --------------------------------------------------

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

// Dónde termina el camino de un edificio: las casillas por las que se llega a su puerta. Devuelve un mapa
// "ix,iz" -> punto de la puerta { x, z } (en metros del campamento). buildings: [{ def, x, z, yaw }].
export function roadTerminals(buildings) {
  const out = new Map();
  for (const b of buildings) {
    const e = entranceOf(b.def, b.x, b.z, b.yaw ?? 0);
    if (!e) continue;
    const z = e.zone;
    for (let ix = Math.floor(z.x0 / ROAD_CELL - 0.5); ix <= Math.ceil(z.x1 / ROAD_CELL + 0.5); ix++) {
      for (let iz = Math.floor(z.z0 / ROAD_CELL - 0.5); iz <= Math.ceil(z.z1 / ROAD_CELL + 0.5); iz++) {
        const cell = rect(ix * ROAD_CELL - ROAD_CELL / 2, ix * ROAD_CELL + ROAD_CELL / 2, iz * ROAD_CELL - ROAD_CELL / 2, iz * ROAD_CELL + ROAD_CELL / 2);
        if (rectsOverlap(cell, z)) out.set(key(ix, iz), { x: e.door.x, z: e.door.z });
      }
    }
  }
  return out;
}

// Aristas entre casillas vecinas (en diagonal sólo si no hay ya un camino por los lados). Las casillas que dan a una
// puerta tienen además una arista a un nodo "virtual" sobre la puerta: así el camino llega hasta el edificio.
function edgesOf(roads, terminals = new Map()) {
  const edges = new Map(); // "a|b" -> { a, b, level }
  const add = (ia, ja, ib, jb, level) => {
    const ka = key(ia, ja);
    const kb = key(ib, jb);
    const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    edges.set(id, { a: [ia, ja], b: [ib, jb], level });
  };
  for (const k of roads.keys()) {
    const [ix, iz] = k.split(',').map(Number);
    for (const [dx, dz] of DIRS) {
      if (!roads.has(key(ix + dx, iz + dz))) continue;
      if (dx && dz && (roads.has(key(ix + dx, iz)) || roads.has(key(ix, iz + dz)))) continue;
      add(ix, iz, ix + dx, iz + dz, Math.min(roads.get(k), roads.get(key(ix + dx, iz + dz))));
    }
    const door = terminals.get(k);
    if (door) add(ix, iz, door.x / ROAD_CELL, door.z / ROAD_CELL, roads.get(k));
  }
  return edges;
}

// Chaikin: redondea las esquinas dejando fijos los extremos.
function smooth(points, rounds = 3) {
  let p = points;
  for (let n = 0; n < rounds && p.length > 2; n++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

// Cadenas de casillas de un nivel: [{ cells: [[ix, iz], ...], free: [bool, bool] }].
function chainsOf(roads, edges, level, virtual = new Set()) {
  const mine = [...edges.values()].filter((e) => e.level === level);
  const adj = new Map();
  const link = (p, q, e) => {
    const k = key(...p);
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push({ to: q, e });
  };
  for (const e of mine) {
    link(e.a, e.b, e);
    link(e.b, e.a, e);
  }
  // Grado total (de cualquier nivel): sólo se afinan los extremos de verdad libres.
  const degree = new Map();
  for (const e of edges.values()) {
    for (const p of [e.a, e.b]) degree.set(key(...p), (degree.get(key(...p)) ?? 0) + 1);
  }
  const used = new Set();
  const chains = [];
  const eid = (p, q) => (key(...p) < key(...q) ? `${key(...p)}|${key(...q)}` : `${key(...q)}|${key(...p)}`);
  const walk = (start, first) => {
    const cells = [start];
    let prev = start;
    let cur = first.to;
    used.add(eid(start, cur));
    cells.push(cur);
    while ((adj.get(key(...cur))?.length ?? 0) === 2) {
      const next = adj.get(key(...cur)).find((n) => eid(cur, n.to) !== eid(prev, cur));
      if (!next || used.has(eid(cur, next.to))) break;
      used.add(eid(cur, next.to));
      prev = cur;
      cur = next.to;
      cells.push(cur);
    }
    chains.push({ cells, free: [degree.get(key(...cells[0])) === 1 && !virtual.has(key(...cells[0])), degree.get(key(...cur)) === 1 && !virtual.has(key(...cur))] });
  };
  // Primero desde extremos y cruces; luego lo que quede (anillos).
  for (const [k, list] of adj) {
    if (list.length === 2) continue;
    const start = k.split(',').map(Number);
    for (const n of list) if (!used.has(eid(start, n.to))) walk(start, n);
  }
  for (const [k, list] of adj) {
    const start = k.split(',').map(Number);
    for (const n of list) if (!used.has(eid(start, n.to))) walk(start, n);
  }
  // Casillas sueltas (sin vecinas): un tramo corto.
  for (const k of roads.keys()) {
    if (roads.get(k) !== level || degree.has(k)) continue;
    const [ix, iz] = k.split(',').map(Number);
    chains.push({ cells: [[ix - 0.3, iz], [ix + 0.3, iz]], free: [true, true] });
  }
  return chains;
}

// Resamplea una polilínea a puntos cada STEP metros.
function resample(points) {
  const out = [];
  let carry = 0;
  out.push(points[0]);
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let d = STEP - carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len]);
      d += STEP;
    }
    carry = len - (d - STEP);
  }
  const last = points[points.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > 0.05) out.push(last);
  return out;
}

// Construye la geometría de un nivel. heightAt(x, z) da la altura del suelo en el campamento; terminals (opcional)
// son las casillas que dan a una puerta (ver roadTerminals), para que el camino llegue hasta ella.
// Las huellas de los edificios (rectángulos) donde la cinta no se dibuja nunca. buildings: [{ def, x, z }]. Los adornos pequeños no cuentan.
export function footprintBlockers(buildings) {
  const out = [];
  for (const b of buildings) {
    if (!b.def || b.def.line || b.def.small) continue;
    const r = footprintRect(b.def, b.x, b.z);
    if (r) out.push(r);
  }
  return out;
}

export function buildRoadGeometry(roads, level, heightAt, terminals = new Map(), blockers = []) {
  const edges = edgesOf(roads, terminals);
  const virtual = new Set();
  for (const e of edges.values()) {
    for (const p of [e.a, e.b]) if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) virtual.add(key(...p));
  }
  const pos = [];
  const uv = [];
  const idx = [];
  for (const chain of chainsOf(roads, edges, level, virtual)) {
    const pts = resample(smooth(chain.cells.map(([ix, iz]) => [ix * ROAD_CELL, iz * ROAD_CELL])));
    if (pts.length < 2) continue;
    let s = 0;
    const total = pts.reduce((acc, p, i) => acc + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    let prev = null;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      if (i) s += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // Los extremos libres terminan en media luna; los que llegan a una puerta o a otro camino, rectos.
      let w = 1;
      const cap = (d) => Math.sqrt(Math.max(0, 1 - ((CAP - d) / CAP) ** 2)) * 0.97 + 0.03;
      if (chain.free[0] && s < CAP) w = Math.min(w, cap(s));
      if (chain.free[1] && total - s < CAP) w = Math.min(w, cap(total - s));
      const half = (WIDTH / 2) * w;
      const lx = x - tz * half;
      const lz = z + tx * half;
      const rx = x + tz * half;
      const rz = z - tx * half;
      // Dentro de la huella de un edificio no hay camino: el tramo se corta ahí (y se retoma al salir).
      if (blockers.some((r) => x > r.x0 + 0.05 && x < r.x1 - 0.05 && z > r.z0 + 0.05 && z < r.z1 - 0.05)) {
        prev = null;
        continue;
      }
      const base = pos.length / 3;
      // Tres filas (borde, eje, borde): la cinta sigue las lomas y hondonadas del terreno.
      pos.push(lx, heightAt(lx, lz) + LIFT, lz, x, heightAt(x, z) + LIFT, z, rx, heightAt(rx, rz) + LIFT, rz);
      uv.push(0, s / WIDTH, 0.5, s / WIDTH, 1, s / WIDTH);
      if (prev !== null) idx.push(prev, base, prev + 1, prev + 1, base, base + 1, prev + 1, base + 1, prev + 2, prev + 2, base + 1, base + 2);
      prev = base;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}
