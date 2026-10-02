import { guideState } from './guide.js';
import { preserveScroll } from './keepScroll.js';
import { storageKey } from './storage.js';

// Tarjeta de la guía: el objetivo actual con su explicación, el progreso, la acción para hacerlo y
// los avisos de escasez. Se puede plegar (y se recuerda); el progreso vive en el servidor (acciones
// aprendidas) o se vuelve a comprobar (condiciones), así que sobrevive a recargar la página.

const REFRESH_SECONDS = 0.5;

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export class GuideUI {
  // actions: { [idDelPaso]: () => void } las acciones que abre cada paso.
  constructor({ colony, actions, onNotice }) {
    this.colony = colony;
    this.actions = actions;
    this.onNotice = onNotice;
    this.card = document.getElementById('guide-card');
    preserveScroll(this.card);
    const open = (e) => {
      const li = e.target.closest?.('[data-alert-ids]');
      if (!li || (e.type === 'keydown' && e.key !== 'Enter')) return;
      document.dispatchEvent(new CustomEvent('colony:focus-colonists', { detail: { id: li.dataset.alertKey, ids: li.dataset.alertIds.split(',').map(Number) } }));
    };
    this.card.addEventListener('click', open);
    this.card.addEventListener('keydown', open);
    this.timer = 0;
    this.key = '';
    this.folded = false;
    this.showAll = false;
    try {
      this.folded = localStorage.getItem(storageKey('guideFolded')) === '1';
    } catch {
      this.folded = false;
    }
    this.card.addEventListener('click', (e) => {
      const hit = (sel) => e.target.closest(sel);
      if (hit('[data-guide-fold]')) {
        this.folded = !this.folded;
        try {
          localStorage.setItem(storageKey('guideFolded'), this.folded ? '1' : '0');
        } catch {
          // Sin almacenamiento: vale sólo en esta sesión.
        }
        this.key = '';
        this.render();
      }
      if (hit('[data-guide-all]')) {
        this.showAll = !this.showAll;
        this.key = '';
        this.render();
      }
      const act = hit('[data-guide-act]');
      if (act) this.actions[act.dataset.guideAct]?.();
    });
  }

  update(delta) {
    this.timer -= delta;
    if (this.timer > 0) return;
    this.timer = REFRESH_SECONDS;
    this.render();
  }

  render() {
    const colony = this.colony;
    const state = colony.camp && !colony.defeat && colony.colonists.length ? guideState(colony) : null;
    this.card.hidden = !state;
    if (!state) return;
    const alerts = colony.alerts ?? [];
    // La estructura sólo se rehace si cambia algo importante; los números y notas se actualizan en el sitio
    // (así un clic en un botón nunca se pierde porque la tarjeta se redibujó a mitad).
    const discoveryOn = !!colony.discovery;
    const key = JSON.stringify([this.folded, this.showAll, state.steps.map((s) => [s.id, s.done, !!s.note]), alerts.map((a) => [a.id, a.level, a.ids?.join(',')]), discoveryOn, state.current?.id]);
    if (key === this.key) {
      for (const s of state.steps) for (const el of this.card.querySelectorAll(`[data-note="${s.id}"]`)) if (el.textContent !== (s.note ?? '')) el.textContent = s.note ?? '';
      const bar = this.card.querySelector('[data-disc-bar]');
      if (bar && colony.discovery) bar.style.width = `${Math.round(colony.discovery.progress * 100)}%`;
      for (const a of alerts) for (const el of this.card.querySelectorAll(`[data-alert="${a.id}"]`)) if (el.textContent !== a.text) el.textContent = a.text;
      return;
    }
    this.key = key;
    const { guide, steps, current, done } = state;
    const cur = current;
    const alertHtml = alerts.length
      ? `<ul class="guide-alerts">${alerts.slice(0, 4).map((a) => `<li class="guide-alert guide-alert--${a.level}${a.ids ? ' is-clickable' : ''}" ${a.ids ? `data-alert-ids="${a.ids.join(',')}" data-alert-key="${a.id}" title="Tocá para ir a los afectados (${a.ids.length})" tabindex="0"` : ''}><strong data-alert="${a.id}">${esc(a.text)}</strong><span>${esc(a.hint)}</span></li>`).join('')}</ul>`
      : '';
    const discovery = colony.discovery;
    const problem = cur?.id === 'discovery' && !colony.milestones.has('stone_tool') && !discovery ? colony.discoveryProblem() : null;
    const body = this.folded
      ? ''
      : `
      <div class="guide-body">
        ${done === 0 ? `<p class="guide-intro">${esc(`${guide.title}: ${guide.intro}`)}</p>` : ''}
        ${
          cur
            ? `<div class="guide-current">
                 <p class="guide-kind">${cur.kind === 'learned' ? 'Objetivo (una vez hecho, queda)' : 'Objetivo (se vuelve a comprobar)'}</p>
                 <h3>${esc(cur.title)}</h3>
                 <p>${esc(cur.text)}</p>
                 ${cur.note ? `<p class="guide-note" data-note="${cur.id}">${esc(cur.note)}</p>` : ''}
                 ${discovery && cur.id === 'discovery' ? `<div class="bar"><i data-disc-bar style="width:${Math.round(discovery.progress * 100)}%"></i></div>` : ''}
                 ${cur.action && !(discovery && cur.id === 'discovery') ? `<button type="button" class="btn btn--primary" data-guide-act="${cur.id}" ${problem ? 'disabled' : ''} title="${esc(problem ?? '')}">${esc(cur.action)}</button>` : ''}
                 ${problem ? `<p class="reason">${esc(problem)}</p>` : ''}
               </div>`
            : '<p class="guide-current">¡Todo listo en esta edad!</p>'
        }
        ${alertHtml}
        <button type="button" class="guide-link" data-guide-all>${this.showAll ? 'Ocultar los pasos' : 'Ver todos los pasos'}</button>
        ${
          this.showAll
            ? `<ol class="guide-steps">${steps.map((s) => `<li class="${s.done ? 'is-done' : s === cur ? 'is-now' : ''}"><span class="guide-tick">${s.done ? '✓' : ''}</span><span>${esc(s.title)}${s.note && !s.done ? `<small data-note="${s.id}">${esc(s.note)}</small>` : ''}</span>${!s.done && s.action ? `<button type="button" class="seg" data-guide-act="${s.id}">${esc(s.action)}</button>` : ''}</li>`).join('')}</ol>`
            : ''
        }
      </div>`;
    this.card.innerHTML = `
      <header class="guide-head">
        <div><p class="eyebrow">Guía · ${esc(guide.title)}</p><p class="guide-progress">${done}/${steps.length} · ${cur ? esc(cur.title) : 'Completada'}</p></div>
        <button type="button" class="seg" data-guide-fold aria-expanded="${!this.folded}" title="${this.folded ? 'Mostrar la guía' : 'Plegar la guía'}">${this.folded ? 'Guía ▸' : '▾'}</button>
      </header>${body}`;
    if (alerts.some((a) => a.level === 'bad') && this.folded) this.card.classList.add('has-alert');
    else this.card.classList.remove('has-alert');
  }
}
