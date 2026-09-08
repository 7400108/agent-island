import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ChevronUp, ChevronRight, CircleHelp, Copy, Folder, LoaderCircle, Monitor, Play, Power, Settings2, ShieldCheck, Trash2, Volume2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Settings, Snapshot, Source } from '../shared/types';
import { api, isPreview } from './api';

const labels: Record<Source, string> = { codex: 'Codex', claude: 'Claude Code' };
function AgentIcon({ source, small = false }: { source: Source; small?: boolean }) {
  return <span className={`agent-icon ${source} ${small ? 'small' : ''}`} aria-hidden="true">{source === 'codex' ? <svg viewBox="0 0 24 24" fill="none"><path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 4l-4 16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg viewBox="0 0 24 24" fill="none">{Array.from({ length: 10 }, (_, i) => <path key={i} d="M12 3v6" transform={`rotate(${i * 36} 12 12)`} stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>)}</svg>}</span>;
}
function Wave({ source = 'codex' }: { source?: Source }) {
  return <span className={`wave ${source}`} aria-label="智能体正在工作">{[8, 18, 11, 25, 15, 28, 20, 9, 23, 14, 26, 12].map((height, i) => <i key={i} style={{ animationDelay: `${i * -0.19}s`, animationDuration: `${0.9 + (i % 5) * 0.11}s`, '--bar': `${height}px` } as React.CSSProperties}/>)}</span>;
}
function QuietBars() { return <span className="quiet-bars" aria-hidden="true"><i/><i/><i/></span>; }
function time(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
function projectName(value: string) { return value.split(/[\\/]/).filter(Boolean).at(-1) || '本地会话'; }

export function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState<'inbox' | 'settings'>('inbox');
  const [mode, setMode] = useState<'closed' | 'manual' | 'peek'>('closed');
  const modeRef = useRef<'closed' | 'manual' | 'peek'>('closed');
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pulse, setPulse] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const known = useRef<Set<string> | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    if (!expanded || !panelRef.current) return;
    const panel = panelRef.current;
    const observer = new ResizeObserver(() => api.setExpanded(true, panel.getBoundingClientRect().height));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [expanded]);

  const collapse = () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    modeRef.current = 'closed'; setMode('closed'); setExpanded(false);
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => api.setExpanded(false), 350);
  };
  const show = (target: 'inbox' | 'settings' = 'inbox', automatic = false) => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    if (autoTimer.current) clearTimeout(autoTimer.current);
    modeRef.current = automatic ? 'peek' : 'manual'; setMode(modeRef.current);
    api.setExpanded(true, undefined, !automatic); setExpanded(true); setPage(target); setError('');
    if (automatic) {
      requestAnimationFrame(() => panelRef.current?.querySelector('.notification-list')?.scrollTo(0, 0));
      autoTimer.current = setTimeout(collapse, 2000);
    }
  };
  useEffect(() => {
    const receive = (value: Snapshot) => {
      const next = new Set(value.notifications.map(n => n.id));
      if (known.current && value.notifications.some(n => !known.current!.has(n.id))) {
        setPulse(true); setPulseKey(v => v + 1);
        if (modeRef.current !== 'manual') show('inbox', true);
      }
      known.current = next;
      setState(value);
    };
    void api.snapshot().then(receive).catch(() => setError('无法连接桌面服务，请重启程序。'));
    const unstate = api.subscribe(receive);
    const unopen = api.onOpen(show);
    const uncollapse = api.onCollapse(collapse);
    return () => { unstate(); unopen(); uncollapse(); if (autoTimer.current) clearTimeout(autoTimer.current); if (collapseTimer.current) clearTimeout(collapseTimer.current); };
  }, []);
  useEffect(() => { if (!pulse) return; const t = setTimeout(() => setPulse(false), 1800); return () => clearTimeout(t); }, [pulse, pulseKey]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2400); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { collapse(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    const pointer = (e: PointerEvent) => {
      const panel = panelRef.current;
      let inside = panel?.contains(e.target as Node) ?? false;
      if (panel && inside) {
        const bounds = panel.getBoundingClientRect();
        const r = Math.min(parseFloat(getComputedStyle(panel).borderRadius), bounds.height / 2);
        const x = e.clientX - bounds.left, y = e.clientY - bounds.top;
        const dx = Math.max(r - x, 0, x - (bounds.width - r));
        const dy = Math.max(r - y, 0, y - (bounds.height - r));
        inside = dx * dx + dy * dy <= r * r;
      }
      api.setInteractive(inside);
    };
    window.addEventListener('pointermove', pointer);
    const leave = () => api.setInteractive(false);
    document.documentElement.addEventListener('pointerleave', leave);
    return () => { window.removeEventListener('pointermove', pointer); document.documentElement.removeEventListener('pointerleave', leave); };
  }, []);

  if (!state) return <div className="loading-island"><LoaderCircle size={16}/></div>;
  const count = state.notifications.length;
  const running = state.tasks.filter(t => t.status === 'running');
  const attention = state.tasks.filter(t => t.status !== 'running');
  const activeSource = running[0]?.source || state.notifications[0]?.source || 'codex';
  const connected = (['codex', 'claude'] as const).filter(source => state.settings[source]).length;

  async function perform(action: () => Promise<unknown>) {
    try { setError(''); await action(); } catch (e) { setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  }
  async function update(value: Partial<Settings>) {
    setSaving(true);
    await perform(async () => { const next = await api.updateSettings(value); setState(next); });
    setSaving(false);
  }
  function takeOver() {
    if (modeRef.current !== 'peek') return;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    modeRef.current = 'manual'; setMode('manual'); api.setExpanded(true, undefined, true);
  }
  const iconButton = (label: string, icon: React.ReactNode, onClick: () => void, extra = '') => <button type="button" className={`icon-button ${extra}`} title={label} aria-label={label} onClick={onClick}>{icon}</button>;

  return <main style={{ '--panel-max-height': `${state.maxPanelHeight || 480}px` } as React.CSSProperties} className={`${isPreview ? 'preview' : 'desktop'} ${state.settings.reducedMotion ? 'reduced-motion' : ''}`} onPointerDown={e => { if (e.target === e.currentTarget && expanded) collapse(); }}>
    {isPreview && <div className="preview-caption"><span>AGENT ISLAND</span><h1>让进度，轻轻抵达。</h1><p>Windows 灵动岛 · 浏览器交互预览</p><button onClick={() => { void api.demo(); }}>模拟两个智能体任务 <ArrowUpRight size={14}/></button></div>}
    <section ref={panelRef} className={`island compact ${expanded ? 'expanded' : ''} ${pulse ? 'arrival' : ''}`} data-mode={mode} onPointerDownCapture={takeOver} onWheelCapture={takeOver} onKeyDownCapture={takeOver} aria-label="Agent Island 灵动岛" onPointerEnter={() => api.setInteractive(true)}>
      {!expanded && <button className="capsule" title={running.length ? `${running.length} 个智能体正在运行${count ? `，${count} 条通知` : ''}` : count ? `${count} 条回答通知` : attention.length ? '有任务需要关注' : '点击查看通知'} aria-label={`展开灵动岛，${running.length} 个任务进行中，${count} 条通知`} aria-expanded={false} onClick={() => show()}>
        {running.length ? <Wave source={activeSource}/> : <QuietBars/>}
        <span className="capsule-end">{count ? <span className="compact-count">{count > 99 ? '99+' : count}</span> : running.length ? <><AgentIcon source={activeSource} small/>{running.length > 1 && <span className="running-count">{running.length}</span>}</> : attention.length ? <span className="attention-dot"/> : null}</span>
      </button>}
      {expanded && <div className="expanded-content">
        <header className="panel-header compact-header">
          <div className="header-title">{page === 'settings' ? iconButton('返回通知列表', <ArrowLeft size={14}/>, () => setPage('inbox')) : running.length ? <Wave source={activeSource}/> : <QuietBars/>}<h1 className={page === 'inbox' ? 'sr-only' : ''}>{page === 'settings' ? '偏好设置' : '通知中心'}</h1>{page === 'inbox' && <span className="compact-status">{running.length ? `${running.length} 个进行中` : count ? `${count} 条通知` : ''}</span>}</div>
          <div className="header-actions">{page === 'inbox' && iconButton('清空全部通知', <Trash2 size={13}/>, () => void perform(() => api.clearNotifications()))}{page === 'inbox' && iconButton('打开设置', <Settings2 size={13}/>, () => setPage('settings'))}{iconButton('收起', <ChevronUp size={14}/>, collapse)}</div>
        </header>

        {(error || state.storageError) && <div className="error-banner" role="alert"><CircleHelp size={15}/><span>{error || state.storageError}</span>{iconButton('关闭错误提示', <X size={13}/>, () => setError(''))}</div>}

        {page === 'settings' ? <div className="settings scroll-area">
          <div className="section-caption">智能体连接 <span>本地接入</span></div>
          <div className="settings-group agents-group">{(['codex', 'claude'] as const).map(source => <div className="agent-setting" key={source}>
            <div className="setting-line"><AgentIcon source={source}/><div className="setting-text"><strong>{labels[source]}{source === 'codex' && <span className="tiny-label">CLI</span>}</strong><p><span className={`health-dot ${state.health[source].state}`}/>{state.health[source].detail}</p></div><input type="checkbox" className="toggle" aria-label={`开启 ${labels[source]}`} checked={state.settings[source]} disabled={saving} onChange={e => void update({ [source]: e.target.checked })}/></div>
            <button className="path-button" title={source === 'codex' ? state.settings.codexPath : state.settings.claudePath} disabled={saving || (source === 'claude' && state.settings.claude)} onClick={() => void perform(async () => { const directory = await api.chooseDirectory(source); if (directory) await update({ [source === 'codex' ? 'codexPath' : 'claudePath']: directory }); })}><Folder size={12}/><span>{source === 'codex' ? state.settings.codexPath : state.settings.claudePath}</span><ChevronRight size={12}/></button>
          </div>)}</div>
          <p className="setting-note"><ShieldCheck size={13}/>回答仅保存在此电脑。Claude 开关会安装或移除本程序的通知钩子，保留已有配置。</p>
          <div className="section-caption">外观与位置</div>
          <div className="settings-group">
            <label className="setting-row"><span><Monitor size={16}/>显示器</span><select aria-label="显示器" value={state.settings.displayId} disabled={saving} onChange={e => void update({ displayId: e.target.value })}><option value="">跟随主显示器</option>{state.displays.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
            <label className="setting-row offset-row"><span>顶部间距 <small>{state.settings.topOffset} px</small></span><input aria-label="顶部间距" type="range" min="0" max="120" step="2" value={state.settings.topOffset} disabled={saving} onChange={e => void update({ topOffset: Number(e.target.value) })}/></label>
            <label className="setting-row"><span>减少动态效果</span><input className="toggle" type="checkbox" checked={state.settings.reducedMotion} disabled={saving} onChange={e => void update({ reducedMotion: e.target.checked })}/></label>
          </div>
          <div className="section-caption">通知与启动</div>
          <div className="settings-group"><label className="setting-row"><span><Volume2 size={16}/>完成提示音</span><input className="toggle" type="checkbox" checked={state.settings.sound} disabled={saving} onChange={e => void update({ sound: e.target.checked })}/></label><label className="setting-row"><span><Power size={16}/>开机启动</span><input className="toggle" type="checkbox" checked={state.settings.autoStart} disabled={saving} onChange={e => void update({ autoStart: e.target.checked })}/></label></div>
          <button className="test-button" onClick={() => { void perform(() => api.demo()); collapse(); setToast('测试任务已开始'); }}><Play size={14}/>发送测试通知<span>体验运行与完成效果</span></button>
          <div className="settings-footer"><span>AGENT ISLAND <small>1.3.0</small></span><button onClick={() => api.quit()}>退出程序</button></div>
        </div> : <>
          <div className="notification-list scroll-area">
            {!!running.length && <div className="live-section"><div className="live-label"><span className="live-dot"/>正在进行 <span>{running.length}</span></div>{running.map(task => <div className="live-task" key={task.id}><AgentIcon source={task.source} small/><div><strong>{labels[task.source]}{task.demo && <small>测试</small>}</strong><p>{projectName(task.project)}</p></div><Wave source={task.source}/></div>)}</div>}
            {attention.map(task => <div className="attention-task" key={task.id}><CircleHelp size={15}/><div><strong>{labels[task.source]} · {task.status === 'failed' ? '运行出错' : task.status === 'interrupted' ? '已中断' : '状态待确认'}</strong><p>{task.detail || '请在终端查看任务状态'}</p></div>{iconButton('移除状态提示', <X size={13}/>, () => void perform(() => api.dismissTask(task.id)))}</div>)}
            {count ? <div className="cards">{state.notifications.map(n => <article className="notification-card" key={n.id}>
              <div className="card-meta"><AgentIcon source={n.source} small/><strong>{labels[n.source]}</strong>{n.demo && <span className="tiny-label">测试</span>}<span className="card-project" title={n.project}>{projectName(n.project)}</span><time>{time(n.completedAt)}</time>{iconButton(`复制 ${labels[n.source]} 回答`, <Copy size={12}/>, () => void perform(async () => { await navigator.clipboard.writeText(n.answer); setToast('答案已复制'); }))}</div>
              <div className="answer inline-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span className="image-placeholder">[图片：{alt || '未加载远程图片'}]</span>, a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href) void perform(() => api.openExternal(href)); }}>{children}<ArrowUpRight size={11}/></a> }}>{n.answer}</ReactMarkdown></div>
            </article>)}</div> : !running.length && !attention.length && <div className="empty-state"><span>暂无通知</span>{!connected && <button onClick={() => setPage('settings')}>连接智能体<ChevronRight size={11}/></button>}</div>}

          </div>
        </>}
      </div>}
    </section>
    {toast && expanded && <div className="toast" role="status"><Check size={13}/>{toast}</div>}
    {error && !expanded && <button className="collapsed-error" onClick={() => show('settings')}>接入异常，点击查看</button>}
  </main>;
}
