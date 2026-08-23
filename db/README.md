# Dizionari — Strategia e Update

Questo progetto usa un **dizionario ibrido** costruito da due fonti validate:

## 📚 Fonti

| Source | Sigla | Parole | Tipo | Licenza |
|---|---|---|---|---|
| **LibreOffice Italian Dictionary** | `LO` | 58.857 (3-10 lettere) | Lessico curato (usato per spell-check) | GPL 3.0 |
| **Hugging Face mik3ml/italian-dictionary** | `HF` | 125.536 (3-10 lettere) | Wiktionary con definizioni | CC BY-SA 4.0 |
| **DeepSeek (AI fallback)** | `AI` | dinamico | Validazione runtime | — |
| **TOTALE** | | **~184k** | | |

## 🚀 Comandi

```bash
# Import iniziale (entrambi i dizionari)
npm run db:import:lo       # Scarica + import it_IT.dic
npm run db:import:hf       # Scarica + import dictionary_sorted.json

# Update on-demand
npm run db:check-update   # Controlla se ci sono aggiornamenti (exit code 0/1/2)
npm run db:update          # Reimport incrementale LO (INSERT con ON CONFLICT)

# Verifica
npm run db:check           # Stats DB

# Reset (ATTENZIONE: cancella tutto)
npm run db:reset
```

## 🔄 Frequenza Update

| Dizionario | Frequenza | Come scoprirlo |
|---|---|---|
| **LibreOffice** | ~1-2 volte/anno (release LO) | `https://github.com/LibreOffice/dictionaries/commits/master/it_IT` |
| **Hugging Face** | Raro (dataset statico) | `https://huggingface.co/datasets/mik3ml/italian-dictionary` (lastModified) |

**Strategia**: niente cron job, niente update automatico. Si fa `npm run db:check-update` manualmente quando si vuole.

## 🗂️ Schema

```sql
source TEXT CHECK (source IN ('LO', 'HF', 'DB', 'AI'))
-- 'DB' = legacy/altri (placeholder per retrocompatibilità)
-- 'LO' = LibreOffice
-- 'HF' = Hugging Face
-- 'AI' = validata da DeepSeek a runtime
```

## 🧪 Filtri Applicati all'Import

- **Lunghezza**: solo 3-10 lettere (per regole del gioco)
- **Charset**: solo lettere italiane (a-z, àèéìòù) + apostrofo
- **Esclusione**: lettere straniere (j, k, w, x, y) che non esistono in italiano standard

## 📝 Note Storiche

- **Pre-M4 (legacy)**: il dizionario iniziale veniva da `napolux/paroleitaliane` (~540k parole con molte "non-parole" come "boboc", "kasmi", "ortes"). Rimosso in M4 perché conteneva forme flesse, varianti antiche e possibili errori.
- **Post-M4 (attuale)**: dizionario validato semanticamente, solo lemmi o forme di uso comune.

## 🔒 File Sensibili da NON Committare

- `db/.last-etag-lo` — ETag salvato per check-update (in `.gitignore` via `db/.last-*` se aggiunto)
