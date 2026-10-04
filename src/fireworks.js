// Fuegos artificiales al subir de edad: cohetes que suben desde la aldea y estallan en el cielo (esferas, anillos y sauces dorados). Es un
// efecto del navegador que se lanza con el aviso global del servidor, así lo ven todos los que miran esa aldea. Las chispas son puntos con luz
// aditiva en coordenadas locales de la aldea (cerca del origen: sin problemas de precisión a escala de planeta).
import * as THREE from 'three';
import { RADIUS } from './elevation.js';

const MAX = 2600; // chispas vivas por espectáculo
const GRAVITY = 7; // m/s² hacia el suelo
const COLORS = ['#ff4d4d', '#ffd166', '#6ee7ff', '#9b8cff', '#7dff9b', '#ff9de2', '#ffffff', '#ffb347'];
const UP = new THREE.Vector3(0, 1, 0);
const shows = new Set();

const clock = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

// Un espectáculo: "launches" cohetes repartidos en el tiempo sobre la aldea.
class Show {
  constructor(scene, dir, height, { launches = 14, span = 11, seed = Math.random() } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(dir).multiplyScalar(RADIUS + height);
    this.group.quaternion.setFromUnitVectors(UP, dir);
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.base = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX); // segundos que le quedan (0 = libre)
    this.total = new Float32Array(MAX);
    this.cursor = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 60, 0), 400);
    this.material = new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3.6; // después de los caminos: las chispas bajas no quedan por debajo de ellos
    this.group.add(this.points);
    scene.add(this.group);
    // Guion: cuándo sale cada cohete y adónde.
    let s = Math.floor(seed * 1e9) >>> 0;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.rockets = [];
    for (let i = 0; i < launches; i++) {
      const a = rand() * Math.PI * 2;
      const r = 4 + rand() * 20;
      this.rockets.push({
        t: 0.3 + (i / launches) * span + rand() * 0.5,
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        top: 48 + rand() * 40,
        rise: 1.1 + rand() * 0.5,
        color: COLORS[Math.floor(rand() * COLORS.length)],
        type: ['peony', 'ring', 'willow', 'peony'][Math.floor(rand() * 4)],
        state: 'waiting',
        age: 0,
      });
    }
    this.rand = rand;
    this.time = 0;
    this.sparks = 0;
    this.bursts = 0;
  }

  spawn(x, y, z, vx, vy, vz, color, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.base[i * 3] = color.r;
    this.base[i * 3 + 1] = color.g;
    this.base[i * 3 + 2] = color.b;
    this.life[i] = life;
    this.total[i] = life;
  }

  burst(rocket) {
    this.bursts++;
    const color = new THREE.Color(rocket.color);
    const warm = new THREE.Color('#ffd27a');
    const { x, z } = rocket;
    const y = rocket.top;
    if (rocket.type === 'ring') {
      // Un anillo en un plano inclinado al azar.
      const tilt = this.rand() * Math.PI;
      const n = 70;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const sp = 20;
        const vx = Math.cos(a) * sp;
        const vy0 = Math.sin(a) * sp;
        this.spawn(x, y, z, vx, vy0 * Math.cos(tilt), vy0 * Math.sin(tilt), color, 2 + this.rand() * 0.4);
      }
    } else if (rocket.type === 'willow') {
      // Sauce: chispas doradas lentas que caen largo rato.
      for (let k = 0; k < 110; k++) {
        const th = this.rand() * Math.PI * 2;
        const ph = Math.acos(2 * this.rand() - 1);
        const sp = 7 + this.rand() * 9;
        this.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.8, Math.sin(ph) * Math.sin(th) * sp, warm, 3.2 + this.rand() * 1.2);
      }
    } else {
      for (let k = 0; k < 120; k++) {
        const th = this.rand() * Math.PI * 2;
        const ph = Math.acos(2 * this.rand() - 1);
        const sp = 15 + this.rand() * 9;
        this.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp, color, 1.8 + this.rand() * 0.8);
      }
    }
  }

  // Un paso. Devuelve false cuando terminó (todos los cohetes lanzados y sin chispas).
  update(dt) {
    this.time += dt;
    const orange = new THREE.Color('#ffb347');
    for (const r of this.rockets) {
      if (r.state === 'waiting' && this.time >= r.t) {
        r.state = 'rising';
        r.age = 0;
      }
      if (r.state === 'rising') {
        r.age += dt;
        const k = Math.min(1, r.age / r.rise);
        const y = r.top * (1 - (1 - k) * (1 - k)); // sube frenando
        // Estela del cohete.
        this.spawn(r.x + (this.rand() - 0.5) * 0.4, y, r.z + (this.rand() - 0.5) * 0.4, (this.rand() - 0.5) * 1.5, -2 - this.rand() * 2, (this.rand() - 0.5) * 1.5, orange, 0.6);
        this.spawn(r.x, y, r.z, 0, -1, 0, orange, 0.5);
        if (k >= 1) {
          r.state = 'done';
          this.burst(r);
        }
      }
    }
    let alive = 0;
    const damp = Math.pow(0.55, dt); // frenan por el aire
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      alive++;
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 2] *= damp;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damp - GRAVITY * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // Se apagan al final de su vida, con un parpadeo.
      const f = Math.max(0, this.life[i] / this.total[i]);
      const tw = 0.75 + 0.25 * Math.sin((this.time + i) * 40);
      const b = f * f * tw;
      this.col[i * 3] = this.base[i * 3] * b;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * b;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * b;
    }
    this.sparks = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    return alive > 0 || this.rockets.some((r) => r.state !== 'done');
  }

  dispose() {
    this.group.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

// Lanza el espectáculo sobre una aldea (dirección del campamento y altura de su terreno).
export function startFireworks(scene, dir, height, options) {
  const d = dir instanceof THREE.Vector3 ? dir.clone() : new THREE.Vector3(dir.x, dir.y, dir.z);
  const show = new Show(scene, d.normalize(), height, options);
  shows.add(show);
  return show;
}

let last = null;
export function updateFireworks(now = clock()) {
  const dt = last === null ? 0 : Math.min(0.1, Math.max(0, now - last));
  last = now;
  for (const s of [...shows]) {
    if (!s.update(dt)) {
      s.dispose();
      shows.delete(s);
    }
  }
}

// Para las pruebas.
export const showCount = () => shows.size;
