// Offline regressions for cloud refresh, delivery receipts and legacy bootstrap.
// All storage/network calls are in-memory; no credentials or Telegram access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => clone(data) });
function load(relative, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const filename = path.resolve(root, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports, require: name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error('Unexpected import: ' + name);
    }, console, Date, URL, URLSearchParams, AbortSignal, AbortController,
    setTimeout, clearTimeout, crypto: { randomUUID }, ...globals,
  }, { filename });
  return module.exports;
}
const changes = load('src/lib/record-changes.ts');
const ownership = load('src/lib/data-ownership.ts');
function bootstrapHarness({ data = {}, tombstones = {}, failures = false, conflicts = false, race, owners = ['a', 'b'] } = {}) {
  const db = new Map(Object.entries(data).map(([type, rows]) => ['recruit:' + type, JSON.stringify(rows)]));
  db.set('recruit:tombstones', JSON.stringify(tombstones));
  let writes = 0;
  const api = load('src/app/api/sync/bootstrap/route.ts', {
    'next/server': { NextResponse: { json: (data, options) => ({ data: clone(data), status: options?.status || 200 }) } },
    '@/lib/auth-api': { requireMutationSession: async () => null, permittedOwners: async () => owners },
    '@/lib/data-ownership': ownership,
    '@/lib/kv-server': {
      kvCommandStrict: async (command, ...keys) => {
        if (failures) throw new Error('Read failed');
        assert.equal(command, 'MGET');
        return keys.map(key => db.get(key) ?? null);
      },
      kvTransaction: async tx => {
        writes++;
        if (race) { const run = race; race = null; run(db); }
        if (conflicts || tx.expected.some(check => db.has(check.key) !== check.exists
          || (check.exists && db.get(check.key) !== check.value))) return { ok: false };
        for (const write of tx.writes) db.set(write.key, write.value);
        return { ok: true };
      },
    },
  });
  return { db, writes: () => writes, post: data => api.POST({ json: async () => ({ data }) }) };
}
function localStorageMock(initial = {}) {
  const storage = { ...initial };
  Object.defineProperties(storage, {
    getItem: { value: key => storage[key] ?? null },
    setItem: { value: (key, value) => { storage[key] = value; } },
    removeItem: { value: key => { delete storage[key]; } },
  });
  return storage;
}
function syncHarness({ rows = {}, initialStorage = {} } = {}) {
  const applied = [], reads = [], posted = [], dataGates = [];
  let gateData = true;
  const storage = localStorageMock(initialStorage);
  const data = { jds: [{ id: 'live-jd', title: 'Current JD' }], repush: [], ...rows };
  const client = load('src/lib/sync.ts', { './record-changes': changes }, {
    localStorage: storage,
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    setInterval: () => 1, clearInterval() {},
    fetch: async (url, options) => {
      if (url === '/api/sync/records') {
        posted.push(JSON.parse(options.body));
        return response({ error: 'Offline: keep edits in the local outbox' }, 503);
      }
      if (url === '/api/sync/bootstrap') {
        posted.push(JSON.parse(options.body));
        return response({ ok: true });
      }
      const keys = new URL(url, 'https://example.invalid').searchParams.getAll('key');
      reads.push(keys);
      if (keys.length === 1 && keys[0] === 'version') return response({ values: { version: '5' } });
      const result = () => response({ values: Object.fromEntries(keys.map(key => [key,
        key === 'tombstones' ? JSON.stringify(data.tombstones || {}) : key === 'jds-epoch' ? 'epoch-current' : JSON.stringify(data[key] || [])])) });
      return gateData ? new Promise(resolve => dataGates.push(() => resolve(result()))) : result();
    },
  });
  return { client, applied, posted, reads, storage, data,
    start: types => client.startSync((type, rows) => applied.push({ type, rows: clone(rows) }), types),
    release: () => { assert.ok(dataGates.length, 'Expected an in-flight data read'); dataGates.shift()(); },
    directReads: () => { gateData = false; },
  };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('legacy bootstrap never recreates JD or repush cache rows', async () => {
    const h = bootstrapHarness({ data: { jds: [], repush: [] } });
    const result = await h.post({ jds: [{ id: 'deleted-jd' }], repush: [{ id: 'deleted-send', column: 'a', deliveryStatus: 'sending' }] });
    assert.equal(result.status, 200);
    assert.equal(result.data.restored, 0);
    assert.equal(h.db.get('recruit:repush'), '[]');
    assert.equal(h.db.get('recruit:jds'), '[]');
    assert.equal(h.writes(), 0);
  });
  await test('legacy bootstrap respects tombstones for other cached business records', async () => {
    const h = bootstrapHarness({ data: { candidates: [] }, tombstones: { candidates: { removed: 123 } } });
    const result = await h.post({ candidates: [{ id: 'removed', owner: 'a' }] });
    assert.equal(result.status, 200);
    assert.equal(result.data.restored, 0);
    assert.equal(h.db.get('recruit:candidates'), '[]');
  });
  await test('bootstrap preserves existing manual values and adds only allowed missing rows', async () => {
    const existing = { id: 'existing', owner: 'a', name: 'Manual name' };
    const h = bootstrapHarness({ data: { candidates: [existing] }, owners: ['a'] });
    const result = await h.post({ candidates: [{ ...existing, name: 'Stale name' }, { id: 'new', owner: 'a' }, { id: 'other-owner', owner: 'b' }] });
    assert.equal(result.data.restored, 1);
    assert.deepEqual(JSON.parse(h.db.get('recruit:candidates')), [existing, { id: 'new', owner: 'a' }]);
  });
  await test('concurrent deletion wins over legacy cache recovery', async () => {
    const h = bootstrapHarness({ data: { candidates: [] }, race: db => db.set('recruit:tombstones', JSON.stringify({ candidates: { removed: 456 } })) });
    const result = await h.post({ candidates: [{ id: 'removed', owner: 'a' }] });
    assert.equal(result.status, 200);
    assert.equal(result.data.restored, 0);
    assert.equal(h.db.get('recruit:candidates'), '[]');
  });
  await test('exhausted bootstrap compare-and-swap attempts are not reported as success', async () => {
    const h = bootstrapHarness({ conflicts: true });
    const result = await h.post({ candidates: [{ id: 'new', owner: 'a' }] });
    assert.equal(result.status, 503);
    assert.equal(h.writes(), 3);
  });
  await test('bootstrap storage read failure is not treated as an empty database', async () => {
    const h = bootstrapHarness({ failures: true });
    assert.equal((await h.post({ candidates: [{ id: 'new', owner: 'a' }] })).status, 503);
    assert.equal(h.writes(), 0);
  });
  await test('unchanged delivery receipt does not invalidate a concurrent cloud refresh', async () => {
    const receipt = [{ id: 'application', deliveryStatus: 'queued' }];
    const h = syncHarness({ rows: { repush: receipt } });
    h.client.applyRemoteStoreUpdate('repush', () => receipt);
    h.start(['jds', 'repush']);
    await tick();
    h.client.applyRemoteStoreUpdate('repush', () => clone(receipt));
    h.release(); await tick();
    assert.deepEqual(h.applied.map(item => item.type), ['jds', 'repush']);
    h.client.stopSync();
  });
  await test('changed delivery status cannot starve an unrelated JD update', async () => {
    const h = syncHarness();
    h.start(['jds', 'repush']); await tick();
    h.client.applyRemoteStoreUpdate('repush', () => [{ id: 'application', deliveryStatus: 'sent' }]);
    h.release(); await tick();
    assert.deepEqual(h.applied.map(item => item.type), ['jds', 'repush']);
    h.directReads(); await h.client.refreshSyncedData();
    assert.equal(h.applied.filter(item => item.type === 'repush').length, 2);
    h.client.stopSync();
  });
  await test('manual recommendation edits stay pending while JD reads continue', async () => {
    const before = [{ id: 'application', candidateName: 'Name', feedback: 'pending' }];
    const after = [{ ...before[0], feedback: 'done' }];
    const h = syncHarness({ rows: { repush: before } });
    h.start(['jds', 'repush']); await tick();
    h.client.syncPush('repush', after, before); await tick();
    h.release(); await tick();
    assert.deepEqual(h.applied.map(item => item.type), ['jds', 'repush']);
    assert.equal(h.applied.at(-1).rows[0].feedback, 'done');
    assert.equal(h.posted[0].changes[0].after.feedback, 'done');
    assert.equal(Object.keys(h.storage).filter(key => key.startsWith('recruit:record-outbox:v1:')).length, 1);
    h.client.stopSync();
  });
  await test('cold start with a persisted conflict still displays cloud recommendations and keeps the edit', async () => {
    const key = 'recruit:record-outbox:v1:blocked';
    const mutation = { id: 'blocked', type: 'repush', createdAt: 1, conflicts: ['old'], changes: [
      { id: 'old', before: { id: 'old', candidateName: 'Old' }, after: { id: 'old', candidateName: 'Local' } },
    ] };
    const cloud = [{ id: 'old', candidateName: 'Cloud' }, { id: 'guo', candidateName: '郭哈哈' }];
    const h = syncHarness({ rows: { repush: cloud }, initialStorage: { [key]: JSON.stringify(mutation) } });
    h.directReads(); h.start(['repush']); await tick();
    assert.deepEqual(h.applied.at(-1).rows, cloud);
    assert.deepEqual(JSON.parse(h.storage.getItem(key)), mutation);
    assert.equal(h.posted.length, 0, 'a read never resolves or submits the conflicting edit');
    h.client.stopSync();
  });
  await test('cache migration keeps the last visible list and never modifies the outbox', async () => {
    const { useRepushStore: options } = load('src/store/repush-store.ts', {
      zustand: { create: () => value => value }, 'zustand/middleware': { persist: (_, options) => options },
      '@/lib/utils': {}, '@/lib/sync': {},
    });
    const cached = { items: [{ id: 'saved', candidateName: 'Saved' }] };
    assert.deepEqual(clone(options.migrate(cached, 2).items), cached.items);
    assert.deepEqual(clone(options.migrate({ items: [] }, 3).items), []);
  });
  await test('confirmed task rows and receipts survive delayed cloud projection but never tombstones', async () => {
    const h = syncHarness();
    h.directReads();
    const receipt = { id: 'new-task:jd', column: 'a', deliveryId: 'new-task', deliveryStatus: 'sent',
      deliveryUpdatedAt: '2026-09-15T10:00:00.000Z', candidateName: 'Original', telegramMessageId: '123' };
    h.start(['jds', 'repush']); await tick();
    h.client.rememberDeliveryReceipt(receipt);
    await h.client.refreshSyncedData();
    assert.deepEqual(h.applied.at(-1).rows, [receipt]);
    h.data.repush = [{ ...receipt, candidateName: 'Manual edit', deliveryStatus: 'queued',
      telegramMessageId: undefined, deliveryUpdatedAt: '2026-09-15T09:00:00.000Z' }];
    await h.client.refreshSyncedData();
    assert.equal(h.applied.at(-1).rows[0].candidateName, 'Manual edit');
    assert.equal(h.applied.at(-1).rows[0].deliveryStatus, 'sent');
    h.data.tombstones = { repush: { [receipt.id]: 1 } };
    await h.client.refreshSyncedData();
    assert.equal(h.applied.at(-1).rows.length, 0);
    h.client.stopSync();
  });
  await test('a stopped sync session cannot apply its response to a newly mounted session', async () => {
    const h = syncHarness();
    const previous = [];
    h.client.startSync(type => previous.push(type), ['jds']); await tick();
    h.start(['jds']);
    h.release(); await tick();
    assert.equal(previous.length, 0);
    assert.equal(h.applied.length, 0);
    h.release(); await tick();
    assert.deepEqual(h.applied.map(item => item.type), ['jds']);
    h.client.stopSync();
  });
  await test('bootstrap compatibility client omits JD and recommendation snapshots', async () => {
    const h = syncHarness();
    const failed = await h.client.bootstrapSyncedData({ jds: [{ id: 'job' }], repush: [{ id: 'old-send' }], candidates: [{ id: 'person' }] });
    assert.equal(failed.length, 0);
    assert.deepEqual(h.posted.map(body => Object.keys(body.data)), [['candidates']]);
  });
  await test('provider starts cloud reads immediately without uploading browser snapshots', async () => {
    const effects = [], started = [], bootstrapped = [];
    const fakeStore = { subscribe: () => () => {}, setState() {}, getState: () => ({ items: [] }) };
    const provider = load('src/components/layout/SyncProvider.tsx', {
      react: { useEffect: fn => effects.push(fn), useState: value => [value, () => {}] },
      'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'fragment' },
      'next/navigation': { usePathname: () => '/resume-matching' },
      '@/lib/sync': {
        requestSyncTypes() {}, subscribeSyncStatus: () => () => {},
        startSync: (_, types) => started.push([...types]), stopSync() {},
        bootstrapSyncedData: data => { bootstrapped.push(data); return new Promise(() => {}); },
        fetchImportDiff: async () => null, fetchWeeklyAdded: async () => null,
      },
      '@/lib/mock-guard': { isMockJds: () => false }, '@/lib/jd-parse-core': { mergeUniqueJDs: (_, jds) => ({ jds }) },
      '@/store/jd-store': { useJDStore: fakeStore }, '@/store/interview-store': { useInterviewStore: fakeStore },
      '@/store/talent-store': { useTalentStore: fakeStore }, '@/store/repush-store': { useRepushStore: fakeStore },
      '@/store/todo-store': { useTodoStore: fakeStore }, '@/store/company-store': { useCompanyStore: fakeStore },
      '@/store/performance-store': { usePerformanceStore: fakeStore },
    }, { window: { location: { pathname: '/resume-matching' } }, document: { hidden: false }, setInterval: () => 1, clearInterval() {} });
    provider.SyncProvider({ children: null });
    const cleanup = effects[2]();
    assert.equal(started.length, 1);
    assert.ok(started[0].includes('repush') && started[0].includes('jds'));
    assert.equal(bootstrapped.length, 0);
    cleanup();
  });
  await test('delivery receipts preserve manual candidate, attachment, feedback and offer details', async () => {
    let state;
    const store = load('src/store/repush-store.ts', {
      zustand: { create: () => initializer => {
        state = initializer(update => { const value = typeof update === 'function' ? update(state) : update; state = { ...state, ...value }; });
        return { getState: () => state };
      } },
      'zustand/middleware': { persist: initializer => initializer }, '@/lib/utils': { generateId: randomUUID },
      '@/lib/sync': { rememberDeliveryReceipt: () => {}, isTombstoned: () => false },
    }).useRepushStore;
    const original = { id: 'application', applicationId: 'application', column: 'a', fileName: 'Current name', candidateName: 'Manual name',
      feedback: 'done', resumeUrl: 'https://example.invalid/current.pdf', resumeFileName: 'current.pdf',
      offerAppliedAt: '2026-09-15', contact: 'Manual contact', interviewStatus: 'scheduled',
      deliveryStatus: 'queued', uploadedAt: '2026-09-15T01:00:00.000Z', deliveryUpdatedAt: '2026-09-15T01:00:00.000Z' };
    store.getState().upsertDeliveryRecommendation(original);
    store.getState().upsertDeliveryRecommendation({ ...original, candidateName: 'Old name', feedback: 'pending', offerAppliedAt: undefined,
      contact: 'Old contact', resumeUrl: 'https://example.invalid/old.pdf', resumeFileName: 'old.pdf', interviewStatus: 'none',
      deliveryStatus: 'sent', deliveryUpdatedAt: '2026-09-15T02:00:00.000Z', telegramMessageId: '123' });
    const current = store.getState().items[0];
    for (const key of ['candidateName', 'feedback', 'offerAppliedAt', 'contact', 'resumeUrl', 'resumeFileName', 'interviewStatus']) {
      assert.equal(current[key], original[key], key);
    }
    assert.equal(current.deliveryStatus, 'sent');
    assert.equal(current.telegramMessageId, '123');
    store.getState().upsertDeliveryRecommendation({ ...original, deliveryStatus: 'queued', deliveryUpdatedAt: '2026-09-15T03:00:00.000Z' });
    assert.equal(store.getState().items[0].deliveryStatus, 'sent');
  });
  console.log(`Passed ${passed} sync/send isolation regressions.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
