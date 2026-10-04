import * as THREE from 'three';
import {
  RADIUS,
  elevation,
  surfaceHeight,
  naturalSurfaceHeight,
  addTerrainZone,
  removeTerrainZone,
} from './elevation.js';
import { biomeAt, BIOMES } from './biomes.js';
import { scanSite } from './sim/colony.js';
import { Parts, mat, stick, v, triangle, seededRandom, vary } from './modelKit.js';
import { FLAGS_BY_ID, DEFAULT_FLAG, drawFlag } from './flags.js';
import {
  FLAT_RADIUS,
  BLEND_RADIUS,
  TIPIS,
  RACK,
  WOODPILE,
  STORAGE,
  BANNER,
  polar,
  campZone,
  seedFromDir,
} from './sim/campLayout.js';

export { campLayout, campObstacles, seedFromDir } from './sim/campLayout.js';

// Campamento inicial de la civilización: el jugador elige dónde fundarlo haciendo clic
// en el terreno. Al fundarlo el terreno se nivela en un círculo y se pinta un claro de
// tierra pisada.
// Se funda una sola vez: después ya no se puede mover. Lo decide y lo guarda el servidor
// (el clic pide fundarlo; el servidor contesta con el campamento o con el motivo).

const MAX_PICK_CLEARANCE = 60_000; // hay que acercarse a menos de 60 km para elegir el sitio
const MAX_SLOPE = 0.4; // desnivel máximo (por metro) alrededor del sitio, unos 22°
const CLICK_TOLERANCE = 6; // píxeles que se puede mover el puntero y seguir contando como clic
const FLY_TO_CLEARANCE = 55; // altura a la que se acerca la cámara al fundar o ir al campamento
const MIN_CAMP_DISTANCE = 2_000; // metros sobre la superficie entre dos campamentos distintos
const MAX_GHOST_SCALE = 6; // la vista previa crece desde lejos, pero hasta este límite


const Y_AXIS = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Piezas del campamento (en metros, suelo en y = 0)
// ---------------------------------------------------------------------------

const BARK = '#6b4a2e';
const WOOD = '#8a643c';
const STONE = '#8b877f';

function addTipi(parts, x, z, facing, style) {
  const base = mat(x, 0, z, 0, facing, 0);
  const H = 7.2 * style.size;
  const R = 3.5 * style.size;
  const radiusAt = (y) => R * (1 - y / H);
  const local = (m) => m.premultiply(base);

  parts.add(new THREE.ConeGeometry(R, H, 9, 1), style.cloth, local(mat(0, H / 2, 0)));
  // Franjas decorativas pintadas sobre la tela.
  for (const [y0, y1, color] of style.bands) {
    const a = y0 * H;
    const b = y1 * H;
    parts.add(
      new THREE.CylinderGeometry(radiusAt(b) * 1.015, radiusAt(a) * 1.015, b - a, 9, 1, true),
      color,
      local(mat(0, (a + b) / 2, 0)),
    );
  }
  // Puerta abierta (mirando hacia la fogata) y la solapa doblada.
  const onCone = (angle, y, out = 1.03) => {
    const r = radiusAt(y) * out;
    return v(Math.sin(angle) * r, y, Math.cos(angle) * r);
  };
  const doorTop = 2.9 * style.size;
  parts.add(triangle(onCone(-0.3, 0.02), onCone(0.3, 0.02), onCone(0, doorTop)), '#2a1d14', base.clone());
  parts.add(
    triangle(onCone(0.3, 0.02), onCone(0, doorTop, 1.05), onCone(0.62, 0.35, 1.28)),
    new THREE.Color(style.cloth).multiplyScalar(0.82),
    base.clone(),
  );
  // Palos que asoman por arriba.
  const apex = v(0, H * 0.9, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const tip = apex.clone().add(v(Math.sin(a) * 0.55, 1.7, Math.cos(a) * 0.55).multiplyScalar(style.size));
    stick(parts, apex, tip, 0.07, '#4e3421', 4, base);
  }
  // Estacas en la base.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.45;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.5) continue; // no delante de la puerta
    const p = onCone(a, 0, 1.08);
    stick(parts, p.clone().setY(-0.2), p.clone().setY(0.45), 0.05, '#4e3421', 4, base);
  }
}

function addFirePit(parts, rand) {
  parts.add(new THREE.CircleGeometry(1.45, 10), '#3a322b', mat(0, 0.06, 0, -Math.PI / 2));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rand() * 0.2;
    const s = 0.34 + rand() * 0.16;
    parts.add(
      new THREE.DodecahedronGeometry(1, 0),
      vary(STONE, rand, 0.12),
      mat(Math.cos(a) * 1.7, s * 0.35, Math.sin(a) * 1.7, rand() * 3, rand() * 3, 0, s * 1.1, s * 0.7, s),
    );
  }
  // Leños en forma de tipi.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    stick(parts, v(Math.sin(a) * 0.85, 0.05, Math.cos(a) * 0.85), v(Math.sin(a) * 0.08, 1.25, Math.cos(a) * 0.08), 0.12, '#4a3020');
  }
  // Trípode con olla.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    stick(parts, v(Math.sin(a) * 1.9, 0, Math.cos(a) * 1.9), v(0, 3.2, 0), 0.06, '#5a3d26', 4);
  }
  stick(parts, v(0, 3.2, 0), v(0, 2.55, 0), 0.02, '#2b2b2b', 3);
  const pot = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.01, 0),
      new THREE.Vector2(0.32, 0.03),
      new THREE.Vector2(0.44, 0.22),
      new THREE.Vector2(0.42, 0.45),
      new THREE.Vector2(0.34, 0.54),
      new THREE.Vector2(0.38, 0.58),
    ],
    8,
  );
  parts.add(pot, '#34302c', mat(0, 1.98, 0));
  // Bancos de troncos alrededor.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const c = v(Math.sin(a) * 4.4, 0.32, Math.cos(a) * 4.4);
    const t = v(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(1.5 + rand() * 0.4);
    stick(parts, c.clone().sub(t), c.clone().add(t), 0.33, vary(BARK, rand), 7);
  }
}

function addDryingRack(parts, x, z, facing, rand) {
  const base = mat(x, 0, z, 0, facing, 0);
  stick(parts, v(-1.6, -0.2, 0), v(-1.6, 2.5, 0), 0.08, WOOD, 5, base);
  stick(parts, v(1.6, -0.2, 0), v(1.6, 2.5, 0), 0.08, WOOD, 5, base);
  stick(parts, v(-1.9, 2.4, 0), v(1.9, 2.4, 0), 0.06, WOOD, 5, base);
  const hides = ['#b58b5b', '#a3784a', '#c49a68'];
  for (let i = 0; i < 3; i++) {
    const m = mat(-1 + i, 1.65, 0.02, 0, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.12, 0.85, 1.25, 1);
    parts.add(new THREE.PlaneGeometry(1, 1.2, 1, 2), hides[i], m.premultiply(base));
  }
}

function addWoodPile(parts, x, z, facing, rand) {
  const base = mat(x, 0, z, 0, facing, 0);
  for (let row = 0; row < 4; row++) {
    const count = 4 - row;
    for (let i = 0; i < count; i++) {
      const px = (i - (count - 1) / 2) * 0.58;
      const py = 0.28 + row * 0.5;
      stick(parts, v(px, py, -1.5), v(px, py, 1.5), 0.27, vary(BARK, rand, 0.1), 6, base);
    }
  }
  // Tocón con un hacha clavada.
  parts.add(new THREE.CylinderGeometry(0.55, 0.62, 0.8, 7), BARK, mat(2.4, 0.4, 0.6).premultiply(base));
  parts.add(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 7), '#c9a26b', mat(2.4, 0.81, 0.6).premultiply(base));
  stick(parts, v(2.35, 0.78, 0.6), v(2.05, 1.7, 0.55), 0.045, '#9a7446', 4, base);
  parts.add(new THREE.BoxGeometry(0.42, 0.24, 0.05), '#6d6d70', mat(2.45, 0.85, 0.6, 0, 0, -0.3).premultiply(base));
}

function addStorage(parts, x, z, rand) {
  const potShape = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.28, 0.02),
    new THREE.Vector2(0.42, 0.35),
    new THREE.Vector2(0.36, 0.72),
    new THREE.Vector2(0.2, 0.86),
    new THREE.Vector2(0.24, 0.94),
  ];
  for (let i = 0; i < 4; i++) {
    const s = 0.75 + rand() * 0.5;
    parts.add(
      new THREE.LatheGeometry(potShape, 8),
      vary('#b3643a', rand, 0.12),
      mat(x + (rand() - 0.5) * 2.4, 0, z + (rand() - 0.5) * 2.4, 0, rand() * 6, 0, s),
    );
  }
  for (let i = 0; i < 2; i++) {
    parts.add(
      new THREE.CylinderGeometry(0.5, 0.4, 0.6, 9),
      vary('#c49a5a', rand),
      mat(x + 1.6 + i * 1.1, 0.3, z - 0.8 + rand() * 0.4),
    );
  }
  for (let i = 0; i < 3; i++) {
    parts.add(
      new THREE.DodecahedronGeometry(1, 0),
      vary('#bfa57a', rand),
      mat(x - 1.8 + i * 0.7, 0.35, z + 1.3, rand(), rand() * 6, 0, 0.5, 0.55, 0.42),
    );
  }
}

// Adornos del borde del claro según el bioma: matas de pasto (o de hierba seca) y
// piedras del color del lugar. Si el bioma no tiene pasto, sólo piedras.
function addGroundDetails(parts, rand, biome) {
  const { tuft, stone, stoneChance } = biome.details;
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = 17 + rand() * 14;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (tuft && rand() >= stoneChance) {
      for (let k = 0; k < 3; k++) {
        parts.add(
          new THREE.ConeGeometry(0.12, 0.7 + rand() * 0.4, 3),
          vary(tuft, rand, 0.15),
          mat(x + (rand() - 0.5) * 0.4, 0.3, z + (rand() - 0.5) * 0.4, (rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5),
        );
      }
    } else {
      const s = 0.2 + rand() * 0.3;
      parts.add(new THREE.DodecahedronGeometry(1, 0), vary(stone, rand, 0.15), mat(x, s * 0.3, z, rand(), rand(), 0, s));
    }
  }
}

function addBannerPole(parts) {
  stick(parts, v(0, -0.3, 0), v(0, 9.2, 0), 0.13, '#4a3120', 6);
  stick(parts, v(-0.1, 8.3, 0), v(2.9, 8.3, 0), 0.05, '#4a3120', 4);
  parts.add(new THREE.OctahedronGeometry(0.32, 0), '#d8a640', mat(0, 9.45, 0));
}

// Partes animadas: fuego, humo y bandera.
function createFire() {
  const fire = new THREE.Group();
  const flameColors = [
    ['#ff8a2a', '#ff5a0a', 0.75, 1.9],
    ['#ffc04a', '#ff9a1a', 0.5, 1.5],
    ['#fff2b0', '#ffd860', 0.28, 1.0],
  ];
  fire.userData.flames = flameColors.map(([color, emissive, r, h], i) => {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 6),
      new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 2.2 + i, flatShading: true }),
    );
    flame.position.y = h / 2 + 0.2;
    flame.userData.height = h;
    fire.add(flame);
    return flame;
  });
  // Brasas.
  const emberMaterial = new THREE.MeshStandardMaterial({ color: '#ff6a1a', emissive: '#ff4a00', emissiveIntensity: 2 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const ember = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), emberMaterial);
    ember.position.set(Math.cos(a) * 0.6, 0.15, Math.sin(a) * 0.6);
    fire.add(ember);
  }
  // Humo: bolitas grises que suben y se desvanecen.
  const puffGeometry = new THREE.IcosahedronGeometry(1, 0);
  fire.userData.smoke = [];
  for (let i = 0; i < 7; i++) {
    const puff = new THREE.Mesh(
      puffGeometry,
      new THREE.MeshStandardMaterial({ color: '#b8b4ae', transparent: true, depthWrite: false, flatShading: true }),
    );
    puff.renderOrder = 3.5; // el humo de la fogata se dibuja después de los caminos (renderOrder 2)
    puff.userData.phase = i / 7;
    fire.add(puff);
    fire.userData.smoke.push(puff);
  }
  const light = new THREE.PointLight('#ff9a4a', 140, 160, 2);
  light.position.y = 2.2;
  fire.add(light);
  fire.userData.light = light;
  return fire;
}

// ---- Bandera del mástil: la de la tribu (rayas de colores) o la de un país (textura) ----

const flagTextures = new Map();

export function flagTexture(id) {
  let texture = flagTextures.get(id);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = 270;
    canvas.height = 170;
    drawFlag(canvas.getContext('2d'), FLAGS_BY_ID.get(id), canvas.width, canvas.height);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    flagTextures.set(id, texture);
  }
  return texture;
}

// Pone la bandera elegida en el mástil de un campamento (su modelo de camp.js).
export function applyFlag(campObject, id) {
  const flag = campObject?.userData?.flag;
  if (!flag) return;
  const material = flag.material;
  const country = id && id !== DEFAULT_FLAG && FLAGS_BY_ID.has(id);
  material.map = country ? flagTexture(id) : null;
  material.vertexColors = !country;
  material.color.set(country ? '#ffffff' : '#ffffff');
  material.needsUpdate = true;
  flag.userData.flagId = country ? id : DEFAULT_FLAG;
}

function createFlag() {
  const geometry = new THREE.PlaneGeometry(2.7, 1.7, 10, 4);
  geometry.translate(1.45, 7.35, 0);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const main = new THREE.Color('#b8322a');
  const stripe = new THREE.Color('#e8c35a');
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    (Math.abs(y - 7.35) < 0.22 ? stripe : main).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const flag = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, roughness: 0.8 }),
  );
  flag.userData.base = Float32Array.from(pos.array);
  return flag;
}

// Modelo completo del campamento, centrado en la fogata. "biome" (de biomes.js) adapta
// los adornos del suelo al lugar; sin bioma (la vista previa) no se ponen.
export function createCampModel(seed = 1, biome = null) {
  const rand = seededRandom(seed);
  const camp = new THREE.Group();
  camp.name = 'camp';
  const parts = new Parts();

  addFirePit(parts, rand);
  // Los tipis van aparte: desaparecen cuando la aldea ya vive en casas (ver ColonyView).
  const tipiParts = new Parts();
  for (const t of TIPIS) {
    const x = Math.cos(t.angle) * t.dist;
    const z = Math.sin(t.angle) * t.dist;
    // La puerta (eje +Z del tipi) mira hacia la fogata.
    addTipi(tipiParts, x, z, Math.atan2(-x, -z), t);
  }
  addDryingRack(parts, ...polar(RACK), RACK.angle + Math.PI / 2, rand);
  addWoodPile(parts, ...polar(WOODPILE), WOODPILE.angle, rand);
  addStorage(parts, ...polar(STORAGE), rand);
  if (biome?.details) addGroundDetails(parts, rand, biome);

  const [bannerX, bannerZ] = polar(BANNER);
  const banner = new THREE.Group();
  banner.position.set(bannerX, 0, bannerZ);
  const bannerParts = new Parts();
  addBannerPole(bannerParts);
  const propsMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  banner.add(bannerParts.mesh(propsMaterial));
  const flag = createFlag();
  banner.add(flag);
  camp.add(banner);

  camp.add(parts.mesh(propsMaterial));
  const tipis = tipiParts.mesh(propsMaterial);
  tipis.name = 'tipis';
  camp.add(tipis);
  camp.userData.tipis = tipis;
  const fire = createFire();
  camp.add(fire);

  camp.userData.fire = fire;
  camp.userData.flag = flag;
  return camp;
}

function tangentBasis(dir, east = new THREE.Vector3(), north = new THREE.Vector3()) {
  east.crossVectors(Y_AXIS, dir);
  if (east.lengthSq() < 1e-10) east.set(1, 0, 0);
  east.normalize();
  north.crossVectors(dir, east);
  return { east, north };
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
export function pickSurface(ray, startHeight = 0, out = { dir: new THREE.Vector3(), height: 0, point: new THREE.Vector3() }) {
  let radius = RADIUS + Math.max(0, startHeight);
  const dir = out.dir;
  let height = 0;
  for (let i = 0; i < 6; i++) {
    pickSphere.radius = radius;
    if (!ray.intersectSphere(pickSphere, pickHit)) return null;
    dir.copy(pickHit).normalize();
    height = Math.max(0, surfaceHeight(dir));
    radius = RADIUS + height;
  }
  out.height = height;
  out.point.copy(dir).multiplyScalar(radius);
  return out;
}

// Validaciones del sitio. Cada una devuelve null si está bien, o el motivo si no.
// Para agregar una regla nueva basta con escribir otra función y sumarla a campProblem().

const siteTmp = { east: new THREE.Vector3(), north: new THREE.Vector3(), p: new THREE.Vector3() };

// Punto a "dist" metros de "dir" en la dirección "angle" (sobre la superficie).
function pointAround(dir, angle, dist, out) {
  return out
    .copy(dir)
    .addScaledVector(siteTmp.east, (Math.cos(angle) * dist) / RADIUS)
    .addScaledVector(siteTmp.north, (Math.sin(angle) * dist) / RADIUS)
    .normalize();
}

export function checkWater(dir, e) {
  if (e <= 0) return 'No se puede fundar en el agua';
  // Todo el círculo que se va a nivelar tiene que ser tierra firme.
  for (let i = 0; i < 12; i++) {
    const p = pointAround(dir, (i / 12) * Math.PI * 2, FLAT_RADIUS + BLEND_RADIUS, siteTmp.p);
    if (elevation(p.x, p.y, p.z) <= 0.002) return 'Demasiado cerca del agua';
  }
  return null;
}

export function checkClimate(dir, e) {
  if (Math.abs(dir.y) > 0.9) return 'Zona polar: hace demasiado frío';
  if (e > 0.62) return 'Demasiada altitud: nieve perpetua';
  return null;
}

export function checkSlope(dir) {
  // Desnivel respecto al centro a FLAT_RADIUS metros, en 8 direcciones.
  const h0 = naturalSurfaceHeight(dir);
  for (let i = 0; i < 8; i++) {
    const h = naturalSurfaceHeight(pointAround(dir, (i / 8) * Math.PI * 2, FLAT_RADIUS, siteTmp.p));
    if (Math.abs(h - h0) / FLAT_RADIUS > MAX_SLOPE) return 'El terreno es demasiado empinado';
  }
  return null;
}

// Distancia sobre la superficie (por el ángulo entre direcciones, no en línea recta).
export function surfaceDistance(dirA, dirB) {
  return dirA.angleTo(dirB) * RADIUS;
}

export function checkDistance(dir, otherCamps) {
  for (const other of otherCamps) {
    if (surfaceDistance(dir, other.dir) < MIN_CAMP_DISTANCE) return 'Demasiado cerca de otro campamento';
  }
  return null;
}

// Coordina las validaciones. "otherCamps" son los campamentos que deben quedar a
// distancia (no incluye el que se está reubicando).
export function campProblem(dir, otherCamps = []) {
  const e = elevation(dir.x, dir.y, dir.z);
  tangentBasis(dir, siteTmp.east, siteTmp.north); // base para pointAround()
  return (
    checkWater(dir, e) ||
    checkClimate(dir, e) ||
    checkSlope(dir) ||
    checkDistance(dir, otherCamps)
  );
}

// Qué hay de verdad cerca del lugar elegido: cuenta los recursos naturales reales (los mismos que tendrá
// la colonia al fundarse) dentro del territorio inicial (75 m) y en la zona de recolección (230 m).
// Devuelve { level: 'good' | 'ok' | 'hard', text }. Es una orientación, no una prohibición.
const SITE_NEEDS = { food: 12, wood: 20, stone: 6 }; // lo mínimo cómodo dentro del territorio inicial
export function siteReport(dir) {
  const seed = seedFromDir(dir);
  const [near, far] = scanSite(dir, seed);
  const lacking = Object.entries(SITE_NEEDS).filter(([k, n]) => near[k] < n).map(([k]) => ({ food: 'comida', wood: 'madera', stone: 'piedra' }[k]));
  const dead = Object.entries(near).filter(([, n]) => n < 3).map(([k]) => ({ food: 'comida', wood: 'madera', stone: 'piedra' }[k]));
  const counts = `En 75 m: ${near.food} de comida, ${near.wood} de madera y ${near.stone} de piedra (en 230 m: ${far.food}/${far.wood}/${far.stone}).`;
  const biome = biomeAt(dir.x, dir.y, dir.z).name;
  if (dead.length) return { level: 'hard', text: `${biome}. Zona difícil: casi no hay ${dead.join(' ni ')} cerca. ${counts}` };
  if (lacking.length) return { level: 'ok', text: `${biome}. Recursos justos (poca ${lacking.join(' y ')}). ${counts}` };
  return { level: 'good', text: `${biome}. Recursos suficientes cerca. ${counts}` };
}

const yawQuat = new THREE.Quaternion();

// Crea el modelo de un campamento en su sitio y nivela el terreno debajo (también para
// los campamentos de otros jugadores). No lo añade a la escena.
export function buildCamp(dir, height, yaw, terrain, zoneExtra = {}) {
  // El bioma del lugar decide el color del suelo pisado y los adornos del campamento.
  const biome = biomeAt(dir.x, dir.y, dir.z);
  const ground = biome.details ? biome : BIOMES.grassland;
  // Nivelar el terreno y pintar el claro; los trozos de terreno afectados se regeneran.
  const zone = addTerrainZone(campZone(dir, height, ground, zoneExtra));
  terrain.invalidateZone(zone);
  const seed = seedFromDir(dir);
  const object = createCampModel(seed, ground);
  orientOnSurface(object, dir, height, yaw);
  return { object, zone, seed };
}

export function orientOnSurface(object, dir, height, yaw) {
  object.position.copy(dir).multiplyScalar(RADIUS + height);
  object.quaternion.setFromUnitVectors(Y_AXIS, dir);
  if (yaw) object.quaternion.multiply(yawQuat.setFromAxisAngle(Y_AXIS, yaw));
}

// ---------------------------------------------------------------------------
// Sistema: botones, modo de colocación, marcador y guardado
// ---------------------------------------------------------------------------

export class CampSystem {
  constructor({ scene, camera, canvas, controls, terrain, ui }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.controls = controls;
    this.terrain = terrain;
    this.ui = ui;

    this.camp = null; // { object, zone, dir, height, yaw }
    this.placing = false;
    this.pointer = null; // última posición del ratón sobre el lienzo
    this.pressed = null;
    this.candidate = null;
    this.time = 0;

    this.ghost = makeGhost(createCampModel());
    this.ghost.visible = false;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(FLAT_RADIUS - 2.5, FLAT_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: '#5fe08a', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    // El anillo es hijo de la vista previa, que ya se orienta con la normal del planeta
    // (orientOnSurface): aquí sólo se acuesta sobre el plano local del campamento.
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.8;
    this.ghost.add(this.ring);
    scene.add(this.ghost);

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.markerPos = new THREE.Vector3();
    this.cameraDir = new THREE.Vector3();
    this.hit = { dir: new THREE.Vector3(), height: 0, point: new THREE.Vector3() };
    // Para no repetir raycast y validaciones si ni el ratón ni la cámara se movieron.
    this.lastPick = { x: NaN, y: NaN, position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

    ui.foundButton.addEventListener('click', () => this.startPlacing());
    ui.goButton.addEventListener('click', () => this.flyToCamp());
    ui.cancelButton.addEventListener('click', () => this.stopPlacing());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.placing) this.stopPlacing();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.pointer) {
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;
      } else {
        this.pointer = { x: e.clientX, y: e.clientY };
      }
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
      if (!this.pointer) this.pointer = { x: 0, y: 0 };
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.updateCandidate();
      if (this.candidate && !this.candidate.problem) this.found(this.candidate);
    });

    this.refreshUi();
  }

  startPlacing() {
    if (this.camp) return; // el campamento se funda una sola vez
    this.placing = true;
    this.candidate = null;
    this.lastPick.x = NaN; // forzar un cálculo nuevo
    this.refreshUi();
  }

  stopPlacing() {
    this.placing = false;
    this.waiting = false;
    this.candidate = null;
    this.ghost.visible = false;
    this.ui.tooltip.hidden = true;
    this.refreshUi();
  }

  // Pedir al servidor fundar aquí (onFoundRequest lo manda). Mientras contesta no se
  // puede elegir otro lugar.
  found({ dir }) {
    if (this.camp || this.waiting) return;
    this.waiting = true;
    this.ui.tooltip.hidden = true;
    this.onFoundRequest?.(dir.clone()); // "dir" es un objeto temporal que se reutiliza
  }

  // El servidor no aceptó el lugar: se sigue eligiendo.
  foundFailed(message) {
    this.waiting = false;
    this.lastPick.x = NaN;
    this.onMessage?.(message);
  }

  // El campamento que manda el servidor ({ dir, height, yaw, seed }). La primera vez
  // (recién fundado) la cámara vuela hasta él.
  showCamp(camp) {
    const dir = new THREE.Vector3(camp.dir.x, camp.dir.y, camp.dir.z).normalize();
    const same = this.camp && this.camp.dir.distanceTo(dir) < 1e-9 && this.camp.yaw === camp.yaw;
    if (same) return;
    const wasPlacing = this.placing || this.waiting;
    this.setCamp(dir, camp.height, camp.yaw);
    this.waiting = false;
    if (wasPlacing) {
      this.stopPlacing();
      this.flyToCamp();
    }
    this.refreshUi();
  }

  removeCamp() {
    if (!this.camp) return;
    this.scene.remove(this.camp.object);
    this.camp.object.traverse((o) => o.geometry?.dispose());
    removeTerrainZone(this.camp.zone);
    this.terrain.invalidateZone(this.camp.zone);
    this.camp = null;
  }

  // Bandera del jugador: se pone al dibujar el campamento y cada vez que la cambia.
  setFlag(id) {
    this.flagId = id;
    if (this.camp) applyFlag(this.camp.object, id);
  }

  setCamp(dir, height, yaw) {
    this.removeCamp();
    const { object, zone, seed } = buildCamp(dir, height, yaw, this.terrain);
    applyFlag(object, this.flagId);
    this.scene.add(object);
    this.camp = { object, zone, dir: dir.clone(), height, yaw, seed };
  }

  flyToCamp() {
    if (this.camp) this.controls.flyTo(this.camp.dir, FLY_TO_CLEARANCE, { orbit: true });
  }

  refreshUi() {
    const { ui } = this;
    ui.foundButton.hidden = this.placing || !!this.camp;
    ui.goButton.hidden = this.placing || !this.camp;
    ui.cancelButton.hidden = !this.placing;
    ui.banner.hidden = !this.placing;
    this.canvas.classList.toggle('is-placing', this.placing);
  }

  clearance() {
    return this.camera.position.length() - RADIUS - Math.max(0, this.controls.groundHeight);
  }

  // Campamentos de los demás jugadores ({ dir }), que el sitio elegido debe respetar
  // por distancia (el servidor lo vuelve a comprobar). Lo asigna main.js.
  otherCamps() {
    return this.getOthers?.() ?? [];
  }

  updateCandidate() {
    if (!this.pointer) {
      this.candidate = null;
      return;
    }
    // Si ni el ratón ni la cámara se movieron, el resultado anterior sigue valiendo.
    const last = this.lastPick;
    const cam = this.camera;
    if (
      last.x === this.pointer.x &&
      last.y === this.pointer.y &&
      last.position.equals(cam.position) &&
      last.quaternion.equals(cam.quaternion)
    ) {
      return;
    }
    last.x = this.pointer.x;
    last.y = this.pointer.y;
    last.position.copy(cam.position);
    last.quaternion.copy(cam.quaternion);

    this.candidate = null;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((this.pointer.x - rect.left) / rect.width) * 2 - 1,
      -((this.pointer.y - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, cam);
    const hit = pickSurface(this.raycaster.ray, this.controls.groundHeight, this.hit);
    if (!hit) return;
    const problem =
      this.clearance() > MAX_PICK_CLEARANCE ? 'Acércate más para elegir el lugar' : campProblem(hit.dir, this.otherCamps());
    // El conteo de recursos reales se recalcula sólo si el puntero se movió más de ~20 m.
    let report = null;
    if (!problem && this.clearance() <= MAX_PICK_CLEARANCE) {
      const cache = this.siteCache;
      if (!cache || cache.dir.angleTo(hit.dir) * RADIUS > 20) this.siteCache = { dir: hit.dir.clone(), report: siteReport(hit.dir) };
      report = this.siteCache.report;
    }
    this.candidate = { dir: hit.dir, height: hit.height, point: hit.point, problem, report };
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
        this.ghost.scale.setScalar(THREE.MathUtils.clamp(distance / 900, 1, MAX_GHOST_SCALE));
        this.ring.material.color.set(c.problem ? '#ff5a4f' : '#5fe08a');
      }
      const { tooltip } = this.ui;
      tooltip.hidden = !c || !this.pointer;
      if (!tooltip.hidden) {
        tooltip.textContent = c.problem || `Clic para fundar aquí. ${c.report?.text ?? ''}`;
        tooltip.classList.toggle('is-invalid', !!c.problem || c.report?.level === 'hard');
        tooltip.style.transform = `translate(${this.pointer.x + 16}px, ${this.pointer.y + 16}px)`;
      }
    }

    if (this.camp) this.animateCamp(this.camp.object, this.time);
    if (this.ghost.visible) this.animateCamp(this.ghost, this.time);
    this.updateMarker();
  }

  animateCamp(object, t) {
    const { fire, flag } = object.userData;
    // Llamas que titilan.
    fire.userData.flames.forEach((flame, i) => {
      const f = 1 + Math.sin(t * (11 + i * 3) + i) * 0.1 + Math.sin(t * (6.7 + i * 2.1)) * 0.07;
      flame.scale.set(1 + (f - 1) * 0.4, f, 1 + (f - 1) * 0.4);
      flame.position.y = (flame.userData.height * f) / 2 + 0.2;
      flame.rotation.y = t * (0.6 + i * 0.4);
    });
    const flicker = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
    fire.userData.light.intensity = 140 * flicker;
    // Humo: cada bolita sube, crece, se desplaza con el viento y se desvanece.
    for (const puff of fire.userData.smoke) {
      const k = (t * 0.22 + puff.userData.phase) % 1;
      puff.position.set(k * 2.2 + Math.sin(k * 6 + puff.userData.phase * 9) * 0.3, 2.2 + k * 9, k * 0.8);
      puff.scale.setScalar(0.35 + k * 1.3);
      puff.material.opacity = 0.55 * (1 - k) * Math.min(1, k * 6);
    }
    // Bandera ondeando.
    const pos = flag.geometry.attributes.position;
    const base = flag.userData.base;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3] - 0.1;
      const w = Math.max(0, x) / 2.7;
      pos.setZ(i, Math.sin(x * 2.3 - t * 4.2) * 0.22 * w + Math.sin(x * 4.1 - t * 6.1) * 0.06 * w);
      pos.setY(i, base[i * 3 + 1] - w * w * 0.25);
    }
    pos.needsUpdate = true;
  }

  // Etiqueta "Campamento" sobre la pantalla para encontrarlo desde lejos.
  updateMarker() {
    const { marker } = this.ui;
    if (!this.camp || this.placing) {
      marker.hidden = true;
      return;
    }
    const cam = this.camera.position;
    const camR = cam.length();
    const markerR = RADIUS + this.camp.height + 12;
    // Detrás del planeta: el ángulo entre la cámara y el campamento (visto desde el
    // centro) supera lo que alcanza a ver la cámara más lo que asoma el marcador.
    const horizonAngle = Math.acos(Math.min(1, RADIUS / camR)) + Math.acos(Math.min(1, RADIUS / markerR));
    const behind = this.cameraDir.copy(cam).divideScalar(camR).angleTo(this.camp.dir) > horizonAngle;
    const pos = this.markerPos.copy(this.camp.dir).multiplyScalar(markerR);
    const tooClose = cam.distanceTo(pos) < 2_500;
    pos.project(this.camera);
    if (behind || tooClose || pos.z > 1 || Math.abs(pos.x) > 1.1 || Math.abs(pos.y) > 1.1) {
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
