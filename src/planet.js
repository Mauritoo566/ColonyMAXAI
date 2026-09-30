import * as THREE from 'three';
import { RADIUS } from './elevation.js';
import { Terrain } from './terrain.js';
import { createClouds } from './clouds.js';

const ATMOSPHERE_RADIUS = RADIUS * 1.025;

function createAtmosphere() {
  const geometry = new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 96);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color('#5aa9ff') },
      opacity: { value: 1 },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) }, // en espacio de vista
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
      uniform vec3 sunDirection;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        #include <logdepthbuf_fragment>
        float rim = 1.0 - abs(dot(vNormal, vViewDir));
        // El halo brilla más del lado iluminado; del lado nocturno queda un azul tenue.
        float lit = 0.25 + 0.75 * smoothstep(-0.35, 0.4, dot(vNormal, sunDirection));
        gl_FragColor = vec4(glowColor, 1.0) * pow(rim, 3.0) * opacity * lit;
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
  planet.add(clouds.object);

  const atmosphere = createAtmosphere();
  planet.add(atmosphere);

  return {
    object: planet,
    terrain,
    update(delta, camera, sunDirection, viewportHeight) {
      terrain.update(camera.position);
      clouds.update(delta, camera, viewportHeight);

      // Desde dentro de la atmósfera el halo ya no tiene sentido: se desvanece.
      const altitude = camera.position.length() - RADIUS;
      const uniforms = atmosphere.material.uniforms;
      uniforms.opacity.value = THREE.MathUtils.smoothstep(altitude, 60_000, 400_000);
      uniforms.sunDirection.value.copy(sunDirection).transformDirection(camera.matrixWorldInverse);
      atmosphere.visible = altitude > 60_000;
    },
  };
}
