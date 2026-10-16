/*! Veille AO Afrique : mesure d'audience anonyme, sans cookie ni identifiant (voir /confidentialite/). */
(function (n, l, d) {
  'use strict';
  var U = 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec?action=track';
  var off = n.doNotTrack == '1' || n.globalPrivacyControl || !/^(ao-afrique\.jalonel\.com|outils\.vread\.fr|vread-corp\.github\.io)$/.test(l.hostname);
  var q = new URLSearchParams(l.search);
  // Not a visit: our own tests (?octave_notrack=1, remembered in this browser; =0 clears it), automated browsers,
  // crawlers. Such hits go to a separate "excluded" counter. The user agent is only read here, never sent.
  var x = '', s;
  try { s = localStorage; if (q.has('octave_notrack')) q.get('octave_notrack') == '1' ? s.setItem('octave_notrack', '1') : s.removeItem('octave_notrack'); x = s.getItem('octave_notrack') == '1' ? 'notrack' : ''; } catch (e) {}
  if (!x && q.get('octave_notrack') == '1') x = 'notrack';
  if (!x && n.webdriver) x = 'webdriver';
  if (!x && /bot\b|crawl|spider|slurp|headless|lighthouse|pagespeed|inspectiontool|googleother|mediapartners|bingpreview|phantom|puppeteer|playwright|selenium/i.test(n.userAgent || '')) x = 'bot';
  var base = { v: 2, site: 'veille-ao-afrique', page: l.pathname, ref_domain: (d.referrer.split('/')[2] || ''), device: innerWidth < 768 ? 'mobile' : 'desktop' };
  ['source', 'medium', 'campaign'].forEach(function (k) { base['utm_' + k] = q.get('utm_' + k) || ''; });
  if (x) base.excluded = x;
  function send(event, detail) {
    if (off) return;
    var b = {};
    for (var k in base) b[k] = base[k];
    b.event = event; b.detail = String(detail || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40); b.ts = Date.now();
    try { fetch(U, { method: 'POST', keepalive: true, credentials: 'omit', redirect: 'manual', body: JSON.stringify(b) }).catch(function () {}); } catch (e) {}
  }
  window.aoaMesure = send;
  function start() {
    send('view');
    if (/\/ao\/[^/]+\/?$/.test(l.pathname)) send('tender_view');
    if (/\/alertes\/?$/.test(l.pathname)) send('alert_form_view');
  }
  // A prerendered or prefetched page is counted only if the visitor actually opens it.
  if (d.prerendering) d.addEventListener('prerenderingchange', start, { once: true });
  else if (d.visibilityState == 'prerender') d.addEventListener('visibilitychange', function v() { if (d.visibilityState != 'prerender') { d.removeEventListener('visibilitychange', v); start(); } });
  else start();
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-mesure]');
    if (a) send(a.getAttribute('data-mesure'), a.getAttribute('data-detail'));
  }, true);
})(navigator, location, document);
