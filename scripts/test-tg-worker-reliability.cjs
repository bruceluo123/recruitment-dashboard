// Exercise the real worker functions in a VM. All storage, files and Telegram
// operations are in-memory; this test never starts a worker or sends a message.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const prefix = 'recruit:tg-delivery:';
const queueKey = account => 'recruit:tg-delivery-pending' + (account === 'b' ? '-b' : '');
const processingKey = account => 'recruit:tg-delivery-processing' + (account === 'b' ? '-b' : '');
const projectionKey = account => 'recruit:tg-delivery-projection-pending' + (account === 'b' ? '-b' : '');
function task(id = 'one', sender = 'a', count = 1) {
  const applications = Array.from({ length: count }, (_, index) => ({ index, applicationId: `${id}:job-${index}`, jdId: `job-${index}` }));
  return { id, sender, status: 'queued', target: '@offline-test', fileUrl: 'https://resume.invalid/test.pdf',
    createdAt: new Date().toISOString(), sent: 0, applications,
    deliveries: applications.map((_, index) => ({ text: `Recommendation ${id} ${index}`, fileName: '中文别名.pdf', status: 'pending' })),
    businessRecords: applications.map(app => ({ id: app.applicationId, applicationId: app.applicationId,
      deliveryId: id, deliveryIndex: app.index, column: sender, candidateName: 'Test name' })) };
}
function storage(tasks = []) {
  const db = new Map(), disk = new Map(), trace = [], sends = [], attempts = [];
  for (const account of ['a', 'b']) db.set(queueKey(account), JSON.stringify(tasks.filter(t => t.sender === account).map(t => t.id)));
  for (const item of tasks) db.set(prefix + item.id, JSON.stringify(item));
  const state = { db, disk, trace, sends, attempts, onTx: null, afterTx: null, onRead: null, resumeFails: false, bodyFailures: 0, telegramFailure: null };
  state.fetch = async (url, options) => {
    if (url.startsWith('https://resume.invalid/')) return { ok: !state.resumeFails, status: state.resumeFails ? 404 : 200,
      headers: new Map(), arrayBuffer: async () => {
        if (state.bodyFailures-- > 0) throw new Error('download dropped after headers');
        return Buffer.from('offline-pdf');
      } };
    const body = JSON.parse(options.body);
    if (url.endsWith('recruit_kv_read')) {
      trace.push({ type: 'read', keys: body.p_keys });
      state.onRead?.(body.p_keys);
      return { ok: true, status: 200, json: async () => Object.fromEntries(body.p_keys.filter(k => db.has(k)).map(k => [k, db.get(k)])) };
    }
    if (!url.endsWith('recruit_kv_tx')) throw new Error('Unexpected external request');
    const tx = body.p_payload;
    trace.push({ type: 'tx', payload: tx });
    state.onTx?.(tx);
    const valid = (tx.expected || []).every(expected => db.has(expected.key) === expected.exists
      && (!expected.exists || !('value' in expected) || db.get(expected.key) === expected.value));
    if (!valid) return { ok: true, status: 200, json: async () => ({ ok: false }) };
    for (const write of tx.writes || []) {
      if (write.key.startsWith(prefix)) assert.equal(write.ttlSeconds, undefined, 'Task checkpoints must retain authoritative receipts');
      db.set(write.key, write.value);
    }
    for (const key of tx.increments || []) db.set(key, String(Number(db.get(key) || 0) + 1));
    for (const entry of tx.lists || []) {
      let list = JSON.parse(db.get(entry.key) || '[]');
      if (entry.op === 'remove') list = list.filter(item => item !== entry.value);
      else if (entry.op === 'push') list.push(entry.value);
      else throw new Error('Unexpected list operation');
      db.set(entry.key, JSON.stringify(list));
    }
    state.afterTx?.(tx);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return state;
}
function worker(state, account = 'a') {
  let source = fs.readFileSync(path.join(root, 'scripts/tg-delivery-worker.mjs'), 'utf8')
    .replace(/^#!.*\r?\n/, '').replace(/^import .*;\r?\n/gm, '').replace(/\r?\nloadEnv\(\);/, '\n');
  source = source.slice(0, source.lastIndexOf('\nassertEnv();'));
  const fileSystem = {
    existsSync: p => state.disk.has(p), readFileSync: p => state.disk.get(p), mkdirSync: () => {},
    openSync: p => p, writeFileSync: (p, content) => state.disk.set(p, content), fsyncSync: () => {}, closeSync: () => {},
    renameSync: (from, to) => { state.disk.set(to, state.disk.get(from)); state.disk.delete(from); },
  };
  class Data { constructor(props) { Object.assign(this, props); } }
  const context = vm.createContext({ fs: fileSystem, path, createHash, bigInt: v => v,
    Api: { DocumentAttributeFilename: Data, InputMediaUploadedDocument: Data, messages: { SendMedia: Data, SendMessage: Data } },
    CustomFile: Data, Buffer, Date, URL, AbortSignal, fetch: state.fetch, setTimeout, clearTimeout, setInterval, clearInterval,
    console: { log: () => {}, error: () => {} },
    process: { argv: ['node', 'offline', '--account', account], cwd: () => root, pid: account === 'a' ? 1 : 2,
      env: { SUPABASE_URL: 'https://storage.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline-only' } } });
  vm.runInContext('"use strict";\n' + source + `\nwait = async () => {}; globalThis.worker = {
    claimNext, saveLeaseRecord, finishClaim, processRecord, processBatch, supabaseRecover, releaseClaim, recoverStaleClaims,
    deterministicRandomId, receiptFingerprint, restoreLocalReceipts, readLocalReceipts, WORKER_ID,
    LeaseLostError, DeliveryStorageError, parseRecordSnapshot, setRecordSnapshot, deferredClaims, withLeaseRenewal, withTimeout, sendDelivery,
  };`, context);
  return context.worker;
}
function client(state) {
  return { getInputEntity: async () => 'offline-entity', uploadFile: async () => 'offline-file', getMessages: async () => [],
    invoke: async request => {
      state.attempts.push({ randomId: request.randomId, message: request.message, kind: request.media ? 'media' : 'text' });
      state.telegramFailure?.(request);
      state.sends.push({ randomId: request.randomId, message: request.message, kind: request.media ? 'media' : 'text' });
      return { id: String(state.sends.length + 100) };
    }, _getResponseMessage: (_request, result) => result };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
async function main() {
  await test('new task claim checks embedded mapping without reading the shared recommendation library', async () => {
    const state = storage([task()]), w = worker(state);
    const claim = await w.claimNext();
    assert.equal(claim.id, 'one');
    assert.equal(claim.record.status, 'sending');
    assert.ok(state.trace.filter(t => t.type === 'read').every(t => !t.keys.includes('recruit:repush')));
    assert.deepEqual(JSON.parse(state.db.get(projectionKey('a'))), ['one']);
  });
  await test('two accounts and unrelated recommendation edits cannot invalidate task leases', async () => {
    const state = storage([task('a', 'a'), task('b', 'b')]);
    const a = worker(state, 'a'), b = worker(state, 'b');
    const [ca, cb] = await Promise.all([a.claimNext(), b.claimNext()]);
    state.onTx = () => state.db.set('recruit:repush', JSON.stringify([{ unrelated: Math.random() }]));
    await Promise.all([a.saveLeaseRecord(ca.record), b.saveLeaseRecord(cb.record)]);
    assert.equal(JSON.parse(state.db.get(prefix + 'a')).lease.workerId, a.WORKER_ID);
    assert.equal(JSON.parse(state.db.get(prefix + 'b')).lease.workerId, b.WORKER_ID);
    assert.ok(state.trace.filter(t => t.type === 'tx').every(t => !(t.payload.expected || []).some(e => e.key === 'recruit:repush')));
  });
  await test('a legacy missing mapping is failed and does not block the next task', async () => {
    const bad = task('bad'); delete bad.businessRecords;
    const state = storage([bad, task('good')]), w = worker(state);
    const claim = await w.claimNext();
    assert.equal(claim.id, 'good');
    assert.equal(JSON.parse(state.db.get(prefix + 'bad')).status, 'failed');
    assert.equal(state.sends.length, 0);
  });
  await test('malformed embedded mapping and wrong-account tasks are isolated', async () => {
    const invalid = task('invalid'); invalid.businessRecords = [null];
    const wrong = task('wrong', 'b'), state = storage([invalid, wrong, task('good')]);
    state.db.set(queueKey('a'), JSON.stringify(['invalid', 'wrong', 'good']));
    const w = worker(state), claim = await w.claimNext();
    assert.equal(claim.id, 'good');
    assert.equal(JSON.parse(state.db.get(prefix + 'wrong')).status, 'queued');
    assert.equal((await worker(state, 'b').claimNext()).id, 'wrong');
  });
  await test('primitive and array delivery entries cannot block the FIFO head in ESM strict mode', async () => {
    for (const invalid of ['invalid', 42, [], null]) {
      const bad = task('bad'); bad.deliveries = [invalid];
      const state = storage([bad, task('good')]), w = worker(state);
      assert.equal((await w.claimNext()).id, 'good');
      assert.equal(JSON.parse(state.db.get(prefix + 'bad')).status, 'failed');
    }
  });
  await test('a lost claim acknowledgement is recovered from the exact leased record', async () => {
    const state = storage([task()]), w = worker(state);
    let lost = true;
    state.afterTx = () => { if (lost) { lost = false; throw new Error('response lost after commit'); } };
    const claim = await w.claimNext();
    assert.equal(claim.id, 'one');
    assert.deepEqual(JSON.parse(state.db.get(processingKey('a'))), ['one']);
  });
  await test('a lost save acknowledgement is not treated as a stolen lease', async () => {
    const state = storage([task()]), w = worker(state), claim = await w.claimNext();
    let lost = true;
    state.afterTx = () => { if (lost) { lost = false; throw new Error('lost'); } };
    await w.saveLeaseRecord(claim.record);
    assert.equal(JSON.parse(state.db.get(prefix + 'one')).lease.workerId, w.WORKER_ID);
  });
  await test('true lease theft still prevents every Telegram send', async () => {
    const state = storage([task()]), w = worker(state), claim = await w.claimNext();
    const stolen = JSON.parse(state.db.get(prefix + 'one')); stolen.lease.workerId = 'other-worker';
    state.db.set(prefix + 'one', JSON.stringify(stolen));
    await w.processRecord(client(state), [], claim);
    assert.equal(state.sends.length, 0);
  });
  await test('successful multi-job delivery saves task receipts and one durable projection marker', async () => {
    const state = storage([task('one', 'a', 3)]), w = worker(state), claim = await w.claimNext();
    await w.processRecord(client(state), [], claim);
    const saved = JSON.parse(state.db.get(prefix + 'one'));
    assert.equal(saved.sent, 3); assert.equal(saved.status, 'sent');
    assert.equal(state.sends.length, 3);
    assert.equal(new Set(state.sends.map(s => s.randomId)).size, 3);
    assert.deepEqual(JSON.parse(state.db.get(projectionKey('a'))), ['one']);
    assert.deepEqual(JSON.parse(state.db.get(processingKey('a'))), []);
  });
  await test('Telegram success followed by database outage survives restart without resending', async () => {
    const state = storage([task()]), w = worker(state), claim = await w.claimNext();
    state.onTx = tx => {
      if ((tx.writes || []).some(write => write.key === prefix + 'one' && JSON.parse(write.value).deliveries[0].status === 'sent')) {
        throw new Error('database offline after Telegram success');
      }
    };
    await w.processRecord(client(state), [], claim);
    assert.equal(state.sends.length, 1);
    assert.equal(Object.keys(w.readLocalReceipts(claim.record)).length, 1);
    state.onTx = null;
    const pending = JSON.parse(state.db.get(prefix + 'one')); pending.lease.expiresAt = '2000-01-01';
    state.db.set(prefix + 'one', JSON.stringify(pending));
    const restarted = worker(state);
    await restarted.supabaseRecover([processingKey('a'), queueKey('a'), prefix + 'one', 'recruit:repush', 'recruit:version'],
      ['one', new Date().toISOString(), '604800']);
    assert.equal(JSON.parse(state.db.get(prefix + 'one')).status, 'sent');
    assert.equal(await restarted.claimNext(), null);
    assert.equal(state.sends.length, 1);
  });
  await test('receipt hashes never mark a different file or different text as already sent', async () => {
    const state = storage([task()]), w = worker(state), claim = await w.claimNext();
    await w.processRecord(client(state), [], claim);
    for (const field of ['fileUrl', 'target']) {
      const different = task(); different[field] += '-different';
      w.restoreLocalReceipts(different); assert.equal(different.deliveries[0].status, 'pending');
    }
    const changed = task(); changed.deliveries[0].text += 'changed';
    w.restoreLocalReceipts(changed); assert.equal(changed.deliveries[0].status, 'pending');
    worker(state, 'b').restoreLocalReceipts(task());
    assert.equal(state.sends.length, 1);
  });
  await test('one failed target task does not prevent the next queued candidate', async () => {
    const state = storage([task('bad'), task('good')]), w = worker(state), c = client(state);
    let first = true;
    c.getInputEntity = async () => { if (first) { first = false; throw new Error('target missing'); } return 'ok'; };
    await w.processBatch(c, []);
    assert.equal(JSON.parse(state.db.get(prefix + 'bad')).status, 'failed');
    assert.equal(JSON.parse(state.db.get(prefix + 'good')).status, 'sent');
  });
  await test('failed heartbeat writes cannot abort an otherwise valid send', async () => {
    const state = storage([task()]), w = worker(state), claim = await w.claimNext();
    state.onTx = tx => { if (tx.writes?.some(x => x.key.includes('heartbeat'))) throw new Error('heartbeat unavailable'); };
    await w.processRecord(client(state), [], claim);
    assert.equal(JSON.parse(state.db.get(prefix + 'one')).status, 'sent');
  });
  await test('a later successful job never changes an earlier failed job into sent', async () => {
    const state = storage([task('one', 'a', 2)]), w = worker(state), claim = await w.claimNext();
    state.telegramFailure = request => { if (request.message === 'Recommendation one 0') throw new Error('first job refused'); };
    await w.processRecord(client(state), [], claim);
    const saved = JSON.parse(state.db.get(prefix + 'one'));
    assert.equal(saved.status, 'partial_failed'); assert.equal(saved.sent, 1);
    assert.deepEqual(saved.deliveries.map(d => d.status), ['failed', 'sent']);
    assert.equal(state.sends.length, 1);
  });
  await test('long recommendation text is delivered completely without breaking Unicode or Telegram limits', async () => {
    const item = task(); item.deliveries[0].text = 'a'.repeat(999) + '😀' + '长文'.repeat(2800);
    const state = storage([item]), w = worker(state), claim = await w.claimNext();
    await w.processRecord(client(state), [], claim);
    assert.equal(state.sends.map(s => s.message).join(''), item.deliveries[0].text);
    assert.equal(state.sends.filter(s => s.kind === 'media').length, 1);
    assert.ok(state.sends.every(s => s.message.length <= (s.kind === 'media' ? 1000 : 4000)));
    assert.ok(state.sends.every(s => !/[\uD800-\uDBFF]$/.test(s.message)));
    assert.equal(JSON.parse(state.db.get(prefix + 'one')).status, 'sent');
  });
  await test('continuation failure resumes only the missing text part, never the delivered resume', async () => {
    const item = task(); item.deliveries[0].text = 'a'.repeat(6000);
    const state = storage([item]), w = worker(state), claim = await w.claimNext();
    let failed = false;
    state.telegramFailure = request => {
      if (!request.media && state.sends.length === 2 && !failed) { failed = true; throw new Error('continuation unavailable'); }
    };
    await w.processRecord(client(state), [], claim);
    const partial = JSON.parse(state.db.get(prefix + 'one'));
    assert.equal(partial.status, 'failed'); assert.equal(partial.deliveries[0].messageId, undefined);
    assert.ok(partial.deliveries[0].mediaMessageId);
    const failedPartId = state.attempts.at(-1).randomId;
    partial.status = 'queued';
    state.db.set(prefix + 'one', JSON.stringify(partial));
    state.db.set(queueKey('a'), JSON.stringify(['one']));
    state.resumeFails = true; // The resume is already delivered; text-only recovery needs no download.
    const restarted = worker(state), retry = await restarted.claimNext();
    await restarted.processRecord(client(state), [], retry);
    assert.equal(JSON.parse(state.db.get(prefix + 'one')).status, 'sent');
    assert.equal(state.sends.filter(s => s.kind === 'media').length, 1);
    assert.equal(state.sends.length, 3);
    assert.equal(state.sends.at(-1).randomId, failedPartId);
    assert.equal(state.sends.map(s => s.message).join(''), item.deliveries[0].text);
  });
  await test('a short storage outage retries the original fenced claim without waiting for lease expiry', async () => {
    const state = storage([task('one'), task('two')]), w = worker(state), claim = await w.claimNext();
    state.onRead = keys => { if (keys.includes(prefix + 'one')) throw new Error('temporary per-task outage'); };
    await w.processRecord(client(state), [], claim);
    assert.equal(w.deferredClaims.size, 1);
    const other = await w.claimNext(); assert.equal(other.id, 'two');
    await w.processRecord(client(state), [], other);
    state.onRead = null;
    w.deferredClaims.get('one').retryAt = 0;
    const resumed = await w.claimNext(); assert.equal(resumed.id, 'one');
    await w.processRecord(client(state), [], resumed);
    assert.equal(JSON.parse(state.db.get(prefix + 'one')).status, 'sent');
    assert.equal(JSON.parse(state.db.get(prefix + 'two')).status, 'sent');
  });
  await test('a corrupt processing task is isolated while other expired claims recover', async () => {
    const bad = task('bad'), good = task('good');
    bad.deliveries = { malformed: true };
    for (const item of [bad, good]) { item.status = 'sending'; item.lease = { workerId: 'gone', expiresAt: '2000-01-01' }; }
    const state = storage([bad, good]), w = worker(state);
    state.db.set(queueKey('a'), '[]'); state.db.set(processingKey('a'), JSON.stringify(['bad', 'good']));
    await w.recoverStaleClaims();
    assert.equal(JSON.parse(state.db.get(prefix + 'bad')).status, 'failed');
    assert.equal(JSON.parse(state.db.get(prefix + 'good')).status, 'queued');
    assert.deepEqual(JSON.parse(state.db.get(queueKey('a'))), ['good']);
  });
  await test('a resume download dropped after HTTP headers is retried before failing delivery', async () => {
    const state = storage([task()]), w = worker(state), claim = await w.claimNext();
    state.bodyFailures = 1;
    await w.processRecord(client(state), [], claim);
    assert.equal(JSON.parse(state.db.get(prefix + 'one')).status, 'sent');
    assert.equal(state.sends.length, 1);
  });
  await test('a timed-out media operation cannot send late continuation messages', async () => {
    const item = task(); item.deliveries[0].text = 'a'.repeat(6000);
    const state = storage([item]), w = worker(state), claim = await w.claimNext();
    const c = client(state), invoke = c.invoke;
    let release;
    c.invoke = async request => { await new Promise(resolve => { release = resolve; }); return invoke(request); };
    let underlying;
    await assert.rejects(w.withLeaseRenewal(claim.record, assertLease => {
      underlying = w.sendDelivery(c, 'offline', claim.record, 0, claim.record.deliveries[0], Buffer.from('pdf'), assertLease);
      return w.withTimeout(underlying, 1, 'test timeout');
    }), /timed out/);
    release();
    await assert.rejects(underlying, /timed out/);
    assert.equal(state.sends.length, 1);
    assert.equal(state.sends[0].kind, 'media');
  });
  await test('committed sent checkpoints survive simultaneous loss of ACK and verification read', async () => {
    for (const stage of ['checkpoint', 'finish']) {
      const state = storage([task()]), w = worker(state), claim = await w.claimNext();
      let lost = false;
      state.afterTx = payload => {
        const write = payload.writes?.find(item => item.key === prefix + 'one');
        const saved = write && JSON.parse(write.value);
        if (!lost && saved?.deliveries[0].status === 'sent'
          && saved.status === (stage === 'checkpoint' ? 'sending' : 'sent')) {
          lost = true;
          state.onRead = () => { throw new Error('verification unavailable after commit'); };
          throw new Error('committed ACK lost');
        }
      };
      await w.processRecord(client(state), [], claim);
      assert.equal(state.sends.length, 1);
      assert.equal(w.deferredClaims.size, 1);
      state.afterTx = null; state.onRead = null;
      w.deferredClaims.get('one').retryAt = 0;
      // Advance timestamps to ensure success cannot depend on coincidentally equal JSON snapshots.
      await new Promise(resolve => setTimeout(resolve, 5));
      const retry = await w.claimNext();
      if (retry) await w.processRecord(client(state), [], retry);
      assert.equal(JSON.parse(state.db.get(prefix + 'one')).status, 'sent');
      assert.deepEqual(JSON.parse(state.db.get(processingKey('a'))), []);
      assert.equal(w.deferredClaims.size, 0);
      assert.equal(state.sends.length, 1);
    }
  });
  await test('deferred refresh never rebases onto another worker lease or a changed immutable payload', async () => {
    for (const change of ['worker', 'expiry', 'owner', 'file', 'text', 'application']) {
      const state = storage([task()]), w = worker(state), claim = await w.claimNext();
      state.onRead = () => { throw new Error('storage unavailable'); };
      await w.processRecord(client(state), [], claim);
      assert.equal(w.deferredClaims.size, 1);
      state.onRead = null;
      const current = JSON.parse(state.db.get(prefix + 'one'));
      if (change === 'worker') current.lease.workerId = 'another-worker';
      if (change === 'expiry') current.lease.expiresAt = '2000-01-01';
      if (change === 'owner') current.sender = 'b';
      if (change === 'file') current.fileUrl = 'https://resume.invalid/other.pdf';
      if (change === 'text') current.deliveries[0].text = 'another candidate';
      if (change === 'application') current.applications[0].applicationId = 'another-job';
      const raw = JSON.stringify(current); state.db.set(prefix + 'one', raw);
      w.deferredClaims.get('one').retryAt = 0;
      assert.equal(await w.claimNext(), null);
      assert.equal(w.deferredClaims.size, 0);
      assert.equal(state.db.get(prefix + 'one'), raw);
      assert.equal(state.sends.length, 0);
    }
  });
  console.log(`Worker reliability: ${passed} scenarios passed (offline, no real messages).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
