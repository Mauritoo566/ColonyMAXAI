import * as THREE from 'three';
import { WeatherState, WEATHER } from './sim/weather.js';

// Clima que se ve: el estado (despejado, nublado, lluvia, tormenta) lo decide la
// simulación (sim/weather.js, una por colonia en el servidor); aquí se dibujan las gotas
// alrededor de la cámara. Cada zona tiene su clima: lo que se ve es el de la colonia más
// cercana a lo que se mira (la propia o la de otro jugador), con un cambio suave al pasar
// de una zona a otra. Sin ninguna colonia cerca se inventa uno para el lugar.

export { WEATHER };

const RAIN_DROPS = 2400;
const RAIN_BOX = 45; // metros alrededor de la cámara donde caen gotas
const RAIN_VISIBLE_CLEARANCE = 1_800; // más alto no se ven las gotas
const FOLLOW_RATE = 1.5; // 1/segundos: rapidez con que la lluvia sigue a la de la zona

// Las gotas se animan en la tarjeta gráfica: la geometría no cambia nunca y el sombreador
// calcula dónde está cada gota a partir de cuánto "ha caído" (uFall). Así la lluvia no
// cuesta nada en el procesador ni sube datos a la tarjeta en cada cuadro.
const VERTEX = /* glsl */ `
  uniform float uFall;
  uniform float uBox;
  uniform float uLength;
  uniform float uSlant;
  uniform float uSway;
  attribute float aTop;
  varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    float y = mod(position.y - uFall, uBox);
    // La nieve se mece de un lado a otro mientras cae.
    float sway = sin(uFall * 0.7 + position.z * 0.9 + position.x * 0.5) * uSway;
    vec3 p = vec3(position.x + sway + aTop * uSlant, y + aTop * uLength, position.z + sway * 0.6);
    // La gota se apaga por arriba (estela) y al aparecer/desaparecer en los extremos.
    float edge = smoothstep(0.0, 3.0, y) * (1.0 - smoothstep(uBox - 4.0, uBox, y));
    vAlpha = mix(1.0, 0.25, aTop) * edge;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uColor, uOpacity * vAlpha);
  }
`;

export class WeatherSystem extends WeatherState {
  constructor(scene) {
    super(Date.now());
    this.fall = 0; // metros que han caído las gotas (módulo RAIN_BOX)
    this.density = 1; // 0–1: cuántas gotas se dibujan (baja en equipos lentos)
    this.up = new THREE.Vector3();
    this.yAxis = new THREE.Vector3(0, 1, 0);
    this.rainMesh = this.createRain();
    scene.add(this.rainMesh);
  }

  // gameDt: segundos de juego (sigue la velocidad del tiempo).
  update(gameDt, delta, camera, clearance) {
    this.advance(gameDt);
    this.updateRain(delta, camera, clearance);
  }

  // Sigue el clima de otra colonia (el de su zona) en lugar de decidir uno propio. El
  // estado cambia de golpe, pero la lluvia y las nubes se acercan despacio: al pasar de
  // una zona seca a una lluviosa la lluvia empieza poco a poco.
  follow(other, delta, camera, clearance) {
    const k = 1 - Math.exp(-delta * FOLLOW_RATE);
    this.state = other.state;
    this.snowy = !!other.snowy;
    this.rain += (other.rain - this.rain) * k;
    this.clouds += (other.clouds - this.clouds) * k;
    this.updateRain(delta, camera, clearance);
  }

  // ---- Gotas de lluvia --------------------------------------------------------

  createRain() {
    // Cada gota son dos vértices (abajo y arriba) con la misma posición base.
    const base = new Float32Array(RAIN_DROPS * 6);
    const top = new Float32Array(RAIN_DROPS * 2);
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = (Math.random() - 0.5) * RAIN_BOX * 2;
      const y = Math.random() * RAIN_BOX;
      const z = (Math.random() - 0.5) * RAIN_BOX * 2;
      base.set([x, y, z, x, y, z], i * 6);
      top[i * 2 + 1] = 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(base, 3));
    geometry.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    // Los límites reales cambian con el sombreador: se fijan a mano para que no se descarte.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), RAIN_BOX * 3);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uFall: { value: 0 },
        uBox: { value: RAIN_BOX },
        uLength: { value: 1 },
        uSlant: { value: 0.08 },
        uSway: { value: 0 },
        uColor: { value: new THREE.Color('#aac4dc') },
        uOpacity: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }

  updateRain(delta, camera, clearance) {
    const mesh = this.rainMesh;
    const visible = this.rain > 0.05 && clearance < RAIN_VISIBLE_CLEARANCE;
    mesh.visible = visible;
    if (!visible) return;
    // Caja de gotas alrededor de la cámara, con el "arriba" del planeta en ese punto.
    this.up.copy(camera.position).normalize();
    mesh.position.copy(camera.position).addScaledVector(this.up, -RAIN_BOX * 0.5);
    mesh.quaternion.setFromUnitVectors(this.yAxis, this.up);
    const u = mesh.material.uniforms;
    // Nieve: copos cortos, blancos y lentos, que se mecen; lluvia: rayas rápidas azuladas.
    const snow = this.snowy;
    this.fall = (this.fall + (snow ? 2.6 + this.rain * 1.5 : 22 + this.rain * 10) * delta) % RAIN_BOX;
    u.uFall.value = this.fall;
    u.uLength.value = snow ? 0.16 : 0.7 + this.rain * 0.8;
    u.uSway.value = snow ? 0.55 : 0;
    u.uSlant.value = snow ? 0.02 : 0.08;
    u.uOpacity.value = snow ? 0.55 + this.rain * 0.35 : 0.25 + this.rain * 0.4;
    u.uColor.value.set(snow ? '#f4f8ff' : '#aac4dc');
    const count = Math.floor(RAIN_DROPS * Math.min(1, this.rain * 1.2) * this.density);
    mesh.geometry.setDrawRange(0, count * 2);
  }
}
