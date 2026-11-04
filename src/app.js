/*
 * Mitgliederverwaltung – Programmlogik
 *
 * Datenschutz: Dieses Skript verwendet keinerlei Netzwerkfunktionen (kein fetch, kein
 * XMLHttpRequest, keine WebSockets). Die Datenbank wird ausschließlich über die
 * File System Access API des Browsers in eine lokale Datei geschrieben.
 */
(async function () {
  'use strict';

  // ================= Grundlagen =================
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const I = window.ICONS;
  const collator = new Intl.Collator('de-AT', { sensitivity: 'base', numeric: true });
  const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
    'September', 'Oktober', 'November', 'Dezember'];
  const DB_TYPES = [{ description: 'Mitglieder-Datenbank', accept: { 'application/x-sqlite3': ['.db', '.sqlite', '.sqlite3'] } }];
  const XLSX_TYPES = [{ description: 'Excel-Arbeitsmappe', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }];
  const BACKUP_WARN_DAYS = 30;

  const state = {
    SQL: null,
    db: null,
    handle: null,
    members: [],
    fees: new Map(),       // mitglied_id -> Map(jahr -> 0/1)
    search: '',
    saveChain: Promise.resolve(true),
    pendingSaves: 0,
    editing: null,         // aktuell bearbeitetes Mitglied (oder null bei "neu")
    list: { mode: null, month: new Date().getMonth() }
  };

  // ================= Hilfsfunktionen =================
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const pad = (n) => String(n).padStart(2, '0');
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function nowStamp() { const d = new Date(); return `${todayISO()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  function currentYear() { return new Date().getFullYear(); }
  // Reihenfolge der Beitragsspalten: nächstes Jahr, aktuelles Jahr, Vorjahr (Index 1 = aktuelles Jahr)
  function feeYears() { const y = currentYear(); return [y + 1, y, y - 1]; }
  function isValidISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function fmtDate(iso) {
    if (!isValidISO(iso)) return iso || '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }
  function fmtStamp(stamp) {
    if (!stamp) return '';
    const [date, time] = stamp.split(' ');
    return fmtDate(date) + (time ? ', ' + time.slice(0, 5) : '');
  }
  function daysSince(stamp) {
    const iso = (stamp || '').slice(0, 10);
    if (!isValidISO(iso)) return Infinity;
    const [y, m, d] = iso.split('-').map(Number);
    const then = new Date(y, m - 1, d);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((now - then) / 86400000);
  }
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const clean = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
  function fullName(m, withTitles = true) {
    return [withTitles && m.titel_vor, m.vorname, m.familienname].filter(Boolean).join(' ') +
      (withTitles && m.titel_nach ? ', ' + m.titel_nach : '');
  }
  // Alter, das im aktuellen Kalenderjahr erreicht wird (unabhängig vom Tag der Abfrage)
  function ageThisYear(m) {
    if (!isValidISO(m.geburtsdatum)) return null;
    return currentYear() - Number(m.geburtsdatum.slice(0, 4));
  }
  function roundness(age) {
    if (age === null || age <= 0) return null;
    if (age % 10 === 0) return 'round';
    if (age % 5 === 0) return 'half';
    return null;
  }
  const isActive = (m) => !m.austrittsgrund;
  function byName(a, b) {
    return collator.compare(a.familienname || '', b.familienname || '') ||
      collator.compare(a.vorname || '', b.vorname || '') ||
      String(a.geburtsdatum || '').localeCompare(String(b.geburtsdatum || '')) ||
      a.id - b.id;
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const isAbort = (e) => e && (e.name === 'AbortError');

  // ================= Hinweise & Bestätigung =================
  function toast(text, type = 'ok', ms = 3500) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML = (type === 'err' ? I.alert : I.check) + '<span></span>';
    el.querySelector('span').textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function confirmDialog({ title = 'Bitte bestätigen', html = '', ok = 'OK', danger = false }) {
    const dlg = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').innerHTML = html;
    const yes = $('#confirm-yes');
    yes.textContent = ok;
    yes.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    $('#confirm-icon').className = 'confirm-icon' + (danger ? ' danger' : '');
    return new Promise((resolve) => {
      let result = false;
      const done = (val) => { result = val; dlg.close(); };
      const onYes = () => done(true);
      const onNo = () => done(false);
      yes.addEventListener('click', onYes);
      $('#confirm-no').addEventListener('click', onNo);
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        yes.removeEventListener('click', onYes);
        $('#confirm-no').removeEventListener('click', onNo);
        resolve(result);
      });
      dlg.showModal();
      $('#confirm-no').focus();
    });
  }

  // ================= IndexedDB: zuletzt verwendete Datei merken =================
  // Gespeichert wird nur der Datei-"Griff" (Handle), nicht der Inhalt der Datenbank.
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('mitgliederverwaltung', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function kv(mode, key, value) {
    try {
      const db = await idbOpen();
      const res = await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('kv');
        const req = mode === 'get' ? store.get(key) : mode === 'del' ? store.delete(key) : store.put(value, key);
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return res;
    } catch (e) {
      console.warn('IndexedDB nicht verfügbar:', e);
      return undefined;
    }
  }

  // ================= Datenbank =================
  function all(sql, params = []) {
    const st = state.db.prepare(sql);
    try {
      st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  }
  const run = (sql, params = []) => state.db.run(sql, params);
  function getMeta(key) { const r = all('SELECT value FROM meta WHERE key = ?', [key]); return r.length ? r[0].value : null; }
  function setMeta(key, value) { run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]); }

  function loadData() {
    state.members = all('SELECT * FROM mitglieder');
    state.fees = new Map();
    for (const f of all('SELECT mitglied_id, jahr, bezahlt FROM beitraege')) {
      if (!state.fees.has(f.mitglied_id)) state.fees.set(f.mitglied_id, new Map());
      state.fees.get(f.mitglied_id).set(f.jahr, f.bezahlt);
    }
  }
  const feePaid = (id, year) => state.fees.get(id)?.get(year) === 1;

  // Schreibt die komplette Datenbank in die lokale Datei. Aufrufe werden nacheinander ausgeführt.
  function persist() {
    state.pendingSaves++;
    setSaveStatus('busy');
    state.saveChain = state.saveChain.then(writeDbFile, writeDbFile).finally(() => { state.pendingSaves--; });
    return state.saveChain;
  }
  async function writeDbFile() {
    try {
      const bytes = state.db.export();
      const w = await state.handle.createWritable();
      await w.write(bytes);
      await w.close();
      if (state.pendingSaves <= 1) setSaveStatus('ok');
      $('#save-error').hidden = true;
      return true;
    } catch (e) {
      console.error(e);
      setSaveStatus('err');
      $('#save-error-text').textContent = '(' + (e.message || e) + ')';
      $('#save-error').hidden = false;
      return false;
    }
  }
  function setSaveStatus(s) {
    const el = $('#save-status');
    el.className = 'chip ' + ({ ok: 'chip-ok', busy: 'chip-busy', err: 'chip-err' }[s]);
    el.innerHTML = ({ ok: I.check, busy: I.loader, err: I.alert }[s]) +
      ' <span>' + ({ ok: 'Gespeichert', busy: 'Speichert …', err: 'Nicht gespeichert!' }[s]) + '</span>';
  }

  async function ensurePermission(handle) {
    if (!handle.queryPermission) return true;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  // Öffnet eine Datenbankdatei. createIfEmpty: leere Datei wird als neue Datenbank angelegt.
  async function openHandle(handle) {
    if (!(await ensurePermission(handle))) {
      toast('Ohne Zugriffserlaubnis kann die Datenbank nicht geöffnet werden.', 'err', 6000);
      return false;
    }
    const file = await handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let db = null;
    let tables = [];
    try {
      db = bytes.length ? new state.SQL.Database(bytes) : new state.SQL.Database();
      const res = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'");
      tables = res.length ? res[0].values.map((v) => v[0]) : [];
    } catch (e) {
      if (db) db.close();
      await confirmDialog({ title: 'Datei kann nicht geöffnet werden', html: `„${esc(file.name)}“ ist keine gültige Datenbankdatei.`, ok: 'OK' });
      return false;
    }
    if (bytes.length && !tables.includes('mitglieder')) {
      db.close();
      await confirmDialog({ title: 'Keine Mitgliederdatenbank', html: `Die Datei „${esc(file.name)}“ enthält keine Mitgliederdaten dieses Programms.`, ok: 'OK' });
      return false;
    }
    db.exec(window.SCHEMA_SQL);
    db.exec('PRAGMA foreign_keys = ON');
    if (state.db) state.db.close();
    state.db = db;
    state.handle = handle;
    const isNew = !bytes.length;
    if (!getMeta('schema_version')) setMeta('schema_version', '1');
    if (!getMeta('erstellt_am')) setMeta('erstellt_am', nowStamp());
    if (isNew) await persist();
    await kv('put', 'lastHandle', handle);
    showApp();
    return true;
  }

  // ================= Startbildschirm =================
  async function showStart() {
    $('#app').hidden = true;
    $('#start').hidden = false;
    const supported = 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
    $('#start-unsupported').hidden = supported;
    $('#start-actions').hidden = !supported;
    const recent = supported ? await kv('get', 'lastHandle') : null;
    $('#start-recent').hidden = !recent;
    if (recent) $('#recent-name').textContent = recent.name;
  }

  async function startOpenRecent() {
    const h = await kv('get', 'lastHandle');
    if (!h) return showStart();
    try { await openHandle(h); } catch (e) {
      console.error(e);
      toast('Die zuletzt verwendete Datei wurde nicht gefunden (verschoben oder umbenannt?). Bitte „Datenbank öffnen“ wählen.', 'err', 7000);
    }
  }
  async function startOpen() {
    try {
      const [h] = await window.showOpenFilePicker({ id: 'mv-db', types: DB_TYPES, multiple: false });
      await openHandle(h);
    } catch (e) { if (!isAbort(e)) { console.error(e); toast('Fehler beim Öffnen: ' + e.message, 'err', 6000); } }
  }
  async function startNew() {
    try {
      const h = await window.showSaveFilePicker({ id: 'mv-db', suggestedName: 'mitglieder.db', types: DB_TYPES, startIn: 'documents' });
      const f = await h.getFile();
      if (f.size > 0) {
        // Gewählte Datei existiert bereits: niemals stillschweigend überschreiben.
        const ok = await confirmDialog({
          title: 'Datei existiert bereits',
          html: `Die Datei „${esc(h.name)}“ ist bereits vorhanden. Soll diese <strong>vorhandene Datenbank geöffnet</strong> werden?<br><br>` +
            'Zum Anlegen einer neuen Datenbank wählen Sie bitte „Abbrechen“ und einen neuen Dateinamen.',
          ok: 'Vorhandene öffnen'
        });
        if (ok) await openHandle(h);
        return;
      }
      await openHandle(h);
      toast('Neue Datenbank angelegt: ' + h.name);
    } catch (e) { if (!isAbort(e)) { console.error(e); toast('Fehler: ' + e.message, 'err', 6000); } }
  }

  // ================= Hauptansicht =================
  function showApp() {
    $('#start').hidden = true;
    $('#app').hidden = false;
    $('#db-name').textContent = state.handle.name;
    setSaveStatus('ok');
    refresh();
  }

  function refresh() {
    loadData();
    renderMembers();
    renderBackupInfo();
    if ($('#dlg-list').open) renderList();
  }

  function activeSorted() {
    const list = state.members.filter(isActive).sort(byName);
    list.forEach((m, i) => { m._nr = i + 1; });
    return list;
  }

  function memberMatches(m, q) {
    const hay = fold([m.anrede, m.titel_vor, m.familienname, m.vorname, m.titel_nach, m.plz, m.stadt, m.adresse,
      m.anmerkung, fmtDate(m.geburtsdatum), fmtDate(m.beitrittsdatum)].join(' '));
    return q.split(/\s+/).every((part) => hay.includes(part));
  }

  function renderMembers() {
    const years = feeYears();
    years.forEach((y, i) => { $('#th-y' + i).textContent = y; });
    $('#year-current').textContent = years[1];
    const active = activeSorted();
    const q = fold(state.search.trim());
    const shown = q ? active.filter((m) => memberMatches(m, q)) : active;

    $('#count-active').textContent = active.length;
    $('#count-active-2').textContent = active.length;
    $('#count-paid').textContent = active.filter((m) => feePaid(m.id, years[1])).length;

    $('#members-body').innerHTML = shown.map((m) => `
      <tr class="clickable" data-id="${m.id}">
        <td class="col-nr">${m._nr}</td>
        <td>${esc(m.anrede)}</td>
        <td>${esc(m.titel_vor)}</td>
        <td class="name">${esc(m.familienname)}</td>
        <td>${esc(m.vorname)}</td>
        <td>${esc(m.titel_nach)}</td>
        <td>${fmtDate(m.geburtsdatum)}</td>
        <td>${esc(m.plz)}</td>
        <td class="cut" title="${esc(m.stadt)}">${esc(m.stadt)}</td>
        <td class="cut" title="${esc(m.adresse)}">${esc(m.adresse)}</td>
        <td>${fmtDate(m.beitrittsdatum)}</td>
        <td class="note" title="${esc(m.anmerkung)}">${esc(m.anmerkung)}</td>
        ${years.map((y, i) => `<td class="col-year${i === 1 ? ' col-year-current' : ''}">
          <input type="checkbox" class="fee" data-id="${m.id}" data-year="${y}" ${feePaid(m.id, y) ? 'checked' : ''}
            title="Mitgliedsbeitrag ${y}" aria-label="Mitgliedsbeitrag ${y} für ${esc(fullName(m, false))} bezahlt"></td>`).join('')}
        <td class="col-actions">
          <button class="icon-btn primary" data-edit="${m.id}" title="Bearbeiten" aria-label="Bearbeiten">${I.edit}</button>
          <button class="icon-btn danger" data-delete="${m.id}" title="Löschen" aria-label="Löschen">${I.trash}</button>
        </td>
      </tr>`).join('');

    const empty = $('#members-empty');
    empty.hidden = shown.length > 0;
    empty.textContent = active.length
      ? 'Keine Mitglieder gefunden, die zur Suche passen.'
      : 'Noch keine aktiven Mitglieder vorhanden. Legen Sie mit „Neues Mitglied“ das erste Mitglied an.';
  }

  function renderBackupInfo() {
    const last = getMeta('letzte_sicherung');
    $('#last-backup').textContent = last ? fmtStamp(last) : 'noch keine';
    const warn = daysSince(last) > BACKUP_WARN_DAYS;
    $('#backup-stat').classList.toggle('stat-warn', warn);
    $('#backup-stat').title = warn ? `Die letzte Sicherheitskopie ist älter als ${BACKUP_WARN_DAYS} Tage (oder fehlt). Bitte eine Sicherheitskopie erstellen.` : '';
  }

  // ================= Mitgliedsbeiträge =================
  async function onFeeClick(e) {
    const cb = e.target;
    const id = Number(cb.dataset.id);
    const year = Number(cb.dataset.year);
    const m = state.members.find((x) => x.id === id);
    if (!cb.checked) {
      // Abwählen nur nach Bestätigung
      e.preventDefault();
      const ok = await confirmDialog({
        title: 'Beitrag als nicht bezahlt markieren?',
        html: `Soll der Mitgliedsbeitrag <strong>${year}</strong> für <strong>${esc(fullName(m))}</strong> wirklich als <strong>nicht bezahlt</strong> markiert werden?`,
        ok: 'Ja, nicht bezahlt',
        danger: true
      });
      if (!ok) { cb.checked = true; return; }
      cb.checked = false;
      setFee(id, year, 0);
    } else {
      setFee(id, year, 1);
    }
  }
  function setFee(id, year, paid) {
    run(`INSERT INTO beitraege(mitglied_id, jahr, bezahlt, geaendert_am) VALUES(?, ?, ?, ?)
         ON CONFLICT(mitglied_id, jahr) DO UPDATE SET bezahlt = excluded.bezahlt, geaendert_am = excluded.geaendert_am`,
      [id, year, paid, nowStamp()]);
    if (!state.fees.has(id)) state.fees.set(id, new Map());
    state.fees.get(id).set(year, paid);
    const y = feeYears()[1];
    $('#count-paid').textContent = state.members.filter(isActive).filter((m) => feePaid(m.id, y)).length;
    persist();
  }

  // ================= Dialog: Mitglied anlegen / bearbeiten =================
  const FIELDS = ['anrede', 'titel_vor', 'familienname', 'vorname', 'titel_nach', 'geburtsdatum', 'plz', 'stadt',
    'adresse', 'beitrittsdatum', 'anmerkung', 'austrittsgrund', 'austrittsdatum', 'sterbedatum'];

  function openMember(m) {
    state.editing = m || null;
    const form = $('#form-member');
    form.reset();
    $$('.invalid', form).forEach((el) => el.classList.remove('invalid'));
    $('#member-errors').hidden = true;
    for (const f of FIELDS) form.elements[f].value = m ? (m[f] ?? '') : '';
    $('#member-title').textContent = m ? 'Mitglied bearbeiten: ' + fullName(m) : 'Neues Mitglied';
    $('#member-exit-section').hidden = !m;
    $('#btn-member-delete').hidden = !m;
    $('#btn-member-save').textContent = m ? 'Änderungen speichern' : 'Mitglied anlegen';
    updateExitFields();
    const fees = $('#member-fees');
    if (m) {
      const paid = Array.from(state.fees.get(m.id) || []).filter(([, v]) => v === 1).map(([y]) => y).sort();
      fees.hidden = false;
      fees.innerHTML = `<strong>Bezahlte Mitgliedsbeiträge:</strong> ${paid.length ? paid.join(', ') : 'keine'}` +
        (m.erstellt_am ? ` &nbsp;·&nbsp; angelegt am ${esc(fmtStamp(m.erstellt_am))}` : '') +
        (m.geaendert_am ? ` &nbsp;·&nbsp; zuletzt geändert am ${esc(fmtStamp(m.geaendert_am))}` : '');
    } else {
      fees.hidden = true;
    }
    $('#dlg-member').showModal();
    form.elements[m ? 'familienname' : 'anrede'].focus();
  }

  function updateExitFields() {
    const form = $('#form-member');
    const grund = form.elements.austrittsgrund.value;
    $('#field-sterbedatum').hidden = grund !== 'Verstorben';
  }

  function onExitChange(e) {
    const form = $('#form-member');
    const el = form.elements;
    if (e.target.name === 'austrittsgrund' || e.target.name === 'sterbedatum') {
      // Bei "Verstorben" wird das Austrittsdatum, falls leer, mit dem Sterbedatum befüllt
      if (el.austrittsgrund.value === 'Verstorben' && el.sterbedatum.value && !el.austrittsdatum.value) {
        el.austrittsdatum.value = el.sterbedatum.value;
      }
    }
    updateExitFields();
  }

  function validateMember(data) {
    const errors = [];
    const bad = new Set();
    const today = todayISO();
    if (!['Frau', 'Herr'].includes(data.anrede)) { errors.push('Bitte eine Anrede wählen.'); bad.add('anrede'); }
    if (!data.familienname) { errors.push('Bitte den Familiennamen eingeben.'); bad.add('familienname'); }
    if (!data.vorname) { errors.push('Bitte den Vornamen eingeben.'); bad.add('vorname'); }
    const labels = { geburtsdatum: 'Geburtsdatum', beitrittsdatum: 'Mitglied seit', austrittsdatum: 'Austrittsdatum', sterbedatum: 'Sterbedatum' };
    for (const f of Object.keys(labels)) {
      if (data[f] && !isValidISO(data[f])) { errors.push(`${labels[f]}: ungültiges Datum.`); bad.add(f); }
    }
    if (data.geburtsdatum && data.geburtsdatum > today) { errors.push('Das Geburtsdatum liegt in der Zukunft.'); bad.add('geburtsdatum'); }
    if (data.geburtsdatum && data.beitrittsdatum && data.beitrittsdatum < data.geburtsdatum) {
      errors.push('„Mitglied seit“ liegt vor dem Geburtsdatum.'); bad.add('beitrittsdatum');
    }
    if (data.sterbedatum) {
      if (data.sterbedatum > today) { errors.push('Das Sterbedatum liegt in der Zukunft.'); bad.add('sterbedatum'); }
      if (data.geburtsdatum && data.sterbedatum < data.geburtsdatum) { errors.push('Das Sterbedatum liegt vor dem Geburtsdatum.'); bad.add('sterbedatum'); }
    }
    if (data.austrittsdatum && !data.austrittsgrund) {
      errors.push('Bitte einen Austrittsgrund wählen (Austritt oder Verstorben) oder das Austrittsdatum leeren.'); bad.add('austrittsgrund');
    }
    if (data.austrittsgrund && !data.austrittsdatum) {
      errors.push(data.austrittsgrund === 'Verstorben' ? 'Bitte das Sterbedatum oder Austrittsdatum eintragen.' : 'Bitte das Austrittsdatum eintragen.');
      bad.add('austrittsdatum');
    }
    if (data.austrittsdatum && data.beitrittsdatum && data.austrittsdatum < data.beitrittsdatum) {
      errors.push('Das Austrittsdatum liegt vor „Mitglied seit“.'); bad.add('austrittsdatum');
    }
    return { errors, bad };
  }

  async function onMemberSubmit(e) {
    e.preventDefault();
    const form = $('#form-member');
    const data = {};
    for (const f of FIELDS) data[f] = clean(form.elements[f].value);
    if (!state.editing) { data.austrittsgrund = null; data.austrittsdatum = null; data.sterbedatum = null; }
    if (data.austrittsgrund !== 'Verstorben') data.sterbedatum = null;

    $$('.invalid', form).forEach((el) => el.classList.remove('invalid'));
    const { errors, bad } = validateMember(data);
    if (errors.length) {
      const box = $('#member-errors');
      box.innerHTML = '<strong>Bitte prüfen:</strong><ul>' + errors.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>';
      box.hidden = false;
      bad.forEach((f) => form.elements[f].classList.add('invalid'));
      form.elements[[...bad][0]]?.focus();
      $('.dialog-body', $('#dlg-member')).scrollTop = 0;
      return;
    }

    if (!state.editing) {
      const dup = state.members.find((m) => collator.compare(m.familienname, data.familienname) === 0 &&
        collator.compare(m.vorname, data.vorname) === 0 && (m.geburtsdatum || '') === (data.geburtsdatum || ''));
      if (dup) {
        const ok = await confirmDialog({
          title: 'Mögliches Duplikat',
          html: `Es gibt bereits ein Mitglied <strong>${esc(fullName(dup))}</strong>${dup.geburtsdatum ? ' (geb. ' + fmtDate(dup.geburtsdatum) + ')' : ''}` +
            `${isActive(dup) ? '' : ' unter „Ehemalige“'}. Trotzdem neu anlegen?`,
          ok: 'Trotzdem anlegen'
        });
        if (!ok) return;
      }
      run(`INSERT INTO mitglieder (anrede, titel_vor, familienname, vorname, titel_nach, geburtsdatum, plz, stadt, adresse,
             beitrittsdatum, anmerkung, erstellt_am, geaendert_am) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [data.anrede, data.titel_vor, data.familienname, data.vorname, data.titel_nach, data.geburtsdatum, data.plz,
          data.stadt, data.adresse, data.beitrittsdatum, data.anmerkung, nowStamp(), nowStamp()]);
      toast(`${fullName(data)} wurde angelegt.`);
    } else {
      const wasActive = isActive(state.editing);
      run(`UPDATE mitglieder SET anrede=?, titel_vor=?, familienname=?, vorname=?, titel_nach=?, geburtsdatum=?, plz=?, stadt=?,
             adresse=?, beitrittsdatum=?, anmerkung=?, austrittsgrund=?, austrittsdatum=?, sterbedatum=?, geaendert_am=? WHERE id=?`,
        [data.anrede, data.titel_vor, data.familienname, data.vorname, data.titel_nach, data.geburtsdatum, data.plz, data.stadt,
          data.adresse, data.beitrittsdatum, data.anmerkung, data.austrittsgrund, data.austrittsdatum, data.sterbedatum,
          nowStamp(), state.editing.id]);
      if (wasActive && data.austrittsgrund) toast(`${fullName(data)} ist jetzt unter „Ehemalige“ (${data.austrittsgrund}).`, 'ok', 5000);
      else if (!wasActive && !data.austrittsgrund) toast(`${fullName(data)} ist wieder aktives Mitglied.`);
      else toast('Änderungen gespeichert.');
    }
    $('#dlg-member').close();
    refresh();
    persist();
  }

  async function deleteMember(m) {
    const ok = await confirmDialog({
      title: 'Mitglied endgültig löschen?',
      html: `<strong>${esc(fullName(m))}</strong> wird mit allen Daten und Beitragszahlungen <strong>unwiderruflich gelöscht</strong>.<br><br>` +
        'Für einen normalen Austritt oder Todesfall löschen Sie bitte nicht, sondern tragen im Bearbeiten-Fenster einen Austrittsgrund ein. ' +
        'Dann bleiben die Daten unter „Ehemalige“ erhalten.',
      ok: 'Endgültig löschen',
      danger: true
    });
    if (!ok) return false;
    run('DELETE FROM beitraege WHERE mitglied_id = ?', [m.id]);
    run('DELETE FROM mitglieder WHERE id = ?', [m.id]);
    toast(`${fullName(m)} wurde gelöscht.`);
    refresh();
    persist();
    return true;
  }

  async function reactivateMember(m) {
    const ok = await confirmDialog({
      title: 'Wieder als aktives Mitglied aufnehmen?',
      html: `<strong>${esc(fullName(m))}</strong> wird wieder in die Liste der aktiven Mitglieder aufgenommen. ` +
        'Austrittsgrund, Austrittsdatum und Sterbedatum werden entfernt.',
      ok: 'Wieder aufnehmen'
    });
    if (!ok) return;
    run('UPDATE mitglieder SET austrittsgrund = NULL, austrittsdatum = NULL, sterbedatum = NULL, geaendert_am = ? WHERE id = ?', [nowStamp(), m.id]);
    toast(`${fullName(m)} ist wieder aktives Mitglied.`);
    refresh();
    persist();
  }

  // ================= Listen: Ehemalige / Verstorbene / Geburtstage =================
  function formerList() { return state.members.filter((m) => !isActive(m)).sort(byName); }
  function deceasedList() {
    return state.members.filter((m) => m.austrittsgrund === 'Verstorben').sort((a, b) =>
      String(b.sterbedatum || '').localeCompare(String(a.sterbedatum || '')) || byName(a, b));
  }
  function birthdaysByMonth() {
    const months = MONATE.map(() => []);
    for (const m of state.members.filter(isActive)) {
      if (!isValidISO(m.geburtsdatum)) continue;
      months[Number(m.geburtsdatum.slice(5, 7)) - 1].push(m);
    }
    months.forEach((list) => list.sort((a, b) => a.geburtsdatum.slice(8, 10).localeCompare(b.geburtsdatum.slice(8, 10)) || byName(a, b)));
    return months;
  }

  function openList(mode) {
    state.list.mode = mode;
    if (mode === 'geburtstage') state.list.month = new Date().getMonth();
    renderList();
    if (!$('#dlg-list').open) $('#dlg-list').showModal();
  }

  function renderList() {
    const mode = state.list.mode;
    const year = currentYear();
    const head = $('#list-head');
    const body = $('#list-body');
    const tabs = $('#list-tabs');
    tabs.hidden = mode !== 'geburtstage';
    $('#list-legend').hidden = mode !== 'geburtstage';
    let rows = [];
    let emptyText = '';
    let info = '';

    if (mode === 'ehemalige') {
      $('#list-title').textContent = 'Ehemalige Mitglieder';
      const list = formerList();
      head.innerHTML = '<tr><th class="col-nr">Nr.</th><th>Anrede</th><th>Titel vorne</th><th>Familienname</th><th>Vorname</th><th>Titel hinten</th>' +
        '<th>Geb.-Datum</th><th>Mitglied seit</th><th>Austrittsgrund</th><th>Austrittsdatum</th><th>Sterbedatum</th><th class="col-actions"></th></tr>';
      rows = list.map((m, i) => `<tr data-id="${m.id}">
        <td class="col-nr">${i + 1}</td><td>${esc(m.anrede)}</td><td>${esc(m.titel_vor)}</td><td class="name">${esc(m.familienname)}</td>
        <td>${esc(m.vorname)}</td><td>${esc(m.titel_nach)}</td><td>${fmtDate(m.geburtsdatum)}</td><td>${fmtDate(m.beitrittsdatum)}</td>
        <td><span class="badge ${m.austrittsgrund === 'Verstorben' ? 'badge-dark' : 'badge-gray'}">${esc(m.austrittsgrund)}</span></td>
        <td>${fmtDate(m.austrittsdatum)}</td><td>${fmtDate(m.sterbedatum)}</td>
        <td class="col-actions" style="width:120px">
          <button class="icon-btn primary" data-list-edit="${m.id}" title="Bearbeiten" aria-label="Bearbeiten">${I.edit}</button>
          <button class="icon-btn primary" data-list-reactivate="${m.id}" title="Wieder aufnehmen" aria-label="Wieder aufnehmen">${I.undo}</button>
          <button class="icon-btn danger" data-list-delete="${m.id}" title="Endgültig löschen" aria-label="Löschen">${I.trash}</button>
        </td></tr>`);
      emptyText = 'Es gibt keine ehemaligen Mitglieder.';
      info = `${list.length} ehemalige Mitglieder (davon ${list.filter((m) => m.austrittsgrund === 'Verstorben').length} verstorben)`;
    } else if (mode === 'verstorbene') {
      $('#list-title').textContent = 'Verstorbene Mitglieder';
      const list = deceasedList();
      head.innerHTML = '<tr><th class="col-nr">Nr.</th><th>Anrede</th><th>Vorname</th><th>Familienname</th><th>Geburtsdatum</th><th>Sterbedatum</th></tr>';
      rows = list.map((m, i) => `<tr class="clickable" data-list-edit-row="${m.id}">
        <td class="col-nr">${i + 1}</td><td>${esc(m.anrede)}</td><td>${esc(m.vorname)}</td><td class="name">${esc(m.familienname)}</td>
        <td>${fmtDate(m.geburtsdatum)}</td><td>${fmtDate(m.sterbedatum)}</td></tr>`);
      emptyText = 'Es sind keine verstorbenen Mitglieder eingetragen.';
      info = `${list.length} verstorbene Mitglieder · sortiert nach Sterbedatum (neueste zuerst)`;
    } else if (mode === 'geburtstage') {
      $('#list-title').textContent = `Geburtstage ${year}`;
      const months = birthdaysByMonth();
      tabs.innerHTML = MONATE.map((name, i) => {
        const hasRound = months[i].some((m) => roundness(ageThisYear(m)));
        return `<button class="tab${i === state.list.month ? ' active' : ''}" data-month="${i}">${name}` +
          `${hasRound ? '<i class="dot" title="mit rundem/halbrundem Geburtstag"></i>' : ''}<span class="count">${months[i].length}</span></button>`;
      }).join('');
      const list = months[state.list.month];
      head.innerHTML = `<tr><th class="num">Tag</th><th>Anrede</th><th>Titel vorne</th><th>Vorname</th><th>Familienname</th><th>Titel hinten</th>` +
        `<th>Geburtsdatum</th><th class="num">Alter ${year}</th><th>Ort</th></tr>`;
      rows = list.map((m) => {
        const age = ageThisYear(m);
        const r = roundness(age);
        return `<tr class="${r ? 'bday-' + r : ''}">
          <td class="num">${Number(m.geburtsdatum.slice(8, 10))}.</td><td>${esc(m.anrede)}</td><td>${esc(m.titel_vor)}</td><td>${esc(m.vorname)}</td>
          <td class="name">${esc(m.familienname)}</td><td>${esc(m.titel_nach)}</td><td>${fmtDate(m.geburtsdatum)}</td>
          <td class="num"><span class="badge badge-age">${age}</span></td><td class="cut">${esc([m.plz, m.stadt].filter(Boolean).join(' '))}</td></tr>`;
      });
      emptyText = `Im ${MONATE[state.list.month]} hat kein aktives Mitglied Geburtstag.`;
      const without = state.members.filter(isActive).filter((m) => !isValidISO(m.geburtsdatum)).length;
      info = `Nur aktive Mitglieder · Alter = ${year} − Geburtsjahr` + (without ? ` · ${without} aktive Mitglieder ohne Geburtsdatum` : '');
    }

    body.innerHTML = rows.join('');
    $('#list-empty').hidden = rows.length > 0;
    $('#list-empty').textContent = emptyText;
    $('#list-info').textContent = info;
    $('#btn-list-export').innerHTML = I.excel + (mode === 'geburtstage' ? ` Excel-Mappe ${year} (alle Monate) speichern` : ' Als Excel speichern');
  }

  // ================= Excel-Exporte =================
  async function saveFile(bytes, suggestedName, types, id) {
    try {
      const h = await window.showSaveFilePicker({ id, suggestedName, types, startIn: 'documents' });
      if (state.handle && h.isSameEntry && (await h.isSameEntry(state.handle))) {
        toast('Bitte nicht die geöffnete Datenbankdatei auswählen, sondern einen anderen Dateinamen.', 'err', 6000);
        return null;
      }
      const w = await h.createWritable();
      await w.write(bytes);
      await w.close();
      return h;
    } catch (e) {
      if (!isAbort(e)) { console.error(e); toast('Speichern fehlgeschlagen: ' + e.message, 'err', 6000); }
      return null;
    }
  }

  const C = (header, width, type = 'text') => ({ header, width, type });

  function exportMembers() {
    const years = feeYears();
    const list = activeSorted();
    const sheet = {
      name: 'Mitglieder',
      title: 'Mitgliederliste',
      subtitle: `Stand: ${fmtDate(todayISO())} · ${list.length} aktive Mitglieder`,
      columns: [C('Nr.', 6, 'number'), C('Anrede', 8), C('Titel vorangestellt', 12), C('Familienname', 18), C('Vorname', 15),
        C('Titel nachgestellt', 12), C('Geburtsdatum', 13, 'date'), C('PLZ', 7), C('Stadt', 24), C('Adresse', 26),
        C('Mitglied seit', 13, 'date'), C('Anmerkung', 30),
        ...years.map((y) => C(`Beitrag ${y}`, 11))],
      rows: list.map((m) => ({
        cells: [m._nr, m.anrede, m.titel_vor, m.familienname, m.vorname, m.titel_nach, m.geburtsdatum, m.plz, m.stadt, m.adresse,
          m.beitrittsdatum, m.anmerkung, ...years.map((y) => (feePaid(m.id, y) ? 'bezahlt' : 'offen'))]
      }))
    };
    return saveExport([sheet], `Mitgliederliste_${todayISO()}.xlsx`);
  }

  function exportBirthdays() {
    const year = currentYear();
    const months = birthdaysByMonth();
    const sheets = MONATE.map((name, i) => ({
      name,
      title: `Geburtstage ${name} ${year}`,
      subtitle: `Alter = Alter, das im Jahr ${year} erreicht wird · dunkelgelb = runder, hellgelb = halbrunder Geburtstag · nur aktive Mitglieder`,
      emptyText: `Im ${name} hat kein aktives Mitglied Geburtstag.`,
      columns: [C('Tag', 6, 'number'), C('Anrede', 8), C('Titel vorangestellt', 12), C('Vorname', 15), C('Familienname', 18),
        C('Titel nachgestellt', 12), C('Geburtsdatum', 13, 'date'), C(`Alter ${year}`, 10, 'number'), C('Runder Geburtstag', 16),
        C('PLZ', 7), C('Stadt', 24), C('Adresse', 26)],
      rows: months[i].map((m) => {
        const age = ageThisYear(m);
        const r = roundness(age);
        return {
          style: r,
          cells: [Number(m.geburtsdatum.slice(8, 10)), m.anrede, m.titel_vor, m.vorname, m.familienname, m.titel_nach,
            m.geburtsdatum, age, r === 'round' ? `rund (${age})` : r === 'half' ? `halbrund (${age})` : '', m.plz, m.stadt, m.adresse]
        };
      })
    }));
    return saveExport(sheets, `Geburtstage_${year}.xlsx`);
  }

  function exportDeceased() {
    const list = deceasedList();
    return saveExport([{
      name: 'Verstorbene',
      title: 'Verstorbene Mitglieder',
      subtitle: `Stand: ${fmtDate(todayISO())} · ${list.length} Einträge`,
      columns: [C('Nr.', 6, 'number'), C('Anrede', 8), C('Vorname', 15), C('Familienname', 18), C('Geburtsdatum', 13, 'date'), C('Sterbedatum', 13, 'date')],
      rows: list.map((m, i) => ({ cells: [i + 1, m.anrede, m.vorname, m.familienname, m.geburtsdatum, m.sterbedatum] }))
    }], `Verstorbene_${todayISO()}.xlsx`);
  }

  function exportFormer() {
    const list = formerList();
    return saveExport([{
      name: 'Ehemalige',
      title: 'Ehemalige Mitglieder',
      subtitle: `Stand: ${fmtDate(todayISO())} · ${list.length} Einträge`,
      columns: [C('Nr.', 6, 'number'), C('Anrede', 8), C('Titel vorangestellt', 12), C('Familienname', 18), C('Vorname', 15),
        C('Titel nachgestellt', 12), C('Geburtsdatum', 13, 'date'), C('PLZ', 7), C('Stadt', 24), C('Adresse', 26),
        C('Mitglied seit', 13, 'date'), C('Austrittsgrund', 13), C('Austrittsdatum', 13, 'date'), C('Sterbedatum', 12, 'date'), C('Anmerkung', 30)],
      rows: list.map((m, i) => ({
        cells: [i + 1, m.anrede, m.titel_vor, m.familienname, m.vorname, m.titel_nach, m.geburtsdatum, m.plz, m.stadt, m.adresse,
          m.beitrittsdatum, m.austrittsgrund, m.austrittsdatum, m.sterbedatum, m.anmerkung]
      }))
    }], `Ehemalige_${todayISO()}.xlsx`);
  }

  async function saveExport(sheets, name) {
    const bytes = window.XlsxWriter.build(sheets);
    const h = await saveFile(bytes, name, XLSX_TYPES, 'mv-export');
    if (h) toast('Excel-Datei gespeichert: ' + h.name);
  }

  // ================= Sicherheitskopie =================
  async function backup() {
    await state.saveChain; // erst alle offenen Änderungen in die Hauptdatei schreiben
    const d = new Date();
    const name = `mitglieder_sicherung_${todayISO()}_${pad(d.getHours())}${pad(d.getMinutes())}.db`;
    const bytes = state.db.export();
    const h = await saveFile(bytes, name, DB_TYPES, 'mv-backup');
    if (!h) return;
    setMeta('letzte_sicherung', nowStamp());
    renderBackupInfo();
    await persist();
    toast('Sicherheitskopie gespeichert: ' + h.name, 'ok', 5000);
  }

  async function switchDb() {
    await state.saveChain;
    if (state.db) { state.db.close(); state.db = null; }
    state.handle = null;
    state.search = '';
    $('#search').value = '';
    showStart();
  }

  // ================= Ereignisse =================
  function bindEvents() {
    $('#btn-open').addEventListener('click', startOpen);
    $('#btn-new-db').addEventListener('click', startNew);
    $('#btn-open-recent').addEventListener('click', startOpenRecent);
    $('#btn-retry-save').addEventListener('click', () => persist());

    document.addEventListener('click', (e) => {
      const close = e.target.closest('[data-close]');
      if (close) { close.closest('dialog').close(); return; }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      ({
        neu: () => openMember(null),
        ehemalige: () => openList('ehemalige'),
        verstorbene: () => openList('verstorbene'),
        geburtstage: () => openList('geburtstage'),
        export: exportMembers,
        sicherung: backup,
        wechseln: switchDb
      })[action]?.();
    });

    const body = $('#members-body');
    body.addEventListener('click', (e) => {
      if (e.target.classList.contains('fee')) { onFeeClick(e); return; }
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-delete]');
      const find = (id) => state.members.find((m) => m.id === Number(id));
      if (edit) openMember(find(edit.dataset.edit));
      else if (del) deleteMember(find(del.dataset.delete));
    });
    body.addEventListener('dblclick', (e) => {
      if (e.target.closest('.fee, button')) return;
      const tr = e.target.closest('tr[data-id]');
      if (tr) openMember(state.members.find((m) => m.id === Number(tr.dataset.id)));
    });

    let searchTimer = null;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = e.target.value; renderMembers(); }, 120);
    });

    const form = $('#form-member');
    form.addEventListener('submit', onMemberSubmit);
    form.elements.austrittsgrund.addEventListener('change', onExitChange);
    form.elements.sterbedatum.addEventListener('change', onExitChange);
    $('#btn-member-delete').addEventListener('click', async () => {
      if (state.editing && (await deleteMember(state.editing))) $('#dlg-member').close();
    });

    $('#dlg-list').addEventListener('click', (e) => {
      const find = (id) => state.members.find((m) => m.id === Number(id));
      const tab = e.target.closest('[data-month]');
      if (tab) { state.list.month = Number(tab.dataset.month); renderList(); return; }
      const t = e.target.closest('[data-list-edit], [data-list-reactivate], [data-list-delete], [data-list-edit-row]');
      if (!t) return;
      if (t.dataset.listEdit) openMember(find(t.dataset.listEdit));
      else if (t.dataset.listEditRow) openMember(find(t.dataset.listEditRow));
      else if (t.dataset.listReactivate) reactivateMember(find(t.dataset.listReactivate));
      else if (t.dataset.listDelete) deleteMember(find(t.dataset.listDelete));
    });
    $('#btn-list-export').addEventListener('click', () => {
      ({ ehemalige: exportFormer, verstorbene: exportDeceased, geburtstage: exportBirthdays })[state.list.mode]?.();
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.pendingSaves > 0) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ================= Start =================
  try {
    state.SQL = await window.initSqlJs({ wasmBinary: b64ToBytes(window.SQL_WASM_B64).buffer });
  } catch (e) {
    console.error(e);
    document.body.innerHTML = '<div style="padding:40px;font:16px system-ui">Die Datenbank-Komponente konnte nicht geladen werden. ' +
      'Bitte die Datei mit Google Chrome öffnen.<br><small>' + esc(e.message) + '</small></div>';
    return;
  }
  bindEvents();
  await showStart();
  window.__mv = { state, refresh }; // für automatisierte Tests
})();
