// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * DOM-level feature tests for 0067–0074: first-run welcome, live quick-add
 * parsing feedback, the completion animation, and reorder undo.
 */

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  await import("./main");
});

beforeEach(async () => {
  localStorage.clear();
  const {
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
    setSortBy,
    setState,
    setSubView,
  } = await import("./state");
  const { emptyState } = await import("./storage");
  const { DEFAULT_SETTINGS } = await import("./types");
  const { render } = await import("./views");
  const { stopRepaint } = await import("./repaint");
  stopRepaint();
  setState(emptyState());
  setSettings({ ...DEFAULT_SETTINGS });
  for (const key of Object.keys(SECTION_DEFAULTS) as Array<keyof typeof SECTION_DEFAULTS>) {
    setSectionOpen(key, SECTION_DEFAULTS[key]);
  }
  setBreakState(null);
  setQuickRun(null);
  setFocusMode(false);
  setSubView(null);
  setOpenMenuTaskId(null);
  setResumeHintVisible(true);
  setDescriptionHintVisible(true);
  setFilterPriority(null);
  setFilterQuadrant(null);
  setSortBy("priority");
  setSearchQuery("");
  setHiddenAt(null);
  setHiddenSessionId(null);
  setLastWatch(null);
  setLastFinished(null);
  render();
});

function addTask(title: string): void {
  const input = document.querySelector<HTMLInputElement>("#task-title")!;
  input.value = title;
  document.getElementById("add-task")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("first-run welcome (0070)", () => {
  it("shows the welcome on an empty board", () => {
    expect(document.querySelector("#app")!.innerHTML).toContain('class="welcome"');
  });

  it("dismisses the welcome permanently", () => {
    document
      .querySelector<HTMLElement>('[data-action="dismiss-onboarding"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector("#app")!.innerHTML).not.toContain("welcome");
  });
});

describe("live quick-add feedback (0071)", () => {
  it("shows parsed chips while typing", async () => {
    const input = document.querySelector<HTMLInputElement>("#task-title")!;
    input.value = "write report #work !1 tomorrow";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(220); // debounce + parse
    const chips = document.getElementById("add-parse-feedback")!.textContent ?? "";
    expect(chips).toContain("#work");
    expect(chips).toContain("P1");
    expect(chips).toContain("tomorrow");
  });

  it("clears chips once the task is added", async () => {
    const input = document.querySelector<HTMLInputElement>("#task-title")!;
    input.value = "report #work";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(220);
    addTask("report #work");
    expect(document.getElementById("add-parse-feedback")!.textContent).toBe("");
  });
});

describe("completion animation (0067)", () => {
  it("commits the task as done after the checkmark animation", async () => {
    const { state } = await import("./state");
    addTask("Buy milk");
    const taskId = state.tasks[0].id;
    const btn = document.querySelector<HTMLElement>(`.check[data-id="${taskId}"]`)!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(btn.classList.contains("checking")).toBe(true);
    await sleep(220);
    expect(state.tasks[0].done).toBe(true);
    expect(document.querySelector("#app")!.innerHTML).toContain("done-section");
  });
});

describe("reorder undo (0074)", () => {
  it("restores the previous manual order", async () => {
    const { state } = await import("./state");
    const { reorderTasks } = await import("./actions");
    for (const title of ["A", "B", "C"]) addTask(title);
    const first = state.tasks.find((t) => t.title === "A")!;
    const last = state.tasks.find((t) => t.title === "C")!;

    reorderTasks(first.id, last.id);
    expect(state.tasks.find((t) => t.id === first.id)!.order).toBe(3);

    const undo = document.querySelector<HTMLElement>("#undo-action")!;
    undo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.tasks.find((t) => t.id === first.id)!.order).toBe(1);
  });
});

describe("always-visible start button", () => {
  it("renders the start button outside the hover-only actions", () => {
    addTask("Review email");
    const row = document.querySelector<HTMLElement>(".task")!;
    expect(row.querySelector(".task-start")).not.toBeNull();
    expect(row.querySelector<HTMLElement>(".task-start [data-action='start']")).not.toBeNull();
  });
});

describe("settings tabs (0076)", () => {
  const openSettings = (): HTMLElement => {
    document
      .querySelector<HTMLElement>('[data-action="open-settings"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return document.querySelector<HTMLElement>(".overlay")!;
  };

  it("opens on Basic and switches to Advanced on click", () => {
    const overlay = openSettings();
    expect(overlay.querySelector("#panel-basic")!.hasAttribute("hidden")).toBe(false);
    expect(overlay.querySelector("#panel-advanced")!.hasAttribute("hidden")).toBe(true);
    expect(overlay.querySelector("#tab-basic")!.getAttribute("aria-selected")).toBe("true");
    // The Advanced tab carries a count of the data/danger controls behind it.
    expect(overlay.querySelector("#tab-advanced .tab-count")!.textContent).toBe("8");

    overlay
      .querySelector<HTMLElement>("#tab-advanced")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(overlay.querySelector("#panel-advanced")!.hasAttribute("hidden")).toBe(false);
    expect(overlay.querySelector("#panel-basic")!.hasAttribute("hidden")).toBe(true);
    expect(overlay.querySelector("#tab-advanced")!.getAttribute("aria-selected")).toBe("true");
    expect(overlay.querySelector("#btn-export")).not.toBeNull();
    overlay.remove();
  });

  it("switches tabs with arrow keys", () => {
    const overlay = openSettings();
    overlay
      .querySelector<HTMLElement>("#tab-basic")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(overlay.querySelector("#panel-appearance")!.hasAttribute("hidden")).toBe(false);
    expect(overlay.querySelector("#tab-appearance")!.getAttribute("aria-selected")).toBe("true");
    overlay
      .querySelector<HTMLElement>("#tab-appearance")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(overlay.querySelector("#panel-advanced")!.hasAttribute("hidden")).toBe(false);
    overlay.remove();
  });

  it("preserves typed values when switching tabs", () => {
    const overlay = openSettings();
    const work = overlay.querySelector<HTMLInputElement>("#set-work")!;
    work.value = "33";
    overlay
      .querySelector<HTMLElement>("#tab-advanced")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    overlay
      .querySelector<HTMLElement>("#tab-basic")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(overlay.querySelector<HTMLInputElement>("#set-work")!.value).toBe("33");
    overlay.remove();
  });
});

describe("appearance settings (0085)", () => {
  const openSettings = (): HTMLElement => {
    document
      .querySelector<HTMLElement>('[data-action="open-settings"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return document.querySelector<HTMLElement>(".overlay")!;
  };

  it("lists the built-in themes and applies theme, mode, and font live", async () => {
    const state = await import("./state");
    const overlay = openSettings();
    const themeSelect = overlay.querySelector<HTMLSelectElement>("#set-theme")!;
    expect(themeSelect.options.length).toBeGreaterThanOrEqual(6);
    expect(themeSelect.value).toBe("forest");

    themeSelect.value = "tide";
    themeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(state.settings.themeId).toBe("tide");
    expect(document.documentElement.dataset.theme).toBe("night");
    expect(document.getElementById("theme-vars")).not.toBeNull();

    const modeSelect = overlay.querySelector<HTMLSelectElement>("#set-mode")!;
    modeSelect.value = "light";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(state.settings.themeMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("day");

    const fontSelect = overlay.querySelector<HTMLSelectElement>("#set-font")!;
    fontSelect.value = "mono";
    fontSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(state.settings.font).toBe("mono");
    expect(document.documentElement.dataset.font).toBe("mono");

    overlay.remove();
  });

  it("removes a custom theme and falls back to Forest", async () => {
    const state = await import("./state");
    const { sanitizeTheme } = await import("./theme");
    const custom = sanitizeTheme({
      name: "Mine",
      dark: { bg: "#101010" },
      light: { bg: "#fafafa" },
    })!;
    const { setSettings } = state;
    setSettings({
      ...state.settings,
      customThemes: [custom],
      themeId: custom.id,
      themeMode: "dark",
    });

    const overlay = openSettings();
    const removeBtn = overlay.querySelector<HTMLButtonElement>("#btn-theme-remove")!;
    expect(removeBtn.hidden).toBe(false);
    removeBtn.click();

    expect(state.settings.themeId).toBe("forest");
    expect(state.settings.customThemes).toHaveLength(0);
    overlay.remove();
  });
});

describe("rest background settings (0086)", () => {
  const openAppearance = (): HTMLElement => {
    document
      .querySelector<HTMLElement>('[data-action="open-settings"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const overlay = document.querySelector<HTMLElement>(".overlay")!;
    overlay
      .querySelector<HTMLElement>("#tab-appearance")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return overlay;
  };

  it("offers night and day pickers and applies a built-in to each slot", async () => {
    const state = await import("./state");
    const overlay = openAppearance();
    const darkPicker = overlay.querySelector<HTMLElement>("#bg-picker-dark")!;
    expect(darkPicker.querySelectorAll(".bg-tile").length).toBeGreaterThanOrEqual(7);
    expect(darkPicker.textContent).toContain("None");
    expect(darkPicker.textContent).toContain("Forest stream");

    darkPicker.querySelector<HTMLButtonElement>('[data-bg-id="ocean-waves"]')!.click();
    expect(state.settings.restBackgroundDark).toBe("ocean-waves");

    const lightPicker = overlay.querySelector<HTMLElement>("#bg-picker-light")!;
    lightPicker.querySelector<HTMLButtonElement>('[data-bg-id="meadow"]')!.click();
    expect(state.settings.restBackgroundLight).toBe("meadow");
    overlay.remove();
  });

  it("updates the dim slider and preview live", async () => {
    const state = await import("./state");
    const overlay = openAppearance();
    overlay
      .querySelector<HTMLElement>("#bg-picker-dark")!
      .querySelector<HTMLButtonElement>('[data-bg-id="forest-stream"]')!
      .click();

    const dim = overlay.querySelector<HTMLInputElement>("#set-bg-dim")!;
    dim.value = "80";
    dim.dispatchEvent(new Event("input", { bubbles: true }));
    expect(state.settings.restBackgroundDim).toBe(80);
    expect(overlay.querySelector("#bg-dim-out")!.textContent).toBe("80%");
    expect(
      overlay.querySelector<HTMLElement>("#bg-preview")!.style.getPropertyValue("--rest-dim"),
    ).toBe("0.8");
    overlay.remove();
  });
});

describe("flowtime vs pomodoro explainer (0077)", () => {
  it("opens the chooser with a 'What's the difference?' control", () => {
    addTask("Deep work");
    document
      .querySelector<HTMLElement>(".task-start [data-action='start']")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const overlay = document.querySelector<HTMLElement>(".overlay")!;
    expect(overlay.querySelector('[data-tech="learn"]')!.textContent).toContain(
      "What's the difference?",
    );
    overlay.remove();
  });

  it("shows the explainer without closing the chooser", () => {
    addTask("Deep work");
    document
      .querySelector<HTMLElement>(".task-start [data-action='start']")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-tech="learn"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const overlays = document.querySelectorAll<HTMLElement>(".overlay");
    expect(overlays.length).toBe(2); // chooser stays underneath
    const explainer = overlays[overlays.length - 1];
    expect(explainer.textContent).toContain("ultradian");
    expect(explainer.textContent).toContain("Flowtime");
    expect(explainer.textContent).toContain("Pomodoro");
    expect(explainer.querySelector("#explain-ok")).not.toBeNull();
    explainer.remove();
    overlays[0].remove();
  });
});

describe("add-and-focus (0080)", () => {
  it("adds the typed task and opens the session chooser in one click", async () => {
    const { state } = await import("./state");
    const input = document.querySelector<HTMLInputElement>("#task-title")!;
    input.value = "Deep work";
    document
      .getElementById("add-and-focus")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].title).toBe("Deep work");
    const overlay = document.querySelector<HTMLElement>(".overlay")!;
    expect(overlay.textContent).toContain("Start a session");
    expect(overlay.textContent).toContain("Deep work");
    expect(overlay.querySelector('[data-tech="flowtime"]')).not.toBeNull();
    overlay.remove();
  });

  it("does nothing when the input is empty", async () => {
    const { state } = await import("./state");
    document
      .getElementById("add-and-focus")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(state.tasks).toHaveLength(0);
    expect(document.querySelector(".overlay")).toBeNull();
  });
});

describe("estimate cap (0013)", () => {
  it("clamps the estimate input to 300 minutes", async () => {
    const { state } = await import("./state");
    const { setEstimate } = await import("./actions");
    addTask("Estimate me");
    const taskId = state.tasks[0].id;

    setEstimate(taskId, "450");
    expect(state.tasks[0].estimatedMin).toBe(300);
    setEstimate(taskId, "42");
    expect(state.tasks[0].estimatedMin).toBe(42);
    setEstimate(taskId, "");
    expect(state.tasks[0].estimatedMin).toBeNull();
  });

  it("renders the placeholder text and max cap on the row input", async () => {
    const { setSettings } = await import("./state");
    const { DEFAULT_SETTINGS } = await import("./types");
    setSettings({ ...DEFAULT_SETTINGS, showEstimates: true });
    addTask("Estimate me");
    const input = document.querySelector<HTMLInputElement>(".task .est-input")!;
    expect(input.placeholder).toBe("estimate (min)");
    expect(input.max).toBe("300");
    // The estimate field lives in the right-aligned group, not the meta row.
    expect(input.closest(".task-right")).not.toBeNull();
    expect(input.closest(".task-meta")).toBeNull();
  });
});

describe("inline priority/quadrant editing (0083)", () => {
  it("cycles the priority pill and persists it", async () => {
    const { state } = await import("./state");
    addTask("Alpha");
    const pill = document.querySelector<HTMLElement>('[data-action="cycle-priority"]')!;
    expect(pill.textContent).toBe("P2");

    pill.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.tasks[0].priority).toBe(3);
    expect(document.querySelector('[data-action="cycle-priority"]')!.textContent).toBe("P3");
  });

  it("cycles the quadrant pill and persists it", async () => {
    const { state } = await import("./state");
    addTask("Alpha");
    const pill = document.querySelector<HTMLElement>('[data-action="cycle-quadrant"]')!;
    expect(pill.textContent).toContain("Not urgent · Important");

    pill.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.tasks[0].quadrant).toBe("q3");
    expect(document.querySelector('[data-action="cycle-quadrant"]')!.textContent).toContain(
      "Urgent · Not important",
    );
  });

  it("wraps priority 5→1 and quadrant q4→q1", async () => {
    const { state } = await import("./state");
    const { render } = await import("./views");
    addTask("Alpha");
    state.tasks[0].priority = 5;
    state.tasks[0].quadrant = "q4";
    render();

    document
      .querySelector<HTMLElement>('[data-action="cycle-priority"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.tasks[0].priority).toBe(1);

    document
      .querySelector<HTMLElement>('[data-action="cycle-quadrant"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.tasks[0].quadrant).toBe("q1");
  });
});

describe("rest guide (0078)", () => {
  it("shows the Learn control on the running break and opens the guide", async () => {
    const { setBreakState } = await import("./state");
    const { render } = await import("./views");
    setBreakState({
      startedAt: Date.now(),
      endsAt: Date.now() + 5 * 60 * 1000,
      taskId: "t1",
      technique: "flowtime",
      done: false,
    });
    render();

    const learn = document.querySelector<HTMLElement>('[data-action="rest-guide"]')!;
    expect(learn.textContent).toContain("How to actually rest?");
    learn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const overlay = document.querySelector<HTMLElement>(".overlay")!;
    expect(overlay.textContent).toContain("How to actually rest");
    expect(overlay.textContent).toContain("Move");
    expect(overlay.textContent).toContain("Breathe");
    overlay.remove();
    setBreakState(null);
    render();
  });

  it("keeps the break countdown running while the guide is open", async () => {
    const { setBreakState } = await import("./state");
    const { render } = await import("./views");
    setBreakState({
      startedAt: Date.now(),
      endsAt: Date.now() + 5 * 60 * 1000,
      taskId: "t1",
      technique: "pomodoro",
      done: false,
    });
    render();

    document
      .querySelector<HTMLElement>('[data-action="rest-guide"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelectorAll<HTMLElement>(".overlay").length).toBe(1);
    // The session view behind the overlay is still a break with a clock.
    const overlay = document.querySelector<HTMLElement>(".overlay")!;
    overlay.remove();
    expect(document.querySelector("#app")!.textContent).toContain("Break");
    setBreakState(null);
    render();
  });

  it("labels break controls as continue focusing, done, and a question", async () => {
    const { setBreakState } = await import("./state");
    const { render } = await import("./views");
    setBreakState({
      startedAt: Date.now(),
      endsAt: Date.now() + 5 * 60 * 1000,
      taskId: "t1",
      technique: "flowtime",
      done: false,
    });
    render();

    const start = document.querySelector<HTMLElement>('[data-action="start-next"]')!;
    expect(start.textContent).toContain("Continue focusing");
    expect(start.querySelector("svg")).not.toBeNull();

    const done = document.querySelector<HTMLElement>('[data-action="skip-break"]')!;
    expect(done.textContent).toContain("Done");
    expect(done.querySelector("svg")).not.toBeNull();

    const learn = document.querySelector<HTMLElement>('[data-action="rest-guide"]')!;
    expect(learn.textContent).toContain("How to actually rest?");
    expect(learn.classList.contains("aux-action")).toBe(true);
    setBreakState(null);
    render();
  });
});

describe("rest backgrounds (0086)", () => {
  const breakState = (): {
    startedAt: number;
    endsAt: number;
    taskId: string;
    technique: "flowtime";
    done: boolean;
  } => ({
    startedAt: Date.now(),
    endsAt: Date.now() + 5 * 60 * 1000,
    taskId: "t1",
    technique: "flowtime",
    done: false,
  });

  it("renders no background layer by default", async () => {
    const { setBreakState } = await import("./state");
    const { render } = await import("./views");
    setBreakState(breakState());
    render();
    expect(document.querySelector(".rest-bg")).toBeNull();
    setBreakState(null);
    render();
  });

  it("shows the night image behind the break clock with dim and blur", async () => {
    const stateModule = await import("./state");
    const { render } = await import("./views");
    stateModule.setSettings({
      ...stateModule.settings,
      restBackgroundDark: "ocean-waves",
      restBackgroundDim: 70,
      restBackgroundBlur: 4,
    });
    stateModule.setBreakState(breakState());
    render();

    const bg = document.querySelector<HTMLElement>(".rest-bg")!;
    expect(bg).not.toBeNull();
    expect(bg.getAttribute("aria-hidden")).toBe("true");
    const image = bg.querySelector<HTMLElement>(".rest-bg-image")!;
    expect(image.style.backgroundImage).toContain("backgrounds/ocean-waves.svg");
    expect(bg.style.getPropertyValue("--rest-dim")).toBe("0.7");
    expect(bg.style.getPropertyValue("--rest-blur")).toBe("4px");

    stateModule.setBreakState(null);
    render();
  });

  it("uses the light image when the theme is in day mode", async () => {
    const stateModule = await import("./state");
    const { render } = await import("./views");
    stateModule.setSettings({
      ...stateModule.settings,
      themeMode: "light",
      restBackgroundDark: "ocean-waves",
      restBackgroundLight: "meadow",
    });
    stateModule.setBreakState(breakState());
    render();

    const image = document.querySelector<HTMLElement>(".rest-bg-image")!;
    expect(image.style.backgroundImage).toContain("backgrounds/meadow.svg");

    stateModule.setBreakState(null);
    render();
  });
});

describe("completed section (0075)", () => {
  it("folds completed tasks into a collapsed section and expands on click", async () => {
    const { state } = await import("./state");
    addTask("Buy milk");
    const taskId = state.tasks[0].id;
    const btn = document.querySelector<HTMLElement>(`.check[data-id="${taskId}"]`)!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(220);

    const collapsed = document.querySelector("#app")!.innerHTML;
    expect(collapsed).toContain("done-section");
    expect(collapsed).toContain("Completed");
    expect(collapsed).not.toContain('id="done-list"'); // collapsed → no list rendered

    document
      .querySelector<HTMLElement>('[data-action="toggle-section"][data-section="done"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const expanded = document.querySelector("#app")!.innerHTML;
    expect(expanded).toContain("done-list");
    expect(expanded).toContain("Buy milk");
  });

  it("reopening a completed task moves it back to the open list", async () => {
    const { state } = await import("./state");
    addTask("Pay rent");
    const taskId = state.tasks[0].id;
    document
      .querySelector<HTMLElement>(`.check[data-id="${taskId}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(220);
    // Expand the section so the done row is in the DOM.
    document
      .querySelector<HTMLElement>('[data-action="toggle-section"][data-section="done"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>(`.check[data-id="${taskId}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const html = document.querySelector("#app")!.innerHTML;
    expect(state.tasks[0].done).toBe(false);
    expect(html).toContain("Pay rent");
    expect(html).not.toContain("done-section");
  });
});

describe("three-dot menu on compact rows", () => {
  it("shows and opens the ⋯ menu on quick tasks", async () => {
    const { state } = await import("./state");
    const { render } = await import("./views");
    addTask("Quickie");
    state.tasks[0].quick = true;
    render();

    const item = document.querySelector<HTMLElement>(".quick-item")!;
    const btn = item.querySelector<HTMLElement>('[data-action="open-menu"]')!;
    expect(btn).not.toBeNull();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const menu = document.querySelector<HTMLElement>("[data-menu]")!;
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain("Edit");
    expect(menu.textContent).toContain("Repeat");
  });

  it("shows and opens the ⋯ menu on tasks planned for today", async () => {
    const { state } = await import("./state");
    const { render } = await import("./views");
    addTask("Today's thing");
    state.tasks[0].plannedFor = Date.now();
    render();

    const item = document.querySelector<HTMLElement>(".quick-item")!;
    const btn = item.querySelector<HTMLElement>('[data-action="open-menu"]')!;
    expect(btn).not.toBeNull();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const menu = document.querySelector<HTMLElement>("[data-menu]")!;
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain("Defer");
  });
});

describe("mark done from session view", () => {
  const startFlowtime = async (): Promise<string> => {
    const { state } = await import("./state");
    addTask("Write report");
    const taskId = state.tasks[0].id;
    document
      .querySelector<HTMLElement>(".task-start [data-action='start']")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-tech="flowtime"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return taskId;
  };

  it("marks the current task done and finishes the session", async () => {
    const { state } = await import("./state");
    const taskId = await startFlowtime();
    const mark = document.querySelector<HTMLElement>(
      '.session-controls [data-action="mark-done"]',
    )!;
    expect(mark).not.toBeNull();
    expect(mark.textContent).toContain("Mark done");

    mark.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(state.tasks.find((t) => t.id === taskId)!.done).toBe(true);
    expect(state.activeSessionId).toBeNull();
    expect(state.sessions.find((s) => s.taskId === taskId)!.status).toBe("done");
    expect(document.querySelector("#undo-finish")).not.toBeNull();
  });

  it("marks the current task done and finishes from focus mode", async () => {
    const { state } = await import("./state");
    const taskId = await startFlowtime();
    document
      .querySelector<HTMLElement>('[data-action="toggle-focus"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const mark = document.querySelector<HTMLElement>(
      '[data-action="mark-done"][data-id="' + taskId + '"]',
    )!;
    expect(mark).not.toBeNull();
    mark.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(state.tasks.find((t) => t.id === taskId)!.done).toBe(true);
    expect(state.activeSessionId).toBeNull();
    expect(state.sessions.find((s) => s.taskId === taskId)!.status).toBe("done");
  });
});

describe("cancel session", () => {
  const startFlowtime = async (): Promise<string> => {
    const { state } = await import("./state");
    addTask("Write report");
    const taskId = state.tasks[0].id;
    document
      .querySelector<HTMLElement>(".task-start [data-action='start']")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-tech="flowtime"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return taskId;
  };

  it("cancels the session without recording it and restores it on undo", async () => {
    const { state } = await import("./state");
    const taskId = await startFlowtime();
    const before = state.sessions.length;
    expect(state.activeSessionId).not.toBeNull();

    document
      .querySelector<HTMLElement>('[data-action="cancel-session"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(state.activeSessionId).toBeNull();
    expect(state.sessions).toHaveLength(before - 1);
    expect(state.tasks.find((t) => t.id === taskId)!.done).toBe(false);
    expect(document.querySelector("#undo-action")).not.toBeNull();

    document
      .querySelector<HTMLElement>("#undo-action")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.sessions).toHaveLength(before);
    expect(state.activeSessionId).not.toBeNull();
  });
});

describe("in-session quick add (0082)", () => {
  const startFlowtime = async (): Promise<string> => {
    const { state } = await import("./state");
    addTask("Write report");
    const taskId = state.tasks[0].id;
    document
      .querySelector<HTMLElement>(".task-start [data-action='start']")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-tech="flowtime"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return taskId;
  };

  it("captures a thought into the board without leaving the session", async () => {
    const { state } = await import("./state");
    await startFlowtime();
    expect(document.querySelector(".clock")).not.toBeNull();

    const input = document.querySelector<HTMLInputElement>("#capture-thought")!;
    expect(input).not.toBeNull();
    const captureSection = input.closest<HTMLElement>(".capture-section")!;
    expect(captureSection.textContent).toContain("Remembered something you need to do?");
    input.value = "Buy milk #errands !1";
    document
      .querySelector<HTMLFormElement>("#capture-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(state.tasks).toHaveLength(2);
    const captured = state.tasks[1];
    expect(captured.title).toBe("Buy milk");
    expect(captured.tags).toEqual(["errands"]);
    expect(captured.priority).toBe(1);
    expect(captured.quadrant).toBe("q2");
    // The session is untouched and still on screen.
    expect(state.activeSessionId).not.toBeNull();
    expect(document.querySelector(".clock")).not.toBeNull();
    expect(document.querySelector("#capture-confirm")!.classList.contains("visible")).toBe(true);
  });

  it("focuses each capture field via keyboard shortcuts", async () => {
    const { setSettings } = await import("./state");
    const { DEFAULT_SETTINGS } = await import("./types");
    setSettings({ ...DEFAULT_SETTINGS, distractionLogEnabled: true });
    await startFlowtime();

    const note = document.querySelector<HTMLInputElement>("#note-text")!;
    const task = document.querySelector<HTMLInputElement>("#capture-thought")!;
    const dist = document.querySelector<HTMLInputElement>("#distraction-text")!;
    expect(note).not.toBeNull();
    expect(task).not.toBeNull();
    expect(dist).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    expect(document.activeElement).toBe(task);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    expect(document.activeElement).toBe(note);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    expect(document.activeElement).toBe(dist);
  });

  it("toggles focus mode from the corner toggle", async () => {
    await startFlowtime();
    const toggle = document.querySelector<HTMLElement>(
      '[data-action="toggle-focus"].corner-toggle',
    )!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".session-main.focus")).not.toBeNull();
    const onToggle = document.querySelector<HTMLElement>(
      '[data-action="toggle-focus"].corner-toggle',
    )!;
    expect(onToggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("focus mode drops the exit button and docks mark-done above the distraction field", async () => {
    const { setSettings } = await import("./state");
    const { DEFAULT_SETTINGS } = await import("./types");
    setSettings({ ...DEFAULT_SETTINGS, distractionLogEnabled: true });
    await startFlowtime();
    document
      .querySelector<HTMLElement>('[data-action="toggle-focus"].corner-toggle')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".focus-exit")).toBeNull();
    const mark = document.querySelector<HTMLElement>('[data-action="mark-done"]')!;
    const dist = document.querySelector<HTMLElement>("#distraction-text")!;
    expect(mark).not.toBeNull();
    expect(dist).not.toBeNull();
    expect(mark.compareDocumentPosition(dist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The fields live in the bottom-docked container.
    expect(document.querySelector(".session-bottom")).not.toBeNull();
  });
});

describe("distraction log (0081)", () => {
  const startFlowtime = async (): Promise<string> => {
    const { state } = await import("./state");
    addTask("Write report");
    const taskId = state.tasks[0].id;
    document
      .querySelector<HTMLElement>(".task-start [data-action='start']")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-tech="flowtime"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return taskId;
  };

  it("hides the control until the setting is enabled", async () => {
    const { state } = await import("./state");
    await startFlowtime();
    expect(document.querySelector("#distraction-form")).toBeNull();
    expect(state.distractions).toEqual([]);
  });

  it("logs a distraction during a session without disturbing it", async () => {
    const { setSettings, state } = await import("./state");
    const { DEFAULT_SETTINGS } = await import("./types");
    setSettings({ ...DEFAULT_SETTINGS, distractionLogEnabled: true });
    const taskId = await startFlowtime();

    const input = document.querySelector<HTMLInputElement>("#distraction-text")!;
    expect(input).not.toBeNull();
    const distractionSection = input.closest<HTMLElement>(".capture-section")!;
    expect(distractionSection.textContent).toContain("Distracted? Park it here.");
    input.value = "check the parcel code";
    document
      .querySelector<HTMLFormElement>("#distraction-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(state.distractions).toHaveLength(1);
    expect(state.distractions[0].text).toBe("check the parcel code");
    expect(state.distractions[0].taskId).toBe(taskId);
    // Session untouched and still showing the clock.
    expect(state.activeSessionId).not.toBeNull();
    expect(document.querySelector(".clock")).not.toBeNull();
  });

  it("shows the log in history and clears it", async () => {
    const { setSettings, state } = await import("./state");
    const { DEFAULT_SETTINGS } = await import("./types");
    setSettings({ ...DEFAULT_SETTINGS, distractionLogEnabled: true });
    await startFlowtime();

    document.querySelector<HTMLInputElement>("#distraction-text")!.value = "email Laura";
    document
      .querySelector<HTMLFormElement>("#distraction-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    // Leave the session (cancel returns to the board) so history is reachable.
    document
      .querySelector<HTMLElement>('[data-action="cancel-session"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    document
      .querySelector<HTMLElement>('[data-action="view-history"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-history-tab="distractions"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector("#app")!.textContent).toContain("Distraction log");
    expect(document.querySelector("#app")!.textContent).toContain("email Laura");

    document
      .querySelector<HTMLElement>('[data-action="clear-distractions"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.distractions).toHaveLength(0);
  });

  it("shows an empty Distractions tab with no logged entries", async () => {
    document
      .querySelector<HTMLElement>('[data-action="view-history"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector('[data-history-tab="distractions"]')).not.toBeNull();
    document
      .querySelector<HTMLElement>('[data-history-tab="distractions"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector("#app")!.textContent).toContain("Distraction log");
    expect(document.querySelector("#app")!.textContent).toContain("Capture distractions");
  });
});

describe("switch task mid-session (0084)", () => {
  const startFlowtime = async (): Promise<string> => {
    const { state } = await import("./state");
    addTask("Write report");
    const taskId = state.tasks[0].id;
    document
      .querySelector<HTMLElement>(".task-start [data-action='start']")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-tech="flowtime"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return taskId;
  };

  it("shows a switch button on the session screen", async () => {
    await startFlowtime();
    const btn = document.querySelector<HTMLElement>('[data-action="switch-task"]')!;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("Switch task");
  });

  it("places the switch button under the phase indicator in the header", async () => {
    await startFlowtime();
    const header = document.querySelector<HTMLElement>(".session-header")!;
    const title = header.querySelector<HTMLElement>(".session-task-title")!;
    const phase = header.querySelector<HTMLElement>(".session-phase")!;
    const sw = header.querySelector<HTMLElement>('[data-action="switch-task"]')!;
    expect(phase).not.toBeNull();
    expect(sw).not.toBeNull();
    expect(title.compareDocumentPosition(phase) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(phase.compareDocumentPosition(sw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not in the corner toggles.
    expect(
      document
        .querySelector<HTMLElement>(".corner-toggles")!
        .querySelector('[data-action="switch-task"]'),
    ).toBeNull();
  });

  it("re-points the session at another task without touching the clock", async () => {
    const { state } = await import("./state");
    addTask("Write report");
    addTask("Buy milk");
    const taskB = state.tasks[1].id;
    document
      .querySelector<HTMLElement>(".task-start [data-action='start']")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-tech="flowtime"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const startedAt = state.sessions.find((s) => s.id === state.activeSessionId)!.startedAt;
    expect(document.querySelector(".clock")).not.toBeNull();

    document
      .querySelector<HTMLElement>('[data-action="switch-task"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const item = document.querySelector<HTMLElement>(`.switch-item[data-switch="${taskB}"]`)!;
    expect(item).not.toBeNull();
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const session = state.sessions.find((s) => s.id === state.activeSessionId)!;
    expect(session.taskId).toBe(taskB);
    expect(session.status).toBe("running");
    expect(session.startedAt).toBe(startedAt);
    // The header now shows the new task and mark-done targets it.
    expect(document.querySelector(".session-task-title")!.textContent).toBe("Buy milk");
    expect(document.querySelector<HTMLElement>('[data-action="mark-done"]')!.dataset.id).toBe(
      taskB,
    );
    expect(document.querySelector(".clock")).not.toBeNull();
    const toasts = Array.from(document.querySelectorAll(".toast-text")).map(
      (t) => t.textContent ?? "",
    );
    expect(toasts.some((t) => t.includes("Now working on"))).toBe(true);
  });

  it("creates a brand-new task from the picker and attaches it", async () => {
    const { state } = await import("./state");
    const taskA = await startFlowtime();
    expect(state.tasks).toHaveLength(1);

    document
      .querySelector<HTMLElement>('[data-action="switch-task"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>("#switch-new")!;
    input.value = "Design mockups #design !1";
    document
      .querySelector<HTMLElement>("#switch-new-add")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const created = state.tasks.find((t) => t.title === "Design mockups");
    expect(created).not.toBeUndefined();
    expect(state.tasks[0].id).toBe(taskA); // old task left untouched
    const session = state.sessions.find((s) => s.id === state.activeSessionId)!;
    expect(session.taskId).toBe(created!.id);
    expect(document.querySelector(".session-task-title")!.textContent).toBe("Design mockups");
  });

  it("confirms before switching to a completed task", async () => {
    const { state } = await import("./state");
    addTask("Write report");
    addTask("Ship the docs");
    const taskA = state.tasks[0].id;
    const taskC = state.tasks[1].id;
    document
      .querySelector<HTMLElement>(".task-start [data-action='start']")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-tech="flowtime"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    state.tasks[1].done = true;
    state.tasks[1].doneAt = Date.now();

    document
      .querySelector<HTMLElement>('[data-action="switch-task"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const item = document.querySelector<HTMLElement>(`.switch-item.done[data-switch="${taskC}"]`)!;
    expect(item).not.toBeNull();
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Not applied until confirmed.
    expect(state.sessions.find((s) => s.id === state.activeSessionId)!.taskId).toBe(taskA);
    expect(document.querySelector("#switch-done-ok")).not.toBeNull();
    document
      .querySelector<HTMLElement>("#switch-done-ok")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.sessions.find((s) => s.id === state.activeSessionId)!.taskId).toBe(taskC);
  });

  it("hides the switch button in focus mode", async () => {
    await startFlowtime();
    expect(document.querySelector('[data-action="switch-task"]')).not.toBeNull();
    document
      .querySelector<HTMLElement>('[data-action="toggle-focus"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector('[data-action="switch-task"]')).toBeNull();
    expect(document.querySelector(".session-main.focus")).not.toBeNull();
  });

  it("closes an open dialog with Esc before exiting focus mode", async () => {
    const { state } = await import("./state");
    await startFlowtime();
    document
      .querySelector<HTMLElement>('[data-action="toggle-focus"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Open the shortcuts cheat sheet (reachable in focus mode).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect(document.querySelector(".overlay")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector(".overlay")).toBeNull();
    expect(document.querySelector(".session-main.focus")).not.toBeNull();
    expect(state.activeSessionId).not.toBeNull();
  });
});

describe("deferred tasks stay out of quick runs", () => {
  it("keeps a deferred quick task out of the Quick section", async () => {
    const { state } = await import("./state");
    const { render } = await import("./views");
    addTask("Do it soon");
    addTask("Right now");
    state.tasks[0].quick = true;
    state.tasks[0].plannedFor = Date.now() + 86400000; // tomorrow → deferred
    state.tasks[1].quick = true; // stays in Quick
    render();

    const quickBody = document.querySelector<HTMLElement>("#section-quick-body")!;
    const deferredBody = document.querySelector<HTMLElement>("#section-later-body")!;
    expect(quickBody).not.toBeNull();
    expect(deferredBody).not.toBeNull();
    // Only the Later section shows the deferred task, and without a run button.
    expect(quickBody.textContent).not.toContain("Do it soon");
    expect(quickBody.textContent).toContain("Right now");
    expect(deferredBody.textContent).toContain("Do it soon");
    expect(deferredBody.querySelector('[data-action="quick-run"]')).toBeNull();
  });

  it("skips deferred tasks when advancing a quick run", async () => {
    const { state } = await import("./state");
    const { render } = await import("./views");
    addTask("Quick A");
    addTask("Deferred B");
    state.tasks[0].quick = true;
    state.tasks[1].quick = true;
    state.tasks[1].plannedFor = Date.now() + 86400000; // tomorrow
    render();

    const runButtons = document.querySelectorAll<HTMLElement>(
      "#section-quick-body [data-action='quick-run']",
    );
    expect(runButtons.length).toBe(1);
    runButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // The run starts on the only non-deferred quick task.
    expect(document.querySelector(".session-task-title")!.textContent).toBe("Quick A");
    expect(document.querySelector('[data-action="quick-next"]')).not.toBeNull();

    document
      .querySelector<HTMLElement>('[data-action="quick-next"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // The run ends instead of advancing onto the deferred task.
    expect(document.querySelector('[data-action="quick-next"]')).toBeNull();
    expect(state.tasks[0].done).toBe(true);
    expect(state.tasks[1].done).toBe(false);
  });
});

describe("board section consistency", () => {
  it("titles the open tasks section and drops legacy section classes", () => {
    addTask("Alpha");
    addTask("Beta");
    const html = document.querySelector("#app")!.innerHTML;
    expect(html).toContain('<span class="section-title">Open</span>');
    expect(html).not.toContain("quick-section");
    expect(html).not.toContain("plan-section");
    // Rows still live in the shared task list.
    expect(document.querySelectorAll(".open-section .task").length).toBe(2);
  });

  it("renders quick tasks inside the shared section card", async () => {
    const { state } = await import("./state");
    const { render } = await import("./views");
    addTask("Quickie");
    state.tasks[0].quick = true;
    render();
    const html = document.querySelector("#app")!.innerHTML;
    expect(html).toContain("Quick tasks");
    expect(document.querySelectorAll(".section").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the completed section as a card when unfolded", async () => {
    const { state } = await import("./state");
    addTask("Buy milk");
    const taskId = state.tasks[0].id;
    document
      .querySelector<HTMLElement>(`.check[data-id="${taskId}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(220);
    document
      .querySelector<HTMLElement>('[data-action="toggle-section"][data-section="done"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const section = document.querySelector<HTMLElement>(".done-section")!;
    expect(section.classList.contains("section")).toBe(true);
    expect(section.querySelector("#done-list")).not.toBeNull();
  });

  it("places the play button to the right of the row actions", () => {
    addTask("Alpha");
    const li = document.querySelector<HTMLElement>(".open-section .task")!;
    const children = Array.from(li.children);
    const actionsIdx = children.findIndex((c) => c.classList.contains("task-actions"));
    const startIdx = children.findIndex((c) => c.classList.contains("task-start"));
    expect(actionsIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(actionsIdx);
  });

  it("shows quadrant and priority in compact today rows", async () => {
    const { state } = await import("./state");
    const { render } = await import("./views");
    addTask("Today's thing");
    state.tasks[0].plannedFor = Date.now();
    render();
    const meta = document.querySelector<HTMLElement>(".section .quick-item .task-meta")!;
    expect(meta.textContent).toContain("P2");
    expect(meta.textContent).toContain("Important");
  });
});
