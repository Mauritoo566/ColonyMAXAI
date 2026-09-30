import * as THREE from 'three';
import { RADIUS, MAX_LAND_HEIGHT, elevation, heightFromElevation, terrainZones, zoneDistance } from './elevation.js';
import { FACES, faceDirection, buildChunkData } from './chunkBuilder.js';
import { createTerrainMaterial, setChunkWaveOffset, WAVE_TILE } from './water.js';

// Terreno con nivel de detalle (LOD): la esfera se forma con las 6 caras de un cubo
// y cada cara es un quadtree. Los trozos cercanos a la cámara se dividen en 4 hijos
// más detallados; los lejanos se quedan con pocos polígonos. La geometría de cada
// trozo se calcula en Web Workers (chunkBuilder.js) para no frenar el juego.

const MAX_LEVEL = 15; // en el nivel 15 cada celda mide ~13 m
const DETAIL_MAX_LEVEL = 17; // cerca de un campamento: celdas de ~3 m
const SPLIT_THRESHOLD = 0.6; // tamaño del trozo / distancia a la cámara (celdas de ~20 px)
const MERGE_THRESHOLD = SPLIT_THRESHOLD * 0.8; // histéresis para evitar parpadeos
const BUILD_BUDGET_MS = 5; // sin workers: tiempo máximo por fotograma generando trozos
const JOBS_PER_WORKER = 2; // trozos encargados a la vez a cada worker
const SORT_EVERY_FRAMES = 4; // reordenar la cola no hace falta en cada fotograma

const tmpDir = [0, 0, 0];
// Origen de las olas del agua: la cámara redondeada a múltiplos de WAVE_TILE.
const waveOrigin = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Workers: generan la geometría en segundo plano
// ---------------------------------------------------------------------------

class WorkerPool {
  constructor(onResult, onFailure) {
    this.workers = [];
    this.busy = [];
    this.onResult = onResult;
    this.onFailure = onFailure;
    this.nextId = 1;
    this.jobs = new Map(); // id -> { worker, node }
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => this.finish(e.data);
        worker.onerror = () => this.fail();
        this.workers.push(worker);
        this.busy.push(0);
      }
    } catch {
      this.fail();
    }
  }

  get available() {
    return this.workers.length > 0;
  }

  get capacity() {
    return this.workers.length * JOBS_PER_WORKER - this.jobs.size;
  }

  // Copia las zonas de terreno (campamento) a todos los workers. Los mensajes llegan
  // en orden, así que los trozos encargados después ya usan las zonas nuevas.
  syncZones(zones) {
    const plain = zones.map((z) => ({ ...z, dir: { x: z.dir.x, y: z.dir.y, z: z.dir.z } }));
    for (const w of this.workers) w.postMessage({ type: 'zones', zones: plain });
  }

  submit(node, params, zonesVersion) {
    // El worker con menos trabajo.
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.busy[i] < this.busy[best]) best = i;
    const id = this.nextId++;
    this.busy[best]++;
    this.jobs.set(id, { worker: best, node });
    this.workers[best].postMessage({ type: 'build', id, params, zonesVersion });
  }

  finish(data) {
    const job = this.jobs.get(data.id);
    if (!job) return;
    this.jobs.delete(data.id);
    this.busy[job.worker]--;
    this.onResult(job.node, data);
  }

  // Si los workers no funcionan (navegador antiguo, restricciones), se vuelve a generar
  // en el hilo principal y se devuelven los trabajos pendientes a la cola.
  fail() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.busy = [];
    const pending = [...this.jobs.values()].map((j) => j.node);
    this.jobs.clear();
    this.onFailure(pending);
  }
}

// ---------------------------------------------------------------------------
// Nodos del quadtree
// ---------------------------------------------------------------------------

class Node {
  constructor(faceIndex, level, a, b, size) {
    this.faceIndex = faceIndex;
    this.level = level;
    this.a = a;
    this.b = b;
    this.size = size;
    this.children = null;
    this.mesh = null;
    this.queued = false; // en la cola o encargado a un worker
    this.building = false; // encargado a un worker
    this.disposed = false;

    faceDirection(FACES[faceIndex], a + size / 2, b + size / 2, tmpDir);
    const h = heightFromElevation(elevation(tmpDir[0], tmpDir[1], tmpDir[2], 8));
    this.dir = new THREE.Vector3(tmpDir[0], tmpDir[1], tmpDir[2]).normalize();
    this.center = this.dir.clone().multiplyScalar(RADIUS + h);
    // Longitud aproximada del lado del trozo en metros (una cara del cubo mide ~R·π/2).
    this.worldSize = (size * RADIUS * Math.PI) / 4;
  }

  params() {
    return {
      face: this.faceIndex,
      level: this.level,
      a: this.a,
      b: this.b,
      size: this.size,
      center: [this.center.x, this.center.y, this.center.z],
      worldSize: this.worldSize,
    };
  }

  split() {
    const half = this.size / 2;
    const l = this.level + 1;
    const f = this.faceIndex;
    this.children = [
      new Node(f, l, this.a, this.b, half),
      new Node(f, l, this.a + half, this.b, half),
      new Node(f, l, this.a, this.b + half, half),
      new Node(f, l, this.a + half, this.b + half, half),
    ];
  }

  hideAll() {
    if (this.mesh) this.mesh.visible = false;
    if (this.children) for (const c of this.children) c.hideAll();
  }

  dispose() {
    this.disposed = true;
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.children) for (const c of this.children) c.dispose();
    this.children = null;
  }

  createMesh({ positions, colors, normals, water }, material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aWater', new THREE.BufferAttribute(water, 1));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(this.center);
    mesh.receiveShadow = true; // recibe la sombra de las nubes
    mesh.onBeforeRender = (renderer, scene, camera, geometry, mat) => {
      setChunkWaveOffset(mat, this.center, waveOrigin);
    };
    mesh.visible = false;
    return mesh;
  }
}

// ---------------------------------------------------------------------------
// Terreno
// ---------------------------------------------------------------------------

export class Terrain {
  constructor() {
    this.object = new THREE.Group();
    this.object.name = 'terrain';
    this.material = createTerrainMaterial();
    this.queue = [];
    this.camera = new THREE.Vector3();
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.testSphere = new THREE.Sphere();
    this.useFrustum = false;
    this.horizon = Infinity;
    this.frame = 0;
    this.zonesVersion = 0;

    this.pool = new WorkerPool(
      (node, data) => this.receive(node, data),
      (nodes) => {
        for (const n of nodes) {
          n.building = false;
          n.queued = false;
        }
      },
    );
    this.pool.syncZones(terrainZones());

    // Las 6 caras del cubo se generan al empezar, así siempre hay algo que mostrar.
    this.roots = FACES.map((_, i) => new Node(i, 0, -1, -1, 2));
    for (const root of this.roots) this.install(root, buildChunkData(root.params()));
  }

  // "camera" (opcional) permite no detallar lo que queda fuera de la pantalla.
  update(cameraPosition, camera = null) {
    this.camera.copy(cameraPosition);
    this.useFrustum = !!camera;
    if (camera) {
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection);
    }
    waveOrigin.set(
      Math.round(cameraPosition.x / WAVE_TILE) * WAVE_TILE,
      Math.round(cameraPosition.y / WAVE_TILE) * WAVE_TILE,
      Math.round(cameraPosition.z / WAVE_TILE) * WAVE_TILE,
    );
    const altitude = Math.max(0, cameraPosition.length() - RADIUS);
    // Distancia al horizonte, más la distancia a la que se ve una montaña muy alta.
    this.horizon =
      Math.sqrt(altitude * (2 * RADIUS + altitude)) + Math.sqrt(MAX_LAND_HEIGHT * (2 * RADIUS + MAX_LAND_HEIGHT));

    this.frame++;
    for (const root of this.roots) this.updateNode(root);
    this.processQueue();
  }

  // Nivel máximo de detalle: más alto cerca de las zonas que lo piden (campamento).
  maxLevelFor(node) {
    for (const zone of terrainZones()) {
      if (!zone.detailRadius) continue;
      const d = zoneDistance(zone, node.dir.x, node.dir.y, node.dir.z) - node.worldSize * 0.75;
      if (d < zone.detailRadius) return DETAIL_MAX_LEVEL;
    }
    return MAX_LEVEL;
  }

  // Marca para regenerar los trozos que tocan una zona (al fundar o mover el
  // campamento). Se siguen viendo los viejos hasta que los nuevos estén listos.
  invalidateZone(zone) {
    this.zonesVersion++;
    this.pool.syncZones(terrainZones());
    const reach = zone.flatRadius + zone.blendRadius + 20;
    const visit = (node) => {
      const d = zoneDistance(zone, node.dir.x, node.dir.y, node.dir.z) - node.worldSize * 0.75;
      if (d > reach) return;
      node.stale = true;
      if (node.children) for (const c of node.children) visit(c);
    };
    for (const root of this.roots) visit(root);
  }

  wantsSplit(node) {
    if (node.level >= this.maxLevelFor(node)) return false;
    // Fuera de la pantalla no se crea más detalle (si ya existía, se conserva para no
    // tener que regenerarlo al girar la cámara).
    if (!node.children && this.useFrustum) {
      this.testSphere.center.copy(node.center);
      this.testSphere.radius = node.worldSize * 1.2 + 50;
      if (!this.frustum.intersectsSphere(this.testSphere)) return false;
    }
    const centerDistance = this.camera.distanceTo(node.center);
    if (centerDistance - node.worldSize > this.horizon) return false;
    const distance = Math.max(1, centerDistance - node.worldSize * 0.7);
    const threshold = node.children ? MERGE_THRESHOLD : SPLIT_THRESHOLD;
    return node.worldSize / distance > threshold;
  }

  // Devuelve true si el nodo (o sus hijos) ya se pueden dibujar sin dejar huecos.
  updateNode(node) {
    if (this.wantsSplit(node)) {
      if (!node.children) node.split();
      let ready = true;
      for (const child of node.children) {
        if (!this.updateNode(child)) ready = false;
      }
      if (ready) {
        if (node.mesh) node.mesh.visible = false;
        return true;
      }
      // Mientras los hijos se generan, seguimos mostrando este nodo.
      for (const child of node.children) child.hideAll();
      return this.show(node);
    }

    if (node.children) {
      for (const child of node.children) child.dispose();
      node.children = null;
    }
    return this.show(node);
  }

  show(node) {
    node.wantedFrame = this.frame;
    if (node.mesh) {
      node.mesh.visible = true;
      if (node.stale && !node.queued) this.enqueue(node);
      return true;
    }
    if (!node.queued) this.enqueue(node);
    return false;
  }

  enqueue(node) {
    node.queued = true;
    this.queue.push(node);
  }

  processQueue() {
    if (this.queue.length === 0) return;
    // Fuera los trozos que ya no hacen falta (p. ej. zonas por las que la cámara sólo
    // pasó de camino). Si vuelven a hacer falta se vuelven a pedir.
    this.queue = this.queue.filter((n) => {
      const keep = !n.disposed && n.wantedFrame === this.frame;
      if (!keep) n.queued = false;
      return keep;
    });
    // Primero lo que más se ve: trozos grandes y cercanos (tamaño / distancia al borde).
    if (this.frame % SORT_EVERY_FRAMES === 0 || this.queue.length < 64) {
      const cam = this.camera;
      for (const n of this.queue) {
        n.priority = n.worldSize / Math.max(1, cam.distanceTo(n.center) - n.worldSize * 0.7);
      }
      this.queue.sort((p, q) => q.priority - p.priority);
    }

    if (this.pool.available) {
      // Encargar trabajos a los workers mientras tengan lugar.
      let taken = 0;
      while (taken < this.queue.length && this.pool.capacity > 0) {
        const node = this.queue[taken++];
        if (node.disposed || (node.mesh && !node.stale)) {
          node.queued = false;
          continue;
        }
        node.building = true;
        node.stale = false;
        this.pool.submit(node, node.params(), this.zonesVersion);
      }
      this.queue.splice(0, taken);
      return;
    }

    // Sin workers: generar en el hilo principal con un tope de tiempo por fotograma.
    const start = performance.now();
    while (this.queue.length > 0 && performance.now() - start < BUILD_BUDGET_MS) {
      const node = this.queue.shift();
      node.queued = false;
      if (node.disposed || (node.mesh && !node.stale)) continue;
      node.stale = false;
      this.install(node, buildChunkData(node.params()));
    }
  }

  // Llega la geometría de un worker.
  receive(node, data) {
    node.building = false;
    node.queued = false;
    if (node.disposed) return;
    this.install(node, data);
    // Si mientras tanto cambió una zona (campamento), regenerarlo con los datos nuevos.
    if (data.zonesVersion !== this.zonesVersion) node.stale = true;
  }

  install(node, data) {
    const old = node.mesh;
    const mesh = node.createMesh(data, this.material);
    if (old) {
      // Reemplazo de un trozo desactualizado sin que parpadee.
      mesh.visible = old.visible;
      old.removeFromParent();
      old.geometry.dispose();
    }
    node.mesh = mesh;
    this.object.add(mesh);
  }

  get pending() {
    return this.queue.length + this.pool.jobs.size;
  }
}
