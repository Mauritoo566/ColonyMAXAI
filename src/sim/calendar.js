// Calendario del mundo y estaciones. Es un módulo puro (sin Three.js ni reloj propio) que usan por
// igual el servidor y los navegadores: todos parten de "elapsed", los segundos de juego que cuenta el
// servidor desde que existe el mundo (server/game/world.js), así que dos jugadores cualesquiera ven la
// misma fecha y la misma estación en el mismo lugar.
//
// - Un día dura 6 minutos reales y un año 365 días exactos (sin bisiestos): 36 h 30 min reales.
// - El año empieza en el equinoccio de primavera del hemisferio norte: día 1 = primavera, verano desde
//   el día 93, otoño desde el 184 y invierno desde el 275 (cuartos de año: 91,25 días cada uno).
// - El hemisferio sur lo vive invertido. En los trópicos no hay cuatro estaciones sino épocas húmeda y
//   seca; en los polos mandan la luz y la oscuridad (la inclinación del Sol sale de la misma fecha).
// - La fecha sigue la hora real del servidor aunque el servidor esté caído: no se pausa. Lo que se
//   limita es el "ponerse al día" económico de cada colonia (dos días de juego), nunca el calendario.

export const DAY_LENGTH_SECONDS = 360; // un día completo dura 6 minutos a velocidad ×1
export const YEAR_DAYS = 365;
export const YEAR_SECONDS = YEAR_DAYS * DAY_LENGTH_SECONDS;
export const WORLD_START_HOUR = 12; // a las 12:00 del meridiano cero empezó el mundo
export const AXIAL_TILT = (23.44 * Math.PI) / 180;

const TAU = Math.PI * 2;
const deg = (d) => (d * Math.PI) / 180;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const smoothstep = (x, a, b) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// El calor llega con retraso respecto del Sol (el verano más caluroso es semanas después del solsticio).
const WARMTH_LAG = 0.11; // fracción de año (~40 días)
// Cuánto cambia la temperatura de un lugar de templado entre invierno y verano (en la escala de biomes.js).
export const SEASON_TEMP_AMP = 0.28;
// Cuánto afecta al calor de los colonos (menos que al paisaje: el primer invierno no puede ser una condena).
export const SEASON_AMBIENT_AMP = 0.1;

export const SEASONS = {
  spring: { id: 'spring', name: 'Primavera' },
  summer: { id: 'summer', name: 'Verano' },
  autumn: { id: 'autumn', name: 'Otoño' },
  winter: { id: 'winter', name: 'Invierno' },
  wet: { id: 'wet', name: 'Época de lluvias' },
  dry: { id: 'dry', name: 'Época seca' },
};
const NORTH_ORDER = ['spring', 'summer', 'autumn', 'winter'];

// Días contados (continuos) desde el origen del mundo: la parte entera es el índice del día.
export function dayCount(elapsed, startHour = WORLD_START_HOUR) {
  return elapsed / DAY_LENGTH_SECONDS + startHour / 24;
}

// La fecha del mundo en un instante:
//   day        número de día desde el principio (empieza en 1; es el «Día N» de siempre)
//   year       año (empieza en 1)
//   dayOfYear  1..365
//   phase      0..1: avance continuo dentro del año (0 = equinoccio de primavera del norte)
//   hour       hora del meridiano cero (0..24)
export function dateAt(elapsed, startHour = WORLD_START_HOUR) {
  const days = dayCount(elapsed, startHour);
  const dayIndex = Math.floor(days);
  const inYear = ((days % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  return {
    day: dayIndex + 1,
    year: 1 + Math.floor(dayIndex / YEAR_DAYS),
    dayOfYear: 1 + (((dayIndex % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS),
    phase: inYear / YEAR_DAYS,
    hour: (days - dayIndex) * 24,
  };
}

// Inclinación del Sol (declinación) en un instante: +23,44° en el solsticio de verano del norte.
export function declinationAt(elapsed, startHour = WORLD_START_HOUR) {
  return AXIAL_TILT * Math.sin(TAU * dateAt(elapsed, startHour).phase);
}

// La estación en un lugar y una fecha. sinLat = seno de la latitud (la "y" de la dirección unitaria).
//   id/name    estación (tropical: época de lluvias o seca)
//   warmth     -1 (lo más frío del año en ese lugar) .. +1 (lo más cálido); 0 en el ecuador
//   wetBias    -0,35 .. +0,35: cuánto más o menos llueve que de costumbre (monzón tropical)
//   amp        0..1: cuánto cambian las estaciones aquí (ecuador 0, latitudes medias 1)
//   progress   0..1 dentro de la estación
export function seasonAt(sinLat, phase) {
  const lat = Math.asin(Math.min(1, Math.max(-1, sinLat)));
  const abs = Math.abs(lat);
  const north = lat >= 0;
  const amp = smoothstep(abs, deg(3), deg(45));
  const warmth = amp * (north ? 1 : -1) * Math.sin(TAU * (phase - WARMTH_LAG));
  const monsoon = (north ? 1 : -1) * Math.sin(TAU * (phase - 0.02));
  const tropical = abs < deg(23.5);
  const wetBias = tropical ? 0.35 * monsoon * smoothstep(abs, deg(1), deg(9)) * (1 - smoothstep(abs, deg(20), deg(30))) : 0;
  let idx = Math.floor(phase * 4) % 4;
  if (!north) idx = (idx + 2) % 4;
  const useWetDry = abs < deg(12);
  const id = useWetDry ? (monsoon >= 0 || abs < deg(2) ? 'wet' : 'dry') : NORTH_ORDER[idx];
  return { ...SEASONS[id], warmth, wetBias, amp, tropical, polar: abs > deg(66), north, progress: (phase * 4) % 1 };
}

// Temperatura de un lugar en esa época (misma escala que biomes.js: 0 glacial .. 1 tropical).
export function effectiveTemperature(baseTemp, season) {
  return baseTemp + season.warmth * SEASON_TEMP_AMP;
}

// Cuánta nieve cubre un lugar (0..1) con esa temperatura.
export function snowCover(temp) {
  return smoothstep(temp, 0.3, 0.12);
}

// Cuánto crece lo que se siembra y rebrota (0,15 con helada .. 1,1 con calor): sirve a los cultivos y a
// que vuelvan a crecer las bayas. La época de lluvias tropical ayuda un poco; la seca, algo menos.
export function growthFactor(temp, season) {
  const g = 0.15 + 0.95 * smoothstep(temp, 0.02, 0.5);
  return Math.min(1.1, Math.max(0.15, g + season.wetBias * 0.3));
}
