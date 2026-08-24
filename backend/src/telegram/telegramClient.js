/**
 * telegramClient.js — Inoltro notifiche di feedback a un bot Telegram
 *
 * Nessuna dipendenza esterna: usa `fetch` nativo (Node 20+) verso l'API Bot.
 * Configurazione via `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (opzionale:
 * se vuoti, l'invio restituisce `non_configurato` senza errori).
 *
 * @module backend/src/telegram
 */

import { config } from '../config.js';
import { logger } from '../logger.js';

const API_BASE = 'https://api.telegram.org';

/**
 * Formatta il messaggio di feedback in testo semplice (niente parse_mode HTML,
 * così non serve escapare il contenuto utente). Funzione pura, testabile.
 *
 * @param {object} feedback
 * @param {string} feedback.tipo - 'suggerimento' | 'problema' | 'altro'
 * @param {string|null} [feedback.sottocategoria]
 * @param {string} feedback.testo
 * @param {string|null} [feedback.nome]
 * @returns {string}
 */
export function buildFeedbackMessage({ tipo, sottocategoria, testo, nome }) {
  return [
    '📬 Nuovo feedback — Parole Mutanti',
    `Tipo: ${tipo || 'altro'}`,
    `Sottocategoria: ${sottocategoria || '—'}`,
    `Da: ${nome || 'anonimo'}`,
    '',
    testo || '(nessun testo)',
  ].join('\n');
}

/**
 * Invia un feedback al bot Telegram via sendMessage.
 *
 * @param {object} feedback - vedi buildFeedbackMessage
 * @returns {Promise<{ok: boolean, errore?: string}>}
 */
export async function inviaFeedbackTelegram(feedback) {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) {
    logger.warn('telegram_non_configurato');
    return { ok: false, errore: 'non_configurato' };
  }

  const text = buildFeedbackMessage(feedback);
  try {
    const resp = await fetch(`${API_BASE}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      logger.error('telegram_send_failed', { status: resp.status, dettaglio: body.slice(0, 200) });
      return { ok: false, errore: 'telegram_error' };
    }
    logger.info('telegram_feedback_inviato', { tipo: feedback.tipo });
    return { ok: true };
  } catch (err) {
    logger.error('telegram_send_exception', { errore: err.message });
    return { ok: false, errore: 'telegram_exception' };
  }
}
