import * as THREE from 'three';
import { Parts, mat } from './modelKit.js';

// TANDA 1. La tanda 2 se pega al final de este mismo archivo.
// Este módulo crea modelos y poses; la simulación pertenece al servidor.
export const MOB_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.9,
  metalness: 0,
  side: THREE.DoubleSide,
});

const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

function box(p, color, x, y, z, w, h, d, rx = 0) {
  p.add(new THREE.BoxGeometry(w, h, d), color, mat(x, y, z, rx));
}

function ico(p, color, x, y, z, w, h, d) {
  p.add(
    new THREE.IcosahedronGeometry(1, 0),
    color,
    mat(x, y, z, 0, 0, 0, w / 2, h / 2, d / 2)
  );
}

// Base en from y punta en to. Diez triángulos por segmento.
function horn(p, color, from, to, radius) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  const length = direction.length();
  if (length <= 0) return;

  const rotation = new THREE.Quaternion().setFromUnitVectors(
    UP, direction.normalize()
  );
  const matrix = new THREE.Matrix4().compose(
    a.clone().add(b).multiplyScalar(0.5),
    rotation,
    new THREE.Vector3(1, 1, 1)
  );
  p.add(new THREE.ConeGeometry(radius, length, 5, 1), color, matrix);
}

function meshFrom(build) {
  const parts = new Parts();
  build(parts);
  const mesh = parts.mesh(MOB_MATERIAL);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function joint(parent, name, position, build) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  if (build) group.add(meshFrom(build));
  parent.add(group);
  return group;
}

function triangleCount(root) {
  let count = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry;
    count += geometry.index
      ? geometry.index.count / 3
      : geometry.getAttribute('position').count / 3;
  });
  return count;
}

function seededPhase(seed) {
  let value = Number(seed) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967296 * Math.PI * 2;
}

function addAntlers(parts, config) {
  const color = config.colors.detail;
  for (const side of [-1, 1]) {
    horn(parts, color,
      [side * 0.06, 0.08, -0.025],
      [side * 0.15, 0.47, -0.06], 0.028);
    horn(parts, color,
      [side * 0.095, 0.23, -0.035],
      [side * 0.24, 0.36, 0.005], 0.018);
    horn(parts, color,
      [side * 0.12, 0.32, -0.045],
      [side * 0.08, 0.43, 0.10], 0.015);
  }
}

/**
 * Suelo Y=0, frente +Z. Cada articulación tiene su propia malla.
 * Construir en el origen; mover root después de completar el modelo.
 */
export function quadruped(config, seed = 1) {
  const root = new THREE.Group();
  root.name = config.id;
  const detail = new THREE.Group();
  detail.name = 'detail';
  root.add(detail);

  const colors = config.colors;
  const [bodyW, bodyH, bodyL] = config.bodySize;
  const body = joint(detail, 'body', [0, config.bodyY, 0], (p) => {
    ico(p, colors.body, 0, 0, 0, bodyW, bodyH, bodyL);
  });

  const head = joint(body, 'head', config.headPosition, (p) => {
    const [w, h, d] = config.headSize;
    box(p, colors.body, 0, 0, 0, w, h, d);
    const [mw, mh, md] = config.muzzleSize;
    box(p, colors.light, 0, -h * 0.18, d / 2 + md * 0.32, mw, mh, md);

    for (const side of [-1, 1]) {
      box(p, colors.dark,
        side * (w / 2 + 0.002), h * 0.13, d * 0.23,
        config.eyeSize * 0.55, config.eyeSize, config.eyeSize);
    }

    const [ew, eh, ed] = config.earSize;
    for (const side of [-1, 1]) {
      const x = side * w * 0.40;
      const y = h / 2 + eh * 0.35;
      const z = -d * 0.18;
      if (config.roundEars) {
        ico(p, colors.body, x, y, z, ew, eh, ed);
      } else {
        box(p, colors.detail, x, y, z, ew, eh, ed, config.earTilt ?? 0);
      }
    }
    if (config.antlers) addAntlers(p, config);
  });

  // Pivotes en hombro/cadera; geometría de las patas hacia abajo.
  const legs = [];
  const hipY = config.hipY;
  const legLength = config.bodyY + hipY;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const side = i % 2 === 0 ? -1 : 1;
    const z = front ? config.frontZ : config.rearZ;
    const width = front
      ? config.legWidth
      : (config.rearLegWidth ?? config.legWidth);
    const leg = joint(
      body,
      front ? `frontLeg${i}` : `rearLeg${i - 2}`,
      [side * config.legX, hipY, z],
      (p) => {
        box(p, colors.detail, 0, -legLength / 2, 0,
          width, legLength, config.legDepth);
      }
    );
    legs.push(leg);
  }

  const tail = joint(body, 'tail', [0, config.tailY, -bodyL * 0.43], (p) => {
    if (config.roundTail) {
      ico(p, colors.light, 0, 0, -config.tailLength * 0.25,
        config.tailWidth, config.tailWidth, config.tailLength);
    } else {
      box(p, colors.detail, 0, 0, -config.tailLength / 2,
        config.tailWidth, config.tailWidth, config.tailLength);
    }
  });

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(detail);
  const dimensions = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const proxy = meshFrom((p) => {
    box(p, colors.body, center.x, center.y, center.z,
      dimensions.x, dimensions.y, dimensions.z);
  });
  proxy.name = 'proxy';
  proxy.visible = false;
  root.add(proxy);

  root.userData = {
    body, head, legs, tail, proxy, detail,
    size: { length: dimensions.z, height: dimensions.y, width: dimensions.x },
    hostile: config.hostile,
    state: 'idle',
    lookYaw: 0,
    phase: seededPhase(seed),
    config,
    rest: {
      bodyY: config.bodyY,
      headRotation: head.rotation.clone(),
      tailRotation: tail.rotation.clone(),
    },
    triangles: { detail: triangleCount(detail), proxy: triangleCount(proxy) },
  };
  return root;
}

/**
 * t en segundos; speed en metros/segundo.
 * Anima articulaciones, nunca desplaza root ni calcula daño.
 * El movimiento se activa con speed; state='attack' activa la pose hostil.
 */
export function animateQuadruped(group, t, speed = 0) {
  const data = group.userData;
  if (!data?.body || !Number.isFinite(t)) return;
  const { body, head, legs, tail, rest, config } = data;
  const velocity = Number.isFinite(speed) ? Math.abs(speed) : 0;
  const moving = velocity > 0.01;
  const attack = data.hostile && data.state === 'attack';
  const strength = clamp(velocity / config.walkSpeed, 0, 1);
  const cycle = t * config.gaitFrequency + data.phase;

  body.position.y = rest.bodyY;
  body.rotation.set(0, 0, 0);
  head.rotation.copy(rest.headRotation);
  tail.rotation.copy(rest.tailRotation);
  for (const leg of legs) leg.rotation.set(0, 0, 0);
  head.rotation.y = clamp(data.lookYaw || 0, -0.65, 0.65);

  if (attack) {
    const pulse = (Math.sin(t * 9 + data.phase) + 1) * 0.5;
    body.rotation.x = 0.10 + pulse * 0.08;
    head.rotation.x = 0.18 + pulse * 0.16;
    legs[0].rotation.x = -0.18;
    legs[1].rotation.x = -0.18;
    legs[2].rotation.x = 0.12;
    legs[3].rotation.x = 0.12;
    tail.rotation.y = Math.sin(t * 8) * 0.10;
    return;
  }

  if (moving) {
    if (config.hopping) {
      const swing = Math.sin(cycle) * 0.55 * strength;
      legs[0].rotation.x = swing;
      legs[1].rotation.x = swing;
      legs[2].rotation.x = -swing;
      legs[3].rotation.x = -swing;
      body.position.y += Math.max(0, Math.sin(cycle)) * 0.045 * strength;
    } else {
      const phases = [0, Math.PI, Math.PI, 0];
      legs.forEach((leg, index) => {
        leg.rotation.x = Math.sin(cycle + phases[index]) * 0.45 * strength;
      });
      body.position.y += Math.sin(cycle * 2) * config.bob * strength;
    }
    body.rotation.z = Math.sin(cycle) * 0.018 * strength;
    head.rotation.x += Math.sin(cycle) * 0.035 * strength;
    tail.rotation.y = Math.sin(cycle * 0.8) * 0.18 * strength;
  } else {
    body.position.y += Math.sin(t * 1.8 + data.phase) * 0.003;
    head.rotation.x += Math.sin(t * 1.2 + data.phase) * 0.025;
    tail.rotation.y = Math.sin(t * 1.4 + data.phase) * 0.055;
  }
}

export function setMobLOD(group, useProxy) {
  group.userData.detail.visible = !useProxy;
  group.userData.proxy.visible = Boolean(useProxy);
}

// La tanda 2 amplía este objeto mediante Object.assign(CONFIG, ...).
const CONFIG = {
  conejo: {
    id: 'conejo', hostile: false,
    colors: { body: '#887866', light: '#b6aa93', detail: '#6b5c50', dark: '#25221f' },
    bodySize: [0.17, 0.17, 0.25], bodyY: 0.13,
    headPosition: [0, 0.035, 0.125], headSize: [0.105, 0.095, 0.10],
    muzzleSize: [0.065, 0.04, 0.045], eyeSize: 0.014,
    earSize: [0.026, 0.095, 0.024], earTilt: -0.12,
    hipY: -0.025, legX: 0.052, frontZ: 0.075, rearZ: -0.073,
    legWidth: 0.027, rearLegWidth: 0.043, legDepth: 0.045,
    tailY: 0, tailLength: 0.06, tailWidth: 0.055, roundTail: true,
    hopping: true, walkSpeed: 0.8, gaitFrequency: 10, bob: 0.008,
  },
  ciervo: {
    id: 'ciervo', hostile: false,
    colors: { body: '#8a6845', light: '#bcaa86', detail: '#554536', dark: '#25231f' },
    bodySize: [0.43, 0.55, 1.05], bodyY: 0.84,
    headPosition: [0, 0.29, 0.52], headSize: [0.21, 0.25, 0.30],
    muzzleSize: [0.15, 0.12, 0.22], eyeSize: 0.035,
    earSize: [0.10, 0.18, 0.055],
    hipY: -0.08, legX: 0.145, frontZ: 0.34, rearZ: -0.34,
    legWidth: 0.066, legDepth: 0.075,
    tailY: 0.05, tailLength: 0.16, tailWidth: 0.065, antlers: true,
    walkSpeed: 1.5, gaitFrequency: 6, bob: 0.012,
  },
  lobo: {
    id: 'lobo', hostile: true,
    colors: { body: '#73756e', light: '#aaa99b', detail: '#4c504a', dark: '#202522' },
    bodySize: [0.33, 0.39, 0.79], bodyY: 0.52,
    headPosition: [0, 0.12, 0.40], headSize: [0.22, 0.22, 0.26],
    muzzleSize: [0.13, 0.11, 0.20], eyeSize: 0.031,
    earSize: [0.065, 0.13, 0.055],
    hipY: -0.065, legX: 0.11, frontZ: 0.25, rearZ: -0.25,
    legWidth: 0.066, legDepth: 0.085,
    tailY: -0.02, tailLength: 0.28, tailWidth: 0.085,
    walkSpeed: 1.8, gaitFrequency: 7, bob: 0.011,
  },
  oso: {
    id: 'oso', hostile: true,
    colors: { body: '#624b39', light: '#957859', detail: '#49382c', dark: '#211e1a' },
    bodySize: [0.79, 0.85, 1.24], bodyY: 0.77,
    headPosition: [0, -0.015, 0.66], headSize: [0.43, 0.39, 0.40],
    muzzleSize: [0.25, 0.18, 0.21], eyeSize: 0.042,
    earSize: [0.13, 0.13, 0.085], roundEars: true,
    hipY: -0.13, legX: 0.255, frontZ: 0.39, rearZ: -0.39,
    legWidth: 0.18, legDepth: 0.21,
    tailY: -0.05, tailLength: 0.09, tailWidth: 0.085,
    walkSpeed: 1.1, gaitFrequency: 4.5, bob: 0.016,
  },
};

export function createMob_conejo(seed = 1) { return quadruped(CONFIG.conejo, seed); }
export function createMob_ciervo(seed = 1) { return quadruped(CONFIG.ciervo, seed); }
export function createMob_lobo(seed = 1) { return quadruped(CONFIG.lobo, seed); }
export function createMob_oso(seed = 1) { return quadruped(CONFIG.oso, seed); }

// Dimensiones nominales. userData.size incluye geometría, astas, orejas y cola.
// Adaptar los identificadores de biomas a los del proyecto.
export const MOBS = {
  conejo: {
    create: createMob_conejo, animate: animateQuadruped,
    size: { length: 0.4, height: 0.25, width: 0.17 },
    biomes: ['pradera', 'bosque'], hostile: false,
  },
  ciervo: {
    create: createMob_ciervo, animate: animateQuadruped,
    size: { length: 1.6, height: 1.3, width: 0.43 },
    biomes: ['bosque', 'pradera'], hostile: false,
  },
  lobo: {
    create: createMob_lobo, animate: animateQuadruped,
    size: { length: 1.2, height: 0.8, width: 0.33 },
    biomes: ['bosque', 'montaña', 'tundra'], hostile: true,
  },
  oso: {
    create: createMob_oso, animate: animateQuadruped,
    size: { length: 1.8, height: 1.2, width: 0.79 },
    biomes: ['bosque', 'montaña'], hostile: true,
  },
};

// Presupuesto previsto: conejo 160, ciervo 212, lobo 152, oso 168.
// Cada proxy tiene 12 triángulos y se muestra en lugar del detalle.

// ------------------------------------------------------------
// TANDA 2: jabalí, oveja salvaje, uro y caballo salvaje.
// Añadir al final de mobs.js.
// ------------------------------------------------------------

// Añade rasgos propios y recalcula medidas, proxy y presupuesto.
function finishMobDetails(group, build) {
  const data = group.userData;

  if (build) {
    data.body.add(meshFrom(build));
  }

  // Calcular dimensiones en coordenadas locales del animal.
  group.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(data.detail);
  const dimensions = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  data.size = {
    length: dimensions.z,
    height: dimensions.y,
    width: dimensions.x,
  };

  // Sustituir el proxy anterior conservando el material compartido.
  const previousProxy = data.proxy;
  const wasVisible = previousProxy.visible;

  group.remove(previousProxy);
  previousProxy.geometry.dispose();

  const proxy = meshFrom((p) => {
    box(
      p,
      data.config.colors.body,
      center.x,
      center.y,
      center.z,
      dimensions.x,
      dimensions.y,
      dimensions.z
    );
  });

  proxy.name = 'proxy';
  proxy.visible = wasVisible;
  group.add(proxy);

  data.proxy = proxy;
  data.triangles = {
    detail: triangleCount(data.detail),
    proxy: triangleCount(proxy),
  };

  return group;
}

Object.assign(CONFIG, {
  jabali: {
    id: 'jabali',
    hostile: false,
    colors: {
      body: '#655747',
      light: '#aa9475',
      detail: '#443b32',
      dark: '#211f1b',
    },

    // Torso compacto y patas cortas.
    bodySize: [0.48, 0.55, 0.91],
    bodyY: 0.49,

    // Cabeza baja y hocico ancho.
    headPosition: [0, -0.02, 0.46],
    headSize: [0.29, 0.29, 0.31],
    muzzleSize: [0.22, 0.16, 0.20],
    eyeSize: 0.034,

    earSize: [0.095, 0.12, 0.055],
    earTilt: -0.30,

    hipY: -0.11,
    legX: 0.16,
    frontZ: 0.28,
    rearZ: -0.28,
    legWidth: 0.085,
    legDepth: 0.095,

    tailY: 0.01,
    tailLength: 0.11,
    tailWidth: 0.025,

    walkSpeed: 1.0,
    gaitFrequency: 6.5,
    bob: 0.008,
  },

  oveja: {
    id: 'oveja',
    hostile: false,
    colors: {
      body: '#aaa18a',
      light: '#c4baa1',
      detail: '#645b4b',
      dark: '#28271f',
    },

    bodySize: [0.48, 0.46, 0.80],
    bodyY: 0.50,

    headPosition: [0, 0.10, 0.40],
    headSize: [0.20, 0.23, 0.23],
    muzzleSize: [0.14, 0.115, 0.14],
    eyeSize: 0.029,

    // Orejas cortas, más anchas que altas.
    earSize: [0.16, 0.055, 0.065],

    hipY: -0.10,
    legX: 0.15,
    frontZ: 0.255,
    rearZ: -0.255,
    legWidth: 0.06,
    legDepth: 0.065,

    tailY: -0.035,
    tailLength: 0.11,
    tailWidth: 0.07,
    roundTail: true,

    walkSpeed: 0.9,
    gaitFrequency: 5.8,
    bob: 0.009,
  },

  uro: {
    id: 'uro',
    hostile: false,
    colors: {
      body: '#625342',
      light: '#ae9b77',
      detail: '#403a30',
      dark: '#211f1b',
    },

    bodySize: [0.76, 0.77, 1.48],
    bodyY: 0.93,

    headPosition: [0, 0.05, 0.79],
    headSize: [0.38, 0.42, 0.40],
    muzzleSize: [0.32, 0.21, 0.23],
    eyeSize: 0.047,

    earSize: [0.20, 0.085, 0.105],

    hipY: -0.13,
    legX: 0.25,
    frontZ: 0.48,
    rearZ: -0.48,
    legWidth: 0.13,
    legDepth: 0.145,

    tailY: 0.04,
    tailLength: 0.34,
    tailWidth: 0.045,

    walkSpeed: 1.1,
    gaitFrequency: 4.6,
    bob: 0.012,
  },

  caballo: {
    id: 'caballo',
    hostile: false,
    colors: {
      body: '#8c7051',
      light: '#bcaa87',
      detail: '#483c30',
      dark: '#24221d',
    },

    bodySize: [0.61, 0.65, 1.39],
    bodyY: 1.00,

    // Cabeza elevada; se conecta al torso mediante el cuello.
    headPosition: [0, 0.37, 0.75],
    headSize: [0.24, 0.33, 0.39],
    muzzleSize: [0.20, 0.17, 0.21],
    eyeSize: 0.041,

    earSize: [0.065, 0.17, 0.075],
    earTilt: -0.12,

    hipY: -0.12,
    legX: 0.20,
    frontZ: 0.44,
    rearZ: -0.44,
    legWidth: 0.095,
    legDepth: 0.105,

    tailY: 0.025,
    tailLength: 0.44,
    tailWidth: 0.105,

    walkSpeed: 1.8,
    gaitFrequency: 6.2,
    bob: 0.014,
  },
});

export function createMob_jabali(seed = 1) {
  const config = CONFIG.jabali;
  const group = quadruped(config, seed);

  // Colmillos discretos: pertenece a la variante pacífica.
  const tusks = meshFrom((p) => {
    for (const side of [-1, 1]) {
      horn(
        p,
        config.colors.light,
        [side * 0.12, -0.08, 0.18],
        [side * 0.155, 0.015, 0.23],
        0.025
      );
    }
  });

  group.userData.head.add(tusks);

  return finishMobDetails(group, (p) => {
    // Cresta oscura del lomo: ayuda a reconocer su silueta.
    box(
      p,
      config.colors.detail,
      0,
      0.235,
      -0.025,
      0.095,
      0.07,
      0.60
    );
  });
}

export function createMob_oveja(seed = 1) {
  const config = CONFIG.oveja;
  const group = quadruped(config, seed);

  return finishMobDetails(group, (p) => {
    // Tres volúmenes de lana, sin esferas suaves ni texturas.
    ico(
      p,
      config.colors.light,
      0,
      0.065,
      0.23,
      0.49,
      0.43,
      0.35
    );

    ico(
      p,
      config.colors.body,
      0,
      0.095,
      0,
      0.54,
      0.46,
      0.38
    );

    ico(
      p,
      config.colors.light,
      0,
      0.055,
      -0.24,
      0.49,
      0.43,
      0.35
    );
  });
}

export function createMob_uro(seed = 1) {
  const config = CONFIG.uro;
  const group = quadruped(config, seed);

  // Cuernos unidos a la cabeza para acompañar sus movimientos.
  group.userData.head.add(
    meshFrom((p) => {
      for (const side of [-1, 1]) {
        horn(
          p,
          config.colors.light,
          [side * 0.15, 0.145, -0.035],
          [side * 0.37, 0.34, 0.06],
          0.052
        );
      }
    })
  );

  return finishMobDetails(group, (p) => {
    // Papada pequeña para diferenciarlo de caballo y ciervo.
    box(
      p,
      config.colors.detail,
      0,
      -0.12,
      0.62,
      0.16,
      0.34,
      0.22
    );
  });
}

export function createMob_caballo(seed = 1) {
  const config = CONFIG.caballo;
  const group = quadruped(config, seed);

  return finishMobDetails(group, (p) => {
    // Cuello inclinado que conecta pecho y cabeza.
    box(
      p,
      config.colors.body,
      0,
      0.20,
      0.55,
      0.29,
      0.64,
      0.32,
      0.40
    );

    // Crin oscura sobre la parte posterior del cuello.
    box(
      p,
      config.colors.detail,
      0,
      0.22,
      0.395,
      0.075,
      0.64,
      0.065,
      0.40
    );
  });
}

Object.assign(MOBS, {
  jabali: {
    create: createMob_jabali,
    animate: animateQuadruped,
    size: {
      length: 1.3,
      height: 0.8,
      width: 0.48,
    },
    biomes: ['bosque', 'pradera'],
    hostile: false,
  },

  oveja: {
    create: createMob_oveja,
    animate: animateQuadruped,
    size: {
      length: 1.2,
      height: 0.8,
      width: 0.54,
    },
    biomes: ['pradera', 'montaña'],
    hostile: false,
  },

  uro: {
    create: createMob_uro,
    animate: animateQuadruped,
    size: {
      length: 2.2,
      height: 1.4,
      width: 0.76,
    },
    biomes: ['pradera', 'bosque'],
    hostile: false,
  },

  caballo: {
    create: createMob_caballo,
    animate: animateQuadruped,
    size: {
      length: 2.3,
      height: 1.6,
      width: 0.61,
    },
    biomes: ['pradera', 'estepa'],
    hostile: false,
  },
});