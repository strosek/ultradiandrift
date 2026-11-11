# 0088 — Group tasks by priority or quadrant, drag to reassign

Status: done

## Goal

The board can currently sort open tasks flat (0017) or reorder them manually (0047/0060), and
priority/quadrant are shown one row at a time. Make the backlog readable at a glance by letting
the user group the main task list under **Priority** or **Quadrant** headings, and let them move a
task between groups by dragging it. Dropping a task into a priority group changes its priority;
dropping it into a quadrant group changes its quadrant.

Keep the calm, single-column character of the board: groups are stacked sections with counts, not
horizontal kanban columns.

## Requirements

### Grouping

- Add a **Group** select to the board controls (`boardControlsHtml` in `views.ts`) with:
  - **None** — default, current flat list behavior.
  - **Priority** — P1 through P5, in numeric order.
  - **Quadrant** — Urgent · Important (q1) through Not urgent · Not important (q4), using
    `QUADRANT_LABEL`.
- Store the choice as ephemeral view state (`groupBy: "none" | "priority" | "quadrant"`) in
  `state.ts` with a setter, mirroring `sortBy`. It does not need to survive a reload; see nice to
  have.
- Grouping applies only to the main open task list. Today, Later, Quick tasks, and the folded
  Completed section keep their existing layout and ordering.
- Apply search and filters first, then group. Group counts and empty states reflect the filtered
  results.
- Keep every group visible, including empty ones, so they remain valid drop targets. Empty groups
  show a quiet "No tasks" hint.
- The active sort still orders tasks inside each group. If the grouping dimension is the same as
  the sort dimension, fall back to `createdAt` within priority groups and to priority then
  `createdAt` within quadrant groups.

### Drag to reassign

- Show the grip drag handle on open main-list rows whenever `groupBy !== "none"`, in addition to
  the existing `sortBy === "manual"` condition.
- A task can be dropped on a group's header, its card, or any row inside it:
  - In **Priority** view, set only `task.priority` to that group's priority.
  - In **Quadrant** view, set only `task.quadrant` to that group's quadrant.
- Dropping into empty groups must work; the whole group card is the drop zone.
- Persist the change immediately and re-render. Show the existing undo toast pattern, e.g.
  "Priority changed to P3" / "Quadrant changed to Urgent · Important", restoring the previous
  value on undo.
- Highlight the target group during `dragover` (not just the row) and clear the highlight on
  `dragleave`, `drop`, and `dragend`.
- Interaction with manual sort:
  - Ungrouped manual mode keeps today's reorder-on-drop behavior unchanged.
  - Grouped + manual: dropping on a different group reassigns the property; dropping on a row in
    the same group reorders manually. Grouped + non-manual: same-group drops are a no-op.
- Done tasks cannot be dragged and are never moved out of the Completed section.
- Keep the existing desktop HTML5 drag-and-drop implementation. Pointer/touch dragging remains out
  of scope; the existing priority/quadrant pills (0083) and Edit dialog are the accessible
  fallback for keyboard and touch users.

### Accessibility & polish

- Group headings use real headings and expose the count in accessible text
  (e.g. "Priority 2, 3 tasks").
- The Group select has an explicit `aria-label`; changing it must not steal focus from the board
  or disturb an active focus session.
- Use the existing priority colors / quadrant accents on group headings so groups are visually
  distinct without becoming loud.

## Acceptance criteria

- The board offers a Group control with None, Priority, and Quadrant; None preserves the current
  flat board exactly.
- Priority grouping renders P1–P5 in order with visible counts; Quadrant grouping renders q1–q4
  with human labels and counts.
- All groups render even when empty, and search/filters affect both the rows and the counts.
- Dragging a task from P1 to P3 changes its priority to 3 and persists across refresh; the undo
  toast restores priority 1.
- Dragging a task from Urgent · Important to Not urgent · Not important changes only its
  quadrant and persists; undo restores it.
- A task can be dropped into an empty group, and the target group highlights during the drag.
- Existing manual reordering still works when ungrouped, and the manual-sort/grouped interaction
  follows the rules above.
- Today/Later/Quick tasks and the Completed section are unaffected.
- `npm run typecheck`, `npm test`, and `npm run lint` pass.

## Implementation notes

- `state.ts` — add `export let groupBy` and `setGroupBy()`.
- `views.ts` — add the Group select to `boardControlsHtml`; in `renderBoard`, group the already
  filtered `mainTasks` and render each group with a new `taskGroupHtml` helper. Reuse `rowFor()`
  for rows and keep `openManual` working for the grouped manual case. Group markup can be a
  `<section class="task-group" data-group-kind="priority|quadrant" data-group-value="…">` with a
  header and `<ul class="task-list">`.
- `events.ts` — handle `data-group` changes; extend the drag handlers to find
  `[data-group-kind]` from the event target, highlight the group, and call the new action. Prefer
  resolving the drop target at the group level rather than per-row so empty groups work.
- `actions.ts` — add `setTaskGroup(id, kind, value)` that validates the value, snapshots the old
  priority/quadrant for undo, persists, renders, and shows the toast. Reuse the existing
  `taskById`, `persist`, `render`, and `showUndoToast` helpers.
- `style.css` — style `.task-group`, group headings/counts, an empty-group hint, and
  `.task-group.drop-target` (subtle inset/outline using `--accent-bright`).
- No stored-data or import/export schema changes.
- Add feature tests for grouping order/counts, filtered counts, priority and quadrant reassignment,
  undo, and unchanged manual reordering.

## Out of scope

- Horizontal kanban columns or drag-between-columns layout.
- Grouping by tags, status, or other dimensions.
- A pointer-events/touch drag implementation (tracked as a nice-to-have in 0060).
- Persisting the grouping choice across reloads.

## Nice to have

- Remember the last Group choice alongside other view preferences.
- A soft transition when a task lands in its new group.
- Group-by-tag once tag management (0023) settles.
