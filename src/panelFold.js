import { storageKey } from './storage.js';

// Paneles laterales plegables: cada uno tiene su botón (se vuelve a poner solo cuando el panel
// se redibuja), recuerda su preferencia y, en pantallas chicas, el de la colonia empieza plegado.
// Plegado, sólo queda la cabecera (el primer elemento del panel).

const SMALL = '(max-width: 720px)';

function read(id) {
  try {
    return localStorage.getItem(storageKey(`fold.${id}`));
  } catch {
    return null;
  }
}

function write(id, folded) {
  try {
    localStorage.setItem(storageKey(`fold.${id}`), folded ? '1' : '0');
  } catch {
    // Sin almacenamiento: vale sólo en esta sesión.
  }
}

export function makeFoldable(panel, { startFoldedOnSmall = false } = {}) {
  if (!panel) return;
  const id = panel.id;
  const saved = read(id);
  let folded = saved != null ? saved === '1' : startFoldedOnSmall && window.matchMedia(SMALL).matches;
  const apply = () => {
    panel.classList.toggle('is-folded', folded);
    const btn = panel.querySelector(':scope > .fold-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', String(!folded));
      btn.title = folded ? 'Desplegar el panel' : 'Plegar el panel';
      btn.textContent = folded ? '▸' : '▾';
    }
  };
  const ensure = () => {
    if (panel.querySelector(':scope > .fold-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fold-btn';
    btn.setAttribute('aria-label', 'Plegar o desplegar el panel');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      folded = !folded;
      write(id, folded);
      apply();
    });
    panel.appendChild(btn);
    apply();
  };
  ensure();
  new MutationObserver(ensure).observe(panel, { childList: true });
}
