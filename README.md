# UltradianDrift

_Work in sync with your natural rhythm._

UltradianDrift (your natural ~90-minute focus rhythm, allowed to drift) is a free, browser-only
task tracker for the way your energy actually moves — not the way a clock says it should. It syncs your tasks and focus sessions with
your body's natural pulses: the ~90-minute ultradian waves when you're genuinely sharp, followed
by the rest you actually need.

**Flowtime** lets you ride a whole wave of deep, open-ended work and stop when your energy dips —
not when a timer interrupts you. **Pomodoro** is still there for the days you need a forcing
function against procrastination. Same app, two honest tools, chosen by you.

No account. No subscription. No ads. No tracking. Your data lives in your browser.

## Why UltradianDrift?

Most focus apps are Pomodoro timers in disguise: rigid 25-minute blocks that interrupt you
precisely when you're in flow. That's a useful forcing function if you're avoiding work — and
distracting if you're not. UltradianDrift is built on the opposite assumption: you'll focus better when
your work follows your body's natural rhythm.

- **Built for your ultradian rhythm.** Flowtime's count-up timer lets you work through a full
  wave of deep focus and take a real break when your energy drops — not when a bell rings.
- **Free and private, honestly.** No subscription, no account, no telemetry. Everything lives on
  your device and is yours forever.
- **Calm by design.** A quiet, forest-green interface with nothing to configure before it's
  useful. Few buttons, one thing at a time.
- **Kind to a busy mind.** An urgent/important board, a single reassuring focus total for today,
  and no feature creep.
- **Honest about time.** Sessions are computed from wall-clock timestamps, so they never drift —
  even if you close the laptop and come back.

## Features

### Tasks that follow your rhythm

- Priorities 1–5 and the Eisenhower quadrant (urgent / important)
- Plan for today, defer to a later date, or set a recurring routine (daily, work days, weekly,
  monthly) with a scheduled time that reopens after completion
- Natural-language quick-add (`#tags`, `!priority`, "tomorrow 9am")
- Tags (`#errands`), descriptions, and optional time estimates
- Quick tasks for the tiny stuff, batched into one continuous run
- Manual drag-and-drop ordering alongside priority/type/newest sort
- Search, filter, and sort
- Undo toasts for completing, deleting, and rescheduling tasks

### Focus, your way

- **Flowtime** — open-ended, count-up sessions for riding a full ultradian wave, with a suggested
  break when you finish
- **Pomodoro** — work/break cycles with configurable durations and long-break cadence, when you
  want structure (breaks never auto-start the next focus block — you resume when ready)
- Drift-free timers derived from timestamps (no clock drift)
- Rest screen after every session, with an automatic break countdown when enabled
- **Focus mode** — hides everything but the clock and the current task
- Restart notes per session, plus a "pick up where you left off" hint
- Sound cues (chime / soft / breeze, with preview) and optional browser notifications
- Idle nudge if a session keeps running while you step away

### Insight without noise

- Today and week focus totals, focus streak
- Dashboard: focus trend and weekday rhythm charts, focus by quadrant and tag, open tasks by
  quadrant, areas needing attention, recent sessions
- Session history per task, with editable notes

### Data you own

- 100% local — stored in your browser, no account, no server
- Installable PWA that works offline
- Export / import (JSON), CSV import (e.g. from Todoist), and Markdown history export
- Automatic backup before destructive actions, with restore, plus daily snapshots
- Duplicate-task warnings and delete confirmations with session counts

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # typecheck + production build
npm run preview  # preview the production build
```

### Scripts

| Script              | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Vite dev server                     |
| `npm run build`     | `tsc` + production build to `dist/` |
| `npm run preview`   | Serve the production build          |
| `npm run typecheck` | TypeScript check (no emit)          |
| `npm test`          | Vitest unit + smoke tests           |
| `npm run lint`      | ESLint                              |
| `npm run format`    | Prettier (write)                    |

### Keyboard shortcuts

| Key     | Action                                 |
| ------- | -------------------------------------- |
| `N`     | New task                               |
| `/`     | Search                                 |
| `Space` | Pause / resume                         |
| `F`     | Finish (session, quick task, or break) |
| `Esc`   | Close menu, exit focus mode, or dialog |

## Tech

- TypeScript, Vite, vanilla DOM — no runtime dependencies
- LocalStorage persistence with sanitized load/import paths
- Synthesized audio cues (no asset files)
- Vitest, ESLint, and Prettier for quality

## Trying it with example data

`examples/` contains realistic export files you can load from **Settings → Import data**:

- `typical-2-months.json` — a mixed user: ~17 tasks across quadrants/priorities, ~2 months of
  pomodoro and flowtime sessions, plans for today and later.
- `flowtime-focused.json` — a flowtime-first user with longer deep-work sessions, progress notes,
  day theme, and a max-flowtime cap.

Dates are generated relative to today, so the dashboard, streak, and Today/Later sections are
immediately populated. Regenerate them at any time:

```bash
npm run examples
```

## Notes

- A single-page, front-end-only app by design (see `INTENT.md`).
- Data is tied to the browser you use — export a JSON backup before clearing your browser data.