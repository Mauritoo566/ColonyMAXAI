// Nombre de la aldea: lo comparten el servidor (que lo valida y guarda) y el navegador (que lo muestra y lo manda).
// Nombre de aldea: texto corto y sin nada raro (nunca HTML ni caracteres de control). Vacío = sin nombre propio.
export const VILLAGE_NAME_MAX = 28;
export function cleanVillageName(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>&"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, VILLAGE_NAME_MAX)
    .trim();
}
