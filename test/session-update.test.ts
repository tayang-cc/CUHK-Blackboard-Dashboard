import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sessionUpdate, resetSessionUpdate, portableAsset, RELEASES_URL, UPDATE_RETRY_MS } from '../src/updates.js';

// A reachable github.com: /releases/latest redirects to v9.0.0 and the assets exist. `checks` counts lookups.
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const reachable = () => {
  const fetcher = Object.assign(async (url: any) => {
    const u = String(url);
    if (u === `${RELEASES_URL}/latest`) { fetcher.checks++; return redirect(`${RELEASES_URL}/tag/v9.0.0`); }
    if (u.startsWith(`${RELEASES_URL}/download/v9.0.0/`)) return redirect('https://release-assets.githubusercontent.com/x');
    throw new Error(`unexpected request ${u}`);
  }, { checks: 0 });
  return fetcher as typeof fetcher & typeof fetch;
};
const unreachable = () => {
  const fetcher = Object.assign(async (url: any) => { if (String(url) === `${RELEASES_URL}/latest`) fetcher.checks++; throw new Error('network down'); }, { checks: 0 });
  return fetcher as typeof fetcher & typeof fetch;
};

beforeEach(() => { delete process.env.LMS_UPDATE_CHECK; resetSessionUpdate(); });

test('a successful session check is fetched once and reused', async () => {
  const fetcher = reachable();
  const first = await sessionUpdate({ fetcher, now: () => 0 });
  assert.equal(first.status, 'available');
  assert.equal(first.asset?.name, portableAsset('9.0.0'));
  assert.equal((await sessionUpdate({ fetcher, now: () => UPDATE_RETRY_MS * 10 })).status, 'available');
  assert.equal(fetcher.checks, 1);
});

test('concurrent first calls share one request', async () => {
  const fetcher = reachable();
  const results = await Promise.all([sessionUpdate({ fetcher, now: () => 0 }), sessionUpdate({ fetcher, now: () => 0 })]);
  assert.deepEqual(results.map(x => x.status), ['available', 'available']);
  assert.equal(fetcher.checks, 1);
});

test('a transient failure is not cached for the whole session and is retried after the delay', async () => {
  const failing = unreachable();
  assert.equal((await sessionUpdate({ fetcher: failing, now: () => 0 })).status, 'unavailable');
  assert.equal((await sessionUpdate({ fetcher: failing, now: () => UPDATE_RETRY_MS - 1 })).status, 'unavailable');
  assert.equal(failing.checks, 1, 'no hammering inside the retry window');
  const working = reachable();
  const retried = await sessionUpdate({ fetcher: working, now: () => UPDATE_RETRY_MS });
  assert.equal(retried.status, 'available');
  assert.equal(working.checks, 1);
  assert.equal((await sessionUpdate({ fetcher: working, now: () => UPDATE_RETRY_MS * 5 })).status, 'available');
  assert.equal(working.checks, 1, 'the successful retry is cached again');
});

test('LMS_UPDATE_CHECK=0 disables the session check without any request', async () => {
  process.env.LMS_UPDATE_CHECK = '0';
  const fetcher = reachable();
  assert.equal((await sessionUpdate({ fetcher, now: () => 0 })).status, 'disabled');
  assert.equal(fetcher.checks, 0);
});
