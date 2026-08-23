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
