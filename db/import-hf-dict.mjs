/**
 * import-hf-dict.mjs — Importa dizionario italiano HuggingFace (mik3ml/italian-dictionary)
 *
 * Formato file: JSON array di {id, word, definition}
 * - 313k record da Wiktionary
 * - Solo campo `word` serve a noi (definizioni ignorate)
 * - Licenza: CC BY-SA 4.0 (Wiktionary)
 *
 * Strategia:
 *   - Download dictionary_sorted.json (~95MB)
 *   - Parse JSON
 *   - Filtro: lunghezza 3-10, charset italiano (a-z + àèéìòù + jkwxy) + apostrofo
 *   - Dedup con Set
 *   - INSERT con ON CONFLICT DO NOTHING (source='HF')
 *
 * @module db/import-hf-dict
 */

import { writeFile, readFile, unlink } from 'node:fs/promises';
import { query } from '../backend/src/db/pool.js';

const DICT_URL = 'https://huggingface.co/datasets/mik3ml/italian-dictionary/resolve/main/dictionary_sorted.json';
const TMP_FILE = '/tmp/dict_hf.json';
const MIN_LENGTH = 3;
const MAX_LENGTH = 10;

// Charset: lettere italiane + prestiti consolidati
const RE_CHARSET = /^[a-zàèéìòùjkwxy']+$/;

async function download() {
  console.log(`[import-hf] Download da: ${DICT_URL}`);
  console.log('[import-hf] ATTENZIONE: file ~95MB, download lento');
  const response = await fetch(DICT_URL);
  if (!response.ok) {
    throw new Error(`Download fallito: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(TMP_FILE, buffer);
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
  console.log(`[import-hf] Scaricato ${sizeMB} MB in ${TMP_FILE}`);
  return buffer;
}

function validaParola(parola) {
  if (!parola) return null;
  if (parola.length < MIN_LENGTH || parola.length > MAX_LENGTH) return null;
  if (!RE_CHARSET.test(parola)) return null;
  return parola;
}

async function importToDb(setParole) {
  const paroleArray = Array.from(setParole);
  console.log(`[import-hf] Inizio INSERT di ${paroleArray.length} parole...`);

  const BATCH = 500;
  let inserite = 0;

  for (let i = 0; i < paroleArray.length; i += BATCH) {
    const batch = paroleArray.slice(i, i + BATCH);
    const values = [];
    const placeholders = [];
    batch.forEach((p, j) => {
      placeholders.push(`($${j * 2 + 1}, $${j * 2 + 2}, 'HF')`);
      values.push(p, p.length);
    });
    await query(
      `INSERT INTO words (word, length, source) VALUES ${placeholders.join(', ')} ON CONFLICT (word) DO NOTHING`,
      values
    );
    inserite += batch.length;
    if (i % 20000 === 0 && i > 0) {
      console.log(`[import-hf] ${inserite}/${paroleArray.length} elaborate...`);
    }
  }

  return inserite;
}

async function main() {
  const inizio = Date.now();
  await download();

  console.log('[import-hf] Parsing JSON (potrebbe richiedere ~30s per 95MB)...');
  const parseStart = Date.now();
  const raw = await readFile(TMP_FILE, 'utf-8');
  const data = JSON.parse(raw);
  console.log(`[import-hf] JSON parsato in ${((Date.now() - parseStart) / 1000).toFixed(1)}s, ${data.length} record`);

  const setParole = new Set();
  let scartate = 0;

  for (const record of data) {
    if (!record.word) continue;
    const parolaNorm = record.word.toLowerCase().trim();
    if (validaParola(parolaNorm)) {
      setParole.add(parolaNorm);
    } else {
      scartate++;
    }
  }

  console.log(`[import-hf] Record processati: ${data.length}`);
  console.log(`[import-hf] Scartate (lunghezza/charset): ${scartate}`);
  console.log(`[import-hf] Parole uniche da inserire: ${setParole.size}`);

  const inserite = await importToDb(setParole);
  const durata = ((Date.now() - inizio) / 1000).toFixed(1);
  console.log(`[import-hf] ✅ ${inserite} parole elaborate in ${durata}s`);

  const stats = await query(`SELECT source, COUNT(*) AS n FROM words GROUP BY source ORDER BY source`);
  console.log('[import-hf] Distribuzione per source:');
  for (const r of stats.rows) {
    console.log(`  ${r.source}: ${r.n}`);
  }

  try { await unlink(TMP_FILE); } catch {}

  console.log('[import-hf] 🎉 Import completato.');
}

main().catch((err) => {
  console.error('[import-hf] ❌ Errore fatale:', err);
  process.exit(1);
});
