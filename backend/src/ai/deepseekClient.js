/**
 * deepseekClient.js — Wrapper per l'API DeepSeek
 *
 * Espone `verificaParolaAI(parola)` che chiede a DeepSeek se una parola
 * è italiana valida. Risposta normalizzata: `YES` → valida, `NO` → non valida.
 *
 * Basato sul benchmark del 2026-08-15:
 * - Latenza media: ~343ms
 * - p95: ~980ms (prima chiamata cold start)
 * - Timeout: 1500ms (sicuro + margine)
 *
 * @module backend/src/ai/deepseekClient
 */

import { config } from '../config.js';
import { logger } from '../logger.js';

const TIMEOUT_MS = 1500; // basato su benchmark
const MAX_RETRIES = 1;

/**
 * Costruisce il prompt per chiedere se una parola è italiana valida.
 *
 * @param {string} parola
 * @returns {object[]} array messaggi OpenAI-compatibili
 */
function buildPrompt(parola) {
  return [
    {
      role: 'system',
      content: 'Sei un lessicografo italiano. Rispondi solo "YES" o "NO" in maiuscolo, senza altre parole.',
    },
    {
      role: 'user',
      content: `La parola "${parola}" esiste nella lingua italiana (come lemma o come forma flessa corretta)? Rispondi solo YES o NO.`,
    },
  ];
}

/**
 * Esegue una singola chiamata API a DeepSeek.
 *
 * @param {string} parola
 * @returns {Promise<{valida: boolean, risposta: string, durataMs: number}>}
 */
async function chiamaDeepSeek(parola) {
  const inizio = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(config.deepseek.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages: buildPrompt(parola),
        max_tokens: 4,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const durataMs = Date.now() - inizio;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const testoRisposta = (data.choices?.[0]?.message?.content ?? '').trim();

    // Normalizza: accettiamo risposte univoche YES / SÌ / SI (inglese o
    // italiano, con eventuale punteggiatura "SÌ.", "si", ecc.). La lingua non
    // importa purché il significato sia inequivocabile.
    const valida = ['yes', 'sì', 'si'].includes(
      testoRisposta.toLowerCase().replace(/[^a-zà-ù]/g, '')
    );

    return { valida, risposta: testoRisposta.toUpperCase(), durataMs };
  } catch (err) {
    clearTimeout(timer);
    const durataMs = Date.now() - inizio;
    if (err.name === 'AbortError') {
      throw new Error(`Timeout dopo ${TIMEOUT_MS}ms`);
    }
    throw new Error(`Errore DeepSeek: ${err.message} (durata ${durataMs}ms)`);
  }
}

/**
 * Verifica se una parola è italiana valida tramite DeepSeek.
 * Con retry 1 volta in caso di errore transitorio (timeout, 5xx).
 *
 * @param {string} parola - parola da verificare (già normalizzata lowercase)
 * @returns {Promise<{valida: boolean, risposta: string, durataMs: number, errore: string|null}>}
 */
export async function verificaParolaAI(parola) {
  if (!config.deepseek.enabled) {
    return { valida: false, risposta: '', durataMs: 0, errore: 'ai_disabilitata' };
  }
  if (!config.deepseek.apiKey || config.deepseek.apiKey.startsWith('sk-INSERISCI')) {
    logger.warn('ai_chiamata_skipped_no_api_key');
    return { valida: false, risposta: '', durataMs: 0, errore: 'no_api_key' };
  }

  let ultimoErrore = null;
  for (let tentativo = 0; tentativo <= MAX_RETRIES; tentativo++) {
    try {
      const r = await chiamaDeepSeek(parola);
      logger.info('ai_validation_completed', {
        durataMs: r.durataMs,
        valida: r.valida,
        tentativo: tentativo + 1,
      });
      return { valida: r.valida, risposta: r.risposta, durataMs: r.durataMs, errore: null };
    } catch (err) {
      ultimoErrore = err;
      logger.warn('ai_validation_failed', {
        errore: err.message,
        tentativo: tentativo + 1,
      });
      if (tentativo < MAX_RETRIES) {
        // Aspetta un po' prima del retry
        await new Promise((res) => setTimeout(res, 300));
      }
    }
  }

  return {
    valida: false,
    risposta: '',
    durataMs: 0,
    errore: ultimoErrore?.message ?? 'errore_sconosciuto',
  };
}
