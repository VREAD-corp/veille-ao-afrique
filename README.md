# Veille AO Afrique

Open public tenders in Morocco and French-language World Bank notices for francophone Africa, refreshed twice a day and published as a static French site with filters, one page per tender, a rule-based summary (no LLM), an e-mail alerts interest form and a paid-tier fake door.

**Site:** https://outils.vread.fr/veille-ao-afrique/
A service of READ FRANCE SAS (SIREN 988 741 773, Paris). Venture AF-XX-04 of Octave's global portfolio (`VREAD-corp/octave-global-ventures`). Independent from the Vread app.

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
- `/alertes/` interest form + « Pré-inscription, sans paiement » for two planned tiers (Essentiel 39 € and Pro 79 € for 3 months, marked « bientôt disponible »). No payment code.
- `/methode/`, `/mentions-legales/`, `/confidentialite/`, `sitemap.xml`, `feed.xml`, IndexNow key file.

## Backend (Apps Script, `gas/`)

A new standalone project `veille-ao-afrique-gas (READ FRANCE SAS)`, scope `spreadsheets` only, its own spreadsheet created on first use. Actions: `track` (cookieless daily counters, same pattern as octave-checkout `Track.js`; hits from crawlers, `navigator.webdriver`, headless browsers and our tests go to a separate `Exclus` tab by reason, prerendered pages count only once opened; a hit without the snippet version `v`, i.e. from an old mesure.js still cached by a crawler, is excluded as `legacy`; the snippet URL carries a content hash), `stats` (token: one day's counted vs excluded views and all counter rows), `signup` (interest form and pre-registration, consent text stored), `unsubscribe`, `admin` (token in the git-ignored `gas/src/Secret.js`).

```bash
cd gas && ~/.local/share/octave-clasp/node_modules/.bin/clasp push --force
~/.local/share/octave-clasp/node_modules/.bin/clasp deploy -i "$(node -e "console.log(require('./.deployment.json').deploymentId)")"
```

## Automation

`.github/workflows/update.yml`: 05:20 and 17:20 UTC (backup crons at :41 every 2 h run only if that refresh is missing), tests → fetch → commit `data/` → build → GitHub Pages → IndexNow.

## Tests

`tests/` unit tests on trimmed fixtures. `e2e/` Playwright checks on the live site (390 px and 1440 px): fresh data, filters, form posting to the Sheet, tracking counters. They set `octave_notrack=1` (query or localStorage) so their hits land in the excluded counters, never in visits. `tests/mesure_check.mjs` checks the snippet's bot, webdriver, prerender and opt-out rules under Node.

## Limits

Up to 12 h behind the portal; rectifications between two runs can be missed; sectors are keyword-based; national portals of Senegal, Côte d'Ivoire and others are not covered yet.
