/**
 * import-words.js — Importa dizionario italiano nel database
 *
 * Scarica lo ZIP del dizionario da GitHub (napolux/paroleitaliane), estrae
 * `paroleitaliane/parole_uniche.txt` in memoria, filtra per lunghezza
 * (3-10 lettere di default), normalizza (lowercase) e fa bulk insert con COPY.
 *
 * Uso:
 *   node db/import-words.js
 *   node db/import-words.js --file=/path/to/parole_uniche.txt
 *   node db/import-words.js --min=3 --max=10
 *
 * Variabili d'ambiente:
 *   DATABASE_URL            (obbligatoria, da .env)
 *   IMPORT_MIN_LENGTH=3     (override CLI)
 *   IMPORT_MAX_LENGTH=10    (override CLI)
 *   IMPORT_REMOVE_ACCENTS=0 (1 per rimuovere accenti)
 *
 * @module db/import-words
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { writeFile, unlink } from 'node:fs/promises';
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

// Parsing argomenti CLI
const args = process.argv.slice(2);
const argMap = {};
for (const arg of args) {
  const match = arg.match(/^--([^=]+)=(.+)$/);
  if (match) argMap[match[1]] = match[2];
}

const MIN_LENGTH = parseInt(argMap.min || process.env.IMPORT_MIN_LENGTH || '3', 10);
const MAX_LENGTH = parseInt(argMap.max || process.env.IMPORT_MAX_LENGTH || '10', 10);
const REMOVE_ACCENTS = (argMap.noaccents || process.env.IMPORT_REMOVE_ACCENTS || '0') === '1';
const LOCAL_FILE = argMap.file || null;

// URL GitHub del file ZIP (contiene multipli vocabolari, useremo parole_uniche.txt)
const GITHUB_ZIP_URL = 'https://raw.githubusercontent.com/napolux/paroleitaliane/main/paroleitaliane.zip';
const TARGET_FILE_IN_ZIP = 'paroleitaliane/parole_uniche.txt';

/**
 * Normalizza una parola: lowercase e (opzionalmente) rimozione accenti.
 *
 * @param {string} parola - parola da normalizzare
 * @returns {string} parola normalizzata
 */
function normalizza(parola) {
  let p = parola.toLowerCase().trim();
  if (REMOVE_ACCENTS) {
    p = p.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return p;
}

/**
 * Verifica se la parola è accettabile (alfabetica, lunghezza giusta).
 *
 * @param {string} parola - parola già normalizzata
 * @returns {boolean} true se valida per inserimento
 */
function isParolaValida(parola) {
  if (parola.length < MIN_LENGTH || parola.length > MAX_LENGTH) return false;
  // Solo lettere italiane minuscole (incluse accenti)
  return /^[a-zàèéìòù]+$/.test(parola);
}

/**
 * Scarica lo ZIP, estrae il file target in memoria e fa yield delle righe.
 * Usa yauzl con il pattern "trova entry → apri readStream → chiudi zip".
 *
 * @returns {AsyncGenerator<string>} righe del file estratto
 */
async function* streamParoleDaZipGithub() {
  console.log(`[import-words] Download ZIP da: ${GITHUB_ZIP_URL}`);
  const response = await fetch(GITHUB_ZIP_URL);
  if (!response.ok) {
    throw new Error(`Download ZIP fallito: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const sizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(2);
  console.log(`[import-words] ZIP scaricato: ${sizeMB} MB`);

  const yauzl = await import('yauzl');
  const tmpPath = '/tmp/paroleitaliane.zip';
  await writeFile(tmpPath, Buffer.from(arrayBuffer));
  console.log(`[import-words] ZIP salvato in ${tmpPath}`);

  let zipFile = null;
  let readStream = null;
  try {
    // Apri ZIP in modalità lazy (entries lette on demand)
    zipFile = await new Promise((resolve, reject) => {
      yauzl.open(tmpPath, { lazyEntries: true }, (err, zf) => {
        if (err) reject(err);
        else resolve(zf);
      });
    });

    // Trova la entry target e aprine il readStream
    readStream = await new Promise((resolve, reject) => {
      let resolved = false;
      zipFile.on('entry', (entry) => {
        if (entry.fileName === TARGET_FILE_IN_ZIP) {
          // Apri il readStream SUBITO, prima di qualsiasi close
          zipFile.openReadStream(entry, (err, stream) => {
            if (err) reject(err);
            else resolve(stream);
          });
          resolved = true;
        } else {
          zipFile.readEntry();
        }
      });
      zipFile.on('end', () => {
        if (!resolved) reject(new Error(`File ${TARGET_FILE_IN_ZIP} non trovato nello ZIP`));
      });
      zipFile.on('error', reject);
      zipFile.readEntry();
    });

    // Ora possiamo chiudere lo zipFile (lo stream è già aperto e indipendente)
    zipFile.close();

    // Leggi lo stream riga per riga
    const rl = createInterface({ input: readStream, crlfDelay: Infinity });
    for await (const linea of rl) {
      yield linea;
    }
  } finally {
    if (zipFile) {
      try { zipFile.close(); } catch (e) { /* ignore */ }
    }
    if (readStream && !readStream.destroyed) {
      readStream.destroy();
    }
    try { await unlink(tmpPath); } catch (e) { /* ignore */ }
  }
}

/**
 * Stream di parole da file locale (già estratto).
 *
 * @param {string} pathFile - path al file
 * @returns {AsyncGenerator<string>} linee del file
 */
async function* streamParoleDaFile(pathFile) {
  console.log(`[import-words] Lettura da file locale: ${pathFile}`);
  if (!existsSync(pathFile)) {
    throw new Error(`File non trovato: ${pathFile}`);
  }
  const dimensione = statSync(pathFile).size;
  console.log(`[import-words] Dimensione: ${(dimensione / 1024 / 1024).toFixed(2)} MB`);

  const stream = createReadStream(pathFile, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const linea of rl) {
    yield linea;
  }
}

/**
 * Inserimento bulk con COPY (molto più veloce di INSERT multipli).
 *
 * @param {pg.Client} client - client connesso
 * @param {Set<string>} setParole - set di parole uniche da inserire
 * @returns {Promise<number>} numero di righe inserite
 */
async function insertBulk(client, setParole) {
  if (setParole.size === 0) return 0;

  // Prepara righe per COPY: word\tlength\tsource
  const righe = [];
  for (const parola of setParole) {
    righe.push(`${parola}\t${parola.length}\tDB`);
  }
  const csvData = righe.join('\n') + '\n';

  try {
    await client.query(
      `COPY words(word, length, source) FROM STDIN WITH (FORMAT text, DELIMITER E'\\t')`,
      csvData
    );
    return setParole.size;
  } catch (errore) {
    // Fallback: INSERT singoli con ON CONFLICT
    console.warn('[import-words] COPY fallito, fallback a INSERT singoli:', errore.message);
    const BATCH = 1000;
    const paroleArray = Array.from(setParole);
    for (let i = 0; i < paroleArray.length; i += BATCH) {
      const batch = paroleArray.slice(i, i + BATCH);
      const values = [];
      const placeholders = [];
      batch.forEach((p, j) => {
        placeholders.push(`($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`);
        values.push(p, p.length, 'DB');
      });
      await client.query(
        `INSERT INTO words (word, length, source) VALUES ${placeholders.join(', ')} ON CONFLICT (word) DO NOTHING`,
        values
      );
    }
    return setParole.size;
  }
}

/**
 * Funzione principale di import.
 *
 * @returns {Promise<void>}
 */
async function importaParole() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Variabile DATABASE_URL mancante. Controlla il file .env');
  }

  console.log('[import-words] Configurazione:');
  console.log(`  - Lunghezza: ${MIN_LENGTH}-${MAX_LENGTH} lettere`);
  console.log(`  - Rimuovi accenti: ${REMOVE_ACCENTS ? 'sì' : 'no'}`);
  console.log(`  - Sorgente: ${LOCAL_FILE || GITHUB_ZIP_URL}`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log('[import-words] Connesso al database.');

  try {
    // Pulisci tabella words
    console.log('[import-words] Pulizia tabella words...');
    await client.query('TRUNCATE TABLE words RESTART IDENTITY');

    const setParole = new Set();
    let lineeLette = 0;
    let paroleScartate = 0;
    const inizio = Date.now();

    // Scegli sorgente
    const iteratore = LOCAL_FILE
      ? streamParoleDaFile(LOCAL_FILE)
      : streamParoleDaZipGithub();

    // Raccogli in Set (così dedupichiamo)
    for await (const linea of iteratore) {
      lineeLette++;
      if (lineeLette % 50000 === 0) {
        process.stdout.write(`\r[import-words] Linee lette: ${lineeLette}, parole valide uniche: ${setParole.size}`);
      }
      const parola = normalizza(linea);
      if (parola && isParolaValida(parola)) {
        setParole.add(parola);
      } else if (parola) {
        paroleScartate++;
      }
    }
    process.stdout.write('\n');

    const durataLettura = ((Date.now() - inizio) / 1000).toFixed(1);
    console.log(`[import-words] Lettura completata in ${durataLettura}s`);
    console.log(`[import-words] - Linee totali lette: ${lineeLette}`);
    console.log(`[import-words] - Parole scartate (non valide): ${paroleScartate}`);
    console.log(`[import-words] - Parole uniche da inserire: ${setParole.size}`);

    // Inserimento bulk
    console.log('[import-words] Inizio inserimento bulk...');
    const inserite = await insertBulk(client, setParole);
    const durataTotale = ((Date.now() - inizio) / 1000).toFixed(1);
    console.log(`[import-words] Inserite ${inserite} parole in ${durataTotale}s totali`);

    // Verifica
    const conteggioTotale = await client.query('SELECT COUNT(*) AS totale FROM words');
    console.log(`[import-words] Totale parole nel DB: ${conteggioTotale.rows[0].totale}`);

    const perLunghezza = await client.query(
      'SELECT length, count FROM words_count_by_length ORDER BY length'
    );
    console.log('[import-words] Distribuzione per lunghezza:');
    for (const riga of perLunghezza.rows) {
      console.log(`  ${riga.length} lettere: ${riga.count} parole`);
    }
  } catch (errore) {
    console.error('[import-words] ERRORE:', errore.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Esegui se invocato direttamente
importaParole().catch((errore) => {
  console.error('[import-words] Errore fatale:', errore);
  process.exit(1);
});
