/**
 * feedbackQueries.js — Persistenza dei feedback in PostgreSQL
 *
 * @module backend/src/db/feedbackQueries
 */

import { query } from './pool.js';
import { logger } from '../logger.js';

/**
 * Inserisce un feedback nel database.
 *
 * @param {object} fb
 * @param {string} fb.tipo - 'suggerimento' | 'problema' | 'altro'
 * @param {string|null} [fb.sottocategoria]
 * @param {string} fb.testo
 * @param {string|null} [fb.nome]
 * @returns {Promise<{ok: boolean, errore?: string, id?: number}>}
 */
export async function inserisciFeedback({ tipo, sottocategoria, testo, nome }) {
  try {
    const result = await query(
      `INSERT INTO feedback (tipo, sottocategoria, testo, nome)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [tipo || 'altro', sottocategoria || null, testo, nome || null]
    );
    const id = parseInt(result.rows[0].id, 10);
    logger.info('feedback_salvato', { id, tipo });
    return { ok: true, id };
  } catch (errore) {
    logger.error('feedback_save_failed', { errore: errore.message });
    return { ok: false, errore: 'db_error' };
  }
}
