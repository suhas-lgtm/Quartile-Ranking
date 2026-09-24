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

**Two values.** Open `.env` and fill in:

```
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_SERVICE_KEY=YOUR-SERVICE-ROLE-KEY
```

Then in your Supabase project create two **public** Storage buckets, named
exactly:

```
MF Data          the dashboard JSON
Indicies Data    the Market Pulse index files   (spelled as shown)
```

Those two names are already the defaults everywhere — in
`scripts/supabase_store.py` and in the two proxy configs the browser uses — so
keeping them means **nothing else needs editing**. If you rename a bucket you
must change it in three places: `.env`, `site/vite.config.ts` and
`netlify.toml`.

Finally, put the same URL in the two proxy configs, replacing
`YOUR-PROJECT-REF`:

- `site/vite.config.ts` — the dev server
- `netlify.toml` — the deployed site

For the scheduled run, set the same values as repository secrets:
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_DATA_BUCKET`.

> The service key is a **write** credential. Anyone holding it can overwrite or
> delete every file the dashboard serves. Keep `.env` out of git — `.gitignore`
> already excludes it.

---

## Layout

```
site/                 the React dashboard (Vite + TypeScript)
  src/sections/       the three tabs
  src/hooks/useData   every fetch goes through here
  vite.config.ts      dev proxy to Supabase
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

No data is bundled. Both the dev server and Netlify proxy `/data/*` and
`/live/indices/*` to the public buckets, so once the pipeline has run once the
site works with no local data at all.

## Running the pipeline

```bash
pip install -r requirements.txt
python scripts/daily_run.py            # builds the JSON
python scripts/publish_data.py --prune # uploads it to Supabase
```

`daily_run.py` builds a temporary SQLite database, runs the engine, writes the
JSON and **deletes the database**. Nothing persists between runs except what is
in the bucket. A full run takes about 3 minutes and writes **95 files**.

Useful flags:

| Flag | Effect |
|---|---|
| `--history-source supabase` | reuse published NAV history instead of refetching |
| `--skip-indices` | leave benchmark indices alone |
| `--keep-db` | keep the temporary database for debugging |
| `--max-staleness N` | allow data older than the default 6 days |

## Scheduling

`.github/workflows/daily_update.yml` runs at **18:15 UTC daily** (23:45 IST,
after the Indian market close and after AMFI publishes). It installs
dependencies, checks the Supabase connection, refreshes the scheme catalogue,
runs the pipeline, uploads, and pushes the Market Pulse index files. The flow is
unchanged from the original project — only the database it points at differs.

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

Data sources: AMFI for NAVs, Yahoo Finance for index closes.
