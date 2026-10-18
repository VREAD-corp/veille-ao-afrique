// Burst screen and reclass action of gas/src/Code.js with fake Apps Script services: node tests/burst_check.mjs
// (exit code 0 = ok). Checks: a slow or fast burst of distinct tender pages from one fingerprint goes to Exclus as
// `burst` and the hits already counted in that window are moved there; humans (interactions, few pages,
// different fingerprints) stay counted; the fingerprint is never written to the spreadsheet.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../gas/src/Code.js', import.meta.url), 'utf8');
const cro = fs.readFileSync(new URL('../gas/src/Cro.js', import.meta.url), 'utf8');

function gas() {
  const tabs = new Map();
  const sheet = (name) => {
    const rows = [];
    const sh = {
      rows,
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map((r) => r.length)),
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
    getId: () => 'sheet1', getUrl: () => 'https://x',
    getSheets: () => [{ name: 'Feuille 1' }],
    getSheetByName: (n) => tabs.get(n) || null,
    insertSheet: (n) => { const s = sheet(n); tabs.set(n, s); return s; },
    deleteSheet() {},
  };
  const store = new Map();
  let now = Date.parse('2026-10-19T08:00:05Z');
  const cache = {
    get: (k) => (store.has(k) ? store.get(k) : null),
    put: (k, v) => { assert.ok(String(v).length < 100000, 'cache value under 100 KB'); store.set(k, String(v)); },
    getAll: (ks) => Object.fromEntries(ks.filter((k) => store.has(k)).map((k) => [k, store.get(k)])),
    putAll: (o) => { for (const [k, v] of Object.entries(o)) store.set(k, String(v)); },
  };
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'SHEET_ID' ? 'sheet1' : null), setProperty() {} }) },
    SpreadsheetApp: { openById: () => ss, create: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => cache },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      formatDate: (d) => new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10),
      computeDigest: (_a, text) => [...crypto.createHash('sha256').update(String(text)).digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
    },
  };
  vm.runInNewContext(code + '\n' + cro + "\n;var ADMIN_TOKEN_ = 'test-admin-token-0123456789abcdef';\nnow_ = function () { return new Date(globalThis.__now()); };\nglobalThis.R = { route_ };", Object.assign(ctx, { globalThis: ctx }));
  ctx.__now = () => now;
  const post = (body) => JSON.parse(ctx.R.route_({}, body).s);
  const table = (name) => { const s = tabs.get(name); if (!s) return []; const [h, ...r] = s.rows; return r.map((row) => Object.fromEntries(h.map((k, i) => [k, row[i]]))); };
  const sum = (name, f) => table(name).filter(f).reduce((a, r) => a + Number(r.count || 0), 0);
  return { post, table, sum, tabs, tick: (ms) => { now += ms; } };
}

const hit = (page, event, over = {}) => ({ action: 'track', v: 3, site: 'veille-ao-afrique', page, event, device: 'mobile', fp: 'a1b2c3d4', ...over });
const tender = (g, i, over = {}) => { assert.deepEqual(g.post(hit(`/ao/${i}-avis-test/`, 'view', over)), { ok: true }); assert.deepEqual(g.post(hit(`/ao/${i}-avis-test/`, 'tender_view', over)), { ok: true }); };

// 1. Fast burst: 20 distinct tender pages in one minute from one fingerprint -> all of it in Exclus (burst).
let g = gas();
for (let i = 0; i < 20; i++) { tender(g, i); g.tick(2000); }
assert.equal(g.sum('Stats', (r) => r.page === '/ao/*'), 0, 'the 8 hits counted before the threshold were moved out of Stats');
assert.equal(g.sum('Exclus', (r) => r.reason === 'burst' && r.event === 'tender_view'), 20);
assert.equal(g.sum('Exclus', (r) => r.reason === 'burst' && r.event === 'view'), 20);
assert.equal(g.table('Exclus').find((r) => r.reason === 'burst').mobile, 20);
// the fingerprint is never written anywhere in the spreadsheet
for (const [, s] of g.tabs) assert.ok(!JSON.stringify(s.rows).includes('a1b2c3d4'), 'fp never stored');

// 2. Slow crawler (the 13/10 pattern, about 2 pages a minute): > 30 distinct tender pages within the hour, no interaction.
g = gas();
for (let i = 0; i < 40; i++) { tender(g, i); g.tick(28000); }
assert.equal(g.sum('Stats', (r) => r.page === '/ao/*'), 0, 'slow burst moved out of Stats as well');
assert.equal(g.sum('Exclus', (r) => r.reason === 'burst' && r.event === 'tender_view'), 40);

// 3. A human: 40 tender pages in the hour too, but with filters and clicks -> stays counted (hour rule needs no interaction).
g = gas();
g.post(hit('/', 'filter_use', { detail: 'secteur' }));
for (let i = 0; i < 40; i++) { tender(g, i); g.tick(28000); }
assert.equal(g.sum('Stats', (r) => r.page === '/ao/*' && r.event === 'tender_view'), 40);
assert.equal(g.sum('Exclus', () => true), 0);

// 4. Several real visitors at once (different fingerprints), 5 tender pages each within the same minute: counted.
g = gas();
for (const fp of ['00000001', '00000002', '00000003', '00000004']) for (let i = 0; i < 5; i++) tender(g, i, { fp });
assert.equal(g.sum('Stats', (r) => r.event === 'tender_view'), 20);
assert.equal(g.sum('Exclus', () => true), 0);

// 5. Same tender page reloaded 30 times in a minute: not distinct pages, not a burst.
g = gas();
for (let i = 0; i < 30; i++) tender(g, 7);
assert.equal(g.sum('Stats', (r) => r.event === 'tender_view'), 30);

// 6. Old snippet without fp: minute rule on a coarse key still catches a fast burst; a page cannot claim `burst` itself.
g = gas();
for (let i = 0; i < 12; i++) tender(g, i, { fp: undefined, v: 2 });
assert.equal(g.sum('Stats', (r) => r.event === 'tender_view'), 0);
assert.equal(g.sum('Exclus', (r) => r.reason === 'burst' && r.event === 'tender_view'), 12);
g = gas();
g.post(hit('/', 'view', { excluded: 'burst' }));
assert.equal(g.table('Exclus')[0].reason, 'bot', 'a page-sent reason outside the list counts as bot');

// 7. reclass: moves one whole Stats row to Exclus (burst) with an annotation; token and expected count required.
g = gas();
for (let i = 0; i < 3; i++) g.post(hit('/ao/1-x/', 'tender_view', { fp: '0000000' + i }));
const T = 'test-admin-token-0123456789abcdef';
const row = { action: 'reclass', date: '2026-10-19', page: '/ao/*', event: 'tender_view', detail: '', source: '(direct)', medium: '', campaign: '', note: 'test' };
assert.equal(g.post({ ...row, token: 'nope', expect_count: 3 }).error, 'forbidden');
assert.deepEqual(g.post({ ...row, token: T, expect_count: 2 }), { ok: false, error: 'count_mismatch', count: 3 });
assert.deepEqual(g.post({ ...row, token: T, expect_count: 3 }), { ok: true, moved: 3, mobile: 3, desktop: 0 });
assert.equal(g.post({ ...row, token: T, expect_count: 3 }).error, 'count_mismatch', 'a replay moves nothing');
assert.equal(g.sum('Stats', (r) => r.event === 'tender_view'), 0);
assert.equal(g.sum('Exclus', (r) => r.reason === 'burst'), 3);
assert.equal(g.table('Annotations')[0].reason, 'burst');

console.log('burst: ok');
