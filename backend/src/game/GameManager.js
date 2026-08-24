/**
 * GameManager.js — Gestione stato partite in RAM
 *
 * Singleton che tiene traccia di tutte le partite attive in memoria.
 * Ogni partita è identificata da un gameId (UUID).
 *
 * M5-bugfix2: include sweeper automatico per partite abbandonate:
 * - waiting >5min → cancellata
 * - running con 0 socket >2min → cancellata
 * - finished >1min → rimossa
 *
 * @module backend/src/game/GameManager
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { scegliParolaIniziale } from './WordPicker.js';
import { validaMossa } from './Validator.js';
import { TurnManager } from './TurnManager.js';
import { normalizzaBase } from '../utils/normalizza.js';

// Intervalli sweeper (ms)
const TIMEOUT_WAITING_MS = 5 * 60 * 1000;       // 5 min
const TIMEOUT_RUNNING_SOLO_MS = 2 * 60 * 1000;   // 2 min
const TIMEOUT_FINISHED_MS = 60 * 1000;             // 1 min
const SWEEPER_INTERVAL_MS = 60 * 1000;             // ogni 1 min

export class GameManager extends EventEmitter {
  constructor() {
    super();
    this.partite = new Map();
    // Traccia socket connessi per partita (per sweeper "running con 0 socket")
    this.socketsPerPartita = new Map(); // gameId → Set<socketId>

    // Sweeper automatico
    this.sweeperInterval = setInterval(() => this._sweepAbbandonate(), SWEEPER_INTERVAL_MS);
    this.sweeperInterval.unref(); // non blocca shutdown
  }

  // ============================================================
  // CRUD Partite
  // ============================================================

  async creaPartita(opzioni) {
    const {
      creator,
      maxPlayers = config.game.maxPlayers,
      turnSeconds = config.game.defaultTurnSeconds,
      gamesToWin = config.game.defaultGamesToWin,
      initialLengthMin = config.game.initialWordMinLength,
      initialLengthMax = config.game.initialWordMaxLength,
    } = opzioni;

    if (!creator || typeof creator !== 'string' || creator.trim().length < 1) {
      return { ok: false, errore: 'creator_non_valido' };
    }
    if (maxPlayers < config.game.minPlayers || maxPlayers > config.game.maxPlayers) {
      return { ok: false, errore: 'max_players_non_valido' };
    }
    if (turnSeconds < 5 || turnSeconds > 60) {
      return { ok: false, errore: 'turn_seconds_non_valido' };
    }
    // F4: validazione server-side anche per gli altri parametri (non solo
    // maxPlayers/turnSeconds), così un client non può forzare valori fuori range.
    if (gamesToWin < 1 || gamesToWin > 4) {
      return { ok: false, errore: 'games_to_win_non_valido' };
    }
    if (initialLengthMin < 3 || initialLengthMax > 10 || initialLengthMin > initialLengthMax) {
      return { ok: false, errore: 'initial_length_non_valido' };
    }

    const nome = creator.trim();
    for (const p of this.partite.values()) {
      if (p.state === 'waiting' && p.giocatori.includes(nome)) {
        return { ok: false, errore: 'gia_in_partita', partita: p };
      }
    }

    const id = randomUUID();
    const partita = {
      id,
      creator: nome,
      giocatori: [nome],
      ready: [false],
      state: 'waiting',
      params: { max_players: maxPlayers, turn_seconds: turnSeconds, games_to_win: gamesToWin, initial_length_min: initialLengthMin, initial_length_max: initialLengthMax },
      currentWord: null,
      currentPlayerIndex: 0,
      history: [],
      paroleUsate: new Set(),
      vincitore: null,
      turnManager: null,
      createdAt: new Date(),
      startedAt: null,
      endedAt: null,
      lastActivityAt: new Date(),
      aiValidationsCount: 0,
    };
    this.partite.set(id, partita);
    this.socketsPerPartita.set(id, new Set());
    logger.info('partita_creata', { id, creator: nome, maxPlayers, turnSeconds });
    this.emit('partita_creata', partita);
    return { ok: true, partita };
  }

  uniscitiAPartita(gameId, nome) {
    const partita = this.partite.get(gameId);
    if (!partita) return { ok: false, errore: 'partita_non_trovata' };
    if (partita.state !== 'waiting') return { ok: false, errore: 'partita_gia_iniziata' };
    if (partita.giocatori.length >= partita.params.max_players) return { ok: false, errore: 'partita_piena' };
    if (!nome || typeof nome !== 'string' || nome.trim().length < 1) {
      return { ok: false, errore: 'nome_non_valido' };
    }
    const nomePulito = nome.trim();
    if (partita.giocatori.includes(nomePulito)) {
      return { ok: false, errore: 'nome_gia_usato' };
    }
    partita.giocatori.push(nomePulito);
    partita.ready.push(false);
    partita.lastActivityAt = new Date();
    logger.info('giocatore_aggiunto', { gameId, nome: nomePulito, totale: partita.giocatori.length });
    this.emit('giocatore_aggiunto', partita);
    return { ok: true, partita };
  }

  setReady(gameId, nome, ready) {
    const partita = this.partite.get(gameId);
    if (!partita) return { ok: false, errore: 'partita_non_trovata' };
    if (partita.state !== 'waiting') return { ok: false, errore: 'partita_gia_iniziata' };
    const idx = partita.giocatori.indexOf(nome);
    if (idx === -1) return { ok: false, errore: 'giocatore_non_in_partita' };
    if (typeof ready !== 'boolean') return { ok: false, errore: 'ready_non_valido' };
    partita.ready[idx] = ready;
    partita.lastActivityAt = new Date();
    const tuttiProni = partita.ready.every((r) => r) && partita.giocatori.length >= 2;
    logger.info('ready_aggiornato', { gameId, nome, ready, tuttiProni });
    this.emit('ready_aggiornato', partita);
    return { ok: true, partita, tuttiProni };
  }

  getPartita(gameId) { return this.partite.get(gameId); }

  listaPartiteAperte() {
    return Array.from(this.partite.values()).filter((p) => p.state === 'waiting');
  }

  size() { return this.partite.size; }

  // ============================================================
  // Game Lifecycle
  // ============================================================

  async avviaPartita(gameId) {
    const partita = this.partite.get(gameId);
    if (!partita) return { ok: false, errore: 'partita_non_trovata' };
    if (partita.state !== 'waiting') return { ok: false, errore: 'stato_non_valido' };
    if (partita.giocatori.length < 2) return { ok: false, errore: 'servono_almeno_2_giocatori' };
    if (!partita.ready.every((r) => r)) return { ok: false, errore: 'non_tutti_pronti' };

    try {
      const parolaIniziale = await scegliParolaIniziale(
        partita.params.initial_length_min,
        partita.params.initial_length_max
      );

      partita.state = 'running';
      partita.currentWord = parolaIniziale;
      partita.startedAt = new Date();
      partita.currentPlayerIndex = 0;
      partita.history = [{ parola: parolaIniziale, giocatore: '(iniziale)', turno: 0, timestamp: Date.now() }];
      partita.paroleUsate = new Set([normalizzaBase(parolaIniziale)]);
      partita.lastActivityAt = new Date();

      const turnManager = new TurnManager({
        giocatori: [...partita.giocatori],
        secondiPerTurno: partita.params.turn_seconds,
        parolaIniziale,
        history: partita.history,
        onTimeout: () => this._gestisciTimeoutRound(gameId),
        onTick: (timeLeft, roundIdx) => this.emit('tick', { gameId, timeLeft, turno: turnManager.turno, roundIdx }),
        onFineTurno: () => this._gestisciFineTurno(gameId),
      });

      turnManager.on('round_start', (stato) => this.emit('round_start', { gameId, stato }));
      turnManager.on('round_passato', (data) => this.emit('round_passato', { gameId, ...data }));
      turnManager.on('round_limbo', (data) => this.emit('round_limbo', { gameId, ...data }));
      turnManager.on('turno_finito', (data) => this.emit('turno_finito', { gameId, ...data }));
      turnManager.on('beep', (data) => this.emit('beep', { gameId, ...data }));
      turnManager.on('paused', (data) => this.emit('paused', { gameId, ...data }));
      turnManager.on('resumed', (data) => this.emit('resumed', { gameId, ...data }));

      partita.turnManager = turnManager;
      turnManager.start();

      logger.info('partita_avviata', { gameId, parolaIniziale });
      this.emit('partita_avviata', partita);
      return { ok: true, partita };
    } catch (errore) {
      logger.error('avvio_partita_fallito', { gameId, errore: errore.message });
      return { ok: false, errore: errore.message };
    }
  }

  async submitParola(gameId, nomeGiocatore, parola) {
    const partita = this.partite.get(gameId);
    if (!partita) return { ok: false, valida: false, motivo: 'partita_non_trovata' };
    if (partita.state !== 'running') {
      return { ok: false, valida: false, motivo: 'partita_non_in_corso' };
    }
    if (partita.turnManager.giocatoreCorrente() !== nomeGiocatore) {
      return { ok: false, valida: false, motivo: 'non_sei_di_turno' };
    }

    const risultato = await validaMossa({
      parolaPrecedente: partita.currentWord,
      parolaNuova: parola,
      gameId,
      paroleUsate: partita.paroleUsate,
      lunghezzaMin: 3,
      lunghezzaMax: 10,
    });

    if (risultato.valida) {
      partita.turnManager.submitMossa(risultato.normalizzata, nomeGiocatore, risultato);
      partita.currentWord = risultato.normalizzata;
      partita.paroleUsate.add(risultato.normalizzata);
      partita.history.push({
        parola: risultato.normalizzata,
        giocatore: nomeGiocatore,
        turno: partita.turnManager.turno,
        timestamp: Date.now(),
      });
      partita.lastActivityAt = new Date();
      if (risultato.source === 'AI') partita.aiValidationsCount += 1;
      this.emit('mossa_validata', { gameId, partita, parola: risultato.normalizzata, ai_usata: risultato.ai_usata || false });
      logger.info('mossa_validata', { gameId, giocatore: nomeGiocatore, source: risultato.source, ai_usata: !!risultato.ai_usata });
    } else {
      this.emit('mossa_rifiutata', { gameId, partita, parola, motivo: risultato.motivo });
      logger.info('mossa_rifiutata', { gameId, giocatore: nomeGiocatore, motivo: risultato.motivo });
    }

    return {
      ok: true,
      valida: risultato.valida,
      motivo: risultato.motivo,
      messaggio: risultato.messaggio,
      source: risultato.source,
    };
  }

  passaTurno(gameId, nomeGiocatore) {
    const partita = this.partite.get(gameId);
    if (!partita) return { ok: false, errore: 'partita_non_trovata' };
    if (partita.state !== 'running') return { ok: false, errore: 'partita_non_in_corso' };
    if (partita.turnManager.giocatoreCorrente() !== nomeGiocatore) {
      return { ok: false, errore: 'non_sei_di_turno' };
    }
    partita.turnManager.passaTurno(nomeGiocatore);
    return { ok: true };
  }

  /**
   * Timeout di un singolo round: il TurnManager ha già marcato il giocatore
   * in limbo e incrementato il round. Qui emettiamo l'evento per i client.
   * La valutazione vera (elim/pareggio/vittoria) avviene in _gestisciFineTurno.
   */
  _gestisciTimeoutRound(gameId) {
    const partita = this.partite.get(gameId);
    if (!partita || partita.state !== 'running') return;
    this.emit('turno_scaduto', { gameId, giocatore: partita.turnManager?.giocatoreCorrente() });
  }

  /**
   * Fine turno: applica le regole del modello round/turno/limbo.
   *  - Tutti in limbo → pareggio, nuova parola base, tutti restano in gioco.
   *  - Almeno un passato → i limbo vengono eliminati; se i passati sono 1 solo,
   *    quello vince; altrimenti prosegue con l'ultima parola valida.
   */
  async _gestisciFineTurno(gameId) {
    const partita = this.partite.get(gameId);
    if (!partita || partita.state !== 'running') return;

    const rounds = partita.turnManager.rounds;
    const passati = rounds.filter(r => r.stato === 'passato').map(r => r.giocatore);
    const limbi = rounds.filter(r => r.stato === 'limbo').map(r => r.giocatore);

    // Caso 1: tutti in limbo → pareggio
    if (passati.length === 0) {
      logger.info('pareggio', { gameId, turno: partita.turnManager.turno });
      const nuovaParola = await scegliParolaIniziale(
        partita.params.initial_length_min,
        partita.params.initial_length_max
      );
      this.emit('pareggio', { gameId, turno: partita.turnManager.turno, nuovaParola, parola: nuovaParola });
      partita.turnManager.nuovoTurno(nuovaParola);
      partita.currentWord = nuovaParola;
      partita.paroleUsate.add(normalizzaBase(nuovaParola));
      partita.history.push({
        parola: nuovaParola,
        giocatore: '(pareggio)',
        turno: partita.turnManager.turno,
        timestamp: Date.now(),
      });
      // NB: NON aggiornare lastActivityAt qui: i pareggi automatici (anche con
      // 0 socket) non devono contare come "attività", altrimenti lo sweeper non
      // ripulisce mai una partita orfana bloccata su pareggi infiniti (regola 08).
      // M5b-fix: turn_update con stato CORRETTO (post-pareggio) per allineare
      // anche i client con socket.js "vecchio" (che ascoltano solo turn_update,
      // non round_start/pareggio). Non è "stale": nuova parola e turnista sono già
      // state impostate da nuovoTurno().
      this.emit('turn_update', { gameId, stato: partita.turnManager.statoCorrente() });
      return;
    }

    // Caso 2: almeno un passato → limbo eliminati
    for (const nome of limbi) {
      const idx = partita.giocatori.indexOf(nome);
      if (idx === -1) continue;
      partita.giocatori.splice(idx, 1);
      if (partita.turnManager) partita.turnManager.giocatori.splice(idx, 1);
      this.emit('giocatore_eliminato', { gameId, nome, partita });
    }

    // Caso 2a: passati sono 1 solo → vince
    if (passati.length === 1 && partita.giocatori.length === 1) {
      this._finePartita(gameId, partita.giocatori[0]);
      return;
    }

    // Caso 2b: passati sono 2+ → continua, parola base = ultima passata
    // (Nota: la parola valida è già stata appesa a history/paroleUsate in
    // submitParola, quindi qui NON si pusha di nuovo per evitare duplicati.)
    const ultimaPassata = rounds.findLast(r => r.stato === 'passato') || rounds[0];
    const nuovaParola = ultimaPassata.parola;
    partita.turnManager.giocatori = passati.filter(n => partita.giocatori.includes(n));
    partita.turnManager.nuovoTurno(nuovaParola);
    partita.currentWord = nuovaParola;
    // lastActivityAt non viene aggiornato qui: se c'è un "passato" lo ha già
    // fatto submitParola; così le transizioni automatiche di fine turno non
    // contano come attività ai fini dello sweeper (partite orfane ripulite).
    this.emit('turn_update', { gameId, stato: partita.turnManager.statoCorrente() });
  }

  /**
   * Wrapper per compatibilità con il codice esistente (evento timeout che
   * il TurnManager non emette più).
   */
  _gestisciTimeout(gameId) {
    const partita = this.partite.get(gameId);
    if (!partita || partita.state !== 'running') return;
    this.emit('turno_scaduto', { gameId });
  }

  /**
   * Elimina un giocatore da una partita in corso per qualsivoglia motivo
   * (timeout o abbandono volontario). Se resta un solo giocatore → vince;
   * se non ne resta nessuno → partita cancellata; altrimenti il turno passa
   * correttamente al successivo.
   *
   * @param {string} gameId
   * @param {number} idxGiocatore - indice del giocatore da eliminare
   * @param {'timeout'|'abbandono'} motivo
   */
  _eliminaGiocatore(gameId, idxGiocatore, motivo) {
    const partita = this.partite.get(gameId);
    if (!partita || partita.state !== 'running') return;

    const nomeEliminato = partita.giocatori[idxGiocatore];
    logger.info('giocatore_eliminato', { gameId, nome: nomeEliminato, motivo });

    partita.giocatori.splice(idxGiocatore, 1);
    if (partita.turnManager) partita.turnManager.giocatori.splice(idxGiocatore, 1);

    this.emit('giocatore_eliminato', { gameId, nome: nomeEliminato, partita });

    if (partita.giocatori.length === 1) {
      this._finePartita(gameId, partita.giocatori[0]);
    } else if (partita.giocatori.length === 0) {
      this._cancellaPartita(gameId);
    } else {
      const nuovoIndice = (idxGiocatore) % partita.giocatori.length;
      partita.turnManager.currentPlayerIndex = nuovoIndice;
      partita.turnManager.timeLeft = partita.params.turn_seconds;
      partita.turnManager.turno += 1;
      partita.turnManager._avviaTimer();
      this.emit('turn_change', { gameId, stato: partita.turnManager.statoCorrente() });
    }
  }

  /**
   * Gestisce l'abbandono volontario di un giocatore durante una partita
   * in corso. Delegato da `leave_game` quando la partita è running.
   *
   * @param {string} gameId
   * @param {string} nomeGiocatore
   */
  abbandonaGiocatore(gameId, nomeGiocatore) {
    const partita = this.partite.get(gameId);
    if (!partita) return { ok: false, errore: 'partita_non_trovata' };
    if (partita.state !== 'running') return { ok: false, errore: 'partita_non_in_corso' };

    const idx = partita.giocatori.indexOf(nomeGiocatore);
    if (idx === -1) return { ok: false, errore: 'giocatore_non_in_partita' };

    if (partita.giocatori.length === 2) {
      // Regola speciale: in 2 giocatori, abbandono = l'altro vince subito.
      this._eliminaGiocatore(gameId, idx, 'abbandono');
      return { ok: true };
    }

    // Altrimenti: marca come abbandono, ma niente _eliminaGiocatore diretto.
    // A fine turno (_gestisciFineTurno) verrà valutato:
    //  - se l'altro/i giocatori restanti passano il loro round → gli
    //    abbandonati sono trattati come limbo → eliminati a fine turno.
    //  - se nessun altro passa → pareggio.
    //  - se dopo elim ne resta 1 solo → quello vince.
    partita.giocatori.splice(idx, 1);
    if (partita.turnManager) {
      partita.turnManager.giocatori.splice(idx, 1);
    }
    this.emit('giocatore_eliminato', { gameId, nome: nomeGiocatore, partita });
    // Se dopo la rimozione ne resta 1 solo, chiudi la partita subito.
    if (partita.giocatori.length === 1) {
      this._finePartita(gameId, partita.giocatori[0]);
    } else if (partita.giocatori.length === 0) {
      this._cancellaPartita(gameId);
    }
    return { ok: true };
  }

  _finePartita(gameId, vincitore) {
    const partita = this.partite.get(gameId);
    if (!partita) return;
    partita.state = 'finished';
    partita.vincitore = vincitore;
    partita.endedAt = new Date();
    partita.lastActivityAt = new Date();
    if (partita.turnManager) partita.turnManager.stop();
    logger.info('partita_finita', { gameId, vincitore, durata_ms: partita.endedAt - partita.startedAt, aiValidations: partita.aiValidationsCount });
    this.emit('partita_finita', partita);
  }

  _cancellaPartita(gameId) {
    const partita = this.partite.get(gameId);
    if (!partita) return;
    partita.state = 'cancelled';
    partita.endedAt = new Date();
    if (partita.turnManager) partita.turnManager.stop();
    logger.info('partita_cancellata', { gameId });
    this.emit('partita_cancellata', partita);
  }

  // ============================================================
  // Socket tracking (per sweeper "running con 0 socket")
  // ============================================================

  registraSocket(gameId, socketId) {
    if (!this.socketsPerPartita.has(gameId)) {
      this.socketsPerPartita.set(gameId, new Set());
    }
    this.socketsPerPartita.get(gameId).add(socketId);
  }

  rimuoviSocket(gameId, socketId) {
    this.socketsPerPartita.get(gameId)?.delete(socketId);
  }

  contaSocket(gameId) {
    return this.socketsPerPartita.get(gameId)?.size ?? 0;
  }

  // ============================================================
  // Sweeper automatico
  // ============================================================

  /**
   * Pulisce partite abbandonate secondo regole:
   * - waiting >5min → cancellata
   * - running con 0 socket >2min → cancellata
   * - finished >1min → rimossa definitivamente
   */
  _sweepAbbandonate() {
    const ora = Date.now();
    for (const [gameId, p] of this.partite.entries()) {
      if (p.state === 'waiting') {
        const etaMs = ora - new Date(p.createdAt).getTime();
        if (etaMs > TIMEOUT_WAITING_MS) {
          logger.info('sweeper_cancella_waiting', { gameId, etaMin: Math.round(etaMs / 60000) });
          this._cancellaPartita(gameId);
        }
      } else if (p.state === 'running') {
        const etaSenzaAttivita = ora - new Date(p.lastActivityAt).getTime();
        const socketConnessi = this.contaSocket(gameId);
        if (socketConnessi === 0 && etaSenzaAttivita > TIMEOUT_RUNNING_SOLO_MS) {
          logger.info('sweeper_cancella_running_solo', { gameId, etaMin: Math.round(etaSenzaAttivita / 60000) });
          this._cancellaPartita(gameId);
        }
      } else if (p.state === 'finished' || p.state === 'cancelled') {
        const etaFine = ora - new Date(p.endedAt).getTime();
        if (etaFine > TIMEOUT_FINISHED_MS) {
          logger.info('sweeper_rimuove_finita', { gameId, etaSec: Math.round(etaFine / 1000) });
          this.rimuoviPartita(gameId);
        }
      }
    }
  }

  rimuoviPartita(gameId) {
    const partita = this.partite.get(gameId);
    if (!partita) return false;
    if (partita.state === 'running') return false;
    if (partita.turnManager) partita.turnManager.stop();
    this.partite.delete(gameId);
    this.socketsPerPartita.delete(gameId);
    logger.info('partita_rimossa', { gameId });
    this.emit('partita_rimossa', { id: gameId });
    return true;
  }
}

export const gameManager = new GameManager();
