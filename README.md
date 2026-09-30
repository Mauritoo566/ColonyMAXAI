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

## Cómo funciona la escala

El planeta tiene el radio real de la Tierra (6.371 km) y todo se mide en metros. El relieve está exagerado ×2,5 para que las montañas se vean desde el espacio.

El terreno es un *quadtree* sobre las 6 caras de un cubo proyectado a esfera: cada trozo tiene 24×24 celdas y, cuando la cámara se acerca, se divide en 4 trozos hijos con el doble de detalle, hasta celdas de unos 25 m. Los trozos se generan poco a poco (unos milisegundos por fotograma) para no congelar el juego.

## Estructura

- `index.html` – página y *import map* de Three.js
- `src/main.js` – escena, luces, estrellas, cielo y bucle de animación
- `src/controls.js` – cámara tipo globo terráqueo con zoom hasta el suelo
- `src/planet.js` – planeta: terreno, nubes y atmósfera
- `src/terrain.js` – terreno con nivel de detalle (LOD)
- `src/elevation.js` – escala del mundo y función de relieve
- `src/noise.js` – ruido simplex 3D usado para el relieve y las nubes
