# Imperial Base: command interface improvement plan

Written 2026-11-20 on branch `security/high-findings` (clean at `ac875b2`). This plan covers the HUD, the
interface drawn over the 3D base. The 3D world, the backend security model and the API contracts are out of
scope and stay as they are.

## 1. Audit findings

### Baseline checks (before any change)

| Check | Command | Result |
|---|---|---|
| Backend tests | `backend\.venv\Scripts\python -m pytest -q backend\tests` | 629 passed |
| Frontend tests | `cd frontend && npx vitest run` | 111 passed in 15 files |
| Typecheck | `cd frontend && npx tsc --noEmit -p .` | clean |
| Lint | none configured (`package.json` has no lint script, no ESLint config) | not applicable |

Visual inspection: an isolated backend on port 8743 (temporary database, empty spool, so no real agent data)
served the built frontend. Screenshots were taken with headless Chromium using the GPU, at 1600×900 and 420×860.

### What works

* Clean data model: every agent state comes from a recorded hook event, stale activity reads *unknown*, and
  simulation is labelled **SIM** everywhere. The interface must keep that honesty.
* Strong security boundary (`LocalBoundary`, Orders isolation, redaction), all covered by tests.
* The roster, missions and events panels already have search and filters.

### Problems, by severity

**High**

1. **The top bar breaks on narrow windows.** At 420 px the status pills, time of day, sound and quality controls
   run off the right edge and cannot be reached. Camera modes overflow too.
2. **No command overview.** The first panel is the agent roster. Nothing answers "is the base healthy, and does
   anything need me?" in one place. Link state, hook state, Orders state and host load sit in different
   places, or (host CPU and memory) are received over the socket but never shown in the HUD at all.
3. **No security or intelligence view.** Failed turns, tool failures, permission waits and Orders guard
   refusals are real signals, but they are scattered across the event log, the feed and the Orders chat.
4. **Keyboard access gaps.** Mission rows, feed items and clickable key/value rows are `div`s with click handlers
   and no keyboard access. The tab list has no arrow-key navigation.

**Medium**

5. **Weak visual hierarchy.** Every button looks the same (primary actions do not stand out), labels are
   9.5–11 px uppercase Rajdhani, and gold, green, blue, purple and amber all compete. The panels are 86%
   opaque, so secondary text loses contrast over the bright desert.
6. **Cramped navigation.** Five tabs share 360 px; there is no room for more sections.
7. **Feed.** Only seven lines, with no way to see warnings and alerts only.
8. **No way to search across the base.** Each panel has its own search, but you can't jump straight to an agent,
   a facility, a tour or an action.

**Low**

9. Status is shown by colour alone in the legend and the status dots.
10. Plain text loading, empty and offline states.
11. There is no way to preview a populated HUD without real agents. Screenshots and first-time users only ever see
    empty panels.

## 2. Design direction

A command installation console: restrained, dense, legible.

* **Palette.** Near-black and charcoal surfaces (`#08090b` to `#1c2026`), steel greys for structure and
  secondary text, one accent: Imperial crimson (`#c8232c`, `#ff5a62` for text on dark). Status colours are muted
  and always paired with a text label. Gold is retired from the interface.
* **Typography.** Rajdhani for headings, labels and figures (display). The system UI face (Segoe UI on Windows)
  for body text, so sentences stay readable at small sizes. JetBrains Mono for times, ids and the event log. No
  new font packages.
* **Surfaces.** Opaque panels (97%) with a 1 px hairline, a crimson index mark on the active item, small corner
  ticks used sparingly. No scanlines, no glow halos.
* **Spacing.** A 4 px grid (`--s1`…`--s6`) and fixed type steps (11, 12, 13, 14, 16, 20, 28 px).
* **Motion.** Kept short. `MotionConfig reducedMotion="user"` stays, and the CSS animations stop under
  `prefers-reduced-motion`.

## 3. Plan (priority order)

| # | Work | Priority | Data source |
|---|---|---|---|
| 1 | Design tokens and a full restyle of `styles.css`; primary, secondary, ghost and danger buttons; refined cards, tables, chips and inputs | P0 | — |
| 2 | Responsive shell: a vertical navigation rail (Overview, Agents, Missions, Events, ISB, Air, Sites) with arrow-key navigation; a top bar with a status cluster, search and a Display menu (time of day, sound, quality, labels, frame rate); at phone widths a bottom navigation bar and a panel sheet | P0 | — |
| 3 | Accessibility: keyboard access for every clickable row, `aria-controls` on tabs, visible focus, status text next to every colour dot, contrast checked against WCAG AA | P0 | — |
| 4 | **Command Overview** panel (new default): system status board (agent link, capture hook, event store, Orders channel, host CPU and memory), duty summary that opens the filtered roster, hook activity chart (last hour or 24 h, failures stacked), department occupancy, open alerts | P1 | Real: socket snapshot, `system` messages, `/api/events` (latest 2,000 stored events) |
| 5 | **ISB** panel (Imperial Security Bureau): derived alert level with its reasons spelled out, incident register (failed turns, tool failures, permission requests, Orders guard refusals) with search, severity and type filters, case files that you open on an agent or incident and add notes to, ISB personnel (security-department agents), and simulated contacts clearly tagged SIM | P1 | Real hook events and Orders notices; case files kept in this browser only |
| 6 | **Command search** (Ctrl+K or `/`): agents, missions, facilities, panels, camera modes, tours and actions in one ranked list | P1 | Store |
| 7 | Feed: severity filter (All, Agents, Alerts, Sim), keyboard access | P2 | Store |
| 8 | **Demo mode** (`?demo=1`): a fictional, clearly labelled dataset for previewing the interface. The live link is not opened, a DEMO DATA badge stays in the top bar, 3D nameplates read DEMO AGENT, and Orders are disabled | P2 | Fixed sample built in `lib/demo.ts` |
| 9 | Tests for the new logic (activity buckets, incidents, alert level, case files, search ranking, demo data, tab keyboard helper) | P1 | — |
| 10 | Documentation: README panels and controls, IMPLEMENTATION_STATUS, TESTING | P1 | — |

### Constraints honoured

* No backend change is needed: the overview and ISB use the existing read-only `GET /api/events` (already behind
  `LocalBoundary`) and the socket messages. No security control, default or contract changes.
* No new dependencies. Logic goes in pure TypeScript modules so it can be tested with the existing Vitest setup
  (Node environment, no DOM testing library).
* Nothing is invented. The alert level is a stated rule over real events. When the link is down, it reads
  UNKNOWN rather than a guess. Simulated threats stay labelled SIM. Demo data is never mixed with live data.

### Deferred (not in this pass)

* Component-level DOM tests, which would need a DOM testing library (a new dependency).
* A server-side activity aggregate over the full 50,000-event store. The client covers the latest 2,000 events and
  says so on the chart.
* Shared, server-side case files. They are per-browser by design for now.
* Changes to the 3D world's look.

## 4. Outcome

All ten plan items were delivered. After the changes: 629 backend tests collected, 626 passed and 3 skipped (symlink
tests that need Developer Mode on Windows; unchanged, no backend edits), 155 frontend tests passed (111 before),
typecheck clean, production build succeeded.

A follow-up verification pass checked every panel in live and demo mode at 1600 × 900 and 420 × 860 in headless
Chromium, plus keyboard-only use, and fixed two defects: the telemetry walls inside the base still called
`GET /api/system` and read "(LIVE)" in demo mode, and on phones the agent inspector half-covered the open panel.

A second session worked on the same task in this checkout for a few minutes. Its additions were kept and
integrated: `lib/feed.ts` (feed filters and severity words), `recordEntries` in `lib/search.ts` (events, case
files and aircraft in command search), case focus in `lib/cases.ts`, and the demo-mode refusal in `lib/orders.ts`.


See the "Command interface overhaul" section of [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for what was
delivered and verified, and [TESTING.md](TESTING.md) for test counts.
