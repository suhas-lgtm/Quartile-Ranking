# MF Research — public dashboard

Three tabs, and the daily pipeline that feeds them.

| Tab | What it shows |
|---|---|
| **Market Pulse** | Index cards with 1-day moves and sparklines, click through to a chart |
| **Quartile Ranking** | Every fund's quartile by month, quarter or year, against its category |
| **Fund Signals** | Funds on consistent Q1/Q2 or Q3/Q4 streaks |

No login and no gated data — the restricted sections of the original project are
not included.

---

## Point it at your own database

Everything durable lives in one **Neon** Postgres database. Open `.env` (copy
`.env.example`) and set one value:

```
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
```

The pipeline creates its tables on first use, or run
`python scripts/neon_store.py --init`:

| Table | Holds |
|---|---|
| `schemes` | the fund catalogue |
| `nav_history` | every NAV, one row per fund per day (~3.5M rows, ~260 MB) |
| `files` | the dashboard JSON, keyed by `(bucket, path)` |

The site never talks to Neon from the browser. `/data/*` and `/live/indices/*`
are answered server-side from the `files` table: by the Vite dev server locally,
and by `site/netlify/functions/data.mts` when deployed. So `DATABASE_URL` also
goes in:

- **Netlify** → Site configuration → Environment variables (a read-only Neon
  role is enough there)
- **GitHub** → repository secret `DATABASE_URL`, for the scheduled run

> `DATABASE_URL` is a **write** credential. Keep `.env` out of git —
> `.gitignore` already excludes it.

---

## Layout

```
site/                 the React dashboard (Vite + TypeScript)
  src/sections/       the three tabs
  src/hooks/useData   every fetch goes through here
  vite.config.ts      dev server; serves /data/* from Neon
  server/neonFiles    the Neon file lookup, shared with the Netlify function
  netlify/functions/  production /data/* and /live/indices/*
scripts/              the pipeline, 17 modules
engine/               calculation_engine.py — the maths
tests/                the quartile rule, run by the workflow
data/                 seed files the pipeline starts from
.github/workflows/    the schedule
netlify.toml          production proxy and build settings
```

## Running the website

```bash
cd site
npm install
npm run dev          # http://localhost:5173
npm run build        # production build into site/dist
```

No data is bundled. Both the dev server and the Netlify function serve `/data/*`
and `/live/indices/*` from Neon, so once the pipeline has run once the site works
with no local data at all.

## Running the pipeline

```bash
pip install -r requirements.txt
python scripts/daily_run.py            # Neon/mfapi/AMFI -> engine -> JSON
python scripts/publish_data.py --prune # stores the JSON in Neon
python scripts/update_indices.py       # the 8 Market Pulse index files
python scripts/neon_store.py --status  # what Neon holds
```

`daily_run.py` reads NAV history from Neon, bootstraps any fund Neon has never
held from api.mfapi.in, adds AMFI's newest day, and **writes the new rows back to
Neon** (append-only: a stored day is never rewritten). It then builds a
temporary SQLite database, runs the engine, writes the JSON and deletes the
SQLite file. The very first run fetches every fund from api.mfapi.in (~3.5M
rows); after that each run adds one day.

Useful flags:

| Flag | Effect |
|---|---|
| `--history-source mfapi` | ignore Neon and refetch every fund from api.mfapi.in |
| `--skip-indices` | leave benchmark indices alone |
| `--keep-db` | keep the temporary database for debugging |
| `--max-staleness N` | allow data older than the default 6 days |

## Scheduling

`.github/workflows/daily_update.yml` runs at **18:15 UTC daily** (23:45 IST,
after the Indian market close and after AMFI publishes). It installs
dependencies, checks the Neon connection, refreshes the scheme catalogue, runs
the pipeline, stores the JSON in Neon, and refreshes the Market Pulse index
files.

## What the pipeline computes

Only what these three screens read:

| Output | Feeds |
|---|---|
| `meta.json` | categories, benchmarks, as-of date |
| `indices.json`, `index/{id}.json` | Market Pulse and its chart |
| `quartiles_{slug}_{mode}.json` | Quartile Ranking (Equity and Hybrid only) |
| `watchlist_{mode}.json` | Fund Signals |

Quartile ranking and the streak signals are the only fund calculations here. The
original also produced category tables, glance, rolling, risk, NAV series and
category history for the screens behind its login; none are generated, which is
why a run writes 95 files rather than ~2,400.

`engine/calculation_engine.py` is the single source of truth for the maths.
Quartiles, category averages and returns are defined there and nowhere else, so
a figure on screen traces to one function. The front end reads the precomputed
JSON and does not recalculate.

Data sources: api.mfapi.in (history) and AMFI (newest day) for NAVs, Yahoo
Finance for index closes. Storage: Neon.
