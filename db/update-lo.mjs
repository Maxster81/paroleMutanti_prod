/**
 * update-lo.mjs — Aggiorna dizionario LO con incrementale
 *
 * Strategia:
 *   1. Scarica it_IT.dic (salva in /tmp)
 *   2. Parsing + filtro (come import-lo-dict.mjs)
 *   3. INSERT con ON CONFLICT DO NOTHING (solo parole nuove)
 *
 * Uso: node db/update-lo.mjs
 *
 * @module db/update-lo
 */

import { writeFile, readFile, unlink } from 'node:fs/promises';
import { query } from '../backend/src/db/pool.js';

const DICT_URL = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/it_IT/it_IT.dic';
const TMP_FILE = '/tmp/it_IT.dic';
const MIN_LENGTH = 3;
const MAX_LENGTH = 10;

// Charset: lettere italiane + prestiti consolidati
const RE_CHARSET = /^[a-zàèéìòùjkwxy']+$/;

function validaParola(parola) {
  if (!parola) return null;
  if (parola.length < MIN_LENGTH || parola.length > MAX_LENGTH) return null;
  if (!RE_CHARSET.test(parola)) return null;
  return parola;
}

function parseLine(linea) {
  if (!linea) return null;
  const idx = linea.indexOf('/');
  return idx === -1 ? linea : linea.substring(0, idx);
}

async function main() {
  console.log('[update-lo] Download dizionario...');
  const response = await fetch(DICT_URL);
  if (!response.ok) {
    throw new Error(`Download fallito: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(TMP_FILE, buffer);
  console.log(`[update-lo] Scaricato ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

  // Parse
  const contenuto = await readFile(TMP_FILE, 'utf-8');
  const linee = contenuto.split('\n');
  const setParole = new Set();
  for (const linea of linee) {
    const trimmed = linea.trim();
    if (!trimmed || trimmed.startsWith('/')) continue;
    const parolaBase = parseLine(trimmed);
    const parolaNorm = parolaBase ? parolaBase.toLowerCase() : null;
    if (validaParola(parolaNorm)) setParole.add(parolaNorm);
  }

  console.log(`[update-lo] Parole valide da LO: ${setParole.size}`);

  // INSERT con ON CONFLICT (solo nuove)
  const BATCH = 500;
  const paroleArray = Array.from(setParole);
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
  }

  console.log(`[update-lo] ✅ Update completato. ${inserite} parole elaborate (alcune già presenti).`);

  const stats = await query(`SELECT source, COUNT(*) AS n FROM words GROUP BY source ORDER BY source`);
  console.log('[update-lo] Stato attuale DB:');
  for (const r of stats.rows) {
    console.log(`  ${r.source}: ${r.n}`);
  }

  try { await unlink(TMP_FILE); } catch {}
}

main().catch((err) => {
  console.error('[update-lo] ❌ Errore fatale:', err);
  process.exit(1);
});
