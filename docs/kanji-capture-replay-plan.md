# Kanji handwriting capture, replay, and review plan

## Purpose

Extend the current kanji stroke-order study space so a learner can intentionally record a handwritten attempt, replay that attempt, and place the character into a small local review queue.

> **Status:** Implemented on the multi-character architecture (`app.js`/`index.html`/`style.css`) after upstream PR #1 replaced the original single-character prototype this plan was drafted against. The data model, privacy boundaries, and controls below were applied per selected character rather than only for 木.

This is a plan only. It does not introduce accounts, syncing, server storage, handwriting recognition, scoring, or tracking of arbitrary keyboard input.

## Current baseline

- `index.html` contains the complete application: reference SVG, reference-stroke animation, styles, and interaction logic.
- The canonical character is **木** with four reference paths.
- There is no drawing surface, persistence layer, build system, or test framework.

## Product boundaries

### In scope

- Opt-in pointer capture for pen, touch, and mouse on a writing area.
- Capture of per-stroke point paths and relative timing.
- Replay of the learner's saved attempt.
- Local-only persistence of a bounded attempt history.
- A local “remember for review” state and a minimal due-review cue.
- Accessible controls and a reduced-motion alternative.
- Explicit deletion of an attempt and clearing all local practice data.

### Out of scope for the first release

- Accounts, cloud sync, sharing, analytics, or a backend.
- Collection of text typed elsewhere in the browser or device.
- Handwriting recognition, accuracy scoring, grading, or claims that the learner wrote a correct character.
- Complex spaced-repetition algorithms.
- Multi-device continuity.
- Adding a general framework, package manager, or third-party dependency.
- More characters than **木**, except where a small data boundary makes future extension easier.

## Decisions required before implementation

1. **Capture target.** The first release records only handwriting performed deliberately in the app's practice area.
2. **Storage.** Use `localStorage` with no server transmission. Browser-data clearing may remove attempts.
3. **Retention.** Keep at most 20 saved attempts for a character; discard the oldest when saving a newer one.
4. **Review interval.** Start with a fixed 24-hour interval after a learner chooses “Remember this character.”
5. **Replay fidelity.** Store sampled points with elapsed time and replay them at their original relative pace; provide 0.5×, 1×, and 2× speed controls.
6. **Correctness.** Treat an attempt as a recording, not as evidence of stroke-order or shape correctness.

## Proposed interaction flow

1. The learner watches the existing **Replay slowly** reference animation.
2. The learner selects **Practice writing**.
3. A labelled writing canvas opens, with the reference character optionally shown as a faint guide.
4. The learner draws one or more strokes. The app shows an in-progress ink path but does not save automatically.
5. The learner selects **Finish attempt** and then either **Save attempt** or **Discard**.
6. After saving, the learner may select **Replay my attempt** at a chosen speed.
7. The learner can select **Remember 木**. On a later visit, the app displays a non-intrusive due-review cue when the local review time has passed.
8. The learner can delete an individual attempt or clear all practice history. Both operations clearly state that they are irreversible.

## Data model

Keep the model browser-native JSON and version the root value to permit safe evolution.

```text
PracticeStore
  version: 1
  characters:
    "木": CharacterPractice

CharacterPractice
  remembered: boolean
  nextReviewAt: ISO timestamp | null
  attempts: Attempt[]                 // newest first; maximum 20

Attempt
  id: opaque local id
  createdAt: ISO timestamp
  completed: boolean
  strokes: CapturedStroke[]

CapturedStroke
  startedAtMs: number                 // relative to attempt start
  points: CapturedPoint[]

CapturedPoint
  x: number                           // normalized 0..1
  y: number                           // normalized 0..1
  elapsedMs: number                   // relative to stroke start
  pressure: number | null             // only where Pointer Events provide it
```

### Storage key and validation

- Use one namespaced key, e.g. `kanjiStrokes.practice.v1`.
- Parse storage defensively. If the stored value is malformed, ignore it and keep the app usable; do not execute or interpolate stored values as HTML.
- Clamp coordinates to `0..1`, require non-negative finite elapsed times, cap points per stroke, and cap strokes/attempts before saving.
- Keep all data in `localStorage`; do not add network requests.

## Technical design

### A. Separate canonical character data from rendering

Move character-specific metadata into a small JavaScript object:

- `character`, readings, gloss, reference SVG paths, expected stroke count.
- This preserves the current appearance while creating a future insertion point for more kanji.

The existing reference-animation logic remains canonical and separate from learner recordings.

### B. Add a writing surface

- Add a `<canvas>` or pointer-enabled SVG layer sized to the current practice area.
- Prefer a canvas for immediate freehand rendering and SVG for the existing canonical paths.
- Convert pointer coordinates using the writing surface's current bounding rectangle, then normalize them before storage. This keeps recordings usable across screen sizes and pixel densities.
- Use `setPointerCapture()` on pointer down, and end a stroke on `pointerup`, `pointercancel`, or lost capture.
- Set `touch-action: none` only on the writing surface so touch drawing does not scroll the page there; preserve normal page navigation elsewhere.
- Ignore accidental zero-length strokes and downsample high-frequency points to a defined minimum distance/time threshold.

### C. Save and replay attempts

- Maintain the active attempt in memory until the learner explicitly saves it.
- Render a saved attempt by translating normalized coordinates back into current canvas pixels.
- Replay with `requestAnimationFrame`; interpolate between stored points according to `elapsedMs`.
- Cancel or restart replay cleanly when the learner changes speed, starts a new practice attempt, or navigates out of the practice panel.
- Keep reference playback and attempt playback mutually exclusive so status messages and controls do not conflict.

### D. Review state

- A saved character can be marked remembered independently from individual attempts.
- Marking it remembered sets `nextReviewAt` to the current time plus 24 hours.
- If the app loads after `nextReviewAt`, show “木 is ready for a quiet review” and offer the practice action.
- Completing a saved practice attempt for a remembered character moves the next review time forward another 24 hours.

## Milestones

### Milestone 1 — Refactor for a stable boundary

**Goal:** Preserve current reference playback while separating state and DOM responsibilities.

Tasks:

- Introduce named state for reference playback and a small canonical-character object.
- Keep the existing layout, animation, and reduced-motion behavior visually unchanged.
- Add semantic containers for reference and practice modes.

Acceptance criteria:

- The existing replay action works exactly as it does now.
- Reduced-motion users receive a completed static reference without brush animation.
- No storage is read or written yet.

### Milestone 2 — In-memory handwriting capture

**Goal:** Let a learner draw and restart an unsaved attempt.

Tasks:

- Add Practice writing / Restart attempt / Finish attempt controls.
- Implement normalized Pointer Event capture and immediate rendering.
- Prevent page scrolling only while a pointer is actively drawing inside the writing surface.
- Add an accessible status update such as “Stroke 2 recorded.”

Acceptance criteria:

- Mouse, touch, and pen inputs can make visible strokes where available.
- Resize/orientation changes do not distort the normalized in-memory strokes.
- No attempt persists after a page reload.
- Keyboard users can reach all controls; drawing remains an optional pointer interaction.

### Milestone 3 — Attempt persistence and replay

**Goal:** Save a bounded local history and replay the most recent saved attempt.

Tasks:

- Add versioned `localStorage` read/write helpers and validation.
- Add Save attempt, Discard, Delete attempt, and Clear practice history controls.
- Save no more than 20 attempts for 木.
- Implement replay at 0.5×, 1×, and 2× with restart/cancel behavior.

Acceptance criteria:

- A saved attempt remains available after refresh in the same browser profile.
- Replay reproduces stroke ordering and relative pacing without blocking the browser.
- Deletion and clear operations remove only the stated local data.
- A malformed stored value does not break loading or rendering.

### Milestone 4 — Remember and review cue

**Goal:** Provide a minimal, transparent reminder loop.

Tasks:

- Add Remember 木 / Stop remembering 木 control.
- Persist `remembered` and `nextReviewAt` locally.
- Show an on-load due-review cue, without notifications, background timers, or network calls.
- Advance the review timestamp after a saved practice attempt.

Acceptance criteria:

- Remembering survives a refresh.
- Turning remembering off removes the due-review state.
- The due-review cue is informative but does not force the learner into a mode.

### Milestone 5 — Quality pass and documentation

**Goal:** Verify behavior on supported input and accessibility modes.

Tasks:

- Add concise user-facing local-data disclosure near the save controls.
- Test touch, mouse, and (when available) pen input.
- Test resize, reload, local-storage unavailable/quota failure, and malformed storage.
- Verify focus indicators, labels, screen-reader status announcements, and reduced-motion behavior.
- Update `README.md` with usage and local-data behavior.

Acceptance criteria:

- The feature remains usable when storage writes fail; show a clear non-blocking explanation and retain the in-memory attempt.
- No external requests are introduced.
- A learner can discover how to delete their locally stored practice data.

## Test plan

Because the prototype has no test toolchain, begin with manual checks and add focused browser-level tests only if a lightweight existing-compatible approach is approved.

| Area | Checks |
| --- | --- |
| Reference replay | Starts, completes, restarts, and honors reduced motion. |
| Capture | Mouse/touch/pen stroke begins, continues, ends, and cancels cleanly. |
| Geometry | Captured normalized points redraw correctly after resize. |
| Persistence | Save, reload, delete one, clear all, history cap, invalid JSON. |
| Replay | Correct stroke sequence, speed choices, cancel/restart, no overlapping animation. |
| Review | Remember, due state, practice advances date, stop remembering. |
| Accessibility | Keyboard focus/order, visible focus, labels, live status, no motion-only instruction. |
| Privacy | No network requests; only stated local key is written; clear removes it. |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Touch drawing scrolls the page | Apply `touch-action: none` narrowly to the drawing surface. |
| Large point arrays exhaust storage | Downsample points, cap strokes and attempts, and retain only the newest 20 attempts. |
| Browser storage is unavailable | Keep an in-memory attempt and provide an explanatory status message rather than failing. |
| Playback competes with reference animation | Use one playback controller and disable conflicting controls while active. |
| Users infer grading from replay | Label replay as “My attempt,” avoid correctness claims, and do not score it. |
| Local data surprises users | State local-only storage and provide individual/all-data deletion controls. |

## Expected file surface

Initial implementation should remain intentionally small:

- `index.html` — markup, style, app behavior, and storage helpers.
- `README.md` — feature use and local-data explanation.

If `index.html` becomes difficult to navigate during Milestone 1, split only into a minimal `app.js` and `styles.css`; do not introduce a framework or build chain solely for this feature.

## Definition of done for the first release

A learner can intentionally draw 木 in the practice area, explicitly save a local attempt, replay it later at more than one speed, mark 木 for a later local review cue, and delete every stored practice record. The existing reference animation and reduced-motion behavior remain intact, and the app sends no practice data over the network.
