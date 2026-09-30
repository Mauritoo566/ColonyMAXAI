// Genética de los colonos. Cada gen tiene dos alelos (uno de cada progenitor) con un
// valor de 0 a 1; el valor que se expresa es la media de los dos. Así un hijo puede
// heredar un alelo de cada padre (con alguna mutación) y parecerse a ambos.
// Los genes deciden el aspecto (piel, pelo, estatura) y el cuerpo (metabolismo,
// resistencia al frío, constitución, energía, agilidad, longevidad).

export const GENES = [
  { id: 'skin', name: 'Pigmentación', desc: 'Color de la piel.', low: 'Clara', high: 'Oscura' },
  { id: 'hair', name: 'Color de pelo', desc: 'Del negro al rubio.', low: 'Oscuro', high: 'Claro' },
  { id: 'height', name: 'Estatura', desc: 'Altura del cuerpo.', low: 'Baja', high: 'Alta' },
  { id: 'metabolism', name: 'Metabolismo', desc: 'Si es alto necesita comer y beber más seguido.', low: 'Lento', high: 'Rápido' },
  { id: 'cold', name: 'Resistencia al frío', desc: 'Si es alta soporta mejor el frío.', low: 'Baja', high: 'Alta' },
  { id: 'vigor', name: 'Constitución', desc: 'Si es alta su salud aguanta más y se recupera antes.', low: 'Frágil', high: 'Robusta' },
  { id: 'stamina', name: 'Energía', desc: 'Si es alta tarda más en cansarse.', low: 'Baja', high: 'Alta' },
  { id: 'agility', name: 'Agilidad', desc: 'Si es alta camina más rápido.', low: 'Baja', high: 'Alta' },
  { id: 'longevity', name: 'Longevidad', desc: 'Si es alta vivirá más años.', low: 'Baja', high: 'Alta' },
];

// Alelo al azar, más frecuente cerca del medio (media de dos números al azar).
function randomAllele(rand) {
  return (rand() + rand()) / 2;
}

export function createGenome(rand) {
  const genome = {};
  for (const g of GENES) genome[g.id] = [randomAllele(rand), randomAllele(rand)];
  return genome;
}

// Hijo de dos genomas: un alelo de cada uno y, a veces, una pequeña mutación.
export function inheritGenome(mother, father, rand, mutationChance = 0.06) {
  const child = {};
  for (const g of GENES) {
    const alleles = [mother[g.id][rand() < 0.5 ? 0 : 1], father[g.id][rand() < 0.5 ? 0 : 1]];
    for (let k = 0; k < 2; k++) {
      if (rand() < mutationChance) alleles[k] = Math.min(1, Math.max(0, alleles[k] + (rand() - 0.5) * 0.3));
    }
    child[g.id] = alleles;
  }
  return child;
}

export function gene(genome, id) {
  const [a, b] = genome[id];
  return (a + b) / 2;
}

export function geneLevel(value) {
  if (value < 0.35) return 'low';
  if (value > 0.65) return 'high';
  return 'mid';
}

// Código genético legible: cada alelo se escribe con dos bases (A, C, G, T).
const BASES = 'ACGT';
export function genomeCode(genome) {
  return GENES.map((g) =>
    genome[g.id]
      .map((a) => {
        const q = Math.min(15, Math.floor(a * 16));
        return BASES[q >> 2] + BASES[q & 3];
      })
      .join(''),
  ).join('·');
}

// ---------------------------------------------------------------------------
// Aspecto a partir de los genes
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(stops, t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const SKIN_STOPS = ['#f3d2b3', '#e2b08a', '#c68863', '#9a6242', '#6a4028', '#4a2c1c'];
const HAIR_STOPS = ['#15110e', '#3a2618', '#6a4424', '#9a6a36', '#c89a52', '#e2c983'];

export function appearanceFromGenes(genome, age) {
  let hair = mix(HAIR_STOPS, gene(genome, 'hair'));
  // Canas con la edad.
  if (age > 45) {
    const grey = Math.min(1, (age - 45) / 25);
    const [r, g, b] = hexToRgb(hair);
    const t = grey * 0.8;
    hair = `#${[r, g, b].map((v) => Math.round(v + (170 - v) * t).toString(16).padStart(2, '0')).join('')}`;
  }
  return {
    skin: mix(SKIN_STOPS, gene(genome, 'skin')),
    hair,
    height: 0.98 + gene(genome, 'height') * 0.26,
  };
}

// Esperanza de vida en años según la longevidad.
export function lifeExpectancy(genome) {
  return Math.round(55 + gene(genome, 'longevity') * 30);
}
