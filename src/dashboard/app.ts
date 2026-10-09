import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { Backend } from '../backend.js';
import { getProfile, initProfile } from '../config.js';
import { startLogin, finishLogin } from '../auth/launch.js';
import { LmsError, publicError } from '../errors.js';
import { normalizeOverview, resultText, schoolURL } from './data.js';
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
  let loading: Promise<unknown> | undefined;
  handle('cuhk:load', async (days: unknown) => {
    if (days !== 7 && days !== 14 && days !== 30) throw new LmsError('BAD_INPUT', '请选择 7、14 或 30 天。');
    if (loading) return loading;
    loading = backend.overview(profile, days, true).then(normalizeOverview);
    try { return await loading; } finally { loading = undefined; }
  });
  handle('cuhk:login', async () => {
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
