// El centro del asentamiento evoluciona solo con la edad: senderos, plaza y calles (marcas
// planas en el suelo, que no estorban a nadie) y algunos objetos (fuente, pozo, farolas...)
// que ocupan un sitio fijo. Datos puros: los usa la vista (center.js) y la simulación, que
// registra los objetos como obstáculos para que nadie camine ni construya encima. Un objeto
// cuyo sitio ya ocupa un edificio se omite, de modo que la evolución nunca solapa nada.
// Coordenadas locales del campamento, en metros, con la fogata en el origen.

import { TIPIS, polar } from './campLayout.js';

const R19 = 19;
const at = (angle, dist) => ({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist });

// Marcas en el suelo por edad (se acumulan: cada edad cambia el pavimento y suma lo suyo).
//   disc: { r, color }  ·  ring: { r0, r1, color }  ·  path: { from, to, w, color }
export function centerDecals(age) {
  const out = [];
  const tipiPaths = (w, color, stones) => {
    for (const t of TIPIS) {
      const [x, z] = polar(t);
      const d = Math.hypot(x, z);
      out.push({ kind: stones ? 'stones' : 'path', from: { x: (x / d) * 3.2, z: (z / d) * 3.2 }, to: { x: (x / d) * (d - t.size * 3.6 - 0.8), z: (z / d) * (d - t.size * 3.6 - 0.8) }, w, color });
    }
  };
  if (age >= 2 && age < 3) tipiPaths(0.7, '#9a948a', true);
  if (age >= 3) out.push({ kind: 'disc', r: 6.2 + (age >= 5 ? 1.4 : 0) + (age >= 6 ? 1.8 : 0), color: age >= 8 ? '#6b6b70' : age >= 5 ? '#b8ad98' : '#c4a074' });
  if (age >= 3 && age < 8) tipiPaths(age >= 5 ? 1.6 : 1.1, age >= 5 ? '#b8ad98' : '#c4a074', false);
  if (age >= 5) out.push({ kind: 'ring', r0: 5.6, r1: 6.1, color: '#e8dcc0' });
  if (age >= 6) {
    // Calles diferenciadas hacia los cuatro lados.
    for (let i = 0; i < 4; i++) out.push({ kind: 'path', from: at(0.7 + (i * Math.PI) / 2, 8), to: at(0.7 + (i * Math.PI) / 2, 28), w: age >= 9 ? 3.6 : 2.6, color: age >= 9 ? '#4a4a50' : age >= 8 ? '#5a5a60' : '#a89a82' });
  }
  if (age >= 8) out.push({ kind: 'ring', r0: 9.0, r1: 9.3, color: '#d9d4c4' });
  if (age >= 9) for (let i = 0; i < 4; i++) out.push({ kind: 'path', from: at(0.7 + (i * Math.PI) / 2, 8), to: at(0.7 + (i * Math.PI) / 2, 28), w: 0.14, color: '#e8e0b0' }); // línea de la calzada
  if (age >= 10) out.push({ kind: 'disc', r: 4.6, color: '#7fb08a' });
  return out;
}

// Objetos con sitio fijo: { id, kind, x, z, r, age }. "age" es la edad desde la que existen.
// Todos fuera del anillo de tiendas (que llega a ~17,6 m), alrededor de la plaza.
const PROPS = [
  { id: 'pots', kind: 'pots', ...at(0.9, 20.5), r: 0.7, age: 3 },
  { id: 'wellstone', kind: 'wellstone', ...at(2.55, 21), r: 1.2, age: 4 },
  { id: 'fountain', kind: 'fountain', ...at(4.15, 21.5), r: 1.6, age: 5 },
  { id: 'banner1', kind: 'banner', ...at(5.55, 21), r: 0.5, age: 6 },
  { id: 'banner2', kind: 'banner', ...at(1.55, 21), r: 0.5, age: 6 },
  ...[0.55, 2.1, 3.7, 5.3].map((a, i) => ({ id: `lamp${i}`, kind: 'lamp', ...at(a, 22.5), r: 0.4, age: 7 })),
  ...[1.3, 2.9, 4.5, 6.1].map((a, i) => ({ id: `lampb${i}`, kind: 'lamp', ...at(a, 22.5), r: 0.4, age: 8 })),
  ...[0.2, 1.8, 3.4, 5.0].map((a, i) => ({ id: `bench${i}`, kind: 'bench', ...at(a, 24), r: 0.9, age: 9 })),
  ...[1.0, 2.6, 4.2, 5.8].map((a, i) => ({ id: `planter${i}`, kind: 'planter', ...at(a, 24), r: 0.7, age: 10 })),
];

// Los objetos que existen en una edad y no chocan con un edificio ("buildings": { x, z, r }[]).
export function centerProps(age, buildings = []) {
  return PROPS.filter((p) => p.age <= age && !buildings.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < b.r + p.r + 0.5));
}
