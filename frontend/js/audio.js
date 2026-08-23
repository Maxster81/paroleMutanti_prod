/**
 * audio.js — Web Audio API wrapper
 *
 * AudioContext creato al primo user gesture (politica autoplay browser).
 * Funzioni: beep(freq, ms), buzzer(), success(), tick().
 *
 * @module frontend/js/audio
 */

import { state } from './state.js';

let audioCtx = null;

/**
 * Lazy init AudioContext al primo user gesture.
 */
function getCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (err) {
      console.warn('[audio] AudioContext non disponibile:', err.message);
      return null;
    }
  }
  // Riprendi se suspended (alcuni browser)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Suona una nota con envelope pulita (attacco lineare breve + decay esponenziale),
 * evitando i "click"/"pop" dovuti a variazioni di ampiezza improvvise.
 *
 * @param {number} freq - frequenza Hz
 * @param {number} durataMs - durata in ms
 * @param {object} [opzioni]
 * @param {string} [opzioni.tipo='sine'] - forma d'onda ('sine'|'triangle'|'square'|'sawtooth')
 * @param {number} [opzioni.volume=0.3] - ampiezza di picco
 * @param {number} [opzioni.attaccoMs=5] - durata dell'attacco (per smorzare il click)
 */
function suona(freq, durataMs, { tipo = 'sine', volume = 0.3, attaccoMs = 5 } = {}) {
  if (!state.get().audioAbilitato) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + attaccoMs / 1000);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durataMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durataMs / 1000 + 0.02);
  } catch (err) {
    console.warn('[audio] suona fallito:', err.message);
  }
}

/**
 * Beep generico (default: nota chiara).
 * @param {number} freq - Hz (default 800)
 * @param {number} durataMs - durata in ms (default 100)
 */
export function beep(freq = 800, durataMs = 100) {
  suona(freq, durataMs);
}

/**
 * Tick di countdown (ultimi secondi del turno): nota acuta e corta.
 */
export function tick() {
  suona(1100, 40, { tipo: 'triangle', volume: 0.25 });
}

/**
 * Buzzer di timeout/errore: due toni discendenti "secchi".
 */
export function buzzer() {
  suona(320, 180, { tipo: 'sawtooth', volume: 0.25 });
  setTimeout(() => suona(180, 320, { tipo: 'sawtooth', volume: 0.25 }), 180);
}

/**
 * Suono di successo (parola validata, partita vinta): arpeggio di Do maggiore
 * ascendente, piacevole e non fastidioso.
 */
export function success() {
  const note = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  note.forEach((f, i) => {
    setTimeout(() => suona(f, 180, { tipo: 'triangle', volume: 0.28 }), i * 130);
  });
}

/**
 * Click per la UI: impulso brevissimo e "leggero".
 */
export function click() {
  suona(700, 25, { tipo: 'square', volume: 0.15 });
}
