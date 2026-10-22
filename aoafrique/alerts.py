"""E-mail alerts: sends the e-mails of the day from alertes@jalonel.com (OVHcloud mailbox, SMTP over SSL).

The Apps Script backend decides who receives what (action `alerts_plan`, token) and records what was sent
(`alerts_confirm`). This module only builds and sends the messages; it never prints an address (masked) or a secret.
Run by .github/workflows/alerts.yml:  python -m aoafrique alerts --mode test|real
Environment: AOAF_ALERTS_TOKEN, AOAF_SMTP_PASSWORD (GitHub secrets); optional AOAF_SMTP_USER, AOAF_ONLY (test mode:
one test address, a secret so it stays out of the public logs), AOAF_FORCE=1 (real mode: run even if a real run already happened today, Paris time).
"""

from __future__ import annotations

import json
import os
import smtplib
import ssl
import sys
import time
import urllib.request
from email.message import EmailMessage
from datetime import datetime
from email.utils import formataddr, formatdate, make_msgid
from zoneinfo import ZoneInfo

from .http import USER_AGENT

BACKEND = ("https://script.google.com/macros/s/"
           "AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec")
FEED = "https://ao-afrique.jalonel.com/data/alertes.json"
FROM = "alertes@jalonel.com"
SENDER_DOMAIN = "jalonel.com"
SMTP_HOST, SMTP_PORT = "smtp.mail.ovh.net", 465
PAUSE = 1.5  # seconds between two e-mails (the mailbox allows about 200 an hour)


def mask(email: str) -> str:
    """The run logs of this public repository show neither the address nor its domain."""
    local, _, domain = str(email).partition("@")
    return (local[:1] + "…@" + domain[:1] + "…") if domain else "…"


def check_sender(addr: str) -> None:
    """Alerts leave from a Jalonel address only, never from a personal mailbox."""
    a = addr.strip().lower()
    if not a.endswith("@" + SENDER_DOMAIN) or "gmail" in a or "vread" in a:
        raise SystemExit(f"Expéditeur refusé : {mask(a)} (attendu : une adresse @{SENDER_DOMAIN})")


def backend(url: str, body: dict, timeout: int = 120) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "text/plain;charset=utf-8", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # Apps Script answers with a 302 to the result
        return json.loads(resp.read().decode("utf-8"))


def build(mail: dict, sender: str, from_addr: str, reply_to: str) -> EmailMessage:
    check_sender(from_addr)
    msg = EmailMessage()
    msg["From"] = formataddr((sender, from_addr))
    msg["To"] = mail["email"]
    msg["Reply-To"] = reply_to
    msg["Subject"] = mail["subject"]
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain=SENDER_DOMAIN)
    # RFC 2369 / 8058: the mail client's unsubscribe button withdraws the address in one click.
    msg["List-Unsubscribe"] = f"<{mail['unsubscribe']}>, <mailto:{reply_to}?subject=desinscription>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg["List-Id"] = f"Veille AO Afrique <alertes.ao-afrique.{SENDER_DOMAIN}>"
    msg.set_content(mail["text"])
    msg.add_alternative(mail["html"], subtype="html")
    return msg


class Smtp:
    def __init__(self, user: str, password: str):
        self.user, self.password, self.conn = user, password, None

    def send(self, msg: EmailMessage, to: str) -> None:
        for attempt in (1, 2):
            try:
                if self.conn is None:
                    self.conn = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=60, context=ssl.create_default_context())
                    self.conn.login(self.user, self.password)
                self.conn.send_message(msg, from_addr=self.user, to_addrs=[to])
                return
            except (smtplib.SMTPServerDisconnected, ConnectionError, TimeoutError):
                self.conn = None
                if attempt == 2:
                    raise

    def close(self) -> None:
        if self.conn is not None:
            try:
                self.conn.quit()
            except Exception:
                pass


def feed(url: str = FEED) -> dict:
    """The public feed (open notices first seen in the last 8 days); the backend cannot fetch it itself."""
    req = urllib.request.Request(f"{url}?t={int(time.time())}", headers={"User-Agent": USER_AGENT, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("notices"), list):
        raise ValueError("flux sans avis")
    return data


def run(mode: str, url: str = BACKEND, dry_run: bool = False) -> int:
    token = os.environ.get("AOAF_ALERTS_TOKEN", "")
    password = os.environ.get("AOAF_SMTP_PASSWORD", "")
    user = os.environ.get("AOAF_SMTP_USER", FROM)
    if not token or not (password or dry_run):
        print("AOAF_ALERTS_TOKEN ou AOAF_SMTP_PASSWORD manquant", file=sys.stderr)
        return 2
    check_sender(user)
    if mode == "real" and not dry_run and os.environ.get("AOAF_FORCE") != "1":
        # At most one real run a day (the backup schedule and a manual rerun must not mail twice).
        with urllib.request.urlopen(urllib.request.Request(url + "?action=alerts_status", headers={"User-Agent": USER_AGENT}),
                                    timeout=60) as resp:
            last = (json.loads(resp.read().decode("utf-8")).get("alerts") or {}).get("at") or ""
        paris = ZoneInfo("Europe/Paris")
        if last and datetime.fromisoformat(last.replace("Z", "+00:00")).astimezone(paris).date() == datetime.now(paris).date():
            print(f"Alertes déjà envoyées aujourd'hui ({last}) : rien à faire")
            return 0
    t0 = time.monotonic()
    body = {"action": "alerts_plan", "token": token, "mode": mode, "feed": feed()}
    if mode == "test":
        if not os.environ.get("AOAF_ONLY"):
            print("Mode test : AOAF_ONLY (adresse de l'inscription de test) manquant", file=sys.stderr)
            return 2
        body["only"] = os.environ["AOAF_ONLY"]
    plan = backend(url, body)
    if not plan.get("ok"):
        print(f"alerts_plan en échec : {plan.get('error')} {plan.get('message', '')}", file=sys.stderr)
        return 1
    if plan.get("from") != user:
        print(f"Le backend attend {mask(plan.get('from', ''))}, compte SMTP {mask(user)} : rien n'est envoyé", file=sys.stderr)
        return 1
    mails = plan.get("mails", [])
    print(f"Mode {mode} : {plan['subscribers']} inscrit(s), {len(mails)} e-mail(s) à envoyer, "
          f"{plan['nothing_new']} sans nouveauté, {plan['weekly_wait']} en attente hebdomadaire ; flux {plan['feed_updated']}")
    if dry_run:
        for m in mails:
            print(f"  {mask(m['email'])} : {m['notices']} avis, « {m['subject']} »")
        print("Essai à blanc : rien n'est envoyé ni enregistré")
        return 0
    cap = int(plan.get("max_mails") or 150)
    sent, failed = [], []
    smtp = Smtp(user, password)
    try:
        for i, m in enumerate(mails[:cap]):
            try:
                smtp.send(build(m, plan["sender"], user, plan["reply_to"]), m["email"])
                sent.append({"email": m["email"], "last_first_seen": m["last_first_seen"]})
                print(f"  envoyé à {mask(m['email'])} ({m['notices']} avis)")
            except Exception as exc:  # one refused address does not stop the others
                failed.append({"email": m["email"], "error": f"{type(exc).__name__}: {str(exc)[:160]}"})
                print(f"  échec pour {mask(m['email'])} : {type(exc).__name__}", file=sys.stderr)
            if i + 1 < len(mails[:cap]):
                time.sleep(PAUSE)
    finally:
        smtp.close()
    run_info = {k: plan.get(k) for k in ("feed_updated", "feed_count", "subscribers", "nothing_new", "weekly_wait")}
    run_info.update(deferred=max(0, len(mails) - cap), quota_left=max(0, cap - len(mails)),
                    duration_ms=int((time.monotonic() - t0) * 1000), detail=plan.get("detail", []))
    for attempt in range(3):
        try:
            c = backend(url, {"action": "alerts_confirm", "token": token, "mode": mode, "run": run_info,
                              "sent": sent, "failed": failed})
            break
        except Exception as exc:
            if attempt == 2:
                print(f"alerts_confirm injoignable : {exc}", file=sys.stderr)
                return 1
            time.sleep(20 * (attempt + 1))
    print(f"Confirmé : {c.get('sent')} envoyé(s), {c.get('errors')} erreur(s)")
    return 0 if c.get("ok") and not c.get("errors") and not failed else 1
