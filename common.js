/* Shared helpers for the HQ pages. */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function normPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (d.charAt(0) === '0') d = '6' + d; else if (d.charAt(0) === '1') d = '60' + d; return /^601\d{8,9}$/.test(d) ? d : ''; }
function showPhone(p) { p = String(p || ''); return p ? '+' + p.slice(0, 2) + ' ' + p.slice(2, 4) + '-' + p.slice(4) : ''; }
function api(body, cb) {
  if (!CFG.API_URL) { cb({ ok: false, error: 'no_api' }); return; }
  var ac = window.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ac) ac.abort(); }, 30000);
  fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body), signal: ac ? ac.signal : undefined })
    .then(function (r) { return r.json(); }).then(function (j) { clearTimeout(to); cb(j); })
    .catch(function () { clearTimeout(to); cb(null); });
}
function apiGet(action, cb) {
  if (!CFG.API_URL) { cb({ ok: false, error: 'no_api' }); return; }
  fetch(CFG.API_URL + '?action=' + action + '&t=' + Date.now()).then(function (r) { return r.json(); }).then(cb).catch(function () { cb(null); });
}
function myToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function addDays(k, n) { var p = k.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10); }
function weekday(k) { var p = k.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); }
function slotLabel(t) {
  function f(m) { var h = Math.floor(m / 60) % 24, mm = m % 60; return (h % 12 || 12) + ':' + ('0' + mm).slice(-2) + (h < 12 ? 'am' : 'pm'); }
  var q = t.split(':'), s = +q[0] * 60 + +q[1]; return f(s) + '–' + f(s + 90);
}
function waLink(text) { return CFG.WHATSAPP ? 'https://wa.me/' + CFG.WHATSAPP + (text ? '?text=' + encodeURIComponent(text) : '') : ''; }
function headerHtml(sub) {
  return '<header class="top"><img class="brandlogo" src="' + esc(CFG.LOGO) + '" alt=""><div><div class="t1">' + esc(CFG.NAME) + '</div><div class="t2">' + esc(sub || '') + '</div></div>' +
    '<div class="lang"><button data-lang="en">EN</button><button data-lang="zh">中文</button></div></header>';
}
