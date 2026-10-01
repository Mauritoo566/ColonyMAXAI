import * as THREE from 'three';
import { Parts, mat, stick, v } from './modelKit.js';
import { BUILDINGS } from './sim/buildingTypes.js';
import { generate } from './buildingModelsGen.js';

// Modelos 3D de los edificios (metros, suelo en y = 0). Cada nivel de sim/buildingTypes.js
// nombra su modelo con un texto; aquí está el dibujo de cada uno.
function prism(radius, length) {
  // Prisma triangular con una arista arriba (para tejados a dos aguas).
  const g = new THREE.CylinderGeometry(radius, radius, length, 3);
  g.rotateZ(Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

function gathererModel2(p) {
  p.add(new THREE.CylinderGeometry(2.2, 2.4, 1.8, 9), '#9a7148', mat(0, 0.9, 0));
  p.add(new THREE.CylinderGeometry(2.55, 2.75, 0.25, 9), '#a8843e', mat(0, 1.95, 0));
  p.add(new THREE.ConeGeometry(2.9, 2.3, 9), '#c9a45a', mat(0, 3.1, 0));
  p.add(new THREE.BoxGeometry(0.9, 1.4, 0.12), '#3a2618', mat(0, 0.7, 2.3));
  for (const [x, z] of [[1.9, 1.9], [-2.1, 1.5], [2.4, -0.6]]) {
    p.add(new THREE.CylinderGeometry(0.45, 0.38, 0.5, 8), '#c49a5a', mat(x, 0.25, z));
    for (let k = 0; k < 4; k++) {
      p.add(new THREE.IcosahedronGeometry(0.13, 0), k % 2 ? '#b8283a' : '#7a2a6a', mat(x + (k - 1.5) * 0.14, 0.55, z + ((k * 7) % 3 - 1) * 0.12));
    }
  }
}

function woodcutterModel2(p) {
  p.add(new THREE.BoxGeometry(3.6, 0.35, 3), '#6b4a2e', mat(0, 0.17, 0));
  p.add(new THREE.BoxGeometry(3.4, 1.8, 2.8), '#8a5a34', mat(0, 1.2, 0));
  p.add(prism(1.7, 3.5), '#8a5a34', mat(0, 2.95, 0));
  p.add(new THREE.BoxGeometry(3.9, 0.16, 2.1), '#5a3a22', mat(0, 3.05, 0.78, 0.62, 0, 0));
  p.add(new THREE.BoxGeometry(3.9, 0.16, 2.1), '#5a3a22', mat(0, 3.05, -0.78, -0.62, 0, 0));
  p.add(new THREE.BoxGeometry(0.9, 1.5, 0.12), '#3a2618', mat(0.6, 1.05, 1.42));
  // Troncos apilados a un lado.
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - row; i++) {
      const y = 0.3 + row * 0.5;
      const z = (i - (2 - row) / 2) * 0.55;
      stick(p, v(2.3, y, z - 0.4), v(4.1, y, z - 0.4), 0.26, row % 2 ? '#7a5230' : '#6b4a2e', 6);
    }
  }
  p.add(new THREE.CylinderGeometry(0.5, 0.58, 0.7, 7), '#6b4a2e', mat(-2.6, 0.35, 1.4));
  stick(p, v(-2.6, 0.7, 1.4), v(-2.9, 1.5, 1.3), 0.045, '#9a7446', 4);
  p.add(new THREE.BoxGeometry(0.4, 0.22, 0.05), '#6d6d70', mat(-2.55, 0.78, 1.42, 0, 0, -0.3));
}

function quarryModel2(p) {
  // Bloques de piedra cortados.
  const blocks = [
    [-1.6, 0.35, 1.2, 1.3, 0.7, 0.9, '#8f8a82'],
    [-0.3, 0.35, 1.5, 1.1, 0.7, 0.8, '#7d786f'],
    [-1.0, 1.0, 1.3, 1.0, 0.6, 0.8, '#9a958c'],
    [1.5, 0.3, -1.4, 1.4, 0.6, 1.1, '#857f76'],
    [0.6, 0.25, -1.9, 0.9, 0.5, 0.7, '#938e85'],
  ];
  for (const [x, y, z, w, h, d, c] of blocks) p.add(new THREE.BoxGeometry(w, h, d), c, mat(x, y, z, 0, x * 0.3, 0));
  // Grúa de madera en forma de A con una polea.
  stick(p, v(-1.2, 0, -0.4), v(0.2, 3.6, -0.4), 0.1, '#6b4a2e', 5);
  stick(p, v(1.6, 0, -0.4), v(0.2, 3.6, -0.4), 0.1, '#6b4a2e', 5);
  stick(p, v(0.2, 3.5, -0.4), v(2.6, 3.9, -0.4), 0.08, '#7a5230', 5);
  stick(p, v(2.5, 3.85, -0.4), v(2.5, 1.6, -0.4), 0.02, '#c8b48a', 3);
  p.add(new THREE.BoxGeometry(0.7, 0.5, 0.6), '#8f8a82', mat(2.5, 1.35, -0.4));
  // Cobertizo con herramientas.
  stick(p, v(1.9, 0, 1.2), v(1.9, 2, 1.2), 0.08, '#6b4a2e', 4);
  stick(p, v(3.1, 0, 1.2), v(3.1, 1.6, 1.2), 0.08, '#6b4a2e', 4);
  stick(p, v(1.9, 0, 2.4), v(1.9, 2, 2.4), 0.08, '#6b4a2e', 4);
  stick(p, v(3.1, 0, 2.4), v(3.1, 1.6, 2.4), 0.08, '#6b4a2e', 4);
  p.add(new THREE.BoxGeometry(1.6, 0.1, 1.6), '#5a3a22', mat(2.5, 1.85, 1.8, 0, 0, -0.3));
  stick(p, v(2.2, 0, 1.6), v(2.4, 1.2, 1.9), 0.035, '#9a7446', 4);
  p.add(new THREE.BoxGeometry(0.5, 0.12, 0.08), '#6d6d70', mat(2.42, 1.22, 1.93, 0, 0, 0.4));
}

// Pozo simple (Edad de Piedra): anillo de piedras sueltas, travesaño y cubo de cuero.
function wellModel2(p) {
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2;
    p.add(new THREE.DodecahedronGeometry(0.34, 0), k % 2 ? '#8b877f' : '#9a958c', mat(Math.cos(a) * 1.05, 0.3, Math.sin(a) * 1.05, a, a * 2, 0, 1, 0.8, 1));
    p.add(new THREE.DodecahedronGeometry(0.28, 0), k % 3 ? '#7d786f' : '#938e85', mat(Math.cos(a + 0.3) * 1.0, 0.72, Math.sin(a + 0.3) * 1.0, a, a, 0));
  }
  p.add(new THREE.CircleGeometry(0.8, 10), '#1f3a55', mat(0, 0.55, 0, -Math.PI / 2));
  // Horquetas y travesaño.
  stick(p, v(-1.35, 0, 0), v(-1.3, 2.1, 0), 0.08, '#6b4a2e', 5);
  stick(p, v(1.35, 0, 0), v(1.3, 2.1, 0), 0.08, '#6b4a2e', 5);
  stick(p, v(-1.3, 2.1, 0), v(-1.45, 2.4, 0.1), 0.05, '#6b4a2e', 4);
  stick(p, v(1.3, 2.1, 0), v(1.45, 2.4, 0.1), 0.05, '#6b4a2e', 4);
  stick(p, v(-1.55, 2.12, 0), v(1.55, 2.12, 0), 0.06, '#7a5230', 5);
  stick(p, v(0.1, 2.08, 0), v(0.1, 1.2, 0), 0.015, '#c8b48a', 3);
  p.add(new THREE.CylinderGeometry(0.22, 0.16, 0.32, 7), '#8a5a3a', mat(0.1, 1.05, 0));
}

// ---- Nivel 1: Edad Primitiva ------------------------------------------------

// Enramada: cuatro palos, un techo inclinado de ramas con hojas y cestas de fibra.
function gathererModel1(p) {
  const posts = [[-1.6, -1.3, 2.3], [1.6, -1.3, 2.3], [-1.6, 1.3, 1.5], [1.6, 1.3, 1.5]];
  for (const [x, z, h] of posts) stick(p, v(x, 0, z), v(x * 1.02, h, z), 0.07, '#6b4a2e', 5);
  stick(p, v(-1.8, 2.3, -1.3), v(1.8, 2.3, -1.3), 0.06, '#7a5230', 4);
  stick(p, v(-1.8, 1.5, 1.3), v(1.8, 1.5, 1.3), 0.06, '#7a5230', 4);
  // Ramas del techo y hojas encima.
  for (let k = 0; k < 7; k++) {
    const x = -1.6 + k * 0.53;
    stick(p, v(x, 2.36, -1.6), v(x + 0.1, 1.52, 1.6), 0.035, '#5a3a22', 3);
  }
  for (let k = 0; k < 9; k++) {
    const x = -1.6 + (k % 3) * 1.6;
    const z = -1.1 + Math.floor(k / 3) * 1.1;
    const y = 2.3 - ((z + 1.3) / 2.6) * 0.8 + 0.12;
    p.add(new THREE.IcosahedronGeometry(0.62, 0), k % 2 ? '#5f7f35' : '#6f8f3c', mat(x, y, z, k, k * 2, 0, 1.2, 0.35, 1));
  }
  // Cestas con bayas y un montón de hierbas secas.
  for (const [x, z] of [[-0.8, -0.3], [0.5, 0.2], [2.3, 1.6]]) {
    p.add(new THREE.CylinderGeometry(0.36, 0.28, 0.42, 7), '#b89a5e', mat(x, 0.21, z));
    for (let k = 0; k < 4; k++) {
      p.add(new THREE.IcosahedronGeometry(0.11, 0), k % 2 ? '#b8283a' : '#7a2a6a', mat(x + (k - 1.5) * 0.12, 0.46, z + ((k * 7) % 3 - 1) * 0.1));
    }
  }
  for (let k = 0; k < 6; k++) stick(p, v(-2.4 + k * 0.08, 0, 1.2), v(-2.1 + k * 0.1, 0.9, 1.5 - k * 0.05), 0.03, '#c9b36a', 3);
}

// Zona de tala: un tocón con un hacha de piedra clavada, troncos y astillas.
function woodcutterModel1(p) {
  p.add(new THREE.CylinderGeometry(0.55, 0.7, 0.75, 8), '#6b4a2e', mat(0, 0.37, 0));
  p.add(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 8), '#c9a26a', mat(0, 0.76, 0));
  stick(p, v(0.05, 0.75, 0), v(0.55, 1.45, 0.1), 0.045, '#9a7446', 4);
  p.add(new THREE.DodecahedronGeometry(0.16, 0), '#6d6a64', mat(0.12, 0.84, 0.02, 0, 0, 0, 1.4, 0.7, 0.6));
  for (const [x, z, a] of [[1.6, -0.6, 0.2], [1.7, 0.1, 0.1], [1.65, -0.25, 0.15]]) {
    stick(p, v(x - 1.2, 0.25, z + a), v(x + 1.2, 0.25, z - a), 0.24, '#7a5230', 6);
  }
  stick(p, v(0.5, 0.72, -0.25), v(2.8, 0.72, -0.4), 0.22, '#6b4a2e', 6);
  for (let k = 0; k < 10; k++) {
    const a = k * 2.4;
    p.add(new THREE.BoxGeometry(0.18, 0.04, 0.08), '#c9a26a', mat(Math.cos(a) * (0.9 + (k % 3) * 0.3), 0.02, Math.sin(a) * (0.9 + (k % 3) * 0.3), 0, a, 0));
  }
  // Un pequeño cobertizo de ramas para las herramientas.
  stick(p, v(-1.6, 0, -1.2), v(-1.2, 1.5, -0.6), 0.05, '#5a3a22', 4);
  stick(p, v(-2.2, 0, -0.2), v(-1.2, 1.5, -0.6), 0.05, '#5a3a22', 4);
  stick(p, v(-1.8, 0, 0.6), v(-1.2, 1.5, -0.6), 0.05, '#5a3a22', 4);
}

// Pedrera: piedras sin labrar amontonadas, un percutor y una piel para sentarse.
function quarryModel1(p) {
  const rocks = [
    [-1.0, 0.35, 0.6, 0.6, '#8f8a82'], [-0.2, 0.3, 1.1, 0.5, '#7d786f'], [-0.6, 0.75, 0.9, 0.45, '#9a958c'],
    [0.9, 0.3, -0.9, 0.55, '#857f76'], [1.5, 0.25, -0.2, 0.4, '#938e85'], [0.4, 0.22, -1.5, 0.35, '#8b877f'],
    [-1.6, 0.2, -0.6, 0.35, '#7d786f'], [1.2, 0.62, -0.6, 0.35, '#9a958c'],
  ];
  for (const [x, y, z, r, c] of rocks) p.add(new THREE.DodecahedronGeometry(r, 0), c, mat(x, y, z, x, z, 0, 1, 0.75, 1));
  p.add(new THREE.CylinderGeometry(0.9, 0.9, 0.03, 7), '#a0764a', mat(0.4, 0.02, 0.6, 0, 0.5, 0));
  p.add(new THREE.DodecahedronGeometry(0.14, 0), '#5f5b55', mat(0.6, 0.12, 0.3));
  // Lascas de piedra.
  for (let k = 0; k < 8; k++) {
    const a = k * 2.1;
    p.add(new THREE.TetrahedronGeometry(0.1, 0), '#a8a39a', mat(0.4 + Math.cos(a) * 0.6, 0.05, 0.6 + Math.sin(a) * 0.6, a, a, 0));
  }
}

// Recolector de lluvia: cuatro palos con una piel tensada que desagua en vasijas.
function wellModel1(p) {
  const posts = [[-1.2, -1.0, 1.8], [1.2, -1.0, 1.8], [-1.2, 1.0, 1.4], [1.2, 1.0, 1.4]];
  for (const [x, z, h] of posts) stick(p, v(x, 0, z), v(x, h, z), 0.06, '#6b4a2e', 5);
  // La piel: un cono muy plano invertido (se hunde en el centro).
  p.add(new THREE.ConeGeometry(1.55, 0.45, 8, 1, true), '#a0764a', mat(0, 1.45, 0, Math.PI, Math.PI / 8, 0, 1, 1, 0.8));
  for (const [x, z, h] of posts) stick(p, v(x, h, z), v(x * 0.2, 1.3, z * 0.2), 0.012, '#c8b48a', 3);
  // Vasijas de barro debajo.
  p.add(new THREE.CylinderGeometry(0.3, 0.22, 0.55, 8), '#a8583a', mat(0, 0.27, 0));
  p.add(new THREE.CylinderGeometry(0.18, 0.3, 0.12, 8), '#a8583a', mat(0, 0.6, 0));
  p.add(new THREE.CircleGeometry(0.17, 8), '#2a4a66', mat(0, 0.665, 0, -Math.PI / 2));
  p.add(new THREE.CylinderGeometry(0.24, 0.18, 0.42, 8), '#b8683a', mat(0.7, 0.21, 0.5));
  p.add(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 8), '#98482a', mat(-0.65, 0.17, 0.55));
}

// Pila de troncos y cestas (almacén primitivo).
function stockpileModel1(p) {
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const y = 0.26 + row * 0.44;
      const z = -1.2 + (i - (3 - row) / 2) * 0.48;
      stick(p, v(-1.9, y, z), v(0.2, y, z), 0.23, (i + row) % 2 ? '#7a5230' : '#6b4a2e', 6);
    }
  }
  for (const [x, z, s] of [[1.1, -0.9, 1], [1.7, -0.2, 0.85], [1.0, 0.5, 0.9], [-0.6, 0.9, 1.05]]) {
    p.add(new THREE.CylinderGeometry(0.42 * s, 0.34 * s, 0.6 * s, 8), '#b89a5e', mat(x, 0.3 * s, z));
    p.add(new THREE.CylinderGeometry(0.43 * s, 0.43 * s, 0.05, 8), '#8f7442', mat(x, 0.6 * s, z));
  }
  p.add(new THREE.IcosahedronGeometry(0.3, 0), '#b8283a', mat(1.1, 0.68, -0.9, 0, 0, 0, 1, 0.5, 1));
  p.add(new THREE.DodecahedronGeometry(0.3, 0), '#8f8a82', mat(1.7, 0.6, -0.2, 0, 0, 0, 1, 0.5, 1));
  // Piedras amontonadas y una piel encima de la leña.
  for (let k = 0; k < 6; k++) p.add(new THREE.DodecahedronGeometry(0.26, 0), k % 2 ? '#8f8a82' : '#7d786f', mat(-1.6 + (k % 3) * 0.45, 0.2 + Math.floor(k / 3) * 0.3, 1.2, k, k, 0));
  p.add(new THREE.BoxGeometry(1.6, 0.05, 1.3), '#a0764a', mat(-0.8, 1.42, -1.2, 0.1, 0, 0.06));
  stick(p, v(-1.4, 0, 0.2), v(-1.3, 1.2, 0.1), 0.05, '#5a3a22', 4);
}

// Granero: choza sobre pilotes con techo de paja y escalera.
function stockpileModel2(p) {
  for (const [x, z] of [[-1.3, -1.1], [1.3, -1.1], [-1.3, 1.1], [1.3, 1.1]]) {
    stick(p, v(x, 0, z), v(x, 0.9, z), 0.1, '#5a3a22', 5);
    p.add(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 8), '#8f8a82', mat(x, 0.92, z));
  }
  p.add(new THREE.BoxGeometry(3.1, 0.15, 2.7), '#6b4a2e', mat(0, 1.0, 0));
  p.add(new THREE.CylinderGeometry(1.35, 1.35, 1.5, 10), '#a07a4a', mat(0, 1.8, 0));
  p.add(new THREE.ConeGeometry(1.9, 1.7, 10), '#c9a45a', mat(0, 3.35, 0));
  p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 6), '#a8843e', mat(0, 4.25, 0));
  p.add(new THREE.BoxGeometry(0.7, 1.0, 0.1), '#3a2618', mat(0, 1.6, 1.33));
  stick(p, v(-0.3, 0, 2.3), v(-0.3, 1.05, 1.4), 0.04, '#7a5230', 4);
  stick(p, v(0.3, 0, 2.3), v(0.3, 1.05, 1.4), 0.04, '#7a5230', 4);
  for (let k = 1; k < 4; k++) stick(p, v(-0.3, k * 0.26, 2.3 - k * 0.22), v(0.3, k * 0.26, 2.3 - k * 0.22), 0.03, '#7a5230', 3);
  for (const [x, z] of [[2.0, 0.6], [2.2, -0.4]]) p.add(new THREE.CylinderGeometry(0.34, 0.28, 0.5, 8), '#b89a5e', mat(x, 0.25, z));
}

// Choza de ramas: armazón cónico de palos cubierto de pieles y hojas, con la entrada al frente.
function houseModel1(p) {
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    stick(p, v(Math.cos(a) * 2.0, 0, Math.sin(a) * 2.0), v(Math.cos(a) * 0.12, 3.7, Math.sin(a) * 0.12), 0.07, '#6b4a2e', 4);
  }
  p.add(new THREE.ConeGeometry(2.1, 3.0, 9, 1, true), '#8a6a3c', mat(0, 1.6, 0));
  p.add(new THREE.ConeGeometry(2.15, 1.2, 9, 1, true), '#5f7a3a', mat(0, 3.0, 0));
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3;
    p.add(new THREE.BoxGeometry(0.9, 0.05, 0.5), k % 2 ? '#a0764a' : '#7a5230', mat(Math.cos(a) * 1.4, 1.2 + (k % 3) * 0.55, Math.sin(a) * 1.4, 0.3, -a, 0.5));
  }
  p.add(new THREE.BoxGeometry(0.9, 1.5, 0.12), '#2a1c10', mat(0, 0.75, 1.85));
  for (const x of [-0.7, 0.7]) stick(p, v(x, 0, 1.95), v(x * 0.9, 1.6, 1.8), 0.06, '#5a3a22', 4);
  p.add(new THREE.DodecahedronGeometry(0.28, 0), '#8f8a82', mat(1.6, 0.2, 1.8));
  p.add(new THREE.DodecahedronGeometry(0.22, 0), '#7d786f', mat(-1.7, 0.15, 1.6));
}

// Casa de barro: paredes redondas de barro, techo de paja, puerta de tablas y una ventana.
function houseModel2(p) {
  p.add(new THREE.CylinderGeometry(2.05, 2.15, 0.25, 12), '#8f8a82', mat(0, 0.12, 0));
  p.add(new THREE.CylinderGeometry(1.8, 1.9, 2.2, 12), '#b78a5e', mat(0, 1.35, 0));
  for (let k = 0; k < 6; k++) {
    const y = 0.5 + k * 0.38;
    p.add(new THREE.TorusGeometry(1.85 - (k % 2) * 0.02, 0.05, 4, 16), '#9a7048', mat(0, y, 0, Math.PI / 2, 0, 0));
  }
  p.add(new THREE.ConeGeometry(2.6, 2.3, 12), '#c9a45a', mat(0, 3.75, 0));
  p.add(new THREE.ConeGeometry(2.3, 0.7, 12), '#b08c46', mat(0, 3.05, 0));
  p.add(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 6), '#a8843e', mat(0, 5.0, 0));
  p.add(new THREE.BoxGeometry(0.85, 1.5, 0.14), '#3a2618', mat(0, 1.0, 1.88));
  p.add(new THREE.BoxGeometry(0.4, 0.4, 0.12), '#1f1812', mat(1.15, 1.8, 1.35, 0, 0.7, 0));
  p.add(new THREE.CylinderGeometry(0.22, 0.2, 0.5, 8), '#a8583a', mat(-1.3, 0.37, 1.7));
  p.add(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 8), '#b8683a', mat(1.5, 0.32, 1.6));
}

// Andamio de obra: base de tablones y cuatro postes.
// Andamios de una obra o una mejora.
function frameModel(p, footprint) {
  const s = footprint * 1.6;
  p.add(new THREE.BoxGeometry(s, 0.15, s), '#8a643c', mat(0, 0.07, 0));
  const c = footprint * 0.75;
  for (const [x, z] of [[c, c], [-c, c], [c, -c], [-c, -c]]) stick(p, v(x, 0, z), v(x, 2.8, z), 0.09, '#a07a4a', 5);
  stick(p, v(-c, 2.6, c), v(c, 2.6, c), 0.06, '#a07a4a', 4);
  stick(p, v(-c, 2.6, -c), v(c, 2.6, -c), 0.06, '#a07a4a', 4);
}

export const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide });

export function buildMesh(fn, ...args) {
  const parts = new Parts();
  fn(parts, ...args);
  const mesh = parts.mesh(material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

const MODELS = { gathererModel2, woodcutterModel2, quarryModel2, wellModel2, gathererModel1, woodcutterModel1, quarryModel1, wellModel1, stockpileModel1, stockpileModel2, houseModel1, houseModel2 };

// Malla del modelo de un nivel (por su nombre en sim/buildingTypes.js).
export function levelModel(name) {
  if (name.startsWith('gen:')) return buildMesh((p) => generate(p, name));
  return buildMesh(MODELS[name]);
}

export function frameMesh(footprint) {
  return buildMesh(frameModel, footprint);
}

// Modelo de un edificio de otro jugador (mundo compartido): el del nivel que tenga o, si
// está en obra, sólo los andamios.
export function buildingModel(type, level = 1, done = true) {
  const def = BUILDINGS[type];
  if (!def) return null;
  const lv = def.levels[Math.min(def.levels.length, Math.max(1, level)) - 1];
  return done ? levelModel(lv.model) : frameMesh(def.footprint);
}
