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
 *   stats   GET ?token=&date=       the counter rows of one day (Stats and Exclus), for the dashboard, plus `cro`:
 *                                   that day's behaviour and A/B summary (croSummary_).
 *   reclass POST {token, date, page, event, source, …}  moves one whole Stats row to Exclus as `burst` and notes it
 *                                   in `Annotations` (used once for the 13/10/2026 crawler burst).
 *
 * Bursts (2026-10-18): more than BURST_MINUTE_ distinct tender pages in one minute, or BURST_HOUR_ in one hour with
 * no interaction, from one coarse browser fingerprint go to Exclus as `burst`, and the hits of that window already
 * counted are moved there too. The fingerprint `fp` (mesure.js v3) is a short hash of the user agent, language,
 * screen size and the current hour, computed in the browser: it changes every hour and cannot follow anyone. It is
 * only used as a CacheService key (in memory, ≤ 1 h) and never written to the spreadsheet; no IP is read or stored.
 *   track with kind 'cro'           once-per-page batch of the shared cro.js (Octave behaviour counters + A/B, src/Cro.js
 *                                   vendored byte-identical from octave-checkout): daily counters in `Comportement`
 *                                   and `Experiences`, nothing typed, no identifier.
 *   cro     GET/POST ?key=          aggregated behaviour + A/B summary for the weekly CRO report (key hash in the
 *                                   Script Property CRO_KEY_SHA256, never in git); test sign-ups are left out of
 *                                   `funnel` and listed in `funnel_test` (croSummaryReal_).
 *   cro_init POST {key}             stores that key's SHA-256 once (refused afterwards).
 *
 *   alerts_status GET               last run of the daily e-mail alerts (src/Alerts.js): time, ok, errors; no personal data.
 *
 * Scopes: spreadsheets, plus (2026-10-21, e-mail alerts, src/Alerts.js) script.send_mail, script.external_request
 * (the public feed data/alertes.json) and script.scriptapp (the daily trigger). The owner grants them once by running
 * installAlerts from the editor; redeploy the web app only after that, or it would ask anonymous visitors to sign in.
 * The spreadsheet is created on first use and its id kept in Script Properties.
 */

var SITE_ = 'veille-ao-afrique';
var OWN_HOSTS_ = ['ao-afrique.jalonel.com'];
var STATS_HEADER_ = ['date', 'site', 'page', 'event', 'detail', 'source', 'medium', 'campaign', 'count', 'mobile', 'desktop', 'updated_at'];
var STATS_KEYS_ = 8;
var EXCL_HEADER_ = ['date', 'site', 'page', 'event', 'detail', 'reason', 'count', 'mobile', 'desktop', 'updated_at'];
var EXCL_KEYS_ = 6;
// Why a hit was not counted as a visit (decided in the browser; the user agent itself is never sent).
// 'legacy': no `v` field, i.e. sent by a pre-2026-10-13 mesure.js still cached by a crawler's renderer.
var EXCL_REASONS_ = ['webdriver', 'bot', 'notrack', 'legacy'];
// Server-side reason (never sent by the page): a burst of distinct tender pages from one fingerprint (see burst_).
var BURST_REASON_ = 'burst';
var BURST_MINUTE_ = 8;    // > 8 distinct tender pages in one minute
var BURST_HOUR_ = 30;     // > 30 distinct tender pages in one hour, with no filter, search or click
var BURST_EVENTS_HUMAN_ = ['filter_use', 'search_use', 'official_click', 'cta_click', 'preinscription_click'];
var FP_RE_ = /^[0-9a-f]{8}$/;
var ANNOT_HEADER_ = ['at', 'date', 'page', 'event', 'detail', 'source', 'count', 'reason', 'note'];
var SIGNUP_HEADER_ = ['at', 'email', 'kind', 'plan', 'company', 'company_country', 'sectors', 'countries', 'regions', 'frequency', 'consent_version', 'consent_text', 'page', 'source', 'test', 'withdrawn_at', 'id'];
var TRACK_EVENTS_ = ['view', 'tender_view', 'filter_use', 'search_use', 'official_click', 'alert_form_view', 'alert_signup', 'preinscription_click', 'preinscription_signup', 'cta_click'];
var TRACK_DETAILS_ = /^[a-z0-9_-]{0,40}$/;
var KINDS_ = ['alertes', 'preinscription'];
var PLANS_ = ['', 'essentiel-39', 'pro-79'];
var FREQ_ = ['', 'quotidien', 'hebdomadaire'];
var CONSENT_VERSION_ = 'v2-2026-10-18'; // v2: contact address contact@jalonel.com in the consent text
var RATE_TRACK_ = 300;   // hits per minute, all pages
var RATE_SIGNUP_ = 20;   // sign-ups per minute

// Octave CRO module (src/Cro.js): settings it reads from the host.
var CRO_SITES_ = [SITE_];
// A/B AOAF-ALERT-INLINE-01 (static/xp.js, tender pages): a = current page, b = one-field alert above the official link.
// Essentiel 39 / Pro 79 are pre-registration plans, not arms.
var CRO_EXPERIMENTS_ = { 'aoaf-alert': ['a', 'b'] };
// Goals of that test, once per tab and per arm: alert form on screen, official-notice click, reminder shown on return.
var CRO_GOALS_ = ['alert_view', 'official', 'nudge'];
var XP_SIGNUP_ = /^(a|b)$/;      // arm sent with a sign-up (alerte-inline.js), kept in the Stats detail
var XP_FORMS_ = ['inline', 'rapide'];
function croBook_() { return book_(); }
/** Same page normaliser as Stats (tender pages collapsed to /ao/*), so Comportement pages match Stats pages. */
function croPage_(site, page) { return trackPage_(page); }
/**
 * `cro` and `stats` summaries without our own test sign-ups. signup_ counts every sign-up in Stats, a test one
 * (`test: true` or an @example.* address) with the detail `test`; croSummary_ sums Stats by event only. Those rows stay
 * in the sheet; they are only taken out of `funnel` here and shown apart in `funnel_test`. Cro.js stays byte-identical.
 */
function croSummaryReal_(sum) {
  if (!sum || !sum.ok || !sum.sites) return sum;
  var st = croRows_('Stats', sum.from, sum.to), h = st.header;
  var iS = h.indexOf('site'), iE = h.indexOf('event'), iD = h.indexOf('detail'), iC = h.indexOf('count');
  if (iE < 0 || iD < 0 || iC < 0) return sum;
  st.rows.forEach(function (r) {
    if (croCell_(r[iD]) !== 'test') return;
    var s = sum.sites[iS >= 0 ? croCell_(r[iS]) : SITE_], ev = croCell_(r[iE]), n = Number(r[iC] || 0);
    if (!s || !n) return;
    s.funnel[ev] = Math.max(0, (s.funnel[ev] || 0) - n);
    croInc_(s.funnel_test || (s.funnel_test = {}), ev, n);
  });
  return sum;
}

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
      // kind 'cro': the once-per-page behaviour batch of cro.js, before this host's own track validation.
      case 'track': return json_(req.kind === 'cro' ? croTrack_(req) : track_(req));
      case 'cro': return json_(croSummaryReal_(croAction_(req)));
      case 'cro_init':
        if (!body) throw userError_('method_not_allowed', 'POST attendu.');
        return json_(croInit_(req));
      case 'signup':
        if (!body) throw userError_('method_not_allowed', 'POST attendu.');
        return json_(signup_(req));
      case 'unsubscribe': return html_(unsubscribe_(req));
      case 'admin': return json_(admin_(req));
      case 'stats': return json_(stats_(req));
      case 'reclass':
        if (!body) throw userError_('method_not_allowed', 'POST attendu.');
        return json_(reclass_(req));
      case 'ping': return json_({ ok: true, service: SITE_ });
      case 'alerts_status': return json_(alertsStatus_());
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
    '<p><a href="https://ao-afrique.jalonel.com/">Veille AO Afrique</a></p></div>').setTitle('Veille AO Afrique');
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
  var tm = /^\/(?:veille-ao-afrique\/)?ao\/([^/?#]+)\/?(?:[?#].*)?$/.exec(String(req.page || '').toLowerCase());
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
    reason: EXCL_REASONS_.indexOf(String(req.excluded || '')) >= 0 ? String(req.excluded) : req.excluded ? 'bot' : !req.v ? 'legacy' : '',
    // in memory only (burst_): never part of a counter key, never written to the spreadsheet
    fp: FP_RE_.test(String(req.fp || '')) ? String(req.fp) : '',
    tender: tm ? sha256Hex_('ao|' + tm[1]).slice(0, 8) : '',
  };
}

function track_(req) {
  var hit = validateTrack_(req);
  if (!rateOk_('track', RATE_TRACK_)) return { ok: false, error: 'rate_limited' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: false, error: 'busy' };
  try {
    if (!hit.reason) hit.reason = burst_(hit);
    if (hit.reason) incrementExcluded_(hit);
    else incrementStat_(hit);
  } finally { lock.releaseLock(); }
  return { ok: true };
}

/**
 * Burst screen (caller holds the script lock). Returns 'burst' when this hit belongs to a burst, else '' (and the
 * hit is remembered in the window so it can be moved if the window turns into a burst). State per window, in
 * CacheService only: distinct tender-page hashes, interaction count, the counter keys already counted (no
 * identifier: page, event, source…), and a flag. Key: sha256(fp + hour). Without `fp` (mesure.js before v3), only
 * the minute rule applies, on a coarse key (device + source) shared by all such visitors.
 */
function burst_(hit) {
  try {
    var t = now_().getTime();
    var hour = Math.floor(t / 3600000), minute = Math.floor(t / 60000);
    var cache = CacheService.getScriptCache();
    var key = 'burst:' + sha256Hex_((hit.fp ? 'fp|' + hit.fp : 'nofp|' + hit.device + '|' + hit.source) + '|' + hour).slice(0, 32);
    var w = null;
    try { w = JSON.parse(cache.get(key) || 'null'); } catch (e) { w = null; }
    if (!w || typeof w !== 'object') w = { t: [], mk: minute, m: [], i: 0, c: [], f: 0 };
    if (w.mk !== minute) { w.mk = minute; w.m = []; }
    if (BURST_EVENTS_HUMAN_.indexOf(hit.event) >= 0) w.i++;
    if (hit.tender) {
      if (w.t.indexOf(hit.tender) < 0 && w.t.length < 500) w.t.push(hit.tender);
      if (w.m.indexOf(hit.tender) < 0) w.m.push(hit.tender);
    }
    var burst = w.f || w.m.length > BURST_MINUTE_ || (hit.fp && !w.i && w.t.length > BURST_HOUR_);
    if (burst && !w.f) {
      // the window just turned into a burst: move the hits of this window already counted as visits
      w.c.forEach(function (c) {
        if (incrementRow_('Stats', STATS_HEADER_, STATS_KEYS_, c[0], c[1], -1)) {
          incrementRow_('Exclus', EXCL_HEADER_, EXCL_KEYS_, [c[0][0], c[0][1], c[0][2], c[0][3], c[0][4], BURST_REASON_], c[1], 1);
        }
      });
      w.c = [];
      w.f = 1;
    }
    if (!burst && w.c.length < 200) w.c.push([statKey_(hit), hit.device]);
    cache.put(key, JSON.stringify(w), 3700);
    return burst ? BURST_REASON_ : '';
  } catch (err) {
    console.error('burst screen failed: ' + String(err && err.message));
    return '';
  }
}

function statKey_(h) { return [h.date, h.site, h.page, h.event, h.detail, h.source, h.medium, h.campaign]; }

function incrementStat_(h) { return incrementRow_('Stats', STATS_HEADER_, STATS_KEYS_, statKey_(h), h.device, 1); }

/** Hits not counted as visits: same daily counters, keyed by reason instead of source. */
function incrementExcluded_(h) {
  return incrementRow_('Exclus', EXCL_HEADER_, EXCL_KEYS_, [h.date, h.site, h.page, h.event, h.detail, h.reason], h.device, 1);
}

/**
 * Caller holds the script lock. Daily counter row `keys` (first column is the date) in tab `name`:
 * cached row number (verified), else a scan of the newest rows; incremented by `delta` (default 1), or appended.
 * A negative delta (a burst moved to Exclus) never creates a row and never goes below 0; returns 0 if no row.
 */
function incrementRow_(name, header, nKeys, keys, device, delta) {
  delta = delta === undefined ? 1 : delta;
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
  if (!rowNum && delta < 0) return 0;
  if (!rowNum) {
    sheet.appendRow(keys.map(txt_).concat([1, device === 'mobile' ? 1 : 0, device === 'desktop' ? 1 : 0, stamp]));
    rowNum = sheet.getLastRow();
    sheet.getRange(rowNum, 1).setNumberFormat('@').setValue(keys[0]);
  } else {
    var c = sheet.getRange(rowNum, nKeys + 1, 1, 3).getValues()[0];
    var add = function (v, d) { return Math.max(0, Number(v || 0) + d); };
    sheet.getRange(rowNum, nKeys + 1, 1, 4).setValues([[add(c[0], delta), add(c[1], device === 'mobile' ? delta : 0),
      add(c[2], device === 'desktop' ? delta : 0), stamp]]);
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
      detail: test ? 'test' : (plan || xpDetail_(req)), source: '(serveur)', medium: '', campaign: '', device: '' });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, kind: kind, plan: plan };
}

/** Stats detail of an alert sign-up made on a tender page during AOAF-ALERT-INLINE-01: `aoaf-alert-<arm>-<form>`. */
function xpDetail_(req) {
  var arm = String(req.xp || ''), form = String(req.form || '');
  return XP_SIGNUP_.test(arm) && XP_FORMS_.indexOf(form) >= 0 ? 'aoaf-alert-' + arm + '-' + form : '';
}

function unsubscribe_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  if (!email || String(req.t || '') !== hmac_(email)) return '<p>Lien invalide. Écrivez à contact@jalonel.com pour être retiré de la liste.</p>';
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
    stats: kept, exclus: excl, cro: croSummaryReal_(croSummary_(date, date)) };
}

/**
 * Token required, POST. Moves ONE whole counter row of `Stats` (exact date, page, event, detail, source, medium,
 * campaign) to `Exclus` as `burst` and notes it in `Annotations` (reason + note). Refuses if the row is not found
 * or its count differs from `expect_count` (so a replay never moves anything twice).
 */
function reclass_(req) {
  var token = typeof ADMIN_TOKEN_ === 'string' && ADMIN_TOKEN_.length >= 24 ? ADMIN_TOKEN_ : '';
  if (!token || String(req.token || '') !== token) throw userError_('forbidden', 'Accès refusé.');
  var date = String(req.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw userError_('bad_request', 'date');
  var keys = [date, SITE_, String(req.page || ''), String(req.event || ''), String(req.detail || ''), String(req.source || ''), String(req.medium || ''), String(req.campaign || '')];
  var note = String(req.note || '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, 300);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try {
    var sh = tab_('Stats', STATS_HEADER_);
    var last = sh.getLastRow();
    if (last < 2) return { ok: false, error: 'not_found' };
    var vals = sh.getRange(2, 1, last - 1, STATS_HEADER_.length).getValues();
    var key = keys.join('\u001f');
    for (var i = 0; i < vals.length; i++) {
      if (vals[i].slice(0, STATS_KEYS_).map(cellText_).join('\u001f') !== key) continue;
      var n = Number(vals[i][8] || 0), mob = Number(vals[i][9] || 0), desk = Number(vals[i][10] || 0);
      if (String(n) !== String(req.expect_count)) return { ok: false, error: 'count_mismatch', count: n };
      if (!n) return { ok: false, error: 'empty' };
      sh.getRange(i + 2, 9, 1, 4).setValues([[0, 0, 0, now_().toISOString()]]);
      var ex = tab_('Exclus', EXCL_HEADER_);
      ex.appendRow([date, SITE_, txt_(keys[2]), keys[3], keys[4], BURST_REASON_, n, mob, desk, now_().toISOString()]);
      ex.getRange(ex.getLastRow(), 1).setNumberFormat('@').setValue(date);
      var an = tab_('Annotations', ANNOT_HEADER_);
      an.appendRow([now_().toISOString(), date, txt_(keys[2]), keys[3], keys[4], txt_(keys[5]), n, BURST_REASON_, txt_(note)]);
      return { ok: true, moved: n, mobile: mob, desktop: desk };
    }
    return { ok: false, error: 'not_found' };
  } finally {
    lock.releaseLock();
  }
}

/** Run from the editor once if needed: creates the spreadsheet and prints its URL. */
function setup() {
  var ss = book_();
  console.log('Sheet: ' + ss.getUrl());
  return { sheet: ss.getUrl() };
}
