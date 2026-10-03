import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { download, DOWNLOAD_LIMITS } from '../src/upgrade.js';
import { LmsError, publicError } from '../src/errors.js';
import { RELEASES_URL } from '../src/updates.js';

const url = `${RELEASES_URL}/download/v9.0.0/lms-cli-9.0.0-test.tar.gz`;
const chunk = (index: number, size = 1024) => new Uint8Array(size).fill(index % 251);

/** A response body that emits a chunk every `every` ms; it can end, go silent (stall) or never end. */
function body(options: { every: number; chunks?: number; size?: number; silentAfter?: number }) {
  let sent = 0, timer: NodeJS.Timeout | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        if (options.silentAfter !== undefined && sent >= options.silentAfter) return;
        if (options.chunks !== undefined && sent >= options.chunks) { clearInterval(timer); controller.close(); return; }
        controller.enqueue(chunk(sent++, options.size));
      }, options.every);
    },
    cancel() { clearInterval(timer); },
  });
}

async function setup(t: TestContext, respond: (url: string, signal?: AbortSignal | null) => Response | Promise<Response>) {
  const directory = await mkdtemp(join(tmpdir(), 'lms-download-limits-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(globalThis, 'fetch', async (target: URL | string, init?: RequestInit) => respond(String(target), init?.signal));
  return join(directory, 'package.tar.gz');
}
const failure = async (promise: Promise<unknown>) => {
  try { await promise; } catch (error) { return error as LmsError; }
  assert.fail('expected the download to fail');
};

test('a slow but steady download may outlast the stall limit without failing', async t => {
  const file = await setup(t, () => new Response(body({ every: 40, chunks: 10 })));
  const started = Date.now();
  const digest = await download(url, file, 1024 * 1024, { stallMs: 150, totalMs: 5000 });
  assert(Date.now() - started >= 300, 'the download took longer than the stall limit');
  const expected = createHash('sha256'); for (let i = 0; i < 10; i++) expected.update(chunk(i));
  assert.equal(digest, expected.digest('hex'));
  assert.equal((await readFile(file)).length, 10 * 1024);
});

test('a download that stops receiving data is aborted with a clear, non-INTERNAL error', async t => {
  const file = await setup(t, () => new Response(body({ every: 10, silentAfter: 2 })));
  const started = Date.now();
  const error = await failure(download(url, file, 1024 * 1024, { stallMs: 100, totalMs: 5000 }));
  assert(Date.now() - started < 2000, 'aborted soon after the stall limit, not at the total limit');
  assert(error instanceof LmsError); assert.equal(error.code, 'UPDATE_DOWNLOAD_FAILED');
  assert.match(error.message, /没有收到数据/); assert.match(error.message, /当前版本保持不变/);
  assert.match(error.hint ?? '', /SHA256SUMS\.txt/);
  assert.equal(publicError(error).code, 'UPDATE_DOWNLOAD_FAILED');
});

test('a download that keeps trickling is stopped by the total limit', async t => {
  const file = await setup(t, () => new Response(body({ every: 20 })));
  const started = Date.now();
  const error = await failure(download(url, file, 1024 * 1024 * 1024, { stallMs: 1000, totalMs: 300 }));
  assert(Date.now() - started < 1500);
  assert(error instanceof LmsError); assert.equal(error.code, 'UPDATE_DOWNLOAD_FAILED'); assert.match(error.message, /超过/);
});

test('a stall while waiting for the response headers is also aborted', async t => {
  // Like the real fetch, the pending request must reject when the abort signal fires.
  const file = await setup(t, (_target, signal) => new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))));
  const error = await failure(download(url, file, 1024, { stallMs: 100, totalMs: 5000 }));
  assert(error instanceof LmsError); assert.match(error.message, /没有收到数据/);
});

test('network failures and oversized archives are reported as update download failures', async t => {
  const reset = await setup(t, () => { throw new TypeError('fetch failed'); });
  const networkError = await failure(download(url, reset, 1024));
  assert(networkError instanceof LmsError); assert.equal(networkError.code, 'UPDATE_DOWNLOAD_FAILED'); assert.match(networkError.message, /网络中断/);
  const big = await setup(t, () => new Response(body({ every: 5, chunks: 5, size: 1024 })));
  const tooBig = await failure(download(url, big, 2000));
  assert(tooBig instanceof LmsError); assert.equal(tooBig.code, 'UPDATE_DOWNLOAD_FAILED'); assert.match(tooBig.message, /大小上限/);
});

test('redirect policy is unchanged: GitHub hosts are followed, anything else is refused', async t => {
  const file = await setup(t, target => target.startsWith(`${RELEASES_URL}/`)
    ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/object' } })
    : new Response(body({ every: 5, chunks: 3 })));
  await download(url, file, 1024 * 1024);
  assert.equal((await readFile(file)).length, 3 * 1024);
  const evil = await setup(t, () => new Response(null, { status: 302, headers: { location: 'https://evil.example/a' } }));
  const refused = await failure(download(url, evil, 1024));
  assert(refused instanceof LmsError); assert.equal(refused.code, 'UPDATE_URL_INVALID');
  const foreign = await failure(download('https://evil.example/zs-andy/lms-cli/releases/download/v1/x', evil, 1024));
  assert(foreign instanceof LmsError); assert.equal(foreign.code, 'UPDATE_URL_INVALID');
});

test('the production limits tolerate slow links', () => {
  assert.equal(DOWNLOAD_LIMITS.stallMs, 60_000);
  assert.equal(DOWNLOAD_LIMITS.totalMs, 30 * 60_000);
  // 176 MB at 0.4 MB/s needs about 7.3 minutes: far beyond the old fixed 3 minutes, well within the new total.
  assert((176 / 0.4) * 1000 < DOWNLOAD_LIMITS.totalMs && (176 / 0.4) * 1000 > 180_000);
});
