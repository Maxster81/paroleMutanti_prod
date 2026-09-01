/**
 * TurnManager.js — Gestione turni e round di una partita
 *
 * Modello a round sequenziali con evoluzione a catena della parola:
 * - Un turno è composto da N round (N = numero di giocatori attivi nel turno).
 * - Ogni round ha un giocatore "di turno" che ha TOT secondi per rispondere.
 * - La parola del turno evolve SOLO quando un giocatore passa un round (parola valida).
 * - Se il giocatore non risponde entro il timeout → limbo (NON eliminato subito).
 * - A fine turno si applicano le regole di pareggio/eliminazione/vittoria
 *   (vedi GameManager._fineTurno).
 *
 * @module backend/src/game/TurnManager
 */

import { EventEmitter } from 'node:events';
import { logger } from '../logger.js';

export class TurnManager extends EventEmitter {
  constructor(opzioni) {
    super();
    this.giocatori = opzioni.giocatori ?? [];
    this.secondiPerTurno = opzioni.secondiPerTurno ?? 30;
    this.parolaIniziale = opzioni.parolaIniziale ?? '';
    // Riferimento alla catena di parole già usate della partita (per esporla
    // al client tramite statoCorrente). È lo stesso array di GameManager.
    this.history = opzioni.history ?? [];
    this.onFineTurno = opzioni.onFineTurno ?? (() => {});
    this.onTick = opzioni.onTick ?? (() => {});
    this.onTimeout = opzioni.onTimeout ?? (() => {});
    // Nomenclatura: questa classe gestisce la MANCHE. 'round' = mano,
    // 'turno' = insieme delle mani. maxTentativi = errori per mano (3).
    this.maxTentativi = opzioni.maxTentativi ?? 3;
    this.tentativiCorrenti = 0;

    this.turno = 0;             // contatore turni (incrementa a ogni fine turno)
    this.rounds = [];           // array di risultati round del turno corrente
    this.currentWord = this.parolaIniziale;
    this.currentPlayerIndex = 0;
    this.currentRoundIndex = 0;
    this.timeLeft = this.secondiPerTurno;
    this.timerInterval = null;
    this.attivo = false;
  }

  start() {
    if (this.attivo) return;
    this.attivo = true;
    this.turno = 1;
    this.currentWord = this.parolaIniziale;
    this.rounds = [];
    this.currentRoundIndex = 0;
    this.tentativiCorrenti = 0;
    this._avviaRoundCorrente();
    logger.info('turno_avviato', { turno: this.turno, parola: this.currentWord });
  }

  /**
   * Avvia il round del giocatore corrente (timer + tick).
   */
  _avviaRoundCorrente() {
    this.tentativiCorrenti = 0;
    this.timeLeft = this.secondiPerTurno;
    this.emit('round_start', this.statoCorrente());
    this._avviaTimer();
  }

  /**
   * Processa un submit del giocatore corrente. Se valido, marca "passato" e
   * la parola evolve. Poi passa al prossimo round (o chiude il turno).
   *
   * @param {string} parola
   * @param {string} giocatore
   * @param {object} infoValidazione - { valida, normalizzata, source, ... }
   * @returns {{ok: boolean, valida: boolean, motivo?: string, normalizzata?: string}}
   */
  submitMossa(parola, giocatore, infoValidazione) {
    if (!this.attivo) {
      return { ok: false, valida: false, motivo: 'turno_non_attivo' };
    }
    const giocatoreAtteso = this.giocatoreCorrente();
    if (giocatore !== giocatoreAtteso) {
      return { ok: false, valida: false, motivo: 'non_di_turno' };
    }
    if (!infoValidazione?.valida) {
      // Mossa rifiutata = un TENTATIVO fallito nella mano corrente.
      this.tentativiCorrenti += 1;
      const limbo = this.tentativiCorrenti >= this.maxTentativi;
      if (limbo) {
        // Al 3° errore la mano si chiude in limbo e si passa al successivo.
        this.timeoutRound();
      }
      return {
        ok: true,
        valida: false,
        motivo: infoValidazione?.motivo,
        tentativi: this.tentativiCorrenti,
        maxTentativi: this.maxTentativi,
        limbo,
      };
    }

    const normalizzata = infoValidazione.normalizzata || parola;
    this.rounds.push({
      giocatore,
      stato: 'passato',
      parola: normalizzata,
      source: infoValidazione.source || null,
    });
    this.currentWord = normalizzata;
    this.emit('round_passato', { giocatore, parola: normalizzata, source: infoValidazione.source });

    this._fermaTimer();
    this._avanti();
    return { ok: true, valida: true, normalizzata };
  }

  /**
   * Il giocatore corrente passa (skip) il turno: marcato in limbo e
   * si passa immediatamente al prossimo round (senza aspettare il timer).
   */
  passaTurno(giocatore) {
    if (!this.attivo) return false;
    if (giocatore !== this.giocatoreCorrente()) return false;
    this.timeoutRound();
    return true;
  }

  /**
   * Timeout del round corrente: marca il giocatore in limbo, poi passa avanti.
   */
  timeoutRound() {
    if (!this.attivo) return;
    const giocatore = this.giocatoreCorrente();
    if (!giocatore) return;

    this.rounds.push({ giocatore, stato: 'limbo', parola: this.currentWord });
    this.emit('round_limbo', { giocatore });
    this._fermaTimer();
    this._avanti();
  }

  /**
   * Passa al prossimo round, oppure chiude il turno se non ce ne sono più.
   */
  _avanti() {
    this.currentRoundIndex += 1;
    if (this.currentRoundIndex >= this.giocatori.length) {
      // Turno finito
      this.attivo = false;
      this._fermaTimer();
      this.emit('turno_finito', { roundRisultati: [...this.rounds] });
      this.onFineTurno();
    } else {
      this._avviaRoundCorrente();
    }
  }

  /**
   * Inizia un nuovo turno (dopo pareggio o round normale).
   * Tiene gli stessi giocatori, sceglie una nuova parola base.
   *
   * @param {string} nuovaParolaBase
   */
  nuovoTurno(nuovaParolaBase) {
    this.turno += 1;
    this.currentWord = nuovaParolaBase;
    this.rounds = [];
    this.currentRoundIndex = 0;
    this.attivo = true;
    this._avviaRoundCorrente();
    logger.info('turno_avviato', { turno: this.turno, parola: this.currentWord });
  }

  /**
   * Avvia una NUOVA manche (nuovo turno base, reset dell'intero stato).
   * Tutti i giocatori (non abbandonati) tornano in gioco al completo.
   *
   * @param {string} nuovaParolaBase - nuova parola iniziale della manche
   * @param {string[]} giocatori - giocatori attivi della manche (non abbandonati)
   */
  nuovaManche(nuovaParolaBase, giocatori) {
    this.turno = 1;
    this.giocatori = [...giocatori];
    this.currentWord = nuovaParolaBase;
    this.rounds = [];
    this.currentRoundIndex = 0;
    this.tentativiCorrenti = 0;
    this.history = [];
    this.attivo = true;
    this._avviaRoundCorrente();
    logger.info('manche_avviata', { turno: this.turno, parola: this.currentWord });
  }

  /**
   * Rimuove un giocatore dalla manche corrente RIALLINEANDO correttamente
   * l'indice del round (fix bug: prima la rimozione saltava/duplicava il
   * turnista perché currentRoundIndex non veniva aggiornato).
   *
   * @param {string} nome - giocatore da rimuovere
   * @returns {boolean} true se rimosso
   */
  rimuoviGiocatore(nome) {
    const idx = this.giocatori.indexOf(nome);
    if (idx === -1) return false;
    if (idx < this.currentRoundIndex) {
      // Il giocatore aveva già giocato la sua mano → scala l'indice.
      this.currentRoundIndex -= 1;
    }
    this.giocatori.splice(idx, 1);
    if (idx === this.currentRoundIndex && this.attivo) {
      // Era il turnista corrente → salta la sua mano e avvia il successivo.
      // (Dopo lo splice, il prossimo giocatore occupa già questo indice.)
      this._avviaRoundCorrente();
    }
    return true;
  }

  giocatoreCorrente() {
    return this.giocatori[this.currentRoundIndex] ?? null;
  }

  statoCorrente() {
    return {
      turno: this.turno,
      round: this.currentRoundIndex + 1,
      roundsTotali: this.giocatori.length,
      giocatore: this.giocatoreCorrente(),
      giocatoreIndex: this.currentRoundIndex,
      giocatori: [...this.giocatori],
      rounds: this.rounds.map(r => ({ ...r })),
      currentWord: this.currentWord,
      parolaIniziale: this.parolaIniziale,
      history: this.history.map(h => ({ ...h })),
      timeLeft: Math.max(0, this.timeLeft),
      timeLimit: this.secondiPerTurno,
      tentativi: this.tentativiCorrenti,
      maxTentativi: this.maxTentativi,
    };
  }

  stop() {
    this.attivo = false;
    this._fermaTimer();
  }

  _avviaTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this._tick(), 1000);
    // unref: in test (senza server) il timer non deve impedire la terminazione
    // del processo; sul server reale l'handle HTTP/socket la tiene comunque vivo.
    this.timerInterval.unref?.();
  }

  _tick() {
    if (!this.attivo) {
      this._fermaTimer();
      return;
    }
    this.timeLeft -= 1;
    this.onTick(this.timeLeft, this.currentRoundIndex);
    if (this.timeLeft <= 10 && this.timeLeft > 0) {
      this.emit('beep', { timeLeft: this.timeLeft });
    }
    if (this.timeLeft <= 0) {
      this._fermaTimer();
      this.onTimeout();
      // Marca il round corrente in limbo e passa al prossimo
      this.timeoutRound();
    }
  }

  _fermaTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}