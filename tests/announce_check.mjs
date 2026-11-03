// Announcement « fin du test gratuit » of gas/src/Announce.js with fake Apps Script services:
// node tests/announce_check.mjs (exit 0 = ok).
// Checks: token; announce_plan writes nothing; real recipients = active free alert sign-ups established outside the EU
// (declared country, else African ccTLD), never test, withdrawn, pre-registration-only or paid addresses; test mode =
// the `only` test sign-up alone; the e-mail is the draft word for word (date, criteria, tracked link, unsubscribe link
// that works); one real run only (start claimed once, even after a failed run); test runs never set the marker.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const TOKEN = 't'.repeat(40);
const src = (f) => fs.readFileSync(new URL('../gas/src/' + f, import.meta.url), 'utf8');
const HEADER = ['at', 'email', 'kind', 'plan', 'company', 'company_country', 'sectors', 'countries', 'regions', 'frequency', 'consent_version', 'consent_text', 'page', 'source', 'test', 'withdrawn_at', 'id'];
const SUBS = ['at', 'email', 'plan', 'order_id', 'payment_intent', 'paid_at', 'start', 'until', 'test', 'detail'];

function gas(signups, subs = []) {
  const tabs = new Map();
  let writes = 0;
  const sheet = () => {
    const rows = [];
    const sh = {
      rows,
      getLastRow: () => rows.length,
      appendRow: (r) => { writes++; rows.push(r.slice()); },
      setFrozenRows() {},
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
        setValues: (v) => { writes++; v.forEach((row, i) => { const t = (rows[r - 1 + i] ||= []); row.forEach((x, j) => { t[c - 1 + j] = x; }); }); return sh.getRange(r, c, nr, nc); },
        setValue: (x) => { writes++; (rows[r - 1] ||= [])[c - 1] = x; return sh.getRange(r, c, nr, nc); },
        setNumberFormat() { return this; },
        setFontWeight() { return this; },
      }),
    };
    return sh;
  };
  const ss = {
    getId: () => 'sheet1', getUrl: () => 'https://x', getSheets: () => [{}],
    getSheetByName: (n) => tabs.get(n) || null,
    insertSheet: (n) => { const s = sheet(); tabs.set(n, s); return s; },
    deleteSheet() {},
  };
  const ins = ss.insertSheet('Inscriptions');
  ins.rows.push(HEADER);
  signups.forEach((o) => ins.rows.push(HEADER.map((h) => o[h] ?? '')));
  const ab = ss.insertSheet('Abonnements');
  ab.rows.push(SUBS);
  subs.forEach((o) => ab.rows.push(SUBS.map((h) => o[h] ?? '')));
  const props = new Map([['SHEET_ID', 'sheet1']]);
  let propWrites = 0;
  const ctx = {
    console: { log() {}, error: console.error, warn() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => { propWrites++; props.set(k, v); } }) },
    SpreadsheetApp: { openById: () => ss, create: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    HtmlService: { createHtmlOutput: (h) => ({ h, setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }), XFrameOptionsMode: {} },
    MailApp: new Proxy({}, { get: () => { throw new Error('MailApp must never be used'); } }),
    UrlFetchApp: new Proxy({}, { get: () => { throw new Error('UrlFetchApp needs a scope the script does not have'); } }),
    Utilities: {
      formatDate: (d) => new Date(d.getTime() + 1 * 3600e3).toISOString().slice(0, 10),
      computeHmacSha256Signature: (t, k) => [...crypto.createHmac('sha256', k).update(t).digest()].map((b) => (b > 127 ? b - 256 : b)),
      computeDigest: (_a, text) => [...crypto.createHash('sha256').update(String(text)).digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: () => crypto.randomUUID(),
    },
  };
  // Apps Script loads the files in name order: Alerts, Announce, Code, Cro.
  vm.runInNewContext(src('Alerts.js') + '\n' + src('Announce.js') + '\n' + src('Code.js') + '\n' + src('Cro.js') +
    "\n;var LINK_KEY_ = 'test-link-key'; var ALERTS_TOKEN_ = '" + TOKEN + "';\nnow_ = function () { return new Date('2026-11-04T09:00:00Z'); };\nglobalThis.R = { route_, doPost, hmac_, announceRegion_ };",
    Object.assign(ctx, { globalThis: ctx }));
  const table = (name) => { const s = tabs.get(name); if (!s) return []; const [h, ...r] = s.rows; return r.map((row) => Object.fromEntries(h.map((k, i) => [k, row[i]]))); };
  const post = (body) => JSON.parse(ctx.R.route_({}, body).s);
  return { R: ctx.R, post, table, props, writes: () => writes + propWrites };
}

const consent = { consent_version: 'v2', consent_text: 'x'.repeat(50) };
const row = (email, over = {}) => ({ at: '2026-10-18T09:00:00Z', email, kind: 'alertes', sectors: 'btp', countries: 'maroc', regions: '', frequency: 'quotidien', ...consent, ...over });
const g = gas([
  row('ma@entreprise.ma'),                                                     // empty country, .ma -> kept
  row('decl@gmail.com', { company_country: 'maroc', sectors: 'btp, sante' }),  // declared Morocco -> kept
  row('autre@entreprise.com', { company_country: 'autre' }),                   // declared « autre » -> kept
  row('afr@cabinet.sn', { company_country: 'autre-afrique', countries: 'afrique-francophone' }),
  row('fr@entreprise.fr', { company_country: 'france' }),                       // EU declared -> out
  row('ch@entreprise.ch', { company_country: 'autre-europe' }),                 // maybe outside the EU, unknown -> out
  row('webmail@gmail.com'),                                                    // no clue -> out
  row('be@bureau.be'),                                                         // EU ccTLD -> out
  row('reunion@societe.re'),                                                   // French overseas -> out
  row('paid@entreprise.ma'),                                                   // paid (running) -> out
  row('expired@entreprise.ma'),                                                // paid once (period over) -> out
  row('gone@entreprise.ma', { withdrawn_at: '2026-10-25T00:00:00Z' }),          // withdrawn -> out
  row('pre@entreprise.ma', { kind: 'preinscription', plan: 'pro-79' }),         // pre-registration only -> out
  row('test@entreprise.ma', { test: 'oui' }),                                  // test row -> test mode only
  row('test2@entreprise.ma', { test: 'oui', withdrawn_at: '2026-10-22T10:50:00Z' }), // withdrawn test row -> still a test recipient
  row('gonereal@entreprise.ma', { withdrawn_at: '2026-10-22T10:50:00Z' }),     // withdrawn real row -> never
  row('later@entreprise.tn', { at: '2026-10-20T09:00:00Z' }),                  // two rows: since = first, criteria = latest
  row('later@entreprise.tn', { at: '2026-10-22T09:00:00Z', sectors: 'sante', countries: 'tunisie', company_country: 'autre-afrique' }),
  row('later@entreprise.tn', { at: '2026-10-21T09:00:00Z', company_country: 'france' }), // older (by `at`) than the 22/10 row
], [
  { at: '2026-10-24T13:00:00Z', email: 'paid@entreprise.ma', plan: 'essentiel-39', start: '2026-11-03', until: '2027-02-02' },
  { at: '2026-01-01T13:00:00Z', email: 'expired@entreprise.ma', plan: 'pro-79', start: '2026-01-01', until: '2026-03-31' },
  { at: '2026-10-24T13:00:00Z', email: 'ma@entreprise.ma', plan: 'pro-79', start: '2026-11-03', until: '2027-02-02', test: 'oui' }, // test order: ignored
]);
const SECTORS = { btp: 'BTP et génie civil', sante: 'Santé' };

// Token, method, mode.
assert.equal(g.post({ action: 'announce_plan', token: 'nope', mode: 'real' }).error, 'forbidden');
assert.equal(g.post({ action: 'announce_confirm', mode: 'real', stage: 'start' }).error, 'forbidden');
assert.equal(JSON.parse(g.R.route_({ action: 'announce_plan', token: TOKEN, mode: 'real' }, null).s).error, 'method_not_allowed');
assert.equal(JSON.parse(g.R.route_({ action: 'announce_confirm', token: TOKEN, mode: 'real', stage: 'start' }, null).s).error, 'method_not_allowed');
assert.equal(g.post({ action: 'announce_plan', token: TOKEN, mode: 'x' }).error, 'bad_request');
assert.equal(g.post({ action: 'announce_plan', token: TOKEN, mode: 'test' }).error, 'bad_request', 'test mode needs `only`');
assert.equal(g.post({ action: 'announce_confirm', token: TOKEN, mode: 'real', stage: 'x' }).error, 'bad_request');

// The plan is read-only.
const w0 = g.writes();
const plan = g.post({ action: 'announce_plan', token: TOKEN, mode: 'real', sectors: SECTORS });
g.post({ action: 'announce_plan', token: TOKEN, mode: 'test', only: 'test@entreprise.ma', sectors: SECTORS });
assert.equal(g.writes(), w0, 'announce_plan writes nothing');
assert.equal(g.table('Annonces_envois').length, 0);

// Recipients.
assert.equal(plan.ok, true);
assert.equal(plan.already, null);
assert.deepEqual(plan.mails.map((m) => m.email).sort(), ['afr@cabinet.sn', 'autre@entreprise.com', 'decl@gmail.com', 'later@entreprise.tn', 'ma@entreprise.ma']);
assert.equal(plan.subscribers, 12, 'active real alert sign-ups (not test, withdrawn or pre-registration)');
assert.deepEqual(plan.excluded, { paid: 2, eu: 2, unknown: 3 }, JSON.stringify(plan.excluded));
assert.deepEqual([plan.from, plan.sender, plan.reply_to], ['alertes@jalonel.com', 'Veille AO Afrique (Jalonel)', 'contact@jalonel.com']);
{
  const r = g.R.announceRegion_;
  assert.equal(r('', 'a@b.ma'), 'outside-eu');
  assert.equal(r('', 'a@b.MA'), 'outside-eu');
  assert.equal(r('', 'a@b.fr'), 'unknown');
  assert.equal(r('', 'a@gmail.com'), 'unknown');
  assert.equal(r('', 'a@b.re'), 'unknown');
  assert.equal(r('France', 'a@b.ma'), 'eu', 'the declared country wins over the domain');
  assert.equal(r('autre-europe', 'a@b.ch'), 'eu');
  assert.equal(r('autre', 'a@b.fr'), 'outside-eu');
}

// The e-mail: the draft word for word, with the three fields.
const m = plan.mails.find((x) => x.email === 'later@entreprise.tn');
const URL_OFFERS = 'https://ao-afrique.jalonel.com/alertes/?utm_source=annonce&utm_medium=email&utm_campaign=fin-test#offres';
const unsub = 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec?action=unsubscribe&email=later%40entreprise.tn&t=' + g.R.hmac_('later@entreprise.tn');
assert.equal(m.subject, 'Fin du test gratuit : ce qui change pour vous');
assert.equal(m.unsubscribe, unsub);
assert.equal(m.text, `Bonjour,

Vous recevez les alertes de Veille AO Afrique depuis le 20 octobre 2026 (Santé ; Tunisie). Le test gratuit s'est terminé le 3 novembre 2026. Nous aurions dû vous l'écrire avant : voici ce qui change.

Pour vous, rien pour l'instant. Vos alertes gratuites continuent, avec les mêmes critères, et vous n'avez rien à faire. Rien ne vous sera facturé sans votre accord.

Ce qui est nouveau : deux formules payantes, pour avoir 3 mois d'alertes garanties.
- Essentiel, 39 € pour 3 mois : les consultations du portail marocain des marchés publics.
- Pro, 79 € pour 3 mois : en plus, les portails nationaux du Bénin et de la Tunisie et les avis en français de la Banque mondiale dans les pays d'Afrique francophone.

Paiement unique par carte, sans renouvellement automatique. Remboursement intégral sur simple demande dans les 14 jours. Réservé aux entreprises établies hors de l'Union européenne ; prix sans TVA française. Les formules et les conditions de vente : ${URL_OFFERS}

Une question, un devis pour votre service achats : répondez à ce message.

Veille AO Afrique, un service Jalonel

Se désinscrire en un clic : ${unsub}
Veille AO Afrique est un service Jalonel, marque de READ FRANCE SAS (SIREN 988 741 773), 11 rue Rouvet, 75019 Paris. Contact : contact@jalonel.com.`);
// The same text in the draft file, when it is there (local runs): body between the ``` fences, fields filled.
{
  const draft = `${process.env.HOME}/.local/share/octave/plan-attention/AOAF-MAIL-FIN-TEST.md`;
  if (fs.existsSync(draft)) {
    const body = fs.readFileSync(draft, 'utf8').split('```')[1].trim()
      .replace('{date_inscription}', '20 octobre 2026').replace('{criteres}', 'Santé ; Tunisie').replace('{lien_desinscription}', unsub);
    assert.equal(m.text, body, 'e-mail = draft');
    assert.ok(fs.readFileSync(draft, 'utf8').includes('**Objet :** ' + m.subject));
  }
}
const d = plan.mails.find((x) => x.email === 'decl@gmail.com');
assert.ok(d.text.includes('depuis le 18 octobre 2026 (BTP et génie civil, Santé ; Maroc, toutes régions)'));
assert.ok(plan.mails.find((x) => x.email === 'afr@cabinet.sn').text.includes('(BTP et génie civil ; Afrique francophone (Banque mondiale))'));
// Without sector names the codes stay readable.
assert.ok(g.post({ action: 'announce_plan', token: TOKEN, mode: 'real' }).mails.find((x) => x.email === 'ma@entreprise.ma').text.includes('(btp ; Maroc, toutes régions)'));
// HTML: same sentences, blocks on their own lines, tracked link, unsubscribe link; no Vread anywhere.
const flat = m.html.replace(/<[^>]+>/g, '');
for (const s of ['Pour vous, rien pour l\'instant.', 'Essentiel, 39 € pour 3 mois', 'Pro, 79 € pour 3 mois', 'répondez à ce message.', 'SIREN 988 741 773']) assert.ok(flat.includes(s), s);
assert.ok(m.html.includes('href="' + URL_OFFERS.replace(/&/g, '&amp;') + '"'));
assert.ok(m.html.includes('href="' + unsub.replace(/&/g, '&amp;') + '">Se désinscrire en un clic</a>'));
assert.ok(!/\.[A-ZÀ-Ý]/.test(flat), 'no two sentences glued once the tags are stripped');
for (const x of plan.mails) assert.ok(!/vread|gmail\.com>|octave/i.test(x.subject + x.html.replace(/gmail\.com/g, '') + x.text.replace(/gmail\.com/g, '')), 'no Vread');
// The unsubscribe link works (GET and one-click POST).
assert.match(g.R.route_({ action: 'unsubscribe', email: 'later@entreprise.tn', t: g.R.hmac_('later@entreprise.tn') }, null).h, /ne recevrez plus rien/);
assert.ok(!g.post({ action: 'announce_plan', token: TOKEN, mode: 'real' }).mails.some((x) => x.email === 'later@entreprise.tn'), 'withdrawn: no announcement');

// Test mode: the `only` test sign-up alone, whatever its country; nothing for a real or unknown address.
const t = g.post({ action: 'announce_plan', token: TOKEN, mode: 'test', only: 'TEST@entreprise.ma', sectors: SECTORS });
assert.deepEqual(t.mails.map((x) => x.email), ['test@entreprise.ma']);
assert.equal(t.mails[0].subject, 'Fin du test gratuit : ce qui change pour vous');
assert.equal(g.post({ action: 'announce_plan', token: TOKEN, mode: 'test', only: 'ma@entreprise.ma' }).mails.length, 0, 'a real address is never a test recipient');
assert.deepEqual(g.post({ action: 'announce_plan', token: TOKEN, mode: 'test', only: 'test2@entreprise.ma' }).mails.map((x) => x.email), ['test2@entreprise.ma'], 'our withdrawn test address still gets the test e-mail');
assert.equal(g.post({ action: 'announce_plan', token: TOKEN, mode: 'test', only: 'gonereal@entreprise.ma' }).mails.length, 0, 'never a withdrawn real address');
assert.equal(g.post({ action: 'announce_plan', token: TOKEN, mode: 'real', only: 'ma@entreprise.ma' }).mails.length, 4, '`only` ignored in real mode');

// Test runs: start and done never set the marker; one row per run in Annonces_envois.
assert.equal(g.post({ action: 'announce_confirm', token: TOKEN, mode: 'test', stage: 'start', planned: 1 }).ok, true);
assert.equal(g.post({ action: 'announce_confirm', token: TOKEN, mode: 'test', stage: 'done', planned: 1, sent: 1, failed: [] }).sent, 1);
assert.equal(g.post({ action: 'announce_confirm', token: TOKEN, mode: 'test', stage: 'start', planned: 1 }).ok, true, 'test runs can repeat');
assert.equal(g.props.get('ANNOUNCE_FIN_TEST'), undefined);
assert.equal(g.table('Annonces_envois').length, 1);
assert.match(g.table('Annonces_envois')[0].detail, /^annonce fin-test-2026-11, mode test, smtp alertes@jalonel\.com/);

// Real run: `done` without `start` refused; `start` claimed once; the plan then answers `already` and no e-mail.
assert.equal(g.post({ action: 'announce_confirm', token: TOKEN, mode: 'real', stage: 'done', sent: 0 }).error, 'bad_request');
const s1 = g.post({ action: 'announce_confirm', token: TOKEN, mode: 'real', stage: 'start', planned: 4 });
assert.equal(s1.ok, true);
assert.equal(g.post({ action: 'announce_confirm', token: TOKEN, mode: 'real', stage: 'start', planned: 4 }).error, 'already_sent');
const p2 = g.post({ action: 'announce_plan', token: TOKEN, mode: 'real', sectors: SECTORS });
assert.equal(p2.mails.length, 0);
assert.equal(p2.already.started_at, s1.started_at);
assert.equal(p2.already.done, false, 'a run that died after `start` still blocks a second one');
const dn = g.post({ action: 'announce_confirm', token: TOKEN, mode: 'real', stage: 'done', planned: 4, sent: 3, failed: [{ email: 'afr@cabinet.sn', error: '550 refused\nx' }] });
assert.deepEqual([dn.sent, dn.errors], [3, 1]);
assert.equal(g.post({ action: 'announce_confirm', token: TOKEN, mode: 'real', stage: 'done', sent: 3 }).error, 'bad_request', 'done once');
const mk = JSON.parse(g.props.get('ANNOUNCE_FIN_TEST'));
assert.deepEqual([mk.done, mk.sent, mk.errors, mk.planned], [true, 3, 1, 4]);
const log = g.table('Annonces_envois').at(-1);
assert.deepEqual([log.mode, log.planned, log.sent, log.errors], ['real', 4, 3, 1]);
assert.match(log.detail, /a…@cabinet\.sn: 550 refused x/);
assert.ok(!/[a-z0-9]@(entreprise|cabinet|gmail)/.test(JSON.stringify(g.table('Annonces_envois'))), 'log without addresses');
assert.equal(g.post({ action: 'announce_plan', token: TOKEN, mode: 'real' }).already.done, true);
// Test mode still works after the real run (rendering checks).
assert.equal(g.post({ action: 'announce_plan', token: TOKEN, mode: 'test', only: 'test@entreprise.ma' }).mails.length, 1);
// The daily alerts are untouched by all this.
assert.equal(JSON.parse(g.R.route_({ action: 'alerts_status' }, null).s).alerts, null);
assert.ok(!/MailApp\.|GmailApp|UrlFetchApp/.test(src('Announce.js')), 'Announce.js never sends');
console.log('announce: ok');
