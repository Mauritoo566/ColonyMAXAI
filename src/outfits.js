// Vestimenta de los colonos: sale de la edad de la aldea y del oficio (y, más adelante, del
// rango militar), no se guarda. Al avanzar de edad todos cambian de ropa solos y cada oficio
// se reconoce por una prenda o un sombrero. Datos puros (sin Three.js): la vista (colonists.js)
// dibuja el resultado.

// Ropa base de cada edad: camisa/túnica, pantalón y, si la hay, prenda común (cinta, sombrero...).
const AGE_WEAR = [
  null,
  { shirt: '#8a5a34', pants: '#5a3a22', note: 'pieles' },
  { shirt: '#a0764a', pants: '#6b4a2e', hat: { kind: 'band', color: '#c8423a' }, note: 'cuero cosido y cinta' },
  { shirt: '#c9a878', pants: '#7a5a3a', hat: { kind: 'band', color: '#c9964a' }, note: 'lino teñido con cinturón' },
  { shirt: '#7a8a5a', pants: '#4a3a2a', hat: { kind: 'cap', color: '#6a5a42' }, note: 'lana y sombrero de fieltro' },
  { shirt: '#d8cdb8', pants: '#8a6a4a', cape: '#8a2a3a', note: 'túnica clara y manto' },
  { shirt: '#6a4a8a', pants: '#4a3a2a', hat: { kind: 'hood', color: '#3a2a1a' }, note: 'jubón y capucha' },
  { shirt: '#2a4a6a', pants: '#3a2a2a', hat: { kind: 'feather', color: '#2a2a2a' }, collar: '#e8e0cc', note: 'ropa de corte con cuello y sombrero' },
  { shirt: '#4a5a7a', pants: '#3a3a40', hat: { kind: 'flat', color: '#4a4a52' }, note: 'mono de obrero y gorra' },
  { shirt: '#c8d0d8', pants: '#3a3a44', note: 'camisa y pantalón modernos' },
  { shirt: '#2a3a4a', pants: '#1f2630', accent: '#5ad0a0', note: 'ropa técnica' },
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

// Soldados: la armadura crece con la edad (y con las mejoras que se pagan, ver el rango).
function soldierWear(age, tier = age) {
  const steel = tier >= 8 ? '#6a7a68' : tier >= 6 ? '#aab2ba' : tier >= 4 ? '#8a9098' : tier >= 3 ? '#a87a3a' : '#7a5a3a';
  return { shirt: steel, hat: { kind: 'helmet', color: tier >= 9 ? '#4a5a48' : steel }, cape: tier >= 5 && tier < 8 ? '#a8452d' : null };
}

import { UNITS_BY_ID } from './sim/units.js';

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
  const trade = c.soldier ? soldierWear(age, c.soldier.tier ?? age) : skill ? tradeWear(age, skill, c.job?.def?.id) : null;
  const out = {
    shirt: trade?.shirt ?? base.shirt,
    pants: base.pants,
    hat: trade?.hat !== undefined ? trade.hat : base.hat ?? null,
    apron: trade?.apron ?? null,
    cape: trade?.cape !== undefined ? trade.cape : base.cape ?? null,
    coat: trade?.coat ?? null,
    collar: base.collar ?? null,
    weapon: c.soldier ? weaponFor(c) : null,
  };
  out.key = `${age}|${skill ?? ''}|${c.soldier ? 's' + (c.soldier.unit ?? '') : ''}`;
  return out;
}

export const wearNote = (age) => AGE_WEAR[Math.min(10, Math.max(1, age))].note;
