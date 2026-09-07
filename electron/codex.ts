import fs from 'node:fs/promises';
import path from 'node:path';
import type { SourceHealth } from '../shared/types.js';
import { Store, type Cursor } from './store.js';

async function filesIn(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(file));
    else if (entry.name.endsWith('.jsonl')) result.push(file);
  }
  return result;
}
export function consumeCodex(record: any, cursor: Cursor, store: Store) {
  const p = record.payload;
  if (!p || !cursor.allowed) return;
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString();
  if (record.type === 'turn_context' && p.turn_id) cursor.turnId = p.turn_id;
  if (record.type === 'event_msg') {
    if (p.type === 'task_started') {
      cursor.turnId = p.turn_id || timestamp;
      cursor.lastAnswer = '';
      store.start({ id: `codex:${cursor.sessionId}:${cursor.turnId}`, source: 'codex', sessionId: cursor.sessionId,
        turnId: cursor.turnId, project: cursor.project, status: 'running', updatedAt: timestamp });
    } else if (p.type === 'task_complete') {
      const answer = typeof p.last_agent_message === 'string' ? p.last_agent_message : cursor.lastAnswer;
      const turnId = p.turn_id || cursor.turnId;
      if (turnId && answer?.trim()) store.finish({ id: `codex:${cursor.sessionId}:${turnId}`, source: 'codex',
        sessionId: cursor.sessionId, turnId, project: cursor.project, answer, completedAt: timestamp });
      else store.status('codex', cursor.sessionId, 'uncertain', '收到了完成事件，但缺少最终答案；请检查 CLI 版本。');
      cursor.lastAnswer = '';
    } else if (['turn_aborted', 'task_aborted'].includes(p.type)) {
      store.status('codex', cursor.sessionId, 'interrupted', '本轮回答已中断');
    } else if (p.type === 'error') {
      store.status('codex', cursor.sessionId, 'failed', 'CLI 报告运行错误，请在终端查看');
    } else store.touch('codex', cursor.sessionId, timestamp);
  }
  if (record.type === 'response_item') {
    store.touch('codex', cursor.sessionId, timestamp);
    if (p.type === 'message' && p.role === 'assistant' && ['final', 'final_answer'].includes(p.phase)) {
      cursor.lastAnswer = Array.isArray(p.content) ? p.content.filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('\n') : '';
    }
  }
}
export class CodexReader {
  health: SourceHealth = { state: 'off', detail: '未开启' };
  constructor(readonly store: Store) {}
  async poll() {
    if (!this.store.data.settings.codex) { this.health = { state: 'off', detail: '未开启' }; return; }
    const root = this.store.data.settings.codexPath;
    try {
      const files = await filesIn(root);
      let incompatible = 0;
      for (const file of files) {
        const stat = await fs.stat(file);
        let cursor = this.store.data.cursors[file];
        if (!cursor || stat.size < cursor.offset) {
          const handle = await fs.open(file, 'r');
          let first: Buffer;
          try { const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024)); const read = await handle.read(buffer, 0, buffer.length, 0); first = buffer.subarray(0, read.bytesRead); }
          finally { await handle.close(); }
          const newline = first.indexOf(10);
          if (newline < 0) continue;
          let meta;
          try { meta = JSON.parse(first.subarray(0, newline).toString('utf8')).payload; } catch { incompatible++; continue; }
          const cli = ['cli', 'exec'].includes(meta?.source) || ['codex-tui', 'codex_exec'].includes(meta?.originator);
          const subagent = typeof meta?.source === 'object' || (meta?.thread_source && meta.thread_source !== 'user');
          cursor = { offset: this.store.data.codexInitialized ? 0 : stat.size, sessionId: meta?.session_id || meta?.id || path.basename(file),
            allowed: Boolean(cli && !subagent), turnId: '', project: meta?.cwd || '', lastAnswer: '' };
          if (!this.store.data.codexInitialized && stat.size) {
            const h = await fs.open(file, 'r');
            try { const last = Buffer.alloc(1); await h.read(last, 0, 1, stat.size - 1); cursor.discardPartial = last[0] !== 10; } finally { await h.close(); }
          }
          this.store.data.cursors[file] = cursor;
        }
        if (!cursor.allowed || stat.size === cursor.offset) continue;
        const handle = await fs.open(file, 'r');
        let bytes: Buffer;
        try { const buffer = Buffer.alloc(Math.min(stat.size - cursor.offset, 8 * 1024 * 1024)); const read = await handle.read(buffer, 0, buffer.length, cursor.offset); bytes = buffer.subarray(0, read.bytesRead); }
        finally { await handle.close(); }
        const end = bytes.lastIndexOf(10);
        if (end < 0) { if (bytes.length === 8 * 1024 * 1024) { cursor.offset += bytes.length; cursor.discardPartial = true; incompatible++; } continue; }
        const lines = bytes.subarray(0, end).toString('utf8').split('\n');
        if (cursor.discardPartial) { lines.shift(); cursor.discardPartial = false; }
        for (const line of lines) {
          if (!line.trim()) continue;
          try { consumeCodex(JSON.parse(line), cursor, this.store); } catch { incompatible++; }
        }
        cursor.offset += end + 1;
      }
      this.store.data.codexInitialized = true;
      this.health = incompatible ? { state: 'error', detail: '部分日志格式无法识别，请检查 Codex CLI 版本。' } : { state: 'ready', detail: '正在监听本地 CLI 会话' };
    } catch (e: any) {
      this.health = { state: e.code === 'ENOENT' ? 'missing' : 'error', detail: e.code === 'ENOENT' ? '未找到会话目录，请先运行 Codex CLI 或选择目录。' : '读取会话失败，请检查目录权限。' };
    }
  }
}
