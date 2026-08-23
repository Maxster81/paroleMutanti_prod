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
- A ogni turno il giocatore modifica la parola precedente con UNA sola azione:
  - Cambiare 1 lettera (es. `BANANA` → `BANANE`)
  - Aggiungere 1 lettera (es. `POTARE` → `PORTARE`)
  - Rimuovere 1 lettera (es. `BARARE` → `BARRE`)
- Validità della parola: **controllo a tre fasi**
  1. Nel dizionario (DB)
  2. Forma flessa/derivata (il lemma deve esistere nel DB)
  3. Fallback AI (DeepSeek)
- Non si può riscrivere una parola già usata nella stessa partita
- Tempo per turno: 5-60 secondi (configurabile); chi non risponde o sbaglia viene eliminato
- Vince l'ultimo che resta in gioco

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

Sintesi essenziale:

```bash
# 1. Clona il repo prod in una cartella a scelta (anche /tmp)
git clone https://github.com/Maxster81/paroleMutanti_prod.git paroleMutanti_prod
cd paroleMutanti_prod

# 2. Deploy completo (install + env + service + backup + caddy)
sudo ./deploy.sh \
  --domain example.com \
  --port 8090 \
  --tls-cert /etc/caddy/certs/example.com.crt \
  --tls-key /etc/caddy/certs/example.com.key
```

Durante il deploy ti verranno chiesti `DATABASE_URL` e la chiave DeepSeek; il setup
del DB genera la password dell'utente del database (copiala dentro `DATABASE_URL`).

Verifica: `curl https://example.com/health`

Aggiornamenti: `sudo ./deploy.sh --update`

Variabili principali (in produzione, su `/etc/parole-mutanti/.env`):
- `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=<porta>` (default `8090`)
- `DATABASE_URL`, `DEEPSEEK_API_KEY`, `SESSION_SECRET`
- `CORS_ORIGIN` limitato al dominio di produzione

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
