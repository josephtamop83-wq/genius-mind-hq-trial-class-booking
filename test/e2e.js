const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const B = 'http://localhost:8765/', OUT = '/home/user/gma-hq/test/shots/';
require('fs').mkdirSync(OUT, { recursive: true });
const day = n => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 412, height: 860 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const shot = async n => pg.screenshot({ path: OUT + n + '.png', fullPage: true });
  // teacher opens dates
  await pg.goto(B + 'availability.html'); await pg.fill('#pin', 'test-staff'); await pg.click('#login');
  await pg.waitForSelector('.times'); await shot('a1-avail-empty');
  for (const tm of ['10:00', '14:00']) { await pg.fill('#newtime', tm); await pg.click('#addtime'); }
  await pg.click('[data-wk="1"]');
  const sels = await pg.$$('select[data-k]');
  for (let i = 0; i < sels.length; i++) await (await pg.$$('select[data-k]'))[i].selectOption(String(i % 3 + 1));
  await pg.click('#copy'); await shot('a2-avail-edited');
  await pg.click('#save'); await pg.waitForSelector('text=Saved'); await shot('a3-avail-saved');
  // parent books
  await pg.goto(B + 'index.html'); await shot('p1-phone');
  await pg.fill('#phone', '012-3456789'); await pg.click('#go'); await pg.waitForSelector('#parent');
  await pg.click('#next'); await shot('p2-details-errors');
  await pg.fill('#parent', 'ZZ TEST Parent'); await pg.fill('[data-k=name]', 'ZZ TEST Kid'); await pg.selectOption('select[data-k=gender]', 'F'); await pg.fill('[data-k=age]', '6');
  await pg.check('#consent'); await pg.click('#next'); await pg.waitForSelector('.cal');
  await pg.click('.day:not([disabled])'); await pg.click('.slot:not(.taken)'); await shot('p3-date');
  await pg.click('#next'); await shot('p4-confirm');
  await pg.click('#next'); await pg.waitForSelector('.done-card'); await shot('p5-done');
  // spin
  await pg.click('[data-spin]'); await pg.waitForSelector('#spin'); await pg.waitForTimeout(300); await shot('s1-wheel');
  await pg.click('#spin'); await pg.waitForSelector('.done-card', { timeout: 9000 }); await shot('s2-result');
  // zh + returning parent
  await pg.goto(B + 'index.html'); await pg.click('[data-lang=zh]'); await pg.fill('#phone', '0123456789'); await pg.click('#go');
  await pg.waitForSelector('[data-resched]'); await shot('p6-mine-zh');
  await pg.click('[data-resched]'); await pg.waitForSelector('.cal'); await pg.click('.day:not([disabled])'); await pg.click('.slot:not(.taken)'); await shot('p7-resched-date-zh'); await pg.click('#next');
  await pg.waitForSelector('.done-card'); await shot('p8-resched-done-zh');
  // calendar
  const r = await (await fetch(B + '__dump')).json(); const bk = r.sheets.Bookings[1];
  await pg.goto(B + 'calendar.html'); await pg.waitForSelector('.cal');
  if (bk[8].slice(0, 7) !== day(0).slice(0, 7)) await pg.click('[data-mon="1"]'), await pg.waitForSelector('.cal');
  await pg.click('[data-date="' + bk[8] + '"]'); await shot('c1-calendar');
  await pg.click('#newbk'); await pg.fill('#f_parent', 'ZZ TEST Walkin'); await pg.fill('#f_phone', '0137777777'); await pg.fill('#f_kids', 'ZZ Kid A, M, 8\nZZ Kid B, F, 5'); await pg.fill('#f_date', day(0)); await pg.click('#f_ok');
  await pg.waitForSelector('text=Booked 已预订'); await pg.click('[data-mark=attended]'); await pg.waitForTimeout(400); await shot('c2-staff-booked');
  await pg.goto(B + 'settings.html'); await pg.waitForSelector('#save'); await shot('t1-settings');
  await pg.goto(B + 'teachers.html'); await shot('t0-menu');
  await pg.setViewportSize({ width: 360, height: 740 }); await pg.goto(B + 'index.html'); await shot('p0-phone-360');
  console.log('errors:', errs.length ? errs : 'none');
  const d = await (await fetch(B + '__dump')).json();
  console.log('Bookings\n' + d.sheets.Bookings.slice(1).map(r => r.slice(1, 12).join(' | ')).join('\n'));
  console.log('Spins', JSON.stringify(d.sheets.Spins.slice(1)));
  await br.close();
})().catch(e => { console.error(e); process.exit(1); });
