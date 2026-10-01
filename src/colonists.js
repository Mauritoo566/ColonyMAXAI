import * as THREE from 'three';
import { RADIUS } from './elevation.js';
import { Parts, mat, stick, v } from './modelKit.js';
import { CLOTHES_SPOT, TOTEM_SPOT } from './sim/colony.js';
import { appearanceFromGenes } from './genes.js';
import { CenterView } from './center.js';
import { outfitFor } from './outfits.js';

// Vista de los colonos: dibuja a los de la simulación (sim/colony.js) con su modelo low
// poly, los anima al caminar y trabajar, pone su nombre encima y permite elegirlos con
// un clic. También dibuja la pila de ropa y el tótem de la tribu. No decide nada: todo
// lo que hacen sale de la simulación.

const WALK_SPEED = 1.4; // m/s (para el ritmo de las piernas)
const LABEL_DISTANCE = 170; // metros: más lejos no se muestra ni el aviso de problema
const LABEL_NEAR = 50; // metros: el nombre de un colono sano sólo se ve así de cerca
const LABEL_MAX = 10; // etiquetas a la vez (además del elegido)
const FAR_DISTANCE = 90; // metros: más lejos se dibuja la versión simple del colono
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

// Corazones que suben sobre la casa cuando dos colonos están juntos dentro.
let heartTexture = null;
function heartMaterial() {
  if (!heartTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d');
    g.fillStyle = '#e8466b';
    g.beginPath();
    g.moveTo(32, 58);
    g.bezierCurveTo(2, 36, 6, 8, 24, 8);
    g.bezierCurveTo(29, 8, 31, 12, 32, 16);
    g.bezierCurveTo(33, 12, 35, 8, 40, 8);
    g.bezierCurveTo(58, 8, 62, 36, 32, 58);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.beginPath();
    g.ellipse(21, 20, 6, 4, -0.7, 0, Math.PI * 2);
    g.fill();
    heartTexture = new THREE.CanvasTexture(canvas);
    heartTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.SpriteMaterial({ map: heartTexture, transparent: true, depthWrite: false });
}

// Escala del cuerpo: los niños son más bajos y de cabeza grande; la constitución (gen)
// ensancha a los adultos. La estatura (gen) ya viene en look.height.
const childScale = (growth) => 0.42 + 0.58 * Math.min(1, Math.max(0, growth));

function applyBody(object, look, build, growth) {
  const s = look.height * childScale(growth);
  const w = build * (1 + (1 - Math.min(1, growth)) * 0.1);
  object.scale.set(s * w, s, s * w);
  const headScale = 1 + (1 - Math.min(1, growth)) * 0.65;
  const { head, hair } = object.userData;
  head.scale.setScalar(headScale);
  hair.scale.setScalar(headScale);
  // Cabeza y pelo más grandes: se bajan para que sigan apoyados en los hombros.
  head.position.y = 1.7 - (headScale - 1) * 0.04;
  hair.position.y = 1.72 - (headScale - 1) * 0.04;
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

  const accessories = new THREE.Group(); // sombrero, delantal, capa...: cambian con la edad y el oficio
  body.add(accessories);
  // Versión de lejos (a más de FAR_DISTANCE m): dos cajas en lugar de unas veinte piezas.
  const proxy = new THREE.Group();
  proxy.add(box(0.5, 1.4, 0.3, look.shirt, 0, 0.9, 0), box(0.3, 0.3, 0.3, look.skin, 0, 1.7, 0));
  proxy.visible = false;
  root.add(proxy);
  root.userData = { body, armL, armR, legL, legR, torso, hip, head, hair, accessories, proxy, far: false };
  return root;
}

// Viste o desviste el modelo: sin ropa, torso, brazos y piernas del color de la piel y
// un taparrabos en la cadera.
// "outfit": la ropa que toca por edad y oficio (outfits.js); cada colono la tiñe un poco con su
// color propio para que no se vistan todos igual.
function mixHex(a, b, t) {
  const ca = new THREE.Color(a);
  return `#${ca.lerp(new THREE.Color(b), t).getHexString()}`;
}

function dressModel(object, look, clothed, outfit) {
  const { torso, hip, armL, armR, legL, legR, accessories } = object.userData;
  const shirt = outfit ? mixHex(outfit.shirt, look.shirt, 0.22) : look.shirt;
  const pants = outfit ? mixHex(outfit.pants, look.pants, 0.22) : look.pants;
  torso.material = material(clothed ? shirt : look.skin);
  object.userData.proxy.children[0].material = material(clothed ? shirt : look.skin);
  hip.material = material(clothed ? pants : LOINCLOTH);
  for (const arm of [armL, armR]) arm.children[0].material = material(clothed ? shirt : look.skin);
  for (const leg of [legL, legR]) leg.children[0].material = material(clothed ? pants : look.skin);
  // Prendas distintivas (sólo con ropa puesta).
  for (const child of [...accessories.children]) {
    accessories.remove(child);
    child.geometry.dispose();
  }
  if (!clothed || !outfit) return;
  if (outfit.hat) accessories.add(...hatMeshes(outfit.hat));
  if (outfit.apron) accessories.add(box(0.42, 0.5, 0.04, outfit.apron, 0, 1.1, 0.16));
  if (outfit.coat) {
    accessories.add(box(0.54, 0.7, 0.32, outfit.coat, 0, 1.05, 0));
    accessories.add(box(0.5, 0.45, 0.3, outfit.coat, 0, 0.7, 0));
  }
  if (outfit.cape) accessories.add(box(0.5, 0.75, 0.04, outfit.cape, 0, 1.05, -0.17));
  if (outfit.collar) accessories.add(box(0.36, 0.08, 0.3, outfit.collar, 0, 1.52, 0));
  if (outfit.weapon === 'spear') accessories.add(box(0.04, 1.9, 0.04, '#9a7446', 0.42, 0.95, 0.12));
  if (outfit.weapon === 'sword') accessories.add(box(0.05, 0.75, 0.03, '#c6ced6', 0.42, 0.85, 0.15));
  if (outfit.weapon === 'bow') accessories.add(box(0.04, 0.9, 0.06, '#8a5a34', 0.42, 1.0, 0.12));
  if (outfit.weapon === 'rifle') accessories.add(box(0.06, 0.06, 0.95, '#3a3a40', 0.38, 1.0, 0.3));
}

// Sombreros y cascos sobre la cabeza (centro en y = 1,7).
function hatMeshes(hat) {
  const c = hat.color;
  const mk = (geometry, x, y, z) => {
    const m = new THREE.Mesh(geometry, material(c));
    m.position.set(x, y, z);
    return m;
  };
  switch (hat.kind) {
    case 'band':
      return [mk(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 8), 0, 1.78, 0)];
    case 'cap':
      return [mk(new THREE.SphereGeometry(0.19, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.74, 0)];
    case 'helmet':
      return [mk(new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.74, 0), mk(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 8), 0, 1.74, 0)];
    case 'straw':
      return [mk(new THREE.ConeGeometry(0.36, 0.22, 8), 0, 1.9, 0)];
    case 'hood':
      return [mk(new THREE.SphereGeometry(0.21, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.62), 0, 1.72, -0.01)];
    case 'feather': {
      const cap = mk(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 8), 0, 1.82, 0);
      const feather = mk(new THREE.BoxGeometry(0.04, 0.3, 0.04), 0.16, 1.95, 0);
      feather.rotation.z = -0.5;
      feather.material = material('#c8423a');
      return [cap, feather];
    }
    case 'flat':
      return [mk(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 8), 0, 1.84, 0)];
    default:
      return [];
  }
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
    this.center = new CenterView(sim);
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
    sim.on('age', () => {
      this.refreshTotem();
      this.center.refresh();
    });
    sim.on('buildings', () => this.center.refresh());
  }

  // Los colonos de la simulación cambiaron (campamento nuevo): se rehacen los modelos.
  rebuild() {
    for (const e of this.entries.values()) {
      this.group.remove(e.object);
      for (const h of e.hearts) {
        this.group.remove(h);
        h.material.dispose();
      }
      e.label.remove();
    }
    this.entries.clear();
    this.select(null);
    for (const c of this.sim.colonists) {
      const object = createPersonModel(c.look);
      const build = appearanceFromGenes(c.genome, c.age).build;
      applyBody(object, c.look, build, c.growth ?? 1);
      const outfit = outfitFor(this.sim.age, c);
      dressModel(object, c.look, c.clothed, outfit);
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
      this.entries.set(c.id, { c, object, label, moving: 0, phase: c.phase ?? 0, workPhase: 0, clothed: c.clothed, outfitKey: outfit.key, build, growth: c.growth ?? 1, hearts: [], heartTimer: 0, x: c.x, z: c.z, facing: c.facing });
    }
    this.refreshClothes();
    this.refreshTotem();
    this.center.refresh();
  }

  // Ropa: la de cada colono y la pila que queda en el suelo.
  refreshClothes() {
    for (const e of this.entries.values()) {
      if (e.clothed !== e.c.clothed) {
        e.clothed = e.c.clothed;
        const outfit = outfitFor(this.sim.age, e.c);
        e.outfitKey = outfit.key;
        dressModel(e.object, e.c.look, e.clothed, outfit);
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
      p.add(this.tmp.local.copy(p).normalize().multiplyScalar(1.0 * c.look.height * childScale(c.growth ?? 1)));
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
    for (const prop of [this.clothesPile, this.totem, this.center.group]) {
      if (prop && campObject && prop.parent !== campObject) campObject.add(prop);
    }
    // Los tipis iniciales sólo se ven mientras alguien duerme en ellos o en las primeras edades.
    if (campObject?.userData.tipis) campObject.userData.tipis.visible = sim.age <= 2 || sim.colonists.some((o) => (o.growth ?? 1) >= 1 && o.home == null);
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
    // Durmiendo o en casa: está dentro y no se ve.
    object.visible = !c.sleeping && !c.inside;
    // La ropa cambia sola con la edad de la aldea y con el oficio del colono.
    const outfit = outfitFor(this.sim.age, c);
    if (outfit.key !== e.outfitKey) {
      e.outfitKey = outfit.key;
      dressModel(object, c.look, c.clothed, outfit);
    }
    const growth = c.growth ?? 1;
    if (Math.abs(growth - e.growth) > 0.004 || (growth >= 1 && e.growth < 1)) {
      e.growth = growth;
      applyBody(object, c.look, e.build, growth);
    }
    const { world, yaw } = this.tmp;
    const walking = c.walking ? 1 : 0;
    e.moving += (walking - e.moving) * Math.min(1, animDelta * 6);
    e.phase += animDelta * WALK_SPEED * 5.2 * e.moving;

    const h = this.sim.heightAt(e.x, e.z);
    this.sim.toDirection(e.x, e.z, world);
    object.position.copy(world).multiplyScalar(RADIUS + h);
    // Orientación: la del campamento (su "arriba" es el del planeta allí) y el rumbo.
    object.quaternion.copy(this.sim.camp.quaternion).multiply(yaw.setFromAxisAngle(Y_AXIS, e.facing));

    const ud = object.userData;
    // De lejos se dibuja una versión simple y no se anima (con aldeas grandes ahorra miles de piezas).
    const far = this.camera.position.distanceToSquared(object.position) > FAR_DISTANCE * FAR_DISTANCE;
    if (far !== ud.far) {
      ud.far = far;
      ud.body.visible = !far;
      ud.legL.visible = !far;
      ud.legR.visible = !far;
      ud.proxy.visible = far;
    }
    if (far) return;
    const { body, armL, armR, legL, legR } = ud;
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
    this.updateHearts(e, animDelta);
    const breathe = Math.sin(performance.now() * 0.0018 + e.phase) * 0.01 * (1 - e.moving);
    body.position.y = Math.abs(Math.cos(e.phase)) * 0.05 * e.moving + breathe;
  }

  // Corazones sobre la casa mientras están juntos (la posición es la de la casa).
  updateHearts(e, animDelta) {
    const { c, object } = e;
    if (c.loving) {
      e.heartTimer -= animDelta;
      if (e.heartTimer <= 0 && e.hearts.length < 8) {
        e.heartTimer = 0.55;
        const sprite = new THREE.Sprite(heartMaterial());
        sprite.userData = { age: 0, sway: Math.random() * 6.28 };
        sprite.scale.setScalar(0.7);
        this.group.add(sprite);
        e.hearts.push(sprite);
      }
    }
    for (let k = e.hearts.length - 1; k >= 0; k--) {
      const heart = e.hearts[k];
      heart.userData.age += animDelta;
      const t = heart.userData.age / 2.6;
      if (t >= 1) {
        this.group.remove(heart);
        heart.material.dispose();
        e.hearts.splice(k, 1);
        continue;
      }
      const up = this.tmp.local.copy(object.position).normalize();
      heart.position.copy(object.position).addScaledVector(up, 4.2 + t * 2.4);
      heart.position.x += Math.sin(heart.userData.sway + t * 5) * 0.25;
      heart.material.opacity = t < 0.8 ? 1 : (1 - t) / 0.2;
      heart.scale.setScalar(0.5 + Math.min(t * 3, 1) * 0.35);
    }
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
    this.center.clear();
    this.center.group.removeFromParent();
  }

  // Nombres sobre la cabeza con jerarquía: el elegido siempre; luego quienes tienen un problema
  // (salud o una necesidad muy baja); luego los que están muy cerca de la cámara. Con muchos
  // colonos a la vista sólo se muestran los más importantes (LABEL_MAX).
  updateLabels() {
    const cam = this.camera;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.tmp.proj;
    const shown = [];
    for (const e of this.entries.values()) {
      const { c, object, label } = e;
      label.hidden = true;
      if (c.sleeping || c.inside) continue;
      // Un poco por encima de la cabeza.
      p.copy(object.position);
      p.add(this.tmp.local.copy(p).normalize().multiplyScalar(2.3 * c.look.height * childScale(c.growth ?? 1)));
      const dist = cam.position.distanceTo(p);
      const selected = this.selected === c;
      const alert = c.health < 35 || Math.min(c.needs.food, c.needs.water, c.needs.rest, c.needs.warmth) < 15;
      const rank = selected ? 3 : alert && dist < LABEL_DISTANCE ? 2 : dist < LABEL_NEAR ? 1 : 0;
      if (!rank) continue;
      p.project(cam);
      if (p.z >= 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) continue;
      shown.push({ e, rank, dist, x: p.x, y: p.y, selected, alert });
    }
    shown.sort((a, b) => b.rank - a.rank || a.dist - b.dist);
    for (const [i, s] of shown.entries()) {
      if (i >= LABEL_MAX && !s.selected) break;
      const { c, label } = s.e;
      label.hidden = false;
      const hp = label.lastChild.firstChild;
      const width = `${Math.round(c.health)}%`;
      if (hp.style.width !== width) hp.style.width = width;
      label.classList.toggle('is-hurt', c.health < 50);
      label.classList.toggle('is-alert', s.alert);
      label.classList.toggle('is-minor', !s.selected && !s.alert);
      const x = rect.left + ((s.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - s.y) / 2) * rect.height;
      label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      label.style.opacity = s.selected || s.alert ? '1' : String(Math.min(1, (LABEL_NEAR - s.dist) / 15));
      label.style.zIndex = String(s.rank);
    }
  }
}

// Tótem de la tribu (llega con la Edad de Piedra), junto a la fogata.
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
