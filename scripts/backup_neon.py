"""
backup_neon.py — a local copy of everything in the Neon database.

Every table is streamed with COPY to a gzipped CSV (a header row, Postgres CSV
format; bytea columns such as files.body come out hex-encoded, as COPY writes
them), plus the CREATE TABLE statements, into

    backups/neon_<YYYY-MM-DD_HHMM>/<table>.csv.gz
    backups/neon_<YYYY-MM-DD_HHMM>/schema.sql

backups/ is gitignored: it holds the whole NAV history, the team blacklist
and the published dashboard files, and is never committed.

Restore one table into an empty database (psql):
    \\copy nav_history FROM PROGRAM 'gzip -dc nav_history.csv.gz' WITH (FORMAT csv, HEADER)

Usage:
  python scripts/backup_neon.py                 # back up every table
  python scripts/backup_neon.py --keep 5        # and delete all but the 5 newest backups
"""

from __future__ import annotations

import argparse
import gzip
import os
import re
import shutil
import sys
from datetime import datetime

import psycopg

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(ROOT_DIR, "backups")


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        env = os.path.join(ROOT_DIR, ".env")
        if os.path.exists(env):
            m = re.search(r"^DATABASE_URL=(.*)$", open(env, encoding="utf-8").read(), re.M)
            url = m.group(1).strip().strip('"').strip("'") if m else None
    if not url:
        sys.exit("DATABASE_URL is not set (environment or .env).")
    return url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=0, help="keep only this many newest backups (0 = keep all)")
    args = ap.parse_args()

    out = os.path.join(BACKUP_DIR, "neon_" + datetime.now().strftime("%Y-%m-%d_%H%M"))
    os.makedirs(out, exist_ok=True)
    with psycopg.connect(database_url()) as conn:
        tables = [r[0] for r in conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")]
        schema = []
        for t in tables:
            cols = conn.execute(
                "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name=%s ORDER BY ordinal_position", (t,)).fetchall()
            schema.append(f"CREATE TABLE {t} (\n" + ",\n".join(
                f"    {c} {d}{'' if n == 'YES' else ' NOT NULL'}" for c, d, n in cols) + "\n);\n")
            path = os.path.join(out, f"{t}.csv.gz")
            rows = 0
            with conn.cursor() as cur, gzip.open(path, "wb") as fh:
                with cur.copy(f'COPY "{t}" TO STDOUT WITH (FORMAT csv, HEADER)') as cp:
                    for chunk in cp:
                        fh.write(chunk)
                        rows += bytes(chunk).count(b"\n")
            print(f"  {t:22s} ~{max(rows - 1, 0):>10,} rows  {os.path.getsize(path) / 1e6:8.1f} MB")
        with open(os.path.join(out, "schema.sql"), "w", encoding="utf-8") as fh:
            fh.write("-- Column types only (no keys or indexes); see scripts/neon_store.py for the full DDL.\n\n")
            fh.write("\n".join(schema))
    total = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f"Backup written to {out} ({total / 1e6:.1f} MB)")

    if args.keep > 0:
        old = sorted(d for d in os.listdir(BACKUP_DIR) if d.startswith("neon_"))[:-args.keep]
        for d in old:
            shutil.rmtree(os.path.join(BACKUP_DIR, d), ignore_errors=True)
            print("removed old backup", d)


if __name__ == "__main__":
    main()
