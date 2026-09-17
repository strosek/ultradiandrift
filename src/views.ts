import {
  activeSession,
  breakState,
  descriptionHintVisible,
  filterPriority,
  filterQuadrant,
  focusMode,
  historyTab,
  notesFor,
  openMenuTaskId,
  openSections,
  quickRun,
  resumeHintVisible,
  searchQuery,
  settings,
  sortBy,
  state,
  subView,
  taskById,
  timerConfig,
} from "./state";
import { formatDay, formatTimeOfDay, startOfLocalDay, startOfWeek } from "./dates";
import { escapeHtml } from "./escape";
import { icon } from "./icons";
import { parseQuickAdd } from "./parse";
import { isOnboarded } from "./storage";
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
  weekDayCount,
  weekTotals,
} from "./stats";
import {
  formatDuration,
  formatElapsed,
  formatMs,
  phaseLabel,
  phaseMs,
  snapshot,
  techniqueLabel,
} from "./timer";
import { isFutureOpen, isOverdueOpen, isTodayOpen } from "./tasks";
import type { SectionKey } from "./state";
import type { Quadrant, Recurrence, Session, Task } from "./types";
import { QUADRANT_LABEL } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

/** Subtle donation link shown in the footer. */
function koFiHtml(): string {
  return `<a class="ko-fi" href="https://ko-fi.com/edcorona" target="_blank" rel="noopener noreferrer" title="Support UltradianDrift on Ko-fi">☕ Support on Ko-fi</a>`;
}

/** Keep the browser tab title useful during a session (countdown / elapsed). */
export function updateDocumentTitle(clockText: string | null): void {
  document.title = clockText ? `${clockText} · UltradianDrift` : "UltradianDrift";
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** 0066: view key for the last render; only a change triggers the entrance animation. */
let lastViewKey: string | null = null;

/** 0005: subtle night/day toggle pinned to the top-right corner in every view. */
function themeToggleHtml(): string {
  const isNight = settings.theme === "night";
  const label = isNight ? "Switch to day mode" : "Switch to night mode";
  return `<button class="corner-toggle" data-action="toggle-theme" title="${label}" aria-label="${label}" aria-pressed="${isNight ? "true" : "false"}">${icon(isNight ? "sun" : "moon")}</button>`;
}

/** Focus-mode toggle, shown left of the theme toggle while a session runs. */
function focusToggleHtml(): string {
  const session = activeSession();
  if (!session || session.status === "done") return "";
  const label = focusMode ? "Exit focus mode" : "Enter focus mode";
  return `<button class="corner-toggle focus-toggle ${focusMode ? "on" : ""}" data-action="toggle-focus" title="${label}" aria-label="${label}" aria-pressed="${focusMode ? "true" : "false"}">${icon("target")}</button>`;
}

/** 0084: change which task the running session is attached to. */
function switchTaskButtonHtml(): string {
  return `<button class="switch-task-btn" data-action="switch-task" title="Switch to another task" aria-label="Switch to another task">${icon("repeat")} Switch task</button>`;
}

/** Replace the app root, gently animating the view in on first mount (0066). */
function renderView(key: string, html: string): void {
  const changed = lastViewKey !== key;
  lastViewKey = key;
  // The theme toggle is rendered on every view so it's always available, even
  // during a focus session, break, or quick run. The focus toggle joins it
  // while a session is running.
  app.innerHTML = `${html}<div class="corner-toggles">${focusToggleHtml()}${themeToggleHtml()}</div>`;
  if (changed) {
    for (const child of Array.from(app.children)) {
      child.classList.add("view-enter");
    }
  }
}

/** 0064: circumference of the progress ring (r=54 in the 120 viewBox). */
export const RING_C = 2 * Math.PI * 54;

/** 0064: update the ring's remaining fraction (1 = full, 0 = empty). */
export function updateClockRing(fraction: number): void {
  const ring = document.querySelector<SVGCircleElement>("[data-ring]");
  if (!ring) return;
  const frac = Math.max(0, Math.min(1, fraction));
  ring.style.strokeDashoffset = String(RING_C * (1 - frac));
}

/** 0064: clock wrapped in an optional progress ring and/or breathing pulse. */
function clockFrameHtml(
  text: string,
  opts: { ringFrac?: number | null; pulse?: boolean; strong?: boolean; frameClass?: string } = {},
): string {
  const { ringFrac, pulse, strong, frameClass } = opts;
  const cls = ["clock-frame", frameClass ?? "", pulse ? "pulse" : "", strong ? "pulse-strong" : ""]
    .filter(Boolean)
    .join(" ");
  const ring =
    ringFrac != null
      ? `<svg class="clock-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-bg" cx="60" cy="60" r="54" />
          <circle class="ring-fg" data-ring cx="60" cy="60" r="54" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C * (1 - Math.max(0, Math.min(1, ringFrac)))}" />
        </svg>`
      : "";
  return `<div class="${cls}">${ring}<div class="clock">${text}</div></div>`;
}

/** 0069: friendly empty-state block with an icon, copy, and an optional action. */
function emptyStateHtml(iconName: string, title: string, text: string, cta = ""): string {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon(iconName)}</div>
      <p class="empty-title">${escapeHtml(title)}</p>
      <p class="empty-text">${escapeHtml(text)}</p>
      ${cta}
    </div>`;
}

/** 0071: live chips under the add-task input showing what the parser understood. */
function parseChipsFromTitle(raw: string): string[] {
  return Array.from(raw.matchAll(/#([\p{L}\p{N}_-]+)/gu), (m) => m[1].toLowerCase());
}

export function updateQuickAddChips(raw: string): void {
  const el = document.getElementById("add-parse-feedback");
  if (!el) return;
  const trimmed = raw.trim();
  if (!trimmed) {
    el.innerHTML = "";
    return;
  }
  const parsed = parseQuickAdd(trimmed);
  const chips: string[] = [];
  for (const tag of parseChipsFromTitle(trimmed)) chips.push(`#${escapeHtml(tag)}`);
  if (parsed.priority != null) chips.push(`P${parsed.priority}`);
  if (parsed.dueDay != null) {
    const label =
      parsed.dueDay === 0
        ? "today"
        : parsed.dueDay === 1
          ? "tomorrow"
          : (WEEKDAY_NAMES[parsed.dueDay] ?? "");
    if (label) chips.push(escapeHtml(label));
  }
  if (parsed.timeMin != null) {
    const t = formatTimeOfDay(parsed.timeMin);
    if (t) chips.push(escapeHtml(t));
  }
  el.innerHTML = chips.length
    ? `<span class="parse-chip">${chips.join('</span><span class="parse-chip">')}</span>`
    : "";
}

export function render(): void {
  if (breakState) {
    renderBreak();
    return;
  }
  if (quickRun) {
    renderQuickRun();
    return;
  }
  const session = activeSession();
  if (session && session.status !== "done") {
    renderSession(session);
    return;
  }
  if (subView?.kind === "history") {
    renderHistory(null);
  } else if (subView?.kind === "taskHistory") {
    renderHistory(subView.taskId);
  } else if (subView?.kind === "dashboard") {
    renderDashboard();
  } else {
    renderBoard();
  }
}

/** 0037: keep the open row menu inside the viewport (flip upward near the bottom). */
export function positionRowMenu(): void {
  const menu = document.querySelector<HTMLElement>("[data-menu]");
  if (!menu) return;
  const task = menu.closest<HTMLElement>(".task, .quick-item");
  const btn = task?.querySelector<HTMLElement>('[data-action="open-menu"]');
  if (!btn) return;

  const rect = btn.getBoundingClientRect();
  const gap = 6;
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;

  const left = Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8);
  let top = rect.bottom + gap;
  if (top + menuHeight > window.innerHeight - 8) {
    top = rect.top - menuHeight - gap;
  }
  top = Math.max(8, top);

  menu.style.position = "fixed";
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.right = "auto";
  menu.style.bottom = "auto";
}

function pageHeaderHtml(): string {
  const logoSrc = settings.theme === "day" ? "favicon-light.svg" : "favicon.svg";
  return `
    <header class="app-header">
      <div class="app-title">
        <img class="logo" src="${logoSrc}" alt="UltradianDrift logo" />
        <div>
          <h1>UltradianDrift</h1>
          <p class="tagline">Work in sync with your natural rhythm.</p>
        </div>
      </div>
      <nav class="header-actions">
        <button class="icon-btn" data-action="view-dashboard" title="Dashboard" aria-label="Dashboard">${icon("dashboard")}</button>
        <button class="icon-btn" data-action="view-history" title="History" aria-label="History">${icon("history")}</button>
        <button class="icon-btn" data-action="open-settings" title="Settings" aria-label="Settings">${icon("settings")}</button>
        <button class="icon-btn" data-action="open-about" title="About UltradianDrift" aria-label="About UltradianDrift">${icon("info")}</button>
      </nav>
    </header>`;
}

function summaryBarHtml(): string {
  const today = todayTotals(state.sessions, settings);
  const week = weekTotals(state.sessions, settings);
  const weekDays = weekDayCount(state.sessions);
  const streak = focusStreak(state.sessions);

  let text: string;
  if (today.workMs === 0) {
    text = "No focus yet today";
  } else {
    text = `Today: ${formatDuration(today.workMs)}`;
    if (today.pomodoroCount > 0) {
      text += ` · ${today.pomodoroCount} pomodoro${today.pomodoroCount === 1 ? "" : "s"}`;
    }
  }
  if (weekDays >= 2) text += ` · This week: ${formatDuration(week.workMs)}`;

  const leaf =
    streak > 0
      ? `<span class="leaf" title="Focus streak: ${streak} day${streak === 1 ? "" : "s"}" style="--lv:${Math.min(streak, 5)}"></span>`
      : "";
  return `<div class="summary-bar"><span class="summary-text">${escapeHtml(text)}</span>${leaf}</div>`;
}

function boardControlsHtml(): string {
  const priorityOptions = [1, 2, 3, 4, 5]
    .map((p) => `<option value="${p}" ${filterPriority === p ? "selected" : ""}>${p}</option>`)
    .join("");
  return `
    <div class="board-controls">
      <input type="search" id="task-search" data-search class="search-input" placeholder="Search ( / )" value="${escapeHtml(searchQuery)}" aria-label="Search tasks" />
      <label>Priority
        <select data-filter-priority>
          <option value="">All</option>
          ${priorityOptions}
        </select>
      </label>
      <label>Type
        <select data-filter-quadrant>
          <option value="">All</option>
          <option value="q1" ${filterQuadrant === "q1" ? "selected" : ""}>Urgent · Important</option>
          <option value="q2" ${filterQuadrant === "q2" ? "selected" : ""}>Not urgent · Important</option>
          <option value="q3" ${filterQuadrant === "q3" ? "selected" : ""}>Urgent · Not important</option>
          <option value="q4" ${filterQuadrant === "q4" ? "selected" : ""}>Not urgent · Not important</option>
        </select>
      </label>
      <label>Sort
        <select data-sort>
          <option value="priority" ${sortBy === "priority" ? "selected" : ""}>Priority</option>
          <option value="type" ${sortBy === "type" ? "selected" : ""}>Type</option>
          <option value="newest" ${sortBy === "newest" ? "selected" : ""}>Newest</option>
          <option value="manual" ${sortBy === "manual" ? "selected" : ""}>Manual</option>
        </select>
      </label>
    </div>`;
}

const QUADRANT_ORDER: Record<Quadrant, number> = { q1: 0, q2: 1, q3: 2, q4: 3 };

function matchesFilters(t: Task): boolean {
  if (filterPriority !== null && t.priority !== filterPriority) return false;
  if (filterQuadrant !== null && t.quadrant !== filterQuadrant) return false;
  return true;
}

function matchesSearch(t: Task): boolean {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  if (t.title.toLowerCase().includes(q)) return true;
  // 0059: also match the longer description text.
  if (t.description.toLowerCase().includes(q)) return true;
  return (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
}

function sortedTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    switch (sortBy) {
      case "type":
        return (
          QUADRANT_ORDER[a.quadrant] - QUADRANT_ORDER[b.quadrant] ||
          a.priority - b.priority ||
          a.createdAt - b.createdAt
        );
      case "newest":
        return b.createdAt - a.createdAt;
      case "manual":
        return (
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
          a.createdAt - b.createdAt
        );
      case "priority":
      default:
        return a.priority - b.priority || a.createdAt - b.createdAt;
    }
  });
}

/** The "⋯" row menu contents for an open (not done) task. */
function openTaskMenuHtml(task: Task): string {
  return `
    <button data-action="today" data-id="${task.id}">${isTodayOpen(task) ? "Unplan today" : "Plan today"}</button>
    <button data-action="defer" data-id="${task.id}">Defer…</button>
    <button data-action="repeats" data-id="${task.id}">${task.recurrence ? `Repeats: ${recurrenceLabel(task.recurrence)}` : "Repeat…"}</button>
    <button data-action="edit" data-id="${task.id}">Edit</button>
    <button data-action="task-history" data-id="${task.id}">History</button>
    <button data-action="delete" data-id="${task.id}">Delete</button>`;
}

/** The "⋯" trigger plus its open popup menu, for compact quick/today rows. */
function moreActionsHtml(task: Task): string {
  return `
    <button class="icon-btn" data-action="open-menu" data-id="${task.id}" title="More actions" aria-label="More actions">${icon("dots")}</button>
    ${openMenuTaskId === task.id ? `<div class="row-menu" data-menu>${openTaskMenuHtml(task)}</div>` : ""}`;
}

/** Quadrant + priority badges, shared by main rows and compact rows. */
function quadrantPriorityHtml(task: Task): string {
  return `
    <button class="quadrant ${task.quadrant}" data-action="cycle-quadrant" data-id="${task.id}" title="Quadrant — click to change" aria-label="Quadrant ${QUADRANT_LABEL[task.quadrant]}, click to change">${QUADRANT_LABEL[task.quadrant]}</button>
    ${priorityLabel(task)}`;
}

/** 0079: a collapsible board section card — toggle header + body. */
function sectionCardHtml(
  key: SectionKey,
  titleHtml: string,
  bodyHtml: string,
  opts: { extraClass?: string; bodyClass?: string } = {},
): string {
  const { extraClass = "", bodyClass = "" } = opts;
  const isOpen = openSections[key];
  const bodyId = `section-${key}-body`;
  return `
    <section class="section ${extraClass} ${isOpen ? "open" : ""}">
      <button class="section-toggle" data-action="toggle-section" data-section="${key}" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${bodyId}">
        <span class="section-title">${titleHtml}</span>
        <span class="section-chevron">${icon("chevron")}</span>
      </button>
      ${isOpen ? `<div class="section-body ${bodyClass}" id="${bodyId}">${bodyHtml}</div>` : ""}
    </section>`;
}

function planListHtml(key: SectionKey, title: string, items: Task[], extraClass = ""): string {
  if (!items.length) return "";
  const rows = items
    .map((t) => {
      const unplan =
        extraClass === "deferred"
          ? `<button class="icon-btn" data-action="today" data-id="${t.id}" title="Bring to today" aria-label="Bring to today">${icon("calendar")}</button>`
          : `<button class="icon-btn" data-action="today" data-id="${t.id}" title="Remove from today" aria-label="Remove from today">${icon("x")}</button>`;
      const date =
        extraClass === "deferred"
          ? `<span class="later-date">${formatDue(t.plannedFor!)}</span>`
          : "";
      return `
        <li class="quick-item">
          <button class="check" data-action="toggle" data-id="${t.id}" aria-label="Toggle done" aria-pressed="${t.done ? "true" : "false"}"></button>
          ${date}
          <span class="task-title">${escapeHtml(t.title)}${recurrenceBadgeHtml(t.recurrence)}</span>
          <span class="task-meta">${quadrantPriorityHtml(t)}</span>
          ${unplan}
          ${extraClass !== "deferred" ? moreActionsHtml(t) : ""}
          <button class="primary icon-btn" data-action="start" data-id="${t.id}" title="Start session" aria-label="Start session">${icon("play")}</button>
        </li>`;
    })
    .join("");
  return sectionCardHtml(key, title, `<ul class="quick-list">${rows}</ul>`, { extraClass });
}

/* ------------------------------------------------------------------ */
/* Task row / chart helpers (0041, 0038)                               */
/* ------------------------------------------------------------------ */

const PRIORITY_COLORS = [
  "",
  "var(--clay)",
  "var(--gold)",
  "var(--earth)",
  "var(--moss)",
  "var(--text-faint)",
];

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** 0043: short human label for a recurrence rule (shown in menus / tooltips). */
function recurrenceLabel(rec: Recurrence | null): string {
  if (!rec) return "once";
  const time = formatTimeOfDay(rec.time);
  const timeBit = time ? ` · ${time}` : "";
  switch (rec.every) {
    case "daily":
      return `daily${timeBit}`;
    case "workdays":
      return `work days${timeBit}`;
    case "weekly":
      return `weekly (${WEEKDAY_NAMES[rec.weekday ?? new Date().getDay()]})${timeBit}`;
    case "monthly":
      return `monthly (day ${rec.day ?? "completion"})${timeBit}`;
    case "days":
      return `every ${rec.interval} days${timeBit}`;
  }
}

/** Day label for a scheduled timestamp, with the time of day when one is set. */
function formatDue(ms: number): string {
  const day = formatDay(ms);
  const time = formatTimeOfDay((ms - startOfLocalDay(ms)) / 60_000);
  return time ? `${day} · ${time}` : day;
}

/** 0043: small inline "repeats" badge for a task row. */
function recurrenceBadgeHtml(rec: Recurrence | null): string {
  if (!rec) return "";
  return `<span class="recur-badge" title="Repeats ${recurrenceLabel(rec)}" aria-label="Repeats ${recurrenceLabel(rec)}">${icon("repeat")}</span>`;
}

function priorityLabel(task: Task): string {
  return `<button class="priority-pill" style="color:${PRIORITY_COLORS[task.priority]}" data-action="cycle-priority" data-id="${task.id}" title="Priority ${task.priority} of 5 — click to change" aria-label="Priority ${task.priority} of 5, click to change">P${task.priority}</button>`;
}

/** Horizontal proportion bars (label + track + value). */
function barRows(items: { label: string; value: number; display: string }[]): string {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<ul class="bar-list">${items
    .map(
      (i) => `<li>
        <span class="bar-label">${i.label}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.round((i.value / max) * 100)}%" aria-hidden="true"></span></span>
        <strong class="bar-value">${i.display}</strong>
      </li>`,
    )
    .join("")}</ul>`;
}

function barHeight(ms: number, max: number): string {
  return ms > 0 ? `${Math.max(4, Math.round((ms / max) * 100))}%` : "3px";
}

/** Vertical bar columns for a time series (focus trend / weekday rhythm). */
function chartColumns(
  cols: { label: string; tooltip: string; ms: number }[],
  ariaLabel: string,
  todayIndex: number | null = null,
): string {
  const max = Math.max(1, ...cols.map((c) => c.ms));
  return `<div class="chart-bars" role="img" aria-label="${escapeHtml(ariaLabel)}">${cols
    .map(
      (
        c,
        i,
      ) => `<div class="chart-col ${i === todayIndex ? "today" : ""} ${c.ms === 0 ? "zero" : ""}" title="${escapeHtml(c.tooltip)}">
        <div class="chart-bar-area"><span class="chart-bar" style="height:${barHeight(c.ms, max)}"></span></div>
        <span class="chart-col-label">${escapeHtml(c.label)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

function renderBoard(): void {
  updateDocumentTitle(null);

  const todayOpen = state.tasks.filter((t) => isTodayOpen(t) && matchesSearch(t));
  const laterOpen = state.tasks
    .filter((t) => isFutureOpen(t) && matchesSearch(t))
    .sort((a, b) => (a.plannedFor ?? 0) - (b.plannedFor ?? 0));
  const quickTasks = state.tasks.filter(
    (t) => t.quick && !t.done && !isTodayOpen(t) && !isFutureOpen(t) && matchesSearch(t),
  );
  const mainTasks = sortedTasks(
    state.tasks
      .filter((t) => !isTodayOpen(t) && !isFutureOpen(t) && !(t.quick && !t.done) && !t.done)
      .filter(matchesFilters)
      .filter(matchesSearch),
  );

  // 0075: completed tasks live in a folded "Completed" section at the bottom.
  const doneTasks = state.tasks
    .filter((t) => t.done && matchesFilters(t) && matchesSearch(t))
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0) || a.createdAt - b.createdAt);

  const totals = new Map<string, ReturnType<typeof taskTotals>>();
  for (const t of state.tasks) totals.set(t.id, taskTotals(t.id, state.sessions, settings));

  // 0060: manual-order position of each open task, to disable Move up/down at the edges.
  const openManual = sortBy === "manual" ? sortedTasks(state.tasks.filter((t) => !t.done)) : [];

  const rowFor = (task: Task, opts: { done?: boolean }): string => {
    const t = totals.get(task.id)!;
    const bits: string[] = [];
    if (t.workMs > 0) bits.push(formatDuration(t.workMs));
    if (t.sessionCount > 0)
      bits.push(`${t.sessionCount} session${t.sessionCount === 1 ? "" : "s"}`);
    if (t.pomodoroCount > 0)
      bits.push(`${t.pomodoroCount} pomodoro${t.pomodoroCount === 1 ? "" : "s"}`);

    const manualIdx = openManual.findIndex((o) => o.id === task.id);
    const moveButtons =
      sortBy === "manual" && !task.done && !opts.done
        ? `
                  <button data-action="move-task" data-id="${task.id}" data-dir="up" ${manualIdx <= 0 ? "disabled" : ""}>Move up</button>
                  <button data-action="move-task" data-id="${task.id}" data-dir="down" ${manualIdx < 0 || manualIdx >= openManual.length - 1 ? "disabled" : ""}>Move down</button>`
        : "";

    const menuHtml = opts.done
      ? `
                  <button data-action="edit" data-id="${task.id}">Edit</button>
                  <button data-action="task-history" data-id="${task.id}">History</button>
                  <button data-action="delete" data-id="${task.id}">Delete</button>`
      : `${openTaskMenuHtml(task)}${moveButtons}`;

    // The start button is always visible so it's obvious where to begin work.
    const startButton = opts.done
      ? ""
      : `<div class="task-start">
          <button class="primary icon-btn" data-action="start" data-id="${task.id}" title="Start a session" aria-label="Start a session">${icon("play")}</button>
        </div>`;

    const quickButton = opts.done
      ? ""
      : `<button class="icon-btn ${task.quick ? "on" : ""}" data-action="toggle-quick" data-id="${task.id}" title="${task.quick ? "Remove quick mark" : "Mark as quick"}" aria-label="${task.quick ? "Remove quick mark" : "Mark as quick"}" aria-pressed="${task.quick ? "true" : "false"}">${icon("bolt")}</button>`;

    return `
      <li class="task ${task.quadrant} ${task.done ? "done" : ""} ${isOverdueOpen(task) ? "overdue" : ""}" data-id="${task.id}">
        ${sortBy === "manual" && !task.done && !opts.done ? `<button class="icon-btn grip" data-grip title="Reorder" aria-label="Reorder ${escapeHtml(task.title)}">${icon("grip")}</button>` : ""}
        <button class="check" data-action="toggle" data-id="${task.id}" aria-label="Toggle done" aria-pressed="${task.done ? "true" : "false"}">${task.done ? "✓" : ""}</button>
        <div class="task-body">
          <span class="task-title">${escapeHtml(task.title)}${recurrenceBadgeHtml(task.recurrence)}${isOverdueOpen(task) ? `<span class="overdue-badge">overdue</span>` : ""}</span>
          <span class="task-meta">
            ${quadrantPriorityHtml(task)}
            ${
              (task.tags ?? []).length
                ? `<span class="tag-chips">${(task.tags ?? [])
                    .map((tag) => `<span class="tag-chip">#${escapeHtml(tag)}</span>`)
                    .join("")}</span>`
                : ""
            }
          </span>
        </div>
        <div class="task-right">
          ${
            settings.showEstimates
              ? `<input type="number" class="est-input" data-estimate="${task.id}" value="${task.estimatedMin ?? ""}" min="0" max="300" placeholder="estimate (min)" aria-label="Estimated minutes (max 300)" />`
              : ""
          }
          ${bits.length ? `<span class="task-stats">${bits.join(" · ")}</span>` : ""}
        </div>
        <div class="task-actions">
          ${quickButton}
          <button class="icon-btn" data-action="open-menu" data-id="${task.id}" title="More actions" aria-label="More actions">${icon("dots")}</button>
          ${openMenuTaskId === task.id ? `<div class="row-menu" data-menu>${menuHtml}</div>` : ""}
        </div>
        ${startButton}
      </li>`;
  };

  const rows = mainTasks.map((task) => rowFor(task, {})).join("");
  const doneRows = doneTasks.map((task) => rowFor(task, { done: true })).join("");

  const quickSection = quickTasks.length
    ? sectionCardHtml(
        "quick",
        "Quick tasks",
        `<ul class="quick-list">
          ${quickTasks
            .map(
              (t) => `
            <li class="quick-item">
              <button class="check" data-action="toggle" data-id="${t.id}" aria-label="Toggle done" aria-pressed="${t.done ? "true" : "false"}"></button>
              <span class="task-title">${escapeHtml(t.title)}${recurrenceBadgeHtml(t.recurrence)}</span>
              <span class="task-meta">${quadrantPriorityHtml(t)}</span>
              <button class="icon-btn" data-action="toggle-quick" data-id="${t.id}" title="Unmark as quick" aria-label="Unmark as quick" aria-pressed="true">${icon("bolt")}</button>
              ${moreActionsHtml(t)}
              <button class="primary" data-action="quick-run" data-id="${t.id}">Run</button>
            </li>`,
            )
            .join("")}
        </ul>`,
      )
    : "";

  // 0075: the "Completed" card is the one section that starts collapsed.
  const doneSection = doneTasks.length
    ? sectionCardHtml(
        "done",
        `<span>Completed</span><span class="done-count">${doneTasks.length}</span>`,
        `<ul id="done-list" class="task-list done-list">${doneRows}</ul>`,
        { extraClass: "done-section", bodyClass: "done-body" },
      )
    : "";

  const hasFilters =
    filterPriority !== null || filterQuadrant !== null || searchQuery.trim() !== "";

  // 0069: distinct, actionable empty states for a truly empty board vs. filtered-out rows.
  let emptyHtml: string;
  if (state.tasks.length === 0) {
    const cta = `<div class="empty-actions">
        <button class="primary" data-action="focus-add">Add your first task</button>
        <button class="ghost" data-action="load-examples">Load example data</button>
      </div>`;
    emptyHtml = emptyStateHtml(
      "check",
      "Plan your first task",
      "One small step at a time. Type what you need to do above — try “write report #work !1 tomorrow”.",
      cta,
    );
  } else if (
    hasFilters &&
    !mainTasks.length &&
    !todayOpen.length &&
    !laterOpen.length &&
    !quickTasks.length &&
    !doneTasks.length
  ) {
    const cta = `<div class="empty-actions"><button class="ghost" data-action="clear-filters">Clear filters</button></div>`;
    emptyHtml = emptyStateHtml(
      "search",
      "No matching tasks",
      "Nothing matches your search or filters right now.",
      cta,
    );
  } else {
    emptyHtml = `<p class="empty">No more tasks here.</p>`;
  }

  // 0070: a short welcome on the first ever run, before any data exists.
  const showWelcome =
    state.tasks.length === 0 && doneSessions(state).length === 0 && !isOnboarded();
  const welcome = showWelcome
    ? `
    <section class="welcome">
      <button class="icon-btn welcome-dismiss" data-action="dismiss-onboarding" title="Dismiss" aria-label="Dismiss welcome">${icon("x")}</button>
      <h2>Work with your rhythm, not the clock.</h2>
      <ol class="welcome-steps">
        <li><strong>Add a task</strong> — the box above understands plain language (<code>#tags</code>, priorities, “tomorrow”).</li>
        <li><strong>Start a session</strong> — Flowtime for deep work, Pomodoro when you need structure.</li>
        <li><strong>See your rhythm</strong> — today's focus and the dashboard show where your energy went.</li>
      </ol>
      <div class="empty-actions">
        <button class="primary" data-action="start-now">Start now</button>
        <button class="ghost" data-action="load-examples">Load example data</button>
      </div>
    </section>`
    : "";

  renderView(
    "board",
    `
    ${pageHeaderHtml()}
    <div class="toolbar">
      ${summaryBarHtml()}
    </div>
    ${welcome}
    <section class="add-task">
      <input id="task-title" type="text" placeholder="What do you need to do? #tag" autocomplete="off" aria-describedby="add-parse-feedback" />
      <div id="add-parse-feedback" class="parse-chips" aria-live="polite"></div>
      <div class="add-task-row">
        <label>
          <select id="task-priority" aria-label="Priority">
            <option value="1">P1</option>
            <option value="2" selected>P2</option>
            <option value="3">P3</option>
            <option value="4">P4</option>
            <option value="5">P5</option>
          </select>
        </label>
        <label>
          <select id="task-quadrant" aria-label="Quadrant">
            <option value="q1">Urgent · Important</option>
            <option value="q2" selected>Not urgent · Important</option>
            <option value="q3">Urgent · Not important</option>
            <option value="q4">Not urgent · Not important</option>
          </select>
        </label>
        <label class="check-field">Quick
          <input type="checkbox" id="task-quick" />
        </label>
        <div class="add-task-actions">
          <button id="add-and-focus" class="ghost" title="Add the task and choose a focus session">${icon("play")} Add &amp; focus</button>
          <button id="add-task" class="primary">Add task</button>
        </div>
      </div>
    </section>

    ${state.tasks.length ? boardControlsHtml() : ""}

    ${planListHtml("today", "Today", todayOpen)}

    ${sectionCardHtml(
      "open",
      "Open",
      mainTasks.length === 0 ? emptyHtml : `<ul class="task-list">${rows}</ul>`,
      { extraClass: "open-section" },
    )}

    ${planListHtml("later", "Later", laterOpen, "deferred")}
    ${quickSection}
    ${doneSection}
    <p class="shortcut-hint"><span class="hint-text"><strong>N</strong> new task · <strong>/</strong> search · <strong>?</strong> shortcuts · <strong>Esc</strong> close menus</span>${koFiHtml()}</p>`,
  );
}

function renderHistory(taskId: string | null): void {
  updateDocumentTitle(null);

  const sessions = doneSessions(state).filter((s) => (taskId ? s.taskId === taskId : true));
  const scopedTask = taskId ? taskById(taskId) : undefined;
  const title = taskId ? `History · ${scopedTask?.title ?? "deleted task"}` : "Session history";

  const completions = scopedTask?.completions ?? [];
  const completionsHtml = completions.length
    ? `<section class="completion-log">
        <h3 class="page-title">Completed occurrences</h3>
        <ul class="hist-list">
          ${completions
            .map((c) => {
              const when = new Date(c.completedAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              const due = c.plannedFor ? ` · was due ${formatDue(c.plannedFor)}` : " · no due date";
              return `<li class="hist-item">
                <div class="hist-top">
                  <span class="hist-title">Completed</span>
                  <span class="hist-date">${when}</span>
                </div>
                <div class="hist-sub">${due}</div>
              </li>`;
            })
            .join("")}
        </ul>
      </section>`
    : "";

  const rows = sessions
    .map((s) => {
      const work = sessionWorkMs(s, settings);
      const task = taskById(s.taskId);
      const date = new Date(s.endedAt ?? s.startedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const pomoBit =
        s.technique === "pomodoro" && s.completedPomodoros > 0
          ? ` · ${s.completedPomodoros} pomodoro${s.completedPomodoros === 1 ? "" : "s"}`
          : "";
      const innerNotes = notesFor(s.id);

      return `
      <li class="hist-item">
        <div class="hist-top">
          <span class="hist-title">${escapeHtml(task?.title ?? "(deleted task)")}</span>
          <span class="hist-date">${date}</span>
          <button class="icon-btn hist-delete" data-action="delete-session" data-id="${s.id}" title="Delete session" aria-label="Delete session">${icon("x")}</button>
        </div>
        <div class="hist-sub">${techniqueLabel(s.technique)} · ${formatDuration(work)}${pomoBit}</div>
        ${
          innerNotes.length
            ? `<ul class="hist-notes">${innerNotes
                .map(
                  (n) => `<li>
                    <span class="note-text">${escapeHtml(n.text)}</span>
                    <button class="icon-btn" data-action="edit-note" data-id="${n.id}" title="Edit note" aria-label="Edit note">${icon("edit")}</button>
                    <button class="icon-btn" data-action="delete-note" data-id="${n.id}" title="Delete note" aria-label="Delete note">${icon("x")}</button>
                  </li>`,
                )
                .join("")}</ul>`
            : ""
        }
      </li>`;
    })
    .join("");

  const sessionsEmpty = taskId
    ? "No sessions for this task yet. Start one to begin its history."
    : "No finished sessions yet. Your focus history will appear here.";

  // 0081: the general history view gets Sessions / Distractions tabs. The
  // distraction log aggregates entries from every task, newest first.
  const showTabs = !taskId;
  const distractionsSorted = [...state.distractions].sort((a, b) => b.createdAt - a.createdAt);

  const distractionsRows = distractionsSorted
    .map((d) => {
      const when = new Date(d.createdAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const during = d.taskId
        ? `<span class="hist-sub">during ${escapeHtml(taskById(d.taskId)?.title ?? "deleted task")}</span>`
        : "";
      return `<li class="hist-item">
        <div class="hist-top">
          <span class="hist-title">${escapeHtml(d.text)}</span>
          <span class="hist-date">${when}</span>
        </div>
        ${during}
      </li>`;
    })
    .join("");

  const distractionsTabHtml = `
    <div class="dash-card-head">
      <h3 class="page-title">Distraction log</h3>
      <button class="ghost" data-action="clear-distractions" title="Delete every logged distraction">Clear log</button>
    </div>
    ${
      distractionsSorted.length
        ? `<ul class="hist-list">${distractionsRows}</ul>`
        : emptyStateHtml("target", "Nothing here yet", "Capture distractions during sessions to see them here.")
    }`;

  const sessionsTabHtml = `
    ${
      sessions.length === 0
        ? emptyStateHtml("history", "Nothing here yet", sessionsEmpty)
        : `<ul class="hist-list">${rows}</ul>`
    }
    ${completionsHtml}`;

  const tabsHtml = showTabs
    ? `<div class="history-tabs" role="tablist" aria-label="History sections">
        <button type="button" class="history-tab ${historyTab === "sessions" ? "active" : ""}" role="tab" aria-selected="${historyTab === "sessions" ? "true" : "false"}" data-history-tab="sessions">Sessions</button>
        <button type="button" class="history-tab ${historyTab === "distractions" ? "active" : ""}" role="tab" aria-selected="${historyTab === "distractions" ? "true" : "false"}" data-history-tab="distractions">Distractions</button>
      </div>`
    : "";

  renderView(
    "history",
    `
    ${pageHeaderHtml()}
    <main class="board">
      <button class="back-btn" data-action="back-to-board">${icon("back")} Back</button>
      <h2 class="page-title">${escapeHtml(title)}</h2>
      ${tabsHtml}
      ${historyTab === "distractions" ? distractionsTabHtml : sessionsTabHtml}
    </main>`,
  );
}

function renderDashboard(): void {
  updateDocumentTitle(null);

  const total = state.tasks.length;
  const open = state.tasks.filter((t) => !t.done).length;

  const weekStartMs = startOfWeek(Date.now());
  const doneThisWeek = state.tasks.filter(
    (t) => t.done && t.doneAt != null && t.doneAt >= weekStartMs,
  ).length;

  const quadrantOpen: Record<Quadrant, number> = { q1: 0, q2: 0, q3: 0, q4: 0 };
  for (const t of state.tasks) if (!t.done) quadrantOpen[t.quadrant] += 1;

  const today = todayTotals(state.sessions, settings);
  const week = weekTotals(state.sessions, settings);
  const streak = focusStreak(state.sessions);
  const tags = tagAttention(state.tasks);

  const plannedToday = state.tasks.filter((t) => isTodayOpen(t));
  const quadFocus = focusByQuadrant(state.sessions, state.tasks, settings);
  const tagFocus = focusByTag(state.sessions, state.tasks, settings);
  const quadLabel: Record<string, string> = {
    q1: "Urgent · Important",
    q2: "Not urgent · Important",
    q3: "Urgent · Not important",
    q4: "Not urgent · Not important",
    deleted: "Deleted tasks",
  };

  const hasSessions = state.sessions.some((s) => s.status === "done");
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekdayShort = ["M", "T", "W", "T", "F", "S", "S"];

  const trendHtml = hasSessions
    ? chartColumns(
        dailyFocus(state.sessions, settings, 14).map((d) => {
          const date = new Date(d.dayStart);
          return {
            label: date.toLocaleDateString([], { weekday: "narrow" }),
            tooltip: `${date.toLocaleDateString([], { month: "short", day: "numeric" })} · ${formatDuration(d.workMs)}`,
            ms: d.workMs,
          };
        }),
        "Focus time for the last 14 days",
        13,
      )
    : null;

  const weekdayHtml = hasSessions
    ? chartColumns(
        weekdayAverages(state.sessions, settings).map((avg, i) => ({
          label: weekdayShort[i],
          tooltip: `${weekdayNames[i]} · avg ${formatDuration(avg)}`,
          ms: avg,
        })),
        "Average focus per weekday",
        (new Date().getDay() + 6) % 7,
      )
    : null;

  const quadrantBars =
    total === 0
      ? null
      : barRows(
          (["q1", "q2", "q3", "q4"] as Quadrant[]).map((q) => ({
            label: QUADRANT_LABEL[q],
            value: quadrantOpen[q],
            display: String(quadrantOpen[q]),
          })),
        );

  const tagBars = tags.length
    ? barRows(
        tags.map((t) => ({
          label: `#${escapeHtml(t.tag)}`,
          value: t.open,
          display: String(t.open),
        })),
      )
    : null;

  const quadFocusBars = quadFocus.length
    ? barRows(
        quadFocus.map((b) => ({
          label: quadLabel[b.key] ?? escapeHtml(b.key),
          value: b.workMs,
          display: formatDuration(b.workMs),
        })),
      )
    : null;

  const tagFocusBars = tagFocus.length
    ? barRows(
        tagFocus.map((b) => ({
          label: `#${escapeHtml(b.key)}`,
          value: b.workMs,
          display: formatDuration(b.workMs),
        })),
      )
    : null;

  const recent = doneSessions(state).slice(0, 8);
  const recentHtml = recent.length
    ? `<table class="dash-table">
        <thead>
          <tr><th>Task</th><th>Technique</th><th>Duration</th><th>Ended</th></tr>
        </thead>
        <tbody>
          ${recent
            .map((s) => {
              const work = sessionWorkMs(s, settings);
              const task = taskById(s.taskId);
              const ended = new Date(s.endedAt ?? s.startedAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              const pomoBit =
                s.technique === "pomodoro" && s.completedPomodoros > 0
                  ? ` · ${s.completedPomodoros}×`
                  : "";
              const taskCell = task
                ? `<button class="table-task" data-action="task-history" data-id="${task.id}" title="View history">${escapeHtml(task.title)}</button>`
                : `<span class="table-muted">(deleted task)</span>`;
              return `<tr>
                <td>${taskCell}</td>
                <td>${techniqueLabel(s.technique)}</td>
                <td>${formatDuration(work)}${pomoBit}</td>
                <td>${ended}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`
    : null;

  renderView(
    "dashboard",
    `
    ${pageHeaderHtml()}
    <main class="board">
      <button class="back-btn" data-action="back-to-board">${icon("back")} Back</button>
      <h2 class="page-title">Dashboard</h2>
      <div class="dash-grid">
        <section class="dash-card">
          <h3>Overview</h3>
          <ul class="dash-stats">
            <li><span>Total tasks</span><strong>${total}</strong></li>
            <li><span>Open</span><strong>${open}</strong></li>
            <li><span>Done this week</span><strong>${doneThisWeek}</strong></li>
          </ul>
        </section>
        <section class="dash-card">
          <h3>Focus</h3>
          <ul class="dash-stats">
            <li><span>Today</span><strong>${formatDuration(today.workMs)}</strong></li>
            <li><span>This week</span><strong>${formatDuration(week.workMs)}</strong></li>
            <li><span>Streak</span><strong>${streak} day${streak === 1 ? "" : "s"}</strong></li>
          </ul>
        </section>
        <section class="dash-card">
          <h3>Today</h3>
          ${plannedToday.length ? `<ul class="quick-list">${plannedToday.map((t) => `<li class="quick-item"><span class="task-title">${escapeHtml(t.title)}</span><button class="primary icon-btn" data-action="start" data-id="${t.id}" title="Start session" aria-label="Start session">${icon("play")}</button></li>`).join("")}</ul>` : `<p class="dialog-text">Nothing planned for today.</p>`}
        </section>
        <section class="dash-card wide">
          <h3>Focus trend</h3>
          ${trendHtml ?? emptyStateHtml("dashboard", "No focus yet", "Finish a session to see your trend.")}
        </section>
        <section class="dash-card">
          <h3>Week rhythm</h3>
          ${weekdayHtml ?? emptyStateHtml("dashboard", "No focus yet", "Finish sessions across the week to reveal your rhythm.")}
        </section>
        <section class="dash-card">
          <h3>Open tasks by quadrant</h3>
          ${quadrantBars ?? emptyStateHtml("check", "No tasks yet", "Add a task to populate this board.")}
        </section>
        <section class="dash-card">
          <h3>Areas needing attention</h3>
          ${tagBars ?? emptyStateHtml("bolt", "No open tags yet", "Add tasks with #tags to see areas here.")}
        </section>
        <section class="dash-card">
          <h3>Focus by quadrant</h3>
          ${quadFocusBars ?? emptyStateHtml("dashboard", "No focus yet", "Finish a session to see where your focus went.")}
        </section>
        <section class="dash-card">
          <h3>Focus by tag</h3>
          ${tagFocusBars ?? emptyStateHtml("dashboard", "No focus yet", "Finish a session to see focus by tag.")}
        </section>
        ${
          settings.distractionLogEnabled
            ? `<section class="dash-card">
                <div class="dash-card-head">
                  <h3>Distractions</h3>
                  <button class="icon-btn" data-action="view-history" title="View the distraction log" aria-label="View the distraction log">${icon("history")}</button>
                </div>
                ${
                  state.distractions.length
                    ? `<ul class="dash-stats"><li><span>Logged</span><strong>${state.distractions.length}</strong></li></ul>`
                    : emptyStateHtml("target", "No distractions yet", "Enable the distraction log in Settings, then capture thoughts during sessions.")
                }
              </section>`
            : ""
        }
        <section class="dash-card wide">
          <div class="dash-card-head">
            <h3>Recent sessions</h3>
            <button class="icon-btn" data-action="view-history" title="View all history" aria-label="View all history">${icon("history")}</button>
          </div>
          ${recentHtml ?? emptyStateHtml("history", "No finished sessions yet", "Your recent sessions will appear here.")}
        </section>
      </div>
    </main>`,
  );
}

function resumeHintFor(session: Session): { notes: string[] } | null {
  const finished = state.sessions
    .filter(
      (s) =>
        s.taskId === session.taskId &&
        s.status === "done" &&
        s.id !== session.id &&
        s.endedAt != null,
    )
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const recent = finished[0];
  if (!recent) return null;
  const notes = notesFor(recent.id).map((n) => n.text);
  return notes.length ? { notes } : null;
}

/** 0082: dump a task mid-session — a single subtle field, like the notes. */
function captureFieldHtml(): string {
  return `
    <section class="capture-section">
      <h3>Remembered something you need to do?</h3>
      <form id="capture-form" class="capture-row">
        <input id="capture-thought" type="text" placeholder="Dump it here… #tag" autocomplete="off" aria-label="Capture a thought and add it to your board" />
        <button type="submit" class="ghost">Add</button>
      </form>
      <span id="capture-confirm" class="capture-confirm" aria-live="polite"></span>
    </section>`;
}

/** 0081: park a distraction mid-session — same style, no dialog. */
function distractionFieldHtml(extraClass = ""): string {
  if (!settings.distractionLogEnabled) return "";
  return `
    <section class="capture-section ${extraClass}">
      <h3>Distracted? Park it here.</h3>
      <form id="distraction-form" class="capture-row">
        <input id="distraction-text" type="text" placeholder="What grabbed your attention?" autocomplete="off" aria-label="Log a distraction" />
        <button type="submit" class="ghost">Log</button>
      </form>
      <span id="distraction-confirm" class="capture-confirm" aria-live="polite"></span>
    </section>`;
}

/** 0081/0082: park thoughts mid-session without leaving focus. */
function sessionThoughtsHtml(): string {
  return `${captureFieldHtml()}${distractionFieldHtml()}`;
}

function renderSession(session: Session): void {
  const task = taskById(session.taskId);
  const snap = snapshot(session, timerConfig());
  const title = escapeHtml(task?.title ?? "Untitled task");
  const markDoneLabel = task?.done ? "Unmark done" : "Mark done";
  const clockText =
    session.technique === "pomodoro" ? formatMs(snap.remainingMs) : formatElapsed(snap.elapsedMs);
  // 0054: slightly emphasize the count-up past the gentle-reminder limit.
  const nudgePast =
    session.technique === "flowtime" &&
    settings.flowtimeNudgeMin > 0 &&
    snap.elapsedMs >= settings.flowtimeNudgeMin * 60_000;

  // 0064: pomodoro gets a draining progress ring; flowtime gets a slow heartbeat glow.
  const config = timerConfig();
  let ringFrac: number | null = null;
  let pulse = false;
  let pulseStrong = false;
  if (session.technique === "pomodoro") {
    const total = phaseMs(snap.phase, config);
    ringFrac = snap.remainingMs != null && total > 0 ? snap.remainingMs / total : null;
  } else {
    pulse = true;
    pulseStrong = nudgePast;
  }
  const clockHtml = clockFrameHtml(clockText, {
    ringFrac,
    pulse,
    strong: pulseStrong,
    frameClass: nudgePast ? "nudge-past" : "",
  });

  if (focusMode) {
    const countBit =
      session.technique === "pomodoro"
        ? `<div class="pomodoro-count">${snap.completedPomodoros} completed</div>`
        : "";
    updateDocumentTitle(clockText);
    renderView(
      "session",
      `
      <main class="session-main focus">
        <header class="session-header">
          <h2 class="session-task-title">${title}</h2>
        </header>
        ${clockHtml}
        ${countBit}
        <div class="session-bottom">
          <div class="session-controls">
            <button class="ghost" data-action="mark-done" data-id="${session.taskId}">${icon("check")} ${markDoneLabel}</button>
          </div>
          ${distractionFieldHtml("focus-capture")}
        </div>
      </main>`,
    );
    return;
  }

  updateDocumentTitle(clockText);

  const hint = resumeHintVisible ? resumeHintFor(session) : null;
  const hintBlock =
    hint && !task?.done
      ? `<section class="resume-hint">
          <div>
            <h3>Pick up where you left off</h3>
            <ul class="note-list">${hint.notes
              .map((n) => `<li>${escapeHtml(n)}</li>`)
              .join("")}</ul>
          </div>
          <button class="icon-btn" data-action="dismiss-hint" title="Dismiss" aria-label="Dismiss hint">${icon("x")}</button>
        </section>`
      : "";
  const desc = (task?.description ?? "").trim();
  const descBlock =
    desc && descriptionHintVisible
      ? `<section class="resume-hint">
          <div>
            <h3>Task description</h3>
            <p class="desc-text">${escapeHtml(desc)}</p>
          </div>
          <button class="icon-btn" data-action="dismiss-desc-hint" title="Dismiss" aria-label="Dismiss description">${icon("x")}</button>
        </section>`
      : "";
  const notes = notesFor(session.id);

  renderView(
    "session",
    `
    <main class="session-main">
      <header class="session-header">
        <h2 class="session-task-title">${title}</h2>
        <span class="session-phase">${phaseLabel(snap.phase)} · ${techniqueLabel(session.technique)}</span>
        ${switchTaskButtonHtml()}
      </header>

      ${descBlock}
      ${hintBlock}
      ${clockHtml}
      ${session.technique === "pomodoro" ? `<div class="pomodoro-count">${snap.completedPomodoros} completed</div>` : ""}

      <div class="session-controls">
        <button class="ghost" data-action="cancel-session" title="Cancel this session — nothing is recorded">${icon("x")} Cancel</button>
        ${
          session.status === "running"
            ? `<button class="ghost" data-action="pause">${icon("pause")} Pause</button>`
            : `<button class="ghost" data-action="resume">${icon("play")} Resume</button>`
        }
        <button class="ghost" data-action="mark-done" data-id="${session.taskId}">${icon("check")} ${markDoneLabel}</button>
        <button class="primary" data-action="finish">${icon("stop")} Finish</button>
      </div>

      <div class="session-bottom">
        <section class="capture-section">
          <h3>Notes for restarting later</h3>
          <form id="note-form" class="capture-row">
            <input id="note-text" type="text" placeholder="What should you remember when you come back?" autocomplete="off" aria-label="Add a note for restarting later" />
            <button type="submit" class="ghost">Add</button>
          </form>
          ${
            notes.length
              ? `<ul class="note-list">${notes
                  .map((n) => `<li>${escapeHtml(n.text)}</li>`)
                  .join("")}</ul>`
              : ""
          }
        </section>

        ${sessionThoughtsHtml()}
      </div>
    </main>
    <p class="shortcut-hint"><span class="hint-text"><strong>Space</strong> pause/resume · <strong>F</strong> finish · <strong>T</strong> task · <strong>M</strong> note · <strong>G</strong> distraction · <strong>?</strong> shortcuts</span>${koFiHtml()}</p>`,
  );
}

function renderBreak(): void {
  if (!breakState) return;
  if (breakState.done) {
    updateDocumentTitle(null);
    renderView(
      "break",
      `
      <main class="session-main">
        <header class="session-header">
          <h2 class="session-task-title">Break over</h2>
          <span class="session-phase">Ready to focus again</span>
        </header>
        <div class="session-controls">
          <button class="primary" data-action="start-next">${icon("play")} Continue focusing</button>
          <button class="ghost" data-action="end-break">${icon("stop")} Done</button>
        </div>
        <button class="aux-action" data-action="rest-guide">${icon("info")} How to actually rest?</button>
      </main>`,
    );
    return;
  }

  const remaining = Math.max(0, breakState.endsAt - Date.now());
  const total = breakState.endsAt - breakState.startedAt;
  updateDocumentTitle(formatMs(remaining));
  renderView(
    "break",
    `
    <main class="session-main">
      <header class="session-header">
        <h2 class="session-task-title">Break</h2>
        <span class="session-phase">Rest · ${techniqueLabel(breakState.technique)}</span>
      </header>
      ${clockFrameHtml(formatMs(remaining), { ringFrac: total > 0 ? remaining / total : 0 })}
      <div class="session-controls">
        <button class="primary" data-action="start-next">${icon("play")} Continue focusing</button>
        <button class="ghost" data-action="skip-break">${icon("stop")} Done</button>
      </div>
      <button class="aux-action" data-action="rest-guide">${icon("info")} How to actually rest?</button>
    </main>
    <p class="shortcut-hint"><span class="hint-text"><strong>F</strong> continue focusing</span>${koFiHtml()}</p>`,
  );
}

function renderQuickRun(): void {
  if (!quickRun) return;
  const task = taskById(quickRun.taskId);
  const left = state.tasks.filter((t) => t.quick && !t.done && !isFutureOpen(t)).length;
  const clockText = formatElapsed(Date.now() - quickRun.startedAt);
  updateDocumentTitle(clockText);
  renderView(
    "quick",
    `
    <main class="session-main">
      <header class="session-header">
        <h2 class="session-task-title">${escapeHtml(task?.title ?? "Untitled task")}</h2>
        <span class="session-phase">Quick run · ${left} left</span>
      </header>
      ${clockFrameHtml(clockText, { pulse: true })}
      <div class="session-controls">
        <button class="primary" data-action="quick-next">Close & next</button>
        <button class="ghost" data-action="quick-finish">Finish run</button>
      </div>
      <div class="session-bottom">${sessionThoughtsHtml()}</div>
    </main>
    <p class="shortcut-hint"><span class="hint-text"><strong>F</strong> finish run</span>${koFiHtml()}</p>`,
  );
}
