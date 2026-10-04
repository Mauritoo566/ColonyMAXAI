// Dibuja modelos de edificios a una imagen PNG (rasterizador por software, sin navegador) para ver cómo quedan: una hoja con varias vistas
// isométricas, el suelo, la cuadrícula de 4 m y el contorno de la huella que reserva cada tipo.
// Uso:
//   node tools/render-models.mjs --out hoja.png --type house            todos los niveles de un tipo
//   node tools/render-models.mjs --out hoja.png --types house,hospital  varios tipos (un nivel cada uno con --level N)
//   node tools/render-models.mjs --out hoja.png --models gen:hall:4:stockpile,torchModel1
//   opciones: --cols 4 --size 320 --yaw 35 --pitch 30 --level N (sólo ese nivel) --scale 14 (metros que caben en la imagen)
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { BUILDINGS } from '../src/sim/buildingTypes.js';
import { levelModel } from '../src/buildingModels.js';
import { halfFor } from '../src/sim/access.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const OUT = opt('out', 'modelos.png');
const COLS = Number(opt('cols', 4));
const SIZE = Number(opt('size', 320));
const YAW = (Number(opt('yaw', 35)) * Math.PI) / 180;
const PITCH = (Number(opt('pitch', 30)) * Math.PI) / 180;
const SCALE = Number(opt('scale', 14)); // metros que caben en la imagen
const ONLY_LEVEL = opt('level', null);

// ---- Qué dibujar ----------------------------------------------------------------------------------------------------------------------
const items = [];
const addType = (id) => {
  const def = BUILDINGS[id];
  if (!def) throw new Error(`No existe el tipo ${id}`);
  def.levels.forEach((lv, i) => {
    if (ONLY_LEVEL && Number(ONLY_LEVEL) !== i + 1) return;
    items.push({ label: `${id} L${i + 1} (edad ${lv.age})`, model: lv.model, half: halfFor(def) });
  });
};
if (opt('type', null)) addType(opt('type'));
if (opt('types', null)) for (const id of opt('types').split(',')) addType(id);
if (opt('models', null)) for (const m of opt('models').split(',')) items.push({ label: m, model: m, half: 2 });
if (!items.length) throw new Error('Nada que dibujar: usa --type, --types o --models');

// ---- Cámara ------------------------------------------------------------------------------------------------------------------------------
const d = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH)).normalize(); // hacia la cámara
const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize();
const up = new THREE.Vector3().crossVectors(d, right).normalize();
const LIGHT = new THREE.Vector3(0.45, 0.85, 0.55).normalize();
const toSRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// ---- Rasterizador ---------------------------------------------------------------------------------------------------------------------
function renderScene(tris, cell, cx0, cy0, img, W) {
  const z = new Float32Array(cell * cell).fill(-1e9);
  const px = cell / SCALE;
  const proj = (p) => [cell / 2 + p[0] * px, cell * 0.62 - p[1] * px, p[2]];
  for (const t of tris) {
    const a = proj(t.a);
    const b = proj(t.b);
    const c = proj(t.c);
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(cell - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(cell - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const sx = x + 0.5;
        const sy = y + 0.5;
        const w0 = ((b[1] - c[1]) * (sx - c[0]) + (c[0] - b[0]) * (sy - c[1])) / den;
        const w1 = ((c[1] - a[1]) * (sx - c[0]) + (a[0] - c[0]) * (sy - c[1])) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
        const depth = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const zi = y * cell + x;
        if (depth <= z[zi]) continue;
        z[zi] = depth;
        const o = ((cy0 + y) * W + cx0 + x) * 3;
        img[o] = t.rgb[0];
        img[o + 1] = t.rgb[1];
        img[o + 2] = t.rgb[2];
      }
    }
  }
}

function trisOf(model, half) {
  const out = [];
  const mesh = levelModel(model);
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const col = g.attributes.color;
  const nor = g.attributes.normal;
  const v = (i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  const shade = (n) => {
    const l = Math.max(0, n.dot(LIGHT));
    return 0.42 + 0.7 * l;
  };
  const push = (a, b, c, rgb, n) => {
    const k = shade(n);
    out.push({
      a: [a.dot(right), a.dot(up), a.dot(d)],
      b: [b.dot(right), b.dot(up), b.dot(d)],
      c: [c.dot(right), c.dot(up), c.dot(d)],
      rgb: [Math.min(255, rgb[0] * k), Math.min(255, rgb[1] * k), Math.min(255, rgb[2] * k)],
    });
  };
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const a = v(i);
    const b = v(i + 1);
    const c = v(i + 2);
    let n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    // Material de doble cara: la normal se vuelve hacia la cámara.
    if (n.dot(d) < 0) n.negate();
    const rgb = [col.getX(i), col.getY(i), col.getZ(i)].map((c) => toSRGB(c) * 255);
    push(a, b, c, rgb, n);
  }
  // Suelo (verde) y contorno de la huella (rojo) en y = 0.
  const ground = (x0, z0, x1, z1, y, rgb) => {
    const P = (x, zz) => new THREE.Vector3(x, y, zz);
    const n = new THREE.Vector3(0, 1, 0);
    push(P(x0, z0), P(x1, z0), P(x1, z1), rgb, n);
    push(P(x0, z0), P(x1, z1), P(x0, z1), rgb, n);
  };
  void nor;
  return { tris: out, ground };
}

function drawItem(it, cell, cx0, cy0, img, W) {
  const { tris, ground } = trisOf(it.model, it.half);
  const base = [];
  // Suelo: césped con la cuadrícula de 4 m (rayas más oscuras) y la huella en rojo.
  const R = 9;
  for (let gx = -R; gx < R; gx += 2) {
    for (let gz = -R; gz < R; gz += 2) {
      const dark = ((gx / 2) + (gz / 2)) % 2 === 0;
      const rgbs = dark ? [92, 126, 70] : [100, 136, 76];
      const k = 1;
      const P = (x, zz) => new THREE.Vector3(x, -0.02, zz);
      const n = new THREE.Vector3(0, 1, 0);
      const l = 0.42 + 0.7 * Math.max(0, n.dot(LIGHT));
      const rgb = rgbs.map((c) => c * l * k);
      const t = (a, b, c) => ({ a: [a.dot(right), a.dot(up), a.dot(d)], b: [b.dot(right), b.dot(up), b.dot(d)], c: [c.dot(right), c.dot(up), c.dot(d)], rgb });
      base.push(t(P(gx, gz), P(gx + 2, gz), P(gx + 2, gz + 2)), t(P(gx, gz), P(gx + 2, gz + 2), P(gx, gz + 2)));
    }
  }
  const h = it.half;
  const line = (x0, z0, x1, z1) => {
    const w = 0.07;
    const horiz = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const P = (x, zz) => new THREE.Vector3(x, 0.0, zz);
    const n = new THREE.Vector3(0, 1, 0);
    const rgb = [220, 70, 60];
    const a = horiz ? [P(x0, z0 - w), P(x1, z0 - w), P(x1, z0 + w), P(x0, z0 + w)] : [P(x0 - w, z0), P(x0 + w, z0), P(x0 + w, z1), P(x0 - w, z1)];
    const t = (p, q, r) => ({ a: [p.dot(right), p.dot(up), p.dot(d)], b: [q.dot(right), q.dot(up), q.dot(d)], c: [r.dot(right), r.dot(up), r.dot(d)], rgb });
    base.push(t(a[0], a[1], a[2]), t(a[0], a[2], a[3]));
    void n;
  };
  line(-h, -h, h, -h);
  line(-h, h, h, h);
  line(-h, -h, -h, h);
  line(h, -h, h, h);
  // Fondo (cielo suave) y la escena.
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const o = ((cy0 + y) * W + cx0 + x) * 3;
      const t = y / cell;
      img[o] = 196 - 30 * t;
      img[o + 1] = 214 - 24 * t;
      img[o + 2] = 232 - 10 * t;
    }
  }
  renderScene([...base, ...tris], cell, cx0, cy0, img, W);
  void ground;
}

// ---- Etiquetas (fuente de 5x7 mínima) ---------------------------------------------------------------------------------------------
const FONT = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000', G: '01110100011000010111100011000101110', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000110001001110', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001110011010110011100011000110001', O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001', S: '01111100000100000111000001000011110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100', W: '10001100011000110101101011101110001', X: '10001010100010000100010101000110001',
  Y: '10001010100010000100001000010000100', Z: '11111000010001000100010001000011111',
  0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110', 2: '01110100010000100010001000100011111', 3: '11110000010000101110000010000111110',
  4: '00010001100101011111000100001000010', 5: '11111100001111000001000001000111110', 6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000',
  8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100', ':': '00000001000010000000001000010000000', '(': '00010001000100001000010000010000010',
  ')': '01000001000001000010000100010001000', '-': '00000000000000011111000000000000000', '_': '00000000000000000000000000000011111', ' ': '00000000000000000000000000000000',
};
function text(img, W, x0, y0, str, rgb = [20, 20, 30]) {
  let x = x0;
  for (const ch of str.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (glyph[r * 5 + c] === '1') {
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const o = ((y0 + r * 2 + dy) * W + x + c * 2 + dx) * 3;
            img[o] = rgb[0];
            img[o + 1] = rgb[1];
            img[o + 2] = rgb[2];
          }
        }
      }
    }
    x += 12;
  }
}

// ---- PNG -------------------------------------------------------------------------------------------------------------------------------
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(W, H, rgb) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(rgb[y * W * 3 + x])));
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const rows = Math.ceil(items.length / COLS);
const W = Math.min(COLS, items.length) * SIZE;
const LABEL = 30;
const H = rows * (SIZE + LABEL);
const img = new Float32Array(W * H * 3).fill(240);
items.forEach((it, i) => {
  const cx0 = (i % COLS) * SIZE;
  const cy0 = Math.floor(i / COLS) * (SIZE + LABEL);
  drawItem(it, SIZE, cx0, cy0 + LABEL, img, W);
  text(img, W, cx0 + 8, cy0 + 8, it.label.slice(0, Math.floor((SIZE - 16) / 12)));
});
fs.writeFileSync(OUT, png(W, H, img));
console.log(`${items.length} modelos -> ${OUT} (${W}x${H})`);
