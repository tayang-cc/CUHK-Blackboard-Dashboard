import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { Backend } from '../backend.js';
import { getProfile, initProfile } from '../config.js';
import { startLogin, finishLogin } from '../auth/launch.js';
import { LmsError, publicError } from '../errors.js';
import { normalizeOverview, resultText, schoolURL, tableRows } from './data.js';
import { enrichSubmissionStatus } from './submissions.js';
import { CompletionStore, completionKey, completionScope } from './completion-store.js';
import { dashboardHTML } from './ui.js';

export async function startDashboard() {
  await app.whenReady();
  await initProfile({ preset: 'cuhk' });
  const profile = await getProfile('cuhk');
  if (profile.blackboard !== 'https://blackboard.cuhk.edu.hk') throw new LmsError('BAD_INPUT', 'CUHK 配置的学校网址不匹配。');
  const backend = new Backend();
  const win = new BrowserWindow({ title: 'CUHK · 学习空间', width: 1240, height: 850, minWidth: 800, minHeight: 600, show: false,
    backgroundColor: '#f6f4f9', webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  const handle = (name: string, action: (...args: any[]) => Promise<unknown>) => {
    ipcMain.handle(name, async (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown sender');
      try { return await action(...args); } catch (error) { return { ok: false, error: publicError(error) }; }
    });
  };
  const completionStore = new CompletionStore();
  let manualScope: string | undefined;
  let visibleKeys = new Set<string>();
  let loading: Promise<unknown> | undefined;
  handle('cuhk:load', async (days: unknown) => {
    if (days !== 7 && days !== 14 && days !== 30) throw new LmsError('BAD_INPUT', '请选择 7、14 或 30 天。');
    if (loading) return loading;
    loading = (async () => {
      const [overview, identity] = await Promise.all([
        backend.overview(profile, days, true), backend.call(profile, 'bb_whoami', {}, { fresh: true }),
      ]);
      const data = await enrichSubmissionStatus(normalizeOverview(overview), (tool, args) => backend.call(profile, tool, args, { fresh: true }));
      const userId = identity.ok ? tableRows(resultText(identity)).find(r => r.field === 'user id')?.value : undefined;
      manualScope = userId ? completionScope(profile.id, profile.blackboard!, userId) : undefined;
      visibleKeys = new Set();
      let marks: Record<string, boolean> = {};
      if (manualScope) {
        try { marks = await completionStore.load(manualScope); }
        catch { manualScope = undefined; data.errors.push({ tool: 'manual-completion', code: 'LOCAL_READ_FAILED', message: '本机完成标记无法读取，暂时不能手动勾选。' }); }
      }
      for (const task of data.tasks) {
        task.manualKey = completionKey(task); task.manualAvailable = !!manualScope;
        task.manualCompletion = marks[task.manualKey]; visibleKeys.add(task.manualKey);
      }
      return data;
    })();
    try { return await loading; } finally { loading = undefined; }
  });
  handle('cuhk:complete', async (key: unknown, value: unknown) => {
    if (loading || !manualScope || typeof key !== 'string' || !visibleKeys.has(key) || (value !== null && typeof value !== 'boolean')) throw new LmsError('BAD_INPUT', '请刷新后再设置完成标记。');
    await completionStore.set(manualScope, key, value);
    return { ok: true };
  });
  handle('cuhk:login', async () => {
    manualScope = undefined; visibleKeys.clear();
    const job = startLogin(profile, 'blackboard');
    const state = await finishLogin(job.id);
    return { ok: state === 'finished', state };
  });
  handle('cuhk:course', async (id: unknown, resource: unknown) => {
    if (typeof id !== 'string' || !/^_\d+_\d+$/.test(id) || (resource !== 'content' && resource !== 'files')) throw new LmsError('BAD_INPUT', '课程或查询类型无效。');
    const result = await backend.call(profile, resource === 'content' ? 'bb_list_content' : 'bb_list_files', { courseId: id }, { fresh: true });
    return { ok: result.ok, text: result.ok ? resultText(result) : '', error: result.error };
  });
  handle('cuhk:open', async (value: unknown) => {
    const url = typeof value === 'string' ? schoolURL(value) : undefined;
    if (!url) throw new LmsError('BAD_INPUT', '仅支持打开 CUHK Blackboard 链接。');
    await shell.openExternal(url); return { ok: true };
  });
  win.on('closed', () => { void backend.close(); });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(dashboardHTML()));
  win.show(); win.focus();
}
