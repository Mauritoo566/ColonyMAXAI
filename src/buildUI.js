import { BUILDING_TYPES, BUILD_CATEGORIES, STOCK_NAMES } from './buildings.js';
import { SKILLS } from './needs.js';

// Interfaz de construcción: barra para elegir qué construir, el almacén de la colonia
// y la ficha de cada edificio (obra, trabajador asignado y candidatos).

const REFRESH_SECONDS = 0.25;
const TAB_KEY = 'colonymaxai.buildTab';
const STOCK = [
  { id: 'food', icon: 'food', color: 'var(--food)' },
  { id: 'water', icon: 'water', color: 'var(--water)' },
  { id: 'wood', icon: 'wood', color: '#c08a52' },
  { id: 'stone', icon: 'stone', color: '#a8a39a' },
];

function icon(id) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${id}" /></svg>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function paintAvatar(el, look) {
  el.style.setProperty('--hair', look.hair);
  el.style.setProperty('--skin', look.skin);
  el.style.setProperty('--shirt', look.shirt);
}

function costHtml(def, stock) {
  return Object.entries(def.cost)
    .map(([k, n]) => `<span class="${stock[k] < n ? 'is-short' : ''}">${icon(k)}${n}</span>`)
    .join('');
}

export class BuildUI {
  constructor({ buildings, colony, onFocusColonist }) {
    this.buildings = buildings;
    this.colony = colony;
    this.onFocusColonist = onFocusColonist;
    this.timer = 0;
    const $ = (id) => document.getElementById(id);
    this.bar = $('build-bar');
    this.list = $('build-list');
    this.stock = $('stock');
    this.panel = $('building-panel');

    this.stock.innerHTML = STOCK.map(
      (s) => `<li data-stock="${s.id}" style="--res:${s.color}" title="${STOCK_NAMES[s.id]}">${icon(s.icon)}<span>0</span></li>`,
    ).join('');

    // Pestañas por categoría; la lista muestra sólo los edificios de la elegida.
    this.tabs = $('build-tabs');
    this.tabs.innerHTML = BUILD_CATEGORIES.map((cat) => {
      const count = BUILDING_TYPES.filter((d) => d.category === cat.id).length;
      const soon = count === 0;
      return `
      <button type="button" class="build-tab" role="tab" data-cat="${cat.id}" aria-selected="false"
        title="${cat.name}${soon ? ' · próximamente' : ''}" ${soon ? 'data-soon="true"' : ''}>
        ${icon(cat.icon)}<span class="build-tab-name">${cat.name}</span>${soon ? '' : `<span class="build-tab-count">${count}</span>`}
      </button>`;
    }).join('');
    this.list.innerHTML = BUILDING_TYPES.map(
      (def) => `
      <button type="button" class="build-item" data-build="${def.id}" data-cat="${def.category}" aria-pressed="false">
        <span class="build-icon">${icon(def.icon)}</span>
        <span class="build-name">${def.name}</span>
        <span class="build-cost"></span>
      </button>`,
    ).join('') + BUILD_CATEGORIES.filter((cat) => !BUILDING_TYPES.some((d) => d.category === cat.id)).map(
      (cat) => `
      <div class="build-soon" data-cat="${cat.id}">
        <span class="build-icon">${icon(cat.icon)}</span>
        <span><strong>Próximamente</strong>${cat.soon}</span>
      </div>`,
    ).join('');
    for (const button of this.list.querySelectorAll('[data-build]')) {
      button.addEventListener('click', () => {
        const def = BUILDING_TYPES.find((d) => d.id === button.dataset.build);
        if (buildings.placing === def) buildings.stopPlacing();
        else if (buildings.canAfford(def)) buildings.startPlacing(def.id);
      });
    }
    for (const tab of this.tabs.children) {
      tab.addEventListener('click', () => {
        // Volver a pulsar la pestaña abierta pliega la barra.
        this.setTab(this.tab === tab.dataset.cat && !this.collapsed ? null : tab.dataset.cat);
      });
    }
    let saved = null;
    try {
      saved = localStorage.getItem(TAB_KEY);
    } catch {
      saved = null;
    }
    const first = BUILD_CATEGORIES.find((c) => BUILDING_TYPES.some((d) => d.category === c.id));
    this.tab = first.id;
    this.setTab(saved === 'none' ? null : BUILD_CATEGORIES.some((c) => c.id === saved) ? saved : first.id);

    buildings.onSelect = (b) => this.show(b);
    buildings.onChange = () => {
      this.timer = 0;
    };
  }

  // Elige la categoría visible (null = barra plegada).
  setTab(id) {
    this.collapsed = !id;
    if (id) this.tab = id;
    for (const tab of this.tabs.children) tab.setAttribute('aria-selected', String(!this.collapsed && tab.dataset.cat === this.tab));
    for (const item of this.list.children) item.hidden = item.dataset.cat !== this.tab;
    this.list.hidden = this.collapsed;
    this.bar.classList.toggle('is-collapsed', this.collapsed);
    try {
      localStorage.setItem(TAB_KEY, id ?? 'none');
    } catch {
      // Sin almacenamiento: se recuerda sólo en esta sesión.
    }
  }

  update(delta) {
    this.timer -= delta;
    if (this.timer > 0) return;
    this.timer = REFRESH_SECONDS;
    const hasCamp = !!this.colony.camp;
    this.bar.hidden = !hasCamp;
    if (!hasCamp) {
      this.panel.hidden = true;
      return;
    }
    const stock = this.colony.stock;
    for (const li of this.stock.children) {
      const v = Math.floor(stock[li.dataset.stock]);
      li.lastChild.textContent = String(v);
      li.classList.toggle('is-empty', v <= 0);
      li.title = `${STOCK_NAMES[li.dataset.stock]}: ${v}`;
    }
    for (const button of this.list.querySelectorAll('[data-build]')) {
      const def = BUILDING_TYPES.find((d) => d.id === button.dataset.build);
      const affordable = this.buildings.canAfford(def);
      button.setAttribute('aria-disabled', String(!affordable));
      button.setAttribute('aria-pressed', String(this.buildings.placing === def));
      button.title = affordable ? `${def.desc} Haz clic y elige dónde construirlo.` : `${def.desc} Faltan ${this.buildings.missing(def).join(' y ')}.`;
      const cost = costHtml(def, stock);
      const el = button.querySelector('.build-cost');
      if (el.dataset.html !== cost) {
        el.innerHTML = cost;
        el.dataset.html = cost;
      }
    }
    if (this.buildings.selected) this.render(this.buildings.selected);
  }

  // ---- Ficha del edificio ----------------------------------------------------

  show(b) {
    if (!b) {
      this.panel.hidden = true;
      return;
    }
    this.onOpen?.();
    this.panel.hidden = false;
    this.renderedFor = null;
    this.render(b);
  }

  render(b) {
    const def = b.def;
    const skill = SKILLS.find((s) => s.id === def.skill);
    const state = !b.done ? `En construcción · ${Math.round(b.progress * 100)}%` : b.worker ? 'Funcionando' : 'Sin trabajador';
    const ranking = this.buildings.ranking(b);
    // Clave para no redibujar si nada cambió.
    const key = [state, b.worker?.id, Math.floor(b.produced), b.status, b.reason, ranking.map((c) => `${c.id}${c.job?.id ?? ''}`).join()].join('|');
    if (this.renderedFor === key) return;
    this.renderedFor = key;

    const produced = def.id === 'well' ? `${Math.floor(b.produced)} jarras de agua` : `${Math.floor(b.produced)} de ${STOCK_NAMES[def.stock]}`;
    this.panel.innerHTML = `
      <header class="cp-head">
        <span class="bp-icon">${icon(def.icon)}</span>
        <div>
          <h2 class="cp-name">${def.name}</h2>
          <p class="cp-sub">${state}</p>
        </div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar ficha">${icon('close')}</button>
      </header>
      <div class="cp-body">
        <p class="reason">${def.desc}</p>
        ${
          !b.done
            ? `<section class="cp-section">
                <h3>Obra</h3>
                <div class="bar bar--thick" style="--bar:var(--accent)"><i style="width:${Math.round(b.progress * 100)}%"></i></div>
                <p class="reason">Los colonos construyen de día cuando tienen lo básico cubierto. Quien sabe más de construcción avanza más rápido. Al terminar, la colonia elegirá a la persona más capacitada en ${skill.name.toLowerCase()} para trabajar aquí.</p>
              </section>`
            : `<section class="cp-section">
                <h3>Trabajador</h3>
                ${
                  b.worker
                    ? `<div class="worker-card">
                        <span class="avatar"></span>
                        <div><div class="worker-name">${escapeHtml(b.worker.name)}</div><div class="reason">${skill.name}: ${b.worker.skills[def.skill]}/10</div></div>
                        <button type="button" class="btn" data-see-worker>Ver</button>
                      </div>`
                    : ''
                }
                <p class="reason">${escapeHtml(b.reason)}</p>
                ${b.status ? `<p class="reason" style="color:var(--warn)">${escapeHtml(b.status)}</p>` : ''}
              </section>
              <section class="cp-section">
                <h3>Producción</h3>
                <div class="stat-line"><span>Ha producido</span><strong>${produced}</strong></div>
              </section>`
        }
        <section class="cp-section">
          <h3>Más capacitados en ${skill.name.toLowerCase()}</h3>
          <ul class="candidate-list">
            ${ranking
              .map(
                (c) => `
              <li class="candidate">
                <span class="avatar" data-avatar="${c.id}"></span>
                <span>${escapeHtml(c.name)}${c.job && c.job !== b ? ` <span class="reason">· ${escapeHtml(c.job.def.job)}</span>` : ''}</span>
                <span class="bar"><i style="width:${c.skills[def.skill] * 10}%"></i></span>
                ${b.done ? `<button type="button" data-assign="${c.id}" ${b.worker === c ? 'disabled' : ''}>${b.worker === c ? 'Asignado' : 'Asignar'}</button>` : `<span class="reason">${c.skills[def.skill]}/10</span>`}
              </li>`,
              )
              .join('')}
          </ul>
        </section>
      </div>`;
    if (b.worker) paintAvatar(this.panel.querySelector('.worker-card .avatar'), b.worker.look);
    for (const el of this.panel.querySelectorAll('[data-avatar]')) {
      paintAvatar(el, this.colony.colonists.find((c) => c.id === Number(el.dataset.avatar)).look);
    }
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.buildings.select(null));
    this.panel.querySelector('[data-see-worker]')?.addEventListener('click', () => this.onFocusColonist?.(b.worker));
    for (const button of this.panel.querySelectorAll('[data-assign]')) {
      button.addEventListener('click', () => {
        const c = this.colony.colonists.find((o) => o.id === Number(button.dataset.assign));
        this.buildings.setWorker(b, c);
      });
    }
  }
}
