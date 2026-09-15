// Offline regression: exercise the actual send route with an atomic in-memory store.
// No real candidate data, network requests, or Telegram sends.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
function load(relative, mocks) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in mocks)) throw new Error('Unexpected import: ' + name);
    return mocks[name];
  }, crypto: { randomUUID }, Date, URL, console });
  return exports;
}
function fixture(suffix = 'one', owner = 'a') {
  const source = { id: 'source-' + suffix, column: owner, candidateName: 'Example' + suffix,
    candidateCode: 'TEST' + suffix, fileName: 'Example' + suffix + '.pdf',
    resumeFileName: 'Example' + suffix + '.pdf', resumeUrl: 'https://example.invalid/' + suffix + '.pdf',
    uploadedAt: '2026-09-08T10:00:00.000Z', feedback: 'done' };
  return { requestId: 'request-' + suffix, sender: owner, target: '@test', fileUrl: source.resumeUrl,
    sourceSnapshot: source, deliveries: [{ text: 'Recommendation ' + suffix, fileName: source.fileName,
      application: { jdId: 'job-one', jdTitle: 'Test job', candidateName: source.candidateName,
        candidateCode: source.candidateCode, resumeFileName: source.resumeFileName,
        source: 'repush', repushSourceId: source.id } }] };
}
function harness({ rows = [], deleted = {}, online = true, allowed = ['a', 'b'], race, lost = false, readFailures = 0, writeFailures = 0, lookupFails = false } = {}) {
  const db = new Map([
    ['recruit:repush', JSON.stringify(rows)], ['recruit:tombstones', JSON.stringify({ repush: deleted })],
    ['recruit:tg-delivery-worker-heartbeat', JSON.stringify({ at: online ? new Date().toISOString() : '2000-01-01' })],
    ['recruit:tg-delivery-worker-heartbeat-b', JSON.stringify({ at: online ? new Date().toISOString() : '2000-01-01' })],
  ]);
  const queued = [];
  const readKeys = [];
  let reads = 0, transactions = 0;
  const api = load('src/app/api/tg/send/route.ts', {
    'next/server': { NextResponse: { json: (data, options) => ({ data: clone(data), status: options?.status || 200 }) } },
    '@vercel/blob': { del: async () => { throw new Error('Unexpected file cleanup'); } },
    '@/lib/api-guard': { guardApi: () => null, blobUrlError: url => url.startsWith('https://example.invalid/') ? '' : 'Invalid URL' },
    '@/lib/auth-api': { requireApiSession: async () => null,
      requireOwnerSession: async (_, owner) => allowed.includes(owner) ? null : { status: 403 } },
    '@/lib/kv-server': {
      kvCommandStrict: async (command, ...keys) => {
        reads++;
        readKeys.push(keys);
        if (readFailures-- > 0) throw new Error('Transient read failure');
        if (command === 'MGET') return keys.map(key => db.get(key) ?? null);
        if (command === 'GET') return db.get(keys[0]) ?? null;
        throw new Error('Unexpected command ' + command);
      },
      kvFindRepushRecords: async args => {
        reads++;
        if (lookupFails) throw new Error('History lookup timed out');
        const records = JSON.parse(db.get('recruit:repush') || '[]');
        return records.filter(row => row.column === args.column
          && (args.sourceIds.includes(row.id) || args.resumeUrls.includes(row.resumeUrl)));
      },
      kvTransaction: async payload => {
        transactions++;
        if (writeFailures-- > 0) throw new Error('Transient write failure');
        if (race) { const hook = race; race = null; hook(db); }
        for (const expected of payload.expected || []) {
          if (db.has(expected.key) !== expected.exists
            || expected.value !== undefined && db.get(expected.key) !== expected.value) return { ok: false };
        }
        for (const write of payload.writes || []) db.set(write.key, write.value);
        for (const operation of payload.lists || []) queued.push(operation);
        if (lost) { lost = false; throw new Error('Response lost after commit'); }
        return { ok: true };
      },
    },
  });
  return { db, queued, readKeys, post: body => api.POST({ json: async () => clone(body) }),
    get: (ids, receipt = false) => api.GET({ nextUrl: new URL('https://example.invalid/api/tg/send?'
      + (receipt ? 'receipt=1&' : '') + ids.map(id => 'ids=' + id).join('&')) }),
    getSingle: id => api.GET({ nextUrl: new URL('https://example.invalid/api/tg/send?id=' + id) }),
    counts: () => ({ reads, transactions }) };
}
let passed = 0;
function enqueueHarness(respond) {
  const source = fs.readFileSync(path.join(root, 'src/components/recommendation-center/RepushModal.tsx'), 'utf8');
  const start = source.indexOf('  const enqueueDelivery =');
  const end = source.indexOf('  const handleSendAndRepush', start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end) + '\nexports.enqueue = enqueueDelivery;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {}, calls = [];
  vm.runInNewContext(code, { exports, AbortController, AbortSignal, window: { setTimeout, clearTimeout },
    wait: async () => {}, setSendProgress: () => {}, encodeURIComponent,
    fetch: async (url, options) => { calls.push({ url, options }); return respond(url, options, calls.length); } });
  return { enqueue: exports.enqueue, calls };
}
async function test(name, run) { await run(); console.log('PASS ' + name); passed++; }
function bulkHarness(respond) {
  const source = fs.readFileSync(path.join(root, 'src/components/recommendation-center/BulkRepushModal.tsx'), 'utf8');
  const start = source.indexOf('  const handleSend =');
  const end = source.indexOf('  const allSent', start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end) + '\nexports.send = handleSend;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {}, calls = [], states = {}, errors = [], stored = new Map();
  const candidates = ['one', 'two', 'three', 'four'].map(key => ({ key, item: fixture(key, 'b').sourceSnapshot }));
  let closed = false;
  vm.runInNewContext(code, { exports, AbortSignal, selectedJd: { id: 'job-one' }, remainingCandidates: candidates,
    recipient: '@test', owner: 'b', sending: false, crypto: { randomUUID },
    setSending: () => {}, setError: error => errors.push(error),
    payloadFor: candidate => { const payload = fixture(candidate.key, 'b'); delete payload.requestId; return payload; },
    storageKeyFor: async payload => payload.fileUrl,
    window: { localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } },
    syncResponse: () => {}, updateCandidateState: (key, value) => { states[key] = value; },
    onClose: () => { closed = true; }, wait: async () => {}, encodeURIComponent,
    fetch: async (url, options) => { calls.push({ url, options }); return respond(url, options, calls); } });
  return { send: exports.send, calls, states, errors, closed: () => closed };
}
(async () => {
  await test('10 candidates use one read and one atomic commit', async () => {
    const h = harness(), jobs = Array.from({ length: 10 }, (_, i) => fixture('batch' + i));
    const response = await h.post({ sender: 'a', batch: jobs });
    assert.equal(response.data.results.filter(row => row.ok).length, 10);
    assert.deepEqual(h.counts(), { reads: 1, transactions: 1 });
    assert.equal(h.queued.length, 10);
    const stored = JSON.parse(h.db.get('recruit:repush'));
    assert.equal(stored.length, 20);
    assert.deepEqual(stored.find(row => row.id === jobs[0].sourceSnapshot.id), jobs[0].sourceSnapshot);
  });
  await test('same request is never enqueued twice, including a lost response', async () => {
    const h = harness({ lost: true }), job = fixture();
    assert.equal((await h.post(job)).data.ok, true);
    assert.equal((await h.post(job)).data.ok, true);
    assert.equal(h.queued.length, 1);
  });
  await test('cloud source wins over stale local snapshot', async () => {
    const job = fixture(), cloud = { ...job.sourceSnapshot, feedback: 'pending' };
    const h = harness({ rows: [cloud] });
    assert.equal((await h.post(job)).data.ok, true);
    assert.deepEqual(JSON.parse(h.db.get('recruit:repush'))[0], cloud);
  });
  await test('bound resume may use a Chinese name, role title, or generic filename', async () => {
    for (const fileName of ['张三-开发工程师.pdf', '高级工程师简历.pdf', 'resume_2026.pdf']) {
      const job = fixture();
      job.sourceSnapshot.candidateName = 'Example English';
      job.sourceSnapshot.resumeFileName = fileName;
      Object.assign(job.deliveries[0].application, { candidateName: 'Example English', resumeFileName: fileName });
      const h = harness({ rows: [job.sourceSnapshot] });
      assert.equal((await h.post(job)).data.ok, true);
      assert.equal(h.queued.length, 1);
      const stored = JSON.parse(h.db.get('recruit:repush')).find(row => row.deliveryId === job.requestId);
      assert.equal(stored.resumeUrl, job.sourceSnapshot.resumeUrl);
      assert.equal(stored.resumeFileName, fileName);
    }
  });
  await test('matching filenames cannot bypass a wrong candidate code or identity', async () => {
    for (const field of ['candidateCode', 'candidateIdentityId']) {
      const job = fixture();
      job.sourceSnapshot.candidateIdentityId = 'identity-original';
      job.deliveries[0].application.candidateIdentityId = 'identity-original';
      job.deliveries[0].application[field] = 'someone-else';
      const h = harness({ rows: [job.sourceSnapshot] });
      const result = await h.post(job);
      assert.equal(result.data.ok, false);
      assert.match(result.data.error, /人选资料/);
      assert.equal(h.queued.length, 0);
    }
  });
  await test('a changed attachment URL remains blocked', async () => {
      const job = fixture();
      const current = { ...job.sourceSnapshot, resumeUrl: 'https://example.invalid/new.pdf' };
      const h = harness({ rows: [current] });
      const result = await h.post(job);
      assert.equal(result.data.ok, false);
      assert.match(result.data.error, /简历附件与原推荐记录不同/);
      assert.equal(h.queued.length, 0);
  });
  await test('matching stable identity permits an updated name or alias', async () => {
    for (const field of ['candidateCode', 'candidateIdentityId']) {
      const job = fixture();
      delete job.sourceSnapshot.candidateCode;
      delete job.deliveries[0].application.candidateCode;
      job.sourceSnapshot[field] = 'stable-id';
      job.deliveries[0].application[field] = 'stable-id';
      const current = { ...job.sourceSnapshot, candidateName: '中文别名' };
      const h = harness({ rows: [current] });
      assert.equal((await h.post(job)).data.ok, true);
      assert.equal(h.queued.length, 1);
      assert.deepEqual(JSON.parse(h.db.get('recruit:repush'))[0], current);
    }
  });
  await test('different names without a matching stable identity remain blocked', async () => {
    const job = fixture();
    delete job.deliveries[0].application.candidateCode;
    job.deliveries[0].application.candidateName = 'Someone Else';
    const h = harness({ rows: [job.sourceSnapshot] });
    assert.match((await h.post(job)).data.error, /人选资料/);
    assert.equal(h.queued.length, 0);
  });
  await test('renaming the same attachment does not block delivery or overwrite the source', async () => {
    const job = fixture();
    const current = { ...job.sourceSnapshot, resumeFileName: 'new-name.pdf' };
    const h = harness({ rows: [current] });
    assert.equal((await h.post(job)).data.ok, true);
    assert.equal(h.queued.length, 1);
    assert.deepEqual(JSON.parse(h.db.get('recruit:repush'))[0], current);
  });
  await test('deleted source cannot be resurrected', async () => {
    const job = fixture(), h = harness({ deleted: { [job.sourceSnapshot.id]: 1 } });
    assert.match((await h.post(job)).data.error, /已被删除/);
    assert.equal(h.queued.length, 0); assert.equal(h.counts().transactions, 0);
  });
  await test('a concurrent deletion blocks restoration and enqueue together', async () => {
    const job = fixture(), h = harness({ race: db => db.set('recruit:tombstones', JSON.stringify({ repush: { [job.sourceSnapshot.id]: 1 } })) });
    assert.match((await h.post(job)).data.error, /已被删除/);
    assert.equal(h.queued.length, 0);
    assert.equal(JSON.parse(h.db.get('recruit:repush')).length, 0);
  });
  await test('wrong file, wrong owner, and missing source are rejected', async () => {
    for (const variant of ['file', 'owner', 'missing']) {
      const job = fixture(), h = harness();
      if (variant === 'file') job.fileUrl = 'https://example.invalid/wrong.pdf';
      if (variant === 'owner') job.sourceSnapshot.column = 'b';
      if (variant === 'missing') delete job.sourceSnapshot;
      assert.equal((await h.post(job)).data.ok, false);
      assert.equal(h.queued.length, 0);
      assert.equal(JSON.parse(h.db.get('recruit:repush')).length, 0);
    }
  });
  await test('valid batch items commit while invalid ones remain unqueued', async () => {
    const h = harness(), bad = fixture('bad'); delete bad.sourceSnapshot;
    const response = await h.post({ sender: 'a', batch: [fixture('good'), bad] });
    assert.deepEqual(response.data.results.map(row => row.ok), [true, false]);
    assert.equal(h.queued.length, 1);
  });
  await test('only failed deliveries are requeued; receipt-backed success stays sent', async () => {
    const h = harness(), job = fixture();
    job.deliveries.push({ ...clone(job.deliveries[0]), application: { ...job.deliveries[0].application, jdId: 'job-two' } });
    await h.post(job);
    const key = 'recruit:tg-delivery:' + job.requestId;
    const task = JSON.parse(h.db.get(key)); task.status = 'failed';
    task.deliveries.forEach(row => { row.status = 'failed'; });
    h.db.set(key, JSON.stringify(task));
    const rows = JSON.parse(h.db.get('recruit:repush'));
    const receipt = rows.find(row => row.deliveryIndex === 0);
    receipt.telegramMessageId = '123'; receipt.deliveryStatus = 'sent';
    h.db.set('recruit:repush', JSON.stringify(rows));
    const response = await h.post({ ...job, retryIfFailed: true });
    assert.equal(response.data.sent, 1);
    assert.deepEqual(response.data.deliveries.map(row => row.status), ['sent', 'pending']);
    await h.post({ ...job, retryIfFailed: true });
    assert.equal(h.queued.length, 2);
  });
  await test('offline worker never commits source or queued records', async () => {
    const h = harness({ online: false });
    assert.match((await h.post(fixture())).data.error, /离线/);
    assert.equal(h.counts().transactions, 0);
  });
  await test('batch status reads only task receipts and matching business records', async () => {
    const h = harness({ allowed: ['a'] });
    await h.post(fixture());
    const before = h.counts().reads;
    const result = await h.get(['request-one']);
    assert.equal(result.data.results[0].status, 'queued');
    assert.equal(h.counts().reads - before, 2);
    assert.deepEqual(h.readKeys.at(-1), ['recruit:tg-delivery:request-one']);
    h.db.set('recruit:tg-delivery:request-other', JSON.stringify({ id: 'request-other', sender: 'b' }));
    const denied = await h.get(['request-other']);
    assert.equal(denied.data.results[0].ok, false);
    assert.equal(denied.data.results[0].records, undefined);
  });
  await test('duplicate IDs and cross-account batches fail before database access', async () => {
    const h = harness(), job = fixture();
    assert.equal((await h.post({ sender: 'a', batch: [job, job] })).status, 400);
    assert.equal((await h.post({ sender: 'a', batch: [fixture('other', 'b')] })).status, 400);
    assert.equal(h.counts().reads, 0);
  });
  await test('transient storage reads and writes recover without duplicate queue items', async () => {
    for (const options of [{ readFailures: 1 }, { writeFailures: 1 }, { readFailures: 1, writeFailures: 1 }]) {
      const h = harness(options);
      assert.equal((await h.post(fixture())).data.ok, true);
      assert.equal(h.queued.length, 1);
    }
  });
  await test('persistent storage failure stays an error and never enqueues', async () => {
    const h = harness({ writeFailures: 10 });
    assert.equal((await h.post(fixture())).status, 503);
    assert.equal(h.queued.length, 0);
  });
  await test('lost batch commit response recovers every receipt without resending', async () => {
    const h = harness({ lost: true });
    const response = await h.post({ sender: 'a', batch: [fixture('first'), fixture('second')] });
    assert.deepEqual(response.data.results.map(row => row.ok), [true, true]);
    assert.equal(h.queued.length, 2);
    assert.equal(h.counts().transactions, 1);
  });
  await test('single status handles storage failure and avoids full history reads', async () => {
    const h = harness();
    await h.post(fixture());
    assert.equal((await h.getSingle('request-one')).data.status, 'queued');
    assert.deepEqual(h.readKeys.at(-1), ['recruit:tg-delivery:request-one']);
    const unavailable = harness({ readFailures: 1 });
    assert.equal((await unavailable.getSingle('request-one')).status, 503);
  });
  await test('UI confirms a lost submission response without a second POST', async () => {
    const h = enqueueHarness(async (_, options) => {
      if (options.method === 'POST') throw new Error('Network disconnected');
      return { ok: true, json: async () => ({ ok: true, results: [{ id: 'request-ui', ok: true, status: 'queued' }] }) };
    });
    assert.equal((await h.enqueue({ requestId: 'request-ui' })).status, 'queued');
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1);
  });
  await test('UI retries the identical task after an unconfirmed receipt', async () => {
    let posts = 0;
    const h = enqueueHarness(async (_, options) => {
      if (options.method === 'POST') {
        if (++posts === 1) return { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) };
        return { ok: true, json: async () => ({ ok: true, id: 'request-ui', status: 'queued' }) };
      }
      return { ok: true, json: async () => ({ ok: true, results: [] }) };
    });
    assert.equal((await h.enqueue({ requestId: 'request-ui' })).status, 'queued');
    const bodies = h.calls.filter(call => call.options.method === 'POST').map(call => call.options.body);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
  });
  await test('UI does not recover or retry a permission or validation rejection', async () => {
    const h = enqueueHarness(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Denied' }) }));
    await assert.rejects(h.enqueue({ requestId: 'request-ui' }), /Denied/);
    assert.equal(h.calls.length, 1);
  });
  await test('B account receipts work even when recommendation lookup is unavailable', async () => {
    const h = harness({ lookupFails: true });
    await h.post(fixture('b-receipt', 'b'));
    const before = h.counts().reads;
    const receipt = await h.get(['request-b-receipt'], true);
    assert.equal(receipt.data.results[0].status, 'queued');
    assert.equal(h.counts().reads - before, 1);
    assert.equal((await h.get(['request-b-receipt'])).status, 503);
    const denied = harness({ allowed: ['a'] });
    denied.db.set('recruit:tg-delivery:request-b-receipt', h.db.get('recruit:tg-delivery:request-b-receipt'));
    assert.equal((await denied.get(['request-b-receipt'], true)).data.results[0].ok, false);
  });
  await test('B bulk retry preserves partial success and resubmits only unconfirmed IDs', async () => {
    let first;
    const h = bulkHarness(async (url, options) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        assert.equal(body.sender, 'b');
        if (!first) { first = body.batch; throw new Error('Lost batch response'); }
        assert.deepEqual(body.batch.map(task => task.requestId), first.slice(2).map(task => task.requestId));
        return { ok: true, json: async () => ({ ok: true, results: body.batch.map(task => ({ id: task.requestId, ok: true, status: 'queued' })) }) };
      }
      assert.match(url, /receipt=1/);
      return { ok: true, json: async () => ({ ok: true, results: first.slice(0, 2).map(task => ({ id: task.requestId, ok: true, status: 'sent' })) }) };
    });
    await h.send();
    assert.deepEqual(Object.values(h.states).map(row => row.status), ['sent', 'sent', 'queued', 'queued']);
    assert.equal(h.closed(), true);
  });
  await test('B bulk timeout keeps known successes and marks others unconfirmed, not failed', async () => {
    let first;
    const h = bulkHarness(async (url, options) => {
      if (options.method === 'POST') {
        first ||= JSON.parse(options.body).batch;
        const error = new Error('signal timed out'); error.name = 'TimeoutError'; throw error;
      }
      const ids = new URL('https://example.invalid' + url).searchParams.getAll('ids');
      return { ok: true, json: async () => ({ ok: true, results: ids.includes(first[0].requestId)
        ? [{ id: first[0].requestId, ok: true, status: 'queued' }] : [] }) };
    });
    await h.send();
    assert.equal(h.states.one.status, 'queued');
    for (const key of ['two', 'three', 'four']) assert.equal(h.states[key].status, 'unconfirmed');
    assert.equal(h.closed(), false);
    assert.match(h.errors.at(-1), /已确认 1\/4/);
    assert.ok(!h.errors.some(error => /signal timed out/.test(error)));
  });
  await test('large recommendation reads get one sufficient budget instead of repeated 5s aborts', async () => {
    const exports = {}, timeouts = [];
    const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/kv-server.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, require: name => { assert.equal(name, 'server-only'); return {}; },
      process: { env: { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test' } },
      AbortSignal: { timeout: ms => { timeouts.push(ms); return undefined; } },
      setTimeout, console, fetch: async () => ({ ok: true, json: async () => ({}) }) });
    await exports.kvCommandStrict('MGET', 'recruit:repush');
    await exports.kvCommandStrict('MGET', 'recruit:tg-delivery:example');
    assert.deepEqual(timeouts, [18000, 6000]);
  });
  console.log('Passed ' + passed + ' send-route regression scenarios.');
})().catch(error => { console.error(error); process.exitCode = 1; });
