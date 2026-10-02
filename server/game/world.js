import * as THREE from 'three';
import { naturalSurfaceHeight, RADIUS } from '../../src/elevation.js';
import { DayNight, formatHour } from '../../src/daynight.js';
import { campProblem } from '../../src/camp.js';
import { ColonySim } from '../../src/sim/colony.js';
import { WeatherState } from '../../src/sim/weather.js';
import { seedFromDir } from '../../src/sim/campLayout.js';
import { awaySnapshot, awaySummary, AWAY_MAX_SECONDS, AWAY_MIN_SECONDS } from '../../src/sim/away.js';

// El mundo: todas las colonias, simuladas aquí todo el tiempo aunque sus dueños no estén
// conectados (entonces nadie baja de la salud crítica). El reloj es el mismo para todos:
// sale de la hora real (un día de juego dura 6 minutos). A cada jugador se le manda su
// colonia (entera cada segundo y las posiciones varias veces por segundo), la lista de
// jugadores y los colonos de las colonias ajenas que tiene cerca.

const TICK_MS = 100; // la simulación avanza 10 veces por segundo
const FAST_EVERY = 2; // posiciones de la colonia propia: cada 2 pasos (5 por segundo)
const FULL_EVERY = 10; // colonia entera: cada segundo
const OTHERS_EVERY = 2; // colonos de colonias ajenas cercanas: 5 por segundo (antes 2: se veían a saltos)
const PLAYERS_EVERY = 20; // lista de jugadores (si cambió): cada 2 segundos
const TIME_EVERY = 100; // hora del mundo: cada 10 segundos (el navegador la extrapola)
const SAVE_EVERY_MS = 30_000;
const NEAR_OTHERS = 60_000; // metros: colonias ajenas cuyos colonos se mandan
const MAX_CATCH_UP_STEP = 5; // segundos de juego por paso al ponerse al día

export class World {
  constructor({ store, log = console.log }) {
    this.store = store;
    this.log = log;
    this.colonies = new Map(); // id del jugador -> colonia
    this.clients = new Set(); // conexiones con sesión
    this.names = new Map(); // id del jugador -> nombre
    this.ticks = 0;
    this.playersKey = '';
    this.clock = new DayNight({ startLon: 0, startHour: 12 });
    // El segundo 0 del mundo se fija la primera vez y queda guardado.
    // Sólo para pruebas: GAME_SPEED=30 hace que el mundo corra 30 veces más rápido (el reloj y la simulación).
    this.speed = Math.min(60, Math.max(1, Number(process.env.GAME_SPEED) || 1));
    this.epoch = Number(store.meta('epoch')) || Date.now();
    store.setMeta('epoch', this.epoch);
    for (const p of store.sql.allPlayers.all()) this.names.set(p.id, p.name);
    this.loadColonies();
  }

  // Segundos de juego desde que existe el mundo.
  get elapsed() {
    return ((Date.now() - this.epoch) / 1000) * this.speed;
  }

  // ---- Colonias ---------------------------------------------------------------------

  loadColonies() {
    const start = Date.now();
    for (const row of this.store.sql.colonies.all()) {
      try {
        const colony = this.createColony(row.player_id, JSON.parse(row.camp));
        const save = row.save ? JSON.parse(row.save) : null;
        if (save) colony.sim.restore(save);
        colony.away = row.away ? JSON.parse(row.away) : null;
        // El servidor estuvo apagado: la colonia se pone al día (sin el dueño).
        this.catchUp(colony, (Date.now() - row.updated_at) / 1000);
      } catch (err) {
        this.log(`No se pudo cargar la colonia del jugador ${row.player_id}: ${err.stack ?? err}`);
      }
    }
    if (this.colonies.size) this.log(`${this.colonies.size} colonias cargadas en ${Date.now() - start} ms`);
  }

  createColony(playerId, camp) {
    const dir = new THREE.Vector3(camp.dir.x, camp.dir.y, camp.dir.z).normalize();
    const sim = new ColonySim();
    sim.weather = new WeatherState(camp.seed);
    sim.weather.setPlace(dir);
    sim.setCamp({ dir, height: camp.height, yaw: camp.yaw, seed: camp.seed }, { ownZone: true });
    sim.spawnMobs();
    const colony = { playerId, sim, camp, dir, away: null, dirty: true };
    sim.on('changed', () => (colony.dirty = true));
    this.colonies.set(playerId, colony);
    return colony;
  }

  // Simula "seconds" segundos de juego de una vez, con el dueño ausente (hasta dos días).
  catchUp(colony, seconds) {
    const total = Math.min(Math.max(0, seconds), AWAY_MAX_SECONDS);
    let t = this.elapsed - total;
    for (let left = total; left > 0; left -= MAX_CATCH_UP_STEP) {
      const dt = Math.min(MAX_CATCH_UP_STEP, left);
      t += dt;
      this.step(colony, dt, t, true, Math.ceil(dt / 0.1) + 1);
    }
  }

  // Un paso de simulación de una colonia en el instante "elapsed" del mundo.
  step(colony, dt, elapsed, absent, maxSteps) {
    this.clock.setElapsed(elapsed);
    const dir = colony.dir;
    const label = () => `Día ${this.clock.day} · ${formatHour(this.clock.localHour(Math.atan2(dir.x, dir.z)))}`;
    colony.sim.weather.advance(dt);
    colony.sim.update(dt, {
      timeScale: 1,
      isNight: dir.dot(this.clock.sunDirection) < -0.05,
      timeLabel: label,
      absent,
      maxSteps,
    });
  }

  isOnline(playerId) {
    for (const c of this.clients) if (c.player.id === playerId) return true;
    return false;
  }

  // Fundar el campamento de un jugador (una sola vez). Devuelve el problema o null.
  found(playerId, d) {
    if (this.colonies.has(playerId)) return 'Ya fundaste tu campamento';
    if (!d || ![d.x, d.y, d.z].every(Number.isFinite)) return 'Lugar no válido';
    const dir = new THREE.Vector3(d.x, d.y, d.z);
    if (dir.lengthSq() < 0.5 || dir.lengthSq() > 2) return 'Lugar no válido';
    dir.normalize();
    const others = [...this.colonies.values()].map((c) => ({ dir: c.dir }));
    const problem = campProblem(dir, others);
    if (problem) return problem;
    const camp = { dir: { x: dir.x, y: dir.y, z: dir.z }, height: naturalSurfaceHeight(dir), yaw: Math.random() * Math.PI * 2, seed: seedFromDir(dir) };
    this.store.sql.addColony.run(playerId, JSON.stringify(camp), Date.now());
    this.createColony(playerId, camp);
    this.colonies.get(playerId).sim.seedPrimitive(); // refugio, recolector de lluvia y acopio inicial
    this.saveColony(this.colonies.get(playerId));
    this.log(`${this.names.get(playerId)} fundó su campamento`);
    return null;
  }

  // ---- Jugadores ----------------------------------------------------------------------

  // Un jugador entró (client: { player, send(msg) }).
  join(client) {
    this.names.set(client.player.id, client.player.name);
    const wasOnline = this.isOnline(client.player.id);
    this.clients.add(client);
    this.store.sql.touchPlayer.run(Date.now(), client.player.id);
    client.send({ t: 'time', elapsed: this.elapsed });
    const colony = this.colonies.get(client.player.id);
    if (!colony) return;
    // Volvió: resumen de lo que pasó mientras no estaba.
    if (!wasOnline && colony.away) {
      const seconds = this.elapsed - colony.away.elapsed;
      if (seconds >= AWAY_MIN_SECONDS) {
        const summary = awaySummary(colony.sim, colony.away.before, Math.min(seconds, AWAY_MAX_SECONDS), seconds > AWAY_MAX_SECONDS);
        client.send({ t: 'away', ...summary });
      }
      colony.away = null;
      colony.dirty = true;
    }
    client.send({ t: 'colony', ...colony.sim.snapshot('full') });
    this.playersKey = ''; // mandar la lista otra vez (cambió quién está conectado)
  }

  leave(client) {
    if (!this.clients.delete(client)) return;
    const id = client.player.id;
    this.store.sql.touchPlayer.run(Date.now(), id);
    const colony = this.colonies.get(id);
    // Se fue: foto de cómo quedó la colonia para el resumen al volver.
    if (colony && !this.isOnline(id)) {
      colony.away = { elapsed: this.elapsed, before: awaySnapshot(colony.sim) };
      this.saveColony(colony);
    }
    this.playersKey = '';
  }

  // Volver a fundar tras una derrota: sólo si la aldea terminó (cero colonos). Se borra esa colonia
  // (con sus recursos y órdenes) y el jugador queda como uno nuevo; nada de esto toca a los demás.
  refound(playerId) {
    const colony = this.colonies.get(playerId);
    if (!colony || !colony.sim.defeat) return 'Tu aldea todavía no ha terminado';
    this.colonies.delete(playerId);
    this.store.sql.deleteColony.run(playerId);
    for (const c of this.clients) if (c.player.id === playerId) c.send({ t: 'colonyReset' });
    this.playersKey = '';
    this.log(`${this.names.get(playerId)} perdió su aldea y volverá a fundar`);
    return null;
  }

  // Borrar a un jugador: se cierra su sesión en todas sus conexiones, desaparece su colonia del
  // mundo y de la base de datos (la cuenta y las sesiones caen en cascada).
  removePlayer(playerId) {
    for (const c of [...this.clients]) {
      if (c.player.id !== playerId) continue;
      this.clients.delete(c);
      c.send({ t: 'accountDeleted' });
      c.close?.();
    }
    this.colonies.delete(playerId);
    this.names.delete(playerId);
    this.store.sql.deletePlayer.run(playerId);
    this.playersKey = '';
    this.log(`Cuenta borrada (jugador ${playerId})`);
  }

  command(client, name, args) {
    const colony = this.colonies.get(client.player.id);
    if (!colony || typeof name !== 'string' || !Array.isArray(args)) return;
    let ok = false;
    try {
      ok = colony.sim.applyCommand(name, args);
    } catch (err) {
      this.log(`Orden «${name}» de ${client.player.name} falló: ${err.stack ?? err}`);
    }
    if (!ok) client.send({ t: 'error', message: 'No se pudo hacer eso ahora.' });
    // La respuesta llega enseguida para que la interfaz no espere al próximo envío.
    client.send({ t: 'colony', ...colony.sim.snapshot('full') });
  }

  // ---- Cada paso -------------------------------------------------------------------------

  tick() {
    this.ticks++;
    const elapsed = this.elapsed;
    for (const colony of this.colonies.values()) {
      try {
        this.step(colony, (TICK_MS / 1000) * this.speed, elapsed, !this.isOnline(colony.playerId));
      } catch (err) {
        this.log(`Error simulando la colonia de ${this.names.get(colony.playerId)}: ${err.stack ?? err}`);
      }
    }
    this.broadcast();
  }

  broadcast() {
    const t = this.ticks;
    const fast = t % FAST_EVERY === 0;
    const full = t % FULL_EVERY === 0;
    const others = t % OTHERS_EVERY === 0;
    // Lo que se manda a muchos se arma una sola vez por paso.
    const cache = new Map();
    const once = (key, make) => {
      if (!cache.has(key)) cache.set(key, JSON.stringify(make()));
      return cache.get(key);
    };
    const pendingStatics = [];
    for (const client of this.clients) {
      const own = this.colonies.get(client.player.id);
      if (own && full) {
        // Los datos fijos de los nacidos en la colonia sólo se mandan cuando nace alguien.
        client.sendRaw(once(`full:${own.playerId}`, () => ({ t: 'colony', ...own.sim.snapshot('full', { statics: own.staticsSent !== own.sim.staticsRevision }) })));
        if (!cache.has(`sent:${own.playerId}`)) {
          cache.set(`sent:${own.playerId}`, true);
          pendingStatics.push(own);
        }
      }
      else if (own && fast) client.sendRaw(once(`fast:${own.playerId}`, () => ({ t: 'fast', ...own.sim.snapshot('fast') })));
      if (others && client.view) {
        for (const colony of this.colonies.values()) {
          if (colony === own || colony.dir.angleTo(client.view) * RADIUS > NEAR_OTHERS) continue;
          // A los visitantes también hay que mandarles, de vez en cuando, los nacidos (colonos
          // que no vienen de la semilla), los caminos y lo ya talado/picado: "fast" normalmente
          // no los trae. Es por cliente (no por colonia): quien recién empieza a mirarla no se
          // puede perder lo que ya pasó sólo porque otro ya lo recibió antes.
          const statics = client.otherStatics.get(colony.playerId) !== colony.sim.staticsRevision;
          client.sendRaw(once(`other:${colony.playerId}:${statics}`, () => ({ t: 'other', id: colony.playerId, w: colony.sim.weather?.brief(), ...colony.sim.snapshot('fast', { statics }) })));
          if (statics) client.otherStatics.set(colony.playerId, colony.sim.staticsRevision);
        }
      }
      if (t % TIME_EVERY === 0) client.sendRaw(once('time', () => ({ t: 'time', elapsed: this.elapsed })));
    }
    for (const colony of pendingStatics) colony.staticsSent = colony.sim.staticsRevision;
    if (t % PLAYERS_EVERY === 0) this.sendPlayers();
  }

  // Lista de jugadores con sus campamentos (para verlos en el planeta y en el panel).
  playersList() {
    return [...this.names].map(([id, name]) => {
      const colony = this.colonies.get(id);
      const sim = colony?.sim;
      return {
        id,
        name,
        online: this.isOnline(id),
        camp: colony ? { ...colony.camp } : null,
        age: sim?.age ?? 1,
        population: sim?.count ?? 0,
        flag: sim?.flag ?? null,
        w: sim?.weather?.state.id ?? null, // clima de su zona (sólo el estado: la intensidad va en "other")
        buildings: sim
          ? sim.buildings.map((b) => ({ t: b.def.id, l: b.level, x: Math.round(b.x * 10) / 10, z: Math.round(b.z * 10) / 10, yaw: Math.round(b.yaw * 100) / 100, d: b.done || b.upgrading }))
          : [],
      };
    });
  }

  sendPlayers(force = false) {
    const list = this.playersList();
    const key = JSON.stringify(list);
    if (!force && key === this.playersKey) return;
    this.playersKey = key;
    const msg = `{"t":"players","list":${key}}`;
    for (const client of this.clients) client.sendRaw(msg);
  }

  // ---- Guardado ---------------------------------------------------------------------------

  saveColony(colony) {
    const data = JSON.stringify(colony.sim.serialize());
    this.store.sql.saveColony.run(data, colony.away ? JSON.stringify(colony.away) : null, Date.now(), colony.playerId);
    colony.dirty = false;
  }

  saveAll() {
    const start = Date.now();
    this.store.transaction(() => {
      for (const colony of this.colonies.values()) this.saveColony(colony);
    });
    return Date.now() - start;
  }

  start() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.saveTimer = setInterval(() => {
      try {
        this.saveAll();
      } catch (err) {
        this.log(`Error guardando: ${err.stack ?? err}`);
      }
    }, SAVE_EVERY_MS);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.saveTimer);
    // Quien estaba conectado queda "ausente" desde ahora (para el resumen al volver).
    for (const client of [...this.clients]) this.leave(client);
    this.saveAll();
  }
}

