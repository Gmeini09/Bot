'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const discord = require('discord.js');
const realSource = path.join(__dirname, '..', 'index.js');
function evaluate(source, dir, enabled) {
  class OfflineClient extends discord.Client { login() { return Promise.resolve('offline-test'); } }
  const sandbox = {
    require(name) {
      if (name === 'discord.js') return { ...discord, Client: OfflineClient };
      if (name === 'http') return { createServer: () => ({ listen() {} }) };
      if (name === './stream') return { createIntegration: args => require('./index').createIntegration({ ...args, env: { STREAM_ENABLED: enabled ? 'true' : 'false' } }) };
      return require(name);
    },
    process: { env: { DISCORD_TOKEN: 'offline-test-only', DATA_DIR: dir }, exit() { throw new Error('unexpected exit'); }, on() {}, uptime: () => 0 },
    console: { log() {}, warn() {}, error() {} }, __dirname: dir, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox, { timeout: 15000 });
  return JSON.parse(vm.runInContext('JSON.stringify(buildCommands())', sandbox));
}
test('production source changes are limited to five integration hooks; existing command JSON unchanged', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unfug-preservation-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const updated = fs.readFileSync(realSource, 'utf8').replace(/\r\n/g,'\n');
  const original = updated
    .replace('    if (streamIntegration.handleHttp(req, res)) return;\n', '')
    .replace('  streamIntegration.start();\n', '')
    .replace('const commands = [...buildCommands(), ...streamIntegration.commands()];', 'const commands = buildCommands();')
    .replace('    if (await streamIntegration.handleInteraction(interaction)) return;\n', '')
    .replace("const streamIntegration = require('./stream').createIntegration({ client, storageDir, canManage: canSetup });\n", '');
  // Pinned upstream hash verifies preservation, independent of the modified implementation.
  const crypto = require('node:crypto');
  const normalizedOriginal = original.replace(/\n+$/, '\n');
  const expected = 'e06c1b8080ca89aa11014b0f3ba3f02faf103165d448eb6c622afecd9a1ab6c1';
  assert.equal(crypto.createHash('sha256').update(normalizedOriginal).digest('hex'), expected);
  const before = evaluate(original, dir, false); const after = evaluate(updated, dir, true);
  assert.deepEqual(after, before);
  const allNames = [...after, ...require('./index').commands()].map(c => c.name);
  assert.equal(new Set(allNames).size, allNames.length); assert.ok(allNames.length <= 100);
  console.log('Preserved '+before.length+' existing command definitions; '+allNames.length+' total with stream commands.');
});
