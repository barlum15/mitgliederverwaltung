/*
 * Minimaler XLSX-Schreiber (Excel 2007+), komplett lokal, ohne externe Bibliothek.
 * Erzeugt eine ZIP-Datei (unkomprimiert) mit den nötigen Office-Open-XML-Teilen.
 *
 * Verwendung:
 *   const bytes = XlsxWriter.build([
 *     { name: 'Blatt 1', title: 'Überschrift', subtitle: 'Zeile 2',
 *       columns: [{ header: 'Name', width: 20, type: 'text' | 'date' | 'number' }],
 *       rows: [{ cells: ['Huber'], style: null | 'round' | 'half' }],
 *       emptyText: 'Keine Einträge' }
 *   ]);
 */
(function (global) {
  'use strict';

  // ---------- Hilfsfunktionen ----------
  const enc = new TextEncoder();

  function xmlEscape(value) {
    return String(value)
      // Steuerzeichen sind in XML nicht erlaubt
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colName(index) { // 0 -> A, 25 -> Z, 26 -> AA
    let s = '';
    let n = index + 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // 'JJJJ-MM-TT' -> Excel-Seriennummer (Tage seit 30.12.1899)
  function isoToSerial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    const utc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000);
  }

  function sheetNameSafe(name) {
    return String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Tabelle';
  }

  // ---------- Formatvorlagen (styles.xml) ----------
  // Varianten: 0 = normal, 1 = runder Geburtstag, 2 = halbrunder Geburtstag
  // Typen:     0 = Text,   1 = Datum,             2 = Zahl
  // Index = 2 + Variante * 3 + Typ; 0 = Standard, 1 = Kopfzeile, 11 = Titel, 12 = Untertitel
  const TYPE_INDEX = { text: 0, date: 1, number: 2 };
  const VARIANT_INDEX = { round: 1, half: 2 };
  function styleIndex(variant, type) {
    return 2 + (VARIANT_INDEX[variant] || 0) * 3 + (TYPE_INDEX[type] || 0);
  }

  function stylesXml() {
    const fills = [
      '<fill><patternFill patternType="none"/></fill>',
      '<fill><patternFill patternType="gray125"/></fill>',
      '<fill><patternFill patternType="solid"><fgColor rgb="FF0E7490"/><bgColor indexed="64"/></patternFill></fill>', // Kopfzeile
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFCD34D"/><bgColor indexed="64"/></patternFill></fill>', // rund
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>'  // halbrund
    ];
    const fonts = [
      '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>',
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
      '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>',
      '<font><b/><sz val="14"/><color rgb="FF0E7490"/><name val="Calibri"/><family val="2"/></font>',
      '<font><i/><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/><family val="2"/></font>'
    ];
    const borders = [
      '<border><left/><right/><top/><bottom/><diagonal/></border>',
      '<border><left style="thin"><color rgb="FFD9DEE7"/></left><right style="thin"><color rgb="FFD9DEE7"/></right>' +
        '<top style="thin"><color rgb="FFD9DEE7"/></top><bottom style="thin"><color rgb="FFD9DEE7"/></bottom><diagonal/></border>'
    ];
    const xf = (numFmt, font, fill, border, extra) =>
      `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"` +
      (numFmt ? ' applyNumberFormat="1"' : '') + (font ? ' applyFont="1"' : '') +
      (fill ? ' applyFill="1"' : '') + (border ? ' applyBorder="1"' : '') +
      (extra ? ' applyAlignment="1">' + extra + '</xf>' : '/>');
    const top = '<alignment vertical="top" wrapText="1"/>';
    const cellXfs = [
      xf(0, 0, 0, 0),                                  // 0 Standard
      xf(0, 1, 2, 1, '<alignment vertical="center" wrapText="1"/>') // 1 Kopfzeile
    ];
    const variants = [[0, 0], [2, 3], [2, 4]]; // [Schrift, Füllung] je Variante
    for (const [font, fill] of variants) {
      cellXfs.push(xf(0, font, fill, 1, top));   // Text
      cellXfs.push(xf(164, font, fill, 1, top)); // Datum
      cellXfs.push(xf(1, font, fill, 1, top));   // Zahl
    }
    cellXfs.push(xf(0, 3, 0, 0)); // 11 Titel
    cellXfs.push(xf(0, 4, 0, 0)); // 12 Untertitel

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy;@"/></numFmts>' +
      `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
      `<fills count="${fills.length}">${fills.join('')}</fills>` +
      `<borders count="${borders.length}">${borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  // ---------- Arbeitsblatt ----------
  function cellXml(ref, value, type, style) {
    if (value === null || value === undefined || value === '') {
      return `<c r="${ref}" s="${style}"/>`;
    }
    if (type === 'date') {
      const serial = isoToSerial(value);
      if (serial !== null) return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
    }
    if (type === 'number' && typeof value === 'number' && isFinite(value)) {
      return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }

  function sheetXml(sheet) {
    const cols = sheet.columns;
    const lastCol = colName(cols.length - 1);
    const rowsXml = [];
    let r = 1;
    if (sheet.title) {
      rowsXml.push(`<row r="${r}" ht="22" customHeight="1">${cellXml('A' + r, sheet.title, 'text', 11)}</row>`);
      r++;
      if (sheet.subtitle) {
        rowsXml.push(`<row r="${r}">${cellXml('A' + r, sheet.subtitle, 'text', 12)}</row>`);
        r++;
      }
      r++; // Leerzeile
    }
    const headerRow = r;
    rowsXml.push(`<row r="${r}" ht="32" customHeight="1">` +
      cols.map((c, i) => cellXml(colName(i) + r, c.header, 'text', 1)).join('') + '</row>');
    r++;
    if (!sheet.rows.length && sheet.emptyText) {
      rowsXml.push(`<row r="${r}">${cellXml('A' + r, sheet.emptyText, 'text', 12)}</row>`);
      r++;
    }
    for (const row of sheet.rows) {
      rowsXml.push(`<row r="${r}">` + cols.map((c, i) =>
        cellXml(colName(i) + r, row.cells[i], c.type, styleIndex(row.style, c.type))).join('') + '</row>');
      r++;
    }
    const lastDataRow = Math.max(headerRow, r - 1);
    const colsXml = '<cols>' + cols.map((c, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('') + '</cols>';
    const pane = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>`;
    const filter = sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${lastDataRow}"/>` : '';
    sheet._filter = sheet.rows.length ? `$A$${headerRow}:$${lastCol}$${lastDataRow}` : null;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' + colsXml +
      `<sheetData>${rowsXml.join('')}</sheetData>` + filter +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      '</worksheet>';
  }

  // ---------- ZIP (Methode "stored", ohne Kompression) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(files) { // files: [{ name, data: Uint8Array }]
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8-Dateinamen
      local.setUint16(8, 0, true);      // stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, f.data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, dosTime, true);
      cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, size, true);
      cen.setUint32(24, size, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + size;
    }
    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
    let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  // ---------- Arbeitsmappe ----------
  function build(sheets) {
    const used = new Set();
    const names = sheets.map((s) => {
      let n = sheetNameSafe(s.name);
      let i = 2;
      while (used.has(n.toLowerCase())) n = sheetNameSafe(s.name).slice(0, 28) + ' ' + i++;
      used.add(n.toLowerCase());
      return n;
    });
    const files = [];
    const add = (name, text) => files.push({ name, data: enc.encode(text) });
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

    add('[Content_Types].xml', head +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>');
    add('_rels/.rels', head +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');
    const sheetXmls = sheets.map((s) => sheetXml(s)); // setzt s._filter
    const defined = sheets.map((s, i) => s._filter
      ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEscape(names[i].replace(/'/g, "''"))}'!${s._filter}</definedName>`
      : '').join('');
    add('xl/workbook.xml', head +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets>' +
      (defined ? `<definedNames>${defined}</definedNames>` : '') +
      '</workbook>');
    add('xl/_rels/workbook.xml.rels', head +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>');
    add('xl/styles.xml', stylesXml());
    sheetXmls.forEach((x, i) => add(`xl/worksheets/sheet${i + 1}.xml`, x));
    return zip(files);
  }

  global.XlsxWriter = { build, isoToSerial, _crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
