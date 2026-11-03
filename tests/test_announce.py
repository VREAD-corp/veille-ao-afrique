"""aoafrique/announce.py: confirmation word, one-run claim before the first e-mail, test-mode guard (no network)."""

import shutil
import subprocess
from pathlib import Path

import pytest

from aoafrique import alerts, announce

MAIL = {"email": "a@entreprise.ma", "subject": "Fin du test gratuit : ce qui change pour vous", "text": "Bonjour,",
        "html": "<p>Bonjour,</p>", "unsubscribe": "https://x/exec?action=unsubscribe&email=a%40entreprise.ma&t=abc"}


@pytest.fixture
def fake(monkeypatch):
    calls, sent = [], []
    state = {"plan": {"ok": True, "from": "alertes@jalonel.com", "sender": "Veille AO Afrique (Jalonel)", "reply_to": "contact@jalonel.com",
                      "max_mails": 150, "already": None, "subscribers": 2, "excluded": {"paid": 0, "eu": 1}, "mails": [MAIL]},
             "start": {"ok": True}}

    def backend(url, body, timeout=120):
        calls.append(body)
        if body["action"] == "announce_plan":
            return state["plan"]
        if body["stage"] == "start":
            return state["start"]
        return {"ok": True, "sent": body["sent"], "errors": len(body["failed"])}

    class Smtp:
        def __init__(self, user, password): pass
        def send(self, msg, to): sent.append((msg, to))
        def close(self): pass

    monkeypatch.setattr(alerts, "backend", backend)
    monkeypatch.setattr(alerts, "feed", lambda: {"sectors": {"btp": "BTP et génie civil"}, "notices": []})
    monkeypatch.setattr(alerts, "Smtp", Smtp)
    monkeypatch.setattr(alerts, "PAUSE", 0)
    monkeypatch.setenv("AOAF_ALERTS_TOKEN", "t" * 40)
    monkeypatch.setenv("AOAF_SMTP_PASSWORD", "x")
    monkeypatch.delenv("AOAF_ONLY", raising=False)
    monkeypatch.delenv("AOAF_SMTP_USER", raising=False)
    return state, calls, sent


@pytest.mark.parametrize("word", ["", "envoyer-fin-test", "ENVOYER", "ENVOYER-FIN-TEST "])
def test_no_confirmation_no_call(fake, word):
    state, calls, sent = fake
    assert announce.run("real", word) == 2
    assert calls == [] and sent == []


def test_real_run_claims_before_sending(fake):
    state, calls, sent = fake
    assert announce.run("real", "ENVOYER-FIN-TEST") == 0
    assert [c.get("stage", c["action"]) for c in calls] == ["announce_plan", "start", "done"]
    assert calls[0]["sectors"] == {"btp": "BTP et génie civil"} and "only" not in calls[0]
    assert calls[2]["sent"] == 1 and calls[2]["failed"] == []
    msg, to = sent[0]
    assert to == "a@entreprise.ma"
    assert msg["From"] == "\"Veille AO Afrique (Jalonel)\" <alertes@jalonel.com>"
    assert msg["List-Unsubscribe"].startswith("<https://x/exec?action=unsubscribe&email=a%40entreprise.ma&t=abc>")


def test_already_sent_or_claim_refused(fake):
    state, calls, sent = fake
    state["plan"] = {**state["plan"], "already": {"started_at": "2026-11-05T08:00:00Z"}, "mails": []}
    assert announce.run("real", "ENVOYER-FIN-TEST") == 1
    state["plan"] = {**state["plan"], "already": None, "mails": [MAIL]}
    state["start"] = {"ok": False, "error": "already_sent"}
    assert announce.run("real", "ENVOYER-FIN-TEST") == 1
    assert sent == [], "nothing sent when the one real run is already claimed"


def test_dry_run_and_cap(fake):
    state, calls, sent = fake
    assert announce.run("real", "ENVOYER-FIN-TEST", dry_run=True) == 0
    assert [c["action"] for c in calls] == ["announce_plan"] and sent == []
    state["plan"] = {**state["plan"], "max_mails": 1, "mails": [MAIL, {**MAIL, "email": "b@entreprise.ma"}]}
    assert announce.run("real", "ENVOYER-FIN-TEST") == 1
    assert sent == [], "never a partial real run"


def test_test_mode_only_the_test_address(fake, monkeypatch):
    state, calls, sent = fake
    assert announce.run("test", "ENVOYER-FIN-TEST") == 2, "AOAF_ONLY required"
    monkeypatch.setenv("AOAF_ONLY", "Test@Entreprise.ma")
    state["plan"] = {**state["plan"], "mails": [{**MAIL, "email": "test@entreprise.ma"}]}
    assert announce.run("test", "ENVOYER-FIN-TEST") == 0
    assert calls[0]["only"] == "test@entreprise.ma" and calls[0]["mode"] == "test"
    assert [to for _, to in sent] == ["test@entreprise.ma"]
    sent.clear()
    state["plan"] = {**state["plan"], "mails": [{**MAIL, "email": "test@entreprise.ma"}, MAIL]}
    assert announce.run("test", "ENVOYER-FIN-TEST") == 1
    assert sent == []


def test_smtp_failure_reported(fake, monkeypatch):
    state, calls, sent = fake

    class Bad:
        def __init__(self, user, password): pass
        def send(self, msg, to): raise OSError("550 refused")
        def close(self): pass

    monkeypatch.setattr(alerts, "Smtp", Bad)
    assert announce.run("real", "ENVOYER-FIN-TEST") == 1
    assert calls[-1]["stage"] == "done" and calls[-1]["sent"] == 0 and calls[-1]["failed"][0]["email"] == "a@entreprise.ma"


def test_workflow_manual_only_and_guarded():
    wf = (Path(__file__).parents[1] / ".github/workflows/announce.yml").read_text()
    assert "schedule" not in wf and "push:" not in wf and "workflow_dispatch:" in wf
    assert '[ "$CONFIRM" != "ENVOYER-FIN-TEST" ]' in wf
    assert "${{ github.event.inputs.confirm }}" not in wf.split("run:")[-1], "inputs passed through env, not inlined"


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_backend_announce():
    r = subprocess.run(["node", str(Path(__file__).with_name("announce_check.mjs"))], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr + r.stdout
    assert "announce: ok" in r.stdout
