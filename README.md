# 🎮 Parole Mutanti

Gioco multiplayer realtime (2-8 giocatori) di modifica parole italiane.
Mobile-first, vanilla JS, Node.js + Express + Socket.io + PostgreSQL + DeepSeek AI fallback.

## 🏗️ Architettura

- **Frontend**: HTML5 + CSS3 + Vanilla JS (no framework), mobile-first 360×800px
- **Backend**: Node.js 20+ + Express + Socket.io
- **Database**: PostgreSQL 16
- **AI**: DeepSeek API come fallback di validazione delle parole
- **Deploy**: Ubuntu + Caddy (HTTPS) + systemd (vedi `deploy/`)

## 🎯 Regole del gioco

- 2-8 giocatori per partita, nessun account (solo nome di sessione)
- Il server genera una parola iniziale (5-8 lettere, configurabile)
- A ogni **mano** il giocatore modifica la parola precedente con UNA sola mossa:
  - Cambiare 1 lettera (es. `BANANA` → `BANANE`)
  - Aggiungere 1 lettera (es. `POTARE` → `PORTARE`)
  - Rimuovere 1 lettera (es. `BARARE` → `BARRE`)
- Validità della parola: **controllo a tre fasi**
  1. Nel dizionario (DB)
  2. Forma flessa/derivata (il lemma deve esistere nel DB)
  3. Fallback AI (DeepSeek)
- Non si può riscrivere una parola già usata nella stessa partita
- **3 tentativi per mano** (5-60 secondi): al 3° errore (o a tempo scaduto) la mano si chiude
- Se in un **turno** nessuno supera la mano → **stallo**: si riparte con una nuova parola, nessun eliminato
- Chi resta ultimo in una **manche** vince il punto; la **partita è al meglio di N manche**
  (`games_to_win`, 1-4): vince chi arriva a N (o chi resta da solo se gli altri abbandonano)

## 🚀 Setup di sviluppo

```bash
# 1. Clona il repo
git clone <repo> paroleMutanti && cd paroleMutanti

# 2. Installa dipendenze
npm install

# 3. Configura le variabili d'ambiente
cp .env.example .env
# Modifica .env con le tue credenziali (DB, API key DeepSeek, SESSION_SECRET)

# 4. Installa PostgreSQL (se non presente)
sudo apt install postgresql postgresql-contrib

# 5. Crea utente e database
sudo -u postgres psql -f db/setup-user.sql

# 6. Inizializza schema
npm run db:init

# 7. Importa dizionario italiano
npm run db:import

# 8. Verifica
npm run db:check

# 9. Avvia (dev con watch)
npm run dev
```

## 🚀 Deploy in produzione (Ubuntu + systemd + Caddy)

> La **guida passo-passo completa** è in [`deploy/README.md`](deploy/README.md)
> (architettura, primo deploy, verifica, aggiornamenti, backup).

> **Modello a due repository**: `paroleMutanti` (dev, privato) e `paroleMutanti_prod`
> (prod, pubblico). Il sync dev→prod avviene **solo su richiesta** con `./sync-to-prod.sh`
> (whitelist rsync), poi si committa e pusha nel repo prod. Vedi `.clinerules/04-git.md`.

Sintesi essenziale:

```bash
# 1. Clona il repo prod in una cartella a scelta (anche /tmp)
git clone https://github.com/Maxster81/paroleMutanti_prod.git paroleMutanti_prod
cd paroleMutanti_prod

# 2. Deploy completo (install + env + service + backup + caddy)
sudo ./deploy/deploy.sh \
  --domain example.com \
  --port 8090 \
  --tls-cert /etc/caddy/certs/example.com.crt \
  --tls-key /etc/caddy/certs/example.com.key
```

Il deploy genera automaticamente `DATABASE_URL` (password casuale per l'utente DB) e
ti chiederà solo la chiave DeepSeek (opzionale); crea poi utente/DB, schema e dizionario.

Verifica: `curl https://example.com/health`

Aggiornamenti: `sudo ./deploy/deploy.sh --update`
(git pull nel clone + rsync dei file in `/opt/paroleMutanti` + `npm install --production` + restart)

Variabili principali (in produzione, su `/etc/parole-mutanti/.env`):
- `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=<porta>` (default `8090`)
- `DATABASE_URL`, `DEEPSEEK_API_KEY`, `SESSION_SECRET`
- `CORS_ORIGIN` limitato al dominio di produzione

> **Versione Node**: usare la **stessa versione** tra dev e prod (dev usa nvm v24).
> Il pacchetto `nodejs` di apt installa la versione della distro, che può essere più
> vecchia. In produzione allineare a v24 (vedi `deploy/README.md` → "Versione Node").

## 📂 Struttura repo

```
paroleMutanti/
├── frontend/           # HTML/CSS/JS vanilla
├── backend/            # Node.js + Express + Socket.io
│   ├── src/
│   │   ├── server.js   # Entry point
│   │   ├── config.js   # Env loader
│   │   ├── db/         # Pool pg, query helpers
│   │   ├── game/       # Logica: GameManager, TurnManager, Validator, morfologia
│   │   ├── sockets/    # Handler eventi Socket.io
│   │   ├── ai/         # Client DeepSeek + cache + rate limit
│   │   └── utils/      # Levenshtein, normalizzazione, morfologia
│   └── tests/          # Unit test (node --test)
├── db/
│   ├── init-db.sql     # Schema tabelle
│   ├── setup-user.sql  # Creazione user/DB
│   └── *.mjs|*.js      # Script import/update dizionario
├── deploy/             # deploy.sh + Caddyfile + unit systemd
├── .env.example        # Template env vars
└── README.md
```

## 🧪 Test

```bash
# Unit test (Node test runner nativo, nessuna dipendenza extra)
npm test
```

## 🔐 Sicurezza

- `.env` mai committato (template con placeholder in `.env.example`)
- API key DeepSeek letta solo da `process.env`
- Validazione input sia client che server
- Rate limit: max 10 chiamate DeepSeek/min per partita
- In produzione: bind `127.0.0.1` + Caddy come reverse proxy (TLS)

## 📝 Licenza

MIT
