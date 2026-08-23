#!/usr/bin/env bash
# =============================================================================
# Parole Mutanti — script di deploy ed update su Ubuntu
# =============================================================================
# Automatizza installazione e configurazione di "Parole Mutanti" su Ubuntu con
# systemd + PostgreSQL + Caddy. È OPZIONALE e flessibile: puoi eseguire tutto,
# singoli passi, oppure seguire manualmente il README.
#
# Utilizzo (dalla root del repo clonato, come root/sudo):
#   sudo ./deploy.sh                                  # deploy completo
#   sudo ./deploy.sh --install                        # solo installazione (codice + dipendenze)
#   sudo ./deploy.sh --env                            # crea il file env (DATABASE_URL automatica)
#   sudo ./deploy.sh --db                             # setup DB (utente/schema + import dizionario)
#   sudo ./deploy.sh --service                        # solo installazione/avvio servizio systemd
#   sudo ./deploy.sh --caddy                          # solo generazione/ricarica blocco Caddy
#   sudo ./deploy.sh --update                         # aggiornamento in-place
#   sudo ./deploy.sh --domain esempio.it --port 8090 \
#                   --tls-cert /etc/caddy/certs/x.crt --tls-key /etc/caddy/certs/x.key
#   sudo ./deploy.sh --dir /opt/paroleMutanti         # directory installazione personalizzata
#   sudo ./deploy.sh --env-file /etc/parole-mutanti.env  # env personalizzato
#   sudo ./deploy.sh --help                           # aiuto
#
#   Il deploy completo (senza flag) include anche l'installazione del
#   backup automatico del DB (cron notturno alle 3:00, rotazione ultimi 7).
#
# Prerequisiti:
#   - Ubuntu con systemd
#   - Run come root (sudo)
#   - Git repo clonato nella directory corrente
# =============================================================================
set -euo pipefail

APP_NAME="parole-mutanti"
DEPLOY_USER="parole-mutanti"
DEPLOY_GROUP="parole-mutanti"
DEPLOY_DIR="/opt/paroleMutanti"
ENV_FILE="/etc/parole-mutanti/.env"
SERVICE_SRC="deploy/parole-mutanti.service"
SERVICE_DST="/etc/systemd/system/parole-mutanti.service"
CADDYFILE_SRC="deploy/Caddyfile.prod.snippet"

# Parametri (overridabili)
PORT="8090"
DOMAIN=""
# Certificati TLS personalizzati (se vuoto, Caddy usa Let's Encrypt automatico)
TLS_CERT=""
TLS_KEY=""

INSTALL_MODE=0
ENV_MODE=0
DB_MODE=0
SERVICE_MODE=0
CADDY_MODE=0
UPDATE_MODE=0
BACKUP_MODE=0
HELP_MODE=0

# --- Parsing argomenti -------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --install) INSTALL_MODE=1; shift ;;
        --env) ENV_MODE=1; shift ;;
        --db) DB_MODE=1; shift ;;
        --service) SERVICE_MODE=1; shift ;;
        --caddy) CADDY_MODE=1; shift ;;
        --update) UPDATE_MODE=1; shift ;;
        --help|-h) HELP_MODE=1; shift ;;
        --domain)
            [[ -z "${2:-}" || "$2" == --* ]] && { echo "ERRORE: --domain richiede un valore" >&2; exit 1; }
            DOMAIN="$2"; shift 2 ;;
        --port)
            [[ -z "${2:-}" || "$2" == --* ]] && { echo "ERRORE: --port richiede un valore" >&2; exit 1; }
            PORT="$2"; shift 2 ;;
        --tls-cert)
            [[ -z "${2:-}" || "$2" == --* ]] && { echo "ERRORE: --tls-cert richiede un valore" >&2; exit 1; }
            TLS_CERT="$2"; shift 2 ;;
        --tls-key)
            [[ -z "${2:-}" || "$2" == --* ]] && { echo "ERRORE: --tls-key richiede un valore" >&2; exit 1; }
            TLS_KEY="$2"; shift 2 ;;
        --dir)
            [[ -z "${2:-}" || "$2" == --* ]] && { echo "ERRORE: --dir richiede un path" >&2; exit 1; }
            DEPLOY_DIR="$2"; shift 2 ;;
        --env-file)
            [[ -z "${2:-}" || "$2" == --* ]] && { echo "ERRORE: --env-file richiede un path" >&2; exit 1; }
            ENV_FILE="$2"; shift 2 ;;
        *) echo "Opzione sconosciuta: $1 (usa --help)" >&2; exit 1 ;;
    esac
done

if [ "$HELP_MODE" = "1" ]; then
    sed -n '1,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
fi

# Se nessuna modalità esplicita, esegui il deploy completo
if [ "$INSTALL_MODE" = "0" ] && [ "$ENV_MODE" = "0" ] && [ "$DB_MODE" = "0" ] \
   && [ "$SERVICE_MODE" = "0" ] && [ "$CADDY_MODE" = "0" ] && [ "$UPDATE_MODE" = "0" ]; then
    INSTALL_MODE=1; ENV_MODE=1; DB_MODE=1; SERVICE_MODE=1; BACKUP_MODE=1
    if [ -n "$DOMAIN" ]; then CADDY_MODE=1; fi
fi

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "ERRORE: esegui con sudo/root" >&2; exit 1
    fi
}

# ============================================================
# --install : pacchetti + copia codice + dipendenze (DB dopo --env, con --db)
# ============================================================
do_install() {
    require_root
    echo "[install] Installazione pacchetti di sistema (nodejs, git, postgresql, caddy)..."
    apt-get update
    apt-get install -y nodejs npm git postgresql postgresql-contrib caddy

    echo "[install] Creazione utente dedicato ($DEPLOY_USER)..."
    id "$DEPLOY_USER" &>/dev/null || useradd -r -s /usr/sbin/nologin "$DEPLOY_USER"

    echo "[install] Copia del codice in $DEPLOY_DIR ..."
    mkdir -p "$DEPLOY_DIR"
    rsync -a --delete \
        --include='backend/' --include='backend/src/' --include='backend/src/***' \
        --include='frontend/' --include='frontend/***' \
        --include='db/' --include='db/***' \
        --include='deploy/' --include='deploy/***' \
        --include='package.json' --include='package-lock.json' \
        --include='.env.example' --include='.gitignore' \
        --include='README.md' --include='VERSION' \
        --exclude='*' \
        ./ "$DEPLOY_DIR/"
    chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$DEPLOY_DIR"

    # Cartella log richiesta dall'hardening systemd (ReadWritePaths=/opt/.../logs)
    mkdir -p "$DEPLOY_DIR/logs"
    chown "$DEPLOY_USER:$DEPLOY_GROUP" "$DEPLOY_DIR/logs"

    echo "[install] Installazione dipendenze Node (--production)..."
    (cd "$DEPLOY_DIR" && npm install --production)

    echo "[install] FATTO. (Il setup del database avviene dopo --env, con il passo --db)"
}

# ============================================================
# --env : crea/genera il file env di produzione
# ============================================================
do_env() {
    require_root
    ENV_DIR="$(dirname "$ENV_FILE")"
    mkdir -p "$ENV_DIR"

    if [ -f "$ENV_FILE" ]; then
        echo "[env] $ENV_FILE già presente. Lo lascio invariato (usa --env-file per un altro path)."
        # Robustezza: se SESSION_SECRET è placeholder/corto, lo rigenera (altrimenti
        # il config in produzione rifiuta di partire).
        CURRENT_SECRET="$(grep -E '^SESSION_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
        if [ "${#CURRENT_SECRET}" -lt 32 ]; then
            NEW_SECRET="$(openssl rand -hex 32)"
            sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$NEW_SECRET|" "$ENV_FILE"
            echo "[env] SESSION_SECRET non valido: rigenerato automaticamente."
        fi
        return
    fi

    echo "[env] Generazione $ENV_FILE da .env.example..."
    cp .env.example "$ENV_FILE"

    # DATABASE_URL: se fornita via PAROLE_DATABASE_URL la usa; altrimenti la
    # genera automaticamente con una password casuale (nessun prompt).
    DATABASE_URL="${PAROLE_DATABASE_URL:-}"
    if [ -z "$DATABASE_URL" ]; then
        DB_PASSWORD="$(openssl rand -hex 18)"
        DATABASE_URL="postgresql://parole_user:${DB_PASSWORD}@localhost:5432/parole_mutanti"
        echo "[env] DATABASE_URL generata automaticamente (password casuale per parole_user)."
    else
        echo "[env] DATABASE_URL fornita via PAROLE_DATABASE_URL."
    fi

    # Chiave DeepSeek: opzionale (da env o prompt; vuota = AI disattivata)
    DEEPSEEK_KEY="${PAROLE_DEEPSEEK_KEY:-}"
    if [ -z "$DEEPSEEK_KEY" ]; then
        read -rp "DEEPSEEK_API_KEY (opzionale, lascia vuoto per disattivare il fallback AI): " DEEPSEEK_KEY
    fi

    SECRET="$(openssl rand -hex 32)"

    # Sovrascrive i valori nel file env
    sed -i "s|^PORT=.*|PORT=$PORT|" "$ENV_FILE"
    sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" "$ENV_FILE"
    sed -i "s|^HOST=.*|HOST=127.0.0.1|" "$ENV_FILE"
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" "$ENV_FILE"
    sed -i "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=$DEEPSEEK_KEY|" "$ENV_FILE"
    sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" "$ENV_FILE"

    chmod 600 "$ENV_FILE"
    chown root:"$DEPLOY_GROUP" "$ENV_FILE"
    echo "[env] FATTO. Credenziali in $ENV_FILE (permessi 600)."
    echo "  -> Ora crea lo schema e importa il dizionario con: sudo $0 --db"
}

# ============================================================
# --db : setup database (utente/DB + schema + dizionario)
# ============================================================
do_db() {
    require_root
    if [ ! -f "$ENV_FILE" ]; then
        echo "ERRORE: $ENV_FILE non presente. Prima esegui: sudo $0 --env" >&2
        exit 1
    fi

    # Legge DATABASE_URL dal file env (senza fare source dell'intero file:
    # il .env può contenere righe che bash non sa interpretare).
    DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
    if [ -z "$DATABASE_URL" ]; then
        echo "ERRORE: DATABASE_URL mancante in $ENV_FILE" >&2
        exit 1
    fi
    export DATABASE_URL

    # Estrae la password dall'URL (postgresql://user:PASS@host/db)
    DB_PASSWORD="$(printf '%s' "$DATABASE_URL" | sed -E 's|^[^:]+://[^:]+:([^@]+)@.*|\1|')"

    echo "[db] Creazione utente + database (setup-user.sql)..."
    sudo -u postgres psql -v db_password="$DB_PASSWORD" -f "$DEPLOY_DIR/db/setup-user.sql"

    echo "[db] Inizializzazione schema (db:init)..."
    (cd "$DEPLOY_DIR" && npm run db:init)

    echo "[db] Importazione dizionario (db:import, può richiedere qualche minuto)..."
    (cd "$DEPLOY_DIR" && npm run db:import)

    echo "[db] FATTO. Database pronto."
}

# ============================================================
# --service : unit systemd
# ============================================================
do_service() {
    require_root
    echo "[service] Copia della unit systemd..."
    cp "$SERVICE_SRC" "$SERVICE_DST"

    # Allinea user/dir nella unit con i parametri scelti
    sed -i "s|^User=.*|User=$DEPLOY_USER|" "$SERVICE_DST"
    sed -i "s|^Group=.*|Group=$DEPLOY_GROUP|" "$SERVICE_DST"
    sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$DEPLOY_DIR|" "$SERVICE_DST"
    sed -i "s|^EnvironmentFile=.*|EnvironmentFile=$ENV_FILE|" "$SERVICE_DST"

    # Assicura la cartella log (ReadWritePaths dell'hardening) prima di avviare
    mkdir -p "$DEPLOY_DIR/logs"
    chown "$DEPLOY_USER:$DEPLOY_GROUP" "$DEPLOY_DIR/logs"

    systemctl daemon-reload
    systemctl enable --now parole-mutanti
    systemctl status parole-mutanti --no-pager
    echo "[service] FATTO."
}

# ============================================================
# --caddy : genera il sito Caddy (file .conf) + import nel Caddyfile
# ============================================================
do_caddy() {
    require_root
    if [ -z "$DOMAIN" ]; then
        echo "ERRORE: --caddy richiede --domain <dominio>" >&2; exit 1
    fi

    SITES_DIR="/etc/caddy/sites"
    CONF_FILE="$SITES_DIR/parole-mutanti.conf"
    CADDYFILE="/etc/caddy/Caddyfile"
    IMPORT_LINE="import $SITES_DIR/*.conf"

    # Riga TLS: se sono stati forniti cert+key li usa (certificati esistenti),
    # altrimenti resta vuota → Caddy usa Let's Encrypt automatico.
    local TLS_LINE=""
    if [ -n "$TLS_CERT" ] && [ -n "$TLS_KEY" ]; then
        TLS_LINE="tls $TLS_CERT $TLS_KEY"
    fi

    echo "[caddy] Generazione $CONF_FILE per $DOMAIN (porta $PORT)..."
    mkdir -p "$SITES_DIR" /var/log/caddy
    # Assicura che Caddy (utente caddy) possa scrivere il proprio log:
    # rimuove un eventuale file stantio di proprietà di root e ricrea come caddy.
    chown caddy:caddy /var/log/caddy 2>/dev/null || true
    rm -f /var/log/caddy/parole-mutanti.log
    touch /var/log/caddy/parole-mutanti.log
    chown caddy:caddy /var/log/caddy/parole-mutanti.log
    chmod 644 /var/log/caddy/parole-mutanti.log

    sed -e "s|__DOMAIN__|$DOMAIN|g" \
        -e "s|__PORT__|$PORT|g" \
        -e "s|__TLS_LINE__|$TLS_LINE|g" \
        "$CADDYFILE_SRC" > "$CONF_FILE"
    chmod 644 "$CONF_FILE"

    # Aggiunge la riga import al Caddyfile principale solo se non già presente
    if ! grep -qF "$IMPORT_LINE" "$CADDYFILE"; then
        echo "[caddy] Aggiungo '$IMPORT_LINE' al Caddyfile principale..."
        printf '\n# --- Siti modulari (import) ---\n%s\n' "$IMPORT_LINE" >> "$CADDYFILE"
    else
        echo "[caddy] Import già presente nel Caddyfile principale."
    fi

    echo "[caddy] Validazione configurazione..."
    if caddy validate --config "$CADDYFILE"; then
        echo "[caddy] Reload Caddy..."
        systemctl reload caddy
        echo "[caddy] FATTO. Il sito https://$DOMAIN è attivo."
    else
        echo "[caddy] ERRORE: configurazione non valida, Caddy NON è stato ricaricato." >&2
        echo "  Controlla $CONF_FILE (dominio, porta, certificati)." >&2
        exit 1
    fi
}

# ============================================================
# --update : aggiornamento in-place
# ============================================================
do_update() {
    require_root
    echo "[update] git pull + npm install --production + restart..."
    (cd "$DEPLOY_DIR" && git pull --ff-only)
    (cd "$DEPLOY_DIR" && npm install --production)
    systemctl restart parole-mutanti
    echo "[update] FATTO."
}

# ============================================================
# backup : installa script di backup + cron (nel deploy completo)
# ============================================================
do_backup() {
    require_root
    if [ ! -f "$ENV_FILE" ]; then
        echo "[backup] AVVISO: $ENV_FILE non presente, salto installazione backup." >&2
        return
    fi
    if [ ! -f deploy/backup.sh ]; then
        echo "[backup] ERRORE: deploy/backup.sh non trovato nel repo" >&2
        exit 1
    fi

    echo "[backup] Installazione script + cron (ogni notte alle 3:00, rotazione 7)..."
    mkdir -p "$DEPLOY_DIR/deploy" "$DEPLOY_DIR/backups"
    chmod 700 "$DEPLOY_DIR/backups"
    cp deploy/backup.sh "$DEPLOY_DIR/deploy/backup.sh"
    chmod 700 "$DEPLOY_DIR/deploy/backup.sh"

    cat > /etc/cron.d/parole-mutanti-backup <<EOF
# Backup automatico Parole Mutanti — ogni notte alle 3:00, mantiene gli ultimi 7
0 3 * * * root PAROLE_ENV_FILE=$ENV_FILE PAROLE_BACKUP_DIR=$DEPLOY_DIR/backups $DEPLOY_DIR/deploy/backup.sh
EOF
    chmod 644 /etc/cron.d/parole-mutanti-backup

    echo "[backup] Primo backup di verifica..."
    PAROLE_ENV_FILE="$ENV_FILE" PAROLE_BACKUP_DIR="$DEPLOY_DIR/backups" "$DEPLOY_DIR/deploy/backup.sh"
    echo "[backup] FATTO."
}

# --- Esecuzione --------------------------------------------------------------
if [ "$INSTALL_MODE" = "1" ]; then do_install; fi
if [ "$ENV_MODE" = "1" ]; then do_env; fi
if [ "$DB_MODE" = "1" ]; then do_db; fi
if [ "$SERVICE_MODE" = "1" ]; then do_service; fi
if [ "$CADDY_MODE" = "1" ]; then do_caddy; fi
if [ "$UPDATE_MODE" = "1" ]; then do_update; fi
if [ "$BACKUP_MODE" = "1" ]; then do_backup; fi

echo
echo "[deploy] Verifica finale:"
echo "  curl http://127.0.0.1:$PORT/health   (deve rispondere {\"status\":\"ok\"...})"
echo "  systemctl status parole-mutanti"
