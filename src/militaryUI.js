import { GOOD_NAMES } from './sim/goods.js';
import { preserveScroll } from './keepScroll.js';
import { UNITS, UNITS_BY_ID, upgradeOf, PVP } from './sim/units.js';

// Panel del ejército: capacidad militar, plazas de cada edificio, mantenimiento, reclutar
// unidades (con el motivo si no se puede), mejorar o licenciar soldados y las reglas de combate.

const REFRESH_SECONDS = 0.5;
const POOL_NAMES = { barracks: 'Cuarteles y fuertes', archery: 'Campos de tiro', stable: 'Caballerizas', siege_shop: 'Talleres de asedio', motor_pool: 'Parque móvil' };

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const costText = (cost) => Object.entries(cost).map(([k, n]) => `${n} ${GOOD_NAMES[k] ?? k}`).join(', ');

export class MilitaryUI {
  constructor({ colony, button, panel }) {
    this.colony = colony;
    this.button = button;
    this.panel = panel;
    preserveScroll(this.panel);
    this.timer = 0;
    this.key = '';
    button.addEventListener('click', () => this.toggle());
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return this.toggle(false);
      const rec = e.target.closest('[data-recruit]');
      if (rec) return void colony.recruit(rec.dataset.recruit);
      const up = e.target.closest('[data-upgrade-soldier]');
      if (up) return void colony.upgradeSoldier(colony.colonist(Number(up.dataset.upgradeSoldier)));
      const dis = e.target.closest('[data-dismiss]');
      if (dis) colony.dismiss(colony.colonist(Number(dis.dataset.dismiss)));
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) this.toggle(false);
    });
  }

  toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    this.key = '';
    if (open) {
      this.onOpen?.();
      this.render();
    }
  }

  update(delta) {
    const show = !!this.colony.camp && this.colony.age >= 3;
    this.button.hidden = !show;
    if (!show) {
      if (!this.panel.hidden) this.toggle(false);
      return;
    }
    this.timer -= delta;
    if (this.timer > 0 || this.panel.hidden) return;
    this.timer = REFRESH_SECONDS;
    this.render();
  }

  render() {
    const colony = this.colony;
    const r = colony.armyReport;
    const soldiers = colony.colonists.filter((c) => c.soldier);
    const units = UNITS.filter((u) => u.age <= colony.age);
    const problems = units.map((u) => colony.recruitProblem(u.id));
    const key = JSON.stringify([r, soldiers.map((c) => [c.id, c.soldier.unit]), problems, colony.stock.food, colony.stock.coin]);
    if (key === this.key) return;
    this.key = key;
    const upkeep = costText(r.upkeep) || 'nada';
    this.panel.innerHTML = `
      <header class="cp-head" style="padding:0 0 8px">
        <div><p class="eyebrow">Ejército y defensas</p><h2 class="cp-name">Capacidad militar ${r.power.total}</h2></div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar">✕</button>
      </header>
      <div class="village-body">
        <section class="cp-section">
          <div class="stat-line"><span>Tropas · defensas</span><strong>${r.power.troops} · ${r.power.defense}</strong></div>
          <div class="stat-line"><span>Soldados / máximo (40 % de los adultos)</span><strong>${r.count} / ${r.cap}</strong></div>
          <div class="stat-line"><span>Mantenimiento por día</span><strong>${upkeep}</strong></div>
          ${r.unpaid ? '<p class="reason" style="color:var(--bad)">Las tropas no cobran: rinden la mitad. Falta comida o monedas.</p>' : ''}
          ${r.pools.map((p) => `<div class="stat-line"><span>${POOL_NAMES[p.pool]}</span><strong>${p.used} / ${p.cap}</strong></div>`).join('') || '<p class="reason">Aún no hay edificios militares: construye un cuartel.</p>'}
          <p class="reason">Reclutar saca colonos de la población civil (primero los libres) y deja sus puestos de trabajo. El equipo sale de la armería. Los soldados no se modernizan solos al avanzar de edad: se mejoran pagando.</p>
        </section>
        <section class="cp-section">
          <h3>Reclutar</h3>
          <ul class="trade-list">
            ${units
              .map(
                (u, i) => `<li class="trade-row" style="grid-template-columns:1fr auto"><span><strong>${u.name}</strong> <small>poder ${u.power} · ${esc(u.desc)}</small><br><small>Coste: ${costText({ ...u.cost, [u.arms]: 1 })} · Mantenimiento: ${costText(u.upkeep)}</small></span>
                <button type="button" data-recruit="${u.id}" ${problems[i] ? 'disabled' : ''} title="${esc(problems[i] ?? 'Reclutar')}">Reclutar</button></li>`,
              )
              .join('')}
          </ul>
        </section>
        <section class="cp-section">
          <h3>Soldados (${soldiers.length})</h3>
          <ul class="trade-list">
            ${
              soldiers
                .map((c) => {
                  const u = UNITS_BY_ID[c.soldier.unit];
                  const next = upgradeOf(u);
                  const prob = colony.soldierUpgradeProblem(c);
                  return `<li class="trade-row"><span>${esc(c.name)} · ${u.name}</span>
                    <button type="button" data-upgrade-soldier="${c.id}" ${prob ? 'disabled' : ''} title="${esc(prob ?? `Mejorar a ${next?.name}`)}">Mejorar</button>
                    <button type="button" data-dismiss="${c.id}" title="Vuelve a ser civil y devuelve su equipo">Licenciar</button></li>`;
                })
                .join('') || '<li class="reason">Todavía no hay soldados.</li>'
            }
          </ul>
        </section>
        <section class="cp-section">
          <h3>Reglas de combate</h3>
          <p class="reason">Incursiones: bandas abstractas que llegan cada pocos días a partir de la Edad del Bronce (cuando ya se puede reclutar), sólo con tu sesión abierta y tras ${6} días de protección. Si tu capacidad militar no alcanza, pierden parte de comida, madera, piedra y monedas; nunca se destruyen edificios ni se hiere a nadie.</p>
          <p class="reason">Entre jugadores: ${PVP.enabled ? 'activo' : 'los ataques están desactivados'}. Si se activaran: ${PVP.protectionDays} días de protección inicial, aldeas con el dueño desconectado intocables, máximo ${PVP.maxAgeGap} edad de diferencia y sólo robo de recursos.</p>
        </section>
      </div>`;
  }
}
