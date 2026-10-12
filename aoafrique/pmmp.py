"""Portail marocain des marchés publics (PMMP, www.marchespublics.gov.ma), run by the Trésorerie Générale du
Royaume. Atexo/PRADO application: the list of open consultations ("Consultations en cours") is a search
form posted back to itself. We submit it once with its default criteria, switch to 500 rows per page and
walk the pages. Detail pages (estimate, bid bond, activity domains) are fetched once per consultation and
cached. Contact names, e-mails and phone numbers printed on detail pages are never read into our data."""

from __future__ import annotations

import html
import re
from datetime import date, datetime
from html.parser import HTMLParser

from .http import Polite

ROOT = "https://www.marchespublics.gov.ma/"
SEARCH_URL = ROOT + "index.php?page=entreprise.EntrepriseAdvancedSearch&searchAnnCons"
DETAIL_URL = ROOT + "index.php?page=entreprise.EntrepriseDetailConsultation&refConsultation={ref}&orgAcronyme={org}"
P = "ctl0$CONTENU_PAGE$"
SEARCH_BUTTON = P + "AdvancedSearch$lancerRecherche"
PAGE_SIZE = P + "resultSearch$listePageSizeTop"
PAGE_SIZE_BOTTOM = P + "resultSearch$listePageSizeBottom"
PAGE_NUM = P + "resultSearch$numPageTop"
GOTO_PAGE = P + "resultSearch$DefaultButtonTop"


class _Form(HTMLParser):
    """Collects what a browser would submit for the main form (no buttons, no unchecked boxes)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.fields: dict[str, str] = {}
        self.action = ""
        self._select: str | None = None
        self._first_option: str | None = None
        self._selected = False
        self._in_form = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form" and a.get("name") == "main_form":
            self._in_form = True
            self.action = html.unescape(a.get("action") or "")
        if not self._in_form:
            return
        name = a.get("name")
        if tag == "input" and name and "disabled" not in a:
            typ = (a.get("type") or "text").lower()
            if typ in ("submit", "image", "button", "reset", "file"):
                return
            if typ in ("checkbox", "radio") and "checked" not in a:
                return
            self.fields[name] = a.get("value") or ("on" if typ == "checkbox" else "")
        elif tag == "select" and name and "disabled" not in a:
            self._select, self._first_option, self._selected = name, None, False
        elif tag == "option" and self._select:
            val = a.get("value", "")
            if self._first_option is None:
                self._first_option = val
            if "selected" in a and not self._selected:
                self.fields[self._select] = val
                self._selected = True
        elif tag == "textarea" and name:
            self.fields[name] = ""

    def handle_endtag(self, tag):
        if tag == "select" and self._select:
            if not self._selected and self._first_option is not None:
                self.fields[self._select] = self._first_option
            self._select = None
        if tag == "form":
            self._in_form = False


def parse_form(page: str) -> tuple[str, dict[str, str]]:
    f = _Form()
    f.feed(page)
    action = f.action or "/index.php?page=entreprise.EntrepriseAdvancedSearch&searchAnnCons"
    return ROOT.rstrip("/") + action if action.startswith("/") else ROOT + action.lstrip("./"), f.fields


def postback(form: dict[str, str], target: str, **extra: str) -> dict[str, str]:
    data = dict(form)
    data["PRADO_POSTBACK_TARGET"] = target
    data["PRADO_POSTBACK_PARAMETER"] = ""
    data.update(extra)
    return data


def _clean(fragment: str) -> str:
    text = re.sub(r"(?is)<br\s*/?>", "\n", fragment)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\s*\n\s*", "\n", text)).strip()


def _first(pattern: str, chunk: str, flags=re.S) -> str:
    m = re.search(pattern, chunk, flags)
    return _clean(m.group(1)) if m else ""


ROW_SPLIT = re.compile(r'<input type="hidden" name="ctl0\$CONTENU_PAGE\$resultSearch\$tableauResultSearch\$ctl\d+\$refCons"')


def parse_results(page: str) -> list[dict]:
    """Rows of one results page."""
    rows = []
    for chunk in ROW_SPLIT.split(page)[1:]:
        ref_id = _first(r'^[^>]*value="(\d+)"', chunk)
        org = _first(r'_orgCons" value="([^"]*)"', chunk)
        if not ref_id or not org:
            continue
        deadline_m = re.search(r'cloture-line">\s*(\d\d/\d\d/\d{4})<br>\s*(\d\d:\d\d)', chunk)
        pub_m = re.search(r'panelBlocCategorie">.*?</div>\s*<div>\s*(\d\d/\d\d/\d{4})', chunk, re.S)
        lieu = _first(r'panelBlocLieuxExec"[^>]*>(.*?)<div class="bloc-info-bulle">', chunk)
        lieu_full = _first(r'_infosLieuExecution" class="info-bulle"><div>(.*?)</div>', chunk)
        rows.append({
            "ref_id": ref_id,
            "org": org,
            "procedure_code": _first(r'<div class="line-info-bulle">\s*([^<\s][^<]*?)\s*<a', chunk),
            "procedure": _first(r'_type_procedure">(.*?)</div>', chunk),
            "category": _first(r'panelBlocCategorie">(.*?)</div>', chunk),
            "published": _dmy(pub_m.group(1)) if pub_m else "",
            "reference": _first(r'_reference" class="ref">(.*?)</span>', chunk),
            "object": _first(r'_infosBullesObjet" class="info-bulle"[^>]*>\s*<div>(.*?)</div>', chunk)
            or _first(r'Objet\s*:\s*</strong>(.*?)<span', chunk),
            "buyer": _first(r'Acheteur public\s*:\s*</strong>(.*?)</div>', chunk),
            "places": [p.strip() for p in re.split(r"[\n,]+", lieu_full or lieu) if p.strip()],
            "deadline": f"{_dmy(deadline_m.group(1))}T{deadline_m.group(2)}" if deadline_m else "",
            "env_clauses": "dispositions envrionnementales" in chunk or "dispositions environnementales" in chunk,
        })
    return rows


def _dmy(s: str) -> str:
    try:
        return datetime.strptime(s.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return ""


def page_info(page: str) -> tuple[int, int]:
    total = re.search(r'resultSearch_nombreElement">\s*(\d+)', page)
    pages = re.search(r'resultSearch_nombrePageTop">\s*(\d+)', page)
    return (int(total.group(1)) if total else 0, int(pages.group(1)) if pages else 0)


PUBLISHED_FROM = P + "AdvancedSearch$dateMiseEnLigneCalculeStart"


def fetch_open(http: Polite, *, published_since: date | None = None, page_size: int = 500, max_pages: int = 20,
               log=print) -> list[dict]:
    """Consultations listed as open ("Consultations en cours"), one POST per page of `page_size` rows.
    With `published_since`, only those put online since that date (the portal's "date de mise en ligne"
    criterion): one or two pages instead of nine, which is what the twice-daily runs use."""
    page = http.text(SEARCH_URL)
    action, form = parse_form(page)
    extra = {PUBLISHED_FROM: published_since.strftime("%d/%m/%Y")} if published_since else {}
    page = http.text(action, postback(form, SEARCH_BUTTON, **extra))
    action, form = parse_form(page)
    page = http.text(action, postback(form, PAGE_SIZE, **{PAGE_SIZE: str(page_size), PAGE_SIZE_BOTTOM: str(page_size)}))
    total, pages = page_info(page)
    log(f"PMMP: {total} consultations en cours{' publiées depuis le ' + published_since.isoformat() if published_since else ''}, "
        f"{pages} pages de {page_size}")
    rows = parse_results(page)
    for n in range(2, min(pages, max_pages) + 1):
        action, form = parse_form(page)
        page = http.text(action, postback(form, GOTO_PAGE, **{PAGE_NUM: str(n), PAGE_SIZE: str(page_size),
                                                              PAGE_SIZE_BOTTOM: str(page_size)}))
        got = parse_results(page)
        log(f"PMMP: page {n}/{pages}: {len(got)} lignes")
        if not got:
            break
        rows.extend(got)
    seen, out = set(), []
    for r in rows:
        k = (r["org"], r["ref_id"])
        if k not in seen:
            seen.add(k)
            out.append(r)
    if total and len(out) < total * 0.9:
        raise RuntimeError(f"PMMP: {len(out)} lignes lues pour {total} annoncées")
    return out


# --------------------------------------------------------------------------------------------- details

_DETAIL_LABELS = {
    "estimate": r"Estimation \(en Dhs TTC\)",
    "bond": r"Caution provisoire",
    "plans_price": r"Prix d'acquisition des plans",
    "reserved": r"Réservé à la TPE et PME[^:]*",
    "visit": r"Visites des lieux",
    "meeting": r"Réunion",
    "variant": r"Variante",
    "allotment": r"Allotissement",
}


def _after_label(text: str, label: str) -> str:
    m = re.search(label + r"\s*(?:\*\s*)?:\s*(.*?)\s*(?:@@@@|\n\n|$)", text, re.S)
    if not m:
        return ""
    return m.group(1).split("\n")[0].strip()


def parse_detail(page: str) -> dict:
    """Structured fields of a detail page. Personal contact details are deliberately not extracted."""
    i = page.find("Date et heure limite de remise des plis")
    j = page.find("Contact Administratif")
    body = page[i:j if j > i else i + 60000] if i >= 0 else ""
    text = re.sub(r"(?s)<(script|style).*?</\1>", "", body)
    text = re.sub(r"(?is)<br\s*/?>|</(div|li|tr|p|td|span)>", "\n", text)
    text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", text)).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*\n\s*", "\n", text)
    flat = re.sub(r"\n(?=\s*[:*])", " ", text)
    flat = re.sub(r":\s*\n", ": ", flat)
    flat = re.sub(r"\*\s*\n", "* ", flat)
    out: dict = {}
    for key, label in _DETAIL_LABELS.items():
        v = _after_label(flat, label)
        if v and v not in ("-",):
            out[key] = v
    for key in ("estimate", "bond", "plans_price"):
        if key in out:
            amount = _amount(out[key])
            if amount is None:
                out.pop(key)
            else:
                out[key] = amount
    if "reserved" in out:
        out["reserved"] = out["reserved"].lower().startswith("oui")
    doms = re.findall(r"Domaines d'activité\s*:\s*\n?(.*?)\n", flat)
    domains = [d.strip() for d in doms if " / " in d and not re.match(r"\s*(Domaines|Adresse)", d)]
    if domains:
        out["domains"] = domains[:6]
    acheteur = _after_label(flat, r"Acheteur public")
    if acheteur:
        out["buyer_full"] = acheteur
    typ = _after_label(flat, r"Type d'annonce")
    if typ:
        out["notice_type"] = typ
    lots = re.search(r"Allotissement\s*:\s*(\d+)\s*lots?", flat, re.I)
    if lots:
        out["lots"] = int(lots.group(1))
    return out


def _amount(s: str) -> float | None:
    m = re.search(r"(\d[\d\s.]*(?:,\d+)?)", s)
    if not m:
        return None
    raw = m.group(1).replace(" ", "").replace(".", "").replace(",", ".")
    try:
        v = float(raw)
    except ValueError:
        return None
    return v if v > 0 else None


def detail_url(org: str, ref_id: str) -> str:
    return DETAIL_URL.format(ref=ref_id, org=org)
