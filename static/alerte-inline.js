/* Veille AO Afrique : inscription courte aux alertes (fiche, liste, secteur, région), pré-remplie depuis la page.
   Même envoi que /alertes/ (action signup, kind alertes, sans offre payante), sans cookie.
   Deux formulaires possibles : #alerte-inline (secteur, région, e-mail, case de consentement) et, sur les fiches
   du bras B du test AOAF-ALERT-INLINE-01, #alerte-rapide-form (e-mail seul, critères de la fiche en champs cachés). */
(function () {
  'use strict';
  var U = 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec';
  var XP = 'aoaf-alert';
  var qs = new URLSearchParams(location.search);
  var cro = function () { return window.octaveCro; };
  function arm() { var c = cro(); return (c && c.v(XP)) || document.documentElement.getAttribute('data-xp-' + XP) || ''; }
  function goal(name) { var c = cro(); if (c && arm()) c.goal(name); }
  // Our own tests (?octave_notrack=1, remembered in this browser): the sign-up is stored with test = oui.
  function isTest() { try { if (localStorage.getItem('octave_notrack') === '1') return true; } catch (e) {} return qs.get('octave_notrack') === '1'; }
  // Same rule as model.slugify (region pages and option values): accents and stop words dropped.
  function mslug(s) { var stop = { de: 1, des: 1, du: 1, la: 1, le: 1, les: 1, et: 1, a: 1, au: 1, aux: 1, d: 1, l: 1, en: 1, pour: 1, un: 1, une: 1, sur: 1, par: 1, dans: 1, lot: 1, unique: 1 }; return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w && !stop[w]; }).slice(0, 9).join('-'); }
  function pick(sel, value) {
    if (!sel || !sel.options) return;
    var want = mslug(value);
    for (var i = 0; i < sel.options.length; i++) if (mslug(sel.options[i].value) === want) { sel.selectedIndex = i; return; }
  }

  // Official notice clicked: per-arm goal of the A/B test (the Stats event official_click is sent by mesure.js).
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-mesure="official_click"]');
    if (!a) return;
    goal('official');
    try { sessionStorage.setItem('aoaf_off', location.pathname); } catch (e) {}
  }, true);

  function setup(box, form, kind) {
    if (!box || !form) return;
    var ctx = box.getAttribute('data-ctx') || 'inline';
    var msg = form.querySelector('.form-msg');
    var submit = form.querySelector('button[type=submit]');
    var label = submit.textContent;

    // Event "alert_form_view" (detail = page type), once, when at least 40 % of the box is on screen.
    // A box hidden by the A/B arm (display: none) never intersects, so it never counts.
    var seen = false;
    function view() { if (!seen) { seen = true; if (window.aoaMesure) window.aoaMesure('alert_form_view', ctx); goal('alert_view'); } }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { view(); io.disconnect(); } }); }, { threshold: 0.4 });
      io.observe(box);
    } else if (box.offsetParent !== null) view();

    // List page: the alert follows the sector and region filters until the visitor picks criteria in the box itself.
    var filters = kind === 'inline' && document.getElementById('filtres');
    var touched = false;
    form.addEventListener('change', function (ev) { if (ev.target.tagName === 'SELECT') touched = true; });
    function sync() {
      if (!filters || touched) return;
      pick(form.elements.sectors, filters.elements.secteur.value);
      pick(form.elements.regions, filters.elements.region.value);
    }
    if (filters) { filters.addEventListener('change', sync); filters.addEventListener('reset', function () { setTimeout(sync, 0); }); setTimeout(sync, 0); }

    function val(name) { var el = form.elements[name]; return el && el.value ? [el.value] : []; }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      msg.className = 'form-msg';
      var email = form.elements.email.value.trim();
      if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(email)) { msg.textContent = 'Indiquez une adresse e-mail valide.'; msg.className += ' err'; form.elements.email.focus(); return; }
      // Quick form: the click on the button is the consent, with the sentence printed right under it.
      if (form.elements.consent && !form.elements.consent.checked) { msg.textContent = 'Cochez la case de consentement pour recevoir les alertes.'; msg.className += ' err'; return; }
      var countries = val('countries');
      var body = {
        action: 'signup', email: email, kind: 'alertes', plan: '', company: '', company_country: '', frequency: 'quotidien',
        sectors: val('sectors'), regions: val('regions'), countries: countries.length ? countries : ['maroc'],
        consent: true, consent_text: box.querySelector('.consent-text').textContent, website: form.elements.website.value,
        page: location.pathname, utm_source: qs.get('utm_source') || '', test: isTest(), xp: arm(), form: kind,
      };
      submit.disabled = true;
      msg.textContent = 'Envoi…';
      fetch(U, { method: 'POST', credentials: 'omit', body: JSON.stringify(body) }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) throw new Error(j.message || 'Erreur');
        // Octave cro.js conversion goal (aggregate counter, nothing about the person).
        if (window.octaveCro) window.octaveCro.goal('signup');
        form.elements.email.value = '';
        if (form.elements.consent) form.elements.consent.checked = false;
        msg.className = 'form-msg ok';
        msg.textContent = 'C’est noté. Vous recevrez un premier e-mail à l’ouverture des alertes, puis les nouveaux avis qui correspondent.';
      }).catch(function (err) {
        msg.className = 'form-msg err';
        msg.textContent = (err && err.message && err.message !== 'Failed to fetch' ? err.message : 'Envoi impossible pour le moment.') + ' Réessayez dans un instant, ou passez par le formulaire complet.';
      }).then(function () { submit.disabled = false; submit.textContent = label; });
    });
  }

  setup(document.getElementById('alerte'), document.getElementById('alerte-inline'), 'inline');
  var quick = document.getElementById('alerte-rapide');
  setup(quick, document.getElementById('alerte-rapide-form'), 'rapide');

  // Arm B only: back on the tender page after opening the official notice (back button, with or without the
  // page cache), the quick box gets a one-line reminder. No overlay, no scroll, the link itself is never held.
  function back() {
    var p = null;
    try { p = sessionStorage.getItem('aoaf_off'); } catch (e) {}
    if (p !== location.pathname || !quick || quick.offsetParent === null || quick.classList.contains('aq-back')) return;
    try { sessionStorage.removeItem('aoaf_off'); } catch (e) {}
    quick.classList.add('aq-back');
    var h = quick.querySelector('.aq-h');
    if (h) h.textContent = 'Vous avez vu l’avis officiel. Les prochains du même type, par e-mail :';
    goal('nudge');
  }
  back();
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) back(); });
})();
