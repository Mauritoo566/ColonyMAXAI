// Matriz de modelos: tipo, nivel, edad, modelo, y avisos (niveles que se parecen demasiado, modelos repetidos entre
// tipos, modelos que sobresalen de su huella). Uso: node tools/audit-models.mjs [--md]   (con --md escribe docs/MODELOS.md)
import fs from 'node:fs';
import { BUILDING_TYPES } from '../src/sim/buildingTypes.js';
import { levelModel } from '../src/buildingModels.js';
import { modelSignature, modelDistance, overhang } from '../src/modelAudit.js';
import { halfOf } from '../src/sim/access.js';

export const MIN_STEP = 0.12; // por debajo, la mejora entre dos niveles seguidos casi no se nota
export const MIN_TYPES = 0.06; // por debajo, dos tipos distintos del mismo estilo se confunden
export const MAX_OVERHANG = 1.3; // metros por lado que un modelo puede sobresalir de las casillas que ocupa

export function auditModels() {
  const rows = [];
  for (const d of BUILDING_TYPES) {
    let prev = null;
    d.levels.forEach((lv, i) => {
      const sig = modelSignature(levelModel(lv.model));
      const row = { id: d.id, level: i + 1, age: lv.age, model: lv.model, sig, half: halfOf(d.footprint), notes: [], flags: new Set() };
      if (prev) {
        row.step = modelDistance(prev.sig, sig);
        if (prev.sig.hash === sig.hash) {
          row.notes.push('IGUAL al nivel anterior');
          row.flags.add('same-level');
        } else if (row.step < MIN_STEP) {
          row.notes.push(`mejora poco visible (${row.step.toFixed(2)})`);
          row.flags.add('subtle');
        }
      }
      const over = overhang(sig, row.half);
      if (over > MAX_OVERHANG) {
        row.notes.push(`sobresale ${over.toFixed(1)} m de su huella`);
        row.flags.add('overhang');
      }
      rows.push(row);
      prev = row;
    });
  }
  // Entre tipos distintos.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].id === rows[j].id) continue;
      if (rows[i].sig.hash === rows[j].sig.hash) {
        rows[j].notes.push(`IGUAL a ${rows[i].id} L${rows[i].level}`);
        rows[j].flags.add('same-type');
      } else if (rows[i].model.split(':')[1] === rows[j].model.split(':')[1] && rows[i].age === rows[j].age && modelDistance(rows[i].sig, rows[j].sig) < MIN_TYPES) {
        rows[j].notes.push(`muy parecido a ${rows[i].id} L${rows[i].level}`);
        rows[j].flags.add('similar-type');
      }
    }
  }
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith('audit-models.mjs')) {
  const rows = auditModels();
  const lines = rows.map((r) => `${r.id.padEnd(20)} L${String(r.level).padEnd(2)} edad ${String(r.age).padEnd(2)} ${r.model.padEnd(36)} ${String(r.sig.verts).padStart(5)} v  ${r.sig.size.map((s) => s.toFixed(1)).join('x').padEnd(14)} huella ${r.half * 2}x${r.half * 2}  ${r.notes.join('; ')}`);
  console.log(lines.join('\n'));
  console.log(`\n${rows.length} modelos, ${rows.filter((r) => r.notes.length).length} con avisos`);
  if (process.argv.includes('--md')) {
    const md = [
      '# Matriz de modelos',
      '',
      'Generada con `node tools/audit-models.mjs --md`. Una fila por tipo y nivel: la edad en que se desbloquea, el modelo que lo dibuja, su tamaño visible frente a las casillas que ocupa (huella lógica) y los avisos de la auditoría (niveles que repiten modelo, mejoras casi imperceptibles, tipos que se confunden, modelos que sobresalen de su huella).',
      '',
      '| Tipo | Nivel | Edad | Modelo | Vértices | Tamaño (m) | Huella (m) | Avisos |',
      '|---|---|---|---|---|---|---|---|',
    ];
    for (const r of rows) md.push(`| ${r.id} | ${r.level} | ${r.age} | \`${r.model}\` | ${r.sig.verts} | ${r.sig.size.map((s) => s.toFixed(1)).join('×')} | ${r.half * 2}×${r.half * 2} | ${r.notes.join('; ') || '—'} |`);
    fs.writeFileSync(new URL('../docs/MODELOS.md', import.meta.url), md.join('\n') + '\n');
  }
}
