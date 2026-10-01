import { SPEC_IDS, SPEC_NAMES, isWorker } from './sim/specialties.js';

// Tabla de trabajo de la aldea: una fila por colono con sus tres especialidades (prioridad 1, 2 y 3), su
// actividad y su estado, y un resumen de cobertura. Cambiar una especialidad no pierde experiencia y se
// aplica en un punto seguro (la fila muestra «cambio pendiente»).

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export class WorkUI {
  constructor({ colony, onFocus }) {
    this.colony = colony;
    this.onFocus = onFocus;
    this.button = document.getElementById('work-button');
    this.modal = document.getElementById('work-modal');
    this.panel = document.getElementById('work-panel');
    this.key = '';
    this.timer = 0;
    this.button.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.hidden) this.toggle(false);
    });
    this.modal.addEventListener('pointerdown', (e) => {
      if (e.target === this.modal) this.toggle(false);
    });
    this.panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.toggle(false);
      const who = e.target.closest('[data-focus]');
      if (who) this.onFocus?.(this.colony.colonist(Number(who.dataset.focus)));
    });
    this.panel.addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-slot]');
      if (!sel) return;
      const c = this.colony.colonist(Number(sel.dataset.who));
      if (!c) return;
      const slot = Number(sel.dataset.slot);
      const next = [...(c.pendingSpec ?? c.spec)];
      const prev = next[slot];
      const dup = next.indexOf(sel.value);
      if (dup >= 0 && dup !== slot) next[dup] = prev; // sin duplicados: se intercambian
      next[slot] = sel.value;
      this.colony.setSpec(c, next);
      this.key = '';
    });
  }

  toggle(open = this.modal.hidden) {
    this.modal.hidden = !open;
    this.key = '';
    if (open) this.render();
  }

  update(delta) {
    const has = !!this.colony.camp;
    this.button.hidden = !has;
    if (!has) return;
    this.timer -= delta;
    if (this.timer > 0 || this.modal.hidden) return;
    this.timer = 0.5;
    this.render();
  }

  render() {
    const colony = this.colony;
    const workers = colony.colonists.filter(isWorker);
    // No se redibuja mientras se está eligiendo en un desplegable.
    if (this.panel.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    const cov = colony.coverage();
    const key = JSON.stringify([workers.map((c) => [c.id, c.spec, c.pendingSpec, c.activity, c.idle, !!c.order, c.skills]), cov.gaps]);
    if (key === this.key) return;
    this.key = key;
    const opt = (c, cat, current) => `<option value="${cat}" ${cat === current ? 'selected' : ''}>${SPEC_NAMES[cat]} · nivel ${colony.skillOf(c, cat)}</option>`;
    const rows = workers.map((c) => {
      const spec = c.pendingSpec ?? c.spec ?? [];
      const state = c.order ? '<b class="order-tag">Orden</b> cumple una orden directa' : c.task?.type === 'wander' || !c.task ? esc(c.idle ?? 'Disponible') : c.working ? 'Trabajando' : 'En camino';
      return `<tr>
        <td><button type="button" class="link-btn" data-focus="${c.id}">${esc(c.name)}</button></td>
        ${[0, 1, 2].map((i) => `<td><select data-who="${c.id}" data-slot="${i}" aria-label="Prioridad ${i + 1}">${SPEC_IDS.map((id) => opt(c, id, spec[i])).join('')}</select></td>`).join('')}
        <td>${esc(c.activity)}</td>
        <td>${state}${c.pendingSpec ? ' · <em>cambio pendiente</em>' : ''}</td>
      </tr>`;
    });
    const covHtml = cov.rows.length
      ? `<p class="reason"><strong>Cobertura</strong> (primera prioridad / total): ${cov.rows.map((r) => `${esc(r.name)} ${r.first}/${r.any}`).join(' · ')}</p>`
      : '';
    const gapHtml = cov.gaps.length ? `<ul class="work-gaps">${cov.gaps.map((g) => `<li>⚠ ${esc(g)}</li>`).join('')}</ul>` : '<p class="reason">Todo el trabajo disponible tiene alguien que pueda atenderlo.</p>';
    this.panel.innerHTML = `
      <div class="cp-head" style="padding:0 0 10px">
        <div><p class="eyebrow">Trabajo de la aldea</p><h2 class="cp-name">Especialidades</h2></div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar (Escape)">✕</button>
      </div>
      <p class="reason">Cada colono acepta solo trabajos de sus tres especialidades, buscando primero en la 1.ª, luego en la 2.ª y la 3.ª. El nivel junto al nombre es su habilidad (no la prioridad). Una orden directa es una excepción temporal.</p>
      ${covHtml}${gapHtml}
      <div class="age-body"><table class="work-table"><thead><tr><th>Colono</th><th>Prioridad 1</th><th>Prioridad 2</th><th>Prioridad 3</th><th>Actividad actual</th><th>Estado</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
}
