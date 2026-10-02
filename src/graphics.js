// Calidad gráfica: cuánto le pide el juego a la tarjeta de video. Hay cuatro opciones en
// Configuración (Auto, Alta, Media, Baja) y se guarda en el navegador. Lo que cambia entre
// ellas es sólo el costo por píxel; el alcance de vista (qué tan lejos se ve cada cosa) es igual.
//
//   antialias       suavizado de bordes (MSAA): cuesta ~30 % de la tarjeta; sólo se elige al arrancar
//   simpleTerrain   terreno con luz simple (sin brillo especular): cuesta ~25 % menos
//   maxPixelRatio   resolución máxima (1 = un píxel del juego por píxel de pantalla)
//   minPixelRatio   hasta cuánto puede bajar sola la resolución si el equipo no llega a 60 FPS
//   shadows         sombras de las nubes sobre el terreno
//   detailBias      >1 = menos triángulos en el terreno
//
// Con "Auto" se elige Alta, o Media en equipos con pocos núcleos o poca memoria. En todas las
// opciones, la resolución baja y sube sola para sostener los 60 FPS (ver updateQuality en main.js).

const KEY = 'colonymaxai.quality';
const dpr = window.devicePixelRatio || 1;

export const PRESETS = {
  alta: { label: 'Alta', antialias: true, simpleTerrain: false, maxPixelRatio: Math.min(dpr, 2), minPixelRatio: 0.7, shadows: true, detailBias: 1 },
  media: { label: 'Media', antialias: false, simpleTerrain: true, maxPixelRatio: Math.min(dpr, 1.25), minPixelRatio: 0.6, shadows: true, detailBias: 1 },
  baja: { label: 'Baja', antialias: false, simpleTerrain: true, maxPixelRatio: 1, minPixelRatio: 0.5, shadows: false, detailBias: 1.4 },
};

function saved() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'alta' || value === 'media' || value === 'baja' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

// ¿Equipo flojo? Pocos núcleos o poca memoria (el navegador no dice mucho más que eso).
function looksOld() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  return cores <= 4 || memory <= 4;
}

const choice = saved();
const effective = choice === 'auto' ? (looksOld() ? 'media' : 'alta') : choice;
const query = new URLSearchParams(location.search);

export const graphics = {
  choice, // lo que eligió el jugador
  effective, // lo que se usa de verdad
  ...PRESETS[effective],
};
// Para comparar en pruebas: ?noaa, ?lambert, ?pr=1.5
if (query.has('noaa')) graphics.antialias = false;
if (query.has('lambert')) graphics.simpleTerrain = true;
if (query.has('pr')) graphics.maxPixelRatio = graphics.minPixelRatio = Number(query.get('pr'));

// Guarda la elección; el suavizado y el material del terreno sólo se pueden cambiar al arrancar.
export function setQuality(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
  location.reload();
}
