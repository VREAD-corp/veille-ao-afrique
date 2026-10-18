// Behaviour of static/mesure.js in a fake browser: node tests/mesure_check.mjs (exit code 0 = ok).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../static/mesure.js', import.meta.url), 'utf8');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function run({ host = 'ao-afrique.jalonel.com', ua = CHROME, webdriver = false, search = '', store = {}, prerendering = false, visibility = 'visible', dnt = '', languages = ['fr-FR', 'fr'], uaData = undefined, now = Date.now() } = {}) {
  const sent = [], listeners = {};
  const doc = {
    referrer: 'https://www.google.com/', prerendering, visibilityState: visibility,
    addEventListener: (k, f) => { (listeners[k] ||= []).push(f); }, removeEventListener: (k, f) => { listeners[k] = (listeners[k] || []).filter((g) => g !== f); },
  };
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const ctx = {
    navigator: { userAgent: ua, webdriver, doNotTrack: dnt, language: languages[0] || '', languages, userAgentData: uaData }, document: doc, localStorage: ls, innerWidth: 1200, URLSearchParams, JSON, String,
    Date: { now: () => now }, screen: { width: 390, height: 844 },
    location: { hostname: host, pathname: '/ao/1-x/', search },
    fetch: (u, o) => { sent.push(JSON.parse(o.body)); assert.equal(o.credentials, 'omit'); return Promise.resolve(); },
  };
  ctx.window = ctx;
  vm.runInNewContext(src, ctx);
  const fire = (k) => (listeners[k] || []).slice().forEach((f) => f({}));
  return { sent, store, fire, doc };
}

let r = run();
assert.deepEqual(r.sent.map((b) => b.event), ['view', 'tender_view']);
assert.ok(r.sent.every((b) => !('excluded' in b) && b.v === 3), 'a normal visit is counted, with the snippet version');
// coarse fingerprint for the burst screen: 8 hex, same within the hour, different the next hour, never the UA itself
const H = 3600000 * 491000;
const fpA = run({ now: H + 10 }).sent[0].fp, fpB = run({ now: H + 3599000 }).sent[0].fp, fpC = run({ now: H + 3600000 + 5 }).sent[0].fp;
assert.match(fpA, /^[0-9a-f]{8}$/);
assert.equal(fpA, fpB, 'same fingerprint within one hour');
assert.notEqual(fpA, fpC, 'a new fingerprint every hour');
assert.notEqual(run({ now: H + 10, ua: CHROME.replace('141', '140') }).sent[0].fp, fpA, 'depends on the user agent');
assert.ok(!JSON.stringify(r.sent).includes('Chrome'), 'the user agent is never sent');

assert.ok(run({ webdriver: true }).sent.every((b) => b.excluded === 'webdriver'));
assert.ok(run({ ua: GOOGLEBOT }).sent.every((b) => b.excluded === 'bot'));
assert.ok(run({ ua: CHROME.replace('Chrome/', 'HeadlessChrome/') }).sent.every((b) => b.excluded === 'bot'));
assert.ok(!JSON.stringify(run({ ua: GOOGLEBOT }).sent).includes('Googlebot'), 'the user agent is never sent');
// headless browsers that hide it, and crawlers/tools the first list missed
assert.ok(run({ uaData: { brands: [{ brand: 'HeadlessChrome', version: '141' }] } }).sent.every((b) => b.excluded === 'bot'), 'Headless brand in client hints');
assert.ok(run({ languages: [] }).sent.every((b) => b.excluded === 'bot'), 'no language at all');
for (const u of ['facebookexternalhit/1.1', 'meta-externalagent/1.1', 'python-requests/2.32', 'curl/8.5.0', 'Wget/1.21', 'Mozilla/5.0 (compatible; Google-Read-Aloud)', 'Mozilla/5.0 Cypress/13.0 Chrome/141'])
  assert.ok(run({ ua: u }).sent.every((b) => b.excluded === 'bot'), u);
assert.ok(run({ uaData: { brands: [{ brand: 'Google Chrome', version: '141' }] } }).sent.every((b) => !('excluded' in b)), 'a normal Chrome stays counted');

r = run({ search: '?octave_notrack=1' });
assert.ok(r.sent.length && r.sent.every((b) => b.excluded === 'notrack'));
assert.equal(r.store.octave_notrack, '1', 'the flag is remembered for the next pages');
assert.ok(run({ store: { octave_notrack: '1' } }).sent.every((b) => b.excluded === 'notrack'));
r = run({ search: '?octave_notrack=0', store: { octave_notrack: '1' } });
assert.ok(r.sent.every((b) => !('excluded' in b)) && !('octave_notrack' in r.store), '=0 clears the flag');

assert.equal(run({ dnt: '1' }).sent.length, 0, 'Do Not Track: nothing at all');
assert.equal(run({ host: 'example.github.io' }).sent.length, 0, 'only the Jalonel subdomain is counted');
assert.equal(run({ host: 'localhost' }).sent.length, 0, 'unknown host: nothing sent');

r = run({ prerendering: true });
assert.equal(r.sent.length, 0, 'nothing while prerendering');
r.fire('prerenderingchange');
assert.deepEqual(r.sent.map((b) => b.event), ['view', 'tender_view'], 'counted once activated');

r = run({ visibility: 'prerender' });
assert.equal(r.sent.length, 0, 'nothing while visibilityState is prerender');
r.doc.visibilityState = 'visible'; r.fire('visibilitychange'); r.fire('visibilitychange');
assert.equal(r.sent.filter((b) => b.event === 'view').length, 1, 'counted once shown');

console.log('mesure.js: ok');
