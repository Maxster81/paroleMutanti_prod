/**
 * socket.js — Wrapper Socket.io client
 *
 * Usa `window.io` (caricato da CDN script in index.html, NON da npm).
 * Il backend serve `/socket.io/socket.io.js` automaticamente.
 *
 * Espone funzioni per connettersi al backend e fare emit/listen.
 * Auto-reconnect con backoff esponenziale.
 *
 * @module frontend/js/socket
 */

import { state } from './state.js';

let socket = null;
let hadConnection = false; // true dopo la PRIMA connessione (per distinguere le riconnessioni)
const listeners = new Map(); // evento → Set di callback
const reconnectListeners = new Set(); // callback da chiamare dopo una riconnessione riuscita

/**
 * Connette al backend Socket.io. Emette eventi in state per la UI.
 */
export function connect() {
  if (socket && socket.connected) return socket;
  if (typeof window.io !== 'function') {
    console.error('[socket] window.io non disponibile (Socket.io client non caricato)');
    return null;
  }

  state.update({ connessione: 'connecting' });

  socket = window.io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    console.log('[socket] connesso, id=' + socket.id);
    state.update({ connessione: 'online' });
    // In Socket.io l'evento 'connect' scatta a OGNI (ri)connessione.
    // Se non è la prima, è una riconnessione dopo una disconnessione
    // (es. standby del telefono): notifica i listener registrati con
    // onReconnect() così il client può ri-sincronizzare lo stato.
    if (hadConnection) {
      console.log('[socket] riconnessione riuscita, id=' + socket.id);
      for (const cb of reconnectListeners) cb();
    }
    hadConnection = true;
  });

  socket.on('disconnect', (motivo) => {
    console.log('[socket] disconnesso:', motivo);
    state.update({ connessione: 'offline' });
  });

  socket.on('connect_error', (err) => {
    console.warn('[socket] connect_error:', err.message);
  });

  // Re-emit di tutti gli eventi di gioco ai listener registrati
  // M5b-fix: round_start/pareggio/round_* erano mancanti, quindi il client
  // non riceveva mai la nuova parola dopo un pareggio (doppio passaggio) né
  // l'aggiornamento di turno/round → schermo "bloccato" sulla parola vecchia.
  const EVENTI = [
    'lobby_updated', 'partita_avviata', 'turn_update', 'tick', 'beep',
    'turno_scaduto', 'mossa_rifiutata', 'giocatore_eliminato',
    'game_over', 'partita_cancellata', 'turn_paused', 'turn_resumed',
    'round_start', 'round_passato', 'round_limbo', 'pareggio', 'turno_finito',
    'manche_finita', 'manche_start', 'punteggio_aggiornato',
    'errore'
  ];
  for (const ev of EVENTI) {
    socket.on(ev, (data) => {
      const set = listeners.get(ev);
      if (set) for (const cb of set) cb(data);
    });
  }

  return socket;
}

/**
 * Disconnette dal backend.
 */
export function disconnect() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Ritorna l'istanza socket corrente (o null se non connesso).
 * @returns {object|null}
 */
export function getSocket() {
  return socket;
}

/**
 * Emette un evento al server.
 *
 * @param {string} evento
 * @param {object} payload
 * @param {function} [ack] - callback per la risposta
 */
export function emit(evento, payload, ack) {
  if (!socket) {
    console.warn('[socket] emit fallito: non connesso');
    if (ack) ack({ ok: false, errore: 'non_connesso' });
    return;
  }
  socket.emit(evento, payload, ack);
}

/**
 * Sottoscrivi a un evento del server.
 *
 * @param {string} evento
 * @param {function} callback - fn(data) => void
 * @returns {function} unsubscribe
 */
export function on(evento, callback) {
  if (!listeners.has(evento)) listeners.set(evento, new Set());
  listeners.get(evento).add(callback);
  return () => listeners.get(evento)?.delete(callback);
}

/**
 * Registra una callback chiamata dopo una riconnessione riuscita del socket
 * (es. dopo uno standby del telefono). Utile per ri-sincronizzare lo stato.
 *
 * @param {function} callback
 */
export function onReconnect(callback) {
  reconnectListeners.add(callback);
}
