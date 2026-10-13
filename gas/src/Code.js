/**
 * Veille AO Afrique — backend Apps Script (READ FRANCE SAS). Separate project, separate spreadsheet.
 *
 * Actions (web app, anonymous access):
 *   track   POST text/plain or GET  cookieless anonymous counter (same pattern as octave-checkout Track.js):
 *                                   {site, page, event, detail, ref_domain, utm_*, device, ts} → daily counters
 *                                   in the `Stats` tab, never one row per hit, no identifier of any kind.
 *   signup  POST text/plain         "Alertes e-mail" interest form or paid-tier pre-registration (no payment):
 *                                   one row in `Inscriptions` with the consent text version and timestamp.
 *   unsubscribe GET ?email=&t=      marks the row withdrawn (link sent later in any e-mail we send).
 *                                   A hit flagged `excluded` (headless browser, navigator.webdriver, bot user agent
 *                                   detected client-side, or our own tests with octave_notrack=1) is counted in
 *                                   the `Exclus` tab instead, by reason, so filtered and raw totals both show.
 *   admin   GET ?token=             aggregated counts for tests and reporting (token in the git-ignored Secret.js).
 *   stats   GET ?token=&date=       the counter rows of one day (Stats and Exclus), for the dashboard.
 *
 * Only scope: spreadsheets. The spreadsheet is created on first use and its id kept in Script Properties.
 */

var SITE_ = 'veille-ao-afrique';
var OWN_HOSTS_ = ['outils.vread.fr', 'vread-corp.github.io'];
var STATS_HEADER_ = ['date', 'site', 'page', 'event', 'detail', 'source', 'medium', 'campaign', 'count', 'mobile', 'desktop', 'updated_at'];
var STATS_KEYS_ = 8;
var EXCL_HEADER_ = ['date', 'site', 'page', 'event', 'detail', 'reason', 'count', 'mobile', 'desktop', 'updated_at'];
var EXCL_KEYS_ = 6;
// Why a hit was not counted as a visit (decided in the browser; the user agent itself is never sent).
var EXCL_REASONS_ = ['webdriver', 'bot', 'notrack'];
var SIGNUP_HEADER_ = ['at', 'email', 'kind', 'plan', 'company', 'company_country', 'sectors', 'countries', 'regions', 'frequency', 'consent_version', 'consent_text', 'page', 'source', 'test', 'withdrawn_at', 'id'];
var TRACK_EVENTS_ = ['view', 'tender_view', 'filter_use', 'search_use', 'official_click', 'alert_form_view', 'alert_signup', 'preinscription_click', 'preinscription_signup', 'cta_click'];
var TRACK_DETAILS_ = /^[a-z0-9_-]{0,40}$/;
var KINDS_ = ['alertes', 'preinscription'];
var PLANS_ = ['', 'essentiel-39', 'pro-79'];
var FREQ_ = ['', 'quotidien', 'hebdomadaire'];
var CONSENT_VERSION_ = 'v1-2026-10-13';
var RATE_TRACK_ = 300;   // hits per minute, all pages
var RATE_SIGNUP_ = 20;   // sign-ups per minute

function doGet(e) { return route_((e && e.parameter) || {}, null); }

function doPost(e) {
  var body = {};
  var raw = e && e.postData && e.postData.contents;
  if (raw) {
    try { body = JSON.parse(raw); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json_({ ok: false, error: 'bad_json' });
  }
  return route_((e && e.parameter) || {}, body);
}

function route_(params, body) {
  var req = {};
  Object.keys(params || {}).forEach(function (k) { req[k] = params[k]; });
  Object.keys(body || {}).forEach(function (k) { req[k] = body[k]; });
  try {
    switch (req.action) {
      case 'track': return json_(track_(req));
      case 'signup':
        if (!body) throw userError_('method_not_allowed', 'POST attendu.');
        return json_(signup_(req));
      case 'unsubscribe': return html_(unsubscribe_(req));
      case 'admin': return json_(admin_(req));
      case 'stats': return json_(stats_(req));
      case 'ping': return json_({ ok: true, service: SITE_ });
      default: return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    if (err && err.userError) return json_({ ok: false, error: err.code, message: err.message });
    console.error(String((err && err.stack) || err));
    return json_({ ok: false, error: 'server_error', message: 'Service momentanément indisponible. Réessayez plus tard.' });
  }
}

/* ------------------------------------------------------------------ storage */

function book_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    id = props.getProperty('SHEET_ID');
    if (id) return SpreadsheetApp.openById(id);
    var ss = SpreadsheetApp.create('Veille AO Afrique – inscriptions et mesure (READ FRANCE SAS)');
    props.setProperty('SHEET_ID', ss.getId());
    var first = ss.getSheets()[0];
    tabIn_(ss, 'Inscriptions', SIGNUP_HEADER_);
    tabIn_(ss, 'Stats', STATS_HEADER_);
    tabIn_(ss, 'Exclus', EXCL_HEADER_);
    ss.deleteSheet(first);
    return ss;
  } finally {
    lock.releaseLock();
  }
}

function tabIn_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function tab_(name, header) { return tabIn_(book_(), name, header); }

/* ------------------------------------------------------------------ helpers */

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function html_(text) {
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem">' + text +
    '<p><a href="https://outils.vread.fr/veille-ao-afrique/">Veille AO Afrique</a></p></div>').setTitle('Veille AO Afrique');
}

function userError_(code, message) { var e = new Error(message); e.userError = true; e.code = code; return e; }

function now_() { return new Date(); }

function parisDate_(d) { return Utilities.formatDate(d, 'Europe/Paris', 'yyyy-MM-dd'); }

/** Plain text for a cell: never let a value start a formula. */
function txt_(v) {
  var s = v === undefined || v === null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function cellText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Paris', 'yyyy-MM-dd');
  return v === undefined || v === null ? '' : String(v);
}

function token_(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).toLowerCase().replace(/[^a-z0-9._ -]+/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function rateOk_(bucket, limit) {
  var cache = CacheService.getScriptCache();
  var k = 'rate:' + bucket + ':' + Math.floor(now_().getTime() / 60000);
  var n = Number(cache.get(k) || 0);
  if (n >= limit) return false;
  cache.put(k, String(n + 1), 120);
  return true;
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function hmac_(text) {
  var key = typeof LINK_KEY_ === 'string' ? LINK_KEY_ : '';
  return Utilities.computeHmacSha256Signature(text, key).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 32);
}

/* ------------------------------------------------------------------ track */

function trackPage_(page) {
  var p = String(page === undefined || page === null ? '' : page).slice(0, 300).toLowerCase().replace(/[?#].*$/, '');
  if (!/^\/[a-z0-9\/._%~-]*$/.test(p)) return null;
  if (p === '/' + SITE_ || p.indexOf('/' + SITE_ + '/') === 0) p = p.slice(SITE_.length + 1) || '/';
  p = p.replace(/\/index\.html$/, '/').replace(/\/{2,}/g, '/');
  // Tender pages are counted together (one row per day, not one per tender).
  if (/^\/ao\/[^/]+\/?$/.test(p)) p = '/ao/*';
  return p.slice(0, 80) || '/';
}

function validateTrack_(req) {
  if (String(req.site || '') !== SITE_) throw userError_('bad_request', 'site');
  var event = String(req.event || '');
  if (TRACK_EVENTS_.indexOf(event) < 0) throw userError_('bad_request', 'event');
  var detail = String(req.detail || '').toLowerCase();
  if (!TRACK_DETAILS_.test(detail)) throw userError_('bad_request', 'detail');
  var page = trackPage_(req.page);
  if (page === null) throw userError_('bad_request', 'page');
  if (req.ts !== undefined && req.ts !== null && req.ts !== '') {
    var ts = Number(req.ts);
    if (!isFinite(ts) || Math.abs(ts - now_().getTime()) > 2 * 86400 * 1000) throw userError_('bad_request', 'ts');
  }
  var ref = String(req.ref_domain || '').toLowerCase().replace(/^www\./, '');
  if (ref && !/^[a-z0-9.-]{1,100}$/.test(ref)) ref = '';
  if (OWN_HOSTS_.indexOf(ref) >= 0) ref = '(interne)';
  return {
    date: parisDate_(now_()), site: SITE_, page: page, event: event, detail: detail,
    source: token_(req.utm_source, 50) || ref || '(direct)',
    medium: token_(req.utm_medium, 30), campaign: token_(req.utm_campaign, 50),
    device: req.device === 'mobile' || req.device === 'desktop' ? req.device : '',
    reason: EXCL_REASONS_.indexOf(String(req.excluded || '')) >= 0 ? String(req.excluded) : (req.excluded ? 'bot' : ''),
  };
}

function track_(req) {
  var hit = validateTrack_(req);
  if (!rateOk_('track', RATE_TRACK_)) return { ok: false, error: 'rate_limited' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: false, error: 'busy' };
  try {
    if (hit.reason) incrementExcluded_(hit);
    else incrementStat_(hit);
  } finally { lock.releaseLock(); }
  return { ok: true };
}

function statKey_(h) { return [h.date, h.site, h.page, h.event, h.detail, h.source, h.medium, h.campaign]; }

function incrementStat_(h) { return incrementRow_('Stats', STATS_HEADER_, STATS_KEYS_, statKey_(h), h.device); }

/** Hits not counted as visits: same daily counters, keyed by reason instead of source. */
function incrementExcluded_(h) {
  return incrementRow_('Exclus', EXCL_HEADER_, EXCL_KEYS_, [h.date, h.site, h.page, h.event, h.detail, h.reason], h.device);
}

/**
 * Caller holds the script lock. Daily counter row `keys` (first column is the date) in tab `name`:
 * cached row number (verified), else a scan of the newest rows; incremented, or appended.
 */
function incrementRow_(name, header, nKeys, keys, device) {
  var sheet = tab_(name, header);
  var key = keys.join('\u001f');
  var cache = CacheService.getScriptCache();
  var ck = 'stat:' + sha256Hex_(name + '\u001f' + key).slice(0, 40);
  var rowNum = Number(cache.get(ck) || 0);
  var rowKey = function (vals) { return vals.slice(0, nKeys).map(cellText_).join('\u001f'); };
  if (!(rowNum >= 2 && rowNum <= sheet.getLastRow() && rowKey(sheet.getRange(rowNum, 1, 1, nKeys).getValues()[0]) === key)) {
    rowNum = 0;
    var last = sheet.getLastRow();
    var n = Math.min(Math.max(last - 1, 0), 2000);
    if (n > 0) {
      var vals = sheet.getRange(last - n + 1, 1, n, nKeys).getValues();
      for (var i = vals.length - 1; i >= 0; i--) {
        if (cellText_(vals[i][0]) < keys[0]) break;
        if (rowKey(vals[i]) === key) { rowNum = last - n + 1 + i; break; }
      }
    }
  }
  var stamp = now_().toISOString();
  if (!rowNum) {
    sheet.appendRow(keys.map(txt_).concat([1, device === 'mobile' ? 1 : 0, device === 'desktop' ? 1 : 0, stamp]));
    rowNum = sheet.getLastRow();
    sheet.getRange(rowNum, 1).setNumberFormat('@').setValue(keys[0]);
  } else {
    var c = sheet.getRange(rowNum, nKeys + 1, 1, 3).getValues()[0];
    sheet.getRange(rowNum, nKeys + 1, 1, 4).setValues([[Number(c[0] || 0) + 1, Number(c[1] || 0) + (device === 'mobile' ? 1 : 0),
      Number(c[2] || 0) + (device === 'desktop' ? 1 : 0), stamp]]);
  }
  cache.put(ck, String(rowNum), 21600);
  return rowNum;
}

/** Rows of tab `name` for one date, as objects (newest rows scanned only). */
function rowsOfDay_(name, header, date) {
  var sh = tab_(name, header);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var n = Math.min(last - 1, 5000);
  var out = [];
  sh.getRange(last - n + 1, 1, n, header.length).getValues().forEach(function (r) {
    if (cellText_(r[0]) !== date) return;
    var o = {};
    header.forEach(function (k, j) { o[k] = typeof r[j] === 'number' ? r[j] : (r[j] instanceof Date ? r[j].toISOString() : String(r[j])); });
    o.date = date;
    out.push(o);
  });
  return out;
}

/* ------------------------------------------------------------------ signup */

function list_(v, re, max) {
  var arr = Array.isArray(v) ? v : String(v || '').split(',');
  var out = [];
  arr.forEach(function (x) { x = String(x).trim().toLowerCase(); if (x && re.test(x) && out.indexOf(x) < 0 && out.length < max) out.push(x); });
  return out;
}

function signup_(req) {
  if (req.website) return { ok: true }; // honeypot: silently accepted, nothing stored
  var email = String(req.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(email)) throw userError_('bad_email', 'Adresse e-mail invalide.');
  if (req.consent !== true && req.consent !== 'true' && req.consent !== 'on') throw userError_('consent_required', 'Cochez la case de consentement pour vous inscrire.');
  var kind = String(req.kind || 'alertes');
  if (KINDS_.indexOf(kind) < 0) throw userError_('bad_request', 'kind');
  var plan = String(req.plan || '');
  if (PLANS_.indexOf(plan) < 0) throw userError_('bad_request', 'plan');
  var freq = String(req.frequency || '');
  if (FREQ_.indexOf(freq) < 0) freq = '';
  var consentText = String(req.consent_text || '').slice(0, 600);
  if (consentText.length < 40) throw userError_('consent_required', 'Texte de consentement manquant.');
  if (!rateOk_('signup', RATE_SIGNUP_)) throw userError_('rate_limited', 'Trop de demandes, réessayez dans une minute.');
  var test = req.test === true || req.test === 'true' || /@example\.(com|org|net)$/.test(email);
  var row = [
    now_().toISOString(), txt_(email), kind, plan, txt_(String(req.company || '').trim().slice(0, 120)),
    txt_(token_(req.company_country, 30)),
    list_(req.sectors, /^[a-z-]{2,40}$/, 15).join(', '), list_(req.countries, /^[a-z' -]{2,40}$/, 30).join(', '),
    list_(req.regions, /^[a-z0-9' -]{2,40}$/, 12).join(', '), freq, CONSENT_VERSION_, txt_(consentText),
    txt_(trackPage_(req.page) || ''), txt_(token_(req.utm_source, 50)), test ? 'oui' : '', '', Utilities.getUuid().slice(0, 8),
  ];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw userError_('busy', 'Service occupé, réessayez.');
  try {
    tab_('Inscriptions', SIGNUP_HEADER_).appendRow(row);
    incrementStat_({ date: parisDate_(now_()), site: SITE_, page: trackPage_(req.page) || '/', event: kind === 'preinscription' ? 'preinscription_signup' : 'alert_signup',
      detail: test ? 'test' : (plan || ''), source: '(serveur)', medium: '', campaign: '', device: '' });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, kind: kind, plan: plan };
}

function unsubscribe_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  if (!email || String(req.t || '') !== hmac_(email)) return '<p>Lien invalide. Écrivez à octave@vread.fr pour être retiré de la liste.</p>';
  var sh = tab_('Inscriptions', SIGNUP_HEADER_);
  var last = sh.getLastRow();
  if (last < 2) return '<p>Adresse introuvable.</p>';
  var vals = sh.getRange(2, 2, last - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).toLowerCase() === email) { sh.getRange(i + 2, 16).setValue(now_().toISOString()); n++; }
  }
  return n ? '<p>C\'est fait : vous ne recevrez plus rien de Veille AO Afrique à cette adresse.</p>' : '<p>Adresse introuvable.</p>';
}

/* ------------------------------------------------------------------ admin (token) */

function admin_(req) {
  var token = typeof ADMIN_TOKEN_ === 'string' && ADMIN_TOKEN_.length >= 24 ? ADMIN_TOKEN_ : '';
  if (!token || String(req.token || '') !== token) throw userError_('forbidden', 'Accès refusé.');
  var date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.date || '')) ? String(req.date) : parisDate_(now_());
  var sh = tab_('Stats', STATS_HEADER_);
  var last = sh.getLastRow();
  var counters = {};
  if (last >= 2) {
    var n = Math.min(last - 1, 5000);
    sh.getRange(last - n + 1, 1, n, STATS_HEADER_.length).getValues().forEach(function (r) {
      if (cellText_(r[0]) !== date) return;
      var k = r[3] + (r[4] ? ':' + r[4] : '');
      counters[k] = (counters[k] || 0) + Number(r[8] || 0);
    });
  }
  var excluded = {};
  rowsOfDay_('Exclus', EXCL_HEADER_, date).forEach(function (r) {
    var k = r.event + (r.detail ? ':' + r.detail : '') + '|' + r.reason;
    excluded[k] = (excluded[k] || 0) + Number(r.count || 0);
  });
  var su = tab_('Inscriptions', SIGNUP_HEADER_);
  var rows = su.getLastRow() >= 2 ? su.getRange(2, 1, su.getLastRow() - 1, SIGNUP_HEADER_.length).getValues() : [];
  var real = rows.filter(function (r) { return r[14] !== 'oui' && !r[15]; });
  var out = { ok: true, date: date, counters: counters, excluded: excluded, signups_total: real.length,
    signups_alertes: real.filter(function (r) { return r[2] === 'alertes'; }).length,
    preinscriptions: { 'essentiel-39': real.filter(function (r) { return r[3] === 'essentiel-39'; }).length, 'pro-79': real.filter(function (r) { return r[3] === 'pro-79'; }).length },
    test_rows: rows.length - real.length };
  if (req.find) out.found = rows.some(function (r) { return String(r[1]).toLowerCase() === String(req.find).toLowerCase(); });
  return out;
}

/** Day dashboard: counted visits vs raw (counted + excluded), and every counter row of that day. Token required. */
function stats_(req) {
  var token = typeof ADMIN_TOKEN_ === 'string' && ADMIN_TOKEN_.length >= 24 ? ADMIN_TOKEN_ : '';
  if (!token || String(req.token || '') !== token) throw userError_('forbidden', 'Accès refusé.');
  var date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.date || '')) ? String(req.date) : parisDate_(now_());
  var kept = rowsOfDay_('Stats', STATS_HEADER_, date);
  var excl = rowsOfDay_('Exclus', EXCL_HEADER_, date);
  var sum = function (rows, ev) { return rows.reduce(function (a, r) { return a + (r.event === ev ? Number(r.count || 0) : 0); }, 0); };
  var byReason = {};
  excl.forEach(function (r) { if (r.event === 'view') byReason[r.reason] = (byReason[r.reason] || 0) + Number(r.count || 0); });
  return { ok: true, date: date, views: { counted: sum(kept, 'view'), excluded: sum(excl, 'view'), raw: sum(kept, 'view') + sum(excl, 'view'), excluded_by_reason: byReason },
    stats: kept, exclus: excl };
}

/** Run from the editor once if needed: creates the spreadsheet and prints its URL. */
function setup() {
  var ss = book_();
  console.log('Sheet: ' + ss.getUrl());
  return { sheet: ss.getUrl() };
}
