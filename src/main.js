import * as THREE from 'three';
import { RADIUS } from './elevation.js';
import { createPlanet } from './planet.js';
import { PlanetControls } from './controls.js';
import { DayNight, formatHour } from './daynight.js';
import { cloudFade } from './clouds.js';
import { waterUniforms } from './water.js';
import { CampSystem } from './camp.js';
import { biomeAt } from './biomes.js';
import { ResourceSystem } from './resources.js';
import { createSky } from './sky.js';
import { ColonySystem } from './colonists.js';
import { ColonyUI } from './colonyUI.js';
import { BuildingSystem } from './buildings.js';
import { BuildUI } from './buildUI.js';
import { WeatherSystem } from './weather.js';
import { AgeUI } from './ageUI.js';
import { HarvestTool } from './harvest.js';

const canvas = document.getElementById('scene');
const altitudeLabel = document.getElementById('altitude');
const timeLabel = document.getElementById('time');
const weatherChip = document.getElementById('weather');
const weatherIcon = document.getElementById('weather-icon');
const weatherName = document.getElementById('weather-name');
const dayLabel = document.getElementById('day');
const biomeLabel = document.getElementById('biome');
const speedButtons = document.querySelectorAll('[data-speed]');

// logarithmicDepthBuffer permite dibujar a la vez cosas a 1 m y a 20.000 km sin
// que los polígonos "parpadeen" por falta de precisión en el buffer de profundidad.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // más barato que PCFSoft; el radio suaviza igual
// Las sombras son de las nubes, que se mueven muy despacio: basta recalcularlas cada
// pocos fotogramas (la sombra ya calculada sigue bien ubicada mientras tanto).
renderer.shadowMap.autoUpdate = false;
const SHADOW_EVERY_FRAMES = 3;
let shadowFrame = 0;

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
sun.shadow.mapSize.setScalar(isSmallScreen ? 1024 : 2048);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0;
sun.shadow.radius = 2;
sun.shadow.intensity = 0.6; // la sombra de una nube oscurece, pero no deja el suelo negro
scene.add(sun, sun.target);

// Luna: luz azulada desde el lado contrario al Sol para que la noche no sea negra.
const moon = new THREE.DirectionalLight('#a9bcff', 0.9);
scene.add(moon);
const ambient = new THREE.AmbientLight('#5a6c99', 0.55);
scene.add(ambient);

const stars = createStars(4000);
const sky = createSky(scene);
scene.add(stars);

const planet = createPlanet();
scene.add(planet.object);

const resources = new ResourceSystem(scene);
const colony = new ColonySystem({ scene, camera, canvas, labelsRoot: document.getElementById('labels') });
const resourceFocus = new THREE.Vector3();

const camps = new CampSystem({
  scene,
  camera,
  canvas,
  controls,
  terrain: planet.terrain,
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

colony.resources = resources; // para quitar del mundo lo que se tala
const buildings = new BuildingSystem({
  scene,
  camera,
  canvas,
  colony,
  terrain: planet.terrain,
  labelsRoot: document.getElementById('labels'),
});
const harvest = new HarvestTool({ scene, camera, canvas, colony, controls });
buildings.blockSelection = () => !!camps.placing || harvest.active;

// Clima: se decide en el campamento (o donde se mire si aún no hay uno).
const weather = new WeatherSystem(scene);
weather.setPlace(controls.dir);
colony.weather = weather;
// Lo que se guarda con la colonia además de edificios y colonos: el reloj y el clima.
buildings.world = {
  save: () => ({
    elapsed: dayNight.elapsed,
    subsolarLon: dayNight.subsolarLon,
    moonPhase: dayNight.moonPhase,
    weather: weather.save(),
  }),
  load: (d) => {
    if (Number.isFinite(d.elapsed)) dayNight.elapsed = d.elapsed;
    if (Number.isFinite(d.subsolarLon)) dayNight.subsolarLon = d.subsolarLon;
    if (Number.isFinite(d.moonPhase)) dayNight.moonPhase = d.moonPhase;
    dayNight.update(0);
    weather.load(d.weather);
  },
};
// Guardar también al cerrar o cambiar de pestaña.
window.addEventListener('pagehide', () => buildings.save());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') buildings.save();
});
const colonyUI = new ColonyUI({
  colony,
  controls,
  camera,
  canvas,
  isBlocked: () => !!camps.placing || !!buildings.placing || harvest.active,
});
const buildUI = new BuildUI({ buildings, colony, harvest, onFocusColonist: (c) => colonyUI.focusColonist(c) });
// Sólo una ficha abierta a la vez.
colonyUI.onOpen = () => buildings.select(null);
buildUI.onOpen = () => colony.select(null);
const ageUI = new AgeUI({
  colony,
  timeLabel: () => {
    const d = camps.camp?.dir;
    return d ? `Día ${dayNight.day} · ${formatHour(dayNight.localHour(Math.atan2(d.x, d.z)))}` : '';
  },
});
ageUI.onOpen = () => {
  colony.select(null);
  buildings.select(null);
};
colony.onAgeChange = () => buildings.save();

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
const STORM_GREY = new THREE.Color('#7d8794');
const greyTmp = new THREE.Color();
let weatherNear = 0; // 0–1: cuánto se nota el clima del campamento en la vista actual

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

  // Luz nocturna: llega desde la Luna si está sobre el horizonte y, si no, desde el
  // lado opuesto al Sol (así la noche nunca queda negra).
  const moonUp = controls.dir.dot(dayNight.moonDirection) > 0.05;
  moon.position.copy(moonUp ? dayNight.moonDirection : sunDir.clone().negate());
}

// Color del cielo según la altura del Sol sobre el horizonte en el lugar de la cámara.
function updateSky(altitude) {
  const sunElevation = controls.dir.dot(dayNight.sunDirection); // 1 = mediodía, <0 = noche
  const daylight = THREE.MathUtils.smoothstep(sunElevation, -0.12, 0.22);
  const dusk = THREE.MathUtils.clamp(1 - Math.abs(sunElevation - 0.03) / 0.14, 0, 1);
  skyColor.copy(SKY_NIGHT).lerp(SKY_DAY, daylight).lerp(SKY_DUSK, dusk * 0.55);
  // Cielo gris y menos sol cuando está nublado o llueve (sólo cerca del suelo).
  const overcast = weather.clouds * weatherNear;
  skyColor.lerp(greyTmp.copy(STORM_GREY).multiplyScalar(0.25 + 0.75 * daylight), overcast * 0.6);
  sun.intensity = 3 * (1 - overcast * 0.55);
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
  moon.intensity = (0.4 + 1.4 * night) * (0.55 + 0.45 * dayNight.moonIllumination);

  if (altitude < 200_000) {
    const horizon = Math.sqrt(altitude * (2 * RADIUS + altitude));
    scene.fog.color.copy(scene.background);
    scene.fog.far = horizon * 1.3 + 150_000;
    scene.fog.near = scene.fog.far * 0.15;
    // Lo que la bruma tapa casi del todo no necesita detalle.
    planet.terrain.detailDistance = scene.fog.far * 0.8;
  } else {
    scene.fog.near = scene.fog.far = 1e12;
    planet.terrain.detailDistance = Infinity;
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
let centerHit = null; // punto del suelo en el centro de la pantalla (o null si es cielo)
const centerDir = new THREE.Vector3();

// Actualiza el "hueco" de las nubes: distancia al punto del suelo que se ve en el
// centro de la pantalla y cuánto se aplica según la altura.
function updateCloudFade(clearance) {
  camera.getWorldDirection(centerRay.direction);
  centerRay.origin.copy(camera.position);
  groundSphere.radius = RADIUS + Math.max(0, controls.groundHeight);
  const altitude = camera.position.length() - RADIUS;
  centerHit = centerRay.intersectSphere(groundSphere, hit);
  if (centerHit) {
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

// Calidad automática: si los fotogramas tardan mucho se reduce el detalle del
// terreno poco a poco, y si sobra tiempo se recupera.
const quality = { frameTime: 1 / 60, timer: 0, scale: 1 };
function updateQuality(rawDelta) {
  quality.frameTime += (Math.min(rawDelta, 0.25) - quality.frameTime) * 0.05;
  quality.timer += rawDelta;
  if (quality.timer < 1.5) return;
  quality.timer = 0;
  if (quality.frameTime > 1 / 40) quality.scale = Math.min(2.2, quality.scale * 1.15);
  else if (quality.frameTime < 1 / 55) quality.scale = Math.max(1, quality.scale / 1.1);
  planet.terrain.detailScale = quality.scale;
}

const clock = new THREE.Clock();
let labelTimer = 0;
let weatherPlaceTimer = 0;
renderer.setAnimationLoop(() => {
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 0.1);
  updateQuality(rawDelta);
  controls.update(delta);
  dayNight.update(delta);
  waterUniforms.uTime.value += delta;

  const altitude = camera.position.length() - RADIUS;
  const clearance = Math.max(1, altitude - controls.groundHeight);
  updateSun(clearance);
  planet.update(delta, camera, dayNight.sunDirection, window.innerHeight);
  updateCloudFade(clearance);
  // Los recursos se dibujan alrededor del punto que se mira (centro de la pantalla).
  if (centerHit) resourceFocus.copy(hit).normalize();
  else resourceFocus.copy(controls.dir);
  resources.update(camera, resourceFocus, clearance, delta);
  camps.update(delta);
  const campDir = camps.camp?.dir;
  // El clima es el del campamento; sin campamento, el del lugar que se mira.
  weatherPlaceTimer -= delta;
  if (weatherPlaceTimer <= 0) {
    weatherPlaceTimer = 2;
    weather.setPlace(campDir ?? controls.dir);
  }
  const nearCamp = campDir ? 1 - THREE.MathUtils.smoothstep(controls.dir.angleTo(campDir) * RADIUS, 40_000, 150_000) : 1;
  weatherNear = nearCamp * (1 - THREE.MathUtils.smoothstep(clearance, 8_000, 80_000));
  weather.update(delta * dayNight.speed, delta, camera, nearCamp > 0.5 ? clearance : Infinity);
  const campTime = () => `Día ${dayNight.day} · ${formatHour(dayNight.localHour(Math.atan2(campDir.x, campDir.z)))}`;
  colony.update(delta, camps.camp, {
    timeScale: dayNight.speed,
    // De noche hace más frío y los colonos tienden a dormir.
    isNight: campDir ? campDir.dot(dayNight.sunDirection) < -0.05 : false,
    timeLabel: campTime,
  });
  if (camps.camp) buildings.update(delta, { timeLabel: campTime, timeScale: dayNight.speed });
  colonyUI.update(delta);
  buildUI.update(delta);
  ageUI.update(delta);
  harvest.update(waterUniforms.uTime.value, delta);
  updateSky(altitude);

  labelTimer -= delta;
  if (labelTimer <= 0) {
    labelTimer = 0.1;
    if (altitudeLabel) altitudeLabel.textContent = formatAltitude(clearance);
    if (timeLabel) timeLabel.textContent = formatHour(dayNight.localHour(controls.lon));
    if (dayLabel) dayLabel.textContent = `Día ${dayNight.day}`;
    if (weatherChip) {
      const w = weather.state;
      if (weatherChip.dataset.state !== w.id) {
        weatherChip.dataset.state = w.id;
        weatherIcon.setAttribute('href', `#i-w-${w.icon}`);
        weatherName.textContent = w.name;
        weatherChip.title = w.rain
          ? `${w.name} en el campamento: el pozo rinde más y las bayas y setas crecen antes`
          : `${w.name} en el campamento`;
      }
    }
    if (biomeLabel) {
      centerDir.copy(hit).normalize();
      biomeLabel.textContent = centerHit ? biomeAt(centerDir.x, centerDir.y, centerDir.z).name : '–';
    }
  }

  if (shadowFrame++ % SHADOW_EVERY_FRAMES === 0) renderer.shadowMap.needsUpdate = true;
  sky.update(camera, dayNight.sunDirection, dayNight.moonDirection, sun.color);
  renderer.render(scene, camera);
});
