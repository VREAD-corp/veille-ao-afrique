"""aoafrique/alerts.py: message headers and the sender guard (no network)."""

import pytest

from aoafrique import alerts

MAIL = {"email": "a@entreprise.ma", "subject": "2 nouveaux appels d’offres pour vos critères – Veille AO Afrique",
        "text": "Bonjour,\nSe désinscrire en un clic : https://x/exec?action=unsubscribe&email=a%40entreprise.ma&t=abc",
        "html": "<p>Bonjour,</p>", "unsubscribe": "https://x/exec?action=unsubscribe&email=a%40entreprise.ma&t=abc",
        "last_first_seen": "2026-10-21", "notices": 2}


def test_headers():
    m = alerts.build(MAIL, "Veille AO Afrique (Jalonel)", "alertes@jalonel.com", "contact@jalonel.com")
    assert m["From"] == "\"Veille AO Afrique (Jalonel)\" <alertes@jalonel.com>"
    assert m["Reply-To"] == "contact@jalonel.com"
    assert m["List-Unsubscribe"].startswith("<https://x/exec?action=unsubscribe&email=a%40entreprise.ma&t=abc>")
    assert m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert m["Message-ID"].endswith("@jalonel.com>")
    assert m["Sender"] is None
    for h in ("From", "Reply-To", "Message-ID", "List-Id"):
        assert "vread" not in m[h].lower() and "gmail" not in m[h].lower()
    raw = m.as_bytes().decode("utf-8")
    long_url = "https://script.google.com/macros/s/" + "A" * 80 + "/exec?action=unsubscribe&email=a%40entreprise.ma&t=" + "f" * 32
    raw2 = alerts.build({**MAIL, "unsubscribe": long_url}, "Veille AO Afrique (Jalonel)", "alertes@jalonel.com", "contact@jalonel.com").as_bytes().decode("utf-8")
    assert f"List-Unsubscribe: <{long_url}>, <mailto:contact@jalonel.com?subject=desinscription>\r\n" in raw2, "not folded or encoded"
    assert "=?utf-8?" in raw.split("Subject: ")[1].split("\r\n")[0]
    assert m.get_body(("plain",)).get_content().startswith("Bonjour")
    assert m.get_body(("html",)).get_content().startswith("<p>Bonjour")


@pytest.mark.parametrize("addr", ["someone@gmail.com", "octave@vread.fr", "alertes@jalonel.com.evil.net"])
def test_sender_guard(addr):
    with pytest.raises(SystemExit):
        alerts.check_sender(addr)


def test_mask():
    assert alerts.mask("alice@entreprise.ma") == "a…@e…"
