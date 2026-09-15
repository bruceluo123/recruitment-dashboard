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
source = source.slice(0, source.indexOf('\nexport { main'));

const db = new Map();
let parseRequests = 0;
const context = vm.createContext({
  console,
  Buffer,
  Date,
  URL,
  setTimeout,
  clearTimeout,
  createHash,
  path,
  fs: { existsSync: () => false },
  Api: { DocumentAttributeFilename: class {} },
  AbortSignal,
  put: async () => ({ url: 'https://files.invalid/resume.pdf' }),
  process: {
    argv: ['node', 'offline-test'],
    cwd: () => path.resolve(__dirname, '..'),
    env: { SUPABASE_URL: 'https://storage.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline',
      TG_ACCOUNT: 'b', TG_BB_API_ID: '1', TG_BB_API_HASH: 'fake', TG_BB_SESSION: 'fake',
      BLOB_READ_WRITE_TOKEN: 'offline', RECRUIT_SERVICE_TOKEN: 'offline' },
  },
  fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/api/resume/parse')) { parseRequests++; return { ok: true, json: async () => ({ text: '完整\u0000简历正文', source: 'test' }) }; }
    if (url.endsWith('/api/candidate-code')) {
      const key = `recruit:candidate-code:state:v1:${body.owner}`;
      const state = JSON.parse(db.get(key) || '{"sequence":200,"entries":{}}');
      let code = Object.keys(state.entries).find(code => state.entries[code].identity === body.candidateIdentityId);
      if (!code) { code = 'XYBB00' + String(++state.sequence).padStart(3, '0'); }
      state.entries[code] = { identity: body.candidateIdentityId, name: body.candidateName.toLowerCase() };
      db.set(key, JSON.stringify(state));
      return { ok: true, json: async () => ({ code }) };
    }
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
vm.runInContext(`${source}\nglobalThis.testApi = { findNearbyCodeMessage, recordImportedIdentity, supabaseImportCommit,
  collectTargets, findExistingRecommendation, main };`, context);
const api = context.testApi;
const legacyDelivered = { id: 'legacy-no-code', column: 'b', candidateName: 'Alice', jdTitle: '开发', telegramMessageId: '9' };
assert.equal(api.findExistingRecommendation([legacyDelivered], 'XYBB00141', '开发', new Date().toISOString(),
  { account: 'b', recommendationMessageId: 9, parsed: { name: 'Alice' } }), legacyDelivered,
  'an existing delivered message without a candidate code is linked, not duplicated');

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
  db.clear();
  const date = Math.floor(Date.now() / 1000) - 60;
  const message = (id, code, name, job, org) => ({ id, date, out: true, senderId: 'b',
    message: `候选人编码：${code}\n候选人姓名：${name}\n应聘岗位：${job}\n推荐编制组织/序列/服务单位：${org}`,
    document: { id: `file-${id}`, attributes: [{ className: 'DocumentAttributeFilename', fileName: `${name}-${job}.pdf` }] } });
  const messages = [message(1, 'XYBB00141', 'Alice', '开发', '瑞升'),
    message(2, 'XYBB00141', 'Alice', '开发', '伊甸维度'), message(3, 'XYBB00142', 'Bob', '开发', '瑞升')];
  // More than the old hard limit of 180 chat messages.
  const history = [...Array.from({ length: 220 }, (_, i) => ({ id: i + 10, date, message: '聊天', out: true })), ...messages];
  let disconnects = 0;
  const client = {
    getDialogs: async () => [{ id: 'chat', title: 'ojisamer', isUser: true, entity: { username: 'ojisamer' } }],
    iterMessages: async function* () { yield* history; },
    getMessages: async (_, { ids }) => history.filter(msg => ids.includes(msg.id)),
    downloadMedia: async () => Buffer.from('pdf'),
    disconnect: async () => { disconnects++; },
  };
  await api.main({ client, write: true, dialog: 'ojisamer' });
  let recs = JSON.parse(db.get('recruit:repush'));
  assert.equal(recs.length, 3, 'same title in two departments and two candidates remain distinct');
  assert.equal(new Set(recs.map(row => row.id)).size, 3);
  assert.equal(parseRequests, 1, 'identical PDF bytes across separate TG messages are OCRed once');
  await api.main({ client, write: true, dialog: 'ojisamer' });
  assert.equal(JSON.parse(db.get('recruit:repush')).length, 3, 'a repeated scan creates no duplicates');
  assert.equal(disconnects, 0, 'inbound never disconnects the borrowed sender connection');
  const edited = messages[0];
  edited.message = edited.message.replace('应聘岗位：开发', '应聘岗位：高级开发');
  edited.editDate = Math.floor(Date.now() / 1000);
  const editedLedger = JSON.parse(db.get('recruit:tg-resume-sync-ledger-b'));
  editedLedger.find(row => row.recommendationMessageId === edited.id).syncedAt = new Date(Date.now() - 60_000).toISOString();
  db.set('recruit:tg-resume-sync-ledger-b', JSON.stringify(editedLedger));
  await api.main({ client, write: true, dialog: 'ojisamer' });
  recs = JSON.parse(db.get('recruit:repush'));
  assert.equal(recs.length, 3, 'an edited Telegram caption updates the original application without duplicating it');
  assert.equal(recs.find(row => row.telegramMessageId === '1').jdTitle, '高级开发');
  const textOnly = { ...message(240, 'XYBB00141', 'Alice', '产品', '瑞升'), document: undefined, replyTo: { replyToMsgId: 1 } };
  history.unshift(textOnly);
  await api.main({ client, write: true, dialog: 'ojisamer' });
  assert.equal(JSON.parse(db.get('recruit:repush')).length, 4, 'a second job can explicitly reference the original attachment');
  const manual = message(250, '', 'Carol', '测试', '瑞升');
  history.unshift(manual);
  await api.main({ client, write: true, dialog: 'ojisamer' });
  recs = JSON.parse(db.get('recruit:repush'));
  assert.ok(recs.find(row => row.candidateName === 'Carol')?.candidateCode, 'manual submission without a code is collected');
  const missing = { ...message(260, 'XYBB00145', 'Missing', '产品', '瑞升'), document: undefined };
  const okay = message(270, 'XYBB00146', 'Good', '产品', '瑞升');
  history.unshift(okay, missing);
  await api.main({ client, write: true, dialog: 'ojisamer' });
  assert.ok(JSON.parse(db.get('recruit:repush')).some(row => row.candidateName === 'Good'), 'missing file does not block another candidate');
  const sync = JSON.parse(db.get('recruit:tg-resume-sync-state-b:ojisamer'));
  assert.ok(sync.retryFrom && sync.failures.length === 1, 'missing file is durably retained for later retry');
  const adjacent = [message(300, 'XYBB00147', 'Dora', '开发', '瑞升'),
    { ...message(301, 'XYBB00147', 'Dora', '开发', '伊甸维度'), document: undefined },
    { ...message(302, 'XYBB00147', 'Dora', '产品', '经纬'), document: undefined }];
  history.unshift(...adjacent);
  history.unshift({ id: 300.5, date, out: true, senderId: 'b', message: '优先推第一个，不行再看下面的' });
  history.unshift({ id: 310, date, out: true, photo: {}, message: '会议截图' });
  history.unshift({ ...message(311, '', 'Dora作品', '', ''), message: '作品附件' });
  await api.main({ client, write: true, dialog: 'ojisamer' });
  recs = JSON.parse(db.get('recruit:repush'));
  assert.equal(recs.filter(row => row.candidateName === 'Dora').length, 3, 'consecutive multi-job captions share the correct attachment');
  assert.ok(!recs.some(row => row.telegramMessageId === '310' || row.telegramMessageId === '311'), 'screenshots and portfolios are not resumes');
  history.unshift(message(320, 'XYBB00142', 'Different', '产品', '瑞升'));
  await api.main({ client, write: true, dialog: 'ojisamer' });
  recs = JSON.parse(db.get('recruit:repush'));
  assert.equal(recs.find(row => row.candidateCode === 'XYBB00142').candidateName, 'Bob');
  const separate = recs.find(row => row.candidateName === 'Different');
  assert.ok(separate && separate.candidateCode !== 'XYBB00142' && separate.sourceCandidateCode === 'XYBB00142', 'copied wrong code cannot mix two people');
  const correctedMessage = message(325, 'XYBB00141', 'Corrected', '产品', '经纬');
  history.unshift(correctedMessage);
  const beforeCorrection = JSON.parse(db.get('recruit:repush'));
  beforeCorrection.push({ id: 'platform-corrected', applicationId: 'platform-corrected', column: 'b',
    candidateCode: 'XYBB00141', candidateIdentityId: 'alice-id', candidateName: 'Alice', jdTitle: '旧岗位',
    fileName: 'Alice-旧岗位', telegramMessageId: '325', deliveryId: 'task-325', deliveryStatus: 'sent',
    uploadedAt: new Date(date * 1000).toISOString(), feedback: 'pending' });
  db.set('recruit:repush', JSON.stringify(beforeCorrection));
  await api.main({ client, write: true, dialog: 'ojisamer' });
  recs = JSON.parse(db.get('recruit:repush'));
  const corrected = recs.find(row => row.telegramMessageId === '325');
  assert.equal(recs.filter(row => row.telegramMessageId === '325').length, 1, 'a manually corrected delivered message is not split into a hidden duplicate');
  assert.equal(corrected.candidateName, 'Corrected');
  assert.notEqual(corrected.candidateCode, 'XYBB00141', 'the corrected person receives an independent identity');
  const manualAgain = message(330, '', 'Carol', '产品', '经纬'); history.unshift(manualAgain);
  await api.main({ client, write: true, dialog: 'ojisamer' });
  const carol = JSON.parse(db.get('recruit:repush')).filter(row => row.candidateName === 'Carol');
  assert.equal(carol.length, 2);
  assert.equal(new Set(carol.map(row => row.candidateCode)).size, 1, 'same uncoded resume reused for another job retains identity');
  for (let i = 0; i < 27; i++) history.unshift(message(400 + i, `XYBB00${300 + i}`, `Batch${i}`, '开发', '瑞升'));
  const bounded = await api.main({ client, write: true, dialog: 'ojisamer' });
  assert.ok(bounded.remaining > 0 && bounded.imported === 25, 'large history checkpoints bounded batches');
  await api.main({ client, write: true, dialog: 'ojisamer' });
  assert.equal(JSON.parse(db.get('recruit:repush')).filter(row => row.candidateName.startsWith('Batch')).length, 27, 'next batch preserves all applications');
  const portfolio = message(500, 'XYBB00399', 'Designer', '设计师', '瑞升');
  portfolio.document.attributes[0].fileName = 'Designer_Portfolio.pdf';
  history.unshift(portfolio);
  await api.main({ client, write: true, dialog: 'ojisamer' });
  const designer = JSON.parse(db.get('recruit:repush')).find(row => row.candidateName === 'Designer');
  assert.ok(designer?.resumeUrl && designer.notes.includes('作品集'), 'an explicit recommendation with portfolio attachment is collected, not silently lost');
  const registry = JSON.parse(db.get(stateKey)); registry.entries.XYBB00400 = { identity: 'eva-id', name: 'eva' };
  db.set(stateKey, JSON.stringify(registry));
  history.unshift(message(510, 'XYBB00400', 'Eva马迅', '运营', '瑞升'));
  await api.main({ client, write: true, dialog: 'ojisamer' });
  const eva = JSON.parse(db.get('recruit:repush')).find(row => row.candidateCode === 'XYBB00400');
  assert.equal(eva?.candidateIdentityId, 'eva-id', 'English and Chinese names on the same attachment preserve the registered identity');
  for (const [key, value] of db) {
    if (key.startsWith('recruit:talent-text:')) assert.equal(value.includes('\u0000'), false, 'PDF NUL bytes cannot enter PostgreSQL text');
  }
  assert.equal(JSON.parse(db.get('recruit:repush')).some(row => row.rawText?.includes('\u0000')), false);
  console.log('Passed TG intake regressions: pagination, multi-job, multi-person, detached replies, no-code intake, idempotence, retry retention, sender isolation and PDF NUL bytes.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
