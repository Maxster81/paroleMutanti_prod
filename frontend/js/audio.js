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
 * Suona un beep a una frequenza per una durata.
 * @param {number} freq - Hz (default 800)
 * @param {number} durataMs - durata in ms (default 100)
 */
export function beep(freq = 800, durataMs = 100) {
  if (!state.get().audioAbilitato) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durataMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durataMs / 1000);
  } catch (err) {
    console.warn('[audio] beep fallito:', err.message);
  }
}

/**
 * Beep di countdown (ultimi 10 secondi del turno).
 */
export function tick() {
  beep(1000, 50);
}

/**
 * Buzzer di timeout/errore.
 */
export function buzzer() {
  beep(200, 600);
}

/**
 * Suono di successo (parola validata, partita vinta).
 */
export function success() {
  beep(523, 100);
  setTimeout(() => beep(659, 100), 120);
  setTimeout(() => beep(784, 200), 250);
}

/**
 * Beep di click (per UI).
 */
export function click() {
  beep(600, 30);
}
