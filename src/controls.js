import * as THREE from 'three';
import { RADIUS, surfaceHeight } from './elevation.js';

const MIN_CLEARANCE = 25; // metros mínimos sobre el suelo
const MAX_ALTITUDE = RADIUS * 4;
const MAX_LAT = THREE.MathUtils.degToRad(89);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MAX_TILT = THREE.MathUtils.degToRad(62); // vista de estrategia cerca del suelo
const MAX_LOOK_UP = THREE.MathUtils.degToRad(80); // cuánto se puede levantar la mirada
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
    this.lookUp = 0; // mirada levantada por el jugador (radianes)
    this.target = { lat: this.lat, lon: this.lon, altitude: this.altitude, heading: this.heading, lookUp: 0 };
    this.groundHeight = 0;
    this.lowness = 0; // 0 = mirando desde el espacio, 1 = a ras de suelo

    this.flight = null; // vuelo animado en curso (flyTo)
    this.follow = null; // función que devuelve la dirección de lo que se sigue (o null)
    this.onFollowEnd = null;
    this.viewClearance = null; // altura para la inclinación durante un vuelo
    this.pointers = new Map();
    this.pinch = null;

    this.dir = new THREE.Vector3();
    this.east = new THREE.Vector3();
    this.north = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();
    this.lookQuat = new THREE.Quaternion();

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
    this.stopFollow();
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
    const oldAltitude = this.target.altitude;
    const above = Math.max(1, this.target.altitude - ground) * factor;
    this.target.altitude = THREE.MathUtils.clamp(ground + above, ground, MAX_ALTITUDE);

    // Cerca del suelo la cámara va inclinada: al cambiar la altura también cambia la
    // inclinación y el punto del centro de la pantalla se desplazaría. Se mueve la
    // cámara hacia delante o hacia atrás para que el zoom vaya hacia lo que se mira.
    const oldC = Math.max(1, oldAltitude - this.groundHeight);
    const newC = Math.max(1, this.target.altitude - this.groundHeight);
    if (oldC < 200_000 && newC < 200_000 && this.target.lookUp < 0.05) {
      const ahead = (c) => c * Math.tan(tiltFor(c));
      const shift = ahead(oldC) - ahead(newC);
      const h = this.target.heading;
      this.target.lat = THREE.MathUtils.clamp(this.target.lat + (shift * Math.cos(h)) / RADIUS, -MAX_LAT, MAX_LAT);
      this.target.lon += (shift * Math.sin(h)) / RADIUS / Math.max(0.05, Math.cos(this.target.lat));
    }
  }

  // Vuela hasta mirar un punto de la superficie desde "clearance" metros de altura.
  // Como cerca del suelo la cámara va inclinada, termina un poco por detrás del punto
  // para que quede en el centro de la pantalla. El vuelo sube más cuanto más lejos
  // está el destino y dura más (entre FLIGHT_MIN_SECONDS y FLIGHT_MAX_SECONDS).
  flyTo(targetDir, clearance) {
    const lat = Math.asin(THREE.MathUtils.clamp(targetDir.y, -1, 1));
    const lon = Math.atan2(targetDir.x, targetDir.z);
    const back = clearance * Math.tan(tiltFor(clearance));
    // Terminar del lado por el que se llega, mirando en la dirección del viaje: así la
    // cámara no pasa por encima del destino ni tiene que darse la vuelta al final.
    const here = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - this.lat, this.lon);
    const goal = targetDir.clone().normalize();
    if (here.angleTo(goal) * RADIUS > back * 3) {
      const gEast = new THREE.Vector3().crossVectors(WORLD_UP, goal).normalize();
      const gNorth = new THREE.Vector3().crossVectors(goal, gEast);
      const travel = goal.clone().sub(here); // desde aquí hacia el destino
      const bearing = Math.atan2(travel.dot(gEast), travel.dot(gNorth));
      // El ángulo equivalente más cercano al actual, para girar lo mínimo.
      this.target.heading =
        this.heading + THREE.MathUtils.euclideanModulo(bearing - this.heading + Math.PI, Math.PI * 2) - Math.PI;
    }
    const h = this.target.heading;
    const endLat = THREE.MathUtils.clamp(lat - (back * Math.cos(h)) / RADIUS, -MAX_LAT, MAX_LAT);
    const endLon = lon - (back * Math.sin(h)) / RADIUS / Math.max(0.05, Math.cos(lat));

    const start = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - this.lat, this.lon);
    const end = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - endLat, endLon);
    const rotation = new THREE.Quaternion().setFromUnitVectors(start, end);
    const distance = start.angleTo(end) * RADIUS;

    // La trayectoria se calcula en altura absoluta (sobre el nivel del mar) para que la
    // cámara no copie los altibajos del terreno. Se mide el terreno a lo largo de la
    // ruta para que el vuelo pase siempre por encima de las montañas del camino.
    const groundStart = Math.max(0, this.groundHeight);
    const groundEnd = Math.max(0, surfaceHeight(end));
    const altStart = Math.max(this.altitude, groundStart + MIN_CLEARANCE);
    const altEnd = groundEnd + clearance;
    const samples = 48;
    const dir = new THREE.Vector3();
    const partial = new THREE.Quaternion();
    const grounds = [];
    let base = Math.min(groundStart, groundEnd);
    for (let i = 0; i <= samples; i++) {
      partial.identity().slerp(rotation, i / samples);
      dir.copy(start).applyQuaternion(partial);
      const g = Math.max(0, surfaceHeight(dir, 12));
      grounds.push(g);
      base = Math.min(base, g);
    }
    base -= 50; // la escala logarítmica mide la altura sobre este nivel
    const L = (altitude) => Math.log(Math.max(1, altitude - base));
    const logStart = L(altStart);
    const logEnd = L(altEnd);
    const line = (e) => logStart + (logEnd - logStart) * e;

    // "Joroba" del vuelo: lo que haga falta para librar el terreno (con margen) y, si el
    // destino está lejos, para subir y ver el camino.
    // Sólo se mira la parte central del vuelo: cerca de los extremos la joroba es casi
    // nula y el mínimo de seguridad de updateFlight() evita atravesar el suelo.
    let bump = 0;
    let maxGround = 0;
    for (let i = 1; i < samples; i++) {
      const e = i / samples;
      maxGround = Math.max(maxGround, grounds[i]);
      if (e < 0.15 || e > 0.85) continue;
      const margin = 150 + 0.02 * Math.min(i, samples - i) * (distance / samples);
      bump = Math.max(bump, (L(grounds[i] + margin) - line(e)) / Math.sin(Math.PI * e));
    }
    const cruise = (groundStart + groundEnd) / 2 + distance * 0.45;
    if (cruise > Math.max(altStart, altEnd)) bump = Math.max(bump, L(cruise) - Math.max(logStart, logEnd));
    // Tope: nunca más alto que lo necesario para ver el camino o librar el terreno.
    const ceiling = Math.max(altStart, altEnd, cruise, maxGround + 2_000);
    bump = Math.min(bump, Math.max(0, L(ceiling) - Math.max(logStart, logEnd)) + 0.2);

    const duration = THREE.MathUtils.clamp(
      1.2 + 1.1 * Math.log(1 + distance / 2_000) + 0.35 * Math.abs(Math.log(altStart - groundStart + 1) - Math.log(clearance)),
      FLIGHT_MIN_SECONDS,
      FLIGHT_MAX_SECONDS,
    );
    this.target.lookUp = 0; // el vuelo termina con la vista normal
    this.flight = {
      startHeading: this.heading,
      // Punto que la cámara mira durante todo el vuelo (el destino, sobre el suelo).
      focus: targetDir.clone().normalize().multiplyScalar(RADIUS + Math.max(0, surfaceHeight(targetDir))),
      start,
      rotation,
      base,
      line,
      bump,
      groundStart,
      groundEnd,
      duration,
      time: 0,
      dir: new THREE.Vector3(),
      partial: new THREE.Quaternion(),
    };
  }

  // Seguir algo que se mueve (un colono): la cámara lo mantiene en el centro. Se deja
  // de seguir al arrastrar el mapa.
  startFollow(getDirection) {
    this.follow = getDirection;
  }

  stopFollow() {
    if (!this.follow) return;
    this.follow = null;
    this.onFollowEnd?.();
  }

  // Coloca el objetivo de la cámara para que un punto quede en el centro de la pantalla.
  aimAt(dir) {
    const clearance = Math.max(1, this.target.altitude - this.groundHeight);
    const lat = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    const lon = Math.atan2(dir.x, dir.z);
    const back = clearance * Math.tan(tiltFor(clearance));
    const h = this.target.heading;
    this.target.lat = THREE.MathUtils.clamp(lat - (back * Math.cos(h)) / RADIUS, -MAX_LAT, MAX_LAT);
    const tLon = lon - (back * Math.sin(h)) / RADIUS / Math.max(0.05, Math.cos(lat));
    this.target.lon = this.lon + THREE.MathUtils.euclideanModulo(tLon - this.lon + Math.PI, Math.PI * 2) - Math.PI;
  }

  // El jugador toma el control: la cámara se queda donde está.
  cancelFlight() {
    if (!this.flight) return;
    this.flight = null;
    this.viewClearance = null;
    this.target.lat = this.lat;
    this.target.lon = this.lon;
    this.target.altitude = this.altitude;
  }

  updateFlight(delta) {
    const f = this.flight;
    f.time += delta;
    const t = Math.min(1, f.time / f.duration);
    const e = t * t * t * (t * (t * 6 - 15) + 10); // arranca y frena muy suave
    // Recorrido por la superficie siguiendo la curvatura del planeta.
    f.partial.identity().slerp(f.rotation, e);
    f.dir.copy(f.start).applyQuaternion(f.partial);
    this.lat = Math.asin(THREE.MathUtils.clamp(f.dir.y, -1, 1));
    this.lon = Math.atan2(f.dir.x, f.dir.z);
    this.groundHeight = surfaceHeight(f.dir);
    const altitude = f.base + Math.exp(f.line(e) + f.bump * Math.sin(Math.PI * e));
    // Por seguridad nunca por debajo del suelo (la ruta ya lo evita casi siempre).
    this.altitude = Math.max(altitude, this.groundHeight + MIN_CLEARANCE);
    // La inclinación usa un suelo "de referencia" que pasa suavemente del de salida al
    // de llegada, para que la cámara no cabecee con cada colina.
    const reference = f.groundStart + (f.groundEnd - f.groundStart) * e;
    this.viewClearance = Math.max(MIN_CLEARANCE, this.altitude - reference);
    this.target.lat = this.lat;
    this.target.lon = this.lon;
    this.target.altitude = this.altitude;
    if (t >= 1) {
      this.flight = null;
      this.viewClearance = null;
    }
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
      // y en vertical: levantar o bajar la mirada (para ver el cielo, el Sol y la Luna)
      this.target.lookUp = THREE.MathUtils.clamp(this.target.lookUp + dy * 0.004, 0, MAX_LOOK_UP);
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
    this.lookUp += (this.target.lookUp - this.lookUp) * (1 - Math.exp(-delta * 8));
    if (this.flight) {
      this.updateFlight(delta);
      // Durante el vuelo el rumbo cambia de forma gradual en la primera mitad.
      const f = this.flight;
      if (f) {
        const p = THREE.MathUtils.smoothstep(Math.min(1, f.time / f.duration), 0.05, 0.55);
        this.heading = f.startHeading + (this.target.heading - f.startHeading) * p;
      } else {
        this.heading = this.target.heading;
      }
      this.placeCamera();
      return;
    }
    if (this.follow) {
      const dir = this.follow();
      if (dir) this.aimAt(dir);
      else this.stopFollow();
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
    const clearance = this.viewClearance ?? Math.max(1, this.altitude - this.groundHeight);
    this.lowness = lowness(clearance);
    const tilt = tiltFor(clearance) + this.lookUp;

    camera.position.copy(dir).multiplyScalar(RADIUS + this.altitude);
    look.copy(dir).multiplyScalar(-Math.cos(tilt)).addScaledVector(forward, Math.sin(tilt));
    camera.up.copy(dir).multiplyScalar(Math.sin(tilt)).addScaledVector(forward, Math.cos(tilt)).normalize();
    camera.lookAt(look.add(camera.position));

    // Durante un vuelo la cámara mira fija al destino. Al empezar gira hacia él en un
    // momento, y al final coincide con la vista normal (el vuelo termina justo detrás
    // del destino), así que no hay saltos.
    const f = this.flight;
    if (f) {
      const normalView = this.tmpQuat.copy(camera.quaternion);
      // Arriba de la cámara: una mezcla fija del "arriba" del planeta y la dirección de
      // avance. Mirando en horizontal manda el "arriba"; mirando hacia abajo, la
      // dirección de avance. Así la cámara nunca gira sobre sí misma.
      camera.up.copy(dir).addScaledVector(forward, 1.5).normalize();
      camera.lookAt(f.focus);
      // Gira hacia el destino en ~1 s al empezar y vuelve a la vista normal al final.
      const t = Math.min(1, f.time / f.duration);
      const turnIn = Math.min(0.3, 1.1 / f.duration);
      const blend = THREE.MathUtils.smoothstep(t, 0, turnIn) * (1 - THREE.MathUtils.smoothstep(t, 0.8, 1));
      this.lookQuat.copy(camera.quaternion);
      camera.quaternion.slerpQuaternions(normalView, this.lookQuat, blend);
    }
  }
}
