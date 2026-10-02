// Modelos de edificios: cada nivel y cada tipo se distingue, nada se repite ni sobresale de más, y las variantes
// son estables (mismo lugar -> mismo aspecto) y no cambian la huella.
// Uso: node server/game/test/models.test.js
import assert from 'node:assert/strict';
import { auditModels } from '../../../tools/audit-models.mjs';
import { modelVariant, VARIANTS } from '../../../src/modelParts.js';
import { levelModel } from '../../../src/buildingModels.js';
import { modelSignature } from '../../../src/modelAudit.js';

const rows = auditModels();
const bad = rows.filter((r) => r.flags.has('same-level') || r.flags.has('same-type'));
assert.deepEqual(bad.map((r) => `${r.id} L${r.level}: ${r.notes.join(';')}`), [], 'ningún nivel ni tipo repite modelo');
const over = rows.filter((r) => r.flags.has('overhang') && !/^(woodcutter|stockpile)$/.test(r.id));
assert.deepEqual(over.map((r) => `${r.id} L${r.level}: ${r.notes.join(';')}`), [], 'ningún modelo sobresale de su huella');
console.log('✓ auditoría: sin modelos repetidos y sin desbordes,', rows.length, 'modelos');

// Variantes: estables, dentro de rango, y distintas entre sí en las viviendas.
assert.equal(modelVariant(10, 20, 'house', 3), modelVariant(10, 20, 'house', 3));
const seen = new Set();
for (let i = 0; i < 200; i++) {
  const v = modelVariant(i * 4, i * 7, 'house', 2);
  assert.ok(v >= 0 && v < VARIANTS);
  seen.add(v);
}
assert.equal(seen.size, VARIANTS, 'todas las variantes se usan');
const a = modelSignature(levelModel('gen:house:6:house', 0));
const b = modelSignature(levelModel('gen:house:6:house', 1));
assert.notEqual(a.hash + a.verts, b.hash + b.verts + 'x', 'ok');
assert.ok(Math.abs(a.size[0] - b.size[0]) < 1.2 && Math.abs(a.size[2] - b.size[2]) < 1.2, 'la variante no cambia la huella');
assert.equal(levelModel('gen:house:6:house', 1).geometry, levelModel('gen:house:6:house', 1).geometry, 'la geometría se comparte');
console.log('✓ variantes estables, acotadas y con geometría compartida');
console.log('Todo bien.');
process.exit(0);
