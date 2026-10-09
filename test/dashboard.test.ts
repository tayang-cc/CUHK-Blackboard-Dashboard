import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOverview, schoolURL, tableRows } from '../src/dashboard/data.js';
import { dashboardHTML } from '../src/dashboard/ui.js';
import type { ReadResult } from '../src/backend.js';
import { Script, runInNewContext } from 'node:vm';

const result = (tool: string, text: string, ok = true): ReadResult => ({ ok, profile: 'fixture', platform: 'blackboard', tool, origin: 'https://blackboard.cuhk.edu.hk', timezone: 'Asia/Hong_Kong', fetchedAt: '2026-10-09T08:00:00Z', cached: false, elapsedMs: 1, coverage: 'fixture', data: { content: [{ type: 'text', text }] }, ...(!ok ? { error: { code: 'AUTH_REQUIRED', message: 'Sign in.' } } : {}) });
test('dashboard merges exact cross-source deadlines but preserves similar and different-course events', () => {
  const data = normalizeOverview({ ok: true, partial: false, scope: {}, results: [
    result('bb_list_courses', '| courseId | name | code | term | available |\n| --- | --- | --- | --- | --- |\n| _1_1 | Sample Course | SAMPLE1 | Term | yes |\n| _2_1 | Other Course | SAMPLE2 | Term | no |'),
    result('bb_todo', '| item | course | due | courseId |\n| --- | --- | --- | --- |\n| Homework 1 | Sample | 2026-10-12T15:59:00.000Z (in 3d) | _1_1 |'),
    result('bb_calendar', '| start | title | calendar |\n| --- | --- | --- |\n| 2026-10-12T15:59:00.000Z | Homework 1 | SAMPLE1: truncated... |\n| 2026-10-12T15:59:00.000Z | Homework 1 Assignment | SAMPLE1: truncated... |\n| 2026-10-12T15:59:00.000Z | Homework 1 | SAMPLE2: truncated... |'),
  ] });
  assert.equal(data.tasks.length, 3);
  assert.deepEqual(data.tasks[0]?.sources, ['待办', '日历']);
  assert.equal(data.tasks[0]?.course, 'Sample Course');
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(data.tasks[0]!.due)), '23:59');
});
test('dashboard preserves failed queries and handles escaped table pipes and announcement bodies', () => {
  assert.deepEqual(tableRows('| name |\n| --- |\n| A \\| B |'), [{ name: 'A | B' }]);
  const data = normalizeOverview({ ok: false, partial: true, scope: {}, results: [result('bb_todo', '', false), result('bb_announcements', 'Coverage: first 20 announcements.\n\n### Sample notice\n**Course** · 2026-10-09T08:00:00Z · source: https://blackboard.cuhk.edu.hk/ultra/courses/_1_1/announcements · *unread*\n\n<script>alert(1)</script>\n\n---\n')] });
  assert.equal(data.errors[0]?.code, 'AUTH_REQUIRED');
  assert.equal(data.announcements[0]?.body, '<script>alert(1)</script>');
  assert.equal(data.announcements[0]?.unread, true);
  assert.equal(data.announcementCoverage, 'Coverage: first 20 announcements.');
});
test('dashboard external link policy rejects foreign, insecure and credential-bearing URLs', () => {
  for (const url of ['javascript:alert(1)', 'http://blackboard.cuhk.edu.hk', 'https://evil.example', 'https://blackboard.cuhk.edu.hk.evil.example', 'https://me:secret@blackboard.cuhk.edu.hk', 'https://blackboard.cuhk.edu.hk:444/']) assert.equal(schoolURL(url), undefined);
  assert.equal(schoolURL('https://blackboard.cuhk.edu.hk/ultra/courses/_1_1/outline'), 'https://blackboard.cuhk.edu.hk/ultra/courses/_1_1/outline');
});
test('dashboard CSP has a unique nonce and remote strings are rendered as text', () => {
  const html = dashboardHTML();
  assert.notEqual(html, dashboardHTML());
  assert.match(html, /context|Blackboard/);
  assert.doesNotMatch(html, /innerHTML|<script src=|https:\/\/fonts/);
  assert.match(html, /n\.textContent=text/);
  assert.match(html, /timeZone:'Asia\/Hong_Kong'/);
  assert.doesNotThrow(() => new Script(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!));
  const splitExpression = html.match(/const split=line=>(.*?);const headers/s)![1]!;
  const cells = runInNewContext('(line=>' + splitExpression + ')(' + JSON.stringify('| A \\| B | pdf |') + ')');
  assert.deepEqual(Array.from(cells), ['A | B', 'pdf']);
  assert.match(html, /r\.text\.split\('\\n'\)/);
});
