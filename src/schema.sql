-- Datenbankstruktur der Mitgliederverwaltung (SQLite)
-- Alle Anweisungen sind wiederholbar (IF NOT EXISTS), damit sie bei jedem Öffnen
-- einer Datenbank gefahrlos ausgeführt werden können.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS mitglieder (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  anrede          TEXT NOT NULL CHECK (anrede IN ('Frau', 'Herr')),
  titel_vor       TEXT,
  familienname    TEXT NOT NULL,
  vorname         TEXT NOT NULL,
  titel_nach      TEXT,
  geburtsdatum    TEXT,            -- JJJJ-MM-TT
  plz             TEXT,
  stadt           TEXT,
  adresse         TEXT,
  beitrittsdatum  TEXT,            -- JJJJ-MM-TT ("Mitglied seit")
  anmerkung       TEXT,
  austrittsdatum  TEXT,            -- JJJJ-MM-TT
  austrittsgrund  TEXT CHECK (austrittsgrund IS NULL OR austrittsgrund IN ('Austritt', 'Verstorben')),
  sterbedatum     TEXT,            -- JJJJ-MM-TT, nur bei 'Verstorben'
  erstellt_am     TEXT,
  geaendert_am    TEXT
);

-- Ein Eintrag pro Mitglied und Jahr; so bleiben alle Jahre dauerhaft erhalten.
-- (Ältere Datenbanken ohne Spalte betrag_cent werden beim Öffnen vom Programm ergänzt.)
CREATE TABLE IF NOT EXISTS beitraege (
  mitglied_id   INTEGER NOT NULL REFERENCES mitglieder(id) ON DELETE CASCADE,
  jahr          INTEGER NOT NULL,
  bezahlt       INTEGER NOT NULL DEFAULT 0 CHECK (bezahlt IN (0, 1)),
  betrag_cent   INTEGER CHECK (betrag_cent IS NULL OR betrag_cent >= 0), -- bezahlter Betrag in Cent (3050 = 30,50 €)
  geaendert_am  TEXT,
  PRIMARY KEY (mitglied_id, jahr)
);

CREATE INDEX IF NOT EXISTS idx_mitglieder_aktiv ON mitglieder (austrittsgrund);
