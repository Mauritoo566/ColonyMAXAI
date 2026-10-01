// Banderas de países para el mástil de la aldea. Están dibujadas con formas simples
// (rayas, círculos, estrellas, cruces), sin emojis ni imágenes: los emojis de bandera no
// se ven en Windows y así se dibujan igual en cualquier equipo. Son aproximaciones
// sencillas (sin escudos). Cada una se describe con una lista de operaciones en
// coordenadas relativas (0–1 del ancho y del alto); drawFlag() las pinta en un canvas.
//
// Este archivo no usa nada del navegador: el servidor lo importa sólo para saber qué
// banderas existen.

const W = '#ffffff';
const K = '#111111';

// Operaciones:
//   ['H', colores, pesos?]   franjas horizontales        ['V', colores, pesos?]   verticales
//   ['rect', x, y, w, h, color]            ['poly', puntos, color]
//   ['circle', x, y, r, color]             ['ring', x, y, r, grosor, color]   (r relativo al alto)
//   ['star', x, y, r, color, puntas?, interior?]
//   ['semi', x, y, r, color, desde, hasta] (medio círculo)
//   ['line', x1, y1, x2, y2, grosor, color]
//   ['nordic', color, borde|null, cx?]     cruz escandinava
//   ['jack', x, y, w, h]                   bandera del Reino Unido en un rectángulo
const stripes = (a, b) => Array.from({ length: 9 }, (_, i) => (i % 2 ? b : a));

export const FLAGS = [
  { id: 'tribe', name: 'Sin país (los colores de la tribu)', ops: [['H', ['#b8322a', '#e8c35a', '#b8322a'], [0.43, 0.14, 0.43]]] },
  { id: 'de', name: 'Alemania', ops: [['H', [K, '#dd0000', '#ffce00']]] },
  { id: 'sa', name: 'Arabia Saudita', ops: [['H', ['#006c35']], ['rect', 0.2, 0.3, 0.6, 0.07, W], ['line', 0.25, 0.7, 0.75, 0.7, 0.045, W]] },
  { id: 'ar', name: 'Argentina', ops: [['H', ['#74acdf', W, '#74acdf']], ['circle', 0.5, 0.5, 0.11, '#f6b40e']] },
  { id: 'au', name: 'Australia', ops: [['H', ['#00008b']], ['jack', 0, 0, 0.5, 0.5], ['star', 0.25, 0.75, 0.1, W, 7, 0.5], ['star', 0.75, 0.25, 0.05, W, 7, 0.5], ['star', 0.85, 0.5, 0.05, W, 7, 0.5], ['star', 0.75, 0.75, 0.05, W, 7, 0.5], ['star', 0.62, 0.52, 0.04, W, 7, 0.5]] },
  { id: 'at', name: 'Austria', ops: [['H', ['#ed2939', W, '#ed2939']]] },
  { id: 'be', name: 'Bélgica', ops: [['V', [K, '#fae042', '#ed2939']]] },
  { id: 'bo', name: 'Bolivia', ops: [['H', ['#d52b1e', '#f9e300', '#007934']]] },
  { id: 'br', name: 'Brasil', ops: [['H', ['#009c3b']], ['poly', [[0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5]], '#ffdf00'], ['circle', 0.5, 0.5, 0.22, '#002776'], ['line', 0.36, 0.52, 0.64, 0.46, 0.05, W]] },
  { id: 'bg', name: 'Bulgaria', ops: [['H', [W, '#00966e', '#d62612']]] },
  { id: 'ca', name: 'Canadá', ops: [['V', ['#d52b1e', W, '#d52b1e'], [1, 2, 1]], ['star', 0.5, 0.52, 0.24, '#d52b1e', 8, 0.5]] },
  { id: 'cl', name: 'Chile', ops: [['H', [W, '#d52b1e']], ['rect', 0, 0, 0.33, 0.5, '#0039a6'], ['star', 0.165, 0.25, 0.11, W]] },
  { id: 'cn', name: 'China', ops: [['H', ['#de2910']], ['star', 0.17, 0.28, 0.16, '#ffde00'], ['star', 0.34, 0.12, 0.05, '#ffde00'], ['star', 0.4, 0.22, 0.05, '#ffde00'], ['star', 0.4, 0.36, 0.05, '#ffde00'], ['star', 0.34, 0.46, 0.05, '#ffde00']] },
  { id: 'co', name: 'Colombia', ops: [['H', ['#fcd116', '#003893', '#ce1126'], [2, 1, 1]]] },
  { id: 'kr', name: 'Corea del Sur', ops: [['H', [W]], ['semi', 0.5, 0.5, 0.22, '#cd2e3a', Math.PI, 0], ['semi', 0.5, 0.5, 0.22, '#0047a0', 0, Math.PI], ['rect', 0.12, 0.14, 0.1, 0.03, K], ['rect', 0.12, 0.2, 0.1, 0.03, K], ['rect', 0.12, 0.26, 0.1, 0.03, K], ['rect', 0.78, 0.71, 0.1, 0.03, K], ['rect', 0.78, 0.77, 0.1, 0.03, K], ['rect', 0.78, 0.83, 0.1, 0.03, K]] },
  { id: 'cr', name: 'Costa Rica', ops: [['H', ['#002b7f', W, '#ce1126', W, '#002b7f'], [1, 1, 2, 1, 1]]] },
  { id: 'cu', name: 'Cuba', ops: [['H', ['#002a8f', W, '#002a8f', W, '#002a8f']], ['poly', [[0, 0], [0.43, 0.5], [0, 1]], '#cf142b'], ['star', 0.14, 0.5, 0.1, W]] },
  { id: 'dk', name: 'Dinamarca', ops: [['H', ['#c8102e']], ['nordic', W, null]] },
  { id: 'ec', name: 'Ecuador', ops: [['H', ['#ffdd00', '#034ea2', '#ed1c24'], [2, 1, 1]]] },
  { id: 'eg', name: 'Egipto', ops: [['H', ['#ce1126', W, K]], ['circle', 0.5, 0.5, 0.07, '#c09300']] },
  { id: 'sv', name: 'El Salvador', ops: [['H', ['#0f47af', W, '#0f47af']], ['circle', 0.5, 0.5, 0.1, '#7a9a3a']] },
  { id: 'es', name: 'España', ops: [['H', ['#aa151b', '#f1bf00', '#aa151b'], [1, 2, 1]], ['rect', 0.22, 0.38, 0.08, 0.24, '#aa151b']] },
  { id: 'us', name: 'Estados Unidos', ops: [['H', Array.from({ length: 13 }, (_, i) => (i % 2 ? W : '#b22234'))], ['rect', 0, 0, 0.4, 0.538, '#3c3b6e'], ...Array.from({ length: 20 }, (_, i) => ['circle', 0.05 + (i % 5) * 0.075, 0.07 + Math.floor(i / 5) * 0.11, 0.025, W])] },
  { id: 'ph', name: 'Filipinas', ops: [['H', ['#0038a8', '#ce1126']], ['poly', [[0, 0], [0.45, 0.5], [0, 1]], W], ['star', 0.12, 0.5, 0.07, '#fcd116']] },
  { id: 'fi', name: 'Finlandia', ops: [['H', [W]], ['nordic', '#003580', null]] },
  { id: 'fr', name: 'Francia', ops: [['V', ['#0055a4', W, '#ef4135']]] },
  { id: 'gr', name: 'Grecia', ops: [['H', stripes('#0d5eaf', W)], ['rect', 0, 0, 0.37, 0.556, '#0d5eaf'], ['rect', 0.15, 0, 0.07, 0.556, W], ['rect', 0, 0.245, 0.37, 0.066, W]] },
  { id: 'gt', name: 'Guatemala', ops: [['V', ['#4997d0', W, '#4997d0']], ['circle', 0.5, 0.5, 0.1, '#7a9a3a']] },
  { id: 'hn', name: 'Honduras', ops: [['H', ['#0073cf', W, '#0073cf']], ...[[0.5, 0.5], [0.42, 0.47], [0.58, 0.47], [0.42, 0.53], [0.58, 0.53]].map(([x, y]) => ['star', x, y, 0.045, '#0073cf'])] },
  { id: 'hu', name: 'Hungría', ops: [['H', ['#ce2939', W, '#477050']]] },
  { id: 'in', name: 'India', ops: [['H', ['#ff9933', W, '#138808']], ['ring', 0.5, 0.5, 0.11, 0.012, '#000080']] },
  { id: 'ie', name: 'Irlanda', ops: [['V', ['#169b62', W, '#ff883e']]] },
  { id: 'is', name: 'Islandia', ops: [['H', ['#02529c']], ['nordic', '#dc1e35', W]] },
  { id: 'il', name: 'Israel', ops: [['H', [W]], ['rect', 0, 0.09, 1, 0.1, '#0038b8'], ['rect', 0, 0.81, 1, 0.1, '#0038b8'], ['poly', [[0.5, 0.27], [0.58, 0.58], [0.42, 0.58]], '#0038b8'], ['poly', [[0.5, 0.73], [0.58, 0.42], [0.42, 0.42]], '#0038b8'], ['poly', [[0.5, 0.31], [0.55, 0.55], [0.45, 0.55]], W], ['poly', [[0.5, 0.69], [0.55, 0.45], [0.45, 0.45]], W]] },
  { id: 'it', name: 'Italia', ops: [['V', ['#009246', W, '#ce2b37']]] },
  { id: 'jp', name: 'Japón', ops: [['H', [W]], ['circle', 0.5, 0.5, 0.3, '#bc002d']] },
  { id: 'ma', name: 'Marruecos', ops: [['H', ['#c1272d']], ['star', 0.5, 0.5, 0.26, '#006233'], ['star', 0.5, 0.5, 0.17, '#c1272d']] },
  { id: 'mx', name: 'México', ops: [['V', ['#006847', W, '#ce1126']], ['circle', 0.5, 0.5, 0.11, '#a8844a']] },
  { id: 'ni', name: 'Nicaragua', ops: [['H', ['#0067c6', W, '#0067c6']], ['circle', 0.5, 0.5, 0.09, '#d8b33a']] },
  { id: 'ng', name: 'Nigeria', ops: [['V', ['#008751', W, '#008751']]] },
  { id: 'no', name: 'Noruega', ops: [['H', ['#ba0c2f']], ['nordic', '#00205b', W]] },
  { id: 'nz', name: 'Nueva Zelanda', ops: [['H', ['#00247d']], ['jack', 0, 0, 0.5, 0.5], ['star', 0.75, 0.3, 0.065, '#cc142b', 5, 0.4], ['star', 0.62, 0.52, 0.055, '#cc142b', 5, 0.4], ['star', 0.88, 0.52, 0.055, '#cc142b', 5, 0.4], ['star', 0.75, 0.82, 0.07, '#cc142b', 5, 0.4]] },
  { id: 'nl', name: 'Países Bajos', ops: [['H', ['#ae1c28', W, '#21468b']]] },
  { id: 'pa', name: 'Panamá', ops: [['rect', 0, 0, 0.5, 0.5, W], ['rect', 0.5, 0, 0.5, 0.5, '#d21034'], ['rect', 0, 0.5, 0.5, 0.5, '#005293'], ['rect', 0.5, 0.5, 0.5, 0.5, W], ['star', 0.25, 0.25, 0.14, '#005293'], ['star', 0.75, 0.75, 0.14, '#d21034']] },
  { id: 'py', name: 'Paraguay', ops: [['H', ['#d52b1e', W, '#0038a8']], ['ring', 0.5, 0.5, 0.09, 0.012, '#3a7a3a']] },
  { id: 'pe', name: 'Perú', ops: [['V', ['#d91023', W, '#d91023']]] },
  { id: 'pl', name: 'Polonia', ops: [['H', [W, '#dc143c']]] },
  { id: 'pt', name: 'Portugal', ops: [['V', ['#006600', '#ff0000'], [2, 3]], ['circle', 0.4, 0.5, 0.15, '#ffd800'], ['circle', 0.4, 0.5, 0.09, '#c8102e']] },
  { id: 'pr', name: 'Puerto Rico', ops: [['H', ['#ed0000', W, '#ed0000', W, '#ed0000']], ['poly', [[0, 0], [0.43, 0.5], [0, 1]], '#0050f0'], ['star', 0.14, 0.5, 0.1, W]] },
  { id: 'gb', name: 'Reino Unido', ops: [['jack', 0, 0, 1, 1]] },
  { id: 'do', name: 'República Dominicana', ops: [['rect', 0, 0, 0.5, 0.5, '#002d62'], ['rect', 0.5, 0, 0.5, 0.5, '#ce1126'], ['rect', 0, 0.5, 0.5, 0.5, '#ce1126'], ['rect', 0.5, 0.5, 0.5, 0.5, '#002d62'], ['rect', 0, 0.42, 1, 0.16, W], ['rect', 0.44, 0, 0.12, 1, W]] },
  { id: 'ro', name: 'Rumania', ops: [['V', ['#002b7f', '#fcd116', '#ce1126']]] },
  { id: 'ru', name: 'Rusia', ops: [['H', [W, '#0039a6', '#d52b1e']]] },
  { id: 'za', name: 'Sudáfrica', ops: [['H', ['#de3831', '#002395']], ['line', 0, 0, 0.4, 0.5, 0.3, W], ['line', 0, 1, 0.4, 0.5, 0.3, W], ['line', 0.4, 0.5, 1, 0.5, 0.3, W], ['line', 0, 0, 0.4, 0.5, 0.2, '#007749'], ['line', 0, 1, 0.4, 0.5, 0.2, '#007749'], ['line', 0.4, 0.5, 1, 0.5, 0.2, '#007749'], ['poly', [[0, 0.1], [0.32, 0.5], [0, 0.9]], '#ffb612'], ['poly', [[0, 0.2], [0.25, 0.5], [0, 0.8]], K]] },
  { id: 'se', name: 'Suecia', ops: [['H', ['#006aa7']], ['nordic', '#fecc00', null]] },
  { id: 'ch', name: 'Suiza', ops: [['H', ['#da291c']], ['rect', 0.44, 0.2, 0.12, 0.6, W], ['rect', 0.3, 0.44, 0.4, 0.12, W]] },
  { id: 'tr', name: 'Turquía', ops: [['H', ['#e30a17']], ['circle', 0.38, 0.5, 0.22, W], ['circle', 0.43, 0.5, 0.18, '#e30a17'], ['star', 0.56, 0.5, 0.1, W]] },
  { id: 'ua', name: 'Ucrania', ops: [['H', ['#0057b7', '#ffd700']]] },
  { id: 'uy', name: 'Uruguay', ops: [['H', stripes(W, '#0038a8')], ['rect', 0, 0, 0.4, 0.556, W], ['circle', 0.2, 0.278, 0.12, '#fcd116']] },
  { id: 've', name: 'Venezuela', ops: [['H', ['#ffcc00', '#00247d', '#cf142b']], ...Array.from({ length: 8 }, (_, i) => ['star', 0.5 + Math.cos(Math.PI * (1.12 + (i * 0.76) / 7)) * 0.22, 0.52 + Math.sin(Math.PI * (1.12 + (i * 0.76) / 7)) * 0.16 + 0.05, 0.035, W])] },
];

export const FLAG_IDS = new Set(FLAGS.map((f) => f.id));
export const DEFAULT_FLAG = 'tribe';
export const FLAGS_BY_ID = new Map(FLAGS.map((f) => [f.id, f]));

// Orden para la lista: la de la tribu primero y después por nombre.
export const FLAGS_SORTED = [...FLAGS].sort((a, b) => (a.id === DEFAULT_FLAG ? -1 : b.id === DEFAULT_FLAG ? 1 : a.name.localeCompare(b.name, 'es')));

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------

function starPath(ctx, cx, cy, r, points, inner) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function bands(ctx, w, h, colors, weights, vertical) {
  const total = (weights ?? colors.map(() => 1)).reduce((a, b) => a + b, 0);
  let at = 0;
  colors.forEach((color, i) => {
    const size = ((weights?.[i] ?? 1) / total) * (vertical ? w : h);
    ctx.fillStyle = color;
    if (vertical) ctx.fillRect(Math.floor(at), 0, Math.ceil(size) + 1, h);
    else ctx.fillRect(0, Math.floor(at), w, Math.ceil(size) + 1);
    at += size;
  });
}

function jack(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#012169';
  ctx.fillRect(x, y, w, h);
  const line = (x1, y1, x2, y2, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x + x1 * w, y + y1 * h);
    ctx.lineTo(x + x2 * w, y + y2 * h);
    ctx.stroke();
  };
  const t = Math.min(w, h);
  line(0, 0, 1, 1, t * 0.2, W);
  line(0, 1, 1, 0, t * 0.2, W);
  line(0, 0, 1, 1, t * 0.08, '#c8102e');
  line(0, 1, 1, 0, t * 0.08, '#c8102e');
  line(0.5, 0, 0.5, 1, t * 0.34, W);
  line(0, 0.5, 1, 0.5, t * 0.34, W);
  line(0.5, 0, 0.5, 1, t * 0.2, '#c8102e');
  line(0, 0.5, 1, 0.5, t * 0.2, '#c8102e');
  ctx.restore();
}

// Pinta una bandera en un canvas de tamaño w × h (cualquier proporción).
export function drawFlag(ctx, flag, w, h) {
  ctx.save();
  ctx.fillStyle = '#888888';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'butt';
  for (const op of flag.ops) {
    const [kind, ...a] = op;
    switch (kind) {
      case 'H':
        bands(ctx, w, h, a[0], a[1], false);
        break;
      case 'V':
        bands(ctx, w, h, a[0], a[1], true);
        break;
      case 'rect':
        ctx.fillStyle = a[4];
        ctx.fillRect(a[0] * w, a[1] * h, a[2] * w, a[3] * h);
        break;
      case 'poly':
        ctx.fillStyle = a[1];
        ctx.beginPath();
        a[0].forEach(([px, py], i) => (i ? ctx.lineTo(px * w, py * h) : ctx.moveTo(px * w, py * h)));
        ctx.closePath();
        ctx.fill();
        break;
      case 'circle':
        ctx.fillStyle = a[3];
        ctx.beginPath();
        ctx.arc(a[0] * w, a[1] * h, a[2] * h, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'ring':
        ctx.strokeStyle = a[4];
        ctx.lineWidth = a[3] * h;
        ctx.beginPath();
        ctx.arc(a[0] * w, a[1] * h, a[2] * h, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'semi':
        ctx.fillStyle = a[3];
        ctx.beginPath();
        ctx.arc(a[0] * w, a[1] * h, a[2] * h, a[4], a[5], false);
        ctx.closePath();
        ctx.fill();
        break;
      case 'star':
        ctx.fillStyle = a[3];
        starPath(ctx, a[0] * w, a[1] * h, a[2] * h, a[4] ?? 5, a[5] ?? 0.4);
        ctx.fill();
        break;
      case 'line':
        ctx.strokeStyle = a[5];
        ctx.lineWidth = a[4] * h;
        ctx.beginPath();
        ctx.moveTo(a[0] * w, a[1] * h);
        ctx.lineTo(a[2] * w, a[3] * h);
        ctx.stroke();
        break;
      case 'nordic': {
        const cx = a[2] ?? 0.36;
        const draw = (color, grow) => {
          ctx.fillStyle = color;
          ctx.fillRect((cx - 0.075 - grow) * w, 0, (0.15 + grow * 2) * w, h);
          ctx.fillRect(0, (0.5 - 0.075 * 1.5 - grow * 1.5) * h, w, (0.225 + grow * 3) * h);
        };
        if (a[1]) draw(a[1], 0.03);
        draw(a[0], a[1] ? 0 : 0.0);
        break;
      }
      case 'jack':
        jack(ctx, a[0] * w, a[1] * h, a[2] * w, a[3] * h);
        break;
    }
  }
  ctx.restore();
}
