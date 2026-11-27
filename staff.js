/* Shared login for the HQ teacher pages. The PIN is checked by the Apps Script and kept only in this browser tab. */
var PIN = ''; try { PIN = sessionStorage.getItem('gma_hq_pin') || ''; } catch (e) {}
var ERR = {
  auth: 'Wrong password 密码错误', locked: 'Too many wrong tries. Wait 10 minutes. 错误太多次，请等 10 分钟。',
  disabled: 'Teacher password is not set in Apps Script yet. 还没在 Apps Script 设置老师密码。', no_api: 'API_URL is empty in config.js 尚未连接后台',
  booked: 'Some times already have bookings, so they cannot be reduced: 以下时段已有预约，不能减少：', full: 'This time is full. 这个时段已满。',
  busy: 'System busy, try again. 系统忙碌，请再试。', notfound: 'Booking not found. 找不到预约。'
};
function sapi(body, cb) { body.pin = PIN; api(body, cb); }
function errText(j) {
  if (!j) return 'Could not connect – nothing was saved. 无法连接，没有保存。';
  return (ERR[j.error] || ('Error: ' + (j.error || 'unknown'))) + (j.cells ? ' ' + j.cells.slice(0, 8).join('; ') : '');
}
function loginHtml(err) {
  return '<div class="card" style="max-width:420px;margin:30px auto"><h3>Teacher login 老师登入</h3><label class="f">Password 密码</label>' +
    '<input type="password" id="pin" autocomplete="current-password">' + (err ? '<div class="msg">' + esc(err) + '</div>' : '') +
    '<button class="btn pri" id="login" style="width:100%;margin-top:12px">Login 登入</button></div>';
}
function bindLogin(onOk) {
  function tryLogin() {
    var v = document.getElementById('pin').value.trim(); if (!v) return;
    PIN = v; sapi({ action: 'staff_check' }, function (j) {
      if (j && j.ok) { try { sessionStorage.setItem('gma_hq_pin', PIN); } catch (e) {} onOk(); }
      else { PIN = ''; document.getElementById('app').innerHTML = loginHtml(errText(j)); bindLogin(onOk); }
    });
  }
  var b = document.getElementById('login'); if (b) b.onclick = tryLogin;
  var i = document.getElementById('pin'); if (i) { i.focus(); i.onkeydown = function (e) { if (e.key === 'Enter') tryLogin(); }; }
}
function staffHeader(title) {
  return '<header class="top"><img class="brandlogo" src="' + esc(CFG.LOGO) + '" alt=""><div><div class="t1">' + esc(CFG.NAME) + '</div><div class="t2">' + esc(title) + '</div></div>' +
    '<div class="hlinks"><a href="teachers.html" title="Menu">☰</a></div></header>';
}
function fmtD(k) { var D = ['Sun 日', 'Mon 一', 'Tue 二', 'Wed 三', 'Thu 四', 'Fri 五', 'Sat 六'], p = k.split('-'); return D[weekday(k)] + ' ' + (+p[2]) + '/' + (+p[1]) + '/' + p[0]; }
