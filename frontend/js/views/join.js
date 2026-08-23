/**
 * views/join.js — Form unione a partita
 *
 * @module frontend/js/views/join
 */

import { navigate } from '../router.js';
import { state } from '../state.js';
import { emit } from '../socket.js';
import { click as audioClick } from '../audio.js';

const DEFAULT_NAME = localStorage.getItem('pm-nome') || '';

export function renderJoin(params = {}) {
  const prefilledGameId = params.gameId || '';
  return `
    <div class="form-view">
      <div class="form-view-header">
        <h2 class="form-view-title">🔑 Unisciti a una partita</h2>
        <p class="form-view-subtitle">Inserisci il codice che ti ha passato il tuo amico</p>
      </div>

      <form id="join-form">
        <div class="form-group">
          <label class="form-label" for="input-nome">Il tuo nome</label>
          <input class="form-input" type="text" id="input-nome" name="nome" required minlength="1" maxlength="20" placeholder="Es. Luigi" value="${escapeAttr(DEFAULT_NAME)}" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="form-label" for="input-gameid">Codice partita</label>
          <input class="form-input" type="text" id="input-gameid" name="gameId" required minlength="36" maxlength="36" placeholder="UUID 36 caratteri" value="${escapeAttr(prefilledGameId)}" autocomplete="off" style="font-family: monospace; font-size: 0.85rem;">
          <p class="form-help">Il codice è un UUID di 36 caratteri. Chiedi al creatore di condividerlo.</p>
        </div>

        <div id="join-error" class="alert alert-error" style="display: none;"></div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-block" id="btn-submit-join">🚪 Unisciti</button>
          <button type="button" class="btn btn-ghost btn-block" id="btn-back">← Torna alla home</button>
        </div>
      </form>
    </div>
  `;
}

export function attachJoinHandlers() {
  const form = document.getElementById('join-form');
  const errorBox = document.getElementById('join-error');
  const submitBtn = document.getElementById('btn-submit-join');
  const backBtn = document.getElementById('btn-back');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      audioClick();
      navigate('#home');
    });
  }

  if (!form) return;

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    audioClick();
    errorBox.style.display = 'none';

    const data = {
      nome: document.getElementById('input-nome').value.trim(),
      gameId: document.getElementById('input-gameid').value.trim(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Connessione...';

    emit('join_game', data, (resp) => {
      submitBtn.disabled = false;
      submitBtn.textContent = '🚪 Unisciti';

      if (!resp || !resp.ok) {
        const msg = resp?.errore || 'errore_sconosciuto';
        const msgIta = {
          'parametri_mancanti': 'Inserisci nome e codice',
          'partita_non_trovata': 'Partita non trovata',
          'partita_gia_iniziata': 'La partita è già iniziata',
          'partita_piena': 'La partita è piena',
          'nome_non_valido': 'Nome non valido',
          'nome_gia_usato': 'Nome già usato in questa partita',
        }[msg] || `Errore: ${msg}`;
        errorBox.textContent = msgIta;
        errorBox.style.display = 'block';
        return;
      }

      localStorage.setItem('pm-nome', data.nome);
      const partita = resp.partita;
      state.update({ gameId: partita.id, partita: { ...partita, type: 'waiting' } });
      navigate(`#lobby?gameId=${partita.id}`);
    });
  });
}

function escapeAttr(s) {
  if (!s) return '';
  return String(s).replace(/"/g, '"');
}
