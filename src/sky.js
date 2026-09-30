import * as THREE from 'three';
import { RADIUS } from './elevation.js';

// El Sol y la Luna que se ven en el cielo. Se dibujan siempre a la misma distancia de
// la cámara (como las estrellas), en la dirección real de cada uno, así que el planeta
// los tapa cuando quedan detrás. La Luna es una esfera iluminada por la luz del Sol:
// sus fases salen solas según dónde esté respecto al Sol.

const DISTANCE = RADIUS * 9; // dentro del plano lejano de la cámara (RADIUS * 20)
const SUN_ANGULAR_SIZE = THREE.MathUtils.degToRad(1.6); // diámetro del disco (el real es 0,53°)
const MOON_ANGULAR_SIZE = THREE.MathUtils.degToRad(3); // más grande que la real (0,52°) para que se luzca

function createSun() {
  const size = DISTANCE * Math.tan(SUN_ANGULAR_SIZE / 2) * 2;
  // Plano grande: el disco ocupa el centro y el resto es el resplandor.
  const geometry = new THREE.PlaneGeometry(size * 9, size * 9);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color('#fff4d6') },
      glow: { value: new THREE.Color('#ffb45a') },
      intensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 color;
      uniform vec3 glow;
      uniform float intensity;
      varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vUv - 0.5) * 9.0; // 1.0 = borde del disco
        float disk = 1.0 - smoothstep(0.92, 1.0, r);
        float halo = exp(-r * 0.9) * 0.9 + exp(-r * 0.25) * 0.18;
        vec3 c = color * disk * 3.0 + glow * halo;
        float a = max(disk, halo);
        if (a < 0.003) discard;
        gl_FragColor = vec4(c * intensity, a * intensity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

function createMoon() {
  const radius = DISTANCE * Math.tan(MOON_ANGULAR_SIZE / 2);
  const geometry = new THREE.IcosahedronGeometry(1, 3);
  // Cráteres: manchas más oscuras pintadas en los vértices.
  const craters = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 18; i++) {
    craters.push({
      dir: new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(),
      size: 0.15 + rand() * 0.35,
      depth: 0.25 + rand() * 0.3,
    });
  }
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color('#c9c6bf');
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    let shade = 1;
    for (const k of craters) {
      const d = p.distanceTo(k.dir);
      if (d < k.size) shade -= k.depth * (1 - d / k.size);
    }
    c.copy(base).multiplyScalar(Math.max(0.45, shade));
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Sólo la ilumina el Sol (no la luz ambiente de la noche), para que se vean las fases.
  const material = new THREE.ShaderMaterial({
    uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 color;
      varying vec3 vColor;
      varying vec3 vWorld;
      void main() {
        vColor = color;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 sunDirection;
      varying vec3 vColor;
      varying vec3 vWorld;
      void main() {
        #include <logdepthbuf_fragment>
        // Normal de cada cara (aspecto facetado).
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        float light = max(dot(n, sunDirection), 0.0);
        vec3 c = vColor * (light * 1.25 + 0.035); // un poco de "luz de Tierra" en la parte oscura
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(radius);
  mesh.frustumCulled = false;
  return mesh;
}

export function createSky(scene) {
  const sun = createSun();
  const moon = createMoon();
  scene.add(sun, moon);

  return {
    sun,
    moon,
    // sunColor: color actual de la luz del Sol (se pone naranja al atardecer).
    update(camera, sunDirection, moonDirection, sunColor) {
      sun.position.copy(camera.position).addScaledVector(sunDirection, DISTANCE);
      sun.quaternion.copy(camera.quaternion); // siempre de frente a la cámara
      sun.material.uniforms.color.value.copy(sunColor).lerp(new THREE.Color('#ffffff'), 0.3);

      moon.position.copy(camera.position).addScaledVector(moonDirection, DISTANCE);
      moon.material.uniforms.sunDirection.value.copy(sunDirection);
    },
  };
}
