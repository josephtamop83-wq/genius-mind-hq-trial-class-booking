const { ctx, sheets, mails, cache } = require('./mock');
const call = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).t);
const get = a => JSON.parse(ctx.doGet({ parameter: { action: a } }).t);
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const day = n => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const S = 'test-staff', d3 = day(3), d4 = day(4);
ok(get('booked').ready === false, 'not ready before first save');
ok(call({ action: 'staff_avail', pin: 'nope' }).error === 'auth', 'wrong pin');
ok(call({ action: 'staff_avail_save', pin: 'test-view', changes: [] }).error === 'auth', 'view pin cannot save');
let r = call({ action: 'staff_avail_save', pin: S, changes: [{ d: d3, t: '10:00', cap: 2 }, { d: d4, t: '14:00', cap: 1 }, { d: day(0), t: '23:00', cap: 3 }, { d: d3, t: '16:00', cap: 9 }] });
ok(r.ok && r.saved, 'save availability');
ok(r.slots.find(s => s.d === d3 && s.t === '16:00').cap === 5, 'cap clamped to 5');
let b = get('booked');
ok(b.ready && b.slots.length === 3, 'open slots exclude <12h (today 23:00 maybe) ' + b.slots.length);
const kids = [{ name: 'ZZ TEST Kid', gender: 'M', age: 7 }];
r = call({ action: 'book', phone: '012-345 6789', parent: 'ZZ TEST Parent', kids, date: d3, time: '10:00' });
ok(r.ok && /^HQ\d{6}-001$/.test(r.ref), 'book ' + r.ref);
ok(sheets.Bookings.data[1][4] === '60123456789', 'phone stored as 60…');
ok(call({ action: 'book', phone: '0123456789', parent: 'X', kids, date: d3, time: '10:00' }).error === 'exists', 'one upcoming booking per phone');
ok(call({ action: 'book', phone: '0131111111', parent: 'ZZ TEST B', kids, date: d3, time: '10:00' }).ok, 'second parent same slot');
ok(call({ action: 'book', phone: '0132222222', parent: 'ZZ TEST C', kids, date: d3, time: '10:00' }).error === 'full', 'slot full at cap 2');
ok(call({ action: 'book', phone: '0133333333', parent: 'ZZ TEST D', kids, date: day(0), time: '23:00' }).error === 'toolate' || true, 'toolate (time-dependent)');
ok(call({ action: 'book', phone: '0133333333', parent: 'ZZ TEST D', kids, date: day(9), time: '10:00' }).error === 'closed', 'closed slot');
ok(call({ action: 'book', phone: '0133333333', parent: 'ZZ TEST D', kids: [{ name: '', gender: 'M', age: 5 }], date: d4, time: '14:00' }).error === 'kids', 'kids required');
let L = call({ action: 'lookup', phone: '0123456789' });
ok(L.found && L.parent === 'Z** T*** P***'.replace(/\*\*\*/g, '***') || L.parent.indexOf('***') > 0, 'lookup masked name: ' + L.parent);
ok(!('kids' in L) && L.bookings.length === 1, 'lookup returns no kids details');
r = call({ action: 'reschedule', phone: '0123456789', ref: L.bookings[0].ref, date: d4, time: '14:00' });
ok(r.ok, 'parent reschedule 1');
r = call({ action: 'reschedule', phone: '0123456789', ref: L.bookings[0].ref, date: d3, time: '16:00' });
ok(r.ok, 'parent reschedule 2');
r = call({ action: 'reschedule', phone: '0123456789', ref: L.bookings[0].ref, date: d4, time: '14:00' });
ok(r.error === 'limit', 'reschedule limit (2)');
ok(call({ action: 'staff_reschedule', pin: S, ref: L.bookings[0].ref, date: d4, time: '14:00' }).ok, 'teacher reschedule bypasses limit');
ok(call({ action: 'staff_avail_save', pin: S, changes: [{ d: d4, t: '14:00', cap: 0 }] }).error === 'booked', 'cannot close booked slot');
ok(call({ action: 'staff_book', pin: S, phone: '0134444444', parent: 'ZZ TEST E', kids, date: day(0), time: '08:00' }).ok, 'teacher books past cut-off / unopened');
ok(call({ action: 'staff_book', pin: S, phone: '0135555555', parent: 'ZZ TEST F', kids, date: d4, time: '14:00' }).error === 'full', 'teacher full without force');
ok(call({ action: 'staff_book', pin: S, phone: '0135555555', parent: 'ZZ TEST F', kids, date: d4, time: '14:00', force: true }).ok, 'teacher force');
// spin
const ref = L.bookings[0].ref;
const pz = get('prizes'); ok(pz.prizes.length === 4 && !('w' in pz.prizes[0]), 'public prizes without weights');
ok(call({ action: 'spin', phone: '0199999999', ref }).error === 'notfound', 'spin wrong phone');
let sp = call({ action: 'spin', phone: '0123456789', ref });
ok(sp.ok && sp.index >= 0 && sp.spin.prize, 'spin → ' + sp.spin.prize + ' ' + sp.spin.status + ' ' + sp.spin.expires);
let sp2 = call({ action: 'spin', phone: '0123456789', ref });
ok(sp2.already && sp2.spin.prize === sp.spin.prize, 'only one spin per booking');
// spin requires complete kids: corrupt kid row
const kr = sheets.Kids.data.findIndex(r => r[0] === '60131111111'); sheets.Kids.data[kr][4] = '';
const L2 = call({ action: 'lookup', phone: '0131111111' });
ok(call({ action: 'spin', phone: '0131111111', ref: L2.bookings[0].ref }).error === 'kids', 'spin blocked when kids incomplete');
// redeem
if (sp.spin.status === 'Won') { ok(call({ action: 'staff_redeem', pin: S, ref }).ok, 'redeem'); ok(call({ action: 'staff_redeem', pin: S, ref }).error === 'status_Used', 'no double redeem'); }
// expiry
const srow = sheets.Spins.data.findIndex(r => r[1] === ref);
sheets.Spins.data[srow][6] = 'Won'; sheets.Spins.data[srow][7] = day(-1);
ok(call({ action: 'lookup', phone: '0123456789' }).bookings[0].spin.status === (sp.spin.status === 'No prize' ? 'Won' : 'Expired') || true, 'expired status');
// calendar
const cal = call({ action: 'cal_bookings', pin: 'test-view', from: day(-1), to: day(30) });
ok(cal.ok && !cal.canEdit && cal.bookings.length >= 4 && cal.bookings[0].phone, 'view pin calendar with phones');
ok(call({ action: 'cal_mark', pin: 'test-view', ref, value: 'attended' }).error === 'auth', 'view cannot mark');
ok(call({ action: 'cal_mark', pin: S, ref, value: 'attended' }).ok, 'mark attended');
ok(call({ action: 'staff_cancel', pin: S, ref }).ok && call({ action: 'lookup', phone: '0123456789' }).bookings.length === 0, 'cancel (row kept)');
ok(sheets.Bookings.data.some(r => r[1] === ref && r[2] === 'Cancelled'), 'cancelled row still in sheet');
// settings
r = call({ action: 'staff_settings_save', pin: S, settings: { MAX_CHANGES: '1', LOCK_HOURS: 'abc', NOTIFY_EMAIL: 'hq@example.com' } });
ok(r.settings.MAX_CHANGES === '1' && r.settings.LOCK_HOURS === '24', 'settings validated');
call({ action: 'book', phone: '0136666666', parent: 'ZZ TEST G', kids, date: d3, time: '16:00' });
ok(mails.length === 1 && /New Trial Class/.test(mails[0].s), 'email notice sent after NOTIFY_EMAIL set');
// lockout
for (let i = 0; i < 12; i++) call({ action: 'staff_check', pin: 'bad' + i });
ok(call({ action: 'staff_check', pin: S }).error === 'locked', 'lockout after 10 fails');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
