import * as THREE from 'three';
import { graphics } from './graphics.js';

// Material del terreno con un efecto de agua ligero. El mar es parte del propio terreno
// (caras planas a nivel 0); cada vértice lleva un atributo "aWater":
//   -1  → tierra
//    0  → vértice de agua que toca la costa (ahí se dibuja espuma)
//    1  → agua abierta
// Para el agua se añaden olas animadas (sólo cerca de la cámara), un reflejo del cielo
// según el ángulo de visión y un brillo del sol más marcado. Son unas pocas
// operaciones por píxel, sin texturas ni pasadas extra.

// Las olas se calculan en coordenadas relativas a un "origen" que se mueve con la
// cámara a saltos de WAVE_TILE metros. Todas las olas se repiten exactamente cada
// WAVE_TILE metros, así que el salto del origen no se nota.
export const WAVE_TILE = 20_480;

export const waterUniforms = {
  uTime: { value: 0 },
  uSkyColor: { value: new THREE.Color('#8cc4f0') },
  uChunkOffset: { value: new THREE.Vector3() }, // centro del trozo menos el origen de las olas
};

export function createTerrainMaterial() {
  // Con calidad Media o Baja el terreno usa luz simple (sin brillo especular): mucho más liviano.
  const material = graphics.simpleTerrain
    ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0,
      });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute float aWater;
        uniform vec3 uChunkOffset;
        varying float vWater;
        varying vec3 vWavePos;
        varying vec3 vSphereNormal;
        void main() {
          vWater = aWater;
          vWavePos = position + uChunkOffset;
          // "Arriba" del planeta en este punto, en espacio de vista. El agua usa esta
          // normal suave en vez de la de la cara plana, así no se notan los bordes
          // entre trozos de terreno con distinto detalle.
          vec3 worldUp = normalize((modelMatrix * vec4(position, 1.0)).xyz);
          vSphereNormal = (viewMatrix * vec4(worldUp, 0.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uTime;
        uniform vec3 uSkyColor;
        varying float vWater;
        varying vec3 vWavePos;
        varying vec3 vSphereNormal;

        const float TAU = 6.2831853;
        const float TILE = ${WAVE_TILE.toFixed(1)};

        // Suma de la pendiente de una ola. "v" es un vector de enteros: así la ola se
        // repite cada TILE metros. Su longitud de onda es TILE / |v|.
        vec3 waveSlope(vec3 p, vec3 v, float speed, float steepness) {
          float phase = TAU / TILE * dot(p, v) + uTime * speed;
          return normalize(v) * cos(phase) * steepness;
        }

        vec3 waterSlope(vec3 p) {
          vec3 s = waveSlope(p, vec3(40.0, 13.0, -22.0), 0.6, 0.06);   // ~430 m
          s += waveSlope(p, vec3(-31.0, 52.0, 17.0), 0.8, 0.05);       // ~325 m
          s += waveSlope(p, vec3(70.0, -35.0, 48.0), 1.1, 0.045);      // ~220 m
          s += waveSlope(p, vec3(-90.0, -60.0, 85.0), 1.4, 0.04);      // ~150 m
          s += waveSlope(p, vec3(150.0, 110.0, -140.0), 1.9, 0.035);   // ~90 m
          return s;
        }
        void main() {
          float isWater = step(0.0, vWater);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Espuma junto a la costa, que late suavemente.
        float foam = (1.0 - smoothstep(0.0, 0.35, vWater)) * isWater;
        foam *= 0.55 + 0.45 * sin(uTime * 1.3 + vWavePos.x * 0.004 + vWavePos.z * 0.003);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), foam * 0.8);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, isWater);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float waterDistance = length(vViewPosition);
        if (isWater > 0.5) {
          normal = normalize(vSphereNormal);
          // Las olas sólo se calculan cerca: de lejos serían ruido de píxeles.
          float waveFade = 1.0 - smoothstep(1500.0, 9000.0, waterDistance);
          if (waveFade > 0.0) {
            vec3 slope = waterSlope(vWavePos);
            vec3 slopeView = (viewMatrix * vec4(slope, 0.0)).xyz;
            slopeView -= normal * dot(slopeView, normal); // sólo la parte tangente
            normal = normalize(normal - slopeView * waveFade);
          }
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `if (isWater > 0.5) {
          // Reflejo del cielo, más fuerte cuanto más rasante es la mirada (Fresnel).
          vec3 viewDir = normalize(vViewPosition);
          float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 4.0);
          outgoingLight = mix(outgoingLight, uSkyColor, fresnel * 0.55);
        }
        #include <opaque_fragment>`,
      );
  };

  return material;
}

// Llamar antes de dibujar cada trozo de terreno: ajusta el desplazamiento de las olas.
const offset = new THREE.Vector3();
export function setChunkWaveOffset(material, chunkCenter, waveOrigin) {
  offset.subVectors(chunkCenter, waveOrigin);
  waterUniforms.uChunkOffset.value.copy(offset);
  material.uniformsNeedUpdate = true;
}
