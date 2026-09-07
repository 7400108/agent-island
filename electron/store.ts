import fs from 'node:fs';
import path from 'node:path';
import type { IslandNotification, Settings, Task } from '../shared/types.js';

export interface Cursor {
  offset: number; sessionId: string; allowed: boolean; turnId: string;
  project: string; lastAnswer: string; discardPartial?: boolean;
}
export interface DiskState {
  version: 1; settings: Settings; notifications: IslandNotification[]; tasks: Task[];
  seen: Record<string, boolean>; cursors: Record<string, Cursor>;
  codexInitialized: boolean; claudeEnabledAt: string;
}
export function defaults(home: string): Settings {
  return { codex: false, claude: false, codexPath: path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions'),
    claudePath: process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), displayId: '', topOffset: 8,
    sound: false, autoStart: false, reducedMotion: false };
}
export function atomicWrite(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, contents, 'utf8');
  fs.renameSync(temp, file);
}
export class Store {
  data: DiskState;
  error = '';
  private lastSaved = '';
  private writeFailed = false;
  constructor(readonly directory: string, home: string) {
    this.data = { version: 1, settings: defaults(home), notifications: [], tasks: [], seen: {}, cursors: {}, codexInitialized: false, claudeEnabledAt: '' };
    const file = path.join(directory, 'state.json');
    if (fs.existsSync(file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved.version !== 1 || !Array.isArray(saved.notifications) || !Array.isArray(saved.tasks) || !saved.settings || !saved.cursors || !saved.seen) throw new Error('invalid');
        this.data = { ...this.data, ...saved, settings: { ...this.data.settings, ...saved.settings } };
        // Preserve all legacy notifications, regardless of their old read flag.
        this.data.notifications = this.data.notifications.map(notification => {
          const { read: _legacyRead, ...retained } = notification as IslandNotification & { read?: boolean };
          return retained;
        });
        this.data.tasks = this.data.tasks.filter(t => !t.demo);
      } catch {
        const backup = `${file}.corrupt-${Date.now()}`;
        fs.copyFileSync(file, backup);
        this.error = '本地数据无法读取，原文件已备份。来源已关闭，请重新开启。';
      }
    }
  }
  save() {
    const next = JSON.stringify(this.data);
    if (next === this.lastSaved) return;
    try {
      atomicWrite(path.join(this.directory, 'state.json'), next); this.lastSaved = next;
      if (this.writeFailed) { this.error = ''; this.writeFailed = false; }
    } catch { this.writeFailed = true; this.error = '本地存储写入失败，请检查磁盘空间和目录权限。'; }
  }
  start(task: Task) {
    if (this.data.seen[task.id]) return;
    const current = this.data.tasks.find(t => t.id === task.id);
    if (!current) this.data.tasks.push(task);
    else if (current.status !== 'complete') Object.assign(current, task);
    this.data.tasks = this.data.tasks.filter(t => t.id === task.id || t.source !== task.source || t.sessionId !== task.sessionId);
  }
  touch(source: string, sessionId: string, timestamp: string) {
    const task = this.data.tasks.find(t => t.source === source && t.sessionId === sessionId);
    if (task && ['running', 'uncertain'].includes(task.status)) { task.updatedAt = timestamp; task.status = 'running'; }
  }
  finish(notification: IslandNotification) {
    const task = this.data.tasks.find(t => t.source === notification.source && t.sessionId === notification.sessionId && t.turnId === notification.turnId);
    if (task) { task.status = 'complete'; task.updatedAt = notification.completedAt; }
    if (this.data.seen[notification.id]) return false;
    this.data.seen[notification.id] = true;
    this.data.notifications.unshift(notification);
    this.data.notifications.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return true;
  }
  status(source: string, sessionId: string, status: Task['status'], detail = '') {
    const task = this.data.tasks.find(t => t.source === source && t.sessionId === sessionId);
    if (task && task.status !== 'complete') { task.status = status; task.detail = detail; }
  }
  expire(now = Date.now()) {
    for (const task of this.data.tasks) {
      if (task.status === 'running' && now - Date.parse(task.updatedAt) > 10 * 60_000) {
        task.status = 'uncertain'; task.detail = '超过 10 分钟没有活动，尚未收到完成事件。';
      }
    }
    this.data.tasks = this.data.tasks.filter(t => !['complete', 'failed', 'interrupted'].includes(t.status) || now - Date.parse(t.updatedAt) < 24 * 60 * 60_000);
  }
  clear() { this.data.notifications = []; }
}
