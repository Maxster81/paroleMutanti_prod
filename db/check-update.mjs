/**
 * check-update.mjs — Controlla se ci sono aggiornamenti dei dizionari
 *
 * Confronta l'ETag locale salvato in db/.last-etag con quello remoto.
 * Exit code:
 *   0 = aggiornamento disponibile (oppure primo check, nessun .last-etag)
 *   1 = nessun aggiornamento
 *   2 = errore
 *
 * Uso: node db/check-update.mjs
 *
 * @module db/check-update
 */

import { readFile, writeFile, existsSync } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ETAG_FILE = join(__dirname, '.last-etag-lo');

const DICT_URL = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/it_IT/it_IT.dic';

async function getRemoteEtag() {
  const response = await fetch(DICT_URL, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(`HEAD fallito: ${response.status}`);
  }
  return response.headers.get('etag');
}

async function getLocalEtag() {
  if (!existsSync(ETAG_FILE)) return null;
  try {
    return (await readFile(ETAG_FILE, 'utf-8')).trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('[check-update] Verifica aggiornamenti dizionario LO...');
  const remote = await getRemoteEtag();
  const local = await getLocalEtag();

  console.log(`[check-update] ETag locale:  ${local || '(nessuno)'}`);
  console.log(`[check-update] ETag remoto: ${remote || '(nessuno)'}`);

  if (!local) {
    console.log('[check-update] ⚠️  Nessun ETag locale. Update necessario per primo popolamento.');
    process.exit(0);
  }

  if (remote === local) {
    console.log('[check-update] ✅ Dizionario aggiornato, nessun update necessario.');
    process.exit(1);
  } else {
    console.log('[check-update] 🆕 Aggiornamento disponibile! Esegui `npm run db:update` per aggiornare.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[check-update] ❌ Errore:', err.message);
  process.exit(2);
});
