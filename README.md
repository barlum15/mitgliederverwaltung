# Mitgliederverwaltung

Ein Offline-Programm zur Verwaltung von Vereinsmitgliedern. Es besteht aus **einer einzigen Datei**
(`Mitgliederverwaltung.html`), die man nicht installieren muss: Man öffnet sie einfach mit **Google Chrome**.

## Datenschutz

- **Alle Daten bleiben auf Ihrem Computer.** Die Mitglieder werden in einer Datenbankdatei (`.db`)
  gespeichert, die dort liegt, wo Sie es bestimmen (Festplatte, USB-Stick …).
- Die Seite enthält eine Sicherheitsregel für den Browser (*Content-Security-Policy* mit
  `connect-src 'none'`), die **jede Netzwerkverbindung technisch verbietet**. Es werden keine
  Schriften, Bilder oder Programmteile aus dem Internet geladen, und es können keine Daten gesendet werden.
- Alle Bausteine sind in der HTML-Datei enthalten: SQLite ([sql.js](https://github.com/sql-js/sql.js), MIT-Lizenz,
  in `vendor/`) und ein eigener, kleiner Excel-Schreiber (`src/xlsx.js`).
- Selbst überprüfen: Programm im Flugmodus bzw. ohne Netzwerkkabel starten – es funktioniert genauso.

## Bedienung

### Erster Start
1. `Mitgliederverwaltung.html` per Doppelklick in **Google Chrome** öffnen
   (falls ein anderer Browser startet: Rechtsklick → *Öffnen mit* → *Google Chrome*).
2. **Neue Datenbank anlegen** wählen und einen Speicherort festlegen, z. B. `Dokumente\Verein\mitglieder.db`.
3. Chrome fragt, ob die Seite die Datei bearbeiten darf → **Bearbeiten erlauben** (bzw. *Änderungen speichern*).

Beim nächsten Start zeigt das Programm die zuletzt verwendete Datenbank an – ein Klick auf **Öffnen** genügt
(Chrome fragt aus Sicherheitsgründen jedes Mal einmal nach der Erlaubnis).

Jede Änderung wird **sofort automatisch** in die Datenbankdatei geschrieben. Oben links zeigt
„✔ Gespeichert“ an, dass alles gesichert ist.

### Funktionen
| Funktion | Beschreibung |
|---|---|
| **Liste** | Alle *aktiven* Mitglieder, nummeriert, alphabetisch nach Familienname. Oben die Anzahl aktiver Mitglieder. |
| **Neues Mitglied** | Stammdaten erfassen (Anrede, Titel, Name, Geburtsdatum, Adresse, Mitglied seit, Anmerkung). |
| **Bearbeiten** | Stift-Symbol oder Doppelklick auf eine Zeile. Hier auch **Austritt** (Austrittsdatum, Grund „Austritt“ oder „Verstorben“ mit Sterbedatum). |
| **Mitgliedsbeitrag** | Häkchen für nächstes Jahr, aktuelles Jahr und Vorjahr (in dieser Reihenfolge). Beim Anhaken wird der **bezahlte Betrag** abgefragt (jedes Jahr frei wählbar, z. B. mit Spende; vorgeschlagen wird der zuletzt bezahlte Betrag). Ein Klick auf den Betrag ändert ihn. Abwählen muss bestätigt werden. Alle Jahre und Beträge bleiben in der Datenbank gespeichert; oben steht die Summe des aktuellen Jahres. |
| **Löschen** | Mülleimer-Symbol – entfernt ein Mitglied *endgültig* (für Fehleingaben). Für Austritte bitte stattdessen den Austrittsgrund eintragen. |
| **Ehemalige** | Ausgetretene und verstorbene Mitglieder; Bearbeiten, wieder aufnehmen, löschen, Excel-Export. |
| **Verstorbene** | Liste mit Anrede, Vorname, Familienname, Geburtsdatum, Sterbedatum; Excel-Export. |
| **Geburtstage** | Geburtstage des aktuellen Jahres nach Monaten. Excel-Mappe mit 12 Blättern (Jänner–Dezember). Das Alter ist immer *aktuelles Jahr − Geburtsjahr* (wer am 6.7.2006 geboren ist, steht 2026 das ganze Jahr mit 20 in der Liste). Runde (10, 20, 30 …) und halbrunde (25, 35, 45 …) Geburtstage sind farbig markiert. Nur aktive Mitglieder. |
| **Finanzen** | Einnahmen-Ausgaben-Rechnung mit Jahresauswahl. Oberste Zeile ist immer **Mitgliedsbeiträge** (Summe der bezahlten Beiträge des gewählten Jahres). Einzelne Einnahmen (z. B. Spenden) und Ausgaben (z. B. Druckerpapier) mit Datum, Bezeichnung, Betrag und Anmerkung erfassen, bearbeiten und löschen. Ausgaben können als **bar vorgelegt** gekennzeichnet werden; mit dem Datum der Überweisung auf das eigene Konto ist nachvollziehbar, ob die Rückerstattung schon erfolgt ist. Offene Rückerstattungen werden oben hervorgehoben. Summe Einnahmen, Summe Ausgaben und Einnahmen − Ausgaben; Excel-Export. |
| **Excel-Export** | Liste aller aktiven Mitglieder inkl. Beitragsstatus und Beträgen als `.xlsx`, mit Summenzeile. |
| **Sicherheitskopie** | Speichert eine Kopie der Datenbank an einem frei wählbaren Ort (z. B. USB-Stick). Oben wird das Datum der letzten Sicherung angezeigt; nach 30 Tagen ohne Sicherung wird es gelb markiert. |

### Sicherheitskopie zurückspielen
Eine Sicherheitskopie ist eine ganz normale Datenbankdatei: Über das Symbol ⇄ (Datenbank wechseln) →
**Datenbank öffnen** kann sie direkt geöffnet und weiterverwendet werden.

### Hinweise
- Es sollte immer nur **eine Person gleichzeitig** mit derselben Datenbankdatei arbeiten.
- Wird die Datenbankdatei verschoben oder umbenannt, einfach über **Datenbank öffnen** neu auswählen.
- Andere Browser als Chrome (oder Edge) unterstützen das direkte Speichern in Dateien nicht.

## Testdaten

`testdaten/mitglieder_test.db` enthält **erfundene** Mitglieder zum Ausprobieren
(45 Personen, davon 36 aktiv, 4 ausgetreten, 5 verstorben; Wohnorte sind österreichische Landeshauptstädte, Beiträge meist 30 €, teils mit Spende). Einfach über **Datenbank öffnen** auswählen.

## Für Entwickler

Die Datei `Mitgliederverwaltung.html` wird aus den Quellen in `src/` erzeugt:

```bash
node tools/build.mjs            # baut Mitgliederverwaltung.html
node tools/testdaten.mjs        # erzeugt testdaten/mitglieder_test.db neu
node tests/e2e.mjs              # automatischer Browsertest (Playwright/Chromium, Python mit openpyxl)
```

| Pfad | Inhalt |
|---|---|
| `src/index.html` | Seitenaufbau inkl. Content-Security-Policy |
| `src/style.css` | Design |
| `src/app.js` | Programmlogik |
| `src/xlsx.js` | Excel-Schreiber (ohne externe Bibliothek) |
| `src/schema.sql` | Datenbankstruktur (Tabellen `mitglieder`, `beitraege` mit Betrag in Cent, `buchungen` für Einnahmen/Ausgaben, `meta`). Ältere Datenbanken werden beim Öffnen automatisch ergänzt. |
| `vendor/sql.js-1.13.0/` | SQLite als WebAssembly (MIT-Lizenz) |
