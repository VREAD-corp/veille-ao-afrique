"""Octave CRO framework: the vendored checks of static/cro.js and gas/src/Cro.js (byte-identical copies from
octave-checkout), plus this site's wiring (script tag on every page, backend routes and page normaliser)."""
import json
import re
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
vm.runInNewContext(code + '\n' + cro + '\n;globalThis.R = { route_, croPageOf_, croValidate_, xpDetail_, CRO_SITES_, CRO_EXPERIMENTS_ };', ctx);
const { route_, croPageOf_, croValidate_, xpDetail_, CRO_SITES_, CRO_EXPERIMENTS_ } = ctx.R;
const xpBatch = croValidate_({ site: 'veille-ao-afrique', v: 2, page: '/ao/x/', e: [['xp', 'aoaf-alert', 'b.n'], ['xp', 'aoaf-alert', 'a.official'], ['xp', 'aoaf-alert', 'b.alert_view'], ['xp', 'aoaf-alert', 'b.nudge'], ['xp', 'aoaf-alert', 'b.signup'], ['xp', 'aoaf-alert', 'c.n'], ['xp', 'other', 'a.n'], ['xp', 'aoaf-alert', 'a.bogus']] });
const body = { action: 'track', kind: 'cro', v: 2, site: 'nope', page: '/', e: [['pv', '', '']] };
console.log(JSON.stringify({
  sites: CRO_SITES_, xp: CRO_EXPERIMENTS_, xp_ok: xpBatch.exp.map((e) => e.join(' ')), xp_dropped: xpBatch.dropped,
  xp_detail: [xpDetail_({ xp: 'b', form: 'rapide' }), xpDetail_({ xp: 'a', form: 'inline' }), xpDetail_({ xp: 'z', form: 'rapide' }), xpDetail_({})],
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
    assert r["sites"] == ["veille-ao-afrique"] and r["xp"] == {"aoaf-alert": ["a", "b"]}
    assert r["xp_ok"] == ["aoaf-alert b n", "aoaf-alert a official", "aoaf-alert b alert_view", "aoaf-alert b nudge", "aoaf-alert b signup"]
    assert r["xp_dropped"] == 3, "unknown arm, unknown experiment and unknown metric are dropped"
    assert r["xp_detail"] == ["aoaf-alert-b-rapide", "aoaf-alert-a-inline", "", ""]
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
           f'data-api="{GAS_URL}" data-hosts="ao-afrique.jalonel.com" data-cta="[data-mesure],#alerte-form [type=submit],#alerte-inline [type=submit]" defer>')
    pages = list(tmp_path.rglob("*.html"))
    assert len(pages) > 30 and any(p.name == "404.html" for p in pages)
    for p in pages:
        if p.name.startswith("google"):
            continue
        html = p.read_text(encoding="utf-8")
        assert html.count(tag) == 1, p
        assert "OCTAVE_XP" not in html, "experiment config only in static/xp.js (CSP: no inline script)"
        tender = p.parent.parent.name == "ao" and p.name == "index.html"
        assert ('/static/xp.js?v=' in html) == tender, p
        if tender:
            assert html.index('/static/xp.js?v=') < html.index('/static/cro.js?v='), "arm drawn before cro.js reads it"
            assert re.search(r'/static/xp\.js\?v=[0-9a-f]{10}"></script>', html), "xp.js not deferred"
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
    goal = js.index("goal(j.kind === 'preinscription' ? 'preorder' : 'signup')")
    assert ok < goal < js.index("form.reset()"), "goal recorded only after a successful sign-up"
    # Paid alerts: payment block shown, payment submitted, payment confirmed (mesure.js) and the cro.js goal `paid`.
    for ev in ("mesure('checkout_view'", "mesure('checkout_start'", "mesure('paid'", "goal('paid')"):
        assert ev in js, ev
    assert js.index("goal('paid')") > js.index("onSuccess"), "paid only from the module's success callback"
    code = (ROOT / "gas" / "src" / "Code.js").read_text(encoding="utf-8")
    for ev in ("'checkout_view'", "'checkout_start'", "'paid'", "'plan_click'"):
        assert ev in code.split("var TRACK_EVENTS_")[1].split("];")[0], ev
    assert "'paid'" in code.split("var CRO_GOALS_")[1].split(";")[0]


def test_inline_alert_goal_after_success_and_view_event():
    js = (ROOT / "static" / "alerte-inline.js").read_text(encoding="utf-8")
    ok = js.index("if (!j.ok) throw")
    assert ok < js.index("octaveCro.goal('signup')"), "goal recorded only after a successful sign-up"
    assert "window.aoaMesure('alert_form_view', ctx)" in js and "IntersectionObserver" in js
    assert "kind: 'alertes', plan: ''" in js, "inline form never pre-registers a paid plan"


def test_backend_is_jalonel_only():
    """Jalonel and the Vread reading sites are kept apart: the backend names no Vread host or address, and the
    page it serves (unsubscribe) gives the Jalonel contact."""
    code = (ROOT / "gas/src/Code.js").read_text(encoding="utf-8")
    assert "vread" not in code.lower()
    assert "var OWN_HOSTS_ = ['ao-afrique.jalonel.com'];" in code
    assert "Écrivez à contact@jalonel.com pour être retiré de la liste." in code
    # The script sends no e-mail (no reply-to to set); if one is ever added, it must reply to contact@jalonel.com.
    assert "MailApp" not in code and "GmailApp" not in code


def test_ab_alert_inline_arms(tmp_path):
    """AOAF-ALERT-INLINE-01: arm B box above the official link on every tender page, hidden unless arm b, one e-mail
    field, the tender's criteria as hidden fields, consent sentence under the button; xp.js and cro.js agree."""
    from datetime import datetime

    from aoafrique import model, pmmp
    from aoafrique.site import QUICK_CONSENT_TEXT, Site

    rows = pmmp.parse_results((TESTS / "fixtures" / "pmmp_list.html").read_text(encoding="utf-8"))
    notices = [model.from_pmmp(r, None) for r in rows]
    site = Site(tmp_path, notices, {"updated": "2026-10-13T05:40+00:00", "sources": {}}, "https://ao-afrique.jalonel.com/")
    site.now = datetime(2026, 10, 13, 8, 0)
    site.today = site.now.date()
    site.open = notices
    site.build_all()
    n = next(x for x in notices if [s for s in x["sectors"] if s != "autre"] and x.get("regions"))
    page = (tmp_path / "ao" / n["slug"] / "index.html").read_text(encoding="utf-8")
    assert page.index('id="resume"') < page.index('id="alerte-rapide"') < page.index('class="official"') < page.index('id="alerte"')
    box = page[page.index('id="alerte-rapide"'):page.index("</section>", page.index('id="alerte-rapide"'))]
    form = box[box.index("<form"):box.index("</form>")]
    assert form.count('type="email"') == 1 and 'type="checkbox"' not in form and "<select" not in form
    sector = next(s for s in n["sectors"] if s != "autre")
    assert f'name="sectors" value="{sector}"' in form and f'name="regions" value="{model.slugify(n["regions"][0])}"' in form
    assert f"{model.SECTOR_LABEL[sector]} – {n['regions'][0]}, Maroc" in box
    assert 'data-ctx="fiche-rapide"' in box and QUICK_CONSENT_TEXT in box and "/confidentialite/" in box
    assert len(QUICK_CONSENT_TEXT) >= 40, "backend refuses a consent text under 40 characters"
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
    assert ".alert-quick { display: none;" in css and 'html[data-xp-aoaf-alert="b"] .alert-quick { display: block; }' in css
    xp = (ROOT / "static" / "xp.js").read_text(encoding="utf-8")
    assert "id: 'aoaf-alert', variants: ['a', 'b'], mode: 'tab'" in xp and "'oxp_aoaf-alert'" in xp
    for low in ("vread", "read france", "outils.vread", "octave@"):
        assert low not in box.lower() and low not in xp.lower()
    js = (ROOT / "static" / "alerte-inline.js").read_text(encoding="utf-8")
    assert "goal('official')" in js and "goal('alert_view')" in js and "test: isTest(), xp: arm(), form: kind" in js


XP_CHECK = r"""
import fs from 'node:fs';
import vm from 'node:vm';
const [xpSrc, croSrc] = process.argv.slice(1).map((f) => fs.readFileSync(f, 'utf8'));
function run(search, path, seed) {
  const store = new Map(seed || []);
  const attrs = {};
  const sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, currentScript: { dataset: {} }, readyState: 'complete',
    querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible', forms: [] };
  const window = { sessionStorage, addEventListener() {}, document };
  window.window = window;
  const ctx = { window, document, sessionStorage, navigator: { userAgent: 'x' }, location: { search, pathname: path, hostname: 'localhost' },
    URLSearchParams, Intl, Date, Math, localStorage: { getItem: () => null } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(xpSrc.replace('window.OCTAVE_XP', 'globalThis.OCTAVE_XP = window.OCTAVE_XP'), ctx);
  const drawn = attrs['data-xp-aoaf-alert'];
  vm.runInContext(croSrc, ctx);
  return { drawn, cro: window.octaveCro.v('aoaf-alert'), attr: attrs['data-xp-aoaf-alert'], stored: store.get('oxp_aoaf-alert') };
}
const draws = Array.from({ length: 400 }, () => run('', '/ao/x/'));
console.log(JSON.stringify({
  agree: draws.every((r) => r.drawn === r.cro && r.cro === r.attr && r.attr === r.stored),
  b: draws.filter((r) => r.cro === 'b').length,
  forced: run('?xp_aoaf=b', '/ao/x/', [['oxp_aoaf-alert', 'a']]).cro,
  sticky: run('', '/ao/y/', [['oxp_aoaf-alert', 'a']]).cro,
}));
"""


@node
def test_xp_js_and_cro_js_draw_the_same_arm():
    r = json.loads(run_node("--input-type=module", "-e", XP_CHECK, "--", ROOT / "static" / "xp.js", ROOT / "static" / "cro.js"))
    assert r["agree"], "the arm on <html> before paint is the arm cro.js counts"
    assert 140 < r["b"] < 260, r["b"]
    assert r["forced"] == "b" and r["sticky"] == "a"
