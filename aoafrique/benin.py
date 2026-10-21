"""Bénin: open calls for tenders of the national public procurement portal (www.marches-publics.bj), read from the
JSON API behind its « Avis d'appels d'offres » page (api.marches-publics.bj/v2/api/portail/appelsoffres, no account,
the portal also publishes the same list as an RSS feed). One request per run: the API filters on the deadline
(`limitStart`, epoch milliseconds). Kept: object, buyer, reference, market type, publication date, deadline and the
link to the official notice (PDF on the portal). Contact names, e-mails and phone numbers are not kept."""

from __future__ import annotations

import urllib.parse
from datetime import datetime, timezone

from .http import Polite

API = "https://api.marches-publics.bj/v2/api/portail/appelsoffres"
PORTAL = "https://www.marches-publics.bj/appels-doffres"
TYPES = {"Fournitures": "Fournitures", "Travaux": "Travaux", "Services": "Services",
         "Prestations Intellectuelles": "Services de consultants"}


def fetch_open(http: Polite, now: datetime, *, log=print) -> list[dict]:
    """Notices whose deadline is not past, newest first (the portal lists about 30 to 60 at a time). `now`: aware,
    local time of Cotonou."""
    since_ms = int(now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).timestamp() * 1000)
    rows, page = [], 0
    while page < 10:
        data = http.json(API, {"page": page, "size": 100, "search": "", "limitStart": since_ms})
        batch = data.get("content") or []
        rows.extend(batch)
        if data.get("last", True) or not batch:
            break
        page += 1
    log(f"Bénin : {len(rows)} avis lus ({page + 1} requête(s))")
    out = [r for r in rows if not r.get("expired") and (r.get("dosDateLimiteDepot") or "") >= now.date().isoformat()]
    log(f"Bénin : {len(out)} avis ouverts")
    return out


def _clean(s: str | None) -> str:
    return " ".join((s or "").split())


def official_url(reference: str) -> str:
    """The portal's list filtered on the reference (its detail URLs carry an encrypted id, not usable as a link)."""
    return PORTAL + ("?" + urllib.parse.urlencode({"search": reference}) if reference else "")


def normalise(r: dict) -> dict:
    ao = r.get("appelsoffres") or {}
    ac = r.get("autoriteContractante") or {}
    kind = ((ao.get("typemarche") or {}).get("libelle") or "").strip()
    ref = _clean(r.get("dosReference") or ao.get("apoReference"))
    dl = (r.get("dosDateLimiteDepot") or "")[:10]
    tm = (r.get("dosHeurelimitedepot") or "")[:5]
    pdf = (r.get("dosFichier") or "").strip()
    n = {
        "id": f"bj-{r['dosID']}",
        "source": "BJ",
        "country": "Bénin",
        "reference": ref,
        "object": _clean(ao.get("apoObjet")),
        "buyer": _clean(ac.get("denomination")),
        "procedure": "Appel d'offres",
        "category": TYPES.get(kind, kind),
        "published": (r.get("dosDatePublication") or r.get("dosDateCreation") or "")[:10],
        "deadline": f"{dl}T{tm}" if dl and len(tm) == 5 and tm[2] == ":" else dl,
        "places": [],
        "url": official_url(ref),
    }
    if pdf.startswith("https://") and pdf.lower().endswith(".pdf"):
        parts = urllib.parse.urlsplit(pdf)
        n["pdf"] = urllib.parse.urlunsplit(parts._replace(path=urllib.parse.quote(urllib.parse.unquote(parts.path))))
    if r.get("dosNombreLots") and int(r["dosNombreLots"]) > 1:
        n["lots"] = int(r["dosNombreLots"])
    return n
