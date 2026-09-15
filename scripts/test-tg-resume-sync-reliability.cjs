// Offline regressions for inbound Telegram resume collection. No Telegram,
// blob storage or production database calls are made by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const sourcePath = path.join(__dirname, 'tg-sync-resumes.mjs');
let source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^#!.*\r?\n/, '')
  .replace(/^import .*;\r?\n/gm, '');
source = source.slice(0, source.indexOf('\nasync function main()'));

const db = new Map();
const context = vm.createContext({
  console,
  Buffer,
  Date,
  URL,
  setTimeout,
  clearTimeout,
  createHash,
  process: {
    argv: ['node', 'offline-test'],
    cwd: () => path.resolve(__dirname, '..'),
    env: { SUPABASE_URL: 'https://storage.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline' },
  },
  fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('recruit_kv_read')) {
      return { ok: true, status: 200, json: async () => Object.fromEntries(body.p_keys.filter(key => db.has(key)).map(key => [key, db.get(key)])) };
    }
    if (url.endsWith('recruit_kv_tx')) {
      const tx = body.p_payload;
      const valid = (tx.expected || []).every(item => db.has(item.key) === item.exists
        && (!item.exists || !('value' in item) || db.get(item.key) === item.value));
      if (!valid) return { ok: true, status: 200, json: async () => ({ ok: false }) };
      for (const item of tx.writes || []) db.set(item.key, item.value);
      for (const key of tx.increments || []) db.set(key, String(Number(db.get(key) || 0) + 1));
      return { ok: true, status: 200, json: async () => ({ ok: true, increments: { 'recruit:version': 1 } }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  },
});
vm.runInContext(`${source}\nglobalThis.testApi = { findNearbyCodeMessage, recordImportedIdentity, supabaseImportCommit };`, context);
const api = context.testApi;

const directCode = { id: 100, date: 1000, message: '候选人编码：XYBB00123' };
const adjacentResume = { id: 101, date: 1001, message: '' };
assert.equal(api.findNearbyCodeMessage([directCode, adjacentResume], adjacentResume).id, 100);

const interveningChat = { id: 101, date: 1001, message: '仅用于查重' };
const detachedResume = { id: 102, date: 1002, message: '' };
assert.equal(api.findNearbyCodeMessage([directCode, interveningChat, detachedResume], detachedResume), null);

const identities = new Map();
api.recordImportedIdentity(identities, 'xybb00123', 'talent-1', '同一人', false);
api.recordImportedIdentity(identities, 'XYBB00123', 'talent-1', '同一人', true);
assert.equal(identities.get('XYBB00123').allowRepair, true);

(async () => {
  const snapshot = '[]';
  const stateKey = 'recruit:candidate-code:state:v1:b';
  db.set('snapshot', snapshot);
  db.set(stateKey, JSON.stringify({ sequence: 123, entries: { XYBB00123: { identity: 'wrong-id', name: '错误姓名' } } }));
  db.set('sequence', '123');
  const keys = ['snapshot', 'recruit:version', 'used', 'sequence', 'identities:b', 'identity-names:b'];
  const baseArgs = ['1', createHash('sha1').update(snapshot).digest('hex'), '[{"ok":true}]'];
  assert.deepEqual(Array.from(await api.supabaseImportCommit(keys, [...baseArgs, JSON.stringify([['XYBB00123', '123', 'talent-1', '正确姓名', '0']])])), [-1, 'XYBB00123']);
  const repaired = await api.supabaseImportCommit(keys, [...baseArgs, JSON.stringify([['XYBB00123', '123', 'talent-1', '正确姓名', '1']])]);
  assert.equal(Number(repaired[0]), 1);
  const state = JSON.parse(db.get(stateKey));
  assert.deepEqual(state.entries.XYBB00123, { identity: 'talent-1', name: '正确姓名' });
  console.log('Passed 4 TG resume sync reliability regressions.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
