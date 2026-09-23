# 0087 — Rest screen always shown, no auto-focus, header alignment

Status: done

## Goal

Three small fixes to how a finished session hands off to rest and how the header lays out:

1. The header action buttons (Dashboard, History, Settings, About) should sit flush with the
   right edge of the heading/content area, not float partway across it.
2. After a work session stops, always show the rest screen. Start the break countdown
   automatically only when **Auto-start break** (0014) is enabled; otherwise show the
   suggested break waiting for an explicit **Start break**.
3. Finishing the rest must never start a focus session on its own. Resuming focus stays a
   deliberate choice (**Continue focusing**).

## Header alignment

- `#app` is centered and capped at `1000px`, while `.corner-toggles` is `position: fixed` at
  the viewport's top-right. The old `.app-header` reserved a fixed `88px` of right padding for
  those toggles, which left the actions visibly short of the content's right edge (roughly
  three-quarters across on a wide window).
- Reserve only what the fixed toggles actually need (`48px`) on narrow widths, and drop the
  reservation entirely once the centered app has enough side margin to clear them
  (`min-width: 1060px`).
- `margin-left: auto` on `.header-actions` keeps them right-aligned even if the header wraps.

## Rest screen behavior

- Extend `BreakState` (`types.ts`) with `durationMs` (the suggested break length) and
  `running` (whether the countdown is active). Break state stays ephemeral and is not
  persisted.
- `finishSession` (`actions.ts`) opens the rest screen whenever the suggested break is
  positive. It sets `running: settings.autoBreak` and only calls `startRepaint()` when the
  countdown is running.
- The idle rest screen (`views.ts` → `renderBreak`) shows the full suggested duration and
  offers **Start break** (`start-break`) and **Skip** (`skip-break`), plus the rest guide.
  The running screen is unchanged.
- `startBreak` (`actions.ts`) begins the countdown from the waiting screen; the `F` shortcut
  starts the break while it is waiting and otherwise keeps its existing "continue focusing"
  meaning.
- The repaint tick and `catchUpHidden` only transition a break that is actually running, so a
  waiting break can't expire by itself.

## No automatic focus

- When a running break reaches zero, `breakOver` marks it done and renders the **Break over**
  screen. Resuming focus requires the explicit **Continue focusing** button; no session is
  created automatically.

## Pomodoro breaks wait for resume

- Inside a pomodoro session, work→break still rolls over automatically (cue + notification),
  but break→work never auto-starts the next focus block.
- When the repaint tick (`repaintTick`) or the hidden-tab catch-up (`catchUpHidden`) sees a
  break→work transition on a running pomodoro, it cues "Break over" and freezes the session
  via `pauseAfterPomodoroBreak` (`actions.ts`) exactly at the boundary start, so none of the
  tick overshoot leaks into the next focus block.
- The staged work block renders paused at full length with the existing **Resume** control
  (Space works too); resuming continues the same session with its pomodoro count intact.
- Applies to short→work and long→work alike, independent of the **Auto-start break** setting
  (that setting only governs the post-session rest screen above).

## Acceptance criteria

- On a wide window the header actions are flush with the right edge of the board content.
- With **Auto-start break** off, finishing a session opens the rest screen with the suggested
  duration and a **Start break** button; the clock does not tick until it is pressed.
- With **Auto-start break** on, the countdown begins immediately as before.
- When a break finishes, no focus session starts by itself; **Continue focusing** is required.
- When a pomodoro short/long break ends mid-session, the session pauses at the next focus
  block start instead of auto-running it; **Resume** is required.
- `npm run typecheck`, `npm test`, and `npm run lint` pass.
