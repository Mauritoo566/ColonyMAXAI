// Desplazamiento horizontal cómodo para barras que no caben (categorías de construcción, lista de edificios): la rueda del ratón las
// mueve (la vertical se traduce a horizontal), se pueden arrastrar con el ratón (con el dedo ya se deslizan solas), tienen flechas
// a los lados cuando hay más por ver, y lo elegido se mantiene a la vista.

// Lleva "child" a la vista dentro de "scroller" (sólo se mueve el desplazamiento horizontal del scroller, nunca la página).
export function revealInScroller(scroller, child, margin = 14) {
  if (!scroller || !child) return;
  const left = child.offsetLeft - margin;
  const right = child.offsetLeft + child.offsetWidth + margin;
  if (left < scroller.scrollLeft) scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollTo({ left: right - scroller.clientWidth, behavior: 'smooth' });
}

export function enableHScroll(el, { wheel = true, drag = true, arrows = false } = {}) {
  if (wheel) {
    el.addEventListener(
      'wheel',
      (e) => {
        if (el.scrollWidth <= el.clientWidth + 1) return;
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // ya es un gesto horizontal: el navegador lo maneja
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
        const max = el.scrollWidth - el.clientWidth;
        const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY * unit));
        if (next === el.scrollLeft) return; // en el borde: deja que el gesto siga a la página
        el.scrollLeft = next;
        e.preventDefault();
      },
      { passive: false },
    );
  }
  if (drag) {
    let d = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      d = { x: e.clientX, left: el.scrollLeft, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 5) return;
      d.moved = true;
      el.classList.add('is-dragging');
      el.scrollLeft = d.left - dx;
    });
    window.addEventListener('pointerup', () => {
      if (d?.moved) {
        // Lo que se arrastró no cuenta como pulsación (no elige la pestaña sobre la que se soltó).
        const swallow = (ev) => ev.stopPropagation();
        el.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
      }
      d = null;
      el.classList.remove('is-dragging');
    });
  }
  if (!arrows) return null;
  // Flechas a los lados, visibles sólo si hay más por ver hacia ese lado.
  const wrap = document.createElement('div');
  wrap.className = 'hscroll';
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);
  const make = (dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `hscroll-btn hscroll-btn--${dir < 0 ? 'left' : 'right'}`;
    b.tabIndex = -1;
    b.setAttribute('aria-label', dir < 0 ? 'Ver anteriores' : 'Ver más');
    b.textContent = dir < 0 ? '‹' : '›';
    b.addEventListener('click', () => el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' }));
    wrap.appendChild(b);
    return b;
  };
  const left = make(-1);
  const right = make(1);
  const refresh = () => {
    const max = el.scrollWidth - el.clientWidth;
    left.hidden = el.scrollLeft < 2;
    right.hidden = max <= 1 || el.scrollLeft > max - 2;
  };
  el.addEventListener('scroll', refresh, { passive: true });
  window.addEventListener('resize', refresh);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(refresh).observe(el);
  refresh();
  return { wrap, refresh };
}
