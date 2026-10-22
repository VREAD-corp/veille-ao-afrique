/**
 * Veille AO Afrique — e-mail alerts for the free sign-ups (2026-10-21; sender moved to alertes@jalonel.com 2026-10-22).
 *
 * This file decides who receives what; it never sends anything. The e-mails leave from the Jalonel mailbox
 * alertes@jalonel.com (OVHcloud MX Plan, SMTP) through the GitHub Actions workflow .github/workflows/alerts.yml
 * (aoafrique/alerts.py), so no alert is ever sent from the script owner's Google account (no MailApp, no
 * send_mail scope, no time trigger).
 *
 *   alerts_plan     POST {token, mode: 'real'|'test', feed}: from the public feed data/alertes.json (open notices first
 *                   seen in the last 8 days), fetched and passed in by the workflow (this script needs no
 *                   external_request scope, only spreadsheets), returns for each active sign-up (kind `alertes`, not withdrawn;
 *                   mode real: not `test`; mode test: only `test` rows), the e-mail to send today (subject, text,
 *                   HTML, one-click unsubscribe URL; test mode may add `only`: one test address) with the notices first seen since its last e-mail that match its
 *                   sectors, regions and zone. Nothing when nothing is new; `hebdomadaire` at most every 7 days.
 *   alerts_confirm  POST {token, mode, run, sent: [{email, last_first_seen}], failed: [{email, error}]}: after the
 *                   SMTP run, one row per address in `Alertes_etat` (only active sign-ups of that mode), one row per
 *                   run in `Alertes_envois` (counts, errors, no address); a real run also sets ALERTS_LAST_RUN,
 *                   shown by the public `alerts_status` (no personal data) for the daily monitor.
 *   alerts_plan writes nothing: `python -m aoafrique alerts --mode real --dry-run` is the dry run.
 *
 * Token: ALERTS_TOKEN_ (git-ignored Secret.js, also the GitHub secret AOAF_ALERTS_TOKEN). Sender name
 * « Veille AO Afrique (Jalonel) », reply-to contact@jalonel.com, one-click unsubscribe (unsubscribe_, HMAC LINK_KEY_,
 * also as List-Unsubscribe / List-Unsubscribe-Post headers).
 */

var ALERT_SITE_ = 'https://ao-afrique.jalonel.com/';
var ALERT_WEBAPP_URL_ = 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec';
var ALERT_FROM_ = 'alertes@jalonel.com';
var ALERT_SENDER_ = 'Veille AO Afrique (Jalonel)';
var ALERT_REPLY_TO_ = 'contact@jalonel.com';
var ALERT_VIA_ = 'smtp ' + ALERT_FROM_ + ' (OVHcloud) via GitHub Actions';
var ALERT_MAX_ITEMS_ = 25;      // notices listed in one e-mail; the rest through a link to the filtered list
var ALERT_MAX_MAILS_ = 150;     // e-mails per run (the OVHcloud mailbox allows about 200 an hour); the rest wait a day
var ALERT_WEEKLY_DAYS_ = 6.5;
var ALERT_STATE_HEADER_ = ['email', 'last_sent_at', 'last_first_seen', 'mails', 'updated_at'];
var ALERT_RUNS_HEADER_ = ['at', 'feed_updated', 'feed_count', 'subscribers', 'sent', 'nothing_new', 'weekly_wait', 'deferred', 'errors', 'quota_left', 'duration_ms', 'detail'];
var ALERT_MONTHS_ = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* ------------------------------------------------------------------ web-app actions (token) */

function alertsAuth_(req) {
  var token = typeof ALERTS_TOKEN_ === 'string' && ALERTS_TOKEN_.length >= 32 ? ALERTS_TOKEN_ : '';
  if (!token || String(req.token || '') !== token) throw userError_('forbidden', 'Accès refusé.');
}

function alertsPlanAction_(req) {
  alertsAuth_(req);
  if (req.mode !== 'real' && req.mode !== 'test') throw userError_('bad_request', 'mode');
  // Test mode may be narrowed to one test address (`only`), so an end-to-end check mails nobody else.
  var only = req.mode === 'test' && req.only ? String(req.only).trim().toLowerCase() : '';
  var plan = alertPlan_(req.mode === 'test', only, alertFeed_(req.feed));
  return { ok: true, mode: req.mode, from: ALERT_FROM_, sender: ALERT_SENDER_, reply_to: ALERT_REPLY_TO_, max_mails: ALERT_MAX_MAILS_,
    feed_updated: plan.feed_updated, feed_count: plan.feed_count, subscribers: plan.subscribers, nothing_new: plan.nothing_new,
    weekly_wait: plan.weekly_wait, detail: plan.detail, mails: plan.mails };
}

/** What each active sign-up of the mode should receive today. */
function alertPlan_(testMode, only, feed) {
  var now = now_();
  var out = { feed_updated: feed.updated || '', feed_count: feed.notices.length, subscribers: 0, nothing_new: 0, weekly_wait: 0, detail: [], mails: [] };
  if (feed.updated && now.getTime() - new Date(feed.updated).getTime() > 36 * 3600e3) out.detail.push('feed stale (' + feed.updated + ')');
  var subs = alertSubscribers_(testMode).filter(function (x) { return !only || x.email === only; });
  out.subscribers = subs.length;
  var state = alertState_(tab_('Alertes_etat', ALERT_STATE_HEADER_));
  subs.forEach(function (sub) {
    var st = state[sub.email] || null;
    if (sub.frequency === 'hebdomadaire' && st && st.last_sent_at && now.getTime() - new Date(st.last_sent_at).getTime() < ALERT_WEEKLY_DAYS_ * 86400e3) {
      out.weekly_wait++;
      return;
    }
    // New sign-ups: notices first seen from the day of the sign-up on.
    var since = (st && st.last_first_seen) || dayBefore_(sub.since);
    var items = feed.notices.filter(function (n) { return n.f > since && alertMatches_(sub, n); });
    if (!items.length) { out.nothing_new++; return; }
    var mail = alertMail_(sub, items, feed.sectors, !st);
    out.mails.push({ email: sub.email, notices: items.length, subject: mail.subject, text: mail.body, html: mail.html, unsubscribe: mail.unsubscribe,
      last_first_seen: items.reduce(function (a, n) { return n.f > a ? n.f : a; }, since) });
  });
  return out;
}

/** After the SMTP run: per-address state, run log, last-run status (real mode). Only active sign-ups are written. */
function alertsConfirmAction_(req) {
  alertsAuth_(req);
  if (req.mode !== 'real' && req.mode !== 'test') throw userError_('bad_request', 'mode');
  var run = req.run && typeof req.run === 'object' ? req.run : {};
  var sent = Array.isArray(req.sent) ? req.sent : [];
  var failed = Array.isArray(req.failed) ? req.failed : [];
  var now = now_();
  var num = function (v) { var n = Number(v); return isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw userError_('busy', 'Service occupé, réessayez.');
  var s = { at: now.toISOString(), feed_updated: String(run.feed_updated || '').slice(0, 40), feed_count: num(run.feed_count), subscribers: num(run.subscribers),
    sent: 0, nothing_new: num(run.nothing_new), weekly_wait: num(run.weekly_wait), deferred: num(run.deferred), errors: 0,
    quota_left: num(run.quota_left), duration_ms: num(run.duration_ms), detail: [] };
  try {
    var active = {};
    alertSubscribers_(req.mode === 'test').forEach(function (x) { active[x.email] = true; });
    var stateSheet = tab_('Alertes_etat', ALERT_STATE_HEADER_);
    var state = alertState_(stateSheet);
    sent.forEach(function (m) {
      var email = String((m && m.email) || '').trim().toLowerCase();
      var lfs = String((m && m.last_first_seen) || '');
      if (!active[email] || !/^\d{4}-\d{2}-\d{2}/.test(lfs)) { s.errors++; s.detail.push('confirm refused for ' + maskEmail_(email)); return; }
      var st = state[email] || null;
      saveAlertState_(stateSheet, state, email, { last_sent_at: now.toISOString(), last_first_seen: lfs.slice(0, 25), mails: ((st && Number(st.mails)) || 0) + 1, updated_at: now.toISOString() });
      s.sent++;
    });
    failed.forEach(function (m) {
      s.errors++;
      s.detail.push(maskEmail_(String((m && m.email) || '')) + ': ' + String((m && m.error) || '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, 200));
    });
    if (Array.isArray(run.detail)) run.detail.forEach(function (d) { s.detail.push(String(d).replace(/[\u0000-\u001f]+/g, ' ').slice(0, 200)); });
    s.detail.unshift('mode ' + req.mode + ', ' + ALERT_VIA_);
    tab_('Alertes_envois', ALERT_RUNS_HEADER_).appendRow(ALERT_RUNS_HEADER_.map(function (h) {
      return h === 'detail' ? s.detail.join(' ; ').slice(0, 1000) : (h === 'at' || h === 'feed_updated' ? txt_(s[h]) : s[h]);
    }));
    if (req.mode === 'real') {
      PropertiesService.getScriptProperties().setProperty('ALERTS_LAST_RUN', JSON.stringify({
        at: s.at, ok: s.errors === 0, sent: s.sent, errors: s.errors, feed_updated: s.feed_updated, deferred: s.deferred }));
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, mode: req.mode, sent: s.sent, errors: s.errors };
}

/** Public, no personal data: when the last real alert run happened, whether it went well, and how alerts leave. */
function alertsStatus_() {
  var raw = PropertiesService.getScriptProperties().getProperty('ALERTS_LAST_RUN');
  var last = raw ? JSON.parse(raw) : null;
  return { ok: true, service: SITE_, sender: ALERT_FROM_, via: 'github-actions-smtp',
    alerts: last ? { at: last.at, ok: last.ok, sent: last.sent, errors: last.errors, feed_updated: last.feed_updated } : null };
}

/* ------------------------------------------------------------------ pieces */

/** The feed data/alertes.json as sent by the workflow, checked; only the fields the e-mails use are kept. */
function alertFeed_(feed) {
  if (!feed || typeof feed !== 'object' || !Array.isArray(feed.notices)) throw userError_('feed_unavailable', 'feed without notices');
  var str = function (v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; };
  var arr = function (v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }).map(function (x) { return x.slice(0, 80); }).slice(0, 30) : []; };
  var notices = [];
  feed.notices.slice(0, 20000).forEach(function (n) {
    if (!n || !/^[a-z0-9-]{3,200}$/.test(String(n.i)) || !/^\d{4}-\d{2}-\d{2}/.test(String(n.f))) return;
    notices.push({ i: n.i, o: str(n.o, 500), b: str(n.b, 200), s: arr(n.s), r: arr(n.r), k: str(n.k, 60), x: str(n.x, 10), d: str(n.d, 25), f: str(n.f, 25), p: arr(n.p) });
  });
  var sectors = {};
  if (feed.sectors && typeof feed.sectors === 'object') Object.keys(feed.sectors).slice(0, 100).forEach(function (k) { sectors[k] = str(feed.sectors[k], 80); });
  return { updated: str(feed.updated, 40), sectors: sectors, notices: notices };
}

/** Active alert sign-ups, one per address: criteria of the latest row, `since` = day of the first row. testMode: only the
 * `test` rows (end-to-end checks); otherwise only the real ones. A withdrawal on any row stops the address. */
function alertSubscribers_(testMode) {
  var sh = tab_('Inscriptions', SIGNUP_HEADER_);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, SIGNUP_HEADER_.length).getValues();
  var withdrawn = {};
  var by = {};
  rows.forEach(function (r) {
    var email = cellText_(r[1]).toLowerCase();
    if (!email) return;
    if (r[15]) { withdrawn[email] = true; return; }
    if (r[2] !== 'alertes' || (r[14] === 'oui') !== !!testMode) return;
    var at = cellText_(r[0]);
    var split = function (v) { return cellText_(v).split(',').map(function (x) { return x.trim(); }).filter(String); };
    var cur = by[email];
    var row = { email: email, since: parisDate_(new Date(at)), at: at, sectors: split(r[6]), countries: split(r[7]), regions: split(r[8]), frequency: cellText_(r[9]) || 'quotidien' };
    if (!cur) { by[email] = row; return; }
    if (at > cur.at) { row.since = cur.since; by[email] = row; } else if (row.since < cur.since) cur.since = row.since;
  });
  return Object.keys(by).filter(function (k) { return !withdrawn[k]; }).map(function (k) { return by[k]; });
}

/** 'Côte d'Ivoire' -> 'cote-d-ivoire': the country value of the sign-up forms (pays pages, Bénin and Tunisie boxes). */
function countrySlug_(k) {
  return String(k || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function alertMatches_(sub, n) {
  var countries = sub.countries.length ? sub.countries : ['maroc'];
  if (n.x === 'BM') {
    if (countries.indexOf('afrique-francophone') < 0 && countries.indexOf(countrySlug_(n.k)) < 0) return false;
  } else if (n.x && n.x !== 'PMMP') {
    // National portals other than Morocco's (BJ, TN): only for those who chose that country.
    if (countries.indexOf(countrySlug_(n.k)) < 0) return false;
  } else {
    if (countries.indexOf('maroc') < 0) return false;
    if (sub.regions.length && !(n.r || []).some(function (r) { return sub.regions.indexOf(r) >= 0; })) return false;
  }
  if (sub.sectors.length && !(n.s || []).some(function (x) { return sub.sectors.indexOf(x) >= 0; })) return false;
  return true;
}

function alertState_(sheet) {
  var out = {};
  var last = sheet.getLastRow();
  if (last < 2) return out;
  sheet.getRange(2, 1, last - 1, ALERT_STATE_HEADER_.length).getValues().forEach(function (r, i) {
    out[cellText_(r[0]).toLowerCase()] = { row: i + 2, last_sent_at: cellText_(r[1]), last_first_seen: cellText_(r[2]), mails: r[3] };
  });
  return out;
}

function saveAlertState_(sheet, state, email, v) {
  var values = [txt_(email), txt_(v.last_sent_at), txt_(v.last_first_seen), v.mails, txt_(v.updated_at)];
  var cur = state[email];
  if (cur && cur.row) sheet.getRange(cur.row, 1, 1, values.length).setValues([values]);
  else { sheet.appendRow(values); cur = { row: sheet.getLastRow() }; }
  state[email] = { row: cur.row, last_sent_at: v.last_sent_at, last_first_seen: v.last_first_seen, mails: v.mails };
}

function dayBefore_(iso) {
  var d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function frDate_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(iso || ''));
  if (!m) return '';
  var day = Number(m[3]) === 1 ? '1er' : String(Number(m[3]));
  return day + ' ' + ALERT_MONTHS_[Number(m[2]) - 1] + ' ' + m[1] + (m[4] ? ' à ' + Number(m[4]) + ' h' + (m[5] !== '00' ? ' ' + m[5] : '') : '');
}

function maskEmail_(email) { return String(email).replace(/^(.).*(@.*)$/, '$1…$2'); }

function escHtml_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var COUNTRY_NAMES_ = { benin: 'Bénin', tunisie: 'Tunisie', senegal: 'Sénégal', 'cote-d-ivoire': "Côte d'Ivoire", cameroun: 'Cameroun',
  niger: 'Niger', mali: 'Mali', 'burkina-faso': 'Burkina Faso', togo: 'Togo', guinee: 'Guinée', madagascar: 'Madagascar',
  'rd-congo': 'RD Congo', congo: 'Congo', tchad: 'Tchad', mauritanie: 'Mauritanie', djibouti: 'Djibouti', comores: 'Comores',
  burundi: 'Burundi', centrafrique: 'Centrafrique', gabon: 'Gabon' };

function criteriaText_(sub, labels) {
  var parts = [];
  parts.push(sub.sectors.length ? sub.sectors.map(function (x) { return (labels && labels[x]) || x; }).join(', ') : 'tous secteurs');
  var countries = sub.countries.length ? sub.countries : ['maroc'];
  var zones = [];
  if (countries.indexOf('maroc') >= 0) zones.push('Maroc' + (sub.regions.length ? ' (' + sub.regions.length + ' région' + (sub.regions.length > 1 ? 's' : '') + ')' : ', toutes régions'));
  if (countries.indexOf('afrique-francophone') >= 0) zones.push('Afrique francophone (Banque mondiale)');
  countries.forEach(function (c) {
    if (c !== 'maroc' && c !== 'afrique-francophone') zones.push(COUNTRY_NAMES_[c] || c);
  });
  parts.push(zones.join(' et '));
  return parts.join(' ; ');
}

function listUrl_(sub) {
  var q = [];
  if (sub.sectors.length === 1) q.push('secteur=' + encodeURIComponent(sub.sectors[0]));
  return ALERT_SITE_ + (q.length ? '?' + q.join('&') : '') + '#liste';
}

function alertMail_(sub, items, labels, first) {
  var n = items.length;
  var shown = items.slice(0, ALERT_MAX_ITEMS_);
  var subject = n + (n > 1 ? ' nouveaux appels d’offres' : ' nouvel appel d’offres') + ' pour vos critères – Veille AO Afrique';
  var unsub = ALERT_WEBAPP_URL_ + '?action=unsubscribe&email=' + encodeURIComponent(sub.email) + '&t=' + hmac_(sub.email);
  var utm = 'utm_source=alerte&utm_medium=email&utm_campaign=alertes-quotidiennes';
  var url = function (x) { return ALERT_SITE_ + 'ao/' + x.i + '/?' + utm; };
  var place = function (x) { return x.x === 'BM' ? x.k : (x.p && x.p.length ? x.p.join(', ') : 'Maroc'); };
  var text = ['Bonjour,', '', (n > 1 ? 'Voici les ' + n + ' appels d’offres publiés' : 'Voici l’appel d’offres publié') + (first ? ' depuis votre inscription' : ' depuis notre dernier envoi') + ' qui correspondent à vos critères (' + criteriaText_(sub, labels) + ').', ''];
  var html = ['<p>Bonjour,</p><p>' + escHtml_(text[2]) + '</p><ol style="padding-left:1.2em">'];
  shown.forEach(function (x) {
    var dl = frDate_(x.d);
    text.push('- ' + x.o, '  ' + [x.b, place(x), dl ? 'date limite : ' + dl : ''].filter(String).join(' · '), '  ' + url(x), '');
    html.push('<li style="margin:0 0 .8em"><a href="' + escHtml_(url(x)) + '">' + escHtml_(x.o) + '</a><br><span style="color:#555;font-size:90%">' +
      escHtml_([x.b, place(x), dl ? 'date limite : ' + dl : ''].filter(String).join(' · ')) + '</span></li>');
  });
  html.push('</ol>');
  if (n > shown.length) {
    text.push('Et ' + (n - shown.length) + ' autres : ' + listUrl_(sub), '');
    html.push('<p>Et ' + (n - shown.length) + ' autres : <a href="' + escHtml_(listUrl_(sub)) + '">voir la liste</a>.</p>');
  }
  var foot = [
    'L’avis officiel fait foi : vérifiez-le avant de préparer une offre.',
    'Vous recevez cet e-mail parce que vous avez demandé les alertes de Veille AO Afrique le ' + frDate_(sub.since) + ' (' + (sub.frequency === 'hebdomadaire' ? 'une fois par semaine' : 'au plus un e-mail par matin, seulement s’il y a du nouveau') + '). Gratuit pendant le test, rien ne vous sera facturé sans votre accord.',
    'Se désinscrire en un clic : ' + unsub,
    'Veille AO Afrique est un service Jalonel, marque de READ FRANCE SAS (SIREN 988 741 773), 11 rue Rouvet, 75019 Paris. Contact : ' + ALERT_REPLY_TO_ + '.',
  ];
  text = text.concat(foot);
  html.push('<hr style="border:0;border-top:1px solid #ddd"><p style="color:#555;font-size:85%">' + escHtml_(foot[0]) + '<br>' + escHtml_(foot[1]) +
    '<br><a href="' + escHtml_(unsub) + '">Se désinscrire en un clic</a><br>' + escHtml_(foot[3]) + '</p>');
  return { subject: subject, body: text.join('\n'), html: html.join(''), unsubscribe: unsub };
}
