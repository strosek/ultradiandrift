export type Quadrant = "q1" | "q2" | "q3" | "q4";

export type Technique = "pomodoro" | "flowtime";

export type SessionStatus = "running" | "paused" | "done";

/** 0085: a light/dark variant. `dark` renders under `:root`, `light` under `[data-theme="day"]`. */
export type ThemeMode = "dark" | "light";

/** 0085: the color tokens a theme controls (CSS custom properties without the `--`). */
export const THEME_TOKENS = [
  "bg-glow",
  "bg",
  "bg-soft",
  "surface",
  "surface-2",
  "border",
  "text",
  "text-dim",
  "text-faint",
  "accent",
  "accent-hover",
  "accent-bright",
  "on-accent",
  "moss",
  "leaf",
  "earth",
  "clay",
  "gold",
  "danger",
  "shadow",
  "overlay",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

export type ThemeColors = Record<ThemeToken, string>;

/** 0085: a full theme — the same shape users import and export. */
export interface Theme {
  id: string;
  name: string;
  defaultMode: ThemeMode;
  font?: string; // optional font suggestion applied when the theme is selected
  dark: ThemeColors;
  light: ThemeColors;
}

/** 0086: which theme mode a rest background is meant for. */
export type BackgroundMode = "dark" | "light" | "both";

/** 0086: metadata for a user-provided rest background (image bytes live in IndexedDB). */
export interface BackgroundImage {
  id: string;
  name: string;
  addedAt: number;
  mode: BackgroundMode;
}

export type SoundPreset = "chime" | "soft" | "breeze";

export type Phase = "work" | "shortBreak" | "longBreak";

/**
 * 0043: recurrence schedule for a task. `time` is minutes from local midnight
 * (the time of day the occurrence is due); omitted means "no specific time".
 */
export type Recurrence =
  | { every: "daily"; time?: number }
  | { every: "workdays"; time?: number } // Monday–Friday
  | { every: "weekly"; weekday?: number; time?: number } // 0 = Sunday .. 6 = Saturday; defaults to completion weekday
  | { every: "monthly"; day?: number; time?: number } // day of month (1..31); defaults to completion day
  | { every: "days"; interval: number; time?: number }; // legacy "every N days" (not offered in the UI)

/** 0063: one completed occurrence of a recurring task (append-only, bounded). */
export interface TaskCompletion {
  completedAt: number; // epoch ms when the occurrence was marked done
  plannedFor: number | null; // the due timestamp of that occurrence
}

export interface Task {
  id: string;
  title: string;
  priority: number; // 1 (highest) .. 5 (lowest)
  quadrant: Quadrant;
  done: boolean;
  createdAt: number;
  doneAt: number | null;
  estimatedMin: number | null;
  quick: boolean; // ~2 minute tasks, batched in a quick run
  tags: string[]; // parsed from #tags at creation
  description: string; // optional longer description (0026)
  plannedFor: number | null; // local midnight of the planned day (0029/0030)
  recurrence: Recurrence | null; // 0043: repeats after completion (null = one-off)
  order: number; // 0048: manual ordering (used when sort is "manual")
  completions: TaskCompletion[]; // 0063: history of completed occurrences (recurring only)
}

/** 0014: break countdown started automatically after finishing a session. */
export interface BreakState {
  startedAt: number; // 0064: when the break began (drives the progress ring)
  endsAt: number;
  taskId: string;
  technique: Technique;
  done: boolean;
}

/** 0018: one continuous count-up run across several quick tasks. */
export interface QuickRun {
  startedAt: number;
  lastAdvance: number;
  taskId: string;
}

export interface Watch {
  sessionId: string;
  phase: Phase;
  running: boolean;
}

export interface FinishedRecord {
  session: Session;
  status: Session["status"];
  endedAt: number | null;
  activeId: string | null;
  completedPomodoros: number;
  newlyCreated: boolean;
  taskId?: string;
  prevDone?: boolean;
}

export interface RestartNote {
  id: string;
  sessionId: string;
  text: string;
  createdAt: number;
}

/** 0081: a parked distraction captured during a focus session. */
export interface Distraction {
  id: string;
  text: string;
  createdAt: number;
  taskId: string | null; // the session's task when it was logged
}

export interface Session {
  id: string;
  taskId: string;
  technique: Technique;
  plannedMs: number; // pomodoro work length; flowtime target (0 = open)
  startedAt: number; // epoch ms
  pausedAt: number | null; // epoch ms when paused, else null
  accumulatedPauseMs: number;
  completedPomodoros: number;
  endedAt: number | null;
  status: SessionStatus;
}

export interface AppState {
  tasks: Task[];
  sessions: Session[];
  notes: RestartNote[];
  distractions: Distraction[]; // 0081: opt-in distraction log
  activeSessionId: string | null;
}

export interface Settings {
  pomodoroWorkMin: number;
  pomodoroShortBreakMin: number;
  pomodoroLongBreakMin: number;
  pomodoroLongBreakEvery: number;
  flowtimeBreakRatio: number; // 0..1, suggested break = focus time × ratio
  soundEnabled: boolean;
  soundPreset: SoundPreset;
  autoBreak: boolean; // 0014: auto-start break countdown after a session
  showEstimates: boolean; // 0016: show/hide estimate inputs + comparison
  notificationsEnabled: boolean; // 0020: browser notifications on transitions
  maxFlowtimeMin: number; // 0021: cap flowtime length (0 = off)
  flowtimeNudgeMin: number; // 0054: gentle "okay to stop" reminder (0 = off)
  distractionLogEnabled: boolean; // 0081: park distractions during sessions
  themeId: string; // 0085: active theme (built-in or custom id)
  themeMode: ThemeMode; // 0085: active dark/light variant
  font: string; // 0085: active UI font pairing id
  customThemes: Theme[]; // 0085: themes imported from files
  restBackgroundDark: string; // 0086: background id used in dark mode ("none" = off)
  restBackgroundLight: string; // 0086: background id used in light mode ("none" = off)
  restBackgroundDim: number; // 0086: scrim strength, 0..100
  restBackgroundBlur: number; // 0086: image blur in px, 0..20
  customBackgrounds: BackgroundImage[]; // 0086: imported rest backgrounds (bytes in IndexedDB)
}

export const DEFAULT_SETTINGS: Settings = {
  pomodoroWorkMin: 25,
  pomodoroShortBreakMin: 5,
  pomodoroLongBreakMin: 15,
  pomodoroLongBreakEvery: 4,
  flowtimeBreakRatio: 0.2,
  soundEnabled: true,
  soundPreset: "chime",
  autoBreak: true,
  showEstimates: false,
  notificationsEnabled: true,
  maxFlowtimeMin: 0,
  flowtimeNudgeMin: 90,
  distractionLogEnabled: false,
  themeId: "forest",
  themeMode: "dark",
  font: "rounded",
  customThemes: [],
  restBackgroundDark: "none",
  restBackgroundLight: "none",
  restBackgroundDim: 45,
  restBackgroundBlur: 0,
  customBackgrounds: [],
};

export interface ExportPayload {
  app: "ultradiandrift";
  version: 1;
  exportedAt: number;
  settings: Settings;
  data: AppState;
}

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  q1: "Urgent · Important",
  q2: "Not urgent · Important",
  q3: "Urgent · Not important",
  q4: "Not urgent · Not important",
};

export function newId(): string {
  return crypto.randomUUID();
}
