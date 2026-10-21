"""Tunisie: calls for tenders of the Tunisian public procurement portal (www.marchespublics.gov.tn, Haute Instance
de la Commande Publique, HAICOP), read from the JSON that feeds its public « Appels d'offres » table (no account;
robots.txt allows everything). Newest first, 500 rows per request, 3 or 4 requests per run. Kept: notices whose
title is written in French (the site is in French; titles in Arabic only are skipped) and whose deadline is not
past: object, buyer, number, publication date, deadline and the link to the official notice page."""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from .http import Polite

API = "https://www.marchespublics.gov.tn/fr/appels-doffres"
NOTICE_URL = "https://www.marchespublics.gov.tn/fr/appels-doffres/{id}"
# The table's own request (DataTables, server side): newest publication first.
PARAMS = {"draw": 1, "length": 500, "order[0][column]": 4, "order[0][dir]": "desc",
          "columns[4][data]": "publication_date"}
_ARABIC = re.compile(r"[؀-ۿ]")
_ID = re.compile(r"^Tender-\d+$")


def fetch_open(http: Polite, now: datetime, *, lookback_days: int = 150, max_pages: int = 4, log=print) -> list[dict]:
    rows, start, oldest = [], 0, (now - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    for _ in range(max_pages):
        data = http.json(API, {**PARAMS, "start": start}, extra={"X-Requested-With": "XMLHttpRequest"})
        batch = data.get("data") or []
        rows.extend(batch)
        if len(batch) < PARAMS["length"] or min((r.get("publication_date") or "9") for r in batch) < oldest:
            break
        start += len(batch)
    log(f"Tunisie : {len(rows)} avis lus")
    floor = now.strftime("%Y-%m-%d %H:%M")
    out = [r for r in rows if _ID.match(str(r.get("id") or "")) and (r.get("tenderPeriod_endDate") or "") >= floor
           and is_french(r.get("title_fr") or "")]
    log(f"Tunisie : {len(out)} avis ouverts rédigés en français")
    return out


def is_french(title: str) -> bool:
    return bool(title.strip()) and not _ARABIC.search(title) and bool(re.search(r"[A-Za-z]{3}", title))


def _clean(s: str | None) -> str:
    return " ".join((s or "").split())


def normalise(r: dict) -> dict:
    end = (r.get("tenderPeriod_endDate") or "").strip()
    dl = end[:10]
    tm = end[11:16]
    return {
        "id": f"tn-{r['id'].split('-')[1]}",
        "source": "TN",
        "country": "Tunisie",
        "reference": r["id"],
        "object": _clean(r.get("title_fr")),
        "buyer": _clean((r.get("organization") or {}).get("name_fr")),
        "procedure": "Appel d'offres",
        "category": "",
        "published": (r.get("publication_date") or "")[:10],
        "deadline": f"{dl}T{tm}" if dl and len(tm) == 5 and tm != "00:00" else dl,
        "places": [],
        "url": NOTICE_URL.format(id=r["id"]),
        "sme": bool((r.get("plan") or {}).get("reservedSME")),
    }
