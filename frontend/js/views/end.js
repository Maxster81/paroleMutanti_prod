/**
 * views/end.js — End view (fine partita)
 *
 * Mostra: vincitore, durata, turni, validazioni AI usate, e pulsanti
 * per giocare ancora o tornare alla home.
 *
 * **M5**: nuova schermata di fine partita al posto dell'alert.
 *
 * @module frontend/js/views/end
 */

import { navigate } from '../router.js';
import { state } from '../state.js';
import { success } from '../audio.js';

export function renderEnd(params = {}) {
  const s = state.get();
  const partita = s.partita;

  if (!partita || partita.state !== 'finished') {
    return `
      <div class="form-view">
        <div class="alert alert-error">Nessuna partita terminata.</div>
        <button class="btn btn-secondary btn-block" id="btn-end-home">← Torna alla home</button>
      </div>
    `;
  }

  const vincitore = partita.vincitore || '?';
  const durataSec = partita.durataMs ? (partita.durataMs / 1000).toFixed(1) : '—';
  const turni = partita.history ? partita.history.length : 0;
  const aiCount = partita.aiValidationsCount ?? 0;
  const punteggio = partita.punteggio || {};
  const manche = partita.manche ?? (partita.mancheCorrente ?? 1);
  const gamesToWin = partita.gamesToWin ?? 1;

  // Jingle di vittoria quando compare la schermata
  setTimeout(() => success(), 300);

  return `
    <div class="end-view">
      <div class="end-trophy">🏆</div>
      <h1 class="end-title">Vince ${escapeHtml(vincitore)}!</h1>
      <p class="end-subtitle text-muted">Partita conclusa</p>

      <p class="text-small text-dim" style="margin-top: 8px;">
        🏅 ${Object.entries(punteggio).length
          ? Object.entries(punteggio).map(([n, v]) => `${escapeHtml(n)}: ${v}`).join(' · ')
          : `<strong>${escapeHtml(vincitore)}</strong> ha vinto la partita`}
      </p>

      <div class="card end-stats">
        <div class="end-stat">
          <div class="end-stat-value">${manche}/${gamesToWin}</div>
          <div class="end-stat-label">Manche</div>
        </div>
        <div class="end-stat">
          <div class="end-stat-value">${durataSec}s</div>
          <div class="end-stat-label">Durata</div>
        </div>
        <div class="end-stat">
          <div class="end-stat-value">${turni}</div>
          <div class="end-stat-label">Turni</div>
        </div>
        <div class="end-stat">
          <div class="end-stat-value">${aiCount}</div>
          <div class="end-stat-label">Verifiche AI</div>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary btn-block" id="btn-end-new">🔄 Nuova partita</button>
        <button class="btn btn-ghost btn-block" id="btn-end-home">← Torna alla home</button>
      </div>
    </div>
  `;
}

export function attachEndHandlers() {
  document.getElementById('btn-end-new')?.addEventListener('click', () => {
    state.update({ gameId: null, partita: null });
    navigate('#create');
  });
  document.getElementById('btn-end-home')?.addEventListener('click', () => {
    state.update({ gameId: null, partita: null });
    navigate('#home');
  });
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;'
  }[c]));
}
