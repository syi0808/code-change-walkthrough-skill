# Design rules R1–R40

Apply these rules when you design a walkthrough. When two choices seem equally good, the rule decides. Other references cite them as R#.

## Load: what goes into a scene
- **R1. One idea per scene.** Introduce at most about 4 new identifiers, files, or concepts per scene. Write a lead line plus 2–4 bullets of narration and 3–8 steps.
- **R2. Remove noise.** Keep the default `whitespace: "collapse"` and `granularity: "word"`. Leave lock files and generated files out of the narration. Fold or `focus` large files.
- **R3. Chunk mechanical repetition.** For a pattern that repeats, show one representative instance plus a `refs` list, and say "the rest follow the same pattern".

## Pacing and signaling
- **R4. Segment.** Scene boundaries are pause points, so end each scene at a natural "got it" moment.
- **R5. Pre-train.** Scene 1 is a big-picture `graph`. Define unfamiliar domain terms in `glossary`.
- **R6. Signal what matters.** Use `highlight` with a short `label` on key lines, and `focus` to dim the rest.
- **R7. Explain in place.** Put a remark about a specific line in a `note` on that line, not in the narration.
- **R8. Keep words and visuals in sync.** Narration items (sentences or bullets) appear one by one. Order them like the steps, and pin each one to the step it describes with `cue`. Shape: a lead line (the why), then 2–4 bullets, each one visual beat in note form (R32).
- **R9. Don't read code aloud.** The narration covers intent, reasons, and relations.

## Motion
- **R10. Animate only real IDE actions** (`open`, `reveal`, `goto`, `refs`) **and the edit itself** (`type`, which replays a key hunk being written). Nothing decorative. Replaying an edit is congruent motion: the change over time *is* the concept. Keep it for the few edits that carry the change.
- **R11. Keep 1–2 simultaneous highlights.** The most salient thing on screen must be the most relevant.
- **R12. Leave room for viewer control.** Keep scenes short enough that a viewer can pause, step back, or explore.

## Order and content
- **R13. State the intent first.** The summary and scene 1 say "this change does X so that Y". Later scenes confirm it in code.
- **R14. Follow execution or dependency order,** never file or diff order. After the scene-1 map, prefer dependency order for the scenes: definitions (enums, types, DTOs, helpers) before the code that uses them, the entry point that assembles them last. The tour writes each file when its scene comes, so this is also the order the code is written in: every file then builds on names already seen. `check` warns when a file is written before code it uses that is explained later.
- **R15. Mark beacons and convention breaks.** Give lines that reveal intent a `highlight` with a label. Give unusual code a `note` with `tone: "risk"`.
- **R16. Answer what, why, or how in every scene.** Use note tones to show which: `why`, `risk`, `tip`.
- **R17. Adapt to the audience's familiarity.** See the playbook, "Audience".

## Navigation
- **R18. Announce before moving.** Before a `goto` or `refs`, say where you are going and why.
- **R19. Let the player navigate.** Use `goto`, `peek`, `refs`, and a second pane instead of describing locations in words.
- **R20. Fit each scene to a question type:**

| Question | Scene type | Actions |
|---|---|---|
| Where does it start? | entry point | `open` + `focus` |
| What does this call or who calls it? | expand | `goto`, `refs` |
| How does the flow work? | follow | chained `goto` |
| What does this function do with real values? | trace (R40) | `trace` |
| How do the parts relate? | structure | `graph`, `refs` |
| What else does this reach? | impact (R34) | `impact` |

## Structure
- **R21. Make one chapter per independent cluster.** Start from `clusters` in the collect output.
- **R22. Keep related parts adjacent.** A definition comes right before its usages, and an implementation right before its tests. A definition the viewer meets in a line before its own scene: `peek` it if it is short (R39), else drill down (R37).
- **R23. Open with a map, and walk it.** Scene 1 explains the change on its `graph`, part by part: one bullet per part, each pinned (`cue`) to a `graph` step that highlights that part's nodes, in the order the chapters will take them, named the way the chapters will be. Number the flow on the edges (①, ②, ...) and give every node its `file`. The graph then docks as the map, lights the node of the file in view, and the heading band names the node each scene goes to, so every later scene is placed on the map the viewer was shown first. Add the summary, `strategy.rationale`, and chapter goals around it.
- **R24. Close with a recap:** `takeaways` (2–4) and `reviewFocus` (open questions for the reviewer).
- **R25. Scale scaffolding to the audience.** Newcomers get more pre-training. Reviewers get less.

## Coverage
- **R33. Cover the whole diff, stop where it needs words.** The tour replays every hunk; order it by the question chain (`tour.order`) and attach explanation scenes as stops (`at`). Type key hunks (`tempo: "key"`), skim wiring (`"skim"`), and don't spend stops on code that speaks for itself.

## Narrative thread
- **R29. Every scene answers a question.** Give each scene a `question`: what the viewer is wondering at that moment, phrased the way they would ask it ("Who is allowed to see this list?"). The player keeps it above the code all scene long, so the code on screen always has a reason. The chain of questions *is* the order of the walkthrough.
- **R30. Bridge with the map, not with the past.** Give every scene after the first a `bridge`: where the scene sits on the scene-1 map (the part, by its number) and what it settles there ("② Query, once access passes: count first, then the page"). Never recap the previous scene ("X done → Y next"): the viewer just saw it, and a recap tells them nothing about where they are going. The player shows the bridge in the heading band at the top of the code when the scene starts, with the chapter and the map node of the scene's file. A scene attached to a file (`at`) is announced before the tour replays that file: its bridge and `question` open the replay, so write them as what the code about to be written is for, not as what it was.
- **R31. Write for one voice at a time.** The player shows one explanation at a time, attached under the newest highlight, and a `note` counts as that voice. Per scene, use one lead line, then one bullet or note per highlight, in the order of the highlights. Only the two newest highlights stay salient, so explain each as it appears and don't refer back to a third.
- **R32. Write in note form.** All prose except `question` is note form in the viewer's language: Korean 개조식 (noun or nominal endings, never `~다`/`~습니다`), English telegraphic style (no subject, articles, or "is"; verb-first or noun phrase; no period), or the bullet register of the viewer's language. One fact per line; `→`, `:`, `/` instead of connectives. No em dashes, stacked qualifiers, or filler. A reader takes in a note-form line in one fixation span and sees its structure without parsing a sentence; the time saved goes to the code. See `ir-authoring.md`, "Narration style".

## Context outside the diff
- **R34. Show what the diff hides.** A review tool shows edited lines only. For every changed contract (signature, return shape, error, data, config, event), find its unchanged dependents in the whole repository (collect's fan-in, then read them) and bring the ones a reviewer must judge into the walkthrough with an `impact` step. Give each a `relation` and an `effect` (`safe`, `check`, `breaks`, `updated`).
- **R35. Context before the edit when the edit answers it.** If a change only makes sense against code elsewhere (a caller's expectation, an invariant, a default, a helper it mirrors), show that code first (`goto`), then the edit.
- **R37. Drill down just in time, then come back.** When a line depends on a definition the viewer has not seen (a function, a type, a constant) and the point of the line needs it, and the definition is longer than a hover (more than ~8 lines; otherwise R39), `goto` the definition, say what it does in 1 or 2 bullets (only what the line needs), then `back` to the line and resume with a bullet that applies what was just seen to it ("so `status` → 5xx or 429 retried"). One level deep: no drill-down inside a drill-down. Short: a few steps, inside one scene. Announce the destination before the `goto`. While away, the player shows the line it will return to; on `back` that line lights up and flashes. `check` warns about a drill-down inside a drill-down, a long one, or one that returns into another scene. Use plain `goto` (no `back`) when the walkthrough moves on to the definition for good.
- **R38. Split only to read two places together, and say why.** A second pane halves the width and the viewer's attention, so open one only when the explanation needs both places at once: old and new code, a caller and its callee's parameters, a test and the code it pins, two implementations. Open it with `open` into `pane: 1` and a `label` saying what the two are compared for ("old: one query per call"); the player shows it on the right pane. Two files read one after the other go in one pane. The split ends with its scene (the player closes it visibly); don't add `layout` steps.
- **R39. Peek a short definition; don't leave the line for it.** When the line needs an enum, a type, a constant, or a one-screen signature of up to ~8 lines, show it with `peek` (⌘-hover): the definition opens in a hover over the line, `range` lights the lines that matter, and the line stays in view, so nothing has to be found again. Bullet on what it means for the line, pinned to the `peek`. `check` suggests `peek` for a `goto` to a short definition that is left again soon.
- **R40. Trace a function whose behaviour depends on values.** For a utility, a branchy helper, a calculation, or a loop, run it once as a debugger would: `trace` with a concrete `call`, 3 to 8 `frames` on the lines where a value is set or a branch is decided, each with the 1 to 3 values that matter there, and `returns`. Pick inputs that take the interesting path (the edge case, the new branch). Derive every value from the code, never guess. Split a long run into two traces (the second without `call`) to pin a bullet to each half. A trace answers "what does it do with *this* input", which reading the code alone leaves to the viewer's mental simulation.
- **R36. State the reach, even when it is nothing.** Fill `meta.impact` with what outside the diff the change reaches and how (callers, data, config, other services, clients), including "no existing behaviour changes" when that is the finding. The player shows it in the overview, so the reviewer knows the reach before reading a line.

## Diff views
<!-- R38–R40 sit with navigation (above); the numbers are kept stable for references elsewhere -->
- **R26. Split for in-place rewrites, unified for additions, deletions, and scattered edits.**
- **R27. `patience` (the default) for moved blocks and brace-heavy code; `myers` for short edits.**
- **R28. Open new files in `after` and deleted files in `before`, never in `diff`.**
