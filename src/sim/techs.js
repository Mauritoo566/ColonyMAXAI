// Tecnologías: se investigan con conocimiento (lo produce la Academia, desde la Edad del
// Renacimiento). Una tecnología es un requisito más —además de la edad, el coste y los
// edificios previos— para construir o mejorar lo avanzado. Datos puros.

export const TECHS = [
  { id: 'gunpowder', name: 'Pólvora', age: 7, cost: 30, requires: [], unlocks: 'Molino de pólvora, Arsenal de artillería, Bastión artillado' },
  { id: 'industry', name: 'Industria', age: 7, cost: 50, requires: [], unlocks: 'Acería, Horno de ladrillos, Fábrica, Mina de carbón' },
  { id: 'steam', name: 'Vapor', age: 7, cost: 60, requires: ['industry'], unlocks: 'Caldera de vapor (energía para talleres cercanos)' },
  { id: 'logistics', name: 'Logística', age: 8, cost: 70, requires: [], unlocks: 'Estación de transporte' },
  { id: 'electricity', name: 'Electricidad', age: 8, cost: 100, requires: ['steam'], unlocks: 'Central térmica, postes eléctricos, bomba eléctrica' },
  { id: 'mechanization', name: 'Mecanización', age: 8, cost: 90, requires: ['industry'], unlocks: 'Parque móvil (unidades mecanizadas)' },
  { id: 'medicine', name: 'Medicina', age: 8, cost: 80, requires: [], unlocks: 'Hospital' },
  { id: 'education', name: 'Educación', age: 8, cost: 80, requires: [], unlocks: 'Escuela' },
  { id: 'concrete', name: 'Hormigón', age: 8, cost: 90, requires: ['industry'], unlocks: 'Planta de hormigón' },
  { id: 'electronics', name: 'Electrónica', age: 9, cost: 160, requires: ['electricity'], unlocks: 'Fábrica de electrónica, equipo avanzado' },
  { id: 'automation', name: 'Automatización', age: 9, cost: 200, requires: ['electronics'], unlocks: 'Fábrica automatizada (menos obreros)' },
];

export const TECHS_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t]));
