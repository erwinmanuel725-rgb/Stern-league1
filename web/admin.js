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
  var fdate = function (iso) {
    if (!iso) return '';
    var parts = String(iso).split('T')[0].split('-');
    if (parts.length === 3) {
      var d = ('0' + parseInt(parts[2], 10)).slice(-2);
      var m = ('0' + parseInt(parts[1], 10)).slice(-2);
      return d + '/' + m + '/' + parts[0];
    }
    var dt = new Date(iso);
    var d = ('0' + dt.getUTCDate()).slice(-2);
    var m = ('0' + (dt.getUTCMonth() + 1)).slice(-2);
    return d + '/' + m + '/' + dt.getUTCFullYear();
  };
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var ftime = function (h, min) { return pad2(h) + 'h' + (min ? pad2(min) : '00'); };
  var timeInputVal = function (h, min) { return pad2(h) + ':' + pad2(min || 0); };
  var parseTimeInput = function (v) {
    var p = (v || '18:00').split(':');
    return { hour: parseInt(p[0], 10) || 0, minute: parseInt(p[1], 10) || 0 };
  };
  function getModsList() {
    var list = ['Apolo'];
    if (A && A.players) {
      A.players.forEach(function (p) {
        if (p.kind === 'mod' && list.indexOf(p.name) === -1) list.push(p.name);
      });
    }
    return list;
  }
  function modOptions(currentRef) {
    var mods = getModsList();
    if (currentRef && mods.indexOf(currentRef) === -1) mods.push(currentRef);
    return mods.map(function (name) {
      return '<option value="' + esc(name) + '"' + (name === currentRef ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('');
  }

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
  var TABS = [['res', '⚽ Résultats'], ['sched', '🕒 Horaires'], ['cal', '📅 Calendrier'], ['pts', '💰 Points'], ['pl', '👥 Joueurs'], ['log', '📜 Journal'], ['tools', '🛠️ Outils']];
  function mdOptions() { var o = ''; for (var j = 4; j <= 34; j++) o += '<option value="' + j + '"' + (j === md ? ' selected' : '') + '>Journée ' + j + (j === A.cur ? ' (en cours)' : '') + '</option>'; return o; }
  function viewRes() {
    var ms = A.matches.filter(function (m) { return m.j === md; });
    return '<div class="fld"><label class="mu" for="mdsel">Journée :</label><select id="mdsel">' + mdOptions() + '</select></div>' + ms.map(function (m) {
      var r = m.result, sc = r ? (r.ff ? (r.ff === 1 ? 'F' : 'V') + ' – ' + (r.ff === 2 ? 'F' : 'V') : r.h + ' – ' + r.a) : null;
      return '<div class="card"><div class="m"><span class="mu">' + fdate(m.date) + ' · ' + ftime(m.hour, m.minute) + ' GMT · 🛡️ ' + esc(m.referee) + '</span><span class="mu">' + m.bets + ' pari(s) · ' + fmt(m.staked) + ' pts</span></div>' +
        '<div class="m crow"><span class="t r">' + esc(pname(m.h)) + '</span><b class="sc2">' + (sc || 'vs') + '</b><span class="t">' + esc(pname(m.a)) + '</span></div>' +
        '<div class="fld"><label class="sr" for="ha' + m.id + '">Buts ' + esc(pname(m.h)) + '</label><input class="w2" type="number" min="0" max="99" id="ha' + m.id + '" value="' + (r && !r.ff ? r.h : '') + '"> – ' +
        '<label class="sr" for="aa' + m.id + '">Buts ' + esc(pname(m.a)) + '</label><input class="w2" type="number" min="0" max="99" id="aa' + m.id + '" value="' + (r && !r.ff ? r.a : '') + '">' +
        '<button type="button" class="btn g sm" data-act="save" data-m="' + m.id + '">' + (r ? 'Corriger' : 'Valider') + '</button>' +
        '<button type="button" class="btn g sm" data-act="ff" data-m="' + m.id + '" data-ff="1">🚩 Forfait gauche</button><button type="button" class="btn g sm" data-act="ff" data-m="' + m.id + '" data-ff="2">🚩 Forfait droite</button>' +
        (r ? '<button type="button" class="btn dg sm" data-act="cancel" data-m="' + m.id + '">' + (confirmCancel === m.id ? 'Confirmer l’annulation' : 'Annuler le résultat') + '</button>' : '') + '</div>' +
        '<div class="fld sched-inline"><span class="mu">📅 Horaire :</span>' +
        '<input type="date" id="rd_' + m.id + '" value="' + esc(m.date) + '">' +
        '<input type="time" id="rt_' + m.id + '" value="' + timeInputVal(m.hour, m.minute) + '">' +
        '<label class="mu" for="rr_' + m.id + '">🛡️ Modo :</label><select id="rr_' + m.id + '">' + modOptions(m.referee) + '</select>' +
        '<button type="button" class="btn sm" data-act="res-sched" data-m="' + m.id + '">💾 Modifier</button></div>' +
        '</div>';
    }).join('');
  }
  function viewSched() {
    var ms = A.matches.filter(function (m) { return m.j === md; });
    return '<div class="fld"><label class="mu" for="mdsel">Journée :</label><select id="mdsel">' + mdOptions() + '</select></div>' +
      '<div class="card"><b class="f">Programmation groupée · Journée ' + md + '</b>' +
      '<p class="mu">Modifie la date, l’heure et le modérateur/arbitre de chaque match, ou applique une modification commune.</p>' +
      '<div class="fld" style="gap:8px;flex-wrap:wrap;align-items:center;">' +
      '<label class="mu" for="bulk_date">Date commune :</label><input type="date" id="bulk_date">' +
      '<button type="button" class="btn g sm" data-act="sched-apply-date">Appliquer date à tous</button>' +
      '<button type="button" class="btn g sm" data-act="sched-shift-day" data-days="1">+1 jour</button>' +
      '<button type="button" class="btn g sm" data-act="sched-shift-day" data-days="2">+2 jours</button>' +
      '<label class="mu" for="bulk_mod">🛡️ Modo commun :</label><select id="bulk_mod"><option value="">— choisir —</option>' + modOptions('') + '</select>' +
      '<button type="button" class="btn g sm" data-act="sched-apply-mod">Appliquer ce modo à tous</button>' +
      '<button type="button" class="btn sm" data-act="sched-save-all">💾 Enregistrer tous les matchs</button>' +
      '</div></div>' +
      ms.map(function (m) {
        var r = m.result;
        var statusBadge = r ? '<b class="ok">✅ Terminé (' + (r.ff ? 'Forfait' : r.h + '-' + r.a) + ')</b>' : '<b class="bl">⏳ À venir</b>';
        return '<div class="card" id="scard_' + m.id + '">' +
          '<div class="m"><span class="mu">Match #' + m.id + ' · 🛡️ ' + esc(m.referee) + '</span>' + statusBadge + '</div>' +
          '<div class="m crow"><span class="t r">' + esc(pname(m.h)) + '</span><b class="sc2">vs</b><span class="t">' + esc(pname(m.a)) + '</span></div>' +
          '<div class="fld sched-row">' +
          '<label class="mu" for="sd_' + m.id + '">Date :</label><input type="date" id="sd_' + m.id + '" value="' + esc(m.date) + '">' +
          '<label class="mu" for="st_' + m.id + '">Heure GMT :</label><input type="time" id="st_' + m.id + '" value="' + timeInputVal(m.hour, m.minute) + '">' +
          '<label class="mu" for="sr_' + m.id + '">🛡️ Modo :</label><select id="sr_' + m.id + '">' + modOptions(m.referee) + '</select>' +
          '<button type="button" class="btn g sm" data-act="sched-save-one" data-m="' + m.id + '">💾 Enregistrer</button>' +
          '</div></div>';
      }).join('');
  }
  function viewCal() {
    var s = '<p class="mu">Calendrier complet (visible uniquement ici). Les joueurs ne voient que la journée en cours.</p>';
    for (var j = 4; j <= 34; j++) {
      s += '<div class="card"><b class="f">Journée ' + j + (j === A.cur ? ' · en cours' : j < A.cur ? ' · publiée' : ' · à venir') + '</b>' + A.matches.filter(function (m) { return m.j === j; }).map(function (m) {
        return '<div class="m crow"><span class="mu">' + fdate(m.date) + ' · ' + ftime(m.hour, m.minute) + ' GMT</span><span class="t r">' + esc(pname(m.h)) + '</span><b>' + (m.result ? m.result.h + ' – ' + m.result.a : 'vs') + '</b><span class="t">' + esc(pname(m.a)) + '</span><span class="mu">🛡️ ' + esc(m.referee) + '</span></div>';
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
  var VIEWS = { res: viewRes, sched: viewSched, cal: viewCal, pts: viewPts, pl: viewPl, log: viewLog, tools: viewTools };
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
    } else if (a === 'res-sched') {
      var rdt = $('#rd_' + id).value, rtm = parseTimeInput($('#rt_' + id).value), rref = ($('#rr_' + id) || {}).value;
      if (!rdt) return toast('Choisis une date valide.', 'err');
      act(api('PUT', '/matches/' + id + '/schedule', { date: rdt, hour: rtm.hour, minute: rtm.minute, referee: rref }), function () {
        return 'Match #' + id + ' mis à jour (' + rdt + ' à ' + ftime(rtm.hour, rtm.minute) + (rref ? ' · 🛡️ ' + rref : '') + ')';
      });
    } else if (a === 'sched-save-one') {
      var sdt = $('#sd_' + id).value, stm = parseTimeInput($('#st_' + id).value), sref = ($('#sr_' + id) || {}).value;
      if (!sdt) return toast('Choisis une date valide.', 'err');
      act(api('PUT', '/matches/' + id + '/schedule', { date: sdt, hour: stm.hour, minute: stm.minute, referee: sref }), function () {
        return 'Match #' + id + ' mis à jour (' + sdt + ' à ' + ftime(stm.hour, stm.minute) + (sref ? ' · 🛡️ ' + sref : '') + ')';
      });
    } else if (a === 'sched-apply-date') {
      var bd = $('#bulk_date').value;
      if (!bd) return toast('Choisis d’abord une date dans le champ « Date commune ».', 'err');
      var bms = A.matches.filter(function (z) { return z.j === md; });
      bms.forEach(function (z) { var el = $('#sd_' + z.id); if (el) el.value = bd; });
      toast('Date ' + bd + ' appliquée. Clique sur « Enregistrer tous les matchs » pour sauvegarder.', 'good');
    } else if (a === 'sched-apply-mod') {
      var bm = $('#bulk_mod').value;
      if (!bm) return toast('Choisis d’abord un modérateur dans la liste.', 'err');
      var mms = A.matches.filter(function (z) { return z.j === md; });
      mms.forEach(function (z) { var el = $('#sr_' + z.id); if (el) el.value = bm; });
      toast('Modo ' + bm + ' appliqué aux champs. Clique sur « Enregistrer tous les matchs » pour sauvegarder.', 'good');
    } else if (a === 'sched-shift-day') {
      var days = parseInt(b.getAttribute('data-days'), 10) || 1;
      var dms = A.matches.filter(function (z) { return z.j === md; });
      dms.forEach(function (z) {
        var el = $('#sd_' + z.id);
        if (el && el.value) {
          var curD = new Date(el.value + 'T00:00:00Z');
          curD.setUTCDate(curD.getUTCDate() + days);
          el.value = curD.toISOString().slice(0, 10);
        }
      });
      toast('Dates décalées de +' + days + ' jour(s). Clique sur « Enregistrer tous les matchs » pour sauvegarder.', 'good');
    } else if (a === 'sched-save-all') {
      var ams = A.matches.filter(function (z) { return z.j === md; });
      var list = [];
      for (var i = 0; i < ams.length; i++) {
        var mid = ams[i].id;
        var dt = $('#sd_' + mid).value;
        var tm = parseTimeInput($('#st_' + mid).value);
        var rf = ($('#sr_' + mid) || {}).value;
        if (!dt) return toast('Date manquante pour le match #' + mid, 'err');
        list.push({ matchId: mid, date: dt, hour: tm.hour, minute: tm.minute, referee: rf });
      }
      act(api('PUT', '/schedule', { matches: list }), function () {
        return 'Tous les horaires et modérateurs de la Journée ' + md + ' ont été enregistrés !';
      });
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
