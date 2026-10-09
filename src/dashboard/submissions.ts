import type { ReadResult } from '../backend.js';
import type { DashboardTask, normalizeOverview } from './data.js';

type Read = (tool: string, args: Record<string, unknown>) => Promise<ReadResult>;
const validId = (id: unknown): id is string => typeof id === 'string' && /^_\d+_\d+$/.test(id);

/** A grade or NEEDS_GRADING label alone is not evidence of a submission. */
export function completionFromResult(result: ReadResult): NonNullable<DashboardTask['completion']> {
  const data = result.ok ? result.data?.structuredContent : undefined;
  if (!data || typeof data.submitted !== 'boolean') return 'unknown';
  const status = typeof data.attemptStatus === 'string' ? data.attemptStatus.toUpperCase() : '';
  if (['IN_PROGRESS', 'DRAFT', 'NOT_ATTEMPTED'].includes(status)) return 'not-submitted';
  if (!data.submitted) return 'not-submitted';
  // Require an actual attempt and an explicit submitted state. attemptDate can
  // also be a draft creation date, so a timestamp alone is insufficient.
  if (!validId(data.attemptId)) return 'unknown';
  if (['NEEDS_GRADING', 'GRADED', 'SUBMITTED', 'COMPLETED'].includes(status) ||
      (typeof data.submissionReceiptDate === 'string' && Number.isFinite(Date.parse(data.submissionReceiptDate)))) return 'completed';
  return 'unknown';
}

async function bounded<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

export async function enrichSubmissionStatus(data: ReturnType<typeof normalizeOverview>, read: Read) {
  for (const task of data.tasks) if (task.columnId || /assignment|homework|作业|作業/i.test(task.title)) task.completion = 'unknown';
  const courses = [...new Set(data.tasks.filter(t => !t.columnId && validId(t.courseId)).map(t => t.courseId))].slice(0, 15);
  await bounded(courses, async courseId => {
    try {
      const result = await read('bb_list_grades', { courseId });
      const content = result.ok ? result.data?.structuredContent : undefined;
      if (content?.courseId !== courseId || !Array.isArray(content.columns)) return;
      for (const task of data.tasks.filter(t => t.courseId === courseId && !t.columnId)) {
        const matches = content.columns.filter(c => c && validId(c.id) && c.title === task.title &&
          typeof c.due === 'string' && Date.parse(c.due) === Date.parse(task.due));
        // Calendar meetings and ambiguous same-name columns remain unclassified.
        if (matches.length === 1) { task.columnId = matches[0].id; task.completion = 'unknown'; }
      }
    } catch { /* Keep deadlines visible even if a course cannot be queried. */ }
  });
  const tasks = data.tasks.filter(t => validId(t.courseId) && validId(t.columnId));
  const keys = [...new Map(tasks.map(t => [JSON.stringify([t.courseId, t.columnId]), t])).values()].slice(0, 80);
  await bounded(keys, async task => {
    let completion: DashboardTask['completion'] = 'unknown';
    try {
      const result = await read('bb_submission_status', { courseId: task.courseId, columnId: task.columnId });
      const identity = result.data?.structuredContent;
      if (identity?.courseId === task.courseId && identity.columnId === task.columnId) completion = completionFromResult(result);
    } catch { /* Unknown is not the same as not submitted. */ }
    for (const related of tasks) if (related.courseId === task.courseId && related.columnId === task.columnId) related.completion = completion;
  });
  return data;
}
