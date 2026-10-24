/*! octave-global-checkout · embeddable Stripe Payment Element checkout for Octave's ventures (READ FRANCE SAS)
 *
 *   <div id="buy"></div>
 *   <script src="og-checkout.js"></script>
 *   <script>OctaveCheckout.mount('#buy', { product: 'dpdp-kit-inr', amount: 49900, currency: 'inr', venture: 'as-in-01' });</script>
 *
 * Flow (Stripe "deferred intent"): the Payment Element is mounted AT ONCE with the static amount (display only),
 * the Apps Script catalog is read in the background (it also wakes the web app up); on submit: browser checks,
 * elements.submit(), POST createIntent (text/plain: no CORS preflight; the server re-prices and refuses a stale
 * amount), confirmPayment (redirect only if the card needs it), then POST fulfil, which e-mails the delivery
 * and the G- receipt. After a 3-D Secure redirect the same page finishes the order from the URL parameters.
 * Card only by default; `paymentMethodConfiguration: 'pmc_…'` is the hook for UPI / Pix once enabled.
 * Country allowlist (1.4.0): `countries: ['US']`, or the product's `countries` from the catalog, limits the country list.
 * Tests (1.5.0): a test utm tag (e2e-…, smoke, selftest, test-…) counts like ?octave_notrack=1, and createIntent
 * carries `test` (notrack | webdriver) so the backend marks the PaymentIntent and leaves it out of the funnel.
 * Stripe.js is loaded from https://js.stripe.com/v3/ (never self-hosted). No cookie; the only storage is the
 * octave_notrack test flag (localStorage), written only when the page URL carries ?octave_notrack=.
 * A/B (pages running Octave's cro.js, window.octaveCro): the payment start is recorded as goal 'checkout', and the
 * page's active variants (<html data-xp-<id>>) travel as one short `xp` string ("price:p29a") with the
 * checkout_view / checkout_start hits and createIntent (PaymentIntent metadata), so the backend counts paid sales
 * per variant. Without cro.js nothing changes.
 */
(function (global) {
  'use strict';
  var DEFAULTS = {
    endpoint: "https://script.google.com/macros/s/AKfycbzHtgYXyyylvj1LFG16HuhxwFHkB7E2u-QKIlVH4hEJggjUvq_rcTK_MEodCwjTbATbuw/exec",
    publishableKey: "pk_live_51SDmVlB6XNZF5Hrp0OtBUt7OG4zvsmy3jSP9ipuIpvggKSa9eBq4oqO2t7otwbGi4s9iuMiLNx22mk4IoFJeYNuQ00lzBZhHZ9",
  };
  var COUNTRIES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
    'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
    'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS ' +
    'MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS ' +
    'RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
    'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
  var EU = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE MC'.split(' ');
  var ZERO_DECIMAL = ['xof', 'xaf', 'vnd', 'clp', 'jpy', 'krw', 'pyg', 'rwf', 'bif', 'djf', 'gnf', 'kmf', 'mga', 'vuv', 'xpf'];
  var T = {
    en: { email: 'E-mail', name: 'Full name', country: 'Country', choose: 'Choose…', company: 'I am buying for a company', companyName: 'Company name', taxId: 'Tax ID (optional)', pay: 'Pay {price}', paying: 'Processing…', loading: 'Loading secure payment…', stale: 'The displayed price is out of date (current price: {price}). Please reload the page.', notServed: 'This product is not sold to buyers in this country.', eu: 'This checkout serves buyers outside the European Union only.', loadFail: 'The payment form could not be loaded. Please reload the page.', done: 'Payment confirmed. We sent your order to {email}.', doneHelp: 'Order {order}. Please check your spam folder.', confirming: 'Confirming your payment…', later: 'If you close this page, your order will still be e-mailed within 10 minutes.', failed: 'The payment did not go through. Nothing was charged.', unreachable: 'The service cannot be reached right now.', secure: 'Payments are processed by Stripe for READ FRANCE SAS (France). No French VAT applies to buyers outside the EU.' },
    fr: { email: 'E-mail', name: 'Nom complet', country: 'Pays', choose: 'Choisir…', company: 'J’achète pour une entreprise', companyName: 'Nom de l’entreprise', taxId: 'Numéro fiscal (facultatif)', pay: 'Payer {price}', paying: 'Paiement en cours…', loading: 'Chargement du paiement sécurisé…', stale: 'Le prix affiché n’est plus à jour (prix actuel : {price}). Rechargez la page.', notServed: 'Ce produit n’est pas vendu aux acheteurs de ce pays.', eu: 'Ce paiement est réservé aux acheteurs situés hors de l’Union européenne.', loadFail: 'Le module de paiement n’a pas pu être chargé. Rechargez la page.', done: 'Paiement confirmé. Votre commande a été envoyée à {email}.', doneHelp: 'Commande {order}. Pensez à vérifier vos courriers indésirables.', confirming: 'Confirmation du paiement…', later: 'Si vous fermez cette page, votre commande vous sera tout de même envoyée dans les 10 minutes.', failed: 'Le paiement n’a pas abouti. Aucun montant n’a été débité.', unreachable: 'Le service est momentanément injoignable.', secure: 'Paiement traité par Stripe pour READ FRANCE SAS (France). Pas de TVA française pour les acheteurs hors UE.' },
    pt: { email: 'E-mail', name: 'Nome completo', country: 'País', choose: 'Escolha…', company: 'Estou comprando para uma empresa', companyName: 'Nome da empresa', taxId: 'Número fiscal (opcional)', pay: 'Pagar {price}', paying: 'Processando…', loading: 'Carregando o pagamento seguro…', stale: 'O preço exibido está desatualizado (preço atual: {price}). Recarregue a página.', notServed: 'Este produto não é vendido a compradores deste país.', eu: 'Este pagamento é reservado a compradores fora da União Europeia.', loadFail: 'Não foi possível carregar o formulário de pagamento. Recarregue a página.', done: 'Pagamento confirmado. Enviamos seu pedido para {email}.', doneHelp: 'Pedido {order}. Verifique também a caixa de spam.', confirming: 'Confirmando seu pagamento…', later: 'Se você fechar esta página, seu pedido será enviado por e-mail em até 10 minutos.', failed: 'O pagamento não foi concluído. Nada foi cobrado.', unreachable: 'O serviço está indisponível no momento.', secure: 'Pagamento processado pela Stripe para a READ FRANCE SAS (França).' },
    es: { email: 'Correo electrónico', name: 'Nombre completo', country: 'País', choose: 'Elegir…', company: 'Compro para una empresa', companyName: 'Nombre de la empresa', taxId: 'Número fiscal (opcional)', pay: 'Pagar {price}', paying: 'Procesando…', loading: 'Cargando el pago seguro…', stale: 'El precio mostrado no está actualizado (precio actual: {price}). Recargue la página.', notServed: 'Este producto no se vende a compradores de este país.', eu: 'Este pago está reservado a compradores fuera de la Unión Europea.', loadFail: 'No se pudo cargar el formulario de pago. Recargue la página.', done: 'Pago confirmado. Enviamos su pedido a {email}.', doneHelp: 'Pedido {order}. Revise también la carpeta de spam.', confirming: 'Confirmando su pago…', later: 'Si cierra esta página, su pedido se le enviará por correo en un plazo de 10 minutos.', failed: 'El pago no se completó. No se ha cobrado nada.', unreachable: 'El servicio no está disponible en este momento.', secure: 'Pago procesado por Stripe para READ FRANCE SAS (Francia).' },
  };
  var CSS = '.ogc{font:inherit;max-width:520px}.ogc label{display:block;margin:.6em 0 .2em;font-weight:600}.ogc input[type=text],.ogc input[type=email],.ogc select{width:100%;box-sizing:border-box;padding:.55em .6em;border:1px solid #bbb;border-radius:6px;font:inherit;background:#fff;color:#111}.ogc .ogc-check{display:flex;gap:.5em;align-items:center;font-weight:400;margin:.8em 0}.ogc .ogc-pe{margin:1em 0}.ogc button{width:100%;padding:.8em;border:0;border-radius:6px;background:#1a56db;color:#fff;font:inherit;font-weight:700;cursor:pointer}.ogc button[disabled]{opacity:.55;cursor:not-allowed}.ogc .ogc-err{color:#b00020;margin:.6em 0}.ogc .ogc-ok{color:#0a7a2f;font-weight:700}.ogc .ogc-small{font-size:.85em;opacity:.8;margin:.6em 0}.ogc-spin{display:inline-block;width:1em;height:1em;margin-right:.5em;vertical-align:-.15em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ogc-spin .7s linear infinite}@keyframes ogc-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.ogc-spin{animation-duration:2s}}';

  function pickLang(v) {
    var l = String(v || '').toLowerCase().slice(0, 2);
    return T[l] ? l : '';
  }
  function fill(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; });
  }
  function formatPrice(amount, currency, lang) {
    var c = String(currency).toLowerCase();
    var value = ZERO_DECIMAL.indexOf(c) >= 0 ? amount : amount / 100;
    try {
      return new Intl.NumberFormat(lang, { style: 'currency', currency: c.toUpperCase() }).format(value);
    } catch (e) {
      return value + ' ' + c.toUpperCase();
    }
  }
  function randomId() {
    var a = new Uint8Array(16);
    global.crypto.getRandomValues(a);
    return 'att_' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (attrs[k] !== false && attrs[k] !== undefined) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (children || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function loadStripe() {
    if (typeof global.Stripe === 'function') return Promise.resolve(global.Stripe);
    return new Promise(function (ok, ko) {
      var s = document.querySelector('script[src^="https://js.stripe.com/v3"]') || el('script', { src: 'https://js.stripe.com/v3/', async: true });
      s.addEventListener('load', function () { ok(global.Stripe); });
      s.addEventListener('error', function () { ko(new Error('stripe.js')); });
      if (!s.parentNode) document.head.appendChild(s);
    });
  }
  function post(endpoint, body, timeoutMs) {
    var ctrl = timeoutMs && global.AbortController ? new global.AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    return fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }

  // The backend answers a cancel in < 20 s even when Stripe hangs (8 s UrlFetch timeout per Stripe call).
  var CANCEL_TIMEOUT_MS = 25000, CANCEL_RETRY_DELAY_MS = 1500;
  /**
   * Abandons an unconfirmed PaymentIntent (cancelIntent is idempotent). Retries ONCE after a network error, a
   * timeout or an answer flagged retryable; never throws. Resolves { ok, status | error, tries }. Whatever stays
   * open is cancelled by the backend's 24 h safety net.
   */
  function cancelIntent(endpoint, prev, lang) {
    var body = { action: 'cancelIntent', payment_intent: prev.pi, client_secret: prev.clientSecret, lang: lang };
    var tries = 0;
    function once() {
      tries++;
      return post(endpoint, body, CANCEL_TIMEOUT_MS).then(function (j) {
        if (j && j.ok) return { ok: true, status: j.status, already: !!j.already, tries: tries };
        var e = new Error((j && j.message) || 'cancel failed');
        e.code = (j && j.error) || 'bad_response';
        e.retryable = !!(j && j.retryable);
        throw e;
      }).catch(function (e) {
        var retryable = !e || e.retryable !== false; // network error / abort: retry; a clear refusal: no
        if (retryable && tries < 2) return new Promise(function (r) { setTimeout(r, CANCEL_RETRY_DELAY_MS); }).then(once);
        var code = (e && e.code) || (e && e.name === 'AbortError' ? 'timeout' : 'network');
        if (global.console && console.warn) console.warn('OctaveCheckout: cancelIntent ' + code + ' after ' + tries + ' tries (the 24 h safety net will cancel it)');
        return { ok: false, error: code, tries: tries };
      });
    }
    return once();
  }

  var BOT_UA = /bot\b|crawl|spider|slurp|headless|lighthouse|pagespeed|inspectiontool|googleother|mediapartners|bingpreview|phantom|puppeteer|playwright|selenium/i;
  // Test campaign tags (utm_source=e2e-desktop-…, smoke, selftest, test-…): our runs, same rule as the backend (Track.js).
  var TEST_TAG = /(^|[^a-z0-9])(e2e|selftest|smoke|octave-?test|qa-?test)([^a-z0-9]|$)|^test([^a-z0-9]|$)/i;

  /** Why this hit is not a visit ('' if it is): our own tests (?octave_notrack=1 or a test utm tag, remembered in
   *  this browser; octave_notrack=0 clears it), automated browsers, crawlers. Same rules as veille-ao-afrique's
   *  mesure.js. The user agent is only read here, never sent. */
  function exclusion(q) {
    var n = global.navigator || {}, x = '', s;
    var tagged = q.get('octave_notrack') !== '0' && ['utm_source', 'utm_medium', 'utm_campaign'].some(function (k) { return TEST_TAG.test(q.get(k) || ''); });
    try { s = global.localStorage; if (q.has('octave_notrack') || tagged) { if (q.get('octave_notrack') === '1' || tagged) s.setItem('octave_notrack', '1'); else s.removeItem('octave_notrack'); } x = s.getItem('octave_notrack') === '1' ? 'notrack' : ''; } catch (e) { /* storage blocked */ }
    if (!x && (q.get('octave_notrack') === '1' || tagged)) x = 'notrack';
    if (!x && n.webdriver) x = 'webdriver';
    if (!x && BOT_UA.test(n.userAgent || '')) x = 'bot';
    return x;
  }

  /** Runs fn now, or once a prerendered / prefetched page is actually shown (never if it is not). */
  function whenShown(fn) {
    var d = document;
    if (d.prerendering) d.addEventListener('prerenderingchange', fn, { once: true });
    else if (d.visibilityState === 'prerender') d.addEventListener('visibilitychange', function v() { if (d.visibilityState !== 'prerender') { d.removeEventListener('visibilitychange', v); fn(); } });
    else fn();
  }

  /** Active A/B variants set by cro.js on <html data-xp-<id>="<variant>">, as "id:variant[,id:variant]" (≤ 4
   *  pairs, [a-z0-9-] only; anything else is skipped). '' when the page does not run cro.js. */
  function xpOf() {
    try {
      if (!global.octaveCro) return '';
      var a = document.documentElement.attributes, out = [];
      for (var i = 0; i < a.length && out.length < 4; i++) {
        var m = /^data-xp-([a-z0-9-]{1,24})$/.exec(a[i].name);
        if (m && /^[a-z0-9-]{1,12}$/.test(a[i].value)) out.push(m[1] + ':' + a[i].value);
      }
      return out.join(',');
    } catch (e) { return ''; }
  }

  /** Conversion goal of cro.js (counted at most once per tab by cro.js itself); nothing without it. */
  function croGoal(name) {
    try { if (global.octaveCro && typeof global.octaveCro.goal === 'function') global.octaveCro.goal(name); } catch (e) { /* never break the payment */ }
  }

  /** Cookieless audience hit: nothing under DNT / GPC; hits that are not visits are flagged `excluded` and the
   *  backend counts them apart (Exclus tab). v: 2 marks a module that screens them (older hits count as legacy). */
  function track(opts, event) {
    try {
      var n = global.navigator || {};
      if (!opts.venture || opts.track === false || n.doNotTrack === '1' || n.globalPrivacyControl) return;
      var q = new URLSearchParams(global.location.search);
      var body = { v: 2, site: opts.venture, page: global.location.pathname, event: event, ref_domain: (document.referrer.split('/')[2] || ''), device: global.innerWidth < 768 ? 'mobile' : 'desktop' };
      ['source', 'medium', 'campaign'].forEach(function (k) { var v = q.get('utm_' + k); if (v) body['utm_' + k] = v; });
      if (event === 'checkout_view' || event === 'checkout_start') { var xp = xpOf(); if (xp) body.xp = xp; }
      var x = exclusion(q);
      if (x) body.excluded = x;
      whenShown(function () {
        body.ts = Date.now();
        fetch(opts.endpoint + '?action=track', { method: 'POST', keepalive: true, credentials: 'omit', redirect: 'manual', body: JSON.stringify(body) }).catch(function () {});
      });
    } catch (e) { /* never break the page */ }
  }

  function mount(target, options) {
    var o = {};
    Object.keys(DEFAULTS).forEach(function (k) { o[k] = DEFAULTS[k]; });
    Object.keys(options || {}).forEach(function (k) { o[k] = options[k]; });
    var root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) throw new Error('OctaveCheckout: mount target not found');
    if (!o.product || typeof o.amount !== 'number' || !o.currency) throw new Error('OctaveCheckout: product, amount and currency are required');
    o.currency = String(o.currency).toLowerCase();
    var lang = pickLang(o.lang) || pickLang(document.documentElement.lang) || pickLang((global.navigator || {}).language) || 'en';
    var L = T[lang];
    var price = formatPrice(o.amount, o.currency, lang);
    var attempt = randomId();
    var pmOpts = o.paymentMethodConfiguration ? { configuration: o.paymentMethodConfiguration } : { types: ['card'] };

    if (!document.getElementById('ogc-style')) document.head.appendChild(el('style', { id: 'ogc-style', text: CSS }));
    root.innerHTML = '';
    var displayNames = null;
    try { displayNames = new Intl.DisplayNames([lang], { type: 'region' }); } catch (e) { displayNames = null; }
    var countrySelect = el('select', { name: 'country', id: 'ogc-country', required: true, autocomplete: 'country' }, [el('option', { value: '', text: L.choose })]);
    // Optional allowlist (module 1.4.0): `countries: ['US']` on the page, or the product's own list from the catalog.
    var served = null;
    function fillCountries(list) {
      var keep = countrySelect.value;
      while (countrySelect.options.length > 1) countrySelect.remove(1);
      list.map(function (c) { return { c: c, n: displayNames ? displayNames.of(c) : c }; })
        .sort(function (a, b) { return a.n.localeCompare(b.n, lang); })
        .forEach(function (x) { countrySelect.appendChild(el('option', { value: x.c, text: x.n })); });
      if (keep && list.indexOf(keep) >= 0) countrySelect.value = keep;
      else if (o.country && list.indexOf(o.country) >= 0) countrySelect.value = o.country;
      else if (list.length === 1) countrySelect.value = list[0];
    }
    function restrict(list) {
      if (!Array.isArray(list)) return;
      var ok = list.filter(function (c) { return COUNTRIES.indexOf(c) >= 0 && EU.indexOf(c) < 0; });
      if (!ok.length) return;
      served = ok;
      fillCountries(ok);
    }
    fillCountries(COUNTRIES);
    restrict(o.countries);
    function countryError() {
      var v = countrySelect.value;
      return EU.indexOf(v) >= 0 ? L.eu : (served && v && served.indexOf(v) < 0 ? L.notServed : '');
    }
    var companyBox = el('div', { hidden: true }, [
      el('label', { for: 'ogc-company', text: L.companyName }), el('input', { type: 'text', name: 'company', id: 'ogc-company', maxlength: '200', autocomplete: 'organization' }),
      el('label', { for: 'ogc-taxid', text: L.taxId }), el('input', { type: 'text', name: 'taxId', id: 'ogc-taxid', maxlength: '40', pattern: '[A-Za-z0-9 .\\/\\-]{2,40}' }),
    ]);
    var companyToggle = el('input', { type: 'checkbox', name: 'isCompany', id: 'ogc-is-company' });
    var loading = el('p', { class: 'ogc-small', role: 'status', text: L.loading });
    var peBox = el('div', { class: 'ogc-pe', id: 'ogc-payment-element' });
    var btn = el('button', { type: 'submit', id: 'ogc-pay', disabled: true, text: fill(L.pay, { price: price }) });
    var errBox = el('p', { class: 'ogc-err', role: 'alert', hidden: true });
    var status = el('p', { class: 'ogc-status', role: 'status', 'aria-live': 'polite', hidden: true });
    var help = el('p', { class: 'ogc-small', hidden: true });
    var form = el('form', { class: 'ogc', id: 'ogc-form', novalidate: false }, [
      el('label', { for: 'ogc-email', text: L.email }), el('input', { type: 'email', name: 'email', id: 'ogc-email', required: true, maxlength: '254', autocomplete: 'email' }),
      el('label', { for: 'ogc-name', text: L.name }), el('input', { type: 'text', name: 'name', id: 'ogc-name', required: true, minlength: '2', maxlength: '120', autocomplete: 'name' }),
      el('label', { for: 'ogc-country', text: L.country }), countrySelect,
      el('label', { class: 'ogc-check', for: 'ogc-is-company' }, [companyToggle, document.createTextNode(L.company)]),
      companyBox, loading, peBox, errBox, btn, el('p', { class: 'ogc-small', text: L.secure }),
    ]);
    root.appendChild(form);
    root.appendChild(status);
    root.appendChild(help);
    companyToggle.addEventListener('change', function () {
      companyBox.hidden = !companyToggle.checked;
      form.elements.company.required = companyToggle.checked;
    });
    countrySelect.addEventListener('change', function () {
      countrySelect.setCustomValidity(countryError());
    });

    var ready = false, busy = false, blocked = null, pending = null, stripe = null, elements = null;
    function setButton() { if (!busy) { btn.textContent = fill(L.pay, { price: price }); btn.disabled = !ready || !!blocked; } }
    function setBusy(on) {
      busy = on;
      if (on) {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.textContent = '';
        btn.appendChild(el('span', { class: 'ogc-spin', 'aria-hidden': 'true' }));
        btn.appendChild(document.createTextNode(L.paying));
      } else {
        btn.removeAttribute('aria-busy');
        setButton();
      }
    }
    function showError(msg) { errBox.textContent = msg; errBox.hidden = false; setBusy(false); }
    function block(msg) { blocked = msg; errBox.textContent = msg; errBox.hidden = false; btn.disabled = true; }
    function setStatus(text, cls, more) {
      status.textContent = text;
      status.className = 'ogc-status ' + (cls || '');
      status.hidden = false;
      help.textContent = more || '';
      help.hidden = !more;
    }

    /** POST fulfil until the payment is confirmed (the 10-minute trigger delivers anyway if this tab closes). */
    function finish(pi, secret, email) {
      form.hidden = true;
      setStatus(L.confirming, '', L.later);
      var tries = 0;
      return new Promise(function (resolve) {
        (function attemptFulfil() {
          tries++;
          post(o.endpoint, { action: 'fulfil', payment_intent: pi, client_secret: secret, lang: lang })
            .then(function (j) {
              if (j.ok) {
                root.setAttribute('data-ogc-fulfilled', '1');
                setStatus(fill(L.done, { email: j.email_masked || email || '' }), 'ogc-ok', fill(L.doneHelp, { order: j.order_id }));
                if (typeof o.onSuccess === 'function') o.onSuccess({ orderId: j.order_id, receipt: j.invoice, paymentIntent: pi });
                resolve(j);
              } else if (j.error === 'not_paid' && tries < 8) {
                setTimeout(attemptFulfil, 1500 * tries);
              } else {
                setStatus(j.error === 'not_paid' ? L.confirming : (j.message || L.unreachable), j.error === 'not_paid' ? '' : 'ogc-err', L.later);
                resolve(j);
              }
            })
            .catch(function () {
              if (tries < 5) { setTimeout(attemptFulfil, 1500 * tries); return; }
              setStatus(L.unreachable, 'ogc-err', L.later);
              resolve(null);
            });
        })();
      });
    }

    // Back from a 3-D Secure (or local-method) redirect: finish the order from the URL, then clean the URL.
    var q = new URLSearchParams(global.location.search);
    if (q.get('payment_intent') && q.get('payment_intent_client_secret')) {
      var piId = q.get('payment_intent'), secret = q.get('payment_intent_client_secret'), rs = q.get('redirect_status');
      if (global.history.replaceState) {
        ['payment_intent', 'payment_intent_client_secret', 'redirect_status'].forEach(function (k) { q.delete(k); });
        global.history.replaceState(null, '', global.location.pathname + (q.toString() ? '?' + q : '') + global.location.hash);
      }
      if (rs && rs !== 'succeeded' && rs !== 'pending') { setStatus(L.failed, 'ogc-err'); }
      else { finish(piId, secret, ''); return { root: root }; }
    }

    track(o, 'checkout_view');
    loadStripe().then(function () {
      stripe = global.Stripe(o.publishableKey, { locale: lang });
      var eo = { mode: 'payment', amount: o.amount, currency: o.currency, locale: lang };
      if (pmOpts.configuration) eo.paymentMethodConfiguration = pmOpts.configuration;
      else eo.paymentMethodTypes = pmOpts.types;
      if (o.appearance) eo.appearance = o.appearance;
      elements = stripe.elements(eo);
      var pe = elements.create('payment', { layout: 'tabs', fields: { billingDetails: { name: 'never', email: 'never', address: { country: 'never' } } } });
      pe.on('ready', function () { ready = true; loading.hidden = true; root.setAttribute('data-ogc-ready', '1'); setButton(); });
      pe.on('loaderror', function () { loading.hidden = true; block(L.loadFail); });
      pe.mount(peBox);
    }).catch(function () { loading.hidden = true; block(L.loadFail); });

    // Background price check (never blocks the mount): the server catalog is the price authority.
    fetch(o.endpoint + '?action=catalog&product=' + encodeURIComponent(o.product) + '&lang=' + lang, { redirect: 'follow', credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (c) {
        if (!c.ok) block(c.message || L.loadFail);
        else if (c.amount !== o.amount || c.currency !== o.currency) block(fill(L.stale, { price: formatPrice(c.amount, c.currency, lang) }));
        else if (c.countries && !served) restrict(c.countries);
      })
      .catch(function () { /* createIntent re-checks everything */ });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy || !elements) return;
      if (blocked) { errBox.textContent = blocked; errBox.hidden = false; return; }
      errBox.hidden = true;
      countrySelect.setCustomValidity(countryError());
      if (!form.reportValidity()) return;
      track(o, 'checkout_start');
      if (o.track !== false) croGoal('checkout');
      setBusy(true);
      var f = form.elements;
      var isCompany = companyToggle.checked;
      var body = {
        action: 'createIntent',
        product: o.product,
        venture: o.venture || '',
        email: f.email.value.trim(),
        name: f.name.value.trim(),
        country: countrySelect.value,
        company: isCompany ? f.company.value.trim() : '',
        taxId: isCompany ? f.taxId.value.trim() : '',
        lang: lang,
        expectedAmount: o.amount,
        expectedCurrency: o.currency,
        attempt: attempt,
      };
      if (pmOpts.configuration) body.paymentMethodConfiguration = pmOpts.configuration;
      if (o.smokeToken) body.smokeToken = o.smokeToken;
      // Our tests (octave_notrack, automated browser): the backend marks the PaymentIntent metadata.test and keeps it
      // out of the funnel and `paid` counters (1.5.0). Never a reason to refuse a sale.
      var tx = exclusion(new URLSearchParams(global.location.search));
      if (tx === 'notrack' || tx === 'webdriver') body.test = tx;
      var xp = o.track === false ? '' : xpOf();
      if (xp) body.xp = xp;
      var key = JSON.stringify(body);
      elements.submit().then(function (r) {
        if (r.error) throw r.error;
        if (pending && pending.key === key) return pending;
        var previous = pending;
        return post(o.endpoint, body).then(function (j) {
          if (!j.ok || !j.client_secret) throw new Error(j.message || L.unreachable);
          // The server is the price authority: never confirm an amount or methods other than the ones displayed.
          var pmBack = j.paymentMethods || {};
          if (j.amount !== o.amount || j.currency !== o.currency || (pmOpts.configuration || '') !== (pmBack.configuration || '')) {
            block(fill(L.stale, { price: formatPrice(j.amount, j.currency, lang) }));
            throw null;
          }
          // An edited form gives a new order: abandon the previous, unconfirmed PaymentIntent.
          if (previous) {
            root.setAttribute('data-ogc-cancel', 'pending');
            cancelIntent(o.endpoint, previous, lang).then(function (c) {
              root.setAttribute('data-ogc-cancel', c.ok ? 'ok' : 'failed');
              if (typeof o.onCancel === 'function') { try { o.onCancel({ paymentIntent: previous.pi, ok: c.ok, error: c.error, tries: c.tries }); } catch (e) { /* page callback */ } }
            });
          }
          pending = { key: key, clientSecret: j.client_secret, pi: j.payment_intent };
          return pending;
        });
      }).then(function (p) {
        var returnUrl = o.returnUrl || global.location.href.split('#')[0];
        return stripe.confirmPayment({
          elements: elements,
          clientSecret: p.clientSecret,
          redirect: 'if_required',
          confirmParams: { return_url: returnUrl, payment_method_data: { billing_details: { name: body.name, email: body.email, address: { country: body.country } } } },
        }).then(function (r) {
          if (r.error) { showError(r.error.message || L.failed); return; }
          return finish(p.pi, p.clientSecret, body.email);
        });
      }).catch(function (err) {
        if (err === null) { busy = false; btn.removeAttribute('aria-busy'); btn.textContent = fill(L.pay, { price: price }); btn.disabled = true; return; }
        showError((err && err.message) || L.failed);
      });
    });
    return { root: root, form: form };
  }

  global.OctaveCheckout = {
    mount: mount,
    /** Page-level audience hit, e.g. OctaveCheckout.track('as-in-01', 'view'). */
    track: function (venture, event, opts) {
      track({ venture: venture, endpoint: (opts && opts.endpoint) || DEFAULTS.endpoint, track: true }, event);
    },
    /** Internal (unit tests): cancelIntent(endpoint, { pi, clientSecret }, lang) with one retry. */
    _cancelIntent: cancelIntent,
    version: '1.5.0',
  };
})(window);
