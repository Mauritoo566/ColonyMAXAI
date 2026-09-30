import * as THREE from 'three';
import { RADIUS } from './elevation.js';
import { Parts, mat, stick, v } from './modelKit.js';
import { CLOTHES_SPOT, TOTEM_SPOT } from './sim/colony.js';

// Vista de los colonos: dibuja a los de la simulación (sim/colony.js) con su modelo low
// poly, los anima al caminar y trabajar, pone su nombre encima y permite elegirlos con
// un clic. También dibuja la pila de ropa y el tótem de la tribu. No decide nada: todo
// lo que hacen sale de la simulación.

const WALK_SPEED = 1.4; // m/s (para el ritmo de las piernas)
const LABEL_DISTANCE = 170; // metros: más lejos no se muestra el nombre
const PICK_RADIUS_PX = 26; // tolerancia al hacer clic sobre un colono
const LOINCLOTH = '#6b4a2e'; // lo único que llevan al llegar
const Y_AXIS = new THREE.Vector3(0, 1, 0);

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

  const torso = box(0.5, 0.62, 0.28, look.shirt, 0, 1.2, 0);
  const hip = box(0.46, 0.14, 0.26, look.pants, 0, 0.86, 0);
  body.add(torso, hip);
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
  root.userData = { body, armL, armR, legL, legR, torso, hip };
  return root;
}

// Viste o desviste el modelo: sin ropa, torso, brazos y piernas del color de la piel y
// un taparrabos en la cadera.
function dressModel(object, look, clothed) {
  const { torso, hip, armL, armR, legL, legR } = object.userData;
  torso.material = material(clothed ? look.shirt : look.skin);
  hip.material = material(clothed ? look.pants : LOINCLOTH);
  for (const arm of [armL, armR]) arm.children[0].material = material(clothed ? look.shirt : look.skin);
  for (const leg of [legL, legR]) leg.children[0].material = material(clothed ? look.pants : look.skin);
}

// Pila de ropa de pieles doblada: una prenda por colono que aún no la recogió.
function clothesPileMesh(count) {
  const group = new THREE.Group();
  const colors = ['#a0764a', '#8a5a34', '#b8905a', '#7a5230', '#c2a06a'];
  for (let k = 0; k < count; k++) {
    const piece = box(0.8, 0.12, 0.6, colors[k % colors.length], ((k % 2) - 0.5) * 0.08, 0.08 + k * 0.13, ((k % 3) - 1) * 0.05);
    piece.rotation.y = (k * 0.7) % 0.6;
    group.add(piece);
  }
  // Una piel extendida debajo, como alfombra.
  const hide = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.03, 7), material('#6b4a2e'));
  hide.scale.set(1.3, 1, 1);
  hide.position.y = 0.015;
  group.add(hide);
  return group;
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

export class ColonyView {
  // campObject(): el modelo del campamento en la escena (camp.js), o null.
  // selectable: si se puede elegir un colono (los de otros jugadores sólo se miran).
  constructor({ scene, camera, canvas, labelsRoot, sim, campObject, selectable = true }) {
    this.selectable = selectable;
    this.camera = camera;
    this.canvas = canvas;
    this.labelsRoot = labelsRoot;
    this.sim = sim;
    this.campObject = campObject;
    this.group = new THREE.Group();
    this.group.name = 'colonists';
    scene.add(this.group);
    this.entries = new Map(); // id del colono -> { c, object, label, moving, phase, workPhase, clothed }
    this.selected = null;
    this.onSelect = null; // lo asigna la interfaz
    this.clothesPile = null;
    this.totem = null;
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 24),
      new THREE.MeshBasicMaterial({ color: '#f2b24c', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.06;
    this.selectionRing.visible = false;
    this.tmp = {
      local: new THREE.Vector3(),
      world: new THREE.Vector3(),
      yaw: new THREE.Quaternion(),
      proj: new THREE.Vector3(),
    };
    sim.on('camp', () => this.rebuild());
    sim.on('clothes', () => this.refreshClothes());
    sim.on('age', () => this.refreshTotem());
  }

  // Los colonos de la simulación cambiaron (campamento nuevo): se rehacen los modelos.
  rebuild() {
    for (const e of this.entries.values()) {
      this.group.remove(e.object);
      e.label.remove();
    }
    this.entries.clear();
    this.select(null);
    for (const c of this.sim.colonists) {
      const object = createPersonModel(c.look);
      dressModel(object, c.look, c.clothed);
      this.group.add(object);
      // Etiqueta sobre la cabeza: nombre y barra de salud. Se puede hacer clic en ella.
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'colonist-label';
      label.innerHTML = `<span class="colonist-label-name"></span><span class="colonist-label-hp"><i></i></span>`;
      label.querySelector('.colonist-label-name').textContent = c.name;
      label.hidden = true;
      if (this.selectable) label.addEventListener('click', () => this.select(c));
      else label.classList.add('colonist-label--other');
      this.labelsRoot.appendChild(label);
      // x, z, facing: dónde se dibuja; sigue con suavidad a la simulación (que por la red
      // llega a saltos, varias veces por segundo).
      this.entries.set(c.id, { c, object, label, moving: 0, phase: c.phase ?? 0, workPhase: 0, clothed: c.clothed, x: c.x, z: c.z, facing: c.facing });
    }
    this.refreshClothes();
    this.refreshTotem();
  }

  // Ropa: la de cada colono y la pila que queda en el suelo.
  refreshClothes() {
    for (const e of this.entries.values()) {
      if (e.clothed !== e.c.clothed) {
        e.clothed = e.c.clothed;
        dressModel(e.object, e.c.look, e.clothed);
      }
    }
    if (this.clothesPile) {
      this.clothesPile.removeFromParent();
      this.clothesPile.traverse((o) => o.geometry?.dispose());
      this.clothesPile = null;
    }
    const n = this.sim.clothesLeft;
    if (!this.sim.camp || n <= 0) return;
    this.clothesPile = clothesPileMesh(n);
    const { x, z } = CLOTHES_SPOT;
    this.clothesPile.position.set(x, this.sim.heightAt(x, z) - this.sim.camp.height, z);
  }

  refreshTotem() {
    const want = this.sim.age >= 2 && this.sim.camp;
    if (this.totem && !want) {
      this.totem.removeFromParent();
      this.totem.geometry.dispose();
      this.totem = null;
    }
    if (want && !this.totem) {
      this.totem = totemMesh();
      this.totem.position.set(TOTEM_SPOT.x, this.sim.heightAt(TOTEM_SPOT.x, TOTEM_SPOT.z) - this.sim.camp.height - 0.1, TOTEM_SPOT.z);
    }
  }

  // ---- Selección ---------------------------------------------------------

  select(c) {
    if (this.selected === c) return;
    if (this.selected) this.entries.get(this.selected.id)?.label.classList.remove('is-selected');
    this.selected = c;
    const e = c && this.entries.get(c.id);
    if (e) {
      e.label.classList.add('is-selected');
      e.object.add(this.selectionRing);
      this.selectionRing.visible = true;
    } else {
      this.selectionRing.removeFromParent();
      this.selectionRing.visible = false;
    }
    this.onSelect?.(c);
  }

  // Colono bajo un punto de la pantalla (en píxeles del lienzo), o null.
  pickAt(clientX, clientY) {
    if (!this.selectable) return null;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.tmp.proj;
    let best = null;
    let bestDist = Infinity;
    for (const { c, object } of this.entries.values()) {
      // Centro del cuerpo, a ~1 m del suelo.
      p.copy(object.position);
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
    const e = this.entries.get(c.id);
    return e ? this.sim.toDirection(e.x, e.z, out) : this.sim.directionOf(c, out);
  }

  // Posición del modelo de un colono en la escena.
  positionOf(c) {
    return this.entries.get(c.id)?.object.position ?? null;
  }

  // ---- Cada fotograma --------------------------------------------------------

  // animDelta: segundos para la animación (sigue la velocidad del tiempo, con tope);
  // delta: segundos reales (para seguir a la simulación con suavidad).
  update(animDelta, delta = animDelta) {
    const sim = this.sim;
    this.group.visible = !!sim.camp;
    if (!sim.camp) return;
    if (this.entries.size !== sim.colonists.length) this.rebuild();
    // La pila de ropa y el tótem van dentro del modelo del campamento.
    const campObject = this.campObject();
    for (const prop of [this.clothesPile, this.totem]) {
      if (prop && campObject && prop.parent !== campObject) campObject.add(prop);
    }
    const follow = 1 - Math.exp(-delta * 10);
    for (const e of this.entries.values()) {
      const { c } = e;
      // Un salto grande (reconectar, volver a la pestaña) no se anima: se pone ahí.
      if (Math.hypot(c.x - e.x, c.z - e.z) > 8) {
        e.x = c.x;
        e.z = c.z;
        e.facing = c.facing;
      } else {
        e.x += (c.x - e.x) * follow;
        e.z += (c.z - e.z) * follow;
        e.facing += Math.atan2(Math.sin(c.facing - e.facing), Math.cos(c.facing - e.facing)) * follow;
      }
      this.place(e, animDelta);
    }
    this.updateLabels();
  }

  place(e, animDelta) {
    const { c, object } = e;
    // Durmiendo está dentro de la tienda: no se ve.
    object.visible = !c.sleeping;
    const { world, yaw } = this.tmp;
    const walking = c.walking ? 1 : 0;
    e.moving += (walking - e.moving) * Math.min(1, animDelta * 6);
    e.phase += animDelta * WALK_SPEED * 5.2 * e.moving;

    const h = this.sim.heightAt(e.x, e.z);
    this.sim.toDirection(e.x, e.z, world);
    object.position.copy(world).multiplyScalar(RADIUS + h);
    // Orientación: la del campamento (su "arriba" es el del planeta allí) y el rumbo.
    object.quaternion.copy(this.sim.camp.quaternion).multiply(yaw.setFromAxisAngle(Y_AXIS, e.facing));

    const { body, armL, armR, legL, legR } = object.userData;
    const swing = Math.sin(e.phase) * 0.65 * e.moving;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    if (c.working) {
      // Trabajando: los dos brazos golpean hacia delante (talar, picar, recoger).
      e.workPhase += animDelta * 7;
      const hit = -1.2 - Math.sin(e.workPhase) * 0.9;
      armL.rotation.x = hit;
      armR.rotation.x = hit;
    } else {
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
    }
    const breathe = Math.sin(performance.now() * 0.0018 + e.phase) * 0.01 * (1 - e.moving);
    body.position.y = Math.abs(Math.cos(e.phase)) * 0.05 * e.moving + breathe;
  }

  hideLabels() {
    for (const e of this.entries.values()) e.label.hidden = true;
  }

  // Quita todo de la escena y de la página (colonia de otro jugador que ya no se ve).
  dispose() {
    for (const e of this.entries.values()) e.label.remove();
    this.entries.clear();
    this.group.removeFromParent();
    this.clothesPile?.removeFromParent();
    this.totem?.removeFromParent();
  }

  // Nombres sobre la cabeza cuando la cámara está cerca.
  updateLabels() {
    const cam = this.camera;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.tmp.proj;
    for (const { c, object, label } of this.entries.values()) {
      // Un poco por encima de la cabeza.
      p.copy(object.position);
      p.add(this.tmp.local.copy(p).normalize().multiplyScalar(2.3 * c.look.height));
      const dist = cam.position.distanceTo(p);
      p.project(cam);
      const visible = !c.sleeping && dist < LABEL_DISTANCE && p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      label.hidden = !visible;
      if (visible) {
        const hp = label.lastChild.firstChild;
        const width = `${Math.round(c.health)}%`;
        if (hp.style.width !== width) hp.style.width = width;
        label.classList.toggle('is-hurt', c.health < 50);
        const x = rect.left + ((p.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - p.y) / 2) * rect.height;
        label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        label.style.opacity = String(Math.min(1, (LABEL_DISTANCE - dist) / 40));
      }
    }
  }
}

// Tótem de la tribu (llega con la Edad Tribal), junto a la fogata.
let totemMaterial = null;

function totemMesh() {
  const p = new Parts();
  const faces = ['#9a5a34', '#b8763e', '#8a4a2a'];
  for (let k = 0; k < 3; k++) {
    const y = 0.6 + k * 1.05;
    p.add(new THREE.CylinderGeometry(0.42, 0.46, 1.0, 8), faces[k], mat(0, y, 0));
    // Ojos, boca y pico pintados.
    p.add(new THREE.BoxGeometry(0.16, 0.12, 0.08), '#f0e2c0', mat(-0.16, y + 0.18, 0.42));
    p.add(new THREE.BoxGeometry(0.16, 0.12, 0.08), '#f0e2c0', mat(0.16, y + 0.18, 0.42));
    p.add(new THREE.BoxGeometry(0.34, 0.08, 0.08), k === 1 ? '#2f5d7a' : '#a8452d', mat(0, y - 0.2, 0.43));
    p.add(new THREE.ConeGeometry(0.1, 0.3, 4), '#e0c25a', mat(0, y, 0.52, Math.PI / 2, 0, 0));
  }
  // Alas y cabeza de pájaro arriba.
  p.add(new THREE.BoxGeometry(2.2, 0.14, 0.4), '#a8452d', mat(0, 3.1, 0, 0, 0, 0));
  p.add(new THREE.BoxGeometry(0.7, 0.14, 0.38), '#2f5d7a', mat(-1.05, 3.2, 0, 0, 0, 0.35));
  p.add(new THREE.BoxGeometry(0.7, 0.14, 0.38), '#2f5d7a', mat(1.05, 3.2, 0, 0, 0, -0.35));
  p.add(new THREE.DodecahedronGeometry(0.36, 0), '#e0c25a', mat(0, 3.5, 0.05));
  p.add(new THREE.ConeGeometry(0.12, 0.4, 4), '#d08a2a', mat(0, 3.45, 0.45, Math.PI / 2, 0, 0));
  // Piedras en la base y plumas colgando.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    p.add(new THREE.DodecahedronGeometry(0.22, 0), '#8f8a82', mat(Math.cos(a) * 0.62, 0.12, Math.sin(a) * 0.62, a, a, 0));
  }
  stick(p, v(-0.9, 3.05, 0.1), v(-0.95, 2.5, 0.12), 0.03, '#f0e2c0', 3);
  stick(p, v(0.9, 3.05, 0.1), v(0.95, 2.5, 0.12), 0.03, '#f0e2c0', 3);
  totemMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const mesh = p.mesh(totemMaterial);
  mesh.rotation.y = -4.6 + Math.PI / 2; // la cara mira a la fogata
  return mesh;
}
