/**
 * rateLimiter.js — Rate limiter per-evento basato su sliding window
 *
 * Mantiene in memoria un array di timestamp per ogni "soggetto" (es. socket.id).
 * Se il numero di eventi in [now - windowMs] supera `max`, l'evento è rifiutato.
 *
 * Niente dipendenze esterne. La memoria cresce linearmente con il numero di
 * soggetti attivi, ma si auto-pulisce (cleanup periodico).
 *
 * @module backend/src/utils/rateLimiter
 */

/**
 * Crea un nuovo rate limiter.
 *
 * @param {object} [opzioni]
 * @param {number} [opzioni.max=5] - max eventi consentiti nella finestra
 * @param {number} [opzioni.windowMs=1000] - dimensione finestra in ms
 * @param {number} [opzioni.cleanupIntervalMs=60000] - intervallo cleanup automatico
 * @returns {{
 *   check: (soggetto: string) => boolean,
 *   reset: (soggetto: string) => void,
 *   size: () => number,
 *   destroy: () => void
 * }}
 */
export function creaRateLimiter(opzioni = {}) {
  const max = opzioni.max ?? 5;
  const windowMs = opzioni.windowMs ?? 1000;
  const cleanupIntervalMs = opzioni.cleanupIntervalMs ?? 60_000;

  /** @type {Map<string, number[]>} */
  const timestamps = new Map();

  // Cleanup automatico per evitare memory leak
  const interval = setInterval(() => {
    const adesso = Date.now();
    for (const [soggetto, ts] of timestamps.entries()) {
      const tsValidi = ts.filter((t) => adesso - t < windowMs);
      if (tsValidi.length === 0) {
        timestamps.delete(soggetto);
      } else if (tsValidi.length !== ts.length) {
        timestamps.set(soggetto, tsValidi);
      }
    }
  }, cleanupIntervalMs);

  /**
   * Controlla se il soggetto può fare un'altra azione.
   * Se sì, registra l'azione e ritorna true.
   * Altrimenti ritorna false (azione rifiutata).
   *
   * @param {string} soggetto - identificatore (es. socket.id)
   * @returns {boolean} true se consentito
   */
  function check(soggetto) {
    const adesso = Date.now();
    const ts = timestamps.get(soggetto) ?? [];

    // Filtra timestamp fuori dalla finestra
    const tsValidi = ts.filter((t) => adesso - t < windowMs);

    if (tsValidi.length >= max) {
      // Aggiorna con la lista filtrata (no nuovo timestamp)
      timestamps.set(soggetto, tsValidi);
      return false;
    }

    // Aggiungi nuovo timestamp
    tsValidi.push(adesso);
    timestamps.set(soggetto, tsValidi);
    return true;
  }

  /**
   * Resetta il counter di un soggetto.
   *
   * @param {string} soggetto
   */
  function reset(soggetto) {
    timestamps.delete(soggetto);
  }

  /**
   * Ritorna il numero di soggetti tracciati.
   * @returns {number}
   */
  function size() {
    return timestamps.size;
  }

  /**
   * Distrugge il limiter (ferma cleanup interval).
   */
  function destroy() {
    clearInterval(interval);
    timestamps.clear();
  }

  return { check, reset, size, destroy };
}
