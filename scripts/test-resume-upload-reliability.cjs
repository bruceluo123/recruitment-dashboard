// Actual upload store and parse route, with in-memory files and fake transport.
// Deadlines are accelerated; no resume, network or production storage is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { File } = require('node:buffer');
const root = path.resolve(__dirname, '..');
const fastTimeout = (fn, delay) => setTimeout(fn, delay >= 10_000 ? 8 : 0);
function load(file, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name in mocks) return mocks[name]; throw new Error('Unexpected dependency: ' + name);
  }, Error, TypeError, Buffer, File, FormData, AbortController, Date, console,
    setTimeout: fastTimeout, clearTimeout, ...globals }, { filename: file });
  return exports;
}
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) });
function file(name = 'offline.pdf', size = 10) {
  const value = new File(['offline bytes'], name, { type: 'application/pdf' });
  Object.defineProperty(value, 'size', { value: size });
  return value;
}
function storeHarness() {
  let state, sequence = 0;
  const h = { uploads: [], parses: [],
    upload: async () => ({ url: 'https://files.invalid/uploaded.pdf' }),
    fetch: async () => response({ text: 'Recognized complete resume content', source: 'offline' }) };
  const errors = load('src/lib/ai-fetch.ts', {});
  const module = load('src/store/resume-store.ts', {
    zustand: { create: initialize => {
      const set = update => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
      const get = () => state;
      state = initialize(set, get);
      return { getState: get, setState: set };
    } },
    '@/types/jd': { hasCategory: () => false },
    '@/lib/utils': { generateId: () => 'resume-' + (++sequence) },
    '@/lib/deepseek': { hasOpenGap: () => true, matchResumeToJDsStream: () => { throw new Error('Unexpected matching'); } },
    '@/lib/ai-fetch': errors,
    './jd-store': { useJDStore: { getState: () => ({ jds: [] }) } },
    '@vercel/blob/client': { upload: async (...args) => { h.uploads.push(args); return h.upload(...args); } },
  }, { fetch: async (...args) => { h.parses.push(args); return h.fetch(...args); } });
  h.store = module.useResumeStore;
  return h;
}
function routeHarness() {
  const h = { downloads: [], extracts: [], fetch: async () => ({ ok: true, headers: new Map(), arrayBuffer: async () => Buffer.from('offline pdf') }) };
  const api = load('src/app/api/resume/parse/route.ts', {
    'next/server': { NextResponse: { json: (data, options) => ({ data, status: options?.status || 200 }) } },
    '@/lib/api-guard': { blobUrlError: url => url.startsWith('https://files.invalid/') ? '' : 'Invalid attachment URL' },
    '@/lib/resume-text': {
      isExtractErr: out => 'error' in out,
      extractResumeText: async (buffer, name) => { h.extracts.push({ buffer, name }); return { text: 'Complete parsed contents', source: 'offline' }; },
    },
  }, { fetch: async (...args) => { h.downloads.push(args); return h.fetch(...args); } });
  h.json = body => api.POST({ headers: new Map([['content-type', 'application/json']]), json: async () => body });
  h.form = input => api.POST({ headers: new Map(), formData: async () => new Map([['file', input]]) });
  return h;
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('permanently pending Blob upload exits parsing with original File retained and aborted request', async () => {
    const h = storeHarness(), input = file('large.pdf', 5 * 1024 * 1024);
    h.upload = async () => new Promise(() => {});
    const id = await h.store.getState().uploadResume(input);
    const resume = h.store.getState().resumes.find(row => row.id === id);
    assert.equal(resume.parsingStatus, 'failed'); assert.match(resume.parseError, /上传超时.*重试/);
    assert.equal(resume.file, input); assert.equal(h.store.getState().isUploading, false);
    assert.equal(h.uploads[0][2].abortSignal.aborted, true);
    assert.equal(h.parses.length, 0);
  });
  await test('permanently pending parse exits parsing and preserves its already uploaded Blob', async () => {
    const h = storeHarness(), input = file('large.pdf', 5 * 1024 * 1024);
    h.fetch = async () => new Promise(() => {});
    const id = await h.store.getState().uploadResume(input);
    const resume = h.store.getState().resumes.find(row => row.id === id);
    assert.equal(resume.parsingStatus, 'failed'); assert.match(resume.parseError, /识别超时/);
    assert.equal(resume.blobUrl, 'https://files.invalid/uploaded.pdf'); assert.equal(resume.file, input);
    assert.equal(h.store.getState().isUploading, false); assert.equal(h.parses.length, 1);
    assert.equal(h.parses[0][1].signal.aborted, true);
  });
  await test('retry after UI removes failed row reuses the same File Blob without re-uploading', async () => {
    const h = storeHarness(), input = file('large.pdf', 5 * 1024 * 1024);
    h.fetch = async () => response({ error: 'Could not read text' }, 422);
    const first = await h.store.getState().uploadResume(input);
    h.store.getState().removeResume(first);
    h.fetch = async () => response({ text: 'Recovered original resume contents', source: 'offline' });
    const next = await h.store.getState().uploadResume(input);
    assert.notEqual(next, first); assert.equal(h.uploads.length, 1);
    assert.equal(JSON.parse(h.parses.at(-1)[1].body).url, 'https://files.invalid/uploaded.pdf');
    assert.equal(h.store.getState().resumes[0].parsingStatus, 'completed');
  });
  await test('direct same-File retry keeps its row ID, and concurrent duplicate upload shares the operation', async () => {
    const h = storeHarness(), input = file();
    h.fetch = async () => response({ error: 'Unreadable' }, 422);
    const a = h.store.getState().uploadResume(input), b = h.store.getState().uploadResume(input);
    assert.equal(a, b);
    const id = await a;
    h.fetch = async () => response({ text: 'Retry success' });
    assert.equal(await h.store.getState().uploadResume(input), id);
    assert.equal(h.store.getState().resumes.length, 1);
  });
  await test('same filename on a different File never reuses another candidates Blob', async () => {
    const h = storeHarness();
    h.upload = async () => ({ url: `https://files.invalid/upload-${h.uploads.length}.pdf` });
    const first = await h.store.getState().uploadResume(file('same.pdf', 5 * 1024 * 1024));
    const second = await h.store.getState().uploadResume(file('same.pdf', 5 * 1024 * 1024));
    assert.equal(h.uploads.length, 2);
    const rows = h.store.getState().resumes;
    assert.notEqual(rows.find(row => row.id === first).blobUrl, rows.find(row => row.id === second).blobUrl);
  });
  await test('interrupted response body retries parsing once without repeating Blob upload', async () => {
    const h = storeHarness(), input = file('large.pdf', 5 * 1024 * 1024);
    h.fetch = async () => h.parses.length === 1
      ? { ok: true, status: 200, text: async () => { throw new TypeError('response body disconnected'); } }
      : response({ text: 'Complete retried body' });
    const id = await h.store.getState().uploadResume(input);
    assert.equal(h.uploads.length, 1); assert.equal(h.parses.length, 2);
    assert.equal(h.store.getState().resumes.find(row => row.id === id).rawText, 'Complete retried body');
  });
  await test('parse body itself cannot remain pending after successful HTTP headers', async () => {
    const h = storeHarness();
    h.fetch = async () => ({ ok: true, status: 200, text: async () => new Promise(() => {}) });
    const id = await h.store.getState().uploadResume(file());
    assert.equal(h.store.getState().resumes.find(row => row.id === id).parsingStatus, 'failed');
    assert.equal(h.store.getState().isUploading, false);
  });
  await test('parse API retains the existing Blob-only URL entrypoint and file name', async () => {
    const h = routeHarness();
    const result = await h.json({ url: 'https://files.invalid/existing.pdf', fileName: 'Original 中文.pdf' });
    assert.equal(result.status, 200); assert.equal(result.data.text, 'Complete parsed contents');
    assert.equal(h.extracts[0].name, 'Original 中文.pdf'); assert.ok(h.downloads[0][1].signal);
  });
  await test('parse API permanent download hang returns a bounded retryable error and aborts both attempts', async () => {
    const h = routeHarness(); h.fetch = async () => new Promise(() => {});
    const result = await h.json({ url: 'https://files.invalid/existing.pdf' });
    assert.equal(result.status, 504); assert.match(result.data.error, /下载超时.*重试/);
    assert.equal(h.downloads.length, 2); assert.ok(h.downloads.every(row => row[1].signal.aborted));
    assert.equal(h.extracts.length, 0);
  });
  await test('parse API retries a dropped download response body without altering extraction logic', async () => {
    const h = routeHarness();
    h.fetch = async () => ({ ok: true, headers: new Map(), arrayBuffer: async () => {
      if (h.downloads.length === 1) throw new TypeError('body dropped'); return Buffer.from('complete bytes');
    } });
    const result = await h.json({ url: 'https://files.invalid/existing.pdf' });
    assert.equal(result.status, 200); assert.equal(h.downloads.length, 2);
    assert.equal(h.extracts[0].buffer.toString(), 'complete bytes');
  });
  await test('parse API rejects empty, declared oversized and streaming oversized attachments before extraction', async () => {
    for (const mode of ['empty', 'declared', 'stream']) {
      const h = routeHarness();
      h.fetch = async () => ({ ok: true,
        headers: new Map(mode === 'declared' ? [['content-length', String(51 * 1024 * 1024)]] : []),
        arrayBuffer: async () => Buffer.alloc(0),
        ...(mode === 'stream' ? { body: { getReader: () => ({
          read: async () => ({ done: false, value: { byteLength: 51 * 1024 * 1024 } }), cancel: async () => {},
        }) } } : {}),
      });
      const result = await h.json({ url: 'https://files.invalid/existing.pdf' });
      assert.equal(result.status, mode === 'empty' ? 400 : 413);
      assert.equal(h.extracts.length, 0); assert.equal(h.downloads.length, 1);
    }
  });
  await test('small FormData parsing remains supported and invalid URLs never download', async () => {
    const h = routeHarness();
    assert.equal((await h.form(file())).status, 200);
    assert.equal((await h.form(file('empty.pdf', 0))).status, 400);
    assert.equal((await h.json({ url: 'https://untrusted.invalid/file.pdf' })).status, 400);
    assert.equal(h.downloads.length, 0); assert.equal(h.extracts.length, 1);
  });
  console.log(`Passed ${passed} resume upload/parse reliability scenarios (offline).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
