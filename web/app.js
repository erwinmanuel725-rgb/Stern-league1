(function () {
  'use strict';
  // Tout le calcul (cotes, solde, règlement) est fait par le serveur : ici on ne fait qu'afficher et envoyer des demandes.
  var st = null, tab = 'matchs', pick = {}, ticketStake = 100, offline = false, confirmRelease = false, toastTimer = null;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (v) { return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // ---------- réseau ----------
  function api(method, path, body) {
    var o = { method: method, credentials: 'same-origin' };
    if (method !== 'GET') { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(body || {}); }
    return fetch('/api' + path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'Erreur inattendue.'); e.status = r.status; e.data = d; throw e; }
        return d;
      });
    });
  }
  function toast(msg, kind) {
    var t = $('#toast'); t.textContent = msg; t.className = 'show ' + (kind || '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = ''; }, 5000);
  }
  function load() {
    return api('GET', '/state').then(function (s) { st = s; render(); }).catch(function (e) {
      if (!st) $('#view').innerHTML = '<div class="card tc">Impossible de charger les données. <button type="button" class="btn g sm" data-act="reload">Réessayer</button></div>';
      else toast(e.message, 'err');
    });
  }
  function connect() {
    var es = new EventSource('/api/events');
    es.addEventListener('update', load);
    es.onopen = function () { if (offline) { offline = false; $('#banner').className = ''; load(); } };
    es.onerror = function () {
      offline = true; $('#banner').className = 'show';
      if (es.readyState === 2) { es.close(); setTimeout(connect, 10000); } // fermé définitivement : on retente nous-mêmes
    };
  }

  // ---------- utilitaires d'affichage ----------
  var P = function (i) { return st.players[i]; };
  var nameOf = function (i) { return P(i).name; };
  function av(i, big, cls) {
    var p = i == null ? null : P(i), c = 'av' + (big ? ' big' : '') + (cls ? ' ' + cls : '');
    if (!p) return '<div class="' + c + ' dim" aria-hidden="true">?</div>';
    return '<div class="' + c + '" aria-hidden="true">' + (p.img ? '<img src="' + esc(p.img) + '" alt="" loading="lazy">' : esc(Array.from(p.name)[0])) + '</div>';
  }
  // classe visuelle d'un côté (win / dull) selon le score
  function fx(x, s) {
    if (!x) return '';
    if (x[2]) return x[2] === s + 1 ? 'dull' : 'win';
    if (x[0] === x[1]) return 'dull';
    return ((x[0] > x[1]) === (s === 0)) ? 'win' : '';
  }
  function fmtDate(iso) { return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  var fmt = function (n) { return Number(n).toLocaleString('fr-FR'); };

  // ---------- rendu ----------
  function renderMe() {
    var h;
    if (st.me) {
      h = '<span class="mu">Connecté :</span><b>' + esc(st.me.name) + '</b><span class="bal">' + fmt(st.me.available) + ' pts dispo</span>' +
        '<button type="button" class="btn g sm" data-act="release">' + (confirmRelease ? 'Confirmer : libérer ce pseudo ?' : 'Changer de pseudo') + '</button>';
    } else {
      h = '<label class="mu" for="who">Je suis :</label><select id="who"><option value="">— choisir —</option>' +
        st.players.map(function (p) {
          return '<option value="' + p.id + '"' + (p.claimed ? ' disabled' : '') + '>' + (p.claimed ? '🔒 ' : '') + esc(p.name) + (p.kind === 'league' ? ' ⚔️' : '') + '</option>';
        }).join('') + '</select><span class="bal">Choisis ton pseudo</span>';
    }
    $('#me').innerHTML = h;
  }
  function poster(m) {
    var x = m.result ? [m.result.h, m.result.a, m.result.ff] : null, h = nameOf(m.h), a = nameOf(m.a), own = st.me && (st.me.id === m.h || st.me.id === m.a);
    var s = '<div class="poster"><div class="pin"><div class="pj f">Journée ' + m.j + '</div><div class="hr">📅 ' + fmtDate(m.date) + ' · 🕘 ' + m.hour + 'H00 GMT</div><div class="mu tc">' +
      (x ? (x[2] ? '<b class="rd">🚩 FORFAIT</b>' : '<b class="ok">✅ TERMINÉ</b>') : '<b class="bl">⏳ À VENIR</b>') + '</div><div class="ref">🛡️ ARBITRE : <b>' + esc(m.referee) + '</b></div>' +
      '<div class="vs"><div class="side">' + av(m.h, 1, fx(x, 0)) + '<b class="f">' + esc(h) + '</b></div>' +
      (x ? '<div class="sco f">' + (x[2] ? (x[2] === 1 ? 'F' : 'V') : x[0]) + ' – ' + (x[2] ? (x[2] === 2 ? 'F' : 'V') : x[1]) + '</div>' : '<div class="vst f">VS</div>') +
      '<div class="side">' + av(m.a, 1, fx(x, 1)) + '<b class="f">' + esc(a) + '</b></div></div>';
    if (!x) {
      s += '<div class="odds">' + [h, 'Match nul', a].map(function (l, k) {
        var sel = pick[m.id] === k;
        return '<button type="button" class="' + (sel ? 'sel' : '') + '" data-act="pick" data-m="' + m.id + '" data-k="' + k + '" aria-pressed="' + sel + '"' + (m.open ? '' : ' disabled') + '>' + esc(l) + '<b>' + m.odds[k].toFixed(2) + '</b></button>';
      }).join('') + '</div>';
      if (!m.open) s += '<div class="closed">🔒 Paris clos : le match a commencé.</div>';
      else if (own) s += '<div class="mu tc mt8">Tu joues ce match : pas de pari possible.</div>';
      else s += '<div class="mu tc mt8">' + (pick[m.id] !== undefined ? '<b class="gold">✓ Sélectionné dans ton ticket</b>' : 'Clique sur une cote pour l’ajouter au ticket') + '</div>';
    }
    return s + '</div></div>';
  }
  function compactDay(j, matches) {
    // Rendu compact d'une journée entièrement terminée (format historique)
    return '<div class="card"><b class="f">Journée ' + j + ' · ✅ terminée</b>' +
      matches.map(function (m) {
        // Supporte les deux formats : {hs,as,ff,hi,ai,h,a} (history) et {result,h(id),a(id)} (matches)
        var rh = m.hs !== undefined ? m.hs : (m.result ? m.result.h : 0);
        var ra = m.as !== undefined ? m.as : (m.result ? m.result.a : 0);
        var ff = m.ff !== undefined ? m.ff : (m.result ? m.result.ff : 0);
        var x = [rh, ra, ff];
        var sc = ff ? (ff === 1 ? 'F' : 'V') + ' – ' + (ff === 2 ? 'F' : 'V') : rh + ' – ' + ra;
        // hi/ai = index avatar ; h/a = nom affiché
        var hi = m.hi !== undefined ? m.hi : m.h;
        var ai = m.ai !== undefined ? m.ai : m.a;
        var hn = typeof m.hn === 'string' ? m.hn : (typeof m.h === 'string' ? m.h : (P(m.h) ? P(m.h).name : ''));
        var an = typeof m.an === 'string' ? m.an : (typeof m.a === 'string' ? m.a : (P(m.a) ? P(m.a).name : ''));
        return '<div class="m hrow"><span class="t r">' + esc(hn) + '</span>' + av(hi, 0, fx(x, 0)) + '<b class="sc2">' + sc + '</b>' + av(ai, 0, fx(x, 1)) + '<span class="t">' + esc(an) + '</span></div>';
      }).join('') + '</div>';
  }
  function histHtml(skipH2) {
    // Journées passées issues de history_matches, ordre décroissant
    var days = [];
    st.history.forEach(function (m) { if (days.indexOf(m.j) === -1) days.push(m.j); });
    days.sort(function (a, b) { return b - a; });
    if (!days.length) return '';
    var s = skipH2 ? '' : '<h2 class="f">Journées passées</h2>';
    days.forEach(function (j) {
      // Adapter le format history vers compactDay : {h=nom, a=nom, hi, ai, hs, as, ff}
      s += compactDay(j, st.history.filter(function (m) { return m.j === j; }).map(function (m) {
        return { hn: m.h, an: m.a, hi: m.hi, ai: m.ai, hs: m.hs, as: m.as, ff: m.ff };
      }));
    });
    return s;
  }
  function viewMatchs() {
    // Regrouper st.matches par journée (m.j)
    var byDay = {};
    st.matches.forEach(function (m) { (byDay[m.j] = byDay[m.j] || []).push(m); });
    var dayNums = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; });

    // Matchs de la journée courante
    var curMatches = byDay[st.cur] || [];
    var up = curMatches.filter(function (m) { return !m.result; }); // à venir
    var dn = curMatches.filter(function (m) { return m.result; });  // joués ce jour

    // Journées ENTIÈREMENT terminées hors journée courante (viennent de st.matches)
    var doneDays = dayNums.filter(function (j) {
      return j !== st.cur && byDay[j].every(function (m) { return !!m.result; });
    });

    // Convertir un match de st.matches vers le format compact
    function toCompact(m) {
      return { hn: P(m.h).name, an: P(m.a).name, hi: m.h, ai: m.a, hs: m.result.h, as: m.result.a, ff: m.result.ff || 0 };
    }

    // --- Section "Journées passées" ---
    // Inclut : journée courante si elle a des matchs joués (en cours / partielle),
    //          + doneDays de st.matches, + st.history — tout en ordre décroissant.
    var histDays = [];
    st.history.forEach(function (m) { if (histDays.indexOf(m.j) === -1) histDays.push(m.j); });

    // Jours à afficher en compact (sans la journée courante gérée séparément)
    var allPastDays = doneDays.concat(histDays.filter(function (j) { return doneDays.indexOf(j) === -1; }));
    allPastDays.sort(function (a, b) { return b - a; });

    var pastHtml = '';
    var hasPast = dn.length || allPastDays.length;
    if (hasPast) {
      pastHtml += '<h2 class="f">Journées passées</h2>';

      // Matchs déjà joués de la journée en cours → carte partielle en tête
      if (dn.length) {
        var curDone = dn.map(toCompact);
        var label = dn.length === curMatches.length ? '✅ terminée' : dn.length + '/' + curMatches.length + ' joués';
        pastHtml += '<div class="card"><b class="f">Journée ' + st.cur + ' · ' + label + '</b>' +
          curDone.map(function (m) {
            var x = [m.hs, m.as, m.ff];
            var sc = m.ff ? (m.ff === 1 ? 'F' : 'V') + ' – ' + (m.ff === 2 ? 'F' : 'V') : m.hs + ' – ' + m.as;
            return '<div class="m hrow"><span class="t r">' + esc(m.hn) + '</span>' + av(m.hi, 0, fx(x, 0)) + '<b class="sc2">' + sc + '</b>' + av(m.ai, 0, fx(x, 1)) + '<span class="t">' + esc(m.an) + '</span></div>';
          }).join('') + '</div>';
      }

      // Journées entièrement terminées (st.matches + history), ordre décroissant
      allPastDays.forEach(function (j) {
        if (doneDays.indexOf(j) !== -1) {
          pastHtml += compactDay(j, byDay[j].map(toCompact));
        } else {
          pastHtml += compactDay(j, st.history.filter(function (m) { return m.j === j; }).map(function (m) {
            return { hn: m.h, an: m.a, hi: m.hi, ai: m.ai, hs: m.hs, as: m.as, ff: m.ff };
          }));
        }
      });
    }

    // --- Affichage principal ---
    var html = '';
    html += '<div class="card tc">🛠️ Organisateur : <b>Apolo</b><br>🛡️ Modérateurs (arbitres) : <b class="gold">Yuta</b> · <b class="gold">Akira</b> · <b class="gold">Apolo</b></div>';
    html += '<h2 class="f">Journée ' + st.cur + ' · affiches à venir</h2>';
    html += '<p class="mu">La journée suivante est publiée quand tous les matchs de celle-ci sont joués. 3 matchs par jour : 18h, 19h et 20h GMT.</p>';
    html += (up.map(poster).join('') || '<p class="mu">Aucun match à venir.</p>');
    html += pastHtml;
    return html;
  }
  function viewClass() {
    return '<div class="card sc"><table><caption class="sr">Classement de la ligue</caption><tr><th>#</th><th class="n">JOUEUR</th><th>PTS</th><th>J</th><th>V</th><th>N</th><th>D</th><th>BP</th><th>BC</th><th>DIFF</th></tr>' +
      st.standings.map(function (p, i) {
        return '<tr class="' + (i >= 15 ? 'rel' : i >= 8 ? 'mid' : '') + '"><td><span class="rk">' + (i + 1) + '</span></td><td class="n"><div class="pl">' + av(p.i) + esc(p.n) + '</div></td><td class="pts">' + p.pts + '</td><td>' + p.j + '</td><td>' + p.v + '</td><td>' + p.d + '</td><td>' + p.l + '</td><td>' + p.bp + '</td><td>' + p.bc + '</td><td>' + (p.db > 0 ? '+' : '') + p.db + '</td></tr>';
      }).join('') + '</table></div>' +
      '<div class="leg"><span><i class="dot dot-bl"></i>Top 8</span><span><i class="dot dot-gr"></i>Milieu</span><span><i class="dot dot-rd"></i>Zone rouge (16–18)</span></div><p class="mu">PTS = 3 par victoire, 1 par nul. BP = buts pour, BC = buts contre.</p>';
  }
  function viewBut() {
    var s = st.standings.slice().sort(function (a, b) { return b.bp - a.bp || a.j - b.j; }), md = ['🥇', '🥈', '🥉'];
    return '<div class="card sc"><table class="narrow"><caption class="sr">Meilleurs buteurs</caption><tr><th>#</th><th class="n">BUTEUR</th><th>J</th><th>BUTS</th><th>MOY.</th></tr>' + s.map(function (p, i) {
      return '<tr><td>' + (md[i] || '<span class="rk rk-gr">' + (i + 1) + '</span>') + '</td><td class="n"><div class="pl">' + av(p.i) + esc(p.n) + '</div></td><td>' + p.j + '</td><td class="pts">' + p.bp + '</td><td>' + (p.j ? (p.bp / p.j).toFixed(1) : '0.0') + '</td></tr>';
    }).join('') + '</table></div>';
  }
  function viewPts() {
    var L = st.players.slice().sort(function (a, b) { return b.balance - a.balance; });
    return '<div class="card sc"><table class="narrow"><caption class="sr">Points généraux</caption><tr><th>#</th><th class="n">PSEUDO</th><th>STATUT</th><th>POINTS</th></tr>' + L.map(function (p, k) {
      return '<tr><td><span class="rk rk-gr">' + (k + 1) + '</span></td><td class="n"><b>' + esc(p.name) + '</b></td><td>' + (p.kind === 'league' ? '<span class="tag p">Ligue</span>' : p.kind === 'mod' ? '<span class="tag l">🛡️ Modérateur</span>' : '<span class="mu">Parieur</span>') + '</td><td class="pts">' + fmt(p.balance) + '</td></tr>';
    }).join('') + '</table></div><p class="mu">Points généraux : la monnaie des paris, indépendante du classement de la ligue. Ils sont fictifs.</p>';
  }
  function viewParis() {
    if (!st.me) return '<div class="card mu">Choisis ton pseudo en haut pour voir tes paris.</div>';
    if (!st.bets.length) return '<div class="card mu">Aucun pari pour l’instant. Va dans « Matchs » pour miser tes points.</div>';

    return st.bets.map(function (b) {
      var isCombo = b.type === 'combo' || (b.legs && b.legs.length > 1);
      var badge = '<span class="tag ' + b.s + '">' + (b.s === 'p' ? 'En cours' : b.s === 'w' ? 'Gagné +' + fmt(b.delta) : 'Perdu −' + fmt(b.st)) + '</span>';

      if (isCombo) {
        var legsHtml = (b.legs || []).map(function (l) {
          var m = st.matches.filter(function (z) { return z.id === l.m; })[0];
          var title = m ? esc(nameOf(m.h)) + ' vs ' + esc(nameOf(m.a)) : 'Match n°' + l.m;
          var c = !m ? '' : l.k === 0 ? nameOf(m.h) : l.k === 1 ? 'Match nul' : nameOf(m.a);
          var lBadge = l.s === 'w' ? '<span class="tag w">✅ Gagné</span>' :
                       l.s === 'l' ? '<span class="tag l">❌ Perdu</span>' :
                       l.s === 'v' ? '<span class="tag mu">⚪ Annulé (1.00)</span>' :
                                     '<span class="tag p">⏳ En attente</span>';
          return '<div class="m hrow"><div class="t"><div class="f-sm">' + title + '</div><div class="mu">Pronostic : <b>' + esc(c) + '</b> · cote ' + Number(l.odd).toFixed(2) + '</div></div>' + lBadge + '</div>';
        }).join('');

        return '<div class="card">' +
          '<div class="m mb8"><div><b class="f">🎟️ Combiné (' + (b.legs ? b.legs.length : 0) + ' sélections)</b>' +
          '<div class="mu">Mise : ' + fmt(b.st) + ' pts · Cote totale : <b>' + Number(b.odd).toFixed(2) + '</b> · Gain pot. : <b>' + fmt(Math.round(b.st * b.odd)) + ' pts</b></div></div>' + badge + '</div>' +
          '<div class="combo-legs">' + legsHtml + '</div>' +
          '</div>';
      }

      var m = st.matches.filter(function (z) { return z.id === b.m; })[0];
      var title = m ? esc(nameOf(m.h)) + ' vs ' + esc(nameOf(m.a)) : 'Match n°' + b.m;
      var c = !m ? '' : b.k === 0 ? nameOf(m.h) : b.k === 1 ? 'Match nul' : nameOf(m.a);
      return '<div class="card"><div class="m"><div><b>' + title + '</b><div class="mu">Pari : ' + esc(c) + ' · mise ' + fmt(b.st) + ' pt(s) · cote ' + Number(b.odd).toFixed(2) + ' · Gain pot. : ' + fmt(Math.round(b.st * b.odd)) + ' pts</div></div>' + badge + '</div></div>';
    }).join('');
  }
  var TABS = [['matchs', '⚔️ Matchs'], ['class', '🏆 Classement'], ['but', '🎯 Buteurs'], ['pts', '💰 Points'], ['paris', '🎟️ Mes paris']];
  var VIEWS = { matchs: viewMatchs, class: viewClass, but: viewBut, pts: viewPts, paris: viewParis };

  function renderBetslip() {
    var el = $('#betslip');
    if (!el) return;
    var mIds = Object.keys(pick);
    if (!mIds.length || tab !== 'matchs') {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = 'flex';

    var count = mIds.length;
    var isCombo = count > 1;
    var title = isCombo ? '🎟️ Combiné (' + count + ' matchs)' : '🎟️ Pari simple (1 match)';

    var oddsList = [];
    var itemsHtml = mIds.map(function (mid) {
      var m = st.matches.filter(function (z) { return z.id === +mid; })[0];
      if (!m) return '';
      var k = pick[mid];
      var label = k === 0 ? nameOf(m.h) : k === 1 ? 'Match nul' : nameOf(m.a);
      var odd = m.odds[k];
      oddsList.push(odd);
      return '<div class="bs-item">' +
        '<div class="bs-row"><span class="bs-match">' + esc(nameOf(m.h)) + ' vs ' + esc(nameOf(m.a)) + '</span>' +
        '<button type="button" class="bs-del" data-act="unpick" data-m="' + m.id + '" title="Retirer de mon ticket">✕</button></div>' +
        '<div class="bs-row"><span class="bs-choice">Choix : <b>' + esc(label) + '</b></span><span class="bs-odd">' + odd.toFixed(2) + '</span></div>' +
      '</div>';
    }).join('');

    var totalOdd = oddsList.length ? oddsList.reduce(function (acc, o) { return acc * o; }, 1) : 1;
    totalOdd = Math.round(totalOdd * 100) / 100;

    var stake = parseInt(ticketStake || '100', 10);
    if (isNaN(stake) || stake < 0) stake = 0;
    var potWin = Math.round(stake * totalOdd);
    var potNet = Math.max(0, Math.round(stake * (totalOdd - 1)));
    var avail = st.me ? st.me.available : 0;
    var disabled = !st.me || stake < 1 || stake > 1000 || stake > avail;

    var h = '<div class="bs-head">' +
      '<b class="f">' + title + '</b>' +
      '<button type="button" class="btn g sm" data-act="clear-ticket">Vider</button>' +
    '</div>' +
    '<div class="bs-body">' + itemsHtml + '</div>' +
    '<div class="bs-foot">' +
      '<div class="bs-row"><span class="mu">Cote totale :</span><b class="bs-tot-odd">' + totalOdd.toFixed(2) + '</b></div>' +
      '<div class="bs-row"><label class="mu" for="tstake">Mise (max 1000) :</label><div class="bs-stake-box"><input type="number" id="tstake" min="1" max="1000" step="1" value="' + esc(ticketStake) + '"><span class="mu">pts</span></div></div>' +
      '<div class="bs-row"><span class="mu">Gain potentiel :</span><b class="bs-gain">' + fmt(potWin) + ' pts <small class="mu">(+' + fmt(potNet) + ' net)</small></b></div>' +
      (st.me ? '<div class="mu tc">Disponible : <b>' + fmt(avail) + '</b> pts</div>' : '<div class="mu tc rd">Choisis ton pseudo en haut pour parier</div>') +
      '<button type="button" class="btn bs-btn" data-act="submit-ticket"' + (disabled ? ' disabled' : '') + '>' +
        'VALIDER (' + fmt(stake) + ' pts)' +
      '</button>' +
    '</div>';

    el.innerHTML = h;
  }

  function render() {
    if (!st) return;
    var ae = document.activeElement, keep = ae && ae.id && /^(tstake|who)$/.test(ae.id) ? { id: ae.id, s: ae.selectionStart } : null;
    $('#nav').innerHTML = TABS.map(function (t) { return '<button type="button" class="' + (tab === t[0] ? 'on' : '') + '" data-act="tab" data-t="' + t[0] + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>'; }).join('');
    renderMe();
    $('#view').innerHTML = VIEWS[tab]();
    $('#view').setAttribute('aria-busy', 'false');
    renderBetslip();
    if (keep) { var n = document.getElementById(keep.id); if (n) { n.focus(); try { n.setSelectionRange(keep.s, keep.s); } catch (e) { /* select : pas de curseur */ } } }
  }

  // ---------- actions (délégation d'événements : aucun onclick dans le HTML) ----------
  function submitTicket() {
    if (!st.me) return toast('Choisis d’abord ton pseudo en haut de la page.', 'err');
    var mIds = Object.keys(pick);
    if (!mIds.length) return toast('Sélectionne au moins un match.', 'err');
    var stake = parseInt(ticketStake || '100', 10);
    if (!(stake >= 1 && stake <= 1000)) return toast('Mise invalide (entre 1 et 1000 pts).', 'err');
    if (stake > st.me.available) return toast('Mise supérieure à tes points disponibles.', 'err');

    var selections = mIds.map(function (mid) {
      var m = st.matches.filter(function (z) { return z.id === +mid; })[0];
      var k = pick[mid];
      return { matchId: +mid, outcome: k, oddSeen: m.odds[k] };
    });

    api('POST', '/bets', { selections: selections, stake: stake }).then(function (r) {
      pick = {};
      var msg = (r.type === 'combo' ? 'Combiné enregistré (' + r.selections.length + ' matchs) : ' : 'Pari enregistré : ') +
        r.stake + ' pts à la cote ' + r.odd.toFixed(2) + ' ✅';
      toast(msg, 'good');
      return load();
    }).catch(function (e) {
      toast(e.message, 'err');
      if (e.status === 409) load();
    });
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-act');
    if (a === 'tab') { tab = b.getAttribute('data-t'); render(); }
    else if (a === 'pick') {
      var mid = +b.getAttribute('data-m'), k = +b.getAttribute('data-k');
      if (pick[mid] === k) {
        delete pick[mid]; // Re-cliquer la retire
      } else {
        if (Object.keys(pick).length >= 8 && pick[mid] === undefined) {
          toast('Maximum 8 sélections dans un combiné.', 'err');
          return;
        }
        pick[mid] = k; // Remplace ou ajoute
      }
      render();
    }
    else if (a === 'unpick') {
      delete pick[+b.getAttribute('data-m')];
      render();
    }
    else if (a === 'clear-ticket') {
      pick = {};
      render();
    }
    else if (a === 'submit-ticket') {
      submitTicket();
    }
    else if (a === 'reload') load();
    else if (a === 'release') {
      if (!confirmRelease) { confirmRelease = true; renderMe(); setTimeout(function () { confirmRelease = false; if (st) renderMe(); }, 5000); return; }
      confirmRelease = false;
      api('POST', '/me/release').then(function () { toast('Pseudo libéré.', 'good'); return load(); }).catch(function (e) { toast(e.message, 'err'); });
    }
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'tstake') {
      ticketStake = ev.target.value;
      renderBetslip();
    }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.id !== 'who' || !ev.target.value) return;
    api('POST', '/me/claim', { playerId: +ev.target.value }).then(function () { toast('Pseudo réservé pour cet appareil ✅', 'good'); return load(); })
      .catch(function (e) { toast(e.message, 'err'); load(); });
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });

  load(); connect();
  setInterval(function () { if (!document.hidden) load(); }, 60000); // filet de sécurité + fermeture automatique des paris au coup d'envoi
})();
