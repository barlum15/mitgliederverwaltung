// Automatischer Browsertest (Chromium/Playwright) der fertigen Mitgliederverwaltung.html.
// Das Datei-System des Browsers wird simuliert; es werden echte Testdaten verwendet.
// Aufruf: node tests/e2e.mjs [Ordner für Ausgaben]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || join(root, 'tests/output');
mkdirSync(outDir, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const initSqlJs = require(join(root, 'vendor/sql.js-1.13.0/sql-wasm.js'));
const SQL = await initSqlJs({ wasmBinary: readFileSync(join(root, 'vendor/sql.js-1.13.0/sql-wasm.wasm')) });
const Y = new Date().getFullYear();

let step = 0;
const ok = (msg) => console.log(`  ✔ ${++step}. ${msg}`);

// ---------- Simuliertes Dateisystem im Browser ----------
const fsMock = () => {
  window.__fs = {};
  window.__pickQueue = [];
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  class MockHandle {
    constructor(name) { this.kind = 'file'; this.name = name; }
    async getFile() { return new File([window.__fs[this.name] || new Uint8Array()], this.name); }
    async createWritable() {
      const chunks = [];
      const name = this.name;
      return {
        async write(d) { chunks.push(d instanceof Uint8Array ? d : new Uint8Array(d)); },
        async close() {
          const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
          let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
          window.__fs[name] = out;
        }
      };
    }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async isSameEntry(o) { return !!o && o.name === this.name; }
  }
  window.showOpenFilePicker = async () => {
    const n = window.__pickQueue.shift();
    if (!n) throw new DOMException('Abgebrochen', 'AbortError');
    return [new MockHandle(n)];
  };
  window.showSaveFilePicker = async (opts) => {
    window.__lastSuggested = opts.suggestedName;
    return new MockHandle(window.__pickQueue.shift() || opts.suggestedName);
  };
};

// Scrollbalken einblenden (Playwright blendet sie sonst aus), damit der Zoom-Test sie messen kann
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, locale: 'de-AT' });
const external = [];
const errors = [];
page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) external.push(r.url()); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(fsMock);

const putFile = (name, bytes) => page.evaluate(([n, b]) => { window.__fs[n] = new Uint8Array(b); }, [name, Array.from(bytes)]);
const getFile = async (name) => new Uint8Array(await page.evaluate((n) => Array.from(window.__fs[n] || []), name));
const queue = (name) => page.evaluate((n) => window.__pickQueue.push(n), name);
const dbOf = async (name) => new SQL.Database(await getFile(name));
const waitSaved = async () => { await page.waitForTimeout(80); await page.waitForFunction(() => window.__mv.state.pendingSaves === 0 && document.querySelector('#save-status').textContent.includes('Gespeichert')); };
const expectCount = (n) => page.waitForFunction((x) => document.querySelector('#count-active').textContent === String(x), n, { timeout: 5000 });
const activeCount = async () => Number(await page.textContent('#count-active'));
const confirmYes = async () => { await page.waitForSelector('#dlg-confirm[open]'); await page.click('#confirm-yes'); await page.waitForSelector('#dlg-confirm:not([open])', { state: 'attached' }); await page.evaluate(() => new Promise((r) => setTimeout(r, 30))); };
const confirmNo = async () => { await page.waitForSelector('#dlg-confirm[open]'); await page.click('#confirm-no'); await page.waitForSelector('#dlg-confirm:not([open])', { state: 'attached' }); await page.evaluate(() => new Promise((r) => setTimeout(r, 30))); };

console.log('Browsertest Mitgliederverwaltung');
await page.goto(pathToFileURL(join(root, 'Mitgliederverwaltung.html')).href);
await page.waitForSelector('#start:not([hidden])');
ok('Startbildschirm wird angezeigt');
await page.screenshot({ path: join(outDir, '01_start.png') });

// Datenschutz: Netzwerk ist technisch gesperrt
const fetchResult = await page.evaluate(() => fetch('https://example.com/').then(() => 'erreicht', () => 'blockiert'));
assert.equal(fetchResult, 'blockiert');
ok('Netzwerkzugriff aus der Seite wird vom Browser blockiert (CSP)');

// Testdatenbank öffnen
const testDb = readFileSync(join(root, 'testdaten/mitglieder_test.db'));
await putFile('mitglieder_test.db', testDb);
await queue('mitglieder_test.db');
await page.click('#btn-open');
await page.waitForSelector('#app:not([hidden])');
const ref = new SQL.Database(testDb);
const expectedActive = ref.exec('SELECT count(*) FROM mitglieder WHERE austrittsgrund IS NULL')[0].values[0][0];
await expectCount(expectedActive);
ok(`Testdatenbank geöffnet, ${expectedActive} aktive Mitglieder angezeigt`);

// Sortierung & Nummerierung
const rows = await page.$$eval('#members-body tr', (trs) => trs.map((tr) => [...tr.children].slice(0, 5).map((td) => td.textContent.trim())));
rows.forEach((r, i) => assert.equal(r[0], String(i + 1)));
const coll = new Intl.Collator('de-AT', { sensitivity: 'base' });
for (let i = 1; i < rows.length; i++) assert.ok(coll.compare(rows[i - 1][3], rows[i][3]) <= 0, `Sortierung: ${rows[i - 1][3]} vor ${rows[i][3]}`);
assert.ok(rows.findIndex((r) => r[3] === 'Öhlinger') > rows.findIndex((r) => r[3] === 'Moser'), 'Ö wird wie O einsortiert');
const headers = await page.$$eval('#members-table thead th', (ths) => ths.map((t) => t.textContent.trim()));
assert.deepEqual(headers.slice(12, 15), [String(Y + 1), String(Y), String(Y - 1)]);
ok('Liste ist nummeriert, alphabetisch nach Familienname (Umlaute korrekt), Beitragsjahre ' + headers.slice(12, 15).join('/'));
await page.screenshot({ path: join(outDir, '02_liste.png') });

// Neues Mitglied anlegen
await page.click('[data-action="neu"]');
await page.click('#btn-member-save');
assert.ok(await page.isVisible('#member-errors'));
ok('Pflichtfelder werden geprüft');
await page.selectOption('[name=anrede]', 'Herr');
await page.fill('[name=titel_vor]', 'Ing.');
await page.fill('[name=familienname]', 'Testmann');
await page.fill('[name=vorname]', 'Max');
await page.fill('[name=titel_nach]', 'MSc');
await page.fill('[name=geburtsdatum]', `${Y - 40}-05-10`);
await page.fill('[name=plz]', '9020');
await page.fill('[name=stadt]', 'Klagenfurt');
await page.fill('[name=adresse]', 'Teststraße 1');
await page.fill('[name=beitrittsdatum]', `${Y}-01-15`);
await page.fill('[name=anmerkung]', 'Angelegt im Test');
await page.screenshot({ path: join(outDir, '03_neues_mitglied.png') });
await page.click('#btn-member-save');
await waitSaved();
await expectCount(expectedActive + 1);
let db = await dbOf('mitglieder_test.db');
const saved = db.exec("SELECT titel_vor, titel_nach, geburtsdatum, stadt FROM mitglieder WHERE familienname='Testmann'")[0].values[0];
assert.deepEqual(saved, ['Ing.', 'MSc', `${Y - 40}-05-10`, 'Klagenfurt']);
ok('Neues Mitglied angelegt und sofort in die Datenbankdatei geschrieben');
const newId = db.exec("SELECT id FROM mitglieder WHERE familienname='Testmann'")[0].values[0][0];

// Beitrag anhaken / abwählen mit Bestätigung
const fee = `.fee[data-id="${newId}"][data-year="${Y}"]`;
await page.click(fee);
await waitSaved();
db = await dbOf('mitglieder_test.db');
assert.equal(db.exec(`SELECT bezahlt FROM beitraege WHERE mitglied_id=${newId} AND jahr=${Y}`)[0].values[0][0], 1);
ok(`Beitrag ${Y} angehakt und gespeichert`);
await page.click(fee);
await confirmNo();
assert.equal(await page.isChecked(fee), true);
ok('Abwählen fragt nach – „Abbrechen“ lässt den Haken stehen');
await page.click(fee);
await page.screenshot({ path: join(outDir, '04_beitrag_bestaetigen.png') });
await confirmYes();
await waitSaved();
assert.equal(await page.isChecked(fee), false);
db = await dbOf('mitglieder_test.db');
assert.equal(db.exec(`SELECT bezahlt FROM beitraege WHERE mitglied_id=${newId} AND jahr=${Y}`)[0].values[0][0], 0);
ok('Abwählen nach Bestätigung gespeichert');

// Bearbeiten: Austritt als verstorben
await page.dblclick(`#members-body tr[data-id="${newId}"] td.name`);
await page.waitForSelector('#dlg-member[open]');
assert.equal(await page.isVisible('#field-sterbedatum'), false);
await page.selectOption('[name=austrittsgrund]', 'Verstorben');
assert.equal(await page.isVisible('#field-sterbedatum'), true);
await page.fill('[name=sterbedatum]', `${Y}-02-01`);
await page.dispatchEvent('[name=sterbedatum]', 'change');
assert.equal(await page.inputValue('[name=austrittsdatum]'), `${Y}-02-01`);
await page.screenshot({ path: join(outDir, '05_bearbeiten_verstorben.png') });
await page.click('#btn-member-save');
await waitSaved();
await expectCount(expectedActive);
assert.equal(await page.$(`#members-body tr[data-id="${newId}"]`), null);
ok('Als verstorben markiert: Sterbedatum-Feld erscheint, Mitglied verschwindet aus aktiver Liste');

// Verstorbenen-Liste
await page.click('[data-action="verstorbene"]');
await page.waitForSelector('#dlg-list[open]');
const deadHead = await page.$$eval('#list-head th', (t) => t.map((x) => x.textContent.trim()));
assert.deepEqual(deadHead, ['Nr.', 'Anrede', 'Vorname', 'Familienname', 'Geburtsdatum', 'Sterbedatum']);
const deadFirst = await page.$$eval('#list-body tr:first-child td', (t) => t.map((x) => x.textContent.trim()));
assert.equal(deadFirst[3], 'Testmann');
await page.screenshot({ path: join(outDir, '06_verstorbene.png') });
await page.click('#btn-list-export');
await page.waitForFunction(() => window.__fs[window.__lastSuggested]);
const deadName = await page.evaluate(() => window.__lastSuggested);
writeFileSync(join(outDir, 'Verstorbene.xlsx'), await getFile(deadName));
ok('Verstorbenen-Liste angezeigt und als Excel gespeichert');
await page.click('#dlg-list [data-close]');

// Ehemalige & wieder aufnehmen
await page.click('[data-action="ehemalige"]');
await page.waitForSelector('#dlg-list[open]');
await page.screenshot({ path: join(outDir, '07_ehemalige.png') });
await page.click(`[data-list-reactivate="${newId}"]`);
await confirmYes();
await waitSaved();
await expectCount(expectedActive + 1);
ok('Ehemalige-Ansicht: Mitglied wieder aufgenommen');
await page.click('#dlg-list [data-close]');

// Geburtstage
await page.click('[data-action="geburtstage"]');
await page.waitForSelector('#dlg-list[open]');
await page.click('[data-month="6"]');
const july = await page.$$eval('#list-body tr', (trs) => trs.map((tr) => ({ cls: tr.className, cells: [...tr.children].map((t) => t.textContent.trim()) })));
const petra = july.find((r) => r.cells[4] === 'Öhlinger');
assert.equal(petra.cells[7], String(20));
assert.equal(petra.cls, 'bday-round');
ok('Geburtstage Juli: Öhlinger (geb. 06.07.' + (Y - 20) + ') wird heuer 20 und ist als runder Geburtstag markiert');
await page.screenshot({ path: join(outDir, '08_geburtstage.png') });
await page.click('#btn-list-export');
await page.waitForFunction(() => window.__lastSuggested && window.__lastSuggested.startsWith('Geburtstage') && window.__fs[window.__lastSuggested]);
writeFileSync(join(outDir, 'Geburtstage.xlsx'), await getFile(`Geburtstage_${Y}.xlsx`));
ok('Geburtstags-Mappe gespeichert');
await page.click('#dlg-list [data-close]');

// Mitgliederliste exportieren
await page.click('[data-action="export"]');
await page.waitForFunction(() => window.__lastSuggested?.startsWith('Mitgliederliste') && window.__fs[window.__lastSuggested]);
writeFileSync(join(outDir, 'Mitgliederliste.xlsx'), await getFile(await page.evaluate(() => window.__lastSuggested)));
ok('Mitgliederliste als Excel gespeichert');

// Sicherheitskopie
await page.click('[data-action="sicherung"]');
await page.waitForFunction(() => window.__lastSuggested?.startsWith('mitglieder_sicherung') && window.__fs[window.__lastSuggested]);
await waitSaved();
const backupName = await page.evaluate(() => window.__lastSuggested);
const bdb = await dbOf(backupName);
assert.equal(bdb.exec('SELECT count(*) FROM mitglieder WHERE austrittsgrund IS NULL')[0].values[0][0], expectedActive + 1);
assert.notEqual(await page.textContent('#last-backup'), 'noch keine');
ok(`Sicherheitskopie „${backupName}“ erstellt und vollständig lesbar`);

// Löschen
await page.click(`[data-delete="${newId}"]`);
await confirmNo();
await expectCount(expectedActive + 1);
await page.click(`[data-delete="${newId}"]`);
await confirmYes();
await waitSaved();
await expectCount(expectedActive);
db = await dbOf('mitglieder_test.db');
assert.equal(db.exec(`SELECT count(*) FROM mitglieder WHERE id=${newId}`)[0].values[0][0], 0);
assert.equal(db.exec(`SELECT count(*) FROM beitraege WHERE mitglied_id=${newId}`)[0].values[0][0], 0);
ok('Löschen mit Rückfrage, Mitglied samt Beiträgen entfernt');

// Suche
await page.fill('#search', 'ohlinger');
await page.waitForFunction(() => { const r = [...document.querySelectorAll('#members-body tr')]; return r.length >= 1 && r.length < 10 && r.every((tr) => tr.textContent.includes('Öhlinger')); });
ok('Suche findet „Öhlinger“ auch ohne Umlaut');
await page.fill('#search', '');
await page.waitForFunction(() => document.querySelectorAll('#members-body tr').length > 10);

// Zoom (Strg + Mausrad): Browser-Zoom verkleinert den nutzbaren Bereich in CSS-Pixeln.
// Der untere Rand der Tabelle (mit waagrechtem Scrollbalken) muss immer im Fenster bleiben.
for (const zoom of [1, 1.5, 2, 3]) {
  await page.setViewportSize({ width: Math.round(1600 / zoom), height: Math.round(950 / zoom) });
  const g = await page.evaluate(() => {
    const w = document.querySelector('.table-card > .table-wrap');
    const r = w.getBoundingClientRect();
    return { bottom: r.bottom, inner: window.innerHeight, pageScroll: document.documentElement.scrollHeight > window.innerHeight,
      overflowX: w.scrollWidth > w.clientWidth, barHeight: w.offsetHeight - w.clientHeight };
  });
  if (zoom === 2) await page.screenshot({ path: join(outDir, '10_zoom_200.png') });
  assert.ok(g.bottom <= g.inner + 0.5 || !g.pageScroll, `Zoom ${zoom * 100} %: Tabelle endet bei ${g.bottom}px, Fenster ist ${g.inner}px hoch`);
  assert.ok(g.bottom <= g.inner + 0.5 || zoom >= 3, `Zoom ${zoom * 100} %: Scrollbalken außerhalb des Fensters`);
  if (zoom > 1) assert.ok(g.overflowX && g.barHeight > 0, `Zoom ${zoom * 100} %: waagrechter Scrollbalken fehlt`);
}
await page.setViewportSize({ width: 1600, height: 950 });
ok('Bei 100 %, 150 % und 200 % Zoom bleibt der waagrechte Scrollbalken der Tabelle im Fenster sichtbar');

// Neue, leere Datenbank anlegen
await page.click('[data-action="wechseln"]');
await page.waitForSelector('#start:not([hidden])');
await queue('neu.db');
await page.click('#btn-new-db');
await page.waitForSelector('#app:not([hidden])');
await waitSaved();
await expectCount(0);
const ndb = await dbOf('neu.db');
assert.deepEqual(ndb.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0].values.flat(), ['beitraege', 'meta', 'mitglieder', 'sqlite_sequence']);
await page.screenshot({ path: join(outDir, '09_leere_datenbank.png') });
ok('Neue leere Datenbank angelegt');

// Datenschutz-Abschluss
assert.deepEqual(external, [], 'Externe Anfragen: ' + external.join(', '));
const csp = await page.evaluate(() => window.__csp);
assert.deepEqual(csp.filter((c) => !c.includes('example.com')), []);
assert.deepEqual(errors.filter((e) => !/example\.com|Content Security Policy|Failed to fetch/i.test(e)), []);
ok('Keine einzige Netzwerkanfrage, keine Fehler im Browser');

await browser.close();

// Excel-Dateien mit openpyxl prüfen
const py = `
import openpyxl, sys
d = sys.argv[1]; Y = int(sys.argv[2])
wb = openpyxl.load_workbook(d + '/Geburtstage.xlsx')
months = ['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
assert wb.sheetnames == months, wb.sheetnames
ws = wb['Juli']
rows = [r for r in ws.iter_rows(min_row=5, values_only=True)]
petra = [r for r in rows if r[4] == 'Öhlinger'][0]
assert petra[7] == 20 and petra[8] == 'rund (20)', petra
cell = [c for c in ws['E'] if c.value == 'Öhlinger'][0]
assert cell.fill.fgColor.rgb == 'FFFCD34D'
ml = openpyxl.load_workbook(d + '/Mitgliederliste.xlsx')['Mitglieder']
hdr = [c.value for c in ml[4]]
assert hdr[:6] == ['Nr.','Anrede','Titel vorangestellt','Familienname','Vorname','Titel nachgestellt'], hdr
assert hdr[-3:] == ['Beitrag %d' % (Y+1), 'Beitrag %d' % Y, 'Beitrag %d' % (Y-1)], hdr
nrs = [r[0] for r in ml.iter_rows(min_row=5, values_only=True)]
assert nrs == list(range(1, len(nrs)+1))
v = openpyxl.load_workbook(d + '/Verstorbene.xlsx')['Verstorbene']
assert [c.value for c in v[4]] == ['Nr.','Anrede','Vorname','Familienname','Geburtsdatum','Sterbedatum']
print(len(nrs))
`;
const n = execFileSync('python3', ['-c', py, outDir, String(Y)]).toString().trim();
ok(`Excel-Dateien geprüft (12 Monatsblätter, Alter & Markierung korrekt, ${n} Mitglieder nummeriert)`);
console.log(`\nAlle ${step} Prüfungen bestanden.`);
