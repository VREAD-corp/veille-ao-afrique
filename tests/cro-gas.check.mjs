// Behaviour of the Apps Script CRO module (Cro.js) with fake Apps Script services.
// Portable, no dependency: node cro-gas.check.mjs [path/to/Cro.js]   (exit code 0 = ok). Vendored byte-identical.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const file = process.argv[2] || fileURLToPath(new URL('../src/Cro.js', import.meta.url));
const src = fs.readFileSync(file, 'utf8');

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = this.sh.rows[this.r - 1 + i] || []; out.push(Array.from({ length: this.nc }, (_, j) => (row[this.c - 1 + j] ?? ''))); } this.sh.reads++; return out; }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) { assert.equal(v.length, this.nr); v.forEach((row, i) => { assert.equal(row.length, this.nc); const t = (this.sh.rows[this.r - 1 + i] ||= []); row.forEach((x, j) => { t[this.c - 1 + j] = x; }); }); this.sh.writes++; return this; }
  setValue(x) { return this.setValues([[x]]); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}
class Sheet {
  constructor(name, rows = []) { Object.assign(this, { name, rows, reads: 0, writes: 0 }); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map((r) => r.length)); }
  getRange(r, c, nr = 1, nc = 1) { if (typeof r === 'string') return new Range(this, 1, 1, 0, 0); return new Range(this, r, c, nr, nc); }
  setFrozenRows() {}
}
function gas({ sites = ['candadopyme'], experiments, goals, stats, exclus, props = {} } = {}) {
  const sheets = {};
  if (stats) sheets.Stats = new Sheet('Stats', stats);
  if (exclus) sheets.Exclus = new Sheet('Exclus', exclus);
  const book = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = new Sheet(n)) };
  const cache = new Map();
  const ctx = {
    CRO_SITES_: sites, CRO_EXPERIMENTS_: experiments, CRO_GOALS_: goals, croBook_: () => book, Date, JSON, Math, String, Number, Object, Array, RegExp,
    Utilities: {
      formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
      computeDigest: (_a, t) => [...crypto.createHash('sha256').update(t, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  };
  vm.runInNewContext(src, ctx);
  // Plain objects of this realm (deepEqual compares prototypes).
  const api = {};
  for (const f of ['croTrack_', 'croSummary_', 'croAction_', 'croInit_']) api[f] = (...a) => JSON.parse(JSON.stringify(ctx[f](...a)));
  return { ctx: api, sheets, props, cache };
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const batch = (e, o = {}) => ({ action: 'track', kind: 'cro', v: 2, site: 'candadopyme', page: '/candadopyme/oferta/index.html?x=1', device: 'mobile', e, ...o });

// 1. Validation: whitelisted types, keys and values; anything else dropped; bad site/page/old snippet refused.
let g = gas({ experiments: { price: ['a', 'b'] } });
let r = g.ctx.croTrack_(batch([
  ['pv', '', ''], ['scroll', '', '50'], ['scroll', '', '60'], ['section', 'hero', ''], ['form', 'preventa', 'start'], ['abandon', 'preventa', 'rut'],
  ['cta_time', '', '10-30'], ['faq', 'q-precio', ''], ['out', 'sii.cl', ''], ['err', 'a1b2c3d4', ''], ['cwv', 'lcp', 'good'], ['rage', 'button#calc', ''],
  ['xp', 'price', 'a.n'], ['xp', 'price', 'z.n'], ['xp', 'other', 'a.n'], ['email', 'x@y.cl', ''], ['form', 'preventa', 'ana@empresa.cl'],
  ['section', '=HYPERLINK("x")', ''], ['pv', '', ''], 'junk', ['pv'],
]));
assert.deepEqual(r, { ok: true, n: 12, dropped: 9 });
const beh = g.sheets.Comportement.rows, exp = g.sheets.Experiences.rows;
assert.deepEqual(beh[0], ['date', 'site', 'page', 'type', 'key', 'val', 'count', 'mobile', 'desktop', 'updated_at']);
assert.equal(beh.length, 1 + 11);
assert.deepEqual(beh[1].slice(0, 9), [today, 'candadopyme', '/oferta/', 'pv', '', '', 1, 1, 0]);
assert.deepEqual(exp[1].slice(0, 8), [today, 'candadopyme', 'price', 'a', 'n', 1, 1, 0]);
assert.ok(!JSON.stringify(beh).includes('@') && !JSON.stringify(beh).includes('HYPERLINK'), 'no value, no formula');
for (const bad of [{ site: 'other' }, { v: undefined }, { excluded: 'bot' }, { page: 'javascript:alert(1)' }]) assert.equal(g.ctx.croTrack_(batch([['pv', '', '']], bad)).ok, false);
assert.equal(beh.length, 12, 'refused batches write nothing');

// 2. Daily counters: a second batch increments the same rows (one read and one write of the day's block).
const before = g.sheets.Comportement.writes;
g.ctx.croTrack_(batch([['pv', '', ''], ['scroll', '', '50'], ['section', 'faq', '']], { device: 'desktop' }));
assert.equal(beh.length, 13);
assert.deepEqual(beh[1].slice(6, 9), [2, 1, 1]);
assert.equal(g.sheets.Comportement.writes - before, 1, 'one write per batch');
// Rows of an earlier day stay untouched; today's block is found again after the cache is lost.
g.sheets.Comportement.rows.splice(1, 0, ['2020-01-01', 'candadopyme', '/oferta/', 'pv', '', '', 5, 5, 0, 'x']);
g.cache.clear();
g.ctx.croTrack_(batch([['pv', '', '']]));
assert.equal(beh[1][6], 5); assert.equal(beh[2][6], 3); assert.equal(beh.length, 14);

// 3. Cardinality cap: free keys beyond 40 per day × site × page × type fold into "(autre)".
g = gas();
for (let i = 0; i < 45; i++) g.ctx.croTrack_(batch([['out', 'site' + i + '.com', '']]));
const outs = g.sheets.Comportement.rows.filter((x) => x[3] === 'out');
assert.equal(outs.length, 41);
assert.equal(outs.find((x) => x[4] === '(autre)')[6], 5);
// Without CRO_EXPERIMENTS_, no A/B entry is accepted; metrics are whitelisted (built-in + CRO_GOALS_).
assert.equal(g.ctx.croTrack_(batch([['xp', 'hero', 'b.cta']])).n, 0);
g = gas({ experiments: { hero: ['a', 'b'] }, goals: ['preventa'] });
assert.deepEqual(g.ctx.croTrack_(batch([['xp', 'hero', 'b.cta'], ['xp', 'hero', 'b.preventa'], ['xp', 'hero', 'b.anything']])), { ok: true, n: 2, dropped: 1 });

// 4. Summary: behaviour per site and page, forms with the worst field, A/B per variant, the host's Stats funnel.
g = gas({
  experiments: { price: ['a', 'b'] }, goals: ['preventa'],
  stats: [['date', 'site', 'page', 'event', 'variant', 'source', 'medium', 'campaign', 'count', 'mobile', 'desktop', 'updated_at'],
    ['2020-01-01', 'candadopyme', '/', 'view', 'a', '(direct)', '', '', 50, 0, 0, ''],
    [today, 'candadopyme', '/', 'view', 'a', '(direct)', '', '', 10, 0, 0, ''], [today, 'candadopyme', '/', 'view', 'b', 'google.com', '', '', 7, 0, 0, ''],
    [today, 'candadopyme', '/oferta/', 'preorder', 'b', '(serveur)', '', '', 2, 0, 0, '']],
  exclus: [['date', 'site', 'page', 'event', 'detail', 'reason', 'count', 'mobile', 'desktop', 'updated_at'], [today, 'candadopyme', '/', 'view', '', 'bot', 4, 0, 0, '']],
});
g.ctx.croTrack_(batch([['pv', '', ''], ['scroll', '', '25'], ['form', 'preventa', 'start'], ['abandon', 'preventa', 'rut'], ['cwv', 'inp', 'poor'], ['xp', 'price', 'a.n'], ['xp', 'price', 'a.cta']]));
g.ctx.croTrack_(batch([['pv', '', ''], ['form', 'preventa', 'start'], ['form', 'preventa', 'submit'], ['xp', 'price', 'b.n'], ['xp', 'price', 'b.preventa']]));
g.ctx.croTrack_(batch([['pv', '', ''], ['err', 'ff00', '']], { page: '/candadopyme/' }));
const s = g.ctx.croSummary_(today, today).sites.candadopyme;
assert.equal(s.pv, 3); assert.equal(s.pages['/oferta/'].pv, 2); assert.equal(s.pages['/oferta/'].scroll['25'], 1);
assert.deepEqual(s.forms['/oferta/ preventa'], { page: '/oferta/', form: 'preventa', start: 2, submit: 1, abandon: 1, fields: { rut: 1 } });
assert.deepEqual(s.experiments.price, { a: { n: 1, cta: 1 }, b: { n: 1, preventa: 1 } });
assert.deepEqual(s.funnel, { view: 17, preorder: 2 }, 'Stats funnel of the period only');
assert.deepEqual(s.funnel_by_variant, { a: { view: 10 }, b: { view: 7, preorder: 2 } });
assert.equal(s.excluded_views, 4); assert.equal(s.errors.ff00, 1); assert.equal(s.cwv.inp.poor, 1);

// 5. Key: set once (hash only), required for the summary, refused afterwards.
const key = crypto.randomBytes(24).toString('base64url');
assert.deepEqual(g.ctx.croAction_({ key }), { ok: false, error: 'forbidden' });
assert.equal(g.ctx.croInit_({ key: 'short' }).ok, false);
assert.deepEqual(g.ctx.croInit_({ key }), { ok: true, set: true });
assert.equal(g.props.CRO_KEY_SHA256, crypto.createHash('sha256').update(key).digest('hex'), 'only the hash is stored');
assert.equal(g.ctx.croInit_({ key: 'x'.repeat(40) }).already, true);
assert.equal(g.props.CRO_KEY_SHA256, crypto.createHash('sha256').update(key).digest('hex'), 'not replaced');
assert.equal(g.ctx.croAction_({ key: 'x'.repeat(40) }).ok, false);
const sum = g.ctx.croAction_({ key, days: 7 });
assert.equal(sum.ok, true); assert.equal(sum.to, today); assert.equal(sum.sites.candadopyme.pv, 3);
console.log('Cro.js: ok');
