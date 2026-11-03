/**
 * Veille AO Afrique — one-off announcement « Fin du test gratuit » (2026-11-03). Draft:
 * ~/.local/share/octave/plan-attention/AOAF-MAIL-FIN-TEST.md (sent only after the founder's written agreement).
 *
 * Like Alerts.js, this file never sends anything: the e-mails leave from alertes@jalonel.com through the manual
 * GitHub Actions workflow .github/workflows/announce.yml (aoafrique/announce.py, same SMTP as the alerts).
 *
 *   announce_plan     POST {token, mode: 'real'|'test', sectors?, only?}: read-only, writes nothing. Returns, for each
 *                     recipient, the e-mail (subject, text, HTML, one-click unsubscribe URL). Real recipients: active
 *                     alert sign-ups (kind `alertes`, not `test`, not withdrawn) with no paid period ever, except those
 *                     declared established in another EU country than France (announceRegion_; since 2026-11-03
 *                     professionals in France can pay, and the checkout itself refuses buyers it cannot sell to). Test mode:
 *                     only the `test` sign-up whose address is `only`, withdrawn or not (no country filter, so its
 *                     rendering can be read).
 *                     Real mode also returns `already` once the announcement has been claimed (then no e-mail).
 *   announce_confirm  POST {token, mode, stage: 'start'|'done', planned?, sent?, failed?}. Real `start` claims the
 *                     one real run (script property ANNOUNCE_FIN_TEST_KEY_, under the script lock): a second claim is
 *                     refused with `already_sent`, so the announcement can go out once only, even if a run dies midway.
 *                     `done` writes one row in `Annonces_envois` (counts, masked errors, no address) and, in real mode,
 *                     the result into the marker. Test mode never sets the marker.
 *
 * Token: ALERTS_TOKEN_ (GitHub secret AOAF_ALERTS_TOKEN), as alerts_plan. Scope unchanged: spreadsheets only.
 */

var ANNOUNCE_ID_ = 'fin-test-2026-11';
var ANNOUNCE_FIN_TEST_KEY_ = 'ANNOUNCE_FIN_TEST';
var ANNOUNCE_RUNS_HEADER_ = ['at', 'announce', 'mode', 'stage', 'planned', 'sent', 'errors', 'detail'];
// Literal, not ALERT_SITE_ +: no dependency on the load order of the script files.
var ANNOUNCE_URL_ = 'https://ao-afrique.jalonel.com/alertes/?utm_source=annonce&utm_medium=email&utm_campaign=fin-test#offres';
// Declared « Votre entreprise est établie en » (form of /alertes/): only « Autre pays d'Europe » is left out, the
// closest value to « another EU country than France » (it may be Switzerland or the UK: we cannot tell, so no e-mail).
// No declared country (webmail, .com…): included, the checkout refuses the buyers it cannot sell to, with a message.
var ANNOUNCE_COUNTRY_DROP_ = ['autre-europe'];

/* ------------------------------------------------------------------ web-app actions (token) */

function announcePlanAction_(req) {
  alertsAuth_(req);
  if (req.mode !== 'real' && req.mode !== 'test') throw userError_('bad_request', 'mode');
  var test = req.mode === 'test';
  var only = test ? String(req.only || '').trim().toLowerCase() : '';
  if (test && !only) throw userError_('bad_request', 'only');
  var labels = {};
  if (req.sectors && typeof req.sectors === 'object') {
    Object.keys(req.sectors).slice(0, 100).forEach(function (k) { if (typeof req.sectors[k] === 'string') labels[k] = req.sectors[k].slice(0, 80); });
  }
  var out = { ok: true, mode: req.mode, announce: ANNOUNCE_ID_, from: ALERT_FROM_, sender: ALERT_SENDER_, reply_to: ALERT_REPLY_TO_,
    max_mails: ALERT_MAX_MAILS_, already: null, subscribers: 0, excluded: { paid: 0, eu: 0 }, mails: [] };
  if (!test) {
    var raw = PropertiesService.getScriptProperties().getProperty(ANNOUNCE_FIN_TEST_KEY_);
    if (raw) { out.already = JSON.parse(raw); return out; }
  }
  // Test mode: the `test` sign-up `only`, even withdrawn (it is ours; its unsubscribe link was tested on 22/10).
  var subs = alertSubscribers_(test, test);
  if (test) subs = subs.filter(function (x) { return x.email === only; });
  out.subscribers = subs.length;
  var countries = test ? {} : companyCountries_();
  var everPaid = test ? {} : everPaid_();
  subs.forEach(function (sub) {
    if (!test) {
      if (sub.paid || everPaid[sub.email]) { out.excluded.paid++; return; }
      if (announceRegion_(countries[sub.email] || '') === 'eu') { out.excluded.eu++; return; }
    }
    var mail = announceMail_(sub, labels);
    out.mails.push({ email: sub.email, subject: mail.subject, text: mail.body, html: mail.html, unsubscribe: mail.unsubscribe });
  });
  return out;
}

function announceConfirmAction_(req) {
  alertsAuth_(req);
  if (req.mode !== 'real' && req.mode !== 'test') throw userError_('bad_request', 'mode');
  if (req.stage !== 'start' && req.stage !== 'done') throw userError_('bad_request', 'stage');
  var num = function (v) { var n = Number(v); return isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
  var clean = function (v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').slice(0, 200); };
  var real = req.mode === 'real';
  var now = now_().toISOString();
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw userError_('busy', 'Service occupé, réessayez.');
  try {
    var raw = props.getProperty(ANNOUNCE_FIN_TEST_KEY_);
    var marker = raw ? JSON.parse(raw) : null;
    if (req.stage === 'start') {
      if (real) {
        if (marker) throw userError_('already_sent', 'Annonce déjà lancée le ' + marker.started_at + '.');
        props.setProperty(ANNOUNCE_FIN_TEST_KEY_, JSON.stringify({ announce: ANNOUNCE_ID_, started_at: now, planned: num(req.planned), done: false }));
      }
      return { ok: true, mode: req.mode, stage: 'start', started_at: now };
    }
    if (real && (!marker || marker.done)) throw userError_('bad_request', marker ? 'déjà confirmé' : 'stage start manquant');
    var sent = Array.isArray(req.sent) ? req.sent.length : num(req.sent);
    var failed = Array.isArray(req.failed) ? req.failed : [];
    var detail = ['annonce ' + ANNOUNCE_ID_ + ', mode ' + req.mode + ', ' + ALERT_VIA_].concat(failed.slice(0, 50).map(function (m) {
      return maskEmail_(String((m && m.email) || '')) + ': ' + clean(m && m.error);
    }));
    tab_('Annonces_envois', ANNOUNCE_RUNS_HEADER_).appendRow([txt_(now), ANNOUNCE_ID_, req.mode, 'done', num(req.planned), sent, failed.length, detail.join(' ; ').slice(0, 1000)]);
    if (real) {
      marker.done = true; marker.done_at = now; marker.sent = sent; marker.errors = failed.length;
      props.setProperty(ANNOUNCE_FIN_TEST_KEY_, JSON.stringify(marker));
    }
    return { ok: true, mode: req.mode, stage: 'done', sent: sent, errors: failed.length };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ pieces */

/** 'eu' when declared established in another EU country than France, otherwise 'ok'. */
function announceRegion_(companyCountry) {
  return ANNOUNCE_COUNTRY_DROP_.indexOf(String(companyCountry || '').trim().toLowerCase()) >= 0 ? 'eu' : 'ok';
}

/** Latest non-empty « établie en » of each real address (any kind of row). */
function companyCountries_() {
  var sh = tab_('Inscriptions', SIGNUP_HEADER_);
  var last = sh.getLastRow();
  var out = {}, at = {};
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, SIGNUP_HEADER_.length).getValues().forEach(function (r) {
    var email = cellText_(r[1]).toLowerCase(), c = cellText_(r[5]).trim().toLowerCase(), t = cellText_(r[0]);
    if (!email || !c || r[14] === 'oui') return;
    if (!at[email] || t > at[email]) { at[email] = t; out[email] = c; }
  });
  return out;
}

/** Real addresses with any paid row, running or not: they are not « gratuits ». */
function everPaid_() {
  var sh = tab_('Abonnements', SUBS_HEADER_);
  var last = sh.getLastRow();
  var out = {};
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, SUBS_HEADER_.length).getValues().forEach(function (r) {
    var email = cellText_(r[1]).toLowerCase();
    if (email && r[8] !== 'oui') out[email] = true;
  });
  return out;
}

/** The e-mail of the draft AOAF-MAIL-FIN-TEST.md, word for word, with its three variable fields. */
function announceMail_(sub, labels) {
  var unsub = unsubscribeUrl_(sub.email);
  var subject = 'Fin du test gratuit : ce qui change pour vous';
  var p = [
    'Vous recevez les alertes de Veille AO Afrique depuis le ' + frDate_(sub.since) + ' (' + criteriaText_(sub, labels) + '). Le test gratuit s\'est terminé le 3 novembre 2026. Nous aurions dû vous l\'écrire avant : voici ce qui change.',
    'Pour vous, rien pour l\'instant. Vos alertes gratuites continuent, avec les mêmes critères, et vous n\'avez rien à faire. Rien ne vous sera facturé sans votre accord.',
    'Ce qui est nouveau : deux formules payantes, pour avoir 3 mois d\'alertes garanties.',
  ];
  var plans = [
    ['Essentiel', ', 39 € pour 3 mois : les consultations du portail marocain des marchés publics.'],
    ['Pro', ', 79 € pour 3 mois : en plus, les portails nationaux du Bénin et de la Tunisie et les avis en français de la Banque mondiale dans les pays d\'Afrique francophone.'],
  ];
  var terms = 'Paiement unique par carte, sans renouvellement automatique. Remboursement intégral sur simple demande dans les 14 jours. Les formules et les conditions de vente :';
  // Who can pay online: the block « Qui peut payer en ligne » of /alertes/ (CGV of 2026-11-03).
  var who = 'Paiement en ligne ouvert aux entreprises et aux particuliers établis hors de l\'Union européenne, et aux professionnels établis en France, qui indiquent leur SIREN au paiement. Pas de TVA dans les deux cas (en France, la facture porte « TVA non applicable, art. 293 B du CGI »). Dans les autres pays de l\'Union européenne, le paiement en ligne n\'est pas encore ouvert.';
  var ask = 'Une question, un devis pour votre service achats : répondez à ce message.';
  var sign = 'Veille AO Afrique, un service Jalonel';
  var legal = 'Veille AO Afrique est un service Jalonel, marque de READ FRANCE SAS (SIREN 988 741 773), 11 rue Rouvet, 75019 Paris. Contact : ' + ALERT_REPLY_TO_ + '.';
  var text = ['Bonjour,', '', p[0], '', p[1], '', p[2]]
    .concat(plans.map(function (x) { return '- ' + x[0] + x[1]; }))
    .concat(['', terms + ' ' + ANNOUNCE_URL_, '', who, '', ask, '', sign, '', 'Se désinscrire en un clic : ' + unsub, legal]);
  // One block per line, as in the alerts: a client that strips the tags must not glue two sentences.
  var html = ['<p>Bonjour,</p>', '<p>' + escHtml_(p[0]) + '</p>', '<p>' + escHtml_(p[1]) + '</p>', '<p>' + escHtml_(p[2]) + '</p>', '<ul style="padding-left:1.2em">']
    .concat(plans.map(function (x) { return '<li style="margin:0 0 .4em"><strong>' + escHtml_(x[0]) + '</strong>' + escHtml_(x[1]) + '</li>'; }))
    .concat(['</ul>', '<p>' + escHtml_(terms) + ' <a href="' + escHtml_(ANNOUNCE_URL_) + '">ao-afrique.jalonel.com/alertes</a></p>', '<p>' + escHtml_(who) + '</p>',
      '<p>' + escHtml_(ask) + '</p>', '<p>' + escHtml_(sign) + '</p>', '<hr style="border:0;border-top:1px solid #ddd">',
      '<p style="color:#555;font-size:85%"><a href="' + escHtml_(unsub) + '">Se désinscrire en un clic</a><br>\n' + escHtml_(legal) + '</p>']);
  return { subject: subject, body: text.join('\n'), html: html.join('\n'), unsubscribe: unsub };
}
