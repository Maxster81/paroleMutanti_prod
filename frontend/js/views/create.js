/**
 * views/create.js — Form creazione partita
 *
 * @module frontend/js/views/create
 */

import { navigate } from '../router.js';
import { state } from '../state.js';
import { emit } from '../socket.js';
import { click as audioClick } from '../audio.js';

const DEFAULT_NAME = localStorage.getItem('pm-nome') || '';

export function renderCreate(params = {}) {
  return `
    <div class="form-view">
      <div class="form-view-header">
        <h2 class="form-view-title">📝 Crea una partita</h2>
        <p class="form-view-subtitle">Imposta i parametri e condividi il codice con i tuoi amici</p>
      </div>

      <form id="create-form">
        <div class="form-group">
          <label class="form-label" for="input-nome">Il tuo nome</label>
          <input class="form-input" type="text" id="input-nome" name="nome" required minlength="1" maxlength="20" placeholder="Es. Mario" value="${escapeAttr(DEFAULT_NAME)}" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="form-label" for="input-max">Numero massimo giocatori</label>
          <select class="form-select" id="input-max" name="maxPlayers">
            <option value="2">2 giocatori</option>
            <option value="3">3 giocatori</option>
            <option value="4" selected>4 giocatori</option>
            <option value="6">6 giocatori</option>
            <option value="8">8 giocatori</option>
          </select>
          <p class="form-help">Inclusi tu. Servono almeno 2 per iniziare.</p>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="input-turni">Secondi per turno</label>
            <select class="form-select" id="input-turni" name="turnSeconds">
              <option value="15">15s</option>
              <option value="30" selected>30s</option>
              <option value="45">45s</option>
              <option value="60">60s</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="input-vittorie">Partite per vincere</label>
            <select class="form-select" id="input-vittorie" name="gamesToWin">
              <option value="1" selected>1 (veloce)</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="input-lung">Lunghezza parola iniziale</label>
          <select class="form-select" id="input-lung" name="initialLength">
            <option value="5-6" selected>5-6 lettere (media)</option>
            <option value="5-8">5-8 lettere (variabile)</option>
            <option value="6-8">6-8 lettere (difficile)</option>
          </select>
        </div>

        <div id="create-error" class="alert alert-error" style="display: none;"></div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-block" id="btn-submit-create">🎮 Crea partita</button>
          <button type="button" class="btn btn-ghost btn-block" id="btn-back">← Torna alla home</button>
        </div>
      </form>
    </div>
  `;
}

export function attachCreateHandlers() {
  const form = document.getElementById('create-form');
  const errorBox = document.getElementById('create-error');
  const submitBtn = document.getElementById('btn-submit-create');
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
      maxPlayers: parseInt(document.getElementById('input-max').value, 10),
      turnSeconds: parseInt(document.getElementById('input-turni').value, 10),
      gamesToWin: parseInt(document.getElementById('input-vittorie').value, 10),
      initialLengthMin: 5,
      initialLengthMax: 6,
    };
    const lung = document.getElementById('input-lung').value;
    if (lung === '5-8') { data.initialLengthMax = 8; }
    if (lung === '6-8') { data.initialLengthMin = 6; data.initialLengthMax = 8; }

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Creazione...';

    emit('create_game', data, (resp) => {
      submitBtn.disabled = false;
      submitBtn.textContent = '🎮 Crea partita';

      if (!resp || !resp.ok) {
        const msg = resp?.errore || 'errore_sconosciuto';
        const msgIta = {
          'creator_non_valido': 'Nome non valido',
          'max_players_non_valido': 'Numero giocatori non valido',
          'turn_seconds_non_valido': 'Secondi per turno non validi',
          'gia_in_partita': 'Sei già in un\'altra partita',
        }[msg] || `Errore: ${msg}`;
        errorBox.textContent = msgIta;
        errorBox.style.display = 'block';
        return;
      }

      // Salva nome in localStorage
      localStorage.setItem('pm-nome', data.nome);

      // Naviga alla lobby della partita appena creata
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
