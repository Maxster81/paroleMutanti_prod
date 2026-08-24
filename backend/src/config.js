/**
 * config.js — Configurazione centralizzata per "Parole Mutanti"
 *
 * Legge e valida le variabili d'ambiente da .env (o /etc/parole-mutanti/.env in prod).
 * Esporta un oggetto di configurazione tipizzato e validato.
 *
 * Validazione fail-fast: se mancano variabili critiche, l'app si rifiuta di partire.
 *
 * @module backend/src/config
 */

import 'dotenv/config';
import { logger } from './logger.js';

/**
 * Converte una stringa env in intero, con default e validazione.
 *
 * @param {string|undefined} valore - valore grezzo da env
 * @param {number} defaultValue - valore di default se vuoto/invalido
 * @param {number} min - valore minimo accettabile (incluso)
 * @param {number} max - valore massimo accettabile (incluso)
 * @returns {number} intero validato
 */
function toInt(valore, defaultValue, min, max) {
  const n = parseInt(valore, 10);
  if (Number.isNaN(n)) return defaultValue;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Converte una stringa env in booleano.
 * @param {string|undefined} valore
 * @returns {boolean}
 */
function toBool(valore) {
  return ['1', 'true', 'yes', 'on'].includes(String(valore || '').toLowerCase());
}

/**
 * Validazione delle variabili d'ambiente critiche.
 * Logga warning per variabili mancanti ma non bloccanti.
 * @param {object} cfg - configurazione da validare
 */
function validaConfig(cfg) {
  const errori = [];

  if (!cfg.database.url) {
    errori.push('DATABASE_URL è obbligatorio');
  }
  if (cfg.nodeEnv === 'production') {
    if (!cfg.security.sessionSecret || cfg.security.sessionSecret.length < 32) {
      errori.push('SESSION_SECRET deve essere almeno 32 caratteri in produzione');
    }
    // Chiave DeepSeek OPZIONALE in produzione: vuota = fallback AI disattivato.
    // Se invece è impostata deve essere valida (no placeholder, >= 20 caratteri).
    if (cfg.deepseek.apiKey && (cfg.deepseek.apiKey.startsWith('sk-INSERISCI') || cfg.deepseek.apiKey.length < 20)) {
      errori.push('DEEPSEEK_API_KEY non configurata correttamente');
    }
  } else {
    // Dev: solo warning, non blocchiamo
    if (cfg.deepseek.apiKey.startsWith('sk-INSERISCI')) {
      logger.warn('DEEPSEEK_API_KEY placeholder: il fallback AI sarà disattivato finché non la imposti');
    }
  }

  if (errori.length > 0) {
    logger.error('errori_di_configurazione', { errori });
    process.exit(1);
  }
}

/**
 * Esporta l'oggetto di configurazione validato.
 */
export const config = (() => {
  const cfg = {
    // Server
    port: toInt(process.env.PORT, 8090, 1, 65535),
    // In produzione il default è 127.0.0.1 (dietro reverse proxy Caddy);
    // in dev resta 0.0.0.0 (accessibile da rete locale/WSL).
    host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'),
    nodeEnv: process.env.NODE_ENV || 'development',
    publicBasePath: process.env.PUBLIC_BASE_PATH || '',
    logLevel: process.env.LOG_LEVEL || 'info',

    // Database
    database: {
      url: process.env.DATABASE_URL || '',
      poolMax: toInt(process.env.DB_POOL_MAX, 10, 1, 50),
    },

    // DeepSeek
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      rateLimitPerMin: toInt(process.env.DEEPSEEK_RATE_LIMIT_PER_MIN, 10, 1, 100),
      enabled: toBool(process.env.DEEPSEEK_ENABLED ?? 'true'),
    },

    // Telegram (notifiche feedback — opzionale; vuoto = disattivo)
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
    },

    // Gioco
    game: {
      minPlayers: toInt(process.env.MIN_PLAYERS, 2, 2, 8),
      maxPlayers: toInt(process.env.MAX_PLAYERS, 8, 2, 8),
      defaultGamesToWin: toInt(process.env.DEFAULT_GAMES_TO_WIN, 2, 1, 4),
      defaultTurnSeconds: toInt(process.env.DEFAULT_TURN_SECONDS, 30, 5, 60),
      initialWordMinLength: toInt(process.env.INITIAL_WORD_MIN_LENGTH, 5, 3, 10),
      initialWordMaxLength: toInt(process.env.INITIAL_WORD_MAX_LENGTH, 8, 3, 10),
    },

    // Sicurezza
    security: {
      sessionSecret: process.env.SESSION_SECRET || '',
      // CORS: in dev aperto ('*'); in produzione va limitato al dominio via
      // CORS_ORIGIN (regola .clinerules/05-security). Se non impostato in prod,
      // resta vuoto → nessuna origine cross-origin consentita (l'app è servita
      // same-origin dietro Caddy, quindi il CORS non è necessario).
      corsOrigin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : '*'),
      socketPayloadLimit: '100kb',
    },
  };

  validaConfig(cfg);
  return cfg;
})();
