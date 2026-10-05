// Vestimenta de los colonos: sale de la edad de la aldea y del oficio (y, más adelante, del
// rango militar), no se guarda. Al avanzar de edad todos cambian de ropa solos y cada oficio
// se reconoce por una prenda o un sombrero. Datos puros (sin Three.js): la vista (colonists.js)
// dibuja el resultado.

// Ropa base de cada edad: camisa/túnica, pantalón y, si la hay, prenda común (cinta, sombrero...).
// Cada edad tiene su propia silueta ("style"): mangas (bare = brazos al aire, short, long), piernas (bare o cubiertas), falda o faldón (hem: largo en metros,
// color y ribete), cinturón, botas (color y altura), manto de piel (pelt), raya central (stripe), hombreras abullonadas (puff) y franjas luminosas (glow).
const AGE_WEAR = [
  null,
  { shirt: '#8a5a34', pants: '#5a3a22', note: 'pieles', style: { sleeves: 'bare', legs: 'bare', hem: { len: 0.24, color: '#5a3a22', trim: '#8a6a3a' }, belt: '#3a2a1a', boots: { color: '#6a4a2a', h: 0.3 }, pelt: '#b58a54' } },
  { shirt: '#a0764a', pants: '#6b4a2e', hat: { kind: 'band', color: '#c8423a' }, note: 'cuero cosido y cinta', style: { sleeves: 'bare', legs: 'long', belt: '#3a2a1a', boots: { color: '#3a2a1a', h: 0.34 }, stripe: '#d8c090' } },
  { shirt: '#c9a878', pants: '#7a5a3a', hat: { kind: 'band', color: '#c9964a' }, note: 'lino teñido con cinturón', style: { sleeves: 'short', legs: 'long', hem: { len: 0.5, color: '#c9a878', trim: '#a8452d' }, belt: '#8a3a2a', boots: { color: '#6a4a2e', h: 0.2 } } },
  { shirt: '#7a8a5a', pants: '#4a3a2a', hat: { kind: 'cap', color: '#6a5a42' }, note: 'lana y sombrero de fieltro', style: { sleeves: 'long', legs: 'long', hem: { len: 0.56, color: '#7a8a5a', trim: '#4a5a3a' }, belt: '#2a1a0a', boots: { color: '#3a2a1a', h: 0.32 }, shortCape: '#6a5a42' } },
  { shirt: '#d8cdb8', pants: '#8a6a4a', cape: '#8a2a3a', note: 'túnica clara y manto', style: { sleeves: 'long', legs: 'long', hem: { len: 0.82, color: '#d8cdb8', trim: '#c9964a' }, belt: '#c9964a', boots: { color: '#6a4a2e', h: 0.1 } } },
  { shirt: '#6a4a8a', pants: '#3a2a3a', hat: { kind: 'hood', color: '#3a2a1a' }, note: 'jubón y capucha', style: { sleeves: 'long', legs: 'long', hem: { len: 0.22, color: '#6a4a8a', trim: '#c9a45a' }, belt: '#c9a45a', boots: { color: '#2a1a0a', h: 0.42 }, puff: '#c9a45a' } },
  { shirt: '#2a4a6a', pants: '#e8e0cc', hat: { kind: 'feather', color: '#2a2a2a' }, collar: '#e8e0cc', note: 'ropa de corte con cuello y sombrero', style: { sleeves: 'long', legs: 'long', hem: { len: 0.52, color: '#2a4a6a', trim: '#c9a45a' }, boots: { color: '#1a1a1a', h: 0.4 }, stripe: '#c9a45a' } },
  { shirt: '#4a5a7a', pants: '#3a4a6a', sleeve: '#a89878', hat: { kind: 'flat', color: '#4a4a52' }, note: 'mono de obrero y gorra', style: { sleeves: 'long', legs: 'long', belt: '#3a3a40', boots: { color: '#3a2a1a', h: 0.3 }, bib: '#4a5a7a' } },
  { shirt: '#c8d0d8', pants: '#3a4a6a', note: 'camisa y pantalón modernos', style: { sleeves: 'long', legs: 'long', belt: '#2a2a2e', boots: { color: '#e8e8e8', h: 0.18 }, stripe: '#a8b2bc' } },
  { shirt: '#2a3a4a', pants: '#1f2630', accent: '#5ad0a0', note: 'ropa técnica', style: { sleeves: 'long', legs: 'long', boots: { color: '#2a3038', h: 0.34 }, glow: '#5ad0a0', belt: '#5ad0a0' } },
];

// Oficio -> prenda distintiva. "skill" es la habilidad del edificio donde trabaja.
function tradeWear(age, skill, jobId) {
  switch (skill) {
    case 'gathering':
    case 'farming':
      return age >= 2 ? { hat: { kind: 'straw', color: '#e0c25a' } } : null;
    case 'woodcutting':
      return { shirt: '#8a3a2a', hat: age >= 8 ? { kind: 'flat', color: '#3a3a40' } : null };
    case 'mining':
      return { hat: age >= 8 ? { kind: 'helmet', color: '#e8c35a' } : { kind: 'cap', color: '#7a6a52' }, shirt: age >= 8 ? '#7a6a52' : undefined };
    case 'hauling':
      return { shirt: '#5a8aa8' };
    case 'building':
      return age >= 8 ? { hat: { kind: 'helmet', color: '#e8c35a' } } : { hat: { kind: 'band', color: '#9a7446' } };
    case 'crafting':
    case 'smelting':
      return age >= 3 ? { apron: '#3a2a22', hat: age >= 8 ? { kind: 'flat', color: '#3a3a40' } : null } : null;
    case 'engineering':
      return age >= 8 ? { hat: { kind: 'helmet', color: '#e8c35a' }, shirt: '#c8603a' } : { apron: '#3a2a22' };
    case 'research':
      return age >= 7 ? { coat: '#e8ecef', hat: age >= 7 && age < 9 ? { kind: 'cap', color: '#2a2a2a' } : null } : null;
    case 'trading':
      return age >= 5 ? { cape: '#c9a45a', hat: age >= 7 ? { kind: 'feather', color: '#7a2a3a' } : null } : null;
    case 'service':
      return age >= 9 ? { coat: '#e8ecef' } : null;
    case 'combat':
      return soldierWear(age);
    default:
      return jobId ? null : null;
  }
}

// Cazadores (casa de cazadores): ropa de monte con capa de piel y gorro.
function hunterWear(age) {
  return { shirt: age >= 4 ? '#5a6a3a' : '#7a5a3a', cape: age >= 4 ? '#6a5a42' : '#8a6a44', hat: age >= 3 ? { kind: 'cap', color: '#4a5a3a' } : { kind: 'band', color: '#8a5a34' } };
}

// Soldados: la armadura crece con la edad (y con las mejoras que se pagan, ver el rango).
function soldierWear(age, tier = age) {
  const steel = tier >= 8 ? '#6a7a68' : tier >= 6 ? '#aab2ba' : tier >= 4 ? '#8a9098' : tier >= 3 ? '#a87a3a' : '#7a5a3a';
  return { shirt: steel, hat: { kind: 'helmet', color: tier >= 9 ? '#4a5a48' : steel }, cape: tier >= 5 && tier < 8 ? '#a8452d' : null };
}

import { UNITS_BY_ID } from './sim/units.js';
import { lifeOf, RENEW_BELOW } from './sim/clothing.js';

// Arma que lleva un soldado según su unidad.
function weaponFor(c) {
  const u = UNITS_BY_ID[c.soldier?.unit];
  if (!u) return null;
  if (u.role === 'infantry') return u.age <= 4 ? 'spear' : u.age <= 7 ? 'sword' : 'rifle';
  if (u.role === 'ranged') return u.age <= 7 ? 'bow' : 'rifle';
  if (u.role === 'cavalry') return 'sword';
  return null;
}

// Descriptor de la ropa: { shirt, pants, hat, apron, cape, coat, collar, key }.
export function outfitFor(age, c) {
  const base = AGE_WEAR[Math.min(10, Math.max(1, age))];
  const skill = c.soldier ? 'combat' : c.job?.def?.skill;
  const hunter = !c.soldier && c.job?.def?.id === 'hunter_lodge';
  const trade = c.soldier ? soldierWear(age, c.soldier.tier ?? age) : hunter ? hunterWear(age) : skill ? tradeWear(age, skill, c.job?.def?.id) : null;
  const out = {
    shirt: trade?.shirt ?? base.shirt,
    pants: base.pants,
    sleeve: trade?.shirt ?? base.sleeve ?? null,
    style: base.style ?? {},
    hat: trade?.hat !== undefined ? trade.hat : base.hat ?? null,
    apron: trade?.apron ?? null,
    cape: trade?.cape !== undefined ? trade.cape : base.cape ?? null,
    coat: trade?.coat ?? null,
    collar: base.collar ?? null,
    weapon: c.soldier ? weaponFor(c) : c.spear ? 'spear' : null,
    // Ropa a punto de romperse: se ve raída (remiendos oscuros y colores deslucidos), para
    // que se note antes de que se rompa de verdad (mismo umbral que cuando va a cambiarla).
    ragged: !!(c.wear && c.wear.left < lifeOf(c.wear.tier) * RENEW_BELOW),
  };
  out.key = `${age}|${skill ?? ''}|${hunter ? 'h' : ''}|${c.soldier ? 's' + (c.soldier.unit ?? '') : ''}|${out.weapon ?? ''}|${out.ragged ? 'r' : ''}`;
  return out;
}

export const wearNote = (age) => AGE_WEAR[Math.min(10, Math.max(1, age))].note;
