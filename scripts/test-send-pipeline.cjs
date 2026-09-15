// Integrated offline pipeline: actual client -> actual API -> actual worker ->
// actual projection, all sharing one atomic in-memory store and Telegram ledger.
// There is no production storage, filesystem output, worker startup or real send.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const taskKey = id => 'recruit:tg-delivery:' + id;
const suffix = owner => owner === 'b' ? '-b' : '';
const queueKey = owner => 'recruit:tg-delivery-pending' + suffix(owner);
const processingKey = owner => 'recruit:tg-delivery-processing' + suffix(owner);
const dirtyKey = owner => 'recruit:tg-delivery-projection-pending' + suffix(owner);
const quiet = { log() {}, error() {} };
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error('Unexpected dependency: ' + name);
  }, crypto: crypto.webcrypto, TextEncoder, Error, TypeError, Date, URL, AbortSignal, console: quiet, ...globals }, { filename: file });
  return exports;
}
function environment() {
  const db = new Map([['recruit:repush', '[]'], ['recruit:tombstones', '{}']]);
  for (const owner of ['a', 'b']) {
    db.set(queueKey(owner), '[]'); db.set(processingKey(owner), '[]'); db.set(dirtyKey(owner), '[]');
    db.set('recruit:tg-delivery-worker-heartbeat' + suffix(owner), JSON.stringify({ at: new Date().toISOString() }));
  }
  const state = { db, disk: new Map(), files: new Map(), ledger: new Map(), attempts: [], reads: [], transactions: [], http: [] };
  state.transaction = async payload => {
    state.transactions.push(clone(payload));
    if (!(payload.expected || []).every(item => db.has(item.key) === item.exists
      && (!('value' in item) || db.get(item.key) === item.value))) return { ok: false };
    for (const item of payload.writes || []) db.set(item.key, item.value);
    for (const item of payload.lists || []) {
      let list = JSON.parse(db.get(item.key) || '[]');
      if (item.op === 'remove') list = list.filter(id => id !== item.value);
      else if (item.op === 'push') list.push(item.value);
      else throw new Error('Unexpected list operation');
      db.set(item.key, JSON.stringify(list));
    }
    for (const key of payload.increments || []) db.set(key, String(Number(db.get(key) || 0) + 1));
    return { ok: true };
  };
  state.read = keys => {
    state.reads.push([...keys]);
    return keys.map(key => db.get(key) ?? null);
  };
  state.storage = {
    kvCommandStrict: async (command, ...keys) => {
      if (command === 'MGET') return state.read(keys);
      if (command === 'GET') return state.read(keys)[0];
      throw new Error('Unexpected KV command: ' + command);
    },
    kvFindRepushRecords: async args => JSON.parse(db.get('recruit:repush')).filter(row => row.column === args.column
      && ((args.sourceIds || []).includes(row.id) || (args.resumeUrls || []).includes(row.resumeUrl))),
    kvTransaction: state.transaction,
  };
  state.rpcFetch = async (url, options) => {
    if (state.files.has(url)) return { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => Buffer.from(state.files.get(url)) };
    const body = JSON.parse(options?.body || '{}');
    if (url === 'https://storage.invalid/rest/v1/rpc/recruit_kv_read') {
      const values = state.read(body.p_keys);
      return { ok: true, status: 200, json: async () => Object.fromEntries(body.p_keys.flatMap((key, index) => values[index] === null ? [] : [[key, values[index]]])) };
    }
    if (url === 'https://storage.invalid/rest/v1/rpc/recruit_kv_tx') {
      const result = await state.transaction(body.p_payload);
      return { ok: true, status: 200, json: async () => result };
    }
    throw new Error('External network is forbidden: ' + url);
  };
  const api = load('src/app/api/tg/send/route.ts', {
    'next/server': { NextResponse: { json: (data, options) => ({ data: clone(data), status: options?.status || 200 }) } },
    '@/lib/api-guard': { guardApi: () => null, blobUrlError: url => state.files.has(url) ? '' : 'Unknown offline attachment' },
    '@/lib/auth-api': {
      apiSessionUser: async request => ({ sub: 'offline-user-' + request.owner }),
      requireApiSession: async request => ['a', 'b'].includes(request.owner) ? null : { status: 401 },
      requireOwnerSession: async (request, owner) => request.owner === owner ? null : { status: 403, data: { ok: false, error: 'Denied' } },
    },
    '@/lib/kv-server': state.storage,
  });
  state.client = owner => {
    const transport = { loseNextAck: false };
    const client = load('src/lib/tg-delivery-client.ts', {}, { fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      state.http.push({ owner, method, url });
      const request = { owner, nextUrl: new URL(url, 'https://app.invalid'), json: async () => JSON.parse(options.body) };
      const result = method === 'POST' ? await api.POST(request) : await api.GET(request);
      if (method === 'POST' && result.status === 200 && transport.loseNextAck) {
        transport.loseNextAck = false;
        throw new TypeError('Connection lost after server committed POST');
      }
      return { status: result.status, ok: result.status >= 200 && result.status < 300, json: async () => clone(result.data) };
    } });
    return { ...client, transport };
  };
  const changes = load('src/lib/record-changes.ts');
  state.projection = load('src/lib/tg-delivery-projection.ts', {
    'server-only': {}, '@/lib/kv-server': state.storage, '@/lib/record-changes': changes,
  });
  state.readRows = () => JSON.parse(db.get('recruit:repush'));
  return state;
}
function worker(state, owner) {
  let source = fs.readFileSync(path.join(root, 'scripts/tg-delivery-worker.mjs'), 'utf8')
    .replace(/^#!.*\r?\n/, '').replace(/^import .*;\r?\n/gm, '').replace(/\r?\nloadEnv\(\);/, '\n');
  source = source.slice(0, source.lastIndexOf('\nassertEnv();'));
  class Data { constructor(props) { Object.assign(this, props); } }
  class OfflineFile { constructor(name, length, _path, buffer) { Object.assign(this, { name, length, buffer }); } }
  const fileSystem = {
    existsSync: file => state.disk.has(file), readFileSync: file => state.disk.get(file), mkdirSync() {},
    openSync: file => file, writeFileSync: (file, data) => state.disk.set(file, data), fsyncSync() {}, closeSync() {},
    renameSync: (from, to) => { state.disk.set(to, state.disk.get(from)); state.disk.delete(from); },
  };
  const context = vm.createContext({ fs: fileSystem, path, createHash: crypto.createHash, bigInt: value => value,
    Api: { DocumentAttributeFilename: Data, InputMediaUploadedDocument: Data, messages: { SendMedia: Data, SendMessage: Data } },
    CustomFile: OfflineFile, Buffer, Date, URL, AbortSignal, fetch: state.rpcFetch,
    setTimeout, clearTimeout, setInterval, clearInterval, console: quiet,
    process: { argv: ['node', 'offline', '--account', owner], cwd: () => root, pid: owner === 'a' ? 11 : 22,
      env: { SUPABASE_URL: 'https://storage.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fake-offline-key' } },
  });
  vm.runInContext('"use strict";\n' + source + '\nwait = async () => {}; globalThis.worker = { processBatch, claimNext };', context);
  const telegram = {
    getInputEntity: async target => owner + ':' + target,
    uploadFile: async ({ file }) => ({ name: file.name, bytes: file.buffer.toString('utf8') }),
    getMessages: async () => [],
    invoke: async request => {
      const key = owner + ':' + request.randomId;
      state.attempts.push(key);
      if (!state.ledger.has(key)) state.ledger.set(key, {
        id: String(100 + state.ledger.size), owner, target: request.peer, text: request.message,
        fileName: request.media?.file.name, fileBytes: request.media?.file.bytes,
      });
      return { id: state.ledger.get(key).id };
    },
    _getResponseMessage: (_request, result) => result,
  };
  return { run: () => context.worker.processBatch(telegram, []) };
}
function payload(state, owner, person, job, source = 'intake', long = false) {
  const identity = `${owner}-${person}`, name = `English ${person}`, resumeFileName = `中文别名-${person}.pdf`;
  const fileUrl = `https://files.invalid/${identity}.pdf`;
  state.files.set(fileUrl, `%PDF-offline-${identity}-unique-attachment-bytes`);
  const recommendation = `${identity} / ${job} / candidate recommendation` + (long ? '完整推荐信息😀'.repeat(180) : '');
  const snapshot = { id: 'source-' + identity, column: owner, candidateName: name,
    candidateCode: 'CODE-' + identity, candidateIdentityId: 'IDENTITY-' + identity,
    fileName: name + '-original-job', resumeFileName, resumeUrl: fileUrl,
    uploadedAt: '2026-09-15T01:00:00.000Z', feedback: 'pending' };
  if (source === 'repush') {
    const rows = state.readRows();
    if (!rows.some(row => row.id === snapshot.id)) rows.push(snapshot);
    state.db.set('recruit:repush', JSON.stringify(rows));
  }
  return { sender: owner, target: '@offline_recipient', fileUrl,
    ...(source === 'repush' ? { sourceSnapshot: snapshot } : {}),
    deliveries: [{ text: recommendation, fileName: resumeFileName,
      application: { jdId: job, jdTitle: 'Title ' + job, source,
        candidateName: name, candidateCode: snapshot.candidateCode, candidateIdentityId: snapshot.candidateIdentityId,
        resumeFileName, organization: '测试编制', department: '测试服务单位',
        ...(source === 'repush' ? { repushSourceId: snapshot.id } : {}) } }] };
}
async function main() {
  const state = environment(), clients = { a: state.client('a'), b: state.client('b') }, byOwner = {};
  for (const owner of ['a', 'b']) {
    const inputs = [
      payload(state, owner, 'new-person', 'job-1', 'intake', owner === 'b'),
      payload(state, owner, 'new-person', 'job-2'),
      payload(state, owner, 'previous-person', 'shared-job', 'repush'),
      payload(state, owner, 'another-person', 'shared-job', 'repush'),
    ];
    byOwner[owner] = await Promise.all(inputs.map(input => clients[owner].createDeliveryTask(input)));
    assert.notEqual(byOwner[owner][0].requestId, byOwner[owner][1].requestId);
    clients[owner].transport.loseNextAck = true;
  }
  const tasks = [...byOwner.a, ...byOwner.b];
  const initial = await Promise.all(['a', 'b'].map(owner => clients[owner].submitDeliveryTasks(byOwner[owner])));
  assert.ok(initial.flat().every(row => row.ok && row.status === 'queued' && row.records.length === 1));
  assert.equal(state.http.filter(row => row.method === 'POST').length, 2);
  assert.equal(state.http.filter(row => row.method === 'GET').length, 2);
  assert.equal(state.readRows().filter(row => row.deliveryId).length, 0);
  console.log('PASS both authenticated accounts: intake and repush batches retain complete receipts after lost POST acknowledgements');

  await Promise.all(['a', 'b'].map(owner => clients[owner].submitDeliveryTasks(byOwner[owner])));
  for (const owner of ['a', 'b']) assert.equal(JSON.parse(state.db.get(queueKey(owner))).length, 4);
  assert.equal((await state.projection.projectTgDeliveryRecords()).committed, true);
  const rows = state.readRows(), editedId = initial[0][0].records[0].id;
  const edited = rows.find(row => row.id === editedId);
  Object.assign(edited, { feedback: 'done', interviewStatus: 'scheduled', offerAppliedAt: '2026-09-15',
    offerSalary: 25000, contact: 'manual recruiter contact', updatedAt: '2026-09-15T04:00:00.000Z' });
  state.db.set('recruit:repush', JSON.stringify(rows));
  const badId = 'bad-legacy-task-b';
  state.db.set(taskKey(badId), JSON.stringify({ id: badId, sender: 'b', status: 'queued',
    target: '@offline_recipient', fileUrl: byOwner.b[0].fileUrl,
    deliveries: [{ text: 'Invalid legacy mapping', fileName: 'bad.pdf', status: 'pending' }],
    applications: [{ index: 0, applicationId: 'missing-record', jdId: 'missing-job' }] }));
  state.db.set(queueKey('b'), JSON.stringify([badId, ...JSON.parse(state.db.get(queueKey('b')))]));
  await Promise.all([worker(state, 'a').run(), worker(state, 'b').run()]);
  assert.equal(JSON.parse(state.db.get(taskKey(badId))).status, 'failed');
  assert.ok(tasks.every(item => JSON.parse(state.db.get(taskKey(item.requestId))).status === 'sent'));
  const messages = Array.from(state.ledger.values()), media = messages.filter(item => item.fileName);
  assert.equal(media.length, tasks.length);
  assert.equal(new Set(state.attempts).size, state.attempts.length);
  for (const item of tasks) {
    const receipt = JSON.parse(state.db.get(taskKey(item.requestId))).deliveries[0];
    const message = messages.find(row => row.id === receipt.messageId);
    assert.equal(message.owner, item.sender);
    assert.equal(message.fileName, item.deliveries[0].fileName);
    assert.equal(message.fileBytes, state.files.get(item.fileUrl));
    const continuation = (receipt.textReceipts || []).map(part => messages.find(row => row.id === part.messageId).text).join('');
    assert.equal(message.text + continuation, item.deliveries[0].text);
  }
  console.log('PASS real worker consumes both queues concurrently; bad head isolated, each candidate/job file delivered once with complete long text');

  assert.equal((await state.projection.projectTgDeliveryRecords()).committed, true);
  const projected = state.readRows().filter(row => tasks.some(item => item.requestId === row.deliveryId));
  assert.equal(projected.length, tasks.length);
  for (const item of tasks) {
    const row = projected.find(record => record.deliveryId === item.requestId), application = item.deliveries[0].application;
    assert.equal(row.column, item.sender);
    assert.equal(row.candidateName, application.candidateName);
    assert.equal(row.candidateCode, application.candidateCode);
    assert.equal(row.candidateIdentityId, application.candidateIdentityId);
    assert.equal(row.resumeUrl, item.fileUrl);
    assert.equal(row.resumeFileName, application.resumeFileName);
    assert.equal(row.rawText, item.deliveries[0].text);
    assert.equal(row.deliveryStatus, 'sent'); assert.ok(row.telegramMessageId);
  }
  const manual = projected.find(row => row.id === editedId);
  assert.equal(manual.feedback, 'done'); assert.equal(manual.interviewStatus, 'scheduled');
  assert.equal(manual.offerAppliedAt, '2026-09-15'); assert.equal(manual.offerSalary, 25000);
  assert.equal(manual.contact, 'manual recruiter contact'); assert.equal(manual.updatedAt, '2026-09-15T04:00:00.000Z');
  for (const owner of ['a', 'b']) {
    assert.deepEqual(JSON.parse(state.db.get(dirtyKey(owner))), []);
    assert.deepEqual(JSON.parse(state.db.get(processingKey(owner))), []);
    assert.deepEqual(JSON.parse(state.db.get(queueKey(owner))), []);
    clients[owner].transport.loseNextAck = true;
  }
  const final = await Promise.all(['a', 'b'].map(owner => clients[owner].submitDeliveryTasks(byOwner[owner])));
  assert.ok(final.flat().every(row => row.ok && row.status === 'sent' && row.sent === 1 && row.records[0].deliveryStatus === 'sent'));
  assert.equal(state.http.filter(row => row.method === 'GET').length, 4);
  await Promise.all([worker(state, 'a').run(), worker(state, 'b').run()]);
  assert.equal(state.ledger.size, messages.length);
  assert.equal(state.attempts.length, messages.length);
  console.log('PASS actual projection preserves manual Offer fields, drains dirty queues, and client GET confirms sent without replay');
  console.log(`Integrated pipeline passed: ${tasks.length} candidate/job tasks, ${media.length} unique resume sends, ${messages.length - media.length} complete-text continuations; no external I/O.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
