import { loadSettings, loadState, saveState } from "./storage";
import { applyAppearance, findTheme } from "./theme";
import { configFromSettings } from "./timer";
import type { TimerConfig } from "./timer";
import type {
  AppState,
  BreakState,
  FinishedRecord,
  Phase,
  Quadrant,
  QuickRun,
  RestartNote,
  Session,
  Settings,
  Task,
  Watch,
} from "./types";

export let state: AppState = loadState();
export let settings: Settings = loadSettings();

export let subView:
  null | { kind: "history" } | { kind: "taskHistory"; taskId: string } | { kind: "dashboard" } =
  null;
export let focusMode = false;
export let resumeHintVisible = true;
export let descriptionHintVisible = true;
export let breakState: BreakState | null = null;
export let quickRun: QuickRun | null = null;

/** 0015/0017/0028: board filter/sort/search state (view-only). */
export let filterPriority: number | null = null;
export let filterQuadrant: Quadrant | null = null;
export let sortBy: "priority" | "type" | "newest" | "manual" = "priority";
export let searchQuery = "";

/** 0037: which task row has its "⋯" menu open. */
export let openMenuTaskId: string | null = null;

/** 0075/0079: which board sections are expanded. Only the "closed" Completed section starts collapsed. */
export type SectionKey = "today" | "open" | "later" | "quick" | "done";
export const SECTION_DEFAULTS: Record<SectionKey, boolean> = {
  today: true,
  open: true,
  later: true,
  quick: true,
  done: false,
};
export let openSections: Record<SectionKey, boolean> = { ...SECTION_DEFAULTS };

export function setSectionOpen(key: SectionKey, open: boolean): void {
  openSections = { ...openSections, [key]: open };
}

/** 0035: hidden-period tracking for the idle nudge. */
export let hiddenAt: number | null = null;
export let hiddenSessionId: string | null = null;

export let lastWatch: Watch | null = null;
export let lastFinished: FinishedRecord | null = null;

export function setState(next: AppState): void {
  state = next;
}

export function setSettings(next: Settings): void {
  settings = next;
}

export function setSubView(next: typeof subView): void {
  subView = next;
}

/** 0081: which History tab is shown (Sessions vs Distractions). */
export let historyTab: "sessions" | "distractions" = "sessions";

export function setHistoryTab(next: "sessions" | "distractions"): void {
  historyTab = next;
}

export function setFocusMode(next: boolean): void {
  focusMode = next;
}

export function setResumeHintVisible(next: boolean): void {
  resumeHintVisible = next;
}

export function setDescriptionHintVisible(next: boolean): void {
  descriptionHintVisible = next;
}

export function setBreakState(next: BreakState | null): void {
  breakState = next;
}

export function setQuickRun(next: QuickRun | null): void {
  quickRun = next;
}

export function setFilterPriority(next: number | null): void {
  filterPriority = next;
}

export function setFilterQuadrant(next: Quadrant | null): void {
  filterQuadrant = next;
}

export function setSortBy(next: typeof sortBy): void {
  sortBy = next;
}

export function setSearchQuery(next: string): void {
  searchQuery = next;
}

export function setOpenMenuTaskId(next: string | null): void {
  openMenuTaskId = next;
}

export function setHiddenAt(next: number | null): void {
  hiddenAt = next;
}

export function setHiddenSessionId(next: string | null): void {
  hiddenSessionId = next;
}

export function setLastWatch(next: Watch | null): void {
  lastWatch = next;
}

export function setLastFinished(next: FinishedRecord | null): void {
  lastFinished = next;
}

export function persist(): void {
  saveState(state);
}

export function activeSession(): Session | null {
  return state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
}

export function taskById(id: string): Task | undefined {
  return state.tasks.find((t) => t.id === id);
}

export function notesFor(sessionId: string): RestartNote[] {
  return state.notes.filter((n) => n.sessionId === sessionId);
}

export function timerConfig(): TimerConfig {
  return configFromSettings(settings);
}

/** 0085: apply the active theme, mode, and font from the current settings. */
export function applyTheme(): void {
  applyAppearance(
    findTheme(settings.themeId, settings.customThemes),
    settings.themeMode,
    settings.font,
  );
}

export type { Phase };
