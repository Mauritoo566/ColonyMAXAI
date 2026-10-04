import * as THREE from 'three';
import { preserveScroll, keepScroll, scrollParent } from './keepScroll.js';
import { diagnose, mainProblem, BANDS } from './sim/wellbeing.js';
import { NEEDS, SKILLS, wellbeing, needStatus, completeSkill } from './needs.js';
import { GENES, gene, genomeCode, lifeExpectancy } from './genes.js';
import { SPEC_NAMES, isWorker } from './sim/specialties.js';
import { tierName, lifeOf, warmthOf, clothesNote } from './sim/clothing.js';
import { TOOL_GOODS, BARE_TIME, toolName, toolTrade, toolNote, toolsMatter } from './sim/tools.js';
import { MOB_INFO, MOB_STATS, MOB_STATE_TEXT } from './sim/mobs.js';
import { TAME_COST } from './sim/stable.js';

// Interfaz de la colonia: tarjeta con el bienestar general, lista de colonos y la
// ficha de cada uno (clic sobre el colono, su nombre o su fila en la lista).

const REFRESH_SECONDS = 0.25;
const CLICK_TOLERANCE = 6;
const FOCUS_CLEARANCE = 45; // altura a la que se acerca la cámara al elegir un colono lejano

function icon(id) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${id}" /></svg>`;
}

function tone(value) {
  return needStatus(value).tone;
}

function setTone(el, value) {
  const t = `tone-${tone(value)}`;
  if (!el.classList.contains(t)) {
    el.classList.remove('tone-good', 'tone-ok', 'tone-warn', 'tone-bad');
    el.classList.add(t);
  }
}

function setBar(bar, value) {
  const w = `${Math.round(Math.max(0, Math.min(100, value)))}%`;
  if (bar.style.width !== w) bar.style.width = w;
}

function paintAvatar(el, look) {
  el.style.setProperty('--hair', look.hair);
  el.style.setProperty('--skin', look.skin);
  el.style.setProperty('--shirt', look.shirt);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

// Texto del botón de una acción sugerida: sólo lleva a verlo, nunca gasta ni construye nada.
function actionLabel(a) {
  return a.kind === 'build' ? 'Ver en construcción' : a.kind === 'storage' ? 'Ir al almacén' : a.kind === 'housing' || a.kind === 'building' ? 'Ver la vivienda' : 'Ver';
}

export class ColonyUI {
  // colony: la simulación (sim/colony.js); view: la vista de los colonos (colonists.js),
  // que sabe cuál está elegido y dónde se dibuja cada uno.
  constructor({ colony, view, controls, camera, canvas, isBlocked = () => false }) {
    this.colony = colony;
    this.view = view;
    this.controls = controls;
    this.camera = camera;
    this.canvas = canvas;
    this.isBlocked = isBlocked;
    this.timer = 0;
    this.rosterFor = null;
    this.tab = 'estado';
    this.following = false;
    this.tmpDir = new THREE.Vector3();
    this.tmpProj = new THREE.Vector3();

    const $ = (id) => document.getElementById(id);
    this.card = $('colony-card');
    this.count = $('colonists');
    this.popLine = $('pop-line');
    this.wellbeingValue = $('colony-wellbeing');
    this.wellbeingBar = $('colony-wellbeing-bar');
    this.needSummary = $('need-summary');
    this.roster = $('roster');
    this.panel = $('colonist-panel');
    preserveScroll(this.panel);

    // Resumen de necesidades (fijo: cinco casillas).
    this.needSummary.innerHTML = NEEDS.map(
      (n) =>
        `<li data-need="${n.id}" style="--need:${n.color};--bar:${n.color}" title="${n.name} (media de la colonia)">${icon(n.id)}<div class="bar"><i></i></div></li>`,
    ).join('');

    // En pantallas chicas la lista empieza plegada.
    if (window.matchMedia('(max-width: 720px)').matches) $('roster-wrap').open = false;

    view.onSelect = (c) => this.showColonist(c);
    view.onSelectMob = (id) => this.showMob(id);
    controls.onFollowEnd = () => this.setFollowing(false);

    // Clic sobre el mundo: elegir el colono más cercano al puntero.
    let pressed = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) pressed = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      const p = pressed;
      pressed = null;
      if (!p || e.button !== 0 || this.isBlocked()) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_TOLERANCE) return;
      const c = view.pickAt(e.clientX, e.clientY);
      if (c) view.select(c);
      else {
        const mob = view.pickMobAt(e.clientX, e.clientY);
        if (mob != null) view.selectMob(mob);
        else {
          if (view.selected) view.select(null);
          if (view.selectedMob != null) view.selectMob(null);
        }
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && view.selected && !this.isBlocked()) view.select(null);
      if (e.key === 'Escape' && view.selectedMob != null && !this.isBlocked()) view.selectMob(null);
    });

    // Ayuda.
    const helpToggle = $('help-toggle');
    const helpCard = $('help-card');
    helpToggle.addEventListener('click', () => {
      helpCard.hidden = !helpCard.hidden;
      helpToggle.setAttribute('aria-expanded', String(!helpCard.hidden));
    });
  }

  update(delta) {
    this.timer -= delta;
    if (this.timer > 0) return;
    this.timer = REFRESH_SECONDS;

    const summary = this.colony.summary();
    this.card.hidden = !summary;
    if (!summary) {
      this.panel.hidden = true;
      return;
    }
    const groups = this.colony.colonists.map((c) => `${c.id}:${this.tradeOf(c)}`).join();
    if (this.rosterFor !== this.colony.colonists || this.rosterCount !== this.colony.colonists.length || this.rosterGroups !== groups) this.buildRoster(groups);

    const popText = `${this.colony.count}/${this.colony.maxPopulation}`;
    if (this.count.textContent !== popText) this.count.textContent = popText;
    const popTitle = `Colonos: ${popText} (plazas de vivienda).${this.colony.growthBlocker ? ` No crece: ${this.colony.growthBlocker}.` : ' Hay plazas y reservas para crecer.'}`;
    if (this.count.parentElement.title !== popTitle) this.count.parentElement.title = popTitle;
    // Población actual, plazas de refugio y límite de la edad: tres cosas distintas.
    const pop = this.colony.populationInfo();
    const sh = pop.shelter;
    const line = `Población ${pop.count}/${pop.cap} (límite de la edad) · Refugio: ${sh.housed}/${sh.adults} adultos con plaza (${sh.slots} plazas)${sh.unhoused ? ` · ${sh.unhoused} duermen junto a la fogata` : ''}${this.colony.mobs?.length ? ` · Animales cerca: ${this.colony.mobs.filter((m) => m.type !== 'lobo' && m.type !== 'oso').length} pacíficos, ${this.colony.mobs.filter((m) => m.type === 'lobo' || m.type === 'oso').length} hostiles` : ''}${this.colony.growthBlocker ? ` · Sin nacimientos: ${this.colony.growthBlocker}` : ''}`;
    if (this.popLine.textContent !== line) this.popLine.textContent = line;
    this.wellbeingValue.textContent = `${Math.round(summary.wellbeing)}%`;
    setBar(this.wellbeingBar, summary.wellbeing);
    setTone(this.wellbeingValue.closest('.meter'), summary.wellbeing);
    for (const li of this.needSummary.children) {
      const v = summary[li.dataset.need];
      setBar(li.querySelector('i'), v);
      li.classList.toggle('is-low', v < 30);
      li.title = `${NEEDS.find((n) => n.id === li.dataset.need).name}: ${Math.round(v)}% de media en la colonia`;
    }
    this.updateRoster();
    if (this.view.selected) this.updatePanel(this.view.selected);
    if (this.view.selectedMob != null) this.updateMob();
  }

  // ---- Lista de colonos ----------------------------------------------------

  // Oficio con el que se agrupa a un colono en la lista.
  tradeOf(c) {
    if ((c.growth ?? 1) < 1) return 'Niños';
    if (c.soldier) return 'Ejército';
    return SPEC_NAMES[c.spec?.[0]] ? `${SPEC_NAMES[c.spec[0]]}` : 'Sin especialidades';
  }

  buildRoster(groups = '') {
    this.rosterFor = this.colony.colonists;
    this.rosterCount = this.colony.colonists.length;
    this.rosterGroups = groups;
    const scroller = scrollParent(this.roster);
    const scrollTop = scroller?.scrollTop ?? 0;
    this.roster.innerHTML = '';
    this.rows = new Map();
    // Agrupados por oficio (con muchos colonos se sigue entendiendo quién hace qué).
    const grouped = new Map();
    for (const c of this.colony.colonists) {
      const key = this.tradeOf(c);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(c);
    }
    const order = [...grouped.keys()].sort((a, b) => (a === 'Sin especialidades') - (b === 'Sin especialidades') || (a === 'Niños') - (b === 'Niños') || a.localeCompare(b));
    const list = order.flatMap((k) => (grouped.size > 1 ? [{ header: k, n: grouped.get(k).length }] : []).concat(grouped.get(k)));
    for (const c of list) {
      if (c.header) {
        const h = document.createElement('li');
        h.className = 'roster-group';
        h.textContent = `${c.header} (${c.n})`;
        this.roster.appendChild(h);
        continue;
      }
      const li = document.createElement('li');
      li.innerHTML = `
        <button type="button" class="roster-item">
          <span class="avatar"></span>
          <span>
            <span class="roster-name">${escapeHtml(c.name)}</span>
            <span class="roster-activity"></span>
          </span>
          <span class="roster-health"><span class="roster-health-value"></span><span class="bar"><i></i></span></span>
        </button>`;
      paintAvatar(li.querySelector('.avatar'), c.look);
      li.querySelector('button').addEventListener('click', () => this.focusColonist(c));
      this.roster.appendChild(li);
      this.rows.set(c, li);
    }
    if (scroller) scroller.scrollTop = scrollTop;
  }

  updateRoster() {
    for (const [c, li] of this.rows) {
      const w = wellbeing(c);
      const health = li.querySelector('.roster-health');
      health.querySelector('.roster-health-value').textContent = `${Math.round(w)}%`;
      health.title = `Bienestar ${Math.round(w)}% · Salud ${Math.round(c.health)}%`;
      setBar(health.querySelector('i'), w);
      setTone(health, w);
      // Si algo le urge, se muestra con su ícono en lugar de la actividad.
      const worst = NEEDS.reduce((a, b) => (c.needs[b.id] < c.needs[a.id] ? b : a));
      const activity = li.querySelector('.roster-activity');
      // El estado dice qué le pasa de verdad (sim/wellbeing.js): "Desanimado: sin cama", no sólo "desanimado".
      const problem = mainProblem(this.colony, c);
      const bandText = BANDS[c.moodBand ?? 2]?.text ?? '';
      const html = problem && (c.moodBand ?? 2) <= 1
        ? `${icon(problem.need ?? 'mood')}${escapeHtml(bandText)}: ${escapeHtml(problem.short)}`
        : c.needs[worst.id] < 30 && worst.id !== 'mood'
          ? `${icon(worst.id)}${escapeHtml(worst.low)}`
          : `${c.order ? '<b class="order-tag">Orden</b> ' : ''}${escapeHtml(c.activity)}`;
      if (activity.dataset.html !== html) {
        activity.innerHTML = html;
        activity.dataset.html = html;
      }
      li.firstElementChild.classList.toggle('is-selected', this.view.selected === c);
    }
  }

  // Elegir desde la lista: si el colono no está a la vista, la cámara vuela hasta él.
  focusColonist(c) {
    this.view.select(c);
    const dir = this.colony.directionOf(c, this.tmpDir);
    const position = this.view.positionOf(c) ?? dir;
    const p = this.tmpProj.copy(position).project(this.camera);
    const onScreen = p.z < 1 && Math.abs(p.x) < 0.8 && Math.abs(p.y) < 0.8;
    const near = this.camera.position.distanceTo(position) < 400;
    if (!onScreen || !near) this.controls.flyTo(dir.clone(), FOCUS_CLEARANCE);
  }

  // ---- Ficha del colono ----------------------------------------------------

  showColonist(c) {
    if (!c) {
      this.panel.hidden = true;
      this.controls.stopFollow();
      this.setFollowing(false);
      return;
    }
    this.onOpen?.();
    if (this.following) this.startFollowing();
    this.panel.hidden = false;
    this.panel.innerHTML = `
      <header class="cp-head">
        <span class="avatar avatar--lg"></span>
        <div>
          <h2 class="cp-name">${escapeHtml(c.name)}</h2>
          <p class="cp-sub"><span data-who></span> · <span data-activity></span></p>
        </div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar ficha">${icon('close')}</button>
      </header>
      <div class="cp-tabs cp-tabs--dense" role="tablist">
        <button type="button" class="cp-tab" role="tab" data-tab="estado">Estado</button>
        <button type="button" class="cp-tab" role="tab" data-tab="animo">Ánimo</button>
        <button type="button" class="cp-tab" role="tab" data-tab="trabajo">Trabajo</button>
        <button type="button" class="cp-tab" role="tab" data-tab="vida">Vida</button>
        <button type="button" class="cp-tab" role="tab" data-tab="genes">Genes</button>
      </div>
      <div class="cp-body" data-page="estado">
        <div class="vitals">
          <div class="vital vital--health" data-health>
            <div class="meter-row"><span class="meter-label">${icon('health')}Salud</span><strong class="meter-value" data-value></strong></div>
            <div class="bar"><i></i></div>
          </div>
          <div class="vital" data-wellbeing>
            <div class="meter-row"><span class="meter-label">Bienestar</span><strong class="meter-value" data-value></strong></div>
            <div class="bar"><i></i></div>
          </div>
        </div>
        <section class="cp-section">
          <h3>Ahora</h3>
          <p class="activity-now" data-activity></p>
        </section>
        <section class="cp-section">
          <h3>Necesidades</h3>
          <ul class="need-list">
            ${NEEDS.map(
              (n) => `
              <li class="need-row" data-need="${n.id}" style="--need:${n.color}">
                ${icon(n.id)}<span class="need-name">${n.name}</span>
                <div class="bar"><i></i></div>
                <span class="need-state"></span>
              </li>`,
            ).join('')}
          </ul>
        </section>
      </div>
      <div class="cp-body" data-page="animo" hidden>
        <section class="cp-section mood-section" data-mood>
          <h3>Ánimo</h3>
          <div class="meter-row"><span class="meter-label" data-mood-band></span><strong class="meter-value" data-mood-value></strong></div>
          <div class="bar"><i data-mood-bar></i></div>
          <p class="mood-trend" data-mood-trend></p>
          <div data-mood-detail></div>
        </section>
      </div>
      <div class="cp-body" data-page="trabajo" hidden>
        <section class="cp-section">
          <h3>Oficio y órdenes</h3>
          <p class="activity-now" data-job></p>
          <p class="activity-now" data-order></p>
          <p class="activity-now" data-avail></p>
          <div class="order-box" data-orderbox>
            <h4 class="site-sub">Asignar tarea</h4>
            <div class="task-list" data-order-list></div>
            <div class="order-buttons">
              <button type="button" class="btn" data-order-cancel>Cancelar orden</button>
            </div>
            <p class="order-msg" data-order-msg role="status"></p>
          </div>
        </section>
        <section class="cp-section" data-toolbox>
          <h3>Herramienta</h3>
          <div class="meter-row"><span class="meter-label" data-tool-name></span><strong class="meter-value" data-tool-wear></strong></div>
          <div class="bar" data-tool-bar><i></i></div>
          <p class="activity-now" data-tool-note></p>
        </section>
        <section class="cp-section">
          <h3>Habilidades</h3>
          <ul class="skill-list">
            ${SKILLS.map(
              (sk) => `<li class="skill-row"><span>${sk.name}</span><span class="bar"><i style="width:${completeSkill(c, sk.id) * 10}%"></i></span><span>${completeSkill(c, sk.id)}/10</span></li>`,
            ).join('')}
          </ul>
        </section>
      </div>
      <div class="cp-body" data-page="vida" hidden>
        <section class="cp-section">
          <h3>Familia y hogar</h3>
          <p class="activity-now" data-family></p>
        </section>
        <section class="cp-section">
          <h3>Ropa</h3>
          <p class="activity-now" data-clothes></p>
        </section>
        <section class="cp-section">
          <h3>Personalidad</h3>
          <ul class="trait-list">
            ${c.traits.map((t) => `<li class="trait"><strong>${t.name}</strong><span>${t.desc}</span></li>`).join('')}
          </ul>
        </section>
        <section class="cp-section">
          <h3>Biografía</h3>
          <p class="bio">${escapeHtml(c.bio)}</p>
        </section>
        <section class="cp-section">
          <h3>Actividad reciente</h3>
          <ol class="log-list" data-log></ol>
        </section>
      </div>
      <div class="cp-body" data-page="genes" hidden>
        <p class="dna" title="Código genético: dos bases por alelo, dos alelos por gen">${icon('dna')}<span>${genomeCode(c.genome)}</span></p>
        <ul class="gene-list">
          ${GENES.map((g) => {
            const v = gene(c.genome, g.id);
            const [a, b] = c.genome[g.id];
            const word = v < 0.35 ? g.low : v > 0.65 ? g.high : 'Media';
            return `
              <li class="gene-row" title="${escapeHtml(g.desc)}">
                <div class="gene-top"><span>${g.name}</span><span>${word}</span></div>
                <div class="gene-scale"><i style="width:${Math.round(v * 100)}%"></i><b style="left:${Math.round(a * 100)}%"></b><b style="left:${Math.round(b * 100)}%"></b></div>
              </li>`;
          }).join('')}
        </ul>
        <p class="gene-note">Esperanza de vida: unos ${lifeExpectancy(c.genome)} años. Los puntos son los dos alelos de cada gen (uno de cada progenitor); la barra, el valor que se expresa.</p>
      </div>
      <div class="cp-actions">
        <button type="button" class="btn" data-follow aria-pressed="false">${icon('follow')}Seguir con la cámara</button>
      </div>`;
    paintAvatar(this.panel.querySelector('.avatar'), c.look);
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.view.select(null));
    this.panel.querySelector('[data-follow]').addEventListener('click', () => {
      if (this.following) this.controls.stopFollow();
      else this.startFollowing();
    });
    for (const tab of this.panel.querySelectorAll('[data-tab]')) {
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab));
    }
    this.orderOptionsKey = null;
    const msg = this.panel.querySelector('[data-order-msg]');
    this.panel.querySelector('[data-order-list]').addEventListener('click', (e) => {
      const row = e.target.closest('[data-task]');
      if (!row) return;
      const [kind, id] = row.dataset.task.split(':');
      if (kind === 'work') {
        const b = this.colony.building(Number(id));
        const why = !b || !b.done ? 'Ese edificio no está disponible.' : !this.colony.available(c) ? 'No puede trabajar: es un niño o soldado.' : null;
        if (!why) this.colony.setWorker(b, c);
        msg.textContent = why ?? `Ahora trabaja en: ${b.name}.`;
        return;
      }
      const why = this.colony.orderColonist(c, kind, kind === 'build' ? this.colony.building(Number(id)) : null);
      msg.textContent = why ?? 'Orden dada.';
    });
    this.panel.querySelector('[data-order-cancel]').addEventListener('click', () => {
      msg.textContent = c.order ? 'Orden cancelada: vuelve a decidir solo.' : 'No tiene ninguna orden.';
      this.colony.cancelOrder(c);
    });
    this.showTab(this.tab);
    this.setFollowing(this.following);
    this.logFor = null;
    this.updatePanel(c);
  }

  showTab(name) {
    this.tab = name;
    for (const tab of this.panel.querySelectorAll('[data-tab]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    }
    for (const page of this.panel.querySelectorAll('[data-page]')) page.hidden = page.dataset.page !== name;
  }

  updatePanel(c) {
    if (this.panel.hidden) return;
    for (const el of this.panel.querySelectorAll('[data-activity]')) el.textContent = c.activity;
    const who = this.panel.querySelector('[data-who]');
    const growth = c.growth ?? 1;
    const whoText = growth < 1 ? `${c.sex === 'f' ? 'Niña' : 'Niño'} · ${Math.round(growth * 100)}% crecido` : `${c.sex === 'f' ? 'Mujer' : 'Hombre'} · ${c.age} años`;
    if (who.textContent !== whoText) who.textContent = whoText;
    const family = this.panel.querySelector('[data-family]');
    const byId = (id) => this.colony.colonist(id)?.name;
    const parts = [];
    if (c.born) parts.push(`Hijo de ${byId(c.born.mother) ?? 'alguien'} y ${byId(c.born.father) ?? 'alguien'}.`.replace('Hijo', c.sex === 'f' ? 'Hija' : 'Hijo'));
    if (c.mate != null && byId(c.mate)) parts.push(`Pareja: ${byId(c.mate)}.`);
    const kids = this.colony.colonists.filter((o) => o.born && (o.born.mother === c.id || o.born.father === c.id)).map((o) => o.name);
    if (kids.length) parts.push(`Hijos: ${kids.join(', ')}.`);
    if (c.pregnant) parts.push('Espera un hijo.');
    const house = c.home != null ? this.colony.building(c.home) : null;
    parts.push(house ? `Vive en: ${house.name}.` : 'Duerme en las tiendas del campamento.');
    if (growth >= 1 && c.desire != null) parts.push(c.desire >= 70 ? 'Tiene ganas de compañía.' : '');
    const familyText = parts.filter(Boolean).join(' ');
    if (family.textContent !== familyText) family.textContent = familyText;
    const job = this.panel.querySelector('[data-job]');
    const specs = (c.spec ?? []).map((id, i) => `${i + 1}. ${SPEC_NAMES[id]} (nivel ${completeSkill(c, id)})`).join(' · ');
    const jobText = `Especialidades: ${specs || 'sin asignar'}${c.pendingSpec ? ` · cambio pendiente: ${c.pendingSpec.map((id) => SPEC_NAMES[id]).join(', ')}` : ''}${c.job ? ` · puesto: ${c.job.def.job} en ${c.job.name}` : ''}${c.idle && !c.task?.type?.match(/build|work|harvest/) ? ` · espera: ${c.idle}` : ''}`;
    if (job.textContent !== jobText) job.textContent = jobText;
    const orderEl = this.panel.querySelector('[data-order]');
    const target = c.order?.kind === 'build' ? this.colony.building(c.order.building) : null;
    const orderText = !c.order
      ? 'Orden actual: ninguna'
      : `Orden actual: ${c.order.kind === 'build' ? `construir ${target?.name ?? 'obra'}` : 'recolectar lo marcado'} · ${c.order.state === 'interrupted' ? 'en pausa por una necesidad urgente' : 'en curso'}`;
    if (orderEl.textContent !== orderText) orderEl.textContent = orderText;
    const unavailable = (c.growth ?? 1) < 1 ? 'Es un niño: no recibe órdenes de trabajo.' : c.soldier ? 'Es soldado: monta guardia.' : null;
    const avail = this.panel.querySelector('[data-avail]');
    const availText = unavailable ?? (c.order || c.job ? 'Disponibilidad: con tareas asignadas' : 'Disponibilidad: libre');
    if (avail.textContent !== availText) avail.textContent = availText;
    this.panel.querySelector('[data-orderbox]').hidden = !!unavailable;
    this.refreshOrderOptions(c);
    const clothes = this.panel.querySelector('[data-clothes]');
    let clothesText;
    if (c.clothed) {
      const tier = c.wear?.tier ?? this.colony.age;
      const left = c.wear ? Math.max(0, Math.min(100, Math.round((c.wear.left / lifeOf(tier)) * 100))) : 100;
      const behind = this.colony.age - tier;
      clothesText = [`Lleva ropa de ${tierName(tier)} (Edad ${tier}): abriga +${warmthOf(tier)}. Le queda un ${left}% de uso.`, behind >= 1 ? 'Es de una edad anterior: se verá más moderna cuando la cambie.' : '', clothesNote(this.colony, c) ?? ''].filter(Boolean).join(' ');
    } else clothesText = clothesNote(this.colony, c);
    if (clothes.textContent !== clothesText) clothes.textContent = clothesText;

    this.refreshTool(c);
    this.refreshMood(c);
    const health = this.panel.querySelector('[data-health]');
    health.querySelector('[data-value]').textContent = `${Math.round(c.health)}%`;
    setBar(health.querySelector('i'), c.health);
    const w = wellbeing(c);
    const well = this.panel.querySelector('[data-wellbeing]');
    well.querySelector('[data-value]').textContent = `${Math.round(w)}%`;
    setBar(well.querySelector('i'), w);
    setTone(well, w);

    for (const row of this.panel.querySelectorAll('.need-row')) {
      const v = c.needs[row.dataset.need];
      setBar(row.querySelector('i'), v);
      const status = needStatus(v);
      const state = row.querySelector('.need-state');
      state.textContent = `${status.text} · ${Math.round(v)}`;
      setTone(state, v);
    }

    // El registro sólo se redibuja cuando cambia.
    const top = c.log[0];
    if (this.logFor !== top) {
      this.logFor = top;
      this.panel.querySelector('[data-log]').innerHTML = c.log
        .map((entry) => `<li><time>${escapeHtml(entry.time)}</time><span>${escapeHtml(entry.text)}</span></li>`)
        .join('');
    }
  }

  // Herramienta que lleva (sim/tools.js): cuál es, cuánto le queda y cuánto cambia el trabajo.
  refreshTool(c) {
    const box = this.panel.querySelector('[data-toolbox]');
    const trade = toolTrade(this.colony, c);
    box.hidden = !isWorker(c);
    if (box.hidden) return;
    const g = c.tool && TOOL_GOODS[c.tool.id];
    const name = g ? toolName(trade ?? 'building', c.tool.id) : 'Sin herramienta';
    const left = g ? Math.max(0, Math.min(100, (c.tool.left / g.life) * 100)) : 0;
    box.querySelector('[data-tool-name]').textContent = name;
    box.querySelector('[data-tool-wear]').textContent = g ? `Desgaste ${Math.round(100 - left)}%` : '';
    const bar = box.querySelector('[data-tool-bar]');
    bar.hidden = !g;
    if (g) {
      setBar(bar.querySelector('i'), left);
      setTone(box.querySelector('.meter-row'), left);
    }
    const effect = g
      ? `Tarda un ${Math.round((1 - g.time) * 100)} % menos en cada tarea de su oficio.`
      : toolsMatter(this.colony) && trade
        ? `Sin herramienta tarda un ${Math.round((BARE_TIME - 1) * 100)} % más en cada tarea.`
        : '';
    const text = [toolNote(this.colony, c), effect].filter(Boolean).join(' ');
    const note = box.querySelector('[data-tool-note]');
    if (note.textContent !== text) note.textContent = text;
  }

  // Ánimo explicado (sim/wellbeing.js): qué le pasa, qué intenta, qué se lo impide y qué se puede hacer.
  // Sólo se redibuja si cambia el contenido (así no pierde el scroll ni parpadea).
  refreshMood(c) {
    // Un niño no tiene ficha de ánimo: la pestaña se esconde.
    const child = (c.growth ?? 1) < 1;
    this.panel.querySelector('[data-tab="animo"]').hidden = child;
    if (child) {
      if (this.tab === 'animo') this.showTab('estado');
      return;
    }
    const sec = this.panel.querySelector('[data-mood]');
    const d = diagnose(this.colony, c);
    const bandEl = sec.querySelector('[data-mood-band]');
    if (bandEl.textContent !== d.band.text) bandEl.textContent = d.band.text;
    sec.querySelector('[data-mood-value]').textContent = `${d.mood}/100`;
    setBar(sec.querySelector('[data-mood-bar]'), d.mood);
    setTone(sec.querySelector('.meter-row'), d.mood);
    const arrow = d.trend > 0 ? '▲' : d.trend < 0 ? '▼' : '■';
    const trendText = `${arrow} ${d.trendText[0].toUpperCase()}${d.trendText.slice(1)}${d.trend !== 0 ? ` (tiende a ${d.target})` : ''}`;
    const trendEl = sec.querySelector('[data-mood-trend]');
    if (trendEl.textContent !== trendText) trendEl.textContent = trendText;
    const li = (text, cls = '') => `<li class="${cls}">${text}</li>`;
    const impact = (n) => (n > 0 ? `+${n}` : `${n}`);
    const causes = d.causes.map((x) => {
      const adv = x.advice.map((a) => `<span class="mood-advice">${escapeHtml(a.text)}${a.action ? ` <button type="button" class="seg" data-mood-act='${escapeHtml(JSON.stringify(a.action))}'>${actionLabel(a.action)}</button>` : ''}</span>`).join('');
      const block = x.blocker ? `<span class="mood-block">Impedimento: ${escapeHtml(x.blocker)}</span>` : '';
      const trying = x.working ? `<span class="mood-trying">Está en ello: ${escapeHtml(c.activity)}</span>` : '';
      return li(`<strong>${escapeHtml(x.text)}</strong> <em>${impact(x.impact)}${x.source === 'event' ? ' ahora' : ' al objetivo'}</em>${trying}${block}${adv}`, `mood-cause mood-cause--${x.sev}`);
    });
    const goods = d.positives.map((x) => li(`${escapeHtml(x.text)} <em>${impact(x.impact)}</em>`, 'mood-pos'));
    const notes = [];
    if (!d.causes.length) notes.push(li('Nada lo está afectando ahora.', 'mood-pos'));
    if (d.recovery) notes.push(li(`Ya no tiene necesidades urgentes, pero su ánimo se recupera despacio hacia ${d.recovery.to} (~${Math.max(1, Math.round(d.recovery.seconds / 60))} min a velocidad ×1).`, 'mood-note'));
    if (d.busyWith && d.causes.some((x) => x.source === 'need')) notes.push(li(`Ahora está ocupado con otra cosa: ${escapeHtml(d.busyWith)}.`, 'mood-note'));
    const html = `<h4 class="mood-sub">Qué le pasa</h4><ul class="mood-list">${causes.join('')}${notes.join('')}</ul>${goods.length ? `<h4 class="mood-sub">Qué lo ayuda</h4><ul class="mood-list">${goods.join('')}</ul>` : ''}`;
    const box = sec.querySelector('[data-mood-detail]');
    if (box.dataset.html !== html) {
      box.dataset.html = html;
      box.innerHTML = html;
      for (const b of box.querySelectorAll('[data-mood-act]')) b.addEventListener('click', () => document.dispatchEvent(new CustomEvent('colony:action', { detail: { ...JSON.parse(b.dataset.moodAct), colonist: c.id } })));
    }
  }

  // Opciones del selector "Asignar tarea": obras en curso, edificios con puesto y recolección.
  refreshOrderOptions(c) {
    const sites = this.colony.buildings.filter((b) => !b.done && !b.paused);
    const posts = this.colony.buildings.filter((b) => b.done && b.def.skill && this.colony.crewNeeded(b) > 0);
    const hasMarks = this.colony.spots.some((sp) => sp.marked && !sp.gone);
    const key = `${sites.map((b) => b.id).join()}|${posts.map((b) => `${b.id}:${b.workers.length}`).join()}|${hasMarks}`;
    if (key === this.orderOptionsKey) return;
    this.orderOptionsKey = key;
    const list = this.panel.querySelector('[data-order-list]');
    const row = (v, title, sub = '') => `<button type="button" class="task-row" data-task="${v}"><span>${escapeHtml(title)}</span>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</button>`;
    const group = (name, rows) => (rows.length ? `<p class="task-group">${name}</p>${rows.join('')}` : '');
    keepScroll(list, () => (list.innerHTML =
      group('Construir', sites.map((b) => row(`build:${b.id}`, `${b.upgrading ? 'Mejorar' : 'Construir'}: ${b.name}`))) +
      group('Recolectar', hasMarks ? [row('harvest:', 'Recolectar lo marcado')] : []) +
      group('Puesto de trabajo', posts.map((b) => row(`work:${b.id}`, b.name, `${b.def.job} · ${b.workers.length}/${this.colony.crewNeeded(b)}`)))));
    if (!list.innerHTML) list.innerHTML = '<p class="reason">No hay obras ni puestos disponibles.</p>';
  }

  // ---- Ficha de un animal -------------------------------------------------

  showMob(id) {
    if (id == null) {
      if (!this.view.selected) this.panel.hidden = true;
      this.mobShown = null;
      return;
    }
    this.onOpen?.();
    this.panel.hidden = false;
    this.mobShown = null;
    this.updateMob();
  }

  updateMob() {
    const m = this.colony.mobs.find((o) => o.id === this.view.selectedMob);
    if (!m) return;
    const info = MOB_INFO[m.type];
    const st = MOB_STATS[m.type];
    const mates = m.g != null ? this.colony.mobs.filter((o) => o.g === m.g).length : 1;
    // Caballos: domesticar con manzanas (se gastan del almacén al pulsar) o, si ya lo está, dónde espera.
    let tame = '';
    if (m.type === 'caballo') {
      const apples = Math.floor(this.colony.stock.apple ?? 0);
      if (m.tame === 1 || m.tame === 3) tame = `<section class="cp-section"><h3>Domesticado</h3><p class="reason">${m.tame === 3 ? 'Está dentro del establo (de noche o con lluvia se resguarda).' : 'Espera en el patio del establo.'} Todavía no tiene función: se elegirá en la armería (montura de guerra o caballo de carga).</p></section>`;
      else if (m.tame === 2) {
        const who = m.by != null ? this.colony.colonist(m.by) : null;
        tame = `<section class="cp-section"><h3>Domesticar</h3>
          <p class="reason">${who ? `Lo va a domesticar <strong>${escapeHtml(who.name)}</strong>.` : 'Esperando a que un colono libre vaya (de día y con lo básico cubierto).'} Las manzanas ya se gastaron del almacén.</p>
          ${who ? '<button type="button" class="btn" data-tame-who>Ver al colono</button>' : ''}</section>`;
      }
      else {
        const problem = this.colony.tameProblemOf(m);
        const herd = this.colony.tameableHerd(m).length;
        const many = herd > 1 ? this.colony.tameCount(m) : 0;
        tame = `<section class="cp-section"><h3>Domesticar</h3>
          <button type="button" class="btn" data-tame ${problem ? 'disabled' : ''}>Domesticar = ${TAME_COST} manzanas</button>
          ${herd > 1 ? `<button type="button" class="btn" data-tame-herd ${many ? '' : 'disabled'}>Domesticar a la manada: ${many} de ${herd} = ${many * TAME_COST} manzanas</button>` : ''}
          <p class="reason">${problem ? escapeHtml(problem) : `Tienes ${apples} manzanas en el almacén: se gastan ${TAME_COST} al pulsar y un colono libre va a domesticarlo.`}</p></section>`;
      }
    }
    const html = `
      <header class="cp-head">
        <span class="bp-icon">${st.hostile ? '⚠' : '🐾'}</span>
        <div>
          <h2 class="cp-name">${info.name}</h2>
          <p class="cp-sub">${st.hostile ? 'Hostil' : 'Pacífico'} · ${MOB_STATE_TEXT[m.state] ?? ''}</p>
        </div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar ficha">${icon('close')}</button>
      </header>
      <div class="cp-body">
        <p class="reason">${escapeHtml(info.text)}</p>
        <section class="cp-section"><h3>Datos</h3>
          <div class="stat-line"><span>Grupo</span><strong>${mates > 1 ? `${mates} animales` : 'Solitario'}</strong></div>
          <div class="stat-line"><span>Velocidad</span><strong>${st.speed} m/s</strong></div>
          <div class="stat-line"><span>${st.hostile ? 'Amenaza' : 'Utilidad'}</span><strong>${escapeHtml(info.gives)}</strong></div>
          <div class="stat-line"><span>Distancia a la fogata</span><strong>${Math.round(Math.hypot(m.x, m.z))} m</strong></div>
        </section>
        ${tame}
      </div>`;
    if (this.mobShown !== html) {
      this.mobShown = html;
      keepScroll(this.panel, () => (this.panel.innerHTML = html));
      this.panel.querySelector('[data-close]').addEventListener('click', () => this.view.selectMob(null));
      this.panel.querySelector('[data-tame]')?.addEventListener('click', () => this.colony.tameHorse(m.id));
      this.panel.querySelector('[data-tame-who]')?.addEventListener('click', () => {
        const who = this.colony.colonist(m.by);
        if (who) this.view.select(who);
      });
      this.panel.querySelector('[data-tame-herd]')?.addEventListener('click', () => this.colony.tameHerd(m.id));
    }
  }

  // ---- Seguir con la cámara --------------------------------------------------

  startFollowing() {
    const dir = new THREE.Vector3();
    this.controls.startFollow(() => (this.view.selected ? this.colony.directionOf(this.view.selected, dir) : null));
    this.setFollowing(true);
  }

  setFollowing(on) {
    this.following = on;
    const button = this.panel.querySelector('[data-follow]');
    if (button) {
      button.setAttribute('aria-pressed', String(on));
      button.lastChild.textContent = on ? 'Siguiendo' : 'Seguir con la cámara';
    }
  }
}
