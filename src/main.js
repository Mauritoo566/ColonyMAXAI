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
import { ColonySim } from './sim/colony.js';
import { ColonyView } from './colonists.js';
import { ColonyUI } from './colonyUI.js';
import { BuildingSystem } from './buildings.js';
import { BuildUI } from './buildUI.js';
import { WeatherSystem, WEATHER } from './weather.js';
import { AgeUI } from './ageUI.js';
import { HarvestTool } from './harvest.js';
import { Connection } from './net.js';
import { requireLogin, logout } from './auth.js';
import { SettingsUI } from './settingsUI.js';
import { setStorageUser } from './storage.js';
import { GROVE_KEY, SPROUT_KEY } from './resourceGen.js';
import { OtherCamps } from './world.js';
import { FlagUI } from './flagUI.js';
import { VillageUI } from './villageUI.js';
import { makeFoldable } from './panelFold.js';
import { MilitaryUI } from './militaryUI.js';
import { RoadSystem } from './roads.js';
import { ensureIcons } from './icons.js';

ensureIcons();

// Antes de nada: conectar con el servidor e iniciar sesión (o registrarse). El mundo vive
// en el servidor: simula todas las colonias; este navegador las dibuja y le manda las
// órdenes del jugador.
const net = new Connection();
const player = await requireLogin(net);
setStorageUser(player.name);

const canvas = document.getElementById('scene');
const altitudeLabel = document.getElementById('altitude');
const timeLabel = document.getElementById('time');
const weatherChip = document.getElementById('weather');
const weatherIcon = document.getElementById('weather-icon');
const weatherName = document.getElementById('weather-name');
const dayLabel = document.getElementById('day');
const biomeLabel = document.getElementById('biome');
const netStatus = document.getElementById('net-status');

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
// Si la cámara se mueve rápido, las sombras se recalculan en cada fotograma: con el mapa
// de sombras viejo, el "hueco" que se hace en las sombras de las nubes cercanas se quedaba
// atrás y las sombras aparecían y desaparecían a saltos (parpadeo al volar).
const lastShadowPosition = new THREE.Vector3(Infinity, 0, 0);
const lastShadowForward = new THREE.Vector3(0, 0, -1);
const shadowForward = new THREE.Vector3();

const SPACE_COLOR = new THREE.Color('#02030a');
const SKY_DAY = new THREE.Color('#8cc4f0');
const SKY_DUSK = new THREE.Color('#f29a5c');
const SKY_NIGHT = new THREE.Color('#12213f');
const SUN_WHITE = new THREE.Color('#fff6e8');
const SUN_ORANGE = new THREE.Color('#ffae6b');

const scene = new THREE.Scene();
scene.background = SPACE_COLOR.clone();
scene.fog = new THREE.Fog(SKY_DAY.clone(), 1e12, 1e12);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.4, RADIUS * 20);
const controls = new PlanetControls(camera, canvas);
// El reloj del mundo es el mismo para todos (lo manda el servidor; aquí se extrapola).
const dayNight = new DayNight({ startLon: 0, startHour: 12 });
let timeBase = { elapsed: 0, at: performance.now() };
const worldTime = () => timeBase.elapsed + (performance.now() - timeBase.at) / 1000;

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
// La colonia del jugador: una copia de la del servidor (sim/colony.js) que se pone al día
// con lo que llega y manda las órdenes (construir, marcar...) al servidor.
const colony = new ColonySim();
colony.remote = (name, args) => net.send({ t: 'cmd', name, args });
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
    cancelButton: document.getElementById('cancel-camp'),
    banner: document.getElementById('place-banner'),
    tooltip: document.getElementById('place-tooltip'),
    marker: document.getElementById('camp-marker'),
  },
});
// Fundar lo decide el servidor: contesta con el campamento o con el motivo.
camps.onFoundRequest = (dir) => net.send({ t: 'found', dir: { x: dir.x, y: dir.y, z: dir.z } });

const campObject = () => camps.camp?.object ?? null;
const colonyView = new ColonyView({ scene, camera, canvas, labelsRoot: document.getElementById('labels'), sim: colony, campObject });
const buildings = new BuildingSystem({
  scene,
  camera,
  canvas,
  sim: colony,
  terrain: planet.terrain,
  labelsRoot: document.getElementById('labels'),
  pickColonist: (x, y) => colonyView.pickAt(x, y),
});
const harvest = new HarvestTool({ scene, camera, canvas, colony, controls, campObject });
// Recursos del mundo: lo talado desaparece y lo que brota con la lluvia aparece.
colony.on('resources', () => {
  resources.restoreRemoved(colony.serializeRemoved());
  resources.setExtraTile(GROVE_KEY, colony.groveTile);
  resources.setExtraTile(SPROUT_KEY, colony.sproutTile);
});
const militaryUI = new MilitaryUI({ colony, button: document.getElementById('military-button'), panel: document.getElementById('military-panel') });
militaryUI.onOpen = () => villageUI.toggle(false);
makeFoldable(document.getElementById('colony-card'), { startFoldedOnSmall: true });
for (const id of ['colonist-panel', 'building-panel', 'world-panel']) makeFoldable(document.getElementById(id));
const villageUI = new VillageUI({ colony, button: document.getElementById('village-button'), panel: document.getElementById('village-panel') });
villageUI.onOpen = () => militaryUI.toggle(false);
colony.on('flag', () => camps.setFlag(colony.flag));
new FlagUI({
  button: document.getElementById('flag-button'),
  chip: document.getElementById('flag-chip'),
  panel: document.getElementById('flag-panel'),
  grid: document.getElementById('flag-grid'),
  search: document.getElementById('flag-search'),
  colony,
});
buildings.blockSelection = () => !!camps.placing || harvest.active || !!roadsRef?.active;
let roadsRef = null;

// Clima: el de la colonia (lo manda el servidor); sin campamento, uno inventado para el
// lugar que se mira.
const weather = new WeatherSystem(scene);
weather.setPlace(controls.dir);

// ---- Lo que manda el servidor ---------------------------------------------------------
const setTime = (elapsed) => {
  if (Number.isFinite(elapsed)) timeBase = { elapsed, at: performance.now() };
};
net.on('hello', (m) => setTime(m.elapsed));
net.on('time', (m) => setTime(m.elapsed));
net.on('colony', (s) => {
  if (s.camp) {
    camps.setFlag(s.flag ?? 'tribe');
    camps.showCamp(s.camp); // primero el modelo: nivela el terreno donde caminan los colonos
    if (!colony.camp || colony.camp.seed !== s.camp.seed) colony.setCamp(s.camp);
  }
  if (colony.camp) colony.applySnapshot(s);
});
net.on('fast', (s) => colony.camp && colony.applySnapshot(s, 'fast'));
net.on('away', (summary) => showAwaySummary(summary));
net.on('error', (m) => {
  if (m.about === 'found') camps.foundFailed(m.message);
  else showNotice(m.message, true);
});
camps.onMessage = (text) => showNotice(text, true);
// Si se corta la conexión, al volver se entra solo con la misma sesión.
net.onOpen = () => net.send({ t: 'resume', token: player.token });
net.onStatus = (status) => {
  netStatus.dataset.state = status;
  netStatus.textContent = status === 'open' ? 'En línea' : 'Reconectando…';
  netStatus.title = status === 'open' ? 'Conectado al servidor' : 'Se perdió la conexión con el servidor: reintentando. Tu colonia sigue en el servidor.';
};

// Avisos breves arriba al centro (errores del servidor, lugar no válido...).
const notice = document.getElementById('notice');
let noticeTimer = null;
function showNotice(text, isError = false) {
  notice.textContent = text;
  notice.classList.toggle('is-error', isError);
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.hidden = true), 4000);
}

const colonyUI = new ColonyUI({
  colony,
  view: colonyView,
  controls,
  camera,
  canvas,
  isBlocked: () => !!camps.placing || !!buildings.placing || harvest.active,
});
const roads = new RoadSystem({ scene, camera, canvas, colony, controls });
roadsRef = roads;
controls.blockLeftDrag = () => harvest.active || roads.active;
const buildUI = new BuildUI({ buildings, colony, harvest, roads, onFocusColonist: (c) => colonyUI.focusColonist(c) });
// Sólo una ficha abierta a la vez.
colonyUI.onOpen = () => buildings.select(null);
buildUI.onOpen = () => colonyView.select(null);
const ageUI = new AgeUI({
  colony,
  timeLabel: campTimeLabel,
});
ageUI.onOpen = () => {
  colonyView.select(null);
  buildings.select(null);
};

// ---- Los demás jugadores: sus campamentos, edificios y colonos, en vivo ---------------
const others = new OtherCamps({ scene, terrain: planet.terrain, camera, canvas, labelsRoot: document.getElementById('labels') });
others.myId = player.playerId;
const worldButton = document.getElementById('world-button');
const worldPanel = document.getElementById('world-panel');
camps.getOthers = () => others.campList(); // no fundar pegado a otro jugador
others.onPlayers = renderPlayers;
net.on('players', (m) => others.sync(m.list));
net.on('other', (m) => others.applyColonists(m.id, m));
worldButton.hidden = false;
worldButton.addEventListener('click', () => {
  worldPanel.hidden = !worldPanel.hidden;
  worldButton.setAttribute('aria-expanded', String(!worldPanel.hidden));
});

function renderPlayers(players) {
  document.getElementById('world-count').textContent = String(players.length);
  const list = document.getElementById('world-list');
  list.textContent = '';
  const sorted = [...players].sort((a, b) => (b.isMe - a.isMe) || (b.online - a.online) || a.name.localeCompare(b.name));
  for (const p of sorted) {
    const li = document.createElement('li');
    li.classList.toggle('is-me', p.isMe);
    const info = document.createElement('div');
    info.className = 'world-player';
    const name = document.createElement('strong');
    name.textContent = p.isMe ? `${p.name} (tú)` : p.name;
    const detail = document.createElement('span');
    const state = p.isMe || p.online ? 'conectado' : 'desconectado';
    const sky = WEATHER[p.weather]?.name; // clima de su zona (cambia en vivo)
    detail.textContent = p.camp
      ? `Edad ${['I', 'II', 'III', 'IV', 'V'][p.age - 1] ?? p.age} · ${p.population} colonos · ${sky ? sky + ' · ' : ''}${state}`
      : `Todavía sin campamento · ${state}`;
    info.append(name, detail);
    li.append(info);
    if (p.camp) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn';
      go.textContent = 'Ir';
      go.addEventListener('click', () => controls.flyTo(p.camp.dir.clone(), 55));
      li.append(go);
    }
    list.append(li);
  }
  document.getElementById('world-note').textContent = 'Todos los campamentos aparecen en el planeta en tiempo real. Las colonias siguen viviendo aunque sus dueños no estén.';
}

// Hacia dónde mira la cámara: el servidor manda los colonos de las colonias cercanas.
let viewTimer = 0;
const lastView = new THREE.Vector3();

// Sesión.
document.getElementById('player-name').textContent = player.name;
new SettingsUI({ net, playerName: player.name });
document.getElementById('logout').addEventListener('click', () => logout(net));

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
    // Cerca del suelo, el detalle fino sólo hace falta en lo cercano: más lejos se ve el
    // relieve con menos triángulos (la bruma lo disimula). Sin esto, a ras de suelo se
    // detallaba el terreno hasta 150 km y era lo que más costaba dibujar.
    const clearance = Math.max(1, altitude - controls.groundHeight);
    planet.terrain.detailDistance = Math.min(scene.fog.far * 0.8, Math.max(2_500, clearance * 80));
  } else {
    scene.fog.near = scene.fog.far = 1e12;
    planet.terrain.detailDistance = Infinity;
  }
}

const centerRay = new THREE.Ray();
const groundSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS);
const hit = new THREE.Vector3();
let centerHit = null; // punto del suelo en el centro de la pantalla (o null si es cielo)
const centerDir = new THREE.Vector3();
let smoothedFocus = null;
let lastFocusAt = 0;

// Actualiza el "hueco" de las nubes: distancia al punto del suelo que se ve en el
// centro de la pantalla y cuánto se aplica según la altura.
function updateCloudFade(clearance) {
  camera.getWorldDirection(centerRay.direction);
  centerRay.origin.copy(camera.position);
  groundSphere.radius = RADIUS + Math.max(0, controls.groundHeight);
  const altitude = camera.position.length() - RADIUS;
  centerHit = centerRay.intersectSphere(groundSphere, hit);
  const focus = centerHit ? hit.distanceTo(camera.position) : Math.sqrt(altitude * (2 * RADIUS + altitude)); // o el horizonte
  // Se suaviza (en logaritmo): al moverse rápido el centro pasa del suelo al cielo y la
  // distancia saltaba, con lo que las nubes se aclaraban y oscurecían de golpe.
  const now = performance.now();
  const k = smoothedFocus === null ? 1 : 1 - Math.exp(-Math.min(0.25, (now - lastFocusAt) / 1000) * 14);
  lastFocusAt = now;
  smoothedFocus = Math.exp(Math.log(smoothedFocus ?? focus) + (Math.log(focus) - Math.log(smoothedFocus ?? focus)) * k);
  cloudFade.focusDistance.value = smoothedFocus;
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

// ---- Mientras no estabas ------------------------------------------------------------
// El servidor sigue simulando la colonia cuando el jugador no está (nadie baja de la salud
// crítica) y al volver manda un resumen de lo que pasó (sim/away.js).

function campTimeLabel() {
  const d = camps.camp?.dir;
  return d ? `Día ${dayNight.day} · ${formatHour(dayNight.localHour(Math.atan2(d.x, d.z)))}` : '';
}

function showAwaySummary({ title, lines, bad }) {
  document.getElementById('away-title').textContent = title;
  const list = document.getElementById('away-list');
  list.textContent = '';
  for (const text of lines) {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
  }
  list.lastChild?.classList.toggle('is-bad', !!bad);
  document.getElementById('away-card').hidden = false;
}
document.getElementById('away-close').addEventListener('click', () => {
  document.getElementById('away-card').hidden = true;
});

const clock = new THREE.Clock();
let labelTimer = 0;
let weatherPlaceTimer = 0;
renderer.setAnimationLoop(() => {
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 0.1);
  updateQuality(rawDelta);
  controls.update(delta);
  dayNight.setElapsed(worldTime());
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
  // El clima es el de la colonia más cercana a lo que se mira: la propia o la de otro
  // jugador (el servidor manda el de cada zona en vivo). Sin ninguna cerca, uno inventado.
  weatherPlaceTimer -= delta;
  if (weatherPlaceTimer <= 0) {
    weatherPlaceTimer = 2;
    weather.setPlace(controls.dir);
  }
  let source = campDir && colony.weather ? { weather: colony.weather, distance: controls.dir.angleTo(campDir) * RADIUS } : null;
  const theirs = others.nearestWeather(controls.dir);
  if (theirs && (!source || theirs.distance < source.distance)) source = theirs;
  const nearZone = source ? 1 - THREE.MathUtils.smoothstep(source.distance, 40_000, 150_000) : 1;
  weatherNear = nearZone * (1 - THREE.MathUtils.smoothstep(clearance, 8_000, 80_000));
  weather.density = THREE.MathUtils.clamp(1 / quality.scale, 0.35, 1); // menos gotas si va lento
  if (source) weather.follow(source.weather, delta, camera, nearZone > 0.5 ? clearance : Infinity);
  else weather.update(delta, delta, camera, clearance);
  colonyView.update(delta, delta);
  buildings.update();
  colonyUI.update(delta);
  buildUI.update(delta);
  ageUI.update(delta);
  villageUI.update(delta);
  militaryUI.update(delta);
  harvest.update(waterUniforms.uTime.value, delta);
  roads.update();
  others.update(delta);
  viewTimer -= delta;
  if (viewTimer <= 0 && lastView.angleTo(resourceFocus) * RADIUS > 500) {
    viewTimer = 1;
    lastView.copy(resourceFocus);
    net.send({ t: 'view', dir: { x: resourceFocus.x, y: resourceFocus.y, z: resourceFocus.z } });
  }
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
          ? `${w.name} en esta zona: con lluvia el pozo rinde más y las bayas y setas crecen antes`
          : `${w.name} en esta zona`;
      }
    }
    if (biomeLabel) {
      centerDir.copy(hit).normalize();
      biomeLabel.textContent = centerHit ? biomeAt(centerDir.x, centerDir.y, centerDir.z).name : '–';
    }
  }

  camera.getWorldDirection(shadowForward);
  const shadowClearance = Math.max(1, controls.altitude - controls.groundHeight);
  const cameraMoving =
    camera.position.distanceTo(lastShadowPosition) > Math.max(2, shadowClearance * 0.004) || shadowForward.angleTo(lastShadowForward) > 0.004;
  if (cameraMoving || shadowFrame++ % SHADOW_EVERY_FRAMES === 0) {
    renderer.shadowMap.needsUpdate = true;
    lastShadowPosition.copy(camera.position);
    lastShadowForward.copy(shadowForward);
  }
  sky.update(camera, dayNight.sunDirection, dayNight.moonDirection, sun.color);
  renderer.render(scene, camera);
});
