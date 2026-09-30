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

- Arrastrar con el ratón: girar la cámara alrededor del planeta
- Rueda del ratón: acercar / alejar

## Estructura

- `index.html` – página y *import map* de Three.js
- `src/main.js` – escena, cámara, luces, estrellas y bucle de animación
- `src/planet.js` – generación del planeta: terreno, océano, nubes y atmósfera
- `src/noise.js` – ruido simplex 3D usado para el relieve y las nubes
