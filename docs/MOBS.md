# Mobs posibles (propuesta de diseño, sin implementar)

Criterio: aparecen por bioma y por edad; los pacíficos dan recursos o ambiente, los hostiles obligan a defenderse
(torres, murallas y soldados ya existen). Sin inmigración ni PvP: todo sale de la naturaleza.

## Pacíficos

| Mob | Biomas | Edad | Qué aporta |
|---|---|---|---|
| Conejo | pradera, bosque, estepa | I | Carne (comida) si se caza; ahuyenta con facilidad |
| Ciervo | bosque, taiga, pradera | I | Carne y pieles; manadas que migran |
| Jabalí (manso hasta que lo atacan) | bosque, selva | I | Carne; se defiende si lo hieren |
| Pájaros / aves de caza | todos con vegetación | I | Ambiente; algunas aves dan huevos |
| Peces | costa y agua dulce | I | Comida (pesca desde la orilla) |
| Cabra montesa | montaña, estepa | I | Leche y pieles; domesticable más adelante |
| Oveja salvaje | pradera, estepa | II | Lana y carne; domesticable |
| Vaca / uro | pradera | II | Carne, cuero y tiro (arado) |
| Caballo salvaje | estepa, sabana | III | Transporte rápido y caballería |
| Gallina / ave de corral | aldea | II | Huevos y carne en corrales |
| Cerdo doméstico | aldea | II | Carne en corrales |
| Camello | desierto | III | Carga en el desierto |
| Burro / buey | aldea | III | Carga y tiro |
| Mariposas y luciérnagas | pradera, selva | I | Sólo ambiente |

## Hostiles

| Mob | Biomas | Edad | Amenaza |
|---|---|---|---|
| Lobo | bosque, taiga, tundra | I | Manadas de noche; atacan a colonos aislados y al ganado |
| Oso | bosque, taiga, montaña | I | Fuerte y solitario; defiende su cueva; ataca por hambre |
| Serpiente venenosa | pantano, selva, desierto | I | Envenena a quien recoge cerca |
| Jabalí furioso | bosque | I | Embiste si se le cierra el paso |
| Zorro / chacal | estepa, desierto | I | Roba comida del acopio |
| Cocodrilo | pantano, río, selva | I | Ataca en la orilla (peligro al beber) |
| Escorpión gigante | desierto | II | Ataca grupos pequeños; veneno |
| Tigre / león | selva, sabana | II | Caza de noche; ataca a colonos y ganado |
| Hienas | sabana | II | En manada; roban y acosan |
| Lobo alfa (jefe de manada) | taiga, tundra | II | Manada coordinada |
| Bandidos / saqueadores | todos | III | Ya existen como incursiones (`military.js`) |
| Tribus rivales NPC | todos | III | Atacan puestos y ganado |
| Jabalí de guerra / búfalo en estampida | pradera | III | Evento que arrasa campos |
| Plagas (langostas, ratas) | todos | II | Destruyen reservas de comida (no matan) |
| Criaturas de hielo | polar | III | Frío extremo; sólo en regiones heladas |

## Cómo encajaría en el juego

- **Población**: un cazador (oficio nuevo) o los soldados cazan mobs pacíficos para comida; los colonos huyen de los hostiles.
- **Defensa**: las atalayas avisan; los muros y puestos de guardia reducen el daño; el ganado domesticado se protege con corrales.
- **Escasez**: la caza se agota o migra; los hostiles rondan más cuando hay poca caza (hambre de manada).
- **Edades**: Primitiva sólo trae animales de caza y pocos depredadores (lobos y osos de noche); desde Piedra, ganado y más peligros.
