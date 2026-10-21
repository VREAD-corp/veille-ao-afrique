"""Normalised notice, sector classification, Moroccan regions, and the rule-based French summary."""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime

from . import pmmp

# ------------------------------------------------------------------------------------------ regions (Maroc)
# The 12 regions of the 2015 administrative division, with their provinces and prefectures, written as the
# portal writes "lieu d'exécution" (upper case, no accents). Matching is done on accent-free upper case.
REGIONS: dict[str, list[str]] = {
    "Tanger-Tétouan-Al Hoceïma": ["TANGER", "ASSILAH", "MDIQ", "FNIDEQ", "TETOUAN", "FAHS", "ANJRA", "LARACHE",
                                  "AL HOCEIMA", "HOCEIMA", "CHEFCHAOUEN", "OUEZZANE", "KSAR EL KEBIR"],
    "L'Oriental": ["OUJDA", "ANGAD", "NADOR", "DRIOUCH", "JERADA", "BERKANE", "TAOURIRT", "GUERCIF", "FIGUIG",
                   "BOUARFA"],
    "Fès-Meknès": ["FES", "MEKNES", "EL HAJEB", "IFRANE", "MOULAY YACOUB", "SEFROU", "BOULEMANE", "TAOUNATE", "TANOUNATE", "ELHAJEB",
                   "TAZA"],
    "Rabat-Salé-Kénitra": ["RABAT", "SALE", "SKHIRATE", "TEMARA", "KENITRA", "KHEMISSET", "SIDI KACEM",
                           "SIDI SLIMANE", "KHEMISSAT"],
    "Béni Mellal-Khénifra": ["BENI MELLAL", "AZILAL", "FQUIH BEN SALAH", "FKIH BEN SALAH", "KHENIFRA", "KHOURIBGA"],
    "Casablanca-Settat": ["CASABLANCA", "MOHAMMEDIA", "EL JADIDA", "NOUACEUR", "MEDIOUNA", "BENSLIMANE",
                          "BEN SLIMANE", "BERRECHID", "SETTAT", "SIDI BENNOUR", "ANFA", "AIN SEBAA", "AIN CHOCK",
                          "HAY HASSANI", "BEN MSIK", "MOHAMMADIA", "ELFIDA", "DERB SOLTANE", "SIDI BERNOUSSI", "MOULAY RACHID", "AL FIDA", "MERS SULTAN"],
    "Marrakech-Safi": ["MARRAKECH", "CHICHAOUA", "AL HAOUZ", "HAOUZ", "KELAA DES SRAGHNA", "KELAA", "SRAGHNA",
                       "ESSAOUIRA", "REHAMNA", "SAFI", "YOUSSOUFIA", "SIDI YOUSSEF BEN ALI", "MENARA", "GUELIZ"],
    "Drâa-Tafilalet": ["ERRACHIDIA", "OUARZAZATE", "MIDELT", "TINGHIR", "ZAGORA"],
    "Souss-Massa": ["AGADIR", "IDA OUTANANE", "IDA OU TANANE", "INEZGANE", "AIT MELLOUL", "CHTOUKA", "AIT BAHA",
                    "TAROUDANT", "TAROUDANNT", "TIZNIT", "TATA"],
    "Guelmim-Oued Noun": ["GUELMIM", "ASSA", "ZAG", "TAN TAN", "TANTAN", "SIDI IFNI"],
    "Laâyoune-Sakia El Hamra": ["LAAYOUNE", "BOUJDOUR", "TARFAYA", "SMARA", "ES SEMARA", "SEMARA"],
    "Dakhla-Oued Ed-Dahab": ["DAKHLA", "OUED ED DAHAB", "OUED EDDAHAB", "AOUSSERD"],
}
NATIONAL_WORDS = ("TOUT LE ROYAUME", "ROYAUME", "NATIONAL", "TOUTES LES REGIONS", "ENSEMBLE DU TERRITOIRE")


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]+", " ", s.upper()).strip()


_REGION_KEYS = sorted(((fold(k), r) for r, ks in REGIONS.items() for k in ks), key=lambda x: -len(x[0]))


def regions_of(places: list[str]) -> list[str]:
    found: list[str] = []
    for p in places:
        f = f" {fold(p)} "
        if any(w in f for w in NATIONAL_WORDS):
            continue
        for key, region in _REGION_KEYS:
            if f" {key} " in f and region not in found:
                found.append(region)
                break
    return found


def place_label(p: str) -> str:
    """'TANGER-ASSILAH' -> 'Tanger-Assilah' (display only; the official text is kept in the data)."""
    small = {"de", "des", "du", "la", "le", "les", "et", "d", "l"}
    words = re.split(r"(\s+|-|')", p.strip().lower())
    out = []
    for i, w in enumerate(words):
        out.append(w if (w in small and i) else w[:1].upper() + w[1:])
    return "".join(out)


# ------------------------------------------------------------------------------------------ sectors
SECTORS: list[tuple[str, str, str]] = [
    # slug, label, pattern (on accent-free upper case object + activity domains)
    ("eau-assainissement", "Eau, assainissement et irrigation",
     r"\bEAU\b|\bAEP\b|ASSAINISSEMENT|IRRIGATION|HYDRAUL|FORAGE|BARRAGE|EPURATION|\bSTEP\b|ADDUCTION|"
     r"POTABLE|PLUVIAL|CHATEAU D EAU|CANALISATION|PUITS|SEGUIA|HYDRO AGRICOLE|HYDROAGRICOLE"),
    ("energie", "Énergie et électricité",
     r"ELECTRIFICATION|ELECTRIQUE|ELECTRICITE|ECLAIRAGE|PHOTOVOLTA|SOLAIRE|ENERGIE|GROUPE ELECTROGENE|"
     r"TRANSFORMATEUR|POSTE SOURCE|HAUTE TENSION|MOYENNE TENSION|BASSE TENSION|LUMINAIRE"),
    ("informatique-telecoms", "Informatique et télécoms",
     r"INFORMATIQUE|LOGICIEL|SERVEUR|ORDINATEUR|TELEPHONI|SYSTEME D INFORMATION|LICENCE|CYBER|NUMERIQUE|"
     r"DIGITAL|SITE WEB|PORTAIL|APPLICATION|RESEAU INFORMATIQUE|DATACENTER|CABLAGE|FIBRE OPTIQUE|"
     r"VIDEOSURVEILLANCE|VIDEO SURVEILLANCE|IMPRIMANTE|SCANNER|TELECOM|WIFI|SAUVEGARDE|MESSAGERIE"),
    ("etudes-conseil", "Études, conseil et ingénierie",
     r"\bETUDES?\b|ASSISTANCE TECHNIQUE|CONSEIL|AUDIT|CONTROLE TECHNIQUE|MAITRISE D OEUVRE|EXPERTISE|"
     r"TOPOGRAPH|GEOTECHN|DIAGNOSTIC|ACCOMPAGNEMENT|EVALUATION|STRATEGI|SCHEMA DIRECTEUR|SUIVI ET CONTROLE|"
     r"CONSULTANT|ENQUETE|RECENSEMENT|ARCHITECTE|BUREAU D ETUDES?|LABORATOIRE D ESSAIS|ASSISTANCE A MAITRISE"),
    ("btp", "BTP et aménagement",
     r"TRAVAUX|CONSTRUCTION|AMENAGEMENT|REHABILITATION|ROUTE|ROUTIER|PISTE|VOIRIE|BATIMENT|GENIE CIVIL|"
     r"OUVRAGE|\bPONT\b|CHAUSSEE|REVETEMENT|GROS OEUVRE|ETANCHEITE|MENUISERIE|PEINTURE|MACONNERIE|"
     r"EXTENSION|MISE A NIVEAU|RENFORCEMENT|CLOTURE|TROTTOIR|BITUM|ENROBE|TERRASSEMENT|PAVAGE"),
    ("sante", "Santé et matériel médical",
     r"MEDIC|MEDICAMENT|HOSPITAL|HOPITAL|SANTE|REACTIF|DISPOSITIF|CHIRURG|PHARMAC|LABORATOIRE D ANALYSE|"
     r"DENTAIRE|RADIOLOG|OXYGENE|VACCIN|SOINS|CHU\b|CENTRE DE SANTE|DIALYSE|ANESTHES"),
    ("agriculture", "Agriculture, forêt et pêche",
     r"AGRICOL|PLANTATION|SEMENCE|ENGRAIS|FORET|FORESTIER|REBOISEMENT|ELEVAGE|CHEPTEL|BETAIL|PECHE|OLIVIER|"
     r"ARBORICULT|PEPINIERE|FOURRAGE|VETERINAIRE|PALMIER|ARGANIER|PHYTOSANITAIRE|APICULT|ORGE|ALIMENT DE BETAIL"),
    ("services-generaux", "Nettoyage, gardiennage et entretien",
     r"NETTOYAGE|GARDIENNAGE|SURVEILLANCE|JARDINAGE|ESPACES VERTS|HYGIENE|DESINSECTISATION|DERATISATION|"
     r"ENTRETIEN|MAINTENANCE|REPARATION|BLANCHISSERIE|COLLECTE DES DECHETS|DECHETS"),
    ("vehicules-transport", "Véhicules, engins et transport",
     r"VEHICULE|TRANSPORT|CARBURANT|PNEUMATIQUE|ENGINS?\b|CAMION|AMBULANCE|AUTOBUS|BUS\b|PIECES DE RECHANGE|"
     r"LUBRIFIANT|LOCATION DE VOITURE|MOTO|TRACTEUR|GASOIL|ESSENCE"),
    ("alimentation", "Alimentation et restauration",
     r"ALIMENTAIRE|ALIMENTATION|DENREES|RESTAURATION|REPAS|VIANDE|\bPAIN\b|\bLAIT\b|LEGUMES|FRUITS|"
     r"PRODUITS ALIMENTAIRES|CANTINE|INTERNAT|RESTAURANT|BOULANGERIE|EPICERIE|VOLAILLE|POISSON"),
    ("formation-evenementiel", "Formation, communication et événements",
     r"FORMATION|SEMINAIRE|EVENEMENT|ORGANISATION D|COMMUNICATION|IMPRESSION|IMPRIME|EDITION|PUBLICITE|"
     r"REPROGRAPHIE|TRADUCTION|AUDIOVISUEL|SPOT|SIGNALETIQUE|COLLOQUE|FESTIVAL|EXPOSITION|SENSIBILISATION"),
    ("fournitures-mobilier", "Mobilier et fournitures",
     r"MOBILIER|FOURNITURES? DE BUREAU|PAPETERIE|FOURNITURE|MATERIEL|EQUIPEMENT|ACQUISITION|ACHAT|"
     r"LITERIE|HABILLEMENT|TENUE|UNIFORME|CONSOMMABLE|ARTICLES?"),
]
SECTOR_LABEL = {s: l for s, l, _ in SECTORS}
SECTOR_LABEL["autre"] = "Autres"
_SECTOR_RE = [(s, re.compile(p)) for s, _, p in SECTORS]


def sectors_of(text: str, category: str = "") -> list[str]:
    f = fold(text)
    hits = [s for s, rx in _SECTOR_RE if rx.search(f)]
    # Generic words (FOURNITURE, MATERIEL, TRAVAUX…) only count when nothing more specific matched.
    specific = [s for s in hits if s not in ("fournitures-mobilier", "btp", "services-generaux")]
    if specific:
        hits = specific + [s for s in hits if s in ("btp",) and category == "Travaux"]
    if not hits:
        hits = ["btp"] if category == "Travaux" else ["autre"]
    return hits[:2]


# ------------------------------------------------------------------------------------------ notices
def slugify(text: str, words: int = 9) -> str:
    f = fold(text).lower().split()
    stop = {"de", "des", "du", "la", "le", "les", "et", "a", "au", "aux", "d", "l", "en", "pour", "un", "une",
            "sur", "par", "dans", "lot", "unique"}
    kept = [w for w in f if w not in stop][:words]
    return "-".join(kept)[:80].strip("-") or "avis"


def from_pmmp(row: dict, detail: dict | None) -> dict:
    detail = detail or {}
    places = row.get("places") or []
    text = row.get("object", "") + " " + " ".join(detail.get("domains", []))
    n = {
        "id": f"ma-{row['org']}-{row['ref_id']}",
        "source": "PMMP",
        "country": "Maroc",
        "reference": row.get("reference", ""),
        "object": row.get("object", ""),
        "buyer": row.get("buyer", ""),
        "procedure": row.get("procedure", "") or row.get("procedure_code", ""),
        "category": row.get("category", ""),
        "published": row.get("published", ""),
        "deadline": row.get("deadline", ""),
        "places": places,
        "regions": regions_of(places),
        "sectors": sectors_of(text, row.get("category", "")),
        "url": pmmp.detail_url(row["org"], row["ref_id"]),
        "env_clauses": bool(row.get("env_clauses")),
    }
    for k in ("estimate", "bond", "plans_price", "reserved", "domains", "lots", "visit", "variant"):
        if k in detail:
            n[k] = detail[k]
    n["slug"] = f"{n['id']}-{slugify(n['object'])}"
    return n


# ------------------------------------------------------------------------------------------ national portals
# Sources read as one list (no detail page): the notice carries the country, the site gives it a country page.
NATIONAL: dict[str, dict] = {
    "BJ": {"country": "Bénin", "short": "Portail du Bénin", "host": "marches-publics.bj",
           "name": "portail national des marchés publics du Bénin", "home": "https://www.marches-publics.bj/"},
    "TN": {"country": "Tunisie", "short": "Portail tunisien", "host": "marchespublics.gov.tn",
           "name": "portail tunisien des marchés publics (HAICOP)", "home": "https://www.marchespublics.gov.tn/fr"},
}
# "au Bénin", "en Tunisie"… for titles and sentences.
COUNTRY_IN = {
    "Maroc": "au Maroc", "Tunisie": "en Tunisie", "Algérie": "en Algérie", "Mauritanie": "en Mauritanie",
    "Sénégal": "au Sénégal", "Mali": "au Mali", "Burkina Faso": "au Burkina Faso", "Niger": "au Niger",
    "Tchad": "au Tchad", "Côte d'Ivoire": "en Côte d'Ivoire", "Guinée": "en Guinée", "Bénin": "au Bénin",
    "Togo": "au Togo", "Cameroun": "au Cameroun", "Centrafrique": "en Centrafrique", "Gabon": "au Gabon",
    "Congo": "au Congo", "RD Congo": "en RD Congo", "Burundi": "au Burundi", "Rwanda": "au Rwanda",
    "Djibouti": "à Djibouti", "Comores": "aux Comores", "Madagascar": "à Madagascar",
}


def country_in(country: str) -> str:
    return COUNTRY_IN.get(country, f"en {country}" if country[:1] in "AEIOUÉ" else f"au {country}")


def country_slug(country: str) -> str:
    return "-".join(fold(country).lower().split())


def from_national(norm: dict) -> dict:
    n = dict(norm)
    n["regions"] = []
    n["sectors"] = sectors_of(n["object"], n.get("category", ""))
    n["slug"] = f"{n['id']}-{slugify(n['object'])}"
    return n


def from_worldbank(norm: dict) -> dict:
    n = dict(norm)
    n["regions"] = []
    n["sectors"] = sectors_of(n["object"], n.get("category", ""))
    n["slug"] = f"{n['id']}-{slugify(n['object'])}"
    return n


# ------------------------------------------------------------------------------------------ formatting
MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
          "novembre", "décembre"]
DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def parse_deadline(s: str) -> datetime | None:
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except (ValueError, TypeError):
            continue
    return None


def fmt_date(iso: str, *, weekday: bool = False) -> str:
    d = parse_deadline(iso)
    if not d:
        return ""
    day = "1er" if d.day == 1 else str(d.day)
    out = f"{day} {MONTHS[d.month - 1]} {d.year}"
    if weekday:
        out = f"{DAYS[d.weekday()]} {out}"
    if "T" in iso:
        out += f" à {d.hour} h" + (f" {d.minute:02d}" if d.minute else "")
    return out


_SOFT_KEEP = {"ONDA", "ONEE", "OCP", "CNSS", "ANAM", "ADM", "ONCF", "SONARGES", "REDAL", "AREF", "ORMVA", "ORMVAD",
              "ONSSA", "OFPPT", "ANAPEC", "UGP", "IRED", "SRM", "SNTL", "AMO", "CHU", "CHR", "AEP", "AOO", "AOR", "BTP",
              "TGR", "RAM", "ONMT", "ANP", "AMDIE", "OMPIC", "FM", "BM", "PME", "TPE"}


_PLACE_WORDS = {"commune", "douar", "douars", "ville", "province", "prefecture", "préfecture", "cercle", "ksar", "caidat"}
_PLACE_SKIP = {"de", "des", "du", "d", "l", "la", "le", "les", "rurale", "urbaine", "territoriale", "et", "suivants"}


def soft_case(text: str, proper: frozenset = frozenset()) -> str:
    """Sentence case for a text typed in capitals ('GARDIENNAGE DES LOCAUX DE LA CNSS A NOUACEUR' -> 'Gardiennage des
    locaux de la CNSS a Nouaceur'). Kept in capitals: tokens without a vowel (RN1, PK, SRM) and known public-buyer
    acronyms; capitalised: tokens found in `proper` (lower-case place names seen in the data). Mixed-case text is
    returned unchanged. Display only (titles, descriptions): the official text stays in the data."""
    t = " ".join((text or "").split())
    letters = [c for c in t if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.6:
        return t
    out, after_place_word = [], False
    for w in re.split(r"(\s+|[-/'’(),.:;])", t):
        low = w.lower()
        if w.isupper() and (w in _SOFT_KEEP or (2 <= len(w) <= 5 and not re.search(r"[aeiouyàâéèêëîïôûü]", low))):
            out.append(w)
        elif low in proper or (after_place_word and len(low) >= 3 and low not in _PLACE_SKIP):
            out.append(low[:1].upper() + low[1:])
        else:
            out.append(low)
        if low.strip(" -'’"):
            if low in _PLACE_WORDS:
                after_place_word = True
            elif low not in _PLACE_SKIP and len(low) > 1:
                after_place_word = False
    s = "".join(out)
    return s[:1].upper() + s[1:]


def fmt_short(iso: str) -> str:
    d = parse_deadline(iso)
    return d.strftime("%d/%m/%Y") if d else ""


def fmt_mad(v: float) -> str:
    if v >= 1_000_000:
        s = f"{v / 1_000_000:.2f}".rstrip("0").rstrip(".").replace(".", ",")
        return f"{s} M MAD"
    s = f"{v:,.0f}".replace(",", " ")
    return f"{s} MAD"


def days_left(n: dict, today: date) -> int | None:
    d = parse_deadline(n.get("deadline", ""))
    return (d.date() - today).days if d else None


def is_open(n: dict, now: datetime) -> bool:
    d = parse_deadline(n.get("deadline", ""))
    if not d:
        return False
    if "T" not in n["deadline"]:
        d = d.replace(hour=23, minute=59)
    return d >= now


def summary(n: dict, today: date) -> str:
    """Three to five plain sentences built only from the notice's own fields (no language model)."""
    parts = []
    proc = n.get("procedure") or "Consultation"
    cat = (n.get("category") or "").lower()
    who = n.get("buyer") or "un acheteur public"
    if n["source"] == "PMMP":
        fem = "e" if fold(proc).startswith(("CONSULTATION", "PROCEDURE", "DEMANDE", "MANIFESTATION")) else ""
        first = f"{proc}{f' ({cat})' if cat else ''} publié{fem} le {fmt_date(n['published'])} par {who}"
        parts.append(first + ".")
        if n.get("places"):
            more = len(n["places"]) - 3
            parts.append(f"Lieu d'exécution : {', '.join(place_label(p) for p in n['places'][:3])}"
                         f"{f' et {more} autre(s)' if more > 0 else ''}.")
    elif n["source"] in NATIONAL:
        src = NATIONAL[n["source"]]
        parts.append(f"{proc}{f' ({cat})' if cat else ''} publié le {fmt_date(n['published'])} sur le {src['name']}"
                     f" par {who}.")
    else:
        first = (f"{proc}{f' ({cat})' if cat else ''} publié le {fmt_date(n['published'])} au titre d'un projet "
                 f"financé par la Banque mondiale en {n['country']}")
        if n.get("project"):
            first += f" ({n['project']})"
        parts.append(first + f". Acheteur : {who}.")
    money = []
    if n.get("estimate"):
        money.append(f"l'estimation de l'acheteur est de {fmt_mad(n['estimate'])} TTC")
    if n.get("bond"):
        money.append(f"la caution provisoire demandée est de {fmt_mad(n['bond'])}")
    if money:
        s = " et ".join(money)
        parts.append(s[0].upper() + s[1:] + ".")
    elif n["source"] == "PMMP" and n.get("detail_checked"):
        parts.append("Le portail n'indique ni estimation ni caution provisoire.")
    left = days_left(n, today)
    if n.get("deadline"):
        when = fmt_date(n["deadline"], weekday=True)
        tail = ""
        if left is not None and left >= 0:
            tail = " (aujourd'hui)" if left == 0 else (" (demain)" if left == 1 else f" ({left} jours)")
        verb = "Les plis sont à remettre" if n["source"] == "PMMP" else "Les offres ou candidatures sont attendues"
        parts.append(f"{verb} au plus tard le {when}{tail}.")
    if n.get("sme") is True:
        parts.append("Le portail indique un marché réservé aux petites et moyennes entreprises.")
    if n.get("reserved") is True:
        parts.append("Marché réservé aux TPE et PME installées au Maroc, aux coopératives, aux auto-entrepreneurs "
                     "et aux jeunes entreprises innovantes.")
    if n.get("lots"):
        parts.append(f"La consultation est découpée en {n['lots']} lots.")
    if n.get("env_clauses"):
        parts.append("L'avis comporte des dispositions environnementales.")
    return " ".join(parts)
