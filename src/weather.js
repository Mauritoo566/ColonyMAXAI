import * as THREE from 'three';
import { WeatherState, WEATHER } from './sim/weather.js';

// Clima que se ve: el estado (despejado, nublado, lluvia, tormenta) lo decide la
// simulación (sim/weather.js); aquí se agregan las gotas de lluvia alrededor de la cámara.
// Con campamento el clima es el de la colonia (lo manda el servidor); sin campamento se
// inventa uno para el lugar que se mira.

export { WEATHER };

const RAIN_DROPS = 2200;
const RAIN_BOX = 45; // metros alrededor de la cámara donde caen gotas
const RAIN_VISIBLE_CLEARANCE = 1_800; // más alto no se ven las gotas

export class WeatherSystem extends WeatherState {
  constructor(scene) {
    super(Date.now());
    this.rainMesh = this.createRain();
    scene.add(this.rainMesh);
    this.up = new THREE.Vector3();
  }

  // gameDt: segundos de juego (sigue la velocidad del tiempo).
  update(gameDt, delta, camera, clearance) {
    this.advance(gameDt);
    this.updateRain(delta, camera, clearance);
  }

  // Copia el clima de otro (el de la colonia) en lugar de decidir uno propio.
  follow(other, delta, camera, clearance) {
    this.state = other.state;
    this.rain = other.rain;
    this.clouds = other.clouds;
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
}
