/* Veille AO Afrique : formulaire d'alertes et pré-inscription (envoi au backend Apps Script, sans cookie). */
(function () {
  'use strict';
  var U = 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec';
  var form = document.getElementById('alerte-form');
  if (!form) return;
  var msg = document.getElementById('form-msg');
  var chosen = document.getElementById('plan-chosen');
  var submit = form.querySelector('button[type=submit]');
  var NAMES = { 'essentiel-39': 'Essentiel, 39 € pour 3 mois', 'pro-79': 'Pro, 79 € pour 3 mois' };
  var qs = new URLSearchParams(location.search);
  function slug(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  if (qs.get('secteur')) form.querySelectorAll('input[name=sectors]').forEach(function (b) { if (b.value === qs.get('secteur')) b.checked = true; });
  if (qs.get('region')) form.querySelectorAll('input[name=regions]').forEach(function (b) { if (b.value === slug(qs.get('region'))) b.checked = true; });
  var all = document.getElementById('toutes-regions');
  if (all) all.addEventListener('click', function () {
    var boxes = form.querySelectorAll('input[name=regions]');
    var to = Array.prototype.some.call(boxes, function (b) { return !b.checked; });
    boxes.forEach(function (b) { b.checked = to; });
    all.textContent = to ? 'tout décocher' : 'tout cocher';
  });
  document.querySelectorAll('.preinscr').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var plan = btn.getAttribute('data-plan');
      form.elements.plan.value = plan;
      form.elements.kind.value = 'preinscription';
      chosen.hidden = false;
      chosen.textContent = 'Pré-inscription à l’offre ' + NAMES[plan] + ' : aucun paiement maintenant. Choisissez vos critères puis validez.';
      submit.textContent = 'Me pré-inscrire, sans paiement';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { form.elements.email.focus({ preventScroll: true }); }, 400);
    });
  });
  function checked(name) { return Array.prototype.map.call(form.querySelectorAll('input[name=' + name + ']:checked'), function (b) { return b.value; }); }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.className = 'form-msg';
    var email = form.elements.email.value.trim();
    if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(email)) { msg.textContent = 'Indiquez une adresse e-mail valide.'; msg.className += ' err'; form.elements.email.focus(); return; }
    if (!form.elements.consent.checked) { msg.textContent = 'Cochez la case de consentement pour vous inscrire.'; msg.className += ' err'; return; }
    var body = {
      action: 'signup', email: email, kind: form.elements.kind.value, plan: form.elements.plan.value,
      company: form.elements.company.value, company_country: form.elements.company_country.value, frequency: form.elements.frequency.value,
      sectors: checked('sectors'), regions: checked('regions'), countries: ['maroc'].concat(checked('countries')),
      consent: true, consent_text: document.getElementById('consent-text').textContent, website: form.elements.website.value,
      page: location.pathname, utm_source: qs.get('utm_source') || '',
    };
    submit.disabled = true;
    msg.textContent = 'Envoi…';
    fetch(U, { method: 'POST', credentials: 'omit', body: JSON.stringify(body) }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) throw new Error(j.message || 'Erreur');
      // Octave cro.js conversion goal (aggregate A/B counter, nothing about the person): counted once per tab.
      if (window.octaveCro && j.kind) window.octaveCro.goal(j.kind === 'preinscription' ? 'preorder' : 'signup');
      form.reset();
      chosen.hidden = true;
      form.elements.plan.value = ''; form.elements.kind.value = 'alertes';
      submit.textContent = 'M’inscrire aux alertes';
      msg.className = 'form-msg ok';
      msg.textContent = j.kind === 'preinscription'
        ? 'Pré-inscription enregistrée. Aucun paiement n’a été demandé ; nous vous écrirons à l’ouverture de l’offre.'
        : 'Inscription enregistrée. Vous recevrez un premier e-mail à l’ouverture des alertes.';
    }).catch(function (err) {
      msg.className = 'form-msg err';
      msg.textContent = (err && err.message && err.message !== 'Failed to fetch' ? err.message : 'Envoi impossible pour le moment.') + ' Vous pouvez aussi écrire à octave@vread.fr.';
    }).then(function () { submit.disabled = false; });
  });
})();
