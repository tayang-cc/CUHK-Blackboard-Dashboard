import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdates, fetchLatestFromWeb, portableAsset, RELEASES_URL, RELEASE_API } from '../src/updates.js';

const LATEST = `${RELEASES_URL}/latest`;
const asset = portableAsset('9.0.0')!;
const downloads = (name: string) => `${RELEASES_URL}/download/v9.0.0/${name}`;
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const apiRelease = () => ({ tag_name: 'v9.0.0', draft: false, prerelease: false, assets: [asset, 'SHA256SUMS.txt'].map(name => ({ name, state: 'uploaded', browser_download_url: downloads(name) })) });

type Route = (url: string) => Response | undefined;
function recorder(route: Route) {
  const urls: string[] = [], inits: any[] = [];
  const fetcher = (async (url: any, init: any) => {
    urls.push(String(url)); inits.push(init);
    const response = route(String(url));
    if (!response) throw new Error(`unexpected request ${url}`);
    return response;
  }) as typeof fetch;
  return { fetcher, urls, inits };
}
const healthy: Route = url => url === LATEST ? redirect(`${RELEASES_URL}/tag/v9.0.0`)
  : url === downloads(asset) || url === downloads('SHA256SUMS.txt') ? redirect('https://release-assets.githubusercontent.com/object') : undefined;
const apiDown = (url: string) => url === RELEASE_API ? new Response('rate limited', { status: 403 }) : undefined;

test('a newer release is found through github.com pages without touching the REST API quota', async () => {
  const { fetcher, urls, inits } = recorder(url => healthy(url) ?? apiDown(url));
  const info = await checkForUpdates({ fetcher, current: '0.4.3' });
  assert.equal(info.status, 'available'); assert.equal(info.latest, '9.0.0');
  assert.equal(info.asset?.name, asset); assert.equal(info.asset?.url, downloads(asset)); assert.equal(info.checksumUrl, downloads('SHA256SUMS.txt'));
  assert(!urls.includes(RELEASE_API), 'the anonymous REST API must not be used while github.com answers');
  assert(urls.every(url => url.startsWith(`${RELEASES_URL}/`)), 'only fixed release URLs are requested');
  for (const init of inits) { assert.equal(init.redirect, 'manual'); assert.deepEqual(Object.keys(init.headers), ['User-Agent']); assert(!JSON.stringify(init).includes('school')); }
});

test('an up-to-date or newer install needs a single request', async () => {
  for (const current of ['9.0.0', '9.0.1']) {
    const { fetcher, urls } = recorder(url => healthy(url) ?? apiDown(url));
    const info = await checkForUpdates({ fetcher, current });
    assert.equal(info.status, current === '9.0.0' ? 'current' : 'ahead'); assert.equal(info.latest, '9.0.0');
    assert.deepEqual(urls, [LATEST]);
  }
});

test('the REST API is only a fallback when github.com pages cannot be reached', async () => {
  const { fetcher, urls } = recorder(url => url === RELEASE_API ? new Response(JSON.stringify(apiRelease()), { status: 200 }) : undefined);
  const info = await checkForUpdates({ fetcher, current: '0.4.3' });
  assert.equal(info.status, 'available'); assert.equal(info.asset?.name, asset);
  assert.equal(urls.at(-1), RELEASE_API);
  assert.equal((await checkForUpdates({ fetcher: recorder(() => undefined).fetcher, current: '0.4.3' })).status, 'unavailable');
});

test('redirects outside GitHub, with extra parts, or to unstable tags are never trusted or followed', async () => {
  const hostile: [string, Route][] = [
    ['foreign latest redirect', url => url === LATEST ? redirect('https://evil.example/zs-andy/lms-cli/releases/tag/v9.0.0') : undefined],
    ['foreign repository', url => url === LATEST ? redirect('https://github.com/evil/lms-cli/releases/tag/v9.0.0') : undefined],
    ['http downgrade', url => url === LATEST ? redirect('http://github.com/zs-andy/lms-cli/releases/tag/v9.0.0') : undefined],
    ['query string', url => url === LATEST ? redirect(`${RELEASES_URL}/tag/v9.0.0?next=1`) : undefined],
    ['prerelease tag', url => url === LATEST ? redirect(`${RELEASES_URL}/tag/v9.0.0-rc.1`) : undefined],
    ['path traversal tag', url => url === LATEST ? redirect(`${RELEASES_URL}/tag/v9.0.0/../../x`) : undefined],
    ['foreign asset host', url => url === LATEST ? redirect(`${RELEASES_URL}/tag/v9.0.0`) : url === downloads(asset) ? redirect('https://evil.example/a') : url === downloads('SHA256SUMS.txt') ? redirect('https://objects.githubusercontent.com/x') : undefined],
  ];
  for (const [name, route] of hostile) {
    const { fetcher, urls } = recorder(url => route(url) ?? apiDown(url));
    const info = await checkForUpdates({ fetcher, current: '0.4.3' });
    assert.notEqual(info.status, 'available', name);
    assert(!urls.some(url => url.includes('evil')), `${name}: untrusted hosts are never contacted`);
  }
});

test('a missing installer or checksum file is reported instead of offering an install', async () => {
  for (const missing of [asset, 'SHA256SUMS.txt']) {
    const { fetcher } = recorder(url => url === downloads(missing) ? new Response('', { status: 404 }) : healthy(url) ?? apiDown(url));
    const info = await checkForUpdates({ fetcher, current: '0.4.3' });
    assert.equal(info.status, 'available'); assert.equal(info.asset, undefined); assert.equal(info.checksumUrl, undefined);
    assert.match(info.message, /尚未发布/);
  }
});

test('no stable release is reported without falling back to the REST API', async () => {
  const { fetcher, urls } = recorder(url => url === LATEST ? redirect(RELEASES_URL) : apiDown(url));
  assert.equal((await checkForUpdates({ fetcher, current: '0.4.3' })).status, 'no-release');
  assert.deepEqual(urls, [LATEST]);
});

test('the web lookup itself rejects pages that are not redirects', async () => {
  for (const response of [new Response('<html>', { status: 200 }), new Response('', { status: 500 }), new Response(null, { status: 302 })]) {
    await assert.rejects(fetchLatestFromWeb((async () => response) as typeof fetch));
  }
});

// Retry policy: one more try on the web pages for network resets and unexpected statuses, never for timeouts or
// validation failures, and only then the REST API.
const flaky = (failures: Array<() => Response | never>, route: Route = healthy) => {
  const queue = [...failures];
  return recorder(url => {
    if (url === LATEST && queue.length) return queue.shift()!();
    return route(url) ?? apiDown(url);
  });
};
const reset = () => { throw new TypeError('fetch failed'); };
const count = (urls: string[], url: string) => urls.filter(x => x === url).length;

test('a connection reset is retried once on the web pages without using the REST API', async () => {
  const { fetcher, urls } = flaky([reset]);
  const info = await checkForUpdates({ fetcher, current: '0.4.3' });
  assert.equal(info.status, 'available'); assert.equal(info.asset?.name, asset);
  assert.equal(count(urls, LATEST), 2); assert(!urls.includes(RELEASE_API));
});

test('an unexpected status from github.com is retried once, including on the asset probes', async () => {
  const { fetcher, urls } = flaky([() => new Response('', { status: 503 })]);
  assert.equal((await checkForUpdates({ fetcher, current: '0.4.3' })).status, 'available');
  assert.equal(count(urls, LATEST), 2); assert(!urls.includes(RELEASE_API));
  let failedOnce = false;
  const probes = recorder(url => { if (url === downloads(asset) && !failedOnce) { failedOnce = true; return new Response('', { status: 502 }); } return healthy(url) ?? apiDown(url); });
  const again = await checkForUpdates({ fetcher: probes.fetcher, current: '0.4.3' });
  assert.equal(again.status, 'available'); assert.equal(again.asset?.name, asset);
  assert.equal(count(probes.urls, LATEST), 2); assert(!probes.urls.includes(RELEASE_API));
});

test('two failures on the web pages fall back to the REST API after exactly two attempts', async () => {
  const { fetcher, urls } = recorder(url => { if (url === RELEASE_API) return new Response(JSON.stringify(apiRelease()), { status: 200 }); throw new TypeError('fetch failed'); });
  const info = await checkForUpdates({ fetcher, current: '0.4.3' });
  assert.equal(info.status, 'available');
  assert.equal(count(urls, LATEST), 2); assert.equal(count(urls, RELEASE_API), 1);
});

test('timeouts and validation failures are not retried', async () => {
  const timeout = flaky([() => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }]);
  assert.equal((await checkForUpdates({ fetcher: timeout.fetcher, current: '0.4.3' })).status, 'unavailable');
  assert.equal(count(timeout.urls, LATEST), 1); assert(timeout.urls.includes(RELEASE_API));
  const hostile = recorder(url => url === LATEST ? redirect('https://evil.example/zs-andy/lms-cli/releases/tag/v9.0.0') : apiDown(url));
  assert.equal((await checkForUpdates({ fetcher: hostile.fetcher, current: '0.4.3' })).status, 'unavailable');
  assert.equal(count(hostile.urls, LATEST), 1); assert(!hostile.urls.some(url => url.includes('evil')));
});
