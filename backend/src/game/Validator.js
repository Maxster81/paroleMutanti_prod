/**
 * Validator.js — Validazione ibrida delle mosse di gioco
 *
 * Una mossa è valida se (controllo a TRE fasi):
 * 1. La parola rispetta il charset e la lunghezza consentita (Validator base)
 * 2. La distanza Levenshtein dalla parola precedente è esattamente 1
 * 3. **Fase 1 — DB**: la parola esiste nel dizionario (query DB)
 * 4. **Fase 2 — Forme flesse/derivate**: se non nel DB, prova a derivare il
 *    lemma (femminile/plurale/participio...) e verifica il lemma nel DB
 *    (source='MORF'). Copre casi come `oziata`/`oziati` → lemma `oziato`.
 * 5. **Fase 3 — AI (fallback)**: solo se nemmeno il lemma è nel DB, chiedi a
 *    DeepSeek. Se YES → INSERT nel DB (source='AI') e valida.
 *
 * @module backend/src/game/Validator
 */

import { parolaEsistenteConSource, paroleEsistenti, inserisciParolaAI } from '../db/wordQueries.js';
import { isDistanzaUno } from '../utils/levenshtein.js';
import { validaParola, normalizzaBase } from '../utils/normalizza.js';
import { candidatiFormeBase } from '../utils/morfologia.js';
import { verificaParolaAI } from '../ai/deepseekClient.js';
import { get as aiCacheGet, set as aiCacheSet } from '../ai/cache.js';
import { check as aiRateCheck } from '../ai/rateLimiter.js';
import { logger } from '../logger.js';

/**
 * Risultato di una validazione.
 *
 * @typedef {object} RisultatoValidazione
 * @property {boolean} valida
 * @property {string|null} motivo
 * @property {string} normalizzata
 * @property {string|null} source - 'DB' | 'MORF' | 'AI' | null
 * @property {string|null} messaggio
 * @property {string} [lemma] - lemma derivato dalla morfologia (source 'MORF')
 * @property {boolean} [ai_usata]
 * @property {number} [ai_durata_ms]
 */

/**
 * Valida una mossa.
 *
 * @param {object} opzioni
 * @param {string} opzioni.parolaPrecedente
 * @param {string} opzioni.parolaNuova
 * @param {string} [opzioni.gameId] - per rate limit AI
 * @param {Set<string>} [opzioni.paroleUsate] - parole già usate in questa partita (normalizzate)
 * @param {number} [opzioni.lunghezzaMin=3]
 * @param {number} [opzioni.lunghezzaMax=10]
 * @returns {Promise<RisultatoValidazione>}
 */
export async function validaMossa({ parolaPrecedente, parolaNuova, gameId, paroleUsate, lunghezzaMin = 3, lunghezzaMax = 10 }) {
  // 1. Validazione base (charset, lunghezza)
  const checkBase = validaParola(parolaNuova, lunghezzaMin, lunghezzaMax);
  if (!checkBase.valida) {
    return {
      valida: false,
      motivo: checkBase.motivo,
      normalizzata: checkBase.normalizzata,
      source: null,
      messaggio: messaggioPerMotivo(checkBase.motivo),
    };
  }

  const normalizzata = checkBase.normalizzata;
  const prev = normalizzaBase(parolaPrecedente);

  // 1.5 Check anti-ripetizione: la parola non deve essere già stata usata
  //     (prima del check distanza, così il messaggio è specifico). Evita i
  //     loop infiniti del tipo ARIDO → ARIDI → ARIDO.
  if (paroleUsate && paroleUsate.has(normalizzata)) {
    return {
      valida: false,
      motivo: 'parola_gia_usata',
      normalizzata,
      source: null,
      messaggio: `"${normalizzata}" è già stata usata in questa partita. Scegli una parola diversa.`,
    };
  }

  // 2. Check distanza 1 dalla parola precedente
  if (!isDistanzaUno(prev, normalizzata)) {
    return {
      valida: false,
      motivo: 'distanza',
      normalizzata,
      source: null,
      messaggio: `La parola deve differire di esattamente una lettera da "${prev}" (aggiunta, rimozione o sostituzione).`,
    };
  }

  // 3. Fase 1 — Check esistenza nel dizionario
  const checkDb = await parolaEsistenteConSource(normalizzata);
  if (checkDb.esiste) {
    return {
      valida: true,
      motivo: null,
      normalizzata,
      source: checkDb.source,
      messaggio: null,
    };
  }

  // 4. Fase 2 — Forme flesse/derivate: la parola non è nel DB ma può essere
  //    una forma flessa (femminile, plurale, participio...) di un lemma
  //    presente. Deriviamo i candidati base e li verifichiamo nel DB.
  const candidati = candidatiFormeBase(normalizzata);
  if (candidati.length > 0) {
    const presenti = await paroleEsistenti(candidati);
    if (presenti.size > 0) {
      const lemma = candidati.find((c) => presenti.has(c));
      logger.info('parola_accettata_morfologia', { lemma });
      return {
        valida: true,
        motivo: null,
        normalizzata,
        source: 'MORF',
        lemma,
        messaggio: null,
      };
    }
  }

  // 5. Fase 3 — FALLBACK AI: parola non in DB (né forme flesse), provo DeepSeek
  // 4a. Controlla cache
  const cached = aiCacheGet(normalizzata);
  if (cached) {
    logger.info('ai_cache_hit', { durataMs: cached.eta_ms });
    if (cached.valida) {
      await inserisciParolaAI(normalizzata);
      return {
        valida: true,
        motivo: null,
        normalizzata,
        source: 'AI',
        messaggio: null,
        ai_usata: true,
        ai_durata_ms: 0,
      };
    } else {
      return {
        valida: false,
        motivo: 'ai_rifiutata',
        normalizzata,
        source: null,
        messaggio: `"${normalizzata}" non è una parola italiana valida.`,
        ai_usata: true,
      };
    }
  }

  // 4b. Controlla rate limit
  if (gameId && !aiRateCheck(gameId)) {
    logger.warn('ai_rate_limit_hit', { gameId });
    return {
      valida: false,
      motivo: 'rate_limit',
      normalizzata,
      source: null,
      messaggio: `Parola "${normalizzata}" non nel dizionario. Limite AI raggiunto per questa partita.`,
    };
  }

  // 4c. Chiama DeepSeek
  logger.info('parola_non_in_db_ai_chiamata', { gameId });
  const risultatoAi = await verificaParolaAI(normalizzata);

  // Salva in cache
  if (!risultatoAi.errore) {
    aiCacheSet(normalizzata, risultatoAi.valida);
  }

  if (risultatoAi.errore) {
    logger.warn('ai_validation_error', { errore: risultatoAi.errore });
    return {
      valida: false,
      motivo: 'ai_errore',
      normalizzata,
      source: null,
      messaggio: `Parola "${normalizzata}" non nel dizionario. AI non disponibile: ${risultatoAi.errore}`,
    };
  }

  if (risultatoAi.valida) {
    await inserisciParolaAI(normalizzata);
    return {
      valida: true,
      motivo: null,
      normalizzata,
      source: 'AI',
      messaggio: null,
      ai_usata: true,
      ai_durata_ms: risultatoAi.durataMs,
    };
  }

  return {
    valida: false,
    motivo: 'ai_rifiutata',
    normalizzata,
    source: null,
    messaggio: `"${normalizzata}" non è riconosciuta come parola italiana valida.`,
    ai_usata: true,
    ai_durata_ms: risultatoAi.durataMs,
  };
}

function messaggioPerMotivo(motivo) {
  switch (motivo) {
    case 'parola_vuota':
      return 'La parola non può essere vuota.';
    case 'troppo_corta':
      return 'La parola è troppo corta.';
    case 'troppo_lunga':
      return 'La parola è troppo lunga.';
    case 'caratteri_non_validi':
      return 'La parola contiene caratteri non ammessi (solo lettere italiane a-z, àèéìòù).';
    default:
      return 'Parola non valida.';
  }
}
