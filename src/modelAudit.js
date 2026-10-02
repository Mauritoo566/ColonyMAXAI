// Auditoría de modelos: firma de cada modelo y distancia visual entre dos, para detectar mejoras imperceptibles,
// niveles que repiten modelo y tipos que se parecen demasiado. La usan tools/audit-models.mjs y la prueba de modelos.
// Es puro (sólo mira la geometría ya armada), así que corre igual en Node que en el navegador.

const GRID = 6;

export function modelSignature(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const col = g.attributes.color;
  g.computeBoundingBox();
  const b = g.boundingBox;
  const size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
  const colors = new Map();
  const cells = new Float32Array(GRID * GRID * GRID);
  const n = pos.count;
  for (let i = 0; i < n; i++) {
    if (col) {
      const key = ((col.getX(i) * 15.99) | 0) * 256 + ((col.getY(i) * 15.99) | 0) * 16 + ((col.getZ(i) * 15.99) | 0);
      colors.set(key, (colors.get(key) ?? 0) + 1);
    }
    const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((pos.getX(i) - b.min.x) / (size[0] || 1)) * GRID)));
    const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((pos.getY(i) - b.min.y) / (size[1] || 1)) * GRID)));
    const gz = Math.min(GRID - 1, Math.max(0, Math.floor(((pos.getZ(i) - b.min.z) / (size[2] || 1)) * GRID)));
    cells[(gx * GRID + gy) * GRID + gz]++;
  }
  for (const [k, v] of colors) colors.set(k, v / n);
  for (let i = 0; i < cells.length; i++) cells[i] /= n;
  let hash = 0;
  for (let i = 0; i < n; i += 3) hash = (hash * 31 + Math.round(pos.getX(i) * 50) * 7 + Math.round(pos.getY(i) * 50) * 13 + Math.round(pos.getZ(i) * 50) * 17) | 0;
  return { hash: (hash >>> 0).toString(16), verts: n, size, colors, cells };
}

// Qué tan distintos se ven dos modelos: 0 = iguales, 1 = nada que ver. Mezcla colores, reparto de la masa
// en el espacio, tamaño y cantidad de detalle.
export function modelDistance(a, b) {
  let colorDiff = 0;
  const keys = new Set([...a.colors.keys(), ...b.colors.keys()]);
  for (const k of keys) colorDiff += Math.abs((a.colors.get(k) ?? 0) - (b.colors.get(k) ?? 0));
  let shapeDiff = 0;
  for (let i = 0; i < a.cells.length; i++) shapeDiff += Math.abs(a.cells[i] - b.cells[i]);
  const sizeDiff = a.size.reduce((acc, s, i) => acc + Math.abs(s - b.size[i]) / Math.max(s, b.size[i], 1), 0) / 3;
  const detailDiff = Math.abs(a.verts - b.verts) / Math.max(a.verts, b.verts, 1);
  return 0.35 * (colorDiff / 2) + 0.35 * (shapeDiff / 2) + 0.15 * sizeDiff + 0.15 * detailDiff;
}

// Cuánto sobresale el modelo de las casillas que ocupa (en metros, por lado). half = mitad del lado de la huella.
export function overhang(sig, half) {
  const wx = sig.size[0];
  const wz = sig.size[2];
  return Math.max(0, wx / 2 - half, wz / 2 - half);
}
