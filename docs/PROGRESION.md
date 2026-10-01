# Progresión de ColonyMAXAI: de campamento a civilización

Documento generado por `tools/gen-progression-doc.mjs` a partir de los datos del juego (no se edita a mano: cambia los datos y vuelve a generarlo). Las reglas viven en `src/sim/*.js` y `src/ages.js`; construir, producir, mejorar y reclutar comparten los mismos requisitos y los valida la simulación del servidor.

## 1. Diagnóstico de lo que había antes de esta ampliación

| Sistema | Estado inicial |
|---|---|
| Edades | 5 con nombre (Primitiva, Tribal, Bronce, Hierro, Medieval); sólo se llegaba a la II; las demás eran «próximamente». Se avanzaba mejorando 3 edificios. |
| Edificios | 5 tipos (recolección, tala, cantera, pozo, almacén) con 2 niveles; un trabajador por edificio; sin procesado ni recetas. |
| Recursos | 5 en bruto (comida, agua, madera, piedra, fibras). |
| Colonos | Simulación determinista, IA de utilidad, necesidades, genes y familia. Vestimenta única. |
| Vivienda | Tiendas del campamento. |
| Territorio / servicios / energía / transporte / ejército | Radio fijo; el resto no existía. |
| Red | Servidor autoritativo con SQLite; la copia del navegador sólo refleja. |

**Migración:** las 5 edades antiguas se conservan con el mismo número (1 Primitiva, 2 «Tribal» → Edad de Piedra, 3 Bronce, 4 Hierro, 5 «Medieval» → Edad Clásica; la Medieval pasa a ser la VI). Como sólo se llegaba a la II, ninguna partida cambia de edad. Los edificios conservan posición, nivel y trabajador; las viviendas existentes se ponen al día con la edad al cargar; lo ya mejorado no se baja de nivel aunque la nueva regla lo limite (el tope sólo frena lo nuevo). El guardado pasa a la versión 3 y sigue leyendo las versiones 1 y 2.

## 2. Fases

| Fase | Contenido | Depende de | Complejidad | Estado |
|---|---|---|---|---|
| F1 | Base de progresión: 11 edades, catálogo de recursos y edificios con requisitos, reglas centrales, guardado v3 y migración | — | Alta | Hecho |
| F2 | Evolución automática: viviendas por edad, vestimenta y oficios, centro del asentamiento | F1 | Media | Hecho |
| F3 | Mejoras manuales: niveles por edificio, varios trabajadores, herramientas requeridas | F1 | Alta | Hecho |
| F4 | Población y expansión: llegada de colonos, viviendas de más capacidad, territorio ampliable, servicios por umbral, transición entre edades | F1–F3 | Media | Hecho |
| F5 | Cadenas productivas y servicios: recetas, yacimientos, energía, caminos, mercado, investigación, hospital, escuela | F1, F3 | Muy alta | Hecho |
| F6 | Ejército y defensas: unidades, reclutamiento, equipo, mantenimiento, defensas, incursiones, reglas de combate | F3–F5 | Alta | Hecho |
| F7 | Edades avanzadas, rendimiento con aldeas grandes, edad XI preparada, documentación y pruebas | F1–F6 | Media | Hecho (la edad XI queda preparada pero separada del alcance) |

## 3. Evolución automática frente a mejoras manuales

| Cambia solo al avanzar de edad (gratis, sin tocar posiciones) | Lo decide y paga el jugador |
|---|---|
| Aspecto de **todas las viviendas** (y su capacidad, que sube con el nivel; no crea casas ni regala colonos) | Construir viviendas nuevas (cuestan más en edades avanzadas), bloques residenciales |
| Ropa de los colonos (por edad) y prendas de oficio | Mejorar cada edificio de producción, taller, almacén, servicio, militar o defensa |
| Centro del asentamiento: sendas, plaza, calles, fuente, pozo, farolas, bancos | Caminos y mejora de caminos, energía, agua canalizada, transporte |
| Techo de población y límites de la edad | Territorio (ampliaciones pagadas), reclutar y mejorar soldados, investigar tecnologías |

Un edificio sin mejorar conserva modelo, nivel y rendimiento. Los soldados existentes no reciben equipo nuevo: se modernizan uno a uno pagando la unidad siguiente de su línea. La evolución visual **no regala** redes de agua, electricidad ni transporte: esas piden edificios (acueducto, central, postes, estaciones) y siguen limitadas por el alcance de cada uno.

## 4. Población y expansión

- **Capacidad:** 10 del campamento (tiendas) + plazas de las viviendas terminadas (choza de 2 a edificio moderno de 6; bloques de 12 a 26), con un techo por edad. Tener plazas libres no basta.
- **Cómo crece:** (a) hijos, por la reproducción emergente de los colonos; (b) **llegada de colonos**: una vez al día, con probabilidad, si hay plazas, reservas holgadas (2 de comida y de agua por colono), bienestar medio ≥ 62 % (más probable ≥ 75 %) y el dueño conectado. Los niños tardan 3 días en ser adultos.
- **Abastecimiento:** nada nace ni llega si faltan 1,2 de comida y agua por habitante.
- **Servicios por umbral:** desde 20 habitantes (edad 5+) hace falta agua canalizada (un acueducto); desde 25 habitantes (edad 5+) hace falta administración (una casa del consejo); desde 45 habitantes (edad 9+) hace falta un hospital; desde 60 habitantes (edad 9+) hace falta una escuela. No hay castigo si faltan: la aldea simplemente no crece más.
- **Territorio:** cada edad fija un radio base y un número de ampliaciones (cada una suma 12 m y se paga con recursos crecientes); sin administración sólo cabe 1; la casa del consejo, el ayuntamiento y el edificio municipal permiten 2, 4 y 6. Respeta el agua, el terreno y los obstáculos; los campamentos distan ≥ 2 km, así que nunca se solapan con otro jugador.
- **Transición equilibrada:** lo nuevo que pesa en el bienestar (vivir sin casa desde el Bronce) entra poco a poco en los 2 días siguientes a cada cambio de edad.

| Edad | Territorio base | Ampliaciones | Viviendas | Bloques | Edificios de cada tipo | Población máx. |
|---|---|---|---|---|---|---|
| I Edad Primitiva | 75 m | 0 | 3 | — | 2 | 14 |
| II Edad de Piedra | 85 m | 1 | 6 | — | 3 | 22 |
| III Edad del Bronce | 95 m | 2 | 9 | — | 4 | 32 |
| IV Edad del Hierro | 110 m | 2 | 13 | — | 5 | 42 |
| V Edad Clásica | 125 m | 3 | 17 | — | 6 | 54 |
| VI Edad Medieval | 140 m | 4 | 22 | — | 8 | 68 |
| VII Renacimiento | 155 m | 5 | 27 | — | 10 | 82 |
| VIII Edad Industrial | 170 m | 6 | 33 | 4 | 12 | 96 |
| IX Edad Moderna | 185 m | 6 | 39 | 8 | 14 | 108 |
| X Edad Contemporánea | 200 m | 6 | 46 | 12 | 16 | 120 |

## 5. Tabla por edad: qué permite y con qué requisitos

### I. Edad Primitiva — Supervivencia

Ramas, pieles y piedras apiladas. La colonia vive de lo que recoge.

**Cambia sola:** Refugios de ramas, hojas y pieles; fogata y pequeño espacio común; ropa sencilla de pieles.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Enramada de recolección | edificio | Coste: 10 madera · 1 trabajador |
| Zona de tala | edificio | Coste: 8 madera, 2 piedra · 1 trabajador |
| Pedrera | edificio | Coste: 10 madera · 1 trabajador |
| Recolector de lluvia | edificio | Coste: 8 madera, 4 fibras · 1 trabajador |
| Pila de troncos y cestas | edificio | Coste: 12 madera, 4 fibras |
| Choza de ramas | edificio | Coste: 18 madera, 6 fibras · Requiere un edificio Zona de tala terminado · Aloja a 2 |
| Atalaya de ramas | edificio | Coste: 10 madera, 6 fibras · Defensa 2 |

**Bienes nuevos:** comida, agua, madera, piedra, fibras.

### II. Edad de Piedra — Asentamiento estable

Chozas de barro y paja, senderos, tótem y herramientas de piedra pulida.

**Cambia sola:** Las chozas pasan a barro y paja; senderos de piedra alrededor del fuego y tótem de la tribu; ropa de pieles mejor cosida.

**Para llegar aquí:** 6 colonos · una vivienda · una zona de tala · una pedrera · una enramada de recolección. Ofrenda (se cobra una vez): 30 madera, 15 piedra, 10 fibras.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Choza de recolección | mejora | Mejora de «Enramada de recolección»: 20 madera, 8 fibras · Requiere un edificio Pedrera terminado · 1 trabajador |
| Cabaña del leñador | mejora | Mejora de «Zona de tala»: 25 madera, 5 piedra, 6 fibras · Requiere un edificio Pedrera terminado · 1 trabajador |
| Cantera | mejora | Mejora de «Pedrera»: 25 madera, 10 piedra, 6 fibras · Requiere un edificio Zona de tala terminado · 1 trabajador |
| Pozo simple | mejora | Mejora de «Recolector de lluvia»: 15 madera, 20 piedra, 5 fibras · 1 trabajador |
| Campo de cultivo | edificio | Coste: 14 madera, 6 fibras · Requiere un edificio Recolector de lluvia terminado · 4 grano cada 60 s · 1 trabajador |
| Pozo de arcilla | edificio | Coste: 10 madera, 4 piedra · 3 arcilla cada 40 s · 1 trabajador |
| Granero | mejora | Mejora de «Pila de troncos y cestas»: 30 madera, 10 piedra, 12 fibras · Requiere un edificio Enramada de recolección terminado |
| Choza de barro | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 24 madera, 8 piedra, 8 fibras · Aloja a 3 |
| Puesto de vigilancia | mejora | Mejora de «Atalaya de ramas»: 24 madera, 8 piedra, 8 fibras · Defensa 4 |
| Empalizada | edificio | Coste: 8 madera, 4 fibras · Defensa 1 |

**Bienes nuevos:** grano, arcilla.

**Caminos:** Camino de tierra (×1.25, 1 fibras por casilla de 4 m).

### III. Edad del Bronce — Primeros talleres

Adobe con vigas y techos de caña, minas, fundición y herramientas de bronce.

**Cambia sola:** Casas de adobe con vigas y techo de caña; plaza empedrada y caminos marcados; tejidos teñidos y cintas de cuero.

**Para llegar aquí:** 9 colonos · un campo de cultivo · un pozo de arcilla · un pozo simple (nivel 2) · un granero (nivel 2) · haber producido 20 de grano · haber producido 15 de arcilla. Ofrenda (se cobra una vez): 60 madera, 40 piedra, 20 fibras.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Campos con arado de bronce | mejora | Mejora de «Campo de cultivo»: 20 madera, 2 herramientas de bronce, 8 fibras · 6 grano cada 60 s · 1 trabajador |
| Mina de cobre | edificio | Coste: 18 madera, 6 piedra · Sobre un yacimiento de cobre · 3 cobre cada 40 s · 1 trabajador |
| Mina de estaño | edificio | Coste: 18 madera, 6 piedra · Sobre un yacimiento de estaño · 2 estaño cada 40 s · 1 trabajador |
| Almacén de adobe | mejora | Mejora de «Granero»: 30 madera, 20 arcilla, 4 cerámica · Requiere un edificio Alfarería terminado |
| Casa de adobe | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 20 madera, 12 arcilla, 10 fibras · Aloja a 3 |
| Fundición de bronce | edificio | Coste: 24 madera, 24 piedra, 10 arcilla · Requiere un edificio Mina de cobre terminado · Requiere un edificio Mina de estaño terminado · 2 cobre, 1 estaño, 1 madera → 2 bronce cada 40 s · 1 trabajador |
| Taller de herramientas | edificio | Coste: 24 madera, 16 piedra, 8 fibras · Requiere un edificio Fundición de bronce terminado · 1 bronce, 1 madera → 1 herramientas de bronce cada 30 s · 1 trabajador |
| Alfarería | edificio | Coste: 18 madera, 10 piedra, 8 arcilla · Requiere un edificio Pozo de arcilla terminado · 2 arcilla, 1 madera → 2 cerámica cada 36 s · 1 trabajador |
| Horno de pan | edificio | Coste: 20 madera, 14 piedra, 6 arcilla · Requiere un edificio Campo de cultivo terminado · 3 grano, 1 madera → 3 pan cada 40 s · 1 trabajador |
| Cuartel inicial | edificio | Coste: 40 madera, 30 piedra, 2 herramientas de bronce · Requiere un edificio Taller de herramientas terminado · Guarnición 6 |
| Armería | edificio | Coste: 30 madera, 24 piedra, 2 herramientas de bronce · Requiere un edificio Cuartel inicial terminado · 2 bronce, 1 madera → 1 armas de bronce cada 40 s · 1 trabajador |

**Unidades:** Lancero (barracks, equipo armas de bronce, poder 3).

**Bienes nuevos:** cobre, estaño, bronce, herramientas de bronce, cerámica, pan, armas de bronce.

### IV. Edad del Hierro — Especialización

Casas de madera y piedra, hierro, carbón vegetal y oficios especializados.

**Cambia sola:** Casas de madera sobre zócalo de piedra; el centro gana un pozo de piedra y puestos de oficio; ropa de lana y delantales de herrero.

**Para llegar aquí:** 12 colonos · una fundición de bronce · un taller de herramientas · una alfarería · un horno de pan · una mina de cobre · una mina de estaño · haber producido 6 de herramientas de bronce · haber producido 12 de pan. Ofrenda (se cobra una vez): 90 madera, 60 piedra, 12 bronce.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Casa del recolector | mejora | Mejora de «Choza de recolección»: 30 madera, 10 fibras, 2 herramientas de bronce · 1 trabajador |
| Campamento maderero | mejora | Mejora de «Cabaña del leñador»: 35 madera, 10 piedra, 2 herramientas de hierro · 1 trabajador |
| Cantera de cuñas | mejora | Mejora de «Cantera»: 30 madera, 20 piedra, 2 herramientas de hierro · 1 trabajador |
| Mina de hierro | edificio | Coste: 18 madera, 6 piedra · Sobre un yacimiento de mineral de hierro · 3 mineral de hierro cada 40 s · 1 trabajador |
| Almacén reforzado | mejora | Mejora de «Almacén de adobe»: 40 madera, 30 piedra, 1 herramientas de hierro |
| Casa de madera y piedra | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 28 madera, 18 piedra, 3 cerámica · Aloja a 4 |
| Carbonera | edificio | Coste: 22 madera, 12 piedra, 6 arcilla · 4 madera → 2 carbón vegetal cada 44 s · 1 trabajador |
| Horno de hierro | edificio | Coste: 26 madera, 30 piedra, 12 arcilla · Requiere un edificio Mina de hierro terminado · Requiere un edificio Carbonera terminado · 2 mineral de hierro, 1 carbón vegetal → 1 hierro cada 44 s · 1 trabajador |
| Herrería | edificio | Coste: 24 madera, 24 piedra, 2 herramientas de bronce · Requiere un edificio Horno de hierro terminado · 1 hierro, 1 madera → 2 herramientas de hierro cada 36 s · 1 trabajador |
| Fragua de armas | mejora | Mejora de «Armería»: 20 piedra, 2 herramientas de hierro, 20 madera · 2 hierro, 1 carbón vegetal → 1 armas de hierro cada 40 s · 1 trabajador |
| Campo de tiro | edificio | Coste: 40 madera, 20 piedra, 2 herramientas de hierro · Requiere un edificio Cuartel inicial terminado · Guarnición 4 |
| Torre de vigilancia | mejora | Mejora de «Puesto de vigilancia»: 30 madera, 24 piedra, 2 herramientas de hierro · Defensa 8 |
| Muro de madera y tierra | mejora | Mejora de «Empalizada»: 14 madera, 8 piedra, 1 herramientas de hierro · Defensa 2 |
| Fortín | edificio | Coste: 50 madera, 50 piedra, 3 herramientas de hierro · Requiere un edificio Cuartel inicial terminado · Defensa 12 · Guarnición 6 |

**Unidades:** Espadachín (barracks, equipo armas de hierro, poder 5); Arquero (archery, equipo armas de hierro, poder 4).

**Bienes nuevos:** mineral de hierro, carbón vegetal, hierro, herramientas de hierro, armas de hierro.

### V. Edad Clásica — Organización urbana

Mampostería, plaza y edificios cívicos, agua canalizada y comercio de excedentes.

**Cambia sola:** Casas de mampostería con tejas y barrios ordenados; plaza con fuente y calles empedradas; túnicas y mantos de tela.

**Para llegar aquí:** 16 colonos · una mina de hierro · un horno de hierro · una herrería · una carbonera · un cuartel · haber producido 8 de herramientas de hierro. Ofrenda (se cobra una vez): 120 madera, 100 piedra, 12 hierro.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Pozo con noria | mejora | Mejora de «Pozo simple»: 10 sillares, 6 cerámica, 20 madera · 1 trabajador |
| Granja de arado de hierro | mejora | Mejora de «Campos con arado de bronce»: 30 madera, 3 herramientas de hierro, 6 sillares · 9 grano cada 60 s · 1 trabajador |
| Arcillar con carros | mejora | Mejora de «Pozo de arcilla»: 20 madera, 2 herramientas de hierro, 4 sillares · 6 arcilla cada 40 s · 1 trabajador |
| Mina de cobre profunda | mejora | Mejora de «Mina de cobre»: 30 madera, 2 herramientas de hierro, 10 piedra · 5.1 cobre cada 40 s · 1 trabajador |
| Mina de estaño profunda | mejora | Mejora de «Mina de estaño»: 30 madera, 2 herramientas de hierro, 10 piedra · 3.4 estaño cada 40 s · 1 trabajador |
| Almacén de piedra | mejora | Mejora de «Almacén reforzado»: 20 sillares, 30 madera, 6 cerámica |
| Casa de mampostería | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 14 sillares, 20 madera, 6 cerámica · Aloja a 4 |
| Horno mejorado | mejora | Mejora de «Fundición de bronce»: 14 sillares, 20 madera, 1 herramientas de hierro · 2 cobre, 1 estaño, 1 madera → 3 bronce cada 36 s · 1 trabajador |
| Taller de herramientas de hierro | mejora | Mejora de «Taller de herramientas»: 12 sillares, 20 madera, 1 herramientas de hierro · Requiere un edificio Horno de hierro terminado · 1 hierro, 1 madera → 1 herramientas de hierro cada 30 s · 1 trabajador |
| Taller de cantería | edificio | Coste: 24 madera, 30 piedra, 2 herramientas de hierro · 3 piedra → 2 sillares cada 36 s · 1 trabajador |
| Acueducto | edificio | Coste: 30 sillares, 30 madera, 8 cerámica · Requiere un edificio Recolector de lluvia de nivel 3 terminado · 12 agua cada 60 s · 1 trabajador |
| Mercado | edificio | Coste: 16 sillares, 30 madera, 6 cerámica · 1 trabajador |
| Casa del consejo | edificio | Coste: 20 sillares, 40 madera, 6 cerámica · 1 trabajador |
| Cuartel | mejora | Mejora de «Cuartel inicial»: 20 sillares, 30 madera, 2 herramientas de hierro · Guarnición 10 |
| Muro de piedra | mejora | Mejora de «Muro de madera y tierra»: 10 sillares, 8 madera · Defensa 4 |

**Unidades:** Legionario (barracks, equipo armas de hierro, poder 7).

**Bienes nuevos:** sillares, monedas.

**Caminos:** Camino empedrado (×1.45, 2 piedra por casilla de 4 m).

### VI. Edad Medieval — Ciudad y oficios

Entramado de madera y piedra, tablones, harina, pan, tejidos, murallas y caballería.

**Cambia sola:** Casas de entramado con tejados elaborados; plaza urbana con calles diferenciadas; jubones, capas y gremios con colores propios.

**Para llegar aquí:** 22 colonos · un mercado · un taller de cantería · un acueducto · una casa del consejo · haber producido 30 de sillares · haber producido 40 de monedas. Ofrenda (se cobra una vez): 40 sillares, 150 madera, 40 monedas.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Cantera con grúa | mejora | Mejora de «Cantera de cuñas»: 40 madera, 10 sillares, 3 herramientas de hierro · 1 trabajador |
| Mina de hierro profunda | mejora | Mejora de «Mina de hierro»: 30 madera, 3 herramientas de hierro, 8 sillares · 5.1 mineral de hierro cada 40 s · 1 trabajador |
| Almacén de tablones | mejora | Mejora de «Almacén de piedra»: 24 tablones, 12 sillares |
| Casa de entramado | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 16 tablones, 10 sillares, 4 tela · Aloja a 5 |
| Horno cerámico | mejora | Mejora de «Alfarería»: 14 sillares, 20 madera · 2 arcilla, 1 madera → 4 cerámica cada 32 s · 1 trabajador |
| Panadería | mejora | Mejora de «Horno de pan»: 10 sillares, 20 madera, 4 cerámica · Requiere un edificio Molino terminado · 3 harina, 1 madera → 8 pan cada 40 s · 1 trabajador |
| Carbonera de hornos | mejora | Mejora de «Carbonera»: 10 sillares, 20 madera, 4 cerámica · 4 madera → 3 carbón vegetal cada 40 s · 1 trabajador |
| Horno de fundición | mejora | Mejora de «Horno de hierro»: 16 sillares, 20 madera, 2 herramientas de hierro · 2 mineral de hierro, 1 carbón vegetal → 2 hierro cada 40 s · 1 trabajador |
| Herrería avanzada | mejora | Mejora de «Herrería»: 14 sillares, 10 tablones, 2 herramientas de hierro · 1 hierro, 1 carbón vegetal → 4 herramientas de hierro cada 34 s · 1 trabajador |
| Aserradero | edificio | Coste: 30 madera, 8 sillares, 2 herramientas de hierro · 3 madera → 2 tablones cada 30 s · 1 trabajador |
| Molino | edificio | Coste: 30 madera, 10 sillares, 2 herramientas de hierro · Requiere un edificio Campo de cultivo terminado · 3 grano → 3 harina cada 30 s · 1 trabajador |
| Taller textil | edificio | Coste: 30 madera, 10 tablones, 12 fibras · Requiere un edificio Aserradero terminado · 4 fibras → 2 tela cada 32 s · 1 trabajador |
| Mercado cubierto | mejora | Mejora de «Mercado»: 20 tablones, 14 sillares · 1 trabajador |
| Cuartel mejorado | mejora | Mejora de «Cuartel»: 30 sillares, 20 tablones, 3 herramientas de hierro · Guarnición 16 |
| Armería medieval | mejora | Mejora de «Fragua de armas»: 14 sillares, 12 tablones, 3 herramientas de hierro · 2 hierro, 1 tablones, 1 tela → 1 armas forjadas cada 38 s · 1 trabajador |
| Galería de ballesteros | mejora | Mejora de «Campo de tiro»: 20 sillares, 14 tablones, 2 herramientas de hierro · Guarnición 8 |
| Establo | edificio | Coste: 24 tablones, 14 sillares, 2 herramientas de hierro · Requiere un edificio Cuartel inicial de nivel 3 terminado · Requiere un edificio Campo de cultivo terminado · Guarnición 4 |
| Taller de asedio | edificio | Coste: 30 tablones, 20 sillares, 3 herramientas de hierro · Requiere un edificio Cuartel inicial de nivel 3 terminado · Guarnición 2 |
| Torre de piedra | mejora | Mejora de «Torre de vigilancia»: 24 sillares, 12 tablones, 3 herramientas de hierro · Defensa 14 |
| Muralla | mejora | Mejora de «Muro de piedra»: 16 sillares, 6 tablones · Defensa 6 |
| Puerta de madera | edificio | Coste: 20 tablones, 12 sillares, 2 herramientas de hierro · Requiere un edificio Empalizada terminado · Defensa 3 |
| Castillo pequeño | mejora | Mejora de «Fortín»: 40 sillares, 24 tablones, 4 herramientas de hierro · Defensa 24 · Guarnición 12 |

**Unidades:** Hombre de armas (barracks, equipo armas forjadas, poder 10); Ballestero (archery, equipo armas forjadas, poder 8); Jinete (stable, equipo armas forjadas, poder 12); Catapulta (siege_shop, equipo armas forjadas, poder 14).

**Bienes nuevos:** tablones, harina, tela, armas forjadas.

### VII. Renacimiento — Comercio y conocimiento

Barrios densos, academia, manufacturas de precisión, rutas comerciales y artillería.

**Cambia sola:** Casas urbanas de dos plantas y barrios más densos; plaza comercial con farolas y banderolas; ropa de corte con cuellos y sombreros.

**Para llegar aquí:** 30 colonos · un aserradero · un molino · un taller textil · una panadería con harina (nivel 2) · una herrería avanzada (nivel 2) · haber producido 40 de tablones · haber producido 20 de tela · haber producido 40 de pan. Ofrenda (se cobra una vez): 60 tablones, 20 tela, 80 monedas.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Almacén de frutos | mejora | Mejora de «Casa del recolector»: 40 madera, 12 tablones, 6 tela · 1 trabajador |
| Gran maderería | mejora | Mejora de «Campamento maderero»: 40 madera, 20 tablones, 4 herramientas de hierro · 1 trabajador |
| Almacén comercial | mejora | Mejora de «Almacén de tablones»: 30 tablones, 8 tela, 20 monedas |
| Casa urbana | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 20 tablones, 14 sillares, 10 cerámica · Aloja a 5 |
| Taller de precisión | edificio | Coste: 20 tablones, 12 sillares, 3 herramientas de hierro · Requiere un edificio Herrería de nivel 2 terminado · 1 hierro, 1 tablones → 1 instrumentos de precisión cada 40 s · 1 trabajador |
| Molino de pólvora | edificio | Coste: 16 tablones, 16 sillares, 2 herramientas de hierro · Tecnología: Pólvora · 2 carbón vegetal, 2 piedra → 2 pólvora cada 40 s · 1 trabajador |
| Casa de comercio | mejora | Mejora de «Mercado cubierto»: 26 tablones, 8 tela, 30 monedas · 1 trabajador |
| Ayuntamiento | mejora | Mejora de «Casa del consejo»: 30 tablones, 20 sillares, 10 tela · 1 trabajador |
| Academia | edificio | Coste: 24 tablones, 20 sillares, 8 tela · Requiere un edificio Casa del consejo terminado · 1 tablones, 1 tela → 3 conocimiento cada 50 s · 1 trabajador |
| Arsenal de artillería | mejora | Mejora de «Taller de asedio»: 30 tablones, 20 sillares, 6 pólvora · Tecnología: Pólvora · Guarnición 4 |
| Bastión artillado | mejora | Mejora de «Torre de piedra»: 30 sillares, 8 pólvora, 4 herramientas de hierro · Tecnología: Pólvora · Defensa 24 |

**Unidades:** Cañón (siege_shop, equipo armas forjadas, poder 22).

**Tecnologías investigables:** Pólvora (30 de conocimiento); Industria (50 de conocimiento); Vapor (60 de conocimiento).

**Bienes nuevos:** pólvora, instrumentos de precisión, conocimiento.

**Caminos:** Calle adoquinada (×1.6, 1 sillares por casilla de 4 m).

### VIII. Edad Industrial — Mecanización

Ladrillo, acero, vapor, fábricas, estaciones y bloques de viviendas.

**Cambia sola:** Casas de ladrillo con chimeneas y bloques residenciales; zonas residenciales e industriales reconocibles; monos de obrero y chalecos.

**Para llegar aquí:** 40 colonos · una academia · un taller de precisión · una casa de comercio (nivel 3) · haber producido 8 de instrumentos de precisión · haber producido 60 de conocimiento · tecnología Industria · tecnología Vapor. Ofrenda (se cobra una vez): 150 monedas, 100 tablones, 10 instrumentos de precisión.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Cantera mecanizada | mejora | Mejora de «Cantera con grúa»: 8 acero, 2 maquinaria, 20 tablones · Consume energía (1) · 1 trabajador |
| Granja mecanizada | mejora | Mejora de «Granja de arado de hierro»: 2 maquinaria, 12 ladrillos, 4 acero · 14 grano cada 60 s · Consume energía (1) · 1 trabajador |
| Excavadora de vapor | mejora | Mejora de «Arcillar con carros»: 6 acero, 1 maquinaria, 10 tablones · 12 arcilla cada 40 s · Consume energía (1) · 1 trabajador |
| Mina de cobre industrial | mejora | Mejora de «Mina de cobre profunda»: 6 acero, 2 maquinaria, 10 tablones · 9 cobre cada 40 s · Consume energía (1) · 1 trabajador |
| Mina de estaño industrial | mejora | Mejora de «Mina de estaño profunda»: 6 acero, 2 maquinaria, 10 tablones · 6 estaño cada 40 s · Consume energía (1) · 1 trabajador |
| Mina de hierro industrial | mejora | Mejora de «Mina de hierro profunda»: 8 acero, 2 maquinaria, 10 tablones · 9 mineral de hierro cada 40 s · Consume energía (1) · 1 trabajador |
| Mina de carbón | edificio | Coste: 4 acero, 20 tablones, 1 maquinaria · Tecnología: Industria · Sobre un yacimiento de carbón mineral · 5 carbón mineral cada 40 s · Consume energía (1) · 1 trabajador |
| Depósito industrial | mejora | Mejora de «Almacén comercial»: 30 ladrillos, 8 acero, 20 tablones |
| Casa de ladrillo | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 20 ladrillos, 12 tablones, 6 cerámica · Aloja a 5 |
| Bloque residencial de ladrillo | edificio | Coste: 40 ladrillos, 24 tablones, 4 acero · Requiere un edificio Acueducto terminado · Requiere un edificio Casa del consejo terminado · Aloja a 12 |
| Fundición industrial | mejora | Mejora de «Horno mejorado»: 20 ladrillos, 6 acero, 1 maquinaria · 4 cobre, 2 estaño, 1 carbón mineral → 7 bronce cada 30 s · Consume energía (2) · 1 trabajador |
| Fábrica de herramientas | mejora | Mejora de «Taller de herramientas de hierro»: 16 ladrillos, 6 acero, 1 maquinaria · 1 acero, 1 tablones → 3 herramientas de hierro cada 24 s · Consume energía (2) · 1 trabajador |
| Panadería industrial | mejora | Mejora de «Panadería»: 16 ladrillos, 4 acero, 1 maquinaria · 6 harina, 1 carbón mineral → 20 pan cada 36 s · Consume energía (1) · 1 trabajador |
| Alto horno | mejora | Mejora de «Horno de fundición»: 24 ladrillos, 8 acero, 1 maquinaria · 4 mineral de hierro, 1 carbón mineral → 6 hierro cada 36 s · Consume energía (2) · 1 trabajador |
| Forja industrial | mejora | Mejora de «Herrería avanzada»: 16 ladrillos, 6 acero, 1 maquinaria · 1 acero, 1 carbón mineral → 8 herramientas de hierro cada 30 s · Consume energía (2) · 1 trabajador |
| Aserradero de piedra | mejora | Mejora de «Taller de cantería»: 6 acero, 1 maquinaria, 12 tablones · 6 piedra → 6 sillares cada 30 s · Consume energía (1) · 1 trabajador |
| Aserradero de vapor | mejora | Mejora de «Aserradero»: 6 acero, 1 maquinaria, 10 ladrillos · 6 madera → 6 tablones cada 26 s · Consume energía (2) · 1 trabajador |
| Molino de vapor | mejora | Mejora de «Molino»: 5 acero, 1 maquinaria, 10 ladrillos · 8 grano → 8 harina cada 26 s · Consume energía (1) · 1 trabajador |
| Fábrica textil | mejora | Mejora de «Taller textil»: 5 acero, 1 maquinaria, 10 ladrillos · 10 fibras → 8 tela cada 26 s · Consume energía (2) · 1 trabajador |
| Acería | edificio | Coste: 30 ladrillos, 4 herramientas de hierro, 20 tablones · Requiere un edificio Horno de hierro de nivel 3 terminado · Tecnología: Industria · 2 hierro, 1 carbón mineral → 2 acero cada 40 s · Consume energía (2) · 1 trabajador |
| Horno de ladrillos | edificio | Coste: 20 sillares, 30 madera, 2 herramientas de hierro · Requiere un edificio Pozo de arcilla terminado · Tecnología: Industria · 3 arcilla, 1 carbón mineral → 4 ladrillos cada 32 s · Consume energía (1) · 1 trabajador |
| Fábrica de maquinaria | edificio | Coste: 40 ladrillos, 8 acero, 20 tablones · Requiere un edificio Acería terminado · Tecnología: Industria · 2 acero, 1 tablones → 1 maquinaria cada 44 s · Consume energía (4) · 2 trabajadores |
| Caldera de vapor | edificio | Coste: 20 ladrillos, 4 herramientas de hierro, 12 tablones · Tecnología: Vapor · 1 carbón mineral →  cada 40 s · Produce energía (6) · 1 trabajador |
| Estación de transporte | edificio | Coste: 24 ladrillos, 16 tablones, 6 acero · Tecnología: Logística |
| Cuartel industrial | mejora | Mejora de «Cuartel mejorado»: 30 ladrillos, 8 acero, 20 tablones · Guarnición 24 |
| Arsenal industrial | mejora | Mejora de «Armería medieval»: 20 ladrillos, 8 acero, 1 maquinaria · 2 acero, 1 carbón mineral → 2 armas de acero cada 34 s · Consume energía (2) · 1 trabajador |
| Polígono de tiro | mejora | Mejora de «Galería de ballesteros»: 20 ladrillos, 6 acero, 14 tablones · Guarnición 12 |
| Cuadras mayores | mejora | Mejora de «Establo»: 24 tablones, 14 ladrillos, 3 herramientas de hierro · Guarnición 8 |
| Muralla reforzada | mejora | Mejora de «Muralla»: 14 ladrillos, 2 acero · Defensa 8 |
| Puerta reforzada | mejora | Mejora de «Puerta de madera»: 4 acero, 10 ladrillos · Defensa 6 |
| Fortaleza | mejora | Mejora de «Castillo pequeño»: 40 ladrillos, 10 acero, 20 tablones · Defensa 40 · Guarnición 20 |

**Unidades:** Fusilero (barracks, equipo armas de acero, poder 16); Tirador (archery, equipo armas de acero, poder 14); Dragón (stable, equipo armas de acero, poder 20).

**Tecnologías investigables:** Logística (70 de conocimiento); Electricidad (100 de conocimiento); Mecanización (90 de conocimiento); Medicina (80 de conocimiento); Educación (80 de conocimiento); Hormigón (90 de conocimiento).

**Bienes nuevos:** carbón mineral, acero, ladrillos, maquinaria, armas de acero.

### IX. Edad Moderna — Electrificación

Hormigón, electricidad, agua distribuida, carreteras, hospitales y centros educativos.

**Cambia sola:** Edificios de ladrillo y hormigón más altos; calles asfaltadas y farolas eléctricas; ropa moderna y batas.

**Para llegar aquí:** 52 colonos · una acería · una mina de carbón · una caldera de vapor · una fábrica · una estación · un horno de ladrillos · haber producido 40 de acero · haber producido 8 de maquinaria · haber producido 30 de ladrillos · tecnología Electricidad · tecnología Logística. Ofrenda (se cobra una vez): 80 acero, 60 ladrillos, 200 monedas.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Bomba eléctrica | mejora | Mejora de «Pozo con noria»: 6 acero, 10 hormigón, 1 maquinaria · Tecnología: Electricidad · Consume energía (1) · 1 trabajador |
| Mina de carbón mecanizada | mejora | Mejora de «Mina de carbón»: 8 acero, 2 maquinaria, 8 hormigón · 9 carbón mineral cada 40 s · Consume energía (2) · 1 trabajador |
| Almacén de hormigón | mejora | Mejora de «Depósito industrial»: 30 hormigón, 12 acero |
| Edificio de hormigón | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 20 hormigón, 6 acero, 8 ladrillos · Aloja a 6 |
| Bloque de hormigón | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 44 hormigón, 14 acero, 10 ladrillos · Aloja a 18 · Consume energía (1) |
| Taller de ingeniería | mejora | Mejora de «Taller de precisión»: 10 acero, 2 maquinaria, 14 ladrillos · 1 acero, 1 tablones → 4 instrumentos de precisión cada 36 s · Consume energía (2) · 1 trabajador |
| Fábrica de explosivos | mejora | Mejora de «Molino de pólvora»: 12 hormigón, 6 acero, 1 maquinaria · 1 carbón mineral, 2 piedra → 8 pólvora cada 34 s · Consume energía (1) · 1 trabajador |
| Ladrillería mecanizada | mejora | Mejora de «Horno de ladrillos»: 6 acero, 1 maquinaria, 8 hormigón · 6 arcilla, 1 carbón mineral → 10 ladrillos cada 28 s · Consume energía (2) · 1 trabajador |
| Planta de hormigón | edificio | Coste: 30 ladrillos, 8 acero, 1 maquinaria · Tecnología: Hormigón · 4 piedra, 2 arcilla, 1 carbón mineral → 4 hormigón cada 36 s · Consume energía (3) · 1 trabajador |
| Red de agua potable | mejora | Mejora de «Acueducto»: 8 acero, 14 hormigón, 1 maquinaria · 40 agua cada 60 s · Consume energía (1) · 1 trabajador |
| Caldera de alta presión | mejora | Mejora de «Caldera de vapor»: 6 acero, 1 maquinaria, 10 ladrillos · 1 carbón mineral →  cada 40 s · Produce energía (10) · 1 trabajador |
| Central térmica | edificio | Coste: 30 hormigón, 12 acero, 3 maquinaria · Tecnología: Electricidad · 1 carbón mineral →  cada 30 s · Produce energía (24) · 1 trabajador |
| Poste eléctrico | edificio | Coste: 8 madera, 4 cobre, 1 acero · Tecnología: Electricidad |
| Centro comercial | mejora | Mejora de «Casa de comercio»: 24 hormigón, 8 acero, 60 monedas · Consume energía (2) · 1 trabajador |
| Edificio municipal | mejora | Mejora de «Ayuntamiento»: 24 hormigón, 8 acero, 16 ladrillos · Consume energía (1) · 1 trabajador |
| Universidad | mejora | Mejora de «Academia»: 24 ladrillos, 6 acero, 6 instrumentos de precisión · 1 tablones, 1 instrumentos de precisión → 9 conocimiento cada 48 s · Consume energía (1) · 2 trabajadores |
| Hospital | edificio | Coste: 30 ladrillos, 10 hormigón, 6 acero · Requiere un edificio Acueducto de nivel 2 terminado · Tecnología: Medicina · Consume energía (2) · 1 trabajador |
| Escuela | edificio | Coste: 26 ladrillos, 8 hormigón, 4 instrumentos de precisión · Tecnología: Educación · Consume energía (1) · 1 trabajador |
| Fábrica de armamento | mejora | Mejora de «Arsenal industrial»: 20 hormigón, 10 acero, 2 maquinaria · 3 acero, 1 maquinaria → 2 equipo moderno cada 36 s · Consume energía (4) · 1 trabajador |
| Cocheras mecanizadas | edificio | Coste: 24 hormigón, 12 acero, 3 maquinaria · Requiere un edificio Cuartel inicial de nivel 4 terminado · Tecnología: Mecanización · Consume energía (2) · Guarnición 6 |
| Torre de hormigón | mejora | Mejora de «Bastión artillado»: 24 hormigón, 12 acero, 1 maquinaria · Defensa 36 |
| Muro de hormigón | mejora | Mejora de «Muralla reforzada»: 14 hormigón, 4 acero · Defensa 10 |
| Búnker | mejora | Mejora de «Fortaleza»: 40 hormigón, 16 acero · Defensa 60 · Guarnición 24 |

**Unidades:** Soldado moderno (barracks, equipo equipo moderno, poder 24); Vehículo blindado (motor_pool, equipo equipo moderno, poder 40).

**Tecnologías investigables:** Electrónica (160 de conocimiento); Automatización (200 de conocimiento).

**Bienes nuevos:** hormigón, equipo moderno.

**Caminos:** Carretera asfaltada (×1.9, 1 hormigón por casilla de 4 m).

### X. Edad Contemporánea — Ciudad avanzada

Barrios de alta capacidad, redes eficientes, electrónica y automatización.

**Cambia sola:** Edificios modernos de vidrio y hormigón y torres residenciales; plaza peatonal con iluminación; ropa técnica y uniformes de especialista.

**Para llegar aquí:** 66 colonos · una central eléctrica · una planta de hormigón · un hospital · una escuela · un bloque residencial · haber producido 40 de hormigón · tecnología Medicina · tecnología Educación · tecnología Hormigón. Ofrenda (se cobra una vez): 100 hormigón, 120 acero, 20 maquinaria, 300 monedas.

| Se desbloquea | Tipo | Detalle y requisitos |
|---|---|---|
| Granja automatizada | mejora | Mejora de «Granja mecanizada»: 4 maquinaria, 3 electrónica, 12 hormigón · 22 grano cada 60 s · Consume energía (3) · 1 trabajador |
| Mina de carbón automatizada | mejora | Mejora de «Mina de carbón mecanizada»: 14 acero, 4 maquinaria, 3 electrónica · 14 carbón mineral cada 40 s · Consume energía (3) · 1 trabajador |
| Almacén automatizado | mejora | Mejora de «Almacén de hormigón»: 36 hormigón, 16 acero, 4 electrónica · Consume energía (2) |
| Edificio moderno | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 26 hormigón, 10 acero, 2 electrónica · Aloja a 6 |
| Torre residencial | mejora | Evoluciona sola al llegar a esta edad (sin coste) · Una nueva cuesta 60 hormigón, 24 acero, 4 electrónica · Aloja a 26 · Consume energía (3) |
| Acería eléctrica | mejora | Mejora de «Acería»: 16 acero, 3 maquinaria, 14 hormigón · 3 hierro, 1 carbón mineral → 5 acero cada 34 s · Consume energía (5) · 1 trabajador |
| Fábrica automatizada | mejora | Mejora de «Fábrica de maquinaria»: 20 acero, 4 maquinaria, 4 electrónica · Tecnología: Automatización · 2 acero, 1 tablones → 3 maquinaria cada 38 s · Consume energía (7) · 1 trabajador |
| Planta de hormigón armado | mejora | Mejora de «Planta de hormigón»: 14 acero, 3 maquinaria, 10 hormigón · 6 piedra, 3 arcilla, 1 carbón mineral → 9 hormigón cada 32 s · Consume energía (4) · 1 trabajador |
| Fábrica de electrónica | edificio | Coste: 30 hormigón, 16 acero, 4 maquinaria · Tecnología: Electrónica · 2 cobre, 1 acero → 1 electrónica cada 44 s · Consume energía (6) · 2 trabajadores |
| Central eficiente | mejora | Mejora de «Central térmica»: 16 acero, 3 maquinaria, 3 electrónica · 1 carbón mineral →  cada 30 s · Produce energía (44) · 1 trabajador |
| Subestación | mejora | Mejora de «Poste eléctrico»: 4 acero, 6 cobre, 1 electrónica |
| Centro logístico | mejora | Mejora de «Estación de transporte»: 24 hormigón, 12 acero, 3 electrónica · Consume energía (2) |
| Centro de investigación | mejora | Mejora de «Universidad»: 26 hormigón, 12 acero, 4 electrónica · 1 instrumentos de precisión, 1 electrónica → 24 conocimiento cada 44 s · Consume energía (4) · 2 trabajadores |
| Hospital avanzado | mejora | Mejora de «Hospital»: 24 hormigón, 10 acero, 3 electrónica · Consume energía (3) · 1 trabajador |
| Centro educativo | mejora | Mejora de «Escuela»: 22 hormigón, 8 acero, 2 electrónica · Consume energía (2) · 1 trabajador |
| Complejo militar | mejora | Mejora de «Cuartel industrial»: 40 hormigón, 16 acero, 4 electrónica · Consume energía (3) · Guarnición 36 |
| Industria de defensa | mejora | Mejora de «Fábrica de armamento»: 24 hormigón, 14 acero, 4 electrónica · 3 acero, 1 electrónica → 2 equipo avanzado cada 36 s · Consume energía (5) · 1 trabajador |
| Parque de vehículos | mejora | Mejora de «Cocheras mecanizadas»: 26 hormigón, 14 acero, 4 electrónica · Consume energía (3) · Guarnición 10 |
| Torre automatizada | mejora | Mejora de «Torre de hormigón»: 24 hormigón, 16 acero, 4 electrónica · Consume energía (2) · Defensa 52 |
| Puerta automática | mejora | Mejora de «Puerta reforzada»: 12 hormigón, 8 acero, 2 electrónica · Consume energía (1) · Defensa 10 |

**Unidades:** Operador (barracks, equipo equipo avanzado, poder 36); Vehículo avanzado (motor_pool, equipo equipo avanzado, poder 60).

**Bienes nuevos:** electrónica, equipo avanzado.

### XI. Edad Futurista — Extensión opcional

Viviendas de muy alta capacidad, energía avanzada, automatización total y transporte futurista.

**Extensión opcional.** La arquitectura (edades, límites, catálogo, ropa, centro) admite una edad más, pero no se puede alcanzar ni tiene contenido.

## 6. Cadenas productivas

| Cadena | Pasos |
|---|---|
| Madera → tablones → construcciones elaboradas | tala → aserradero → casas, talleres, academia |
| Grano → harina → pan | campo → molino → panadería (el pan sacia más que las bayas) |
| Cobre + estaño → bronce → herramientas | minas (sobre yacimientos) → fundición → taller de herramientas |
| Hierro + combustible → herramientas y acero | mina → carbonera/alto horno → herrería → acería |
| Piedra + arcilla → sillares, cerámica, ladrillos, hormigón | cantería, alfarería, horno de ladrillos, planta de hormigón |
| Materias primas + energía → bienes industriales | caldera/central + red de postes → fábricas → maquinaria, electrónica |
| Excedentes → monedas → compras y mantenimiento | mercado (cupo diario) |
| Planchas + tela → conocimiento → tecnologías | academia → tecnologías que desbloquean la industria y la electricidad |
Yacimientos (se ven al elegir el sitio de una mina): cobre, estaño, mineral de hierro, carbón mineral.

Si una instalación se detiene, su ficha lo explica: sin trabajadores, falta de materiales, almacén lleno, sin energía o dotación incompleta. Los recursos básicos siguen participando en todas las cadenas nuevas (madera, piedra y fibras en costes y recetas).

## 7. Ejército y defensas

| Unidad | Edificio | Edad | Equipo | Coste | Mantenimiento/día | Poder |
|---|---|---|---|---|---|---|
| Lancero | barracks | 3 | armas de bronce | 4 comida | 1 comida | 3 |
| Espadachín | barracks | 4 | armas de hierro | 5 comida | 1 comida | 5 |
| Legionario | barracks | 5 | armas de hierro | 6 comida | 1 comida | 7 |
| Hombre de armas | barracks | 6 | armas forjadas | 8 comida | 1 comida, 1 monedas | 10 |
| Fusilero | barracks | 8 | armas de acero | 10 comida, 10 monedas | 1 comida, 1 monedas | 16 |
| Soldado moderno | barracks | 9 | equipo moderno | 12 comida, 20 monedas | 1 comida, 2 monedas | 24 |
| Operador | barracks | 10 | equipo avanzado | 14 comida, 30 monedas | 1 comida, 3 monedas | 36 |
| Arquero | archery | 4 | armas de hierro | 5 comida | 1 comida | 4 |
| Ballestero | archery | 6 | armas forjadas | 8 comida, 4 monedas | 1 comida, 1 monedas | 8 |
| Tirador | archery | 8 | armas de acero | 10 comida, 12 monedas | 1 comida, 1 monedas | 14 |
| Jinete | stable | 6 | armas forjadas | 12 comida, 6 monedas | 2 comida, 1 monedas | 12 |
| Dragón | stable | 8 | armas de acero | 14 comida, 14 monedas | 2 comida, 2 monedas | 20 |
| Catapulta | siege_shop | 6 | armas forjadas | 6 tablones, 4 comida | 1 comida, 1 monedas | 14 |
| Cañón | siege_shop | 7 | armas forjadas | 4 pólvora, 4 tablones, 10 monedas | 1 comida, 2 monedas | 22 |
| Vehículo blindado | motor_pool | 9 | equipo moderno | 4 acero, 1 maquinaria, 30 monedas | 1 comida, 3 monedas, 1 carbón mineral | 40 |
| Vehículo avanzado | motor_pool | 10 | equipo avanzado | 6 acero, 1 electrónica, 50 monedas | 1 comida, 4 monedas, 1 carbón mineral | 60 |

- **Reclutar** saca colonos adultos de la población civil (primero los libres, si no el menos hábil de los que trabajan, que deja su puesto); el ejército no pasa del 40 % de los adultos y cada edificio militar tiene su guarnición.
- **Mantenimiento** diario de comida y, desde edades avanzadas, monedas y carbón; si falta, las tropas rinden la mitad.
- **Modernizar** un soldado cuesta la unidad siguiente de su línea (equipo nuevo incluido); no ocurre solo al cambiar de edad.
- **Defensas** (atalayas, muros, puertas, fuertes) suman puntos de defensa; las que consumen energía sólo valen conectadas.
- **Capacidad militar** = poder de las tropas (con la ventaja infantería > caballería > tiradores > infantería) + defensas.
- **Incursiones (PvE):** desde la Edad del Bronce, cada 3 a 5 días tras 6 días de protección, sólo con el dueño conectado. Si la capacidad militar no alcanza la fuerza de la banda, se pierde hasta un 10 % de comida, madera, piedra y monedas; nunca se destruyen edificios ni se hiere a nadie.
- **Ataques entre jugadores: desactivados** (`PVP.enabled = false`). Reglas definidas para cuando se activen: 7 días de protección inicial, aldeas con el dueño desconectado intocables, máximo 1 edad de diferencia y sólo robo de recursos (nunca destrucción).

## 8. Mundo compartido, persistencia y rendimiento

- Cada aldea tiene su edad; los visitantes ven sus edificios, niveles, vestimenta y centro con el aspecto correcto (los nacidos o llegados se sincronizan con sus datos fijos).
- Se guardan edad, colonos (familia, soldados, hogar), edificios (nivel, ciclo, dotación), bienes, tecnologías, territorio, caminos y comercio. Las órdenes se validan en el servidor y se aplican de una en una (sin duplicar por solicitudes repetidas).
- Durante las desconexiones la colonia sigue simulándose como antes (producción incluida, sin incursiones ni llegadas de colonos).
- Rendimiento: una aldea de 120 colonos y 88 edificios cuesta unos 4 ms por paso de 0,1 s; los colonos lejanos se dibujan con un modelo simple de 2 piezas y sin animar; el estado completo ocupa unos 50–90 KB por segundo con 120 colonos.

## 9. Pruebas

`npm test` ejecuta: auditoría del catálogo (nada exige algo posterior, 10 edades alcanzables), la escalera de las 10 edades jugada de principio a fin, restricciones, economía (cadenas, energía, comercio, investigación, caminos), ejército, y el protocolo del servidor con dos jugadores.
