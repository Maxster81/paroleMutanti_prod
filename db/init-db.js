/**
 * init-db.js — Inizializza schema del database "Parole Mutanti"
 *
 * Uso: node db/init-db.js
 * Legge DATABASE_URL da .env, esegue db/init-db.sql.
 *
 * Prerequisito: setup-user.sql già eseguito come superuser postgres.
 *
 * @module db/init-db
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

// Calcolo path relativo a questo file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SQL_FILE = join(__dirname, 'init-db.sql');

/**
 * Esegue il file SQL di inizializzazione.
 * Usa una singola connessione e transazione implicita (DDL autocommit).
 * In caso di errore, mostra il comando SQL e rilancia.
 *
 * @returns {Promise<void>}
 */
async function initSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Variabile DATABASE_URL mancante. Controlla il file .env');
  }

  // Leggi il file SQL
  let sql;
  try {
    sql = await readFile(SQL_FILE, 'utf-8');
  } catch (errore) {
    throw new Error(`Impossibile leggere ${SQL_FILE}: ${errore.message}`);
  }

  // Connessione e esecuzione
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    console.log('[init-db] Connesso al database, esecuzione schema...');
    await client.query(sql);
    console.log('[init-db] Schema inizializzato con successo.');

    // Verifica rapida: elenca tabelle create
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('[init-db] Tabelle presenti:', result.rows.map((r) => r.table_name).join(', '));
  } catch (errore) {
    console.error('[init-db] ERRORE durante inizializzazione schema:');
    console.error(errore.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Esegui se invocato direttamente
initSchema().catch((errore) => {
  console.error('[init-db] Errore fatale:', errore);
  process.exit(1);
});
