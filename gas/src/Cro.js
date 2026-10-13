/**
 * Octave CRO module: aggregate behaviour counters and A/B results (canonical copy: octave-checkout/gas/src/Cro.js,
 * vendored byte-identical in every Apps Script backend; check: node cro-gas.check.mjs).
 *
 * The browser side is cro.js. Once per page it posts {action:'track', kind:'cro', v:2, site, page, device,
 * e:[[type, key, val], …]}. Nothing else is read: no IP (Apps Script never sees it), no user agent, no cookie,
 * no identifier, never what a visitor types (form fields are counted by NAME only). Every entry is whitelisted,
 * normalised and capped; anything else is dropped. Counts are kept as DAILY COUNTERS, never one row per hit:
 *   Comportement  date × site × page × type × key × val → count, mobile, desktop
 *   Experiences   date × site × exp × variant × metric  → count, mobile, desktop
 *
 * The host backend provides:
 *   CRO_SITES_          array of accepted `site` values (required)
 *   croBook_()          the Spreadsheet to write into (required)
 *   CRO_EXPERIMENTS_    {expId: [variants]} whitelist (A/B entries of any other experiment or variant are dropped)
 *   CRO_GOALS_          extra goal names accepted as A/B metrics (optional; n, view, cta, form, checkout are built in)
 *   CRO_TZ_             time zone of the date column (optional, default Europe/Paris; use the host's Stats one)
 *   croPage_(site, p)   page normaliser (optional; default: path, lower case, site prefix and index.html dropped)
 * and routes:  action=track with kind=='cro' → croTrack_(req)   (before its own track validation)
 *              action=cro      → croAction_(req)   (key in Script Property CRO_KEY_SHA256, never in git)
 *              action=cro_init → croInit_(req)     (stores the key's SHA-256 once; refuses afterwards)
 * and may add `cro: croSummary_(from, to)` to its own token-protected stats/summary action.
 */

var CRO_BEHAVIOUR_TAB_ = 'Comportement';
var CRO_BEHAVIOUR_HEADER_ = ['date', 'site', 'page', 'type', 'key', 'val', 'count', 'mobile', 'desktop', 'updated_at'];
var CRO_EXP_TAB_ = 'Experiences';
var CRO_EXP_HEADER_ = ['date', 'site', 'exp', 'variant', 'metric', 'count', 'mobile', 'desktop', 'updated_at'];
var CRO_MAX_EVENTS_ = 80;            // entries per batch
var CRO_MAX_KEYS_ = 40;              // distinct free keys per day × site × page × type (beyond: "(autre)")
var CRO_MAX_ROWS_DAY_ = 4000;        // rows per tab per day, all sites
var CRO_RATE_ = 240;                 // batches per minute, all pages
var CRO_SLUG_ = /^[a-z0-9_-]{1,40}$/;
// A/B metrics: n (tabs exposed), view (pages seen), cta (first CTA click), form (a form submitted), checkout, + goals.
var CRO_METRICS_ = ['n', 'view', 'cta', 'form', 'checkout', 'signup', 'preorder', 'waitlist', 'download', 'paid'];
var CRO_TYPES_ = {
  pv: { k: /^$/, v: /^$/ },
  scroll: { k: /^$/, v: /^(25|50|75|100)$/ },
  section: { k: CRO_SLUG_, v: /^$/, free: true },
  cta_time: { k: /^$/, v: /^(lt10|10-30|30-120|gt120)$/ },
  form: { k: CRO_SLUG_, v: /^(start|submit)$/, free: true },
  abandon: { k: CRO_SLUG_, v: /^([a-z0-9_-]{1,40}|\?)$/, free: true },
  faq: { k: CRO_SLUG_, v: /^$/, free: true },
  out: { k: /^[a-z0-9][a-z0-9.-]{0,59}$/, v: /^$/, free: true },
  err: { k: /^[0-9a-f]{1,8}$/, v: /^$/, free: true },
  cwv: { k: /^(lcp|inp|cls)$/, v: /^(good|ni|poor)$/ },
  rage: { k: /^[a-z0-9][a-z0-9#._-]{0,59}$/, v: /^$/, free: true },
  xp: { k: /^[a-z0-9-]{1,24}$/, v: /^[a-z0-9-]{1,12}\.[a-z0-9_-]{1,24}$/ },
};

/* ------------------------------------------------------------------ helpers */

function croTz_() { return typeof CRO_TZ_ === 'string' && CRO_TZ_ ? CRO_TZ_ : 'Europe/Paris'; }
function croToday_() { return Utilities.formatDate(new Date(), croTz_(), 'yyyy-MM-dd'); }
function croCell_(v) { return v instanceof Date ? Utilities.formatDate(v, croTz_(), 'yyyy-MM-dd') : v === undefined || v === null ? '' : String(v); }
function croSafe_(v) { var s = String(v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }
function croHex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function croTab_(name, header) {
  var ss = croBook_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}

/** Path inside the site: no query or fragment, no site prefix, no trailing index.html, ≤ 80 characters; null if invalid. */
function croPageOf_(site, page) {
  if (typeof croPage_ === 'function') return croPage_(site, page);
  var p = String(page === undefined || page === null ? '' : page).slice(0, 300).toLowerCase().replace(/[?#].*$/, '');
  if (!/^\/[a-z0-9\/._%~-]*$/.test(p)) return null;
  if (p === '/' + site || p.indexOf('/' + site + '/') === 0) p = p.slice(site.length + 1) || '/';
  p = p.replace(/\/index\.html$/, '/').replace(/\/{2,}/g, '/');
  return p.slice(0, 80) || '/';
}

/* ------------------------------------------------------------------ track */

/** Validates a batch. Returns {site, page, device, behaviour:[[type,key,val]], exp:[[exp,variant,metric]], dropped} or null. */
function croValidate_(req) {
  var site = String(req.site || '');
  if (typeof CRO_SITES_ === 'undefined' || CRO_SITES_.indexOf(site) < 0) return null;
  if (!req.v || req.excluded) return null; // old snippet or not a visit: cro.js never sends those, drop them
  var page = croPageOf_(site, req.page);
  if (page === null) return null;
  var list = Array.isArray(req.e) ? req.e.slice(0, CRO_MAX_EVENTS_) : [];
  var out = { site: site, page: page, device: req.device === 'mobile' || req.device === 'desktop' ? req.device : '', behaviour: [], exp: [], dropped: 0 };
  var xpOk = typeof CRO_EXPERIMENTS_ === 'object' && CRO_EXPERIMENTS_ ? CRO_EXPERIMENTS_ : null;
  var seen = {};
  list.forEach(function (e) {
    if (!Array.isArray(e) || e.length !== 3) { out.dropped++; return; }
    var t = String(e[0]), k = String(e[1] === null || e[1] === undefined ? '' : e[1]).toLowerCase().slice(0, 60);
    var v = String(e[2] === null || e[2] === undefined ? '' : e[2]).toLowerCase().slice(0, 40);
    var spec = Object.prototype.hasOwnProperty.call(CRO_TYPES_, t) ? CRO_TYPES_[t] : null;
    if (!spec || !spec.k.test(k) || !spec.v.test(v) || seen[t + ' ' + k + ' ' + v]) { out.dropped++; return; }
    seen[t + ' ' + k + ' ' + v] = 1;
    if (t !== 'xp') { out.behaviour.push([t, k, v]); return; }
    var dot = v.indexOf('.'), variant = v.slice(0, dot), metric = v.slice(dot + 1);
    var goals = typeof CRO_GOALS_ === 'object' && CRO_GOALS_ ? CRO_GOALS_ : [];
    if (!xpOk || !(Object.prototype.hasOwnProperty.call(xpOk, k) && xpOk[k].indexOf(variant) >= 0) ||
        (CRO_METRICS_.indexOf(metric) < 0 && goals.indexOf(metric) < 0)) { out.dropped++; return; }
    out.exp.push([k, variant, metric]);
  });
  return out;
}

function croRateOk_() {
  var cache = CacheService.getScriptCache();
  var k = 'cro:rate:' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(k) || 0);
  if (n >= CRO_RATE_) return false;
  cache.put(k, String(n + 1), 120);
  return true;
}

/** Web-app action `track` with kind 'cro'. Always answers quickly; a dropped batch is not an error for the page. */
function croTrack_(req) {
  var b = croValidate_(req || {});
  if (!b) return { ok: false, error: 'bad_request' };
  if (!b.behaviour.length && !b.exp.length) return { ok: true, n: 0, dropped: b.dropped };
  if (!croRateOk_()) return { ok: false, error: 'rate_limited' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try {
    var date = croToday_();
    if (b.behaviour.length) {
      croBump_(CRO_BEHAVIOUR_TAB_, CRO_BEHAVIOUR_HEADER_, 6, date, b.device, b.behaviour.map(function (e) {
        return { keys: [date, b.site, b.page, e[0], e[1], e[2]], free: CRO_TYPES_[e[0]].free ? 4 : -1 };
      }));
    }
    if (b.exp.length) {
      croBump_(CRO_EXP_TAB_, CRO_EXP_HEADER_, 5, date, b.device, b.exp.map(function (e) {
        return { keys: [date, b.site, e[0], e[1], e[2]], free: -1 };
      }));
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, n: b.behaviour.length + b.exp.length, dropped: b.dropped };
}

/**
 * Caller holds the script lock. Today's rows are always the last block of the tab: it is read once, every counter
 * of the batch is incremented (or appended) in memory, and the block is written back in one call.
 * `free` is the index of a free-text key column whose distinct values are capped (folded into "(autre)").
 */
function croBump_(name, header, nKeys, date, device, items) {
  var sh = croTab_(name, header);
  var width = header.length;
  var cache = CacheService.getScriptCache();
  var ck = 'cro:start:' + name + ':' + date;
  var last = sh.getLastRow();
  var start = Number(cache.get(ck) || 0);
  var cached = start >= 2 && start <= last && croCell_(sh.getRange(start, 1).getValue()) === date &&
    (start === 2 || croCell_(sh.getRange(start - 1, 1).getValue()) < date);
  if (!cached) {
    start = last + 1;
    var end = last;
    while (end >= 2) {
      var from = Math.max(2, end - 499);
      var dates = sh.getRange(from, 1, end - from + 1, 1).getValues();
      var i = dates.length - 1;
      while (i >= 0 && croCell_(dates[i][0]) >= date) i--;
      start = from + i + 1;
      if (i >= 0) break;
      end = from - 1;
    }
  }
  var block = start <= last ? sh.getRange(start, 1, last - start + 1, width).getValues() : [];
  var index = {}, distinct = {};
  block.forEach(function (r, j) {
    r[0] = croCell_(r[0]);
    index[r.slice(0, nKeys).map(croCell_).join('\u001f')] = j;
    var g = r.slice(1, 4).map(croCell_).join('\u001f');
    distinct[g] = (distinct[g] || 0) + 1;
  });
  var stamp = new Date().toISOString();
  items.forEach(function (it) {
    var keys = it.keys.slice();
    var key = keys.join('\u001f');
    if (!Object.prototype.hasOwnProperty.call(index, key) && it.free >= 0) {
      var g = keys.slice(1, 4).join('\u001f');
      if ((distinct[g] || 0) >= CRO_MAX_KEYS_) { keys[it.free] = '(autre)'; key = keys.join('\u001f'); }
    }
    var j = index[key];
    if (j === undefined) {
      if (block.length >= CRO_MAX_ROWS_DAY_) return;
      j = block.length;
      index[key] = j;
      var g2 = keys.slice(1, 4).join('\u001f');
      distinct[g2] = (distinct[g2] || 0) + 1;
      var row = keys.map(croSafe_);
      for (var c = nKeys; c < width; c++) row.push(0);
      block.push(row);
    }
    var r = block[j];
    r[nKeys] = Number(r[nKeys] || 0) + 1;
    r[nKeys + 1] = Number(r[nKeys + 1] || 0) + (device === 'mobile' ? 1 : 0);
    r[nKeys + 2] = Number(r[nKeys + 2] || 0) + (device === 'desktop' ? 1 : 0);
    r[nKeys + 3] = stamp;
  });
  if (block.length) {
    sh.getRange(start, 1, block.length, 1).setNumberFormat('@');
    sh.getRange(start, 1, block.length, width).setValues(block);
  }
  cache.put(ck, String(start), 21600);
}

/* ------------------------------------------------------------------ read */

/** Rows of `tab` with from ≤ date ≤ to, read from the bottom (rows are appended day by day). */
function croRows_(tab, from, to, maxRows) {
  var ss = croBook_();
  var sh = ss.getSheetByName(tab);
  if (!sh) return { header: [], rows: [] };
  var last = sh.getLastRow();
  if (last < 2) return { header: [], rows: [] };
  var width = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var out = [], end = last, limit = Math.max(2, last - (maxRows || 30000) + 1);
  while (end >= limit) {
    var startRow = Math.max(limit, end - 1999);
    var vals = sh.getRange(startRow, 1, end - startRow + 1, width).getValues();
    var stop = false;
    for (var i = vals.length - 1; i >= 0; i--) {
      var d = croCell_(vals[i][0]);
      if (d < from) { stop = true; break; }
      if (d <= to) out.push(vals[i]);
    }
    if (stop) break;
    end = startRow - 1;
  }
  return { header: header, rows: out };
}

function croInc_(o, k, n) { o[k] = (o[k] || 0) + n; return o; }

/**
 * Aggregates [from, to] (yyyy-MM-dd, inclusive) per site: behaviour, A/B results per variant, and the host's own
 * `Stats` funnel (events, by variant when the tab has a variant column) and excluded views (`Exclus`).
 */
function croSummary_(from, to) {
  var sites = {};
  var S = function (site) {
    return sites[site] || (sites[site] = { pv: 0, daily: {}, funnel: {}, funnel_by_variant: {}, excluded_views: 0, pages: {}, forms: {},
      cwv: { lcp: {}, inp: {}, cls: {} }, errors: {}, out: {}, rage: {}, faq: {}, sections: {}, scroll: {}, cta_time: {}, experiments: {} });
  };
  croRows_(CRO_BEHAVIOUR_TAB_, from, to).rows.forEach(function (r) {
    var date = croCell_(r[0]), s = S(croCell_(r[1])), page = croCell_(r[2]), t = croCell_(r[3]), k = croCell_(r[4]), v = croCell_(r[5]), n = Number(r[6] || 0);
    var p = s.pages[page] || (s.pages[page] = { pv: 0, scroll: {}, sections: {}, cta_time: {} });
    if (t === 'pv') { s.pv += n; p.pv += n; croInc_(s.daily, date, n); }
    else if (t === 'scroll') { croInc_(p.scroll, v, n); croInc_(s.scroll, v, n); }
    else if (t === 'section') { croInc_(p.sections, k, n); croInc_(s.sections, k, n); }
    else if (t === 'cta_time') { croInc_(p.cta_time, v, n); croInc_(s.cta_time, v, n); }
    else if (t === 'form' || t === 'abandon') {
      var f = s.forms[page + ' ' + k] || (s.forms[page + ' ' + k] = { page: page, form: k, start: 0, submit: 0, abandon: 0, fields: {} });
      if (t === 'form') f[v] += n; else { f.abandon += n; croInc_(f.fields, v, n); }
    }
    else if (t === 'cwv') croInc_(s.cwv[k] || (s.cwv[k] = {}), v, n);
    else if (t === 'err') croInc_(s.errors, k, n);
    else if (t === 'out') croInc_(s.out, k, n);
    else if (t === 'rage') croInc_(s.rage, page + ' ' + k, n);
    else if (t === 'faq') croInc_(s.faq, k, n);
  });
  croRows_(CRO_EXP_TAB_, from, to).rows.forEach(function (r) {
    var s = S(croCell_(r[1])), e = croCell_(r[2]), v = croCell_(r[3]), m = croCell_(r[4]);
    var x = s.experiments[e] || (s.experiments[e] = {});
    croInc_(x[v] || (x[v] = {}), m, Number(r[5] || 0));
  });
  var defaultSite = typeof CRO_SITES_ !== 'undefined' && CRO_SITES_.length === 1 ? CRO_SITES_[0] : '';
  var st = croRows_('Stats', from, to);
  var col = function (h, name) { return h.indexOf(name); };
  if (st.rows.length) {
    var h = st.header, iS = col(h, 'site'), iE = col(h, 'event'), iC = col(h, 'count'), iV = col(h, 'variant');
    if (iE >= 0 && iC >= 0) st.rows.forEach(function (r) {
      var site = iS >= 0 ? croCell_(r[iS]) : defaultSite;
      if (!site) return;
      var s = S(site), ev = croCell_(r[iE]), n = Number(r[iC] || 0);
      croInc_(s.funnel, ev, n);
      var variant = iV >= 0 ? croCell_(r[iV]) : '';
      if (variant) croInc_(s.funnel_by_variant[variant] || (s.funnel_by_variant[variant] = {}), ev, n);
    });
  }
  var ex = croRows_('Exclus', from, to);
  if (ex.rows.length) {
    var hx = ex.header, xS = col(hx, 'site'), xE = col(hx, 'event'), xC = col(hx, 'count');
    if (xE >= 0 && xC >= 0) ex.rows.forEach(function (r) {
      var site = xS >= 0 ? croCell_(r[xS]) : defaultSite;
      if (site && croCell_(r[xE]) === 'view') S(site).excluded_views += Number(r[xC] || 0);
    });
  }
  return { ok: true, from: from, to: to, tz: croTz_(), generated_at: new Date().toISOString(), sites: sites };
}

/* ------------------------------------------------------------------ actions */

function croKeyOk_(key) {
  var want = PropertiesService.getScriptProperties().getProperty('CRO_KEY_SHA256') || '';
  var got = croHex_(String(key || ''));
  if (want.length !== 64) return false;
  var diff = 0;
  for (var i = 0; i < 64; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/** Action `cro` (GET or POST, key required): the aggregated summary of the last `days` days (1–92, default 7) or of from..to. */
function croAction_(req) {
  if (!croKeyOk_(req.key)) return { ok: false, error: 'forbidden' };
  var re = /^\d{4}-\d{2}-\d{2}$/;
  var to = re.test(String(req.to || '')) ? String(req.to) : croToday_();
  var from = String(req.from || '');
  if (!re.test(from)) {
    var days = Math.min(92, Math.max(1, Math.floor(Number(req.days) || 7)));
    var t = new Date(to + 'T12:00:00Z');
    t.setUTCDate(t.getUTCDate() - days + 1);
    from = t.toISOString().slice(0, 10);
  }
  return croSummary_(from, to);
}

/** Action `cro_init` (POST): stores the SHA-256 of a caller-chosen key (≥ 32 characters) once. Rotation: delete the property. */
function croInit_(req) {
  var key = String(req.key || '');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) return { ok: false, error: 'bad_request' };
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try {
    if (props.getProperty('CRO_KEY_SHA256')) return { ok: true, already: true, match: croKeyOk_(key) };
    props.setProperty('CRO_KEY_SHA256', croHex_(key));
  } finally {
    lock.releaseLock();
  }
  return { ok: true, set: true };
}
