import * as THREE from 'three';
import { RADIUS, surfaceHeight } from './elevation.js';

const MIN_CLEARANCE = 25; // metros mínimos sobre el suelo
const MAX_ALTITUDE = RADIUS * 4;
const MAX_LAT = THREE.MathUtils.degToRad(89);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MAX_TILT = THREE.MathUtils.degToRad(62); // vista de estrategia cerca del suelo
const FLIGHT_MIN_SECONDS = 1.5;
const FLIGHT_MAX_SECONDS = 10;

// 0 = mirando desde el espacio, 1 = a ras de suelo.
function lowness(clearance) {
  return 1 - THREE.MathUtils.smoothstep(Math.log10(clearance), Math.log10(1_500), Math.log10(600_000));
}

function tiltFor(clearance) {
  return MAX_TILT * lowness(clearance);
}

// Cámara de "globo terráqueo": arrastrar mueve el punto de interés sobre la superficie,
// la rueda (o pellizcar) cambia la altitud de forma exponencial para poder pasar de
// miles de kilómetros a unos pocos metros, y cerca del suelo la cámara se inclina
// sola hacia el horizonte.
export class PlanetControls {
  constructor(camera, element) {
    this.camera = camera;
    this.element = element;

    this.lat = THREE.MathUtils.degToRad(10);
    this.lon = THREE.MathUtils.degToRad(0);
    this.altitude = RADIUS * 2.2;
    this.heading = 0;
    this.target = { lat: this.lat, lon: this.lon, altitude: this.altitude, heading: this.heading };
    this.groundHeight = 0;
    this.lowness = 0; // 0 = mirando desde el espacio, 1 = a ras de suelo

    this.flight = null; // vuelo animado en curso (flyTo)
    this.pointers = new Map();
    this.pinch = null;

    this.dir = new THREE.Vector3();
    this.east = new THREE.Vector3();
    this.north = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.look = new THREE.Vector3();

    element.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    element.addEventListener('pointermove', (e) => this.onPointerMove(e));
    element.addEventListener('pointerup', (e) => this.onPointerUp(e));
    element.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    element.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Metros de superficie que ocupa un píxel a la altitud actual.
  metersPerPixel() {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const height = Math.max(1, this.target.altitude - this.groundHeight);
    return (2 * height * Math.tan(fov / 2)) / this.element.clientHeight;
  }

  pan(dx, dy) {
    this.cancelFlight();
    const angle = this.metersPerPixel() / RADIUS;
    const forward = dy * angle;
    const right = -dx * angle;
    const h = this.target.heading;
    const dNorth = forward * Math.cos(h) - right * Math.sin(h);
    const dEast = forward * Math.sin(h) + right * Math.cos(h);
    this.target.lat = THREE.MathUtils.clamp(this.target.lat + dNorth, -MAX_LAT, MAX_LAT);
    this.target.lon += dEast / Math.max(0.05, Math.cos(this.target.lat));
  }

  zoom(factor) {
    this.cancelFlight();
    const ground = this.groundHeight + MIN_CLEARANCE;
    // Se escala la altura sobre el suelo, no sobre el nivel del mar.
    const above = Math.max(1, this.target.altitude - ground) * factor;
    this.target.altitude = THREE.MathUtils.clamp(ground + above, ground, MAX_ALTITUDE);
  }

  // Vuela hasta mirar un punto de la superficie desde "clearance" metros de altura.
  // Como cerca del suelo la cámara va inclinada, termina un poco por detrás del punto
  // para que quede en el centro de la pantalla. El vuelo sube más cuanto más lejos
  // está el destino y dura más (entre FLIGHT_MIN_SECONDS y FLIGHT_MAX_SECONDS).
  flyTo(targetDir, clearance) {
    const lat = Math.asin(THREE.MathUtils.clamp(targetDir.y, -1, 1));
    const lon = Math.atan2(targetDir.x, targetDir.z);
    const back = clearance * Math.tan(tiltFor(clearance));
    const h = this.target.heading;
    const endLat = THREE.MathUtils.clamp(lat - (back * Math.cos(h)) / RADIUS, -MAX_LAT, MAX_LAT);
    const endLon = lon - (back * Math.sin(h)) / RADIUS / Math.max(0.05, Math.cos(lat));

    const start = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - this.lat, this.lon);
    const end = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - endLat, endLon);
    const startClearance = Math.max(MIN_CLEARANCE, this.altitude - this.groundHeight);
    const distance = start.angleTo(end) * RADIUS;
    const logStart = Math.log(startClearance);
    const logEnd = Math.log(clearance);
    // Altura máxima del vuelo: para ir lejos hay que subir para ver el camino.
    // Sólo se sube si esa altura supera la de partida y la de llegada; si no, el vuelo
    // baja (o sube) directamente sin pasarse.
    const peak = distance * 0.45;
    const bump = peak > Math.max(startClearance, clearance) ? Math.log(peak) - Math.max(logStart, logEnd) : 0;
    const duration = THREE.MathUtils.clamp(
      1.2 + 1.1 * Math.log(1 + distance / 2_000) + 0.35 * Math.abs(logStart - logEnd),
      FLIGHT_MIN_SECONDS,
      FLIGHT_MAX_SECONDS,
    );
    this.flight = {
      start,
      rotation: new THREE.Quaternion().setFromUnitVectors(start, end),
      logStart,
      logEnd,
      bump,
      duration,
      time: 0,
      dir: new THREE.Vector3(),
      partial: new THREE.Quaternion(),
    };
  }

  // El jugador toma el control: la cámara se queda donde está.
  cancelFlight() {
    if (!this.flight) return;
    this.flight = null;
    this.target.lat = this.lat;
    this.target.lon = this.lon;
    this.target.altitude = this.altitude;
  }

  updateFlight(delta) {
    const f = this.flight;
    f.time += delta;
    const t = Math.min(1, f.time / f.duration);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * t); // acelera y frena suavemente
    // Recorrido por la superficie siguiendo la curvatura del planeta.
    f.partial.identity().slerp(f.rotation, e);
    f.dir.copy(f.start).applyQuaternion(f.partial);
    this.lat = Math.asin(THREE.MathUtils.clamp(f.dir.y, -1, 1));
    this.lon = Math.atan2(f.dir.x, f.dir.z);
    this.groundHeight = surfaceHeight(f.dir);
    // Altura en escala logarítmica, con una "joroba" en el medio del viaje.
    const clearance = Math.exp(f.logStart + (f.logEnd - f.logStart) * e + f.bump * Math.sin(Math.PI * e));
    this.altitude = this.groundHeight + Math.max(MIN_CLEARANCE, clearance);
    this.target.lat = this.lat;
    this.target.lon = this.lon;
    this.target.altitude = this.altitude;
    if (t >= 1) this.flight = null;
  }

  onPointerDown(e) {
    this.element.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    this.pinch = null;
  }

  onPointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (this.pinch) {
        this.cancelFlight();
        this.zoom(this.pinch.distance / Math.max(1, distance));
        this.target.heading -= angle - this.pinch.angle;
      }
      this.pinch = { distance, angle };
      return;
    }

    if (p.button === 2 || p.shift) {
      this.cancelFlight();
      this.target.heading -= dx * 0.005; // botón derecho: girar la vista
    } else {
      this.pan(dx, dy);
    }
  }

  onPointerUp(e) {
    this.pointers.delete(e.pointerId);
    this.pinch = null;
  }

  onWheel(e) {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.zoom(Math.exp(delta * 0.0015));
  }

  update(delta) {
    if (this.flight) {
      this.updateFlight(delta);
      this.heading += (this.target.heading - this.heading) * (1 - Math.exp(-delta * 8));
      this.placeCamera();
      return;
    }
    const k = 1 - Math.exp(-delta * 8);
    const t = this.target;

    this.dir.setFromSphericalCoords(1, Math.PI / 2 - this.lat, this.lon);
    this.groundHeight = surfaceHeight(this.dir);
    const minAltitude = this.groundHeight + MIN_CLEARANCE;
    // Si el terreno bajo la cámara es más alto que la altura deseada, se sube sólo
    // mientras dure (no se cambia el objetivo): al pasar una montaña vuelve a bajar.
    const targetAltitude = Math.max(t.altitude, minAltitude);

    this.lat += (t.lat - this.lat) * k;
    this.lon += (t.lon - this.lon) * k;
    this.heading += (t.heading - this.heading) * k;
    // La altitud se suaviza en escala logarítmica para que el zoom sea igual de fluido
    // a 10.000 km que a 100 m.
    const cur = Math.log(Math.max(1, this.altitude - minAltitude + 1));
    const tar = Math.log(Math.max(1, targetAltitude - minAltitude + 1));
    this.altitude = minAltitude - 1 + Math.exp(cur + (tar - cur) * k);

    this.placeCamera();
  }

  placeCamera() {
    const { camera, dir, east, north, forward, look } = this;
    dir.setFromSphericalCoords(1, Math.PI / 2 - this.lat, this.lon);
    east.crossVectors(WORLD_UP, dir).normalize();
    north.crossVectors(dir, east);
    forward.copy(north).multiplyScalar(Math.cos(this.heading)).addScaledVector(east, Math.sin(this.heading));

    // Inclinación: mirando hacia abajo desde el espacio, casi al horizonte cerca del suelo.
    const clearance = Math.max(1, this.altitude - this.groundHeight);
    this.lowness = lowness(clearance);
    const tilt = tiltFor(clearance);

    camera.position.copy(dir).multiplyScalar(RADIUS + this.altitude);
    look.copy(dir).multiplyScalar(-Math.cos(tilt)).addScaledVector(forward, Math.sin(tilt));
    camera.up.copy(dir).multiplyScalar(Math.sin(tilt)).addScaledVector(forward, Math.cos(tilt)).normalize();
    camera.lookAt(look.add(camera.position));
  }
}
