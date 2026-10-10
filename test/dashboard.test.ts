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

const structured = (tool: string, value: Record<string, unknown>, ok = true) => ({ ...result(tool, '', ok), data: { content: [], structuredContent: value } });
test('submission completion requires a submitted attempt and excludes drafts, missing records and failed reads', async () => {
  const { completionFromResult } = await import('../src/dashboard/submissions.js');
  for (const status of ['NEEDS_GRADING', 'GRADED', 'SUBMITTED']) assert.equal(completionFromResult(structured('bb_submission_status', { submitted: true, attemptId: '_9_1', attemptStatus: status })), 'completed');
  assert.equal(completionFromResult(structured('bb_submission_status', { submitted: false, status: 'NEEDS_GRADING' })), 'not-submitted');
  assert.equal(completionFromResult(structured('bb_submission_status', { submitted: true, attemptId: '_9_1', attemptStatus: 'IN_PROGRESS', submittedAt: '2026-10-09T08:00:00Z' })), 'not-submitted');
  assert.equal(completionFromResult(structured('bb_submission_status', { submitted: true, attemptStatus: 'GRADED' })), 'unknown');
  assert.equal(completionFromResult(structured('bb_submission_status', { submitted: true, attemptId: '_9_1', status: 'NEEDS_GRADING', submittedAt: '2026-10-09T08:00:00Z' })), 'unknown');
  assert.equal(completionFromResult(structured('bb_submission_status', { submitted: true, attemptId: '_9_1', attemptStatus: 'GRADED' }, false)), 'unknown');
});

test('submission lookup matches calendar identity exactly, handles ambiguity and isolates failed reads', async () => {
  const { enrichSubmissionStatus } = await import('../src/dashboard/submissions.js');
  const data = normalizeOverview({ ok: true, partial: false, scope: {}, results: [] });
  const due = '2026-10-12T15:59:00Z';
  data.tasks = ['Homework 1', 'Assignment 2', 'Homework 3', 'Homework 4', 'Office hours'].map(title => ({ title, course: 'Sample', courseId: '_1_1', due, sources: ['日历'] }));
  data.tasks.push({ title: 'Long clipped...', course: 'Sample', courseId: '_1_1', columnId: '_7_1', due, sources: ['待办'] });
  const calls: string[] = [];
  await enrichSubmissionStatus(data, async (tool, args) => {
    calls.push(tool + ':' + (args.columnId ?? args.courseId));
    if (tool === 'bb_list_grades') return structured(tool, { courseId: '_1_1', columns: [
      { id: '_2_1', title: 'Homework 1', due },
      { id: '_3_1', title: 'Assignment 2', due },
      { id: '_4_1', title: 'Homework 3', due }, { id: '_5_1', title: 'Homework 3', due },
      { id: '_6_1', title: 'Homework 4', due: '2026-10-13T15:59:00Z' },
    ] });
    if (args.columnId === '_3_1') throw new Error('Network unavailable');
    return structured(tool, { ...args, submitted: true, attemptId: '_9_1', attemptStatus: 'NEEDS_GRADING' });
  });
  assert.deepEqual(data.tasks.map(t => t.completion), ['completed', 'unknown', 'unknown', 'unknown', undefined, 'completed']);
  assert.equal(calls.length, 4);
  assert.equal(data.ok, true);
  assert.equal(data.tasks.length, 6);
});

test('submission lookups deduplicate IDs, limit concurrency and reject mismatched identity', async () => {
  const { enrichSubmissionStatus } = await import('../src/dashboard/submissions.js');
  const data = normalizeOverview({ ok: true, partial: false, scope: {}, results: [] });
  data.tasks = Array.from({ length: 8 }, (_, i) => ({ title: 'Assignment ' + i, course: 'Sample', courseId: '_1_1', columnId: '_' + (i % 4 + 1) + '_1', due: '2026-10-12T15:59:00Z', sources: ['待办'] }));
  let active = 0, max = 0, count = 0;
  await enrichSubmissionStatus(data, async (tool, args) => {
    active++; count++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return structured(tool, { ...args, courseId: '_999_1', submitted: true, attemptId: '_9_1', attemptStatus: 'GRADED' });
  });
  assert.equal(count, 4); assert.equal(max, 3);
  assert.ok(data.tasks.every(t => t.completion === 'unknown'));
});


test('official tool links accept only the two fixed resource identifiers', async () => {
  const { resourceURL } = await import('../src/dashboard/resources.js');
  assert.equal(resourceURL('student-timetable'), 'https://campusapps.itsc.cuhk.edu.hk/store/stu/apps.aspx');
  assert.equal(resourceURL('mobile-app-guide'), 'https://www.itsc.cuhk.edu.hk/all-it/phone-mobile/cuhk-mobile-app-store/');
  for (const value of ['https://evil.example', 'https://campusapps.itsc.cuhk.edu.hk/store/stu/apps.aspx', '__proto__', 'constructor', 'student-timetable?url=x', '', null, {}, ['student-timetable']]) assert.equal(resourceURL(value), undefined);
});
