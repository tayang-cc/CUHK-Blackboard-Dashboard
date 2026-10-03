import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// install.sh downloads with curl; Windows uses install.ps1 instead.
const posix = { skip: process.platform === 'win32' };
const script = await readFile(new URL('../install.sh', import.meta.url), 'utf8');
const definition = script.slice(script.indexOf('# lms_fetch begin'), script.indexOf('# lms_fetch end'));

/** Runs lms_fetch with a fake curl that fails the first `failures` calls after writing one byte (a partial download). */
async function run(failures: number) {
  const directory = await mkdtemp(join(tmpdir(), 'lms-fetch-test-'));
  const log = join(directory, 'curl.log'), count = join(directory, 'count'), out = join(directory, 'package.tar.gz');
  await writeFile(join(directory, 'curl'), `#!/bin/sh
n=$(cat "$COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$COUNT"
printf '%s\\n' "$*" >> "$LOG"
out=''; while [ "$#" -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done
if [ "$n" -le ${failures} ]; then printf 'x' >> "$out"; exit 56; fi
printf 'done' >> "$out"; exit 0
`);
  await writeFile(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n');
  await chmod(join(directory, 'curl'), 0o755); await chmod(join(directory, 'sleep'), 0o755);
  const result = spawnSync('/bin/sh', ['-c', `${definition}\nlms_fetch "$1" "$2"`, 'sh', 'https://github.com/zs-andy/lms-cli/releases/download/v9.0.0/x.tar.gz', out],
    { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, LOG: log, COUNT: count } });
  const calls = (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
  const file = await readFile(out, 'utf8').catch(() => '');
  await rm(directory, { recursive: true, force: true });
  return { status: result.status, calls, file };
}

test('lms_fetch retries and resumes after transient failures', posix, async () => {
  const { status, calls, file } = await run(2);
  assert.equal(status, 0); assert.equal(calls.length, 3, 'two failures, then success');
  assert.equal(file, 'xxdone', 'every attempt continued writing the same file');
  for (const call of calls) assert.match(call, /(^| )-C - /, 'each attempt resumes from the partial file');
});

test('lms_fetch gives up after five attempts with a failure status', posix, async () => {
  const { status, calls } = await run(99);
  assert.notEqual(status, 0); assert.equal(calls.length, 5);
});

test('lms_fetch uses stall-based limits instead of a fixed 180 second total', posix, async () => {
  const [call] = (await run(0)).calls;
  assert(call);
  assert.match(call, /--speed-limit 1024 /); assert.match(call, /--speed-time 60 /); assert.match(call, /--max-time 1800 /);
  assert.doesNotMatch(call, /--max-time 180(?!0)/);
  assert.match(call, /--proto =https --proto-redir =https /); assert.match(call, /--fail /);
});

test('every download in install.sh goes through lms_fetch', posix, () => {
  assert.equal(script.split('\n').filter(line => /^\s*curl\b.*(SHA256SUMS|tar\.gz)/.test(line)).length, 0);
  assert.equal(script.split('\n').filter(line => line.includes('lms_fetch "')).length, 2, 'checksum file and archive');
});
