import * as THREE from 'three';
import { ROAD_CELL } from './sim/economy.js';

// Dibujo de los caminos: el trazado de casillas se convierte en curvas suaves (se unen las casillas
// vecinas en cadenas y se redondean las esquinas), y cada tramo es una cinta que sigue el terreno
// con una textura propia de su nivel (tierra con huellas, empedrado, adoquín, asfalto) y bordes
// que se funden con el suelo.

const WIDTH = 3.4; // metros de ancho de la cinta
const STEP = 1.2; // separación de los puntos a lo largo
const TAPER = 2.2; // los extremos libres se afinan en esta distancia
const LIFT = 0.3;

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
  const speck = (n, colors, size) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.globalAlpha = 0.35 + r() * 0.45;
      const x = 10 + r() * (W - 20);
      g.fillRect(x, r() * H, 1 + r() * size, 1 + r() * size);
    }
    g.globalAlpha = 1;
  };
  if (level === 1) {
    // Tierra apisonada: dos huellas de ruedas y piedrecitas.
    g.fillStyle = '#b8935f';
    g.fillRect(0, 0, W, H);
    speck(500, ['#a07c4c', '#c9a672', '#8f6d40'], 3);
    g.fillStyle = 'rgba(90, 62, 34, 0.38)';
    for (const x of [W * 0.34, W * 0.66]) g.fillRect(x - 5, 0, 10, H);
    speck(40, ['#8c8a84', '#6e6a62'], 4);
  } else if (level === 2) {
    // Empedrado irregular: piedras redondeadas con juntas oscuras.
    g.fillStyle = '#4e4a44';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const x = 8 + r() * (W - 16);
      const y = r() * H;
      const rx = 6 + r() * 5;
      const ry = 5 + r() * 4;
      const tone = 118 + Math.floor(r() * 50);
      g.fillStyle = `rgb(${tone}, ${tone - 4}, ${tone - 10})`;
      for (const dy of [0, y < 12 ? H : y > H - 12 ? -H : 0]) {
        g.beginPath();
        g.ellipse(x, y + dy, rx, ry, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (level === 3) {
    // Adoquines rectangulares en hiladas alternadas.
    g.fillStyle = '#403c38';
    g.fillRect(0, 0, W, H);
    const bw = 20;
    const bh = 12;
    for (let row = 0; row * bh < H; row++) {
      for (let col = -1; col * bw < W + bw; col++) {
        const tone = 112 + Math.floor(r() * 36);
        g.fillStyle = `rgb(${tone}, ${tone - 6}, ${tone - 12})`;
        g.fillRect(col * bw + (row % 2) * (bw / 2) + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      }
    }
  } else {
    // Asfalto con rayas y línea central discontinua.
    g.fillStyle = '#3a3a40';
    g.fillRect(0, 0, W, H);
    speck(900, ['#2e2e34', '#46464c', '#505058'], 2);
    g.fillStyle = '#d8d4c4';
    g.fillRect(W / 2 - 2, 8, 4, H * 0.42);
    g.fillStyle = 'rgba(216, 212, 196, 0.85)';
    g.fillRect(W * 0.1, 0, 2, H);
    g.fillRect(W * 0.9 - 2, 0, 2, H);
  }
  // Bordes que se funden con el suelo (transparencia a los lados, con algo de irregularidad).
  const out = g.getImageData(0, 0, W, H);
  const fade = level === 4 ? 0.1 : 0.22;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const edge = Math.min(u, 1 - u) / fade;
      const wob = (Math.sin(y * 0.37 + x * 0.11) + Math.sin(y * 0.91 - x * 0.07)) * 0.06;
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

export function roadMaterials(levelCount) {
  return Array.from({ length: levelCount }, (_, i) => new THREE.MeshStandardMaterial({
    map: paint(i + 1),
    roughness: 1,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  }));
}

// ---- Del mapa de casillas a cadenas suaves --------------------------------------------------

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

// Aristas entre casillas vecinas (en diagonal sólo si no hay ya un camino por los lados).
function edgesOf(roads) {
  const edges = new Map(); // "a|b" -> { a, b, level }
  const add = (ia, ja, ib, jb) => {
    const ka = key(ia, ja);
    const kb = key(ib, jb);
    const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    edges.set(id, { a: [ia, ja], b: [ib, jb], level: Math.min(roads.get(ka), roads.get(kb)) });
  };
  for (const k of roads.keys()) {
    const [ix, iz] = k.split(',').map(Number);
    for (const [dx, dz] of DIRS) {
      if (!roads.has(key(ix + dx, iz + dz))) continue;
      if (dx && dz && (roads.has(key(ix + dx, iz)) || roads.has(key(ix, iz + dz)))) continue;
      add(ix, iz, ix + dx, iz + dz);
    }
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
function chainsOf(roads, edges, level) {
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
    chains.push({ cells, free: [degree.get(key(...cells[0])) === 1, degree.get(key(...cur)) === 1] });
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

// Construye la geometría de un nivel. heightAt(x, z) da la altura del suelo en el campamento.
export function buildRoadGeometry(roads, level, heightAt) {
  const edges = edgesOf(roads);
  const pos = [];
  const uv = [];
  const idx = [];
  for (const chain of chainsOf(roads, edges, level)) {
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
      // Afinar los extremos libres (punta redondeada).
      let w = 1;
      if (chain.free[0] && s < TAPER) w = Math.min(w, Math.sqrt(Math.max(0, 1 - ((TAPER - s) / TAPER) ** 2)) * 0.95 + 0.05);
      if (chain.free[1] && total - s < TAPER) w = Math.min(w, Math.sqrt(Math.max(0, 1 - ((TAPER - (total - s)) / TAPER) ** 2)) * 0.95 + 0.05);
      const half = (WIDTH / 2) * w;
      const lx = x - tz * half;
      const lz = z + tx * half;
      const rx = x + tz * half;
      const rz = z - tx * half;
      const base = pos.length / 3;
      pos.push(lx, heightAt(lx, lz) + LIFT, lz, rx, heightAt(rx, rz) + LIFT, rz);
      uv.push(0, s / WIDTH, 1, s / WIDTH);
      if (prev !== null) idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
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
