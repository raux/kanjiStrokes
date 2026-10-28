# Ink Dungeon — roguelike mode implementation plan

## Purpose

Add an optional roguelike game mode ("Ink Dungeon") on top of the existing kanji stroke-order study space. A run descends through themed floors of kanji encounters. The learner defeats a kanji by writing it from progressively weaker guidance; failed kanji return as ghosts; cleared kanji join a persistent bestiary that reuses the existing remember/review state.

The game is **additive**. The study space, practice panel, and their behavior remain unchanged and fully usable without ever entering the game.

This is a plan only. No code changes accompany it.

## Current baseline

- Static site (`index.html`, `app.js`, `style.css`) deployed by GitHub Pages; no build step, no dependencies.
- KanjiVG stroke data: eight bundled characters in `data/`, others fetched on demand from a pinned revision and cached in memory.
- Handwriting practice panel: pointer capture of normalized, timed stroke paths; save/replay; per-character `remembered`/`nextReviewAt`; bounded `localStorage` store `kanjiStrokes.practice.v1`.
- Design system: CSS custom properties (`--paper`, `--ink`, `--accent`, `--line`, `--muted`), washi/sumi aesthetic, reduced-motion support throughout.

## Constraints and principles

- Static site only: no backend, no accounts, no new runtime dependencies, no analytics.
- All game state in memory during a run; only meta-progression persists, in one new versioned `localStorage` key `kanjiStrokes.dungeon.v1`.
- The existing practice store is read-only to the game except through the same save paths the practice panel already uses.
- The stroke scorer is a heuristic practice aid. The UI must present verdicts as game feedback ("the stroke landed"), never as authoritative calligraphic grading.
- Offline-friendly core: Floor 1 must be playable from the bundled `data/` characters alone; deeper floors may require the network and must degrade gracefully (shrink the pool, warn, never crash).
- Reduced-motion users get full gameplay: palette shifts without transitions, stamps without animation, verdicts as text.
- Keep KanjiVG attribution visible wherever stroke data is rendered, including game screens.

## Game design summary

### Run structure

- A run = 5 floors; each floor = 5–8 kanji encounters + 1 elite (floor 5: boss word).
- Floors are generated from a seeded PRNG (xorshift/mulberry32, ~30 lines, no dependency) so a seed reproduces a run; a "daily seed" is derived from the date.
- Run ends on victory (floor 5 cleared), defeat (HP exhausted), or abandonment. No mid-run persistence in v1: closing the tab ends the run. (Run resume is a later milestone.)

### Recall ladder (difficulty dial)

| Mode | Guidance shown |
| --- | --- |
| Copy | Full ghost guide + reading + meaning |
| Trace | Guide fades after ~2 s |
| Cued recall | Reading + meaning only, no guide |
| Free recall | Meaning only |

Floor depth selects the minimum mode; relics and ink can temporarily buy guidance back.

### Resources

- **HP (resolve):** lost when an encounter is failed. Defeat at 0.
- **Ink:** spent per written stroke; sloppy (low-scoring) strokes cost more; refilled partially on floor clear. Running dry forces careful writing, not punishment — a dry brush writes at half damage rather than blocking input.
- **Relics:** passive modifiers earned from elites (e.g., Calligrapher's Brush: one guide reveal per floor; Still Water: reference replay at half ink cost; Second Stroke: first miss per encounter forgiven).

### Encounters

- Enemy HP = stroke count. Each accepted stroke lands a hit; a rejected stroke costs ink and may retry.
- Elite = two-kanji compound; boss = compound written from meaning alone.
- Ghosts: kanji failed earlier in the run are re-inserted into later floor pools at one recall mode harder.

### Meta-progression (persists)

- **Bestiary:** per-character record — encounters, defeats, best recall mode achieved, last seen. Defeating a kanji at cued/free recall offers "remember this kanji," writing through the existing practice-store path so the study space's review cue and the game agree.
- Unlocked relics and best run depth.

## Scoring design (the one new algorithmic component)

A pure, dependency-free module comparing a captured attempt against KanjiVG reference paths:

1. Resample both the drawn stroke and the reference path to N=32 points (reference sampling via `getPointAtLength` on an offscreen SVG path, normalized to the 109×109 KanjiVG box mapped onto the 0–1 capture space).
2. Per-stroke features: stroke-count match; start-point and end-point distance; mean point-to-point distance after resampling; gross direction (quantized start→end angle).
3. Verdict thresholds: `hit` / `graze` (counts, extra ink) / `miss`. Thresholds are data, not code, so they can be tuned per recall mode (free recall is judged more leniently on shape, strictly on stroke count/order).
4. Order policy v1: strokes judged in canonical order (stroke i compared to reference i). Out-of-order writing scores as misses; a later milestone may add nearest-unmatched-stroke matching.

The scorer is the highest-risk component. It ships first, behind a non-game "Challenge me" toggle in the existing practice panel, so it can be tuned on real handwriting before any game depends on it.

## Floor aesthetics

Principle: **depth = less light, less guidance, more ink.** The difficulty curve and the visual curve are the same curve.

### Palette depth themes

One class on `<body>` (`.depth-1` … `.depth-5`) swaps CSS custom properties; everything else inherits.

| Depth | Mood | Paper | Ink / accent |
| --- | --- | --- | --- |
| 1 | Morning paper | current warm cream | current sumi + vermilion |
| 2 | Dusk | grey-rose cast | deeper ink |
| 3 | Night study | indigo-washed (藍) | pale strokes, lantern-amber accent |
| 4 | Deep ink | near-black washi, reversed contrast | white strokes, glowing cinnabar |
| 5 | Gold-leaf byōbu | dark + gold `#c9a24b` accents | red |

`transition: background-color 1.2s, color 1.2s` on the themed containers; disabled under reduced motion. Dark depths (3–5) must be re-checked for WCAG AA contrast on all text and controls.

### Descent as a scroll (emaki)

- Each floor is a full-viewport section; descending glides down via `scrollIntoView({ behavior: "smooth" })` (auto under reduced motion).
- A left-margin rail shows floor markers with vertical floor names (`writing-mode: vertical-rl`): 庭 (courtyard) → 墨淵 (ink depths).
- Cleared floors receive a red hanko stamp over their marker, reusing the `.seal` styling with a one-shot scale/rotate "press" animation (instant under reduced motion).

### Ink-wash scenery (no image assets)

- Floor backdrop: the floor's theme radical rendered huge from KanjiVG paths at ~4% opacity through the existing `feTurbulence` displacement filters.
- Drifting mist bands: two translucent turbulence-filtered SVG layers on slow (≥60 s) translate loops; static under reduced motion.
- Optional parallax: 2–3 backdrop layers with small scroll-linked `translateY` factors.

### Encounter cards (ofuda)

- Tall talisman-shaped cards: rough-edge SVG `clip-path`, one large character (or ？ in recall modes), vertical stroke-count caption.
- Defeat: red seal stamp pressed onto the card. Failure: a bottom-up "burn" mask reveal with charred-edge gradient; the card greys into a ghost card that reappears on later floors.

### Calm feedback (no shake, no particles)

- Hit: the drawn stroke re-inks itself dark using the existing dash-offset animation.
- Graze/miss: the stroke bleeds — brief blur/spread on that stroke only, like ink on wet paper.
- Ink meter: a circular brush-dish SVG that visibly dries rather than a progress bar.
- Floor clear: the floor's kanji replay themselves once in sequence (existing animation code), then the palette transitions to the next depth.
- Every effect has a text equivalent in the status line for reduced-motion and screen-reader users.

## Architecture

New files, additive; the study space loads none of the game logic until the game is opened.

```text
game.html          game mode page (same header/footer voice, links back to study)
game/
  engine.js        run state machine: floors, encounters, HP/ink, ghosts
  floors.js        seeded PRNG, floor generation, radical-theme pools
  scorer.js        pure stroke-scoring module (shared with practice "Challenge me")
  bestiary.js      kanjiStrokes.dungeon.v1 load/save/validate (practice-store patterns)
  game.css         depth themes, rail, cards, effects (imports/extends style.css vars)
data/
  pools.json       curated floor pools: codepoints, readings, meanings, radical themes
```

Shared code (pointer capture, KanjiVG load/parse, path rendering) is extracted from `app.js` into small modules only where the game needs it, keeping the study page's behavior byte-identical in intent. A separate page (rather than a mode toggle in `index.html`) keeps the study space simple and makes the game's heavier CSS/JS pay-per-use.

Floor pools: curating ~150–250 characters with readings/meanings into `pools.json` (vocabulary data is currently only 8 entries). Floor 1 uses bundled-only characters; deeper floors declare network-dependent pools and shrink gracefully offline.

## Milestones

Each milestone is independently shippable and keeps the study space untouched.

### M1 — Scorer + "Challenge me" (foundation, no game shell)

- `game/scorer.js` as a pure module with tunable thresholds.
- "Challenge me" toggle in the existing practice panel: hides the guide, scores the attempt stroke-by-stroke, shows hit/graze/miss per stroke and a summary.
- Console/debug harness comparing scorer output on saved attempts.
- **Acceptance:** scoring runs entirely client-side on existing captured data; verdicts feel sane on 木 and 憂 for deliberate vs. scribbled input; practice panel unchanged when the toggle is off.

### M2 — Run skeleton on one floor

- `game.html` + engine with a single hard-coded floor (bundled characters only), copy/trace modes, HP and ink, encounter flow, run end states.
- Plain interim styling; correctness over beauty.
- **Acceptance:** a full single-floor run is winnable and losable offline; refresh cleanly abandons the run; study page untouched.

### M3 — Floors, seeds, ghosts, recall ladder

- Seeded generation from `pools.json`; five floors; recall ladder by depth; ghost re-insertion; elite encounters; daily seed.
- **Acceptance:** same seed → same run; ghosts reappear harder; offline play degrades to bundled pools with a visible notice.

### M4 — Floor aesthetics

- Depth palette classes and transitions; scroll-descent rail with hanko stamps; ink-wash backdrops and mist; ofuda encounter cards with stamp/burn states; ink-dish meter; calm stroke feedback.
- Contrast audit for depths 3–5; reduced-motion parity for every effect.
- **Acceptance:** each depth is visually distinct while recognizably the same design system; no effect exists without a text equivalent; Lighthouse accessibility score does not regress.

### M5 — Bestiary and meta-progression

- `kanjiStrokes.dungeon.v1`: bestiary records, relic unlocks, best depth; validation and caps mirroring the practice store; "clear dungeon data" control.
- "Remember this kanji" bridge into the existing practice store on cued/free-recall defeats.
- Bestiary browsing screen (defeated kanji, best recall mode, replay of the winning attempt via existing replay code).
- **Acceptance:** meta persists across sessions; bridge writes exactly the same shape the practice panel writes; deleting dungeon data leaves practice data intact and vice versa.

### M6 — Relics, boss words, balance pass

- Three launch relics; floor-5 boss (compound from meaning); ink/HP tuning from playtests; victory/defeat screens with run summary (strokes written, ink spent, ghosts cleared).
- **Acceptance:** a practiced player can win; a new player loses gracefully with clear feedback about which kanji to study; all three relics observably change decisions.

## Test plan

- **Scorer (highest priority):** table-driven cases on recorded fixtures — correct writing, wrong stroke count, reversed direction, wrong order, scribble; threshold boundary cases per recall mode. Pure-function tests runnable in Node without a framework (`node --test`).
- **Floor generation:** same seed → identical floors; pool filters respect depth rules; offline shrink behavior.
- **Engine:** HP/ink arithmetic, ghost insertion, run end states — pure-logic tests.
- **Persistence:** versioned load/save, malformed-data recovery, cap enforcement, independence of the two storage keys.
- **Manual/browser:** pointer input across mouse/touch/pen, depth contrast checks, reduced-motion walkthrough of a full run, screen-reader pass over encounter flow, Pages deployment smoke test.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Scorer feels unfair → game feels broken | Ship scorer first (M1) behind the practice toggle; tune thresholds on real attempts before the game exists; always allow retry at ink cost rather than hard failure. |
| Scope creep toward a full game engine | Milestone gates; no inventory/shops/map v1; relics capped at three; engine stays a state machine, not a framework. |
| Dark depths break readability | Contrast audit in M4 acceptance; keep `--line`/`--muted` per-depth overrides; test on low-brightness displays. |
| Network dependence mid-run | Prefetch the whole floor's SVGs at floor start with one loading moment; on failure shrink the pool or swap in bundled characters; never fail an encounter for network reasons. |
| Vocabulary curation burden (readings/meanings) | Start with ~150 curated characters in `pools.json`; characters without curated entries appear only in copy/trace modes where meaning isn't required. |
| Game pressure undermines the calm brand | Keep the study page as the front door; game tone stays quiet (no timers in v1, no shake); defeat screen recommends study, not retry-spam. |
| `localStorage` bloat from bestiary | Store aggregates plus at most one winning attempt per character; reuse practice-store cap patterns. |

## Explicitly out of scope for v1

Accounts/leaderboards, mid-run save/resume, timers or speed pressure, stroke-order hints during free recall, sound, mobile-app packaging, ML-based recognition, and any change to the existing study/practice behavior.

## Definition of done (v1)

From the study space, a learner can enter Ink Dungeon, play a seeded five-floor run offline-first through the recall ladder, see each depth's distinct palette/scroll/stamp aesthetic with full reduced-motion parity, lose or win with a clear summary, build a persistent local bestiary that bridges into the existing remember-for-review state, and delete all dungeon data — with the study space and practice panel byte-for-byte unaffected when the game is never opened.
