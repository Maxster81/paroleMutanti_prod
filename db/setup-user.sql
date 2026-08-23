-- =====================================================================
-- setup-user.sql v2 — Setup utente e DB "Parole Mutanti" (versione robusta)
-- Eseguire come superuser: `sudo -u postgres psql -f db/setup-user.sql`
--
-- Strategia:
--   1. Cleanup (DROP se esiste) per partire pulito
--   2. Abilita pgcrypto per gen_random_bytes
--   3. Crea utente con password generata
--   4. Crea database (top-level, non in DO block)
--   5. Permessi completi su schema public
--
-- Idempotente? SÌ, fa DROP prima di CREATE.
-- =====================================================================

-- 1. Cleanup preventivo (ignora errori se non esistono)
DROP DATABASE IF EXISTS parole_mutanti;
DROP USER IF EXISTS parole_user;

-- 2. Crea utente con password generata (pgcrypto serve per gen_random_bytes)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$
DECLARE
  generated_password TEXT;
BEGIN
  generated_password := encode(gen_random_bytes(18), 'hex');
  EXECUTE format('CREATE USER parole_user WITH PASSWORD %L', generated_password);
  RAISE NOTICE '===========================================';
  RAISE NOTICE '✅ UTENTE CREATO: parole_user';
  RAISE NOTICE '🔑 PASSWORD (copiala nel .env): %', generated_password;
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Esempio DATABASE_URL: postgresql://parole_user:%@localhost:5432/parole_mutanti', generated_password;
END
$$;

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
