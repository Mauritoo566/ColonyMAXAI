// Dibuja la ropa de las diez edades (y sin ropa) en una hoja PNG con un rasterizador por software, sin navegador: sirve para ver cómo queda cada silueta.
// Uso: node tools/render-outfits.mjs hoja.png [giro_en_grados]
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { createPersonModel, dressModel } from '../src/colonists.js';
import { outfitFor } from '../src/outfits.js';
const args = process.argv.slice(2);
const OUT = args[0] ?? 'ropa.png';
const SIZE = 300;
const YAW = (Number(args[1] ?? 28) * Math.PI) / 180;
const PITCH = (14 * Math.PI) / 180;
const SCALE = 2.3;
const d = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH)).normalize();
const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize();
const up = new THREE.Vector3().crossVectors(d, right).normalize();
const LIGHT = new THREE.Vector3(0.45, 0.85, 0.55).normalize();
const toSRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function renderScene(tris, cell, cx0, cy0, img, W) {
  const z = new Float32Array(cell * cell).fill(-1e9);
  const px = cell / SCALE;
  const proj = (p) => [cell / 2 + p[0] * px, cell * 0.93 - p[1] * px, p[2]];
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


function personTris(object) {
  const out = [];
  object.updateMatrixWorld(true);
  object.traverse((o) => {
    if (!o.isMesh) return;
    if (o.parent && o.parent === object.userData.proxy) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const color = o.material.color;
    const rgb = [color.r, color.g, color.b].map((c) => toSRGB(c) * 255);
    const v = (i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = idx ? idx.getX(i) : i;
      const ib = idx ? idx.getX(i + 1) : i + 1;
      const ic = idx ? idx.getX(i + 2) : i + 2;
      const a = v(ia);
      const b = v(ib);
      const c = v(ic);
      const nn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (nn.lengthSq() < 1e-12) continue;
      nn.normalize();
      if (nn.dot(d) < 0) nn.negate();
      const k = 0.45 + 0.7 * Math.max(0, nn.dot(LIGHT));
      out.push({ a: [a.dot(right), a.dot(up), a.dot(d)], b: [b.dot(right), b.dot(up), b.dot(d)], c: [c.dot(right), c.dot(up), c.dot(d)], rgb: rgb.map((x) => Math.min(255, x * k)) });
    }
  });
  return out;
}
const look = { shirt: '#9a8a6a', pants: '#5a4a3a', skin: '#d9a77a', hair: '#3a2a1a', longHair: false, height: 1 };
const NAMES = ['sin ropa', 'I pieles', 'II cuero', 'III lino', 'IV lana', 'V tunica', 'VI jubon', 'VII corte', 'VIII mono', 'IX moderna', 'X tecnica'];
const COLS = 6;
const items = NAMES.map((label, tier) => {
  const m = createPersonModel(look);
  dressModel(m, look, tier > 0, tier > 0 ? outfitFor(tier, { soldier: null, job: null }) : null);
  return { label, tris: personTris(m) };
});
const W = COLS * SIZE;
const LABEL = 30;
const rows = Math.ceil(items.length / COLS);
const H = rows * (SIZE + LABEL);
const img = new Float32Array(W * H * 3).fill(240);
items.forEach((it, i) => {
  const cx0 = (i % COLS) * SIZE;
  const cy0 = Math.floor(i / COLS) * (SIZE + LABEL) + LABEL;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = ((cy0 + y) * W + cx0 + x) * 3;
      const t = y / SIZE;
      img[o] = 196 - 30 * t;
      img[o + 1] = 214 - 24 * t;
      img[o + 2] = 232 - 10 * t;
    }
  }
  const P = (x, z) => new THREE.Vector3(x, 0, z);
  const t3 = (p, q, r) => ({ a: [p.dot(right), p.dot(up), p.dot(d)], b: [q.dot(right), q.dot(up), q.dot(d)], c: [r.dot(right), r.dot(up), r.dot(d)], rgb: [92, 126, 70] });
  const ground = [t3(P(-3, -3), P(3, -3), P(3, 3)), t3(P(-3, -3), P(3, 3), P(-3, 3))];
  renderScene([...ground, ...it.tris], SIZE, cx0, cy0, img, W);
  text(img, W, cx0 + 8, cy0 - LABEL + 8, it.label);
});

fs.writeFileSync(OUT, png(W, H, img));
console.log('ok', OUT);
