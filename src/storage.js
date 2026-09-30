// Claves de localStorage de la partida. Cada cuenta (auth.js) tiene las suyas, así
// que en un mismo navegador cada jugador ve su propio campamento.

let prefix = 'colonymaxai.';

export function setStorageUser(user) {
  prefix = `colonymaxai.u.${user.toLowerCase()}.`;
}

export function storageKey(name) {
  return prefix + name;
}
