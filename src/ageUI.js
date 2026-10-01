import { AGES, ageInfo, nextAgeStatus } from './ages.js';
import { STOCK_NAMES } from './buildings.js';
import { unlockTable, limitsFor } from './sim/progression.js';

// Barra de edad (arriba al centro): en qué edad está la colonia y cuánto falta para la
// siguiente. Al pulsarla se abre la lista de edades con los requisitos y el botón para
// avanzar.

const REFRESH_SECONDS = 0.3;

function icon(id) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${id}" /></svg>`;
}

export class AgeUI {
  constructor({ colony, timeLabel }) {
    this.colony = colony;
    this.timeLabel = timeLabel;
    this.timer = 0;
    const $ = (id) => document.getElementById(id);
    this.wrap = $('age-wrap');
    this.bar = $('age-bar');
    this.panel = $('age-panel');
    this.numeral = $('age-numeral');
    this.name = $('age-name');
    this.progressLabel = $('age-progress-label');
    this.progressFill = $('age-progress-fill');
    this.renderedFor = null;

    this.bar.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) this.toggle(false);
    });
  }

  toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.bar.setAttribute('aria-expanded', String(open));
    this.renderedFor = null;
    if (open) {
      this.onOpen?.();
      this.render();
    }
  }

  update(delta) {
    this.timer -= delta;
    if (this.timer > 0) return;
    this.timer = REFRESH_SECONDS;
    const colony = this.colony;
    this.wrap.hidden = !colony.camp;
    if (!colony.camp) {
      this.toggle(false);
      return;
    }
    const age = ageInfo(colony.age);
    const status = nextAgeStatus(colony);
    this.numeral.textContent = age.numeral;
    this.name.textContent = age.name;
    let label;
    let fill;
    if (!status.next) {
      label = 'La edad más avanzada';
      fill = 1;
    } else if (status.soon) {
      label = `${status.next.name}: próximamente`;
      fill = 1;
    } else if (status.checks.some((c) => !c.ok)) {
      const done = status.checks.filter((c) => c.ok).length;
      label = `Hacia la ${status.next.name} · ${done}/${status.checks.length} requisitos`;
      fill = done / status.checks.length;
    } else if (status.missing.length) {
      label = `Faltan materiales para la ${status.next.name}`;
      fill = 0.95;
    } else {
      label = `¡Lista para la ${status.next.name}!`;
      fill = 1;
    }
    this.progressLabel.textContent = label;
    this.progressFill.style.width = `${Math.round(fill * 100)}%`;
    this.bar.classList.toggle('is-ready', !!status.ready);
    this.bar.title = `${age.name}. ${label}. Pulsa para ver las edades.`;
    if (!this.panel.hidden) this.render();
  }

  render() {
    const colony = this.colony;
    const status = nextAgeStatus(colony);
    const stock = colony.stock;
    const key = [colony.age, JSON.stringify(status.checks ?? []), status.ready, JSON.stringify(status.missing ?? []), Math.floor(Object.values(stock).reduce((a, b) => a + b, 0))].join('|');
    if (this.renderedFor === key) return;
    this.renderedFor = key;

    const rows = unlockTable();
    const lim = limitsFor(colony.age);
    const list = AGES.map((a) => {
      const cls = a.n < colony.age ? 'is-past' : a.n === colony.age ? 'is-now' : a.soon ? 'is-soon' : '';
      const tag = a.n < colony.age ? 'Superada' : a.n === colony.age ? 'Actual' : a.soon ? 'Próximamente' : '';
      return `
        <li class="age-item ${cls}">
          <span class="age-medal">${a.numeral}</span>
          <div>
            <h3>${a.name}${tag ? `<small>${tag}</small>` : ''}</h3>
            <p>${a.desc}</p>
            ${
              a.soon
                ? `<p class="reason" style="margin:4px 0 0">Aún no disponible. Planeado: ${a.unlocks.join(', ')}.</p>`
                : a.n < colony.age
                  ? ''
                  : `<ul class="age-rows">${rows
                      .filter((r) => r.age === a.n)
                      .map((r) => `<li><strong>${r.name}</strong><span>${r.text}</span></li>`)
                      .join('')}</ul>`
            }
          </div>
        </li>`;
    }).join('');

    let req = '';
    if (status.next && !status.soon) {
      const cost = status.next.requires.cost;
      const checks = [
        ...status.checks.map(
          (c) => `<div class="age-check ${c.ok ? 'is-ok' : ''}"><span>${c.label}</span><strong>${Math.min(c.have, c.need)}/${c.need}</strong></div>`,
        ),
        ...Object.entries(cost).map(
          ([k, n]) => `
          <div class="age-check ${(stock[k] ?? 0) >= n ? 'is-ok' : ''}">
            <span>${icon(k)} Ofrenda de ${STOCK_NAMES[k]}</span><strong>${Math.min(Math.floor(stock[k] ?? 0), n)}/${n}</strong>
          </div>`,
        ),
      ].join('');
      req = `
        <div class="age-req">
          <h3>Para llegar a la ${status.next.name}</h3>
          <p class="reason" style="margin:0">Cuando la aldea cumpla todo, la tribu celebra el cambio con una ofrenda. Las viviendas evolucionan solas; el resto de edificios se mejora desde su ficha, pagando, y sólo hasta el nivel que permite la edad.</p>
          ${checks}
          <button type="button" class="btn btn--primary" data-advance ${status.ready ? '' : 'disabled'}>Avanzar a la ${status.next.name}</button>
        </div>`;
    } else if (status.soon) {
      req = `<div class="age-req"><h3>${status.next.name}</h3><p class="reason" style="margin:0">Llegará en una próxima actualización.</p></div>`;
    }

    this.panel.innerHTML = `
      <div class="cp-head" style="padding:0 0 10px">
        <div>
          <p class="eyebrow">Edades de la colonia</p>
          <h2 class="cp-name">${ageInfo(colony.age).name}</h2>
        </div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar">${icon('close')}</button>
      </div>
      <p class="reason age-limits">Ahora puedes: territorio de <strong>${lim.radius} m</strong>, hasta <strong>${lim.houses}</strong> viviendas y <strong>${lim.perType}</strong> edificios de cada tipo; los edificios llegan hasta el nivel <strong>${ageInfo(colony.age).numeral}</strong>.</p>
      <ol class="age-list">${list}</ol>
      ${req}`;
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.toggle(false));
    this.panel.querySelector('[data-advance]')?.addEventListener('click', () => {
      if (colony.advanceAge(this.timeLabel?.() ?? '')) {
        this.renderedFor = null;
        this.timer = 0;
      }
    });
  }
}
