// Nombres de los colonos según la edad de la aldea. Un nombre no cambia nunca: los que
// llegan al fundar el campamento llevan nombres de la Edad Primitiva y cada hijo recibe
// uno de la edad en que nace (por eso nadie se llama Santiago en la Edad Primitiva).
// Las listas son de ficción: la Edad Primitiva usa nombres de la naturaleza, la de Piedra
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
    // Edad del Hierro: nombres de pueblos del norte y del oeste.
    f: ['Brigid', 'Eithne', 'Rhona', 'Aoife', 'Sorcha', 'Niamh', 'Medb', 'Ysolt', 'Gwen', 'Ailis', 'Branwen', 'Eira', 'Morna', 'Tegan', 'Una', 'Bera'],
    m: ['Bran', 'Conall', 'Dagda', 'Eoghan', 'Fergus', 'Gawen', 'Ivor', 'Lugh', 'Oisin', 'Rhys', 'Taran', 'Cathal', 'Dylan', 'Eburos', 'Garan', 'Torin'],
  },
  5: {
    // Edad Clásica: nombres de la antigüedad clásica.
    f: ['Livia', 'Julia', 'Claudia', 'Cornelia', 'Flavia', 'Valeria', 'Sabina', 'Octavia', 'Aurelia', 'Lucila', 'Marcia', 'Tulia', 'Fulvia', 'Camila', 'Cecilia', 'Antonia'],
    m: ['Aulo', 'Brenno', 'Caio', 'Decio', 'Evandro', 'Fabio', 'Galo', 'Horacio', 'Lucio', 'Marco', 'Octavio', 'Quinto', 'Rómulo', 'Tito', 'Valerio', 'Cneo'],
  },
  6: {
    // Edad Medieval: nombres de la Edad Media ibérica.
    f: ['Beatriz', 'Constanza', 'Elvira', 'Inés', 'Isabel', 'Leonor', 'Mencía', 'Urraca', 'Teresa', 'Sancha', 'Blanca', 'Berenguela', 'Jimena', 'Violante', 'Catalina', 'Aldonza'],
    m: ['Álvaro', 'Bernardo', 'Diego', 'Fernando', 'Gonzalo', 'Hugo', 'Íñigo', 'Jaime', 'Lope', 'Rodrigo', 'Santiago', 'Sancho', 'Pelayo', 'Ramiro', 'Ordoño', 'Tello'],
  },
  7: {
    // Renacimiento: nombres de ciudades comerciales y cortes.
    f: ['Lucrecia', 'Bianca', 'Isabella', 'Fiammetta', 'Caterina', 'Giulia', 'Ginevra', 'Simonetta', 'Vittoria', 'Margarita', 'Beatriz', 'Dorotea', 'Leonarda', 'Alessandra', 'Clarice', 'Laura'],
    m: ['Leonardo', 'Lorenzo', 'Ludovico', 'Galeazzo', 'Cosme', 'Benvenuto', 'Américo', 'Bartolomé', 'Tomás', 'Alonso', 'Baltasar', 'Cristóbal', 'Francisco', 'Gaspar', 'Julián', 'Nicolás'],
  },
  8: {
    // Edad Industrial: nombres de ciudades fabriles.
    f: ['Victoria', 'Adelaida', 'Eleanor', 'Matilde', 'Josefina', 'Amelia', 'Clara', 'Emilia', 'Florencia', 'Gertrudis', 'Hortensia', 'Ida', 'Julieta', 'Mabel', 'Olivia', 'Rosalía'],
    m: ['Alfredo', 'Augusto', 'Benjamín', 'Carlos', 'Edmundo', 'Federico', 'Gustavo', 'Horacio', 'Isidoro', 'Leopoldo', 'Maximiliano', 'Napoleón', 'Oswaldo', 'Rufino', 'Teodoro', 'Wenceslao'],
  },
  9: {
    // Edad Moderna: nombres de mediados del siglo XX.
    f: ['Alicia', 'Beatriz', 'Carmen', 'Dolores', 'Elena', 'Gloria', 'Irene', 'Julia', 'Lidia', 'Marta', 'Norma', 'Pilar', 'Raquel', 'Silvia', 'Teresa', 'Verónica'],
    m: ['Andrés', 'Bruno', 'César', 'Daniel', 'Emilio', 'Fabián', 'Gabriel', 'Héctor', 'Ignacio', 'Javier', 'Leandro', 'Mario', 'Néstor', 'Óscar', 'Pablo', 'Ramón'],
  },
  10: {
    // Edad Contemporánea: nombres actuales.
    f: ['Abril', 'Bianca', 'Camila', 'Delfina', 'Emma', 'Femke', 'Gala', 'Hana', 'Iris', 'Julieta', 'Kira', 'Luna', 'Mía', 'Noa', 'Olivia', 'Sofía'],
    m: ['Aitor', 'Bastián', 'Dante', 'Eliot', 'Félix', 'Gael', 'Hugo', 'Iker', 'Joel', 'Lucas', 'Mateo', 'Nico', 'Oliver', 'Pol', 'Thiago', 'Yago'],
  },
};

const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

// Un nombre de la edad y el sexo dados que no esté ya en uso ("taken": conjunto de nombres
// de la colonia). Si se acaban, se repite uno con número (Roca II).
export function pickName(age, sex, taken, rand) {
  const pool = (NAME_POOLS[Math.min(10, Math.max(1, age))] ?? NAME_POOLS[1])[sex === 'f' ? 'f' : 'm'];
  const free = pool.filter((n) => !taken.has(n));
  if (free.length) return free[Math.floor(rand() * free.length)];
  for (let k = 1; k < ROMAN.length; k++) {
    const options = pool.filter((n) => !taken.has(n + ROMAN[k]));
    if (options.length) return options[Math.floor(rand() * options.length)] + ROMAN[k];
  }
  return pool[Math.floor(rand() * pool.length)];
}
