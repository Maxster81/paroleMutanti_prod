/**
 * index.js — Entry point per gli handler Socket.io
 *
 * Esporta `attachSocketHandlers(io)` che:
 * 1. Imposta i listener globali del GameManager (per broadcast eventi partita)
 * 2. Per ogni nuova connessione, attacca lobby + game handlers
 *
 * @module backend/src/sockets
 */

import { attachLobbyHandlers } from './lobbyHandler.js';
import { attachGameHandlers, setupGameManagerBroadcast } from './gameHandler.js';
import { logger } from '../logger.js';

/**
 * Attacca tutti gli handler Socket.io al server.
 *
 * @param {import('socket.io').Server} io
 */
export function attachSocketHandlers(io) {
  // 1. Setup broadcast globali del GameManager
  setupGameManagerBroadcast(io);

  // 2. Per ogni connessione, attach handlers
  io.on('connection', (socket) => {
    logger.info('socket_connesso', { socketId: socket.id });

    attachLobbyHandlers(io, socket);
    attachGameHandlers(io, socket);

    socket.on('disconnect', (motivo) => {
      logger.info('socket_disconnesso', { socketId: socket.id, motivo });
    });
  });
}
