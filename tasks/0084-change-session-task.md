# 0084 — Switch the active task mid-session

Status: done

## Goal

A session is bound to a single task via `session.taskId` (shown as the title over
the clock, and used by Mark done / Finish / notifications / break countdown). But
life happens mid-focus: the task gets **blocked** (stalled on a dependency, waiting
on someone) or gets **finished** while the clock is still running. Today the only
way out is to cancel or finish the session and start over, losing the running clock
and the focus streak. Let the user **change which task the session points at**
without disturbing the timer — the clock, elapsed time, pomodoro phase, pause state
and completed-pomodoro count all carry on untouched; only the label and the
downstream task references move to the new task.

## Model

- On the session screen (`renderSession` in `views.ts`), a "Switch task" button
  sits in the session header, centered **below the "Focus · Pomodoro/Flowtime"
  phase indicator**. It's intentionally absent in focus mode (0006) to keep that
  screen distraction-free. `data-action="switch-task"`.
- Clicking opens a lightweight picker dialog (`openSwitchTaskPicker` in
  `actions.ts`):
  - A searchable list of **open** tasks (reuse the board's priority sort),
    excluding the currently-attached task, plus a de-emphasized "Completed"
    group (most recent 20) so a finished task can be re-attached.
  - An option to **create a new task** in place (reuse `buildAndAddTask` /
    `parseQuickAdd`, mirroring 0082) and attach it.
  - Esc or tapping the backdrop closes without changing anything.
- Selecting an entry sets `session.taskId = picked.id`, `persist()`s, and
  `render()`s the session screen so the title, resume-hint, description and
  distraction capture all re-point at the new task.
- **Nothing else changes**: `startedAt`, `pausedAt`, `accumulatedPauseMs`,
  `plannedMs`, `completedPomodoros`, `status` and the repaint tick are left alone,
  so the running clock is seamless. Switching while **paused** stays paused.
- A small helper `setSessionTask(session, taskId)` in `actions.ts` (reusing
  `persist` / `render`) is the single write path; the delegated click handler in
  `events.ts` → `handleAction` dispatches to it.
- If the user switches to a task that is already `done` (e.g. it just finished),
  confirm first ("Attach to a finished task?") so it isn't accidental.
- History still records the final `taskId` at Finish; no session-splitting or new
  session is created.

## Behavior

- The switch is instant: select a task, the header title swaps and the clock keeps
  ticking with no pause/reset/flash.
- The picker is keyboard-accessible (type to filter, Enter to create-and-switch,
  Esc to close), consistent with 0050 accessibility. Esc now closes any open
  dialog *before* exiting focus mode (ordering fix in `events.ts`).
- The newly attached task appears on the board as-is; if the previous one was left
  open it stays open (blocked case) — Mark done still toggles whatever task is
  currently attached.
- Feedback: a brief toast "Now working on …" confirms the switch.
- Compatible with quick-run too (`renderQuickRun`), where applicable.

## Acceptance criteria

- From a running session I can swap the attached task in ≤2 clicks and the clock
  continues without pausing, resetting, or losing elapsed/phase state.
- The session title, Mark done target, Finish record, notifications and break
  countdown all use the newly attached task.
- Switching while paused stays paused; completed pomodoros are preserved.
- I can also attach a brand-new task created from the picker.
- Selecting a done task asks for confirmation first.
- Accessible: the button and picker are keyboard-operable with sensible aria-labels.

## Nice to have

- Undo: a "switch back" action on the toast (0011 pattern).
- Remember the previous task per session so Finish can show "completed X, then
  switched to Y".
- Filter option "show blocked/open only" if tags (0023) ever encode a blocked state.