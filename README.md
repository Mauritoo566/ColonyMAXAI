# ColonyMAXAI

Juego para navegador con un planeta Tierra de estilo *medium poly*, hecho con [Three.js](https://threejs.org/).

## Cómo ejecutarlo

No hace falta instalar nada: Three.js se carga desde un CDN. Solo hay que servir la carpeta con cualquier servidor estático, por ejemplo:

```bash
python3 -m http.server 8000
# o
npx serve .
```

Luego abre <http://localhost:8000>. (Abrir `index.html` directamente con doble clic no funciona porque los navegadores bloquean los módulos ES en `file://`.)

## Controles

- Arrastrar: moverse sobre el planeta
- Rueda del ratón o pellizcar: acercar / alejar (desde el espacio hasta unos metros del suelo)
- Botón derecho, Shift + arrastrar o girar con dos dedos: rotar la vista (en horizontal) y levantar la mirada hacia el cielo (en vertical)
- Botones Pausa / ×1 / ×10 / ×60: velocidad del paso del tiempo (a ×1 un día dura 6 minutos)

## Cuentas y mundo compartido

Al abrir el juego hay que **iniciar sesión o crear una cuenta** (`src/auth.js`).

- **Mundo compartido (página publicada en claude.ai):** el planeta es el servidor. La página usa la base de datos compartida del artifact (`src/world.js`): cada jugador tiene un documento `world/<id>` con su nombre, su campamento, su edad, su población y sus edificios. Todos se suscriben a la colección y ven aparecer en tiempo real los campamentos de los demás, con su nombre encima y sus edificios. El jugador es la cuenta de Claude con la que se abre la página; registrarse es elegir un nombre de jugador (único). El botón **Mundo** lista a los jugadores y permite volar a sus campamentos. No se puede fundar a menos de 2 km de otro campamento. Para escribir en el mundo hace falta acceso de Colaborador o Editor; con acceso de sólo lectura se mira pero no se juega.
- **Sin servidor (GitHub, servidor local):** cuentas locales de este navegador con nombre y contraseña (guardada como huella PBKDF2, nunca en claro). Cada cuenta tiene su propia partida.



Con el botón **Fundar campamento** entras en modo colocación: al mover el ratón aparece una vista previa del campamento con un anillo verde (se puede) o rojo con el motivo (agua, hielo o nieve, pendiente de más de ~27°, o cámara a más de 60 km). Un clic lo funda y la cámara vuela hasta él. Después aparecen **Ir al campamento** y **Reubicar**, y una etiqueta marca dónde está cuando lo miras desde lejos. El campamento se guarda en el navegador (`localStorage`), así que sigue ahí al volver a abrir el juego. Al fundarlo, el terreno se nivela en un círculo de 30 m (con una pendiente suave de otros 32 m hasta el terreno natural), se pinta un claro de tierra pisada con borde irregular. Cerca del campamento el terreno usa triángulos más finos (hasta ~3 m). El claro y los adornos del campamento se adaptan al bioma (`src/biomes.js`): tierra en la pradera, grava en la montaña, arena en el desierto y la playa; matas de pasto sólo donde hay pasto. El código está en `src/camp.js`.

## Biomas

Cada punto de tierra tiene una **temperatura** (baja con la latitud y con la altura) y una **humedad**, y con esas dos cosas se elige el bioma (`src/biomes.js`). El HUD muestra el bioma del centro de la pantalla.

| Bioma | Dónde aparece |
|---|---|
| Hielo polar | mar cerca de los polos |
| Picos nevados | polos, cumbres muy altas o frío extremo |
| Montaña rocosa | laderas empinadas o mucha altura |
| Playa | tierra justo sobre el nivel del mar |
| Pantano | tierras bajas, muy húmedas y templadas o cálidas |
| Tundra | frío y seco (o muy frío) |
| Taiga | frío y con algo de humedad |
| Desierto | seco, templado o cálido |
| Estepa | semiseco y templado |
| Pradera | templado con humedad media (o cálido y algo húmedo) |
| Bosque templado | templado y húmedo |
| Sabana | cálido y semiseco |
| Selva tropical | cálido y muy húmedo |

## Colonos

Al fundar el campamento aparecen 5 colonos (`src/colonists.js`), siempre los mismos para ese lugar. Pasean por el campamento esquivando tiendas, fogata y a los demás, sin entrar al agua ni a pendientes fuertes. Qué hace cada uno lo decide su IA (ver más abajo).

Cada colono tiene:

- **Necesidades** (`src/needs.js`): comida, agua, descanso, calor y ánimo, de 0 a 100. Bajan despacio (la comida dura unos 4 días de juego, el agua 3). El calor depende del clima del lugar y de la hora; junto a la fogata sube. El ánimo depende de cómo esté y de la compañía.
- **Salud**: sólo baja si le falta comida, agua o calor; si no, se recupera. Por ahora no mueren.
- **Genes** (`src/genes.js`): nueve genes con dos alelos cada uno (piel, pelo, estatura, metabolismo, resistencia al frío, constitución, energía, agilidad, longevidad). Deciden su aspecto y cómo le afectan las necesidades, y están preparados para la herencia (`inheritGenome`: un alelo de cada progenitor más alguna mutación).
- **Personalidad**: dos rasgos (sociable, curioso, optimista, trabajador...) y una biografía.
- **Registro** de lo que le pasa ("Tiene frío", "Charló un rato con Ana"...).

La interfaz (`src/colonyUI.js`) muestra arriba a la izquierda el **bienestar de la colonia**, la media de cada necesidad, el **almacén** (comida, agua, madera, piedra) y la lista de colonos. Al hacer clic en un colono (en el mundo, en su nombre o en la lista) se abre su **ficha** con tres pestañas: Estado (necesidades, trabajo y habilidades), Genes e Historia, y un botón para seguirlo con la cámara.

### Ropa

Los colonos llegan **sin ropa** (sólo un taparrabos) y en el campamento hay una pila de ropa de pieles para todos. No van a buscarla por costumbre: cuando tienen frío, ir a vestirse pasa a ser una necesidad (abriga para siempre, así que la prefieren a la fogata). Sin ropa se enfrían mucho más; con ropa aguantan bastante aunque el lugar sea frío. El frío baja poco a poco (cada vez más lento al acercarse a la temperatura del ambiente).

### IA de los colonos

Cada colono decide solo qué hacer (`src/ai.js`, "IA de utilidad"): cada ~1,5 s puntúa las acciones posibles según sus necesidades, rasgos, la hora y la distancia, y cambia de tarea sólo si hay una bastante mejor. Acciones: comer (bayas y setas cercanas, que vuelven a crecer, o provisiones del almacén), beber (agua cercana, un pozo o las vasijas), dormir en su tienda (sobre todo de noche), calentarse junto a la fogata cuando tiene frío, charlar si está desanimado, construir obras, trabajar en su edificio o pasear. No hay rutina fija: sale de las necesidades.

### Construcción y trabajo

La **barra de construcción** (abajo) está ordenada por categorías (Producción, Vivienda, Almacenes, Decoración y Defensa; las que aún no tienen edificios dicen "próximamente") y permite encargar edificios (`src/buildings.js`). En Producción están choza de recolección (comida), cabaña del leñador (madera), cantera (piedra) y pozo (agua). Se elige dónde (hasta 75 m de la fogata; no sobre agua, pendientes fuertes ni encima de otra cosa) y los materiales se pagan al encargarlo. Los colonos construyen de día; los más hábiles en construcción avanzan más rápido. Al terminar, la colonia asigna el trabajo al **colono libre más capacitado** según sus habilidades (que salen de sus genes, su oficio anterior y su actitud). La ficha del edificio explica por qué lo eligió, muestra el ranking de candidatos y permite cambiarlo. Los árboles talados y las piedras picadas desaparecen del mundo.

### Edades y mejoras

La colonia avanza por edades (`src/ages.js`, barra decorada arriba al centro): Primitiva, Tribal, del Bronce, del Hierro y Medieval (de momento se juegan las dos primeras). Cada edificio tiene un nivel por edad, con su propio nombre, modelo 3D y rendimiento: en la Edad Primitiva son una enramada de recolección, una zona de tala, una pedrera y un **recolector de lluvia** (sólo junta agua cuando llueve, y un poco con el rocío). Desde la ficha del edificio se puede **mejorar** un nivel por encima de la edad actual: se paga el coste, los constructores trabajan en la obra con andamios y al terminar cambia el modelo (choza de recolección, cabaña del leñador, cantera, pozo simple). Con 3 edificios mejorados y una ofrenda de materiales la colonia pasa a la **Edad Tribal**, todos lo celebran y aparece el tótem de la tribu junto a la fogata. La choza de recolección trae también **fibras**, que se usan en las mejoras.

Si se acaban los árboles o las piedras grandes cerca, el leñador junta ramas caídas y el cantero piedras sueltas (rinden menos, pero siguen trabajando).

### Almacén

Lo que recoge la colonia se guarda en el **almacén del campamento** (las vasijas, cestas y sacos junto a la fogata). Tiene etiqueta en el mundo y, al hacerle clic (o en la fila de recursos de la tarjeta de la colonia), se abre su ficha con lo guardado y la capacidad. Cada recurso tiene un límite: cuando algo se llena, quien lo trae espera sin trabajar. Para guardar más se construyen almacenes (pestaña Almacenes): la **pila de troncos y cestas** de la Edad Primitiva, que se mejora a **granero** en la Tribal.

### Recolectar y zona de acopio

El botón **Recolectar** (abajo a la derecha, aparte de la construcción) activa una herramienta: se arrastra sobre el terreno para dibujar un rectángulo (alineado con la vista y pegado al relieve, sin límite de tamaño) o se hace clic en un recurso. Sobre cada recurso marcado aparece un pin: **hacha roja** en los árboles, pico en las piedras y cesta en la comida. Es una orden: los colonos dejan su trabajo fijo para recogerlo (de día y si no tienen hambre, sed, sueño o frío) y lo llevan al almacén. También se puede desmarcar o quitar todas las marcas.

En la pestaña Almacenes se dibuja la **zona de acopio** al aire libre: un rectángulo del tamaño que se quiera, con suelo de tierra, cuerda con estacas y un cartel. Hay una sola (dibujar otra la reemplaza). Lo que no cabe en el almacén se amontona ahí (1,5 unidades por m², con montones de troncos, piedras y cestas) en vez de que los colonos dejen de trabajar. La **comida al aire libre se pudre** en día y medio y desaparece; por eso se come primero la de afuera. La ficha del almacén muestra lo de afuera, cuándo se pudre la comida y permite quitar la zona.

### Guardado

Todo se guarda en el navegador (`localStorage`) cada pocos segundos y al cerrar la pestaña: edificios, trabajadores, almacén, las necesidades, salud, posición y registro de cada colono, los recursos talados o que están volviendo a crecer, los brotes de la lluvia, la hora, la fase de la Luna y el clima. Al volver se restaura todo en lugar de empezar de cero.

El tiempo sigue corriendo aunque no estés (a velocidad ×1). Al volver, la colonia se pone al día en unos segundos con la misma IA, hasta un máximo de dos días de juego, y aparece un resumen **Mientras no estabas** (cambios del almacén, obras terminadas, comida podrida y quién está mal). Mientras no estás nadie empeora más allá de la **salud crítica** (`CRITICAL_HEALTH` en `src/needs.js`).

## Recursos naturales

Aparecen solos por todo el planeta (`src/resources.js`), al azar pero siempre en el mismo lugar: el mundo se divide en baldosas de 320 m y cada una genera sus recursos con su propia semilla según el bioma. Los árboles se agrupan en bosques y los minerales sólo aparecen en vetas. Se generan en Web Workers (`src/resourceWorker.js` + `src/resourceGen.js`) y se dibujan cerca de la cámara (por debajo de 6 km de altura) con dos InstancedMesh por tipo: el modelo completo hasta 380 m y una versión simple más lejos. Más allá de 900 m se dibuja sólo una parte (la bruma lo disimula). No aparecen a menos de 45 m del campamento, y entre 50 y 100 m de la fogata crece siempre una arboleda propia del bioma (unos 70 árboles, bayas, setas, piedras y pedernal) para que la colonia tenga recursos a mano. Las cantidades por bioma están en `src/resourceTypes.js`.

| Recurso | Da | Biomas |
|---|---|---|
| Árbol frondoso | madera dura | bosque templado, pradera, pantano, estepa |
| Pino | madera blanda y resina | taiga, bosque, montaña, tundra |
| Árbol tropical | madera dura y frutas | selva, pantano |
| Acacia | madera | sabana, estepa |
| Palmera | cocos y fibras | playa, selva |
| Cactus | agua y fibras | desierto |
| Arbusto de bayas | comida | pradera, bosque, taiga, sabana, selva |
| Setas | comida | bosque, taiga, selva, pantano |
| Juncos | fibras y techos | pantano, playa |
| Piedras | piedra | casi todos, sobre todo montaña y tundra |
| Pedernal | herramientas de piedra | pradera, estepa, bosque, desierto |
| Arcilla | cerámica y ladrillos | pantano, playa, pradera |
| Salinas | sal | desierto, playa, estepa |
| Veta de cobre | cobre | montaña, desierto, estepa, tundra |
| Veta de hierro | hierro | montaña, tundra, taiga, nieve |
| Veta de oro | oro | montaña, desierto, selva (muy raro) |

## Día, noche y nubes

El Sol y la Luna se ven en el cielo (`src/sky.js`): el Sol es un disco con resplandor y la Luna una esfera con cráteres iluminada sólo por el Sol, así que sus fases son reales. La Luna tiene su propia órbita (un ciclo cada 8 días de juego) y su luz ilumina la noche según la fase.

El Sol gira alrededor del planeta; la hora que se muestra es la hora solar del lugar que estás mirando. De noche una luz de luna azulada y más luz ambiente mantienen el paisaje visible, y el cielo pasa por tonos de atardecer.

Las nubes son cúmulos low poly con la base plana, en dos capas que existen siempre en todo el planeta: grandes sistemas nubosos y cúmulos pequeños repartidos en celdas de 1°. Cada celda genera siempre los mismos cúmulos, así que al acercarte no aparecen nubes nuevas: de lejos cada cúmulo es una sola bola y de cerca se separa en sus bolitas. El Sol proyecta la sombra de las nubes sobre el terreno con un mapa de sombras que se ajusta a la zona que estás mirando.

Para que las nubes no tapen lo que estás mirando, las que quedan entre la cámara y el centro de la pantalla se vuelven casi transparentes (con un borde suave) y dejan de proyectar sombra; lo mismo pasa con cualquier nube muy cerca de la cámara. Desde el espacio el efecto se desactiva.

## Clima

El campamento tiene su propio clima (`src/weather.js`): despejado, nublado, lluvia o tormenta, que cambia cada pocas horas de juego. En lugares húmedos (selva, pantano) llueve a menudo y en el desierto casi nunca. Con lluvia:

- el **pozo rinde más** (hasta el doble con tormenta),
- las bayas y setas recogidas **vuelven a crecer antes**,
- de vez en cuando **brota un arbusto de bayas o unas setas** nuevas cerca del campamento (hasta 50),
- hace algo más de frío y el cielo se pone gris; cerca del suelo se ven caer las gotas.

El clima actual se ve en el panel de la hora (abajo a la izquierda).

## Agua

El mar forma parte del terreno (caras planas a nivel 0) y tiene su propio efecto en `src/water.js`: olas animadas que sólo se calculan cerca de la cámara (se desvanecen entre 1,5 y 9 km), reflejo del cielo según el ángulo de visión, brillo del sol y espuma en los bordes que tocan tierra. No usa texturas ni pasadas extra, así que casi no cuesta rendimiento.

Rendimiento: los grandes sistemas nubosos están divididos en zonas y sólo se dibujan las que están de este lado del horizonte (las lejanas con menos polígonos); los cúmulos lejanos usan una forma de 20 triángulos y los que ocupan menos de 2 píxeles no se dibujan.

## Cómo funciona la escala

El planeta tiene el radio real de la Tierra (6.371 km) y todo se mide en metros. El relieve está exagerado ×2,5 para que las montañas se vean desde el espacio.

El terreno es un *quadtree* sobre las 6 caras de un cubo proyectado a esfera: cada trozo tiene 32×32 celdas y, cuando la cámara se acerca, se divide en 4 trozos hijos con el doble de detalle, hasta celdas de unos 10 m (unos 3 m cerca del campamento). Sólo se detalla lo que está en pantalla, y la geometría se calcula en Web Workers (`src/terrainWorker.js` + `src/chunkBuilder.js`) para que generar terreno no frene el juego; si el navegador no permite workers, se genera en el hilo principal con un tope de 5 ms por fotograma. Lo que la bruma tapa no se detalla, y una calidad automática reduce el detalle del terreno si los fotogramas tardan más de 25 ms (y lo recupera si sobra tiempo). Las sombras de las nubes usan un mapa de 2048 px con filtro PCF y se recalculan cada 3 fotogramas.

**Ir al campamento** hace un vuelo animado: sube si el destino está lejos, sigue la curvatura del planeta y baja con suavidad (de 1,5 a 10 s según la distancia). Mover la cámara durante el vuelo lo cancela.

## Estructura

La simulación de la colonia está separada de lo que se dibuja: `src/sim/` no usa la página ni WebGL (sólo la matemática de Three.js), así que corre igual en el navegador y en Node, donde la va a ejecutar el servidor del juego. La vista escucha sus eventos y la dibuja. Para usarla desde Node: `npm install` (instala `three` 0.170.0, la misma versión que carga la página).

- `index.html` – página y *import map* de Three.js
- `package.json` – dependencias para correr la simulación en Node
- `src/sim/colony.js` – simulación de una colonia: colonos, IA, edificios, almacén, zona de acopio, recursos, edades y guardado
- `src/sim/buildingTypes.js` – tipos de edificio y sus niveles (datos)
- `src/sim/campLayout.js` – distribución del campamento, terreno que nivela y su semilla
- `src/save.js` – guardado de la partida en el navegador
- `src/main.js` – escena, luces, estrellas, cielo y bucle de animación
- `src/auth.js` – pantalla de acceso: cuentas locales o jugador del mundo compartido
- `src/storage.js` – claves de `localStorage` de cada cuenta
- `src/world.js` – mundo compartido: publicar la colonia y ver los campamentos de los demás
- `src/controls.js` – cámara tipo globo terráqueo con zoom hasta el suelo
- `src/planet.js` – planeta: terreno, nubes y atmósfera
- `src/clouds.js` – nubes (sistemas grandes y cúmulos cercanos)
- `src/daynight.js` – ciclo de día y noche y órbita de la Luna
- `src/weather.js` – clima del campamento y gotas de lluvia
- `src/sky.js` – el Sol y la Luna que se ven en el cielo
- `src/water.js` – efecto del agua
- `src/colonists.js` – vista de los colonos: modelo, animación, nombres y selección
- `src/needs.js` – necesidades, salud, personalidad e historia
- `src/genes.js` – genética: alelos, herencia y aspecto
- `src/colonyUI.js` – interfaz de la colonia y ficha de cada colono
- `src/ai.js` – IA de los colonos: elegir y ejecutar tareas (parte de la simulación)
- `src/buildings.js` – vista de los edificios: modelos, etiquetas, colocación y selección
- `src/buildingModels.js` – modelos 3D de cada nivel de edificio
- `src/buildUI.js` – barra de construcción, almacén y ficha de cada edificio
- `src/ages.js` – edades de la colonia y requisitos para avanzar
- `src/ageUI.js` – barra y panel de edades
- `src/harvest.js` – herramienta Recolectar, marcas y zona de acopio
- `src/rect.js` – rectángulos girados sobre el suelo (marcas y zona de acopio)
- `src/camp.js` – campamento: modelo, elegir dónde fundarlo y guardado
- `src/resources.js` – recursos naturales: modelos, baldosas y dibujo con InstancedMesh
- `src/resourceTypes.js` – tipos de recurso y cantidades por bioma (datos puros)
- `src/resourceGen.js` – generación de los recursos de cada baldosa (sin Three.js)
- `src/resourceWorker.js` – worker que genera baldosas de recursos en segundo plano
- `src/modelKit.js` – herramientas para modelar objetos low poly
- `src/biomes.js` – biomas: qué hay en cada punto y con qué colores y adornos se dibuja
- `src/terrain.js` – terreno con nivel de detalle (LOD) y reparto del trabajo a los workers
- `src/chunkBuilder.js` – cálculo de la geometría de cada trozo (sin Three.js)
- `src/terrainWorker.js` – worker que genera trozos en segundo plano
- `src/elevation.js` – escala del mundo y función de relieve
- `src/noise.js` – ruido simplex 3D usado para el relieve y las nubes
