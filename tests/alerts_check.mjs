// E-mail alerts of gas/src/Alerts.js with fake Apps Script services: node tests/alerts_check.mjs (exit 0 = ok).
// Checks: matching on sectors, regions and zone; one e-mail per address with only the notices first seen since the
// last one; nothing sent when nothing is new; tests, withdrawn and pre-registration rows never mailed in real mode
// (and only test rows in test mode); weekly frequency; sender alertes@jalonel.com, reply-to on Jalonel, no Vread
// anywhere; unsubscribe link (GET and one-click POST); token required; run log without addresses; MailApp never used.
// The SMTP side (aoafrique/alerts.py) is simulated by send(): alerts_plan, then alerts_confirm.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const TOKEN = 't'.repeat(40);

const code = fs.readFileSync(new URL('../gas/src/Code.js', import.meta.url), 'utf8');
const cro = fs.readFileSync(new URL('../gas/src/Cro.js', import.meta.url), 'utf8');
const alerts = fs.readFileSync(new URL('../gas/src/Alerts.js', import.meta.url), 'utf8');
const HEADER = ['at', 'email', 'kind', 'plan', 'company', 'company_country', 'sectors', 'countries', 'regions', 'frequency', 'consent_version', 'consent_text', 'page', 'source', 'test', 'withdrawn_at', 'id'];

function gas(signups, feed) {
  const tabs = new Map();
  const sheet = () => {
    const rows = [];
    const sh = {
      rows,
      getLastRow: () => rows.length,
      appendRow: (r) => { rows.push(r.slice()); },
      setFrozenRows() {},
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
        setValues: (v) => { v.forEach((row, i) => { const t = (rows[r - 1 + i] ||= []); row.forEach((x, j) => { t[c - 1 + j] = x; }); }); return sh.getRange(r, c, nr, nc); },
        setValue: (x) => { (rows[r - 1] ||= [])[c - 1] = x; return sh.getRange(r, c, nr, nc); },
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
  ins.appendRow(HEADER);
  signups.forEach((o) => ins.appendRow(HEADER.map((h) => o[h] ?? '')));
  const props = new Map([['SHEET_ID', 'sheet1']]);
  const sent = [];
  let quota = 100;
  let now = Date.parse('2026-10-21T07:15:00Z');
  const ctx = {
    console: { log() {}, error: console.error, warn() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    SpreadsheetApp: { openById: () => ss, create: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    HtmlService: { createHtmlOutput: (h) => ({ h, setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }), XFrameOptionsMode: {} },
    MailApp: new Proxy({}, { get: () => { throw new Error('MailApp must never be used'); } }),
    UrlFetchApp: new Proxy({}, { get: () => { throw new Error('UrlFetchApp needs a scope the script does not have'); } }),
    Utilities: {
      formatDate: (d) => new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10),
      computeHmacSha256Signature: (t, k) => [...crypto.createHmac('sha256', k).update(t).digest()].map((b) => (b > 127 ? b - 256 : b)),
      computeDigest: (_a, text) => [...crypto.createHash('sha256').update(String(text)).digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: () => crypto.randomUUID(),
    },
  };
  vm.runInNewContext(code + '\n' + cro + '\n' + alerts + "\n;var LINK_KEY_ = 'test-link-key'; var ALERTS_TOKEN_ = '" + TOKEN + "';\nnow_ = function () { return new Date(globalThis.__now()); };\nglobalThis.R = { route_, doPost, hmac_, alertMail_ };", Object.assign(ctx, { globalThis: ctx }));
  ctx.__now = () => now;
  const table = (name) => { const s = tabs.get(name); if (!s) return []; const [h, ...r] = s.rows; return r.map((row) => Object.fromEntries(h.map((k, i) => [k, row[i]]))); };
  const post = (body) => JSON.parse(ctx.R.route_({}, body).s);
  // What aoafrique/alerts.py does: plan, "send" each e-mail, confirm.
  const send = (mode = 'real', fail = []) => {
    const plan = post({ action: 'alerts_plan', token: TOKEN, mode, feed: feed() });
    if (!plan.ok) return plan;
    const ok = [], ko = [];
    for (const m of plan.mails) {
      if (fail.includes(m.email)) { ko.push({ email: m.email, error: '550 refused' }); continue; }
      sent.push({ ...m, from: plan.from, name: plan.sender, replyTo: plan.reply_to });
      ok.push({ email: m.email, last_first_seen: m.last_first_seen });
    }
    const c = post({ action: 'alerts_confirm', token: TOKEN, mode, sent: ok, failed: ko,
      run: { feed_updated: plan.feed_updated, feed_count: plan.feed_count, subscribers: plan.subscribers, nothing_new: plan.nothing_new, weekly_wait: plan.weekly_wait, detail: plan.detail } });
    return { ...plan, sent: c.sent, errors: c.errors };
  };
  return { R: ctx.R, sent, table, post, send, props, tick: (ms) => { now += ms; }, setNow: (iso) => { now = Date.parse(iso); } };
}

const n = (i, f, over = {}) => ({ i: `ma-x-${i}-avis`, o: `Avis ${i}`, b: 'Commune', s: ['btp'], r: ['casablanca-settat'], k: 'Maroc', x: 'PMMP', d: '2026-11-20T10:00', f, p: ['Casablanca'], ...over });
let notices = [
  n(1, '2026-10-19'), n(2, '2026-10-20'), n(3, '2026-10-21'),
  n(4, '2026-10-21', { s: ['sante'] }),
  n(5, '2026-10-21', { r: ['souss-massa'] }),
  n(6, '2026-10-21', { x: 'BM', k: 'Sénégal', r: [], s: ['btp'] }),
];
const feed = () => ({ updated: '2026-10-21T05:40+00:00', sectors: { btp: 'BTP et génie civil', sante: 'Santé' }, notices });
const consent = { consent_version: 'v2', consent_text: 'x'.repeat(50) };
const g = gas([
  { at: '2026-10-20T09:00:00Z', email: 'a@entreprise.ma', kind: 'alertes', sectors: 'btp', countries: 'maroc', regions: 'casablanca-settat', frequency: 'quotidien', ...consent },
  { at: '2026-10-18T09:00:00Z', email: 'b@entreprise.sn', kind: 'alertes', sectors: '', countries: 'afrique-francophone', regions: '', frequency: 'hebdomadaire', ...consent },
  { at: '2026-10-18T09:00:00Z', email: 'test@entreprise.ma', kind: 'alertes', test: 'oui', ...consent },
  { at: '2026-10-18T09:00:00Z', email: 'gone@entreprise.ma', kind: 'alertes', withdrawn_at: '2026-10-19T00:00:00Z', ...consent },
  { at: '2026-10-18T09:00:00Z', email: 'pre@entreprise.ma', kind: 'preinscription', plan: 'pro-79', ...consent },
  { at: '2026-10-18T09:00:00Z', email: 'none@entreprise.ma', kind: 'alertes', sectors: 'formation', countries: 'maroc', ...consent },
], feed);
// National portals other than Morocco's (Bénin, Tunisie) only reach those who chose that country.
{
  const ctx = {};
  vm.runInNewContext(alerts + '\n;globalThis.M = { alertMatches_, criteriaText_ };', Object.assign(ctx, { globalThis: ctx }));
  const tn = n(90, '2026-10-21', { x: 'TN', k: 'Tunisie', r: [] });
  const sub = (countries) => ({ sectors: [], regions: [], countries });
  assert.equal(ctx.M.alertMatches_(sub(['maroc']), tn), false, 'a Tunisian notice is not sent to Moroccan subscribers');
  assert.equal(ctx.M.alertMatches_(sub(['afrique-francophone']), tn), false);
  assert.equal(ctx.M.alertMatches_(sub(['tunisie']), tn), true);
  assert.equal(ctx.M.alertMatches_(sub(['cote-d-ivoire']), n(91, '2026-10-21', { x: 'BM', k: "Côte d'Ivoire", r: [] })), true);
  assert.equal(ctx.M.alertMatches_(sub(['tunisie']), n(92, '2026-10-21')), false, 'Moroccan notice needs maroc');
  assert.match(ctx.M.criteriaText_(sub(['benin']), {}), /Bénin/);
}

// The plan alone is a dry run: nothing sent, nothing written.
const pv = g.post({ action: 'alerts_plan', token: TOKEN, mode: 'real', feed: feed() });
assert.equal(g.sent.length, 0);
assert.equal(pv.mails.length, 2);
assert.equal(g.table('Alertes_envois').length, 0);
assert.equal(g.table('Alertes_etat').length, 0);

// Token required; plan and confirm only by POST.
assert.equal(g.post({ action: 'alerts_plan', token: 'nope', mode: 'real' }).error, 'forbidden');
assert.equal(g.post({ action: 'alerts_confirm', mode: 'real', sent: [] }).error, 'forbidden');
assert.equal(JSON.parse(g.R.route_({ action: 'alerts_plan', token: TOKEN, mode: 'real' }, null).s).error, 'method_not_allowed');
assert.equal(g.post({ action: 'alerts_plan', token: TOKEN, mode: 'x' }).error, 'bad_request');

// Test mode: only the test row, its state written, no ALERTS_LAST_RUN.
let s = g.send('test');
assert.equal(s.subscribers, 1);
assert.deepEqual(g.sent.map((m) => m.email), ['test@entreprise.ma']);
assert.equal(JSON.parse(g.R.route_({ action: 'alerts_status' }, null).s).alerts, null, 'a test run is not the daily run');
assert.match(g.table('Alertes_envois')[0].detail, /^mode test, smtp alertes@jalonel\.com/);
g.sent.length = 0;

// Test mode narrowed to one address: nobody else.
assert.equal(g.post({ action: 'alerts_plan', token: TOKEN, mode: 'test', only: 'other@entreprise.ma', feed: feed() }).mails.length, 0);
assert.equal(g.post({ action: 'alerts_plan', token: TOKEN, mode: 'real', only: 'a@entreprise.ma', feed: feed() }).subscribers, 3, '`only` ignored in real mode');

// A confirmation for an address that is not an active sign-up of that mode is refused.
const bad = g.post({ action: 'alerts_confirm', token: TOKEN, mode: 'real', sent: [{ email: 'test@entreprise.ma', last_first_seen: '2026-10-21' }, { email: 'x@y.ma', last_first_seen: '2026-10-21' }], run: {} });
assert.equal(bad.sent, 0);
assert.equal(bad.errors, 2);
assert.equal(g.table('Alertes_etat').filter((r) => r.email === 'x@y.ma').length, 0);

// 1st real run: a gets notices 2 and 3 (first seen from the day of the sign-up, BTP, Casablanca-Settat), b gets the BM one.
s = g.send();
assert.equal(s.sent, 2);
assert.equal(s.subscribers, 3, 'test, withdrawn and pre-registration rows left out');
assert.equal(s.nothing_new, 1);
const a = g.sent.find((m) => m.email === 'a@entreprise.ma');
a.body = a.text; a.htmlBody = a.html;
assert.ok(a.body.includes('Avis 2') && a.body.includes('Avis 3'));
assert.equal(a.unsubscribe, 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec?action=unsubscribe&email=a%40entreprise.ma&t=' + g.R.hmac_('a@entreprise.ma'));
assert.ok(!a.body.includes('Avis 1') && !a.body.includes('Avis 4') && !a.body.includes('Avis 5') && !a.body.includes('Avis 6'));
assert.match(a.subject, /^2 nouveaux appels d’offres pour vos critères/);
assert.equal(a.name, 'Veille AO Afrique (Jalonel)');
assert.equal(a.from, 'alertes@jalonel.com');
assert.equal(a.replyTo, 'contact@jalonel.com');
assert.ok(a.body.includes('depuis votre inscription') && a.body.includes('BTP et génie civil'));
assert.ok(a.body.includes('?action=unsubscribe&email=a%40entreprise.ma&t=' + g.R.hmac_('a@entreprise.ma')));
assert.ok(a.htmlBody.includes('https://ao-afrique.jalonel.com/ao/ma-x-3-avis/?utm_source=alerte'));
for (const m of g.sent) assert.ok(!/vread|gmail/i.test(m.text + m.html + m.name + m.subject + m.from + m.replyTo), 'no Vread or Gmail mention');
const b = g.sent.find((m) => m.email === 'b@entreprise.sn');
assert.ok(b.text.includes('Avis 6') && b.text.includes('Sénégal') && !b.text.includes('Avis 3'));
const runs = g.table('Alertes_envois');
assert.equal(runs.length, 3);
assert.ok(!/[a-z0-9]@entreprise/.test(JSON.stringify(runs)), 'run log carries no address (masked only)');
assert.deepEqual(JSON.parse(g.R.route_({ action: 'alerts_status' }, null).s).alerts.ok, true);

// Same day again: nothing new for anyone.
s = g.send();
assert.equal(s.sent, 0);

// Next day: a new BTP notice in Casablanca reaches a only; b (weekly) waits.
g.setNow('2026-10-22T07:15:00Z');
notices = notices.concat([n(7, '2026-10-22'), n(8, '2026-10-22', { x: 'BM', k: 'Bénin', r: [] })]);
s = g.send();
assert.equal(s.sent, 1);
assert.equal(s.weekly_wait, 1);
const a2 = g.sent.at(-1);
assert.equal(a2.email, 'a@entreprise.ma');
assert.ok(a2.text.includes('Avis 7') && !a2.text.includes('Avis 3') && a2.text.includes('depuis notre dernier envoi'));
assert.match(a2.subject, /^1 nouvel appel d’offres/);
// Agreement with the number of notices (singular e-mail of 24 October: « publié … qui correspondent »).
assert.ok(a2.text.includes('Voici l’appel d’offres publié depuis notre dernier envoi qui correspond à vos critères ('), 'singular: correspond');
assert.ok(!/correspondent|publiés|appels/.test(a2.text.split('\n')[2]), 'no plural in the singular intro');
assert.ok(a2.html.includes('qui correspond à vos critères ('));
assert.ok(a.text.includes('Voici les 2 appels d’offres publiés depuis votre inscription qui correspondent à vos critères ('), 'plural: correspondent');
// Deadline and footer never glued together, even once the HTML tags are stripped (« 16 hL’avis officiel fait foi »).
for (const m of [a, a2]) {
  const flat = m.html.replace(/<[^>]+>/g, '');
  assert.ok(!/ h(?:\s?\d\d)?L’avis/.test(flat) && !/\dL’avis/.test(flat), 'HTML without tags: deadline glued to the footer');
  assert.match(flat, /date limite : [^\n]+\n+L’avis officiel fait foi/);
  assert.match(m.text, /\n\nL’avis officiel fait foi/);
  assert.ok(!/[^\s>]L’avis officiel/.test(m.text + m.html));
}
{
  const many = (k) => Array.from({ length: k }, (_, i) => n(100 + i, '2026-10-22', { d: '2026-11-06T16:00' }));
  const sub = { email: 'a@entreprise.ma', sectors: ['btp'], regions: [], countries: ['maroc'], frequency: 'quotidien', since: '2026-10-20T09:00:00Z' };
  const one = g.R.alertMail_(sub, many(1), {}, true);
  assert.equal(one.subject, '1 nouvel appel d’offres pour vos critères – Veille AO Afrique');
  assert.ok(one.body.includes('date limite : 6 novembre 2026 à 16 h\n'));
  assert.ok(one.html.replace(/<[^>]+>/g, '').includes('à 16 h\n'));
  const m26 = g.R.alertMail_(sub, many(26), {}, true);
  assert.match(m26.subject, /^26 nouveaux appels d’offres/);
  assert.ok(m26.body.includes('Et 1 autre : ') && m26.html.includes('<p>Et 1 autre : '), 'Et 1 autre (singular)');
  assert.ok(g.R.alertMail_(sub, many(27), {}, true).body.includes('Et 2 autres : '));
}

// A week later b gets the Bénin notice.
g.setNow('2026-10-28T07:15:00Z');
s = g.send();
assert.ok(g.sent.at(-1).email === 'b@entreprise.sn' && g.sent.at(-1).text.includes('Avis 8') && !g.sent.at(-1).text.includes('Avis 6'));

// One-click unsubscribe (RFC 8058 POST, form body) withdraws the address: no more e-mail.
const page = g.R.doPost({ parameter: { action: 'unsubscribe', email: 'a@entreprise.ma', t: g.R.hmac_('a@entreprise.ma'), 'List-Unsubscribe': 'One-Click' },
  postData: { type: 'application/x-www-form-urlencoded', contents: 'List-Unsubscribe=One-Click' } });
assert.match(page.h, /ne recevrez plus rien/);
assert.match(g.R.route_({ action: 'unsubscribe', email: 'a@entreprise.ma', t: 'bad' }, null).h, /Lien invalide/);
notices = notices.concat([n(9, '2026-10-29')]);
g.setNow('2026-10-29T07:15:00Z');
const before = g.sent.length;
s = g.send();
assert.equal(g.sent.length, before, 'withdrawn address not mailed');

// An SMTP failure is logged (masked address) and makes the public status not ok; the address stays due.
notices = notices.concat([n(10, '2026-10-29', { x: 'BM', k: 'Togo', r: [] })]);
g.setNow('2026-11-05T07:15:00Z');
s = g.send('real', ['b@entreprise.sn']);
assert.equal(s.errors, 1);
assert.match(g.table('Alertes_envois').at(-1).detail, /b…@entreprise\.sn: 550 refused/);
assert.equal(JSON.parse(g.R.route_({ action: 'alerts_status' }, null).s).alerts.ok, false);
assert.equal(g.send().sent, 1, 'retried next run');
const st = JSON.parse(g.R.route_({ action: 'alerts_status' }, null).s);
assert.equal(st.sender, 'alertes@jalonel.com');
assert.ok(!JSON.stringify(st).includes('@entreprise'));

// No feed or a malformed one: alerts_plan fails; malformed notices are dropped.
assert.equal(g.post({ action: 'alerts_plan', token: TOKEN, mode: 'real' }).error, 'feed_unavailable');
assert.equal(g.post({ action: 'alerts_plan', token: TOKEN, mode: 'real', feed: { notices: 'x' } }).error, 'feed_unavailable');
g.setNow('2026-11-06T07:15:00Z');
const odd = g.post({ action: 'alerts_plan', token: TOKEN, mode: 'real', feed: { updated: '', notices: [{ i: '<script>', f: '2026-11-06' }, { ...n(11, '2026-11-06'), o: 42 }] } });
assert.equal(odd.ok, true);
assert.equal(odd.feed_count, 1);
assert.ok(!/MailApp|send_mail/.test(alerts.replace(/no MailApp, no\s+\* send_mail/, '')), 'Alerts.js never sends');
console.log('alerts: ok');
