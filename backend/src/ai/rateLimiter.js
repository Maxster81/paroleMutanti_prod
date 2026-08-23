/**
 * rateLimiter.js — Rate limit per chiamate AI (DeepSeek)
 *
 * Limite: 10 chiamate/min per partita (configurabile).
 * Sliding window in RAM. Se esaurito → fallback "rifiuta senza AI".
 *
 * @module backend/src/ai/rateLimiter
 */

import { config } from '../config.js';

/**
 * Rate limiter per gameId.
 * @type {Map<string, number[]>}
 */
const timestamps = new Map();

/**
 * Controlla se la partita può fare un'altra chiamata AI.
 *
 * @param {string} gameId
 * @returns {boolean} true se consentito
 */
export function check(gameId) {
  const adesso = Date.now();
  const windowMs = 60_000; // 1 minuto
  const max = config.deepseek.rateLimitPerMin;

  const ts = timestamps.get(gameId) ?? [];
  const tsValidi = ts.filter((t) => adesso - t < windowMs);

  if (tsValidi.length >= max) {
    timestamps.set(gameId, tsValidi);
    return false;
  }

  tsValidi.push(adesso);
  timestamps.set(gameId, tsValidi);
  return true;
}

/**
 * Ritorna il numero di chiamate AI rimanenti per una partita nella finestra corrente.
 *
 * @param {string} gameId
 * @returns {number}
 */
export function rimanenti(gameId) {
  const adesso = Date.now();
  const windowMs = 60_000;
  const max = config.deepseek.rateLimitPerMin;

  const ts = timestamps.get(gameId) ?? [];
  const tsValidi = ts.filter((t) => adesso - t < windowMs);
  return Math.max(0, max - tsValidi.length);
}

/**
 * Resetta il counter di una partita.
 * @param {string} gameId
 */
export function reset(gameId) {
  timestamps.delete(gameId);
}

/**
 * Cleanup periodico (rimuove entries scadute).
 * Da chiamare periodicamente (es. ogni 5 minuti).
 */
export function cleanup() {
  const adesso = Date.now();
  const windowMs = 60_000;
  for (const [gameId, ts] of timestamps.entries()) {
    const tsValidi = ts.filter((t) => adesso - t < windowMs);
    if (tsValidi.length === 0) {
      timestamps.delete(gameId);
    } else if (tsValidi.length !== ts.length) {
      timestamps.set(gameId, tsValidi);
    }
  }
}

// Cleanup automatico ogni 5 minuti
setInterval(cleanup, 5 * 60 * 1000).unref();
