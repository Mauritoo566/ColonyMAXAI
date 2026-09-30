import * as THREE from 'three';
import { RADIUS, surfaceHeight, elevation } from './elevation.js';
import { campObstacles } from './camp.js';
import { seededRandom } from './modelKit.js';
import { temperature } from './biomes.js';
import { createProfile, updateNeeds, hasTrait, wellbeing, addLog } from './needs.js';
import { appearanceFromGenes, gene } from './genes.js';

// Colonos: caminan por el campamento y tienen necesidades, salud, genes, rasgos e
// historia (needs.js, genes.js). Todavía no tienen IA: pasean al azar.
//
// Cada colono se mueve en el plano local del campamento (x, z en metros, la fogata en
// el origen). La altura sale del terreno real, con una caché en rejilla para no
// recalcular el relieve en cada fotograma. Esquivan tiendas, fogata y bancos, no
// entran al agua ni a pendientes fuertes, y no se atraviesan entre ellos.

export const START_COLONISTS = 5;

const WALK_SPEED = 1.4; // m/s
const COLONIST_RADIUS = 0.45;
const WANDER = [6, 70]; // pasean por el claro y sus alrededores (metros desde la fogata)
const HEIGHT_CELL = 2; // metros por celda de la caché de alturas
const MAX_STEP = 0.1; // segundos por paso de simulación
const LABEL_DISTANCE = 170; // metros: más lejos no se muestra el nombre
const FIRE_WARMTH_RADIUS = 7; // metros: la fogata calienta a quien esté más cerca
const COMPANY_RADIUS = 5; // metros: a esta distancia se hacen compañía
const PICK_RADIUS_PX = 26; // tolerancia al hacer clic sobre un colono

const NAMES = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Facundo', 'Gala', 'Hugo', 'Inés', 'Joaquín',
  'Lara', 'Mateo', 'Nora', 'Óscar', 'Paula', 'Quique', 'Rosa', 'Santiago', 'Tania', 'Ulises',
  'Valeria', 'Walter', 'Ximena', 'Yago', 'Zoe', 'Lucía', 'Tomás', 'Mara', 'Iván', 'Olga',
];
const SHIRTS = ['#b8452f', '#3f6fa8', '#5f8a3a', '#c89a3a', '#7a4a8a', '#3a8a8a', '#a86a3a', '#d8d0b8'];
const PANTS = ['#4a3a2a', '#3a3f4a', '#5a4a36', '#2f3a2f', '#6a5a44'];

// ---------------------------------------------------------------------------
// Modelo low poly de una persona, con brazos y piernas que se mueven al caminar
// ---------------------------------------------------------------------------

const materials = new Map();
function material(color) {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });
    materials.set(color, m);
  }
  return m;
}

function box(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  mesh.position.set(x, y, z);
  return mesh;
}

// Brazo o pierna que gira desde el hombro o la cadera. "end" es la mano o el pie.
function limb(w, h, d, color, endColor, x, y, endForward = 0) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(box(w, h, d, color, 0, -h / 2, 0));
  pivot.add(box(w * 1.05, h * 0.2, d * 1.1, endColor, 0, -h + h * 0.08, endForward));
  return pivot;
}

function createPersonModel(look) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // se balancea al caminar
  root.add(body);

  body.add(box(0.5, 0.62, 0.28, look.shirt, 0, 1.2, 0)); // torso
  body.add(box(0.46, 0.14, 0.26, look.pants, 0, 0.86, 0)); // cadera
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), material(look.skin));
  head.position.set(0, 1.7, 0);
  body.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 7, 4, 0, Math.PI * 2, 0, look.longHair ? Math.PI * 0.62 : Math.PI * 0.45),
    material(look.hair),
  );
  hair.position.set(0, 1.72, -0.01);
  body.add(hair);

  const armL = limb(0.13, 0.58, 0.14, look.shirt, look.skin, -0.32, 1.48);
  const armR = limb(0.13, 0.58, 0.14, look.shirt, look.skin, 0.32, 1.48);
  const legL = limb(0.18, 0.84, 0.2, look.pants, '#2a2018', -0.12, 0.84, 0.04);
  const legR = limb(0.18, 0.84, 0.2, look.pants, '#2a2018', 0.12, 0.84, 0.04);
  body.add(armL, armR);
  root.add(legL, legR);

  root.scale.setScalar(look.height);
  root.userData = { body, armL, armR, legL, legR };
  return root;
}

// ---------------------------------------------------------------------------
// Sistema
// ---------------------------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class ColonySystem {
  constructor({ scene, camera, canvas, labelsRoot }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.labelsRoot = labelsRoot;
    this.group = new THREE.Group();
    this.group.name = 'colonists';
    scene.add(this.group);
    this.colonists = [];
    this.selected = null;
    this.camp = null;
    this.campTemperature = 0.5;
    this.obstacles = campObstacles();
    this.onSelect = null; // lo asigna la interfaz
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 24),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.06;
    this.selectionRing.visible = false;
    this.heights = new Map();
    this.tmp = {
      local: new THREE.Vector3(),
      world: new THREE.Vector3(),
      yaw: new THREE.Quaternion(),
      proj: new THREE.Vector3(),
    };
  }

  get count() {
    return this.colonists.length;
  }

  // Llamar en cada fotograma con el campamento actual (o null si no hay).
  // Por ahora sólo pasean. Adónde van lo decidirán sus necesidades (paso 2 y 3): por
  // ejemplo, con frío buscarán una fuente de calor como la fogata.
  // env: { timeScale, isNight, timeLabel() } — timeLabel da la hora para el registro.
  update(delta, camp, { timeScale = 1, isNight = false, timeLabel = () => '' } = {}) {
    if (camp !== this.camp) this.setCamp(camp);
    if (!this.camp) return;

    // Necesidades: corren con el tiempo de juego completo (también a ×60).
    const gameDt = delta * timeScale;
    if (gameDt > 0) {
      const ambient = Math.min(1, Math.max(0, (this.campTemperature - (isNight ? 0.3 : 0) - 0.12) * 1.6));
      const time = timeLabel();
      for (const c of this.colonists) {
        const companion = this.nearestColonist(c, COMPANY_RADIUS);
        c.companion = companion;
        c.nearFire = Math.hypot(c.x, c.z) < FIRE_WARMTH_RADIUS;
        updateNeeds(c, { dt: gameDt, ambient, nearFire: c.nearFire, companion, walking: c.state === 'walk', time });
      }
    }

    // La simulación sigue la velocidad del tiempo (pausa = quietos), en pasos cortos.
    let simTime = delta * Math.min(timeScale, 8);
    while (simTime > 1e-4) {
      const dt = Math.min(MAX_STEP, simTime);
      simTime -= dt;
      for (const c of this.colonists) this.step(c, dt);
    }
    for (const c of this.colonists) this.place(c, delta * Math.min(timeScale, 8));
    this.updateLabels();
  }

  // ---- Campamento -------------------------------------------------------

  setCamp(camp) {
    for (const c of this.colonists) {
      this.group.remove(c.object);
      c.label.remove();
    }
    this.colonists = [];
    this.select(null);
    this.heights.clear();
    this.camp = camp;
    if (!camp) return;
    this.campTemperature = temperature(camp.dir.x, camp.dir.y, camp.dir.z, elevation(camp.dir.x, camp.dir.y, camp.dir.z));

    // Colonos siempre iguales para un mismo campamento (misma semilla).
    const rand = seededRandom((camp.seed ?? 1) ^ 0x5bd1e995);
    const names = [...NAMES];
    for (let i = 0; i < START_COLONISTS; i++) {
      const name = names.splice(Math.floor(rand() * names.length), 1)[0];
      const profile = createProfile(rand);
      // Piel, pelo y estatura vienen de los genes; la ropa es elección personal.
      const body = appearanceFromGenes(profile.genome, profile.age);
      const look = {
        skin: body.skin,
        hair: body.hair,
        shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
        pants: PANTS[Math.floor(rand() * PANTS.length)],
        longHair: rand() < 0.5,
        height: body.height, // un poco más grandes que la realidad, para verlos mejor
      };
      const object = createPersonModel(look);
      this.group.add(object);
      // Aparecen alrededor de la fogata.
      const a = (i / START_COLONISTS) * Math.PI * 2 + rand() * 0.5;
      const spot = this.freeSpot(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
      // Etiqueta sobre la cabeza: nombre y barra de salud. Se puede hacer clic en ella.
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'colonist-label';
      label.innerHTML = `<span class="colonist-label-name"></span><span class="colonist-label-hp"><i></i></span>`;
      label.querySelector('.colonist-label-name').textContent = name;
      label.hidden = true;
      this.labelsRoot.appendChild(label);
      const colonist = {
        id: i,
        name,
        ...profile,
        look,
        object,
        label,
        x: spot.x,
        z: spot.z,
        facing: Math.atan2(-spot.x, -spot.z),
        state: 'idle',
        timer: 1 + rand() * 4,
        target: null,
        phase: rand() * 10,
        moving: 0, // 0 quieto, 1 caminando (suavizado para la animación)
        stuckTimer: 0,
        lastProgress: 0,
        rand: seededRandom(Math.floor(rand() * 4294967296)),
        activity: 'Descansando un momento',
      };
      label.addEventListener('click', () => this.select(colonist));
      addLog(colonist, 'Día 1', 'Llegó al campamento');
      this.colonists.push(colonist);
    }
  }

  // ---- Selección ---------------------------------------------------------

  select(c) {
    if (this.selected === c) return;
    if (this.selected) this.selected.label.classList.remove('is-selected');
    this.selected = c;
    if (c) {
      c.label.classList.add('is-selected');
      c.object.add(this.selectionRing);
      this.selectionRing.visible = true;
    } else {
      this.selectionRing.removeFromParent();
      this.selectionRing.visible = false;
    }
    this.onSelect?.(c);
  }

  // Colono bajo un punto de la pantalla (en píxeles del lienzo), o null.
  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.tmp.proj;
    let best = null;
    let bestDist = Infinity;
    for (const c of this.colonists) {
      // Centro del cuerpo, a ~1 m del suelo.
      p.copy(c.object.position);
      p.add(this.tmp.local.copy(p).normalize().multiplyScalar(1.0 * c.look.height));
      const dist3 = this.camera.position.distanceTo(p);
      p.project(this.camera);
      if (p.z > 1) continue;
      const x = rect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - p.y) / 2) * rect.height;
      // Tamaño en pantalla de ~1 m a esa distancia.
      const pxPerMeter = rect.height / (2 * dist3 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
      const radius = Math.max(PICK_RADIUS_PX, pxPerMeter * 1.2);
      const d = Math.hypot(clientX - x, clientY - y);
      if (d < radius && d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  // Dirección en el planeta donde está un colono (para centrar la cámara).
  directionOf(c, out = new THREE.Vector3()) {
    return this.toDirection(c.x, c.z, out);
  }

  nearestColonist(c, radius) {
    let best = null;
    let bestD = radius;
    for (const o of this.colonists) {
      if (o === c) continue;
      const d = Math.hypot(o.x - c.x, o.z - c.z);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  // Bienestar medio de la colonia y media de cada necesidad.
  summary() {
    const n = this.colonists.length;
    if (!n) return null;
    const avg = { food: 0, water: 0, rest: 0, warmth: 0, mood: 0, health: 0, wellbeing: 0 };
    for (const c of this.colonists) {
      for (const k of ['food', 'water', 'rest', 'warmth', 'mood']) avg[k] += c.needs[k] / n;
      avg.health += c.health / n;
      avg.wellbeing += wellbeing(c) / n;
    }
    return avg;
  }

  // ---- Terreno ----------------------------------------------------------

  // Local (x, z) del campamento -> dirección unitaria en el planeta.
  toDirection(x, z, out) {
    const { object } = this.camp;
    out.set(x, 0, z).applyQuaternion(object.quaternion).add(object.position);
    return out.normalize();
  }

  // Altura del terreno con caché en rejilla e interpolación bilineal.
  heightAt(x, z) {
    const gx = x / HEIGHT_CELL;
    const gz = z / HEIGHT_CELL;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = this.gridHeight(ix, iz);
    const h10 = this.gridHeight(ix + 1, iz);
    const h01 = this.gridHeight(ix, iz + 1);
    const h11 = this.gridHeight(ix + 1, iz + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  gridHeight(ix, iz) {
    const key = ix * 100_003 + iz;
    let h = this.heights.get(key);
    if (h === undefined) {
      h = surfaceHeight(this.toDirection(ix * HEIGHT_CELL, iz * HEIGHT_CELL, this.tmp.world));
      if (this.heights.size > 40_000) this.heights.clear();
      this.heights.set(key, h);
    }
    return h;
  }

  // ¿Se puede estar ahí? (tierra firme, sin mucha pendiente, fuera de obstáculos)
  walkable(x, z, margin = COLONIST_RADIUS) {
    for (const o of this.obstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < (o.r + margin) ** 2) return false;
    }
    const h = this.heightAt(x, z);
    if (h <= 0.6) return false; // agua
    const slope = Math.max(Math.abs(this.heightAt(x + 2, z) - h), Math.abs(this.heightAt(x, z + 2) - h)) / 2;
    return slope < 0.55;
  }

  freeSpot(x, z) {
    for (let r = 0; r < 12; r += 0.75) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (this.walkable(px, pz, COLONIST_RADIUS + 0.3)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  // Un destino al azar para pasear: tierra firme y con camino recto sin agua.
  pickTarget(c) {
    const [minR, baseMax] = WANDER;
    const maxR = baseMax * (hasTrait(c, 'curious') ? 1.6 : hasTrait(c, 'homebody') ? 0.45 : 1);
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = c.rand() * Math.PI * 2;
      const r = minR + Math.sqrt(c.rand()) * (maxR - minR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.walkable(x, z, COLONIST_RADIUS + 0.6)) continue;
      const len = Math.hypot(x - c.x, z - c.z);
      let ok = true;
      for (let s = 4; s < len && ok; s += 4) {
        const t = s / len;
        const h = this.heightAt(c.x + (x - c.x) * t, c.z + (z - c.z) * t);
        if (h <= 0.6) ok = false;
      }
      if (ok) return { x, z };
    }
    return null;
  }

  // ---- Comportamiento ---------------------------------------------------

  step(c, dt) {
    if (c.state === 'idle') {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.target = this.pickTarget(c);
        if (c.target) {
          c.state = 'walk';
          c.stuckTimer = 0;
          c.lastProgress = Math.hypot(c.target.x - c.x, c.target.z - c.z);
        } else {
          c.timer = 2;
        }
      }
      return;
    }

    // Caminar hacia el destino esquivando obstáculos y a los demás colonos.
    const tx = c.target.x - c.x;
    const tz = c.target.z - c.z;
    const dist = Math.hypot(tx, tz);
    if (dist < 0.6) {
      c.state = 'idle';
      c.timer = 2 + c.rand() * 7;
      c.target = null;
      return;
    }
    let dx = tx / dist;
    let dz = tz / dist;
    const steer = (ox, oz, r, strength) => {
      const px = c.x - ox;
      const pz = c.z - oz;
      const d = Math.hypot(px, pz) || 1e-3;
      const reach = r + COLONIST_RADIUS + 1.8;
      if (d > reach) return;
      // Sólo si el obstáculo está por delante: empujar hacia un costado para rodearlo.
      if (px * dx + pz * dz > 0.3 * d) return;
      const w = ((reach - d) / reach) * strength;
      const side = px * dz - pz * dx >= 0 ? 1 : -1;
      const odx = dx;
      const odz = dz;
      dx += (px / d) * w * 0.6 + odz * side * w;
      dz += (pz / d) * w * 0.6 - odx * side * w;
    };
    for (const o of this.obstacles) steer(o.x, o.z, o.r, 1.6);
    for (const other of this.colonists) {
      if (other !== c) steer(other.x, other.z, COLONIST_RADIUS, 1.2);
    }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;

    const speed = WALK_SPEED * (0.85 + gene(c.genome, 'agility') * 0.3);
    let nx = c.x + dx * speed * dt;
    let nz = c.z + dz * speed * dt;
    // Nunca dentro de un obstáculo: se empuja hasta su borde.
    for (const o of this.obstacles) {
      const px = nx - o.x;
      const pz = nz - o.z;
      const d = Math.hypot(px, pz);
      const min = o.r + COLONIST_RADIUS;
      if (d < min && d > 1e-4) {
        nx = o.x + (px / d) * min;
        nz = o.z + (pz / d) * min;
      }
    }
    if (this.heightAt(nx, nz) > 0.6) {
      c.x = nx;
      c.z = nz;
    }
    // Girar hacia donde camina, con suavidad.
    const want = Math.atan2(dx, dz);
    let diff = want - c.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.facing += diff * Math.min(1, dt * 8);

    // Si no avanza (atascado), elige otro destino.
    c.stuckTimer += dt;
    if (c.stuckTimer > 3) {
      if (c.lastProgress - dist < 1) {
        c.state = 'idle';
        c.timer = 0.5;
      }
      c.lastProgress = dist;
      c.stuckTimer = 0;
    }
  }

  // Coloca el modelo en el mundo y anima brazos y piernas.
  activityOf(c) {
    if (c.state === 'walk') return 'Paseando';
    if (c.nearFire && c.needs.warmth < 95) return 'Calentándose junto al fuego';
    if (c.companion) return `Charlando con ${c.companion.name}`;
    return 'Descansando un momento';
  }

  place(c, animDelta) {
    c.activity = this.activityOf(c);
    const { world, yaw } = this.tmp;
    const walking = c.state === 'walk' ? 1 : 0;
    c.moving += (walking - c.moving) * Math.min(1, animDelta * 6);
    c.phase += animDelta * WALK_SPEED * 5.2 * c.moving;

    const h = this.heightAt(c.x, c.z);
    this.toDirection(c.x, c.z, world);
    c.object.position.copy(world).multiplyScalar(RADIUS + h);
    // Orientación: la del campamento (su "arriba" es el del planeta allí) y el rumbo.
    c.object.quaternion.copy(this.camp.object.quaternion).multiply(yaw.setFromAxisAngle(Y_AXIS, c.facing));

    const { body, armL, armR, legL, legR } = c.object.userData;
    const swing = Math.sin(c.phase) * 0.65 * c.moving;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;
    const breathe = Math.sin(performance.now() * 0.0018 + c.phase) * 0.01 * (1 - c.moving);
    body.position.y = Math.abs(Math.cos(c.phase)) * 0.05 * c.moving + breathe;
  }

  // Nombres sobre la cabeza cuando la cámara está cerca.
  updateLabels() {
    const cam = this.camera;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.tmp.proj;
    for (const c of this.colonists) {
      // Un poco por encima de la cabeza.
      p.copy(c.object.position);
      p.add(this.tmp.local.copy(p).normalize().multiplyScalar(2.3 * c.look.height));
      const dist = cam.position.distanceTo(p);
      p.project(cam);
      const visible = dist < LABEL_DISTANCE && p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      c.label.hidden = !visible;
      if (visible) {
        const hp = c.label.lastChild.firstChild;
        const width = `${Math.round(c.health)}%`;
        if (hp.style.width !== width) hp.style.width = width;
        c.label.classList.toggle('is-hurt', c.health < 50);
        const x = rect.left + ((p.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - p.y) / 2) * rect.height;
        c.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        c.label.style.opacity = String(Math.min(1, (LABEL_DISTANCE - dist) / 40));
      }
    }
  }
}
