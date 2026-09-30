// Herramientas para modelar objetos low poly con primitivas de Three.js. Todas las
// piezas se juntan en una sola malla con colores por vértice (una llamada de dibujo).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Utilidades de modelado: todas las piezas fijas se juntan en una sola malla con
// colores por vértice (una sola llamada de dibujo).
// ---------------------------------------------------------------------------

export class Parts {
  constructor() {
    this.list = [];
  }

  add(geometry, color, matrix) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    geometry.dispose?.();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.list.push(g);
    return this;
  }

  mesh(material) {
    const geometry = mergeGeometries(this.list, false);
    for (const g of this.list) g.dispose();
    this.list = [];
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }
}

const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

export function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  tmpEuler.set(rx, ry, rz);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    tmpQuat.setFromEuler(tmpEuler).clone(),
    new THREE.Vector3(sx, sy, sz),
  );
}

// Un palo (cilindro) entre dos puntos.
export function stick(parts, from, to, radius, color, segments = 5, base = null) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  const m = new THREE.Matrix4().compose(
    from.clone().add(to).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()),
    new THREE.Vector3(1, 1, 1),
  );
  if (base) m.premultiply(base);
  parts.add(new THREE.CylinderGeometry(radius * 0.85, radius, length, segments), color, m);
}

export function v(x, y, z) {
  return new THREE.Vector3(x, y, z);
}

export function triangle(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray()], 3));
  g.computeVertexNormals();
  return g;
}

export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function vary(color, rand, amount = 0.08) {
  const c = new THREE.Color(color);
  const k = 1 + (rand() - 0.5) * 2 * amount;
  return c.multiplyScalar(k);
}


// Geometría única (para InstancedMesh) a partir de piezas.
export function partsGeometry(build) {
  const parts = new Parts();
  build(parts);
  const geometry = mergeGeometries(parts.list, false);
  for (const g of parts.list) g.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}
