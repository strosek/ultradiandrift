import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types";
import type { Settings } from "./types";
import {
  emptyState,
  loadBackup,
  loadSettings,
  loadSnapshots,
  loadState,
  parseImport,
  removeSnapshot,
  sanitizeSettings,
  sanitizeState,
  saveBackup,
  saveDailySnapshot,
  saveSettings,
  saveState,
} from "./storage";
import type { AppState } from "./types";

// Minimal localStorage shim for the Node test environment.
const store = new Map<string, string>();
beforeEach(() => store.clear());

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
  configurable: true,
});

const VALID_SETTINGS: Settings = { ...DEFAULT_SETTINGS, pomodoroWorkMin: 30 };

describe("sanitizeSettings", () => {
  it("passes valid settings through", () => {
    expect(sanitizeSettings(VALID_SETTINGS)).toEqual(VALID_SETTINGS);
  });

  it("clamps out-of-range values", () => {
    const s = sanitizeSettings({
      ...VALID_SETTINGS,
      pomodoroWorkMin: 5000,
      pomodoroLongBreakEvery: 0,
    });
    expect(s.pomodoroWorkMin).toBe(120);
    expect(s.pomodoroLongBreakEvery).toBe(1);
  });

  it("falls back to defaults for garbage", () => {
    expect(
      sanitizeSettings({ pomodoroWorkMin: "nope", soundPreset: "bogus", theme: "purple" }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects invalid sound presets and unknown themes", () => {
    const s = sanitizeSettings({ ...VALID_SETTINGS, soundPreset: "bogus", theme: "purple" });
    expect(s.soundPreset).toBe("chime");
    expect(s.themeId).toBe("forest");
    expect(s.themeMode).toBe("dark");
  });

  it("migrates the legacy day theme to Forest light", () => {
    const s = sanitizeSettings({ pomodoroWorkMin: 30, theme: "day" });
    expect(s.themeId).toBe("forest");
    expect(s.themeMode).toBe("light");
  });

  it("validates themeId and font against known ids", () => {
    const s = sanitizeSettings({ themeId: "nope", font: "nope" });
    expect(s.themeId).toBe("forest");
    expect(s.font).toBe("rounded");
  });

  it("sanitizes flowtimeNudgeMin and defaults it to 90", () => {
    expect(sanitizeSettings({ ...VALID_SETTINGS, flowtimeNudgeMin: 45 }).flowtimeNudgeMin).toBe(45);
    expect(sanitizeSettings({ ...VALID_SETTINGS, flowtimeNudgeMin: 5000 }).flowtimeNudgeMin).toBe(
      1440,
    );
    expect(sanitizeSettings({ ...VALID_SETTINGS, flowtimeNudgeMin: "nope" }).flowtimeNudgeMin).toBe(
      DEFAULT_SETTINGS.flowtimeNudgeMin,
    );
  });

  it("keeps rest-background slots and validates them against known images", () => {
    const withBackgrounds = {
      ...VALID_SETTINGS,
      customBackgrounds: [{ id: "custom:one", name: "My beach", addedAt: 5, mode: "dark" }],
      restBackgroundDark: "custom:one",
      restBackgroundLight: "ocean-waves",
    };
    const s = sanitizeSettings(withBackgrounds);
    expect(s.restBackgroundDark).toBe("custom:one");
    expect(s.restBackgroundLight).toBe("ocean-waves");
    expect(s.customBackgrounds[0]).toEqual({
      id: "custom:one",
      name: "My beach",
      addedAt: 5,
      mode: "dark",
    });

    const unknown = sanitizeSettings({
      ...VALID_SETTINGS,
      restBackgroundDark: "nope",
      restBackgroundLight: "custom:missing",
    });
    expect(unknown.restBackgroundDark).toBe("none");
    expect(unknown.restBackgroundLight).toBe("none");
  });

  it("clamps rest-background dim and blur and repairs custom metadata", () => {
    const s = sanitizeSettings({
      ...VALID_SETTINGS,
      restBackgroundDim: 500,
      restBackgroundBlur: -4,
      customBackgrounds: [
        { id: "custom:a", name: "  ", addedAt: "nope", mode: "sideways" },
        { id: "custom:a", name: "dupe", addedAt: 1, mode: "both" },
        { id: "not-custom", name: "bad", addedAt: 1, mode: "both" },
      ],
    });
    expect(s.restBackgroundDim).toBe(100);
    expect(s.restBackgroundBlur).toBe(0);
    expect(s.customBackgrounds).toHaveLength(1);
    expect(s.customBackgrounds[0]).toEqual({
      id: "custom:a",
      name: "Image",
      addedAt: expect.any(Number),
      mode: "both",
    });
  });
});

describe("sanitizeState", () => {
  it("passes valid state through", () => {
    const valid = {
      tasks: [
        {
          id: "t1",
          title: "A",
          priority: 2,
          quadrant: "q1",
          done: false,
          createdAt: 1,
          doneAt: null,
          estimatedMin: null,
          quick: false,
          tags: [],
          description: "",
          plannedFor: null,
          recurrence: null,
          order: 0,
          completions: [],
        },
      ],
      sessions: [
        {
          id: "s1",
          taskId: "t1",
          technique: "pomodoro",
          plannedMs: 1500000,
          startedAt: 1,
          pausedAt: null,
          accumulatedPauseMs: 0,
          completedPomodoros: 0,
          endedAt: null,
          status: "running",
        },
      ],
      notes: [{ id: "n1", sessionId: "s1", text: "hi", createdAt: 1 }],
      distractions: [],
      activeSessionId: "s1",
    };
    expect(sanitizeState(valid)).toEqual(valid);
  });

  it("repairs corrupt task records and drops unknown fields", () => {
    const out = sanitizeState({
      tasks: [{ id: "t1", quadrant: "q9", priority: 99, tags: [1, "ok"] }],
    });
    expect(out.tasks).toHaveLength(1);
    const t = out.tasks[0];
    expect(t.quadrant).toBe("q2");
    expect(t.priority).toBe(5); // 99 clamps to the max of 1..5
    expect(t.tags).toEqual(["ok"]);
    expect(t.title).toBe("");
    expect(t.done).toBe(false);
    expect("notes" in t).toBe(false);
  });

  it("falls back to the default priority for non-numbers", () => {
    const out = sanitizeState({ tasks: [{ id: "t1", priority: "high" }] });
    expect(out.tasks[0].priority).toBe(3);
  });

  it("sanitizes recurrence rules and drops invalid ones", () => {
    const out = sanitizeState({
      tasks: [
        { id: "t1", recurrence: { every: "daily", time: 9 * 60 } },
        { id: "t2", recurrence: { every: "weekly", weekday: 3 } },
        { id: "t3", recurrence: { every: "days", interval: 0 } },
        { id: "t4", recurrence: { every: "yearly" } },
        { id: "t5", recurrence: { every: "weekly", weekday: 99 } },
        { id: "t6", recurrence: "garbage" },
        { id: "t7", recurrence: { every: "workdays" } },
        { id: "t8", recurrence: { every: "monthly", day: 31 } },
        { id: "t9", recurrence: { every: "daily", time: 9999 } },
      ],
    });
    const byId = new Map(out.tasks.map((t) => [t.id, t]));
    expect(byId.get("t1")?.recurrence).toEqual({ every: "daily", time: 540 });
    expect(byId.get("t2")?.recurrence).toEqual({ every: "weekly", weekday: 3 });
    expect(byId.get("t3")?.recurrence).toEqual({ every: "days", interval: 1 });
    expect(byId.get("t4")?.recurrence).toBeNull();
    expect(byId.get("t5")?.recurrence).toEqual({ every: "weekly" });
    expect(byId.get("t6")?.recurrence).toBeNull();
    expect(byId.get("t7")?.recurrence).toEqual({ every: "workdays" });
    expect(byId.get("t8")?.recurrence).toEqual({ every: "monthly", day: 31 });
    expect(byId.get("t9")?.recurrence).toEqual({ every: "daily" });
  });

  it("defaults missing arrays to empty", () => {
    expect(sanitizeState({})).toEqual(emptyState());
    expect(sanitizeState(null)).toEqual(emptyState());
  });

  it("defaults a missing completion log to empty and caps its length", () => {
    const out = sanitizeState({ tasks: [{ id: "t1", title: "Recurring" }] });
    expect(out.tasks[0].completions).toEqual([]);

    const many = Array.from({ length: 60 }, (_, i) => ({
      completedAt: i,
      plannedFor: i,
    }));
    const capped = sanitizeState({ tasks: [{ id: "t2", completions: many }] });
    expect(capped.tasks[0].completions).toHaveLength(50);
    expect(capped.tasks[0].completions[0].completedAt).toBe(10);
  });

  it("drops invalid completion log entries", () => {
    const out = sanitizeState({
      tasks: [
        {
          id: "t1",
          completions: [
            { completedAt: 1, plannedFor: null },
            { completedAt: "nope", plannedFor: 2 },
            { plannedFor: 3 },
            null,
          ],
        },
      ],
    });
    expect(out.tasks[0].completions).toEqual([{ completedAt: 1, plannedFor: null }]);
  });

  it("clears activeSessionId that points at a done or missing session", () => {
    const doneSession = {
      id: "s1",
      taskId: "t1",
      technique: "flowtime",
      plannedMs: 0,
      startedAt: 1,
      pausedAt: null,
      accumulatedPauseMs: 0,
      completedPomodoros: 0,
      endedAt: 2,
      status: "done",
    };
    expect(
      sanitizeState({ sessions: [doneSession], activeSessionId: "s1" }).activeSessionId,
    ).toBeNull();
    expect(sanitizeState({ sessions: [], activeSessionId: "nope" }).activeSessionId).toBeNull();
  });

  it("keeps activeSessionId for a running session", () => {
    const running = {
      id: "s1",
      taskId: "t1",
      technique: "flowtime",
      plannedMs: 0,
      startedAt: 1,
      pausedAt: null,
      accumulatedPauseMs: 0,
      completedPomodoros: 0,
      endedAt: null,
      status: "running",
    };
    expect(sanitizeState({ sessions: [running], activeSessionId: "s1" }).activeSessionId).toBe(
      "s1",
    );
  });
});

describe("parseImport", () => {
  it("rejects non-JSON", () => {
    expect(parseImport("not json").ok).toBe(false);
  });

  it("rejects non-UltradianDrift or wrong-version files", () => {
    expect(parseImport(JSON.stringify({ app: "other", version: 1 })).ok).toBe(false);
    expect(parseImport(JSON.stringify({ app: "ultradiandrift", version: 99 })).ok).toBe(false);
  });

  it("still accepts legacy pomoflow exports", () => {
    const result = parseImport(
      JSON.stringify({
        app: "pomoflow",
        version: 1,
        data: { tasks: [], sessions: [], notes: [] },
        settings: { ...DEFAULT_SETTINGS },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects exports missing data arrays", () => {
    expect(parseImport(JSON.stringify({ app: "ultradiandrift", version: 1, data: {} })).ok).toBe(
      false,
    );
  });

  it("parses a valid export and sanitizes it", () => {
    const result = parseImport(
      JSON.stringify({
        app: "ultradiandrift",
        version: 1,
        data: { tasks: [], sessions: [], notes: [] },
        settings: { ...DEFAULT_SETTINGS, pomodoroWorkMin: 5000 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.data).toEqual(emptyState());
    expect(result.payload.settings.pomodoroWorkMin).toBe(120);
  });
});

describe("persistence", () => {
  it("round-trips state through localStorage", () => {
    const state: AppState = {
      ...emptyState(),
      tasks: [
        {
          id: "t1",
          title: "A",
          priority: 2,
          quadrant: "q1",
          done: false,
          createdAt: 1,
          doneAt: null,
          estimatedMin: null,
          quick: false,
          tags: [],
          description: "",
          plannedFor: null,
          recurrence: null,
          order: 0,
          completions: [],
        },
      ],
    };
    saveState(state);
    expect(loadState()).toEqual(state);
  });

  it("round-trips settings", () => {
    saveSettings(VALID_SETTINGS);
    expect(loadSettings()).toEqual(VALID_SETTINGS);
  });

  it("falls back to defaults on corrupt storage", () => {
    store.set("ultradiandrift:v1", "{oops");
    expect(loadState()).toEqual(emptyState());
  });

  it("migrates legacy pomoflow data on first load", () => {
    store.set(
      "pomoflow:v1",
      JSON.stringify({
        tasks: [{ id: "t1", title: "Old task" }],
        sessions: [],
        notes: [],
        activeSessionId: null,
      }),
    );
    store.set("pomoflow:settings:v1", JSON.stringify({ ...DEFAULT_SETTINGS }));
    const state = loadState();
    expect(state.tasks[0].title).toBe("Old task");
    expect(store.get("ultradiandrift:v1")).toBeTruthy();
    expect(store.get("pomoflow:v1")).toBeUndefined();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("backs up and restores data", () => {
    const state = emptyState();
    saveBackup(VALID_SETTINGS, state);
    expect(loadBackup()).toEqual({ settings: VALID_SETTINGS, data: state });
    expect(loadBackup()).not.toBeNull();
  });

  it("saves daily snapshots once per day and prunes old ones", () => {
    const state = emptyState();
    saveDailySnapshot(VALID_SETTINGS, state);
    expect(loadSnapshots()).toHaveLength(1);
    // Same-day second call is a no-op.
    saveDailySnapshot(VALID_SETTINGS, state);
    expect(loadSnapshots()).toHaveLength(1);
  });

  it("restores and removes a snapshot", () => {
    const state = emptyState();
    state.tasks.push({
      id: "t1",
      title: "Snap",
      priority: 2,
      quadrant: "q1",
      done: false,
      createdAt: 1,
      doneAt: null,
      estimatedMin: null,
      quick: false,
      tags: [],
      description: "",
      plannedFor: null,
      recurrence: null,
      order: 0,
      completions: [],
    });
    saveDailySnapshot(VALID_SETTINGS, state);
    const [entry] = loadSnapshots();
    expect(entry.backup.data.tasks).toHaveLength(1);
    expect(entry.backup.data.tasks[0].title).toBe("Snap");
    removeSnapshot(entry.key);
    expect(loadSnapshots()).toHaveLength(0);
  });
});
