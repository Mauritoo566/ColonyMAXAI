# ColonyMAXAI

Juego multijugador para navegador con un planeta Tierra de estilo *medium poly*, hecho con [Three.js](https://threejs.org/). Todos los jugadores comparten el mismo planeta: cada uno funda su campamento y ve en tiempo real los de los demás, con sus edificios y sus colonos.

## Cómo ejecutarlo

El juego necesita su servidor (`server/game/`): simula todas las colonias, guarda las cuentas y las partidas y entrega la página. Hace falta Node 22 o más nuevo.

```bash
npm install
npm start
```

Luego abre <http://localhost:3100>. La base de datos queda en `server/game/data/game.db` (se puede cambiar con `DB_PATH`). `npm test` prueba el servidor de punta a punta con dos jugadores de mentira.

En el servidor de producción el juego corre como servicio de systemd detrás de un túnel de Cloudflare, y un bot de Telegram avisa la dirección: ver `server/game/INSTALAR.md` y `server/tunnel/INSTALAR.md`.

## Controles

- Arrastrar: moverse sobre el planeta
- Rueda del ratón o pellizcar: acercar / alejar (desde el espacio hasta unos metros del suelo)
- Botón derecho o Shift + arrastrar: orbitar alrededor del punto del centro de la pantalla (horizontal: girar; vertical: inclinar, con límites). Alt + botón derecho (o botón central): mirar alrededor y al cielo. Dos dedos: girar la vista. Se puede acercar casi a ras de los colonos (7 m)
- El tiempo es el mismo para todos los jugadores: un día de juego dura 6 minutos

## Cuentas y mundo compartido

El botón ⚙ (abajo a la derecha) abre la **Configuración**: cerrar sesión y **Eliminar cuenta** (pide la contraseña; borra para siempre la cuenta, el campamento y todo lo suyo en el servidor, y el nombre queda libre).

Al abrir el juego hay que **iniciar sesión o crear una cuenta** (`src/auth.js`). La cuenta vive en el servidor: nombre único y contraseña, que se guarda como huella scrypt (nunca en claro). El navegador guarda un token de sesión para entrar solo la próxima vez. Hay límite de intentos de inicio de sesión.

El planeta es uno solo para todos. El servidor (`server/game/world.js`) simula **todas las colonias todo el tiempo**, estén o no conectados sus dueños, y a cada jugador le manda:

- su colonia entera una vez por segundo, y dónde está cada colono cinco veces por segundo (el navegador los mueve con suavidad entre medio);
- la lista de jugadores con sus campamentos, edades y edificios;
- los colonos de las colonias ajenas que están cerca de lo que mira la cámara, en vivo.

El navegador no simula: tiene una copia de la colonia que se pone al día con lo que llega (`src/sim/colony.js`, `applySnapshot`) y manda las órdenes del jugador (construir, mejorar, marcar, zona de acopio...) al servidor, que las valida y aplica. El botón **Mundo** lista a los jugadores (conectados o no) y permite volar a sus campamentos. No se puede fundar a menos de 2 km de otro campamento. Si se corta la conexión, abajo a la izquierda aparece **Reconectando…** y el juego vuelve a entrar solo.

**Cuando un jugador no está**, su colonia sigue viviendo en el servidor, pero nadie baja de la **salud crítica** (`CRITICAL_HEALTH` en `src/needs.js`): el dueño decide al volver. Al volver aparece el resumen **Mientras no estabas** (`src/sim/away.js`), con los cambios del almacén, las obras terminadas, la comida podrida y quién está mal. Si el servidor estuvo apagado, al encenderse las colonias se ponen al día (hasta dos días de juego).

Con el botón **Fundar campamento** entras en modo colocación: al mover el ratón aparece una vista previa del campamento con un anillo verde (se puede) o rojo con el motivo (agua, hielo o nieve, pendiente de más de ~27°, o cámara a más de 60 km). Un clic lo funda y la cámara vuela hasta él. El servidor comprueba el lugar y lo funda (una sola vez: después no se puede mover). Luego aparece **Ir al campamento**, y una etiqueta marca dónde está cuando lo miras desde lejos. Al fundarlo, el terreno se nivela en un círculo de 30 m (con una pendiente suave de otros 32 m hasta el terreno natural), se pinta un claro de tierra pisada con borde irregular. Cerca del campamento el terreno usa triángulos más finos (hasta ~3 m). El claro y los adornos del campamento se adaptan al bioma (`src/biomes.js`): tierra en la pradera, grava en la montaña, arena en el desierto y la playa; matas de pasto sólo donde hay pasto. El código está en `src/camp.js`.

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

### Familia y población
- El campamento admite **10 colonos** y empiezan 5. Cada **vivienda** terminada (Choza de ramas: +2, Casa de barro: +3) sube el máximo; los vecinos duermen en su casa (las parejas juntas) y el resto en las tiendas.
- Nadie tiene hijos por un guion: cada adulto siente **ganas** que crecen cuando está bien (bienestar, ánimo, descanso) y decide a quién invitar según su afinidad, su carácter y su pareja; el invitado **acepta o rechaza** según su estado. Si aceptan van juntos a su casa, entran (corazones sobre el techo) y puede haber embarazo. No se emparejan padres, hijos ni hermanos.
- El hijo hereda genes de ambos (con mutaciones), nace con un nombre de la **edad de la aldea en ese momento** (los nombres nunca cambian) y crece en 3 días: de niño es más bajo y de cabeza grande, no trabaja. Los genes se ven en el cuerpo: piel, pelo (canas con los años), estatura y complexión.
- La **bandera** de la aldea se elige de una lista de países (botón Bandera) y la ven los demás jugadores.

### Progresión por edades (10 edades jugables)
El asentamiento pasa de campamento a aldea, pueblo, ciudad y civilización a lo largo de diez edades: **Primitiva, de Piedra, del Bronce, del Hierro, Clásica, Medieval, Renacimiento, Industrial, Moderna y Contemporánea** (la XI, Futurista, queda preparada pero fuera del alcance). Cada edad **limita** lo que se puede construir, mejorar, alojar, producir y reclutar, y desbloquea contenido nuevo; la edad es necesaria pero no suficiente (también cuentan costes, edificios previos, tecnologías y condiciones). Todo se valida en el servidor.

- **Evoluciona sola:** el aspecto de las viviendas (y su capacidad), la ropa de los colonos y el centro del asentamiento (sendas, plaza, calles, fuente, farolas).
- **Lo paga el jugador:** viviendas nuevas, mejoras de cada edificio, caminos, energía, territorio, tecnologías y soldados.
- **Producción:** 37 bienes y 51 tipos de edificio con 164 niveles; talleres con recetas, trabajadores, yacimientos de mineral y red de energía (calderas, centrales y postes).
- **Población:** viviendas, abastecimiento y servicios por umbral; llegan colonos nuevos sólo si hay plazas, reservas y bienestar.
- **Ejército:** 16 unidades que salen de la población civil, con equipo, mantenimiento y mejoras pagadas; defensas; incursiones sin destrucción; ataques entre jugadores desactivados.
- **Interfaz:** barra de edades con requisitos, próximos desbloqueos y por qué algo está bloqueado; panel «Aldea» (población, trabajadores, territorio, almacenamiento, producción y consumo por día) y panel «Ejército».
- **Documento completo con las tablas por edad:** [`docs/PROGRESION.md`](docs/PROGRESION.md) (se genera con `node tools/gen-progression-doc.mjs`).

### Ropa

Los colonos llegan **sin ropa** (sólo un taparrabos) y en el campamento hay una pila de ropa de pieles para todos. No van a buscarla por costumbre: cuando tienen frío, ir a vestirse pasa a ser una necesidad (abriga para siempre, así que la prefieren a la fogata). Sin ropa se enfrían mucho más; con ropa aguantan bastante aunque el lugar sea frío. El frío baja poco a poco (cada vez más lento al acercarse a la temperatura del ambiente).

### IA de los colonos

Cada colono decide solo qué hacer (`src/ai.js`, "IA de utilidad"): cada ~1,5 s puntúa las acciones posibles según sus necesidades, rasgos, la hora y la distancia, y cambia de tarea sólo si hay una bastante mejor. Acciones: comer (bayas y setas cercanas, que vuelven a crecer, o provisiones del almacén), beber (agua cercana, un pozo o las vasijas), dormir en su tienda (sobre todo de noche), calentarse junto a la fogata cuando tiene frío, charlar si está desanimado, construir obras, trabajar en su edificio o pasear. No hay rutina fija: sale de las necesidades.

### Obras, prioridades y órdenes directas
- Cada obra (o mejora) muestra su estado real: *Esperando constructor*, *Constructores en camino*, *Construyendo (n)*, *Pausada* o *Bloqueada*, con el motivo (de noche, todos ocupados, prioridad baja, sin adultos).
- Prioridad **Baja / Normal / Alta** y **Pausar**: la alta gana al trabajo fijo, la baja sólo la hacen los colonos sin nada mejor; hay un tope de constructores por obra para que se repartan.
- Desde la ficha de la obra («Asignar constructor») o del colono («Asignar tarea») se da una **orden directa**: construir una obra, recolectar lo marcado o ir a un puesto de trabajo. La orden se cumple de día y de noche, sólo la frena una necesidad crítica (la ficha lo dice) y termina sola con la obra. Niños y soldados no reciben órdenes (se explica por qué). No usa el clic derecho, que es de la cámara.
- La ficha separa **oficio fijo**, **orden actual**, **actividad ahora** y **disponibilidad**; la lista agrupa por oficio fijo («Sin oficio fijo» no significa que esté parado).
- Aldeas guardadas antes de estas mejoras: al cargarlas las viviendas toman el aspecto de la edad real (sin coste ni recursos duplicados) y los tipis iniciales desaparecen cuando todos viven en casas. El contador de vivienda cuenta sólo adultos (los niños viven con su madre): antes mostraba «4/3».

### Edad Primitiva (la primera etapa, de principio a fin)
- **Fundar:** fogata, 5 colonos, un refugio de ramas (2 plazas), un recolector de lluvia ya funcionando y un acopio inicial pequeño (18 comida, 12 agua, 40 madera, 14 piedra, 14 fibra). Antes de fundar, el puntero dice si la zona es fértil, moderada o difícil.
- **Sin herramientas:** ramas, piedras sueltas, fibras (vienen de regalo al recoger comida o madera) y comida silvestre se recogen con «Recolectar» o solos. El agua sale del recolector de lluvia: no hace falta un río. Pasa el cursor sobre cada recurso para ver dónde se consigue, cómo se ordena, para qué sirve, cuánto queda y por qué no se recoge.
- **Refugio:** cada choza aloja a 2 adultos. Quien no tiene plaza duerme junto a la fogata (tumbado, descansa un 45 % peor). La tarjeta de la colonia separa población actual (máx. 10 en esta edad), plazas de refugio y el motivo por el que no hay nacimientos.
- **Población:** sólo por nacimientos (sin inmigración); no nacen niños mientras haya adultos sin refugio.
- **Escasez real:** los recursos se agotan, sin lluvia baja el agua, y con el dueño presente los colonos pueden morir de sed, hambre o frío (las ausencias no cambian: nadie muere mientras no estás). Alertas con días de reserva.
- **Guía** (plegable, con progreso en el servidor): conocer el campamento → recoger materiales → comida → agua → refugio para todos → almacén primitivo → estabilizar → descubrir la primera herramienta de piedra → avanzar. Reconoce lo ya hecho aunque se haga antes.
- **Pasar a Piedra:** refugio para todos, reservas de comida y agua (se conservan), almacén primitivo, la primera herramienta (6 piedras, 4 madera, 4 fibra; tarda un rato) y 30 madera, 15 piedra y 10 fibra. Sin población mínima. Todo se consigue en Primitiva (tabla de auditoría en `docs/PRIMITIVA.md`, verificada por `primitive.test.js`).
- **Derrota:** si mueren todos se explica la causa y se puede «Volver a fundar» con las condiciones iniciales (no hereda nada ni afecta a otros jugadores).

> Para pruebas, `GAME_SPEED=10 node server/game/index.js` acelera el mundo (reloj y simulación). No cambia ninguna regla; no usar en producción.

### Cuadrícula
La aldea tiene una **cuadrícula simétrica de 4 m centrada en la fogata** (la misma de los caminos). Con **R** se gira el edificio 90° al colocarlo o moverlo (Mayús + R al revés). Con el botón «▦ Cuadrícula» (o la tecla **G**, activa por defecto) los edificios se colocan y se mueven pegados al centro de su casilla, y la malla se dibuja sobre el terreno (con los ejes en dorado) mientras se construye o se pintan caminos. Apagada, se coloca libremente.

### Caminos automáticos y manuales
Desde la Edad de Piedra (camino de tierra) la aldea **traza sola caminos** que unen cada edificio terminado con la red o con el centro (gratis, dentro del límite de casillas de la edad; mejoran solos al cambiar de edad). En Infraestructura: **Caminos** (pintar a mano, se paga y se mejora con «Mejorar caminos»), **Quitar caminos** (arrastrar; lo quitado no vuelve a trazarse solo) y **Caminos automáticos** (activar/apagar; apagarlos quita los que trazó la aldea y deja los tuyos). Cada edad da un camino mejor: tierra, empedrado, adoquinado y asfaltado, cada uno más rápido.

### Mover y demoler
En la ficha de cualquier edificio: **Mover** (gratis; se elige el nuevo sitio con las mismas reglas de lugar, y conserva nivel, obra y dotación) y **Demoler** (pide confirmar; devuelve la mitad, redondeada hacia abajo, de lo gastado en construirlo y mejorarlo; los vecinos y trabajadores quedan libres). Lo valida el servidor.

### Construcción y trabajo

La **barra de construcción** (abajo) está ordenada por categorías (Producción, Vivienda, Almacenes, Decoración y Defensa; las que aún no tienen edificios dicen "próximamente") y permite encargar edificios (`src/buildings.js`). En Producción están choza de recolección (comida), cabaña del leñador (madera), cantera (piedra) y pozo (agua). Se elige dónde (hasta 75 m de la fogata; no sobre agua, pendientes fuertes ni encima de otra cosa) y los materiales se pagan al encargarlo. Los colonos construyen de día; los más hábiles en construcción avanzan más rápido. Al terminar, la colonia asigna el trabajo al **colono libre más capacitado** según sus habilidades (que salen de sus genes, su oficio anterior y su actitud). La ficha del edificio explica por qué lo eligió, muestra el ranking de candidatos y permite cambiarlo. Los árboles talados y las piedras picadas desaparecen del mundo.

### Edades y mejoras
Las edades están en `src/ages.js`, los edificios en `src/sim/buildingTypes.js` y las reglas que los ligan en `src/sim/progression.js`. Un edificio mejora de nivel pagando el coste (y cumpliendo sus requisitos) sólo hasta el nivel que permite la edad; las viviendas evolucionan solas. Para avanzar de edad hay que cumplir lo que pide la siguiente (población, edificios, producción, tecnologías y una ofrenda que se cobra una sola vez); ver el documento de progresión para cada una.

### Almacén

Lo que recoge la colonia se guarda en el **almacén del campamento** (las vasijas, cestas y sacos junto a la fogata). Tiene etiqueta en el mundo y, al hacerle clic (o en la fila de recursos de la tarjeta de la colonia), se abre su ficha con lo guardado y la capacidad. Cada recurso tiene un límite: cuando algo se llena, quien lo trae espera sin trabajar. Para guardar más se construyen almacenes (pestaña Almacenes): la **pila de troncos y cestas** de la Edad Primitiva, que se mejora a **granero** en la Edad de Piedra y sigue creciendo hasta el almacén automatizado.

### Recolectar y zona de acopio

El botón **Recolectar** (abajo a la derecha, aparte de la construcción) activa una herramienta: se arrastra sobre el terreno para dibujar un rectángulo (alineado con la vista y pegado al relieve, sin límite de tamaño) o se hace clic en un recurso. Sobre cada recurso marcado aparece un pin: **hacha roja** en los árboles, pico en las piedras y cesta en la comida. Es una orden: los colonos dejan su trabajo fijo para recogerlo (de día y si no tienen hambre, sed, sueño o frío) y lo llevan al almacén. También se puede desmarcar o quitar todas las marcas.

En la pestaña Almacenes se dibuja la **zona de acopio** al aire libre: un rectángulo del tamaño que se quiera, con suelo de tierra, cuerda con estacas y un cartel. Hay una sola (dibujar otra la reemplaza). Lo que no cabe en el almacén se amontona ahí (1,5 unidades por m², con montones de troncos, piedras y cestas) en vez de que los colonos dejen de trabajar. La **comida al aire libre se pudre** en día y medio y desaparece; por eso se come primero la de afuera. La ficha del almacén muestra lo de afuera, cuándo se pudre la comida y permite quitar la zona.

### Guardado

Todo se guarda en el servidor (SQLite) cada 30 segundos y al apagarlo: edificios, trabajadores, almacén, las necesidades, salud, posición y registro de cada colono, los recursos talados o que están volviendo a crecer, los brotes de la lluvia y el clima de cada colonia. Hay copias de seguridad diarias (`server/game/backup.js`).

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

Cada campamento tiene su propio clima (`src/sim/weather.js`, simulado en el servidor): despejado, nublado, lluvia o tormenta, que cambia cada pocas horas de juego. En lugares húmedos (selva, pantano) llueve a menudo y en el desierto casi nunca. Con lluvia:

- el **pozo rinde más** (hasta el doble con tormenta),
- las bayas y setas recogidas **vuelven a crecer antes**,
- de vez en cuando **brota un arbusto de bayas o unas setas** nuevas cerca del campamento (hasta 50),
- hace algo más de frío y el cielo se pone gris; cerca del suelo se ven caer las gotas.

El clima actual se ve en el panel de la hora (abajo a la izquierda).

**El clima es en vivo y es el de cada zona.** Lo que ves es el de la colonia más cercana a lo que miras: la tuya o la de otro jugador. El servidor manda el clima de las colonias ajenas cercanas (mensaje `other`, campo `w`) y la lista de jugadores muestra el clima de cada una. Si tu amigo tiene lluvia y tú vuelas a su campamento, ves llover allí; al volver al tuyo, el tuyo. Al pasar de una zona a otra la lluvia cambia poco a poco.

**Rendimiento de la lluvia:** las gotas se animan en la tarjeta gráfica (un sombreador en `src/weather.js`): la geometría no cambia nunca, así que no hay trabajo por gota en el procesador ni datos que subir en cada cuadro. Con la calidad automática bajando, se dibujan menos gotas.

## Agua

El mar forma parte del terreno (caras planas a nivel 0) y tiene su propio efecto en `src/water.js`: olas animadas que sólo se calculan cerca de la cámara (se desvanecen entre 1,5 y 9 km), reflejo del cielo según el ángulo de visión, brillo del sol y espuma en los bordes que tocan tierra. No usa texturas ni pasadas extra, así que casi no cuesta rendimiento.

Rendimiento: los grandes sistemas nubosos están divididos en zonas y sólo se dibujan las que están de este lado del horizonte (las lejanas con menos polígonos); los cúmulos lejanos usan una forma de 20 triángulos y los que ocupan menos de 2 píxeles no se dibujan.

## Cómo funciona la escala

El planeta tiene el radio real de la Tierra (6.371 km) y todo se mide en metros. El relieve está exagerado ×2,5 para que las montañas se vean desde el espacio.

El terreno es un *quadtree* sobre las 6 caras de un cubo proyectado a esfera: cada trozo tiene 32×32 celdas y, cuando la cámara se acerca, se divide en 4 trozos hijos con el doble de detalle, hasta celdas de unos 10 m (unos 3 m cerca del campamento). Sólo se detalla lo que está en pantalla, y la geometría se calcula en Web Workers (`src/terrainWorker.js` + `src/chunkBuilder.js`) para que generar terreno no frene el juego; si el navegador no permite workers, se genera en el hilo principal con un tope de 5 ms por fotograma. Lo que la bruma tapa no se detalla, y una calidad automática reduce el detalle del terreno si los fotogramas tardan más de 25 ms (y lo recupera si sobra tiempo). Las sombras de las nubes usan un mapa de 2048 px con filtro PCF y se recalculan cada 3 fotogramas.

**Ir al campamento** hace un vuelo animado: sube si el destino está lejos, sigue la curvatura del planeta y baja con suavidad (de 1,5 a 10 s según la distancia). Mover la cámara durante el vuelo lo cancela.

## Estructura

La simulación de la colonia está separada de lo que se dibuja: `src/sim/` no usa la página ni WebGL (sólo la matemática de Three.js), así que corre igual en el navegador y en Node. El servidor la ejecuta de verdad; el navegador tiene una copia que refleja lo que manda el servidor y la vista escucha sus eventos y la dibuja.

- `index.html` – página y *import map* de Three.js
- `package.json` – dependencias (`three`, `ws`) y los comandos `npm start` / `npm test`
- `server/game/index.js` – servidor del juego: página, WebSocket y apagado ordenado
- `server/game/world.js` – el mundo: simula todas las colonias, reloj común, envíos a cada jugador
- `server/game/accounts.js` – cuentas, contraseñas y sesiones
- `server/game/store.js` – base de datos SQLite
- `server/game/admin.js`, `backup.js` – herramientas del administrador y copias de seguridad
- `server/tunnel/` – túnel de Cloudflare y bot de Telegram que avisa la dirección
- `src/net.js` – conexión con el servidor (se reconecta sola)
- `src/sim/colony.js` – simulación de una colonia: colonos, IA, edificios, almacén, zona de acopio, recursos, edades y guardado
- `src/sim/buildingTypes.js` – tipos de edificio y sus niveles (datos)
- `src/sim/goods.js`, `techs.js`, `units.js` – bienes, tecnologías y unidades militares (datos)
- `src/sim/progression.js` – reglas centrales por edad: límites, requisitos, niveles, territorio y tabla de desbloqueos
- `src/sim/family.js` – viviendas, población, reproducción, llegada de colonos y servicios por umbral
- `src/sim/economy.js` – talleres con recetas, energía, yacimientos, comercio, investigación, servicios y caminos
- `src/sim/military.js` – reclutamiento, mantenimiento, mejoras, defensas e incursiones
- `src/sim/centerLayout.js`, `names.js`, `report.js` – centro del asentamiento, nombres por edad, resumen de la aldea
- `src/buildingModelsGen.js`, `center.js`, `outfits.js`, `roads.js`, `icons.js` – modelos generados por edad, centro, ropa y oficios, caminos, iconos
- `src/villageUI.js`, `militaryUI.js`, `flagUI.js` – paneles de la aldea, del ejército y de la bandera
- `tools/gen-progression-doc.mjs` – genera `docs/PROGRESION.md` desde los datos
- `src/sim/campLayout.js` – distribución del campamento, terreno que nivela y su semilla
- `src/sim/weather.js` – clima de cada colonia
- `src/sim/away.js` – resumen «Mientras no estabas»
- `src/main.js` – escena, luces, estrellas, cielo y bucle de animación
- `src/auth.js` – pantalla de acceso: iniciar sesión o crear una cuenta en el servidor
- `src/storage.js` – claves de `localStorage` para preferencias de la interfaz
- `src/world.js` – los demás jugadores: sus campamentos, edificios y colonos en vivo
- `src/controls.js` – cámara tipo globo terráqueo con zoom hasta el suelo
- `src/planet.js` – planeta: terreno, nubes y atmósfera
- `src/clouds.js` – nubes (sistemas grandes y cúmulos cercanos)
- `src/daynight.js` – ciclo de día y noche y órbita de la Luna
- `src/weather.js` – gotas de lluvia (el clima lo decide `src/sim/weather.js`)
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
