import * as THREE from 'three';
import { RADIUS } from './elevation.js';
import { createPlanet } from './planet.js';
import { PlanetControls } from './controls.js';

const canvas = document.getElementById('scene');
const altitudeLabel = document.getElementById('altitude');

// logarithmicDepthBuffer permite dibujar a la vez cosas a 1 m y a 20.000 km sin
// que los polígonos "parpadeen" por falta de precisión en el buffer de profundidad.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const SPACE_COLOR = new THREE.Color('#02030a');
const SKY_COLOR = new THREE.Color('#8cc4f0');

const scene = new THREE.Scene();
scene.background = SPACE_COLOR.clone();
scene.fog = new THREE.Fog(SKY_COLOR.clone(), 1e12, 1e12);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, RADIUS * 20);
const controls = new PlanetControls(camera, canvas);

// Luz del Sol + un poco de luz ambiente para que el lado nocturno no sea negro puro.
// El Sol acompaña a la cámara (ligeramente de lado) para que siempre sea de día donde miras.
const sun = new THREE.DirectionalLight(0xffffff, 3);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x334466, 0.4));

const stars = createStars(4000);
scene.add(stars);

const planet = createPlanet();
scene.add(planet.object);

// Estrellas pegadas a la cámara: siempre están "en el infinito".
function createStars(count) {
  const positions = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(RADIUS * 10);
    v.toArray(positions, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5,
    sizeAttenuation: false,
    fog: false,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
}

function formatAltitude(meters) {
  if (meters >= 10_000) return `${Math.round(meters / 1000).toLocaleString('es')} km`;
  if (meters >= 1_000) return `${(meters / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} km`;
  return `${Math.round(meters).toLocaleString('es')} m`;
}

// Cielo azul y bruma al entrar en la atmósfera.
function updateSky(altitude) {
  const sky = 1 - THREE.MathUtils.smoothstep(altitude, 15_000, 120_000);
  scene.background.copy(SPACE_COLOR).lerp(SKY_COLOR, sky);
  stars.material.opacity = 1 - sky;
  stars.position.copy(camera.position);

  if (altitude < 200_000) {
    const horizon = Math.sqrt(altitude * (2 * RADIUS + altitude));
    scene.fog.color.copy(scene.background);
    scene.fog.far = horizon * 1.3 + 150_000;
    scene.fog.near = scene.fog.far * 0.15;
  } else {
    scene.fog.near = scene.fog.far = 1e12;
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let labelTimer = 0;
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.1);
  controls.update(delta);
  sun.position.copy(controls.dir).addScaledVector(controls.east, 0.8).addScaledVector(controls.north, 0.4);
  planet.update(delta, camera);

  const altitude = camera.position.length() - RADIUS;
  updateSky(altitude);

  labelTimer -= delta;
  if (altitudeLabel && labelTimer <= 0) {
    labelTimer = 0.1;
    altitudeLabel.textContent = formatAltitude(altitude - controls.groundHeight);
  }

  renderer.render(scene, camera);
});
