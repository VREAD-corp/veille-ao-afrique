"""One-off announcement « Fin du test gratuit » from alertes@jalonel.com (same SMTP as the alerts).

The Apps Script backend decides who receives it and builds each e-mail (`announce_plan`, token, read-only), then
keeps the one-real-run marker (`announce_confirm`, stage `start` before the first e-mail, `done` after the last).
Run by .github/workflows/announce.yml (manual only):  python -m aoafrique announce --mode test|real --confirm ENVOYER-FIN-TEST
Nothing is sent without the exact confirmation word. Environment as aoafrique/alerts.py (AOAF_ALERTS_TOKEN,
AOAF_SMTP_PASSWORD, optional AOAF_SMTP_USER; test mode: AOAF_ONLY, the address of the `test` sign-up).
"""

from __future__ import annotations

import os
import sys
import time

from . import alerts

CONFIRM = "ENVOYER-FIN-TEST"


def run(mode: str, confirm: str, url: str = alerts.BACKEND, dry_run: bool = False) -> int:
    if confirm != CONFIRM:
        print(f"Confirmation absente ou inexacte (attendu : {CONFIRM}) : rien n'est envoyé", file=sys.stderr)
        return 2
    if mode not in ("test", "real"):
        print("mode : test ou real", file=sys.stderr)
        return 2
    token = os.environ.get("AOAF_ALERTS_TOKEN", "")
    password = os.environ.get("AOAF_SMTP_PASSWORD", "")
    user = os.environ.get("AOAF_SMTP_USER", alerts.FROM)
    if not token or not (password or dry_run):
        print("AOAF_ALERTS_TOKEN ou AOAF_SMTP_PASSWORD manquant", file=sys.stderr)
        return 2
    alerts.check_sender(user)
    only = os.environ.get("AOAF_ONLY", "").strip().lower()
    if mode == "test" and not only:
        print("Mode test : AOAF_ONLY (adresse de l'inscription de test) manquant", file=sys.stderr)
        return 2
    # Sector names for « {criteres} », as in the alerts (the backend cannot fetch the public feed itself).
    body = {"action": "announce_plan", "token": token, "mode": mode, "sectors": alerts.feed().get("sectors") or {}}
    if mode == "test":
        body["only"] = only
    plan = alerts.backend(url, body)
    if not plan.get("ok"):
        print(f"announce_plan en échec : {plan.get('error')} {plan.get('message', '')}", file=sys.stderr)
        return 1
    if plan.get("from") != user:
        print(f"Le backend attend {alerts.mask(plan.get('from', ''))}, compte SMTP {alerts.mask(user)} : rien n'est envoyé", file=sys.stderr)
        return 1
    if plan.get("already"):
        print(f"Annonce déjà lancée le {plan['already'].get('started_at')} : rien n'est envoyé", file=sys.stderr)
        return 1
    mails = plan.get("mails", [])
    ex = plan.get("excluded") or {}
    print(f"Mode {mode} : {plan.get('subscribers')} inscrit(s) actif(s), {len(mails)} destinataire(s) ; écartés : "
          f"{ex.get('paid', 0)} payant(s), {ex.get('eu', 0)} déclaré(s) « Autre pays d'Europe »")
    if mode == "test" and (len(mails) != 1 or mails[0]["email"] != only):
        print("Mode test : il faut exactement l'inscription de test, rien n'est envoyé", file=sys.stderr)
        return 1
    cap = int(plan.get("max_mails") or 150)
    if len(mails) > cap:
        # One real run only: never a partial one.
        print(f"{len(mails)} destinataires, plus que {cap} par exécution : rien n'est envoyé", file=sys.stderr)
        return 1
    if not mails:
        print("Aucun destinataire : rien n'est envoyé")
        return 0
    if dry_run:
        for m in mails:
            print(f"  {alerts.mask(m['email'])} : « {m['subject']} »")
        print("Essai à blanc : rien n'est envoyé ni enregistré")
        return 0
    start = alerts.backend(url, {"action": "announce_confirm", "token": token, "mode": mode, "stage": "start", "planned": len(mails)})
    if not start.get("ok"):
        print(f"announce_confirm (start) refusé : {start.get('error')} {start.get('message', '')} ; rien n'est envoyé", file=sys.stderr)
        return 1
    sent, failed = [], []
    smtp = alerts.Smtp(user, password)
    try:
        for i, m in enumerate(mails):
            try:
                smtp.send(alerts.build(m, plan["sender"], user, plan["reply_to"]), m["email"])
                sent.append(m["email"])
                print(f"  envoyé à {alerts.mask(m['email'])}")
            except Exception as exc:  # one refused address does not stop the others
                failed.append({"email": m["email"], "error": f"{type(exc).__name__}: {str(exc)[:160]}"})
                print(f"  échec pour {alerts.mask(m['email'])} : {type(exc).__name__}", file=sys.stderr)
            if i + 1 < len(mails):
                time.sleep(alerts.PAUSE)
    finally:
        smtp.close()
    for attempt in range(3):
        try:
            c = alerts.backend(url, {"action": "announce_confirm", "token": token, "mode": mode, "stage": "done",
                                     "planned": len(mails), "sent": len(sent), "failed": failed})
            break
        except Exception as exc:
            if attempt == 2:
                print(f"announce_confirm (done) injoignable : {exc}", file=sys.stderr)
                return 1
            time.sleep(20 * (attempt + 1))
    print(f"Confirmé : {c.get('sent')} envoyé(s), {c.get('errors')} erreur(s)")
    return 0 if c.get("ok") and not failed else 1
