"""
send_alerts.py — the Auto Mailing email, sent through Brevo.

Reads alerts.json (written by build_json.build_alerts, published to Neon) and
sends one plain-text email listing every fund that trails its category average
by more than the threshold, grouped by period. Nothing is sent when no fund
breaches, so a quiet day produces no email.

Settings come from the environment or the repo-root .env — never from the
repository, which is public:
    BREVO_API_KEY        Brevo -> SMTP & API -> API Keys
    BREVO_SENDER_EMAIL   a sender verified in Brevo
    BREVO_SENDER_NAME    optional, default "MF Research Alerts"
    ALERT_RECIPIENTS     comma-separated email addresses
    SITE_URL             optional, linked at the end of the email

Usage:
  python scripts/send_alerts.py --dry-run                 # print the email, send nothing
  python scripts/send_alerts.py --to me@example.com       # send only to this address (test)
  python scripts/send_alerts.py                           # send to ALERT_RECIPIENTS
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

log = logging.getLogger("send_alerts")

BREVO_URL = "https://api.brevo.com/v3/smtp/email"
DEFAULT_SITE = "https://beamish-starburst-5b0343.netlify.app"
PERIOD_NAMES = {"1D": "1 Day", "1W": "1 Week", "1M": "1 Month", "3M": "3 Months",
                "6M": "6 Months", "12M": "1 Year"}
_KEYS = ("BREVO_API_KEY", "BREVO_SENDER_EMAIL", "BREVO_SENDER_NAME", "ALERT_RECIPIENTS", "SITE_URL")


def load_settings() -> dict[str, str]:
    vals: dict[str, str] = {}
    envf = os.path.join(ROOT_DIR, ".env")
    if os.path.exists(envf):
        with open(envf, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    vals[k.strip()] = v.strip().strip('"').strip("'")
    for k in _KEYS:
        if os.environ.get(k):
            vals[k] = os.environ[k]
    return vals


def load_alerts(path: str | None) -> dict:
    """From a local file when given, otherwise the copy published to Neon."""
    if path:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    from scripts import neon_store as db
    raw = db.download_bytes("alerts.json", bucket=db.DATA_BUCKET)
    if raw is None:
        raise SystemExit("alerts.json is not published yet (run the daily pipeline first)")
    return json.loads(raw)


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{v * 100:+.2f}%"


def compose(alerts: dict, site_url: str) -> tuple[str, str] | None:
    """(subject, plain-text body), or None when nothing breached."""
    funds = alerts.get("funds") or []
    if not funds:
        return None
    as_of = date.fromisoformat(alerts["as_of"]).strftime("%d %b %Y")
    th = alerts["thresholds"]

    lines = [
        "Hello,",
        "",
        f"These funds are trailing their category average by more than the set limits, "
        f"based on NAVs as of {as_of}.",
        "",
    ]
    for p in alerts["periods"]:
        hits = [f for f in funds if p in f["breaches"]]
        if not hits:
            continue
        hits.sort(key=lambda f: f["periods"][p]["gap"])
        lines.append(f"{PERIOD_NAMES.get(p, p).upper()} — more than {th[p]:g}% below category average "
                     f"({len(hits)} fund{'s' if len(hits) != 1 else ''})")
        for f in hits:
            r = f["periods"][p]
            group = f["category_name"] if f["peer_group"] == f["category_name"] else \
                f"{f['category_name']} · {f['peer_group']}"
            lines.append(f"  - {f['scheme_name']} ({group}): {_pct(r['fund'])} vs average "
                         f"{_pct(r['average'])}  →  {r['gap']:+.2f} pts")
        lines.append("")
    lines += [
        f"Full list: {site_url} (Auto Mailing tab)",
        "",
        "This is an automated message from the MF Research dashboard.",
    ]
    subject = (f"MF Alerts {as_of}: {len(funds)} fund{'s' if len(funds) != 1 else ''} "
               f"below category average")
    return subject, "\n".join(lines)


def send(settings: dict, recipients: list[str], subject: str, body: str) -> None:
    missing = [k for k in ("BREVO_API_KEY", "BREVO_SENDER_EMAIL") if not settings.get(k)]
    if missing:
        raise SystemExit(f"Not configured: {', '.join(missing)} (set them in .env or as secrets)")
    if not recipients:
        raise SystemExit("No recipients: set ALERT_RECIPIENTS or pass --to")
    payload = {
        "sender": {"name": settings.get("BREVO_SENDER_NAME") or "MF Research Alerts",
                   "email": settings["BREVO_SENDER_EMAIL"]},
        "to": [{"email": e} for e in recipients],
        "subject": subject,
        "textContent": body,
    }
    r = requests.post(BREVO_URL, json=payload, timeout=60, headers={
        "api-key": settings["BREVO_API_KEY"], "accept": "application/json",
        "content-type": "application/json"})
    if r.status_code >= 300:
        raise SystemExit(f"Brevo refused the email: HTTP {r.status_code} {r.text[:300]}")
    log.info("Sent to %d recipient(s): %s", len(recipients), r.json().get("messageId", "ok"))


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    ap = argparse.ArgumentParser(description="Send the Auto Mailing email via Brevo")
    ap.add_argument("--dry-run", action="store_true", help="print the email, send nothing")
    ap.add_argument("--to", action="append", help="send only to this address (repeatable)")
    ap.add_argument("--file", help="read alerts.json from this path instead of Neon")
    args = ap.parse_args()

    settings = load_settings()
    msg = compose(load_alerts(args.file), settings.get("SITE_URL") or DEFAULT_SITE)
    if msg is None:
        log.info("No fund breaches a threshold — no email sent.")
        return 0
    subject, body = msg
    if args.dry_run:
        print(f"Subject: {subject}\n\n{body}")
        return 0
    recipients = args.to or [e.strip() for e in (settings.get("ALERT_RECIPIENTS") or "").split(",")
                             if e.strip()]
    send(settings, recipients, subject, body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
