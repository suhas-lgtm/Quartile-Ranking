"""
stock_caps.py — SEBI Large / Mid / Small Cap for every listed stock, from AMFI.

AMFI publishes the list twice a year (average market cap to 30 June and 31
December), which fund houses use to classify their holdings: top 100 = Large,
101-250 = Mid, the rest = Small. build_json writes it as stock_caps.json
{isin: "L" | "M" | "S"}, which the site uses for the market-cap split of a fund
or a portfolio. Best-effort: nothing is written if no file can be found.
"""

from __future__ import annotations

import io
import logging
from datetime import date

import requests

log = logging.getLogger("stock_caps")
UA = {"User-Agent": "Mozilla/5.0 (MF-Research internal tool)"}
URLS = [
    "https://portal.amfiindia.com/spages/AverageMarketCapitalization{d}.xlsx",
    "https://www.amfiindia.com/Themes/Theme1/downloads/AverageMarketCapitalization{d}.xlsx",
]


def _candidates() -> list[tuple[str, str]]:
    """('30Jun2026', '30 Jun 2026') newest first, for the last two years."""
    out, y = [], date.today().year
    for yy in (y, y - 1, y - 2):
        out += [(f"31Dec{yy}", f"31 Dec {yy}"), (f"30Jun{yy}", f"30 Jun {yy}")]
    return out


def fetch() -> dict | None:
    """{'period': '30 Jun 2026', 'caps': {isin: 'L'|'M'|'S'}} from the newest list found."""
    import pandas as pd
    for d, label in _candidates():
        for u in URLS:
            try:
                r = requests.get(u.format(d=d), headers=UA, timeout=120)
            except requests.RequestException:
                continue
            if r.status_code != 200 or len(r.content) < 50_000:
                continue
            df = pd.read_excel(io.BytesIO(r.content), header=None)
            head = next((i for i in range(10) if "ISIN" in [str(v).strip() for v in df.iloc[i].tolist()]), None)
            if head is None:
                continue
            cols = [str(v).strip() for v in df.iloc[head].tolist()]
            i_isin = cols.index("ISIN")
            i_cat = next(i for i, c in enumerate(cols) if c.lower().startswith("categori"))
            caps = {}
            for _, row in df.iloc[head + 1:].iterrows():
                isin, cat = str(row[i_isin]).strip(), str(row[i_cat]).strip().lower()
                if len(isin) == 12 and cat[:1] in ("l", "m", "s"):
                    caps[isin] = cat[:1].upper()
            if len(caps) > 1000:
                log.info("Stock caps: %d stocks as of %s", len(caps), label)
                return {"period": label, "caps": caps}
    log.warning("Stock caps: no AMFI market-cap list found")
    return None
