/**
 * views/feedback.js — View del form di feedback
 *
 * Raccolta di suggerimenti/problemi con tipo e sottocategoria.
 * Invia via POST /api/feedback (il backend salva in DB e inoltra a Telegram).
 *
 * @module frontend/js/views/feedback
 */

import { navigate } from '../router.js';
import { inviaFeedback } from '../api.js';
import { click as audioClick, success, buzzer } from '../audio.js';

const TIPI = [
  { value: 'suggerimento', label: '💡 Suggerimento' },
  { value: 'problema', label: '🐞 Problema' },
  { value: 'altro', label: '📝 Altro' },
];

const SOTTOCATEGORIE = {
  suggerimento: ['Gameplay', 'Parole / regole', 'Interfaccia', 'Audio', 'Altro'],
  problema: ['Bug / crash', 'Connessione', 'Timer / turni', 'Grafica', 'Altro'],
  altro: ['Generale'],
};

function optionList(values) {
  return values.map((s) => `<option value="${escapeAttr(s)}">${s}</option>`).join('');
}

export function renderFeedback() {
  const nome = localStorage.getItem('pm-nome') || '';
  return `
    <div class="form-view">
      <div class="form-view-header">
        <h2 class="form-view-title">💬 Invia un feedback</h2>
        <p class="form-view-subtitle">Suggerimenti, problemi o segnalazioni. Aiutaci a migliorare!</p>
      </div>
      <form id="feedback-form">
        <div class="form-group">
          <label class="form-label" for="fb-tipo">Tipo</label>
          <select class="form-select" id="fb-tipo" name="tipo">
            ${TIPI.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="fb-sottocategoria">Sottocategoria</label>
          <select class="form-select" id="fb-sottocategoria" name="sottocategoria">
            ${optionList(SOTTOCATEGORIE['suggerimento'])}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="fb-nome">Il tuo nome (opzionale)</label>
          <input class="form-input" type="text" id="fb-nome" name="nome" maxlength="20" placeholder="Es. Mario" value="${escapeAttr(nome)}" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label" for="fb-testo">Il tuo messaggio *</label>
          <textarea class="form-input" id="fb-testo" name="testo" required minlength="3" maxlength="2000" rows="5" placeholder="Descrivi qui il tuo feedback..."></textarea>
          <p class="form-help">Minimo 3 caratteri.</p>
        </div>
        <div id="fb-error" class="alert alert-error" style="display: none;"></div>
        <div id="fb-success" class="alert alert-success" style="display: none;"></div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-block" id="btn-fb-submit">📤 Invia feedback</button>
          <button type="button" class="btn btn-ghost btn-block" id="btn-fb-back">← Torna alla home</button>
        </div>
      </form>
    </div>
  `;
}

export function attachFeedbackHandlers() {
  const backBtn = document.getElementById('btn-fb-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => { audioClick(); navigate('#home'); });
  }

  const form = document.getElementById('feedback-form');
  if (!form) return;

  const tipoSel = document.getElementById('fb-tipo');
  const subSel = document.getElementById('fb-sottocategoria');

  // Al cambio tipo, aggiorna le sottocategorie disponibili
  tipoSel.addEventListener('change', () => {
    const opts = SOTTOCATEGORIE[tipoSel.value] || SOTTOCATEGORIE['altro'];
    subSel.innerHTML = optionList(opts);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    audioClick();
    const errorBox = document.getElementById('fb-error');
    const successBox = document.getElementById('fb-success');
    const submitBtn = document.getElementById('btn-fb-submit');
    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    const payload = {
      tipo: tipoSel.value,
      sottocategoria: subSel.value,
      nome: document.getElementById('fb-nome').value.trim(),
      testo: document.getElementById('fb-testo').value.trim(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Invio...';

    const resp = await inviaFeedback(payload);

    submitBtn.disabled = false;
    submitBtn.textContent = '📤 Invia feedback';

    if (!resp.ok) {
      errorBox.textContent = resp.messaggio || 'Invio non riuscito. Riprova più tardi.';
      errorBox.style.display = 'block';
      buzzer();
      return;
    }

    successBox.textContent = 'Grazie! Feedback inviato.';
    successBox.style.display = 'block';
    success();
    form.reset();
    // Dopo il reset riporta a uno stato coerente
    tipoSel.value = 'suggerimento';
    subSel.innerHTML = optionList(SOTTOCATEGORIE['suggerimento']);
  });
}

function escapeAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;');
}
