// Opt-in storage transport check. Never touches business data or delivery queues.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

async function main() {
  if (!process.argv.includes('--isolated-live')) throw new Error('Explicit --isolated-live is required');
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !token) throw new Error('Storage configuration missing');
  const prefix = `codex:send-verification:${randomUUID()}:`;
  const keys = [prefix + 'a', prefix + 'b'];
  const durations = [];
  async function rpc(name, body) {
    const started = Date.now();
    const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: token, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Storage HTTP ${response.status}`);
    const result = await response.json();
    durations.push({ operation: name, ms: Date.now() - started });
    return result;
  }
  try {
    const empty = await rpc('recruit_kv_read', { p_keys: keys });
    assert.ok(keys.every(key => !Object.hasOwn(empty, key)));
    const created = await rpc('recruit_kv_tx', { p_payload: {
      expected: keys.map(key => ({ key, exists: false })),
      writes: keys.map(key => ({ key, value: 'queued', ttlSeconds: 180 })),
    } });
    assert.equal(created.ok, true);
    const concurrent = await Promise.all(keys.map(key => rpc('recruit_kv_tx', { p_payload: {
      expected: [{ key, exists: true, value: 'queued' }],
      writes: [{ key, value: 'sent', ttlSeconds: 180 }],
    } })));
    assert.ok(concurrent.every(result => result.ok));
    // Simulates a retry whose earlier successful receipt was lost.
    const repeated = await rpc('recruit_kv_tx', { p_payload: {
      expected: [{ key: keys[0], exists: true, value: 'queued' }],
      writes: [{ key: keys[0], value: 'duplicate', ttlSeconds: 180 }],
    } });
    assert.equal(repeated.ok, false);
    const confirmed = await rpc('recruit_kv_read', { p_keys: keys });
    assert.ok(keys.every(key => confirmed[key] === 'sent'));
    console.log(JSON.stringify({ result: 'PASS', concurrentAccounts: 2, duplicateWriteRejected: true, durations }));
  } finally {
    // Exact UUID-scoped synthetic keys only; TTL also cleans up a lost response.
    const cleanup = await rpc('recruit_kv_tx', { p_payload: { deletes: keys } });
    assert.equal(cleanup.ok, true);
    console.log('Synthetic verification keys removed; no business data or send queues changed.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
