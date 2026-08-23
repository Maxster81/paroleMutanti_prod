-- =====================================================================
-- init-db.sql — Schema iniziale "Parole Mutanti"
-- Eseguibile come utente `parole_user` (NON superuser).
-- Idempotente: `CREATE ... IF NOT EXISTS`.
-- =====================================================================

-- Estensione per gen_random_bytes (necessaria anche in setup-user.sql)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- Tabella: words
-- Dizionario italiano di parole valide (3-10 lettere).
-- Source: LO (LibreOffice), HF (Hugging Face), DB (legacy/altri), AI (DeepSeek)
-- =====================================================================
CREATE TABLE IF NOT EXISTS words (
    word TEXT PRIMARY KEY,
    length INTEGER NOT NULL CHECK (length BETWEEN 3 AND 20),
    source TEXT NOT NULL DEFAULT 'LO' CHECK (source IN ('LO', 'HF', 'DB', 'AI')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indici per query random veloce per lunghezza
CREATE INDEX IF NOT EXISTS idx_words_length ON words(length);
-- Indice composto utile per le query di gioco più frequenti
CREATE INDEX IF NOT EXISTS idx_words_length_source ON words(length, source);
-- Indice per ordinamento per data (es. ultime parole aggiunte dall'AI)
CREATE INDEX IF NOT EXISTS idx_words_created_at ON words(created_at DESC);

-- =====================================================================
-- Tabella: games
-- =====================================================================
CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'running', 'finished', 'cancelled')),
    params JSONB NOT NULL,
    players JSONB NOT NULL DEFAULT '[]'::jsonb,
    current_word TEXT,
    current_player_index INTEGER,
    words_played JSONB NOT NULL DEFAULT '[]'::jsonb,
    winner_name TEXT,
    games_won JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_games_state ON games(state);
CREATE INDEX IF NOT EXISTS idx_games_created_at ON games(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_winner_name ON games(winner_name) WHERE winner_name IS NOT NULL;

-- =====================================================================
-- Tabella: game_logs
-- =====================================================================
CREATE TABLE IF NOT EXISTS game_logs (
    id BIGSERIAL PRIMARY KEY,
    game_id UUID NOT NULL,
    words_played JSONB NOT NULL,
    winner_name TEXT,
    duration_seconds INTEGER,
    player_count INTEGER NOT NULL,
    total_turns INTEGER NOT NULL,
    ai_validations_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_logs_created_at ON game_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_logs_winner_name ON game_logs(winner_name) WHERE winner_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_game_logs_game_id ON game_logs(game_id);

-- =====================================================================
-- Vista di utilità
-- =====================================================================
CREATE OR REPLACE VIEW words_count_by_length AS
SELECT
    length,
    COUNT(*) AS count,
    MIN(created_at) AS first_added,
    MAX(created_at) AS last_added
FROM words
GROUP BY length
ORDER BY length;
