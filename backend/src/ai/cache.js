/**
 * cache.js — Cache in RAM per risultati validazione AI
 *
 * Mantiene un Map<parola, {valida, timestamp}> con TTL 24h.
 * Limite 10k entries con LRU eviction.
 *
 * Nota: la cache è ridondante con il DB dopo che `inserisciParolaAI`
 * committa. Serve per ridurre chiamate API nella stessa sessione
 * (es. stessa parola inviata 2 volte in rapida successione).
 *
 * @module backend/src/ai/cache
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24 ore
const MAX_ENTRIES = 10_000;

/**
 * Cache singleton.
 * @type {Map<string, {valida: boolean, timestamp: number}>}
 */
const cache = new Map();

/**
 * Recupera un valore dalla cache se presente e non scaduto.
 *
 * @param {string} parola
 * @returns {{valida: boolean, hit: boolean, eta_ms: number}|null}
 */
export function get(parola) {
  const entry = cache.get(parola);
  if (!entry) return null;

  const eta = Date.now() - entry.timestamp;
  if (eta > TTL_MS) {
    cache.delete(parola);
    return null;
  }
  return { valida: entry.valida, hit: true, eta_ms: eta };
}

/**
 * Salva un valore in cache.
 * Se cache piena, rimuove l'entry più vecchia (LRU semplificato).
 *
 * @param {string} parola
 * @param {boolean} valida
 */
export function set(parola, valida) {
  if (cache.size >= MAX_ENTRIES && !cache.has(parola)) {
    // Rimuovi la prima entry (Map mantiene insertion order, la prima è la più vecchia)
    const primaChiave = cache.keys().next().value;
    if (primaChiave) cache.delete(primaChiave);
  }
  cache.set(parola, { valida, timestamp: Date.now() });
}

/**
 * Svuota la cache (per test).
 */
export function clear() {
  cache.clear();
}

/**
 * Ritorna la dimensione corrente della cache.
 * @returns {number}
 */
export function size() {
  return cache.size;
}

/**
 * Statistiche cache (per monitoring).
 * @returns {{size: number, max: number, ttl_ms: number}}
 */
export function stats() {
  return { size: cache.size, max: MAX_ENTRIES, ttl_ms: TTL_MS };
}
