import { AGES, AGE_HOOKS, ageInfo, nextAgeStatus } from './ages.js';
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
    this.modal = $('age-modal');
    this.panel = $('age-panel');
    this.tab = 'resumen';
    this.numeral = $('age-numeral');
    this.name = $('age-name');
    this.progressLabel = $('age-progress-label');
    this.progressFill = $('age-progress-fill');
    this.renderedFor = null;

    this.bar.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.hidden) this.toggle(false);
    });
    // Clic fuera de la ventana: se cierra. Nada de lo que pasa dentro llega al mundo.
    this.modal.addEventListener('pointerdown', (e) => {
      if (e.target === this.modal) this.toggle(false);
    });
    // Un solo manejador para todos los botones: la ventana se redibuja sola y un clic a medias no se pierde.
    this.panel.addEventListener('click', (e) => {
      const hit = (sel) => e.target.closest(sel);
      if (hit('[data-close]')) this.toggle(false);
      const tab = hit('[data-agetab]');
      if (tab) {
        this.tab = tab.dataset.agetab;
        this.renderedFor = null;
        this.render();
      }
      if (hit('[data-advance]') && this.colony.advanceAge(this.timeLabel?.() ?? '')) {
        this.renderedFor = null;
        this.timer = 0;
      }
    });
    this.modal.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  toggle(open = this.modal.hidden) {
    this.modal.hidden = !open;
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
      label = `${status.next.name} · ${done}/${status.checks.length}`;
      fill = done / status.checks.length;
    } else if (status.missing.length) {
      label = 'Faltan materiales';
      fill = 0.95;
    } else {
      label = '¡Lista para avanzar!';
      fill = 1;
    }
    this.progressLabel.textContent = label;
    this.progressFill.style.width = `${Math.round(fill * 100)}%`;
    this.bar.classList.toggle('is-ready', !!status.ready);
    this.bar.title = `${age.name}. ${label}. Pulsa para ver las edades.`;
    if (!this.modal.hidden) this.render();
  }

  render() {
    const colony = this.colony;
    const status = nextAgeStatus(colony);
    const stock = colony.stock;
    const key = [this.tab, colony.age, JSON.stringify(status.checks ?? []), status.ready, JSON.stringify(status.missing ?? []), Math.floor(Object.values(stock).reduce((a, b) => a + b, 0))].join('|');
    if (this.renderedFor === key) return;
    this.renderedFor = key;

    const rows = unlockTable();
    const lim = limitsFor(colony.age);
    const list = AGES.map((a) => {
      const reach = a.n <= colony.age || AGE_HOOKS.reachable(a);
      const cls = a.n < colony.age ? 'is-past' : a.n === colony.age ? 'is-now' : reach ? '' : 'is-soon';
      const tag = a.n < colony.age ? 'Superada' : a.n === colony.age ? 'Actual' : a.future ? 'Opcional' : reach ? '' : 'Próximamente';
      const mine = rows.filter((r) => r.age === a.n);
      const detail = !reach
        ? `<p class="reason" style="margin:4px 0 0">${a.future ? 'Extensión opcional: la arquitectura está preparada pero la edad aún no se puede alcanzar.' : 'Aún no disponible en el juego.'}</p>`
        : a.n < colony.age
          ? ''
          : `<p class="reason" style="margin:4px 0 2px"><strong>Cambia sola:</strong> ${a.auto}</p>
             <ul class="age-rows">${mine.map((r) => `<li><strong>${r.name}</strong><span>${r.text}</span></li>`).join('')}</ul>`;
      return `
        <li class="age-item ${cls}">
          <span class="age-medal">${a.numeral}</span>
          <div>
            <h3>${a.name}${tag ? `<small>${tag}</small>` : ''}</h3>
            <p>${a.theme} · ${a.desc}</p>
            ${detail}
          </div>
        </li>`;
    }).join('');

    let req = '';
    if (status.next && !status.soon) {
      const cost = status.next.requires.cost;
      const checks = [
        ...status.checks.map(
          (c) => `<div class="age-check ${c.ok ? 'is-ok' : ''}"><span>${c.label}</span><strong>${Math.min(c.have, c.need)}/${c.need}</strong></div>${c.hint ? `<p class="reason age-hint">${c.hint}</p>` : ''}`,
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
          <p class="reason" style="margin:0">Cuando la aldea cumpla todo, la tribu celebra el cambio con una ofrenda de materiales (se gasta). Las reservas de comida y agua que se piden se conservan. Las viviendas nuevas ya salen con el aspecto de la edad; todos los edificios, viviendas incluidas, se mejoran desde su ficha pagando y sólo hasta el nivel que permite la edad (cambiar de edad no mejora nada gratis).</p>
          ${checks}
          <button type="button" class="btn btn--primary" data-advance ${status.ready ? '' : 'disabled'}>Avanzar a la ${status.next.name}</button>
        </div>`;
    } else if (status.soon) {
      req = `<div class="age-req"><h3>${status.next.name}</h3><p class="reason" style="margin:0">Llegará en una próxima actualización.</p></div>`;
    }

    const here = ageInfo(colony.age);
    const nowRows = rows.filter((r) => r.age === colony.age);
    const nextRows = status.next ? rows.filter((r) => r.age === status.next.n) : [];
    const doneCount = status.checks ? status.checks.filter((c) => c.ok).length : 0;
    const pages = {
      resumen: `
        <p class="reason"><strong>${here.theme}</strong> · ${here.desc}</p>
        <p class="reason age-limits">Ahora puedes: territorio de <strong>${colony.territoryRadius} m</strong> (hasta ${lim.expansions} ampliaciones), hasta <strong>${lim.houses}</strong> viviendas, <strong>${lim.perType}</strong> edificios de cada tipo y hasta <strong>${lim.popCap}</strong> habitantes (si construís bastante vivienda: cada casa da sus propias plazas).</p>
        <h3 class="age-sub">Disponible en esta edad</h3>
        <ul class="age-rows">${nowRows.map((r) => `<li><strong>${r.name}</strong><span>${r.text}</span></li>`).join('') || '<li><span>Todo lo básico.</span></li>'}</ul>
        ${status.next && !status.soon ? `<p class="reason">Siguiente: <strong>${status.next.name}</strong> · ${doneCount}/${status.checks.length} requisitos${status.ready ? ' · ¡lista!' : ''}. Mira la pestaña «Siguiente edad».</p>` : ''}`,
      siguiente: req || '<p class="reason">No hay una edad siguiente disponible.</p>',
      todas: `<ol class="age-list">${list}</ol>`,
    };
    const tabs = [['resumen', 'Resumen'], ['siguiente', 'Siguiente edad'], ['todas', 'Todas las edades']];
    this.panel.innerHTML = `
      <div class="cp-head" style="padding:0 0 10px">
        <div>
          <p class="eyebrow">Edades de la colonia</p>
          <h2 class="cp-name">${here.name}</h2>
        </div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar (Escape)" title="Cerrar (Escape)">${icon('close')}</button>
      </div>
      <div class="cp-tabs" role="tablist">${tabs.map(([id, t]) => `<button type="button" class="cp-tab" role="tab" data-agetab="${id}" aria-selected="${this.tab === id}">${t}</button>`).join('')}</div>
      <div class="age-body">${pages[this.tab] ?? pages.resumen}</div>`;
  }
}
