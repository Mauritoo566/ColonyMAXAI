import * as THREE from 'three';
import { createNoise3D, fbm } from './noise.js';
import { RADIUS, MAX_LAND_HEIGHT, SEED, surfaceHeight } from './elevation.js';

// Las nubes se forman con "bolitas" low poly (icosaedros con la base aplanada)
// agrupadas en cúmulos. Hay dos capas:
//  - Sistemas nubosos grandes, alrededor de todo el planeta, visibles desde el espacio.
//  - Un campo de cúmulos pequeños que sólo existe alrededor de la cámara cuando está
//    cerca del suelo, y que se regenera (siempre igual) al moverse.

export const HIGH_CLOUD_ALTITUDE = MAX_LAND_HEIGHT * 1.15;
const LOCAL_FIELD_RADIUS = 220_000;
const LOCAL_FIELD_MAX_ALTITUDE = 450_000;
const LOCAL_CELL = THREE.MathUtils.degToRad(0.16); // ~18 km

const weatherNoise = createNoise3D(SEED + 2);

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Cobertura nubosa (0 = despejado, 1 = cubierto). La misma función decide dónde hay
// grandes sistemas y dónde se forman cúmulos locales, así ambas capas coinciden.
export function cloudCover(dir) {
  const n = fbm(weatherNoise, dir.x * 2.5, dir.y * 2.5, dir.z * 2.5, 4);
  // Menos nubes en las franjas de los desiertos (~25° de latitud).
  const lat = Math.abs(dir.y);
  const desertBand = Math.exp(-((lat - 0.42) ** 2) / 0.01) * 0.12;
  return THREE.MathUtils.clamp((n - desertBand + 0.12) * 2.2, 0, 1);
}

function createPuffGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#ffffff');
  const base = new THREE.Color('#c3cad6');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    if (y < -0.25) {
      y = -0.25; // base plana, como los cúmulos reales
      pos.setY(i, y);
    }
    c.copy(base).lerp(top, THREE.MathUtils.smoothstep(y, -0.25, 0.6));
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const puffGeometry = createPuffGeometry();
const cloudMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 1,
  metalness: 0,
  emissive: new THREE.Color('#2a3346'),
});

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmp = {
  east: new THREE.Vector3(),
  north: new THREE.Vector3(),
  offset: new THREE.Vector3(),
  pos: new THREE.Vector3(),
  up: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  spin: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  matrix: new THREE.Matrix4(),
};

function tangentFrame(up) {
  tmp.east.crossVectors(Y_AXIS, up);
  if (tmp.east.lengthSq() < 1e-8) tmp.east.set(1, 0, 0);
  tmp.east.normalize();
  tmp.north.crossVectors(up, tmp.east);
}

// Añade un cúmulo: varias bolitas con la base a la misma altura y más altas en el centro.
// "origin" se resta a las posiciones para que el InstancedMesh pueda estar centrado
// cerca de la cámara y no perder precisión.
function addCumulus(write, rand, up, baseRadius, size, flatness, origin) {
  tangentFrame(up);
  const puffs = 5 + Math.floor(rand() * 8);
  for (let p = 0; p < puffs; p++) {
    const angle = rand() * Math.PI * 2;
    const d = Math.sqrt(rand());
    const dist = d * size;
    tmp.offset
      .copy(tmp.east)
      .multiplyScalar(Math.cos(angle) * dist)
      .addScaledVector(tmp.north, Math.sin(angle) * dist * 0.7);

    const width = size * (0.35 + 0.35 * rand()) * (1 - 0.45 * d);
    const height = width * flatness * (0.7 + 0.6 * rand()) * (1.25 - 0.6 * d);

    tmp.up.copy(up).multiplyScalar(baseRadius).add(tmp.offset);
    const r = tmp.up.length();
    tmp.up.divideScalar(r);
    tmp.pos.copy(tmp.up).multiplyScalar(baseRadius + height * 0.25).sub(origin);

    tmp.quat.setFromUnitVectors(Y_AXIS, tmp.up);
    tmp.spin.setFromAxisAngle(Y_AXIS, rand() * Math.PI * 2);
    tmp.quat.multiply(tmp.spin);
    tmp.scale.set(width, height, width * (0.7 + 0.4 * rand()));
    tmp.matrix.compose(tmp.pos, tmp.quat, tmp.scale);
    if (!write(tmp.matrix)) return;
  }
}

function createInstanced(max) {
  const mesh = new THREE.InstancedMesh(puffGeometry, cloudMaterial, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function writer(mesh) {
  let i = 0;
  const max = mesh.instanceMatrix.count;
  const fn = (m) => {
    if (i >= max) return false;
    mesh.setMatrixAt(i++, m);
    return true;
  };
  fn.done = () => {
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  };
  return fn;
}

function createHighClouds() {
  const mesh = createInstanced(12000);
  const write = writer(mesh);
  const rand = seededRandom(SEED + 11);
  const dir = new THREE.Vector3();
  const origin = new THREE.Vector3();

  for (let attempt = 0; attempt < 40000; attempt++) {
    dir.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    const l = dir.lengthSq();
    if (l > 1 || l < 1e-4) continue;
    dir.normalize();
    if (rand() > cloudCover(dir) * 0.3) continue;
    const size = 50_000 + rand() * 130_000;
    const base = RADIUS + HIGH_CLOUD_ALTITUDE + rand() * 2_000;
    addCumulus(write, rand, dir, base, size, 0.22, origin);
  }
  write.done();
  return mesh;
}

class LocalCloudField {
  constructor() {
    this.mesh = createInstanced(10000);
    this.lastCenter = null;
    this.dir = new THREE.Vector3();
  }

  update(cameraDir, altitude) {
    const visible = altitude < LOCAL_FIELD_MAX_ALTITUDE;
    this.mesh.visible = visible;
    if (!visible) return;
    if (this.lastCenter && this.lastCenter.angleTo(cameraDir) * RADIUS < 12_000) return;
    this.lastCenter = cameraDir.clone();
    this.rebuild(cameraDir);
  }

  rebuild(center) {
    const lat0 = Math.asin(THREE.MathUtils.clamp(center.y, -1, 1));
    const lon0 = Math.atan2(center.x, center.z);
    const span = LOCAL_FIELD_RADIUS / RADIUS;
    const iLat0 = Math.floor((lat0 - span) / LOCAL_CELL);
    const iLat1 = Math.floor((lat0 + span) / LOCAL_CELL);
    const lonCells = Math.round((Math.PI * 2) / LOCAL_CELL);

    const origin = center.clone().multiplyScalar(RADIUS);
    this.mesh.position.copy(origin);
    const write = writer(this.mesh);
    const dir = this.dir;

    for (let i = iLat0; i <= iLat1; i++) {
      const lat = (i + 0.5) * LOCAL_CELL;
      if (Math.abs(lat) > Math.PI / 2) continue;
      const lonSpan = span / Math.max(0.05, Math.cos(lat));
      const j0 = Math.floor((lon0 - lonSpan) / LOCAL_CELL);
      const j1 = Math.floor((lon0 + lonSpan) / LOCAL_CELL);
      for (let j = j0; j <= j1; j++) {
        const jw = ((j % lonCells) + lonCells) % lonCells;
        const rand = seededRandom((i * 92821) ^ (jw * 68917) ^ SEED);
        dir.setFromSphericalCoords(1, Math.PI / 2 - lat, (jw + 0.5) * LOCAL_CELL);
        if (dir.angleTo(center) > span) continue;

        // Cuanta más cobertura, más cúmulos en la celda (de 0 a 4). Incluso con
        // buen tiempo aparece algún cúmulo suelto.
        const count = Math.floor(cloudCover(dir) * 3.5 + 0.35 + rand() * 0.8);
        for (let c = 0; c < count; c++) {
          const cLat = (i + rand()) * LOCAL_CELL;
          const cLon = (jw + rand()) * LOCAL_CELL;
          dir.setFromSphericalCoords(1, Math.PI / 2 - cLat, cLon);
          const ground = Math.max(0, surfaceHeight(dir, 10));
          const base = RADIUS + ground + 1_200 + rand() * 1_800;
          const size = 2_000 + rand() * 5_500;
          addCumulus(write, rand, dir, base, size, 0.6, origin);
        }
      }
    }
    write.done();
  }
}

export function createClouds() {
  const group = new THREE.Group();
  group.name = 'clouds';
  const high = createHighClouds();
  const local = new LocalCloudField();
  group.add(high, local.mesh);

  const cameraDir = new THREE.Vector3();
  return {
    object: group,
    update(delta, camera) {
      high.rotation.y += delta * 0.0015; // los grandes sistemas derivan despacio
      const altitude = camera.position.length() - RADIUS;
      cameraDir.copy(camera.position).normalize();
      local.update(cameraDir, altitude);
    },
  };
}
