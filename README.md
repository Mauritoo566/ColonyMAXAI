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
- Botón derecho, Shift + arrastrar o girar con dos dedos: rotar la vista
- Botones Pausa / ×1 / ×10 / ×60: velocidad del paso del tiempo (a ×1 un día dura 6 minutos)

## Día, noche y nubes

El Sol gira alrededor del planeta; la hora que se muestra es la hora solar del lugar que estás mirando. De noche una luz de luna azulada y más luz ambiente mantienen el paisaje visible, y el cielo pasa por tonos de atardecer.

Las nubes son cúmulos low poly con la base plana, en dos capas que existen siempre en todo el planeta: grandes sistemas nubosos y cúmulos pequeños repartidos en celdas de 1°. Cada celda genera siempre los mismos cúmulos, así que al acercarte no aparecen nubes nuevas: de lejos cada cúmulo es una sola bola y de cerca se separa en sus bolitas. El Sol proyecta la sombra de las nubes sobre el terreno con un mapa de sombras que se ajusta a la zona que estás mirando.

## Cómo funciona la escala

El planeta tiene el radio real de la Tierra (6.371 km) y todo se mide en metros. El relieve está exagerado ×2,5 para que las montañas se vean desde el espacio.

El terreno es un *quadtree* sobre las 6 caras de un cubo proyectado a esfera: cada trozo tiene 24×24 celdas y, cuando la cámara se acerca, se divide en 4 trozos hijos con el doble de detalle, hasta celdas de unos 25 m. Los trozos se generan poco a poco (unos milisegundos por fotograma) para no congelar el juego.

## Estructura

- `index.html` – página y *import map* de Three.js
- `src/main.js` – escena, luces, estrellas, cielo y bucle de animación
- `src/controls.js` – cámara tipo globo terráqueo con zoom hasta el suelo
- `src/planet.js` – planeta: terreno, nubes y atmósfera
- `src/clouds.js` – nubes (sistemas grandes y cúmulos cercanos)
- `src/daynight.js` – ciclo de día y noche
- `src/terrain.js` – terreno con nivel de detalle (LOD)
- `src/elevation.js` – escala del mundo y función de relieve
- `src/noise.js` – ruido simplex 3D usado para el relieve y las nubes
