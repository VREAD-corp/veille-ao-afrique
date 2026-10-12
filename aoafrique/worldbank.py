"""World Bank procurement notices (search.worldbank.org/api/v2/procnotices), French-language calls for bids
and expressions of interest in francophone African countries. Dataset "Procurement Notice" (World Bank
Data Catalog 0037776), licence CC BY 4.0. Contact names, e-mails and phone numbers are not kept."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from .http import Polite

API = "https://search.worldbank.org/api/v2/procnotices"
NOTICE_URL = "https://projects.worldbank.org/en/projects-operations/procurement-detail/{id}"

COUNTRIES = {
    "Morocco": "Maroc", "Tunisia": "Tunisie", "Algeria": "Algérie", "Mauritania": "Mauritanie",
    "Senegal": "Sénégal", "Mali": "Mali", "Burkina Faso": "Burkina Faso", "Niger": "Niger", "Chad": "Tchad",
    "Cote d'Ivoire": "Côte d'Ivoire", "Côte d'Ivoire": "Côte d'Ivoire", "Guinea": "Guinée", "Benin": "Bénin",
    "Togo": "Togo", "Cameroon": "Cameroun", "Central African Republic": "Centrafrique", "Gabon": "Gabon",
    "Congo, Republic of": "Congo", "Congo, Democratic Republic of": "RD Congo", "Burundi": "Burundi",
    "Rwanda": "Rwanda", "Djibouti": "Djibouti", "Comoros": "Comores", "Madagascar": "Madagascar",
    "Western and Central Africa": "Afrique de l'Ouest et du Centre (régional)",
    "Central Africa": "Afrique centrale (régional)",
}
TYPES = {
    "Invitation for Bids": "Appel d'offres",
    "Request for Expression of Interest": "Appel à manifestation d'intérêt",
    "Specific Procurement Notice": "Avis spécifique de passation de marché",
}
GROUPS = {"GO": "Fournitures", "CW": "Travaux", "CS": "Services de consultants", "NC": "Services"}
FIELDS = ("id,notice_type,noticedate,notice_lang_name,notice_status,submission_deadline_date,submission_deadline_time,"
          "project_ctry_name,project_id,project_name,bid_reference_no,bid_description,procurement_group,"
          "procurement_method_name,contact_organization")


def fetch_open(http: Polite, today: date, *, lookback_days: int = 120, log=print) -> list[dict]:
    rows, offset, oldest = [], 0, today - timedelta(days=lookback_days)
    while offset < 5000:
        data = http.json(API, {"format": "json", "rows": 500, "os": offset, "fl": FIELDS,
                               "notice_lang_name_exact": "French", "srt": "noticedate", "order": "desc"})
        batch = data.get("procnotices") or []
        if not batch:
            break
        rows.extend(batch)
        last = _date(batch[-1].get("noticedate"))
        if last and last < oldest:
            break
        offset += len(batch)
    log(f"Banque mondiale : {len(rows)} avis en français lus")
    out = []
    for n in rows:
        if n.get("notice_type") not in TYPES or n.get("project_ctry_name") not in COUNTRIES:
            continue
        if (n.get("notice_status") or "Published") != "Published":
            continue
        dl = (n.get("submission_deadline_date") or "")[:10]
        if not dl or dl < today.isoformat():
            continue
        out.append(n)
    log(f"Banque mondiale : {len(out)} avis ouverts en Afrique francophone")
    return out


def _date(s: str | None) -> date | None:
    if not s:
        return None
    for fmt in ("%d-%b-%Y", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def normalise(n: dict) -> dict:
    pub = _date(n.get("noticedate"))
    dl = (n.get("submission_deadline_date") or "")[:10]
    tm = (n.get("submission_deadline_time") or "").strip()
    if not (len(tm) == 5 and tm[2] == ":"):
        tm = ""
    country = COUNTRIES.get(n.get("project_ctry_name", ""), n.get("project_ctry_name", ""))
    return {
        "id": f"wb-{n['id'].lower()}",
        "source": "BM",
        "country": country,
        "reference": (n.get("bid_reference_no") or "").strip(),
        "object": " ".join((n.get("bid_description") or "").split()),
        "buyer": " ".join((n.get("contact_organization") or n.get("project_name") or "").split()),
        "project": f"{n.get('project_id', '')} – {' '.join((n.get('project_name') or '').split())}".strip(" –"),
        "procedure": TYPES.get(n.get("notice_type", ""), n.get("notice_type", "")),
        "method": n.get("procurement_method_name") or "",
        "category": GROUPS.get(n.get("procurement_group") or "", "Autre"),
        "published": pub.isoformat() if pub else "",
        "deadline": f"{dl}T{tm}" if tm else dl,
        "places": [],
        "url": NOTICE_URL.format(id=n["id"]),
    }
