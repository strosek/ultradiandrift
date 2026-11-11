import { expect, test } from "@playwright/test";

test("adds a task and strips tags", async ({ page }) => {
  await page.goto("/");
  await page.fill("#task-title", "Buy milk #errands");
  await page.click("#add-task");
  await expect(page.locator(".task-list .task")).toHaveCount(1);
  await expect(page.locator(".task-list .task-title")).toContainText("Buy milk");
  await expect(page.locator(".task-list .tag-chip")).toContainText("#errands");
});

test("natural-language quick-add parses date, time, and priority", async ({ page }) => {
  await page.goto("/");
  await page.fill("#task-title", "review PRs tomorrow 9am !1");
  await page.click("#add-task");
  await expect(page.getByText("review PRs")).toBeVisible();
  await expect(page.locator(".section.deferred")).toContainText("review PRs");
});

test("starts, pauses, resumes, and finishes a pomodoro session", async ({ page }) => {
  await page.goto("/");
  await page.fill("#task-title", "Deep work");
  await page.click("#add-task");
  await page.hover(".task");
  await page.click('.task [data-action="start"]');
  await page.click('[data-tech="pomodoro"]');
  await expect(page.locator(".clock")).toBeVisible();
  await page.click('[data-action="pause"]');
  await expect(page.locator('[data-action="resume"]')).toBeVisible();
  await page.click('[data-action="resume"]');
  await page.click('[data-action="finish"]');
  await expect(page.locator(".session-task-title")).toContainText("Break");
});

test("recurring task reopens into the Later list when completed", async ({ page }) => {
  await page.goto("/");
  await page.fill("#task-title", "Review email");
  await page.click("#add-task");

  // Set a daily recurrence via the row menu -> Repeats dialog.
  await page.hover(".task");
  await page.click('.task [data-action="open-menu"]');
  await page.click('[data-action="repeats"]');
  await page.selectOption("#recur-every", "daily");
  await page.click("#recur-save");

  // The recurring task is scheduled for tomorrow, so it lands in the Later list.
  await expect(page.locator(".section.deferred")).toContainText("Review email");

  // Completing it reopens it for its next occurrence (still in Later).
  await page.click(".section.deferred .check");
  await expect(page.locator(".section.deferred")).toContainText("Review email");
  await expect(page.locator(".section.deferred .recur-badge")).toHaveCount(1);
});

test("search filters the board", async ({ page }) => {
  await page.goto("/");
  await page.fill("#task-title", "Alpha");
  await page.click("#add-task");
  await page.fill("#task-title", "Beta");
  await page.click("#add-task");
  await page.fill("#task-search", "Alpha");
  await expect(page.locator(".task-list .task")).toHaveCount(1);
  await expect(page.locator(".task-list .task-title")).toContainText("Alpha");
});

test("groups tasks by priority and reassigns priority by dragging", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#task-priority", "1");
  await page.fill("#task-title", "Alpha");
  await page.click("#add-task");
  await page.selectOption("[data-group]", "priority");

  await expect(page.locator(".task-group.p1")).toContainText("Alpha");
  await page.locator(".task-group.p1 .task .grip").dragTo(page.locator(".task-group.p3"));

  await expect(page.locator(".task-group.p3")).toContainText("Alpha");
  await expect(page.locator(".task-group.p1")).not.toContainText("Alpha");
});
