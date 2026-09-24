"""
neon_store.py — Neon Postgres as the pipeline's one durable store.

Replaces supabase_store.py. Two kinds of data live here:

    nav_history   every NAV the pipeline has ever accepted, one row per fund per
                  day. Fetched from api.mfapi.in once per fund (bootstrap), then
                  extended a day at a time by AMFI. Authority for history.
    schemes       the catalogue the NAVs belong to, refreshed each run.
    files         the dashboard's published JSON, keyed by (bucket, path). The
                  site's /data/* and /live/indices/* are served straight from
                  this table (site/vite.config.ts locally, a Netlify function in
                  production), so the browser never holds a credential.

The file functions keep supabase_store's names and signatures — enabled(),
download_bytes(), upload_bytes(), upload_many(), list_objects(), delete_objects()
— and "bucket" is just a column. Callers changed their import and nothing else.

Credentials come from DATABASE_URL, in the environment (GitHub Actions secret)
or in a local `.env` at the repo root. Real environment variables win. With no
URL, enabled() is False and every call is a no-op, as before.

Usage:
  python scripts/neon_store.py --init     # create the tables
  python scripts/neon_store.py --status   # row counts, date range, file count
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from datetime import date

log = logging.getLogger("neon_store")

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_KEYS = ("DATABASE_URL", "MF_DATA_BUCKET", "MF_INDEX_BUCKET")


def _load_env() -> dict[str, str]:
    vals: dict[str, str] = {}
    envf = os.path.join(_BASE, ".env")
    if os.path.exists(envf):
        try:
            with open(envf, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        vals[k.strip()] = v.strip().strip('"').strip("'")
        except Exception:
            pass
    for k in _KEYS:
        if os.environ.get(k):
            vals[k] = os.environ[k]
    return vals


_ENV = _load_env()
DSN = _ENV.get("DATABASE_URL") or ""

# The two logical buckets, now just values of files.bucket. The names are kept
# from the Supabase layout so the site's two URL prefixes map one-to-one:
#   /data/*           -> bucket "MF Data"
#   /live/indices/*   -> bucket "Indicies Data"   (spelled as it always was)
# Both are also hard-coded in site/vite.config.ts and site/netlify/functions.
BUCKET = _ENV.get("MF_INDEX_BUCKET") or "Indicies Data"
INDEX_BUCKET = BUCKET
DATA_BUCKET = _ENV.get("MF_DATA_BUCKET") or "MF Data"

SCHEMA = """
CREATE TABLE IF NOT EXISTS schemes (
    scheme_code    integer PRIMARY KEY,
    scheme_name    text NOT NULL,
    amc_name       text,
    category_name  text,
    isin           text,
    is_active      boolean NOT NULL DEFAULT true,
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ~3.5M rows. Kept narrow on purpose (int + date + float8, ~260 MB with its
-- index) so a Neon free-tier project holds it with room to spare.
CREATE TABLE IF NOT EXISTS nav_history (
    scheme_code  integer NOT NULL,
    nav_date     date    NOT NULL,
    nav          double precision NOT NULL CHECK (nav > 0),
    PRIMARY KEY (scheme_code, nav_date)
);

CREATE TABLE IF NOT EXISTS files (
    bucket         text NOT NULL,
    path           text NOT NULL,
    body           bytea NOT NULL,
    content_type   text NOT NULL DEFAULT 'application/json',
    cache_control  text,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bucket, path)
);
"""


def enabled() -> bool:
    """True only when a real, non-placeholder connection string is present."""
    return bool(DSN) and DSN.startswith(("postgres://", "postgresql://")) \
        and "YOUR-" not in DSN.upper()


def why_disabled() -> str:
    """Human-readable reason, so a skipped sync is never silent."""
    if not DSN:
        return "DATABASE_URL is not set"
    if not DSN.startswith(("postgres://", "postgresql://")):
        return "DATABASE_URL is not a postgres:// URL"
    if "YOUR-" in DSN.upper():
        return "DATABASE_URL is still the placeholder"
    return "enabled"


def connect():
    """A new psycopg connection. Callers own it and close it."""
    import psycopg
    return psycopg.connect(DSN, connect_timeout=30)


_schema_done = False
_schema_lock = threading.Lock()


def ensure_schema(conn=None) -> None:
    """Create the tables once per process. Idempotent."""
    global _schema_done
    with _schema_lock:
        if _schema_done:
            return
        own = conn is None
        conn = conn or connect()
        try:
            conn.execute(SCHEMA)
            conn.commit()
            _schema_done = True
        finally:
            if own:
                conn.close()


# ── files: the supabase_store-compatible surface ────────────────────────────

def download_bytes(remote_path: str, bucket: str | None = None,
                   timeout: int = 120) -> bytes | None:
    """Object body, or None when it is absent or unreachable."""
    if not enabled():
        return None
    try:
        with connect() as conn:
            ensure_schema(conn)
            row = conn.execute(
                "SELECT body FROM files WHERE bucket=%s AND path=%s",
                (bucket or BUCKET, remote_path)).fetchone()
        return bytes(row[0]) if row else None
    except Exception as exc:
        log.warning("Neon get %s failed: %s", remote_path, exc)
        return None


def download_file(remote_path: str, local_path: str, bucket: str | None = None,
                  timeout: int = 120) -> bool:
    """Download bucket:remote_path -> local_path. True on success."""
    body = download_bytes(remote_path, bucket, timeout)
    if body is None:
        return False
    os.makedirs(os.path.dirname(os.path.abspath(local_path)), exist_ok=True)
    # Via a temp file, so an interrupted write never leaves a truncated copy.
    tmp = local_path + ".part"
    with open(tmp, "wb") as f:
        f.write(body)
    os.replace(tmp, local_path)
    return True


_UPSERT = """
INSERT INTO files (bucket, path, body, content_type, cache_control, updated_at)
VALUES (%s, %s, %s, %s, %s, now())
ON CONFLICT (bucket, path) DO UPDATE SET
    body = EXCLUDED.body,
    content_type = EXCLUDED.content_type,
    cache_control = EXCLUDED.cache_control,
    updated_at = now()
"""


def upload_bytes(body: bytes, remote_path: str, bucket: str | None = None,
                 content_type: str = "application/octet-stream",
                 cache_control: str | None = None, timeout: int = 180) -> bool:
    """Upsert an in-memory body. True on success."""
    if not enabled():
        return False
    try:
        with connect() as conn:
            ensure_schema(conn)
            conn.execute(_UPSERT, (bucket or BUCKET, remote_path, body,
                                   content_type, cache_control))
        return True
    except Exception as exc:
        log.warning("Neon upload %s failed: %s", remote_path, exc)
        return False


def _guess_type(local_path: str) -> str:
    if local_path.endswith(".gz"):
        return "application/gzip"
    if local_path.endswith(".json"):
        return "application/json"
    return "application/octet-stream"


def upload_file(local_path: str, remote_path: str, bucket: str | None = None,
                content_type: str | None = None, cache_control: str | None = None,
                timeout: int = 180) -> bool:
    """Upload local_path -> bucket:remote_path, overwriting. True on success."""
    try:
        with open(local_path, "rb") as f:
            body = f.read()
    except OSError as exc:
        log.warning("cannot read %s: %s", local_path, exc)
        return False
    return upload_bytes(body, remote_path, bucket,
                        content_type or _guess_type(local_path), cache_control, timeout)


def upload_many(items: list[tuple[str, str]], bucket: str | None = None,
                workers: int = 12, content_type: str = "application/json",
                cache_control: str | None = "max-age=300",
                on_progress=None) -> tuple[int, list[str]]:
    """
    Upsert [(local_path, remote_path), ...] in ONE transaction.

    Unlike the Storage API there is no per-object round trip to parallelise, so
    `workers` is accepted for compatibility and ignored. A single transaction
    also means the site never sees half of a publish: either every file moves to
    the new build or none does.

    Returns (uploaded, failed_remote_paths).
    """
    if not enabled():
        log.warning("Neon not configured (%s) — nothing uploaded", why_disabled())
        return 0, [r for _, r in items]

    rows, failed = [], []
    for src, remote in items:
        try:
            with open(src, "rb") as fh:
                rows.append((bucket or BUCKET, remote, fh.read(),
                             content_type, cache_control))
        except OSError as exc:
            log.warning("cannot read %s: %s", src, exc)
            failed.append(remote)

    try:
        with connect() as conn:
            ensure_schema(conn)
            with conn.cursor() as cur:
                for i in range(0, len(rows), 200):
                    cur.executemany(_UPSERT, rows[i:i + 200])
                    if on_progress:
                        done = min(i + 200, len(rows))
                        on_progress(done, len(items), done, len(failed))
        return len(rows), failed
    except Exception as exc:
        log.warning("Neon upload of %d file(s) failed: %s", len(rows), exc)
        return 0, [r for _, r in items]


def list_objects(prefix: str = "", bucket: str | None = None,
                 timeout: int = 60) -> list[dict]:
    """Every object at or below `prefix`, as [{name, size}]."""
    if not enabled():
        return []
    try:
        with connect() as conn:
            ensure_schema(conn)
            rows = conn.execute(
                "SELECT path, octet_length(body) FROM files "
                "WHERE bucket=%s AND path LIKE %s ORDER BY path",
                (bucket or BUCKET, prefix.replace("%", r"\%") + "%")).fetchall()
        return [{"name": p, "size": n} for p, n in rows]
    except Exception as exc:
        log.warning("Neon list %r failed: %s", prefix, exc)
        return []


def delete_objects(paths: list[str], bucket: str | None = None,
                   timeout: int = 120) -> int:
    """Delete objects by path. Returns how many were removed."""
    if not enabled() or not paths:
        return 0
    try:
        with connect() as conn:
            cur = conn.execute(
                "DELETE FROM files WHERE bucket=%s AND path = ANY(%s)",
                (bucket or BUCKET, list(paths)))
            return cur.rowcount
    except Exception as exc:
        log.warning("Neon delete failed: %s", exc)
        return 0


# ── NAV history ─────────────────────────────────────────────────────────────

def upsert_schemes(schemes: list[dict]) -> int:
    """Mirror the catalogue into `schemes`, so NAV rows have names beside them."""
    if not enabled():
        return 0
    rows = [(int(s["scheme_code"]), s["scheme_name"], s.get("amc_name"),
             s.get("category_name"), s.get("isin"), bool(int(s.get("is_active", 1))))
            for s in schemes]
    with connect() as conn:
        ensure_schema(conn)
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO schemes (scheme_code, scheme_name, amc_name,
                                        category_name, isin, is_active, updated_at)
                   VALUES (%s,%s,%s,%s,%s,%s, now())
                   ON CONFLICT (scheme_code) DO UPDATE SET
                       scheme_name = EXCLUDED.scheme_name,
                       amc_name = EXCLUDED.amc_name,
                       category_name = EXCLUDED.category_name,
                       isin = EXCLUDED.isin,
                       is_active = EXCLUDED.is_active,
                       updated_at = now()""",
                rows)
    return len(rows)


def read_nav_history(codes: list[str] | None = None,
                     from_date: str | None = None) -> dict[str, dict[str, float]]:
    """
    {scheme_code: {iso_date: nav}} for the given funds (all when None).

    Streams with COPY rather than a SELECT: 3.5M rows as one result set would
    be built in memory twice over, once by the driver and once here.
    """
    if not enabled():
        return {}
    from psycopg import sql as psql

    # COPY cannot take bind parameters, so the filters are rendered as literals.
    # Both are typed here (ints, an ISO date), never free text.
    where = []
    if codes is not None:
        where.append(psql.SQL("scheme_code = ANY({}::int[])").format(
            psql.Literal([int(c) for c in codes])))
    if from_date:
        where.append(psql.SQL("nav_date >= {}::date").format(
            psql.Literal(date.fromisoformat(from_date).isoformat())))
    query = psql.SQL("COPY (SELECT scheme_code, nav_date, nav FROM nav_history{}) "
                     "TO STDOUT").format(
        psql.SQL(" WHERE ") + psql.SQL(" AND ").join(where) if where else psql.SQL(""))

    out: dict[str, dict[str, float]] = {}
    with connect() as conn:
        ensure_schema(conn)
        with conn.cursor() as cur:
            with cur.copy(query) as cp:
                cp.set_types(["int4", "date", "float8"])
                for code, d, nav in cp.rows():
                    out.setdefault(str(code), {})[d.isoformat()] = nav
    return out


def write_nav_rows(rows) -> int:
    """
    Add (scheme_code, iso_date, nav) rows, never overwriting a stored day.

    COPY into a temp table, then one INSERT ... ON CONFLICT DO NOTHING: the
    history is append-only by design (see nav_store.merge_amfi), and COPY is
    the only way 3.5M bootstrap rows reach Neon in minutes rather than hours.
    Returns the number of rows actually added.
    """
    if not enabled():
        return 0
    with connect() as conn:
        ensure_schema(conn)
        with conn.cursor() as cur:
            cur.execute("CREATE TEMP TABLE nav_in (scheme_code integer, "
                        "nav_date date, nav double precision) ON COMMIT DROP")
            with cur.copy("COPY nav_in (scheme_code, nav_date, nav) FROM STDIN") as cp:
                for code, d, nav in rows:
                    cp.write_row((int(code), date.fromisoformat(d), float(nav)))
            cur.execute("INSERT INTO nav_history SELECT DISTINCT ON (scheme_code, nav_date) * "
                        "FROM nav_in WHERE nav > 0 "
                        "ON CONFLICT (scheme_code, nav_date) DO NOTHING")
            added = cur.rowcount
    return added


def nav_status() -> dict:
    with connect() as conn:
        ensure_schema(conn)
        n, funds, lo, hi = conn.execute(
            "SELECT COUNT(*), COUNT(DISTINCT scheme_code), MIN(nav_date), MAX(nav_date) "
            "FROM nav_history").fetchone()
        schemes = conn.execute("SELECT COUNT(*) FROM schemes").fetchone()[0]
        files = conn.execute(
            "SELECT bucket, COUNT(*), COALESCE(SUM(octet_length(body)),0), MAX(updated_at) "
            "FROM files GROUP BY bucket ORDER BY bucket").fetchall()
        size = conn.execute(
            "SELECT pg_size_pretty(pg_database_size(current_database()))").fetchone()[0]
    return {"rows": n, "funds": funds, "oldest": lo, "newest": hi,
            "schemes": schemes, "files": files, "db_size": size}


def main() -> int:
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s",
                        datefmt="%H:%M:%S")
    ap = argparse.ArgumentParser(description="Neon store: create tables / report")
    ap.add_argument("--init", action="store_true", help="create the tables")
    ap.add_argument("--status", action="store_true", help="print what is stored")
    args = ap.parse_args()

    if not enabled():
        log.error("Neon not configured: %s", why_disabled())
        return 1
    if args.init:
        ensure_schema()
        log.info("Tables ready: schemes, nav_history, files")
    if args.status or not args.init:
        s = nav_status()
        log.info("database size : %s", s["db_size"])
        log.info("schemes       : %s", f"{s['schemes']:,}")
        log.info("nav_history   : %s rows, %s funds, %s .. %s",
                 f"{s['rows']:,}", f"{s['funds']:,}", s["oldest"], s["newest"])
        for bucket, n, size, ts in s["files"]:
            log.info("files[%s] : %d file(s), %.1f MB, updated %s",
                     bucket, n, size / 1048576, ts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
