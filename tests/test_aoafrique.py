import json
from datetime import date, datetime
from pathlib import Path

from aoafrique import model, pmmp, worldbank
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
    site = Site(tmp_path, notices, meta, "https://outils.vread.fr/veille-ao-afrique/")
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
    assert "Pré-inscription, sans paiement" in alerts and "bientôt disponible" in alerts and "09-08" in alerts
