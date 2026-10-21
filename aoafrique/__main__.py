"""python -m aoafrique update | build --out _site"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from . import benin, model, pmmp, tunisie, worldbank
from .http import Polite

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PARIS = ZoneInfo("Europe/Paris")
CASA = ZoneInfo("Africa/Casablanca")
KEEP_CLOSED_DAYS = 30


def load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def dump(path: Path, obj) -> bool:
    text = json.dumps(obj, ensure_ascii=False, indent=0, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return True


def cmd_update(args) -> int:
    now_utc = datetime.now(timezone.utc)
    now_ma = now_utc.astimezone(CASA).replace(tzinfo=None)
    today = now_ma.date()
    meta = load(DATA / "meta.json", {})
    old = {n["id"]: n for n in load(DATA / "notices.json", [])}
    details = load(DATA / "details.json", {})
    notices: dict[str, dict] = {}
    status: dict[str, dict] = meta.get("sources", {})

    # 1. Maroc: list of open consultations. Twice a day only those put online in the last 4 days (one or
    #    two pages); a full relist on Sunday mornings (or when forced) catches cancellations and new dates.
    stored = {f"ma-{r['org']}-{r['ref_id']}": r for r in load(DATA / "pmmp_rows.json", [])}
    full = args.full or not stored or (now_ma.weekday() == 6 and now_ma.hour < 12)
    since = None if full else today - timedelta(days=4)
    rows: list[dict] = []
    try:
        http = Polite(delay=args.delay, timeout=300)
        rows = pmmp.fetch_open(http, published_since=since)
        status["PMMP"] = {"ok": True, "at": now_utc.isoformat(timespec="minutes"), "mode": "complet" if full else "incrémental",
                          "listed": len(rows), "requests": http.requests}
        if full:
            status["PMMP"]["full_at"] = now_utc.isoformat(timespec="minutes")
        elif "full_at" in meta.get("sources", {}).get("PMMP", {}):
            status["PMMP"]["full_at"] = meta["sources"]["PMMP"]["full_at"]
    except Exception as exc:  # keep the previous list rather than publishing an empty site
        print(f"PMMP en échec : {exc}", file=sys.stderr)
        status.setdefault("PMMP", {})["ok"] = False
        status["PMMP"]["error"] = str(exc)[:300]
        status["PMMP"]["failed_at"] = now_utc.isoformat(timespec="minutes")
    fresh = {f"ma-{r['org']}-{r['ref_id']}": r for r in rows}
    if full and rows:
        stored = fresh
    else:
        stored.update(fresh)
    stored = {k: r for k, r in stored.items() if model.is_open({"deadline": r.get("deadline", "")}, now_ma)}

    # 2. Detail pages, newest first, within a per-run budget; kept in data/details.json.
    missing = [r for k, r in stored.items() if k not in details]
    missing.sort(key=lambda r: (r.get("published", ""), r["ref_id"]), reverse=True)
    budget = min(len(missing), args.details)
    print(f"PMMP : {len(stored)} consultations ouvertes, {len(missing)} fiches détaillées manquantes, {budget} à lire")
    dhttp = Polite(delay=args.delay)
    t0 = time.monotonic()
    for i, r in enumerate(missing[:budget]):
        if time.monotonic() - t0 > args.detail_minutes * 60:
            print("PMMP : temps imparti aux fiches écoulé")
            break
        nid = f"ma-{r['org']}-{r['ref_id']}"
        try:
            d = pmmp.parse_detail(dhttp.text(pmmp.detail_url(r["org"], r["ref_id"])))
        except Exception as exc:
            print(f"  fiche {nid} : {exc}", file=sys.stderr)
            continue
        d["fetched"] = today.isoformat()
        details[nid] = d
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{budget} fiches")
            dump(DATA / "details.json", details)
    for nid, r in stored.items():
        n = model.from_pmmp(r, details.get(nid))
        n["detail_checked"] = nid in details
        n["first_seen"] = old.get(nid, {}).get("first_seen") or today.isoformat()
        notices[nid] = n

    # 3. World Bank, francophone Africa
    try:
        wb = worldbank.fetch_open(Polite(delay=2), today)
        for raw in wb:
            n = model.from_worldbank(worldbank.normalise(raw))
            n["first_seen"] = old.get(n["id"], {}).get("first_seen") or today.isoformat()
            notices[n["id"]] = n
        status["BM"] = {"ok": True, "at": now_utc.isoformat(timespec="minutes"), "open": len(wb)}
    except Exception as exc:
        print(f"Banque mondiale en échec : {exc}", file=sys.stderr)
        status.setdefault("BM", {})["ok"] = False
        status["BM"]["error"] = str(exc)[:300]
        status["BM"]["failed_at"] = now_utc.isoformat(timespec="minutes")
        for nid, n in old.items():
            if n["source"] == "BM":
                notices.setdefault(nid, n)

    # 3b. National portals read as one list each (Bénin, Tunisie): same pattern as the World Bank. The first
    #     successful read of a source dates its notices from their publication, so the feed and IndexNow are not
    #     flooded with a backlog presented as new.
    for src, mod in NATIONAL_SOURCES.items():
        first_read = not status.get(src, {}).get("at")
        try:
            rows = mod.fetch_open(Polite(delay=args.delay), now_utc.astimezone(NATIONAL_TZ[src]))
            for raw in rows:
                n = model.from_national(mod.normalise(raw))
                n["first_seen"] = (old.get(n["id"], {}).get("first_seen")
                                   or (min(n.get("published") or today.isoformat(), today.isoformat()) if first_read
                                       else today.isoformat()))
                notices[n["id"]] = n
            status[src] = {"ok": True, "at": now_utc.isoformat(timespec="minutes"), "open": len(rows)}
        except Exception as exc:
            print(f"{SOURCE_LABEL[src]} en échec : {exc}", file=sys.stderr)
            status.setdefault(src, {})["ok"] = False
            status[src]["error"] = str(exc)[:300]
            status[src]["failed_at"] = now_utc.isoformat(timespec="minutes")
            for nid, n in old.items():
                if n["source"] == src:
                    notices.setdefault(nid, n)

    # 4. Closed notices stay 30 days (their page says "clôturé"), then disappear.
    for nid, n in old.items():
        if nid in notices:
            continue
        d = model.parse_deadline(n.get("deadline", ""))
        if d and d.date() >= today - timedelta(days=KEEP_CLOSED_DAYS):
            n = dict(n)
            n["delisted"] = n.get("delisted") or today.isoformat()
            notices[nid] = n

    # Details of consultations gone for good are dropped too.
    details = {k: v for k, v in details.items() if k in notices}
    out = sorted(notices.values(), key=lambda n: (n.get("published", ""), n["id"]), reverse=True)

    # Guard rails: one source down → publish the others with the last known data of the one that failed
    # (kept above); fail only if every source failed, or if the number of notices drops abnormally.
    for src in SOURCES:
        status.setdefault(src, {"ok": False})
        status[src]["count"] = sum(1 for n in out if n["source"] == src)
    problems = guard(old, out, status)
    meta["sources"] = status
    meta["checked"] = now_utc.isoformat(timespec="minutes")
    if problems and os.environ.get("AOA_ALLOW_DROP") != "1":
        meta["guard"] = {"at": meta["checked"], "problems": problems}
        dump(DATA / "meta.json", meta)  # status only: notices.json, details.json and pmmp_rows.json stay as they were
        for msg in problems:
            print(f"::error::{msg}")
        return 1
    meta.pop("guard", None)
    dump(DATA / "pmmp_rows.json", sorted(stored.values(), key=lambda r: (r["org"], r["ref_id"])))
    changed = dump(DATA / "notices.json", out)
    dump(DATA / "details.json", details)
    if changed or "updated" not in meta:
        meta["updated"] = now_utc.isoformat(timespec="minutes")
    dump(DATA / "meta.json", meta)
    for src in SOURCES:
        if not status[src].get("ok"):
            print(f"::warning::{SOURCE_LABEL[src]} en échec, dernières données connues gardées "
                  f"(lecture réussie : {status[src].get('at', 'jamais')}) : {status[src].get('error', '')[:200]}")
    print(f"{len(out)} avis enregistrés ({'modifiés' if changed else 'inchangés'})")
    return 0


SOURCES = ("PMMP", "BM", "BJ", "TN")
SOURCE_LABEL = {"PMMP": "Portail marocain des marchés publics", "BM": "Banque mondiale",
                "BJ": "Portail des marchés publics du Bénin", "TN": "Portail tunisien des marchés publics"}
NATIONAL_SOURCES = {"BJ": benin, "TN": tunisie}
# Deadlines are given in local time: Cotonou (UTC+1), Tunis (UTC+1).
NATIONAL_TZ = {"BJ": ZoneInfo("Africa/Porto-Novo"), "TN": ZoneInfo("Africa/Tunis")}
MIN_KEEP = 0.7  # a run may not lose more than 30 % of the notices (all sources), nor half of one source's


def guard(old: dict, out: list[dict], status: dict) -> list[str]:
    """Reasons not to publish this run's data (empty list: publish)."""
    problems = []
    if not any(status.get(s, {}).get("ok") for s in SOURCES):
        problems.append("toutes les sources sont en échec : rien n'est publié")
    if not out:
        problems.append("aucun avis : publication d'un site vide refusée")
    elif len(old) >= 100 and len(out) < MIN_KEEP * len(old):
        problems.append(f"chute anormale du nombre d'avis : {len(old)} → {len(out)} (seuil {int(MIN_KEEP * 100)} %)")
    for src in SOURCES:
        before = sum(1 for n in old.values() if n["source"] == src)
        after = status[src]["count"]
        if before >= 20 and after < before / 2:
            problems.append(f"{SOURCE_LABEL[src]} : {before} → {after} avis, plus de la moitié disparaît")
    return problems


def cmd_build(args) -> int:
    from . import site
    site.build(Path(args.out), load(DATA / "notices.json", []), load(DATA / "meta.json", {}),
               base_url=args.base_url)
    return 0


def cmd_indexnow(args) -> int:
    """Send the URLs of tenders first seen in the last N days (plus the list pages) to IndexNow."""
    import urllib.request
    from . import site
    base = args.base_url.rstrip("/") + "/"
    since = (datetime.now(CASA).date() - timedelta(days=args.since_days)).isoformat()
    if args.paths:  # only these pages (e.g. new country and sector pages), not the tenders
        urls = [base + p.lstrip("/") for p in args.paths]
    else:
        urls = [base, base + "alertes/", base + "afrique-francophone/", base + "pays/"]
        urls += [base + "ao/" + n["slug"] + "/" for n in load(DATA / "notices.json", [])
                 if (n.get("first_seen") or "") >= since and not n.get("delisted")]
    urls = urls[:10000]
    body = json.dumps({"host": base.split("/")[2], "key": site.INDEXNOW_KEY,
                       "keyLocation": base + site.INDEXNOW_KEY + ".txt", "urlList": urls}).encode()
    req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, method="POST",
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(f"IndexNow : {len(urls)} URL envoyées, HTTP {resp.status}")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="aoafrique")
    sub = p.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("update")
    u.add_argument("--delay", type=float, default=float(os.environ.get("AOA_DELAY", "3")))
    u.add_argument("--details", type=int, default=int(os.environ.get("AOA_DETAILS", "400")))
    u.add_argument("--full", action="store_true", default=os.environ.get("AOA_FULL") == "1")
    u.add_argument("--detail-minutes", type=float, default=float(os.environ.get("AOA_DETAIL_MINUTES", "25")))
    b = sub.add_parser("build")
    b.add_argument("--out", default="_site")
    b.add_argument("--base-url", default="https://ao-afrique.jalonel.com/")
    x = sub.add_parser("indexnow")
    x.add_argument("--since-days", type=int, default=1)
    x.add_argument("--paths", nargs="*", default=None, help="send only these site paths (e.g. pays/benin/)")
    x.add_argument("--base-url", default="https://ao-afrique.jalonel.com/")
    args = p.parse_args(argv)
    return {"update": cmd_update, "build": cmd_build, "indexnow": cmd_indexnow}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
