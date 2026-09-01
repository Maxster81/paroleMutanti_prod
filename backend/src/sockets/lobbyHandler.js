/**
 * lobbyHandler.js — Handler eventi Socket.io per la lobby
 *
 * Eventi gestiti (wire → handler):
 * - 'create_game' → handleCreateGame
 * - 'join_game' → handleJoinGame
 * - 'leave_game' → handleLeaveGame
 * - 'set_ready' → handleSetReady
 * - 'list_games' → handleListGames
 *
 * M5-bugfix2: socket tracking con registraSocket/rimuoviSocket per
 * permettere al sweeper di identificare partite "running con 0 socket".
 *
 * @module backend/src/sockets/lobbyHandler
 */

import { gameManager } from '../game/GameManager.js';
import { logger } from '../logger.js';
import { creaRateLimiter } from '../utils/rateLimiter.js';

/**
 * Rate limiter per eventi lobby (max 10/sec per socket, anti-spam join/leave).
 */
const rateLimiterLobby = creaRateLimiter({ max: 10, windowMs: 1000 });

/**
 * Helper: associa mappa socketId → gameId per tracking veloce.
 */
const socketToGame = new Map();

/**
 * Fa "entrare" un socket in una partita esistente: lo registra nel tracking
 * socketToGame, lo unisce alla room lobby/game e lo segnala al GameManager.
 *
 * Usato sia da create_game/join_game sia da request_state (M5-bugfix3),
 * così dopo un refresh il nuovo socket torna a ricevere i broadcast.
 *
 * @param {import('socket.io').Socket} socket - socket del client
 * @param {string} gameId - id match
 * @param {object} match - oggetto match (per dedurre lo stato)
 */
export function registraSocketInPartita(socket, gameId, match) {
  socketToGame.set(socket.id, gameId);
  const room = match && match.state === 'running' ? `game:${gameId}` : `lobby:${gameId}`;
  socket.join(room);
  gameManager.registraSocket(gameId, socket.id);
  logger.info('socket_riagganciato', { socketId: socket.id, gameId, room, state: match?.state });
}

/**
 * Broadcast helper: invia evento a tutti i socket presenti in una partita.
 * F5: usa le room (`lobby:gameId` e `game:gameId`) già joinate dai socket
 * (vedi registraSocketInPartita) invece di iterare manualmente la mappa
 * socketToGame (O(n) su tutti i socket). Più pulito e a lookup O(1).
 */
export function broadcastAPartita(io, gameId, evento, payload) {
  io.to(`lobby:${gameId}`).to(`game:${gameId}`).emit(evento, payload);
}

/**
 * Costruisce un payload completo per la lobby (include tutto il necessario
 * al frontend per renderizzare la lobby senza re-fetch).
 */
function partitaPerLobby(p) {
  return {
    id: p.id,
    gameId: p.id,
    creator: p.creator,
    giocatori: p.giocatori,
    ready: p.ready,
    state: p.state,
    vincitore: p.vincitore,
    params: p.params,
    currentWord: p.currentWord,         // M5-bugfix: era assente, ora c'è
    parolaIniziale: p.params.initial_length_min + '-' + p.params.initial_length_max, // placeholder
    timeLeft: p.turnManager ? Math.max(0, p.turnManager.timeLeft) : null,
    turno: p.turnManager ? p.turnManager.turno : null,
    // Best-of-N
    manche: p.mancheCorrente ?? 0,
    gamesToWin: p.gamesToWin ?? p.params?.games_to_win ?? 1,
    punteggio: p.punteggio ?? {},
    giocatoriOriginali: p.giocatoriOriginali ?? [],
  };
}

/**
 * Attacca gli handler lobby a un socket.
 */
export function attachLobbyHandlers(io, socket) {
  // create_game
  socket.on('create_game', async (payload, ack) => {
    if (!rateLimiterLobby.check(socket.id)) {
      return ack?.({ ok: false, errore: 'rate_limit', messaggio: 'Troppe richieste, riprova tra poco.' });
    }

    const { nome, maxPlayers, turnSeconds, gamesToWin, initialLengthMin, initialLengthMax } = payload || {};

    const risultato = await gameManager.creaMatch({
      creator: nome,
      maxPlayers,
      turnSeconds,
      gamesToWin,
      initialLengthMin,
      initialLengthMax,
    });

    if (!risultato.ok) {
      logger.warn('create_game_rifiutato', { socketId: socket.id, errore: risultato.errore });
      return ack?.({ ok: false, errore: risultato.errore });
    }

    socketToGame.set(socket.id, risultato.match.id);
    socket.join(`lobby:${risultato.match.id}`);
    gameManager.registraSocket(risultato.match.id, socket.id);

    logger.info('socket_in_partita', { socketId: socket.id, gameId: risultato.match.id, nome });
    // Chiave wire `partita` (contratto col frontend); valore = oggetto match.
    ack?.({ ok: true, partita: partitaPerLobby(risultato.match) });
  });

  // join_game
  socket.on('join_game', (payload, ack) => {
    if (!rateLimiterLobby.check(socket.id)) {
      return ack?.({ ok: false, errore: 'rate_limit' });
    }

    const { gameId, nome } = payload || {};
    if (!gameId || !nome) {
      return ack?.({ ok: false, errore: 'parametri_mancanti' });
    }

    const risultato = gameManager.uniscitiAMatch(gameId, nome);
    if (!risultato.ok) {
      return ack?.({ ok: false, errore: risultato.errore });
    }

    socketToGame.set(socket.id, gameId);
    socket.join(`lobby:${gameId}`);
    gameManager.registraSocket(gameId, socket.id);

    // Notifica tutti nella lobby (incluso chi era già dentro)
    broadcastAPartita(io, gameId, 'lobby_updated', partitaPerLobby(risultato.match));

    logger.info('socket_join', { socketId: socket.id, gameId, nome });
    ack?.({ ok: true, partita: partitaPerLobby(risultato.match) });
  });

  // leave_game
  socket.on('leave_game', (payload, ack) => {
    const gameId = socketToGame.get(socket.id);
    if (!gameId) return ack?.({ ok: false, errore: 'non_in_partita' });

    const match = gameManager.getMatch(gameId);
    if (!match) {
      socketToGame.delete(socket.id);
      return ack?.({ ok: false, errore: 'partita_non_trovata' });
    }

    if (match.state === 'waiting') {
      const idx = match.giocatori.findIndex((g) => g === payload?.nome);
      if (idx !== -1) {
        match.giocatori.splice(idx, 1);
        match.ready.splice(idx, 1);
        if (match.giocatori.length === 0) {
          gameManager.rimuoviMatch(gameId);
        } else {
          broadcastAPartita(io, gameId, 'lobby_updated', partitaPerLobby(match));
        }
      }
    } else if (match.state === 'running') {
      // M5-bugfix3: abbandono durante la partita. Se resta 1 solo giocatore
      // viene decretato il vincitore (o la partita cancellata se nessuno);
      // altrimenti il turno passa correttamente al giocatore successivo.
      const risultatoAbbandono = gameManager.abbandonaGiocatore(gameId, payload?.nome);
      if (risultatoAbbandono.ok) {
        logger.info('giocatore_abbandonato_in_partita', { socketId: socket.id, gameId, nome: payload?.nome });
      }
    }

    socketToGame.delete(socket.id);
    gameManager.rimuoviSocket(gameId, socket.id);
    socket.leave(`lobby:${gameId}`);
    logger.info('socket_leave', { socketId: socket.id, gameId });
    ack?.({ ok: true });
  });

  // set_ready
  socket.on('set_ready', async (payload, ack) => {
    const gameId = socketToGame.get(socket.id);
    if (!gameId) return ack?.({ ok: false, errore: 'non_in_partita' });

    const { nome, ready } = payload || {};
    const risultato = gameManager.setReady(gameId, nome, ready);
    if (!risultato.ok) {
      return ack?.({ ok: false, errore: risultato.errore });
    }

    broadcastAPartita(io, gameId, 'lobby_updated', partitaPerLobby(risultato.match));

    ack?.({ ok: true, tuttiProni: risultato.tuttiProni });

    // Auto-avvio se tutti pronti
    if (risultato.tuttiProni) {
      const avvio = await gameManager.avviaMatch(gameId);
      if (avvio.ok) {
        const match = avvio.match;
        for (const [sid, gid] of socketToGame.entries()) {
          if (gid === gameId) {
            const s = io.sockets.sockets.get(sid);
            if (s) {
              s.leave(`lobby:${gameId}`);
              s.join(`game:${gameId}`);
              s.emit('partita_avviata', {
                gameId,
                parolaIniziale: match.currentWord,
                giocatoreCorrente: match.turnManager.giocatoreCorrente(),
                timeLeft: match.turnManager.timeLeft,
                timeLimit: match.params.turn_seconds,
                giocatori: match.giocatori,
                // M5c: include la catena di parole già usate per la UI
                history: match.history,
                // Best-of-N
                manche: match.mancheCorrente,
                gamesToWin: match.gamesToWin,
                punteggio: match.punteggio,
              });
            }
          }
        }
        logger.info('partita_avviata_broadcast', { gameId });
      } else {
        logger.error('avvio_automatico_fallito', { gameId, errore: avvio.errore });
        broadcastAPartita(io, gameId, 'errore', { messaggio: `Impossibile avviare: ${avvio.errore}` });
      }
    }
  });

  // list_games
  socket.on('list_games', (payload, ack) => {
    const partite = gameManager.listaMatchAperti().map(partitaPerLobby);
    ack?.({ ok: true, partite });
  });

  // Disconnect: cleanup
  socket.on('disconnect', () => {
    const gameId = socketToGame.get(socket.id);
    if (gameId) {
      const match = gameManager.getMatch(gameId);
      if (match && match.state === 'waiting') {
        broadcastAPartita(io, gameId, 'lobby_updated', partitaPerLobby(match));
      }
      gameManager.rimuoviSocket(gameId, socket.id);
      socketToGame.delete(socket.id);
    }
    logger.info('socket_disconnect', { socketId: socket.id, gameId });
  });
}
