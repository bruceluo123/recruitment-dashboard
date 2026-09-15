// Real projection code with in-memory storage only. No production writes or TG sends.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const A = 'recruit:tg-delivery-projection-pending', B = A + '-b';
function load(file, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error('Unexpected import: ' + name);
  }, Date, console }, { filename: file });
  return module.exports;
}
const changes = load('src/lib/record-changes.ts', {});
function task(id = 'task-a', owner = 'a', count = 1) {
  const createdAt = '2026-09-15T01:00:00.000Z';
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `${id}:jd-${index}`, applicationId: `${id}:jd-${index}`, column: owner,
    candidateName: 'Example Candidate', candidateCode: 'CODE', candidateIdentityId: 'identity',
    jdId: `jd-${index}`, fileName: 'Example-Job', resumeFileName: 'Resume.pdf',
    resumeUrl: 'https://example.invalid/resume.pdf', rawText: 'Original text', highlights: 'Skills',
    deliveryId: id, deliveryIndex: index, deliveryStatus: 'queued', deliveryUpdatedAt: createdAt,
    feedback: 'pending', interviewStatus: 'none', uploadedAt: createdAt, updatedAt: createdAt,
  }));
  return { id, sender: owner, status: 'sent', createdAt, updatedAt: '2026-09-15T02:00:00.000Z', businessRecords: rows,
    applications: rows.map((row, index) => ({ index, applicationId: row.id, jdId: row.jdId })),
    deliveries: rows.map((_, index) => ({ status: 'sent', messageId: String(100 + index), sentAt: '2026-09-15T02:00:00.000Z' })) };
}
function harness({ tasks = [], records = [], tombstones = {}, pendingA, pendingB, race, readFailure = false, writeFailure = false } = {}) {
  const db = new Map([
    ['recruit:repush', JSON.stringify(records)], ['recruit:tombstones', JSON.stringify({ repush: tombstones })],
    [A, JSON.stringify(pendingA || tasks.filter(row => row.sender !== 'b').map(row => row.id))],
    [B, JSON.stringify(pendingB || tasks.filter(row => row.sender === 'b').map(row => row.id))],
    ...tasks.map(row => ['recruit:tg-delivery:' + row.id, JSON.stringify(row)]),
  ]);
  const calls = [], transactions = [];
  const storage = {
    kvCommandStrict: async (command, ...keys) => {
      calls.push(keys);
      assert.equal(command, 'MGET');
      if (readFailure) throw new Error('Offline');
      return keys.map(key => db.get(key) ?? null);
    },
    kvTransaction: async payload => {
      transactions.push(payload);
      if (race) { const run = race; race = null; run(db); }
      if (writeFailure) throw new Error('Offline');
      if (payload.expected.some(check => db.has(check.key) !== check.exists
        || (check.exists && db.get(check.key) !== check.value))) return { ok: false };
      for (const write of payload.writes) db.set(write.key, write.value);
      for (const operation of payload.lists) db.set(operation.key,
        JSON.stringify(JSON.parse(db.get(operation.key) || '[]').filter(id => id !== operation.value)));
      for (const key of payload.increments) db.set(key, String(Number(db.get(key) || 0) + 1));
      return { ok: true };
    },
  };
  const projection = load('src/lib/tg-delivery-projection.ts', {
    'server-only': {}, '@/lib/kv-server': storage, '@/lib/record-changes': changes,
  });
  return { db, calls, transactions, projection, run: projection.projectTgDeliveryRecords,
    records: () => JSON.parse(db.get('recruit:repush')), pending: key => JSON.parse(db.get(key) || '[]') };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('chat intake before delivery receipt is linked without duplicate applications', async () => {
    const job = task('race', 'b', 2);
    const imported = job.businessRecords.map((row, index) => ({ ...row, id: `import-${index}`,
      applicationId: `import-${index}`, deliveryId: undefined, telegramSourceKey: `chat:${100 + index}`,
      telegramMessageId: String(100 + index), feedback: 'done' }));
    const h = harness({ tasks: [job], records: imported }); await h.run();
    assert.equal(h.records().length, 2);
    h.records().forEach((row, index) => {
      assert.equal(row.id, `import-${index}`); assert.equal(row.feedback, 'done');
      assert.equal(row.deliveryId, job.id); assert.equal(row.deliveryIndex, index);
      assert.equal(row.applicationId, job.businessRecords[index].applicationId);
      assert.equal(row.deliveryStatus, 'sent');
    });
  });
  await test('new task recommendations become durable with complete identity, attachment and text', async () => {
    const job = task('multi', 'a', 3), h = harness({ tasks: [job] });
    const result = await h.run();
    assert.equal(result.committed, true);
    assert.equal(h.records().length, 3);
    h.records().forEach((row, index) => {
      assert.equal(row.candidateIdentityId, 'identity'); assert.equal(row.resumeUrl, job.businessRecords[index].resumeUrl);
      assert.equal(row.rawText, 'Original text'); assert.equal(row.deliveryStatus, 'sent');
      assert.equal(row.telegramMessageId, String(100 + index)); assert.equal(row.feedback, 'pending');
    });
    assert.equal(h.pending(A).length, 0);
    assert.equal(h.db.get('recruit:version'), '1');
  });
  await test('existing manual fields are preserved while delivery-only status changes', async () => {
    const job = task(), original = { ...job.businessRecords[0], candidateName: 'Manual name', rawText: 'Manual text',
      resumeUrl: 'https://example.invalid/new.pdf', resumeFileName: 'new.pdf', feedback: 'done',
      interviewStatus: 'scheduled', offerAppliedAt: '2026-09-15', contact: 'Manual contact', updatedAt: '2026-09-15T03:00:00.000Z' };
    const h = harness({ tasks: [job], records: [original] }); await h.run();
    const row = h.records()[0];
    for (const field of ['candidateName', 'rawText', 'resumeUrl', 'resumeFileName', 'feedback', 'interviewStatus', 'offerAppliedAt', 'contact', 'updatedAt']) {
      assert.equal(row[field], original[field], field);
    }
    assert.equal(row.deliveryStatus, 'sent');
  });
  await test('tombstones prevent deleted business records from being restored', async () => {
    const job = task(), h = harness({ tasks: [job], tombstones: { [job.businessRecords[0].id]: 100 } });
    await h.run(); assert.equal(h.records().length, 0); assert.equal(h.pending(A).length, 0);
  });
  await test('legacy task updates existing mappings but never fabricates missing business records', async () => {
    const job = task('legacy', 'a', 2), original = job.businessRecords[0]; delete job.businessRecords;
    const h = harness({ tasks: [job], records: [original] }); await h.run();
    assert.equal(h.records().length, 1); assert.equal(h.records()[0].telegramMessageId, '100');
  });
  await test('both owners project a bounded ten tasks without dropping backlog', async () => {
    const jobs = Array.from({ length: 12 }, (_, i) => task('a-' + i)).concat(Array.from({ length: 12 }, (_, i) => task('b-' + i, 'b')));
    const h = harness({ tasks: jobs }); await h.run();
    assert.equal(h.records().length, 20); assert.equal(h.pending(A).length, 2); assert.equal(h.pending(B).length, 2);
    assert.equal(h.transactions.length, 1);
    assert.ok(!h.transactions[0].expected.some(item => item.key === A || item.key === B));
  });
  await test('concurrent manual edit fails CAS and retains dirty tasks for another pass', async () => {
    const job = task(), original = job.businessRecords[0];
    const h = harness({ tasks: [job], records: [original], race: db => db.set('recruit:repush', JSON.stringify([{ ...original, feedback: 'done' }])) });
    assert.equal((await h.run()).committed, false);
    assert.equal(h.records()[0].feedback, 'done'); assert.deepEqual(h.pending(A), [job.id]);
  });
  await test('concurrent newer task checkpoint is not removed from the projection queue', async () => {
    const job = task();
    const h = harness({ tasks: [job], race: db => db.set('recruit:tg-delivery:' + job.id, JSON.stringify({ ...job, updatedAt: '2026-09-15T04:00:00.000Z' })) });
    assert.equal((await h.run()).committed, false); assert.equal(h.records().length, 0); assert.equal(h.pending(A).length, 1);
  });
  await test('concurrent unrelated dirty append does not block current projection', async () => {
    const job = task();
    const h = harness({ tasks: [job], race: db => db.set(A, JSON.stringify([job.id, 'unrelated'])) });
    assert.equal((await h.run()).committed, true); assert.deepEqual(h.pending(A), ['unrelated']);
  });
  await test('newer failed or queued checkpoints never undo confirmed sent business status', async () => {
    const job = task(); job.status = 'failed'; job.deliveries[0] = { status: 'failed', error: 'Later network error' };
    const row = { ...job.businessRecords[0], deliveryStatus: 'sent', telegramMessageId: 'confirmed', deliveredAt: job.createdAt };
    const h = harness({ tasks: [job], records: [row] }); await h.run();
    assert.equal(h.records()[0].deliveryStatus, 'sent'); assert.equal(h.records()[0].telegramMessageId, 'confirmed');
  });
  await test('older queued checkpoint cannot overwrite newer sending state', async () => {
    const job = task(); job.status = 'queued'; job.deliveries[0] = { status: 'pending' };
    const row = { ...job.businessRecords[0], deliveryStatus: 'sending', deliveryUpdatedAt: '2026-09-15T03:00:00.000Z' };
    const h = harness({ tasks: [job], records: [row] }); await h.run();
    assert.equal(h.records()[0].deliveryStatus, 'sending');
  });
  await test('missing and corrupt task IDs are safely removed under their own CAS', async () => {
    const h = harness({ pendingA: ['missing', 'corrupt'] }); h.db.set('recruit:tg-delivery:corrupt', '{');
    assert.equal((await h.run()).consumed, 2); assert.equal(h.pending(A).length, 0); assert.equal(h.records().length, 0);
    assert.ok(h.transactions[0].expected.some(item => item.key.endsWith(':missing') && !item.exists));
  });
  await test('wrong account or malformed legacy mappings cannot mutate other recommendations', async () => {
    const job = task('wrong', 'b'); job.applications = [{}];
    const manual = { id: 'manual', column: 'a', deliveryStatus: 'queued', feedback: 'done' };
    const h = harness({ tasks: [job], records: [manual], pendingA: [job.id], pendingB: [] }); await h.run();
    assert.deepEqual(h.records(), [manual]);
  });
  await test('projection failure keeps dirty entries and allows retry', async () => {
    const job = task(), h = harness({ tasks: [job], writeFailure: true });
    await assert.rejects(h.run(), /Offline/); assert.equal(h.pending(A).length, 1);
  });
  await test('concurrent requests reuse one projection operation per process', async () => {
    const h = harness({ tasks: [task()] });
    const first = h.run(), second = h.run(); assert.equal(first, second);
    await first; assert.equal(h.transactions.length, 1);
  });
  await test('sync/read responds without waiting for platform-managed projection', async () => {
    const managed = []; let resolveProjection;
    const pending = new Promise(resolve => { resolveProjection = resolve; });
    const api = load('src/app/api/sync/read/route.ts', {
      'next/server': { NextResponse: { json: (data, options) => ({ data, status: options?.status || 200 }) } },
      '@/lib/kv-server': { kvCommandStrict: async () => ['7'] },
      '@/lib/auth-api': { permittedOwners: async () => ['a'], requireApiSession: async () => null },
      '@/lib/data-ownership': { filterAccessibleRecords: (_, rows) => rows },
      'next/dist/server/lib/builtin-request-context': { getBuiltinRequestContext: () => ({ waitUntil: promise => managed.push(promise) }) },
      '@/lib/tg-delivery-projection': { projectTgDeliveryRecords: () => pending },
    });
    const result = await api.GET({ nextUrl: new URL('https://example.invalid/api/sync/read?key=version') });
    assert.equal(result.status, 200); assert.equal(result.data.values.version, '7'); assert.equal(managed.length, 1);
    resolveProjection({ committed: true }); await managed[0];
  });
  await test('projection failure never converts a successful cloud read to an error', async () => {
    const api = load('src/app/api/sync/read/route.ts', {
      'next/server': { NextResponse: { json: (data, options) => ({ data, status: options?.status || 200 }) } },
      '@/lib/kv-server': { kvCommandStrict: async () => ['[]'] },
      '@/lib/auth-api': { permittedOwners: async () => ['a'], requireApiSession: async () => null },
      '@/lib/data-ownership': { filterAccessibleRecords: (_, rows) => rows },
      'next/dist/server/lib/builtin-request-context': { getBuiltinRequestContext: () => undefined },
      '@/lib/tg-delivery-projection': { projectTgDeliveryRecords: async () => { throw new Error('Projection offline'); } },
    });
    const result = await api.GET({ nextUrl: new URL('https://example.invalid/api/sync/read?key=repush') });
    assert.equal(result.status, 200); assert.equal(result.data.values.repush, '[]');
  });
  console.log(`Passed ${passed} delivery projection regressions.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
