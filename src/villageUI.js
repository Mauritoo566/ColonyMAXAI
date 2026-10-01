import { NEEDS } from './needs.js';
import { GOODS_BY_ID } from './sim/goods.js';
import { villageReport } from './sim/report.js';

// Panel general de la aldea: población y vivienda, trabajadores, bienestar, territorio,
// almacenamiento y producción por día. Se abre con el botón «Aldea».

const REFRESH_SECONDS = 0.5;

function icon(id) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${id}" /></svg>`;
}

const bar = (value, max, tone = 'var(--accent)') => `<span class="bar" style="--bar:${tone}"><i style="width:${Math.round(Math.max(0, Math.min(1, value / Math.max(1, max))) * 100)}%"></i></span>`;

export class VillageUI {
  constructor({ colony, button, panel }) {
    this.colony = colony;
    this.button = button;
    this.panel = panel;
    this.timer = 0;
    this.key = '';
    button.addEventListener('click', () => this.toggle());
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.toggle(false);
      if (e.target.closest('[data-expand]')) this.colony.expandTerritory();
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
    const has = !!this.colony.camp;
    this.button.hidden = !has;
    if (!has) {
      if (!this.panel.hidden) this.toggle(false);
      return;
    }
    this.timer -= delta;
    if (this.timer > 0 || this.panel.hidden) return;
    this.timer = REFRESH_SECONDS;
    this.render();
  }

  render() {
    const r = villageReport(this.colony);
    const p = r.population;
    const w = r.workers;
    const t = r.territory;
    const key = JSON.stringify([p.total, p.max, p.housing, p.children, p.pregnant, p.homeless, p.growthBlocker, w, t.radius, t.expansions, t.blocker, r.storage.map((s) => [s.id, s.have, s.cap]), r.flows, Math.round(r.wellbeing?.wellbeing ?? 0)]);
    if (key === this.key) return;
    this.key = key;
    const flows = r.flows;
    const flowGoods = [...new Set([...Object.keys(flows.in ?? {}), ...Object.keys(flows.out ?? {})])].filter((k) => GOODS_BY_ID[k]);
    const costText = Object.entries(t.cost).map(([k, n]) => `${n} ${GOODS_BY_ID[k]?.name ?? k}`).join(', ');
    this.panel.innerHTML = `
      <header class="cp-head" style="padding:0 0 8px">
        <div><p class="eyebrow">Aldea</p><h2 class="cp-name">Resumen general</h2></div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar">${icon('close')}</button>
      </header>
      <div class="village-body">
        <section class="cp-section">
          <h3>Población y vivienda</h3>
          <div class="stat-line"><span>Colonos</span><strong>${p.total} / ${p.max}</strong></div>
          ${bar(p.total, p.max)}
          <div class="stat-line"><span>Plazas en viviendas · campamento base</span><strong>${p.housing} · ${p.campBase}</strong></div>
          <div class="stat-line"><span>Adultos · niños · embarazos</span><strong>${p.adults} · ${p.children} · ${p.pregnant}</strong></div>
          <div class="stat-line"><span>Sin casa (duermen en tiendas)</span><strong>${p.homeless}</strong></div>
          <p class="reason" style="${p.growthBlocker ? 'color:var(--warn)' : ''}">${p.growthBlocker ? `No crece: ${p.growthBlocker}.` : 'Hay plazas, reservas y servicios para crecer.'}${!p.growthBlocker && p.immigrationBlocker ? ` Nadie llega: ${p.immigrationBlocker}.` : ''}</p>
        </section>
        <section class="cp-section">
          <h3>Trabajadores</h3>
          <div class="stat-line"><span>Con trabajo · libres</span><strong>${w.employed} · ${w.free}</strong></div>
          <div class="stat-line"><span>Puestos cubiertos</span><strong>${w.filled} / ${w.needed}</strong></div>
          ${w.soldiers ? `<div class="stat-line"><span>En el ejército</span><strong>${w.soldiers}</strong></div>` : ''}
          ${w.trades.map((x) => `<div class="stat-line"><span>${x.job}</span><strong>${x.filled}/${x.needed}</strong></div>`).join('')}
        </section>
        <section class="cp-section">
          <h3>Bienestar</h3>
          ${
            r.wellbeing
              ? `<div class="stat-line"><span>Bienestar medio</span><strong>${Math.round(r.wellbeing.wellbeing)}%</strong></div>${bar(r.wellbeing.wellbeing, 100, 'var(--good, #6cd18a)')}
                 ${NEEDS.map((n) => `<div class="stat-line"><span>${n.name}</span><strong>${Math.round(r.wellbeing[n.id])}%</strong></div>`).join('')}`
              : ''
          }
        </section>
        <section class="cp-section">
          <h3>Territorio</h3>
          <div class="stat-line"><span>Radio construible</span><strong>${t.radius} m</strong></div>
          <div class="stat-line"><span>Ampliaciones</span><strong>${t.expansions} / ${t.ageCap}${t.cap < t.ageCap ? ` (ahora ${t.cap})` : ''}</strong></div>
          <p class="reason">Siguiente ampliación: ${costText}</p>
          <button type="button" class="btn btn--primary" data-expand ${t.blocker ? 'disabled' : ''}>Ampliar territorio</button>
          ${t.blocker ? `<p class="reason" style="color:var(--warn)">${t.blocker}</p>` : ''}
        </section>
        <section class="cp-section">
          <h3>Almacenamiento</h3>
          ${r.storage.map((s) => `<div class="stat-line"><span>${GOODS_BY_ID[s.id]?.name ?? s.id}</span><strong>${s.have} / ${s.cap}</strong></div>${bar(s.have, s.cap, s.have >= s.cap ? 'var(--bad)' : s.have > s.cap * 0.85 ? 'var(--warn)' : GOODS_BY_ID[s.id]?.color)}`).join('')}
        </section>
        <section class="cp-section">
          <h3>Producción y consumo por día</h3>
          ${flowGoods.length ? flowGoods.map((k) => `<div class="stat-line"><span>${GOODS_BY_ID[k].name}</span><strong>+${Math.round(flows.in?.[k] ?? 0)} / −${Math.round(flows.out?.[k] ?? 0)}</strong></div>`).join('') : '<p class="reason">Aún no hay datos: se calculan con lo que entra y sale del almacén en el último día.</p>'}
        </section>
      </div>`;
  }
}
