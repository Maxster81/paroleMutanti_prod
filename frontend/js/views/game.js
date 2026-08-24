/**
 * views/game.js — Game view (M5 full)
 *
 * Mostra: timer circle, parola corrente, input submit, history mosse,
 * lista giocatori rimasti, pulsanti passa/abbandona.
 * Mostra "Verifica in corso…" durante la validazione AI (turn_paused).
 *
 * **M5**: feedback AI + lista giocatori + eliminazioni in tempo reale.
 *
 * @module frontend/js/views/game
 */

import { navigate } from '../router.js';
import { state } from '../state.js';
import { emit, on as socketOn } from '../socket.js';
import { click as audioClick, tick as audioTick, buzzer, success, beep } from '../audio.js';

let lastBeepSecond = -1;
let verificaInCorso = false;

export function renderGame(params = {}) {
  const s = state.get();
  const partita = s.partita;

  if (!partita || partita.state !== 'running') {
    return `
      <div class="form-view">
        <div class="alert alert-error">Nessuna partita in corso.</div>
        <button class="btn btn-secondary btn-block" id="btn-back-lobby">← Torna alla lobby</button>
      </div>
    `;
  }

  // M5-bugfix: currentWord è l'ultima parola valida, NON la iniziale
  const word = partita.currentWord || partita.parolaIniziale || '?';
  const giocatore = partita.giocatore || partita.giocatoreCorrente || '?';
  const timeLeft = partita.timeLeft ?? 30;
  // M5c: elenco completo delle parole già usate (catena, in ordine)
  const paroleScritte = partita.history || [];

  const timerClass = timeLeft <= 5 ? 'timer-circle-danger' :
                     timeLeft <= 10 ? 'timer-circle-warning' : '';

  const mioNome = localStorage.getItem('pm-nome') || '';
  const ioSonoTurnista = giocatore === mioNome;

  // Lista giocatori rimasti (quella dal server, se presente; altrimenti da partita.giocatori)
  const giocatoriRimasti = partita.giocatori || [];

  return `
    <div class="form-view game-view" style="text-align: center;">
      <div class="turno-counter" id="turno-counter" style="font-size: 0.95rem; font-weight: 700; color: var(--primary); margin-bottom: var(--spacing-sm); text-transform: uppercase; letter-spacing: 0.5px;">
        TURNO ${partita.turno ?? 1} · Round ${partita.round ?? 1}/${partita.roundsTotali ?? (partita.giocatori?.length ?? 1)}
      </div>
      <div class="timer-circle ${timerClass}" id="timer-circle">
        <div class="timer-text" id="timer-text">${timeLeft}</div>
      </div>
      <p class="text-small text-dim">secondi</p>

      <div class="card" style="margin-top: var(--spacing-lg); text-align: left;">
        <div class="text-small text-dim">Parola corrente (l'ultima valida)</div>
        <div style="font-size: 2rem; font-weight: 700; color: var(--primary); margin: var(--spacing-sm) 0;">
          ${escapeHtml(word)}
        </div>
        <div class="text-small">
          Tocca a: <strong>${escapeHtml(giocatore)}</strong>
          ${ioSonoTurnista ? '<span class="badge badge-success">TU!</span>' : ''}
        </div>
      </div>

      ${ioSonoTurnista ? `
        <form id="submit-form" style="margin-top: var(--spacing-md);">
          <div class="form-group">
            <input class="form-input" type="text" id="input-parola" placeholder="La tua parola (a distanza 1)" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" autofocus>
          </div>
          <div id="submit-error" class="alert alert-error" style="display: none;"></div>
          <div id="submit-info" class="alert alert-info" style="display: none;"></div>
          <div id="verifica-box" class="alert alert-success" style="display: none;">🔎 Verifica in corso…</div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-block" id="btn-submit-word">📤 Invia parola</button>
            <button type="button" class="btn btn-ghost btn-block" id="btn-pass">⏭ Passa il round</button>
          </div>
        </form>
      ` : `
        <div class="alert alert-info" style="margin-top: var(--spacing-md);">
          Aspetta che <strong>${escapeHtml(giocatore)}</strong> faccia la sua mossa.
        </div>
        <button class="btn btn-ghost btn-block" id="btn-leave-game">🚪 Esci (abbandona)</button>
      `}

      ${paroleScritte.length > 0 ? `
        <div class="card" style="margin-top: var(--spacing-md); text-align: left;">
          <div class="text-small text-dim">📜 Parole già scritte</div>
          <div style="max-height: 200px; overflow-y: auto; margin-top: 6px; padding-right: 4px;">
            ${[...paroleScritte].reverse().map((h, j) => {
              // Inversione: la più recente in cima, ma numerazione ASSOLUTA
              // (1 = prima parola, ultimo numero = totale della catena).
              const i = paroleScritte.length - 1 - j;
              const sistemica = h.giocatore === '(iniziale)' || h.giocatore === '(pareggio)';
              return `
                <div class="text-small" style="margin-top: 4px;${sistemica ? ' opacity: 0.55;' : ''}">
                  <span class="text-dim">${i + 1}.</span> <strong>${escapeHtml(h.parola)}</strong>${h.giocatore ? ` <span class="text-dim">· ${escapeHtml(h.giocatore)}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${giocatoriRimasti.length > 0 ? `
        <div class="card" style="margin-top: var(--spacing-md); text-align: left;">
          <div class="text-small text-dim">Giocatori rimasti</div>
          ${giocatoriRimasti.map(g => `
            <div class="text-small" style="margin-top: 4px;">
              <span class="${g === mioNome ? 'badge badge-success' : ''}">${escapeHtml(g)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

export function attachGameHandlers() {
  document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
    navigate('#lobby');
  });

  const form = document.getElementById('submit-form');
  const errorBox = document.getElementById('submit-error');
  const infoBox = document.getElementById('submit-info');
  const verificaBox = document.getElementById('verifica-box');
  const submitBtn = document.getElementById('btn-submit-word');

  if (form) {
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      audioClick();
      const parola = document.getElementById('input-parola').value.trim();
      if (!parola) {
        if (errorBox) {
          errorBox.textContent = 'Inserisci una parola';
          errorBox.style.display = 'block';
        }
        return;
      }
      if (errorBox) errorBox.style.display = 'none';
      if (infoBox) infoBox.style.display = 'none';

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Invio...';

      const partita = state.get().partita;
      emit('submit_word', {
        gameId: partita.gameId || partita.id,
        nome: localStorage.getItem('pm-nome') || '',
        parola,
      }, (resp) => {
        submitBtn.disabled = false;
        submitBtn.textContent = '📤 Invia parola';
        if (verificaBox) verificaBox.style.display = 'none';
        verificaInCorso = false;

        if (!resp || !resp.ok) {
          if (errorBox) {
            errorBox.textContent = resp?.messaggio || 'Errore sconosciuto';
            errorBox.style.display = 'block';
          }
          buzzer();
          return;
        }
        if (resp.valida) {
          success();
          // Il round può essere già avanzato (re-render che rimuove il form):
          // l'input potrebbe non esistere più → svuotarlo solo se presente.
          const inputParola = document.getElementById('input-parola');
          if (inputParola) inputParola.value = '';
          lastBeepSecond = -1;
        } else {
          if (errorBox) {
            errorBox.textContent = resp.messaggio || 'Mossa rifiutata';
            errorBox.style.display = 'block';
          }
          buzzer();
        }
      });
    });
  }

  document.getElementById('btn-pass')?.addEventListener('click', () => {
    audioClick();
    const partita = state.get().partita;
    emit('pass_turn', {
      gameId: partita.gameId || partita.id,
      nome: localStorage.getItem('pm-nome') || '',
    });
  });

  document.getElementById('btn-leave-game')?.addEventListener('click', () => {
    if (confirm('Vuoi abbandonare la partita?')) {
      const partita = state.get().partita;
      emit('leave_game', { nome: localStorage.getItem('pm-nome') || '' });
      state.update({ gameId: null, partita: null });
      navigate('#home');
    }
  });
}

// Listener per la validazione AI (mostra "Verifica in corso…")
socketOn('turn_paused', (data) => {
  if (data.gameId === state.get().gameId) {
    verificaInCorso = true;
    const box = document.getElementById('verifica-box');
    const submitBtn = document.getElementById('btn-submit-word');
    if (box) {
      box.textContent = '🔎 Verifica in corso…';
      box.style.display = 'block';
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Verifica…';
    }
  }
});

socketOn('turn_resumed', (data) => {
  if (data.gameId === state.get().gameId) {
    verificaInCorso = false;
    const box = document.getElementById('verifica-box');
    const submitBtn = document.getElementById('btn-submit-word');
    if (box) box.style.display = 'none';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '📤 Invia parola';
    }
  }
});

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;'
  }[c]));
}