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

    const match = gameManager.getMatch(gameId);
    if (!match) return ack?.({ ok: false, errore: 'partita_non_trovata' });

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
      if (match.turnManager && match.turnManager.attivo) {
        const statoTurno = match.turnManager.statoCorrente();
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

      if (match.state === 'finished') {
        broadcastAPartita(io, gameId, 'game_over', {
          gameId,
          vincitore: match.vincitore,
          history: match.history,
          durataMs: match.endedAt - match.startedAt,
          aiValidationsCount: match.aiValidationsCount,
          punteggio: match.punteggio,
          gamesToWin: match.gamesToWin,
          manche: match.mancheCorrente,
        });
        setTimeout(() => gameManager.rimuoviMatch(gameId), 5000);
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
    const match = gameManager.getMatch(gameId);
    if (match && match.turnManager && match.turnManager.attivo) {
      const statoTurno = match.turnManager.statoCorrente();
      broadcastAPartita(io, gameId, 'turn_update', { gameId, ...statoTurno, passaggio: true });
    }
    ack?.({ ok: true });
  });

  // request_state
  socket.on('request_state', (payload, ack) => {
    const { gameId } = payload || {};
    const match = gameId ? gameManager.getMatch(gameId) : null;
    if (!match) return ack?.({ ok: false, errore: 'partita_non_trovata' });

    // M5-bugfix3: al refresh (nuovo socket) il socket NON è nella room né
    // registrato nel tracking socketToGame. Senza questo ri-aggancio, i
    // broadcast (io.to(socketId)) non raggiungono più il client dopo il
    // refresh → counter fermo, mosse degli altri non visibili.
    registraSocketInPartita(socket, gameId, match);

    // M5-bugfix3: include id/gameId nello stato. Senza di essi, dopo il
    // refresh la view game invierebbe submit_word con gameId undefined
    // → server risponde "parametri_mancanti" → errore generico lato client.
    const stato = match.turnManager
      ? { id: match.id, gameId: match.id, ...match.turnManager.statoCorrente(), state: match.state, vincitore: match.vincitore, giocatori: match.giocatori }
      : { id: match.id, gameId: match.id, state: match.state, giocatori: match.giocatori, ready: match.ready, params: match.params };
    ack?.({ ok: true, stato });
  });
}

export function setupGameManagerBroadcast(io) {
  gameManager.on('mossa_validata', ({ gameId, parola, match }) => {
    logger.debug('mossa_validata_broadcast', { gameId, parola });
  });

  gameManager.on('mossa_rifiutata', ({ gameId, parola, motivo, match }) => {
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

  gameManager.on('giocatore_eliminato', ({ gameId, nome, match }) => {
    broadcastAPartita(io, gameId, 'giocatore_eliminato', {
      gameId,
      nome,
      giocatoriRimanenti: match.giocatori,
    });
  });

  // Best-of-N (manche ↔ match)
  gameManager.on('manche_finita', (data) => {
    broadcastAPartita(io, data.gameId, 'manche_finita', data);
  });
  gameManager.on('manche_start', (data) => {
    broadcastAPartita(io, data.gameId, 'manche_start', data);
  });
  gameManager.on('punteggio_aggiornato', (data) => {
    broadcastAPartita(io, data.gameId, 'punteggio_aggiornato', data);
  });

  gameManager.on('partita_finita', (match) => {
    broadcastAPartita(io, match.id, 'game_over', {
      gameId: match.id,
      vincitore: match.vincitore,
      history: match.history,
      durataMs: match.endedAt - match.startedAt,
      aiValidationsCount: match.aiValidationsCount,
      punteggio: match.punteggio,
      gamesToWin: match.gamesToWin,
      manche: match.mancheCorrente,
    });
    setTimeout(() => gameManager.rimuoviMatch(match.id), 5000);
  });

  gameManager.on('partita_cancellata', (match) => {
    broadcastAPartita(io, match.id, 'partita_cancellata', { gameId: match.id });
    setTimeout(() => gameManager.rimuoviMatch(match.id), 5000);
  });
}
