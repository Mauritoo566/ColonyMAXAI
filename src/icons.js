// Iconos de los bienes, edificios y servicios que no están en la hoja de index.html. Se
// agregan a esa misma hoja al arrancar; se usan igual: <use href="#i-nombre" />.

const SYMBOLS = {
  grain: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 21V8"/><path fill="currentColor" d="M12 3c2 1.8 2 4.2 0 6-2-1.8-2-4.2 0-6Zm-4 4c2 .4 3.4 2 3.4 4-2-.2-3.6-1.8-3.4-4Zm8 0c.2 2.2-1.4 3.8-3.4 4 0-2 1.4-3.6 3.4-4Zm-8 6c2 .4 3.4 2 3.4 4-2-.2-3.6-1.8-3.4-4Zm8 0c.2 2.2-1.4 3.8-3.4 4 0-2 1.4-3.6 3.4-4Z"/>',
  clay: '<path fill="currentColor" d="M3.5 17c0-4.6 3.8-9 8.5-9s8.5 4.4 8.5 9c0 2-1 3-8.5 3S3.5 19 3.5 17Z"/><path fill="none" stroke="#0c1017" stroke-width="1.2" opacity=".4" d="M7 14h10M8.5 17.5h7"/>',
  ore: '<path fill="currentColor" d="m12 3 7.5 5v8L12 21 4.5 16V8Z"/><path fill="none" stroke="#0c1017" stroke-width="1.2" opacity=".45" d="M4.5 8 12 12l7.5-4M12 12v9"/>',
  ingot: '<path fill="currentColor" d="M3 16.5 6 10h12l3 6.5Z"/><path fill="currentColor" opacity=".6" d="M7 9.2 9 5h6l2 4.2Z"/>',
  tool: '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M7 17 17.5 6.5"/><path fill="currentColor" d="M14.5 3.5a4.2 4.2 0 0 0-3.6 5.8L4.5 15.7a1.7 1.7 0 0 0 2.4 2.4l6.4-6.4a4.2 4.2 0 0 0 5.8-3.6l-2.6 2.2-2.4-2.4Z"/>',
  pot: '<path fill="currentColor" d="M9 3h6v2.2c3 .9 5 3.4 5 6.3 0 4.6-3.6 9-8 9s-8-4.4-8-9c0-2.9 2-5.4 5-6.3Z"/><path fill="none" stroke="#0c1017" stroke-width="1.2" opacity=".4" d="M5 11h14"/>',
  bread: '<path fill="currentColor" d="M3 14c0-4 4-7 9-7s9 3 9 7c0 2-1.6 3.5-4 3.5H7c-2.4 0-4-1.5-4-3.5Z"/><path fill="none" stroke="#0c1017" stroke-width="1.4" stroke-linecap="round" opacity=".45" d="m8 10 1.5 3M12 9.5l1.2 3.5M16 10l1.2 3"/>',
  charcoal: '<path fill="currentColor" d="m6 9 4-2 3 3-1 5-5 1-2-4Zm9 2 4 1 1 4-3 3-4-1-1-4Z"/>',
  block: '<path fill="currentColor" d="m12 3 8 4v10l-8 4-8-4V7Z"/><path fill="none" stroke="#0c1017" stroke-width="1.2" opacity=".45" d="m4 7 8 4 8-4M12 11v10"/>',
  coin: '<circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="5.8" fill="none" stroke="#0c1017" stroke-width="1.5" opacity=".45"/><path fill="none" stroke="#0c1017" stroke-width="1.6" stroke-linecap="round" opacity=".5" d="M12 8.5v7M10 10.4c1.6-1 4 .2 3.6 1.6-.4 1.4-3.4.8-3.6 2.4.2 1.4 2.4 1.6 4 .6"/>',
  plank: '<path fill="currentColor" d="M3 5h18v4H3Zm0 5h18v4H3Zm0 5h18v4H3Z" opacity=".9"/><path fill="none" stroke="#0c1017" stroke-width="1" opacity=".35" d="M8 5v4M15 10v4M6 15v4"/>',
  flour: '<path fill="currentColor" d="M8 3h8l1 3c3 1 4 4 4 8 0 4-2 7-9 7s-9-3-9-7c0-4 1-7 4-8Z"/><path fill="none" stroke="#0c1017" stroke-width="1.4" opacity=".4" d="M7 6.5h10"/>',
  cloth: '<path fill="currentColor" d="M4 7c2-1.8 4-1.8 8 0s6 1.8 8 0v10c-2 1.8-4 1.8-8 0s-6-1.8-8 0Z"/>',
  powder: '<path fill="currentColor" d="M7 8h10l1 11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 8V4.5M12 4.5l2-1.5"/>',
  gear: '<path fill="currentColor" d="M10.3 2.5h3.4l.5 2.4c.6.2 1.2.5 1.7.9l2.3-.8 1.7 2.9-1.8 1.6c.1.6.1 1.2 0 1.8l1.8 1.6-1.7 2.9-2.3-.8c-.5.4-1.1.7-1.7.9l-.5 2.4h-3.4l-.5-2.4c-.6-.2-1.2-.5-1.7-.9l-2.3.8-1.7-2.9 1.8-1.6a6 6 0 0 1 0-1.8L4.2 8.9l1.7-2.9 2.3.8c.5-.4 1.1-.7 1.7-.9Z"/><circle cx="12" cy="12" r="3" fill="#0c1017" opacity=".5"/>',
  book: '<path fill="currentColor" d="M3 5.5c3-1 6-1 9 1v13c-3-2-6-2-9-1Zm18 0c-3-1-6-1-9 1v13c3-2 6-2 9-1Z"/>',
  beam: '<path fill="currentColor" d="M4 5h16v3.5h-5.5v7H20V19H4v-3.5h5.5v-7H4Z"/>',
  brick: '<path fill="currentColor" d="M3 5h8v4H3Zm9 0h9v4h-9ZM3 10h4.5v4H3Zm5.5 0h9v4h-9Zm10 0H21v4h-2.5ZM3 15h8v4H3Zm9 0h9v4h-9Z"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/><rect x="9" y="9" width="6" height="6" fill="#0c1017" opacity=".45"/>',
  sword: '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M5 19 17 7"/><path fill="currentColor" d="M20.5 3.5 21 8l-3.6 3.6-4.5-4.5L16.5 3.5ZM4 15.5l4.5 4.5-2.2.8L3 17.5Z"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="m8.5 15.5 3 3"/>',
  anvil: '<path fill="currentColor" d="M3 6h14c0 2.6-1.6 4-4 4.4V13h2.5c1 0 1.5.6 1.5 1.5V17H7v-2.5c0-.9.5-1.5 1.5-1.5H11v-2.6C7.6 10 4 8.8 3 6Zm14 0h4c-.4 2-1.8 3.4-4 3.6Z"/>',
  bolt: '<path fill="currentColor" d="M13.5 2 5 13.5h5.5L9.5 22 19 9.5h-5.8Z"/>',
  train: '<path fill="currentColor" d="M7 3h10a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3l1.5 3h-2l-1-2h-5l-1 2h-2L8 18a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Z"/><path fill="#0c1017" opacity=".5" d="M7.5 6h9v4h-9Z"/><circle cx="8.8" cy="14.5" r="1.2" fill="#0c1017" opacity=".55"/><circle cx="15.2" cy="14.5" r="1.2" fill="#0c1017" opacity=".55"/>',
};

export function ensureIcons() {
  const sprite = document.querySelector('svg symbol')?.closest('svg');
  if (!sprite) return;
  for (const [id, body] of Object.entries(SYMBOLS)) {
    if (sprite.querySelector(`#i-${id}`)) continue;
    const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    symbol.id = `i-${id}`;
    symbol.setAttribute('viewBox', '0 0 24 24');
    symbol.innerHTML = body;
    sprite.appendChild(symbol);
  }
}
