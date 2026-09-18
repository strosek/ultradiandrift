import { describe, expect, it } from "vitest";
import {
  activeElapsedMs,
  configFromSettings,
  formatDuration,
  formatElapsed,
  formatMs,
  phaseMs,
  snapshot,
} from "./timer";
import type { TimerConfig } from "./timer";
import type { Session, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    taskId: "t1",
    technique: "pomodoro",
    plannedMs: 0,
    startedAt: 0,
    pausedAt: null,
    accumulatedPauseMs: 0,
    completedPomodoros: 0,
    endedAt: null,
    status: "running",
    ...overrides,
  };
}

const BASE_CONFIG: TimerConfig = {
  pomodoroWorkMs: 25 * 60_000,
  pomodoroShortBreakMs: 5 * 60_000,
  pomodoroLongBreakMs: 15 * 60_000,
  pomodoroLongBreakEvery: 4,
};

const MIN = 60_000;

describe("formatMs", () => {
  it("formats countdown minutes and seconds", () => {
    expect(formatMs(25 * MIN)).toBe("25:00");
    expect(formatMs(59_999)).toBe("01:00"); // ceil so it never shows 00:00 too early
    expect(formatMs(0)).toBe("00:00");
  });

  it("renders null as --:--", () => {
    expect(formatMs(null)).toBe("--:--");
  });
});

describe("formatElapsed", () => {
  it("supports hours once elapsed exceeds an hour", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(3_661_000)).toBe("1:01:01");
  });
});

describe("formatDuration", () => {
  it("produces human-readable durations", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(30 * MIN)).toBe("30m");
    expect(formatDuration(2 * 3_600_000)).toBe("2h 00m");
  });
});

describe("activeElapsedMs", () => {
  it("counts active time only while running", () => {
    expect(activeElapsedMs(makeSession(), 10_000)).toBe(10_000);
  });

  it("freezes elapsed time while paused", () => {
    const s = makeSession({ pausedAt: 5_000 });
    expect(activeElapsedMs(s, 20_000)).toBe(5_000);
  });

  it("subtracts accumulated pauses", () => {
    const s = makeSession({ accumulatedPauseMs: 3_000 });
    expect(activeElapsedMs(s, 10_000)).toBe(7_000);
  });
});

describe("pomodoro snapshot", () => {
  it("starts in the work phase with the full work block remaining", () => {
    const snap = snapshot(makeSession(), BASE_CONFIG, 0);
    expect(snap.phase).toBe("work");
    expect(snap.remainingMs).toBe(25 * MIN);
    expect(snap.completedPomodoros).toBe(0);
  });

  it("moves into a short break exactly when a work block ends", () => {
    const snap = snapshot(makeSession(), BASE_CONFIG, 25 * MIN);
    expect(snap.phase).toBe("shortBreak");
    expect(snap.remainingMs).toBe(5 * MIN);
    expect(snap.completedPomodoros).toBe(1);
  });

  it("counts a full cycle as pomodoroLongBreakEvery completed", () => {
    const cycleLen = (25 + 5 + 25 + 5 + 25 + 5 + 25 + 15) * MIN;
    const snap = snapshot(makeSession(), BASE_CONFIG, cycleLen);
    expect(snap.phase).toBe("work");
    expect(snap.remainingMs).toBe(25 * MIN);
    expect(snap.completedPomodoros).toBe(4);
  });

  it("honors a custom long-break cadence (long break every 2)", () => {
    const config: TimerConfig = { ...BASE_CONFIG, pomodoroLongBreakEvery: 2 };
    // After 25+5+25 minutes the second work block is done → long break.
    const snap = snapshot(makeSession(), config, 55 * MIN);
    expect(snap.phase).toBe("longBreak");
    expect(snap.remainingMs).toBe(15 * MIN);
    expect(snap.completedPomodoros).toBe(2);
  });

  it("honors a custom long-break cadence (long break every 1)", () => {
    const config: TimerConfig = { ...BASE_CONFIG, pomodoroLongBreakEvery: 1 };
    // One work block then immediately a long break.
    const snap = snapshot(makeSession(), config, 25 * MIN);
    expect(snap.phase).toBe("longBreak");
    expect(snap.remainingMs).toBe(15 * MIN);
    expect(snap.completedPomodoros).toBe(1);
  });
});

describe("flowtime snapshot", () => {
  it("is open-ended when plannedMs is 0", () => {
    const s = makeSession({ technique: "flowtime", plannedMs: 0 });
    const snap = snapshot(s, BASE_CONFIG, 90 * MIN);
    expect(snap.phase).toBe("work");
    expect(snap.remainingMs).toBeNull();
    expect(snap.elapsedMs).toBe(90 * MIN);
  });

  it("reports remaining time against a target", () => {
    const s = makeSession({ technique: "flowtime", plannedMs: 30 * MIN });
    const snap = snapshot(s, BASE_CONFIG, 10 * MIN);
    expect(snap.remainingMs).toBe(20 * MIN);
  });
});

describe("configFromSettings", () => {
  it("derives ms values from minute settings", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      showEstimates: true,
      notificationsEnabled: false,
    };
    expect(configFromSettings(settings)).toEqual(BASE_CONFIG);
  });
});

describe("phaseMs", () => {
  it("returns the total length of each pomodoro phase", () => {
    expect(phaseMs("work", BASE_CONFIG)).toBe(25 * MIN);
    expect(phaseMs("shortBreak", BASE_CONFIG)).toBe(5 * MIN);
    expect(phaseMs("longBreak", BASE_CONFIG)).toBe(15 * MIN);
  });
});
