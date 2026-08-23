/**
 * pool.js — Pool di connessioni PostgreSQL
 *
 * Espone un'istanza singleton di `pg.Pool` configurata per il gioco.
 * Limite di connessioni e timeout gestiti via config.
 *
 * Uso:
 *   import { pool, query, withTransaction } from './db/pool.js';
 *   const result = await query('SELECT * FROM words WHERE length = $1', [5]);
 *
 * @module backend/src/db/pool
 */

import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

/**
 * Singleton pool di connessioni PostgreSQL.
 * Viene inizializzato lazy al primo accesso.
 */
export const pool = new Pool({
  connectionString: config.database.url,
  max: config.database.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Log eventi pool
pool.on('connect', () => {
  // Non loggare troppo spesso
});

pool.on('error', (err) => {
  console.error('[db] ❌ Errore inatteso sul pool:', err.message);
});

/**
 * Helper per query singola con parametri.
 * @param {string} text - SQL con placeholder $1, $2, ...
 * @param {any[]} params - parametri
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(text, params) {
  const inizio = Date.now();
  const result = await pool.query(text, params);
  const durata = Date.now() - inizio;
  if (durata > 500) {
    console.warn(`[db] ⚠️  Query lenta (${durata}ms): ${text.substring(0, 100)}`);
  }
  return result;
}

/**
 * Esegue una callback dentro una transazione.
 * Fa rollback automatico in caso di errore, COMMIT se tutto OK.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (errore) {
    await client.query('ROLLBACK');
    throw errore;
  } finally {
    client.release();
  }
}

/**
 * Chiude il pool (per shutdown graceful).
 * @returns {Promise<void>}
 */
export async function closePool() {
  await pool.end();
  console.log('[db] Pool chiuso.');
}
