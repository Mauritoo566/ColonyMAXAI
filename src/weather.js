import * as THREE from 'three';
import { moisture } from './elevation.js';
import { DAY_LENGTH_SECONDS } from './daynight.js';

// Clima de la zona del campamento (o de donde mire la cámara si no hay campamento).
// Cambia cada pocas horas de juego entre despejado, nublado, lluvia y tormenta; en
// lugares húmedos llueve más y en los desiertos casi nunca. La lluvia:
//  - hace que el pozo rinda más (el aguatero llena las vasijas más rápido),
//  - hace que bayas y setas vuelvan a crecer antes y que brote vegetación nueva,
//  - enfría un poco y oscurece el cielo.

export const WEATHER = {
  clear: { id: 'clear', name: 'Despejado', icon: 'sun', rain: 0, clouds: 0 },
  cloudy: { id: 'cloudy', name: 'Nublado', icon: 'cloud', rain: 0, clouds: 0.6 },
  rain: { id: 'rain', name: 'Lluvia', icon: 'rain', rain: 0.65, clouds: 0.85 },
  storm: { id: 'storm', name: 'Tormenta', icon: 'storm', rain: 1, clouds: 1 },
};

const DAY = DAY_LENGTH_SECONDS;
const RAIN_DROPS = 2200;
const RAIN_BOX = 45; // metros alrededor de la cámara donde caen gotas
const RAIN_VISIBLE_CLEARANCE = 1_800; // más alto no se ven las gotas

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class WeatherSystem {
  constructor(scene) {
    this.state = WEATHER.clear;
    this.timer = 0.2 * DAY; // hasta el próximo cambio
    this.rain = 0; // intensidad actual de la lluvia (0–1), cambia con suavidad
    this.clouds = 0;
    this.humidity = 0; // humedad del lugar (-0,5 seco … 0,5 húmedo)
    this.rand = seededRandom(Date.now() & 0xffffffff);
    this.rainMesh = this.createRain();
    scene.add(this.rainMesh);
    this.up = new THREE.Vector3();
  }

  // El clima de cada lugar depende de su humedad.
  setPlace(dir) {
    this.humidity = moisture(dir.x, dir.y, dir.z);
  }

  // Probabilidades del próximo estado según el actual y la humedad del lugar.
  next() {
    const wet = THREE.MathUtils.clamp(0.5 + this.humidity * 1.4, 0.05, 0.95); // 0 desierto, 1 selva
    const r = this.rand();
    const s = this.state.id;
    let id;
    if (s === 'clear') id = r < 0.35 + wet * 0.3 ? 'cloudy' : 'clear';
    else if (s === 'cloudy') id = r < wet * 0.6 ? 'rain' : r < 0.75 ? 'clear' : 'cloudy';
    else if (s === 'rain') id = r < 0.18 * wet ? 'storm' : r < 0.6 ? 'cloudy' : 'rain';
    else id = r < 0.7 ? 'rain' : 'cloudy';
    this.state = WEATHER[id];
    // Cada estado dura entre 3 y 10 horas de juego.
    this.timer = (0.12 + this.rand() * 0.3) * DAY;
  }

  // gameDt: segundos de juego (sigue la velocidad del tiempo).
  update(gameDt, delta, camera, clearance) {
    this.timer -= gameDt;
    if (this.timer <= 0) this.next();
    // Transición suave (media hora de juego, más o menos).
    const k = 1 - Math.exp(-gameDt / 12);
    this.rain += (this.state.rain - this.rain) * k;
    this.clouds += (this.state.clouds - this.clouds) * k;
    this.updateRain(delta, camera, clearance);
  }

  // ---- Gotas de lluvia --------------------------------------------------------

  createRain() {
    const positions = new Float32Array(RAIN_DROPS * 6);
    this.drops = new Float32Array(RAIN_DROPS * 3);
    for (let i = 0; i < RAIN_DROPS; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * RAIN_BOX * 2;
      this.drops[i * 3 + 1] = Math.random() * RAIN_BOX;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: '#aac4dc', transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }

  updateRain(delta, camera, clearance) {
    const mesh = this.rainMesh;
    const visible = this.rain > 0.05 && clearance < RAIN_VISIBLE_CLEARANCE;
    mesh.visible = visible;
    if (!visible) return;
    // Caja de gotas alrededor de la cámara, con el "arriba" del planeta en ese punto.
    this.up.copy(camera.position).normalize();
    mesh.position.copy(camera.position).addScaledVector(this.up, -RAIN_BOX * 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.up);
    mesh.material.opacity = 0.25 + this.rain * 0.4;
    const count = Math.floor(RAIN_DROPS * Math.min(1, this.rain * 1.2));
    const speed = 22 + this.rain * 10;
    const length = 0.7 + this.rain * 0.8;
    const pos = mesh.geometry.attributes.position.array;
    const d = this.drops;
    for (let i = 0; i < count; i++) {
      let y = d[i * 3 + 1] - speed * delta;
      if (y < 0) y += RAIN_BOX;
      d[i * 3 + 1] = y;
      const x = d[i * 3];
      const z = d[i * 3 + 2];
      pos[i * 6] = x;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x + 0.08;
      pos[i * 6 + 4] = y + length;
      pos[i * 6 + 5] = z;
    }
    mesh.geometry.setDrawRange(0, count * 2);
    mesh.geometry.attributes.position.needsUpdate = true;
  }

  // ---- Guardado ------------------------------------------------------------------

  save() {
    return { state: this.state.id, timer: this.timer, rain: this.rain, clouds: this.clouds };
  }

  load(data) {
    if (!data || !WEATHER[data.state]) return;
    this.state = WEATHER[data.state];
    this.timer = data.timer ?? this.timer;
    this.rain = data.rain ?? this.state.rain;
    this.clouds = data.clouds ?? this.state.clouds;
  }
}
