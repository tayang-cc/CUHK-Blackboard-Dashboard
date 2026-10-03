import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const json = async (path: string) => JSON.parse(await read(path));

test('Claude Code marketplace and plugin stay consistent with the package', async () => {
  const pkg = await json('package.json');
  const market = await json('.claude-plugin/marketplace.json');
  assert.equal(market.name, 'lms-cli');
  assert.equal(market.plugins.length, 1);
  const entry = market.plugins[0];
  assert.equal(entry.source, './plugins/lms-cli-claude');
  const manifest = await json(`${entry.source.slice(2)}/.claude-plugin/plugin.json`);
  assert.equal(manifest.name, entry.name);
  assert.equal(manifest.name, 'lms-cli');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.license, pkg.license);
  assert.equal(entry.version, undefined, 'The version lives in plugin.json only, so it cannot drift');
});

test('Claude Code plugin starts the read-only MCP server and ships its own skill', async () => {
  const mcp = await json('plugins/lms-cli-claude/.mcp.json');
  assert.deepEqual(mcp, { mcpServers: { lms: { command: 'lms', args: ['mcp'] } } });
  const skill = await read('plugins/lms-cli-claude/skills/lms-query/SKILL.md');
  assert.match(skill, /^---\r?\nname: lms-query\r?\n/);
  assert.match(skill, /Do not run `lms ask`/);
  assert.doesNotMatch(skill, /from inside Codex/);
});

test('Claude Code plugin does not alter the Codex plugin surface', async () => {
  const codexMcp = await json('plugins/lms-cli/.mcp.json');
  assert.deepEqual(codexMcp, { mcpServers: { lms: { command: 'lms', args: ['mcp'] } } });
  const codexSkill = await read('plugins/lms-cli/skills/lms-query/SKILL.md');
  assert.match(codexSkill, /from inside Codex/);
});
