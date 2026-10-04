// Llamas de las antorchas: una llama que titila, un halo y, de noche, luz de verdad. Las luces cuestan al dibujar todo el mundo, así que
// sólo las antorchas más cercanas a la cámara tienen luz a la vez (un puñado de luces que se reparten entre ellas); las demás sólo
// muestran su llama y su halo. Es un efecto del navegador a partir de los edificios que ya se ven: todos los jugadores ven lo mismo.
import * as THREE from 'three';

const LIGHTS = 4; // luces reales a la vez
const LIGHT_RANGE = 120; // metros: más lejos que esto una antorcha no gasta luz
const outerGeometry = new THREE.ConeGeometry(0.12, 0.46, 6);
const innerGeometry = new THREE.ConeGeometry(0.065, 0.3, 6);
const torches = new Set();
const pool = [];
let glow = null;
let last = null;

const clock = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

// Textura del halo (un degradado redondo); sin pantalla (pruebas en el servidor) no hay textura y se dibuja liso.
function glowTexture() {
  if (glow !== null) return glow || undefined;
  if (typeof document === 'undefined') return (glow = false) || undefined;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,200,110,0.9)');
  grad.addColorStop(0.35, 'rgba(255,150,60,0.35)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}

// Las luces del conjunto: se añaden a la escena una sola vez.
export function initTorchLights(scene) {
  if (pool.length) return;
  for (let i = 0; i < LIGHTS; i++) {
    const light = new THREE.PointLight('#ffae5e', 0, 34, 2);
    light.visible = false;
    scene.add(light);
    pool.push(light);
  }
}

function attached(obj) {
  let p = obj;
  while (p.parent) p = p.parent;
  return p.isScene === true;
}

// Pone una llama en "parent" (el grupo del edificio) a la altura y sobre el suelo. isLit(): true si la antorcha está terminada.
export function addTorchFlame(parent, y, isLit = () => true) {
  const group = new THREE.Group();
  group.position.set(0, y, 0);
  const outer = new THREE.Mesh(outerGeometry, new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.92, depthWrite: false }));
  const inner = new THREE.Mesh(innerGeometry, new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.95, depthWrite: false }));
  outer.position.y = 0.2;
  inner.position.y = 0.14;
  const haloParams = { color: '#ffb060', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending };
  const map = glowTexture();
  if (map) haloParams.map = map; // sin pantalla (pruebas) no hay textura
  const halo = new THREE.Sprite(new THREE.SpriteMaterial(haloParams));
  halo.position.y = 0.22;
  group.add(outer, inner, halo);
  group.visible = false;
  parent.add(group);
  const torch = { group, outer, inner, halo, isLit, phase: Math.random() * 100, flick: 1, pos: new THREE.Vector3() };
  torches.add(torch);
  return torch;
}

export function removeTorchFlame(torch) {
  torch.group.removeFromParent();
  for (const m of [torch.outer, torch.inner, torch.halo]) m.material.dispose();
  torches.delete(torch);
}

// Un paso de todas las llamas (una vez por fotograma). night: 0 (día) a 1 (noche cerrada). camera: de dónde se mira.
export function updateTorches(now = clock(), camera = null, night = 0) {
  const dt = last === null ? 0 : Math.min(0.25, Math.max(0, now - last));
  last = now;
  const lit = [];
  for (const t of [...torches]) {
    if (!attached(t.group)) {
      removeTorchFlame(t);
      continue;
    }
    const on = !!t.isLit();
    t.group.visible = on;
    if (!on) continue;
    // Titileo: dos ondas mezcladas (la llama sube y baja, se ensancha y se inclina un poco).
    const f = 1 + Math.sin(now * 12 + t.phase) * 0.12 + Math.sin(now * 7.3 + t.phase * 1.7) * 0.08;
    t.flick = f;
    t.outer.scale.set(1 + (f - 1) * 0.5, f, 1 + (f - 1) * 0.5);
    t.inner.scale.set(1, 1 + (f - 1) * 1.3, 1);
    t.outer.rotation.z = Math.sin(now * 5 + t.phase) * 0.08;
    // El halo se nota sobre todo al oscurecer.
    t.halo.material.opacity = (0.22 + 0.7 * night) * (0.85 + (f - 1) * 1.5);
    t.halo.scale.setScalar(0.8 + 1.6 * night + (f - 1) * 0.5);
    t.group.getWorldPosition(t.pos);
    lit.push(t);
  }
  // Luces reales: las más cercanas a la cámara, y sólo de noche.
  if (!pool.length) return;
  const near = [];
  if (night > 0.02 && camera) {
    for (const t of lit) {
      const d = t.pos.distanceTo(camera.position);
      if (d < LIGHT_RANGE) near.push([d, t]);
    }
    near.sort((a, b) => a[0] - b[0]);
  }
  pool.forEach((light, i) => {
    const pick = near[i];
    if (!pick) {
      light.visible = false;
      light.intensity = 0;
      return;
    }
    const [d, t] = pick;
    light.visible = true;
    light.position.copy(t.pos);
    light.position.y += 0;
    // Se apaga suave al alejarse (que no "salten" luces al mover la cámara).
    const fade = Math.min(1, Math.max(0, (LIGHT_RANGE - d) / 30));
    light.intensity = 26 * night * t.flick * fade;
  });
  void dt;
}

// Para las pruebas.
export const torchCount = () => torches.size;
export const torchLights = () => pool;
