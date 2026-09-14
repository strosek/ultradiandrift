import {
  addNote,
  addSessionTask,
  addTask,
  addTaskAndFocus,
  beginFocusFromBreak,
  finishQuick,
  finishSession,
  handleAction,
  logDistraction,
  pauseSession,
  reorderTasks,
  resumeSession,
  setEstimate,
  showIdleToast,
} from "./actions";
import { catchUpHidden } from "./repaint";
import {
  activeSession,
  breakState,
  focusMode,
  hiddenAt,
  hiddenSessionId,
  openMenuTaskId,
  persist,
  quickRun,
  setFilterPriority,
  setFilterQuadrant,
  setFocusMode,
  setHiddenAt,
  setHiddenSessionId,
  setHistoryTab,
  setOpenMenuTaskId,
  setSearchQuery,
  setSortBy,
  searchQuery,
  subView,
} from "./state";
import { MIN } from "./timer";
import type { Quadrant } from "./types";
import { render, updateQuickAddChips } from "./views";

const IDLE_NUDGE_MS = 10 * MIN;

function isEditable(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return !!el.closest("input, textarea, select") || (el as HTMLElement).isContentEditable;
}

function handleShortcut(e: KeyboardEvent): void {
  const key = e.key;

  if (key === "Escape") {
    if (openMenuTaskId !== null) {
      setOpenMenuTaskId(null);
      render();
      return;
    }
    const overlays = document.querySelectorAll(".overlay");
    const top = overlays[overlays.length - 1];
    if (top) {
      top.remove();
      return;
    }
    if (focusMode) {
      setFocusMode(false);
      render();
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur?.();
    return;
  }

  if (isEditable(e.target)) return;

  const session = activeSession();
  if (key === " ") {
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest("button")) return;
    if (session && session.status !== "done") {
      e.preventDefault();
      if (session.status === "running") pauseSession(session);
      else if (session.status === "paused") resumeSession(session);
    }
    return;
  }

  if (key === "/") {
    if (!session && !quickRun && !breakState) {
      e.preventDefault();
      document.querySelector<HTMLInputElement>("#task-search")?.focus();
    }
    return;
  }

  const lower = key.toLowerCase();
  if (lower === "n") {
    if (!session && !subView && !quickRun && !breakState) {
      document.querySelector<HTMLInputElement>("#task-title")?.focus();
    }
    return;
  }
  if (lower === "f") {
    if (breakState) {
      beginFocusFromBreak();
    } else if (quickRun) {
      finishQuick();
    } else if (session && session.status !== "done") {
      finishSession(session);
    }
    return;
  }
  if (lower === "t" || lower === "m" || lower === "g") {
    // 0082/0081: jump straight to a mid-session capture field —
    // T task, M note, G distraction.
    if ((session && session.status !== "done") || quickRun) {
      const id =
        lower === "t" ? "#capture-thought" : lower === "m" ? "#note-text" : "#distraction-text";
      const field = document.querySelector<HTMLInputElement>(id);
      if (field) {
        e.preventDefault();
        field.focus();
      }
    }
    return;
  }

  // 0073: navigation shortcuts and the cheat sheet. Only outside dialogs/views where
  // a session or quick run owns the screen.
  const inView = session || quickRun || breakState;
  if (key === "?") {
    if (!document.querySelector(".overlay")) handleAction("shortcuts", undefined);
    return;
  }
  if (lower === "d" || lower === "h") {
    if (inView || document.querySelector(".overlay")) return;
    e.preventDefault();
    handleAction(lower === "d" ? "view-dashboard" : "view-history", undefined);
    return;
  }
  if (lower === "j" || lower === "k") {
    if (inView || subView || document.querySelector(".overlay")) return;
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".task"));
    if (!rows.length) return;
    e.preventDefault();
    const active = document.activeElement;
    const idx = rows.findIndex((r) => r.contains(active));
    const dir = lower === "j" ? 1 : -1;
    const next = idx < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, idx + dir));
    (rows[next].querySelector<HTMLElement>(".check") ?? rows[next]).focus();
  }
}

document.addEventListener("keydown", handleShortcut);

// Close the ⋯ row menu when clicking outside it (0037).
document.addEventListener("click", (e) => {
  if (openMenuTaskId === null) return;
  const el = e.target as Element;
  if (el.closest("[data-menu]")) return;
  if (el.closest('[data-action="open-menu"]')) return;
  setOpenMenuTaskId(null);
  render();
});

// Idle nudge: remember when the tab went hidden during a running session (0035).
// 0057: on return, recompute any phase/break transitions that happened while throttled.
document.addEventListener("visibilitychange", () => {
  const session = activeSession();
  if (document.hidden) {
    if (session && session.status === "running") {
      setHiddenAt(Date.now());
      setHiddenSessionId(session.id);
    } else {
      setHiddenAt(null);
      setHiddenSessionId(null);
    }
  } else {
    if (hiddenAt != null && hiddenSessionId != null) {
      const s = activeSession();
      if (
        s &&
        s.id === hiddenSessionId &&
        s.status === "running" &&
        Date.now() - hiddenAt >= IDLE_NUDGE_MS
      ) {
        showIdleToast(s);
      }
      setHiddenAt(null);
      setHiddenSessionId(null);
    }
    catchUpHidden();
  }
});

window.addEventListener("focus", catchUpHidden);
window.addEventListener("pageshow", catchUpHidden);

const app = document.querySelector<HTMLDivElement>("#app")!;

app.addEventListener("click", (e) => {
  // 0081: History Sessions / Distractions tabs (these don't carry data-action).
  const historyTabBtn = (e.target as HTMLElement).closest<HTMLElement>("[data-history-tab]");
  if (historyTabBtn) {
    setHistoryTab(historyTabBtn.dataset.historyTab as "sessions" | "distractions");
    render();
    return;
  }

  const target = (e.target as HTMLElement).closest(
    "[data-action], #add-task, #add-and-focus",
  ) as HTMLElement | null;
  if (!target) return;

  if (target.id === "add-task") {
    addTask();
    return;
  }

  if (target.id === "add-and-focus") {
    addTaskAndFocus();
    return;
  }

  // 0060: keep the menu open so a task can be moved more than once in a row.
  if (target.closest("[data-menu]") && target.dataset.action !== "move-task") {
    setOpenMenuTaskId(null);
  }

  handleAction(target.dataset.action, target.dataset.id, target.dataset.dir, target.dataset.section);
});

app.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset?.search !== undefined) {
    setSearchQuery(input.value);
    render();
    const el = document.querySelector<HTMLInputElement>("#task-search");
    if (el) {
      el.focus();
      el.setSelectionRange(searchQuery.length, searchQuery.length);
    }
    return;
  }
  // 0071: debounced live feedback for the natural-language quick-add parser.
  if (input.id === "task-title") {
    window.clearTimeout(addChipsTimer);
    addChipsTimer = window.setTimeout(() => updateQuickAddChips(input.value), 150);
  }
});

let addChipsTimer: number | undefined;

app.addEventListener("change", (e) => {
  const target = e.target as HTMLElement;

  if (target.dataset?.estimate) {
    setEstimate(target.dataset.estimate, (target as HTMLInputElement).value);
    return;
  }
  if (target.dataset?.filterPriority !== undefined) {
    const raw = (target as HTMLSelectElement).value;
    setFilterPriority(raw === "" ? null : Number(raw));
    render();
    return;
  }
  if (target.dataset?.filterQuadrant !== undefined) {
    const raw = (target as HTMLSelectElement).value;
    setFilterQuadrant((raw === "" ? null : raw) as Quadrant | null);
    render();
    return;
  }
  if (target.dataset?.sort !== undefined) {
    const raw = (target as HTMLSelectElement).value;
    setSortBy(
      (raw === "type" || raw === "newest" || raw === "manual" ? raw : "priority") as
        "priority" | "type" | "newest" | "manual",
    );
    render();
  }
});

app.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id === "note-form") {
    e.preventDefault();
    const session = activeSession();
    const text = form.querySelector<HTMLInputElement>("#note-text")?.value ?? "";
    if (session) {
      addNote(session.id, text);
      persist();
      render();
    }
  }
  if (form.id === "capture-form") {
    e.preventDefault();
    addSessionTask();
  }
  if (form.id === "distraction-form") {
    e.preventDefault();
    logDistraction();
  }
});

app.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target as HTMLElement).id === "task-title") {
    addTask();
  }
});

// Manual reordering via the grip handle (0048).
let dragId: string | null = null;

app.addEventListener("dragstart", (e) => {
  const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-grip]");
  if (!handle) return;
  const li = handle.closest<HTMLElement>(".task");
  dragId = li?.dataset.id ?? null;
  if (!dragId) return;
  e.dataTransfer?.setData("text/plain", dragId);
  e.dataTransfer!.effectAllowed = "move";
  li!.classList.add("dragging");
});

app.addEventListener("dragover", (e) => {
  if (!dragId) return;
  const li = (e.target as HTMLElement).closest<HTMLElement>(".task");
  if (!li || li.dataset.id === dragId) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = "move";
  li.classList.add("drop-target");
});

app.addEventListener("dragleave", (e) => {
  (e.target as HTMLElement).closest<HTMLElement>(".task")?.classList.remove("drop-target");
});

app.addEventListener("drop", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>(".task");
  if (!li || !dragId || li.dataset.id === dragId) return;
  e.preventDefault();
  reorderTasks(dragId, li.dataset.id ?? "");
});

app.addEventListener("dragend", () => {
  dragId = null;
  document.querySelectorAll(".task.dragging, .task.drop-target").forEach((el) => {
    el.classList.remove("dragging", "drop-target");
  });
});
