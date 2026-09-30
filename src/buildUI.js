import { BUILDING_TYPES, BUILD_CATEGORIES, STOCK_NAMES, levelOf } from './buildings.js';
import { AGES, ageInfo } from './ages.js';
import { FOOD_SPOIL_SECONDS, ZONE_RADIUS, zoneCapacity } from './colonists.js';

const DAY_SECONDS = 360;
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
  { id: 'fiber', icon: 'fiber', color: '#b5c46a' },
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
  constructor({ buildings, colony, harvest, onFocusColonist }) {
    this.buildings = buildings;
    this.harvest = harvest;
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
    ).join('') + `
      <button type="button" class="build-item build-item--zone" data-zone data-cat="storage" aria-pressed="false"
        title="Dibuja un área al aire libre donde se amontona lo que no cabe en el almacén. La comida ahí se pudre.">
        <span class="build-icon">${icon('stone')}</span>
        <span class="build-name">Zona al aire libre</span>
        <span class="build-cost"><span>Gratis</span></span>
      </button>` + BUILD_CATEGORIES.filter((cat) => !BUILDING_TYPES.some((d) => d.category === cat.id)).map(
      (cat) => `
      <div class="build-soon" data-cat="${cat.id}">
        <span class="build-icon">${icon(cat.icon)}</span>
        <span><strong>Próximamente</strong>${cat.soon}</span>
      </div>`,
    ).join('');
    this.list.querySelector('[data-zone]').addEventListener('click', () => {
      if (buildings.placing) buildings.stopPlacing();
      const on = !(harvest.active && harvest.mode === 'zone');
      harvest.setActive(on, on ? 'zone' : 'mark');
    });
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

    // Herramienta de recolección: reemplaza la lista de edificios mientras está activa.
    this.harvestButton = $('harvest-button');
    this.harvestCount = $('harvest-count');
    this.harvestTools = $('harvest-tools');
    this.harvestHint = $('harvest-hint');
    this.harvestButton.addEventListener('click', () => {
      if (buildings.placing) buildings.stopPlacing();
      harvest.setActive(!harvest.active);
    });
    for (const button of this.harvestTools.querySelectorAll('[data-harvest-mode]')) {
      button.addEventListener('click', () => harvest.setActive(true, button.dataset.harvestMode));
    }
    $('harvest-clear').addEventListener('click', () => colony.clearMarks());
    harvest.onChange = () => this.refreshHarvest();
    buildings.onPlacingStart = () => harvest.setActive(false);

    // Clic en la fila del almacén (tarjeta de la colonia): abrir la ficha del almacén.
    this.stock.addEventListener('click', () => {
      if (buildings.store) buildings.select(buildings.store);
    });
    this.stock.title = 'Ver el almacén';

    buildings.onSelect = (b) => this.show(b);
    buildings.onChange = () => {
      this.timer = 0;
    };
  }

  refreshHarvest() {
    const h = this.harvest;
    const n = this.colony.markedCount;
    const zoning = h.active && h.mode === 'zone';
    this.harvestButton.setAttribute('aria-pressed', String(h.active && !zoning));
    this.list.querySelector('[data-zone]').setAttribute('aria-pressed', String(zoning));
    this.harvestCount.hidden = n === 0;
    this.harvestCount.textContent = String(n);
    this.harvestTools.hidden = !h.active || zoning;
    this.harvestTools.querySelector('.harvest-modes').hidden = zoning;
    if (zoning) {
      // Dibujando una zona: se sigue viendo la pestaña Almacenes, con el aviso abajo.
      this.setTab('storage', false);
      this.showZoneHint(h.message);
      return;
    }
    this.showZoneHint(null, true);
    if (h.active) {
      this.list.hidden = true;
      this.bar.classList.remove('is-collapsed');
      for (const tab of this.tabs.children) tab.setAttribute('aria-selected', 'false');
    } else {
      this.setTab(this.collapsed ? null : this.tab, false);
    }
    for (const b of this.harvestTools.querySelectorAll('[data-harvest-mode]')) b.setAttribute('aria-pressed', String(b.dataset.harvestMode === h.mode));
    this.harvestHint.innerHTML =
      h.mode === 'mark'
        ? `Arrastra sobre el terreno para marcar un área (o haz clic en un recurso). ${n ? `<strong>${n} marcados</strong>: los colonos disponibles irán a recogerlos.` : 'Los colonos disponibles irán a recolectar árboles, bayas, setas y piedras marcados.'}`
        : `Arrastra sobre un área marcada para quitar las marcas. ${n ? `<strong>${n} marcados</strong>.` : ''}`;
  }

  showZoneHint(problem, hide = false) {
    let el = this.zoneHint;
    if (!el) {
      el = this.zoneHint = document.createElement('p');
      el.className = 'zone-hint';
      this.list.after(el);
    }
    el.hidden = hide;
    if (hide) return;
    const hours = Math.round((FOOD_SPOIL_SECONDS / DAY_SECONDS) * 24);
    el.innerHTML = problem
      ? `<strong style="color:var(--bad)">${problem}.</strong> Prueba en otro lugar.`
      : `<strong>Arrastra sobre el terreno</strong> para dibujar la zona (de ${ZONE_RADIUS[0]} a ${ZONE_RADIUS[1]} m de radio). Lo que no quepa en el almacén se amontonará ahí; la comida al aire libre se pudre en ${hours} h. Esc para cancelar.`;
  }

  // Elige la categoría visible (null = barra plegada).
  setTab(id, closeTool = true) {
    if (closeTool && this.harvest?.active) this.harvest.setActive(false);
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
      const cap = this.colony.capacity(li.dataset.stock);
      li.lastChild.textContent = String(v);
      li.classList.toggle('is-empty', v <= 0);
      const out = Math.floor(this.colony.outdoor[li.dataset.stock] ?? 0);
      li.classList.toggle('is-full', this.colony.isFull(li.dataset.stock));
      li.title = `${STOCK_NAMES[li.dataset.stock]}: ${v - out} de ${cap} en el almacén${out ? ` + ${out} al aire libre` : ''}`;
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

  // ---- Almacén ------------------------------------------------------------------

  // Filas "recurso: guardado / capacidad" con barra.
  stockRowsHtml() {
    const colony = this.colony;
    return STOCK.map((r) => {
      const have = Math.max(0, Math.floor(colony.indoor(r.id)));
      const out = Math.floor(colony.outdoor[r.id] ?? 0);
      const cap = colony.capacity(r.id);
      const fill = Math.min(1, have / cap);
      const tone = fill >= 1 ? 'var(--bad)' : fill > 0.85 ? 'var(--warn)' : r.color;
      return `
        <div class="store-row">
          <span class="store-name" style="--res:${r.color}">${icon(r.icon)}${STOCK_NAMES[r.id]}</span>
          <span class="bar" style="--bar:${tone}"><i style="width:${Math.round(fill * 100)}%"></i></span>
          <strong>${have}<small> / ${cap}${out ? ` · +${out} afuera` : ''}</small></strong>
        </div>`;
    }).join('');
  }

  // Lo guardado al aire libre, las zonas y cuándo se pudre la comida.
  outdoorHtml() {
    const colony = this.colony;
    const cap = colony.outdoorCapacity();
    const used = colony.outdoorUsed();
    const next = colony.foodBatches[0];
    const hoursLeft = next ? Math.max(0, ((next.expires - colony.gameTime) / DAY_SECONDS) * 24) : 0;
    const items = STOCK.filter((r) => (colony.outdoor[r.id] ?? 0) >= 1)
      .map((r) => `<span style="--res:${r.color}">${icon(r.icon)}${Math.floor(colony.outdoor[r.id])}</span>`)
      .join('');
    return `<section class="cp-section">
        <h3>Al aire libre</h3>
        ${
          colony.zones.length
            ? `<div class="stat-line"><span>Ocupado</span><strong>${Math.floor(used)} / ${cap}</strong></div>
               ${items ? `<div class="store-adds">${items}</div>` : '<p class="reason">Todavía no hay nada amontonado: se usa cuando el almacén se llena.</p>'}
               ${next ? `<p class="reason" style="color:var(--warn)">${Math.ceil(next.amount)} de comida se pudre en ${hoursLeft < 1 ? 'menos de 1 h' : `${Math.round(hoursLeft)} h`}. Se come primero lo que está afuera.</p>` : ''}
               <ul class="zone-list">
                 ${colony.zones
                   .map((z, i) => `<li><span>Zona ${i + 1} · ${Math.round(z.r)} m · cabe ${zoneCapacity(z)}</span><button type="button" class="btn" data-remove-zone="${i}">Quitar</button></li>`)
                   .join('')}
               </ul>`
            : '<p class="reason">No hay zonas. Dibuja una para que lo que no cabe en el almacén se amontone al aire libre en vez de que los colonos dejen de trabajar.</p>'
        }
        ${colony.spoiled >= 1 ? `<p class="reason">Comida perdida por pudrirse: ${Math.floor(colony.spoiled)}</p>` : ''}
        <button type="button" class="btn" data-new-zone>${icon('stone')}Dibujar zona al aire libre</button>
      </section>`;
  }

  // Lo que suma un almacén construido (y lo que sumará mejorado).
  storageAddsHtml(level, next) {
    const list = (cap) => STOCK.map((r) => `<span style="--res:${r.color}">${icon(r.icon)}+${cap[r.id] ?? 0}</span>`).join('');
    return `<section class="cp-section">
        <h3>Amplía el almacén</h3>
        <div class="store-adds">${list(level.capacity)}</div>
        ${next ? `<p class="reason">Mejorado a ${next.name}: <span class="store-adds store-adds--inline">${list(next.capacity)}</span></p>` : ''}
      </section>
      <section class="cp-section">
        <h3>Almacén de la colonia</h3>
        ${this.stockRowsHtml()}
      </section>`;
  }

  renderStore(b) {
    const colony = this.colony;
    const piles = this.buildings.list.filter((o) => o.def.id === 'stockpile' && (o.done || o.upgrading)).length;
    const key = ['store', piles, JSON.stringify(STOCK.map((r) => [Math.floor(colony.stock[r.id] ?? 0), colony.capacity(r.id), Math.floor(colony.outdoor[r.id] ?? 0)])), JSON.stringify(colony.zones), Math.floor(colony.spoiled), Math.floor(((colony.foodBatches[0]?.expires ?? 0) - colony.gameTime) / 15)].join('|');
    if (this.renderedFor === key) return;
    this.renderedFor = key;
    this.panel.innerHTML = `
      <header class="cp-head">
        <span class="bp-icon">${icon('wood')}</span>
        <div>
          <h2 class="cp-name">${b.name}</h2>
          <p class="cp-sub">${Math.round(this.buildings.storeFill() * 100)}% lleno en lo más ocupado</p>
        </div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar ficha">${icon('close')}</button>
      </header>
      <div class="cp-body">
        <p class="reason">Las vasijas, cestas y sacos junto a la fogata. Aquí los colonos dejan lo que recogen y de aquí comen y beben cuando no hay nada cerca.</p>
        <section class="cp-section">
          <h3>Guardado</h3>
          ${this.stockRowsHtml()}
        </section>
        <section class="cp-section">
          <h3>Capacidad</h3>
          <div class="stat-line"><span>Almacenes construidos</span><strong>${piles}</strong></div>
          <p class="reason">Cuando algo se llena, quien lo trae espera sin trabajar. Construye almacenes en la pestaña <strong>Almacenes</strong> de la barra de construcción (y mejóralos a granero) para guardar más.</p>
          <button type="button" class="btn btn--primary" data-open-storage>${icon('wood')}Construir un almacén</button>
        </section>
        ${this.outdoorHtml()}
      </div>`;
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.buildings.select(null));
    for (const button of this.panel.querySelectorAll('[data-remove-zone]')) {
      button.addEventListener('click', () => this.colony.removeZone(Number(button.dataset.removeZone)));
    }
    this.panel.querySelector('[data-new-zone]')?.addEventListener('click', () => {
      this.buildings.select(null);
      this.harvest.setActive(true, 'zone');
    });
    this.panel.querySelector('[data-open-storage]').addEventListener('click', () => {
      this.setTab('storage');
      this.buildings.select(null);
    });
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
    if (b.isStore) return this.renderStore(b);
    const def = b.def;
    const skill = SKILLS.find((s) => s.id === def.skill);
    const isStorage = !def.skill;
    const level = levelOf(b);
    const next = levelOf(b, 1);
    const age = ageInfo(b.level);
    const state = b.upgrading
      ? `Mejorando · ${Math.round(b.progress * 100)}%`
      : !b.done
        ? `En construcción · ${Math.round(b.progress * 100)}%`
        : isStorage
          ? 'En uso'
          : b.worker
            ? 'Funcionando'
            : 'Sin trabajador';
    const ranking = isStorage ? [] : this.buildings.ranking(b);
    const upgradeProblem = this.buildings.upgradeProblem(b);
    const stored = level.rainOnly ? Math.floor(b.store) : null;
    // Clave para no redibujar si nada cambió.
    const key = [state, b.level, b.worker?.id, Math.floor(b.produced), b.status, b.reason, upgradeProblem, stored, this.colony.age, ranking.map((c) => `${c.id}${c.job?.id ?? ''}`).join()].join('|');
    if (this.renderedFor === key) return;
    this.renderedFor = key;

    const produced = isStorage ? '' : def.id === 'well' ? `${Math.floor(b.produced)} jarras de agua` : `${Math.floor(b.produced)} de ${STOCK_NAMES[def.stock]}`;
    this.panel.innerHTML = `
      <header class="cp-head">
        <span class="bp-icon">${icon(def.icon)}</span>
        <div>
          <h2 class="cp-name">${b.name}</h2>
          <p class="cp-sub"><span class="level-chip">Nivel ${b.level} · ${age.name}</span> ${state}</p>
        </div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar ficha">${icon('close')}</button>
      </header>
      <div class="cp-body">
        <p class="reason">${level.desc}</p>
        ${
          b.upgrading
            ? `<section class="cp-section">
                <h3>Mejora a ${next.name}</h3>
                <div class="bar bar--thick" style="--bar:var(--accent)"><i style="width:${Math.round(b.progress * 100)}%"></i></div>
                <p class="reason">Los constructores trabajan en la mejora. Mientras tanto no se produce nada; al terminar, ${b.worker ? escapeHtml(b.worker.name) + ' vuelve a su trabajo' : 'la colonia elegirá un trabajador'}.</p>
              </section>`
            : !b.done
            ? `<section class="cp-section">
                <h3>Obra</h3>
                <div class="bar bar--thick" style="--bar:var(--accent)"><i style="width:${Math.round(b.progress * 100)}%"></i></div>
                <p class="reason">Los colonos construyen de día cuando tienen lo básico cubierto. Quien sabe más de construcción avanza más rápido. ${isStorage ? 'Al terminar, el almacén de la colonia podrá guardar más.' : `Al terminar, la colonia elegirá a la persona más capacitada en ${skill.name.toLowerCase()} para trabajar aquí.`}</p>
              </section>`
            : `${isStorage ? this.storageAddsHtml(level, next) : `<section class="cp-section">
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
                ${stored !== null ? `<div class="stat-line"><span>Agua en las vasijas</span><strong>${stored} / ${level.capacity}</strong></div>` : ''}
              </section>`}
              <section class="cp-section">
                <h3>Mejora</h3>
                <ol class="level-track" aria-label="Niveles">
                  ${AGES.map((a) => `<li class="${a.n < b.level ? 'is-past' : a.n === b.level ? 'is-now' : ''}" title="${a.name}">${a.numeral}</li>`).join('')}
                </ol>
                ${
                  next
                    ? `<div class="upgrade-card">
                        <div class="upgrade-title"><span>Siguiente nivel</span><strong>${next.name}</strong></div>
                        <p class="reason">${next.desc}</p>
                        <div class="upgrade-foot">
                          <span class="build-cost">${costHtml({ cost: next.upgradeCost }, this.colony.stock)}</span>
                          <button type="button" class="btn btn--primary" data-upgrade ${upgradeProblem ? 'disabled' : ''}>${icon('hammer')}Mejorar</button>
                        </div>
                        ${upgradeProblem ? `<p class="reason" style="color:var(--warn)">${escapeHtml(upgradeProblem)}</p>` : ''}
                      </div>`
                    : `<p class="reason">${escapeHtml(upgradeProblem ?? '')}</p>`
                }
              </section>`
        }
        ${isStorage ? '' : `<section class="cp-section">
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
        </section>`}
      </div>`;
    const workerAvatar = this.panel.querySelector('.worker-card .avatar');
    if (b.worker && workerAvatar) paintAvatar(workerAvatar, b.worker.look);
    for (const el of this.panel.querySelectorAll('[data-avatar]')) {
      paintAvatar(el, this.colony.colonists.find((c) => c.id === Number(el.dataset.avatar)).look);
    }
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.buildings.select(null));
    this.panel.querySelector('[data-upgrade]')?.addEventListener('click', () => this.buildings.upgrade(b));
    this.panel.querySelector('[data-see-worker]')?.addEventListener('click', () => this.onFocusColonist?.(b.worker));
    for (const button of this.panel.querySelectorAll('[data-assign]')) {
      button.addEventListener('click', () => {
        const c = this.colony.colonists.find((o) => o.id === Number(button.dataset.assign));
        this.buildings.setWorker(b, c);
      });
    }
  }
}
