/**
 * GameManager.js — Gestione stato partite in RAM
 *
 * Singleton che tiene traccia di tutte le partite attive in memoria.
 * Ogni match è identificata da un gameId (UUID).
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
    this.matches = new Map();
    // Traccia socket connessi per match (per sweeper "running con 0 socket")
    this.socketsPerMatch = new Map(); // gameId → Set<socketId>

    // Sweeper automatico
    this.sweeperInterval = setInterval(() => this._sweepAbbandonate(), SWEEPER_INTERVAL_MS);
    this.sweeperInterval.unref(); // non blocca shutdown
  }

  // ============================================================
  // CRUD Partite
  // ============================================================

  async creaMatch(opzioni) {
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
    for (const p of this.matches.values()) {
      if (p.state === 'waiting' && p.giocatori.includes(nome)) {
        return { ok: false, errore: 'gia_in_partita', match: p };
      }
    }

    const id = randomUUID();
    const match = {
      id,
      creator: nome,
      giocatori: [nome],
      ready: [false],
      state: 'waiting',
      params: { max_players: maxPlayers, turn_seconds: turnSeconds, games_to_win: gamesToWin, initial_length_min: initialLengthMin, initial_length_max: initialLengthMax },
      gamesToWin,                          // best-of-N (ora effettivo)
      mancheCorrente: 1,                   // numero manche in corso
      punteggio: {},                       // nome → manche vinte
      giocatoriOriginali: [],              // chi può ancora giocare le manche successive
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
    this.matches.set(id, match);
    this.socketsPerMatch.set(id, new Set());
    logger.info('partita_creata', { id, creator: nome, maxPlayers, turnSeconds });
    this.emit('partita_creata', match);
    return { ok: true, match };
  }

  uniscitiAMatch(gameId, nome) {
    const match = this.matches.get(gameId);
    if (!match) return { ok: false, errore: 'partita_non_trovata' };
    if (match.state !== 'waiting') return { ok: false, errore: 'partita_gia_iniziata' };
    if (match.giocatori.length >= match.params.max_players) return { ok: false, errore: 'partita_piena' };
    if (!nome || typeof nome !== 'string' || nome.trim().length < 1) {
      return { ok: false, errore: 'nome_non_valido' };
    }
    const nomePulito = nome.trim();
    if (match.giocatori.includes(nomePulito)) {
      return { ok: false, errore: 'nome_gia_usato' };
    }
    match.giocatori.push(nomePulito);
    match.ready.push(false);
    match.lastActivityAt = new Date();
    logger.info('giocatore_aggiunto', { gameId, nome: nomePulito, totale: match.giocatori.length });
    this.emit('giocatore_aggiunto', match);
    return { ok: true, match };
  }

  setReady(gameId, nome, ready) {
    const match = this.matches.get(gameId);
    if (!match) return { ok: false, errore: 'partita_non_trovata' };
    if (match.state !== 'waiting') return { ok: false, errore: 'partita_gia_iniziata' };
    const idx = match.giocatori.indexOf(nome);
    if (idx === -1) return { ok: false, errore: 'giocatore_non_in_partita' };
    if (typeof ready !== 'boolean') return { ok: false, errore: 'ready_non_valido' };
    match.ready[idx] = ready;
    match.lastActivityAt = new Date();
    const tuttiProni = match.ready.every((r) => r) && match.giocatori.length >= 2;
    logger.info('ready_aggiornato', { gameId, nome, ready, tuttiProni });
    this.emit('ready_aggiornato', match);
    return { ok: true, match, tuttiProni };
  }

  getMatch(gameId) { return this.matches.get(gameId); }

  listaMatchAperti() {
    return Array.from(this.matches.values()).filter((p) => p.state === 'waiting');
  }

  size() { return this.matches.size; }

  // ============================================================
  // Game Lifecycle
  // ============================================================

  async avviaMatch(gameId) {
    const match = this.matches.get(gameId);
    if (!match) return { ok: false, errore: 'partita_non_trovata' };
    if (match.state !== 'waiting') return { ok: false, errore: 'stato_non_valido' };
    if (match.giocatori.length < 2) return { ok: false, errore: 'servono_almeno_2_giocatori' };
    if (!match.ready.every((r) => r)) return { ok: false, errore: 'non_tutti_pronti' };

    try {
      const parolaIniziale = await scegliParolaIniziale(
        match.params.initial_length_min,
        match.params.initial_length_max
      );

      match.state = 'running';
      match.currentWord = parolaIniziale;
      match.startedAt = new Date();
      match.currentPlayerIndex = 0;
      // Best-of-N: giocatoriOriginali = chi può giocare le manche (tutti ora).
      match.giocatoriOriginali = [...match.giocatori];
      match.punteggio = {};
      match.mancheCorrente = 1;
      match.history = [{ parola: parolaIniziale, giocatore: '(iniziale)', turno: 0, manche: 1, timestamp: Date.now() }];
      match.paroleUsate = new Set([normalizzaBase(parolaIniziale)]);
      match.lastActivityAt = new Date();

      const turnManager = this._creaTurnManager(gameId, match, parolaIniziale);
      match.turnManager = turnManager;
      turnManager.start();

      logger.info('partita_avviata', { gameId, parolaIniziale, gamesToWin: match.gamesToWin });
      this.emit('partita_avviata', match);
      return { ok: true, match };
    } catch (errore) {
      logger.error('avvio_partita_fallito', { gameId, errore: errore.message });
      return { ok: false, errore: errore.message };
    }
  }

  async submitParola(gameId, nomeGiocatore, parola) {
    const match = this.matches.get(gameId);
    if (!match) return { ok: false, valida: false, motivo: 'partita_non_trovata' };
    if (match.state !== 'running') {
      return { ok: false, valida: false, motivo: 'partita_non_in_corso' };
    }
    if (match.turnManager.giocatoreCorrente() !== nomeGiocatore) {
      return { ok: false, valida: false, motivo: 'non_sei_di_turno' };
    }

    const risultato = await validaMossa({
      parolaPrecedente: match.currentWord,
      parolaNuova: parola,
      gameId,
      paroleUsate: match.paroleUsate,
      lunghezzaMin: 3,
      lunghezzaMax: 10,
    });

    // La mossa passa SEMPRE da submitMossa (valida o no): così il TurnManager
    // conteggia i tentativi falliti (regola: 3 errori → limbo) e fa avanzare
    // il round solo quando serve. Il riferimento PRE-submit serve a capire se
    // una mossa valida ha chiuso l'ultima mano e fatto partire una NUOVA manche.
    const tmPrima = match.turnManager;
    const esitoSubmit = match.turnManager.submitMossa(parola, nomeGiocatore, risultato);

    if (risultato.valida) {
      // Aggiorna lo stato SOLO se la manche è ancora la stessa (stesso TurnManager).
      if (match.turnManager === tmPrima) {
        match.currentWord = risultato.normalizzata;
        match.paroleUsate.add(risultato.normalizzata);
        match.history.push({
          parola: risultato.normalizzata,
          giocatore: nomeGiocatore,
          turno: match.turnManager.turno,
          manche: match.mancheCorrente,
          timestamp: Date.now(),
        });
      }
      match.lastActivityAt = new Date();
      if (risultato.source === 'AI') match.aiValidationsCount += 1;
      this.emit('mossa_validata', { gameId, match, parola: risultato.normalizzata, ai_usata: risultato.ai_usata || false });
      logger.info('mossa_validata', { gameId, giocatore: nomeGiocatore, source: risultato.source, ai_usata: !!risultato.ai_usata });
    } else {
      this.emit('mossa_rifiutata', {
        gameId, match, parola, motivo: risultato.motivo,
        tentativi: esitoSubmit?.tentativi, maxTentativi: esitoSubmit?.maxTentativi, limbo: !!esitoSubmit?.limbo,
      });
      logger.info('mossa_rifiutata', { gameId, giocatore: nomeGiocatore, motivo: risultato.motivo, tentativi: esitoSubmit?.tentativi, limbo: !!esitoSubmit?.limbo });
    }

    return {
      ok: true,
      valida: risultato.valida,
      motivo: risultato.motivo,
      messaggio: risultato.messaggio,
      source: risultato.source,
      tentativi: esitoSubmit?.tentativi ?? 0,
      maxTentativi: esitoSubmit?.maxTentativi ?? 3,
      limbo: !!esitoSubmit?.limbo,
    };
  }

  passaTurno(gameId, nomeGiocatore) {
    const match = this.matches.get(gameId);
    if (!match) return { ok: false, errore: 'partita_non_trovata' };
    if (match.state !== 'running') return { ok: false, errore: 'partita_non_in_corso' };
    if (match.turnManager.giocatoreCorrente() !== nomeGiocatore) {
      return { ok: false, errore: 'non_sei_di_turno' };
    }
    match.turnManager.passaTurno(nomeGiocatore);
    return { ok: true };
  }

  /**
   * Timeout di un singolo round: il TurnManager ha già marcato il giocatore
   * in limbo e incrementato il round. Qui emettiamo l'evento per i client.
   * La valutazione vera (elim/pareggio/vittoria) avviene in _gestisciFineTurno.
   */
  _gestisciTimeoutRound(gameId) {
    const match = this.matches.get(gameId);
    if (!match || match.state !== 'running') return;
    this.emit('turno_scaduto', { gameId, giocatore: match.turnManager?.giocatoreCorrente() });
  }

  /**
   * Costruisce un TurnManager per una manche (avvio o nuova manche).
   * Centralizza callback ed eventi per non duplicare la logica.
   *
   * @param {string} gameId
   * @param {object} match
   * @param {string} parolaIniziale
   * @returns {import('./TurnManager.js').TurnManager}
   */
  _creaTurnManager(gameId, match, parolaIniziale) {
    let turnManager = null;
    turnManager = new TurnManager({
      giocatori: [...match.giocatori],
      secondiPerTurno: match.params.turn_seconds,
      parolaIniziale,
      history: match.history,
      maxTentativi: 3, // regola: 3 tentativi per mano
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
    return turnManager;
  }

  /**
   * Fine turno: applica le regole del modello mano/turno/limbo.
   *  - Tutti in limbo → stallo, nuova parola base, tutti restano in gioco.
   *  - Almeno un passato → i limbo vengono eliminati; se i passati sono 1 solo,
   *    il giocatore vince la MANCHE; altrimenti prosegue con l'ultima parola valida.
   */
  async _gestisciFineTurno(gameId) {
    const match = this.matches.get(gameId);
    if (!match || match.state !== 'running') return;

    const rounds = match.turnManager.rounds;
    // Escludi dal conteggio i giocatori non più attivi (es. abbandonati): i loro
    // round già registrati non devono influire su vittoria/eliminazione.
    const attivi = new Set(match.giocatori);
    const passatiRounds = rounds.filter(r => r.stato === 'passato' && attivi.has(r.giocatore));
    const passati = passatiRounds.map(r => r.giocatore);
    const limbi = rounds.filter(r => r.stato === 'limbo' && attivi.has(r.giocatore)).map(r => r.giocatore);

    // Caso 1: tutti in limbo → stallo (nuova parola, nessun eliminato)
    if (passati.length === 0) {
      logger.info('stallo', { gameId, turno: match.turnManager.turno });
      const nuovaParola = await scegliParolaIniziale(
        match.params.initial_length_min,
        match.params.initial_length_max
      );
      this.emit('pareggio', { gameId, turno: match.turnManager.turno, nuovaParola, parola: nuovaParola });
      match.turnManager.nuovoTurno(nuovaParola);
      match.currentWord = nuovaParola;
      match.paroleUsate.add(normalizzaBase(nuovaParola));
      match.history.push({
        parola: nuovaParola,
        giocatore: '(stallo)',
        turno: match.turnManager.turno,
        manche: match.mancheCorrente,
        timestamp: Date.now(),
      });
      // NB: NON aggiornare lastActivityAt qui: gli stalli automatici non contano
      // come "attività" (lo sweeper ripulisce le partite orfane). turn_update
      // invia lo stato CORRETTO post-nuovoTurno per allineare i client.
      this.emit('turn_update', { gameId, stato: match.turnManager.statoCorrente() });
      return;
    }

    // Caso 2: almeno un passato → limbo eliminati
    for (const nome of limbi) {
      if (match.turnManager) match.turnManager.rimuoviGiocatore(nome);
      const idx = match.giocatori.indexOf(nome);
      if (idx !== -1) match.giocatori.splice(idx, 1);
      this.emit('giocatore_eliminato', { gameId, nome, match });
    }

    // Caso 2a: resta 1 solo → vince la manche (+1 punto, eventuale fine match)
    if (match.giocatori.length === 1) {
      this._fineManche(gameId, match.giocatori[0]);
      return;
    }

    // Caso 2b: 2+ → continua con l'ultima parola valida
    const ultimaPassata = passatiRounds[passatiRounds.length - 1]
      || rounds.filter(r => attivi.has(r.giocatore))[0];
    const nuovaParola = ultimaPassata?.parola || match.currentWord;
    match.turnManager.giocatori = [...match.giocatori];
    match.turnManager.nuovoTurno(nuovaParola);
    match.currentWord = nuovaParola;
    // lastActivityAt non aggiornato qui: se c'è un "passato" lo ha già fatto
    // submitParola; le transizioni automatiche non contano come attività.
    this.emit('turn_update', { gameId, stato: match.turnManager.statoCorrente() });
  }

  /**
   * Wrapper per compatibilità con il codice esistente (evento timeout che
   * il TurnManager non emette più).
   */
  _gestisciTimeout(gameId) {
    const match = this.matches.get(gameId);
    if (!match || match.state !== 'running') return;
    this.emit('turno_scaduto', { gameId });
  }

  /**
   * Elimina un giocatore da una partita in corso per qualsivoglia motivo
   * (timeout o abbandono volontario). Se resta un solo giocatore → vince;
   * se non ne resta nessuno → match cancellata; altrimenti il turno passa
   * correttamente al successivo.
   *
   * @param {string} gameId
   * @param {number} idxGiocatore - indice del giocatore da eliminare
   * @param {'timeout'|'abbandono'} motivo
   */
  _eliminaGiocatore(gameId, idxGiocatore, motivo) {
    const match = this.matches.get(gameId);
    if (!match || match.state !== 'running') return;

    const nomeEliminato = match.giocatori[idxGiocatore];
    logger.info('giocatore_eliminato', { gameId, nome: nomeEliminato, motivo });

    // Rimozione sicura: riallinea l'indice del turno (fix bug).
    if (match.turnManager) match.turnManager.rimuoviGiocatore(nomeEliminato);
    const idx = match.giocatori.indexOf(nomeEliminato);
    if (idx !== -1) match.giocatori.splice(idx, 1);

    this.emit('giocatore_eliminato', { gameId, nome: nomeEliminato, match });

    if (match.giocatori.length === 1) {
      this._fineManche(gameId, match.giocatori[0]);
    } else if (match.giocatori.length === 0) {
      this._cancellaMatch(gameId);
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
    const match = this.matches.get(gameId);
    if (!match) return { ok: false, errore: 'partita_non_trovata' };
    if (match.state !== 'running') return { ok: false, errore: 'partita_non_in_corso' };

    const idx = match.giocatori.indexOf(nomeGiocatore);
    if (idx === -1) return { ok: false, errore: 'giocatore_non_in_partita' };

    // Best-of-N: abbandono DEFINITIVO → non rientra nelle manche successive.
    const idxOrig = match.giocatoriOriginali.indexOf(nomeGiocatore);
    if (idxOrig !== -1) match.giocatoriOriginali.splice(idxOrig, 1);
    match.lastActivityAt = new Date();

    // Rimozione sicura dalla manche corrente (fix indice) + segnalazione.
    if (match.turnManager) match.turnManager.rimuoviGiocatore(nomeGiocatore);
    const idx2 = match.giocatori.indexOf(nomeGiocatore);
    if (idx2 !== -1) match.giocatori.splice(idx2, 1);
    this.emit('giocatore_eliminato', { gameId, nome: nomeGiocatore, match });

    if (match.giocatori.length === 1) {
      this._fineManche(gameId, match.giocatori[0]);
    } else if (match.giocatori.length === 0) {
      this._cancellaMatch(gameId);
    }
    return { ok: true };
  }

  /**
   * Fine di una manche: assegna +1 al vincitore, poi o chiude la partita
   * (se raggiunge gamesToWin) oppure avvia una nuova manche.
   * @param {string} gameId
   * @param {string} vincitore
   */
  async _fineManche(gameId, vincitore) {
    const match = this.matches.get(gameId);
    if (!match || match.state !== 'running') return;

    match.punteggio[vincitore] = (match.punteggio[vincitore] || 0) + 1;
    const raggiunto = match.punteggio[vincitore] >= match.gamesToWin;
    // Se resta UN SOLO giocatore non abbandonato, la partita termina comunque:
    // non c'è più un avversario con cui giocare le manche (best-of-N).
    const restanoGiocabili = match.giocatoriOriginali.length;

    this.emit('manche_finita', {
      gameId, vincitore, manche: match.mancheCorrente,
      punteggio: { ...match.punteggio }, gamesToWin: match.gamesToWin, restaUnSolo: restanoGiocabili === 1,
    });
    this.emit('punteggio_aggiornato', { gameId, punteggio: { ...match.punteggio }, manche: match.mancheCorrente });

    if (match.turnManager) match.turnManager.stop();
    logger.info('manche_finita', { gameId, vincitore, manche: match.mancheCorrente, punti: match.punteggio[vincitore], restanoGiocabili });

    if (restanoGiocabili === 1 || raggiunto) {
      this._fineMatch(gameId, vincitore);
    } else {
      await this._nuovaManche(gameId);
    }
  }

  /**
   * Avvia una NUOVA manche: tutti i giocatori non abbandonati tornano in gioco.
   * @param {string} gameId
   */
  async _nuovaManche(gameId) {
    const match = this.matches.get(gameId);
    if (!match || match.state !== 'running') return;

    const parola = await scegliParolaIniziale(
      match.params.initial_length_min,
      match.params.initial_length_max
    );

    match.mancheCorrente += 1;
    match.giocatori = [...match.giocatoriOriginali];
    match.currentWord = parola;
    match.paroleUsate = new Set([normalizzaBase(parola)]);
    match.history = [{ parola, giocatore: '(iniziale)', turno: 0, manche: match.mancheCorrente, timestamp: Date.now() }];
    match.lastActivityAt = new Date();

    const turnManager = this._creaTurnManager(gameId, match, parola);
    match.turnManager = turnManager;
    turnManager.start();

    this.emit('manche_start', {
      gameId, manche: match.mancheCorrente, parola,
      punteggio: { ...match.punteggio }, giocatori: [...match.giocatori],
    });
    this.emit('turn_update', { gameId, stato: match.turnManager.statoCorrente() });
    logger.info('nuova_manche', { gameId, manche: match.mancheCorrente, parola });
  }

  _fineMatch(gameId, vincitore) {
    const match = this.matches.get(gameId);
    if (!match) return;
    match.state = 'finished';
    match.vincitore = vincitore;
    match.endedAt = new Date();
    match.lastActivityAt = new Date();
    if (match.turnManager) match.turnManager.stop();
    logger.info('partita_finita', { gameId, vincitore, durata_ms: match.endedAt - match.startedAt, aiValidations: match.aiValidationsCount });
    this.emit('partita_finita', match);
  }

  _cancellaMatch(gameId) {
    const match = this.matches.get(gameId);
    if (!match) return;
    match.state = 'cancelled';
    match.endedAt = new Date();
    if (match.turnManager) match.turnManager.stop();
    logger.info('partita_cancellata', { gameId });
    this.emit('partita_cancellata', match);
  }

  // ============================================================
  // Socket tracking (per sweeper "running con 0 socket")
  // ============================================================

  registraSocket(gameId, socketId) {
    if (!this.socketsPerMatch.has(gameId)) {
      this.socketsPerMatch.set(gameId, new Set());
    }
    this.socketsPerMatch.get(gameId).add(socketId);
  }

  rimuoviSocket(gameId, socketId) {
    this.socketsPerMatch.get(gameId)?.delete(socketId);
  }

  contaSocket(gameId) {
    return this.socketsPerMatch.get(gameId)?.size ?? 0;
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
    for (const [gameId, p] of this.matches.entries()) {
      if (p.state === 'waiting') {
        const etaMs = ora - new Date(p.createdAt).getTime();
        if (etaMs > TIMEOUT_WAITING_MS) {
          logger.info('sweeper_cancella_waiting', { gameId, etaMin: Math.round(etaMs / 60000) });
          this._cancellaMatch(gameId);
        }
      } else if (p.state === 'running') {
        const etaSenzaAttivita = ora - new Date(p.lastActivityAt).getTime();
        const socketConnessi = this.contaSocket(gameId);
        if (socketConnessi === 0 && etaSenzaAttivita > TIMEOUT_RUNNING_SOLO_MS) {
          logger.info('sweeper_cancella_running_solo', { gameId, etaMin: Math.round(etaSenzaAttivita / 60000) });
          this._cancellaMatch(gameId);
        }
      } else if (p.state === 'finished' || p.state === 'cancelled') {
        const etaFine = ora - new Date(p.endedAt).getTime();
        if (etaFine > TIMEOUT_FINISHED_MS) {
          logger.info('sweeper_rimuove_finita', { gameId, etaSec: Math.round(etaFine / 1000) });
          this.rimuoviMatch(gameId);
        }
      }
    }
  }

  rimuoviMatch(gameId) {
    const match = this.matches.get(gameId);
    if (!match) return false;
    if (match.state === 'running') return false;
    if (match.turnManager) match.turnManager.stop();
    this.matches.delete(gameId);
    this.socketsPerMatch.delete(gameId);
    logger.info('partita_rimossa', { gameId });
    this.emit('partita_rimossa', { id: gameId });
    return true;
  }
}

export const gameManager = new GameManager();
