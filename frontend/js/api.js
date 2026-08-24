/**
 * api.js — Wrapper fetch per il backend
 *
 * Espone funzioni per chiamate HTTP REST.
 * Le risposte sono JSON; errori gestiti e loggati.
 *
 * @module frontend/js/api
 */

const BASE = '';  // stessa origine

/**
 * Health check del backend.
 * @returns {Promise<{ok: boolean, db: string, version: string}>}
 */
export async function healthCheck() {
  try {
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[api] healthCheck fallito:', err.message);
    return { ok: false, db: 'error', error: err.message };
  }
}

/**
 * Invia un feedback al backend (POST /api/feedback).
 * Il server salva in DB e (se configurato) inoltra a Telegram.
 *
 * @param {object} payload - { tipo, sottocategoria, testo, nome }
 * @returns {Promise<{ok: boolean, errore?: string, messaggio?: string, id?: number, telegram?: boolean}>}
 */
export async function inviaFeedback(payload) {
  try {
    const res = await fetch(`${BASE}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, ...data };
  } catch (err) {
    console.error('[api] inviaFeedback fallito:', err.message);
    return { ok: false, errore: 'rete', messaggio: 'Impossibile raggiungere il server.' };
  }
}
