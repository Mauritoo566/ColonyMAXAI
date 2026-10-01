// Nombres de los colonos según la edad de la aldea. Un nombre no cambia nunca: los que
// llegan al fundar el campamento llevan nombres de la Edad Primitiva y cada hijo recibe
// uno de la edad en que nace (por eso nadie se llama Santiago en la Edad Primitiva).
// Las listas son de ficción: la Edad Primitiva usa nombres de la naturaleza, la Tribal
// sílabas inventadas y las siguientes se acercan a épocas conocidas.

export const NAME_POOLS = {
  1: {
    // Edad Primitiva: se llaman como lo que los rodea.
    f: ['Alba', 'Brisa', 'Espiga', 'Hiedra', 'Luna', 'Niebla', 'Rocío', 'Estrella', 'Arcilla', 'Nube', 'Llama', 'Hoja', 'Savia', 'Bruma', 'Escarcha', 'Ceniza'],
    m: ['Roca', 'Trueno', 'Lobo', 'Sombra', 'Pedernal', 'Zarpa', 'Raíz', 'Cuervo', 'Colmillo', 'Musgo', 'Tizón', 'Roble', 'Halcón', 'Oso', 'Bisonte', 'Peñasco'],
  },
  2: {
    // Edad Tribal: nombres cortos de clan.
    f: ['Kaia', 'Mina', 'Nuri', 'Sira', 'Tala', 'Uma', 'Yara', 'Zuri', 'Lumi', 'Anka', 'Imara', 'Ola', 'Peni', 'Reni', 'Suma', 'Teya'],
    m: ['Aru', 'Keno', 'Tarek', 'Ituri', 'Namu', 'Oruk', 'Ruma', 'Tago', 'Binu', 'Doro', 'Ekon', 'Hami', 'Jaro', 'Koru', 'Maku', 'Nilo'],
  },
  3: {
    // Edad del Bronce: nombres antiguos del Mediterráneo y Oriente Próximo.
    f: ['Adara', 'Belit', 'Dina', 'Ekra', 'Hana', 'Ishta', 'Naia', 'Sela', 'Tamar', 'Zilla', 'Amara', 'Ilana', 'Noa', 'Rut', 'Miriam', 'Yael'],
    m: ['Aram', 'Belo', 'Cadmo', 'Dagan', 'Emar', 'Hiram', 'Ilu', 'Jabal', 'Kiro', 'Lugal', 'Nabu', 'Sargón', 'Tiro', 'Uriel', 'Zadok', 'Ahmose'],
  },
  4: {
    // Edad del Hierro: nombres de la antigüedad clásica.
    f: ['Livia', 'Julia', 'Claudia', 'Cornelia', 'Flavia', 'Valeria', 'Sabina', 'Octavia', 'Aurelia', 'Lucila', 'Marcia', 'Tulia', 'Fulvia', 'Camila', 'Cecilia', 'Antonia'],
    m: ['Aulo', 'Brenno', 'Caio', 'Decio', 'Evandro', 'Fabio', 'Galo', 'Horacio', 'Lucio', 'Marco', 'Octavio', 'Quinto', 'Rómulo', 'Tito', 'Valerio', 'Cneo'],
  },
  5: {
    // Edad Medieval: nombres de la Edad Media ibérica.
    f: ['Beatriz', 'Constanza', 'Elvira', 'Inés', 'Isabel', 'Leonor', 'Mencía', 'Urraca', 'Teresa', 'Sancha', 'Blanca', 'Berenguela', 'Jimena', 'Violante', 'Catalina', 'Aldonza'],
    m: ['Álvaro', 'Bernardo', 'Diego', 'Fernando', 'Gonzalo', 'Hugo', 'Íñigo', 'Jaime', 'Lope', 'Rodrigo', 'Santiago', 'Sancho', 'Pelayo', 'Ramiro', 'Ordoño', 'Tello'],
  },
};

const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

// Un nombre de la edad y el sexo dados que no esté ya en uso ("taken": conjunto de nombres
// de la colonia). Si se acaban, se repite uno con número (Roca II).
export function pickName(age, sex, taken, rand) {
  const pool = (NAME_POOLS[Math.min(5, Math.max(1, age))] ?? NAME_POOLS[1])[sex === 'f' ? 'f' : 'm'];
  const free = pool.filter((n) => !taken.has(n));
  if (free.length) return free[Math.floor(rand() * free.length)];
  for (let k = 1; k < ROMAN.length; k++) {
    const options = pool.filter((n) => !taken.has(n + ROMAN[k]));
    if (options.length) return options[Math.floor(rand() * options.length)] + ROMAN[k];
  }
  return pool[Math.floor(rand() * pool.length)];
}
