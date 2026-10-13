"""Static site: list with filters, one page per tender, sector and region pages, alerts form, legal pages,
sitemap, Atom feed, JSON for the client-side filters."""

from __future__ import annotations

import hashlib
import json
import shutil
from collections import Counter
from datetime import datetime, timedelta
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

from . import model
from .model import SECTOR_LABEL, fmt_date, fmt_mad, fmt_short, place_label

BRAND = "Veille AO Afrique"
PATH = "/veille-ao-afrique/"
REPO_URL = "https://github.com/VREAD-corp/veille-ao-afrique"
CONTACT = "octave@vread.fr"
GAS_URL = "https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec"
INDEXNOW_KEY = "3f9c2b7e8a4d41c6b0e5a17d9c62f4e8"
GOOGLE_VERIFICATION_FILE = "google4f1f7b7ea70e5312.html"
PARIS = ZoneInfo("Europe/Paris")
CASA = ZoneInfo("Africa/Casablanca")
STATIC = Path(__file__).resolve().parent.parent / "static"
# Content hash in the snippet URL: search-engine renderers cache scripts by URL and would keep running an old one.
MESURE_V = hashlib.sha256((STATIC / "mesure.js").read_bytes()).hexdigest()[:10]
SELLER = {
    "name": "READ FRANCE SAS",
    "form": "société par actions simplifiée",
    "capital": "1 000 €",
    "address": "11 rue Rouvet, 75019 Paris, France",
    "siren": "988 741 773",
    "rcs": "RCS Paris 988 741 773",
    "president": "Tanguy Warsmann",
}
PLANS = [
    ("essentiel-39", "Essentiel", 39, "Maroc : les nouveaux appels d'offres de vos secteurs et régions, chaque matin, "
     "avec le résumé de chaque avis et le lien officiel."),
    ("pro-79", "Pro", 79, "Tout l'Essentiel, plus les avis Banque mondiale des pays d'Afrique francophone, un résumé "
     "en anglais pour vos partenaires et l'export CSV de vos sélections."),
]
CONSENT_TEXT = ("J'accepte que READ FRANCE SAS conserve mon adresse e-mail et les critères choisis pour me prévenir "
                "de l'ouverture de Veille AO Afrique et m'envoyer les alertes demandées. Je peux retirer mon accord "
                "à tout moment en écrivant à octave@vread.fr ou par le lien présent dans chaque e-mail.")
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "connect-src 'self' https://script.google.com https://script.googleusercontent.com; "
       "form-action 'self' https://script.google.com; base-uri 'self'")


def e(v) -> str:
    return escape("" if v is None else str(v), quote=True)


def link(p: str = "") -> str:
    return PATH + p


def nb(n: int) -> str:
    return f"{n:,}".replace(",", " ")


class Site:
    def __init__(self, out: Path, notices: list[dict], meta: dict, base_url: str):
        self.out = out
        self.base = base_url.rstrip("/") + "/"
        self.meta = meta
        now_utc = datetime.fromisoformat(meta.get("updated") or datetime.now().astimezone().isoformat())
        self.updated_paris = now_utc.astimezone(PARIS)
        self.now = datetime.now(CASA).replace(tzinfo=None)
        self.today = self.now.date()
        self.all = notices
        self.open = [n for n in notices if model.is_open(n, self.now) and not n.get("delisted")]
        self.open.sort(key=lambda n: (n.get("published", ""), n["id"]), reverse=True)
        self.pages: list[tuple[str, str]] = []  # (path, lastmod)

    # ------------------------------------------------------------------ shell
    def write(self, path: str, html: str, lastmod: str | None = None, sitemap: bool = True) -> None:
        target = self.out / path / "index.html" if (path == "" or path.endswith("/")) else self.out / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html, encoding="utf-8")
        if sitemap:
            self.pages.append((path, lastmod or self.updated_paris.date().isoformat()))

    def page(self, path: str, title: str, description: str, body: str, *, jsonld=None, scripts=(),
             noindex: bool = False, crumbs: list[tuple[str, str]] | None = None) -> str:
        canonical = self.base + path
        lds = []
        if crumbs:
            lds.append({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "name": name, "item": self.base + p}
                for i, (p, name) in enumerate(crumbs)]})
        if jsonld:
            lds.extend(jsonld if isinstance(jsonld, list) else [jsonld])
        ld = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False).replace("</", "<\\/")}</script>'
                     for x in lds)
        nav = [("", "Appels d'offres"), ("secteurs/", "Secteurs"), ("regions/", "Régions"),
               ("afrique-francophone/", "Afrique francophone"), ("methode/", "Méthode")]
        nav_html = "".join(f'<a href="{link(p)}"{" aria-current=\"page\"" if p == path else ""}>{label}</a>'
                           for p, label in nav)
        crumb_html = ""
        if crumbs and len(crumbs) > 1:
            crumb_html = ('<nav class="crumbs" aria-label="Fil d\'Ariane">' + " / ".join(
                f'<a href="{link(p)}">{e(name)}</a>' for p, name in crumbs[:-1]) + "</nav>")
        script_tags = "".join(f'<script src="{link("static/" + s)}" defer></script>' for s in scripts)
        return f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{e(CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{e(canonical)}">
{'<meta name="robots" content="noindex">' if noindex else ''}
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="{BRAND}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{e(canonical)}">
<meta property="og:image" content="{e(self.base)}static/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#16302b">
<link rel="icon" href="{link('static/favicon.svg')}" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="{BRAND} : nouveaux appels d'offres" href="{link('feed.xml')}">
<link rel="stylesheet" href="{link('static/style.css')}">
<script src="{link('static/mesure.js')}?v={MESURE_V}" defer></script>
{script_tags}
{ld}
</head>
<body>
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="top">
<div class="wrap top-in">
<a class="brand" href="{link()}"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7"/><path d="M8 23 16 8l8 15M11.5 17h9" /></svg><span>{BRAND}</span></a>
<nav class="nav-main" aria-label="Navigation principale">{nav_html}</nav>
<a class="btn btn-sm nav-cta" href="{link('alertes/')}" data-mesure="cta_click" data-detail="header">Alertes e-mail</a>
<details class="nav-menu"><summary>Menu</summary><nav aria-label="Navigation principale (mobile)">{nav_html}<a href="{link('alertes/')}">Alertes e-mail</a></nav></details>
</div>
</header>
<main id="contenu" class="wrap">
{crumb_html}
{body}
</main>
<footer class="foot">
<div class="wrap foot-in">
<div>
<p class="foot-brand">{BRAND}</p>
<p>Un service de {SELLER['name']} (SIREN {SELLER['siren']}), {SELLER['address']}.<br>Contact : <a href="mailto:{CONTACT}">{CONTACT}</a></p>
<p class="small">Données : <a href="https://www.marchespublics.gov.ma/" rel="noopener">Portail marocain des marchés publics</a> (Trésorerie Générale du Royaume) et <a href="https://datacatalog.worldbank.org/search/dataset/0037776/procurement-notice" rel="noopener">avis de passation de marchés de la Banque mondiale</a> (CC BY 4.0). Service indépendant, sans lien avec ces organismes. L'avis officiel fait foi.</p>
</div>
<nav aria-label="Liens de bas de page">
<a href="{link('methode/')}">Méthode et sources</a>
<a href="{link('alertes/')}">Alertes e-mail</a>
<a href="{link('mentions-legales/')}">Mentions légales</a>
<a href="{link('confidentialite/')}">Confidentialité</a>
<a href="{REPO_URL}">Code source</a>
</nav>
</div>
</footer>
</body>
</html>
"""

    # ------------------------------------------------------------------ pieces
    def badge(self, n: dict) -> str:
        left = model.days_left(n, self.today)
        if not model.is_open(n, self.now):
            return '<span class="badge closed">Clôturé</span>'
        if left is None:
            return ""
        if left <= 0:
            return '<span class="badge urgent">Dernier jour</span>'
        cls = "urgent" if left <= 7 else ("soon" if left <= 14 else "")
        return f'<span class="badge {cls}">J-{left}</span>'

    def where(self, n: dict) -> str:
        if n["source"] == "BM":
            return n.get("country", "")
        places = ", ".join(place_label(p) for p in n.get("places", [])[:3])
        return places or "Maroc"

    def card(self, n: dict, heading: str = "h3") -> str:
        facts = [f"<span>{e(n.get('category') or '')}</span>" if n.get("category") else "",
                 f"<span>{e(self.where(n))}</span>",
                 f"<span>{e(fmt_mad(n['estimate']))}</span>" if n.get("estimate") else ""]
        src = "Banque mondiale" if n["source"] == "BM" else "Portail marocain"
        return f"""<article class="card">
<div class="card-top">{self.badge(n)}<span class="src">{src}</span><span class="dl">Clôture {e(fmt_short(n['deadline']))}</span></div>
<{heading} class="card-title"><a href="{link('ao/' + n['slug'] + '/')}">{e(n['object'])}</a></{heading}>
<p class="buyer">{e(n.get('buyer'))}</p>
<p class="facts">{''.join(f for f in facts if f)}</p>
</article>"""

    def cards(self, items: list[dict], heading: str = "h3") -> str:
        return '<div class="cards">' + "".join(self.card(n, heading) for n in items) + "</div>"

    # ------------------------------------------------------------------ pages
    def stats(self) -> dict:
        pm = [n for n in self.open if n["source"] == "PMMP"]
        bm = [n for n in self.open if n["source"] == "BM"]
        week = (self.today - timedelta(days=7)).isoformat()
        return {
            "pmmp": len(pm), "bm": len(bm),
            "cat": Counter(n.get("category") for n in pm),
            "new7": sum(1 for n in pm if n.get("published", "") >= week),
            "close7": sum(1 for n in pm if (model.days_left(n, self.today) or 99) <= 7),
            "with_estimate": sum(1 for n in pm if n.get("estimate")),
            "countries": Counter(n.get("country") for n in bm),
        }

    def updated_text(self) -> str:
        u = self.updated_paris
        return f"{fmt_date(u.date().isoformat())} à {u.hour} h {u.minute:02d} (heure de Paris)"

    def build_index(self) -> None:
        s = self.stats()
        sample = next((n for n in self.open if n["source"] == "PMMP" and n.get("estimate") and n.get("bond")),
                      self.open[0] if self.open else None)
        sample_html = ""
        if sample:
            sample_html = f"""<figure class="sample">
<figcaption>Exemple tiré des données de ce matin</figcaption>
<p class="sample-obj"><a href="{link('ao/' + sample['slug'] + '/')}">{e(sample['object'])}</a></p>
<p class="sample-sum">{e(model.summary(sample, self.today))}</p>
<p class="small muted">Résumé produit par des règles fixes à partir des champs de l'avis, sans intelligence artificielle.</p>
</figure>"""
        sector_opts = "".join(f'<option value="{k}">{e(v)}</option>' for k, v in SECTOR_LABEL.items())
        region_opts = "".join(f'<option value="{e(r)}">{e(r)}</option>' for r in model.REGIONS)
        countries = sorted({n["country"] for n in self.open if n["source"] == "BM"})
        country_opts = "".join(f'<option value="{e(c)}">{e(c)}</option>' for c in countries)
        cat = s["cat"]
        first = self.open[:30]
        body = f"""
<section class="hero">
<div class="hero-text">
<p class="kicker">Mis à jour le {e(self.updated_text())}</p>
<h1>Appels d'offres publics au Maroc et en Afrique francophone, en cours aujourd'hui</h1>
<p class="lead"><strong>{nb(s['pmmp'])} consultations ouvertes</strong> sur le portail marocain des marchés publics ({nb(cat.get('Travaux', 0))} travaux, {nb(cat.get('Fournitures', 0))} fournitures, {nb(cat.get('Services', 0))} services), plus {nb(s['bm'])} avis en français de projets financés par la Banque mondiale. Chaque avis a sa fiche avec un résumé en français et le lien vers l'avis officiel.</p>
<p class="hero-cta"><a class="btn" href="{link('alertes/')}" data-mesure="cta_click" data-detail="hero">Recevoir les nouveaux avis par e-mail (gratuit pendant le test)</a> <a class="link-more" href="#liste">Parcourir la liste</a></p>
<ul class="hero-facts">
<li><b>{nb(s['new7'])}</b> publiées ces 7 derniers jours</li>
<li><b>{nb(s['close7'])}</b> clôturent dans les 7 jours</li>
{f"<li><b>{nb(s['with_estimate'])}</b> avec une estimation chiffrée</li>" if s['with_estimate'] else ''}
</ul>
</div>
{sample_html}
</section>

<section id="liste" class="list-section" aria-labelledby="liste-h">
<h2 id="liste-h">Consultations en cours</h2>
<form class="filters" id="filtres" role="search" aria-label="Filtrer les appels d'offres">
<label class="f-q">Mots-clés<input type="search" name="q" placeholder="ex. assainissement, logiciel, Agadir" autocomplete="off"></label>
<label>Secteur<select name="secteur"><option value="">Tous les secteurs</option>{sector_opts}</select></label>
<label>Région (Maroc)<select name="region"><option value="">Toutes les régions</option>{region_opts}</select></label>
<label>Ville ou province<input type="text" name="ville" list="villes" placeholder="ex. Tanger-Assilah" autocomplete="off"></label>
<label>Acheteur<input type="text" name="acheteur" list="acheteurs" placeholder="ex. ONEE, commune de…" autocomplete="off"></label>
<label>Clôture<select name="echeance"><option value="">Toutes les dates</option><option value="7">Dans 7 jours ou moins</option><option value="14">Dans 14 jours ou moins</option><option value="30">Dans 30 jours ou moins</option><option value="31+">Dans plus de 30 jours</option></select></label>
<label>Catégorie<select name="categorie"><option value="">Toutes</option><option>Travaux</option><option>Fournitures</option><option>Services</option><option>Services de consultants</option></select></label>
<label>Pays<select name="pays"><option value="">Tous</option><option value="Maroc">Maroc (portail national)</option>{country_opts}</select></label>
<label>Tri<select name="tri"><option value="recent">Les plus récents</option><option value="cloture">Clôture la plus proche</option><option value="montant">Estimation la plus élevée</option></select></label>
<button type="reset" class="btn-ghost">Effacer</button>
</form>
<datalist id="villes"></datalist><datalist id="acheteurs"></datalist>
<p class="count" id="compte" aria-live="polite">{nb(len(self.open))} avis en cours. Les 30 plus récents sont affichés ; les filtres chargent la liste complète.</p>
<div id="resultats">{self.cards(first)}</div>
<p class="more"><button type="button" class="btn-ghost" id="plus" hidden>Afficher 50 avis de plus</button></p>
<noscript><p>Sans JavaScript, parcourez les pages <a href="{link('secteurs/')}">par secteur</a> ou <a href="{link('regions/')}">par région</a>.</p></noscript>
</section>

<section class="explain">
<h2>Ce que fait ce site, et ce qu'il ne fait pas</h2>
<p>Deux fois par jour, un programme relit la liste des « consultations en cours » du <a href="https://www.marchespublics.gov.ma/" rel="noopener">portail marocain des marchés publics</a> et la fiche de chaque nouvelle consultation : objet, acheteur, lieu d'exécution, date limite, estimation et caution provisoire quand l'acheteur les publie. Il ajoute les avis rédigés en français de la Banque mondiale pour {len(s['countries'])} pays et zones d'Afrique francophone.</p>
<p>Il ne télécharge pas les dossiers de consultation (DAO), ne dépose aucune offre et ne remplace pas l'avis officiel : chaque fiche renvoie vers lui. Les contacts nominatifs publiés par les acheteurs ne sont pas recopiés. Le détail est sur la page <a href="{link('methode/')}">Méthode et sources</a>.</p>
</section>
"""
        ld = [{"@context": "https://schema.org", "@type": "WebSite", "name": BRAND, "url": self.base, "inLanguage": "fr",
               "publisher": {"@type": "Organization", "name": SELLER["name"], "email": CONTACT,
                             "address": {"@type": "PostalAddress", "streetAddress": "11 rue Rouvet",
                                         "postalCode": "75019", "addressLocality": "Paris", "addressCountry": "FR"}}},
              {"@context": "https://schema.org", "@type": "Dataset", "name": "Appels d'offres publics en cours au Maroc et en Afrique francophone",
               "description": "Consultations ouvertes du portail marocain des marchés publics et avis en français de la Banque mondiale, normalisés deux fois par jour.",
               "url": self.base, "inLanguage": "fr", "dateModified": self.updated_paris.isoformat(timespec="minutes"),
               "spatialCoverage": "Maroc, Afrique francophone",
               "distribution": [{"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": self.base + "data/ouverts.json"}],
               "creator": {"@type": "Organization", "name": SELLER["name"]}}]
        self.write("", self.page("", f"Appels d'offres Maroc en cours : {nb(s['pmmp'])} consultations | {BRAND}",
                                 f"{nb(s['pmmp'])} appels d'offres publics ouverts au Maroc, mis à jour deux fois par jour, avec filtres par secteur, région, acheteur et date limite, et un résumé en français de chaque avis.",
                                 body, jsonld=ld, scripts=("app.js",)))

    def build_tender(self, n: dict) -> None:
        open_ = model.is_open(n, self.now) and not n.get("delisted")
        rows = [("Acheteur", e(n.get("buyer"))),
                ("Référence", e(n.get("reference"))),
                ("Procédure", e(n.get("procedure")) + (f" ({e(n['method'])})" if n.get("method") else "")),
                ("Catégorie", e(n.get("category"))),
                ("Secteur (notre classement)", ", ".join(f'<a href="{link("secteurs/" + s + "/")}">{e(SECTOR_LABEL.get(s, s))}</a>' for s in n.get("sectors", []))),
                ]
        if n["source"] == "PMMP":
            rows.append(("Lieu d'exécution", e(", ".join(n.get("places", [])) or "Non précisé")))
            if n.get("regions"):
                rows.append(("Région", ", ".join(f'<a href="{link("regions/" + model.slugify(r) + "/")}">{e(r)}</a>' for r in n["regions"])))
        else:
            rows.append(("Pays", e(n.get("country"))))
            if n.get("project"):
                rows.append(("Projet", e(n["project"])))
        rows.append(("Publié le", e(fmt_date(n.get("published", "")))))
        rows.append(("Date limite", f"<strong>{e(fmt_date(n.get('deadline', ''), weekday=True))}</strong> {self.badge(n)}"
                     + (" <span class='small muted'>(heure du Maroc)</span>" if n['source'] == 'PMMP' and 'T' in n.get('deadline', '') else "")))
        if n.get("estimate"):
            rows.append(("Estimation de l'acheteur", e(fmt_mad(n["estimate"]) + " TTC")))
        if n.get("bond"):
            rows.append(("Caution provisoire", e(fmt_mad(n["bond"]))))
        if n.get("reserved") is not None and n["source"] == "PMMP" and "reserved" in n:
            rows.append(("Réservé TPE/PME, coopératives, auto-entrepreneurs", "Oui" if n["reserved"] else "Non"))
        if n.get("domains"):
            rows.append(("Domaines d'activité (portail)", "<br>".join(e(d) for d in n["domains"][:4])))
        table = "".join(f"<tr><th scope='row'>{k}</th><td>{v}</td></tr>" for k, v in rows if v)
        src_name = "marchespublics.gov.ma" if n["source"] == "PMMP" else "projects.worldbank.org"
        source_line = ("Source : Portail marocain des marchés publics (Trésorerie Générale du Royaume), avis publié le "
                       if n["source"] == "PMMP" else
                       "Source : Banque mondiale, avis de passation de marché (licence CC BY 4.0) publié le ")
        similar = [m for m in self.open if m["id"] != n["id"] and set(m.get("sectors", [])) & set(n.get("sectors", []))
                   and (set(m.get("regions", [])) & set(n.get("regions", [])) or m.get("country") == n.get("country") != "Maroc")][:6]
        closed_note = "" if open_ else '<p class="notice">Cette consultation est clôturée ou n\'apparaît plus parmi les consultations en cours du portail. La fiche reste en ligne 30 jours.</p>'
        body = f"""
<article class="tender">
<p class="kicker">{'Maroc' if n['source'] == 'PMMP' else e(n['country'])} · {e(n.get('category') or '')} · {self.badge(n)}</p>
<h1>{e(n['object'])}</h1>
{closed_note}
<section class="summary" aria-labelledby="resume-h">
<h2 id="resume-h">En bref</h2>
<p>{e(model.summary(n, self.today))}</p>
<p class="small muted">Résumé produit automatiquement par des règles fixes à partir des champs de l'avis, sans intelligence artificielle. L'objet ci-dessus est le texte officiel, non modifié.</p>
</section>
<p class="official"><a class="btn" href="{e(n['url'])}" rel="noopener" data-mesure="official_click" data-detail="{n['source'].lower()}">Voir l'avis officiel sur {src_name}</a></p>
<table class="facts-table"><caption>Fiche de la consultation</caption><tbody>{table}</tbody></table>
<p class="small muted">{source_line}{e(fmt_date(n.get('published', '')))}, relu le {e(self.updated_text())}. Le dossier de consultation et les éventuels rectificatifs sont sur le site officiel, qui fait foi.</p>
</article>
<aside class="alert-box">
<p><strong>Ne ratez pas les prochaines consultations de ce type.</strong> Indiquez vos secteurs et régions : nous vous écrirons à l'ouverture des alertes e-mail.</p>
<a class="btn btn-sm" href="{link('alertes/')}?secteur={e((n.get('sectors') or [''])[0])}" data-mesure="cta_click" data-detail="fiche">Créer mon alerte</a>
</aside>
{f'<section><h2>Consultations proches</h2>{self.cards(similar)}</section>' if similar else ''}
"""
        d = model.parse_deadline(n.get("deadline", ""))
        ld = {"@context": "https://schema.org", "@type": "Demand", "name": n["object"][:300],
              "description": model.summary(n, self.today)[:500], "url": self.base + "ao/" + n["slug"] + "/",
              "areaServed": n.get("country"),
              "seller": {"@type": "GovernmentOrganization" if n["source"] == "PMMP" else "Organization", "name": n.get("buyer")},
              "availabilityStarts": n.get("published"), "availabilityEnds": d.isoformat() if d else None,
              "sameAs": n["url"]}
        if n.get("estimate"):
            ld["priceSpecification"] = {"@type": "PriceSpecification", "price": n["estimate"], "priceCurrency": "MAD"}
        ld = {k: v for k, v in ld.items() if v}
        title_obj = n["object"] if len(n["object"]) <= 70 else n["object"][:67].rsplit(" ", 1)[0] + "…"
        where = self.where(n)
        desc = (f"Appel d'offres {('Maroc, ' + where) if n['source'] == 'PMMP' else where} : {n['object'][:120]}. "
                f"Clôture le {fmt_short(n['deadline'])}. Acheteur : {n.get('buyer', '')[:60]}.")
        crumbs = [("", "Appels d'offres")]
        if n.get("sectors"):
            crumbs.append((f"secteurs/{n['sectors'][0]}/", SECTOR_LABEL.get(n["sectors"][0], "Secteur")))
        crumbs.append((f"ao/{n['slug']}/", title_obj))
        self.write(f"ao/{n['slug']}/", self.page(f"ao/{n['slug']}/", f"{title_obj} | AO {where}", desc, body,
                                                  jsonld=ld, crumbs=crumbs),
                   lastmod=n.get("first_seen") or n.get("published"))

    def build_group_pages(self) -> None:
        # sectors
        by_sector: dict[str, list[dict]] = {}
        for n in self.open:
            for s in n.get("sectors", []):
                by_sector.setdefault(s, []).append(n)
        items = []
        for slug, label in SECTOR_LABEL.items():
            lst = sorted(by_sector.get(slug, []), key=lambda n: n.get("deadline", ""))
            ma = [n for n in lst if n["source"] == "PMMP"]
            items.append(f'<li><a href="{link("secteurs/" + slug + "/")}">{e(label)}</a> <span class="muted">{nb(len(lst))} avis</span></li>')
            regions = Counter(r for n in ma for r in n.get("regions", [])).most_common(4)
            reg_txt = ", ".join(f"{r} ({c})" for r, c in regions)
            body = f"""<h1>Appels d'offres {e(label.lower())} : {nb(len(lst))} consultations ouvertes</h1>
<p class="lead">{nb(len(ma))} au Maroc{f', surtout en {e(reg_txt)}' if reg_txt else ''}, et {nb(len(lst) - len(ma))} avis Banque mondiale en Afrique francophone. Liste triée par date limite, mise à jour le {e(self.updated_text())}.</p>
<p><a class="btn btn-sm" href="{link('alertes/')}?secteur={slug}" data-mesure="cta_click" data-detail="secteur">Recevoir ce secteur par e-mail</a> <a class="link-more" href="{link('')}?secteur={slug}#liste">Filtrer davantage</a></p>
<p class="small muted">Classement par mots-clés sur l'objet et les domaines d'activité déclarés par l'acheteur : un avis peut relever de deux secteurs, et quelques-uns sont mal classés.</p>
{self.cards(lst[:150], 'h2')}
{f'<p>Et {nb(len(lst) - 150)} autres : <a href="{link("")}?secteur={slug}#liste">voir la liste complète filtrée</a>.</p>' if len(lst) > 150 else ''}"""
            self.write(f"secteurs/{slug}/", self.page(f"secteurs/{slug}/", f"Appels d'offres {label} au Maroc ({nb(len(lst))} ouverts) | {BRAND}",
                                                      f"{nb(len(lst))} appels d'offres {label.lower()} ouverts au Maroc et en Afrique francophone, triés par date limite, avec résumé et lien officiel.",
                                                      body, crumbs=[("", "Appels d'offres"), ("secteurs/", "Secteurs"), (f"secteurs/{slug}/", label)]))
        self.write("secteurs/", self.page("secteurs/", f"Appels d'offres par secteur | {BRAND}",
                                          "Appels d'offres publics ouverts au Maroc classés en 13 secteurs : BTP, eau, énergie, informatique, études, santé…",
                                          f"<h1>Appels d'offres par secteur</h1><ul class='index-list'>{''.join(items)}</ul>",
                                          crumbs=[("", "Appels d'offres"), ("secteurs/", "Secteurs")]))
        # regions
        items = []
        for region in model.REGIONS:
            slug = model.slugify(region)
            lst = sorted([n for n in self.open if region in n.get("regions", [])], key=lambda n: n.get("deadline", ""))
            items.append(f'<li><a href="{link("regions/" + slug + "/")}">{e(region)}</a> <span class="muted">{nb(len(lst))} avis</span></li>')
            places = Counter(place_label(p) for n in lst for p in n.get("places", [])).most_common(6)
            sect = Counter(s for n in lst for s in n.get("sectors", [])).most_common(3)
            body = f"""<h1>Appels d'offres dans la région {e(region)} : {nb(len(lst))} consultations ouvertes</h1>
<p class="lead">Lieux d'exécution les plus fréquents : {e(', '.join(f'{p} ({c})' for p, c in places)) or 'aucun'}. Secteurs principaux : {e(', '.join(f'{SECTOR_LABEL.get(s, s).lower()} ({c})' for s, c in sect)) or 'aucun'}. Mise à jour le {e(self.updated_text())}.</p>
<p><a class="btn btn-sm" href="{link('alertes/')}?region={e(region)}" data-mesure="cta_click" data-detail="region">Recevoir cette région par e-mail</a></p>
{self.cards(lst[:150], 'h2')}
{f'<p>Et {nb(len(lst) - 150)} autres : <a href="{link("")}?region={e(region)}#liste">voir la liste complète filtrée</a>.</p>' if len(lst) > 150 else ''}"""
            self.write(f"regions/{slug}/", self.page(f"regions/{slug}/", f"Appels d'offres {region} ({nb(len(lst))} ouverts) | {BRAND}",
                                                     f"{nb(len(lst))} appels d'offres publics ouverts dans la région {region} (Maroc), triés par date limite, avec résumé et lien officiel.",
                                                     body, crumbs=[("", "Appels d'offres"), ("regions/", "Régions"), (f"regions/{slug}/", region)]))
        unplaced = sum(1 for n in self.open if n["source"] == "PMMP" and not n.get("regions"))
        self.write("regions/", self.page("regions/", f"Appels d'offres par région du Maroc | {BRAND}",
                                         "Appels d'offres publics ouverts dans les 12 régions du Maroc, d'après le lieu d'exécution déclaré par l'acheteur.",
                                         f"<h1>Appels d'offres par région du Maroc</h1><p>Région déduite du lieu d'exécution saisi par l'acheteur. {nb(unplaced)} consultations n'ont pas de lieu reconnu (national, plusieurs provinces ou saisie libre) : elles restent dans la <a href='{link('')}#liste'>liste générale</a>.</p><ul class='index-list'>{''.join(items)}</ul>",
                                         crumbs=[("", "Appels d'offres"), ("regions/", "Régions")]))
        # francophone Africa (World Bank)
        bm = sorted([n for n in self.open if n["source"] == "BM"], key=lambda n: n.get("deadline", ""))
        by_c = Counter(n["country"] for n in bm)
        blocks = []
        for c, cnt in sorted(by_c.items(), key=lambda x: -x[1]):
            lst = [n for n in bm if n["country"] == c]
            blocks.append(f"<section><h2>{e(c)} <span class='muted'>({cnt})</span></h2>{self.cards(lst, 'h3')}</section>")
        body = f"""<h1>Appels d'offres Banque mondiale en Afrique francophone : {nb(len(bm))} avis ouverts</h1>
<p class="lead">Avis rédigés en français (appels d'offres, appels à manifestation d'intérêt, avis spécifiques) de projets financés par la Banque mondiale dans {len(by_c)} pays et zones. Les portails nationaux de ces pays ne sont pas encore couverts : nous n'y avons pas trouvé d'accès automatisé dont les conditions sont claires.</p>
{''.join(blocks) or '<p>Aucun avis ouvert pour le moment.</p>'}"""
        self.write("afrique-francophone/", self.page("afrique-francophone/", f"Appels d'offres Banque mondiale Afrique francophone ({nb(len(bm))}) | {BRAND}",
                                                     "Avis de marchés en français des projets Banque mondiale au Sénégal, en Côte d'Ivoire, au Cameroun, à Madagascar, au Niger, en RD Congo et ailleurs, avec date limite et lien officiel.",
                                                     body, crumbs=[("", "Appels d'offres"), ("afrique-francophone/", "Afrique francophone")]))

    def build_alerts(self) -> None:
        sector_boxes = "".join(f'<label class="chk"><input type="checkbox" name="sectors" value="{k}"> {e(v)}</label>'
                               for k, v in SECTOR_LABEL.items() if k != "autre")
        region_boxes = "".join(f'<label class="chk"><input type="checkbox" name="regions" value="{e(model.slugify(r))}"> {e(r)}</label>'
                               for r in model.REGIONS)
        plans = "".join(f"""<div class="plan">
<p class="plan-name">{e(name)} <span class="soon">bientôt disponible</span></p>
<p class="price"><b>{price}&nbsp;€</b> pour 3 mois</p>
<p>{e(text)}</p>
<button type="button" class="btn-ghost preinscr" data-plan="{pid}" data-mesure="preinscription_click" data-detail="{pid}">Pré-inscription, sans paiement</button>
</div>""" for pid, name, price, text in PLANS)
        s = self.stats()
        body = f"""<h1>Alertes e-mail : les nouveaux appels d'offres marocains de vos secteurs, chaque matin</h1>
<p class="lead">Le portail marocain publie en moyenne {nb(round(s['new7'] / 7))} nouvelles consultations par jour (moyenne des 7 derniers jours). L'alerte vous envoie seulement celles de vos secteurs et régions, avec le résumé et la date limite de chacune.</p>
<div class="status-box">
<p><strong>Où en est le service.</strong> La liste et les fiches de ce site sont en ligne et à jour. Les envois d'e-mails ne sont pas encore ouverts. Inscrivez-vous maintenant : vous recevrez un premier message à l'ouverture, puis les alertes, gratuites pendant les 21 jours du test. Désinscription en un clic à tout moment.</p>
</div>

<form id="alerte-form" class="alert-form" novalidate>
<input type="hidden" name="kind" value="alertes">
<input type="hidden" name="plan" value="">
<div class="hp" aria-hidden="true"><label>Site web <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<fieldset><legend>Vos secteurs</legend><div class="chk-grid">{sector_boxes}</div></fieldset>
<fieldset><legend>Vos régions au Maroc <button type="button" class="link-btn" id="toutes-regions">tout cocher</button></legend><div class="chk-grid">{region_boxes}</div></fieldset>
<fieldset><legend>Autres pays (avis Banque mondiale)</legend><label class="chk"><input type="checkbox" name="countries" value="afrique-francophone"> Ajouter les avis en français des pays d'Afrique francophone</label></fieldset>
<div class="row">
<label>Adresse e-mail professionnelle<input type="email" name="email" required autocomplete="email" maxlength="254"></label>
<label>Entreprise <span class="muted">(facultatif)</span><input type="text" name="company" maxlength="120" autocomplete="organization"></label>
<label>Votre entreprise est établie en<select name="company_country"><option value="">Choisir</option><option value="france">France</option><option value="maroc">Maroc</option><option value="autre-afrique">Autre pays d'Afrique</option><option value="autre-europe">Autre pays d'Europe</option><option value="autre">Autre</option></select></label>
<label>Fréquence<select name="frequency"><option value="quotidien">Chaque matin</option><option value="hebdomadaire">Une fois par semaine</option></select></label>
</div>
<label class="chk consent"><input type="checkbox" name="consent" required> <span id="consent-text">{e(CONSENT_TEXT)}</span></label>
<p class="small muted">Données traitées par READ FRANCE SAS (Paris) selon le RGPD ; si vous résidez au Maroc, vous disposez aussi des droits prévus par la loi n° 09-08. Elles sont conservées dans un tableur Google et ne sont ni vendues ni prêtées. Détails : <a href="{link('confidentialite/')}">confidentialité</a>.</p>
<p class="plan-chosen" id="plan-chosen" hidden></p>
<button type="submit" class="btn">M'inscrire aux alertes</button>
<p class="form-msg" id="form-msg" role="status" aria-live="polite"></p>
</form>

<section class="plans-section" aria-labelledby="offres-h">
<h2 id="offres-h">Offres payantes prévues</h2>
<p>Nous testons deux prix avant d'ouvrir le paiement. Aucun paiement n'est demandé aujourd'hui : la pré-inscription enregistre votre intérêt, et nous vous écrirons à l'ouverture pour que vous décidiez. Paiement unique pour 3 mois, sans renouvellement automatique. Prix nets, TVA non applicable (art. 293 B du CGI).</p>
<div class="plans">{plans}</div>
<p class="small muted">Ce qui ne sera pas inclus : la rédaction des offres, le téléchargement des dossiers de consultation à votre place, le dépôt électronique sur le portail (il demande un compte entreprise et une signature électronique à votre nom).</p>
</section>

<section>
<h2>À quoi ressemblera l'e-mail</h2>
<p>Objet : « 14 nouveaux appels d'offres : eau et assainissement, Souss-Massa ». Pour chaque avis : l'objet officiel, l'acheteur, le lieu, l'estimation et la caution quand elles sont publiées, la date limite, le résumé de quatre lignes que vous voyez sur chaque <a href="{link('')}#liste">fiche du site</a>, et le lien vers l'avis officiel.</p>
</section>
"""
        self.write("alertes/", self.page("alertes/", f"Alertes e-mail appels d'offres Maroc | {BRAND}",
                                         "Recevez chaque matin les nouveaux appels d'offres publics marocains de vos secteurs et régions, résumés en français. Gratuit pendant le test.",
                                         body, scripts=("alertes.js",), crumbs=[("", "Appels d'offres"), ("alertes/", "Alertes e-mail")]))

    def build_static_pages(self) -> None:
        st = self.meta.get("sources", {})
        pm, bm = st.get("PMMP", {}), st.get("BM", {})
        method = f"""<h1>Méthode et sources</h1>
<p class="lead">Ce site relit deux fois par jour, vers 7 h et 19 h (heure de Paris), deux sources publiques. Il n'utilise aucun modèle de langage : les résumés sont assemblés par des règles fixes à partir des champs de chaque avis.</p>
<h2>Portail marocain des marchés publics</h2>
<p>Le <a href="https://www.marchespublics.gov.ma/" rel="noopener">portail marocain des marchés publics</a> est géré par la Trésorerie Générale du Royaume. À chaque passage, nous lisons les « consultations en cours » mises en ligne dans les 4 derniers jours (une ou deux pages de 500 lignes) ; le dimanche matin, nous relisons la liste complète (neuf pages) pour retirer les consultations annulées et corriger les dates reportées. La fiche de chaque nouvelle consultation est lue une seule fois. Les requêtes partent une par une, avec au moins 3 secondes d'écart. Nos requêtes portent un identifiant qui donne l'adresse {CONTACT}. Nous ne téléchargeons pas les dossiers de consultation et ne créons pas de compte.</p>
<p>Le portail ne publie pas de fichier robots.txt ni de conditions d'utilisation (le lien « Mentions légales » de son pied de page ne mène nulle part, vérifié le 13 octobre 2026). Nous nous appuyons sur l'article 6 de la <a href="https://www.cdai.ma/fr/cadre-juridique-national/" rel="noopener">loi n° 31-13 relative au droit d'accès à l'information</a>, qui autorise la réutilisation des informations publiées par les administrations à des fins légitimes, sans altération, en indiquant la source et la date. Chaque fiche affiche donc l'objet officiel tel quel, la source et la date de publication. Les noms, e-mails et téléphones des agents qui figurent sur les fiches du portail ne sont pas repris.</p>
<p>Dernière lecture réussie : {e(pm.get('at', 'inconnue'))} (UTC), {nb(pm.get('open', 0))} consultations listées.</p>
<h2>Banque mondiale</h2>
<p>Les avis de passation de marché de la Banque mondiale viennent de son <a href="https://search.worldbank.org/api/v2/procnotices?format=json&amp;rows=1" rel="noopener">API publique</a>, jeu de données « <a href="https://datacatalog.worldbank.org/search/dataset/0037776/procurement-notice" rel="noopener">Procurement Notice</a> », sous licence Creative Commons Attribution 4.0. Nous gardons les avis rédigés en français, de type appel d'offres, appel à manifestation d'intérêt ou avis spécifique, dont la date limite n'est pas passée, pour les pays d'Afrique francophone. Dernière lecture réussie : {e(bm.get('at', 'inconnue'))} (UTC).</p>
<h2>Classements ajoutés par nous</h2>
<p>Le secteur est attribué par mots-clés sur l'objet et les domaines d'activité déclarés, parmi 13 secteurs. Un avis peut en avoir deux, et les objets très courts sont parfois mal classés.</p>
<p>La région vient du lieu d'exécution saisi par l'acheteur, rapproché de la liste des provinces et préfectures des 12 régions. Les lieux « tout le Royaume » ou mal orthographiés restent sans région.</p>
<p>Le résumé met en phrases la procédure, l'acheteur, le lieu, l'estimation, la caution et la date limite avec le nombre de jours restants. Il ne lit pas le dossier de consultation.</p>
<h2>Limites</h2>
<p>Le site peut avoir jusqu'à 12 heures de retard sur le portail pour les nouvelles consultations, et jusqu'à une semaine pour une annulation ou un report de date : vérifiez toujours l'avis officiel avant de préparer une offre. Les portails nationaux du Sénégal, de la Côte d'Ivoire et des autres pays ne sont pas encore couverts.</p>
<p>Code source : <a href="{REPO_URL}">{REPO_URL}</a>. Données brutes du jour : <a href="{link('data/ouverts.json')}">ouverts.json</a>.</p>"""
        self.write("methode/", self.page("methode/", f"Méthode et sources | {BRAND}",
                                         "D'où viennent les appels d'offres de Veille AO Afrique, à quelle fréquence ils sont relus, sur quelle base légale et avec quelles limites.",
                                         method, crumbs=[("", "Appels d'offres"), ("methode/", "Méthode")]))
        p = SELLER
        legal = f"""<h1>Mentions légales</h1>
<h2>Éditeur</h2>
<p>{p['name']}, {p['form']} au capital de {p['capital']}, {p['rcs']}, siège : {p['address']}. Contact : <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
<p>Directeur de la publication : {p['president']}, président.</p>
<p>Le site est écrit et tenu à jour par Octave, l'assistant IA de READ FRANCE, sous la responsabilité éditoriale du directeur de la publication. Les fiches d'appels d'offres sont produites automatiquement à partir des sources décrites sur la page <a href="{link('methode/')}">Méthode et sources</a>.</p>
<h2>Hébergement</h2>
<p>GitHub Inc. (GitHub Pages), 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis. Formulaire et mesure d'audience : Google Apps Script et Google Sheets (Google LLC).</p>
<h2>Sources et propriété</h2>
<p>Les avis proviennent du Portail marocain des marchés publics (Trésorerie Générale du Royaume, réutilisation selon l'article 6 de la loi n° 31-13) et de la Banque mondiale (CC BY 4.0). Veille AO Afrique n'est ni affilié à ces organismes ni approuvé par eux. L'avis officiel fait foi. Le code du site est publié sous licence MIT.</p>"""
        self.write("mentions-legales/", self.page("mentions-legales/", f"Mentions légales | {BRAND}",
                                                  "Éditeur, hébergeur et sources de Veille AO Afrique.", legal,
                                                  crumbs=[("", "Appels d'offres"), ("mentions-legales/", "Mentions légales")]))
        privacy = f"""<h1>Confidentialité</h1>
<p class="lead">Responsable du traitement : {p['name']}, {p['address']}, <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
<h2>Mesure d'audience sans cookie</h2>
<p>Chaque page envoie un compteur anonyme : la page vue, le type d'action (filtre utilisé, clic vers l'avis officiel, inscription), le site d'où vous venez, et si l'écran est un mobile ou un ordinateur. Aucun cookie, aucun identifiant, aucune adresse IP n'est enregistré : nous ne gardons que des totaux par jour dans un tableur Google. Si votre navigateur envoie le signal « Do Not Track » ou « Global Privacy Control », rien n'est envoyé. Les robots d'indexation et les navigateurs automatisés (reconnus dans votre navigateur, sans que leur signature soit transmise) sont comptés à part, et une page préchargée n'est comptée que si vous l'ouvrez. Ce dispositif relève de l'exemption de consentement prévue pour la mesure d'audience strictement anonyme.</p>
<h2>Formulaire « Alertes e-mail » et pré-inscription</h2>
<p>Nous enregistrons votre adresse e-mail et, si vous les indiquez, le nom de l'entreprise, son pays d'établissement, les secteurs et régions choisis, la fréquence souhaitée et l'offre pré-réservée. Nous gardons aussi la date et le texte exact du consentement que vous avez coché.</p>
<p>Ces données servent à vous prévenir de l'ouverture du service, à vous envoyer les alertes demandées et à compter les pré-inscriptions pour choisir le prix. La base légale est votre consentement (article 6.1.a du RGPD), que vous pouvez retirer à tout moment par e-mail ou par le lien présent dans chaque message.</p>
<p>Seule READ FRANCE y a accès. Elles sont stockées dans Google Sheets : Google LLC agit comme sous-traitant, et le transfert vers les États-Unis est encadré par le Data Privacy Framework et les clauses contractuelles types de Google. Elles ne sont ni vendues ni prêtées.</p>
<p>Nous les conservons jusqu'au retrait de votre accord, et au plus 12 mois après notre dernier e-mail si le service n'ouvre pas.</p>
<h2>Vos droits</h2>
<p>Accès, rectification, effacement, limitation, opposition et portabilité : écrivez à <a href="mailto:{CONTACT}">{CONTACT}</a>, réponse sous un mois. Vous pouvez saisir la <a href="https://www.cnil.fr/fr/plaintes" rel="noopener">CNIL</a>. Si vous résidez au Maroc, la loi n° 09-08 vous donne des droits comparables (accès, rectification, opposition) ; nous les appliquons de la même manière, et l'autorité marocaine compétente est la <a href="https://www.cndp.ma/" rel="noopener">CNDP</a>.</p>
<h2>Hébergement</h2>
<p>GitHub Pages traite des journaux techniques (adresse IP notamment) pour servir le site, selon la <a href="https://docs.github.com/fr/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener">déclaration de confidentialité de GitHub</a>.</p>
<p class="small muted">Version du 13 octobre 2026.</p>"""
        self.write("confidentialite/", self.page("confidentialite/", f"Confidentialité | {BRAND}",
                                                 "Données collectées par Veille AO Afrique : mesure d'audience sans cookie, formulaire d'alertes, droits RGPD et loi 09-08.",
                                                 privacy, crumbs=[("", "Appels d'offres"), ("confidentialite/", "Confidentialité")]))
        nf = f"""<h1>Page introuvable</h1><p>Cet appel d'offres a peut-être été clôturé et retiré. <a href="{link('')}">Retour à la liste des consultations en cours</a>.</p>"""
        (self.out / "404.html").write_text(self.page("404.html", f"Page introuvable | {BRAND}", "Page introuvable.", nf, noindex=True), encoding="utf-8")

    # ------------------------------------------------------------------ data, feeds, sitemap
    def build_data(self) -> None:
        rows = []
        for n in self.open:
            rows.append({"i": n["slug"], "o": n["object"], "b": n.get("buyer", ""), "c": n.get("category", ""),
                         "s": n.get("sectors", []), "r": n.get("regions", []),
                         "p": [place_label(p) for p in n.get("places", [])][:4], "d": n.get("deadline", ""),
                         "u": n.get("published", ""), "e": n.get("estimate") or 0, "k": n.get("country", ""),
                         "x": n["source"]})
        d = self.out / "data"
        d.mkdir(parents=True, exist_ok=True)
        payload = {"updated": self.updated_paris.isoformat(timespec="minutes"), "today": self.today.isoformat(),
                   "count": len(rows), "sectors": SECTOR_LABEL, "notices": rows}
        (d / "ouverts.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    def build_feed(self) -> None:
        items = sorted(self.open, key=lambda n: (n.get("first_seen", ""), n.get("published", "")), reverse=True)[:100]
        ents = []
        for n in items:
            url = self.base + "ao/" + n["slug"] + "/"
            ents.append(f"""<entry><title>{e(n['object'][:200])}</title><link href="{e(url)}"/><id>{e(url)}</id>
<updated>{e((n.get('first_seen') or n.get('published') or self.today.isoformat()))}T06:00:00Z</updated>
<summary>{e(model.summary(n, self.today))}</summary></entry>""")
        feed = f"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>{BRAND} : nouveaux appels d'offres</title>
<link href="{e(self.base)}"/><link rel="self" href="{e(self.base)}feed.xml"/><id>{e(self.base)}</id>
<updated>{self.updated_paris.isoformat(timespec='seconds')}</updated><author><name>{SELLER['name']}</name></author>
{''.join(ents)}</feed>
"""
        (self.out / "feed.xml").write_text(feed, encoding="utf-8")

    def build_sitemap(self) -> None:
        urls = "".join(f"<url><loc>{e(self.base + p)}</loc><lastmod>{e(m)}</lastmod></url>" for p, m in self.pages)
        (self.out / "sitemap.xml").write_text(
            f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n',
            encoding="utf-8")
        (self.out / f"{INDEXNOW_KEY}.txt").write_text(INDEXNOW_KEY, encoding="utf-8")
        if GOOGLE_VERIFICATION_FILE:
            (self.out / GOOGLE_VERIFICATION_FILE).write_text(f"google-site-verification: {GOOGLE_VERIFICATION_FILE}",
                                                             encoding="utf-8")

    def build_all(self) -> None:
        if self.out.exists():
            shutil.rmtree(self.out)
        self.out.mkdir(parents=True)
        shutil.copytree(STATIC, self.out / "static")
        self.build_index()
        for n in self.all:
            self.build_tender(n)
        self.build_group_pages()
        self.build_alerts()
        self.build_static_pages()
        self.build_data()
        self.build_feed()
        self.build_sitemap()
        (self.out / ".nojekyll").write_text("", encoding="utf-8")


def build(out: Path, notices: list[dict], meta: dict, base_url: str) -> None:
    Site(out, notices, meta, base_url).build_all()
