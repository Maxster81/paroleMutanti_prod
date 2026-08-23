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
sudo ./deploy/deploy.sh --update            # git pull --ff-only + npm install + restart
```

## 💾 Backup
- Installato **automaticamente** al deploy (cron ogni notte alle 3:00).
- Mantiene gli **ultimi 7** backup in `/opt/paroleMutanti/backups`.
- Backup manuale: `sudo /opt/paroleMutanti/deploy/backup.sh`.

## ⚙️ Porta e personalizzazione
- Porta interna default: **8090** (allinea `--port`, env `PORT` e `reverse_proxy` di Caddy).
- Tutti i percorsi sono sovrascrivibili con `--dir` / `--env-file`.
