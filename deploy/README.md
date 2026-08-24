# Deploy di Parole Mutanti (produzione)

Guida passo-passo per installare e aggiornare **Parole Mutanti** su un server Ubuntu
con systemd + Caddy + PostgreSQL.

## 🏠 Architettura (dove va cosa)

| Elemento | Percorso |
|---|---|
| Clone sorgente (dove lanci `deploy.sh`) | a tua scelta (es. `/home/<user>/paroleMutanti_prod`, **anche `/tmp/`**) |
| Codice eseguito (runtime) | `/opt/paroleMutanti` |
| Segreti (env) | `/etc/parole-mutanti/.env` (permessi `600`) |
| Backup DB | `/opt/paroleMutanti/backups` |
| Blocco Caddy (via `import`) | `/etc/caddy/sites/parole-mutanti.conf` |
| Servizio | systemd: `parole-mutanti.service` |

> Il clone è **solo la sorgente** da cui lanci lo script: il deploy copia il codice
> in `/opt/paroleMutanti`, che è da dove parte il server.

## ✅ Prerequisiti
- Ubuntu con systemd
- Accesso root (`sudo`)
- Dominio che punta all'IP del server (es. `example.com`)
- Certificati TLS (se riusi quelli esistenti) **oppure** Let's Encrypt automatico

## 🚀 Primo deploy

```bash
# 1. Clona il repo prod in una cartella a tua scelta (anche /tmp)
cd /home/<user>            # oppure: cd /tmp
git clone https://github.com/Maxster81/paroleMutanti_prod.git paroleMutanti_prod
cd paroleMutanti_prod

# 2. Deploy completo (install + env + db + service + backup + caddy)
sudo ./deploy/deploy.sh \
  --domain example.com \
  --port 8090 \
  --tls-cert /etc/caddy/certs/example.com.crt \
  --tls-key /etc/caddy/certs/example.com.key
```

### Durante il deploy
- `--env` genera **automaticamente** `DATABASE_URL` (password casuale per l'utente DB)
  e ti chiederà **solo** la chiave DeepSeek (opzionale, vuoto = AI disattivata).
- `--db` crea utente + database, inizializza lo schema e importa il dizionario
  (nel deploy completo viene eseguito da solo, subito dopo `--env`).
- Se **non** usi certificati esistenti, ometti `--tls-cert` / `--tls-key` → Caddy userà
  Let's Encrypt automatico.
- `--caddy` aggiunge `import /etc/caddy/sites/*.conf` al Caddyfile principale
  (solo se non già presente) e ricarica Caddy.

## 🧪 Verifica

```bash
curl https://example.com/health
systemctl status parole-mutanti
```

`/health` deve rispondere con `{"status":"ok", ..., "version":"..."}`.

## 🔁 Aggiornamenti

```bash
cd /home/<user>/paroleMutanti_prod   # (o dove hai clonato)
sudo ./deploy/deploy.sh --update            # git pull (clone) + rsync + npm + schema idempotente + restart
```

> `--update` esegue, in ordine: `git pull --ff-only` nella **directory corrente** (il clone),
> l'rsync dei file di produzione in `/opt/paroleMutanti`, `npm install --production`,
> **`db:init` (schema idempotente**: crea le tabelle nuove, es. `feedback`, senza toccare i dati)
> e il restart del servizio. Il `git pull` NON va fatto in `/opt/paroleMutanti` (è una copia senza `.git`).

## 🟢 Versione Node

- **Dev** usa Node **v24** via nvm (`/home/<user>/.nvm/.../node`).
- **`deploy.sh --install`** installa il pacchetto `nodejs` di **apt**, che prende la versione
  della distro Ubuntu (es. `22.22.1`), potenzialmente **più vecchia** di dev.
- Per coerenza, allineare la produzione a **v24** (opzionale ma consigliato). Il modo più
  semplice è il **repo NodeSource v24**:

  ```bash
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
  node --version   # deve uscire v24.x
  sudo systemctl restart parole-mutanti
  ```

- Verifica: `node --version` e `curl http://127.0.0.1:8090/health`.

## 💾 Backup
- Installato **automaticamente** al deploy (cron ogni notte alle 3:00).
- Mantiene gli **ultimi 7** backup in `/opt/paroleMutanti/backups`.
- Backup manuale: `sudo /opt/paroleMutanti/deploy/backup.sh`.

## ⚙️ Porta e personalizzazione
- Porta interna default: **8090** (allinea `--port`, env `PORT` e `reverse_proxy` di Caddy).
- Tutti i percorsi sono sovrascrivibili con `--dir` / `--env-file`.
