import * as THREE from 'three';
import { createNoise3D, fbm } from './noise.js';
import { RADIUS, MAX_LAND_HEIGHT, SEED, surfaceHeight } from './elevation.js';

// Las nubes se forman con "bolitas" low poly (icosaedros con la base aplanada)
// agrupadas en cúmulos. Hay dos capas y las dos existen siempre, en todo el planeta:
//  - Sistemas nubosos grandes, visibles desde el espacio.
//  - Cúmulos pequeños repartidos por celdas de 1°. Cada celda genera siempre los
//    mismos cúmulos, así que al acercarte no aparecen nubes nuevas: de lejos cada
//    cúmulo se dibuja como una sola bola y de cerca se separa en sus bolitas.
//    Sólo se omiten los que ocupan menos de un píxel en pantalla.

export const HIGH_CLOUD_ALTITUDE = MAX_LAND_HEIGHT * 1.15;
const CELL = THREE.MathUtils.degToRad(1); // ~111 km
const MAX_CUMULUS_SIZE = 12_000;
const MIN_PIXELS = 1.5; // por debajo de esto el cúmulo no se ve y no se dibuja
const DETAIL_PIXELS = 30; // a partir de este tamaño en pantalla se dibuja con todas sus bolitas
const MAX_CUMULUS_INSTANCES = 60_000;

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

// Cúmulos de una celda: se calculan una sola vez y se guardan.
function cellClusters(i, j, lonCells) {
  const rand = seededRandom((i * 92821) ^ (j * 68917) ^ SEED);
  const center = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - (i + 0.5) * CELL, (j + 0.5) * CELL);
  const count = Math.floor(cloudCover(center) * 6 + 1.2 + rand() * 1.6);
  const clusters = [];
  for (let c = 0; c < count; c++) {
    const lat = (i + rand()) * CELL;
    const lon = ((j + rand()) % lonCells) * CELL;
    const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - lat, lon);
    const ground = Math.max(0, surfaceHeight(dir, 10));
    const base = RADIUS + ground + 1_200 + rand() * 1_800;
    const size = 3_000 + rand() * (MAX_CUMULUS_SIZE - 3_000);
    clusters.push({
      dir,
      base,
      size,
      seed: Math.floor(rand() * 4294967296),
      position: dir.clone().multiplyScalar(base),
    });
  }
  return clusters;
}

class CumulusField {
  constructor() {
    this.mesh = createInstanced(MAX_CUMULUS_INSTANCES);
    this.cache = new Map();
    this.lastPosition = new THREE.Vector3(Infinity, 0, 0);
    this.lastBuild = 0;
    this.cameraDir = new THREE.Vector3();
  }

  clusters(i, j, lonCells) {
    const key = i * 100000 + j;
    let list = this.cache.get(key);
    if (!list) {
      if (this.cache.size > 60_000) this.cache.clear();
      list = cellClusters(i, j, lonCells);
      this.cache.set(key, list);
    }
    return list;
  }

  update(camera, viewportHeight, now) {
    const altitude = camera.position.length() - RADIUS;
    const moved = this.lastPosition.distanceTo(camera.position);
    // Reconstruir sólo si la cámara se movió lo suficiente como para notarlo.
    if (moved < Math.max(100, altitude * 0.02) || now - this.lastBuild < 0.1) return;
    this.lastPosition.copy(camera.position);
    this.lastBuild = now;
    this.rebuild(camera, viewportHeight);
  }

  rebuild(camera, viewportHeight) {
    const camPos = camera.position;
    const camR = camPos.length();
    const pixelsPerRadian = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const maxDistance = (MAX_CUMULUS_SIZE * pixelsPerRadian) / MIN_PIXELS;

    const write = writer(this.mesh);
    const altitude = camR - RADIUS;
    if (altitude > maxDistance) {
      write.done(); // desde muy lejos ningún cúmulo llega a un píxel
      return;
    }

    // Región de la superficie a menos de maxDistance de la cámara y antes del horizonte.
    const cosLimit = (RADIUS * RADIUS + camR * camR - maxDistance * maxDistance) / (2 * RADIUS * camR);
    const horizonAngle = Math.acos(Math.min(1, RADIUS / camR)) + 0.03;
    const span = Math.min(horizonAngle, Math.acos(THREE.MathUtils.clamp(cosLimit, -1, 1)));

    const cameraDir = this.cameraDir.copy(camPos).divideScalar(camR);
    const lat0 = Math.asin(THREE.MathUtils.clamp(cameraDir.y, -1, 1));
    const lon0 = Math.atan2(cameraDir.x, cameraDir.z);
    const lonCells = Math.round((Math.PI * 2) / CELL);
    const iMin = Math.max(Math.floor((lat0 - span) / CELL), -90);
    const iMax = Math.min(Math.floor((lat0 + span) / CELL), 89);
    const cosSpan = Math.cos(span + CELL * 1.5);

    const origin = cameraDir.clone().multiplyScalar(RADIUS);
    this.mesh.position.copy(origin);
    const horizonDistance = Math.sqrt(Math.max(0, camR * camR - RADIUS * RADIUS));

    for (let i = iMin; i <= iMax; i++) {
      const latCos = Math.max(0.02, Math.cos((i + 0.5) * CELL));
      const lonSpan = Math.min(Math.PI, span / latCos + CELL);
      const j0 = Math.floor((lon0 - lonSpan) / CELL);
      const j1 = Math.floor((lon0 + lonSpan) / CELL);
      for (let j = j0; j <= j1 && j < j0 + lonCells; j++) {
        const jw = ((j % lonCells) + lonCells) % lonCells;
        for (const cluster of this.clusters(i, jw, lonCells)) {
          if (cluster.dir.dot(cameraDir) < cosSpan) continue;
          const distance = camPos.distanceTo(cluster.position);
          const pixels = (cluster.size / distance) * pixelsPerRadian;
          if (pixels < MIN_PIXELS) continue;
          // Detrás del horizonte (contando la altura de la nube) no se ve.
          if (distance > horizonDistance + Math.sqrt(cluster.base * cluster.base - RADIUS * RADIUS)) continue;

          const grow = THREE.MathUtils.smoothstep(pixels, MIN_PIXELS, MIN_PIXELS * 3);
          const rand = seededRandom(cluster.seed);
          if (pixels >= DETAIL_PIXELS) {
            addCumulus(write, rand, cluster.dir, cluster.base, cluster.size, 0.6, origin);
          } else {
            addBlob(write, cluster, grow, origin);
          }
        }
      }
    }
    write.done();
  }
}

// Un cúmulo lejano dibujado como una sola bola con su tamaño y forma aproximados.
function addBlob(write, cluster, grow, origin) {
  const width = cluster.size * 0.85 * grow;
  const height = cluster.size * 0.45 * grow;
  tmp.pos.copy(cluster.dir).multiplyScalar(cluster.base + height * 0.25).sub(origin);
  tmp.quat.setFromUnitVectors(Y_AXIS, cluster.dir);
  tmp.scale.set(width, height, width * 0.8);
  tmp.matrix.compose(tmp.pos, tmp.quat, tmp.scale);
  return write(tmp.matrix);
}

export function createClouds() {
  const group = new THREE.Group();
  group.name = 'clouds';
  const high = createHighClouds();
  const cumulus = new CumulusField();
  group.add(high, cumulus.mesh);

  let time = 0;
  return {
    object: group,
    update(delta, camera, viewportHeight) {
      time += delta;
      high.rotation.y += delta * 0.0015; // los grandes sistemas derivan despacio
      cumulus.update(camera, viewportHeight, time);
    },
  };
}
