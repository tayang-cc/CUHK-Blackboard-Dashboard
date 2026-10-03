import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { download } from '../src/upgrade.js';
import { LmsError } from '../src/errors.js';
import { RELEASES_URL } from '../src/updates.js';

const url = `${RELEASES_URL}/download/v9.0.0/lms-cli-9.0.0-test.tar.gz`;
const FULL = Buffer.alloc(10 * 1024); for (let i = 0; i < FULL.length; i++) FULL[i] = (i * 31 + 7) % 251;
const DIGEST = createHash('sha256').update(FULL).digest('hex');
const fast = { stallMs: 150, totalMs: 20_000, attempts: 5, retryDelayMs: 5 };

/** Emits `bytes` in 1 KiB chunks. `cutAfter` stops early (with an error, or a clean close), `stallAfter` goes silent. */
function body(bytes: Uint8Array, options: { cutAfter?: number; error?: boolean; stallAfter?: number } = {}) {
  let sent = 0, timer: NodeJS.Timeout | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        if (options.stallAfter !== undefined && sent >= options.stallAfter) return;
        if (options.cutAfter !== undefined && sent >= options.cutAfter) { clearInterval(timer); if (options.error) controller.error(new TypeError('terminated')); else controller.close(); return; }
        if (sent >= bytes.length) { clearInterval(timer); controller.close(); return; }
        controller.enqueue(bytes.subarray(sent, sent + 1024)); sent += 1024;
      }, 4);
    },
    cancel() { clearInterval(timer); },
  });
}
const whole = (options: Parameters<typeof body>[1] = {}) => new Response(body(FULL, options), { status: 200, headers: { 'content-length': String(FULL.length) } });
const partial = (from: number, options: Parameters<typeof body>[1] = {}) => new Response(body(FULL.subarray(from), options), { status: 206, headers: { 'content-range': `bytes ${from}-${FULL.length - 1}/${FULL.length}`, 'content-length': String(FULL.length - from) } });

type Call = { n: number; url: string; range?: number; headers: Record<string, string> };
async function setup(t: TestContext, handler: (call: Call) => Response | Promise<Response>) {
  const directory = await mkdtemp(join(tmpdir(), 'lms-download-resume-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls: Call[] = [];
  t.mock.method(globalThis, 'fetch', async (target: URL | string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const range = /^bytes=(\d+)-$/.exec(headers.Range ?? '')?.[1];
    const call = { n: calls.length + 1, url: String(target), range: range === undefined ? undefined : Number(range), headers };
    calls.push(call);
    return handler(call);
  });
  return { file: join(directory, 'package.tar.gz'), calls };
}
const failure = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error as LmsError; } assert.fail('expected the download to fail'); };
const assertComplete = async (file: string, digest: string) => { assert.equal(digest, DIGEST); assert(Buffer.from(await readFile(file)).equals(FULL), 'the file is exactly the full archive'); };

test('a connection reset resumes from the bytes already on disk instead of starting over', async t => {
  const { file, calls } = await setup(t, call => call.n === 1 ? whole({ cutAfter: 3 * 1024, error: true }) : partial(call.range!));
  await assertComplete(file, await download(url, file, 1024 * 1024, fast));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.headers, { 'User-Agent': 'lms-cli-updater' }, 'the first request has no Range header');
  assert(calls[1]!.range! > 0 && calls[1]!.range! <= 3 * 1024, `resumed at ${calls[1]!.range}`);
  assert.equal(calls[1]!.headers.Range, `bytes=${calls[1]!.range}-`);
});

test('a stalled transfer is resumed', async t => {
  const { file, calls } = await setup(t, call => call.n === 1 ? whole({ stallAfter: 2 * 1024 }) : partial(call.range!));
  await assertComplete(file, await download(url, file, 1024 * 1024, fast));
  assert.equal(calls.length, 2); assert(calls[1]!.range! > 0);
});

test('a body that closes before its Content-Length is resumed', async t => {
  const { file, calls } = await setup(t, call => call.n === 1 ? whole({ cutAfter: 4 * 1024 }) : partial(call.range!));
  await assertComplete(file, await download(url, file, 1024 * 1024, fast));
  assert.equal(calls.length, 2);
});

test('a server that ignores Range makes the download restart without duplicating bytes', async t => {
  const { file, calls } = await setup(t, call => call.n === 1 ? whole({ cutAfter: 3 * 1024, error: true }) : whole());
  await assertComplete(file, await download(url, file, 1024 * 1024, fast));
  assert.equal(calls.length, 2); assert(calls[1]!.range! > 0);
});

test('416 and a Content-Range that does not match both discard the partial file and start over', async t => {
  const rejected = await setup(t, call => call.n === 1 ? whole({ cutAfter: 3 * 1024, error: true }) : call.n === 2 ? new Response('', { status: 416 }) : whole());
  await assertComplete(rejected.file, await download(url, rejected.file, 1024 * 1024, fast));
  assert.equal(rejected.calls.length, 3); assert.equal(rejected.calls[2]!.range, undefined, 'the third request starts from zero');
  t.mock.restoreAll();
  const wrong = await setup(t, call => call.n === 1 ? whole({ cutAfter: 3 * 1024, error: true }) : call.n === 2
    ? new Response(body(FULL), { status: 206, headers: { 'content-range': `bytes 0-${FULL.length - 1}/${FULL.length}` } }) : whole());
  await assertComplete(wrong.file, await download(url, wrong.file, 1024 * 1024, fast));
  assert.equal(wrong.calls.length, 3); assert.equal(wrong.calls[2]!.range, undefined);
});

test('Range survives redirects to the release CDN', async t => {
  const { file, calls } = await setup(t, call => call.n === 1 ? whole({ cutAfter: 3 * 1024, error: true })
    : call.url.startsWith(RELEASES_URL) ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/object' } }) : partial(call.range!));
  await assertComplete(file, await download(url, file, 1024 * 1024, fast));
  assert.equal(calls.length, 3); assert.equal(calls[2]!.url, 'https://release-assets.githubusercontent.com/object');
  assert.equal(calls[2]!.headers.Range, calls[1]!.headers.Range, 'the CDN request carries the same Range header');
});

test('5xx answers are retried, other client errors and an unrequested 206 are final', async t => {
  const flaky = await setup(t, call => call.n === 1 ? new Response('', { status: 503 }) : whole());
  await assertComplete(flaky.file, await download(url, flaky.file, 1024 * 1024, fast));
  assert.equal(flaky.calls.length, 2);
  t.mock.restoreAll();
  const missing = await setup(t, () => new Response('', { status: 404 }));
  const notFound = await failure(download(url, missing.file, 1024, fast));
  assert(notFound instanceof LmsError); assert.equal(notFound.code, 'UPDATE_DOWNLOAD_FAILED'); assert.equal(missing.calls.length, 1);
  t.mock.restoreAll();
  const unrequested = await setup(t, () => partial(0));
  const refused = await failure(download(url, unrequested.file, 1024 * 1024, fast));
  assert(refused instanceof LmsError); assert.equal(unrequested.calls.length, 1);
});

test('it gives up after the configured attempts with a clear message', async t => {
  const { file, calls } = await setup(t, call => call.n === 1 ? whole({ cutAfter: 3 * 1024, error: true }) : partial(call.range!, { cutAfter: 1024, error: true }));
  const error = await failure(download(url, file, 1024 * 1024, { ...fast, attempts: 3 }));
  assert(error instanceof LmsError); assert.equal(error.code, 'UPDATE_DOWNLOAD_FAILED');
  assert.match(error.message, /已尝试 3 次/); assert.match(error.message, /当前版本保持不变/); assert.match(error.hint ?? '', /SHA256SUMS\.txt/);
  assert.equal(calls.length, 3);
});

test('the total time budget is shared by all attempts', async t => {
  const { file, calls } = await setup(t, () => whole({ stallAfter: 1024 }));
  const started = Date.now();
  const error = await failure(download(url, file, 1024 * 1024, { stallMs: 50, totalMs: 500, attempts: 100, retryDelayMs: 50 }));
  assert(error instanceof LmsError); assert.match(error.message, /超过/);
  assert(Date.now() - started < 2500); assert(calls.length < 100);
});

test('it never continues onto a file it did not create, and the size cap covers resumed bytes', async t => {
  const existing = await setup(t, () => whole());
  await writeFile(existing.file, 'unrelated');
  const refused = await failure(download(url, existing.file, 1024 * 1024, fast));
  assert(refused instanceof LmsError); assert.match(refused.message, /已存在/); assert.equal(existing.calls.length, 1);
  assert.equal(await readFile(existing.file, 'utf8'), 'unrelated');
  t.mock.restoreAll();
  const capped = await setup(t, call => call.n === 1 ? whole({ cutAfter: 3 * 1024, error: true }) : partial(call.range!));
  const tooBig = await failure(download(url, capped.file, 8 * 1024, fast));
  assert(tooBig instanceof LmsError); assert.equal(tooBig.code, 'UPDATE_DOWNLOAD_FAILED');
});
