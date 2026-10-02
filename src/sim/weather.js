import { moisture } from '../elevation.js';
import { DAY_LENGTH_SECONDS } from './calendar.js';

// Clima de un lugar: cambia cada pocas horas de juego entre despejado, nublado, lluvia y
// tormenta; en lugares húmedos llueve más y en los desiertos casi nunca. Es parte de la
// simulación (cada colonia tiene el suyo en el servidor); las gotas que se ven las dibuja
// weather.js. La lluvia:
//  - hace que el pozo rinda más (el aguatero llena las vasijas más rápido),
//  - hace que bayas y setas vuelvan a crecer antes y que brote vegetación nueva,
//  - enfría un poco y oscurece el cielo.

export const WEATHER = {
  clear: { id: 'clear', name: 'Despejado', icon: 'sun', rain: 0, clouds: 0 },
  cloudy: { id: 'cloudy', name: 'Nublado', icon: 'cloud', rain: 0, clouds: 0.6 },
  rain: { id: 'rain', name: 'Lluvia', icon: 'rain', rain: 0.65, clouds: 0.85 },
  storm: { id: 'storm', name: 'Tormenta', icon: 'storm', rain: 1, clouds: 1 },
};

const DAY = DAY_LENGTH_SECONDS;

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class WeatherState {
  constructor(seed = Date.now()) {
    this.state = WEATHER.clear;
    this.timer = 0.2 * DAY; // hasta el próximo cambio
    this.rain = 0; // intensidad actual de la lluvia (0–1), cambia con suavidad
    this.clouds = 0;
    this.humidity = 0; // humedad del lugar (-0,5 seco … 0,5 húmedo)
    this.wetBias = 0; // cuánto más o menos llueve ahora por la estación (monzón tropical)
    this.snowy = false; // lo que cae es nieve (hace frío de verdad en ese lugar y época)
    this.rand = seededRandom(seed & 0xffffffff);
  }

  // El clima de cada lugar depende de su humedad.
  setPlace(dir) {
    this.humidity = moisture(dir.x, dir.y, dir.z);
  }

  // La estación manda sobre el clima (sim/calendar.js): más o menos lluvia, y si lo que cae es nieve.
  setClimate({ wetBias = 0, snowy = false } = {}) {
    this.wetBias = wetBias;
    this.snowy = !!snowy;
  }

  // Lluvia que de verdad llena pozos y riega: la nieve casi no (se derrite despacio).
  get effectiveRain() {
    return this.rain * (this.snowy ? 0.3 : 1);
  }

  // Probabilidades del próximo estado según el actual, la humedad del lugar y la estación.
  next() {
    const wet = Math.min(0.95, Math.max(0.05, 0.5 + this.humidity * 1.4 + this.wetBias)); // 0 desierto, 1 selva
    const r = this.rand();
    const s = this.state.id;
    let id;
    if (s === 'clear') id = r < 0.35 + wet * 0.3 ? 'cloudy' : 'clear';
    else if (s === 'cloudy') id = r < wet * 0.6 ? 'rain' : r < 0.75 ? 'clear' : 'cloudy';
    else if (s === 'rain') id = r < 0.18 * wet ? 'storm' : r < 0.6 ? 'cloudy' : 'rain';
    else id = r < 0.7 ? 'rain' : 'cloudy';
    this.state = WEATHER[id];
    // Cada estado dura entre 3 y 10 horas de juego.
    this.timer = (0.12 + this.rand() * 0.3) * DAY;
  }

  // gameDt: segundos de juego.
  advance(gameDt) {
    this.timer -= gameDt;
    if (this.timer <= 0) this.next();
    // Transición suave (media hora de juego, más o menos).
    const k = 1 - Math.exp(-gameDt / 12);
    this.rain += (this.state.rain - this.rain) * k;
    this.clouds += (this.state.clouds - this.clouds) * k;
  }

  save() {
    return { state: this.state.id, timer: this.timer, rain: this.rain, clouds: this.clouds, snowy: this.snowy };
  }

  // Resumen corto para mandar a los demás jugadores (el clima de esta colonia, en vivo):
  // estado, intensidad de la lluvia y de las nubes.
  brief() {
    const r2 = (v) => Math.round(v * 100) / 100;
    return { s: this.state.id, r: r2(this.rain), c: r2(this.clouds), n: this.snowy ? 1 : 0 };
  }

  loadBrief(b) {
    if (!b || !WEATHER[b.s]) return;
    this.state = WEATHER[b.s];
    this.rain = Number.isFinite(b.r) ? b.r : this.state.rain;
    this.clouds = Number.isFinite(b.c) ? b.c : this.state.clouds;
    this.snowy = !!b.n;
  }

  load(data) {
    if (!data || !WEATHER[data.state]) return;
    this.state = WEATHER[data.state];
    this.timer = data.timer ?? this.timer;
    this.rain = data.rain ?? this.state.rain;
    this.clouds = data.clouds ?? this.state.clouds;
    this.snowy = !!data.snowy;
  }
}
