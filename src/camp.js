import * as THREE from 'three';
import { RADIUS, elevation, surfaceHeight } from './elevation.js';

// Campamento inicial de la civilización: el jugador elige dónde fundarlo haciendo clic
// en el terreno. Se guarda en el navegador para recuperarlo al volver a abrir el juego.

const STORAGE_KEY = 'colonymaxai.camp';
const MAX_PICK_CLEARANCE = 60_000; // hay que acercarse a menos de 60 km para elegir el sitio
const MAX_SLOPE = 0.5; // pendiente máxima (desnivel / distancia), unos 27°
const CAMP_RADIUS = 45; // metros: tamaño del anillo de la vista previa
const CLICK_TOLERANCE = 6; // píxeles que se puede mover el puntero y seguir contando como clic
const FLY_TO_CLEARANCE = 55; // altura a la que se acerca la cámara al fundar o ir al campamento

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Modelo low poly del campamento (en metros, con el eje Y hacia arriba)
// ---------------------------------------------------------------------------

function flatMaterial(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...extra });
}

function createTent(color, size = 1) {
  const tent = new THREE.Group();
  const cloth = new THREE.Mesh(new THREE.ConeGeometry(4 * size, 5.5 * size, 6), flatMaterial(color));
  cloth.position.y = 2.75 * size;
  tent.add(cloth);
  // Entrada oscura.
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6 * size, 2.4 * size), flatMaterial('#2a1d14'));
  door.position.set(0, 1.2 * size, 3.35 * size);
  door.rotation.x = -0.63;
  tent.add(door);
  // Palos que asoman por arriba.
  const poleMaterial = flatMaterial('#5b3b22');
  for (let i = 0; i < 3; i++) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6 * size, 4), poleMaterial);
    pole.position.y = 5.9 * size;
    pole.rotation.z = (i - 1) * 0.35;
    pole.rotation.y = i * 2.1;
    tent.add(pole);
  }
  return tent;
}

function createCampfire() {
  const fire = new THREE.Group();
  const stoneMaterial = flatMaterial('#7d7a74');
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), stoneMaterial);
    stone.position.set(Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5);
    stone.rotation.set(a, a * 2, 0);
    fire.add(stone);
  }
  const logMaterial = flatMaterial('#6b4426');
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.2, 5), logMaterial);
    log.rotation.z = Math.PI / 2 - 0.35;
    log.rotation.y = (i / 4) * Math.PI * 2;
    log.position.y = 0.45;
    fire.add(log);
  }
  const flameMaterial = new THREE.MeshStandardMaterial({
    color: '#ffb347',
    emissive: '#ff7a1a',
    emissiveIntensity: 2.5,
    flatShading: true,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.9, 5), flameMaterial);
  flame.position.y = 1.2;
  fire.add(flame);
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1.2, 5),
    new THREE.MeshStandardMaterial({ color: '#fff1a8', emissive: '#ffd24a', emissiveIntensity: 3, flatShading: true }),
  );
  inner.position.y = 0.9;
  fire.add(inner);

  // Luz de la fogata: se nota sobre todo de noche.
  const light = new THREE.PointLight('#ff9a4a', 120, 140, 2);
  light.position.y = 2.2;
  fire.add(light);

  fire.userData.flame = flame;
  fire.userData.inner = inner;
  fire.userData.light = light;
  return fire;
}

function createBanner() {
  const banner = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 9, 5), flatMaterial('#4a3120'));
  pole.position.y = 4.5;
  banner.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8, 3, 1), flatMaterial('#c0392b', { side: THREE.DoubleSide }));
  flag.position.set(1.6, 7.8, 0);
  banner.add(flag);
  banner.userData.flag = flag;
  return banner;
}

function createWoodPile() {
  const pile = new THREE.Group();
  const logMaterial = flatMaterial('#7a5230');
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - row; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 6), logMaterial);
      log.rotation.x = Math.PI / 2;
      log.position.set((i - (2 - row) / 2) * 0.62, 0.3 + row * 0.52, 0);
      pile.add(log);
    }
  }
  return pile;
}

function createCrate() {
  return new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), flatMaterial('#9c7446'));
}

export function createCampModel() {
  const camp = new THREE.Group();
  camp.name = 'camp';

  // Suelo pisado bajo el campamento, para que se lea como un claro.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(24, 9), flatMaterial('#9a8158'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.5;
  camp.add(ground);

  const fire = createCampfire();
  camp.add(fire);

  const tents = [
    { angle: 0.3, dist: 11, color: '#d9c9a3', size: 1 },
    { angle: 2.2, dist: 12, color: '#c8a77a', size: 1.15 },
    { angle: 4.1, dist: 10.5, color: '#e0d3b1', size: 0.9 },
  ];
  for (const t of tents) {
    const tent = createTent(t.color, t.size);
    tent.position.set(Math.cos(t.angle) * t.dist, 0, Math.sin(t.angle) * t.dist);
    // La entrada mira hacia la fogata.
    tent.lookAt(0, 0, 0);
    camp.add(tent);
  }

  const banner = createBanner();
  banner.position.set(-4, 0, -14);
  camp.add(banner);

  const pile = createWoodPile();
  pile.position.set(15, 0, 4);
  pile.rotation.y = 0.8;
  camp.add(pile);

  for (const [x, z, r] of [[-15, 6, 0.3], [-16.3, 7.2, 1.1], [-14.8, 7.6, 0.6]]) {
    const crate = createCrate();
    crate.position.set(x, 0.6, z);
    crate.rotation.y = r;
    camp.add(crate);
  }

  camp.userData.fire = fire;
  camp.userData.banner = banner;
  return camp;
}

// Versión semitransparente del modelo para la vista previa.
function makeGhost(model) {
  model.traverse((obj) => {
    if (obj.isLight) obj.visible = false;
    if (obj.isMesh) {
      obj.material = obj.material.clone();
      obj.material.transparent = true;
      obj.material.opacity = 0.55;
      obj.material.depthWrite = false;
    }
  });
  return model;
}

// ---------------------------------------------------------------------------
// Terreno: dónde toca el rayo del ratón y si se puede fundar ahí
// ---------------------------------------------------------------------------

const pickSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS);
const pickHit = new THREE.Vector3();

// Punto de la superficie bajo un rayo. Se intersecta con una esfera y se ajusta su
// radio a la altura del terreno unas cuantas veces (converge muy rápido).
export function pickSurface(ray, startHeight = 0) {
  let radius = RADIUS + Math.max(0, startHeight);
  const dir = new THREE.Vector3();
  let height = 0;
  for (let i = 0; i < 6; i++) {
    pickSphere.radius = radius;
    if (!ray.intersectSphere(pickSphere, pickHit)) return null;
    dir.copy(pickHit).normalize();
    height = Math.max(0, surfaceHeight(dir));
    radius = RADIUS + height;
  }
  return { dir, height, point: dir.clone().multiplyScalar(radius) };
}

function tangentBasis(dir) {
  const east = new THREE.Vector3().crossVectors(Y_AXIS, dir);
  if (east.lengthSq() < 1e-10) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(dir, east);
  return { east, north };
}

// Devuelve null si se puede fundar en esa dirección, o el motivo si no.
export function campProblem(dir) {
  const e = elevation(dir.x, dir.y, dir.z);
  if (e <= 0) return 'No se puede fundar en el agua';
  if (Math.abs(dir.y) > 0.9 || e > 0.62) return 'Hace demasiado frío (hielo o nieve)';

  // Pendiente: desnivel entre puntos a 30 m a cada lado.
  const step = 30;
  const { east, north } = tangentBasis(dir);
  const sample = (v, s) => surfaceHeight(dir.clone().addScaledVector(v, s / RADIUS).normalize());
  const dEast = (sample(east, step) - sample(east, -step)) / (2 * step);
  const dNorth = (sample(north, step) - sample(north, -step)) / (2 * step);
  if (Math.hypot(dEast, dNorth) > MAX_SLOPE) return 'El terreno es demasiado empinado';
  return null;
}

function orientOnSurface(object, dir, height, yaw) {
  object.position.copy(dir).multiplyScalar(RADIUS + height - 0.3);
  object.quaternion.setFromUnitVectors(Y_AXIS, dir);
  object.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw));
}

// ---------------------------------------------------------------------------
// Sistema: botones, modo de colocación, marcador y guardado
// ---------------------------------------------------------------------------

export class CampSystem {
  constructor({ scene, camera, canvas, controls, ui }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.controls = controls;
    this.ui = ui;

    this.camp = null; // { object, dir, height, yaw }
    this.placing = false;
    this.pointer = null; // última posición del ratón sobre el lienzo
    this.pressed = null;
    this.candidate = null;
    this.time = 0;

    this.ghost = makeGhost(createCampModel());
    this.ghost.visible = false;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(CAMP_RADIUS - 3, CAMP_RADIUS, 40),
      new THREE.MeshBasicMaterial({ color: '#5fe08a', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.6;
    this.ghost.add(this.ring);
    scene.add(this.ghost);

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.markerPos = new THREE.Vector3();

    ui.foundButton.addEventListener('click', () => this.startPlacing());
    ui.relocateButton.addEventListener('click', () => this.startPlacing());
    ui.goButton.addEventListener('click', () => this.flyToCamp());
    ui.cancelButton.addEventListener('click', () => this.stopPlacing());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.placing) this.stopPlacing();
    });

    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.pressed = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      const p = this.pressed;
      this.pressed = null;
      if (!this.placing || !p || e.button !== 0) return;
      // Sólo cuenta como clic si el puntero casi no se movió (si no, era arrastrar el mapa).
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_TOLERANCE) return;
      this.pointer = { x: e.clientX, y: e.clientY };
      this.updateCandidate();
      if (this.candidate && !this.candidate.problem) this.found(this.candidate);
    });

    this.load();
    this.refreshUi();
  }

  startPlacing() {
    this.placing = true;
    this.candidate = null;
    this.refreshUi();
  }

  stopPlacing() {
    this.placing = false;
    this.candidate = null;
    this.ghost.visible = false;
    this.ui.tooltip.hidden = true;
    this.refreshUi();
  }

  found({ dir, height }) {
    const yaw = Math.random() * Math.PI * 2;
    this.setCamp(dir, height, yaw);
    this.save();
    this.stopPlacing();
    this.flyToCamp();
  }

  setCamp(dir, height, yaw) {
    if (this.camp) {
      this.scene.remove(this.camp.object);
    }
    const object = createCampModel();
    orientOnSurface(object, dir, height, yaw);
    this.scene.add(object);
    this.camp = { object, dir: dir.clone(), height, yaw };
  }

  flyToCamp() {
    if (this.camp) this.controls.flyTo(this.camp.dir, FLY_TO_CLEARANCE);
  }

  save() {
    if (!this.camp) return;
    const { dir, yaw } = this.camp;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: dir.x, y: dir.y, z: dir.z, yaw }));
    } catch {
      // Sin almacenamiento (ventana privada, etc.): el campamento dura sólo esta sesión.
    }
  }

  load() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      data = null;
    }
    if (!data || !Number.isFinite(data.x)) return;
    const dir = new THREE.Vector3(data.x, data.y, data.z).normalize();
    this.setCamp(dir, Math.max(0, surfaceHeight(dir)), data.yaw || 0);
  }

  refreshUi() {
    const { ui } = this;
    ui.foundButton.hidden = this.placing || !!this.camp;
    ui.goButton.hidden = this.placing || !this.camp;
    ui.relocateButton.hidden = this.placing || !this.camp;
    ui.cancelButton.hidden = !this.placing;
    ui.banner.hidden = !this.placing;
    this.canvas.classList.toggle('is-placing', this.placing);
  }

  clearance() {
    return this.camera.position.length() - RADIUS - Math.max(0, this.controls.groundHeight);
  }

  updateCandidate() {
    this.candidate = null;
    if (!this.pointer) return;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((this.pointer.x - rect.left) / rect.width) * 2 - 1,
      -((this.pointer.y - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = pickSurface(this.raycaster.ray, this.controls.groundHeight);
    if (!hit) return;
    let problem = campProblem(hit.dir);
    if (this.clearance() > MAX_PICK_CLEARANCE) problem = 'Acércate más para elegir el lugar';
    this.candidate = { ...hit, problem };
  }

  update(delta) {
    this.time += delta;

    if (this.placing) {
      this.updateCandidate();
      const c = this.candidate;
      this.ghost.visible = !!c;
      if (c) {
        orientOnSurface(this.ghost, c.dir, c.height, 0);
        // Desde lejos el campamento es diminuto: la vista previa crece para verse.
        const distance = this.camera.position.distanceTo(c.point);
        this.ghost.scale.setScalar(Math.max(1, distance / 900));
        this.ring.material.color.set(c.problem ? '#ff5a4f' : '#5fe08a');
      }
      const { tooltip } = this.ui;
      tooltip.hidden = !c || !this.pointer;
      if (!tooltip.hidden) {
        tooltip.textContent = c.problem || 'Clic para fundar el campamento aquí';
        tooltip.classList.toggle('is-invalid', !!c.problem);
        tooltip.style.transform = `translate(${this.pointer.x + 16}px, ${this.pointer.y + 16}px)`;
      }
    }

    if (this.camp) this.animateCamp();
    this.updateMarker();
  }

  animateCamp() {
    const { fire, banner } = this.camp.object.userData;
    const t = this.time;
    const flicker = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
    fire.userData.flame.scale.set(1, flicker, 1);
    fire.userData.flame.rotation.y = t * 0.8;
    fire.userData.inner.scale.set(1, 2 - flicker, 1);
    fire.userData.light.intensity = 120 * flicker;
    banner.userData.flag.rotation.y = Math.sin(t * 1.7) * 0.25;
  }

  // Etiqueta "Campamento" sobre la pantalla para encontrarlo desde lejos.
  updateMarker() {
    const { marker } = this.ui;
    if (!this.camp || this.placing) {
      marker.hidden = true;
      return;
    }
    const cam = this.camera.position;
    const pos = this.markerPos.copy(this.camp.dir).multiplyScalar(RADIUS + this.camp.height + 12);
    const distance = cam.distanceTo(pos);
    // Oculto si está detrás del planeta o si ya estamos lo bastante cerca para verlo.
    const camR = cam.length();
    const horizon = Math.sqrt(Math.max(0, camR * camR - RADIUS * RADIUS));
    const hidden = distance > horizon + 20_000 || distance < 2_500;
    pos.project(this.camera);
    if (hidden || pos.z > 1 || Math.abs(pos.x) > 1.1 || Math.abs(pos.y) > 1.1) {
      marker.hidden = true;
      return;
    }
    marker.hidden = false;
    const rect = this.canvas.getBoundingClientRect();
    const x = rect.left + ((pos.x + 1) / 2) * rect.width;
    const y = rect.top + ((1 - pos.y) / 2) * rect.height;
    marker.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
}
