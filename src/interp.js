// Movimiento fluido de lo que manda el servidor (colonos y animales, propios y ajenos): las posiciones llegan 10 veces por
// segundo y se dibujan un poco en el pasado, interpolando entre las dos muestras que rodean ese instante. Así el movimiento
// es continuo (sin tirones ni cambios de velocidad) aunque algún mensaje llegue tarde.

export const INTERP_DELAY = 0.2; // segundos de retraso al dibujar: dos pasos del servidor, aguanta jitter de la red
const MAX_SAMPLES = 8;
const JUMP = 8; // metros: un salto mayor (reconectar, volver a la pestaña) no se anima
const EXTRAPOLATE = 0.25; // segundos que se sigue la última velocidad si el siguiente mensaje se retrasa

export const clock = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

// Guarda la posición recién llegada de "obj" (un colono o un animal) con la hora de llegada.
export function pushSample(obj, x, z, facing, now = clock()) {
  const track = (obj.track ??= []);
  const last = track[track.length - 1];
  if (last && Math.hypot(x - last.x, z - last.z) > JUMP) track.length = 0;
  // Dos mensajes casi a la vez (llegaron juntos): el último reemplaza al anterior en vez de apilar tiempos iguales.
  if (last && now - last.t < 0.02 && track.length > 1) track.pop();
  track.push({ t: now, x, z, facing });
  if (track.length > MAX_SAMPLES) track.shift();
}

const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// Dónde dibujar "obj" ahora: { x, z, facing }, o null si no hay muestras (se usa la última posición conocida).
export function sampleTrack(obj, now = clock()) {
  const track = obj.track;
  if (!track?.length) return null;
  const t = now - INTERP_DELAY;
  const first = track[0];
  if (t <= first.t) return first;
  for (let i = track.length - 1; i > 0; i--) {
    const a = track[i - 1];
    const b = track[i];
    if (t >= a.t && t <= b.t) {
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, facing: turn(a.facing, b.facing, k) };
    }
  }
  // Pasó el último mensaje: se sigue un momento con la velocidad de los dos últimos y luego se queda quieto.
  const b = track[track.length - 1];
  const a = track[track.length - 2];
  if (!a || b.t <= a.t) return b;
  const dt = Math.min(EXTRAPOLATE, t - b.t);
  const vx = (b.x - a.x) / (b.t - a.t);
  const vz = (b.z - a.z) / (b.t - a.t);
  return { x: b.x + vx * dt, z: b.z + vz * dt, facing: b.facing };
}
