import * as THREE from 'three';

// Ciclo de día y noche: el planeta queda quieto y el Sol gira a su alrededor.
// El "punto subsolar" es el lugar del planeta donde es mediodía exacto.

export const DAY_LENGTH_SECONDS = 360; // un día completo dura 6 minutos a velocidad ×1
export const MOON_CYCLE_DAYS = 8; // días de juego entre dos lunas llenas

export class DayNight {
  constructor({ startLon = 0, startHour = 10 } = {}) {
    this.declination = THREE.MathUtils.degToRad(12); // el Sol no está en el ecuador: da estaciones
    // Colocamos el Sol de forma que en "startLon" sean las "startHour".
    this.subsolarLon = startLon - ((startHour - 12) / 24) * Math.PI * 2;
    this.speed = 1;
    this.elapsed = 0; // segundos de juego desde el comienzo
    this.startHour = startHour;
    this.sunDirection = new THREE.Vector3();
    // La Luna va algo por detrás del Sol en el cielo: el ángulo entre ambos marca la
    // fase (0 = luna nueva, π = luna llena). Empieza en cuarto creciente avanzado.
    this.moonPhase = 2.3;
    this.moonDeclination = THREE.MathUtils.degToRad(-6);
    this.moonDirection = new THREE.Vector3();
    this.update(0);
  }

  update(delta) {
    this.advance(delta * this.speed);
  }

  // Avanza "seconds" segundos de juego, sin importar la velocidad elegida.
  advance(seconds) {
    this.elapsed += seconds;
    this.subsolarLon -= (seconds / DAY_LENGTH_SECONDS) * Math.PI * 2;
    this.subsolarLon = THREE.MathUtils.euclideanModulo(this.subsolarLon, Math.PI * 2);
    const c = Math.cos(this.declination);
    this.sunDirection.set(
      c * Math.sin(this.subsolarLon),
      Math.sin(this.declination),
      c * Math.cos(this.subsolarLon),
    );

    this.moonPhase += (seconds / (DAY_LENGTH_SECONDS * MOON_CYCLE_DAYS)) * Math.PI * 2;
    this.moonPhase = THREE.MathUtils.euclideanModulo(this.moonPhase, Math.PI * 2);
    const moonLon = this.subsolarLon - this.moonPhase;
    const cm = Math.cos(this.moonDeclination);
    this.moonDirection.set(cm * Math.sin(moonLon), Math.sin(this.moonDeclination), cm * Math.cos(moonLon));
  }

  // Parte iluminada de la Luna vista desde el planeta (0 = nueva, 1 = llena).
  get moonIllumination() {
    return (1 - Math.cos(this.moonPhase)) / 2;
  }

  // Número de día (empieza en 1), contado desde la hora inicial.
  get day() {
    return 1 + Math.floor((this.elapsed / DAY_LENGTH_SECONDS + this.startHour / 24) % 1e9);
  }

  // Hora solar local (0–24) en una longitud dada.
  localHour(lon) {
    return THREE.MathUtils.euclideanModulo(12 + ((lon - this.subsolarLon) / (Math.PI * 2)) * 24, 24);
  }
}

export function formatHour(hour) {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
