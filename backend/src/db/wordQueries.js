/**
 * wordQueries.js — Query helper per la tabella `words`
 *
 * Espone funzioni per:
 * - Verificare se una parola esiste (per Validator)
 * - Scegliere N parole random di una data lunghezza (per WordPicker)
 * - Inserire una parola validata da AI (source='AI')
 * - Statistiche veloci
 *
 * Usa il pool singleton da `db/pool.js`.
 *
 * @module backend/src/db/wordQueries
 */

import { query } from './pool.js';
import { logger } from '../logger.js';

/**
 * Verifica se una parola esiste nel dizionario.
 *
 * @param {string} parola - parola (già normalizzata lowercase)
 * @returns {Promise<boolean>} true se presente
 */
export async function parolaEsistente(parola) {
  if (!parola || typeof parola !== 'string') return false;
  const result = await query(
    'SELECT 1 FROM words WHERE word = $1 LIMIT 1',
    [parola]
  );
  return result.rowCount > 0;
}

/**
 * Verifica se una parola esiste e ritorna anche la source.
 * Utile per il Validator per capire se deve fare fallback AI (M3).
 *
 * @param {string} parola - parola (già normalizzata)
 * @returns {Promise<{esiste: boolean, source: string|null}>}
 */
export async function parolaEsistenteConSource(parola) {
  if (!parola || typeof parola !== 'string') {
    return { esiste: false, source: null };
  }
  const result = await query(
    'SELECT source FROM words WHERE word = $1 LIMIT 1',
    [parola]
  );
  if (result.rowCount === 0) {
    return { esiste: false, source: null };
  }
  return { esiste: true, source: result.rows[0].source };
}

/**
 * Verifica quali tra un elenco di parole esistono nel dizionario.
 * Ritorna un Set con le parole trovate (utile per il fallback morfologico).
 *
 * @param {string[]} parole - parole normalizzate (lowercase)
 * @returns {Promise<Set<string>>}
 */
export async function paroleEsistenti(parole) {
  if (!Array.isArray(parole) || parole.length === 0) return new Set();
  const result = await query(
    'SELECT word FROM words WHERE word = ANY($1)',
    [parole]
  );
  return new Set(result.rows.map((r) => r.word));
}

/**
 * Inserisce una parola validata dall'AI nel dizionario (source='AI').
 * Usa ON CONFLICT DO NOTHING per evitare race condition con altri worker.
 *
 * @param {string} parola - parola normalizzata (lowercase, 3-10 lettere)
 * @returns {Promise<{inserita: boolean, gia_esistente: boolean}>}
 */
export async function inserisciParolaAI(parola) {
  if (!parola || typeof parola !== 'string') {
    return { inserita: false, gia_esistente: false };
  }
  try {
    const result = await query(
      `INSERT INTO words (word, length, source)
       VALUES ($1, $2, 'AI')
       ON CONFLICT (word) DO NOTHING
       RETURNING word`,
      [parola, parola.length]
    );
    const inserita = result.rowCount > 0;
    if (inserita) {
      logger.info('parola_ai_inserita', { lunghezza: parola.length });
    }
    return { inserita, gia_esistente: !inserita };
  } catch (errore) {
    logger.error('inserisci_parola_ai_failed', { errore: errore.message });
    return { inserita: false, gia_esistente: false };
  }
}

/**
 * Sceglie N parole casuali di una data lunghezza dal dizionario.
 *
 * Strategia: usa `ORDER BY random() LIMIT n` (semplice).
 * Per grandi N (es. > 100) si potrebbe ottimizzare con TABLESAMPLE, ma
 * per il gioco (N=1) è più che sufficiente.
 *
 * @param {number} lunghezza - lunghezza esatta delle parole
 * @param {number} n - quante parole ritornare (default 1)
 * @returns {Promise<string[]>} array di parole (può essere < n se DB scarso)
 */
export async function paroleCasuali(lunghezza, n = 1) {
  if (lunghezza < 1 || n < 1) return [];
  const result = await query(
    'SELECT word FROM words WHERE length = $1 ORDER BY random() LIMIT $2',
    [lunghezza, n]
  );
  return result.rows.map((r) => r.word);
}

/**
 * Conteggio totale parole (per statistiche).
 *
 * @returns {Promise<number>}
 */
export async function conteggioTotale() {
  const result = await query('SELECT COUNT(*) AS totale FROM words');
  return parseInt(result.rows[0].totale, 10);
}

/**
 * Conteggio parole per una data lunghezza.
 *
 * @param {number} lunghezza
 * @returns {Promise<number>}
 */
export async function conteggioPerLunghezza(lunghezza) {
  const result = await query(
    'SELECT COUNT(*) AS totale FROM words WHERE length = $1',
    [lunghezza]
  );
  return parseInt(result.rows[0].totale, 10);
}

/**
 * Conteggio parole per source (DB / AI).
 * Per monitoraggio quanto il DB si sta "auto-arricchendo".
 *
 * @returns {Promise<{DB: number, AI: number, totale: number}>}
 */
export async function conteggioPerSource() {
  const result = await query(
    `SELECT source, COUNT(*) AS n FROM words GROUP BY source`
  );
  const stats = { DB: 0, AI: 0, totale: 0 };
  for (const r of result.rows) {
    const n = parseInt(r.n, 10);
    if (r.source === 'DB' || r.source === 'AI') {
      stats[r.source] = n;
      stats.totale += n;
    }
  }
  return stats;
}

/**
 * Health check del DB: esegue SELECT 1.
 * Usato dall'endpoint /health.
 *
 * @returns {Promise<{ok: boolean, errore: string|null}>}
 */
export async function healthCheck() {
  try {
    await query('SELECT 1');
    return { ok: true, errore: null };
  } catch (errore) {
    logger.error('health_check_db_failed', { errore: errore.message });
    return { ok: false, errore: errore.message };
  }
}
