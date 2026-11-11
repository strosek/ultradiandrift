# 0089 — Stepper controls for changing task priority

Status: done

## Goal

The inline priority pill (0083) only cycles forward (P1 → P2 → … → P5 → P1), so it can lower a
task's priority but there is no direct way to raise it. Add small, subtle up/down controls beside
the pill so a task can be stepped in either direction without opening the Edit dialog.

## Requirements

- Render a compact up/down stepper around the existing priority pill:
  - **Up** raises importance: P5 → P4 → P3 → P2 → P1.
  - **Down** lowers importance: P1 → P2 → P3 → P4 → P5.
- Disable the relevant arrow at the boundary (P1 has no higher step, P5 has no lower step) instead
  of wrapping.
- Keep the pill itself clickable with its existing cycle behavior.
- Use the shared `quadrantPriorityHtml` path so the stepper appears on main task rows and compact
  rows (Today, Later, Quick, Dashboard) alike.
- Keep the controls quiet: small chevrons at low opacity, becoming clearer on hover/focus.
- Provide clear `title` and `aria-label` text, including the resulting priority level, and keep
  keyboard focus visible.
- Persist each change immediately and re-render in place; no toast is needed for a single step.

## Acceptance criteria

- Clicking up from P2 changes the task to P1; clicking down from P2 changes it to P3.
- The controls stop at P1/P5 and show the boundary button disabled.
- The pill click still cycles priority as before.
- Stepper controls work on both main and compact task rows.
- Changes survive a reload and are reflected in grouped priority views.
- `npm run typecheck`, `npm test`, and `npm run lint` pass.

## Implementation notes

- `views.ts` — `priorityLabel` returns a `.priority-control` wrapper with up and down
  `.priority-step` buttons around the existing `.priority-pill`.
- `actions.ts` — add `stepPriority(id, "up" | "down")`, clamped to `[1, 5]`, and route
  `data-action="step-priority"` with `data-dir` through `handleAction`.
- `icons.ts` — add a `chevron-up` icon; reuse `chevron` for down.
- `style.css` — compact button sizing, low default opacity, hover/focus emphasis, and disabled
  styling.
- `features.test.ts` — cover stepping both directions and boundary disabling.
