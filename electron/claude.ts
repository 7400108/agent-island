import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SourceHealth } from '../shared/types.js';
import { Store, atomicWrite } from './store.js';

const EVENTS = ['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd', 'Notification', 'PostToolUse'];
const MARKER = 'agent-island-bridge.ps1';
function ours(hook: any) { return hook?.type === 'command' && typeof hook.command === 'string' && hook.command.includes(MARKER) && hook.command.includes('-Inbox'); }
export function mergeHooks(settings: any, command: string, enabled: boolean) {
  const output = structuredClone(settings);
  if (output.hooks != null && (typeof output.hooks !== 'object' || Array.isArray(output.hooks))) throw new Error('Claude hooks 配置格式无效，未做修改。');
  output.hooks ??= {};
  for (const event of EVENTS) {
    const groups = output.hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new Error(`Claude ${event} 配置格式无效，未做修改。`);
    output.hooks[event] = groups.map((group: any) => {
      if (!Array.isArray(group.hooks)) throw new Error('Claude 钩子配置格式无效，未做修改。');
      return { ...group, hooks: group.hooks.filter((hook: any) => !ours(hook)) };
    }).filter((group: any) => group.hooks.length > 0);
    // An async Stop process can be killed when `claude -p` exits. Terminal events must
    // finish their tiny local spool write before shutdown; they always return exit 0.
    if (enabled) output.hooks[event].push({ hooks: [{ type: 'command', command, timeout: 3, async: !['Stop', 'StopFailure', 'SessionEnd'].includes(event) }] });
    if (!output.hooks[event].length) delete output.hooks[event];
  }
  if (!Object.keys(output.hooks).length) delete output.hooks;
  return output;
}
export class ClaudeHooks {
  health: SourceHealth = { state: 'off', detail: '未开启' };
  constructor(readonly store: Store, readonly bridgeSource: string) {}
  get inbox() { return path.join(this.store.directory, 'events'); }
  get bridge() { return path.join(this.store.directory, MARKER); }
  get command() {
    // Forward slashes keep quoted paths portable through Claude Code's bash command runner.
    const quote = (value: string) => '"' + value.replaceAll('\\', '/').replaceAll('$', '\\$').replaceAll('`', '\\`') + '"';
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${quote(this.bridge)} -Inbox ${quote(this.inbox)}`;
  }
  configure(enabled: boolean, configRoot = this.store.data.settings.claudePath) {
    const file = path.join(configRoot, 'settings.json');
    let original = '';
    if (fs.existsSync(file)) original = fs.readFileSync(file, 'utf8');
    let config: any;
    try { config = original ? JSON.parse(original.replace(/^\uFEFF/, '')) : {}; }
    catch { throw new Error('Claude settings.json 无法解析，已保留原文件，请修复后重试。'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Claude settings.json 必须是一个对象。');
    if (enabled && config.disableAllHooks === true) throw new Error('Claude 已全局禁用 hooks，请在 Claude 中取消禁用后再开启。');
    const merged = mergeHooks(config, this.command, enabled);
    if (enabled) {
      fs.mkdirSync(this.store.directory, { recursive: true });
      fs.copyFileSync(this.bridgeSource, this.bridge);
      fs.mkdirSync(this.inbox, { recursive: true });
    }
    if (JSON.stringify(config) !== JSON.stringify(merged)) {
      if (original) fs.copyFileSync(file, `${file}.agent-island-${Date.now()}.bak`);
      atomicWrite(file, JSON.stringify(merged, null, 2) + '\n');
    }
  }
  inspect(): SourceHealth {
    if (!this.store.data.settings.claude) return { state: 'off', detail: '未开启' };
    try {
      const config = JSON.parse(fs.readFileSync(path.join(this.store.data.settings.claudePath, 'settings.json'), 'utf8').replace(/^\uFEFF/, ''));
      const installed = EVENTS.every(event => config.hooks?.[event]?.some((group: any) => group.hooks?.some((hook: any) => ours(hook) && hook.command === this.command)));
      if (config.disableAllHooks || !installed || !fs.existsSync(this.bridge)) return { state: 'error', detail: '通知钩子缺失或已禁用，请关闭后重新勾选。' };
      return { state: 'ready', detail: '钩子已就绪；已有 CLI 会话可能需要重启' };
    } catch { return { state: 'error', detail: '无法读取 Claude 配置，请检查目录。' }; }
  }
  consume(e: any) {
    if (!e.session_id || e.agent_id || e.agent_transcript_path || !EVENTS.includes(e.hook_event_name)) return;
    const timestamp = e.emitted_at || new Date().toISOString();
    if (Date.parse(timestamp) < Date.parse(this.store.data.claudeEnabledAt)) return;
    const eventKey = `claude-event:${e.event_id}`;
    if (this.store.data.seen[eventKey]) return;
    const sessionId = e.session_id;
    const current = this.store.data.tasks.find(t => t.source === 'claude' && t.sessionId === sessionId);
    if (e.hook_event_name === 'UserPromptSubmit') {
      const turnId = e.prompt_id || e.event_id;
      this.store.start({ id: `claude:${sessionId}:${turnId}`, source: 'claude', sessionId, turnId, project: e.cwd || '', status: 'running', updatedAt: timestamp });
    } else if (e.hook_event_name === 'Stop') {
      const answer = e.last_assistant_message;
      if (typeof answer === 'string' && answer.trim()) {
        const turnId = e.prompt_id || current?.turnId || createHash('sha256').update(sessionId + answer).digest('hex').slice(0, 24);
        this.store.finish({ id: `claude:${sessionId}:${turnId}`, source: 'claude', sessionId, turnId, project: e.cwd || '', answer, completedAt: timestamp });
      } else this.store.status('claude', sessionId, 'uncertain', '此 Claude 版本未返回最终答案，请升级 Claude Code。');
    } else if (e.hook_event_name === 'StopFailure') this.store.status('claude', sessionId, 'failed', 'Claude API 返回错误，请在终端查看');
    else if (e.hook_event_name === 'SessionEnd') this.store.status('claude', sessionId, 'interrupted', '会话已结束');
    else if (e.hook_event_name === 'Notification' && ['permission_prompt', 'idle_prompt'].includes(e.notification_type)) this.store.status('claude', sessionId, 'uncertain', '正在等待你在 Claude 终端中操作');
    else this.store.touch('claude', sessionId, timestamp);
    this.store.data.seen[eventKey] = true;
  }
  poll() {
    this.health = this.inspect();
    if (!this.store.data.settings.claude || !fs.existsSync(this.inbox)) return;
    const events: { file: string; event: any }[] = [];
    for (const name of fs.readdirSync(this.inbox)) {
      if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
      const file = path.join(this.inbox, name);
      try { events.push({ file, event: JSON.parse(fs.readFileSync(file, 'utf8')) }); }
      catch { this.health = { state: 'error', detail: '收到无法解析的通知事件，原文件已保留。' }; }
    }
    events.sort((a, b) => String(a.event.emitted_at).localeCompare(String(b.event.emitted_at)));
    for (const { event } of events) this.consume(event);
    this.store.save();
    // Delete only our processed spool files, after their state and dedup keys are persisted.
    if (!this.store.error) for (const { file } of events) fs.unlinkSync(file);
  }
}
