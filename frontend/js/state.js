/**
 * state.js — State manager centrale del frontend
 *
 * Pattern: oggetto reattivo + update() + emit 'state-changed'.
 * Ogni view si iscrive e si re-renderizza quando lo state cambia.
 *
 * **Persistenza localStorage (M5-bugfix)**:
 * gameId, nome, tema, audio vengono sincronizzati automaticamente per
 * sopravvivenza al refresh del browser.
 *
 * @module frontend/js/state
 */

const STORAGE_KEYS = {
  gameId: 'pm-gameId',
  nome: 'pm-nome',
  tema: 'pm-tema',
  audio: 'pm-audio',
};

class StateManager {
  constructor() {
    this.data = {
      connessione: 'offline',
      tema: localStorage.getItem(STORAGE_KEYS.tema) || 'dark',
      audioAbilitato: localStorage.getItem(STORAGE_KEYS.audio) !== 'off',
      nome: localStorage.getItem(STORAGE_KEYS.nome) || '',
      gameId: localStorage.getItem(STORAGE_KEYS.gameId) || null,
      partita: null,
      errore: null,
      info: null,
    };
    this.listeners = new Set();
  }

  /**
   * Aggiorna una porzione di state e notifica i listener.
   * Sincronizza automaticamente i campi persistenti in localStorage.
   *
   * @param {object} partial - campi da aggiornare
   */
  update(partial) {
    const old = { ...this.data };
    this.data = { ...this.data, ...partial };

    // Sincronizzazione localStorage per i campi persistenti
    for (const campo of ['gameId', 'nome', 'tema', 'audioAbilitato']) {
      if (campo in partial) {
        const valore = this.data[campo];
        const chiave = STORAGE_KEYS[campo];
        if (valore === null || valore === '' || (campo === 'audioAbilitato' && !valore)) {
          localStorage.removeItem(chiave);
        } else if (campo === 'audioAbilitato') {
          localStorage.setItem(chiave, valore ? 'on' : 'off');
        } else {
          localStorage.setItem(chiave, valore);
        }
      }
    }

    for (const cb of this.listeners) {
      try {
        cb(this.data, old);
      } catch (err) {
        console.error('[state] listener error:', err);
      }
    }
  }

  /**
   * Ritorna lo state corrente (read-only snapshot).
   * @returns {object}
   */
  get() {
    return { ...this.data };
  }

  /**
   * Sottoscrivi ai cambi di state.
   *
   * @param {function} callback - fn(state, oldState) => void
   * @returns {function} unsubscribe
   */
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Reset di alcune proprietà (es. errore/info dopo averle mostrate).
   */
  clearMessaggi() {
    this.update({ errore: null, info: null });
  }
}

export const state = new StateManager();
