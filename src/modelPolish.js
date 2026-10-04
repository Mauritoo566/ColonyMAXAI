// Pulido de los modelos de edificios: todos pasan por aquí antes de convertirse en malla. Quita el aspecto plano de los colores planos:
//  - cada pieza varía un poco su tono (no hay dos tablas idénticas) y el pie de los muros se oscurece (sombra del suelo, suciedad) mientras lo
//    alto se aclara un poco: los muros dejan de ser un bloque de un solo color;
//  - una "falda" de tierra pisada, con matas de hierba y piedrecitas, asienta el edificio en el terreno en vez de dejarlo posado sobre el césped.
// Es determinista: depende sólo de la geometría (mismo modelo, mismo resultado, para todos los jugadores). Sólo cambia colores y añade piezas
// bajas dentro del contorno que ya ocupa el modelo (no cambia su huella ni lo que sobresale de ella).
import * as THREE from 'three';
import { mat } from './modelKit.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Un número estable en [0, 1) a partir de tres coordenadas.
function hash3(x, y, z) {
  let h = 2166136261;
  for (const n of [Math.round(x * 20), Math.round(y * 20), Math.round(z * 20)]) {
    h ^= n & 0xffff;
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function rng(seed) {
  let s = Math.floor(seed * 4294967295) >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function polish(parts, { skirt = true } = {}) {
  if (!parts.list.length) return;
  const box = new THREE.Box3();
  for (const g of parts.list) {
    g.computeBoundingBox();
    box.union(g.boundingBox);
  }
  for (const g of parts.list) {
    const pos = g.attributes.position;
    const col = g.attributes.color;
    const n = pos.count;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += pos.getX(i);
      cy += pos.getY(i);
      cz += pos.getZ(i);
    }
    const jitter = 1 + (hash3(cx / n, cy / n, cz / n) - 0.5) * 0.1; // ±5 % por pieza
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i);
      const foot = 0.76 + 0.24 * smooth(0, 1.2, y); // el pie del muro, más oscuro
      const crown = 1 + 0.06 * smooth(2.4, 5.5, y); // lo alto, algo más claro
      const f = jitter * foot * crown;
      col.setXYZ(i, Math.min(1, col.getX(i) * f), Math.min(1, col.getY(i) * f), Math.min(1, col.getZ(i) * f));
    }
  }
  const sx = box.max.x - box.min.x;
  const sz = box.max.z - box.min.z;
  const sy = box.max.y - box.min.y;
  // La falda sólo es para edificios (no para antorchas, postes ni muros).
  if (!skirt || sx < 2.6 || sz < 2.2 || sy < 1.2) return;
  const rand = rng(hash3(sx, sy, sz));
  const cxm = (box.max.x + box.min.x) / 2;
  const czm = (box.max.z + box.min.z) / 2;
  const rx = sx / 2;
  const rz = sz / 2;
  // Tres manchas de tierra superpuestas, de tonos distintos y algo irregulares, dentro del contorno del modelo.
  const dirt = ['#7d6a48', '#6f5e3f', '#86744f'];
  dirt.forEach((color, k) => {
    const s = 1 - k * 0.07;
    const g = new THREE.CylinderGeometry(1, 1, 0.05, 14);
    parts.add(g, color, mat(cxm + (rand() - 0.5) * 0.3, 0.03 + k * 0.006, czm + (rand() - 0.5) * 0.3, 0, rand() * Math.PI, 0, rx * s * 0.98, 1, rz * s * 0.98));
  });
  // Matas de hierba y piedrecitas por el borde de la mancha.
  const tufts = Math.min(14, 6 + Math.round((rx + rz) * 1.4));
  for (let i = 0; i < tufts; i++) {
    const a = (i / tufts) * Math.PI * 2 + rand() * 0.5;
    const k = 0.78 + rand() * 0.2;
    const x = cxm + Math.cos(a) * rx * k;
    const z = czm + Math.sin(a) * rz * k;
    if (rand() < 0.62) {
      const h = 0.22 + rand() * 0.22;
      parts.add(new THREE.ConeGeometry(0.1 + rand() * 0.06, h, 5), rand() < 0.5 ? '#5a8a38' : '#6f9a44', mat(x, 0.05 + h / 2, z));
      parts.add(new THREE.ConeGeometry(0.07, h * 0.8, 5), '#4e7a30', mat(x + 0.1, 0.05 + h * 0.4, z + 0.06, 0, 0, 0.3));
    } else {
      const r = 0.09 + rand() * 0.09;
      parts.add(new THREE.DodecahedronGeometry(r, 0), rand() < 0.5 ? '#8a867e' : '#767268', mat(x, 0.05 + r * 0.5, z, rand() * 3, rand() * 3, 0, 1, 0.7, 1));
    }
  }
}
