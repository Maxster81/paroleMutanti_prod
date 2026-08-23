#!/usr/bin/env bash
# =============================================================================
# backup.sh — Backup PostgreSQL di "Parole Mutanti"
# =============================================================================
# Esegue pg_dump del database (il dizionario, che cresce con le parole AI) e
# mantiene solo gli ultimi N backup (rotazione). Pensato per girare via cron
# (installato da deploy.sh) o manualmente.
#
# Configurazione (via env, con default sensati):
#   PAROLE_ENV_FILE      path del file env di produzione   (default /etc/parole-mutanti/.env)
#   PAROLE_BACKUP_DIR    cartella dei backup               (default /opt/paroleMutanti/backups)
#   PAROLE_BACKUP_RETENTION  quanti backup mantenere       (default 7)
#
# Utilizzo:
#   sudo ./deploy/backup.sh                # backup con i default
#   PAROLE_BACKUP_DIR=/x ./backup.sh       # cartella personalizzata
# =============================================================================
set -euo pipefail

ENV_FILE="${PAROLE_ENV_FILE:-/etc/parole-mutanti/.env}"
BACKUP_DIR="${PAROLE_BACKUP_DIR:-/opt/paroleMutanti/backups}"
RETENTION="${PAROLE_BACKUP_RETENTION:-7}"

if [ ! -f "$ENV_FILE" ]; then
    echo "[backup] ERRORE: env file $ENV_FILE non trovato" >&2
    exit 1
fi

# Carica le variabili (DATABASE_URL) dal file env di produzione
set -a
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
    echo "[backup] ERRORE: DATABASE_URL mancante in $ENV_FILE" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/parole_mutanti-$TS.sql.gz"

# Dump + compressione
pg_dump "$DATABASE_URL" | gzip > "$OUT"
chmod 600 "$OUT"

# Rotazione: mantiene solo gli ultimi RETENTION dump
ls -t "$BACKUP_DIR"/parole_mutanti-*.sql.gz 2>/dev/null \
    | tail -n +$((RETENTION + 1)) \
    | xargs -r rm -f

echo "[backup] FATTO: $OUT (rotazione $RETENTION)"
