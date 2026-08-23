/**
 * check-db.js — Verifica stato database "Parole Mutanti"
 *
 * Uso: node db/check-db.js
 * Controlla connessione, tabelle, conteggi, e query random di test.
 *
 * @module db/check-db
 */

import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

/**
 * Esegue una serie di check diagnostici sul database.
 *
 * @returns {Promise<void>}
 */
async function checkDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Variabile DATABASE_URL mancante. Controlla il file .env');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log('[check-db] ✅ Connessione al database riuscita.\n');

  try {
    // 1. Tabelle presenti
    const tabelle = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('📋 Tabelle presenti:');
    if (tabelle.rows.length === 0) {
      console.log('   ⚠️  Nessuna tabella. Esegui `npm run db:init` prima.');
    } else {
      for (const riga of tabelle.rows) {
        console.log(`   - ${riga.table_name}`);
      }
    }
    console.log('');

    // 2. Conteggio parole
    const conteggio = await client.query('SELECT COUNT(*) AS totale FROM words');
    const totaleParole = parseInt(conteggio.rows[0].totale, 10);
    console.log(`📚 Parole totali nel dizionario: ${totaleParole}`);
    if (totaleParole === 0) {
      console.log('   ⚠️  Dizionario vuoto. Esegui `npm run db:import` per popolare.');
    }
    console.log('');

    // 3. Distribuzione per lunghezza
    if (totaleParole > 0) {
      const distrib = await client.query(
        'SELECT length, count FROM words_count_by_length ORDER BY length'
      );
      console.log('📊 Distribuzione per lunghezza:');
      for (const riga of distrib.rows) {
        console.log(`   ${String(riga.length).padStart(2)} lettere: ${riga.count} parole`);
      }
      console.log('');

      // 4. Test query random
      console.log('🎲 Test query random (5 lettere):');
      const random5 = await client.query(
        `SELECT word FROM words WHERE length = 5 ORDER BY random() LIMIT 5`
      );
      for (const riga of random5.rows) {
        console.log(`   - ${riga.word}`);
      }
      console.log('');

      console.log('🎲 Test query random (7 lettere):');
      const random7 = await client.query(
        `SELECT word FROM words WHERE length = 7 ORDER BY random() LIMIT 3`
      );
      for (const riga of random7.rows) {
        console.log(`   - ${riga.word}`);
      }
      console.log('');

      // 5. Misurazione performance query random
      const start = process.hrtime.bigint();
      await client.query(`SELECT word FROM words WHERE length = 6 ORDER BY random() LIMIT 1`);
      const end = process.hrtime.bigint();
      const durataMs = Number(end - start) / 1_000_000;
      console.log(`⚡ Performance query random (6 lettere): ${durataMs.toFixed(2)}ms`);
      if (durataMs > 50) {
        console.log('   ⚠️  Query lenta, valuta VACUUM ANALYZE words o indici migliori');
      } else {
        console.log('   ✅ Performance OK');
      }
    }

    // 6. Stato partite
    const partite = await client.query(`
      SELECT state, COUNT(*) AS count
      FROM games
      GROUP BY state
    `);
    console.log('\n🎮 Stato partite:');
    if (partite.rows.length === 0) {
      console.log('   Nessuna partita ancora registrata.');
    } else {
      for (const riga of partite.rows) {
        console.log(`   ${riga.state}: ${riga.count}`);
      }
    }

    // 7. Info Postgres
    const infoPg = await client.query('SELECT version()');
    console.log(`\n🐘 ${infoPg.rows[0].version}`);
  } catch (errore) {
    console.error('[check-db] ❌ ERRORE:', errore.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

checkDatabase().catch((errore) => {
  console.error('[check-db] Errore fatale:', errore);
  process.exit(1);
});
