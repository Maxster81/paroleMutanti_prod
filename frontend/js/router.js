/**
 * router.js — Hash router semplice per la SPA
 *
 * Pattern: ogni view si registra con `route('#nome', renderFn)`.
 * Quando cambia `window.location.hash`, viene chiamata la render corrispondente.
 *
 * @module frontend/js/router
 */

import { state } from './state.js';

const routes = new Map();
let currentRoute = null;
let onChange = null;

/**
 * Registra una route.
 *
 * @param {string} hash - '#home', '#create', '#join', '#lobby', '#game'
 * @param {function} renderFn - fn(params) => string (HTML) o HTMLElement
 */
export function route(hash, renderFn) {
  routes.set(hash, renderFn);
}

/**
 * Naviga a una route.
 *
 * @param {string} hash
 */
export function navigate(hash) {
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  } else {
    // Già su quella route, forza re-render
    _renderCurrent();
  }
}

/**
 * Imposta la callback chiamata dopo ogni cambio route.
 * Usata per re-render della app principale.
 *
 * @param {function} callback
 */
export function onRouteChange(callback) {
  onChange = callback;
}

/**
 * Ritorna la route corrente.
 * @returns {string|null}
 */
export function current() {
  return currentRoute;
}

/**
 * Ritorna i parametri dall'hash (es. #lobby?gameId=abc → { gameId: 'abc' }).
 */
function getParams() {
  const hash = window.location.hash;
  const queryIdx = hash.indexOf('?');
  if (queryIdx === -1) return { base: hash, params: {} };
  const base = hash.substring(0, queryIdx);
  const queryStr = hash.substring(queryIdx + 1);
  const params = {};
  for (const pair of queryStr.split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return { base, params };
}

function _renderCurrent() {
  const { base, params } = getParams();
  currentRoute = base || '#home';
  const renderFn = routes.get(currentRoute) || routes.get('#home');
  if (!renderFn) {
    console.warn('[router] nessuna route per', currentRoute, 'fallback su #home');
    return;
  }
  if (onChange) onChange(renderFn, params);
}

/**
 * Avvia il router.
 */
export function start() {
  window.addEventListener('hashchange', _renderCurrent);
  // Render iniziale
  if (!window.location.hash) {
    window.location.hash = '#home';
  } else {
    _renderCurrent();
  }
}
