// Behaviour of static/mesure.js in a fake browser: node tests/mesure_check.mjs (exit code 0 = ok).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../static/mesure.js', import.meta.url), 'utf8');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function run({ ua = CHROME, webdriver = false, search = '', store = {}, prerendering = false, visibility = 'visible', dnt = '' } = {}) {
  const sent = [], listeners = {};
  const doc = {
    referrer: 'https://www.google.com/', prerendering, visibilityState: visibility,
    addEventListener: (k, f) => { (listeners[k] ||= []).push(f); }, removeEventListener: (k, f) => { listeners[k] = (listeners[k] || []).filter((g) => g !== f); },
  };
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const ctx = {
    navigator: { userAgent: ua, webdriver, doNotTrack: dnt }, document: doc, localStorage: ls, innerWidth: 1200, URLSearchParams, JSON, Date, String,
    location: { hostname: 'outils.vread.fr', pathname: '/veille-ao-afrique/ao/1-x/', search },
    fetch: (u, o) => { sent.push(JSON.parse(o.body)); assert.equal(o.credentials, 'omit'); return Promise.resolve(); },
  };
  ctx.window = ctx;
  vm.runInNewContext(src, ctx);
  const fire = (k) => (listeners[k] || []).slice().forEach((f) => f({}));
  return { sent, store, fire, doc };
}

let r = run();
assert.deepEqual(r.sent.map((b) => b.event), ['view', 'tender_view']);
assert.ok(r.sent.every((b) => !('excluded' in b) && b.v === 2), 'a normal visit is counted, with the snippet version');
assert.ok(!JSON.stringify(r.sent).includes('Chrome'), 'the user agent is never sent');

assert.ok(run({ webdriver: true }).sent.every((b) => b.excluded === 'webdriver'));
assert.ok(run({ ua: GOOGLEBOT }).sent.every((b) => b.excluded === 'bot'));
assert.ok(run({ ua: CHROME.replace('Chrome/', 'HeadlessChrome/') }).sent.every((b) => b.excluded === 'bot'));
assert.ok(!JSON.stringify(run({ ua: GOOGLEBOT }).sent).includes('Googlebot'), 'the user agent is never sent');

r = run({ search: '?octave_notrack=1' });
assert.ok(r.sent.length && r.sent.every((b) => b.excluded === 'notrack'));
assert.equal(r.store.octave_notrack, '1', 'the flag is remembered for the next pages');
assert.ok(run({ store: { octave_notrack: '1' } }).sent.every((b) => b.excluded === 'notrack'));
r = run({ search: '?octave_notrack=0', store: { octave_notrack: '1' } });
assert.ok(r.sent.every((b) => !('excluded' in b)) && !('octave_notrack' in r.store), '=0 clears the flag');

assert.equal(run({ dnt: '1' }).sent.length, 0, 'Do Not Track: nothing at all');

r = run({ prerendering: true });
assert.equal(r.sent.length, 0, 'nothing while prerendering');
r.fire('prerenderingchange');
assert.deepEqual(r.sent.map((b) => b.event), ['view', 'tender_view'], 'counted once activated');

r = run({ visibility: 'prerender' });
assert.equal(r.sent.length, 0, 'nothing while visibilityState is prerender');
r.doc.visibilityState = 'visible'; r.fire('visibilitychange'); r.fire('visibilitychange');
assert.equal(r.sent.filter((b) => b.event === 'view').length, 1, 'counted once shown');

console.log('mesure.js: ok');
