-- =====================================================================
-- setup-user.sql v3 — Setup utente e DB "Parole Mutanti"
-- Eseguire come superuser: `sudo -u postgres psql -f db/setup-user.sql`
-- (deploy.sh passa la password con `-v db_password=...`)
--
-- Strategia:
--   1. Cleanup (DROP se esiste) per partire pulito
--   2. Crea utente: usa la password da `-v db_password` o ne genera una
--   3. Crea database (top-level, non in DO block)
--   4. Permessi completi su schema public
--
-- Idempotente? SÌ, fa DROP prima di CREATE.
-- =====================================================================

-- 1. Cleanup preventivo (ignora errori se non esistono)
DROP DATABASE IF EXISTS parole_mutanti;
DROP USER IF EXISTS parole_user;

-- 2. Crea utente: usa la password da `-v db_password` o ne genera una.
-- NOTA: psql NON sostituisce le variabili dentro $$...$$, quindi il CREATE USER
-- è fatto a livello top-level usando :'my_password' (sostituito da psql).
\if :{?db_password}
  \set my_password :'db_password'
\else
  \set my_password `openssl rand -hex 18`
  \echo '🔑 Nessuna password fornita: generata automaticamente.'
\endif

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE USER parole_user WITH PASSWORD :'my_password';
\echo ===========================================
\echo ✅ UTENTE CREATO: parole_user
\echo PASSWORD: :my_password
\echo ===========================================
\echo Aggiungi questa password al DATABASE_URL (host localhost, db parole_mutanti).
\echo

-- 3. Crea database (comando top-level, NON in DO block)
CREATE DATABASE parole_mutanti
    OWNER parole_user
    ENCODING 'UTF8'
    LC_COLLATE 'C'
    TEMPLATE template0;

-- 4. Connetti al nuovo DB e configura permessi schema
\c parole_mutanti

-- pgcrypto serve anche qui (alcune funzioni di partita potrebbero servire)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Permessi completi sullo schema public
GRANT ALL ON SCHEMA public TO parole_user;
ALTER SCHEMA public OWNER TO parole_user;

-- Permessi futuri per tabelle/sequenze/funzioni create dall'app
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO parole_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO parole_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO parole_user;

\echo
\echo '=== ✅ Setup completato con successo ==='
\echo 'Copia la password generata nel file .env alla riga DATABASE_URL'
\echo
