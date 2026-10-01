// Genera docs/PRIMITIVA.md: la tabla de auditoría de la Edad Primitiva (sale de src/sim/primitiveAudit.js).
// Uso: node tools/gen-primitive-doc.mjs
import { writeFileSync } from 'node:fs';
import { AUDIT } from '../src/sim/primitiveAudit.js';

const esc = (t) => String(t).replace(/\|/g, '/');
const rows = AUDIT.map((r) => `| ${esc(r.step)} | ${esc(r.action)} | ${esc(r.needs)} | ${esc(r.origin)} | ${esc(r.requires)} | ${esc(r.result)} | ${esc(r.explain)} |`);
writeFileSync(new URL('../docs/PRIMITIVA.md', import.meta.url), `# Edad Primitiva: auditoría del recorrido

Generado desde \`src/sim/primitiveAudit.js\`. Cada fila se comprueba contra el juego real en
\`server/game/test/primitive.test.js\` (no es sólo documentación).

| Paso | Acción | Recursos necesarios | Origen | Edificio o capacidad requerida | Resultado | Si falta algo |
|---|---|---|---|---|---|---|
${rows.join('\n')}

## Reglas que cumple

- Población máxima de la edad: 10 (no concede plazas de refugio). Crece sólo por nacimientos; sin inmigración.
- Refugio inicial: choza de ramas (2 plazas). Sin plaza, se duerme junto a la fogata y se descansa peor.
- El agua sale del recolector de lluvia: no hace falta un río.
- Sin lluvia pueden bajar las reservas; la escasez puede matar (con el dueño presente). Las ausencias no cambian.
- Todos los requisitos de Piedra se cumplen con recursos de Primitiva.
`);
console.log('docs/PRIMITIVA.md generado');
