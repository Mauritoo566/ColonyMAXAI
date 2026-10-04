// Follaje del mundo: matas de pasto, pasto alto, helechos, arbustos y flores que cubren el suelo alrededor de lo que se mira. Pensado para no dar lag:
//  - Sólo existe cerca (unos 85 m alrededor del punto que se mira, y sólo a poca altura): no hay nada que dibujar de lejos.
//  - Se genera por trozos de 24 m, anclados al mundo (siempre el mismo pasto en el mismo sitio, para todos los jugadores), con un tope de tiempo por
//    fotograma: la altura y el bioma se calculan en una cuadrícula pequeña por trozo y el resto se interpola. Nada de esto toca el hilo del juego más de
//    unos milisegundos, y un trozo ya generado no se vuelve a calcular.
//  - Cada tipo es UN InstancedMesh (8 llamadas de dibujo en total) con modelos de pocos triángulos; al moverse la cámara sólo se copian matrices.
//  - Se aclara con la distancia (menos matas lejos) y las matas se encogen hasta desaparecer en el borde (no hay saltos), y la densidad baja sola con la
//    calidad gráfica y si el equipo va justo.
//  - Reutiliza el sombreador de estaciones de los recursos: el pasto amarillea en otoño, se pone pardo en invierno y se cubre de nieve donde hace frío; y se
//    mece con el viento en el propio sombreador (sin tocar la CPU).
//  - No sale en el agua, la nieve, las pendientes fuertes, el claro de las aldeas y de sus edificios, ni sobre los caminos.
import * as THREE from 'three';
import { RADIUS, surfaceHeight, terrainZones, zoneDistance } from './elevation.js';
import { classifyBiome, temperature } from './biomes.js';
import { elevation, moisture } from './elevation.js';
import { partsGeometry, triangle, v, seededRandom } from './modelKit.js';
import { seasonalMaterial } from './resources.js';

// ---- Ajustes ---------------------------------------------------------------------------------------------------------------------------
export const CHUNK_M = 24; // lado de un trozo
const GRID = 6; // divisiones por lado para la altura y el bioma de cada trozo
export const RADIUS_FAR = 85; // metros desde el punto que se mira: más lejos no hay follaje
const KEEP_CACHE = 170; // trozos ya generados que se recuerdan fuera de la vista (por distancia)
const MAX_CHUNKS_PER_FRAME = 2;
const BUDGET_MS = 3; // tiempo máximo por fotograma generando trozos
const MAX_ALTITUDE = 260; // a más altura que esto (sobre el suelo) no se dibuja
const REBUILD_MOVE = 5; // metros que se mueve el foco para rehacer las instancias
const REBUILD_EVERY = 0.12; // segundos mínimos entre dos reconstrucciones
const MAX_SLOPE = 0.75; // pendiente (tangente) máxima donde crece
const FADE_NEAR = 62;
const FADE_FAR = 84; // metros: entre ambos las matas se encogen hasta desaparecer

// Qué crece en cada bioma y cuántas matas por metro cuadrado.
const MIX = {
  grassland: [['grass', 0.9], ['flower', 0.06], ['shrub', 0.004]],
  forest: [['grass', 0.38], ['fern', 0.14], ['shrub', 0.012], ['flower', 0.012]],
  taiga: [['grass', 0.2], ['fern', 0.09], ['shrub', 0.006]],
  jungle: [['grass', 0.32], ['fern', 0.24], ['shrub', 0.016]],
  steppe: [['tallgrass', 0.5], ['grass', 0.22], ['flower', 0.012]],
  savanna: [['tallgrass', 0.46], ['shrub', 0.006]],
  tundra: [['grass', 0.13]],
  swamp: [['tallgrass', 0.26], ['fern', 0.06]],
  beach: [['grass', 0.03]],
  mountain: [['grass', 0.07], ['shrub', 0.004]],
  desert: [['shrub', 0.006]],
};
const FLOWER_COLORS = ['#e8463c', '#f0d24a', '#f4f4ee', '#a874d8'];
export const KINDS = ['grass', 'tallgrass', 'fern', 'shrub', 'flower0', 'flower1', 'flower2', 'flower3'];
const CAP = { grass: 16000, tallgrass: 9000, fern: 6000, shrub: 2500, flower0: 2500, flower1: 2500, flower2: 2500, flower3: 2500 };
// Cuánto pierde las hojas cada tipo con el frío (1 = del todo).
const DECIDUOUS = { grass: 0.75, tallgrass: 0.9, fern: 0.7, shrub: 0.6, flower0: 0.95, flower1: 0.95, flower2: 0.95, flower3: 0.95 };
// Tamaño y color de cada tipo.
const SIZE = { grass: [0.8, 1.35], tallgrass: [0.8, 1.3], fern: [0.8, 1.3], shrub: [0.8, 1.4], flower: [0.8, 1.25] };

// ---- Modelos (pocos triángulos; colores de vértice casi blancos: el color real lo pone cada instancia) ---------------------------------
const WHITE = '#ffffff';
const SHADE = '#b4b4b4';

function blade(parts, x, z, h, w, lean, yaw) {
  // Una hoja: tramo bajo (más oscuro) y punta (más clara); se inclina hacia "yaw".
  const dx = Math.cos(yaw);
  const dz = Math.sin(yaw);
  const px = -dz;
  const pz = dx;
  const bx = x + dx * lean * h * 0.55;
  const bz = z + dz * lean * h * 0.55;
  const tx = x + dx * lean * h;
  const tz = z + dz * lean * h;
  const lo = [v(x - px * w, 0, z - pz * w), v(x + px * w, 0, z + pz * w), v(bx + px * w * 0.6, h * 0.55, bz + pz * w * 0.6), v(bx - px * w * 0.6, h * 0.55, bz - pz * w * 0.6)];
  parts.add(triangle(lo[0], lo[1], lo[2]), SHADE);
  parts.add(triangle(lo[0], lo[2], lo[3]), SHADE);
  parts.add(triangle(lo[3], lo[2], v(tx, h, tz)), WHITE);
}

function grassGeometry(n, h, w, lean) {
  return partsGeometry((p) => {
    const rand = seededRandom(7 + n * 13);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rand() * 0.5;
      const r = 0.05 + rand() * 0.1;
      blade(p, Math.cos(a) * r, Math.sin(a) * r, h * (0.7 + rand() * 0.5), w, lean * (0.6 + rand() * 0.8), a + (rand() - 0.5) * 0.8);
    }
  });
}

function fernGeometry() {
  return partsGeometry((p) => {
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const px = -dz;
      const pz = dx;
      const reach = 0.55 + (k % 2) * 0.12;
      // Fronda arqueada: sube y cae hacia fuera (dos mitades).
      const base = v(dx * 0.04, 0.04, dz * 0.04);
      const mid = v(dx * reach * 0.55, 0.42 + (k % 3) * 0.05, dz * reach * 0.55);
      const tip = v(dx * reach, 0.28, dz * reach);
      p.add(triangle(v(base.x - px * 0.05, 0.05, base.z - pz * 0.05), v(base.x + px * 0.05, 0.05, base.z + pz * 0.05), mid), SHADE);
      p.add(triangle(v(mid.x - px * 0.13, mid.y - 0.03, mid.z - pz * 0.13), v(mid.x + px * 0.13, mid.y - 0.03, mid.z + pz * 0.13), tip), WHITE);
      p.add(triangle(v(base.x + px * 0.05, 0.05, base.z + pz * 0.05), mid, v(mid.x + px * 0.13, mid.y - 0.03, mid.z + pz * 0.13)), SHADE);
    }
  });
}

function shrubGeometry() {
  return partsGeometry((p) => {
    const balls = [[0, 0.32, 0, 0.42], [0.3, 0.26, 0.15, 0.3], [-0.28, 0.28, -0.1, 0.32], [0.05, 0.5, -0.2, 0.26]];
    for (const [x, y, z, r] of balls) {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.scale(1.15, 0.8, 1.15);
      g.translate(x, y, z);
      p.add(g, y > 0.4 ? WHITE : SHADE);
    }
  });
}

function flowerGeometry(color) {
  return partsGeometry((p) => {
    const rand = seededRandom(31);
    for (let k = 0; k < 3; k++) {
      const x = (k - 1) * 0.12 + (rand() - 0.5) * 0.05;
      const z = (rand() - 0.5) * 0.12;
      const h = 0.28 + rand() * 0.12;
      // Tallo y hoja.
      p.add(triangle(v(x - 0.012, 0, z), v(x + 0.012, 0, z), v(x, h, z)), '#5a9a3a');
      p.add(triangle(v(x, h * 0.35, z), v(x + 0.09, h * 0.5, z + 0.03), v(x, h * 0.5, z)), '#4a8a32');
      // Flor: una cabeza de pétalos (octaedro aplastado).
      const g = new THREE.OctahedronGeometry(0.055, 0);
      g.scale(1, 0.55, 1);
      g.translate(x, h + 0.02, z);
      p.add(g, color);
      const c = new THREE.OctahedronGeometry(0.02, 0);
      c.translate(x, h + 0.045, z);
      p.add(c, '#e8b830');
    }
  });
}

// ---- Sombreador: viento y encogerse con la distancia ---------------------------------------------------------------------------------
const uniforms = { uTime: { value: 0 }, uFadeNear: { value: FADE_NEAR }, uFadeFar: { value: FADE_FAR } };

function foliageMaterial(deciduous) {
  const material = seasonalMaterial(deciduous);
  const seasonal = material.onBeforeCompile;
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = (shader) => {
    seasonal(shader);
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uFadeNear = uniforms.uFadeNear;
    shader.uniforms.uFadeFar = uniforms.uFadeFar;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uTime;\nuniform float uFadeNear;\nuniform float uFadeFar;\nvoid main() {')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          {
            // Viento: la parte alta de la mata se mece (fase distinta según el sitio) y la mata se encoge hasta nada en el borde de la vista.
            vec3 ip = instanceMatrix[3].xyz;
            float ph = dot(ip, vec3(0.37, 0.11, 0.29));
            float hh = max(transformed.y, 0.0);
            transformed.x += sin(uTime * 1.7 + ph) * 0.07 * hh + sin(uTime * 3.1 + ph * 1.7) * 0.02 * hh;
            transformed.z += cos(uTime * 1.3 + ph * 0.8) * 0.05 * hh;
            float fd = length((modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
            transformed *= 1.0 - smoothstep(uFadeNear, uFadeFar, fd);
          }
        #endif`);
  };
  material.customProgramCacheKey = () => 'follaje';
  return material;
}

// ---- Trozos ------------------------------------------------------------------------------------------------------------------------------
const A = CHUNK_M / RADIUS; // ángulo de un trozo (radianes)

function dirOf(lat, lon, out) {
  const c = Math.cos(lat);
  return out.set(c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon));
}

function colsAt(lat) {
  return Math.max(1, Math.floor((Math.PI * 2 * Math.cos(lat)) / A));
}

const keyOf = (i, j) => i * 4_000_000 + j;

function hashChunk(i, j) {
  let h = 2166136261;
  for (const n of [i, j, 0x7f4a7c15]) {
    h ^= n & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= (n >> 16) & 0xffff;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const tmpDir = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpFwd = new THREE.Vector3();
const tmpWorld = new THREE.Vector3();

// Genera un trozo: devuelve, por tipo, posiciones (mundo), base (9 números: ejes con tamaño), color y "rango" (para aclarar con la distancia).
export function generateChunk(i, j, options = {}) {
  const { blocked = null } = options;
  const cols = colsAt((i + 0.5) * A);
  const colAngle = (Math.PI * 2) / cols;
  const rand = seededRandom(hashChunk(i, j));
  const lat0 = i * A;
  const lon0 = j * colAngle;
  const N = GRID;
  // Altura y bioma en la cuadrícula del trozo.
  const heights = new Float32Array((N + 1) * (N + 1));
  const dirs = [];
  for (let gi = 0; gi <= N; gi++) {
    for (let gj = 0; gj <= N; gj++) {
      const d = dirOf(lat0 + (gi / N) * A, lon0 + (gj / N) * colAngle, new THREE.Vector3());
      dirs.push(d);
      heights[gi * (N + 1) + gj] = surfaceHeight(d);
    }
  }
  const cell = CHUNK_M / N;
  const slopeAt = (gi, gj) => {
    const i1 = Math.min(N, gi + 1);
    const j1 = Math.min(N, gj + 1);
    const i0 = Math.max(0, gi - 1);
    const j0 = Math.max(0, gj - 1);
    const dz = (heights[i1 * (N + 1) + gj] - heights[i0 * (N + 1) + gj]) / ((i1 - i0) * cell);
    const dx = (heights[gi * (N + 1) + j1] - heights[gi * (N + 1) + j0]) / ((j1 - j0) * cell);
    return Math.hypot(dx, dz);
  };
  const biomes = [];
  const slopes = [];
  for (let gi = 0; gi <= N; gi++) {
    for (let gj = 0; gj <= N; gj++) {
      const d = dirs[gi * (N + 1) + gj];
      const s = slopeAt(gi, gj);
      slopes.push(s);
      const e = elevation(d.x, d.y, d.z);
      if (e <= 0) {
        biomes.push(null);
        continue;
      }
      const lat = Math.abs(d.y);
      const slope = 1 - Math.cos(Math.atan(s));
      const m = e > 0.02 && e <= 0.62 && lat <= 0.9 && slope <= 0.3 ? moisture(d.x, d.y, d.z) : 0;
      biomes.push(classifyBiome(e, lat, slope, m, temperature(d.x, d.y, d.z, e)));
    }
  }
  // Zonas (aldeas y edificios) que tocan este trozo: dentro de su claro no hay follaje.
  const centerDir = dirOf(lat0 + A / 2, lon0 + colAngle / 2, new THREE.Vector3());
  const zones = terrainZones().filter((z) => zoneDistance(z, centerDir.x, centerDir.y, centerDir.z) < (Math.min(z.resourceClear ?? 45, (z.clearRadius ?? 20) + 10) + CHUNK_M));
  const area = CHUNK_M * CHUNK_M;
  const kinds = {};
  for (const k of KINDS) kinds[k] = { pos: [], basis: [], color: [], rank: [] };
  const col = new THREE.Color();
  const put = (kind, u, w, h, biome, jitterColor) => {
    const k = kinds[kind];
    const lat = lat0 + u * A;
    const lon = lon0 + w * colAngle;
    dirOf(lat, lon, tmpDir);
    tmpWorld.copy(tmpDir).multiplyScalar(RADIUS + h - 0.04);
    for (const z of zones) {
      if (zoneDistance(z, tmpDir.x, tmpDir.y, tmpDir.z) < Math.min(z.resourceClear ?? 45, (z.clearRadius ?? 20) + 10)) return;
    }
    if (blocked && blocked(tmpWorld, tmpDir)) return;
    tmpUp.copy(tmpDir);
    const ref = Math.abs(tmpUp.y) < 0.9 ? tmpFwd.set(0, 1, 0) : tmpFwd.set(1, 0, 0);
    tmpRight.crossVectors(ref, tmpUp).normalize();
    tmpFwd.crossVectors(tmpUp, tmpRight);
    const yaw = rand() * Math.PI * 2;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const family = kind.startsWith('flower') ? 'flower' : kind;
    const [lo, hi] = SIZE[family];
    const s = lo + rand() * (hi - lo);
    const r = [tmpRight.x * cy + tmpFwd.x * sy, tmpRight.y * cy + tmpFwd.y * sy, tmpRight.z * cy + tmpFwd.z * sy];
    const f = [-tmpRight.x * sy + tmpFwd.x * cy, -tmpRight.y * sy + tmpFwd.y * cy, -tmpRight.z * sy + tmpFwd.z * cy];
    const hs = s * (0.85 + rand() * 0.3);
    k.pos.push(tmpWorld.x, tmpWorld.y, tmpWorld.z);
    k.basis.push(r[0] * s, r[1] * s, r[2] * s, tmpUp.x * hs, tmpUp.y * hs, tmpUp.z * hs, f[0] * s, f[1] * s, f[2] * s);
    // Color: el del pasto del bioma con algo de variación (las flores llevan su propio color en el modelo).
    if (family === 'flower') col.setRGB(1, 1, 1).multiplyScalar(0.9 + rand() * 0.2);
    else {
      col.set(biome.details?.tuft ?? '#5d8f36');
      if (family === 'shrub') col.multiplyScalar(0.78);
      if (family === 'fern') col.lerp(new THREE.Color('#2f8a3a'), 0.35);
      col.multiplyScalar(0.88 + rand() * 0.24 + (jitterColor ?? 0));
    }
    k.color.push(col.r, col.g, col.b);
    k.rank.push(rand());
  };
  // Cada bioma de la cuadrícula reparte lo suyo por sus celdas.
  for (let gi = 0; gi < N; gi++) {
    for (let gj = 0; gj < N; gj++) {
      const idx = gi * (N + 1) + gj;
      // El bioma de la celda: el de su esquina más "interior" (se elige el que no es nulo).
      const corners = [idx, idx + 1, idx + (N + 1), idx + (N + 1) + 1];
      const biome = corners.map((c) => biomes[c]).find((b) => b) ?? null;
      if (!biome) continue;
      const mix = MIX[biome.id];
      if (!mix) continue;
      const cellArea = area / (N * N);
      for (const [family, density] of mix) {
        const expected = density * cellArea;
        let n = Math.floor(expected);
        if (rand() < expected - n) n++;
        for (let q = 0; q < n; q++) {
          const u = (gi + rand()) / N;
          const w = (gj + rand()) / N;
          // Altura (interpolada) y pendiente de ese punto.
          const hu = u * N;
          const hw = w * N;
          const i0 = Math.min(N - 1, Math.floor(hu));
          const j0 = Math.min(N - 1, Math.floor(hw));
          const fu = hu - i0;
          const fw = hw - j0;
          const h00 = heights[i0 * (N + 1) + j0];
          const h01 = heights[i0 * (N + 1) + j0 + 1];
          const h10 = heights[(i0 + 1) * (N + 1) + j0];
          const h11 = heights[(i0 + 1) * (N + 1) + j0 + 1];
          const h = h00 * (1 - fu) * (1 - fw) + h01 * (1 - fu) * fw + h10 * fu * (1 - fw) + h11 * fu * fw;
          if (h <= 1.0) continue; // agua, orilla
          const sl = slopes[i0 * (N + 1) + j0];
          if (sl > MAX_SLOPE) continue;
          const kind = family === 'flower' ? `flower${Math.floor(rand() * 4)}` : family;
          put(kind, u, w, h, biome);
        }
      }
    }
  }
  const out = {};
  for (const k of KINDS) {
    out[k] = { count: kinds[k].pos.length / 3, pos: new Float64Array(kinds[k].pos), basis: new Float32Array(kinds[k].basis), color: new Float32Array(kinds[k].color), rank: new Float32Array(kinds[k].rank) };
  }
  out.total = KINDS.reduce((a, k) => a + out[k].count, 0);
  return out;
}

// ---- El sistema --------------------------------------------------------------------------------------------------------------------------
export class FoliageSystem {
  // blocked(worldPos, dir): true donde no debe crecer nada (caminos, etc.).
  constructor(scene, { blocked = null, density = () => 1 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'follaje';
    scene.add(this.group);
    this.blocked = blocked;
    this.density = density;
    this.chunks = new Map();
    this.meshes = {};
    this.origin = new THREE.Vector3();
    this.lastFocus = new THREE.Vector3(Infinity, 0, 0);
    this.sinceRebuild = 0;
    this.zonesSig = '';
    this.dirty = true;
    this.lastDensity = 1;
    this.stats = { instances: 0, chunks: 0, generatedMs: 0 };
    const geometries = {
      grass: grassGeometry(7, 0.45, 0.028, 0.35),
      tallgrass: grassGeometry(8, 1.0, 0.03, 0.4),
      fern: fernGeometry(),
      shrub: shrubGeometry(),
    };
    FLOWER_COLORS.forEach((c, i) => (geometries[`flower${i}`] = flowerGeometry(c)));
    for (const kind of KINDS) {
      const mesh = new THREE.InstancedMesh(geometries[kind], foliageMaterial(DECIDUOUS[kind]), CAP[kind]);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP[kind] * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      this.meshes[kind] = mesh;
    }
  }

  // Cada fotograma. focus: dirección unitaria del punto que se mira; clearance: altura de la cámara sobre el suelo (m).
  update(camera, focus, clearance, delta = 0.016) {
    uniforms.uTime.value += delta;
    const visible = clearance < MAX_ALTITUDE;
    this.group.visible = visible;
    if (!visible) return;
    this.sinceRebuild += delta;
    // Si cambiaron las zonas (se construyó o se quitó algo), lo generado se rehace poco a poco.
    const zones = terrainZones();
    const sig = `${zones.length}:${zones.length ? zones[zones.length - 1].height : 0}`;
    if (sig !== this.zonesSig) {
      this.zonesSig = sig;
      this.chunks.clear();
      this.dirty = true;
    }
    const need = this.chunksAround(focus);
    // Genera los que faltan (los más cercanos primero) sin pasarse del tiempo por fotograma.
    const t0 = performance.now();
    let made = 0;
    for (const c of need) {
      if (this.chunks.has(c.key)) continue;
      if (made >= MAX_CHUNKS_PER_FRAME || performance.now() - t0 > BUDGET_MS) break;
      const data = generateChunk(c.i, c.j, { blocked: this.blocked });
      data.center = c.dir;
      this.chunks.set(c.key, data);
      made++;
      this.dirty = true;
    }
    this.stats.generatedMs += performance.now() - t0;
    if (this.chunks.size > KEEP_CACHE * 2) this.trim(focus);
    const moved = this.lastFocus.distanceTo(focus) * RADIUS;
    const density = this.density();
    if (Math.abs(density - this.lastDensity) > 0.04) this.dirty = true;
    if ((this.dirty || moved > REBUILD_MOVE) && this.sinceRebuild >= REBUILD_EVERY) {
      this.rebuild(focus, density);
      this.lastFocus.copy(focus);
      this.lastDensity = density;
      this.sinceRebuild = 0;
      this.dirty = false;
    }
  }

  // Trozos que cubren el círculo de RADIUS_FAR alrededor del foco, ordenados de cerca a lejos.
  chunksAround(focus) {
    const lat0 = Math.asin(THREE.MathUtils.clamp(focus.y, -1, 1));
    const lon0 = Math.atan2(focus.x, focus.z);
    const span = (RADIUS_FAR + CHUNK_M) / RADIUS;
    const i0 = Math.floor((lat0 - span) / A);
    const i1 = Math.floor((lat0 + span) / A);
    const out = [];
    for (let i = i0; i <= i1; i++) {
      const latc = (i + 0.5) * A;
      if (Math.abs(latc) > Math.PI / 2 - 0.0005) continue;
      const cols = colsAt(latc);
      const colAngle = (Math.PI * 2) / cols;
      const lonSpan = span / Math.max(0.01, Math.cos(latc));
      const lonNorm = lon0 < 0 ? lon0 + Math.PI * 2 : lon0;
      const j0 = Math.floor((lonNorm - lonSpan) / colAngle);
      const j1 = Math.floor((lonNorm + lonSpan) / colAngle);
      for (let j = j0; j <= j1 && j < j0 + cols; j++) {
        const jw = ((j % cols) + cols) % cols;
        const dir = dirOf(latc, (jw + 0.5) * colAngle, new THREE.Vector3());
        const d = dir.angleTo(focus) * RADIUS;
        if (d > RADIUS_FAR + CHUNK_M * 0.8) continue;
        out.push({ i, j: jw, key: keyOf(i, jw), dir, d });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  trim(focus) {
    const list = [...this.chunks.entries()].map(([k, c]) => [k, c.center.angleTo(focus) * RADIUS]).sort((a, b) => b[1] - a[1]);
    for (const [k, d] of list) {
      if (this.chunks.size <= KEEP_CACHE || d < RADIUS_FAR * 1.6) break;
      this.chunks.delete(k);
    }
  }

  // Copia las instancias cercanas a los InstancedMesh (aclarando con la distancia y con la densidad pedida).
  rebuild(focus, density) {
    this.origin.copy(focus).multiplyScalar(RADIUS + Math.max(0, surfaceHeight(focus)));
    this.group.position.copy(this.origin);
    const ox = this.origin.x;
    const oy = this.origin.y;
    const oz = this.origin.z;
    const counts = {};
    for (const k of KINDS) counts[k] = 0;
    const far2 = (RADIUS_FAR + 2) ** 2;
    for (const [, c] of this.chunks) {
      if (c.center.angleTo(focus) * RADIUS > RADIUS_FAR + CHUNK_M) continue;
      for (const k of KINDS) {
        const d = c[k];
        if (!d.count) continue;
        const mesh = this.meshes[k];
        const arr = mesh.instanceMatrix.array;
        const colArr = mesh.instanceColor.array;
        let n = counts[k];
        for (let q = 0; q < d.count; q++) {
          const px = d.pos[q * 3] - ox;
          const py = d.pos[q * 3 + 1] - oy;
          const pz = d.pos[q * 3 + 2] - oz;
          const dist2 = px * px + py * py + pz * pz;
          if (dist2 > far2) continue;
          // Aclarado: todo cerca; menos matas cuanto más lejos (y menos con poca calidad).
          const dist = Math.sqrt(dist2);
          const keep = (dist < 35 ? 1 : dist < 60 ? 1 - ((dist - 35) / 25) * 0.5 : 0.5 - ((dist - 60) / 25) * 0.35) * density;
          if (d.rank[q] > keep) continue;
          if (n >= CAP[k]) break;
          const o = n * 16;
          const b = q * 9;
          arr[o] = d.basis[b];
          arr[o + 1] = d.basis[b + 1];
          arr[o + 2] = d.basis[b + 2];
          arr[o + 3] = 0;
          arr[o + 4] = d.basis[b + 3];
          arr[o + 5] = d.basis[b + 4];
          arr[o + 6] = d.basis[b + 5];
          arr[o + 7] = 0;
          arr[o + 8] = d.basis[b + 6];
          arr[o + 9] = d.basis[b + 7];
          arr[o + 10] = d.basis[b + 8];
          arr[o + 11] = 0;
          arr[o + 12] = px;
          arr[o + 13] = py;
          arr[o + 14] = pz;
          arr[o + 15] = 1;
          colArr[n * 3] = d.color[q * 3];
          colArr[n * 3 + 1] = d.color[q * 3 + 1];
          colArr[n * 3 + 2] = d.color[q * 3 + 2];
          n++;
        }
        counts[k] = n;
      }
    }
    let total = 0;
    for (const k of KINDS) {
      const mesh = this.meshes[k];
      mesh.count = counts[k];
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, counts[k]) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, Math.max(1, counts[k]) * 3);
      mesh.instanceColor.needsUpdate = true;
      total += counts[k];
    }
    this.stats.instances = total;
    this.stats.chunks = this.chunks.size;
  }

  dispose() {
    for (const m of Object.values(this.meshes)) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.group.removeFromParent();
  }
}
