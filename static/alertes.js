/* Veille AO Afrique : formulaire d'alertes et formules payantes (inscription au backend Apps Script, sans cookie ;
   paiement par octave-global-checkout, Stripe Payment Element, chargé seulement quand on clique sur « Payer »). */
(function () {
  'use strict';
  var U = 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec';
  var form = document.getElementById('alerte-form');
  if (!form) return;
  var msg = document.getElementById('form-msg');
  var chosen = document.getElementById('plan-chosen');
  var submit = form.querySelector('button[type=submit]');
  var NAMES = { 'essentiel-39': 'Essentiel, 39 € pour 3 mois', 'pro-79': 'Pro, 79 € pour 3 mois' };
  var pay = document.getElementById('paiement');
  var chosenPlan = null; // {id, product, amount}
  function mesure(ev, detail) { try { if (window.aoaMesure) window.aoaMesure(ev, detail); } catch (e) { /* never block */ } }
  function goal(name) { try { if (window.octaveCro) window.octaveCro.goal(name); } catch (e) { /* never block */ } }
  var qs = new URLSearchParams(location.search);
  function slug(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  // Same rule as model.slugify (checkbox values): accents and stop words dropped, so « L'Oriental » matches « oriental ».
  function mslug(s) { var stop = { de: 1, des: 1, du: 1, la: 1, le: 1, les: 1, et: 1, a: 1, au: 1, aux: 1, d: 1, l: 1, en: 1, pour: 1, un: 1, une: 1, sur: 1, par: 1, dans: 1, lot: 1, unique: 1 }; return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w && !stop[w]; }).slice(0, 9).join('-'); }
  if (qs.get('secteur')) form.querySelectorAll('input[name=sectors]').forEach(function (b) { if (b.value === qs.get('secteur')) b.checked = true; });
  if (qs.get('region')) form.querySelectorAll('input[name=regions]').forEach(function (b) { if (mslug(b.value) === mslug(qs.get('region'))) b.checked = true; });
  var all = document.getElementById('toutes-regions');
  if (all) all.addEventListener('click', function () {
    var boxes = form.querySelectorAll('input[name=regions]');
    var to = Array.prototype.some.call(boxes, function (b) { return !b.checked; });
    boxes.forEach(function (b) { b.checked = to; });
    all.textContent = to ? 'tout décocher' : 'tout cocher';
  });
  document.querySelectorAll('.plan-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var plan = btn.getAttribute('data-plan');
      chosenPlan = { id: plan, product: btn.getAttribute('data-product'), amount: Number(btn.getAttribute('data-amount')) };
      form.elements.plan.value = plan;
      form.elements.kind.value = 'alertes';
      if (plan === 'pro-79') form.querySelectorAll('input[name=countries]').forEach(function (b) { b.checked = true; });
      chosen.hidden = false;
      chosen.textContent = 'Formule ' + NAMES[plan] + '. Choisissez vos critères, inscrivez-vous, puis payez à l’étape suivante.';
      submit.textContent = 'M’inscrire et passer au paiement';
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
      if (j.kind) goal(j.kind === 'preinscription' ? 'preorder' : 'signup');
      if (chosenPlan && pay) { openPay(email, form.elements.company_country.value); return; }
      form.reset();
      chosen.hidden = true;
      form.elements.plan.value = ''; form.elements.kind.value = 'alertes';
      submit.textContent = 'M’inscrire aux alertes';
      msg.className = 'form-msg ok';
      msg.textContent = j.kind === 'preinscription'
        ? 'Pré-inscription enregistrée. Aucun paiement n’a été demandé.'
        : 'Inscription enregistrée. Les alertes partent chaque matin depuis alertes@jalonel.com, seulement quand un nouvel avis correspond.';
    }).catch(function (err) {
      msg.className = 'form-msg err';
      msg.textContent = (err && err.message && err.message !== 'Failed to fetch' ? err.message : 'Envoi impossible pour le moment.') + ' Vous pouvez aussi écrire à contact@jalonel.com.';
    }).then(function () { submit.disabled = false; });
  });

  /* ---------- payment step (octave-global-checkout, EUR, buyers outside the EU only) ---------- */
  function openPay(email, companyCountry) {
    var sum = document.getElementById('pay-summary');
    sum.textContent = 'Inscription enregistrée pour ' + email + '. Formule ' + NAMES[chosenPlan.id] + ' : payez maintenant pour garantir vos 3 mois d’alertes. Utilisez la même adresse e-mail au paiement.';
    if (companyCountry === 'france' || companyCountry === 'autre-europe') {
      sum.textContent += ' Attention : le paiement en ligne refuse les entreprises établies dans l’Union européenne ; écrivez-nous à contact@jalonel.com.';
    }
    pay.hidden = false;
    msg.className = 'form-msg ok';
    msg.textContent = 'Inscription enregistrée. Dernière étape : le paiement, juste en dessous.';
    mesure('checkout_view', chosenPlan.id);
    pay.dataset.country = companyCountry === 'maroc' ? 'MA' : '';
    pay.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  var open = document.getElementById('pay-open');
  if (pay && open) open.addEventListener('click', function () {
    var pm = document.getElementById('pay-msg');
    pm.className = 'form-msg';
    if (!chosenPlan) { pm.textContent = 'Choisissez d’abord une formule.'; pm.className += ' err'; return; }
    if (!document.getElementById('cgv-ok').checked) { pm.textContent = 'Cochez la case des conditions de vente pour continuer.'; pm.className += ' err'; return; }
    pm.textContent = '';
    open.disabled = true;
    var plan = chosenPlan;
    var started = false;
    var s = document.createElement('script');
    s.src = pay.getAttribute('data-ogc');
    s.onload = function () {
      open.hidden = true; open.style.display = 'none';
      document.getElementById('cgv-ok').disabled = true;
      document.querySelectorAll('.plan-btn').forEach(function (b) { b.disabled = true; });
      var buy = document.getElementById('buy');
      // Payment submitted in the module (its form): counted once per page as checkout_start.
      buy.addEventListener('submit', function () { if (!started) { started = true; mesure('checkout_start', plan.id); } }, true);
      window.OctaveCheckout.mount('#buy', {
        product: plan.product, amount: plan.amount, currency: 'eur', venture: form.getAttribute('data-venture'), lang: 'fr',
        country: pay.dataset.country || undefined,
        appearance: { variables: { colorPrimary: '#16302b', borderRadius: '6px' } },
        onSuccess: function () { goal('paid'); mesure('paid', plan.id); },
      });
    };
    s.onerror = function () { open.disabled = false; pm.className = 'form-msg err'; pm.textContent = 'Le module de paiement ne s’est pas chargé. Vérifiez la connexion et réessayez, ou écrivez à contact@jalonel.com.'; };
    document.head.appendChild(s);
  });
})();
