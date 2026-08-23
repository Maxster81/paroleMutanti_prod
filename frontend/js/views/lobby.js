/**
 * views/lobby.js — Lobby view
 *
 * Mostra: codice partita, lista giocatori, stato ready, parola iniziale
 * quando la partita è avviata.
 *
 * @module frontend/js/views/lobby
 */

import { navigate } from '../router.js';
import { state } from '../state.js';
import { emit } from '../socket.js';
import { click as audioClick, success, beep } from '../audio.js';

export function renderLobby(params = {}) {
  const s = state.get();
  const partita = s.partita;

  if (!partita) {
    return `
      <div class="form-view">
        <div class="alert alert-error">Nessuna partita selezionata. Torna alla home.</div>
        <button class="btn btn-secondary btn-block" id="btn-back-home">← Torna alla home</button>
      </div>
    `;
  }

  const cfg = partita.params || {};
  const giocatori = partita.giocatori || [];
  const ready = partita.ready || [];
  const mioNome = localStorage.getItem('pm-nome') || '';
  const ioReady = ready[giocatori.indexOf(mioNome)] || false;

  const tuttipronti = ready.length > 0 && ready.every(r => r);
  const possoAvviare = tuttipronti && giocatori.length >= 2;

  return `
    <div class="lobby-view">
      <div class="lobby-header">
        <div class="lobby-code">CODICE PARTITA</div>
        <div class="code-display" id="game-code">${escapeHtml(partita.id || '')}</div>
        <div class="lobby-status">
          <span class="badge ${partita.state === 'running' ? 'badge-success' : 'badge-warn'}">${partita.state || 'waiting'}</span>
          <span class="text-small text-dim">${giocatori.length}/${cfg.max_players || '?'} giocatori</span>
        </div>
        <p class="text-small text-muted" style="margin-top: var(--spacing-sm);">Condividi questo codice con i tuoi amici</p>
      </div>

      <div class="card">
        <div class="players-list-title">Giocatori</div>
        <div class="players-list">
          ${giocatori.map((g, i) => `
            <div class="player-card ${g === mioNome ? 'player-card-current' : ''}">
              <div>
                <div class="player-name">${escapeHtml(g)} ${g === mioNome ? '<span class="text-dim">(tu)</span>' : ''}</div>
              </div>
              <span class="player-badge ${ready[i] ? '' : 'player-badge-waiting'}">${ready[i] ? '✓ PRONTO' : '...'}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="form-actions">
        ${partita.state === 'waiting' ? `
          <button class="btn ${ioReady ? 'btn-secondary' : 'btn-primary'} btn-block" id="btn-ready">
            ${ioReady ? '⏸ Annulla pronto' : '✓ Sono pronto'}
          </button>
          ${possoAvviare ? `
            <button class="btn btn-success btn-block" id="btn-start">🚀 Avvia partita</button>
          ` : ''}
          <button class="btn btn-danger btn-block" id="btn-leave">🚪 Esci dalla partita</button>
        ` : ''}
        ${partita.state === 'running' ? `
          <div class="alert alert-info">La partita è in corso. Vai alla <a href="#game">game view</a> (M5).</div>
        ` : ''}
      </div>
    </div>
  `;
}

export function attachLobbyHandlers() {
  const btnReady = document.getElementById('btn-ready');
  const btnStart = document.getElementById('btn-start');
  const btnLeave = document.getElementById('btn-leave');
  const btnBack = document.getElementById('btn-back-home');

  if (btnBack) {
    btnBack.addEventListener('click', () => navigate('#home'));
  }

  const s = state.get();
  const partita = s.partita;
  if (!partita) return;
  const mioNome = localStorage.getItem('pm-nome') || '';
  const ready = partita.ready || [];
  const ioReady = ready[partita.giocatori.indexOf(mioNome)] || false;

  if (btnReady) {
    btnReady.addEventListener('click', () => {
      audioClick();
      emit('set_ready', { nome: mioNome, ready: !ioReady }, (resp) => {
        if (resp && resp.ok) {
          // Il broadcast 'lobby_updated' del server aggiornerà la UI
          console.log('[lobby] ready impostato a', !ioReady);
        }
      });
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', () => {
      audioClick();
      emit('set_ready', { nome: mioNome, ready: true }, (resp) => {
        if (resp && resp.tuttiProni) {
          // Il server avvierà la partita automaticamente
          console.log('[lobby] tutti pronti, partita in avvio...');
          success();
        }
      });
    });
  }

  if (btnLeave) {
    btnLeave.addEventListener('click', () => {
      audioClick();
      if (confirm('Vuoi davvero uscire dalla partita?')) {
        emit('leave_game', { nome: mioNome });
        state.update({ gameId: null, partita: null });
        navigate('#home');
      }
    });
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;'
  }[c]));
}
