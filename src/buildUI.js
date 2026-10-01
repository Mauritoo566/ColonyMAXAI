import { BUILDING_TYPES, BUILD_CATEGORIES, STOCK_NAMES, levelOf } from './buildings.js';
import { GOODS, BASE_GOODS, TRADE_VALUE } from './sim/goods.js';
import { TECHS } from './sim/techs.js';
import { tradeQuota, tradeValue } from './sim/economy.js';
import { defImplemented, minAgeOf, levelBenefits } from './sim/progression.js';
import { ageInfo } from './ages.js';
import { PRIORITY_NAMES } from './ai.js';
import { FOOD_SPOIL_SECONDS, zoneCapacity } from './sim/colony.js';
import { storageKey } from './storage.js';
import { DAY_LENGTH_SECONDS } from './daynight.js';

const DAY_SECONDS = DAY_LENGTH_SECONDS;
import { SKILLS } from './needs.js';

// Interfaz de construcción: barra para elegir qué construir, el almacén de la colonia
// y la ficha de cada edificio (obra, trabajador asignado y candidatos).

const REFRESH_SECONDS = 0.25;
// Bienes que se muestran: los cinco básicos y los demás que ya existen en la edad actual y la
// colonia ha tenido o producido (así no se llena la pantalla con lo que aún no importa).
function visibleGoods(colony) {
  return GOODS.filter((g) => BASE_GOODS.includes(g.id) || (g.age <= colony.age && ((colony.stock[g.id] ?? 0) > 0 || (colony.produced?.[g.id] ?? 0) > 0)));
}

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
  return Object.entries(def.cost ?? {})
    .map(([k, n]) => `<span class="${stock[k] < n ? 'is-short' : ''}">${icon(k)}${n}</span>`)
    .join('');
}

export class BuildUI {
  constructor({ buildings, colony, harvest, roads, onFocusColonist }) {
    this.roads = roads;
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

    this.stockKey = '';

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
        <span class="build-lock" hidden></span>
      </button>`,
    ).join('') + `
      <button type="button" class="build-item build-item--zone" data-zone data-cat="storage" aria-pressed="false"
        title="Dibuja un área al aire libre donde se amontona lo que no cabe en el almacén. La comida ahí se pudre.">
        <span class="build-icon">${icon('stone')}</span>
        <span class="build-name">Zona de acopio</span>
        <span class="build-cost"><span>Gratis</span></span>
      </button>`;
    this.list.insertAdjacentHTML('beforeend', `
      <button type="button" class="build-item" data-road data-cat="infrastructure" aria-pressed="false" title="Arrastra sobre el terreno para pintar caminos: se camina más rápido por ellos.">
        <span class="build-icon">${icon('train')}</span>
        <span class="build-name">Caminos</span>
        <span class="build-cost" data-road-cost></span>
        <span class="build-lock" hidden></span>
      </button>
      <button type="button" class="build-item" data-road-upgrade data-cat="infrastructure" aria-pressed="false" title="Mejora todos los caminos al tipo que permite la edad (se paga cada casilla).">
        <span class="build-icon">${icon('hammer')}</span>
        <span class="build-name">Mejorar caminos</span>
        <span class="build-cost" data-road-upgrade-cost></span>
        <span class="build-lock" hidden></span>
      </button>`);
    this.list.querySelector('[data-road]').addEventListener('click', () => {
      if (buildings.placing) buildings.stopPlacing();
      harvest.setActive(false);
      roads.setActive(!roads.active);
    });
    this.list.querySelector('[data-road-upgrade]').addEventListener('click', () => colony.upgradeRoads());
    roads.onChange = () => (this.timer = 0);
    this.list.querySelector('[data-zone]').addEventListener('click', () => {
      if (buildings.placing) buildings.stopPlacing();
      const on = !(harvest.active && harvest.mode === 'zone');
      harvest.setActive(on, on ? 'zone' : 'mark');
    });
    // Franja de detalle: descripción, coste y motivo completo de lo que esté señalado o elegido.
    this.detail = document.createElement('p');
    this.detail.className = 'build-detail';
    this.detail.textContent = 'Pasa el cursor sobre un edificio para ver su detalle.';
    this.list.after(this.detail);
    const showDetail = (button) => {
      const def = BUILDING_TYPES.find((d) => d.id === button?.dataset.build);
      if (!def) {
        // Se mantiene el último detalle (o el aviso): la franja no aparece y desaparece.
        return;
      }
      const level = def.levels[Math.min(def.levels.length, def.autoLevel ? this.colony.age : 1) - 1];
      const cost = Object.entries(this.colony.costOf(def)).map(([k, n]) => `${n} ${STOCK_NAMES[k]}`).join(', ') || 'gratis';
      this.detail.hidden = false;
      this.detail.innerHTML = `<strong>${escapeHtml(def.autoLevel ? level.name : def.name)}</strong> · ${escapeHtml(def.autoLevel ? level.desc : def.desc)} <em>Cuesta ${cost}.</em>${button.dataset.problem ? ` <span class="build-detail-problem">${escapeHtml(button.dataset.problem)}</span>` : ''}`;
    };
    this.list.addEventListener('pointerover', (e) => showDetail(e.target.closest('[data-build]')));
    this.list.addEventListener('focusin', (e) => showDetail(e.target.closest('[data-build]')));
        for (const button of this.list.querySelectorAll('[data-build]')) {
      button.addEventListener('click', () => {
        this.pinned = button;
        showDetail(button);
        const def = BUILDING_TYPES.find((d) => d.id === button.dataset.build);
        if (buildings.placing === def) buildings.stopPlacing();
        else if (!buildings.blocker(def) && buildings.canAfford(def)) buildings.startPlacing(def.id);
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
      saved = localStorage.getItem(storageKey('buildTab'));
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
    this.orders = $('orders');
    this.harvestButton.addEventListener('click', () => {
      if (buildings.placing) buildings.stopPlacing();
      const on = !(harvest.active && harvest.mode !== 'zone');
      harvest.setActive(on, 'mark');
    });
    for (const button of this.harvestTools.querySelectorAll('[data-harvest-mode]')) {
      button.addEventListener('click', () => harvest.setActive(true, button.dataset.harvestMode));
    }
    $('harvest-clear').addEventListener('click', () => colony.clearMarks());
    harvest.onChange = () => this.refreshHarvest();
    buildings.onPlacingStart = () => harvest.setActive(false);
    this.refreshHarvest();

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
    if (zoning) {
      // Dibujando la zona de acopio: se ve la pestaña Almacenes, con el aviso abajo.
      this.setTab('storage', false);
      this.showZoneHint(h.message);
      return;
    }
    this.showZoneHint(null, true);
    for (const b of this.harvestTools.querySelectorAll('[data-harvest-mode]')) b.setAttribute('aria-pressed', String(b.dataset.harvestMode === h.mode));
    this.harvestHint.innerHTML =
      h.mode === 'mark'
        ? `Arrastra sobre el terreno para marcar un área (o haz clic en un recurso). ${n ? `<strong>${n} marcados</strong>: los colonos dejan su trabajo para recogerlos (de día y si no tienen hambre, sed, sueño o frío).` : 'Los colonos dejarán su trabajo para recolectar lo marcado: árboles, bayas, setas y piedras (hasta ~230 m del campamento).'}`
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
      : `<strong>Arrastra sobre el terreno</strong> para dibujar la zona de acopio, del tamaño que quieras. Hay una sola: ${this.colony.zones.length ? 'la nueva reemplaza a la actual' : 'lo que no quepa en el almacén se amontonará ahí'}. La comida al aire libre se pudre en ${hours} h. Esc para cancelar.`;
  }

  // Elige la categoría visible (null = barra plegada).
  setTab(id, closeTool = true) {
    if (closeTool && this.harvest?.active && this.harvest.mode === 'zone') this.harvest.setActive(false);
    this.collapsed = !id;
    if (id) this.tab = id;
    for (const tab of this.tabs.children) tab.setAttribute('aria-selected', String(!this.collapsed && tab.dataset.cat === this.tab));
    for (const item of this.list.children) item.hidden = item.dataset.cat !== this.tab || item.dataset.off === '1';
    this.list.hidden = this.collapsed;
    this.bar.classList.toggle('is-collapsed', this.collapsed);
    try {
      localStorage.setItem(storageKey('buildTab'), id ?? 'none');
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
    this.orders.hidden = !hasCamp;
    if (!hasCamp) {
      this.panel.hidden = true;
      return;
    }
    const stock = this.colony.stock;
    const shown = visibleGoods(this.colony);
    const stockKey = shown.map((g) => g.id).join();
    if (stockKey !== this.stockKey) {
      this.stockKey = stockKey;
      this.stock.innerHTML = shown.map((g) => `<li data-stock="${g.id}" style="--res:${g.color}" title="${g.name}">${icon(g.icon)}<span>0</span></li>`).join('');
    }
    for (const li of this.stock.children) {
      const v = Math.floor(stock[li.dataset.stock]);
      const cap = this.colony.capacity(li.dataset.stock);
      li.lastChild.textContent = String(v);
      li.classList.toggle('is-empty', v <= 0);
      const out = Math.floor(this.colony.outdoor[li.dataset.stock] ?? 0);
      li.classList.toggle('is-full', this.colony.isFull(li.dataset.stock));
      li.title = `${STOCK_NAMES[li.dataset.stock]}: ${v - out} de ${cap} en el almacén${out ? ` + ${out} al aire libre` : ''}`;
    }
    // Sólo se ofrece lo de la edad actual (y lo que ya existe en el juego): lo futuro se ve en
    // el panel de edades, con su edad y requisitos.
    const age = this.colony.age;
    const counts = {};
    for (const button of this.list.querySelectorAll('[data-build]')) {
      const def = BUILDING_TYPES.find((d) => d.id === button.dataset.build);
      const off = !(defImplemented(def) && minAgeOf(def) <= age);
      button.dataset.off = off ? '1' : '0';
      if (!off) counts[def.category] = (counts[def.category] ?? 0) + 1;
    }
    counts.storage = (counts.storage ?? 0) + 1; // la zona de acopio
    const road = this.colony.roadInfo;
    const roadOff = road.level <= 0 ? '1' : '0';
    for (const el of this.list.querySelectorAll('[data-road], [data-road-upgrade]')) el.dataset.off = roadOff;
    if (road.level > 0) counts.infrastructure = (counts.infrastructure ?? 0) + 2;
    if (road.level > 0) {
      const lv = road.levels[road.level - 1];
      const costText = Object.entries(lv.cost).map(([k, n]) => `<span>${icon(k)}${n}/casilla</span>`).join('');
      this.list.querySelector('[data-road-cost]').innerHTML = costText;
      const roadBtn = this.list.querySelector('[data-road]');
      roadBtn.setAttribute('aria-pressed', String(this.roads.active));
      roadBtn.title = `${lv.name}: se camina ×${lv.speed}. Llevas ${road.count} de ${road.cap} casillas.${this.roads.message ? ` ${this.roads.message}.` : ''}`;
      const stale = [...this.colony.roads.values()].filter((l) => l < road.level).length;
      const up = this.list.querySelector('[data-road-upgrade]');
      up.setAttribute('aria-disabled', String(stale === 0));
      this.list.querySelector('[data-road-upgrade-cost]').innerHTML = stale ? Object.entries(lv.cost).map(([k, n]) => `<span>${icon(k)}${n * stale}</span>`).join('') : '<span>Al día</span>';
    }
    for (const tab of this.tabs.children) {
      const n = counts[tab.dataset.cat] ?? 0;
      tab.hidden = n === 0;
      const badge = tab.querySelector('.build-tab-count');
      if (badge && badge.textContent !== String(n)) badge.textContent = String(n);
    }
    if ((counts[this.tab] ?? 0) === 0 && !this.collapsed) {
      const first = [...this.tabs.children].find((t) => !t.hidden);
      if (first) this.setTab(first.dataset.cat, false);
    } else {
      for (const item of this.list.children) item.hidden = item.dataset.cat !== this.tab || item.dataset.off === '1' || this.collapsed;
    }
    for (const button of this.list.querySelectorAll('[data-build]')) {
      const def = BUILDING_TYPES.find((d) => d.id === button.dataset.build);
      const blocker = this.buildings.blocker(def);
      const affordable = this.buildings.canAfford(def);
      button.setAttribute('aria-disabled', String(!affordable || !!blocker));
      button.setAttribute('aria-pressed', String(this.buildings.placing === def));
      const level = def.levels[Math.min(def.levels.length, def.autoLevel ? this.colony.age : 1) - 1];
      const desc = def.autoLevel ? level.desc : def.desc;
      button.title = blocker ? `${desc} Bloqueado: ${blocker}.` : affordable ? `${desc} Haz clic y elige dónde construirlo.` : `${desc} Faltan ${this.buildings.missing(def).join(' y ')}.`;
      const lock = button.querySelector('.build-lock');
      // En la tarjeta sólo un estado corto; el motivo completo está en la franja de detalle.
      const state = blocker ? 'Bloqueado' : !affordable ? 'Faltan recursos' : '';
      lock.hidden = !state;
      if (lock.textContent !== state) lock.textContent = state;
      button.dataset.problem = blocker ? `Bloqueado: ${blocker}.` : !affordable ? `Faltan ${this.buildings.missing(def).join(' y ')}.` : '';
      button.querySelector('.build-name').textContent = def.autoLevel ? level.name : def.name;
      const cost = costHtml({ cost: this.colony.costOf(def) }, stock);
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
    return visibleGoods(colony).map((r) => {
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
    const items = visibleGoods(colony).filter((r) => (colony.outdoor[r.id] ?? 0) >= 1)
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
                   .map((z) => `<li><span>Zona de acopio · ${Math.round(z.hw * 2)} × ${Math.round(z.hd * 2)} m · cabe ${zoneCapacity(z)}</span><button type="button" class="btn" data-remove-zone>Quitar</button></li>`)
                   .join('')}
               </ul>`
            : '<p class="reason">No hay zona de acopio. Dibuja una para que lo que no cabe en el almacén se amontone al aire libre en vez de que los colonos dejen de trabajar.</p>'
        }
        ${colony.spoiled >= 1 ? `<p class="reason">Comida perdida por pudrirse: ${Math.floor(colony.spoiled)}</p>` : ''}
        <button type="button" class="btn" data-new-zone>${icon('stone')}${colony.zones.length ? 'Cambiar la zona de acopio' : 'Dibujar zona de acopio'}</button>
      </section>`;
  }

  // Vivienda: cuántos caben, quién vive y cuánto sube el máximo de población.
  houseHtml(b, level, next) {
    const { adults, children } = this.colony.residents(b);
    const residents = [...adults, ...children];
    return `<section class="cp-section">
        <h3>Vecinos (${adults.length}/${level.housing} plazas${children.length ? ` · +${children.length} ${children.length > 1 ? 'niños' : 'niño'} con su familia` : ''})</h3>
        <p class="reason">${residents.length ? residents.map((c) => escapeHtml(c.name)).join(', ') : 'Aún no vive nadie aquí: se mudarán quienes duerman en las tiendas.'}</p>
        <div class="stat-line"><span>Población máxima de la colonia</span><strong>${this.colony.colonists.length} / ${this.colony.maxPopulation}</strong></div>
        ${next ? `<p class="reason">Al llegar a la ${ageInfo(b.level + 1).name} evoluciona sola a ${next.name} (caben ${next.housing}), en el mismo sitio y sin coste.</p>` : ''}
      </section>`;
  }

  // Lo que suma un almacén construido (y lo que sumará mejorado).
  storageAddsHtml(level, next) {
    const list = (cap, other) => GOODS.filter((r) => BASE_GOODS.includes(r.id)).map((r) => `<span style="--res:${r.color}">${icon(r.icon)}+${cap[r.id] ?? 0}</span>`).join('') + (other ? `<span title="Cada uno de los demás bienes">${icon('block')}+${other} c/u</span>` : '');
    return `<section class="cp-section">
        <h3>Amplía el almacén</h3>
        <div class="store-adds">${list(level.capacity, level.other)}</div>
        ${next ? `<p class="reason">Mejorado a ${next.name}: <span class="store-adds store-adds--inline">${list(next.capacity, next.other)}</span></p>` : ''}
      </section>
      <section class="cp-section">
        <h3>Almacén de la colonia</h3>
        ${this.stockRowsHtml()}
      </section>`;
  }

  renderStore(b) {
    const colony = this.colony;
    const piles = this.buildings.list.filter((o) => o.def.id === 'stockpile' && (o.done || o.upgrading)).length;
    const key = ['store', piles, JSON.stringify(visibleGoods(colony).map((r) => [r.id, Math.floor(colony.stock[r.id] ?? 0), colony.capacity(r.id), Math.floor(colony.outdoor[r.id] ?? 0)])), JSON.stringify(colony.zones), Math.floor(colony.spoiled), Math.floor(((colony.foodBatches[0]?.expires ?? 0) - colony.gameTime) / 15)].join('|');
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
      button.addEventListener('click', () => this.colony.removeZone());
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
    const colony = this.colony;
    const def = b.def;
    const skill = SKILLS.find((s) => s.id === def.skill);
    const isStorage = typeof def.levels[0].capacity === 'object';
    const isHouse = def.levels[0].housing != null;
    const needed = colony.crewNeeded(b);
    const level = levelOf(b);
    const next = levelOf(b, 1);
    const age = ageInfo(level.age);
    const crew = b.workers;
    const stateText = () => {
      if (!b.done) return `${b.upgrading ? 'Mejora' : 'Obra'} · ${colony.siteInfo(b)?.label ?? ''} · ${Math.round(b.progress * 100)}%`;
      if (isHouse) return `${colony.residents(b).adults.length}/${level.housing} plazas`;
      if (needed) return crew.length === 0 ? 'Sin trabajador' : crew.length < needed ? `Falta personal · ${crew.length}/${needed}` : b.status ? 'Detenido' : 'Funcionando';
      return 'En uso';
    };
    const state = stateText();
    const ranking = needed ? this.buildings.ranking(b).filter((c) => colony.available(c)) : [];
    const upgradeProblem = this.buildings.upgradeProblem(b);
    const stored = level.rainOnly ? Math.floor(b.store) : null;
    // Clave para no redibujar si nada cambió.
    const site = b.done ? null : colony.siteInfo(b);
    const siteKey = site ? [site.state, site.why, (site.ids ?? []).join(), (site.ordered ?? []).join(), b.priority, b.paused, colony.colonists.map((c) => (c.growth ?? 1) < 1 || c.soldier ? '' : c.id).join('.')].join('~') : '';
    const key = [state, siteKey, colony.colonists.map((c) => (c.home === b.id ? c.id : '')).join(''), b.level, crew.map((w) => w.id).join(), Math.floor(b.produced), b.status, b.reason, upgradeProblem, stored, colony.age, Math.floor((b.cycle ?? 0) * 20), Math.floor(colony.tradeUsed ?? 0), colony.techs.size, Math.floor(colony.stock.knowledge ?? 0), Math.floor(colony.stock.coin ?? 0), ranking.map((c) => `${c.id}${c.job?.id ?? ''}`).join()].join('|');
    if (this.renderedFor === key) return;
    this.renderedFor = key;

    const outGood = level.recipe ? Object.keys(level.recipe.out ?? {})[0] : null;
    const produced = !needed
      ? ''
      : def.id === 'well'
        ? `${Math.floor(b.produced)} jarras de agua`
        : def.stock
          ? `${Math.floor(b.produced)} de ${STOCK_NAMES[def.stock]}`
          : outGood
            ? `${Math.floor(b.produced)} de ${STOCK_NAMES[outGood]}`
            : `${Math.floor(b.produced)}`;
    const recipeHtml = level.recipe
      ? `<div class="stat-line"><span>Receta</span><strong>${Object.entries(level.recipe.in ?? {}).map(([k, n]) => `${n} ${STOCK_NAMES[k]}`).join(' + ') || 'sin materiales'} → ${Object.entries(level.recipe.out ?? {}).map(([k, n]) => `${n} ${STOCK_NAMES[k]}`).join(' + ') || 'energía'} · ${level.recipe.time} s</strong></div>`
      : '';
    const crewHtml = needed
      ? `<section class="cp-section">
          <h3>Trabajadores (${crew.length}/${needed})</h3>
          ${crew
            .map(
              (w) => `<div class="worker-card">
                <span class="avatar" data-avatar="${w.id}"></span>
                <div><div class="worker-name">${escapeHtml(w.name)}</div><div class="reason">${skill.name}: ${colony.skillOf(w, def.skill)}/10</div></div>
                <button type="button" class="btn" data-see-worker="${w.id}">Ver</button>
                <button type="button" class="btn" data-release="${w.id}">Quitar</button>
              </div>`,
            )
            .join('')}
          ${crew.length < needed ? `<p class="reason" style="color:var(--warn)">${needed - crew.length === 1 ? 'Falta 1 puesto' : `Faltan ${needed - crew.length} puestos`}: con la dotación incompleta trabaja más despacio.</p>` : ''}
          <p class="reason">${escapeHtml(b.reason)}</p>
          ${b.status ? `<p class="reason" style="color:var(--warn)">${escapeHtml(b.status)}</p>` : ''}
        </section>
        <section class="cp-section">
          <h3>Producción</h3>
          ${recipeHtml}
          ${b.cycle != null && level.recipe ? `<div class="bar bar--thick" style="--bar:var(--accent)"><i style="width:${Math.round(b.cycle * 100)}%"></i></div>` : ''}
          <div class="stat-line"><span>Ha producido</span><strong>${produced}</strong></div>
          ${stored !== null ? `<div class="stat-line"><span>Agua en las vasijas</span><strong>${stored} / ${level.capacity}</strong></div>` : ''}
        </section>`
      : '';
    const effectsHtml = !needed && !isHouse && !isStorage ? this.effectsHtml(b, level) : '';
    const serviceHtml = b.done && !b.upgrading ? (def.id === 'market' ? this.marketHtml(b) : def.id === 'academy' ? this.researchHtml() : this.serviceNote(b, level)) : '';
    const levels = def.levels;
    const nextBenefits = next ? levelBenefits(def, level, next) : [];
    const upgradeHtml = def.autoLevel
      ? ''
      : `<section class="cp-section">
          <h3>Mejora</h3>
          <ol class="level-track" aria-label="Niveles">
            ${levels.map((lv, i) => `<li class="${i + 1 < b.level ? 'is-past' : i + 1 === b.level ? 'is-now' : ''}" title="${lv.name} (${ageInfo(lv.age).name})">${ageInfo(lv.age).numeral}</li>`).join('')}
          </ol>
          ${
            next
              ? `<div class="upgrade-card">
                  <div class="upgrade-title"><span>Siguiente nivel · ${ageInfo(next.age).name}</span><strong>${next.name}</strong></div>
                  <p class="reason">${next.desc}</p>
                  <ul class="benefits">${nextBenefits.map((t) => `<li>${t}</li>`).join('')}</ul>
                  <div class="upgrade-foot">
                    <span class="build-cost">${costHtml({ cost: next.upgradeCost }, colony.stock)}</span>
                    <button type="button" class="btn btn--primary" data-upgrade ${upgradeProblem ? 'disabled' : ''}>${icon('hammer')}Mejorar</button>
                  </div>
                  ${upgradeProblem ? `<p class="reason" style="color:var(--warn)">${escapeHtml(upgradeProblem)}</p>` : ''}
                </div>`
              : `<p class="reason">${escapeHtml(upgradeProblem ?? '')}</p>`
          }
        </section>`;
    const siteHtml = () => {
      const stateClass = { building: 'ok', going: 'ok', waiting: 'warn', blocked: 'bad', paused: 'warn' }[site.state] ?? 'ok';
      const verb = b.upgrading ? 'mejora' : 'obra';
      const names = (ids) => ids.map((id) => colony.colonist(id)?.name).filter(Boolean);
      const eligible = colony.colonists.filter((c) => !(c.growth < 1) && !c.soldier);
      const blockedOnes = colony.colonists.filter((c) => c.growth < 1 || c.soldier);
      const opts = eligible.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${site.ordered?.includes(c.id) ? ' (ya asignado)' : ''}</option>`).join('')
        + blockedOnes.map((c) => `<option value="" disabled>${escapeHtml(c.name)} — ${c.soldier ? 'es soldado' : 'es un niño'}</option>`).join('');
      return `
        <p class="site-state site-state--${stateClass}"><strong>${site.label}</strong></p>
        <p class="reason">${escapeHtml(site.why)}</p>
        ${site.ids?.length ? `<p class="reason">En la ${verb}: ${escapeHtml(names(site.ids).join(', '))}${site.ordered?.length ? ` · con orden directa: ${escapeHtml(names(site.ordered).join(', '))}` : ''}.</p>` : ''}
        <div class="prio-row" role="group" aria-label="Prioridad de la ${verb}">
          <span>Prioridad</span>
          ${['low', 'normal', 'high'].map((p) => `<button type="button" class="seg ${b.priority === p ? 'is-on' : ''}" data-prio="${p}" aria-pressed="${b.priority === p}">${PRIORITY_NAMES[p]}</button>`).join('')}
          <button type="button" class="seg" data-pause>${b.paused ? 'Reanudar' : 'Pausar'}</button>
        </div>
        <div class="order-box">
          <label class="order-label">Asignar constructor<select data-site-pick>${opts}</select></label>
          <div class="order-buttons"><button type="button" class="btn" data-site-assign>Asignar constructor</button></div>
          <p class="order-msg" data-site-msg role="status"></p>
        </div>`;
    };
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
                <p class="reason">Mientras tanto no se produce nada${crew.length ? `; al terminar, ${escapeHtml(crew.map((w) => w.name).join(', '))} vuelve${crew.length > 1 ? 'n' : ''} a su trabajo` : ''}.</p>
                ${siteHtml()}
              </section>`
            : !b.done
              ? `<section class="cp-section">
                  <h3>Obra</h3>
                  <div class="bar bar--thick" style="--bar:var(--accent)"><i style="width:${Math.round(b.progress * 100)}%"></i></div>
                  ${siteHtml()}
                  <p class="reason">Los colonos construyen de día cuando tienen lo básico cubierto. Quien sabe más de construcción avanza más rápido. ${isHouse ? 'Al terminar, la colonia admitirá más colonos y quienes vivan aquí dormirán bajo techo.' : isStorage ? 'Al terminar, el almacén de la colonia podrá guardar más.' : needed ? `Al terminar, la colonia elegirá a las personas más capacitadas en ${skill.name.toLowerCase()} para trabajar aquí.` : 'Al terminar, entrará en servicio.'}</p>
                </section>`
              : `${isHouse ? this.houseHtml(b, level, next) : isStorage ? this.storageAddsHtml(level, next) : ''}${crewHtml}${serviceHtml}${effectsHtml}${upgradeHtml}`
        }
        ${
          needed && b.done
            ? `<section class="cp-section">
          <h3>Más capacitados en ${skill.name.toLowerCase()}</h3>
          <ul class="candidate-list">
            ${ranking
              .map(
                (c) => `
              <li class="candidate">
                <span class="avatar" data-avatar="${c.id}"></span>
                <span>${escapeHtml(c.name)}${c.job && c.job !== b ? ` <span class="reason">· ${escapeHtml(c.job.def.job)}</span>` : ''}</span>
                <span class="bar"><i style="width:${colony.skillOf(c, def.skill) * 10}%"></i></span>
                ${crew.includes(c) ? `<button type="button" data-release="${c.id}">Quitar</button>` : `<button type="button" data-assign="${c.id}">Asignar</button>`}
              </li>`,
              )
              .join('')}
          </ul>
        </section>`
            : ''
        }
      </div>`;
    for (const el of this.panel.querySelectorAll('[data-avatar]')) {
      const who = colony.colonists.find((c) => c.id === Number(el.dataset.avatar));
      if (who) paintAvatar(el, who.look);
    }
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.buildings.select(null));
    for (const button of this.panel.querySelectorAll('[data-prio]')) button.addEventListener('click', () => colony.setPriority(b, button.dataset.prio));
    this.panel.querySelector('[data-pause]')?.addEventListener('click', () => colony.pauseSite(b, !b.paused));
    this.panel.querySelector('[data-site-assign]')?.addEventListener('click', () => {
      const id = Number(this.panel.querySelector('[data-site-pick]').value);
      const c = colony.colonist(id);
      const msg = this.panel.querySelector('[data-site-msg]');
      msg.textContent = c ? colony.orderColonist(c, 'build', b) ?? `${c.name} recibió la orden de construir.` : 'Elige un colono.';
    });
    this.panel.querySelector('[data-upgrade]')?.addEventListener('click', () => this.buildings.upgrade(b));
    for (const button of this.panel.querySelectorAll('[data-see-worker]')) {
      button.addEventListener('click', () => this.onFocusColonist?.(colony.colonist(Number(button.dataset.seeWorker))));
    }
    for (const button of this.panel.querySelectorAll('[data-trade]')) {
      button.addEventListener('click', () => {
        const [good, mode, qty] = button.dataset.trade.split('|');
        colony.trade(good, Number(qty), mode);
      });
    }
    for (const button of this.panel.querySelectorAll('[data-research]')) {
      button.addEventListener('click', () => colony.research(button.dataset.research));
    }
    for (const button of this.panel.querySelectorAll('[data-release]')) {
      button.addEventListener('click', () => colony.releaseWorker(b, colony.colonist(Number(button.dataset.release))));
    }
    for (const button of this.panel.querySelectorAll('[data-assign]')) {
      button.addEventListener('click', () => {
        const c = colony.colonists.find((o) => o.id === Number(button.dataset.assign));
        this.buildings.setWorker(b, c);
      });
    }
  }

  // Mercado: cupo diario y compra/venta de bienes.
  marketHtml(b) {
    const colony = this.colony;
    const quota = tradeQuota(colony);
    const used = Math.floor(colony.tradeUsed ?? 0);
    const rows = GOODS.filter((g) => TRADE_VALUE[g.id] != null && g.age <= colony.age && g.id !== 'coin' && ((colony.stock[g.id] ?? 0) > 0 || BASE_GOODS.includes(g.id) || (colony.produced?.[g.id] ?? 0) > 0)).map((g) => {
      const v = TRADE_VALUE[g.id];
      const qty = v < 4 ? 10 : v < 10 ? 5 : 2;
      const sellP = colony.tradeProblem(g.id, qty, 'sell');
      const buyP = colony.tradeProblem(g.id, qty, 'buy');
      return `<li class="trade-row"><span>${icon(g.icon)}${g.name} <small>(${Math.floor(colony.stock[g.id] ?? 0)})</small></span>
        <button type="button" data-trade="${g.id}|sell|${qty}" ${sellP ? 'disabled' : ''} title="${sellP ?? `Vender ${qty}: +${tradeValue(g.id, qty, 'sell')} monedas`}">Vender ${qty}</button>
        <button type="button" data-trade="${g.id}|buy|${qty}" ${buyP ? 'disabled' : ''} title="${buyP ?? `Comprar ${qty}: −${tradeValue(g.id, qty, 'buy')} monedas`}">Comprar ${qty}</button></li>`;
    });
    return `<section class="cp-section"><h3>Comercio</h3>
      <div class="stat-line"><span>Monedas</span><strong>${Math.floor(colony.stock.coin ?? 0)}</strong></div>
      <div class="stat-line"><span>Cupo de hoy</span><strong>${used} / ${Math.floor(quota)}</strong></div>
      <p class="reason">Se vende al 80 % y se compra al 125 % del valor. Sólo se comercia con lo que existe en tu edad; los requisitos de construcción no se saltan comprando.</p>
      <ul class="trade-list">${rows.join('')}</ul></section>`;
  }

  // Academia: tecnologías que se pagan con conocimiento.
  researchHtml() {
    const colony = this.colony;
    const rows = TECHS.filter((t) => t.age <= colony.age + 1).map((t) => {
      const problem = colony.researchProblem(t.id);
      const done = colony.techs.has(t.id);
      return `<li class="trade-row"><span><strong>${t.name}</strong> <small>${done ? 'investigada' : `${t.cost} de conocimiento`}</small><br><small>${t.unlocks}</small></span>
        ${done ? '<em>✓</em>' : `<button type="button" data-research="${t.id}" ${problem ? 'disabled' : ''} title="${problem ?? 'Investigar'}">Investigar</button>`}</li>`;
    });
    return `<section class="cp-section"><h3>Tecnologías</h3>
      <div class="stat-line"><span>Conocimiento</span><strong>${Math.floor(colony.stock.knowledge ?? 0)}</strong></div>
      <ul class="trade-list">${rows.join('')}</ul></section>`;
  }

  // Hospitales, escuelas y administración: si están funcionando y qué aportan.
  serviceNote(b, level) {
    if (!['hospital', 'school', 'admin'].includes(b.def.id)) return '';
    const lines = [];
    if (b.def.id === 'hospital') lines.push(['Atención', b.operating ? `activa (recuperación ×${(level.regen ?? 0).toFixed(1)})` : 'parada']);
    if (b.def.id === 'school') lines.push(['Enseñanza', b.operating ? `activa (hasta nivel ${level.skillCap})` : 'parada']);
    if (level.population) lines.push(['Cubre a', `${level.population} habitantes`]);
    return `<section class="cp-section"><h3>Servicio</h3>${lines.map(([k, v]) => `<div class="stat-line"><span>${k}</span><strong>${v}</strong></div>`).join('')}</section>`;
  }

  // Efectos de los edificios sin trabajadores (defensas, cuarteles, postes...): lo que aportan.
  effectsHtml(b, level) {
    const lines = [];
    if (level.defense) lines.push(['Puntos de defensa', level.defense]);
    if (level.garrison) lines.push(['Guarnición', level.garrison]);
    if (level.reach) lines.push(['Alcance', `${level.reach} m`]);
    if (level.power) lines.push(['Energía que produce', level.power]);
    if (level.speed) lines.push(['Velocidad de entrega', `×${level.speed}`]);
    if (level.energy) lines.push(['Energía que consume', level.energy]);
    if (b.status) lines.push(['Estado', b.status]);
    if (!lines.length) return '';
    return `<section class="cp-section"><h3>Efectos</h3>${lines.map(([k, v]) => `<div class="stat-line"><span>${k}</span><strong>${v}</strong></div>`).join('')}</section>`;
  }
}
