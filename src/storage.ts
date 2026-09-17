import { DEFAULT_SETTINGS, newId } from "./types";
import type {
  AppState,
  Distraction,
  ExportPayload,
  RestartNote,
  Session,
  Settings,
  Task,
  TaskCompletion,
  Theme,
} from "./types";
import { DEFAULT_FONT_ID, isFontId } from "./fonts";
import { DEFAULT_THEME_ID, isBuiltinTheme, sanitizeTheme, uniqueThemeId } from "./theme";

const PRESETS = ["chime", "soft", "breeze"] as const;
const DAY_MS = 86_400_000;

export const STATE_KEY = "ultradiandrift:v1";
export const SETTINGS_KEY = "ultradiandrift:settings:v1";
export const BACKUP_KEY = "ultradiandrift:backup:v1";
export const EXPORT_APP = "ultradiandrift";

// Legacy "Pomoflow" identifiers, kept so pre-rename data migrates cleanly.
const LEGACY_STATE_KEY = "pomoflow:v1";
const LEGACY_SETTINGS_KEY = "pomoflow:settings:v1";
const LEGACY_BACKUP_KEY = "pomoflow:backup:v1";
const LEGACY_SNAPSHOT_PREFIX = "pomoflow:snapshot:";

/** One-time migration of data saved under the old "pomoflow" keys. */
function migrateLegacy(): void {
  try {
    if (!localStorage.getItem(STATE_KEY) && localStorage.getItem(LEGACY_STATE_KEY)) {
      localStorage.setItem(STATE_KEY, localStorage.getItem(LEGACY_STATE_KEY)!);
      localStorage.removeItem(LEGACY_STATE_KEY);
    }
    if (!localStorage.getItem(SETTINGS_KEY) && localStorage.getItem(LEGACY_SETTINGS_KEY)) {
      localStorage.setItem(SETTINGS_KEY, localStorage.getItem(LEGACY_SETTINGS_KEY)!);
      localStorage.removeItem(LEGACY_SETTINGS_KEY);
    }
    if (!localStorage.getItem(BACKUP_KEY) && localStorage.getItem(LEGACY_BACKUP_KEY)) {
      localStorage.setItem(BACKUP_KEY, localStorage.getItem(LEGACY_BACKUP_KEY)!);
      localStorage.removeItem(LEGACY_BACKUP_KEY);
    }
    const keysToMigrate: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_SNAPSHOT_PREFIX)) keysToMigrate.push(key);
    }
    for (const key of keysToMigrate) {
      const newKey = SNAPSHOT_PREFIX + key.slice(LEGACY_SNAPSHOT_PREFIX.length);
      if (!localStorage.getItem(newKey)) localStorage.setItem(newKey, localStorage.getItem(key)!);
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.error("Failed to migrate legacy data.", err);
  }
}
export const EXPORT_VERSION = 1;

export function emptyState(): AppState {
  return {
    tasks: [],
    sessions: [],
    notes: [],
    distractions: [],
    activeSessionId: null,
  };
}

export function loadState(): AppState {
  try {
    migrateLegacy();
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return emptyState();
    return sanitizeState(JSON.parse(raw));
  } catch (err) {
    console.error("Failed to load state, resetting.", err);
    return emptyState();
  }
}

/* ------------------------------------------------------------------ */
/* Storage quota safety (0061)                                         */
/* ------------------------------------------------------------------ */

let quotaWarningHandler: (() => void) | null = null;
let quotaWarned = false;

/** Register a handler that is called (once per session) when a save hits the storage quota. */
export function onStorageQuotaExceeded(cb: () => void): void {
  quotaWarningHandler = cb;
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.name === "QuotaExceeded")
  );
}

function reportQuotaIfExceeded(err: unknown): void {
  if (!isQuotaError(err) || quotaWarned) return;
  quotaWarned = true;
  quotaWarningHandler?.();
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save state.", err);
    reportQuotaIfExceeded(err);
  }
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampNumOrNull(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 0085: at most this many imported themes are kept. */
const CUSTOM_THEMES_MAX = 20;

function sanitizeCustomThemes(raw: unknown): Theme[] {
  if (!Array.isArray(raw)) return [];
  const out: Theme[] = [];
  for (const item of raw) {
    if (out.length >= CUSTOM_THEMES_MAX) break;
    const theme = sanitizeTheme(item);
    if (!theme) continue;
    out.push({ ...theme, id: uniqueThemeId(theme.name, out) });
  }
  return out;
}

/** Merge an arbitrary (possibly partial) settings value into valid settings with clamped bounds. */
export function sanitizeSettings(raw: unknown): Settings {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Settings>;
  const legacy = s as Record<string, unknown>;
  const customThemes = sanitizeCustomThemes(legacy.customThemes);
  // 0085 migration: the old `theme: "night" | "day"` becomes Forest's dark/light mode.
  const legacyMode = legacy.theme === "day" ? "light" : "dark";
  const themeId =
    typeof s.themeId === "string" &&
    s.themeId &&
    (isBuiltinTheme(s.themeId) || customThemes.some((t) => t.id === s.themeId))
      ? s.themeId
      : DEFAULT_THEME_ID;
  const themeMode =
    s.themeMode === "light" || s.themeMode === "dark" ? s.themeMode : legacyMode;
  return {
    pomodoroWorkMin: clampNum(s.pomodoroWorkMin, 1, 120, DEFAULT_SETTINGS.pomodoroWorkMin),
    pomodoroShortBreakMin: clampNum(
      s.pomodoroShortBreakMin,
      1,
      60,
      DEFAULT_SETTINGS.pomodoroShortBreakMin,
    ),
    pomodoroLongBreakMin: clampNum(
      s.pomodoroLongBreakMin,
      1,
      90,
      DEFAULT_SETTINGS.pomodoroLongBreakMin,
    ),
    pomodoroLongBreakEvery: Math.round(
      clampNum(s.pomodoroLongBreakEvery, 1, 12, DEFAULT_SETTINGS.pomodoroLongBreakEvery),
    ),
    flowtimeBreakRatio: clampNum(s.flowtimeBreakRatio, 0, 1, DEFAULT_SETTINGS.flowtimeBreakRatio),
    soundEnabled:
      typeof s.soundEnabled === "boolean" ? s.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    soundPreset: PRESETS.includes(s.soundPreset as Settings["soundPreset"])
      ? (s.soundPreset as Settings["soundPreset"])
      : DEFAULT_SETTINGS.soundPreset,
    autoBreak: typeof s.autoBreak === "boolean" ? s.autoBreak : DEFAULT_SETTINGS.autoBreak,
    showEstimates:
      typeof s.showEstimates === "boolean" ? s.showEstimates : DEFAULT_SETTINGS.showEstimates,
    notificationsEnabled:
      typeof s.notificationsEnabled === "boolean"
        ? s.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled,
    maxFlowtimeMin: clampNum(s.maxFlowtimeMin, 0, 1440, DEFAULT_SETTINGS.maxFlowtimeMin),
    flowtimeNudgeMin: clampNum(s.flowtimeNudgeMin, 0, 1440, DEFAULT_SETTINGS.flowtimeNudgeMin),
    distractionLogEnabled:
      typeof s.distractionLogEnabled === "boolean"
        ? s.distractionLogEnabled
        : DEFAULT_SETTINGS.distractionLogEnabled,
    themeId,
    themeMode,
    font: isFontId(s.font) ? s.font : DEFAULT_FONT_ID,
    customThemes,
  };
}

export function loadSettings(): Settings {
  try {
    migrateLegacy();
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw));
  } catch (err) {
    console.error("Failed to load settings, using defaults.", err);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error("Failed to save settings.", err);
    reportQuotaIfExceeded(err);
  }
}

/* ------------------------------------------------------------------ */
/* State sanitization                                                  */
/* ------------------------------------------------------------------ */

function sanitizeTime(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const m = Math.round(value);
  if (m < 0 || m > 23 * 60 + 59) return undefined;
  return m;
}

function sanitizeRecurrence(raw: unknown): Task["recurrence"] {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const time = sanitizeTime(r.time);
  if (r.every === "daily") {
    return time === undefined ? { every: "daily" } : { every: "daily", time };
  }
  if (r.every === "workdays") {
    return time === undefined ? { every: "workdays" } : { every: "workdays", time };
  }
  if (r.every === "weekly") {
    const weekday = typeof r.weekday === "number" ? Math.round(r.weekday) : undefined;
    const w = weekday !== undefined && weekday >= 0 && weekday <= 6 ? weekday : undefined;
    const rec: Task["recurrence"] = { every: "weekly", ...(w !== undefined ? { weekday: w } : {}) };
    if (time !== undefined) rec.time = time;
    return rec;
  }
  if (r.every === "monthly") {
    const day = typeof r.day === "number" ? Math.round(r.day) : undefined;
    const d = day !== undefined && day >= 1 && day <= 31 ? day : undefined;
    const rec: Task["recurrence"] = { every: "monthly", ...(d !== undefined ? { day: d } : {}) };
    if (time !== undefined) rec.time = time;
    return rec;
  }
  if (r.every === "days") {
    const interval =
      typeof r.interval === "number" && Number.isFinite(r.interval)
        ? Math.max(1, Math.round(r.interval))
        : 1;
    const rec: Task["recurrence"] = { every: "days", interval };
    if (time !== undefined) rec.time = time;
    return rec;
  }
  return null;
}

const COMPLETION_LOG_MAX = 50;

function sanitizeCompletion(raw: unknown): TaskCompletion | null {
  const c = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<TaskCompletion>;
  if (typeof c.completedAt !== "number" || !Number.isFinite(c.completedAt)) return null;
  return {
    completedAt: c.completedAt,
    plannedFor: typeof c.plannedFor === "number" ? c.plannedFor : null,
  };
}

function sanitizeTask(raw: unknown): Task {
  const t = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Task>;
  return {
    id: str(t.id) || newId(),
    title: str(t.title),
    priority: Math.round(clampNum(t.priority, 1, 5, 3)),
    quadrant:
      t.quadrant === "q1" || t.quadrant === "q2" || t.quadrant === "q3" || t.quadrant === "q4"
        ? t.quadrant
        : "q2",
    done: typeof t.done === "boolean" ? t.done : false,
    createdAt:
      typeof t.createdAt === "number" && Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
    doneAt: typeof t.doneAt === "number" ? t.doneAt : null,
    estimatedMin: clampNumOrNull(t.estimatedMin, 0, 60 * 24),
    quick: typeof t.quick === "boolean" ? t.quick : false,
    tags: Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === "string") : [],
    description: str(t.description),
    plannedFor: typeof t.plannedFor === "number" ? t.plannedFor : null,
    recurrence: sanitizeRecurrence(t.recurrence),
    order: clampNum(t.order, 0, Number.MAX_SAFE_INTEGER, 0),
    completions: Array.isArray(t.completions)
      ? t.completions
          .map(sanitizeCompletion)
          .filter((c): c is TaskCompletion => c !== null)
          .slice(-COMPLETION_LOG_MAX)
      : [],
  };
}

function sanitizeSession(raw: unknown): Session {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Session>;
  return {
    id: str(s.id) || newId(),
    taskId: str(s.taskId),
    technique: s.technique === "flowtime" ? "flowtime" : "pomodoro",
    plannedMs: clampNum(s.plannedMs, 0, 7 * DAY_MS, 0),
    startedAt:
      typeof s.startedAt === "number" && Number.isFinite(s.startedAt) ? s.startedAt : Date.now(),
    pausedAt: typeof s.pausedAt === "number" ? s.pausedAt : null,
    accumulatedPauseMs: clampNum(s.accumulatedPauseMs, 0, Number.MAX_SAFE_INTEGER, 0),
    completedPomodoros: Math.round(clampNum(s.completedPomodoros, 0, 100_000, 0)),
    endedAt: typeof s.endedAt === "number" ? s.endedAt : null,
    status: s.status === "running" || s.status === "paused" ? s.status : "done",
  };
}

function sanitizeNote(raw: unknown): RestartNote {
  const n = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<RestartNote>;
  return {
    id: str(n.id) || newId(),
    sessionId: str(n.sessionId),
    text: str(n.text),
    createdAt:
      typeof n.createdAt === "number" && Number.isFinite(n.createdAt) ? n.createdAt : Date.now(),
  };
}

function sanitizeDistraction(raw: unknown): Distraction {
  const d = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Distraction>;
  return {
    id: str(d.id) || newId(),
    text: str(d.text),
    createdAt:
      typeof d.createdAt === "number" && Number.isFinite(d.createdAt) ? d.createdAt : Date.now(),
    taskId: typeof d.taskId === "string" ? d.taskId : null,
  };
}

/** Validate and repair an arbitrary (possibly partial/corrupt) state blob. */
export function sanitizeState(raw: unknown): AppState {
  const d = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<AppState>;
  const tasks = Array.isArray(d.tasks) ? d.tasks.map(sanitizeTask) : [];
  const sessions = Array.isArray(d.sessions) ? d.sessions.map(sanitizeSession) : [];
  const notes = Array.isArray(d.notes) ? d.notes.map(sanitizeNote) : [];
  const distractions = Array.isArray(d.distractions) ? d.distractions.map(sanitizeDistraction) : [];

  // Only keep activeSessionId if it points at a live (running/paused) session.
  const active = sessions.find((s) => s.id === d.activeSessionId);
  const activeSessionId = active && active.status !== "done" ? active.id : null;

  return { tasks, sessions, notes, distractions, activeSessionId };
}

export function buildExport(settings: Settings, state: AppState): ExportPayload {
  return {
    app: EXPORT_APP,
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    settings,
    data: state,
  };
}

export type ImportResult = { ok: true; payload: ExportPayload } | { ok: false; error: string };

export function parseImport(text: string): ImportResult {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }

  if (typeof obj !== "object" || obj === null) {
    return { ok: false, error: "This file is not an UltradianDrift export." };
  }
  const rec = obj as Record<string, unknown>;
  if (rec.app !== EXPORT_APP && rec.app !== "pomoflow") {
    return { ok: false, error: "This file is not an UltradianDrift export." };
  }
  if (rec.version !== EXPORT_VERSION) {
    return { ok: false, error: `Unsupported export version (${String(rec.version)}).` };
  }

  const data = rec.data;
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "This export has no data section." };
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.tasks) || !Array.isArray(d.sessions) || !Array.isArray(d.notes)) {
    return { ok: false, error: "This export is missing expected data arrays." };
  }

  return {
    ok: true,
    payload: {
      app: EXPORT_APP,
      version: EXPORT_VERSION,
      exportedAt: typeof rec.exportedAt === "number" ? rec.exportedAt : Date.now(),
      settings: sanitizeSettings(rec.settings),
      data: sanitizeState(rec.data),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Backup before destructive actions (0031)                            */
/* ------------------------------------------------------------------ */

export interface BackupData {
  settings: Settings;
  data: AppState;
}

export function saveBackup(settings: Settings, state: AppState): void {
  try {
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({ settings, data: state } satisfies BackupData),
    );
  } catch (err) {
    console.error("Failed to save backup.", err);
    reportQuotaIfExceeded(err);
  }
}

export function loadBackup(): BackupData | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BackupData>;
    const d = parsed.data;
    if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.sessions) || !Array.isArray(d.notes)) {
      return null;
    }
    return {
      settings: sanitizeSettings(parsed.settings),
      data: sanitizeState(d),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Daily snapshot backups (0053)                                       */
/* ------------------------------------------------------------------ */

export const SNAPSHOT_PREFIX = "ultradiandrift:snapshot:";
const SNAPSHOT_MAX = 3;

function snapshotKey(day: string): string {
  return `${SNAPSHOT_PREFIX}${day}`;
}

/** Save a daily snapshot (no-op if one already exists for today), pruning old ones.
 *  If the write fails (quota), drop the oldest snapshot and retry once before giving up. */
export function saveDailySnapshot(settings: Settings, state: AppState): void {
  const day = ymdForDay(Date.now());
  const key = snapshotKey(day);
  if (localStorage.getItem(key)) return;

  const payload = JSON.stringify({ settings, data: state } satisfies BackupData);
  const write = (): boolean => {
    try {
      localStorage.setItem(key, payload);
      return true;
    } catch (err) {
      console.error("Failed to save daily snapshot.", err);
      reportQuotaIfExceeded(err);
      return false;
    }
  };

  if (!write()) {
    const keys = Object.keys(localStorage)
      .filter((k) => k.startsWith(SNAPSHOT_PREFIX))
      .sort();
    if (keys.length > 0) localStorage.removeItem(keys[0]);
    if (!write()) return;
  }

  const keys = Object.keys(localStorage)
    .filter((k) => k.startsWith(SNAPSHOT_PREFIX))
    .sort();
  while (keys.length > SNAPSHOT_MAX) {
    localStorage.removeItem(keys.shift()!);
  }
}

export interface SnapshotEntry {
  key: string;
  day: string;
  backup: BackupData;
}

export function loadSnapshots(): SnapshotEntry[] {
  const out: SnapshotEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(SNAPSHOT_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<BackupData>;
      const d = parsed.data;
      if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.sessions) || !Array.isArray(d.notes)) {
        continue;
      }
      out.push({
        key,
        day: key.slice(SNAPSHOT_PREFIX.length),
        backup: {
          settings: sanitizeSettings(parsed.settings),
          data: sanitizeState(d),
        },
      });
    } catch {
      // skip corrupt snapshot
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export function removeSnapshot(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* First-run onboarding flag (0070)                                    */
/* ------------------------------------------------------------------ */

const ONBOARDED_KEY = "ultradiandrift:onboarded:v1";

/** Whether the first-run welcome has been dismissed (stored separately from data). */
export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true;
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // non-fatal
  }
}

function ymdForDay(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
