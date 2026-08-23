/**
 * morfologia.js — Normalizzazione morfologica di forme flesse italiane
 *
 * Usato dal Validator come Fase 2 (fallback dopo la ricerca nel dizionario):
 * una parola che non esiste nel DB può essere una forma flessa (femminile,
 * plurale, participio, ecc.) di un lemma presente. Data una parola, genera i
 * candidati "base/lemma" da verificare nel DB.
 *
 * Regole implementate (solo forme REGOLARI, per restare conservativi):
 * - Genere/numero di sostantivi e aggettivi:
 *     -a (femm. sing.) ↔ -o (masc. sing.), -i (plur.) ↔ -o/-e/-a, -e → -a
 * - Participi passati:
 *     -ato/-ata/-ati/-ate → infinito -are
 *     -uto/-uta/-uti/-ute → infinito -ere
 *     -ito/-ita/-iti/-ite → infinito -ire (approssimazione)
 * - Gerundi: -ando → -are, -endo → -ere
 *
 * L'accettazione resta "gated": un candidato è valido SOLO se il lemma
 * derivato esiste davvero nel dizionario (verifica in Validator/DB).
 *
 * @module backend/src/utils/morfologia
 */

/**
 * Genera i candidati base/lemma per una parola data (forme flesse regolari).
 *
 * @param {string} parola - parola normalizzata (lowercase)
 * @returns {string[]} lista di candidati (vuota se nessuna regola applicabile)
 */
export function candidatiFormeBase(parola) {
  const candidati = new Set();
  if (typeof parola !== 'string') return [];
  const w = parola.toLowerCase().trim();
  if (w.length <= 2) return [];

  const ultima = w[w.length - 1];
  const radice = w.slice(0, -1);

  // 1) Genere/numero
  if (ultima === 'a') {
    candidati.add(radice + 'o'); // femminile singolare → maschile singolare
    candidati.add(radice + 'e'); // femminile plurale
  } else if (ultima === 'i') {
    candidati.add(radice + 'o'); // maschile plurale → singolare
    candidati.add(radice + 'e'); // femminile plurale → femminile singolare
    candidati.add(radice + 'a');
  } else if (ultima === 'e') {
    candidati.add(radice + 'a'); // femminile plurale (-e) → singolare (-a)
  }

  // 2) Participi / gerundi → infinito del verbo
  const infinito = infinitoDaVerbo(w);
  if (infinito) candidati.add(infinito);

  // Rimuovi la parola stessa (no-op)
  candidati.delete(w);
  return [...candidati];
}

/**
 * Deriva l'infinito di un verbo da una forma flessa (participio o gerundio).
 *
 * @param {string} w - parola normalizzata
 * @returns {string|null} infinito candidato, o null se non riconosciuta
 */
function infinitoDaVerbo(w) {
  const regole = [
    ['ato', 'are'], ['ata', 'are'], ['ati', 'are'], ['ate', 'are'],
    ['uto', 'ere'], ['uta', 'ere'], ['uti', 'ere'], ['ute', 'ere'],
    ['ito', 'ire'], ['ita', 'ire'], ['iti', 'ire'], ['ite', 'ire'],
  ];
  for (const [suffPartic, suffInf] of regole) {
    if (w.length > suffPartic.length && w.endsWith(suffPartic)) {
      return w.slice(0, -suffPartic.length) + suffInf;
    }
  }
  if (w.length > 4 && w.endsWith('ando')) return w.slice(0, -4) + 'are';
  if (w.length > 4 && w.endsWith('endo')) return w.slice(0, -4) + 'ere';
  return null;
}
