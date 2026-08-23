/**
 * levenshtein.js — Wrapper per distanza edit (Levenshtein)
 *
 * Espone una funzione `distanzaEdit(a, b)` che ritorna il numero minimo
 * di operazioni (inserimento, cancellazione, sostituzione) per trasformare
 * `a` in `b`. Usata dal Validator per verificare che la nuova parola sia
 * a distanza 1 dalla parola precedente.
 *
 * @module backend/src/utils/levenshtein
 */

import levenshtein from 'levenshtein';

/**
 * Calcola la distanza di Levenshtein tra due stringhe.
 *
 * Caso speciale: se le stringhe sono identiche, ritorna 0.
 * Se hanno lunghezza molto diversa, ritorna direttamente la differenza
 * (ottimizzazione: non c'è modo di trasformare una nell'altra in meno operazioni).
 *
 * @param {string} a - prima stringa
 * @param {string} b - seconda stringa
 * @returns {number} distanza (>= 0)
 */
export function distanzaEdit(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  return levenshtein(a, b);
}

/**
 * Verifica se due stringhe sono a distanza esattamente 1.
 * Usata dal Validator per la regola del gioco.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean} true se differiscono per esattamente 1 operazione
 */
export function isDistanzaUno(a, b) {
  return distanzaEdit(a, b) === 1;
}
