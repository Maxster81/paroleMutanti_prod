/**
 * reset-db.js — Drop e ricrea schema "Parole Mutanti"
 *
 * Uso: node db/reset-db.js
 * ATTENZIONE: cancella TUTTI i dati (parole, partite, log).
 *
 * @module db/reset-db
 */

import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SQL_FILE = join(__dirname, 'init-db.sql');

async function resetDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Variabile DATABASE_URL mancante. Controlla il file .env');
  }

  console.log('[reset-db] ⚠️  ATTENZIONE: questa operazione cancellerà TUTTI i dati.');
  console.log('[reset-db] Drop di tutte le tabelle e viste...');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('DROP TABLE IF EXISTS game_logs CASCADE');
    await client.query('DROP TABLE IF EXISTS games CASCADE');
    await client.query('DROP TABLE IF EXISTS words CASCADE');
    await client.query('DROP VIEW IF EXISTS words_count_by_length CASCADE');
    console.log('[reset-db] ✅ Drop completato.');
  } catch (errore) {
    console.error('[reset-db] ❌ ERRORE durante drop:', errore.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  // Ricrea schema
  console.log('[reset-db] Ricreazione schema...');
  const sql = await readFile(SQL_FILE, 'utf-8');
  const client2 = new Client({ connectionString: databaseUrl });
  await client2.connect();
  try {
    await client2.query(sql);
    console.log('[reset-db] ✅ Reset completato. Esegui `npm run db:import` per ripopolare.');
  } catch (errore) {
    console.error('[reset-db] ❌ ERRORE durante init:', errore.message);
    process.exit(1);
  } finally {
    await client2.end();
  }
}

resetDatabase().catch((errore) => {
  console.error('[reset-db] Errore fatale:', errore);
  process.exit(1);
});
