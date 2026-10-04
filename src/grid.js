import * as THREE from 'three';
import { ROAD_CELL } from './sim/economy.js';
import { storageKey } from './storage.js';

// Cuadrícula de la aldea: una malla simétrica de 4 m centrada en la fogata (la misma de los
// caminos). Con la cuadrícula activa, los edificios se colocan y mueven pegados a ella y se
// dibuja sobre el terreno mientras se construye o se pintan caminos, para alinear todo.

export const GRID = ROAD_CELL;
const STEP = 2; // separación de los puntos de cada línea (siguen el relieve)

export class GridSystem {
  constructor({ scene, colony, isDrawing }) {
    this.colony = colony;
    this.isDrawing = isDrawing; // () => true mientras se coloca algo o se pintan caminos
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem(storageKey('grid')) !== '0';
    } catch {
      this.enabled = true;
    }
    this.group = new THREE.Group();
    this.group.name = 'grid';
    this.group.visible = false;
    scene.add(this.group);
    this.minor = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.34, depthWrite: false }));
    this.axes = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.55, depthWrite: false }));
    for (const m of [this.minor, this.axes]) {
      m.frustumCulled = false;
      m.renderOrder = 3;
      this.group.add(m);
    }
    this.key = '';
    this.onChange = null;
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName ?? '')) this.toggle();
    });
  }

  toggle(on = !this.enabled) {
    this.enabled = on;
    try {
      localStorage.setItem(storageKey('grid'), on ? '1' : '0');
    } catch {
      // Sin almacenamiento: vale sólo en esta sesión.
    }
    this.onChange?.();
  }

  // Pega una coordenada (metros del campamento) al centro de su casilla (o a una malla más fina, para los adornos pequeños).
  snap(v, step = GRID) {
    return this.enabled ? Math.round(v / step) * step : v;
  }

  build(R, camp) {
    const sim = this.colony;
    const lift = 0.2;
    const minor = [];
    const axes = [];
    const y = (x, z) => sim.heightAt(x, z) - camp.height + lift;
    const line = (out, fixed, vertical) => {
      const half = Math.sqrt(Math.max(0, R * R - fixed * fixed));
      for (let t = -half; t < half; t += STEP) {
        const t2 = Math.min(half, t + STEP);
        const [x1, z1, x2, z2] = vertical ? [fixed, t, fixed, t2] : [t, fixed, t2, fixed];
        out.push(x1, y(x1, z1), z1, x2, y(x2, z2), z2);
      }
    };
    // Las líneas pasan por los bordes de las casillas; los ejes, por el centro de la aldea.
    for (let c = GRID / 2; c <= R; c += GRID) {
      for (const f of [c, -c]) {
        line(minor, f, true);
        line(minor, f, false);
      }
    }
    line(axes, 0, true);
    line(axes, 0, false);
    this.minor.geometry.dispose();
    this.axes.geometry.dispose();
    this.minor.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(minor, 3));
    this.axes.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(axes, 3));
  }

  update() {
    const camp = this.colony.camp;
    const show = !!camp && this.enabled && this.isDrawing();
    this.group.visible = show;
    if (!show) return;
    this.group.position.copy(camp.position);
    this.group.quaternion.copy(camp.quaternion);
    const R = this.colony.territoryRadius;
    const key = `${R}|${camp.height}|${camp.seed}`;
    if (key !== this.key) {
      this.key = key;
      this.build(R, camp);
    }
  }
}
