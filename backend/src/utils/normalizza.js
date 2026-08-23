/**
 * normalizza.js — Funzioni di normalizzazione e validazione stringhe/parole
 *
 * Usato dal Validator per preparare la parola prima della validazione.
 * - lowercase + trim
 * - charset italiano (lettere a-z, accentate, apostrofo) + prestiti consolidati (j, k, w, x, y)
 * - lunghezza entro range
 *
 * @module backend/src/utils/normalizza
 */

/**
 * Espressione regolare per lettere italiane + prestiti consolidati.
 * Include: a-z, àèéìòù (accenti), apostrofo, jkwxy (parole straniere ormai
 * di uso comune in italiano: wifi, weekend, jazz, kiwi, yogurt, ecc.)
 */
const RE_CHARSET_ITALIANO = /^[a-zàèéìòùjkwxy]+$/;

/**
 * Espressione regolare per lettere italiane con apostrofo opzionale.
 */
const RE_CHARSET_CON_APOSTROFO = /^[a-zàèéìòùjkwxy']+$/;

/**
 * Normalizza una stringa di input: lowercase, trim, no caratteri strani.
 *
 * @param {string} input - input utente grezzo
 * @returns {string} input normalizzato
 */
export function normalizzaBase(input) {
  if (typeof input !== 'string') return '';
  return input.toLowerCase().trim();
}

/**
 * Verifica se una parola è valida per il gioco:
 * - Solo lettere italiane (a-z + accenti + prestiti j, k, w, x, y) o lettere + apostrofo
 * - Lunghezza entro [min, max]
 *
 * Ritorna un oggetto con:
 *   - valida: boolean
 *   - motivo: string|null (motivo di rifiuto, null se valida)
 *   - normalizzata: string (versione normalizzata)
 *
 * @param {string} input - parola da validare
 * @param {number} min - lunghezza minima (inclusa)
 * @param {number} max - lunghezza massima (inclusa)
 * @returns {{valida: boolean, motivo: string|null, normalizzata: string}}
 */
export function validaParola(input, min, max) {
  const normalizzata = normalizzaBase(input);

  if (!normalizzata) {
    return { valida: false, motivo: 'parola_vuota', normalizzata: '' };
  }

  if (normalizzata.length < min) {
    return { valida: false, motivo: 'troppo_corta', normalizzata };
  }

  if (normalizzata.length > max) {
    return { valida: false, motivo: 'troppo_lunga', normalizzata };
  }

  if (!RE_CHARSET_ITALIANO.test(normalizzata) && !RE_CHARSET_CON_APOSTROFO.test(normalizzata)) {
    return { valida: false, motivo: 'caratteri_non_validi', normalizzata };
  }

  return { valida: true, motivo: null, normalizzata };
}
