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
const MIN_PIXELS = 2; // por debajo de esto el cúmulo casi no se ve y no se dibuja
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

function createPuffGeometry(detail) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
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

const puffGeometry = createPuffGeometry(1); // 80 triángulos: nubes cercanas
const blobGeometry = createPuffGeometry(0); // 20 triángulos: cúmulos lejanos (pocos píxeles)
// Parámetros del "hueco" en las nubes alrededor del centro de la pantalla, para que no
// tapen lo que estás mirando. main.js los actualiza en cada fotograma.
export const cloudFade = {
  focusDistance: { value: 1e9 }, // distancia de la cámara al punto del suelo en el centro
  strength: { value: 1 }, // 0 = desactivado (desde muy lejos), 1 = activo
  resolution: { value: new THREE.Vector2(1, 1) }, // tamaño del lienzo en píxeles
  innerRadius: { value: 0.22 }, // radio totalmente transparente (fracción del alto de pantalla)
  outerRadius: { value: 0.42 }, // a partir de aquí la nube es opaca
  nearDistance: { value: 1500 }, // nubes más cerca que esto se aclaran en toda la pantalla
  minOpacity: { value: 0.12 },
  // Para quitar también la sombra de las nubes del hueco (el mapa de sombras se dibuja
  // desde el Sol, así que necesita saber dónde está la cámara principal).
  viewProjection: { value: new THREE.Matrix4() },
  cameraPosition: { value: new THREE.Vector3() },
  aspect: { value: 1 },
};

// Cálculo del hueco compartido por el material de las nubes y el de su sombra.
const FADE_GLSL = /* glsl */ `
  uniform float uFocusDistance;
  uniform float uFadeStrength;
  uniform float uInnerRadius;
  uniform float uOuterRadius;
  uniform float uNearDistance;
  float cloudFadeAmount(vec2 fromCenter, float depth) {
    float radial = 1.0 - smoothstep(uInnerRadius, uOuterRadius, length(fromCenter));
    // Sólo las nubes que están delante de lo que miras (las nubes flotan al menos
    // 5 km sobre el suelo, así que basta un margen fijo en metros).
    float inFront = 1.0 - smoothstep(uFocusDistance - 1000.0, uFocusDistance - 200.0, depth);
    float nearCamera = 1.0 - smoothstep(uNearDistance * 0.5, uNearDistance, depth);
    return max(radial * inFront, nearCamera) * uFadeStrength;
  }
`;

function fadeUniforms() {
  return {
    uFocusDistance: cloudFade.focusDistance,
    uFadeStrength: cloudFade.strength,
    uInnerRadius: cloudFade.innerRadius,
    uOuterRadius: cloudFade.outerRadius,
    uNearDistance: cloudFade.nearDistance,
    uMinOpacity: cloudFade.minOpacity,
  };
}

const cloudMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 1,
  metalness: 0,
  emissive: new THREE.Color('#2a3346'),
  transparent: true,
});

cloudMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, fadeUniforms(), { uResolution: cloudFade.resolution });
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      `${FADE_GLSL}
      uniform vec2 uResolution;
      uniform float uMinOpacity;
      void main() {`,
    )
    .replace(
      '#include <opaque_fragment>',
      `{
        // Distancia al centro de la pantalla, en fracciones del alto.
        vec2 fromCenter = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
        float fade = cloudFadeAmount(fromCenter, length(vViewPosition));
        diffuseColor.a *= mix(1.0, uMinOpacity, fade);
      }
      #include <opaque_fragment>`,
    );
};

// Material de sombra: las nubes del hueco no proyectan sombra. Como el mapa de
// sombras no admite transparencia, se descartan píxeles con un patrón de puntos y el
// suavizado de la sombra lo convierte en una sombra más tenue.
const cloudDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
cloudDepthMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, fadeUniforms(), {
    uMainViewProjection: cloudFade.viewProjection,
    uMainCameraPosition: cloudFade.cameraPosition,
    uAspect: cloudFade.aspect,
  });
  shader.vertexShader = shader.vertexShader
    .replace(
      'void main() {',
      `varying vec3 vCloudWorld;
      void main() {`,
    )
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 cloudWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cloudWorld = instanceMatrix * cloudWorld;
      #endif
      vCloudWorld = (modelMatrix * cloudWorld).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      `${FADE_GLSL}
      uniform mat4 uMainViewProjection;
      uniform vec3 uMainCameraPosition;
      uniform float uAspect;
      uniform float uMinOpacity;
      varying vec3 vCloudWorld;
      void main() {
        vec4 clip = uMainViewProjection * vec4(vCloudWorld, 1.0);
        float fade = 0.0;
        if (clip.w > 0.0) {
          vec2 ndc = clip.xy / clip.w;
          fade = cloudFadeAmount(vec2(ndc.x * uAspect, ndc.y) * 0.5, distance(vCloudWorld, uMainCameraPosition));
        }
        float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        if (dither < fade * (1.0 - uMinOpacity)) discard;`,
    );
};

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

function createInstanced(max, geometry = puffGeometry) {
  const mesh = new THREE.InstancedMesh(geometry, cloudMaterial, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.customDepthMaterial = cloudDepthMaterial;
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
    // Sólo se envía a la tarjeta gráfica la parte usada del búfer.
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, Math.max(1, i) * 16);
    mesh.instanceMatrix.needsUpdate = true;
  };
  return fn;
}

// Los grandes sistemas se reparten en zonas (4×4 por cada cara de un cubo) para poder
// saltarse las que quedan detrás del planeta o fuera de la pantalla.
const HIGH_ZONES_PER_SIDE = 4;

function highZoneKey(dir) {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  let face, u, v;
  if (ax >= ay && ax >= az) [face, u, v] = [dir.x > 0 ? 0 : 1, dir.y / ax, dir.z / ax];
  else if (ay >= az) [face, u, v] = [dir.y > 0 ? 2 : 3, dir.x / ay, dir.z / ay];
  else [face, u, v] = [dir.z > 0 ? 4 : 5, dir.x / az, dir.y / az];
  const n = HIGH_ZONES_PER_SIDE;
  const iu = Math.min(n - 1, Math.floor(((u + 1) / 2) * n));
  const iv = Math.min(n - 1, Math.floor(((v + 1) / 2) * n));
  return face * n * n + iu * n + iv;
}

function createHighClouds() {
  const group = new THREE.Group();
  const rand = seededRandom(SEED + 11);
  const dir = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const zones = new Map();
  const position = new THREE.Vector3();

  const collect = (m) => {
    position.setFromMatrixPosition(m);
    const key = highZoneKey(position.clone().normalize());
    let zone = zones.get(key);
    if (!zone) zones.set(key, (zone = { matrices: [], center: new THREE.Vector3() }));
    zone.matrices.push(m.clone());
    zone.center.add(position);
    return true;
  };

  for (let attempt = 0; attempt < 40000; attempt++) {
    dir.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    const l = dir.lengthSq();
    if (l > 1 || l < 1e-4) continue;
    dir.normalize();
    if (rand() > cloudCover(dir) * 0.3) continue;
    const size = 50_000 + rand() * 130_000;
    const base = RADIUS + HIGH_CLOUD_ALTITUDE + rand() * 2_000;
    addCumulus(collect, rand, dir, base, size, 0.22, origin);
  }

  const meshes = [];
  for (const zone of zones.values()) {
    const mesh = createInstanced(zone.matrices.length);
    zone.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = zone.matrices.length;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = true;
    mesh.userData.direction = zone.center.normalize();
    // Radio angular de la zona (hasta la nube más lejana de su centro).
    let maxAngle = 0;
    for (const m of zone.matrices) {
      position.setFromMatrixPosition(m).normalize();
      maxAngle = Math.max(maxAngle, position.angleTo(mesh.userData.direction));
    }
    mesh.userData.angularRadius = maxAngle + 0.03;
    group.add(mesh);
    meshes.push(mesh);
  }

  const cameraDir = new THREE.Vector3();
  const zoneDir = new THREE.Vector3();
  group.userData.cull = (camera) => {
    const camR = camera.position.length();
    cameraDir.copy(camera.position).divideScalar(camR);
    // Ángulo hasta el horizonte visto desde la cámara, más lo que se ve de una nube alta.
    const horizon =
      Math.acos(Math.min(1, RADIUS / camR)) + Math.acos(RADIUS / (RADIUS + HIGH_CLOUD_ALTITUDE));
    for (const mesh of meshes) {
      zoneDir.copy(mesh.userData.direction).applyQuaternion(group.quaternion);
      mesh.visible = zoneDir.angleTo(cameraDir) < horizon + mesh.userData.angularRadius;
      if (!mesh.visible) continue;
      // Zonas lejanas (a más de 2.500 km) con la forma de 20 triángulos: desde ahí cada
      // bolita ocupa pocos píxeles y no se nota la diferencia.
      zoneDir.multiplyScalar(RADIUS + HIGH_CLOUD_ALTITUDE);
      mesh.geometry = zoneDir.distanceTo(camera.position) > 2_500_000 ? blobGeometry : puffGeometry;
    }
  };
  return group;
}

// Cúmulos de una celda: se calculan una sola vez y se guardan.
function cellClusters(i, j, lonCells) {
  const rand = seededRandom((i * 92821) ^ (j * 68917) ^ SEED);
  const center = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - (i + 0.5) * CELL, (j + 0.5) * CELL);
  // Las celdas de 1° se achican hacia los polos (su ancho es proporcional al coseno de
  // la latitud): la cantidad de cúmulos se escala igual para que la densidad sea pareja.
  const area = Math.cos((i + 0.5) * CELL);
  // Redondeo al azar: en promedio sale exactamente la cantidad esperada.
  const count = Math.floor((cloudCover(center) * 6 + 2) * area + rand());
  const clusters = [];
  for (let c = 0; c < count; c++) {
    const lat = (i + rand()) * CELL;
    const lon = ((j + rand()) % lonCells) * CELL;
    const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - lat, lon);
    const ground = Math.max(0, surfaceHeight(dir, 10));
    const base = RADIUS + ground + 5_000 + rand() * 2_500; // bien por encima de la aldea
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
    this.mesh = createInstanced(MAX_CUMULUS_INSTANCES); // cúmulos cercanos, con todas sus bolitas
    this.blobs = createInstanced(MAX_CUMULUS_INSTANCES, blobGeometry); // cúmulos lejanos
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
    const writeBlob = writer(this.blobs);
    const altitude = camR - RADIUS;
    if (altitude > maxDistance) {
      // Desde muy lejos ningún cúmulo llega a verse.
      write.done();
      writeBlob.done();
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
    this.blobs.position.copy(origin);
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
            addBlob(writeBlob, cluster, grow, origin);
          }
        }
      }
    }
    write.done();
    writeBlob.done();
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
  group.add(high, cumulus.mesh, cumulus.blobs);

  let time = 0;
  return {
    object: group,
    update(delta, camera, viewportHeight) {
      time += delta;
      high.rotation.y += delta * 0.0015; // los grandes sistemas derivan despacio
      high.userData.cull(camera);
      cumulus.update(camera, viewportHeight, time);
    },
  };
}
