(function () {
  'use strict';
  var A = null, tab = 'res', md = null, logged = false, confirmCancel = null, txPlayer = 0, tx = [], logRows = [], toastTimer = null;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return Number(n).toLocaleString('fr-FR'); };

  function api(method, path, body) {
    var o = { method: method, credentials: 'same-origin' };
    if (method !== 'GET') { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(body || {}); }
    return fetch('/api/admin' + path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && path !== '/login') { logged = false; renderLogin(); }
        if (!r.ok) { var e = new Error(d.error || 'Erreur inattendue.'); e.status = r.status; throw e; }
        return d;
      });
    });
  }
  function toast(msg, kind) {
    var t = $('#toast'); t.textContent = msg; t.className = 'show ' + (kind || '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = ''; }, 6000);
  }
  var pname = function (i) { return A.players.filter(function (p) { return p.id === i; })[0].name; };
  var fdate = function (iso) { return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };

  function renderLogin() {
    $('#nav').innerHTML = '';
    $('#view').innerHTML = '<div class="card tc"><form id="lf" autocomplete="on"><h2 class="f">Connexion organisateur</h2><div class="fld"><label class="sr" for="pw">Mot de passe</label><input type="password" id="pw" autocomplete="current-password" required maxlength="200" placeholder="Mot de passe"><button class="btn" type="submit">Se connecter</button></div><p class="mu">Session limitée dans le temps. Les tentatives sont limitées et enregistrées.</p></form></div>';
    var f = $('#lf'); f.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = $('#pw').value; $('#pw').value = '';
      api('POST', '/login', { password: pw }).then(function () { logged = true; return refresh(); }).catch(function (er) { toast(er.message, 'err'); });
    });
    $('#pw').focus();
  }
  function refresh() {
    return api('GET', '/state').then(function (s) { A = s; if (md === null) md = s.cur; logged = true; render(); }).catch(function (e) { if (e.status !== 401) toast(e.message, 'err'); });
  }

  // ---------- onglets ----------
  var TABS = [['res', '⚽ Résultats'], ['cal', '📅 Calendrier'], ['pts', '💰 Points'], ['pl', '👥 Joueurs'], ['log', '📜 Journal'], ['tools', '🛠️ Outils']];
  function mdOptions() { var o = ''; for (var j = 4; j <= 34; j++) o += '<option value="' + j + '"' + (j === md ? ' selected' : '') + '>Journée ' + j + (j === A.cur ? ' (en cours)' : '') + '</option>'; return o; }
  function viewRes() {
    var ms = A.matches.filter(function (m) { return m.j === md; });
    return '<div class="fld"><label class="mu" for="mdsel">Journée :</label><select id="mdsel">' + mdOptions() + '</select></div>' + ms.map(function (m) {
      var r = m.result, sc = r ? (r.ff ? (r.ff === 1 ? 'F' : 'V') + ' – ' + (r.ff === 2 ? 'F' : 'V') : r.h + ' – ' + r.a) : null;
      return '<div class="card"><div class="m"><span class="mu">' + fdate(m.date) + ' · ' + m.hour + 'h GMT · 🛡️ ' + esc(m.referee) + '</span><span class="mu">' + m.bets + ' pari(s) · ' + fmt(m.staked) + ' pts</span></div>' +
        '<div class="m crow"><span class="t r">' + esc(pname(m.h)) + '</span><b class="sc2">' + (sc || 'vs') + '</b><span class="t">' + esc(pname(m.a)) + '</span></div>' +
        '<div class="fld"><label class="sr" for="ha' + m.id + '">Buts ' + esc(pname(m.h)) + '</label><input class="w2" type="number" min="0" max="99" id="ha' + m.id + '" value="' + (r && !r.ff ? r.h : '') + '"> – ' +
        '<label class="sr" for="aa' + m.id + '">Buts ' + esc(pname(m.a)) + '</label><input class="w2" type="number" min="0" max="99" id="aa' + m.id + '" value="' + (r && !r.ff ? r.a : '') + '">' +
        '<button type="button" class="btn g sm" data-act="save" data-m="' + m.id + '">' + (r ? 'Corriger' : 'Valider') + '</button>' +
        '<button type="button" class="btn g sm" data-act="ff" data-m="' + m.id + '" data-ff="1">🚩 Forfait gauche</button><button type="button" class="btn g sm" data-act="ff" data-m="' + m.id + '" data-ff="2">🚩 Forfait droite</button>' +
        (r ? '<button type="button" class="btn dg sm" data-act="cancel" data-m="' + m.id + '">' + (confirmCancel === m.id ? 'Confirmer l’annulation' : 'Annuler le résultat') + '</button>' : '') + '</div></div>';
    }).join('');
  }
  function viewCal() {
    var s = '<p class="mu">Calendrier complet (visible uniquement ici). Les joueurs ne voient que la journée en cours.</p>';
    for (var j = 4; j <= 34; j++) {
      s += '<div class="card"><b class="f">Journée ' + j + (j === A.cur ? ' · en cours' : j < A.cur ? ' · publiée' : ' · à venir') + '</b>' + A.matches.filter(function (m) { return m.j === j; }).map(function (m) {
        return '<div class="m crow"><span class="mu">' + fdate(m.date) + ' · ' + m.hour + 'h</span><span class="t r">' + esc(pname(m.h)) + '</span><b>' + (m.result ? m.result.h + ' – ' + m.result.a : 'vs') + '</b><span class="t">' + esc(pname(m.a)) + '</span><span class="mu">🛡️ ' + esc(m.referee) + '</span></div>';
      }).join('') + '</div>';
    }
    return s;
  }
  function viewPts() {
    var opts = A.players.map(function (p) { return '<option value="' + p.id + '"' + (p.id === txPlayer ? ' selected' : '') + '>' + esc(p.name) + ' (' + fmt(p.balance) + ')</option>'; }).join('');
    return '<div class="card"><b class="f">Modifier les points</b><div class="fld"><label class="sr" for="ep">Joueur</label><select id="ep">' + opts + '</select>' +
      '<label class="sr" for="ev">Nouveau total</label><input class="w3" type="number" id="ev" min="0" placeholder="nouveau total">' +
      '<label class="sr" for="er">Motif</label><input type="text" id="er" maxlength="200" placeholder="motif (obligatoire)"><button type="button" class="btn" data-act="pts">Définir</button></div></div>' +
      '<h2 class="f">Historique des transactions' + (txPlayer != null ? ' · ' + esc(pname(txPlayer)) : '') + '</h2><div class="card sc"><table class="small"><tr><th>Date</th><th>Variation</th><th>Solde</th><th class="n">Motif</th></tr>' +
      tx.map(function (t) { return '<tr><td>' + new Date(t.created_at).toLocaleString('fr-FR') + '</td><td>' + (t.delta > 0 ? '+' : '') + t.delta + '</td><td>' + t.balance_after + '</td><td class="l">' + esc(t.reason) + (t.note ? ' — ' + esc(t.note) : '') + (txPlayer == null ? ' · ' + esc(pname(t.player_id)) : '') + '</td></tr>'; }).join('') + '</table></div>';
  }
  function viewPl() {
    return '<div class="card sc"><table class="small"><tr><th class="n">PSEUDO</th><th>STATUT</th><th>POINTS</th><th>EN JEU</th><th>APPAREIL</th><th></th></tr>' + A.players.map(function (p) {
      return '<tr><td class="n">' + esc(p.name) + '</td><td>' + esc(p.kind) + '</td><td>' + fmt(p.balance) + '</td><td>' + fmt(p.pending) + '</td><td>' + (p.claimed ? '🔒 réservé' : 'libre') + '</td><td>' + (p.claimed ? '<button type="button" class="btn g sm" data-act="reset" data-p="' + p.id + '">Réinitialiser</button>' : '') + '</td></tr>';
    }).join('') + '</table></div><p class="mu">« Réinitialiser » libère le pseudo : le prochain appareil qui le choisit le réserve.</p>';
  }
  function viewLog() {
    return '<div class="card sc"><table class="small"><tr><th>Date</th><th>IP</th><th class="n">Action</th><th>OK</th><th class="n">Détail</th></tr>' + logRows.map(function (l) {
      return '<tr><td>' + new Date(l.at).toLocaleString('fr-FR') + '</td><td>' + esc(l.ip) + '</td><td class="l">' + esc(l.action) + '</td><td>' + (l.success ? '✅' : '❌') + '</td><td class="l">' + esc(l.detail ? JSON.stringify(l.detail) : '') + '</td></tr>';
    }).join('') + '</table></div>';
  }
  function viewTools() {
    return '<div class="card"><b class="f">Date du 1er jour de la J4</b><div class="fld"><label class="sr" for="sd">Date</label><input type="date" id="sd" value="' + esc(A.start) + '"><button type="button" class="btn g" data-act="start">Enregistrer</button></div><p class="mu">Les paris ferment au coup d’envoi (heure GMT) calculé à partir de cette date.</p></div>' +
      '<div class="card"><b class="f">Sauvegarde</b><p class="mu">Fais un export avant chaque journée.</p><a class="btn g" href="/api/admin/export" download>⬇️ Exporter la base (JSON)</a></div>' +
      '<div class="card"><button type="button" class="btn dg" data-act="logout">Se déconnecter</button></div>';
  }
  var VIEWS = { res: viewRes, cal: viewCal, pts: viewPts, pl: viewPl, log: viewLog, tools: viewTools };
  function render() {
    $('#nav').innerHTML = TABS.map(function (t) { return '<button type="button" class="' + (tab === t[0] ? 'on' : '') + '" data-act="tab" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('');
    $('#view').innerHTML = VIEWS[tab]();
  }
  function loadTab() {
    var p = tab === 'log' ? api('GET', '/log').then(function (r) { logRows = r; })
      : tab === 'pts' ? api('GET', '/transactions' + (txPlayer != null ? '?player=' + txPlayer : '')).then(function (r) { tx = r; }) : Promise.resolve();
    return p.then(render).catch(function (e) { toast(e.message, 'err'); });
  }
  function act(p, okMsg) { return p.then(function (r) { toast(okMsg(r), 'good'); return refresh().then(loadTab); }).catch(function (e) { toast(e.message, 'err'); }); }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]'); if (!b) return;
    var a = b.getAttribute('data-act'), id = +b.getAttribute('data-m');
    if (a === 'tab') { tab = b.getAttribute('data-t'); confirmCancel = null; render(); loadTab(); }
    else if (a === 'save' || a === 'ff') {
      var m = A.matches.filter(function (z) { return z.id === id; })[0], body = { matchId: id }, ff = +b.getAttribute('data-ff');
      if (a === 'ff') body.forfeit = ff;
      else { var h = parseInt($('#ha' + id).value, 10), v = parseInt($('#aa' + id).value, 10); if (isNaN(h) || isNaN(v)) return toast('Entre les deux scores.', 'err'); body.home = h; body.away = v; }
      act(api(m.result ? 'PUT' : 'POST', '/results', body), function (r) { return 'Résultat enregistré' + (r.settled ? ' · ' + r.settled + ' pari(s) réglé(s)' : '') + (r.reversed ? ' (' + r.reversed + ' re-réglé(s))' : ''); });
    } else if (a === 'cancel') {
      if (confirmCancel !== id) { confirmCancel = id; render(); return; }
      confirmCancel = null; act(api('DELETE', '/results/' + id), function (r) { return 'Résultat annulé · ' + r.reversed + ' pari(s) remis en jeu'; });
    } else if (a === 'pts') {
      var pid = +$('#ep').value, nv = parseInt($('#ev').value, 10), why = $('#er').value.trim();
      if (isNaN(nv) || nv < 0) return toast('Entre un total valide.', 'err'); if (!why) return toast('Indique un motif.', 'err');
      txPlayer = pid; act(api('POST', '/points', { playerId: pid, newTotal: nv, reason: why }), function (r) { return 'Points mis à jour (' + (r.delta > 0 ? '+' : '') + r.delta + ')'; });
    } else if (a === 'reset') {
      act(api('POST', '/players/' + b.getAttribute('data-p') + '/reset'), function (r) { return r.player + ' est de nouveau libre.'; });
    } else if (a === 'start') {
      act(api('PUT', '/start', { start: $('#sd').value }), function () { return 'Date enregistrée.'; });
    } else if (a === 'logout') {
      api('POST', '/logout').then(function () { logged = false; A = null; renderLogin(); });
    }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'mdsel') { md = +ev.target.value; confirmCancel = null; render(); }
    else if (ev.target.id === 'ep') { txPlayer = +ev.target.value; loadTab(); }
  });

  api('GET', '/me').then(function () { return refresh(); }).catch(function () { renderLogin(); });
})();
