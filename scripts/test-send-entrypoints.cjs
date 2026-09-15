// Offline entrypoint regressions. All HTTP/storage/Telegram dependencies are mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }
function load(relative, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in mocks)) throw new Error('Unexpected import: ' + name);
    return mocks[name];
  }, crypto: crypto.webcrypto, TextEncoder, Error, TypeError, Date, URL, console,
  AbortSignal: { timeout: ms => ({ timeoutMs: ms }) }, ...globals });
  return exports;
}
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(data) });
function payload(job = 'job-1', sender = 'a') {
  return { sender, target: '@offline_test', fileUrl: 'https://files.example.invalid/resume.pdf',
    deliveries: [{ text: 'candidate recommendation ' + job, fileName: '中文名-' + job + '.pdf',
      application: { jdId: job, candidateIdentityId: 'person-1', candidateName: 'Ethan Lin', source: 'intake' } }] };
}
const queued = task => ({ id: task.requestId, ok: true, status: 'queued', queued: true, sent: 0, total: 1,
  applications: [{ index: 0, applicationId: task.requestId + ':0', jdId: task.deliveries[0].application.jdId }],
  deliveries: [{ index: 0, status: 'pending', fileName: task.deliveries[0].fileName }], records: [] });
function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}
const client = (fetch, localStorage = memoryStorage()) => load('src/lib/tg-delivery-client.ts', {}, { fetch, localStorage });

function component(relative, mocks, globals = {}, initialOverrides = {}) {
  const values = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = index in initialOverrides ? initialOverrides[index] : typeof initial === 'function' ? initial() : initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; return values[index] ||= { current: initial }; },
    useEffect() {},
    useMemo(fn) { return fn(); },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = load(relative, { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': new Proxy({}, { get: (_, name) => name }), '@/lib/utils': { cn: (...args) => args.join(' ') },
    '@/hooks/useEscapeClose': { useEscapeClose() {} }, ...mocks }, globals);
  return { render(name, props) { cursor = 0; return exports[name](props); }, exports };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function label(node) {
  if (Array.isArray(node)) return node.map(label).join('');
  if (node && typeof node === 'object') return label(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}

async function main() {
  await test('stable per-job intent survives current/all, remount, property order, and snapshot changes', async () => {
    const api = client(() => { throw new Error('No network expected'); });
    const a = await api.createDeliveryTask(payload());
    const second = payload();
    second.deliveries[0].application = Object.fromEntries(Object.entries(second.deliveries[0].application).reverse());
    second.sourceSnapshot = { column: 'a', updatedAt: 'later' };
    assert.equal(a.requestId, (await api.createDeliveryTask(second)).requestId);
    assert.equal(a.requestId, (await client(() => {}).createDeliveryTask(payload())).requestId);
    assert.notEqual(a.requestId, (await api.createDeliveryTask(payload('job-2'))).requestId);
    assert.equal(a.requestId.length, 71);
  });
  await test('owner, recipient, file, candidate and job each bind the intent', async () => {
    const api = client(() => {});
    const base = await api.createDeliveryTask(payload());
    const variants = [payload('job-1', 'b'), { ...payload(), target: '@another_test' },
      { ...payload(), fileUrl: 'https://files.example.invalid/other.pdf' }, payload('job-2')];
    const otherPerson = payload(); otherPerson.deliveries[0].application.candidateIdentityId = 'person-2'; variants.push(otherPerson);
    for (const variant of variants) assert.notEqual((await api.createDeliveryTask(variant)).requestId, base.requestId);
    await assert.rejects(api.createDeliveryTask({ ...payload(), sourceSnapshot: { column: 'b' } }), /所属/);
  });
  await test('batches preserve each candidate file and reject mixed account submission', async () => {
    let body;
    const api = client(async (_, init) => { body = JSON.parse(init.body); return response({ ok: true, results: body.batch.map(queued) }); });
    const a = await api.createDeliveryTask(payload());
    const b = await api.createDeliveryTask({ ...payload('job-2'), fileUrl: 'https://files.example.invalid/second.pdf' });
    const results = await api.submitDeliveryTasks([a, b]);
    assert.equal(results.length, 2);
    assert.equal(body.batch[1].fileUrl, b.fileUrl);
    await assert.rejects(api.submitDeliveryTasks([a, await api.createDeliveryTask(payload('job-2', 'b'))]), /同一个账号/);
  });
  await test('lost POST response checks receipt, never submits successful job twice', async () => {
    let posts = 0, task;
    const api = client(async (_, init) => {
      if (init.method === 'POST') { posts++; throw new TypeError('fetch failed after commit'); }
      return response({ ok: true, results: [queued(task)] });
    });
    task = await api.createDeliveryTask(payload());
    assert.equal((await api.submitDeliveryTasks([task]))[0].status, 'queued');
    assert.equal(posts, 1);
  });
  await test('partially recovered receipt retries only unresolved candidate', async () => {
    const posted = []; let tasks;
    const api = client(async (_, init) => {
      if (init.method === 'POST') {
        const body = JSON.parse(init.body); posted.push(body.batch.map(row => row.requestId));
        if (posted.length === 1) throw new TypeError('connection reset');
        return response({ ok: true, results: body.batch.map(queued) });
      }
      return response({ ok: true, results: [queued(tasks[0])] });
    });
    tasks = await Promise.all([api.createDeliveryTask(payload()), api.createDeliveryTask(payload('job-2'))]);
    assert.ok((await api.submitDeliveryTasks(tasks)).every(row => row.ok));
    assert.deepEqual(posted[1], [tasks[1].requestId]);
  });
  await test('persistent timeout returns unconfirmed after two stable-ID attempts', async () => {
    const posted = [];
    const api = client(async (_, init) => { if (init.method === 'POST') posted.push(JSON.parse(init.body).batch[0].requestId); throw Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }); });
    const task = await api.createDeliveryTask(payload());
    const result = (await api.submitDeliveryTasks([task]))[0];
    assert.equal(result.unconfirmed, true); assert.equal(result.ok, false);
    assert.equal(posted.length, 2); assert.equal(posted[0], posted[1]);
    assert.doesNotMatch(result.error, /signal timed out/);
  });
  await test('one validation failure preserves success and does not retry successful member', async () => {
    let calls = 0;
    const api = client(async (_, init) => { calls++; const tasks = JSON.parse(init.body).batch;
      return response({ ok: true, results: [queued(tasks[0]), { id: tasks[1].requestId, ok: false, error: 'Attachment missing' }] }); });
    const tasks = await Promise.all([api.createDeliveryTask(payload()), api.createDeliveryTask(payload('job-2'))]);
    const result = await api.submitDeliveryTasks(tasks);
    assert.equal(calls, 1); assert.equal(result[0].ok, true); assert.equal(result[1].ok, false);
  });
  await test('local UI update failure cannot replay an accepted task', async () => {
    let calls = 0;
    const api = client(async (_, init) => { calls++; return response({ ok: true, results: JSON.parse(init.body).batch.map(queued) }); });
    const result = await api.submitDeliveryTasks([await api.createDeliveryTask(payload())], () => { throw new Error('local store unavailable'); });
    assert.equal(result[0].ok, true); assert.equal(calls, 1);
  });
  await test('failed receipt remains failed, never shown as queued', async () => {
    let task;
    const api = client(async (_, init) => init.method === 'POST'
      ? Promise.reject(new TypeError('lost response'))
      : response({ ok: true, results: [{ ...queued(task), ok: false, status: 'partial_failed', sent: 0 }] }));
    task = await api.createDeliveryTask(payload());
    assert.equal((await api.submitDeliveryTasks([task]))[0].status, 'partial_failed');
  });
  await test('confirmed sent receipt survives remount and expiry without replaying the POST', async () => {
    const storage = memoryStorage(); let posts = 0;
    const fetch = async (_, init) => { posts++; const task = JSON.parse(init.body).batch[0];
      return response({ ok: true, results: [{ ...queued(task), status: 'sent', sent: 1,
        deliveries: [{ index: 0, fileName: 'resume.pdf', status: 'sent', messageId: 'msg-1', sentAt: '2026-09-01T10:00:00Z' }] }] }); };
    const api = client(fetch, storage);
    await api.submitDeliveryTasks([await api.createDeliveryTask(payload())]);
    for (const [key, raw] of storage.values) storage.values.set(key, JSON.stringify({ ...JSON.parse(raw), createdAt: '2000-01-01T00:00:00Z' }));
    const reloaded = client(fetch, storage);
    const result = (await reloaded.submitDeliveryTasks([await reloaded.createDeliveryTask(payload())]))[0];
    assert.equal(posts, 1); assert.equal(result.status, 'sent');
    assert.match(reloaded.deliverySentTime(result), /2026/);
  });
  await test('explicit resend creates one new successor intent even if two tabs confirm simultaneously', async () => {
    const storage = memoryStorage();
    const fetch = async (_, init) => { const task = JSON.parse(init.body).batch[0];
      return response({ ok: true, results: [{ ...queued(task), status: 'sent', sent: 1,
        deliveries: [{ index: 0, fileName: 'resume.pdf', status: 'sent', messageId: 'msg-1', sentAt: '2026-09-01T10:00:00Z' }] }] }); };
    const a = client(fetch, storage), b = client(fetch, storage);
    const first = await a.createDeliveryTask(payload());
    await a.submitDeliveryTasks([first]);
    const inOtherTab = await b.createDeliveryTask(payload());
    const [nextA, nextB] = await Promise.all([a.renewDeliveryTasks([first]), b.renewDeliveryTasks([inOtherTab])]);
    assert.notEqual(nextA[0].requestId, first.requestId);
    assert.equal(nextA[0].requestId, nextB[0].requestId);
    assert.equal((await a.createDeliveryTask(payload())).requestId, nextA[0].requestId);
    assert.equal((await client(fetch, storage).createDeliveryTask(payload())).requestId, nextA[0].requestId);
  });
  await test('unknown, failed and nondurable intents cannot silently become a new send', async () => {
    const api = client(() => {});
    const task = await api.createDeliveryTask(payload());
    await assert.rejects(api.renewDeliveryTasks([task]), /尚未确认送达/);
    const blockedStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const other = client(async (_, init) => { const task = JSON.parse(init.body).batch[0];
      return response({ ok: true, results: [{ ...queued(task), status: 'sent', deliveries: [{ index: 0, status: 'sent', messageId: 'm' }] }] }); }, blockedStorage);
    const sentTask = await other.createDeliveryTask(payload());
    await other.submitDeliveryTasks([sentTask]);
    await assert.rejects(other.renewDeliveryTasks([sentTask]), /无法保存/);
  });
  await test('expired unknown intent checks receipts but never recreates a possibly delivered task', async () => {
    const storage = memoryStorage(); let posts = 0;
    const api = client(async (_, init) => { if (init.method === 'POST') posts++; return response({ ok: true, results: [] }); }, storage);
    const task = await api.createDeliveryTask(payload());
    for (const [key, raw] of storage.values) storage.values.set(key, JSON.stringify({ ...JSON.parse(raw), createdAt: '2000-01-01T00:00:00Z' }));
    const result = (await api.submitDeliveryTasks([task]))[0];
    assert.equal(posts, 0); assert.equal(result.unconfirmed, true); assert.match(result.error, /安全重试期/);
  });
  await test('old confirmed failed intent retries only its original ID after receipt reconciliation', async () => {
    for (const status of ['failed', 'partial_failed']) {
      const storage = memoryStorage(); let task, posts = 0;
      const api = client(async (_, init) => {
        if (init.method === 'POST') {
          posts++;
          const retried = JSON.parse(init.body).batch[0];
          assert.equal(retried.requestId, task.requestId); assert.equal(retried.retryIfFailed, true);
          return response({ ok: true, results: [queued(retried)] });
        }
        return response({ ok: true, results: [{ id: task.requestId, ok: false, status, error: 'previous send failed' }] });
      }, storage);
      task = await api.createDeliveryTask(payload());
      for (const [key, raw] of storage.values) storage.values.set(key, JSON.stringify({ ...JSON.parse(raw), createdAt: '2000-01-01T00:00:00Z' }));
      const result = (await api.submitDeliveryTasks([task]))[0];
      assert.equal(posts, 1); assert.equal(result.status, 'queued');
    }
  });
  await test('matching actual component: current then all reuses original job and preserves per-job projection', async () => {
    const intents = [], projected = [];
    const fetch = async (_, init) => {
      const body = JSON.parse(init.body); intents.push(...body.batch);
      return response({ ok: true, results: body.batch.map(queued) });
    };
    const api = client(fetch);
    const ui = component('src/components/resume-matching/RecommendationCopyDialog.tsx', {
      '@/lib/tg-delivery-client': api,
    }, { fetch });
    const items = [1, 2].map(n => ({ jdId: 'job-' + n, title: 'Job ' + n, organization: 'Example', department: 'Dept',
      contactPerson: '@bp_test', candidateCode: 'TEST001', candidateIdentityId: 'person-1', candidateName: 'Ethan Lin',
      contact: '/', fileName: '中文名-job-' + n + '.pdf', text: 'recommendation ' + n }));
    const props = { owner: 'a', items, resumeFile: null, resumeFileName: '中文名.pdf', resumeBlobUrl: payload().fileUrl,
      onDeliveryUpdate: (copies, result, file) => projected.push({ copies, result, file }), onClose() {}, onEditCandidateInfo() {} };
    let tree = ui.render('RecommendationCopyDialog', props);
    await nodes(tree).find(node => node.type === 'button' && label(node) === '发送当前').props.onClick();
    tree = ui.render('RecommendationCopyDialog', props);
    await nodes(tree).find(node => node.type === 'button' && label(node) === '全部发送（2）').props.onClick();
    assert.equal(intents.length, 3); assert.equal(intents[0].requestId, intents[1].requestId);
    assert.notEqual(intents[1].requestId, intents[2].requestId);
    assert.equal(projected[2].copies[0].jdId, 'job-2'); assert.equal(projected[2].file, payload().fileUrl);
    assert.equal(projected[2].result.deliveries[0].index, 0);
    tree = ui.render('RecommendationCopyDialog', props);
    assert.match(label(tree), /已加入发送队列 2 项/);
    assert.doesNotMatch(label(tree), /已发送 2 份推荐/);
  });
  await test('matching double click shares synchronous lock before React rerender', async () => {
    let resolve, calls = 0;
    const fetch = async (_, init) => { calls++; await new Promise(done => { resolve = done; }); return response({ ok: true, results: JSON.parse(init.body).batch.map(queued) }); };
    const ui = component('src/components/resume-matching/RecommendationCopyDialog.tsx', { '@/lib/tg-delivery-client': client(fetch) }, { fetch });
    const item = { jdId: 'job', title: 'Test', organization: '', department: '', contactPerson: '', candidateCode: 'TEST',
      candidateIdentityId: 'p', candidateName: 'Test User', contact: '', fileName: 'resume.pdf', text: 'Text' };
    const props = { owner: 'a', items: [item], resumeFile: null, resumeFileName: 'resume.pdf', resumeBlobUrl: payload().fileUrl,
      onClose() {}, onEditCandidateInfo() {} };
    let tree = ui.render('RecommendationCopyDialog', props);
    const send = nodes(tree).find(node => node.type === 'button' && label(node) === '发送当前').props.onClick;
    const first = send(); await send();
    while (!resolve) await new Promise(done => setImmediate(done));
    tree = ui.render('RecommendationCopyDialog', props);
    assert.ok(nodes(tree).find(node => node.type === 'button' && label(node) === '修改候选人信息').props.disabled);
    assert.equal(calls, 1); resolve(); await first;
  });
  const recommendationCopy = load('src/lib/recommendation-copy.ts');
  const repushMocks = {
    '@/types/jd': { hasCategory: () => true },
    '@/lib/repush-format': { displayName: item => item.candidateName },
    '@/lib/recommendation-copy': recommendationCopy,
    '@/lib/feedback-status': { isFeedbackEligibleDelivery: status => status === 'sent' },
  };
  function source(name = 'Ethan Lin', column = 'a') {
    return { id: 'source-' + name, candidateName: name, column, candidateCode: 'TEST-' + name,
      candidateIdentityId: 'identity-' + name, resumeUrl: 'https://files.example.invalid/' + encodeURIComponent(name) + '.pdf',
      fileName: 'original.pdf', resumeFileName: '中文原简历.pdf', rawText: '候选人姓名：' + name + '\n工作年限：4',
      uploadedAt: '2026-09-01T00:00:00Z', deliveryStatus: 'sent' };
  }
  function job(n) { return { id: 'job-' + n, title: 'Target Job ' + n, organization: 'Org', serviceUnit: 'Unit ' + n,
    department: 'Dept ' + n, odc: '@bp_' + n, status: 'active', salaryRange: { min: 20, max: 30, currency: 'K' }, updatedAt: '2026-09-15T00:00:00Z' }; }
  await test('actual single-person multi-job repush keeps attachment/person and correct job/BP per receipt', async () => {
    const bodies = [], saved = []; let closed = 0;
    const fetch = async (_, init) => { const body = JSON.parse(init.body); bodies.push(...body.batch);
      return response({ ok: true, results: body.batch.map(queued) }); };
    const ui = component('src/components/recommendation-center/RepushModal.tsx', {
      ...repushMocks, '@/lib/tg-delivery-client': client(fetch),
    }, { fetch });
    const props = { item: source(), existingItems: [], jds: [job(1), job(2)],
      onClose: () => { closed++; }, onConfirm: args => saved.push(...args) };
    let tree = ui.render('RepushModal', props);
    nodes(tree).find(node => node.type === 'button' && label(node).includes('Target Job 1')).props.onClick();
    tree = ui.render('RepushModal', props);
    nodes(tree).find(node => node.type === 'button' && label(node).includes('Target Job 2')).props.onClick();
    tree = ui.render('RepushModal', props);
    await nodes(tree).find(node => node.type === 'button' && label(node).startsWith('发送并复推')).props.onClick();
    assert.equal(closed, 1); assert.equal(bodies.length, 2); assert.equal(saved.length, 2);
    for (let n = 0; n < 2; n++) {
      assert.equal(bodies[n].fileUrl, props.item.resumeUrl);
      assert.equal(bodies[n].deliveries[0].application.repushSourceId, props.item.id);
      assert.equal(bodies[n].deliveries[0].application.contactPerson, '@bp_' + (n + 1));
      assert.equal(saved[n].jdId, 'job-' + (n + 1));
      assert.equal(saved[n].deliveryIndex, 0);
      assert.equal(saved[n].deliveryId, bodies[n].requestId);
      assert.match(saved[n].recommendationText, new RegExp('Target Job ' + (n + 1)));
    }
  });
  await test('same display name with another identity cannot hide a selectable job', async () => {
    const ui = component('src/components/recommendation-center/RepushModal.tsx', {
      ...repushMocks, '@/lib/tg-delivery-client': client(() => {}),
    });
    const item = source();
    const other = { ...item, id: 'other-source', candidateIdentityId: 'other-identity', candidateCode: 'other-code',
      jdTitle: job(1).title, organization: 'Org/Unit 1', department: 'Dept 1' };
    const tree = ui.render('RepushModal', { item, existingItems: [other], jds: [job(1)], excludeRecommended: true,
      onClose() {}, onConfirm() {} });
    assert.ok(nodes(tree).some(node => node.type === 'button' && label(node).includes('Target Job 1')));
  });
  await test('actual bulk repush isolates Bobo candidates, preserves partial result and retries only failed member', async () => {
    const posted = [];
    const fetch = async (_, init) => {
      const body = JSON.parse(init.body); posted.push(body.batch);
      return response({ ok: true, results: body.batch.map((task, index) => posted.length === 1 && index === 1
        ? { id: task.requestId, ok: false, error: 'test validation failure' } : queued(task)) });
    };
    const api = client(fetch);
    const repush = component('src/components/recommendation-center/RepushModal.tsx', { ...repushMocks, '@/lib/tg-delivery-client': api }, { fetch }).exports;
    const ui = component('src/components/recommendation-center/BulkRepushModal.tsx', {
      './RepushModal': repush, '@/lib/tg-delivery-client': api, '@/lib/recommendation-copy': recommendationCopy,
      '@/lib/same-job-match': { sameJobCoreRules: () => [], meetsCoreRules: () => true, prescreenSameJobCandidates: async () => [] },
    }, { fetch, Intl });
    const people = ['Sean', 'Alex'].map(name => ({ key: name, candidateName: name, candidateCode: 'TEST-' + name, item: source(name, 'b') }));
    const props = { owner: 'b', candidateOptions: people, jds: [job(1)], isAlreadyRecommended: () => false, onRecords() {}, onClose() {} };
    let tree = ui.render('BulkRepushModal', props);
    nodes(tree).find(node => node.type === 'button' && label(node).includes('Target Job 1')).props.onClick();
    for (const name of ['Sean', 'Alex']) {
      tree = ui.render('BulkRepushModal', props);
      nodes(tree).find(node => node.type === 'button' && label(node).includes(name)).props.onClick();
    }
    tree = ui.render('BulkRepushModal', props);
    await nodes(tree).find(node => node.type === 'button' && label(node).startsWith('发送并复推')).props.onClick();
    while (!posted.length) await new Promise(done => setImmediate(done));
    await new Promise(done => setImmediate(done));
    tree = ui.render('BulkRepushModal', props);
    assert.ok(nodes(tree).find(node => node.props?.id === 'bulk-repush-recipient').props.disabled);
    await nodes(tree).find(node => node.type === 'button' && label(node).startsWith('重试未完成')).props.onClick();
    while (posted.length < 2) await new Promise(done => setImmediate(done));
    assert.equal(posted.length, 2); assert.equal(posted[0].length, 2); assert.equal(posted[1].length, 1);
    assert.equal(posted[1][0].requestId, posted[0][1].requestId);
    posted[0].forEach((task, index) => {
      assert.equal(task.sender, 'b'); assert.equal(task.sourceSnapshot.column, 'b');
      assert.equal(task.fileUrl, people[index].item.resumeUrl);
      assert.equal(task.deliveries[0].application.candidateName, people[index].candidateName);
    });
  });
  await test('matching identity boundary resets Alice to Bob on file replacement; same-person update requires confirmation', async () => {
    const aliceFile = { name: 'alice.pdf' }, bobFile = { name: 'bob.pdf' }, bobUpdate = { name: 'bob-new.pdf' };
    const allocations = [];
    const liveJds = [job(1)];
    const resumeState = { activeResumeId: 'resume-1', resumes: [{ id: 'resume-1', file: aliceFile, fileName: 'alice.pdf',
      blobUrl: 'https://files.example.invalid/alice.pdf', rawText: 'Alice\n当前薪资：99', parsedData: { name: 'Alice' }, parsingStatus: 'completed' }],
      resultsByResume: { 'resume-1': { results: [{ id: 'result-1', jdId: 'job-1', jd: job(1) }], scopeIds: ['job-1'] } } };
    const store = state => Object.assign(selector => selector(state), { getState: () => state });
    const ui = component('src/components/resume-matching/ResumeMatchingPage.tsx', {
      '@/components/ui/GlassPanel': { GlassPanel: 'Panel' }, '@/components/ui/EmptyState': { EmptyState: 'Empty' },
      './ResumeUploader': { ResumeUploader: 'Uploader' }, './MatchingResultsList': { MatchingResultsList: 'Results' },
      './RecommendationCandidateDialog': { RecommendationCandidateDialog: 'CandidateDialog' },
      './RecommendationCopyDialog': { RecommendationCopyDialog: 'CopyDialog' }, './TargetJDPickerDialog': { TargetJDPickerDialog: 'Picker' },
      '@/store/resume-store': { useResumeStore: store(resumeState) }, '@/store/jd-store': { useJDStore: store({ jds: liveJds }) },
      '@/store/repush-store': { useRepushStore: store({ items: [], addRecommendation() {}, upsertDeliveryRecommendation() {} }) },
      '@/store/pref-store': { usePrefStore: store({ activeOwner: 'a', setActiveOwner() {} }) },
      '@/types/jd': { JD_CATEGORY_LABELS: {}, JD_CATEGORY_COLORS: {}, ALL_CATEGORIES: [] },
      '@/lib/recommendation': { extractRecommendationInfo: async text => ({ name: text.includes('Bob') ? 'Bob' : 'Alice',
        candidateCode: text.match(/XYMMF\d+/)?.[0] || '', contact: '' }) },
      '@/lib/recommendation-copy': recommendationCopy, '@/lib/sync': { applyRemoteStoreUpdate: (_, fn) => fn() },
    }, { fetch: async (_, init) => { const body = JSON.parse(init.body); allocations.push(body);
      return response({ code: body.preferredCode || 'XYMMF00' + allocations.length, candidateIdentityId: body.candidateIdentityId || 'identity-' + allocations.length }); } }, { 0: true });
    let tree = ui.render('ResumeMatchingPage', {});
    nodes(tree).find(node => node.type === 'Results').props.onToggleSelected('result-1');
    tree = ui.render('ResumeMatchingPage', {});
    nodes(tree).find(node => node.type === 'Results').props.onGenerateRecommendationCopy();
    tree = ui.render('ResumeMatchingPage', {});
    await nodes(tree).find(node => node.type === 'CandidateDialog').props.onGenerate('Alice', aliceFile, 'boss');
    tree = ui.render('ResumeMatchingPage', {});
    const firstCopy = nodes(tree).find(node => node.type === 'CopyDialog');
    const aliceCode = firstCopy.props.items[0].candidateCode;
    firstCopy.props.onEditCandidateInfo();
    tree = ui.render('ResumeMatchingPage', {});
    await nodes(tree).find(node => node.type === 'CandidateDialog').props.onGenerate('Bob\n候选人编码：' + aliceCode, bobFile, 'boss', false);
    tree = ui.render('ResumeMatchingPage', {});
    const secondCopy = nodes(tree).find(node => node.type === 'CopyDialog');
    assert.equal(allocations[1].preferredCode, undefined);
    assert.notEqual(allocations[1].candidateIdentityId, allocations[0].candidateIdentityId);
    assert.notEqual(secondCopy.props.items[0].candidateCode, aliceCode);
    assert.equal(secondCopy.props.items[0].candidateName, 'Bob');
    assert.doesNotMatch(secondCopy.props.items[0].text, /当前薪资：99/);
    secondCopy.props.onEditCandidateInfo();
    tree = ui.render('ResumeMatchingPage', {});
    await nodes(tree).find(node => node.type === 'CandidateDialog').props.onGenerate('Bob', bobUpdate, 'boss', true);
    assert.equal(allocations[2].preferredCode, secondCopy.props.items[0].candidateCode);
    assert.equal(allocations[2].candidateIdentityId, allocations[1].candidateIdentityId);
    tree = ui.render('ResumeMatchingPage', {});
    const finalCopy = nodes(tree).find(node => node.type === 'CopyDialog');
    liveJds[0] = { ...liveJds[0], status: 'paused' };
    assert.throws(() => finalCopy.props.validateBeforeSend(finalCopy.props.items), /关闭/);
    liveJds[0] = { ...job(1), odc: '@changed_bp' };
    assert.throws(() => finalCopy.props.validateBeforeSend(finalCopy.props.items), /对接信息/);
  });
  await test('explicit candidate fields take priority over AI completion; AI has bounded timeout', async () => {
    let timeout;
    const api = load('src/lib/recommendation.ts', { '@/lib/jd-parse-core': { splitOrgDept: value => ({ org: value, dept: '' }) } }, {
      fetch: async (_, init) => { timeout = init.signal.timeoutMs; return response({ choices: [{ message: { content: JSON.stringify({ name: 'Wrong Person', candidateCode: 'WRONG', jobTitle: 'Engineer' }) } }] }); },
    });
    const result = await api.extractRecommendationInfo('候选人姓名：Ethan Lin\n候选人编码：TEST194');
    assert.equal(result.name, 'Ethan Lin'); assert.equal(result.candidateCode, 'TEST194');
    assert.equal(result.jobTitle, 'Engineer'); assert.equal(timeout, 8000);
  });
  await test('structured labels beyond AI excerpt still preserve name without network', async () => {
    const api = load('src/lib/recommendation.ts', { '@/lib/jd-parse-core': { splitOrgDept: value => ({ org: value, dept: '' }) } }, {
      fetch: () => { throw new Error('Should not call AI'); },
    });
    const result = await api.extractRecommendationInfo('x'.repeat(3100) + '\n候选人姓名：Ethan Lin\n应聘岗位：工程师');
    assert.equal(result.name, 'Ethan Lin'); assert.equal(result.jobTitle, '工程师');
  });
  await test('AI timeout falls back to explicitly supplied fields', async () => {
    const api = load('src/lib/recommendation.ts', { '@/lib/jd-parse-core': { splitOrgDept: value => ({ org: value, dept: '' }) } }, {
      fetch: async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
    });
    assert.equal((await api.extractRecommendationInfo('候选人姓名：Test User')).name, 'Test User');
  });
  await test('resume heading is not promoted to candidate name over AI extraction', async () => {
    const api = load('src/lib/recommendation.ts', { '@/lib/jd-parse-core': { splitOrgDept: value => ({ org: value, dept: '' }) } }, {
      fetch: async () => response({ choices: [{ message: { content: JSON.stringify({ name: 'Ethan Lin', jobTitle: 'AI工程师' }) } }] }),
    });
    assert.equal((await api.extractRecommendationInfo('个人简历\nEthan Lin\nAI工程师')).name, 'Ethan Lin');
  });
  function codeApi(entries = {}, loseResponse = false, failRead = 0) {
    const db = new Map([['recruit:candidate-code:state:v1:a', JSON.stringify({ sequence: 194, entries })],
      ['recruit:candidate-code:sequence:a', '194']]);
    let reads = 0;
    const api = load('src/app/api/candidate-code/route.ts', {
      'node:crypto': crypto, 'next/server': { NextResponse: { json: (data, options) => ({ data, status: options?.status || 200 }) } },
      '@/lib/api-guard': { guardApi: () => null }, '@/lib/auth-api': { apiSessionUser: async () => ({ sub: 'tester' }), hasValidServiceToken: () => true, requireOwnerSession: async () => null },
      '@/lib/kv-server': { kvCommandStrict: async (command, ...keys) => { assert.equal(command, 'MGET');
        if (++reads === failRead) throw new Error('cloud unavailable'); return keys.map(key => db.get(key) || null); }, kvTransaction: async body => {
        body.writes.forEach(write => db.set(write.key, write.value));
        if (loseResponse) { loseResponse = false; throw new Error('committed response lost'); }
        return { ok: true };
      } },
    });
    return { post: body => api.POST({ json: async () => ({ owner: 'a', ...body }) }), db };
  }
  await test('same candidate identity accepts Chinese/English alias on reserved number', async () => {
    const api = codeApi({ XYMMF00194: { identity: 'p-194', name: '林先锋' } });
    const result = await api.post({ preferredCode: 'XYMMF00194', candidateName: 'Ethan Lin', candidateIdentityId: 'p-194' });
    assert.equal(result.status, 200); assert.equal(result.data.code, 'XYMMF00194');
  });
  await test('different identity cannot claim number even with matching name', async () => {
    const api = codeApi({ XYMMF00194: { identity: 'p-194', name: 'ethanlin' } });
    assert.equal((await api.post({ preferredCode: 'XYMMF00194', candidateName: 'Ethan Lin', candidateIdentityId: 'other' })).status, 409);
    assert.equal((await api.post({ preferredCode: 'XYMMF00194', candidateName: 'Other User' })).status, 409);
  });
  await test('lost allocation response reuses one candidate number by stable identity', async () => {
    const api = codeApi({}, true);
    const body = { candidateName: 'Test User', candidateIdentityId: 'draft-stable-id' };
    assert.equal((await api.post(body)).status, 503);
    const result = await api.post(body);
    assert.equal(result.data.code, 'XYMMF00195'); assert.equal(result.data.reused, true);
    assert.equal(api.db.get('recruit:candidate-code:sequence:a'), '195');
  });
  await test('ambiguous legacy identity is not silently relaxed', async () => {
    const api = codeApi({ XYMMF00194: { identity: 'p-194', name: '!conflict' } });
    assert.equal((await api.post({ preferredCode: 'XYMMF00194', candidateName: 'Ethan Lin', candidateIdentityId: 'p-194' })).status, 409);
  });
  await test('candidate counter cloud failure does not silently seed or allocate a replacement number', async () => {
    const api = codeApi({}, false, 1);
    assert.equal((await api.post({ candidateName: 'Test User' })).status, 503);
    assert.equal(api.db.get('recruit:candidate-code:sequence:a'), '194');
    const seed = codeApi({}, false, 2);
    seed.db.delete('recruit:candidate-code:state:v1:a');
    assert.equal((await seed.post({ candidateName: 'Test User' })).status, 503);
    assert.equal(seed.db.has('recruit:candidate-code:state:v1:a'), false);
    assert.equal(seed.db.get('recruit:candidate-code:sequence:a'), '194');
  });
  console.log(`${checks} send entrypoint regressions passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
