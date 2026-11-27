// Runs Code.gs in node with fake Google services, and serves the site + /exec on one port.
const fs = require('fs'), http = require('http'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const sheets = {};
function Sheet(name) { this.name = name; this.data = []; }
Sheet.prototype = {
  getLastRow() { return this.data.length; },
  getDataRange() { const d = this.data; return { getValues: () => d.map(r => r.slice()) }; },
  getRange(a, b, c, d) {
    const s = this;
    if (typeof a === 'string') return { setNumberFormat() { return this; } };
    return {
      setValues(v) { v.forEach((row, i) => { s.data[a - 1 + i] = s.data[a - 1 + i] || []; row.forEach((x, j) => s.data[a - 1 + i][b - 1 + j] = x); }); return this; },
      setFontWeight() { return this; },
      setValue(v) { while (s.data.length < a) s.data.push([]); s.data[a - 1][b - 1] = v; return this; }
    };
  },
  setFrozenRows() {},
  appendRow(r) { const w = this.data[0] ? this.data[0].length : r.length; const row = r.slice(); while (row.length < w) row.push(''); this.data.push(row); },
  deleteRow(i) { this.data.splice(i - 1, 1); }
};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getSheets: () => Object.values(sheets), deleteSheet() {} };
const props = { STAFF_PIN: 'test-staff', VIEW_PIN: 'test-view' }, cache = {}, mails = [];
const ctx = {
  SpreadsheetApp: { getActive: () => ss },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => cache[k] = v }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
  MailApp: { sendEmail: (to, s, b) => mails.push({ to, s, b }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType() { return this; }, t }) },
  Utilities: { formatDate(d, tz, f) {
    const x = new Date(d.getTime() + 8 * 3600000), p = n => String(n).padStart(2, '0');
    return f.replace('yyyy', x.getUTCFullYear()).replace('MM', p(x.getUTCMonth() + 1)).replace('dd', p(x.getUTCDate())).replace('HH', p(x.getUTCHours())).replace('mm', p(x.getUTCMinutes())).replace('ss', p(x.getUTCSeconds()));
  } },
  console, Date, Math, JSON
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8'), ctx);
ctx.setup();
module.exports = { ctx, sheets, mails, cache, props };
if (require.main === module) {
  const port = +process.argv[2] || 8765;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/exec') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        const r = req.method === 'POST' ? ctx.doPost({ postData: { contents: body } }) : ctx.doGet({ parameter: Object.fromEntries(u.searchParams) });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(r.t);
      }); return;
    }
    if (u.pathname === '/__dump') { res.end(JSON.stringify({ sheets: Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v.data])), mails })); return; }
    let f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
    if (u.pathname === '/config.js') { res.end(fs.readFileSync(f, 'utf8').replace("API_URL: ''", "API_URL: '/exec'").replace("WHATSAPP: ''", "WHATSAPP: '60123456789'")); return; }
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
  }).listen(port, () => console.log('mock on ' + port));
}
