/**
 * import-lo-dict.mjs — Importa dizionario italiano LibreOffice (it_IT.dic)
 *
 * Formato file: MySpell/Hunspell (.dic)
 *   - Righe che iniziano con "/" sono commenti
 *   - Ogni parola è su una riga, opzionalmente con flag morfologici: "parola/FLAG"
 *   - Può contenere apostrofi (es. "po'", "un'")
 *
 * Strategia:
 *   - Download it_IT.dic da GitHub (encoding UTF-8 dichiarato)
 *   - Parsing: split su "/" per estrarre solo la parola base
 *   - Filtro: lunghezza 3-10, charset italiano (a-z + àèéìòù + j, k, w, x, y) + apostrofo
 *   - Dedup con Set
 *   - INSERT batch con ON CONFLICT DO NOTHING
 *   - source='LO' (LibreOffice)
 *
 * @module db/import-lo-dict
 */

import { writeFile, readFile, unlink } from 'node:fs/promises';
import { query } from '../backend/src/db/pool.js';

const DICT_URL = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/it_IT/it_IT.dic';
const TMP_FILE = '/tmp/it_IT.dic';
const MIN_LENGTH = 3;
const MAX_LENGTH = 10;

// Charset: lettere italiane + prestiti consolidati (wifi, weekend, jazz, kiwi, yogurt)
const RE_CHARSET = /^[a-zàèéìòùjkwxy']+$/;

async function download() {
  console.log(`[import-lo] Download da: ${DICT_URL}`);
  const response = await fetch(DICT_URL);
  if (!response.ok) {
    throw new Error(`Download fallito: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(TMP_FILE, buffer);
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
  console.log(`[import-lo] Scaricato ${sizeMB} MB in ${TMP_FILE}`);
  return buffer;
}

function parseLine(linea) {
  if (!linea) return null;
  const idx = linea.indexOf('/');
  return idx === -1 ? linea : linea.substring(0, idx);
}

function validaParola(parola) {
  if (!parola) return null;
  if (parola.length < MIN_LENGTH || parola.length > MAX_LENGTH) return null;
  if (!RE_CHARSET.test(parola)) return null;
  return parola;
}

async function importToDb(setParole) {
  const paroleArray = Array.from(setParole);
  console.log(`[import-lo] Inizio INSERT di ${paroleArray.length} parole...`);

  const BATCH = 500;
  let inserite = 0;

  for (let i = 0; i < paroleArray.length; i += BATCH) {
    const batch = paroleArray.slice(i, i + BATCH);
    const values = [];
    const placeholders = [];
    batch.forEach((p, j) => {
      placeholders.push(`($${j * 2 + 1}, $${j * 2 + 2}, 'LO')`);
      values.push(p, p.length);
    });
    await query(
      `INSERT INTO words (word, length, source) VALUES ${placeholders.join(', ')} ON CONFLICT (word) DO NOTHING`,
      values
    );
    inserite += batch.length;
    if (i % 10000 === 0 && i > 0) {
      console.log(`[import-lo] ${inserite}/${paroleArray.length} elaborate...`);
    }
  }

  return inserite;
}

async function main() {
  const inizio = Date.now();
  await download();

  const contenuto = await readFile(TMP_FILE, 'utf-8');
  const linee = contenuto.split('\n');
  const setParole = new Set();
  let scartate = 0;

  for (const linea of linee) {
    const trimmed = linea.trim();
    if (!trimmed || trimmed.startsWith('/')) continue;
    const parolaBase = parseLine(trimmed);
    const parolaNorm = parolaBase ? parolaBase.toLowerCase() : null;
    if (validaParola(parolaNorm)) {
      setParole.add(parolaNorm);
    } else {
      scartate++;
    }
  }

  console.log(`[import-lo] Righe lette: ${linee.length}`);
  console.log(`[import-lo] Scartate (lunghezza/charset): ${scartate}`);
  console.log(`[import-lo] Parole uniche da inserire: ${setParole.size}`);

  const inserite = await importToDb(setParole);
  const durata = ((Date.now() - inizio) / 1000).toFixed(1);
  console.log(`[import-lo] ✅ ${inserite} parole elaborate in ${durata}s`);

  const stats = await query(`SELECT source, COUNT(*) AS n FROM words GROUP BY source`);
  console.log('[import-lo] Distribuzione per source:');
  for (const r of stats.rows) {
    console.log(`  ${r.source}: ${r.n}`);
  }

  try { await unlink(TMP_FILE); } catch {}

  console.log('[import-lo] 🎉 Import completato.');
}

main().catch((err) => {
  console.error('[import-lo] ❌ Errore fatale:', err);
  process.exit(1);
});
