// Baut die fertige, eigenständige Datei "Mitgliederverwaltung.html".
// Alle Bestandteile (Design, Programmcode, SQLite als WebAssembly) werden in die
// HTML-Datei eingebettet, damit nichts aus dem Internet geladen werden muss.
//
// Aufruf: node tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const SQLJS = 'vendor/sql.js-1.13.0';

// Symbole für die HTML-Platzhalter <!--ICON:name--> auflösen
const iconsJs = read('src/icons.js');
const sandbox = {};
vm.runInNewContext(iconsJs, { window: sandbox, globalThis: sandbox });
const ICONS = sandbox.ICONS;

function inlineScript(code, label) {
  if (/<\/script/i.test(code)) throw new Error(`"</script" in ${label} gefunden – kann nicht eingebettet werden`);
  return `<script>/* ${label} */\n${code}\n</script>`;
}

let html = read('src/index.html');
html = html.replace(/<!--ICON:([A-Za-z]+)-->/g, (_, name) => {
  if (!ICONS[name]) throw new Error('Unbekanntes Symbol: ' + name);
  return ICONS[name];
});

const wasm = readFileSync(join(root, SQLJS, 'sql-wasm.wasm'));
const scripts = [
  inlineScript(read(`${SQLJS}/sql-wasm.js`), 'sql.js 1.13.0 (MIT-Lizenz) – SQLite als WebAssembly'),
  inlineScript(`window.SQL_WASM_B64 = "${wasm.toString('base64')}";`, 'sql-wasm.wasm (Base64)'),
  inlineScript(`window.SCHEMA_SQL = ${JSON.stringify(read('src/schema.sql'))};`, 'Datenbankstruktur'),
  inlineScript(iconsJs, 'Symbole'),
  inlineScript(read('src/xlsx.js'), 'Excel-Export'),
  inlineScript(read('src/app.js'), 'Programmlogik')
].join('\n');

html = html
  .replace('<!--STYLE-->', () => `<style>\n${read('src/style.css')}\n</style>`)
  .replace('<!--SCRIPTS-->', () => scripts);

// Sicherheitsprüfung: Die fertige Datei darf nichts aus dem Netz nachladen.
if (/<!--ICON:/.test(html)) throw new Error('Nicht ersetzter Symbol-Platzhalter gefunden');
const external = html.match(/\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//gi);
if (external) throw new Error('Externe Verweise gefunden: ' + external.join(', '));
if (!html.includes("connect-src 'none'")) throw new Error('Content-Security-Policy fehlt');

const out = join(root, 'Mitgliederverwaltung.html');
writeFileSync(out, html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
const sha = createHash('sha256').update(html).digest('hex').slice(0, 16);
console.log(`Mitgliederverwaltung.html erstellt (${kb} KB, sha256 ${sha}…)`);
