/* Veille AO Afrique : test A/B AOAF-ALERT-INLINE-01 sur les fiches /ao/ (règle : experiments/AOAF-ALERT-INLINE-01.md
   dans octave-asset-ventures). A = fiche actuelle ; B = en plus, un formulaire d'alerte à un champ juste au-dessus du
   lien vers l'avis officiel. Chargé sans defer avant cro.js : le bras est posé sur <html> avant l'affichage, donc la
   page ne saute pas. Tirage 50/50 une fois par onglet (stockage de session, clé lue aussi par cro.js), ?xp_aoaf=a|b
   force un bras pour la recette. Aucun cookie, rien qui relie le bras à une personne. */
window.OCTAVE_XP = [{ id: 'aoaf-alert', variants: ['a', 'b'], mode: 'tab', param: 'xp_aoaf', pages: '^/ao/[^/]+/?$' }];
(function (d) {
  'use strict';
  var k = 'oxp_aoaf-alert', v = null, q = null;
  try { q = new URLSearchParams(location.search).get('xp_aoaf'); } catch (e) {}
  try { v = sessionStorage.getItem(k); } catch (e) {}
  if (q === 'a' || q === 'b') v = q;
  if (v !== 'a' && v !== 'b') v = Math.random() < 0.5 ? 'a' : 'b';
  try { sessionStorage.setItem(k, v); } catch (e) {}
  d.documentElement.setAttribute('data-xp-aoaf-alert', v);
})(document);
