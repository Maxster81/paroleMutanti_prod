/**
 * views/home.js — Home view
 *
 * Mostra: 2 azioni principali (Crea / Unisciti) + lista partite aperte
 * visibile di default, auto-aggiornata con polling leggero (5s).
 *
 * Il polling parte quando la home viene renderizzata e si ferma quando
 * si lascia la home (guardia su location.hash), per non sprecare chiamate.
 *
 * @module frontend/js/views/home
 */

import { navigate } from '../router.js';
import { state } from '../state.js';
import { emit } from '../socket.js';

const POLL_INTERVAL_MS = 5000;
let homePollTimer = null;

export function renderHome(params = {}) {
  const s = state.get();
  return `
    <div class="home-view">
      <div class="home-hero">🎮 Parole Mutanti</div>

      <div class="card home-guide-card">
        <div class="home-guide-title">📖 Come si gioca</div>
        <ul class="home-guide-list">
          <li>Da <strong>2 a 8 giocatori</strong>, nessun account: scegli un nome e crea (o unisciti a) una partita.</li>
          <li>Viene scelta una <strong>parola iniziale</strong> (5-8 lettere).</li>
          <li>A ogni turno modifichi la parola precedente con <strong>una sola mossa</strong>: cambia 1 lettera, aggiungi 1 lettera oppure rimuovi 1 lettera.</li>
          <li>La parola deve essere <strong>italiana</strong> (validata da dizionario, con supporto AI).</li>
          <li>Hai <strong>15-60 secondi</strong> a turno (configurabile): se non rispondi o sbagli, vieni eliminato.</li>
          <li><strong>Vince l'ultimo che resta in gioco!</strong> 🏆</li>
        </ul>
      </div>

      <div class="home-actions">
        <button class="btn btn-primary btn-block" id="btn-create">📝 Crea partita</button>
        <button class="btn btn-secondary btn-block" id="btn-join">🔑 Unisciti con codice</button>
      </div>

      <div class="card home-list-card">
        <div class="home-list-header">
          <span class="home-list-title">Partite aperte</span>
          <span class="home-list-meta" id="home-list-refresh">—</span>
        </div>
        <div id="games-list" class="home-list-body">
          <div class="loading">Caricamento…</div>
        </div>
      </div>

      <p class="text-muted text-small">
        Stato:
        <span class="badge ${s.connessione === 'online' ? 'badge-success' : s.connessione === 'connecting' ? 'badge-warn' : 'badge-error'}">${s.connessione}</span>
        · <span class="badge badge-muted">${s.tema}</span>
        · audio <span class="badge ${s.audioAbilitato ? 'badge-success' : 'badge-muted'}">${s.audioAbilitato ? 'on' : 'off'}</span>
      </p>
    </div>
  `;
}

/**
 * Attacca gli event listener dopo che la view è stata renderizzata.
 */
export function attachHomeHandlers() {
  document.getElementById('btn-create')?.addEventListener('click', () => {
    navigate('#create');
  });
  document.getElementById('btn-join')?.addEventListener('click', () => {
    navigate('#join');
  });

  // Carica subito la lista
  caricaListaPartite();

  // Avvia polling leggero (si auto-ferma quando si lascia la home)
  avviaPolling();
}

/**
 * Avvia (o riavvia) il polling della lista partite aperte.
 * Il timer si ferma da solo quando la home non è più la view corrente.
 */
function avviaPolling() {
  fermaPolling();
  homePollTimer = setInterval(() => {
    // Guardia: se non siamo più sulla home, ferma il polling
    if (!window.location.hash.startsWith('#home')) {
      fermaPolling();
      return;
    }
    if (state.get().connessione !== 'online') {
      aggiornaMetaPolling('offline');
      return;
    }
    caricaListaPartite();
  }, POLL_INTERVAL_MS);
}

function fermaPolling() {
  if (homePollTimer) {
    clearInterval(homePollTimer);
    homePollTimer = null;
  }
}

/**
 * Aggiorna il piccolo testo "aggiornato alle HH:MM:SS".
 */
function aggiornaMetaPolling(testo) {
  const el = document.getElementById('home-list-refresh');
  if (el) el.textContent = testo;
}

/**
 * Carica e renderizza la lista delle partite aperte.
 */
function caricaListaPartite() {
  const container = document.getElementById('games-list');
  if (!container) return;

  const connessione = state.get().connessione;
  if (connessione !== 'online') {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📡</div>Connessione in corso…</div>';
    aggiornaMetaPolling('offline');
    return;
  }

  emit('list_games', {}, (resp) => {
    if (!resp || !resp.ok) {
      container.innerHTML = '<div class="alert alert-error">Impossibile caricare la lista</div>';
      aggiornaMetaPolling('errore');
      return;
    }
    if (!resp.partite || resp.partite.length === 0) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">🎲</div>Nessuna partita aperta. Sii il primo a crearne una!</div>';
      aggiornaMetaPolling('aggiornato');
      return;
    }

    container.innerHTML = resp.partite.map(p => `
      <div class="player-card home-list-item">
        <div>
          <div class="player-name">${escapeHtml(p.creator)}</div>
          <div class="text-small text-dim">${p.giocatori.length}/${p.params.max_players} giocatori · ${p.params.turn_seconds}s/turno</div>
        </div>
        <button class="btn btn-sm btn-secondary btn-join-game" data-game-id="${p.id}">Unisciti</button>
      </div>
    `).join('');

    // Attach handlers sui pulsanti "Unisciti"
    container.querySelectorAll('.btn-join-game').forEach(btn => {
      btn.addEventListener('click', () => {
        const gameId = btn.dataset.gameId;
        navigate(`#join?gameId=${gameId}`);
      });
    });

    aggiornaMetaPolling(`aggiornato ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
  });
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;'
  }[c]));
}