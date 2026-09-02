/**
 * ui.js — Componenti UI self-made che sostituiscono i popup di sistema
 * (alert / confirm / prompt), che non sono stilizzabili né accessibili.
 *
 * Espone:
 *  - toast(messaggio, {tipo, durata})      → notifica non bloccante, auto-dismiss
 *  - confirmModal({titolo, messaggio, ...}) → Promise<boolean> (true = confermato)
 *  - copyModal(url)                         → modal con input + copia negli appunti
 *
 * Vanilla JS + CSS puro, coerente con le regole 03:
 * - niente inline style: solo classi definite in components.css
 * - variabili CSS per il theming dark/light
 * - transizioni limitate a transform/opacity
 * - accessibilità: aria-live sui toast, role + focus trap sul modal
 *
 * @module frontend/js/ui
 */

/* ------------------------------------------------------------------
   Toast: notifiche temporanee impilate in basso
   ------------------------------------------------------------------ */
const TOAST_TIPI = { info: '', success: '✅ ', error: '⚠️ ' };

/**
 * Mostra un toast non bloccante in basso allo schermo.
 * @param {string} messaggio - Testo da mostrare.
 * @param {object} [opzioni]
 * @param {'info'|'success'|'error'} [opzioni.tipo='info'] - Colore/icona del toast.
 * @param {number} [opzioni.durata=3000] - Durata in ms prima dell'auto-dismiss.
 * @returns {HTMLElement} Elemento toast creato.
 */
export function toast(messaggio, { tipo = 'info', durata = 3000 } = {}) {
  const container = ottieniContainer('#pm-toast-container');
  container.setAttribute('aria-live', 'polite');

  const el = document.createElement('div');
  el.className = `toast toast--${tipo}`;
  el.setAttribute('role', 'status');
  el.textContent = (TOAST_TIPI[tipo] || '') + messaggio;

  container.appendChild(el);

  // Forza il reflow così la transizione di ingresso parte dopo il mount.
  el.getBoundingClientRect();
  el.classList.add('toast--visible');

  window.setTimeout(() => {
    el.classList.remove('toast--visible');
    // Rimuove il nodo al termine della transizione di uscita.
    window.setTimeout(() => el.remove(), 250);
  }, durata);

  return el;
}

/* ------------------------------------------------------------------
   Modal di conferma (sostituisce confirm)
   ------------------------------------------------------------------ */
/**
 * Mostra un modal di conferma e risolve la Promise con l'esito.
 * @param {object} opzioni
 * @param {string} opzioni.titolo - Titolo del modal.
 * @param {string} opzioni.messaggio - Testo descrittivo.
 * @param {string} [opzioni.conferma='Conferma'] - Etichetta bottone conferma.
 * @param {string} [opzioni.annulla='Annulla'] - Etichetta bottone annulla.
 * @param {'default'|'danger'} [opzioni.tone='default'] - Tono del bottone conferma.
 * @returns {Promise<boolean>} true se l'utente conferma, false altrimenti.
 */
export function confirmModal({
  titolo = 'Conferma',
  messaggio = '',
  conferma = 'Conferma',
  annulla = 'Annulla',
  tone = 'default',
} = {}) {
  return new Promise((resolve) => {
    const root = ottieniContainer('#pm-modal-root');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'presentation');

    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'pm-modal-title');
    box.setAttribute('aria-describedby', 'pm-modal-body');

    box.innerHTML = `
      <header class="modal__header">
        <h2 class="modal__title" id="pm-modal-title"></h2>
      </header>
      <div class="modal__body" id="pm-modal-body"></div>
      <footer class="modal__actions">
        <button type="button" class="btn btn-secondary" data-modal-azione="annulla"></button>
        <button type="button" class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}" data-modal-azione="conferma"></button>
      </footer>
    `;

    box.querySelector('#pm-modal-title').textContent = titolo;
    box.querySelector('#pm-modal-body').textContent = messaggio;
    box.querySelector('[data-modal-azione="annulla"]').textContent = annulla;
    box.querySelector('[data-modal-azione="conferma"]').textContent = conferma;

    overlay.appendChild(box);
    root.appendChild(overlay);

    const concentra = (azione) => chiudiModal(overlay, () => resolve(azione === 'conferma'));

    // Click sul backdrop = annulla.
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) concentra('annulla');
    });
    // Click sui bottoni.
    box.addEventListener('click', (ev) => {
      const azione = ev.target.closest('[data-modal-azione]')?.dataset.modalAzione;
      if (azione) concentra(azione);
    });
    // Tastiera: Escape = annulla, Tab = focus trap.
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') concentra('annulla');
      if (ev.key === 'Tab') gestisciFocusTrap(ev, box);
    });

    // Focus iniziale (sul bottone conferma).
    box.querySelector('[data-modal-azione="conferma"]').focus();
  });
}

/* ------------------------------------------------------------------
   Modal di copia link (sostituisce il fallback prompt)
   ------------------------------------------------------------------ */
/**
 * Mostra un modal con un URL di sola lettura e un bottone per copiarlo.
 * Su successo mostra un toast. Usato come fallback quando il clipboard
 * non è disponibile.
 * @param {string} url - URL da mostrare e copiare.
 * @returns {Promise<void>}
 */
export async function copyModal(url) {
  return new Promise((resolve) => {
    const root = ottieniContainer('#pm-modal-root');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'presentation');

    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'pm-copy-title');

    box.innerHTML = `
      <header class="modal__header">
        <h2 class="modal__title" id="pm-copy-title">Copia il link della partita</h2>
      </header>
      <div class="modal__body">
        <p class="text-small text-muted">Condividi questo link con i tuoi amici per unirsi alla partita.</p>
        <input type="text" class="form-input" data-copy-input readonly aria-label="Link della partita">
      </div>
      <footer class="modal__actions">
        <button type="button" class="btn btn-secondary" data-modal-azione="chiudi">Chiudi</button>
        <button type="button" class="btn btn-primary" data-modal-azione="copia">📋 Copia</button>
      </footer>
    `;

    box.querySelector('[data-copy-input]').value = url;
    overlay.appendChild(box);
    root.appendChild(overlay);

    const chiudi = () => chiudiModal(overlay, resolve);

    box.addEventListener('click', async (ev) => {
      const azione = ev.target.closest('[data-modal-azione]')?.dataset.modalAzione;
      if (azione === 'chiudi') return chiudi();
      if (azione === 'copia') {
        const input = box.querySelector('[data-copy-input]');
        input.select();
        try {
          await navigator.clipboard.writeText(url);
          toast('Link della partita copiato negli appunti!', { tipo: 'success' });
          chiudi();
        } catch (err) {
          // Clipboard non disponibile: lascia l'input selezionato per copia manuale.
          toast('Seleziona il testo e copialo manualmente (Ctrl+C).', { tipo: 'info' });
        }
      }
    });

    // Escape = chiudi.
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') chiudi();
      if (ev.key === 'Tab') gestisciFocusTrap(ev, box);
    });

    const input = box.querySelector('[data-copy-input]');
    input.focus();
    input.select();
  });
}

/* ------------------------------------------------------------------
   Helper interni
   ------------------------------------------------------------------ */

/** Restituisce (creandolo se serve) un elemento contenitore a livello body. */
function ottieniContainer(selector) {
  let el = document.querySelector(selector);
  if (el) return el;
  el = document.createElement('div');
  el.id = selector.slice(1);
  document.body.appendChild(el);
  return el;
}

/**
 * Chiude il modal: esegue l'eventuale callback di esito (l'azione scelta).
 * @param {HTMLElement} overlay - L'overlay del modal da rimuovere.
 * @param {() => void} [onChiusura] - Callback invocata al momento della chiusura.
 */
function chiudiModal(overlay, onChiusura) {
  if (onChiusura) onChiusura();
  overlay.classList.add('modal-overlay--chiudo');
  // Rimuove il nodo dopo la transizione di uscita.
  window.setTimeout(() => overlay.remove(), 200);
}

/**
 * Focus trap del modal: mantiene il focus dentro i bottoni del dialog.
 * @param {KeyboardEvent} ev - L'evento keydown di Tab.
 * @param {HTMLElement} box - Il contenitore del dialog.
 */
function gestisciFocusTrap(ev, box) {
  const focusabili = Array.from(box.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!focusabili.length) return;

  const primo = focusabili[0];
  const ultimo = focusabili[focusabili.length - 1];

  if (ev.shiftKey && document.activeElement === primo) {
    ev.preventDefault();
    ultimo.focus();
  } else if (!ev.shiftKey && document.activeElement === ultimo) {
    ev.preventDefault();
    primo.focus();
  }
}
