/**
 * gameHandler.js — Handler eventi Socket.io per la fase di gioco
 *
 * Eventi gestiti:
 * - 'submit_word' → handleSubmitWord (con M3: supporto AI fallback)
 * - 'pass_turn' → handlePassTurn
 * - 'request_state' → handleRequestState
 *
 * @module backend/src/sockets/gameHandler
 */

import { gameManager } from '../game/GameManager.js';
import { logger } from '../logger.js';
import { creaRateLimiter } from '../utils/rateLimiter.js';
import { broadcastAPartita, registraSocketInPartita } from './lobbyHandler.js';

const rateLimiterSubmit = creaRateLimiter({ max: 5, windowMs: 1000 });

export function attachGameHandlers(io, socket) {
  // submit_word
  socket.on('submit_word', async (payload, ack) => {
    if (!rateLimiterSubmit.check(socket.id)) {
      return ack?.({ ok: false, errore: 'rate_limit', messaggio: 'Troppi submit, rallenta!' });
    }

    const { gameId, nome, parola } = payload || {};
    if (!gameId || !nome || !parola) {
      return ack?.({ ok: false, errore: 'parametri_mancanti' });
    }

    const partita = gameManager.getPartita(gameId);
    if (!partita) return ack?.({ ok: false, errore: 'partita_non_trovata' });

    // M3: broadcast "verifica in corso" se la parola non è nel DB
    // (e quindi probabile chiamata AI). Il client può mostrare un loader.
    // Per semplicità lo inviamo solo se validazione passa (sarà il segnale "ok").

    const risultato = await gameManager.submitParola(gameId, nome, parola);

    // Ack con info AI
    ack?.({
      ok: risultato.ok,
      valida: risultato.valida,
      motivo: risultato.motivo,
      messaggio: risultato.messaggio,
      source: risultato.source,
    });

    if (risultato.valida) {
      // M5b-fix: turn_update solo se il turno è ancora ATTIVO (round normale
      // in corso). Quando il round chiude il turno (attivo=false) NON emettere
      // qui: _gestisciFineTurno è async e lo stato sarebbe "stale"; in quel
      // caso lo stato corretto arriva da GameManager (pareggio/eliminazione).
      if (partita.turnManager && partita.turnManager.attivo) {
        const statoTurno = partita.turnManager.statoCorrente();
        broadcastAPartita(io, gameId, 'turn_update', {
          gameId,
          ...statoTurno,
          validazione: {
            parola: risultato.normalizzata,
            giocatore: nome,
            source: risultato.source,
            ai_usata: !!risultato.ai_usata,
          },
        });
      }

      if (partita.state === 'finished') {
        broadcastAPartita(io, gameId, 'game_over', {
          gameId,
          vincitore: partita.vincitore,
          history: partita.history,
          durataMs: partita.endedAt - partita.startedAt,
          aiValidationsCount: partita.aiValidationsCount,
        });
        setTimeout(() => gameManager.rimuoviPartita(gameId), 5000);
      }
    } else {
      broadcastAPartita(io, gameId, 'mossa_rifiutata', {
        gameId,
        giocatore: nome,
        parola,
        motivo: risultato.motivo,
        messaggio: risultato.messaggio,
      });
    }
  });

  // pass_turn
  socket.on('pass_turn', (payload, ack) => {
    const { gameId, nome } = payload || {};
    if (!gameId || !nome) {
      return ack?.({ ok: false, errore: 'parametri_mancanti' });
    }

    const risultato = gameManager.passaTurno(gameId, nome);
    if (!risultato.ok) {
      return ack?.({ ok: false, errore: risultato.errore });
    }

    // M5b-fix: turn_update solo se il turno è ancora ATTIVO (round normale).
    // Quando il passaggio chiude il turno (attivo=false) NON emettere qui:
    // _gestisciFineTurno è async e lo stato sarebbe "stale"; in quel caso lo
    // stato corretto arriva da GameManager (pareggio/eliminazione) via turn_update.
    const partita = gameManager.getPartita(gameId);
    if (partita && partita.turnManager && partita.turnManager.attivo) {
      const statoTurno = partita.turnManager.statoCorrente();
      broadcastAPartita(io, gameId, 'turn_update', { gameId, ...statoTurno, passaggio: true });
    }
    ack?.({ ok: true });
  });

  // request_state
  socket.on('request_state', (payload, ack) => {
    const { gameId } = payload || {};
    const partita = gameId ? gameManager.getPartita(gameId) : null;
    if (!partita) return ack?.({ ok: false, errore: 'partita_non_trovata' });

    // M5-bugfix3: al refresh (nuovo socket) il socket NON è nella room né
    // registrato nel tracking socketToGame. Senza questo ri-aggancio, i
    // broadcast (io.to(socketId)) non raggiungono più il client dopo il
    // refresh → counter fermo, mosse degli altri non visibili.
    registraSocketInPartita(socket, gameId, partita);

    // M5-bugfix3: include id/gameId nello stato. Senza di essi, dopo il
    // refresh la view game invierebbe submit_word con gameId undefined
    // → server risponde "parametri_mancanti" → errore generico lato client.
    const stato = partita.turnManager
      ? { id: partita.id, gameId: partita.id, ...partita.turnManager.statoCorrente(), state: partita.state, vincitore: partita.vincitore, giocatori: partita.giocatori }
      : { id: partita.id, gameId: partita.id, state: partita.state, giocatori: partita.giocatori, ready: partita.ready, params: partita.params };
    ack?.({ ok: true, stato });
  });
}

export function setupGameManagerBroadcast(io) {
  gameManager.on('mossa_validata', ({ gameId, parola, partita }) => {
    logger.debug('mossa_validata_broadcast', { gameId, parola });
  });

  gameManager.on('mossa_rifiutata', ({ gameId, parola, motivo, partita }) => {
    broadcastAPartita(io, gameId, 'mossa_rifiutata', { gameId, parola, motivo });
  });

  gameManager.on('round_passato', ({ gameId, giocatore, parola, source }) => {
    broadcastAPartita(io, gameId, 'round_passato', { gameId, giocatore, parola, source });
  });
  gameManager.on('round_limbo', ({ gameId, giocatore }) => {
    broadcastAPartita(io, gameId, 'round_limbo', { gameId, giocatore });
  });
  gameManager.on('round_start', ({ gameId, stato }) => {
    broadcastAPartita(io, gameId, 'round_start', { gameId, stato });
  });
  gameManager.on('pareggio', ({ gameId, turno, nuovaParola, parola }) => {
    broadcastAPartita(io, gameId, 'pareggio', { gameId, turno, parola: nuovaParola || parola });
  });
  gameManager.on('turno_finito', ({ gameId, roundRisultati }) => {
    broadcastAPartita(io, gameId, 'turno_finito', { gameId, roundRisultati });
  });
  gameManager.on('turn_update', ({ gameId, stato }) => {
    broadcastAPartita(io, gameId, 'turn_update', { gameId, ...stato });
  });
  gameManager.on('turn_change', ({ gameId, stato }) => {
    broadcastAPartita(io, gameId, 'turn_update', { gameId, ...stato });
  });

  gameManager.on('tick', ({ gameId, timeLeft, turno }) => {
    broadcastAPartita(io, gameId, 'tick', { gameId, timeLeft, turno });
  });

  gameManager.on('beep', ({ gameId, timeLeft }) => {
    broadcastAPartita(io, gameId, 'beep', { gameId, timeLeft });
  });

  gameManager.on('timeout', ({ gameId, giocatore }) => {
    broadcastAPartita(io, gameId, 'turno_scaduto', { gameId, giocatore });
  });

  gameManager.on('paused', ({ gameId, ...data }) => {
    broadcastAPartita(io, gameId, 'turn_paused', { gameId, ...data });
  });

  gameManager.on('resumed', ({ gameId, ...data }) => {
    broadcastAPartita(io, gameId, 'turn_resumed', { gameId, ...data });
  });

  gameManager.on('giocatore_eliminato', ({ gameId, nome, partita }) => {
    broadcastAPartita(io, gameId, 'giocatore_eliminato', {
      gameId,
      nome,
      giocatoriRimanenti: partita.giocatori,
    });
  });

  gameManager.on('partita_finita', (partita) => {
    broadcastAPartita(io, partita.id, 'game_over', {
      gameId: partita.id,
      vincitore: partita.vincitore,
      history: partita.history,
      durataMs: partita.endedAt - partita.startedAt,
      aiValidationsCount: partita.aiValidationsCount,
    });
    setTimeout(() => gameManager.rimuoviPartita(partita.id), 5000);
  });

  gameManager.on('partita_cancellata', (partita) => {
    broadcastAPartita(io, partita.id, 'partita_cancellata', { gameId: partita.id });
    setTimeout(() => gameManager.rimuoviPartita(partita.id), 5000);
  });
}
