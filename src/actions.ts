import { announce } from "./announce";
import {
  DAY_MS,
  minutesInDay,
  nextDueDate,
  startOfLocalDay,
  todayStart,
  ymdForDate,
} from "./dates";
import { openDialog, showImportError, showMessage, downloadTextFile } from "./dialogs";
import { escapeHtml } from "./escape";
import { parseCsv, parseCsvTasks, parseQuickAdd, plannedForFrom } from "./parse";
import { startRepaint, stopRepaint } from "./repaint";
import {
  activeSession,
  applyTheme,
  breakState,
  focusMode,
  lastFinished,
  openMenuTaskId,
  openSections,
  persist,
  quickRun,
  SECTION_DEFAULTS,
  setBreakState,
  setDescriptionHintVisible,
  setFilterPriority,
  setFilterQuadrant,
  setFocusMode,
  setHiddenAt,
  setHiddenSessionId,
  setLastFinished,
  setLastWatch,
  setOpenMenuTaskId,
  setQuickRun,
  setResumeHintVisible,
  setSearchQuery,
  setSectionOpen,
  setSettings,
  setState,
  setSubView,
  settings,
  state,
  taskById,
  timerConfig,
} from "./state";
import {
  buildExport,
  emptyState,
  loadBackup,
  loadSnapshots,
  markOnboarded,
  parseImport,
  removeSnapshot,
  saveBackup,
  saveSettings,
} from "./storage";
import { doneSessions, sessionWorkMs, taskTotals } from "./stats";
import { isFutureOpen, isTodayOpen } from "./tasks";
import { MIN, formatDuration, snapshot, techniqueLabel } from "./timer";
import type { SectionKey } from "./state";
import type { Quadrant, Recurrence, Session, Settings, Task, Technique } from "./types";
import { QUADRANT_LABEL, newId } from "./types";
import { notify, requestPermission } from "./notify";
import { playCue } from "./sound";
import { render, positionRowMenu } from "./views";

/* ------------------------------------------------------------------ */
/* Task parsing                                                        */
/* ------------------------------------------------------------------ */

function parseTags(title: string): string[] {
  const matches = Array.from(title.matchAll(/#([\p{L}\p{N}_-]+)/gu), (m) => m[1].toLowerCase());
  return [...new Set(matches)];
}

function stripTags(title: string): string {
  return title
    .replace(/#[\p{L}\p{N}_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nextManualOrder(): number {
  return state.tasks.reduce((max, t) => Math.max(max, t.order ?? 0), 0) + 1;
}

/* ------------------------------------------------------------------ */
/* Undo toasts (0045)                                                  */
/* ------------------------------------------------------------------ */

/** Fixed bottom-right stack for all toasts, so several can coexist. */
function toastRegion(): HTMLElement {
  let region = document.getElementById("toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.className = "toast-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  return region;
}

function showUndoToast(message: string, onUndo: () => void): void {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span class="toast-text">${escapeHtml(message)}</span>
    <button id="undo-action" class="primary">Undo</button>`;
  toastRegion().appendChild(toast);
  const dismiss = (): void => toast.remove();
  toast.querySelector("#undo-action")!.addEventListener("click", (e) => {
    e.stopPropagation();
    onUndo();
    dismiss();
  });
  window.setTimeout(dismiss, 6000);
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function weekdayOptions(selected: number): string {
  return WEEKDAY_NAMES.map(
    (name, i) => `<option value="${i}" ${i === selected ? "selected" : ""}>${name}</option>`,
  ).join("");
}

function monthDayOptions(selected: number): string {
  return Array.from({ length: 31 }, (_, i) => i + 1)
    .map((d) => `<option value="${d}" ${d === selected ? "selected" : ""}>${d}</option>`)
    .join("");
}

function timeToInput(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTimeInput(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
  return h * 60 + m;
}

function currentWeekday(): number {
  return new Date().getDay();
}

/* ------------------------------------------------------------------ */
/* Task actions                                                        */
/* ------------------------------------------------------------------ */

export function addTask(): void {
  addTaskFromInput(false);
}

/** 0080: add the typed task and jump straight into the focus-session chooser. */
export function addTaskAndFocus(): void {
  addTaskFromInput(true);
}

function addTaskFromInput(startFocus: boolean): void {
  const titleInput = document.querySelector<HTMLInputElement>("#task-title");
  const priorityInput = document.querySelector<HTMLSelectElement>("#task-priority");
  const quadrantInput = document.querySelector<HTMLSelectElement>("#task-quadrant");
  const quickInput = document.querySelector<HTMLInputElement>("#task-quick");
  if (!titleInput || !priorityInput || !quadrantInput) return;

  const rawTitle = titleInput.value.trim();
  if (!rawTitle) return;

  buildAndAddTask(
    rawTitle,
    {
      priority: Number(priorityInput.value),
      quadrant: quadrantInput.value as Quadrant,
      quick: quickInput?.checked ?? false,
    },
    (task) => {
      titleInput.value = "";
      // 0071: clear the live parsing chips once the task is created.
      const chips = document.getElementById("add-parse-feedback");
      if (chips) chips.innerHTML = "";
      if (startFocus) promptStartSession(task.id);
    },
  );
}

/**
 * Parse and add a task from any text field, reusing the board's natural-language
 * parsing and its duplicate guard. Defaults (priority/quadrant/quick) are only
 * used when the text doesn't specify them. `onCreated` runs after the task is
 * persisted and rendered.
 */
function buildAndAddTask(
  rawTitle: string,
  defaults: { priority?: number; quadrant?: Quadrant; quick?: boolean },
  onCreated?: (task: Task) => void,
): void {
  const parsed = parseQuickAdd(rawTitle);
  const cleanTitle = stripTags(parsed.clean || rawTitle) || rawTitle;
  const priority = parsed.priority ?? defaults.priority ?? 2;
  const quadrant = defaults.quadrant ?? "q2";
  const quick = defaults.quick ?? false;
  const plannedFor = plannedForFrom(parsed.dueDay, parsed.timeMin);

  const create = (): void => {
    const task: Task = {
      id: newId(),
      title: cleanTitle,
      priority,
      quadrant,
      done: false,
      createdAt: Date.now(),
      doneAt: null,
      estimatedMin: null,
      quick,
      tags: parseTags(rawTitle),
      description: "",
      plannedFor,
      recurrence: null,
      order: nextManualOrder(),
      completions: [],
    };
    state.tasks.push(task);
    persist();
    render();
    onCreated?.(task);
  };

  // 0052: warn about duplicate open tasks.
  const duplicate = state.tasks.find(
    (t) => !t.done && t.title.trim().toLowerCase() === cleanTitle.toLowerCase(),
  );
  if (duplicate) {
    const overlay = openDialog(`
      <h3>Task already exists</h3>
      <p class="dialog-text">"${escapeHtml(duplicate.title)}" is already open. Add it anyway?</p>
      <div class="dialog-actions">
        <button id="dup-cancel" class="ghost">Cancel</button>
        <button id="dup-ok" class="primary">Add anyway</button>
      </div>`);
    overlay.querySelector("#dup-cancel")!.addEventListener("click", () => overlay.remove());
    overlay.querySelector("#dup-ok")!.addEventListener("click", () => {
      overlay.remove();
      create();
    });
    return;
  }
  create();
}

/** 0082: add a task typed on the session screen without leaving the session. */
export function addSessionTask(): void {
  const input = document.querySelector<HTMLInputElement>("#capture-thought");
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;
  buildAndAddTask(raw, { priority: 2, quadrant: "q2", quick: false }, () => {
    const confirmEl = document.getElementById("capture-confirm");
    if (confirmEl) {
      confirmEl.textContent = "Captured — added to your board";
      confirmEl.classList.add("visible");
      window.setTimeout(() => confirmEl.classList.remove("visible"), 2200);
    }
  });
}

function toggleTask(id: string): void {
  const task = taskById(id);
  if (!task) return;
  // 0043: completing a recurring task immediately reopens it for its next occurrence.
  // 0063: each completed occurrence is appended to the task's completion history.
  if (!task.done && task.recurrence) {
    const prev = task.plannedFor;
    const completion = { completedAt: Date.now(), plannedFor: prev };
    task.completions.push(completion);
    task.plannedFor = nextDueDate(task.recurrence, completion.completedAt);
    persist();
    render();
    showUndoToast("Task rescheduled for its next occurrence", () => {
      task.plannedFor = prev;
      task.completions = task.completions.filter((c) => c !== completion);
      persist();
      render();
    });
    return;
  }
  if (!task.done) {
    // 0067: brief checkmark animation on the row's toggle before committing.
    const btn = document.querySelector<HTMLElement>(`.check[data-id="${id}"]`);
    const commit = (): void => {
      task.done = true;
      task.doneAt = Date.now();
      persist();
      render();
      announce("Task completed");
      showUndoToast("Task completed", () => {
        task.done = false;
        task.doneAt = null;
        persist();
        render();
      });
    };
    if (btn) {
      btn.classList.add("checking");
      window.setTimeout(commit, 160);
    } else {
      commit();
    }
    return;
  }
  task.done = false;
  task.doneAt = null;
  persist();
  render();
}

/** Mark the session's task done and finish the running session in one go. */
function markDoneAndFinish(id: string): void {
  const task = taskById(id);
  if (!task) return;
  const session = activeSession();

  // A task already done is just toggled back open, without touching the session.
  if (task.done) {
    task.done = false;
    task.doneAt = null;
    persist();
    render();
    return;
  }

  // 0043/0063: completing a recurring task reopens it for its next occurrence.
  if (task.recurrence) {
    const prev = task.plannedFor;
    const completion = { completedAt: Date.now(), plannedFor: prev };
    task.completions.push(completion);
    task.plannedFor = nextDueDate(task.recurrence, completion.completedAt);
  } else {
    task.done = true;
    task.doneAt = Date.now();
  }

  if (session && session.status !== "done") {
    finishSession(session);
  } else {
    persist();
    render();
  }
}

function toggleQuick(id: string): void {
  const task = taskById(id);
  if (!task) return;
  task.quick = !task.quick;
  persist();
  render();
}

/** Open tasks in the current manual order (the ordering used by the manual sort mode). */
function manualOrderTasks(): Task[] {
  return state.tasks
    .filter((t) => !t.done)
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt - b.createdAt,
    );
}

function writeManualOrder(orderedIds: string[]): void {
  for (const [i, id] of orderedIds.entries()) {
    const t = state.tasks.find((x) => x.id === id);
    if (t) t.order = i + 1;
  }
  persist();
  render();
}

/** 0074: restore a captured order snapshot (undo for reorders). */
function restoreOrders(prev: { id: string; order: number }[]): void {
  for (const p of prev) {
    const t = taskById(p.id);
    if (t) t.order = p.order;
  }
  persist();
  render();
}

/** 0048: reorder open tasks in manual mode when one is dragged over another. */
export function reorderTasks(draggedId: string, overId: string): void {
  if (draggedId === overId) return;
  const ids = manualOrderTasks().map((t) => t.id);
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return;
  const prev = state.tasks.map((t) => ({ id: t.id, order: t.order }));
  ids.splice(from, 1);
  ids.splice(to, 0, draggedId);
  writeManualOrder(ids);
  showUndoToast("Order changed", () => restoreOrders(prev));
}

/** 0060: keyboard/touch-friendly reordering — swap a task with its neighbor. */
function moveTask(id: string, direction: "up" | "down"): void {
  const ids = manualOrderTasks().map((t) => t.id);
  const i = ids.indexOf(id);
  if (i < 0) return;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return;
  const prev = state.tasks.map((t) => ({ id: t.id, order: t.order }));
  [ids[i], ids[j]] = [ids[j], ids[i]];
  writeManualOrder(ids);
  showUndoToast("Order changed", () => restoreOrders(prev));
}

function toggleToday(id: string): void {
  const task = taskById(id);
  if (!task) return;
  const prev = task.plannedFor;
  task.plannedFor = isTodayOpen(task) ? null : todayStart();
  persist();
  render();
  if (task.plannedFor !== prev) {
    showUndoToast("Plan updated", () => {
      task.plannedFor = prev;
      persist();
      render();
    });
  }
}

function openDeferDialog(id: string): void {
  const task = taskById(id);
  if (!task) return;
  // Default to tomorrow's local midnight; computed via Date so DST-safe.
  const defaultDate =
    task.plannedFor && task.plannedFor > todayStart()
      ? task.plannedFor
      : startOfLocalDay(Date.now() + DAY_MS);

  const overlay = openDialog(`
    <h3>Defer task</h3>
    <p class="dialog-task">${escapeHtml(task.title)}</p>
    <label class="field">
      <span>Planned date</span>
      <input type="date" id="defer-date" value="${ymdForDate(defaultDate)}" />
    </label>
    <div class="dialog-actions">
      <button id="defer-clear" class="ghost">Clear plan</button>
      <button id="defer-cancel" class="ghost">Cancel</button>
      <button id="defer-ok" class="primary">Save</button>
    </div>`);

  overlay.querySelector("#defer-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#defer-clear")!.addEventListener("click", () => {
    const prev = task.plannedFor;
    task.plannedFor = null;
    persist();
    overlay.remove();
    render();
    if (prev !== null) {
      showUndoToast("Plan cleared", () => {
        task.plannedFor = prev;
        persist();
        render();
      });
    }
  });
  overlay.querySelector("#defer-ok")!.addEventListener("click", () => {
    const value = overlay.querySelector<HTMLInputElement>("#defer-date")?.value;
    const prev = task.plannedFor;
    if (value) {
      const [y, m, d] = value.split("-").map(Number);
      const date = new Date(y, (m ?? 1) - 1, d ?? 1);
      task.plannedFor = startOfLocalDay(date.getTime());
    }
    persist();
    overlay.remove();
    render();
    if (task.plannedFor !== prev) {
      showUndoToast("Task deferred", () => {
        task.plannedFor = prev;
        persist();
        render();
      });
    }
  });
}

function openRecurrenceDialog(id: string): void {
  const task = taskById(id);
  if (!task) return;

  const now = new Date();
  const defaultDate =
    task.plannedFor && startOfLocalDay(task.plannedFor) > todayStart()
      ? task.plannedFor
      : Date.now() + DAY_MS;
  const defaultTime = task.recurrence?.time ?? minutesInDay(Date.now());

  const weekdaySelected =
    task.recurrence?.every === "weekly"
      ? (task.recurrence.weekday ?? currentWeekday())
      : currentWeekday();
  const daySelected =
    task.recurrence?.every === "monthly" ? (task.recurrence.day ?? now.getDate()) : now.getDate();

  const overlay = openDialog(`
    <h3>Repeats</h3>
    <p class="dialog-task">${escapeHtml(task.title)}</p>
    <div class="field-row">
      <label class="field">
        <span>Date</span>
        <input type="date" id="recur-date" value="${ymdForDate(defaultDate)}" />
      </label>
      <label class="field">
        <span>Time</span>
        <input type="time" id="recur-time" value="${timeToInput(defaultTime)}" />
      </label>
    </div>
    <label class="field">
      <span>Repeat</span>
      <select id="recur-every">
        <option value="none" ${!task.recurrence ? "selected" : ""}>Doesn't repeat (one-time)</option>
        <option value="daily" ${task.recurrence?.every === "daily" ? "selected" : ""}>Daily</option>
        <option value="workdays" ${task.recurrence?.every === "workdays" ? "selected" : ""}>Work days (Mon–Fri)</option>
        <option value="weekly" ${task.recurrence?.every === "weekly" ? "selected" : ""}>Weekly</option>
        <option value="monthly" ${task.recurrence?.every === "monthly" ? "selected" : ""}>Monthly</option>
      </select>
    </label>
    <label class="field" id="recur-weekday-field" ${task.recurrence?.every === "weekly" ? "" : "hidden"}>
      <span>On weekday</span>
      <select id="recur-weekday">${weekdayOptions(weekdaySelected)}</select>
    </label>
    <label class="field" id="recur-day-field" ${task.recurrence?.every === "monthly" ? "" : "hidden"}>
      <span>Day of month</span>
      <select id="recur-day">${monthDayOptions(daySelected)}</select>
    </label>
    <div class="dialog-actions">
      <button id="recur-cancel" class="ghost">Cancel</button>
      <button id="recur-save" class="primary">Save</button>
    </div>`);

  overlay.querySelector("#recur-cancel")!.addEventListener("click", () => overlay.remove());

  const toggleFields = () => {
    const mode = overlay.querySelector<HTMLSelectElement>("#recur-every")?.value ?? "none";
    overlay.querySelector<HTMLElement>("#recur-weekday-field")!.hidden = mode !== "weekly";
    overlay.querySelector<HTMLElement>("#recur-day-field")!.hidden = mode !== "monthly";
  };
  overlay.querySelector("#recur-every")?.addEventListener("change", toggleFields);

  overlay.querySelector("#recur-save")!.addEventListener("click", () => {
    const dateValue = overlay.querySelector<HTMLInputElement>("#recur-date")?.value;
    const time = parseTimeInput(overlay.querySelector<HTMLInputElement>("#recur-time")?.value);
    const mode = overlay.querySelector<HTMLSelectElement>("#recur-every")?.value ?? "none";

    let dueAt = task.plannedFor ?? Date.now();
    if (dateValue) {
      const [y, m, d] = dateValue.split("-").map(Number);
      const date = new Date(y, (m ?? 1) - 1, d ?? 1);
      dueAt = startOfLocalDay(date.getTime()) + (time ?? 0) * 60_000;
    }

    let recurrence: Recurrence | null = null;
    if (mode === "daily") {
      recurrence = { every: "daily", ...(time !== undefined ? { time } : {}) };
    } else if (mode === "workdays") {
      recurrence = { every: "workdays", ...(time !== undefined ? { time } : {}) };
    } else if (mode === "weekly") {
      recurrence = {
        every: "weekly",
        weekday: Number(
          overlay.querySelector<HTMLSelectElement>("#recur-weekday")?.value ?? currentWeekday(),
        ),
        ...(time !== undefined ? { time } : {}),
      };
    } else if (mode === "monthly") {
      recurrence = {
        every: "monthly",
        day: Number(
          overlay.querySelector<HTMLSelectElement>("#recur-day")?.value ?? new Date().getDate(),
        ),
        ...(time !== undefined ? { time } : {}),
      };
    }

    task.plannedFor = dueAt;
    task.recurrence = recurrence;
    persist();
    overlay.remove();
    render();
  });
}

function confirmDeleteTask(id: string): void {
  const task = taskById(id);
  if (!task) return;
  const sessionCount = doneSessions(state).filter((s) => s.taskId === id).length;
  const overlay = openDialog(`
    <h3>Delete task?</h3>
    <p class="dialog-text">${escapeHtml(task.title)}${sessionCount > 0 ? ` has ${sessionCount} session${sessionCount === 1 ? "" : "s"} in history.` : ""} Session history is kept but will be shown as "deleted task".</p>
    <div class="dialog-actions">
      <button id="del-task-cancel" class="ghost">Cancel</button>
      <button id="del-task-ok" class="danger-btn">Delete</button>
    </div>`);
  overlay.querySelector("#del-task-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#del-task-ok")!.addEventListener("click", () => {
    deleteTask(id);
    overlay.remove();
  });
}

function deleteTask(id: string): void {
  const index = state.tasks.findIndex((t) => t.id === id);
  const task = state.tasks[index];
  if (!task) return;
  state.tasks.splice(index, 1);
  persist();
  render();
  showUndoToast("Task deleted", () => {
    state.tasks.splice(Math.min(index, state.tasks.length), 0, task);
    persist();
    render();
  });
}

function confirmDeleteSession(sessionId: string): void {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const task = taskById(session.taskId);
  const overlay = openDialog(`
    <h3>Delete this session?</h3>
    <p class="dialog-text">${escapeHtml(task?.title ?? "Session")} · ${techniqueLabel(session.technique)} · ${formatDuration(sessionWorkMs(session, settings))}. You can undo this.</p>
    <div class="dialog-actions">
      <button id="del-cancel" class="ghost">Cancel</button>
      <button id="del-ok" class="danger-btn">Delete</button>
    </div>`);
  overlay.querySelector("#del-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#del-ok")!.addEventListener("click", () => {
    const index = state.sessions.findIndex((s) => s.id === sessionId);
    const removedNotes = state.notes.filter((n) => n.sessionId === sessionId);
    state.sessions = state.sessions.filter((s) => s.id !== sessionId);
    state.notes = state.notes.filter((n) => n.sessionId !== sessionId);
    persist();
    overlay.remove();
    render();
    showUndoToast(`Session deleted · ${task?.title ?? "Session"}`, () => {
      state.sessions.splice(Math.min(index, state.sessions.length), 0, session);
      state.notes.push(...removedNotes);
      persist();
      render();
    });
  });
}

/** 0083: cycle order for the quadrant pill (q1 → q2 → q3 → q4 → q1). */
const QUADRANT_CYCLE: Quadrant[] = ["q1", "q2", "q3", "q4"];

/** 0083: cycle a task's quadrant from the row pill. */
function cycleQuadrant(id: string): void {
  const task = taskById(id);
  if (!task) return;
  const idx = QUADRANT_CYCLE.indexOf(task.quadrant);
  task.quadrant = QUADRANT_CYCLE[(idx + 1) % QUADRANT_CYCLE.length];
  persist();
  render();
}

/** 0083: cycle a task's priority (1 → 2 → 3 → 4 → 5 → 1) from the row pill. */
function cyclePriority(id: string): void {
  const task = taskById(id);
  if (!task) return;
  task.priority = (task.priority % 5) + 1;
  persist();
  render();
}

export function setEstimate(id: string, value: string): void {
  const task = taskById(id);
  if (!task) return;
  const raw = value.trim();
  const n = raw === "" ? null : Number(raw);
  task.estimatedMin =
    n != null && Number.isFinite(n) && n > 0 ? Math.min(300, Math.round(n)) : null;
  persist();
  render();
}

function openEditTask(id: string): void {
  const task = taskById(id);
  if (!task) return;

  const priorityOptions = [1, 2, 3, 4, 5]
    .map((p) => `<option value="${p}" ${task.priority === p ? "selected" : ""}>${p}</option>`)
    .join("");
  const quadrantOptions = (["q1", "q2", "q3", "q4"] as Quadrant[])
    .map(
      (q) =>
        `<option value="${q}" ${task.quadrant === q ? "selected" : ""}>${QUADRANT_LABEL[q]}</option>`,
    )
    .join("");

  const overlay = openDialog(`
    <h3>Edit task</h3>
    <form id="edit-form">
      <label class="field">
        <span>Title</span>
        <input type="text" id="edit-title" value="${escapeHtml(task.title)}" />
      </label>
      <div class="settings-grid">
        <label class="field">
          <span>Priority</span>
          <select id="edit-priority">${priorityOptions}</select>
        </label>
        <label class="field">
          <span>Quadrant</span>
          <select id="edit-quadrant">${quadrantOptions}</select>
        </label>
        ${
          settings.showEstimates
            ? `<label class="field">
                <span>Estimate (min)</span>
                <input type="number" id="edit-estimate" min="0" max="300" value="${task.estimatedMin ?? ""}" />
              </label>`
            : ""
        }
        <label class="field check-field">
          <span>Quick</span>
          <input type="checkbox" id="edit-quick" ${task.quick ? "checked" : ""} />
        </label>
      </div>
      <label class="field">
        <span>Repeats</span>
        <div class="field-row">
          <select id="edit-recurrence">
            <option value="none" ${!task.recurrence ? "selected" : ""}>Doesn't repeat</option>
            <option value="daily" ${task.recurrence?.every === "daily" ? "selected" : ""}>Daily</option>
            <option value="workdays" ${task.recurrence?.every === "workdays" ? "selected" : ""}>Work days</option>
            <option value="weekly" ${task.recurrence?.every === "weekly" ? "selected" : ""}>Weekly</option>
            <option value="monthly" ${task.recurrence?.every === "monthly" ? "selected" : ""}>Monthly</option>
          </select>
          <select
            id="edit-recurrence-weekday"
            ${task.recurrence?.every === "weekly" ? "" : "hidden"}
            aria-label="Weekday"
          >
            ${weekdayOptions(task.recurrence?.every === "weekly" ? (task.recurrence.weekday ?? currentWeekday()) : currentWeekday())}
          </select>
          <select
            id="edit-recurrence-day"
            ${task.recurrence?.every === "monthly" ? "" : "hidden"}
            aria-label="Day of month"
          >
            ${monthDayOptions(task.recurrence?.every === "monthly" ? (task.recurrence.day ?? new Date().getDate()) : new Date().getDate())}
          </select>
          <input
            type="time"
            id="edit-recurrence-time"
            value="${timeToInput(task.recurrence?.time ?? minutesInDay(Date.now()))}"
            aria-label="Time of day"
          />
        </div>
      </label>
      <label class="field">
        <span>Tags (#tag)</span>
        <input type="text" id="edit-tags" value="${escapeHtml((task.tags ?? []).join(" "))}" placeholder="#work #home" />
      </label>
      <label class="field">
        <span>Description</span>
        <textarea id="edit-desc" rows="3" placeholder="Optional longer description">${escapeHtml(task.description ?? "")}</textarea>
      </label>
      <div class="dialog-actions">
        <button type="button" id="edit-cancel" class="ghost">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>`);

  const form = overlay.querySelector<HTMLFormElement>("#edit-form")!;
  overlay.querySelector("#edit-cancel")!.addEventListener("click", () => overlay.remove());

  const toggleRecurrenceFields = () => {
    const mode = overlay.querySelector<HTMLSelectElement>("#edit-recurrence")?.value ?? "none";
    const weekday = overlay.querySelector<HTMLSelectElement>("#edit-recurrence-weekday")!;
    const day = overlay.querySelector<HTMLSelectElement>("#edit-recurrence-day")!;
    weekday.hidden = mode !== "weekly";
    day.hidden = mode !== "monthly";
  };
  overlay.querySelector("#edit-recurrence")?.addEventListener("change", toggleRecurrenceFields);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const titleField = overlay.querySelector<HTMLInputElement>("#edit-title")!.value;
    const tagsField = overlay.querySelector<HTMLInputElement>("#edit-tags")?.value ?? "";
    const cleanTitle = stripTags(titleField);
    if (!cleanTitle && !titleField.trim()) return;
    const estRaw = overlay.querySelector<HTMLInputElement>("#edit-estimate")?.value.trim() ?? "";
    const est = estRaw === "" ? null : Number(estRaw);

    const recurMode = overlay.querySelector<HTMLSelectElement>("#edit-recurrence")?.value ?? "none";
    const time = parseTimeInput(
      overlay.querySelector<HTMLInputElement>("#edit-recurrence-time")?.value,
    );
    let recurrence: Recurrence | null = null;
    if (recurMode === "daily") {
      recurrence = { every: "daily", ...(time !== undefined ? { time } : {}) };
    } else if (recurMode === "workdays") {
      recurrence = { every: "workdays", ...(time !== undefined ? { time } : {}) };
    } else if (recurMode === "weekly") {
      const weekday = Number(
        overlay.querySelector<HTMLSelectElement>("#edit-recurrence-weekday")?.value ?? 0,
      );
      recurrence = { every: "weekly", weekday, ...(time !== undefined ? { time } : {}) };
    } else if (recurMode === "monthly") {
      const day = Number(
        overlay.querySelector<HTMLSelectElement>("#edit-recurrence-day")?.value ?? 1,
      );
      recurrence = { every: "monthly", day, ...(time !== undefined ? { time } : {}) };
    }

    task.title = cleanTitle || titleField.trim();
    task.priority = Math.min(
      5,
      Math.max(1, Number(overlay.querySelector<HTMLSelectElement>("#edit-priority")!.value)),
    );
    task.quadrant = overlay.querySelector<HTMLSelectElement>("#edit-quadrant")!.value as Quadrant;
    task.estimatedMin =
      est != null && Number.isFinite(est) && est > 0 ? Math.min(300, Math.round(est)) : null;
    task.quick = overlay.querySelector<HTMLInputElement>("#edit-quick")?.checked ?? false;
    task.tags = parseTags(`${titleField} ${tagsField}`);
    task.description = overlay.querySelector<HTMLTextAreaElement>("#edit-desc")!.value;
    task.recurrence = recurrence;
    persist();
    overlay.remove();
    render();
  });
}

/* ------------------------------------------------------------------ */
/* Settings / data management                                          */
/* ------------------------------------------------------------------ */

const ISSUES_URL = "https://github.com/strosek/ultradiandrift/issues";

function toggleTheme(): void {
  settings.theme = settings.theme === "night" ? "day" : "night";
  saveSettings(settings);
  applyTheme(settings.theme);
  render();
}

function openAboutModal(): void {
  const overlay = openDialog(`
    <h3>About UltradianDrift</h3>
    <div class="about">
      <p><strong>Work in sync with your natural rhythm.</strong> UltradianDrift is a free, browser-only
      task tracker that syncs your tasks and focus sessions with your body's natural pulses —
      the ~90-minute ultradian waves when you're genuinely sharp, followed by the rest you need.</p>
      <h4>Why it works</h4>
      <p>Most focus apps interrupt you right when you're in flow. UltradianDrift treats <strong>Flowtime</strong>
      (count-up, work until your energy dips) as the default way to focus, and keeps
      <strong>Pomodoro</strong> around for when you need a forcing function against
      procrastination. After ~90 minutes — one natural ultradian wave — Flowtime can gently remind
      you that it's okay to stop, without ever forcing you to. No account, no subscription, no
      tracking — your data lives in your browser.</p>
      <h4>Get started</h4>
      <ul>
        <li>Add a task, pick a priority (1–5) and a quadrant (urgent / important).</li>
        <li>Mark recurring routines (<em>daily</em>, <em>work days</em>, <em>weekly</em>,
          <em>monthly</em>) with the repeat menu on each task.</li>
        <li>Hit <strong>play</strong> on a task to start a Flowtime or Pomodoro session; finish
          when your energy dips and take a real break.</li>
        <li>Use tags (<code>#work</code>) and the search box to find things fast.</li>
        <li>Your history and focus dashboard show where your time actually went.</li>
      </ul>
      <h4>Keyboard shortcuts</h4>
      <ul class="shortcuts-list">
        <li><strong>N</strong> new task</li>
        <li><strong>/</strong> search</li>
        <li><strong>D</strong> dashboard · <strong>H</strong> history</li>
        <li><strong>J</strong>/<strong>K</strong> move between tasks</li>
        <li><strong>Space</strong> pause/resume</li>
        <li><strong>F</strong> finish</li>
        <li><strong>T</strong> task · <strong>M</strong> note · <strong>G</strong> distraction (in session)</li>
        <li><strong>?</strong> shortcuts</li>
        <li><strong>Esc</strong> close / exit</li>
      </ul>
    </div>
    <div class="dialog-actions">
      <a class="ghost about-link" href="${ISSUES_URL}" target="_blank" rel="noopener noreferrer">Feedback</a>
      <button id="about-ok" class="primary">Got it</button>
    </div>`);
  overlay.querySelector("#about-ok")!.addEventListener("click", () => overlay.remove());
}

/** 0073: compact cheat-sheet overlay for the keyboard shortcuts. */
function openShortcutsCheat(): void {
  const overlay = openDialog(`
    <h3>Keyboard shortcuts</h3>
    <ul class="shortcuts-list">
      <li><strong>N</strong> new task</li>
      <li><strong>/</strong> search</li>
      <li><strong>D</strong> dashboard · <strong>H</strong> history</li>
      <li><strong>J</strong> / <strong>K</strong> move between tasks</li>
      <li><strong>Space</strong> pause / resume</li>
      <li><strong>F</strong> finish</li>
      <li><strong>T</strong> task · <strong>M</strong> note · <strong>G</strong> distraction (in session)</li>
      <li><strong>?</strong> this list</li>
      <li><strong>Esc</strong> close / exit</li>
    </ul>
    <div class="dialog-actions">
      <button id="shortcuts-ok" class="primary">Got it</button>
    </div>`);
  overlay.querySelector("#shortcuts-ok")!.addEventListener("click", () => overlay.remove());
}

function openSettings(): void {
  const overlay = openDialog(`
    <h3>Settings</h3>
    <form id="settings-form">
      <div class="settings-tabs" role="tablist" aria-label="Settings sections">
        <button type="button" id="tab-basic" class="settings-tab" role="tab" aria-selected="true" aria-controls="panel-basic" data-tab="basic" tabindex="0">Basic</button>
        <button type="button" id="tab-advanced" class="settings-tab" role="tab" aria-selected="false" aria-controls="panel-advanced" data-tab="advanced" tabindex="-1">Advanced<span class="tab-count" aria-hidden="true"></span></button>
      </div>

      <div id="panel-basic" class="settings-panel" role="tabpanel" aria-labelledby="tab-basic">
        <div class="settings-grid">
          <label class="field">
            <span>Pomodoro focus (min)</span>
            <input type="number" id="set-work" min="1" max="120" value="${settings.pomodoroWorkMin}" />
          </label>
          <label class="field">
            <span>Short break (min)</span>
            <input type="number" id="set-short" min="1" max="60" value="${settings.pomodoroShortBreakMin}" />
          </label>
          <label class="field">
            <span>Long break (min)</span>
            <input type="number" id="set-long" min="1" max="90" value="${settings.pomodoroLongBreakMin}" />
          </label>
          <label class="field">
            <span>Long break after (#)</span>
            <input type="number" id="set-long-every" min="1" max="12" value="${settings.pomodoroLongBreakEvery}" />
          </label>
          <label class="field">
            <span>Flowtime break (% of focus)</span>
            <input type="number" id="set-break-ratio" min="0" max="100" step="5" value="${Math.round(settings.flowtimeBreakRatio * 100)}" />
          </label>
          <label class="field">
            <span>Max flowtime (min, 0 = off)</span>
            <input type="number" id="set-max-flowtime" min="0" max="1440" value="${settings.maxFlowtimeMin}" />
          </label>
          <label class="field">
            <span>Flowtime gentle reminder (min, 0 = off)</span>
            <input type="number" id="set-flow-nudge" min="0" max="1440" value="${settings.flowtimeNudgeMin}" />
            <span class="field-hint">Gently remind you to stop after N minutes.</span>
          </label>
          <label class="field">
            <span>Sound preset</span>
            <div class="field-row">
              <select id="set-preset">
                <option value="chime" ${settings.soundPreset === "chime" ? "selected" : ""}>Chime</option>
                <option value="soft" ${settings.soundPreset === "soft" ? "selected" : ""}>Soft</option>
                <option value="breeze" ${settings.soundPreset === "breeze" ? "selected" : ""}>Breeze</option>
              </select>
              <button type="button" id="btn-preview-sound" class="ghost">Preview</button>
            </div>
          </label>
          <label class="field check-field">
            <span>Sound cues</span>
            <input type="checkbox" id="set-sound" ${settings.soundEnabled ? "checked" : ""} />
          </label>
          <label class="field check-field">
            <span>Auto-start break</span>
            <input type="checkbox" id="set-auto-break" ${settings.autoBreak ? "checked" : ""} />
          </label>
          <label class="field check-field">
            <span>Task estimates</span>
            <input type="checkbox" id="set-estimates" ${settings.showEstimates ? "checked" : ""} />
          </label>
          <label class="field check-field">
            <span>Browser notifications</span>
            <input type="checkbox" id="set-notifications" ${settings.notificationsEnabled ? "checked" : ""} />
          </label>
          <label class="field check-field">
            <span>Distraction log</span>
            <input type="checkbox" id="set-distractions" ${settings.distractionLogEnabled ? "checked" : ""} />
            <span class="field-hint">Park distractions during sessions.</span>
          </label>
        </div>
      </div>

      <div id="panel-advanced" class="settings-panel" role="tabpanel" aria-labelledby="tab-advanced" hidden>
        <h4 class="dialog-section">Data</h4>
        <div class="data-actions">
          <button type="button" id="btn-export" class="ghost">Export data</button>
          <button type="button" id="btn-export-md" class="ghost">Export history (Markdown)</button>
          <button type="button" id="btn-import" class="ghost">Import data</button>
          <button type="button" id="btn-import-csv" class="ghost">Import CSV</button>
          <button type="button" id="btn-restore" class="ghost">Restore last backup</button>
          <button type="button" id="btn-snapshots" class="ghost">Restore snapshot…</button>
          <a class="ghost" href="${ISSUES_URL}" target="_blank" rel="noopener noreferrer">Feedback</a>
        </div>

        <h4 class="dialog-section danger">Danger zone</h4>
        <div class="data-actions">
          <button type="button" id="btn-clear" class="danger-btn">Clear data</button>
        </div>
      </div>

      <div class="dialog-actions">
        <button type="button" id="settings-cancel" class="ghost">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>`);

  const form = overlay.querySelector<HTMLFormElement>("#settings-form")!;
  const cancel = overlay.querySelector<HTMLButtonElement>("#settings-cancel")!;
  const exportBtn = overlay.querySelector<HTMLButtonElement>("#btn-export")!;
  const exportMdBtn = overlay.querySelector<HTMLButtonElement>("#btn-export-md")!;
  const importBtn = overlay.querySelector<HTMLButtonElement>("#btn-import")!;
  const importCsvBtn = overlay.querySelector<HTMLButtonElement>("#btn-import-csv")!;
  const restoreBtn = overlay.querySelector<HTMLButtonElement>("#btn-restore")!;
  const snapshotsBtn = overlay.querySelector<HTMLButtonElement>("#btn-snapshots")!;
  const clearBtn = overlay.querySelector<HTMLButtonElement>("#btn-clear")!;
  const previewBtn = overlay.querySelector<HTMLButtonElement>("#btn-preview-sound")!;

  // 0076: Basic / Advanced tabs — panels are toggled (never rebuilt) so typed
  // values survive switching; arrow keys move between tabs (roving tabindex).
  const tabs = Array.from(overlay.querySelectorAll<HTMLButtonElement>(".settings-tab"));
  const panels = {
    basic: overlay.querySelector<HTMLElement>("#panel-basic")!,
    advanced: overlay.querySelector<HTMLElement>("#panel-advanced")!,
  };
  const showTab = (name: "basic" | "advanced"): void => {
    for (const tab of tabs) {
      const on = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    }
    panels.basic.hidden = name !== "basic";
    panels.advanced.hidden = name !== "advanced";
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab as "basic" | "advanced"));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next =
        e.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
      showTab(tabs[next].dataset.tab as "basic" | "advanced");
      tabs[next].focus();
    });
  });
  const countEl = overlay.querySelector<HTMLElement>("#tab-advanced .tab-count");
  if (countEl) {
    countEl.textContent = String(
      overlay.querySelectorAll("#panel-advanced .data-actions > *").length,
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const readNum = (sel: string, fallback: number): number => {
      const raw = Number((overlay.querySelector<HTMLInputElement>(sel)?.value ?? "").trim());
      return Number.isFinite(raw) ? raw : fallback;
    };
    const ratioPercent = Math.min(
      100,
      Math.max(0, readNum("#set-break-ratio", Math.round(settings.flowtimeBreakRatio * 100))),
    );
    const preset = overlay.querySelector<HTMLSelectElement>("#set-preset")
      ?.value as Settings["soundPreset"];

    const wantNotifications =
      overlay.querySelector<HTMLInputElement>("#set-notifications")?.checked ?? false;
    let notificationsEnabled = wantNotifications;
    if (wantNotifications) {
      const granted = await requestPermission();
      if (!granted) {
        notificationsEnabled = false;
        showMessage(
          "Notifications off",
          "Notification permission was not granted, so notifications stay off.",
        );
      }
    }

    setSettings({
      ...settings,
      pomodoroWorkMin: Math.min(120, Math.max(1, readNum("#set-work", settings.pomodoroWorkMin))),
      pomodoroShortBreakMin: Math.min(
        60,
        Math.max(1, readNum("#set-short", settings.pomodoroShortBreakMin)),
      ),
      pomodoroLongBreakMin: Math.min(
        90,
        Math.max(1, readNum("#set-long", settings.pomodoroLongBreakMin)),
      ),
      pomodoroLongBreakEvery: Math.min(
        12,
        Math.max(1, Math.round(readNum("#set-long-every", settings.pomodoroLongBreakEvery))),
      ),
      flowtimeBreakRatio: ratioPercent / 100,
      maxFlowtimeMin: Math.min(
        1440,
        Math.max(0, Math.round(readNum("#set-max-flowtime", settings.maxFlowtimeMin))),
      ),
      flowtimeNudgeMin: Math.min(
        1440,
        Math.max(0, Math.round(readNum("#set-flow-nudge", settings.flowtimeNudgeMin))),
      ),
      soundEnabled: overlay.querySelector<HTMLInputElement>("#set-sound")?.checked ?? true,
      soundPreset: preset === "soft" || preset === "breeze" ? preset : "chime",
      autoBreak: overlay.querySelector<HTMLInputElement>("#set-auto-break")?.checked ?? true,
      showEstimates: overlay.querySelector<HTMLInputElement>("#set-estimates")?.checked ?? true,
      notificationsEnabled,
      distractionLogEnabled:
        overlay.querySelector<HTMLInputElement>("#set-distractions")?.checked ?? false,
    });
    saveSettings(settings);
    overlay.remove();
    render();
  });

  cancel.addEventListener("click", () => overlay.remove());

  previewBtn.addEventListener("click", () => {
    const preset =
      (overlay.querySelector<HTMLSelectElement>("#set-preset")?.value as Settings["soundPreset"]) ??
      "chime";
    playCue("workStart", preset);
    window.setTimeout(() => playCue("finish", preset), 500);
  });

  exportBtn.addEventListener("click", () => {
    downloadTextFile(
      `ultradiandrift-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(buildExport(settings, state), null, 2),
      "application/json",
    );
  });

  exportMdBtn.addEventListener("click", () => {
    downloadTextFile(
      `ultradiandrift-history-${new Date().toISOString().slice(0, 10)}.md`,
      buildMarkdownHistory(),
      "text/markdown;charset=utf-8",
    );
  });

  importBtn.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = parseImport(String(reader.result ?? ""));
        if (!result.ok) {
          showImportError(result.error);
          return;
        }
        confirmImport(result.payload, overlay);
      };
      reader.readAsText(file);
    });
    input.click();
  });

  importCsvBtn.addEventListener("click", () => {
    openCsvImport();
  });

  restoreBtn.addEventListener("click", () => {
    const backup = loadBackup();
    if (!backup) {
      showMessage("No backup", "There is no saved backup to restore.");
      return;
    }
    const confirm = openDialog(`
      <h3>Restore last backup?</h3>
      <p class="dialog-text">Replace current data with the last saved backup (${backup.data.tasks.length} tasks, ${backup.data.sessions.length} sessions)?</p>
      <div class="dialog-actions">
        <button id="restore-cancel" class="ghost">Cancel</button>
        <button id="restore-ok" class="primary">Restore</button>
      </div>`);
    confirm.querySelector("#restore-cancel")!.addEventListener("click", () => confirm.remove());
    confirm.querySelector("#restore-ok")!.addEventListener("click", () => {
      setState(backup.data);
      setSettings(backup.settings);
      persist();
      saveSettings(settings);
      applyTheme(settings.theme);
      resetTransientState();
      confirm.remove();
      overlay.remove();
      render();
    });
  });

  snapshotsBtn.addEventListener("click", () => {
    const snapshots = loadSnapshots();
    if (!snapshots.length) {
      showMessage("No snapshots", "There are no daily snapshots to restore yet.");
      return;
    }
    const rows = snapshots
      .map(
        (s, i) => `
        <button class="ghost snapshot-row" data-snap="${i}">
          ${escapeHtml(s.day)} · ${s.backup.data.tasks.length} task(s), ${s.backup.data.sessions.length} session(s)
        </button>`,
      )
      .join("");
    const picker = openDialog(`
      <h3>Restore a snapshot</h3>
      <div class="snapshot-list">${rows}</div>
      <div class="dialog-actions">
        <button id="snap-cancel" class="ghost">Cancel</button>
      </div>`);
    picker.querySelector("#snap-cancel")!.addEventListener("click", () => picker.remove());
    picker.querySelectorAll<HTMLButtonElement>("[data-snap]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const snap = snapshots[Number(btn.dataset.snap)];
        picker.remove();
        const confirm = openDialog(`
          <h3>Restore ${escapeHtml(snap.day)}?</h3>
          <p class="dialog-text">Replace current data with this snapshot (${snap.backup.data.tasks.length} tasks, ${snap.backup.data.sessions.length} sessions)?</p>
          <div class="dialog-actions">
            <button id="snaprestore-cancel" class="ghost">Cancel</button>
            <button id="snaprestore-ok" class="primary">Restore</button>
          </div>`);
        confirm
          .querySelector("#snaprestore-cancel")!
          .addEventListener("click", () => confirm.remove());
        confirm.querySelector("#snaprestore-ok")!.addEventListener("click", () => {
          saveBackup(settings, state);
          setState(snap.backup.data);
          setSettings(snap.backup.settings);
          persist();
          saveSettings(settings);
          applyTheme(settings.theme);
          resetTransientState();
          removeSnapshot(snap.key);
          confirm.remove();
          overlay.remove();
          render();
        });
      });
    });
  });

  clearBtn.addEventListener("click", () => {
    const confirm = openDialog(`
      <h3>Clear all data?</h3>
      <p class="dialog-text">A backup will be saved first. This deletes ${state.tasks.length} task(s), ${state.sessions.length} session(s), and all notes. It cannot be undone. Settings are kept.</p>
      <div class="dialog-actions">
        <button id="clear-cancel" class="ghost">Cancel</button>
        <button id="clear-ok" class="danger-btn">Delete everything</button>
      </div>`);
    confirm.querySelector("#clear-cancel")!.addEventListener("click", () => confirm.remove());
    confirm.querySelector("#clear-ok")!.addEventListener("click", () => {
      clearAllData();
      confirm.remove();
      overlay.remove();
    });
  });
}

function confirmImport(
  payload: ReturnType<typeof buildExport>,
  settingsOverlay: HTMLElement,
): void {
  const overlay = openDialog(`
    <h3>Import data?</h3>
    <p class="dialog-text">
      A backup of your current data will be saved first. Replace current data with ${payload.data.tasks.length} task(s), ${payload.data.sessions.length} session(s)?
      Imported settings will also overwrite current settings.
    </p>
    <div class="dialog-actions">
      <button id="import-cancel" class="ghost">Cancel</button>
      <button id="import-ok" class="primary">Replace</button>
    </div>`);

  overlay.querySelector("#import-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#import-ok")!.addEventListener("click", () => {
    saveBackup(settings, state);
    setState(payload.data);
    setSettings(payload.settings);
    persist();
    saveSettings(settings);
    applyTheme(settings.theme);
    resetTransientState();
    settingsOverlay.remove();
    render();
  });
}

/* ------------------------------------------------------------------ */
/* Example data (0069/0070)                                            */
/* ------------------------------------------------------------------ */

/** 0069: load the bundled sample export through the standard import path. */
export async function loadExampleData(): Promise<void> {
  let text: string;
  try {
    const res = await fetch("examples/typical-2-months.json");
    if (!res.ok) throw new Error("fetch failed");
    text = await res.text();
  } catch {
    showMessage(
      "Couldn't load examples",
      "Example data couldn't be loaded. Add a task to get started — the box above understands plain language.",
    );
    return;
  }
  const result = parseImport(text);
  if (!result.ok) {
    showImportError(result.error);
    return;
  }
  const overlay = openDialog(`
    <h3>Load example data?</h3>
    <p class="dialog-text">This replaces your current data with a realistic sample (${result.payload.data.tasks.length} tasks, ${result.payload.data.sessions.length} sessions) so you can explore UltradianDrift right away. A backup of your current data is saved first.</p>
    <div class="dialog-actions">
      <button id="ex-cancel" class="ghost">Cancel</button>
      <button id="ex-ok" class="primary">Load</button>
    </div>`);
  overlay.querySelector("#ex-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#ex-ok")!.addEventListener("click", () => {
    saveBackup(settings, state);
    setState(result.payload.data);
    setSettings(result.payload.settings);
    persist();
    saveSettings(settings);
    applyTheme(settings.theme);
    resetTransientState();
    overlay.remove();
    render();
  });
}

/* ------------------------------------------------------------------ */
/* CSV import (0048)                                                   */
/* ------------------------------------------------------------------ */

function openCsvImport(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result ?? ""));
      const { tasks, skipped } = parseCsvTasks(rows);
      if (!tasks.length) {
        showImportError(
          "No tasks could be parsed from this CSV. Expect a column named 'title' or 'content'.",
        );
        return;
      }
      const preview = tasks
        .slice(0, 10)
        .map(
          (t) =>
            `<li class="csv-preview-row"><span class="task-title">${escapeHtml(t.title)}</span>${t.done ? '<span class="csv-done">done</span>' : ""}</li>`,
        )
        .join("");
      const more =
        tasks.length > 10
          ? `<li class="csv-preview-row csv-more">… and ${tasks.length - 10} more</li>`
          : "";
      const overlay = openDialog(`
        <h3>Import ${tasks.length} task(s) from CSV?</h3>
        ${skipped ? `<p class="dialog-text">${skipped} row(s) skipped (empty or unrecognized).</p>` : ""}
        <ul class="csv-preview">${preview}${more}</ul>
        <div class="dialog-actions">
          <button id="csv-cancel" class="ghost">Cancel</button>
          <button id="csv-ok" class="primary">Import</button>
        </div>`);
      overlay.querySelector("#csv-cancel")!.addEventListener("click", () => overlay.remove());
      overlay.querySelector("#csv-ok")!.addEventListener("click", () => {
        for (const t of tasks) {
          state.tasks.push({
            id: newId(),
            title: t.title,
            priority: t.priority,
            quadrant: t.quadrant,
            done: t.done,
            createdAt: Date.now(),
            doneAt: t.done ? Date.now() : null,
            estimatedMin: t.estimatedMin,
            quick: false,
            tags: t.tags,
            description: "",
            plannedFor: null,
            recurrence: null,
            order: nextManualOrder(),
            completions: [],
          });
        }
        persist();
        overlay.remove();
        render();
      });
    };
    reader.readAsText(file);
  });
  input.click();
}

function resetTransientState(): void {
  setSubView(null);
  setFocusMode(false);
  setResumeHintVisible(true);
  setDescriptionHintVisible(true);
  setBreakState(null);
  setQuickRun(null);
  setLastWatch(null);
  setLastFinished(null);
  setOpenMenuTaskId(null);
  for (const key of Object.keys(SECTION_DEFAULTS) as SectionKey[]) {
    setSectionOpen(key, SECTION_DEFAULTS[key]);
  }
  setHiddenAt(null);
  setHiddenSessionId(null);
  stopRepaint();
}

function clearAllData(): void {
  saveBackup(settings, state);
  setState(emptyState());
  resetTransientState();
  persist();
  if ("caches" in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
  render();
}

function buildMarkdownHistory(): string {
  const lines: string[] = ["# UltradianDrift history", ""];
  const sessions = doneSessions(state);
  if (!sessions.length) {
    lines.push("No finished sessions yet.");
    return lines.join("\n");
  }
  const byTask = new Map<string, Session[]>();
  for (const s of sessions) {
    const arr = byTask.get(s.taskId) ?? [];
    arr.push(s);
    byTask.set(s.taskId, arr);
  }
  for (const [taskId, list] of byTask) {
    const task = taskById(taskId);
    lines.push(`## ${task?.title ?? "(deleted task)"}`, "");
    for (const s of list) {
      const date = new Date(s.endedAt ?? s.startedAt).toLocaleDateString();
      const work = sessionWorkMs(s, settings);
      const pomo =
        s.technique === "pomodoro" && s.completedPomodoros > 0
          ? `, ${s.completedPomodoros} pomodoro(s)`
          : "";
      lines.push(`- ${date} — ${techniqueLabel(s.technique)} — ${formatDuration(work)}${pomo}`);
    }
    const totals = taskTotals(taskId, state.sessions, settings);
    lines.push(
      "",
      `Total: ${formatDuration(totals.workMs)} across ${totals.sessionCount} session(s)`,
      "",
    );
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function startSession(taskId: string, technique: Technique): void {
  const now = Date.now();
  const config = timerConfig();
  const session: Session = {
    id: newId(),
    taskId,
    technique,
    plannedMs: technique === "pomodoro" ? config.pomodoroWorkMs : 0,
    startedAt: now,
    pausedAt: null,
    accumulatedPauseMs: 0,
    completedPomodoros: 0,
    endedAt: null,
    status: "running",
  };
  state.sessions.push(session);
  state.activeSessionId = session.id;
  setLastWatch(null);
  setFocusMode(false);
  setResumeHintVisible(true);
  setDescriptionHintVisible(true);
  setLastFinished(null);
  setHiddenAt(null);
  setHiddenSessionId(null);
  persist();
  startRepaint();
  render();
}

function promptStartSession(taskId: string): void {
  const task = taskById(taskId);
  if (!task) return;
  const workLabel = `${settings.pomodoroWorkMin} min`;

  const overlay = openDialog(`
    <h3>Start a session</h3>
    <p class="dialog-task">${escapeHtml(task.title)}</p>
    <button class="primary" data-tech="flowtime">Flowtime · open</button>
    <button class="primary" data-tech="pomodoro">Pomodoro · ${workLabel}</button>
    <button class="ghost" data-tech="learn">What's the difference?</button>
    <button class="ghost" data-tech="cancel">Cancel</button>`);

  overlay.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("[data-tech]") as HTMLElement | null;
    if (!target) return;
    const tech = target.dataset.tech as Technique | "cancel" | "learn";
    if (tech === "learn") {
      openFlowtimeExplain();
      return;
    }
    overlay.remove();
    if (tech === "cancel") return;
    startSession(taskId, tech);
  });
}

/* ------------------------------------------------------------------ */
/* Switch the session's task mid-run (0084)                            */
/* ------------------------------------------------------------------ */

/** 0084: pick a different task for the running session without breaking it. */
function openSwitchTaskPicker(session: Session): void {
  const overlay = openDialog(`
    <h3>Switch task</h3>
    <p class="dialog-text">Keep the clock running — pick what you're working on now.</p>
    <input id="switch-search" type="text" placeholder="Search tasks…" autocomplete="off" aria-label="Search tasks" />
    <div id="switch-list" class="switch-list">
      <p class="switch-empty">No matching open tasks — create one below.</p>
    </div>
    <div class="switch-create">
      <input id="switch-new" type="text" placeholder="Or create a new task… #tag !1" autocomplete="off" aria-label="Create a new task and switch to it" />
      <button id="switch-new-add" class="ghost">Create &amp; switch</button>
    </div>
    <div class="dialog-actions">
      <button id="switch-cancel" class="ghost">Cancel</button>
    </div>`);

  const search = overlay.querySelector<HTMLInputElement>("#switch-search")!;
  const list = overlay.querySelector<HTMLDivElement>("#switch-list")!;
  const newInput = overlay.querySelector<HTMLInputElement>("#switch-new")!;

  const matches = (t: Task, q: string): boolean =>
    !q || t.title.toLowerCase().includes(q) || t.tags.some((tag) => tag.includes(q));

  const itemHtml = (t: Task): string =>
    `<button type="button" class="switch-item${t.done ? " done" : ""}" data-switch="${t.id}">
      <span class="switch-item-title">${escapeHtml(t.title)}</span>
      <span class="switch-item-meta">P${t.priority}${t.done ? " · done" : ""}</span>
    </button>`;

  const renderList = (): void => {
    const q = search.value.trim().toLowerCase();
    const open = state.tasks
      .filter((t) => !t.done && t.id !== session.taskId && matches(t, q))
      .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    const done = state.tasks
      .filter((t) => t.done && matches(t, q))
      .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
      .slice(0, 20);
    const doneHtml = done.length
      ? `<div class="switch-group-title">Completed</div>${done.map(itemHtml).join("")}`
      : "";
    list.innerHTML = open.length
      ? `${open.map(itemHtml).join("")}${doneHtml}`
      : done.length
        ? doneHtml
        : `<p class="switch-empty">No matching tasks — create one below.</p>`;
  };

  renderList();
  search.addEventListener("input", renderList);
  search.focus();

  list.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-switch]");
    if (!btn?.dataset.switch) return;
    overlay.remove();
    switchSessionTask(session, btn.dataset.switch);
  });

  const createAndSwitch = (): void => {
    const raw = newInput.value.trim();
    if (!raw) return;
    // buildAndAddTask re-renders the board, which also tears down this dialog;
    // onCreated then attaches the new task to the still-running session.
    buildAndAddTask(raw, { priority: 2, quadrant: "q2", quick: false }, (task) => {
      switchSessionTask(session, task.id);
    });
  };
  overlay.querySelector("#switch-new-add")!.addEventListener("click", createAndSwitch);
  newInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      createAndSwitch();
    }
  });
  overlay.querySelector("#switch-cancel")!.addEventListener("click", () => overlay.remove());
}

/**
 * 0084: re-point the session at another task. The timer state (startedAt, pause
 * state, pomodoro phase) is left untouched, so the clock carries on seamlessly.
 */
export function switchSessionTask(session: Session, taskId: string): void {
  const task = taskById(taskId);
  if (!task || task.id === session.taskId) return;
  if (task.done) {
    const overlay = openDialog(`
      <h3>Switch to a completed task?</h3>
      <p class="dialog-text">"${escapeHtml(task.title)}" is already marked done. Work on it again in this session?</p>
      <div class="dialog-actions">
        <button id="switch-done-cancel" class="ghost">Cancel</button>
        <button id="switch-done-ok" class="primary">Switch</button>
      </div>`);
    overlay.querySelector("#switch-done-cancel")!.addEventListener("click", () => overlay.remove());
    overlay.querySelector("#switch-done-ok")!.addEventListener("click", () => {
      overlay.remove();
      applySessionTask(session, task);
    });
    return;
  }
  applySessionTask(session, task);
}

function applySessionTask(session: Session, task: Task): void {
  session.taskId = task.id;
  setResumeHintVisible(true);
  setDescriptionHintVisible(true);
  persist();
  render();
  showSwitchToast(task);
  announce(`Now working on ${task.title}`);
}

function showSwitchToast(task: Task): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span class="toast-text"><strong>Now working on</strong> · ${escapeHtml(task.title)}</span>`;
  toastRegion().appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

/** 0077: explainer for the Flowtime vs Pomodoro technique chooser. */
function openFlowtimeExplain(): void {
  const overlay = openDialog(`
    <h3>Flowtime vs Pomodoro</h3>
    <div class="about">
      <h4>Your natural rhythm</h4>
      <p>Attention arrives in <strong>~90-minute ultradian waves</strong>: you're genuinely sharp,
      then your energy dips and you need rest. UltradianDrift works <em>with</em> this rhythm
      instead of against it.</p>
      <h4>Flowtime</h4>
      <p>A <strong>count-up</strong> session: start when you're ready, keep going while you're in
      flow, and finish when your energy dips. No interrupting bell.</p>
      <h4>Pomodoro</h4>
      <p><strong>Fixed work/break blocks</strong> (e.g. ${settings.pomodoroWorkMin} + ${settings.pomodoroShortBreakMin} minutes): a forcing
      function that's great when you're procrastinating and need external structure.</p>
      <p class="dialog-text"><em>Not sure? Start with Flowtime — you can switch to Pomodoro any time.</em></p>
    </div>
    <div class="dialog-actions">
      <button id="explain-ok" class="primary">Got it</button>
    </div>`);
  overlay.querySelector("#explain-ok")!.addEventListener("click", () => overlay.remove());
}

/** 0078: short practical guide shown during a break. */
function openRestGuide(): void {
  const overlay = openDialog(`
    <h3>How to actually rest</h3>
    <div class="about">
      <p>A break only recharges you if you <strong>actually rest</strong>. Scrolling a phone keeps
      the brain active and defeats the recovery that makes your next ~90-minute focus wave sharp.
      Pick something that shifts your body into rest mode:</p>
      <h4>Move</h4>
      <p>Walk, stretch, step outside; shake off seated tension.</p>
      <h4>Eyes</h4>
      <p>Look at something 20+ feet away for 20 seconds; reduce screen time.</p>
      <h4>Breathe</h4>
      <p>A few slow, deep breaths (e.g. 4-7-8) to shift into rest mode.</p>
      <h4>Fuel</h4>
      <p>Water and a light snack; skip the sugar spike.</p>
      <h4>Unplug</h4>
      <p>No screens: daydream, listen to music, chat, or take a tiny nap.</p>
      <h4>Nature</h4>
      <p>A plant or window view lowers stress markers quickly.</p>
    </div>
    <div class="dialog-actions">
      <button id="rest-guide-ok" class="primary">Got it</button>
    </div>`);
  overlay.querySelector("#rest-guide-ok")!.addEventListener("click", () => overlay.remove());
}

/** 0081: log a distraction from the inline session field (no dialog). */
export function logDistraction(): void {
  const input = document.querySelector<HTMLInputElement>("#distraction-text");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const session = activeSession();
  state.distractions.push({
    id: newId(),
    text,
    createdAt: Date.now(),
    taskId: session?.taskId ?? null,
  });
  persist();
  render();
  const confirmEl = document.getElementById("distraction-confirm");
  if (confirmEl) {
    confirmEl.textContent = "Logged — parked for later";
    confirmEl.classList.add("visible");
    window.setTimeout(() => confirmEl.classList.remove("visible"), 2200);
  }
  announce("Distraction logged");
}

/** 0081: clear the distraction log from the History view. */
function clearDistractions(): void {
  state.distractions = [];
  persist();
  render();
  announce("Distraction log cleared");
}

export function pauseSession(session: Session): void {
  if (session.status !== "running") return;
  session.pausedAt = Date.now();
  session.status = "paused";
  setHiddenAt(null);
  setHiddenSessionId(null);
  persist();
  render();
}

export function resumeSession(session: Session): void {
  if (session.status !== "paused" || session.pausedAt === null) return;
  session.accumulatedPauseMs += Date.now() - session.pausedAt;
  session.pausedAt = null;
  session.status = "running";
  persist();
  render();
}

/** Abort a running/paused session without recording it as finished work. */
export function cancelSession(session: Session): void {
  const id = session.id;
  state.sessions = state.sessions.filter((s) => s.id !== id);
  state.activeSessionId = null;
  setLastWatch(null);
  setFocusMode(false);
  setHiddenAt(null);
  setHiddenSessionId(null);
  persist();
  stopRepaint();
  render();
  announce("Session cancelled");
  showUndoToast("Session cancelled", () => {
    state.sessions.push(session);
    state.activeSessionId = session.id;
    if (session.status === "running") startRepaint();
    persist();
    render();
  });
}

export function beginFocusFromBreak(): void {
  if (!breakState) return;
  const { taskId, technique } = breakState;
  setBreakState(null);
  startSession(taskId, technique);
}

function skipBreak(): void {
  setBreakState(null);
  stopRepaint();
  render();
}

/* ------------------------------------------------------------------ */
/* Quick run (0018)                                                    */
/* ------------------------------------------------------------------ */

function nextQuickTask(excludeId: string): Task | null {
  return (
    state.tasks
      .filter((t) => t.quick && !t.done && !isFutureOpen(t) && t.id !== excludeId)
      .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)[0] ?? null
  );
}

function startQuickRun(taskId: string): void {
  setQuickRun({ startedAt: Date.now(), lastAdvance: Date.now(), taskId });
  setFocusMode(false);
  setLastFinished(null);
  startRepaint();
  render();
}

function recordQuickSession(task: Task, startedAt: number, endedAt: number): Session {
  const session: Session = {
    id: newId(),
    taskId: task.id,
    technique: "flowtime",
    plannedMs: 0,
    startedAt,
    pausedAt: null,
    accumulatedPauseMs: 0,
    completedPomodoros: 0,
    endedAt,
    status: "done",
  };
  state.sessions.push(session);
  return session;
}

function closeCurrentQuick(now: number): Session | null {
  const task = taskById(quickRun!.taskId);
  if (!task) return null;
  task.done = true;
  task.doneAt = now;
  return recordQuickSession(task, quickRun!.lastAdvance, now);
}

function endQuickRun(now: number, finalSession: Session, finalTask: Task): void {
  setQuickRun(null);
  stopRepaint();
  persist();
  if (settings.soundEnabled) playCue("finish", settings.soundPreset);
  setLastFinished({
    session: finalSession,
    status: "done",
    endedAt: now,
    activeId: null,
    completedPomodoros: 0,
    newlyCreated: true,
    taskId: finalTask.id,
    prevDone: false,
  });
  render();
  showFinishToast(finalSession, "Quick run finished.");
  window.setTimeout(() => {
    if (lastFinished?.session.id === finalSession.id) setLastFinished(null);
  }, 4000);
}

function advanceQuick(): void {
  const run = quickRun;
  if (!run) return;
  const now = Date.now();
  const closed = closeCurrentQuick(now);
  const next = nextQuickTask(run.taskId);
  if (!next) {
    if (closed) {
      const task = taskById(closed.taskId);
      if (task) {
        endQuickRun(now, closed, task);
        return;
      }
    }
    setQuickRun(null);
    stopRepaint();
    persist();
    render();
    return;
  }
  run.taskId = next.id;
  run.lastAdvance = now;
  persist();
  render();
  // 0074: a mis-tap on "Close & next" reopens the task it just closed.
  if (closed) {
    showUndoToast("Quick task reopened", () => {
      const t = taskById(closed.taskId);
      if (t) {
        t.done = false;
        t.doneAt = null;
      }
      state.sessions = state.sessions.filter((s) => s.id !== closed.id);
      persist();
      render();
    });
  }
}

export function finishQuick(): void {
  const now = Date.now();
  const closed = closeCurrentQuick(now);
  if (!closed) {
    setQuickRun(null);
    stopRepaint();
    persist();
    render();
    return;
  }
  const task = taskById(closed.taskId);
  if (!task) {
    setQuickRun(null);
    stopRepaint();
    persist();
    render();
    return;
  }
  endQuickRun(now, closed, task);
}

/* ------------------------------------------------------------------ */
/* Finish + undo                                                       */
/* ------------------------------------------------------------------ */

export function finishSession(session: Session): void {
  const now = Date.now();
  const config = timerConfig();
  const snap = snapshot(session, config, now);

  const record = {
    session,
    status: session.status,
    endedAt: session.endedAt,
    activeId: state.activeSessionId,
    completedPomodoros: session.completedPomodoros,
    newlyCreated: false,
  };

  if (session.technique === "pomodoro") {
    session.completedPomodoros = snap.completedPomodoros;
  }
  const workMs = sessionWorkMs(session, settings, now);
  const flowBreakMs =
    session.technique === "flowtime" ? Math.round(workMs * settings.flowtimeBreakRatio) : 0;

  let breakMs = 0;
  if (session.technique === "pomodoro") {
    const n = session.completedPomodoros;
    breakMs =
      n > 0 && n % settings.pomodoroLongBreakEvery === 0
        ? settings.pomodoroLongBreakMin * MIN
        : settings.pomodoroShortBreakMin * MIN;
  } else {
    breakMs = flowBreakMs;
  }

  session.status = "done";
  session.endedAt = now;
  state.activeSessionId = null;
  setLastWatch(null);
  setFocusMode(false);
  setHiddenAt(null);
  setHiddenSessionId(null);
  persist();
  stopRepaint();
  if (settings.soundEnabled) playCue("finish", settings.soundPreset);
  if (settings.notificationsEnabled) {
    const task = taskById(session.taskId);
    notify("Session finished", task ? task.title : "Session complete");
  }

  setLastFinished(record);
  if (settings.autoBreak && breakMs > 0) {
    setBreakState({
      startedAt: now,
      endsAt: now + breakMs,
      taskId: session.taskId,
      technique: session.technique,
      done: false,
    });
    startRepaint();
  }
  render();

  let line: string;
  if (session.technique === "pomodoro") {
    line = `${session.completedPomodoros} pomodoro(s) · ${formatDuration(workMs)} of focus.`;
  } else {
    line = `${formatDuration(workMs)} of flowtime.`;
    if (flowBreakMs > 0) line += ` Suggested break: ~${formatDuration(flowBreakMs)}.`;
  }
  announce(`Session finished. ${line}`);
  showFinishToast(session, line);
  window.setTimeout(() => {
    if (lastFinished?.session.id === session.id) setLastFinished(null);
  }, 4000);
}

function undoFinish(): void {
  const record = lastFinished;
  if (!record) return;
  setLastFinished(null);
  setBreakState(null);

  if (record.newlyCreated) {
    state.sessions = state.sessions.filter((s) => s.id !== record.session.id);
    if (record.taskId) {
      const t = taskById(record.taskId);
      if (t) {
        t.done = record.prevDone ?? false;
        t.doneAt = record.prevDone ? t.doneAt : null;
      }
    }
    persist();
    stopRepaint();
    render();
    return;
  }

  const s = record.session;
  s.status = record.status;
  s.endedAt = record.endedAt;
  s.completedPomodoros = record.completedPomodoros;
  state.activeSessionId = record.activeId;
  setFocusMode(false);
  persist();
  if (record.activeId && record.status !== "done") startRepaint();
  render();
}

/** 0072: best-effort suggestion for what to focus on next after finishing a session. */
function nextOpenTask(excludeId: string): Task | null {
  const planned = state.tasks
    .filter((t) => !t.done && t.id !== excludeId && isTodayOpen(t))
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  if (planned.length) return planned[0];
  const open = state.tasks
    .filter((t) => !t.done && t.id !== excludeId)
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  return open[0] ?? null;
}

function showFinishToast(session: Session, line: string): void {
  const task = taskById(session.taskId);
  const next = nextOpenTask(session.taskId);
  const nextHtml = next
    ? `<button class="toast-link" data-next="${next.id}" title="Start a session">Next: ${escapeHtml(next.title)}</button>`
    : "";
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span class="toast-text"><strong>Finished</strong> · ${escapeHtml(task?.title ?? "task")} · ${escapeHtml(line)}</span>
    ${nextHtml}
    <button id="undo-finish" class="primary">Undo</button>`;
  toastRegion().appendChild(toast);

  const dismiss = (): void => {
    if (lastFinished?.session.id === session.id) setLastFinished(null);
    toast.remove();
  };
  toast.querySelector("#undo-finish")!.addEventListener("click", (e) => {
    e.stopPropagation();
    undoFinish();
    dismiss();
  });
  toast.querySelector("[data-next]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
    if (next) promptStartSession(next.id);
  });
  window.setTimeout(dismiss, 4000);
}

/* ------------------------------------------------------------------ */
/* Notes management (0032)                                             */
/* ------------------------------------------------------------------ */

function editNote(noteId: string): void {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return;
  const overlay = openDialog(`
    <h3>Edit note</h3>
    <form id="note-edit-form">
      <textarea id="note-edit-text" rows="4">${escapeHtml(note.text)}</textarea>
      <div class="dialog-actions">
        <button type="button" id="note-edit-cancel" class="ghost">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>`);
  overlay.querySelector("#note-edit-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector<HTMLFormElement>("#note-edit-form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    note.text = overlay.querySelector<HTMLTextAreaElement>("#note-edit-text")!.value;
    persist();
    overlay.remove();
    render();
  });
}

function deleteNote(noteId: string): void {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return;
  const index = state.notes.findIndex((n) => n.id === noteId);
  state.notes = state.notes.filter((n) => n.id !== noteId);
  persist();
  render();
  showUndoToast("Note deleted", () => {
    state.notes.splice(Math.min(index, state.notes.length), 0, note);
    persist();
    render();
  });
}

export function addNote(sessionId: string, text: string): void {
  if (!text.trim()) return;
  state.notes.push({
    id: newId(),
    sessionId,
    text: text.trim(),
    createdAt: Date.now(),
  });
  persist();
}

/* ------------------------------------------------------------------ */
/* Idle nudge (0035)                                                   */
/* ------------------------------------------------------------------ */

export function showIdleToast(session: Session): void {
  const task = taskById(session.taskId);
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span class="toast-text"><strong>Session still running</strong> · ${escapeHtml(task?.title ?? "task")}</span>
    <button id="idle-pause" class="ghost">Pause</button>
    <button id="idle-finish" class="primary">Finish</button>`;
  toastRegion().appendChild(toast);

  const dismiss = (): void => toast.remove();
  toast.querySelector("#idle-pause")!.addEventListener("click", (e) => {
    e.stopPropagation();
    pauseSession(session);
    dismiss();
  });
  toast.querySelector("#idle-finish")!.addEventListener("click", (e) => {
    e.stopPropagation();
    finishSession(session);
    dismiss();
  });
  window.setTimeout(dismiss, 8000);
}

/* ------------------------------------------------------------------ */
/* Flowtime gentle reminder (0054)                                     */
/* ------------------------------------------------------------------ */

export function showFlowtimeNudge(session: Session, minutes: number): void {
  const task = taskById(session.taskId);
  const message = `You've been at this for ${minutes} minutes — it's okay to stop.`;
  if (settings.soundEnabled) playCue("finish", settings.soundPreset);
  if (settings.notificationsEnabled) {
    notify("Flowtime reminder", task ? `${message} · ${task.title}` : message);
  }
  announce(`Flowtime reminder. ${message}`);

  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span class="toast-text"><strong>Flowtime reminder</strong> · ${escapeHtml(message)}</span>
    <button id="nudge-finish" class="primary">Finish</button>
    <button id="nudge-keep" class="ghost">Keep going</button>`;
  toastRegion().appendChild(toast);
  const dismiss = (): void => toast.remove();
  toast.querySelector("#nudge-finish")!.addEventListener("click", (e) => {
    e.stopPropagation();
    finishSession(session);
    dismiss();
  });
  toast.querySelector("#nudge-keep")!.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });
  window.setTimeout(dismiss, 8000);
}

/* ------------------------------------------------------------------ */
/* Dispatcher for `data-action` clicks                                 */
/* ------------------------------------------------------------------ */

export function handleAction(
  action: string | undefined,
  id: string | undefined,
  dir?: string,
  section?: string,
): void {
  const session = activeSession();

  switch (action) {
    case "toggle":
      if (id) toggleTask(id);
      break;
    case "toggle-quick":
      if (id) toggleQuick(id);
      break;
    case "cycle-quadrant":
      if (id) cycleQuadrant(id);
      break;
    case "cycle-priority":
      if (id) cyclePriority(id);
      break;
    case "today":
      if (id) toggleToday(id);
      break;
    case "defer":
      if (id) openDeferDialog(id);
      break;
    case "repeats":
      if (id) openRecurrenceDialog(id);
      break;
    case "delete":
      if (id) confirmDeleteTask(id);
      break;
    case "delete-session":
      if (id) confirmDeleteSession(id);
      break;
    case "edit-note":
      if (id) editNote(id);
      break;
    case "delete-note":
      if (id) deleteNote(id);
      break;
    case "move-task":
      if (id && (dir === "up" || dir === "down")) {
        moveTask(id, dir);
        positionRowMenu();
      }
      break;
    case "open-menu":
      if (id) {
        setOpenMenuTaskId(openMenuTaskId === id ? null : id);
      }
      render();
      positionRowMenu();
      break;
    case "start":
      if (id) promptStartSession(id);
      break;
    case "switch-task":
      if (session) openSwitchTaskPicker(session);
      break;
    case "mark-done":
      if (id) markDoneAndFinish(id);
      break;
    case "edit":
      if (id) openEditTask(id);
      break;
    case "quick-run":
      if (id) startQuickRun(id);
      break;
    case "quick-next":
      if (quickRun) advanceQuick();
      break;
    case "quick-finish":
      if (quickRun) finishQuick();
      break;
    case "task-history":
      if (id) {
        setSubView({ kind: "taskHistory", taskId: id });
        render();
      }
      break;
    case "view-history":
      setSubView({ kind: "history" });
      render();
      break;
    case "view-dashboard":
      setSubView({ kind: "dashboard" });
      render();
      break;
    case "back-to-board":
      setSubView(null);
      render();
      break;
    case "toggle-theme":
      toggleTheme();
      break;
    case "open-settings":
      openSettings();
      break;
    case "open-about":
      openAboutModal();
      break;
    case "shortcuts":
      openShortcutsCheat();
      break;
    case "focus-add":
      document.querySelector<HTMLInputElement>("#task-title")?.focus();
      break;
    case "start-now":
      markOnboarded();
      render();
      document.querySelector<HTMLInputElement>("#task-title")?.focus();
      break;
    case "dismiss-onboarding":
      markOnboarded();
      render();
      break;
    case "load-examples":
      void loadExampleData();
      break;
    case "clear-filters":
      setSearchQuery("");
      setFilterPriority(null);
      setFilterQuadrant(null);
      render();
      break;
    case "toggle-section":
      if (section) {
        const key = section as SectionKey;
        setSectionOpen(key, !openSections[key]);
        render();
      }
      break;
    case "toggle-focus":
      setFocusMode(!focusMode);
      render();
      break;
    case "dismiss-hint":
      setResumeHintVisible(false);
      render();
      break;
    case "dismiss-desc-hint":
      setDescriptionHintVisible(false);
      render();
      break;
    case "start-next":
      beginFocusFromBreak();
      break;
    case "rest-guide":
      openRestGuide();
      break;
    case "clear-distractions":
      clearDistractions();
      break;
    case "skip-break":
    case "end-break":
      skipBreak();
      break;
    case "pause":
      if (session) pauseSession(session);
      break;
    case "resume":
      if (session) resumeSession(session);
      break;
    case "finish":
      if (session) finishSession(session);
      break;
    case "cancel-session":
      if (session) cancelSession(session);
      break;
  }
}
