// Rectángulos girados en el suelo (coordenadas del campamento, metros):
// { cx, cz, hw, hd, angle } — centro, medio ancho, medio largo y giro. Se dibujan
// alineados con la vista de la cámara, así que pueden tener cualquier ángulo.

// Punto del campamento -> coordenadas del rectángulo (u a lo ancho, v a lo largo).
export function toRect(rect, x, z) {
  const dx = x - rect.cx;
  const dz = z - rect.cz;
  const c = Math.cos(rect.angle);
  const s = Math.sin(rect.angle);
  return { u: dx * c + dz * s, v: -dx * s + dz * c };
}

// Coordenadas del rectángulo -> punto del campamento.
export function fromRect(rect, u, v) {
  const c = Math.cos(rect.angle);
  const s = Math.sin(rect.angle);
  return { x: rect.cx + u * c - v * s, z: rect.cz + u * s + v * c };
}

export function insideRect(rect, x, z) {
  const { u, v } = toRect(rect, x, z);
  return Math.abs(u) <= rect.hw && Math.abs(v) <= rect.hd;
}

// Distancia de un punto al rectángulo (0 si está dentro).
export function rectDistance(rect, x, z) {
  const { u, v } = toRect(rect, x, z);
  return Math.hypot(Math.max(0, Math.abs(u) - rect.hw), Math.max(0, Math.abs(v) - rect.hd));
}

// Rectángulo entre dos esquinas opuestas, con los lados girados "angle".
export function rectFromCorners(ax, az, bx, bz, angle) {
  const base = { cx: (ax + bx) / 2, cz: (az + bz) / 2, hw: 0, hd: 0, angle };
  const { u, v } = toRect(base, bx, bz);
  return { ...base, hw: Math.abs(u), hd: Math.abs(v) };
}

// Zonas guardadas con formatos anteriores (círculo o rectángulo sin giro).
export function upgradeRect(r) {
  if (!r) return null;
  if (Number.isFinite(r.hw)) return r;
  if (Number.isFinite(r.r)) return { cx: r.x, cz: r.z, hw: r.r, hd: r.r, angle: 0 };
  if (Number.isFinite(r.x0)) return { cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, hw: Math.abs(r.x1 - r.x0) / 2, hd: Math.abs(r.z1 - r.z0) / 2, angle: 0 };
  return null;
}
