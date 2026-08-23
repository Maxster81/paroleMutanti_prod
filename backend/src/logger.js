/**
 * logger.js — Logger strutturato JSON per "Parole Mutanti"
 *
 * Semplice logger che emette JSON su stdout. Niente dipendenze esterne.
 * Livelli: error, warn, info, debug. Default: info.
 *
 * @module backend/src/logger
 */

const LIVELLI = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Configurazione corrente del logger.
 * Livello letto da process.env.LOG_LEVEL.
 */
const config = {
  livello: LIVELLI[process.env.LOG_LEVEL?.toLowerCase()] ?? LIVELLI.info,
};

/**
 * Formatta un log entry come JSON. Include sempre timestamp, livello e msg.
 *
 * @param {string} livello - 'error' | 'warn' | 'info' | 'debug'
 * @param {string} msg - messaggio
 * @param {object} [meta] - campi extra da includere
 * @returns {string} JSON formattato
 */
function formatta(livello, msg, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level: livello,
    msg,
    ...(meta && typeof meta === 'object' ? meta : {}),
  };
  return JSON.stringify(entry);
}

/**
 * Controlla se il livello è abilitato.
 *
 * @param {string} livello
 * @returns {boolean}
 */
function isAbilitato(livello) {
  return LIVELLI[livello] <= config.livello;
}

/**
 * Emette un log al livello specificato.
 *
 * @param {string} livello
 * @param {string} msg
 * @param {object} [meta]
 */
function log(livello, msg, meta) {
  if (!isAbilitato(livello)) return;
  const riga = formatta(livello, msg, meta);
  if (livello === 'error') {
    console.error(riga);
  } else if (livello === 'warn') {
    console.warn(riga);
  } else {
    console.log(riga);
  }
}

/**
 * Logger API.
 */
export const logger = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),

  /**
   * Crea un child logger con campi prefissati.
   *
   * @param {object} contesto - campi da includere in ogni log
   * @returns {object} logger con stessa API ma con contesto prefisso
   */
  child: (contesto) => ({
    error: (msg, meta) => log('error', msg, { ...contesto, ...meta }),
    warn: (msg, meta) => log('warn', msg, { ...contesto, ...meta }),
    info: (msg, meta) => log('info', msg, { ...contesto, ...meta }),
    debug: (msg, meta) => log('debug', msg, { ...contesto, ...meta }),
  }),

  /**
   * Restituisce il livello corrente (per debug o test).
   * @returns {string}
   */
  get livello() {
    return Object.keys(LIVELLI).find((k) => LIVELLI[k] === config.livello);
  },
};
