/*! Veille AO Afrique : mesure d'audience anonyme, sans cookie ni identifiant (voir /confidentialite/). */
(function (n, l, d) {
  'use strict';
  var U = 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec?action=track';
  var off = n.doNotTrack == '1' || n.globalPrivacyControl || l.hostname != 'outils.vread.fr';
  var q = new URLSearchParams(l.search);
  var base = { site: 'veille-ao-afrique', page: l.pathname, ref_domain: (d.referrer.split('/')[2] || ''), device: innerWidth < 768 ? 'mobile' : 'desktop' };
  ['source', 'medium', 'campaign'].forEach(function (k) { base['utm_' + k] = q.get('utm_' + k) || ''; });
  function send(event, detail) {
    if (off) return;
    var b = {};
    for (var k in base) b[k] = base[k];
    b.event = event; b.detail = String(detail || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40); b.ts = Date.now();
    try { fetch(U, { method: 'POST', keepalive: true, credentials: 'omit', redirect: 'manual', body: JSON.stringify(b) }).catch(function () {}); } catch (e) {}
  }
  window.aoaMesure = send;
  send('view');
  if (/\/ao\/[^/]+\/?$/.test(l.pathname)) send('tender_view');
  if (/\/alertes\/?$/.test(l.pathname)) send('alert_form_view');
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-mesure]');
    if (a) send(a.getAttribute('data-mesure'), a.getAttribute('data-detail'));
  }, true);
})(navigator, location, document);
