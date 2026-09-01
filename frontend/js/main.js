/**
 * main.js — Entry point del frontend
 *
 * Bootstrap: state, socket, audio, router, view rendering.
 * Re-render reattivo su cambi di state E di route.
 *
 * **M5-bugfix**: al boot, se c'è un gameId in localStorage, tenta di
 * ripristinare la partita. M5-bugfix2: aspetta connessione socket
 * PRIMA di chiamare request_state, mostra overlay "Caricamento...",
 * alert chiaro se la partita non esiste più.
 */

import { state } from './state.js';
import { connect as socketConnect, on as socketOn, onReconnect, emit, getSocket } from './socket.js';
import { click as audioClick, beep, tick as audioTick } from './audio.js';
import { healthCheck } from './api.js';
import { route, start as routerStart, onRouteChange, navigate } from './router.js';

import { renderHome, attachHomeHandlers } from './views/home.js';
import { renderCreate, attachCreateHandlers } from './views/create.js';
import { renderJoin, attachJoinHandlers } from './views/join.js';
import { renderLobby, attachLobbyHandlers } from './views/lobby.js';
import { renderGame, attachGameHandlers } from './views/game.js';
import { renderEnd, attachEndHandlers } from './views/end.js';
import { renderFeedback, attachFeedbackHandlers } from './views/feedback.js';

console.log('[main] Parole Mutanti frontend avviato');

const app = document.getElementById('app');

/* ============================================================
   Header: status dot, theme toggle, sound toggle
   ============================================================ */
const statusDot = document.getElementById('connection-status');
function refreshStatusDot(connessione) {
  if (!statusDot) return;
  statusDot.classList.remove('status-offline', 'status-connecting', 'status-online');
  statusDot.classList.add(`status-${connessione}`);
  statusDot.title = {
    offline: 'Disconnesso dal server',
    connecting: 'Connessione in corso…',
    online: 'Connesso',
  }[connessione] || '';
}

const themeToggle = document.getElementById('theme-toggle');
const SOUND_KEY = 'pm-audio';
const THEME_KEY = 'pm-tema';

function refreshThemeIcon() {
  if (!themeToggle) return;
  themeToggle.textContent = state.get().tema === 'dark' ? '🌙' : '☀️';
}

function toggleTheme() {
  audioClick();
  const nuovoTema = state.get().tema === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nuovoTema);
  localStorage.setItem(THEME_KEY, nuovoTema);
  state.update({ tema: nuovoTema });
}

if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
document.documentElement.setAttribute('data-theme', state.get().tema);
refreshThemeIcon();

const soundToggle = document.getElementById('sound-toggle');
function refreshSoundIcon() {
  if (!soundToggle) return;
  soundToggle.textContent = state.get().audioAbilitato ? '🔊' : '🔇';
}

function toggleSound() {
  const nuovo = !state.get().audioAbilitato;
  localStorage.setItem(SOUND_KEY, nuovo ? 'on' : 'off');
  state.update({ audioAbilitato: nuovo });
  if (nuovo) setTimeout(() => beep(880, 100), 50);
}

if (soundToggle) soundToggle.addEventListener('click', toggleSound);
refreshSoundIcon();

// ============================================================
// Aggiornamento reattivo icona header + badge home su cambio stato
// (connessione, tema, audio). Prima icona suono/tema e badge home non si
// aggiornavano finché non cambiava rotta (stato smarrito nel toggle).
// ============================================================
function aggiornaBadgeHome(stato) {
  if (!window.location.hash.startsWith('#home')) return;
  const elConn = document.getElementById('stato-connessione');
  const elTema = document.getElementById('stato-tema');
  const elAudio = document.getElementById('stato-audio');
  if (elConn) {
    elConn.className = `badge ${stato.connessione === 'online' ? 'badge-success' : stato.connessione === 'connecting' ? 'badge-warn' : 'badge-error'}`;
    elConn.textContent = stato.connessione;
  }
  if (elTema) {
    elTema.textContent = stato.tema;
  }
  if (elAudio) {
    elAudio.className = `badge ${stato.audioAbilitato ? 'badge-success' : 'badge-muted'}`;
    elAudio.textContent = stato.audioAbilitato ? 'on' : 'off';
  }
}

state.subscribe((stato) => {
  refreshStatusDot(stato.connessione);
  refreshThemeIcon();
  refreshSoundIcon();
  aggiornaBadgeHome(stato);
});

/* ============================================================
   Router
   ============================================================ */
route('#home', renderHome);
route('#create', renderCreate);
route('#join', renderJoin);
route('#lobby', renderLobby);
route('#game', renderGame);
route('#end', renderEnd);
route('#feedback', renderFeedback);

let currentTickSecond = -1;

onRouteChange((renderFn, params) => {
  app.innerHTML = renderFn(params);
  refreshStatusDot(state.get().connessione);
  refreshThemeIcon();
  refreshSoundIcon();

  const routeCorrente = location.hash.split('?')[0] || '#home';
  switch (routeCorrente) {
    case '#home': attachHomeHandlers(); break;
    case '#create': attachCreateHandlers(); break;
    case '#join': attachJoinHandlers(); break;
    case '#lobby': attachLobbyHandlers(); break;
    case '#game': attachGameHandlers(); break;
    case '#end': attachEndHandlers(); break;
    case '#feedback': attachFeedbackHandlers(); break;
  }
});

/* ============================================================
   Overlay "Caricamento partita..."
   ============================================================ */
function mostraOverlay(testo) {
  let ov = document.getElementById('pm-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'pm-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
    ov.innerHTML = `<div style="background:var(--bg-elevated);padding:2rem;border-radius:12px;text-align:center;"><div class="loading">${testo}</div></div>`;
    document.body.appendChild(ov);
  } else {
    ov.querySelector('.loading').textContent = testo;
  }
  ov.style.display = 'flex';
}

function nascondiOverlay() {
  const ov = document.getElementById('pm-overlay');
  if (ov) ov.style.display = 'none';
}

/* ============================================================
   Socket events → state + re-render
   ============================================================ */
socketOn('lobby_updated', (data) => {
  if (data.gameId === state.get().gameId) {
    state.update({ partita: { ...state.get().partita, ...data } });
    if (location.hash.startsWith('#lobby')) navigate('#lobby');
  }
});

// Timer partenza lobby: aggiorna il countdown visibile in lobby
socketOn('lobby_timer', (data) => {
  if (data.gameId === state.get().gameId) {
    state.update({ partita: { ...state.get().partita, lobbyTimerTimeLeft: data.timeLeft, lobbyTimerTot: data.tot } });
    if (location.hash.startsWith('#lobby')) navigate('#lobby');
  }
});

// Allo scadere del timer, chi NON era pronto viene espulso e torna alla home
socketOn('giocatore_espulso', (data) => {
  if (data.gameId !== state.get().gameId) return;
  const mioNome = localStorage.getItem('pm-nome') || '';
  if (data.nome === mioNome) {
    alert('Non eri pronto: sei stato escluso dalla lobby.');
    localStorage.removeItem('pm-gameId');
    state.update({ gameId: null, partita: null });
    navigate('#home');
  }
});

socketOn('partita_avviata', (data) => {
  console.log('[main] partita_avviata', data);
  state.update({ partita: { ...data, state: 'running' } });
  nascondiOverlay();
  navigate(`#game?gameId=${data.gameId}`);
});

socketOn('turn_update', (data) => {
  if (data.gameId === state.get().gameId) {
    state.update({ partita: { ...state.get().partita, ...data } });
    if (location.hash.startsWith('#game')) navigate('#game');
  }
});

socketOn('tick', (data) => {
  const timerText = document.getElementById('timer-text');
  const timerCircle = document.getElementById('timer-circle');
  if (timerText && data.gameId === state.get().gameId) {
    timerText.textContent = data.timeLeft;
    if (timerCircle) {
      timerCircle.classList.remove('timer-circle-warning', 'timer-circle-danger');
      if (data.timeLeft <= 5) timerCircle.classList.add('timer-circle-danger');
      else if (data.timeLeft <= 10) timerCircle.classList.add('timer-circle-warning');
    }
    if (data.timeLeft !== currentTickSecond && data.timeLeft > 0 && data.timeLeft <= 10) {
      audioTick();
      currentTickSecond = data.timeLeft;
    }
  }
});

// M5b: nuovo round → re-render per aggiornare giocatore corrente
socketOn('round_start', (data) => {
  if (data.gameId === state.get().gameId) {
    const partita = state.get().partita || {};
    const stato = data.stato || {};
    state.update({
      partita: {
        ...partita,
        giocatore: stato.giocatore,
        currentWord: stato.currentWord,
        timeLeft: stato.timeLeft,
        round: stato.round,
        turno: stato.turno,
        rounds: stato.rounds,
        giocatori: stato.giocatori || partita.giocatori,
        history: stato.history || partita.history,
      }
    });
    currentTickSecond = -1;
    if (location.hash.startsWith('#game')) navigate('#game');
  }
});

// M5b: pareggio → re-render (banner + nuova parola)
socketOn('pareggio', (data) => {
  if (data.gameId === state.get().gameId) {
    const partita = state.get().partita || {};
    state.update({
      partita: {
        ...partita,
        currentWord: data.parola,
      }
    });
    if (location.hash.startsWith('#game')) navigate('#game');
  }
});

socketOn('beep', () => audioTick());

socketOn('mossa_rifiutata', (data) => {
  const errorBox = document.getElementById('submit-error');
  if (errorBox) {
    errorBox.textContent = data.messaggio || 'Mossa rifiutata';
    errorBox.style.display = 'block';
    setTimeout(() => { errorBox.style.display = 'none'; }, 4000);
  }
  // Best-of-N: aggiorna i tentativi rimasti della mano corrente.
  const tentativiInfo = document.getElementById('tentativi-info');
  if (tentativiInfo && typeof data.tentativi === 'number') {
    tentativiInfo.textContent = `${Math.max(0, (data.maxTentativi ?? 3) - data.tentativi)} tentativi rimasti`;
  }
});

socketOn('giocatore_eliminato', (data) => {
  if (data.gameId === state.get().gameId) {
    state.update({ partita: { ...state.get().partita, giocatori: data.giocatoriRimanenti } });
    if (location.hash.startsWith('#game')) navigate('#game');
  }
});

// Best-of-N: fine manche → aggiorna punteggio (banner re-render)
socketOn('manche_finita', (data) => {
  if (data.gameId === state.get().gameId) {
    state.update({ partita: { ...state.get().partita, punteggio: data.punteggio, manche: data.manche } });
    if (location.hash.startsWith('#game')) navigate('#game');
  }
});

// Best-of-N: nuova manche → aggiorna parola/punteggio/giocatori
socketOn('manche_start', (data) => {
  if (data.gameId === state.get().gameId) {
    state.update({ partita: { ...state.get().partita, ...data, state: 'running' } });
    if (location.hash.startsWith('#game')) navigate('#game');
  }
});

socketOn('punteggio_aggiornato', (data) => {
  if (data.gameId === state.get().gameId) {
    state.update({ partita: { ...state.get().partita, punteggio: data.punteggio, manche: data.manche } });
    if (location.hash.startsWith('#game')) navigate('#game');
  }
});

socketOn('game_over', (data) => {
  // M5: naviga alla end view con i dati della partita (niente alert)
  state.update({ partita: { ...data, state: 'finished' }, gameId: data.gameId });
  navigate('#end');
});

socketOn('partita_cancellata', () => {
  alert('La partita è stata cancellata');
  state.update({ gameId: null, partita: null });
  navigate('#home');
});

/* ============================================================
   Riconnessione socket: ri-sincronizza lo stato della partita
   Dopo uno standby/disconnessione il client si riconnette con un nuovo
   socket.id: va ri-registrato nella room e allineato allo stato reale
   tramite request_state (che il server usa per ri-agganciare il socket).
   ============================================================ */
onReconnect(() => {
  const gid = state.get().gameId || localStorage.getItem('pm-gameId');
  if (!gid) return;
  console.log('[main] riconnesso, ri-sincronizzo partita:', gid);
  emit('request_state', { gameId: gid, nome: localStorage.getItem('pm-nome') || '' }, (resp) => {
    if (!resp || !resp.ok || !resp.stato) {
      // Partita non più recuperabile (es. rimossa dallo sweeper) → pulisci e vai a home
      localStorage.removeItem('pm-gameId');
      state.update({ gameId: null, partita: null });
      navigate('#home');
      return;
    }
    state.update({ gameId: gid, partita: resp.stato });
    navigate(resp.stato.state === 'running' ? `#game?gameId=${gid}` : `#lobby?gameId=${gid}`);
  });
});

/* ============================================================
   Ripristino partita al boot (M5-bugfix2)
   ============================================================ */
async function tentaRipristinoPartita() {
  const gameIdSalvato = localStorage.getItem('pm-gameId');
  if (!gameIdSalvato) return false;

  const nomeSalvato = localStorage.getItem('pm-nome') || '';
  console.log('[main] tentativo ripristino partita:', gameIdSalvato);

  // Aspetta connessione socket PRIMA di chiamare request_state
  const sock = getSocket();
  if (!sock || !sock.connected) {
    console.log('[main] socket non connesso, attendo...');
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const s = getSocket();
        if (s && s.connected) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 200);
      setTimeout(() => { clearInterval(checkInterval); resolve(); }, 3000);
    });
  }

  mostraOverlay('Ripristino partita in corso…');

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('[main] timeout ripristino partita');
      nascondiOverlay();
      alert('Connessione lenta, riprova più tardi');
      localStorage.removeItem('pm-gameId');
      state.update({ gameId: null, partita: null });
      routerStart();
      resolve(false);
    }, 5000);

    emit('request_state', { gameId: gameIdSalvato, nome: nomeSalvato }, (resp) => {
      clearTimeout(timeout);
      nascondiOverlay();
      if (!resp || !resp.ok || !resp.stato) {
        console.log('[main] partita non recuperabile:', resp?.errore || 'risposta vuota');
        // M5-bugfix2: alert chiaro + pulizia + vai a home
        alert(`La partita ${gameIdSalvato.slice(0, 8)}… non esiste più sul server.\nVerrai reindirizzato alla home.`);
        localStorage.removeItem('pm-gameId');
        state.update({ gameId: null, partita: null });
        navigate('#home');
        resolve(false);
        return;
      }
      console.log('[main] partita recuperata:', resp);
      state.update({ gameId: gameIdSalvato, partita: resp.stato });
      if (resp.stato.state === 'running') {
        navigate(`#game?gameId=${gameIdSalvato}`);
      } else {
        navigate(`#lobby?gameId=${gameIdSalvato}`);
      }
      resolve(true);
    });
  });
}

/* ============================================================
   Bootstrap
   ============================================================ */
(async () => {
  const health = await healthCheck();
  console.log('[main] health:', health.ok ? 'OK' : 'KO', health.db || '');

  socketConnect();

  // M5-bugfix2: aspetta connessione prima di qualsiasi cosa
  await new Promise((resolve) => {
    const sock = getSocket();
    if (sock && sock.connected) return resolve();
    const interval = setInterval(() => {
      const s = getSocket();
      if (s && s.connected) {
        clearInterval(interval);
        resolve();
      }
    }, 200);
    setTimeout(() => { clearInterval(interval); resolve(); }, 3000);
  });

  // Prova a ripristinare una partita precedente
  const ripristinata = await tentaRipristinoPartita();
  if (!ripristinata) {
    routerStart();
  }
})();
