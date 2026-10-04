// Los difuntos que se ven (la simulación está en sim/cemetery.js): cuerpos tirados en el suelo o dejados lejos, el que lleva el enterrador a cuestas, las
// tumbas ocupadas del cementerio (montículo y cruz), los jarrones de la estantería, el jarrón que lleva un familiar y los que descansan en una casa. Todo sale de la lista de
// difuntos que manda el servidor (colony.dead), así que el navegador sólo dibuja lo que de verdad hay.
import * as THREE from 'three';
import { RADIUS } from './elevation.js';
import { mat } from './modelKit.js';
import { buildMesh, material } from './buildingModels.js';
import { plotLocal, nicheLocal } from './sim/cemetery.js';

// Un cuerpo tendido boca arriba (la cabeza hacia +z), con los colores de su ropa, piel y pelo.
function bodyModel(look) {
  const L = look ?? { skin: '#d8a984', hair: '#3a2a1e', shirt: '#8a6a4a', pants: '#5a4a3a' };
  return buildMesh((p) => {
    p.add(new THREE.BoxGeometry(0.5, 0.22, 0.62), L.shirt, mat(0, 0.14, 0));
    p.add(new THREE.SphereGeometry(0.16, 8, 6), L.skin, mat(0, 0.16, 0.46));
    p.add(new THREE.SphereGeometry(0.17, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), L.hair, mat(0, 0.2, 0.45));
    for (const x of [-0.12, 0.12]) p.add(new THREE.BoxGeometry(0.2, 0.18, 0.72), L.pants, mat(x, 0.1, -0.64));
    for (const x of [-0.36, 0.36]) p.add(new THREE.BoxGeometry(0.12, 0.14, 0.55), L.skin, mat(x, 0.1, 0.04));
  });
}

// Un jarrón de barro con tapa.
function urnModel() {
  return buildMesh((p) => {
    p.add(new THREE.CylinderGeometry(0.17, 0.12, 0.34, 8), '#b0603a', mat(0, 0.17, 0));
    p.add(new THREE.CylinderGeometry(0.1, 0.17, 0.12, 8), '#b0603a', mat(0, 0.4, 0));
    p.add(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 8), '#8a4a2a', mat(0, 0.49, 0));
    p.add(new THREE.SphereGeometry(0.05, 6, 4), '#8a4a2a', mat(0, 0.53, 0));
  });
}

// Una tumba ocupada: montículo de tierra y una cruz de madera.
function graveModel() {
  return buildMesh((p) => {
    p.add(new THREE.SphereGeometry(0.5, 8, 5), '#6b5436', mat(0, 0.1, 0.05, 0, 0, 0, 0.95, 0.3, 0.62));
    p.add(new THREE.BoxGeometry(0.07, 0.62, 0.07), '#8a643c', mat(0, 0.4, -0.25));
    p.add(new THREE.BoxGeometry(0.34, 0.07, 0.07), '#8a643c', mat(0, 0.58, -0.25));
  });
}

const STAND = { x: 1.15, z: 2.3 }; // dónde se ponen los jarrones junto a la puerta de una casa (coordenadas del modelo)

export class DeadView {
  // { scene, sim, buildings (BuildingSystem: entries), colonyView (entries de colonos) }
  constructor({ scene, sim, buildings, colonyView }) {
    this.sim = sim;
    this.buildings = buildings;
    this.colonyView = colonyView;
    this.group = new THREE.Group();
    this.group.name = 'dead';
    scene.add(this.group);
    this.items = new Map(); // id -> { key, object, parent, follow }
    this.tmp = { world: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), q: new THREE.Quaternion() };
  }

  entryObject(id) {
    return id == null ? null : this.buildings?.entries?.get(id)?.object ?? null;
  }

  remove(item) {
    item.object.removeFromParent();
    this.items.delete(item.id);
  }

  // Pone los modelos al día con la lista de difuntos (sólo rehace los que cambiaron).
  sync() {
    const sim = this.sim;
    if (!sim.camp) return;
    const seen = new Set();
    const homeCount = new Map();
    for (const rec of sim.dead ?? []) {
      seen.add(rec.id);
      let parent = this.group;
      let key = `${rec.state}`;
      let build;
      if (rec.state === 'ground' || rec.state === 'abandoned') {
        key += `:${rec.x}:${rec.z}`;
        build = () => {
          const m = bodyModel(rec.look);
          this.placeOnGround(m, rec.x, rec.z, 0.04, ((rec.id * 2.399) % (Math.PI * 2)));
          return m;
        };
      } else if (rec.state === 'carried') {
        build = () => bodyModel(rec.look);
        key += `:${rec.carrier}`;
      } else if (rec.state === 'fetched') {
        build = () => urnModel();
        key += `:${rec.carrier}`;
      } else if (rec.state === 'grave' || rec.state === 'shelf' || rec.state === 'home') {
        const id = rec.state === 'home' ? rec.home : rec.bid;
        parent = this.entryObject(id);
        key += `:${id}:${rec.plot}:${rec.niche}:${parent ? 1 : 0}`;
        if (!parent) {
          const old = this.items.get(rec.id);
          if (old) this.remove(old);
          continue;
        }
        if (rec.state === 'grave') {
          build = () => {
            const m = graveModel();
            const q = plotLocal(rec.plot ?? 0);
            m.position.set(q.x, 0.06, q.z);
            return m;
          };
        } else if (rec.state === 'shelf') {
          build = () => {
            const m = urnModel();
            const q = nicheLocal(rec.niche ?? 0);
            m.position.set(q.x, q.y - 0.2, -3.22);
            return m;
          };
        } else {
          const k = homeCount.get(id) ?? 0;
          homeCount.set(id, k + 1);
          key += `:${k}`;
          build = () => {
            const m = urnModel();
            m.position.set(-STAND.x + k * 0.55, 0.0, STAND.z);
            return m;
          };
        }
      }
      const old = this.items.get(rec.id);
      if (old && old.key === key && old.parent === parent) continue;
      if (old) this.remove(old);
      const object = build();
      parent.add(object);
      this.items.set(rec.id, { id: rec.id, key, object, parent, rec, follow: rec.state === 'carried' || rec.state === 'fetched' ? rec.state : null });
    }
    for (const item of [...this.items.values()]) if (!seen.has(item.id)) this.remove(item);
  }

  // Un objeto sobre el suelo en (x, z) del campamento, a la altura del terreno, girado "yaw".
  placeOnGround(object, x, z, lift, yaw) {
    const sim = this.sim;
    const { world, q } = this.tmp;
    sim.toDirection(x, z, world);
    object.position.copy(world).multiplyScalar(RADIUS + sim.heightAt(x, z) + lift);
    object.quaternion.copy(sim.camp.quaternion).multiply(q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
  }

  // Cada fotograma: lo que alguien lleva va con él (el cuerpo a cuestas, el jarrón en las manos).
  update() {
    const { up, fwd } = this.tmp;
    for (const item of this.items.values()) {
      if (!item.follow) continue;
      const rec = this.sim.dead.find((r) => r.id === item.id) ?? item.rec;
      const carrier = this.colonyView?.entries?.get(rec.carrier)?.object;
      item.object.visible = !!carrier;
      if (!carrier) continue;
      up.copy(carrier.position).normalize();
      item.object.quaternion.copy(carrier.quaternion);
      fwd.set(0, 0, 1).applyQuaternion(carrier.quaternion);
      if (item.follow === 'carried') item.object.position.copy(carrier.position).addScaledVector(up, 1.32).addScaledVector(fwd, 0.05);
      else item.object.position.copy(carrier.position).addScaledVector(up, 0.95).addScaledVector(fwd, 0.38);
    }
  }

  dispose() {
    for (const item of [...this.items.values()]) this.remove(item);
    this.group.removeFromParent();
  }
}

