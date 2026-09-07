export type Source = 'codex' | 'claude';
export type TaskStatus = 'running' | 'uncertain' | 'complete' | 'failed' | 'interrupted';
export interface Settings {
  codex: boolean; claude: boolean; codexPath: string; claudePath: string;
  displayId: string; topOffset: number; sound: boolean; autoStart: boolean; reducedMotion: boolean;
}
export interface IslandNotification {
  id: string; source: Source; sessionId: string; turnId: string; project: string;
  answer: string; completedAt: string; demo?: boolean;
}
export interface Task {
  id: string; source: Source; sessionId: string; turnId: string; project: string;
  status: TaskStatus; updatedAt: string; detail?: string; demo?: boolean;
}
export interface SourceHealth { state: 'off' | 'ready' | 'missing' | 'error'; detail: string }
export interface Snapshot {
  settings: Settings; notifications: IslandNotification[]; tasks: Task[];
  health: Record<Source, SourceHealth>; displays: { id: string; label: string }[];
  storageError?: string;
  maxPanelHeight?: number;
}
export interface IslandAPI {
  snapshot(): Promise<Snapshot>;
  subscribe(fn: (snapshot: Snapshot) => void): () => void;
  onOpen(fn: (page: 'inbox' | 'settings') => void): () => void;
  onCollapse(fn: () => void): () => void;
  updateSettings(value: Partial<Settings>): Promise<Snapshot>;
  clearNotifications(): Promise<void>;
  dismissTask(id: string): Promise<void>; demo(): Promise<void>;
  setExpanded(expanded: boolean, panelHeight?: number, focus?: boolean): void; setInteractive(interactive: boolean): void;
  chooseDirectory(source: Source): Promise<string | null>;
  openExternal(url: string): Promise<void>; quit(): void;
}
