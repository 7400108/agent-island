import type { IslandAPI, Snapshot } from '../shared/types';
declare global { interface Window { island?: IslandAPI } }

// Browser preview is an explicitly labeled, in-memory demo. Desktop always uses IPC.
let preview: Snapshot = {
  settings: { codex: false, claude: false, codexPath: '~/.codex/sessions', claudePath: '~/.claude', displayId: '', topOffset: 12, sound: false, autoStart: false, reducedMotion: false },
  notifications: [], tasks: [], health: { codex: { state: 'off', detail: '浏览器预览 · 不接入真实会话' }, claude: { state: 'off', detail: '浏览器预览 · 不接入真实会话' } },
  displays: [{ id: 'preview', label: '主显示器 · 1920 × 1080' }]
};
const listeners = new Set<(value: Snapshot) => void>();
const emit = () => { preview = structuredClone(preview); listeners.forEach(fn => fn(preview)); };
const previewAPI: IslandAPI = {
  snapshot: async () => preview,
  subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  onOpen: () => () => {}, onCollapse: () => () => {},
  updateSettings: async value => { Object.assign(preview.settings, value); emit(); return preview; },
  clearNotifications: async () => { preview.notifications = []; emit(); },
  dismissTask: async id => { preview.tasks = preview.tasks.filter(t => t.id !== id); emit(); },
  demo: async () => {
    const batch = Date.now();
    for (const [i, source] of (['codex', 'claude'] as const).entries()) {
      const id = `preview:${batch}:${i}`;
      preview.tasks.push({ id, source, sessionId: id, turnId: id, project: 'agent-island', status: 'running', updatedAt: new Date().toISOString(), demo: true });
      setTimeout(() => {
        preview.tasks = preview.tasks.filter(t => t.id !== id);
        preview.notifications.unshift({ id, source, sessionId: id, turnId: id, project: 'agent-island', demo: true, completedAt: new Date().toISOString(), answer: i === 0 ? '## 已完成界面优化\n\n灵动岛已经准备就绪。现在可以安心专注，让进度自己来找你。\n\n- 支持 **Codex CLI** 与 **Claude Code**\n- 回答完成后自动汇集到通知中心\n- 支持 Markdown、代码块与一键复制\n\n```typescript\nconst island = { status: "ready", count: 1 };\n```\n\n这是一条测试通知，不是模型的真实回答。' : '## 所有检查已通过\n\n已检查通知计数、自动弹出和清理操作。\n\n| 检查项目 | 结果 |\n| --- | --- |\n| 并行会话 | 通过 |\n| 通知计数 | 通过 |\n\n这是一条测试通知。' });
        emit();
      }, 3500 + i * 2000);
    }
    emit();
  },
  setExpanded: () => {}, setInteractive: () => {}, chooseDirectory: async () => null,
  openExternal: async url => { window.open(url, '_blank', 'noopener'); }, quit: () => {}
};
export const isPreview = !window.island;
export const api = window.island || previewAPI;
