import * as THREE from 'three';
import { NEEDS, wellbeing, needStatus } from './needs.js';
import { GENES, gene, genomeCode, lifeExpectancy } from './genes.js';

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

export class ColonyUI {
  constructor({ colony, controls, camera, canvas, isBlocked = () => false }) {
    this.colony = colony;
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
    this.wellbeingValue = $('colony-wellbeing');
    this.wellbeingBar = $('colony-wellbeing-bar');
    this.needSummary = $('need-summary');
    this.roster = $('roster');
    this.panel = $('colonist-panel');

    // Resumen de necesidades (fijo: cinco casillas).
    this.needSummary.innerHTML = NEEDS.map(
      (n) =>
        `<li data-need="${n.id}" style="--need:${n.color};--bar:${n.color}" title="${n.name} (media de la colonia)">${icon(n.id)}<div class="bar"><i></i></div></li>`,
    ).join('');

    // En pantallas chicas la lista empieza plegada.
    if (window.matchMedia('(max-width: 720px)').matches) $('roster-wrap').open = false;

    colony.onSelect = (c) => this.showColonist(c);
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
      const c = colony.pickAt(e.clientX, e.clientY);
      if (c) colony.select(c);
      else if (colony.selected) colony.select(null);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && colony.selected && !this.isBlocked()) colony.select(null);
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
    if (this.rosterFor !== this.colony.colonists) this.buildRoster();

    this.count.textContent = String(this.colony.count);
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
    if (this.colony.selected) this.updatePanel(this.colony.selected);
  }

  // ---- Lista de colonos ----------------------------------------------------

  buildRoster() {
    this.rosterFor = this.colony.colonists;
    this.roster.innerHTML = '';
    this.rows = new Map();
    for (const c of this.colony.colonists) {
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
      const html = c.needs[worst.id] < 30 ? `${icon(worst.id)}${escapeHtml(worst.low)}` : escapeHtml(c.activity);
      if (activity.dataset.html !== html) {
        activity.innerHTML = html;
        activity.dataset.html = html;
      }
      li.firstElementChild.classList.toggle('is-selected', this.colony.selected === c);
    }
  }

  // Elegir desde la lista: si el colono no está a la vista, la cámara vuela hasta él.
  focusColonist(c) {
    this.colony.select(c);
    const dir = this.colony.directionOf(c, this.tmpDir);
    const p = this.tmpProj.copy(c.object.position).project(this.camera);
    const onScreen = p.z < 1 && Math.abs(p.x) < 0.8 && Math.abs(p.y) < 0.8;
    const near = this.camera.position.distanceTo(c.object.position) < 400;
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
    if (this.following) this.startFollowing();
    this.panel.hidden = false;
    this.panel.innerHTML = `
      <header class="cp-head">
        <span class="avatar avatar--lg"></span>
        <div>
          <h2 class="cp-name">${escapeHtml(c.name)}</h2>
          <p class="cp-sub">${c.age} años · <span data-activity></span></p>
        </div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar ficha">${icon('close')}</button>
      </header>
      <div class="cp-tabs" role="tablist">
        <button type="button" class="cp-tab" role="tab" data-tab="estado">Estado</button>
        <button type="button" class="cp-tab" role="tab" data-tab="genes">Genes</button>
        <button type="button" class="cp-tab" role="tab" data-tab="historia">Historia</button>
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
        <section class="cp-section">
          <h3>Ahora</h3>
          <p class="activity-now" data-activity></p>
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
      <div class="cp-body" data-page="historia" hidden>
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
      <div class="cp-actions">
        <button type="button" class="btn" data-follow aria-pressed="false">${icon('follow')}Seguir con la cámara</button>
      </div>`;
    paintAvatar(this.panel.querySelector('.avatar'), c.look);
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.colony.select(null));
    this.panel.querySelector('[data-follow]').addEventListener('click', () => {
      if (this.following) this.controls.stopFollow();
      else this.startFollowing();
    });
    for (const tab of this.panel.querySelectorAll('[data-tab]')) {
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab));
    }
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

  // ---- Seguir con la cámara --------------------------------------------------

  startFollowing() {
    const dir = new THREE.Vector3();
    this.controls.startFollow(() => (this.colony.selected ? this.colony.directionOf(this.colony.selected, dir) : null));
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
