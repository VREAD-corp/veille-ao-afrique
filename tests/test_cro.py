"""Octave CRO framework: the vendored checks of static/cro.js and gas/src/Cro.js (byte-identical copies from
octave-checkout), plus this site's wiring (script tag on every page, backend routes and page normaliser)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TESTS = Path(__file__).parent
node = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def run_node(*args, stdin=None):
    r = subprocess.run(["node", *map(str, args)], capture_output=True, text=True, timeout=120, input=stdin)
    assert r.returncode == 0, r.stderr + r.stdout
    return r.stdout


@node
def test_cro_js_browser_check():
    assert "cro.js: ok" in run_node(TESTS / "cro.check.mjs", ROOT / "static" / "cro.js")


@node
def test_cro_gas_module_check():
    assert "Cro.js: ok" in run_node(TESTS / "cro-gas.check.mjs", ROOT / "gas" / "src" / "Cro.js")


HOST_CHECK = r"""
import fs from 'node:fs';
import vm from 'node:vm';
const [code, cro] = process.argv.slice(1).map((f) => fs.readFileSync(f, 'utf8'));
const out = (s) => ({ s, setMimeType() { return this; } });
const ctx = { ContentService: { createTextOutput: out, MimeType: { JSON: 'json' } }, console };
vm.runInNewContext(code + '\n' + cro + '\n;globalThis.R = { route_, croPageOf_, CRO_SITES_, CRO_EXPERIMENTS_ };', ctx);
const { route_, croPageOf_, CRO_SITES_, CRO_EXPERIMENTS_ } = ctx.R;
const body = { action: 'track', kind: 'cro', v: 2, site: 'nope', page: '/', e: [['pv', '', '']] };
console.log(JSON.stringify({
  sites: CRO_SITES_, xp: CRO_EXPERIMENTS_,
  tender: croPageOf_('veille-ao-afrique', '/ao/ma-h5j-1005224-x/'),
  home: croPageOf_('veille-ao-afrique', '/'),
  alerts: croPageOf_('veille-ao-afrique', '/alertes/index.html'),
  legacy: croPageOf_('veille-ao-afrique', '/veille-ao-afrique/ao/ma-h5j-1005224-x/'),
  bad: route_({}, body).s,
  init_get: route_({ action: 'cro_init', key: 'x' }, null).s,
}));
"""


@node
def test_backend_wiring():
    r = json.loads(run_node("--input-type=module", "-e", HOST_CHECK, "--", ROOT / "gas/src/Code.js", ROOT / "gas/src/Cro.js"))
    assert r["sites"] == ["veille-ao-afrique"] and r["xp"] == {}
    assert r["tender"] == "/ao/*", "tender pages collapsed like the Stats tab"
    assert r["home"] == "/" and r["alerts"] == "/alertes/"
    assert r["legacy"] == "/ao/*", "old /veille-ao-afrique/ paths (cached pages) still map to the same rows"
    assert json.loads(r["bad"]) == {"ok": False, "error": "bad_request"}
    assert json.loads(r["init_get"])["error"] == "method_not_allowed"


def test_every_page_loads_cro_js(tmp_path):
    from datetime import datetime

    from aoafrique import model, pmmp
    from aoafrique.site import CRO_V, GAS_URL, Site

    rows = pmmp.parse_results((TESTS / "fixtures" / "pmmp_list.html").read_text(encoding="utf-8"))
    notices = [model.from_pmmp(r, None) for r in rows]
    meta = {"updated": "2026-10-13T05:40+00:00", "sources": {}}
    site = Site(tmp_path, notices, meta, "https://ao-afrique.jalonel.com/")
    site.now = datetime(2026, 10, 13, 8, 0)
    site.today = site.now.date()
    site.open = notices
    site.build_all()
    assert (tmp_path / "static" / "cro.js").read_bytes() == (ROOT / "static" / "cro.js").read_bytes()
    tag = (f'<script src="/static/cro.js?v={CRO_V}" data-site="veille-ao-afrique" '
           f'data-api="{GAS_URL}" data-hosts="ao-afrique.jalonel.com outils.vread.fr" data-cta="[data-mesure],#alerte-form [type=submit]" defer>')
    pages = list(tmp_path.rglob("*.html"))
    assert len(pages) > 30 and any(p.name == "404.html" for p in pages)
    for p in pages:
        if p.name.startswith("google"):
            continue
        html = p.read_text(encoding="utf-8")
        assert html.count(tag) == 1, p
        assert "OCTAVE_XP" not in html, "no experiment on this site"
    idx = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert 'id="hero"' in idx and 'id="liste"' in idx and '<form class="filters" id="filtres"' in idx
    alerts = (tmp_path / "alertes" / "index.html").read_text(encoding="utf-8")
    assert '<form id="alerte-form"' in alerts and 'id="offres"' in alerts
    priv = (tmp_path / "confidentialite" / "index.html").read_text(encoding="utf-8")
    for words in ("profondeur de défilement", "jamais son contenu", "Tests A/B", "stockage de session",
                  "Global Privacy Control", "article 82", "17 septembre 2020", "13 octobre 2026"):
        assert words in priv, words


def test_goals_on_successful_signup():
    js = (ROOT / "static" / "alertes.js").read_text(encoding="utf-8")
    ok = js.index("if (!j.ok) throw")
    goal = js.index("octaveCro.goal(j.kind === 'preinscription' ? 'preorder' : 'signup')")
    assert ok < goal < js.index("form.reset()"), "goal recorded only after a successful sign-up"
