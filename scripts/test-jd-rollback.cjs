// Isolated route and client regressions; never reads credentials or production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const db = new Map();
let failRead = false, failWrite = false, beforeCommit;
const storage = {
  async kvCommandStrict(command, ...keys) {
    if (failRead) throw new Error('offline');
    if (command === 'MGET') return keys.map((key) => db.get(key) ?? null);
    if (command === 'GET') return db.get(keys[0]) ?? null;
    if (command === 'EXISTS') return Number(db.has(keys[0]));
    throw new Error(`Unexpected ${command}`);
  },
  async kvTransaction(tx) {
    if (beforeCommit) { const run = beforeCommit; beforeCommit = undefined; run(); }
    if (failWrite) throw new Error('offline');
    if ((tx.expected || []).some((check) => db.has(check.key) !== check.exists
      || check.exists && db.get(check.key) !== check.value)) return { ok: false };
    for (const item of tx.writes || []) db.set(item.key, item.value);
    const increments = {};
    for (const key of tx.increments || []) { const n = Number(db.get(key) || 0) + 1; db.set(key, String(n)); increments[key] = n; }
    return { ok: true, increments };
  },
};
storage.kvGetRaw = (key) => storage.kvCommandStrict('GET', key);
const overrides = {
  'server-only': {},
  '@/lib/kv-server': storage,
  '@/lib/auth-api': { requireApiSession: async () => null, requireMutationSession: async () => null, permittedOwners: async () => ['a', 'b'], hasValidServiceToken: () => true },
  '@/lib/api-guard': { guardApi: () => null },
  '@/lib/kv': { SYNC_KEYS: { jds: 'recruit:jds', version: 'recruit:version' } },
  '@/lib/tg-priority': { normalizeTitle: (s) => s, fetchTgPriority: async () => ({ gapMap: new Map([['Keep', 4]]), totalEntries: 1, messageCount: 1 }) },
};
function loader(extra = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const req = (name) => {
      if (Object.hasOwn(extra, name)) return extra[name];
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.ts`));
      return require(name);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: req, console, Response, Request, URLSearchParams, AbortSignal, setTimeout, clearTimeout, crypto: { randomUUID }, ...globals }, { filename: file });
    return module.exports;
  }
  return load;
}
const load = loader();
const replacement = load('src/app/api/sync/jds/route.ts');
const records = load('src/app/api/sync/records/route.ts');
const bootstrap = load('src/app/api/sync/bootstrap/route.ts');
const tg = load('src/lib/tg-sync.ts');
const request = (body, url = 'https://example.test/api/sync/jds') => ({ json: async () => body, nextUrl: new URL(url) });
const row = (id, title = id) => ({ id, title, reqKey: `REQ-${id}`, categories: ['frontend'], responsibilities: [], requirements: [], gap: '1' });
const keep = row('keep', 'Keep'), removed = row('removed');
function reset() { db.clear(); db.set('recruit:jds', JSON.stringify([keep, removed])); failRead = failWrite = false; beforeCommit = undefined; }
async function snapshot() { return (await replacement.GET(request())).json(); }
async function replace(rows, base) {
  return replacement.POST(request({ jds: rows, revision: base.revision, epoch: base.epoch, mutationId: randomUUID() }));
}
async function mutate(changes, epoch, resolution) {
  return records.POST(request({ type: 'jds', changes, jdEpoch: epoch, resolution, mutationId: randomUUID() }));
}
let count = 0;
async function test(name, run) { reset(); await run(); count++; console.log(`PASS ${name}`); }
(async () => {
  await test('opening an old device cannot bootstrap deleted jobs', async () => {
    db.set('recruit:jds', JSON.stringify([keep]));
    const before = db.get('recruit:jds');
    assert.equal((await bootstrap.POST(request({ data: { jds: [keep, removed] } }))).status, 200);
    assert.equal(db.get('recruit:jds'), before);
    db.set('recruit:jds', '[]');
    await bootstrap.POST(request({ data: { jds: [keep, removed] } }));
    assert.equal(db.get('recruit:jds'), '[]');
  });
  await test('replacement removes cloud-only rows, creates tombstones, epoch and backup atomically', async () => {
    const base = await snapshot();
    const result = await replace([keep], base);
    assert.equal(result.status, 200);
    const saved = await result.json();
    assert.notEqual(saved.epoch, base.epoch);
    assert.equal(JSON.parse(db.get('recruit:jds')).length, 1);
    assert.ok(JSON.parse(db.get('recruit:tombstones')).jds.removed);
    assert.equal(JSON.parse(db.get(`recruit:backup:jds:before-${saved.epoch}`)).length, 2);
  });
  await test('old client, old epoch and local conflict override all fail closed', async () => {
    const base = await snapshot();
    await replace([keep], base);
    for (const epoch of [undefined, '0']) {
      const response = await mutate([{ id: 'new-id', before: null, after: row('new-id') }], epoch, 'local');
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'JD_SNAPSHOT_EXPIRED');
    }
    assert.equal(JSON.parse(db.get('recruit:jds')).length, 1);
  });
  await test('current epoch allows edits and new jobs but cannot override deletion markers', async () => {
    await replace([keep], await snapshot());
    const epoch = db.get('recruit:jds-epoch');
    assert.equal((await mutate([{ id: 'keep', before: keep, after: { ...keep, gap: '2' } }], epoch)).status, 200);
    assert.equal((await mutate([{ id: 'new', before: null, after: row('new') }], epoch)).status, 200);
    assert.equal((await mutate([{ id: 'removed', before: null, after: removed }], epoch, 'local')).status, 409);
  });
  await test('later explicit panel may reopen a removed job', async () => {
    await replace([keep], await snapshot());
    assert.equal((await replace([keep, removed], await snapshot())).status, 200);
    assert.equal(JSON.parse(db.get('recruit:tombstones')).jds.removed, undefined);
  });
  await test('concurrent import or TG change is not overwritten by a stale panel snapshot', async () => {
    const base = await snapshot();
    db.set('recruit:jds', JSON.stringify([{ ...keep, gap: '9' }, removed]));
    assert.equal((await replace([keep], base)).status, 409);
    assert.equal(JSON.parse(db.get('recruit:jds'))[0].gap, '9');
  });
  await test('record transaction racing with replacement cannot restore jobs', async () => {
    beforeCommit = () => { db.set('recruit:jds', JSON.stringify([keep])); db.set('recruit:jds-epoch', 'new-epoch'); };
    assert.equal((await mutate([{ id: 'new', before: null, after: row('new') }], '0')).status, 409);
    assert.equal(JSON.parse(db.get('recruit:jds')).length, 1);
  });
  await test('TG update racing with import aborts rather than restoring its old full array', async () => {
    beforeCommit = () => db.set('recruit:jds', JSON.stringify([keep]));
    await assert.rejects(tg.runTgSync());
    assert.equal(JSON.parse(db.get('recruit:jds')).length, 1);
  });
  await test('TG normally updates gaps without adding jobs', async () => {
    assert.equal((await tg.runTgSync()).updated, 1);
    assert.equal(JSON.parse(db.get('recruit:jds')).length, 2);
    assert.equal(JSON.parse(db.get('recruit:jds'))[0].gap, '4');
  });
  await test('empty panel and failed storage never report replacement success', async () => {
    const base = await snapshot();
    assert.equal((await replace([], base)).status, 400);
    failWrite = true;
    assert.equal((await replace([keep], base)).status, 503);
    assert.equal(JSON.parse(db.get('recruit:jds')).length, 2);
    failRead = true;
    assert.equal((await replacement.GET(request())).status, 503);
  });
  await test('lost-response retry is idempotent and cannot replay over a newer import', async () => {
    const base = await snapshot();
    const body = { ...base, jds: [keep], mutationId: randomUUID() };
    assert.equal((await replacement.POST(request(body))).status, 200);
    const epoch = db.get('recruit:jds-epoch');
    assert.equal((await replacement.POST(request(body))).status, 200);
    assert.equal(db.get('recruit:jds-epoch'), epoch);
    await replace([row('other')], await snapshot());
    assert.equal((await replacement.POST(request(body))).status, 409);
    assert.equal(JSON.parse(db.get('recruit:jds'))[0].id, 'other');
  });
  await test('client displays new jobs only after server acknowledgement; failure leaves view alone', async () => {
    let calls = 0, applied = 0;
    const client = loader({}, { fetch: async () => { calls++; return Response.json({ error: 'offline' }, { status: 503 }); } })('src/lib/sync.ts');
    await assert.rejects(client.replaceSyncedJDs({ jds: [], epoch: '0', revision: 'x' }, [keep], () => applied++));
    assert.equal(calls, 4); assert.equal(applied, 0);
    const good = loader({}, { fetch: async () => Response.json({ ok: true, epoch: 'new', jds: [keep] }) })('src/lib/sync.ts');
    await good.replaceSyncedJDs({ jds: [], epoch: '0', revision: 'x' }, [keep], () => applied++);
    assert.equal(applied, 1);
  });
  await test('both write responses lost: exact receipt confirms success without another replacement', async () => {
    const base = await snapshot();
    let applied = 0, writes = 0, reads = 0;
    const client = loader({}, { fetch: async (url, options) => {
      if (options.method === 'POST') {
        writes++;
        assert.equal((await replacement.POST(request(JSON.parse(options.body)))).status, 200);
        throw new TypeError('Failed to fetch');
      }
      reads++;
      return replacement.GET(request(undefined, `https://example.test${url}`));
    } })('src/lib/sync.ts');
    const result = await client.replaceSyncedJDs(base, [keep], () => applied++);
    assert.equal(result.length, 1); assert.equal(applied, 1);
    assert.equal(writes, 2); assert.equal(reads, 1);
    assert.equal(db.get('recruit:version'), '1');
  });
  await test('truncated response body is recovered through the read-only receipt', async () => {
    const base = await snapshot();
    let applied = 0;
    const client = loader({}, { fetch: async (url, options) => {
      if (options.method === 'POST') {
        await replacement.POST(request(JSON.parse(options.body)));
        return { ok: true, status: 200, json: async () => { throw new TypeError('Failed to fetch'); } };
      }
      return replacement.GET(request(undefined, `https://example.test${url}`));
    } })('src/lib/sync.ts');
    await client.replaceSyncedJDs(base, [keep], () => applied++);
    assert.equal(applied, 1);
  });
  await test('same count alone is not success: missing receipt remains unconfirmed', async () => {
    const base = await snapshot();
    let applied = 0;
    const client = loader({}, { fetch: async (url, options) => {
      if (options.method === 'POST') throw new TypeError('Failed to fetch');
      return replacement.GET(request(undefined, `https://example.test${url}`));
    } })('src/lib/sync.ts');
    await assert.rejects(client.replaceSyncedJDs(base, [keep, removed], () => applied++), client.JDImportUnconfirmedError);
    assert.equal(applied, 0);
  });
  await test('receipt query never reapplies stale jobs over a later panel', async () => {
    const base = await snapshot(), mutationId = randomUUID();
    await replacement.POST(request({ ...base, jds: [keep], mutationId }));
    await replace([row('later')], await snapshot());
    assert.equal((await replacement.GET(request(undefined, `https://example.test/api/sync/jds?mutationId=${mutationId}`))).status, 409);
    assert.equal(JSON.parse(db.get('recruit:jds'))[0].id, 'later');
  });
  console.log(`${count} JD rollback regressions passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
