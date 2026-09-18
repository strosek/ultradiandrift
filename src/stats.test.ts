import { describe, expect, it } from "vitest";
import { startOfLocalDay, startOfWeek } from "./dates";
import {
  dailyFocus,
  doneSessions,
  focusByQuadrant,
  focusByTag,
  focusStreak,
  sessionWorkMs,
  tagAttention,
  taskTotals,
  todayTotals,
  weekdayAverages,
  weekTotals,
} from "./stats";
import type { AppState, Session, Settings, Task } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const MIN = 60_000;

const SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  showEstimates: true,
  notificationsEnabled: false,
};

function flowSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s" + Math.random().toString(36).slice(2),
    taskId: "t1",
    technique: "flowtime",
    plannedMs: 0,
    startedAt: 0,
    pausedAt: null,
    accumulatedPauseMs: 0,
    completedPomodoros: 0,
    endedAt: 0,
    status: "done",
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Task",
    priority: 2,
    quadrant: "q1",
    done: false,
    createdAt: 0,
    doneAt: null,
    estimatedMin: null,
    quick: false,
    tags: [],
    description: "",
    plannedFor: null,
    recurrence: null,
    order: 0,
    completions: [],
    ...overrides,
  };
}

function atLocalMidnight(daysAgo: number): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

describe("sessionWorkMs", () => {
  it("derives pomodoro work from completed blocks", () => {
    const s = flowSession({ technique: "pomodoro", completedPomodoros: 3 });
    expect(sessionWorkMs(s, SETTINGS)).toBe(3 * 25 * MIN);
  });

  it("uses active elapsed time for flowtime", () => {
    const s = flowSession({ startedAt: 0, endedAt: 60 * MIN, accumulatedPauseMs: 10 * MIN });
    expect(sessionWorkMs(s, SETTINGS)).toBe(50 * MIN);
  });

  // 0055: partial focus in the final (not-yet-complete) pomodoro block counts too.
  it("counts the elapsed portion of a final unfinished work block", () => {
    const s = flowSession({
      technique: "pomodoro",
      completedPomodoros: 0,
      startedAt: 0,
      endedAt: 20 * MIN,
      accumulatedPauseMs: 0,
    });
    expect(sessionWorkMs(s, SETTINGS)).toBe(20 * MIN);
  });

  it("records a full block when a pomodoro finishes exactly at a boundary", () => {
    const s = flowSession({
      technique: "pomodoro",
      completedPomodoros: 1,
      startedAt: 0,
      endedAt: 25 * MIN,
      accumulatedPauseMs: 0,
    });
    expect(sessionWorkMs(s, SETTINGS)).toBe(25 * MIN);
  });

  it("counts only completed pomodoros when ending during a break", () => {
    // 25 min work + 5 min into a 5-min short break.
    const s = flowSession({
      technique: "pomodoro",
      completedPomodoros: 1,
      startedAt: 0,
      endedAt: 30 * MIN,
      accumulatedPauseMs: 0,
    });
    expect(sessionWorkMs(s, SETTINGS)).toBe(25 * MIN);
  });

  it("keeps full blocks plus the partial of the final block", () => {
    // 25 + 5 (break) + 20 of the second work block.
    const s = flowSession({
      technique: "pomodoro",
      completedPomodoros: 1,
      startedAt: 0,
      endedAt: 50 * MIN,
      accumulatedPauseMs: 0,
    });
    expect(sessionWorkMs(s, SETTINGS)).toBe(45 * MIN);
  });
});

describe("taskTotals", () => {
  it("aggregates done sessions for a task", () => {
    const sessions = [
      flowSession({
        taskId: "t1",
        endedAt: 55 * MIN,
        completedPomodoros: 2,
        technique: "pomodoro",
      }),
      flowSession({ taskId: "t1", endedAt: 20 * MIN }),
      flowSession({ taskId: "t2", endedAt: 30 * MIN }),
      flowSession({ taskId: "t1", status: "running", endedAt: null }),
    ];
    const totals = taskTotals("t1", sessions, SETTINGS);
    expect(totals.sessionCount).toBe(2);
    expect(totals.workMs).toBe(2 * 25 * MIN + 20 * MIN);
    expect(totals.pomodoroCount).toBe(2);
  });
});

describe("doneSessions", () => {
  it("returns only finished sessions, newest first", () => {
    const sessions = [
      flowSession({ id: "a", endedAt: 100 }),
      flowSession({ id: "b", endedAt: 200, status: "running" }),
      flowSession({ id: "c", endedAt: 150 }),
    ];
    expect(doneSessions({ sessions } as AppState).map((s) => s.id)).toEqual(["c", "a"]);
  });
});

describe("todayTotals / weekTotals", () => {
  it("counts sessions that ended today", () => {
    const today = atLocalMidnight(0);
    const sessions = [flowSession({ startedAt: today, endedAt: today + 30 * MIN })];
    const totals = todayTotals(sessions, SETTINGS);
    expect(totals.workMs).toBe(30 * MIN);
    expect(totals.sessionCount).toBe(1);
  });

  it("ignores yesterday for today totals but includes it in the week", () => {
    const today = atLocalMidnight(0);
    const yesterday = atLocalMidnight(1);
    const sessions = [flowSession({ startedAt: yesterday, endedAt: yesterday + 30 * MIN })];
    expect(todayTotals(sessions, SETTINGS).workMs).toBe(0);
    // Yesterday is inside the current Monday-start week except on Mondays.
    const yesterdayInWeek = startOfLocalDay(yesterday) >= startOfWeek(today);
    expect(weekTotals(sessions, SETTINGS).workMs).toBe(yesterdayInWeek ? 30 * MIN : 0);
  });
});

describe("focusStreak", () => {
  it("counts consecutive days ending today", () => {
    const sessions = [0, 1, 2].map((daysAgo) =>
      flowSession({ endedAt: atLocalMidnight(daysAgo) + 60 * MIN }),
    );
    expect(focusStreak(sessions)).toBe(3);
  });

  it("counts from yesterday when today is empty", () => {
    const sessions = [1, 2].map((daysAgo) =>
      flowSession({ endedAt: atLocalMidnight(daysAgo) + 60 * MIN }),
    );
    expect(focusStreak(sessions)).toBe(2);
  });

  it("breaks the streak when there is a gap", () => {
    const sessions = [0, 1, 3].map((daysAgo) =>
      flowSession({ endedAt: atLocalMidnight(daysAgo) + 60 * MIN }),
    );
    expect(focusStreak(sessions)).toBe(2);
  });
});

describe("tagAttention", () => {
  it("counts open tasks per tag, ignoring done ones", () => {
    const tasks = [
      task({ id: "a", tags: ["work"], done: false }),
      task({ id: "b", tags: ["work", "home"], done: false }),
      task({ id: "c", tags: ["work"], done: true }),
      task({ id: "d", tags: [], done: false }),
    ];
    const counts = tagAttention(tasks);
    const work = counts.find((c) => c.tag === "work");
    const home = counts.find((c) => c.tag === "home");
    expect(work?.open).toBe(2);
    expect(home?.open).toBe(1);
  });
});

describe("focusByQuadrant", () => {
  it("buckets work by quadrant and labels deleted tasks", () => {
    const tasks = [task({ id: "t1", quadrant: "q1" }), task({ id: "t2", quadrant: "q2" })];
    const sessions = [
      flowSession({ taskId: "t1", endedAt: 10 * MIN }),
      flowSession({ taskId: "t2", endedAt: 20 * MIN }),
      flowSession({ taskId: "deleted", endedAt: 30 * MIN }),
    ];
    const buckets = focusByQuadrant(sessions, tasks, SETTINGS);
    expect(buckets).toEqual([
      { key: "q1", workMs: 10 * MIN },
      { key: "q2", workMs: 20 * MIN },
      { key: "deleted", workMs: 30 * MIN },
    ]);
  });
});

describe("focusByTag", () => {
  it("buckets work per tag, with untagged tasks in 'untagged'", () => {
    const tasks = [
      task({ id: "t1", tags: ["work"] }),
      task({ id: "t2", tags: ["work", "home"] }),
      task({ id: "t3", tags: [] }),
    ];
    const sessions = [
      flowSession({ taskId: "t1", endedAt: 10 * MIN }),
      flowSession({ taskId: "t2", endedAt: 20 * MIN }),
      flowSession({ taskId: "t3", endedAt: 30 * MIN }),
    ];
    const buckets = focusByTag(sessions, tasks, SETTINGS);
    const work = buckets.find((b) => b.key === "work");
    const home = buckets.find((b) => b.key === "home");
    const untagged = buckets.find((b) => b.key === "untagged");
    expect(work?.workMs).toBe(30 * MIN);
    expect(home?.workMs).toBe(20 * MIN);
    expect(untagged?.workMs).toBe(30 * MIN);
  });
});

describe("dailyFocus", () => {
  it("returns a fixed window of days with per-day totals", () => {
    const today = atLocalMidnight(0);
    const sessions = [
      flowSession({ startedAt: today, endedAt: today + 30 * MIN }),
      flowSession({ startedAt: today, endedAt: today + 15 * MIN }),
      flowSession({ startedAt: atLocalMidnight(2), endedAt: atLocalMidnight(2) + 10 * MIN }),
    ];
    const days = dailyFocus(sessions, SETTINGS, 14);
    expect(days).toHaveLength(14);
    expect(days[13].workMs).toBe(45 * MIN);
    expect(days[11].workMs).toBe(10 * MIN);
    expect(days[13].dayStart).toBe(today);
    expect(days[0].workMs).toBe(0);
  });
});

describe("weekdayAverages", () => {
  it("averages work per weekday over the observed weeks", () => {
    const today = atLocalMidnight(0);
    const sessions = [flowSession({ startedAt: today, endedAt: today + 60 * MIN })];
    const averages = weekdayAverages(sessions, SETTINGS);
    expect(averages).toHaveLength(7);
    expect(averages.some((v) => v > 0)).toBe(true);
    const todayWeekday = (new Date(today).getDay() + 6) % 7;
    expect(averages[todayWeekday]).toBe(60 * MIN);
  });

  it("returns zeros when there are no finished sessions", () => {
    expect(weekdayAverages([], SETTINGS)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
