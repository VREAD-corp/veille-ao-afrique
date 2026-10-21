// E-mail alerts of gas/src/Alerts.js with fake Apps Script services: node tests/alerts_check.mjs (exit 0 = ok).
// Checks: matching on sectors, regions and zone; one e-mail per address with only the notices first seen since the
// last one; nothing sent when nothing is new; tests, withdrawn and pre-registration rows never mailed; weekly
// frequency; sender name and reply-to on Jalonel, no Vread anywhere; unsubscribe link; run log without addresses.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

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
    MailApp: { getRemainingDailyQuota: () => quota, sendEmail: (m) => { quota--; sent.push(m); } },
    UrlFetchApp: { fetch: (url) => { assert.ok(url.startsWith('https://ao-afrique.jalonel.com/data/alertes.json')); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(feed()) }; } },
    Utilities: {
      formatDate: (d) => new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10),
      computeHmacSha256Signature: (t, k) => [...crypto.createHmac('sha256', k).update(t).digest()].map((b) => (b > 127 ? b - 256 : b)),
      computeDigest: (_a, text) => [...crypto.createHash('sha256').update(String(text)).digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: () => crypto.randomUUID(),
    },
  };
  vm.runInNewContext(code + '\n' + cro + '\n' + alerts + "\n;var LINK_KEY_ = 'test-link-key';\nnow_ = function () { return new Date(globalThis.__now()); };\nglobalThis.R = { route_, sendAlerts, previewAlerts, hmac_ };", Object.assign(ctx, { globalThis: ctx }));
  ctx.__now = () => now;
  const table = (name) => { const s = tabs.get(name); if (!s) return []; const [h, ...r] = s.rows; return r.map((row) => Object.fromEntries(h.map((k, i) => [k, row[i]]))); };
  return { R: ctx.R, sent, table, tick: (ms) => { now += ms; }, setNow: (iso) => { now = Date.parse(iso); } };
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

// Dry run: nothing sent, nothing written.
const pv = g.R.previewAlerts();
assert.equal(g.sent.length, 0);
assert.equal(pv.preview.length, 2);
assert.equal(g.table('Alertes_envois').length, 0);

// 1st run: a gets notices 2 and 3 (first seen from the day of the sign-up, BTP, Casablanca-Settat), b gets the BM one.
let s = g.R.sendAlerts();
assert.equal(s.sent, 2);
assert.equal(s.subscribers, 3, 'test, withdrawn and pre-registration rows left out');
assert.equal(s.nothing_new, 1);
const a = g.sent.find((m) => m.to === 'a@entreprise.ma');
assert.ok(a.body.includes('Avis 2') && a.body.includes('Avis 3'));
assert.ok(!a.body.includes('Avis 1') && !a.body.includes('Avis 4') && !a.body.includes('Avis 5') && !a.body.includes('Avis 6'));
assert.match(a.subject, /^2 nouveaux appels d’offres pour vos critères/);
assert.equal(a.name, 'Veille AO Afrique (Jalonel)');
assert.equal(a.replyTo, 'contact@jalonel.com');
assert.ok(a.body.includes('depuis votre inscription') && a.body.includes('BTP et génie civil'));
assert.ok(a.body.includes('?action=unsubscribe&email=a%40entreprise.ma&t=' + g.R.hmac_('a@entreprise.ma')));
assert.ok(a.htmlBody.includes('https://ao-afrique.jalonel.com/ao/ma-x-3-avis/?utm_source=alerte'));
for (const m of g.sent) assert.ok(!/vread/i.test(m.body + m.htmlBody + m.name + m.subject), 'no Vread mention');
const b = g.sent.find((m) => m.to === 'b@entreprise.sn');
assert.ok(b.body.includes('Avis 6') && b.body.includes('Sénégal') && !b.body.includes('Avis 3'));
const runs = g.table('Alertes_envois');
assert.equal(runs.length, 1);
assert.ok(!JSON.stringify(runs).includes('@entreprise'), 'run log carries no address');
assert.deepEqual(JSON.parse(g.R.route_({ action: 'alerts_status' }, null).s).alerts.ok, true);

// Same day again: nothing new for anyone.
s = g.R.sendAlerts();
assert.equal(s.sent, 0);

// Next day: a new BTP notice in Casablanca reaches a only; b (weekly) waits.
g.setNow('2026-10-22T07:15:00Z');
notices = notices.concat([n(7, '2026-10-22'), n(8, '2026-10-22', { x: 'BM', k: 'Bénin', r: [] })]);
s = g.R.sendAlerts();
assert.equal(s.sent, 1);
assert.equal(s.weekly_wait, 1);
const a2 = g.sent.at(-1);
assert.equal(a2.to, 'a@entreprise.ma');
assert.ok(a2.body.includes('Avis 7') && !a2.body.includes('Avis 3') && a2.body.includes('depuis notre dernier envoi'));
assert.match(a2.subject, /^1 nouvel appel d’offres/);

// A week later b gets the Bénin notice.
g.setNow('2026-10-28T07:15:00Z');
s = g.R.sendAlerts();
assert.ok(g.sent.at(-1).to === 'b@entreprise.sn' && g.sent.at(-1).body.includes('Avis 8') && !g.sent.at(-1).body.includes('Avis 6'));

// Unsubscribe link withdraws the address: no more e-mail.
const page = g.R.route_({ action: 'unsubscribe', email: 'a@entreprise.ma', t: g.R.hmac_('a@entreprise.ma') }, null);
assert.match(page.h, /ne recevrez plus rien/);
notices = notices.concat([n(9, '2026-10-29')]);
g.setNow('2026-10-29T07:15:00Z');
const before = g.sent.length;
s = g.R.sendAlerts();
assert.equal(g.sent.length, before, 'withdrawn address not mailed');

// Feed down: the run throws (Google notifies the owner) and logs the error.
const g2 = gas([], () => { throw new Error('down'); });
assert.throws(() => g2.R.sendAlerts(), /alertes : 1 erreur/);
assert.equal(g2.table('Alertes_envois')[0].errors, 1);
console.log('alerts: ok');
