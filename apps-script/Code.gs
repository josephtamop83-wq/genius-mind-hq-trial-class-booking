/**
 * Genius Mind HQ – Trial Class booking backend (Google Apps Script web app).
 *
 * Bound to its OWN Google Sheet (not shared with Puchong Jaya).
 * Customer data lives only in that Sheet. PINs live only in Script Properties:
 *   STAFF_PIN – teachers: open dates, bookings, attendance, settings
 *   VIEW_PIN  – optional read-only calendar password
 * Set them in Apps Script: Project Settings > Script Properties. Never in the pages.
 *
 * First time: run setup() once from the editor, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone).
 */

var TZ = 'Asia/Kuala_Lumpur';
var TZ_MS = 8 * 3600000;          // Malaysia is UTC+8 all year
var CLASS_MIN = 90;               // Trial Class = 1.5 hours
var MAX_CAP = 5;                  // max parents per time slot
var MAX_KIDS = 3;

var TABS = {
  Bookings: ['Timestamp', 'Ref', 'Status', 'Parent', 'Phone', 'Email', 'No. of children', 'Children', 'Date', 'Time', 'Booked by', 'Date changes', 'Attendance', 'Notes', 'Last updated'],
  Parents: ['Phone', 'Parent', 'Email', 'Created', 'Last updated'],
  Kids: ['Phone', 'Parent', 'Child', 'Gender', 'Age', 'Last updated'],
  Availability: ['Date', 'Time', 'Parents per slot', 'Last updated'],
  Spins: ['Timestamp', 'Ref', 'Phone', 'Parent', 'Children', 'Prize', 'Status', 'Expires', 'Used at', 'Code'],
  Prizes: ['Prize (EN)', 'Prize (中文)', 'Weight', 'Valid days', 'Active'],
  Settings: ['Key', 'Value', 'Notes'],
  Log: ['Timestamp', 'Who', 'Action', 'Ref', 'Details']
};

var DEFAULT_SETTINGS = [
  ['MAX_CHANGES', 2, 'How many times a parent may change the date of one booking'],
  ['LOCK_HOURS', 24, 'Parents cannot change the date within this many hours of the class'],
  ['CUTOFF_HOURS', 12, 'Booking closes this many hours before the class starts'],
  ['NOTIFY_EMAIL', '', 'Email(s) for new booking / change notices, comma separated'],
  ['SPIN_ENABLED', 'yes', 'yes / no'],
  ['AVAIL_SAVED', '', 'Filled automatically when teachers first save open dates']
];

// Demo prizes only – HQ must confirm the real list and weights (weight = relative chance).
var DEMO_PRIZES = [
  ['Free Gift', '精美礼物', 30, 30, 'yes'],
  ['RM50 Voucher', 'RM50 现金券', 10, 30, 'yes'],
  ['Stationery Set', '文具套装', 25, 30, 'yes'],
  ['Thank You', '谢谢参与', 35, 0, 'yes']
];

/* ------------------------------------------------------------------ setup */

function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    sh.getRange('A:Z').setNumberFormat('@');   // keep phones (60…) and dates as text
  });
  var st = ss.getSheetByName('Settings');
  var have = {}; st.getDataRange().getValues().slice(1).forEach(function (r) { have[r[0]] = 1; });
  DEFAULT_SETTINGS.forEach(function (r) { if (!have[r[0]]) st.appendRow([r[0], String(r[1]), r[2]]); });
  var pz = ss.getSheetByName('Prizes');
  if (pz.getLastRow() < 2) DEMO_PRIZES.forEach(function (r) { pz.appendRow(r.map(String)); });
  var s1 = ss.getSheetByName('Sheet1'); if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
}

/* ---------------------------------------------------------------- routing */

function doGet(e) {
  var a = (e && e.parameter && e.parameter.action) || '';
  if (a === 'booked') return out_(openSlots_());
  if (a === 'prizes') return out_(publicPrizes_());
  return out_({ ok: true, app: 'gma-hq' });
}

function doPost(e) {
  var b;
  try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { return out_({ ok: false, error: 'bad_json' }); }
  try { return out_(route_(b)); }
  catch (err) { log_('system', 'error', b.ref || '', String(err && err.stack || err)); return out_({ ok: false, error: 'server' }); }
}

function route_(b) {
  var a = b.action || 'book';
  var parent = { book: book_, lookup: lookup_, reschedule: reschedule_, spin: spin_ };
  if (parent[a]) return withLock_(function () { return parent[a](b); });
  var staff = {
    staff_check: function () { return { ok: true }; },
    staff_avail: staffAvail_, staff_avail_save: staffAvailSave_,
    cal_bookings: calBookings_, cal_mark: calMark_,
    staff_book: staffBook_, staff_reschedule: staffReschedule_, staff_cancel: staffCancel_,
    staff_redeem: staffRedeem_, staff_settings: staffSettings_, staff_settings_save: staffSettingsSave_
  };
  if (!staff[a]) return { ok: false, error: 'unknown' };
  var who = auth_(b.pin);
  if (!who.ok) return who;
  var viewOk = { staff_check: 1, cal_bookings: 1 };
  if (who.role !== 'staff' && !viewOk[a]) return { ok: false, error: 'auth' };
  b._role = who.role;
  return withLock_(function () { return staff[a](b); });
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------- auth */

function auth_(pin) {
  var props = PropertiesService.getScriptProperties();
  var staffPin = props.getProperty('STAFF_PIN') || '', viewPin = props.getProperty('VIEW_PIN') || '';
  if (!staffPin) return { ok: false, error: 'disabled' };
  var cache = CacheService.getScriptCache(), fails = +(cache.get('pinfail') || 0);
  if (fails >= 10) return { ok: false, error: 'locked' };
  pin = String(pin || '');
  if (pin && pin === staffPin) return { ok: true, role: 'staff' };
  if (pin && viewPin && pin === viewPin) return { ok: true, role: 'view' };
  cache.put('pinfail', String(fails + 1), 600);
  return { ok: false, error: 'auth' };
}

/* ---------------------------------------------------------------- helpers */

function sh_(n) { return SpreadsheetApp.getActive().getSheetByName(n); }
function rows_(n) {
  var s = sh_(n), v = s.getDataRange().getValues(), h = v[0], out = [];
  for (var i = 1; i < v.length; i++) { var o = { _row: i + 1 }; for (var j = 0; j < h.length; j++) o[h[j]] = v[i][j]; out.push(o); }
  return out;
}
function setCells_(n, row, obj) {
  var s = sh_(n), h = TABS[n];
  Object.keys(obj).forEach(function (k) { var c = h.indexOf(k); if (c >= 0) s.getRange(row, c + 1).setValue(obj[k] == null ? '' : String(obj[k])); });
}
function append_(n, obj) {
  sh_(n).appendRow(TABS[n].map(function (k) { return obj[k] == null ? '' : String(obj[k]); }));
}
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function dstr_(v) {   // cell → 'yyyy-MM-dd'
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var s = String(v || '').trim(), m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : s;
}
function tstr_(v) {   // cell → 'HH:mm'
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  var m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
function validDate_(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }
function validTime_(t) { var m = /^(\d{2}):(\d{2})$/.exec(t); return !!m && +m[1] < 24 && +m[2] < 60; }
function startMs_(d, t) {   // Malaysia wall time → epoch ms
  var p = d.split('-'), q = t.split(':');
  return Date.UTC(+p[0], +p[1] - 1, +p[2], +q[0], +q[1]) - TZ_MS;
}
function hoursUntil_(d, t) { return (startMs_(d, t) - Date.now()) / 3600000; }
function label_(t) {
  function f(m) { var h = Math.floor(m / 60) % 24, mm = m % 60, ap = h < 12 ? 'am' : 'pm'; return (h % 12 || 12) + ':' + ('0' + mm).slice(-2) + ap; }
  var q = t.split(':'), s = +q[0] * 60 + +q[1];
  return f(s) + '–' + f(s + CLASS_MIN);
}
function normPhone_(p) {
  var d = String(p || '').replace(/\D/g, '');
  if (d.indexOf('0') === 0) d = '6' + d;
  else if (d.indexOf('1') === 0) d = '60' + d;
  return /^601\d{8,9}$/.test(d) ? d : '';
}
function clean_(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n || 100); }
function setting_(k, def) {
  var r = rows_('Settings').filter(function (x) { return x.Key === k; })[0];
  return r && String(r.Value) !== '' ? String(r.Value) : def;
}
function num_(k, def) { var v = parseFloat(setting_(k, '')); return isNaN(v) ? def : v; }
function log_(who, action, ref, details) { try { append_('Log', { Timestamp: now_(), Who: who, Action: action, Ref: ref, Details: details }); } catch (x) {} }
function active_(b) { return b.Status !== 'Cancelled'; }

/* ------------------------------------------------------------ availability */

function capMap_() {   // 'date|time' → parents per slot
  var m = {};
  rows_('Availability').forEach(function (r) {
    var d = dstr_(r.Date), t = tstr_(r.Time), c = +r['Parents per slot'] || 0;
    if (validDate_(d) && validTime_(t)) m[d + '|' + t] = c;
  });
  return m;
}
function countMap_(exceptRef) {
  var m = {};
  rows_('Bookings').forEach(function (b) {
    if (!active_(b) || (exceptRef && b.Ref === exceptRef)) return;
    var k = dstr_(b.Date) + '|' + tstr_(b.Time); m[k] = (m[k] || 0) + 1;
  });
  return m;
}
function openSlots_() {
  if (!setting_('AVAIL_SAVED', '')) return { ok: true, ready: false, slots: [] };
  var cap = capMap_(), cnt = countMap_(), cut = num_('CUTOFF_HOURS', 12), out = [];
  Object.keys(cap).forEach(function (k) {
    var p = k.split('|');
    if (cap[k] <= 0 || hoursUntil_(p[0], p[1]) < cut) return;
    out.push({ d: p[0], t: p[1], label: label_(p[1]), left: Math.max(0, cap[k] - (cnt[k] || 0)) });
  });
  out.sort(function (a, b) { return (a.d + a.t) < (b.d + b.t) ? -1 : 1; });
  return { ok: true, ready: true, cutoffHours: cut, slots: out };
}
function slotCheck_(d, t, exceptRef, staff) {
  if (!validDate_(d) || !validTime_(t)) return 'bad_slot';
  var cap = capMap_()[d + '|' + t] || 0;
  if (!staff) {
    if (!setting_('AVAIL_SAVED', '') || cap <= 0) return 'closed';
    if (hoursUntil_(d, t) < num_('CUTOFF_HOURS', 12)) return 'toolate';
  }
  if (cap > 0 && (countMap_(exceptRef)[d + '|' + t] || 0) >= cap) return 'full';
  return '';
}

/* ---------------------------------------------------------------- parents */

function parentInfo_(phone) {
  var p = rows_('Parents').filter(function (r) { return String(r.Phone) === phone; })[0];
  var kids = rows_('Kids').filter(function (r) { return String(r.Phone) === phone; })
    .map(function (r) { return { name: String(r.Child), gender: String(r.Gender), age: +r.Age || '' }; });
  return { parent: p ? String(p.Parent) : '', email: p ? String(p.Email) : '', kids: kids };
}
function bookingsOf_(phone) {
  var lim = num_('MAX_CHANGES', 2), lock = num_('LOCK_HOURS', 24);
  var spins = rows_('Spins');
  return rows_('Bookings').filter(function (b) { return String(b.Phone) === phone && active_(b); }).map(function (b) {
    var d = dstr_(b.Date), t = tstr_(b.Time), used = +b['Date changes'] || 0, sp = spins.filter(function (s) { return s.Ref === b.Ref; })[0];
    return {
      ref: b.Ref, status: b.Status, date: d, time: t, label: label_(t), kids: +b['No. of children'] || 0,
      changes: used, maxChanges: lim, lockHours: lock,
      canChange: used < lim && hoursUntil_(d, t) >= lock, past: hoursUntil_(d, t) < 0,
      spin: sp ? spinOut_(sp) : null
    };
  });
}
function lookup_(b) {
  var phone = normPhone_(b.phone);
  if (!phone) return { ok: false, error: 'phone' };
  var info = parentInfo_(phone);
  // Anyone can type a phone number, so only a masked name is returned (PDPA) – no children's details.
  return { ok: true, found: !!info.parent, parent: mask_(info.parent), kidsComplete: !!cleanKids_(info.kids), bookings: bookingsOf_(phone), spinEnabled: setting_('SPIN_ENABLED', 'yes') === 'yes' };
}
function mask_(name) {
  return String(name || '').split(/\s+/).filter(String).map(function (w) { return w.charAt(0) + (w.length > 1 ? '***' : ''); }).join(' ');
}
function cleanKids_(list) {
  var kids = (list || []).slice(0, MAX_KIDS).map(function (c) {
    return { name: clean_(c.name, 60), gender: c.gender === 'M' || c.gender === 'F' ? c.gender : '', age: Math.round(+c.age) || 0 };
  });
  if (!kids.length || kids.some(function (c) { return !c.name || !c.gender || c.age < 3 || c.age > 15; })) return null;
  return kids;
}
function saveParent_(phone, parent, email, kids) {
  var p = rows_('Parents').filter(function (r) { return String(r.Phone) === phone; })[0];
  if (p) setCells_('Parents', p._row, { Parent: parent, Email: email, 'Last updated': now_() });
  else append_('Parents', { Phone: phone, Parent: parent, Email: email, Created: now_(), 'Last updated': now_() });
  var s = sh_('Kids'), old = rows_('Kids').filter(function (r) { return String(r.Phone) === phone; });
  for (var i = old.length - 1; i >= 0; i--) s.deleteRow(old[i]._row);   // replace this parent's kids list (data stays in the new rows)
  kids.forEach(function (c) { append_('Kids', { Phone: phone, Parent: parent, Child: c.name, Gender: c.gender, Age: c.age, 'Last updated': now_() }); });
}
function kidsText_(kids) { return kids.map(function (c) { return c.name + ' (' + c.gender + ', ' + c.age + ')'; }).join('; '); }
function newRef_(d) {
  var pre = 'HQ' + d.replace(/-/g, '').slice(2) + '-', n = 0;
  rows_('Bookings').forEach(function (b) { var r = String(b.Ref); if (r.indexOf(pre) === 0) n = Math.max(n, +r.slice(pre.length) || 0); });
  return pre + ('00' + (n + 1)).slice(-3);
}
function createBooking_(b, by, staff) {
  var phone = normPhone_(b.phone), parent = clean_(b.parent, 80), email = clean_(b.email, 100), kids = cleanKids_(b.kids);
  var d = dstr_(b.date), t = tstr_(b.time);
  if (!phone) return { ok: false, error: 'phone' };
  if (!parent) return { ok: false, error: 'parent' };
  if (!kids) return { ok: false, error: 'kids' };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'email' };
  if (!staff && bookingsOf_(phone).some(function (x) { return !x.past; })) return { ok: false, error: 'exists', bookings: bookingsOf_(phone) };
  var err = slotCheck_(d, t, '', staff);
  if (err && !(staff && err === 'full' && b.force)) return { ok: false, error: err };
  saveParent_(phone, parent, email, kids);
  var ref = newRef_(d);
  append_('Bookings', {
    Timestamp: now_(), Ref: ref, Status: 'Booked', Parent: parent, Phone: phone, Email: email,
    'No. of children': kids.length, Children: kidsText_(kids), Date: d, Time: t, 'Booked by': by,
    'Date changes': 0, Notes: clean_(b.notes, 300), 'Last updated': now_()
  });
  log_(by, 'book', ref, d + ' ' + t);
  notify_('New Trial Class booking ' + ref, [
    'Ref: ' + ref, 'Date: ' + d + ' ' + label_(t), 'Parent: ' + parent, 'Phone: +' + phone,
    'Children: ' + kidsText_(kids), 'Booked by: ' + by
  ]);
  return { ok: true, ref: ref, date: d, time: t, label: label_(t), bookings: bookingsOf_(phone) };
}
function book_(b) { return createBooking_(b, 'parent', false); }

function findBooking_(ref) { return rows_('Bookings').filter(function (r) { return r.Ref === String(ref || ''); })[0]; }
function moveBooking_(bk, d, t, by, count) {
  var old = dstr_(bk.Date) + ' ' + tstr_(bk.Time);
  var upd = { Date: d, Time: t, 'Last updated': now_() };
  if (count) upd['Date changes'] = (+bk['Date changes'] || 0) + 1;
  setCells_('Bookings', bk._row, upd);
  log_(by, 'reschedule', bk.Ref, old + ' → ' + d + ' ' + t);
  notify_('Trial Class date changed ' + bk.Ref, [
    'Ref: ' + bk.Ref, 'From: ' + old, 'To: ' + d + ' ' + label_(t), 'Parent: ' + bk.Parent, 'Phone: +' + bk.Phone, 'Changed by: ' + by
  ]);
}
function reschedule_(b) {
  var phone = normPhone_(b.phone), bk = findBooking_(b.ref);
  if (!bk || String(bk.Phone) !== phone || !active_(bk)) return { ok: false, error: 'notfound' };
  var lim = num_('MAX_CHANGES', 2), used = +bk['Date changes'] || 0;
  if (used >= lim) return { ok: false, error: 'limit' };
  if (hoursUntil_(dstr_(bk.Date), tstr_(bk.Time)) < num_('LOCK_HOURS', 24)) return { ok: false, error: 'locked_change' };
  var d = dstr_(b.date), t = tstr_(b.time), err = slotCheck_(d, t, bk.Ref, false);
  if (err) return { ok: false, error: err };
  moveBooking_(bk, d, t, 'parent', true);
  return { ok: true, ref: bk.Ref, date: d, time: t, label: label_(t), bookings: bookingsOf_(phone) };
}

/* ------------------------------------------------------------ spin & win */

function prizeList_() {
  return rows_('Prizes').filter(function (r) { return String(r.Active).toLowerCase() !== 'no' && String(r['Prize (EN)']); }).map(function (r) {
    return { en: String(r['Prize (EN)']), zh: String(r['Prize (中文)'] || r['Prize (EN)']), w: Math.max(0, +r.Weight || 0), days: +r['Valid days'] || 0 };
  });
}
function publicPrizes_() {   // names only – weights stay on the server
  return { ok: true, enabled: setting_('SPIN_ENABLED', 'yes') === 'yes', prizes: prizeList_().map(function (p) { return { en: p.en, zh: p.zh }; }) };
}
function spinOut_(s) {
  var st = String(s.Status), exp = dstr_(s.Expires);
  if (st === 'Won' && exp && exp < today_()) st = 'Expired';
  var zh = prizeList_().filter(function (p) { return p.en === String(s.Prize); })[0];
  return { prize: String(s.Prize), prizeZh: zh ? zh.zh : String(s.Prize), status: st, expires: exp, code: String(s.Code), at: String(s.Timestamp) };
}
function spin_(b) {
  if (setting_('SPIN_ENABLED', 'yes') !== 'yes') return { ok: false, error: 'spin_off' };
  var phone = normPhone_(b.phone), bk = findBooking_(b.ref);
  if (!bk || String(bk.Phone) !== phone || !active_(bk)) return { ok: false, error: 'notfound' };
  var kids = parentInfo_(phone).kids;
  if (!cleanKids_(kids)) return { ok: false, error: 'kids' };   // children's details must be complete first
  var done = rows_('Spins').filter(function (s) { return s.Ref === bk.Ref; })[0];
  if (done) return { ok: true, already: true, spin: spinOut_(done), index: indexOf_(String(done.Prize)) };
  var list = prizeList_(), total = list.reduce(function (a, p) { return a + p.w; }, 0);
  if (!list.length || total <= 0) return { ok: false, error: 'no_prizes' };
  var r = Math.random() * total, i = 0;
  for (; i < list.length - 1; i++) { r -= list[i].w; if (r < 0) break; }
  var p = list[i], exp = '';
  if (p.days > 0) exp = Utilities.formatDate(new Date(Date.now() + p.days * 86400000), TZ, 'yyyy-MM-dd');
  var code = p.days > 0 ? 'P' + Math.random().toString(36).slice(2, 8).toUpperCase() : '';
  var row = { Timestamp: now_(), Ref: bk.Ref, Phone: phone, Parent: bk.Parent, Children: bk.Children, Prize: p.en, Status: p.days > 0 ? 'Won' : 'No prize', Expires: exp, Code: code };
  append_('Spins', row);
  log_('parent', 'spin', bk.Ref, p.en);
  return { ok: true, index: i, spin: spinOut_(row) };
}
function indexOf_(name) { var l = prizeList_(); for (var i = 0; i < l.length; i++) if (l[i].en === name) return i; return -1; }

/* ---------------------------------------------------------------- teachers */

function staffAvail_(b) {
  var cap = capMap_(), cnt = countMap_(), out = [];
  Object.keys(cap).forEach(function (k) { var p = k.split('|'); out.push({ d: p[0], t: p[1], cap: cap[k], booked: cnt[k] || 0 }); });
  Object.keys(cnt).forEach(function (k) { if (!(k in cap)) { var p = k.split('|'); out.push({ d: p[0], t: p[1], cap: 0, booked: cnt[k] }); } });
  return { ok: true, saved: !!setting_('AVAIL_SAVED', ''), slots: out, times: setting_('SLOT_TIMES', '10:00,14:00,16:00').split(',').map(tstr_).filter(validTime_) };
}
function staffAvailSave_(b) {
  var changes = b.changes || [], cnt = countMap_(), bad = [];
  changes.forEach(function (c) {
    var d = dstr_(c.d), t = tstr_(c.t), n = Math.max(0, Math.min(MAX_CAP, Math.round(+c.cap) || 0));
    if (!validDate_(d) || !validTime_(t)) return;
    if (n < (cnt[d + '|' + t] || 0)) bad.push(d + ' ' + label_(t));
    c._d = d; c._t = t; c._n = n;
  });
  if (bad.length) return { ok: false, error: 'booked', cells: bad };
  var s = sh_('Availability'), idx = {};
  rows_('Availability').forEach(function (r) { idx[dstr_(r.Date) + '|' + tstr_(r.Time)] = r._row; });
  changes.forEach(function (c) {
    if (!c._d) return;
    var k = c._d + '|' + c._t;
    if (idx[k]) setCells_('Availability', idx[k], { 'Parents per slot': c._n, 'Last updated': now_() });
    else { append_('Availability', { Date: c._d, Time: c._t, 'Parents per slot': c._n, 'Last updated': now_() }); idx[k] = s.getLastRow(); }
  });
  if (Array.isArray(b.times)) setSetting_('SLOT_TIMES', b.times.map(tstr_).filter(validTime_).join(','));
  if (!setting_('AVAIL_SAVED', '')) setSetting_('AVAIL_SAVED', now_());
  log_('teacher', 'avail_save', '', changes.length + ' cells');
  return staffAvail_(b);
}
function setSetting_(k, v) {
  var r = rows_('Settings').filter(function (x) { return x.Key === k; })[0];
  if (r) setCells_('Settings', r._row, { Value: v }); else append_('Settings', { Key: k, Value: v });
}
function calBookings_(b) {
  var from = dstr_(b.from) || '0000', to = dstr_(b.to) || '9999', spins = {};
  rows_('Spins').forEach(function (s) { spins[s.Ref] = spinOut_(s); });
  var list = rows_('Bookings').filter(function (r) { var d = dstr_(r.Date); return d >= from && d <= to; }).map(function (r) {
    var t = tstr_(r.Time);
    return {
      ref: r.Ref, status: r.Status, parent: String(r.Parent), phone: String(r.Phone), email: String(r.Email),
      kids: String(r.Children), n: +r['No. of children'] || 0, date: dstr_(r.Date), time: t, label: label_(t),
      by: String(r['Booked by']), changes: +r['Date changes'] || 0, attendance: String(r.Attendance), notes: String(r.Notes),
      spin: spins[r.Ref] || null
    };
  });
  list.sort(function (a, c) { return (a.date + a.time) < (c.date + c.time) ? -1 : 1; });
  return { ok: true, canEdit: b._role === 'staff', bookings: list };
}
function calMark_(b) {
  var bk = findBooking_(b.ref); if (!bk) return { ok: false, error: 'notfound' };
  var v = { attended: 'Attended', noshow: 'No show', '': '' }[b.value || ''];
  if (v === undefined) return { ok: false, error: 'bad' };
  setCells_('Bookings', bk._row, { Attendance: v, 'Last updated': now_() });
  log_('teacher', 'mark', bk.Ref, v);
  return { ok: true };
}
function staffBook_(b) { return createBooking_(b, 'teacher', true); }
function staffReschedule_(b) {
  var bk = findBooking_(b.ref); if (!bk || !active_(bk)) return { ok: false, error: 'notfound' };
  var d = dstr_(b.date), t = tstr_(b.time), err = slotCheck_(d, t, bk.Ref, true);
  if (err && !(err === 'full' && b.force)) return { ok: false, error: err };
  moveBooking_(bk, d, t, 'teacher', false);
  return { ok: true };
}
function staffCancel_(b) {   // marks Cancelled – the row is kept, nothing is deleted
  var bk = findBooking_(b.ref); if (!bk) return { ok: false, error: 'notfound' };
  setCells_('Bookings', bk._row, { Status: b.undo ? 'Booked' : 'Cancelled', 'Last updated': now_() });
  log_('teacher', b.undo ? 'uncancel' : 'cancel', bk.Ref, '');
  if (!b.undo) notify_('Trial Class cancelled ' + bk.Ref, ['Ref: ' + bk.Ref, 'Date: ' + dstr_(bk.Date) + ' ' + label_(tstr_(bk.Time)), 'Parent: ' + bk.Parent, 'Phone: +' + bk.Phone]);
  return { ok: true };
}
function staffRedeem_(b) {
  var s = rows_('Spins').filter(function (x) { return x.Ref === String(b.ref || ''); })[0];
  if (!s) return { ok: false, error: 'notfound' };
  var cur = spinOut_(s);
  if (!b.undo && cur.status !== 'Won') return { ok: false, error: 'status_' + cur.status };
  setCells_('Spins', s._row, b.undo ? { Status: 'Won', 'Used at': '' } : { Status: 'Used', 'Used at': now_() });
  log_('teacher', b.undo ? 'unredeem' : 'redeem', s.Ref, String(s.Prize));
  return { ok: true };
}
var EDITABLE = ['MAX_CHANGES', 'LOCK_HOURS', 'CUTOFF_HOURS', 'NOTIFY_EMAIL', 'SPIN_ENABLED'];
function staffSettings_() {
  var o = {}; EDITABLE.forEach(function (k) { o[k] = setting_(k, ''); });
  return { ok: true, settings: o, prizes: prizeList_() };
}
function staffSettingsSave_(b) {
  var s = b.settings || {};
  EDITABLE.forEach(function (k) {
    if (!(k in s)) return;
    var v = clean_(s[k], 300);
    if (/^(MAX_CHANGES|LOCK_HOURS|CUTOFF_HOURS)$/.test(k) && !(v !== '' && +v >= 0 && +v <= 720)) return;
    if (k === 'SPIN_ENABLED' && v !== 'yes' && v !== 'no') return;
    setSetting_(k, v);
  });
  log_('teacher', 'settings', '', JSON.stringify(s).slice(0, 300));
  return staffSettings_();
}

/* ------------------------------------------------------------ notification */

function notify_(subject, lines) {
  var to = setting_('NOTIFY_EMAIL', '');
  if (!to) return;
  try { MailApp.sendEmail(to, '[Genius Mind HQ] ' + subject, lines.join('\n')); } catch (x) { log_('system', 'mail_fail', '', String(x)); }
}
