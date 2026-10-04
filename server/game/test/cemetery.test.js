// Cementerio (desde la Edad III): quien muere queda tirado y su familia lo llora; el enterrador lo busca, lo carga y lo entierra (con un máximo de
// tumbas); pasado el reposo lo pasa a cenizas en un jarrón de la estantería (con un máximo de huecos) y libera la tumba; un familiar que lo extraña y
// lo piensa bien se lleva el jarrón a casa y gana bienestar. Sin cementerio, desde la Edad III los cuerpos huelen y entristecen; antes de esa edad
// un colono cualquiera los deja lejos de la aldea. Todo se guarda y llega al navegador.
// Uso: node server/game/test/cemetery.test.js
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColonySim } from '../../../src/sim/colony.js';
import { WeatherState } from '../../../src/sim/weather.js';
import { BUILDINGS } from '../../../src/sim/buildingTypes.js';
import { naturalSurfaceHeight } from '../../../src/elevation.js';
import { defImplemented, minAgeOf } from '../../../src/sim/progression.js';
import { updateNeeds, URN_BONUS, STENCH_PENALTY } from '../../../src/needs.js';
import { diagnose } from '../../../src/sim/wellbeing.js';
import { freePlot, freeNiche, plotsOf, nichesOf, urnsAtHome, THINK_SECONDS, cemeteryStatus, nextJob, stenchAt, smells, FAR_MIN } from '../../../src/sim/cemetery.js';

const dir = new THREE.Vector3(-0.8984470605519815, 0.4271785546817849, 0.10154487582091702).normalize();
function colony(n = 12, age = 3) {
  const sim = new ColonySim();
  sim.weather = new WeatherState(5);
  sim.weather.setPlace(dir);
  sim.setCamp({ dir, height: naturalSurfaceHeight(dir), yaw: 0, seed: 12345 }, { ownZone: true });
  sim.setAge(age);
  sim.stock = { food: 90, water: 90, wood: 99, stone: 20, fiber: 99 };
  sim.clothesLeft = 0;
  const base = sim.colonists[0];
  while (sim.colonists.length < n) {
    const id = 50 + sim.colonists.length;
    sim.colonists.push(sim.makeColonist({ ...sim.staticOf(base), id, name: `Extra${id}` }, { needs: { ...base.needs }, growth: 1, x: 6 + sim.colonists.length, z: 4 }));
  }
  for (const c of sim.colonists) {
    c.clothed = true;
    c.traits = [];
    c.task = null;
  }
  return sim;
}
const tick = (sim, seconds, hook) => {
  for (let t = 0; t < seconds; t += 0.5) {
    for (const c of sim.colonists) c.needs.food = c.needs.water = c.needs.rest = c.needs.warmth = 100;
    hook?.(t);
    sim.update(0.5, { timeScale: 1, isNight: false, timeLabel: () => 'Día 1' });
  }
};
const cemetery = (sim, x = 20, z = 20) => {
  const b = sim.createBuilding(BUILDINGS.cemetery, x, z, 0, 1, 0, 1);
  b.done = true;
  b.progress = 1;
  return b;
};

// 0) Existe desde la Edad III y tiene su capacidad por nivel.
assert.ok(defImplemented(BUILDINGS.cemetery));
assert.equal(minAgeOf(BUILDINGS.cemetery), 3, 'desde la Edad III');
assert.deepEqual(BUILDINGS.cemetery.levels.map((l) => l.age), [3, 5, 7, 9]);
assert.deepEqual(BUILDINGS.cemetery.levels.map((l) => l.plots), [5, 9, 14, 20], 'más tumbas con las edades');
assert.ok(BUILDINGS.cemetery.levels.every((l, i, a) => !i || (l.niches > a[i - 1].niches && l.plots > a[i - 1].plots)));

// 1) Quien muere queda tirado donde cayó y los suyos lo lloran.
const sim = colony();
const b = cemetery(sim);
const [pareja, otro] = [sim.colonists[1], sim.colonists[2]];
const difunto = sim.colonists[3];
difunto.mate = pareja.id;
pareja.mate = difunto.id;
difunto.x = 12;
difunto.z = -6;
const moodAntes = pareja.needs.mood;
sim.die(difunto, 'de hambre');
assert.equal(sim.dead.length, 1);
const rec = sim.dead[0];
assert.equal(rec.state, 'ground', 'queda tirado');
assert.ok(Math.hypot(rec.x - 12, rec.z + 6) < 1, 'donde cayó');
assert.deepEqual(rec.relatives, [{ id: pareja.id, kind: 'mate' }]);
assert.ok(pareja.needs.mood < moodAntes - 10, 'su pareja lo llora');
assert.ok(pareja.moodEvents?.some((e) => e.id === 'grief'));
assert.equal(otro.moodEvents?.some((e) => e.id === 'grief') ?? false, false, 'un colono sin relación no');
assert.equal(sim.colonists.some((c) => c.id === difunto.id), false);

// 2) El enterrador va a buscarlo, lo carga (se ve) y lo entierra en una tumba.
const enterrador = sim.colonists[4];
sim.setWorker(b, enterrador);
let llevoCuerpo = false;
let estadoLlevado = null;
tick(sim, 150, () => {
  if (enterrador.carrying === 'body') {
    llevoCuerpo = true;
    estadoLlevado ??= rec.state;
  }
});
assert.ok(llevoCuerpo, 'carga el cuerpo');
assert.equal(estadoLlevado, 'carried');
assert.equal(rec.state, 'grave', 'lo entierra');
assert.equal(rec.bid, b.id);
assert.equal(rec.plot, 0);
assert.ok(rec.buriedAt > 0);
assert.equal(enterrador.carrying, null);
assert.equal(freePlot(sim, b), 1, 'queda una tumba menos');

// 3) Un máximo de tumbas: de más, quedan tirados esperando hueco.
{
  const plots = plotsOf(b);
  assert.equal(plots, 5);
  const roles = new Set([enterrador, pareja, otro]);
  const vivos = () => sim.colonists.filter((c) => !roles.has(c));
  for (const m of vivos().slice(0, plots - 1)) sim.die(m, 'de frío');
  // (Mientras tanto nadie pasa a cenizas: los enterrados se mantienen "recién enterrados".)
  const frescos = () => {
    for (const r of sim.dead) if (r.state === 'grave') r.buriedAt = sim.gameTime;
  };
  tick(sim, 450, frescos);
  const enterrados = sim.dead.filter((r) => r.state === 'grave');
  assert.equal(enterrados.length, plots, `tumbas llenas (${enterrados.length}/${plots})`);
  assert.equal(freePlot(sim, b), null);
  // Uno más: no hay tumba, queda tirado y se explica por qué.
  const v = vivos()[0];
  assert.ok(v, 'queda alguien para morir');
  sim.die(v, 'por agotamiento');
  tick(sim, 40, frescos);
  assert.equal(sim.dead.filter((r) => r.state === 'ground').length, 1, 'sin tumba libre sigue tirado');
  assert.match(cemeteryStatus(sim, b) ?? '', /no quedan tumbas libres/);
  assert.equal(nextJob(sim, b, enterrador, sim.gameTime), null, 'y el enterrador no tiene nada que hacer: sigue con otro trabajo');
}

// 4) Pasado el reposo, pasa a cenizas en un jarrón de la estantería y la tumba queda libre (y entonces entierra al que esperaba).
{
  assert.equal(nichesOf(b), 6);
  for (const r of sim.dead) if (r.state === 'grave') r.buriedAt = sim.gameTime - 400; // ya reposaron
  const antes = sim.dead.filter((r) => r.state === 'shelf').length;
  let llevoJarron = false;
  tick(sim, 500, () => {
    if (enterrador.carrying === 'urn') llevoJarron = true;
  });
  assert.ok(llevoJarron, 'lleva el jarrón a la estantería');
  const enEstante = sim.dead.filter((r) => r.state === 'shelf');
  assert.ok(enEstante.length > antes, `hay jarrones en la estantería (${enEstante.length})`);
  assert.ok(enEstante.every((r) => r.niche != null && r.shelvedAt > 0 && r.plot == null), 'cada jarrón tiene su hueco y su tumba quedó libre');
  assert.equal(new Set(enEstante.map((r) => r.niche)).size, enEstante.length, 'cada hueco, un solo jarrón');
  assert.equal(sim.dead.filter((r) => r.state === 'ground').length, 0, 'el que esperaba ya tiene su tumba libre y fue enterrado');
}

// 5) La familia: el jarrón de su pareja está en la estantería; la pareja lo extraña, lo piensa y se lo lleva a casa. Gana bienestar.
{
  const sim2 = colony();
  const cem = cemetery(sim2);
  const casa = sim2.createBuilding(BUILDINGS.house, -22, 10, 0, 1, 0, 1);
  casa.done = true;
  casa.progress = 1;
  const viuda = sim2.colonists[1];
  const extrano = sim2.colonists[2];
  const muerto = sim2.colonists[3];
  muerto.mate = viuda.id;
  viuda.mate = muerto.id;
  viuda.home = casa.id;
  extrano.home = casa.id;
  sim2.die(muerto, 'de frío');
  const r = sim2.dead[0];
  Object.assign(r, { state: 'shelf', bid: cem.id, niche: 0, shelvedAt: sim2.gameTime - 200, plot: null }); // ya está en la estantería
  assert.equal(urnsAtHome(sim2, viuda), 0);
  let pensando = false;
  let fue = false;
  tick(sim2, THINK_SECONDS + 120, () => {
    if (viuda.urnThink?.id === r.id) pensando = true;
    if (viuda.carrying === 'urn') fue = true;
    assert.ok(extrano.task?.type !== 'urn', 'quien no es de la familia no se lleva el jarrón');
  });
  assert.ok(pensando, 'lo piensa antes de ir');
  assert.ok(fue, 'carga el jarrón');
  assert.equal(r.state, 'home', 'el jarrón está en su casa');
  assert.equal(r.home, casa.id);
  assert.equal(urnsAtHome(sim2, viuda), 1);
  assert.ok(viuda.moodEvents?.some((e) => e.id === 'urn' && e.delta > 0), 'se siente aliviada');
  assert.equal(urnsAtHome(sim2, extrano), 0, 'el que no es familia no cuenta');
  tick(sim2, 20);
  assert.equal(viuda.moodFx.urns, 1);
  // Su ánimo base sube con el jarrón en casa (se mide con las mismas necesidades, con y sin jarrón).
  const medio = (urns) => {
    const x = { needs: { food: 50, water: 50, rest: 50, warmth: 50, mood: 50 }, genome: viuda.genome, traits: [], health: 100, flags: {} };
    updateNeeds(x, { dt: 1, ambient: 0.5, walking: false, urns, gameTime: 10, time: 12 });
    return x.moodTarget;
  };
  assert.ok(Math.abs(medio(1) - medio(0) - URN_BONUS) < 1e-6, `el jarrón da +${URN_BONUS} de ánimo base`);
  assert.ok(Math.abs(medio(2) - medio(0) - 2 * URN_BONUS) < 1e-6, 'dos jarrones, el doble');
  assert.ok(Math.abs(medio(5) - medio(2)) < 1e-6, 'con tope');
  assert.ok(diagnose(sim2, viuda).positives.some((p) => p.id === 'urns'), 'la ficha explica el consuelo del jarrón');
  assert.equal(freeNiche(sim2, cem), 0, 'el hueco de la estantería quedó libre');
}

// 6) Pensarlo bien: sin casa no se lo lleva.
{
  const sim3 = colony();
  const cem = cemetery(sim3);
  const viuda = sim3.colonists[1];
  const muerto = sim3.colonists[3];
  muerto.mate = viuda.id;
  viuda.mate = muerto.id;
  sim3.die(muerto, 'de frío');
  Object.assign(sim3.dead[0], { state: 'shelf', bid: cem.id, niche: 0, shelvedAt: sim3.gameTime - 200 });
  viuda.home = null;
  let fue = false;
  tick(sim3, THINK_SECONDS + 60, () => {
    if (viuda.carrying === 'urn') fue = true;
  });
  assert.equal(fue, false, 'sin casa no se lo lleva');
  assert.equal(sim3.dead[0].state, 'shelf');
}

// 7) Antes de la Edad III no hay cementerio: un colono cualquiera carga al muerto y lo deja lejos de la aldea.
{
  const sim5 = colony(8, 2);
  const muerto = sim5.colonists[3];
  muerto.x = 10;
  muerto.z = 6;
  sim5.die(muerto, 'de frío');
  const r = sim5.dead[0];
  assert.equal(r.state, 'ground');
  let porteador = null;
  tick(sim5, 400, () => {
    const c = sim5.colonists.find((o) => o.carrying === 'body');
    if (c) porteador = porteador ?? c;
  });
  assert.ok(porteador, 'alguien lo carga');
  assert.equal(r.state, 'abandoned', 'y lo deja');
  assert.ok(Math.hypot(r.x, r.z) >= FAR_MIN - 8, `lejos de la aldea (a ${Math.hypot(r.x, r.z).toFixed(0)} m de la fogata)`);
  assert.equal(porteador.carrying, null);
  assert.equal(r.claim, null);
  // En esas edades no huele ni entristece en la aldea (se lleva lejos).
  assert.equal(smells(sim5, r), false);
  assert.equal(stenchAt(sim5, 5, 5), 0);
  // Con la edad del cementerio, un cuerpo que ya quedó lejos no lo recoge el enterrador (sólo los que yacen en la aldea).
  sim5.setAge(3);
  const cem = cemetery(sim5);
  assert.equal(nextJob(sim5, cem, sim5.colonists[0], sim5.gameTime), null);
}

// 8) Desde la Edad III, sin cementerio construido, el cuerpo apesta y entristece a quien pasa y lo ve.
{
  const sim6 = colony(10, 3);
  const cerca = sim6.colonists[1];
  const lejos = sim6.colonists[2];
  const muerto = sim6.colonists[3];
  muerto.x = 6;
  muerto.z = 6;
  sim6.die(muerto, 'de frío');
  const r = sim6.dead[0];
  assert.equal(smells(sim6, r), true, 'sin cementerio, desde la Edad III, huele');
  const pon = () => {
    cerca.x = 9;
    cerca.z = 6;
    lejos.x = 70;
    lejos.z = 60;
    for (const c of sim6.colonists) {
      if (c !== cerca && c !== lejos && c !== sim6.colonists[4]) {
        c.x = 90;
        c.z = -90;
      }
    }
    for (const c of [cerca, lejos]) c.task = null;
  };
  tick(sim6, 20, pon);
  assert.ok(stenchAt(sim6, cerca.x, cerca.z) > 0.2, 'huele cerca del cuerpo');
  assert.equal(stenchAt(sim6, lejos.x, lejos.z), 0, 'y no lejos');
  assert.ok(cerca.moodFx.stench > 0.2, 'el que pasa lo nota');
  assert.ok(cerca.moodEvents?.some((e) => e.id === 'sawbody' && e.delta < 0), 'se pone triste al verlo');
  assert.equal(lejos.moodEvents?.some((e) => e.id === 'sawbody') ?? false, false, 'quien está lejos no lo ve');
  assert.ok(diagnose(sim6, cerca).causes.some((c) => c.id === 'stench'), 'la ficha explica el mal olor');
  // El golpe de ánimo no se repite a cada paso (hay un respiro).
  assert.equal(cerca.moodEvents.filter((e) => e.id === 'sawbody').length, 1);
  const medio = (stench) => {
    const x = { needs: { food: 50, water: 50, rest: 50, warmth: 50, mood: 50 }, genome: cerca.genome, traits: [], health: 100, flags: {} };
    updateNeeds(x, { dt: 1, ambient: 0.5, walking: false, stench, gameTime: 10, time: 12 });
    return x.moodTarget;
  };
  assert.ok(Math.abs(medio(0) - medio(1) - STENCH_PENALTY) < 1e-6, `el olor quita hasta ${STENCH_PENALTY} de ánimo base`);
  // Se construye un cementerio con su enterrador: se lleva el cuerpo y deja de oler.
  const cem = cemetery(sim6);
  sim6.setWorker(cem, sim6.colonists[4]);
  tick(sim6, 150, pon);
  assert.equal(r.state, 'grave', 'el enterrador se lo llevó');
  assert.equal(smells(sim6, r), false);
  assert.equal(stenchAt(sim6, 7, 6), 0, 'ya no huele');
}

// 9) Con cementerio, un cuerpo que espera demasiado (no hay enterrador o está lleno) acaba oliendo también.
{
  const sim7 = colony(8, 3);
  cemetery(sim7);
  const muerto = sim7.colonists[3];
  sim7.die(muerto, 'de frío');
  const r = sim7.dead[0];
  assert.equal(smells(sim7, r), false, 'con cementerio, recién muerto, aún no');
  sim7.gameTime += 400;
  assert.equal(smells(sim7, r), true, 'pero tras más de un día tirado, sí');
}

// 10) Todo se guarda y llega al navegador.
{
  const sim4 = colony(8, 3);
  const cem = cemetery(sim4);
  const a = sim4.colonists[1];
  const m = sim4.colonists[2];
  m.mate = a.id;
  a.mate = m.id;
  sim4.die(m, 'de hambre');
  Object.assign(sim4.dead[0], { state: 'grave', bid: cem.id, plot: 2, buriedAt: 123 });
  const save = JSON.parse(JSON.stringify(sim4.serialize()));
  const back = colony(8, 3);
  back.restore(save);
  assert.equal(back.dead.length, 1);
  assert.equal(back.dead[0].state, 'grave');
  assert.equal(back.dead[0].plot, 2);
  assert.equal(back.dead[0].bid, cem.id);
  assert.deepEqual(back.dead[0].relatives, [{ id: a.id, kind: 'mate' }]);
  // Un cuerpo dejado lejos se recuerda.
  sim4.dead[0].state = 'abandoned';
  const far = colony(8, 3);
  far.restore(JSON.parse(JSON.stringify(sim4.serialize())));
  assert.equal(far.dead[0].state, 'abandoned');
  // A medias: un cuerpo llevado queda en el suelo.
  sim4.dead[0].state = 'carried';
  const half = colony(8, 3);
  half.restore(JSON.parse(JSON.stringify(sim4.serialize())));
  assert.equal(half.dead[0].state, 'ground');
  // El navegador lo ve igual.
  const mirror = colony(8, 3);
  mirror.remote = () => {};
  mirror.applySnapshot(JSON.parse(JSON.stringify(sim4.snapshot('full', { statics: true }))), 'full');
  assert.equal(mirror.dead.length, 1);
  assert.equal(mirror.dead[0].name, sim4.dead[0].name);
  assert.ok(mirror.dead[0].look?.skin, 'con su aspecto para dibujarlo');
}

console.log('cemetery.test.js: ok');
