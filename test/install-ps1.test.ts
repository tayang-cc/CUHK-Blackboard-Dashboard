import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// install.ps1 resolves the latest version like install.sh: from the github.com redirect, with the REST API as a fallback.
const script = await readFile(new URL('../install.ps1', import.meta.url), 'utf8');
const definition = script.slice(script.indexOf('# lms_latest_tag begin'), script.indexOf('# lms_latest_tag end'));
const windows = { skip: process.platform !== 'win32' };
const RELEASE = 'https://github.com/zs-andy/lms-cli/releases';

test('install.ps1 asks the REST API only when the redirect lookup finds nothing', () => {
  assert(definition.includes('function Get-LmsLatestTag') && definition.includes('function Get-LmsTagFromLocation'));
  assert(definition.includes('AllowAutoRedirect = $false') && definition.includes("'https://github.com/zs-andy/lms-cli/releases/latest'"));
  const lines = script.split('\n');
  const rest = lines.findIndex(line => line.includes('Invoke-RestMethod') && line.includes('api.github.com'));
  assert(rest > 0 && /^\s*if \(!\$Version\) \{\s*$/.test(lines[rest - 1]!), 'the REST lookup sits inside `if (!$Version)`');
  assert(lines.some(line => line.includes('$Version = Get-LmsLatestTag')), 'the redirect lookup runs first');
  assert.equal(lines.filter(line => line.includes('api.github.com')).length, 1);
});

/** Runs the lookup functions from install.ps1 in the given PowerShell and returns one output line per script statement. */
async function powershell(executable: string, body: string, locations: string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'lms-ps1-test-'));
  try {
    const file = join(directory, 'check.ps1');
    await writeFile(file, `$ErrorActionPreference = 'Stop'\n[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12\n${definition}\n${body}\n`);
    const result = spawnSync(executable, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8', env: { ...process.env, LOCATIONS: JSON.stringify(locations) }, timeout: 120_000 });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    assert.equal(result.status, 0, `${executable}: ${result.stderr || result.stdout}`);
    return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const engines = ['powershell.exe', 'pwsh'];

test('Get-LmsTagFromLocation accepts only an exact stable tag URL of this repository', windows, async () => {
  const valid = [`${RELEASE}/tag/v0.4.6`, `${RELEASE}/tag/v10.20.30`];
  const invalid = [`${RELEASE}/tag/v1.2.3-rc.1`, `${RELEASE}/tag/v1.2.3+build`, `${RELEASE}/tag/v1.2`, `${RELEASE}/tag/v01.2.3`, `${RELEASE}/tag/v1.2.3?x=1`, `${RELEASE}/tag/v1.2.3/extra`,
    RELEASE, `${RELEASE}/latest`, 'https://evil.example/zs-andy/lms-cli/releases/tag/v1.2.3', 'https://github.com/evil/lms-cli/releases/tag/v1.2.3',
    'http://github.com/zs-andy/lms-cli/releases/tag/v1.2.3', 'https://github.com.evil.example/zs-andy/lms-cli/releases/tag/v1.2.3', ''];
  let ran = 0;
  for (const engine of engines) {
    const out = await powershell(engine, `$items = $env:LOCATIONS | ConvertFrom-Json\nforeach ($item in @($items)) { 'R:' + (Get-LmsTagFromLocation $item) }`, [...valid, ...invalid]);
    if (!out) continue; ran++;
    assert.deepEqual(out, [...valid.map(location => `R:${location.split('/').pop()}`), ...invalid.map(() => 'R:')], engine);
  }
  assert(ran >= 1, 'at least Windows PowerShell must be available');
});

test('Get-LmsLatestTag resolves the real latest release in Windows PowerShell and PowerShell 7', windows, async () => {
  let ran = 0;
  for (const engine of engines) {
    let tag = '';
    for (let attempt = 0; attempt < 3 && !/^v\d+\.\d+\.\d+$/.test(tag); attempt++) {
      const out = await powershell(engine, "'R:' + (Get-LmsLatestTag)");
      if (!out) break; if (attempt === 0) ran++;
      tag = (out.find(line => line.startsWith('R:')) ?? '').slice(2);
    }
    if (ran) assert.match(tag, /^v\d+\.\d+\.\d+$/, `${engine} should resolve a stable tag`);
  }
  assert(ran >= 1);
});
