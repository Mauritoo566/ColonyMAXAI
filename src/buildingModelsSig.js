// Lo que hace reconocible a cada edificio: además de la forma de su estilo (buildingModelsGen.js), cada tipo lleva
// sus propias piezas (un horno de pan no se parece a una alfarería ni a una carbonera). Todo cabe dentro de la
// huella del edificio y deja libre el frente, donde está la puerta (+z) y su franja de acceso.
import { BUILDINGS } from './sim/buildingTypes.js';
import { PLOT_COLS, PLOT_ROWS, NICHE_COLS, NICHE_ROWS, plotLocal, nicheLocal } from './sim/cemetery.js';
import {
  THREE, mat, stick, v, box, cyl, cone, dome, rock, gable, door, window_, chimney, pot, sack, barrel, crate, logs, sign, flagPole,
  pal, flag, pick, DARK, GLASS,
} from './modelParts.js';

const BRICK = '#b85a3e';
const IRON = '#4a4a52';
const STEEL = '#b4bcc4';

// Un banco de trabajo con patas.
function bench(p, x, z, w = 1.3, d = 0.6, h = 0.8, top = '#8a643c') {
  box(p, w, 0.1, d, top, x, h, z);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) stick(p, v(x + (dx * (w - 0.15)) / 2, 0, z + (dz * (d - 0.15)) / 2), v(x + (dx * (w - 0.15)) / 2, h, z + (dz * (d - 0.15)) / 2), 0.04, '#5a3a22', 4);
}

// Una rueda (disco con radios) en el plano x-y, centrada en (x, y, z).
function wheel(p, x, y, z, r, color = '#6b4a2e', spokes = 6) {
  p.add(new THREE.TorusGeometry(r, r * 0.09, 4, 14), color, mat(x, y, z));
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI;
    box(p, r * 2, r * 0.08, r * 0.08, color, x, y, z, 0, 0, a);
  }
}

// Un caballete de barras con una cuerda (A) para grúas y sierras.
function aFrame(p, x, z, h, color = '#6b4a2e', w = 1.3) {
  stick(p, v(x - w / 2, 0, z), v(x, h, z), 0.08, color, 5);
  stick(p, v(x + w / 2, 0, z), v(x, h, z), 0.08, color, 5);
}

// ---- Minas y canteras -----------------------------------------------------------------------------------

// Cada mena tiene su roca, sus manchas y su mineral.
export const MINE_LOOK = {
  copper_mine: { rock: '#7a6a5a', stain: '#4fa88a', ore: '#c8743c', ingot: '#c8743c' },
  tin_mine: { rock: '#8a8f93', stain: '#d6dde0', ore: '#a8b4bc', ingot: '#c8d0d6' },
  iron_mine: { rock: '#6a4a3a', stain: '#9a3f2a', ore: '#8a5a4a', ingot: '#7a8088' },
  coal_mine: { rock: '#3a3a3e', stain: '#1e1e22', ore: '#1e1e22', ingot: '#1e1e22' },
};

// Cantera a cielo abierto: terrazas talladas, bloques apilados, grúa de madera y carretilla.
export function quarryPit(p, tier) {
  const c = pal(Math.min(tier, 6));
  const stone = tier >= 8 ? '#7d7d82' : '#a8a39a';
  const dark = tier >= 8 ? '#6a6a70' : '#8f8a82';
  box(p, 4.4, 0.6, 1.9, dark, 0, 0.3, -1.4);
  box(p, 3.6, 1.2, 1.7, stone, 0, 0.6, -1.7);
  box(p, 2.6, 1.9, 1.5, dark, 0, 0.95, -2.0);
  for (let i = 0; i < 6; i++) box(p, 0.5 + (i % 2) * 0.1, 0.1, 1.4, '#7a756c', -1.7 + i * 0.7, 0.62, -1.0, 0, 0, 0); // vetas de corte
  // Bloques ya cortados y lajas.
  box(p, 1.1, 0.6, 0.8, stone, -1.5, 0.3, 0.5, 0.2);
  box(p, 0.9, 0.6, 0.7, dark, -1.4, 0.9, 0.5, 0.1);
  box(p, 1.0, 0.5, 0.8, stone, 1.5, 0.25, 0.3, -0.2);
  for (let i = 0; i < 3; i++) box(p, 1.1, 0.12, 0.7, '#bdb8ae', 1.4, 0.56 + i * 0.13, 0.3, -0.2);
  if (tier >= 4) {
    aFrame(p, 0.4, -0.2, 3.2, c.trim, 1.7);
    box(p, 0.06, 1.8, 0.06, '#c8b48a', 0.4, 2.2, -0.2);
    box(p, 0.5, 0.4, 0.5, stone, 0.4, 1.2, -0.2);
  }
  if (tier >= 6) {
    // Carril con vagoneta cargada de piedra.
    box(p, 0.1, 0.06, 2.6, '#5a5a60', -0.25 + 2.0, 0.05, 0.2);
    box(p, 0.1, 0.06, 2.6, '#5a5a60', 0.25 + 2.0, 0.05, 0.2);
    box(p, 0.8, 0.4, 0.6, IRON, 2.0, 0.35, 0.6);
    rock(p, 0.28, stone, 2.0, 0.65, 0.6);
  }
  if (tier >= 8) {
    // Excavadora y cinta transportadora.
    box(p, 1.3, 0.7, 0.9, '#d8a82a', -2.0, 0.55, -0.4);
    stick(p, v(-2.0, 0.9, -0.4), v(-1.4, 2.0, -1.2), 0.1, '#d8a82a', 5);
    stick(p, v(-1.4, 2.0, -1.2), v(-0.9, 1.0, -1.7), 0.08, '#d8a82a', 5);
    cyl(p, 0.22, 0.22, 0.2, '#2a2a2e', -2.4, 0.22, -0.1, 8);
    cyl(p, 0.22, 0.22, 0.2, '#2a2a2e', -1.6, 0.22, -0.1, 8);
  }
  // Carretilla.
  box(p, 0.6, 0.3, 0.45, '#7a5230', -0.4, 0.35, 1.0, 0.3);
  cyl(p, 0.14, 0.14, 0.08, '#2a2a2e', -0.2, 0.15, 1.1, 8);
}

// Pozo de arcilla: hoyo bajo con agua, montones de barro, bastidores donde se secan los ladrillos crudos.
export function clayPit(p, tier) {
  const c = pal(Math.min(tier, 6));
  cyl(p, 2.0, 2.2, 0.12, '#6a4630', 0, 0.06, -0.2, 14);
  cyl(p, 1.55, 1.55, 0.1, '#8a5a3a', 0, 0.12, -0.2, 14);
  cyl(p, 0.9, 0.9, 0.06, tier >= 8 ? '#6a8a9a' : '#4a6a82', 0.3, 0.17, -0.3, 12);
  for (const [x, z, r] of [[-1.6, -0.6, 0.55], [1.5, -1.0, 0.65], [-0.9, -1.7, 0.5], [1.4, 0.4, 0.45]]) dome(p, r, '#b86a44', x, 0.05, z, 0.7);
  // Bastidores con ladrillos crudos.
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) box(p, 0.5, 0.18, 0.3, '#c47a52', -1.9 + i * 0.6, 0.32 + row * 0.24, 1.0);
  for (const x of [-2.2, -0.4]) stick(p, v(x, 0, 0.8), v(x, 1.1, 0.8), 0.05, c.trim, 4);
  box(p, 2.0, 0.06, 0.6, c.trim, -1.3, 1.1, 0.95);
  box(p, 0.6, 0.3, 0.45, '#7a5230', 1.5, 0.35, 1.2, -0.4); // carretilla
  cyl(p, 0.14, 0.14, 0.08, '#2a2a2e', 1.7, 0.15, 1.3, 8);
  if (tier >= 5) {
    // Bomba y canal de lavado.
    cyl(p, 0.3, 0.3, 1.1, IRON, -1.9, 0.55, -1.5, 8);
    stick(p, v(-1.9, 1.1, -1.5), v(-0.6, 0.9, -1.1), 0.08, IRON, 5);
  }
  if (tier >= 8) {
    // Excavadora de cangilones.
    box(p, 1.2, 0.8, 0.9, '#d8a82a', 1.7, 0.6, -1.5);
    stick(p, v(1.7, 1.0, -1.5), v(0.9, 1.6, -0.9), 0.09, '#d8a82a', 5);
  }
}

// Mina de galería con la roca y el mineral de cada mena.
export function shaftMine(p, tier, id) {
  const look = MINE_LOOK[id] ?? MINE_LOOK.iron_mine;
  const c = pal(Math.min(tier, 6));
  const heavy = tier >= 8;
  p.add(new THREE.DodecahedronGeometry(2.2, 0), heavy ? '#6a6660' : look.rock, mat(0, 1.0, -0.4, 0, 0.4, 0, 1.3, 0.8, 1));
  // Manchas de mineral en la roca (cada mena se reconoce por el color).
  for (const [x, y, z, s] of [[-1.5, 1.2, 0.4, 0.5], [1.3, 1.5, -0.3, 0.45], [0.2, 2.0, -0.8, 0.4], [-0.6, 0.6, 0.9, 0.3]]) rock(p, s, look.stain, x, y, z, 0.6);
  box(p, 1.8, 1.8, 0.4, '#1a1410', 0, 0.9, 1.15);
  for (const x of [-0.95, 0.95]) stick(p, v(x, 0, 1.3), v(x, 1.9, 1.3), 0.11, c.trim, 5);
  box(p, 2.2, 0.2, 0.3, c.trim, 0, 1.95, 1.3);
  // Montón de mineral a la entrada.
  for (const [x, z, s] of [[-1.5, 1.9, 0.32], [-1.1, 2.1, 0.26], [-1.8, 1.5, 0.28]]) rock(p, s, look.ore, x, 0.2, z, 0.8);
  if (id === 'copper_mine') {
    // Lavadero de cobre: canal de madera con agua verdosa.
    box(p, 0.5, 0.15, 2.2, c.trim, 1.9, 0.5, 0.6);
    box(p, 0.36, 0.05, 2.0, '#5ab89a', 1.9, 0.6, 0.6);
    for (const z of [-0.3, 0.6, 1.5]) stick(p, v(1.9, 0, z), v(1.9, 0.45, z), 0.04, c.trim, 4);
  } else if (id === 'tin_mine') {
    // Criba y cajón de lavado.
    box(p, 1.2, 0.5, 0.8, '#8a643c', 1.8, 0.45, 0.4, 0.3);
    box(p, 1.0, 0.05, 0.6, '#cfd6da', 1.8, 0.72, 0.4, 0.3);
    stick(p, v(2.3, 0.7, 0.1), v(2.5, 1.4, -0.1), 0.04, '#6b4a2e', 4);
  } else if (id === 'iron_mine') {
    // Castillete de madera con polea.
    aFrame(p, 1.9, -0.6, 3.4, c.trim, 1.5);
    cyl(p, 0.35, 0.35, 0.12, IRON, 1.9, 3.3, -0.6, 10);
    box(p, 0.6, 0.5, 0.5, '#7a5230', 1.9, 1.0, -0.6);
  } else if (id === 'coal_mine') {
    // Tolva y cinta negra de carbón.
    box(p, 1.4, 1.0, 1.2, '#2a2a30', 1.9, 0.5, -0.8);
    box(p, 0.6, 0.14, 2.4, '#1a1a1e', 1.9, 0.6, 0.9, 0, -0.15, 0);
    for (const [x, z, s] of [[-1.7, 1.2, 0.5], [-1.2, 1.5, 0.4]]) rock(p, s, '#1a1a1e', x, 0.3, z, 0.9);
  }
  if (tier >= 5) {
    // Raíles con vagoneta cargada.
    box(p, 0.1, 0.06, 3.0, '#5a5a60', -0.35, 0.05, 2.7);
    box(p, 0.1, 0.06, 3.0, '#5a5a60', 0.35, 0.05, 2.7);
    box(p, 0.9, 0.5, 0.7, '#6a5a4a', 0, 0.45, 2.8);
    rock(p, 0.25, look.ingot, 0, 0.8, 2.8);
  }
  if (tier >= 6 && tier < 8) {
    stick(p, v(-1.5, 0, 0.2), v(-0.6, 3.2, 0.2), 0.1, c.trim, 5);
    stick(p, v(0.3, 0, 0.2), v(-0.6, 3.2, 0.2), 0.1, c.trim, 5);
  }
  if (heavy) {
    box(p, 0.9, 4.2, 0.9, '#5a5a62', -1.7, 2.1, -1.0);
    cyl(p, 0.7, 0.7, 0.15, '#3a3a40', -1.7, 4.3, -0.55, 14);
    box(p, 1.4, 0.8, 1.2, '#4a4a52', 1.9, 0.4, -1.2);
    chimney(p, 2.2, 0.8, -1.2, 2.2, '#4a4a52', 0.5);
  }
}

// ---- Hornos ---------------------------------------------------------------------------------------------

// Alfarería: horno en cúpula, estantes de vasijas y torno de alfarero.
export function pottery(p, tier) {
  const c = pal(Math.min(tier, 8));
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) pot(p, -2.3 + i * 0.5, 0.45 + row * 0.55, -1.3, row % 2 ? '#c4693f' : '#a8583a', 0.7);
  box(p, 1.8, 0.08, 0.5, c.trim, -1.8, 0.4, -1.3);
  box(p, 1.8, 0.08, 0.5, c.trim, -1.8, 0.95, -1.3);
  box(p, 1.8, 0.08, 0.5, c.trim, -1.8, 1.5, -1.3);
  // Torno de alfarero.
  cyl(p, 0.4, 0.4, 0.07, '#8a643c', 1.9, 0.62, 0.9, 10);
  cyl(p, 0.1, 0.1, 0.62, '#6b4a2e', 1.9, 0.31, 0.9, 6);
  pot(p, 1.9, 0.66, 0.9, '#c4693f', 0.9);
  // Montón de barro y vasijas grandes.
  dome(p, 0.45, '#b86a44', 2.3, 0.05, -0.8, 0.7);
  pot(p, -2.2, 0, 0.9, '#a8583a', 1.4);
  pot(p, -1.7, 0, 1.1, '#c4693f', 1.1);
}

// Panadería: horno de ladrillo con boca en arco, mesa con panes, sacos de harina y rótulo.
export function bakery(p, tier) {
  const c = pal(Math.min(tier, 8));
  const brick = tier >= 8 ? '#b85a3e' : '#b4846a';
  box(p, 3.4, 0.3, 3.0, c.base, 0, 0.15, 0);
  box(p, 2.8, 1.8, 1.9, brick, 0, 1.2, -0.7);
  dome(p, 1.3, brick, 0, 2.1, -0.7, 0.6);
  box(p, 1.0, 0.8, 0.3, '#1a1410', 0, 0.85, 0.3);
  box(p, 1.2, 0.16, 0.5, '#8f8a82', 0, 0.38, 0.5);
  chimney(p, -0.9, 2.1, -1.1, tier >= 8 ? 2.6 : 1.4, brick, 0.45);
  // Mesa con panes.
  bench(p, 1.9, 0.9, 1.1, 0.7, 0.7, '#a0764a');
  for (const [dx, dz] of [[-0.3, -0.1], [0, 0.15], [0.3, -0.1], [-0.1, 0.2]]) p.add(new THREE.SphereGeometry(0.17, 6, 4), '#d9a55a', mat(1.9 + dx, 0.82, 0.9 + dz, 0, 0, 0, 1.4, 0.7, 0.9));
  // Sacos de harina y una pala.
  for (const [x, z] of [[-2.1, 0.9], [-1.7, 1.2], [-1.9, 0.5]]) sack(p, x, 0, z, '#efe6cc', 1.1);
  stick(p, v(-2.5, 0, -0.4), v(-2.0, 1.8, -0.4), 0.04, '#7a5230', 4);
  box(p, 0.4, 0.04, 0.4, '#8a643c', -2.55, 0.05, -0.55);
  // Rótulo con un pan.
  sign(p, 2.3, 0, -0.4, '#8a643c', '#e5b866', 0.8);
}

// Carbonera: montículo de tierra cubierto de césped, respiraderos y pila de leña alrededor.
export function charcoalKiln(p, tier) {
  const c = pal(Math.min(tier, 8));
  cyl(p, 2.0, 2.2, 0.2, '#5a4a38', 0, 0.1, -0.2, 14);
  dome(p, 1.8, '#4a3c2e', 0, 0.2, -0.2, 0.85);
  for (const [x, z, s] of [[-0.8, -0.8, 0.6], [0.9, -0.5, 0.5], [0.2, 0.5, 0.45], [-0.3, -1.4, 0.4]]) dome(p, s, '#5a7a3a', x, 1.0, z, 0.35);
  for (const [x, z] of [[0, -0.2], [-0.9, -0.2], [0.8, -0.5]]) cone(p, 0.16, 0.4, '#2a2a2e', x, 1.55, z, 6);
  // Leña apilada y cestas de carbón.
  logs(p, -2.4, 0, 0.5, 1.2, 3);
  logs(p, 2.3, 0, -0.9, 1.0, 2);
  for (const [x, z] of [[2.0, 0.8], [2.4, 1.1]]) {
    cyl(p, 0.3, 0.24, 0.45, '#2a2420', x, 0.23, z, 8);
    cyl(p, 0.31, 0.31, 0.06, '#7a5230', x, 0.46, z, 8);
  }
  box(p, 0.5, 0.5, 0.06, c.trim, 0, 0.25, 1.4); // tablón de la boca
  if (tier >= 6) chimney(p, -1.6, 0.2, -1.2, 1.8, '#7a7268', 0.5);
}

// Horno de ladrillos: pila rectangular de ladrillos con bocas de fuego y una chimenea alta.
export function brickKiln(p, tier) {
  const brick = tier >= 9 ? '#c8553a' : '#b85a3e';
  box(p, 3.6, 0.3, 3.2, '#7a7a76', 0, 0.15, 0);
  for (let row = 0; row < 6; row++) box(p, 3.0, 0.3, 2.0, row % 2 ? brick : '#a84e34', 0, 0.45 + row * 0.3, -0.6);
  for (const x of [-0.9, 0.9]) {
    box(p, 0.7, 0.7, 0.2, '#1a1410', x, 0.7, 0.45);
    box(p, 0.8, 0.12, 0.3, '#5a5a60', x, 1.1, 0.45);
  }
  chimney(p, 1.1, 2.0, -1.2, tier >= 9 ? 5.0 : 4.2, brick, 0.8);
  // Palets de ladrillos terminados.
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) box(p, 0.5, 0.18, 0.3, '#c8553a', -2.4 + i * 0.55, 0.3 + row * 0.2, 1.1);
  box(p, 1.8, 0.1, 0.9, '#8a643c', -1.8, 0.18, 1.1);
  if (tier >= 9) box(p, 1.4, 0.8, 0.8, '#d8a82a', 2.3, 0.55, 1.0); // carretilla elevadora
}

// ---- Fundiciones ----------------------------------------------------------------------------------------

// Fundición: alto horno (crisol) con lingoteras y tenazas.
export function smelterMark(p, tier) {
  // Lingoteras con lingotes y tenazas.
  for (let i = 0; i < 4; i++) box(p, 0.5, 0.14, 0.22, STEEL, -2.0 + i * 0.56, 0.4, -1.4);
  box(p, 2.4, 0.18, 0.5, '#6b4a2e', -1.4, 0.2, -1.4);
  stick(p, v(2.2, 0, 1.2), v(2.5, 0.9, 1.0), 0.04, IRON, 4);
  stick(p, v(2.5, 0.9, 1.0), v(2.2, 1.3, 0.7), 0.04, IRON, 4);
  if (tier >= 5) cyl(p, 0.4, 0.3, 0.5, '#ff7a2a', 1.9, 0.55, -1.4, 8); // crisol al rojo
}

// Fogón de hierro (bloomery): horno bajo de arcilla con fuelle, escoria y cestas de carbón.
export function bloomeryMark(p, tier) {
  const c = pal(Math.min(tier, 8));
  // Fuelle grande de cuero con su palanca.
  box(p, 1.1, 0.5, 0.8, '#6b4a2e', -1.9, 0.6, 0.6, 0.3);
  box(p, 0.9, 0.35, 0.6, '#8a643c', -1.9, 0.95, 0.6, 0.3, 0.1);
  stick(p, v(-2.3, 0.7, 0.2), v(-2.7, 1.9, -0.2), 0.05, c.trim, 4);
  // Escoria y mena.
  for (const [x, z, s] of [[1.8, 0.9, 0.38], [2.2, 0.4, 0.3], [1.5, 1.3, 0.28], [2.4, 1.2, 0.34]]) rock(p, s, '#2e2c30', x, 0.2, z, 0.8);
  for (const [x, z] of [[-2.1, -1.3], [-1.6, -1.5]]) {
    cyl(p, 0.3, 0.24, 0.45, '#2a2420', x, 0.23, z, 8);
    cyl(p, 0.31, 0.31, 0.06, '#7a5230', x, 0.46, z, 8);
  }
  if (tier >= 6) box(p, 0.5, 0.5, 0.4, IRON, 1.6, 0.25, -1.5); // masa de hierro esponjoso
}

// ---- Talleres -------------------------------------------------------------------------------------------

export function workshopMark(p, tier, id) {
  const c = pal(tier);
  switch (id) {
    case 'tool_workshop':
      // Tablero con herramientas colgadas y una piedra de afilar.
      box(p, 1.8, 1.0, 0.1, c.trim, 2.2, 1.4, -0.4, Math.PI / 2);
      for (let i = 0; i < 4; i++) box(p, 0.08, 0.5 + (i % 2) * 0.2, 0.06, i % 2 ? STEEL : '#9a7446', 2.28, 1.4, -1.0 + i * 0.4);
      cyl(p, 0.35, 0.35, 0.12, '#8f8a82', -2.2, 0.55, 1.2, 12);
      stick(p, v(-2.2, 0, 1.2), v(-2.2, 0.5, 1.2), 0.06, '#5a3a22', 4);
      box(p, 0.5, 0.4, 0.4, STEEL, 1.5, 0.95, 2.1); // tornillo de banco
      break;
    case 'blacksmith':
      // Fragua abierta con campana, yunque grande, barril de agua y herraduras.
      box(p, 1.6, 0.9, 1.2, '#7a7268', 2.0, 0.45, -0.8);
      box(p, 1.2, 0.1, 0.9, '#ff7a2a', 2.0, 0.92, -0.8);
      box(p, 1.4, 0.9, 1.0, '#5a5a62', 2.0, 1.55, -0.8, 0, 0, 0.35);
      barrel(p, 2.4, 0, 0.4, '#5a4a38', 1.1);
      box(p, 0.9, 0.5, 0.6, IRON, -2.2, 0.45, 0.9);
      box(p, 0.5, 0.3, 0.3, IRON, -2.2, 0.85, 0.9);
      for (let i = 0; i < 3; i++) p.add(new THREE.TorusGeometry(0.12, 0.03, 4, 8), '#9aa0a6', mat(-0.5 + i * 0.35, 2.2, 1.45));
      break;
    case 'stonecutter':
      // Bloques sin labrar, un bloque con cincel y un marco de sierra.
      box(p, 1.1, 0.7, 0.8, '#a8a39a', 2.1, 0.35, -0.5, 0.2);
      box(p, 0.9, 0.5, 0.7, '#8f8a82', 2.0, 1.0, -0.5, -0.1);
      box(p, 0.8, 0.5, 0.6, '#b8b2a6', -2.1, 0.25, 1.0, 0.4);
      stick(p, v(-2.1, 0.55, 1.0), v(-1.8, 0.75, 1.1), 0.03, STEEL, 4);
      aFrame(p, -2.1, -1.0, 1.7, c.trim, 1.0);
      box(p, 0.06, 1.1, 0.3, STEEL, -2.1, 0.9, -1.0);
      for (const [x, z] of [[1.6, 1.3], [2.0, 1.5]]) box(p, 0.5, 0.18, 0.3, '#bdb8ae', x, 0.1, z, 0.3);
      break;
    case 'tailor':
      // Percha con prendas colgadas, maniquí con una túnica y un fardo de pieles o telas.
      box(p, 0.08, 1.9, 0.08, c.trim, -2.4, 0.95, 1.0);
      box(p, 0.08, 1.9, 0.08, c.trim, -0.9, 0.95, 1.0);
      box(p, 1.6, 0.08, 0.08, c.trim, -1.65, 1.85, 1.0);
      for (const [i, col] of [[0, '#8a5a34'], [1, tier >= 4 ? '#c9a878' : '#a0764a'], [2, tier >= 6 ? '#6a4a8a' : '#7a8a5a']]) box(p, 0.34, 0.7, 0.06, col, -2.1 + i * 0.45, 1.45, 1.0);
      stick(p, v(2.1, 0, 0.9), v(2.1, 1.3, 0.9), 0.05, c.trim, 4);
      box(p, 0.5, 0.7, 0.3, tier >= 6 ? '#6a4a8a' : '#a0764a', 2.1, 1.0, 0.9);
      box(p, 0.3, 0.3, 0.3, '#d8b48a', 2.1, 1.55, 0.9);
      cyl(p, 0.4, 0.4, 0.5, tier >= 6 ? '#e8dcc0' : '#8a5a34', 1.8, 0.25, -0.4, 8);
      break;
    case 'textile':
      // Telar de madera con hilos, balas de tela y tinas de tinte.
      box(p, 0.08, 1.7, 0.08, c.trim, -2.3, 0.85, 0.6);
      box(p, 0.08, 1.7, 0.08, c.trim, -1.3, 0.85, 0.6);
      box(p, 1.1, 0.08, 0.08, c.trim, -1.8, 1.65, 0.6);
      box(p, 1.1, 0.08, 0.08, c.trim, -1.8, 0.35, 0.6);
      for (let i = 0; i < 8; i++) box(p, 0.015, 1.3, 0.015, '#e8dcc0', -2.2 + i * 0.12, 1.0, 0.6);
      box(p, 0.9, 0.5, 0.15, '#c8423a', -1.8, 0.6, 0.6);
      for (const [x, col] of [[1.8, '#c8423a'], [2.35, '#3a6a9a'], [1.8, '#e0c25a']]) {
        cyl(p, 0.32, 0.28, 0.45, col, x, 0.23, x === 1.8 && col === '#e0c25a' ? -0.1 : 0.7, 8);
      }
      for (let i = 0; i < 3; i++) cyl(p, 0.18, 0.18, 0.8, ['#d8cdb8', '#c8b48a', '#a8c4d8'][i], 2.2, 0.2 + i * 0.36, -1.0, 8);
      break;
    case 'precision_shop':
      // Ventanal de taller, rueda dentada en el tejado y un telescopio sobre trípode.
      box(p, 2.4, 0.9, 0.1, GLASS, 0, 1.6, 1.45);
      wheel(p, -1.6, 3.3, 0, 0.55, '#8f8a82', 8);
      wheel(p, -0.6, 3.1, 0, 0.35, '#b4bcc4', 6);
      stick(p, v(2.1, 0, 1.0), v(2.1, 1.2, 1.0), 0.04, '#5a3a22', 4);
      stick(p, v(2.1, 1.2, 1.0), v(2.7, 1.7, 0.4), 0.09, '#8f8a82', 6);
      break;
    case 'siege_shop':
      // Catapulta en construcción: bastidor, brazo, cesta y piedras.
      box(p, 1.9, 0.18, 0.6, c.trim, 2.1, 0.25, 0.4, 0.5);
      aFrame(p, 2.1, 0.4, 1.7, c.trim, 1.3);
      stick(p, v(1.8, 0.7, 0.4), v(2.9, 1.9, 0.2), 0.08, '#8a643c', 5);
      cyl(p, 0.22, 0.2, 0.2, '#6b4a2e', 2.95, 1.9, 0.2, 7);
      for (const [x, z] of [[2.0, 1.4], [2.4, 1.6]]) rock(p, 0.22, '#8f8a82', x, 0.2, z);
      break;
    case 'armory':
      // Soportes con lanzas y espadas, y escudos redondos en la pared.
      for (let i = 0; i < 3; i++) stick(p, v(2.0 + i * 0.25, 0, 0.6), v(2.0 + i * 0.25, 1.9, 0.6), 0.04, '#9a7446', 4);
      for (const [x, col] of [[-1.4, '#c8423a'], [-0.6, '#3a6a9a'], [0.2, '#e0c25a']]) {
        cyl(p, 0.38, 0.38, 0.08, col, x, 1.6, 1.46, 12);
        cyl(p, 0.1, 0.1, 0.1, STEEL, x, 1.6, 1.5, 8);
      }
      break;
    default:
      break;
  }
}

// ---- Molinos y serrerías --------------------------------------------------------------------------------

// Aserradero: cobertizo abierto con una sierra, pila de troncos y rueda hidráulica.
export function sawmill(p, tier) {
  const c = pal(Math.min(tier, 8));
  if (tier >= 8) {
    box(p, 4.0, 2.4, 3.0, '#b4bcc4', 0, 1.2, -0.2);
    box(p, 4.2, 0.2, 3.2, IRON, 0, 2.5, -0.2);
    chimney(p, -1.4, 2.5, -1.0, 2.2, '#8a9298', 0.6);
    box(p, 0.2, 1.6, 3.4, '#d8a82a', 2.4, 0.9, 0.5, 0, 0, 0.25); // cinta transportadora
    logs(p, -2.3, 0, 1.2, 1.4, 3);
    door(p, 0, 0, 1.35, 1.6, 1.8);
    return;
  }
  for (const [x, z] of [[-1.7, -1.0], [1.7, -1.0], [-1.7, 1.0], [1.7, 1.0]]) stick(p, v(x, 0, z), v(x, 2.2, z), 0.1, c.trim, 5);
  gable(p, 4.0, 2.8, 1.0, c.roof, 2.2, null);
  box(p, 3.4, 0.25, 1.6, '#8a643c', 0, 0.55, -0.2); // mesa de corte
  box(p, 3.0, 0.1, 0.1, STEEL, 0, 1.1, -0.2);
  wheel(p, 0, 1.0, -0.2, 0.55, STEEL, 8);
  logs(p, -2.4, 0, 1.0, 1.4, 3);
  for (let i = 0; i < 3; i++) box(p, 1.4, 0.07, 0.5, '#d4b074', 2.2, 0.15 + i * 0.1, 0.8, 0.2); // tablas
  // Rueda hidráulica a un lado.
  wheel(p, 2.7, 1.1, -0.9, 0.95, '#6b4a2e', 8);
  box(p, 0.15, 0.15, 1.2, '#5a3a22', 2.7, 1.1, -0.9);
}

export function millMark(p, tier) {
  // Sacos de grano y harina junto a la rueda.
  for (const [x, z] of [[2.0, 0.9], [2.4, 0.6], [2.2, 1.3]]) sack(p, x, 0, z, '#efe6cc', 1.1);
  sack(p, -2.1, 0, 1.1, '#d8c070', 1.1);
  sack(p, -2.4, 0, 0.7, '#d8c070', 1.1);
  if (tier < 8) flagPole(p, -2.2, 0, -1.0, 2.8, '#e8dcc0');
}

// Fábrica de pólvora: casa baja de piedra con muro de contención, ruedas de moler y barriles.
export function powderMill(p, tier) {
  const stone = tier >= 9 ? '#a8a8a2' : '#b4aea0';
  box(p, 3.4, 0.3, 3.0, '#7a7a76', 0, 0.15, 0);
  box(p, 2.6, 1.9, 2.0, stone, 0, 1.25, 0);
  box(p, 2.9, 0.2, 2.3, tier >= 9 ? '#5a6068' : '#7a4a35', 0, 2.3, 0);
  // Muro de contención (por si explota) y barriles etiquetados.
  box(p, 3.6, 1.2, 0.4, '#8a8478', 0, 0.9, -1.8);
  box(p, 0.4, 1.2, 2.4, '#8a8478', -2.0, 0.9, -0.6);
  box(p, 0.4, 1.2, 2.4, '#8a8478', 2.0, 0.9, -0.6);
  for (const [x, z] of [[1.6, 1.0], [2.1, 0.7], [1.7, 1.5]]) barrel(p, x, 0, z, '#3a3a3e', 1.0);
  for (const [x, z] of [[1.6, 1.0], [2.1, 0.7]]) box(p, 0.16, 0.12, 0.04, '#e0c25a', x, 0.35, z + 0.27);
  // Rueda de moler de piedra.
  cyl(p, 0.7, 0.7, 0.2, '#8f8a82', -1.5, 0.35, 1.0, 12);
  stick(p, v(-1.5, 0, 1.0), v(-1.5, 1.4, 1.0), 0.07, '#5a3a22', 5);
  window_(p, -0.8, 1.6, 1.02, DARK, 0.4, 0.4);
  window_(p, 0.9, 1.6, 1.02, DARK, 0.4, 0.4);
}

// ---- Industria ------------------------------------------------------------------------------------------

export function factoryMark(p, tier, id) {
  switch (id) {
    case 'steel_mill':
      // Horno alto con franja al rojo, cuchara de colada sobre rieles y escoria.
      cyl(p, 0.9, 1.3, 4.2, '#5a5a62', -2.1, 2.1, 1.0, 12);
      cyl(p, 0.95, 0.95, 0.5, '#ff6a2a', -2.1, 3.0, 1.0, 12);
      cone(p, 1.0, 0.7, '#3a3a40', -2.1, 4.5, 1.0, 12);
      stick(p, v(-2.1, 3.8, 1.0), v(-0.4, 3.0, 1.9), 0.12, '#7a7a82', 6);
      box(p, 0.8, 0.6, 0.8, '#6a6a70', -0.3, 2.9, 1.9);
      box(p, 0.1, 0.06, 2.6, '#4a4a52', 1.7, 0.06, 1.3);
      box(p, 0.1, 0.06, 2.6, '#4a4a52', 2.1, 0.06, 1.3);
      for (const [x, z, s] of [[2.6, -0.4, 0.5], [2.9, 0.1, 0.38]]) rock(p, s, '#2e2c30', x, 0.25, z, 0.8);
      break;
    case 'concrete_plant':
      // Tres silos, mezcladora y tolva con cinta.
      for (const [x, z] of [[-2.4, -0.8], [-1.2, -0.8], [-1.8, 0.4]]) {
        cyl(p, 0.55, 0.55, 3.4, '#cfcfca', x, 1.7, z, 12);
        cone(p, 0.6, 0.5, '#9a9a96', x, 3.6, z, 12);
      }
      cyl(p, 0.7, 0.7, 1.3, '#d8a82a', 2.3, 1.0, 0.9, 10);
      box(p, 0.15, 1.8, 0.15, IRON, 2.3, 0.9, 0.9);
      box(p, 0.5, 0.15, 2.8, '#2a2a2e', 1.0, 1.6, 0.3, 0, -0.35, 0);
      break;
    case 'electronics_factory':
      // Fachada limpia con ventanales corridos, antenas y una parabólica.
      box(p, 4.6, 0.5, 0.1, GLASS, 0, 2.4, 1.85);
      box(p, 4.6, 0.5, 0.1, GLASS, 0, 1.3, 1.85);
      stick(p, v(-1.8, 3.3, -0.5), v(-1.8, 5.0, -0.5), 0.05, '#cfd8de', 5);
      stick(p, v(-1.3, 3.3, -0.5), v(-1.3, 4.4, -0.5), 0.05, '#cfd8de', 5);
      p.add(new THREE.SphereGeometry(0.7, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#e8ecef', mat(1.6, 3.9, -0.6, Math.PI * 0.8, 0, 0));
      stick(p, v(1.6, 3.3, -0.6), v(1.6, 3.9, -0.6), 0.06, '#9aa0a6', 5);
      box(p, 0.6, 0.12, 0.6, '#5ad0a0', 1.7, 3.35, 0.5);
      break;
    case 'motor_pool':
      // Tres portones de garaje y un vehículo a cada lado.
      for (const x of [-1.7, 0, 1.7]) box(p, 1.4, 1.5, 0.1, '#6a7a82', x, 0.85, 1.9);
      box(p, 1.6, 0.6, 0.8, '#5a6a50', -3.0, 0.45, 0.4);
      box(p, 0.8, 0.5, 0.7, '#5a6a50', -2.5, 1.0, 0.4);
      for (const x of [-3.5, -2.5]) cyl(p, 0.22, 0.22, 0.9, '#2a2a2e', x, 0.22, 0.4, 8);
      box(p, 1.6, 0.6, 0.8, '#7a8a60', 3.0, 0.45, -0.3);
      for (const x of [2.5, 3.5]) cyl(p, 0.22, 0.22, 0.9, '#2a2a2e', x, 0.22, -0.3, 8);
      break;
    case 'armory':
      // Arsenal reforzado: cajas de munición, un blindado y una antena.
      for (const [x, z] of [[2.5, 1.0], [2.9, 0.6], [2.6, 1.5]]) crate(p, x, 0, z, 0.55, '#5a6a50');
      box(p, 1.4, 0.6, 0.8, '#5a6a50', -3.0, 0.45, 0.8);
      cyl(p, 0.18, 0.18, 1.0, '#3a3a3e', -2.4, 0.9, 0.8, 8);
      stick(p, v(2.3, 3.0, -1.0), v(2.3, 5.0, -1.0), 0.05, '#cfd8de', 5);
      break;
    default:
      break;
  }
}

// ---- Cuarteles ------------------------------------------------------------------------------------------

export function barracksMark(p, tier, id) {
  const c = pal(Math.min(tier, 10));
  if (id === 'archery') {
    // Dianas sobre soportes, balas de paja y un estante de arcos.
    for (const [x, z] of [[-2.2, -0.6], [-1.2, -0.9], [-0.2, -0.6]]) {
      aFrame(p, x, z, 1.5, c.trim, 0.8);
      cyl(p, 0.5, 0.5, 0.08, '#efe6cc', x, 1.1, z + 0.1, 14);
      cyl(p, 0.3, 0.3, 0.1, '#c8423a', x, 1.1, z + 0.12, 12);
      cyl(p, 0.12, 0.12, 0.12, '#e0c25a', x, 1.1, z + 0.14, 8);
    }
    for (const [x, z] of [[1.7, 0.9], [2.1, 0.6]]) box(p, 0.8, 0.5, 0.5, '#d8b860', x, 0.25, z, 0.3);
    for (let i = 0; i < 3; i++) stick(p, v(2.3 + i * 0.12, 0.2, -0.6), v(2.3 + i * 0.12, 1.7, -0.6), 0.025, '#7a5230', 4);
  } else if (id === 'stable') {
    // Tres establos con caballos asomados, pesebre y heno.
    for (let i = -1; i <= 1; i++) {
      box(p, 0.08, 1.0, 0.7, c.trim, i * 1.0 - 0.45, 0.5, 0.9);
      box(p, 0.5, 0.5, 0.8, '#7a4a30', i * 1.0, 0.55, 0.8);
      stick(p, v(i * 1.0, 0.7, 1.1), v(i * 1.0, 1.15, 1.35), 0.14, '#7a4a30', 5);
      box(p, 0.28, 0.3, 0.5, '#7a4a30', i * 1.0, 1.25, 1.5);
    }
    for (const [x, z] of [[2.1, 0.8], [2.4, 0.4]]) p.add(new THREE.BoxGeometry(0.7, 0.5, 0.5), '#d8b860', mat(x, 0.25, z, 0, 0.3, 0));
    box(p, 1.4, 0.3, 0.3, '#6b4a2e', -2.2, 0.35, 1.0);
  } else if (tier >= 3) {
    // Cuartel: muñecos de entrenamiento y soportes de armas.
    for (const [x, z] of [[-2.0, 0.9], [-1.4, 1.0]]) {
      stick(p, v(x, 0, z), v(x, 1.5, z), 0.07, '#7a5230', 4);
      box(p, 0.7, 0.1, 0.1, '#7a5230', x, 1.3, z);
      p.add(new THREE.SphereGeometry(0.17, 6, 4), '#d8c070', mat(x, 1.65, z));
    }
  }
}

// ---- Otros ------------------------------------------------------------------------------------------------

// Potabilizadora: cisterna de piedra con filtros y tuberías (no es un pozo).
export function waterWorks(p, tier) {
  const c = pal(Math.min(tier, 10));
  box(p, 4.2, 0.3, 3.4, '#7a7a76', 0, 0.15, 0);
  box(p, 3.0, 1.8, 2.2, tier >= 9 ? '#cfd8de' : '#c2bcae', -0.4, 1.2, -0.4);
  box(p, 3.3, 0.2, 2.5, c.roof, -0.4, 2.2, -0.4);
  // Tanque cilíndrico con tuberías y bomba.
  cyl(p, 0.9, 0.9, 2.6, '#9fb0b8', 2.0, 1.6, -0.6, 14);
  cone(p, 1.0, 0.5, '#6a7a82', 2.0, 3.15, -0.6, 14);
  stick(p, v(1.1, 0.5, -0.2), v(-0.4, 0.5, 0.9), 0.1, '#6a7a82', 6);
  stick(p, v(-0.4, 0.5, 0.9), v(-1.9, 0.5, 0.9), 0.1, '#6a7a82', 6);
  // Estanques de filtrado.
  box(p, 1.4, 0.2, 0.9, '#7a8a8a', -1.7, 0.4, 1.3);
  box(p, 1.2, 0.05, 0.7, '#4a7a9a', -1.7, 0.52, 1.3);
  box(p, 0.5, 0.5, 0.5, '#d8a82a', 2.3, 0.5, 1.1);
  door(p, -0.4, 0.3, 0.74, 0.9, 1.6);
  void tier;
}

// Granja: cada nivel suma algo que se ve (espantapájaros, acequia, colmenas, silo, riego).
export function farmMark(p, tier) {
  const c = pal(Math.min(tier, 6));
  // Azada clavada en el surco (siempre).
  stick(p, v(-2.1, 0, 1.5), v(-2.1, 1.0, 1.5), 0.04, '#7a5230', 4);
  box(p, 0.3, 0.06, 0.16, '#6d6d70', -2.1, 0.95, 1.5);
  if (tier >= 3) {
    // Espantapájaros, acequia y colmenas.
    stick(p, v(0.4, 0, 0.3), v(0.4, 1.5, 0.3), 0.05, '#7a5230', 4);
    box(p, 0.9, 0.08, 0.08, '#7a5230', 0.4, 1.2, 0.3);
    p.add(new THREE.SphereGeometry(0.13, 6, 4), '#d8c070', mat(0.4, 1.6, 0.3));
    cone(p, 0.22, 0.2, '#6b4a2e', 0.4, 1.78, 0.3, 6);
    box(p, 4.4, 0.06, 0.3, '#4a7a9a', 0, 0.12, 1.5);
    for (const x of [-2.9, -2.6]) box(p, 0.4, 0.4, 0.4, '#d8b860', x, 0.2, -1.1);
  }
  if (tier >= 5) {
    // Arado de hierro tirado por un buey.
    box(p, 0.9, 0.5, 0.45, '#7a5a3c', 1.6, 0.6, -0.8);
    stick(p, v(1.2, 0.7, -0.8), v(0.5, 0.5, -0.8), 0.05, c.trim, 4);
  }
  void c;
}

// Pozo antiguo: piezas finales según edad (la noria y el depósito ya los pone el estilo).
export function wellMark(p, tier) {
  for (const [x, z] of [[-1.5, 1.0], [1.5, 0.9]]) pot(p, x, 0, z, '#b0603a', 0.9);
  if (tier < 9) box(p, 0.5, 0.06, 0.5, '#7a5230', 1.2, 0.55, 1.1);
}

// Pila de almacén: cada edad añade algo (sacos, cajas, grúa, rampa, silos, automatización).
export function stockpileMark(p, tier) {
  const c = pal(tier);
  const stone = tier >= 8 ? '#7a8088' : c.base;
  if (tier >= 3) for (const [x, z] of [[-2.5, 0.3], [-2.2, 0.8]]) sack(p, x, 0, z, '#d8c9a0', 1.0);
  if (tier >= 4) {
    for (const [x, z] of [[2.7, -0.9], [2.7, 0.0]]) barrel(p, x, 0, z, '#7a5230', 1.0);
    crate(p, 2.7, 0.55, -0.4, 0.55);
  }
  if (tier >= 5) {
    // Pórtico de arcos en la fachada.
    for (const x of [-1.9, 1.9]) cyl(p, 0.14, 0.14, 1.8, '#e8e0cc', x, 1.2, 1.75, 8);
    box(p, 4.2, 0.2, 0.4, c.trim, 0, 2.15, 1.75);
  }
  if (tier >= 6) {
    // Polea de carga bajo el tejado y un carro.
    box(p, 0.12, 0.12, 1.4, '#5a3a22', 0, 2.75, 1.0);
    stick(p, v(0, 2.7, 1.4), v(0, 1.9, 1.4), 0.015, '#c8b48a', 3);
    box(p, 0.6, 0.45, 0.8, '#7a5230', -2.7, 0.45, 1.0);
    cyl(p, 0.22, 0.22, 0.08, '#2a2a2e', -2.4, 0.22, 1.35, 8);
  }
  if (tier >= 7) box(p, 1.6, 0.2, 1.1, '#7a6a52', 0, 0.12, 2.0, 0, 0.08, 0); // rampa de carga
  if (tier >= 8) {
    // Muelle de carga con un camión.
    box(p, 2.6, 0.5, 0.7, stone, 0, 0.3, 1.7);
    box(p, 1.8, 1.1, 0.9, '#d8a82a', 3.0, 0.8, -0.3);
    box(p, 0.7, 0.8, 0.9, '#2a2a2e', 3.7, 0.55, -0.3);
  }
  if (tier >= 9) {
    // Silos laterales.
    for (const z of [-0.9, 0.3]) {
      cyl(p, 0.55, 0.55, 3.0, '#cfcfca', 3.1, 1.5, z - 1.4, 12);
      cone(p, 0.6, 0.5, '#9a9a96', 3.1, 3.2, z - 1.4, 12);
    }
  }
  if (tier >= 10) {
    // Estantería automatizada con un brazo robótico.
    box(p, 0.15, 2.6, 0.15, STEEL, -3.0, 1.3, -1.0);
    box(p, 1.4, 0.12, 0.12, STEEL, -2.3, 2.4, -1.0);
    box(p, 0.4, 0.4, 0.4, '#5ad0a0', -1.8, 2.15, -1.0);
  }
}

// Comedor: chimenea de la cocina (el humo es real: lo anima chimneySmoke.js mientras alguien come), mesas largas con bancos en el costado, un caldero con leña y, según la edad,
// toldo, cartel, ventanas de servicio, extractor y salón acristalado. Nunca delante: ahí están la puerta y su acceso.
export function diningMark(p, tier) {
  const c = pal(tier);
  const wood = tier >= 6 ? '#9a7446' : '#8a643c';
  // Cocina: chimenea que sobresale del tejado (su boca está en CHIMNEY de chimneySmoke.js: x -1,4 · y 4,4 · z -0,9).
  chimney(p, -1.4, 2.7, -0.9, 1.7, tier >= 8 ? '#a8a29a' : '#8a8478', 0.5);
  // Dos mesas largas con bancos a cada lado, en el costado derecho.
  for (const z of [-1.1, 0.5]) {
    box(p, 0.9, 0.08, 1.5, wood, 2.95, 0.85, z);
    for (const dz of [-0.6, 0.6]) stick(p, v(2.95, 0, z + dz), v(2.95, 0.85, z + dz), 0.05, '#5a3a22', 4);
    for (const dx of [-0.65, 0.65]) box(p, 0.3, 0.06, 1.4, wood, 2.95 + dx, 0.5, z);
  }
  // Caldero sobre leña a la izquierda, con vasijas.
  pot(p, -2.9, 0, 0.1, '#34302c', 1.1);
  logs(p, -2.9, 0, -0.9, 0.9, 3);
  pot(p, -2.6, 0, 0.9, '#b0603a', 0.7);
  if (tier >= 4) {
    // Toldo sobre las mesas.
    for (const [x, z] of [[2.4, -1.8], [3.5, -1.8], [2.4, 1.2], [3.5, 1.2]]) stick(p, v(x, 0, z), v(x, 2.0, z), 0.05, c.trim, 4);
    box(p, 1.4, 0.07, 3.3, tier >= 6 ? '#c8423a' : '#d8c9a0', 2.95, 2.05, -0.3, 0, 0, 0.06);
  }
  if (tier >= 6) {
    // Cartel con un plato sobre la puerta y barriles de bebida.
    box(p, 1.0, 0.4, 0.06, '#e8e0cc', 0, 2.75, 1.95);
    cyl(p, 0.14, 0.14, 0.06, '#c8423a', 0, 2.75, 2.0, 10);
    for (const z of [-1.7, -1.2]) barrel(p, -2.9, 0, z - 0.2, '#7a5230', 0.9);
  }
  if (tier >= 8) {
    // Ventanilla de servicio con barra y extractor en el tejado.
    box(p, 1.4, 0.12, 0.5, c.trim, -2.5, 1.1, 1.5);
    cyl(p, 0.35, 0.35, 0.25, '#7a8088', 1.2, 3.8, -0.9, 10);
  }
  if (tier >= 10) {
    // Salón acristalado anexo.
    box(p, 1.8, 1.8, 2.4, GLASS, 3.2, 1.0, 0.0);
    box(p, 1.9, 0.12, 2.5, '#cfcfca', 3.2, 2.0, 0.0);
  }
}

// Cementerio: un recinto vallado con sus tumbas (los bordes de las que caben a esta edad), una estantería con huecos para los jarrones en
// el fondo y un portón al frente. Las tumbas ocupadas y los jarrones los dibuja la vista (deadView.js) a partir de lo que hay de verdad.
export function cemeteryYard(p, tier) {
  const c = pal(tier);
  const lv = BUILDINGS.cemetery.levels.find((l) => l.age === tier) ?? BUILDINGS.cemetery.levels[0];
  const plots = Math.min(PLOT_COLS * PLOT_ROWS, lv.plots);
  const niches = Math.min(NICHE_COLS * NICHE_ROWS, lv.niches);
  const fence = tier >= 9 ? '#3a3a40' : tier >= 5 ? c.trim : '#6b4a2e';
  box(p, 7.6, 0.08, 7.4, tier >= 7 ? '#8f8a7c' : '#7d6a4c', 0, 0.04, 0); // tierra apisonada
  // Vallado: postes y travesaños, con un hueco al frente (+z) para el portón.
  const H = tier >= 9 ? 1.1 : 0.9;
  for (let x = -3.6; x <= 3.61; x += 0.9) if (Math.abs(x) > 1.3) box(p, 0.14, H, 0.14, fence, x, H / 2, 3.6);
  for (let z = -2.7; z <= 3.61; z += 0.9) {
    box(p, 0.14, H, 0.14, fence, -3.6, H / 2, z);
    box(p, 0.14, H, 0.14, fence, 3.6, H / 2, z);
  }
  box(p, 2.3, 0.08, 0.08, fence, -2.45, H * 0.8, 3.6);
  box(p, 2.3, 0.08, 0.08, fence, 2.45, H * 0.8, 3.6);
  box(p, 0.08, 0.08, 6.4, fence, -3.6, H * 0.8, 0.45);
  box(p, 0.08, 0.08, 6.4, fence, 3.6, H * 0.8, 0.45);
  // Portón: dos pilares y un dintel.
  for (const x of [-1.2, 1.2]) box(p, 0.3, 1.5, 0.3, c.wall, x, 0.75, 3.6);
  box(p, 2.7, 0.18, 0.3, c.trim, 0, 1.55, 3.6);
  // Estantería del fondo: un muro con un hueco por cada jarrón que cabe.
  const wallH = 0.5 + NICHE_ROWS * 0.62;
  box(p, 7.0, wallH, 0.5, c.wall, 0, wallH / 2, -3.55);
  box(p, 7.2, 0.14, 0.7, c.roof, 0, wallH + 0.07, -3.55);
  for (let i = 0; i < niches; i++) {
    const q = nicheLocal(i);
    box(p, 0.6, 0.46, 0.12, DARK, q.x, q.y, -3.3);
  }
  for (let r = 0; r < NICHE_ROWS; r++) box(p, 6.6, 0.05, 0.22, c.trim, 0, 0.24 + r * 0.62, -3.28);
  // Tumbas: el borde de piedra de cada una (vacías); las ocupadas llevan además su montículo y su cruz (deadView.js).
  for (let i = 0; i < plots; i++) {
    const q = plotLocal(i);
    box(p, 0.95, 0.03, 0.62, '#5a4632', q.x, 0.1, q.z);
    box(p, 1.0, 0.07, 0.07, c.base, q.x, 0.12, q.z - 0.34);
    box(p, 1.0, 0.07, 0.07, c.base, q.x, 0.12, q.z + 0.34);
    box(p, 0.07, 0.07, 0.68, c.base, q.x - 0.5, 0.12, q.z);
    box(p, 0.07, 0.07, 0.68, c.base, q.x + 0.5, 0.12, q.z);
  }
  if (tier >= 7) for (const x of [-3.1, 3.1]) box(p, 0.3, 1.4, 0.3, c.wall, x, 0.7, 3.1); // obeliscos
  if (tier >= 9) for (const x of [-3.2, 3.2]) {
    stick(p, v(x, 0, 2.3), v(x, 2.6, 2.3), 0.05, '#3a3a40', 5);
    box(p, 0.3, 0.4, 0.3, '#f6e6a0', x, 2.8, 2.3);
  }
  if (tier >= 9) box(p, 7.2, 0.1, 1.5, GLASS, 0, wallH + 0.55, -3.0);
}

// Establo: una cuadra cerrada de troncos con un portón al frente (hueco oscuro: los caballos entran y salen por ahí y dentro no se ven), tejado a
// dos aguas, pacas de heno y un cercado bajo delante. A mayor edad, más grande, con mejores materiales, chimenea y una linterna de ventilación.
export function horseStable(p, tier) {
  const c = pal(tier);
  const w = tier >= 7 ? 6.3 : tier >= 5 ? 5.1 : 3.9;
  const d = 2.6;
  const wood = tier >= 5 ? '#8a5a34' : '#7a4f2e';
  box(p, w + 0.4, 0.14, d + 0.4, tier >= 7 ? '#8f8a7c' : '#6a5a40', 0, 0.07, 0); // suelo de tierra y paja
  const H = tier >= 7 ? 2.6 : 1.9;
  const layers = 6;
  const lh = H / layers;
  // Muro del fondo y laterales de troncos.
  for (let i = 0; i < layers; i++) box(p, w, lh, 0.22, i % 2 ? wood : '#6b4a2e', 0, 0.25 + i * lh, -d / 2 + 0.11);
  for (const s of [-1, 1]) for (let i = 0; i < layers; i++) box(p, 0.22, lh, d, i % 2 ? wood : '#6b4a2e', (s * (w - 0.22)) / 2, 0.25 + i * lh, 0);
  // Frente cerrado con un portón en el centro: dos tramos de troncos, un dintel y el hueco oscuro de la puerta.
  const gap = 1.5;
  const side = (w - gap) / 2;
  for (const s of [-1, 1]) for (let i = 0; i < layers; i++) box(p, side, lh, 0.22, i % 2 ? wood : '#6b4a2e', s * (gap / 2 + side / 2), 0.25 + i * lh, d / 2 - 0.11);
  box(p, gap + 0.3, H - 1.55 + 0.25, 0.26, wood, 0, 1.55 + (H - 1.55 + 0.25) / 2 - 0.0, d / 2 - 0.12); // dintel
  box(p, gap, 1.55, 0.1, DARK, 0, 0.25 + 0.775, d / 2 - 0.2); // el interior, a oscuras
  for (const s of [-1, 1]) box(p, 0.16, 1.7, 0.3, '#5a3a22', s * (gap / 2 + 0.08), 0.25 + 0.85, d / 2 - 0.1); // jambas
  // Tejado a dos aguas que cubre la cuadra y asoma un poco al frente.
  gable(p, w + 0.5, d + 0.7, 1.0, c.roof, H + 0.28, wood);
  // Pacas de heno y un barril junto a la cuadra.
  for (const [x, y] of [[w / 2 + 0.45, 0.2], [w / 2 + 0.45, 0.6], [w / 2 + 1.0, 0.2]]) box(p, 0.7, 0.36, 0.5, '#d8c060', x, y, -0.3);
  barrel(p, -w / 2 - 0.5, 0, 0.9, '#7a5230', 0.7);
  // Cercado bajo al frente con un hueco central: los caballos salen y entran por el centro.
  const z = d / 2 + 0.55;
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.9) if (Math.abs(x) > 0.7) box(p, 0.12, 0.85, 0.12, wood, x, 0.43, z);
  for (const s of [-1, 1]) box(p, w / 2 - 0.55, 0.07, 0.07, wood, s * (0.7 + (w / 2 - 0.55) / 2), 0.7, z);
  if (tier >= 5) chimney(p, w / 2 - 0.5, H + 0.5, -d / 2 + 0.6, 0.9, c.base);
  if (tier >= 7) {
    for (const x of [-w / 2 - 0.1, w / 2 + 0.1]) box(p, 0.3, 2.2, 0.3, c.wall, x, 1.1, d / 2 + 0.2);
    box(p, 0.9, 0.7, 0.9, wood, 0, H + 1.5, 0); // linterna de ventilación sobre la cumbrera
    box(p, 1.1, 0.12, 1.1, c.roof, 0, H + 1.9, 0);
    for (const x of [-w / 4, w / 4]) window_(p, x, 1.4, d / 2 + 0.03, GLASS, 0.5, 0.5);
  }
}

// Recolectores y leñadores de las edades avanzadas.
export function gathererMark(p) {
  // Cajas de fruta, un secadero y un toldo.
  for (const [x, z] of [[-2.7, 0.4], [-2.7, 1.0], [-2.7, -0.2]]) {
    crate(p, x, 0, z, 0.5, '#c49a5a');
    p.add(new THREE.SphereGeometry(0.2, 6, 4), pick(['#b8283a', '#7a2a6a', '#e0a02a'], x), mat(x, 0.6, z, 0, 0, 0, 1, 0.6, 1));
  }
  for (const x of [2.2, 2.9]) stick(p, v(x, 0, -0.3), v(x, 1.5, -0.3), 0.05, '#6b4a2e', 4);
  box(p, 1.1, 0.06, 0.4, '#8a643c', 2.55, 1.5, -0.3);
  for (let i = 0; i < 4; i++) box(p, 0.06, 0.4, 0.04, '#a8c43a', 2.1 + i * 0.25, 1.3, -0.3);
}

export function woodcutterMark(p) {
  // Caballete con un tronco y una sierra de dos manos, y astillas.
  aFrame(p, 2.4, 0.2, 0.9, '#6b4a2e', 1.0);
  aFrame(p, 2.4, -0.4, 0.9, '#6b4a2e', 1.0);
  stick(p, v(1.7, 1.0, -0.1), v(3.2, 1.0, -0.1), 0.2, '#7a5230', 6);
  box(p, 1.0, 0.12, 0.03, STEEL, 2.4, 1.3, -0.1);
  logs(p, -2.5, 0, 0.2, 1.2, 3);
  for (let k = 0; k < 5; k++) box(p, 0.18, 0.03, 0.07, '#c9a26a', 1.5 + (k % 3) * 0.3, 0.02, 1.0 + (k % 2) * 0.3, 0, k, 0);
}

// Niveles que comparten edad (y por tanto estilo) se distinguen con una ampliación visible: cada rango suma piezas
// en los costados y el fondo (nunca delante, donde está la puerta y su franja de acceso).
export function upgradeKit(p, tier, rank, size) {
  const c = pal(Math.min(tier, 10));
  const s = Math.max(1.6, size);
  // Rango 1: cobertizo anexo al fondo con cajas, y estandarte.
  const ax = -s * 0.5;
  box(p, 1.6, 1.3, 1.3, c.wall, ax, 0.65, -s * 0.85);
  box(p, 1.9, 0.14, 1.6, c.roof, ax, 1.38, -s * 0.85);
  crate(p, ax + 1.3, 0, -s * 0.85, 0.5);
  flagPole(p, s * 0.75, 0, -s * 0.6, 3.0, tier >= 7 ? '#3a6a9a' : '#c8423a');
  if (rank >= 2) {
    // Rango 2: refuerzos de piedra en las esquinas del fondo, farol y un segundo anexo.
    for (const sx of [-1, 1]) box(p, 0.5, 2.0, 0.5, '#8f8a82', sx * s * 0.8, 1.0, -s * 0.8);
    stick(p, v(s * 0.8, 0, s * 0.3), v(s * 0.8, 2.0, s * 0.3), 0.05, '#5a3a22', 4);
    box(p, 0.3, 0.3, 0.3, '#ffd27a', s * 0.8, 2.1, s * 0.3);
    box(p, 1.3, 1.0, 1.1, c.wall, s * 0.55, 0.5, -s * 0.9);
    box(p, 1.5, 0.12, 1.3, c.roof, s * 0.55, 1.06, -s * 0.9);
  }
}
