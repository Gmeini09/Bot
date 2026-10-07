// Builds the SP Tool files exactly as the live bot loads them (Railway variables SPTOOL_RUNTIME_*): the start command
// writes each variable into sptool-license/ next to config/db/discord/security.mjs from the repo root of "main" –
// there is no tiers.cjs there, so the shared rules are inlined into every file.
//   node sptool-license/runtime-bundle.mjs <outDir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'runtime-out');
mkdirSync(out, { recursive: true });
// comments and blank lines are left out of the inlined copy (each variable has a size limit)
const tiersSrc = readFileSync(join(here, 'tiers.cjs'), 'utf8').replace(/^'use strict';\n/, '')
  .replace(/\/\*\*[\s\S]*?\*\//g, '').split('\n').filter((l) => l.trim() && !/^\s*\/\//.test(l)).join('\n');
const inline = `const tiers = (() => { const module = { exports: {} }; ${tiersSrc}\nreturn module.exports; })(); // inlined from tiers.cjs`;
const ESM = /^import tiers from '\.\/tiers\.cjs';$/m;
const CJS = /^const tiers = require\(fs\.existsSync\(path\.join\(__dirname, 'tiers\.cjs'\)\) \? '\.\/tiers\.cjs' : '\.\.\/tiers\.cjs'\);$/m;
const MAX = 30000; // per Railway variable (keys-panel is spread over three)
const files = {
  SPTOOL_RUNTIME_SERVICE_MJS: ['service.mjs', ESM],
  SPTOOL_RUNTIME_APP_MJS: ['app.mjs', ESM],
  SPTOOL_RUNTIME_CLOUD_JS: ['cloud-sync.js', CJS],
  SPTOOL_RUNTIME_KEYS_JS: ['keys-panel.js', CJS],
};
const report = {};
for (const [variable, [file, re]] of Object.entries(files)) {
  const src = readFileSync(join(here, file), 'utf8');
  if (!re.test(src)) throw new Error(`${file}: tiers import not found`);
  const text = src.replace(re, () => inline).replace(/\n+$/, ''); // the variables hold the file without a trailing newline
  writeFileSync(join(out, file), text);
  if (variable === 'SPTOOL_RUNTIME_KEYS_JS') {
    // split between two non-blank characters, so no part starts or ends with whitespace (values may be trimmed)
    const parts = [];
    let rest = text;
    while (rest.length > MAX) {
      let i = MAX;
      while (i > 1 && (/\s/.test(rest[i - 1]) || /\s/.test(rest[i]))) i--;
      parts.push(rest.slice(0, i)); rest = rest.slice(i);
    }
    parts.push(rest);
    if (parts.length > 3) throw new Error(`keys-panel.js needs ${parts.length} variables, the start command reads 3`);
    ['SPTOOL_RUNTIME_KEYS_JS', 'SPTOOL_RUNTIME_KEYS2_JS', 'SPTOOL_RUNTIME_KEYS3_JS'].forEach((v, i) => { writeFileSync(join(out, `${v}.txt`), parts[i] ?? ''); report[v] = (parts[i] ?? '').length; });
  } else {
    if (text.length > MAX) throw new Error(`${file} is ${text.length} characters – too long for one variable`);
    writeFileSync(join(out, `${variable}.txt`), text);
    report[variable] = text.length;
  }
}
console.log(JSON.stringify(report));
