/* Veille AO Afrique : filtres de la liste (données : data/ouverts.json, chargé à la première utilisation). */
(function () {
  'use strict';
  var form = document.getElementById('filtres');
  if (!form) return;
  var out = document.getElementById('resultats');
  var count = document.getElementById('compte');
  var more = document.getElementById('plus');
  var root = location.pathname.replace(/[^/]*$/, '');
  var data = null, loading = null, shown = 0, list = [], tracked = {};
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nb(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function mad(v) { return v >= 1e6 ? (v / 1e6).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') + ' M MAD' : nb(Math.round(v)) + ' MAD'; }
  function day(iso) { return iso ? new Date(iso.slice(0, 10) + 'T12:00:00Z') : null; }
  function left(n) { var d = day(n.d); return d ? Math.round((d - day(data.today)) / 864e5) : null; }
  function short(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      count.textContent = 'Chargement de la liste complète…';
      loading = fetch(root + 'data/ouverts.json', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (j) {
        data = j;
        j.notices.forEach(function (n) { n._t = fold([n.o, n.b, n.p.join(' '), n.k].join(' ')); n._b = fold(n.b); n._p = fold(n.p.join(' ')); });
        fill('villes', j.notices.reduce(function (a, n) { n.p.forEach(function (p) { a[p] = (a[p] || 0) + 1; }); return a; }, {}));
        fill('acheteurs', j.notices.reduce(function (a, n) { if (n.b) a[n.b] = (a[n.b] || 0) + 1; return a; }, {}));
        return j;
      });
    }
    return loading;
  }
  function fill(id, counts) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 400)
      .map(function (k) { return '<option value="' + esc(k) + '">'; }).join('');
  }
  function values() {
    var v = {};
    ['q', 'secteur', 'region', 'ville', 'acheteur', 'echeance', 'categorie', 'pays', 'tri'].forEach(function (k) { v[k] = (form.elements[k].value || '').trim(); });
    return v;
  }
  function apply() {
    var v = values();
    var words = fold(v.q).split(/\s+/).filter(Boolean);
    var ville = fold(v.ville), ach = fold(v.acheteur);
    list = data.notices.filter(function (n) {
      if (v.secteur && n.s.indexOf(v.secteur) < 0) return false;
      if (v.region && n.r.indexOf(v.region) < 0) return false;
      if (v.categorie && n.c !== v.categorie) return false;
      if (v.pays && n.k !== v.pays) return false;
      if (ville && n._p.indexOf(ville) < 0) return false;
      if (ach && n._b.indexOf(ach) < 0) return false;
      if (v.echeance) {
        var l = left(n);
        if (l === null) return false;
        if (v.echeance === '31+' ? l <= 30 : l > Number(v.echeance)) return false;
      }
      for (var i = 0; i < words.length; i++) if (n._t.indexOf(words[i]) < 0) return false;
      return true;
    });
    if (v.tri === 'cloture') list.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    else if (v.tri === 'montant') list.sort(function (a, b) { return b.e - a.e; });
    shown = 0;
    out.innerHTML = '';
    render(50);
    var active = Object.keys(v).filter(function (k) { return v[k] && k !== 'tri'; }).length;
    count.textContent = nb(list.length) + (list.length > 1 ? ' avis correspondent' : ' avis correspond') + (active ? ' à vos filtres.' : ' : toute la liste.');
    var qs = new URLSearchParams();
    Object.keys(v).forEach(function (k) { if (v[k] && !(k === 'tri' && v[k] === 'recent')) qs.set(k, v[k]); });
    history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + '#liste');
  }
  function badge(n) {
    var l = left(n);
    if (l === null) return '';
    if (l <= 0) return '<span class="badge urgent">Dernier jour</span>';
    return '<span class="badge ' + (l <= 7 ? 'urgent' : l <= 14 ? 'soon' : '') + '">J-' + l + '</span>';
  }
  function card(n) {
    var facts = [n.c, n.x === 'BM' ? n.k : (n.p.slice(0, 3).join(', ') || 'Maroc'), n.e ? mad(n.e) : ''].filter(Boolean)
      .map(function (f) { return '<span>' + esc(f) + '</span>'; }).join('');
    return '<article class="card"><div class="card-top">' + badge(n) + '<span class="src">' + (n.x === 'BM' ? 'Banque mondiale' : 'Portail marocain') +
      '</span><span class="dl">Clôture ' + short(n.d) + '</span></div><h3 class="card-title"><a href="' + root + 'ao/' + esc(n.i) + '/">' + esc(n.o) +
      '</a></h3><p class="buyer">' + esc(n.b) + '</p><p class="facts">' + facts + '</p></article>';
  }
  function render(k) {
    var html = '';
    var end = Math.min(list.length, shown + k);
    for (var i = shown; i < end; i++) html += card(list[i]);
    if (!out.firstElementChild || !out.firstElementChild.classList.contains('cards')) out.innerHTML = '<div class="cards"></div>';
    out.firstElementChild.insertAdjacentHTML('beforeend', html);
    if (!list.length) out.innerHTML = '<p class="empty">Aucun avis ne correspond. Élargissez un filtre, ou <a href="' + root + 'alertes/">créez une alerte</a> pour être prévenu des prochains.</p>';
    shown = end;
    more.hidden = shown >= list.length;
  }
  var timer;
  function changed(e) {
    var name = e && e.target && e.target.name;
    if (name && name !== 'tri' && !tracked[name] && e.target.value && window.aoaMesure) {
      tracked[name] = 1;
      window.aoaMesure(name === 'q' ? 'search_use' : 'filter_use', name);
    }
    clearTimeout(timer);
    timer = setTimeout(function () { load().then(apply); }, e && e.type === 'input' ? 250 : 0);
  }
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
  form.addEventListener('submit', function (e) { e.preventDefault(); changed(); });
  form.addEventListener('reset', function () { setTimeout(function () { load().then(apply); }, 0); });
  form.elements.ville.addEventListener('focus', load, { once: true });
  form.elements.acheteur.addEventListener('focus', load, { once: true });
  more.hidden = false;
  more.addEventListener('click', function () {
    if (!data || !list.length) { load().then(function () { apply(); render(0); }); return; }
    render(50);
  });
  var qs = new URLSearchParams(location.search), any = false;
  qs.forEach(function (val, k) { if (form.elements[k]) { form.elements[k].value = val; any = true; } });
  if (any) load().then(apply);
})();
