// Humo de verdad: bolitas que suben por la chimenea de la cocina, crecen, se desplazan con el aire y se desvanecen. Sale sólo
// mientras la cocina trabaja (hay alguien comiendo o bebiendo dentro) y se apaga poco a poco después, como un fuego de verdad.
// Es un efecto del navegador: lo dibuja cada jugador a partir de lo que ya ve (quién está dentro del edificio), así todos ven lo mismo.
import * as THREE from 'three';

// Dónde está la chimenea en el modelo del comedor (buildingModelsSig.js: diningMark), en metros desde el centro del edificio.
export const CHIMNEY = { x: -1.4, y: 4.4, z: -0.9 };
export const AIR_ORDER = 3.5; // orden de dibujo de lo transparente que flota en el aire (caminos: 2, cuadrícula: 3)
const PUFFS = 9;
const RISE = 6; // metros que sube cada bolita antes de desvanecerse
const SECONDS = 4.2; // lo que tarda una bolita en subir
const UP_RATE = 0.7; // por segundo: la cocina se enciende rápido
const DOWN_RATE = 0.13; // y el fuego tarda en apagarse (unos 8 s)

const geometry = new THREE.IcosahedronGeometry(1, 0);
const smokes = new Set();
let last = null;

const clock = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

// ¿Sigue colgando de la escena? (al quitar un edificio se quita su grupo entero y el humo ya no hay que dibujarlo)
function attached(obj) {
  let p = obj;
  while (p.parent) p = p.parent;
  return p.isScene === true;
}

// Pone una chimenea con humo en "parent" (el modelo o el grupo del edificio, con su posición y giro). intensityOf(): 1 si la
// cocina está encendida, 0 si no.
export function addChimneySmoke(parent, intensityOf) {
  const group = new THREE.Group();
  group.position.set(CHIMNEY.x, CHIMNEY.y, CHIMNEY.z);
  const puffs = [];
  for (let i = 0; i < PUFFS; i++) {
    const puff = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#cfcbc4', transparent: true, depthWrite: false, flatShading: true, opacity: 0 }));
    puff.renderOrder = AIR_ORDER; // después de los caminos: el humo nunca queda por debajo de ellos
    puff.userData.phase = i / PUFFS;
    puff.userData.sway = i * 2.17;
    group.add(puff);
    puffs.push(puff);
  }
  group.visible = false;
  parent.add(group);
  const smoke = { group, puffs, level: 0, intensityOf, t: 0 };
  smokes.add(smoke);
  return smoke;
}

export function removeChimneySmoke(smoke) {
  smoke.group.removeFromParent();
  for (const p of smoke.puffs) p.material.dispose();
  smokes.delete(smoke);
}

// Un paso de todos los humos (una vez por fotograma). "now" en segundos.
export function updateSmokes(now = clock()) {
  const dt = last === null ? 0 : Math.min(0.25, Math.max(0, now - last));
  last = now;
  for (const s of [...smokes]) {
    if (!attached(s.group)) {
      removeChimneySmoke(s);
      continue;
    }
    const target = s.intensityOf() ? 1 : 0;
    s.level += (target - s.level) * Math.min(1, dt * (target > s.level ? UP_RATE : DOWN_RATE) * (target > s.level ? 1 : 1));
    if (target === 0 && s.level < 0.02) s.level = 0;
    s.group.visible = s.level > 0.02;
    if (!s.group.visible) continue;
    s.t += dt;
    for (const puff of s.puffs) {
      const k = (s.t / SECONDS + puff.userData.phase) % 1;
      // Sube, se abre un poco con el aire y se desvía a un lado; al principio es pequeña y densa, al final grande y casi invisible.
      puff.position.set(k * 1.8 + Math.sin(k * 5 + puff.userData.sway) * 0.25, k * RISE, Math.cos(k * 4 + puff.userData.sway) * 0.2);
      puff.scale.setScalar(0.22 + k * 0.85);
      puff.material.opacity = 0.55 * s.level * (1 - k) * Math.min(1, k * 6);
    }
  }
}

// Para las pruebas.
export const smokeCount = () => smokes.size;
