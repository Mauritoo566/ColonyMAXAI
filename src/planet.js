import * as THREE from 'three';
import { createNoise3D, fbm } from './noise.js';
import { RADIUS, MAX_LAND_HEIGHT, SEED } from './elevation.js';
import { Terrain } from './terrain.js';

export const CLOUD_ALTITUDE = MAX_LAND_HEIGHT * 1.15;
const ATMOSPHERE_RADIUS = RADIUS * 1.025;

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Nubes low poly: grupos de "bolitas" aplastadas (icosaedros) flotando sobre las montañas.
// Son opacas para que no haya problemas de orden de dibujado con la transparencia.
function createClouds() {
  const noise = createNoise3D(SEED + 2);
  const rand = seededRandom(SEED + 11);
  const matrices = [];
  const dir = new THREE.Vector3();
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const position = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

  let clusters = 0;
  for (let attempt = 0; attempt < 6000 && clusters < 420; attempt++) {
    dir.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (dir.lengthSq() > 1 || dir.lengthSq() < 1e-4) continue;
    dir.normalize();
    if (fbm(noise, dir.x * 2.5, dir.y * 2.5, dir.z * 2.5, 3) < 0.1) continue;
    clusters++;

    east.crossVectors(yAxis, dir);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize();
    north.crossVectors(dir, east);

    const puffs = 5 + Math.floor(rand() * 8);
    const spread = 60_000 + rand() * 120_000;
    for (let p = 0; p < puffs; p++) {
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * spread;
      offset
        .copy(east)
        .multiplyScalar(Math.cos(angle) * dist)
        .addScaledVector(north, Math.sin(angle) * dist);
      const puffDir = position.copy(dir).multiplyScalar(RADIUS).add(offset).normalize();
      const altitude = CLOUD_ALTITUDE + rand() * 3_000;

      quat.setFromUnitVectors(yAxis, puffDir);
      spin.setFromAxisAngle(yAxis, rand() * Math.PI * 2);
      quat.multiply(spin);
      const width = 25_000 + rand() * 45_000;
      scale.set(width, 5_000 + rand() * 5_000, width * (0.6 + rand() * 0.5));
      position.copy(puffDir).multiplyScalar(RADIUS + altitude);
      matrices.push(new THREE.Matrix4().compose(position, quat, scale));
    }
  }

  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
    roughness: 1,
    emissive: 0x223344,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.frustumCulled = false;
  return mesh;
}

function createAtmosphere() {
  const geometry = new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 96);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color('#5aa9ff') },
      opacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 glowColor;
      uniform float opacity;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        #include <logdepthbuf_fragment>
        float rim = 1.0 - abs(dot(vNormal, vViewDir));
        gl_FragColor = vec4(glowColor, 1.0) * pow(rim, 3.0) * opacity;
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

  const terrain = new Terrain();
  planet.add(terrain.object);

  const clouds = createClouds();
  planet.add(clouds);

  const atmosphere = createAtmosphere();
  planet.add(atmosphere);

  return {
    object: planet,
    terrain,
    update(delta, camera) {
      terrain.update(camera.position);
      clouds.rotation.y += delta * 0.002; // las nubes derivan muy despacio

      // Desde dentro de la atmósfera el halo ya no tiene sentido: se desvanece.
      const altitude = camera.position.length() - RADIUS;
      atmosphere.material.uniforms.opacity.value = THREE.MathUtils.smoothstep(altitude, 60_000, 400_000);
      atmosphere.visible = altitude > 60_000;
    },
  };
}
