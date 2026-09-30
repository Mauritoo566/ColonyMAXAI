import * as THREE from 'three';
import { createNoise3D, fbm } from './noise.js';

// Parámetros del planeta. "detail" controla la cantidad de polígonos:
// una icoesfera con detail n tiene 20 * (n + 1)^2 caras.
export const PLANET = {
  radius: 1,
  terrainDetail: 40, // ~33.600 caras: estilo "medium poly"
  oceanDetail: 24,
  cloudDetail: 14,
  seaLevel: 0,
  mountainHeight: 0.09,
  seed: 1337,
};

const COLORS = {
  sand: new THREE.Color('#d8c68f'),
  grass: new THREE.Color('#4f8f3a'),
  forest: new THREE.Color('#2f6b2c'),
  desert: new THREE.Color('#c9a15e'),
  rock: new THREE.Color('#7a6a58'),
  snow: new THREE.Color('#f2f5f7'),
  seabed: new THREE.Color('#2b4a5e'),
  oceanDeep: new THREE.Color('#123f75'),
  oceanShallow: new THREE.Color('#2f7fbf'),
  ice: new THREE.Color('#e8f2f8'),
};

const elevationNoise = createNoise3D(PLANET.seed);
const moistureNoise = createNoise3D(PLANET.seed + 1);
const cloudNoise = createNoise3D(PLANET.seed + 2);

// Elevación en [-1, 1] aprox. para un punto de la esfera unitaria.
function elevationAt(p) {
  const continents = fbm(elevationNoise, p.x * 1.1, p.y * 1.1, p.z * 1.1, 4);
  const detail = fbm(elevationNoise, p.x * 4 + 10, p.y * 4 + 10, p.z * 4 + 10, 4);
  return continents * 1.5 + detail * 0.2 - 0.12;
}

function moistureAt(p) {
  return fbm(moistureNoise, p.x * 1.8, p.y * 1.8, p.z * 1.8, 3);
}

function landColor(elevation, moisture, latitude, out) {
  const coldness = Math.abs(latitude);
  if (coldness > 0.9 || elevation > 0.5) return out.copy(COLORS.snow);
  if (elevation < 0.025) return out.copy(COLORS.sand);
  if (elevation > 0.36) return out.copy(COLORS.rock);
  if (moisture < -0.12 && coldness < 0.55) return out.copy(COLORS.desert);
  return out.copy(moisture > 0.08 ? COLORS.forest : COLORS.grass);
}

// Pequeña variación de brillo por cara para reforzar el aspecto low/medium poly.
function jitter(color, amount, rand) {
  const k = 1 + (rand() - 0.5) * amount;
  color.r *= k;
  color.g *= k;
  color.b *= k;
  return color;
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createTerrain() {
  const geometry = new THREE.IcosahedronGeometry(PLANET.radius, PLANET.terrainDetail);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const elevations = new Float32Array(pos.count);

  // Desplaza cada vértice según la elevación. Los vértices compartidos entre caras
  // tienen la misma posición, así que reciben la misma altura y no aparecen grietas.
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const e = elevationAt(v);
    elevations[i] = e;
    const height = e > PLANET.seaLevel ? e * PLANET.mountainHeight : e * 0.08;
    v.multiplyScalar(PLANET.radius * (1 + height));
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  // Un color por cara (tres vértices consecutivos en la geometría no indexada).
  const rand = seededRandom(PLANET.seed);
  const center = new THREE.Vector3();
  const color = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    center.set(0, 0, 0);
    for (let k = 0; k < 3; k++) center.add(v.fromBufferAttribute(pos, f + k));
    center.normalize();
    const e = (elevations[f] + elevations[f + 1] + elevations[f + 2]) / 3;

    if (e <= PLANET.seaLevel) color.copy(COLORS.seabed);
    else landColor(e, moistureAt(center), center.y, color);
    jitter(color, 0.12, rand);

    for (let k = 0; k < 3; k++) color.toArray(colors, (f + k) * 3);
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
  });
  return new THREE.Mesh(geometry, material);
}

function createOcean() {
  const geometry = new THREE.IcosahedronGeometry(PLANET.radius, PLANET.oceanDetail);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const rand = seededRandom(PLANET.seed + 7);
  const center = new THREE.Vector3();
  const v = new THREE.Vector3();
  const color = new THREE.Color();

  for (let f = 0; f < pos.count; f += 3) {
    center.set(0, 0, 0);
    for (let k = 0; k < 3; k++) center.add(v.fromBufferAttribute(pos, f + k));
    center.normalize();

    if (Math.abs(center.y) > 0.93) {
      color.copy(COLORS.ice); // casquetes polares
    } else {
      // Más claro cerca de la costa, más oscuro en alta mar.
      const depth = THREE.MathUtils.clamp(-elevationAt(center) * 3, 0, 1);
      color.copy(COLORS.oceanShallow).lerp(COLORS.oceanDeep, depth);
    }
    jitter(color, 0.08, rand);
    for (let k = 0; k < 3; k++) color.toArray(colors, (f + k) * 3);
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.35,
    metalness: 0.1,
    transparent: true,
    opacity: 0.92,
  });
  return new THREE.Mesh(geometry, material);
}

function createClouds() {
  const source = new THREE.IcosahedronGeometry(PLANET.radius * 1.075, PLANET.cloudDetail);
  const pos = source.attributes.position;
  const kept = [];
  const center = new THREE.Vector3();
  const v = new THREE.Vector3();

  // Nos quedamos sólo con las caras donde el ruido de nubes supera un umbral.
  for (let f = 0; f < pos.count; f += 3) {
    center.set(0, 0, 0);
    for (let k = 0; k < 3; k++) center.add(v.fromBufferAttribute(pos, f + k));
    center.normalize();
    const n = fbm(cloudNoise, center.x * 2.5, center.y * 2.5, center.z * 2.5, 3);
    if (n > 0.12) {
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, f + k);
        kept.push(v.x, v.y, v.z);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
    roughness: 1,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  return new THREE.Mesh(geometry, material);
}

function createAtmosphere() {
  const geometry = new THREE.SphereGeometry(PLANET.radius * 1.18, 64, 64);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color('#5aa9ff') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 glowColor;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float rim = 1.0 - abs(dot(vNormal, vViewDir));
        float intensity = pow(rim, 3.0);
        gl_FragColor = vec4(glowColor, 1.0) * intensity;
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Mesh(geometry, material);
}

export function createPlanet() {
  const planet = new THREE.Group();
  planet.name = 'planet';

  const surface = new THREE.Group(); // rota con el planeta
  surface.add(createTerrain());
  surface.add(createOcean());
  planet.add(surface);

  const clouds = createClouds(); // rota un poco más rápido que la superficie
  planet.add(clouds);

  planet.add(createAtmosphere());

  // Inclinación axial de la Tierra (~23,4°).
  planet.rotation.z = THREE.MathUtils.degToRad(23.4);

  return {
    object: planet,
    update(delta) {
      surface.rotation.y += delta * 0.05;
      clouds.rotation.y += delta * 0.065;
    },
  };
}
