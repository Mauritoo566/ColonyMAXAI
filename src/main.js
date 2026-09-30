import * as THREE from 'three';
import { RADIUS } from './elevation.js';
import { createPlanet } from './planet.js';
import { PlanetControls } from './controls.js';
import { DayNight, formatHour } from './daynight.js';
import { cloudFade } from './clouds.js';
import { waterUniforms } from './water.js';
import { CampSystem } from './camp.js';

const canvas = document.getElementById('scene');
const altitudeLabel = document.getElementById('altitude');
const timeLabel = document.getElementById('time');
const speedButtons = document.querySelectorAll('[data-speed]');

// logarithmicDepthBuffer permite dibujar a la vez cosas a 1 m y a 20.000 km sin
// que los polígonos "parpadeen" por falta de precisión en el buffer de profundidad.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const SPACE_COLOR = new THREE.Color('#02030a');
const SKY_DAY = new THREE.Color('#8cc4f0');
const SKY_DUSK = new THREE.Color('#f29a5c');
const SKY_NIGHT = new THREE.Color('#12213f');
const SUN_WHITE = new THREE.Color('#fff6e8');
const SUN_ORANGE = new THREE.Color('#ffae6b');

const scene = new THREE.Scene();
scene.background = SPACE_COLOR.clone();
scene.fog = new THREE.Fog(SKY_DAY.clone(), 1e12, 1e12);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, RADIUS * 20);
const controls = new PlanetControls(camera, canvas);
const dayNight = new DayNight({ startLon: controls.lon, startHour: 10 });

// Sol: la única luz que proyecta sombras (las de las nubes).
const sun = new THREE.DirectionalLight(SUN_WHITE.clone(), 3);
sun.castShadow = true;
const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) < 700;
sun.shadow.mapSize.setScalar(isSmallScreen ? 2048 : 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0;
sun.shadow.radius = 3;
sun.shadow.intensity = 0.6; // la sombra de una nube oscurece, pero no deja el suelo negro
scene.add(sun, sun.target);

// Luna: luz azulada desde el lado contrario al Sol para que la noche no sea negra.
const moon = new THREE.DirectionalLight('#a9bcff', 0.9);
scene.add(moon);
const ambient = new THREE.AmbientLight('#5a6c99', 0.55);
scene.add(ambient);

const stars = createStars(4000);
scene.add(stars);

const planet = createPlanet();
scene.add(planet.object);

const camps = new CampSystem({
  scene,
  camera,
  canvas,
  controls,
  ui: {
    foundButton: document.getElementById('found-camp'),
    goButton: document.getElementById('go-camp'),
    relocateButton: document.getElementById('relocate-camp'),
    cancelButton: document.getElementById('cancel-camp'),
    banner: document.getElementById('place-banner'),
    tooltip: document.getElementById('place-tooltip'),
    marker: document.getElementById('camp-marker'),
  },
});

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

const focus = new THREE.Vector3();
const skyColor = new THREE.Color();

// Coloca el Sol y ajusta su cámara de sombras a la zona que se está mirando:
// cerca del suelo cubre unos kilómetros (sombras nítidas), desde el espacio todo el planeta.
function updateSun(clearance) {
  const sunDir = dayNight.sunDirection;
  const extent = THREE.MathUtils.clamp(clearance * 5, 25_000, RADIUS * 1.1);

  focus.copy(controls.dir).multiplyScalar(RADIUS);
  focus.addScaledVector(controls.forward, extent * 0.5 * controls.lowness);
  focus.multiplyScalar(1 - THREE.MathUtils.smoothstep(extent, RADIUS * 0.3, RADIUS));

  const distance = extent * 2 + 200_000;
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(sunDir, distance);

  const cam = sun.shadow.camera;
  if (cam.right !== extent) {
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = distance * 2;
    cam.updateProjectionMatrix();
  }

  moon.position.copy(sunDir).negate();
}

// Color del cielo según la altura del Sol sobre el horizonte en el lugar de la cámara.
function updateSky(altitude) {
  const sunElevation = controls.dir.dot(dayNight.sunDirection); // 1 = mediodía, <0 = noche
  const daylight = THREE.MathUtils.smoothstep(sunElevation, -0.12, 0.22);
  const dusk = THREE.MathUtils.clamp(1 - Math.abs(sunElevation - 0.03) / 0.14, 0, 1);
  skyColor.copy(SKY_NIGHT).lerp(SKY_DAY, daylight).lerp(SKY_DUSK, dusk * 0.55);
  waterUniforms.uSkyColor.value.copy(skyColor); // el agua refleja este cielo

  const inAtmosphere = 1 - THREE.MathUtils.smoothstep(altitude, 15_000, 120_000);
  scene.background.copy(SPACE_COLOR).lerp(skyColor, inAtmosphere);
  stars.material.opacity = 1 - inAtmosphere * (0.15 + 0.85 * daylight);
  stars.position.copy(camera.position);

  // Atardeceres anaranjados, pero sólo cuando estás dentro de la atmósfera.
  sun.color.copy(SUN_WHITE).lerp(SUN_ORANGE, dusk * inAtmosphere);

  // De noche sube la luz ambiente y la de la luna para que se siga viendo el paisaje.
  const night = 1 - daylight;
  ambient.intensity = 0.45 + 1.1 * night;
  moon.intensity = 0.4 + 1.4 * night;

  if (altitude < 200_000) {
    const horizon = Math.sqrt(altitude * (2 * RADIUS + altitude));
    scene.fog.color.copy(scene.background);
    scene.fog.far = horizon * 1.3 + 150_000;
    scene.fog.near = scene.fog.far * 0.15;
  } else {
    scene.fog.near = scene.fog.far = 1e12;
  }
}

for (const button of speedButtons) {
  button.addEventListener('click', () => {
    dayNight.speed = Number(button.dataset.speed);
    for (const b of speedButtons) b.setAttribute('aria-pressed', String(b === button));
  });
}

const centerRay = new THREE.Ray();
const groundSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS);
const hit = new THREE.Vector3();

// Actualiza el "hueco" de las nubes: distancia al punto del suelo que se ve en el
// centro de la pantalla y cuánto se aplica según la altura.
function updateCloudFade(clearance) {
  camera.getWorldDirection(centerRay.direction);
  centerRay.origin.copy(camera.position);
  groundSphere.radius = RADIUS + Math.max(0, controls.groundHeight);
  const altitude = camera.position.length() - RADIUS;
  if (centerRay.intersectSphere(groundSphere, hit)) {
    cloudFade.focusDistance.value = hit.distanceTo(camera.position);
  } else {
    cloudFade.focusDistance.value = Math.sqrt(altitude * (2 * RADIUS + altitude)); // horizonte
  }
  // Desde el espacio no hace falta: el hueco desaparece entre 400 y 2.500 km.
  cloudFade.strength.value = 1 - THREE.MathUtils.smoothstep(clearance, 400_000, 2_500_000);
  cloudFade.nearDistance.value = Math.max(1_500, clearance * 0.3);
  renderer.getDrawingBufferSize(cloudFade.resolution.value);
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  cloudFade.viewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  cloudFade.cameraPosition.value.copy(camera.position);
  cloudFade.aspect.value = camera.aspect;
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
  dayNight.update(delta);
  waterUniforms.uTime.value += delta;

  const altitude = camera.position.length() - RADIUS;
  const clearance = Math.max(1, altitude - controls.groundHeight);
  updateSun(clearance);
  planet.update(delta, camera, dayNight.sunDirection, window.innerHeight);
  updateCloudFade(clearance);
  camps.update(delta);
  updateSky(altitude);

  labelTimer -= delta;
  if (labelTimer <= 0) {
    labelTimer = 0.1;
    if (altitudeLabel) altitudeLabel.textContent = formatAltitude(clearance);
    if (timeLabel) timeLabel.textContent = formatHour(dayNight.localHour(controls.lon));
  }

  renderer.render(scene, camera);
});
