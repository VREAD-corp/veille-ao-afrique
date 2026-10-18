# Veille AO Afrique

Open public tenders in Morocco and French-language World Bank notices for francophone Africa, refreshed twice a day and published as a static French site with filters, one page per tender, a rule-based summary (no LLM), an e-mail alerts interest form and a paid-tier fake door.

**Site:** https://ao-afrique.jalonel.com/ (since 2026-10-16, served at the root of its Jalonel subdomain; ancienne adresse : https://outils.vread.fr/veille-ao-afrique/, which GitHub Pages redirects here)
A service of READ FRANCE SAS (SIREN 988 741 773, Paris), under the brand Jalonel (« Jalonel est une marque de READ FRANCE SAS. », footer « Une marque Jalonel » → https://jalonel.com/, JSON-LD publisher Jalonel). Venture AF-XX-04 of Octave's global portfolio (`VREAD-corp/octave-global-ventures`). Independent from the Vread app.

## Sources and legal basis

| Source | Access | Basis |
|---|---|---|
| Portail marocain des marchés publics (`www.marchespublics.gov.ma`, Trésorerie Générale du Royaume) | HTML: the "Consultations en cours" search form (Atexo/PRADO postback), 500 rows per page. Twice a day only consultations put online in the last 4 days (1-2 pages); full relist (9 pages, ~30 min because each page takes the server 40-250 s) on Sunday mornings. One detail page per new consultation, kept in `data/details.json`; raw rows in `data/pmmp_rows.json` | No robots.txt (the path redirects to the home page), no published terms (the footer "Mentions légales" link is `#`), checked 2026-10-13. Reuse under **art. 6 of law 31-13** on access to information: legitimate purpose, content not altered, source and date shown. Official object text is shown verbatim; contact names, e-mails and phones are never extracted. |
| World Bank procurement notices (`search.worldbank.org/api/v2/procnotices`) | JSON API, French-language notices, open calls only, francophone African countries | Dataset "Procurement Notice" (Data Catalog 0037776), **CC BY 4.0**. Contact fields are dropped. |

Politeness: identifying User-Agent with `octave@vread.fr`, one request at a time, at least 3 s between requests, 3-4 list requests per run (12 on Sundays), detail pages fetched once (budget 400 per run, 40 minutes max). `workflow_dispatch` input `full=1` forces a full relist.

## Commands

```bash
python -m aoafrique update          # fetch both sources → data/notices.json, data/details.json, data/meta.json
python -m aoafrique build --out _site
python -m aoafrique indexnow --since-days 1
python -m pytest -q
```

Python 3.12, standard library only at runtime.

## Site

- `/` list with client-side filters (keyword, sector, region, city/province, buyer, deadline, category, country, sort) over `data/ouverts.json`; first 30 cards server-rendered.
- `/ao/<id>-<slug>/` one page per tender: verbatim object, fact table, rule-based summary, official link, JSON-LD (`Demand`, `BreadcrumbList`). Closed tenders stay 30 days.
- `/secteurs/<slug>/` (13), `/regions/<slug>/` (12), `/afrique-francophone/` (World Bank).
- Short alert sign-up (`static/alerte-inline.js`, form `#alerte-inline`: sector, region, e-mail, consent) on every tender page after the fact table, on the list (follows the sector and region filters), on each sector and region page after the first 12 cards and on `/afrique-francophone/`. Same `signup` as `/alertes/` (kind `alertes`, no plan), honest status and planned price next to the button. Measured by `alert_form_view` (detail `fiche`, `fiche-bm`, `liste`, `secteur`, `region`, `afrique`; sent once when 40 % of the box is on screen), the server-side `alert_signup` (Stats row keyed by page, `/ao/*` for tender pages), cro.js `form alerte-inline start/submit/abandon` and goal `signup`. Tender pages end with « Avis similaires encore ouverts » (same sector and region first), links to the sector and region pages and « Et maintenant ? » (official notice, deadline, alert).
- `/alertes/` interest form + « Pré-inscription, sans paiement » for two planned tiers (Essentiel 39 € and Pro 79 € for 3 months, marked « bientôt disponible »). No payment code.
- `/licence.html` « Conditions de réutilisation des données » (law 31-13 art. 6 for the Moroccan notices, CC BY 4.0 for the World Bank ones), target of the `Dataset` JSON-LD `license` property.
- `/methode/`, `/mentions-legales/`, `/confidentialite/`, `sitemap.xml`, `robots.txt`, `feed.xml`, `CNAME` (`ao-afrique.jalonel.com`), IndexNow key file (`5be19f56d46ca3d2553bee28ebfa8edd.txt`, the key shared by the Jalonel sites).

## Backend (Apps Script, `gas/`)

A new standalone project `veille-ao-afrique-gas (READ FRANCE SAS)`, scope `spreadsheets` only, its own spreadsheet created on first use. Actions: `track` (cookieless daily counters, same pattern as octave-checkout `Track.js`; hits from crawlers, `navigator.webdriver`, headless browsers and our tests go to a separate `Exclus` tab by reason, prerendered pages count only once opened; a hit without the snippet version `v`, i.e. from an old mesure.js still cached by a crawler, is excluded as `legacy`; the snippet URL carries a content hash), `stats` (token: one day's counted vs excluded views and all counter rows), `signup` (interest form and pre-registration, consent text stored), `unsubscribe`, `admin` (token in the git-ignored `gas/src/Secret.js`).


**Bursts (2026-10-18).** On 13/10, before the filter went live at about 11:11 Paris, 936 tender pages were counted in one morning: all `/ao/*`, `(direct)`, 74 % mobile, no filter, search or click, 2 cro.js pages. That is the signature of a JS-rendering crawler, and from 11:11 the same pattern went to `Exclus` as `bot` (289 more that day, 513 on 14/10). Those two Stats rows (`/ao/*` `view` and `tender_view`, `(direct)`, 936 each) were moved to `Exclus` as `burst` with `reclass` and noted in the `Annotations` tab. Defence in depth for crawlers that hide who they are: mesure.js v3 sends `fp`, an 8-hex FNV hash of the user agent, language, screen size and the current hour (it changes every hour). The backend uses it only as a CacheService key (≤ 1 h, never written to the sheet, no IP). More than 8 distinct tender pages in one minute, or more than 30 in one hour with no `filter_use` / `search_use` / `official_click` / `cta_click`, makes the window a `burst`: its hits go to `Exclus`, and the hits of that window already counted are moved there too. Without `fp` (an old cached snippet) only the minute rule applies, on a coarse device + source key. mesure.js v3 also flags a `Headless` client-hints brand, an empty `navigator.languages` and more tools and crawlers (`facebookexternalhit`, `meta-externalagent`, `python`, `curl`, `wget`, `cypress`…). Checked by `tests/burst_check.mjs` (fake Apps Script).
Behaviour analytics and A/B framework (Octave CRO): `static/cro.js` and `gas/src/Cro.js` are vendored byte-identical from `octave-checkout` (`gas/web/cro.js`, `gas/src/Cro.js`; never edit the copies). `cro.js` is loaded on every page (`data-site="veille-ao-afrique"`, `data-cta="[data-mesure],#alerte-form [type=submit]"`) and sends one aggregate batch per page (`track` with `kind:"cro"`): scroll depth, sections reached (`id` / `data-section`), time to first CTA click, forms started/submitted and the name of the last field of an abandoned form, outbound domains, error hashes, Core Web Vitals, rage clicks; daily counters in the `Comportement` and `Experiences` tabs. Goals `signup` and `preorder` fire on a successful sign-up / pre-registration (`static/alertes.js`). No A/B test runs here (`CRO_EXPERIMENTS_ = {}`, no `OCTAVE_XP`). Tender pages are collapsed to `/ao/*` like `Stats` (`croPage_`). Extra actions: `cro` (summary, key whose SHA-256 is in the Script Property `CRO_KEY_SHA256`), `cro_init` (POST, registers that key once); `stats` also returns `cro` for the day.

```bash
cd gas && ~/.local/share/octave-clasp/node_modules/.bin/clasp push --force
~/.local/share/octave-clasp/node_modules/.bin/clasp deploy -i "$(node -e "console.log(require('./.deployment.json').deploymentId)")"
```

## Automation

`.github/workflows/update.yml`: 05:20 and 17:20 UTC (backup crons at :41 every 2 h run only if that refresh is missing), tests → fetch → commit `data/` → build → GitHub Pages → IndexNow.

## Tests

`tests/` unit tests on trimmed fixtures. `e2e/` Playwright checks on the live site (390 px and 1440 px): fresh data, filters, form posting to the Sheet, tracking counters. They set `octave_notrack=1` (query or localStorage) so their hits land in the excluded counters, never in visits. `tests/mesure_check.mjs` checks the snippet's bot, webdriver, prerender and opt-out rules under Node. `tests/test_cro.py` runs the vendored `tests/cro.check.mjs` on `static/cro.js` and `tests/cro-gas.check.mjs` on `gas/src/Cro.js`, and checks the wiring (tag on every page, routes, `/ao/*` pages).

## Limits

Up to 12 h behind the portal; rectifications between two runs can be missed; sectors are keyword-based; national portals of Senegal, Côte d'Ivoire and others are not covered yet.
