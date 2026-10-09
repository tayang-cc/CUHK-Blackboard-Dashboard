import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompletionStore, completionKey, completionScope } from '../src/dashboard/completion-store.js';
import { BlackboardClient } from '../vendor/blackboard/src/client/index.js';
import { ConfigSchema } from '../vendor/blackboard/src/config.js';
import type { HttpClient } from '../vendor/blackboard/src/client/http.js';
import type { BbGrade, BbGradeAttemptRow, BbAttempt } from '../vendor/blackboard/src/client/types.js';

function fixture(grades: BbGrade[], history: BbGradeAttemptRow[], attempt?: BbAttempt) {
  const c = new BlackboardClient({} as HttpClient, ConfigSchema.parse({ baseUrl: 'https://learn.example.edu' }));
  c.getColumnGrades = async () => grades;
  c.listGradeAttempts = async () => history;
  c.getAttempt = async () => { if (!attempt) throw new Error('Not readable'); return attempt; };
  return c;
}
test('submission evidence survives missing scalar IDs and unreadable attempt detail', async () => {
  const expanded = await fixture([{ lastAttempt: { id: '_8_1', status: 'NEEDS_GRADING' } }], []).getSubmissionStatus('_1_1', '_2_1');
  assert.equal(expanded.attemptId, '_8_1'); assert.equal(expanded.attemptStatus, 'NEEDS_GRADING');
  const history = await fixture([{ id: '_3_1' }], [{ id: '_8_1', status: 'GRADED' }]).getSubmissionStatus('_1_1', '_2_1');
  assert.equal(history.attemptId, '_8_1'); assert.equal(history.attemptStatus, 'GRADED');
});
test('previously submitted work remains completed when a new draft exists', async () => {
  const s = await fixture([{ id: '_3_1', lastAttemptId: '_9_1', lastAttempt: { id: '_9_1', status: 'IN_PROGRESS' } }], [
    { id: '_9_1', status: 'IN_PROGRESS' }, { id: '_8_1', status: 'NEEDS_GRADING' },
  ]).getSubmissionStatus('_1_1', '_2_1');
  assert.equal(s.attemptId, '_8_1'); assert.equal(s.attemptStatus, 'NEEDS_GRADING');
});
test('a grade label alone still cannot prove a submission and distinct columns remain distinct', async () => {
  const s = await fixture([{ status: 'NEEDS_GRADING' }], []).getSubmissionStatus('_1_1', '_2_1');
  assert.equal(s.submitted, false);
  const task = { title: 'Homework 1', course: 'Sample', courseId: '_1_1', due: '2026-10-12T15:59:00Z', sources: ['日历'] };
  assert.notEqual(completionKey({ ...task, columnId: '_2_1' }), completionKey({ ...task, columnId: '_3_1' }));
  assert.equal(completionKey({ ...task, columnId: '_2_1' }), completionKey({ ...task, columnId: '_2_1', due: '2026-10-15T15:59:00Z' }));
});
test('manual marks persist, isolate accounts, retain false overrides, reset and preserve corrupt data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cuhk-completion-'));
  const previous = process.env.LMS_HOME; process.env.LMS_HOME = dir;
  try {
    const file = join(dir, 'dashboard-completion.json'), store = new CompletionStore(file);
    const accountA = completionScope('cuhk', 'https://blackboard.cuhk.edu.hk', '_1_1');
    const accountB = completionScope('cuhk', 'https://blackboard.cuhk.edu.hk', '_2_1');
    await Promise.all([store.set(accountA, 'task1', true), store.set(accountA, 'task2', false)]);
    assert.deepEqual(await new CompletionStore(file).load(accountA), { task1: true, task2: false });
    assert.deepEqual(await store.load(accountB), {});
    await store.set(accountA, 'task1', null);
    assert.deepEqual(await store.load(accountA), { task2: false });
    await writeFile(file, '{invalid');
    await assert.rejects(store.set(accountA, 'task1', true));
    assert.equal(await readFile(file, 'utf8'), '{invalid');
  } finally { if (previous === undefined) delete process.env.LMS_HOME; else process.env.LMS_HOME = previous; await rm(dir, { recursive: true, force: true }); }
});
