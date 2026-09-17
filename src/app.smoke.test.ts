// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Boots the real app entry point and asserts the initial board renders and the
 * module graph (state → views → actions ↔ repaint → events) wires up without
 * runtime errors.
 */
describe("app bootstrap", () => {
  beforeAll(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("renders the board with the expected shell", async () => {
    await import("./main");

    expect(document.title).toBe("UltradianDrift");
    const html = document.querySelector("#app")!.innerHTML;
    expect(html).toContain("app-header");
    expect(html).toContain("What do you need to do");
  });

  it("adds a task through the UI event path", async () => {
    await import("./main");
    const { state } = await import("./state");

    const titleInput = document.querySelector<HTMLInputElement>("#task-title")!;
    titleInput.value = "Buy milk #errands";
    document.getElementById("add-task")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].title).toBe("Buy milk");
    expect(state.tasks[0].tags).toEqual(["errands"]);
    expect(document.querySelector("#app")!.innerHTML).toContain("Buy milk");
  });

  it("toggles the theme from the header button", async () => {
    await import("./main");
    const state = await import("./state");

    const before = state.settings.themeMode;
    const btn = document.querySelector<HTMLElement>('[data-action="toggle-theme"]')!;
    expect(btn.getAttribute("aria-pressed")).toBe(before === "dark" ? "true" : "false");

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.settings.themeMode).not.toBe(before);
    expect(document.documentElement.dataset.theme).toBe(
      state.settings.themeMode === "light" ? "day" : "night",
    );
  });
});
