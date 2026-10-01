// Selector de bandera de la aldea: lista de países con buscador. La elegida se ve en el
// mástil del campamento (y la ven los demás jugadores).
import { FLAGS_SORTED, FLAGS_BY_ID, DEFAULT_FLAG, drawFlag } from './flags.js';

function thumb(flag) {
  const canvas = document.createElement('canvas');
  canvas.width = 60;
  canvas.height = 38;
  drawFlag(canvas.getContext('2d'), flag, 60, 38);
  return canvas;
}

export class FlagUI {
  constructor({ button, chip, panel, grid, search, colony }) {
    this.button = button;
    this.chip = chip;
    this.panel = panel;
    this.grid = grid;
    this.search = search;
    this.colony = colony;
    this.cells = [];
    for (const flag of FLAGS_SORTED) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'flag-cell';
      cell.dataset.id = flag.id;
      cell.title = flag.name;
      cell.setAttribute('role', 'option');
      cell.append(thumb(flag), Object.assign(document.createElement('span'), { textContent: flag.name }));
      cell.addEventListener('click', () => colony.setFlag(flag.id));
      grid.append(cell);
      this.cells.push({ flag, cell });
    }
    button.addEventListener('click', () => this.toggle());
    search.addEventListener('input', () => this.filter());
    colony.on('flag', () => this.refresh());
    colony.on('camp', () => this.refresh());
    this.refresh();
  }

  toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) this.search.focus();
  }

  filter() {
    const q = this.search.value.trim().toLowerCase();
    for (const { flag, cell } of this.cells) cell.hidden = !!q && !flag.name.toLowerCase().includes(q);
  }

  refresh() {
    const id = FLAGS_BY_ID.has(this.colony.flag) ? this.colony.flag : DEFAULT_FLAG;
    this.button.hidden = !this.colony.camp;
    if (!this.colony.camp) this.toggle(false);
    this.chip.replaceChildren(thumb(FLAGS_BY_ID.get(id)));
    for (const { flag, cell } of this.cells) cell.setAttribute('aria-selected', String(flag.id === id));
  }
}
