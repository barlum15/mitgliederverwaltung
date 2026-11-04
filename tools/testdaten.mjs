// Erzeugt eine Testdatenbank mit ERFUNDENEN Mitgliedern (Dummy-Daten).
// Aufruf: node tools/testdaten.mjs [Zieldatei]   (Standard: testdaten/mitglieder_test.db)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(join(root, 'vendor/sql.js-1.13.0/sql-wasm.js'));

// Deterministischer Zufall, damit die Testdaten immer gleich aussehen
let seed = 20260704;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');
const randDate = (y1, y2) => `${y1 + Math.floor(rnd() * (y2 - y1 + 1))}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`;

const FRAUEN = ['Maria', 'Anna', 'Elisabeth', 'Petra', 'Sabine', 'Claudia', 'Monika', 'Birgit', 'Julia', 'Katharina', 'Theresa', 'Johanna', 'Lena', 'Sophie', 'Ingrid', 'Gertraud'];
const MAENNER = ['Johann', 'Josef', 'Franz', 'Michael', 'Thomas', 'Andreas', 'Stefan', 'Christian', 'Markus', 'Wolfgang', 'Peter', 'Lukas', 'Florian', 'Herbert', 'Gerhard', 'Alois'];
const NACHNAMEN = ['Gruber', 'Huber', 'Bauer', 'Wagner', 'Müller', 'Pichler', 'Steiner', 'Moser', 'Mayer', 'Hofer', 'Leitner', 'Berger',
  'Fuchs', 'Eder', 'Fischer', 'Schmid', 'Winkler', 'Weber', 'Schwarz', 'Maier', 'Reiter', 'Wimmer', 'Egger', 'Brunner', 'Lang',
  'Baumgartner', 'Auer', 'Binder', 'Lechner', 'Wolf', 'Wallner', 'Aigner', 'Ebner', 'Koller', 'Lehner', 'Haas', 'Öhlinger', 'Ölz', 'Zöhrer', 'Ärnstein'];
const ORTE = [['9020', 'Klagenfurt am Wörthersee'], ['9500', 'Villach'], ['9300', 'St. Veit an der Glan'], ['9100', 'Völkermarkt'],
  ['9400', 'Wolfsberg'], ['9800', 'Spittal an der Drau'], ['9220', 'Velden am Wörther See'], ['9560', 'Feldkirchen in Kärnten']];
const STRASSEN = ['Hauptplatz', 'Bahnhofstraße', 'Kirchgasse', 'Lindenweg', 'Schulstraße', 'Seeweg', 'Am Anger', 'Bergstraße', 'Wiesengasse', 'Mühlweg'];
const TITEL_VOR = ['Dr.', 'Mag.', 'Ing.', 'DI', 'Mag.a', 'Prof.'];
const TITEL_NACH = ['BSc', 'MSc', 'MBA', 'BA', 'PhD'];
const ANMERKUNGEN = ['Kassier', 'Obmann-Stv.', 'Möchte Post per E-Mail', 'Ehrenmitglied', 'Schriftführerin', 'Neu zugezogen', 'Hilft beim Sommerfest'];

// Feste Fälle, um runde Geburtstage und Grenzfälle sicher zu testen (Jahrgänge relativ zum aktuellen Jahr)
const Y = new Date().getFullYear();
const fixed = [
  { anrede: 'Frau', vorname: 'Petra', familienname: 'Öhlinger', geburtsdatum: `${Y - 20}-07-06`, anmerkung: 'Beispiel aus der Anforderung (6.7., wird heuer 20)' },
  { anrede: 'Herr', vorname: 'Franz', familienname: 'Auer', titel_vor: 'Dr.', geburtsdatum: `${Y - 50}-01-01` },
  { anrede: 'Frau', vorname: 'Maria', familienname: 'Bauer', titel_vor: 'Mag.', titel_nach: 'MSc', geburtsdatum: `${Y - 75}-12-31` },
  { anrede: 'Herr', vorname: 'Josef', familienname: 'Zöhrer', geburtsdatum: `${Y - 25}-03-15` },
  { anrede: 'Frau', vorname: 'Ingrid', familienname: 'Huber', geburtsdatum: `${Y - 60}-07-20` },
  { anrede: 'Herr', vorname: 'Alois', familienname: 'Huber', geburtsdatum: `${Y - 81}-07-02` },
  { anrede: 'Frau', vorname: 'Anna', familienname: 'Müller', geburtsdatum: `${Y - 33}-02-28` }
];

function makeMember(i) {
  const frau = rnd() < 0.5;
  const [plz, stadt] = pick(ORTE);
  const geb = randDate(1935, 2008);
  const beitritt = randDate(Math.max(Number(geb.slice(0, 4)) + 16, 1975), Y);
  return {
    anrede: frau ? 'Frau' : 'Herr',
    titel_vor: rnd() < 0.18 ? pick(TITEL_VOR) : null,
    familienname: NACHNAMEN[i % NACHNAMEN.length],
    vorname: pick(frau ? FRAUEN : MAENNER),
    titel_nach: rnd() < 0.1 ? pick(TITEL_NACH) : null,
    geburtsdatum: rnd() < 0.05 ? null : geb,
    plz, stadt,
    adresse: `${pick(STRASSEN)} ${1 + Math.floor(rnd() * 60)}`,
    beitrittsdatum: beitritt,
    anmerkung: rnd() < 0.2 ? pick(ANMERKUNGEN) : null
  };
}

export async function buildTestDb() {
  const SQL = await initSqlJs({ wasmBinary: readFileSync(join(root, 'vendor/sql.js-1.13.0/sql-wasm.wasm')) });
  const db = new SQL.Database();
  db.exec(readFileSync(join(root, 'src/schema.sql'), 'utf8'));
  const now = `${Y}-01-01 12:00:00`;
  db.run("INSERT INTO meta(key, value) VALUES ('schema_version', '1'), ('erstellt_am', ?), ('testdaten', 'ja')", [now]);

  const members = [...fixed.map((m) => {
    const [plz, stadt] = pick(ORTE);
    return { titel_vor: null, titel_nach: null, plz, stadt, adresse: `${pick(STRASSEN)} ${1 + Math.floor(rnd() * 60)}`,
      beitrittsdatum: randDate(Math.max(Number(m.geburtsdatum.slice(0, 4)) + 16, 1980), Y), anmerkung: null, ...m };
  })];
  for (let i = 0; i < 38; i++) members.push(makeMember(i));

  // Ehemalige: 4 Austritte und 5 Verstorbene
  // Alle Daten liegen in der Vergangenheit (spätestens im Vorjahr) und nach Geburt bzw. Beitritt.
  const yearOf = (iso, fallback) => (iso ? Number(iso.slice(0, 4)) : fallback);
  const exitDate = (m, minAge) => {
    const from = Math.min(Math.max(2010, yearOf(m.geburtsdatum, 1950) + minAge, yearOf(m.beitrittsdatum, 2000) + 1), Y - 1);
    return randDate(from, Y - 1);
  };
  members.slice(10, 14).forEach((m) => { m.austrittsgrund = 'Austritt'; m.austrittsdatum = exitDate(m, 18); });
  members.slice(14, 19).forEach((m) => {
    m.austrittsgrund = 'Verstorben';
    m.sterbedatum = exitDate(m, 30);
    m.austrittsdatum = m.sterbedatum;
  });
  for (const m of members) {
    if (m.austrittsdatum && m.beitrittsdatum > m.austrittsdatum) {
      m.beitrittsdatum = `${yearOf(m.austrittsdatum) - 1}-${m.beitrittsdatum.slice(5)}`;
    }
  }

  const ins = db.prepare(`INSERT INTO mitglieder (anrede, titel_vor, familienname, vorname, titel_nach, geburtsdatum, plz, stadt, adresse,
    beitrittsdatum, anmerkung, austrittsgrund, austrittsdatum, sterbedatum, erstellt_am, geaendert_am)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const fee = db.prepare('INSERT INTO beitraege (mitglied_id, jahr, bezahlt, geaendert_am) VALUES (?,?,?,?)');
  members.forEach((m, idx) => {
    ins.run([m.anrede, m.titel_vor, m.familienname, m.vorname, m.titel_nach, m.geburtsdatum, m.plz, m.stadt, m.adresse,
      m.beitrittsdatum, m.anmerkung, m.austrittsgrund || null, m.austrittsdatum || null, m.sterbedatum || null, now, now]);
    const id = idx + 1;
    for (const year of [Y - 2, Y - 1, Y, Y + 1]) {
      const p = year < Y ? 0.9 : year === Y ? 0.6 : 0.1;
      if (rnd() < p) fee.run([id, year, 1, now]);
    }
  });
  ins.free();
  fee.free();
  const bytes = db.export();
  db.close();
  return bytes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] || join(root, 'testdaten/mitglieder_test.db');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, await buildTestDb());
  console.log('Testdatenbank erstellt:', target);
}
