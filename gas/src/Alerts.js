/**
 * Veille AO Afrique — e-mail alerts for the free sign-ups (2026-10-21).
 *
 *   sendAlerts      daily time trigger (~9 h Europe/Paris, after the 05:20 UTC data refresh): reads the public
 *                   feed data/alertes.json (open notices first seen in the last 8 days, built by aoafrique/site.py),
 *                   and e-mails each active sign-up (kind `alertes`, not a test, not withdrawn) the notices first
 *                   seen since its last e-mail that match its sectors, regions and zone. Nothing is sent when there
 *                   is nothing new; `hebdomadaire` sign-ups get at most one e-mail every 7 days. One row per run in
 *                   `Alertes_envois` (counts, quota, errors, no address), one row per address in `Alertes_etat`.
 *                   An error makes the run throw at the end, so Google e-mails the script owner (trigger failure
 *                   notification), and `alerts_status` (public, no personal data) shows the last run.
 *   installAlerts   run ONCE from the Apps Script editor by the owner: grants the scopes (send_mail,
 *                   external_request, scriptapp) and installs the daily trigger. Re-running replaces the trigger.
 *   previewAlerts   dry run from the editor: what each address would receive today, nothing sent or written.
 *
 * Sender: the script owner's Google account, display name « Veille AO Afrique (Jalonel) », reply-to
 * contact@jalonel.com. Every e-mail carries the one-click unsubscribe link of Code.js (unsubscribe_, HMAC LINK_KEY_).
 */

var ALERT_FEED_URL_ = 'https://ao-afrique.jalonel.com/data/alertes.json';
var ALERT_SITE_ = 'https://ao-afrique.jalonel.com/';
var ALERT_WEBAPP_URL_ = 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec';
var ALERT_SENDER_ = 'Veille AO Afrique (Jalonel)';
var ALERT_REPLY_TO_ = 'contact@jalonel.com';
var ALERT_HOUR_ = 9;            // Europe/Paris
var ALERT_MAX_ITEMS_ = 25;      // notices listed in one e-mail; the rest through a link to the filtered list
var ALERT_QUOTA_RESERVE_ = 3;   // MailApp daily quota kept back
var ALERT_WEEKLY_DAYS_ = 6.5;
var ALERT_STATE_HEADER_ = ['email', 'last_sent_at', 'last_first_seen', 'mails', 'updated_at'];
var ALERT_RUNS_HEADER_ = ['at', 'feed_updated', 'feed_count', 'subscribers', 'sent', 'nothing_new', 'weekly_wait', 'deferred', 'errors', 'quota_left', 'duration_ms', 'detail'];
var ALERT_MONTHS_ = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* ------------------------------------------------------------------ owner actions (Apps Script editor) */

function installAlerts() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAlerts') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendAlerts').timeBased().atHour(ALERT_HOUR_).nearMinute(15).everyDays(1).inTimezone('Europe/Paris').create();
  var msg = 'Déclencheur sendAlerts installé (chaque jour vers ' + ALERT_HOUR_ + ' h 15, Paris). Quota e-mail restant : ' + MailApp.getRemainingDailyQuota();
  console.log(msg);
  return msg;
}

function previewAlerts() {
  var out = runAlerts_({ dryRun: true });
  console.log(JSON.stringify(out, null, 1));
  return out;
}

function sendAlerts() {
  var s = runAlerts_({ dryRun: false });
  if (s.errors) throw new Error('Veille AO Afrique, alertes : ' + s.errors + ' erreur(s) : ' + s.detail.join(' ; ').slice(0, 500));
  return s;
}

/* ------------------------------------------------------------------ run */

function runAlerts_(opt) {
  var t0 = Date.now();
  var now = now_();
  var s = { at: now.toISOString(), feed_updated: '', feed_count: 0, subscribers: 0, sent: 0, nothing_new: 0, weekly_wait: 0, deferred: 0, errors: 0, quota_left: 0, duration_ms: 0, detail: [], preview: [] };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { s.errors++; s.detail.push('lock busy'); return s; }
  try {
    var feed;
    try {
      feed = fetchAlertFeed_();
    } catch (err) {
      s.errors++;
      s.detail.push('feed: ' + String(err && err.message).slice(0, 200));
      return s;
    }
    s.feed_updated = feed.updated || '';
    s.feed_count = feed.notices.length;
    if (feed.updated && now.getTime() - new Date(feed.updated).getTime() > 36 * 3600e3) s.detail.push('feed stale (' + feed.updated + ')');
    var subs = alertSubscribers_();
    s.subscribers = subs.length;
    var stateSheet = tab_('Alertes_etat', ALERT_STATE_HEADER_);
    var state = alertState_(stateSheet);
    var quota = MailApp.getRemainingDailyQuota();
    subs.forEach(function (sub) {
      try {
        var st = state[sub.email] || null;
        if (sub.frequency === 'hebdomadaire' && st && st.last_sent_at && now.getTime() - new Date(st.last_sent_at).getTime() < ALERT_WEEKLY_DAYS_ * 86400e3) {
          s.weekly_wait++;
          return;
        }
        // New sign-ups: notices first seen from the day of the sign-up on.
        var since = (st && st.last_first_seen) || dayBefore_(sub.since);
        var items = feed.notices.filter(function (n) { return n.f > since && alertMatches_(sub, n); });
        if (!items.length) { s.nothing_new++; return; }
        if (opt.dryRun) { s.preview.push({ to: maskEmail_(sub.email), notices: items.length, first: items[0].o.slice(0, 80) }); return; }
        if (quota - ALERT_QUOTA_RESERVE_ <= 0) { s.deferred++; return; }
        var mail = alertMail_(sub, items, feed.sectors, !st);
        MailApp.sendEmail({ to: sub.email, subject: mail.subject, body: mail.body, htmlBody: mail.html, name: ALERT_SENDER_, replyTo: ALERT_REPLY_TO_ });
        quota--;
        s.sent++;
        var last = items.reduce(function (a, n) { return n.f > a ? n.f : a; }, since);
        saveAlertState_(stateSheet, state, sub.email, { last_sent_at: now.toISOString(), last_first_seen: last, mails: ((st && Number(st.mails)) || 0) + 1, updated_at: now.toISOString() });
      } catch (err) {
        s.errors++;
        s.detail.push(maskEmail_(sub.email) + ': ' + String(err && err.message).slice(0, 200));
      }
    });
  } finally {
    s.quota_left = MailApp.getRemainingDailyQuota();
    s.duration_ms = Date.now() - t0;
    if (!opt.dryRun) {
      try {
        tab_('Alertes_envois', ALERT_RUNS_HEADER_).appendRow(ALERT_RUNS_HEADER_.map(function (h) {
          return h === 'detail' ? s.detail.join(' ; ').slice(0, 1000) : (h === 'at' || h === 'feed_updated' ? txt_(s[h]) : s[h]);
        }));
        PropertiesService.getScriptProperties().setProperty('ALERTS_LAST_RUN', JSON.stringify({
          at: s.at, ok: s.errors === 0, sent: s.sent, errors: s.errors, feed_updated: s.feed_updated, deferred: s.deferred }));
      } catch (e) {
        console.error('Alertes_envois log failed: ' + e);
      }
    }
    console.log('sendAlerts ' + JSON.stringify({ sent: s.sent, nothing_new: s.nothing_new, errors: s.errors, detail: s.detail }));
    lock.releaseLock();
  }
  return s;
}

/** Public, no personal data: when the last alert run happened and whether it went well (for the daily monitor). */
function alertsStatus_() {
  var raw = PropertiesService.getScriptProperties().getProperty('ALERTS_LAST_RUN');
  var last = raw ? JSON.parse(raw) : null;
  return { ok: true, service: SITE_, alerts: last ? { at: last.at, ok: last.ok, errors: last.errors, feed_updated: last.feed_updated } : null };
}

/* ------------------------------------------------------------------ pieces */

function fetchAlertFeed_() {
  var res = UrlFetchApp.fetch(ALERT_FEED_URL_ + '?t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
  var feed = JSON.parse(res.getContentText('UTF-8'));
  if (!feed || !Array.isArray(feed.notices)) throw new Error('feed without notices');
  return feed;
}

/** Active alert sign-ups, one per address: criteria of the latest row, `since` = day of the first row. */
function alertSubscribers_() {
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
    if (r[2] !== 'alertes' || r[14] === 'oui') return;
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
  return { subject: subject, body: text.join('\n'), html: html.join('') };
}
