// Offline regression tests: no real candidate records or Telegram requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/sync.ts'), 'utf8');
const ast = ts.createSourceFile('sync.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ensureRepushSourceSynced');
const code = ts.transpileModule(fn.getText(ast).replace(/^export /, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const item = { id: 'legacy-source', column: 'a', candidateCode: 'TEST00170', candidateName: 'Example',
  resumeUrl: 'https://example.invalid/resume.pdf', fileName: 'Example.pdf', uploadedAt: '2026-09-08', feedback: 'pending' };
async function scenario({ snapshots, status = 200, readError, writeError }) {
  const writes = [];
  let readIndex = 0;
  const context = vm.createContext({
    parse: raw => raw ? JSON.parse(raw) : null,
    readKeys: async () => {
      if (readError) throw new Error(readError);
      const snapshot = snapshots[Math.min(readIndex++, snapshots.length - 1)];
      return { repush: JSON.stringify(snapshot.rows), tombstones: JSON.stringify(snapshot.tombstones || {}) };
    },
    crypto: { randomUUID: () => 'test-mutation-id' }, AbortSignal,
    fetch: async (url, options) => {
      assert.equal(url, '/api/sync/records');
      writes.push(JSON.parse(options.body));
      if (writeError) throw new Error(writeError);
      return { ok: status === 200, status, json: async () => ({ error: '保存被拒绝' }) };
    },
  });
  vm.runInContext(code, context);
  let error;
  try { await context.ensureRepushSourceSynced(item); } catch (e) { error = e.message; }
  return { writes, error };
}
(async () => {
  const existing = await scenario({ snapshots: [{ rows: [{ ...item, feedback: 'done' }] }] });
  assert.equal(existing.error, undefined); assert.equal(existing.writes.length, 0);
  const restored = await scenario({ snapshots: [{ rows: [] }, { rows: [item] }] });
  assert.equal(restored.error, undefined);
  assert.deepEqual(restored.writes[0].changes, [{ id: item.id, before: null, after: item }]);
  assert.equal(restored.writes[0].resolution, undefined);
  const deleted = await scenario({ snapshots: [{ rows: [], tombstones: { repush: { [item.id]: 1 } } }] });
  assert.match(deleted.error, /已被删除/); assert.equal(deleted.writes.length, 0);
  const corrupt = await scenario({ snapshots: [{ rows: null }] });
  assert.match(corrupt.error, /读取失败/); assert.equal(corrupt.writes.length, 0);
  const outage = await scenario({ readError: 'offline' });
  assert.equal(outage.error, 'offline'); assert.equal(outage.writes.length, 0);
  const denied = await scenario({ snapshots: [{ rows: [] }], status: 403 });
  assert.equal(denied.error, '保存被拒绝');
  const vanished = await scenario({ snapshots: [{ rows: [] }] });
  assert.match(vanished.error, /尚未同步成功/);
  const raced = await scenario({ snapshots: [{ rows: [] }, { rows: [item] }], status: 409 });
  assert.equal(raced.error, undefined);
  const concurrentDelete = await scenario({ snapshots: [{ rows: [] }, { rows: [], tombstones: { repush: { [item.id]: 1 } } }], status: 409 });
  assert.match(concurrentDelete.error, /已被删除/);
  const timeout = await scenario({ snapshots: [{ rows: [] }], writeError: 'timeout' });
  assert.equal(timeout.error, 'timeout');
  console.log('PASS: 10 repush source synchronization regressions');
})().catch(error => { console.error(error); process.exitCode = 1; });
