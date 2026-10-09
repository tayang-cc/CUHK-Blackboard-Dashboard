import type { ReadResult } from '../backend.js';

export function resultText(result: ReadResult): string {
  return (result.data?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}
export function tableRows(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) { headers = []; continue; }
    const cells = line.trim().slice(1, -1).split(/(?<!\\)\|/).map(c => c.trim().replaceAll('\\|', '|'));
    if (cells.every(c => /^:?-+:?$/.test(c))) continue;
    if (!headers.length) { headers = cells; continue; }
    rows.push(Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])));
  }
  return rows;
}
export function schoolURL(value: string): string | undefined {
  try { const url = new URL(value); if (url.protocol === 'https:' && url.hostname === 'blackboard.cuhk.edu.hk' && !url.username && !url.password && !url.port) return url.href; } catch {}
}
export function normalizeOverview(input: { results: ReadResult[]; ok: boolean; partial: boolean; scope: unknown }) {
  const find = (tool: string) => input.results.find(r => r.tool === tool);
  const courses = tableRows(find('bb_list_courses') ? resultText(find('bb_list_courses')!) : '').map(row => ({
    id: row.courseId ?? '', name: row.name ?? '', code: row.code ?? '', term: row.term ?? '', available: row.available === 'yes',
    url: schoolURL(`https://blackboard.cuhk.edu.hk/ultra/courses/${encodeURIComponent(row.courseId ?? '')}/outline`),
  }));
  const announcementText = find('bb_announcements') ? resultText(find('bb_announcements')!) : '';
  const announcements = announcementText.split(/^### /m).slice(1).map(block => {
    const lines = block.split('\n'); const meta = lines[1] ?? '';
    const course = meta.match(/^\*\*(.*?)\*\*/)?.[1] ?? '';
    const date = meta.match(/\d{4}-\d\d-\d\dT[\d:.]+Z/)?.[0] ?? '';
    const source = meta.match(/source: (https:\/\/\S+)/)?.[1] ?? '';
    return { title: lines[0] ?? '', course, date, unread: meta.includes('*unread*'), body: lines.slice(2).join('\n').replace(/\n---\s*$/, '').trim(), url: schoolURL(source) };
  });
  const tasks: Array<{ title: string; course: string; courseId: string; due: string; sources: string[]; url?: string }> = [];
  for (const tool of ['bb_todo', 'bb_calendar']) {
    const result = find(tool); if (!result?.ok) continue;
    for (const row of tableRows(resultText(result))) {
      const date = (row.due ?? row.start ?? '').match(/\d{4}-\d\d-\d\dT[\d:.]+Z/)?.[0];
      if (!date || !Number.isFinite(Date.parse(date))) continue;
      const course = courses.find(c => row.courseId ? c.id === row.courseId : row.calendar?.startsWith(c.code + ':'));
      const task = { title: row.item ?? row.title ?? '', course: course?.name ?? row.course ?? row.calendar ?? '', courseId: course?.id ?? row.courseId ?? '', due: date, sources: [tool === 'bb_todo' ? '待办' : '日历'], url: course?.url };
      const duplicate = tasks.find(t => t.title === task.title && t.due === task.due && t.courseId && t.courseId === task.courseId);
      if (duplicate) { if (!duplicate.sources.includes(task.sources[0]!)) duplicate.sources.push(task.sources[0]!); }
      else tasks.push(task);
    }
  }
  tasks.sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  return { ok: input.ok, partial: input.partial, courses, announcements, tasks, scope: input.scope,
    updatedAt: input.results.map(r => r.fetchedAt).sort().at(-1),
    errors: input.results.filter(r => !r.ok).map(r => ({ tool: r.tool, code: r.error?.code ?? 'UPSTREAM_FAILED', message: r.error?.message ?? '查询未完成' })),
    announcementCoverage: announcementText.split('\n').find(line => line.startsWith('Coverage:')) ?? '',
  };
}
