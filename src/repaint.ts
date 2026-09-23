import { finishSession, pauseAfterPomodoroBreak, showFlowtimeNudge } from "./actions";
import { announce } from "./announce";
import { notify } from "./notify";
import { playCue } from "./sound";
import {
  activeSession,
  breakState,
  lastWatch,
  quickRun,
  setBreakState,
  setLastWatch,
  settings,
  taskById,
  timerConfig,
} from "./state";
import {
  MIN,
  formatElapsed,
  formatMs,
  phaseLabel,
  phaseMs,
  snapshot,
  techniqueLabel,
} from "./timer";
import type { TimerConfig, TimerSnapshot } from "./timer";
import { render, updateClockRing, updateDocumentTitle, flashPhaseChange } from "./views";
import type { Session } from "./types";

let repaintHandle: number | undefined;

/** 0054: flowtime nudge tracking — re-nudge at each 30-minute cadence past the limit. */
const NUDGE_CADENCE = 30 * MIN;
let nudgeFloor: number | null = null;
let nudgeSessionId: string | null = null;

function breakOver(): void {
  setBreakState({ ...breakState!, running: false, done: true });
  if (settings.soundEnabled) playCue("workStart", settings.soundPreset);
  if (settings.notificationsEnabled) {
    const task = taskById(breakState!.taskId);
    notify("Break over", task ? `Time to focus — ${task.title}` : "Time to focus");
  }
  announce("Break over. Time to focus.");
  render();
  flashPhaseChange();
}

function handlePhaseBoundary(session: Session, nowBreak: boolean): void {
  if (settings.soundEnabled) {
    playCue(nowBreak ? "breakStart" : "workStart", settings.soundPreset);
  }
  if (settings.notificationsEnabled) {
    const task = taskById(session.taskId);
    const title = task?.title ?? "Untitled task";
    if (nowBreak) notify("Pomodoro complete", `Time for a break — ${title}`);
    else notify("Break over", `Time to focus — ${title}`);
  }
  announce(nowBreak ? "Pomodoro complete. Time for a break." : "Break over. Time to focus.");
}

/**
 * 0087: a pomodoro break ended — cue it, then freeze at the start of the next
 * focus block instead of auto-starting it. The user resumes explicitly.
 */
function handlePomodoroBreakEnd(
  session: Session,
  snap: TimerSnapshot,
  config: TimerConfig,
  now: number,
): void {
  if (settings.soundEnabled) {
    playCue("workStart", settings.soundPreset);
  }
  if (settings.notificationsEnabled) {
    const task = taskById(session.taskId);
    notify("Break over", task ? `Time to focus — ${task.title}` : "Time to focus");
  }
  announce("Break over. Paused — resume when ready for the next focus block.");
  const phaseDur = phaseMs(snap.phase, config);
  const elapsedIntoPhase = snap.remainingMs != null ? phaseDur - snap.remainingMs : 0;
  const boundary = snap.elapsedMs - elapsedIntoPhase;
  pauseAfterPomodoroBreak(session, boundary, now);
  setLastWatch({ sessionId: session.id, phase: snap.phase, running: false });
  flashPhaseChange();
}

/** 0057: run once on returning to a visible tab to catch transitions missed while throttled. */
export function catchUpHidden(): void {
  if (breakState) {
    // 0087: a waiting (not-yet-started) break has no countdown to catch up on.
    if (breakState.running && !breakState.done && breakState.endsAt <= Date.now()) {
      breakOver();
    }
    return;
  }
  if (quickRun) return; // count-up, nothing to transition
  const session = activeSession();
  if (!session || session.status === "done") return;
  const config = timerConfig();
  const snap = snapshot(session, config);

  if (
    session.technique === "flowtime" &&
    settings.maxFlowtimeMin > 0 &&
    snap.elapsedMs >= settings.maxFlowtimeMin * MIN
  ) {
    finishSession(session);
    return;
  }

  const running = session.status === "running";
  let enteredBreak = false;
  if (lastWatch && lastWatch.sessionId === session.id && lastWatch.running && running) {
    const wasBreak = lastWatch.phase !== "work";
    const nowBreak = snap.phase !== "work";
    // 0087: break→work never auto-starts the next focus block — pause at the boundary.
    if (wasBreak && !nowBreak && session.technique === "pomodoro") {
      handlePomodoroBreakEnd(session, snap, config, Date.now());
      return;
    }
    if (wasBreak !== nowBreak && nowBreak) {
      handlePhaseBoundary(session, nowBreak);
      enteredBreak = true;
    }
  }
  setLastWatch({ sessionId: session.id, phase: snap.phase, running });
  render();
  // 0088: full render already carries the phase-break tint; flash the crossfade.
  if (enteredBreak) flashPhaseChange();
}

/**
 * Display-only tick. All time is derived from wall-clock timestamps so this
 * never drifts and pausing/refreshing is safe.
 */
function repaintTick(): void {
  if (breakState && !breakState.done && breakState.running) {
    const clock = document.querySelector<HTMLElement>(".clock");
    if (!clock) return;
    const remaining = breakState.endsAt - Date.now();
    if (remaining <= 0) {
      breakOver();
      return;
    }
    clock.textContent = formatMs(remaining);
    const total = breakState.endsAt - breakState.startedAt;
    updateClockRing(total > 0 ? remaining / total : 0);
    updateDocumentTitle(formatMs(remaining));
    return;
  }

  if (quickRun) {
    const clock = document.querySelector<HTMLElement>(".clock");
    const text = formatElapsed(Date.now() - quickRun.startedAt);
    if (clock) clock.textContent = text;
    updateDocumentTitle(text);
    return;
  }

  const session = activeSession();
  if (!session || session.status === "done") {
    stopRepaint();
    setLastWatch(null);
    nudgeFloor = null;
    nudgeSessionId = null;
    return;
  }
  const clock = document.querySelector<HTMLElement>(".clock");
  const phase = document.querySelector<HTMLElement>(".session-phase");
  const count = document.querySelector<HTMLElement>(".pomodoro-count");
  if (!clock) return;

  const config = timerConfig();
  const snap = snapshot(session, config);

  if (
    session.technique === "flowtime" &&
    settings.maxFlowtimeMin > 0 &&
    snap.elapsedMs >= settings.maxFlowtimeMin * MIN
  ) {
    finishSession(session);
    return;
  }

  // 0087: a pomodoro break never auto-starts the next focus block — freeze at
  // the boundary and wait for an explicit resume.
  const runningAtTick = session.status === "running";
  if (
    session.technique === "pomodoro" &&
    runningAtTick &&
    lastWatch &&
    lastWatch.sessionId === session.id &&
    lastWatch.running &&
    lastWatch.phase !== "work" &&
    snap.phase === "work"
  ) {
    handlePomodoroBreakEnd(session, snap, config, Date.now());
    return;
  }

  // 0054: gentle "it's okay to stop" reminder, re-nudging on a fixed cadence.
  if (session.id !== nudgeSessionId) {
    nudgeSessionId = session.id;
    nudgeFloor = null;
  }
  if (
    session.technique === "flowtime" &&
    settings.flowtimeNudgeMin > 0 &&
    snap.elapsedMs >= settings.flowtimeNudgeMin * MIN
  ) {
    const limitMs = settings.flowtimeNudgeMin * MIN;
    const floor = limitMs + Math.floor((snap.elapsedMs - limitMs) / NUDGE_CADENCE) * NUDGE_CADENCE;
    if (nudgeFloor === null || floor > nudgeFloor) {
      nudgeFloor = floor;
      showFlowtimeNudge(session, Math.round(floor / MIN));
    }
  }

  const clockText =
    session.technique === "pomodoro" ? formatMs(snap.remainingMs) : formatElapsed(snap.elapsedMs);
  clock.textContent = clockText;
  updateDocumentTitle(clockText);
  if (phase) phase.textContent = `${phaseLabel(snap.phase)} · ${techniqueLabel(session.technique)}`;
  if (count) count.textContent = `${snap.completedPomodoros} completed`;

  // 0064: keep the pomodoro progress ring draining in sync with the digits.
  if (session.technique === "pomodoro") {
    const total = phaseMs(snap.phase, config);
    if (snap.remainingMs != null && total > 0) updateClockRing(snap.remainingMs / total);
  }

  const running = session.status === "running";
  if (lastWatch && lastWatch.sessionId === session.id && lastWatch.running && running) {
    const wasBreak = lastWatch.phase !== "work";
    const nowBreak = snap.phase !== "work";
    // 0087: break→work is handled above (pause at the boundary); only work→break
    // auto-starts here. 0088: no full render (keeps note inputs focused) — just
    // swap the ring tint and flash the crossfade.
    if (wasBreak !== nowBreak && nowBreak) {
      handlePhaseBoundary(session, nowBreak);
      const frame = document.querySelector<HTMLElement>(".clock-frame");
      if (frame) {
        frame.classList.remove("phase-work");
        frame.classList.add("phase-break");
      }
      flashPhaseChange();
    }
  }
  setLastWatch({ sessionId: session.id, phase: snap.phase, running });
}

export function startRepaint(): void {
  if (repaintHandle !== undefined) return;
  repaintHandle = window.setInterval(repaintTick, 250);
}

export function stopRepaint(): void {
  if (repaintHandle !== undefined) {
    clearInterval(repaintHandle);
    repaintHandle = undefined;
  }
}
