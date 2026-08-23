/**
 * WordPicker.js — Sceglie la parola iniziale di una partita
 *
 * Seleziona una parola casuale dal dizionario, di lunghezza random
 * tra [min, max] (configurabile, default 5-8).
 *
 * @module backend/src/game/WordPicker
 */

import { paroleCasuali, conteggioPerLunghezza } from '../db/wordQueries.js';
import { logger } from '../logger.js';

/**
 * Sceglie una parola iniziale random per la partita.
 *
 * Strategia:
 * 1. Sceglie una lunghezza random in [min, max] pesata per la quantità
 *    di parole disponibili (evita lunghezze vuote)
 * 2. Sceglie una parola random di quella lunghezza
 * 3. Se non trova (raro), ritenta fino a 5 volte
 * 4. Se ancora nulla, eccezione
 *
 * @param {number} min - lunghezza minima (inclusa)
 * @param {number} max - lunghezza massima (inclusa)
 * @returns {Promise<string>} parola scelta
 * @throws {Error} se non riesce a scegliere una parola
 */
export async function scegliParolaIniziale(min, max) {
  if (min > max) {
    throw new Error(`WordPicker: min (${min}) > max (${max})`);
  }

  // 1. Calcola quante parole ci sono per ogni lunghezza
  const conteggi = [];
  for (let l = min; l <= max; l++) {
    const c = await conteggioPerLunghezza(l);
    conteggi.push({ lunghezza: l, count: c });
  }

  const totale = conteggi.reduce((s, x) => s + x.count, 0);
  if (totale === 0) {
    throw new Error(`WordPicker: nessuna parola disponibile tra ${min} e ${max} lettere`);
  }

  // 2. Sceglie lunghezza pesata per la disponibilità
  let pick = Math.random() * totale;
  let lunghezzaScelta = conteggi[0].lunghezza;
  for (const c of conteggi) {
    pick -= c.count;
    if (pick <= 0) {
      lunghezzaScelta = c.lunghezza;
      break;
    }
  }

  // 3. Sceglie una parola di quella lunghezza
  for (let tentativo = 0; tentativo < 5; tentativo++) {
    const parole = await paroleCasuali(lunghezzaScelta, 1);
    if (parole.length > 0) {
      logger.info('parola_iniziale_scelta', { parola: parole[0], lunghezza: lunghezzaScelta });
      return parole[0];
    }
  }

  throw new Error(`WordPicker: impossibile scegliere parola dopo 5 tentativi (lunghezza=${lunghezzaScelta})`);
}
