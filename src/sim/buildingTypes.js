// Catálogo de edificios: datos puros (sin Three.js ni DOM). Lo usan la simulación
// (sim/colony.js, y por tanto el servidor), la interfaz y las pruebas. El modelo 3D de cada
// nivel se nombra con un texto que dibuja buildingModels.js.
//
// Un tipo tiene niveles. Cada nivel pertenece a una edad (`age`): el primero es el que se
// construye y los siguientes se desbloquean al llegar a su edad (y se pagan uno a uno; las
// viviendas, `autoLevel`: las nuevas salen ya con el nivel de la edad y las viejas se mejoran pagando). Campos de un nivel:
//   age, name, desc, model, upgradeCost     lo básico
//   buildCost                               sólo viviendas: coste de una nueva de ese nivel
//   requires: [{ id, level? }]              edificios terminados que hacen falta para llegar a él
//   tech                                    tecnología investigada que hace falta
//   workers                                 trabajadores necesarios (por defecto, los del tipo)
//   yield / workTime / capacity             rendimiento de recolección o almacén
//   recipe: { in, out, time }               entradas, salidas y segundos por ciclo (1 trabajador)
//   energy                                  energía que consume mientras trabaja
//   power, reach                            energía que produce y a cuántos metros llega
//   housing                                 plazas de vivienda
//   defense, garrison                       puntos de defensa y soldados que aloja
//   trade, expansions, speed, ...           efectos propios del tipo (ver cada uno)
// Campos del tipo: id, category, job, skill, icon, cost, buildTime, footprint, workers,
// requires (para construirlo), tech, deposit (necesita un yacimiento), kind, limitGroup.

const L = (age, name, desc, model, extra = {}) => ({ age, name, desc, model, ...extra });

export const BUILDING_TYPES = [];
const add = (def) => BUILDING_TYPES.push(def);

// ---------------------------------------------------------------------------------------
// Producción de recursos en bruto
// ---------------------------------------------------------------------------------------

add({
  id: 'gatherer',
  category: 'production',
  job: 'Recolección',
  skill: 'gathering',
  icon: 'food',
  cost: { wood: 10 },
  buildTime: 45,
  footprint: 2.6,
  resource: 'food',
  stock: 'food',
  extra: { fiber: 1 }, // además de comida trae fibras (hierbas y cortezas)
  workTime: 10,
  range: 170,
  goingText: 'Va a recolectar',
  workingText: 'Recolectando',
  returningText: 'Lleva comida y fibras al almacén',
  noResourceText: 'No hay bayas ni setas cerca',
  levels: [
    L(1, 'Enramada de recolección', 'Un techo de ramas con cestas. Un colono recoge bayas y setas, y de paso hierbas para fibras.', 'gathererModel1', { yield: 2 }),
    L(2, 'Choza de recolección', 'Choza de barro y paja con un secadero: cada viaje trae más comida.', 'gathererModel2', { yield: 3, upgradeCost: { wood: 20, fiber: 8 }, requires: [{ id: 'quarry' }] }),
    L(4, 'Casa del recolector', 'Cestas de mimbre, cuchillos de bronce y un cobertizo de secado: más comida por viaje.', 'gen:hut:4', { yield: 4, upgradeCost: { wood: 30, fiber: 10, bronze_tools: 2 } }),
    L(7, 'Almacén de frutos', 'Despensa de tablones con ahumadero: la recolección rinde de verdad.', 'gen:hall:7', { yield: 6, upgradeCost: { wood: 40, planks: 12, cloth: 6 } }),
  ],
});

add({
  id: 'woodcutter',
  category: 'production',
  job: 'Tala',
  skill: 'woodcutting',
  icon: 'axe',
  cost: { wood: 8, stone: 2 },
  buildTime: 50,
  footprint: 2.6,
  resource: 'wood',
  stock: 'wood',
  workTime: 14,
  range: 60,
  goingText: 'Va a por leña',
  workingText: 'Juntando leña',
  returningText: 'Lleva madera al almacén',
  noResourceText: 'No quedan árboles ni ramas cerca (los brotes plantados todavía están creciendo)',
  scavenge: { yield: 1, text: 'Juntando ramas caídas', status: 'No quedan árboles cerca: junta ramas caídas (rinde menos)' },
  replantFrom: 2, // desde el nivel 2 el leñador replanta lo que tala (el brote tarda en crecer)
  levels: [
    L(1, 'Zona de leña', 'Un tocón y un montón de leña. Un colono junta palos y ramas caídos del suelo (en la Edad Primitiva no se talan árboles).', 'woodcutterModel1', { yield: 2, noResourceText: 'No quedan palos caídos cerca. Al llegar a la Edad de Piedra, mejorá la zona de leña: se talan árboles y el leñador los replanta solo' }),
    L(2, 'Cabaña del leñador', 'Cabaña de troncos con hachas de piedra pulida (salen de la cantera): ahora sí se talan árboles y cada uno da más madera. El leñador replanta lo que tala: el brote nace en el mismo lugar y tarda un rato en crecer (hasta entonces no se puede talar). Al talar, a veces caen semillas.', 'woodcutterModel2', { yield: 6, upgradeCost: { wood: 25, stone: 5, fiber: 6 }, requires: [{ id: 'quarry' }] }),
    L(4, 'Campamento maderero', 'Hachas de hierro y un tiro de bueyes para arrastrar troncos.', 'gen:cabin:4', { yield: 8, upgradeCost: { wood: 35, stone: 10, iron_tools: 2 } }),
    L(7, 'Gran maderería', 'Sierras de mano, rampas y almacén de troncos: la tala se organiza como una industria.', 'gen:hall:7', { yield: 11, upgradeCost: { wood: 40, planks: 20, iron_tools: 4 } }),
  ],
});

add({
  id: 'quarry',
  category: 'production',
  job: 'Cantería',
  skill: 'mining',
  icon: 'pick',
  cost: { wood: 10 },
  buildTime: 55,
  footprint: 2.8,
  resource: 'stone',
  stock: 'stone',
  workTime: 16,
  range: 200,
  station: true, // el colono trabaja en la propia estructura (no sale a buscar piedras): produce ~"yield" por minuto
  goingText: 'Va a picar piedra',
  workingText: 'Picando piedra',
  returningText: 'Pica piedra en la pedrera',
  noResourceText: 'No hay piedras cerca',
  scavenge: { yield: 1, text: 'Juntando piedras sueltas', status: 'No quedan piedras grandes cerca: junta piedras sueltas (rinde menos)' },
  levels: [
    L(1, 'Pedrera', 'Un montón de piedras y un percutor. Un colono trabaja aquí y saca unas 2 piedras por minuto.', 'quarryModel1', { yield: 2 }),
    L(2, 'Cantera', 'Con palancas y una grúa de troncos se sacan bloques más grandes. Pide un leñador: los troncos y las cuerdas vienen de allí.', 'quarryModel2', { yield: 3, upgradeCost: { wood: 25, stone: 10, fiber: 6 }, requires: [{ id: 'woodcutter' }] }),
    L(4, 'Cantera de cuñas', 'Picos y cuñas de hierro parten bloques enormes.', 'gen:mine:4', { yield: 5, upgradeCost: { wood: 30, stone: 20, iron_tools: 2 } }),
    L(6, 'Cantera con grúa', 'Una grúa de rueda y poleas de hierro levanta sillares enteros.', 'gen:mine:6', { yield: 7, upgradeCost: { wood: 40, cut_stone: 10, iron_tools: 3 } }),
    L(8, 'Cantera mecanizada', 'Cinta transportadora y martillos de vapor: la piedra sale sin parar.', 'gen:mine:8', { yield: 10, upgradeCost: { steel: 8, machinery: 2, planks: 20 }, energy: 1 }),
  ],
});

add({
  id: 'well',
  category: 'production',
  job: 'Acarreo de agua',
  skill: 'hauling',
  icon: 'water',
  cost: { wood: 8, fiber: 4 },
  buildTime: 40,
  footprint: 1.9,
  stock: 'water',
  levels: [
    L(1, 'Recolector de lluvia', 'Pieles tensadas que llenan vasijas cuando llueve (y un poco con el rocío). Se puede beber de él y un aguatero lleva el agua al almacén.', 'wellModel1', { yield: 3, rainOnly: true, capacity: 20 }),
    L(2, 'Pozo simple', 'Un anillo de piedras y un cubo de cuero: da agua siempre, llueva o no. Todos beben de él gratis; el aguatero saca entre 6 y 10 jarras por día para el almacén (la colonia gasta unas 3).', 'wellModel2', { yield: 2, workTime: 60, upgradeCost: { wood: 15, stone: 20, fiber: 5 } }),
    L(5, 'Pozo con noria', 'Una noria de cangilones de cerámica sube el agua sin esfuerzo.', 'gen:well:5', { yield: 4, workTime: 60, upgradeCost: { cut_stone: 10, pottery: 6, wood: 20 } }),
    L(9, 'Bomba eléctrica', 'Una bomba de motor llena el depósito: mucha agua, pero necesita corriente.', 'gen:well:9', { yield: 9, workTime: 60, upgradeCost: { steel: 6, concrete: 10, machinery: 1 }, energy: 1, tech: 'electricity' }),
  ],
});

add({
  id: 'farm',
  category: 'production',
  job: 'Agricultura',
  skill: 'farming',
  icon: 'grain',
  cost: { wood: 14, fiber: 6 },
  buildTime: 55,
  footprint: 3.4,
  kind: 'process',
  requires: [{ id: 'well' }], // los cultivos piden agua cerca
  levels: [
    L(2, 'Campo de cultivo', 'Surcos de grano y un cantero de verduras, con un cercado de ramas. Con lluvia rinde más.', 'gen:farm:2', { recipe: { in: {}, out: { grain: 4, vegetables: 1 }, time: 60 }, rain: true }),
    L(3, 'Campos con arado de bronce', 'Un arado de bronce abre surcos más hondos.', 'gen:farm:3', { recipe: { in: {}, out: { grain: 6, vegetables: 2 }, time: 60 }, rain: true, upgradeCost: { wood: 20, bronze_tools: 2, fiber: 8 } }),
    L(5, 'Granja de arado de hierro', 'Arado de hierro tirado por bueyes y graneros de piedra.', 'gen:farm:5', { recipe: { in: {}, out: { grain: 9, vegetables: 3 }, time: 60 }, rain: true, upgradeCost: { wood: 30, iron_tools: 3, cut_stone: 6 } }),
    L(8, 'Granja mecanizada', 'Segadora de vapor y silos de ladrillo.', 'gen:farm:8', { recipe: { in: {}, out: { grain: 14, vegetables: 5 }, time: 60 }, rain: true, upgradeCost: { machinery: 2, bricks: 12, steel: 4 }, energy: 1 }),
    L(10, 'Granja automatizada', 'Tractores guiados, riego controlado y almacén climatizado.', 'gen:farm:10', { recipe: { in: {}, out: { grain: 22, vegetables: 7 }, time: 60 }, rain: false, upgradeCost: { machinery: 4, electronics: 3, concrete: 12 }, energy: 3, workers: 1 }),
  ],
});

add({
  id: 'clay_pit',
  category: 'production',
  job: 'Alfarero de barro',
  skill: 'mining',
  icon: 'clay',
  cost: { wood: 10, stone: 4 },
  buildTime: 45,
  footprint: 2.6,
  kind: 'process',
  levels: [
    L(2, 'Pozo de arcilla', 'Un hoyo junto al agua donde se saca barro fino para cerámica y adobe.', 'gen:mine:2', { recipe: { in: {}, out: { clay: 3 }, time: 40 } }),
    L(5, 'Arcillar con carros', 'Palas de hierro y carretillas: mucha más arcilla.', 'gen:mine:5', { recipe: { in: {}, out: { clay: 6 }, time: 40 }, upgradeCost: { wood: 20, iron_tools: 2, cut_stone: 4 } }),
    L(8, 'Excavadora de vapor', 'Una pala mecánica de vapor llena vagonetas de arcilla.', 'gen:mine:8', { recipe: { in: {}, out: { clay: 12 }, time: 40 }, upgradeCost: { steel: 6, machinery: 1, planks: 10 }, energy: 1 }),
  ],
});

// Minas: necesitan un yacimiento en el lugar donde se construyen (se ve al elegir el sitio).
const mine = (id, deposit, name, good, age, jobName) =>
  add({
    id,
    category: 'production',
    job: jobName,
    skill: 'mining',
    icon: 'pick',
    cost: { wood: 18, stone: 6 },
    buildTime: 70,
    footprint: 2.8,
    kind: 'process',
    deposit,
    levels: [
      L(age, name, `Una galería apuntalada con troncos: se saca ${good.name}.`, `gen:mine:${age}`, { recipe: { in: {}, out: { [good.id]: good.base }, time: 40 } }),
      L(age + 2, `${name} profunda`, 'Más galerías y mejores herramientas: sale más mineral.', `gen:mine:${age + 2}`, { recipe: { in: {}, out: { [good.id]: good.base * 1.7 }, time: 40 }, upgradeCost: good.up1 }),
      L(8, `${name} industrial`, 'Vagonetas, ventilación y martillos de vapor.', 'gen:mine:8', { recipe: { in: {}, out: { [good.id]: good.base * 3 }, time: 40 }, upgradeCost: good.up2, energy: 1 }),
    ],
  });
mine('copper_mine', 'copper', 'Mina de cobre', { id: 'copper', name: 'cobre', base: 3, up1: { wood: 30, iron_tools: 2, stone: 10 }, up2: { steel: 6, machinery: 2, planks: 10 } }, 3, 'Minero de cobre');
mine('tin_mine', 'tin', 'Mina de estaño', { id: 'tin', name: 'estaño', base: 2, up1: { wood: 30, iron_tools: 2, stone: 10 }, up2: { steel: 6, machinery: 2, planks: 10 } }, 3, 'Minero de estaño');
mine('iron_mine', 'iron_ore', 'Mina de hierro', { id: 'iron_ore', name: 'mineral de hierro', base: 3, up1: { wood: 30, iron_tools: 3, cut_stone: 8 }, up2: { steel: 8, machinery: 2, planks: 10 } }, 4, 'Minero de hierro');
add({
  id: 'coal_mine',
  category: 'production',
  job: 'Minero de carbón',
  skill: 'mining',
  icon: 'pick',
  cost: { steel: 4, planks: 20, machinery: 1 },
  buildTime: 80,
  footprint: 2.8,
  kind: 'process',
  deposit: 'coal',
  tech: 'industry',
  levels: [
    L(8, 'Mina de carbón', 'Una galería profunda con vagonetas: carbón mineral para hornos, vapor y centrales.', 'gen:mine:8', { recipe: { in: {}, out: { coal: 5 }, time: 40 }, energy: 1 }),
    L(9, 'Mina de carbón mecanizada', 'Perforadoras y cinta transportadora: el carbón sale a toneladas.', 'gen:mine:9', { recipe: { in: {}, out: { coal: 9 }, time: 40 }, energy: 2, upgradeCost: { steel: 8, machinery: 2, concrete: 8 } }),
    L(10, 'Mina de carbón automatizada', 'Excavación guiada con sensores: la máxima producción con poca gente.', 'gen:mine:10', { recipe: { in: {}, out: { coal: 14 }, time: 40 }, energy: 3, upgradeCost: { steel: 14, machinery: 4, electronics: 3 } }),
  ],
});

// ---------------------------------------------------------------------------------------
// Almacenes
// ---------------------------------------------------------------------------------------

// capacity: los cinco recursos en bruto; other: cada uno de los demás bienes.
const cap = (m) => ({ food: Math.round(25 * m), water: Math.round(15 * m), wood: Math.round(40 * m), stone: Math.round(30 * m), fiber: Math.round(20 * m) });
add({
  id: 'stockpile',
  category: 'storage',
  icon: 'wood',
  cost: { wood: 12, fiber: 4 },
  buildTime: 40,
  footprint: 2.6,
  levels: [
    L(1, 'Pila de troncos y cestas', 'Troncos apilados, cestas de fibra y pieles para tapar. Amplía lo que cabe en el almacén de la colonia.', 'stockpileModel1', { capacity: cap(1), other: 10 }),
    L(2, 'Granero', 'Una choza sobre pilotes con techo de paja: mantiene la comida seca y guarda mucho más.', 'stockpileModel2', { capacity: { food: 70, water: 35, wood: 90, stone: 70, fiber: 50 }, other: 25, upgradeCost: { wood: 30, stone: 10, fiber: 12 }, requires: [{ id: 'gatherer' }] }),
    L(3, 'Almacén de adobe', 'Paredes de adobe y vasijas grandes: guarda grano y aceite sin que se humedezcan.', 'gen:hall:3', { capacity: cap(4.4), other: 40, upgradeCost: { wood: 30, clay: 20, pottery: 4 }, requires: [{ id: 'pottery' }] }),
    L(4, 'Almacén reforzado', 'Muros de piedra y madera con puertas de hierro: aguanta cualquier cosa.', 'gen:hall:4', { capacity: cap(6.4), other: 60, upgradeCost: { wood: 40, stone: 30, iron_tools: 1 } }),
    L(5, 'Almacén de piedra', 'Una nave de sillares con bóvedas: mucha capacidad y fresca todo el año.', 'gen:hall:5', { capacity: cap(9), other: 90, upgradeCost: { cut_stone: 20, wood: 30, pottery: 6 } }),
    L(6, 'Almacén de tablones', 'Una nave grande de tablones con altillos y poleas.', 'gen:hall:6', { capacity: cap(13), other: 130, upgradeCost: { planks: 24, cut_stone: 12 } }),
    L(7, 'Almacén comercial', 'Lonjas, básculas y estantes: cada bien tiene su lugar.', 'gen:hall:7', { capacity: cap(19), other: 190, upgradeCost: { planks: 30, cloth: 8, coin: 20 } }),
    L(8, 'Depósito industrial', 'Nave de ladrillo con vías de carga para las fábricas.', 'gen:hall:8', { capacity: cap(27), other: 270, upgradeCost: { bricks: 30, steel: 8, planks: 20 } }),
    L(9, 'Almacén de hormigón', 'Estructura de hormigón con muelles de carga y carretillas.', 'gen:hall:9', { capacity: cap(38), other: 380, upgradeCost: { concrete: 30, steel: 12 } }),
    L(10, 'Almacén automatizado', 'Estanterías robotizadas: todo localizado y a mano.', 'gen:hall:10', { capacity: cap(54), other: 540, upgradeCost: { concrete: 36, steel: 16, electronics: 4 }, energy: 2 }),
  ],
});

// ---------------------------------------------------------------------------------------
// Comedor: los colonos comen dentro, sentados y a gusto, con lo que haya en el almacén de la colonia (no hace falta
// llevar nada: está conectado a él). Cada plato les da bienestar; al aire libre, junto al fuego, no.
//   seats      plazas a la vez · mealTime  segundos que dura una comida · mood  bienestar que da cada comida
// ---------------------------------------------------------------------------------------

add({
  id: 'dining_hall',
  category: 'services',
  kind: 'dining',
  icon: 'food',
  cost: { wood: 30, stone: 10, fiber: 8 },
  buildTime: 70,
  footprint: 3.4,
  levels: [
    L(2, 'Comedor de troncos', 'Una sala techada con mesas largas y bancos junto a una cocina de piedra. Come y bebe con lo que hay en el almacén de la colonia: los colonos entran, se sientan y comen a gusto, y eso les da bienestar. Con un comedor en uso se consume sólo ahí (comer o beber fuera queda para emergencias) y el aguatero lleva el agua en jarras hasta el almacén.', 'gen:hall:2', { seats: 6, mealTime: 12, mood: 8 }),
    L(4, 'Comedor de adobe', 'Más mesas, un hogar grande y un toldo para el verano: caben más a la vez y la comida sienta mejor.', 'gen:hall:4', { seats: 10, mealTime: 11, mood: 10, upgradeCost: { wood: 40, stone: 24, iron_tools: 1 } }),
    L(6, 'Comedor de tablones', 'Una nave de tablones con ventanas, cocina con campana y alacenas: se come rápido y bien.', 'gen:hall:6', { seats: 16, mealTime: 10, mood: 12, upgradeCost: { planks: 24, cut_stone: 14 } }),
    L(8, 'Comedor de ladrillo', 'Salón de ladrillo con barra de servicio y cocina industrial.', 'gen:hall:8', { seats: 24, mealTime: 9, mood: 14, upgradeCost: { bricks: 24, planks: 16 } }),
    L(10, 'Comedor moderno', 'Comedor colectivo con cocina central y salón acristalado.', 'gen:hall:10', { seats: 36, mealTime: 8, mood: 16, upgradeCost: { concrete: 20, steel: 8 } }),
  ],
});

// ---------------------------------------------------------------------------------------
// Viviendas: se construyen ya con el aspecto de la edad; las que ya están se mejoran pagando
// ---------------------------------------------------------------------------------------

add({
  id: 'house',
  category: 'housing',
  icon: 'people',
  cost: { wood: 18, fiber: 6 },
  buildTime: 60,
  footprint: 2.5,
  autoLevel: true,
  levels: [
    L(1, 'Choza de ramas', 'Ramas, pieles y hojas sobre un armazón: un techo propio para la familia.', 'houseModel1', { housing: 4 }),
    L(2, 'Choza de barro', 'Paredes de barro y techo de paja, más abrigada. Las chozas de ramas se mejoran a esta casa pagando; las nuevas cuestan más.', 'houseModel2', { housing: 4, buildCost: { wood: 24, stone: 8, fiber: 8 } }),
    L(3, 'Casa de adobe', 'Adobe con vigas vistas y techo de caña: más espacio y más abrigo.', 'gen:house:3', { housing: 4, buildCost: { wood: 20, clay: 12, fiber: 10 } }),
    L(4, 'Casa de madera y piedra', 'Zócalo de piedra y paredes de madera, más firmes ante el viento.', 'gen:house:4', { housing: 4, buildCost: { wood: 28, stone: 18, pottery: 3 } }),
    L(5, 'Casa de mampostería', 'Sillares, tejas y un patio: barrios más ordenados.', 'gen:house:5', { housing: 4, buildCost: { cut_stone: 14, wood: 20, pottery: 6 } }),
    L(6, 'Casa de entramado', 'Entramado de madera con relleno claro y tejado elaborado.', 'gen:house:6', { housing: 4, buildCost: { planks: 16, cut_stone: 10, cloth: 4 } }),
    L(7, 'Casa urbana', 'Dos plantas con comercio en la calle y balcones.', 'gen:house:7', { housing: 4, buildCost: { planks: 20, cut_stone: 14, pottery: 10 } }),
    L(8, 'Casa de ladrillo', 'Ladrillo visto, chimeneas y ventanas grandes.', 'gen:house:8', { housing: 4, buildCost: { bricks: 20, planks: 12, pottery: 6 } }),
    L(9, 'Edificio de hormigón', 'Hormigón y ladrillo, con ventanas corridas.', 'gen:house:9', { housing: 4, buildCost: { concrete: 20, steel: 6, bricks: 8 } }),
    L(10, 'Edificio moderno', 'Fachada de vidrio y hormigón, cocina y baño propios.', 'gen:house:10', { housing: 4, buildCost: { concrete: 26, steel: 10, electronics: 2 } }),
  ],
});

add({
  id: 'apartment',
  category: 'housing',
  icon: 'people',
  cost: { bricks: 40, planks: 24, steel: 4 },
  buildTime: 110,
  footprint: 2.8, // 1 casilla: su modelo cabe en 4 m (antes reservaba 2×2)
  autoLevel: true,
  requires: [{ id: 'water_works' }, { id: 'admin' }], // más gente exige agua canalizada y administración
  levels: [
    L(8, 'Bloque residencial de ladrillo', 'Bloque de tres plantas con escalera común: alojamiento para obreros y técnicos.', 'gen:block:8', { housing: 12, buildCost: { bricks: 40, planks: 24, steel: 4 } }),
    L(9, 'Bloque de hormigón', 'Seis plantas con ascensor de contrapesos: más densidad, más servicios.', 'gen:block:9', { housing: 18, buildCost: { concrete: 44, steel: 14, bricks: 10 }, energy: 1 }),
    L(10, 'Torre residencial', 'Torre alta con redes de agua y energía propias.', 'gen:block:10', { housing: 26, buildCost: { concrete: 60, steel: 24, electronics: 4 }, energy: 3 }),
  ],
});

// Mejorar una vivienda cuesta poco más de la mitad de una nueva de ese nivel (antes subían de nivel gratis).
for (const id of ['house', 'apartment']) {
  const def = BUILDING_TYPES.find((d) => d.id === id);
  def.levels.forEach((lv, i) => {
    if (i === 0 || lv.upgradeCost) return;
    lv.upgradeCost = {};
    for (const [k, n] of Object.entries(lv.buildCost ?? {})) lv.upgradeCost[k] = Math.max(1, Math.round(n * 0.55));
  });
}

// ---------------------------------------------------------------------------------------
// Procesado: talleres con entradas, salidas, trabajadores y (a veces) energía
// ---------------------------------------------------------------------------------------

const workshop = (def) => add({ category: 'processing', kind: 'process', buildTime: 60, footprint: 3, ...def });

workshop({
  id: 'smelter',
  job: 'Fundición',
  skill: 'smelting',
  icon: 'ingot',
  cost: { wood: 24, stone: 24, clay: 10 },
  requires: [{ id: 'copper_mine' }, { id: 'tin_mine' }],
  levels: [
    L(3, 'Fundición de bronce', 'Un horno de arcilla y fuelles funde cobre y estaño en bronce.', 'gen:smelter:3', { recipe: { in: { copper: 2, tin: 1, wood: 1 }, out: { bronze: 2 }, time: 40 } }),
    L(5, 'Horno mejorado', 'Horno de sillares con tiro alto: funde más rápido.', 'gen:smelter:5', { recipe: { in: { copper: 2, tin: 1, wood: 1 }, out: { bronze: 3 }, time: 36 }, upgradeCost: { cut_stone: 14, wood: 20, iron_tools: 1 } }),
    L(8, 'Fundición industrial', 'Hornos de ladrillo refractario con soplado a vapor.', 'gen:smelter:8', { recipe: { in: { copper: 4, tin: 2, coal: 1 }, out: { bronze: 7 }, time: 30 }, upgradeCost: { bricks: 20, steel: 6, machinery: 1 }, energy: 2 }),
  ],
});

workshop({
  id: 'tool_workshop',
  job: 'Artesanía de herramientas',
  skill: 'crafting',
  icon: 'tool',
  cost: { wood: 24, stone: 16, fiber: 8 },
  requires: [{ id: 'smelter' }],
  levels: [
    L(3, 'Taller de herramientas', 'Moldes y yunques: se hacen hachas, picos y arados de bronce.', 'gen:workshop:3', { recipe: { in: { bronze: 1, wood: 1 }, out: { bronze_tools: 1 }, time: 30 } }),
    L(5, 'Taller de herramientas de hierro', 'Con hierro del horno se fabrican herramientas que no se mellan.', 'gen:workshop:5', { recipe: { in: { iron: 1, wood: 1 }, out: { iron_tools: 1 }, time: 30 }, upgradeCost: { cut_stone: 12, wood: 20, iron_tools: 1 }, requires: [{ id: 'bloomery' }] }),
    L(8, 'Fábrica de herramientas', 'Prensas y tornos de vapor: herramientas de serie.', 'gen:workshop:8', { recipe: { in: { steel: 1, planks: 1 }, out: { iron_tools: 3 }, time: 24 }, upgradeCost: { bricks: 16, steel: 6, machinery: 1 }, energy: 2 }),
  ],
});

workshop({
  id: 'pottery',
  job: 'Alfarería',
  skill: 'crafting',
  icon: 'pot',
  cost: { wood: 18, stone: 10, clay: 8 },
  requires: [{ id: 'clay_pit' }],
  levels: [
    L(3, 'Alfarería', 'Torno de pie y horno de leña: vasijas, tinajas y tejas.', 'gen:kiln:3', { recipe: { in: { clay: 2, wood: 1 }, out: { pottery: 2 }, time: 36 } }),
    L(6, 'Horno cerámico', 'Horno de ladrillo de varias cámaras: cerámica vidriada.', 'gen:kiln:6', { recipe: { in: { clay: 2, wood: 1 }, out: { pottery: 4 }, time: 32 }, upgradeCost: { cut_stone: 14, wood: 20 } }),
  ],
});

workshop({
  id: 'bakery',
  job: 'Panadería',
  skill: 'crafting',
  icon: 'bread',
  cost: { wood: 20, stone: 14, clay: 6 },
  requires: [{ id: 'farm' }],
  levels: [
    L(3, 'Horno de pan', 'Un horno de barro: el grano molido a mano se cuece en panes.', 'gen:kiln:3', { recipe: { in: { grain: 3, wood: 1 }, out: { bread: 3 }, time: 40 } }),
    L(6, 'Panadería', 'Con harina del molino, cada hornada da el doble de pan.', 'gen:kiln:6', { recipe: { in: { flour: 3, wood: 1 }, out: { bread: 8 }, time: 40 }, upgradeCost: { cut_stone: 10, wood: 20, pottery: 4 }, requires: [{ id: 'mill' }] }),
    L(8, 'Panadería industrial', 'Amasadoras y hornos continuos: pan para toda la ciudad.', 'gen:kiln:8', { recipe: { in: { flour: 6, coal: 1 }, out: { bread: 20 }, time: 36 }, upgradeCost: { bricks: 16, steel: 4, machinery: 1 }, energy: 1 }),
  ],
});

workshop({
  id: 'charcoal_kiln',
  job: 'Carbonero',
  skill: 'crafting',
  icon: 'charcoal',
  cost: { wood: 22, stone: 12, clay: 6 },
  levels: [
    L(4, 'Carbonera', 'Un montículo de troncos cubierto de tierra que arde sin llama: carbón vegetal.', 'gen:kiln:4', { recipe: { in: { wood: 4 }, out: { charcoal: 2 }, time: 44 } }),
    L(6, 'Carbonera de hornos', 'Cámaras cerradas que aprovechan casi toda la leña.', 'gen:kiln:6', { recipe: { in: { wood: 4 }, out: { charcoal: 3 }, time: 40 }, upgradeCost: { cut_stone: 10, wood: 20, pottery: 4 } }),
  ],
});

workshop({
  id: 'bloomery',
  job: 'Fundición de hierro',
  skill: 'smelting',
  icon: 'ingot',
  cost: { wood: 26, stone: 30, clay: 12 },
  requires: [{ id: 'iron_mine' }, { id: 'charcoal_kiln' }],
  levels: [
    L(4, 'Horno de hierro', 'Un horno alto de arcilla y carbón vegetal: del mineral sale una masa de hierro.', 'gen:smelter:4', { recipe: { in: { iron_ore: 2, charcoal: 1 }, out: { iron: 1 }, time: 44 } }),
    L(6, 'Horno de fundición', 'Con fuelle hidráulico, más temperatura y más hierro.', 'gen:smelter:6', { recipe: { in: { iron_ore: 2, charcoal: 1 }, out: { iron: 2 }, time: 40 }, upgradeCost: { cut_stone: 16, wood: 20, iron_tools: 2 } }),
    L(8, 'Alto horno', 'Alto horno de ladrillo con soplado de vapor y carbón mineral.', 'gen:smelter:8', { recipe: { in: { iron_ore: 4, coal: 1 }, out: { iron: 6 }, time: 36 }, upgradeCost: { bricks: 24, steel: 8, machinery: 1 }, energy: 2 }),
  ],
});

workshop({
  id: 'blacksmith',
  job: 'Herrería',
  skill: 'crafting',
  icon: 'anvil',
  cost: { wood: 24, stone: 24, bronze_tools: 2 },
  requires: [{ id: 'bloomery' }],
  levels: [
    L(4, 'Herrería', 'Fragua y yunque: se forjan herramientas y piezas de hierro.', 'gen:workshop:4', { recipe: { in: { iron: 1, wood: 1 }, out: { iron_tools: 2 }, time: 36 } }),
    L(6, 'Herrería avanzada', 'Martinete hidráulico y templado: herramientas de calidad.', 'gen:workshop:6', { recipe: { in: { iron: 1, charcoal: 1 }, out: { iron_tools: 4 }, time: 34 }, upgradeCost: { cut_stone: 14, planks: 10, iron_tools: 2 } }),
    L(8, 'Forja industrial', 'Martillos de vapor y troqueles: forja de serie.', 'gen:workshop:8', { recipe: { in: { steel: 1, coal: 1 }, out: { iron_tools: 8 }, time: 30 }, upgradeCost: { bricks: 16, steel: 6, machinery: 1 }, energy: 2 }),
  ],
});

workshop({
  id: 'stonecutter',
  job: 'Cantería de sillares',
  skill: 'crafting',
  icon: 'block',
  cost: { wood: 24, stone: 30, iron_tools: 2 },
  levels: [
    L(5, 'Taller de cantería', 'Sierras y cinceles de hierro labran sillares: la piedra se vuelve construcción.', 'gen:workshop:5', { recipe: { in: { stone: 3 }, out: { cut_stone: 2 }, time: 36 } }),
    L(8, 'Aserradero de piedra', 'Sierras de vapor cortan bloques perfectos.', 'gen:workshop:8', { recipe: { in: { stone: 6 }, out: { cut_stone: 6 }, time: 30 }, upgradeCost: { steel: 6, machinery: 1, planks: 12 }, energy: 1 }),
  ],
});

workshop({
  id: 'sawmill',
  job: 'Aserradero',
  skill: 'crafting',
  icon: 'plank',
  cost: { wood: 30, cut_stone: 8, iron_tools: 2 },
  levels: [
    L(6, 'Aserradero', 'Una sierra de agua corta troncos en tablones.', 'gen:mill:6', { recipe: { in: { wood: 3 }, out: { planks: 2 }, time: 30 } }),
    L(8, 'Aserradero de vapor', 'Sierras circulares movidas por vapor: tablones de sobra.', 'gen:mill:8', { recipe: { in: { wood: 6 }, out: { planks: 6 }, time: 26 }, upgradeCost: { steel: 6, machinery: 1, bricks: 10 }, energy: 2 }),
  ],
});

workshop({
  id: 'mill',
  job: 'Molino',
  skill: 'crafting',
  icon: 'flour',
  cost: { wood: 30, cut_stone: 10, iron_tools: 2 },
  requires: [{ id: 'farm' }],
  levels: [
    L(6, 'Molino', 'Una rueda de agua o de viento y dos muelas: del grano sale harina.', 'gen:mill:6', { recipe: { in: { grain: 3 }, out: { flour: 3 }, time: 30 } }),
    L(8, 'Molino de vapor', 'Muelas de acero y cernido mecánico: harina a gran escala.', 'gen:mill:8', { recipe: { in: { grain: 8 }, out: { flour: 8 }, time: 26 }, upgradeCost: { steel: 5, machinery: 1, bricks: 10 }, energy: 1 }),
  ],
});

workshop({
  id: 'textile',
  job: 'Tejeduría',
  skill: 'crafting',
  icon: 'cloth',
  cost: { wood: 30, planks: 10, fiber: 12 },
  requires: [{ id: 'sawmill' }],
  levels: [
    L(6, 'Taller textil', 'Telares de madera: las fibras se hilan y tejen en tela.', 'gen:workshop:6', { recipe: { in: { fiber: 4 }, out: { cloth: 2 }, time: 32 } }),
    L(8, 'Fábrica textil', 'Telares mecánicos movidos por vapor.', 'gen:workshop:8', { recipe: { in: { fiber: 10 }, out: { cloth: 8 }, time: 26 }, upgradeCost: { steel: 5, machinery: 1, bricks: 10 }, energy: 2 }),
  ],
});

workshop({
  id: 'precision_shop',
  job: 'Mecánico de precisión',
  skill: 'engineering',
  icon: 'gear',
  cost: { planks: 20, cut_stone: 12, iron_tools: 3 },
  requires: [{ id: 'blacksmith', level: 2 }],
  levels: [
    L(7, 'Taller de precisión', 'Tornos de pedal y lentes: relojes, brújulas e instrumentos.', 'gen:workshop:7', { recipe: { in: { iron: 1, planks: 1 }, out: { instruments: 1 }, time: 40 } }),
    L(9, 'Taller de ingeniería', 'Máquinas-herramienta eléctricas: instrumentos de gran exactitud.', 'gen:workshop:9', { recipe: { in: { steel: 1, planks: 1 }, out: { instruments: 4 }, time: 36 }, upgradeCost: { steel: 10, machinery: 2, bricks: 14 }, energy: 2 }),
  ],
});

workshop({
  id: 'powder_mill',
  job: 'Pólvora',
  footprint: 2.8, // 1 casilla: su modelo cabe en 4 m (antes reservaba 2×2)
  skill: 'crafting',
  icon: 'powder',
  cost: { planks: 16, cut_stone: 16, iron_tools: 2 },
  tech: 'gunpowder',
  levels: [
    L(7, 'Molino de pólvora', 'Un molino aislado donde se mezcla carbón y salitre: pólvora para artillería y fortificaciones.', 'gen:mill:7', { recipe: { in: { charcoal: 2, stone: 2 }, out: { powder: 2 }, time: 40 } }),
    L(9, 'Fábrica de explosivos', 'Cámaras separadas y control de humedad: producción segura.', 'gen:mill:9', { recipe: { in: { coal: 1, stone: 2 }, out: { powder: 8 }, time: 34 }, upgradeCost: { concrete: 12, steel: 6, machinery: 1 }, energy: 1 }),
  ],
});

workshop({
  id: 'steel_mill',
  job: 'Acería',
  skill: 'smelting',
  icon: 'beam',
  cost: { bricks: 30, iron_tools: 4, planks: 20 },
  tech: 'industry',
  requires: [{ id: 'bloomery', level: 3 }],
  levels: [
    L(8, 'Acería', 'Un convertidor transforma el hierro en acero con carbón mineral.', 'gen:factory:8', { recipe: { in: { iron: 2, coal: 1 }, out: { steel: 2 }, time: 40 }, energy: 2 }),
    L(10, 'Acería eléctrica', 'Hornos de arco: acero limpio y rápido.', 'gen:factory:10', { recipe: { in: { iron: 3, coal: 1 }, out: { steel: 5 }, time: 34 }, upgradeCost: { steel: 16, machinery: 3, concrete: 14 }, energy: 5 }),
  ],
});

workshop({
  id: 'brick_kiln',
  job: 'Ladrillería',
  skill: 'crafting',
  icon: 'brick',
  cost: { cut_stone: 20, wood: 30, iron_tools: 2 },
  tech: 'industry',
  requires: [{ id: 'clay_pit' }],
  levels: [
    L(8, 'Horno de ladrillos', 'Un horno continuo cuece ladrillos de arcilla con carbón.', 'gen:kiln:8', { recipe: { in: { clay: 3, coal: 1 }, out: { bricks: 4 }, time: 32 }, energy: 1 }),
    L(9, 'Ladrillería mecanizada', 'Extrusoras y hornos de túnel.', 'gen:kiln:9', { recipe: { in: { clay: 6, coal: 1 }, out: { bricks: 10 }, time: 28 }, upgradeCost: { steel: 6, machinery: 1, concrete: 8 }, energy: 2 }),
  ],
});

workshop({
  id: 'factory',
  job: 'Fábrica',
  skill: 'engineering',
  icon: 'gear',
  cost: { bricks: 40, steel: 8, planks: 20 },
  tech: 'industry',
  workers: 2,
  requires: [{ id: 'steel_mill' }],
  levels: [
    L(8, 'Fábrica de maquinaria', 'Cadena de montaje: de acero y tablones sale maquinaria.', 'gen:factory:8', { recipe: { in: { steel: 2, planks: 1 }, out: { machinery: 1 }, time: 44 }, energy: 4 }),
    L(10, 'Fábrica automatizada', 'Líneas robotizadas: más producción con menos obreros.', 'gen:factory:10', { recipe: { in: { steel: 2, planks: 1 }, out: { machinery: 3 }, time: 38 }, upgradeCost: { steel: 20, machinery: 4, electronics: 4 }, energy: 7, workers: 1, tech: 'automation' }),
  ],
});

workshop({
  id: 'concrete_plant',
  job: 'Hormigón',
  skill: 'engineering',
  icon: 'block',
  cost: { bricks: 30, steel: 8, machinery: 1 },
  tech: 'concrete',
  levels: [
    L(9, 'Planta de hormigón', 'Hormigoneras: piedra, arcilla y cemento en bloques resistentes.', 'gen:factory:9', { recipe: { in: { stone: 4, clay: 2, coal: 1 }, out: { concrete: 4 }, time: 36 }, energy: 3 }),
    L(10, 'Planta de hormigón armado', 'Con armaduras de acero: edificios más altos.', 'gen:factory:10', { recipe: { in: { stone: 6, clay: 3, coal: 1 }, out: { concrete: 9 }, time: 32 }, upgradeCost: { steel: 14, machinery: 3, concrete: 10 }, energy: 4 }),
  ],
});

workshop({
  id: 'electronics_factory',
  job: 'Electrónica',
  footprint: 2.8, // 1 casilla: su modelo cabe en 4 m (antes reservaba 2×2)
  skill: 'engineering',
  icon: 'chip',
  cost: { concrete: 30, steel: 16, machinery: 4 },
  tech: 'electronics',
  workers: 2,
  levels: [
    L(10, 'Fábrica de electrónica', 'Salas limpias donde se montan circuitos y sensores.', 'gen:factory:10', { recipe: { in: { copper: 2, steel: 1 }, out: { electronics: 1 }, time: 44 }, energy: 6 }),
  ],
});

// ---------------------------------------------------------------------------------------
// Infraestructura y energía
// ---------------------------------------------------------------------------------------

add({
  id: 'water_works',
  category: 'infrastructure',
  kind: 'process',
  job: 'Obras hidráulicas',
  skill: 'engineering',
  icon: 'water',
  cost: { cut_stone: 30, wood: 30, pottery: 8 },
  buildTime: 90,
  footprint: 3.2,
  requires: [{ id: 'well', level: 3 }],
  levels: [
    L(5, 'Acueducto', 'Arcos de sillares y un canal llevan agua desde lejos hasta una fuente de la aldea.', 'gen:well:5', { recipe: { in: {}, out: { water: 12 }, time: 60 }, population: 40 }),
    L(9, 'Red de agua potable', 'Tuberías y depósito elevado: agua limpia para toda la ciudad.', 'gen:well:9', { recipe: { in: {}, out: { water: 40 }, time: 60 }, population: 140, upgradeCost: { steel: 8, concrete: 14, machinery: 1 }, energy: 1 }),
  ],
});

add({
  id: 'boiler',
  category: 'infrastructure',
  kind: 'power',
  job: 'Fogonero',
  skill: 'engineering',
  icon: 'bolt',
  cost: { bricks: 20, iron_tools: 4, planks: 12 },
  buildTime: 80,
  footprint: 2.8,
  tech: 'steam',
  levels: [
    L(8, 'Caldera de vapor', 'Quema carbón para mover correas y máquinas de los talleres que la rodean.', 'gen:boiler:8', { recipe: { in: { coal: 1 }, out: {}, time: 40 }, power: 6, reach: 22 }),
    L(9, 'Caldera de alta presión', 'Más presión y más caballos con el mismo carbón.', 'gen:boiler:9', { recipe: { in: { coal: 1 }, out: {}, time: 40 }, power: 10, reach: 26, upgradeCost: { steel: 6, machinery: 1, bricks: 10 } }),
  ],
});

add({
  id: 'power_plant',
  category: 'infrastructure',
  kind: 'power',
  job: 'Operador de central',
  skill: 'engineering',
  icon: 'bolt',
  cost: { concrete: 30, steel: 12, machinery: 3 },
  buildTime: 120,
  footprint: 3.6,
  tech: 'electricity',
  levels: [
    L(9, 'Central térmica', 'Turbinas de vapor y generadores: electricidad para la red.', 'gen:plant:9', { recipe: { in: { coal: 1 }, out: {}, time: 30 }, power: 24, reach: 34 }),
    L(10, 'Central eficiente', 'Ciclo combinado y control digital: más energía por tonelada.', 'gen:plant:10', { recipe: { in: { coal: 1 }, out: {}, time: 30 }, power: 44, reach: 38, upgradeCost: { steel: 16, machinery: 3, electronics: 3 } }),
  ],
});

add({
  id: 'pole',
  category: 'infrastructure',
  kind: 'node',
  icon: 'bolt',
  cost: { wood: 8, copper: 4, steel: 1 },
  buildTime: 20,
  footprint: 0.8,
  tech: 'electricity',
  levels: [
    L(9, 'Poste eléctrico', 'Un poste con cables: extiende la red eléctrica.', 'gen:pole:9', { reach: 30 }),
    L(10, 'Subestación', 'Transformadores y conmutadores: la red llega más lejos.', 'gen:pole:10', { reach: 46, upgradeCost: { steel: 4, copper: 6, electronics: 1 } }),
  ],
});

add({
  id: 'station',
  category: 'infrastructure',
  kind: 'drop',
  icon: 'train',
  cost: { bricks: 24, planks: 16, steel: 6 },
  buildTime: 90,
  footprint: 3.4,
  tech: 'logistics',
  levels: [
    L(8, 'Estación de transporte', 'Vagones sobre raíles: los trabajadores entregan aquí sin cruzar la aldea y la estación guarda mercancía.', 'gen:station:8', { capacity: { food: 120, water: 60, wood: 160, stone: 120, fiber: 80 }, other: 80, speed: 1.6 }),
    L(10, 'Centro logístico', 'Naves automatizadas y muelles: entrega rápida y mucha capacidad.', 'gen:station:10', { capacity: { food: 360, water: 180, wood: 480, stone: 360, fiber: 240 }, other: 260, speed: 2.2, upgradeCost: { concrete: 24, steel: 12, electronics: 3 }, energy: 2 }),
  ],
});

// ---------------------------------------------------------------------------------------
// Servicios y economía
// ---------------------------------------------------------------------------------------

add({
  id: 'market',
  category: 'services',
  kind: 'market',
  job: 'Comercio',
  skill: 'trading',
  icon: 'coin',
  cost: { cut_stone: 16, wood: 30, pottery: 6 },
  buildTime: 80,
  footprint: 3.4,
  levels: [
    L(5, 'Mercado', 'Puestos bajo toldos: se venden excedentes por monedas y se compra lo que falta (cupo diario de comercio).', 'gen:market:5', { trade: 60 }),
    L(6, 'Mercado cubierto', 'Soportales y una plaza: más cupo diario.', 'gen:market:6', { trade: 120, upgradeCost: { planks: 20, cut_stone: 14 } }),
    L(7, 'Casa de comercio', 'Gremios, balanzas y contratos: el comercio se organiza.', 'gen:market:7', { trade: 220, upgradeCost: { planks: 26, cloth: 8, coin: 30 } }),
    L(9, 'Centro comercial', 'Galerías cubiertas con almacenes y oficinas.', 'gen:market:9', { trade: 420, upgradeCost: { concrete: 24, steel: 8, coin: 60 }, energy: 2 }),
  ],
});

add({
  id: 'admin',
  category: 'services',
  kind: 'admin',
  job: 'Administración',
  skill: 'trading',
  icon: 'shield',
  cost: { cut_stone: 20, wood: 40, pottery: 6 },
  buildTime: 90,
  footprint: 3.4,
  levels: [
    L(5, 'Casa del consejo', 'Donde se reúne el consejo de la aldea: permite ampliar el territorio y organiza a unos 40 colonos.', 'gen:hall:5', { expansions: 2, population: 40 }),
    L(7, 'Ayuntamiento', 'Sala de plenos y archivo: más ampliaciones de territorio y servicios para 80 colonos.', 'gen:hall:7', { expansions: 4, population: 80, upgradeCost: { planks: 30, cut_stone: 20, cloth: 10 } }),
    L(9, 'Edificio municipal', 'Oficinas, registro y centro de gestión: organiza a 120 colonos y el máximo de territorio.', 'gen:hall:9', { expansions: 6, population: 130, upgradeCost: { concrete: 24, steel: 8, bricks: 16 }, energy: 1 }),
  ],
});

add({
  id: 'academy',
  category: 'services',
  kind: 'research',
  job: 'Investigación',
  skill: 'research',
  icon: 'book',
  cost: { planks: 24, cut_stone: 20, cloth: 8 },
  buildTime: 100,
  footprint: 3.4,
  requires: [{ id: 'admin' }],
  levels: [
    L(7, 'Academia', 'Sabios y libros: de tablones y tela salen conocimientos para investigar.', 'gen:hall:7', { recipe: { in: { planks: 1, cloth: 1 }, out: { knowledge: 3 }, time: 50 } }),
    L(9, 'Universidad', 'Aulas, laboratorios y biblioteca.', 'gen:hall:9', { recipe: { in: { planks: 1, instruments: 1 }, out: { knowledge: 9 }, time: 48 }, upgradeCost: { bricks: 24, steel: 6, instruments: 6 }, energy: 1, workers: 2 }),
    L(10, 'Centro de investigación', 'Laboratorios y ordenadores: investigación avanzada.', 'gen:hall:10', { recipe: { in: { instruments: 1, electronics: 1 }, out: { knowledge: 24 }, time: 44 }, upgradeCost: { concrete: 26, steel: 12, electronics: 4 }, energy: 4, workers: 2 }),
  ],
});

add({
  id: 'hospital',
  category: 'services',
  kind: 'service',
  job: 'Medicina',
  skill: 'service',
  icon: 'health',
  cost: { bricks: 30, concrete: 10, steel: 6 },
  buildTime: 110,
  footprint: 3.6,
  tech: 'medicine',
  requires: [{ id: 'water_works', level: 2 }],
  levels: [
    L(9, 'Hospital', 'Camas, médicos y medicinas: los heridos y enfermos se recuperan mucho antes.', 'gen:hospital:9', { regen: 2.2, population: 60, energy: 2 }),
    L(10, 'Hospital avanzado', 'Quirófanos y diagnóstico: recuperación rápida para toda la ciudad.', 'gen:hospital:10', { regen: 3.6, population: 130, upgradeCost: { concrete: 24, steel: 10, electronics: 3 }, energy: 3 }),
  ],
});

add({
  id: 'school',
  category: 'services',
  kind: 'service',
  job: 'Enseñanza',
  skill: 'service',
  icon: 'book',
  cost: { bricks: 26, concrete: 8, instruments: 4 },
  buildTime: 100,
  footprint: 3.4,
  tech: 'education',
  levels: [
    L(9, 'Escuela', 'Aulas y un maestro: los colonos aprenden oficios y suben sus habilidades.', 'gen:hall:9', { teach: 1, skillCap: 7, population: 60, energy: 1 }),
    L(10, 'Centro educativo', 'Talleres y laboratorios de aprendizaje: formación avanzada.', 'gen:hall:10', { teach: 2, skillCap: 10, population: 130, upgradeCost: { concrete: 22, steel: 8, electronics: 2 }, energy: 2 }),
  ],
});

// ---------------------------------------------------------------------------------------
// Ejército y defensas
// ---------------------------------------------------------------------------------------

const military = (def) => add({ category: 'military', kind: 'military', workers: 0, buildTime: 90, footprint: 3.4, ...def });

military({
  id: 'barracks',
  icon: 'sword',
  cost: { wood: 40, stone: 30, bronze_tools: 2 },
  requires: [{ id: 'tool_workshop' }],
  levels: [
    L(3, 'Cuartel inicial', 'Una cabaña grande con armero: aloja 6 soldados de infantería con equipo de bronce.', 'gen:barracks:3', { garrison: 6, units: 'infantry' }),
    L(5, 'Cuartel', 'Empalizada y patio de instrucción: 10 soldados.', 'gen:barracks:5', { garrison: 10, units: 'infantry', upgradeCost: { cut_stone: 20, wood: 30, iron_tools: 2 } }),
    L(6, 'Cuartel mejorado', 'Murallas bajas, comedor y herrería propia: 16 soldados.', 'gen:barracks:6', { garrison: 16, units: 'infantry', upgradeCost: { cut_stone: 30, planks: 20, iron_tools: 3 } }),
    L(8, 'Cuartel industrial', 'Barracones de ladrillo, almacén de municiones: 24 soldados.', 'gen:barracks:8', { garrison: 24, units: 'infantry', upgradeCost: { bricks: 30, steel: 8, planks: 20 } }),
    L(10, 'Complejo militar', 'Instalaciones modernas, simuladores y logística: 36 soldados.', 'gen:barracks:10', { garrison: 36, units: 'infantry', upgradeCost: { concrete: 40, steel: 16, electronics: 4 }, energy: 3 }),
  ],
});

military({
  id: 'armory',
  job: 'Armero',
  skill: 'crafting',
  kind: 'process',
  workers: 1,
  icon: 'sword',
  cost: { wood: 30, stone: 24, bronze_tools: 2 },
  requires: [{ id: 'barracks' }],
  levels: [
    L(3, 'Armería', 'Lanzas y escudos de bronce para equipar a los soldados.', 'gen:workshop:3', { recipe: { in: { bronze: 2, wood: 1 }, out: { arms_bronze: 1 }, time: 40 } }),
    L(4, 'Fragua de armas', 'Espadas y cascos de hierro.', 'gen:workshop:4', { recipe: { in: { iron: 2, charcoal: 1 }, out: { arms_iron: 1 }, time: 40 }, upgradeCost: { stone: 20, iron_tools: 2, wood: 20 } }),
    L(6, 'Armería medieval', 'Mallas, ballestas y armaduras forjadas.', 'gen:workshop:6', { recipe: { in: { iron: 2, planks: 1, cloth: 1 }, out: { arms_forged: 1 }, time: 38 }, upgradeCost: { cut_stone: 14, planks: 12, iron_tools: 3 } }),
    L(8, 'Arsenal industrial', 'Fabricación en serie con acero.', 'gen:workshop:8', { recipe: { in: { steel: 2, coal: 1 }, out: { arms_steel: 2 }, time: 34 }, upgradeCost: { bricks: 20, steel: 8, machinery: 1 }, energy: 2 }),
    L(9, 'Fábrica de armamento', 'Vehículos, blindajes y munición modernos.', 'gen:factory:9', { recipe: { in: { steel: 3, machinery: 1 }, out: { arms_modern: 2 }, time: 36 }, upgradeCost: { concrete: 20, steel: 10, machinery: 2 }, energy: 4 }),
    L(10, 'Industria de defensa', 'Sistemas avanzados con electrónica.', 'gen:factory:10', { recipe: { in: { steel: 3, electronics: 1 }, out: { arms_adv: 2 }, time: 36 }, upgradeCost: { concrete: 24, steel: 14, electronics: 4 }, energy: 5 }),
  ],
});

military({
  id: 'archery',
  icon: 'sword',
  cost: { wood: 40, stone: 20, iron_tools: 2 },
  requires: [{ id: 'barracks' }],
  levels: [
    L(4, 'Campo de tiro', 'Dianas, arcos de madera y un establo de flechas: 4 arqueros.', 'gen:barracks:4', { garrison: 4, units: 'ranged' }),
    L(6, 'Galería de ballesteros', 'Parapetos y ballestas: 8 tiradores.', 'gen:barracks:6', { garrison: 8, units: 'ranged', upgradeCost: { cut_stone: 20, planks: 14, iron_tools: 2 } }),
    L(8, 'Polígono de tiro', 'Fusilería y tiro de precisión: 12 tiradores.', 'gen:barracks:8', { garrison: 12, units: 'ranged', upgradeCost: { bricks: 20, steel: 6, planks: 14 } }),
  ],
});

military({
  id: 'stable',
  icon: 'sword',
  cost: { planks: 24, cut_stone: 14, iron_tools: 2 },
  requires: [{ id: 'barracks', level: 3 }, { id: 'farm' }],
  levels: [
    L(6, 'Establo', 'Caballos de guerra y pienso: 4 jinetes.', 'gen:barracks:6', { garrison: 4, units: 'cavalry' }),
    L(8, 'Cuadras mayores', 'Cuadras amplias, picadero y herrería: 8 jinetes.', 'gen:barracks:8', { garrison: 8, units: 'cavalry', upgradeCost: { planks: 24, bricks: 14, iron_tools: 3 } }),
  ],
});

military({
  id: 'siege_shop',
  icon: 'sword',
  cost: { planks: 30, cut_stone: 20, iron_tools: 3 },
  requires: [{ id: 'barracks', level: 3 }],
  levels: [
    L(6, 'Taller de asedio', 'Catapultas y arietes: 2 máquinas de asedio.', 'gen:workshop:6', { garrison: 2, units: 'siege' }),
    L(7, 'Arsenal de artillería', 'Cañones y morteros con pólvora: 4 piezas.', 'gen:workshop:7', { garrison: 4, units: 'artillery', upgradeCost: { planks: 30, cut_stone: 20, powder: 6 }, tech: 'gunpowder' }),
  ],
});

military({
  id: 'motor_pool',
  icon: 'sword',
  cost: { concrete: 24, steel: 12, machinery: 3 },
  tech: 'mechanization',
  requires: [{ id: 'barracks', level: 4 }],
  levels: [
    L(9, 'Cocheras mecanizadas', 'Garajes y taller: 6 vehículos blindados.', 'gen:factory:9', { garrison: 6, units: 'mechanized', energy: 2 }),
    L(10, 'Parque de vehículos', 'Hangares y logística: 10 vehículos avanzados.', 'gen:factory:10', { garrison: 10, units: 'advanced', upgradeCost: { concrete: 26, steel: 14, electronics: 4 }, energy: 3 }),
  ],
});

// Defensas: se construyen y se mejoran a mano; cada una suma puntos de defensa.
const defense = (def) => add({ category: 'defense', kind: 'defense', workers: 0, buildTime: 50, ...def });

defense({
  id: 'watchtower',
  icon: 'shield',
  cost: { wood: 10, fiber: 6 },
  footprint: 1.8,
  levels: [
    L(1, 'Atalaya de ramas', 'Una plataforma sobre cuatro postes: alguien vigila el campamento.', 'gen:tower:1', { defense: 2 }),
    L(2, 'Puesto de vigilancia', 'Torreta de troncos con tejadillo y una hoguera de señales.', 'gen:tower:2', { defense: 4, upgradeCost: { wood: 24, stone: 8, fiber: 8 } }),
    L(4, 'Torre de vigilancia', 'Torre de madera y piedra con almenas: se ve a gran distancia.', 'gen:tower:4', { defense: 8, upgradeCost: { wood: 30, stone: 24, iron_tools: 2 } }),
    L(6, 'Torre de piedra', 'Torre de sillares con troneras.', 'gen:tower:6', { defense: 14, upgradeCost: { cut_stone: 24, planks: 12, iron_tools: 3 } }),
    L(7, 'Bastión artillado', 'Plataforma con cañones y pólvora.', 'gen:tower:7', { defense: 24, upgradeCost: { cut_stone: 30, powder: 8, iron_tools: 4 }, tech: 'gunpowder' }),
    L(9, 'Torre de hormigón', 'Torre blindada con ametralladoras y proyectores.', 'gen:tower:9', { defense: 36, upgradeCost: { concrete: 24, steel: 12, machinery: 1 } }),
    L(10, 'Torre automatizada', 'Sensores y armas guiadas.', 'gen:tower:10', { defense: 52, upgradeCost: { concrete: 24, steel: 16, electronics: 4 }, energy: 2 }),
  ],
});

defense({
  id: 'wall',
  line: true, // se traza arrastrando una línea (tramos de 3,2 m pegados entre sí)
  icon: 'shield',
  cost: { wood: 8, fiber: 4 },
  footprint: 1.6,
  levels: [
    L(2, 'Empalizada', 'Estacas afiladas clavadas en el suelo: una barrera sencilla.', 'gen:wall:2', { defense: 1 }),
    L(4, 'Muro de madera y tierra', 'Terraplén con tablones y estacas.', 'gen:wall:4', { defense: 2, upgradeCost: { wood: 14, stone: 8, iron_tools: 1 } }),
    L(5, 'Muro de piedra', 'Piedra a hueso con almenas bajas.', 'gen:wall:5', { defense: 4, upgradeCost: { cut_stone: 10, wood: 8 } }),
    L(6, 'Muralla', 'Sillares con camino de ronda.', 'gen:wall:6', { defense: 6, upgradeCost: { cut_stone: 16, planks: 6 } }),
    L(8, 'Muralla reforzada', 'Ladrillo y contrafuertes.', 'gen:wall:8', { defense: 8, upgradeCost: { bricks: 14, steel: 2 } }),
    L(9, 'Muro de hormigón', 'Hormigón armado con vallas.', 'gen:wall:9', { defense: 10, upgradeCost: { concrete: 14, steel: 4 } }),
  ],
});

defense({
  id: 'gate',
  icon: 'shield',
  cost: { planks: 20, cut_stone: 12, iron_tools: 2 },
  footprint: 2.2,
  requires: [{ id: 'wall' }],
  levels: [
    L(6, 'Puerta de madera', 'Dos hojas de madera con herrajes: deja pasar a los colonos y frena a los intrusos.', 'gen:gate:6', { defense: 3 }),
    L(8, 'Puerta reforzada', 'Hojas de hierro y rastrillo.', 'gen:gate:8', { defense: 6, upgradeCost: { steel: 4, bricks: 10 } }),
    L(10, 'Puerta automática', 'Control remoto y blindaje.', 'gen:gate:10', { defense: 10, upgradeCost: { concrete: 12, steel: 8, electronics: 2 }, energy: 1 }),
  ],
});

defense({
  id: 'fort',
  icon: 'shield',
  cost: { wood: 50, stone: 50, iron_tools: 3 },
  footprint: 3.6,
  buildTime: 110,
  requires: [{ id: 'barracks' }],
  levels: [
    L(4, 'Fortín', 'Un recinto de piedra y madera con foso: refugio y guarnición para 6.', 'gen:fort:4', { defense: 12, garrison: 6 }),
    L(6, 'Castillo pequeño', 'Torre del homenaje y muros: guarnición para 12.', 'gen:fort:6', { defense: 24, garrison: 12, upgradeCost: { cut_stone: 40, planks: 24, iron_tools: 4 } }),
    L(8, 'Fortaleza', 'Murallas bajas con casamatas: guarnición para 20.', 'gen:fort:8', { defense: 40, garrison: 20, upgradeCost: { bricks: 40, steel: 10, planks: 20 } }),
    L(9, 'Búnker', 'Hormigón armado: guarnición para 24.', 'gen:fort:9', { defense: 60, garrison: 24, upgradeCost: { concrete: 40, steel: 16 } }),
  ],
});

// ---------------------------------------------------------------------------------------
// Utilidades de consulta
// ---------------------------------------------------------------------------------------

// Rango de ampliación visible por nivel (índice = nivel-1) de los edificios cuyo estilo no cambia entre edades.
const GROW = {
  coal_mine: [0, 1, 2], clay_pit: [0, 1], pottery: [0, 1], charcoal_kiln: [0, 1], bloomery: [0, 1], boiler: [0, 1], tool_workshop: [0, 1], bakery: [0, 1], blacksmith: [0, 1], powder_mill: [0, 1], water_works: [0, 1],
  station: [0, 1], market: [0, 0, 1], admin: [0, 1], academy: [0, 0, 1], school: [0, 1], barracks: [0, 1, 2], armory: [0, 1, 2],
  archery: [0, 1], siege_shop: [0, 1], motor_pool: [0, 1], wall: [0, 0, 0, 0, 0, 1], gate: [0, 1], fort: [0, 0, 1],
};

// Primera edad del primer nivel y datos derivados.
for (const def of BUILDING_TYPES) {
  def.name ??= def.levels[0].name;
  def.desc ??= def.levels[0].desc;
  def.minAge = def.levels[0].age;
  // Los modelos generados llevan el tipo al final (gen:estilo:edad:tipo) para añadir lo propio de cada edificio.
  for (const lv of def.levels) if (lv.model.startsWith('gen:') && lv.model.split(':').length === 3) lv.model += `:${def.id}`;
  // Niveles cuyo estilo no cambia con la edad (el audit de modelos los marca): llevan una ampliación visible (rango 1, 2).
  const kit = GROW[def.id];
  if (kit) def.levels.forEach((lv, i) => { if (kit[i] && lv.model.startsWith('gen:')) lv.model += `:${kit[i]}`; });
  def.workers ??= def.skill ? 1 : 0;
}

// Nivel actual (o el siguiente, con offset 1) de un edificio.
export function levelOf(b, offset = 0) {
  return b.def.levels[b.level - 1 + offset] ?? null;
}

// Categorías de la barra de construcción (las vacías, si las hay, se muestran como "próximamente").
export const BUILD_CATEGORIES = [
  { id: 'production', name: 'Producción', icon: 'hammer', soon: 'Edificios que consiguen comida, agua y materiales.' },
  { id: 'processing', name: 'Talleres', icon: 'gear', soon: 'Talleres y fábricas que transforman los recursos.' },
  { id: 'housing', name: 'Vivienda', icon: 'people', soon: 'Chozas y casas para que los colonos duerman mejor y la colonia crezca.' },
  { id: 'storage', name: 'Almacenes', icon: 'wood', soon: 'Graneros y depósitos para guardar más recursos.' },
  { id: 'infrastructure', name: 'Infraestructura', icon: 'bolt', soon: 'Agua, energía, transporte y caminos.' },
  { id: 'services', name: 'Servicios', icon: 'coin', soon: 'Comedores, comercio, administración, investigación, salud y enseñanza.' },
  { id: 'military', name: 'Ejército', icon: 'sword', soon: 'Cuarteles, armerías y escuelas militares.' },
  { id: 'defense', name: 'Defensa', icon: 'shield', soon: 'Empalizadas, torres y murallas.' },
];

export const BUILDINGS = Object.fromEntries(BUILDING_TYPES.map((t) => [t.id, t]));

export { GOOD_NAMES as STOCK_NAMES } from './goods.js';
