"""
send_alerts.py — the Auto Mailing email, sent through Brevo.

Reads alerts.json (written by build_json.build_alerts, published to Neon) and
sends one email listing every fund that trails its category average by more
than the threshold: a table per period, grouped by category, returns in green
(positive) or red (negative), with a plain-text version alongside. Nothing is sent when no fund
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


def _group(f: dict) -> str:
    return f["category_name"] if f["peer_group"] == f["category_name"] else \
        f"{f['category_name']} · {f['peer_group']}"


def _period_rows(funds: list[dict], p: str) -> list[dict]:
    """Breaches for one period, grouped by category (A-Z), worst gap first within each."""
    hits = [f for f in funds if p in f["breaches"]]
    hits.sort(key=lambda f: (f["category_name"], f["peer_group"], f["periods"][p]["gap"]))
    return hits


def compose(alerts: dict, site_url: str) -> tuple[str, str, str] | None:
    """(subject, plain-text body, HTML body), or None when nothing breached."""
    funds = alerts.get("funds") or []
    if not funds:
        return None
    as_of = date.fromisoformat(alerts["as_of"]).strftime("%d %b %Y")
    th = alerts["thresholds"]
    subject = (f"MF Alerts {as_of}: {len(funds)} fund{'s' if len(funds) != 1 else ''} "
               f"below category average")
    intro = (f"These funds are trailing their category average by more than the set limits, "
             f"based on NAVs as of {as_of}.")

    # ── plain text (fallback for mail clients without HTML) ──
    lines = ["Hello,", "", intro, ""]
    for p in alerts["periods"]:
        hits = _period_rows(funds, p)
        if not hits:
            continue
        lines.append(f"{PERIOD_NAMES.get(p, p).upper()} — more than {th[p]:g}% below category average "
                     f"({len(hits)} fund{'s' if len(hits) != 1 else ''})")
        current = None
        for f in hits:
            if _group(f) != current:
                current = _group(f)
                lines.append(f"  {current}")
            r = f["periods"][p]
            lines.append(f"    - {f['scheme_name']}: {_pct(r['fund'])} vs average "
                         f"{_pct(r['average'])}  →  {r['gap']:+.2f} pts")
        lines.append("")
    lines += [f"Full list: {site_url} (Auto Mailing tab)", "",
              "This is an automated message from the MF Research dashboard."]
    text = "\n".join(lines)

    # ── HTML: one table per period, grouped by category ──
    from html import escape
    GREEN, RED, GREY = "#15803d", "#b91c1c", "#6b7280"

    def colour(v):
        return GREEN if v is not None and v >= 0 else RED

    cell = "padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;"
    parts = [f'<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:860px">',
             "<p>Hello,</p>", f"<p>{escape(intro)}</p>"]
    for p in alerts["periods"]:
        hits = _period_rows(funds, p)
        if not hits:
            continue
        parts.append(f'<h3 style="margin:22px 0 6px;font-size:15px">{escape(PERIOD_NAMES.get(p, p))} '
                     f'<span style="font-weight:normal;color:{GREY}">— more than {th[p]:g}% below category '
                     f'average · {len(hits)} fund{"s" if len(hits) != 1 else ""}</span></h3>')
        parts.append('<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">'
                     f'<tr style="background:#f3f4f6;text-align:left">'
                     f'<th style="{cell}">Category</th><th style="{cell}">Fund</th>'
                     f'<th style="{cell}text-align:right">Fund return</th>'
                     f'<th style="{cell}text-align:right">Category avg</th>'
                     f'<th style="{cell}text-align:right">Gap</th></tr>')
        current = None
        for f in hits:
            r = f["periods"][p]
            grp = _group(f)
            show = grp if grp != current else ""
            current = grp
            parts.append(
                "<tr>"
                f'<td style="{cell}font-weight:bold;color:#374151">{escape(show)}</td>'
                f'<td style="{cell}">{escape(f["scheme_name"])}</td>'
                f'<td style="{cell}text-align:right;color:{colour(r["fund"])}">{_pct(r["fund"])}</td>'
                f'<td style="{cell}text-align:right;color:{colour(r["average"])}">{_pct(r["average"])}</td>'
                f'<td style="{cell}text-align:right;color:{RED};font-weight:bold">{r["gap"]:+.2f} pts</td>'
                "</tr>")
        parts.append("</table>")
    parts += [f'<p style="margin-top:22px">Full list: <a href="{escape(site_url)}">{escape(site_url)}</a> '
              f'(Auto Mailing tab)</p>',
              f'<p style="color:{GREY};font-size:12px">Green = positive return, red = negative return; '
              f'Gap = fund return minus category average, in percentage points. Sectoral/Thematic funds '
              f'are compared with their own sector.<br>This is an automated message from the MF Research '
              f'dashboard.</p></div>']
    return subject, text, "".join(parts)


def send(settings: dict, recipients: list[str], subject: str, body: str, html: str) -> None:
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
        "htmlContent": html,
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
    ap.add_argument("--html-out", help="with --dry-run, also save the HTML email to this file")
    args = ap.parse_args()

    settings = load_settings()
    msg = compose(load_alerts(args.file), settings.get("SITE_URL") or DEFAULT_SITE)
    if msg is None:
        log.info("No fund breaches a threshold — no email sent.")
        return 0
    subject, body, html = msg
    if args.dry_run:
        print(f"Subject: {subject}\n\n{body}")
        if args.html_out:
            with open(args.html_out, "w", encoding="utf-8") as fh:
                fh.write(html)
            log.info("HTML version written to %s", args.html_out)
        return 0
    recipients = args.to or [e.strip() for e in (settings.get("ALERT_RECIPIENTS") or "").split(",")
                             if e.strip()]
    send(settings, recipients, subject, body, html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
