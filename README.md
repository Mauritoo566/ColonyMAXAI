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

## Campamento inicial

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

## Recursos naturales

Aparecen solos por todo el planeta (`src/resources.js`), al azar pero siempre en el mismo lugar: el mundo se divide en baldosas de 320 m y cada una genera sus recursos con su propia semilla según el bioma. Los árboles se agrupan en bosques y los minerales sólo aparecen en vetas. Se generan en Web Workers (`src/resourceWorker.js` + `src/resourceGen.js`) y se dibujan cerca de la cámara (por debajo de 6 km de altura) con dos InstancedMesh por tipo: el modelo completo hasta 380 m y una versión simple más lejos. Más allá de 900 m se dibuja sólo una parte (la bruma lo disimula). No aparecen a menos de 90 m del campamento. Las cantidades por bioma están en `src/resourceTypes.js`.

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

## Agua

El mar forma parte del terreno (caras planas a nivel 0) y tiene su propio efecto en `src/water.js`: olas animadas que sólo se calculan cerca de la cámara (se desvanecen entre 1,5 y 9 km), reflejo del cielo según el ángulo de visión, brillo del sol y espuma en los bordes que tocan tierra. No usa texturas ni pasadas extra, así que casi no cuesta rendimiento.

Rendimiento: los grandes sistemas nubosos están divididos en zonas y sólo se dibujan las que están de este lado del horizonte (las lejanas con menos polígonos); los cúmulos lejanos usan una forma de 20 triángulos y los que ocupan menos de 2 píxeles no se dibujan.

## Cómo funciona la escala

El planeta tiene el radio real de la Tierra (6.371 km) y todo se mide en metros. El relieve está exagerado ×2,5 para que las montañas se vean desde el espacio.

El terreno es un *quadtree* sobre las 6 caras de un cubo proyectado a esfera: cada trozo tiene 32×32 celdas y, cuando la cámara se acerca, se divide en 4 trozos hijos con el doble de detalle, hasta celdas de unos 10 m (unos 3 m cerca del campamento). Sólo se detalla lo que está en pantalla, y la geometría se calcula en Web Workers (`src/terrainWorker.js` + `src/chunkBuilder.js`) para que generar terreno no frene el juego; si el navegador no permite workers, se genera en el hilo principal con un tope de 5 ms por fotograma. Lo que la bruma tapa no se detalla, y una calidad automática reduce el detalle del terreno si los fotogramas tardan más de 25 ms (y lo recupera si sobra tiempo). Las sombras de las nubes usan un mapa de 2048 px con filtro PCF y se recalculan cada 3 fotogramas.

**Ir al campamento** hace un vuelo animado: sube si el destino está lejos, sigue la curvatura del planeta y baja con suavidad (de 1,5 a 10 s según la distancia). Mover la cámara durante el vuelo lo cancela.

## Estructura

- `index.html` – página y *import map* de Three.js
- `src/main.js` – escena, luces, estrellas, cielo y bucle de animación
- `src/controls.js` – cámara tipo globo terráqueo con zoom hasta el suelo
- `src/planet.js` – planeta: terreno, nubes y atmósfera
- `src/clouds.js` – nubes (sistemas grandes y cúmulos cercanos)
- `src/daynight.js` – ciclo de día y noche y órbita de la Luna
- `src/sky.js` – el Sol y la Luna que se ven en el cielo
- `src/water.js` – efecto del agua
- `src/camp.js` – campamento inicial: modelo, colocación y guardado
- `src/resources.js` – recursos naturales: tipos, modelos y generación por baldosas
- `src/modelKit.js` – herramientas para modelar objetos low poly
- `src/biomes.js` – biomas: qué hay en cada punto y con qué colores y adornos se dibuja
- `src/terrain.js` – terreno con nivel de detalle (LOD) y reparto del trabajo a los workers
- `src/chunkBuilder.js` – cálculo de la geometría de cada trozo (sin Three.js)
- `src/terrainWorker.js` – worker que genera trozos en segundo plano
- `src/elevation.js` – escala del mundo y función de relieve
- `src/noise.js` – ruido simplex 3D usado para el relieve y las nubes
