/* foqs. tracking - one row per pageview plus the time the page was really visible.
   No cookies, no IP stored, the visitor id is a random string in localStorage.
   Dashboard: https://foqs.si/admin
   To stop counting yourself on this device, run in the console:
   localStorage.setItem('foqs_notrack','1') */
(function () {
  var EP = 'https://cgnihdlprjqpawvpznsw.supabase.co/functions/v1/track';
  var host = location.hostname;
  if (host !== 'foqs.si' && host !== 'www.foqs.si') return;
  try { if (localStorage.getItem('foqs_notrack') === '1') return; } catch (e) {}

  function rid() {
    try { return crypto.randomUUID(); }
    catch (e) { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  }
  function keep(store, k) {
    try { var v = store.getItem(k); if (!v) { v = rid(); store.setItem(k, v); } return v; }
    catch (e) { return 'nostore-' + rid(); }
  }
  /* if the visitor is signed in to the foqs. hub, note who - nothing else personal */
  function who() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^sb-.+-auth-token$/.test(k)) {
          var j = JSON.parse(localStorage.getItem(k) || '{}');
          var u = (j && j.user) || (j && j.currentSession && j.currentSession.user) || null;
          if (u && u.email) return u.email;
        }
      }
    } catch (e) {}
    return null;
  }

  var visitor = keep(localStorage, 'foqs_vid');
  var session = keep(sessionStorage, 'foqs_sid');
  var rowId = null, sentMs = 0, visible = 0;
  var since = (document.visibilityState === 'visible') ? Date.now() : 0;

  function post(body, beacon) {
    var s = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(EP, new Blob([s], { type: 'text/plain;charset=UTF-8' }))) return; } catch (e) {}
    }
    try {
      fetch(EP, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: s, keepalive: !!beacon
      }).then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.id) rowId = d.id; })
        .catch(function () {});
    } catch (e) {}
  }

  post({
    t: 'view', p: location.pathname, r: document.referrer || null,
    v: visitor, s: session, l: navigator.language,
    w: (window.screen && screen.width) || null, e: who()
  }, false);

  function flush() {
    if (since) { visible += Date.now() - since; since = Date.now(); }
    if (!rowId || visible < 1000 || visible - sentMs < 2000) return;
    sentMs = visible;
    post({ t: 'end', id: rowId, v: visitor, ms: visible }, true);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (since) { visible += Date.now() - since; since = 0; }
      flush();
    } else if (!since) { since = Date.now(); }
  });
  addEventListener('pagehide', flush);
  setTimeout(flush, 30000);
  setInterval(flush, 60000);
})();
