import * as THREE from 'three';
import { BUILDINGS } from './sim/buildingTypes.js';
import { diagnose as diagnoseMood } from './sim/wellbeing.js';
import { RADIUS } from './elevation.js';
import { createPlanet } from './planet.js';
import { PlanetControls } from './controls.js';
import { DayNight, formatHour } from './daynight.js';
import { cloudFade } from './clouds.js';
import { waterUniforms } from './water.js';
import { CampSystem } from './camp.js';
import { biomeAt } from './biomes.js';
import { ResourceSystem } from './resources.js';
import { FoliageSystem } from './foliage.js';
import { createSky } from './sky.js';
import { graphics } from './graphics.js';
import { DAY_LENGTH_SECONDS, YEAR_DAYS, dateAt, seasonAt, effectiveTemperature, snowCover } from './sim/calendar.js';
import { setSeasonPhase } from './seasonShader.js';
import { ColonySim } from './sim/colony.js';
import { ColonyView } from './colonists.js';
import { ColonyUI } from './colonyUI.js';
import { BuildingSystem } from './buildings.js';
import { updateSmokes } from './chimneySmoke.js';
import { initTorchLights, updateTorches } from './torchFlames.js';
import { startFireworks, updateFireworks } from './fireworks.js';
import { DeadView } from './deadView.js';
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
import { GridSystem } from './grid.js';
import { GuideUI } from './guideUI.js';
import { WorkUI } from './workUI.js';
import { levelOf } from './sim/buildingTypes.js';
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
const seasonName = document.getElementById('season-name');
const climatePlace = document.getElementById('climate-place');
const biomeLabel = document.getElementById('biome');
const netStatus = document.getElementById('net-status');

// Profundidad: en vez de logarithmicDepthBuffer (que obliga a cada píxel a escribir su profundidad
// a mano y apaga el descarte temprano de la GPU: el terreno costaba el doble) se usa el buffer
// normal con near/far que siguen a la cámara (ver updateCameraRange). El Sol, la Luna y las
// estrellas se dibujan antes, en su propio pase con otro rango, así que se ven igual de lejos.
// Con ?log en la dirección se vuelve al buffer logarítmico (para comparar).
const flags = new URLSearchParams(location.search);
const useLogDepth = flags.has('log');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: graphics.antialias, logarithmicDepthBuffer: useLogDepth });
renderer.setPixelRatio(graphics.maxPixelRatio);
renderer.autoClear = false; // se limpia a mano: pase del cielo y luego el del mundo
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = graphics.shadows;
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
// El color de fondo (espacio o cielo) lo pinta el pase del cielo; el mundo se dibuja encima.
const background = SPACE_COLOR.clone();
const skyScene = new THREE.Scene();
skyScene.background = background;
scene.fog = new THREE.Fog(SKY_DAY.clone(), 1e12, 1e12);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.4, RADIUS * 20);
// Cámara del pase del cielo: mismo punto de vista, pero ve de RADIUS a RADIUS * 30 (Sol, Luna y estrellas).
const skyCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, RADIUS, RADIUS * 30);
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
initTorchLights(scene); // unas pocas luces que se reparten entre las antorchas más cercanas

const stars = createStars(4000);
const sky = createSky(skyScene);
skyScene.add(stars);

const planet = createPlanet();
scene.add(planet.object);

const resources = new ResourceSystem(scene);
const foliageLocal = new THREE.Vector3();
const foliage = new FoliageSystem(scene, {
  // Ni sobre los caminos ni dentro de la aldea: se mira con las reglas de la propia colonia.
  blocked: (world) => {
    if (!colony.camp) return false;
    colony.toLocal(world, foliageLocal);
    return Math.hypot(foliageLocal.x, foliageLocal.z) < 400 && (colony.nearRoad(foliageLocal.x, foliageLocal.z, 1.2) || colony.blockedByBuilding(foliageLocal.x, foliageLocal.z));
  },
  density: () => graphics.foliage * Math.min(1, 1.4 / Math.max(1, quality.scale)),
});
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
  pickColonist: (x, y) => colonyView.pickAt(x, y) ?? (colonyView.pickMobAt(x, y) != null ? true : null),
});
// Los difuntos que se ven: cuerpos tirados o llevados, tumbas, jarrones (sim/cemetery.js; la lista la manda el servidor).
const deadView = new DeadView({ scene, sim: colony, buildings, colonyView });
colony.on('dead', () => deadView.sync());
colony.on('buildings', () => deadView.sync());
const harvest = new HarvestTool({ scene, camera, canvas, colony, controls, campObject });
// Recursos del mundo: lo talado desaparece y lo que brota con la lluvia aparece.
// mergeRemoved (no restoreRemoved): lo propio nunca se "destala", así que sumar es seguro
// y no pisa lo que ya se sumó de una aldea visitada (restoreRemoved lo reemplazaba entero).
colony.on('resources', () => {
  resources.mergeRemoved(colony.serializeRemoved());
  resources.setExtraTile(GROVE_KEY, colony.groveTile);
  resources.setExtraTile(SPROUT_KEY, colony.sproutTile);
  // La arboleda y los brotes propios: lo talado debe verse igual que en el servidor (y que lo ven los demás).
  resources.setRemoved(GROVE_KEY, colony.removed.get(GROVE_KEY));
  resources.setRemoved(SPROUT_KEY, colony.removed.get(SPROUT_KEY));
});
const militaryUI = new MilitaryUI({ colony, button: document.getElementById('military-button'), panel: document.getElementById('military-panel') });
militaryUI.onOpen = () => villageUI.toggle(false);
makeFoldable(document.getElementById('colony-card'), { startFoldedOnSmall: true });
for (const id of ['colonist-panel', 'building-panel', 'world-panel']) makeFoldable(document.getElementById(id));
const villageUI = new VillageUI({ colony, button: document.getElementById('village-button'), panel: document.getElementById('village-panel') });
villageUI.onOpen = () => militaryUI.toggle(false);
colony.on('flag', () => camps.setFlag(colony.flag));
// Tu campamento lleva el nombre que le pusiste (si no, "Campamento").
const campLabel = document.querySelector('#camp-marker .camp-marker-label');
const syncVillageLabel = () => campLabel && (campLabel.textContent = colony.villageName || 'Campamento');
colony.on('village', syncVillageLabel);
syncVillageLabel();
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
// Derrota: si mueren todos, se explica la causa y se puede volver a fundar.
{
  const modal = document.getElementById('defeat-modal');
  const show = (d) => {
    if (!d) {
      modal.hidden = true;
      return;
    }
    document.getElementById('defeat-cause').textContent = d.cause;
    const list = colony.deaths?.length ? colony.deaths : [];
    document.getElementById('defeat-list').innerHTML = (d.last ? `<li>Último en caer: ${d.last.replace(/[&<>]/g, '')}</li>` : '') + list.map((x) => `<li>${x.name.replace(/[&<>]/g, '')}: ${x.cause}</li>`).join('');
    modal.hidden = false;
  };
  colony.on('defeat', show);
  document.getElementById('defeat-refound').addEventListener('click', () => net.send({ t: 'refound' }));
  net.on('colonyReset', () => location.reload());
}
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
function showNotice(text, isError = false, ms = 4000) {
  notice.textContent = text;
  notice.classList.toggle('is-error', isError);
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.hidden = true), ms);
}

// Cambios de estación y temporales sobre TU aldea: salen de la fecha del mundo y del clima que manda el servidor (los
// mismos para todos), así que todos los jugadores de la zona los ven a la vez. Sólo se anuncia un cambio, no cada tanto.
const SEASON_NEWS = {
  spring: 'Llega la primavera: la vegetación y los cultivos rebrotan más rápido.',
  summer: 'Llega el verano: hace calor y los colonos beben más.',
  autumn: 'Llega el otoño: los árboles pierden la hoja y empieza a enfriar. Asegurá comida y abrigo.',
  winter: 'Llega el invierno: más frío y poco rebrote; puede nevar. Mantené a todos cerca de la fogata y con comida.',
  wet: 'Empieza la época de lluvias: más agua y más lluvia, la vegetación crece.',
  dry: 'Empieza la época seca: llueve poco; cuidá el agua.',
};
const announced = { season: null, weather: null, weatherAt: -1e9 };
function announceNews(date) {
  const campDir = camps.camp?.dir;
  if (!campDir) return;
  const season = seasonAt(campDir.y, date.phase);
  if (announced.season === null) announced.season = season.id;
  else if (announced.season !== season.id) {
    announced.season = season.id;
    showNotice(SEASON_NEWS[season.id] ?? `Cambió la estación: ${season.name}.`, false, 9000);
  }
  const w = colony.weather;
  if (!w) return;
  const snowy = w.snowy && w.rain > 0.05;
  const kind = w.state.id === 'storm' ? (snowy ? 'blizzard' : 'storm') : w.state.id === 'rain' ? (snowy ? 'snow' : 'rain') : 'calm';
  if (announced.weather === null) announced.weather = kind;
  else if (announced.weather !== kind) {
    const before = announced.weather;
    announced.weather = kind;
    const now = performance.now();
    const text = {
      storm: '¡Temporal sobre tu aldea! Tormenta: mucha lluvia, buscá refugio y cuidá el abrigo.',
      blizzard: '¡Ventisca sobre tu aldea! Nieve y viento fuertes: todos junto a la fogata.',
      rain: 'Empieza a llover en tu aldea: el pozo rinde más y rebrotan bayas y setas.',
      snow: 'Empieza a nevar en tu aldea: hace más frío.',
      calm: before === 'storm' || before === 'blizzard' ? 'Pasó el temporal.' : null,
    }[kind];
    if (text && now - announced.weatherAt > 20_000) {
      announced.weatherAt = now;
      showNotice(text, kind === 'storm' || kind === 'blizzard', 8000);
    }
  }
}
// Nacimientos, muertes, tecnologías, semillas que caen al talar... la
// simulación ya los avisa con "notice" desde hace rato; faltaba mostrarlos en pantalla.
colony.on('notice', (text) => showNotice(text));

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
const grid = new GridSystem({ scene, colony, isDrawing: () => !!buildings.placing || roads.active });
buildings.grid = grid;
roads.onMessage = (text) => showNotice(text, true);
{
  const gridButton = document.getElementById('grid-toggle');
  const syncGrid = () => gridButton.setAttribute('aria-pressed', String(grid.enabled));
  gridButton.addEventListener('click', () => grid.toggle());
  grid.onChange = syncGrid;
  syncGrid();
}
controls.blockLeftDrag = () => harvest.active || roads.active || !!buildings.placing?.line;
const buildUI = new BuildUI({ buildings, colony, harvest, roads, onFocusColonist: (c) => colonyUI.focusColonist(c) });
// Acciones sugeridas en la ficha de un colono: sólo llevan a ver el problema (cámara o menú); nunca gastan ni construyen.
document.addEventListener('colony:action', (e) => {
  const a = e.detail;
  const flyTo = (x, z) => controls.flyTo(colony.toDirection(x, z, new THREE.Vector3()), 45);
  if (a.kind === 'build' && a.type) buildUI.setTab(BUILDINGS[a.type]?.category ?? 'housing', false);
  else if (a.kind === 'build') buildUI.setTab('production', false);
  else if (a.kind === 'storage') flyTo(colony.layout.storage.x, colony.layout.storage.z);
  else if (a.kind === 'building' || a.kind === 'housing') {
    const home = a.id != null ? colony.building(a.id) : colony.buildings.find((b) => b.def.levels[0].housing != null && b.done);
    if (home) flyTo(home.x, home.z);
    else buildUI.setTab('housing', false);
  }
});
// Un aviso colectivo ("4 colonos no tienen cama") lleva al siguiente afectado cada vez que se toca.
const affectedCursor = new Map();
document.addEventListener('colony:focus-colonists', (e) => {
  const { id, ids } = e.detail;
  const i = (affectedCursor.get(id) ?? -1) + 1;
  affectedCursor.set(id, i);
  const c = colony.colonist(ids[i % ids.length]);
  if (c) colonyUI.focusColonist(c);
});
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

const workUI = new WorkUI({ colony, onFocus: (c) => { workUI.toggle(false); colonyUI.focusColonist(c); } });

// Guía de la edad: cada paso abre la acción que corresponde (sin bloquear nada más).
const guideUI = new GuideUI({
  colony,
  actions: {
    tour: () => {
      colony.learn('tour');
      if (colony.colonists[0]) colonyUI.focusColonist(colony.colonists[0]);
    },
    materials: () => {
      buildings.stopPlacing();
      harvest.kinds = new Set(['wood', 'food', 'stone']);
      harvest.setActive(true, 'mark');
    },
    food: () => {
      buildings.stopPlacing();
      harvest.kinds = new Set(['food']);
      harvest.setActive(true, 'mark');
    },
    water: () => {
      const b = colony.buildings.find((o) => o.done && levelOf(o).rainOnly);
      const view = buildings.list.find((o) => o.id === b?.id);
      if (view) buildings.select(view);
      colony.learn('water_seen');
    },
    shelter: () => {
      buildUI.setTab('housing');
      buildings.startPlacing('house');
    },
    stockpile: () => {
      buildUI.setTab('storage');
      buildings.startPlacing('stockpile');
    },
    discovery: () => {
      if (!colony.discover()) showNotice(colony.discoveryProblem() ?? 'Todavía no se puede', true);
    },
    advance: () => {
      ageUI.tab = 'siguiente';
      ageUI.renderedFor = null;
      ageUI.toggle(true);
    },
  },
});
// Mirar el recolector de lluvia cuenta como entender el agua.
{
  const prev = buildings.onSelect;
  buildings.onSelect = (b) => {
    prev?.(b);
    if (b && !b.isStore && levelOf(b).rainOnly) colony.learn('water_seen');
  };
}

// ---- Los demás jugadores: sus campamentos, edificios y colonos, en vivo ---------------
const others = new OtherCamps({ scene, terrain: planet.terrain, camera, canvas, labelsRoot: document.getElementById('labels'), resources });
others.myId = player.playerId;
const worldButton = document.getElementById('world-button');
const worldPanel = document.getElementById('world-panel');
camps.getOthers = () => others.campList(); // no fundar pegado a otro jugador
others.onPlayers = renderPlayers;
net.on('players', (m) => others.sync(m.list));
// Una aldea (la tuya o la de otro jugador) subió de edad: aviso para todos y fuegos artificiales sobre ella.
net.on('celebrate', (m) => {
  if (!m.dir || ![m.dir.x, m.dir.y, m.dir.z, m.height].every(Number.isFinite)) return;
  const mine = m.id === player.playerId;
  const who = m.village ?? `la aldea de ${m.player}`;
  const text = mine ? `¡Tu aldea llegó a la ${m.ageName}! Fuegos artificiales y todos los colonos lo celebran.` : `🎆 ${who[0].toUpperCase()}${who.slice(1)} llegó a la ${m.ageName}`;
  showNotice(text, false, 9000);
  startFireworks(scene, m.dir, m.height);
});
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
    // Se ve el nombre de la aldea; debajo, de qué jugador es.
    name.textContent = p.village ? (p.isMe ? `${p.village} (tu aldea)` : p.village) : p.isMe ? `${p.name} (tú)` : p.name;
    const detail = document.createElement('span');
    const state = p.isMe || p.online ? 'conectado' : 'desconectado';
    const sky = WEATHER[p.weather]?.name; // clima de su zona (cambia en vivo)
    detail.textContent = p.camp
      ? `${p.village ? `Jugador ${p.name} · ` : ''}Edad ${['I', 'II', 'III', 'IV', 'V'][p.age - 1] ?? p.age} · ${p.population} colonos · ${sky ? sky + ' · ' : ''}${state}`
      : `Todavía sin campamento · ${state}`;
    info.append(name, detail);
    li.append(info);
    if (p.camp) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn';
      go.textContent = 'Ir';
      go.addEventListener('click', () => controls.flyTo(p.camp.dir.clone(), 55, { orbit: true }));
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
new SettingsUI({ net, playerName: player.name, colony });
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

// Cuánto de noche es donde se mira (0 día, 1 noche cerrada): las antorchas encienden su luz con ella.
let nightLevel = 0;

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
  background.copy(SPACE_COLOR).lerp(skyColor, inAtmosphere);
  stars.material.opacity = 1 - inAtmosphere * (0.15 + 0.85 * daylight);
  stars.position.copy(camera.position);

  // Atardeceres anaranjados, pero sólo cuando estás dentro de la atmósfera.
  sun.color.copy(SUN_WHITE).lerp(SUN_ORANGE, dusk * inAtmosphere);

  // De noche sube la luz ambiente y la de la luna para que se siga viendo el paisaje.
  const night = 1 - daylight;
  nightLevel = night;
  ambient.intensity = 0.45 + 1.1 * night;
  moon.intensity = (0.4 + 1.4 * night) * (0.55 + 0.45 * dayNight.moonIllumination);

  if (altitude < 200_000) {
    const horizon = Math.sqrt(altitude * (2 * RADIUS + altitude));
    scene.fog.color.copy(background);
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

// near/far de la cámara según dónde está: nada de lo que se ve queda más cerca que una fracción
// de la altura sobre el suelo, y nada más lejos que el otro lado de la atmósfera. Así el buffer
// de profundidad normal rinde con precisión de sobra desde 7 m hasta el espacio.
let rangeNear = 0;
let rangeFar = 0;
function updateCameraRange(clearance, altitude) {
  if (useLogDepth) return;
  const high = THREE.MathUtils.smoothstep(clearance, 100_000, 1_000_000);
  const near = Math.max(0.4, clearance * THREE.MathUtils.lerp(0.03, 0.5, high));
  const far = RADIUS + altitude + RADIUS * 1.2;
  if (Math.abs(near - rangeNear) > rangeNear * 0.02 || Math.abs(far - rangeFar) > rangeFar * 0.02) {
    rangeNear = near;
    rangeFar = far;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
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
  camera.aspect = skyCamera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  skyCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Calidad automática: si los fotogramas tardan mucho se reduce el detalle del
// terreno poco a poco, y si sobra tiempo se recupera.
// Para sostener los 60 FPS primero baja la resolución (se ve algo menos nítido, pero se ve todo
// igual de lejos) y sólo si ya está al mínimo reduce los triángulos del terreno. Cuando el equipo
// va sobrado, sube todo de a poco; después de bajar espera un rato antes de volver a subir para
// no oscilar.
const quality = { frameTime: 1 / 60, timer: 0, scale: graphics.detailBias, pixelRatio: graphics.maxPixelRatio, calm: 0, holdUntil: 0 };
function updateQuality(rawDelta) {
  quality.frameTime += (Math.min(rawDelta, 0.25) - quality.frameTime) * 0.05;
  quality.timer += rawDelta;
  if (quality.timer < 1) return;
  quality.timer = 0;
  const now = performance.now();
  const fixed = graphics.minPixelRatio === graphics.maxPixelRatio && flags.has('pr');
  if (quality.frameTime > 1 / 56 && !fixed) {
    // No llega a 60: bajar resolución; con la resolución al mínimo, bajar detalle del terreno.
    quality.calm = 0;
    quality.holdUntil = now + 15_000;
    if (quality.pixelRatio > graphics.minPixelRatio + 0.01) setPixelRatio(Math.max(graphics.minPixelRatio, quality.pixelRatio * (quality.frameTime > 1 / 40 ? 0.8 : 0.92)));
    else quality.scale = Math.min(graphics.detailBias * 2.2, quality.scale * 1.15);
  } else if (quality.frameTime < 1 / 58.5 && now > quality.holdUntil && !fixed) {
    // Sobra margen durante varios segundos seguidos: recuperar primero el terreno y después la resolución.
    if (++quality.calm >= 6) {
      quality.calm = 0;
      if (quality.scale > graphics.detailBias + 0.01) quality.scale = Math.max(graphics.detailBias, quality.scale / 1.1);
      else if (quality.pixelRatio < graphics.maxPixelRatio - 0.01) setPixelRatio(Math.min(graphics.maxPixelRatio, quality.pixelRatio * 1.06));
    }
  } else {
    quality.calm = 0;
  }
  planet.terrain.detailScale = quality.scale;
}
function setPixelRatio(value) {
  quality.pixelRatio = value;
  renderer.setPixelRatio(value);
}

// Diagnóstico: con ?debug en la dirección se expone lo principal para medir (consola del navegador).
// Diagnóstico de un colono (sólo con ?debug): window.__dbg.colonist(id). Tarea, desplazamiento, bloqueo, cola, desvío y por qué está como está.
function debugColonist(id) {
  const c = colony.colonist(id);
  if (!c) return null;
  const d = diagnoseMood(colony, c);
  return {
    nombre: c.name, tarea: c.task?.type ?? c.taskType ?? null, actividad: c.activity,
    pos: [c.x, c.z].map((v) => +v.toFixed(2)), caminaPorIntencion: !!c.walking, seMueveDeVerdad: !!c.moving,
    sinProgreso: +(c.blocked ?? 0).toFixed(1), enCola: +(c.queued ?? 0).toFixed(1), desvio: c.detour ?? null, progreso: c.progress ?? null,
    ultimoMotivoBloqueo: c.stuckWhy ?? null, bloqueo: c.block ?? null, evita: c.avoid ?? null,
    animo: { valor: d.mood, objetivo: d.target, categoria: d.band.text, tendencia: d.trendText, causas: d.causes.map((x) => [x.id, x.impact, x.blocker ?? null]), positivos: d.positives.map((x) => [x.id, x.impact]) },
  };
}
if (new URLSearchParams(location.search).has('debug')) window.__dbg = { colonist: debugColonist, graphics, renderer, buildings, harvest, colonyView, roads, scene, camera, quality, planet, resources, controls, colony, others, camps, THREE };

// ---- Mientras no estabas ------------------------------------------------------------
// El servidor sigue simulando la colonia cuando el jugador no está (nadie baja de la salud
// crítica) y al volver manda un resumen de lo que pasó (sim/away.js).

function campTimeLabel() {
  const d = camps.camp?.dir;
  if (!d) return '';
  const date = dateAt(worldTime());
  return `Año ${date.year} · Día ${date.dayOfYear} · ${formatHour(dayNight.localHour(Math.atan2(d.x, d.z)))}`;
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
// Perfil por secciones del bucle (sólo con ?debug): milisegundos medios en window.__dbg.prof.
const prof = window.__dbg ? (window.__dbg.prof = {}) : null;
let profT = 0;
const lap = prof ? (name) => { const t = performance.now(); prof[name] = (prof[name] ?? 0) * 0.95 + (t - profT) * 0.05; profT = t; } : () => {};
let labelTimer = 0;
let weatherPlaceTimer = 0;
let sitesTimer = 0;
// Sólo para pruebas visuales: ?doy=200&hour=13 fija el día del año y la hora local que se dibujan (no toca el
// mundo ni el servidor: el clima y la simulación siguen siendo los reales).
const debugPhase = flags.has('doy') ? (Number(flags.get('doy')) - 0.5) / YEAR_DAYS : null;
function debugElapsed(lon) {
  const hour = flags.has('hour') ? Number(flags.get('hour')) : 13;
  const lonHours = (lon / (Math.PI * 2)) * 24;
  const f = (((hour - lonHours) / 24) % 1 + 1) % 1;
  return (Number(flags.get('doy')) - 1 + f - 0.5) * DAY_LENGTH_SECONDS;
}
let sitesSig = '';
renderer.setAnimationLoop(() => {
  if (prof) profT = performance.now();
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 0.1);
  updateQuality(rawDelta);
  controls.update(delta);
  // La fecha sale del reloj del servidor (no del de esta máquina): todos ven la misma estación.
  const worldNow = debugPhase !== null ? debugElapsed(controls.lon) : worldTime();
  const date = dateAt(worldNow);
  setSeasonPhase(date.phase);
  if (controls.flight) planet.terrain.setPrefetch(controls.flight.pivot, controls.flight.clearance);
  lap('controls');
  dayNight.setElapsed(worldNow);
  waterUniforms.uTime.value += delta;

  const altitude = camera.position.length() - RADIUS;
  const clearance = Math.max(1, altitude - controls.groundHeight);
  updateSun(clearance);
  updateCameraRange(clearance, altitude);
  lap('sun');
  planet.update(delta, camera, dayNight.sunDirection, window.innerHeight);
  lap('planet');
  updateCloudFade(clearance);
  lap('clouds');
  // Los recursos se dibujan alrededor del punto que se mira (centro de la pantalla).
  if (centerHit) resourceFocus.copy(hit).normalize();
  else resourceFocus.copy(controls.dir);
  sitesTimer -= delta;
  if (sitesTimer <= 0) {
    sitesTimer = 1;
    // Las aldeas del mundo: alrededor de cada una los recursos se dibujan siempre enteros.
    const sites = [];
    if (colony.camp) sites.push({ pos: colony.camp.position, dir: colony.camp.dir });
    for (const entry of others.camps.values()) sites.push({ pos: entry.dir.clone().multiplyScalar(RADIUS + entry.height), dir: entry.dir });
    const sig = sites.map((s) => `${s.dir.x.toFixed(5)},${s.dir.y.toFixed(5)},${s.dir.z.toFixed(5)}`).join('|');
    if (sig !== sitesSig) {
      sitesSig = sig;
      resources.setSites(sites);
    }
  }
  resources.gameTime = colony.gameTime; // los brotes plantados crecen con la hora de juego de tu aldea
  resources.update(camera, resourceFocus, clearance, delta);
  lap('resources');
  foliage.update(camera, resourceFocus, clearance, delta);
  lap('foliage');
  camps.update(delta);
  lap('camps');
  const campDir = camps.camp?.dir;
  // El clima es el de la colonia más cercana a lo que se mira: la propia o la de otro
  // jugador (el servidor manda el de cada zona en vivo). Sin ninguna cerca, uno inventado.
  weatherPlaceTimer -= delta;
  if (weatherPlaceTimer <= 0) {
    weatherPlaceTimer = 2;
    weather.setPlace(controls.dir);
  }
  let source = campDir && colony.weather ? { weather: colony.weather, distance: controls.dir.angleTo(campDir) * RADIUS, name: 'tu aldea' } : null;
  const theirs = others.nearestWeather(controls.dir);
  if (theirs && (!source || theirs.distance < source.distance)) source = theirs;
  const nearZone = source ? 1 - THREE.MathUtils.smoothstep(source.distance, 40_000, 150_000) : 1;
  weatherNear = nearZone * (1 - THREE.MathUtils.smoothstep(clearance, 8_000, 80_000));
  weather.density = THREE.MathUtils.clamp(1 / quality.scale, 0.35, 1); // menos gotas si va lento
  if (source) weather.follow(source.weather, delta, camera, nearZone > 0.5 ? clearance : Infinity);
  else weather.update(delta, delta, camera, clearance);
  lap('weather');
  colonyView.update(delta, delta);
  lap('colonyView');
  buildings.update();
  updateSmokes(); // humo de las cocinas (sólo mientras hay alguien comiendo dentro)
  updateTorches(undefined, camera, nightLevel); // llamas de las antorchas (con luz de noche)
  updateFireworks(); // fuegos artificiales de las aldeas que suben de edad
  deadView.update(); // el cuerpo o el jarrón que alguien lleva va con él
  lap('buildings');
  colonyUI.update(delta);
  buildUI.update(delta);
  ageUI.update(delta);
  guideUI.update(delta);
  workUI.update(delta);
  villageUI.update(delta);
  militaryUI.update(delta);
  lap('uis');
  harvest.update(waterUniforms.uTime.value, delta);
  roads.update();
  grid.update();
  others.update(delta);
  lap('harvest+roads+grid+others');
  viewTimer -= delta;
  if (viewTimer <= 0 && lastView.angleTo(resourceFocus) * RADIUS > 500) {
    viewTimer = 1;
    lastView.copy(resourceFocus);
    net.send({ t: 'view', dir: { x: resourceFocus.x, y: resourceFocus.y, z: resourceFocus.z } });
  }
  updateSky(altitude);
  lap('sky');

  labelTimer -= delta;
  if (labelTimer <= 0) {
    labelTimer = 0.1;
    if (altitudeLabel) altitudeLabel.textContent = formatAltitude(clearance);
    if (timeLabel) timeLabel.textContent = formatHour(dayNight.localHour(controls.lon));
    if (dayLabel) dayLabel.textContent = `Año ${date.year} · Día ${date.dayOfYear}`;
    // Estación del lugar que se mira (fecha del mundo + latitud) y de qué aldea es el clima mostrado.
    const here = seasonAt(controls.dir.y, date.phase);
    if (seasonName) seasonName.textContent = `${here.name} · hemisferio ${here.north ? 'norte' : 'sur'}`;
    announceNews(date);
    const placeText = source && nearZone > 0.5 ? `Clima de ${source.name === 'tu aldea' ? (colony.villageName || 'tu aldea') : source.village ?? 'la aldea de ' + source.name}` : 'Sin aldea cerca: clima de ejemplo';
    if (climatePlace && climatePlace.textContent !== placeText) climatePlace.textContent = placeText;
    if (weatherChip) {
      const w = weather.state;
      const snowy = weather.snowy && weather.rain > 0.05;
      const key = w.id + (snowy ? '-nieve' : '') + placeText;
      if (weatherChip.dataset.key !== key) {
        weatherChip.dataset.key = key;
        weatherChip.dataset.state = snowy ? 'snow' : w.id;
        weatherIcon.setAttribute('href', snowy ? '#i-w-snow' : `#i-w-${w.icon}`);
        const name = snowy ? (w.id === 'storm' ? 'Ventisca' : 'Nevada') : w.name;
        weatherName.textContent = name;
        weatherChip.title = w.rain
          ? `${name} (${placeText.toLowerCase()}): con lluvia el pozo rinde más y las bayas y setas crecen antes`
          : `${name} (${placeText.toLowerCase()})`;
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
  lap('labels+shadowcheck');
  sky.update(camera, dayNight.sunDirection, dayNight.moonDirection, sun.color);
  lap('skyupdate');
  // Pase 1: fondo, estrellas, Sol y Luna. Pase 2: el mundo encima (sin tocar el color ya pintado).
  skyCamera.position.copy(camera.position);
  skyCamera.quaternion.copy(camera.quaternion);
  if (useLogDepth) {
    renderer.render(skyScene, camera);
  } else {
    skyCamera.fov = camera.fov;
    renderer.render(skyScene, skyCamera);
  }
  renderer.clearDepth();
  renderer.render(scene, camera);
  lap('render');
});
