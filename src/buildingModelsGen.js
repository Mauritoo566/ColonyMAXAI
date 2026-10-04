// Modelos 3D generados por parámetros para los edificios de todas las edades. El nombre de un
// modelo es «gen:<estilo>:<edad>:<tipo>» (ver sim/buildingTypes.js): el estilo da la forma, la
// edad los materiales y la riqueza de detalles, y el tipo añade lo propio de cada edificio
// (bandera, cruz del hospital, silos...). Metros, suelo en y = 0, la puerta mira a +z y todo
// cabe en el radio de la huella del tipo, para que al evolucionar no se solape con nada.
import {
  THREE, mat, stick, v, triangle, box, cyl, cone, dome, gable, door, window_, chimney, frameBeams, pal, flag, pick, setVariant, DARK, GLASS,
  pot, barrel, sack, crate,
} from './modelParts.js';
import {
  quarryPit, clayPit, shaftMine, pottery, bakery, charcoalKiln, brickKiln, smelterMark, bloomeryMark, workshopMark, sawmill, millMark, powderMill,
  factoryMark, barracksMark, upgradeKit, waterWorks, farmMark, stockpileMark, gathererMark, woodcutterMark, diningMark, cemeteryYard, horseStable,
} from './buildingModelsSig.js';

// ---- Viviendas ------------------------------------------------------------------------------

function house(p, tier) {
  const c = pal(tier);
  const floors = tier >= 7 ? 2 : 1;
  const fh = 1.9;
  const w = tier >= 9 ? 3.8 : 3.5;
  const d = tier >= 9 ? 3.4 : 3.0;
  if (tier <= 3) {
    // Adobe con vigas y tejado de caña.
    box(p, w, 0.3, d + 0.3, c.base, 0, 0.15, 0);
    box(p, w - 0.2, fh, d - 0.2, c.wall, 0, 0.3 + fh / 2, 0);
    for (const x of [-w / 2, 0, w / 2]) box(p, 0.16, 0.16, d + 0.3, c.trim, x, 0.3 + fh - 0.1, 0);
    frameBeams(p, w, fh * 0.8, d - 0.1, 0.5, c.trim);
    gable(p, w + 0.5, d + 0.3, 1.2, c.roof, 0.3 + fh, c.wall);
    door(p, 0, 0.3, d / 2 - 0.05);
    window_(p, 1.1, 1.5, d / 2 - 0.05);
    houseExtras(p, tier, w, d, 1.5);
  } else if (tier === 4) {
    box(p, w, 0.9, d, c.base, 0, 0.45, 0); // zócalo de piedra
    box(p, w - 0.1, fh - 0.5, d - 0.1, c.wall, 0, 0.9 + (fh - 0.5) / 2, 0);
    frameBeams(p, w, fh - 0.5, d - 0.1, 0.9, c.trim);
    gable(p, w + 0.5, d + 0.3, 1.5, c.roof, 0.4 + fh, c.wall);
    chimney(p, flag(5) ? -1.2 : 1.2, 0.4 + fh, -0.6, 1.6, c.base);
    door(p, 0, 0.9, d / 2 - 0.02, 0.8, 1.4);
    window_(p, 1.1, 1.7, d / 2 - 0.02);
    houseExtras(p, tier, w, d, 1.7);
  } else if (tier === 5) {
    box(p, w, fh + 0.3, d, c.wall, 0, (fh + 0.3) / 2, 0);
    gable(p, w + 0.5, d + 0.4, 1.6, c.roof, fh + 0.3, c.wall);
    for (const [x, z] of [[-w / 2, d / 2], [w / 2, d / 2], [-w / 2, -d / 2], [w / 2, -d / 2]]) box(p, 0.3, fh + 0.3, 0.3, c.trim, x, (fh + 0.3) / 2, z);
    door(p, 0, 0, d / 2 + 0.02, 0.9, 1.6);
    window_(p, -1.1, 1.3, d / 2 + 0.02, GLASS);
    window_(p, 1.1, 1.3, d / 2 + 0.02, GLASS);
    chimney(p, flag(5) ? 1.2 : -1.2, fh + 0.4, 0, 1.2, c.trim);
    box(p, w + 0.9, 0.3, 0.12, c.trim, 0, 0.15, d / 2 + 0.75); // muro bajo del patio
    houseExtras(p, tier, w, d, 1.3);
  } else if (tier === 6) {
    // Entramado con piso superior volado.
    box(p, w, 1.6, d, c.wall, 0, 0.8, 0);
    box(p, w + 0.3, 1.4, d + 0.3, c.wall, 0, 2.3, 0);
    frameBeams(p, w, 1.6, d, 0, c.trim);
    frameBeams(p, w + 0.3, 1.4, d + 0.3, 1.6, c.trim);
    gable(p, w + 0.7, d + 0.6, 1.9, c.roof, 3.0, c.wall);
    door(p, 0, 0, d / 2 + 0.02, 0.8, 1.4);
    window_(p, -1.1, 2.2, d / 2 + 0.2, GLASS, 0.55, 0.55);
    window_(p, 1.1, 2.2, d / 2 + 0.2, GLASS, 0.55, 0.55);
    chimney(p, flag(5) ? -1.2 : 1.2, 3.0, -0.7, 1.4, c.base);
    houseExtras(p, tier, w, d, 2.2);
  } else if (tier === 7) {
    box(p, w + 0.2, fh * 2 + 0.3, d, c.wall, 0, (fh * 2 + 0.3) / 2, 0);
    gable(p, w + 0.6, d + 0.4, 1.7, c.roof, fh * 2 + 0.3, c.wall);
    box(p, w - 0.2, 0.1, 0.7, c.trim, 0, fh + 0.4, d / 2 + 0.35); // balcón
    box(p, w - 0.2, 0.3, 0.06, c.trim, 0, fh + 0.6, d / 2 + 0.7);
    door(p, 0, 0, d / 2 + 0.02, 0.9, 1.6);
    for (const x of [-1.2, 1.2]) {
      window_(p, x, 1.1, d / 2 + 0.02, GLASS);
      window_(p, x, fh + 1.0, d / 2 + 0.02, GLASS, 0.5, 0.8);
    }
    chimney(p, flag(5) ? 1.3 : -1.3, fh * 2 + 0.5, -0.5, 1.4, c.base);
    houseExtras(p, tier, w, d, 1.1);
  } else if (tier === 8) {
    box(p, w + 0.2, fh * 2 + 0.3, d, c.wall, 0, (fh * 2 + 0.3) / 2, 0);
    for (let i = 0; i < 8; i++) box(p, w + 0.24, 0.05, d + 0.04, '#9a4a35', 0, 0.4 + i * 0.5, 0); // juntas de ladrillo
    gable(p, w + 0.5, d + 0.4, 1.3, c.roof, fh * 2 + 0.3, c.wall);
    door(p, 0, 0, d / 2 + 0.02, 0.9, 1.6);
    for (const x of [-1.2, 1.2]) for (const y of [1.2, fh + 1.1]) window_(p, x, y, d / 2 + 0.02, '#e6d9a8', 0.5, 0.8);
    chimney(p, -1.3, fh * 2 + 0.5, 0, 1.8, '#9a4a35');
    chimney(p, 1.3, fh * 2 + 0.5, 0, 1.6, '#9a4a35');
    houseExtras(p, tier, w, d, 1.2);
  } else if (tier === 9) {
    box(p, w, fh * 2 + 0.4, d, c.wall, 0, (fh * 2 + 0.4) / 2, 0);
    box(p, w + 0.3, 0.25, d + 0.3, c.roof, 0, fh * 2 + 0.55, 0);
    for (const y of [1.2, fh + 1.2]) box(p, w - 0.4, 0.55, 0.08, GLASS, 0, y, d / 2 + 0.03);
    door(p, 0, 0, d / 2 + 0.02, 1.0, 1.7);
    box(p, 0.9, 0.25, 0.7, c.trim, 0, 1.9, d / 2 + 0.4); // marquesina
  } else {
    box(p, w, fh * 2 + 0.5, d, c.wall, 0, (fh * 2 + 0.5) / 2, 0);
    box(p, w + 0.4, 0.2, d + 0.4, c.trim, 0, fh * 2 + 0.6, 0);
    for (const y of [1.2, fh + 1.2]) box(p, w - 0.3, 0.9, 0.08, GLASS, 0, y, d / 2 + 0.03);
    // placas solares inclinadas en la azotea
    for (const x of [-1.0, 0.1, 1.2]) box(p, 0.9, 0.06, 1.4, '#2a4a7a', x, fh * 2 + 0.95, -0.2, 0, -0.45, 0);
    door(p, 0, 0, d / 2 + 0.02, 1.0, 1.8);
    box(p, 1.6, 0.2, 0.9, c.trim, 0, 2.0, d / 2 + 0.45);
  }
}

// Detalles que varían de una casa a otra del mismo nivel (postigos, maceteros, plantas, barril): no tocan la puerta
// ni la huella y dependen sólo de la variante (modelVariant), así que son iguales para todos los jugadores.
function houseExtras(p, tier, w, d, h) {
  const z = d / 2 + 0.06;
  if (tier >= 3 && flag(1)) {
    // Postigos a los lados de la ventana.
    for (const s of [-1, 1]) box(p, 0.16, 0.55, 0.05, tier >= 6 ? '#3a5a8a' : '#6b4a2e', 1.1 + s * 0.42, h, z);
  }
  if (tier >= 4 && tier <= 8 && flag(2)) {
    // Macetero bajo la ventana.
    box(p, 0.7, 0.12, 0.2, '#7a5230', 1.1, h - 0.4, z + 0.1);
    for (const dx of [-0.22, 0, 0.22]) p.add(new THREE.SphereGeometry(0.1, 5, 4), dx ? '#c8423a' : '#e0c25a', mat(1.1 + dx, h - 0.28, z + 0.1));
  }
  if (flag(3)) pot(p, -w / 2 + 0.1, 0, d / 2 + 0.35, '#b0603a', 0.9);
  if (flag(4) && tier <= 9) barrel(p, w / 2 + 0.25, 0, 0.1, '#7a5230', 0.9);
}

// Bloque residencial (ladrillo, hormigón, torre).
function block(p, tier) {
  const c = pal(tier);
  const floors = tier === 8 ? 3 : tier === 9 ? 6 : 10;
  const fh = 1.5;
  const w = tier === 10 ? 3.6 : 4.4;
  const d = tier === 10 ? 3.2 : 3.4;
  box(p, w, floors * fh, d, c.wall, 0, (floors * fh) / 2, 0);
  for (let i = 0; i < floors; i++) {
    const y = i * fh + 0.95;
    for (let k = -1; k <= 1; k++) {
      window_(p, k * (w / 3.3), y, d / 2 + 0.03, tier === 8 ? '#e6d9a8' : GLASS, 0.55, 0.7);
      window_(p, k * (w / 3.3), y, -d / 2 - 0.03, tier === 8 ? '#e6d9a8' : GLASS, 0.55, 0.7);
    }
  }
  box(p, w + 0.3, 0.3, d + 0.3, c.roof, 0, floors * fh + 0.15, 0);
  door(p, 0, 0, d / 2 + 0.03, 1.0, 1.7);
  if (tier === 8) {
    chimney(p, -w / 3, floors * fh + 0.3, 0, 1.2, '#9a4a35');
  } else {
    box(p, 0.8, 0.8, 0.8, c.trim, w / 3, floors * fh + 0.7, 0); // ascensor / cuarto de máquinas
    if (tier === 10) for (const x of [-0.8, 0, 0.8]) box(p, 0.7, 0.05, 1.0, '#2a4a7a', x, floors * fh + 0.45, -0.7, 0, -0.4, 0);
  }
}

// ---- Cabañas, naves y comercios ------------------------------------------------------------------

function hut(p, tier) {
  const c = pal(tier);
  box(p, 3.2, 0.25, 2.8, c.base, 0, 0.12, 0);
  box(p, 3.0, 1.7, 2.6, c.wall, 0, 1.1, 0);
  gable(p, 3.6, 3.0, 1.2, c.roof, 1.95, c.wall);
  door(p, 0, 0.25, 1.3);
  // Cestas y un secadero con frutos.
  for (const x of [-1.9, 1.9]) cyl(p, 0.4, 0.34, 0.5, '#c49a5a', x, 0.25, 1.1, 8);
  for (const x of [-0.7, 0.7]) stick(p, v(x, 0, -1.6), v(x, 1.4, -1.6), 0.05, c.trim, 4);
  box(p, 1.8, 0.08, 0.5, c.trim, 0, 1.3, -1.6);
}

function cabin(p, tier) {
  const c = pal(tier);
  box(p, 3.8, 0.3, 3.0, c.base, 0, 0.15, 0);
  for (let i = 0; i < 6; i++) box(p, 3.5, 0.3, 2.6, i % 2 ? '#8a5a34' : '#7a4f2e', 0, 0.45 + i * 0.3, 0);
  gable(p, 3.9, 3.2, 1.3, c.roof, 2.25, '#8a5a34');
  door(p, 0.6, 0.3, 1.3);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) stick(p, v(2.4, 0.3 + row * 0.5, (i - (2 - row) / 2) * 0.55), v(4.0, 0.3 + row * 0.5, (i - (2 - row) / 2) * 0.55), 0.25, row % 2 ? '#7a5230' : '#6b4a2e', 6);
  box(p, 0.1, 1.0, 0.1, '#9a7446', -2.2, 0.6, 1.2); // hacha clavada
}

// Nave: almacenes, administración, academias, escuelas...
function hall(p, tier, id) {
  const c = pal(tier);
  const w = tier >= 8 ? 5.0 : 4.4;
  const d = tier >= 8 ? 3.4 : 3.2;
  const h = tier >= 8 ? 2.8 : 2.2;
  const civic = ['admin', 'academy', 'school'].includes(id);
  box(p, w + 0.2, 0.3, d + 0.2, c.base, 0, 0.15, 0);
  box(p, w, h, d, c.wall, 0, 0.3 + h / 2, 0);
  if (tier <= 4) frameBeams(p, w, h - 0.2, d, 0.4, c.trim);
  if (tier >= 8 && !civic) {
    // Tejado en diente de sierra.
    for (let i = -1; i <= 1; i++) box(p, w / 3.1, 0.14, d + 0.2, c.roof, i * (w / 3), 0.3 + h + 0.35, 0, 0, 0, -0.35);
    for (let i = -1; i <= 1; i++) box(p, 0.08, 0.7, d + 0.2, GLASS, i * (w / 3) + w / 6.2, 0.3 + h + 0.35, 0);
  } else {
    gable(p, w + 0.4, d + 0.3, civic ? 1.5 : 1.2, c.roof, 0.3 + h, c.wall);
  }
  // Puerta grande y ventanas.
  box(p, 1.5, 1.8, 0.12, DARK, 0, 1.2, d / 2 + 0.02);
  if (tier >= 5) for (const x of [-1.6, 1.6]) window_(p, x, 1.7, d / 2 + 0.02, GLASS, 0.6, 0.7);
  switch (id) {
    case 'stockpile':
      for (const [x, z] of [[2.7, 0.9], [2.9, -0.4], [-2.8, 1.0]]) box(p, 0.7, 0.7, 0.7, '#c49a5a', x, 0.35, z, x);
      stockpileMark(p, tier);
      break;
    case 'gatherer':
      gathererMark(p);
      break;
    case 'woodcutter':
      woodcutterMark(p);
      break;
    case 'admin':
      stick(p, v(-w / 2 + 0.3, 0.3 + h, 0), v(-w / 2 + 0.3, 0.3 + h + 2.4, 0), 0.06, '#8f8a82', 5);
      box(p, 0.9, 0.55, 0.05, '#c8423a', -w / 2 + 0.75, 0.3 + h + 2.1, 0);
      for (const x of [-1.2, -0.4, 0.4, 1.2]) cyl(p, 0.14, 0.14, h - 0.2, '#e8e0cc', x, 0.3 + h / 2, d / 2 + 0.45, 8); // columnas
      box(p, 3.0, 0.2, 0.9, c.trim, 0, 0.3 + h, d / 2 + 0.45);
      break;
    case 'academy':
      cyl(p, 0.9, 1.0, 0.8, c.trim, 0, 0.3 + h + 1.1, 0, 12);
      p.add(new THREE.SphereGeometry(0.85, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#8fb4e8', mat(0, 0.3 + h + 1.5, 0));
      for (const x of [-0.9, 0, 0.9]) cyl(p, 0.12, 0.12, h - 0.2, '#e8e0cc', x, 0.3 + h / 2, d / 2 + 0.4, 8);
      break;
    case 'school':
      box(p, 0.9, 1.2, 0.9, c.trim, w / 2 - 0.7, 0.3 + h + 0.6, 0);
      cone(p, 0.65, 0.7, c.roof, w / 2 - 0.7, 0.3 + h + 1.55, 0, 4);
      break;
    case 'dining_hall':
      diningMark(p, tier);
      break;
    default:
      break;
  }
}

function market(p, tier) {
  const c = pal(tier);
  if (tier <= 5) {
    // Puestos con toldos de colores.
    const cols = ['#c8423a', '#e0c25a', '#3a7aa8', '#5a9a5a'];
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * 2.6 - 1.3;
      const z = Math.floor(i / 2) * 2.4 - 1.2;
      for (const [dx, dz] of [[-0.7, -0.6], [0.7, -0.6], [-0.7, 0.6], [0.7, 0.6]]) stick(p, v(x + dx, 0, z + dz), v(x + dx, 1.8, z + dz), 0.05, c.trim, 4);
      box(p, 1.7, 0.1, 1.5, cols[i], x, 2.0, z, 0, 0.18, 0);
      box(p, 1.3, 0.6, 0.8, '#a0764a', x, 0.3, z);
      cyl(p, 0.22, 0.2, 0.3, '#e8c35a', x - 0.3, 0.75, z, 8);
    }
  } else if (tier <= 7) {
    // Plaza con soportales y una casa de comercio.
    box(p, 5.0, 2.4, 3.0, c.wall, 0, 1.2, -0.6);
    gable(p, 5.4, 3.3, 1.5, c.roof, 2.4, c.wall);
    for (let i = -2; i <= 2; i++) cyl(p, 0.13, 0.13, 2.0, '#e8e0cc', i * 1.0, 1.0, 1.6, 8);
    box(p, 5.0, 0.25, 1.4, c.roof, 0, 2.1, 1.2);
    box(p, 1.2, 1.8, 0.1, DARK, 0, 0.9, 0.92);
    box(p, 0.08, 1.6, 0.08, '#8f8a82', 2.4, 3.2, -0.6);
    box(p, 0.8, 0.5, 0.05, '#c8423a', 2.8, 3.8, -0.6);
  } else {
    // Centro comercial: caja de cristal con rótulo.
    box(p, 5.4, 3.0, 3.6, c.wall, 0, 1.5, 0);
    box(p, 5.0, 1.2, 0.1, GLASS, 0, 1.2, 1.83);
    box(p, 5.6, 0.3, 3.8, c.roof, 0, 3.15, 0);
    box(p, 2.4, 0.5, 0.15, '#e8c35a', 0, 2.6, 1.9);
    door(p, 0, 0, 1.85, 1.6, 1.8);
  }
}

function hospital(p, tier) {
  const c = pal(tier);
  const floors = tier >= 10 ? 3 : 2;
  const w = 4.8;
  const d = 3.4;
  box(p, w, floors * 1.7 + 0.3, d, '#e8ecef', 0, (floors * 1.7 + 0.3) / 2, 0);
  box(p, w + 0.3, 0.25, d + 0.3, c.roof, 0, floors * 1.7 + 0.45, 0);
  for (let i = 0; i < floors; i++) for (const x of [-1.6, -0.55, 0.55, 1.6]) window_(p, x, i * 1.7 + 1.2, d / 2 + 0.03, GLASS, 0.5, 0.7);
  // Cruz roja.
  const y = floors * 1.7 + 0.9;
  box(p, 1.2, 0.35, 0.1, '#c8423a', 0, y, d / 2 + 0.05);
  box(p, 0.35, 1.2, 0.1, '#c8423a', 0, y, d / 2 + 0.05);
  box(p, 1.6, 0.1, 1.0, '#9fb0b8', 0, 1.9, d / 2 + 0.6);
  door(p, 0, 0, d / 2 + 0.03, 1.2, 1.8);
  if (tier >= 10) box(p, 1.4, 0.1, 1.4, '#e8ecef', 2.0, floors * 1.7 + 0.7, -0.4); // helipuerto
}

// ---- Producción y talleres -----------------------------------------------------------------------

// Cantera, pozo de arcilla y minas de cada mena: cada una con su propio aspecto (ver buildingModelsSig.js).
function mine(p, tier, id) {
  if (id === 'quarry') return quarryPit(p, tier);
  if (id === 'clay_pit') return clayPit(p, tier);
  return shaftMine(p, tier, id);
}

function farm(p, tier) {
  const c = pal(Math.min(tier, 6));
  // Surcos de cultivo.
  const col = tier >= 8 ? '#6aa03a' : '#8cae4a';
  box(p, 4.6, 0.12, 3.4, '#6a4a30', 0, 0.06, 0);
  for (let i = -3; i <= 3; i++) box(p, 0.28, tier >= 5 ? 0.55 : 0.4, 3.0, col, i * 0.62, 0.3, 0);
  // Cerca.
  for (const [x, z, w, d] of [[0, 1.8, 4.8, 0.08], [0, -1.8, 4.8, 0.08], [2.4, 0, 0.08, 3.6], [-2.4, 0, 0.08, 3.6]]) box(p, w, 0.6, d, c.trim, x, 0.3, z);
  // Cobertizo.
  box(p, 1.1, 1.0, 0.9, c.wall, 2.9, 0.5, 1.6);
  gable(p, 1.2, 0.9, 0.45, c.roof, 1.0, c.wall, 2.9, 1.6);
  if (tier >= 5) {
    cyl(p, 0.55, 0.55, 2.2, tier >= 8 ? '#b4bcc4' : '#c9a45a', -2.9, 1.1, -1.4, 10);
    cone(p, 0.65, 0.6, tier >= 8 ? '#8a9298' : '#a07a4a', -2.9, 2.5, -1.4, 10);
  }
  if (tier >= 8) {
    box(p, 1.1, 0.8, 0.7, '#c8423a', 2.9, 0.7, -1.0); // tractor
    cyl(p, 0.35, 0.35, 0.2, '#2a2a2e', 3.3, 0.35, -1.0, 8);
  }
  farmMark(p, tier);
  if (tier >= 10) {
    // Brazo de riego y cúpulas de invernadero.
    box(p, 4.4, 0.08, 0.08, '#b4bcc4', 0, 1.4, 0);
    for (const x of [-1.5, 1.5]) p.add(new THREE.SphereGeometry(0.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#9fc8d8', mat(x, 0, 2.6));
  }
}

function well(p, tier, id) {
  if (id === 'water_works') return waterWorks(p, tier);
  const c = pal(Math.min(tier, 6));
  if (tier >= 9) {
    // Depósito elevado y caseta de bombeo.
    for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) stick(p, v(x, 0, z), v(x * 0.8, 3.2, z * 0.8), 0.1, '#8a9298', 5);
    cyl(p, 1.2, 1.2, 1.4, '#9fb0b8', 0, 3.9, 0, 12);
    cone(p, 1.3, 0.6, '#6a7a82', 0, 4.9, 0, 12);
    box(p, 1.4, 1.2, 1.2, '#a8a8a2', 1.9, 0.6, 0.8);
    return;
  }
  cyl(p, 0.95, 1.05, 0.9, '#8f8a82', 0, 0.45, 0, 12);
  p.add(new THREE.TorusGeometry(0.85, 0.12, 5, 14), '#9a958c', mat(0, 0.92, 0, Math.PI / 2, 0, 0));
  cyl(p, 0.8, 0.8, 0.05, '#2a4a66', 0, 0.8, 0, 12);
  stick(p, v(-1.0, 0, 0), v(-1.0, 2.2, 0), 0.07, c.trim, 5);
  stick(p, v(1.0, 0, 0), v(1.0, 2.2, 0), 0.07, c.trim, 5);
  box(p, 2.4, 0.1, 0.1, c.trim, 0, 2.2, 0);
  if (tier >= 5) {
    // Noria con cangilones.
    p.add(new THREE.TorusGeometry(0.9, 0.06, 4, 16), c.trim, mat(0, 1.4, 0.0, 0, 0, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      box(p, 0.22, 0.2, 0.22, '#c4693f', Math.cos(a) * 0.9, 1.4 + Math.sin(a) * 0.9, 0);
    }
  }
}

// Alfarería, panadería, carbonera y horno de ladrillos: cuatro hornos distintos (ver buildingModelsSig.js).
function kiln(p, tier, id) {
  if (id === 'bakery') return bakery(p, tier);
  if (id === 'charcoal_kiln') return charcoalKiln(p, tier);
  if (id === 'brick_kiln') return brickKiln(p, tier);
  const c = pal(Math.min(tier, 8));
  const brick = tier >= 8 ? '#b85a3e' : tier >= 6 ? '#b4846a' : '#b0795a';
  p.add(new THREE.SphereGeometry(1.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), brick, mat(0, 0.3, 0, 0, 0, 0, 1, 0.9, 1));
  box(p, 3.2, 0.3, 3.0, c.base, 0, 0.15, 0);
  box(p, 0.9, 0.7, 0.3, '#1a1410', 0, 0.65, 1.38);
  chimney(p, -0.9, 0.3, -0.6, tier >= 8 ? 4.2 : 2.4, brick, 0.5);
  if (tier >= 6) box(p, 1.4, 1.2, 1.0, c.wall, 1.8, 0.6, -0.6);
  pottery(p, tier);
}

function smelter(p, tier, id) {
  const c = pal(Math.min(tier, 8));
  const low = id === 'bloomery'; // el horno de hierro es bajo y ancho; la fundición, alto
  const clay = low ? (tier >= 8 ? '#8a4a3a' : '#a5694a') : tier >= 8 ? '#9a4a35' : '#b0795a';
  const height = low ? (tier >= 8 ? 3.0 : 1.7) : tier >= 8 ? 4.6 : 2.4;
  box(p, 3.4, 0.3, 3.0, c.base, 0, 0.15, 0);
  cyl(p, low ? 0.7 : 0.8, low ? 1.4 : 1.2, height, clay, 0, 0.3 + height / 2 - 0.15, 0, 10);
  box(p, 0.8, 0.7, 0.3, '#1a1410', 0, 0.7, 1.15);
  cone(p, 0.9, 0.5, '#3a3a3a', 0, 0.3 + height + 0.1, 0, 10);
  if (low) bloomeryMark(p, tier);
  else smelterMark(p, tier);
  // Fuelles y crisol.
  box(p, 1.0, 0.5, 0.6, '#6b4a2e', -1.6, 0.55, 0.8, 0.4);
  cyl(p, 0.3, 0.25, 0.4, '#5a5a60', 1.5, 0.5, 0.9, 8);
  if (tier >= 5) box(p, 1.4, 1.2, 1.0, c.wall, 1.7, 0.6, -1.0);
  if (tier >= 8) {
    stick(p, v(-0.8, 3.0, 0), v(-1.8, 3.0, 0.8), 0.15, '#4a4a52', 6);
    stick(p, v(0.8, 3.4, 0), v(1.8, 3.4, -0.8), 0.15, '#4a4a52', 6);
  }
}

function workshop(p, tier, id) {
  const c = pal(tier);
  const w = tier >= 8 ? 4.4 : 3.8;
  const h = tier >= 8 ? 2.6 : 2.0;
  box(p, w + 0.2, 0.25, 3.2, c.base, 0, 0.12, 0);
  box(p, w, h, 2.8, c.wall, 0, 0.25 + h / 2, 0);
  if (tier >= 8) {
    for (let i = -1; i <= 1; i += 2) box(p, w / 2.1, 0.14, 3.0, c.roof, i * (w / 4), 0.25 + h + 0.3, 0, 0, 0, -0.32);
  } else {
    gable(p, w + 0.4, 3.0, 1.2, c.roof, 0.25 + h, c.wall);
  }
  door(p, 0.8, 0.25, 1.4, 1.0, 1.6);
  window_(p, -1.0, 1.4, 1.42, tier >= 5 ? GLASS : DARK);
  chimney(p, -1.3, 0.25 + h, -0.6, tier >= 8 ? 3.0 : 1.6, tier >= 8 ? '#9a4a35' : c.base, 0.5);
  // Yunque y mesa de trabajo delante.
  box(p, 0.8, 0.5, 0.5, '#4a4a52', -1.6, 0.5, 2.0);
  box(p, 1.2, 0.1, 0.7, c.trim, 1.5, 0.75, 2.1);
  workshopMark(p, tier, id);
}

function mill(p, tier, id) {
  if (id === 'sawmill') return sawmill(p, tier);
  if (id === 'powder_mill') return powderMill(p, tier);
  const c = pal(Math.min(tier, 8));
  millMark(p, tier);
  if (tier >= 8) {
    box(p, 3.6, 3.0, 2.8, '#b85a3e', 0, 1.5, 0);
    box(p, 3.9, 0.25, 3.1, '#4a4a52', 0, 3.1, 0);
    chimney(p, -1.2, 3.2, -0.6, 2.8, '#9a4a35', 0.6);
    door(p, 0, 0, 1.4, 1.2, 1.8);
    return;
  }
  cyl(p, 1.1, 1.5, 3.2, c.wall, 0, 1.6, 0, 8);
  cone(p, 1.5, 1.2, c.roof, 0, 3.8, 0, 8);
  door(p, 0, 0, 1.4, 0.8, 1.4);
  // Aspas del molino.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.3;
    p.add(new THREE.BoxGeometry(0.4, 2.8, 0.06), '#e8dcc0', mat(Math.cos(a) * 1.4, 3.2 + Math.sin(a) * 1.4, 1.55, 0, 0, a + Math.PI / 2));
  }
  cyl(p, 0.15, 0.15, 0.4, c.trim, 0, 3.2, 1.4, 6);
}

function factory(p, tier, id) {
  const c = pal(Math.min(tier, 10));
  const clean = id === 'electronics_factory';
  const brick = clean ? '#e8ecef' : tier >= 10 ? '#cfd8de' : tier >= 9 ? '#a8a8a2' : '#b85a3e';
  box(p, 5.0, 3.0, 3.6, brick, 0, 1.5, 0);
  for (let i = -2; i <= 2; i++) box(p, 0.9, 1.2, 0.08, GLASS, i * 0.95, 1.9, 1.83);
  for (let i = -1; i <= 1; i++) box(p, 1.6, 0.14, 3.7, c.roof, i * 1.7, 3.3, 0, 0, 0, -0.3);
  door(p, 0, 0, 1.85, 1.6, 2.0);
  if (id === 'steel_mill' || id === 'factory' || id === 'armory') {
    if (tier <= 9) {
      chimney(p, -2.0, 3.0, -1.0, 3.4, brick, 0.7);
      chimney(p, -1.0, 3.0, -1.0, 2.6, brick, 0.6);
    } else {
      for (const x of [-1.5, 0, 1.5]) box(p, 1.0, 0.06, 1.8, '#2a4a7a', x, 3.55, -0.4, 0, 0, 0); // paneles
      cyl(p, 0.6, 0.6, 1.6, '#b4bcc4', 2.6, 0.8, -1.2, 10);
    }
  } else if (!clean && id !== 'motor_pool') {
    chimney(p, -2.0, 3.0, -1.0, tier <= 9 ? 2.6 : 1.6, brick, 0.6);
  }
  if (id === 'factory') box(p, 1.0, 1.0, 1.0, '#6a6a70', 2.6, 0.5, 1.4); // contenedor
  factoryMark(p, tier, id);
}

function boiler(p, tier) {
  const c = pal(8);
  box(p, 3.0, 2.2, 2.6, '#b85a3e', 0, 1.1, 0);
  cyl(p, 0.8, 0.8, 2.6, '#4a4a52', 0.6, 1.3, 0, 12);
  chimney(p, -0.9, 2.2, 0, tier >= 9 ? 4.2 : 3.4, '#9a4a35', 0.6);
  box(p, 1.0, 0.9, 0.3, '#1a1410', 0, 0.65, 1.3);
  stick(p, v(1.6, 1.4, 0), v(2.6, 1.4, 1.0), 0.14, '#7a7a82', 6);
  void c;
}

function plant(p, tier) {
  box(p, 4.6, 2.8, 3.4, '#a8a8a2', 0, 1.4, 0);
  box(p, 4.8, 0.25, 3.6, '#6a6a70', 0, 2.95, 0);
  for (const x of [-1.2, 1.2]) {
    // Torres de refrigeración.
    p.add(new THREE.CylinderGeometry(0.7, 1.1, 3.4, 12, 1, true), '#c8ccd0', mat(x, 1.7, -2.4));
    p.add(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 12), '#9aa0a6', mat(x, 3.4, -2.4));
  }
  chimney(p, 2.1, 2.9, 0.4, tier >= 10 ? 3.4 : 4.2, '#8a8a8e', 0.7);
  door(p, 0, 0, 1.75, 1.6, 2.0);
  for (let i = -2; i <= 2; i++) box(p, 0.7, 1.0, 0.08, GLASS, i * 0.85, 1.9, 1.73);
  if (tier >= 10) for (const x of [-1.5, 0, 1.5]) box(p, 1.1, 0.06, 1.6, '#2a4a7a', x, 3.15, 0.3, -0.3);
}

function pole(p, tier) {
  stick(p, v(0, 0, 0), v(0, 4.6, 0), 0.12, tier >= 10 ? '#8a9298' : '#6b4a2e', 6);
  box(p, 1.8, 0.1, 0.1, '#5a3a22', 0, 4.2, 0);
  box(p, 1.2, 0.1, 0.1, '#5a3a22', 0, 3.6, 0);
  for (const x of [-0.8, 0, 0.8]) cyl(p, 0.06, 0.06, 0.2, '#e8e0cc', x, 4.32, 0, 6);
  if (tier >= 10) box(p, 0.9, 0.9, 0.7, '#6a7a82', 0, 0.45, 0.6); // transformador
}

function station(p, tier) {
  const c = pal(Math.min(tier, 10));
  box(p, 6.0, 0.3, 2.2, '#8a8a8a', 0, 0.15, 1.2); // andén
  box(p, 6.4, 0.08, 0.14, '#4a4a52', 0, 0.06, -0.3);
  box(p, 6.4, 0.08, 0.14, '#4a4a52', 0, 0.06, -1.2);
  for (let i = -6; i <= 6; i++) box(p, 0.12, 0.05, 1.3, '#5a3a22', i * 0.5, 0.03, -0.75);
  box(p, 3.0, 2.2, 1.6, c.wall, -1.2, 1.4, 1.5);
  box(p, 3.4, 0.2, 2.0, c.roof, -1.2, 2.6, 1.5);
  box(p, 2.2, 0.15, 1.0, c.roof, 1.9, 2.2, 1.5);
  // Vagón.
  box(p, 3.2, 1.5, 0.95, tier >= 10 ? '#cfd8de' : '#7a4a30', 1.0, 1.1, -0.75);
  for (const x of [0.2, 1.8]) cyl(p, 0.3, 0.3, 0.1, '#2a2a2e', x, 0.3, -0.2, 8);
}

// ---- Militar -----------------------------------------------------------------------------------

function barracks(p, tier) {
  const c = pal(Math.min(tier, 10));
  if (tier <= 6) {
    // Empalizada con un patio y un edificio de instrucción.
    for (let i = -3; i <= 3; i++) {
      stick(p, v(i * 0.7, 0, -2.4), v(i * 0.7, 2.0, -2.4), 0.12, c.trim, 5);
      stick(p, v(-2.4, 0, i * 0.6), v(-2.4, 2.0, i * 0.6), 0.12, c.trim, 5);
      stick(p, v(2.4, 0, i * 0.6), v(2.4, 2.0, i * 0.6), 0.12, c.trim, 5);
    }
    box(p, 3.0, 1.8, 2.0, c.wall, 0, 0.9, -0.8);
    gable(p, 3.4, 2.3, 1.1, c.roof, 1.8, c.wall);
    box(p, 0.9, 0.9, 0.08, '#c8423a', 0, 2.2, 0.35); // estandarte
    // Armas en un soporte.
    for (let i = 0; i < 3; i++) stick(p, v(1.4 + i * 0.25, 0, 1.0), v(1.4 + i * 0.25, 1.9, 1.0), 0.04, '#9a7446', 4);
  } else if (tier <= 8) {
    box(p, 4.8, 2.6, 2.6, '#b85a3e', 0, 1.3, -0.4);
    box(p, 5.0, 0.2, 2.8, '#4a4a52', 0, 2.7, -0.4);
    door(p, 0, 0, 0.92, 1.2, 1.8);
    box(p, 1.0, 1.0, 0.1, '#c8423a', 1.8, 2.0, 0.93);
    box(p, 0.1, 3.4, 0.1, '#8f8a82', -2.2, 1.7, 1.6);
    box(p, 0.9, 0.55, 0.05, '#c8423a', -1.75, 3.1, 1.6);
  } else {
    box(p, 5.0, 2.4, 3.0, '#a8a8a2', 0, 1.2, -0.2);
    box(p, 5.2, 0.25, 3.2, '#6a6a70', 0, 2.5, -0.2);
    for (let i = -2; i <= 2; i++) box(p, 0.7, 0.5, 0.08, GLASS, i * 0.9, 1.6, 1.32);
    cyl(p, 0.05, 0.05, 2.6, '#8f8a82', 2.0, 3.8, -1.2, 5);
    p.add(new THREE.SphereGeometry(0.6, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#c8ccd0', mat(2.0, 5.0, -1.2, Math.PI, 0, 0));
    door(p, 0, 0, 1.33, 1.4, 1.8);
  }
}

// Cada cuartel añade lo suyo (muñecos, dianas, establos); ver barracksMark.
const barracksBase = barracks;
function barracksWithMark(p, tier, id) {
  barracksBase(p, tier, id);
  barracksMark(p, tier, id);
}

function tower(p, tier) {
  const c = pal(Math.min(tier, 10));
  if (tier === 1) {
    for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) stick(p, v(x, 0, z), v(x * 0.9, 2.4, z * 0.9), 0.1, c.trim, 5);
    box(p, 1.9, 0.12, 1.9, '#8a643c', 0, 2.4, 0);
    box(p, 1.9, 0.5, 0.06, '#8a643c', 0, 2.7, 0.95);
    return;
  }
  if (tier === 2) {
    for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) stick(p, v(x, 0, z), v(x * 0.9, 2.6, z * 0.9), 0.12, c.trim, 5);
    box(p, 2.0, 0.14, 2.0, '#8a643c', 0, 2.6, 0);
    box(p, 1.8, 1.0, 1.8, c.wall, 0, 3.2, 0);
    cone(p, 1.5, 0.9, c.roof, 0, 4.2, 0, 4);
    return;
  }
  const stone = tier >= 9 ? '#a8a8a2' : tier >= 6 ? '#b4aea0' : c.base;
  const r = tier >= 6 ? 1.1 : 1.0;
  const h = tier >= 9 ? 5.4 : 4.4;
  cyl(p, r, r + 0.15, h, tier >= 4 && tier < 6 ? '#a07a4a' : stone, 0, h / 2, 0, tier >= 9 ? 8 : 10);
  if (tier >= 4 && tier < 6) cyl(p, r + 0.2, r + 0.3, 1.0, '#8a8478', 0, 0.5, 0, 10);
  cyl(p, r + 0.35, r + 0.3, 0.3, stone, 0, h + 0.15, 0, 10);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    box(p, 0.35, 0.4, 0.35, stone, Math.cos(a) * (r + 0.3), h + 0.5, Math.sin(a) * (r + 0.3));
  }
  box(p, 0.3, 0.6, 0.12, DARK, 0, h * 0.6, r + 0.05);
  if (tier >= 7 && tier < 9) cyl(p, 0.12, 0.16, 1.2, '#2a2a2e', 0.5, h + 0.5, 0.6, 6); // cañón
  if (tier >= 9) {
    box(p, 1.6, 0.7, 1.6, '#6a6a70', 0, h + 0.7, 0);
    for (const x of [-0.5, 0.5]) cyl(p, 0.07, 0.07, 1.2, '#2a2a2e', x, h + 0.7, 0.9, 6);
  }
  if (tier >= 10) {
    p.add(new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#c8ccd0', mat(0, h + 1.5, 0));
    box(p, 0.05, 1.0, 0.05, '#8f8a82', 0, h + 1.2, 0);
  }
}

// Tramo de muro de 3,2 m de largo (el eje largo es x).
function wall(p, tier) {
  const c = pal(Math.min(tier, 10));
  if (tier <= 2) {
    for (let i = -4; i <= 4; i++) stick(p, v(i * 0.4, -0.6, 0), v(i * 0.4, 1.7 + (i % 2) * 0.2, 0), 0.1, '#7a5230', 5);
    box(p, 3.3, 0.1, 0.1, '#5a3a22', 0, 0.9, 0.12);
    return;
  }
  if (tier === 4) {
    box(p, 3.3, 1.7, 0.9, '#7a6a52', 0, 0.25, 0);
    for (let i = -4; i <= 4; i++) stick(p, v(i * 0.4, 1.0, 0), v(i * 0.38, 2.0, 0), 0.09, '#a07a4a', 5);
    return;
  }
  const stone = tier >= 9 ? '#9a9a96' : tier >= 8 ? '#b85a3e' : tier >= 6 ? '#c2bcae' : '#a8a39a';
  const h = tier >= 8 ? 2.8 : tier >= 6 ? 2.6 : 2.0;
  box(p, 3.3, h + 0.6, 0.9, stone, 0, h / 2 - 0.3, 0);
  for (let i = -3; i <= 3; i += 2) box(p, 0.4, 0.4, 1.0, stone, i * 0.45, h + 0.2, 0);
  void c;
}

function gate(p, tier) {
  if (tier <= 5) {
    // Portón de empalizada: dos postes altos con travesaño y paso libre en medio.
    for (const x of [-1.5, 1.5]) stick(p, v(x, 0, 0), v(x, 2.6, 0), 0.18, '#6b4a2e', 6);
    box(p, 3.4, 0.2, 0.25, '#5a3a22', 0, 2.5, 0);
    for (const x of [-1.15, 1.15]) stick(p, v(x, 0, 0), v(x, 1.8, 0), 0.09, '#7a5230', 5);
    return;
  }
  const stone = tier >= 9 ? '#9a9a96' : tier >= 8 ? '#b85a3e' : '#b4aea0';
  const h = 3.4;
  for (const x of [-1.5, 1.5]) {
    box(p, 1.0, h, 1.2, stone, x, h / 2, 0);
    for (let i = -1; i <= 1; i += 2) box(p, 0.35, 0.4, 0.35, stone, x + i * 0.3, h + 0.2, 0);
  }
  box(p, 3.2, 0.7, 1.0, stone, 0, h - 0.35, 0);
  box(p, 1.9, 2.6, 0.18, tier >= 8 ? '#4a4a52' : '#6b4a2e', 0, 1.3, 0.2);
  if (tier >= 10) box(p, 0.6, 0.3, 0.1, '#5ad0a0', 0, 3.0, 0.65);
}

function fort(p, tier) {
  const stone = tier >= 9 ? '#a8a8a2' : tier >= 8 ? '#b85a3e' : tier >= 6 ? '#b4aea0' : '#8a8478';
  if (tier >= 9) {
    // Búnker semienterrado.
    box(p, 5.0, 2.0, 4.0, stone, 0, 1.0, 0);
    box(p, 5.2, 0.3, 4.2, '#6a6a70', 0, 2.1, 0);
    box(p, 3.0, 0.4, 0.1, '#1a1410', 0, 1.4, 2.03);
    box(p, 1.2, 1.4, 0.1, '#3a3a40', 0, 0.7, 2.03);
    return;
  }
  for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
    cyl(p, 0.7, 0.8, 3.0, stone, x, 1.5, z, 8);
    cone(p, 0.9, 0.9, tier >= 6 ? '#a8452d' : '#8a643c', x, 3.4, z, 8);
  }
  box(p, 3.8, 2.0, 0.6, stone, 0, 1.0, -2.2);
  box(p, 3.8, 2.0, 0.6, stone, 0, 1.0, 2.2);
  box(p, 0.6, 2.0, 3.8, stone, -2.2, 1.0, 0);
  box(p, 0.6, 2.0, 3.8, stone, 2.2, 1.0, 0);
  if (tier >= 6) {
    box(p, 1.8, 3.6, 1.8, stone, 0, 1.8, 0);
    cone(p, 1.5, 1.0, '#a8452d', 0, 4.1, 0, 4);
    box(p, 0.08, 1.0, 0.08, '#8f8a82', 0, 5.1, 0);
    box(p, 0.7, 0.45, 0.05, '#c8423a', 0.4, 5.3, 0);
  }
  box(p, 1.0, 1.4, 0.14, DARK, 0, 0.7, 2.5);
}

const STYLES = { cemetery: cemeteryYard, horsestable: horseStable, house, block, hut, cabin, hall, market, hospital, mine, farm, well, kiln, smelter, workshop, mill, factory, boiler, plant, pole, station, barracks: barracksWithMark, tower, wall, gate, fort };

// Dibuja un modelo «gen:estilo:edad:tipo». Devuelve false si el estilo no existe.
// Medio lado aproximado de cada estilo, para colocar la ampliación de los niveles que repiten edad.
const styleSize = (style) => (/^(hut|cabin|mine|well|boiler|pole|wall|gate|tower)$/.test(style) ? 1.7 : 2.4);

export function generate(p, name, variant = 0) {
  const [, style, tier, id, rank] = name.split(':');
  const fn = STYLES[style];
  if (!fn) return false;
  setVariant(variant);
  fn(p, Number(tier) || 1, id);
  if (rank) upgradeKit(p, Number(tier) || 1, Number(rank), styleSize(style));
  setVariant(0);
  return true;
}

export const GENERATED_STYLES = Object.keys(STYLES);
