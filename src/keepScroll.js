// Reescribir un panel con innerHTML devuelve su scroll (y el de lo que contiene) arriba. Esto lo conserva:
// guarda la posición de todo lo que tenía scroll, ejecuta el cambio y la restaura.
export function keepScroll(root, change) {
  const saved = [];
  const walk = (el, path) => {
    if (el.scrollTop > 0 || el.scrollLeft > 0) saved.push([path, el.scrollTop, el.scrollLeft]);
    for (let i = 0; i < el.children.length; i++) walk(el.children[i], `${path}/${i}`);
  };
  walk(root, '');
  change();
  for (const [path, top, left] of saved) {
    let el = root;
    for (const i of path.split('/').filter(Boolean)) el = el?.children[Number(i)];
    if (el) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
  }
}

// El ancestro más cercano con scroll propio (donde se desplaza una lista).
export function scrollParent(el) {
  for (let p = el; p; p = p.parentElement) if (p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  return null;
}

// Hace que cada reescritura de innerHTML de este elemento conserve el scroll (para paneles que se redibujan solos).
export function preserveScroll(el) {
  if (!el || el.__keepScroll) return el;
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set(value) {
      keepScroll(this, () => desc.set.call(this, value));
    },
  });
  el.__keepScroll = true;
  return el;
}
