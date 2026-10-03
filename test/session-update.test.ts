import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sessionUpdate, resetSessionUpdate, UPDATE_RETRY_MS } from '../src/updates.js';

const newer = () => new Response(JSON.stringify({ tag_name: 'v9.0.0', draft: false, prerelease: false, assets: [] }), { status: 200 });
const counting = (respond: () => Response | Promise<Response>) => {
  const fetcher = Object.assign(async () => { fetcher.calls++; return respond(); }, { calls: 0 });
  return fetcher as typeof fetcher & typeof fetch;
};

beforeEach(() => { delete process.env.LMS_UPDATE_CHECK; resetSessionUpdate(); });

test('a successful session check is fetched once and reused', async () => {
  const fetcher = counting(newer);
  const first = await sessionUpdate({ fetcher, now: () => 0 });
  assert.equal(first.status, 'available');
  assert.equal((await sessionUpdate({ fetcher, now: () => UPDATE_RETRY_MS * 10 })).status, 'available');
  assert.equal(fetcher.calls, 1);
});

test('concurrent first calls share one request', async () => {
  const fetcher = counting(newer);
  const results = await Promise.all([sessionUpdate({ fetcher, now: () => 0 }), sessionUpdate({ fetcher, now: () => 0 })]);
  assert.deepEqual(results.map(x => x.status), ['available', 'available']);
  assert.equal(fetcher.calls, 1);
});

test('a transient failure is not cached for the whole session and is retried after the delay', async () => {
  const failing = counting(() => { throw new Error('network down'); });
  assert.equal((await sessionUpdate({ fetcher: failing, now: () => 0 })).status, 'unavailable');
  assert.equal((await sessionUpdate({ fetcher: failing, now: () => UPDATE_RETRY_MS - 1 })).status, 'unavailable');
  assert.equal(failing.calls, 1, 'no hammering inside the retry window');
  const working = counting(newer);
  const retried = await sessionUpdate({ fetcher: working, now: () => UPDATE_RETRY_MS });
  assert.equal(retried.status, 'available');
  assert.equal(working.calls, 1);
  assert.equal((await sessionUpdate({ fetcher: working, now: () => UPDATE_RETRY_MS * 5 })).status, 'available');
  assert.equal(working.calls, 1, 'the successful retry is cached again');
});

test('LMS_UPDATE_CHECK=0 disables the session check without any request', async () => {
  process.env.LMS_UPDATE_CHECK = '0';
  const fetcher = counting(newer);
  assert.equal((await sessionUpdate({ fetcher, now: () => 0 })).status, 'disabled');
  assert.equal(fetcher.calls, 0);
});
