import { logout, saveToken } from './auth.js';
import { preserveScroll } from './keepScroll.js';
import { cleanVillageName } from './sim/villageName.js';
import { graphics, PRESETS, setQuality } from './graphics.js';

// Configuración: datos de la cuenta, cerrar sesión y eliminar la cuenta (pide la contraseña y
// borra el campamento y todo lo de la cuenta en el servidor).

export class SettingsUI {
  constructor({ net, playerName, colony }) {
    this.net = net;
    this.colony = colony;
    this.playerName = playerName;
    this.modal = document.getElementById('settings-modal');
    this.panel = document.getElementById('settings-panel');
    preserveScroll(this.panel);
    document.getElementById('settings-toggle').addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.hidden) this.toggle(false);
    });
    this.modal.addEventListener('pointerdown', (e) => {
      if (e.target === this.modal) this.toggle(false);
    });
    this.panel.addEventListener('click', (e) => this.onClick(e));
    net.on('accountDeleted', () => {
      saveToken(null);
      location.reload();
    });
    net.on('error', (m) => {
      if (m.about === 'deleteAccount') this.say(m.message, true);
    });
  }

  // El nombre de la aldea sólo se puede poner si ya fundaste tu campamento.
  setupVillage() {
    const box = this.panel.querySelector('[data-village]');
    if (!box || !this.colony?.camp) return;
    box.hidden = false;
    const input = box.querySelector('[data-village-input]');
    const msg = box.querySelector('[data-village-msg]');
    input.value = this.colony.villageName || '';
    box.querySelector('[data-village-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const wanted = cleanVillageName(input.value);
      this.colony.setVillageName(wanted);
      input.value = wanted;
      msg.textContent = wanted ? `Tu aldea se llama «${wanted}».` : 'Sin nombre propio: se muestra tu nombre de jugador.';
    });
  }

  toggle(open = this.modal.hidden) {
    this.modal.hidden = !open;
    if (open) this.render();
  }

  say(text, bad = false) {
    const el = this.panel.querySelector('[data-msg]');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-bad', bad);
  }

  render() {
    this.panel.innerHTML = `
      <div class="cp-head" style="padding:0 0 10px">
        <div>
          <p class="eyebrow">Configuración</p>
          <h2 class="cp-name">Cuenta</h2>
        </div>
        <button type="button" class="icon-button" data-close aria-label="Cerrar (Escape)" title="Cerrar (Escape)"><svg class="icon" aria-hidden="true"><use href="#i-close" /></svg></button>
      </div>
      <div class="age-body">
        <section class="cp-section">
          <h3>Calidad gráfica</h3>
          <p class="reason">Si el juego va a tirones, bajá la calidad: se sigue viendo todo igual de lejos, sólo cambia la nitidez. Además, la resolución baja y sube sola para sostener los 60 FPS.</p>
          <label class="order-label">Calidad
            <select data-quality>
              ${[['auto', 'Auto (recomendada)'], ...Object.entries(PRESETS).map(([id, p]) => [id, p.label])]
                .map(([id, label]) => `<option value="${id}"${graphics.choice === id ? ' selected' : ''}>${label}</option>`)
                .join('')}
            </select>
          </label>
          <p class="reason" data-quality-info>Ahora: <strong>${PRESETS[graphics.effective].label}</strong>. Cambiarla reinicia la pantalla del juego (tu aldea no se toca).</p>
        </section>
        <section class="cp-section" data-village hidden>
          <h3>Mi aldea</h3>
          <p class="reason">El nombre de tu aldea lo ven todos los jugadores sobre tu campamento y en la lista del mundo (junto a tu nombre de jugador). Hasta 28 letras; vacío para volver a usar tu nombre.</p>
          <form class="village-form" data-village-form>
            <input class="order-input" type="text" maxlength="28" data-village-input placeholder="Nombre de tu aldea" autocomplete="off" />
            <button type="submit" class="btn">Guardar nombre</button>
          </form>
          <p class="reason" data-village-msg role="status"></p>
        </section>
        <section class="cp-section">
          <h3>Sesión</h3>
          <p class="reason">Jugando como <strong>${this.playerName.replace(/[&<>"]/g, '')}</strong>. Tu aldea sigue en el servidor aunque cierres la sesión.</p>
          <button type="button" class="btn" data-logout>Cerrar sesión</button>
        </section>
        <section class="cp-section danger-zone">
          <h3>Eliminar cuenta</h3>
          <p class="reason">Borra para siempre tu cuenta, tu campamento y todos tus colonos y edificios. No se puede deshacer.</p>
          <div data-delete-start><button type="button" class="btn btn--danger" data-delete-ask>Eliminar mi cuenta…</button></div>
          <form class="delete-form" data-delete-form hidden>
            <label class="order-label">Escribe tu contraseña para confirmar
              <input type="password" name="password" autocomplete="current-password" required maxlength="200">
            </label>
            <div class="order-buttons">
              <button type="submit" class="btn btn--danger">Eliminar definitivamente</button>
              <button type="button" class="btn" data-delete-cancel>Cancelar</button>
            </div>
          </form>
          <p class="order-msg" data-msg role="status"></p>
        </section>
      </div>`;
    this.panel.querySelector('[data-quality]').addEventListener('change', (e) => setQuality(e.target.value));
    this.panel.querySelector('[data-delete-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const password = e.target.elements.password.value;
      if (!password) return;
      this.say('Comprobando…');
      if (!this.net.send({ t: 'deleteAccount', password })) this.say('No hay conexión con el servidor.', true);
    });
    this.setupVillage();
  }

  onClick(e) {
    const hit = (sel) => e.target.closest(sel);
    if (hit('[data-close]')) this.toggle(false);
    if (hit('[data-logout]')) logout(this.net);
    if (hit('[data-delete-ask]')) {
      this.panel.querySelector('[data-delete-start]').hidden = true;
      const form = this.panel.querySelector('[data-delete-form]');
      form.hidden = false;
      form.elements.password.focus();
    }
    if (hit('[data-delete-cancel]')) {
      this.panel.querySelector('[data-delete-form]').hidden = true;
      this.panel.querySelector('[data-delete-start]').hidden = false;
      this.say('');
    }
  }
}
