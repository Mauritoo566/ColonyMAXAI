import * as THREE from 'three';
import { Parts, mat, stick, v } from './modelKit.js';
import { centerDecals, centerProps } from './sim/centerLayout.js';

// Vista del centro del asentamiento: el pavimento, la plaza y las calles (marcas planas en el
// suelo) y los objetos fijos (fuente, pozo, farolas...) que aparecen solos al avanzar de edad
// (la lista y los sitios están en sim/centerLayout.js, que también los vuelve obstáculos).

const decalMaterials = new Map();
function decalMaterial(color) {
  let m = decalMaterials.get(color);
  if (!m) {
    // Sin "factor" (ver roadMesh.js): el pavimento queda unos centímetros sobre el suelo y no puede pintarse sobre lo que tiene delante.
    m = new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });
    decalMaterials.set(color, m);
  }
  return m;
}

const propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });

function propMesh(kind) {
  const p = new Parts();
  switch (kind) {
    case 'pots':
      for (const [x, z, s] of [[0, 0, 1], [0.55, 0.2, 0.7], [-0.4, 0.45, 0.8]]) p.add(new THREE.CylinderGeometry(0.28 * s, 0.22 * s, 0.6 * s, 8), '#b8683a', mat(x, 0.3 * s, z));
      break;
    case 'wellstone':
      p.add(new THREE.CylinderGeometry(0.95, 1.05, 0.9, 10), '#9a958c', mat(0, 0.45, 0));
      p.add(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 10), '#2a4a66', mat(0, 0.85, 0));
      stick(p, v(-0.9, 0, 0), v(-0.9, 2.2, 0), 0.07, '#6b4a2e', 5);
      stick(p, v(0.9, 0, 0), v(0.9, 2.2, 0), 0.07, '#6b4a2e', 5);
      p.add(new THREE.BoxGeometry(2.2, 0.1, 1.0), '#8a643c', mat(0, 2.25, 0));
      p.add(new THREE.ConeGeometry(1.4, 0.6, 4), '#a07a4a', mat(0, 2.6, 0, 0, Math.PI / 4, 0));
      break;
    case 'fountain':
      p.add(new THREE.CylinderGeometry(1.5, 1.6, 0.5, 14), '#c8c2b4', mat(0, 0.25, 0));
      p.add(new THREE.CylinderGeometry(1.3, 1.3, 0.06, 14), '#4a90b8', mat(0, 0.5, 0));
      p.add(new THREE.CylinderGeometry(0.25, 0.35, 1.2, 8), '#d8d2c4', mat(0, 1.1, 0));
      p.add(new THREE.CylinderGeometry(0.7, 0.3, 0.2, 10), '#c8c2b4', mat(0, 1.7, 0));
      p.add(new THREE.ConeGeometry(0.2, 0.9, 6), '#7ac0e0', mat(0, 2.15, 0));
      break;
    case 'banner':
      stick(p, v(0, 0, 0), v(0, 4.2, 0), 0.07, '#5a3a22', 5);
      p.add(new THREE.BoxGeometry(1.0, 1.5, 0.05), '#a8452d', mat(0.55, 3.4, 0));
      p.add(new THREE.BoxGeometry(1.0, 0.25, 0.06), '#e0c25a', mat(0.55, 3.0, 0));
      break;
    case 'lamp':
      stick(p, v(0, 0, 0), v(0, 3.2, 0), 0.07, '#3a3a40', 5);
      p.add(new THREE.BoxGeometry(0.4, 0.5, 0.4), '#f6e6a0', mat(0, 3.45, 0));
      p.add(new THREE.ConeGeometry(0.35, 0.3, 4), '#3a3a40', mat(0, 3.85, 0, 0, Math.PI / 4, 0));
      break;
    case 'bench':
      p.add(new THREE.BoxGeometry(1.7, 0.12, 0.5), '#8a5a34', mat(0, 0.5, 0));
      p.add(new THREE.BoxGeometry(1.7, 0.4, 0.08), '#8a5a34', mat(0, 0.85, -0.25));
      for (const x of [-0.7, 0.7]) p.add(new THREE.BoxGeometry(0.1, 0.5, 0.45), '#3a3a40', mat(x, 0.25, 0));
      break;
    case 'planter':
      p.add(new THREE.BoxGeometry(1.2, 0.5, 0.8), '#9a9a96', mat(0, 0.25, 0));
      p.add(new THREE.IcosahedronGeometry(0.5, 0), '#4a8a4a', mat(0, 0.8, 0));
      break;
    default:
      return null;
  }
  return p.mesh(propMaterial);
}

export class CenterView {
  constructor(sim) {
    this.sim = sim;
    this.group = new THREE.Group();
    this.group.name = 'center';
    this.key = '';
  }

  // Redibuja si cambió la edad o lo que ocupan los edificios (por si un objeto ya no cabe).
  refresh() {
    const sim = this.sim;
    if (!sim.camp) {
      this.clear();
      this.key = '';
      return;
    }
    const props = centerProps(sim.age, sim.buildings.map((b) => ({ x: b.x, z: b.z, r: b.def.footprint })));
    const key = `${sim.age}|${props.map((p) => p.id).join()}`;
    if (key === this.key) return;
    this.key = key;
    this.clear();
    const campH = sim.camp.height;
    for (const d of centerDecals(sim.age)) {
      let mesh;
      if (d.kind === 'disc') {
        mesh = new THREE.Mesh(new THREE.CircleGeometry(d.r, 40), decalMaterial(d.color));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.05;
      } else if (d.kind === 'ring') {
        mesh = new THREE.Mesh(new THREE.RingGeometry(d.r0, d.r1, 48), decalMaterial(d.color));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.07;
      } else if (d.kind === 'path') {
        const dx = d.to.x - d.from.x;
        const dz = d.to.z - d.from.z;
        const len = Math.hypot(dx, dz);
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, len), decalMaterial(d.color));
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = Math.atan2(dx, dz);
        mesh.position.set((d.from.x + d.to.x) / 2, d.w < 0.3 ? 0.09 : 0.06, (d.from.z + d.to.z) / 2);
      } else {
        // Piedras de paso a lo largo de un sendero.
        const dx = d.to.x - d.from.x;
        const dz = d.to.z - d.from.z;
        const len = Math.hypot(dx, dz);
        mesh = new THREE.Group();
        const n = Math.max(2, Math.floor(len / 1.0));
        for (let i = 0; i <= n; i++) {
          const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.05, 6), decalMaterial(d.color));
          stone.position.set(d.from.x + (dx * i) / n + Math.sin(i * 2.1) * 0.12, 0.05, d.from.z + (dz * i) / n + Math.cos(i * 1.7) * 0.12);
          mesh.add(stone);
        }
      }
      this.group.add(mesh);
    }
    for (const p of props) {
      const mesh = propMesh(p.kind);
      if (!mesh) continue;
      mesh.position.set(p.x, sim.heightAt(p.x, p.z) - campH, p.z);
      mesh.rotation.y = Math.atan2(-p.x, -p.z);
      this.group.add(mesh);
    }
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse?.((o) => o.geometry?.dispose());
    }
  }
}
