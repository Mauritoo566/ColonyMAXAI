import * as THREE from 'three';
import { pickSurface } from './camp.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Plantar semillas de árbol a mano: activo, cada clic en el suelo gasta una semilla del
// almacén y planta donde se apunta (el árbol que nazca depende del bioma de ese lugar).

export class PlantTool {
  constructor({ scene, camera, canvas, colony }) {
    this.camera = camera;
    this.canvas = canvas;
    this.colony = colony;
    this.active = false;
    this.onChange = null; // la interfaz actualiza el botón
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();
    this.ghost = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.3, 32),
      new THREE.MeshBasicMaterial({ color: '#5fe08a', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.position.y = 0.3;
    this.ghost.visible = false;
    scene.add(this.ghost);

    canvas.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const hit = this.groundAt(e.clientX, e.clientY);
      this.ghost.visible = !!hit;
      if (hit) {
        this.ghost.position.copy(hit.point);
        this.ghost.quaternion.setFromUnitVectors(Y_AXIS, this.tmp.copy(hit.point).normalize());
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0) return;
      const hit = this.groundAt(e.clientX, e.clientY);
      if (!hit) return;
      const local = colony.toLocal(hit.point, this.tmp);
      const problem = colony.plantTreeSeed(local.x, local.z, colony.gameTime);
      colony.emit('notice', problem ?? 'Semilla plantada: tardará en crecer');
      if (problem?.startsWith('No quedan')) this.setActive(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active) this.setActive(false);
    });
  }

  groundAt(clientX, clientY) {
    if (!this.colony.camp) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return pickSurface(this.raycaster.ray, this.colony.camp.height);
  }

  setActive(active) {
    this.active = active && !!this.colony.camp && (this.colony.stock.tree_seed ?? 0) >= 1;
    this.ghost.visible = false;
    this.onChange?.(this.active);
  }

  update() {
    this.ghost.visible = this.ghost.visible && this.active;
  }
}
