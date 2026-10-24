import json
import re
from datetime import date, datetime
from pathlib import Path

from aoafrique import benin, model, pmmp, tunisie, worldbank
from aoafrique.site import Site

FX = Path(__file__).parent / "fixtures"


def test_parse_results_rows():
    rows = pmmp.parse_results((FX / "pmmp_list.html").read_text(encoding="utf-8"))
    assert len(rows) == 3
    r = rows[0]
    assert r["ref_id"] == "1005224" and r["org"] == "h5j"
    assert r["procedure"] == "Appel d'offres ouvert"
    assert r["category"] == "Fournitures"
    assert r["published"] == "2026-10-09"
    assert r["deadline"] == "2026-11-26T11:00"
    assert r["places"] == ["CHICHAOUA"]
    assert "Prison Locale Chichaoua" in r["object"]
    assert r["buyer"].startswith("DELEGATION GENERALE")


def test_parse_form_keeps_state_and_drops_buttons():
    action, fields = pmmp.parse_form((FX / "pmmp_list.html").read_text(encoding="utf-8"))
    assert action.startswith("https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch")
    assert fields["PRADO_PAGESTATE"] == "STATE"
    assert fields[pmmp.PAGE_SIZE] == "10"
    assert not any(k.endswith("DefaultButtonTop") for k in fields)


def test_parse_detail_amounts_without_contacts():
    d = pmmp.parse_detail((FX / "pmmp_detail.html").read_text(encoding="utf-8"))
    assert d["estimate"] == 5929356.0
    assert d["bond"] == 100000.0
    assert d["reserved"] is False
    assert d["domains"][0].startswith("Fournitures / Matériel")
    assert not any("@" in str(v) for v in d.values())


def test_regions_and_sectors():
    assert model.regions_of(["TANGER-ASSILAH"]) == ["Tanger-Tétouan-Al Hoceïma"]
    assert model.regions_of(["CHICHAOUA"]) == ["Marrakech-Safi"]
    assert model.regions_of(["Tout le Royaume"]) == []
    assert model.sectors_of("Renforcement de l'AEP du centre et des douars", "Travaux")[0] == "eau-assainissement"
    assert model.sectors_of("Acquisition d'une solution de téléphonie IP", "Fournitures")[0] == "informatique-telecoms"
    assert model.sectors_of("Travaux de réfection de la chaussée", "Travaux") == ["btp"]
    assert model.sectors_of("Achat de chaises", "Fournitures") == ["fournitures-mobilier"]


def test_summary_uses_fields_only():
    rows = pmmp.parse_results((FX / "pmmp_list.html").read_text(encoding="utf-8"))
    d = pmmp.parse_detail((FX / "pmmp_detail.html").read_text(encoding="utf-8"))
    n = model.from_pmmp(rows[0], d)
    n["detail_checked"] = True
    s = model.summary(n, date(2026, 10, 13))
    assert "publié le 9 octobre 2026" in s
    assert "5,93 M MAD TTC" in s
    assert "100 000 MAD" in s
    assert "jeudi 26 novembre 2026 à 11 h (44 jours)" in s
    assert n["slug"].startswith("ma-h5j-1005224-")


def test_worldbank_normalise():
    raw = {"id": "OP00474277", "notice_type": "Invitation for Bids", "noticedate": "09-Oct-2026",
           "submission_deadline_date": "2026-10-23T00:00:00Z", "submission_deadline_time": "11:00",
           "project_ctry_name": "Madagascar", "project_id": "P506569", "project_name": "Transforming Access",
           "bid_reference_no": "MG-1", "bid_description": "ACQUISITION DEUX SERVEURS pour la DSI",
           "procurement_group": "GO", "contact_organization": "UFP", "contact_name": "X", "contact_email": "x@y.mg"}
    n = model.from_worldbank(worldbank.normalise(raw))
    assert n["country"] == "Madagascar" and n["deadline"] == "2026-10-23T11:00"
    assert n["category"] == "Fournitures" and "contact_email" not in n and "x@y.mg" not in json.dumps(n)
    assert n["url"].endswith("/OP00474277")


def test_build_site(tmp_path):
    rows = pmmp.parse_results((FX / "pmmp_list.html").read_text(encoding="utf-8"))
    notices = [model.from_pmmp(r, None) for r in rows]
    meta = {"updated": "2026-10-13T05:40+00:00", "sources": {"PMMP": {"ok": True, "at": "2026-10-13T05:40+00:00", "open": 3}}}
    site = Site(tmp_path, notices, meta, "https://ao-afrique.jalonel.com/")
    site.now = datetime(2026, 10, 13, 8, 0)
    site.today = site.now.date()
    site.open = notices
    site.build_all()
    idx = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "application/ld+json" in idx and "Consultations en cours" in idx
    page = (tmp_path / "ao" / notices[0]["slug"] / "index.html").read_text(encoding="utf-8")
    assert "marchespublics.gov.ma" in page and '"@type": "Demand"' in page
    assert (tmp_path / "sitemap.xml").read_text().count("<url>") > 10
    data = json.loads((tmp_path / "data" / "ouverts.json").read_text(encoding="utf-8"))
    assert data["count"] == 3
    alerts = (tmp_path / "alertes" / "index.html").read_text(encoding="utf-8")
    assert "09-08" in alerts and "bientôt disponible" not in alerts and "Pré-inscription, sans paiement" not in alerts
    # Paid plans (2026-10-24): real buttons, product ids and server prices of octave-global-checkout, CGV, VAT basis.
    assert 'data-product="aoaf-essentiel-3m-eur" data-amount="3900"' in alerts and 'data-product="aoaf-pro-3m-eur" data-amount="7900"' in alerts
    assert 'data-venture="af-xx-04"' in alerts and "/static/og-checkout.js?v=" in alerts and 'href="/cgv/"' in alerts
    assert "259-1°" in alerts and "293 B" not in alerts and "hors de l'Union européenne" in alerts
    assert "https://js.stripe.com" in alerts and "anglais" not in alerts and "CSV" not in alerts
    assert "pas encore ouverts" not in alerts and "alertes@jalonel.com" in alerts
    offers = [json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', alerts) if '"Offer"' in x][0]["offers"]
    assert [(o["price"], o["priceCurrency"]) for o in offers] == [("39.00", "EUR"), ("79.00", "EUR")]
    cgv = (tmp_path / "cgv" / "index.html").read_text(encoding="utf-8")
    for words in ("READ FRANCE SAS", "988 741 773", "39 €", "79 €", "3 mois", "14 jours", "259-1°", "3 novembre 2026", "Union européenne", "noindex"):
        assert words in cgv, words
    assert "FR57" not in cgv and "293 B" not in cgv
    assert "https://js.stripe.com" not in idx, "Stripe allowed by the CSP of the payment page only"
    assert 'href="/cgv/"' in idx
    assert "Achat d'une formule payante" in (tmp_path / "confidentialite" / "index.html").read_text(encoding="utf-8")
    lic = (tmp_path / "licence.html").read_text(encoding="utf-8")
    assert "Conditions de réutilisation des données" in lic and "31-13" in lic and "CC BY 4.0" in lic
    assert "https://ao-afrique.jalonel.com/licence.html</loc>" in (tmp_path / "sitemap.xml").read_text()
    ds = [x for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', idx) if '"Dataset"' in x]
    assert json.loads(ds[0])["license"] == "https://ao-afrique.jalonel.com/licence.html"
    assert (tmp_path / "CNAME").read_text() == "ao-afrique.jalonel.com\n"
    assert (tmp_path / "5be19f56d46ca3d2553bee28ebfa8edd.txt").read_text() == "5be19f56d46ca3d2553bee28ebfa8edd"
    assert (tmp_path / "3f9c2b7e8a4d41c6b0e5a17d9c62f4e8.txt").read_text() == "3f9c2b7e8a4d41c6b0e5a17d9c62f4e8"
    assert "Sitemap: https://ao-afrique.jalonel.com/sitemap.xml" in (tmp_path / "robots.txt").read_text()
    assert '<link rel="canonical" href="https://ao-afrique.jalonel.com/">' in idx and 'href="/alertes/"' in idx
    assert "/veille-ao-afrique/" not in idx and "outils.vread.fr/veille" not in idx
    assert '<a href="https://jalonel.com/">Une marque Jalonel</a>' in idx
    ws = [json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', idx) if '"WebSite"' in x]
    assert ws[0]["publisher"]["name"] == "Jalonel" and ws[0]["publisher"]["parentOrganization"]["name"] == "READ FRANCE SAS"
    legal = (tmp_path / "mentions-legales" / "index.html").read_text(encoding="utf-8")
    assert "Jalonel est une marque de READ FRANCE SAS." in legal and "988 741 773" in legal
    # Jalonel kept apart from Vread: no Vread address or host, no GitHub repository or source-code link anywhere.
    for f in tmp_path.rglob("*"):
        if f.suffix in (".html", ".js", ".css", ".json", ".xml", ".txt"):
            t = f.read_text(encoding="utf-8")
            assert "vread" not in t.lower() and "github.com/" not in t.replace("docs.github.com/", "") \
                and "code source" not in t.lower() and "/issues" not in t, f
    assert "mailto:contact@jalonel.com" in legal


def test_inline_alert_on_tender_list_and_filter_pages(tmp_path):
    rows = pmmp.parse_results((FX / "pmmp_list.html").read_text(encoding="utf-8"))
    notices = [model.from_pmmp(r, None) for r in rows]
    meta = {"updated": "2026-10-13T05:40+00:00", "sources": {}}
    site = Site(tmp_path, notices, meta, "https://ao-afrique.jalonel.com/")
    site.now = datetime(2026, 10, 13, 8, 0)
    site.today = site.now.date()
    site.open = notices
    site.build_all()
    n = notices[0]
    page = (tmp_path / "ao" / n["slug"] / "index.html").read_text(encoding="utf-8")
    # one short form, after the key facts, pre-filled with the tender's sector and region
    assert page.count('<form id="alerte-inline"') == 1
    assert page.index('class="facts-table"') < page.index('id="alerte"') < page.index('id="suite"')
    sector = next(s for s in n["sectors"] if s != "autre")
    assert f'<option value="{sector}" selected>' in page
    assert f'<option value="{model.slugify(n["regions"][0])}" selected>' in page
    assert 'data-ctx="fiche"' in page and "/static/alerte-inline.js" in page
    # honest price and status next to the button
    assert "Gratuit pendant le test" in page and "39 €" in page and "sans renouvellement automatique" in page
    assert "Envoi chaque matin" in page and "ouvre bientôt" not in page and "Aucun paiement aujourd'hui" not in page
    # similar notices, links to the sector and region, clear next step at the end
    assert "Et maintenant ?" in page and 'href="#alerte"' in page
    assert f'href="/secteurs/{sector}/"' in page
    assert "Consultations proches" not in page
    form = page[page.index('<form id="alerte-inline"'):page.index("</form>", page.index('<form id="alerte-inline"'))]
    assert form.count('name="email"') == 1 and form.count('type="checkbox"') == 1, "short form: e-mail + consent"
    idx = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert 'data-ctx="liste"' in idx and 'href="#alerte"' in idx
    sec = (tmp_path / "secteurs" / sector / "index.html").read_text(encoding="utf-8")
    assert 'data-ctx="secteur"' in sec and f'<option value="{sector}" selected>' in sec
    reg = (tmp_path / "regions" / model.slugify(n["regions"][0]) / "index.html").read_text(encoding="utf-8")
    assert 'data-ctx="region"' in reg
    assert 'data-ctx="afrique"' in (tmp_path / "afrique-francophone" / "index.html").read_text(encoding="utf-8")


def test_legal_pages_noindex_out_of_sitemap(tmp_path):
    # Legal notice and privacy pages are near-identical across the Jalonel subdomains: noindex, follow, not in the sitemap.
    rows = pmmp.parse_results((FX / "pmmp_list.html").read_text(encoding="utf-8"))
    notices = [model.from_pmmp(r, None) for r in rows]
    site = Site(tmp_path, notices, {"updated": "2026-10-13T05:40+00:00", "sources": {}}, "https://ao-afrique.jalonel.com/")
    site.now = datetime(2026, 10, 13, 8, 0)
    site.today = site.now.date()
    site.open = notices
    site.build_all()
    sm = (tmp_path / "sitemap.xml").read_text()
    for p in ("mentions-legales", "confidentialite"):
        assert '<meta name="robots" content="noindex, follow">' in (tmp_path / p / "index.html").read_text(encoding="utf-8")
        assert f"/{p}/</loc>" not in sm
    assert "noindex" not in (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "/licence.html</loc>" in sm


def _update(tmp_path, monkeypatch, old, pmmp_rows, wb=None, wb_fail=False, nat=None, nat_fail=None):
    """Run `update` on a temporary data dir with fake sources; pmmp_rows None = portal down."""
    import argparse
    from aoafrique import __main__ as cli
    data = tmp_path / "data"
    data.mkdir(exist_ok=True)
    cli.dump(data / "notices.json", old)
    cli.dump(data / "pmmp_rows.json", [])
    cli.dump(data / "meta.json", {"checked": "2026-10-20T20:42+00:00", "updated": "2026-10-20T20:42+00:00",
                                  "sources": {"PMMP": {"ok": True, "at": "2026-10-20T20:42+00:00"}}})
    monkeypatch.setattr(cli, "DATA", data)

    def fetch_open(http, published_since=None):
        if pmmp_rows is None:
            raise OSError("Connection timed out")
        return pmmp_rows

    def wb_open(http, today):
        if wb_fail:
            raise OSError("API down")
        return wb or []
    def nat_open(src):
        def fetch(http, now):
            if (wb_fail if nat_fail is None else nat_fail):
                raise OSError("portal down")
            return (nat or {}).get(src, [])
        return fetch
    monkeypatch.setattr(cli.pmmp, "fetch_open", fetch_open)
    monkeypatch.setattr(cli.worldbank, "fetch_open", wb_open)
    monkeypatch.setattr(cli.benin, "fetch_open", nat_open("BJ"))
    monkeypatch.setattr(cli.tunisie, "fetch_open", nat_open("TN"))
    args = argparse.Namespace(delay=0, details=0, detail_minutes=1, full=False)
    code = cli.cmd_update(args)
    return code, json.loads((data / "notices.json").read_text()), json.loads((data / "meta.json").read_text())


def _bm(i):
    return {"id": f"bm-{i}", "source": "BM", "object": f"Avis {i}", "deadline": "2099-01-01", "published": "2026-10-01"}


def test_update_one_source_down_publishes_with_last_known_data(tmp_path, monkeypatch):
    rows = pmmp.parse_results((FX / "pmmp_list.html").read_text(encoding="utf-8"))
    for r in rows:
        r["deadline"] = "2099-01-01T10:00"
    old = [model.from_pmmp(r, None) for r in rows] + [_bm(i) for i in range(3)]
    # Portal down: stored rows are empty here, so the PMMP notices survive through the 30-day "delisted" rule.
    code, notices, meta = _update(tmp_path, monkeypatch, old, None, wb_fail=False)
    assert code == 0
    assert meta["sources"]["PMMP"]["ok"] is False and "timed out" in meta["sources"]["PMMP"]["error"]
    assert meta["sources"]["PMMP"]["at"] == "2026-10-20T20:42+00:00"  # last success kept
    assert meta["sources"]["BM"]["ok"] is True and "guard" not in meta


def test_update_fails_when_all_sources_fail(tmp_path, monkeypatch):
    old = [_bm(i) for i in range(5)]
    code, notices, meta = _update(tmp_path, monkeypatch, old, None, wb_fail=True)
    assert code == 1 and meta["guard"]["problems"]
    assert [n["id"] for n in notices] == [n["id"] for n in old]  # data untouched


def test_update_guard_blocks_mass_removal(tmp_path, monkeypatch):
    old = [_bm(i) for i in range(200)]
    for n in old[20:]:
        n["deadline"] = "2026-01-01"  # closed long ago: 180 of 200 would be dropped
    code, notices, meta = _update(tmp_path, monkeypatch, old, [], wb=[])
    assert code == 1 and any("chute anormale" in p for p in meta["guard"]["problems"])
    assert len(notices) == 200


def test_status_file_and_source_dates(tmp_path):
    rows = pmmp.parse_results((FX / "pmmp_list.html").read_text(encoding="utf-8"))
    notices = [model.from_pmmp(r, None) for r in rows]
    meta = {"updated": "2026-10-20T20:42+00:00", "checked": "2026-10-21T12:34+00:00", "sources": {
        "PMMP": {"ok": False, "at": "2026-10-20T20:42+00:00", "failed_at": "2026-10-21T12:34+00:00", "error": "timed out"},
        "BM": {"ok": True, "at": "2026-10-21T12:34+00:00"}}}
    site = Site(tmp_path, notices, meta, "https://ao-afrique.jalonel.com/")
    site.now = datetime(2026, 10, 13, 8, 0)
    site.today = site.now.date()
    site.open = notices
    site.build_all()
    st = json.loads((tmp_path / "statut.json").read_text(encoding="utf-8"))
    assert st["sources"]["PMMP"]["ok"] is False and st["sources"]["PMMP"]["last_success"] == "2026-10-20T20:42+00:00"
    assert st["sources"]["BM"]["ok"] is True and st["sources"]["BM"]["error"] is None
    idx = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "portail marocain le 20 octobre 2026 à 22 h 42 (dernière tentative en échec" in idx
    assert "Banque mondiale le 21 octobre 2026 à 14 h 34" in idx and 'href="/statut.json"' in idx
    feed = json.loads((tmp_path / "data" / "alertes.json").read_text(encoding="utf-8"))
    assert feed["sectors"]["btp"] and all({"i", "o", "s", "r", "x", "f", "d"} <= set(n) for n in feed["notices"])


# ------------------------------------------------------------------ national portals (Bénin, Tunisie)
class _FakeHttp:
    def __init__(self, payloads):
        self.payloads, self.calls = list(payloads), []

    def json(self, url, params=None, extra=None):
        self.calls.append((url, params, extra))
        return self.payloads.pop(0)


def test_benin_fetch_and_normalise_without_contacts():
    from zoneinfo import ZoneInfo
    payload = json.loads((FX / "benin_appelsoffres.json").read_text(encoding="utf-8"))
    http = _FakeHttp([payload])
    rows = benin.fetch_open(http, datetime(2026, 10, 21, 15, 0, tzinfo=ZoneInfo("Africa/Porto-Novo")), log=lambda *a: None)
    assert len(http.calls) == 1 and http.calls[0][1]["limitStart"] == 1792537200000  # 21/10/2026 00:00 Cotonou
    n = model.from_national(benin.normalise(rows[0]))
    assert n["id"] == "bj-1249053" and n["source"] == "BJ" and n["country"] == "Bénin"
    assert n["reference"] == "F_DSA_125322" and n["deadline"] == "2026-11-24T10:00" and n["published"] == "2026-10-20"
    assert n["category"] == "Fournitures" and n["buyer"].startswith("Agence des Systèmes d'Information")
    assert n["url"] == "https://www.marches-publics.bj/appels-doffres?search=F_DSA_125322"
    assert n["pdf"].startswith("https://bi.marches-publics.bj/") and " " not in n["pdf"]
    dumped = json.dumps(n, ensure_ascii=False)
    assert "example.bj" not in dumped and "0100000000" not in dumped and "0100000001" not in dumped
    s = model.summary(n, date(2026, 10, 21))
    assert "portail national des marchés publics du Bénin" in s and "mardi 24 novembre 2026 à 10 h (34 jours)" in s


def test_tunisie_keeps_open_french_notices_only():
    from zoneinfo import ZoneInfo
    payload = json.loads((FX / "tunisie_appelsoffres.json").read_text(encoding="utf-8"))
    http = _FakeHttp([payload])
    rows = tunisie.fetch_open(http, datetime(2026, 10, 21, 15, 0, tzinfo=ZoneInfo("Africa/Tunis")), log=lambda *a: None)
    assert http.calls[0][2] == {"X-Requested-With": "XMLHttpRequest"} and http.calls[0][1]["start"] == 0
    ids = [r["id"] for r in rows]
    assert ids == ["Tender-104364", "Tender-104363", "Tender-104361"]  # Arabic-only title and closed notice dropped
    n = model.from_national(tunisie.normalise(rows[0]))
    assert n["id"] == "tn-104364" and n["country"] == "Tunisie" and n["reference"] == "Tender-104364"
    assert n["deadline"] == "2026-11-20T09:30" and n["published"] == "2026-10-21"
    assert n["url"] == "https://www.marchespublics.gov.tn/fr/appels-doffres/Tender-104364"
    sme = model.from_national(tunisie.normalise(rows[2]))
    assert sme["sme"] is True and "réservé aux petites et moyennes entreprises" in model.summary(sme, date(2026, 10, 21))
    assert tunisie.is_french("Acquisition de batteries") and not tunisie.is_french("استبدال معدات")


def _national_notices():
    from zoneinfo import ZoneInfo
    now = datetime(2026, 10, 21, 15, 0, tzinfo=ZoneInfo("Africa/Tunis"))
    tn = [model.from_national(tunisie.normalise(r)) for r in
          tunisie.fetch_open(_FakeHttp([json.loads((FX / "tunisie_appelsoffres.json").read_text(encoding="utf-8"))]),
                             now, log=lambda *a: None)]
    bj = [model.from_national(benin.normalise(r)) for r in
          json.loads((FX / "benin_appelsoffres.json").read_text(encoding="utf-8"))["content"]]
    return bj, tn


def test_country_pages_sitemap_and_ab_test_on_new_tenders(tmp_path):
    rows = pmmp.parse_results((FX / "pmmp_list.html").read_text(encoding="utf-8"))
    bj, tn = _national_notices()
    for n in tn:
        n["sectors"] = ["btp"]  # 3 open notices in one sector: indexed country × sector page
    notices = [model.from_pmmp(r, None) for r in rows] + bj + tn
    site = Site(tmp_path, notices, {"updated": "2026-10-21T13:00+00:00", "sources": {}}, "https://ao-afrique.jalonel.com/")
    site.now = datetime(2026, 10, 21, 16, 0)
    site.today = site.now.date()
    site.open = notices
    site.build_all()
    sm = (tmp_path / "sitemap.xml").read_text()
    tun = (tmp_path / "pays" / "tunisie" / "index.html").read_text(encoding="utf-8")
    ben = (tmp_path / "pays" / "benin" / "index.html").read_text(encoding="utf-8")
    sec = (tmp_path / "pays" / "tunisie" / "btp" / "index.html").read_text(encoding="utf-8")
    # 3 Tunisian notices: indexed and in the sitemap; 2 Beninese ones: page kept, noindex, out of the sitemap
    assert "/pays/tunisie/</loc>" in sm and "/pays/tunisie/btp/</loc>" in sm and "/pays/</loc>" in sm
    assert "/pays/benin/</loc>" not in sm and '<meta name="robots" content="noindex, follow">' in ben
    assert "noindex" not in tun and "Appels d'offres publics en Tunisie : 3 avis ouverts" in tun
    assert 'href="/pays/tunisie/btp/"' in tun and 'href="/pays/tunisie/"' in sec and 'href="/secteurs/btp/"' in sec
    assert 'value="tunisie"' in tun and 'data-ctx="pays"' in tun
    # structured data: breadcrumb and item list of tender pages, no rating or review
    for page in (tun, sec):
        lds = [json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page)]
        types = {x["@type"] for x in lds}
        assert {"BreadcrumbList", "CollectionPage"} <= types
        assert "Review" not in page and "AggregateRating" not in page and "ratingValue" not in page
    cp = next(x for x in (json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', tun))
              if x["@type"] == "CollectionPage")
    assert cp["mainEntity"]["numberOfItems"] == 3 and cp["mainEntity"]["itemListElement"][0]["url"].startswith(
        "https://ao-afrique.jalonel.com/ao/tn-")
    # internal links: home, /pays/, sector page and tender pages point to the country pages
    assert 'href="/pays/"' in (tmp_path / "index.html").read_text(encoding="utf-8")
    pays = (tmp_path / "pays" / "index.html").read_text(encoding="utf-8")
    assert 'href="/pays/tunisie/"' in pays and 'href="/pays/benin/"' in pays
    assert 'href="/pays/tunisie/btp/"' in (tmp_path / "secteurs" / "btp" / "index.html").read_text(encoding="utf-8")
    t = tn[0]
    page = (tmp_path / "ao" / t["slug"] / "index.html").read_text(encoding="utf-8")
    assert "/static/xp.js" in page and 'id="alerte-rapide"' in page and 'data-ctx="fiche-pays-rapide"' in page
    assert '<input type="hidden" name="countries" value="tunisie">' in page and 'data-ctx="fiche-pays"' in page
    assert 'href="/pays/tunisie/"' in page and "marchespublics.gov.tn" in page and "Portail tunisien" in page
    assert '"@type": "Demand"' in page
    b = (tmp_path / "ao" / bj[0]["slug"] / "index.html").read_text(encoding="utf-8")
    assert "Avis officiel (PDF)" in b and "marches-publics.bj" in b
    data = json.loads((tmp_path / "data" / "ouverts.json").read_text(encoding="utf-8"))
    assert {n["x"] for n in data["notices"]} >= {"BJ", "TN", "PMMP"}
    st = json.loads((tmp_path / "statut.json").read_text(encoding="utf-8"))
    assert {"BJ", "TN"} <= set(st["sources"]) and st["sources"]["TN"]["open"] == 3


def test_update_national_sources_first_read_and_failure(tmp_path, monkeypatch):
    bj_raw = json.loads((FX / "benin_appelsoffres.json").read_text(encoding="utf-8"))["content"]
    old = [_bm(i) for i in range(3)]
    code, notices, meta = _update(tmp_path, monkeypatch, old, [], wb=[], nat={"BJ": bj_raw, "TN": []})
    assert code == 0 and meta["sources"]["BJ"]["ok"] is True and meta["sources"]["BJ"]["open"] == 2
    bj = {n["id"]: n for n in notices if n["source"] == "BJ"}
    # first read: dated from publication, so the feed and IndexNow do not present a backlog as new
    assert bj["bj-1249053"]["first_seen"] == "2026-10-20" and bj["bj-1248059"]["first_seen"] == "2026-10-15"
    # next run, portal down: last known notices kept, failure recorded, run not failed
    code, notices2, meta2 = _update(tmp_path, monkeypatch, notices, [], wb=[], nat_fail=True)
    assert code == 0 and meta2["sources"]["BJ"]["ok"] is False and "portal down" in meta2["sources"]["BJ"]["error"]
    assert {n["id"] for n in notices2 if n["source"] == "BJ"} == set(bj)


def test_pmmp_stale_forces_full_relist_after_outage():
    from datetime import timezone
    from aoafrique.__main__ import pmmp_stale
    now = datetime(2026, 10, 24, 13, 29, tzinfo=timezone.utc)
    assert pmmp_stale({"at": "2026-10-20T20:42+00:00"}, now)  # 3.7 days: the 4-day window may miss notices
    assert not pmmp_stale({"at": "2026-10-24T01:16+00:00"}, now)
    assert pmmp_stale({}, now) and pmmp_stale({"at": "?"}, now)

