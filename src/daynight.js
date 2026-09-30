import * as THREE from 'three';

// Ciclo de día y noche: el planeta queda quieto y el Sol gira a su alrededor.
// El "punto subsolar" es el lugar del planeta donde es mediodía exacto.

export const DAY_LENGTH_SECONDS = 360; // un día completo dura 6 minutos a velocidad ×1

export class DayNight {
  constructor({ startLon = 0, startHour = 10 } = {}) {
    this.declination = THREE.MathUtils.degToRad(12); // el Sol no está en el ecuador: da estaciones
    // Colocamos el Sol de forma que en "startLon" sean las "startHour".
    this.subsolarLon = startLon - ((startHour - 12) / 24) * Math.PI * 2;
    this.speed = 1;
    this.sunDirection = new THREE.Vector3();
    this.update(0);
  }

  update(delta) {
    this.subsolarLon -= ((delta * this.speed) / DAY_LENGTH_SECONDS) * Math.PI * 2;
    this.subsolarLon = THREE.MathUtils.euclideanModulo(this.subsolarLon, Math.PI * 2);
    const c = Math.cos(this.declination);
    this.sunDirection.set(
      c * Math.sin(this.subsolarLon),
      Math.sin(this.declination),
      c * Math.cos(this.subsolarLon),
    );
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
