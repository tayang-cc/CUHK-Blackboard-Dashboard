import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// install.sh resolves the latest version from the release redirect; Windows uses install.ps1 instead.
const posix = { skip: process.platform === 'win32' };
const script = await readFile(new URL('../install.sh', import.meta.url), 'utf8');
const definition = script.split('\n').find(line => line.startsWith('lms_latest_tag()'));
const tag = (headers: string) => spawnSync('/bin/sh', ['-c', `${definition}\nlms_latest_tag`], { input: headers, encoding: 'utf8' }).stdout.trim();
const RELEASE = 'https://github.com/zs-andy/lms-cli/releases';

test('install.sh reads the latest stable tag from the github.com redirect, not the REST API', posix, () => {
  assert(definition, 'lms_latest_tag must be defined in install.sh');
  const resolution = script.split('\n').filter(line => line.includes('releases/latest') && !line.trimStart().startsWith('#'));
  assert.equal(resolution.length, 2, 'one web lookup and one REST fallback');
  assert(resolution[0]!.includes('https://github.com/zs-andy/lms-cli/releases/latest') && resolution[0]!.includes('lms_latest_tag'));
  assert(resolution[1]!.includes('[ -n "$lms_version" ] ||') && resolution[1]!.includes('api.github.com'), 'the REST API is only a fallback');
});

test('lms_latest_tag accepts the redirect headers GitHub sends over HTTP/1.1 and HTTP/2', posix, () => {
  assert.equal(tag(`HTTP/2 302 \r\nlocation: ${RELEASE}/tag/v0.4.4\r\ncache-control: no-cache\r\n\r\n`), 'v0.4.4');
  assert.equal(tag(`HTTP/1.1 302 Found\r\nLocation: ${RELEASE}/tag/v10.20.30\r\n\r\n`), 'v10.20.30');
  assert.equal(tag(`HTTP/2 302\nlocation: ${RELEASE}/tag/v1.2.3\n`), 'v1.2.3');
  assert.equal(tag(`location: ${RELEASE}/tag/v1.0.0\r\nlocation: ${RELEASE}/tag/v9.9.9\r\n`), 'v1.0.0', 'only the first redirect counts');
});

test('lms_latest_tag rejects anything that is not an exact stable tag of this repository', posix, () => {
  for (const location of [
    `${RELEASE}/tag/v1.2.3-rc.1`, `${RELEASE}/tag/v1.2.3+build`, `${RELEASE}/tag/v1.2`, `${RELEASE}/tag/1.2.3`, `${RELEASE}/tag/v1.2.3?x=1`,
    `${RELEASE}/tag/v1.2.3/extra`, `${RELEASE}/tag/v1.2.3;rm`, `${RELEASE}/tag/v1.2.3 `.trimEnd() + '$(id)', RELEASE, `${RELEASE}/latest`,
    'https://evil.example/zs-andy/lms-cli/releases/tag/v1.2.3', 'https://github.com/evil/lms-cli/releases/tag/v1.2.3', 'http://github.com/zs-andy/lms-cli/releases/tag/v1.2.3',
    'https://github.com.evil.example/zs-andy/lms-cli/releases/tag/v1.2.3',
  ]) assert.equal(tag(`HTTP/2 302\r\nlocation: ${location}\r\n`), '', location);
  assert.equal(tag(''), '');
  assert.equal(tag('HTTP/2 404\r\n'), '');
});
