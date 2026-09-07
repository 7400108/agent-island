import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Settings, Snapshot, Source } from '../shared/types.js';
import { Store } from './store.js';
import { CodexReader } from './codex.js';
import { ClaudeHooks } from './claude.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
// A separate path makes the automated desktop smoke run fully isolated from real preferences/hooks.
const dataRoot = process.env.AGENT_ISLAND_TEST_DATA || path.join(app.getPath('appData'), 'Agent Island');
app.setPath('userData', dataRoot);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let win: BrowserWindow;
let tray: Tray;
let store: Store;
let reader: CodexReader;
let hooks: ClaudeHooks;
let expanded = false;
let panelHeight = 64;
let timer: ReturnType<typeof setInterval>;
let lastSnapshot = '';
let runningTick = false;
let updateQueue: Promise<unknown> = Promise.resolve();
let demoBusy = false;

function snapshot(): Snapshot {
  const display = screen.getAllDisplays().find(d => String(d.id) === store.data.settings.displayId) || screen.getPrimaryDisplay();
  return { settings: store.data.settings, notifications: store.data.notifications,
    tasks: store.data.tasks.filter(t => t.status !== 'complete'), health: { codex: reader.health, claude: hooks.health },
    displays: screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: `${d.label || `显示器 ${i + 1}`} · ${d.bounds.width} × ${d.bounds.height}${d.id === screen.getPrimaryDisplay().id ? '（主屏）' : ''}` })),
    storageError: store.error || undefined,
    maxPanelHeight: Math.max(80, Math.min(480, display.workArea.height - store.data.settings.topOffset - 20)) };
}
function broadcast() {
  if (!win || win.isDestroyed()) return;
  const next = JSON.stringify(snapshot());
  if (next !== lastSnapshot) { win.webContents.send('state', JSON.parse(next)); lastSnapshot = next; }
}
function position() {
  if (!win || win.isDestroyed()) return;
  const display = screen.getAllDisplays().find(d => String(d.id) === store.data.settings.displayId) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(expanded ? 520 : 160, area.width);
  const height = Math.min(expanded ? panelHeight + 20 : 60, area.height - Math.min(store.data.settings.topOffset, area.height / 4));
  win.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: area.y + Math.min(store.data.settings.topOffset, Math.floor(area.height / 4)), width, height });
}
function setExpanded(value: boolean, requestedHeight?: number, focus = false) {
  const opening = value && !expanded;
  if (Number.isFinite(requestedHeight)) panelHeight = Math.max(64, Math.min(480, Math.ceil(requestedHeight!)));
  expanded = value;
  position();
  // Content resizing must not steal focus from the user's other windows.
  if (opening) win.setIgnoreMouseEvents(false);
  if (value && focus) win.focus();
}
function open(page: 'inbox' | 'settings') {
  setExpanded(true, undefined, true); win.show(); win.webContents.send('open-page', page);
}
async function tick() {
  if (runningTick) return;
  runningTick = true;
  try {
    const before = store.data.notifications.length;
    await reader.poll(); hooks.poll(); store.expire(); store.save();
    if (store.data.notifications.length > before && store.data.settings.sound) shell.beep();
    broadcast();
  } catch { store.error = '监听暂时失败，将在下一轮自动重试。'; broadcast(); }
  finally { runningTick = false; }
}
async function settings(value: Partial<Settings>) {
  if (!value || typeof value !== 'object') throw new Error('设置格式错误');
  const previous = { ...store.data.settings };
  const next = { ...previous };
  for (const key of ['codex', 'claude', 'sound', 'autoStart', 'reducedMotion'] as const) {
    if (key in value) { if (typeof value[key] !== 'boolean') throw new Error('无效的开关值'); next[key] = value[key]!; }
  }
  if (value.topOffset !== undefined) next.topOffset = Math.max(0, Math.min(120, Math.round(Number(value.topOffset) || 0)));
  if (typeof value.displayId === 'string') next.displayId = value.displayId;
  for (const key of ['codexPath', 'claudePath'] as const) if (typeof value[key] === 'string') {
    if (!path.isAbsolute(value[key]!) || !fs.statSync(value[key]!).isDirectory()) throw new Error('请选择有效的本地目录');
    next[key] = value[key]!;
  }
  if (next.autoStart !== previous.autoStart && !app.isPackaged && next.autoStart) throw new Error('请安装正式版后开启开机启动');
  if (next.claudePath !== previous.claudePath && previous.claude) throw new Error('请先关闭 Claude Code，再更改目录。');
  if (next.claude !== previous.claude) hooks.configure(next.claude, next.claudePath);
  if (next.codex !== previous.codex || next.codexPath !== previous.codexPath) {
    store.data.codexInitialized = false; store.data.cursors = {};
  }
  if (next.claude && !previous.claude) store.data.claudeEnabledAt = new Date().toISOString();
  for (const source of ['codex', 'claude'] as const) if (!next[source]) store.data.tasks = store.data.tasks.filter(t => t.source !== source || t.demo);
  if (next.autoStart !== previous.autoStart) {
    app.setLoginItemSettings({ openAtLogin: next.autoStart, path: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe') });
  }
  store.data.settings = next; store.save(); position();
  await tick(); broadcast(); return snapshot();
}
function registerIPC() {
  const handle = (name: string, fn: (...args: any[]) => any) => ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid sender');
    return fn(...args);
  });
  handle('snapshot', snapshot);
  handle('settings', (value: Partial<Settings>) => {
    updateQueue = updateQueue.catch(() => {}).then(async () => {
      // Do not reset cursors while the async reader is consuming a file.
      while (runningTick) await new Promise(resolve => setTimeout(resolve, 20));
      return settings(value);
    });
    return updateQueue;
  });
  handle('clear-notifications', () => { store.clear(); store.save(); broadcast(); });
  handle('dismiss-task', (id: string) => { store.data.tasks = store.data.tasks.filter(t => t.id !== id || t.status === 'running'); store.save(); broadcast(); });
  handle('directory', async (source: Source) => {
    if (!['codex', 'claude'].includes(source)) return null;
    const result = await dialog.showOpenDialog(win, { title: source === 'codex' ? '选择 Codex sessions 目录' : '选择 Claude 配置目录（.claude）', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('external', async (url: string) => { const parsed = new URL(url); if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) await shell.openExternal(parsed.href); });
  handle('demo', () => {
    if (demoBusy) return;
    demoBusy = true;
    const batch = Date.now();
    for (const [i, source] of (['codex', 'claude'] as const).entries()) {
      const id = `demo:${batch}:${source}`;
      store.start({ id, source, sessionId: id, turnId: id, project: 'agent-island / 演示项目', status: 'running', updatedAt: new Date().toISOString(), demo: true });
      setTimeout(() => {
        store.finish({ id, source, sessionId: id, turnId: id, project: 'agent-island / 演示项目', completedAt: new Date().toISOString(), demo: true,
          answer: i === 0 ? '## 已完成界面优化\n\n灵动岛已经准备就绪。现在可以安心专注，让进度自己来找你。\n\n- 支持 **Codex CLI** 与 **Claude Code**\n- 回答完成后自动汇集到通知中心\n- 支持 Markdown、代码块与一键复制\n\n```typescript\nconst island = { status: "ready", count: 1 };\n```\n\n这是一条测试通知，不是模型的真实回答。' : '## 所有检查已通过\n\n已检查通知计数、自动弹出和清理操作。\n\n| 检查项目 | 结果 |\n| --- | --- |\n| 并行会话 | 通过 |\n| 通知计数 | 通过 |\n| 本地保存 | 通过 |\n\n这是一条测试通知。查看答案不会减少通知数量，顶部按钮可一键清空。' });
        store.save(); if (store.data.settings.sound) shell.beep(); broadcast();
        if (i === 1) demoBusy = false;
      }, 3500 + i * 2000);
    }
    broadcast();
  });
  ipcMain.on('expanded', (e, v, height, focus) => { if (e.sender === win.webContents) setExpanded(Boolean(v), typeof height === 'number' ? height : undefined, focus === true); });
  ipcMain.on('interactive', (e, v) => { if (e.sender === win.webContents) win.setIgnoreMouseEvents(!v, { forward: true }); });
  ipcMain.on('quit', e => { if (e.sender === win.webContents) app.quit(); });
}
if (locked) app.whenReady().then(async () => {
  store = new Store(dataRoot, os.homedir());
  reader = new CodexReader(store);
  hooks = new ClaudeHooks(store, path.join(root, 'resources', 'agent-island-bridge.ps1'));
  const icon = nativeImage.createFromPath(path.join(root, 'resources', 'icon.png'));
  win = new BrowserWindow({ width: 160, height: 60, transparent: true, frame: false, resizable: false,
    maximizable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    show: false, backgroundColor: '#00000000', icon,
    webPreferences: { preload: path.join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('blur', () => { if (expanded) win.webContents.send('collapse'); });
  win.on('close', () => store.save());
  registerIPC();
  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip('Agent Island · 灵动岛');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开通知中心', click: () => open('inbox') }, { label: '设置', click: () => open('settings') }, { type: 'separator' }, { label: '退出 Agent Island', click: () => app.quit() }]));
  tray.on('click', () => open('inbox'));
  const displayChanged = () => { position(); broadcast(); };
  screen.on('display-added', displayChanged);
  screen.on('display-removed', displayChanged);
  screen.on('display-metrics-changed', displayChanged);
  await win.loadFile(path.join(root, 'dist', 'index.html'));
  position(); win.showInactive();
  await tick();
  timer = setInterval(() => void tick(), 2000);
});
app.on('second-instance', () => { if (win) open('inbox'); });
app.on('before-quit', () => { clearInterval(timer); store?.save(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());
